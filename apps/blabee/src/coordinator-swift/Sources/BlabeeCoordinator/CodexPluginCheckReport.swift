import Foundation

/// Evidence from the inspection that actually ran, not another probe of Codex.
enum CodexPluginCheckStage: String, Sendable, Equatable {
    case unknown
    case retryPreparation = "retry_preparation"
    case bundledResources = "bundled_resources"
    case nativeExecutable = "native_executable"
    case marketplaceList = "marketplace_list"
    case pluginList = "plugin_list"
    case installationValidation = "installation_validation"

    var title: String {
        switch self {
        case .unknown: "단계 미확인"
        case .retryPreparation: "재검사 준비"
        case .bundledResources: "앱 Plugin 리소스 확인"
        case .nativeExecutable: "공식 Codex 실행 파일 확인"
        case .marketplaceList: "Marketplace 목록 조회"
        case .pluginList: "Plugin 목록 조회"
        case .installationValidation: "Plugin 설치 상태 확인"
        }
    }
}

struct CodexPluginCheckEvidence: Sendable, Equatable {
    var stage: CodexPluginCheckStage = .unknown
    var sourcePath: String?
    var canonicalPath: String?
    var codexVersion: String?
    var errorCode: String?

    // Diagnostic codes are internal identifiers, never raw process messages.
    static func normalizedCode(_ value: String?) -> String? {
        guard let value else { return nil }
        if CodexNativeDiagnostic(rawValue: value) != nil || exportedCodes.contains(value) {
            return value
        }
        return "codex_plugin_setup_check_failed"
    }

    private static let exportedCodes: Set<String> = [
        "codex_plugin_setup_check_failed", "codex_plugin_setup_operation_timed_out",
        "codex_plugin_setup_bundle_unavailable", "codex_plugin_setup_bundle_identity_invalid",
        "codex_plugin_setup_resources_unavailable", "codex_plugin_setup_resources_invalid",
        "codex_plugin_setup_nonstandard_app_location", "codex_plugin_setup_manifest_unavailable",
        "codex_plugin_setup_marketplace_manifest_invalid", "codex_plugin_setup_plugin_manifest_invalid",
        "codex_plugin_setup_executable_unavailable", "codex_plugin_setup_signature_invalid",
        "codex_plugin_setup_lock_unavailable", "marketplace_list_failed", "marketplace_list_malformed",
        "plugin_list_failed", "plugin_list_malformed", "legacy_installation_identity_unavailable",
        "legacy_installation_identity_changed",
    ]
}

struct CodexPluginCheckResult: Sendable, Equatable {
    let state: CodexPluginSetupState
    let evidence: CodexPluginCheckEvidence

    init(state: CodexPluginSetupState, evidence: CodexPluginCheckEvidence = .init()) {
        self.state = state
        var normalized = evidence
        if case let .error(code) = state { normalized.errorCode = code }
        normalized.errorCode = CodexPluginCheckEvidence.normalizedCode(normalized.errorCode)
        self.evidence = normalized
    }

    var statusCode: String {
        switch state {
        case .unchecked: "unchecked"
        case .unavailable: "unavailable"
        case .notInstalled: "plugin_not_installed"
        case .marketplaceInstalledNeedsPlugin: "marketplace_only"
        case .legacyInstallationDetected: "legacy_plugin_detected"
        case .installedNeedsHookReview: "plugin_installed_hook_trust_unknown"
        case .updateAvailable: "plugin_update_available"
        case .conflict: "installation_conflict"
        case .error: "check_failed"
        }
    }

    var failed: Bool {
        switch state {
        case .error, .unavailable, .conflict: true
        default: false
        }
    }
}

/// Kept separately from passive settings refreshes so a completed explicit
/// check remains visible even when the same error is returned again.
struct CodexPluginRecheckReport: Sendable, Equatable, Identifiable {
    let id: UUID
    let startedAt: Date
    var completedAt: Date?
    var elapsedSeconds: TimeInterval?
    var result: CodexPluginCheckResult?

    init(startedAt: Date = Date()) {
        id = UUID()
        self.startedAt = startedAt
    }

    var isChecking: Bool { completedAt == nil }

    var title: String {
        guard let result else { return "Codex 실행 검사 중…" }
        return result.failed ? "마지막 실행 검사 실패" : "마지막 실행 검사 완료"
    }

    /// This payload deliberately excludes raw state.detail, stderr, environment,
    /// project/session data and full user paths. Only known diagnostic fields
    /// are copied. Local UI may show the exact inspected paths for troubleshooting.
    func sanitizedDiagnosticText(
        appBuild: String?,
        operatingSystemVersion: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion
    ) -> String {
        let formatter = ISO8601DateFormatter()
        let evidence = result?.evidence
        let os = operatingSystemVersion
        #if arch(arm64)
        let architecture = "arm64"
        #elseif arch(x86_64)
        let architecture = "x86_64"
        #else
        let architecture = "unknown"
        #endif
        return [
            "Blabee Codex 실행 검사",
            "app_build=\(Self.numericVersion(appBuild))",
            "platform=macOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion) \(architecture)",
            "started_at=\(formatter.string(from: startedAt))",
            "completed_at=\(completedAt.map(formatter.string(from:)) ?? "pending")",
            "elapsed_seconds=\(elapsedSeconds.map { String(format: "%.1f", max(0, $0)) } ?? "pending")",
            "result=\(result?.statusCode ?? "checking")",
            "stage=\(evidence?.stage.rawValue ?? "unknown")",
            "error_code=\(evidence?.errorCode ?? (result?.failed == true ? "unknown" : "none"))",
            "codex_version=\(Self.numericVersion(evidence?.codexVersion))",
            "source_path=\(Self.redactedPath(evidence?.sourcePath))",
            "canonical_path=\(Self.redactedPath(evidence?.canonicalPath))",
            "hook_trust=not_verified",
            "service_and_selection_roundtrip=not_tested_by_this_check",
        ].joined(separator: "\n")
    }

    private static func numericVersion(_ value: String?) -> String {
        guard let value, !value.isEmpty, value.utf8.count <= 48,
              value.utf8.allSatisfy({ (48...57).contains($0) || $0 == 46 })
        else { return "unknown" }
        return value
    }

    private static func redactedPath(_ path: String?) -> String {
        guard let path else { return "unknown" }
        guard path.hasPrefix("/"), path.utf8.count <= 4096,
              !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { return "omitted" }
        // Recognize only stable installation layouts; arbitrary path components
        // could themselves contain credentials or private project names.
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        if components.count >= 4, components[1] == "Users" {
            let suffix = components.dropFirst(3).joined(separator: "/")
            if suffix == ".local/bin/codex" { return "~/.local/bin/codex" }
            if suffix == ".codex/packages/standalone/current/bin/codex" {
                return "~/.codex/packages/standalone/current/bin/codex"
            }
            if suffix.hasPrefix(".codex/packages/standalone/"), suffix.hasSuffix("/bin/codex") {
                return "~/.codex/packages/standalone/<runtime>/bin/codex"
            }
            if suffix.hasPrefix(".nvm/"), suffix.hasSuffix("/codex") {
                return "~/.nvm/<installation>/codex"
            }
        }
        if ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"].contains(path) { return path }
        if path.hasPrefix("/opt/homebrew/Caskroom/codex/") { return "/opt/homebrew/Caskroom/codex/<runtime>" }
        if path.hasPrefix("/opt/homebrew/Cellar/") { return "/opt/homebrew/Cellar/<installation>" }
        return "omitted"
    }
}
