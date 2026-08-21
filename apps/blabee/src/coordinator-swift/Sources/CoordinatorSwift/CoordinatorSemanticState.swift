import CoreFoundation
import Foundation

public struct CoordinatorPacketRevision: Sendable, Hashable {
    public let packetID: String
    public let revision: Int64

    public init(packetID: String, revision: Int64) {
        self.packetID = packetID
        self.revision = revision
    }
}

public struct CoordinatorPacketChoice: Sendable, Equatable {
    public let slot: Int
    public let optionID: String
    public let enabled: Bool
    public let actionID: String?
    public let actionJSON: Data?
    public let targetCheckpointID: String?
}

public struct CoordinatorPacketDocument: Sendable, Equatable {
    public let binding: CoordinatorBinding
    public let interactionID: String
    public let packetID: String
    public let revision: Int64
    public let validAfterEventSequence: Int64
    public let sealedAt: RFC3339Instant
    public let expiresAt: RFC3339Instant
    public let choices: [CoordinatorPacketChoice]
    public let canonicalJSON: Data

    public var revisionKey: CoordinatorPacketRevision {
        CoordinatorPacketRevision(packetID: packetID, revision: revision)
    }
}

public struct CoordinatorPacketReference: Sendable, Equatable {
    public let documentKey: CoordinatorPacketRevision
    public let interactionID: String
    public let packetID: String
    public let revision: Int64
    public let expiresAt: RFC3339Instant
}

public struct CoordinatorSelectionState: Sendable, Equatable {
    public let selectionID: String
    public let interactionID: String
    public let packetID: String
    public let revision: Int64
    public let optionID: String
    public let slot: Int
    public let actionID: String?
}

public struct CoordinatorRepairState: Sendable, Equatable {
    public let payloadJSON: Data
    public let continuationID: String
    public let correlationTokenFingerprint: String
    public let reservedAt: RFC3339Instant
    public internal(set) var claimedAt: RFC3339Instant?
}

public struct CoordinatorBoundaryState: Sendable, Equatable {
    public let binding: CoordinatorBinding
    public let proposalID: String
    public let openedAt: RFC3339Instant
    public internal(set) var closed: Bool
    public internal(set) var closeReason: String?
    public internal(set) var expired: Bool
    public internal(set) var packet: CoordinatorPacketReference?
    public internal(set) var selection: CoordinatorSelectionState?
    public internal(set) var dispatchedContinuationID: String?
    public internal(set) var repair: CoordinatorRepairState?

    public var isPendingInteraction: Bool {
        !closed && !expired && packet != nil && selection == nil
    }
}

public struct CoordinatorVerificationRecord: Sendable, Equatable {
    public let dispatchEventID: String
    public let continuationID: String
    public let binding: CoordinatorBinding
    public let interactionID: String
    public let packetID: String
    public let revision: Int64
    public let optionID: String
    public let actionID: String
    public let correlationTokenFingerprint: String
    public let canonicalJSON: Data
}

public struct CoordinatorTokenIdentity: Sendable, Equatable {
    public let kind: String
    public let continuationID: String
}

public struct CoordinatorContinuationIdentity: Sendable, Equatable {
    public let origin: String
    public let boundaryKey: CoordinatorBindingKey
}

public enum CoordinatorTransportStatus: String, Sendable, Equatable {
    case completed
    case timedOutUnknown = "timed_out_unknown"
}

public struct CoordinatorTransportState: Sendable, Equatable {
    public let status: CoordinatorTransportStatus
    public let occurredAt: RFC3339Instant
    public let workOutcomeStatus: String?
    public let automaticRetry: Bool?
}

public struct CoordinatorWorkOutcome: Sendable, Equatable {
    public let actionID: String
    public let status: String
    public let summary: String
    public let evidenceIDs: [String]
    public let canonicalJSON: Data
}

public struct CoordinatorContinuationState: Sendable, Equatable {
    public let binding: CoordinatorBinding
    public let boundaryKey: CoordinatorBindingKey
    public let dispatchEventID: String
    public let continuationID: String
    public let interactionID: String
    public let packetID: String
    public let revision: Int64
    public let optionID: String
    public let actionID: String
    public let dispatchMode: String
    public let issuedAt: RFC3339Instant
    public let expiresAt: RFC3339Instant
    public let inFlightDeadlineAt: RFC3339Instant
    public internal(set) var consumedAt: RFC3339Instant?
    public internal(set) var transport: CoordinatorTransportState?
    public internal(set) var workOutcome: CoordinatorWorkOutcome?
}

public struct CoordinatorSemanticState: Sendable, Equatable {
    public let schemaVersion = "1.0"
    public internal(set) var eventSequence: Int64 = 0
    public internal(set) var eventIDs: Set<String> = []
    public internal(set) var boundaries: [CoordinatorBindingKey: CoordinatorBoundaryState] = [:]
    public internal(set) var boundaryIdentities: [CoordinatorBoundaryKey: CoordinatorBindingKey] = [:]
    public internal(set) var latestBoundaryByTurn: [CoordinatorTurnKey: CoordinatorBindingKey] = [:]
    public internal(set) var packetDocuments: [CoordinatorPacketRevision: CoordinatorPacketDocument] = [:]
    public internal(set) var sealedPacketDocuments: Set<CoordinatorPacketRevision> = []
    public internal(set) var verificationRecords: [String: CoordinatorVerificationRecord] = [:]
    public internal(set) var usedVerificationRecords: Set<String> = []
    public internal(set) var tokenFingerprints: [String: CoordinatorTokenIdentity] = [:]
    public internal(set) var continuationIdentities: [String: CoordinatorContinuationIdentity] = [:]
    public internal(set) var continuations: [String: CoordinatorContinuationState] = [:]

    public init() {}

    public func boundary(for binding: CoordinatorBinding) -> CoordinatorBoundaryState? {
        boundaries[binding.fullKey]
    }

    public func hasBoundaryIdentity(for binding: CoordinatorBinding) -> Bool {
        boundaryIdentities[binding.boundaryKey] != nil
    }

    public func packet(for binding: CoordinatorBinding) -> CoordinatorPacketDocument? {
        guard let reference = boundary(for: binding)?.packet else { return nil }
        return packetDocuments[reference.documentKey]
    }

    public func continuation(id: String) -> CoordinatorContinuationState? {
        guard IdentifierNormalization.isNFC(id) else { return nil }
        return continuations[id]
    }

    public var pendingInteractions: [CoordinatorBoundaryState] {
        boundaries.values.filter(\.isPendingInteraction)
    }

    public var unterminatedContinuations: [CoordinatorContinuationState] {
        continuations.values.filter { $0.transport == nil }
    }

    func assertSessionPendingSlotAvailable(for binding: CoordinatorBinding) throws {
        let conflicting = boundaries.values.contains { candidate in
            candidate.binding.fullKey != binding.fullKey
                && candidate.binding.sessionKey == binding.sessionKey
                && candidate.isPendingInteraction
        }
        try require(!conflicting, "session_pending_interaction_conflict")
    }
}

public enum CoordinatorSemanticReplay {
    public static func replay(_ snapshot: JournalSnapshot) throws -> CoordinatorSemanticState {
        try replay(
            events: snapshot.events,
            documents: snapshot.documents,
            verificationRecords: snapshot.verificationRecords
        )
    }

    public static func replay(
        events: [Data],
        documents: [Data] = [],
        verificationRecords: [Data] = []
    ) throws -> CoordinatorSemanticState {
        var state = CoordinatorSemanticState()

        for data in documents {
            let packet = try SemanticJSON.packet(from: data)
            try require(state.packetDocuments[packet.revisionKey] == nil, "packet_document_duplicate")
            state.packetDocuments[packet.revisionKey] = packet
        }

        for data in verificationRecords {
            let record = try SemanticJSON.verification(from: data)
            try require(state.verificationRecords[record.continuationID] == nil, "verification_record_duplicate")
            try require(
                state.tokenFingerprints[record.correlationTokenFingerprint] == nil,
                "token_fingerprint_duplicate"
            )
            state.verificationRecords[record.continuationID] = record
            state.tokenFingerprints[record.correlationTokenFingerprint] = CoordinatorTokenIdentity(
                kind: "pet_action",
                continuationID: record.continuationID
            )
        }

        for data in events {
            let event = try SemanticJSON.event(from: data)
            try reduce(&state, event: event)
        }

        for key in state.packetDocuments.keys {
            try require(state.sealedPacketDocuments.contains(key), "packet_document_orphaned")
        }
        for continuationID in state.verificationRecords.keys {
            try require(state.usedVerificationRecords.contains(continuationID), "verification_record_orphaned")
        }
        return state
    }

    private static func reduce(_ state: inout CoordinatorSemanticState, event: SemanticEvent) throws {
        try validateEnvelope(state, event: event)
        state.eventSequence = event.sequence
        state.eventIDs.insert(event.eventID)

        if event.type == "decision_boundary_opened" {
            try openBoundary(&state, event: event)
            return
        }

        guard let exactKey = state.boundaryIdentities[event.binding.boundaryKey] else {
            throw CoordinatorError("unknown_decision_boundary")
        }
        try require(exactKey == event.binding.fullKey, "decision_boundary_binding_mismatch")
        guard var boundary = state.boundaries[exactKey] else {
            throw CoordinatorError("unknown_decision_boundary")
        }

        if event.type == "decision_selection_claimed" {
            try require(
                state.latestBoundaryByTurn[event.binding.turnKey] == exactKey,
                "stale_decision_boundary"
            )
        }

        if event.type == "decision_boundary_closed" {
            try closeBoundary(&state, boundary: &boundary, key: exactKey, event: event)
            return
        }

        try require(!boundary.closed, "decision_boundary_closed", "\(event.type) cannot follow boundary close")

        switch event.type {
        case "decision_packet_sealed":
            try sealPacket(&state, boundary: &boundary, key: exactKey, event: event)
        case "interaction_expired":
            try expireInteraction(&state, boundary: &boundary, key: exactKey, event: event)
        case "decision_selection_claimed":
            try claimSelection(&state, boundary: &boundary, key: exactKey, event: event)
        case "internal_format_repair_reserved":
            try reserveRepair(&state, boundary: &boundary, key: exactKey, event: event)
        case "internal_format_repair_claimed":
            try claimRepair(&state, boundary: &boundary, key: exactKey, event: event)
        case "continuation_dispatched":
            try dispatchContinuation(&state, boundary: &boundary, key: exactKey, event: event)
        case "continuation_consumed":
            try consumeContinuation(&state, event: event)
        case "continuation_transport_completed":
            try completeTransport(&state, event: event)
        case "continuation_transport_timed_out_unknown":
            try timeoutTransport(&state, event: event)
        case "work_outcome_recorded":
            try recordWorkOutcome(&state, event: event)
        default:
            throw CoordinatorError("runtime_event_type_unhandled")
        }
    }

    private static func validateEnvelope(_ state: CoordinatorSemanticState, event: SemanticEvent) throws {
        try require(event.schemaVersion == "1.0", "runtime_event_schema_version_invalid")
        try require(event.kind == "blabee_runtime_event", "runtime_event_kind_invalid")
        try SemanticJSON.identifier(event.eventID, field: "event_id")
        try require(!state.eventIDs.contains(event.eventID), "runtime_event_id_duplicate")
        let (expected, overflow) = state.eventSequence.addingReportingOverflow(1)
        try require(!overflow && event.sequence == expected, "event_sequence_not_contiguous")
        guard let category = SemanticJSON.eventCategories[event.type] else {
            throw CoordinatorError("runtime_event_type_unknown")
        }
        try require(event.category == category, "runtime_event_category_mismatch")
    }

    private static func openBoundary(_ state: inout CoordinatorSemanticState, event: SemanticEvent) throws {
        let key = event.binding.fullKey
        try require(state.boundaries[key] == nil, "decision_boundary_reopened")
        try require(state.boundaryIdentities[event.binding.boundaryKey] == nil, "decision_boundary_identity_reused")
        if let latestKey = state.latestBoundaryByTurn[event.binding.turnKey],
           let previous = state.boundaries[latestKey] {
            try require(previous.closed, "previous_decision_boundary_still_open")
            try SemanticJSON.assertTurnLineage(event.binding, equals: previous.binding)
            let (nextSequence, overflow) = previous.binding.boundarySequence.addingReportingOverflow(1)
            try require(
                !overflow && event.binding.boundarySequence == nextSequence,
                "boundary_sequence_not_contiguous"
            )
        } else {
            try require(event.binding.boundarySequence == 1, "boundary_sequence_not_contiguous")
        }
        let proposalID = try SemanticJSON.string(event.payload, "proposal_id", field: "proposal_id", identifier: true)
        state.boundaries[key] = CoordinatorBoundaryState(
            binding: event.binding,
            proposalID: proposalID,
            openedAt: event.occurredAt,
            closed: false,
            closeReason: nil,
            expired: false,
            packet: nil,
            selection: nil,
            dispatchedContinuationID: nil,
            repair: nil
        )
        state.boundaryIdentities[event.binding.boundaryKey] = key
        state.latestBoundaryByTurn[event.binding.turnKey] = key
    }

    private static func closeBoundary(
        _ state: inout CoordinatorSemanticState,
        boundary: inout CoordinatorBoundaryState,
        key: CoordinatorBindingKey,
        event: SemanticEvent
    ) throws {
        try require(!boundary.closed, "decision_boundary_already_closed")
        let reason = event.payload["close_reason"] as? String ?? ""
        if boundary.selection?.slot == 3 {
            try require(reason == "episode_paused", "pause_selection_close_reason_invalid")
        }
        if reason == "episode_paused" {
            try require(boundary.selection?.slot == 3, "episode_pause_selection_missing")
        }
        if boundary.selection?.slot == 1 || boundary.selection?.slot == 2 {
            try require(boundary.dispatchedContinuationID != nil, "transport_terminal_observation_missing")
        }
        if let continuationID = boundary.dispatchedContinuationID {
            let status = state.continuations[continuationID]?.transport?.status
            try require(status == .completed || status == .timedOutUnknown, "transport_terminal_observation_missing")
        }
        try SemanticJSON.stableCode(reason, code: "close_reason_invalid")
        boundary.closed = true
        boundary.closeReason = reason
        state.boundaries[key] = boundary
    }

    private static func sealPacket(
        _ state: inout CoordinatorSemanticState,
        boundary: inout CoordinatorBoundaryState,
        key: CoordinatorBindingKey,
        event: SemanticEvent
    ) throws {
        try state.assertSessionPendingSlotAvailable(for: event.binding)
        try require(!boundary.expired, "interaction_already_expired")
        try require(boundary.selection == nil, "decision_packet_reseal_after_claim")
        try require(boundary.repair == nil || boundary.repair?.claimedAt != nil, "format_repair_not_claimed_before_packet")
        let interactionID = try SemanticJSON.string(event.payload, "interaction_id", field: "interaction_id", identifier: true)
        let packetID = try SemanticJSON.string(event.payload, "packet_id", field: "packet_id", identifier: true)
        let revision = try SemanticJSON.positiveInteger(event.payload["revision"], code: "packet_revision_invalid")
        let expiresText = try SemanticJSON.string(event.payload, "expires_at", field: "expires_at")
        let expiresAt = try RFC3339Instant(expiresText, code: "decision_packet_time_invalid")
        let documentKey = CoordinatorPacketRevision(packetID: packetID, revision: revision)
        guard let packet = state.packetDocuments[documentKey] else {
            throw CoordinatorError("packet_document_missing")
        }
        try require(packet.binding == event.binding, "packet_document_binding_mismatch")
        try require(packet.interactionID == interactionID, "packet_document_interaction_mismatch")
        try require(packet.packetID == packetID, "packet_document_id_mismatch")
        try require(packet.revision == revision, "packet_document_revision_mismatch")
        try require(packet.expiresAt.rawValue == expiresText, "packet_document_expiry_mismatch")
        try require(packet.sealedAt.rawValue == event.occurredAt.rawValue, "packet_document_sealed_at_mismatch")
        try require(packet.validAfterEventSequence == event.sequence, "packet_document_valid_after_sequence_mismatch")
        try require(event.occurredAt < expiresAt, "decision_packet_time_invalid")
        if let previous = boundary.packet {
            try require(interactionID == previous.interactionID, "decision_packet_identity_changed")
            try require(packetID == previous.packetID, "decision_packet_identity_changed")
            let (nextRevision, overflow) = previous.revision.addingReportingOverflow(1)
            try require(
                !overflow && revision == nextRevision,
                "decision_packet_revision_not_contiguous"
            )
            try require(event.occurredAt < previous.expiresAt, "decision_packet_reseal_after_expiry")
        } else {
            try require(revision == 1, "decision_packet_initial_revision_invalid")
        }
        try require(!state.sealedPacketDocuments.contains(documentKey), "packet_document_already_sealed")
        state.sealedPacketDocuments.insert(documentKey)
        boundary.packet = CoordinatorPacketReference(
            documentKey: documentKey,
            interactionID: interactionID,
            packetID: packetID,
            revision: revision,
            expiresAt: expiresAt
        )
        state.boundaries[key] = boundary
    }

    private static func expireInteraction(
        _ state: inout CoordinatorSemanticState,
        boundary: inout CoordinatorBoundaryState,
        key: CoordinatorBindingKey,
        event: SemanticEvent
    ) throws {
        try require(!boundary.expired, "interaction_already_expired")
        guard let packet = boundary.packet else { throw CoordinatorError("decision_packet_missing") }
        try require(boundary.selection == nil && boundary.dispatchedContinuationID == nil, "interaction_already_claimed")
        let interactionID = try SemanticJSON.string(
            event.payload, "interaction_id", field: "interaction_id", identifier: true
        )
        let packetID = try SemanticJSON.string(
            event.payload, "packet_id", field: "packet_id", identifier: true
        )
        let revision = try SemanticJSON.positiveInteger(
            event.payload["revision"], code: "packet_revision_invalid"
        )
        try require(interactionID == packet.interactionID, "decision_boundary_binding_mismatch")
        try require(packetID == packet.packetID, "decision_boundary_binding_mismatch")
        try require(revision == packet.revision, "decision_packet_revision_stale")
        let reason = event.payload["reason"] as? String ?? ""
        try SemanticJSON.stableCode(reason, code: "interaction_expiry_reason_invalid")
        let automaticSelection = try? SemanticJSON.bool(event.payload["automatic_selection"])
        try require(automaticSelection == false, "interaction_expiry_automatic_selection_forbidden")
        try require(event.occurredAt >= packet.expiresAt, "interaction_expired_before_packet_expiry")
        boundary.expired = true
        state.boundaries[key] = boundary
    }

    private static func claimSelection(
        _ state: inout CoordinatorSemanticState,
        boundary: inout CoordinatorBoundaryState,
        key: CoordinatorBindingKey,
        event: SemanticEvent
    ) throws {
        try require(!boundary.expired, "interaction_already_expired")
        try require(boundary.selection == nil, "selection_already_claimed")
        guard let packetReference = boundary.packet else { throw CoordinatorError("decision_packet_missing") }
        let interactionID = try SemanticJSON.string(event.payload, "interaction_id", field: "interaction_id", identifier: true)
        let packetID = try SemanticJSON.string(event.payload, "packet_id", field: "packet_id", identifier: true)
        let revision = try SemanticJSON.positiveInteger(event.payload["revision"], code: "packet_revision_invalid")
        try require(interactionID == packetReference.interactionID, "decision_boundary_binding_mismatch")
        try require(packetID == packetReference.packetID, "decision_boundary_binding_mismatch")
        try require(revision == packetReference.revision, "decision_packet_revision_stale")
        try require(event.occurredAt < packetReference.expiresAt, "decision_packet_expired")
        guard let packet = state.packetDocuments[packetReference.documentKey] else {
            throw CoordinatorError("packet_document_missing")
        }
        let optionID = try SemanticJSON.string(event.payload, "option_id", field: "option_id", identifier: true)
        guard let choice = packet.choices.first(where: { $0.optionID == optionID }) else {
            throw CoordinatorError("decision_option_not_found")
        }
        try require(choice.enabled, "decision_option_disabled")
        boundary.selection = CoordinatorSelectionState(
            selectionID: try SemanticJSON.string(event.payload, "selection_id", field: "selection_id", identifier: true),
            interactionID: interactionID,
            packetID: packetID,
            revision: revision,
            optionID: optionID,
            slot: choice.slot,
            actionID: choice.actionID
        )
        state.boundaries[key] = boundary
    }

    private static func reserveRepair(
        _ state: inout CoordinatorSemanticState,
        boundary: inout CoordinatorBoundaryState,
        key: CoordinatorBindingKey,
        event: SemanticEvent
    ) throws {
        try require(boundary.packet == nil, "format_repair_after_packet_sealed")
        try require(boundary.repair == nil, "format_repair_already_reserved_for_boundary")
        let repair = try SemanticJSON.repairPayload(event.payload)
        try require(state.tokenFingerprints[repair.fingerprint] == nil, "token_fingerprint_duplicate")
        try require(repair.parentPromptID == event.binding.sourcePromptID, "format_repair_parent_prompt_mismatch")
        try require(state.continuationIdentities[repair.continuationID] == nil, "continuation_already_dispatched")
        try require(repair.issuedAt <= event.occurredAt && event.occurredAt < repair.expiresAt, "format_repair_time_invalid")
        boundary.repair = CoordinatorRepairState(
            payloadJSON: try SemanticJSON.canonical(event.payload),
            continuationID: repair.continuationID,
            correlationTokenFingerprint: repair.fingerprint,
            reservedAt: event.occurredAt,
            claimedAt: nil
        )
        state.boundaries[key] = boundary
        state.tokenFingerprints[repair.fingerprint] = CoordinatorTokenIdentity(
            kind: "internal_format_repair",
            continuationID: repair.continuationID
        )
        state.continuationIdentities[repair.continuationID] = CoordinatorContinuationIdentity(
            origin: "internal_format_repair",
            boundaryKey: key
        )
    }

    private static func claimRepair(
        _ state: inout CoordinatorSemanticState,
        boundary: inout CoordinatorBoundaryState,
        key: CoordinatorBindingKey,
        event: SemanticEvent
    ) throws {
        try require(boundary.packet == nil, "format_repair_after_packet_sealed")
        guard var existing = boundary.repair else { throw CoordinatorError("format_repair_not_reserved") }
        try require(existing.claimedAt == nil, "format_repair_already_claimed_for_boundary")
        let repair = try SemanticJSON.repairPayload(event.payload)
        let claimedPayloadJSON = try SemanticJSON.canonical(event.payload)
        try require(existing.payloadJSON == claimedPayloadJSON, "format_repair_reservation_mismatch")
        try require(event.occurredAt >= existing.reservedAt && event.occurredAt < repair.expiresAt, "format_repair_time_invalid")
        existing.claimedAt = event.occurredAt
        boundary.repair = existing
        state.boundaries[key] = boundary
    }

    private static func dispatchContinuation(
        _ state: inout CoordinatorSemanticState,
        boundary: inout CoordinatorBoundaryState,
        key: CoordinatorBindingKey,
        event: SemanticEvent
    ) throws {
        try require(!boundary.expired, "interaction_already_expired")
        guard let selection = boundary.selection else { throw CoordinatorError("selection_not_claimed") }
        try require(selection.slot == 1 || selection.slot == 2, "decision_option_not_pet_action")
        guard let packetReference = boundary.packet,
              let packet = state.packetDocuments[packetReference.documentKey],
              let choice = packet.choices.first(where: { $0.optionID == selection.optionID }),
              choice.actionJSON != nil
        else { throw CoordinatorError("decision_option_not_pet_action") }
        try require(boundary.dispatchedContinuationID == nil, "continuation_already_dispatched_for_selection")
        let payload = event.payload
        let dispatchMode = payload["dispatch_mode"] as? String
        try require(dispatchMode == "same_turn_stop", "dispatch_mode_conflict")
        let interactionID = try SemanticJSON.string(payload, "interaction_id", field: "interaction_id", identifier: true)
        let packetID = try SemanticJSON.string(payload, "packet_id", field: "packet_id", identifier: true)
        let revision = try SemanticJSON.positiveInteger(payload["revision"], code: "packet_revision_invalid")
        let optionID = try SemanticJSON.string(payload, "option_id", field: "option_id", identifier: true)
        let actionID = try SemanticJSON.string(payload, "action_id", field: "action_id", identifier: true)
        try require(interactionID == selection.interactionID, "decision_boundary_binding_mismatch")
        try require(packetID == selection.packetID, "decision_boundary_binding_mismatch")
        try require(revision == selection.revision, "decision_boundary_binding_mismatch")
        try require(optionID == selection.optionID, "decision_boundary_binding_mismatch")
        try require(actionID == selection.actionID, "decision_boundary_binding_mismatch")
        let continuationID = try SemanticJSON.string(payload, "continuation_id", field: "continuation_id", identifier: true)
        try require(state.continuationIdentities[continuationID] == nil, "continuation_already_dispatched")
        let issuedAt = try RFC3339Instant(try SemanticJSON.string(payload, "issued_at", field: "issued_at"), code: "continuation_time_invalid")
        let expiresAt = try RFC3339Instant(try SemanticJSON.string(payload, "expires_at", field: "expires_at"), code: "continuation_time_invalid")
        let deadlineAt = try RFC3339Instant(try SemanticJSON.string(payload, "in_flight_deadline_at", field: "in_flight_deadline_at"), code: "continuation_time_invalid")
        try require(issuedAt <= event.occurredAt && event.occurredAt < expiresAt, "continuation_time_invalid")
        try require(expiresAt <= deadlineAt, "continuation_expiry_after_in_flight_deadline")
        guard let verification = state.verificationRecords[continuationID] else {
            throw CoordinatorError("continuation_verification_missing")
        }
        try require(verification.dispatchEventID == event.eventID, "verification_record_dispatch_event_mismatch")
        try require(verification.continuationID == continuationID, "verification_record_continuation_mismatch")
        try require(verification.binding == event.binding, "verification_record_binding_mismatch")
        try require(
            verification.interactionID == interactionID
                && verification.packetID == packetID
                && verification.revision == revision
                && verification.optionID == optionID
                && verification.actionID == actionID,
            "verification_record_dispatch_mismatch"
        )
        try require(!state.usedVerificationRecords.contains(continuationID), "verification_record_already_used")
        state.usedVerificationRecords.insert(continuationID)
        state.continuations[continuationID] = CoordinatorContinuationState(
            binding: event.binding,
            boundaryKey: key,
            dispatchEventID: event.eventID,
            continuationID: continuationID,
            interactionID: interactionID,
            packetID: packetID,
            revision: revision,
            optionID: optionID,
            actionID: actionID,
            dispatchMode: "same_turn_stop",
            issuedAt: issuedAt,
            expiresAt: expiresAt,
            inFlightDeadlineAt: deadlineAt,
            consumedAt: nil,
            transport: nil,
            workOutcome: nil
        )
        state.continuationIdentities[continuationID] = CoordinatorContinuationIdentity(
            origin: "pet_action",
            boundaryKey: key
        )
        boundary.dispatchedContinuationID = continuationID
        state.boundaries[key] = boundary
    }

    private static func continuation(
        _ state: CoordinatorSemanticState,
        event: SemanticEvent
    ) throws -> (String, CoordinatorContinuationState) {
        let id = try SemanticJSON.string(event.payload, "continuation_id", field: "continuation_id", identifier: true)
        guard let continuation = state.continuations[id] else { throw CoordinatorError("continuation_not_dispatched") }
        try require(continuation.binding == event.binding, "decision_boundary_binding_mismatch")
        return (id, continuation)
    }

    private static func consumeContinuation(_ state: inout CoordinatorSemanticState, event: SemanticEvent) throws {
        let (id, original) = try continuation(state, event: event)
        var item = original
        let dispatchMode = event.payload["dispatch_mode"] as? String
        try require(dispatchMode == item.dispatchMode, "continuation_dispatch_mode_mismatch")
        try require(item.consumedAt == nil, "continuation_already_consumed")
        try require(item.transport == nil, "transport_already_terminal")
        try require(event.occurredAt >= item.issuedAt, "continuation_not_yet_valid")
        try require(event.occurredAt < item.expiresAt, "continuation_expired")
        item.consumedAt = event.occurredAt
        state.continuations[id] = item
    }

    private static func completeTransport(_ state: inout CoordinatorSemanticState, event: SemanticEvent) throws {
        let (id, original) = try continuation(state, event: event)
        var item = original
        try require(item.consumedAt != nil, "continuation_not_consumed")
        try require(item.transport == nil, "transport_already_terminal")
        let transportStatus = event.payload["transport_status"] as? String
        let workOutcomeStatus = event.payload["work_outcome_status"] as? String
        try require(transportStatus == "completed", "transport_status_invalid")
        try require(workOutcomeStatus == "not_recorded", "transport_work_outcome_conflated")
        try require(event.occurredAt < item.inFlightDeadlineAt, "transport_completion_after_in_flight_deadline")
        item.transport = CoordinatorTransportState(
            status: .completed,
            occurredAt: event.occurredAt,
            workOutcomeStatus: nil,
            automaticRetry: nil
        )
        state.continuations[id] = item
    }

    private static func timeoutTransport(_ state: inout CoordinatorSemanticState, event: SemanticEvent) throws {
        let (id, original) = try continuation(state, event: event)
        var item = original
        try require(item.transport == nil, "transport_already_terminal")
        try require(event.occurredAt >= item.inFlightDeadlineAt, "timeout_before_in_flight_deadline")
        let payload = event.payload
        let valid = payload["transport_status"] as? String == "timed_out_unknown"
            && payload["work_outcome_status"] as? String == "unknown"
            && (try? SemanticJSON.bool(payload["automatic_retry"])) == false
            && (try? SemanticJSON.bool(payload["cancellation_inferred"])) == false
            && (try? SemanticJSON.bool(payload["failure_inferred"])) == false
        try require(valid, "invalid_in_flight_timeout")
        item.transport = CoordinatorTransportState(
            status: .timedOutUnknown,
            occurredAt: event.occurredAt,
            workOutcomeStatus: "unknown",
            automaticRetry: false
        )
        state.continuations[id] = item
    }

    private static func recordWorkOutcome(_ state: inout CoordinatorSemanticState, event: SemanticEvent) throws {
        let (id, original) = try continuation(state, event: event)
        var item = original
        try require(item.transport != nil, "transport_terminal_observation_missing")
        try require(item.workOutcome == nil, "work_outcome_already_recorded")
        let payload = event.payload
        let actionID = try SemanticJSON.string(payload, "action_id", field: "action_id", identifier: true)
        try require(actionID == item.actionID, "decision_boundary_binding_mismatch")
        let status = payload["work_outcome_status"] as? String ?? ""
        try require(["succeeded", "failed", "cancelled", "unknown"].contains(status), "work_outcome_status_invalid")
        let summary = try SemanticJSON.string(payload, "summary", field: "summary", maximum: 8_192)
        guard let rawEvidence = payload["evidence_ids"] as? [Any], rawEvidence.count <= 256 else {
            throw CoordinatorError("evidence_ids_invalid")
        }
        let evidenceIDs = try rawEvidence.map { value -> String in
            guard let string = value as? String else { throw CoordinatorError("evidence_id_missing") }
            try SemanticJSON.identifier(string, field: "evidence_id")
            return string
        }
        item.workOutcome = CoordinatorWorkOutcome(
            actionID: actionID,
            status: status,
            summary: summary,
            evidenceIDs: evidenceIDs,
            canonicalJSON: try SemanticJSON.canonical(payload)
        )
        state.continuations[id] = item
    }
}

private struct SemanticEvent {
    let schemaVersion: String
    let kind: String
    let eventID: String
    let sequence: Int64
    let type: String
    let category: String
    let occurredAt: RFC3339Instant
    let binding: CoordinatorBinding
    let payload: [String: Any]
}

private enum SemanticJSON {
    static let eventCategories: [String: String] = [
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

    static func event(from data: Data) throws -> SemanticEvent {
        let object = try StrictJSONTransport.object(from: data)
        try rejectRawTokens(object)
        let schemaVersion = try string(object, "schema_version", field: "schema_version")
        let kind = try string(object, "kind", field: "kind")
        let eventID = try string(object, "event_id", field: "event_id", identifier: true)
        let sequence = try positiveInteger(object["event_sequence"], code: "event_sequence_not_contiguous")
        let type = try string(object, "event_type", field: "event_type")
        let category = try string(object, "event_category", field: "event_category")
        let occurred = try RFC3339Instant(
            try string(object, "occurred_at", field: "occurred_at"),
            code: "runtime_event_time_invalid"
        )
        guard let payload = object["payload"] as? [String: Any] else {
            throw CoordinatorError("runtime_event_payload_invalid")
        }
        return SemanticEvent(
            schemaVersion: schemaVersion,
            kind: kind,
            eventID: eventID,
            sequence: sequence,
            type: type,
            category: category,
            occurredAt: occurred,
            binding: try binding(object),
            payload: payload
        )
    }

    static func packet(from data: Data) throws -> CoordinatorPacketDocument {
        let object = try StrictJSONTransport.object(from: data)
        try require(object["schema_version"] as? String == "1.0", "packet_document_schema_version_invalid")
        try require(object["kind"] as? String == "blabee_decision_packet", "packet_document_kind_invalid")
        try rejectRawTokens(object)
        let packetBinding = try binding(object)
        let interactionID = try string(object, "interaction_id", field: "interaction_id", identifier: true)
        let packetID = try string(object, "packet_id", field: "packet_id", identifier: true)
        let revision = try positiveInteger(object["revision"], code: "packet_revision_invalid")
        let validAfter = try positiveInteger(object["valid_after_event_sequence"], code: "packet_valid_after_sequence_invalid")
        let sealedAt = try RFC3339Instant(try string(object, "sealed_at", field: "sealed_at"), code: "decision_packet_time_invalid")
        let expiresAt = try RFC3339Instant(try string(object, "expires_at", field: "expires_at"), code: "decision_packet_time_invalid")
        try require(sealedAt < expiresAt, "decision_packet_time_invalid")
        guard let rawChoices = object["choices"] as? [Any], rawChoices.count == 4 else {
            throw CoordinatorError("packet_choices_invalid")
        }
        var optionIDs = Set<String>()
        var actionIDs = Set<String>()
        var choices: [CoordinatorPacketChoice] = []
        for (offset, raw) in rawChoices.enumerated() {
            guard let choice = raw as? [String: Any] else { throw CoordinatorError("packet_choices_invalid") }
            let slotValue = try positiveInteger(choice["slot"], code: "packet_slot_order_invalid")
            try require(slotValue == Int64(offset + 1), "packet_slot_order_invalid")
            let optionID = try string(choice, "option_id", field: "option_id", identifier: true)
            try require(optionIDs.insert(optionID).inserted, "packet_option_id_duplicate")
            let enabled: Bool
            do { enabled = try bool(choice["enabled"]) } catch { throw CoordinatorError("packet_choice_enabled_invalid") }
            try require(choice.keys.contains("action_id"), "action_id_missing")
            let actionID: String?
            if choice["action_id"] is NSNull {
                actionID = nil
            } else {
                actionID = try string(choice, "action_id", field: "action_id", identifier: true)
                try require(actionIDs.insert(actionID!).inserted, "decision_packet_action_id_not_unique")
            }
            let actionJSON: Data?
            if let action = choice["action"] as? [String: Any] {
                actionJSON = try canonical(action)
            } else {
                actionJSON = nil
            }
            if enabled && (slotValue == 1 || slotValue == 2) {
                try require(actionID != nil, "action_id_missing")
                try require(actionJSON != nil, "packet_action_missing")
            }
            if !enabled {
                try require(actionID == nil, "disabled_option_action_id_present")
                try require(choice["action"] == nil, "disabled_option_action_present")
            }
            let target = choice["target_checkpoint_id"] as? String
            choices.append(CoordinatorPacketChoice(
                slot: Int(slotValue),
                optionID: optionID,
                enabled: enabled,
                actionID: actionID,
                actionJSON: actionJSON,
                targetCheckpointID: target
            ))
        }
        guard let checkpoint = object["checkpoint"] as? [String: Any] else {
            throw CoordinatorError("decision_packet_checkpoint_mismatch")
        }
        try require(
            (checkpoint["id"] as? String).map {
                IdentifierNormalization.isByteExact(
                    $0,
                    packetBinding.episodeBaselineCheckpointID
                )
            } == true,
            "decision_packet_checkpoint_mismatch"
        )
        if let rollback = choices.first(where: { $0.slot == 4 }), rollback.enabled {
            try require(
                rollback.targetCheckpointID.map {
                    IdentifierNormalization.isByteExact(
                        $0,
                        packetBinding.episodeBaselineCheckpointID
                    )
                } == true,
                "rollback_target_checkpoint_mismatch"
            )
            throw CoordinatorError("rollback_not_supported_in_core")
        }
        return CoordinatorPacketDocument(
            binding: packetBinding,
            interactionID: interactionID,
            packetID: packetID,
            revision: revision,
            validAfterEventSequence: validAfter,
            sealedAt: sealedAt,
            expiresAt: expiresAt,
            choices: choices,
            canonicalJSON: try canonical(object)
        )
    }

    static func verification(from data: Data) throws -> CoordinatorVerificationRecord {
        let object = try StrictJSONTransport.object(from: data)
        try require(object["schema_version"] as? String == "1.0", "verification_record_schema_version_invalid")
        try require(
            object["kind"] as? String == "blabee_continuation_verification_record",
            "verification_record_kind_invalid"
        )
        try rejectRawTokens(object)
        let fingerprint = object["correlation_token_fingerprint"] as? String ?? ""
        try require(isFingerprint(fingerprint), "token_fingerprint_invalid")
        return CoordinatorVerificationRecord(
            dispatchEventID: try string(object, "dispatch_event_id", field: "dispatch_event_id", identifier: true),
            continuationID: try string(object, "continuation_id", field: "continuation_id", identifier: true),
            binding: try binding(object),
            interactionID: try string(object, "interaction_id", field: "interaction_id", identifier: true),
            packetID: try string(object, "packet_id", field: "packet_id", identifier: true),
            revision: try positiveInteger(object["revision"], code: "packet_revision_invalid"),
            optionID: try string(object, "option_id", field: "option_id", identifier: true),
            actionID: try string(object, "action_id", field: "action_id", identifier: true),
            correlationTokenFingerprint: fingerprint,
            canonicalJSON: try canonical(object)
        )
    }

    static func binding(_ object: [String: Any]) throws -> CoordinatorBinding {
        try CoordinatorBinding(jsonObject: object)
    }

    static func assertTurnLineage(_ left: CoordinatorBinding, equals right: CoordinatorBinding) throws {
        try require(
            left.sourcePromptID == right.sourcePromptID
                && left.episodeID == right.episodeID
                && left.episodeRootPromptID == right.episodeRootPromptID
                && left.episodeBaselineCheckpointID == right.episodeBaselineCheckpointID,
            "decision_boundary_lineage_mismatch"
        )
    }

    static func identifier(_ value: String, field: String) throws {
        try require(!value.isEmpty, "\(field)_missing")
        try require(value.unicodeScalars.count <= 512, "\(field)_invalid")
        try require(IdentifierNormalization.isNFC(value), "\(field)_invalid")
    }

    static func string(
        _ object: [String: Any],
        _ key: String,
        field: String,
        identifier: Bool = false,
        maximum: Int = 8_192
    ) throws -> String {
        guard let value = object[key] as? String, !value.isEmpty else {
            throw CoordinatorError("\(field)_missing")
        }
        try require(value.unicodeScalars.count <= (identifier ? 512 : maximum), "\(field)_invalid")
        if identifier {
            try require(IdentifierNormalization.isNFC(value), "\(field)_invalid")
        }
        return value
    }

    static func positiveInteger(_ value: Any?, code: String) throws -> Int64 {
        guard let result = ExactJSONInteger.int64(value, minimum: 1) else {
            throw CoordinatorError(code)
        }
        return result
    }

    static func bool(_ value: Any?) throws -> Bool {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID()
        else { throw CoordinatorError("boolean_invalid") }
        return number.boolValue
    }

    static func stableCode(_ value: String, code: String) throws {
        try require(
            value.range(of: "^[a-z][a-z0-9_]{0,127}$", options: .regularExpression) != nil,
            code
        )
    }

    static func isFingerprint(_ value: String) -> Bool {
        value.range(of: "^(sha256|hmac-sha256):[0-9a-f]{64}$", options: .regularExpression) != nil
    }

    static func canonical(_ value: Any) throws -> Data {
        try StrictJSONTransport.data(forJSONObject: value)
    }

    static func rejectRawTokens(_ value: Any) throws {
        if let object = value as? [String: Any] {
            for (key, child) in object {
                if key == "continuation_token" || key == "correlation_token" {
                    throw CoordinatorError("raw_continuation_token_forbidden")
                }
                try rejectRawTokens(child)
            }
        } else if let array = value as? [Any] {
            for child in array { try rejectRawTokens(child) }
        }
    }

    static func repairPayload(_ payload: [String: Any]) throws -> (
        continuationID: String,
        parentPromptID: String,
        fingerprint: String,
        issuedAt: RFC3339Instant,
        expiresAt: RFC3339Instant
    ) {
        let continuationID = try string(payload, "continuation_id", field: "continuation_id", identifier: true)
        _ = try string(payload, "repair_request_id", field: "repair_request_id", identifier: true)
        let parentPromptID = try string(payload, "parent_prompt_id", field: "parent_prompt_id", identifier: true)
        try require(payload["continuation_origin"] as? String == "internal_format_repair", "repair_origin_invalid")
        try require(payload["dispatch_mode"] as? String == "submitted_envelope", "dispatch_mode_conflict")
        try require(payload["repair_kind"] as? String == "decision_proposal_schema", "repair_kind_invalid")
        let repairAttempt = try positiveInteger(payload["repair_attempt"], code: "repair_attempt_invalid")
        let maximumRepairAttempts = try positiveInteger(
            payload["max_repair_attempts"], code: "repair_attempt_invalid"
        )
        try require(repairAttempt == 1 && maximumRepairAttempts == 1, "repair_attempt_invalid")
        let fingerprint = payload["correlation_token_fingerprint"] as? String ?? ""
        try require(isFingerprint(fingerprint), "token_fingerprint_invalid")
        return (
            continuationID,
            parentPromptID,
            fingerprint,
            try RFC3339Instant(try string(payload, "issued_at", field: "issued_at"), code: "format_repair_time_invalid"),
            try RFC3339Instant(try string(payload, "expires_at", field: "expires_at"), code: "format_repair_time_invalid")
        )
    }
}

public extension CoordinatorPacketDocument {
    static func parse(_ data: Data) throws -> CoordinatorPacketDocument {
        try SemanticJSON.packet(from: data)
    }
}
