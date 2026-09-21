import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation

/// Entry from the managed PATH shim. Claude owns its CLI grammar and resume
/// picker; this layer only decides whether this invocation can attach Blabee.
enum ClaudeAutoConnectCommand {
    struct Arguments: Equatable {
        let executable: URL
        let forwarded: [String]

        init(_ arguments: [String]) throws {
            guard arguments.count >= 3, arguments[0] == "--claude-bin",
                  arguments[1].hasPrefix("/"), arguments[2] == "--",
                  arguments.allSatisfy({ !$0.utf8.contains(0) }) else {
                throw CoordinatorError("claude_auto_connect_invalid_arguments")
            }
            executable = URL(fileURLWithPath: arguments[1])
            forwarded = Array(arguments.dropFirst(3))
        }
    }

    enum Disposition: Equatable { case connect, direct, explicitConfiguration }

    static func disposition(arguments: [String], isTerminal: Bool,
                            environment: [String: String] = [:]) -> Disposition {
        guard isTerminal, environment["CLAUDECODE", default: ""].isEmpty else { return .direct }
        let commands: Set<String> = ["auth", "config", "doctor", "install", "mcp", "plugin", "plugins",
            "setup-token", "update", "upgrade", "help", "remote-control", "agents", "attach", "auto-mode",
            "gateway", "import", "logs", "project", "respawn", "rm", "stop", "kill", "ultrareview"]
        let direct: Set<String> = ["--help", "-h", "--version", "-v", "--print", "-p",
            "--output-format", "--input-format", "--init-only", "--maintenance",
            "--bg", "--background", "--cloud", "--environment"]
        let explicit: Set<String> = ["--settings", "--setting-sources", "--mcp-config", "--strict-mcp-config",
            "--channels", "--dangerously-load-development-channels", "--bare", "--safe-mode",
            "--disable-slash-commands", "--remote", "--teleport", "--ide", "--worktree", "-w"]
        // Command words can follow global options. Consume only option shapes
        // whose arity is known; let Claude handle unknown CLI forms directly.
        // A resume name such as "project" or "mcp" is never a subcommand here.
        let sessionSelectors: Set<String> = ["--resume", "-r", "--continue", "-c"]
        let values: Set<String> = ["--model", "--fallback-model", "--permission-mode", "--agent",
            "--system-prompt", "--append-system-prompt", "--session-id", "--name", "-n"]
        let switches: Set<String> = ["--verbose", "--fork-session", "--no-session-persistence",
            "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--chrome", "--no-chrome"]
        var index = 0
        var sessionSelected = false
        var sawPositional = false
        while index < arguments.count {
            let argument = arguments[index]
            if argument == "--" { break }
            if !argument.hasPrefix("-") {
                if !sawPositional && !sessionSelected && commands.contains(argument) { return .direct }
                sawPositional = true
                index += 1
                continue
            }
            let name = String(argument.split(separator: "=", maxSplits: 1).first ?? "")
            if direct.contains(name) { return .direct }
            if explicit.contains(name) { return .explicitConfiguration }
            if sessionSelectors.contains(name) {
                sessionSelected = true
                index += 1
                if ["--resume", "-r"].contains(name), !argument.contains("="), index < arguments.count,
                   !arguments[index].hasPrefix("-") { index += 1 }
            }
            else if values.contains(name) { index += argument.contains("=") ? 1 : 2 }
            else if switches.contains(name) { index += 1 }
            else { return .direct }
        }
        return .connect
    }

    /// Call before acquiring an app-runtime usage lease: help/auth/update and
    /// scripts do not read app resources or start any Blabee service.
    static func passthroughIfNeeded(_ arguments: [String]) throws {
        let parsed = try Arguments(arguments)
        let mode = disposition(arguments: parsed.forwarded,
            isTerminal: isatty(STDIN_FILENO) == 1 && isatty(STDOUT_FILENO) == 1,
            environment: ProcessInfo.processInfo.environment)
        guard mode != .connect else { return }
        if mode == .explicitConfiguration {
            notice("지정한 Claude 실행 설정을 유지하기 위해 이번 실행은 Blabee 자동 연결을 생략합니다.")
        }
        try execOriginal(parsed)
    }

    static func run(_ arguments: [String]) throws -> Int32 {
        let parsed = try Arguments(arguments)
        let options: ClaudeInstalledLauncher.Options
        do {
            let environment = try ProductServiceEnvironment.live()
            guard ProductInvocationResolver.isStandardInstalledApp(environment.invocation),
                  let executable = environment.invocation.executableURL,
                  let bundle = environment.invocation.bundleURL else {
                throw CoordinatorError("claude_auto_connect_installed_app_required")
            }
            let runtimeIdentity = try OperationalRuntimeIdentity.requireCurrent()
            let configuration = try ProductServiceBootstrap.resolve(environment: environment)
            let original = try originalExecutable(parsed.executable)
            let runtime = PetClaudeLauncher.QualifiedRuntime(bundleURL: bundle, coordinatorExecutable: executable,
                service: .init(socketPath: configuration.socketPath, runtimeIdentity: runtimeIdentity),
                claudeCandidates: [original],
                claudeManifestSHA256: try ClaudeInstalledLauncher.signedManifestPin(
                    executable: executable, runtimeIdentity: runtimeIdentity))
            let plan = try PetClaudeLauncher(resolveRuntime: { runtime }).makePlan(
                project: URL(fileURLWithPath: FileManager.default.currentDirectoryPath), service: runtime.service)
            // Enabling the shell connection does not override a disabled or
            // conflicting app-owned service. Open the already opted-in app once.
            guard UserDefaults.standard.bool(forKey: "blabee.appOwnedService.enabled.v1") else {
                throw CoordinatorError("claude_auto_connect_service_disabled")
            }
            try openApplication(bundle)
            try waitForOwnerSocket(plan.ownerSocketPath)
            options = .init(ownerSocketPath: plan.ownerSocketPath, sessionSocketPath: plan.service.socketPath,
                runtimeIdentity: plan.service.runtimeIdentity, cwd: plan.project, claudeExecutable: plan.claudeExecutable,
                nodeExecutable: plan.nodeExecutable, payloadRoot: plan.payloadRoot,
                observeSession: true, claudeArguments: parsed.forwarded)
        } catch {
            // All of this block precedes Claude spawn. Falling through once is
            // safe; never use this fallback after starting an interactive child.
            return try passthroughAfterPreparationFailure(parsed)
        }
        return try launchWithPreSpawnFallback(launch: { try ClaudeInstalledLauncher.run(options) },
            passthrough: { try passthroughAfterPreparationFailure(parsed) })
    }

    /// Only the launcher's explicit proof that no child spawn was attempted
    /// permits starting the original CLI. Unknown or post-spawn errors escape.
    static func launchWithPreSpawnFallback(launch: () throws -> Int32,
                                           passthrough: () throws -> Int32) throws -> Int32 {
        do {
            return try launch()
        } catch is ClaudeInstalledLauncher.PreSpawnFailure {
            return try passthrough()
        }
    }

    private static func passthroughAfterPreparationFailure(_ arguments: Arguments) throws -> Int32 {
        notice("Blabee 자동 연결을 준비하지 못했습니다. Claude는 그대로 시작합니다. Blabee 설정의 연결 상태를 확인하세요.")
        try execOriginal(arguments)
        throw CoordinatorError("claude_auto_connect_exec_failed")
    }

    static func originalExecutable(_ candidate: URL) throws -> URL {
        let executable = try ClaudeInstalledLaunchConfiguration.canonicalFile(candidate, executable: true)
        let current = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        guard executable != current, executable.lastPathComponent != "blabee-coordinator",
              !executable.path.contains("/Blabee/shell/claude-v1/") else {
            throw CoordinatorError("claude_auto_connect_recursive_executable")
        }
        return executable
    }

    private static func execOriginal(_ arguments: Arguments) throws {
        let executable = try originalExecutable(arguments.executable)
        var pointers = ([executable.path] + arguments.forwarded).map { strdup($0) }
        defer { for case let pointer? in pointers { free(pointer) } }
        guard pointers.allSatisfy({ $0 != nil }) else { throw CoordinatorError("claude_auto_connect_exec_failed") }
        pointers.append(nil)
        pointers.withUnsafeMutableBufferPointer { _ = execv(executable.path, $0.baseAddress!) }
        throw CoordinatorError("claude_auto_connect_exec_failed")
    }

    private static func openApplication(_ bundle: URL) throws {
        let result = try ManagedCodexVersionProbeRunner.run(executable: URL(fileURLWithPath: "/usr/bin/open"),
            arguments: ["-g", bundle.path], environment: ClaudeInstalledLaunchConfiguration.cleanEnvironment(
                ProcessInfo.processInfo.environment), timeoutMilliseconds: 5_000, outputLimit: 1024)
        guard result.exitCode == 0, result.terminationSignal == nil else {
            throw CoordinatorError("claude_auto_connect_app_unavailable")
        }
    }

    private static func waitForOwnerSocket(_ path: String) throws {
        let deadline = DispatchTime.now().uptimeNanoseconds + 10_000_000_000
        repeat {
            var info = stat()
            if lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFSOCK,
               info.st_uid == geteuid(), info.st_mode & 0o777 == 0o600 { return }
            usleep(100_000)
        } while DispatchTime.now().uptimeNanoseconds < deadline
        throw CoordinatorError("claude_auto_connect_service_unavailable")
    }

    private static func notice(_ text: String) {
        FileHandle.standardError.write(Data(("[blabee] " + text + "\n").utf8))
    }
}
