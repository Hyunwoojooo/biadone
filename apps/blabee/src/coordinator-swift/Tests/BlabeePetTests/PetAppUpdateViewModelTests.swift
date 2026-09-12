import Foundation
import Testing
@testable import BlabeeCoordinator

private actor AppUpdateTestChecker: PetAppUpdateChecking {
    nonisolated let currentVersion = PetAppUpdateVersion(version: "0.1.0", build: "30")
    private(set) var calls = 0
    private var result: PetAppUpdateState
    private var blocked: Bool
    private var continuation: CheckedContinuation<Void, Never>?

    init(result: PetAppUpdateState, blocked: Bool = false) {
        self.result = result
        self.blocked = blocked
    }

    func checkForUpdates() async -> PetAppUpdateState {
        calls += 1
        if blocked {
            await withCheckedContinuation { continuation = $0 }
        }
        return result
    }

    func finish(with result: PetAppUpdateState) {
        self.result = result
        blocked = false
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class AppUpdateTestOnboardingAdapter: PetOnboardingAdapting {
    var paths = ["/tmp/update-project"]
    private(set) var reads = 0
    func serviceRegistrationState() -> PetServiceRegistrationState { .notRegistered }
    func configuredProjectPaths() throws -> [String] { reads += 1; return paths }
    func registerService() throws { Issue.record("Update settings must not register services") }
    func unregisterService() async throws { Issue.record("Update settings must not unregister services") }
    func openSystemSettingsLoginItems() { Issue.record("Update settings must not open System Settings") }
    func enableProject(at path: String) throws { Issue.record("Update settings must not change projects") }
    func disableProject(at path: String) throws { Issue.record("Update settings must not change projects") }
}

@Suite("Pet app update view model")
struct PetAppUpdateViewModelTests {
    @Test("Opening settings is local and repeated menu actions request the update section")
    @MainActor
    func settingsDoNotCheckAutomatically() async {
        let checker = AppUpdateTestChecker(result: .upToDate)
        let onboarding = AppUpdateTestOnboardingAdapter()
        let vm = viewModel(checker: checker, onboarding: onboarding)
        vm.beginShortcutSettings()
        let firstRequest = vm.appUpdateSettingsRequestID
        vm.showAppUpdateSettings()
        #expect(vm.isShowingOnboarding && vm.isExpanded)
        #expect(!vm.isEditingShortcuts)
        #expect(vm.appUpdateSettingsRequestID != firstRequest)
        #expect(vm.configuredProjectPathsAreAuthoritative)
        #expect(vm.configuredProjectPaths == ["/tmp/update-project"])
        #expect(vm.onboardingServiceState == .notRegistered)
        let nextRequest = vm.appUpdateSettingsRequestID
        onboarding.paths = ["/tmp/refreshed-project"]
        vm.showAppUpdateSettings()
        #expect(vm.appUpdateSettingsRequestID != nextRequest)
        #expect(vm.appUpdateState == .notChecked)
        #expect(vm.appVersionDisplay == "0.1.0 (빌드 30)")
        #expect(vm.configuredProjectPaths == ["/tmp/refreshed-project"])
        #expect(onboarding.reads == 2)
        #expect(await checker.calls == 0)
    }

    @Test("Concurrent checks share one request and failure can be retried")
    @MainActor
    func singleFlightAndRetry() async throws {
        let checker = AppUpdateTestChecker(result: .upToDate, blocked: true)
        let vm = viewModel(checker: checker)
        let task = Task { await vm.checkForAppUpdates() }
        try await waitForCheck(checker)
        #expect(vm.isCheckingForAppUpdate)
        await vm.checkForAppUpdates()
        #expect(await checker.calls == 1)
        await checker.finish(with: .unavailable("네트워크 연결을 확인해 주세요."))
        await task.value
        #expect(vm.appUpdateState.isFailure)
        #expect(!vm.isCheckingForAppUpdate)
        await checker.finish(with: .upToDate)
        await vm.checkForAppUpdates()
        #expect(await checker.calls == 2)
        #expect(vm.appUpdateState == .upToDate)
    }

    @Test("Only a checked available release opens a browser and browser failure is visible")
    @MainActor
    func opensAvailableReleaseOnly() async throws {
        let url = try #require(URL(string: "https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.31"))
        let version = try #require(PetAppUpdateVersion(version: "0.1.0", build: "31"))
        let checker = AppUpdateTestChecker(result: .noPublishedRelease)
        var opened: [URL] = []
        let vm = viewModel(checker: checker, openURL: { opened.append($0); return false })
        vm.openAppUpdateLocation()
        await vm.checkForAppUpdates()
        vm.openAppUpdateLocation()
        #expect(opened.isEmpty)
        await checker.finish(with: .available(PetAppUpdateRelease(version: version, releaseURL: url)))
        await vm.checkForAppUpdates()
        #expect(opened.isEmpty)
        vm.openAppUpdateLocation()
        #expect(opened == [url])
        #expect(vm.appUpdateState.isFailure)
    }

    @Test("Cancelled checks restore an actionable idle state")
    @MainActor
    func cancelledCheckCanRetry() async throws {
        let checker = AppUpdateTestChecker(result: .upToDate, blocked: true)
        let vm = viewModel(checker: checker)
        let task = Task { await vm.checkForAppUpdates() }
        try await waitForCheck(checker)
        task.cancel()
        await checker.finish(with: .upToDate)
        await task.value
        #expect(vm.appUpdateState == .notChecked)
        await vm.checkForAppUpdates()
        #expect(vm.appUpdateState == .upToDate)
    }

    @MainActor
    private func viewModel(
        checker: AppUpdateTestChecker,
        onboarding: any PetOnboardingAdapting = PetUnavailableOnboardingAdapter(),
        openURL: @escaping @MainActor (URL) -> Bool = { _ in true }
    ) -> PetViewModel {
        PetViewModel(
            transport: PetFakeTransport(),
            externalApplicationOpener: PetFakeApplicationOpener(),
            onboardingAdapter: onboarding,
            appUpdateChecker: checker,
            appUpdateURLOpener: openURL
        )
    }

    private func waitForCheck(_ checker: AppUpdateTestChecker) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while await checker.calls == 0, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(2))
        }
        #expect(await checker.calls == 1)
    }
}
