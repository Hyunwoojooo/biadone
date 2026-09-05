import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private enum PetOnboardingTestError: Error {
    case injected
}

@MainActor
private final class PetFakeOnboardingAdapter: PetOnboardingAdapting {
    var state: PetServiceRegistrationState = .notRegistered
    var configuredPaths: [String] = []
    var stateAfterRegister: PetServiceRegistrationState?
    var stateAfterUnregister: PetServiceRegistrationState?
    var registerError: Error?
    var unregisterError: Error?
    var configuredPathsError: Error?
    var enableError: Error?
    var disableError: Error?
    var blocksUnregister = false

    private(set) var statusCalls = 0
    private(set) var configuredPathsCalls = 0
    private(set) var registerCalls = 0
    private(set) var unregisterCalls = 0
    private(set) var openSystemSettingsCalls = 0
    private(set) var enabledPaths: [String] = []
    private(set) var disabledPaths: [String] = []
    private var unregisterWaiter: CheckedContinuation<Void, Never>?

    func serviceRegistrationState() -> PetServiceRegistrationState {
        statusCalls += 1
        return state
    }

    func configuredProjectPaths() throws -> [String] {
        configuredPathsCalls += 1
        if let configuredPathsError { throw configuredPathsError }
        return configuredPaths
    }

    func registerService() throws {
        registerCalls += 1
        if let stateAfterRegister { state = stateAfterRegister }
        if let registerError { throw registerError }
    }

    func unregisterService() async throws {
        unregisterCalls += 1
        if blocksUnregister {
            await withCheckedContinuation { continuation in
                unregisterWaiter = continuation
            }
        }
        if let stateAfterUnregister { state = stateAfterUnregister }
        if let unregisterError { throw unregisterError }
    }

    func openSystemSettingsLoginItems() {
        openSystemSettingsCalls += 1
    }

    func enableProject(at path: String) throws {
        enabledPaths.append(path)
        if let enableError { throw enableError }
        if !configuredPaths.contains(path) {
            configuredPaths.append(path)
            configuredPaths.sort()
        }
    }

    func disableProject(at path: String) throws {
        disabledPaths.append(path)
        if let disableError { throw disableError }
        configuredPaths.removeAll { $0 == path }
    }

    func resumeUnregister() {
        blocksUnregister = false
        let waiter = unregisterWaiter
        unregisterWaiter = nil
        waiter?.resume()
    }
}

@MainActor
private final class PetFakeProjectFolderChooser: PetProjectFolderChoosing {
    var result: URL?
    private(set) var calls = 0

    init(result: URL? = nil) {
        self.result = result
    }

    func chooseProjectFolder() -> URL? {
        calls += 1
        return result
    }
}

private actor PetFakeCodexPluginSetupManager: CodexPluginSetupManaging {
    var inspectState: CodexPluginSetupState
    var connectState: CodexPluginSetupState
    var disconnectState: CodexPluginSetupState
    var migrateLegacyState: CodexPluginSetupState
    private(set) var inspectCalls = 0
    private(set) var connectCalls = 0
    private(set) var disconnectCalls = 0
    private(set) var migrateLegacyCalls = 0
    private(set) var migrateLegacyConfirmations: [
        CodexPluginSetupLegacyMigrationConfirmation
    ] = []
    private var blocksConnect = false
    private var connectWaiter: CheckedContinuation<Void, Never>?

    init(
        inspectState: CodexPluginSetupState = .notInstalled,
        connectState: CodexPluginSetupState = .installedNeedsHookReview(version: "0.1.0"),
        disconnectState: CodexPluginSetupState = .notInstalled,
        migrateLegacyState: CodexPluginSetupState = .installedNeedsHookReview(version: "0.1.0")
    ) {
        self.inspectState = inspectState
        self.connectState = connectState
        self.disconnectState = disconnectState
        self.migrateLegacyState = migrateLegacyState
    }

    func inspect() async -> CodexPluginSetupState {
        inspectCalls += 1
        return inspectState
    }

    func connect() async -> CodexPluginSetupState {
        connectCalls += 1
        if blocksConnect {
            await withCheckedContinuation { continuation in
                connectWaiter = continuation
            }
        }
        return connectState
    }

    func disconnect() async -> CodexPluginSetupState {
        disconnectCalls += 1
        return disconnectState
    }

    func migrateLegacyInstallation(
        confirmation: CodexPluginSetupLegacyMigrationConfirmation
    ) async -> CodexPluginSetupState {
        migrateLegacyCalls += 1
        migrateLegacyConfirmations.append(confirmation)
        return migrateLegacyState
    }

    func setBlocksConnect(_ value: Bool) {
        blocksConnect = value
    }

    func setInspectState(_ state: CodexPluginSetupState) {
        inspectState = state
    }

    func resumeConnect() {
        blocksConnect = false
        let waiter = connectWaiter
        connectWaiter = nil
        waiter?.resume()
    }

    func callCounts() -> (inspect: Int, connect: Int, disconnect: Int, migrateLegacy: Int) {
        (inspectCalls, connectCalls, disconnectCalls, migrateLegacyCalls)
    }

    func receivedLegacyMigrationConfirmations()
        -> [CodexPluginSetupLegacyMigrationConfirmation]
    {
        migrateLegacyConfirmations
    }
}

@MainActor
private func petOnboardingViewModel(
    adapter: PetFakeOnboardingAdapter,
    chooser: PetFakeProjectFolderChooser = PetFakeProjectFolderChooser(),
    pluginSetupManager: any CodexPluginSetupManaging = PetFakeCodexPluginSetupManager()
) -> (PetViewModel, PetFakeTransport) {
    let transport = PetFakeTransport()
    return (
        PetViewModel(
            transport: transport,
            externalApplicationOpener: PetFakeApplicationOpener(),
            onboardingAdapter: adapter,
            codexPluginSetupManager: pluginSetupManager,
            projectFolderChooser: chooser,
            processIdentifier: 999
        ),
        transport
    )
}

@Test("Opening settings does not execute Codex and Plugin actions remain explicit")
@MainActor
func petCodexPluginSetupUsesExplicitActions() async {
    let adapter = PetFakeOnboardingAdapter()
    let pluginSetupManager = PetFakeCodexPluginSetupManager()
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: adapter,
        pluginSetupManager: pluginSetupManager
    )

    #expect(viewModel.codexPluginSetupState == .unchecked)
    #expect((await pluginSetupManager.callCounts()).connect == 0)
    await viewModel.refreshOnboarding()
    #expect(viewModel.codexPluginSetupState == .unchecked)
    #expect((await pluginSetupManager.callCounts()).inspect == 0)
    #expect((await pluginSetupManager.callCounts()).connect == 0)
    #expect(viewModel.canConnectCodexPlugin)

    await viewModel.refreshCodexPluginSetup()
    #expect(viewModel.codexPluginSetupState == .notInstalled)
    #expect(viewModel.canConnectCodexPlugin)
    #expect((await pluginSetupManager.callCounts()).inspect == 1)
    #expect((await pluginSetupManager.callCounts()).connect == 0)

    await viewModel.connectCodexPlugin()
    #expect(viewModel.codexPluginSetupState == .installedNeedsHookReview(version: "0.1.0"))
    #expect(!viewModel.canConnectCodexPlugin)
    #expect(viewModel.canDisconnectCodexPlugin)
    #expect((await pluginSetupManager.callCounts()).connect == 1)

    await viewModel.disconnectCodexPlugin()
    #expect(viewModel.codexPluginSetupState == .notInstalled)
    #expect((await pluginSetupManager.callCounts()).disconnect == 1)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet requires two explicit steps before migrating a detected legacy Blabee connection")
@MainActor
func petCodexPluginSetupRequiresLegacyMigrationConfirmation() async {
    let adapter = PetFakeOnboardingAdapter()
    let originalConfirmation = CodexPluginSetupLegacyMigrationConfirmation(
        marketplaceName: "blabee-local-dogfood-original",
        marketplaceRootPath: "/tmp/blabee-original/marketplace",
        pluginSelector: "blabee@blabee-local-dogfood-original",
        pluginRootPath: "/tmp/blabee-original/marketplace/plugins/blabee",
        pluginIsInstalled: true,
        pluginVersion: "0.1.0",
        filesystemIdentity: .allMissing
    )
    let originalState = CodexPluginSetupState.legacyInstallationDetected(
        marketplaceName: originalConfirmation.marketplaceName,
        confirmation: originalConfirmation
    )
    let replacementConfirmation = CodexPluginSetupLegacyMigrationConfirmation(
        marketplaceName: "blabee-local-dogfood-replacement",
        marketplaceRootPath: "/tmp/blabee-replacement/marketplace",
        pluginSelector: "blabee@blabee-local-dogfood-replacement",
        pluginRootPath: "/tmp/blabee-replacement/marketplace/plugins/blabee",
        pluginIsInstalled: true,
        pluginVersion: "0.1.0",
        filesystemIdentity: .allMissing
    )
    let replacementState = CodexPluginSetupState.legacyInstallationDetected(
        marketplaceName: replacementConfirmation.marketplaceName,
        confirmation: replacementConfirmation
    )
    let pluginSetupManager = PetFakeCodexPluginSetupManager(inspectState: originalState)
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: adapter,
        pluginSetupManager: pluginSetupManager
    )

    await viewModel.refreshCodexPluginSetup()
    #expect(viewModel.codexPluginSetupState == originalState)
    #expect(viewModel.canMigrateLegacyCodexPlugin)
    #expect(!viewModel.canConnectCodexPlugin)
    #expect(!viewModel.canDisconnectCodexPlugin)

    await viewModel.migrateLegacyCodexPlugin()
    #expect((await pluginSetupManager.callCounts()).migrateLegacy == 0)

    viewModel.beginLegacyCodexPluginMigrationConfirmation()
    #expect(viewModel.isConfirmingLegacyCodexPluginMigration)
    #expect((await pluginSetupManager.callCounts()).migrateLegacy == 0)

    viewModel.cancelLegacyCodexPluginMigrationConfirmation()
    #expect(!viewModel.isConfirmingLegacyCodexPluginMigration)
    await viewModel.migrateLegacyCodexPlugin()
    #expect((await pluginSetupManager.callCounts()).migrateLegacy == 0)

    viewModel.beginLegacyCodexPluginMigrationConfirmation()
    await pluginSetupManager.setInspectState(replacementState)
    await viewModel.refreshCodexPluginSetup()
    #expect(!viewModel.isConfirmingLegacyCodexPluginMigration)
    #expect((await pluginSetupManager.callCounts()).inspect == 2)
    #expect(viewModel.codexPluginSetupState == replacementState)
    #expect(viewModel.canMigrateLegacyCodexPlugin)
    await viewModel.migrateLegacyCodexPlugin()
    #expect((await pluginSetupManager.callCounts()).migrateLegacy == 0)

    viewModel.beginLegacyCodexPluginMigrationConfirmation()
    await viewModel.migrateLegacyCodexPlugin()
    #expect((await pluginSetupManager.callCounts()).migrateLegacy == 1)
    #expect(
        await pluginSetupManager.receivedLegacyMigrationConfirmations()
            == [replacementConfirmation]
    )
    #expect(
        viewModel.codexPluginSetupState
            == .installedNeedsHookReview(version: "0.1.0")
    )
    #expect(!viewModel.isConfirmingLegacyCodexPluginMigration)
    #expect(!viewModel.canMigrateLegacyCodexPlugin)
    #expect(viewModel.canDisconnectCodexPlugin)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet Codex Plugin setup blocks duplicate clicks while an operation is running")
@MainActor
func petCodexPluginSetupSingleFlight() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.configuredPaths = []
    let chooser = PetFakeProjectFolderChooser(
        result: URL(fileURLWithPath: "/tmp/blabee-pet-plugin-independent", isDirectory: true)
    )
    let pluginSetupManager = PetFakeCodexPluginSetupManager()
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: adapter,
        chooser: chooser,
        pluginSetupManager: pluginSetupManager
    )
    await viewModel.refreshOnboarding()
    await pluginSetupManager.setBlocksConnect(true)

    let first = Task { @MainActor in
        await viewModel.connectCodexPlugin()
    }
    for _ in 0..<100 {
        if (await pluginSetupManager.callCounts()).connect > 0 { break }
        await Task.yield()
    }
    #expect(viewModel.isOnboardingOperationInFlight)
    #expect(viewModel.isCodexPluginOperationInFlight)
    #expect(!viewModel.isOnboardingServiceOperationInFlight)
    #expect(!viewModel.isOnboardingProjectOperationInFlight)

    await viewModel.connectCodexPlugin()
    #expect((await pluginSetupManager.callCounts()).connect == 1)

    await viewModel.registerOnboardingService()
    await viewModel.chooseAndEnableProject()
    #expect(adapter.registerCalls == 1)
    #expect(adapter.enabledPaths == ["/tmp/blabee-pet-plugin-independent"])
    #expect(chooser.calls == 1)
    #expect(viewModel.isCodexPluginOperationInFlight)
    #expect(!viewModel.isOnboardingServiceOperationInFlight)
    #expect(!viewModel.isOnboardingProjectOperationInFlight)

    await pluginSetupManager.resumeConnect()
    await first.value
    #expect(!viewModel.isOnboardingOperationInFlight)
    #expect(viewModel.codexPluginSetupState == .installedNeedsHookReview(version: "0.1.0"))
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet settings refresh detects external Codex Plugin changes")
@MainActor
func petOnboardingRefreshIncludesCodexPluginState() async {
    let adapter = PetFakeOnboardingAdapter()
    let pluginSetupManager = PetFakeCodexPluginSetupManager(inspectState: .notInstalled)
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: adapter,
        pluginSetupManager: pluginSetupManager
    )

    await viewModel.refreshAllOnboardingSettings()
    #expect(viewModel.codexPluginSetupState == .notInstalled)
    #expect((await pluginSetupManager.callCounts()).inspect == 1)

    await pluginSetupManager.setInspectState(
        .updateAvailable(installedVersion: "0.1.0", bundledVersion: "0.2.0")
    )
    await viewModel.refreshAllOnboardingSettings()
    #expect(
        viewModel.codexPluginSetupState
            == .updateAvailable(installedVersion: "0.1.0", bundledVersion: "0.2.0")
    )
    #expect((await pluginSetupManager.callCounts()).inspect == 2)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet coalesces a Plugin refresh requested during a Plugin mutation")
@MainActor
func petCodexPluginRefreshCoalescesDuringMutation() async {
    let adapter = PetFakeOnboardingAdapter()
    let pluginSetupManager = PetFakeCodexPluginSetupManager(inspectState: .notInstalled)
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: adapter,
        pluginSetupManager: pluginSetupManager
    )
    await pluginSetupManager.setBlocksConnect(true)

    let connect = Task { @MainActor in
        await viewModel.connectCodexPlugin()
    }
    for _ in 0..<100 {
        if (await pluginSetupManager.callCounts()).connect > 0 { break }
        await Task.yield()
    }

    await viewModel.refreshCodexPluginSetup()
    await viewModel.refreshCodexPluginSetup()
    #expect((await pluginSetupManager.callCounts()).inspect == 0)

    await pluginSetupManager.resumeConnect()
    await connect.value

    #expect((await pluginSetupManager.callCounts()).connect == 1)
    #expect((await pluginSetupManager.callCounts()).inspect == 1)
    #expect(viewModel.codexPluginSetupState == .notInstalled)
    #expect(!viewModel.isCodexPluginOperationInFlight)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet coalesces repeated settings refreshes into a service operation final reload")
@MainActor
func petOnboardingRefreshCoalescesDuringServiceMutation() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    adapter.blocksUnregister = true
    adapter.stateAfterUnregister = .notRegistered
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
    await viewModel.refreshOnboarding()

    let unregister = Task { @MainActor in
        await viewModel.unregisterOnboardingService()
    }
    for _ in 0..<100 where adapter.unregisterCalls == 0 {
        await Task.yield()
    }

    let statusCallsWhileBlocked = adapter.statusCalls
    await viewModel.refreshOnboarding()
    await viewModel.refreshOnboarding()
    #expect(adapter.statusCalls == statusCallsWhileBlocked)

    adapter.resumeUnregister()
    await unregister.value
    #expect(adapter.statusCalls == statusCallsWhileBlocked + 1)
    #expect(viewModel.onboardingServiceState == .notRegistered)
    #expect(!viewModel.isOnboardingOperationInFlight)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("A crossing project action cannot erase a failed service operation error")
@MainActor
func petOnboardingFailureSurvivesRejectedCrossDomainMutation() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    adapter.configuredPaths = ["/tmp/blabee-pet-configured"]
    adapter.blocksUnregister = true
    adapter.stateAfterUnregister = .requiresApproval
    adapter.unregisterError = PetOnboardingTestError.injected
    let chooser = PetFakeProjectFolderChooser(
        result: URL(fileURLWithPath: "/tmp/blabee-pet-crossing", isDirectory: true)
    )
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter, chooser: chooser)
    await viewModel.refreshOnboarding()

    let unregister = Task { @MainActor in
        await viewModel.unregisterOnboardingService()
    }
    for _ in 0..<100 where adapter.unregisterCalls == 0 {
        await Task.yield()
    }

    await viewModel.refreshOnboarding()
    await viewModel.chooseAndEnableProject()
    #expect(chooser.calls == 0)
    #expect(adapter.enabledPaths.isEmpty)

    adapter.resumeUnregister()
    await unregister.value
    #expect(viewModel.onboardingServiceState == .requiresApproval)
    #expect(viewModel.onboardingError?.contains("injected") == true)
    #expect(!viewModel.isOnboardingOperationInFlight)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding exposes all service states and refresh never mutates")
@MainActor
func petOnboardingStatesAndRefreshAreReadOnly() async {
    let adapter = PetFakeOnboardingAdapter()
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
    let expectations: [(PetServiceRegistrationState, Bool, Bool, Bool)] = [
        (.notRegistered, true, false, false),
        (.enabled, false, true, false),
        (.requiresApproval, false, true, true),
        (.notFound, true, false, false),
        (.unknown, false, false, false),
    ]

    for (state, canRegister, canUnregister, canOpenSettings) in expectations {
        adapter.state = state
        await viewModel.refreshOnboarding()
        #expect(viewModel.onboardingServiceState == state)
        #expect(viewModel.onboardingServiceState.displayTitle.isEmpty == false)
        #expect(viewModel.onboardingServiceState.displayDescription.isEmpty == false)
        #expect(viewModel.canRegisterOnboardingService == canRegister)
        #expect(viewModel.canUnregisterOnboardingService == canUnregister)
        #expect(viewModel.canOpenOnboardingSystemSettings == canOpenSettings)
    }

    #expect(adapter.registerCalls == 0)
    #expect(adapter.unregisterCalls == 0)
    #expect(adapter.openSystemSettingsCalls == 0)
    #expect(adapter.enabledPaths.isEmpty)
    #expect(adapter.disabledPaths.isEmpty)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet distinguishes service registration from Coordinator transport health")
@MainActor
func petOnboardingSeparatesRegistrationAndRuntimeHealth() async throws {
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
    await viewModel.refreshOnboarding()

    #expect(viewModel.onboardingServiceState == .enabled)
    #expect(viewModel.coordinatorTransportError == nil)
    #expect(!viewModel.onboardingServiceNeedsRuntimeAttention)

    await transport.enqueueFailure(type: "get_state", code: "service_unreachable")
    await viewModel.refresh()

    #expect(viewModel.onboardingServiceState == .enabled)
    #expect(viewModel.coordinatorTransportError?.contains("service_unreachable") == true)
    #expect(viewModel.onboardingServiceNeedsRuntimeAttention)
    #expect(!viewModel.canRegisterOnboardingService)
    #expect(viewModel.canUnregisterOnboardingService)

    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await viewModel.refresh()

    #expect(viewModel.onboardingServiceState == .enabled)
    #expect(viewModel.coordinatorTransportError == nil)
    #expect(!viewModel.onboardingServiceNeedsRuntimeAttention)
    #expect(await transport.requestCount(type: "get_state") == 2)
}

@Test("Pet onboarding initializes, applies snapshots, and changes screens without mutation")
@MainActor
func petOnboardingPassivePathsDoNotMutate() async throws {
    let adapter = PetFakeOnboardingAdapter()
    let pluginSetupManager = PetFakeCodexPluginSetupManager()
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: adapter,
        pluginSetupManager: pluginSetupManager
    )
    #expect(adapter.statusCalls == 0)
    #expect(adapter.configuredPathsCalls == 0)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [PetTestCard(suffix: "passive")]
    ))
    #expect(adapter.statusCalls == 0)
    #expect(adapter.registerCalls == 0)
    #expect(adapter.unregisterCalls == 0)

    viewModel.beginShortcutSettings()
    #expect(viewModel.isEditingShortcuts)
    await viewModel.beginOnboarding()
    #expect(viewModel.isShowingOnboarding)
    #expect(!viewModel.isEditingShortcuts)
    viewModel.beginShortcutSettings()
    #expect(viewModel.isEditingShortcuts)
    #expect(!viewModel.isShowingOnboarding)

    #expect(adapter.registerCalls == 0)
    #expect(adapter.unregisterCalls == 0)
    #expect((await pluginSetupManager.callCounts()).inspect == 0)
    #expect((await pluginSetupManager.callCounts()).connect == 0)
    #expect((await pluginSetupManager.callCounts()).disconnect == 0)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding registers and unregisters only from explicit allowed actions")
@MainActor
func petOnboardingExplicitRegistrationActions() async {
    let adapter = PetFakeOnboardingAdapter()
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
    await viewModel.refreshOnboarding()
    adapter.stateAfterRegister = .requiresApproval

    await viewModel.registerOnboardingService()
    #expect(adapter.registerCalls == 1)
    #expect(viewModel.onboardingServiceState == .requiresApproval)
    #expect(adapter.statusCalls == 2)

    await viewModel.registerOnboardingService()
    #expect(adapter.registerCalls == 1)

    adapter.state = .enabled
    adapter.stateAfterUnregister = .notRegistered
    await viewModel.refreshOnboarding()
    await viewModel.unregisterOnboardingService()
    #expect(adapter.unregisterCalls == 1)
    #expect(viewModel.onboardingServiceState == .notRegistered)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding registers unseen services while unknown state remains fail closed")
@MainActor
func petOnboardingApprovalAndFailClosedActions() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.configuredPaths = ["/tmp/blabee-pet-configured"]
    let chooser = PetFakeProjectFolderChooser(
        result: URL(fileURLWithPath: "/tmp/blabee-pet-new", isDirectory: true)
    )
    adapter.state = .requiresApproval
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter, chooser: chooser)
    await viewModel.refreshOnboarding()

    await viewModel.registerOnboardingService()
    #expect(adapter.registerCalls == 0)
    await viewModel.openOnboardingSystemSettings()
    #expect(adapter.openSystemSettingsCalls == 1)
    adapter.stateAfterUnregister = .notRegistered
    await viewModel.unregisterOnboardingService()
    #expect(adapter.unregisterCalls == 1)

    adapter.state = .notFound
    adapter.stateAfterRegister = .notRegistered
    await viewModel.refreshOnboarding()
    await viewModel.registerOnboardingService()
    #expect(adapter.registerCalls == 1)

    adapter.state = .unknown
    await viewModel.refreshOnboarding()
    await viewModel.registerOnboardingService()
    await viewModel.unregisterOnboardingService()
    await viewModel.openOnboardingSystemSettings()
    await viewModel.chooseAndEnableProject()
    await viewModel.disableConfiguredProject("/tmp/blabee-pet-configured")

    #expect(adapter.unregisterCalls == 1)
    #expect(adapter.openSystemSettingsCalls == 1)
    #expect(chooser.calls == 0)
    #expect(adapter.enabledPaths.isEmpty)
    #expect(adapter.disabledPaths.isEmpty)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding re-reads status after an operation error")
@MainActor
func petOnboardingRefreshesAfterError() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.registerError = PetOnboardingTestError.injected
    adapter.stateAfterRegister = .requiresApproval
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
    await viewModel.refreshOnboarding()
    let statusCallsBeforeMutation = adapter.statusCalls

    await viewModel.registerOnboardingService()

    #expect(adapter.registerCalls == 1)
    #expect(adapter.statusCalls == statusCallsBeforeMutation + 1)
    #expect(viewModel.onboardingServiceState == .requiresApproval)
    #expect(viewModel.onboardingError?.contains("injected") == true)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet service operations stay single-flight without blocking Plugin inspection")
@MainActor
func petOnboardingSingleFlight() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    adapter.configuredPaths = ["/tmp/blabee-pet-configured"]
    adapter.blocksUnregister = true
    adapter.stateAfterUnregister = .notRegistered
    let chooser = PetFakeProjectFolderChooser(
        result: URL(fileURLWithPath: "/tmp/blabee-pet-new", isDirectory: true)
    )
    let pluginSetupManager = PetFakeCodexPluginSetupManager()
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: adapter,
        chooser: chooser,
        pluginSetupManager: pluginSetupManager
    )
    await viewModel.refreshOnboarding()

    let first = Task { @MainActor in
        await viewModel.unregisterOnboardingService()
    }
    for _ in 0..<100 where adapter.unregisterCalls == 0 {
        await Task.yield()
    }
    #expect(viewModel.isOnboardingOperationInFlight)
    #expect(viewModel.isOnboardingServiceOperationInFlight)
    #expect(!viewModel.isCodexPluginOperationInFlight)
    #expect(!viewModel.isOnboardingProjectOperationInFlight)
    let duplicate = Task { @MainActor in
        await viewModel.unregisterOnboardingService()
    }
    await duplicate.value
    #expect(adapter.unregisterCalls == 1)

    let statusCallsWhileBlocked = adapter.statusCalls
    let configuredPathsCallsWhileBlocked = adapter.configuredPathsCalls
    await viewModel.refreshOnboarding()
    #expect(adapter.statusCalls == statusCallsWhileBlocked)
    #expect(adapter.configuredPathsCalls == configuredPathsCallsWhileBlocked)

    await viewModel.refreshCodexPluginSetup()
    await viewModel.chooseAndEnableProject()
    await viewModel.disableConfiguredProject("/tmp/blabee-pet-configured")
    #expect((await pluginSetupManager.callCounts()).inspect == 1)
    #expect(chooser.calls == 0)
    #expect(adapter.enabledPaths.isEmpty)
    #expect(adapter.disabledPaths.isEmpty)
    #expect(viewModel.isOnboardingServiceOperationInFlight)
    #expect(!viewModel.isCodexPluginOperationInFlight)
    #expect(!viewModel.isOnboardingProjectOperationInFlight)

    adapter.resumeUnregister()
    await first.value
    #expect(adapter.unregisterCalls == 1)
    #expect(!viewModel.isOnboardingOperationInFlight)
    #expect(viewModel.onboardingServiceState == .notRegistered)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding re-reads status and config after unregister fails")
@MainActor
func petOnboardingRefreshesAfterUnregisterError() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    adapter.configuredPaths = ["/tmp/blabee-pet-configured"]
    adapter.stateAfterUnregister = .requiresApproval
    adapter.unregisterError = PetOnboardingTestError.injected
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
    await viewModel.refreshOnboarding()
    let statusCallsBeforeMutation = adapter.statusCalls
    let configuredPathsCallsBeforeMutation = adapter.configuredPathsCalls

    await viewModel.unregisterOnboardingService()

    #expect(adapter.unregisterCalls == 1)
    #expect(adapter.statusCalls == statusCallsBeforeMutation + 1)
    #expect(adapter.configuredPathsCalls == configuredPathsCallsBeforeMutation + 1)
    #expect(viewModel.onboardingServiceState == .requiresApproval)
    #expect(viewModel.configuredProjectPaths == ["/tmp/blabee-pet-configured"])
    #expect(viewModel.configuredProjectPathsAreAuthoritative)
    #expect(viewModel.onboardingError?.contains("injected") == true)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding writes projects only after chooser confirmation and explicit removal")
@MainActor
func petOnboardingProjectActions() async throws {
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    adapter.configuredPaths = ["/tmp/blabee-pet-existing"]
    let chooser = PetFakeProjectFolderChooser()
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter, chooser: chooser)
    await viewModel.refreshOnboarding()

    await viewModel.chooseAndEnableProject()
    #expect(chooser.calls == 1)
    #expect(adapter.enabledPaths.isEmpty)

    chooser.result = URL(fileURLWithPath: "/tmp/blabee-pet-new", isDirectory: true)
    await viewModel.chooseAndEnableProject()
    #expect(adapter.enabledPaths == ["/tmp/blabee-pet-new"])
    #expect(viewModel.configuredProjectPaths.contains("/tmp/blabee-pet-new"))

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [PetTestCard(suffix: "existing")]
    ))
    #expect(viewModel.activeProjectPaths == ["/tmp/blabee-pet-existing"])
    #expect(viewModel.configuredProjectPaths.contains("/tmp/blabee-pet-new"))
    #expect(!viewModel.activeProjectPaths.contains("/tmp/blabee-pet-new"))

    await viewModel.disableConfiguredProject("/tmp/blabee-pet-new")
    #expect(adapter.disabledPaths == ["/tmp/blabee-pet-new"])
    #expect(!viewModel.configuredProjectPaths.contains("/tmp/blabee-pet-new"))
    await viewModel.disableConfiguredProject("/tmp/not-configured")
    #expect(adapter.disabledPaths.count == 1)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding clears stale configured paths and blocks writes after a read failure")
@MainActor
func petOnboardingConfiguredPathsFailClosedAfterReadFailure() async {
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    adapter.configuredPaths = ["/tmp/blabee-pet-stale"]
    let chooser = PetFakeProjectFolderChooser(
        result: URL(fileURLWithPath: "/tmp/blabee-pet-new", isDirectory: true)
    )
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter, chooser: chooser)
    await viewModel.refreshOnboarding()
    #expect(viewModel.configuredProjectPathsAreAuthoritative)
    #expect(viewModel.configuredProjectPaths == ["/tmp/blabee-pet-stale"])

    adapter.configuredPathsError = PetOnboardingTestError.injected
    await viewModel.refreshOnboarding()
    #expect(!viewModel.configuredProjectPathsAreAuthoritative)
    #expect(viewModel.configuredProjectPaths.isEmpty)
    #expect(!viewModel.canMutateOnboardingProjects)
    #expect(viewModel.onboardingError?.contains("injected") == true)

    await viewModel.chooseAndEnableProject()
    await viewModel.disableConfiguredProject("/tmp/blabee-pet-stale")
    #expect(chooser.calls == 0)
    #expect(adapter.enabledPaths.isEmpty)
    #expect(adapter.disabledPaths.isEmpty)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet onboarding keeps snapshot-only active paths visible until restart")
@MainActor
func petOnboardingDistinguishesActiveOnlyProjectPaths() async throws {
    let activePath = "/tmp/blabee-pet-restart-pending"
    let adapter = PetFakeOnboardingAdapter()
    adapter.state = .enabled
    adapter.configuredPaths = [activePath]
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
    await viewModel.refreshOnboarding()
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [PetTestCard(suffix: "restart-pending")]
    ))
    #expect(viewModel.activeProjectPaths == [activePath])
    #expect(viewModel.activeOnlyProjectPaths.isEmpty)

    adapter.configuredPaths = []
    await viewModel.refreshOnboarding()
    #expect(viewModel.configuredProjectPathsAreAuthoritative)
    #expect(viewModel.configuredProjectPaths.isEmpty)
    #expect(viewModel.activeProjectPaths == [activePath])
    #expect(viewModel.activeOnlyProjectPaths == [activePath])
    #expect(await transport.requestCount(type: "get_state") == 0)
}
