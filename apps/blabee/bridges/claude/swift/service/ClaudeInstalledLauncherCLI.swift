import CoordinatorSwift
import Darwin
import Foundation

/// Public arguments contain paths/build identity only. Enrollment credentials
/// are issued later over private IPC and never accepted on the command line.
struct ClaudeInstalledLauncherArguments {
    let options: ClaudeInstalledLauncher.Options
    let openTerminal: Bool

    init(_ arguments: [String]) throws {
        let required: Set<String> = ["--owner-socket", "--session-socket", "--runtime-identity", "--cwd",
                                     "--claude-bin", "--node-bin", "--payload-root"]
        let paths = required.subtracting(["--runtime-identity"]).union(["--configuration-root"])
        var values: [String: String] = [:]
        var terminal = false
        var observeSession = false
        var claudeArguments: [String] = []
        var index = 0
        while index < arguments.count {
            let name = arguments[index]
            if name == "--" {
                claudeArguments = Array(arguments.dropFirst(index + 1))
                break
            }
            if name == "--observe-session" {
                guard !observeSession else { throw CoordinatorError("claude_installed_invalid_arguments") }
                observeSession = true
                index += 1
                continue
            }
            if name == "--terminal" {
                guard !terminal else { throw CoordinatorError("claude_installed_invalid_arguments") }
                terminal = true
                index += 1
                continue
            }
            guard required.contains(name) || name == "--configuration-root",
                  values[name] == nil, index + 1 < arguments.count else {
                throw CoordinatorError("claude_installed_invalid_arguments")
            }
            let value = arguments[index + 1]
            guard !value.isEmpty, !value.contains("\0"), value.utf8.count <= 4096,
                  !paths.contains(name) || value.hasPrefix("/") else {
                throw CoordinatorError("claude_installed_invalid_arguments")
            }
            values[name] = value
            index += 2
        }
        guard required.isSubset(of: Set(values.keys)),
              (observeSession || claudeArguments.isEmpty), claudeArguments.count <= 8192,
              claudeArguments.allSatisfy({ !$0.contains("\0") && $0.utf8.count <= 65_536 }),
              claudeArguments.reduce(0, { $0 + $1.utf8.count }) <= 1_048_576,
              OperationalRuntimeIdentity.isValid(values["--runtime-identity"]!) else {
            throw CoordinatorError("claude_installed_invalid_arguments")
        }
        options = ClaudeInstalledLauncher.Options(ownerSocketPath: values["--owner-socket"]!,
            sessionSocketPath: values["--session-socket"]!, runtimeIdentity: values["--runtime-identity"]!,
            cwd: URL(fileURLWithPath: values["--cwd"]!, isDirectory: true),
            claudeExecutable: URL(fileURLWithPath: values["--claude-bin"]!),
            nodeExecutable: URL(fileURLWithPath: values["--node-bin"]!),
            payloadRoot: URL(fileURLWithPath: values["--payload-root"]!, isDirectory: true),
            configurationRoot: values["--configuration-root"].map { URL(fileURLWithPath: $0, isDirectory: true) },
            observeSession: observeSession, claudeArguments: claudeArguments)
        openTerminal = terminal
    }
}

func runClaudeInstalledLauncher(arguments: [String]) throws -> Int32 {
    let parsed = try ClaudeInstalledLauncherArguments(arguments)
    if parsed.openTerminal {
        try ClaudeInstalledLauncher.openInTerminal(parsed.options,
            coordinatorExecutable: URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath())
        return 0
    }
    return try ClaudeInstalledLauncher.run(parsed.options)
}

#if BLABEE_JOURNAL_TEST_HARNESS
/// Only the isolated PTY fixture can use this compiled test entrypoint. Release
/// builds contain neither this entrypoint nor the unsigned peer connection.
func runClaudeInstalledLauncherTest(arguments: [String]) throws -> Int32 {
    let parsed = try ClaudeInstalledLauncherArguments(arguments)
    guard !parsed.openTerminal else { throw CoordinatorError("cp05_fixture_invalid_arguments") }
    let result = try ClaudeInstalledLauncher.runTesting(parsed.options)
    let report: [String: Any] = ["cp05_supervisor": true, "child_status": result,
                               "restored_foreground": tcgetpgrp(STDIN_FILENO) == getpgrp()]
    // A PTY may have echoed ^C without a newline immediately before this report.
    try FileHandle.standardOutput.write(contentsOf: Data([10]) + StrictJSONTransport.data(forJSONObject: report) + Data([10]))
    return result
}

func runClaudePackagedLauncherTest(arguments: [String]) throws -> Int32 {
    guard let store = arguments.first, store.hasPrefix("/"), !store.contains("\0") else {
        throw CoordinatorError("cp07_fixture_invalid_arguments")
    }
    let parsed = try ClaudeInstalledLauncherArguments(Array(arguments.dropFirst()))
    guard !parsed.openTerminal else { throw CoordinatorError("cp07_fixture_invalid_arguments") }
    return try ClaudeInstalledLauncher.runPackagedTesting(parsed.options, storeRootURL: URL(fileURLWithPath: store))
}
#endif
