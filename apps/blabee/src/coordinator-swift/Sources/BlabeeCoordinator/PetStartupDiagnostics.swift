import OSLog

/// Startup diagnostics contain only fixed events, enum states and allowlisted
/// failure codes. Never pass error descriptions, paths or request data here.
enum PetStartupDiagnostics {
    enum Event: String {
        case delegateDidFinishLaunching = "pet_delegate_did_finish_launching"
        case startupFailed = "pet_startup_failed"
        case onboardingReady = "pet_onboarding_ready"
        case onboardingFallback = "pet_onboarding_fallback"
        case appServiceUnavailable = "pet_app_service_unavailable"
        case viewModelReady = "pet_view_model_ready"
        case menuBarReady = "pet_menu_bar_ready"
        case pollingStarted = "pet_polling_started"
        case serviceStartRequested = "app_service_start_requested"
        case serviceChildSpawned = "app_service_child_spawned"
        case serviceLaunchFailed = "app_service_launch_failed"
        case serviceChildExited = "app_service_child_exited"
        case serviceReadinessTimeout = "app_service_readiness_timeout"
        case serviceShutdownRequested = "app_service_shutdown_requested"
    }

    private static let logger = Logger(subsystem: "com.biadone.blabee", category: "startup")

    static func record(_ event: Event) {
        logger.notice("event=\(event.rawValue, privacy: .public)")
    }

    static func recordFailure(_ event: Event, code: String) {
        let safeCode = safeFailureCode(code)
        logger.notice("event=\(event.rawValue, privacy: .public) code=\(safeCode, privacy: .public)")
    }

    static func preference(enabled: Bool) {
        logger.notice("event=app_service_preference enabled=\(enabled, privacy: .public)")
    }

    static func registration(_ state: PetServiceRegistrationState) {
        let code: String = switch state {
        case .notRegistered: "not_registered"
        case .enabled: "enabled"
        case .requiresApproval: "requires_approval"
        case .notFound: "not_found"
        case .unknown: "unknown"
        }
        logger.notice("event=app_service_registration state=\(code, privacy: .public)")
    }

    static func serviceState(_ state: PetAppServiceState) {
        let code: String = switch state {
        case .disabled: "disabled"
        case .stopped: "stopped"
        case .starting: "starting"
        case .ready: "ready"
        case .reconnecting: "reconnecting"
        case .stopping: "stopping"
        case .blocked: "blocked"
        case .failed: "failed"
        }
        logger.notice("event=app_service_state state=\(code, privacy: .public)")
        if case .failed(let failure) = state {
            let safeCode = safeFailureCode(failure)
            logger.notice("event=app_service_failure code=\(safeCode, privacy: .public)")
        }
    }

    private static func safeFailureCode(_ code: String) -> String {
        switch code {
        case "pet_onboarding_unavailable", "pet_startup_failed",
             "app_service_socket_mismatch", "app_service_bundle_unverified",
             "app_service_launch_failed", "app_service_launch_invalid",
             "app_service_pipe_unavailable", "app_service_connection_timeout",
             "app_service_stop_incomplete", "app_service_exited",
             "app_service_shutdown_timeout", "app_service_child_ownership_lost",
             "service_registration_unknown":
            return code
        default:
            // Reuse the existing control-frame allowlist for child startup
            // failures; unknown values become its fixed generic code.
            return AppOwnedServiceControlFrame.failureCode(
                in: AppOwnedServiceControlFrame.failure(code: code)
            ) ?? "app_service_startup_failed"
        }
    }
}
