import CoordinatorSwift
import Foundation

enum PetModelError: Error, Equatable, CustomStringConvertible {
    case invalid(String)

    var description: String {
        switch self {
        case .invalid(let field):
            return "invalid Pet snapshot field: \(field)"
        }
    }
}

private let petIdentityKeys: Set<String> = [
    "interaction_id", "packet_id", "revision", "project_id", "session_id",
    "source_turn_id", "source_prompt_id", "episode_id", "episode_root_prompt_id",
    "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence",
]

private func petRequire(_ condition: @autoclosure () -> Bool, _ field: String) throws {
    guard condition() else { throw PetModelError.invalid(field) }
}

private func petExactKeys(
    _ object: [String: Any],
    _ expected: Set<String>,
    _ field: String
) throws {
    try petRequire(Set(object.keys) == expected, field)
}

private func petString(
    _ object: [String: Any],
    _ key: String,
    maximum: Int = 8_192
) throws -> String {
    guard let value = object[key] as? String,
          !value.isEmpty,
          value.count <= maximum
    else { throw PetModelError.invalid(key) }
    return value
}

private func petNullableString(
    _ object: [String: Any],
    _ key: String,
    maximum: Int = 512
) throws -> String? {
    if object[key] is NSNull { return nil }
    return try petString(object, key, maximum: maximum)
}

private func petBoolean(_ object: [String: Any], _ key: String) throws -> Bool {
    guard let rawValue = object[key],
          CFGetTypeID(rawValue as CFTypeRef) == CFBooleanGetTypeID(),
          let value = rawValue as? Bool
    else { throw PetModelError.invalid(key) }
    return value
}

func petStrictBooleanValue(_ rawValue: Any?) -> Bool? {
    guard let rawValue,
          CFGetTypeID(rawValue as CFTypeRef) == CFBooleanGetTypeID()
    else { return nil }
    return rawValue as? Bool
}

private func petInteger(
    _ object: [String: Any],
    _ key: String,
    minimum: Int64 = 0
) throws -> Int64 {
    guard let value = ExactJSONInteger.int64(object[key], minimum: minimum) else {
        throw PetModelError.invalid(key)
    }
    return value
}

private func petStrictlyIncreasing(
    _ values: [Int64],
    field: String
) throws {
    try petRequire(
        zip(values, values.dropFirst()).allSatisfy { $0.0 < $0.1 },
        field
    )
}

private func petStableCode(_ value: String, field: String) throws -> String {
    try petRequire(value.count <= 128, field)
    try petRequire(
        value.range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression) != nil,
        field
    )
    return value
}

private func petManagedCommandApprovalPath(_ path: String) throws -> String {
    let components = path.split(
        separator: "/",
        omittingEmptySubsequences: false
    )
    try petRequire(
        path.hasPrefix("/")
            && path.unicodeScalars.count <= 4_096
            && path.precomposedStringWithCanonicalMapping.utf8
                .elementsEqual(path.utf8)
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
        "managed_command_approval.cwd"
    )
    // Keep the coordinator's validated wire value exact. Foundation can
    // rewrite valid macOS aliases such as /private/tmp to /tmp based on
    // filesystem state, which would otherwise break the resolution binding.
    return path
}

struct PetInteractionIdentity: Sendable, Hashable {
    let interactionID: String
    let packetID: String
    let revision: Int64
    let binding: CoordinatorBinding

    init(
        interactionID: String,
        packetID: String,
        revision: Int64,
        binding: CoordinatorBinding
    ) throws {
        try petRequire(!interactionID.isEmpty && interactionID.count <= 512, "interaction_id")
        try petRequire(!packetID.isEmpty && packetID.count <= 512, "packet_id")
        try petRequire(revision > 0, "revision")
        self.interactionID = interactionID
        self.packetID = packetID
        self.revision = revision
        self.binding = binding
    }

    init(jsonObject: [String: Any], exactKeys: Bool = false) throws {
        if exactKeys {
            try petExactKeys(jsonObject, petIdentityKeys, "interaction_identity")
        }
        try self.init(
            interactionID: petString(jsonObject, "interaction_id", maximum: 512),
            packetID: petString(jsonObject, "packet_id", maximum: 512),
            revision: petInteger(jsonObject, "revision", minimum: 1),
            binding: CoordinatorBinding(jsonObject: jsonObject)
        )
    }

    var jsonObject: [String: Any] {
        var result = binding.jsonObject
        result["interaction_id"] = interactionID
        result["packet_id"] = packetID
        result["revision"] = revision
        return result
    }
}

struct PetProject: Sendable, Equatable {
    let projectID: String
    let cwd: String
    let enabled: Bool

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(jsonObject, ["project_id", "cwd", "enabled"], "project")
        projectID = try petString(jsonObject, "project_id", maximum: 512)
        let rawPath = try petString(jsonObject, "cwd", maximum: 4_096)
        try petRequire(rawPath.hasPrefix("/"), "cwd")
        cwd = URL(fileURLWithPath: rawPath, isDirectory: true).standardizedFileURL.path
        enabled = try petBoolean(jsonObject, "enabled")
    }
}

struct PetSession: Sendable, Equatable {
    let projectID: String
    let sessionID: String
    let sourceTurnID: String?
    let sourcePromptID: String?
    let episodeID: String?

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(
            jsonObject,
            ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id"],
            "session"
        )
        projectID = try petString(jsonObject, "project_id", maximum: 512)
        sessionID = try petString(jsonObject, "session_id", maximum: 512)
        sourceTurnID = try petNullableString(jsonObject, "source_turn_id")
        sourcePromptID = try petNullableString(jsonObject, "source_prompt_id")
        episodeID = try petNullableString(jsonObject, "episode_id")
    }
}

enum PetPermissionDecision: String, Sendable, Equatable, CaseIterable {
    case deny
    case deferToCodex = "defer_to_codex"

    var displayTitle: String {
        switch self {
        case .deny: "거절"
        case .deferToCodex: "Codex에서 직접 결정"
        }
    }
}

enum PetApprovalHeadIdentity: Sendable, Equatable, Hashable {
    case permission(requestID: String)
    case managed(managedRequestID: String)
}

enum PetManagedCommandApprovalDecision: String, Sendable, Equatable, CaseIterable {
    case acceptOnce = "accept_once"
    case decline
    case decideInCodex = "decide_in_codex"

    var displayTitle: String {
        switch self {
        case .acceptOnce: "이번만 허용"
        case .decline: "거절"
        case .decideInCodex: "Codex에서 직접 결정"
        }
    }
}

enum PetManagedJSONRPCRequestID: Sendable, Equatable, Hashable {
    case string(String)
    case integer(Int64)

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(jsonObject, ["type", "value"], "jsonrpc_request_id")
        let type = try petString(jsonObject, "type", maximum: 16)
        if type == "string" {
            let value = try petString(jsonObject, "value", maximum: 512)
            try petRequire(
                value.precomposedStringWithCanonicalMapping.utf8.elementsEqual(value.utf8),
                "jsonrpc_request_id.value"
            )
            self = .string(value)
            return
        }
        if type == "integer",
           let value = ExactJSONInteger.int64(jsonObject["value"])
        {
            self = .integer(value)
            return
        }
        throw PetModelError.invalid("jsonrpc_request_id")
    }

    var jsonObject: [String: Any] {
        switch self {
        case .string(let value): ["type": "string", "value": value]
        case .integer(let value): ["type": "integer", "value": value]
        }
    }
}

struct PetManagedCommandApproval: Sendable, Equatable, Identifiable {
    let arrivalSequence: Int64
    let managedRequestID: String
    let brokerEpoch: String
    let connectionID: String
    let jsonRPCRequestID: PetManagedJSONRPCRequestID
    let threadID: String
    let turnID: String
    let itemID: String
    let approvalID: String?
    let environmentID: String?
    let cwd: String
    let commandPreview: String
    let allowOnceAvailable: Bool
    let declineAvailable: Bool
    let deliveryPending: Bool

    var id: String { managedRequestID }

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(
            jsonObject,
            [
                "arrival_sequence", "managed_request_id", "broker_epoch", "connection_id",
                "jsonrpc_request_id", "thread_id", "turn_id", "item_id",
                "approval_id", "environment_id", "cwd", "command_preview", "allow_once_available",
                "decline_available", "delivery_pending",
            ],
            "managed_command_approval"
        )
        arrivalSequence = try petInteger(
            jsonObject,
            "arrival_sequence",
            minimum: 1
        )
        managedRequestID = try petString(
            jsonObject,
            "managed_request_id",
            maximum: 512
        )
        brokerEpoch = try petString(jsonObject, "broker_epoch", maximum: 512)
        connectionID = try petString(jsonObject, "connection_id", maximum: 512)
        guard let rawJSONRPCRequestID = jsonObject["jsonrpc_request_id"]
            as? [String: Any]
        else { throw PetModelError.invalid("jsonrpc_request_id") }
        jsonRPCRequestID = try PetManagedJSONRPCRequestID(
            jsonObject: rawJSONRPCRequestID
        )
        threadID = try petString(jsonObject, "thread_id", maximum: 512)
        turnID = try petString(jsonObject, "turn_id", maximum: 512)
        itemID = try petString(jsonObject, "item_id", maximum: 512)
        approvalID = try petNullableString(
            jsonObject,
            "approval_id",
            maximum: 512
        )
        environmentID = try petNullableString(
            jsonObject,
            "environment_id",
            maximum: 512
        )
        cwd = try petManagedCommandApprovalPath(
            petString(jsonObject, "cwd", maximum: 4_096)
        )
        commandPreview = try petString(
            jsonObject,
            "command_preview",
            maximum: PetPermissionRequest.maximumCommandScalars
        )
        try petRequire(
            !commandPreview.trimmingCharacters(in: .whitespaces).isEmpty
                && commandPreview.precomposedStringWithCanonicalMapping.utf8
                    .elementsEqual(commandPreview.utf8)
                && commandPreview.unicodeScalars.allSatisfy({ scalar in
                    let category = scalar.properties.generalCategory
                    return !scalar.properties.isDefaultIgnorableCodePoint
                        && category != .control
                        && category != .format
                        && category != .lineSeparator
                        && category != .paragraphSeparator
                }),
            "managed_command_approval.command_preview"
        )
        allowOnceAvailable = try petBoolean(jsonObject, "allow_once_available")
        declineAvailable = try petBoolean(jsonObject, "decline_available")
        deliveryPending = try petBoolean(jsonObject, "delivery_pending")
    }

    var bindingObject: [String: Any] {
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
}

struct PetPermissionRequest: Sendable, Equatable, Identifiable {
    static let maximumCommandScalars = 120

    let arrivalSequence: Int64
    let requestID: String
    let projectID: String
    let sessionID: String
    let turnID: String
    let cwd: String
    let toolName: String
    let requestDescription: String?
    let commandPreview: String
    let deliveryPending: Bool

    var id: String { requestID }

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(
            jsonObject,
            [
                "arrival_sequence", "request_id", "project_id", "session_id", "turn_id", "cwd",
                "tool_name", "description", "command_preview", "delivery_pending",
            ],
            "permission_request"
        )
        arrivalSequence = try petInteger(
            jsonObject,
            "arrival_sequence",
            minimum: 1
        )
        requestID = try petString(jsonObject, "request_id", maximum: 512)
        projectID = try petString(jsonObject, "project_id", maximum: 512)
        sessionID = try petString(jsonObject, "session_id", maximum: 512)
        turnID = try petString(jsonObject, "turn_id", maximum: 512)
        let rawPath = try petString(jsonObject, "cwd", maximum: 4_096)
        try petRequire(rawPath.hasPrefix("/"), "permission_request.cwd")
        cwd = URL(fileURLWithPath: rawPath, isDirectory: true).standardizedFileURL.path
        toolName = try petString(jsonObject, "tool_name", maximum: 512)
        requestDescription = try petNullableString(
            jsonObject,
            "description",
            maximum: 4_096
        )
        deliveryPending = try petBoolean(jsonObject, "delivery_pending")
        commandPreview = try petString(
            jsonObject,
            "command_preview",
            maximum: Self.maximumCommandScalars
        )
        try petRequire(
            !commandPreview.trimmingCharacters(in: .whitespaces).isEmpty
                && commandPreview.unicodeScalars.allSatisfy({ scalar in
                    let category = scalar.properties.generalCategory
                    return !scalar.properties.isDefaultIgnorableCodePoint
                        && category != .control
                        && category != .format
                        && category != .lineSeparator
                        && category != .paragraphSeparator
                }),
            "permission_request.command_preview"
        )
    }

    var displaySummary: String {
        requestDescription ?? commandPreview
    }
}

enum PetApprovalHead: Sendable, Equatable {
    case permission(PetPermissionRequest)
    case managed(PetManagedCommandApproval)

    var identity: PetApprovalHeadIdentity {
        switch self {
        case .permission(let request):
            .permission(requestID: request.requestID)
        case .managed(let request):
            .managed(managedRequestID: request.managedRequestID)
        }
    }

    var arrivalSequence: Int64 {
        switch self {
        case .permission(let request): request.arrivalSequence
        case .managed(let request): request.arrivalSequence
        }
    }

    static func first(
        permissionRequests: [PetPermissionRequest],
        managedCommandApprovals: [PetManagedCommandApproval]
    ) -> PetApprovalHead? {
        switch (permissionRequests.first, managedCommandApprovals.first) {
        case (.none, .none):
            nil
        case (.some(let request), .none):
            .permission(request)
        case (.none, .some(let request)):
            .managed(request)
        case (.some(let permission), .some(let managed)):
            permission.arrivalSequence < managed.arrivalSequence
                ? .permission(permission)
                : .managed(managed)
        }
    }
}

enum PetRiskLevel: String, Sendable, Equatable, CaseIterable {
    case info
    case low
    case medium
    case high
    case critical
    case unknown

    var allowsGlobalShortcut: Bool {
        self == .info || self == .low || self == .medium
    }

    var requiresPanelConfirmation: Bool { !allowsGlobalShortcut }
}

struct PetRisk: Sendable, Equatable {
    let level: PetRiskLevel
    let reasons: [String]

    init(level: PetRiskLevel, reasons: [String]) {
        self.level = level
        self.reasons = reasons
    }

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(jsonObject, ["level", "reasons"], "risk")
        let rawLevel = try petString(jsonObject, "level", maximum: 32)
        guard let parsed = PetRiskLevel(rawValue: rawLevel), parsed != .unknown else {
            throw PetModelError.invalid("risk.level")
        }
        guard let rawReasons = jsonObject["reasons"] as? [Any], rawReasons.count <= 128 else {
            throw PetModelError.invalid("risk.reasons")
        }
        level = parsed
        reasons = try rawReasons.enumerated().map { index, raw in
            guard let value = raw as? String else {
                throw PetModelError.invalid("risk.reasons[\(index)]")
            }
            return try petStableCode(value, field: "risk.reasons[\(index)]")
        }
    }
}

struct PetEvidence: Sendable, Equatable, Identifiable {
    let evidenceID: String
    let kind: String
    let status: String
    let summary: String
    let source: String

    var id: String { evidenceID }

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(
            jsonObject,
            ["evidence_id", "kind", "status", "summary", "source"],
            "evidence"
        )
        evidenceID = try petString(jsonObject, "evidence_id", maximum: 512)
        kind = try petStableCode(
            petString(jsonObject, "kind", maximum: 128),
            field: "evidence.kind"
        )
        status = try petString(jsonObject, "status", maximum: 32)
        try petRequire(["passed", "failed", "observed", "unknown"].contains(status), "evidence.status")
        summary = try petString(jsonObject, "summary")
        source = try petString(jsonObject, "source", maximum: 32)
        try petRequire(["local_verified", "codex_reported"].contains(source), "evidence.source")
    }
}

struct PetCheckpoint: Sendable, Equatable {
    let id: String
    let coverage: String

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(jsonObject, ["id", "coverage"], "checkpoint")
        id = try petString(jsonObject, "id", maximum: 512)
        coverage = try petString(jsonObject, "coverage", maximum: 32)
        try petRequire(
            ["complete", "partial", "unavailable", "contract_only"].contains(coverage),
            "checkpoint.coverage"
        )
    }

    var isRecoveryCapable: Bool { coverage == "complete" }
}

struct PetOutcome: Sendable, Equatable {
    let status: String
    let summary: String

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(jsonObject, ["status", "summary"], "outcome")
        status = try petString(jsonObject, "status", maximum: 32)
        try petRequire(["completed", "partial", "blocked", "failed"].contains(status), "outcome.status")
        summary = try petString(jsonObject, "summary")
    }
}

struct PetReportedSideEffect: Sendable, Equatable, Identifiable {
    let kind: String
    let summary: String
    let reversibility: String

    var id: String { kind + "\u{0}" + summary + "\u{0}" + reversibility }

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(jsonObject, ["kind", "summary", "reversibility"], "reported_side_effect")
        kind = try petStableCode(
            petString(jsonObject, "kind", maximum: 128),
            field: "reported_side_effect.kind"
        )
        summary = try petString(jsonObject, "summary")
        reversibility = try petString(jsonObject, "reversibility", maximum: 32)
        try petRequire(
            ["reversible", "irreversible", "unknown"].contains(reversibility),
            "reported_side_effect.reversibility"
        )
    }
}

struct PetAction: Sendable, Equatable {
    let title: String
    let objective: String
    let constraints: [String]
    let doneWhen: [String]

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(
            jsonObject,
            ["title", "objective", "constraints", "done_when"],
            "action"
        )
        title = try petString(jsonObject, "title", maximum: 256)
        objective = try petString(jsonObject, "objective")
        guard let rawConstraints = jsonObject["constraints"] as? [Any],
              rawConstraints.count <= 128,
              let rawDoneWhen = jsonObject["done_when"] as? [Any],
              !rawDoneWhen.isEmpty,
              rawDoneWhen.count <= 128
        else { throw PetModelError.invalid("action") }
        constraints = try rawConstraints.enumerated().map { index, raw in
            guard let value = raw as? String, !value.isEmpty, value.count <= 8_192 else {
                throw PetModelError.invalid("action.constraints[\(index)]")
            }
            return value
        }
        doneWhen = try rawDoneWhen.enumerated().map { index, raw in
            guard let value = raw as? String, !value.isEmpty, value.count <= 8_192 else {
                throw PetModelError.invalid("action.done_when[\(index)]")
            }
            return value
        }
    }
}

struct PetChoice: Sendable, Equatable, Identifiable {
    let slot: Int
    let kind: String
    let enabled: Bool
    let disabledReason: String?
    let optionID: String
    let actionID: String?
    let action: PetAction?
    let targetCheckpointID: String?

    var id: Int { slot }
    var isAction: Bool { action != nil }
    var isPause: Bool { kind == "pause" }
    var isRollback: Bool { kind == "rollback" }

    var displayTitle: String {
        if let action { return action.title }
        switch kind {
        case "pause": return "보류"
        case "rollback": return "롤백"
        case "alternative_action": return "대안 없음"
        default: return "사용할 수 없음"
        }
    }

    init(jsonObject: [String: Any], expectedSlot: Int) throws {
        let slot = try petInteger(jsonObject, "slot", minimum: 1)
        try petRequire(slot == Int64(expectedSlot), "choices.slot")
        self.slot = expectedSlot
        kind = try petString(jsonObject, "kind", maximum: 64)
        enabled = try petBoolean(jsonObject, "enabled")
        optionID = try petString(jsonObject, "option_id", maximum: 512)

        if jsonObject["disabled_reason"] is NSNull {
            disabledReason = nil
        } else {
            disabledReason = try petStableCode(
                petString(jsonObject, "disabled_reason", maximum: 128),
                field: "choices.disabled_reason"
            )
        }
        if jsonObject["action_id"] is NSNull {
            actionID = nil
        } else {
            actionID = try petString(jsonObject, "action_id", maximum: 512)
        }

        switch kind {
        case "recommended_action":
            try petRequire(expectedSlot == 1, "choices.kind")
            try petExactKeys(
                jsonObject,
                ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id", "action"],
                "choices[\(expectedSlot - 1)]"
            )
            try petRequire(enabled, "choices[\(expectedSlot - 1)]")
            try petRequire(disabledReason == nil && actionID != nil, "choices[\(expectedSlot - 1)]")
            guard let rawAction = jsonObject["action"] as? [String: Any] else {
                throw PetModelError.invalid("choices[\(expectedSlot - 1)].action")
            }
            action = try PetAction(jsonObject: rawAction)
            targetCheckpointID = nil
        case "alternative_action":
            try petRequire((2...4).contains(expectedSlot), "choices.kind")
            if enabled {
                try petExactKeys(
                    jsonObject,
                    ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id", "action"],
                    "choices[\(expectedSlot - 1)]"
                )
                try petRequire(disabledReason == nil && actionID != nil, "choices[\(expectedSlot - 1)]")
                guard let rawAction = jsonObject["action"] as? [String: Any] else {
                    throw PetModelError.invalid("choices[\(expectedSlot - 1)].action")
                }
                action = try PetAction(jsonObject: rawAction)
            } else {
                try petRequire(expectedSlot == 2, "choices[1]")
                try petExactKeys(
                    jsonObject,
                    ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id"],
                    "choices[1]"
                )
                try petRequire(disabledReason != nil && actionID == nil, "choices[1]")
                action = nil
            }
            targetCheckpointID = nil
        case "pause":
            try petRequire(expectedSlot == 3, "choices[2].kind")
            try petExactKeys(
                jsonObject,
                ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id"],
                "choices[2]"
            )
            try petRequire(enabled, "choices[2]")
            try petRequire(disabledReason == nil && actionID != nil, "choices[2]")
            action = nil
            targetCheckpointID = nil
        case "rollback":
            try petRequire(expectedSlot == 4, "choices[3].kind")
            if enabled {
                try petExactKeys(
                    jsonObject,
                    [
                        "slot", "kind", "enabled", "disabled_reason", "option_id",
                        "action_id", "target_checkpoint_id",
                    ],
                    "choices[3]"
                )
                try petRequire(disabledReason == nil && actionID != nil, "choices[3]")
                targetCheckpointID = try petString(
                    jsonObject,
                    "target_checkpoint_id",
                    maximum: 512
                )
            } else {
                try petExactKeys(
                    jsonObject,
                    ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id"],
                    "choices[3]"
                )
                try petRequire(disabledReason != nil && actionID == nil, "choices[3]")
                targetCheckpointID = nil
            }
            action = nil
        default:
            throw PetModelError.invalid("choices.kind")
        }
    }
}

struct PetRoutingItem: Sendable, Equatable {
    let identity: PetInteractionIdentity
    let foreground: Bool
    let reminderDue: Bool
    let millisecondsUntilExpiry: Int64

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(
            jsonObject,
            petIdentityKeys.union([
                "state", "foreground", "reminder_due", "milliseconds_until_expiry",
            ]),
            "routing.pending"
        )
        let state = try petString(jsonObject, "state", maximum: 32)
        try petRequire(state == "pending", "routing.pending.state")
        identity = try PetInteractionIdentity(jsonObject: jsonObject)
        foreground = try petBoolean(jsonObject, "foreground")
        reminderDue = try petBoolean(jsonObject, "reminder_due")
        millisecondsUntilExpiry = try petInteger(
            jsonObject,
            "milliseconds_until_expiry",
            minimum: 0
        )
    }
}

struct PetRoutingSnapshot: Sendable, Equatable {
    let selectionEnabled: Bool
    let foreground: PetInteractionIdentity?
    let pending: [PetRoutingItem]
    let inFlightCount: Int64

    init(jsonObject: [String: Any]) throws {
        try petExactKeys(
            jsonObject,
            [
                "schema_version", "kind", "selection_enabled", "foreground", "pending",
                "in_flight_count",
            ],
            "routing"
        )
        let schemaVersion = try petString(jsonObject, "schema_version", maximum: 16)
        let kind = try petString(jsonObject, "kind", maximum: 64)
        try petRequire(schemaVersion == "1.0", "routing.schema_version")
        try petRequire(kind == "blabee_routing_snapshot", "routing.kind")
        selectionEnabled = try petBoolean(jsonObject, "selection_enabled")
        if jsonObject["foreground"] is NSNull {
            foreground = nil
        } else if let rawForeground = jsonObject["foreground"] as? [String: Any] {
            foreground = try PetInteractionIdentity(jsonObject: rawForeground, exactKeys: true)
        } else {
            throw PetModelError.invalid("routing.foreground")
        }
        guard let rawPending = jsonObject["pending"] as? [[String: Any]] else {
            throw PetModelError.invalid("routing.pending")
        }
        pending = try rawPending.map(PetRoutingItem.init(jsonObject:))
        try petRequire(Set(pending.map(\.identity)).count == pending.count, "routing.pending")
        inFlightCount = try petInteger(jsonObject, "in_flight_count", minimum: 0)
        try petRequire(selectionEnabled == (foreground != nil), "routing.selection_enabled")
        let markedForeground = pending.filter(\.foreground)
        if let foreground {
            try petRequire(markedForeground.count == 1, "routing.foreground")
            try petRequire(markedForeground[0].identity == foreground, "routing.foreground")
        } else {
            try petRequire(markedForeground.isEmpty, "routing.foreground")
        }
    }
}

struct PetInteraction: Sendable, Equatable, Identifiable {
    enum State: String, Sendable, Equatable {
        case sealed
        case waiting
    }

    let identity: PetInteractionIdentity
    let state: State
    let cwd: String
    let summary: String
    let outcome: PetOutcome?
    let reportedSideEffects: [PetReportedSideEffect]
    let sealedAt: String
    let expiresAt: String
    let validAfterEventSequence: Int64
    let risk: PetRisk
    let evidence: [PetEvidence]
    let checkpoint: PetCheckpoint
    let choices: [PetChoice]
    let foreground: Bool
    let reminderDue: Bool
    let millisecondsUntilExpiry: Int64

    var id: PetInteractionIdentity { identity }
    var isExpired: Bool { millisecondsUntilExpiry == 0 }
    var isSelectionReady: Bool { state == .waiting && !isExpired }

    func choice(slot: Int) -> PetChoice? {
        choices.first(where: { $0.slot == slot })
    }

    var actionChoices: [PetChoice] {
        choices.filter(\.isAction)
    }

    var usesRankedNextActions: Bool {
        choices.count >= 2 && choices.allSatisfy { $0.enabled && $0.isAction }
    }

    var legacyPauseChoice: PetChoice? {
        choices.first(where: \.isPause)
    }

    var legacyRollbackChoice: PetChoice? {
        choices.first(where: \.isRollback)
    }

    init(jsonObject: [String: Any], fallbackCWD: String?) throws {
        let interactionKeys = petIdentityKeys.union([
            "state", "cwd", "summary", "sealed_at", "expires_at",
            "valid_after_event_sequence", "risk", "evidence", "checkpoint", "choices",
            "foreground", "reminder_due", "milliseconds_until_expiry",
        ])
        let fallbackKeys = interactionKeys.subtracting(["cwd"])
        let detailedKeys = interactionKeys.union(["outcome", "reported_side_effects"])
        let detailedFallbackKeys = detailedKeys.subtracting(["cwd"])
        try petRequire(
            Set(jsonObject.keys) == interactionKeys
                || Set(jsonObject.keys) == fallbackKeys
                || Set(jsonObject.keys) == detailedKeys
                || Set(jsonObject.keys) == detailedFallbackKeys,
            "interaction"
        )
        identity = try PetInteractionIdentity(jsonObject: jsonObject)
        guard let parsedState = State(rawValue: try petString(jsonObject, "state", maximum: 32)) else {
            throw PetModelError.invalid("interaction.state")
        }
        state = parsedState
        let rawCWD: String
        if jsonObject["cwd"] == nil {
            guard let fallbackCWD else { throw PetModelError.invalid("interaction.cwd") }
            rawCWD = fallbackCWD
        } else {
            rawCWD = try petString(jsonObject, "cwd", maximum: 4_096)
        }
        try petRequire(rawCWD.hasPrefix("/"), "interaction.cwd")
        cwd = URL(fileURLWithPath: rawCWD, isDirectory: true).standardizedFileURL.path
        summary = try petString(jsonObject, "summary")
        if let rawOutcome = jsonObject["outcome"] as? [String: Any],
           let rawSideEffects = jsonObject["reported_side_effects"] as? [[String: Any]],
           rawSideEffects.count <= 128
        {
            outcome = try PetOutcome(jsonObject: rawOutcome)
            reportedSideEffects = try rawSideEffects.map(PetReportedSideEffect.init(jsonObject:))
        } else if jsonObject["outcome"] == nil && jsonObject["reported_side_effects"] == nil {
            outcome = nil
            reportedSideEffects = []
        } else {
            throw PetModelError.invalid("interaction.outcome_detail")
        }
        sealedAt = try petString(jsonObject, "sealed_at", maximum: 64)
        expiresAt = try petString(jsonObject, "expires_at", maximum: 64)
        _ = try RFC3339Instant(sealedAt)
        _ = try RFC3339Instant(expiresAt)
        validAfterEventSequence = try petInteger(
            jsonObject,
            "valid_after_event_sequence",
            minimum: 1
        )
        guard let rawRisk = jsonObject["risk"] as? [String: Any],
              let rawEvidence = jsonObject["evidence"] as? [[String: Any]],
              rawEvidence.count <= 256,
              let rawCheckpoint = jsonObject["checkpoint"] as? [String: Any],
              let rawChoices = jsonObject["choices"] as? [[String: Any]],
              (2...4).contains(rawChoices.count)
        else { throw PetModelError.invalid("interaction.packet_detail") }
        risk = try PetRisk(jsonObject: rawRisk)
        evidence = try rawEvidence.map(PetEvidence.init(jsonObject:))
        let rawKinds = rawChoices.compactMap { $0["kind"] as? String }
        let isLegacyChoiceSet = rawKinds == [
            "recommended_action", "alternative_action", "pause", "rollback",
        ]
        if !isLegacyChoiceSet {
            try petRequire(
                rawKinds.count == rawChoices.count
                    && rawKinds.first == "recommended_action"
                    && rawKinds.dropFirst().allSatisfy { $0 == "alternative_action" },
                "choices.kind"
            )
        }
        checkpoint = try PetCheckpoint(jsonObject: rawCheckpoint)
        choices = try rawChoices.enumerated().map { index, object in
            try PetChoice(jsonObject: object, expectedSlot: index + 1)
        }
        if !isLegacyChoiceSet {
            try petRequire(
                choices.allSatisfy { $0.enabled && $0.isAction },
                "choices.ranked_action"
            )
        }
        try petRequire(Set(choices.map(\.optionID)).count == choices.count, "choices.option_id")
        let actionIDs = choices.compactMap(\.actionID)
        try petRequire(Set(actionIDs).count == actionIDs.count, "choices.action_id")
        if let rollback = choices.first(where: \.isRollback), rollback.enabled {
            try petRequire(checkpoint.isRecoveryCapable, "choices[3].checkpoint")
            try petRequire(
                rollback.targetCheckpointID == checkpoint.id,
                "choices[3].target_checkpoint_id"
            )
        }
        foreground = try petBoolean(jsonObject, "foreground")
        reminderDue = try petBoolean(jsonObject, "reminder_due")
        millisecondsUntilExpiry = try petInteger(
            jsonObject,
            "milliseconds_until_expiry",
            minimum: 0
        )
    }
}

struct PetSnapshot: Sendable, Equatable {
    let projects: [PetProject]
    let sessions: [PetSession]
    let routing: PetRoutingSnapshot
    let interactions: [PetInteraction]
    let permissionRequests: [PetPermissionRequest]
    let permissionNoticeCount: Int64
    let managedCommandApprovals: [PetManagedCommandApproval]
    let managedCommandApprovalNoticeCount: Int64

    static func parse(_ data: Data) throws -> PetSnapshot {
        let object = try StrictJSONTransport.object(
            from: data,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        try petExactKeys(
            object,
            [
                "schema_version", "kind", "routing", "projects", "sessions", "interactions",
                "permission_requests", "permission_notice_count",
                "managed_command_approvals", "managed_command_approval_notice_count",
            ],
            "snapshot"
        )
        let schemaVersion = try petString(object, "schema_version", maximum: 16)
        let kind = try petString(object, "kind", maximum: 64)
        try petRequire(schemaVersion == "1.0", "snapshot.schema_version")
        try petRequire(kind == "blabee_operational_snapshot", "snapshot.kind")
        guard let rawProjects = object["projects"] as? [[String: Any]],
              let rawSessions = object["sessions"] as? [[String: Any]],
              let rawRouting = object["routing"] as? [String: Any],
              let rawInteractions = object["interactions"] as? [[String: Any]],
              let rawPermissionRequests = object["permission_requests"] as? [[String: Any]],
              let rawManagedCommandApprovals = object["managed_command_approvals"]
                as? [[String: Any]]
        else { throw PetModelError.invalid("snapshot") }

        let projects = try rawProjects.map(PetProject.init(jsonObject:))
        try petRequire(Set(projects.map(\.projectID)).count == projects.count, "projects")
        let projectByID = Dictionary(uniqueKeysWithValues: projects.map { ($0.projectID, $0) })
        let sessions = try rawSessions.map(PetSession.init(jsonObject:))
        let sessionKeys = sessions.map { $0.projectID + "\u{0}" + $0.sessionID }
        try petRequire(Set(sessionKeys).count == sessions.count, "sessions")
        for session in sessions {
            try petRequire(projectByID[session.projectID] != nil, "sessions.project_id")
        }

        let routing = try PetRoutingSnapshot(jsonObject: rawRouting)
        let routeByIdentity = Dictionary(uniqueKeysWithValues: routing.pending.map {
            ($0.identity, $0)
        })
        let parsedInteractions = try rawInteractions.map { raw -> PetInteraction in
            let identity = try PetInteractionIdentity(jsonObject: raw)
            guard let project = projectByID[identity.binding.projectID] else {
                throw PetModelError.invalid("interactions.project_id")
            }
            let interaction = try PetInteraction(jsonObject: raw, fallbackCWD: project.cwd)
            try petRequire(interaction.cwd == project.cwd, "interactions.cwd")
            guard let route = routeByIdentity[interaction.identity] else {
                throw PetModelError.invalid("interactions.routing_join")
            }
            try petRequire(route.foreground == interaction.foreground, "interactions.foreground")
            try petRequire(route.reminderDue == interaction.reminderDue, "interactions.reminder_due")
            try petRequire(
                route.millisecondsUntilExpiry == interaction.millisecondsUntilExpiry,
                "interactions.milliseconds_until_expiry"
            )
            guard let session = sessions.first(where: {
                $0.projectID == interaction.identity.binding.projectID
                    && $0.sessionID == interaction.identity.binding.sessionID
            }) else { throw PetModelError.invalid("interactions.session_id") }
            try petRequire(
                session.sourceTurnID == interaction.identity.binding.sourceTurnID
                    && session.sourcePromptID == interaction.identity.binding.sourcePromptID
                    && session.episodeID == interaction.identity.binding.episodeID,
                "interactions.session_join"
            )
            return interaction
        }
        try petRequire(
            Set(parsedInteractions.map(\.identity)).count == parsedInteractions.count,
            "interactions"
        )
        let interactionByIdentity = Dictionary(uniqueKeysWithValues: parsedInteractions.map {
            ($0.identity, $0)
        })
        try petRequire(
            Set(interactionByIdentity.keys) == Set(routeByIdentity.keys),
            "interactions.routing_join"
        )
        let interactions = try routing.pending.map { route -> PetInteraction in
            guard let interaction = interactionByIdentity[route.identity] else {
                throw PetModelError.invalid("interactions.routing_join")
            }
            return interaction
        }
        if let foreground = routing.foreground {
            try petRequire(
                interactions.contains(where: { $0.identity == foreground && $0.foreground }),
                "routing.foreground"
            )
        }

        let permissionRequests = try rawPermissionRequests.map(
            PetPermissionRequest.init(jsonObject:)
        )
        try petRequire(
            Set(permissionRequests.map(\.requestID)).count == permissionRequests.count,
            "permission_requests.request_id"
        )
        try petStrictlyIncreasing(
            permissionRequests.map(\.arrivalSequence),
            field: "permission_requests.arrival_sequence"
        )
        for request in permissionRequests {
            guard let project = projectByID[request.projectID],
                  project.cwd == request.cwd,
                  let session = sessions.first(where: {
                      $0.projectID == request.projectID
                          && $0.sessionID == request.sessionID
                  }),
                  session.sourceTurnID == request.turnID
            else { throw PetModelError.invalid("permission_requests.binding") }
        }
        let managedCommandApprovals = try rawManagedCommandApprovals.map(
            PetManagedCommandApproval.init(jsonObject:)
        )
        try petRequire(
            Set(managedCommandApprovals.map(\.managedRequestID)).count
                == managedCommandApprovals.count,
            "managed_command_approvals.managed_request_id"
        )
        try petStrictlyIncreasing(
            managedCommandApprovals.map(\.arrivalSequence),
            field: "managed_command_approvals.arrival_sequence"
        )
        let approvalArrivalSequences = permissionRequests.map(\.arrivalSequence)
            + managedCommandApprovals.map(\.arrivalSequence)
        try petRequire(
            Set(approvalArrivalSequences).count == approvalArrivalSequences.count,
            "approval_requests.arrival_sequence"
        )
        let managedTransportKeys = managedCommandApprovals.map { request in
            request.brokerEpoch + "\u{0}" + request.connectionID + "\u{0}"
                + String(describing: request.jsonRPCRequestID)
        }
        try petRequire(
            Set(managedTransportKeys).count == managedTransportKeys.count,
            "managed_command_approvals.transport_binding"
        )

        return PetSnapshot(
            projects: projects,
            sessions: sessions,
            routing: routing,
            interactions: interactions,
            permissionRequests: permissionRequests,
            permissionNoticeCount: try petInteger(
                object,
                "permission_notice_count",
                minimum: 0
            ),
            managedCommandApprovals: managedCommandApprovals,
            managedCommandApprovalNoticeCount: try petInteger(
                object,
                "managed_command_approval_notice_count",
                minimum: 0
            )
        )
    }

    func interaction(identity: PetInteractionIdentity) -> PetInteraction? {
        interactions.first(where: { $0.identity == identity })
    }
}

struct PetManagedCommandApprovalResolutionRequest: Sendable, Equatable {
    let request: PetManagedCommandApproval
    let responseID: String
    let decision: PetManagedCommandApprovalDecision

    init(
        request: PetManagedCommandApproval,
        responseID: String,
        decision: PetManagedCommandApprovalDecision
    ) throws {
        try petRequire(!responseID.isEmpty && responseID.count <= 512, "response_id")
        self.request = request
        self.responseID = responseID
        self.decision = decision
    }

    var jsonObject: [String: Any] {
        var result = request.bindingObject
        result["schema_version"] = "1.0"
        result["kind"] = "blabee_managed_command_approval_resolution_request"
        result["managed_request_id"] = request.managedRequestID
        result["response_id"] = responseID
        result["decision"] = decision.rawValue
        return result
    }

    func data() throws -> Data {
        try StrictJSONTransport.data(forJSONObject: jsonObject)
    }
}

struct PetPermissionResolutionRequest: Sendable, Equatable {
    let request: PetPermissionRequest
    let responseID: String
    let decision: PetPermissionDecision

    init(
        request: PetPermissionRequest,
        responseID: String,
        decision: PetPermissionDecision
    ) throws {
        try petRequire(!responseID.isEmpty && responseID.count <= 512, "response_id")
        self.request = request
        self.responseID = responseID
        self.decision = decision
    }

    var jsonObject: [String: Any] {
        [
            "schema_version": "1.0",
            "kind": "blabee_permission_resolution_request",
            "request_id": request.requestID,
            "response_id": responseID,
            "project_id": request.projectID,
            "session_id": request.sessionID,
            "turn_id": request.turnID,
            "decision": decision.rawValue,
        ]
    }

    func data() throws -> Data {
        try StrictJSONTransport.data(forJSONObject: jsonObject)
    }
}

struct PetFocusRequest: Sendable, Equatable {
    let identity: PetInteractionIdentity

    var jsonObject: [String: Any] {
        var result = identity.jsonObject
        result["schema_version"] = "1.0"
        result["kind"] = "blabee_pet_focus_request"
        return result
    }

    func data() throws -> Data { try StrictJSONTransport.data(forJSONObject: jsonObject) }
}

struct PetSelectionRequest: Sendable, Equatable {
    let identity: PetInteractionIdentity
    let selectionID: String
    let optionID: String

    init(identity: PetInteractionIdentity, selectionID: String, optionID: String) throws {
        try petRequire(!selectionID.isEmpty && selectionID.count <= 512, "selection_id")
        try petRequire(!optionID.isEmpty && optionID.count <= 512, "option_id")
        self.identity = identity
        self.selectionID = selectionID
        self.optionID = optionID
    }

    var jsonObject: [String: Any] {
        var result = identity.jsonObject
        result["schema_version"] = "1.0"
        result["kind"] = "blabee_selection_request"
        result["selection_id"] = selectionID
        result["option_id"] = optionID
        return result
    }

    func data() throws -> Data { try StrictJSONTransport.data(forJSONObject: jsonObject) }
}
