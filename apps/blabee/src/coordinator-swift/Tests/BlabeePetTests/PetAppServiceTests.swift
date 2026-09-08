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

    func controller(timeout: UInt64 = 12_000_000_000) -> PetAppServiceController {
        PetAppServiceController(
            launcher: launcher, preference: preference,
            registration: { registration.state },
            readinessTimeoutNanoseconds: timeout
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

@Test("App-owned service is opt-in and repeated startup never launches twice")
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

@Test("Existing macOS registration blocks app-owned launch without changing registration",
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

@Test("No known registration permits explicit launch", arguments: [PetServiceRegistrationState.notRegistered, .notFound])
@MainActor
func petAppServiceNoRegistration(_ registration: PetServiceRegistrationState) async {
    let h = AppServiceHarness()
    h.registration.state = registration
    let c = h.controller()
    c.enable()
    #expect(h.launcher.launches == 1)
    await c.shutdown()
}

@Test("Launch failures are diagnostic-only and never auto-respawn")
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

@Test("Startup deadline stops the owned child and leaves manual recovery")
@MainActor
func petAppServiceStartupTimeout() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 20_000_000)
    c.enable()
    try await waitForAppService { c.state == .failed("app_service_connection_timeout") }
    #expect(h.launcher.children.first?.stopCount == 1)
    #expect(!c.hasOwnedChild)
    for _ in 0..<10 { c.startAtAppLaunch(); c.checkChildBeforePolling() }
    #expect(h.launcher.launches == 1)
    await c.shutdown()
}

@Test("Crash and uncertain cleanup never adopt or start another service")
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

@Test("Late snapshots cannot mark a replacement ready and reconnect has a deadline")
@MainActor
func petAppServiceGenerationAndConnectionLoss() async throws {
    let h = AppServiceHarness()
    let c = h.controller(timeout: 50_000_000)
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
    try await waitForAppService { c.state == .failed("app_service_connection_timeout") }
    #expect(child.stopCount == 1)
    #expect(h.launcher.launches == 2)
}

@Test("Concurrent restart and opt-out are serialized around owned cleanup")
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

@Test("App-service settings keep registration explicit and gate snapshot readiness")
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
    child.isRunning = false
    await vm.refresh()
    #expect(vm.snapshot == nil)
    #expect(vm.appOwnedServiceState == .failed("app_service_exited"))
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

@Test("Snapshot already in flight cannot restore UI after app shutdown")
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

@Test("Service polling backs off on errors and remains bounded")
func petAppServicePollingBackoff() {
    #expect(PetServicePollingPolicy.delayNanoseconds(base: 500_000_000, consecutiveFailures: 0) == 500_000_000)
    #expect(PetServicePollingPolicy.delayNanoseconds(base: 500_000_000, consecutiveFailures: 1) == 1_000_000_000)
    #expect(PetServicePollingPolicy.delayNanoseconds(base: 500_000_000, consecutiveFailures: 9) == 4_000_000_000)
    #expect(PetServicePollingPolicy.delayNanoseconds(base: .max, consecutiveFailures: 3) == .max)
}

@Test("Identical ready snapshots do not publish service state repeatedly")
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

@Test("Service failures explain manual recovery without destructive advice")
func petAppServiceRecoveryMessages() {
    #expect(PetAppServiceState.failed("operational_owner_active").detail.contains("기존 실행을 직접 종료"))
    #expect(PetAppServiceState.failed("app_service_identity_mismatch").detail.contains("앱을 완전히 종료"))
    #expect(PetAppServiceState.failed("freshness_anchor_corrupt").detail.contains("삭제하지 말고"))
    #expect(PetAppServiceState.failed("app_service_connection_timeout").detail.contains("다시 시작"))
    #expect(PetAppServiceState.failed("app_service_stop_incomplete").detail.contains("새 실행을 막았습니다"))
}

@Test("Cancelled app shutdown joins a pending restart stop without respawning")
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

@Test("VM ignores an earlier generation's snapshot after explicit restart")
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
    await vm.restartAppOwnedService()
    let replacement = try #require(h.launcher.children.last)
    replacement.hasPublishedService = true
    await transport.complete(try petTestSnapshotData(cards: [PetTestCard(suffix: "old-instance")]))
    await request.value
    #expect(vm.snapshot == nil)
    #expect(vm.appOwnedServiceState == .starting)
    #expect(h.launcher.launches == 2)
    await vm.shutdownAppOwnedService()
}

@Test("Connection failure clears a permission card and verified recovery restores it")
@MainActor
func petAppServiceConnectionLossClearsActions() async throws {
    let h = AppServiceHarness()
    let c = h.controller()
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
    await transport.enqueueFailure(type: "get_state", code: "lost")
    await vm.refresh()
    #expect(vm.pendingPermissionRequest == nil)
    #expect(vm.snapshot == nil)
    #expect(vm.appOwnedServiceState == .reconnecting)
    await transport.enqueue(type: "get_state", response: data)
    await vm.refresh()
    #expect(vm.appOwnedServiceState == .ready)
    #expect(vm.pendingPermissionRequest != nil)
    #expect(h.launcher.launches == 1)
    #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
    await vm.shutdownAppOwnedService()
}
