import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Managed Codex initial launch failure recovery") @MainActor
struct UpdateManagedCodexSessionsTests {
    @Test("confirmed Terminal refusal removes both new and resume placeholders from update preflight",
          arguments: ["new-denied", "resume-denied", "new-invalid", "resume-invalid"])
    func confirmedTerminalFailureClearsUpdateBlocker(_ scenario: String) async throws {
        let fixture = try Fixture(resuming: scenario.hasPrefix("resume"))
        defer { fixture.cleanup() }
        let before = try await fixture.sessions.sessions()
        #expect(before.count == 1)
        #expect(throws: AppUpdateTransactionError.sessionsNotReady) {
            try AppUpdateTransactionEngine.preflight(frozen: before, current: before)
        }
        let expected: UpdateManagedCodexTerminalError = scenario.hasSuffix("denied")
            ? .automationDenied : .invalidCommand
        var preparations = 0
        var launches = 0

        #expect(throws: expected) {
            try fixture.sessions.launchPreparedSession(fixture.record, prepareCommand: { record in
                preparations += 1
                #expect(record == fixture.record)
                return fixture.command
            }, openTerminal: { command in
                launches += 1
                #expect(command == fixture.command)
                throw expected
            })
        }

        #expect(preparations == 1)
        #expect(launches == 1)
        let after = try await fixture.sessions.sessions()
        #expect(after.isEmpty)
        try AppUpdateTransactionEngine.preflight(frozen: [], current: after)
    }

    @Test("command preparation failure clears the placeholder before any Terminal request", arguments: [false, true])
    func commandPreparationFailureClearsUpdateBlocker(resuming: Bool) async throws {
        let fixture = try Fixture(resuming: resuming)
        defer { fixture.cleanup() }
        var preparations = 0
        var launches = 0
        #expect(throws: InjectedFailure.preparation) {
            try fixture.sessions.launchPreparedSession(fixture.record, prepareCommand: { _ in
                preparations += 1
                throw InjectedFailure.preparation
            }, openTerminal: { _ in launches += 1 })
        }

        #expect(preparations == 1)
        #expect(launches == 0)
        let after = try await fixture.sessions.sessions()
        #expect(after.isEmpty)
        try AppUpdateTransactionEngine.preflight(frozen: [], current: after)
    }

    @Test("uncertain Terminal outcomes retain the original record and never retry",
          arguments: ["timeout", "launch-failed", "unexpected"])
    func uncertainLaunchPreservesPlaceholder(_ scenario: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var preparations = 0
        var launches = 0
        do {
            try fixture.sessions.launchPreparedSession(fixture.record, prepareCommand: { _ in
                preparations += 1
                return fixture.command
            }, openTerminal: { _ in
                launches += 1
                switch scenario {
                case "timeout": throw UpdateManagedCodexTerminalError.timedOut
                case "launch-failed": throw UpdateManagedCodexTerminalError.launchFailed
                default: throw InjectedFailure.unexpected
                }
            })
            Issue.record("The injected launch failure was not propagated")
        } catch {
            switch scenario {
            case "timeout": #expect((error as? UpdateManagedCodexTerminalError) == .timedOut)
            case "launch-failed": #expect((error as? UpdateManagedCodexTerminalError) == .launchFailed)
            default: #expect((error as? InjectedFailure) == .unexpected)
            }
        }
        #expect(preparations == 1)
        #expect(launches == 1)
        #expect(try fixture.registry.records() == [fixture.record])
    }

    @Test("successful dispatch preserves either its unchanged placeholder or claimed host", arguments: [false, true])
    func successfulLaunchIsPreserved(hostStarted: Bool) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var expected = fixture.record
        if hostStarted {
            expected.hostPID = getpid()
            expected.hostStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
            expected.session.state = .running
        }
        var launches = 0
        try fixture.sessions.launchPreparedSession(fixture.record, prepareCommand: { _ in
            fixture.command
        }, openTerminal: { _ in
            launches += 1
            if hostStarted {
                try fixture.registry.save(expected, expectedIncarnation: fixture.record.incarnation)
            }
        })
        #expect(launches == 1)
        #expect(try fixture.registry.records() == [expected])
    }

    @Test("cleanup failure stays visible and never deletes a changed launch record",
          arguments: ["preparation", "terminal"])
    func cleanupFailurePropagates(_ stage: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var changed = fixture.record
        changed.nonce = UUID().uuidString.lowercased()
        var launches = 0
        #expect(throws: CoordinatorError("update_managed_launch_record_changed")) {
            try fixture.sessions.launchPreparedSession(fixture.record, prepareCommand: { _ in
                if stage == "preparation" {
                    try fixture.registry.save(changed, expectedIncarnation: fixture.record.incarnation)
                    throw InjectedFailure.preparation
                }
                return fixture.command
            }, openTerminal: { _ in
                launches += 1
                try fixture.registry.save(changed, expectedIncarnation: fixture.record.incarnation)
                throw UpdateManagedCodexTerminalError.automationDenied
            })
        }
        #expect(launches == (stage == "terminal" ? 1 : 0))
        #expect(try fixture.registry.records() == [changed])
    }

    private enum InjectedFailure: Error, Equatable {
        case preparation, unexpected
    }

    private struct Fixture {
        let directory: URL
        let registry: UpdateManagedCodexRegistry
        let record: UpdateManagedCodexRecord
        let command: URL
        var sessions: UpdateManagedCodexSessions { .init(registry: registry) }

        init(resuming: Bool = true) throws {
            directory = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
                .appendingPathComponent("blabee-update-launch-test-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700])
            registry = UpdateManagedCodexRegistry(directory: directory.appendingPathComponent("registry"))
            command = directory.appendingPathComponent("session.command")
            record = UpdateManagedCodexRecord(
                session: .init(id: UUID().uuidString.lowercased(),
                    threadID: resuming ? UUID().uuidString.lowercased() : nil,
                    cwd: directory.path, state: .starting, detail: nil),
                nonce: UUID().uuidString.lowercased(), hostPID: 0, hostStartTime: 0,
                incarnation: UUID().uuidString.lowercased(),
                socketPath: directory.appendingPathComponent("unused.sock").path,
                codexPath: "/opt/homebrew/bin/codex", terminal: nil, transactionID: nil,
                runtimeAppPath: directory.appendingPathComponent("Blabee.app").path,
                restorationClaim: nil)
            try registry.save(record)
        }

        func cleanup() { try? FileManager.default.removeItem(at: directory) }
    }
}
