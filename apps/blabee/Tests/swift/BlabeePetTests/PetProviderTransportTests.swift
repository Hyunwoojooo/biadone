import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private let providerTransportService = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
private let providerTransportCredential = String(repeating: "9", count: 64)

private final class ProviderTransportClock: @unchecked Sendable {
    private let lock = NSLock()
    private var now: UInt64 = 0
    func current() -> UInt64 { lock.withLock { now } }
    func advance(milliseconds: UInt64) { lock.withLock { now += milliseconds * 1_000_000 } }
}

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
    enum Corruption: String, Sendable, CaseIterable { case requestID, provider, generation, selection, dismissal }
    struct Call: Sendable {
        let type: String
        let operation: String?
        let provider: String?
        let scope: String?
        let data: Data
        let admittedAtNanoseconds: UInt64?
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
    private let arrivals = PetEventArrivalLedger()
    private var inboxUnavailable = false
    private let clock: ProviderTransportClock?
    private var snapshotDelays: [String: UInt64] = [:]

    init(seeds: [ProviderTransportSeed], clock: ProviderTransportClock? = nil) throws {
        self.seeds = seeds
        self.clock = clock
        codexSnapshot = try petTestSnapshotData(cards: [PetTestCard(suffix: "provider_codex", rankedActionCount: 2)],
            foregroundSuffix: "provider_codex")
        // Simulate service admission before any UI polling: Claude B arrives,
        // then Codex, then Claude A. Directory iteration has a different order.
        for seed in seeds.reversed() {
            let row = try StrictJSONTransport.object(from: seed.row)
            let snapshot = try ClaudePetSnapshotProjector(scopeID: seed.context.scopeID,
                projectID: row["project_id"] as! String, sessionID: row["session_id"] as! String,
                cwd: row["cwd"] as! String, product: true).project(StrictJSONTransport.object(from: seed.projection))
            for event in snapshot.queuedEvents {
                _ = arrivals.record(scopeID: seed.context.scopeID, kind: event.reference.kind.rawValue,
                    eventID: event.reference.eventID)
            }
            if seed.context == seeds.last?.context {
                for event in try PetSnapshot.parse(codexSnapshot).queuedEvents {
                    _ = arrivals.record(scopeID: "codex-primary", kind: event.reference.kind.rawValue,
                        eventID: event.reference.eventID)
                }
            }
        }
    }
    func allCalls() -> [Call] { calls }
    func clearCalls() { calls.removeAll() }
    func unavailable(_ context: PetProviderContext) { unavailableScopes.insert(context.scopeID) }
    func available(_ context: PetProviderContext) { unavailableScopes.remove(context.scopeID) }
    func corrupt(_ operation: String, with corruption: Corruption) { corruptions[operation] = corruption }
    func replaceCredential(_ value: String) { expectedCredential = value }
    func failDirectory() { directoryUnavailable = true }
    func failInbox() { inboxUnavailable = true }
    func forgetArrival(_ context: PetProviderContext) { arrivals.removeScope(context.scopeID) }
    func forgetArrival(scopeID: String) { arrivals.removeScope(scopeID) }
    func delaySnapshot(scopeID: String, milliseconds: UInt64, unavailable: Bool = false) {
        snapshotDelays[scopeID] = milliseconds
        if unavailable { unavailableScopes.insert(scopeID) }
    }
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
        if !["pet_provider_v1", "pet_directory_v1", "pet_inbox_v1"].contains(type) {
            calls.append(Call(type: type, operation: nil, provider: nil, scope: nil, data: payload,
                admittedAtNanoseconds: clock?.current()))
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
            scope: target?["scope_id"] as? String, data: payload, admittedAtNanoseconds: clock?.current()))
        if type == "pet_inbox_v1" {
            let queries = try PetProviderInboxCodec.validateRequest(envelope)
            if inboxUnavailable { throw PetTestError.injected("provider_inbox_unavailable") }
            let sequences = queries.map {
                arrivals.sequence(scopeID: $0.context.scopeID, kind: $0.reference.kind.rawValue,
                    eventID: $0.reference.eventID)
            }
            let resultData = try PetProviderInboxCodec.response(request: envelope, sequences: sequences)
            await suspend(operation)
            return resultData
        }
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
            if let milliseconds = snapshotDelays[scope] { clock?.advance(milliseconds: milliseconds) }
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
        case "dismiss_interaction":
            result = ["dismissal": input, "dismissed": true]
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
            case .dismissal:
                var changed = result
                var dismissal = input; dismissal["interaction_id"] = "different-interaction"
                changed["dismissal"] = dismissal; output["result"] = changed
            }
        }
        let outputData = try StrictJSONTransport.data(forJSONObject: output)
        await suspend(operation + ":" + scope)
        await suspend(operation)
        return outputData
    }

    func selectionOutcome(_ data: Data, request: PetSelectionRequest) async throws -> PetSelectionOutcome {
        calls.append(Call(type: "selectionOutcome", operation: "outcome", provider: "codex", scope: nil, data: data,
            admittedAtNanoseconds: clock?.current()))
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
    init(owned: Bool = true, claudeCount: Int = 2, clock: ProviderTransportClock? = nil) throws {
        native = try (0..<claudeCount).map { _ in try ClaudePetFixture() }
        let seeds = try native.enumerated().map { try providerTransportSeed($0.element, index: $0.offset) }
        peer = try ProviderTransportPeer(seeds: seeds, clock: clock)
        access = ProviderTransportAccess(owned ? PetProviderServiceAccess(generation: 1, credential: providerTransportCredential) : nil)
        if let clock {
            router = PetProviderTransport(codex: peer, access: { [access] in await access.current() },
                monotonicNow: { clock.current() })
        } else { router = PetProviderTransport(codex: peer, access: { [access] in await access.current() }) }
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
    @Test("Every provider is polled into one inbox without changing the selected projection")
    func allProviderInboxKeepsSelectedProjection() async throws {
        let h = try ProviderTransportHarness()
        let codex = try await h.read()
        #expect(codex.providerContext?.provider == .codex && codex.providerSessions.count == 3)
        #expect(codex.providerDirectory == PetProviderDirectoryStatus(serviceGeneration: 1,
            serviceIncarnation: providerTransportService))
        let initialCalls = await h.peer.allCalls()
        #expect(initialCalls.first?.type == "pet_directory_v1")
        let initialInbox = try #require(codex.providerInbox)
        #expect(initialInbox.arrivalOrderComplete)
        #expect(initialInbox.entries.map(\.context.scopeID) == [h.native[1].grant.scope.scopeID,
            "codex-primary", h.native[0].grant.scope.scopeID])
        #expect(initialInbox.entries.map(\.arrivalSequence) == [1, 2, 3])
        #expect(initialInbox.sessions.count == 3)
        #expect(initialInbox.sessions.filter { $0.session.context.provider == .claude }.allSatisfy {
            $0.status?.ready == true && $0.diagnostic == nil
        })
        let selected = try #require(codex.providerSessions.first { $0.context.provider == .claude })
        let native = try #require(h.native.first { $0.grant.scope.scopeID == selected.context.scopeID })
        #expect(selected.nativeSessionID == native.grant.scope.sessionID)
        #expect(codex.providerSessions.first { $0.context.provider == .codex }?.nativeSessionID == nil)
        try await h.router.selectSession(selected)
        await h.peer.clearCalls()
        let claude = try await h.read()
        #expect(claude.providerContext == selected.context && claude.interactions.count == 1)
        #expect(claude.providerSessions.first { $0.id == selected.id }?.nativeSessionID == selected.nativeSessionID)
        #expect(claude.permissionRequests.isEmpty && claude.managedCommandApprovals.isEmpty)
        let calls = await h.peer.allCalls()
        #expect(!calls.contains { $0.type == "get_state" })
        #expect(calls.filter { $0.operation == "snapshot" }.count == 3)
        #expect(Set(calls.filter { $0.operation == "snapshot" }.compactMap(\.scope)) ==
            Set(["codex-primary"] + h.native.map { $0.grant.scope.scopeID }))
        #expect(claude.providerInbox?.entries.map(\.id) == initialInbox.entries.map(\.id))
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
        #expect(unavailable.providerDirectory?.serviceIncarnation == providerTransportService)
        #expect(unavailable.providerInbox?.entries.count == 3)
        #expect(unavailable.providerInbox?.entries.contains { $0.context == a.context } == true)
        #expect(unavailable.providerInbox?.sessions.first { $0.session.context == a.context }?.diagnostic != nil)
        let originalEntry = try #require(initial.providerInbox?.entries.first { $0.context == a.context })
        #expect(unavailable.providerInbox?.entries.first { $0.context == a.context }?.id == originalEntry.id)
        let selection = try providerTransportSelection(unavailable)
        await providerTransportReject {
            _ = try await h.router.request(type: "select", payload: selection.data(), expectedContext: a.context)
        }
        await h.peer.available(a.context)
        let recovered = try await h.read()
        #expect(recovered.providerContext == a.context && recovered.providerStatus?.selectionEnabled == true)
        #expect(recovered.providerInbox?.entries.first { $0.context == a.context }?.id == originalEntry.id)
        let b = try #require(unavailable.providerSessions.first { $0.context.scopeID == h.native[1].grant.scope.scopeID })
        try await h.router.selectSession(b)
        let other = try await h.read()
        #expect(other.providerStatus?.selectionEnabled == true && other.providerDiagnostic == nil)
        let codex = try #require(other.providerSessions.first { $0.context.provider == .codex })
        try await h.router.selectSession(codex)
        #expect(try await h.read().providerContext?.provider == .codex)
    }

    @Test("A failed directory never reuses earlier service evidence with cached rows")
    func freshDirectoryEvidence() async throws {
        let h = try ProviderTransportHarness()
        let initial = try await h.selectClaude()
        #expect(initial.providerDirectory != nil)
        await h.peer.failDirectory()
        let unavailable = try await h.read()
        #expect(!unavailable.providerSessions.isEmpty)
        #expect(unavailable.providerDirectory == nil)
        #expect(unavailable.providerInbox == nil)
    }

    @Test("Missing admission metadata is deterministic and never invents polling-order admissions")
    func missingAdmissionSequenceIsExplicit() async throws {
        let h = try ProviderTransportHarness()
        let missingScope = h.native[0].grant.scope.scopeID
        await h.peer.forgetArrival(scopeID: missingScope)
        let partial = try #require(try await h.read().providerInbox)
        #expect(!partial.arrivalOrderComplete && partial.entries.count == 3)
        #expect(partial.entries.last?.context.scopeID == missingScope)
        #expect(partial.entries.last?.arrivalSequence == UInt64.max)
        await h.peer.failInbox()
        let unavailable = try #require(try await h.read().providerInbox)
        #expect(!unavailable.arrivalOrderComplete)
        #expect(unavailable.entries.map(\.arrivalSequence) == partial.entries.map(\.arrivalSequence))
        let repeated = try #require(try await h.read().providerInbox)
        #expect(repeated.entries.map(\.id) == unavailable.entries.map(\.id))
        let cold = try ProviderTransportHarness()
        await cold.peer.failInbox()
        #expect(try await cold.read().providerInbox?.entries.allSatisfy { $0.arrivalSequence == UInt64.max } == true)
    }

    @Test("Slow Claude scopes stay within one sweep budget and round-robin without losing the current card")
    func boundedSlowScopeSweepAndHeartbeat() async throws {
        let clock = ProviderTransportClock(), h = try ProviderTransportHarness(claudeCount: 3, clock: clock)
        let initial = try await h.selectClaude()
        let context = try #require(initial.providerContext)
        let initialID = try #require(initial.providerInbox?.entries.first { $0.context == context }?.id)
        for native in h.native {
            await h.peer.delaySnapshot(scopeID: native.grant.scope.scopeID, milliseconds: 500, unavailable: true)
        }
        await h.peer.clearCalls()
        for _ in 0..<2 {
            let began = clock.current()
            let snapshot = try await h.read()
            #expect(clock.current() - began <= 1_500_000_000)
            #expect(snapshot.providerContext == context && snapshot.providerStatus?.selectionEnabled == false)
            #expect(snapshot.providerInbox?.entries.first { $0.context == context }?.id == initialID)
            #expect(snapshot.providerInbox?.entries.count == 4)
            #expect(snapshot.providerInbox?.entries.contains { $0.context.provider == .codex } == true)
            clock.advance(milliseconds: 400)
        }
        let calls = await h.peer.allCalls()
        let snapshots = calls.filter { $0.operation == "snapshot" }
        #expect(Set(snapshots.filter { $0.provider == "claude" }.compactMap(\.scope)) ==
            Set(h.native.map { $0.grant.scope.scopeID }))
        #expect(snapshots.filter { $0.provider == "codex" }.count == 4)
        let heartbeats = snapshots.filter { $0.provider == "codex" }.compactMap(\.admittedAtNanoseconds)
        #expect(zip(heartbeats, heartbeats.dropFirst()).allSatisfy { $0.1 - $0.0 < 3_000_000_000 })
        #expect(!calls.contains { $0.operation == "select" || $0.type == "focus_interaction" })
    }

    @Test("A slow foreground cannot indefinitely exclude background scopes from the next sweep")
    func budgetPressureDoesNotStarveBackground() async throws {
        let clock = ProviderTransportClock(), h = try ProviderTransportHarness(claudeCount: 3, clock: clock)
        let initial = try await h.selectClaude()
        let context = try #require(initial.providerContext)
        await h.peer.delaySnapshot(scopeID: "codex-primary", milliseconds: 500)
        for native in h.native {
            await h.peer.delaySnapshot(scopeID: native.grant.scope.scopeID, milliseconds: 500, unavailable: true)
        }
        await h.peer.clearCalls()
        for _ in 0..<4 {
            let began = clock.current()
            let snapshot = try await h.read()
            #expect(clock.current() - began <= 2_000_000_000)
            #expect(snapshot.providerContext == context && snapshot.providerInbox?.entries.count == 4)
            clock.advance(milliseconds: 400)
        }
        let snapshots = await h.peer.allCalls().filter { $0.operation == "snapshot" }
        #expect(Set(snapshots.filter { $0.provider == "claude" }.compactMap(\.scope)) ==
            Set(h.native.map { $0.grant.scope.scopeID }))
        #expect(snapshots.filter { $0.provider == "codex" }.count == 8)
        let heartbeats = snapshots.filter { $0.provider == "codex" }.compactMap(\.admittedAtNanoseconds)
        #expect(zip(heartbeats, heartbeats.dropFirst()).allSatisfy { $0.1 - $0.0 < 3_000_000_000 })
    }

    @Test("Readiness generation changes preserve immutable inbox identity and admission order")
    func inboxIdentityExcludesReadinessGeneration() async throws {
        let h = try ProviderTransportHarness()
        let initial = try await h.read()
        let old = try #require(initial.providerInbox?.entries.first { $0.context.provider == .claude })
        try await h.peer.updateProjection(old.context, generation: 2, ready: true)
        let refreshed = try await h.read()
        let current = try #require(refreshed.providerInbox?.entries.first { $0.context.scopeID == old.context.scopeID })
        #expect(current.id == old.id && current.arrivalSequence == old.arrivalSequence)
        #expect(current.context.uiGeneration == 2 && current.context != old.context)
        #expect(refreshed.providerContext?.provider == .codex)
    }

    @Test("Codex settings use fresh Codex evidence while a Claude card is displayed")
    func codexSettingsRemainScopedToFreshCodexProjection() async throws {
        let h = try ProviderTransportHarness()
        let initial = try await h.selectClaude()
        let codex = try #require(initial.providerSessions.first { $0.context.provider == .codex })
        let expectedPaths: Set<String> = ["/tmp/blabee-pet-provider_codex"]
        #expect(initial.providerContext?.provider == .claude)
        #expect(initial.providerInbox?.codexSettings?.activeProjectPaths == expectedPaths)
        #expect(initial.providerInbox?.codexSettings?.receivedCardProjectPaths == expectedPaths)
        #expect(Set(initial.projects.map(\.cwd)).isDisjoint(with: expectedPaths))
        await h.peer.unavailable(codex.context)
        let failed = try await h.read()
        #expect(failed.providerContext == initial.providerContext)
        #expect(failed.providerInbox != nil && failed.providerInbox?.codexSettings == nil)
        #expect(!failed.projects.isEmpty)
        await h.peer.available(codex.context)
        let recovered = try await h.read()
        #expect(recovered.providerInbox?.codexSettings?.activeProjectPaths == expectedPaths)
        #expect(recovered.providerInbox?.codexSettings?.receivedCardProjectPaths == expectedPaths)
    }

    @Test("Session connection settings do not change the visible card's provider context")
    func controlsKeepVisibleProvider() async throws {
        let h = try ProviderTransportHarness()
        let initial = try await h.read()
        let claude = try #require(initial.providerSessions.first { $0.context.provider == .claude })
        await h.peer.clearCalls()
        try await h.router.checkSessionConnection(claude)
        try await h.router.disconnectSession(claude)
        #expect(try await h.read().providerContext == initial.providerContext)
        let calls = await h.peer.allCalls()
        #expect(calls.filter { $0.operation == "readiness.begin" }.map(\.scope) == [claude.context.scopeID])
        #expect(calls.filter { $0.operation == "disconnect" }.count == 1)
        #expect(!calls.contains { $0.type == "focus_interaction" || $0.operation == "select" })
    }

    @Test("An old background provider read cannot publish inbox contents after service replacement")
    func replacedServiceDuringBackgroundRead() async throws {
        let h = try ProviderTransportHarness()
        let initial = try await h.read()
        let claude = try #require(initial.providerSessions.last { $0.context.provider == .claude })
        let gate = "snapshot:" + claude.context.scopeID
        await h.peer.block(gate)
        let router = h.router
        let pending = Task { try await router.request(type: "get_state", payload: Data("{}".utf8)) }
        #expect(await providerTransportWait(gate, peer: h.peer))
        await h.access.replace(PetProviderServiceAccess(generation: 2, credential: String(repeating: "8", count: 64)))
        await h.peer.release(gate)
        await providerTransportReject { _ = try await pending.value }
        await providerTransportReject { try await router.selectSession(claude); try await router.checkConnection(claude.context) }
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

    @Test("Claude dismissal is scoped to the exact ready card and shares selection's mutation slot")
    func scopedDismissal() async throws {
        let h = try ProviderTransportHarness()
        let snapshot = try await h.selectClaude()
        let context = try #require(snapshot.providerContext)
        let selection = try providerTransportSelection(snapshot)
        let dismissal = PetDismissRequest(identity: selection.identity)
        await h.peer.clearCalls()
        var stale = dismissal.jsonObject; stale["revision"] = selection.identity.revision + 1
        let staleData = try petTestData(stale)
        await providerTransportReject {
            _ = try await h.router.request(type: "dismiss_interaction", payload: staleData, expectedContext: context)
        }
        #expect(await h.peer.allCalls().isEmpty)
        await h.peer.block("dismiss_interaction")
        let router = h.router
        let pending = Task { try await router.request(type: "dismiss_interaction", payload: dismissal.data(), expectedContext: context) }
        #expect(await providerTransportWait("dismiss_interaction", peer: h.peer))
        await providerTransportReject {
            _ = try await router.request(type: "select", payload: selection.data(), expectedContext: context)
        }
        await providerTransportReject {
            _ = try await router.request(type: "dismiss_interaction", payload: dismissal.data(), expectedContext: context)
        }
        await h.peer.release("dismiss_interaction")
        let receipt = try await pending.value
        try dismissal.requireDismissed(receipt)
        await providerTransportReject {
            _ = try await router.selectionOutcome(receipt, request: selection, expectedContext: context)
        }
        // The acknowledged old snapshot cannot authorize a subsequent select.
        await providerTransportReject {
            _ = try await router.request(type: "select", payload: selection.data(), expectedContext: context)
        }
        let calls = await h.peer.allCalls()
        #expect(calls.count == 1 && calls[0].operation == "dismiss_interaction")
        #expect(calls[0].provider == "claude" && calls[0].scope == context.scopeID)
        let envelope = try #require(petTestObject(calls[0].data)["envelope"] as? [String: Any])
        let input = try #require(envelope["payload"] as? [String: Any])
        #expect(Set(input.keys) == ["binding", "interaction_id", "packet_id", "revision"])
        #expect(try petTestData(input["binding"]!) == petTestData(selection.identity.binding.jsonObject))
    }

    @Test("Claude dismissal rejects foreign receipts and never retries automatically",
          arguments: [ProviderTransportPeer.Corruption.requestID, .provider, .generation, .dismissal])
    private func dismissalReceiptIsolation(_ corruption: ProviderTransportPeer.Corruption) async throws {
        let h = try ProviderTransportHarness()
        let snapshot = try await h.selectClaude()
        let context = try #require(snapshot.providerContext)
        let dismissal = PetDismissRequest(identity: try #require(snapshot.interactions.first?.identity))
        await h.peer.clearCalls()
        await h.peer.corrupt("dismiss_interaction", with: corruption)
        await providerTransportReject {
            _ = try await h.router.request(type: "dismiss_interaction", payload: dismissal.data(), expectedContext: context)
        }
        #expect(await h.peer.allCalls().filter { $0.operation == "dismiss_interaction" }.count == 1)
        #expect(await h.peer.allCalls().allSatisfy { $0.operation == "dismiss_interaction" })
    }

    @Test("Late dismissal receipts cannot survive service replacement or a session round trip",
          arguments: ["service", "session", "round_trip"])
    func dismissalGenerationFence(_ change: String) async throws {
        let h = try ProviderTransportHarness()
        let original = try await h.selectClaude()
        let context = try #require(original.providerContext)
        let dismissal = PetDismissRequest(identity: try #require(original.interactions.first?.identity))
        await h.peer.block("dismiss_interaction")
        let router = h.router
        let pending = Task { try await router.request(type: "dismiss_interaction", payload: dismissal.data(), expectedContext: context) }
        #expect(await providerTransportWait("dismiss_interaction", peer: h.peer))
        if change == "service" {
            await h.access.replace(PetProviderServiceAccess(generation: 2, credential: String(repeating: "8", count: 64)))
        } else {
            let other = try #require(original.providerSessions.first { $0.context.scopeID == h.native[1].grant.scope.scopeID })
            try await router.selectSession(other)
            let middle = try await h.read()
            if change == "round_trip" {
                try await router.selectSession(try #require(middle.providerSessions.first { $0.context == context }))
                _ = try await h.read()
            }
        }
        await h.peer.release("dismiss_interaction")
        await providerTransportReject { _ = try await pending.value }
        #expect(await h.peer.allCalls().filter { $0.operation == "dismiss_interaction" }.count == 1)
        #expect(!((await h.peer.allCalls()).contains { $0.operation == "select" }))
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
