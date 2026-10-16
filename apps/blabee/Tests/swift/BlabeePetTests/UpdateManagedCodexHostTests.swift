import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Update managed Codex pause admission")
struct UpdateManagedCodexHostTests {
    @Test(arguments: [false, true])
    func busyRaceRestoresOwnershipAndAllowsAnotherPauseAttempt(previousTransaction: Bool) throws {
        let fixture = try ManagedPauseHostFixture(previousTransaction: previousTransaction)
        let transaction = UUID().uuidString.lowercased()
        var attempts = 0
        let (host, runtime) = fixture.makeHost { observer in
            attempts += 1
            if attempts == 1 {
                let staged = try fixture.registry.records().first
                #expect(staged?.session.state == .pausing)
                #expect(staged?.transactionID == transaction)
                try observer.admitClient(fixture.busyRequest)
            }
        }

        #expect(throws: CoordinatorError("update_managed_session_busy_or_unconfirmed")) {
            _ = try host.handle(.pause, transactionID: transaction, expectedSession: fixture.record.session)
        }
        let busy = try host.handle(.status, transactionID: nil, expectedSession: fixture.record.session)
        #expect(busy.session.state == .busy)
        #expect(busy.transactionID == fixture.record.transactionID)
        #expect(busy.restorationClaim == fixture.record.restorationClaim)
        #expect(try fixture.registry.records() == [busy])
        #expect(runtime.withObserverForTesting { !$0.frozen && $0.unsubscribeRequests.isEmpty })
        #expect(try !fixture.hasWrittenBytes())

        try runtime.withObserverForTesting { observer in
            _ = try observer.observeServer(["id": 2, "result": [:] as [String: Any]])
        }
        let running = try host.handle(.status, transactionID: nil, expectedSession: fixture.record.session)
        #expect(running.session.state == .running)
        #expect(running.transactionID == fixture.record.transactionID)
        #expect(try fixture.registry.records() == [running])

        // A second request must reach admission again. Closing this fixture's
        // writer deliberately fails AFTER freeze, without launching a native process.
        fixture.writer.close()
        let retryTransaction = UUID().uuidString.lowercased()
        #expect(throws: CoordinatorError("managed_codex_app_server_closed")) {
            _ = try host.handle(.pause, transactionID: retryTransaction, expectedSession: fixture.record.session)
        }
        #expect(attempts == 2)
        #expect(runtime.withObserverForTesting { $0.frozen && $0.unsubscribeRequests.count == 1 })
        let failed = try host.handle(.status, transactionID: nil, expectedSession: fixture.record.session)
        #expect(failed.session.state == .failed)
        #expect(failed.transactionID == retryTransaction)
        #expect(try fixture.registry.records() == [failed])
    }

    @Test(arguments: ["observer-failure", "missing-persistence", "untyped-busy-error", "identity-change"])
    func unconfirmedAdmissionStillFailsClosed(reason: String) throws {
        let fixture = try ManagedPauseHostFixture()
        let (host, runtime) = fixture.makeHost { observer in
            switch reason {
            case "observer-failure":
                observer.fail("update_managed_root_transition_ambiguous")
                try observer.admitClient(fixture.busyRequest)
            case "missing-persistence":
                try FileManager.default.removeItem(at: fixture.rollout)
                try observer.admitClient(fixture.busyRequest)
            case "identity-change":
                observer = UpdateManagedCodexObserver(expectedResumeID: nil, expectedCWD: fixture.record.session.cwd)
            default:
                // Matching a CoordinatorError string is not proof of safe admission.
                throw CoordinatorError("update_managed_session_busy_or_unconfirmed")
            }
        }

        #expect(throws: (any Error).self) {
            _ = try host.handle(.pause, transactionID: UUID().uuidString.lowercased(),
                                expectedSession: fixture.record.session)
        }
        #expect(runtime.withObserverForTesting { !$0.frozen && $0.unsubscribeRequests.isEmpty })
        #expect(try !fixture.hasWrittenBytes())
        let failed = try host.handle(.status, transactionID: nil, expectedSession: fixture.record.session)
        #expect(failed.session.state == .failed)
        #expect(failed.session.detail == "update_managed_pause_unconfirmed")
        #expect(try fixture.registry.records() == [failed])
    }

    @Test func failedRollbackPersistenceLatchesFailureEvenWhenRuntimeBecomesIdle() throws {
        let fixture = try ManagedPauseHostFixture(previousTransaction: true)
        let transaction = UUID().uuidString.lowercased()
        let (host, runtime) = fixture.makeHost { observer in
            let staged = try fixture.registry.records().first
            #expect(staged?.session.state == .pausing)
            try observer.admitClient(fixture.busyRequest)
            // The original transition is durable, but rollback and failure writes
            // must both reject a registry whose private-directory invariant changed.
            try FileManager.default.setAttributes([.posixPermissions: 0o755],
                ofItemAtPath: fixture.registry.directoryURL.path)
        }

        #expect(throws: (any Error).self) {
            _ = try host.handle(.pause, transactionID: transaction, expectedSession: fixture.record.session)
        }
        #expect(runtime.withObserverForTesting { !$0.frozen && $0.unsubscribeRequests.isEmpty })
        #expect(try !fixture.hasWrittenBytes())
        try FileManager.default.setAttributes([.posixPermissions: 0o700],
            ofItemAtPath: fixture.registry.directoryURL.path)
        try runtime.withObserverForTesting { observer in
            _ = try observer.observeServer(["id": 2, "result": [:] as [String: Any]])
        }
        #expect(runtime.snapshot.state == .running)

        let failed = try host.handle(.status, transactionID: nil, expectedSession: fixture.record.session)
        #expect(failed.session.state == .failed)
        #expect(failed.session.detail == "update_managed_pause_unconfirmed")
        #expect(failed.transactionID == transaction)
        let durable = try fixture.registry.records().first
        #expect(durable?.session.state == .pausing)
        #expect(durable?.transactionID == transaction)
        #expect(throws: CoordinatorError("update_managed_session_busy_or_unconfirmed")) {
            _ = try host.handle(.pause, transactionID: UUID().uuidString.lowercased(),
                                expectedSession: fixture.record.session)
        }
        #expect(runtime.withObserverForTesting { !$0.frozen })
    }
}

private final class ManagedPauseHostFixture {
    let base: URL
    let home: URL
    let rollout: URL
    let registry: UpdateManagedCodexRegistry
    let record: UpdateManagedCodexRecord
    let observer: UpdateManagedCodexObserver
    let writer: ManagedCodexJSONLineWriter
    private let pipe = Pipe()

    var busyRequest: [String: Any] {
        ["id": 2, "method": "thread/read", "params": ["threadId": record.session.threadID!]]
    }

    init(previousTransaction: Bool = false) throws {
        base = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-pause-admission-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        home = base.appendingPathComponent("home", isDirectory: true)
        let sessions = home.appendingPathComponent("sessions", isDirectory: true)
        try FileManager.default.createDirectory(at: sessions, withIntermediateDirectories: true)
        let threadID = UUID().uuidString.lowercased()
        rollout = sessions.appendingPathComponent("rollout-fixture-" + threadID + ".jsonl")
        try Data("fixture persistence metadata\n".utf8).write(to: rollout)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: rollout.path)
        registry = UpdateManagedCodexRegistry(directory: base.appendingPathComponent("registry", isDirectory: true))
        record = UpdateManagedCodexRecord(
            session: UpdateManagedSession(id: UUID().uuidString.lowercased(), threadID: threadID,
                cwd: base.path, state: .running, detail: nil),
            nonce: UUID().uuidString.lowercased(), hostPID: getpid(),
            hostStartTime: try UpdateManagedCodexProcessIdentity.startTime(pid: getpid()),
            incarnation: UUID().uuidString.lowercased(), socketPath: base.appendingPathComponent("control.sock").path,
            codexPath: base.appendingPathComponent("unused-codex").path, terminal: nil,
            transactionID: previousTransaction ? UUID().uuidString.lowercased() : nil,
            runtimeAppPath: base.appendingPathComponent("Blabee.app").path,
            restorationClaim: previousTransaction ? UUID().uuidString.lowercased() : nil,
            codexHome: home.path
        )
        try registry.save(record)
        var seeded = UpdateManagedCodexObserver(expectedResumeID: nil, expectedCWD: base.path)
        try seeded.admitClient(["id": 1, "method": "thread/start"])
        _ = try seeded.observeServer(["id": 1, "result": ["cwd": base.path, "thread": [
            "id": threadID, "cwd": base.path, "ephemeral": false,
            "status": ["type": "idle"], "path": rollout.path,
        ]]])
        observer = seeded
        writer = try ManagedCodexJSONLineWriter(pipe.fileHandleForWriting)
        let descriptor = pipe.fileHandleForReading.fileDescriptor
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0 else {
            throw CoordinatorError("test_fixture_failed")
        }
    }

    deinit {
        writer.close()
        try? pipe.fileHandleForReading.close()
        try? FileManager.default.removeItem(at: base)
    }

    func makeHost(beforePauseAdmission: ((inout UpdateManagedCodexObserver) throws -> Void)? = nil)
        -> (UpdateManagedCodexHost, UpdateManagedCodexRuntime) {
        let runtime = UpdateManagedCodexRuntime(testingObserver: observer, codexHome: home.path,
            writer: writer, beforePauseAdmission: beforePauseAdmission)
        return (UpdateManagedCodexHost(testingRecord: record, registry: registry, runtime: runtime), runtime)
    }

    func hasWrittenBytes() throws -> Bool {
        var byte: UInt8 = 0
        let count = Darwin.read(pipe.fileHandleForReading.fileDescriptor, &byte, 1)
        if count < 0, errno == EAGAIN || errno == EWOULDBLOCK { return false }
        guard count >= 0 else { throw CoordinatorError("test_fixture_failed") }
        return count > 0
    }
}
