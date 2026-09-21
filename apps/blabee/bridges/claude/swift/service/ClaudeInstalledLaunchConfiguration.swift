import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Foundation

/// Session-only launch data. Capabilities are inherited through the child's
/// environment, never serialized into argv, Hook settings or MCP JSON.
enum ClaudeInstalledLaunchConfiguration {
    static let prefix = "BLABEE_CLAUDE_SESSION_V2_"
    static let serverName = "blabee-claude"
    static let publicEnvironmentNames = ["SOCKET", "RUNTIME_IDENTITY", "CWD", "CHANNEL_SOURCE", "SCOPE_ID",
        "NATIVE_SESSION_ID", "SESSION_INCARNATION", "SERVICE_INCARNATION", "OWNER_CONNECTION_ID", "AUTHORITY_EPOCH"]
    static let terminalScript = """
    on run argv
        if (count of argv) < 2 then error "Invalid Claude launcher arguments"
        set commandText to ""
        repeat with argumentValue in argv
            if commandText is not "" then set commandText to commandText & " "
            set commandText to commandText & quoted form of (contents of argumentValue)
        end repeat
        tell application id "com.apple.Terminal"
            do script commandText
        end tell
    end run
    """

    struct Documents {
        let settings: Data
        let mcp: Data
    }

    static func cleanEnvironment(_ inherited: [String: String]) -> [String: String] {
        var result = inherited.filter { key, _ in
            !key.hasPrefix("BLABEE_") && !key.hasPrefix("DYLD_") && !key.hasPrefix("__XPC_DYLD_") && !key.hasPrefix("LD_")
                && !["NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "CLAUDECODE"].contains(key)
        }
        // Qualified preview candidate only; this affects other MCPs in this
        // child too. It does not edit the user's environment or MCP settings.
        result["MCP_PROTOCOL_NEGOTIATION"] = "legacy"
        return result
    }

    static func documents(nodeExecutable: URL, payloadRoot: URL, nativeSessionID: UUID? = nil,
                          observeSession: Bool = false) throws -> Documents {
        guard observeSession == (nativeSessionID == nil) else { throw failure("configuration_invalid") }
        let hook = payloadRoot.appendingPathComponent(observeSession ? "src/auto-connect-hook.mjs" : "src/session-v2-hook.mjs")
        let mcp = payloadRoot.appendingPathComponent(observeSession ? "src/auto-connect-mcp.mjs" : "src/session-v2-mcp.mjs")
        let binding = nativeSessionID.map { ["--expected-session-id", $0.uuidString.lowercased()] } ?? []
        var hooks: [String: Any] = [:]
        for event in ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"] {
            hooks[event] = [["hooks": [["type": "command", "command": nodeExecutable.path,
                "args": [hook.path] + binding, "timeout": observeSession ? 12 : 5]]]]
        }
        // Stdio clients may inherit only a safe environment subset. Every
        // public binding is explicit; no reliance on ambient BLABEE variables.
        var environment = (publicEnvironmentNames + ["BRIDGE_TOKEN"]).reduce(into: [String: String]()) {
            $0[prefix + $1] = "${" + prefix + $1 + "}"
        }
        environment[prefix + "HOOK_TOKEN"] = ""
        if observeSession {
            // Claude supplies the selected CLAUDE_CODE_SESSION_ID when it
            // spawns each MCP. An explicit env entry here is expanded earlier
            // and would overwrite that actual value with a stale/literal one.
            environment = ["BLABEE_CLAUDE_BOOTSTRAP_SOCKET", "BLABEE_CLAUDE_BOOTSTRAP_CWD",
                           "BLABEE_CLAUDE_BOOTSTRAP_BRIDGE_TOKEN"].reduce(into: [:]) {
                $0[$1] = "${" + $1 + "}"
            }
            environment["BLABEE_CLAUDE_BOOTSTRAP_HOOK_TOKEN"] = ""
            environment[prefix + "HOOK_TOKEN"] = ""
        }
        return try Documents(settings: StrictJSONTransport.data(forJSONObject: ["hooks": hooks]),
            mcp: StrictJSONTransport.data(forJSONObject: ["mcpServers": [serverName: [
                "command": nodeExecutable.path, "args": [mcp.path] + binding,
                "env": environment
            ]]]))
    }

    static func arguments(nativeSessionID: UUID? = nil, settings: URL, mcp: URL,
                          claudeArguments: [String] = []) -> [String] {
        if let nativeSessionID {
            return ["--session-id", nativeSessionID.uuidString.lowercased(), "--settings", settings.path,
                    "--mcp-config", mcp.path, "--dangerously-load-development-channels", "server:" + serverName]
                + claudeArguments
        }
        // Channel and MCP options are variadic. End the injected prefix with
        // the single-value settings option so Claude cannot consume a user's
        // positional prompt as a Channel or MCP configuration. Preserve the
        // entire original argv, including its literal `--`, after that prefix.
        return ["--dangerously-load-development-channels", "server:" + serverName,
                "--mcp-config", mcp.path, "--settings", settings.path] + claudeArguments
    }

    static func supportsVersion(_ output: Data) -> Bool {
        guard output.count <= 16 * 1024, let value = String(data: output, encoding: .utf8),
              let expression = try? NSRegularExpression(pattern: "^([0-9]+)\\.([0-9]+)\\.([0-9]+)(?: \\(Claude Code\\))?\\s*$"),
              let match = expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              match.range.length == value.utf16.count else { return false }
        let parts = (1...3).compactMap { index -> Int? in
            guard let range = Range(match.range(at: index), in: value) else { return nil }
            return Int(value[range])
        }
        // A minimum compatibility gate, not a claim that every later version
        // has passed model/TTY qualification. Major changes require review.
        return parts.count == 3 && parts[0] == 2 && parts[1] >= 1 && (parts[1] > 1 || parts[2] >= 248)
    }

    static func supportsNodeVersion(_ output: Data) -> Bool {
        guard output.count <= 128, let text = String(data: output, encoding: .utf8),
              let expression = try? NSRegularExpression(pattern: "^v([0-9]+)\\.([0-9]+)\\.([0-9]+)\\s*$"),
              let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.range.length == text.utf16.count, let range = Range(match.range(at: 1), in: text),
              let major = Int(text[range]) else { return false }
        return major >= 22
    }

    /// Reads names only and never returns/logs configuration bodies. Existing
    /// servers remain under Claude's normal merge; a name collision is refused.
    static func requireNoMCPCollision(cwd: URL, environment: [String: String],
        managedConfiguration: URL = URL(fileURLWithPath: "/Library/Application Support/ClaudeCode/managed-mcp.json")) throws {
        let home = URL(fileURLWithPath: environment["HOME"] ?? NSHomeDirectory(), isDirectory: true)
        let user = environment["CLAUDE_CONFIG_DIR"].map {
            URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent(".claude.json")
        } ?? home.appendingPathComponent(".claude.json")
        var files = [user, managedConfiguration]
        var parent = cwd
        var gitRoot: URL?
        while true {
            files.append(parent.appendingPathComponent(".mcp.json"))
            if gitRoot == nil, FileManager.default.fileExists(atPath: parent.appendingPathComponent(".git").path) {
                gitRoot = parent
            }
            let next = parent.deletingLastPathComponent()
            if next.path == parent.path { break }
            parent = next
        }
        for file in files {
            guard FileManager.default.fileExists(atPath: file.path) else { continue }
            do {
                let info = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard info.isRegularFile == true, let size = info.fileSize, size <= 2 * 1024 * 1024 else {
                    throw failure("mcp_configuration_unreadable")
                }
                let value = try JSONSerialization.jsonObject(with: Data(contentsOf: file))
                guard let object = value as? [String: Any] else { throw failure("mcp_configuration_unreadable") }
                // Claude rejects --mcp-config whenever a managed file is
                // readable/parseable, even if it names unrelated servers.
                if file == managedConfiguration { throw failure("managed_mcp_configuration_active") }
                let projects = object["projects"] as? [String: Any]
                let keys = Set([cwd.path, gitRoot?.path].compactMap { $0 })
                let local = keys.compactMap { projects?[$0] as? [String: Any] }
                for configuration in [object] + local {
                    if let raw = configuration["mcpServers"] {
                        guard let servers = raw as? [String: Any] else { throw failure("mcp_configuration_unreadable") }
                        if servers[serverName] != nil { throw failure("mcp_name_collision") }
                    }
                }
            } catch let error as CoordinatorError { throw error }
            catch { throw failure("mcp_configuration_unreadable") }
        }
    }

    static func canonicalFile(_ url: URL, executable: Bool = false) throws -> URL {
        let resolved = try canonicalPath(url)
        var info = stat()
        guard lstat(resolved.path, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              (info.st_uid == geteuid() || info.st_uid == 0), info.st_mode & 0o022 == 0,
              !executable || access(resolved.path, X_OK) == 0 else { throw failure("payload_unavailable") }
        return resolved
    }

    static func canonicalDirectory(_ url: URL) throws -> URL {
        let resolved = try canonicalPath(url)
        var info = stat()
        guard lstat(resolved.path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else { throw failure("path_invalid") }
        return resolved
    }

    private static func canonicalPath(_ url: URL) throws -> URL {
        guard url.isFileURL, url.path.hasPrefix("/"), url.path.utf8.count <= 4096,
              !url.path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let raw = realpath(url.path, nil) else { throw failure("path_invalid") }
        defer { free(raw) }
        guard let path = String(validatingCString: raw), ClaudeCanonicalDirectory.isNormalizedAbsolute(path) else {
            throw failure("path_invalid")
        }
        // Foundation standardization can collapse /private aliases differently
        // from the server. Enrollment and Hook cwd use the realpath bytes.
        return URL(fileURLWithPath: path)
    }

    static func failure(_ suffix: String) -> CoordinatorError { CoordinatorError("claude_installed_" + suffix) }
}

/// Only public settings are stored. This directory is owned by one launch and
/// kept until its actual interactive child exits, including after disconnect.
final class ClaudeInstalledConfigurationFiles {
    let directory: URL
    let settings: URL
    let mcp: URL

    init(root: URL?, documents: ClaudeInstalledLaunchConfiguration.Documents) throws {
        let base = try ClaudeInstalledLaunchConfiguration.canonicalDirectory(root ?? FileManager.default.temporaryDirectory)
        var template = Array(base.appendingPathComponent("blabee-claude-XXXXXX").path.utf8CString)
        guard let made = template.withUnsafeMutableBufferPointer({ buffer -> String? in
            guard let value = mkdtemp(buffer.baseAddress!) else { return nil }
            return String(cString: value)
        }) else {
            throw ClaudeInstalledLaunchConfiguration.failure("configuration_unavailable")
        }
        directory = URL(fileURLWithPath: made, isDirectory: true)
        settings = directory.appendingPathComponent("hooks.json")
        mcp = directory.appendingPathComponent("mcp.json")
        do {
            try Self.write(documents.settings, to: settings)
            try Self.write(documents.mcp, to: mcp)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw ClaudeInstalledLaunchConfiguration.failure("configuration_unavailable")
        }
    }

    deinit { try? FileManager.default.removeItem(at: directory) }

    private static func write(_ data: Data, to path: URL) throws {
        let descriptor = open(path.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw ClaudeInstalledLaunchConfiguration.failure("configuration_unavailable") }
        defer { close(descriptor) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let result = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if result < 0 && errno == EINTR { continue }
                guard result > 0 else { throw ClaudeInstalledLaunchConfiguration.failure("configuration_unavailable") }
                offset += result
            }
        }
    }
}
