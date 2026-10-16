import CoordinatorSwift
import Foundation

/// The shared Claude integration boundary over the production Swift engine.
/// This is a trusted, in-process port, NOT an authenticated product endpoint.
/// Native session/Hook authentication and binding allocation belong to its caller.
/// Only live envelope and DTO associations are retained here; lifecycle truth is
/// exclusively the injected core journal. No execution authority is rehydrated.
public final class ClaudeCoreAdapter: @unchecked Sendable {
    public static let schemaVersion = "0.1"
    public static let maximumMessageBytes = 128 * 1024
    public static let maximumProposalBytes = 24 * 1024
    public static let maximumLiveProjectionBytes = 64 * 1024
    public static let maximumOutcomeProjectionBytes = 48 * 1024
    public static let modelReportPrefix = "[Claude model report] "

    private struct Proposal {
        let binding: CoordinatorBinding
        let object: [String: Any]
        let options: [[String: Any]]
        let optionBindings: [[String: Any]]
    }

    private struct LiveSelection {
        let binding: CoordinatorBinding
        let selectionID: String
        let continuationID: String
        let packetID: String
        let revision: Int64
        let optionID: String
        let actionID: String
        let option: [String: Any]
        let envelope: [String: Any]
    }

    private let journal: any CoordinatorSemanticJournalPort
    private let routing: CoordinatorRoutingApplication
    private let wallNow: @Sendable () -> Date
    private let lock = NSLock()
    private var proposals: [CoordinatorBindingKey: Proposal] = [:]
    private var offered: [String: LiveSelection] = [:]
    private var claimed: [String: LiveSelection] = [:]

    public init(
        journal: any CoordinatorSemanticJournalPort,
        clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
        wallNow: @escaping @Sendable () -> Date = { Date() }
    ) throws {
        self.journal = journal
        self.routing = try CoordinatorRoutingApplication(journal: journal, clock: clock)
        self.wallNow = wallNow
    }

    public convenience init(
        databaseURL: URL,
        keyURL: URL,
        freshnessStore: any FreshnessAnchorStore,
        clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
        wallNow: @escaping @Sendable () -> Date = { Date() }
    ) throws {
        let journal = try SQLiteJournal(
            databaseURL: databaseURL, keyURL: keyURL, freshnessStore: freshnessStore
        )
        try self.init(journal: journal, clock: clock, wallNow: wallNow)
    }

    /// Scheduling hint only; does not process time, read the journal or write.
    /// Product callers run due work through their existing metadata executor.
    public func millisecondsUntilNextDeadline() -> Int32? {
        lock.withLock { routing.millisecondsUntilNextDeadline() }
    }

    /// Processes one bounded versioned request. Errors expose stable codes only.
    /// Requests are serialized, so the returned claim follows durable token
    /// consumption AND transport completion. A failed or lost claim is never
    /// retried by this adapter and never returns an executable task.
    public func respond(to data: Data) -> Data {
        lock.lock()
        defer { lock.unlock() }
        var requestID: String?
        do {
            guard data.count <= Self.maximumMessageBytes else {
                throw CoordinatorError("request_too_large")
            }
            let request = try StrictJSONTransport.object(
                from: data,
                limits: StrictJSONLimits(maximumBytes: Self.maximumMessageBytes, maximumDepth: 24)
            )
            if let value = request["request_id"] as? String, UUID(uuidString: value) != nil {
                requestID = value
            }
            guard requestID != nil else { throw CoordinatorError("invalid_request_id") }
            guard request["schema_version"] as? String == Self.schemaVersion else {
                throw CoordinatorError("unsupported_schema_version")
            }
            let operation = try Self.text(request, "operation", maximum: 32)
            let result: [String: Any]
            switch operation {
            case "activate": result = try activate(request)
            case "select": result = try select(request)
            case "dismiss_interaction": result = try dismissInteraction(request)
            case "claim": result = try claim(request)
            case "complete": result = try complete(request)
            case "invalidate": result = try invalidate(request)
            case "snapshot", "pet.snapshot":
                try Self.fields(request, [])
                result = try snapshot()
            default: throw CoordinatorError("unsupported_operation")
            }
            let response = try Self.data([
                "schema_version": Self.schemaVersion,
                "request_id": requestID!, "ok": true, "result": result,
            ])
            guard response.count <= Self.maximumMessageBytes else {
                throw CoordinatorError("response_too_large")
            }
            return response
        } catch {
            let code = (error as? CoordinatorError)?.code ?? "adapter_internal_error"
            let safeCode = code.range(of: "^[a-z0-9_]{1,96}$", options: .regularExpression) != nil
                ? code : "adapter_internal_error"
            return (try? Self.data([
                "schema_version": Self.schemaVersion,
                "request_id": requestID as Any? ?? NSNull(), "ok": false,
                "error": ["code": safeCode],
            ])) ?? Data()
        }
    }

    private func activate(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["binding", "proposal"])
        let binding = try Self.binding(request)
        let proposal = try Self.validateProposal(request["proposal"])
        guard let options = proposal["options"] as? [[String: Any]],
              let outcome = proposal["outcome"] as? [String: Any] else {
            throw CoordinatorError("invalid_proposal")
        }
        let now = try instant()
        let optionBindings = options.map { option in
            ["claude_option_id": option["id"]!, "option_id": Self.id("option"),
             "action_id": Self.id("action")]
        }
        let choices = options.enumerated().map { index, option in
            [
                "slot": index + 1,
                "kind": index == 0 ? "recommended_action" : "alternative_action",
                "enabled": true, "disabled_reason": NSNull(),
                "option_id": optionBindings[index]["option_id"]!,
                "action_id": optionBindings[index]["action_id"]!,
                "action": ["title": option["title"]!, "objective": option["task"]!,
                           "constraints": option["constraints"]!, "done_when": [option["done_when"]!]],
            ] as [String: Any]
        }
        var packet: [String: Any] = [
            "schema_version": "1.0", "kind": "blabee_decision_packet",
            "interaction_id": Self.id("interaction"), "packet_id": Self.id("packet"),
            "revision": 1, "valid_after_event_sequence": 1,
            "sealed_at": now.rawValue,
            "expires_at": try now.adding(
                nanoseconds: CoordinatorRoutingApplication.expiryAfterNanoseconds
            ).rawValue,
            "summary": outcome["summary"]!, "evidence": [],
            "risk": ["level": "info", "reasons": []],
            "checkpoint": ["id": binding.episodeBaselineCheckpointID, "coverage": "unavailable"],
            "decision_layout": "ranked_next_actions", "choices": choices,
        ]
        packet.merge(binding.jsonObject) { old, _ in old }
        try admitProjection(binding: binding, proposal: proposal, packet: packet, optionBindings: optionBindings)
        let result = try routing.executeCommand(Self.data([
            "type": "activate_initial_boundary", "open_event_id": Self.id("event_open"),
            "seal_event_id": Self.id("event_seal"), "occurred_at": now.rawValue,
            "binding": binding.jsonObject, "proposal_id": proposal["proposal_id"]!,
            "packet": packet,
        ]))
        guard let effect = result.effects.first,
              let sealed = try Self.object(effect)["packet"] as? [String: Any] else {
            throw CoordinatorError("activation_effect_missing")
        }
        // The committed packet (including its exact sequence/identities) is the
        // authoritative response. Never reconstruct it from a prior snapshot.
        var target = binding.jsonObject
        target["expected_state"] = "pending"
        target["interaction_id"] = sealed["interaction_id"]
        target["packet_id"] = sealed["packet_id"]
        target["revision"] = sealed["revision"]
        _ = try routing.setForeground(Self.data(target))
        proposals[binding.fullKey] = Proposal(
            binding: binding, object: proposal, options: options, optionBindings: optionBindings
        )
        return ["packet": sealed, "claude_proposal": proposal, "option_bindings": optionBindings]
    }

    private func select(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["binding", "packet_id", "revision", "selection_id", "option_id"])
        let binding = try Self.binding(request)
        let selectionID = try Self.text(request, "selection_id", maximum: 256)
        let packetID = try Self.text(request, "packet_id", maximum: 256)
        let optionID = try Self.text(request, "option_id", maximum: 256)
        guard let revision = ExactJSONInteger.int64(request["revision"], minimum: 1),
              let proposal = proposals[binding.fullKey] else {
            throw CoordinatorError("invalid_selection")
        }
        _ = try routing.snapshot()
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        reconcileAuthority(state)
        guard let packet = state.packet(for: binding), packet.packetID == packetID,
              packet.revision == revision,
              let index = proposal.optionBindings.firstIndex(where: { $0["option_id"] as? String == optionID }),
              let actionID = proposal.optionBindings[index]["action_id"] as? String,
              !state.boundaries.values.contains(where: { $0.selection?.selectionID == selectionID }) else {
            throw CoordinatorError("invalid_selection")
        }
        guard offered.count + claimed.count < 32 else { throw CoordinatorError("live_claim_capacity") }
        let continuationID = Self.id("continuation")
        var selection = binding.jsonObject
        selection.merge([
            "schema_version": "1.0", "kind": "blabee_selection_request",
            "selection_id": selectionID, "interaction_id": packet.interactionID,
            "packet_id": packetID, "revision": revision, "option_id": optionID,
        ]) { _, new in new }
        let result = try routing.routeSelection(Self.data([
            "type": "select_option", "expected_state": "pending",
            "event_ids": ["selection_claimed": Self.id("event_select"),
                          "continuation_dispatched": Self.id("event_dispatch"),
                          "decision_boundary_closed": Self.id("event_close")],
            "occurred_at": try instant().rawValue,
            "request": selection, "continuation_id": continuationID,
        ]))
        guard let effect = result.effects.first,
              let envelope = try Self.object(effect)["envelope"] as? [String: Any] else {
            // The core deliberately suppresses a token after a lost selection
            // response. Do not regenerate/reconstruct an execution capability.
            throw CoordinatorError("selection_effect_unavailable")
        }
        let value = LiveSelection(
            binding: binding, selectionID: selectionID, continuationID: continuationID,
            packetID: packetID, revision: revision, optionID: optionID, actionID: actionID,
            option: proposal.options[index], envelope: envelope
        )
        offered[selectionID] = value
        proposals.removeValue(forKey: binding.fullKey)
        return selectionDTO(value)
    }

    private func dismissInteraction(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["binding", "interaction_id", "packet_id", "revision"])
        let binding = try Self.binding(request)
        let interactionID = try Self.text(request, "interaction_id", maximum: 256)
        let packetID = try Self.text(request, "packet_id", maximum: 256)
        guard let revision = ExactJSONInteger.int64(request["revision"], minimum: 1) else {
            throw CoordinatorError("invalid_dismissal")
        }
        var target = binding.jsonObject
        target.merge(["interaction_id": interactionID, "packet_id": packetID, "revision": revision]) { _, next in next }
        try routing.dismissInteraction(Self.data(target), closingWith: Self.data([
            "type": "close_boundary", "event_id": Self.id("event_dismiss"),
            "occurred_at": try instant().rawValue, "binding": binding.jsonObject,
            "close_reason": "user_dismissed",
        ]))
        // No selection, continuation, Channel offer or execution capability is
        // created. Durable routing validates an exact already-committed retry.
        proposals.removeValue(forKey: binding.fullKey)
        return ["dismissed": true, "interaction_id": interactionID, "packet_id": packetID, "revision": revision]
    }

    private func claim(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["binding", "selection_id"])
        let binding = try Self.binding(request)
        let selectionID = try Self.text(request, "selection_id", maximum: 256)
        guard let value = offered[selectionID], value.binding == binding else {
            throw CoordinatorError("invalid_claim")
        }
        // Consume the local offer before either persistence operation. Even a
        // crash or ambiguous write must never make an executable task retryable.
        offered.removeValue(forKey: selectionID)
        _ = try routing.routeConsumePetAction(Self.data([
            "type": "consume_pet_action", "event_id": Self.id("event_consume"),
            "occurred_at": try instant().rawValue, "envelope": value.envelope,
        ]))
        _ = try routing.executeCommand(Self.data([
            "type": "complete_transport", "event_id": Self.id("event_transport"),
            "occurred_at": try instant().rawValue, "binding": binding.jsonObject,
            "continuation_id": value.continuationID,
        ]))
        claimed[selectionID] = value
        var result = selectionDTO(value)
        result["action_id"] = value.actionID
        result["option"] = value.option
        return result
    }

    private func complete(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["binding", "selection_id", "outcome", "note"])
        let binding = try Self.binding(request)
        let selectionID = try Self.text(request, "selection_id", maximum: 256)
        let outcome = try Self.text(request, "outcome", maximum: 32)
        let note = try Self.text(request, "note", maximum: 4096)
        guard ["completed", "failed"].contains(outcome),
              let value = claimed[selectionID], value.binding == binding else {
            throw CoordinatorError("invalid_completion")
        }
        let now = try instant().rawValue
        do {
            _ = try routing.executeCommand(Self.data([
                "type": "record_work_outcome", "event_id": Self.id("event_outcome"),
                "occurred_at": now, "binding": value.binding.jsonObject,
                "continuation_id": value.continuationID,
                "status": outcome == "completed" ? "succeeded" : "failed",
                "summary": Self.modelReportPrefix + note, "evidence_ids": [],
            ]))
        } catch {
            // An append can commit before its response is lost. Only fresh,
            // exact durable evidence may release the now terminal report slot.
            // A failed read retains uncertainty; it never restores authority.
            if let state = try? CoordinatorSemanticReplay.replay(journal.load()) {
                reconcileAuthority(state)
            }
            throw error
        }
        // Reporting is single-use. If closing fails after the result commit,
        // keep that result as durable audit; a retry cannot replace it or execute.
        claimed.removeValue(forKey: selectionID)
        _ = try routing.executeCommand(Self.data([
            "type": "close_boundary", "event_id": Self.id("event_close"),
            "occurred_at": now, "binding": value.binding.jsonObject,
            "close_reason": "work_outcome_recorded",
        ]))
        return ["recorded": true, "reported_by": "model", "selection_id": selectionID]
    }

    private func invalidate(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["binding"])
        let binding = try Self.binding(request)
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        guard let boundary = state.boundary(for: binding) else {
            throw CoordinatorError("unknown_decision_boundary")
        }
        if let selection = boundary.selection {
            if claimed[selection.selectionID]?.binding == binding {
                // A new native input retires unclaimed authority; it does not
                // erase an already claimed task's independent report boundary.
                return ["status": "preserved_claimed"]
            }
            offered.removeValue(forKey: selection.selectionID)
            return ["status": "revoked_unclaimed_selection"]
        }
        guard !boundary.closed else { throw CoordinatorError("decision_boundary_already_closed") }
        _ = try routing.executeCommand(Self.data([
            "type": "close_boundary", "event_id": Self.id("event_invalidate"),
            "occurred_at": try instant().rawValue, "binding": binding.jsonObject,
            "close_reason": "claude_native_prompt_changed",
        ]))
        proposals.removeValue(forKey: binding.fullKey)
        return ["status": "closed_unclaimed"]
    }

    private func snapshot() throws -> [String: Any] {
        let routingObject = try Self.object(routing.snapshot().canonicalJSON)
        let durable = try journal.load()
        let state = try CoordinatorSemanticReplay.replay(durable)
        reconcileAuthority(state)
        var projection = try liveProjection(state: state, routingObject: routingObject)
        var resultSequence: [String: Int] = [:]
        for (index, data) in durable.events.enumerated() {
            let event = try Self.object(data)
            guard event["event_type"] as? String == "work_outcome_recorded",
                  let payload = event["payload"] as? [String: Any],
                  let continuationID = payload["continuation_id"] as? String else { continue }
            resultSequence[continuationID] = index
        }
        let outcomes = state.continuations.values.sorted {
            let left = resultSequence[$0.continuationID] ?? -1
            let right = resultSequence[$1.continuationID] ?? -1
            if left != right { return left < right }
            return $0.continuationID < $1.continuationID
        }.compactMap { continuation -> [String: Any]? in
            guard let outcome = continuation.workOutcome,
                  outcome.summary.hasPrefix(Self.modelReportPrefix),
                  let selection = state.boundary(for: continuation.binding)?.selection else { return nil }
            return ["selection_id": selection.selectionID, "binding": continuation.binding.jsonObject,
                    "continuation_id": continuation.continuationID, "status": outcome.status,
                    "summary": String(outcome.summary.dropFirst(Self.modelReportPrefix.count)),
                    "reported_by": "model"]
        }
        // Historical audit is still complete in SQLite. This wire projection
        // explicitly bounds the newest entries instead of making live cards
        // unreadable after enough large result notes have been recorded.
        var recent: [[String: Any]] = []
        for outcome in outcomes.reversed().prefix(32) {
            let candidate = [outcome] + recent
            guard try Self.data(candidate).count <= Self.maximumOutcomeProjectionBytes else { break }
            recent = candidate
        }
        projection["outcomes"] = recent
        projection["history"] = ["total_outcomes": outcomes.count,
                                  "omitted_outcomes": outcomes.count - recent.count]
        return projection
    }

    private func liveProjection(
        state: CoordinatorSemanticState, routingObject: [String: Any]
    ) throws -> [String: Any] {
        let pendingKeys = Set(state.pendingInteractions.map { $0.binding.fullKey })
        proposals = proposals.filter { pendingKeys.contains($0.key) }
        let cards = try state.pendingInteractions.sorted {
            $0.binding.decisionBoundaryID < $1.binding.decisionBoundaryID
        }.compactMap { boundary -> [String: Any]? in
            guard let proposal = proposals[boundary.binding.fullKey],
                  let packet = state.packet(for: boundary.binding) else { return nil }
            return ["binding": boundary.binding.jsonObject,
                    "packet": try Self.object(packet.canonicalJSON),
                    "claude_proposal": proposal.object, "option_bindings": proposal.optionBindings]
        }
        return ["routing": routingObject, "cards": cards]
    }

    private func admitProjection(
        binding: CoordinatorBinding, proposal: [String: Any], packet: [String: Any],
        optionBindings: [[String: Any]]
    ) throws {
        var routingObject = try Self.object(routing.snapshot().canonicalJSON)
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        reconcileAuthority(state)
        let live = try liveProjection(state: state, routingObject: routingObject)
        guard proposals.count < 64 else { throw CoordinatorError("live_proposal_capacity") }
        var identity = binding.jsonObject
        identity["interaction_id"] = packet["interaction_id"]
        identity["packet_id"] = packet["packet_id"]
        identity["revision"] = packet["revision"]
        var pending = identity
        pending["state"] = "pending"
        pending["foreground"] = true
        pending["reminder_due"] = false
        pending["milliseconds_until_expiry"] = 600_000
        var currentPending = routingObject["pending"] as? [[String: Any]] ?? []
        for index in currentPending.indices { currentPending[index]["foreground"] = false }
        currentPending.append(pending)
        routingObject["pending"] = currentPending
        routingObject["foreground"] = identity
        routingObject["selection_enabled"] = true
        var cards = live["cards"] as? [[String: Any]] ?? []
        cards.append(["binding": binding.jsonObject, "packet": packet,
                      "claude_proposal": proposal, "option_bindings": optionBindings])
        let projected = try Self.data(["routing": routingObject, "cards": cards])
        // Leave room for the core-assigned sequence's digits and small routing
        // counters. Historical result data has its own separate 48KiB budget.
        guard projected.count <= Self.maximumLiveProjectionBytes - 1024 else {
            throw CoordinatorError("snapshot_capacity")
        }
    }

    private func reconcileAuthority(_ state: CoordinatorSemanticState) {
        offered = offered.filter { _, value in
            guard let continuation = state.continuation(id: value.continuationID),
                  continuation.binding == value.binding,
                  let boundary = state.boundary(for: value.binding),
                  boundary.selection?.selectionID == value.selectionID else { return true }
            return !boundary.closed && continuation.consumedAt == nil && continuation.transport == nil
        }
        claimed = claimed.filter { _, value in
            guard let continuation = state.continuation(id: value.continuationID),
                  continuation.binding == value.binding,
                  let boundary = state.boundary(for: value.binding),
                  boundary.selection?.selectionID == value.selectionID else { return true }
            return !boundary.closed && continuation.workOutcome == nil
        }
    }

    private func selectionDTO(_ value: LiveSelection) -> [String: Any] {
        ["selection_id": value.selectionID, "continuation_id": value.continuationID,
         "packet_id": value.packetID, "revision": value.revision, "option_id": value.optionID]
    }

    private func instant() throws -> RFC3339Instant {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try RFC3339Instant(formatter.string(from: wallNow()))
    }

    private static func validateProposal(_ value: Any?) throws -> [String: Any] {
        guard let proposal = value as? [String: Any] else { throw CoordinatorError("invalid_proposal") }
        // Activation returns both native DTO and sealed core packet. Bound
        // their combined size before committing any lifecycle event.
        guard try data(proposal).count <= maximumProposalBytes else {
            throw CoordinatorError("proposal_too_large")
        }
        try exact(proposal, ["proposal_id", "task_goal", "outcome", "options", "reported_side_effects"])
        _ = try text(proposal, "proposal_id", maximum: 256)
        _ = try text(proposal, "task_goal", maximum: 2048)
        guard let outcome = proposal["outcome"] as? [String: Any] else { throw CoordinatorError("invalid_proposal") }
        try exact(outcome, ["status", "summary"])
        guard ["completed", "partial", "blocked", "failed"].contains(try text(outcome, "status", maximum: 32)) else {
            throw CoordinatorError("invalid_proposal_outcome")
        }
        _ = try text(outcome, "summary", maximum: 512)
        guard let options = proposal["options"] as? [[String: Any]], (2...4).contains(options.count) else {
            throw CoordinatorError("invalid_options")
        }
        var identifiers: Set<String> = []
        for option in options {
            try exact(option, ["id", "title", "description", "task", "done_when", "constraints"])
            let identifier = try text(option, "id", maximum: 64)
            guard identifiers.insert(identifier).inserted else { throw CoordinatorError("duplicate_option_id") }
            _ = try text(option, "title", maximum: 128)
            _ = try text(option, "description", maximum: 256)
            _ = try text(option, "task", maximum: 2048)
            _ = try text(option, "done_when", maximum: 512)
            guard let constraints = option["constraints"] as? [String], constraints.count <= 32 else {
                throw CoordinatorError("invalid_constraints")
            }
            for constraint in constraints { _ = try text(["text": constraint], "text", maximum: 1024) }
        }
        guard let effects = proposal["reported_side_effects"] as? [[String: Any]], effects.count <= 32 else {
            throw CoordinatorError("invalid_reported_side_effects")
        }
        for effect in effects {
            try exact(effect, ["kind", "summary", "reversibility"])
            guard let kind = effect["kind"] as? String,
                  kind.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression)
                    == kind.startIndex..<kind.endIndex else {
                throw CoordinatorError("invalid_reported_side_effects")
            }
            _ = try text(effect, "summary", maximum: 1024)
            guard ["reversible", "irreversible", "unknown"].contains(
                try text(effect, "reversibility", maximum: 32)
            ) else { throw CoordinatorError("invalid_reported_side_effects") }
        }
        return proposal
    }

    private static func binding(_ request: [String: Any]) throws -> CoordinatorBinding {
        guard let value = request["binding"] as? [String: Any] else { throw CoordinatorError("binding_incomplete") }
        try exact(value, ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
                          "episode_root_prompt_id", "episode_baseline_checkpoint_id",
                          "decision_boundary_id", "boundary_sequence"])
        return try CoordinatorBinding(jsonObject: value)
    }

    private static func fields(_ request: [String: Any], _ fields: Set<String>) throws {
        try exact(request, fields.union(["schema_version", "request_id", "operation"]))
    }

    private static func exact(_ object: [String: Any], _ fields: Set<String>) throws {
        guard Set(object.keys) == fields else { throw CoordinatorError("invalid_fields") }
    }

    private static func text(_ object: [String: Any], _ key: String, maximum: Int) throws -> String {
        guard let value = object[key] as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.utf8.count <= maximum, !value.contains("\0"),
              value == value.precomposedStringWithCanonicalMapping else {
            throw CoordinatorError("invalid_text")
        }
        return value
    }

    private static func id(_ purpose: String) -> String { "claude_\(purpose)_\(UUID().uuidString.lowercased())" }
    private static func data(_ object: Any) throws -> Data { try StrictJSONTransport.data(forJSONObject: object) }
    private static func object(_ data: Data) throws -> [String: Any] { try StrictJSONTransport.object(from: data) }
}
