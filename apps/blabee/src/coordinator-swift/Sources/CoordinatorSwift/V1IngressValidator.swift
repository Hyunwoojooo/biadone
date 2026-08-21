import Foundation
import CoreFoundation

public enum V1Contract: String, CaseIterable, Sendable {
    case runtimeEvent = "runtime_event"
    case decisionPacket = "decision_packet"
    case selectionRequest = "selection_request"
    case continuationEnvelope = "continuation_envelope"
}

public struct RuntimeEventDTO: Sendable, Equatable {
    public let eventID: String
    public let eventSequence: Int64
    public let eventType: String
    public let canonicalJSON: Data
}

public struct DecisionPacketDTO: Sendable, Equatable {
    public let packetID: String
    public let revision: Int64
    public let canonicalJSON: Data
}

public struct SelectionRequestDTO: Sendable, Equatable {
    public let selectionID: String
    public let canonicalJSON: Data
}

public struct ContinuationEnvelopeDTO: Sendable, Equatable {
    public let continuationID: String
    public let continuationOrigin: String
    public let canonicalJSON: Data
}

public enum ValidatedV1Document: Sendable, Equatable {
    case runtimeEvent(RuntimeEventDTO)
    case decisionPacket(DecisionPacketDTO)
    case selectionRequest(SelectionRequestDTO)
    case continuationEnvelope(ContinuationEnvelopeDTO)
}

public struct V1IngressValidator: Sendable {
    public let limits: StrictJSONLimits

    public init(limits: StrictJSONLimits = .v1) {
        self.limits = limits
    }

    public func validate(_ data: Data, as contract: V1Contract) throws -> ValidatedV1Document {
        let parsed = try validatedObject(data, as: contract)
        switch contract {
        case .runtimeEvent:
            return .runtimeEvent(RuntimeEventDTO(
                eventID: try V.string(parsed.value, "event_id", identifier: true),
                eventSequence: try V.positiveInteger(parsed.value, "event_sequence"),
                eventType: try V.string(parsed.value, "event_type"),
                canonicalJSON: parsed.canonicalData
            ))
        case .decisionPacket:
            return .decisionPacket(DecisionPacketDTO(
                packetID: try V.string(parsed.value, "packet_id", identifier: true),
                revision: try V.positiveInteger(parsed.value, "revision"),
                canonicalJSON: parsed.canonicalData
            ))
        case .selectionRequest:
            return .selectionRequest(SelectionRequestDTO(
                selectionID: try V.string(parsed.value, "selection_id", identifier: true),
                canonicalJSON: parsed.canonicalData
            ))
        case .continuationEnvelope:
            return .continuationEnvelope(ContinuationEnvelopeDTO(
                continuationID: try V.string(parsed.value, "continuation_id", identifier: true),
                continuationOrigin: try V.string(parsed.value, "continuation_origin"),
                canonicalJSON: parsed.canonicalData
            ))
        }
    }

    func validatedObject(_ data: Data, as contract: V1Contract) throws -> StrictJSONObject {
        do {
            let parsed = try StrictJSON.object(from: data, limits: limits)
            switch contract {
            case .runtimeEvent: try V.runtimeEvent(parsed.value)
            case .decisionPacket: try V.decisionPacket(parsed.value)
            case .selectionRequest: try V.selectionRequest(parsed.value)
            case .continuationEnvelope: try V.continuationEnvelope(parsed.value)
            }
            return parsed
        } catch let error as CoordinatorError where error.code == "contract_validation_failed" {
            throw error
        } catch {
            throw CoordinatorError("contract_validation_failed", error.coordinatorError.message)
        }
    }
}

private enum V {
    static let bindingKeys: Set<String> = [
        "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
        "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id",
        "boundary_sequence",
    ]

    static func exact(
        _ object: [String: Any],
        required: Set<String>,
        optional: Set<String> = []
    ) throws {
        let actual = Set(object.keys)
        try require(required.isSubset(of: actual), "contract_validation_failed", "required field is missing")
        try require(actual.isSubset(of: required.union(optional)), "contract_validation_failed", "unknown field")
    }

    static func string(
        _ object: [String: Any],
        _ key: String,
        minimum: Int = 1,
        maximum: Int = 8_192,
        identifier: Bool = false,
        pattern: String? = nil
    ) throws -> String {
        guard let value = object[key] as? String else {
            throw CoordinatorError("contract_validation_failed", "\(key) must be a string")
        }
        let count = value.unicodeScalars.count
        let upper = identifier ? 512 : maximum
        try require(count >= minimum && count <= upper, "contract_validation_failed", "\(key) length is invalid")
        if let pattern {
            try require(matches(value, pattern), "contract_validation_failed", "\(key) pattern is invalid")
        }
        return value
    }

    static func constant(_ object: [String: Any], _ key: String, _ expected: String) throws {
        try require(object[key] as? String == expected, "contract_validation_failed", "\(key) const mismatch")
    }

    static func oneOf(_ object: [String: Any], _ key: String, _ allowed: Set<String>) throws -> String {
        let value = try string(object, key)
        try require(allowed.contains(value), "contract_validation_failed", "\(key) enum mismatch")
        return value
    }

    static func positiveInteger(_ object: [String: Any], _ key: String) throws -> Int64 {
        guard let value = ExactJSONInteger.int64(object[key], minimum: 1) else {
            throw CoordinatorError("contract_validation_failed", "\(key) must be a positive integer")
        }
        return value
    }

    static func bool(_ object: [String: Any], _ key: String) throws -> Bool {
        guard let number = object[key] as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID()
        else {
            throw CoordinatorError("contract_validation_failed", "\(key) must be boolean")
        }
        return number.boolValue
    }

    static func null(_ object: [String: Any], _ key: String) throws {
        try require(object[key] is NSNull, "contract_validation_failed", "\(key) must be null")
    }

    static func object(_ object: [String: Any], _ key: String) throws -> [String: Any] {
        guard let value = object[key] as? [String: Any] else {
            throw CoordinatorError("contract_validation_failed", "\(key) must be an object")
        }
        return value
    }

    static func array(_ object: [String: Any], _ key: String, maximum: Int, minimum: Int = 0) throws -> [Any] {
        guard let value = object[key] as? [Any] else {
            throw CoordinatorError("contract_validation_failed", "\(key) must be an array")
        }
        try require(
            value.count >= minimum && value.count <= maximum,
            "contract_validation_failed",
            "\(key) item count is invalid"
        )
        return value
    }

    static func binding(_ object: [String: Any]) throws {
        for key in bindingKeys where key != "boundary_sequence" {
            _ = try string(object, key, identifier: true)
        }
        _ = try positiveInteger(object, "boundary_sequence")
    }

    static func stableCode(_ object: [String: Any], _ key: String) throws -> String {
        try string(object, key, maximum: 128, pattern: "^[a-z][a-z0-9_]{0,127}$")
    }

    static func timestamp(_ object: [String: Any], _ key: String) throws {
        let value = try string(object, key, maximum: 64)
        let pattern = "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
        try require(matches(value, pattern), "contract_validation_failed", "\(key) is not strict RFC3339")
        let bytes = Array(value.utf8)
        let year = decimal(bytes, 0, 4)
        let month = decimal(bytes, 5, 2)
        let day = decimal(bytes, 8, 2)
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        try require(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1], "contract_validation_failed", "\(key) calendar date is invalid")
    }

    static func action(_ object: [String: Any]) throws {
        try exact(object, required: ["title", "objective", "constraints", "done_when"])
        _ = try string(object, "title", maximum: 256)
        _ = try string(object, "objective")
        try stringArray(object, "constraints", maximum: 128, minimum: 0)
        try stringArray(object, "done_when", maximum: 128, minimum: 1)
    }

    static func stringArray(_ object: [String: Any], _ key: String, maximum: Int, minimum: Int) throws {
        let values = try array(object, key, maximum: maximum, minimum: minimum)
        for value in values {
            guard let item = value as? String else {
                throw CoordinatorError("contract_validation_failed", "\(key) items must be strings")
            }
            try require(item.unicodeScalars.count >= 1 && item.unicodeScalars.count <= 8_192, "contract_validation_failed")
        }
    }

    static func decisionPacket(_ packet: [String: Any]) throws {
        let root: Set<String> = Set([
            "schema_version", "kind", "interaction_id", "packet_id", "revision",
            "valid_after_event_sequence", "sealed_at", "expires_at", "summary", "evidence",
            "risk", "checkpoint", "choices",
        ]).union(bindingKeys)
        try exact(packet, required: root)
        try constant(packet, "schema_version", "1.0")
        try constant(packet, "kind", "blabee_decision_packet")
        try binding(packet)
        for key in ["interaction_id", "packet_id"] { _ = try string(packet, key, identifier: true) }
        _ = try positiveInteger(packet, "revision")
        _ = try positiveInteger(packet, "valid_after_event_sequence")
        try timestamp(packet, "sealed_at")
        try timestamp(packet, "expires_at")
        _ = try string(packet, "summary")

        let evidence = try array(packet, "evidence", maximum: 256)
        for raw in evidence {
            guard let item = raw as? [String: Any] else { throw CoordinatorError("contract_validation_failed") }
            try exact(item, required: ["evidence_id", "kind", "status", "summary", "source"])
            _ = try string(item, "evidence_id", identifier: true)
            _ = try stableCode(item, "kind")
            _ = try oneOf(item, "status", ["passed", "failed", "observed", "unknown"])
            _ = try string(item, "summary")
            _ = try oneOf(item, "source", ["local_verified", "codex_reported"])
        }

        let risk = try object(packet, "risk")
        try exact(risk, required: ["level", "reasons"])
        _ = try oneOf(risk, "level", ["info", "low", "medium", "high", "critical"])
        let reasons = try array(risk, "reasons", maximum: 128)
        for raw in reasons {
            guard let reason = raw as? String else { throw CoordinatorError("contract_validation_failed") }
            try require(matches(reason, "^[a-z][a-z0-9_]{0,127}$"), "contract_validation_failed")
        }

        let checkpoint = try object(packet, "checkpoint")
        try exact(checkpoint, required: ["id", "coverage"])
        _ = try string(checkpoint, "id", identifier: true)
        _ = try oneOf(checkpoint, "coverage", ["complete", "partial", "unavailable", "contract_only"])

        let choices = try array(packet, "choices", maximum: 4, minimum: 4)
        var optionIDs = Set<String>()
        var actionIDs = Set<String>()
        for (index, raw) in choices.enumerated() {
            guard let choice = raw as? [String: Any] else { throw CoordinatorError("contract_validation_failed") }
            try choiceObject(choice, slot: index + 1)
            let optionID = try string(choice, "option_id", identifier: true)
            try require(optionIDs.insert(optionID).inserted, "contract_validation_failed", "option_id must be unique")
            if let actionID = choice["action_id"] as? String {
                try require(actionIDs.insert(actionID).inserted, "contract_validation_failed", "action_id must be unique")
            }
        }
    }

    static func choiceObject(_ choice: [String: Any], slot: Int) throws {
        _ = try positiveInteger(choice, "slot")
        try require((choice["slot"] as? NSNumber)?.intValue == slot, "contract_validation_failed")
        let expectedKind = [1: "recommended_action", 2: "alternative_action", 3: "pause", 4: "rollback"][slot]!
        try constant(choice, "kind", expectedKind)
        let enabled = try bool(choice, "enabled")
        let base: Set<String> = ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id"]

        switch slot {
        case 1:
            try require(enabled, "contract_validation_failed")
            try exact(choice, required: base.union(["action"]))
            try null(choice, "disabled_reason")
            _ = try string(choice, "action_id", identifier: true)
            try action(try object(choice, "action"))
        case 2:
            if enabled {
                try exact(choice, required: base.union(["action"]))
                try null(choice, "disabled_reason")
                _ = try string(choice, "action_id", identifier: true)
                try action(try object(choice, "action"))
            } else {
                try exact(choice, required: base)
                _ = try stableCode(choice, "disabled_reason")
                try null(choice, "action_id")
            }
        case 3:
            try require(enabled, "contract_validation_failed")
            try exact(choice, required: base)
            try null(choice, "disabled_reason")
            _ = try string(choice, "action_id", identifier: true)
        case 4:
            if enabled {
                try exact(choice, required: base.union(["target_checkpoint_id"]))
                try null(choice, "disabled_reason")
                _ = try string(choice, "action_id", identifier: true)
                _ = try string(choice, "target_checkpoint_id", identifier: true)
            } else {
                try exact(choice, required: base)
                _ = try stableCode(choice, "disabled_reason")
                try null(choice, "action_id")
            }
        default:
            throw CoordinatorError("contract_validation_failed")
        }
        _ = try string(choice, "option_id", identifier: true)
    }

    static func selectionRequest(_ request: [String: Any]) throws {
        let root: Set<String> = Set([
            "schema_version", "kind", "selection_id", "interaction_id", "packet_id", "revision",
            "option_id",
        ]).union(bindingKeys)
        try exact(request, required: root)
        try constant(request, "schema_version", "1.0")
        try constant(request, "kind", "blabee_selection_request")
        try binding(request)
        for key in ["selection_id", "interaction_id", "packet_id", "option_id"] {
            _ = try string(request, key, identifier: true)
        }
        _ = try positiveInteger(request, "revision")
    }

    static func continuationEnvelope(_ envelope: [String: Any]) throws {
        try constant(envelope, "schema_version", "1.0")
        try constant(envelope, "kind", "blabee_episode_continuation")
        let origin = try oneOf(envelope, "continuation_origin", ["pet_action", "internal_format_repair"])
        try binding(envelope)
        for key in ["continuation_id"] { _ = try string(envelope, key, identifier: true) }
        _ = try string(envelope, "continuation_token", minimum: 16, maximum: 1_024, pattern: "^[A-Za-z0-9_-]+$")
        try timestamp(envelope, "issued_at")
        try timestamp(envelope, "expires_at")

        if origin == "pet_action" {
            let root: Set<String> = Set([
                "schema_version", "kind", "continuation_origin", "dispatch_mode", "continuation_id",
                "continuation_token", "interaction_id", "packet_id", "revision", "option_id", "action_id",
                "action", "issued_at", "expires_at", "in_flight_deadline_at",
            ]).union(bindingKeys)
            try exact(envelope, required: root)
            try constant(envelope, "dispatch_mode", "same_turn_stop")
            for key in ["interaction_id", "packet_id", "option_id", "action_id"] {
                _ = try string(envelope, key, identifier: true)
            }
            _ = try positiveInteger(envelope, "revision")
            try action(try object(envelope, "action"))
            try timestamp(envelope, "in_flight_deadline_at")
        } else {
            let root: Set<String> = Set([
                "schema_version", "kind", "continuation_origin", "dispatch_mode", "continuation_id",
                "continuation_token", "repair_request_id", "repair_kind", "repair_attempt",
                "max_repair_attempts", "issued_at", "expires_at",
            ]).union(bindingKeys)
            try exact(envelope, required: root)
            try constant(envelope, "dispatch_mode", "submitted_envelope")
            _ = try string(envelope, "repair_request_id", identifier: true)
            try constant(envelope, "repair_kind", "decision_proposal_schema")
            let repairAttempt = try positiveInteger(envelope, "repair_attempt")
            let maximumAttempts = try positiveInteger(envelope, "max_repair_attempts")
            try require(repairAttempt == 1, "contract_validation_failed")
            try require(maximumAttempts == 1, "contract_validation_failed")
        }
    }

    static func runtimeEvent(_ event: [String: Any]) throws {
        let root: Set<String> = Set([
            "schema_version", "kind", "event_id", "event_sequence", "event_type", "event_category",
            "occurred_at", "payload",
        ]).union(bindingKeys)
        try exact(event, required: root)
        try constant(event, "schema_version", "1.0")
        try constant(event, "kind", "blabee_runtime_event")
        _ = try string(event, "event_id", identifier: true)
        _ = try positiveInteger(event, "event_sequence")
        try binding(event)
        try timestamp(event, "occurred_at")
        let type = try oneOf(event, "event_type", Set(eventCategories.keys))
        try constant(event, "event_category", eventCategories[type]!)
        try runtimePayload(try object(event, "payload"), type: type)
        try StrictJSON.rejectRawTokenKeys(event)
    }

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

    static func runtimePayload(_ payload: [String: Any], type: String) throws {
        switch type {
        case "decision_boundary_opened":
            try exact(payload, required: ["proposal_id"])
            _ = try string(payload, "proposal_id", identifier: true)
        case "decision_boundary_closed":
            try exact(payload, required: ["close_reason"])
            _ = try stableCode(payload, "close_reason")
        case "decision_packet_sealed":
            try exact(payload, required: ["interaction_id", "packet_id", "revision", "expires_at"])
            _ = try string(payload, "interaction_id", identifier: true)
            _ = try string(payload, "packet_id", identifier: true)
            _ = try positiveInteger(payload, "revision")
            try timestamp(payload, "expires_at")
        case "decision_selection_claimed":
            try exact(payload, required: ["selection_id", "interaction_id", "packet_id", "revision", "option_id"])
            for key in ["selection_id", "interaction_id", "packet_id", "option_id"] {
                _ = try string(payload, key, identifier: true)
            }
            _ = try positiveInteger(payload, "revision")
        case "internal_format_repair_reserved", "internal_format_repair_claimed":
            let keys: Set<String> = [
                "continuation_origin", "continuation_id", "repair_request_id", "parent_prompt_id",
                "repair_kind", "repair_attempt", "max_repair_attempts", "dispatch_mode", "issued_at",
                "expires_at", "correlation_token_fingerprint",
            ]
            try exact(payload, required: keys)
            try constant(payload, "continuation_origin", "internal_format_repair")
            for key in ["continuation_id", "repair_request_id", "parent_prompt_id"] {
                _ = try string(payload, key, identifier: true)
            }
            try constant(payload, "repair_kind", "decision_proposal_schema")
            let repairAttempt = try positiveInteger(payload, "repair_attempt")
            let maximumAttempts = try positiveInteger(payload, "max_repair_attempts")
            try require(repairAttempt == 1, "contract_validation_failed")
            try require(maximumAttempts == 1, "contract_validation_failed")
            try constant(payload, "dispatch_mode", "submitted_envelope")
            try timestamp(payload, "issued_at")
            try timestamp(payload, "expires_at")
            _ = try string(payload, "correlation_token_fingerprint", maximum: 76, pattern: "^(sha256|hmac-sha256):[0-9a-f]{64}$")
        case "continuation_dispatched":
            let keys: Set<String> = [
                "continuation_id", "interaction_id", "packet_id", "revision", "option_id", "action_id",
                "dispatch_mode", "issued_at", "expires_at", "in_flight_deadline_at",
            ]
            try exact(payload, required: keys)
            for key in ["continuation_id", "interaction_id", "packet_id", "option_id", "action_id"] {
                _ = try string(payload, key, identifier: true)
            }
            _ = try positiveInteger(payload, "revision")
            try constant(payload, "dispatch_mode", "same_turn_stop")
            try timestamp(payload, "issued_at")
            try timestamp(payload, "expires_at")
            try timestamp(payload, "in_flight_deadline_at")
        case "continuation_consumed":
            try exact(payload, required: ["continuation_id", "dispatch_mode"])
            _ = try string(payload, "continuation_id", identifier: true)
            _ = try oneOf(payload, "dispatch_mode", ["same_turn_stop", "submitted_envelope"])
        case "continuation_transport_completed":
            try exact(payload, required: ["continuation_id", "transport_status", "work_outcome_status"])
            _ = try string(payload, "continuation_id", identifier: true)
            try constant(payload, "transport_status", "completed")
            try constant(payload, "work_outcome_status", "not_recorded")
        case "continuation_transport_timed_out_unknown":
            let keys: Set<String> = [
                "continuation_id", "transport_status", "work_outcome_status", "automatic_retry",
                "cancellation_inferred", "failure_inferred",
            ]
            try exact(payload, required: keys)
            _ = try string(payload, "continuation_id", identifier: true)
            try constant(payload, "transport_status", "timed_out_unknown")
            try constant(payload, "work_outcome_status", "unknown")
            let automaticRetry = try bool(payload, "automatic_retry")
            let cancellationInferred = try bool(payload, "cancellation_inferred")
            let failureInferred = try bool(payload, "failure_inferred")
            try require(automaticRetry == false, "contract_validation_failed")
            try require(cancellationInferred == false, "contract_validation_failed")
            try require(failureInferred == false, "contract_validation_failed")
        case "work_outcome_recorded":
            try exact(payload, required: ["continuation_id", "action_id", "work_outcome_status", "summary", "evidence_ids"])
            _ = try string(payload, "continuation_id", identifier: true)
            _ = try string(payload, "action_id", identifier: true)
            _ = try oneOf(payload, "work_outcome_status", ["succeeded", "failed", "cancelled", "unknown"])
            _ = try string(payload, "summary")
            let IDs = try array(payload, "evidence_ids", maximum: 256)
            for raw in IDs {
                guard let value = raw as? String else { throw CoordinatorError("contract_validation_failed") }
                try require(value.unicodeScalars.count >= 1 && value.unicodeScalars.count <= 512, "contract_validation_failed")
            }
        case "interaction_expired":
            try exact(payload, required: ["interaction_id", "packet_id", "revision", "reason", "automatic_selection"])
            _ = try string(payload, "interaction_id", identifier: true)
            _ = try string(payload, "packet_id", identifier: true)
            _ = try positiveInteger(payload, "revision")
            _ = try stableCode(payload, "reason")
            let automaticSelection = try bool(payload, "automatic_selection")
            try require(automaticSelection == false, "contract_validation_failed")
        default:
            throw CoordinatorError("contract_validation_failed")
        }
    }

    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }

    static func decimal(_ bytes: [UInt8], _ start: Int, _ length: Int) -> Int {
        bytes[start..<(start + length)].reduce(0) { $0 * 10 + Int($1 - 0x30) }
    }
}
