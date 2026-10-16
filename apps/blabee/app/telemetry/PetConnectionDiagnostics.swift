import Foundation

/// Closed vocabulary only. No process output, paths, prompts or session IDs.
struct PetConnectionDiagnostic: Codable, Equatable, Hashable, Sendable {
    enum Provider: String, Codable, CaseIterable, Sendable { case codex, claude }
    enum Stage: String, Codable, CaseIterable, Sendable {
        case inspection, configuration, transport
        case serviceStart = "service_start", nativeExecutable = "native_executable"
        case pluginCheck = "plugin_check", hookCheck = "hook_check"
        case terminalLaunch = "terminal_launch", sessionHandshake = "session_handshake"
    }
    enum Reason: String, Codable, CaseIterable, Sendable {
        case executableMissing = "executable_missing", executableUnsafe = "executable_unsafe"
        case executableUntrusted = "executable_untrusted", unsupportedVersion = "unsupported_version"
        case runtimeMissing = "runtime_missing", pluginMissing = "plugin_missing"
        case pluginConflict = "plugin_conflict", pluginCheckFailed = "plugin_check_failed"
        case hookUntrusted = "hook_untrusted", unsupportedShell = "unsupported_shell"
        case settingsConflict = "settings_conflict", settingsWriteFailed = "settings_write_failed"
        case serviceUnavailable = "service_unavailable", serviceTimeout = "service_timeout"
        case terminalUnavailable = "terminal_unavailable", launchFailed = "launch_failed"
        case handshakeTimeout = "handshake_timeout", connectionLost = "connection_lost"
        case invalidResponse = "invalid_response", operationFailed = "operation_failed"
    }
    let provider: Provider
    let stage: Stage
    let reason: Reason
    let toolVersion: String

    init(provider: Provider, stage: Stage, reason: Reason, toolVersion: String = "unknown") {
        self.provider = provider; self.stage = stage; self.reason = reason
        self.toolVersion = PetErrorEnvironment.normalizedVersion(toolVersion)
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(provider: try values.decode(Provider.self, forKey: .provider),
                  stage: try values.decode(Stage.self, forKey: .stage),
                  reason: try values.decode(Reason.self, forKey: .reason),
                  toolVersion: try values.decode(String.self, forKey: .toolVersion))
    }

    static func codex(_ state: CodexPluginSetupState, stage: Stage,
                      version: String = "unknown") -> Self? {
        let reason: Reason
        switch state {
        case .error(let code):
            switch code {
            case "codex_native_not_installed", "codex_plugin_setup_executable_unavailable": reason = .executableMissing
            case "codex_native_path_unsafe": reason = .executableUnsafe
            case "codex_native_signature_invalid", "codex_native_notarization_unavailable", "codex_native_binary_changed": reason = .executableUntrusted
            case "codex_native_version_unqualified": reason = .unsupportedVersion
            case "codex_native_probe_timeout", "codex_plugin_setup_operation_timed_out": reason = .serviceTimeout
            case "codex_native_probe_output_invalid", "marketplace_list_malformed", "plugin_list_malformed": reason = .invalidResponse
            default: reason = .pluginCheckFailed
            }
        case .conflict: reason = .pluginConflict
        case .unavailable: reason = .runtimeMissing
        // Missing installation is expected before setup, but not after a write.
        case .notInstalled, .marketplaceInstalledNeedsPlugin:
            guard stage == .configuration else { return nil }
            reason = .pluginMissing
        default: return nil
        }
        return .init(provider: .codex, stage: stage, reason: reason, toolVersion: version)
    }

    static func claude(_ inspection: ClaudeAutoConnectSetup.Inspection, stage: Stage) -> Self? {
        guard !inspection.automaticConnectionReady else { return nil }
        guard let issue = inspection.issue else {
            return stage == .configuration
                ? .init(provider: .claude, stage: stage, reason: .settingsWriteFailed) : nil
        }
        let reason: Reason = switch issue {
        case .executableUnavailable, .savedExecutableUnavailable: .executableMissing
        case .installedRuntimeUnavailable: .runtimeMissing
        case .unsupportedShell: .unsupportedShell
        case .manualReview: .settingsConflict
        }
        return .init(provider: .claude, stage: stage, reason: reason)
    }
}
