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
