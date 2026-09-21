import Foundation
import Testing
@testable import BlabeeCoordinator

struct ClaudeAutoConnectCommandTests {
    @Test func resumeArgumentsRemainOwnedByClaude() throws {
        for args in [[], ["--resume"], ["--resume", "a conversation name"], ["--continue"],
                     ["--resume", "00000000-0000-4000-8000-000000000001"],
                     ["--resume", "--fork-session"], ["-r"], ["-c"],
                     ["--model", "sonnet", "a prompt with $HOME and `backticks`"],
                     ["--", "--settings", "literal prompt"], ["--", "--background", "--cloud"]] {
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

    @Test func invalidShimArgumentsAreRejected() {
        for args in [[], ["--claude-bin", "relative", "--"], ["--claude-bin", "/tmp/claude"],
                     ["--cwd", "/tmp", "--"], ["--claude-bin", "/tmp/claude", "--resume"],
                     ["--claude-bin", "/tmp/claude", "--", "invalid\0prompt"]] {
            #expect(throws: (any Error).self) { try ClaudeAutoConnectCommand.Arguments(args) }
        }
    }
}
