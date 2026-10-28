import CoordinatorSwift
import OSLog

/// Permission diagnostics accept only fixed events and allowlisted error codes.
/// Never record command text, paths, session IDs, tokens or error descriptions.
enum HookPermissionDiagnostics {
    enum Event: String, Sendable {
        case received = "permission_hook_received"
        case managedOwnershipBypass = "permission_hook_managed_ownership_bypass"
        case callerQualified = "permission_hook_caller_qualified"
        case callerUnqualified = "permission_hook_caller_unqualified"
        case coordinatorDisabled = "permission_hook_coordinator_disabled"
        case coordinatorDeferred = "permission_hook_coordinator_deferred"
        case responseInvalid = "permission_hook_response_invalid"
        case allowOnceOutputPrepared = "permission_hook_allow_once_output_prepared"
        case denyOutputPrepared = "permission_hook_deny_output_prepared"
        case deliveryAcknowledgementReceived = "permission_hook_delivery_ack_received"
        case deliveryAcknowledgementInvalid = "permission_hook_delivery_ack_invalid"
        case requestFailed = "permission_hook_request_failed"
        case failed = "permission_hook_failed"
    }

    enum FailureCode: String, Sendable {
        case invalidArguments = "invalid_arguments"
        case contractValidationFailed = "contract_validation_failed"
        case threadEventInvalid = "hook_thread_event_invalid"
        case threadIdentityInvalid = "hook_thread_identity_invalid"
        case socketInvalid = "operational_socket_invalid"
        case socketUnavailable = "operational_socket_unavailable"
        case socketUnsafe = "operational_socket_unsafe"
        case connectRefused = "operational_connect_refused"
        case connectFailed = "operational_connect_failed"
        case connectTimeout = "operational_connect_timeout"
        case peerRejected = "operational_peer_rejected"
        case runtimeIdentityInvalid = "operational_runtime_identity_invalid"
        case runtimeIdentityMismatch = "operational_runtime_identity_mismatch"
        case runtimeIdentityUnverified = "operational_runtime_identity_unverified"
        case runtimeRequestNotCompatible = "operational_runtime_request_not_compatible"
        case responseInvalid = "operational_response_invalid"
        case responseTimeout = "operational_response_timeout"
        case transportClosed = "operational_transport_closed"
        case transportFailed = "operational_transport_failed"
        case messageInvalid = "operational_message_invalid"
        case messageTooLarge = "operational_message_too_large"
        case requestTooLarge = "operational_request_too_large"
        case requestFailed = "operational_request_failed"
        case permissionRequestInvalid = "permission_request_invalid"
        case permissionToolInputInvalid = "permission_request_tool_input_invalid"
        case permissionDescriptionInvalid = "permission_request_description_invalid"
        case permissionCommandInvalid = "permission_request_command_invalid"
        case permissionCWDInvalid = "permission_request_cwd_invalid"
        case permissionBindingInvalid = "permission_request_binding_invalid"
        case permissionCapacityExceeded = "permission_request_capacity_exceeded"
        case permissionRequestIDInvalid = "permission_request_id_invalid"
        case permissionSessionIDInvalid = "permission_session_id_invalid"
        case permissionTurnIDInvalid = "permission_turn_id_invalid"
        case deliveryTokenInvalid = "permission_request_delivery_token_invalid"
        case deliveryAcknowledgementInvalid = "permission_request_delivery_ack_invalid"
        case deliveryNotFound = "permission_request_delivery_not_found"
        case deliveryBindingMismatch = "permission_request_delivery_binding_mismatch"
        case deliveryTimeout = "permission_request_delivery_timeout"
        case unknown = "permission_unknown_error"
    }

    private static let logger = Logger(subsystem: "com.biadone.blabee", category: "permission")

    static func record(_ event: Event) {
        logger.notice("event=\(event.rawValue, privacy: .public)")
    }

    static func record(_ event: HookPermissionLifecycleEvent) {
        logger.notice("event=\(event.rawValue, privacy: .public)")
    }

    static func recordFailure(_ event: Event, code: FailureCode) {
        logger.notice("event=\(event.rawValue, privacy: .public) code=\(code.rawValue, privacy: .public)")
    }

    static func failureCode(for error: Error) -> FailureCode {
        guard let error = error as? CoordinatorError else { return .unknown }
        return FailureCode(rawValue: error.code) ?? .unknown
    }
}
