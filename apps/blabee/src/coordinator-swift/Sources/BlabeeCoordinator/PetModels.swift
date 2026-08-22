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

private func petNullableString(_ object: [String: Any], _ key: String) throws -> String? {
    if object[key] is NSNull { return nil }
    return try petString(object, key, maximum: 512)
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

private func petStableCode(_ value: String, field: String) throws -> String {
    try petRequire(value.count <= 128, field)
    try petRequire(
        value.range(of: "^[a-z][a-z0-9_]*$", options: .regularExpression) != nil,
        field
    )
    return value
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

    var displayTitle: String {
        switch slot {
        case 1:
            return action?.title ?? "권장 작업"
        case 2:
            return action?.title ?? "대안 없음"
        case 3:
            return "보류"
        case 4:
            return "롤백"
        default:
            return "사용할 수 없음"
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

        switch expectedSlot {
        case 1:
            try petExactKeys(
                jsonObject,
                ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id", "action"],
                "choices[0]"
            )
            try petRequire(kind == "recommended_action" && enabled, "choices[0]")
            try petRequire(disabledReason == nil && actionID != nil, "choices[0]")
            guard let rawAction = jsonObject["action"] as? [String: Any] else {
                throw PetModelError.invalid("choices[0].action")
            }
            action = try PetAction(jsonObject: rawAction)
            targetCheckpointID = nil
        case 2:
            try petRequire(kind == "alternative_action", "choices[1].kind")
            if enabled {
                try petExactKeys(
                    jsonObject,
                    ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id", "action"],
                    "choices[1]"
                )
                try petRequire(disabledReason == nil && actionID != nil, "choices[1]")
                guard let rawAction = jsonObject["action"] as? [String: Any] else {
                    throw PetModelError.invalid("choices[1].action")
                }
                action = try PetAction(jsonObject: rawAction)
            } else {
                try petExactKeys(
                    jsonObject,
                    ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id"],
                    "choices[1]"
                )
                try petRequire(disabledReason != nil && actionID == nil, "choices[1]")
                action = nil
            }
            targetCheckpointID = nil
        case 3:
            try petExactKeys(
                jsonObject,
                ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id"],
                "choices[2]"
            )
            try petRequire(kind == "pause" && enabled, "choices[2]")
            try petRequire(disabledReason == nil && actionID != nil, "choices[2]")
            action = nil
            targetCheckpointID = nil
        case 4:
            try petRequire(kind == "rollback", "choices[3].kind")
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
            throw PetModelError.invalid("choices.slot")
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
              rawChoices.count == 4
        else { throw PetModelError.invalid("interaction.packet_detail") }
        risk = try PetRisk(jsonObject: rawRisk)
        evidence = try rawEvidence.map(PetEvidence.init(jsonObject:))
        checkpoint = try PetCheckpoint(jsonObject: rawCheckpoint)
        choices = try rawChoices.enumerated().map { index, object in
            try PetChoice(jsonObject: object, expectedSlot: index + 1)
        }
        try petRequire(Set(choices.map(\.optionID)).count == choices.count, "choices.option_id")
        let actionIDs = choices.compactMap(\.actionID)
        try petRequire(Set(actionIDs).count == actionIDs.count, "choices.action_id")
        if let rollback = choices.first(where: { $0.slot == 4 }), rollback.enabled {
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
    let permissionNoticeCount: Int64

    static func parse(_ data: Data) throws -> PetSnapshot {
        let object = try StrictJSONTransport.object(
            from: data,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        try petExactKeys(
            object,
            [
                "schema_version", "kind", "routing", "projects", "sessions", "interactions",
                "permission_notice_count",
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
              let rawInteractions = object["interactions"] as? [[String: Any]]
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

        return PetSnapshot(
            projects: projects,
            sessions: sessions,
            routing: routing,
            interactions: interactions,
            permissionNoticeCount: try petInteger(
                object,
                "permission_notice_count",
                minimum: 0
            )
        )
    }

    func interaction(identity: PetInteractionIdentity) -> PetInteraction? {
        interactions.first(where: { $0.identity == identity })
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
