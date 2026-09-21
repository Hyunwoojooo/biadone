import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation

/// One Pet, one selected projection. Session discovery is separate from card
/// data, so Claude cannot acquire Codex approval or queued-action capabilities.
actor PetProviderTransport: PetProviderControlling {
    typealias Access = @Sendable () async -> PetProviderServiceAccess?
    private let codex: any PetCoordinatorTransport
    private let access: Access
    private var currentAccess: PetProviderServiceAccess?
    private var selectedID = "codex-primary"
    private var selectionGeneration: UInt64 = 0
    private var snapshotGeneration: UInt64 = 0
    private var legacyCodexFallback = false
    private var sessions: [PetProviderSession] = []
    private var currentContext: PetProviderContext?
    private var currentSnapshot: PetSnapshot?
    private var knownClaudePresentations: [String: PetSnapshot] = [:]
    private var receipts: [(String, PetSnapshot)] = []
    private var selectedReceipts: [(Data, PetSelectionRequest, PetProviderContext, PetSelectionOutcome)] = []
    private var attempted: [String: PetInteractionIdentity] = [:]
    private var inFlight = Set<String>()

    init(codex: any PetCoordinatorTransport, access: @escaping Access) {
        self.codex = codex; self.access = access
    }

    func selectSession(_ session: PetProviderSession) async throws {
        guard sessions.contains(session) else { throw failure("stale_context") }
        selectionGeneration &+= 1
        selectedID = session.id; currentContext = session.context
        legacyCodexFallback = false
        currentSnapshot = nil; selectedReceipts.removeAll()
    }

    func request(type: String, payload: Data) async throws -> Data {
        try await request(type: type, payload: payload, expectedContext: nil)
    }

    func request(type: String, payload: Data, expectedContext: PetProviderContext?) async throws -> Data {
        if type == "get_state" { return try await snapshot(payload: payload) }
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        let owned = await access()
        try requireCurrent(expectedContext, generation: generation)
        guard owned == currentAccess else { throw failure("service_replaced") }
        if let owned {
            try requireAccess(owned)
            guard expectedContext != nil || legacyCodexFallback else { throw failure("stale_context") }
        } else if expectedContext != nil {
            throw failure("service_replaced")
        }
        if expectedContext?.provider != .claude {
            if type == "select", let owned, let context = expectedContext {
                try requireAccess(owned)
                let body = try StrictJSONTransport.object(from: payload)
                let identity = try PetInteractionIdentity(jsonObject: body)
                let request = try PetSelectionRequest(identity: identity,
                    selectionID: text(body, "selection_id"), optionID: text(body, "option_id"))
                let result = try await providerRequest("select", context: context,
                    payload: selectionPayload(request), access: owned)
                try requireCurrent(context, generation: generation)
                guard let echoed = result["selection"] as? [String: Any],
                      try StrictJSONTransport.data(forJSONObject: echoed) == StrictJSONTransport.data(forJSONObject: selectionPayload(request)),
                      let receipt = result["receipt"] as? [String: Any],
                      receipt["schema_version"] as? String == "blabee.pet.codex-receipt.v1",
                      let value = receipt["value"] as? [String: Any] else { throw failure("receipt_invalid") }
                return try StrictJSONTransport.data(forJSONObject: value)
            }
            // Codex retains its original focus, native approval and event APIs.
            // A nil-context legacy path exists only before an owned bootstrap.
            let result = try await codex.request(type: type, payload: payload)
            guard await access() == owned else { throw failure("service_replaced") }
            try requireCurrent(expectedContext, generation: generation)
            return result
        }
        guard let context = expectedContext, let owned else { throw failure("unavailable") }
        try requireAccess(owned)
        let body = try StrictJSONTransport.object(from: payload)
        let identity = try PetInteractionIdentity(jsonObject: body)
        guard let snapshot = currentSnapshot,
              snapshot.providerStatus?.selectionEnabled == true,
              snapshot.routing.foreground == identity,
              snapshot.interactions.contains(where: { $0.identity == identity && $0.isSelectionReady }) else {
            throw failure("stale_context")
        }
        if type == "focus_interaction" {
            guard body["kind"] as? String == "blabee_pet_focus_request" else { throw failure("request_invalid") }
            return try StrictJSONTransport.data(forJSONObject: ["focused": true])
        }
        guard type == "select", body["kind"] as? String == "blabee_selection_request",
              !inFlight.contains(context.scopeID), attempted[context.scopeID] != identity else {
            throw failure("operation_unavailable")
        }
        let selection = try PetSelectionRequest(identity: identity,
            selectionID: text(body, "selection_id"), optionID: text(body, "option_id"))
        guard PetProviderContext.isUUID(selection.selectionID) else { throw failure("request_invalid") }
        inFlight.insert(context.scopeID); attempted[context.scopeID] = identity
        defer { inFlight.remove(context.scopeID) }
        let result = try await providerRequest("select", context: context,
            payload: selectionPayload(selection), access: owned)
        try requireCurrent(context, generation: generation)
        guard result["status"] as? String == "awaiting_claude_claim",
              let echoed = result["selection"] as? [String: Any],
              try StrictJSONTransport.data(forJSONObject: echoed) == StrictJSONTransport.data(forJSONObject: selectionPayload(selection)) else {
            throw failure("receipt_invalid")
        }
        let data = try StrictJSONTransport.data(forJSONObject: result)
        selectedReceipts.append((data, selection, context, .channelPending))
        if selectedReceipts.count > 8 { selectedReceipts.removeFirst() }
        return data
    }

    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        let object = try StrictJSONTransport.object(from: data)
        guard Set(object.keys) == ["provider_snapshot_receipt"], let id = object["provider_snapshot_receipt"] as? String,
              let index = receipts.firstIndex(where: { $0.0 == id }) else { throw failure("snapshot_receipt") }
        return receipts.remove(at: index).1
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest) async throws -> PetSelectionOutcome {
        try await selectionOutcome(data, request: request, expectedContext: nil)
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest,
                          expectedContext: PetProviderContext?) async throws -> PetSelectionOutcome {
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        let owned = await access()
        try requireCurrent(expectedContext, generation: generation)
        guard owned == currentAccess else { throw failure("service_replaced") }
        if expectedContext?.provider != .claude {
            let result = try await codex.selectionOutcome(data, request: request)
            guard await access() == owned else { throw failure("service_replaced") }
            try requireCurrent(expectedContext, generation: generation)
            return result
        }
        guard let context = expectedContext,
              let index = selectedReceipts.firstIndex(where: { $0.0 == data && $0.1 == request && $0.2 == context }) else {
            throw failure("selection_receipt")
        }
        return selectedReceipts.remove(at: index).3
    }

    func checkConnection(_ expectedContext: PetProviderContext) async throws {
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        guard expectedContext.provider == .claude, let owned = await access() else { throw failure("unavailable") }
        try requireCurrent(expectedContext, generation: generation); try requireAccess(owned)
        _ = try await providerRequest("readiness.begin", context: expectedContext, payload: [:], access: owned)
        try requireCurrent(expectedContext, generation: generation)
    }

    func disconnect(_ expectedContext: PetProviderContext) async throws {
        try requireCurrent(expectedContext)
        let generation = selectionGeneration
        guard expectedContext.provider == .claude, let owned = await access() else { throw failure("unavailable") }
        try requireCurrent(expectedContext, generation: generation); try requireAccess(owned)
        let request = try PetProviderDirectoryCodec.request(operation: "disconnect", payload: ["target": expectedContext.target])
        let decoded = try PetProviderDirectoryCodec.decode(await rpc("pet_directory_v1", request, access: owned), matching: request)
        guard decoded.service == expectedContext.serviceIncarnation,
              Set(decoded.result.keys) == ["disconnected"], petStrictBooleanValue(decoded.result["disconnected"]) == true else {
            throw failure("response_invalid")
        }
        try requireCurrent(expectedContext, generation: generation)
        currentSnapshot = nil
    }

    private func snapshot(payload: Data) async throws -> Data {
        snapshotGeneration &+= 1
        let requestedSnapshot = snapshotGeneration
        let requestedGeneration = selectionGeneration
        let owned = await access()
        guard requestedGeneration == selectionGeneration, requestedSnapshot == snapshotGeneration else { throw failure("stale_context") }
        var diagnostic: String?
        if let owned {
            if currentAccess != owned {
                currentAccess = owned
                attempted.removeAll(); selectedReceipts.removeAll()
            }
            do {
                let discovered = try await directory(access: owned)
                guard requestedGeneration == selectionGeneration, requestedSnapshot == snapshotGeneration else { throw failure("stale_context") }
                sessions = discovered
            }
            catch { diagnostic = "Claude 세션 목록을 확인하지 못했어요. 다시 확인해 주세요." }
        } else {
            currentAccess = nil
            if selectedID == "codex-primary" { sessions = []; currentContext = nil }
            else { diagnostic = "연결이 끊겼어요. Claude에서 새로 시작해 주세요." }
        }
        guard requestedGeneration == selectionGeneration, requestedSnapshot == snapshotGeneration else { throw failure("stale_context") }
        let selected = sessions.first(where: { $0.id == selectedID })
        var displayed: PetSnapshot
        if selectedID == "codex-primary" {
            currentContext = diagnostic == nil ? selected?.context : nil
            legacyCodexFallback = currentContext == nil
            var wrapped: PetSnapshot?
            if let owned, let context = currentContext {
                do {
                    let value = try await providerRequest("snapshot", context: context, payload: [:], access: owned)
                    let projection = try projection(value, schema: "blabee.pet.codex.v1")
                    wrapped = try PetSnapshot.parse(StrictJSONTransport.data(forJSONObject: projection))
                } catch {
                    guard requestedGeneration == selectionGeneration, requestedSnapshot == snapshotGeneration else { throw failure("stale_context") }
                    currentContext = nil
                    legacyCodexFallback = true
                    diagnostic = "Claude 연결 기능을 확인하지 못했어요. Codex 연결은 유지됩니다."
                }
            }
            if let wrapped { displayed = wrapped }
            else {
                let data = try await codex.request(type: "get_state", payload: payload)
                displayed = try await codex.decodeSnapshot(data)
            }
        } else if let selected {
            currentContext = selected.context
            if selected.state != "disconnected", let owned, diagnostic == nil {
                do {
                    let result = try await providerRequest("snapshot", context: selected.context, payload: [:], access: owned)
                    guard requestedGeneration == selectionGeneration, requestedSnapshot == snapshotGeneration else { throw failure("stale_context") }
                    let value = try projection(result, schema: "blabee.pet.claude.v1")
                    displayed = try ClaudePetSnapshotProjector(scopeID: selected.context.scopeID,
                        projectID: selected.projectID, sessionID: selected.sessionID, cwd: selected.cwd, product: true).project(value)
                    let state = try text(value, "readiness_status")
                    sessions = sessions.map { row in
                        row.id == selected.id ? PetProviderSession(id: row.id, context: row.context,
                            projectID: row.projectID, sessionID: row.sessionID, cwd: row.cwd,
                            state: state, title: row.title) : row
                    }
                    if (value["native_observation"] as? [String: Any])?["status"] as? String == "new_prompt_required" {
                        diagnostic = "Claude에 새 입력을 보내 주세요. 이전 선택은 사용할 수 없어요."
                    }
                } catch {
                    displayed = try unavailable(selected)
                    diagnostic = "이 Claude 세션의 상태를 확인하지 못했어요."
                }
            } else {
                displayed = try unavailable(selected)
                diagnostic = diagnostic ?? "연결이 끊겼어요. Claude에서 새로 시작해 주세요."
            }
        } else {
            // Never redirect a vanished Claude selection to the Codex pool.
            let former = currentContext
            displayed = try emptySnapshot()
            if let former {
                displayed.providerStatus = PetProviderStatus(provider: .claude, scopeID: former.scopeID,
                    sessionID: "", cwd: "", bridgeConnected: false, ready: false, selectionEnabled: false, latestOutcome: nil)
            }
            diagnostic = "연결이 끊겼어요. Claude에서 새로 시작해 주세요."
        }
        let finalAccess = await access()
        guard requestedGeneration == selectionGeneration, requestedSnapshot == snapshotGeneration,
              finalAccess == owned else { throw failure("stale_context") }
        displayed.providerSessions = sessions; displayed.providerContext = currentContext
        displayed.providerDiagnostic = diagnostic
        currentSnapshot = displayed
        if selectedID != "codex-primary" { knownClaudePresentations[selectedID] = displayed }
        knownClaudePresentations = knownClaudePresentations.filter { id, _ in sessions.contains { $0.id == id } }
        attempted = attempted.filter { scope, _ in sessions.contains(where: { $0.context.scopeID == scope }) }
        let id = UUID().uuidString.lowercased()
        receipts.append((id, displayed)); if receipts.count > 8 { receipts.removeFirst() }
        return try StrictJSONTransport.data(forJSONObject: ["provider_snapshot_receipt": id])
    }

    private func directory(access owned: PetProviderServiceAccess) async throws -> [PetProviderSession] {
        var result: [PetProviderSession] = [], cursor: String?, service: String?
        var seen = Set<String>()
        // Registry supports at most32 active and32 recently disconnected scopes.
        // A defensive page budget also bounds a malformed service response.
        for _ in 0..<4 {
            let request = try PetProviderDirectoryCodec.request(operation: "list",
                payload: ["after_scope_id": cursor as Any? ?? NSNull()])
            let page = try PetProviderDirectoryCodec.decode(await rpc("pet_directory_v1", request, access: owned), matching: request)
            guard service == nil || service == page.service,
                  Set(page.result.keys) == ["codex_target", "claude_available", "sessions", "next_cursor"],
                  petStrictBooleanValue(page.result["claude_available"]) != nil,
                  let rawCodex = page.result["codex_target"] as? [String: Any],
                  let rows = page.result["sessions"] as? [[String: Any]], rows.count <= PetProviderDirectoryCodec.maximumRows else {
                throw failure("directory_invalid")
            }
            let codexContext = try PetProviderContext(provider: .codex, target: rawCodex)
            guard codexContext.serviceIncarnation == page.service else { throw failure("directory_invalid") }
            if service == nil {
                result.append(PetProviderSession(id: "codex-primary", context: codexContext, projectID: "",
                    sessionID: "", cwd: "", state: "connected", title: "Codex · 연결된 작업"))
            }
            service = page.service
            for row in rows {
                guard Set(row.keys) == ["provider", "target", "project_id", "session_id", "native_session_id", "cwd", "state"],
                      row["provider"] as? String == "claude", let rawTarget = row["target"] as? [String: Any] else {
                    throw failure("directory_invalid")
                }
                let context = try PetProviderContext(provider: .claude, target: rawTarget)
                let project = try text(row, "project_id"), session = try text(row, "session_id")
                let native = try text(row, "native_session_id"), cwd = try text(row, "cwd"), state = try text(row, "state")
                guard context.serviceIncarnation == service, seen.insert(context.scopeID).inserted,
                      cursor == nil || context.scopeID > cursor!, PetProviderContext.isUUID(native),
                      project.hasPrefix("claude_project_"), session.hasPrefix("claude_session_"),
                      ClaudeCanonicalDirectory.isNormalizedAbsolute(cwd),
                      ["starting", "connected", "disconnected"].contains(state) else { throw failure("directory_invalid") }
                result.append(PetProviderSession(id: "claude:" + context.serviceIncarnation + ":" + context.scopeID,
                    context: context, projectID: project, sessionID: session, cwd: cwd, state: state,
                    title: "Claude · " + URL(fileURLWithPath: cwd).lastPathComponent + " · " + native.prefix(8)))
            }
            if page.result["next_cursor"] is NSNull { return result }
            guard let next = page.result["next_cursor"] as? String, PetProviderContext.isUUID(next),
                  cursor == nil || next > cursor!, rows.last?["target"].flatMap({ $0 as? [String: Any] })?["scope_id"] as? String == next else {
                throw failure("directory_invalid")
            }
            cursor = next
        }
        throw failure("directory_capacity")
    }

    private func providerRequest(_ operation: String, context: PetProviderContext,
                                 payload: [String: Any], access owned: PetProviderServiceAccess) async throws -> [String: Any] {
        let corpus = RuntimeSecretCorpus(); corpus.register(owned.credential)
        let codec = ClaudeProductWireCodec(credentialCorpus: corpus)
        let object: [String: Any] = ["schema_version": "blabee.pet-provider.v1", "kind": "request",
            "request_id": UUID().uuidString.lowercased(), "provider": context.provider == .claude ? "claude" : "codex",
            "role": "selector", "operation": operation, "target": context.target, "payload": payload]
        let request = try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: object))
        let reply = try await rpc("pet_provider_v1", object, access: owned)
        let decoded = try codec.decodeResponse(reply, matching: request,
            connection: .init(serviceIncarnation: UUID(uuidString: context.serviceIncarnation)!))
        let response = try StrictJSONTransport.object(from: decoded.canonicalJSON)
        guard response["ok"] as? Bool == true, let result = response["result"] as? [String: Any] else {
            throw failure("request_rejected")
        }
        return result
    }

    private func rpc(_ type: String, _ envelope: [String: Any], access owned: PetProviderServiceAccess) async throws -> Data {
        let data = try StrictJSONTransport.data(forJSONObject: ["auth_token": owned.credential, "envelope": envelope])
        let result = try await codex.request(type: type, payload: data)
        guard await access() == owned else { throw failure("service_replaced") }
        let corpus = RuntimeSecretCorpus(); corpus.register(owned.credential)
        try corpus.assertNoKnownSecret(in: result)
        return result
    }

    private func selectionPayload(_ value: PetSelectionRequest) -> [String: Any] {
        ["packet_id": value.identity.packetID, "revision": value.identity.revision, "option_id": value.optionID,
         "selection_id": value.selectionID, "binding": value.identity.binding.jsonObject]
    }

    private func projection(_ result: [String: Any], schema: String) throws -> [String: Any] {
        guard Set(result.keys) == ["projection"], let projection = result["projection"] as? [String: Any],
              Set(projection.keys) == ["schema_version", "value"], projection["schema_version"] as? String == schema,
              let value = projection["value"] as? [String: Any] else { throw failure("projection_invalid") }
        return value
    }

    private func unavailable(_ session: PetProviderSession) throws -> PetSnapshot {
        let previous = knownClaudePresentations[session.id]
        var value = try emptySnapshot(inFlightCount: previous?.routing.inFlightCount ?? 0)
        value.providerStatus = PetProviderStatus(provider: .claude, scopeID: session.context.scopeID,
            sessionID: session.sessionID, cwd: session.cwd, bridgeConnected: false, ready: false,
            selectionEnabled: false, latestOutcome: previous?.providerStatus?.latestOutcome,
            pendingReportCount: previous?.providerStatus?.pendingReportCount ?? 0)
        return value
    }

    private func emptySnapshot(inFlightCount: Int64 = 0) throws -> PetSnapshot {
        let routing = try PetRoutingSnapshot(jsonObject: ["schema_version": "1.0",
            "kind": "blabee_routing_snapshot", "selection_enabled": false,
            "foreground": NSNull(), "pending": [], "in_flight_count": inFlightCount])
        return PetSnapshot(projects: [], sessions: [], routing: routing, interactions: [],
            permissionRequests: [], permissionNoticeCount: 0,
            managedCommandApprovals: [], managedCommandApprovalNoticeCount: 0)
    }

    private func requireCurrent(_ context: PetProviderContext?, generation: UInt64? = nil) throws {
        guard context == currentContext, generation == nil || generation == selectionGeneration,
              context != nil || (selectedID == "codex-primary" && (currentAccess == nil || legacyCodexFallback)) else {
            throw failure("stale_context")
        }
    }
    private func requireAccess(_ value: PetProviderServiceAccess) throws {
        guard value == currentAccess else { throw failure("service_replaced") }
    }
    private func text(_ value: [String: Any], _ key: String) throws -> String {
        guard let result = value[key] as? String, !result.isEmpty, result.utf8.count <= 4096,
              !result.contains("\0") else { throw failure("value_invalid") }
        return result
    }
    private func failure(_ suffix: String) -> CoordinatorError { CoordinatorError("pet_provider_" + suffix) }
}
