import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Persistent Claude payload admission", .serialized)
struct ClaudeRuntimePayloadUseTests {
    private let identity = "sha256:" + String(repeating: "a", count: 64)

    @Test("Missing-store inspection is read-only and installation retains admission until release")
    func missingStoreAndGuard() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .clear)
        #expect(!FileManager.default.fileExists(atPath: fixture.storeRoot.path))
        let guardToken = try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot)
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .unavailable)
        #expect(throws: CoordinatorError("claude_runtime_unavailable")) {
            try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot)
        }
        guardToken.release()
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .clear)
    }

    @Test("Only explicit completion releases one use; losing an owner object leaves persistent evidence")
    func persistentUses() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let prepared = try fixture.prepare()
        let first = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: identity, storeRootURL: fixture.storeRoot)
        var orphan: ClaudeRuntimePayloadUse? = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: identity,
                                                                               storeRootURL: fixture.storeRoot)
        #expect(orphan != nil)
        try first.complete()
        try first.complete()
        orphan = nil
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .inUse)
        #expect(throws: CoordinatorError("claude_runtime_in_use")) {
            try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot)
        }
        #expect(FileManager.default.fileExists(atPath: prepared.nodeExecutable.path))
        #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.storeRoot.appendingPathComponent("uses").path).count == 1)
    }

    @Test("A normally reaped/no-spawn completion leaves the payload and permits installation")
    func completedUse() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let prepared = try fixture.prepare()
        let use = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: identity, storeRootURL: fixture.storeRoot)
        let uses = fixture.storeRoot.appendingPathComponent("uses")
        let names = try FileManager.default.contentsOfDirectory(atPath: uses.path)
        let record = try StrictJSONTransport.object(from: Data(contentsOf: uses.appendingPathComponent(try #require(names.first))))
        #expect(Set(record.keys) == ["schema_version", "use_id", "payload_digest", "runtime_identity"])
        #expect(record["runtime_identity"] as? String == identity)
        try use.complete()
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .clear)
        let guardToken = try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot)
        defer { guardToken.release() }
        #expect(throws: (any Error).self) {
            try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: identity, storeRootURL: fixture.storeRoot)
        }
        #expect(FileManager.default.fileExists(atPath: prepared.rootURL.path))
    }

    @Test("Invalid or unknown records prevent installation and cannot be removed by a use token",
           arguments: ["corrupt", "unknown", "symlink", "hardlink", "mode", "rebound"])
    func invalidUseRecord(kind: String) throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let use = try ClaudeRuntimePayloadUse.begin(prepared: fixture.prepare(), runtimeIdentity: identity, storeRootURL: fixture.storeRoot)
        let uses = fixture.storeRoot.appendingPathComponent("uses")
        let existingNames = try FileManager.default.contentsOfDirectory(atPath: uses.path)
        let name = try #require(existingNames.first)
        let path = uses.appendingPathComponent(name)
        switch kind {
        case "corrupt": try Data("{}".utf8).write(to: path)
        case "unknown": try Data().write(to: uses.appendingPathComponent(".registering-interrupted"))
        case "symlink":
            let outside = fixture.container.appendingPathComponent("outside-record")
            try FileManager.default.moveItem(at: path, to: outside)
            try FileManager.default.createSymbolicLink(at: path, withDestinationURL: outside)
        case "hardlink": #expect(link(path.path, fixture.container.appendingPathComponent("record-link").path) == 0)
        case "mode": #expect(chmod(path.path, 0o644) == 0)
        default:
            var record = try StrictJSONTransport.object(from: Data(contentsOf: path))
            record["runtime_identity"] = "sha256:" + String(repeating: "b", count: 64)
            try StrictJSONTransport.data(forJSONObject: record).write(to: path)
            #expect(chmod(path.path, 0o600) == 0)
        }
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == (kind == "rebound" ? .inUse : .unavailable))
        #expect(throws: (any Error).self) { try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot) }
        #expect(throws: (any Error).self) { try use.complete() }
        #expect(FileManager.default.fileExists(atPath: path.path))
    }

    @Test("Concurrent begin and installation have one winner and no admission gap")
    func simultaneousAdmission() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let prepared = try fixture.prepare()
        let results = ClaudeUseRaceResults()
        let start = DispatchSemaphore(value: 0), done = DispatchGroup()
        let runtimeIdentity = identity
        for installation in [false, true] {
            done.enter()
            DispatchQueue.global().async {
                defer { done.leave() }
                guard start.wait(timeout: .now() + 5) == .success else { return }
                do {
                    if installation { results.add(try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot)) }
                    else { results.add(try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: runtimeIdentity, storeRootURL: fixture.storeRoot)) }
                } catch { results.failed() }
            }
        }
        defer { start.signal(); start.signal(); results.cleanup() }
        start.signal(); start.signal()
        try #require(done.wait(timeout: .now() + 5) == .success)
        #expect(results.successes == 1 && results.failures == 1)
    }

    @Test("The admission flock excludes a separate process and releases only with its guard")
    func crossProcessAdmission() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let guardToken = try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: fixture.storeRoot)
        defer { guardToken.release() }
        #expect(try probeClaudeAdmission(fixture.storeRoot) == 19)
        guardToken.release()
        #expect(try probeClaudeAdmission(fixture.storeRoot) == 0)
    }

    @Test("Known completion waits through transient admission contention without deleting uncertain evidence")
    func completionContention() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let use = try ClaudeRuntimePayloadUse.begin(prepared: fixture.prepare(), runtimeIdentity: identity, storeRootURL: fixture.storeRoot)
        let held = try ClaudePayloadAdmission.acquire(rootURL: fixture.storeRoot, create: false)
        defer { held.release() }
        let completed = DispatchSemaphore(value: 0)
        let result = ClaudeCompletionResult()
        DispatchQueue.global().async {
            do { try use.complete(); result.markSuccess() } catch { result.markFailure() }
            completed.signal()
        }
        defer { held.release(); _ = completed.wait(timeout: .now() + 6) }
        #expect(completed.wait(timeout: .now() + .milliseconds(100)) == .timedOut)
        held.release()
        try #require(completed.wait(timeout: .now() + 6) == .success)
        #expect(result.succeeded && !result.failed)
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .clear)
        // Restore the semaphore permit consumed above for unconditional cleanup.
        completed.signal()
    }

    @Test("Full record capacity rejects admission before writing and keeps existing completion usable")
    func fullCapacity() throws {
        let fixture = try ClaudeRuntimePayloadFixture()
        defer { fixture.cleanup() }
        let prepared = try fixture.prepare()
        let owner = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: identity, storeRootURL: fixture.storeRoot)
        let uses = fixture.storeRoot.appendingPathComponent("uses")
        for _ in 1..<ClaudeRuntimePayloadUse.maximumUseRecords {
            let id = UUID().uuidString.lowercased()
            let data = try StrictJSONTransport.data(forJSONObject: ["schema_version": "blabee.claude-runtime-use.v1",
                "use_id": id, "payload_digest": prepared.digest, "runtime_identity": identity])
            let path = uses.appendingPathComponent(id + ".json")
            try data.write(to: path)
            try #require(chmod(path.path, 0o600) == 0)
        }
        #expect(throws: CoordinatorError("claude_runtime_unavailable")) {
            try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: identity, storeRootURL: fixture.storeRoot)
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: uses.path).count == ClaudeRuntimePayloadUse.maximumUseRecords)
        try owner.complete()
        #expect(try FileManager.default.contentsOfDirectory(atPath: uses.path).count == ClaudeRuntimePayloadUse.maximumUseRecords - 1)
        #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: fixture.storeRoot) == .inUse)
    }
}

private final class ClaudeCompletionResult: @unchecked Sendable {
    private let lock = NSLock()
    private var success = false, failure = false
    func markSuccess() { lock.withLock { success = true } }
    func markFailure() { lock.withLock { failure = true } }
    var succeeded: Bool { lock.withLock { success } }
    var failed: Bool { lock.withLock { failure } }
}

private final class ClaudeUseRaceResults: @unchecked Sendable {
    private let lock = NSLock()
    private var uses: [ClaudeRuntimePayloadUse] = []
    private var guards: [ClaudeRuntimePayloadUse.InstallationGuard] = []
    private var errors = 0
    func add(_ value: ClaudeRuntimePayloadUse) { lock.withLock { uses.append(value) } }
    func add(_ value: ClaudeRuntimePayloadUse.InstallationGuard) { lock.withLock { guards.append(value) } }
    func failed() { lock.withLock { errors += 1 } }
    var successes: Int { lock.withLock { uses.count + guards.count } }
    var failures: Int { lock.withLock { errors } }
    func cleanup() { lock.withLock { guards.forEach { $0.release() }; uses.forEach { try? $0.complete() } } }
}

private func probeClaudeAdmission(_ root: URL) throws -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/perl")
    process.arguments = ["-e", "use Fcntl qw(:DEFAULT :flock); sysopen(my $f,$ARGV[0],O_RDWR) or exit 20; exit(flock($f,LOCK_EX|LOCK_NB) ? 0 : 19);",
                         root.appendingPathComponent("admission.lock").path]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    defer { if process.isRunning { process.terminate() } }
    let deadline = ContinuousClock.now + .seconds(3)
    while process.isRunning {
        guard ContinuousClock.now < deadline else { throw CoordinatorError("claude_payload_fixture_timeout") }
        usleep(10_000)
    }
    return process.terminationStatus
}
