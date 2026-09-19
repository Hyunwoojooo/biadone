import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Dispatch
import Foundation

/// An in-process Pet capability. Only the native selector role is available;
/// model delivery, Hook observations and session control remain with the host.
actor ClaudePetTransport: PetCoordinatorTransport {
    private let scopeID: String
    private let projectID: String
    private let sessionID: String
    private let cwd: String
    private let selectionToken: String
    private let handle: @Sendable (Data) throws -> Data
    private var snapshotReceipts: [(id: String, digest: Data)] = []
    private var selectionInFlight = false
    private var attemptedIdentity: PetInteractionIdentity?
    private var selectionReceipt: SelectionReceipt?

    private struct SelectionReceipt {
        let request: PetSelectionRequest
        let requestID: String
        let digest: Data
    }

    // Fixed-size client state, not historical replay authority. The service's
    // scoped consumed state/tombstones remain responsible for old selection IDs.
    var retainedSelectionStateCounts: (attempts: Int, receipts: Int, inFlight: Int) {
        (attemptedIdentity == nil ? 0 : 1, selectionReceipt == nil ? 0 : 1, selectionInFlight ? 1 : 0)
    }

    init(scopeID: String, projectID: String, sessionID: String, cwd: String,
         selectionToken: String, handle: @escaping @Sendable (Data) throws -> Data) throws {
        guard UUID(uuidString: scopeID)?.uuidString.lowercased() == scopeID,
              Self.isUUID(sessionID), !projectID.isEmpty, projectID.utf8.count <= 256,
              !projectID.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }),
              cwd.hasPrefix("/"), cwd.utf8.count <= 4096,
              URL(fileURLWithPath: cwd).standardizedFileURL.path.utf8.elementsEqual(cwd.utf8),
              !cwd.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              selectionToken.utf8.count == 64,
              selectionToken.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              ![scopeID, projectID, sessionID, cwd].contains(where: { $0.contains(selectionToken) }) else {
            throw PetModelError.invalid("claude_configuration")
        }
        self.scopeID = scopeID
        self.projectID = projectID
        self.sessionID = sessionID
        self.cwd = cwd
        self.selectionToken = selectionToken
        self.handle = handle
    }

    func request(type: String, payload: Data) async throws -> Data {
        let object = try Self.object(payload)
        switch type {
        case "get_state":
            try Self.keys(object, ["schema_version", "kind", "consumer_heartbeat"])
            guard object["schema_version"] as? String == "1.0",
                  object["kind"] as? String == "blabee_pet_snapshot_request",
                  petStrictBooleanValue(object["consumer_heartbeat"]) == true else {
                throw PetModelError.invalid("claude_snapshot_request")
            }
            let response = try await nativeRequest("pet.snapshot")
            let requestID = try Self.text(Self.object(response), "request_id", maximum: 36)
            snapshotReceipts.append((requestID, Self.digest(response)))
            if snapshotReceipts.count > 8 { snapshotReceipts.removeFirst(snapshotReceipts.count - 8) }
            return response
        case "focus_interaction":
            let identity = try requestIdentity(object, kind: "blabee_pet_focus_request", extraKeys: [])
            let snapshot = try await freshSnapshot()
            _ = try requireCurrent(identity, in: snapshot)
            // The native session has one authoritative foreground card. Focus
            // is a fresh read-only confirmation, never a synthetic core write.
            return try StrictJSONTransport.data(forJSONObject: ["focused": true])
        case "select":
            let identity = try requestIdentity(object, kind: "blabee_selection_request", extraKeys: ["selection_id", "option_id"])
            let selectionID = try Self.text(object, "selection_id", maximum: 36)
            guard Self.isUUID(selectionID), attemptedIdentity != identity else {
                throw PetModelError.invalid("claude_selection_id")
            }
            let request = try PetSelectionRequest(identity: identity, selectionID: selectionID,
                optionID: Self.text(object, "option_id", maximum: 512))
            // Actor methods can reenter while the fresh read is suspended.
            // Reserve the only mutation slot before the first await.
            guard !selectionInFlight else { throw PetModelError.invalid("claude_selection_in_flight") }
            selectionInFlight = true
            defer { selectionInFlight = false }
            let snapshot = try await freshSnapshot()
            let interaction = try requireCurrent(identity, in: snapshot)
            guard interaction.choices.contains(where: { $0.optionID == request.optionID && $0.enabled && $0.isAction }) else {
                throw PetModelError.invalid("claude_selection_option")
            }
            // Mark the full current card before the only mutation. A rejected
            // call or lost response cannot retry even with a new selection ID.
            // Only a newly verified current card replaces the previous attempt
            // and its unconsumed receipt; late receipt use then fails explicitly.
            attemptedIdentity = identity
            selectionReceipt = nil
            let response = try await nativeRequest("select", fields: [
                "boundary_id": identity.binding.decisionBoundaryID, "packet_id": identity.packetID,
                "revision": identity.revision, "option_id": request.optionID, "selection_id": selectionID,
            ])
            let requestID = try Self.text(Self.object(response), "request_id", maximum: 36)
            try requireSelectionResult(result(response, requestID: requestID), request: request)
            selectionReceipt = SelectionReceipt(request: request, requestID: requestID, digest: Self.digest(response))
            return response
        default:
            throw PetModelError.invalid("claude_request_type")
        }
    }

    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        let digest = Self.digest(data)
        guard let index = snapshotReceipts.firstIndex(where: { $0.digest == digest }) else {
            throw PetModelError.invalid("claude_snapshot_receipt")
        }
        let receipt = snapshotReceipts.remove(at: index)
        return try project(result(data, requestID: receipt.id))
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest) async throws -> PetSelectionOutcome {
        guard let receipt = selectionReceipt, receipt.request == request,
              receipt.digest == Self.digest(data) else { throw PetModelError.invalid("claude_selection_receipt") }
        try requireSelectionResult(result(data, requestID: receipt.requestID), request: request)
        selectionReceipt = nil
        return .channelPending
    }

    private func freshSnapshot() async throws -> PetSnapshot {
        let response = try await nativeRequest("pet.snapshot")
        return try project(result(response, requestID: Self.text(Self.object(response), "request_id", maximum: 36)))
    }

    private func nativeRequest(_ operation: String, fields: [String: Any] = [:]) async throws -> Data {
        let requestID = UUID().uuidString.lowercased()
        var request = fields
        request["schema_version"] = "1.0"
        request["request_id"] = requestID
        request["operation"] = operation
        let payload = try StrictJSONTransport.data(forJSONObject: [
            "schema_version": ClaudeNativeSession.schemaVersion, "provider": "claude", "scope_id": scopeID,
            "session_id": sessionID, "role": "selector", "auth_token": selectionToken, "request": request,
        ])
        let handle = handle
        // SQLite work and native locks must not block the main actor or a
        // cooperative executor worker used by Pet polling.
        let response: Data = try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(with: Result { try handle(payload) })
            }
        }
        _ = try result(response, requestID: requestID)
        return response
    }

    private func result(_ data: Data, requestID: String) throws -> [String: Any] {
        let envelope = try Self.object(data)
        guard let ok = petStrictBooleanValue(envelope["ok"]) else { throw PetModelError.invalid("claude_response") }
        try Self.keys(envelope, ["schema_version", "provider", "scope_id", "session_id", "role", "request_id", "ok", ok ? "result" : "error"])
        guard envelope["schema_version"] as? String == ClaudeNativeSession.schemaVersion,
              envelope["provider"] as? String == "claude", envelope["scope_id"] as? String == scopeID,
              envelope["session_id"] as? String == sessionID, envelope["role"] as? String == "selector",
              Self.isUUID(requestID), envelope["request_id"] as? String == requestID else {
            throw PetModelError.invalid("claude_response_identity")
        }
        guard ok else {
            guard let error = envelope["error"] as? [String: Any], Set(error.keys) == ["code"],
                  let code = error["code"] as? String, code.range(of: "^[a-z0-9_]{1,96}$", options: .regularExpression) != nil else {
                throw PetModelError.invalid("claude_response_error")
            }
            throw CoordinatorError(code)
        }
        guard let result = envelope["result"] as? [String: Any] else { throw PetModelError.invalid("claude_response_result") }
        return result
    }

    private func requestIdentity(_ object: [String: Any], kind: String, extraKeys: Set<String>) throws -> PetInteractionIdentity {
        try Self.keys(object, Self.identityKeys.union(["schema_version", "kind"]).union(extraKeys))
        guard object["schema_version"] as? String == "1.0", object["kind"] as? String == kind else {
            throw PetModelError.invalid("claude_pet_request")
        }
        let identity = try PetInteractionIdentity(jsonObject: object)
        try validateScope(identity.binding)
        return identity
    }

    private func requireCurrent(_ identity: PetInteractionIdentity, in snapshot: PetSnapshot) throws -> PetInteraction {
        guard snapshot.providerStatus?.selectionEnabled == true, snapshot.routing.selectionEnabled,
              snapshot.routing.foreground == identity,
              let interaction = snapshot.interactions.first(where: { $0.identity == identity }),
              interaction.foreground, interaction.isSelectionReady else {
            throw PetModelError.invalid("claude_selection_not_current")
        }
        return interaction
    }

    private func requireSelectionResult(_ value: [String: Any], request: PetSelectionRequest) throws {
        try Self.keys(value, ["selection_id", "continuation_id", "packet_id", "revision", "option_id", "delivery"])
        guard value["selection_id"] as? String == request.selectionID,
              value["packet_id"] as? String == request.identity.packetID,
              ExactJSONInteger.int64(value["revision"], minimum: 1) == request.identity.revision,
              value["option_id"] as? String == request.optionID,
              value["delivery"] as? String == "awaiting_claude_claim" else {
            throw PetModelError.invalid("claude_selection_response")
        }
        _ = try Self.text(value, "continuation_id", maximum: 512)
    }

    private func project(_ value: [String: Any]) throws -> PetSnapshot {
        try Self.keys(value, ["schema_version", "cards", "outcomes", "history", "routing", "boundary_id", "ready", "bridge_connected", "selection_enabled", "pending_report_count"])
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

    private func validateScope(_ binding: CoordinatorBinding) throws {
        guard binding.projectID.utf8.elementsEqual(projectID.utf8), binding.sessionID.utf8.elementsEqual(sessionID.utf8),
              Self.isUUID(binding.sourcePromptID), Self.isUUID(binding.episodeRootPromptID),
              Self.isUUID(binding.decisionBoundaryID) else { throw PetModelError.invalid("claude_binding") }
    }

    private static let bindingKeys: Set<String> = ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id", "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence"]
    private static let identityKeys = bindingKeys.union(["interaction_id", "packet_id", "revision"])
    private static func isUUID(_ value: String) -> Bool { value.utf8.count == 36 && UUID(uuidString: value) != nil }
    private static func digest(_ data: Data) -> Data { Data(SHA256.hash(data: data)) }
    private static func keys(_ object: [String: Any], _ expected: Set<String>) throws {
        guard Set(object.keys) == expected else { throw PetModelError.invalid("claude_fields") }
    }
    private static func text(_ object: [String: Any], _ key: String, maximum: Int) throws -> String {
        guard let value = object[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.utf8.count <= maximum, !value.contains("\0") else { throw PetModelError.invalid("claude_" + key) }
        return value
    }
    private static func object(_ data: Data) throws -> [String: Any] {
        try StrictJSONTransport.object(from: data, limits: StrictJSONLimits(maximumBytes: ClaudeNativeSession.maximumPayloadBytes, maximumDepth: 24))
    }
}
