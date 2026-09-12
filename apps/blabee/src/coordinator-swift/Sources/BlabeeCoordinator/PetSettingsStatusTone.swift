/// Presentation only: each tone describes the evidence for that setting, not end-to-end readiness.
enum PetSettingsStatusTone: Equatable, Sendable {
    case confirmed, actionNeeded, error, neutral

    var label: String {
        switch self {
        case .confirmed: "확인 완료"
        case .actionNeeded: "조치 필요"
        case .error: "오류"
        case .neutral: "미확인·미사용"
        }
    }

    static func appService(_ state: PetAppServiceState) -> Self {
        switch state {
        case .ready: .confirmed
        case .failed: .error
        case .blocked, .stopped: .actionNeeded
        case .disabled, .starting, .stopping, .reconnecting: .neutral
        }
    }

    static func automaticService(
        _ state: PetServiceRegistrationState,
        needsRuntimeAttention: Bool
    ) -> Self {
        // The caller supplies an observed runtime error; registration alone is not running evidence.
        if needsRuntimeAttention { return .error }
        return switch state {
        case .enabled: .confirmed
        case .requiresApproval: .actionNeeded
        case .notRegistered, .notFound, .unknown: .neutral
        }
    }

    static func codexPlugin(_ state: CodexPluginSetupState) -> Self {
        switch state {
        case .installedNeedsHookReview: .confirmed
        case .unchecked: .neutral
        case .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable,
             .legacyInstallationDetected, .unavailable:
            .actionNeeded
        case .conflict, .error: .error
        }
    }

    static func connection(_ readiness: PetConnectionReadiness) -> Self {
        switch readiness.status {
        case .receiving: .confirmed
        case .checking, .awaitingVerification: .neutral
        case .needsSetup, .needsRestart: .actionNeeded
        case .needsAttention:
            readiness.checks.contains { $0.state == .failed } ? .error : .actionNeeded
        }
    }

    static func check(_ state: PetConnectionReadiness.CheckState) -> Self {
        switch state {
        case .confirmed: .confirmed
        case .pending, .checking: .neutral
        case .attention: .actionNeeded
        case .failed: .error
        }
    }
}
