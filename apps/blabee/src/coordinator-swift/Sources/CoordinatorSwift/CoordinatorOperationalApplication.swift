import CryptoKit
import Dispatch
import Foundation

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
    private static let queuedPromptPrefix =
        "Blabee 선택 작업을 불러옵니다. Hook 세부 조건이 없으면 실행하지 마세요. ref="
    // Before the durable claim protocol, queued submissions exposed the full
    // action JSON in the visible prompt. Such a prompt may still be waiting in
    // Codex when Blabee is upgraded. It has no durable delivery authority, so
    // classify it explicitly instead of allowing it to fall through as human.
    private static let legacyQueuedPromptPrefix =
        "Blabee verified the selected action. Execute exactly this JSON action as a new user turn. A queued transport receipt is not proof that the work succeeded.\n"
    private static let queuedPromptReferenceBytes = 16
    private static let maximumQueuedActionJSONBytes = 60_000
    private static let maximumUserPromptAdditionalContextBytes = 65_536
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

    private let routing: CoordinatorRoutingApplication
    private let secretCorpus: RuntimeSecretCorpus
    private let idGenerator: IDGenerator
    private let wallInstantGenerator: WallInstantGenerator
    private let monotonicInstantGenerator: MonotonicInstantGenerator
    private let stopObservationHMACKey: Data
    private let nextTurnDispatcher: CoordinatorNextTurnDispatcher

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
    private var consecutiveReconciliationFailures = 0
    private var reconciliationRetryNotBeforeNanoseconds: UInt64?
    private var lastReconciliationErrorCode: String?
    private var foregroundAuthorityRecoveryBinding: CoordinatorBindingKey?

    public init(
        routing: CoordinatorRoutingApplication,
        enabledProjectPaths: [String] = [],
        secretCorpus: RuntimeSecretCorpus = RuntimeSecretCorpus(),
        idGenerator: IDGenerator? = nil,
        wallInstantGenerator: WallInstantGenerator? = nil,
        monotonicInstantGenerator: MonotonicInstantGenerator? = nil,
        stopObservationHMACKey: Data? = nil,
        nextTurnDispatcher: CoordinatorNextTurnDispatcher? = nil
    ) {
        let ids: IDGenerator = idGenerator ?? { purpose in
            "\(purpose)_\(UUID().uuidString.lowercased())"
        }
        self.routing = routing
        self.secretCorpus = secretCorpus
        self.idGenerator = ids
        self.stopObservationHMACKey = stopObservationHMACKey
            ?? SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
        self.nextTurnDispatcher = nextTurnDispatcher ?? { _ in
            throw CoordinatorError("next_turn_dispatcher_unavailable")
        }
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
        if routing.recoveryStatus().isQuarantined {
            if type == "pet_snapshot" || type == "get_state" {
                return try stateSnapshot()
            }
            throw CoordinatorError("routing_restart_unsealed_boundary_quarantined")
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
            if type == "pet_snapshot" || type == "get_state" {
                return try stateSnapshot()
            }
            throw Self.reconciliationQuarantinedError
        }
        if reconciliationCooldownIsActive() {
            // Pet polling remains useful during a storage outage, but it must
            // not bypass the same cooldown as the scheduler. This projection
            // is actor/routing memory only and intentionally does not advance
            // time or consult durable authority.
            if type == "pet_snapshot" || type == "get_state" {
                return try stateSnapshot()
            }
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
        case "permission_request":
            return try permissionRequest(payload)
        case "pet_snapshot", "get_state":
            return try stateSnapshot()
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
            "additionalContext": "Blabee is enabled for this project. For an action-type request, every completed, partial, blocked, or failed result must call blabee.emit_decision before finalizing, even when the result is short or text-only. Do not emit for explanations, structure descriptions, status checks, or general questions.",
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
                        try complete(boundaryKey: activeKey)
                        try promoteStagedAfterRecoveredTerminal(
                            turnKey: key,
                            terminalKey: activeKey
                        )
                        pendingCompletionClosures.remove(activeKey)
                    }
                case .closed, .paused, .expired:
                    activeByTurn.removeValue(forKey: key)
                case .activating, .staged, .sealed, .waiting:
                    throw CoordinatorError("session_decision_boundary_active")
                }
            }
        }

        let queuedResolution = try queuedPromptResolution(
            prompt: prompt,
            sessionID: sessionID,
            turnID: turnID,
            cwd: cwd
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
            throw CoordinatorError("proposal_binding_mismatch")
        }
        try byteExactRequire(session.projectID, projectID, "proposal_binding_mismatch")
        try byteExactRequire(session.latestTurnID, turnID, "proposal_binding_mismatch")
        try byteExactRequire(episode.episodeID, episodeID, "proposal_binding_mismatch")
        try byteExactRequire(session.correlationToken, correlationToken, "proposal_binding_mismatch")

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

    func permissionRequest(_ data: Data) throws -> Data {
        let payload = try StrictJSONTransport.object(from: data)
        _ = try identifier(string(payload, "session_id"), "session_id")
        permissionNoticeCount = try nextGeneration(permissionNoticeCount)
        return try publicData([
            "notified": true,
            "response_owner": "codex_native_ui",
        ])
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
        guard let slot = ExactJSONInteger.int64(choice["slot"], minimum: 1) else {
            throw CoordinatorError("decision_option_not_found")
        }

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

        if slot == 3 {
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
        let continuationID = (slot == 1 || slot == 2)
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
            guard slot == 1 || slot == 2,
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
        let message = Self.queuedPromptMessage(reference: reference)
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
        do {
            _ = try routing.executeCommand(StrictJSONTransport.data(forJSONObject: [
                "type": "complete_transport",
                "event_id": idGenerator("event_transport_completed"),
                "occurred_at": now,
                "binding": boundary.binding.jsonObject,
                "continuation_id": continuationID,
            ]))
        } catch let error as CoordinatorError where [
            "routing_continuation_not_in_flight",
            "transport_already_terminal",
        ].contains(error.code) {
            // A previous attempt may have durably completed transport before
            // its following boundary-close append failed. The close command
            // below is the authority check: it succeeds only for a terminal
            // transport and therefore does not infer completion here.
        }
        do {
            try closeTerminalBoundaryIdempotently(
                &boundary,
                reason: "transport_terminal_observed"
            )
        } catch {
            pendingCompletionClosures.insert(boundaryKey)
            throw error
        }
        boundary.phase = .closed
        boundaries[boundaryKey] = boundary
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
        let recommended = try object(proposal, "recommended_next")
        let alternative = proposal["alternative_next"] as? [String: Any]
        var choices: [[String: Any]] = [[
            "slot": 1,
            "kind": "recommended_action",
            "enabled": true,
            "disabled_reason": NSNull(),
            "option_id": idGenerator("option_recommended"),
            "action_id": idGenerator("action_recommended"),
            "action": recommended,
        ]]
        if let alternative {
            choices.append([
                "slot": 2,
                "kind": "alternative_action",
                "enabled": true,
                "disabled_reason": NSNull(),
                "option_id": idGenerator("option_alternative"),
                "action_id": idGenerator("action_alternative"),
                "action": alternative,
            ])
        } else {
            choices.append([
                "slot": 2,
                "kind": "alternative_action",
                "enabled": false,
                "disabled_reason": "no_safe_meaningful_alternative",
                "option_id": idGenerator("option_alternative_disabled"),
                "action_id": NSNull(),
            ])
        }
        choices.append([
            "slot": 3,
            "kind": "pause",
            "enabled": true,
            "disabled_reason": NSNull(),
            "option_id": idGenerator("option_pause"),
            "action_id": idGenerator("action_pause"),
        ])
        choices.append([
            "slot": 4,
            "kind": "rollback",
            "enabled": false,
            "disabled_reason": "rollback_not_enabled_in_build",
            "option_id": idGenerator("option_rollback"),
            "action_id": NSNull(),
        ])
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

    func stateSnapshot() throws -> Data {
        // The common operational request prelude already advanced routing
        // time and reconciled its notices. Keep this projection read-only so
        // one Pet state request remains exactly one reconciliation tick.
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
        return try publicData([
            "schema_version": "1.0",
            "kind": "blabee_operational_snapshot",
            "routing": routingObject,
            "projects": projectObjects,
            "sessions": sessionObjects,
            "interactions": interactionObjects,
            "permission_notice_count": permissionNoticeCount,
        ])
    }
}

// MARK: - Operational proposal validation

private extension CoordinatorOperationalApplication {
    func validateOperationalProposal(
        _ proposal: [String: Any],
        correlationToken: String
    ) throws -> Data {
        try exactKeys(
            proposal,
            required: [
                "schema_version", "proposal_id", "correlation_token", "interaction_kind",
                "task_goal", "outcome", "recommended_next", "alternative_next",
                "pause_capsule", "reported_side_effects",
            ]
        )
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
        try validateAction(try object(proposal, "recommended_next"))
        if proposal["alternative_next"] is NSNull {
            // Explicit null is the only disabled alternative representation.
        } else {
            try validateAction(try object(proposal, "alternative_next"))
        }
        let pause = try object(proposal, "pause_capsule")
        try exactKeys(pause, required: ["resume_first"])
        _ = try nonEmptyString(pause, "resume_first", maximum: 8_192)
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
        cwd: String
    ) throws -> QueuedPromptResolution {
        // `codex queue` may canonically decompose non-ASCII command-line
        // message text before it reaches UserPromptSubmit. Normalize only for
        // the fixed marker/reference comparison; the durable claim below
        // still seals the exact prompt bytes that the Hook actually received.
        let normalizedPrompt = prompt.precomposedStringWithCanonicalMapping
        guard !normalizedPrompt.hasPrefix(Self.legacyQueuedPromptPrefix) else {
            return .rejected
        }
        guard normalizedPrompt.hasPrefix(Self.queuedPromptPrefix) else { return .human }
        let reference = String(normalizedPrompt.dropFirst(Self.queuedPromptPrefix.count))
        guard Self.isQueuedPromptReference(reference),
              Self.byteExact(
                  normalizedPrompt,
                  Self.queuedPromptMessage(reference: reference)
              )
        else { return .rejected }

        let state = try routing.authoritativeState()
        var matches: [(continuation: CoordinatorContinuationState, actionJSON: Data)] = []
        for continuation in state.continuations.values {
            guard continuation.dispatchMode == "queued_next_turn",
                  continuation.consumedAt != nil,
                  continuation.transport?.status == .completed,
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
            matches.append((continuation, actionJSON))
        }
        guard matches.count == 1, let match = matches.first else {
            return .rejected
        }
        let queuedPromptSHA256 = Self.sha256Fingerprint(Data(prompt.utf8))
        let cwdSHA256 = Self.sha256Fingerprint(Data(cwd.utf8))
        let actionSHA256 = Self.sha256Fingerprint(match.actionJSON)
        let claimedActionJSON: Data
        do {
            claimedActionJSON = try routing.routeQueuedActionContextClaim(
                StrictJSONTransport.data(forJSONObject: [
                    "type": "claim_queued_action_context",
                    "event_id": idGenerator("event_queued_action_context_claimed"),
                    "occurred_at": try wallInstantGenerator().rawValue,
                    "binding": match.continuation.binding.jsonObject,
                    "continuation_id": match.continuation.continuationID,
                    "delivery_turn_id": turnID,
                    "queued_prompt_sha256": queuedPromptSHA256,
                    "cwd_sha256": cwdSHA256,
                    "action_sha256": actionSHA256,
                ])
            )
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
            .prefix(queuedPromptReferenceBytes)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func sha256Fingerprint(_ data: Data) -> String {
        "sha256:" + SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func queuedPromptMessage(reference: String) -> String {
        queuedPromptPrefix + reference
    }

    private static func isQueuedPromptReference(_ value: String) -> Bool {
        value.utf8.count == queuedPromptReferenceBytes * 2
            && value.utf8.allSatisfy { byte in
                (byte >= 0x30 && byte <= 0x39)
                    || (byte >= 0x61 && byte <= 0x66)
            }
    }

    private func promptContext(session: Session) throws -> Data {
        guard let episode = session.episode,
              let turnID = session.latestTurnID,
              let promptID = session.latestPromptID,
              let correlation = session.correlationToken
        else { throw CoordinatorError("session_prompt_context_missing") }
        let identifiers = try publicIdentifiers(session: session)
        var context = "Blabee boundary: project_id=\(session.projectID); session_id=\(session.sessionID); source_turn_id=\(turnID); source_prompt_id=\(promptID); episode_id=\(episode.episodeID); episode_root_prompt_id=\(episode.rootPromptID); episode_baseline_checkpoint_id=\(episode.baselineCheckpointID); correlation_token=\(correlation). Use these exact values only when calling blabee.emit_decision. For an action-type request, every completed, partial, blocked, or failed result must call it before finalizing, even when the result is short or text-only. Do not call it for explanations, structure descriptions, status checks, or general questions."
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

    func nextGeneration(_ value: UInt64) throws -> UInt64 {
        let (next, overflow) = value.addingReportingOverflow(1)
        try require(!overflow, "request_generation_overflow")
        return next
    }

    static func normalizedPath(_ path: String) throws -> String {
        try require(path.hasPrefix("/"), "project_path_invalid")
        return URL(fileURLWithPath: path).standardizedFileURL.path
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
