#if BLABEE_TEST_APP
import AppKit
import Combine
import CoordinatorSwift
import Foundation

/// Counts only local simulations. None of these observations is provider,
/// Engine, OAuth, command-delivery, or command-execution evidence.
struct BlabeeTestSimulationMetrics: Codable, Equatable, Sendable {
    var snapshotRequests = 0
    var pluginConnections = 0
    var hookInspections = 0
    var simulatedServiceStarts = 0
    var simulatedBrowserRequests = 0
    var selections = 0
    var skips = 0
    var deniedExternalOperations = 0
}

@MainActor
final class BlabeeTestComposition: ObservableObject {
    let viewModel: PetViewModel
    @Published private(set) var firstRun: PetFirstRunController
    let preferences: PetFirstRunPreferences
    let engineSession: BlabeeTestEngineSession?
    private(set) var isActive = true
    private var activated = false
    private let environment: BlabeeTestSimulationEnvironment
    private let account: PetAccountController
    private let productAccess: PetAccessController
    private let service: PetAppServiceController

    init(store: BlabeeTestRunStore, run: BlabeeTestRunManifest,
         applyTheme: @escaping @MainActor (PetFirstRunTheme) -> Void = { theme in
             switch theme {
             case .system: NSApplication.shared.appearance = nil
             case .light: NSApplication.shared.appearance = NSAppearance(named: .aqua)
             case .dark: NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
             }
         }, now: @escaping @MainActor () -> Date = Date.init,
         makeEngineSession: (@MainActor (BlabeeTestRunStore, BlabeeTestRunManifest) throws -> BlabeeTestEngineSession)? = nil) throws {
        try store.validate(run)
        guard let defaults = UserDefaults(suiteName: run.defaultsSuiteName) else {
            throw BlabeeTestRunStoreError.invalidSnapshot
        }
        let engine: BlabeeTestEngineSession?
        if run.scenario.usesRealEngine {
            engine = try makeEngineSession?(store, run) ?? BlabeeTestEngineSession(store: store, run: run)
        } else { engine = nil }
        engineSession = engine
        let environment = try BlabeeTestSimulationEnvironment(store: store, run: run, now: now, engine: engine)
        self.environment = environment
        preferences = PetFirstRunPreferences(defaults: defaults, loginItem: environment,
            applyTheme: { theme in
                guard environment.active else { return }
                applyTheme(theme)
            })
        firstRun = PetFirstRunController(store: environment.firstRunStore(), legalDocuments: .placeholder)
        let account = PetAccountController(service: environment, store: environment, browser: environment,
            configuration: .init(supabaseURL: URL(string: "https://blabee-test.invalid")!,
                                 publishableKey: "simulated-public-configuration"),
            automaticRefresh: false,
            makeVerifier: { String(repeating: "simulation-verifier-", count: 3) })
        self.account = account
        let service = PetAppServiceController(launcher: environment,
            preference: environment, registration: { .notRegistered }, errorDiagnostics: nil)
        self.service = service
        environment.service = service
        let transport = BlabeeTestSimulationTransport(environment: environment)
        let access = PetAccessController(transport: transport,
            // All requests target the memory transport. Keep the common
            // generation-learning/update-ACK loop, including later logins.
            ownedAccess: { [weak service] in service?.petProviderAccess }, automaticPolling: true)
        productAccess = access
        let claude = PetClaudeConnectionController(
            inspect: { await environment.claudeInspection() },
            enable: { await environment.setClaudeEnabled(true) },
            disable: { await environment.setClaudeEnabled(false) })
        // The transaction is disabled in the Test compilation. Every external
        // dependency is also replaced so a future UI action cannot fall back.
        let update = AppUpdateTransactionController(
            downloader: .init(temporaryDirectory: run.resultsURL,
                download: { _, _ in throw BlabeeTestSimulationError.externalOperationDisabled },
                run: { _, _, _ in throw BlabeeTestSimulationError.externalOperationDisabled },
                runtimeInspector: { _ in throw BlabeeTestSimulationError.externalOperationDisabled }),
            store: .init(rootURL: run.resultsURL.appendingPathComponent("disabled-updates")),
            safePointWaiter: .init(requireReady: { _ in throw BlabeeTestSimulationError.externalOperationDisabled }),
            closedSessionsWaiter: .init(requireReady: { _ in throw BlabeeTestSimulationError.externalOperationDisabled }),
            prepareDownload: { _ in throw BlabeeTestSimulationError.externalOperationDisabled },
            cleanupDownload: { _ in throw BlabeeTestSimulationError.externalOperationDisabled },
            installedVersion: { throw BlabeeTestSimulationError.externalOperationDisabled },
            prepareConnectionRecovery: { throw BlabeeTestSimulationError.externalOperationDisabled },
            prepareHelper: { _, _ in throw BlabeeTestSimulationError.externalOperationDisabled },
            terminateApplication: {})
        viewModel = PetViewModel(transport: transport, externalApplicationOpener: environment,
            provider: .codex,
            startClaude: { try environment.denyExternalOperation() },
            connectClaude: { _, _ in try environment.denyExternalOperation(); return nil },
            claudeConnection: claude,
            connectionSetupStore: PetConnectionSetupUserDefaultsSelectionStore(defaults: defaults),
            connectionSetupPollLimit: 2, connectionSetupPollIntervalNanoseconds: 1,
            onboardingAdapter: environment, appService: service,
            codexPluginSetupManager: BlabeeTestCodexSetup(environment: environment),
            hookReadinessManager: BlabeeTestHooks(environment: environment),
            storageRecoveryManager: PetUnavailableStorageRecoveryManager(),
            legacyShellCleanupManager: LegacyUnavailableCodexShellCleanupManager(),
            suggestionModeStore: BlabeeSuggestionModeStore(defaults: defaults),
            projectFolderChooser: environment,
            appUpdateChecker: PetUnavailableAppUpdateChecker(reason: "TEST · Updates are disabled in UI simulation."),
            appUpdateURLOpener: { _ in environment.metrics.deniedExternalOperations += 1; return false },
            automaticAppUpdate: update,
            account: account, productAccess: access, usageAnalytics: nil,
            errorDiagnostics: nil, feedback: nil, insightCards: nil,
            choicePreviewHoldMonitor: .init(modifierIsPressed: { _ in false }, keyIsPressed: { _ in false }))
        viewModel.firstRunPreferences = preferences
        account.onPhaseChanged = { [weak self] phase in
            guard let self, self.isActive else { return }
            self.synchronizeAccount(phase)
        }
        account.onVerifiedCredential = { [weak access] in access?.receiveVerifiedCredential($0) }
        account.onCredentialInvalidated = { [weak access] in access?.invalidateCredential() }
        configureFirstRunCompletion()
    }

    func activate() async {
        guard isActive, !activated else { return }
        activated = true
        preferences.applyAppearance()
        viewModel.beginFirstRunSetup()
        service.startAtAppLaunch()
        productAccess.start()
        await account.restoreIfNeeded()
        guard isActive, !Task.isCancelled else { return }
        synchronizeAccount(account.phase)
        await viewModel.refreshFirstRunSetup()
        guard isActive, !Task.isCancelled else { return }
        await productAccess.synchronize()
    }

    /// Replays presentation only. The same simulated account, project, Plugin,
    /// and service objects remain. This does not repeat real authentication.
    func replayOnboarding() throws {
        guard isActive else { throw CancellationError() }
        viewModel.cancelConnectionSetup()
        viewModel.stopPolling()
        viewModel.endFirstRunSetup()
        try environment.resetOnboarding()
        firstRun.onComplete = nil
        firstRun = PetFirstRunController(store: environment.firstRunStore(), legalDocuments: .placeholder)
        synchronizeAccount(account.phase)
        configureFirstRunCompletion()
        viewModel.beginFirstRunSetup()
    }

    func invalidate() {
        guard isActive else { return }
        isActive = false
        environment.active = false
        engineSession?.invalidate()
        firstRun.onComplete = nil
        viewModel.cancelConnectionSetup()
        viewModel.stopPolling()
        account.stop()
        productAccess.stop()
    }

    func stop() async {
        invalidate()
        await environment.releaseResponses()
        await viewModel.shutdownAppOwnedService()
    }

    /// A real Engine must stop before the workspace releases its run lease.
    /// Unlike the simulation, a failed drain is an error, never a successful reset.
    func drain() async throws {
        await stop()
        try await engineSession?.drain()
    }

    func releaseDelayedResponse() async {
        guard isActive else { return }
        await environment.releaseResponses()
    }

    func simulationMetrics() async -> BlabeeTestSimulationMetrics { environment.metrics }

    private func configureFirstRunCompletion() {
        firstRun.onComplete = { [weak self] in
            guard let self, self.isActive else { return }
            self.viewModel.endFirstRunSetup()
        }
    }

    private func synchronizeAccount(_ phase: PetAccountPhase) {
        if case let .signedIn(user) = phase {
            firstRun.synchronizeAccount(id: user.id, email: user.email)
        } else {
            firstRun.synchronizeAccount(id: nil, email: nil, isVerifying: phase == .checking)
        }
    }
}

private enum BlabeeTestSimulationError: Error, LocalizedError {
    case externalOperationDisabled, invalidRequest, simulatedFailure
    var errorDescription: String? {
        switch self {
        case .externalOperationDisabled: "TEST · This external operation is disabled in UI simulation."
        case .invalidRequest: "TEST · The simulation request was rejected."
        case .simulatedFailure: "TEST · Simulated connection failure. Choose Retry to continue."
        }
    }
}

private struct BlabeeTestSavedUI: Codable {
    var version = 1
    var firstRun = PetFirstRunState()
    var projects: [String] = []
    var projectScopeIsSaved = false
    var pluginConnected = false
    var claudeEnabled = false

    private enum CodingKeys: String, CodingKey {
        case version, firstRun, projects, projectScopeIsSaved, pluginConnected, claudeEnabled
    }

    init() {}

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        firstRun = try values.decode(PetFirstRunState.self, forKey: .firstRun)
        projects = try values.decode([String].self, forKey: .projects)
        // Earlier snapshots did not distinguish missing settings from a saved
        // empty scope. Preserve their recorded scope instead of expanding it.
        projectScopeIsSaved = try values.decodeIfPresent(Bool.self, forKey: .projectScopeIsSaved) ?? true
        pluginConnected = try values.decode(Bool.self, forKey: .pluginConnected)
        claudeEnabled = try values.decode(Bool.self, forKey: .claudeEnabled)
    }
}

/// A gate uses continuations instead of long sleeps. Cancellation releases its
/// exact waiter, so resetting a run never has to wait for a simulated delay.
private actor BlabeeTestResponseGate {
    private var released = false
    private var waiters: [UUID: CheckedContinuation<Void, any Error>] = [:]
    func wait() async throws {
        try Task.checkCancellation()
        guard !released else { return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()) }
                else { waiters[id] = continuation }
            }
        } onCancel: {
            Task { await self.cancel(id) }
        }
    }
    private func cancel(_ id: UUID) { waiters.removeValue(forKey: id)?.resume(throwing: CancellationError()) }
    func release() {
        released = true
        let pending = waiters.values
        waiters.removeAll()
        for waiter in pending { waiter.resume() }
    }
}

/// Account, provider and system-settings ports stay simulated in both modes.
/// Only an explicit M2 run forwards Engine traffic to its owned local child.
@MainActor
private final class BlabeeTestSimulationEnvironment: PetAccountSessionStoring,
    PetAccountServicing, PetAccountBrowsing, PetOnboardingAdapting, PetProjectFolderChoosing,
    AppOwnedServiceLaunching, PetAppServicePreferenceStoring, PetLoginItemManaging,
    PetExternalApplicationOpening {
    let store: BlabeeTestRunStore
    let run: BlabeeTestRunManifest
    let engine: BlabeeTestEngineSession?
    var active = true
    var metrics = BlabeeTestSimulationMetrics()
    weak var service: PetAppServiceController?
    var enabled: Bool
    private var saved: BlabeeTestSavedUI
    private var onboardingGeneration = UUID()
    private var session: PetAccountSession?
    private var child: BlabeeTestServiceChild?
    private var focused = false
    private var cardConsumed = false
    private var connectFailureConsumed = false
    private var connectionFailurePending = false
    private var hookChecks = 0
    private var accountAttempt = 0
    private let snapshotGate = BlabeeTestResponseGate()
    private let pluginGate = BlabeeTestResponseGate()
    private var accessUserID: String?
    private var accessRevision = 0
    private let now: @MainActor () -> Date
    private var cardExpiresAt: Date { run.createdAt.addingTimeInterval(600) }
    private var cardRemainingMilliseconds: Int64 {
        let remaining = cardExpiresAt.timeIntervalSince(now())
        guard remaining.isFinite, remaining > 0 else { return 0 }
        return Int64(min(600_000, remaining * 1_000))
    }

    // This is display/configuration data only, never a filesystem destination.
    // Match the common folder chooser's normalization before storing it.
    var projectURL: URL { (engine?.paths.projectURL ?? run.settingsURL).standardizedFileURL }
    var status: PetLaunchAtLoginStatus { .unavailable }
    var pluginState: CodexPluginSetupState {
        if !active { return .unavailable(reason: "TEST · Run stopped.") }
        if run.scenario == .codexMissing { return .error(code: "codex_native_not_installed") }
        if connectionFailurePending { return .error(code: "codex_native_path_unsafe") }
        return saved.pluginConnected ? .installedNeedsHookReview(version: "simulation") : .notInstalled
    }

    init(store: BlabeeTestRunStore, run: BlabeeTestRunManifest,
         now: @escaping @MainActor () -> Date, engine: BlabeeTestEngineSession?) throws {
        self.store = store; self.run = run; self.now = now; self.engine = engine
        let projectPath = (engine?.paths.projectURL ?? run.settingsURL).standardizedFileURL.path
        if let data = try store.loadSnapshot(for: run) {
            saved = try JSONDecoder().decode(BlabeeTestSavedUI.self, from: data)
            guard saved.version == 1, saved.projects.allSatisfy({ $0 == projectPath }),
                  saved.projectScopeIsSaved || saved.projects.isEmpty else {
                throw BlabeeTestRunStoreError.invalidSnapshot
            }
        } else {
            saved = BlabeeTestSavedUI()
            if [.connected, .hookPending].contains(run.scenario) || run.scenario.usesRealEngine {
                saved.projects = [projectPath]
                saved.projectScopeIsSaved = true
                saved.pluginConnected = true
                saved.claudeEnabled = run.scenario == .connected
            }
        }
        enabled = [.connected, .hookPending].contains(run.scenario) || run.scenario.usesRealEngine
        if ![.freshInstall, .loginCancelled, .loginFailed].contains(run.scenario) {
            session = Self.simulatedSession(run: run)
        }
    }

    private func requireActive() throws {
        try Task.checkCancellation()
        guard active else { throw CancellationError() }
    }
    private func persist(_ next: BlabeeTestSavedUI) throws {
        try requireActive()
        try store.saveSnapshot(JSONEncoder().encode(next), for: run)
        saved = next
    }
    func firstRunStore() -> any PetFirstRunStoring {
        BlabeeTestFirstRunStore(environment: self, generation: onboardingGeneration)
    }
    func loadFirstRun(generation: UUID) throws -> PetFirstRunState? {
        try requireActive()
        guard generation == onboardingGeneration else { throw CancellationError() }
        return saved.firstRun
    }
    func saveFirstRun(_ state: PetFirstRunState, generation: UUID) throws {
        guard generation == onboardingGeneration else { throw CancellationError() }
        var next = saved; next.firstRun = state; try persist(next)
    }
    func resetOnboarding() throws {
        var next = saved; next.firstRun = PetFirstRunState(); try persist(next)
        onboardingGeneration = UUID()
    }
    func load() throws -> PetAccountSession? { try requireActive(); return session }
    func save(_ value: PetAccountSession) throws { try requireActive(); session = value }
    func clear() throws { try requireActive(); session = nil }

    private static func simulatedSession(run: BlabeeTestRunManifest) -> PetAccountSession {
        .init(accessToken: "simulation-access-" + run.runID.uuidString.lowercased(),
              refreshToken: "simulation-refresh-" + run.runID.uuidString.lowercased(),
              expiresAt: Date().addingTimeInterval(3_600),
              user: .init(id: run.runID.uuidString.lowercased(), email: "tester@blabee-test.invalid"))
    }
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try requireActive()
        guard url.host == "blabee-test.invalid" else { throw BlabeeTestSimulationError.invalidRequest }
        metrics.simulatedBrowserRequests += 1
        accountAttempt += 1
        if run.scenario == .loginCancelled, accountAttempt == 1 { throw PetAccountAuthError.cancelled }
        if run.scenario == .loginFailed, accountAttempt == 1 { throw PetAccountAuthError.serviceUnavailable }
        // Returned directly to the controller, never opened or registered with macOS.
        return URL(string: "\(callbackScheme)://auth/callback?code=simulation-code")!
    }
    func cancel() {}
    func exchange(code: String, verifier: String) async throws -> PetAccountSession {
        try requireActive()
        guard code == "simulation-code", verifier == String(repeating: "simulation-verifier-", count: 3) else {
            throw PetAccountAuthError.invalidCallback
        }
        return Self.simulatedSession(run: run)
    }
    func refresh(_ value: PetAccountSession) async throws -> PetAccountSession { try requireActive(); return value }
    func user(accessToken: String) async throws -> PetAccountUser {
        try requireActive()
        let value = Self.simulatedSession(run: run)
        guard accessToken == value.accessToken else { throw PetAccountAuthError.unauthorized }
        return value.user
    }
    func signOut(accessToken: String) async throws { try requireActive() }

    func serviceRegistrationState() -> PetServiceRegistrationState { .notRegistered }
    func configuredProjectPaths() throws -> [String] { try requireActive(); return saved.projects }
    func configuredProjectPathsIfPresent() throws -> [String]? {
        try requireActive()
        return saved.projectScopeIsSaved ? saved.projects : nil
    }
    func initializeDefaultProjectScopeIfMissing() throws {
        try requireActive()
        guard !saved.projectScopeIsSaved else { return }
        // Test.app substitutes its run-owned fixture for the production home
        // default. Never resolve a live user's home or use a live adapter.
        var next = saved
        next.projects = [projectURL.path]
        next.projectScopeIsSaved = true
        try persist(next)
    }
    func registerService() throws { try denyExternalOperation() }
    func unregisterService() async throws { try denyExternalOperation() }
    func openSystemSettingsLoginItems() { metrics.deniedExternalOperations += 1 }
    func enableProject(at path: String) throws {
        guard path == projectURL.path else { throw BlabeeTestSimulationError.invalidRequest }
        var next = saved; next.projects = [path]; next.projectScopeIsSaved = true; try persist(next)
    }
    func disableProject(at path: String) throws {
        var next = saved; next.projects.removeAll { $0 == path }; next.projectScopeIsSaved = true; try persist(next)
    }
    func chooseProjectFolder() -> URL? { active ? projectURL : nil }
    func launch() throws -> any AppOwnedServiceChild {
        try requireActive()
        if let engine { return try engine.start() }
        metrics.simulatedServiceStarts += 1
        let child = BlabeeTestServiceChild()
        self.child = child
        return child
    }
    func register() throws { try denyExternalOperation() }
    func unregister() throws { try denyExternalOperation() }
    func openSettings() { metrics.deniedExternalOperations += 1 }
    func captureFrontmostExternalApplication(excludingProcessIdentifier: pid_t) -> PetExternalApplicationReference? { nil }
    func open(_ reference: PetExternalApplicationReference) -> Bool { metrics.deniedExternalOperations += 1; return false }
    func denyExternalOperation() throws {
        metrics.deniedExternalOperations += 1
        throw BlabeeTestSimulationError.externalOperationDisabled
    }

    func connectPlugin() async -> CodexPluginSetupState {
        guard active else { return .unavailable(reason: "TEST · Run stopped.") }
        metrics.pluginConnections += 1
        if run.scenario == .pluginPreparing {
            do { try await pluginGate.wait() } catch { return .notInstalled }
        }
        guard active, !Task.isCancelled else { return .notInstalled }
        if run.scenario == .connectionFailed, !connectFailureConsumed {
            connectFailureConsumed = true
            connectionFailurePending = true
            return pluginState
        }
        do {
            var next = saved; next.pluginConnected = true; try persist(next)
            return pluginState
        } catch { return .error(code: "test_simulated_storage_failed") }
    }
    func disconnectPlugin() -> CodexPluginSetupState {
        do { var next = saved; next.pluginConnected = false; try persist(next); return pluginState }
        catch { return .error(code: "test_simulated_storage_failed") }
    }
    func recheckPlugin() -> CodexPluginSetupState {
        // A passive inspection cannot erase a failed write. The common UI's
        // explicit Recheck and Connect action advances this simulated failure.
        if active { connectionFailurePending = false }
        return pluginState
    }
    func inspectHooks() -> PetHookReadinessState {
        guard active else { return .unavailable(code: "test_run_stopped") }
        metrics.hookInspections += 1
        hookChecks += 1
        return run.scenario == .hookPending && hookChecks == 1 ? .reviewRequired : .trusted
    }
    func claudeInspection() -> ClaudeAutoConnectSetup.Inspection {
        .init(isEnabled: active && saved.claudeEnabled, canEnable: active && !saved.claudeEnabled,
              canDisable: active && saved.claudeEnabled,
              detail: "TEST · Simulated Claude settings. No shell files are changed.", canLaunch: active)
    }
    func setClaudeEnabled(_ enabled: Bool) -> ClaudeAutoConnectSetup.Inspection {
        do {
            var next = saved; next.claudeEnabled = enabled; try persist(next)
            return .init(isEnabled: enabled, canEnable: !enabled, canDisable: enabled,
                         detail: "TEST · Simulated Claude settings.", canLaunch: true)
        } catch { return claudeInspection() }
    }
    func releaseResponses() async { await snapshotGate.release(); await pluginGate.release() }

    func request(type: String, payload: Data) async throws -> Data {
        try requireActive()
        if let engine, type != "product_access_v1" {
            return try await engine.request(type: type, payload: payload)
        }
        switch type {
        case "get_state":
            metrics.snapshotRequests += 1
            if run.scenario == .delayedResponse { try await snapshotGate.wait() }
            try requireActive()
            guard child?.isRunning == true else { throw BlabeeTestSimulationError.simulatedFailure }
            return try snapshotData()
        case "product_access_v1":
            return try accessResponse(payload)
        case "focus_interaction":
            try requireCardIdentity(payload)
            focused = true
            return try json(["focused": true])
        case "select":
            try requireCardIdentity(payload)
            guard focused, !cardConsumed else { throw BlabeeTestSimulationError.invalidRequest }
            metrics.selections += 1; cardConsumed = true; focused = false
            return try json(["accepted": true, "outcome": ["kind": "next_turn",
                "continuation_id": "simulation-no-execution", "queued_submission_id": "simulation-no-queue"]])
        case "dismiss_interaction":
            try requireCardIdentity(payload)
            guard !cardConsumed else { throw BlabeeTestSimulationError.invalidRequest }
            metrics.skips += 1; cardConsumed = true; focused = false
            return try json(["dismissed": true, "interaction_id": "simulation_interaction",
                             "packet_id": "simulation_packet", "revision": 1])
        default:
            throw BlabeeTestSimulationError.invalidRequest
        }
    }
    func decodeSnapshot(_ data: Data) throws -> PetSnapshot {
        try requireActive()
        var value = try PetSnapshot.parse(data)
        value.providerDirectory = .init(serviceGeneration: service?.generation ?? 0,
                                       serviceIncarnation: run.runID.uuidString.lowercased())
        return value
    }
    private func accessResponse(_ data: Data) throws -> Data {
        let value = try object(data)
        guard let id = value["request_id"] as? String,
              let revision = value["revision"] as? Int,
              let operation = value["operation"] as? String,
              let expected = service?.petProviderAccess?.credential,
              let provided = value["auth_token"] as? String,
              ContinuationTokenMaterial.constantTimeEqual(provided, expected) else {
            throw BlabeeTestSimulationError.invalidRequest
        }
        if operation == "update", let fields = value["payload"] as? [String: Any],
           fields["user_id"] as? String == run.runID.uuidString.lowercased() {
            accessUserID = run.runID.uuidString.lowercased(); accessRevision = revision
        } else if operation == "clear" { accessUserID = nil; accessRevision = revision }
        return try json(["schema_version": 1, "request_id": id, "revision": accessRevision,
            "service_generation": run.runID.uuidString.lowercased(),
            "state": accessUserID == nil ? "signed_out" : "active",
            "user_id": accessUserID as Any? ?? NSNull(), "remaining_seconds": accessUserID == nil ? 0 : 300])
    }
    private func requireCardIdentity(_ data: Data) throws {
        let value = try object(data)
        guard !cardConsumed, cardRemainingMilliseconds > 0,
              value["interaction_id"] as? String == "simulation_interaction",
              value["packet_id"] as? String == "simulation_packet",
              value["revision"] as? Int == 1 else { throw BlabeeTestSimulationError.invalidRequest }
    }
    private func object(_ data: Data) throws -> [String: Any] {
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BlabeeTestSimulationError.invalidRequest
        }
        return result
    }
    private func json(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
    private func snapshotData() throws -> Data {
        let identity: [String: Any] = ["interaction_id": "simulation_interaction", "packet_id": "simulation_packet",
            "revision": 1, "project_id": "simulation_project", "session_id": "simulation_session",
            "source_turn_id": "simulation_turn", "source_prompt_id": "simulation_prompt",
            "episode_id": "simulation_episode", "episode_root_prompt_id": "simulation_root_prompt",
            "episode_baseline_checkpoint_id": "simulation_checkpoint", "decision_boundary_id": "simulation_boundary",
            "boundary_sequence": 1]
        let showCard = !cardConsumed && saved.pluginConnected
        let remaining = cardRemainingMilliseconds
        let hasFocus = focused && remaining > 0
        let dates = ISO8601DateFormatter()
        dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var pending = identity
        pending.merge(["state": "pending", "foreground": hasFocus, "reminder_due": false,
                       "milliseconds_until_expiry": remaining]) { _, new in new }
        var card = identity
        card.merge(["state": "waiting", "cwd": projectURL.path,
            "summary": PetL10n.text("TEST · Choose a simulated next step. Nothing will be sent to Codex or executed.",
                                      korean: "TEST · 모의 선택입니다. Codex로 전송하거나 작업을 실행하지 않습니다."),
            "sealed_at": dates.string(from: run.createdAt),
            "expires_at": dates.string(from: cardExpiresAt), "valid_after_event_sequence": 1,
            "risk": ["level": "low", "reasons": []], "evidence": [],
            "checkpoint": ["id": "simulation_checkpoint", "coverage": "unavailable"],
            "choices": (1...2).map { slot -> [String: Any] in
                ["slot": slot, "kind": slot == 1 ? "recommended_action" : "alternative_action", "enabled": true,
                 "disabled_reason": NSNull(), "option_id": "simulation_option_\(slot)", "action_id": "simulation_action_\(slot)",
                 "action": ["title": slot == 1 ? PetL10n.text("Simulate selection", korean: "선택 시뮬레이션")
                    : PetL10n.text("Review the mock flow", korean: "모의 흐름 살펴보기"),
                    "objective": "Review local UI behavior only", "constraints": ["No provider or Engine execution"],
                    "done_when": ["The simulation records the chosen button"]]]
            }, "foreground": hasFocus, "reminder_due": false, "milliseconds_until_expiry": remaining]) { _, new in new }
        return try json(["schema_version": "1.0", "kind": "blabee_operational_snapshot",
            "routing": ["schema_version": "1.0", "kind": "blabee_routing_snapshot",
                "selection_enabled": showCard && hasFocus, "foreground": showCard && hasFocus ? identity as Any : NSNull() as Any,
                "pending": showCard ? [pending] : [], "in_flight_count": 0],
            "projects": saved.projects.map { ["project_id": "simulation_project", "cwd": $0, "enabled": true] },
            "sessions": showCard ? [["project_id": "simulation_project", "session_id": "simulation_session",
                "source_turn_id": "simulation_turn", "source_prompt_id": "simulation_prompt", "episode_id": "simulation_episode"]] : [],
            "interactions": showCard ? [card] : [], "permission_requests": [], "permission_notice_count": 0,
            "managed_command_approvals": [], "managed_command_approval_notice_count": 0])
    }
}

/// An old wizard can remain retained by SwiftUI while a replacement appears.
/// It cannot write progress through the replacement wizard's store generation.
@MainActor
private struct BlabeeTestFirstRunStore: PetFirstRunStoring {
    let environment: BlabeeTestSimulationEnvironment
    let generation: UUID
    func load() throws -> PetFirstRunState? { try environment.loadFirstRun(generation: generation) }
    func save(_ state: PetFirstRunState) throws { try environment.saveFirstRun(state, generation: generation) }
}

@MainActor
private final class BlabeeTestServiceChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService: Bool { isRunning }
    var terminationSummary: String? { nil }
    var petSelectorCredential: String? { String(repeating: "a", count: 64) }
    func stop() async { isRunning = false }
}

private struct BlabeeTestCodexSetup: CodexPluginSetupManaging {
    let environment: BlabeeTestSimulationEnvironment
    func inspect() async -> CodexPluginSetupState { await environment.pluginState }
    func recheckNativeExecutableWithReport() async -> CodexPluginCheckResult {
        .init(state: await environment.recheckPlugin())
    }
    func connect() async -> CodexPluginSetupState { await environment.connectPlugin() }
    func disconnect() async -> CodexPluginSetupState { await environment.disconnectPlugin() }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) async -> CodexPluginSetupState {
        .unavailable(reason: "TEST · Legacy migration is disabled in UI simulation.")
    }
}

private struct BlabeeTestHooks: PetHookReadinessManaging {
    let environment: BlabeeTestSimulationEnvironment
    func inspect(projectURL: URL) async -> PetHookReadinessState { await environment.inspectHooks() }
}

private actor BlabeeTestSimulationTransport: PetProviderControlling {
    let environment: BlabeeTestSimulationEnvironment
    init(environment: BlabeeTestSimulationEnvironment) { self.environment = environment }
    func request(type: String, payload: Data) async throws -> Data { try await environment.request(type: type, payload: payload) }
    func decodeSnapshot(_ data: Data) async throws -> PetSnapshot { try await environment.decodeSnapshot(data) }
    func selectSession(_ session: PetProviderSession) async throws { throw BlabeeTestSimulationError.externalOperationDisabled }
    func checkConnection(_ expectedContext: PetProviderContext) async throws { throw BlabeeTestSimulationError.externalOperationDisabled }
    func disconnect(_ expectedContext: PetProviderContext) async throws { throw BlabeeTestSimulationError.externalOperationDisabled }
}
#endif
