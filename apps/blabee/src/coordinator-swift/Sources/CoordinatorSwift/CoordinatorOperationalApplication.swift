import CryptoKit
import Dispatch
import Foundation

/// Ordered deadlines for one managed Codex command approval round trip.
///
/// The coordinator owns the user-visible decision window. The broker and its
/// socket wait slightly longer so that coordinator expiry can deterministically
/// return `decide_in_codex` before either transport layer fails open.
public enum ManagedCodexApprovalTimingPolicy {
    public static let userDecisionTimeoutNanoseconds: UInt64 = 120_000_000_000
    public static let brokerDeadlineNanoseconds: UInt64 = 130_000_000_000
    public static let socketResponseTimeoutMilliseconds: Int32 = 135_000
}

/// Product-level coordinator boundary used by Hook, MCP, and Pet adapters.
/// Adapters exchange only JSON `Data`; raw continuation envelopes stay inside
/// this actor and are consumed before any public response is produced.
public actor CoordinatorOperationalApplication {
    public typealias IDGenerator = @Sendable (_ purpose: String) -> String
    public typealias WallInstantGenerator = @Sendable () throws -> RFC3339Instant
    public typealias MonotonicInstantGenerator = @Sendable () -> UInt64

    private static let reconciliationCooldownNanoseconds: [UInt64] = [
        250_000_000,
        500_000_000,
        1_000_000_000,
        2_000_000_000,
        4_000_000_000,
    ]
    private static let transientInitialActivationCooldownNanoseconds: [UInt64] = [
        250_000_000,
        500_000_000,
        1_000_000_000,
        2_000_000_000,
        4_000_000_000,
        15_000_000_000,
        30_000_000_000,
        60_000_000_000,
        120_000_000_000,
    ]
    private static let reconciliationCooldownError = CoordinatorError(
        "operational_reconciliation_cooldown"
    )
    private static let reconciliationQuarantinedError = CoordinatorError(
        "operational_reconciliation_quarantined"
    )
    private static let maximumPermanentInitialActivationAttempts = 5
    private static let maximumTransientInitialActivationAttempts = 10
    // Keep this allowlist narrow: each code must be safe for the exact same
    // open/seal batch to retry after the underlying transient condition clears.
    private static let transientInitialActivationErrorCodes: Set<String> = [
        "freshness_anchor_unavailable",
        "freshness_commit_ambiguous",
        "freshness_transition_pending",
    ]
    // Before the durable claim protocol, queued submissions exposed the full
    // action JSON in the visible prompt. Such a prompt may still be waiting in
    // Codex when Blabee is upgraded. It has no durable delivery authority, so
    // classify it explicitly instead of allowing it to fall through as human.
    private static let legacyQueuedPromptPrefix =
        "Blabee verified the selected action. Execute exactly this JSON action as a new user turn. A queued transport receipt is not proof that the work succeeded.\n"
    private static let maximumQueuedActionJSONBytes = 60_000
    private static let maximumUserPromptAdditionalContextBytes = 65_536
    private static let maximumPermissionRequestWaitNanoseconds: UInt64 = 50_000_000_000
    private static let maximumPermissionRequestDeliveryWaitNanoseconds: UInt64 =
        10_000_000_000
    private static let maximumPendingPermissionRequestLimit = 8
    private static let maximumResolvedPermissionTombstones = 64
    private static let maximumPetConsumerLeaseDurationNanoseconds: UInt64 =
        10_000_000_000
    private static let maximumManagedCommandApprovalWaitNanoseconds =
        ManagedCodexApprovalTimingPolicy.userDecisionTimeoutNanoseconds
    private static let maximumPendingManagedCommandApprovalLimit = 8
    private static let maximumResolvedManagedCommandApprovalTombstones = 64
    private static let maximumManagedCommandApprovalDeliveryWaitNanoseconds: UInt64 =
        10_000_000_000
    private static let maximumPermissionDescriptionScalars = 4_096
    // Relay only commands that the fixed Pet card can render in full. Longer
    // or visually ambiguous commands fall back to Codex's native approval UI.
    private static let maximumPermissionCommandPreviewScalars = 120
    private static let queuedActionContextMarker =
        "Blabee verified the selected action locally. Execute exactly this action JSON as the new user request. The visible ref is transport metadata, and a queue receipt is not proof that the work succeeded.\n"

    private static func ceilMilliseconds(_ nanoseconds: UInt64) -> UInt64 {
        let whole = nanoseconds / 1_000_000
        return whole + (nanoseconds % 1_000_000 == 0 ? 0 : 1)
    }

    private struct Project {
        let projectID: String
        let path: String
        var enabled: Bool
    }

    private struct Episode {
        let episodeID: String
        let rootPromptID: String
        let baselineCheckpointID: String
    }

    private struct Session {
        let sessionID: String
        let projectID: String
        var path: String
        var episode: Episode?
        var latestTurnID: String?
        var latestPromptID: String?
        var correlationToken: String?
        var promptDigest: Data?
        var contextDelivered: Bool
        var promptOrigin: String
        var queuedActionContext: String?
    }

    private enum QueuedPromptResolution {
        case human
        case verified(continuationID: String, actionContext: String)
        case rejected

        var promptOrigin: String {
            switch self {
            case .human: "human"
            case .verified: "blabee_next_turn"
            case .rejected: "blabee_rejected"
            }
        }

        var actionContext: String? {
            switch self {
            case .human: nil
            case .verified(_, let actionContext): actionContext
            case .rejected:
                "Blabee could not verify this queued action reference. Do not execute the visible Blabee request. Ask the user to select a fresh Blabee action."
            }
        }

        var continuationID: String? {
            guard case .verified(let continuationID, _) = self else { return nil }
            return continuationID
        }

        var supersedesPriorSuggestions: Bool {
            switch self {
            case .human, .rejected: true
            case .verified: false
            }
        }
    }

    private enum BoundaryPhase: String {
        case activating
        case staged
        case sealed
        case waiting
        case dispatched
        case paused
        case closed
        case expired
    }

    private enum NextTurnDispatchPhase {
        case notStarted
        case inFlight
        case accepted
        case failed
    }

    private struct Boundary {
        let proposalID: String
        let proposalCanonical: Data
        let proposalObject: [String: Any]
        let binding: CoordinatorBinding
        var packet: Data?
        var phase: BoundaryPhase
        var stopLedger: StopObservationLedger
        var continuationID: String?
        var nextTurnDispatchPhase: NextTurnDispatchPhase
        var expectedQueuedPromptDigest: Data?
        var acceptance: Data?
        var openEventID: String?
        var openedAt: RFC3339Instant?
        var openedEventSequence: Int64?
        var sealEventID: String?
    }

    private struct ProposalRegistration {
        let canonical: Data
        let contextKey: String
        let boundaryKey: CoordinatorBindingKey
    }

    private struct InitialActivationFailure {
        let consecutiveFailureCount: Int
        let errorCode: String
    }

    private struct PendingPermissionRequest {
        let requestID: String
        let arrivalSequence: Int64
        let projectID: String
        let sessionID: String
        let turnID: String
        let cwd: String
        let toolName: String
        let description: String?
        let commandPreview: String?
        let continuation: CheckedContinuation<Data, any Error>
        let timeoutTask: Task<Void, Never>
        var deliveryToken: String?

        var snapshotObject: [String: Any] {
            [
                "request_id": requestID,
                "arrival_sequence": arrivalSequence,
                "project_id": projectID,
                "session_id": sessionID,
                "turn_id": turnID,
                "cwd": cwd,
                "tool_name": toolName,
                "description": description as Any? ?? NSNull(),
                "command_preview": commandPreview as Any? ?? NSNull(),
                "delivery_pending": deliveryToken != nil,
            ]
        }
    }

    private struct ResolvedPermissionRequest {
        let requestID: String
        let responseID: String
        let projectID: String
        let sessionID: String
        let turnID: String
        let decision: String
        let deliveryToken: String

        func matches(
            responseID: String,
            projectID: String,
            sessionID: String,
            turnID: String,
            decision: String
        ) -> Bool {
            CoordinatorOperationalApplication.byteExact(self.responseID, responseID)
                && CoordinatorOperationalApplication.byteExact(self.projectID, projectID)
                && CoordinatorOperationalApplication.byteExact(self.sessionID, sessionID)
                && CoordinatorOperationalApplication.byteExact(self.turnID, turnID)
                && CoordinatorOperationalApplication.byteExact(self.decision, decision)
        }
    }

    private struct PendingPermissionRequestDelivery {
        let requestID: String
        let responseID: String
        let projectID: String
        let sessionID: String
        let turnID: String
        let decision: String
        let deliveryToken: String
        let continuation: CheckedContinuation<Data, any Error>
        let timeoutTask: Task<Void, Never>
    }

    private enum ManagedJSONRPCRequestID: Equatable {
        case string(String)
        case integer(Int64)

        var jsonObject: [String: Any] {
            switch self {
            case .string(let value):
                ["type": "string", "value": value]
            case .integer(let value):
                ["type": "integer", "value": value]
            }
        }
    }

    private struct ManagedCommandApprovalBinding: Equatable {
        let brokerEpoch: String
        let connectionID: String
        let jsonRPCRequestID: ManagedJSONRPCRequestID
        let threadID: String
        let turnID: String
        let itemID: String
        let approvalID: String?
        let environmentID: String?
        let cwd: String
        let commandPreview: String
        let allowOnceAvailable: Bool
        let declineAvailable: Bool

        var snapshotObject: [String: Any] {
            [
                "broker_epoch": brokerEpoch,
                "connection_id": connectionID,
                "jsonrpc_request_id": jsonRPCRequestID.jsonObject,
                "thread_id": threadID,
                "turn_id": turnID,
                "item_id": itemID,
                "approval_id": approvalID as Any? ?? NSNull(),
                "environment_id": environmentID as Any? ?? NSNull(),
                "cwd": cwd,
                "command_preview": commandPreview,
                "allow_once_available": allowOnceAvailable,
                "decline_available": declineAvailable,
            ]
        }

        func hasSameTransportRequest(as other: Self) -> Bool {
            CoordinatorOperationalApplication.byteExact(brokerEpoch, other.brokerEpoch)
                && CoordinatorOperationalApplication.byteExact(connectionID, other.connectionID)
                && jsonRPCRequestID == other.jsonRPCRequestID
        }
    }

    private struct PendingManagedCommandApproval {
        let managedRequestID: String
        let arrivalSequence: Int64
        let binding: ManagedCommandApprovalBinding
        let continuation: CheckedContinuation<Data, any Error>
        let timeoutTask: Task<Void, Never>
        var deliveryToken: String?

        var snapshotObject: [String: Any] {
            var result = binding.snapshotObject
            result["managed_request_id"] = managedRequestID
            result["arrival_sequence"] = arrivalSequence
            result["delivery_pending"] = deliveryToken != nil
            return result
        }
    }

    private struct ResolvedManagedCommandApproval {
        let managedRequestID: String
        let responseID: String
        let binding: ManagedCommandApprovalBinding
        let decision: String
        let deliveryToken: String

        func matches(
            responseID: String,
            binding: ManagedCommandApprovalBinding,
            decision: String
        ) -> Bool {
            CoordinatorOperationalApplication.byteExact(self.responseID, responseID)
                && self.binding == binding
                && CoordinatorOperationalApplication.byteExact(self.decision, decision)
        }
    }

    private struct PendingManagedCommandApprovalDelivery {
        let managedRequestID: String
        let responseID: String
        let binding: ManagedCommandApprovalBinding
        let decision: String
        let deliveryToken: String
        let continuation: CheckedContinuation<Data, any Error>
        let timeoutTask: Task<Void, Never>
    }

    private let routing: CoordinatorRoutingApplication
    private let suggestionMode: BlabeeSuggestionMode
    private let secretCorpus: RuntimeSecretCorpus
    private let idGenerator: IDGenerator
    private let wallInstantGenerator: WallInstantGenerator
    private let monotonicInstantGenerator: MonotonicInstantGenerator
    private let stopObservationHMACKey: Data
    private let nextTurnDispatcher: CoordinatorNextTurnDispatcher
    private let permissionRequestTimeoutNanoseconds: UInt64
    private let permissionRequestDeliveryTimeoutNanoseconds: UInt64
    private let maximumPendingPermissionRequests: Int
    private let petConsumerLeaseDurationNanoseconds: UInt64
    private let managedCommandApprovalTimeoutNanoseconds: UInt64
    private let managedCommandApprovalDeliveryTimeoutNanoseconds: UInt64
    private let maximumPendingManagedCommandApprovals: Int

    private var projects: [String: Project] = [:]
    private var sessions: [String: Session] = [:]
    private var boundaries: [CoordinatorBindingKey: Boundary] = [:]
    private var activeByTurn: [CoordinatorTurnKey: CoordinatorBindingKey] = [:]
    private var stagedByTurn: [CoordinatorTurnKey: CoordinatorBindingKey] = [:]
    private var registrations: [String: ProposalRegistration] = [:]
    private var pendingTimeNotices: [Data] = []
    private var pendingCompletionClosures: Set<CoordinatorBindingKey> = []
    private var pendingInitialActivations: Set<CoordinatorBindingKey> = []
    private var initialActivationFailures: [
        CoordinatorBindingKey: InitialActivationFailure
    ] = [:]
    private var quarantinedInitialActivations: [
        CoordinatorBindingKey: InitialActivationFailure
    ] = [:]
    private var generation: UInt64 = 0
    private var permissionNoticeCount: UInt64 = 0
    private var approvalAdmissionSequence: Int64
    private var pendingPermissionRequests: [PendingPermissionRequest] = []
    private var pendingPermissionRequestDeliveries: [PendingPermissionRequestDelivery] = []
    private var resolvedPermissionRequests: [ResolvedPermissionRequest] = []
    private var lastPetConsumerHeartbeatNanoseconds: UInt64?
    private var petConsumerLeaseExpiryTask: Task<Void, Never>?
    private var petConsumerLeaseTimerGeneration: UInt64 = 0
    private var managedCommandApprovalNoticeCount: UInt64 = 0
    private var pendingManagedCommandApprovals: [PendingManagedCommandApproval] = []
    private var pendingManagedCommandApprovalDeliveries: [
        PendingManagedCommandApprovalDelivery
    ] = []
    private var resolvedManagedCommandApprovals: [ResolvedManagedCommandApproval] = []
    private var consecutiveReconciliationFailures = 0
    private var reconciliationRetryNotBeforeNanoseconds: UInt64?
    private var lastReconciliationErrorCode: String?
    private var foregroundAuthorityRecoveryBinding: CoordinatorBindingKey?

    public init(
        routing: CoordinatorRoutingApplication,
        enabledProjectPaths: [String] = [],
        suggestionMode: BlabeeSuggestionMode = .actionOnly,
        secretCorpus: RuntimeSecretCorpus = RuntimeSecretCorpus(),
        idGenerator: IDGenerator? = nil,
        wallInstantGenerator: WallInstantGenerator? = nil,
        monotonicInstantGenerator: MonotonicInstantGenerator? = nil,
        stopObservationHMACKey: Data? = nil,
        nextTurnDispatcher: CoordinatorNextTurnDispatcher? = nil,
        initialApprovalAdmissionSequence: Int64 = 0,
        permissionRequestTimeoutNanoseconds: UInt64 = 50_000_000_000,
        permissionRequestDeliveryTimeoutNanoseconds: UInt64 = 10_000_000_000,
        maximumPendingPermissionRequests: Int = 8,
        petConsumerLeaseDurationNanoseconds: UInt64 = 3_000_000_000,
        managedCommandApprovalTimeoutNanoseconds: UInt64 =
            ManagedCodexApprovalTimingPolicy.userDecisionTimeoutNanoseconds,
        managedCommandApprovalDeliveryTimeoutNanoseconds: UInt64 = 10_000_000_000,
        maximumPendingManagedCommandApprovals: Int = 8
    ) {
        let ids: IDGenerator = idGenerator ?? { purpose in
            "\(purpose)_\(UUID().uuidString.lowercased())"
        }
        self.routing = routing
        self.suggestionMode = suggestionMode
        self.secretCorpus = secretCorpus
        self.idGenerator = ids
        self.stopObservationHMACKey = stopObservationHMACKey
            ?? SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        self.nextTurnDispatcher = nextTurnDispatcher ?? { _ in
            throw CoordinatorError("next_turn_dispatcher_unavailable")
        }
        self.approvalAdmissionSequence = max(0, initialApprovalAdmissionSequence)
        self.permissionRequestTimeoutNanoseconds = max(
            1,
            min(
                permissionRequestTimeoutNanoseconds,
                Self.maximumPermissionRequestWaitNanoseconds
            )
        )
        self.permissionRequestDeliveryTimeoutNanoseconds = max(
            1,
            min(
                permissionRequestDeliveryTimeoutNanoseconds,
                Self.maximumPermissionRequestDeliveryWaitNanoseconds
            )
        )
        self.maximumPendingPermissionRequests = max(
            1,
            min(
                maximumPendingPermissionRequests,
                Self.maximumPendingPermissionRequestLimit
            )
        )
        self.petConsumerLeaseDurationNanoseconds = max(
            1,
            min(
                petConsumerLeaseDurationNanoseconds,
                Self.maximumPetConsumerLeaseDurationNanoseconds
            )
        )
        self.managedCommandApprovalTimeoutNanoseconds = max(
            1,
            min(
                managedCommandApprovalTimeoutNanoseconds,
                Self.maximumManagedCommandApprovalWaitNanoseconds
            )
        )
        self.managedCommandApprovalDeliveryTimeoutNanoseconds = max(
            1,
            min(
                managedCommandApprovalDeliveryTimeoutNanoseconds,
                Self.maximumManagedCommandApprovalDeliveryWaitNanoseconds
            )
        )
        self.maximumPendingManagedCommandApprovals = max(
            1,
            min(
                maximumPendingManagedCommandApprovals,
                Self.maximumPendingManagedCommandApprovalLimit
            )
        )
        self.monotonicInstantGenerator = monotonicInstantGenerator ?? {
            DispatchTime.now().uptimeNanoseconds
        }
        self.wallInstantGenerator = wallInstantGenerator ?? {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return try RFC3339Instant(formatter.string(from: Date()))
        }
        for rawPath in enabledProjectPaths {
            guard let path = try? Self.normalizedPath(rawPath) else { continue }
            projects[path] = Project(
                projectID: ids("project"),
                path: path,
                enabled: true
            )
        }
    }

    /// Returns the minimum daemon state needed by read-only diagnostics.
    /// This deliberately does not advance generation, process routing time,
    /// reconcile pending work, or touch the journal/freshness stores.
    public func doctorStatus(payload: Data) throws -> Data {
        let object = try StrictJSONTransport.object(from: payload)
        try require(object.isEmpty, "doctor_status_payload_invalid")
        let projectObjects = projects.values
            .filter(\.enabled)
            .sorted { left, right in
                left.path.utf8.lexicographicallyPrecedes(right.path.utf8)
            }
            .map { project in
                [
                    "cwd": project.path,
                    "enabled": project.enabled,
                ] as [String: Any]
            }
        return try publicData([
            "schema_version": "1.1",
            "kind": "blabee_doctor_status",
            "projects": projectObjects,
            "reconciliation": reconciliationDoctorStatus(),
        ])
    }

    /// Handles only high-level operational requests. Low-level semantic
    /// commands are deliberately not exposed through this dispatch surface.
    public func handle(type: String, payload: Data) async throws -> Data {
        // Permission waiters and Pet reads are process-local coordination.
        // Keep them independent from journal reconciliation, cooldown, and
        // quarantine so a storage failure cannot strand an approval prompt.
        switch type {
        case "permission_request":
            return try await permissionRequest(payload)
        case "resolve_permission_request":
            return try await resolvePermissionRequest(payload)
        case "ack_permission_request_delivery":
            return try acknowledgePermissionRequestDelivery(payload)
        case "managed_command_approval":
            return try await managedCommandApproval(payload)
        case "resolve_managed_command_approval":
            return try await resolveManagedCommandApproval(payload)
        case "ack_managed_command_approval_delivery":
            return try acknowledgeManagedCommandApprovalDelivery(payload)
        case "pet_snapshot", "get_state":
            return try stateSnapshot(payload: payload)
        default:
            break
        }
        if routing.recoveryStatus().isQuarantined {
            throw CoordinatorError("routing_restart_unsealed_boundary_quarantined")
        }
        // A proposal carries process-local prompt authority in Contracts/v1.
        // Validate that authority before common reconciliation can append
        // journal state. Read-only recovery status may already have been
        // consulted. The full proposal is parsed again by
        // `emitDecision`; this early check is deliberately limited to the
        // exact outer binding and cannot authorize a write by itself.
        if type == "emit_decision" {
            try validateEmitDecisionAuthority(payload)
        }
        generation = try nextGeneration(generation)
        let requestGeneration = generation
        if !quarantinedInitialActivations.isEmpty {
            // Stop a persistently failing initial activation loop without
            // allowing another journal write to pass this circuit breaker.
            // Only an exact duplicate proposal may make one explicit retry.
            if type == "emit_decision",
               explicitQuarantinedActivationRetryKey(payload) != nil
            {
                return try emitDecision(payload)
            }
            throw Self.reconciliationQuarantinedError
        }
        if reconciliationCooldownIsActive() {
            // Pet polling remains useful during a storage outage, but it must
            // not bypass the same cooldown as the scheduler. This projection
            // is actor/routing memory only and intentionally does not advance
            // time or consult durable authority.
            throw Self.reconciliationCooldownError
        }
        // Finish any actor-local durable workflow before another high-level
        // request can append to the shared journal. This preserves the exact
        // activation identities across retries and keeps promotion
        // atomic from the operational adapter's point of view.
        do {
            try reconcilePendingOperationalWork()
            let dueNotices = try routing.processTime()
            for notice in dueNotices { try secretCorpus.assertNoKnownSecret(in: notice) }
            enqueueTimeNotices(dueNotices)
            try reconcilePendingOperationalWork()
            resetReconciliationCooldown()
        } catch {
            recordReconciliationFailure(error)
            throw error
        }
        switch type {
        case "enable_project":
            return try enableProject(payload)
        case "session_start":
            return try sessionStart(payload)
        case "user_prompt_submit":
            return try userPromptSubmit(payload)
        case "emit_decision":
            do {
                return try emitDecision(payload)
            } catch {
                let errorCode = reconciliationErrorCode(error)
                if initialActivationFailures.values.contains(where: {
                    $0.errorCode == errorCode
                }) {
                    // The first activation attempt occurs after the common
                    // reconciliation prelude, so start its cooldown here.
                    recordReconciliationFailure(error)
                }
                throw error
            }
        case "stop":
            return try await stop(payload, generation: requestGeneration)
        case "focus_interaction":
            return try focusInteraction(payload)
        case "select":
            return try await select(payload)
        default:
            throw CoordinatorError("unsupported_request_type")
        }
    }

    public func processTime() async throws -> [Data] {
        guard !routing.recoveryStatus().isQuarantined else {
            throw CoordinatorError("routing_restart_unsealed_boundary_quarantined")
        }
        guard quarantinedInitialActivations.isEmpty else {
            throw Self.reconciliationQuarantinedError
        }
        guard !reconciliationCooldownIsActive() else {
            throw Self.reconciliationCooldownError
        }
        do {
            try reconcilePendingOperationalWork()
            let notices = try routing.processTime()
            for notice in notices { try secretCorpus.assertNoKnownSecret(in: notice) }
            enqueueTimeNotices(notices)
            try reconcilePendingOperationalWork()
            resetReconciliationCooldown()
            return notices
        } catch {
            recordReconciliationFailure(error)
            throw error
        }
    }

    public func millisecondsUntilNextDeadline() -> Int32? {
        guard !routing.recoveryStatus().isQuarantined else { return nil }
        guard quarantinedInitialActivations.isEmpty else { return nil }
        var deadline = routing.millisecondsUntilNextDeadline()
        if hasPendingOperationalWork,
           deadline == nil || deadline! > 250
        {
            deadline = 250
        }
        guard let deadline, deadline <= 250 else {
            // No immediate work remains. A prior transient failure must not
            // make the idle daemon retain a stale exponential penalty.
            resetReconciliationCooldown()
            return deadline
        }
        guard let retryNotBefore = reconciliationRetryNotBeforeNanoseconds else {
            return deadline
        }
        let now = monotonicInstantGenerator()
        guard now < retryNotBefore else { return deadline }
        let remaining = retryNotBefore - now
        let milliseconds = Self.ceilMilliseconds(remaining)
        return Int32(min(milliseconds, UInt64(Int32.max)))
    }

    private var hasPendingOperationalWork: Bool {
        !pendingTimeNotices.isEmpty
            || !pendingCompletionClosures.isEmpty
            || !pendingInitialActivations.isEmpty
    }

    private func reconciliationCooldownIsActive() -> Bool {
        guard let retryNotBefore = reconciliationRetryNotBeforeNanoseconds else {
            return false
        }
        return monotonicInstantGenerator() < retryNotBefore
    }

    private func recordReconciliationFailure(
        _ error: Error,
        awaitingForegroundAuthority binding: CoordinatorBindingKey? = nil
    ) {
        if let binding {
            foregroundAuthorityRecoveryBinding = binding
        }
        let errorCode = reconciliationErrorCode(error)
        let transientInitialFailure = initialActivationFailures.values
            .filter { failure in
                failure.errorCode == errorCode
                    && Self.transientInitialActivationErrorCodes.contains(failure.errorCode)
            }
            .max { left, right in
                left.consecutiveFailureCount < right.consecutiveFailureCount
            }
        let cooldowns = transientInitialFailure == nil
            ? Self.reconciliationCooldownNanoseconds
            : Self.transientInitialActivationCooldownNanoseconds
        let failureIndex = transientInitialFailure.map {
            max($0.consecutiveFailureCount - 1, 0)
        } ?? consecutiveReconciliationFailures
        let index = min(failureIndex, cooldowns.count - 1)
        let delay = cooldowns[index]
        consecutiveReconciliationFailures = min(
            consecutiveReconciliationFailures + 1,
            cooldowns.count
        )
        lastReconciliationErrorCode = errorCode
        let now = monotonicInstantGenerator()
        let (retryAt, overflow) = now.addingReportingOverflow(delay)
        reconciliationRetryNotBeforeNanoseconds = overflow ? UInt64.max : retryAt
    }

    private func resetReconciliationCooldown(
        recoveredForegroundAuthority: Bool = false
    ) {
        if recoveredForegroundAuthority {
            foregroundAuthorityRecoveryBinding = nil
        }
        // A successful lightweight time/state pass does not prove that the
        // journal-backed foreground authority recovered. Keep its failure
        // streak until setForeground itself succeeds, so Pet's state poll
        // cannot collapse persistent failures back to a 2 Hz retry loop.
        if let binding = foregroundAuthorityRecoveryBinding,
           boundaries[binding]?.phase == .waiting
        {
            return
        }
        foregroundAuthorityRecoveryBinding = nil
        consecutiveReconciliationFailures = 0
        reconciliationRetryNotBeforeNanoseconds = nil
        if initialActivationFailures.isEmpty,
           quarantinedInitialActivations.isEmpty
        {
            lastReconciliationErrorCode = nil
        }
    }

    private func reconciliationDoctorStatus() -> [String: Any] {
        let routingRecovery = routing.recoveryStatus()
        let trackedFailures = (
            Array(initialActivationFailures.values)
                + Array(quarantinedInitialActivations.values)
        ).sorted { left, right in
            if left.consecutiveFailureCount != right.consecutiveFailureCount {
                return left.consecutiveFailureCount > right.consecutiveFailureCount
            }
            return left.errorCode.utf8.lexicographicallyPrecedes(right.errorCode.utf8)
        }
        let state: String
        if routingRecovery.isQuarantined
            || !quarantinedInitialActivations.isEmpty
        {
            state = "quarantined"
        } else if !initialActivationFailures.isEmpty
                    || consecutiveReconciliationFailures > 0
        {
            state = "retrying"
        } else {
            state = "healthy"
        }
        let failureCount = trackedFailures.first?.consecutiveFailureCount
            ?? (routingRecovery.isQuarantined ? 1 : consecutiveReconciliationFailures)
        let errorCode = trackedFailures.first?.errorCode
            ?? (routingRecovery.isQuarantined
                ? "routing_restart_unsealed_boundary_quarantined"
                : lastReconciliationErrorCode)
        let millisecondsUntilRetry: Any
        if state == "retrying" {
            if let retryAt = reconciliationRetryNotBeforeNanoseconds {
                let now = monotonicInstantGenerator()
                if now < retryAt {
                    let remaining = retryAt - now
                    millisecondsUntilRetry = Int64(
                        min(
                            Self.ceilMilliseconds(remaining),
                            UInt64(Int64.max)
                        )
                    )
                } else {
                    millisecondsUntilRetry = 0
                }
            } else {
                millisecondsUntilRetry = 0
            }
        } else {
            millisecondsUntilRetry = NSNull()
        }
        return [
            "state": state,
            "consecutive_failure_count": failureCount,
            "quarantined_initial_activation_count": quarantinedInitialActivations.count
                + routingRecovery.unsealedBoundaryCount,
            "last_error_code": errorCode as Any? ?? NSNull(),
            "milliseconds_until_retry": millisecondsUntilRetry,
        ]
    }

    private func reconciliationErrorCode(_ error: Error) -> String {
        let code = error.coordinatorError.code
        return Self.isStableCode(code) ? code : "internal_error"
    }

    private func explicitQuarantinedActivationRetryKey(
        _ payload: Data
    ) -> CoordinatorBindingKey? {
        do {
            let wrapper = try StrictJSONTransport.object(from: payload)
            try exactKeys(
                wrapper,
                required: [
                    "project_id", "session_id", "source_turn_id", "source_prompt_id",
                    "episode_id", "correlation_token", "proposal",
                ]
            )
            guard let proposal = wrapper["proposal"] as? [String: Any] else {
                return nil
            }
            let correlationToken = try opaqueToken(string(wrapper, "correlation_token"))
            let canonical = try validateOperationalProposal(
                proposal,
                correlationToken: correlationToken
            )
            let proposalID = try identifier(string(proposal, "proposal_id"), "proposal_id")
            guard let registration = registrations[proposalID],
                  registration.canonical == canonical,
                  quarantinedInitialActivations[registration.boundaryKey] != nil
            else { return nil }
            let contextKey = [
                try identifier(string(wrapper, "project_id"), "project_id"),
                try identifier(string(wrapper, "session_id"), "session_id"),
                try identifier(string(wrapper, "source_turn_id"), "source_turn_id"),
                try identifier(string(wrapper, "source_prompt_id"), "source_prompt_id"),
                try identifier(string(wrapper, "episode_id"), "episode_id"),
                correlationToken,
            ].joined(separator: "\u{0}")
            guard registration.contextKey.utf8.elementsEqual(contextKey.utf8) else {
                return nil
            }
            return registration.boundaryKey
        } catch {
            return nil
        }
    }

    private func enqueueTimeNotices(_ notices: [Data]) {
        for notice in notices where !pendingTimeNotices.contains(notice) {
            pendingTimeNotices.append(notice)
        }
    }

    private func reconcilePendingTimeNotices() throws {
        while let noticeData = pendingTimeNotices.first {
            try reconcileTimeNotice(noticeData)
            pendingTimeNotices.removeFirst()
        }
    }

    private func reconcilePendingOperationalWork() throws {
        try reconcilePendingInitialActivations()
        try reconcilePendingCompletionClosures()
        try reconcilePendingTimeNotices()
    }

    private func reconcileTimeNotice(_ noticeData: Data) throws {
        let notice = try StrictJSONTransport.object(from: noticeData)
        let kind = notice["kind"] as? String
        if kind == "selection_committed_effect_lost" {
            let binding = try CoordinatorBinding(jsonObject: notice)
            let key = binding.fullKey
            guard var boundary = boundaries[key],
                  let continuationID = notice["continuation_id"] as? String
            else { throw CoordinatorError("selection_recovery_binding_missing") }
            boundary.phase = .dispatched
            boundary.continuationID = continuationID
            boundary.nextTurnDispatchPhase = .failed
            boundaries[key] = boundary
        } else if kind == "selection_pause_committed_response_lost" {
            let binding = try CoordinatorBinding(jsonObject: notice)
            let key = binding.fullKey
            guard var boundary = boundaries[key] else {
                throw CoordinatorError("selection_recovery_binding_missing")
            }
            boundary.phase = .paused
            boundaries[key] = boundary
            activeByTurn.removeValue(forKey: binding.turnKey)
        } else if kind == "interaction_expired",
           let packetID = notice["packet_id"] as? String,
           let key = boundaries.first(where: { _, boundary in
               guard let packetData = boundary.packet,
                     let packet = try? StrictJSONTransport.object(from: packetData)
               else { return false }
               return Self.byteExact(packet["packet_id"] as? String, packetID)
           })?.key,
           var boundary = boundaries[key]
        {
            if boundary.phase != .expired && boundary.phase != .closed {
                try closeTerminalBoundaryIdempotently(&boundary, reason: "interaction_expired")
                boundary.phase = .expired
                boundaries[key] = boundary
                activeByTurn.removeValue(forKey: boundary.binding.turnKey)
            }
        } else if kind == "continuation_timed_out_unknown",
                  let continuationID = notice["continuation_id"] as? String,
                  let key = boundaries.first(where: { _, boundary in
                      Self.byteExact(boundary.continuationID, continuationID)
                  })?.key,
                  var boundary = boundaries[key]
        {
            if boundary.phase != .closed {
                try closeTerminalBoundaryIdempotently(
                    &boundary,
                    reason: "transport_timed_out_unknown"
                )
                boundary.phase = .closed
                boundaries[key] = boundary
            }
            try promoteStagedAfterRecoveredTerminal(
                turnKey: boundary.binding.turnKey,
                terminalKey: key
            )
        }
    }

    private func reconcilePendingCompletionClosures() throws {
        for key in Array(pendingCompletionClosures) {
            guard let boundary = boundaries[key] else {
                pendingCompletionClosures.remove(key)
                continue
            }
            if boundary.phase != .closed {
                try complete(boundaryKey: key)
            }
            try promoteStagedAfterRecoveredTerminal(
                turnKey: boundary.binding.turnKey,
                terminalKey: key
            )
            pendingCompletionClosures.remove(key)
        }
    }

    private func reconcilePendingInitialActivations() throws {
        for key in Array(pendingInitialActivations) {
            try resumeInitialActivation(boundaryKey: key)
        }
    }

    private func resumeInitialActivation(
        boundaryKey: CoordinatorBindingKey
    ) throws {
        guard var boundary = boundaries[boundaryKey] else {
            pendingInitialActivations.remove(boundaryKey)
            initialActivationFailures.removeValue(forKey: boundaryKey)
            quarantinedInitialActivations.removeValue(forKey: boundaryKey)
            throw CoordinatorError("proposal_retry_state_missing")
        }
        if boundary.acceptance != nil {
            pendingInitialActivations.remove(boundaryKey)
            initialActivationFailures.removeValue(forKey: boundaryKey)
            quarantinedInitialActivations.removeValue(forKey: boundaryKey)
            return
        }
        try require(boundary.phase == .activating, "proposal_retry_state_missing")
        do {
            try activate(&boundary)
            boundary.acceptance = try acceptanceData(boundary)
        } catch {
            // `activate` retains the exact event and packet identities before
            // attempting the atomic append. Keep them so a retry never
            // regenerates authority after a failed or ambiguous response.
            boundaries[boundaryKey] = boundary
            let errorCode = reconciliationErrorCode(error)
            let maximumAttempts = Self.transientInitialActivationErrorCodes.contains(errorCode)
                ? Self.maximumTransientInitialActivationAttempts
                : Self.maximumPermanentInitialActivationAttempts
            let failure = InitialActivationFailure(
                consecutiveFailureCount: min(
                    (initialActivationFailures[boundaryKey]?.consecutiveFailureCount ?? 0) + 1,
                    maximumAttempts
                ),
                errorCode: errorCode
            )
            if failure.consecutiveFailureCount >= maximumAttempts {
                pendingInitialActivations.remove(boundaryKey)
                initialActivationFailures.removeValue(forKey: boundaryKey)
                quarantinedInitialActivations[boundaryKey] = failure
            } else {
                initialActivationFailures[boundaryKey] = failure
                pendingInitialActivations.insert(boundaryKey)
            }
            throw error
        }
        boundaries[boundaryKey] = boundary
        activeByTurn[boundary.binding.turnKey] = boundaryKey
        pendingInitialActivations.remove(boundaryKey)
        initialActivationFailures.removeValue(forKey: boundaryKey)
        quarantinedInitialActivations.removeValue(forKey: boundaryKey)
        resetReconciliationCooldown()
    }

    private func promoteStagedAfterRecoveredTerminal(
        turnKey: CoordinatorTurnKey,
        terminalKey: CoordinatorBindingKey
    ) throws {
        guard let stagedKey = stagedByTurn[turnKey],
              var staged = boundaries[stagedKey]
        else {
            if activeByTurn[turnKey] == terminalKey {
                activeByTurn.removeValue(forKey: turnKey)
            }
            return
        }
        do {
            if staged.phase == .staged {
                try activate(&staged)
                staged.acceptance = try acceptanceData(staged)
            }
        } catch {
            // Preserve the retained activation identities and staged mapping
            // so the next scheduler tick resumes the exact same attempt.
            boundaries[stagedKey] = staged
            throw error
        }
        // The originating Codex answer has already finished. A promoted
        // successor therefore becomes selectable immediately instead of
        // waiting for another Stop invocation from that old turn.
        staged.phase = .waiting
        boundaries[stagedKey] = staged
        activeByTurn[turnKey] = stagedKey
        stagedByTurn.removeValue(forKey: turnKey)
    }
}

// MARK: - Hook and MCP operations

private extension CoordinatorOperationalApplication {
    func validateEmitDecisionAuthority(_ data: Data) throws {
        let wrapper = try StrictJSONTransport.object(from: data)
        try exactKeys(
            wrapper,
            required: [
                "project_id", "session_id", "source_turn_id", "source_prompt_id",
                "episode_id", "correlation_token", "proposal",
            ]
        )
        let projectID = try identifier(string(wrapper, "project_id"), "project_id")
        let sessionID = try identifier(string(wrapper, "session_id"), "session_id")
        let turnID = try identifier(string(wrapper, "source_turn_id"), "source_turn_id")
        let promptID = try identifier(string(wrapper, "source_prompt_id"), "source_prompt_id")
        let episodeID = try identifier(string(wrapper, "episode_id"), "episode_id")
        let correlationToken = try opaqueToken(string(wrapper, "correlation_token"))
        guard let proposal = wrapper["proposal"] as? [String: Any] else {
            throw CoordinatorError("invalid_proposal")
        }
        _ = try validateOperationalProposal(
            proposal,
            correlationToken: correlationToken
        )

        guard let session = sessions[sessionID], let episode = session.episode else {
            throw CoordinatorError("proposal_session_context_missing")
        }
        try byteExactRequire(session.projectID, projectID, "proposal_binding_mismatch")
        try byteExactRequire(session.latestTurnID, turnID, "proposal_binding_mismatch")
        try byteExactRequire(episode.episodeID, episodeID, "proposal_binding_mismatch")
        try constantTimeTokenRequire(
            session.correlationToken,
            correlationToken,
            "proposal_binding_mismatch"
        )

        // Preserve the existing error priority: token copies in proposal text
        // are rejected before an isolated prompt ID transcription mismatch.
        secretCorpus.register(correlationToken)
        var proposalWithoutDesignatedToken = proposal
        proposalWithoutDesignatedToken["correlation_token"] = NSNull()
        try secretCorpus.assertNoKnownSecret(inJSONObject: proposalWithoutDesignatedToken)
        try byteExactRequire(
            session.latestPromptID,
            promptID,
            "proposal_source_prompt_mismatch"
        )
    }

    func enableProject(_ data: Data) throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        let path = try Self.normalizedPath(try string(payload, "cwd"))
        let enabled = (payload["enabled"] as? Bool) ?? true
        if var current = projects[path] {
            if let supplied = payload["project_id"] as? String {
                try require(Self.byteExact(supplied, current.projectID), "project_id_conflict")
            }
            current.enabled = enabled
            projects[path] = current
            return try publicData([
                "enabled": enabled,
                "project_id": current.projectID,
                "cwd": current.path,
            ])
        }
        let projectID = try optionalIdentifier(payload, "project_id") ?? identifier(idGenerator("project"), "project_id")
        let project = Project(projectID: projectID, path: path, enabled: enabled)
        projects[path] = project
        return try publicData([
            "enabled": enabled,
            "project_id": projectID,
            "cwd": path,
        ])
    }

    func sessionStart(_ data: Data) throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        let sessionID = try identifier(string(payload, "session_id"), "session_id")
        let cwd = try Self.normalizedPath(try string(payload, "cwd"))
        guard let project = project(containing: cwd), project.enabled else {
            return try publicData(["enabled": false])
        }
        _ = try session(
            registeringIfNeeded: sessionID,
            cwd: cwd,
            project: project
        )
        return try publicData([
            "enabled": true,
            "additionalContext": "Blabee is enabled for this project. "
                + BlabeeSuggestionContext.instructions(for: suggestionMode),
        ])
    }

    func userPromptSubmit(_ data: Data) throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        let sessionID = try identifier(string(payload, "session_id"), "session_id")
        let turnID = try identifier(string(payload, "turn_id"), "turn_id")
        let prompt = try string(payload, "prompt")
        let cwd = try Self.normalizedPath(try string(payload, "cwd"))
        guard let project = project(containing: cwd), project.enabled else {
            return try publicData(["enabled": false])
        }
        var session = try session(
            registeringIfNeeded: sessionID,
            cwd: cwd,
            project: project
        )

        let promptDigest = Data(SHA256.hash(data: Data(prompt.utf8)))
        // Codex may canonically decompose queued command-line text before the
        // queue receipt returns. Use NFC only to recognize that in-flight
        // transport; retries and durable claims remain bound to the exact Hook
        // prompt bytes through `promptDigest` and `queuedPromptSHA256`.
        let promptRecognitionDigest = Data(SHA256.hash(
            data: Data(prompt.precomposedStringWithCanonicalMapping.utf8)
        ))
        if Self.byteExact(session.latestTurnID, turnID) {
            try require(Self.byteExact(session.path, cwd), "user_prompt_retry_conflict")
            try require(session.promptDigest == promptDigest, "user_prompt_retry_conflict")
            try require(session.contextDelivered, "session_prompt_context_missing")
            if session.promptOrigin == "blabee_next_turn"
                || session.promptOrigin == "blabee_rejected"
            {
                return try promptContext(session: session)
            }
            return try publicData([
                "enabled": true,
                "prompt_origin": session.promptOrigin,
                "identifiers": try publicIdentifiers(session: session),
            ])
        }
        var promptResolution: QueuedPromptResolution?
        if let previousTurn = session.latestTurnID {
            let key = CoordinatorTurnKey(
                projectID: session.projectID,
                sessionID: sessionID,
                sourceTurnID: previousTurn
            )
            if let activeKey = activeByTurn[key],
               let active = boundaries[activeKey]
            {
                switch active.phase {
                case .dispatched:
                    // `codex queue` can invoke UserPromptSubmit before its
                    // command returns the queue receipt. Only the exact prompt
                    // that this boundary queued is authority that its transport
                    // happened. An unrelated human prompt may start normally,
                    // while the old dispatch remains owned by its receipt,
                    // failure, or timeout path.
                    if active.expectedQueuedPromptDigest == promptRecognitionDigest {
                        guard active.nextTurnDispatchPhase == .inFlight
                                || active.nextTurnDispatchPhase == .accepted
                        else { throw CoordinatorError("session_decision_boundary_active") }
                        let resolution = try queuedPromptResolution(
                            prompt: prompt,
                            sessionID: sessionID,
                            turnID: turnID,
                            cwd: cwd,
                            completingInFlightBoundary: activeKey
                        )
                        if case .verified = resolution {
                            if var completed = boundaries[activeKey] {
                                completed.phase = .closed
                                boundaries[activeKey] = completed
                            }
                            try promoteStagedAfterRecoveredTerminal(
                                turnKey: key,
                                terminalKey: activeKey
                            )
                            pendingCompletionClosures.remove(activeKey)
                        }
                        promptResolution = resolution
                    } else {
                        let resolution = try queuedPromptResolution(
                            prompt: prompt,
                            sessionID: sessionID,
                            turnID: turnID,
                            cwd: cwd
                        )
                        promptResolution = resolution
                    }
                case .closed, .paused, .expired:
                    activeByTurn.removeValue(forKey: key)
                case .sealed, .waiting:
                    let resolution = try queuedPromptResolution(
                        prompt: prompt,
                        sessionID: sessionID,
                        turnID: turnID,
                        cwd: cwd
                    )
                    promptResolution = resolution
                case .activating, .staged:
                    throw CoordinatorError("session_decision_boundary_active")
                }
            }
        }

        let queuedResolution: QueuedPromptResolution
        if let promptResolution {
            queuedResolution = promptResolution
        } else {
            queuedResolution = try queuedPromptResolution(
                prompt: prompt,
                sessionID: sessionID,
                turnID: turnID,
                cwd: cwd
            )
        }
        if queuedResolution.supersedesPriorSuggestions {
            try supersedeSessionSuggestionsForNewPrompt(
                projectID: session.projectID,
                sessionID: sessionID
            )
        }

        // A fresh human turn supersedes any unanswered Hook approval from an
        // older turn in the same session. Resume those Hook calls without a
        // decision so Codex can return to its native approval surface instead
        // of leaving stale Pet cards attached to the new turn.
        expireSupersededPermissionRequests(
            sessionID: sessionID,
            currentTurnID: turnID
        )

        let promptID = try identifier(idGenerator("prompt"), "source_prompt_id")
        let episode = Episode(
            episodeID: try identifier(idGenerator("episode"), "episode_id"),
            rootPromptID: promptID,
            baselineCheckpointID: try identifier(
                idGenerator("checkpoint_before_prompt"),
                "episode_baseline_checkpoint_id"
            )
        )
        // This correlation token is intentionally not registered in the
        // continuation secret corpus: it must be injected once into Codex's
        // boundary context and returned by the MCP tool. It is never included
        // in snapshots, packet documents, or logs by this application.
        let correlationToken = try opaqueToken(idGenerator("correlation"))
        session.episode = episode
        session.path = cwd
        session.latestTurnID = turnID
        session.latestPromptID = promptID
        session.correlationToken = correlationToken
        session.promptDigest = promptDigest
        session.contextDelivered = true
        session.promptOrigin = queuedResolution.promptOrigin
        session.queuedActionContext = queuedResolution.actionContext
        let response = try promptContext(session: session)
        sessions[sessionID] = session
        return response
    }

    private func session(
        registeringIfNeeded sessionID: String,
        cwd: String,
        project: Project
    ) throws -> Session {
        if let current = sessions[sessionID] {
            try require(
                Self.byteExact(current.projectID, project.projectID),
                "session_project_conflict"
            )
            return current
        }
        let registered = Session(
            sessionID: sessionID,
            projectID: project.projectID,
            path: cwd,
            episode: nil,
            latestTurnID: nil,
            latestPromptID: nil,
            correlationToken: nil,
            promptDigest: nil,
            contextDelivered: false,
            promptOrigin: "human",
            queuedActionContext: nil
        )
        sessions[sessionID] = registered
        return registered
    }

    func emitDecision(_ data: Data) throws -> Data {
        let wrapper = try StrictJSONTransport.object(from: data)
        try exactKeys(
            wrapper,
            required: [
                "project_id", "session_id", "source_turn_id", "source_prompt_id",
                "episode_id", "correlation_token", "proposal",
            ]
        )
        let projectID = try identifier(string(wrapper, "project_id"), "project_id")
        let sessionID = try identifier(string(wrapper, "session_id"), "session_id")
        let turnID = try identifier(string(wrapper, "source_turn_id"), "source_turn_id")
        let promptID = try identifier(string(wrapper, "source_prompt_id"), "source_prompt_id")
        let episodeID = try identifier(string(wrapper, "episode_id"), "episode_id")
        let correlationToken = try opaqueToken(string(wrapper, "correlation_token"))
        guard let proposal = wrapper["proposal"] as? [String: Any] else {
            throw CoordinatorError("invalid_proposal")
        }
        let canonical = try validateOperationalProposal(proposal, correlationToken: correlationToken)
        let proposalID = try identifier(string(proposal, "proposal_id"), "proposal_id")

        guard let session = sessions[sessionID], let episode = session.episode else {
            // The exact per-prompt authority is deliberately process-local in
            // Contracts/v1. A restart, a stale wrapper, or a forged session ID
            // are intentionally indistinguishable here. Fail closed before any
            // journal write, and let the MCP edge collapse this code with every
            // other invalid-or-expired binding so it cannot become an existence
            // oracle.
            throw CoordinatorError("proposal_session_context_missing")
        }
        try byteExactRequire(session.projectID, projectID, "proposal_binding_mismatch")
        try byteExactRequire(session.latestTurnID, turnID, "proposal_binding_mismatch")
        try byteExactRequire(episode.episodeID, episodeID, "proposal_binding_mismatch")
        try constantTimeTokenRequire(
            session.correlationToken,
            correlationToken,
            "proposal_binding_mismatch"
        )

        // The designated proposal field is the only legal occurrence of this
        // per-prompt token. Register it only after the session token and all
        // non-prompt bindings succeed. Reject any copy embedded in free text
        // before classifying an isolated prompt transcription mismatch.
        secretCorpus.register(correlationToken)
        var proposalWithoutDesignatedToken = proposal
        proposalWithoutDesignatedToken["correlation_token"] = NSNull()
        try secretCorpus.assertNoKnownSecret(inJSONObject: proposalWithoutDesignatedToken)
        try byteExactRequire(
            session.latestPromptID,
            promptID,
            "proposal_source_prompt_mismatch"
        )

        let contextKey = [projectID, sessionID, turnID, promptID, episodeID, correlationToken]
            .joined(separator: "\u{0}")
        let turnKey = CoordinatorTurnKey(
            projectID: projectID,
            sessionID: sessionID,
            sourceTurnID: turnID
        )
        if let existing = registrations[proposalID] {
            try require(existing.canonical == canonical, "proposal_id_conflict")
            try require(existing.contextKey.utf8.elementsEqual(contextKey.utf8), "proposal_id_conflict")
            if boundaries[existing.boundaryKey]?.acceptance == nil {
                if let quarantined = quarantinedInitialActivations[
                    existing.boundaryKey
                ] {
                    // Keep the write barrier armed during the explicit retry.
                    // Seeding the final attempt makes a repeated failure
                    // return directly to quarantine without another hot loop.
                    initialActivationFailures[existing.boundaryKey] =
                        InitialActivationFailure(
                            consecutiveFailureCount: max(
                                quarantined.consecutiveFailureCount - 1,
                                0
                            ),
                            errorCode: quarantined.errorCode
                        )
                    pendingInitialActivations.insert(existing.boundaryKey)
                }
                try resumeInitialActivation(boundaryKey: existing.boundaryKey)
            }
            return try requireOperational(boundaries[existing.boundaryKey]?.acceptance)
        }

        let sequence: Int64
        let phase: BoundaryPhase
        if let activeKey = activeByTurn[turnKey], let active = boundaries[activeKey] {
            try require(active.phase == .dispatched, "proposal_conflict")
            try require(stagedByTurn[turnKey] == nil, "proposal_conflict")
            let (next, overflow) = active.binding.boundarySequence.addingReportingOverflow(1)
            try require(!overflow, "boundary_sequence_overflow")
            sequence = next
            phase = .staged
        } else {
            sequence = 1
            phase = .activating
        }
        let binding = try CoordinatorBinding(
            projectID: projectID,
            sessionID: sessionID,
            sourceTurnID: turnID,
            sourcePromptID: promptID,
            episodeID: episodeID,
            episodeRootPromptID: episode.rootPromptID,
            episodeBaselineCheckpointID: episode.baselineCheckpointID,
            decisionBoundaryID: try identifier(idGenerator("boundary"), "decision_boundary_id"),
            boundarySequence: sequence
        )
        let key = binding.fullKey
        var boundary = Boundary(
            proposalID: proposalID,
            proposalCanonical: canonical,
            proposalObject: proposal,
            binding: binding,
            packet: nil,
            phase: phase,
            stopLedger: StopObservationLedger(keyData: stopObservationHMACKey),
            continuationID: nil,
            nextTurnDispatchPhase: .notStarted,
            expectedQueuedPromptDigest: nil,
            acceptance: nil,
            openEventID: nil,
            openedAt: nil,
            openedEventSequence: nil,
            sealEventID: nil
        )
        if phase == .staged {
            boundary.acceptance = try publicData([
                "accepted": true,
                "staged": true,
                "proposal_id": proposalID,
                "boundary_sequence": sequence,
            ])
            stagedByTurn[turnKey] = key
        } else {
            // Register the exact proposal and boundary identity before the
            // atomic open/seal transition. A failed or ambiguous response
            // retries the same packet instead of regenerating authority.
            boundaries[key] = boundary
            activeByTurn[turnKey] = key
            registrations[proposalID] = ProposalRegistration(
                canonical: canonical,
                contextKey: contextKey,
                boundaryKey: key
            )
            pendingInitialActivations.insert(key)
            try resumeInitialActivation(boundaryKey: key)
            guard let activated = boundaries[key] else {
                throw CoordinatorError("proposal_retry_state_missing")
            }
            boundary = activated
        }
        boundaries[key] = boundary
        registrations[proposalID] = ProposalRegistration(
            canonical: canonical,
            contextKey: contextKey,
            boundaryKey: key
        )
        return try requireOperational(boundary.acceptance)
    }

    func permissionRequest(_ data: Data) async throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        let requiredKeys: Set<String> = [
            "session_id", "turn_id", "cwd", "hook_event_name",
            "permission_mode", "tool_name", "tool_input",
        ]
        let allowedKeys = requiredKeys.union(["transcript_path", "model"])
        try require(
            requiredKeys.isSubset(of: Set(payload.keys))
                && Set(payload.keys).isSubset(of: allowedKeys),
            "permission_request_invalid"
        )
        try require(
            payload["hook_event_name"] as? String == "PermissionRequest"
                && payload["permission_mode"] as? String == "default"
                && payload["tool_name"] as? String == "Bash",
            "permission_request_invalid"
        )
        try validateOptionalPermissionMetadata(
            payload["transcript_path"],
            maximumScalars: 4_096,
            code: "permission_request_transcript_path_invalid"
        )
        try validateOptionalPermissionMetadata(
            payload["model"],
            maximumScalars: 512,
            code: "permission_request_model_invalid"
        )
        let sessionID = try identifier(string(payload, "session_id"), "session_id")
        let turnID = try identifier(string(payload, "turn_id"), "turn_id")
        let cwd = try Self.normalizedPermissionPath(string(payload, "cwd"))
        let toolName = "Bash"
        guard let toolInput = payload["tool_input"] as? [String: Any] else {
            throw CoordinatorError("permission_request_tool_input_invalid")
        }
        let toolInputKeys = Set(toolInput.keys)
        try require(
            toolInputKeys == ["command"]
                || toolInputKeys == ["command", "description"],
            "permission_request_tool_input_invalid"
        )
        let description = try permissionDisplayString(
            toolInput["description"],
            maximumScalars: Self.maximumPermissionDescriptionScalars,
            code: "permission_request_description_invalid"
        )
        let commandPreview = try permissionCommandPreview(
            toolInput["command"]
        )
        guard let session = sessions[sessionID],
              Self.byteExact(session.latestTurnID, turnID),
              Self.byteExact(session.path, cwd),
              projects.values.contains(where: {
                  $0.enabled && Self.byteExact($0.projectID, session.projectID)
              })
        else {
            throw CoordinatorError("permission_request_binding_invalid")
        }
        let permissionAdmissionInstant = monotonicInstantGenerator()
        expireApprovalsWithoutLivePetConsumer(at: permissionAdmissionInstant)
        guard petConsumerLeaseIsLive(at: permissionAdmissionInstant) else {
            // A Hook must never wait for a UI that is not demonstrably alive.
            // This path does not allocate an id, advance notice counters, or
            // leave a card behind; native Codex remains the approval owner.
            return try permissionHookResponse(decision: "defer_to_codex")
        }
        try require(
            pendingPermissionRequests.count < maximumPendingPermissionRequests,
            "permission_request_capacity_exceeded"
        )

        let requestID = try identifier(
            idGenerator("permission_request"),
            "permission_request_id"
        )
        try require(
            !pendingPermissionRequests.contains(where: {
                Self.byteExact($0.requestID, requestID)
            }) && !resolvedPermissionRequests.contains(where: {
                Self.byteExact($0.requestID, requestID)
            }),
            "permission_request_id_conflict"
        )
        permissionNoticeCount = try nextGeneration(permissionNoticeCount)
        try require(
            approvalAdmissionSequence < Int64.max,
            "approval_admission_sequence_exhausted"
        )
        approvalAdmissionSequence += 1
        let arrivalSequence = approvalAdmissionSequence

        let timeoutNanoseconds = permissionRequestTimeoutNanoseconds
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                let timeoutTask = Task.detached(priority: .utility) { [weak self] in
                    try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                    guard !Task.isCancelled else { return }
                    await self?.expirePermissionRequest(requestID: requestID)
                }
                pendingPermissionRequests.append(PendingPermissionRequest(
                    requestID: requestID,
                    arrivalSequence: arrivalSequence,
                    projectID: session.projectID,
                    sessionID: sessionID,
                    turnID: turnID,
                    cwd: cwd,
                    toolName: toolName,
                    description: description,
                    commandPreview: commandPreview,
                    continuation: continuation,
                    timeoutTask: timeoutTask,
                    deliveryToken: nil
                ))
            }
        } onCancel: {
            Task { [weak self] in
                await self?.cancelPermissionRequest(requestID: requestID)
            }
        }
    }

    func resolvePermissionRequest(_ data: Data) async throws -> Data {
        expireApprovalsWithoutLivePetConsumer(
            at: monotonicInstantGenerator()
        )
        let payload = try StrictJSONTransport.object(from: data)
        try exactKeys(
            payload,
            required: [
                "schema_version", "kind", "request_id", "response_id", "project_id",
                "session_id", "turn_id", "decision",
            ]
        )
        try require(
            payload["schema_version"] as? String == "1.0"
                && payload["kind"] as? String == "blabee_permission_resolution_request",
            "permission_resolution_invalid"
        )
        let requestID = try identifier(string(payload, "request_id"), "request_id")
        let responseID = try identifier(string(payload, "response_id"), "response_id")
        let projectID = try identifier(string(payload, "project_id"), "project_id")
        let sessionID = try identifier(string(payload, "session_id"), "session_id")
        let turnID = try identifier(string(payload, "turn_id"), "turn_id")
        let decision = try string(payload, "decision")
        try require(
            ["deny", "defer_to_codex"].contains(decision),
            "permission_resolution_invalid"
        )
        if let resolved = resolvedPermissionRequests.first(where: {
            Self.byteExact($0.requestID, requestID)
        }) {
            guard resolved.matches(
                responseID: responseID,
                projectID: projectID,
                sessionID: sessionID,
                turnID: turnID,
                decision: decision
            ) else {
                throw CoordinatorError("permission_resolution_conflict")
            }
            return try permissionResolutionReceipt(
                requestID: requestID,
                responseID: responseID,
                decision: decision
            )
        }
        try require(
            !pendingPermissionRequestDeliveries.contains(where: {
                Self.byteExact($0.requestID, requestID)
                    || Self.byteExact($0.responseID, responseID)
            }),
            "permission_resolution_in_progress"
        )
        try require(
            !resolvedPermissionRequests.contains(where: {
                Self.byteExact($0.responseID, responseID)
            }),
            "permission_response_id_conflict"
        )
        guard let head = pendingPermissionRequests.first else {
            throw CoordinatorError("permission_request_not_found")
        }
        guard Self.byteExact(head.requestID, requestID) else {
            throw CoordinatorError("permission_request_not_head")
        }
        try require(
            isGlobalApprovalHead(arrivalSequence: head.arrivalSequence),
            "permission_request_not_global_head"
        )
        try byteExactRequire(head.projectID, projectID, "permission_request_binding_mismatch")
        try byteExactRequire(head.sessionID, sessionID, "permission_request_binding_mismatch")
        try byteExactRequire(head.turnID, turnID, "permission_request_binding_mismatch")
        guard let currentSession = sessions[head.sessionID],
              Self.byteExact(currentSession.projectID, head.projectID),
              Self.byteExact(currentSession.latestTurnID, head.turnID),
              Self.byteExact(currentSession.path, head.cwd)
        else {
            pendingPermissionRequests.removeFirst()
            head.timeoutTask.cancel()
            head.continuation.resume(
                returning: try permissionHookResponse(decision: "defer_to_codex")
            )
            throw CoordinatorError("permission_request_binding_invalid")
        }

        let deliveryToken = try permissionRequestDeliveryToken(
            idGenerator("permission_request_delivery")
        )
        try require(
            !pendingPermissionRequestDeliveries.contains(where: {
                Self.byteExact($0.deliveryToken, deliveryToken)
            }) && !resolvedPermissionRequests.contains(where: {
                Self.byteExact($0.deliveryToken, deliveryToken)
            }),
            "permission_request_delivery_token_conflict"
        )
        let hookResponse = try permissionHookDeliveryResponse(
            decision: decision,
            requestID: requestID,
            sessionID: sessionID,
            turnID: turnID,
            deliveryToken: deliveryToken
        )
        let deliveryTimeoutNanoseconds = permissionRequestDeliveryTimeoutNanoseconds
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                let timeoutTask = Task.detached(priority: .utility) { [weak self] in
                    try? await Task.sleep(nanoseconds: deliveryTimeoutNanoseconds)
                    guard !Task.isCancelled else { return }
                    await self?.expirePermissionRequestDelivery(
                        deliveryToken: deliveryToken
                    )
                }
                pendingPermissionRequestDeliveries.append(
                    PendingPermissionRequestDelivery(
                        requestID: requestID,
                        responseID: responseID,
                        projectID: projectID,
                        sessionID: sessionID,
                        turnID: turnID,
                        decision: decision,
                        deliveryToken: deliveryToken,
                        continuation: continuation,
                        timeoutTask: timeoutTask
                    )
                )
                head.timeoutTask.cancel()
                pendingPermissionRequests[0].deliveryToken = deliveryToken
                head.continuation.resume(returning: hookResponse)
            }
        } onCancel: {
            Task { [weak self] in
                await self?.cancelPermissionResolutionBeforeDeliveryExposure(
                    requestID: requestID,
                    deliveryToken: deliveryToken
                )
            }
        }
    }

    func expirePermissionRequest(requestID: String) {
        guard let index = pendingPermissionRequests.firstIndex(where: {
            Self.byteExact($0.requestID, requestID)
        }), pendingPermissionRequests[index].deliveryToken == nil
        else { return }
        let request = pendingPermissionRequests.remove(at: index)
        request.timeoutTask.cancel()
        do {
            request.continuation.resume(
                returning: try permissionHookResponse(decision: "defer_to_codex")
            )
        } catch {
            request.continuation.resume(throwing: error)
        }
    }

    private func petConsumerLeaseIsLive(at nowNanoseconds: UInt64) -> Bool {
        guard let heartbeat = lastPetConsumerHeartbeatNanoseconds,
              nowNanoseconds >= heartbeat
        else { return false }
        return nowNanoseconds - heartbeat < petConsumerLeaseDurationNanoseconds
    }

    private func expireApprovalsWithoutLivePetConsumer(
        at nowNanoseconds: UInt64
    ) {
        guard !petConsumerLeaseIsLive(at: nowNanoseconds) else { return }
        let invalidatesLeaseTimer = lastPetConsumerHeartbeatNanoseconds != nil
            || petConsumerLeaseExpiryTask != nil
        lastPetConsumerHeartbeatNanoseconds = nil
        if invalidatesLeaseTimer { petConsumerLeaseTimerGeneration &+= 1 }
        petConsumerLeaseExpiryTask?.cancel()
        petConsumerLeaseExpiryTask = nil

        let expiredPermissionRequests = pendingPermissionRequests.filter {
            $0.deliveryToken == nil
        }
        let expiredPermissionRequestIDs = Set(
            expiredPermissionRequests.map(\.requestID)
        )
        pendingPermissionRequests.removeAll {
            expiredPermissionRequestIDs.contains($0.requestID)
                && $0.deliveryToken == nil
        }
        for request in expiredPermissionRequests {
            request.timeoutTask.cancel()
            do {
                request.continuation.resume(
                    returning: try permissionHookResponse(decision: "defer_to_codex")
                )
            } catch {
                request.continuation.resume(throwing: error)
            }
        }

        let expiredManagedApprovals = pendingManagedCommandApprovals.filter {
            $0.deliveryToken == nil
        }
        let expiredManagedRequestIDs = Set(
            expiredManagedApprovals.map(\.managedRequestID)
        )
        pendingManagedCommandApprovals.removeAll {
            expiredManagedRequestIDs.contains($0.managedRequestID)
                && $0.deliveryToken == nil
        }
        for request in expiredManagedApprovals {
            request.timeoutTask.cancel()
            do {
                request.continuation.resume(
                    returning: try managedCommandApprovalOutcome(
                        decision: "decide_in_codex"
                    )
                )
            } catch {
                request.continuation.resume(throwing: error)
            }
        }
    }

    private func recordPetConsumerHeartbeat() {
        let nowNanoseconds = monotonicInstantGenerator()
        lastPetConsumerHeartbeatNanoseconds = nowNanoseconds
        schedulePetConsumerLeaseExpiryCheckIfNeeded(
            after: petConsumerLeaseDurationNanoseconds
        )
    }

    private func schedulePetConsumerLeaseExpiryCheckIfNeeded(
        after delayNanoseconds: UInt64
    ) {
        guard petConsumerLeaseExpiryTask == nil else { return }
        petConsumerLeaseTimerGeneration &+= 1
        let timerGeneration = petConsumerLeaseTimerGeneration
        petConsumerLeaseExpiryTask = Task.detached(priority: .utility) { [weak self] in
            try? await Task.sleep(nanoseconds: max(1, delayNanoseconds))
            guard !Task.isCancelled else { return }
            await self?.petConsumerLeaseExpiryTimerFired(
                timerGeneration: timerGeneration
            )
        }
    }

    private func petConsumerLeaseExpiryTimerFired(timerGeneration: UInt64) {
        guard timerGeneration == petConsumerLeaseTimerGeneration else { return }
        petConsumerLeaseExpiryTask = nil
        let nowNanoseconds = monotonicInstantGenerator()
        guard let heartbeat = lastPetConsumerHeartbeatNanoseconds,
              nowNanoseconds >= heartbeat
        else {
            expireApprovalsWithoutLivePetConsumer(at: nowNanoseconds)
            return
        }
        let elapsed = nowNanoseconds - heartbeat
        guard elapsed < petConsumerLeaseDurationNanoseconds else {
            expireApprovalsWithoutLivePetConsumer(at: nowNanoseconds)
            return
        }
        schedulePetConsumerLeaseExpiryCheckIfNeeded(
            after: petConsumerLeaseDurationNanoseconds - elapsed
        )
    }

    func cancelPermissionRequest(requestID: String) {
        guard let index = pendingPermissionRequests.firstIndex(where: {
            Self.byteExact($0.requestID, requestID)
        }), pendingPermissionRequests[index].deliveryToken == nil
        else { return }
        let request = pendingPermissionRequests.remove(at: index)
        request.timeoutTask.cancel()
        request.continuation.resume(throwing: CancellationError())
    }

    func expireSupersededPermissionRequests(
        sessionID: String,
        currentTurnID: String
    ) {
        let expired = pendingPermissionRequests.filter {
            Self.byteExact($0.sessionID, sessionID)
                && !Self.byteExact($0.turnID, currentTurnID)
                && $0.deliveryToken == nil
        }
        pendingPermissionRequests.removeAll {
            Self.byteExact($0.sessionID, sessionID)
                && !Self.byteExact($0.turnID, currentTurnID)
                && $0.deliveryToken == nil
        }
        for request in expired {
            request.timeoutTask.cancel()
            do {
                request.continuation.resume(
                    returning: try permissionHookResponse(decision: "defer_to_codex")
                )
            } catch {
                request.continuation.resume(throwing: error)
            }
        }
    }

    func permissionHookResponse(decision: String) throws -> Data {
        try require(
            ["deny", "defer_to_codex"].contains(decision),
            "permission_resolution_invalid"
        )
        return try publicData(["decision": decision])
    }

    func permissionHookDeliveryResponse(
        decision: String,
        requestID: String,
        sessionID: String,
        turnID: String,
        deliveryToken: String
    ) throws -> Data {
        try require(
            ["deny", "defer_to_codex"].contains(decision),
            "permission_resolution_invalid"
        )
        return try publicData([
            "decision": decision,
            "delivery_token": deliveryToken,
            "request_id": requestID,
            "session_id": sessionID,
            "turn_id": turnID,
        ])
    }

    func acknowledgePermissionRequestDelivery(_ data: Data) throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        try exactKeys(
            payload,
            required: [
                "schema_version", "kind", "request_id", "session_id",
                "turn_id", "delivery_token",
            ]
        )
        try require(
            payload["schema_version"] as? String == "1.0"
                && payload["kind"] as? String
                    == "blabee_permission_request_delivery_ack",
            "permission_request_delivery_ack_invalid"
        )
        let requestID = try identifier(string(payload, "request_id"), "request_id")
        let sessionID = try identifier(string(payload, "session_id"), "session_id")
        let turnID = try identifier(string(payload, "turn_id"), "turn_id")
        let deliveryToken = try permissionRequestDeliveryToken(
            string(payload, "delivery_token")
        )
        if let resolved = resolvedPermissionRequests.first(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }) {
            try validatePermissionRequestDeliveryAck(
                requestID: requestID,
                sessionID: sessionID,
                turnID: turnID,
                expectedRequestID: resolved.requestID,
                expectedSessionID: resolved.sessionID,
                expectedTurnID: resolved.turnID
            )
            return try permissionRequestDeliveryAckReceipt()
        }
        guard let index = pendingPermissionRequestDeliveries.firstIndex(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }) else {
            throw CoordinatorError("permission_request_delivery_not_found")
        }
        let delivery = pendingPermissionRequestDeliveries[index]
        try validatePermissionRequestDeliveryAck(
            requestID: requestID,
            sessionID: sessionID,
            turnID: turnID,
            expectedRequestID: delivery.requestID,
            expectedSessionID: delivery.sessionID,
            expectedTurnID: delivery.turnID
        )

        pendingPermissionRequestDeliveries.remove(at: index)
        delivery.timeoutTask.cancel()
        removeSelectedPermissionRequest(
            requestID: delivery.requestID,
            deliveryToken: delivery.deliveryToken
        )
        let resolutionReceipt = try permissionResolutionReceipt(
            requestID: delivery.requestID,
            responseID: delivery.responseID,
            decision: delivery.decision
        )
        resolvedPermissionRequests.append(ResolvedPermissionRequest(
            requestID: delivery.requestID,
            responseID: delivery.responseID,
            projectID: delivery.projectID,
            sessionID: delivery.sessionID,
            turnID: delivery.turnID,
            decision: delivery.decision,
            deliveryToken: delivery.deliveryToken
        ))
        if resolvedPermissionRequests.count > Self.maximumResolvedPermissionTombstones {
            resolvedPermissionRequests.removeFirst(
                resolvedPermissionRequests.count - Self.maximumResolvedPermissionTombstones
            )
        }
        delivery.continuation.resume(returning: resolutionReceipt)
        return try permissionRequestDeliveryAckReceipt()
    }

    func expirePermissionRequestDelivery(deliveryToken: String) {
        guard let index = pendingPermissionRequestDeliveries.firstIndex(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }) else { return }
        let delivery = pendingPermissionRequestDeliveries.remove(at: index)
        delivery.timeoutTask.cancel()
        removeSelectedPermissionRequest(
            requestID: delivery.requestID,
            deliveryToken: delivery.deliveryToken
        )
        delivery.continuation.resume(
            throwing: CoordinatorError("permission_request_delivery_timeout")
        )
    }

    func cancelPermissionResolutionBeforeDeliveryExposure(
        requestID: String,
        deliveryToken: String
    ) {
        guard !pendingPermissionRequestDeliveries.contains(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }), let index = pendingPermissionRequests.firstIndex(where: {
            Self.byteExact($0.requestID, requestID) && $0.deliveryToken == nil
        }) else { return }
        let request = pendingPermissionRequests.remove(at: index)
        request.timeoutTask.cancel()
        request.continuation.resume(throwing: CancellationError())
    }

    func removeSelectedPermissionRequest(
        requestID: String,
        deliveryToken: String
    ) {
        guard let index = pendingPermissionRequests.firstIndex(where: {
            Self.byteExact($0.requestID, requestID)
                && Self.byteExact($0.deliveryToken, deliveryToken)
        }) else { return }
        let request = pendingPermissionRequests.remove(at: index)
        request.timeoutTask.cancel()
    }

    func permissionRequestDeliveryAckReceipt() throws -> Data {
        try publicData([:])
    }

    func permissionRequestDeliveryToken(_ value: String) throws -> String {
        let bytes = Array(value.utf8)
        try require(
            bytes.count >= 16
                && bytes.count <= 512
                && bytes.allSatisfy { byte in
                    (0x41...0x5A).contains(byte)
                        || (0x61...0x7A).contains(byte)
                        || (0x30...0x39).contains(byte)
                        || byte == 0x5F
                        || byte == 0x2D
                },
            "permission_request_delivery_token_invalid"
        )
        return value
    }

    func validatePermissionRequestDeliveryAck(
        requestID: String,
        sessionID: String,
        turnID: String,
        expectedRequestID: String,
        expectedSessionID: String,
        expectedTurnID: String
    ) throws {
        try byteExactRequire(
            requestID,
            expectedRequestID,
            "permission_request_delivery_binding_mismatch"
        )
        try byteExactRequire(
            sessionID,
            expectedSessionID,
            "permission_request_delivery_binding_mismatch"
        )
        try byteExactRequire(
            turnID,
            expectedTurnID,
            "permission_request_delivery_binding_mismatch"
        )
    }

    func permissionResolutionReceipt(
        requestID: String,
        responseID: String,
        decision: String
    ) throws -> Data {
        try publicData([
            "resolved": true,
            "request_id": requestID,
            "response_id": responseID,
            "decision": decision,
        ])
    }

    func managedCommandApproval(_ data: Data) async throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        try exactKeys(
            payload,
            required: [
                "schema_version", "kind", "broker_epoch", "connection_id",
                "jsonrpc_request_id", "thread_id", "turn_id", "item_id",
                "approval_id", "environment_id", "cwd", "command_preview", "allow_once_available",
                "decline_available",
            ]
        )
        try require(
            payload["schema_version"] as? String == "1.0"
                && payload["kind"] as? String
                    == "blabee_managed_command_approval_request",
            "managed_command_approval_invalid"
        )
        let binding = try managedCommandApprovalBinding(payload)
        let approvalAdmissionInstant = monotonicInstantGenerator()
        expireApprovalsWithoutLivePetConsumer(at: approvalAdmissionInstant)
        guard petConsumerLeaseIsLive(at: approvalAdmissionInstant) else {
            // A managed broker must not wait for a Pet that is not
            // demonstrably consuming cards. Leave the official Codex UI as
            // the approval owner without allocating any local identity.
            return try managedCommandApprovalOutcome(
                decision: "decide_in_codex"
            )
        }

        // Requests with no synthetic decision available do not need to enter
        // Pet. Capacity and duplicate transport identities fail open to the
        // official Codex approval surface as a normal blocking-call result.
        guard binding.allowOnceAvailable || binding.declineAvailable,
              pendingManagedCommandApprovals.count
                < maximumPendingManagedCommandApprovals,
              !pendingManagedCommandApprovals.contains(where: {
                  $0.binding.hasSameTransportRequest(as: binding)
              }),
              !resolvedManagedCommandApprovals.contains(where: {
                  $0.binding.hasSameTransportRequest(as: binding)
              })
        else {
            return try managedCommandApprovalOutcome(decision: "decide_in_codex")
        }
        guard approvalAdmissionSequence < Int64.max else {
            return try managedCommandApprovalOutcome(decision: "decide_in_codex")
        }

        let managedRequestID = try identifier(
            idGenerator("managed_command_approval"),
            "managed_request_id"
        )
        try require(
            !pendingManagedCommandApprovals.contains(where: {
                Self.byteExact($0.managedRequestID, managedRequestID)
            }) && !resolvedManagedCommandApprovals.contains(where: {
                Self.byteExact($0.managedRequestID, managedRequestID)
            }),
            "managed_command_approval_id_conflict"
        )
        managedCommandApprovalNoticeCount = try nextGeneration(
            managedCommandApprovalNoticeCount
        )
        approvalAdmissionSequence += 1
        let arrivalSequence = approvalAdmissionSequence

        let timeoutNanoseconds = managedCommandApprovalTimeoutNanoseconds
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                // Cancellation can arrive after the outer check but before
                // registration. The actor keeps this check and append atomic;
                // a later cancellation handler is serialized immediately
                // after this method suspends.
                guard !Task.isCancelled else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                let timeoutTask = Task.detached(priority: .utility) { [weak self] in
                    try? await Task.sleep(nanoseconds: timeoutNanoseconds)
                    guard !Task.isCancelled else { return }
                    await self?.expireManagedCommandApproval(
                        managedRequestID: managedRequestID
                    )
                }
                pendingManagedCommandApprovals.append(PendingManagedCommandApproval(
                    managedRequestID: managedRequestID,
                    arrivalSequence: arrivalSequence,
                    binding: binding,
                    continuation: continuation,
                    timeoutTask: timeoutTask,
                    deliveryToken: nil
                ))
            }
        } onCancel: {
            Task { [weak self] in
                await self?.cancelManagedCommandApproval(
                    managedRequestID: managedRequestID
                )
            }
        }
    }

    func resolveManagedCommandApproval(_ data: Data) async throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        try exactKeys(
            payload,
            required: [
                "schema_version", "kind", "managed_request_id", "response_id",
                "broker_epoch", "connection_id", "jsonrpc_request_id", "thread_id",
                "turn_id", "item_id", "approval_id", "cwd", "command_preview",
                "environment_id", "allow_once_available", "decline_available", "decision",
            ]
        )
        try require(
            payload["schema_version"] as? String == "1.0"
                && payload["kind"] as? String
                    == "blabee_managed_command_approval_resolution_request",
            "managed_command_approval_resolution_invalid"
        )
        let managedRequestID = try identifier(
            string(payload, "managed_request_id"),
            "managed_request_id"
        )
        let responseID = try identifier(string(payload, "response_id"), "response_id")
        let binding = try managedCommandApprovalBinding(payload)
        let decision = try string(payload, "decision")
        try require(
            ["accept_once", "decline", "decide_in_codex"].contains(decision),
            "managed_command_approval_resolution_invalid"
        )

        if let resolved = resolvedManagedCommandApprovals.first(where: {
            Self.byteExact($0.managedRequestID, managedRequestID)
        }) {
            guard resolved.matches(
                responseID: responseID,
                binding: binding,
                decision: decision
            ) else {
                throw CoordinatorError("managed_command_approval_resolution_conflict")
            }
            return try managedCommandApprovalResolutionReceipt(
                managedRequestID: managedRequestID,
                responseID: responseID,
                decision: decision
            )
        }
        try require(
            !pendingManagedCommandApprovalDeliveries.contains(where: {
                Self.byteExact($0.managedRequestID, managedRequestID)
                    || Self.byteExact($0.responseID, responseID)
            }),
            "managed_command_approval_resolution_in_progress"
        )
        try require(
            !resolvedManagedCommandApprovals.contains(where: {
                Self.byteExact($0.responseID, responseID)
            }),
            "managed_command_approval_response_id_conflict"
        )
        guard let head = pendingManagedCommandApprovals.first else {
            throw CoordinatorError("managed_command_approval_not_found")
        }
        guard Self.byteExact(head.managedRequestID, managedRequestID) else {
            throw CoordinatorError("managed_command_approval_not_head")
        }
        try require(
            isGlobalApprovalHead(arrivalSequence: head.arrivalSequence),
            "managed_command_approval_not_global_head"
        )
        try require(
            head.binding == binding,
            "managed_command_approval_binding_mismatch"
        )
        if decision == "accept_once" {
            try require(
                head.binding.allowOnceAvailable,
                "managed_command_approval_decision_unavailable"
            )
        } else if decision == "decline" {
            try require(
                head.binding.declineAvailable,
                "managed_command_approval_decision_unavailable"
            )
        }

        let deliveryToken = try managedCommandApprovalDeliveryToken(
            idGenerator("managed_approval_delivery")
        )
        try require(
            !pendingManagedCommandApprovalDeliveries.contains(where: {
                Self.byteExact($0.deliveryToken, deliveryToken)
            }) && !resolvedManagedCommandApprovals.contains(where: {
                Self.byteExact($0.deliveryToken, deliveryToken)
            }),
            "managed_command_approval_delivery_token_conflict"
        )
        let brokerOutcome = try managedCommandApprovalOutcome(
            decision: decision,
            deliveryToken: deliveryToken
        )
        let deliveryTimeoutNanoseconds = managedCommandApprovalDeliveryTimeoutNanoseconds
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else {
                    pendingManagedCommandApprovals.removeFirst()
                    head.timeoutTask.cancel()
                    head.continuation.resume(throwing: CancellationError())
                    continuation.resume(throwing: CancellationError())
                    return
                }
                let timeoutTask = Task.detached(priority: .utility) { [weak self] in
                    try? await Task.sleep(nanoseconds: deliveryTimeoutNanoseconds)
                    guard !Task.isCancelled else { return }
                    await self?.expireManagedCommandApprovalDelivery(
                        deliveryToken: deliveryToken
                    )
                }
                pendingManagedCommandApprovalDeliveries.append(
                    PendingManagedCommandApprovalDelivery(
                        managedRequestID: managedRequestID,
                        responseID: responseID,
                        binding: binding,
                        decision: decision,
                        deliveryToken: deliveryToken,
                        continuation: continuation,
                        timeoutTask: timeoutTask
                    )
                )
                head.timeoutTask.cancel()
                pendingManagedCommandApprovals[0].deliveryToken = deliveryToken
                head.continuation.resume(returning: brokerOutcome)
            }
        } onCancel: {
            Task { [weak self] in
                await self?.cancelManagedCommandApprovalResolutionBeforeDeliveryExposure(
                    managedRequestID: managedRequestID,
                    deliveryToken: deliveryToken
                )
            }
        }
    }

    func expireManagedCommandApproval(managedRequestID: String) {
        guard let index = pendingManagedCommandApprovals.firstIndex(where: {
            Self.byteExact($0.managedRequestID, managedRequestID)
        }), pendingManagedCommandApprovals[index].deliveryToken == nil
        else { return }
        let request = pendingManagedCommandApprovals.remove(at: index)
        do {
            request.continuation.resume(
                returning: try managedCommandApprovalOutcome(
                    decision: "decide_in_codex"
                )
            )
        } catch {
            request.continuation.resume(throwing: error)
        }
    }

    func cancelManagedCommandApproval(managedRequestID: String) {
        guard let index = pendingManagedCommandApprovals.firstIndex(where: {
            Self.byteExact($0.managedRequestID, managedRequestID)
        }), pendingManagedCommandApprovals[index].deliveryToken == nil
        else { return }
        let request = pendingManagedCommandApprovals.remove(at: index)
        request.timeoutTask.cancel()
        request.continuation.resume(throwing: CancellationError())
    }

    func acknowledgeManagedCommandApprovalDelivery(_ data: Data) throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        try exactKeys(
            payload,
            required: [
                "schema_version", "kind", "broker_epoch", "connection_id",
                "jsonrpc_request_id", "thread_id", "turn_id", "item_id",
                "approval_id", "environment_id", "delivery_token",
            ]
        )
        try require(
            payload["schema_version"] as? String == "1.0"
                && payload["kind"] as? String
                    == "blabee_managed_command_approval_delivery_ack",
            "managed_command_approval_delivery_ack_invalid"
        )
        let deliveryToken = try managedCommandApprovalDeliveryToken(
            string(payload, "delivery_token")
        )
        if let resolved = resolvedManagedCommandApprovals.first(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }) {
            try validateManagedCommandApprovalDeliveryAck(
                payload,
                binding: resolved.binding
            )
            return try managedCommandApprovalDeliveryAckReceipt()
        }
        guard let index = pendingManagedCommandApprovalDeliveries.firstIndex(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }) else {
            throw CoordinatorError("managed_command_approval_delivery_not_found")
        }
        let delivery = pendingManagedCommandApprovalDeliveries[index]
        try validateManagedCommandApprovalDeliveryAck(
            payload,
            binding: delivery.binding
        )

        pendingManagedCommandApprovalDeliveries.remove(at: index)
        delivery.timeoutTask.cancel()
        removeSelectedManagedCommandApproval(
            managedRequestID: delivery.managedRequestID,
            deliveryToken: delivery.deliveryToken
        )
        let resolutionReceipt = try managedCommandApprovalResolutionReceipt(
            managedRequestID: delivery.managedRequestID,
            responseID: delivery.responseID,
            decision: delivery.decision
        )
        resolvedManagedCommandApprovals.append(ResolvedManagedCommandApproval(
            managedRequestID: delivery.managedRequestID,
            responseID: delivery.responseID,
            binding: delivery.binding,
            decision: delivery.decision,
            deliveryToken: delivery.deliveryToken
        ))
        if resolvedManagedCommandApprovals.count
            > Self.maximumResolvedManagedCommandApprovalTombstones
        {
            resolvedManagedCommandApprovals.removeFirst(
                resolvedManagedCommandApprovals.count
                    - Self.maximumResolvedManagedCommandApprovalTombstones
            )
        }
        delivery.continuation.resume(returning: resolutionReceipt)
        return try managedCommandApprovalDeliveryAckReceipt()
    }

    func expireManagedCommandApprovalDelivery(deliveryToken: String) {
        guard let index = pendingManagedCommandApprovalDeliveries.firstIndex(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }) else { return }
        let delivery = pendingManagedCommandApprovalDeliveries.remove(at: index)
        delivery.timeoutTask.cancel()
        removeSelectedManagedCommandApproval(
            managedRequestID: delivery.managedRequestID,
            deliveryToken: delivery.deliveryToken
        )
        delivery.continuation.resume(
            throwing: CoordinatorError("managed_command_approval_delivery_timeout")
        )
    }

    func cancelManagedCommandApprovalResolutionBeforeDeliveryExposure(
        managedRequestID: String,
        deliveryToken: String
    ) {
        guard !pendingManagedCommandApprovalDeliveries.contains(where: {
            Self.byteExact($0.deliveryToken, deliveryToken)
        }) else { return }
        cancelManagedCommandApproval(managedRequestID: managedRequestID)
    }

    func removeSelectedManagedCommandApproval(
        managedRequestID: String,
        deliveryToken: String
    ) {
        guard let index = pendingManagedCommandApprovals.firstIndex(where: {
            Self.byteExact($0.managedRequestID, managedRequestID)
                && Self.byteExact($0.deliveryToken, deliveryToken)
        }) else { return }
        let request = pendingManagedCommandApprovals.remove(at: index)
        request.timeoutTask.cancel()
    }

    func managedCommandApprovalOutcome(
        decision: String,
        deliveryToken: String? = nil
    ) throws -> Data {
        try require(
            ["accept_once", "decline", "decide_in_codex"].contains(decision),
            "managed_command_approval_resolution_invalid"
        )
        if let deliveryToken {
            return try publicData([
                "decision": decision,
                "delivery_token": deliveryToken,
            ])
        }
        return try publicData(["decision": decision])
    }

    func managedCommandApprovalDeliveryAckReceipt() throws -> Data {
        try publicData([:])
    }

    func managedCommandApprovalDeliveryToken(_ value: String) throws -> String {
        let bytes = Array(value.utf8)
        try require(
            bytes.count >= 16
                && bytes.count <= 512
                && bytes.allSatisfy { byte in
                    (0x41...0x5A).contains(byte)
                        || (0x61...0x7A).contains(byte)
                        || (0x30...0x39).contains(byte)
                        || byte == 0x5F
                        || byte == 0x2D
                },
            "managed_command_approval_delivery_token_invalid"
        )
        return value
    }

    func isGlobalApprovalHead(arrivalSequence: Int64) -> Bool {
        let permissionSequence = pendingPermissionRequests.first?.arrivalSequence
        let managedSequence = pendingManagedCommandApprovals.first?.arrivalSequence
        let globalHead = [permissionSequence, managedSequence]
            .compactMap { $0 }
            .min()
        return globalHead == arrivalSequence
    }

    /// Confirms that the Pet selection matched the FIFO head and the broker
    /// later acknowledged writing the response bytes. App Server processing
    /// and command execution remain separate downstream evidence.
    func managedCommandApprovalResolutionReceipt(
        managedRequestID: String,
        responseID: String,
        decision: String
    ) throws -> Data {
        try publicData([
            "resolved": true,
            "managed_request_id": managedRequestID,
            "response_id": responseID,
            "decision": decision,
        ])
    }

    private func managedCommandApprovalBinding(
        _ payload: [String: Any]
    ) throws -> ManagedCommandApprovalBinding {
        let brokerEpoch = try boundedPermissionIdentifier(
            string(payload, "broker_epoch"),
            code: "managed_command_approval_broker_epoch_invalid"
        )
        let connectionID = try boundedPermissionIdentifier(
            string(payload, "connection_id"),
            code: "managed_command_approval_connection_id_invalid"
        )
        let jsonRPCRequestID = try managedJSONRPCRequestID(
            payload["jsonrpc_request_id"]
        )
        let threadID = try boundedPermissionIdentifier(
            string(payload, "thread_id"),
            code: "managed_command_approval_thread_id_invalid"
        )
        let turnID = try boundedPermissionIdentifier(
            string(payload, "turn_id"),
            code: "managed_command_approval_turn_id_invalid"
        )
        let itemID = try boundedPermissionIdentifier(
            string(payload, "item_id"),
            code: "managed_command_approval_item_id_invalid"
        )
        let approvalID: String?
        if payload["approval_id"] is NSNull {
            approvalID = nil
        } else {
            approvalID = try boundedPermissionIdentifier(
                string(payload, "approval_id"),
                code: "managed_command_approval_approval_id_invalid"
            )
        }
        let environmentID: String?
        if payload["environment_id"] is NSNull {
            environmentID = nil
        } else {
            environmentID = try boundedPermissionIdentifier(
                string(payload, "environment_id"),
                code: "managed_command_approval_environment_id_invalid"
            )
        }
        let cwd = try Self.validatedManagedCommandApprovalPath(
            string(payload, "cwd")
        )
        let commandPreview: String
        do {
            commandPreview = try permissionCommandPreview(payload["command_preview"])
        } catch {
            throw CoordinatorError("managed_command_approval_command_invalid")
        }
        let allowOnceAvailable = try managedCommandApprovalBoolean(
            payload["allow_once_available"]
        )
        let declineAvailable = try managedCommandApprovalBoolean(
            payload["decline_available"]
        )
        return ManagedCommandApprovalBinding(
            brokerEpoch: brokerEpoch,
            connectionID: connectionID,
            jsonRPCRequestID: jsonRPCRequestID,
            threadID: threadID,
            turnID: turnID,
            itemID: itemID,
            approvalID: approvalID,
            environmentID: environmentID,
            cwd: cwd,
            commandPreview: commandPreview,
            allowOnceAvailable: allowOnceAvailable,
            declineAvailable: declineAvailable
        )
    }

    private func validateManagedCommandApprovalDeliveryAck(
        _ payload: [String: Any],
        binding: ManagedCommandApprovalBinding
    ) throws {
        let brokerEpoch = try boundedPermissionIdentifier(
            string(payload, "broker_epoch"),
            code: "managed_command_approval_broker_epoch_invalid"
        )
        let connectionID = try boundedPermissionIdentifier(
            string(payload, "connection_id"),
            code: "managed_command_approval_connection_id_invalid"
        )
        let jsonRPCRequestID = try managedJSONRPCRequestID(
            payload["jsonrpc_request_id"]
        )
        let threadID = try boundedPermissionIdentifier(
            string(payload, "thread_id"),
            code: "managed_command_approval_thread_id_invalid"
        )
        let turnID = try boundedPermissionIdentifier(
            string(payload, "turn_id"),
            code: "managed_command_approval_turn_id_invalid"
        )
        let itemID = try boundedPermissionIdentifier(
            string(payload, "item_id"),
            code: "managed_command_approval_item_id_invalid"
        )
        let approvalID = try managedCommandApprovalOptionalIdentifier(
            payload,
            key: "approval_id"
        )
        let environmentID = try managedCommandApprovalOptionalIdentifier(
            payload,
            key: "environment_id"
        )
        try require(
            Self.byteExact(brokerEpoch, binding.brokerEpoch)
                && Self.byteExact(connectionID, binding.connectionID)
                && jsonRPCRequestID == binding.jsonRPCRequestID
                && Self.byteExact(threadID, binding.threadID)
                && Self.byteExact(turnID, binding.turnID)
                && Self.byteExact(itemID, binding.itemID)
                && Self.byteExact(approvalID, binding.approvalID)
                && Self.byteExact(environmentID, binding.environmentID),
            "managed_command_approval_delivery_binding_mismatch"
        )
    }

    private func managedCommandApprovalOptionalIdentifier(
        _ payload: [String: Any],
        key: String
    ) throws -> String? {
        if payload[key] is NSNull { return nil }
        return try boundedPermissionIdentifier(
            string(payload, key),
            code: "managed_command_approval_\(key)_invalid"
        )
    }

    private func managedJSONRPCRequestID(
        _ rawValue: Any?
    ) throws -> ManagedJSONRPCRequestID {
        guard let object = rawValue as? [String: Any],
              Set(object.keys) == ["type", "value"],
              let type = object["type"] as? String
        else { throw CoordinatorError("managed_command_approval_jsonrpc_id_invalid") }
        if type == "string",
           let value = object["value"] as? String
        {
            return .string(try boundedPermissionIdentifier(
                value,
                code: "managed_command_approval_jsonrpc_id_invalid"
            ))
        }
        if type == "integer",
           let value = ExactJSONInteger.int64(object["value"])
        {
            return .integer(value)
        }
        throw CoordinatorError("managed_command_approval_jsonrpc_id_invalid")
    }

    func managedCommandApprovalBoolean(_ rawValue: Any?) throws -> Bool {
        guard let number = rawValue as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID()
        else { throw CoordinatorError("managed_command_approval_boolean_invalid") }
        return number.boolValue
    }

    func boundedPermissionIdentifier(_ value: String, code: String) throws -> String {
        try require(
            !value.isEmpty
                && value.unicodeScalars.count <= 512
                && IdentifierNormalization.isNFC(value)
                && value.unicodeScalars.allSatisfy(isSafePermissionDisplayScalar),
            code
        )
        return value
    }

    func permissionDisplayString(
        _ rawValue: Any?,
        maximumScalars: Int,
        code: String
    ) throws -> String? {
        guard let rawValue else { return nil }
        if rawValue is NSNull { return nil }
        guard let value = rawValue as? String else { throw CoordinatorError(code) }
        try require(
            value.unicodeScalars.count <= maximumScalars
                && IdentifierNormalization.isNFC(value)
                && value.unicodeScalars.allSatisfy(isSafePermissionDisplayScalar),
            code
        )
        return value.trimmingCharacters(in: .whitespaces).isEmpty ? nil : value
    }

    func validateOptionalPermissionMetadata(
        _ rawValue: Any?,
        maximumScalars: Int,
        code: String
    ) throws {
        guard let rawValue, !(rawValue is NSNull) else { return }
        guard let value = rawValue as? String else { throw CoordinatorError(code) }
        try require(
            !value.isEmpty
                && value.unicodeScalars.count <= maximumScalars
                && IdentifierNormalization.isNFC(value)
                && value.unicodeScalars.allSatisfy(isSafePermissionDisplayScalar),
            code
        )
    }

    func isSafePermissionDisplayScalar(_ scalar: Unicode.Scalar) -> Bool {
        let category = scalar.properties.generalCategory
        return !scalar.properties.isDefaultIgnorableCodePoint
            && category != .control
            && category != .format
            && category != .lineSeparator
            && category != .paragraphSeparator
    }

    func permissionCommandPreview(_ rawValue: Any?) throws -> String {
        guard let value = rawValue as? String,
              !value.isEmpty,
              value.unicodeScalars.count <= Self.maximumPermissionCommandPreviewScalars,
              IdentifierNormalization.isNFC(value),
              !value.trimmingCharacters(in: .whitespaces).isEmpty,
              value.unicodeScalars.allSatisfy({ scalar in
                  isSafePermissionDisplayScalar(scalar)
              })
        else {
            throw CoordinatorError("permission_request_command_invalid")
        }
        return value
    }
}

// MARK: - Stop and Pet routing

private extension CoordinatorOperationalApplication {
    func stop(_ data: Data, generation requestGeneration: UInt64) async throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        let sessionID = try identifier(string(payload, "session_id"), "session_id")
        let turnID = try identifier(string(payload, "turn_id"), "turn_id")
        let activeFlag = (payload["stop_hook_active"] as? Bool) ?? false
        let message = (payload["last_assistant_message"] as? String) ?? ""
        guard let session = sessions[sessionID] else {
            return try publicData(["status": "no_proposal"])
        }
        guard Self.byteExact(session.latestTurnID, turnID) else {
            return try publicData(["status": "no_proposal"])
        }
        let turnKey = CoordinatorTurnKey(
            projectID: session.projectID,
            sessionID: sessionID,
            sourceTurnID: turnID
        )
        guard let key = activeByTurn[turnKey], var boundary = boundaries[key] else {
            return try publicData(["status": "no_proposal"])
        }
        guard boundary.stopLedger.register(
            sessionID: sessionID,
            turnID: turnID,
            stopHookActive: activeFlag,
            lastAssistantMessage: message,
            generation: requestGeneration
        ) != nil else {
            boundaries[key] = boundary
            return try publicData(["status": "duplicate_stop_observation"])
        }
        boundaries[key] = boundary

        if boundary.phase == .dispatched {
            let status = boundary.nextTurnDispatchPhase == .failed
                ? "next_turn_dispatch_failed"
                : "next_turn_dispatch_in_progress"
            return try publicData(["status": status])
        }

        guard !activeFlag else {
            return try publicData(["status": "no_proposal"])
        }
        guard boundary.phase == .sealed else {
            return try publicData(["status": "decision_wait_already_active"])
        }
        boundary.phase = .waiting
        boundaries[key] = boundary
        return try publicData(["status": "decision_available"])
    }

    func focusInteraction(_ data: Data) throws -> Data {
        let request = try StrictJSONTransport.object(from: data)
        try exactKeys(
            request,
            required: [
                "schema_version", "kind", "interaction_id", "packet_id", "revision",
                "project_id", "session_id", "source_turn_id", "source_prompt_id",
                "episode_id", "episode_root_prompt_id", "episode_baseline_checkpoint_id",
                "decision_boundary_id", "boundary_sequence",
            ]
        )
        try require(request["schema_version"] as? String == "1.0", "invalid_request")
        try require(request["kind"] as? String == "blabee_pet_focus_request", "invalid_request")

        let binding = try CoordinatorBinding(jsonObject: request)
        guard let boundary = boundaries[binding.fullKey],
              boundary.phase == .waiting,
              let packetData = boundary.packet,
              let packet = try? StrictJSONTransport.object(from: packetData)
        else { throw CoordinatorError("interaction_not_waiting") }

        try byteExactRequire(
            packet["interaction_id"] as? String,
            try identifier(string(request, "interaction_id"), "interaction_id"),
            "focus_binding_mismatch"
        )
        try byteExactRequire(
            packet["packet_id"] as? String,
            try identifier(string(request, "packet_id"), "packet_id"),
            "focus_binding_mismatch"
        )
        guard let requestRevision = ExactJSONInteger.int64(request["revision"], minimum: 1),
              let packetRevision = ExactJSONInteger.int64(packet["revision"], minimum: 1),
              requestRevision == packetRevision
        else { throw CoordinatorError("focus_binding_mismatch") }

        var target = binding.jsonObject
        target["expected_state"] = "pending"
        target["interaction_id"] = packet["interaction_id"]
        target["packet_id"] = packet["packet_id"]
        target["revision"] = packet["revision"]
        do {
            _ = try routing.setForeground(StrictJSONTransport.data(forJSONObject: target))
            resetReconciliationCooldown(recoveredForegroundAuthority: true)
        } catch {
            if error.coordinatorError.code == "foreground_target_not_pending" {
                // The journal-backed due-work pass succeeded before this
                // state mismatch was reported; it is not a storage outage.
                resetReconciliationCooldown(recoveredForegroundAuthority: true)
            } else {
                // Request/binding validation happens above. Errors reaching
                // this point come from the journal-backed routing authority
                // or an internal target invariant, not plain user input.
                recordReconciliationFailure(
                    error,
                    awaitingForegroundAuthority: binding.fullKey
                )
            }
            throw error
        }
        return try publicData(["focused": true])
    }

    func select(_ data: Data) async throws -> Data {
        let selection = try StrictJSONTransport.object(from: data)
        _ = try V1IngressValidator().validate(data, as: .selectionRequest)
        try exactKeys(
            selection,
            required: [
                "schema_version", "kind", "selection_id", "interaction_id", "packet_id",
                "revision", "option_id", "project_id", "session_id", "source_turn_id",
                "source_prompt_id", "episode_id", "episode_root_prompt_id",
                "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence",
            ]
        )
        let projectID = try identifier(string(selection, "project_id"), "project_id")
        let sessionID = try identifier(string(selection, "session_id"), "session_id")
        let episodeID = try identifier(string(selection, "episode_id"), "episode_id")
        guard let revision = ExactJSONInteger.int64(selection["revision"], minimum: 1) else {
            throw CoordinatorError("selection_binding_mismatch")
        }
        guard let candidate = boundaries.first(where: { _, boundary in
            guard boundary.phase == .waiting, let packetData = boundary.packet,
                  let packet = try? StrictJSONTransport.object(from: packetData)
            else { return false }
            return Self.byteExact(packet["interaction_id"] as? String, selection["interaction_id"] as? String)
        }), var boundary = boundaries[candidate.key],
              let packetData = boundary.packet,
              let packet = try? StrictJSONTransport.object(from: packetData),
              let choices = packet["choices"] as? [[String: Any]],
              let choice = choices.first(where: {
                  Self.byteExact($0["option_id"] as? String, selection["option_id"] as? String)
              })
        else { throw CoordinatorError("interaction_not_waiting") }

        try byteExactRequire(boundary.binding.projectID, projectID, "selection_binding_mismatch")
        try byteExactRequire(boundary.binding.sessionID, sessionID, "selection_binding_mismatch")
        try byteExactRequire(boundary.binding.episodeID, episodeID, "selection_binding_mismatch")
        let suppliedBinding = try CoordinatorBinding(jsonObject: selection)
        try require(suppliedBinding == boundary.binding, "selection_binding_mismatch")
        try byteExactRequire(packet["packet_id"] as? String, string(selection, "packet_id"), "selection_binding_mismatch")
        guard let packetRevision = ExactJSONInteger.int64(packet["revision"], minimum: 1) else {
            throw CoordinatorError("selection_binding_mismatch")
        }
        try require(revision == packetRevision, "selection_binding_mismatch")
        try require(choice["enabled"] as? Bool == true, "decision_option_disabled")
        guard ExactJSONInteger.int64(choice["slot"], minimum: 1) != nil,
              let choiceKind = choice["kind"] as? String
        else {
            throw CoordinatorError("decision_option_not_found")
        }
        let isPetAction = choiceKind == "recommended_action" || choiceKind == "alternative_action"
        let isPause = choiceKind == "pause"

        var request = boundary.binding.jsonObject
        request["schema_version"] = "1.0"
        request["kind"] = "blabee_selection_request"
        request["selection_id"] = try identifier(string(selection, "selection_id"), "selection_id")
        request["interaction_id"] = packet["interaction_id"]
        request["packet_id"] = packet["packet_id"]
        request["revision"] = packet["revision"]
        request["option_id"] = choice["option_id"]
        let commandContinuationID = idGenerator("continuation")
        let command: [String: Any] = [
            "type": "select_option",
            "expected_state": "pending",
            "event_ids": [
                "selection_claimed": idGenerator("event_selection_claimed"),
                "continuation_dispatched": idGenerator("event_continuation_dispatched"),
                "decision_boundary_closed": idGenerator("event_pause_closed"),
            ],
            "occurred_at": try wallInstantGenerator().rawValue,
            "request": request,
            "continuation_id": commandContinuationID,
            "issued_at": try wallInstantGenerator().rawValue,
            "expires_at": try wallInstantGenerator().rawValue,
            "in_flight_deadline_at": try wallInstantGenerator().rawValue,
        ]
        let routed = try routing.routeSelection(StrictJSONTransport.data(forJSONObject: command))

        if isPause {
            boundary.phase = .paused
            boundaries[candidate.key] = boundary
            activeByTurn.removeValue(forKey: boundary.binding.turnKey)
            return try publicData(["accepted": true, "outcome": ["kind": "pause"]])
        }
        let effect: [String: Any]?
        if let effectData = routed.effects.first {
            effect = try StrictJSONTransport.object(from: effectData)
        } else {
            effect = nil
        }
        let envelope = effect?["envelope"] as? [String: Any]
        let effectContinuationID = envelope?["continuation_id"] as? String
        let continuationID = isPetAction
            ? commandContinuationID
            : effectContinuationID
        do {
            if let effectContinuationID {
                try byteExactRequire(
                    effectContinuationID,
                    commandContinuationID,
                    "continuation_binding_mismatch"
                )
            }
            guard isPetAction,
                  let envelope,
                  effectContinuationID != nil,
                  envelope["action"] is [String: Any]
            else { throw CoordinatorError("pet_action_envelope_missing") }
            secretCorpus.registerKnownSecrets(inJSONObject: envelope)
            _ = try routing.routeConsumePetAction(StrictJSONTransport.data(forJSONObject: [
                "type": "consume_pet_action",
                "event_id": idGenerator("event_continuation_consumed"),
                "occurred_at": try wallInstantGenerator().rawValue,
                "envelope": envelope,
            ]))
        } catch {
            boundary.phase = .dispatched
            boundary.continuationID = continuationID
            boundary.nextTurnDispatchPhase = .failed
            boundaries[candidate.key] = boundary
            throw error
        }
        guard let envelope, let continuationID,
              let action = envelope["action"] as? [String: Any]
        else { throw CoordinatorError("pet_action_envelope_missing") }
        try validateAction(action)
        guard let cwd = sessions[sessionID]?.path else {
            throw CoordinatorError("session_not_registered")
        }
        let reference = Self.queuedPromptReference(
            continuationID: continuationID,
            cwd: cwd
        )
        guard let message = QueuedPromptEnvelope.message(reference: reference) else {
            throw CoordinatorError("queued_prompt_reference_invalid")
        }
        try secretCorpus.assertNoKnownSecret(in: Data(message.utf8))
        boundary.phase = .dispatched
        boundary.continuationID = continuationID
        boundary.nextTurnDispatchPhase = .inFlight
        boundary.expectedQueuedPromptDigest = Data(SHA256.hash(data: Data(message.utf8)))
        boundaries[candidate.key] = boundary

        let receipt: CoordinatorNextTurnDispatchReceipt
        do {
            receipt = try await nextTurnDispatcher(CoordinatorNextTurnDispatchRequest(
                sessionID: sessionID,
                message: message,
                continuationID: continuationID
            ))
            try require(!receipt.queuedSubmissionID.isEmpty, "queued_submission_id_invalid")
            _ = try identifier(receipt.queuedSubmissionID, "queued_submission_id")
        } catch {
            if var current = boundaries[candidate.key] {
                current.nextTurnDispatchPhase = .failed
                boundaries[candidate.key] = current
            }
            if let coordinatorError = error as? CoordinatorError {
                throw coordinatorError
            }
            throw CoordinatorError("next_turn_dispatch_failed")
        }

        if var current = boundaries[candidate.key] {
            current.nextTurnDispatchPhase = .accepted
            boundaries[candidate.key] = current
            if current.phase == .dispatched {
                try complete(boundaryKey: candidate.key)
                try promoteStagedAfterRecoveredTerminal(
                    turnKey: current.binding.turnKey,
                    terminalKey: candidate.key
                )
                pendingCompletionClosures.remove(candidate.key)
            }
        }
        return try publicData([
            "accepted": true,
            "outcome": [
                "kind": "next_turn",
                "continuation_id": continuationID,
                "queued_submission_id": receipt.queuedSubmissionID,
            ],
        ])
    }

    func complete(boundaryKey: CoordinatorBindingKey) throws {
        guard var boundary = boundaries[boundaryKey],
              boundary.phase == .dispatched,
              let continuationID = boundary.continuationID
        else { throw CoordinatorError("continuation_not_dispatched") }
        // This marker covers the whole durable completion workflow, not only
        // the close append. It remains until the caller has also promoted any
        // staged successor, so every partial transition has a retry anchor.
        pendingCompletionClosures.insert(boundaryKey)
        let now = try wallInstantGenerator().rawValue
        try routing.completeTransportAndCloseBoundary(
            StrictJSONTransport.data(forJSONObject: [
                "type": "complete_transport",
                "event_id": idGenerator("event_transport_completed"),
                "occurred_at": now,
                "binding": boundary.binding.jsonObject,
                "continuation_id": continuationID,
            ]),
            close: StrictJSONTransport.data(forJSONObject: [
                "type": "close_boundary",
                "event_id": idGenerator("event_boundary_closed"),
                "occurred_at": now,
                "binding": boundary.binding.jsonObject,
                "close_reason": "transport_terminal_observed",
            ])
        )
        boundary.phase = .closed
        boundaries[boundaryKey] = boundary
    }

    private func supersedeUnselectedBoundaryForNewPrompt(
        boundaryKey: CoordinatorBindingKey
    ) throws {
        guard var boundary = boundaries[boundaryKey],
              boundary.phase == .sealed || boundary.phase == .waiting
        else { throw CoordinatorError("session_decision_boundary_active") }
        do {
            try closeTerminalBoundaryIdempotently(
                &boundary,
                reason: "superseded_by_user_prompt"
            )
        } catch {
            // A journal append can commit even when its response is lost.
            // Only authoritative replay may convert that ambiguity into
            // success; an actually open boundary keeps blocking the new turn.
            let originalError = error
            guard let authoritative = try? routing.authoritativeState(),
                  authoritative.boundary(for: boundary.binding)?.closed == true
            else { throw originalError }
        }
        boundary.phase = .closed
        boundaries[boundaryKey] = boundary
        if activeByTurn[boundary.binding.turnKey] == boundaryKey {
            activeByTurn.removeValue(forKey: boundary.binding.turnKey)
        }
    }

    private func supersedeSessionSuggestionsForNewPrompt(
        projectID: String,
        sessionID: String
    ) throws {
        let pendingKeys = boundaries.compactMap { key, boundary in
            Self.byteExact(boundary.binding.projectID, projectID)
                && Self.byteExact(boundary.binding.sessionID, sessionID)
                && (boundary.phase == .sealed || boundary.phase == .waiting)
                ? key
                : nil
        }.sorted { left, right in
            let leftSequence = boundaries[left]?.binding.boundarySequence ?? 0
            let rightSequence = boundaries[right]?.binding.boundarySequence ?? 0
            return leftSequence < rightSequence
        }
        let stagedEntries = stagedByTurn.compactMap { turnKey, stagedKey in
            Self.byteExact(turnKey.projectID, projectID)
                && Self.byteExact(turnKey.sessionID, sessionID)
                ? (turnKey, stagedKey)
                : nil
        }
        for (_, stagedKey) in stagedEntries {
            guard let staged = boundaries[stagedKey], staged.phase == .staged else {
                throw CoordinatorError("proposal_retry_state_missing")
            }
        }
        for pendingKey in pendingKeys {
            // A fresh user turn supersedes every unselected proposal still
            // visible for this session, including a promoted successor whose
            // binding belongs to an older source turn. Verified Blabee queue
            // turns never enter this path.
            try supersedeUnselectedBoundaryForNewPrompt(boundaryKey: pendingKey)
        }
        for (turnKey, stagedKey) in stagedEntries {
            guard let staged = boundaries[stagedKey] else {
                throw CoordinatorError("proposal_retry_state_missing")
            }
            // A staged successor has not opened or sealed any journal
            // authority yet, so cancellation is deliberately process-local.
            // Remove its retained acceptance and registration together with
            // the promotion pointer so neither a dispatch receipt nor an
            // exact proposal retry can resurrect a stale staged card.
            stagedByTurn.removeValue(forKey: turnKey)
            boundaries.removeValue(forKey: stagedKey)
            if registrations[staged.proposalID]?.boundaryKey == stagedKey {
                registrations.removeValue(forKey: staged.proposalID)
            }
        }
    }

    private func closeTerminalBoundaryIdempotently(
        _ boundary: inout Boundary,
        reason: String
    ) throws {
        do {
            _ = try routing.executeCommand(StrictJSONTransport.data(forJSONObject: [
                "type": "close_boundary",
                "event_id": idGenerator("event_boundary_closed"),
                "occurred_at": try wallInstantGenerator().rawValue,
                "binding": boundary.binding.jsonObject,
                "close_reason": reason,
            ]))
        } catch let error as CoordinatorError
            where error.code == "decision_boundary_already_closed"
        {
            return
        }
    }
}

// MARK: - Packet construction and snapshots

private extension CoordinatorOperationalApplication {
    private func activate(_ boundary: inout Boundary) throws {
        if boundary.openEventID == nil {
            boundary.openEventID = idGenerator("event_boundary_opened")
        }
        if boundary.openedAt == nil {
            boundary.openedAt = try wallInstantGenerator()
        }
        if boundary.sealEventID == nil {
            boundary.sealEventID = idGenerator("event_packet_sealed")
        }
        if boundary.packet == nil {
            guard let openedAt = boundary.openedAt else {
                throw CoordinatorError("boundary_open_recovery_state_missing")
            }
            // The semantic layer rewrites this sequence-bound field on every
            // CAS attempt. All packet identities are nevertheless generated
            // exactly once and retained here across retries.
            boundary.packet = try makePacket(
                boundary: boundary,
                validAfter: 1,
                sealedAt: openedAt
            )
        }
        guard let openEventID = boundary.openEventID,
              let openedAt = boundary.openedAt,
              let sealEventID = boundary.sealEventID,
              let packetTemplate = boundary.packet
        else { throw CoordinatorError("initial_activation_recovery_state_missing") }
        let result = try routing.executeCommand(
            StrictJSONTransport.data(forJSONObject: [
                "type": "activate_initial_boundary",
                "open_event_id": openEventID,
                "seal_event_id": sealEventID,
                "occurred_at": openedAt.rawValue,
                "binding": boundary.binding.jsonObject,
                "proposal_id": boundary.proposalID,
                "packet": try StrictJSONTransport.object(from: packetTemplate),
            ])
        )
        guard result.effects.count == 1,
              let effectData = result.effects.first
        else { throw CoordinatorError("initial_activation_effect_missing") }
        let effect = try StrictJSONTransport.object(from: effectData)
        guard effect["kind"] as? String == "blabee_initial_activation_committed",
              let packetObject = effect["packet"] as? [String: Any]
        else { throw CoordinatorError("initial_activation_effect_invalid") }
        let packet = try StrictJSONTransport.data(forJSONObject: packetObject)
        _ = try V1IngressValidator().validate(packet, as: .decisionPacket)
        boundary.packet = packet
        boundary.openedEventSequence = result.commit.firstSequence
        boundary.phase = .sealed
    }

    private func makePacket(
        boundary: Boundary,
        validAfter: Int64,
        sealedAt: RFC3339Instant
    ) throws -> Data {
        let proposal = boundary.proposalObject
        let outcome = try object(proposal, "outcome")
        guard let rankedActions = proposal["next_actions"] as? [[String: Any]]
        else { throw CoordinatorError("invalid_proposal") }
        let choices: [[String: Any]] = rankedActions.enumerated().map { offset, action in
            let slot = offset + 1
            return [
                "slot": slot,
                "kind": slot == 1 ? "recommended_action" : "alternative_action",
                "enabled": true,
                "disabled_reason": NSNull(),
                "option_id": idGenerator("option_rank_\(slot)"),
                "action_id": idGenerator("action_rank_\(slot)"),
                "action": action,
            ]
        }
        var packet: [String: Any] = [
            "schema_version": "1.0",
            "kind": "blabee_decision_packet",
            "interaction_id": idGenerator("interaction"),
            "packet_id": idGenerator("packet"),
            "revision": 1,
            "valid_after_event_sequence": validAfter,
            "sealed_at": sealedAt.rawValue,
            "expires_at": try sealedAt.adding(
                nanoseconds: CoordinatorRoutingApplication.expiryAfterNanoseconds
            ).rawValue,
            "summary": try string(outcome, "summary"),
            "evidence": [],
            "risk": ["level": "info", "reasons": []],
            "checkpoint": [
                "id": boundary.binding.episodeBaselineCheckpointID,
                "coverage": "unavailable",
            ],
            "choices": choices,
        ]
        packet["decision_layout"] = "ranked_next_actions"
        packet.merge(boundary.binding.jsonObject) { current, _ in current }
        return try StrictJSONTransport.data(forJSONObject: packet)
    }

    private func acceptanceData(_ boundary: Boundary) throws -> Data {
        guard let packet = boundary.packet else { throw CoordinatorError("packet_missing") }
        return try publicData([
            "accepted": true,
            "staged": false,
            "proposal_id": boundary.proposalID,
            "packet": try StrictJSONTransport.object(from: packet),
        ])
    }

    func stateSnapshot(payload: Data) throws -> Data {
        let request = try StrictJSONTransport.object(from: payload)
        let recordsPetConsumerHeartbeat: Bool
        if request.isEmpty {
            // Empty payloads remain a compatible read-only diagnostic, but do
            // not claim that a Pet UI exists to consume an approval card.
            expireApprovalsWithoutLivePetConsumer(
                at: monotonicInstantGenerator()
            )
            recordsPetConsumerHeartbeat = false
        } else {
            let heartbeat = request["consumer_heartbeat"] as? NSNumber
            try require(
                Set(request.keys) == [
                    "schema_version", "kind", "consumer_heartbeat",
                ]
                    && request["schema_version"] as? String == "1.0"
                    && request["kind"] as? String == "blabee_pet_snapshot_request"
                    && heartbeat.map { CFGetTypeID($0) == CFBooleanGetTypeID() } == true
                    && heartbeat?.boolValue == true,
                "pet_snapshot_request_invalid"
            )
            // Expire any prior lease before taking a replacement heartbeat so
            // a returning Pet cannot revive a card from an abandoned waiter.
            expireApprovalsWithoutLivePetConsumer(
                at: monotonicInstantGenerator()
            )
            recordsPetConsumerHeartbeat = true
        }
        // Lease reconciliation above is process-local only. Keep the snapshot
        // projection journal/freshness read-only so ordinary Pet polling does
        // not create durable work or repeat full-state verification.
        let routingObject = try StrictJSONTransport.object(
            from: routing.snapshotWithoutProcessingTime().canonicalJSON
        )
        let projectObjects = projects.values.sorted { $0.path < $1.path }.map { project in
            ["project_id": project.projectID, "cwd": project.path, "enabled": project.enabled] as [String: Any]
        }
        let sessionObjects = sessions.values.sorted { $0.sessionID < $1.sessionID }.map { session in
            [
                "project_id": session.projectID,
                "session_id": session.sessionID,
                "source_turn_id": session.latestTurnID as Any? ?? NSNull(),
                "source_prompt_id": session.latestPromptID as Any? ?? NSNull(),
                "episode_id": session.episode?.episodeID as Any? ?? NSNull(),
            ] as [String: Any]
        }
        let routingPending = routingObject["pending"] as? [[String: Any]] ?? []
        let interactionObjects = try routingPending.compactMap { pending -> [String: Any]? in
            guard let routingBinding = try? CoordinatorBinding(jsonObject: pending),
                  let boundary = boundaries[routingBinding.fullKey],
                  [.sealed, .waiting].contains(boundary.phase),
                  let packetData = boundary.packet
            else { return nil }
            let packet = try StrictJSONTransport.object(from: packetData)
            guard Self.byteExact(packet["interaction_id"] as? String, pending["interaction_id"] as? String),
                  Self.byteExact(packet["packet_id"] as? String, pending["packet_id"] as? String),
                  ExactJSONInteger.int64(packet["revision"], minimum: 1)
                    == ExactJSONInteger.int64(pending["revision"], minimum: 1)
            else { return nil }
            guard let cwd = projects.values.first(where: {
                Self.byteExact($0.projectID, boundary.binding.projectID)
            })?.path else { return nil }
            var result: [String: Any] = [
                "state": boundary.phase.rawValue,
                "interaction_id": packet["interaction_id"]!,
                "packet_id": packet["packet_id"]!,
                "revision": packet["revision"]!,
                "project_id": boundary.binding.projectID,
                "session_id": boundary.binding.sessionID,
                "episode_id": boundary.binding.episodeID,
                "boundary_sequence": boundary.binding.boundarySequence,
                "cwd": cwd,
                "summary": packet["summary"]!,
                "outcome": boundary.proposalObject["outcome"]!,
                "reported_side_effects": boundary.proposalObject["reported_side_effects"]!,
                "sealed_at": packet["sealed_at"]!,
                "expires_at": packet["expires_at"]!,
                "valid_after_event_sequence": packet["valid_after_event_sequence"]!,
                "risk": packet["risk"]!,
                "evidence": packet["evidence"]!,
                "checkpoint": packet["checkpoint"]!,
                "choices": packet["choices"]!,
                "foreground": pending["foreground"]!,
                "reminder_due": pending["reminder_due"]!,
                "milliseconds_until_expiry": pending["milliseconds_until_expiry"]!,
            ]
            result.merge(boundary.binding.jsonObject) { current, _ in current }
            return result
        }
        let response = try publicData([
            "schema_version": "1.0",
            "kind": "blabee_operational_snapshot",
            "routing": routingObject,
            "projects": projectObjects,
            "sessions": sessionObjects,
            "interactions": interactionObjects,
            "permission_requests": pendingPermissionRequests.map(\.snapshotObject),
            "permission_notice_count": permissionNoticeCount,
            "managed_command_approvals": pendingManagedCommandApprovals.map(
                \.snapshotObject
            ),
            "managed_command_approval_notice_count": managedCommandApprovalNoticeCount,
        ])
        if recordsPetConsumerHeartbeat {
            // Record presence only after a complete snapshot was produced.
            // Failed/malformed state responses therefore cannot make a Hook
            // wait for a Pet that never received consumable state.
            recordPetConsumerHeartbeat()
        }
        return response
    }
}

// MARK: - Operational proposal validation

private extension CoordinatorOperationalApplication {
    func validateOperationalProposal(
        _ proposal: [String: Any],
        correlationToken: String
    ) throws -> Data {
        let commonKeys: Set<String> = [
            "schema_version", "proposal_id", "correlation_token", "interaction_kind",
            "task_goal", "outcome", "reported_side_effects",
        ]
        try exactKeys(proposal, required: commonKeys.union(["next_actions"]))
        try require(proposal["schema_version"] as? String == "1.0", "invalid_proposal")
        try require(proposal["interaction_kind"] as? String == "blabee_decision", "invalid_proposal")
        _ = try identifier(string(proposal, "proposal_id"), "proposal_id")
        try byteExactRequire(
            try opaqueToken(string(proposal, "correlation_token")),
            correlationToken,
            "proposal_binding_mismatch"
        )
        _ = try nonEmptyString(proposal, "task_goal", maximum: 8_192)

        let outcome = try object(proposal, "outcome")
        try exactKeys(outcome, required: ["status", "summary"])
        let outcomeStatus = try string(outcome, "status")
        try require(["completed", "partial", "blocked", "failed"].contains(outcomeStatus), "invalid_proposal")
        _ = try nonEmptyString(outcome, "summary", maximum: 8_192)
        guard let actions = proposal["next_actions"] as? [[String: Any]],
              (2...4).contains(actions.count)
        else { throw CoordinatorError("invalid_proposal") }
        var canonicalActions = Set<Data>()
        for action in actions {
            try validateAction(action)
            let canonical = try StrictJSONTransport.data(forJSONObject: action)
            try require(canonicalActions.insert(canonical).inserted, "invalid_proposal")
        }
        guard let sideEffects = proposal["reported_side_effects"] as? [[String: Any]],
              sideEffects.count <= 128
        else { throw CoordinatorError("invalid_proposal") }
        for effect in sideEffects {
            try exactKeys(effect, required: ["kind", "summary", "reversibility"])
            let kind = try nonEmptyString(effect, "kind", maximum: 128)
            try require(Self.isStableCode(kind), "invalid_proposal")
            _ = try nonEmptyString(effect, "summary", maximum: 8_192)
            let reversibility = try string(effect, "reversibility")
            try require(["reversible", "irreversible", "unknown"].contains(reversibility), "invalid_proposal")
        }
        return try StrictJSONTransport.data(forJSONObject: proposal)
    }

    func validateAction(_ action: [String: Any]) throws {
        try exactKeys(action, required: ["title", "objective", "constraints", "done_when"])
        _ = try nonEmptyString(action, "title", maximum: 256)
        _ = try nonEmptyString(action, "objective", maximum: 8_192)
        try stringList(action, "constraints", minimum: 0)
        try stringList(action, "done_when", minimum: 1)
        let canonicalAction = try StrictJSONTransport.data(forJSONObject: action)
        try require(
            canonicalAction.count <= Self.maximumQueuedActionJSONBytes,
            "invalid_proposal"
        )
    }

    func stringList(_ object: [String: Any], _ key: String, minimum: Int) throws {
        guard let values = object[key] as? [String], values.count >= minimum, values.count <= 128 else {
            throw CoordinatorError("invalid_proposal")
        }
        for value in values {
            try require(!value.isEmpty && value.unicodeScalars.count <= 8_192, "invalid_proposal")
        }
    }
}

// MARK: - Shared helpers

private extension CoordinatorOperationalApplication {
    private func queuedPromptResolution(
        prompt: String,
        sessionID: String,
        turnID: String,
        cwd: String,
        completingInFlightBoundary: CoordinatorBindingKey? = nil
    ) throws -> QueuedPromptResolution {
        // `codex queue` may canonically decompose non-ASCII command-line
        // message text before it reaches UserPromptSubmit. Normalize only for
        // the fixed marker/reference comparison; the durable claim below
        // still seals the exact prompt bytes that the Hook actually received.
        let normalizedPrompt = prompt.precomposedStringWithCanonicalMapping
        guard !normalizedPrompt.hasPrefix(Self.legacyQueuedPromptPrefix) else {
            return .rejected
        }
        let reference: String
        switch QueuedPromptEnvelope.classify(prompt) {
        case .human:
            return .human
        case .malformed:
            return .rejected
        case .exact(let value):
            reference = value
        }

        let authority = try routing.queuedActionAuthorityProjection()
        let state = authority.state
        var matches: [(
            continuation: CoordinatorContinuationState,
            actionJSON: Data,
            needsCompletion: Bool
        )] = []
        for continuation in state.continuations.values {
            let isTerminalDelivery = continuation.transport?.status == .completed
                && state.boundary(for: continuation.binding)?.closed == true
            let isExpectedInFlightDelivery = completingInFlightBoundary
                == continuation.binding.fullKey
                && continuation.transport == nil
                && state.boundary(for: continuation.binding)?.closed == false
            guard continuation.dispatchMode == "queued_next_turn",
                  continuation.consumedAt != nil,
                  isTerminalDelivery || isExpectedInFlightDelivery,
                  Self.byteExact(continuation.binding.sessionID, sessionID),
                  Self.byteExact(
                      Self.queuedPromptReference(
                          continuationID: continuation.continuationID,
                          cwd: cwd
                      ),
                      reference
                  )
            else { continue }
            let documentKey = CoordinatorPacketRevision(
                packetID: continuation.packetID,
                revision: continuation.revision
            )
            guard let packet = state.packetDocuments[documentKey],
                  let choice = packet.choices.first(where: {
                      Self.byteExact($0.optionID, continuation.optionID)
                          && Self.byteExact($0.actionID, continuation.actionID)
                  }),
                  let actionJSON = choice.actionJSON,
                  let action = try? StrictJSONTransport.object(from: actionJSON),
                  (try? validateAction(action)) != nil
            else { continue }
            matches.append((continuation, actionJSON, isExpectedInFlightDelivery))
        }
        guard matches.count == 1, let match = matches.first else {
            return .rejected
        }
        let queuedPromptSHA256 = Self.sha256Fingerprint(Data(prompt.utf8))
        let cwdSHA256 = Self.sha256Fingerprint(Data(cwd.utf8))
        let actionSHA256 = Self.sha256Fingerprint(match.actionJSON)
        let claimedActionJSON: Data
        do {
            let occurredAt = try wallInstantGenerator().rawValue
            let commandObject: [String: Any] = [
                "type": "claim_queued_action_context",
                "event_id": idGenerator("event_queued_action_context_claimed"),
                "occurred_at": occurredAt,
                "binding": match.continuation.binding.jsonObject,
                "continuation_id": match.continuation.continuationID,
                "delivery_turn_id": turnID,
                "queued_prompt_sha256": queuedPromptSHA256,
                "cwd_sha256": cwdSHA256,
                "action_sha256": actionSHA256,
            ]
            let command = try StrictJSONTransport.data(forJSONObject: commandObject)
            if let completingInFlightBoundary, match.needsCompletion {
                try require(
                    completingInFlightBoundary == match.continuation.binding.fullKey,
                    "decision_boundary_binding_mismatch"
                )
                let completion = try StrictJSONTransport.data(forJSONObject: [
                    "type": "complete_transport",
                    "event_id": idGenerator("event_transport_completed"),
                    "occurred_at": occurredAt,
                    "binding": match.continuation.binding.jsonObject,
                    "continuation_id": match.continuation.continuationID,
                ])
                let close = try StrictJSONTransport.data(forJSONObject: [
                    "type": "close_boundary",
                    "event_id": idGenerator("event_boundary_closed"),
                    "occurred_at": occurredAt,
                    "binding": match.continuation.binding.jsonObject,
                    "close_reason": "transport_terminal_observed",
                ])
                claimedActionJSON = try routing.routeQueuedActionContextClaim(
                    command,
                    completingTransportWith: completion,
                    closingBoundaryWith: close,
                    using: authority,
                    expectedActionJSON: match.actionJSON
                )
            } else {
                claimedActionJSON = try routing.routeQueuedActionContextClaim(
                    command,
                    using: authority,
                    expectedActionJSON: match.actionJSON
                )
            }
        } catch let error as CoordinatorError where [
            "queued_action_context_already_claimed",
            "queued_action_context_claim_mismatch",
            "queued_action_context_not_claimable",
            "queued_action_context_claim_protocol_missing",
            "queued_action_context_digest_invalid",
            "continuation_not_dispatched",
            "continuation_not_consumed",
            "continuation_action_mismatch",
            "decision_boundary_binding_mismatch",
            "decision_boundary_not_closed",
            "dispatch_mode_conflict",
            "transport_terminal_observation_missing",
        ].contains(error.code) {
            return .rejected
        }
        try require(
            claimedActionJSON == match.actionJSON,
            "queued_action_context_claim_mismatch"
        )
        try secretCorpus.assertNoKnownSecret(in: claimedActionJSON)
        let actionContext = try queuedActionContext(actionJSON: claimedActionJSON)
        return .verified(
            continuationID: match.continuation.continuationID,
            actionContext: actionContext
        )
    }

    private func queuedActionContext(actionJSON: Data) throws -> String {
        try require(
            actionJSON.count <= Self.maximumQueuedActionJSONBytes,
            "queued_action_context_too_large"
        )
        guard let actionText = String(data: actionJSON, encoding: .utf8) else {
            throw CoordinatorError("queued_action_context_invalid")
        }
        return Self.queuedActionContextMarker + actionText
    }

    private static func queuedPromptReference(
        continuationID: String,
        cwd: String
    ) -> String {
        var input = Data("blabee-next-turn-v2\u{0}".utf8)
        input.append(Data(continuationID.utf8))
        input.append(0)
        input.append(Data(cwd.utf8))
        return SHA256.hash(data: input)
            .prefix(QueuedPromptEnvelope.referenceByteCount)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func sha256Fingerprint(_ data: Data) -> String {
        "sha256:" + SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private func promptContext(session: Session) throws -> Data {
        guard let episode = session.episode,
              let turnID = session.latestTurnID,
              let promptID = session.latestPromptID,
              let correlation = session.correlationToken
        else { throw CoordinatorError("session_prompt_context_missing") }
        let identifiers = try publicIdentifiers(session: session)
        var context = "Blabee boundary: project_id=\(session.projectID); session_id=\(session.sessionID); source_turn_id=\(turnID); source_prompt_id=\(promptID); episode_id=\(episode.episodeID); episode_root_prompt_id=\(episode.rootPromptID); episode_baseline_checkpoint_id=\(episode.baselineCheckpointID); correlation_token=\(correlation). Use these exact values only when calling blabee.emit_decision. "
            + BlabeeSuggestionContext.instructions(for: suggestionMode)
        if let queuedActionContext = session.queuedActionContext {
            context += "\n\n" + queuedActionContext
        }
        try require(
            Data(context.utf8).count <= Self.maximumUserPromptAdditionalContextBytes,
            "user_prompt_additional_context_too_large"
        )
        return try publicData([
            "enabled": true,
            "prompt_origin": session.promptOrigin,
            "identifiers": identifiers,
            "additionalContext": context,
        ])
    }

    private func publicIdentifiers(session: Session) throws -> [String: Any] {
        guard let episode = session.episode,
              let turnID = session.latestTurnID,
              let promptID = session.latestPromptID
        else { throw CoordinatorError("session_prompt_context_missing") }
        return [
            "project_id": session.projectID,
            "session_id": session.sessionID,
            "source_turn_id": turnID,
            "source_prompt_id": promptID,
            "episode_id": episode.episodeID,
            "episode_root_prompt_id": episode.rootPromptID,
            "episode_baseline_checkpoint_id": episode.baselineCheckpointID,
        ]
    }

    private func project(containing path: String) -> Project? {
        projects.values
            .filter { path == $0.path || path.hasPrefix($0.path + "/") }
            .max { $0.path.count < $1.path.count }
    }

    func publicData(_ object: Any) throws -> Data {
        let data = try StrictJSONTransport.data(forJSONObject: object)
        try secretCorpus.assertNoKnownSecret(in: data)
        return data
    }

    func exactKeys(_ object: [String: Any], required: Set<String>) throws {
        try require(Set(object.keys) == required, "invalid_request_shape")
    }

    func string(_ object: [String: Any], _ key: String) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty else {
            throw CoordinatorError("invalid_request", "\(key) must be a non-empty string")
        }
        return value
    }

    func object(_ object: [String: Any], _ key: String) throws -> [String: Any] {
        guard let value = object[key] as? [String: Any] else {
            throw CoordinatorError("invalid_proposal", "\(key) must be an object")
        }
        return value
    }

    func nonEmptyString(
        _ object: [String: Any],
        _ key: String,
        maximum: Int
    ) throws -> String {
        let value = try string(object, key)
        try require(value.unicodeScalars.count <= maximum, "invalid_proposal")
        return value
    }

    func identifier(_ value: String, _ field: String) throws -> String {
        try require(value.unicodeScalars.count <= 512, "\(field)_invalid")
        try require(IdentifierNormalization.isNFC(value), "\(field)_invalid")
        return value
    }

    func optionalIdentifier(_ object: [String: Any], _ key: String) throws -> String? {
        guard let value = object[key] else { return nil }
        guard let text = value as? String, !text.isEmpty else {
            throw CoordinatorError("\(key)_invalid")
        }
        return try identifier(text, key)
    }

    func opaqueToken(_ value: String) throws -> String {
        let bytes = Array(value.utf8)
        try require(bytes.count >= 16 && bytes.count <= 1_024, "opaque_token_invalid")
        try require(IdentifierNormalization.isNFC(value), "opaque_token_invalid")
        try require(bytes.allSatisfy {
            (0x41...0x5A).contains($0)
                || (0x61...0x7A).contains($0)
                || (0x30...0x39).contains($0)
                || $0 == 0x2D
                || $0 == 0x5F
        }, "opaque_token_invalid")
        return value
    }

    func byteExactRequire(_ actual: String?, _ expected: String?, _ code: String) throws {
        try require(Self.byteExact(actual, expected), code)
    }

    func constantTimeTokenRequire(
        _ actual: String?,
        _ expected: String?,
        _ code: String
    ) throws {
        guard let actual, let expected else {
            throw CoordinatorError(code)
        }
        try require(
            ContinuationTokenMaterial.constantTimeEqual(actual, expected),
            code
        )
    }

    func nextGeneration(_ value: UInt64) throws -> UInt64 {
        let (next, overflow) = value.addingReportingOverflow(1)
        try require(!overflow, "request_generation_overflow")
        return next
    }

    static func normalizedPath(_ path: String) throws -> String {
        try require(path.hasPrefix("/"), "project_path_invalid")
        return URL(fileURLWithPath: path).standardizedFileURL.path
    }

    static func normalizedPermissionPath(_ path: String) throws -> String {
        try require(
            path.hasPrefix("/")
                && path.unicodeScalars.count <= 4_096
                && !path.contains("\0"),
            "permission_request_cwd_invalid"
        )
        return URL(fileURLWithPath: path).standardizedFileURL.path
    }

    static func validatedManagedCommandApprovalPath(_ path: String) throws -> String {
        let components = path.split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        try require(
            path.hasPrefix("/")
                && path.unicodeScalars.count <= 4_096
                && IdentifierNormalization.isNFC(path)
                && (path == "/" || !components.dropFirst().contains(where: {
                    $0.isEmpty || $0 == "." || $0 == ".."
                }))
                && path.unicodeScalars.allSatisfy { scalar in
                    let category = scalar.properties.generalCategory
                    return !scalar.properties.isDefaultIgnorableCodePoint
                        && category != .control
                        && category != .format
                        && category != .lineSeparator
                        && category != .paragraphSeparator
                },
            "managed_command_approval_cwd_invalid"
        )
        // Preserve the exact, lexically canonical App Server cwd in the
        // binding and Pet snapshot. Foundation's filesystem-aware
        // standardization can rewrite valid macOS aliases such as
        // /private/tmp to /tmp, and its result can change with filesystem
        // state. Returning the validated wire value keeps registration,
        // resolution, and idempotent retries byte-stable.
        return path
    }

    static func byteExact(_ left: String?, _ right: String?) -> Bool {
        guard let left, let right else { return left == nil && right == nil }
        return left.utf8.elementsEqual(right.utf8)
    }

    static func isStableCode(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard let first = bytes.first, (0x61...0x7A).contains(first), bytes.count <= 128 else {
            return false
        }
        return bytes.dropFirst().allSatisfy {
            (0x61...0x7A).contains($0) || (0x30...0x39).contains($0) || $0 == 0x5F
        }
    }
}

private func requireOperational<T>(_ value: T?) throws -> T {
    guard let value else { throw CoordinatorError("operational_state_missing") }
    return value
}
