import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class AppServiceMemoryPreference: PetAppServicePreferenceStoring {
    var enabled = false
}

@MainActor
private final class AppServiceFakeChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = false
    var petSelectorCredential: String?
    var terminationSummary: String?
    var stopCount = 0
    var stopFails = false
    var stopBlocked = false
    var stopWaiter: CheckedContinuation<Void, Never>?

    func stop() async {
        stopCount += 1
        if stopBlocked { await withCheckedContinuation { stopWaiter = $0 } }
        if !stopFails { isRunning = false }
    }

    func releaseStop() {
        stopBlocked = false
        stopWaiter?.resume()
        stopWaiter = nil
    }
}

@MainActor
private final class AppServiceFakeLauncher: AppOwnedServiceLaunching {
    var launches = 0
    var children: [AppServiceFakeChild] = []
    var launchError: Error?

    func launch() throws -> any AppOwnedServiceChild {
        launches += 1
        if let launchError { throw launchError }
        let child = AppServiceFakeChild()
        children.append(child)
        return child
    }
}

@MainActor
private final class AppServiceRegistration: PetOnboardingAdapting {
    var state: PetServiceRegistrationState = .notRegistered
    var registerCount = 0
    var unregisterCount = 0
    func serviceRegistrationState() -> PetServiceRegistrationState { state }
    func configuredProjectPaths() throws -> [String] { [] }
    func registerService() throws { registerCount += 1; state = .enabled }
    func unregisterService() async throws { unregisterCount += 1; state = .notRegistered }
    func openSystemSettingsLoginItems() {}
    func enableProject(at path: String) throws {}
    func disableProject(at path: String) throws {}
}

@MainActor
private struct AppServiceHarness {
    let launcher = AppServiceFakeLauncher()
    let preference = AppServiceMemoryPreference()
    let registration = AppServiceRegistration()

    func controller(
        timeout: UInt64 = 12_000_000_000,
        startupTimeout: UInt64? = nil
    ) -> PetAppServiceController {
        PetAppServiceController(
            launcher: launcher, preference: preference,
            registration: { registration.state },
            readinessTimeoutNanoseconds: timeout,
            startupTimeoutNanoseconds: startupTimeout ?? timeout
        )
    }
}

@MainActor
private func waitForAppService(_ predicate: () -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while !predicate(), ContinuousClock.now < deadline {
        try await Task.sleep(nanoseconds: 2_000_000)
    }
    try #require(predicate())
}

@Test("New Claude setup can open a session while an ended Claude projection is selected", .petLanguage(.korean))
@MainActor
func petAppServiceClaudeSetupIgnoresEndedProjection() async throws {
    let h = AppServiceHarness()
    let service = h.controller()
    let inspection = ClaudeAutoConnectSetup.Inspection(isEnabled: false, canEnable: false,
        canDisable: false, detail: "direct launch fixture", canLaunch: true)
    let connection = PetClaudeConnectionController(inspect: { inspection },
        enable: { inspection }, disable: { inspection })
    var requests = 0
    let vm = PetViewModel(
        transport: PetProviderTransport(codex: PetFakeTransport(), access: { nil }),
        externalApplicationOpener: PetFakeApplicationOpener(), provider: .claude,
        connectClaude: { _, _ in requests += 1; return nil }, claudeConnection: connection,
        onboardingAdapter: h.registration, appService: service
    )
    await vm.enableAppOwnedService()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    child.petSelectorCredential = String(repeating: "a", count: 64)
    service.receivedVerifiedSnapshot(generation: service.generation)
    let context = PetProviderContext(provider: .claude, scopeID: UUID().uuidString.lowercased(),
        serviceIncarnation: UUID().uuidString.lowercased(), sessionIncarnation: UUID().uuidString.lowercased(),
        authorityEpoch: UUID().uuidString.lowercased(), uiGeneration: 2)
    var snapshot = try PetSnapshot.parse(petTestSnapshotData(cards: []))
    snapshot.providerContext = context
    snapshot.providerSessions = [.init(id: "claude:ended", context: context,
        projectID: "claude_project_old", sessionID: "claude_session_old", cwd: "/tmp/old",
        state: "disconnected", title: "Ended Claude", nativeSessionID: UUID().uuidString.lowercased())]
    snapshot.providerDiagnostic = "연결이 끊겼어요. Claude에서 새로 시작해 주세요."
    snapshot.providerDirectory = .init(serviceGeneration: service.generation,
        serviceIncarnation: context.serviceIncarnation)
    vm.applySnapshotForTesting(snapshot)
    let operation = Task { await vm.connectClaudeSession(terminal: .terminal) }
    defer { operation.cancel() }
    try await waitForAppService { requests == 1 }
    await operation.value
    #expect(requests == 1 && h.launcher.launches == 1 && child.stopCount == 0)
    #expect(connection.phase == .idle) // The injected project chooser was cancelled.
    await vm.shutdownAppOwnedService()
}

@Test("App-owned service is opt-in and repeated startup never launches twice", .petLanguage(.korean))
@MainActor
func petAppServiceOptInAndReadiness() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    c.startAtAppLaunch()
    c.checkChildBeforePolling()
    #expect(h.launcher.launches == 0)
    #expect(c.state == .disabled)
    c.enable()
    c.enable()
    c.startAtAppLaunch()
    #expect(h.launcher.launches == 1)
    #expect(h.preference.enabled)
    #expect(c.state == .starting)
    #expect(!c.mayQueryCoordinator)
    c.receivedVerifiedSnapshot(generation: c.generation)
    #expect(c.state == .starting)
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    #expect(c.mayQueryCoordinator)
    c.receivedVerifiedSnapshot(generation: c.generation)
    #expect(c.state == .ready)
    await c.shutdown()
    #expect(child.stopCount == 1)
    #expect(h.preference.enabled) // Quit remembers opt-in.
    #expect(!c.mayQueryCoordinator)
    let nextApp = h.controller()
    nextApp.startAtAppLaunch()
    #expect(h.launcher.launches == 2)
    await nextApp.disable()
    #expect(!h.preference.enabled)
}

@Test("Signed-out Pet observes service startup and recovery without authorizing actions", .petLanguage(.korean))
@MainActor
func petAppServiceSignedOutHealthRemainsObservable() async throws {
    let h = AppServiceHarness()
    let service = h.controller()
    let transport = PetFakeTransport()
    let access = PetAccessController(transport: transport,
        ownedAccess: { service.petProviderAccess }, automaticPolling: false)
    let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: service, productAccess: access)
    await vm.enableAppOwnedService()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    child.petSelectorCredential = String(repeating: "a", count: 64)
    let data = try petTestSnapshotData(cards: [PetTestCard(suffix: "locked-health")],
        permissionRequests: [PetTestPermissionRequest(suffix: "locked-health", allowOnceAvailable: true)])
    #expect(service.state == .starting)
    #expect(access.state == .signedOut)

    await transport.enqueue(type: "get_state", response: data)
    await vm.refresh()
    #expect(service.state == .ready)
    #expect(vm.hasVerifiedServiceConnection)
    #expect(vm.snapshot?.permissionRequests.count == 1)
    #expect(vm.isProductAccessBlocked)
    #expect(!vm.canActOnDisplayedEvent)
    #expect(vm.approvalHead == nil)
    await vm.requestPanelSelection(1)
    vm.handleShortcut(.slot1)

    await transport.enqueueFailure(type: "get_state", code: "offline_fixture")
    await vm.refresh()
    #expect(service.state == .reconnecting)
    #expect(!vm.hasVerifiedServiceConnection)
    await transport.enqueue(type: "get_state", response: data)
    await vm.refresh()
    #expect(service.state == .ready)
    #expect(vm.hasVerifiedServiceConnection)
    #expect(access.state == .signedOut)
    #expect(vm.isProductAccessBlocked)
    #expect(child.stopCount == 0)
    #expect(await transport.requestCount(type: "get_state") == 3)
    for type in ["focus_interaction", "focus_event", "select", "resolve_permission_request", "resolve_managed_command_approval"] {
        #expect(await transport.requestCount(type: type) == 0)
    }
    access.stop()
    await vm.shutdownAppOwnedService()
}

@Test("Existing macOS registration blocks app-owned launch without changing registration", .petLanguage(.korean),
      arguments: [PetServiceRegistrationState.enabled, .requiresApproval, .unknown])
@MainActor
func petAppServiceRegistrationConflict(_ registration: PetServiceRegistrationState) async {
    let h = AppServiceHarness()
    h.registration.state = registration
    let c = h.controller()
    c.enable()
    #expect(h.launcher.launches == 0)
    #expect(h.registration.registerCount == 0)
    #expect(h.registration.unregisterCount == 0)
    #expect(!c.mayQueryCoordinator)
    #expect(c.state == (registration == .unknown
        ? .failed("service_registration_unknown") : .blocked))
    await c.disable()
    #expect(c.state == .disabled)
}

@Test("Mandatory account access cannot opt a fresh installation into an unowned legacy service", .petLanguage(.korean),
      arguments: [PetServiceRegistrationState.notRegistered, .notFound])
@MainActor
func petAppServiceAccessRejectsLegacyRegistration(_ registration: PetServiceRegistrationState) async throws {
    let h = AppServiceHarness()
    h.registration.state = registration
    let service = h.controller()
    let transport = PetFakeTransport()
    let access = PetAccessController(transport: transport,
        ownedAccess: { service.petProviderAccess }, automaticPolling: false)
    defer { access.stop() }
    let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: service, productAccess: access)
    await vm.refreshOnboarding()
    access.receiveVerifiedCredential(.init(userID: UUID(), accessToken: "fixture-verified-social-token",
        expiresAt: Date().addingTimeInterval(3_600)))
    await access.synchronize()

    #expect(access.effectiveState == .unavailable && vm.isProductAccessBlocked)
    #expect(!vm.canRegisterOnboardingService && !vm.showsLegacyServiceSettings)
    #expect(vm.legacyServiceMigrationDetail.isEmpty)
    await vm.registerOnboardingService() // An already captured, obsolete callback must also fail closed.
    await vm.registerOnboardingService()
    #expect(h.registration.registerCount == 0 && h.registration.unregisterCount == 0)
    #expect(h.registration.state == registration && h.launcher.launches == 0)
    #expect(await transport.requestCount(type: "product_access_v1") == 0)

    // The normal explicit app-owned start is still available. Starting a child
    // does not itself grant account access or replay any selection.
    await vm.enableAppOwnedService()
    #expect(h.launcher.launches == 1 && service.state == .starting)
    #expect(vm.isProductAccessBlocked)
    #expect(await transport.requestCount(type: "select") == 0)
    await vm.shutdownAppOwnedService()
}

@Test("Legacy cleanup remains explicit with mandatory access and never launches a replacement automatically", .petLanguage(.korean),
      arguments: [PetServiceRegistrationState.enabled, .requiresApproval])
@MainActor
func petAppServiceAccessPreservesExplicitLegacyCleanup(_ registration: PetServiceRegistrationState) async throws {
    let h = AppServiceHarness()
    h.registration.state = registration
    let service = h.controller()
    let transport = PetFakeTransport()
    let access = PetAccessController(transport: transport,
        ownedAccess: { service.petProviderAccess }, automaticPolling: false)
    defer { access.stop() }
    let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: service, productAccess: access)
    await vm.refreshOnboarding()
    access.receiveVerifiedCredential(.init(userID: UUID(), accessToken: "fixture-verified-social-token",
        expiresAt: Date().addingTimeInterval(3_600)))
    await access.synchronize()

    #expect(vm.isProductAccessBlocked && !vm.canRegisterOnboardingService)
    #expect(vm.showsLegacyServiceSettings && vm.canUnregisterOnboardingService)
    #expect(vm.legacyServiceMigrationDetail.contains("앱 실행형 서비스 켜기"))
    await vm.registerOnboardingService()
    #expect(h.registration.registerCount == 0 && h.registration.unregisterCount == 0)
    #expect(h.launcher.launches == 0)

    await vm.unregisterOnboardingService()
    #expect(h.registration.unregisterCount == 1 && h.registration.state == .notRegistered)
    #expect(!vm.showsLegacyServiceSettings && !vm.canRegisterOnboardingService)
    #expect(h.launcher.launches == 0 && !h.preference.enabled && vm.isProductAccessBlocked)

    await vm.enableAppOwnedService()
    #expect(h.launcher.launches == 1 && service.state == .starting)
    #expect(vm.isProductAccessBlocked && h.registration.registerCount == 0)
    #expect(await transport.requestCount(type: "select") == 0)
    await vm.shutdownAppOwnedService()
}

@Test("Unknown legacy registration stays fail closed even after social identity verification", .petLanguage(.korean))
@MainActor
func petAppServiceAccessUnknownRegistrationFailsClosed() async {
    let h = AppServiceHarness()
    h.registration.state = .unknown
    let service = h.controller()
    let transport = PetFakeTransport()
    let access = PetAccessController(transport: transport,
        ownedAccess: { service.petProviderAccess }, automaticPolling: false)
    defer { access.stop() }
    let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: service, productAccess: access)
    await vm.refreshOnboarding()
    access.receiveVerifiedCredential(.init(userID: UUID(), accessToken: "fixture-verified-social-token",
        expiresAt: Date().addingTimeInterval(3_600)))
    await access.synchronize()

    #expect(vm.isProductAccessBlocked && vm.showsLegacyServiceSettings)
    #expect(!vm.canRegisterOnboardingService && !vm.canUnregisterOnboardingService)
    await vm.registerOnboardingService()
    await vm.unregisterOnboardingService()
    await vm.enableAppOwnedService()
    #expect(service.state == .failed("service_registration_unknown"))
    #expect(h.launcher.launches == 0 && h.registration.registerCount == 0 && h.registration.unregisterCount == 0)
    #expect(h.registration.state == .unknown && vm.isProductAccessBlocked)
    #expect(await transport.requestCount(type: "product_access_v1") == 0)
    await vm.shutdownAppOwnedService()
}

@Test("Cleared legacy registration offers an explicit setup restart without granting account access", .petLanguage(.korean),
      arguments: [PetServiceRegistrationState.notRegistered, .notFound])
@MainActor
func petAppServiceSetupRestartAfterLegacyCleanup(_ clearedRegistration: PetServiceRegistrationState) async throws {
    let h = AppServiceHarness()
    h.registration.state = .enabled
    let service = h.controller()
    let transport = PetFakeTransport()
    let access = PetAccessController(transport: transport,
        ownedAccess: { service.petProviderAccess }, automaticPolling: false)
    defer { access.stop() }
    let inspection = ClaudeAutoConnectSetup.Inspection(isEnabled: false, canEnable: false,
        canDisable: false, detail: "fixture only", canLaunch: false)
    let connection = PetClaudeConnectionController(inspect: { inspection },
        enable: { inspection }, disable: { inspection })
    let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        claudeConnection: connection, onboardingAdapter: h.registration,
        appService: service, productAccess: access)
    await vm.refreshOnboarding()
    access.receiveVerifiedCredential(.init(userID: UUID(), accessToken: "fixture-verified-social-token",
        expiresAt: Date().addingTimeInterval(3_600)))
    await access.synchronize()
    await vm.enableAppOwnedService()
    let view = PetConnectionSetupView(viewModel: vm)
    #expect(service.state == .blocked && h.launcher.launches == 0)
    #expect(!vm.needsAppOwnedServiceRestartAfterLegacyCleanup)
    #expect(view.primaryActionTitle != "서비스 다시 시작")
    await vm.restartConnectionSetupService()
    #expect(h.launcher.launches == 0)

    await vm.unregisterOnboardingService()
    #expect(h.registration.unregisterCount == 1 && h.registration.state == .notRegistered)
    h.registration.state = clearedRegistration
    await vm.refreshOnboarding()
    #expect(service.state == .blocked && vm.needsAppOwnedServiceRestartAfterLegacyCleanup)
    #expect(view.primaryActionTitle == "서비스 다시 시작" && view.primaryActionEnabled)
    #expect(view.summaryDetail == vm.appOwnedServiceDetail)
    #expect(view.summaryDetail.contains("등록이 해제된 상태"))
    #expect(vm.appOwnedServiceTitle == "서비스 다시 시작 필요")
    #expect(vm.connectionReadiness.checks.first(where: { $0.id == "service" })?.detail == vm.appOwnedServiceDetail)

    await vm.refreshConnectionSetup()
    #expect(h.launcher.launches == 0 && !service.hasOwnedChild)
    #expect(service.state == .blocked && view.primaryActionTitle == "서비스 다시 시작")
    #expect(vm.isProductAccessBlocked && service.petProviderAccess == nil)

    // Only this explicit primary action may create a replacement child.
    await vm.restartConnectionSetupService()
    #expect(h.launcher.launches == 1 && service.state == .starting)
    #expect(!vm.needsAppOwnedServiceRestartAfterLegacyCleanup)
    let child = try #require(h.launcher.children.first)
    child.petSelectorCredential = String(repeating: "a", count: 64)
    child.hasPublishedService = true
    service.receivedVerifiedSnapshot(generation: service.generation)
    #expect(service.state == .ready && service.petProviderAccess != nil)
    #expect(vm.isProductAccessBlocked) // A service credential is not a verified account grant.
    await vm.restartConnectionSetupService() // A stale primary callback cannot launch again.
    #expect(h.launcher.launches == 1 && child.stopCount == 0)
    #expect(h.registration.unregisterCount == 1 && h.registration.registerCount == 0)
    #expect(await transport.requestCount(type: "select") == 0)
    await vm.shutdownAppOwnedService()
}

@Test("Setup restart rejects a legacy registration that reappears or becomes unknown", .petLanguage(.korean),
      arguments: [PetServiceRegistrationState.enabled, .requiresApproval, .unknown], [true, false])
@MainActor
func petAppServiceSetupRestartRejectsChangedRegistration(
    _ registration: PetServiceRegistrationState,
    refreshFirst: Bool
) async {
    let h = AppServiceHarness()
    h.registration.state = .enabled
    let service = h.controller()
    let inspection = ClaudeAutoConnectSetup.Inspection(isEnabled: false, canEnable: false,
        canDisable: false, detail: "fixture only", canLaunch: false)
    let connection = PetClaudeConnectionController(inspect: { inspection },
        enable: { inspection }, disable: { inspection })
    let vm = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
        claudeConnection: connection, onboardingAdapter: h.registration, appService: service)
    await vm.refreshOnboarding()
    await vm.enableAppOwnedService()
    await vm.unregisterOnboardingService()
    #expect(vm.needsAppOwnedServiceRestartAfterLegacyCleanup)

    h.registration.state = registration
    if refreshFirst {
        await vm.refreshOnboarding()
        #expect(!vm.needsAppOwnedServiceRestartAfterLegacyCleanup)
        #expect(PetConnectionSetupView(viewModel: vm).primaryActionTitle != "서비스 다시 시작")
    } else {
        // The screen still offers the old action. The launcher must read the
        // registration again instead of relying on this stale presentation.
        #expect(vm.needsAppOwnedServiceRestartAfterLegacyCleanup)
    }
    await vm.restartConnectionSetupService()
    #expect(h.launcher.launches == 0 && service.petProviderAccess == nil)
    #expect(h.registration.state == registration && h.registration.unregisterCount == 1)
    await vm.shutdownAppOwnedService()
}

@Test("Claude start waits for the app-owned service and private selector access", .petLanguage(.korean))
@MainActor
func petAppServiceClaudeStartReadiness() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    let codex = PetFakeTransport()
    let transport = PetProviderTransport(codex: codex, access: { nil })
    var claudeStarts = 0
    let vm = PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        startClaude: { claudeStarts += 1 }, onboardingAdapter: h.registration, appService: c
    )
    await vm.beginOnboarding()
    #expect(vm.appOwnedServiceState == .disabled)
    let disabledGuidance = try #require(vm.claudeStartGuidance)
    #expect(disabledGuidance.contains("설정의 연결 탭") && disabledGuidance.contains("‘앱 실행형 서비스 켜기’"))
    #expect(!vm.canStartClaude)
    await vm.startClaudeSession()
    #expect(vm.lastError == disabledGuidance)
    #expect(claudeStarts == 0 && h.launcher.launches == 0 && !h.preference.enabled)

    await vm.enableAppOwnedService()
    #expect(vm.appOwnedServiceState == .starting)
    let startingGuidance = try #require(vm.claudeStartGuidance)
    #expect(startingGuidance.contains(PetAppServiceState.starting.detail))
    #expect(!vm.canStartClaude && startingGuidance != disabledGuidance)
    await vm.startClaudeSession()
    #expect(vm.lastError == startingGuidance && claudeStarts == 0)
    #expect(h.launcher.launches == 1)

    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: c.generation)
    #expect(vm.appOwnedServiceState == .ready)
    #expect(c.petProviderAccess == nil)
    let missingAccessGuidance = try #require(vm.claudeStartGuidance)
    #expect(missingAccessGuidance.contains("설정의 연결 탭에서 서비스 상태를 확인"))
    #expect(!vm.canStartClaude)
    await vm.startClaudeSession()
    #expect(vm.lastError == missingAccessGuidance && claudeStarts == 0)

    // This synthetic capability is confined to this test; existing harness children
    // retain the protocol's absent-capability behavior.
    child.petSelectorCredential = String(repeating: "a", count: 64)
    #expect(c.petProviderAccess != nil)
    #expect(vm.claudeStartGuidance == nil && vm.canStartClaude)
    await codex.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await vm.startClaudeSession()
    #expect(claudeStarts == 1)
    #expect(await codex.requestCount(type: "get_state") == 1)
    #expect(h.launcher.launches == 1)
    #expect(h.registration.registerCount == 0 && h.registration.unregisterCount == 0)
    await vm.shutdownAppOwnedService()
}

@Test("Claude start requires an explicit registration removal and app-service restart", .petLanguage(.korean),
      arguments: [PetServiceRegistrationState.enabled, .requiresApproval])
@MainActor
func petAppServiceClaudeStartRegistrationConflict(_ registration: PetServiceRegistrationState) async throws {
    let h = AppServiceHarness()
    h.registration.state = registration
    let c = h.controller()
    let codex = PetFakeTransport()
    let transport = PetProviderTransport(codex: codex, access: { nil })
    var claudeStarts = 0
    let vm = PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        startClaude: { claudeStarts += 1 }, onboardingAdapter: h.registration, appService: c
    )
    await vm.beginOnboarding()
    await vm.enableAppOwnedService()
    #expect(vm.appOwnedServiceState == .blocked)
    let guidance = try #require(vm.claudeStartGuidance)
    #expect(guidance.contains("‘이전 자동 시작 서비스’를 등록 해제")
        && guidance.contains("‘서비스 다시 시작’"))
    #expect(!vm.canStartClaude)
    await vm.startClaudeSession()
    #expect(vm.lastError == guidance)
    #expect(claudeStarts == 0 && h.launcher.launches == 0)
    #expect(await codex.requestCount(type: "get_state") == 0)
    #expect(h.registration.state == registration)
    #expect(h.registration.registerCount == 0 && h.registration.unregisterCount == 0)

    // Only this explicit user action changes the macOS registration. The
    // remembered app-service opt-in does not start a child automatically.
    await vm.unregisterOnboardingService()
    #expect(h.registration.state == .notRegistered)
    #expect(h.registration.unregisterCount == 1 && h.registration.registerCount == 0)
    #expect(h.preference.enabled && c.enabled && vm.isAppOwnedServiceEnabled)
    #expect(h.launcher.launches == 0 && !c.hasOwnedChild)
    #expect(!vm.canStartClaude && claudeStarts == 0)

    await vm.restartAppOwnedService()
    #expect(vm.appOwnedServiceState == .starting)
    #expect(h.launcher.launches == 1 && !vm.canStartClaude)
    let child = try #require(h.launcher.children.first)
    child.petSelectorCredential = String(repeating: "a", count: 64)
    child.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: c.generation)
    #expect(vm.appOwnedServiceState == .ready && c.petProviderAccess != nil)
    #expect(vm.claudeStartGuidance == nil && vm.canStartClaude)
    await codex.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await vm.startClaudeSession()
    #expect(claudeStarts == 1)
    #expect(h.launcher.launches == 1)
    #expect(h.registration.unregisterCount == 1 && h.registration.registerCount == 0)
    await vm.shutdownAppOwnedService()
}

@Test("No known registration permits explicit launch", .petLanguage(.korean), arguments: [PetServiceRegistrationState.notRegistered, .notFound])
@MainActor
func petAppServiceNoRegistration(_ registration: PetServiceRegistrationState) async {
    let h = AppServiceHarness()
    h.registration.state = registration
    let c = h.controller()
    c.enable()
    #expect(h.launcher.launches == 1)
    await c.shutdown()
}

@Test("Launch failures are diagnostic-only and never auto-respawn", .petLanguage(.korean))
@MainActor
func petAppServiceLaunchFailureIsManual() async {
    let h = AppServiceHarness()
    h.launcher.launchError = CoordinatorError("app_service_test_launch_failure", "private data")
    let c = h.controller()
    c.enable()
    for _ in 0..<20 { c.startAtAppLaunch(); c.checkChildBeforePolling() }
    #expect(h.launcher.launches == 1)
    #expect(c.state == .failed("app_service_test_launch_failure"))
    #expect(!c.state.detail.contains("private data"))
    h.launcher.launchError = nil
    await c.restart()
    #expect(h.launcher.launches == 2)
    await c.shutdown()
}

@Test("Startup deadline stops the owned child and leaves manual recovery", .petLanguage(.korean))
@MainActor
func petAppServiceStartupTimeout() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 5_000_000_000, startupTimeout: 20_000_000)
    c.enable()
    try await waitForAppService { c.state == .failed("app_service_connection_timeout") }
    #expect(h.launcher.children.first?.stopCount == 1)
    #expect(!c.hasOwnedChild)
    for _ in 0..<10 { c.startAtAppLaunch(); c.checkChildBeforePolling() }
    #expect(h.launcher.launches == 1)
    await c.shutdown()
}

@Test("Initial readiness can wait for Keychain beyond the reconnect budget", .petLanguage(.korean))
@MainActor
func petAppServiceDelayedInitialReadiness() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 20_000_000, startupTimeout: 2_000_000_000)
    c.enable()
    let child = try #require(h.launcher.children.first)
    try await Task.sleep(nanoseconds: 80_000_000)
    #expect(c.state == .starting)
    #expect(child.isRunning)
    #expect(child.stopCount == 0)
    #expect(!c.mayQueryCoordinator)
    child.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: c.generation)
    #expect(c.state == .ready)
    #expect(h.launcher.launches == 1)
    await c.shutdown()
}

@Test("The first verified snapshot cancels the initial startup deadline", .petLanguage(.korean))
@MainActor
func petAppServiceInitialReadinessCancelsDeadline() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 5_000_000_000, startupTimeout: 20_000_000)
    c.enable()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: c.generation)
    try await Task.sleep(nanoseconds: 80_000_000)
    #expect(c.state == .ready)
    #expect(child.isRunning)
    #expect(child.stopCount == 0)
    await c.shutdown()
}

@Test("Shutdown cancels the initial deadline without another stop or restart", .petLanguage(.korean))
@MainActor
func petAppServiceShutdownCancelsStartupDeadline() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 5_000_000_000, startupTimeout: 20_000_000)
    c.enable()
    let child = try #require(h.launcher.children.first)
    await c.shutdown()
    try await Task.sleep(nanoseconds: 80_000_000)
    #expect(c.state == .stopped)
    #expect(child.stopCount == 1)
    #expect(!c.hasOwnedChild)
    #expect(h.launcher.launches == 1)
}

@Test("Crash and uncertain cleanup never adopt or start another service", .petLanguage(.korean))
@MainActor
func petAppServiceCrashAndCleanupFailure() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    c.enable()
    let first = try #require(h.launcher.children.first)
    first.isRunning = false
    first.terminationSummary = "app_service_exit_1"
    c.checkChildBeforePolling()
    #expect(c.state == .failed("app_service_exit_1"))
    #expect(!c.hasOwnedChild)
    #expect(first.stopCount == 0)
    await c.restart()
    let second = try #require(h.launcher.children.last)
    second.stopFails = true
    await c.restart()
    #expect(h.launcher.launches == 2)
    #expect(c.hasOwnedChild)
    #expect(c.state == .failed("app_service_stop_incomplete"))
    #expect(!c.mayQueryCoordinator)
    second.stopFails = false
    await c.disable()
    #expect(!c.hasOwnedChild)
    #expect(!h.preference.enabled)
}

@Test("Late snapshots cannot mark a replacement ready and slow responses do not stop the child", .petLanguage(.korean))
@MainActor
func petAppServiceGenerationAndConnectionLoss() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 50_000_000, startupTimeout: 10_000_000_000)
    c.enable()
    let oldGeneration = c.generation
    await c.restart()
    let child = try #require(h.launcher.children.last)
    child.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: oldGeneration)
    #expect(c.state == .starting)
    c.receivedVerifiedSnapshot(generation: c.generation)
    #expect(c.state == .ready)
    c.connectionFailed(generation: oldGeneration)
    #expect(c.state == .ready)
    c.connectionFailed(generation: c.generation)
    #expect(c.state == .reconnecting)
    let recoveringGeneration = c.generation
    try await waitForAppService { c.state == .unresponsive }
    #expect(child.stopCount == 0)
    #expect(child.isRunning)
    #expect(c.hasOwnedChild)
    #expect(c.mayQueryCoordinator)
    #expect(c.generation == recoveringGeneration)
    #expect(!c.acceptsSnapshot(generation: oldGeneration))
    for _ in 0..<10 {
        c.connectionFailed(generation: recoveringGeneration)
        c.startAtAppLaunch()
        c.checkChildBeforePolling()
    }
    #expect(c.state == .unresponsive)
    #expect(h.launcher.launches == 2)
    #expect(child.stopCount == 0)
    c.receivedVerifiedSnapshot(generation: recoveringGeneration)
    #expect(c.state == .ready)
    #expect(c.generation == recoveringGeneration)
    await c.shutdown()
    #expect(child.stopCount == 1)
}

@Test("A verified response cancels the reconnect deadline without stopping or replacing the child", .petLanguage(.korean))
@MainActor
func petAppServiceRecoveryCancelsReconnectDeadline() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 20_000_000, startupTimeout: 2_000_000_000)
    c.enable()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: c.generation)
    c.connectionFailed(generation: c.generation)
    #expect(c.state == .reconnecting)
    c.receivedVerifiedSnapshot(generation: c.generation)
    try await Task.sleep(nanoseconds: 80_000_000)
    #expect(c.state == .ready)
    #expect(child.stopCount == 0)
    #expect(h.launcher.launches == 1)
    await c.shutdown()
}

@Test("Manual restart during reconnect fences old responses and deadlines and starts exactly one replacement", .petLanguage(.korean),
      arguments: [false, true])
@MainActor
func petAppServiceUnresponsiveManualRestart(_ afterTimeout: Bool) async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 20_000_000, startupTimeout: 2_000_000_000)
    c.enable()
    let first = try #require(h.launcher.children.first)
    first.hasPublishedService = true
    let oldGeneration = c.generation
    c.receivedVerifiedSnapshot(generation: oldGeneration)
    c.connectionFailed(generation: oldGeneration)
    if afterTimeout { try await waitForAppService { c.state == .unresponsive } }
    await c.restart()
    let second = try #require(h.launcher.children.last)
    #expect(h.launcher.launches == 2)
    #expect(first.stopCount == 1)
    #expect(c.state == .starting)
    #expect(c.generation != oldGeneration)
    second.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: oldGeneration)
    c.connectionFailed(generation: oldGeneration)
    #expect(c.state == .starting)
    c.receivedVerifiedSnapshot(generation: c.generation)
    try await Task.sleep(nanoseconds: 80_000_000)
    #expect(c.state == .ready)
    #expect(second.stopCount == 0)
    await c.shutdown()
    #expect(second.stopCount == 1)
    #expect(h.launcher.launches == 2)
}

@Test("An unresponsive child that actually exits fails without automatic replacement", .petLanguage(.korean))
@MainActor
func petAppServiceUnresponsiveChildExit() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 20_000_000, startupTimeout: 2_000_000_000)
    c.enable()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    let oldGeneration = c.generation
    c.receivedVerifiedSnapshot(generation: oldGeneration)
    c.connectionFailed(generation: oldGeneration)
    try await waitForAppService { c.state == .unresponsive }
    child.isRunning = false
    child.terminationSummary = "app_service_exit_1"
    c.checkChildBeforePolling()
    #expect(c.state == .failed("app_service_exit_1"))
    #expect(!c.hasOwnedChild)
    #expect(!c.mayQueryCoordinator)
    #expect(c.generation != oldGeneration)
    c.receivedVerifiedSnapshot(generation: oldGeneration)
    c.startAtAppLaunch()
    #expect(c.state == .failed("app_service_exit_1"))
    #expect(h.launcher.launches == 1)
    #expect(child.stopCount == 0)
    await c.shutdown()
}

@Test("Shutdown during reconnect cancels its deadline and ignores late responses", .petLanguage(.korean))
@MainActor
func petAppServiceShutdownCancelsReconnectDeadline() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 20_000_000, startupTimeout: 2_000_000_000)
    c.enable()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    let oldGeneration = c.generation
    c.receivedVerifiedSnapshot(generation: oldGeneration)
    c.connectionFailed(generation: oldGeneration)
    await c.shutdown()
    c.receivedVerifiedSnapshot(generation: oldGeneration)
    try await Task.sleep(nanoseconds: 80_000_000)
    #expect(c.state == .stopped)
    #expect(!c.hasOwnedChild)
    #expect(!c.mayQueryCoordinator)
    #expect(child.stopCount == 1)
    #expect(h.launcher.launches == 1)
}

@Test("Concurrent restart and opt-out are serialized around owned cleanup", .petLanguage(.korean))
@MainActor
func petAppServiceConcurrentRestart() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    c.enable()
    let child = try #require(h.launcher.children.first)
    child.stopBlocked = true
    let restart = Task { await c.restart() }
    try await waitForAppService { child.stopWaiter != nil }
    await c.restart()
    c.enable()
    #expect(h.launcher.launches == 1)
    #expect(child.stopCount == 1)
    child.releaseStop()
    await restart.value
    #expect(h.launcher.launches == 2)
    await c.disable()
    #expect(!h.preference.enabled)
}

@Test("ViewModel shows registration conflicts as actions and unknown registration as failure", .petLanguage(.korean),
      arguments: [PetServiceRegistrationState.enabled, .requiresApproval, .unknown])
@MainActor
func petAppServiceViewModelRegistrationReadiness(_ registration: PetServiceRegistrationState) async {
    let h = AppServiceHarness()
    h.registration.state = registration
    let c = h.controller()
    let vm = PetViewModel(
        transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: c
    )
    await vm.beginOnboarding()
    await vm.enableAppOwnedService()
    let expectedTone: PetSettingsStatusTone = registration == .unknown ? .error : .actionNeeded
    let model = vm.connectionReadiness
    #expect(vm.appOwnedServiceState == (registration == .unknown
        ? .failed("service_registration_unknown") : .blocked))
    #expect(model.status == .needsAttention)
    #expect(model.title == "서비스 연결을 확인해 주세요")
    #expect(model.detail == vm.appOwnedServiceState.detail)
    #expect(model.nextStep == .service)
    #expect(model.nextStepTitle == "서비스 상태 확인")
    #expect(model.checks[0].state == (registration == .unknown ? .failed : .attention))
    #expect(PetSettingsStatusTone.appService(vm.appOwnedServiceState) == expectedTone)
    #expect(PetSettingsStatusTone.connection(model) == expectedTone)
    #expect(!vm.hasVerifiedServiceConnection)
    #expect(h.launcher.launches == 0)
    #expect(h.registration.registerCount == 0)
    #expect(h.registration.unregisterCount == 0)
    await vm.shutdownAppOwnedService()
}

@Test("ViewModel keeps an automatic service transport failure classified as an error", .petLanguage(.korean))
@MainActor
func petAppServiceViewModelTransportFailureReadiness() async throws {
    let h = AppServiceHarness()
    h.registration.state = .enabled
    let c = h.controller()
    let transport = PetFakeTransport()
    let vm = PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: c
    )
    await vm.beginOnboarding()
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await vm.refresh()
    #expect(vm.hasVerifiedServiceConnection)
    #expect(vm.connectionReadiness.checks[0].state == .confirmed)

    await transport.enqueueFailure(type: "get_state", code: "lost")
    await vm.refresh()
    let model = vm.connectionReadiness
    #expect(!vm.hasVerifiedServiceConnection)
    #expect(vm.appOwnedServiceState == .disabled)
    #expect(model.status == .needsAttention)
    #expect(model.nextStep == .service)
    #expect(model.checks[0].state == .failed)
    #expect(PetSettingsStatusTone.connection(model) == .error)
    #expect(await transport.requestCount(type: "get_state") == 2)
    #expect(h.launcher.launches == 0)
    #expect(h.registration.registerCount == 0)
    #expect(h.registration.unregisterCount == 0)
    #expect(!h.preference.enabled)
    await vm.shutdownAppOwnedService()
}

@Test("App-service settings keep registration explicit and gate snapshot readiness", .petLanguage(.korean))
@MainActor
func petAppServiceViewModelReadiness() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    let transport = PetFakeTransport()
    let vm = PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: c
    )
    await vm.beginOnboarding()
    #expect(h.launcher.launches == 0)
    await vm.enableAppOwnedService()
    await vm.registerOnboardingService()
    #expect(h.registration.registerCount == 0)
    #expect(vm.presentationTitle == "서비스 시작 중")
    await vm.refresh()
    #expect(await transport.requestCount(type: "get_state") == 0)
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await vm.refresh()
    #expect(vm.appOwnedServiceState == .ready)
    #expect(vm.presentationState == .ready)
    vm.applySnapshotForTesting(try PetSnapshot.parse(petTestSnapshotData(
        cards: [PetTestCard(suffix: "received-before-exit")]
    )))
    #expect(!vm.connectionReceivedCardProjectPaths.isEmpty)
    child.isRunning = false
    await vm.refresh()
    #expect(vm.snapshot == nil)
    #expect(vm.connectionReceivedCardProjectPaths.isEmpty)
    #expect(vm.appOwnedServiceState == .failed("app_service_exited"))
    #expect(vm.connectionReadiness.checks[0].state == .failed)
    #expect(PetSettingsStatusTone.connection(vm.connectionReadiness) == .error)
    #expect(vm.connectionReadiness.nextStep == .service)
    #expect(await transport.requestCount(type: "get_state") == 1)
    await vm.shutdownAppOwnedService()
}

private actor DelayedAppServiceSnapshot: PetCoordinatorTransport {
    private(set) var waiting = false
    private var continuation: CheckedContinuation<Data, Never>?
    func request(type: String, payload: Data) async throws -> Data {
        waiting = true
        return await withCheckedContinuation { continuation = $0 }
    }
    func complete(_ data: Data) { continuation?.resume(returning: data); continuation = nil }
}

@Test("Snapshot already in flight cannot restore UI after app shutdown", .petLanguage(.korean))
@MainActor
func petAppServiceLateSnapshotAfterShutdown() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    let transport = DelayedAppServiceSnapshot()
    let vm = PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: c
    )
    await vm.enableAppOwnedService()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    let request = Task { await vm.refresh() }
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while !(await transport.waiting), ContinuousClock.now < deadline { await Task.yield() }
    try #require(await transport.waiting)
    await vm.shutdownAppOwnedService()
    await transport.complete(try petTestSnapshotData(cards: []))
    await request.value
    #expect(vm.snapshot == nil)
    #expect(child.stopCount == 1)
    #expect(h.launcher.launches == 1)
}

@Test("Service polling backs off on errors and remains bounded", .petLanguage(.korean))
func petAppServicePollingBackoff() {
    #expect(PetServicePollingPolicy.delayNanoseconds(base: 500_000_000, consecutiveFailures: 0) == 500_000_000)
    #expect(PetServicePollingPolicy.delayNanoseconds(base: 500_000_000, consecutiveFailures: 1) == 1_000_000_000)
    #expect(PetServicePollingPolicy.delayNanoseconds(base: 500_000_000, consecutiveFailures: 9) == 4_000_000_000)
    #expect(PetServicePollingPolicy.delayNanoseconds(base: .max, consecutiveFailures: 3) == .max)
}

@Test("Identical ready snapshots do not publish service state repeatedly", .petLanguage(.korean))
@MainActor
func petAppServiceIdleStateDoesNotRepublish() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    var changes = 0
    c.onChange = { changes += 1 }
    c.enable()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    c.receivedVerifiedSnapshot(generation: c.generation)
    let readyChanges = changes
    for _ in 0..<20 { c.receivedVerifiedSnapshot(generation: c.generation) }
    #expect(changes == readyChanges)
    await c.shutdown()
}

@Test("Service failures explain manual recovery without destructive advice", .petLanguage(.korean))
func petAppServiceRecoveryMessages() {
    #expect(PetAppServiceState.failed("operational_owner_active").detail.contains("기존 실행을 직접 종료"))
    #expect(PetAppServiceState.failed("app_service_identity_mismatch").detail.contains("앱을 완전히 종료"))
    #expect(PetAppServiceState.failed("freshness_anchor_corrupt").detail.contains("삭제하지 말고"))
    #expect(PetAppServiceState.failed("freshness_lock_busy").detail.contains("대기를 마쳤습니다"))
    #expect(PetAppServiceState.failed("freshness_lock_busy").detail.contains("자동으로 다시 실행하지 않습니다"))
    #expect(AppOwnedServiceControlFrame.failureCode(
        in: AppOwnedServiceControlFrame.failure(code: "freshness_lock_busy")
    ) == "freshness_lock_busy")
    #expect(PetAppServiceState.failed("freshness_transition_pending").detail.contains("원래 저장 내용과 권한"))
    #expect(PetAppServiceState.failed("freshness_transition_pending").detail.contains("과거 선택을 다시 보내거나"))
    #expect(PetAppServiceState.failed("app_service_connection_timeout").detail.contains("다시 시작"))
    #expect(PetAppServiceState.failed("app_service_stop_incomplete").detail.contains("새 실행을 막았습니다"))
    #expect(PetAppServiceState.unresponsive.title == "서비스 응답 지연")
    #expect(PetAppServiceState.unresponsive.detail.contains("실행 중인 서비스를 유지"))
    #expect(PetAppServiceState.unresponsive.detail.contains("기존 작업을 자동으로 다시 보내지 않습니다"))
    #expect(PetAppServiceState.unresponsive.detail.contains("설정에서 서비스 다시 시작"))
}

@Test("Cancelled app shutdown joins a pending restart stop without respawning", .petLanguage(.korean))
@MainActor
func petAppServiceShutdownDuringRestart() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    c.enable()
    let child = try #require(h.launcher.children.first)
    child.stopBlocked = true
    let restart = Task { await c.restart() }
    try await waitForAppService { child.stopWaiter != nil }
    var shutdownStarted = false
    let shutdown = Task { shutdownStarted = true; await c.shutdown() }
    shutdown.cancel()
    try await waitForAppService { shutdownStarted }
    child.releaseStop()
    await restart.value
    await shutdown.value
    #expect(child.stopCount == 1)
    #expect(h.launcher.launches == 1)
    #expect(!c.hasOwnedChild)
    #expect(!c.mayQueryCoordinator)
}

@Test("VM ignores an earlier generation's snapshot after explicit restart", .petLanguage(.korean))
@MainActor
func petAppServiceLateSnapshotAfterRestart() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
    let transport = DelayedAppServiceSnapshot()
    let vm = PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: c
    )
    await vm.enableAppOwnedService()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    let request = Task { await vm.refresh() }
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while !(await transport.waiting), ContinuousClock.now < deadline { await Task.yield() }
    try #require(await transport.waiting)
    vm.applySnapshotForTesting(try PetSnapshot.parse(petTestSnapshotData(
        cards: [PetTestCard(suffix: "received-before-restart")]
    )))
    #expect(!vm.connectionReceivedCardProjectPaths.isEmpty)
    await vm.restartAppOwnedService()
    #expect(vm.connectionReceivedCardProjectPaths.isEmpty)
    let replacement = try #require(h.launcher.children.last)
    replacement.hasPublishedService = true
    await transport.complete(try petTestSnapshotData(cards: [PetTestCard(suffix: "old-instance")]))
    await request.value
    #expect(vm.snapshot == nil)
    #expect(vm.appOwnedServiceState == .starting)
    #expect(h.launcher.launches == 2)
    await vm.shutdownAppOwnedService()
}

@Test("A delayed service keeps actions cleared beyond its reconnect budget and a verified response restores them", .petLanguage(.korean))
@MainActor
func petAppServiceConnectionLossClearsActions() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 20_000_000, startupTimeout: 2_000_000_000)
    let transport = PetFakeTransport()
    let vm = PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: h.registration, appService: c
    )
    await vm.enableAppOwnedService()
    let child = try #require(h.launcher.children.first)
    child.hasPublishedService = true
    let data = try petTestSnapshotData(
        cards: [], permissionRequests: [PetTestPermissionRequest(suffix: "health")]
    )
    await transport.enqueue(type: "get_state", response: data)
    await vm.refresh()
    #expect(vm.pendingPermissionRequest != nil)
    #expect(vm.hasVerifiedServiceConnection)
    await transport.enqueueFailure(type: "get_state", code: "lost")
    await vm.refresh()
    #expect(vm.pendingPermissionRequest == nil)
    #expect(vm.snapshot == nil)
    #expect(vm.appOwnedServiceState == .reconnecting)
    try await waitForAppService { vm.appOwnedServiceState == .unresponsive }
    #expect(vm.snapshot == nil)
    #expect(vm.pendingPermissionRequest == nil)
    #expect(!vm.hasVerifiedServiceConnection)
    #expect(vm.presentationTitle == "서비스 응답 지연")
    #expect(vm.canChangeAppOwnedService)
    #expect(child.stopCount == 0)
    #expect(h.launcher.launches == 1)
    await transport.enqueue(type: "get_state", response: data)
    await vm.refresh()
    #expect(vm.appOwnedServiceState == .ready)
    #expect(vm.pendingPermissionRequest != nil)
    #expect(vm.hasVerifiedServiceConnection)
    #expect(h.launcher.launches == 1)
    #expect(child.stopCount == 0)
    #expect(await transport.requestCount(type: "get_state") == 3)
    #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
    #expect(await transport.requestCount(type: "select") == 0)
    #expect(await transport.requestCount(type: "dismiss_interaction") == 0)
    await vm.shutdownAppOwnedService()
}
