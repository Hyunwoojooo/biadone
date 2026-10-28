import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

struct ClaudeAutoConnectCommandTests {
    @Test func resumeArgumentsRemainOwnedByClaude() throws {
        for args in [[], ["--resume"], ["--resume", "a conversation name"], ["--continue"],
                     ["--resume", "00000000-0000-4000-8000-000000000001"],
                     ["--resume", "--fork-session"], ["-r"], ["-c"],
                     ["--resume", "daemon"], ["--resume=purge"], ["-r", "self-hosted-runner"],
                     ["--model", "sonnet", "a prompt with $HOME and `backticks`"],
                     ["--", "--settings", "literal prompt"], ["--", "--background", "--cloud"],
                     ["--", "daemon"], ["--", "purge"], ["--", "self-hosted-runner"], ["--", "--desktop"]] {
            let parsed = try ClaudeAutoConnectCommand.Arguments(["--claude-bin", "/tmp/Claude path/claude", "--"] + args)
            #expect(parsed.forwarded == args)
            #expect(ClaudeAutoConnectCommand.disposition(arguments: args, isTerminal: true) == .connect)
        }
    }

    @Test func ordinaryManagementAndScriptsBypassBlabee() {
        for args in [["--version"], ["--help"], ["auth", "login"], ["update"], ["mcp", "list"],
                     ["plugin", "install", "example"], ["doctor"], ["-p", "a prompt"],
                     ["--print=hello"], ["--output-format", "json"], ["remote-control"]] {
            #expect(ClaudeAutoConnectCommand.disposition(arguments: args, isTerminal: true) == .direct)
        }
        #expect(ClaudeAutoConnectCommand.disposition(arguments: ["--resume"], isTerminal: false) == .direct)
        #expect(ClaudeAutoConnectCommand.disposition(arguments: [], isTerminal: true,
            environment: ["CLAUDECODE": "1"]) == .direct)
    }

    @Test func currentManagementCommandsAndDesktopKeepTheirExactArguments() throws {
        for args in [["daemon", "status"],
                     ["--dangerously-skip-permissions", "daemon", "status"],
                     ["--allow-dangerously-skip-permissions", "daemon", "logs"],
                     ["purge"], ["purge", "/tmp/project with spaces"],
                     ["purge", "/tmp/project with $HOME and `backticks`", "--dry-run"],
                     ["self-hosted-runner", "doctor"], ["--desktop"],
                     ["--desktop", "--resume", "00000000-0000-4000-8000-000000000001"]] {
            let parsed = try ClaudeAutoConnectCommand.Arguments(["--claude-bin", "/tmp/Claude path/claude", "--"] + args)
            #expect(parsed.forwarded == args)
            #expect(ClaudeAutoConnectCommand.disposition(arguments: parsed.forwarded, isTerminal: true) == .direct)
        }
    }

    @Test func explicitConfigurationIsNotOverwritten() {
        for args in [["--settings", "local.json"], ["--mcp-config=custom.json"], ["--strict-mcp-config"],
                     ["--channels", "plugin:other"], ["--dangerously-load-development-channels", "server:other"],
                     ["--bare"], ["--safe-mode"], ["--setting-sources", "user"], ["--worktree", "branch"]] {
            #expect(ClaudeAutoConnectCommand.disposition(arguments: args, isTerminal: true) == .explicitConfiguration)
        }
    }

    @Test func globalOptionsDoNotHideMaintenanceOrMisreadResumeNames() {
        for args in [["--verbose", "mcp", "list"], ["--model", "sonnet", "auth", "login"],
                     ["--model=sonnet", "--verbose", "plugin", "list"],
                     ["--append-system-prompt", "--resume", "mcp", "list"],
                     ["--unknown-option", "value", "mcp", "list"]] {
            #expect(ClaudeAutoConnectCommand.disposition(arguments: args, isTerminal: true) == .direct)
        }
        for args in [["--resume", "project"], ["--resume=mcp"], ["--verbose", "-r", "auth"],
                     ["--model", "project", "ordinary prompt"], ["--model=sonnet", "--", "mcp"],
                     ["--append-system-prompt", "--settings", "explain this code"],
                     ["--append-system-prompt", "mcp", "explain this code"]] {
            #expect(ClaudeAutoConnectCommand.disposition(arguments: args, isTerminal: true) == .connect)
        }
    }

    @Test func daemonRemoteAndMaintenanceInvocationsKeepTheirExactArguments() throws {
        let remote = [["--bg", "a background prompt"], ["--background=job name"],
            ["--resume", "conversation", "--background"], ["--cloud", "a cloud prompt"],
            ["--cloud=environment-name"], ["--environment", "environment name"]]
        let maintenance = ["attach", "auto-mode", "gateway", "import", "logs", "project",
            "respawn", "rm", "stop", "kill", "ultrareview"].map { [$0, "name with $HOME and `backticks`", "--help"] }
        for args in remote + maintenance {
            let parsed = try ClaudeAutoConnectCommand.Arguments(["--claude-bin", "/tmp/Claude path/claude", "--"] + args)
            #expect(parsed.forwarded == args)
            #expect(ClaudeAutoConnectCommand.disposition(arguments: parsed.forwarded, isTerminal: true) == .direct)
        }
        // Verify the command classification itself, independently of --help.
        for args in maintenance {
            #expect(ClaudeAutoConnectCommand.disposition(arguments: Array(args.prefix(2)), isTerminal: true) == .direct)
        }
    }

    @Test func onlyProvenPreSpawnFailureFallsThroughOnce() throws {
        var launches = 0
        var passthroughs = 0
        let result = try ClaudeAutoConnectCommand.launchWithPreSpawnFallback(launch: {
            launches += 1
            throw ClaudeInstalledLauncher.PreSpawnFailure()
        }, passthrough: {
            passthroughs += 1
            return 23
        })
        #expect(result == 23)
        #expect(launches == 1)
        #expect(passthroughs == 1)

        let exitStatus = try ClaudeAutoConnectCommand.launchWithPreSpawnFallback(launch: { 17 }, passthrough: {
            passthroughs += 1
            return 0
        })
        #expect(exitStatus == 17)
        #expect(passthroughs == 1)
    }

    @Test func detachedLauncherPreservesExactlyOnceFallbackAndResumeArguments() throws {
        let root = URL(fileURLWithPath: "/private/tmp/detached-claude-test")
        let forwarded = ["--resume", "conversation name", "--", "literal --payload-root $(unchanged)"]
        let options = ClaudeInstalledLauncher.Options(ownerSocketPath: root.appendingPathComponent("owner.sock").path,
            sessionSocketPath: root.appendingPathComponent("session.sock").path,
            runtimeIdentity: "sha256:" + String(repeating: "a", count: 64), cwd: root,
            claudeExecutable: root.appendingPathComponent("original/claude"),
            nodeExecutable: root.appendingPathComponent("copied/node"), payloadRoot: root.appendingPathComponent("payload"),
            observeSession: true, claudeArguments: forwarded)
        var launches = 0, fallbacks = 0
        let result = try ClaudeAutoConnectCommand.runAfterRuntimeHandoff(options, launch: { actual in
            launches += 1
            #expect(actual.ownerSocketPath == options.ownerSocketPath)
            #expect(actual.runtimeIdentity == options.runtimeIdentity)
            #expect(actual.claudeArguments == forwarded)
            throw ClaudeInstalledLauncher.PreSpawnFailure()
        }, passthrough: { actual in
            fallbacks += 1
            #expect(actual.executable == options.claudeExecutable)
            #expect(actual.forwarded == forwarded)
            return 23
        })
        #expect(result == 23)
        #expect(launches == 1 && fallbacks == 1)

        enum Failure: Error { case uncertain }
        #expect(throws: Failure.self) {
            try ClaudeAutoConnectCommand.runAfterRuntimeHandoff(options, launch: { _ in
                throw Failure.uncertain
            }, passthrough: { _ in
                fallbacks += 1
                return 0
            })
        }
        #expect(fallbacks == 1)
    }

    @Test func unknownLaunchAndPassthroughFailuresAreNeverRetried() {
        enum Failure: Error { case afterSpawn }
        var passthroughs = 0
        #expect(throws: Failure.self) {
            try ClaudeAutoConnectCommand.launchWithPreSpawnFallback(launch: { throw Failure.afterSpawn }, passthrough: {
                passthroughs += 1
                return 0
            })
        }
        #expect(passthroughs == 0)
        #expect(throws: ClaudeInstalledLauncher.PreSpawnFailure.self) {
            try ClaudeAutoConnectCommand.launchWithPreSpawnFallback(launch: { throw ClaudeInstalledLauncher.PreSpawnFailure() },
                passthrough: {
                    passthroughs += 1
                    throw ClaudeInstalledLauncher.PreSpawnFailure()
                })
        }
        #expect(passthroughs == 1)
    }

    @Test func startupAdmissionFailureFallsThroughOnceWithExactArguments() throws {
        let forwarded = ["--resume", "conversation with $HOME and `backticks`", "--",
                         "literal --settings $(unchanged)", ""]
        let arguments = ["--claude-bin", "/private/tmp/Claude path/claude", "--"] + forwarded
        var admissions = 0, launches = 0, passthroughs = 0
        let result = try ClaudeAutoConnectCommand.runWithStartupAdmission(arguments,
            isTerminal: true, environment: [:], acquireRuntime: { () throws -> Int in
                admissions += 1
                throw CoordinatorError("app_runtime_installation_in_progress")
            }, launch: { _ in
                launches += 1
                return 0
            }, passthrough: { actual in
                passthroughs += 1
                #expect(actual.executable.path == "/private/tmp/Claude path/claude")
                #expect(actual.forwarded == forwarded)
                return 23
            })
        #expect(result == 23)
        #expect(admissions == 1 && launches == 0 && passthroughs == 1)
    }

    @Test func startupMaintenanceExplicitAndNonterminalInvocationsBypassAdmission() throws {
        let cases: [([String], Bool, [String: String])] = [
            (["--version"], true, [:]), (["auth", "login"], true, [:]),
            (["--verbose", "update"], true, [:]), (["mcp", "list"], true, [:]),
            (["--mcp-config", "path with spaces.json"], true, [:]),
            (["--resume", "a conversation"], false, [:]),
            (["--resume", "a conversation"], true, ["CLAUDECODE": "1"])
        ]
        for (forwarded, terminal, environment) in cases {
            var admissions = 0, launches = 0, passthroughs = 0
            let result = try ClaudeAutoConnectCommand.runWithStartupAdmission(
                ["--claude-bin", "/private/tmp/Claude path/claude", "--"] + forwarded,
                isTerminal: terminal, environment: environment, acquireRuntime: { () throws -> Int in
                    admissions += 1
                    throw CoordinatorError("app_runtime_installation_in_progress")
                }, launch: { _ in
                    launches += 1
                    return 0
                }, passthrough: { actual in
                    passthroughs += 1
                    #expect(actual.executable.path == "/private/tmp/Claude path/claude")
                    #expect(actual.forwarded == forwarded)
                    return 17
                })
            #expect(result == 17)
            #expect(admissions == 0 && launches == 0 && passthroughs == 1)
        }
    }

    @Test func startupDispatchErrorsNeverTriggerAnotherClaudeLaunch() throws {
        let arguments = ["--claude-bin", "/private/tmp/claude", "--", "--resume", "conversation"]
        let errors: [any Error] = [
            CoordinatorError("distribution_profile_mismatch"),
            CoordinatorError("unknown_launch_failure"),
            ClaudeInstalledLauncher.PreSpawnFailure()
        ]
        for error in errors {
            var admissions = 0, launches = 0, passthroughs = 0
            #expect(throws: (any Error).self) {
                try ClaudeAutoConnectCommand.runWithStartupAdmission(arguments,
                    isTerminal: true, environment: [:], acquireRuntime: {
                        admissions += 1
                        return 1
                    }, launch: { actual in
                        launches += 1
                        #expect(actual == arguments)
                        throw error
                    }, passthrough: { _ in
                        passthroughs += 1
                        return 0
                    })
            }
            #expect(admissions == 1 && launches == 1 && passthroughs == 0)
        }
    }

    @Test func startupFallbackFailureIsNeverRetried() {
        enum Failure: Error, Equatable { case fallback }
        var admissions = 0, passthroughs = 0
        #expect(throws: Failure.fallback) {
            try ClaudeAutoConnectCommand.runWithStartupAdmission(
                ["--claude-bin", "/private/tmp/claude", "--"],
                isTerminal: true, environment: [:], acquireRuntime: { () throws -> Int in
                    admissions += 1
                    throw CoordinatorError("app_runtime_installation_in_progress")
                }, launch: { _ in
                    Issue.record("admission failure must not reach connected launch")
                    return 0
                }, passthrough: { _ in
                    passthroughs += 1
                    throw Failure.fallback
                })
        }
        #expect(admissions == 1 && passthroughs == 1)
    }

    @Test func invalidStartupArgumentsNeverReachAdmissionOrPassthrough() {
        for arguments in [[], ["--claude-bin", "relative", "--"], ["--claude-bin", "/tmp/claude"],
                          ["--claude-bin", "/tmp/claude", "--", "invalid\0prompt"],
                          ["--claude-bin", "/tmp/clau\0de", "--"]] {
            #expect(throws: CoordinatorError("claude_auto_connect_invalid_arguments")) {
                try ClaudeAutoConnectCommand.runWithStartupAdmission(arguments,
                    isTerminal: true, environment: [:], acquireRuntime: {
                        Issue.record("invalid arguments must not reach admission")
                        return 1
                    }, launch: { _ in
                        Issue.record("invalid arguments must not reach launch")
                        return 0
                    }, passthrough: { _ in
                        Issue.record("invalid arguments must not reach passthrough")
                        return 0
                    })
            }
        }
    }

    @Test func actualInstallerLockUsesStartupFallbackWithoutStartingAChild() throws {
        let fixture = try AutoConnectStartupFixture()
        defer { fixture.remove() }
        let installer = try AppRuntimeUseLease.acquire(executableURL: fixture.runtime, use: .installation)
        defer { withExtendedLifetime(installer) {} }
        var passthroughs = 0
        let result = try ClaudeAutoConnectCommand.runWithStartupAdmission(
            ["--claude-bin", fixture.original.path, "--", "--resume", "conversation"],
            isTerminal: true, environment: [:], acquireRuntime: {
                try AppRuntimeUseLease.acquireCurrent(executableURL: fixture.runtime, verifyRunningCode: { _ in
                    Issue.record("the installer lock must block runtime verification")
                })
            }, launch: { _ in
                Issue.record("the installer lock must block connected launch")
                return 0
            }, passthrough: { actual in
                passthroughs += 1
                let original = try ClaudeAutoConnectCommand.originalExecutable(actual.executable)
                // Foundation may retain /var while realpath returns /private/var.
                // Verify the file's identity independently of URL spelling.
                var observed = stat(), expected = stat()
                #expect(stat(original.path, &observed) == 0)
                #expect(stat(fixture.original.path, &expected) == 0)
                #expect(observed.st_dev == expected.st_dev && observed.st_ino == expected.st_ino)
                #expect(actual.forwarded == ["--resume", "conversation"])
                return 29
            })
        #expect(result == 29 && passthroughs == 1)
    }

    @Test func successfulStartupKeepsRuntimeLeaseThroughLaunchAndReleasesAfterward() throws {
        let fixture = try AutoConnectStartupFixture()
        defer { fixture.remove() }
        let arguments = ["--claude-bin", fixture.original.path, "--", "--resume", "conversation"]
        let result = try ClaudeAutoConnectCommand.runWithStartupAdmission(arguments,
            isTerminal: true, environment: [:], acquireRuntime: {
                try AppRuntimeUseLease.acquireCurrent(executableURL: fixture.runtime, verifyRunningCode: { _ in })
            }, launch: { actual in
                #expect(actual == arguments)
                #expect(throws: AppRuntimeUseLeaseError.busy) {
                    try AppRuntimeUseLease.acquire(executableURL: fixture.runtime, use: .installation)
                }
                return 31
            }, passthrough: { _ in
                Issue.record("successful startup must not fall through")
                return 0
            })
        #expect(result == 31)
        let installer = try AppRuntimeUseLease.acquire(executableURL: fixture.runtime, use: .installation)
        try installer.verify(at: fixture.runtime)
    }

    @Test func startupFallbackStillRejectsInvalidOriginalExecutables() throws {
        let fixture = try AutoConnectStartupFixture()
        defer { fixture.remove() }
        let nonExecutable = try fixture.file("not-executable", mode: 0o600)
        let writable = try fixture.file("writable", mode: 0o777)
        let shim = try fixture.file("Blabee/shell/claude-v1/claude", mode: 0o755)
        for original in [fixture.root.appendingPathComponent("missing"), fixture.root,
                         nonExecutable, writable, fixture.runtime, shim] {
            var admissions = 0
            #expect(throws: CoordinatorError.self) {
                try ClaudeAutoConnectCommand.runWithStartupAdmission(
                    ["--claude-bin", original.path, "--"], isTerminal: true, environment: [:],
                    acquireRuntime: { () throws -> Int in
                        admissions += 1
                        throw CoordinatorError("app_runtime_installation_in_progress")
                    }, launch: { _ in
                        Issue.record("failed admission must not reach connected launch")
                        return 0
                    })
            }
            #expect(admissions == 1)
        }
    }

    @Test func invalidShimArgumentsAreRejected() {
        for args in [[], ["--claude-bin", "relative", "--"], ["--claude-bin", "/tmp/claude"],
                     ["--cwd", "/tmp", "--"], ["--claude-bin", "/tmp/claude", "--resume"],
                     ["--claude-bin", "/tmp/claude", "--", "invalid\0prompt"]] {
            #expect(throws: (any Error).self) { try ClaudeAutoConnectCommand.Arguments(args) }
        }
    }
}

private struct AutoConnectStartupFixture {
    let root: URL
    let runtime: URL
    let original: URL

    init() throws {
        root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("blabee-auto-connect-startup-test-" + UUID().uuidString, isDirectory: true)
        runtime = root.appendingPathComponent("Blabee.app/Contents/MacOS/blabee-coordinator")
        original = root.appendingPathComponent("Claude path/claude")
        _ = try file("Blabee.app/Contents/MacOS/blabee-coordinator", mode: 0o755)
        _ = try file("Claude path/claude", mode: 0o755)
    }

    func file(_ path: String, mode: mode_t) throws -> URL {
        let url = root.appendingPathComponent(path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("isolated fixture, not executed".utf8).write(to: url)
        guard chmod(url.path, mode) == 0 else { throw AppRuntimeUseLeaseError.unavailable }
        return url
    }

    func remove() {
        guard root.lastPathComponent.hasPrefix("blabee-auto-connect-startup-test-") else { return }
        try? FileManager.default.removeItem(at: root)
    }
}
