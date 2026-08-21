import Foundation

/// Persistence seam used by the semantic coordinator. `SQLiteJournal` is the
/// production implementation; tests can inject a deterministic conflict port.
public protocol CoordinatorSemanticJournalPort: Sendable {
    func load() throws -> JournalSnapshot

    func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data]
    ) throws -> JournalAppendResult
}

extension SQLiteJournal: CoordinatorSemanticJournalPort {
    public func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data]
    ) throws -> JournalAppendResult {
        try append(
            expectedSequence: expectedSequence,
            events: events,
            documents: documents,
            verificationRecords: verificationRecords,
            crashPoint: nil
        )
    }
}

public struct CoordinatorSemanticChange: Sendable, Equatable {
    public let events: [Data]
    public let documents: [Data]
    public let verificationRecords: [Data]
    /// Canonical JSON effects. Raw one-time tokens may appear here, but never in
    /// events, packet documents, or verification sidecars.
    public let effects: [Data]

    public init(
        events: [Data],
        documents: [Data] = [],
        verificationRecords: [Data] = [],
        effects: [Data] = []
    ) {
        self.events = events
        self.documents = documents
        self.verificationRecords = verificationRecords
        self.effects = effects
    }
}

public struct CoordinatorSemanticExecutionResult: Sendable, Equatable {
    public let commit: JournalAppendResult
    public let effects: [Data]
}

/// Synchronous application service intentionally matching SQLiteJournal's
/// process-local API. A token is prepared once before the CAS retry loop, so a
/// sequence conflict cannot silently mint a different authority.
public final class CoordinatorSemanticApplication: @unchecked Sendable {
    public typealias TokenGenerator = @Sendable () throws -> ContinuationTokenMaterial

    private let journal: any CoordinatorSemanticJournalPort
    private let tokenGenerator: TokenGenerator
    private let tokenHMACKey: Data?

    public init(
        journal: any CoordinatorSemanticJournalPort,
        tokenHMACKey: Data? = nil,
        tokenGenerator: TokenGenerator? = nil
    ) {
        self.journal = journal
        self.tokenHMACKey = tokenHMACKey
        self.tokenGenerator = tokenGenerator ?? {
            try ContinuationTokenMaterial.generate(hmacKey: tokenHMACKey)
        }
    }

    public func execute(
        command commandData: Data,
        maxSequenceConflicts: Int = 2
    ) throws -> CoordinatorSemanticExecutionResult {
        try require(maxSequenceConflicts >= 0, "retry_limit_invalid")
        let parsed = try SemanticJSON.command(commandData)
        let commandType = try SemanticJSON.commandType(parsed)
        let tokenMaterial: ContinuationTokenMaterial?
        switch commandType {
        case "select_option", "reserve_format_repair":
            tokenMaterial = try tokenGenerator()
        default:
            tokenMaterial = nil
        }

        var conflicts = 0
        while true {
            let snapshot = try journal.load()
            let state = try CoordinatorSemanticReplay.replay(snapshot)
            let change = try CoordinatorSemanticDecision.decide(
                state: state,
                commandObject: parsed,
                tokenMaterial: tokenMaterial,
                tokenHMACKey: tokenHMACKey
            )
            let candidate = JournalSnapshot(
                events: snapshot.events + change.events,
                documents: snapshot.documents + change.documents,
                verificationRecords: snapshot.verificationRecords + change.verificationRecords,
                journalSequence: state.eventSequence + Int64(change.events.count)
            )
            _ = try CoordinatorSemanticReplay.replay(candidate)
            do {
                let commit = try journal.append(
                    expectedSequence: state.eventSequence,
                    events: change.events,
                    documents: change.documents,
                    verificationRecords: change.verificationRecords
                )
                // Do not expose effects until the complete logical batch is
                // durably accepted. A lost response is therefore not evidence
                // that a new token may be issued.
                return CoordinatorSemanticExecutionResult(commit: commit, effects: change.effects)
            } catch let error as CoordinatorError
                where error.code == "journal_sequence_conflict" && conflicts < maxSequenceConflicts
            {
                conflicts += 1
            }
        }
    }
}

public enum CoordinatorSemanticDecision {
    public static func decide(
        state: CoordinatorSemanticState,
        command: Data,
        tokenMaterial: ContinuationTokenMaterial? = nil,
        tokenHMACKey: Data? = nil
    ) throws -> CoordinatorSemanticChange {
        try decide(
            state: state,
            commandObject: SemanticJSON.command(command),
            tokenMaterial: tokenMaterial,
            tokenHMACKey: tokenHMACKey
        )
    }

    static func decide(
        state: CoordinatorSemanticState,
        commandObject command: [String: Any],
        tokenMaterial: ContinuationTokenMaterial?,
        tokenHMACKey: Data?
    ) throws -> CoordinatorSemanticChange {
        let type = try SemanticJSON.commandType(command)
        switch type {
        case "open_boundary":
            return try openBoundary(state, command)
        case "seal_packet":
            return try sealPacket(state, command)
        case "select_option":
            return try selectOption(
                state,
                command,
                tokenMaterial: tokenMaterial,
                tokenHMACKey: tokenHMACKey
            )
        case "consume_pet_action":
            return try consumePetAction(state, command, hmacKey: tokenHMACKey)
        case "complete_transport":
            return try completeTransport(state, command)
        case "timeout_transport_unknown":
            return try timeoutTransport(state, command)
        case "record_work_outcome":
            return try recordWorkOutcome(state, command)
        case "close_boundary":
            return try closeBoundary(state, command)
        case "reserve_format_repair":
            return try reserveFormatRepair(
                state,
                command,
                tokenMaterial: tokenMaterial,
                tokenHMACKey: tokenHMACKey
            )
        case "claim_format_repair":
            return try claimFormatRepair(state, command, hmacKey: tokenHMACKey)
        case "expire_interaction":
            return try expireInteraction(state, command)
        default:
            throw CoordinatorError("coordinator_command_unknown", "unknown command: \(type)")
        }
    }
}

// MARK: - Decisions

private extension CoordinatorSemanticDecision {
    static let categories: [String: String] = [
        "decision_boundary_opened": "decision_lifecycle",
        "decision_boundary_closed": "decision_lifecycle",
        "decision_packet_sealed": "decision_lifecycle",
        "decision_selection_claimed": "decision_lifecycle",
        "internal_format_repair_reserved": "transport",
        "internal_format_repair_claimed": "transport",
        "continuation_dispatched": "transport",
        "continuation_consumed": "transport",
        "continuation_transport_completed": "transport",
        "continuation_transport_timed_out_unknown": "transport",
        "work_outcome_recorded": "work_outcome",
        "interaction_expired": "decision_lifecycle",
    ]

    static func openBoundary(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorSemanticChange {
        let binding = try SemanticJSON.binding(command, nestedAt: "binding")
        try require(state.boundaries[binding.fullKey] == nil, "decision_boundary_reopened")
        try require(
            state.boundaryIdentities[binding.boundaryKey] == nil,
            "decision_boundary_identity_reused"
        )
        if let latestKey = state.latestBoundaryByTurn[binding.turnKey],
           let latest = state.boundaries[latestKey]
        {
            try require(latest.closed, "previous_decision_boundary_still_open")
            try require(
                binding.sourcePromptID == latest.binding.sourcePromptID
                    && binding.episodeID == latest.binding.episodeID
                    && binding.episodeRootPromptID == latest.binding.episodeRootPromptID
                    && binding.episodeBaselineCheckpointID == latest.binding.episodeBaselineCheckpointID,
                "decision_boundary_lineage_mismatch"
            )
            try require(
                binding.boundarySequence == latest.binding.boundarySequence + 1,
                "boundary_sequence_not_contiguous"
            )
        } else {
            try require(binding.boundarySequence == 1, "boundary_sequence_not_contiguous")
        }
        let proposalID = try SemanticJSON.identifier(command, "proposal_id")
        let eventID = try SemanticJSON.identifier(command, "event_id")
        try require(!state.eventIDs.contains(eventID), "runtime_event_id_duplicate")
        let occurredAt = try SemanticJSON.timestampString(
            command,
            "occurred_at",
            code: "runtime_event_time_invalid"
        )
        let event = try event(
            state: state,
            type: "decision_boundary_opened",
            id: eventID,
            occurredAt: occurredAt,
            binding: binding,
            payload: ["proposal_id": proposalID]
        )
        return try change(events: [event])
    }

    static func sealPacket(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorSemanticChange {
        guard let packetObject = command["packet"] as? [String: Any] else {
            throw CoordinatorError("packet_document_kind_invalid")
        }
        let packetData = try StrictJSON.canonicalData(for: packetObject)
        let packet = try CoordinatorPacketDocument.parse(packetData)
        let boundary = try openBoundaryState(state, packet.binding)
        try state.assertSessionPendingSlotAvailable(for: packet.binding)
        try require(!boundary.expired, "interaction_already_expired")
        try require(boundary.selection == nil, "decision_packet_reseal_after_claim")
        try require(boundary.repair == nil || boundary.repair?.claimedAt != nil, "format_repair_not_claimed_before_packet")
        try require(
            packet.validAfterEventSequence == state.eventSequence + 1,
            "packet_document_valid_after_sequence_mismatch"
        )
        try require(state.packetDocuments[packet.revisionKey] == nil, "packet_document_duplicate")
        if let current = boundary.packet {
            try require(packet.interactionID == current.interactionID, "decision_packet_identity_changed")
            try require(packet.packetID == current.packetID, "decision_packet_identity_changed")
            try require(packet.revision == current.revision + 1, "decision_packet_revision_not_contiguous")
            try require(packet.sealedAt < current.expiresAt, "decision_packet_reseal_after_expiry")
        } else {
            try require(packet.revision == 1, "decision_packet_initial_revision_invalid")
        }
        let eventObject = try event(
            state: state,
            type: "decision_packet_sealed",
            id: SemanticJSON.identifier(command, "event_id"),
            occurredAt: packet.sealedAt.rawValue,
            binding: packet.binding,
            payload: [
                "interaction_id": packet.interactionID,
                "packet_id": packet.packetID,
                "revision": packet.revision,
                "expires_at": packet.expiresAt.rawValue,
            ]
        )
        return try change(events: [eventObject], documents: [packet.canonicalJSON])
    }

    static func selectOption(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any],
        tokenMaterial: ContinuationTokenMaterial?,
        tokenHMACKey: Data?
    ) throws -> CoordinatorSemanticChange {
        guard let request = command["request"] as? [String: Any] else {
            throw CoordinatorError("selection_schema_version_invalid")
        }
        try require(request["schema_version"] as? String == "1.0", "selection_schema_version_invalid")
        try require(request["kind"] as? String == "blabee_selection_request", "selection_kind_invalid")
        for key in ["slot", "action_id", "action", "continuation_token"] {
            try require(request[key] == nil, "selection_request_contains_untrusted_execution_data")
        }
        _ = try SemanticJSON.identifier(request, "selection_id")
        let binding = try CoordinatorBinding(jsonObject: request)
        let boundary = try boundaryState(state, binding)
        try require(state.latestBoundaryByTurn[binding.turnKey] == binding.fullKey, "stale_decision_boundary")
        try require(!boundary.closed, "decision_boundary_closed")
        try require(!boundary.expired, "interaction_already_expired")
        try require(boundary.selection == nil, "selection_already_claimed")
        guard let current = boundary.packet else { throw CoordinatorError("decision_packet_missing") }
        try require(
            (request["interaction_id"] as? String).map {
                IdentifierNormalization.isByteExact($0, current.interactionID)
            } == true,
            "decision_boundary_binding_mismatch"
        )
        try require(
            (request["packet_id"] as? String).map {
                IdentifierNormalization.isByteExact($0, current.packetID)
            } == true,
            "decision_boundary_binding_mismatch"
        )
        try require(ExactJSONInteger.int64(request["revision"], minimum: 1) == current.revision, "decision_packet_revision_stale")
        let occurredAt = try SemanticJSON.timestamp(command, "occurred_at", code: "decision_selection_time_invalid")
        try require(occurredAt < current.expiresAt, "decision_packet_expired")
        guard let packet = state.packetDocuments[current.documentKey] else {
            throw CoordinatorError("packet_document_missing")
        }
        guard let optionID = request["option_id"] as? String,
              let choice = packet.choices.first(where: {
                  IdentifierNormalization.isByteExact($0.optionID, optionID)
              })
        else {
            throw CoordinatorError("decision_option_not_found")
        }
        try require(choice.enabled, "decision_option_disabled")
        let occurredText = try SemanticJSON.timestampString(command, "occurred_at", code: "continuation_time_invalid")
        func selectionClaim(_ eventIDs: [String: Any]) throws -> [String: Any] {
            try event(
                state: state,
                type: "decision_selection_claimed",
                id: SemanticJSON.identifier(eventIDs, "selection_claimed", field: "event_id"),
                occurredAt: occurredText,
                binding: binding,
                payload: [
                    "selection_id": request["selection_id"]!,
                    "interaction_id": packet.interactionID,
                    "packet_id": packet.packetID,
                    "revision": packet.revision,
                    "option_id": choice.optionID,
                ]
            )
        }
        if choice.slot == 3 {
            guard let eventIDs = command["event_ids"] as? [String: Any] else {
                throw CoordinatorError("event_id_missing")
            }
            let claim = try selectionClaim(eventIDs)
            let close = try event(
                state: state,
                type: "decision_boundary_closed",
                id: SemanticJSON.identifier(eventIDs, "decision_boundary_closed", field: "event_id"),
                occurredAt: occurredText,
                binding: binding,
                payload: ["close_reason": "episode_paused"],
                sequenceOffset: 2
            )
            var effect: [String: Any] = [
                "kind": "episode_paused",
                "selection_id": request["selection_id"]!,
                "interaction_id": packet.interactionID,
                "packet_id": packet.packetID,
                "revision": packet.revision,
                "option_id": choice.optionID,
            ]
            effect.merge(binding.jsonObject) { current, _ in current }
            return try change(events: [claim, close], effects: [effect])
        }
        try require(choice.slot != 4, "rollback_not_supported_in_core")
        guard (choice.slot == 1 || choice.slot == 2),
              let actionID = choice.actionID,
              let actionData = choice.actionJSON,
              let action = try JSONSerialization.jsonObject(with: actionData) as? [String: Any]
        else { throw CoordinatorError("decision_option_not_pet_action") }
        guard let tokenMaterial else { throw CoordinatorError("token_material_missing") }
        try validateTokenMaterial(tokenMaterial, hmacKey: tokenHMACKey)
        try require(state.tokenFingerprints[tokenMaterial.fingerprint] == nil, "token_fingerprint_duplicate")
        let continuationID = try SemanticJSON.identifier(command, "continuation_id")
        try require(state.continuationIdentities[continuationID] == nil, "continuation_already_dispatched")
        let issuedAt = try SemanticJSON.timestamp(command, "issued_at", code: "continuation_time_invalid")
        let expiresAt = try SemanticJSON.timestamp(command, "expires_at", code: "continuation_time_invalid")
        let deadlineAt = try SemanticJSON.timestamp(command, "in_flight_deadline_at", code: "continuation_time_invalid")
        try require(issuedAt <= occurredAt && occurredAt < expiresAt, "continuation_time_invalid")
        try require(expiresAt <= deadlineAt, "continuation_expiry_after_in_flight_deadline")
        guard let eventIDs = command["event_ids"] as? [String: Any] else {
            throw CoordinatorError("event_id_missing")
        }
        let claim = try selectionClaim(eventIDs)
        let dispatchID = try SemanticJSON.identifier(eventIDs, "continuation_dispatched", field: "event_id")
        let dispatch = try event(
            state: state,
            type: "continuation_dispatched",
            id: dispatchID,
            occurredAt: occurredText,
            binding: binding,
            payload: [
                "continuation_id": continuationID,
                "interaction_id": packet.interactionID,
                "packet_id": packet.packetID,
                "revision": packet.revision,
                "option_id": choice.optionID,
                "action_id": actionID,
                "dispatch_mode": "same_turn_stop",
                "issued_at": issuedAt.rawValue,
                "expires_at": expiresAt.rawValue,
                "in_flight_deadline_at": deadlineAt.rawValue,
            ],
            sequenceOffset: 2
        )
        var verification: [String: Any] = [
            "schema_version": "1.0",
            "kind": "blabee_continuation_verification_record",
            "dispatch_event_id": dispatchID,
            "continuation_id": continuationID,
            "interaction_id": packet.interactionID,
            "packet_id": packet.packetID,
            "revision": packet.revision,
            "option_id": choice.optionID,
            "action_id": actionID,
            "correlation_token_fingerprint": tokenMaterial.fingerprint,
        ]
        verification.merge(binding.jsonObject) { current, _ in current }
        var envelope: [String: Any] = [
            "schema_version": "1.0",
            "kind": "blabee_episode_continuation",
            "continuation_origin": "pet_action",
            "dispatch_mode": "same_turn_stop",
            "continuation_id": continuationID,
            "continuation_token": tokenMaterial.token,
            "interaction_id": packet.interactionID,
            "packet_id": packet.packetID,
            "revision": packet.revision,
            "option_id": choice.optionID,
            "action_id": actionID,
            "action": action,
            "issued_at": issuedAt.rawValue,
            "expires_at": expiresAt.rawValue,
            "in_flight_deadline_at": deadlineAt.rawValue,
        ]
        envelope.merge(binding.jsonObject) { current, _ in current }
        try validateGeneratedEnvelope(envelope)
        return try change(
            events: [claim, dispatch],
            verificationRecords: [verification],
            effects: [["kind": "pet_action_envelope_ready", "envelope": envelope]]
        )
    }

    static func consumePetAction(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any],
        hmacKey: Data?
    ) throws -> CoordinatorSemanticChange {
        guard let envelope = command["envelope"] as? [String: Any] else {
            throw CoordinatorError("continuation_envelope_invalid")
        }
        try require(
            envelope["schema_version"] as? String == "1.0"
                && envelope["kind"] as? String == "blabee_episode_continuation",
            "continuation_envelope_invalid"
        )
        try require(envelope["continuation_origin"] as? String == "pet_action", "continuation_origin_mismatch")
        try require(envelope["dispatch_mode"] as? String == "same_turn_stop", "dispatch_mode_conflict")
        guard let continuationID = envelope["continuation_id"] as? String,
              IdentifierNormalization.isNFC(continuationID),
              let continuation = state.continuations[continuationID]
        else {
            throw CoordinatorError("continuation_not_dispatched")
        }
        let binding = try CoordinatorBinding(jsonObject: envelope)
        try require(binding == continuation.binding, "decision_boundary_binding_mismatch")
        for (key, expected): (String, Any) in [
            ("interaction_id", continuation.interactionID),
            ("packet_id", continuation.packetID),
            ("revision", continuation.revision),
            ("option_id", continuation.optionID),
            ("action_id", continuation.actionID),
        ] {
            try require(SemanticJSON.equal(envelope[key], expected), "continuation_binding_mismatch")
        }
        for (key, expected) in [
            ("issued_at", continuation.issuedAt.rawValue),
            ("expires_at", continuation.expiresAt.rawValue),
            ("in_flight_deadline_at", continuation.inFlightDeadlineAt.rawValue),
        ] {
            try require(envelope[key] as? String == expected, "continuation_binding_mismatch")
        }
        guard let boundary = state.boundaries[continuation.binding.fullKey],
              let current = boundary.packet,
              let packet = state.packetDocuments[current.documentKey],
              let choice = packet.choices.first(where: { $0.optionID == continuation.optionID }),
              let expectedAction = choice.actionJSON,
              let suppliedAction = envelope["action"]
        else { throw CoordinatorError("continuation_action_mismatch") }
        let suppliedActionData = try StrictJSON.canonicalData(for: suppliedAction)
        try require(suppliedActionData == expectedAction, "continuation_action_mismatch")
        try require(continuation.consumedAt == nil, "continuation_already_consumed")
        try require(continuation.transport == nil, "transport_already_terminal")
        let occurredAt = try SemanticJSON.timestamp(command, "occurred_at", code: "continuation_consumed_time_invalid")
        try require(occurredAt >= continuation.issuedAt, "continuation_not_yet_valid")
        try require(occurredAt < continuation.expiresAt, "continuation_expired")
        guard let verification = state.verificationRecords[continuationID] else {
            throw CoordinatorError("continuation_verification_missing")
        }
        guard let token = envelope["continuation_token"] as? String,
              ContinuationTokenMaterial.verify(
                token: token,
                fingerprint: verification.correlationTokenFingerprint,
                hmacKey: hmacKey
              )
        else { throw CoordinatorError("continuation_token_invalid") }
        let eventObject = try event(
            state: state,
            type: "continuation_consumed",
            id: SemanticJSON.identifier(command, "event_id"),
            occurredAt: occurredAt.rawValue,
            binding: continuation.binding,
            payload: [
                "continuation_id": continuationID,
                "dispatch_mode": continuation.dispatchMode,
            ]
        )
        return try change(events: [eventObject])
    }

    static func completeTransport(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorSemanticChange {
        let continuation = try continuationForCommand(state, command)
        try require(continuation.consumedAt != nil, "continuation_not_consumed")
        try require(continuation.transport == nil, "transport_already_terminal")
        let occurredAt = try SemanticJSON.timestamp(command, "occurred_at", code: "transport_completion_time_invalid")
        try require(occurredAt < continuation.inFlightDeadlineAt, "transport_completion_after_in_flight_deadline")
        let eventObject = try event(
            state: state,
            type: "continuation_transport_completed",
            id: SemanticJSON.identifier(command, "event_id"),
            occurredAt: occurredAt.rawValue,
            binding: continuation.binding,
            payload: [
                "continuation_id": continuation.continuationID,
                "transport_status": "completed",
                "work_outcome_status": "not_recorded",
            ]
        )
        return try change(events: [eventObject])
    }

    static func timeoutTransport(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorSemanticChange {
        let continuation = try continuationForCommand(state, command)
        try require(continuation.transport == nil, "transport_already_terminal")
        let occurredAt = try SemanticJSON.timestamp(command, "occurred_at", code: "timeout_occurred_at_invalid")
        try require(occurredAt >= continuation.inFlightDeadlineAt, "timeout_before_in_flight_deadline")
        let eventObject = try event(
            state: state,
            type: "continuation_transport_timed_out_unknown",
            id: SemanticJSON.identifier(command, "event_id"),
            occurredAt: occurredAt.rawValue,
            binding: continuation.binding,
            payload: [
                "continuation_id": continuation.continuationID,
                "transport_status": "timed_out_unknown",
                "work_outcome_status": "unknown",
                "automatic_retry": false,
                "cancellation_inferred": false,
                "failure_inferred": false,
            ]
        )
        return try change(events: [eventObject])
    }

    static func recordWorkOutcome(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorSemanticChange {
        let continuation = try continuationForCommand(state, command)
        guard let boundary = state.boundaries[continuation.binding.fullKey] else {
            throw CoordinatorError("unknown_decision_boundary")
        }
        try require(!boundary.closed, "decision_boundary_closed")
        try require(continuation.transport != nil, "transport_terminal_observation_missing")
        try require(continuation.workOutcome == nil, "work_outcome_already_recorded")
        guard let status = command["status"] as? String,
              ["succeeded", "failed", "cancelled", "unknown"].contains(status)
        else { throw CoordinatorError("work_outcome_status_invalid") }
        let summary = try SemanticJSON.nonEmpty(command, "summary")
        guard let evidenceValues = command["evidence_ids"] as? [Any], evidenceValues.count <= 256 else {
            throw CoordinatorError("evidence_ids_invalid")
        }
        let evidenceIDs = try evidenceValues.map { value -> String in
            guard let value = value as? String else { throw CoordinatorError("evidence_id_missing") }
            return try SemanticJSON.identifier(value, field: "evidence_id")
        }
        let eventID = try SemanticJSON.identifier(command, "event_id")
        try require(!state.eventIDs.contains(eventID), "runtime_event_id_duplicate")
        let occurredAt = try SemanticJSON.timestampString(command, "occurred_at", code: "runtime_event_time_invalid")
        let eventObject = try event(
            state: state,
            type: "work_outcome_recorded",
            id: eventID,
            occurredAt: occurredAt,
            binding: continuation.binding,
            payload: [
                "continuation_id": continuation.continuationID,
                "action_id": continuation.actionID,
                "work_outcome_status": status,
                "summary": summary,
                "evidence_ids": evidenceIDs,
            ]
        )
        return try change(events: [eventObject])
    }

    static func closeBoundary(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorSemanticChange {
        let binding = try SemanticJSON.binding(command, nestedAt: "binding")
        let boundary = try boundaryState(state, binding)
        try require(!boundary.closed, "decision_boundary_already_closed")
        let rawReason = command["close_reason"] as? String
        if boundary.selection?.slot == 3 {
            try require(rawReason == "episode_paused", "pause_selection_close_reason_invalid")
        }
        if rawReason == "episode_paused" {
            try require(boundary.selection?.slot == 3, "episode_pause_selection_missing")
        }
        if boundary.selection?.slot == 1 || boundary.selection?.slot == 2 {
            try require(boundary.dispatchedContinuationID != nil, "transport_terminal_observation_missing")
        }
        if let continuationID = boundary.dispatchedContinuationID {
            let status = state.continuations[continuationID]?.transport?.status
            try require(status == .completed || status == .timedOutUnknown, "transport_terminal_observation_missing")
        }
        let reason = try SemanticJSON.stableCode(command, "close_reason", code: "close_reason_invalid")
        let eventID = try SemanticJSON.identifier(command, "event_id")
        try require(!state.eventIDs.contains(eventID), "runtime_event_id_duplicate")
        let occurredAt = try SemanticJSON.timestampString(
            command,
            "occurred_at",
            code: "runtime_event_time_invalid"
        )
        let eventObject = try event(
            state: state,
            type: "decision_boundary_closed",
            id: eventID,
            occurredAt: occurredAt,
            binding: binding,
            payload: ["close_reason": reason]
        )
        return try change(events: [eventObject])
    }

    static func reserveFormatRepair(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any],
        tokenMaterial: ContinuationTokenMaterial?,
        tokenHMACKey: Data?
    ) throws -> CoordinatorSemanticChange {
        guard let tokenMaterial else { throw CoordinatorError("token_material_missing") }
        try validateTokenMaterial(tokenMaterial, hmacKey: tokenHMACKey)
        try require(state.tokenFingerprints[tokenMaterial.fingerprint] == nil, "token_fingerprint_duplicate")
        let continuationID = try SemanticJSON.identifier(command, "continuation_id")
        let binding = try SemanticJSON.binding(command, nestedAt: "binding")
        let boundary = try openBoundaryState(state, binding)
        try require(boundary.packet == nil, "format_repair_after_packet_sealed")
        try require(boundary.repair == nil, "format_repair_already_reserved_for_boundary")
        try require(state.continuationIdentities[continuationID] == nil, "continuation_already_dispatched")
        let issuedAt = try SemanticJSON.timestamp(command, "issued_at", code: "format_repair_time_invalid")
        let expiresAt = try SemanticJSON.timestamp(command, "expires_at", code: "format_repair_time_invalid")
        let occurredAt = try SemanticJSON.timestamp(command, "occurred_at", code: "format_repair_time_invalid")
        try require(issuedAt <= occurredAt && occurredAt < expiresAt, "format_repair_time_invalid")
        guard let parentPromptID = command["parent_prompt_id"] as? String,
              parentPromptID.utf8.elementsEqual(binding.sourcePromptID.utf8)
        else { throw CoordinatorError("format_repair_parent_prompt_mismatch") }
        let repairRequestID = try SemanticJSON.identifier(command, "repair_request_id")
        let payload: [String: Any] = [
            "continuation_origin": "internal_format_repair",
            "continuation_id": continuationID,
            "repair_request_id": repairRequestID,
            "parent_prompt_id": parentPromptID,
            "repair_kind": "decision_proposal_schema",
            "repair_attempt": 1,
            "max_repair_attempts": 1,
            "dispatch_mode": "submitted_envelope",
            "issued_at": issuedAt.rawValue,
            "expires_at": expiresAt.rawValue,
            "correlation_token_fingerprint": tokenMaterial.fingerprint,
        ]
        let eventObject = try event(
            state: state,
            type: "internal_format_repair_reserved",
            id: SemanticJSON.identifier(command, "event_id"),
            occurredAt: occurredAt.rawValue,
            binding: binding,
            payload: payload
        )
        var envelope: [String: Any] = [
            "schema_version": "1.0",
            "kind": "blabee_episode_continuation",
            "continuation_origin": "internal_format_repair",
            "dispatch_mode": "submitted_envelope",
            "continuation_id": continuationID,
            "continuation_token": tokenMaterial.token,
            "repair_request_id": repairRequestID,
            "repair_kind": "decision_proposal_schema",
            "repair_attempt": 1,
            "max_repair_attempts": 1,
            "issued_at": issuedAt.rawValue,
            "expires_at": expiresAt.rawValue,
        ]
        envelope.merge(binding.jsonObject) { current, _ in current }
        try validateGeneratedEnvelope(envelope)
        return try change(
            events: [eventObject],
            effects: [["kind": "format_repair_envelope_ready", "envelope": envelope]]
        )
    }

    static func claimFormatRepair(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any],
        hmacKey: Data?
    ) throws -> CoordinatorSemanticChange {
        guard let envelope = command["envelope"] as? [String: Any] else {
            throw CoordinatorError("continuation_envelope_invalid")
        }
        try require(
            envelope["schema_version"] as? String == "1.0"
                && envelope["kind"] as? String == "blabee_episode_continuation",
            "continuation_envelope_invalid"
        )
        try require(envelope["continuation_origin"] as? String == "internal_format_repair", "continuation_origin_mismatch")
        try require(envelope["dispatch_mode"] as? String == "submitted_envelope", "dispatch_mode_conflict")
        let binding = try CoordinatorBinding(jsonObject: envelope)
        let boundary = try openBoundaryState(state, binding)
        try require(boundary.packet == nil, "format_repair_after_packet_sealed")
        guard let repair = boundary.repair else { throw CoordinatorError("format_repair_not_reserved") }
        try require(repair.claimedAt == nil, "format_repair_already_claimed_for_boundary")
        guard let expected = try JSONSerialization.jsonObject(with: repair.payloadJSON) as? [String: Any] else {
            throw CoordinatorError("format_repair_reservation_mismatch")
        }
        for key in [
            "continuation_id", "repair_request_id", "repair_kind", "repair_attempt",
            "max_repair_attempts", "issued_at", "expires_at",
        ] {
            try require(SemanticJSON.equal(envelope[key], expected[key]), "format_repair_reservation_mismatch")
        }
        guard let token = envelope["continuation_token"] as? String,
              let fingerprint = expected["correlation_token_fingerprint"] as? String,
              ContinuationTokenMaterial.verify(token: token, fingerprint: fingerprint, hmacKey: hmacKey)
        else { throw CoordinatorError("continuation_token_invalid") }
        let occurredAt = try SemanticJSON.timestamp(command, "occurred_at", code: "format_repair_time_invalid")
        let expiresAt = try SemanticJSON.timestamp(expected, "expires_at", code: "format_repair_time_invalid")
        try require(occurredAt >= repair.reservedAt && occurredAt < expiresAt, "format_repair_time_invalid")
        let eventObject = try event(
            state: state,
            type: "internal_format_repair_claimed",
            id: SemanticJSON.identifier(command, "event_id"),
            occurredAt: occurredAt.rawValue,
            binding: binding,
            payload: expected
        )
        return try change(events: [eventObject])
    }

    static func expireInteraction(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorSemanticChange {
        let binding = try SemanticJSON.binding(command, nestedAt: "binding")
        let boundary = try openBoundaryState(state, binding)
        guard let packet = boundary.packet else { throw CoordinatorError("decision_packet_missing") }
        try require(!boundary.expired, "interaction_already_expired")
        try require(boundary.selection == nil && boundary.dispatchedContinuationID == nil, "interaction_already_claimed")
        let occurredAt = try SemanticJSON.timestamp(command, "occurred_at", code: "interaction_expired_time_invalid")
        try require(occurredAt >= packet.expiresAt, "interaction_expired_before_packet_expiry")
        let reason: String
        if command["reason"] == nil {
            reason = "selection_timeout"
        } else {
            reason = try SemanticJSON.stableCode(command, "reason", code: "interaction_expiry_reason_invalid")
        }
        let eventObject = try event(
            state: state,
            type: "interaction_expired",
            id: SemanticJSON.identifier(command, "event_id"),
            occurredAt: occurredAt.rawValue,
            binding: binding,
            payload: [
                "interaction_id": packet.interactionID,
                "packet_id": packet.packetID,
                "revision": packet.revision,
                "reason": reason,
                "automatic_selection": false,
            ]
        )
        return try change(events: [eventObject])
    }
}

// MARK: - Shared decision helpers

private extension CoordinatorSemanticDecision {
    static func validateTokenMaterial(
        _ material: ContinuationTokenMaterial,
        hmacKey: Data?
    ) throws {
        try require(material.verifyGeneratedIntegrity(), "token_fingerprint_mismatch")
        let expected = try ContinuationTokenMaterial.fingerprint(
            for: material.token,
            hmacKey: hmacKey
        )
        try require(
            ContinuationTokenMaterial.constantTimeEqual(expected, material.fingerprint),
            "token_fingerprint_mismatch"
        )
    }

    static func boundaryState(
        _ state: CoordinatorSemanticState,
        _ binding: CoordinatorBinding
    ) throws -> CoordinatorBoundaryState {
        if let boundary = state.boundaries[binding.fullKey] { return boundary }
        if state.boundaryIdentities[binding.boundaryKey] != nil {
            throw CoordinatorError("decision_boundary_binding_mismatch")
        }
        throw CoordinatorError("unknown_decision_boundary")
    }

    static func openBoundaryState(
        _ state: CoordinatorSemanticState,
        _ binding: CoordinatorBinding
    ) throws -> CoordinatorBoundaryState {
        let boundary = try boundaryState(state, binding)
        try require(!boundary.closed, "decision_boundary_closed")
        return boundary
    }

    static func continuationForCommand(
        _ state: CoordinatorSemanticState,
        _ command: [String: Any]
    ) throws -> CoordinatorContinuationState {
        guard let continuationID = command["continuation_id"] as? String,
              IdentifierNormalization.isNFC(continuationID),
              let continuation = state.continuations[continuationID]
        else {
            throw CoordinatorError("continuation_not_dispatched")
        }
        let binding: CoordinatorBinding
        if let rawBinding = command["binding"], !(rawBinding is NSNull) {
            guard let nested = rawBinding as? [String: Any] else {
                throw CoordinatorError("binding_incomplete")
            }
            binding = try CoordinatorBinding(jsonObject: nested)
        } else {
            binding = try CoordinatorBinding(jsonObject: command)
        }
        try require(binding == continuation.binding, "decision_boundary_binding_mismatch")
        return continuation
    }

    static func event(
        state: CoordinatorSemanticState,
        type: String,
        id: String,
        occurredAt: String,
        binding: CoordinatorBinding,
        payload: [String: Any],
        sequenceOffset: Int64 = 1
    ) throws -> [String: Any] {
        try require(!state.eventIDs.contains(id), "runtime_event_id_duplicate")
        _ = try RFC3339Instant(occurredAt, code: "runtime_event_time_invalid")
        guard let category = categories[type] else { throw CoordinatorError("runtime_event_type_unknown") }
        var value: [String: Any] = [
            "schema_version": "1.0",
            "kind": "blabee_runtime_event",
            "event_id": id,
            "event_sequence": state.eventSequence + sequenceOffset,
            "event_type": type,
            "event_category": category,
            "occurred_at": occurredAt,
            "payload": payload,
        ]
        value.merge(binding.jsonObject) { current, _ in current }
        return value
    }

    static func change(
        events: [[String: Any]],
        documents: [Data] = [],
        verificationRecords: [[String: Any]] = [],
        effects: [[String: Any]] = []
    ) throws -> CoordinatorSemanticChange {
        var eventIDs = Set<String>()
        for event in events {
            guard let id = event["event_id"] as? String, eventIDs.insert(id).inserted else {
                throw CoordinatorError("runtime_event_id_duplicate")
            }
        }
        return CoordinatorSemanticChange(
            events: try events.map { try StrictJSON.canonicalData(for: $0) },
            documents: documents,
            verificationRecords: try verificationRecords.map { try StrictJSON.canonicalData(for: $0) },
            effects: try effects.map { try StrictJSON.canonicalData(for: $0) }
        )
    }

    static func validateGeneratedEnvelope(_ envelope: [String: Any]) throws {
        let data = try StrictJSON.canonicalData(for: envelope)
        guard case .continuationEnvelope = try V1IngressValidator().validate(
            data,
            as: .continuationEnvelope
        ) else {
            throw CoordinatorError("continuation_envelope_invalid")
        }
    }
}

private enum SemanticJSON {
    static func commandType(_ object: [String: Any]) throws -> String {
        guard let type = object["type"] as? String else {
            throw CoordinatorError("coordinator_command_invalid")
        }
        return type
    }

    static func command(_ data: Data) throws -> [String: Any] {
        do {
            return try StrictJSON.object(from: data, limits: .v1).value
        } catch {
            throw CoordinatorError("coordinator_command_invalid", error.coordinatorError.message)
        }
    }

    static func binding(
        _ object: [String: Any],
        nestedAt key: String
    ) throws -> CoordinatorBinding {
        guard let nested = object[key] as? [String: Any] else {
            throw CoordinatorError("binding_incomplete")
        }
        return try CoordinatorBinding(jsonObject: nested)
    }

    static func string(
        _ object: [String: Any],
        _ key: String,
        field: String
    ) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty else {
            throw CoordinatorError("\(field)_missing")
        }
        return value
    }

    static func identifier(
        _ object: [String: Any],
        _ key: String,
        field: String? = nil
    ) throws -> String {
        guard let value = object[key] as? String else {
            throw CoordinatorError("\(field ?? key)_missing")
        }
        return try identifier(value, field: field ?? key)
    }

    static func identifier(_ value: String, field: String) throws -> String {
        try require(!value.isEmpty, "\(field)_missing")
        try require(value.unicodeScalars.count <= 512, "\(field)_invalid")
        try require(IdentifierNormalization.isNFC(value), "\(field)_invalid")
        return value
    }

    static func nonEmpty(_ object: [String: Any], _ key: String) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty else {
            throw CoordinatorError("\(key)_missing")
        }
        try require(value.unicodeScalars.count <= 8_192, "\(key)_invalid")
        return value
    }

    static func stableCode(
        _ object: [String: Any],
        _ key: String,
        code: String
    ) throws -> String {
        guard let value = object[key] as? String,
              value.range(of: "^[a-z][a-z0-9_]{0,127}$", options: .regularExpression) != nil
        else { throw CoordinatorError(code) }
        return value
    }

    static func timestamp(
        _ object: [String: Any],
        _ key: String,
        code: String
    ) throws -> RFC3339Instant {
        guard let value = object[key] as? String else { throw CoordinatorError(code) }
        return try RFC3339Instant(value, code: code)
    }

    static func timestampString(
        _ object: [String: Any],
        _ key: String,
        code: String
    ) throws -> String {
        guard let value = object[key] as? String else { throw CoordinatorError(code) }
        _ = try RFC3339Instant(value, code: code)
        return value
    }

    static func equal(_ left: Any?, _ right: Any?) -> Bool {
        guard let left, let right,
              JSONSerialization.isValidJSONObject(["value": left]),
              JSONSerialization.isValidJSONObject(["value": right]),
              let leftData = try? StrictJSON.canonicalData(for: ["value": left]),
              let rightData = try? StrictJSON.canonicalData(for: ["value": right])
        else { return false }
        return leftData == rightData
    }
}
