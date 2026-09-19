/// The native Hook leaves a finite review window in the Pet, then hands the
/// decision back to Codex. The outer launcher/Hook budgets additionally cover
/// connection, live caller qualification and the one-shot delivery ACK.
public enum HookPermissionTimingPolicy {
    public static let userDecisionTimeoutNanoseconds: UInt64 = 300_000_000_000
    public static let userDecisionTimeoutMilliseconds: Int64 = 300_000
    public static let socketResponseTimeoutMilliseconds: Int32 = 305_000
}

/// Only fixed lifecycle events cross this diagnostic seam. Command contents,
/// paths, session identifiers and delivery tokens must never be logged here.
public enum HookPermissionLifecycleEvent: String, Sendable {
    case admittedRoot = "permission_admitted_root"
    case admittedSubagent = "permission_admitted_subagent"
    case noLiveConsumer = "permission_deferred_no_live_consumer"
    case decisionDeadlineExpired = "permission_deferred_decision_deadline"
    case consumerLeaseExpired = "permission_deferred_consumer_lease"
    case peerCancelled = "permission_peer_cancelled"
    case bindingInvalidated = "permission_deferred_binding_invalidated"
    case superseded = "permission_deferred_superseded"
    case deliveryAcknowledged = "permission_delivery_acknowledged"
    case deliveryTimedOut = "permission_delivery_timed_out"
}
