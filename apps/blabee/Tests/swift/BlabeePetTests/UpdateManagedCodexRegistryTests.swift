import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Update managed Codex registry and authenticated control")
struct UpdateManagedCodexRegistryTests {
    @Test("private registry roundtrips and atomically replaces session records")
    func roundtrip() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var record = try makeRecord()
        record.codexHome = "/private/tmp/custom-codex-home"
        try fixture.registry.save(record)
        #expect(try fixture.registry.records() == [record])
        let file = fixture.recordURL(record.session.id)
        let original = try FileManager.default.attributesOfItem(atPath: file.path)
        let directoryAttributes = try FileManager.default.attributesOfItem(atPath: fixture.directory.path)
        #expect((original[.posixPermissions] as? NSNumber)?.intValue == 0o600)
        #expect((directoryAttributes[.posixPermissions] as? NSNumber)?.intValue == 0o700)
        record.session.state = .busy
        try fixture.registry.save(record, expectedIncarnation: record.incarnation)
        #expect(try fixture.registry.records() == [record])
        let replacement = try FileManager.default.attributesOfItem(atPath: file.path)
        #expect((original[.systemFileNumber] as? NSNumber) != (replacement[.systemFileNumber] as? NSNumber))
        try fixture.registry.remove(id: record.session.id, expectedIncarnation: record.incarnation)
        #expect(try fixture.registry.records().isEmpty)
    }

    @Test("oversized on-disk JSON and unsafe CODEX_HOME paths cannot become session evidence")
    func rejectsOversizedDiskRecordAndUnsafeHome() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var record = try makeRecord()
        record.codexHome = "/private/tmp/home\nexport TOKEN=unexpected"
        #expect(throws: (any Error).self) { try fixture.registry.save(record) }
        record.codexHome = nil
        try fixture.registry.save(record)
        try Data(repeating: 32, count: 65_537).write(to: fixture.recordURL(record.session.id))
        #expect(throws: (any Error).self) { try fixture.registry.records() }
    }

    @Test("symlinked storage cannot redirect registry reads or writes")
    func rejectsSymlinkRoot() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        let target = fixture.base.appendingPathComponent("target", isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        try FileManager.default.createSymbolicLink(at: fixture.directory, withDestinationURL: target)
        #expect(throws: (any Error).self) { try fixture.registry.save(makeRecord()) }
        #expect(try FileManager.default.contentsOfDirectory(atPath: target.path).isEmpty)
    }

    @Test("symlinked, linked and non-private record files fail closed", arguments: ["symlink", "hardlink", "mode"])
    func rejectsUnsafeRecord(kind: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        let record = try makeRecord()
        try fixture.registry.save(record)
        let target = fixture.recordURL(record.session.id)
        if kind == "mode" {
            try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: target.path)
        } else if kind == "hardlink" {
            try FileManager.default.linkItem(at: target, to: fixture.base.appendingPathComponent("extra-link"))
        } else {
            let outside = fixture.base.appendingPathComponent("outside.json")
            try FileManager.default.moveItem(at: target, to: outside)
            try FileManager.default.createSymbolicLink(at: target, withDestinationURL: outside)
        }
        #expect(throws: (any Error).self) { try fixture.registry.records() }
        #expect(throws: (any Error).self) { try fixture.registry.save(record) }
        #expect(throws: (any Error).self) {
            try fixture.registry.remove(id: record.session.id, expectedIncarnation: record.incarnation)
        }
    }

    @Test("invalid identity and oversized records are rejected before persistence")
    func rejectsInvalidAndOversized() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var invalid = try makeRecord()
        invalid.session.id = "../escape"
        #expect(throws: (any Error).self) { try fixture.registry.save(invalid) }
        invalid = try makeRecord()
        invalid.session.threadID = "not-a-thread"
        #expect(throws: (any Error).self) { try fixture.registry.save(invalid) }
        invalid = try makeRecord()
        invalid.session.detail = String(repeating: "x", count: 65_536)
        #expect(throws: (any Error).self) { try fixture.registry.save(invalid) }
        #expect(try fixture.registry.records().isEmpty)
    }

    @Test("launch placeholders are persisted only in the starting state")
    func startingPlaceholder() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var record = try makeRecord()
        record.hostPID = 0
        record.hostStartTime = 0
        record.session.state = .starting
        try fixture.registry.save(record)
        #expect(try fixture.registry.records() == [record])
        record.session.state = .running
        #expect(throws: (any Error).self) { try fixture.registry.save(record) }
        #expect(throws: (any Error).self) { try UpdateManagedCodexControlClient().request(record, action: .status) }
    }

    @Test("confirmed unstarted launches discard only their record and cleanup is idempotent", arguments: [false, true])
    func discardUnstartedPlaceholder(resuming: Bool) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var record = try makeUnstartedRecord(resuming: resuming)
        let runtime = fixture.base.appendingPathComponent("Blabee.app", isDirectory: true)
        try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: false)
        let marker = runtime.appendingPathComponent("preserved")
        let command = fixture.base.appendingPathComponent("session.command")
        let content = Data("preserve runtime and command files".utf8)
        try content.write(to: marker)
        try content.write(to: command)
        record.runtimeAppPath = runtime.path
        try fixture.registry.save(record)

        try fixture.registry.discardUnstarted(record)
        try fixture.registry.discardUnstarted(record)

        #expect(try fixture.registry.records().isEmpty)
        #expect(!FileManager.default.fileExists(atPath: fixture.recordURL(record.session.id).path))
        #expect(try Data(contentsOf: marker) == content)
        #expect(try Data(contentsOf: command) == content)
    }

    @Test("discard rejects launch candidates that already have host or restoration authority",
          arguments: ["host", "running", "transaction", "restoration"])
    func rejectsStartedDiscardCandidate(_ change: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var record = try makeUnstartedRecord()
        switch change {
        case "host", "running":
            record.hostPID = getpid()
            record.hostStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
            if change == "running" { record.session.state = .running }
        case "transaction": record.transactionID = UUID().uuidString.lowercased()
        default: record.restorationClaim = UUID().uuidString.lowercased()
        }
        try fixture.registry.save(record)

        #expect(throws: CoordinatorError("update_managed_launch_record_invalid")) {
            try fixture.registry.discardUnstarted(record)
        }
        #expect(try fixture.registry.records() == [record])
    }

    @Test("discard compares the whole original launch record even within the same incarnation",
          arguments: ["host", "incarnation", "nonce", "socket", "runtime", "thread", "cwd",
                      "codex", "codex-home", "terminal", "detail", "transaction", "restoration"])
    func preservesChangedLaunchRecord(_ change: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        let original = try makeUnstartedRecord()
        try fixture.registry.save(original)
        var changed = original
        switch change {
        case "host":
            changed.hostPID = getpid()
            changed.hostStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
            changed.session.state = .running
        case "incarnation": changed.incarnation = UUID().uuidString.lowercased()
        case "nonce": changed.nonce = UUID().uuidString.lowercased()
        case "socket": changed.socketPath = fixture.base.appendingPathComponent("other.sock").path
        case "runtime": changed.runtimeAppPath = fixture.base.appendingPathComponent("other.app").path
        case "thread": changed.session.threadID = UUID().uuidString.lowercased()
        case "cwd": changed.session.cwd = fixture.base.path
        case "codex": changed.codexPath = fixture.base.appendingPathComponent("codex").path
        case "codex-home": changed.codexHome = fixture.base.appendingPathComponent("codex-home").path
        case "terminal": changed.terminal = "Apple_Terminal"
        case "detail": changed.session.detail = "changed after launch preparation"
        case "transaction": changed.transactionID = UUID().uuidString.lowercased()
        default: changed.restorationClaim = UUID().uuidString.lowercased()
        }
        try fixture.registry.save(changed, expectedIncarnation: original.incarnation)

        #expect(throws: CoordinatorError("update_managed_launch_record_changed")) {
            try fixture.registry.discardUnstarted(original)
        }
        #expect(try fixture.registry.records() == [changed])
    }

    @Test("a late host cannot recreate a discarded placeholder")
    func discardedLaunchCannotBeResurrected() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        let original = try makeUnstartedRecord()
        try fixture.registry.save(original)
        var host = original
        host.hostPID = getpid()
        host.hostStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
        host.session.state = .running

        try fixture.registry.discardUnstarted(original)
        #expect(throws: CoordinatorError("update_managed_incarnation_mismatch")) {
            try fixture.registry.save(host, expectedIncarnation: original.incarnation)
        }
        #expect(try fixture.registry.records().isEmpty)
    }

    @Test("host startup and failed-launch cleanup elect one winner under the registry lock")
    func discardRacesWithHostStartup() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        for _ in 0..<8 {
            let original = try makeUnstartedRecord()
            try fixture.registry.save(original)
            var claimed = original
            claimed.hostPID = getpid()
            claimed.hostStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
            claimed.session.state = .running
            let host = claimed
            let outcomes = LaunchRaceOutcomes()
            DispatchQueue.concurrentPerform(iterations: 2) { branch in
                do {
                    if branch == 0 {
                        try fixture.registry.save(host, expectedIncarnation: original.incarnation)
                    } else {
                        try fixture.registry.discardUnstarted(original)
                    }
                    outcomes.set(branch, "success")
                } catch {
                    outcomes.set(branch, (error as? CoordinatorError)?.code ?? "unexpected error")
                }
            }
            let result = outcomes.values
            let retained = try fixture.registry.records().first(where: { $0.session.id == original.session.id })
            if result[0] == "success" {
                #expect(result[1] == "update_managed_launch_record_changed")
                #expect(retained == host)
            } else {
                #expect(result[0] == "update_managed_incarnation_mismatch")
                #expect(result[1] == "success")
                #expect(retained == nil)
            }
        }
    }

    @Test("discard refuses symlinked and non-private launch records", arguments: ["symlink", "mode"])
    func rejectsUnsafeDiscardStorage(_ kind: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        let record = try makeUnstartedRecord()
        try fixture.registry.save(record)
        let file = fixture.recordURL(record.session.id)
        let original = try Data(contentsOf: file)
        var preserved = file
        if kind == "symlink" {
            preserved = fixture.base.appendingPathComponent("outside.json")
            try FileManager.default.moveItem(at: file, to: preserved)
            try FileManager.default.createSymbolicLink(at: file, withDestinationURL: preserved)
        } else {
            try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
        }

        #expect(throws: (any Error).self) { try fixture.registry.discardUnstarted(record) }
        #expect(FileManager.default.fileExists(atPath: file.path))
        #expect(try Data(contentsOf: preserved) == original)
    }

    @Test("an old supervisor cannot overwrite or delete a different incarnation")
    func preventsStaleWriters() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        let original = try makeRecord()
        try fixture.registry.save(original)
        var replacement = original
        replacement.incarnation = UUID().uuidString.lowercased()
        try fixture.registry.save(replacement, expectedIncarnation: original.incarnation)
        #expect(throws: (any Error).self) {
            try fixture.registry.save(original, expectedIncarnation: original.incarnation)
        }
        #expect(throws: (any Error).self) {
            try fixture.registry.remove(id: original.session.id, expectedIncarnation: original.incarnation)
        }
        #expect(try fixture.registry.records() == [replacement])
    }

    @Test("a private runtimes subdirectory is permitted without becoming a session")
    func runtimeDirectory() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        #expect(try fixture.registry.records().isEmpty)
        let runtimes = fixture.directory.appendingPathComponent("runtimes", isDirectory: true)
        try FileManager.default.createDirectory(at: runtimes, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        #expect(try fixture.registry.records().isEmpty)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: runtimes.path)
        #expect(throws: (any Error).self) { try fixture.registry.records() }
    }

    @Test("parallel restoration claims elect exactly one fallback without spawning a process")
    func atomicRestorationClaim() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var record = try makeRecord()
        record.session.state = .paused
        record.transactionID = UUID().uuidString.lowercased()
        // Readable PID with a different birth time is confirmed stale evidence;
        // no process is terminated or launched by this test.
        record.hostStartTime += 1
        try fixture.registry.save(record)
        let pending = record
        let outcomes = Outcomes()
        DispatchQueue.concurrentPerform(iterations: 8) { _ in
            do {
                let result = try fixture.registry.claimRestoration(id: pending.session.id,
                    expectedIncarnation: pending.incarnation, transactionID: pending.transactionID!,
                    claimID: UUID().uuidString.lowercased())
                outcomes.append(result)
            } catch { }
        }
        #expect(outcomes.values.count == 1)
        let saved = try #require(fixture.registry.records().first)
        #expect(saved.session.state == .resuming)
        #expect(saved.restorationClaim == outcomes.values.first?.restorationClaim)
    }

    @Test("fallback cannot claim a still-running supervisor even when its socket is unavailable")
    func rejectsFallbackForLiveHost() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var record = try makeRecord()
        record.session.state = .paused
        record.transactionID = UUID().uuidString.lowercased()
        try fixture.registry.save(record)
        #expect(throws: (any Error).self) {
            try fixture.registry.claimRestoration(id: record.session.id, expectedIncarnation: record.incarnation,
                transactionID: record.transactionID!, claimID: UUID().uuidString.lowercased())
        }
        #expect(try fixture.registry.records() == [record])
    }

    @Test("same-user control authenticates the exact host and transports one action")
    func liveControl() throws {
        var record = try makeRecord()
        record.socketPath = try UpdateManagedCodexControlServer.makeSocketPath()
        let expected = record
        let outcomes = Outcomes()
        let server = UpdateManagedCodexControlServer(record: record) { action, transaction, expectedSession in
            guard expectedSession.threadID == expected.session.threadID, expectedSession.cwd == expected.session.cwd else { throw CocoaError(.coderInvalidValue) }
            var result = expected
            if action == .pause { result.session.state = .paused }
            result.transactionID = transaction
            outcomes.append(result)
            return result
        }
        try server.start()
        defer { server.stop() }
        let client = UpdateManagedCodexControlClient(timeoutMilliseconds: 2_000)
        #expect(try client.request(record, action: .status) == record)
        let transaction = UUID().uuidString.lowercased()
        let paused = try client.request(record, action: .pause, transactionID: transaction)
        #expect(paused.session.state == .paused)
        #expect(paused.transactionID == transaction)
        #expect(outcomes.values.count == 2)
        var staleThread = record
        staleThread.session.threadID = UUID().uuidString.lowercased()
        #expect(throws: (any Error).self) {
            try client.request(staleThread, action: .pause, transactionID: transaction)
        }
        var staleCWD = record
        staleCWD.session.cwd = "/private/tmp/other-project"
        #expect(throws: (any Error).self) {
            try client.request(staleCWD, action: .pause, transactionID: transaction)
        }
        #expect(outcomes.values.count == 2)
    }

    @Test("wrong nonce, incarnation, birth time and missing transaction never reach the handler")
    func rejectsUnauthenticatedControl() throws {
        var record = try makeRecord()
        record.socketPath = try UpdateManagedCodexControlServer.makeSocketPath()
        let expected = record
        let outcomes = Outcomes()
        let server = UpdateManagedCodexControlServer(record: record) { _, _, _ in
            outcomes.append(expected)
            return expected
        }
        try server.start()
        defer { server.stop() }
        let client = UpdateManagedCodexControlClient(timeoutMilliseconds: 1_000)
        var wrongNonce = record
        wrongNonce.nonce = UUID().uuidString.lowercased()
        #expect(throws: (any Error).self) { try client.request(wrongNonce, action: .status) }
        var wrongIncarnation = record
        wrongIncarnation.incarnation = UUID().uuidString.lowercased()
        #expect(throws: (any Error).self) { try client.request(wrongIncarnation, action: .status) }
        var wrongStart = record
        wrongStart.hostStartTime += 1
        #expect(throws: (any Error).self) { try client.request(wrongStart, action: .status) }
        #expect(throws: (any Error).self) { try client.request(record, action: .pause) }
        #expect(outcomes.values.isEmpty)
        #expect(try client.request(record, action: .status) == record)
    }

    private func makeUnstartedRecord(resuming: Bool = true) throws -> UpdateManagedCodexRecord {
        var record = try makeRecord()
        record.session.state = .starting
        if !resuming { record.session.threadID = nil }
        record.hostPID = 0
        record.hostStartTime = 0
        return record
    }

    private func makeRecord() throws -> UpdateManagedCodexRecord {
        UpdateManagedCodexRecord(session: UpdateManagedSession(id: UUID().uuidString.lowercased(),
            threadID: UUID().uuidString.lowercased(), cwd: "/private/tmp", state: .running, detail: nil),
            nonce: UUID().uuidString.lowercased(), hostPID: getpid(),
            hostStartTime: try UpdateManagedCodexProcessIdentity.startTime(pid: getpid()),
            incarnation: UUID().uuidString.lowercased(), socketPath: "/private/tmp/unused/control.sock",
            codexPath: "/opt/homebrew/bin/codex", terminal: nil, transactionID: nil,
            runtimeAppPath: "/private/tmp/signed-copy/Blabee.app", restorationClaim: nil)
    }

    private struct Fixture: Sendable {
        let base: URL
        let directory: URL
        let registry: UpdateManagedCodexRegistry
        init() throws {
            base = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
                .appendingPathComponent("blabee-update-registry-test-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700])
            directory = base.appendingPathComponent("registry", isDirectory: true)
            registry = UpdateManagedCodexRegistry(directory: directory)
        }
        func recordURL(_ id: String) -> URL { directory.appendingPathComponent(id.lowercased() + ".json") }
        func cleanup() { try? FileManager.default.removeItem(at: base) }
    }

    private final class LaunchRaceOutcomes: @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [Int: String] = [:]
        var values: [Int: String] {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        func set(_ branch: Int, _ value: String) {
            lock.lock()
            stored[branch] = value
            lock.unlock()
        }
    }

    private final class Outcomes: @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [UpdateManagedCodexRecord] = []
        var values: [UpdateManagedCodexRecord] {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        func append(_ value: UpdateManagedCodexRecord) {
            lock.lock()
            stored.append(value)
            lock.unlock()
        }
    }
}
