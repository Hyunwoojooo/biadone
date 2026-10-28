import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class SetupIntegrationPreferences: PetAppServicePreferenceStoring {
    var enabled = false
}

@MainActor
private final class SetupIntegrationChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = true
    var petSelectorCredential: String? { String(repeating: "a", count: 64) }
    var terminationSummary: String?
    var stops = 0
    func stop() async { stops += 1; isRunning = false }
}

@MainActor
private final class SetupIntegrationEnvironment: PetOnboardingAdapting, PetProjectFolderChoosing, AppOwnedServiceLaunching {
    let child = SetupIntegrationChild()
    var scopeIsSaved = false
    var projects: [String] = [] { didSet { scopeIsSaved = true } }
    var scopeReadFails = false
    var defaultScopeFails = false
    var scopeAppearingDuringInitialization: [String]?
    let defaultHome = "/tmp/blabee-one-click-home"
    var defaultInitializations = 0
    var activeProjects: [String] = []
    var events: [String] = []
    var launches = 0
    var folderChoices = 0
    var launchRequests = 0
    var registrationState: PetServiceRegistrationState = .notRegistered
    var unregisterChangesRegistration = false
    var configuredFolder: URL? = URL(fileURLWithPath: "/tmp/blabee-one-click-project")
    func serviceRegistrationState() -> PetServiceRegistrationState { registrationState }
    func configuredProjectPaths() throws -> [String] { projects }
    func configuredProjectPathsIfPresent() throws -> [String]? {
        if scopeReadFails { throw PetTestError.injected("scope_read_failed") }
        return scopeIsSaved ? projects : nil
    }
    func initializeDefaultProjectScopeIfMissing() throws {
        defaultInitializations += 1
        if defaultScopeFails { throw PetTestError.injected("scope_write_failed") }
        if let appeared = scopeAppearingDuringInitialization { projects = appeared }
        guard !scopeIsSaved else { return }
        events.append("defaultFolder")
        projects = [defaultHome]
    }
    func registerService() throws { events.append("register") }
    func unregisterService() async throws {
        events.append("unregister")
        if unregisterChangesRegistration { registrationState = .notRegistered }
    }
    func openSystemSettingsLoginItems() {}
    func enableProject(at path: String) throws { events.append("folder"); projects.append(path) }
    func disableProject(at path: String) throws { projects.removeAll { $0 == path } }
    func chooseProjectFolder() -> URL? { folderChoices += 1; return configuredFolder }
    func launch() throws -> any AppOwnedServiceChild {
        events.append("launch"); launches += 1; activeProjects = projects
        return child
    }
}

private actor SetupIntegrationInspectionGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []
    private var released = false
    func pause() async {
        guard !released else { return }
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            let waiting = observers; observers.removeAll()
            for observer in waiting { observer.resume() }
        }
    }
    func waitForPause() async {
        guard continuation == nil else { return }
        await withCheckedContinuation { observers.append($0) }
    }
    func release() { released = true; continuation?.resume(); continuation = nil }
}

private actor SetupIntegrationCodex: CodexPluginSetupManaging {
    var state: CodexPluginSetupState
    var failConnect = false
    var connects = 0
    var inspections = 0
    var rechecks = 0
    var qualifiedState: CodexPluginSetupState = .notInstalled
    var inspectionGate: SetupIntegrationInspectionGate?
    var recheckGate: SetupIntegrationInspectionGate?
    var connectionGate: SetupIntegrationInspectionGate?
    init(_ state: CodexPluginSetupState) { self.state = state }
    func setFailure() { failConnect = true }
    func setGate(_ gate: SetupIntegrationInspectionGate) { inspectionGate = gate }
    func setRecheckGate(_ gate: SetupIntegrationInspectionGate) { recheckGate = gate }
    func setConnectionGate(_ gate: SetupIntegrationInspectionGate) { connectionGate = gate }
    func setQualifiedState(_ value: CodexPluginSetupState) { qualifiedState = value }
    func inspect() async -> CodexPluginSetupState {
        inspections += 1
        await inspectionGate?.pause()
        return state
    }
    func recheckNativeExecutableWithReport() async -> CodexPluginCheckResult {
        rechecks += 1
        await recheckGate?.pause()
        state = qualifiedState
        return .init(state: state)
    }
    func connect() async -> CodexPluginSetupState {
        connects += 1
        await connectionGate?.pause()
        state = failConnect ? .error(code: "test_connect_failed") : .installedNeedsHookReview(version: "0.1.3")
        return state
    }
    func disconnect() async -> CodexPluginSetupState { state }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) async -> CodexPluginSetupState { state }
}

private actor SetupIntegrationClaude {
    var saved = false
    var enables = 0
    var inspectionGate: SetupIntegrationInspectionGate?
    func setGate(_ gate: SetupIntegrationInspectionGate) { inspectionGate = gate }
    func inspect() async -> ClaudeAutoConnectSetup.Inspection {
        await inspectionGate?.pause()
        return state()
    }
    private func state() -> ClaudeAutoConnectSetup.Inspection {
        .init(isEnabled: saved, canEnable: !saved, canDisable: saved,
              detail: "test setup", canLaunch: true)
    }
    func enable() -> ClaudeAutoConnectSetup.Inspection { enables += 1; saved = true; return state() }
}

private actor SetupIntegrationHooks: PetHookReadinessManaging {
    var state: PetHookReadinessState = .trusted
    var calls = 0
    var inspectionGate: SetupIntegrationInspectionGate?
    func setState(_ value: PetHookReadinessState) { state = value }
    func setGate(_ gate: SetupIntegrationInspectionGate) { inspectionGate = gate }
    func inspect(projectURL: URL) async -> PetHookReadinessState {
        calls += 1
        let result = state
        await inspectionGate?.pause()
        return result
    }
}

private struct SetupIntegrationSuggestions: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) {}
}

private actor SetupIntegrationTransport: PetProviderControlling {
    let read: @MainActor @Sendable () throws -> PetSnapshot
    var requests: [(String, Data)] = []
    var controls = 0
    var responses: [Data: PetSnapshot] = [:]
    var requestGate: SetupIntegrationInspectionGate?
    init(read: @escaping @MainActor @Sendable () throws -> PetSnapshot) { self.read = read }
    func pauseNextRequest(_ gate: SetupIntegrationInspectionGate) { requestGate = gate }
    func request(type: String, payload: Data) async throws -> Data {
        requests.append((type, payload))
        guard type == "get_state" else { throw PetTestError.injected("unexpected_mutation") }
        let response = Data("fixture-\(requests.count)".utf8)
        responses[response] = try await read()
        let gate = requestGate
        requestGate = nil
        await gate?.pause()
        return response
    }
    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        guard let observed = responses[data] else { throw PetTestError.injected("no_snapshot") }
        return observed
    }
    func selectSession(_ session: PetProviderSession) async throws { controls += 1 }
    func checkConnection(_ context: PetProviderContext) async throws { controls += 1 }
    func disconnect(_ context: PetProviderContext) async throws { controls += 1 }
    func onlyReadRequests() -> Bool { requests.allSatisfy { $0.0 == "get_state" && $0.1 == Data("{}".utf8) } }
    func latestRequestIsReadOnly() -> Bool { requests.last?.0 == "get_state" && requests.last?.1 == Data("{}".utf8) }
}

@MainActor
private final class SetupIntegrationHarness {
    static let incarnation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    let environment = SetupIntegrationEnvironment()
    let claude: SetupIntegrationClaude
    let connection: PetClaudeConnectionController
    let codex: SetupIntegrationCodex
    let hooks = SetupIntegrationHooks()
    let service: PetAppServiceController
    var failRead = false
    var rows: [PetProviderSession] = []
    var observations: [PetProviderInboxSession] = []
    var omitCodexEvidence = false
    lazy var transport = SetupIntegrationTransport { [unowned self] in
        guard service.enabled, service.mayQueryCoordinator, !failRead else {
            throw PetTestError.injected("fixture_service_unavailable")
        }
        var object = petTestSnapshotObject(cards: [])
        object["projects"] = environment.activeProjects.enumerated().map { index, path in
            ["project_id": "project_\(index)", "cwd": path, "enabled": true] as [String: Any]
        }
        var snapshot = try PetSnapshot.parse(petTestData(object))
        snapshot.providerDirectory = .init(serviceGeneration: service.generation, serviceIncarnation: Self.incarnation)
        snapshot.providerSessions = rows
        snapshot.providerInbox = .init(entries: [], sessions: observations, arrivalOrderComplete: true,
            codexSettings: omitCodexEvidence ? nil : .init(snapshot: snapshot))
        return snapshot
    }
    lazy var model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        connectClaude: { [environment] native, terminal in
            environment.launchRequests += 1
            return .init(nativeSessionID: native, project: URL(fileURLWithPath: "/tmp/claude-ordinary"), terminal: terminal)
        }, claudeConnection: connection, connectionSetupPollLimit: 2, connectionSetupPollIntervalNanoseconds: 1,
        onboardingAdapter: environment, appService: service, codexPluginSetupManager: codex,
        hookReadinessManager: hooks, suggestionModeStore: SetupIntegrationSuggestions(),
        projectFolderChooser: environment)

    init(codex: CodexPluginSetupState = .error(code: "codex_native_not_installed"), serviceEnabled: Bool = false) {
        let setup = SetupIntegrationClaude()
        claude = setup
        connection = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.inspect() },
            waitNoticeNanoseconds: 60_000_000_000)
        self.codex = SetupIntegrationCodex(codex)
        let environment = self.environment
        let preferences = SetupIntegrationPreferences()
        preferences.enabled = serviceEnabled
        service = PetAppServiceController(launcher: environment, preference: preferences,
                                         registration: { environment.registrationState })
    }

    func begin(_ selected: Set<PetConnectionSetupProvider>) {
        model.beginFirstRunSetup()
        for provider in PetConnectionSetupProvider.allCases {
            model.setConnectionProviderSelected(provider, selected: selected.contains(provider))
        }
    }

    func readyRow(incarnation: String = incarnation, generation: UInt64 = 1) -> PetProviderSession {
        .init(id: "claude:fixture", context: .init(provider: .claude,
            scopeID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", serviceIncarnation: incarnation,
            sessionIncarnation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            authorityEpoch: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", uiGeneration: generation),
            projectID: "project_claude", sessionID: "session_claude", cwd: "/tmp/claude-ordinary",
            state: "ready", title: "Claude", nativeSessionID: UUID().uuidString.lowercased())
    }

    func entry(_ row: PetProviderSession) -> PetProviderInboxSession {
        .init(session: row, status: .init(provider: .claude, scopeID: row.context.scopeID,
            sessionID: row.sessionID, cwd: row.cwd, bridgeConnected: true, ready: true,
            selectionEnabled: true, latestOutcome: nil), diagnostic: nil)
    }
}

@Suite("Unified connection uses existing adapters without consuming cards")
@MainActor
struct PetConnectionSetupIntegrationTests {
    @Test("An observed storage failure reaches onboarding and stays actionable without setup writes")
    func failedServiceIsNotHiddenByAvailableCodex() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.begin([.codex])
        h.service.enable()
        h.environment.child.terminationSummary = "freshness_storage_missing"
        h.environment.child.isRunning = false
        h.service.checkChildBeforePolling()
        let events = h.environment.events

        await h.model.refreshConnectionSetup()
        #expect(h.model.connectionSetup.serviceIssue?.contains("freshness_storage_missing") == true)
        #expect(h.model.connectionSetup.serviceIssue == h.model.connectionReadiness.checks.first(where: { $0.id == "service" })?.detail)
        #expect(h.model.connectionSetup.phase == .failed)
        for _ in 0..<2 {
            await h.model.refreshFirstRunSetup(inspectSettings: false)
            await h.model.refreshConnectionSetup()
        }
        await h.model.connectSelectedProviders()

        #expect(h.model.connectionSetup.detail.contains("freshness_storage_missing"))
        #expect(!h.model.isConnectionSetupReady)
        #expect(h.environment.events == events && h.environment.folderChoices == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
        #expect(h.environment.launchRequests == 0)

        // Only the fake service is restarted. Fresh verified evidence can
        // clear its failure before any provider settings have been written.
        h.environment.child.isRunning = true
        h.environment.child.terminationSummary = nil
        await h.service.restart()
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(h.model.connectionSetup.serviceIssue == nil)
        #expect(h.model.connectionSetup.state(for: .codex).status == .available)
        #expect(!h.model.isConnectionSetupReady)
        #expect(await h.codex.connects == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Disabled, stopped and starting services do not become fatal onboarding issues",
          arguments: ["disabled", "stopped", "starting"])
    func normalBootstrapHasNoObservedServiceIssue(_ initial: String) async {
        let h = SetupIntegrationHarness(codex: .notInstalled, serviceEnabled: initial == "stopped")
        h.environment.child.hasPublishedService = false
        if initial == "starting" { h.service.enable() }
        h.begin([.codex])

        await h.model.refreshConnectionSetup()

        #expect(h.model.connectionSetup.serviceIssue == nil)
        #expect(h.model.connectionSetup.phase == .idle)
        #expect(h.model.connectionSetup.availableProviders == [.codex])
        #expect(!h.model.isConnectionSetupReady)
        #expect(await h.codex.connects == 0 && h.environment.folderChoices == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Blocked legacy service state is reported without automatic restart or configuration")
    func blockedServiceIsVisible() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.registrationState = .enabled
        h.begin([.codex])
        h.service.enable()

        await h.model.refreshConnectionSetup()
        await h.model.connectSelectedProviders()

        #expect(h.model.connectionSetup.serviceIssue == h.model.appOwnedServiceDetail)
        #expect(h.model.connectionSetup.phase == .failed && !h.model.isConnectionSetupReady)
        #expect(h.environment.launches == 0 && h.environment.folderChoices == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("A retained service failure offers enable after disable and clears only after a verified response")
    func primaryServiceActionEnablesAfterDisable() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.begin([.codex])
        h.service.enable()
        h.environment.child.terminationSummary = "app_service_exited"
        h.environment.child.isRunning = false
        h.service.checkChildBeforePolling()
        await h.model.refreshConnectionSetup()
        let issue = h.model.connectionSetup.serviceIssue
        #expect(issue != nil)

        await h.model.disableAppOwnedService()

        let view = PetConnectionSetupView(viewModel: h.model)
        #expect(h.model.appOwnedServiceState == .disabled && !h.model.isAppOwnedServiceEnabled)
        #expect(h.model.connectionSetup.serviceIssue == issue)
        #expect(view.guidanceStep == .serviceIssue && view.primaryActionEnabled)
        PetL10n.$languageOverride.withValue(.english) {
            #expect(view.primaryActionTitle == "Enable Blabee Service")
        }
        h.environment.child.isRunning = true
        h.environment.child.hasPublishedService = false
        h.environment.child.terminationSummary = nil

        await view.performPrimaryAction()

        #expect(h.model.isAppOwnedServiceEnabled && h.model.appOwnedServiceState == .starting)
        #expect(h.environment.launches == 2)
        #expect(h.model.connectionSetup.serviceIssue == issue && !h.model.isConnectionSetupReady)
        h.environment.child.hasPublishedService = true
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(h.model.appOwnedServiceState == .ready && h.model.connectionSetup.serviceIssue == nil)
        #expect(h.model.connectionSetup.state(for: .codex).status == .available)
        #expect(h.environment.folderChoices == 0 && h.environment.launchRequests == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
        #expect(await h.transport.onlyReadRequests())
        await h.model.shutdownAppOwnedService()
    }

    @Test("Legacy-service guidance unregisters first and requires a second explicit action to restart",
          arguments: [PetServiceRegistrationState.enabled, .requiresApproval])
    func legacyPrimaryActionRequiresSeparateRestart(_ registration: PetServiceRegistrationState) async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.registrationState = registration
        h.environment.unregisterChangesRegistration = true
        h.begin([.codex])
        h.service.enable()
        await h.model.refreshConnectionSetup()
        let view = PetConnectionSetupView(viewModel: h.model)
        #expect(h.model.appOwnedServiceState == .blocked)
        #expect(view.guidanceStep == .legacyService && view.primaryActionEnabled)
        PetL10n.$languageOverride.withValue(.english) {
            #expect(view.primaryActionTitle == "Unregister Previous Service")
        }

        await view.performPrimaryAction()

        #expect(h.environment.events == ["unregister"])
        #expect(h.model.onboardingServiceState == .notRegistered)
        #expect(h.environment.launches == 0 && h.environment.child.stops == 0)
        #expect(view.guidanceStep == .restartService && view.primaryActionEnabled)
        #expect(h.model.connectionSetup.serviceIssue != nil && !h.model.isConnectionSetupReady)
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(h.environment.events == ["unregister"])
        #expect(view.guidanceStep == .restartService)

        await view.performPrimaryAction()

        #expect(h.environment.events == ["unregister", "launch"])
        #expect(h.environment.launches == 1 && h.model.appOwnedServiceState == .ready)
        #expect(h.model.connectionSetup.serviceIssue == nil)
        #expect(h.model.connectionSetup.state(for: .codex).status == .available)
        #expect(h.environment.folderChoices == 0 && h.environment.launchRequests == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
        #expect(await h.transport.onlyReadRequests())
        await h.model.shutdownAppOwnedService()
    }

    @Test("Unknown legacy registration offers only a read-only check")
    func unknownLegacyPrimaryActionIsReadOnly() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.registrationState = .unknown
        h.begin([.codex])
        h.service.enable()
        await h.model.refreshConnectionSetup()
        let generation = h.service.generation
        let view = PetConnectionSetupView(viewModel: h.model)
        #expect(view.guidanceStep == .legacyService && view.primaryActionEnabled)
        #expect(!h.model.canUnregisterOnboardingService)
        PetL10n.$languageOverride.withValue(.english) {
            #expect(view.primaryActionTitle == "Check Again")
        }

        await view.performPrimaryAction()
        await view.performPrimaryAction()

        #expect(view.guidanceStep == .legacyService)
        #expect(h.service.generation == generation && h.environment.events.isEmpty)
        #expect(h.environment.registrationState == .unknown && h.environment.launches == 0)
        #expect(h.environment.folderChoices == 0 && h.environment.launchRequests == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
        #expect(await h.transport.onlyReadRequests())
        #expect(h.model.connectionSetup.serviceIssue != nil && !h.model.isConnectionSetupReady)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Recovery resumes folder, service, Plugin and Hook setup without another Connect click",
          arguments: [CodexPluginSetupState.notInstalled, .installedNeedsHookReview(version: "0.1.3")])
    func recoveryContinuesFullSetup(_ qualified: CodexPluginSetupState) async throws {
        let h = SetupIntegrationHarness(codex: .error(code: "codex_native_path_unsafe"))
        await h.codex.setQualifiedState(qualified)
        h.begin([.codex])
        await h.model.refreshConnectionSetup()
        await h.model.recoverAndContinueCodexSetup()

        #expect(await h.codex.rechecks == 1)
        #expect(await h.codex.connects == (qualified == .notInstalled ? 1 : 0))
        #expect(h.environment.events.prefix(2) == ["defaultFolder", "launch"])
        #expect(h.environment.folderChoices == 0 && h.environment.launches == 1)
        #expect(h.environment.defaultInitializations == 1)
        #expect(h.model.isConnectionSetupReady && h.model.codexHookReadiness == .trusted)
        #expect(!h.model.isContinuingCodexConnectionSetup)
        #expect(await h.transport.onlyReadRequests())
        #expect(await h.claude.enables == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("An unsuccessful native qualification cannot proceed to folders, service or Plugin writes")
    func failedRecoveryCannotPrepare() async {
        let h = SetupIntegrationHarness(codex: .error(code: "codex_native_path_unsafe"))
        await h.codex.setQualifiedState(.error(code: "codex_native_version_unqualified"))
        h.begin([.codex])
        await h.model.refreshConnectionSetup()
        await h.model.recoverAndContinueCodexSetup()
        #expect(await h.codex.rechecks == 1)
        #expect(await h.codex.connects == 0)
        #expect(h.environment.events.isEmpty && h.environment.folderChoices == 0)
        #expect(!h.model.isConnectionSetupReady)
        #expect(h.model.codexPluginSetupState == .error(code: "codex_native_version_unqualified"))
    }

    @Test("Repeated recovery clicks coalesce and cancellation fences a late native success")
    func recoveryCancellationAndDuplicateClicks() async {
        let h = SetupIntegrationHarness(codex: .error(code: "codex_native_path_unsafe"))
        let gate = SetupIntegrationInspectionGate()
        await h.codex.setRecheckGate(gate)
        h.begin([.codex])
        await h.model.refreshConnectionSetup()
        let first = Task { await h.model.recoverAndContinueCodexSetup() }
        await gate.waitForPause()
        #expect(h.model.isContinuingCodexConnectionSetup)
        await h.model.recoverAndContinueCodexSetup()
        h.model.cancelConnectionSetup()
        await h.model.connectSelectedProviders()
        #expect(h.model.isContinuingCodexConnectionSetup)
        await gate.release()
        await first.value
        #expect(await h.codex.rechecks == 1)
        #expect(await h.codex.connects == 0)
        #expect(h.environment.events.isEmpty && h.environment.folderChoices == 0)
        #expect(h.model.codexPluginSetupState == .error(code: "codex_native_path_unsafe"))
        #expect(h.model.codexNativeRecheckReport == nil)
        #expect(!h.model.isContinuingCodexConnectionSetup)
    }

    @Test("A changed setup selection, folder, service or wizard cannot inherit a late recovery",
          arguments: ["selection", "folder", "service", "provider", "wizard"])
    func staleRecoveryDoesNotContinue(change: String) async throws {
        let h = SetupIntegrationHarness(codex: .error(code: "codex_native_path_unsafe"))
        let gate = SetupIntegrationInspectionGate()
        await h.codex.setRecheckGate(gate)
        h.begin([.codex])
        await h.model.refreshConnectionSetup()
        let first = Task { await h.model.recoverAndContinueCodexSetup() }
        await gate.waitForPause()
        switch change {
        case "selection":
            // Even returning to the same selection must fence the old attempt.
            h.model.connectionSetup.setSelected(false, for: .codex)
            h.model.connectionSetup.setSelected(true, for: .codex)
        case "folder":
            h.environment.projects = ["/tmp/a-different-root"]
            await h.model.refreshOnboarding()
            h.environment.projects = []
            await h.model.refreshOnboarding()
        case "service": h.service.enable()
        case "provider":
            var snapshot = try PetSnapshot.parse(petTestData(petTestSnapshotObject(cards: [])))
            snapshot.providerContext = h.readyRow().context
            h.model.applySnapshotForTesting(snapshot)
        default: h.model.endFirstRunSetup()
        }
        await gate.release()
        await first.value
        #expect(await h.codex.connects == 0)
        #expect(h.environment.folderChoices == 0)
        #expect(h.environment.launches == (change == "service" ? 1 : 0))
        #expect(h.model.codexPluginSetupState == .error(code: "codex_native_path_unsafe"))
        #expect(!h.model.isConnectionSetupReady)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Cancelling an atomic Plugin write keeps the busy guard and prevents further provider changes")
    func cancellationDuringPluginWrite() async {
        let h = SetupIntegrationHarness(codex: .error(code: "codex_native_path_unsafe"))
        let gate = SetupIntegrationInspectionGate()
        await h.codex.setConnectionGate(gate)
        h.begin([.codex, .claude])
        await h.model.refreshConnectionSetup()
        let first = Task { await h.model.recoverAndContinueCodexSetup() }
        await gate.waitForPause()
        h.model.cancelConnectionSetup()
        await h.model.recoverAndContinueCodexSetup()
        #expect(h.model.isContinuingCodexConnectionSetup)
        await gate.release()
        await first.value
        #expect(await h.codex.rechecks == 1)
        #expect(await h.codex.connects == 1)
        #expect(await h.claude.enables == 0)
        #expect(h.model.connectionSetup.phase == .cancelled)
        #expect(h.model.codexHookReadiness != .trusted && !h.model.isConnectionSetupReady)
        #expect(h.environment.launches == 1 && h.environment.child.stops == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Returning after Hook review completes only read-only checks and exposes the correct UI step")
    func returningAfterHookReview() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.hooks.setState(.reviewRequired)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        #expect(h.model.isAwaitingCodexHookReview && !h.model.isConnectionSetupReady)
        let waiting = PetConnectionSetupView(viewModel: h.model)
        #expect(waiting.guidanceStep == .hookReview && waiting.primaryActionEnabled)
        let connects = await h.codex.connects
        await h.hooks.setState(.trusted)
        await h.model.refreshConnectionSetupAfterReturningToApp()
        #expect(h.model.codexHookReadiness == .trusted && h.model.isConnectionSetupReady)
        #expect(!h.model.isAwaitingCodexHookReview)
        #expect(PetConnectionSetupView(viewModel: h.model).guidanceStep == .ready)
        #expect(await h.codex.connects == connects)
        #expect(await h.codex.rechecks == 0)
        #expect(h.environment.launches == 1 && h.environment.folderChoices == 0)
        #expect(h.environment.defaultInitializations == 1)
        #expect(h.environment.child.stops == 0 && h.environment.launchRequests == 0)
        #expect(await h.transport.onlyReadRequests())
        #expect(await h.transport.controls == 0)
        h.omitCodexEvidence = true
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(!h.model.isAwaitingCodexHookReview && !h.model.isConnectionSetupReady)
        #expect(PetConnectionSetupView(viewModel: h.model).guidanceStep != .hookReview)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Repeated app activations coalesce while the read-only Hook inspection is slow")
    func returnInspectionCoalesces() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.hooks.setState(.reviewRequired)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        let hookCalls = await h.hooks.calls
        let gate = SetupIntegrationInspectionGate()
        await h.hooks.setState(.trusted)
        await h.hooks.setGate(gate)
        let first = Task { await h.model.refreshConnectionSetupAfterReturningToApp() }
        await gate.waitForPause()
        #expect(h.model.isCheckingConnectionSetupAfterReturn)
        #expect(!h.model.canCheckCodexHooks && !h.model.canDisconnectCodexPlugin)
        #expect(!h.model.canMutateOnboardingProjects && !h.model.canChangeAppOwnedService)
        await h.model.refreshConnectionSetupAfterReturningToApp()
        await h.model.refreshConnectionSetup()
        await h.model.connectSelectedProviders()
        #expect(await h.hooks.calls == hookCalls + 1)
        #expect(await h.codex.connects == 1)
        await gate.release()
        await first.value
        #expect(h.model.isConnectionSetupReady && !h.model.isCheckingConnectionSetupAfterReturn)
        #expect(h.environment.launches == 1 && h.environment.child.stops == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("A late return check cannot revive a changed selection, folder, service or closed setup",
          arguments: ["selection", "folder", "service", "provider", "wizard", "cancel"])
    func staleReturnInspectionIsIgnored(change: String) async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.hooks.setState(.reviewRequired)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        let gate = SetupIntegrationInspectionGate()
        await h.hooks.setState(.trusted)
        await h.hooks.setGate(gate)
        let first = Task { await h.model.refreshConnectionSetupAfterReturningToApp() }
        await gate.waitForPause()
        switch change {
        case "selection":
            h.model.connectionSetup.setSelected(false, for: .codex)
            h.model.connectionSetup.setSelected(true, for: .codex)
        case "folder":
            let original = h.environment.projects
            h.environment.projects = ["/tmp/changed-root"]
            await h.model.refreshOnboarding()
            h.environment.projects = original
            await h.model.refreshOnboarding()
        case "service": await h.service.disable()
        case "provider":
            var snapshot = try PetSnapshot.parse(petTestData(petTestSnapshotObject(cards: [])))
            snapshot.providerContext = h.readyRow().context
            h.model.applySnapshotForTesting(snapshot)
        case "wizard": h.model.endFirstRunSetup()
        case "cancel": h.model.cancelConnectionSetup()
        default: h.model.cancelConnectionSetup()
        }
        await gate.release()
        await first.value
        #expect(h.model.codexHookReadiness != .trusted && !h.model.isConnectionSetupReady)
        #expect(await h.codex.connects == 1)
        #expect(await h.codex.rechecks == 0)
        #expect(h.environment.launches == 1 && h.environment.launchRequests == 0)
        #expect(await h.transport.onlyReadRequests())
        await h.model.shutdownAppOwnedService()
    }

    @Test("A normal health poll during a slow Hook check does not discard the final fresh confirmation")
    func hookInspectionCoexistsWithHealthPolling() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.hooks.setState(.reviewRequired)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        let gate = SetupIntegrationInspectionGate()
        await h.hooks.setState(.trusted)
        await h.hooks.setGate(gate)
        let first = Task { await h.model.refreshConnectionSetupAfterReturningToApp() }
        await gate.waitForPause()
        // The ordinary first-run health poll can finish repeatedly while the
        // external Hook inspection is running. The return check reads again.
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(!h.model.isConnectionSetupReady)
        await gate.release()
        await first.value
        #expect(h.model.isConnectionSetupReady && h.model.codexHookReadiness == .trusted)
        #expect(await h.codex.connects == 1)
        #expect(await h.codex.rechecks == 0)
        #expect(h.environment.launches == 1 && h.environment.child.stops == 0)
        #expect(await h.transport.onlyReadRequests())
        await h.model.shutdownAppOwnedService()
    }

    @Test("A newer snapshot response fences an older final return-check response",
          arguments: [false, true])
    func finalReturnReadCannotOverwriteNewerHealthRead(newerReadFails: Bool) async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.hooks.setState(.reviewRequired)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        await h.hooks.setState(.trusted)
        let gate = SetupIntegrationInspectionGate()
        await h.transport.pauseNextRequest(gate)
        let first = Task { await h.model.refreshConnectionSetupAfterReturningToApp() }
        await gate.waitForPause()
        h.failRead = newerReadFails
        h.omitCodexEvidence = !newerReadFails
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        await gate.release()
        await first.value
        #expect(!h.model.isConnectionSetupReady && h.model.codexHookReadiness != .trusted)
        #expect(!h.model.isAwaitingCodexHookReview)
        #expect((h.model.coordinatorTransportError != nil) == newerReadFails)
        #expect(await h.codex.connects == 1)
        #expect(h.environment.launches == 1 && h.environment.child.stops == 0)
        #expect(await h.transport.onlyReadRequests())
        await h.model.shutdownAppOwnedService()
    }

    @Test("Connection settings observe Hook review on return and ignore a response after closing",
          arguments: [false, true])
    func settingsReturnInspection(closeWhileChecking: Bool) async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.hooks.setState(.reviewRequired)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        h.model.endFirstRunSetup()
        await h.model.beginOnboarding()
        h.model.selectSettingsTab(.connection)
        await h.model.refresh()
        #expect(h.model.isShowingSettings && h.model.selectedSettingsTab == .connection)
        #expect(h.model.isAwaitingCodexHookReview)
        let gate = SetupIntegrationInspectionGate()
        await h.hooks.setState(.trusted)
        await h.hooks.setGate(gate)
        let first = Task { await h.model.refreshConnectionSetupAfterReturningToApp() }
        await gate.waitForPause()
        if closeWhileChecking { h.model.closeOnboarding() }
        await gate.release()
        await first.value
        #expect((h.model.codexHookReadiness == .trusted) == !closeWhileChecking)
        #expect(h.model.isConnectionSetupReady == !closeWhileChecking)
        #expect(h.model.isShowingSettings == !closeWhileChecking)
        #expect(await h.codex.connects == 1)
        #expect(await h.codex.rechecks == 0)
        #expect(h.environment.launches == 1 && h.environment.launchRequests == 0)
        #expect(h.environment.child.stops == 0)
        #expect(await h.transport.controls == 0)
        if !closeWhileChecking { #expect(await h.transport.latestRequestIsReadOnly()) }
        await h.model.shutdownAppOwnedService()
    }

    @Test("A failed read on return withdraws readiness without restarting or resending")
    func failedReturnReadCannotGrantReadiness() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.hooks.setState(.reviewRequired)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        await h.hooks.setState(.trusted)
        h.failRead = true
        await h.model.refreshConnectionSetupAfterReturningToApp()
        #expect(!h.model.isConnectionSetupReady && h.model.codexHookReadiness != .trusted)
        #expect(h.model.coordinatorTransportError != nil)
        #expect(h.environment.launches == 1 && h.environment.child.stops == 0)
        #expect(await h.codex.connects == 1)
        #expect(await h.transport.onlyReadRequests())
        #expect(await h.transport.controls == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Foreground activation cannot start recovery or install missing provider settings")
    func returningWithoutPreparedCodexDoesNothing() async {
        let h = SetupIntegrationHarness(codex: .error(code: "codex_native_path_unsafe"))
        h.begin([.codex])
        await h.model.refreshConnectionSetup()
        let inspections = await h.codex.inspections
        await h.model.refreshConnectionSetupAfterReturningToApp()
        #expect(await h.codex.inspections == inspections)
        #expect(await h.codex.rechecks == 0)
        #expect(await h.codex.connects == 0)
        #expect(h.environment.events.isEmpty && h.environment.folderChoices == 0)
        #expect(await h.claude.enables == 0)
        #expect(!h.model.isAwaitingCodexHookReview && !h.model.isConnectionSetupReady)
    }

    @Test("Missing app-owned setup never falls back to a new legacy service registration")
    func missingAppOwnedServiceDoesNotRegister() async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        let model = PetViewModel(transport: h.transport, externalApplicationOpener: PetFakeApplicationOpener(),
            claudeConnection: h.connection, onboardingAdapter: h.environment,
            codexPluginSetupManager: h.codex, hookReadinessManager: SetupIntegrationHooks(),
            suggestionModeStore: SetupIntegrationSuggestions(), projectFolderChooser: h.environment)
        model.beginFirstRunSetup()
        model.setConnectionProviderSelected(.codex, selected: true)
        await model.connectSelectedProviders()

        #expect(model.connectionSetup.phase == .failed)
        #expect(!model.isConnectionSetupReady && !model.canRegisterOnboardingService)
        #expect(h.environment.events.isEmpty && h.environment.folderChoices == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
        #expect(await h.transport.onlyReadRequests())
        model.endFirstRunSetup()
    }

    @Test("One-click setup leaves existing or unknown legacy registration untouched",
          arguments: [PetServiceRegistrationState.enabled, .requiresApproval, .unknown])
    func legacyRegistrationCannotBePreparedImplicitly(_ registration: PetServiceRegistrationState) async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.registrationState = registration
        h.begin([.codex, .claude])
        await h.model.connectSelectedProviders()

        #expect(h.model.connectionSetup.phase == .failed && !h.model.isConnectionSetupReady)
        #expect(h.environment.registrationState == registration)
        #expect(h.model.showsLegacyServiceSettings && !h.model.canRegisterOnboardingService)
        #expect(h.model.canUnregisterOnboardingService == (registration != .unknown))
        #expect(h.environment.events.isEmpty && h.environment.folderChoices == 0)
        #expect(h.environment.launches == 0 && h.environment.launchRequests == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
        #expect(await h.transport.onlyReadRequests())
        h.model.endFirstRunSetup()
    }

    @Test("Shared and expanded-detail discovery use one inspection without losing available providers", arguments: [true, false])
    func simultaneousDiscovery(pauseCodex: Bool) async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        let gate = SetupIntegrationInspectionGate()
        if pauseCodex { await h.codex.setGate(gate) } else { await h.claude.setGate(gate) }
        h.model.beginFirstRunSetup()
        let first = Task { await h.model.refreshConnectionSetup() }
        await gate.waitForPause()
        await h.model.refreshConnectionSetup()
        await gate.release()
        await first.value
        #expect(h.model.connectionSetup.selectedProviders == [.codex, .claude])
        #expect(h.model.connectionSetup.state(for: .codex).status == .available)
        #expect(h.model.connectionSetup.state(for: .claude).status == .available)
        #expect(h.environment.launches == 0 && h.environment.folderChoices == 0)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 0)
    }

    @Test("Claude-only starts service and configures without Codex, project picker, terminal launch or card consumption")
    func claudeOnly() async throws {
        let h = SetupIntegrationHarness()
        h.begin([.claude])
        await h.model.connectSelectedProviders()
        #expect(h.environment.launches == 1)
        #expect(h.environment.folderChoices == 0 && h.environment.launchRequests == 0)
        #expect(h.environment.defaultInitializations == 0 && !h.environment.scopeIsSaved)
        #expect(await h.codex.connects == 0)
        #expect(await h.claude.enables == 1)
        #expect(h.model.isConnectionSetupReady)
        #expect(h.model.connectionSetup.state(for: .claude).sessionEvidence == .waitingForSession)
        #expect(h.connection.phase == .idle)
        #expect(h.model.snapshot == nil && h.model.displayInteraction == nil)
        #expect(await h.transport.onlyReadRequests())
        #expect(await h.transport.controls == 0)
        await h.model.connectSelectedProviders()
        #expect(h.environment.launches == 1 && h.environment.child.stops == 0)
        #expect(await h.claude.enables == 1)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Codex defaults to the home scope once before launch without a picker, and still verifies Hook trust")
    func projectBeforeService() async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        #expect(h.environment.events.prefix(2) == ["defaultFolder", "launch"])
        #expect(h.environment.folderChoices == 0 && h.environment.defaultInitializations == 1)
        #expect(h.model.configuredProjectScopeExists)
        #expect(h.model.configuredProjectPaths == [h.environment.defaultHome])
        #expect(await h.codex.connects == 1)
        #expect(h.model.codexHookReadiness == .trusted)
        #expect(h.model.isConnectionSetupReady)
        #expect(await h.transport.onlyReadRequests())
        #expect(await h.claude.enables == 0)
        await h.model.connectSelectedProviders()
        #expect(h.environment.defaultInitializations == 1 && h.environment.launches == 1)
        h.omitCodexEvidence = true
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(!h.model.isConnectionSetupReady)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Passive discovery preserves missing scope without initializing the home or opening a picker")
    func missingScopeDiscoveryIsReadOnly() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.begin([.codex])
        await h.model.refreshConnectionSetup()
        await h.model.refreshOnboarding()
        #expect(h.model.configuredProjectPathsAreAuthoritative && !h.model.configuredProjectScopeExists)
        #expect(h.model.configuredProjectPaths.isEmpty)
        #expect(h.model.connectionSetup.state(for: .codex).status == .available)
        #expect(h.environment.defaultInitializations == 0 && h.environment.folderChoices == 0)
        #expect(h.environment.events.isEmpty && !h.environment.scopeIsSaved)
    }

    @Test("Existing custom and explicitly empty scopes never expand to the home on Connect",
          arguments: [[], ["/tmp/custom-codex-root"]])
    func existingScopePreserved(_ paths: [String]) async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.projects = paths
        h.begin([.codex])
        for _ in 0..<2 { await h.model.connectSelectedProviders() }
        #expect(h.model.configuredProjectScopeExists && h.model.configuredProjectPathsAreAuthoritative)
        #expect(h.model.configuredProjectPaths == paths && h.environment.projects == paths)
        #expect(h.environment.defaultInitializations == 0 && h.environment.folderChoices == 0)
        #expect(h.environment.launches == (paths.isEmpty ? 0 : 1))
        #expect(await h.codex.connects == (paths.isEmpty ? 0 : 1))
        if paths.isEmpty {
            #expect(h.model.connectionSetup.state(for: .codex).status == .needsAction)
            #expect(!h.model.isConnectionSetupReady)
        } else {
            #expect(h.model.isConnectionSetupReady)
        }
        await h.model.shutdownAppOwnedService()
    }

    @Test("An unverifiable scope is never treated as a missing scope")
    func invalidScopeCannotDefault() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.scopeReadFails = true
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        #expect(!h.model.configuredProjectPathsAreAuthoritative)
        #expect(h.environment.defaultInitializations == 0 && h.environment.events.isEmpty)
        #expect(await h.codex.connects == 0 && !h.model.isConnectionSetupReady)
    }

    @Test("A failed default write stops before launching the service or configuring the Plugin")
    func failedDefaultCannotLaunchService() async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.defaultScopeFails = true
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        #expect(h.environment.defaultInitializations == 1 && h.environment.events.isEmpty)
        #expect(!h.environment.scopeIsSaved && h.environment.launches == 0)
        #expect(h.model.connectionSetup.phase == .failed && !h.model.isConnectionSetupReady)
        #expect(await h.codex.connects == 0)
    }

    @Test("A scope saved by another writer during initialization remains authoritative",
          arguments: [[], ["/tmp/newly-saved-custom-root"]])
    func scopeAppearingDuringDefaultIsPreserved(_ paths: [String]) async {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.environment.scopeAppearingDuringInitialization = paths
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        #expect(h.environment.defaultInitializations == 1 && h.environment.folderChoices == 0)
        #expect(h.environment.projects == paths && h.model.configuredProjectPaths == paths)
        #expect(h.model.configuredProjectScopeExists)
        #expect(!h.environment.events.contains("defaultFolder"))
        #expect(h.environment.launches == (paths.isEmpty ? 0 : 1))
        #expect(await h.codex.connects == (paths.isEmpty ? 0 : 1))
        await h.model.shutdownAppOwnedService()
    }

    @Test("A missing-to-saved-empty scope transition fences a late native qualification")
    func lateRecoveryCannotRestoreMissingScope() async {
        let h = SetupIntegrationHarness(codex: .error(code: "codex_native_path_unsafe"))
        let gate = SetupIntegrationInspectionGate()
        await h.codex.setRecheckGate(gate)
        h.begin([.codex])
        await h.model.refreshConnectionSetup()
        let task = Task { await h.model.recoverAndContinueCodexSetup() }
        await gate.waitForPause()
        h.environment.projects = []
        await h.model.refreshOnboarding()
        await gate.release()
        await task.value
        #expect(h.model.configuredProjectScopeExists && h.model.configuredProjectPaths.isEmpty)
        #expect(h.environment.defaultInitializations == 0 && h.environment.launches == 0)
        #expect(await h.codex.connects == 0)
        #expect(!h.model.isConnectionSetupReady)
    }

    @Test("Codex failure does not undo Claude setup and explicit defer unlocks completion")
    func partialFailure() async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        await h.codex.setFailure()
        h.begin([.codex, .claude])
        await h.model.connectSelectedProviders()
        #expect(h.model.connectionSetup.state(for: .codex).status == .failed)
        #expect(h.model.connectionSetup.state(for: .claude).status == .configured)
        #expect(!h.model.isConnectionSetupReady)
        h.model.setConnectionProviderSelected(.codex, selected: false)
        #expect(h.model.isConnectionSetupReady)
        #expect(await h.claude.enables == 1)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Adding a root to an already running service never restarts active sessions implicitly")
    func activeServicePreserved() async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.service.enable()
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        #expect(h.environment.folderChoices == 0 && h.environment.defaultInitializations == 1)
        #expect(h.environment.launches == 1 && h.environment.child.stops == 0)
        #expect(h.model.projectSettingsNeedRestart)
        #expect(!h.model.isConnectionSetupReady)
        #expect(h.model.connectionSetup.state(for: .codex).status == .needsAction)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Ordinary CLI readiness is observed without inventing a launcher receipt, and stale scopes are rejected")
    func ordinaryCLI() async throws {
        let h = SetupIntegrationHarness()
        h.begin([.claude])
        await h.model.connectSelectedProviders()
        let row = h.readyRow()
        h.rows = [row]; h.observations = [h.entry(row)]
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(h.model.connectionSetup.state(for: .claude).sessionEvidence == .ready)
        #expect(h.connection.phase == .idle && h.connection.matchedSession == nil)
        let old = h.readyRow(incarnation: UUID().uuidString.lowercased())
        h.rows = [old]; h.observations = [h.entry(old)]
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(h.model.connectionSetup.state(for: .claude).sessionEvidence != .ready)
        h.rows = [row]; h.observations = [h.entry(h.readyRow(generation: 2))]
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(h.model.connectionSetup.state(for: .claude).sessionEvidence != .ready)
        #expect(await h.transport.controls == 0)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Read failure immediately withdraws first-run completion until a fresh response succeeds")
    func failedReadWithdrawsCompletion() async throws {
        let h = SetupIntegrationHarness()
        h.begin([.claude])
        await h.model.connectSelectedProviders()
        #expect(h.model.isConnectionSetupReady)
        h.failRead = true
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(!h.model.isConnectionSetupReady)
        #expect(h.model.connectionSetup.state(for: .claude).sessionEvidence == .unavailable)
        h.failRead = false
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(h.model.isConnectionSetupReady)
        await h.model.shutdownAppOwnedService()
    }

    @Test("Explicit Claude new-session setup can prepare during onboarding without normal polling")
    func firstRunClaudeLaunch() async throws {
        let h = SetupIntegrationHarness()
        h.begin([.claude])
        await h.model.connectClaudeSession(terminal: .terminal)
        #expect(h.environment.launches == 1 && h.environment.launchRequests == 1)
        #expect(h.connection.phase == .waitingForSession)
        #expect(h.model.snapshot == nil)
        #expect(await h.transport.onlyReadRequests())
        #expect(await h.transport.controls == 0)
        await h.model.shutdownAppOwnedService()
    }
}
