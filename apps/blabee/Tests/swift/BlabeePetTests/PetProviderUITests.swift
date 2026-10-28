import Carbon
import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private func providerUISession(
    _ provider: PetProvider, suffix: String, state: String = "ready", native: UUID? = nil
) -> PetProviderSession {
    let context = PetProviderContext(provider: provider, scopeID: UUID().uuidString.lowercased(),
        serviceIncarnation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sessionIncarnation: UUID().uuidString.lowercased(),
        authorityEpoch: provider == .claude ? UUID().uuidString.lowercased() : nil, uiGeneration: 1)
    return PetProviderSession(id: suffix, context: context, projectID: "project_\(suffix)",
        sessionID: "session_\(suffix)", cwd: "/tmp/\(suffix)", state: state,
        title: "\(provider.displayName) · \(suffix)", nativeSessionID: native?.uuidString.lowercased())
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
            ready: selected.state == "ready", selectionEnabled: selected.state == "ready", latestOutcome: nil)
    }
    return snapshot
}

@MainActor
private func providerUIFocusSnapshot(
    _ session: PetProviderSession, card: PetTestCard, eventFocus: Bool,
    acknowledged: Bool = false, identityOverrides: [String: Any] = [:]
) throws -> PetSnapshot {
    // Keep a changed identity consistent in routing, interactions and session
    // metadata. These are fixture-only values, never a live service snapshot.
    func replacingIdentityFields(_ value: Any) -> Any {
        if let object = value as? [String: Any] {
            return object.reduce(into: [String: Any]()) { result, entry in
                result[entry.key] = identityOverrides[entry.key] ?? replacingIdentityFields(entry.value)
            }
        }
        if let array = value as? [Any] { return array.map(replacingIdentityFields) }
        return value
    }
    let object = replacingIdentityFields(petTestSnapshotObject(cards: [card], foregroundSuffix: card.suffix))
    var snapshot = try PetSnapshot.parse(petTestData(object))
    snapshot.providerSessions = [session]
    snapshot.providerContext = session.context
    if eventFocus {
        let events = snapshot.queuedEvents
        let focused = acknowledged ? events.first?.reference : nil
        snapshot.eventNavigation = try PetEventNavigationSnapshot(jsonObject: [
            "events": events.map { $0.reference.jsonObject },
            "focused": focused?.jsonObject as Any? ?? NSNull(),
            "revision": 1, "delivery_pending": false,
        ], availableEvents: events)
    }
    return snapshot
}

@MainActor
private final class ProviderSettingsOnboarding: PetOnboardingAdapting {
    let paths: [String]?
    init(paths: [String]?) { self.paths = paths }
    func serviceRegistrationState() -> PetServiceRegistrationState { .notRegistered }
    func configuredProjectPaths() throws -> [String] {
        guard let paths else { throw PetTestError.injected("configuration_unavailable") }
        return paths
    }
    func registerService() throws {}
    func unregisterService() async throws {}
    func openSystemSettingsLoginItems() {}
    func enableProject(at path: String) throws {}
    func disableProject(at path: String) throws {}
}

private struct ProviderUISuggestions: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .actionOnly, diagnostic: nil) }
    func save(_ mode: BlabeeSuggestionMode) {}
}

@MainActor
private final class ProviderUIServicePreferences: PetAppServicePreferenceStoring {
    var enabled = true
}

@MainActor
private final class ProviderUIServiceChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = true
    var petSelectorCredential: String? { "fixture-provider-credential" }
    var terminationSummary: String? { nil }
    func stop() async { isRunning = false }
}

@MainActor
private final class ProviderUIServiceLauncher: AppOwnedServiceLaunching {
    func launch() throws -> any AppOwnedServiceChild { ProviderUIServiceChild() }
}

@MainActor
private func providerUIService() -> PetAppServiceController {
    let service = PetAppServiceController(launcher: ProviderUIServiceLauncher(),
        preference: ProviderUIServicePreferences(), registration: { .notRegistered })
    service.startAtAppLaunch()
    service.receivedVerifiedSnapshot(generation: service.generation)
    return service
}

@MainActor
private func providerUIClaudeConnection() -> PetClaudeConnectionController {
    let inspection = ClaudeAutoConnectSetup.Inspection(isEnabled: true, canEnable: false,
        canDisable: true, detail: "fixture", canLaunch: true)
    return PetClaudeConnectionController(inspect: { inspection },
        enable: { inspection }, disable: { inspection })
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
    private(set) var selectedSessions: [PetProviderSession] = []
    private var blocked: Set<String> = []
    private var waiters: [String: [CheckedContinuation<Void, any Error>]] = [:]
    private var rejectNextSnapshot = false
    private var rejectNextDecode = false
    private var nextSelectionFailure: CoordinatorError?
    private var rejectedFocusScopes: Set<String> = []

    init(snapshots: [PetSnapshot]) {
        self.snapshots = Dictionary(uniqueKeysWithValues: snapshots.map { ($0.providerContext!.scopeID, $0) })
        selectedScope = snapshots[0].providerContext!.scopeID
    }
    func setSnapshot(_ snapshot: PetSnapshot) { snapshots[snapshot.providerContext!.scopeID] = snapshot }
    func failNextSnapshot() { rejectNextSnapshot = true }
    func failNextSnapshotDecode() { rejectNextDecode = true }
    func failNextSelection(_ failure: CoordinatorError) { nextSelectionFailure = failure }
    func failNextFocus(context: PetProviderContext) { rejectedFocusScopes.insert(context.scopeID) }
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
        if type == "select", let failure = nextSelectionFailure {
            nextSelectionFailure = nil
            throw failure
        }
        if type == "focus_interaction" || type == "focus_event" {
            if let context = expectedContext, rejectedFocusScopes.remove(context.scopeID) != nil {
                throw PetTestError.injected("response_timeout")
            }
            return try petTestFocusResponse()
        }
        if type == "dismiss_interaction" {
            let identity = try PetInteractionIdentity(jsonObject: petTestObject(payload))
            return try petTestData(["dismissed": true, "interaction_id": identity.interactionID,
                "packet_id": identity.packetID, "revision": identity.revision])
        }
        return Data("{}".utf8)
    }
    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        if rejectNextDecode {
            rejectNextDecode = false
            throw PetTestError.injected("selected_provider_snapshot_invalid")
        }
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
    func selectSession(_ session: PetProviderSession) async throws {
        selectedSessions.append(session)
        selectedScope = session.context.scopeID
    }
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

@MainActor
private func providerUIRecheckFixture(_ selectedProvider: PetProvider) async throws -> (
    model: PetViewModel, transport: ProviderUITransport, service: PetAppServiceController,
    selected: PetProviderSession, target: PetProviderSession, snapshot: PetSnapshot
) {
    let selected = providerUISession(selectedProvider, suffix: "recheck-shown")
    let service = providerUIService()
    let connection = providerUIClaudeConnection()
    let identity = PetClaudeConnectionController.ServiceIdentity(
        generation: service.generation, incarnation: selected.context.serviceIncarnation)
    var native: UUID?
    await connection.connect(terminal: .terminal, prepareService: { identity }, launch: { id, terminal in
        native = id
        return .init(nativeSessionID: id, project: URL(fileURLWithPath: "/tmp/recheck-target"), terminal: terminal)
    })
    let target = providerUISession(.claude, suffix: "recheck-target", state: "required",
        native: try #require(native))
    let snapshots = try unifiedUISnapshots([selected, target])
    let transport = ProviderUITransport(snapshots: snapshots)
    let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        claudeConnection: connection, appService: service, suggestionModeStore: ProviderUISuggestions())
    model.applySnapshotForTesting(snapshots[0])
    #expect(connection.observe(snapshot: snapshots[0], serviceGeneration: service.generation,
        serviceReady: true, readFailed: false, canSelect: true) == nil)
    #expect(connection.phase == .needsProbe && connection.matchedSession == target)
    return (model, transport, service, selected, target, snapshots[0])
}

private actor ProviderUIDeliveryRecheck: CodexPluginSetupManaging {
    private(set) var checks = 0
    func inspect() async -> CodexPluginSetupState { .installedNeedsHookReview(version: "0.1.3") }
    func recheckNativeExecutable() async -> CodexPluginSetupState {
        checks += 1
        return .installedNeedsHookReview(version: "0.1.3")
    }
    func connect() async -> CodexPluginSetupState { await inspect() }
    func disconnect() async -> CodexPluginSetupState { .notInstalled }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) async -> CodexPluginSetupState {
        await inspect()
    }
}

@MainActor
private func providerUIDeliveryFailure(_ provider: PetProvider) async throws -> (
    model: PetViewModel, transport: ProviderUITransport, session: PetProviderSession,
    notice: PetSelectionDeliveryNotice, recheck: ProviderUIDeliveryRecheck
) {
    let session = providerUISession(provider, suffix: "delivery_snapshot_recovery")
    let card = PetTestCard(suffix: "delivery_snapshot_recovery", rankedActionCount: 2)
    let initial = try providerUISnapshot(session, sessions: [session], card: card)
    let transport = ProviderUITransport(snapshots: [initial])
    let recheck = ProviderUIDeliveryRecheck()
    let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        codexPluginSetupManager: recheck)
    model.applySnapshotForTesting(initial)
    await model.focus(try #require(model.displayInteraction?.identity))
    let failure = CoordinatorNextTurnDispatchFailure(code: "codex_native_probe_timeout",
        stage: .qualification, commandInvocationAttempted: false, elapsedMilliseconds: 1_500,
        cachedFailure: true)
    await transport.failNextSelection(CoordinatorError(failure.code, dispatchFailure: failure))
    await transport.setSnapshot(try providerUISnapshot(session, sessions: [session]))
    await model.requestPanelSelection(1)
    let notice = try #require(model.selectionDeliveryNotice)
    return (model, transport, session, notice, recheck)
}

@Suite("Common Pet provider controls and action isolation", .petLanguage(.korean))
@MainActor
struct PetProviderUITests {
    @Test("New Claude recheck targets its exact session once while another card stays selected",
          arguments: [PetProvider.codex, .claude])
    func matchedSessionRecheckPreservesViewedCard(_ selectedProvider: PetProvider) async throws {
        let h = try await providerUIRecheckFixture(selectedProvider)
        let displayed = try #require(h.model.displayedEvent?.reference)
        #expect(h.model.canRecheckConnectedClaudeSession)
        await h.transport.block("check", context: h.target.context)
        let recheck = Task { await h.model.recheckConnectedClaudeSession() }
        let started = await providerUIWait("check", context: h.target.context, transport: h.transport)
        #expect(started)
        guard started else { await h.transport.release("check", context: h.target.context); await recheck.value; return }
        #expect(!h.model.canRecheckConnectedClaudeSession)
        await h.model.recheckConnectedClaudeSession()
        await h.transport.release("check", context: h.target.context)
        await recheck.value
        let controls = await h.transport.controls
        #expect(controls.count == 1 && controls.first?.0 == "check")
        #expect(controls.first?.1 == h.target.context)
        #expect(h.model.selectedProviderContext == h.selected.context)
        #expect(h.model.displayedEvent?.reference == displayed)
        #expect(await h.transport.selectedSessions.isEmpty)
        #expect(await h.transport.count("select") == 0)
        await h.service.shutdown()
    }

    @Test("A stale matched Claude session or service cannot send a connection recheck",
          arguments: ["removed", "context", "directory", "service-generation", "service-unavailable"])
    func matchedSessionRecheckRejectsStaleEvidence(_ change: String) async throws {
        let h = try await providerUIRecheckFixture(.codex)
        var changed = h.snapshot
        switch change {
        case "removed":
            changed.providerSessions.removeAll { $0 == h.target }
        case "context":
            let context = h.target.context
            let replacement = PetProviderSession(id: h.target.id,
                context: .init(provider: .claude, scopeID: context.scopeID,
                    serviceIncarnation: context.serviceIncarnation,
                    sessionIncarnation: context.sessionIncarnation, authorityEpoch: context.authorityEpoch,
                    uiGeneration: context.uiGeneration + 1),
                projectID: h.target.projectID, sessionID: h.target.sessionID, cwd: h.target.cwd,
                state: h.target.state, title: h.target.title, nativeSessionID: h.target.nativeSessionID)
            changed.providerSessions = [h.selected, replacement]
        case "directory":
            changed.providerDirectory = .init(serviceGeneration: h.service.generation,
                serviceIncarnation: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        case "service-generation":
            changed.providerDirectory = .init(serviceGeneration: h.service.generation + 1,
                serviceIncarnation: h.selected.context.serviceIncarnation)
        default:
            h.service.connectionFailed(generation: h.service.generation)
        }
        // Keep the previously rendered matched row to test the action's own
        // latest-directory checks before the controller observes the change.
        h.model.applySnapshotForTesting(changed)
        #expect(!h.model.canRecheckConnectedClaudeSession)
        #expect(!h.model.canControlClaudeSession(h.target))
        await h.model.recheckConnectedClaudeSession()
        #expect(await h.transport.controls.isEmpty)
        #expect(await h.transport.selectedSessions.isEmpty)
        #expect(h.model.selectedProviderContext == h.selected.context)
        await h.service.shutdown()
    }

    @Test("Failed Claude reads invalidate settings badges and recover without losing directory or controls",
          arguments: ["request", "decode"])
    func failedClaudeReadInvalidatesSettingsEvidence(_ failure: String) async throws {
        let sessions = [providerUISession(.claude, suffix: "ready"), providerUISession(.codex, suffix: "other")]
        let snapshots = try unifiedUISnapshots(sessions)
        let transport = ProviderUITransport(snapshots: snapshots)
        let service = providerUIService()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            claudeConnection: providerUIClaudeConnection(), appService: service,
            suggestionModeStore: ProviderUISuggestions())
        model.applySnapshotForTesting(snapshots[0])
        let entry = try #require(model.snapshot?.providerInbox?.sessions.first)
        #expect(model.claudeSettingsSummary.tone == .confirmed)
        #expect(model.claudeSessionSettingsStatus(entry).isReady)
        if failure == "request" { await transport.failNextSnapshot() }
        else { await transport.failNextSnapshotDecode() }
        await model.refresh()
        #expect(model.providerReadFailed && model.providerSessions == sessions)
        #expect(model.snapshot?.providerDirectory == snapshots[0].providerDirectory)
        #expect(model.hasVerifiedServiceConnection && service.state == .ready)
        #expect(model.coordinatorTransportError == nil)
        #expect(PetSettingsStatusTone.commonService(model.connectionReadiness) == .confirmed)
        #expect(model.claudeSettingsSummary.title == "확인 전")
        #expect(model.claudeSettingsSummary.tone == .neutral)
        #expect(model.claudeSessionSettingsStatus(entry).tone == .neutral)
        #expect(!model.claudeSessionSettingsStatus(entry).isReady)
        #expect(model.canControlClaudeConnection && model.canControlClaudeSession(sessions[0]))

        await model.checkClaudeConnection(session: sessions[0])
        #expect(!model.providerReadFailed && model.lastError == nil)
        #expect(model.claudeSettingsSummary.tone == .confirmed)
        #expect(model.claudeSessionSettingsStatus(entry).isReady)
        await model.disconnectClaudeSession(session: sessions[0])
        let controls = await transport.controls
        #expect(controls.map(\.0) == ["check", "disconnect"])
        #expect(controls.allSatisfy { $0.1 == sessions[0].context })
        #expect(await transport.selectedSessions.isEmpty)
        await model.selectProviderSession(sessions[1])
        #expect(model.provider == .codex && model.claudeSettingsSummary.tone == .confirmed)
        await service.shutdown()
    }

    @Test("Same-context snapshot recovery retains delivery failure without restoring selection authority",
          arguments: [PetProvider.codex, .claude])
    func deliveryNoticeSurvivesTransientProviderReads(_ provider: PetProvider) async throws {
        let h = try await providerUIDeliveryFailure(provider)
        for _ in 0..<2 {
            await h.transport.failNextSnapshot()
            await h.model.refresh()
            #expect(h.model.selectionDeliveryNotice == h.notice)
            #expect(h.model.localForegroundIdentity == nil)
        }
        await h.model.refresh()
        #expect(h.model.selectedProviderContext == h.session.context)
        #expect(h.model.selectionDeliveryNotice == h.notice)
        #expect(h.model.selectionSubmission == nil && h.model.localForegroundIdentity == nil)
        #expect(await h.transport.count("select") == 1)
        await h.model.recheckSelectionDeliveryCodex(noticeID: h.notice.id)
        #expect(await h.recheck.checks == (provider == .codex ? 1 : 0))
        #expect(h.model.selectionDeliveryNotice?.nativeRecheckSucceeded == (provider == .codex))
        #expect(await h.transport.count("select") == 1)
    }

    @Test("A recovered snapshot with a changed authority context retires the old delivery notice",
          arguments: ["provider", "scope", "service", "session", "authority", "ui"])
    func changedProviderRecoveryDropsDeliveryNotice(_ changed: String) async throws {
        let h = try await providerUIDeliveryFailure(.claude)
        await h.transport.failNextSnapshot()
        await h.model.refresh()
        #expect(h.model.selectionDeliveryNotice == h.notice)
        let old = h.session.context
        let provider: PetProvider = changed == "provider" ? .codex : .claude
        let context = PetProviderContext(provider: provider,
            scopeID: changed == "scope" ? UUID().uuidString.lowercased() : old.scopeID,
            serviceIncarnation: changed == "service" ? UUID().uuidString.lowercased() : old.serviceIncarnation,
            sessionIncarnation: changed == "session" ? UUID().uuidString.lowercased() : old.sessionIncarnation,
            authorityEpoch: provider == .codex ? nil
                : changed == "authority" ? UUID().uuidString.lowercased() : old.authorityEpoch,
            uiGeneration: changed == "ui" ? old.uiGeneration + 1 : old.uiGeneration)
        let replacement = PetProviderSession(id: h.session.id, context: context,
            projectID: h.session.projectID, sessionID: h.session.sessionID, cwd: h.session.cwd,
            state: "ready", title: h.session.title)
        await h.transport.setSnapshot(try providerUISnapshot(replacement, sessions: [replacement]))
        try await h.transport.selectSession(replacement)
        await h.model.refresh()
        #expect(h.model.selectedProviderContext == context)
        #expect(h.model.selectionDeliveryNotice == nil)
        #expect(h.model.localForegroundIdentity == nil)
        await h.model.recheckSelectionDeliveryCodex(noticeID: h.notice.id)
        #expect(await h.recheck.checks == 0)
        #expect(await h.transport.count("select") == 1)
    }

    @Test("Closing an outage notice prevents the recovered snapshot from recreating it")
    func dismissedDeliveryNoticeDoesNotReturnAfterSnapshotRecovery() async throws {
        let h = try await providerUIDeliveryFailure(.codex)
        await h.transport.failNextSnapshot()
        await h.model.refresh()
        h.model.dismissSelectionDeliveryNotice(noticeID: h.notice.id)
        await h.model.refresh()
        #expect(h.model.selectedProviderContext == h.session.context)
        #expect(h.model.selectionDeliveryNotice == nil)
        #expect(await h.transport.count("select") == 1)
    }

    @Test("Same-context read recovery still fences late selection and outcome responses",
          arguments: [PetProvider.codex, .claude], ["select", "outcome"])
    func lateSelectionRemainsFencedAfterSnapshotRecovery(_ provider: PetProvider, _ stage: String) async throws {
        let session = providerUISession(provider, suffix: "late_selection_recovery")
        let initial = try providerUISnapshot(session, sessions: [session],
            card: PetTestCard(suffix: "late_selection_recovery", rankedActionCount: 2))
        let transport = ProviderUITransport(snapshots: [initial])
        let opener = PetFakeApplicationOpener()
        let model = PetViewModel(transport: transport, externalApplicationOpener: opener)
        model.applySnapshotForTesting(initial)
        await model.focus(try #require(model.displayInteraction?.identity))
        var accepted = 0
        model.onUsageAccepted = { _ in accepted += 1 }
        await transport.block(stage, context: session.context)
        let selection = Task { await model.requestPanelSelection(1) }
        #expect(await providerUIWait(stage, context: session.context, transport: transport))
        await transport.setSnapshot(try providerUISnapshot(session, sessions: [session]))
        await transport.failNextSnapshot()
        await model.refresh()
        await model.refresh()
        let reads = await transport.count("get_state")
        await transport.release(stage, context: session.context)
        await selection.value
        #expect(accepted == 0 && opener.opened.isEmpty)
        #expect(model.selectionDeliveryNotice == nil && model.selectionSubmission == nil)
        #expect(model.localForegroundIdentity == nil)
        #expect(await transport.count("get_state") == reads)
        #expect(await transport.count("select") == 1)
    }

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
        #expect(model.supportsDecisionDismissal && model.providerSessions.count == 3)
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

    @Test("Snapshot failure and recovery cannot duplicate a slow physical focus request", arguments: [PetProvider.codex, .claude])
    func snapshotRecoveryKeepsFocusReservation(_ provider: PetProvider) async throws {
        let session = providerUISession(provider, suffix: "slow_recovery")
        let card = PetTestCard(suffix: "same_physical_focus", rankedActionCount: 2)
        let snapshot = try providerUISnapshot(session, sessions: [session], card: card)
        let transport = ProviderUITransport(snapshots: [snapshot])
        let clock = PetTestFocusClock()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 focusRetryNow: { clock.now })
        model.applySnapshotForTesting(snapshot)
        let identity = try #require(model.displayInteraction?.identity)
        await transport.block("focus_interaction", context: session.context)
        let old = Task { await model.focus(identity) }
        let started = await providerUIWait("focus_interaction", context: session.context, transport: transport)
        #expect(started)
        guard started else { await transport.release("focus_interaction", context: session.context); await old.value; return }
        await transport.failNextSnapshot()
        await model.refresh()
        #expect(model.localForegroundIdentity == nil)
        clock.advance(nanoseconds: 30_000_000_000)
        for _ in 0..<4 { await model.refresh() }
        #expect(await transport.count("focus_interaction") == 1)
        #expect(model.localForegroundIdentity == nil)
        await transport.release("focus_interaction", context: session.context)
        await old.value
        #expect(model.localForegroundIdentity == nil)
        await model.refresh()
        #expect(await transport.count("focus_interaction") == 2)
        #expect(model.localForegroundIdentity == identity)
        #expect(await transport.count("select") == 0)
    }

    @Test("Restoring the same provider snapshot does not erase its retained focus failure cooldown")
    func snapshotRecoveryKeepsFocusFailureBudget() async throws {
        let session = providerUISession(.codex, suffix: "cooldown_recovery")
        let snapshot = try providerUISnapshot(session, sessions: [session],
            card: PetTestCard(suffix: "retained_cooldown", rankedActionCount: 2))
        let transport = ProviderUITransport(snapshots: [snapshot])
        let clock = PetTestFocusClock()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 focusRetryNow: { clock.now })
        model.applySnapshotForTesting(snapshot)
        let identity = try #require(model.displayInteraction?.identity)
        await transport.block("focus_interaction", context: session.context)
        let focus = Task { await model.focus(identity) }
        let started = await providerUIWait("focus_interaction", context: session.context, transport: transport)
        #expect(started)
        guard started else { await transport.release("focus_interaction", context: session.context); await focus.value; return }
        await transport.release("focus_interaction", context: session.context, fails: true)
        await focus.value
        #expect(model.localForegroundIdentity == nil)
        await transport.failNextSnapshot()
        await model.refresh()
        await model.refresh()
        #expect(model.snapshot?.providerContext == session.context)
        #expect(await transport.count("focus_interaction") == 1)
        #expect(model.localForegroundIdentity == nil)
        clock.advance(nanoseconds: 2_000_000_000)
        await model.refresh()
        #expect(await transport.count("focus_interaction") == 2)
        #expect(model.localForegroundIdentity == identity)
    }

    @Test("A provider A B A round trip fences the old response and retains its I/O reservation", arguments: [false, true])
    func lateFocusAfterProviderRoundTrip(_ fails: Bool) async throws {
        let sessions = [providerUISession(.claude, suffix: "round_a"), providerUISession(.claude, suffix: "round_b")]
        let snapshots = [try providerUISnapshot(sessions[0], sessions: sessions,
            card: PetTestCard(suffix: "round_trip_identity", rankedActionCount: 2)),
                         try providerUISnapshot(sessions[1], sessions: sessions)]
        let transport = ProviderUITransport(snapshots: snapshots)
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.applySnapshotForTesting(snapshots[0])
        let identity = try #require(model.displayInteraction?.identity)
        await transport.block("focus_interaction", context: sessions[0].context)
        let old = Task { await model.focus(identity) }
        let started = await providerUIWait("focus_interaction", context: sessions[0].context, transport: transport)
        #expect(started)
        guard started else { await transport.release("focus_interaction", context: sessions[0].context); await old.value; return }
        await model.selectProviderSession(sessions[1])
        await model.selectProviderSession(sessions[0])
        await model.focus(identity)
        #expect(await transport.count("focus_interaction") == 1)
        #expect(model.localForegroundIdentity == nil)
        await transport.release("focus_interaction", context: sessions[0].context, fails: fails)
        await old.value
        #expect(model.selectedProviderContext == sessions[0].context)
        #expect(model.localForegroundIdentity == nil && model.lastError == nil)
        await model.focus(identity)
        #expect(model.localForegroundIdentity == identity)
        #expect(await transport.count("focus_interaction") == 2)
        #expect(await transport.count("select") == 0)
    }

    @Test("Late selection and outcome responses never publish acceptance or failure after switching providers",
          arguments: ["select", "outcome"], [false, true])
    func lateSelection(_ blockedStage: String, _ fails: Bool) async throws {
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
        await transport.release(blockedStage, context: sessions[0].context, fails: fails)
        await old.value
        #expect(accepted == 0 && opener.opened.isEmpty && model.lastError == nil)
        #expect(model.selectionDeliveryNotice == nil)
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

    @Test("Late Claude dismissal never refreshes or changes a newer card or provider context",
          arguments: ["card", "session", "round_trip"], [false, true])
    func lateDismissal(_ change: String, _ fails: Bool) async throws {
        let sessions = [providerUISession(.claude, suffix: "skip_a"), providerUISession(.claude, suffix: "skip_b")]
        let first = try providerUISnapshot(sessions[0], sessions: sessions,
            card: PetTestCard(suffix: "skip_a", rankedActionCount: 2))
        let other = try providerUISnapshot(sessions[1], sessions: sessions,
            card: PetTestCard(suffix: "skip_b", rankedActionCount: 2))
        let transport = ProviderUITransport(snapshots: [first, other])
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.applySnapshotForTesting(first)
        let identity = try #require(model.displayInteraction?.identity)
        #expect(model.canSkipDecision(identity))
        await transport.block("dismiss_interaction", context: sessions[0].context)
        let pending = Task { await model.skipDecision(for: identity) }
        #expect(await providerUIWait("dismiss_interaction", context: sessions[0].context, transport: transport))
        await model.skipDecision(for: identity)
        #expect(await transport.count("dismiss_interaction") == 1)
        if change == "card" {
            // Keep the fake server's old snapshot to detect any stale receipt
            // triggering an extra refresh that replaces this newer card.
            model.applySnapshotForTesting(try providerUISnapshot(sessions[0], sessions: sessions,
                card: PetTestCard(suffix: "skip_successor", rankedActionCount: 2)))
        } else {
            await model.selectProviderSession(sessions[1])
            if change == "round_trip" { await model.selectProviderSession(sessions[0]) }
        }
        let current = try #require(model.displayInteraction?.identity)
        let reads = await transport.count("get_state")
        await transport.release("dismiss_interaction", context: sessions[0].context, fails: fails)
        await pending.value

        #expect(model.displayInteraction?.identity == current)
        #expect(model.lastError == nil && model.lastTerminalPresentation == nil)
        #expect(model.inFlightDismissalIdentity == nil && model.canSkipDecision(current))
        #expect(await transport.count("get_state") == reads)
        #expect(await transport.count("select") == 0)
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

@Suite("Pet focus endpoint identity", .petLanguage(.korean))
@MainActor
struct PetFocusEndpointIdentityTests {
    @Test("Changing focus endpoints cannot duplicate the same held request or accept its late reply",
          arguments: [(false, false), (false, true), (true, false), (true, true)])
    func focusEndpointChangeKeepsPhysicalReservation(_ scenario: (Bool, Bool)) async throws {
        let (startsWithEvent, lateFailure) = scenario
        let firstType = startsWithEvent ? "focus_event" : "focus_interaction"
        let nextType = startsWithEvent ? "focus_interaction" : "focus_event"
        let session = providerUISession(.codex, suffix: "endpoint_reservation")
        let card = PetTestCard(suffix: "same_card", rankedActionCount: 2)
        let initial = try providerUIFocusSnapshot(session, card: card, eventFocus: startsWithEvent)
        let restored = try providerUIFocusSnapshot(session, card: card, eventFocus: !startsWithEvent)
        let acknowledged = try providerUIFocusSnapshot(session, card: card,
            eventFocus: !startsWithEvent, acknowledged: true)
        let transport = ProviderUITransport(snapshots: [initial])
        let clock = PetTestFocusClock()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 focusRetryNow: { clock.now })
        model.applySnapshotForTesting(initial)
        let identity = try #require(model.displayInteraction?.identity)
        await transport.block(firstType, context: session.context)
        let old = Task { await model.focus(identity) }
        let started = await providerUIWait(firstType, context: session.context, transport: transport)
        #expect(started)
        guard started else { await transport.release(firstType, context: session.context); await old.value; return }

        await transport.failNextSnapshot()
        await model.refresh()
        #expect(model.snapshot == nil && model.localForegroundIdentity == nil)
        await transport.setSnapshot(restored)
        clock.advance(nanoseconds: 30_000_000_000) // Beyond cooldown; only the I/O reservation can stop this.
        for _ in 0..<5 { await model.refresh() }
        await model.focus(identity) // A manual request also cannot duplicate outstanding I/O.
        #expect(await transport.count(firstType) == 1)
        #expect(await transport.count(nextType) == 0)
        #expect(model.localForegroundIdentity == nil)
        let reads = await transport.count("get_state")
        await transport.release(firstType, context: session.context, fails: lateFailure)
        await old.value
        #expect(model.localForegroundIdentity == nil && model.lastError == nil)
        #expect(await transport.count("get_state") == reads)

        await transport.setSnapshot(acknowledged)
        await model.refresh()
        #expect(await transport.count(firstType) == 1)
        #expect(await transport.count(nextType) == 1)
        #expect(model.focusedInteraction?.identity == identity)
        let requests = await transport.requests
        #expect(requests.allSatisfy { ["get_state", "focus_interaction", "focus_event"].contains($0.type) })
    }

    @Test("Endpoint changes share failure backoff and either endpoint clears it after acknowledgment", arguments: [false, true])
    func focusEndpointChangeKeepsFailureBudget(_ startsWithEvent: Bool) async throws {
        let firstType = startsWithEvent ? "focus_event" : "focus_interaction"
        let nextType = startsWithEvent ? "focus_interaction" : "focus_event"
        let session = providerUISession(.codex, suffix: "endpoint_budget")
        let card = PetTestCard(suffix: "same_budget", rankedActionCount: 2)
        let initial = try providerUIFocusSnapshot(session, card: card, eventFocus: startsWithEvent)
        let switched = try providerUIFocusSnapshot(session, card: card, eventFocus: !startsWithEvent)
        let firstACK = try providerUIFocusSnapshot(session, card: card, eventFocus: startsWithEvent, acknowledged: true)
        let nextACK = try providerUIFocusSnapshot(session, card: card, eventFocus: !startsWithEvent, acknowledged: true)
        let transport = ProviderUITransport(snapshots: [initial])
        let clock = PetTestFocusClock()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 focusRetryNow: { clock.now })
        model.applySnapshotForTesting(initial)
        let identity = try #require(model.displayInteraction?.identity)
        await transport.failNextFocus(context: session.context)
        await model.focus(identity)
        await transport.setSnapshot(switched)
        for _ in 0..<5 { await model.refresh() }
        clock.advance(nanoseconds: 1_999_999_999)
        await model.refresh()
        #expect(await transport.count(firstType) == 1)
        #expect(await transport.count(nextType) == 0)
        #expect(model.localForegroundIdentity == nil)

        await transport.failNextFocus(context: session.context)
        clock.advance(nanoseconds: 1)
        await model.refresh()
        #expect(await transport.count(nextType) == 1)
        // A failure through the other endpoint is attempt 2, so its delay is
        // four seconds even if the next snapshot switches back to the first.
        await transport.setSnapshot(initial)
        for _ in 0..<5 { await model.refresh() }
        clock.advance(nanoseconds: 3_999_999_999)
        await model.refresh()
        #expect(await transport.count(firstType) == 1)
        #expect(await transport.count(nextType) == 1)
        await transport.setSnapshot(firstACK)
        clock.advance(nanoseconds: 1)
        await model.refresh()
        #expect(await transport.count(firstType) == 2)
        #expect(model.focusedInteraction?.identity == identity)

        // Drop only the presentation, then fail through the other endpoint.
        // A prior successful ACK must reset the shared streak to two seconds.
        model.applySnapshotForTesting(try providerUISnapshot(session, sessions: [session]))
        await transport.setSnapshot(switched)
        await transport.failNextFocus(context: session.context)
        await model.refresh()
        #expect(await transport.count(nextType) == 2)
        clock.advance(nanoseconds: 1_999_999_999)
        await model.refresh()
        #expect(await transport.count(nextType) == 2 && model.localForegroundIdentity == nil)
        await transport.setSnapshot(nextACK)
        clock.advance(nanoseconds: 1)
        await model.refresh()
        #expect(await transport.count(nextType) == 3)
        #expect(model.focusedInteraction?.identity == identity)
        let requests = await transport.requests
        #expect(requests.allSatisfy { ["get_state", "focus_interaction", "focus_event"].contains($0.type) })
    }

    @Test("A shared interaction ID does not merge different packet revision or prompt bindings",
          arguments: ["packet_id", "revision", "source_prompt_id"])
    func focusEndpointKeyRetainsFullDecisionIdentity(_ changedField: String) async throws {
        let session = providerUISession(.codex, suffix: "endpoint_distinct")
        let card = PetTestCard(suffix: "reused_id", rankedActionCount: 2)
        let initial = try providerUIFocusSnapshot(session, card: card, eventFocus: false)
        let changedValue: Any
        if changedField == "revision" { changedValue = Int64(2) }
        else { changedValue = "new_" + changedField }
        let overrides = [changedField: changedValue]
        let replacement = try providerUIFocusSnapshot(session, card: card, eventFocus: true,
            identityOverrides: overrides)
        let acknowledged = try providerUIFocusSnapshot(session, card: card, eventFocus: true,
            acknowledged: true, identityOverrides: overrides)
        let transport = ProviderUITransport(snapshots: [initial])
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.applySnapshotForTesting(initial)
        let oldIdentity = try #require(model.displayInteraction?.identity)
        await transport.block("focus_interaction", context: session.context)
        let old = Task { await model.focus(oldIdentity) }
        let started = await providerUIWait("focus_interaction", context: session.context, transport: transport)
        #expect(started)
        guard started else { await transport.release("focus_interaction", context: session.context); await old.value; return }
        await transport.failNextSnapshot()
        await model.refresh()
        model.applySnapshotForTesting(replacement)
        let newIdentity = try #require(model.displayInteraction?.identity)
        #expect(newIdentity.interactionID == oldIdentity.interactionID && newIdentity != oldIdentity)
        await transport.setSnapshot(acknowledged)
        await model.focus(newIdentity)
        #expect(await transport.count("focus_event") == 1)
        #expect(model.focusedInteraction?.identity == newIdentity)
        let reads = await transport.count("get_state")
        await transport.release("focus_interaction", context: session.context)
        await old.value
        #expect(model.focusedInteraction?.identity == newIdentity)
        #expect(await transport.count("get_state") == reads)
        let requests = await transport.requests
        #expect(requests.allSatisfy { ["get_state", "focus_interaction", "focus_event"].contains($0.type) })
    }
}

@MainActor
private func unifiedUISnapshots(_ sessions: [PetProviderSession], sameCardIDs: Bool = false,
                                removed: Set<String> = []) throws -> [PetSnapshot] {
    var snapshots = try sessions.map { session in
        try providerUISnapshot(session, sessions: sessions, card: removed.contains(session.id) ? nil
            : PetTestCard(suffix: sameCardIDs ? "shared" : session.id, rankedActionCount: 2))
    }
    var entries: [PetProviderInboxEntry] = []
    for index in snapshots.indices {
        var value = snapshots[index]
        if sessions[index].context.provider == .codex {
            let events = value.queuedEvents
            value.eventNavigation = try PetEventNavigationSnapshot(jsonObject: [
                "events": events.map { $0.reference.jsonObject },
                "focused": events.first?.reference.jsonObject as Any? ?? NSNull(),
                "revision": 1, "delivery_pending": false,
            ], availableEvents: events)
        }
        value.providerDirectory = .init(serviceGeneration: 1, serviceIncarnation: sessions[index].context.serviceIncarnation)
        entries += try value.queuedEvents.map { try PetProviderInboxEntry(session: sessions[index], event: $0,
                                                                        arrivalSequence: UInt64(index + 1)) }
        snapshots[index] = value
    }
    let inbox = PetProviderInbox(entries: entries, sessions: snapshots.enumerated().map { index, value in
        PetProviderInboxSession(session: sessions[index], status: value.providerStatus, diagnostic: nil)
    }, arrivalOrderComplete: true, codexSettings: snapshots.first {
        $0.providerContext?.provider == .codex
    }.map { PetCodexSettingsEvidence(snapshot: $0) })
    return snapshots.map { value in var copy = value; copy.providerInbox = inbox; return copy }
}

/// Unlike the cross-provider fixture, this has multiple cards in one Codex
/// projection, so a failed move can retain A's display while the inbox wants B.
@MainActor
private func unifiedCodexDecisionSnapshot(
    _ session: PetProviderSession, cards: [PetTestCard], focusedSuffix: String
) throws -> PetSnapshot {
    var snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: cards, foregroundSuffix: focusedSuffix))
    snapshot.providerSessions = [session]
    snapshot.providerContext = session.context
    let events = snapshot.queuedEvents
    snapshot.eventNavigation = try PetEventNavigationSnapshot(jsonObject: [
        "events": events.map { $0.reference.jsonObject },
        "focused": PetEventReference(kind: .decision, eventID: "interaction_" + focusedSuffix).jsonObject,
        "revision": 1, "delivery_pending": false,
    ], availableEvents: events)
    snapshot.providerDirectory = .init(serviceGeneration: 1, serviceIncarnation: session.context.serviceIncarnation)
    snapshot.providerInbox = PetProviderInbox(entries: try events.enumerated().map { index, event in
        try PetProviderInboxEntry(session: session, event: event, arrivalSequence: UInt64(index + 1))
    }, sessions: [PetProviderInboxSession(session: session, status: nil, diagnostic: nil)],
       arrivalOrderComplete: true, codexSettings: PetCodexSettingsEvidence(snapshot: snapshot))
    return snapshot
}

@Suite("Unified provider inbox navigation", .petLanguage(.korean))
@MainActor
struct PetUnifiedInboxNavigationTests {
    @Test("A failed same-provider inbox move retains the 2 4 8 second automatic focus budget")
    func failedInboxMoveKeepsAutomaticFocusBudget() async throws {
        let session = providerUISession(.codex, suffix: "inbox_retry")
        let cards = ["shown", "wanted"].map { PetTestCard(suffix: $0, rankedActionCount: 2) }
        let shown = try unifiedCodexDecisionSnapshot(session, cards: cards, focusedSuffix: "shown")
        let wanted = try unifiedCodexDecisionSnapshot(session, cards: cards, focusedSuffix: "wanted")
        let transport = ProviderUITransport(snapshots: [shown])
        let clock = PetTestFocusClock()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 focusRetryNow: { clock.now })
        await model.refresh()
        #expect(model.canActOnDisplayedEvent && model.displayedEventQueuePosition == 1)
        #expect(await transport.count("focus_event") == 1)
        await transport.failNextFocus(context: session.context)
        await model.navigateToNextEvent()
        #expect(await transport.count("focus_event") == 2)
        #expect(model.displayedEventQueuePosition == 1 && model.pendingInboxIdentity == nil)

        var focusCount = 2
        let delays: [UInt64] = [2_000_000_000, 4_000_000_000, 8_000_000_000]
        for delay in delays {
            for _ in 0..<5 { await model.refresh() }
            #expect(model.hasVerifiedServiceConnection)
            #expect(await transport.count("focus_event") == focusCount)
            #expect(!model.canActOnDisplayedEvent && model.localForegroundIdentity == nil)
            #expect(model.pendingInboxIdentity == nil)
            clock.advance(nanoseconds: delay - 1)
            await model.refresh()
            #expect(await transport.count("focus_event") == focusCount)
            clock.advance(nanoseconds: 1)
            if delay == 8_000_000_000 {
                await transport.setSnapshot(wanted)
            } else {
                await transport.failNextFocus(context: session.context)
            }
            await model.refresh()
            focusCount += 1
            #expect(await transport.count("focus_event") == focusCount)
        }
        #expect(model.canActOnDisplayedEvent && model.displayedEventQueuePosition == 2)
        #expect(model.localForegroundIdentity?.interactionID == "interaction_wanted")
        for _ in 0..<3 { await model.refresh() }
        #expect(await transport.count("focus_event") == focusCount)
        let requests = await transport.requests
        #expect(requests.allSatisfy { ["get_state", "focus_event"].contains($0.type) })
        let focuses = requests.filter { $0.type == "focus_event" }
        #expect(focuses.allSatisfy { $0.context == session.context })
        let targets = try focuses.dropFirst().map { try petTestObject($0.payload)["target"] as? [String: Any] }
        #expect(targets.allSatisfy { $0?["interaction_id"] as? String == "interaction_wanted" })
    }

    @Test("Overlapping refresh attempts cannot duplicate a slow automatic inbox retry")
    func slowAutomaticInboxRetryDoesNotAccumulate() async throws {
        let session = providerUISession(.codex, suffix: "inbox_slow")
        let cards = ["shown", "wanted"].map { PetTestCard(suffix: $0, rankedActionCount: 2) }
        let shown = try unifiedCodexDecisionSnapshot(session, cards: cards, focusedSuffix: "shown")
        let wanted = try unifiedCodexDecisionSnapshot(session, cards: cards, focusedSuffix: "wanted")
        let transport = ProviderUITransport(snapshots: [shown])
        let clock = PetTestFocusClock()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 focusRetryNow: { clock.now })
        await model.refresh()
        await transport.failNextFocus(context: session.context)
        await model.navigateToNextEvent()
        clock.advance(nanoseconds: 2_000_000_000)
        await transport.block("focus_event", context: session.context)
        let retry = Task { await model.refresh() }
        let started = await providerUIWait("focus_event", context: session.context, transport: transport)
        #expect(started)
        guard started else { await transport.release("focus_event", context: session.context); await retry.value; return }
        clock.advance(nanoseconds: 30_000_000_000)
        let reads = await transport.count("get_state")
        for _ in 0..<5 { await model.refresh() }
        // The automatic retry still owns refresh(); overlapping polls must
        // neither start another snapshot read nor issue another focus request.
        #expect(await transport.count("get_state") == reads)
        #expect(await transport.count("focus_event") == 3)
        #expect(model.pendingInboxIdentity != nil && !model.canActOnDisplayedEvent)
        #expect(model.localForegroundIdentity == nil)
        await transport.setSnapshot(wanted)
        await transport.release("focus_event", context: session.context)
        await retry.value
        #expect(model.pendingInboxIdentity == nil && model.canActOnDisplayedEvent)
        #expect(model.displayedEventQueuePosition == 2)
        let requests = await transport.requests
        #expect(requests.allSatisfy { ["get_state", "focus_event"].contains($0.type) })
    }

    @Test("Explicit inbox navigation can retry during cooldown but still requires focus acknowledgment")
    func explicitInboxRetryStillRequiresAcknowledgment() async throws {
        let session = providerUISession(.codex, suffix: "inbox_explicit")
        let cards = ["shown", "wanted"].map { PetTestCard(suffix: $0, rankedActionCount: 2) }
        let shown = try unifiedCodexDecisionSnapshot(session, cards: cards, focusedSuffix: "shown")
        let wanted = try unifiedCodexDecisionSnapshot(session, cards: cards, focusedSuffix: "wanted")
        let transport = ProviderUITransport(snapshots: [shown])
        let clock = PetTestFocusClock()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 focusRetryNow: { clock.now })
        await model.refresh()
        await transport.failNextFocus(context: session.context)
        await model.navigateToNextEvent()
        #expect(model.canNavigateEvents && !model.canActOnDisplayedEvent)
        // No clock advance: a new user gesture must not inherit the poll delay.
        await transport.block("focus_event", context: session.context)
        let explicit = Task { await model.navigateToNextEvent() }
        let started = await providerUIWait("focus_event", context: session.context, transport: transport)
        #expect(started)
        guard started else { await transport.release("focus_event", context: session.context); await explicit.value; return }
        #expect(await transport.count("focus_event") == 3)
        await transport.setSnapshot(wanted)
        let reads = await transport.count("get_state")
        for _ in 0..<5 { await model.refresh() }
        #expect(await transport.count("get_state") == reads + 5)
        #expect(!model.canActOnDisplayedEvent && model.localForegroundIdentity == nil)
        #expect(await transport.count("focus_event") == 3)
        await transport.release("focus_event", context: session.context)
        await explicit.value
        #expect(model.canActOnDisplayedEvent && model.displayedEventQueuePosition == 2)
        let requests = await transport.requests
        #expect(requests.allSatisfy { ["get_state", "focus_event"].contains($0.type) })
    }

    @Test("Cached Claude presentation cannot confirm shared service health; a fresh directory can")
    func cachedPresentationIsNotServiceEvidence() async throws {
        let session = providerUISession(.claude, suffix: "cached")
        var snapshot = try providerUISnapshot(session, sessions: [session])
        snapshot.providerStatus = PetProviderStatus(provider: .claude, scopeID: session.context.scopeID,
            sessionID: session.sessionID, cwd: session.cwd, bridgeConnected: false,
            ready: false, selectionEnabled: false, latestOutcome: nil)
        let directory = PetProviderDirectoryStatus(serviceGeneration: 1,
            serviceIncarnation: session.context.serviceIncarnation)
        snapshot.providerDirectory = directory
        let transport = ProviderUITransport(snapshots: [snapshot])
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        await model.refresh()
        #expect(model.hasVerifiedServiceConnection)
        #expect(PetSettingsStatusTone.commonService(model.connectionReadiness) == .confirmed)

        snapshot.providerDirectory = nil
        await transport.setSnapshot(snapshot)
        await model.refresh()
        #expect(!model.hasVerifiedServiceConnection)
        #expect(PetSettingsStatusTone.commonService(model.connectionReadiness) != .confirmed)

        snapshot.providerDirectory = directory
        await transport.setSnapshot(snapshot)
        await model.refresh()
        #expect(model.hasVerifiedServiceConnection && model.coordinatorTransportError == nil)
    }

    @Test("Claude navigation never changes Codex projects, Hook targets or card reception evidence",
          arguments: [("claude", true), ("a", true), ("claude", false), ("a", false)])
    func codexSettingsStayScoped(_ configuration: (String, Bool)) async throws {
        let (claudeCard, configurationAvailable) = configuration
        let sessions = [providerUISession(.codex, suffix: "codex"), providerUISession(.claude, suffix: "claude")]
        let codex = try PetSnapshot.parse(petTestSnapshotData(
            cards: [.init(suffix: "a"), .init(suffix: "b")], foregroundSuffix: "a"))
        let noCodexCard = PetSnapshot(projects: codex.projects, sessions: codex.sessions, routing: codex.routing,
            interactions: [], permissionRequests: [], permissionNoticeCount: 0,
            managedCommandApprovals: [], managedCommandApprovalNoticeCount: 0)
        var claude = try providerUISnapshot(sessions[1], sessions: sessions, card: .init(suffix: claudeCard))
        func inbox(_ evidence: PetCodexSettingsEvidence?) -> PetProviderInbox {
            PetProviderInbox(entries: [], sessions: [], arrivalOrderComplete: true, codexSettings: evidence)
        }
        claude.providerInbox = inbox(PetCodexSettingsEvidence(snapshot: noCodexCard))
        let active: Set<String> = ["/tmp/blabee-pet-a", "/tmp/blabee-pet-b"]
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
            onboardingAdapter: ProviderSettingsOnboarding(paths: configurationAvailable ? active.sorted() : nil))
        await model.refreshOnboarding()
        model.applySnapshotForTesting(claude)
        #expect(model.activeProjectPaths == active)
        #expect(model.hookReadinessProjectPaths == active.sorted())
        #expect(!model.projectSettingsNeedRestart && model.activeOnlyProjectPaths.isEmpty)
        #expect(model.connectionReceivedCardProjectPaths.isEmpty)

        // Background Codex cards count even while the same Claude card is visible.
        claude.providerInbox = inbox(PetCodexSettingsEvidence(snapshot: codex))
        model.applySnapshotForTesting(claude)
        #expect(model.connectionReceivedCardProjectPaths == active)
        claude.providerInbox = inbox(PetCodexSettingsEvidence(snapshot: noCodexCard))
        model.applySnapshotForTesting(claude)
        #expect(model.connectionReceivedCardProjectPaths == active)

        // A failed Codex read is unknown; Claude must not supply replacement paths.
        claude.providerInbox = inbox(nil)
        model.applySnapshotForTesting(claude)
        #expect(model.activeProjectPaths.isEmpty && !model.projectSettingsNeedRestart)
        #expect(model.hookReadinessProjectPaths == (configurationAvailable ? active.sorted() : []))
        #expect(model.connectionReadiness.checks.first { $0.id == "projects" }?.state == .pending)

        claude.providerInbox = nil
        model.applySnapshotForTesting(claude)
        #expect(model.activeProjectPaths.isEmpty)
    }

    @Test("Option arrows stay registered on Claude cards and held or stale keys cannot skip a new source")
    func crossProviderNavigationHotKeys() async throws {
        let sessions = [providerUISession(.claude, suffix: "first"), providerUISession(.codex, suffix: "middle"),
                        providerUISession(.claude, suffix: "last")]
        let transport = ProviderUITransport(snapshots: try unifiedUISnapshots(sessions, sameCardIDs: true))
        let backend = PetFakeHotKeyBackend()
        var held: Set<UInt32> = []
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults,
            eventNavigationKeyIsPressed: { held.contains($0) },
            eventNavigationModifiers: { UInt32(optionKey) }) { _ in }
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        model.attachHotKeyRegistry(registry)
        model.setPanelVisible(true)
        defer { model.stopPolling() }
        await model.refresh()
        func rightEvent() throws -> PetHotKeyEvent {
            try #require(backend.registrations.values.first {
                $0.event.signature == PetEventNavigationHotKeys.signature && $0.shortcut == PetEventNavigationDirection.next.shortcut
            }?.event)
        }
        #expect(model.provider == .claude)
        #expect(registry.eventNavigationShortcutLabel(for: .next) == "⌥→")
        let original = try rightEvent()
        held.insert(PetEventNavigationDirection.next.shortcut.keyCode)
        backend.emit(original)
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while model.displayedEventQueuePosition != 2 && ContinuousClock.now < deadline { await Task.yield() }
        #expect(model.provider == .codex && model.displayedEventQueuePosition == 2)
        while model.pendingInboxIdentity != nil && ContinuousClock.now < deadline { await Task.yield() }
        backend.emit(original)
        backend.emit(try rightEvent())
        for _ in 0..<30 { await Task.yield() }
        #expect(model.displayedEventQueuePosition == 2)
        held.removeAll(); registry.pollEventNavigationKeyRelease()
        backend.emit(try rightEvent())
        let finalDeadline = ContinuousClock.now.advanced(by: .seconds(2))
        while model.displayedEventQueuePosition != 3 && ContinuousClock.now < finalDeadline { await Task.yield() }
        while model.pendingInboxIdentity != nil && ContinuousClock.now < finalDeadline { await Task.yield() }
        #expect(model.provider == .claude && model.displayedEventQueuePosition == 3)
        #expect(registry.eventNavigationShortcutLabel(for: .next) == "⌥→")
        #expect(await transport.count("select") == 0)
    }

    @Test("Claude Codex Claude cards follow arrival order and dispatch only to the displayed source", arguments: [false, true])
    func arrivalOrderAndExactSelection(_ sameCardIDs: Bool) async throws {
        let sessions = [providerUISession(.claude, suffix: "first"), providerUISession(.codex, suffix: "middle"),
                        providerUISession(.claude, suffix: "last")]
        let snapshots = try unifiedUISnapshots(sessions, sameCardIDs: sameCardIDs)
        let transport = ProviderUITransport(snapshots: [snapshots[1], snapshots[0], snapshots[2]])
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        await model.refresh()
        #expect(model.selectedProviderContext == sessions[0].context)
        #expect(model.displayedEventQueuePosition == 1 && model.eventQueueCount == 3)
        #expect(model.canActOnDisplayedEvent && model.canNavigateEvents)
        await model.navigateToNextEvent()
        #expect(model.selectedProviderContext == sessions[1].context && model.displayedEventQueuePosition == 2)
        #expect(model.canActOnDisplayedEvent)
        await model.navigateToNextEvent()
        #expect(model.selectedProviderContext == sessions[2].context && model.displayedEventQueuePosition == 3)
        #expect(model.canActOnDisplayedEvent)
        #expect(await transport.count("select") == 0)
        await model.requestPanelSelection(1)
        let selections = await transport.requests.filter { $0.type == "select" }
        #expect(selections.count == 1)
        #expect(selections.first?.context == sessions[2].context)
        #expect(try selections.first.map { try petTestObject($0.payload)["packet_id"] as? String }
            == snapshots[2].interactions.first?.identity.packetID)
    }

    @Test("New arrivals and scoped connection checks preserve the viewed card; removal advances safely")
    func preservesViewedCard() async throws {
        let sessions = [providerUISession(.claude, suffix: "first"), providerUISession(.codex, suffix: "middle"),
                        providerUISession(.claude, suffix: "last")]
        let snapshots = try unifiedUISnapshots(sessions)
        let transport = ProviderUITransport(snapshots: snapshots)
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        await model.refresh()
        await model.navigateToPreviousEvent()
        #expect(model.displayedEventQueuePosition == 3)
        let captured = model.captureProviderActionContext()
        let more = sessions + [providerUISession(.codex, suffix: "new")]
        for snapshot in try unifiedUISnapshots(more) { await transport.setSnapshot(snapshot) }
        await model.refresh()
        #expect(model.selectedProviderContext == sessions[2].context && model.eventQueueCount == 4)
        await model.checkClaudeConnection(session: sessions[0])
        #expect(model.selectedProviderContext == sessions[2].context)
        #expect(await transport.controls.last?.1 == sessions[0].context)
        for snapshot in try unifiedUISnapshots(more, removed: [sessions[2].id]) { await transport.setSnapshot(snapshot) }
        await model.refresh()
        #expect(model.selectedProviderContext == sessions[0].context && model.displayedEventQueuePosition == 1)
        #expect(!model.acceptsProviderAction(captured))
        #expect(await transport.count("select") == 0)
    }

    @Test("A disappearing navigation target cannot gain selection authority from a late focus reply")
    func lateNavigationTarget() async throws {
        let sessions = [providerUISession(.claude, suffix: "first"), providerUISession(.claude, suffix: "last")]
        let transport = ProviderUITransport(snapshots: try unifiedUISnapshots(sessions))
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        await model.refresh()
        await transport.block("focus_interaction", context: sessions[1].context)
        let navigation = Task { await model.navigateToNextEvent() }
        #expect(await providerUIWait("focus_interaction", context: sessions[1].context, transport: transport))
        #expect(!model.canActOnDisplayedEvent && !model.canNavigateEvents)
        for snapshot in try unifiedUISnapshots(sessions, removed: [sessions[1].id]) { await transport.setSnapshot(snapshot) }
        await transport.release("focus_interaction", context: sessions[1].context)
        await navigation.value
        await model.refresh()
        #expect(model.selectedProviderContext == sessions[0].context)
        #expect(model.displayedEventQueuePosition == 1 && model.eventQueueCount == 1)
        #expect(await transport.count("select") == 0)
    }
}
