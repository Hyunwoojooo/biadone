import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Managed Codex Terminal restore window")
struct UpdateManagedCodexTerminalTests {
    @Test("a new window receives one shell-quoted command through argv")
    func newWindowArguments() throws {
        let fixture = try Fixture(name: "restore '$(touch unexpected);.command")
        defer { fixture.cleanup() }
        var invocations = 0
        try UpdateManagedCodexTerminal.open(commandURL: fixture.command) { executable, arguments, timeout, limit in
            invocations += 1
            #expect(executable.path == "/usr/bin/osascript")
            #expect(arguments.count == 4)
            #expect(arguments[0] == "-e")
            #expect(arguments[1] == UpdateManagedCodexTerminal.script)
            #expect(!arguments[1].contains(fixture.command.path))
            #expect(arguments[1].contains("do script (item 1 of argv)"))
            #expect(!arguments[1].contains(" in "))
            #expect(arguments[2] == "--")
            #expect(arguments[3] == "exec '" + fixture.command.path.replacingOccurrences(of: "'", with: "'\\''") + "'")
            #expect(timeout == 30_000)
            #expect(limit == 16 * 1_024)
            return .init(exitCode: 0, stdout: Data(), stderr: Data())
        }
        #expect(invocations == 1)
    }

    @Test("denial, Apple event timeout, and unknown failures never open another window",
          arguments: ["denied (-1743)", "not permitted (-1744)", "timed out (-1712)", "other error",
                      "denied (-1743)\n", "not permitted (-1744)\r\n "])
    func appleEventFailure(_ diagnostic: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var invocations = 0
        let expected: UpdateManagedCodexTerminalError = diagnostic.contains("-174") ? .automationDenied
            : diagnostic.contains("-1712") ? .timedOut : .launchFailed
        #expect(throws: expected) {
            try UpdateManagedCodexTerminal.open(commandURL: fixture.command) { _, _, _, _ in
                invocations += 1
                return .init(exitCode: 1, stdout: Data(), stderr: Data(diagnostic.utf8))
            }
        }
        #expect(invocations == 1)
        #expect(expected.errorDescription?.isEmpty == false)
    }

    @Test("signal termination cannot turn denial text into proof that Terminal never launched",
          arguments: ["denied (-1743)", "not permitted (-1744)", "timed out (-1712)"])
    func signaledResultIsUncertain(_ diagnostic: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var invocations = 0
        #expect(throws: UpdateManagedCodexTerminalError.launchFailed) {
            try UpdateManagedCodexTerminal.open(commandURL: fixture.command) { _, _, _, _ in
                invocations += 1
                return .init(exitCode: 1, stdout: Data(), stderr: Data(diagnostic.utf8),
                             terminationSignal: SIGTERM)
            }
        }
        #expect(invocations == 1)
    }

    @Test("an Apple event code inside diagnostic text is not a confirmed refusal",
          arguments: ["path (-1743) failed (-1)", "denied (-1744) but result unknown",
                      "timed out (-1712) but result unknown"])
    func embeddedDiagnosticCodeIsUncertain(_ diagnostic: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var invocations = 0
        #expect(throws: UpdateManagedCodexTerminalError.launchFailed) {
            try UpdateManagedCodexTerminal.open(commandURL: fixture.command) { _, _, _, _ in
                invocations += 1
                return .init(exitCode: 1, stdout: Data(), stderr: Data(diagnostic.utf8))
            }
        }
        #expect(invocations == 1)
    }

    @Test("runner timeout is localized without retrying")
    func processTimeout() throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        var invocations = 0
        #expect(throws: UpdateManagedCodexTerminalError.timedOut) {
            try UpdateManagedCodexTerminal.open(commandURL: fixture.command) { _, _, _, _ in
                invocations += 1
                throw CoordinatorError("managed_codex_version_probe_timeout")
            }
        }
        #expect(invocations == 1)
    }

    @Test("unsafe command files are rejected before any Apple event",
          arguments: ["symlink", "shared-file", "shared-directory", "hardlink", "empty"])
    func rejectsUnsafeFiles(_ kind: String) throws {
        let fixture = try Fixture()
        defer { fixture.cleanup() }
        switch kind {
        case "symlink":
            let target = fixture.directory.appendingPathComponent("target")
            try FileManager.default.moveItem(at: fixture.command, to: target)
            try FileManager.default.createSymbolicLink(at: fixture.command, withDestinationURL: target)
        case "shared-file":
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fixture.command.path)
        case "shared-directory":
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fixture.directory.path)
        case "hardlink":
            try FileManager.default.linkItem(at: fixture.command, to: fixture.directory.appendingPathComponent("extra"))
        default: try Data().write(to: fixture.command)
        }
        var invoked = false
        #expect(throws: UpdateManagedCodexTerminalError.invalidCommand) {
            try UpdateManagedCodexTerminal.open(commandURL: fixture.command) { _, _, _, _ in
                invoked = true
                return .init(exitCode: 0, stdout: Data(), stderr: Data())
            }
        }
        #expect(!invoked)
    }

    private struct Fixture {
        let directory: URL
        let command: URL

        init(name: String = "restore.command") throws {
            directory = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
                .appendingPathComponent("blabee-terminal-test-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700])
            command = directory.appendingPathComponent(name)
            try Data("#!/bin/sh\nexit 0\n".utf8).write(to: command)
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: command.path)
        }

        func cleanup() { try? FileManager.default.removeItem(at: directory) }
    }
}
