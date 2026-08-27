import CoordinatorSwift
import Dispatch
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
private final class PetFakeCodexAutoConnectAdapter: PetCodexAutoConnectAdapting {
    var canEnable = true
    var currentState: CodexAutoConnectState = .disabled
    var stateAfterEnable: CodexAutoConnectState?
    var stateAfterDisable: CodexAutoConnectState?
    var enableError: Error?
    var disableError: Error?
    var blocksEnable = false

    private(set) var stateCalls = 0
    private(set) var enableCalls = 0
    private(set) var disableCalls = 0
    private var enableWaiter: CheckedContinuation<Void, Never>?

    func state() -> CodexAutoConnectState {
        stateCalls += 1
        return currentState
    }

    func enable() async throws {
        enableCalls += 1
        if blocksEnable {
            await withCheckedContinuation { continuation in
                enableWaiter = continuation
            }
        }
        if let stateAfterEnable { currentState = stateAfterEnable }
        if let enableError { throw enableError }
    }

    func disable() async throws {
        disableCalls += 1
        if let stateAfterDisable { currentState = stateAfterDisable }
        if let disableError { throw disableError }
    }

    func resumeEnable() {
        blocksEnable = false
        let waiter = enableWaiter
        enableWaiter = nil
        waiter?.resume()
    }
}

private final class PetCodexAutoConnectThreadProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var enableThreadWasMainStorage: Bool?
    private var disableStartedStorage = false

    var enableStarted: Bool {
        lock.withLock { enableThreadWasMainStorage != nil }
    }

    var enableThreadWasMain: Bool? {
        lock.withLock { enableThreadWasMainStorage }
    }

    var disableStarted: Bool {
        lock.withLock { disableStartedStorage }
    }

    func markEnableStarted() {
        lock.withLock {
            enableThreadWasMainStorage = Thread.isMainThread
        }
    }

    func markDisableStarted() {
        lock.withLock {
            disableStartedStorage = true
        }
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
    autoConnectAdapter: any PetCodexAutoConnectAdapting =
        PetUnavailableCodexAutoConnectAdapter(),
    chooser: PetFakeProjectFolderChooser = PetFakeProjectFolderChooser()
) -> (PetViewModel, PetFakeTransport) {
    let transport = PetFakeTransport()
    return (
        PetViewModel(
            transport: transport,
            externalApplicationOpener: PetFakeApplicationOpener(),
            onboardingAdapter: adapter,
            codexAutoConnectAdapter: autoConnectAdapter,
            projectFolderChooser: chooser,
            processIdentifier: 999
        ),
        transport
    )
}

@Test("Pet live Codex auto-connect rejects non-product bundles")
@MainActor
func petLiveCodexAutoConnectRequiresExactProductBundle() {
    do {
        _ = try PetLiveCodexAutoConnectAdapter()
        Issue.record("the test bundle must not enable live Codex auto-connect")
    } catch let error as CoordinatorError {
        #expect(error.code == "pet_codex_auto_connect_unavailable")
    } catch {
        Issue.record("unexpected error: \(error)")
    }
}

@Test("Pet Codex auto-connect file mutations stay serial and off MainActor")
@MainActor
func petCodexAutoConnectMutationWorkerKeepsMainActorResponsive() async throws {
    let releaseEnable = DispatchSemaphore(value: 0)
    let probe = PetCodexAutoConnectThreadProbe()
    let worker = PetCodexAutoConnectMutationWorker(
        enableOperation: {
            probe.markEnableStarted()
            releaseEnable.wait()
        },
        disableOperation: {
            probe.markDisableStarted()
        }
    )

    let enableTask = Task {
        try await worker.enable()
    }
    for _ in 0..<1_000 where !probe.enableStarted {
        await Task.yield()
    }
    #expect(probe.enableStarted)
    #expect(probe.enableThreadWasMain == false)

    let disableTask = Task {
        try await worker.disable()
    }
    for _ in 0..<20 {
        await Task.yield()
    }
    #expect(!probe.disableStarted)

    var mainActorTurnCompleted = false
    await Task { @MainActor in
        mainActorTurnCompleted = true
    }.value
    #expect(mainActorTurnCompleted)

    releaseEnable.signal()
    try await enableTask.value
    try await disableTask.value
    #expect(probe.disableStarted)
}

@Test("Pet settings refreshes Codex auto-connect state without mutating it")
@MainActor
func petCodexAutoConnectPassiveRefreshDoesNotMutate() async {
    let onboarding = PetFakeOnboardingAdapter()
    let autoConnect = PetFakeCodexAutoConnectAdapter()
    autoConnect.currentState = .disabled
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: onboarding,
        autoConnectAdapter: autoConnect
    )

    #expect(autoConnect.stateCalls == 0)
    await viewModel.beginOnboarding()
    #expect(viewModel.codexAutoConnectState == .disabled)
    #expect(autoConnect.stateCalls == 1)

    autoConnect.currentState = .repairRequired("앱 경로가 변경되었습니다.")
    await viewModel.refreshCodexAutoConnect()
    #expect(viewModel.codexAutoConnectState == .repairRequired("앱 경로가 변경되었습니다."))
    #expect(autoConnect.stateCalls == 2)
    #expect(autoConnect.enableCalls == 0)
    #expect(autoConnect.disableCalls == 0)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet Codex auto-connect changes only from explicit enabled actions")
@MainActor
func petCodexAutoConnectExplicitActionsAndIdempotentGating() async {
    let onboarding = PetFakeOnboardingAdapter()
    let autoConnect = PetFakeCodexAutoConnectAdapter()
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: onboarding,
        autoConnectAdapter: autoConnect
    )
    await viewModel.refreshCodexAutoConnect()

    autoConnect.stateAfterEnable = .enabled
    await viewModel.enableCodexAutoConnect()
    #expect(autoConnect.enableCalls == 1)
    #expect(viewModel.codexAutoConnectState == .enabled)
    #expect(viewModel.codexAutoConnectError == nil)

    await viewModel.enableCodexAutoConnect()
    #expect(autoConnect.enableCalls == 1)

    autoConnect.stateAfterDisable = .disabled
    await viewModel.disableCodexAutoConnect()
    #expect(autoConnect.disableCalls == 1)
    #expect(viewModel.codexAutoConnectState == .disabled)

    await viewModel.disableCodexAutoConnect()
    #expect(autoConnect.disableCalls == 1)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet Codex auto-connect exposes fail-closed UI eligibility")
@MainActor
func petCodexAutoConnectEligibilityIsFailClosed() async {
    let onboarding = PetFakeOnboardingAdapter()
    let autoConnect = PetFakeCodexAutoConnectAdapter()
    let (viewModel, _) = petOnboardingViewModel(
        adapter: onboarding,
        autoConnectAdapter: autoConnect
    )
    let expectations: [(CodexAutoConnectState, Bool, Bool, Bool, Bool)] = [
        (.disabled, true, true, false, false),
        (.enabled, true, false, true, false),
        (.repairRequired("오래된 연결"), true, true, true, true),
        (.repairRequired("공식 Codex 없음"), false, false, true, false),
        (.conflict("관리하지 않는 설정"), true, false, false, false),
        (.unavailable("공식 Codex 없음"), false, false, false, false),
    ]

    for (state, capability, canEnable, canDisable, canRepair) in expectations {
        autoConnect.canEnable = capability
        autoConnect.currentState = state
        await viewModel.refreshCodexAutoConnect()
        #expect(viewModel.canEnableCodexAutoConnect == canEnable)
        #expect(viewModel.canDisableCodexAutoConnect == canDisable)
        #expect(viewModel.canRepairCodexAutoConnect == canRepair)
        #expect(viewModel.canMutateCodexAutoConnect == (canEnable || canDisable))
    }
}

@Test("Pet Codex auto-connect re-reads actual state after an operation error")
@MainActor
func petCodexAutoConnectRefreshesAfterError() async {
    let onboarding = PetFakeOnboardingAdapter()
    let autoConnect = PetFakeCodexAutoConnectAdapter()
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: onboarding,
        autoConnectAdapter: autoConnect
    )
    await viewModel.refreshCodexAutoConnect()
    let stateCallsBeforeMutation = autoConnect.stateCalls
    autoConnect.stateAfterEnable = .repairRequired("부분 설치 상태")
    autoConnect.enableError = PetOnboardingTestError.injected

    await viewModel.enableCodexAutoConnect()

    #expect(autoConnect.enableCalls == 1)
    #expect(autoConnect.stateCalls == stateCallsBeforeMutation + 1)
    #expect(viewModel.codexAutoConnectState == .repairRequired("부분 설치 상태"))
    #expect(viewModel.codexAutoConnectError?.contains("injected") == true)
    #expect(await transport.requestCount(type: "get_state") == 0)
}

@Test("Pet settings mutations share one single-flight boundary")
@MainActor
func petCodexAutoConnectSingleFlightBlocksAllSettingsMutations() async {
    let onboarding = PetFakeOnboardingAdapter()
    onboarding.state = .notRegistered
    let autoConnect = PetFakeCodexAutoConnectAdapter()
    autoConnect.blocksEnable = true
    autoConnect.stateAfterEnable = .enabled
    let (viewModel, transport) = petOnboardingViewModel(
        adapter: onboarding,
        autoConnectAdapter: autoConnect
    )
    await viewModel.refreshOnboarding()

    let first = Task { @MainActor in
        await viewModel.enableCodexAutoConnect()
    }
    for _ in 0..<100 where autoConnect.enableCalls == 0 {
        await Task.yield()
    }
    #expect(viewModel.isCodexAutoConnectOperationInFlight)

    await viewModel.enableCodexAutoConnect()
    await viewModel.registerOnboardingService()
    let onboardingStatusCalls = onboarding.statusCalls
    let autoConnectStateCalls = autoConnect.stateCalls
    await viewModel.refreshOnboarding()
    #expect(autoConnect.enableCalls == 1)
    #expect(onboarding.registerCalls == 0)
    #expect(onboarding.statusCalls == onboardingStatusCalls)
    #expect(autoConnect.stateCalls == autoConnectStateCalls)

    autoConnect.resumeEnable()
    await first.value
    #expect(!viewModel.isCodexAutoConnectOperationInFlight)
    #expect(viewModel.codexAutoConnectState == .enabled)
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
