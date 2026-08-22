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

@MainActor
private func petOnboardingViewModel(
    adapter: PetFakeOnboardingAdapter,
    chooser: PetFakeProjectFolderChooser = PetFakeProjectFolderChooser()
) -> (PetViewModel, PetFakeTransport) {
    let transport = PetFakeTransport()
    return (
        PetViewModel(
            transport: transport,
            externalApplicationOpener: PetFakeApplicationOpener(),
            onboardingAdapter: adapter,
            projectFolderChooser: chooser,
            processIdentifier: 999
        ),
        transport
    )
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
        (.notFound, false, false, false),
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

@Test("Pet onboarding initializes, applies snapshots, and changes screens without mutation")
@MainActor
func petOnboardingPassivePathsDoNotMutate() async throws {
    let adapter = PetFakeOnboardingAdapter()
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter)
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

@Test("Pet onboarding requires-approval and fail-closed states allow only safe actions")
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

    for state in [PetServiceRegistrationState.notFound, .unknown] {
        adapter.state = state
        await viewModel.refreshOnboarding()
        await viewModel.registerOnboardingService()
        await viewModel.unregisterOnboardingService()
        await viewModel.openOnboardingSystemSettings()
        await viewModel.chooseAndEnableProject()
        await viewModel.disableConfiguredProject("/tmp/blabee-pet-configured")
    }
    #expect(adapter.registerCalls == 0)
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

@Test("Pet onboarding blocks duplicate operations while unregister is in flight")
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
    let (viewModel, transport) = petOnboardingViewModel(adapter: adapter, chooser: chooser)
    await viewModel.refreshOnboarding()

    let first = Task { @MainActor in
        await viewModel.unregisterOnboardingService()
    }
    for _ in 0..<100 where adapter.unregisterCalls == 0 {
        await Task.yield()
    }
    #expect(viewModel.isOnboardingOperationInFlight)
    let duplicate = Task { @MainActor in
        await viewModel.unregisterOnboardingService()
    }
    await duplicate.value
    #expect(adapter.unregisterCalls == 1)

    let statusCallsWhileBlocked = adapter.statusCalls
    let configuredPathsCallsWhileBlocked = adapter.configuredPathsCalls
    await viewModel.refreshOnboarding()
    await viewModel.chooseAndEnableProject()
    await viewModel.disableConfiguredProject("/tmp/blabee-pet-configured")
    #expect(adapter.statusCalls == statusCallsWhileBlocked)
    #expect(adapter.configuredPathsCalls == configuredPathsCallsWhileBlocked)
    #expect(chooser.calls == 0)
    #expect(adapter.enabledPaths.isEmpty)
    #expect(adapter.disabledPaths.isEmpty)

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
