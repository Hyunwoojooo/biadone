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
        case .unknown: PetL10n.text("Stage unknown", korean: "단계 미확인")
        case .retryPreparation: PetL10n.text("Preparing recheck", korean: "재검사 준비")
        case .bundledResources: PetL10n.text("Checking app Plugin resources", korean: "앱 Plugin 리소스 확인")
        case .nativeExecutable: PetL10n.text("Checking official Codex executable", korean: "공식 Codex 실행 파일 확인")
        case .marketplaceList: PetL10n.text("Querying Marketplace list", korean: "Marketplace 목록 조회")
        case .pluginList: PetL10n.text("Querying Plugin list", korean: "Plugin 목록 조회")
        case .installationValidation: PetL10n.text("Checking Plugin installation", korean: "Plugin 설치 상태 확인")
        }
    }
}

/// Lexical installation evidence only. A matching path does not authenticate
/// its package, establish a native executable, or authorize execution.
enum CodexInstallationLayout: String, Sendable, Equatable {
    case unknown
    case homebrewCask = "homebrew_cask"
    case homebrewCellar = "homebrew_cellar"
    case npm
    case standalone
    case other

    var title: String {
        switch self {
        case .unknown: PetL10n.text("Installation layout unknown", korean: "설치 경로 유형 미확인")
        case .homebrewCask: PetL10n.text("Homebrew Cask path", korean: "Homebrew Cask 경로")
        case .homebrewCellar: PetL10n.text("Homebrew Cellar path", korean: "Homebrew Cellar 경로")
        case .npm: PetL10n.text("npm package path", korean: "npm 패키지 경로")
        case .standalone: PetL10n.text("Standalone package path", korean: "Standalone 패키지 경로")
        case .other: PetL10n.text("Other installation path", korean: "기타 설치 경로")
        }
    }
}

struct CodexPluginCheckEvidence: Sendable, Equatable {
    var stage: CodexPluginCheckStage = .unknown
    var sourcePath: String?
    var canonicalPath: String?
    var codexVersion: String?
    var errorCode: String?
    var pathDiagnostic: CodexRuntimePathDiagnostic?
    /// Request-local observations describe where a check stopped. Neither an
    /// attempted runner call nor its timing proves a process or task executed.
    var nativeOperation: CodexNativeOperationObservation? = nil

    /// The failing inspection's target takes precedence over a prior successful
    /// structural observation. Neither value is a reusable execution approval.
    var resolvedTargetPath: String? {
        pathDiagnostic?.resolvedTargetPath ?? canonicalPath
    }

    var installationLayout: CodexInstallationLayout {
        CodexInstallationPathObservation.inspect(resolvedTargetPath ?? sourcePath).layout
    }

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
        guard let result else { return PetL10n.text("Checking Codex execution…", korean: "Codex 실행 검사 중…") }
        return result.failed ? PetL10n.text("Last execution check failed", korean: "마지막 실행 검사 실패") : PetL10n.text("Last execution check complete", korean: "마지막 실행 검사 완료")
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
        let nativeOperation = evidence?.nativeOperation
        let os = operatingSystemVersion
        #if arch(arm64)
        let architecture = "arm64"
        #elseif arch(x86_64)
        let architecture = "x86_64"
        #else
        let architecture = "unknown"
        #endif
        return [
            PetL10n.text("Blabee Codex Execution Check", korean: "Blabee Codex 실행 검사"),
            "app_build=\(Self.numericVersion(appBuild))",
            "platform=macOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion) \(architecture)",
            "started_at=\(formatter.string(from: startedAt))",
            "completed_at=\(completedAt.map(formatter.string(from:)) ?? "pending")",
            "elapsed_seconds=\(elapsedSeconds.map { String(format: "%.1f", max(0, $0)) } ?? "pending")",
            "result=\(result?.statusCode ?? "checking")",
            "stage=\(evidence?.stage.rawValue ?? "unknown")",
            "error_code=\(evidence?.errorCode ?? (result?.failed == true ? "unknown" : "none"))",
            "native_stage=\(nativeOperation?.stage.rawValue ?? "unknown")",
            "native_command_invocation_attempted=\(nativeOperation.map { String($0.commandInvocationAttempted) } ?? "unknown")",
            "native_cached_failure=\(nativeOperation.map { String($0.cachedFailure) } ?? "unknown")",
            "native_exit_code=\(nativeOperation?.exitCode.map { String($0) } ?? "unknown")",
            "native_termination_signal=\(nativeOperation?.terminationSignal.map { String($0) } ?? "unknown")",
            "native_elapsed_ms=\(Self.nonnegativeMilliseconds(nativeOperation?.elapsedMilliseconds))",
            "native_preparation_elapsed_ms=\(Self.nonnegativeMilliseconds(nativeOperation?.preparationElapsedMilliseconds))",
            "native_command_elapsed_ms=\(Self.nonnegativeMilliseconds(nativeOperation?.commandElapsedMilliseconds))",
            "path_issue=\(evidence?.pathDiagnostic?.issue.rawValue ?? "unknown")",
            "path_component=\(evidence?.pathDiagnostic?.role.rawValue ?? "unknown")",
            "failed_path=\(Self.redactedPath(evidence?.pathDiagnostic?.path))",
            "codex_version=\(Self.numericVersion(evidence?.codexVersion))",
            "source_path=\(Self.redactedPath(evidence?.sourcePath))",
            "canonical_path=\(Self.redactedPath(evidence?.canonicalPath))",
            "resolved_target_path=\(Self.redactedPath(evidence?.resolvedTargetPath))",
            "installation_layout=\(evidence?.installationLayout.rawValue ?? "unknown")",
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

    private static func nonnegativeMilliseconds(_ value: Int?) -> String {
        guard let value, value >= 0 else { return "unknown" }
        return String(value)
    }

    private static func redactedPath(_ path: String?) -> String {
        CodexInstallationPathObservation.inspect(path).redactedPath
    }
}

private struct CodexInstallationPathObservation {
    let layout: CodexInstallationLayout
    let redactedPath: String

    /// No filesystem access or process launch belongs in layout classification.
    static func inspect(_ path: String?) -> Self {
        guard let path else { return .init(layout: .unknown, redactedPath: "unknown") }
        guard path.hasPrefix("/"), path.utf8.count <= 4096,
              !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { return .init(layout: .unknown, redactedPath: "omitted") }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.dropFirst().allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
        else { return .init(layout: .unknown, redactedPath: "omitted") }

        for prefix in ["/opt/homebrew", "/usr/local"] {
            if [prefix, "\(prefix)/bin", "\(prefix)/bin/codex",
                "\(prefix)/Caskroom", "\(prefix)/Cellar"].contains(path) {
                return .init(layout: .unknown, redactedPath: path)
            }
            if let npm = npmPath(path, root: "\(prefix)/lib/node_modules") { return npm }
            for (directory, layout) in [("Caskroom", CodexInstallationLayout.homebrewCask),
                                         ("Cellar", CodexInstallationLayout.homebrewCellar)] {
                let root = "\(prefix)/\(directory)/codex/"
                guard path.hasPrefix(root) else { continue }
                let suffix = path.dropFirst(root.count).split(separator: "/")
                let executable = suffix.dropFirst().joined(separator: "/")
                let nativeNames = ["bin/codex", "codex", "codex-aarch64-apple-darwin", "codex-x86_64-apple-darwin"]
                guard nativeNames.contains(executable) else {
                    return .init(layout: .other, redactedPath: "\(root)<runtime>")
                }
                return .init(layout: layout, redactedPath: "\(root)<runtime>/\(executable)")
            }
            if path.hasPrefix("\(prefix)/Cellar/") {
                return .init(layout: .other, redactedPath: "\(prefix)/Cellar/<installation>")
            }
        }
        if components.count >= 4, components[1] == "Users" {
            let home = components.prefix(3).joined(separator: "/")
            let suffix = Array(components.dropFirst(3))
            if suffix == [".local", "bin", "codex"] {
                return .init(layout: .unknown, redactedPath: "~/.local/bin/codex")
            }
            if suffix.count == 6, suffix.prefix(3) == [".codex", "packages", "standalone"],
               suffix.suffix(2) == ["bin", "codex"] {
                let runtime = suffix[3] == "current" ? "current" : "<runtime>"
                return .init(layout: .standalone,
                             redactedPath: "~/.codex/packages/standalone/\(runtime)/bin/codex")
            }
            if suffix.count >= 6, suffix.prefix(3) == [".nvm", "versions", "node"] {
                let nodeRoot = "\(home)/.nvm/versions/node/\(suffix[3])"
                if let npm = npmPath(path, root: "\(nodeRoot)/lib/node_modules",
                                     redactedRoot: "~/.nvm/versions/node/<node>/lib/node_modules") { return npm }
                if suffix.suffix(2) == ["bin", "codex"], suffix.count == 6 {
                    return .init(layout: .unknown, redactedPath: "~/.nvm/versions/node/<node>/bin/codex")
                }
            }
            for directory in [".npm-global", ".local"] {
                if let npm = npmPath(path, root: "\(home)/\(directory)/lib/node_modules",
                                     redactedRoot: "~/\(directory)/lib/node_modules") { return npm }
            }
        }
        return .init(layout: .other, redactedPath: "omitted")
    }

    private static func npmPath(_ path: String, root: String, redactedRoot: String? = nil) -> Self? {
        guard path.hasPrefix(root + "/") else { return nil }
        let suffix = String(path.dropFirst(root.count + 1))
        var knownSuffixes = ["@openai/codex/bin/codex.js"]
        for (package, target) in [("codex-darwin-arm64", "aarch64-apple-darwin"),
                                  ("codex-darwin-x64", "x86_64-apple-darwin")] {
            let native = "vendor/\(target)/codex/codex"
            knownSuffixes += ["@openai/codex/\(native)", "@openai/\(package)/\(native)",
                              "@openai/codex/node_modules/@openai/\(package)/\(native)"]
        }
        guard knownSuffixes.contains(suffix) else { return nil }
        // Preserve the known .js or native suffix so a wrapper is not described
        // as a native executable. Signature and all launch checks still apply.
        return .init(layout: .npm, redactedPath: "\(redactedRoot ?? root)/\(suffix)")
    }
}
