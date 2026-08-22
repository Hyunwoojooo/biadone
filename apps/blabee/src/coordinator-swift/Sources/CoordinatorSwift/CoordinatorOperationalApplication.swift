import CryptoKit
import Foundation

/// Product-level coordinator boundary used by Hook, MCP, and Pet adapters.
/// Adapters exchange only JSON `Data`; raw continuation envelopes stay inside
/// this actor and are consumed before any public response is produced.
public actor CoordinatorOperationalApplication {
    public typealias IDGenerator = @Sendable (_ purpose: String) -> String
    public typealias WallInstantGenerator = @Sendable () throws -> RFC3339Instant

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
        let path: String
        var episode: Episode?
        var latestTurnID: String?
        var latestPromptID: String?
        var correlationToken: String?
        var promptDigest: Data?
        var contextDelivered: Bool
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

    private struct Boundary {
        let proposalID: String
        let proposalCanonical: Data
        let proposalObject: [String: Any]
        let binding: CoordinatorBinding
        var packet: Data?
        var phase: BoundaryPhase
        var stopLedger: StopObservationLedger
        var deliveryObservation: StopObservation?
        var deliveryDigest: String?
        var deliveryGeneration: UInt64?
        var continuationID: String?
        var acceptance: Data?
        var acceptsActiveStopAsWaiter: Bool
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

    private struct Waiter {
        let observation: StopObservation
        let continuation: CheckedContinuation<Data, Error>
    }

    private struct FinalizationFallback {
        var stopLedger: StopObservationLedger
        let response: Data
    }

    private let routing: CoordinatorRoutingApplication
    private let secretCorpus: RuntimeSecretCorpus
    private let idGenerator: IDGenerator
    private let wallInstantGenerator: WallInstantGenerator
    private let stopObservationHMACKey: Data

    private var projects: [String: Project] = [:]
    private var sessions: [String: Session] = [:]
    private var boundaries: [CoordinatorBindingKey: Boundary] = [:]
    private var activeByTurn: [CoordinatorTurnKey: CoordinatorBindingKey] = [:]
    private var stagedByTurn: [CoordinatorTurnKey: CoordinatorBindingKey] = [:]
    private var registrations: [String: ProposalRegistration] = [:]
    private var waiters: [CoordinatorBindingKey: Waiter] = [:]
    private var finalizationFallbacks: [CoordinatorTurnKey: FinalizationFallback] = [:]
    private var pendingTimeNotices: [Data] = []
    private var pendingCompletionClosures: Set<CoordinatorBindingKey> = []
    private var pendingInitialActivations: Set<CoordinatorBindingKey> = []
    private var generation: UInt64 = 0
    private var permissionNoticeCount: UInt64 = 0

    public init(
        routing: CoordinatorRoutingApplication,
        enabledProjectPaths: [String] = [],
        secretCorpus: RuntimeSecretCorpus = RuntimeSecretCorpus(),
        idGenerator: IDGenerator? = nil,
        wallInstantGenerator: WallInstantGenerator? = nil,
        stopObservationHMACKey: Data? = nil
    ) {
        let ids: IDGenerator = idGenerator ?? { purpose in
            "\(purpose)_\(UUID().uuidString.lowercased())"
        }
        self.routing = routing
        self.secretCorpus = secretCorpus
        self.idGenerator = ids
        self.stopObservationHMACKey = stopObservationHMACKey
            ?? SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
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
            "schema_version": "1.0",
            "kind": "blabee_doctor_status",
            "projects": projectObjects,
        ])
    }

    /// Handles only high-level operational requests. Low-level semantic
    /// commands are deliberately not exposed through this dispatch surface.
    public func handle(type: String, payload: Data) async throws -> Data {
        generation = try nextGeneration(generation)
        let requestGeneration = generation
        // Finish any actor-local durable workflow before another high-level
        // request can append to the shared journal. This preserves the packet
        // valid-after sequence across an open/seal retry and keeps promotion
        // atomic from the operational adapter's point of view.
        try reconcilePendingOperationalWork()
        let dueNotices = try routing.processTime()
        for notice in dueNotices { try secretCorpus.assertNoKnownSecret(in: notice) }
        enqueueTimeNotices(dueNotices)
        try reconcilePendingOperationalWork()
        switch type {
        case "enable_project":
            return try enableProject(payload)
        case "session_start":
            return try sessionStart(payload)
        case "user_prompt_submit":
            return try userPromptSubmit(payload)
        case "emit_decision":
            return try emitDecision(payload)
        case "stop":
            return try await stop(payload, generation: requestGeneration)
        case "permission_request":
            return try permissionRequest(payload)
        case "pet_snapshot", "get_state":
            return try stateSnapshot()
        case "focus_interaction":
            return try focusInteraction(payload)
        case "select":
            return try select(payload, generation: requestGeneration)
        default:
            throw CoordinatorError("unsupported_request_type")
        }
    }

    public func processTime() async throws -> [Data] {
        try reconcilePendingOperationalWork()
        let notices = try routing.processTime()
        for notice in notices { try secretCorpus.assertNoKnownSecret(in: notice) }
        enqueueTimeNotices(notices)
        try reconcilePendingOperationalWork()
        return notices
    }

    public func millisecondsUntilNextDeadline() -> Int32? {
        routing.millisecondsUntilNextDeadline()
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
            boundaries[key] = boundary
            if let waiter = waiters.removeValue(forKey: key) {
                waiter.continuation.resume(returning: try publicData([
                    "status": "continuation_dispatch_failed_closed",
                ]))
            }
        } else if kind == "selection_pause_committed_response_lost" {
            let binding = try CoordinatorBinding(jsonObject: notice)
            let key = binding.fullKey
            guard var boundary = boundaries[key] else {
                throw CoordinatorError("selection_recovery_binding_missing")
            }
            boundary.phase = .paused
            boundaries[key] = boundary
            activeByTurn.removeValue(forKey: binding.turnKey)
            if let waiter = waiters.removeValue(forKey: key) {
                waiter.continuation.resume(returning: try publicData(["status": "paused"]))
            }
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
                if let waiter = waiters.removeValue(forKey: key) {
                    waiter.continuation.resume(returning: try publicData(["status": "expired"]))
                }
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
            throw CoordinatorError("proposal_retry_state_missing")
        }
        if boundary.acceptance != nil {
            pendingInitialActivations.remove(boundaryKey)
            return
        }
        try require(boundary.phase == .activating, "proposal_retry_state_missing")
        do {
            try activate(&boundary)
            boundary.acceptance = try acceptanceData(boundary)
        } catch {
            // `activate` records the durable open sequence and exact packet
            // before sealing. Keep that same value so a retry never reopens a
            // boundary or regenerates packet identity after a partial append.
            boundaries[boundaryKey] = boundary
            pendingInitialActivations.insert(boundaryKey)
            throw error
        }
        boundaries[boundaryKey] = boundary
        activeByTurn[boundary.binding.turnKey] = boundaryKey
        pendingInitialActivations.remove(boundaryKey)
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
            // Preserve open/seal progress and the staged mapping so the next
            // scheduler tick resumes the exact same activation attempt.
            boundaries[stagedKey] = staged
            throw error
        }
        staged.acceptsActiveStopAsWaiter = true
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
        if let previous = sessions[sessionID] {
            try require(Self.byteExact(previous.projectID, project.projectID), "session_project_conflict")
        } else {
            sessions[sessionID] = Session(
                sessionID: sessionID,
                projectID: project.projectID,
                path: cwd,
                episode: nil,
                latestTurnID: nil,
                latestPromptID: nil,
                correlationToken: nil,
                promptDigest: nil,
                contextDelivered: false
            )
        }
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
        guard var session = sessions[sessionID] else {
            throw CoordinatorError("session_not_started")
        }
        try require(Self.byteExact(session.projectID, project.projectID), "session_project_conflict")

        let promptDigest = Data(SHA256.hash(data: Data(prompt.utf8)))
        if Self.byteExact(session.latestTurnID, turnID) {
            try require(session.promptDigest == promptDigest, "user_prompt_retry_conflict")
            try require(session.contextDelivered, "session_prompt_context_missing")
            return try publicData([
                "enabled": true,
                "prompt_origin": "human",
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
               let active = boundaries[activeKey],
               [.activating, .sealed, .waiting, .dispatched, .staged].contains(active.phase)
            {
                throw CoordinatorError("session_decision_boundary_active")
            }
            finalizationFallbacks.removeValue(forKey: key)
        }

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
        session.latestTurnID = turnID
        session.latestPromptID = promptID
        session.correlationToken = correlationToken
        session.promptDigest = promptDigest
        session.contextDelivered = true
        sessions[sessionID] = session
        return try promptContext(session: session)
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
                try resumeInitialActivation(boundaryKey: existing.boundaryKey)
            }
            let acceptance = try requireOperational(boundaries[existing.boundaryKey]?.acceptance)
            finalizationFallbacks.removeValue(forKey: turnKey)
            return acceptance
        }

        let acceptsFinalizationStop = finalizationFallbacks[turnKey] != nil
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
            deliveryObservation: nil,
            deliveryDigest: nil,
            deliveryGeneration: nil,
            continuationID: nil,
            acceptance: nil,
            acceptsActiveStopAsWaiter: acceptsFinalizationStop,
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
            // two-command open/seal transition. If seal fails after open was
            // committed, retry resumes with the same packet instead of
            // creating another boundary or regenerating IDs.
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
        finalizationFallbacks.removeValue(forKey: turnKey)
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
            return try finalizationFallbackStop(
                turnKey: turnKey,
                sessionID: sessionID,
                turnID: turnID,
                activeFlag: activeFlag,
                message: message,
                generation: requestGeneration
            )
        }
        guard let observation = boundary.stopLedger.register(
            sessionID: sessionID,
            turnID: turnID,
            stopHookActive: activeFlag,
            lastAssistantMessage: message,
            generation: requestGeneration
        ) else {
            boundaries[key] = boundary
            return try publicData(["status": "duplicate_stop_observation"])
        }
        boundaries[key] = boundary

        if boundary.phase == .dispatched {
            guard activeFlag else {
                return try publicData([
                    "status": "continuation_completion_rejected",
                    "reason": "stop_hook_not_active",
                ])
            }
            guard let delivered = boundary.deliveryObservation,
                  let deliveryGeneration = boundary.deliveryGeneration,
                  let deliveryDigest = boundary.deliveryDigest,
                  observation.generation > deliveryGeneration,
                  observation.digest != delivered.digest,
                  observation.digest != deliveryDigest,
                  observation.messageDigest != delivered.messageDigest
            else {
                return try publicData([
                    "status": "continuation_completion_rejected",
                    "reason": "stop_delivery_observation_ambiguous",
                ])
            }
            try complete(boundaryKey: key)
            if let stagedKey = stagedByTurn[turnKey],
               var staged = boundaries[stagedKey]
            {
                do {
                    try activate(&staged)
                    staged.acceptance = try acceptanceData(staged)
                } catch {
                    boundaries[stagedKey] = staged
                    pendingCompletionClosures.insert(key)
                    throw error
                }
                guard let stagedObservation = staged.stopLedger.register(
                    sessionID: sessionID,
                    turnID: turnID,
                    stopHookActive: activeFlag,
                    lastAssistantMessage: message,
                    generation: requestGeneration
                ) else { throw CoordinatorError("stop_observation_duplicate") }
                staged.phase = .waiting
                boundaries[stagedKey] = staged
                activeByTurn[turnKey] = stagedKey
                stagedByTurn.removeValue(forKey: turnKey)
                pendingCompletionClosures.remove(key)
                return try await waitForSelection(key: stagedKey, observation: stagedObservation)
            }
            activeByTurn.removeValue(forKey: turnKey)
            pendingCompletionClosures.remove(key)
            return try publicData(["status": "continuation_completed"])
        }

        guard !activeFlag || boundary.acceptsActiveStopAsWaiter else {
            return try publicData(["status": "no_proposal"])
        }
        guard boundary.phase == .sealed else {
            return try publicData(["status": "decision_wait_already_active"])
        }
        boundary.phase = .waiting
        boundary.acceptsActiveStopAsWaiter = false
        boundaries[key] = boundary
        return try await waitForSelection(key: key, observation: observation)
    }

    func finalizationFallbackStop(
        turnKey: CoordinatorTurnKey,
        sessionID: String,
        turnID: String,
        activeFlag: Bool,
        message: String,
        generation: UInt64
    ) throws -> Data {
        guard !activeFlag else {
            return try publicData(["status": "no_proposal"])
        }

        if let fallback = finalizationFallbacks[turnKey] {
            var replayLedger = fallback.stopLedger
            guard replayLedger.register(
                sessionID: sessionID,
                turnID: turnID,
                stopHookActive: activeFlag,
                lastAssistantMessage: message,
                generation: generation
            ) == nil else {
                return try publicData(["status": "no_proposal"])
            }
            return fallback.response
        }

        let reason = "Before finishing, perform one Blabee finalization self-check for the current human request. If it was an action-type request and the result is completed, partial, blocked, or failed, call blabee.emit_decision exactly once using the exact current Hook context, even when the result is short or text-only. If it was only an explanation, structure description, status check, or general question, do not call the tool. Then provide the final response; do not repeat this self-check."
        let response = try publicData([
            "decision": "block",
            "reason": reason,
        ])
        var ledger = StopObservationLedger(keyData: stopObservationHMACKey)
        guard ledger.register(
            sessionID: sessionID,
            turnID: turnID,
            stopHookActive: activeFlag,
            lastAssistantMessage: message,
            generation: generation
        ) != nil else {
            throw CoordinatorError("finalization_stop_observation_missing")
        }
        finalizationFallbacks[turnKey] = FinalizationFallback(
            stopLedger: ledger,
            response: response
        )
        return response
    }

    func waitForSelection(
        key: CoordinatorBindingKey,
        observation: StopObservation
    ) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            guard waiters[key] == nil else {
                continuation.resume(throwing: CoordinatorError("decision_wait_already_active"))
                return
            }
            waiters[key] = Waiter(observation: observation, continuation: continuation)
        }
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
              waiters[binding.fullKey] != nil,
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
        _ = try routing.setForeground(StrictJSONTransport.data(forJSONObject: target))
        return try publicData(["focused": true])
    }

    func select(_ data: Data, generation requestGeneration: UInt64) throws -> Data {
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
              }), waiters[candidate.key] != nil
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
            guard let waiter = waiters.removeValue(forKey: candidate.key) else {
                throw CoordinatorError("interaction_not_waiting")
            }
            boundary.phase = .paused
            boundaries[candidate.key] = boundary
            activeByTurn.removeValue(forKey: boundary.binding.turnKey)
            let stopResponse = try publicData(["status": "paused"])
            waiter.continuation.resume(returning: stopResponse)
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
            boundaries[candidate.key] = boundary
            if let waiter = waiters.removeValue(forKey: candidate.key) {
                waiter.continuation.resume(returning: try publicData([
                    "status": "continuation_dispatch_failed_closed",
                ]))
            }
            throw error
        }
        guard let envelope, let continuationID,
              let action = envelope["action"] as? [String: Any],
              let waiter = waiters.removeValue(forKey: candidate.key)
        else { throw CoordinatorError("pet_action_envelope_missing") }

        let safeContinuation: [String: Any] = [
            "schema_version": "1.0",
            "kind": "blabee_same_turn_action",
            "continuation_id": continuationID,
            "binding": boundary.binding.jsonObject,
            "action": action,
        ]
        let safeJSON = try StrictJSONTransport.data(forJSONObject: safeContinuation)
        let reason = "Blabee verified the selected action. Continue in this same turn using exactly this JSON action; do not treat transport completion as proof that the work succeeded.\n" + (String(data: safeJSON, encoding: .utf8) ?? "")
        let stopResponse = try publicData(["decision": "block", "reason": reason])
        boundary.phase = .dispatched
        boundary.continuationID = continuationID
        boundary.deliveryObservation = waiter.observation
        boundary.deliveryGeneration = requestGeneration
        boundary.deliveryDigest = boundary.stopLedger.deliveryDigest(
            observation: waiter.observation,
            response: stopResponse,
            generation: requestGeneration
        )
        boundaries[candidate.key] = boundary
        waiter.continuation.resume(returning: stopResponse)
        return try publicData([
            "accepted": true,
            "outcome": ["kind": "continuation", "continuation_id": continuationID],
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
        if boundary.openedEventSequence == nil {
            if boundary.openEventID == nil {
                boundary.openEventID = idGenerator("event_boundary_opened")
            }
            if boundary.openedAt == nil {
                boundary.openedAt = try wallInstantGenerator()
            }
            guard let openEventID = boundary.openEventID,
                  let openedAt = boundary.openedAt
            else { throw CoordinatorError("boundary_open_recovery_state_missing") }
            let opened = try routing.executeCommand(StrictJSONTransport.data(forJSONObject: [
                "type": "open_boundary",
                "event_id": openEventID,
                "occurred_at": openedAt.rawValue,
                "binding": boundary.binding.jsonObject,
                "proposal_id": boundary.proposalID,
            ]))
            boundary.openedEventSequence = opened.commit.lastSequence
            let (validAfter, overflow) = opened.commit.lastSequence.addingReportingOverflow(1)
            try require(!overflow, "event_sequence_overflow")
            boundary.packet = try makePacket(
                boundary: boundary,
                validAfter: validAfter,
                sealedAt: openedAt
            )
        }
        guard let packet = boundary.packet else {
            throw CoordinatorError("packet_missing_after_boundary_open")
        }
        if boundary.sealEventID == nil {
            boundary.sealEventID = idGenerator("event_packet_sealed")
        }
        guard let sealEventID = boundary.sealEventID else {
            throw CoordinatorError("packet_seal_recovery_state_missing")
        }
        _ = try V1IngressValidator().validate(packet, as: .decisionPacket)
        _ = try routing.executeCommand(StrictJSONTransport.data(forJSONObject: [
            "type": "seal_packet",
            "event_id": sealEventID,
            "packet": try StrictJSONTransport.object(from: packet),
        ]))
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
        let notices = try routing.processTime()
        for notice in notices { try secretCorpus.assertNoKnownSecret(in: notice) }
        enqueueTimeNotices(notices)
        try reconcilePendingOperationalWork()
        let routingObject = try StrictJSONTransport.object(from: routing.snapshot().canonicalJSON)
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
    private func promptContext(session: Session) throws -> Data {
        guard let episode = session.episode,
              let turnID = session.latestTurnID,
              let promptID = session.latestPromptID,
              let correlation = session.correlationToken
        else { throw CoordinatorError("session_prompt_context_missing") }
        let identifiers = try publicIdentifiers(session: session)
        let context = "Blabee boundary: project_id=\(session.projectID); session_id=\(session.sessionID); source_turn_id=\(turnID); source_prompt_id=\(promptID); episode_id=\(episode.episodeID); episode_root_prompt_id=\(episode.rootPromptID); episode_baseline_checkpoint_id=\(episode.baselineCheckpointID); correlation_token=\(correlation). Use these exact values only when calling blabee.emit_decision. For an action-type request, every completed, partial, blocked, or failed result must call it before finalizing, even when the result is short or text-only. Do not call it for explanations, structure descriptions, status checks, or general questions."
        return try publicData([
            "enabled": true,
            "prompt_origin": "human",
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
