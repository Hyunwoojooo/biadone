import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class RecoveryPreferences: PetAppServicePreferenceStoring {
    var enabled = false
}

@MainActor
private final class RecoveryChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = false
    var terminationSummary: String? { nil }
    func stop() async { isRunning = false }
}

@MainActor
private final class RecoveryLauncher: AppOwnedServiceLaunching {
    var launches = 0
    func launch() throws -> any AppOwnedServiceChild {
        launches += 1
        return RecoveryChild()
    }
}

@MainActor
private final class RecoveryAdapter: PetOnboardingAdapting {
    var registration: PetServiceRegistrationState = .notRegistered
    var projects = ["/fixture/one", "/fixture/two"]
    var projectReadFails = false
    func serviceRegistrationState() -> PetServiceRegistrationState { registration }
    func configuredProjectPaths() throws -> [String] {
        if projectReadFails { throw CoordinatorError("fixture_config_read_failed") }
        return projects
    }
    func registerService() throws {}
    func unregisterService() async throws {}
    func openSystemSettingsLoginItems() {}
    func enableProject(at path: String) throws {}
    func disableProject(at path: String) throws {}
}

private struct RecoverySuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) {}
}

private actor RecoveryManager: PetStorageRecoveryManaging {
    var prepares = 0
    var recoveries = 0
    var shouldFail = false
    func failRecovery() { shouldFail = true }
    func prepare() async throws -> PetStorageRecoveryConfirmation {
        prepares += 1
        return .init(id: UUID(), backupDirectoryURL: URL(fileURLWithPath: "/fixture/backup"),
                     residualFileNames: [])
    }
    func recover(confirmation: PetStorageRecoveryConfirmation) async throws -> PetStorageRecoveryReceipt {
        recoveries += 1
        if shouldFail { throw CoordinatorError("storage_recovery_plan_changed") }
        return .init(backupDirectoryURL: confirmation.backupDirectoryURL)
    }
}

private actor RecoveryHookManager: PetHookReadinessManaging {
    var requests: [String] = []
    private var continuation: CheckedContinuation<PetHookReadinessState, Never>?
    func inspect(projectURL: URL) async -> PetHookReadinessState {
        requests.append(projectURL.path)
        return await withCheckedContinuation { continuation = $0 }
    }
    func finish(_ state: PetHookReadinessState = .trusted) {
        continuation?.resume(returning: state)
        continuation = nil
    }
    func hasStarted() -> Bool { continuation != nil }
}

private actor RecoveryPluginManager: CodexPluginSetupManaging {
    func inspect() async -> CodexPluginSetupState { .installedNeedsHookReview(version: "0.1.1") }
    func connect() async -> CodexPluginSetupState { await inspect() }
    func disconnect() async -> CodexPluginSetupState { .notInstalled }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) async -> CodexPluginSetupState {
        await inspect()
    }
}

@Suite("Recovery UI confirmation and Hook evidence")
@MainActor
struct PetConnectionRecoveryTests {
    private func model(
        recovery: RecoveryManager = RecoveryManager(),
        hooks: RecoveryHookManager = RecoveryHookManager(),
        adapter: RecoveryAdapter = RecoveryAdapter(),
        launcher: RecoveryLauncher = RecoveryLauncher()
    ) -> PetViewModel {
        let controller = PetAppServiceController(
            launcher: launcher, preference: RecoveryPreferences(),
            registration: { adapter.registration }
        )
        return PetViewModel(
            transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
            onboardingAdapter: adapter, appService: controller,
            codexPluginSetupManager: RecoveryPluginManager(), hookReadinessManager: hooks,
            storageRecoveryManager: recovery, suggestionModeStore: RecoverySuggestionStore()
        )
    }

    @Test("Prepare and cancel never reset; confirmation starts service exactly once")
    func explicitConfirmation() async throws {
        let manager = RecoveryManager()
        let launcher = RecoveryLauncher()
        let viewModel = model(recovery: manager, launcher: launcher)
        await viewModel.beginOnboarding()
        await viewModel.prepareStorageRecovery()
        #expect(viewModel.storageRecoveryConfirmation != nil)
        #expect(await manager.recoveries == 0)
        viewModel.cancelStorageRecovery()
        await viewModel.confirmStorageRecovery()
        #expect(await manager.recoveries == 0)
        await viewModel.prepareStorageRecovery()
        await viewModel.confirmStorageRecovery()
        await viewModel.confirmStorageRecovery()
        #expect(await manager.recoveries == 1)
        #expect(launcher.launches == 1)
        #expect(viewModel.storageRecoveryReceipt != nil)
        #expect(!viewModel.hasVerifiedServiceConnection)
        #expect(!viewModel.canPrepareStorageRecovery)
        await viewModel.shutdownAppOwnedService()
    }

    @Test("Changed registration blocks recovery; failure never starts service")
    func rejectionPreservesService() async {
        let manager = RecoveryManager()
        let adapter = RecoveryAdapter()
        let launcher = RecoveryLauncher()
        let viewModel = model(recovery: manager, adapter: adapter, launcher: launcher)
        await viewModel.beginOnboarding()
        await viewModel.prepareStorageRecovery()
        adapter.registration = .enabled
        await viewModel.confirmStorageRecovery()
        #expect(await manager.recoveries == 0)
        #expect(launcher.launches == 0)
        adapter.registration = .notRegistered
        await manager.failRecovery()
        await viewModel.confirmStorageRecovery()
        #expect(viewModel.storageRecoveryError?.contains("storage_recovery_plan_changed") == true)
        #expect(viewModel.storageRecoveryReceipt == nil)
        #expect(launcher.launches == 0)
    }

    @Test("Closing settings withdraws a prepared destructive confirmation")
    func closeCancels() async {
        let manager = RecoveryManager()
        let viewModel = model(recovery: manager)
        await viewModel.beginOnboarding()
        await viewModel.prepareStorageRecovery()
        viewModel.closeOnboarding()
        await viewModel.confirmStorageRecovery()
        #expect(viewModel.storageRecoveryConfirmation == nil)
        #expect(await manager.recoveries == 0)
    }

    @Test("Explicit Hook checks reject late results for another project")
    func hookProjectFence() async {
        let hooks = RecoveryHookManager()
        let viewModel = model(hooks: hooks)
        await viewModel.beginOnboarding()
        await viewModel.refreshCodexPluginSetup()
        #expect(await hooks.requests.isEmpty)
        let check = Task { await viewModel.checkCodexHooks() }
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while !(await hooks.hasStarted()), ContinuousClock.now < deadline { await Task.yield() }
        #expect(await hooks.hasStarted())
        #expect(!viewModel.canDisconnectCodexPlugin)
        viewModel.selectHookProject("/fixture/two")
        await hooks.finish()
        await check.value
        #expect(viewModel.codexHookReadiness == .unchecked)
        #expect(viewModel.hookReadinessProjectPath == "/fixture/two")
        #expect(await hooks.requests == ["/fixture/one"])
    }

    @Test("Plugin reinspection withdraws a previously pending Hook result")
    func pluginRefreshFence() async {
        let hooks = RecoveryHookManager()
        let viewModel = model(hooks: hooks)
        await viewModel.beginOnboarding()
        await viewModel.refreshCodexPluginSetup()
        let check = Task { await viewModel.checkCodexHooks() }
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while !(await hooks.hasStarted()), ContinuousClock.now < deadline { await Task.yield() }
        await viewModel.refreshCodexPluginSetup()
        await hooks.finish()
        await check.value
        #expect(viewModel.codexHookReadiness == .unchecked)
        #expect(!viewModel.isCodexHookCheckInFlight)
    }

    @Test("Trusted evidence stays bound to the checked project when snapshot fallback changes")
    func completedHookScopeFenceAndSetupGate() async throws {
        let hooks = RecoveryHookManager()
        let adapter = RecoveryAdapter()
        adapter.projects = ["/tmp/blabee-pet-one"]
        let viewModel = model(hooks: hooks, adapter: adapter)
        await viewModel.beginOnboarding()
        await viewModel.refreshCodexPluginSetup()
        try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [PetTestCard(suffix: "one")]))
        viewModel.setConnectionProviderSelected(.codex, selected: true)
        #expect(!viewModel.isConnectionSetupReady)
        let check = Task { await viewModel.checkCodexHooks() }
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while !(await hooks.hasStarted()), ContinuousClock.now < deadline { await Task.yield() }
        await hooks.finish()
        await check.value
        #expect(viewModel.codexHookReadiness == .trusted)
        #expect(viewModel.isConnectionSetupReady)
        adapter.projectReadFails = true
        await viewModel.refreshOnboarding()
        #expect(viewModel.codexHookReadiness == .trusted)
        try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [PetTestCard(suffix: "two")]))
        #expect(viewModel.hookReadinessProjectPath == "/tmp/blabee-pet-two")
        #expect(viewModel.codexHookReadiness == .unchecked)
        #expect(!viewModel.isConnectionSetupReady)
    }
}
