import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation

/// The app's one private bootstrap authorizes UI operations. Per-scope selector
/// capabilities remain inside the registry; general UDS never issues them.
final class PetProviderService: @unchecked Sendable {
    private let credential: String
    private let codex: any CoordinatorOperationalHandling
    private let registry: ClaudeSessionRegistry?
    private let codec: ClaudeProductWireCodec
    private let corpus: RuntimeSecretCorpus
    private let lock = NSLock()
    private var stopped = false
    let codexContext: PetProviderContext

    init(credential: String, codex: any CoordinatorOperationalHandling,
         registry: ClaudeSessionRegistry?, secretCorpus: RuntimeSecretCorpus) throws {
        guard credential.count == 64, credential.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw CoordinatorError("pet_provider_unauthorized")
        }
        self.credential = credential; self.codex = codex; self.registry = registry
        corpus = secretCorpus; corpus.register(credential)
        codec = ClaudeProductWireCodec(credentialCorpus: secretCorpus)
        codexContext = PetProviderContext(provider: .codex, scopeID: "codex-primary",
            serviceIncarnation: (registry?.serviceIncarnation ?? UUID()).uuidString.lowercased(),
            sessionIncarnation: UUID().uuidString.lowercased(), authorityEpoch: nil, uiGeneration: 1)
    }

    func stop() { lock.withLock { stopped = true } }

    func handleDirectory(_ payload: Data) throws -> Data {
        let request = try authenticate(payload)
        let operation = try PetProviderDirectoryCodec.validateRequest(request)
        let body = request["payload"] as! [String: Any]
        let result: [String: Any]
        if operation == "disconnect" {
            guard let registry else { throw CoordinatorError("claude_product_unavailable") }
            try registry.disconnectPet(target: body["target"] as! [String: Any])
            result = ["disconnected": true]
        } else {
            let cursor = (body["after_scope_id"] as? String).flatMap(UUID.init(uuidString:))
            let entries = try registry?.petSessions(afterScopeID: cursor, limit: PetProviderDirectoryCodec.maximumRows + 1) ?? []
            let rows = entries.prefix(PetProviderDirectoryCodec.maximumRows).map { entry -> [String: Any] in
                let mapping = entry.mapping, identity = mapping.authority
                let context = PetProviderContext(provider: .claude, scopeID: identity.scopeID.uuidString.lowercased(),
                    serviceIncarnation: identity.serviceIncarnation.uuidString.lowercased(),
                    sessionIncarnation: identity.sessionIncarnation.uuidString.lowercased(),
                    authorityEpoch: identity.authorityEpoch.uuidString.lowercased(), uiGeneration: entry.uiGeneration)
                let state: String
                switch entry.state {
                case .awaitingNativeStart: state = "starting"
                case .active: state = "connected"
                case .disconnected: state = "disconnected"
                }
                return ["provider": "claude", "target": context.target, "project_id": mapping.coreProjectID,
                    "session_id": mapping.coreSessionID, "native_session_id": identity.nativeSessionID.uuidString.lowercased(),
                    "cwd": mapping.canonicalCWD, "state": state]
            }
            let next = entries.count > PetProviderDirectoryCodec.maximumRows
                ? entries[PetProviderDirectoryCodec.maximumRows - 1].mapping.authority.scopeID.uuidString.lowercased() : nil
            result = ["codex_target": codexContext.target, "claude_available": registry != nil,
                      "sessions": rows, "next_cursor": next as Any? ?? NSNull()]
        }
        try requireActive()
        let response = try PetProviderDirectoryCodec.response(request: request,
            service: codexContext.serviceIncarnation, result: result)
        try corpus.assertNoKnownSecret(in: response)
        return response
    }

    func handleProvider(_ payload: Data) async throws -> Data {
        let object = try authenticate(payload)
        let request = try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: object))
        guard request.contract == .pet, request.role == "selector" else {
            throw CoordinatorError("pet_provider_unauthorized")
        }
        if request.provider == .claude {
            guard let registry else { throw CoordinatorError("claude_product_unavailable") }
            let result = try registry.handlePet(request: request)
            try requireActive()
            return result
        }
        guard request.provider == .codex, let target = object["target"] as? [String: Any],
              try PetProviderContext(provider: .codex, target: target) == codexContext else {
            throw CoordinatorError("pet_provider_stale_context")
        }
        let snapshotRequest = try PetTransportRequestPayload.snapshotWithConsumerHeartbeat()
        let result: [String: Any]
        switch request.operation {
        case "snapshot":
            let snapshot = try await codex.handle(type: "get_state", payload: snapshotRequest)
            result = ["projection": ["schema_version": "blabee.pet.codex.v1",
                                      "value": try StrictJSONTransport.object(from: snapshot)]]
        case "select":
            let body = object["payload"] as! [String: Any]
            let snapshot = try PetSnapshot.parse(await codex.handle(type: "get_state", payload: snapshotRequest))
            let binding = try CoordinatorBinding(jsonObject: body["binding"] as! [String: Any])
            guard let interaction = snapshot.interactions.first(where: {
                $0.identity.binding == binding && $0.identity.packetID == body["packet_id"] as? String
                    && $0.identity.revision == ExactJSONInteger.int64(body["revision"], minimum: 1)
            }) else { throw CoordinatorError("pet_provider_stale_context") }
            try requireActive()
            let selection = try PetSelectionRequest(identity: interaction.identity,
                selectionID: body["selection_id"] as! String, optionID: body["option_id"] as! String)
            // The existing Codex dispatcher still validates readiness/approval,
            // commits and produces its own receipt. Never synthesize one.
            let receipt = try await codex.handle(type: "select", payload: selection.data())
            result = ["selection": body, "receipt": ["schema_version": "blabee.pet.codex-receipt.v1",
                                                       "value": try StrictJSONTransport.object(from: receipt)]]
        default: throw CoordinatorError("pet_provider_unsupported_operation")
        }
        try requireActive()
        var response = object
        response["kind"] = "response"; response.removeValue(forKey: "payload")
        response["ok"] = true; response["result"] = result
        let data = try StrictJSONTransport.data(forJSONObject: response)
        return try codec.decodeResponse(data, matching: request,
            connection: .init(serviceIncarnation: UUID(uuidString: codexContext.serviceIncarnation)!)).canonicalJSON
    }

    private func authenticate(_ payload: Data) throws -> [String: Any] {
        try requireActive()
        let wrapper = try StrictJSONTransport.object(from: payload)
        guard Set(wrapper.keys) == ["auth_token", "envelope"], let supplied = wrapper["auth_token"] as? String,
              ContinuationTokenMaterial.constantTimeEqual(supplied, credential),
              let envelope = wrapper["envelope"] as? [String: Any] else {
            throw CoordinatorError("pet_provider_unauthorized")
        }
        try corpus.assertNoKnownSecret(inJSONObject: envelope)
        return envelope
    }

    private func requireActive() throws {
        guard lock.withLock({ !stopped }) else { throw CoordinatorError("pet_provider_unauthorized") }
    }
}
