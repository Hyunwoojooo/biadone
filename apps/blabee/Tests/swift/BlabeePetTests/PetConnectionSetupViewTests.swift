import AppKit
import CoordinatorSwift
import SwiftUI
import Testing
import Vision
@testable import BlabeeCoordinator

private struct ConnectionViewSuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) { Issue.record("Rendering must not save preferences") }
}

private struct ConnectionViewCodexManager: CodexPluginSetupManaging {
    var code = "codex_native_path_unsafe"
    var state: CodexPluginSetupState?
    func inspect() async -> CodexPluginSetupState { state ?? .error(code: code) }
    func connect() async -> CodexPluginSetupState {
        Issue.record("Guidance must not connect Codex")
        return await inspect()
    }
    func disconnect() async -> CodexPluginSetupState {
        Issue.record("Guidance must not disconnect Codex")
        return await inspect()
    }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) async -> CodexPluginSetupState {
        Issue.record("Guidance must not migrate Codex")
        return await inspect()
    }
}

private struct ConnectionViewUpdateChecker: PetAppUpdateChecking {
    let currentVersion: PetAppUpdateVersion? = nil
    let result: PetAppUpdateState
    func checkForUpdates() async -> PetAppUpdateState { result }
}

private struct ConnectionViewPreparationFailure: LocalizedError {
    var errorDescription: String? { "Fixture: the service did not become ready." }
}

@MainActor
private final class ConnectionViewServicePreferences: PetAppServicePreferenceStoring {
    var enabled = true
}

@MainActor
private final class ConnectionViewFailedLauncher: AppOwnedServiceLaunching {
    var launches = 0
    let code: String
    init(code: String = "freshness_storage_missing") { self.code = code }
    func launch() throws -> any AppOwnedServiceChild {
        launches += 1
        throw CoordinatorError(code)
    }
}

private actor ConnectionViewRecoveryManager: PetStorageRecoveryManaging {
    var prepares = 0
    var recoveries = 0
    func prepare() async throws -> PetStorageRecoveryConfirmation {
        prepares += 1
        return .init(id: UUID(), backupDirectoryURL: URL(fileURLWithPath: "/fixture/recovery"), residualFileNames: [])
    }
    func recover(confirmation: PetStorageRecoveryConfirmation) async throws -> PetStorageRecoveryReceipt {
        recoveries += 1
        Issue.record("Viewing recovery must not reset storage")
        return .init(backupDirectoryURL: confirmation.backupDirectoryURL)
    }
}

@MainActor
private final class ConnectionViewOnboardingAdapter: PetOnboardingAdapting {
    let path = "/tmp/blabee-connection-view-project"
    private let savedPaths: [String]?
    init(savedPaths: [String]? = ["/tmp/blabee-connection-view-project"]) { self.savedPaths = savedPaths }
    func serviceRegistrationState() -> PetServiceRegistrationState { .notRegistered }
    func configuredProjectPaths() throws -> [String] { savedPaths ?? [] }
    func configuredProjectPathsIfPresent() throws -> [String]? { savedPaths }
    func registerService() throws { Issue.record("Rendering must not register a service") }
    func unregisterService() async throws { Issue.record("Rendering must not unregister a service") }
    func openSystemSettingsLoginItems() { Issue.record("Rendering must not open system settings") }
    func enableProject(at path: String) throws { Issue.record("Rendering must not add projects") }
    func disableProject(at path: String) throws { Issue.record("Rendering must not remove projects") }
}

private struct ConnectionViewHooks: PetHookReadinessManaging {
    func inspect(projectURL: URL) async -> PetHookReadinessState { .reviewRequired }
}

@MainActor
private final class ConnectionViewInspectionGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            for observer in observers { observer.resume() }
            observers.removeAll()
        }
    }

    func waitUntilEntered() async {
        if continuation != nil { return }
        await withCheckedContinuation { observers.append($0) }
    }

    func release() { continuation?.resume(); continuation = nil }
}

@Suite("Unified connection setup views", .petLanguage(.korean))
@MainActor
struct PetConnectionSetupViewTests {
    init() throws { try PetTypographyTestResources.register() }

    @Test("Missing scope defaults to home only after verification and an explicit empty scope stays empty")
    func workingFolderScopePresentation() {
        #expect(PetCodexWorkingFolderScope(paths: [], areAuthoritative: false, scopeExists: false) == .unverified)
        #expect(PetCodexWorkingFolderScope(paths: ["/saved/project"], areAuthoritative: false, scopeExists: true) == .unverified)
        let missing = PetCodexWorkingFolderScope(paths: [], areAuthoritative: true, scopeExists: false)
        #expect(missing == .homeDefault)
        #expect(missing.summary.contains("연결하면 홈 폴더와 그 하위 폴더"))
        let empty = PetCodexWorkingFolderScope(paths: [], areAuthoritative: true, scopeExists: true)
        #expect(empty == .empty)
        #expect(empty.summary == "선택한 작업 폴더가 없어요.")
        #expect(empty.advancedHint.contains("고급 설정에서 작업 폴더를 추가"))
        #expect(!empty.summary.contains("홈 폴더"))
        let custom = PetCodexWorkingFolderScope(paths: ["/saved/project"], areAuthoritative: true, scopeExists: true)
        #expect(custom == .configured)
        #expect(custom.summary.contains("저장한 작업 폴더"))
        #expect(!custom.summary.contains("홈 폴더"))
    }

    @Test("English scope copy explains the first Connect default and preserves an explicit empty scope", .petLanguage(.english))
    func englishWorkingFolderScopePresentation() {
        #expect(PetCodexWorkingFolderScope.homeDefault.summary == "Connect will use your home folder and its subfolders.")
        #expect(PetCodexWorkingFolderScope.empty.summary == "No working folders are selected.")
        #expect(PetCodexWorkingFolderScope.empty.advancedHint.contains("Add a working folder in Advanced Settings"))
        #expect(!PetCodexWorkingFolderScope.unverified.summary.contains("home folder"))
    }

    @Test("Available Codex can progress while Claude needs attention, without completing Claude")
    func mixedAvailableToolAction() async {
        var configured: [PetConnectionSetupProvider] = []
        let controller = PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex, .claude]),
            inspect: { .init(serviceReady: true, providers: [
                .codex: .init(status: configured.contains(.codex) ? .configured : .available),
                .claude: .init(status: .needsAction, detail: "Terminal settings need attention.")
            ]) }, prepare: {}, configure: { configured.append($0) })
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(), suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        model.connectionSetup = controller
        await controller.refresh()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .connectAvailable)
        #expect(view.primaryActionTitle == "Codex 연결하기")
        #expect(view.primaryActionEnabled && view.primaryActionIsEmphasized)
        #expect(view.summaryDetail.contains("Codex") && view.summaryDetail.contains("Claude"))
        await view.performPrimaryAction()
        #expect(configured == [.codex])
        #expect(controller.state(for: .claude).status == .needsAction)
        #expect(!controller.canFinish)
        #expect(view.guidanceStep == .reviewRequirements)
        model.setConnectionProviderSelected(.claude, selected: false)
        #expect(controller.canFinish)
    }

    @Test("Missing storage leads directly to reviewable recovery, never a reset or generic connect loop")
    func missingStorageGuidance() async {
        let launcher = ConnectionViewFailedLauncher()
        let recovery = ConnectionViewRecoveryManager()
        let (model, service) = missingStorageModel(launcher: launcher, recovery: recovery)
        defer { model.endFirstRunSetup(); model.stopPolling() }
        model.beginFirstRunSetup()
        service.startAtAppLaunch()
        await model.refreshConnectionSetup()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .storageRecovery)
        #expect(view.primaryActionTitle == "복구 가능 여부 확인")
        #expect(view.primaryActionEnabled && !view.showsPrimaryAction)
        #expect(view.requiresStorageRecovery)
        #expect(view.providerStatusTitle(for: .codex) == "Blabee 준비 대기")
        #expect(view.summaryDetail.contains("freshness_storage_missing"))
        #expect(!model.isConnectionSetupReady)
        await model.refreshConnectionSetup()
        #expect(view.guidanceStep == .storageRecovery)
        #expect(launcher.launches == 1)
        await view.performPrimaryAction()
        #expect(await recovery.prepares == 1)
        #expect(await recovery.recoveries == 0)
        #expect(model.storageRecoveryConfirmation != nil)
        #expect(launcher.launches == 1)
        #expect(!model.isConnectionSetupReady)
        model.cancelStorageRecovery()
        model.setConnectionProviderSelected(.codex, selected: false)
        // A shared service fault remains relevant even with no tool selected.
        #expect(view.guidanceStep == .storageRecovery)
    }

    @Test("Other service failures show their actual diagnostic without offering a storage reset")
    func otherServiceFailureGuidance() async {
        let launcher = ConnectionViewFailedLauncher(code: "freshness_anchor_corrupt")
        let (model, service) = missingStorageModel(launcher: launcher)
        defer { model.endFirstRunSetup(); model.stopPolling() }
        model.beginFirstRunSetup()
        service.startAtAppLaunch()
        await model.refreshConnectionSetup()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .serviceIssue)
        #expect(view.guidanceDetail.contains("freshness_anchor_corrupt"))
        #expect(!view.requiresStorageRecovery && !model.canPrepareStorageRecovery)
        #expect(!model.connectionSetup.canFinish && launcher.launches == 1)
    }

    @Test("Partial failure offers remaining setup while deferring that provider preserves completed setup")
    func partialFailureAction() async {
        let transport = PetFakeTransport()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        let inspection = PetConnectionSetupInspection(serviceReady: true, providers: [
            .codex: .init(status: .configured, detail: "설정 완료", sessionEvidence: .waitingForSession),
            .claude: .init(status: .failed, detail: "터미널 자동 연결 설정을 확인해 주세요.")
        ])
        let controller = fixture(inspection: inspection, selected: [.codex, .claude])
        model.connectionSetup = controller
        await controller.refresh()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(!controller.canFinish)
        #expect(view.primaryActionTitle == "남은 연결 다시 시도")
        #expect(view.guidanceStep == .retry)
        #expect(view.primaryActionIsEmphasized)
        model.setConnectionProviderSelected(.claude, selected: false)
        #expect(controller.canFinish)
        #expect(view.primaryActionTitle == "설정 다시 확인")
        #expect(view.guidanceStep == .ready)
        #expect(!view.primaryActionIsEmphasized)
        #expect(!view.showsPrimaryAction)
        #expect(view.guidanceDetail.contains("새 대화"))
        #expect(controller.state(for: .codex).sessionEvidence == .waitingForSession)
        #expect(await transport.requestCount(type: "select") == 0)
    }

    @Test("Guidance follows selection and readiness without treating saved settings as a live connection")
    func selectionGuidance() async {
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        let controller = fixture(inspection: .init(serviceReady: true, providers: [
            .claude: .init(status: .available)
        ]), selected: [])
        model.connectionSetup = controller
        await controller.refresh()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .chooseTools)
        #expect(!view.primaryActionEnabled)
        model.setConnectionProviderSelected(.claude, selected: true)
        #expect(view.guidanceStep == .connect)
        #expect(view.guidanceDetail.contains("‘연결하기’"))
        #expect(view.primaryActionEnabled && view.primaryActionIsEmphasized)

        controller.receiveObservation(.init(serviceReady: true, providers: [
            .claude: .init(status: .configured, sessionEvidence: .waitingForSession)
        ]))
        #expect(view.guidanceStep == .ready)
        #expect(!view.primaryActionIsEmphasized)
        #expect(controller.state(for: .claude).sessionEvidence == .waitingForSession)
        // The shared settings view must not point to an onboarding-only button.
        #expect(!view.guidanceDetail.contains("하단") && !view.guidanceDetail.contains("완료 버튼"))

        controller.receiveObservation(.init(serviceReady: false, providers: [
            .claude: .init(status: .configured, sessionEvidence: .unavailable)
        ]))
        #expect(view.guidanceStep != .ready)
        #expect(!controller.canFinish)
    }

    @Test("Missing tools and external approval requirements each have a relevant primary action")
    func requirementsGuidance() async {
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        let controller = fixture(inspection: .init(serviceReady: true, providers: [
            .claude: .init(status: .needsInstall)
        ]), selected: [.claude])
        model.connectionSetup = controller
        await controller.refresh()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .installTools)
        #expect(view.primaryActionTitle == "Claude 설치 안내")
        #expect(view.primaryActionEnabled && view.primaryActionIsEmphasized)
        controller.receiveObservation(.init(serviceReady: true, providers: [
            .claude: .init(status: .needsAction, sessionEvidence: .waitingForApproval)
        ]))
        #expect(view.guidanceStep == .reviewRequirements)
        #expect(view.primaryActionTitle == "다시 확인")
        #expect(view.primaryActionIsEmphasized)
        #expect(!controller.canFinish)
    }

    @Test("Codex recovery guidance applies only when Codex is selected")
    func recoveryGuidance() async {
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 codexPluginSetupManager: ConnectionViewCodexManager(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        await model.refreshCodexPluginSetup()
        let controller = fixture(inspection: .init(serviceReady: true, providers: [
            .codex: .init(status: .failed), .claude: .init(status: .available)
        ]), selected: [.claude])
        model.connectionSetup = controller
        await controller.refresh()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .connect)
        model.setConnectionProviderSelected(.codex, selected: true)
        #expect(view.guidanceStep == .codexRecovery)
        #expect(view.primaryActionTitle == "재검사 후 연결")
        #expect(view.primaryActionIsEmphasized)
        #expect(model.codexHookReadiness != .trusted)
    }

    @Test("The initial primary action inspects and completes setup without a separate check click")
    func primaryActionContinuesAfterInspection() async {
        var prepared = false
        var configured = false
        var prepares = 0
        var configurations: [PetConnectionSetupProvider] = []
        let controller = PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]),
            inspect: {
                .init(serviceReady: prepared, providers: [
                    .claude: .init(status: configured ? .configured : .available)
                ])
            },
            prepare: { prepared = true; prepares += 1 },
            configure: { provider in configured = true; configurations.append(provider) }
        )
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        model.connectionSetup = controller
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .checkSettings)
        #expect(view.primaryActionEnabled && view.primaryActionIsEmphasized)
        await view.performPrimaryAction()
        #expect(prepares == 1 && configurations == [.claude])
        #expect(controller.canFinish)
        #expect(view.guidanceStep == .ready && !view.showsPrimaryAction)
    }

    @Test("The install primary action opens the official guide without installing or connecting")
    func primaryInstallationGuide() async {
        var opened: [URL] = []
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore(),
                                 appUpdateURLOpener: { opened.append($0); return true })
        defer { model.stopPolling() }
        let controller = fixture(inspection: .init(serviceReady: false, providers: [
            .claude: .init(status: .needsInstall)
        ]), selected: [.claude])
        model.connectionSetup = controller
        await controller.refresh()
        await PetConnectionSetupView(viewModel: model).performPrimaryAction()
        #expect(opened.map(\.absoluteString) == ["https://code.claude.com/docs/en/setup"])
        #expect(!controller.canFinish && !controller.isWorking)
    }

    @Test("A common preparation failure stays visible beside the retry action")
    func preparationFailureGuidance() async {
        let controller = PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]),
            inspect: { .init(serviceReady: false, providers: [.claude: .init(status: .available)]) },
            prepare: { throw ConnectionViewPreparationFailure() },
            configure: { _ in Issue.record("A failed service must not configure a provider") }
        )
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        model.connectionSetup = controller
        let view = PetConnectionSetupView(viewModel: model)
        await view.performPrimaryAction()
        #expect(controller.phase == .failed)
        #expect(view.guidanceStep == .retry && view.primaryActionIsEmphasized)
        #expect(view.guidanceDetail == "Fixture: the service did not become ready.")
        #expect(!controller.canFinish)
    }

    @Test("Codex compatibility recovery exposes update and download actions without advanced settings")
    func compatibilityRecoveryOffersUpdate() async throws {
        let release = PetAppUpdateRelease(
            version: try #require(PetAppUpdateVersion(version: "0.1.0", build: "999")),
            releaseURL: try #require(URL(string: "https://github.com/example/blabee/releases/tag/test"))
        )
        var opened: [URL] = []
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 codexPluginSetupManager: ConnectionViewCodexManager(code: "codex_native_version_unqualified"),
                                 suggestionModeStore: ConnectionViewSuggestionStore(),
                                 appUpdateChecker: ConnectionViewUpdateChecker(result: .available(release)),
                                 appUpdateURLOpener: { opened.append($0); return true })
        defer { model.stopPolling() }
        await model.refreshCodexPluginSetup()
        let controller = fixture(inspection: .init(serviceReady: false, providers: [
            .codex: .init(status: .failed)
        ]), selected: [.codex])
        model.connectionSetup = controller
        await controller.refresh()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .codexRecovery)
        #expect(view.primaryActionTitle == "Blabee 업데이트 확인")
        await view.performPrimaryAction()
        #expect(model.appUpdateState == .available(release))
        #expect(view.primaryActionTitle == "Blabee 다운로드 열기")
        await view.performPrimaryAction()
        #expect(opened == [release.releaseURL])
        #expect(!controller.canFinish && model.codexHookReadiness != .trusted)
    }

    @Test("An in-flight check directs users to wait and keeps setup disabled")
    func busyGuidance() async {
        let gate = ConnectionViewInspectionGate()
        let controller = PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]),
            inspect: {
                await gate.wait()
                return .init(serviceReady: true, providers: [.claude: .init(status: .available)])
            }, prepare: { Issue.record("Guidance must not start a service") },
            configure: { _ in Issue.record("Guidance must not configure a tool") }
        )
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        model.connectionSetup = controller
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.guidanceStep == .checkSettings)
        let pending = Task { await controller.refresh() }
        await gate.waitUntilEntered()
        #expect(view.guidanceStep == .working)
        #expect(!view.primaryActionEnabled && !view.primaryActionIsEmphasized)
        gate.release()
        await pending.value
        #expect(view.guidanceStep == .connect)
        #expect(view.primaryActionEnabled)
    }

    @Test("English guidance names the visible next action", .petLanguage(.english))
    func englishGuidance() async {
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        let controller = fixture(inspection: .init(serviceReady: true, providers: [
            .claude: .init(status: .available)
        ]), selected: [.claude])
        model.connectionSetup = controller
        await controller.refresh()
        let view = PetConnectionSetupView(viewModel: model)
        #expect(view.primaryActionTitle == "Connect")
        #expect(view.guidanceTitle == "Next: press Connect")
        #expect(view.guidanceDetail.contains("Press Connect"))
        #expect(!view.guidanceDetail.contains("folder chooser"))
    }

    @Test("Unconfigured and missing tools stay explicit without mutating settings during rendering")
    func renderProviderStates() async throws {
        try await renderStates()
    }

    @Test("English connection guidance and primary actions fit narrow screens", .petLanguage(.english))
    func renderEnglishProviderStates() async throws {
        try await renderStates()
    }

    @Test("Codex review, compatibility recovery and service failure render in the complete small onboarding window")
    func renderCodexGuidedStages() async throws { try await renderGuidedStages() }

    @Test("English Codex review and recovery actions render in the complete small onboarding window", .petLanguage(.english))
    func renderEnglishCodexGuidedStages() async throws { try await renderGuidedStages() }

    @Test("Home default and empty scope render in the small onboarding window when opted in")
    func renderWorkingFolderScope() async throws {
        guard ProcessInfo.processInfo.environment["BLABEE_HOME_DEFAULT_SETTINGS_RENDERS"] == "1" else { return }
        try await renderGuidedStages(scenarios: ["home-default", "empty-scope"])
    }

    @Test("English home default and empty scope render in the small onboarding window when opted in", .petLanguage(.english))
    func renderEnglishWorkingFolderScope() async throws {
        guard ProcessInfo.processInfo.environment["BLABEE_HOME_DEFAULT_SETTINGS_RENDERS"] == "1" else { return }
        try await renderGuidedStages(scenarios: ["home-default", "empty-scope"])
    }

    private func renderGuidedStages(scenarios: [String] = ["hook-review", "compatibility", "service-failed", "storage-missing", "mixed-tools"]) async throws {
        let restoreLanguage = petRenderLanguageOverride(PetL10n.language)
        defer { restoreLanguage() }
        for scenario in scenarios {
            for dark in [false, true] {
                let transport = PetFakeTransport()
                let adapter = scenario == "home-default" ? ConnectionViewOnboardingAdapter(savedPaths: nil)
                    : scenario == "empty-scope" ? ConnectionViewOnboardingAdapter(savedPaths: [])
                    : ConnectionViewOnboardingAdapter()
                let plugin: CodexPluginSetupState = scenario == "compatibility"
                    ? .error(code: "codex_native_version_unqualified") : .installedNeedsHookReview(version: "0.1.3")
                let missingService = scenario == "storage-missing" ? PetAppServiceController(
                    launcher: ConnectionViewFailedLauncher(), preference: ConnectionViewServicePreferences(),
                    registration: { .notRegistered }) : nil
                let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                    claudeConnection: fakeClaudeConnection(), onboardingAdapter: adapter,
                    appService: missingService,
                    codexPluginSetupManager: ConnectionViewCodexManager(state: plugin),
                    hookReadinessManager: ConnectionViewHooks(), storageRecoveryManager: ConnectionViewRecoveryManager(),
                    suggestionModeStore: ConnectionViewSuggestionStore(),
                    appUpdateChecker: ConnectionViewUpdateChecker(result: .upToDate),
                    appUpdateURLOpener: { _ in Issue.record("Rendering must not open a browser"); return false })
                model.beginFirstRunSetup()
                missingService?.startAtAppLaunch()
                defer { model.endFirstRunSetup(); model.stopPolling() }
                var object = petTestSnapshotObject(cards: [])
                object["projects"] = [["project_id": "project_view", "cwd": adapter.path, "enabled": true]]
                let response = try petTestData(object)
                for _ in 0..<20 { await transport.enqueue(type: "get_state", response: response) }
                await model.refreshOnboarding()
                await model.refreshCodexPluginSetup()
                await model.refreshFirstRunSetup(inspectSettings: false)
                await model.checkCodexHooks()
                let state: PetConnectionSetupStatus = scenario == "compatibility" ? .failed
                    : scenario == "home-default" ? .available : .needsAction
                let inspection = PetConnectionSetupInspection(serviceReady: true, providers: [
                    .codex: .init(status: state, detail: "Review Codex."), .claude: .init(status: .available)
                ])
                let setup = fixture(inspection: inspection, selected: [.codex])
                if scenario == "service-failed" {
                    // This fixture fails before a service is ready, without any
                    // real launch or provider configuration.
                    model.endFirstRunSetup()
                    model.beginFirstRunSetup()
                    let failing = PetConnectionSetupController(
                        store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.codex]),
                        inspect: { .init(serviceReady: false, providers: [.codex: .init(status: .available)]) },
                        prepare: { throw ConnectionViewPreparationFailure() },
                        configure: { _ in Issue.record("Rendering must not configure a provider") })
                    model.connectionSetup = failing
                    await failing.connect()
                } else if scenario == "storage-missing" {
                    model.setConnectionProviderSelected(.codex, selected: true)
                    await model.refreshConnectionSetup()
                } else if scenario == "mixed-tools" {
                    model.connectionSetup = fixture(inspection: .init(serviceReady: true, providers: [
                        .codex: .init(status: .available),
                        .claude: .init(status: .needsAction, detail: "Terminal auto-connect needs attention.")
                    ]), selected: [.codex, .claude])
                    await model.connectionSetup.refresh()
                } else {
                    model.connectionSetup = setup
                    await setup.refresh()
                }
                let wizard = PetFirstRunController(store: FirstRunRenderStore(), legalDocuments: .deferred)
                wizard.skipTutorial()
                wizard.synchronizeAccount(id: "test-only-account", email: nil)
                #expect(wizard.continueAfterSignIn() && wizard.saveDataSharingPreferences())
                let suite = "blabee-guided-connection-render-\(UUID().uuidString)"
                let defaults = try #require(UserDefaults(suiteName: suite))
                defer { defaults.removePersistentDomain(forName: suite) }
                let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunRenderLoginItem(), applyTheme: { _ in })
                let size = NSSize(width: 460, height: 550)
                let view = PetFirstRunView(controller: wizard, viewModel: model, preferences: preferences,
                    onFinish: { _ in Issue.record("Rendering must not complete setup") }, onClose: {})
                    .frame(width: size.width, height: size.height)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .environment(\.petAirForceOpaqueSurfaces, true)
                let host = NSHostingView(rootView: view)
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                let window = NSWindow(contentRect: NSRect(x: -20_000, y: -20_000, width: size.width, height: size.height),
                                      styleMask: .borderless, backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                defer { window.contentView = nil; window.close() }
                host.frame = NSRect(origin: .zero, size: size)
                for _ in 0..<5 {
                    host.layoutSubtreeIfNeeded()
                    window.displayIfNeeded()
                    try await Task.sleep(for: .milliseconds(20))
                }
                if scenario == "service-failed" {
                    await model.connectionSetup.connect()
                    for _ in 0..<3 {
                        await Task.yield()
                        host.layoutSubtreeIfNeeded()
                        window.displayIfNeeded()
                    }
                }
                let stage = PetConnectionSetupView(viewModel: model).guidanceStep
                let expectedStage: PetConnectionSetupView.GuidanceStep = switch scenario {
                case "hook-review": .hookReview
                case "compatibility": .codexRecovery
                case "storage-missing": .storageRecovery
                case "mixed-tools": .connectAvailable
                case "home-default": .connect
                case "empty-scope": .reviewRequirements
                default: .retry
                }
                #expect(stage == expectedStage)
                if scenario == "home-default" {
                    #expect(PetConnectionSetupView(viewModel: model).workingFolderScope == .homeDefault)
                } else if scenario == "empty-scope" {
                    #expect(PetConnectionSetupView(viewModel: model).workingFolderScope == .empty)
                }
                let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.effectiveAppearance.performAsCurrentDrawingAppearance { host.cacheDisplay(in: host.bounds, to: bitmap) }
                #expect(host.fittingSize.width <= size.width + 1)
                #expect(!model.isConnectionSetupReady)
                try expectVisiblePrimaryAction(in: bitmap, host: host,
                    title: PetConnectionSetupView(viewModel: model).primaryActionTitle)
                if let directory = ProcessInfo.processInfo.environment["BLABEE_CONNECTION_SETUP_RENDER_DIRECTORY"] {
                    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                    let data = try #require(bitmap.representation(using: .png, properties: [:]))
                    try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent(
                        "onboarding-\(scenario)-460-\(dark ? "dark" : "light")-\(PetL10n.language.rawValue).png"))
                }
                #expect(await transport.requestCount(type: "select") == 0)
                #expect(await transport.requestCount(type: "focus_event") == 0)
                #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
            }
        }
    }

    private func expectVisiblePrimaryAction(in bitmap: NSBitmapImageRep, host: NSView, title: String) throws {
        // Read the actual offscreen pixels. A fitting-size check alone does not
        // detect a primary action hidden behind the wizard's fixed footer.
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = [PetL10n.language == .korean ? "ko-KR" : "en-US"]
        request.customWords = [title]
        try VNImageRequestHandler(cgImage: #require(bitmap.cgImage)).perform([request])
        func normalized(_ text: String) -> String { text.lowercased().filter { $0.isLetter || $0.isNumber } }
        let match = try #require(request.results?.first {
            $0.topCandidates(1).first.map { normalized($0.string).contains(normalized(title)) } == true
        }, "The current primary action must be visible without scrolling: \(title)")
        func firstScrollView(_ view: NSView) -> NSScrollView? {
            if let scroll = view as? NSScrollView { return scroll }
            for child in view.subviews {
                if let scroll = firstScrollView(child) { return scroll }
            }
            return nil
        }
        let scroll = try #require(firstScrollView(host))
        let frame = host.convert(scroll.contentView.bounds, from: scroll.contentView)
        let viewport = CGRect(x: frame.minX / host.bounds.width,
            y: host.isFlipped ? 1 - frame.maxY / host.bounds.height : frame.minY / host.bounds.height,
            width: frame.width / host.bounds.width, height: frame.height / host.bounds.height)
        #expect(viewport.contains(match.boundingBox.insetBy(dx: 0, dy: -8 / host.bounds.height)),
                "The primary action needs space above the fixed footer: \(title)")
    }

    private func renderStates() async throws {
        let restoreLanguage = petRenderLanguageOverride(PetL10n.language)
        defer { restoreLanguage() }
        let transport = PetFakeTransport()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                                 claudeConnection: fakeClaudeConnection(),
                                 suggestionModeStore: ConnectionViewSuggestionStore())
        defer { model.stopPolling() }
        let scenarios: [(String, Set<PetConnectionSetupProvider>, PetConnectionSetupInspection)] = [
            ("not-installed", [], .init(serviceReady: false, providers: [
                .codex: .init(status: .needsInstall, detail: "Codex를 찾지 못했어요."),
                .claude: .init(status: .needsInstall, detail: "Claude를 찾지 못했어요.")
            ])),
            ("ready-to-connect", [.codex, .claude], .init(serviceReady: true, providers: [
                .codex: .init(status: .available, detail: "Codex is available."),
                .claude: .init(status: .available, detail: "Claude is available.")
            ])),
            ("claude-ready", [.claude], .init(serviceReady: true, providers: [
                .codex: .init(status: .needsInstall, detail: "Codex를 찾지 못했어요."),
                .claude: .init(status: .configured, detail: "새 터미널에서 평소처럼 시작하세요.",
                              sessionEvidence: .waitingForSession)
            ])),
            ("partial", [.codex, .claude], .init(serviceReady: true, providers: [
                .codex: .init(status: .configured, detail: "설정 완료", sessionEvidence: .ready),
                .claude: .init(status: .needsAction, detail: "열린 터미널에서 요청을 확인해 주세요.",
                              sessionEvidence: .waitingForApproval)
            ])),
            ("both-ready", [.codex, .claude], .init(serviceReady: true, providers: [
                .codex: .init(status: .configured, detail: "설정 완료", sessionEvidence: .waitingForSession),
                .claude: .init(status: .configured, detail: "설정 완료", sessionEvidence: .ready)
            ]))
        ]
        for (name, selected, inspection) in scenarios {
            let controller = fixture(inspection: inspection, selected: selected)
            model.connectionSetup = controller
            await controller.refresh()
            for dark in [false, true] {
                let width: CGFloat = ["partial", "ready-to-connect"].contains(name) ? 340 : 420
                let size = NSSize(width: width, height: 550)
                let view = ScrollView {
                    PetConnectionSetupView(viewModel: model).padding(8)
                }
                .frame(width: size.width, height: size.height)
                .foregroundStyle(PetAirPalette.ink(for: dark ? .dark : .light))
                .background(PetAirPalette.panel(for: dark ? .dark : .light))
                .environment(\.colorScheme, dark ? .dark : .light)
                .environment(\.petAirForceOpaqueSurfaces, true)
                let host = NSHostingView(rootView: view)
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                let window = NSWindow(contentRect: NSRect(x: -20_000, y: -20_000, width: size.width, height: size.height),
                                      styleMask: .borderless, backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.contentView = host
                // Never order this fixture window or activate the app.
                defer { window.close() }
                host.frame = NSRect(origin: .zero, size: size)
                host.layoutSubtreeIfNeeded()
                let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.effectiveAppearance.performAsCurrentDrawingAppearance {
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                }
                // Rendering starts SwiftUI's appearance task. Let its fixture
                // inspection settle before capturing the named status scenario.
                for _ in 0..<100 {
                    await Task.yield()
                    if !controller.isWorking && controller.hasCurrentInspection { break }
                }
                #expect(!controller.isWorking && controller.hasCurrentInspection)
                for _ in 0..<5 {
                    host.layoutSubtreeIfNeeded()
                    window.displayIfNeeded()
                    try await Task.sleep(for: .milliseconds(20))
                }
                host.layoutSubtreeIfNeeded()
                host.effectiveAppearance.performAsCurrentDrawingAppearance {
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                }
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                #expect(abs(host.bounds.width - size.width) < 0.1)
                #expect(host.fittingSize.width <= size.width + 1)
                if name == "ready-to-connect" || name == "both-ready" {
                    let content = NSHostingView(rootView:
                        PetConnectionSetupView(viewModel: model).padding(8).frame(width: width))
                    #expect(content.fittingSize.height <= 510,
                            "The main connection action must fit a small window without opening advanced settings")
                }
                if let directory = ProcessInfo.processInfo.environment["BLABEE_CONNECTION_SETUP_RENDER_DIRECTORY"] {
                    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                    let data = try #require(bitmap.representation(using: .png, properties: [:]))
                    try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent(
                        "connection-setup-\(name)-\(Int(width))-\(dark ? "dark" : "light")-\(PetL10n.language.rawValue).png"))
                }
            }
            #expect(controller.selectedProviders == selected)
        }
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(await transport.requestCount(type: "focus_interaction") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        for payload in await transport.requestPayloads(type: "get_state") {
            let object = try #require(JSONSerialization.jsonObject(with: payload) as? [String: Any])
            #expect(object["consumer_heartbeat"] as? Bool != true)
        }
    }

    private func fakeClaudeConnection() -> PetClaudeConnectionController {
        let inspection = ClaudeAutoConnectSetup.Inspection(isEnabled: false, canEnable: false, canDisable: false,
                                                           detail: "fixture")
        return PetClaudeConnectionController(inspect: { inspection }, enable: {
            Issue.record("Guidance must not enable Claude")
            return inspection
        }, disable: {
            Issue.record("Guidance must not disable Claude")
            return inspection
        })
    }

    private func missingStorageModel(
        launcher: ConnectionViewFailedLauncher,
        recovery: ConnectionViewRecoveryManager = ConnectionViewRecoveryManager()
    ) -> (PetViewModel, PetAppServiceController) {
        let service = PetAppServiceController(launcher: launcher, preference: ConnectionViewServicePreferences(),
                                             registration: { .notRegistered })
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
            claudeConnection: fakeClaudeConnection(), onboardingAdapter: ConnectionViewOnboardingAdapter(), appService: service,
            codexPluginSetupManager: ConnectionViewCodexManager(state: .installedNeedsHookReview(version: "0.1.3")),
            hookReadinessManager: ConnectionViewHooks(), storageRecoveryManager: recovery,
            suggestionModeStore: ConnectionViewSuggestionStore())
        model.setConnectionProviderSelected(.codex, selected: true)
        return (model, service)
    }

    private func fixture(inspection: PetConnectionSetupInspection,
                         selected: Set<PetConnectionSetupProvider>) -> PetConnectionSetupController {
        PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: selected),
            inspect: { inspection },
            prepare: { Issue.record("Rendering must not start a service") },
            configure: { _ in Issue.record("Rendering must not change provider settings") }
        )
    }
}
