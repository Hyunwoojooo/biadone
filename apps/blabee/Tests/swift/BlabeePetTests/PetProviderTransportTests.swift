import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let providerTransportService = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
private let providerTransportCredential = String(repeating: "9", count: 64)

private actor ProviderTransportAccess {
    private var value: PetProviderServiceAccess?
    init(_ value: PetProviderServiceAccess?) { self.value = value }
    func current() -> PetProviderServiceAccess? { value }
    func replace(_ value: PetProviderServiceAccess?) { self.value = value }
}

private struct ProviderTransportSeed: Sendable {
    let context: PetProviderContext
    let row: Data
    let projection: Data
}

private func providerTransportRemap(_ value: Any, project: String, session: String) -> Any {
    if let object = value as? [String: Any] {
        return object.mapValues { providerTransportRemap($0, project: project, session: session) }
            .merging(object.keys.contains("project_id") ? ["project_id": project] : [:]) { _, value in value }
            .merging(object.keys.contains("session_id") ? ["session_id": session] : [:]) { _, value in value }
    }
    if let array = value as? [Any] { return array.map { providerTransportRemap($0, project: project, session: session) } }
    return value
}

private func providerTransportSeed(_ native: ClaudePetFixture, index: Int) throws -> ProviderTransportSeed {
    try native.prepare()
    let context = PetProviderContext(provider: .claude, scopeID: native.grant.scope.scopeID,
        serviceIncarnation: providerTransportService, sessionIncarnation: UUID().uuidString.lowercased(),
        authorityEpoch: UUID().uuidString.lowercased(), uiGeneration: 1)
    let project = "claude_project_\(index)", session = "claude_session_\(index)"
    var projection = try #require(providerTransportRemap(native.call("pet.snapshot", role: "selector"),
        project: project, session: session) as? [String: Any])
    projection["readiness_status"] = "ready"
    projection["native_observation"] = ["status": "stopped", "background_state": "idle",
        "background_task_count": 0, "failure_code": NSNull()]
    let row: [String: Any] = ["provider": "claude", "target": context.target,
        "project_id": project, "session_id": session, "native_session_id": native.grant.scope.sessionID,
        "cwd": native.grant.cwd, "state": "connected"]
    return ProviderTransportSeed(context: context, row: try StrictJSONTransport.data(forJSONObject: row),
        projection: try StrictJSONTransport.data(forJSONObject: projection))
}

/// A private RPC peer with a real outer codec and real native-generated inner
/// DTOs. Only transport scheduling and reply corruption are simulated.
private actor ProviderTransportPeer: PetCoordinatorTransport {
    enum Corruption: String, Sendable, CaseIterable { case requestID, provider, generation, selection }
    struct Call: Sendable {
        let type: String
        let operation: String?
        let provider: String?
        let scope: String?
        let data: Data
    }
    let seeds: [ProviderTransportSeed]
    let codexContext = PetProviderContext(provider: .codex, scopeID: "codex-primary",
        serviceIncarnation: providerTransportService, sessionIncarnation: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        authorityEpoch: nil, uiGeneration: 1)
    private let codexSnapshot: Data
    private var calls: [Call] = []
    private var unavailableScopes = Set<String>()
    private var blocked = Set<String>()
    private var blockedOnce = Set<String>()
    private var waiters: [String: [CheckedContinuation<Void, Never>]] = [:]
    private var corruptions: [String: Corruption] = [:]
    private var expectedCredential = providerTransportCredential
    private var directoryUnavailable = false
    private var projectionOverrides: [String: Data] = [:]
    private var contextOverrides: [String: PetProviderContext] = [:]

    init(seeds: [ProviderTransportSeed]) throws {
        self.seeds = seeds
        codexSnapshot = try petTestSnapshotData(cards: [PetTestCard(suffix: "provider_codex", rankedActionCount: 2)],
            foregroundSuffix: "provider_codex")
    }
    func allCalls() -> [Call] { calls }
    func clearCalls() { calls.removeAll() }
    func unavailable(_ context: PetProviderContext) { unavailableScopes.insert(context.scopeID) }
    func corrupt(_ operation: String, with corruption: Corruption) { corruptions[operation] = corruption }
    func replaceCredential(_ value: String) { expectedCredential = value }
    func failDirectory() { directoryUnavailable = true }
    func block(_ operation: String) { blocked.insert(operation) }
    func blockNext(_ operation: String) { blockedOnce.insert(operation) }
    func updateProjection(_ original: PetProviderContext, generation: UInt64, ready: Bool) throws {
        let seed = try #require(seeds.first { $0.context.scopeID == original.scopeID })
        var value = try StrictJSONTransport.object(from: seed.projection)
        value["readiness_status"] = ready ? "ready" : "required"
        value["ready"] = ready
        value["selection_enabled"] = ready
        projectionOverrides[original.scopeID] = try StrictJSONTransport.data(forJSONObject: value)
        contextOverrides[original.scopeID] = PetProviderContext(provider: original.provider,
            scopeID: original.scopeID, serviceIncarnation: original.serviceIncarnation,
            sessionIncarnation: original.sessionIncarnation, authorityEpoch: original.authorityEpoch,
            uiGeneration: generation)
    }
    func isWaiting(_ operation: String) -> Bool { !(waiters[operation]?.isEmpty ?? true) }
    func release(_ operation: String) {
        blocked.remove(operation)
        for continuation in waiters.removeValue(forKey: operation) ?? [] { continuation.resume() }
    }
    private func suspend(_ operation: String) async {
        let once = blockedOnce.remove(operation) != nil
        if blocked.contains(operation) || once { await withCheckedContinuation { waiters[operation, default: []].append($0) } }
    }

    func request(type: String, payload: Data) async throws -> Data {
        if !["pet_provider_v1", "pet_directory_v1"].contains(type) {
            calls.append(Call(type: type, operation: nil, provider: nil, scope: nil, data: payload))
            if type == "get_state" { return codexSnapshot }
            if type == "focus_interaction" { return try petTestFocusResponse() }
            if type == "select" { return try petTestSelectionResponse() }
            throw PetTestError.injected("unexpected_legacy_mutation")
        }
        let wrapper = try StrictJSONTransport.object(from: payload)
        guard Set(wrapper.keys) == ["auth_token", "envelope"],
              wrapper["auth_token"] as? String == expectedCredential,
              let envelope = wrapper["envelope"] as? [String: Any],
              let operation = envelope["operation"] as? String else {
            throw PetTestError.injected("private_auth_envelope")
        }
        let target = envelope["target"] as? [String: Any]
        calls.append(Call(type: type, operation: operation, provider: envelope["provider"] as? String,
            scope: target?["scope_id"] as? String, data: payload))
        if type == "pet_directory_v1" {
            _ = try PetProviderDirectoryCodec.validateRequest(envelope)
            if directoryUnavailable { throw PetTestError.injected("provider_directory_unavailable") }
            let result: [String: Any]
            if operation == "disconnect" { result = ["disconnected": true] }
            else {
                result = ["codex_target": codexContext.target, "claude_available": true,
                    "sessions": try seeds.sorted { $0.context.scopeID < $1.context.scopeID }.map {
                        var row = try StrictJSONTransport.object(from: $0.row)
                        if let context = contextOverrides[$0.context.scopeID] { row["target"] = context.target }
                        return row
                    }, "next_cursor": NSNull()]
            }
            let resultData = try PetProviderDirectoryCodec.response(request: envelope,
                service: providerTransportService, result: result)
            await suspend(operation)
            return resultData
        }
        let corpus = RuntimeSecretCorpus(); corpus.register(expectedCredential)
        let codec = ClaudeProductWireCodec(credentialCorpus: corpus)
        let request = try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: envelope))
        let provider = try #require(envelope["provider"] as? String)
        let rawTarget = try #require(target)
        let scope = try #require(rawTarget["scope_id"] as? String)
        let input = try #require(envelope["payload"] as? [String: Any])
        let result: [String: Any]
        switch operation {
        case "snapshot":
            if unavailableScopes.contains(scope) { throw PetTestError.injected("one_scope_unavailable") }
            let projection: [String: Any]
            if provider == "codex" { projection = try StrictJSONTransport.object(from: codexSnapshot) }
            else {
                let seed = try #require(seeds.first { $0.context.scopeID == scope })
                projection = try StrictJSONTransport.object(from: projectionOverrides[scope] ?? seed.projection)
            }
            result = ["projection": ["schema_version": "blabee.pet.\(provider).v1", "value": projection]]
        case "readiness.begin":
            result = ["probe_id": UUID().uuidString.lowercased(), "expires_at_nanoseconds": "1000000000", "status": "pending"]
        case "select":
            if provider == "claude" { result = ["selection": input, "status": "awaiting_claude_claim"] }
            else { result = ["selection": input, "receipt": ["schema_version": "blabee.pet.codex-receipt.v1",
                "value": try petTestObject(petTestSelectionResponse())]] }
        default: throw PetTestError.injected("unexpected_provider_operation")
        }
        let response: [String: Any] = ["schema_version": "blabee.pet-provider.v1", "kind": "response",
            "request_id": envelope["request_id"]!, "provider": provider, "role": "selector", "operation": operation,
            "target": rawTarget, "ok": true, "result": result]
        let validated = try codec.encodeResponse(response, matching: request,
            connection: .init(serviceIncarnation: UUID(uuidString: providerTransportService)!))
        var output = try StrictJSONTransport.object(from: validated)
        if let corruption = corruptions[operation] {
            switch corruption {
            case .requestID: output["request_id"] = UUID().uuidString.lowercased()
            case .provider: output["provider"] = provider == "claude" ? "codex" : "claude"
            case .generation:
                var changed = rawTarget; changed["ui_generation"] = "2"; output["target"] = changed
            case .selection:
                var changed = result
                var selection = input; selection["selection_id"] = UUID().uuidString.lowercased()
                changed["selection"] = selection; output["result"] = changed
            }
        }
        let outputData = try StrictJSONTransport.data(forJSONObject: output)
        await suspend(operation)
        return outputData
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest) async throws -> PetSelectionOutcome {
        calls.append(Call(type: "selectionOutcome", operation: "outcome", provider: "codex", scope: nil, data: data))
        await suspend("outcome")
        _ = try PetTransportResponse.requireAcceptedSelection(data)
        return .nextTurn
    }
}

private struct ProviderTransportHarness {
    let native: [ClaudePetFixture]
    let access: ProviderTransportAccess
    let peer: ProviderTransportPeer
    let router: PetProviderTransport
    init(owned: Bool = true) throws {
        native = try [ClaudePetFixture(), ClaudePetFixture()]
        let seeds = try native.enumerated().map { try providerTransportSeed($0.element, index: $0.offset) }
        peer = try ProviderTransportPeer(seeds: seeds)
        access = ProviderTransportAccess(owned ? PetProviderServiceAccess(generation: 1, credential: providerTransportCredential) : nil)
        router = PetProviderTransport(codex: peer, access: { [access] in await access.current() })
    }
    func read() async throws -> PetSnapshot {
        let receipt = try await router.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
        return try await router.decodeSnapshot(receipt)
    }
    func selectClaude(index: Int = 0) async throws -> PetSnapshot {
        let initial = try await read()
        let session = try #require(initial.providerSessions.first {
            $0.context.scopeID == native[index].grant.scope.scopeID
        })
        try await router.selectSession(session)
        return try await read()
    }
}

private func providerTransportSelection(_ snapshot: PetSnapshot, id: String? = nil) throws -> PetSelectionRequest {
    let card = try #require(snapshot.interactions.first)
    return try PetSelectionRequest(identity: card.identity, selectionID: id ?? UUID().uuidString.lowercased(),
        optionID: card.actionChoices[0].optionID)
}

private func providerTransportReject(_ body: () async throws -> Void) async {
    do { try await body(); Issue.record("Expected the scoped operation to be rejected") }
    catch { }
}

private func providerTransportWait(_ operation: String, peer: ProviderTransportPeer) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await peer.isWaiting(operation) { return true }
        await Task.yield()
    }
    return await peer.isWaiting(operation)
}

@Suite("Common Pet authenticated provider router")
struct PetProviderTransportTests {
    @Test("Directory discovers Codex and two Claude sessions; selected Claude never polls Codex")
    func selectedProjectionOnly() async throws {
        let h = try ProviderTransportHarness()
        let codex = try await h.read()
        #expect(codex.providerContext?.provider == .codex && codex.providerSessions.count == 3)
        let initialCalls = await h.peer.allCalls()
        #expect(initialCalls.first?.type == "pet_directory_v1")
        let selected = try #require(codex.providerSessions.first { $0.context.provider == .claude })
        try await h.router.selectSession(selected)
        await h.peer.clearCalls()
        let claude = try await h.read()
        #expect(claude.providerContext == selected.context && claude.interactions.count == 1)
        #expect(claude.permissionRequests.isEmpty && claude.managedCommandApprovals.isEmpty)
        let calls = await h.peer.allCalls()
        #expect(!calls.contains { $0.type == "get_state" })
        #expect(calls.filter { $0.operation == "snapshot" }.allSatisfy { $0.provider == "claude" && $0.scope == selected.context.scopeID })
        for call in calls {
            let wrapper = try StrictJSONTransport.object(from: call.data)
            #expect(Set(wrapper.keys) == ["auth_token", "envelope"])
            #expect(wrapper["auth_token"] as? String == providerTransportCredential)
            let envelope = try #require(wrapper["envelope"] as? [String: Any])
            #expect(!String(decoding: try StrictJSONTransport.data(forJSONObject: envelope), as: UTF8.self).contains("consumer_heartbeat"))
        }
    }

    @Test("One unavailable Claude projection keeps both other providers available")
    func isolatedProjectionFailure() async throws {
        let h = try ProviderTransportHarness()
        let initial = try await h.read()
        let a = try #require(initial.providerSessions.first { $0.context.scopeID == h.native[0].grant.scope.scopeID })
        await h.peer.unavailable(a.context)
        try await h.router.selectSession(a)
        let unavailable = try await h.read()
        #expect(unavailable.providerContext == a.context && unavailable.providerSessions.count == 3)
        #expect(unavailable.providerDiagnostic != nil && unavailable.providerStatus?.selectionEnabled == false)
        let b = try #require(unavailable.providerSessions.first { $0.context.scopeID == h.native[1].grant.scope.scopeID })
        try await h.router.selectSession(b)
        let other = try await h.read()
        #expect(other.providerStatus?.selectionEnabled == true && other.providerDiagnostic == nil)
        let codex = try #require(other.providerSessions.first { $0.context.provider == .codex })
        try await h.router.selectSession(codex)
        #expect(try await h.read().providerContext?.provider == .codex)
    }

    @Test("Wrong request, provider and generation replies are rejected without replay",
          arguments: [ProviderTransportPeer.Corruption.requestID, .provider, .generation])
    private func wrongCorrelation(_ corruption: ProviderTransportPeer.Corruption) async throws {
        let h = try ProviderTransportHarness()
        let snapshot = try await h.selectClaude()
        let context = try #require(snapshot.providerContext)
        await h.peer.clearCalls()
        await h.peer.corrupt("readiness.begin", with: corruption)
        await providerTransportReject { try await h.router.checkConnection(context) }
        #expect(await h.peer.allCalls().filter { $0.operation == "readiness.begin" }.count == 1)
    }

    @Test("Selection receipts require exact request, bytes, context and one consumption")
    func selectionReceipt() async throws {
        let h = try ProviderTransportHarness()
        let snapshot = try await h.selectClaude()
        let context = try #require(snapshot.providerContext)
        let selection = try providerTransportSelection(snapshot)
        let data = try await h.router.request(type: "select", payload: selection.data(), expectedContext: context)
        let other = try providerTransportSelection(snapshot)
        await providerTransportReject { _ = try await h.router.selectionOutcome(data, request: other, expectedContext: context) }
        await providerTransportReject { _ = try await h.router.selectionOutcome(Data("{}".utf8), request: selection, expectedContext: context) }
        #expect(try await h.router.selectionOutcome(data, request: selection, expectedContext: context) == .channelPending)
        await providerTransportReject { _ = try await h.router.selectionOutcome(data, request: selection, expectedContext: context) }
        await providerTransportReject { _ = try await h.router.request(type: "select", payload: other.data(), expectedContext: context) }
        #expect(await h.peer.allCalls().filter { $0.operation == "select" }.count == 1)
    }

    @Test("An echoed different selection cannot become an accepted receipt or mutation retry")
    func mismatchedSelectionEcho() async throws {
        let h = try ProviderTransportHarness()
        let snapshot = try await h.selectClaude()
        let context = try #require(snapshot.providerContext)
        let selection = try providerTransportSelection(snapshot)
        await h.peer.corrupt("select", with: .selection)
        await providerTransportReject { _ = try await h.router.request(type: "select", payload: selection.data(), expectedContext: context) }
        await providerTransportReject { _ = try await h.router.request(type: "select", payload: selection.data(), expectedContext: context) }
        #expect(await h.peer.allCalls().filter { $0.operation == "select" }.count == 1)
    }

    @Test("Replacing only the capability rejects an old context before any mutation is dispatched")
    func replacedCapabilityBeforeMutation() async throws {
        let h = try ProviderTransportHarness()
        let snapshot = try await h.selectClaude()
        let context = try #require(snapshot.providerContext)
        let token = String(repeating: "8", count: 64)
        await h.access.replace(PetProviderServiceAccess(generation: 1, credential: token))
        await h.peer.replaceCredential(token)
        await h.peer.clearCalls()
        await providerTransportReject { try await h.router.checkConnection(context) }
        #expect(await h.peer.allCalls().isEmpty)
    }

    @Test("Replacing service access during selection rejects its late reply and never retries")
    func replacedServiceDuringSelection() async throws {
        let h = try ProviderTransportHarness()
        let snapshot = try await h.selectClaude()
        let context = try #require(snapshot.providerContext)
        let selection = try providerTransportSelection(snapshot), router = h.router
        await h.peer.block("select")
        let request = Task { try await router.request(type: "select", payload: selection.data(), expectedContext: context) }
        #expect(await providerTransportWait("select", peer: h.peer))
        await h.access.replace(PetProviderServiceAccess(generation: 2, credential: String(repeating: "8", count: 64)))
        await h.peer.release("select")
        await providerTransportReject { _ = try await request.value }
        await providerTransportReject { _ = try await h.router.request(type: "select", payload: selection.data(), expectedContext: context) }
        #expect(await h.peer.allCalls().filter { $0.operation == "select" }.count == 1)
    }

    @Test("Returning to the identical A context cannot accept an earlier connection-control reply",
          arguments: ["readiness.begin", "disconnect"])
    func connectionControlGeneration(_ operation: String) async throws {
        let h = try ProviderTransportHarness()
        let original = try await h.selectClaude()
        let context = try #require(original.providerContext), router = h.router
        await h.peer.block(operation)
        let pending = Task {
            if operation == "disconnect" { try await router.disconnect(context) }
            else { try await router.checkConnection(context) }
        }
        #expect(await providerTransportWait(operation, peer: h.peer))
        let b = try #require(original.providerSessions.first { $0.context.scopeID == h.native[1].grant.scope.scopeID })
        try await router.selectSession(b)
        let middle = try await h.read()
        let a = try #require(middle.providerSessions.first { $0.context == context })
        try await router.selectSession(a)
        #expect(try await h.read().providerContext == context)
        await h.peer.release(operation)
        await providerTransportReject { try await pending.value }
    }

    @Test("Codex outcome decoding is fenced across an A to Claude to A switch")
    func codexOutcomeGeneration() async throws {
        let h = try ProviderTransportHarness()
        let original = try await h.read()
        let context = try #require(original.providerContext)
        let selection = try providerTransportSelection(original, id: "selection_codex_receipt")
        let data = try await h.router.request(type: "select", payload: selection.data(), expectedContext: context)
        let router = h.router
        await h.peer.block("outcome")
        let pending = Task { try await router.selectionOutcome(data, request: selection, expectedContext: context) }
        #expect(await providerTransportWait("outcome", peer: h.peer))
        try await router.selectSession(try #require(original.providerSessions.first { $0.context.provider == .claude }))
        let middle = try await h.read()
        try await router.selectSession(try #require(middle.providerSessions.first { $0.context.provider == .codex }))
        #expect(try await h.read().providerContext == context)
        await h.peer.release("outcome")
        await providerTransportReject { _ = try await pending.value }
    }

    @Test("Nil-context mutations require truly absent owned access; snapshot receipts are one-use")
    func legacyBoundaryAndSnapshotReceipt() async throws {
        let h = try ProviderTransportHarness()
        let data = try PetFocusRequest(identity: PetInteractionIdentity(jsonObject: petTestIdentityObject(PetTestCard(suffix: "provider_codex")))).data()
        await providerTransportReject { _ = try await h.router.request(type: "focus_interaction", payload: data) }
        #expect(await h.peer.allCalls().isEmpty)
        let receipt = try await h.router.request(type: "get_state", payload: Data("{}".utf8))
        _ = try await h.router.decodeSnapshot(receipt)
        await providerTransportReject { _ = try await h.router.decodeSnapshot(receipt) }
        let legacy = try ProviderTransportHarness(owned: false)
        let response = try await legacy.router.request(type: "focus_interaction", payload: data)
        try PetTransportResponse.requireFocused(response)
        #expect(await legacy.peer.allCalls().map(\.type) == ["focus_interaction"])
    }

    @Test("An older overlapping snapshot cannot replace the newest context, readiness row or actionable cache")
    func overlappingSnapshots() async throws {
        let h = try ProviderTransportHarness()
        let initial = try await h.selectClaude()
        let context = try #require(initial.providerContext), router = h.router
        // Snapshot A captures a valid but unready projection, then waits on its
        // private reply. Only that request is blocked; snapshot B can complete.
        try await h.peer.updateProjection(context, generation: 1, ready: false)
        await h.peer.blockNext("snapshot")
        let old = Task {
            try await router.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
        }
        let peer = h.peer
        defer { Task { await peer.release("snapshot") } }
        let waiting = await providerTransportWait("snapshot", peer: h.peer)
        guard waiting else {
            await h.peer.release("snapshot")
            _ = try? await old.value
            Issue.record("The older snapshot did not reach its reply gate")
            return
        }
        try await h.peer.updateProjection(context, generation: 2, ready: true)
        let newest = try await h.read()
        let newestContext = try #require(newest.providerContext)
        #expect(newestContext.scopeID == context.scopeID && newestContext.uiGeneration == 2)
        #expect(newest.providerStatus?.selectionEnabled == true)
        let newestRow = try #require(newest.providerSessions.first { $0.context == newestContext })
        #expect(newestRow.state == "ready")
        await h.peer.release("snapshot")
        await providerTransportReject { _ = try await old.value }

        // This uses the actor's cached card directly, without a refresh that
        // could conceal a late overwrite. An unready A cache would reject it.
        let selection = try providerTransportSelection(newest)
        let receipt = try await router.request(type: "select", payload: selection.data(), expectedContext: newestContext)
        #expect(try await router.selectionOutcome(receipt, request: selection, expectedContext: newestContext) == .channelPending)
        // selectSession checks exact directory equality; a late sessions.map
        // changing this row to "required" must not survive either.
        try await router.selectSession(newestRow)
    }

    @Test("An explicit directory-failure fallback retains Codex actions and pins the exact service access",
          arguments: ["credential", "generation", "disappeared"])
    func pinnedLegacyFallback(_ change: String) async throws {
        let h = try ProviderTransportHarness()
        await h.peer.failDirectory()
        let snapshot = try await h.read()
        #expect(snapshot.providerContext == nil && snapshot.providerDiagnostic != nil)
        #expect(!snapshot.interactions.isEmpty)
        let calls = await h.peer.allCalls()
        #expect(calls.map(\.type) == ["pet_directory_v1", "get_state"])
        let selection = try providerTransportSelection(snapshot, id: "selection_legacy_fallback")
        let focus = try await h.router.request(type: "focus_interaction",
            payload: PetFocusRequest(identity: selection.identity).data(), expectedContext: nil)
        try PetTransportResponse.requireFocused(focus)
        let receipt = try await h.router.request(type: "select", payload: selection.data(), expectedContext: nil)
        #expect(try await h.router.selectionOutcome(receipt, request: selection, expectedContext: nil) == .nextTurn)
        let successful = await h.peer.allCalls()
        #expect(successful.filter { $0.type == "select" }.count == 1)
        #expect(!successful.contains { $0.type == "pet_provider_v1" })

        switch change {
        case "credential":
            await h.access.replace(PetProviderServiceAccess(generation: 1, credential: String(repeating: "8", count: 64)))
        case "generation":
            await h.access.replace(PetProviderServiceAccess(generation: 2, credential: providerTransportCredential))
        default: await h.access.replace(nil)
        }
        await h.peer.clearCalls()
        await providerTransportReject {
            _ = try await h.router.request(type: "focus_interaction",
                payload: PetFocusRequest(identity: selection.identity).data(), expectedContext: nil)
        }
        await providerTransportReject {
            _ = try await h.router.selectionOutcome(receipt, request: selection, expectedContext: nil)
        }
        #expect(await h.peer.allCalls().isEmpty)
    }
}
