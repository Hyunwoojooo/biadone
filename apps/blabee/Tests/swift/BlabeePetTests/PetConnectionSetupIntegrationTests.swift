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
    var terminationSummary: String? { nil }
    var stops = 0
    func stop() async { stops += 1; isRunning = false }
}

@MainActor
private final class SetupIntegrationEnvironment: PetOnboardingAdapting, PetProjectFolderChoosing, AppOwnedServiceLaunching {
    let child = SetupIntegrationChild()
    var projects: [String] = []
    var activeProjects: [String] = []
    var events: [String] = []
    var launches = 0
    var folderChoices = 0
    var launchRequests = 0
    var registrationState: PetServiceRegistrationState = .notRegistered
    var configuredFolder: URL? = URL(fileURLWithPath: "/tmp/blabee-one-click-project")
    func serviceRegistrationState() -> PetServiceRegistrationState { registrationState }
    func configuredProjectPaths() throws -> [String] { projects }
    func registerService() throws { events.append("register") }
    func unregisterService() async throws { events.append("unregister") }
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
    var inspectionGate: SetupIntegrationInspectionGate?
    init(_ state: CodexPluginSetupState) { self.state = state }
    func setFailure() { failConnect = true }
    func setGate(_ gate: SetupIntegrationInspectionGate) { inspectionGate = gate }
    func inspect() async -> CodexPluginSetupState {
        await inspectionGate?.pause()
        return state
    }
    func connect() async -> CodexPluginSetupState {
        connects += 1
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

private struct SetupIntegrationHooks: PetHookReadinessManaging {
    func inspect(projectURL: URL) async -> PetHookReadinessState { .trusted }
}

private struct SetupIntegrationSuggestions: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) {}
}

private actor SetupIntegrationTransport: PetProviderControlling {
    let read: @MainActor @Sendable () throws -> PetSnapshot
    var requests: [(String, Data)] = []
    var controls = 0
    var last: PetSnapshot?
    init(read: @escaping @MainActor @Sendable () throws -> PetSnapshot) { self.read = read }
    func request(type: String, payload: Data) async throws -> Data {
        requests.append((type, payload))
        guard type == "get_state" else { throw PetTestError.injected("unexpected_mutation") }
        last = try await read()
        return Data("fixture".utf8)
    }
    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot {
        guard let last else { throw PetTestError.injected("no_snapshot") }
        return last
    }
    func selectSession(_ session: PetProviderSession) async throws { controls += 1 }
    func checkConnection(_ context: PetProviderContext) async throws { controls += 1 }
    func disconnect(_ context: PetProviderContext) async throws { controls += 1 }
    func onlyReadRequests() -> Bool { requests.allSatisfy { $0.0 == "get_state" && $0.1 == Data("{}".utf8) } }
}

@MainActor
private final class SetupIntegrationHarness {
    static let incarnation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    let environment = SetupIntegrationEnvironment()
    let claude: SetupIntegrationClaude
    let connection: PetClaudeConnectionController
    let codex: SetupIntegrationCodex
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
        hookReadinessManager: SetupIntegrationHooks(), suggestionModeStore: SetupIntegrationSuggestions(),
        projectFolderChooser: environment)

    init(codex: CodexPluginSetupState = .error(code: "codex_native_not_installed")) {
        let setup = SetupIntegrationClaude()
        claude = setup
        connection = PetClaudeConnectionController(inspect: { await setup.inspect() },
            enable: { await setup.enable() }, disable: { await setup.inspect() },
            waitNoticeNanoseconds: 60_000_000_000)
        self.codex = SetupIntegrationCodex(codex)
        let environment = self.environment
        service = PetAppServiceController(launcher: environment, preference: SetupIntegrationPreferences(),
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

    @Test("Codex saves selected folder before first service launch and verifies Hook trust")
    func projectBeforeService() async throws {
        let h = SetupIntegrationHarness(codex: .notInstalled)
        h.begin([.codex])
        await h.model.connectSelectedProviders()
        #expect(h.environment.events.prefix(2) == ["folder", "launch"])
        #expect(h.environment.folderChoices == 1)
        #expect(await h.codex.connects == 1)
        #expect(h.model.codexHookReadiness == .trusted)
        #expect(h.model.isConnectionSetupReady)
        #expect(await h.transport.onlyReadRequests())
        #expect(await h.claude.enables == 0)
        h.omitCodexEvidence = true
        await h.model.refreshFirstRunSetup(inspectSettings: false)
        #expect(!h.model.isConnectionSetupReady)
        await h.model.shutdownAppOwnedService()
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
        #expect(h.environment.folderChoices == 1)
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
