import Foundation
import Testing
@testable import BlabeeCoordinator

private func providerUISession(_ provider: PetProvider, suffix: String) -> PetProviderSession {
    let context = PetProviderContext(provider: provider, scopeID: UUID().uuidString.lowercased(),
        serviceIncarnation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sessionIncarnation: UUID().uuidString.lowercased(),
        authorityEpoch: provider == .claude ? UUID().uuidString.lowercased() : nil, uiGeneration: 1)
    return PetProviderSession(id: suffix, context: context, projectID: "project_\(suffix)",
        sessionID: "session_\(suffix)", cwd: "/tmp/\(suffix)", state: "ready",
        title: "\(provider.displayName) · \(suffix)")
}

private func providerUISnapshot(
    _ selected: PetProviderSession, sessions: [PetProviderSession], card: PetTestCard? = nil
) throws -> PetSnapshot {
    var snapshot = try PetSnapshot.parse(petTestSnapshotData(
        cards: card.map { [$0] } ?? [], foregroundSuffix: card?.suffix))
    snapshot.providerSessions = sessions
    snapshot.providerContext = selected.context
    if selected.context.provider == .claude {
        snapshot.providerStatus = PetProviderStatus(provider: .claude, scopeID: selected.context.scopeID,
            sessionID: selected.sessionID, cwd: selected.cwd, bridgeConnected: true,
            ready: true, selectionEnabled: true, latestOutcome: nil)
    }
    return snapshot
}

/// Deliberately returns late successes without reinterpreting their context.
/// The view model must reject these even without an AppService generation.
private actor ProviderUITransport: PetProviderControlling {
    struct Request: Sendable {
        let type: String
        let payload: Data
        let context: PetProviderContext?
    }
    private var selectedScope: String
    private var snapshots: [String: PetSnapshot]
    private(set) var requests: [Request] = []
    private(set) var controls: [(String, PetProviderContext)] = []
    private var blocked: Set<String> = []
    private var waiters: [String: [CheckedContinuation<Void, any Error>]] = [:]
    private var rejectNextSnapshot = false

    init(snapshots: [PetSnapshot]) {
        self.snapshots = Dictionary(uniqueKeysWithValues: snapshots.map { ($0.providerContext!.scopeID, $0) })
        selectedScope = snapshots[0].providerContext!.scopeID
    }
    func setSnapshot(_ snapshot: PetSnapshot) { snapshots[snapshot.providerContext!.scopeID] = snapshot }
    func failNextSnapshot() { rejectNextSnapshot = true }
    func key(_ type: String, _ context: PetProviderContext) -> String { type + ":" + context.scopeID }
    func block(_ type: String, context: PetProviderContext) { blocked.insert(key(type, context)) }
    func isWaiting(_ type: String, context: PetProviderContext) -> Bool {
        !(waiters[key(type, context)]?.isEmpty ?? true)
    }
    func release(_ type: String, context: PetProviderContext, fails: Bool = false) {
        let key = key(type, context)
        blocked.remove(key)
        let continuations = waiters.removeValue(forKey: key) ?? []
        for continuation in continuations {
            if fails { continuation.resume(throwing: PetTestError.injected("old_provider_failure")) }
            else { continuation.resume() }
        }
    }
    private func suspendIfNeeded(_ type: String, context: PetProviderContext?) async throws {
        guard let context else { return }
        let key = key(type, context)
        guard blocked.contains(key) else { return }
        try await withCheckedThrowingContinuation { waiters[key, default: []].append($0) }
    }
    func request(type: String, payload: Data) async throws -> Data {
        try await request(type: type, payload: payload, expectedContext: nil)
    }
    func request(type: String, payload: Data, expectedContext: PetProviderContext?) async throws -> Data {
        requests.append(Request(type: type, payload: payload, context: expectedContext))
        if type == "get_state" {
            if rejectNextSnapshot {
                rejectNextSnapshot = false
                throw PetTestError.injected("selected_provider_unavailable")
            }
            return Data(selectedScope.utf8)
        }
        guard expectedContext != nil else { throw PetTestError.injected("missing_provider_context") }
        try await suspendIfNeeded(type, context: expectedContext)
        if type == "focus_interaction" { return try petTestFocusResponse() }
        return Data("{}".utf8)
    }
    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        guard let snapshot = snapshots[String(decoding: data, as: UTF8.self)] else {
            throw PetTestError.injected("unknown_provider_snapshot")
        }
        return snapshot
    }
    func selectionOutcome(_ data: Data, request: PetSelectionRequest,
                          expectedContext: PetProviderContext?) async throws -> PetSelectionOutcome {
        requests.append(Request(type: "outcome", payload: try request.data(), context: expectedContext))
        try await suspendIfNeeded("outcome", context: expectedContext)
        return expectedContext?.provider == .claude ? .channelPending : .nextTurn
    }
    func selectSession(_ session: PetProviderSession) async throws { selectedScope = session.context.scopeID }
    func checkConnection(_ expectedContext: PetProviderContext) async throws {
        controls.append(("check", expectedContext))
        try await suspendIfNeeded("check", context: expectedContext)
    }
    func disconnect(_ expectedContext: PetProviderContext) async throws {
        controls.append(("disconnect", expectedContext))
    }
    func count(_ type: String) -> Int { requests.filter { $0.type == type }.count }
}

private func providerUIWait(
    _ type: String, context: PetProviderContext, transport: ProviderUITransport
) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await transport.isWaiting(type, context: context) { return true }
        await Task.yield()
    }
    return await transport.isWaiting(type, context: context)
}

@Suite("Common Pet provider controls and action isolation")
@MainActor
struct PetProviderUITests {
    @Test("Codex pool and multiple Claude sessions keep app settings and exact connection controls")
    func controlsAndSettings() async throws {
        let sessions = [providerUISession(.codex, suffix: "codex"),
                        providerUISession(.claude, suffix: "a"), providerUISession(.claude, suffix: "b")]
        let snapshots = try sessions.map { try providerUISnapshot($0, sessions: sessions) }
        let transport = ProviderUITransport(snapshots: snapshots)
        var starts = 0
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 startClaude: { starts += 1 })
        model.applySnapshotForTesting(snapshots[0])
        #expect(model.provider == .codex && model.supportsProductSettings && model.canStartClaude)
        await model.selectProviderSession(sessions[1])
        #expect(model.provider == .claude && model.supportsProductSettings)
        #expect(!model.supportsDecisionDismissal && model.providerSessions.count == 3)
        await model.checkClaudeConnection()
        await model.disconnectClaudeSession()
        let controls = await transport.controls
        #expect(controls.map(\.0) == ["check", "disconnect"])
        #expect(controls.allSatisfy { $0.1 == sessions[1].context })
        await model.startClaudeSession()
        #expect(starts == 1 && model.providerSessions.count == 3)
        await model.selectProviderSession(sessions[0])
        #expect(model.provider == .codex && model.supportsDecisionDismissal)

        let standalone = PetViewModel(transport: PetFakeTransport(),
            externalApplicationOpener: PetFakeApplicationOpener(), provider: .claude)
        #expect(!standalone.supportsProviderSessions && !standalone.supportsProductSettings)
        #expect(!standalone.canStartClaude)
    }

    @Test("A to B to A cannot revive a rendered control from the old local generation")
    func returningToSameContextStaysFenced() async throws {
        let sessions = [providerUISession(.claude, suffix: "a"), providerUISession(.claude, suffix: "b")]
        let snapshots = try sessions.map { try providerUISnapshot($0, sessions: sessions) }
        let transport = ProviderUITransport(snapshots: snapshots)
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.applySnapshotForTesting(snapshots[0])
        let original = model.captureProviderActionContext()
        await model.selectProviderSession(sessions[1])
        await model.selectProviderSession(sessions[0])
        #expect(model.selectedProviderContext == original.expectedContext)
        #expect(!model.acceptsProviderAction(original))
        await model.disconnectClaudeSession(context: original)
        #expect(await transport.controls.isEmpty)
    }

    @Test("A late same-card focus cannot clear another Claude session's pending focus", arguments: [false, true])
    func lateFocus(_ fails: Bool) async throws {
        let sessions = [providerUISession(.claude, suffix: "a"), providerUISession(.claude, suffix: "b")]
        let card = PetTestCard(suffix: "identical", rankedActionCount: 2)
        let snapshots = try sessions.map { try providerUISnapshot($0, sessions: sessions, card: card) }
        let transport = ProviderUITransport(snapshots: snapshots)
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.applySnapshotForTesting(snapshots[0])
        let identity = try #require(model.displayInteraction?.identity)
        await transport.block("focus_interaction", context: sessions[0].context)
        let old = Task { await model.focus(identity) }
        #expect(await providerUIWait("focus_interaction", context: sessions[0].context, transport: transport))
        await model.selectProviderSession(sessions[1])
        await transport.block("focus_interaction", context: sessions[1].context)
        let current = Task { await model.focus(identity) }
        #expect(await providerUIWait("focus_interaction", context: sessions[1].context, transport: transport))
        let reads = await transport.count("get_state")
        await transport.release("focus_interaction", context: sessions[0].context, fails: fails)
        await old.value
        #expect(model.pendingFocusIdentity == identity && model.lastError == nil)
        #expect(model.selectedProviderContext == sessions[1].context)
        #expect(await transport.count("get_state") == reads)
        await transport.release("focus_interaction", context: sessions[1].context)
        await current.value
        #expect(model.focusedInteraction?.identity == identity)
    }

    @Test("Late selection and outcome success never publish acceptance after switching providers", arguments: ["select", "outcome"])
    func lateSelection(_ blockedStage: String) async throws {
        let sessions = [providerUISession(.claude, suffix: "a"), providerUISession(.codex, suffix: "codex")]
        let card = PetTestCard(suffix: "identical", rankedActionCount: 2)
        let snapshots = try sessions.map { try providerUISnapshot($0, sessions: sessions, card: card) }
        let transport = ProviderUITransport(snapshots: snapshots)
        let opener = PetFakeApplicationOpener()
        let model = PetViewModel(transport: transport, externalApplicationOpener: opener)
        model.applySnapshotForTesting(snapshots[0])
        await model.focus(try #require(model.displayInteraction?.identity))
        var accepted = 0
        model.onUsageAccepted = { _ in accepted += 1 }
        await transport.block(blockedStage, context: sessions[0].context)
        let old = Task { await model.requestPanelSelection(1) }
        #expect(await providerUIWait(blockedStage, context: sessions[0].context, transport: transport))
        await model.selectProviderSession(sessions[1])
        let reads = await transport.count("get_state")
        await transport.release(blockedStage, context: sessions[0].context)
        await old.value
        #expect(accepted == 0 && opener.opened.isEmpty && model.lastError == nil)
        #expect(model.provider == .codex && model.selectionSubmission == nil)
        #expect(await transport.count("get_state") == reads)
        let selection = try #require(await transport.requests.first { $0.type == "select" })
        #expect(selection.context == sessions[0].context)
        #expect(UUID(uuidString: try #require(petTestObject(selection.payload)["selection_id"] as? String)) != nil)
        if blockedStage == "outcome" {
            let outcome = try #require(await transport.requests.first { $0.type == "outcome" })
            #expect(outcome.context == selection.context)
        } else { #expect(await transport.count("outcome") == 0) }
    }

    @Test("A new authority or UI generation invalidates queued keys with identical card identities")
    func changedContextInvalidatesQueuedHotkey() async throws {
        let session = providerUISession(.claude, suffix: "a")
        let card = PetTestCard(suffix: "same_card", rankedActionCount: 2)
        let original = try providerUISnapshot(session, sessions: [session], card: card)
        let transport = ProviderUITransport(snapshots: [original])
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.applySnapshotForTesting(original)
        await model.focus(try #require(model.displayInteraction?.identity))
        model.handleShortcut(.slot1)
        var replacement = original
        replacement.providerContext = PetProviderContext(provider: .claude, scopeID: session.context.scopeID,
            serviceIncarnation: session.context.serviceIncarnation, sessionIncarnation: session.context.sessionIncarnation,
            authorityEpoch: session.context.authorityEpoch, uiGeneration: 2)
        model.applySnapshotForTesting(replacement)
        for _ in 0..<5 { await Task.yield() }
        #expect(await transport.count("select") == 0)
        #expect(model.localForegroundIdentity == nil)
    }

    @Test("A selected Claude read failure retains all sessions and disables stale card actions")
    func localFailureRetainsDirectory() async throws {
        let sessions = [providerUISession(.claude, suffix: "a"), providerUISession(.codex, suffix: "codex")]
        let snapshots = try sessions.map { try providerUISnapshot($0, sessions: sessions,
            card: PetTestCard(suffix: "a", rankedActionCount: 2)) }
        let transport = ProviderUITransport(snapshots: snapshots)
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.applySnapshotForTesting(snapshots[0])
        await transport.failNextSnapshot()
        await model.refresh()
        #expect(model.providerSessions == sessions && model.providerReadFailed)
        #expect(!model.canRequestPanelSelection(try #require(model.displayInteraction?.identity)))
        #expect(model.canControlClaudeConnection)
        await model.selectProviderSession(sessions[1])
        #expect(model.provider == .codex && !model.providerReadFailed && model.lastError == nil)
    }

    @Test("A late outcome for A cannot alter a newer C card in the same Claude scope")
    func lateOutcomePreservesSuccessor() async throws {
        let session = providerUISession(.claude, suffix: "a")
        let original = try providerUISnapshot(session, sessions: [session],
            card: PetTestCard(suffix: "original", rankedActionCount: 2))
        let transport = ProviderUITransport(snapshots: [original])
        let opener = PetFakeApplicationOpener()
        let model = PetViewModel(transport: transport, externalApplicationOpener: opener)
        model.applySnapshotForTesting(original)
        await model.focus(try #require(model.displayInteraction?.identity))
        await transport.block("outcome", context: session.context)
        let old = Task { await model.requestPanelSelection(1) }
        #expect(await providerUIWait("outcome", context: session.context, transport: transport))
        var successor = try providerUISnapshot(session, sessions: [session],
            card: PetTestCard(suffix: "successor", rankedActionCount: 2))
        successor.providerContext = PetProviderContext(provider: .claude, scopeID: session.context.scopeID,
            serviceIncarnation: session.context.serviceIncarnation, sessionIncarnation: session.context.sessionIncarnation,
            authorityEpoch: session.context.authorityEpoch, uiGeneration: 2)
        model.applySnapshotForTesting(successor)
        let identity = try #require(model.displayInteraction?.identity)
        await transport.release("outcome", context: session.context)
        await old.value
        #expect(model.displayInteraction?.identity == identity && model.lastTerminalPresentation == nil)
        #expect(model.selectionSubmission == nil && model.lastError == nil && opener.opened.isEmpty)
    }

    @Test("Codex keeps its selection ID contract through the context-bound router")
    func codexSelectionIdentity() async throws {
        let session = providerUISession(.codex, suffix: "codex")
        let snapshot = try providerUISnapshot(session, sessions: [session],
            card: PetTestCard(suffix: "codex", rankedActionCount: 2))
        let transport = ProviderUITransport(snapshots: [snapshot])
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 selectionIDGenerator: { "selection_existing_contract" })
        model.applySnapshotForTesting(snapshot)
        await model.focus(try #require(model.displayInteraction?.identity))
        await model.requestPanelSelection(1)
        let requests = await transport.requests
        let selection = try #require(requests.first { $0.type == "select" })
        #expect(try petTestObject(selection.payload)["selection_id"] as? String == "selection_existing_contract")
        #expect(selection.context == session.context)
    }

    @Test("A Claude selection cannot activate the previous provider's captured app")
    func selectionReturnAppDoesNotCrossProviders() async throws {
        let sessions = [providerUISession(.codex, suffix: "codex"), providerUISession(.claude, suffix: "claude")]
        let snapshots = try sessions.map { try providerUISnapshot($0, sessions: sessions,
            card: PetTestCard(suffix: "shared_identity", rankedActionCount: 2)) }
        let transport = ProviderUITransport(snapshots: snapshots)
        let opener = PetFakeApplicationOpener()
        let model = PetViewModel(transport: transport, externalApplicationOpener: opener, processIdentifier: 999)
        model.applySnapshotForTesting(snapshots[0])
        await model.focus(try #require(model.displayInteraction?.identity))
        // The Pet itself is now frontmost, so the next provider cannot capture
        // a return application. An earlier Codex capture must not survive.
        opener.captured = PetExternalApplicationReference(processIdentifier: 999, localizedName: "Pet")
        await model.selectProviderSession(sessions[1])
        var accepted = 0
        model.onUsageAccepted = { _ in accepted += 1 }
        await model.focusAndRequestPanelSelection(1, interaction: try #require(model.displayInteraction?.identity))
        #expect(accepted == 1 && opener.opened.isEmpty)
    }

    @Test("Claude startup failures use safe Korean copy without reflecting unknown errors", arguments: [true, false])
    func safeClaudeStartFailure(_ knownFailure: Bool) async throws {
        let session = providerUISession(.codex, suffix: "codex")
        let snapshot = try providerUISnapshot(session, sessions: [session])
        let transport = ProviderUITransport(snapshots: [snapshot])
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(), startClaude: {
            if knownFailure { throw PetClaudeLauncher.Failure.payloadUnavailable }
            throw PetTestError.injected("private_native_launch_details")
        })
        model.applySnapshotForTesting(snapshot)
        await model.startClaudeSession()
        #expect(model.lastError == (knownFailure ? PetClaudeLauncher.Failure.payloadUnavailable.errorDescription
            : "Claude 시작 요청을 확인하지 못했어요."))
        #expect(!model.isStartingClaude && model.canStartClaude)
        #expect(await transport.count("get_state") == 0)
    }
}
