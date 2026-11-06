import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation

/// Shared validation and presentation only. Product transport authenticates and
/// correlates its own envelope before handing this projector an inner DTO.
struct ClaudePetSnapshotProjector {
    let scopeID: String
    let projectID: String
    let sessionID: String
    let cwd: String
    let product: Bool

    func project(_ value: [String: Any]) throws -> PetSnapshot {
        try Self.keys(value, Set(["schema_version", "cards", "outcomes", "history", "routing", "boundary_id", "ready", "bridge_connected", "selection_enabled", "pending_report_count"]).union(product ? ["native_observation", "readiness_status"] : []))
        if product { try validateProductObservation(value) }
        guard value["schema_version"] as? String == "blabee.claude-pet.v1",
              let rawCards = value["cards"] as? [[String: Any]], rawCards.count <= 1,
              let rawRouting = value["routing"] as? [String: Any],
              let ready = petStrictBooleanValue(value["ready"]),
              let connected = petStrictBooleanValue(value["bridge_connected"]),
              let enabled = petStrictBooleanValue(value["selection_enabled"]),
              let pendingReports = ExactJSONInteger.int64(value["pending_report_count"], minimum: 0), pendingReports <= 32,
              !ready || connected else { throw PetModelError.invalid("claude_snapshot") }
        let boundaryID: String?
        if value["boundary_id"] is NSNull { boundaryID = nil }
        else {
            boundaryID = try Self.text(value, "boundary_id", maximum: 36)
            guard Self.isUUID(boundaryID!) else { throw PetModelError.invalid("claude_boundary") }
        }
        let nativeRouting = try PetRoutingSnapshot(jsonObject: rawRouting)
        guard nativeRouting.pending.count == rawCards.count,
              !enabled || (ready && nativeRouting.selectionEnabled && boundaryID != nil) else {
            throw PetModelError.invalid("claude_routing")
        }
        for route in nativeRouting.pending { try validateScope(route.identity.binding) }
        if let foreground = nativeRouting.foreground { try validateScope(foreground.binding) }

        // Existing Pet routing requires disabled selection to have no marked
        // foreground. Apply the native readiness/Stop gate only after checking
        // the authoritative routing/card joins below.
        var displayedRouting = rawRouting
        if !enabled {
            displayedRouting["selection_enabled"] = false
            displayedRouting["foreground"] = NSNull()
            displayedRouting["pending"] = (rawRouting["pending"] as! [[String: Any]]).map { item in
                var value = item
                value["foreground"] = false
                return value
            }
        }
        let routing = try PetRoutingSnapshot(jsonObject: displayedRouting)
        let interactions = try rawCards.map { card -> PetInteraction in
            try Self.keys(card, ["binding", "packet", "claude_proposal", "option_bindings"])
            guard let rawBinding = card["binding"] as? [String: Any], let packet = card["packet"] as? [String: Any],
                  let proposal = card["claude_proposal"] as? [String: Any],
                  let optionBindings = card["option_bindings"] as? [[String: Any]] else { throw PetModelError.invalid("claude_card") }
            try Self.keys(rawBinding, Self.bindingKeys)
            let binding = try CoordinatorBinding(jsonObject: rawBinding)
            try validateScope(binding)
            try Self.keys(packet, Self.identityKeys.union(["schema_version", "kind", "valid_after_event_sequence", "sealed_at", "expires_at", "summary", "evidence", "risk", "checkpoint", "decision_layout", "choices"]))
            let identity = try PetInteractionIdentity(jsonObject: packet)
            guard identity.binding == binding, boundaryID == binding.decisionBoundaryID,
                  packet["schema_version"] as? String == "1.0", packet["kind"] as? String == "blabee_decision_packet",
                  packet["decision_layout"] as? String == "ranked_next_actions",
                  let route = nativeRouting.pending.first(where: { $0.identity == identity }),
                  let displayedRoute = routing.pending.first(where: { $0.identity == identity }),
                  route.foreground == (nativeRouting.foreground == identity),
                  let evidence = packet["evidence"] as? [Any], evidence.isEmpty else { throw PetModelError.invalid("claude_card_join") }
            try validateOptions(packet: packet, proposal: proposal, bindings: optionBindings)
            var interaction = packet.filter { !["schema_version", "kind", "decision_layout"].contains($0.key) }
            interaction["cwd"] = cwd
            interaction["state"] = enabled ? "waiting" : "sealed"
            interaction["outcome"] = proposal["outcome"]
            interaction["reported_side_effects"] = proposal["reported_side_effects"]
            interaction["foreground"] = displayedRoute.foreground
            interaction["reminder_due"] = displayedRoute.reminderDue
            interaction["milliseconds_until_expiry"] = displayedRoute.millisecondsUntilExpiry
            let result = try PetInteraction(jsonObject: interaction, fallbackCWD: nil)
            guard result.checkpoint.id == binding.episodeBaselineCheckpointID, result.checkpoint.coverage == "unavailable" else {
                throw PetModelError.invalid("claude_checkpoint")
            }
            return result
        }
        guard Set(interactions.map(\.identity)) == Set(nativeRouting.pending.map(\.identity)) else {
            throw PetModelError.invalid("claude_card_join")
        }
        let binding = interactions.first?.identity.binding
        let project = try PetProject(jsonObject: ["project_id": projectID, "cwd": cwd, "enabled": true])
        let session = try PetSession(jsonObject: ["project_id": projectID, "session_id": sessionID,
            "source_turn_id": binding?.sourceTurnID as Any? ?? NSNull(),
            "source_prompt_id": binding?.sourcePromptID as Any? ?? NSNull(), "episode_id": binding?.episodeID as Any? ?? NSNull()])
        var snapshot = PetSnapshot(projects: [project], sessions: [session], routing: routing, interactions: interactions,
            permissionRequests: [], permissionNoticeCount: 0, managedCommandApprovals: [], managedCommandApprovalNoticeCount: 0)
        snapshot.providerStatus = PetProviderStatus(provider: .claude, scopeID: scopeID, sessionID: sessionID, cwd: cwd,
            bridgeConnected: connected, ready: ready, selectionEnabled: enabled, latestOutcome: try latestOutcome(value),
            pendingReportCount: pendingReports)
        return snapshot
    }

    private func validateOptions(packet: [String: Any], proposal: [String: Any], bindings: [[String: Any]]) throws {
        try Self.keys(proposal, ["proposal_id", "task_goal", "outcome", "reported_side_effects", "options"])
        _ = try Self.text(proposal, "proposal_id", maximum: 256)
        _ = try Self.text(proposal, "task_goal", maximum: 2048)
        guard let options = proposal["options"] as? [[String: Any]], (2...4).contains(options.count),
              let choices = packet["choices"] as? [[String: Any]], choices.count == options.count,
              bindings.count == options.count, let outcome = proposal["outcome"] as? [String: Any],
              let effects = proposal["reported_side_effects"] as? [[String: Any]], effects.count <= 32,
              packet["summary"] as? String == outcome["summary"] as? String else {
            throw PetModelError.invalid("claude_options")
        }
        _ = try PetOutcome(jsonObject: outcome)
        _ = try effects.map(PetReportedSideEffect.init(jsonObject:))
        var claudeIDs = Set<String>(), coreIDs = Set<String>(), actionIDs = Set<String>()
        for (index, option) in options.enumerated() {
            try Self.keys(option, ["id", "title", "description", "task", "done_when", "constraints"])
            let claudeID = try Self.text(option, "id", maximum: 64)
            _ = try Self.text(option, "description", maximum: 256)
            let title = try Self.text(option, "title", maximum: 128)
            let task = try Self.text(option, "task", maximum: 2048)
            let done = try Self.text(option, "done_when", maximum: 512)
            guard let constraints = option["constraints"] as? [String], constraints.count <= 32,
                  constraints.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1024 }) else { throw PetModelError.invalid("claude_constraints") }
            let mapping = bindings[index]
            try Self.keys(mapping, ["claude_option_id", "option_id", "action_id"])
            let coreID = try Self.text(mapping, "option_id", maximum: 512)
            let actionID = try Self.text(mapping, "action_id", maximum: 512)
            let choice = try PetChoice(jsonObject: choices[index], expectedSlot: index + 1)
            guard mapping["claude_option_id"] as? String == claudeID,
                  claudeIDs.insert(claudeID).inserted, coreIDs.insert(coreID).inserted, actionIDs.insert(actionID).inserted,
                  choice.enabled, choice.optionID == coreID, choice.actionID == actionID,
                  choice.kind == (index == 0 ? "recommended_action" : "alternative_action"),
                  choice.action?.title == title, choice.action?.objective == task,
                  choice.action?.constraints == constraints, choice.action?.doneWhen == [done] else {
                throw PetModelError.invalid("claude_option_join")
            }
        }
    }

    private func latestOutcome(_ value: [String: Any]) throws -> PetProviderOutcome? {
        guard let outcomes = value["outcomes"] as? [[String: Any]], outcomes.count <= 32,
              try StrictJSONTransport.data(forJSONObject: outcomes).count <= ClaudeCoreAdapter.maximumOutcomeProjectionBytes,
              let history = value["history"] as? [String: Any] else { throw PetModelError.invalid("claude_history") }
        try Self.keys(history, ["total_outcomes", "omitted_outcomes"])
        guard let total = ExactJSONInteger.int64(history["total_outcomes"], minimum: 0),
              let omitted = ExactJSONInteger.int64(history["omitted_outcomes"], minimum: 0),
              total >= outcomes.count, omitted == total - Int64(outcomes.count) else { throw PetModelError.invalid("claude_history") }
        var selectionIDs = Set<String>(), continuationIDs = Set<String>()
        var latest: PetProviderOutcome?
        for outcome in outcomes {
            try Self.keys(outcome, ["selection_id", "binding", "continuation_id", "status", "summary", "reported_by"])
            guard let rawBinding = outcome["binding"] as? [String: Any], outcome["reported_by"] as? String == "model" else {
                throw PetModelError.invalid("claude_outcome")
            }
            try Self.keys(rawBinding, Self.bindingKeys)
            let binding = try CoordinatorBinding(jsonObject: rawBinding)
            try validateScope(binding)
            let selectionID = try Self.text(outcome, "selection_id", maximum: 36)
            let continuationID = try Self.text(outcome, "continuation_id", maximum: 512)
            let status = try Self.text(outcome, "status", maximum: 32)
            guard Self.isUUID(selectionID), selectionIDs.insert(selectionID).inserted,
                  continuationIDs.insert(continuationID).inserted, ["succeeded", "failed"].contains(status) else {
                throw PetModelError.invalid("claude_outcome")
            }
            latest = PetProviderOutcome(selectionID: selectionID, sourcePromptID: binding.sourcePromptID,
                status: status, summary: try Self.text(outcome, "summary", maximum: 4096))
        }
        return latest
    }

    private func validateProductObservation(_ value: [String: Any]) throws {
        guard let status = value["readiness_status"] as? String,
              ["starting", "pending", "ready", "required", "disconnected"].contains(status),
              let observation = value["native_observation"] as? [String: Any],
              Set(observation.keys) == ["status", "background_state", "background_task_count", "failure_code"],
              let native = observation["status"] as? String,
              ["starting", "started", "running", "stopped", "failed", "compacted", "new_prompt_required"].contains(native),
              let background = observation["background_state"] as? String,
              ["unknown", "idle", "active"].contains(background) else {
            throw PetModelError.invalid("claude_observation")
        }
        guard observation["background_task_count"] is NSNull || ExactJSONInteger.int64(observation["background_task_count"], minimum: 0) != nil,
              observation["failure_code"] is NSNull || (observation["failure_code"] as? String).map({ !$0.isEmpty && $0.count <= 96 }) == true else {
            throw PetModelError.invalid("claude_observation")
        }
    }

    private func validateScope(_ binding: CoordinatorBinding) throws {
        guard binding.projectID.utf8.elementsEqual(projectID.utf8), binding.sessionID.utf8.elementsEqual(sessionID.utf8),
              Self.isUUID(binding.sourcePromptID), Self.isUUID(binding.episodeRootPromptID),
              Self.isUUID(binding.decisionBoundaryID) else { throw PetModelError.invalid("claude_binding") }
    }

    private static let bindingKeys: Set<String> = ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id", "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence"]
    private static let identityKeys = bindingKeys.union(["interaction_id", "packet_id", "revision"])
    private static func isUUID(_ value: String) -> Bool { value.utf8.count == 36 && UUID(uuidString: value) != nil }
    private static func keys(_ object: [String: Any], _ expected: Set<String>) throws {
        guard Set(object.keys) == expected else { throw PetModelError.invalid("claude_fields") }
    }
    private static func text(_ object: [String: Any], _ key: String, maximum: Int) throws -> String {
        guard let value = object[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.utf8.count <= maximum, !value.contains("\0") else { throw PetModelError.invalid("claude_" + key) }
        return value
    }
}
