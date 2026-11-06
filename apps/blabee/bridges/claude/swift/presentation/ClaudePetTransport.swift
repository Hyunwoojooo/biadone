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
    private var mutationInFlight = false
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
        (attemptedIdentity == nil ? 0 : 1, selectionReceipt == nil ? 0 : 1, mutationInFlight ? 1 : 0)
    }

    init(scopeID: String, projectID: String, sessionID: String, cwd: String,
         selectionToken: String, handle: @escaping @Sendable (Data) throws -> Data) throws {
        guard UUID(uuidString: scopeID)?.uuidString.lowercased() == scopeID,
              Self.isUUID(sessionID), !projectID.isEmpty, projectID.utf8.count <= 256,
              !projectID.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }),
              ClaudeCanonicalDirectory.isNormalizedAbsolute(cwd),
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
            guard !mutationInFlight else { throw PetModelError.invalid("claude_selection_in_flight") }
            mutationInFlight = true
            defer { mutationInFlight = false }
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
        case "dismiss_interaction":
            let identity = try requestIdentity(object, kind: "blabee_pet_dismiss_request", extraKeys: [])
            // A possibly delivered selection must never be converted to a
            // dismissal. Reserve before the fresh read, just like selection.
            guard !mutationInFlight, attemptedIdentity != identity else {
                throw PetModelError.invalid("claude_selection_in_flight")
            }
            mutationInFlight = true
            defer { mutationInFlight = false }
            let snapshot = try await freshSnapshot()
            let interaction = try requireCurrent(identity, in: snapshot)
            guard interaction.usesRankedNextActions else { throw PetModelError.invalid("claude_dismiss_not_ranked") }
            let response = try await nativeRequest("dismiss_interaction", fields: [
                "boundary_id": identity.binding.decisionBoundaryID, "interaction_id": identity.interactionID,
                "packet_id": identity.packetID, "revision": identity.revision,
            ])
            let requestID = try Self.text(Self.object(response), "request_id", maximum: 36)
            let receipt = try StrictJSONTransport.data(forJSONObject: result(response, requestID: requestID))
            try PetDismissRequest(identity: identity).requireDismissed(receipt)
            return receipt
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
        try ClaudePetSnapshotProjector(scopeID: scopeID, projectID: projectID,
            sessionID: sessionID, cwd: cwd, product: false).project(value)
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
