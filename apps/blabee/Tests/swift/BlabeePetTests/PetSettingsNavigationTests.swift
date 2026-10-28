import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct SettingsNavigationSuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) {}
}

private actor SettingsNavigationCleanupManager: LegacyCodexShellCleanupManaging {
    private(set) var preparations = 0
    private(set) var cleanups = 0
    private let pausePreparation: Bool
    private var gate: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []

    init(pausePreparation: Bool = false) { self.pausePreparation = pausePreparation }

    func inspect() async -> LegacyCodexShellCleanupInspection {
        .init(status: .available, detail: "fixture only")
    }

    func prepare() async -> LegacyCodexShellCleanupConfirmation? {
        preparations += 1
        if pausePreparation {
            await withCheckedContinuation { continuation in
                gate = continuation
                for observer in observers { observer.resume() }
                observers.removeAll()
            }
        }
        return .init(id: UUID(), wrapperPath: "/fixture/wrapper",
                     startupPath: "/fixture/.zshrc", detail: "fixture confirmation")
    }

    func cleanup(confirmation _: LegacyCodexShellCleanupConfirmation) async -> LegacyCodexShellCleanupInspection {
        cleanups += 1
        return .init(status: .cleaned, detail: "fixture cleaned")
    }

    func waitForPreparation() async {
        if gate != nil { return }
        await withCheckedContinuation { observers.append($0) }
    }

    func resume() {
        gate?.resume()
        gate = nil
    }
}

@Suite("Air settings navigation")
@MainActor
struct PetSettingsNavigationTests {
    @Test("The Codex overview action opens Connection without changing a draft or starting setup")
    func codexOverviewOpensConnection() async {
        let manager = SettingsNavigationCleanupManager()
        let model = makeModel(cleanup: manager)
        model.beginShortcutSettings()
        model.updatePreviewShortcutDraft(.disabled)
        model.selectSettingsTab(.general)
        let draft = model.shortcutDraft
        let view = PetSettingsView(viewModel: model)
        view.openCodexConnectionSettings()
        #expect(model.selectedSettingsTab == .connection)
        #expect(model.isShowingSettings && model.isEditingShortcuts)
        #expect(model.shortcutDraft == draft)
        #expect(!model.connectionSetup.isWorking)
        #expect(await manager.preparations == 0)
        #expect(await manager.cleanups == 0)
    }

    @Test("Moving from shortcut edits to Connection preserves the draft and cleanup works")
    func draftAndConnectionActionsCoexist() async throws {
        let manager = SettingsNavigationCleanupManager()
        let model = makeModel(cleanup: manager)
        model.beginShortcutSettings()
        model.updatePreviewShortcutDraft(.disabled)
        let draft = model.shortcutDraft
        model.selectSettingsTab(.connection)

        #expect(model.selectedSettingsTab == .connection)
        #expect(model.isShowingSettings && model.isEditingShortcuts && !model.isShowingOnboarding)
        #expect(model.shortcutDraft == draft)
        await model.inspectLegacyShellCleanup()
        await model.prepareLegacyShellCleanup()
        #expect(model.legacyShellCleanupConfirmation != nil)
        await model.confirmLegacyShellCleanup()
        #expect(await manager.preparations == 1)
        #expect(await manager.cleanups == 1)
        #expect(model.legacyShellCleanupConfirmation == nil)

        model.selectSettingsTab(.general)
        model.selectSettingsTab(.projects)
        model.selectSettingsTab(.shortcuts)
        #expect(model.shortcutDraft == draft)
    }

    @Test("Approval interruption preserves the selected pane and draft for the remounted view",
          arguments: [PetSettingsTab.general, .projects, .connection])
    func approvalInterruption(_ tab: PetSettingsTab) throws {
        let model = makeModel()
        model.beginShortcutSettings()
        model.updatePreviewShortcutDraft(.disabled)
        model.selectSettingsTab(tab)
        let draft = model.shortcutDraft

        // The root replaces its settings child with this higher-priority approval.
        try model.receiveSnapshotDataForTesting(petTestSnapshotData(
            cards: [], permissionRequests: [PetTestPermissionRequest(suffix: "settings")],
            permissionNoticeCount: 1
        ))
        #expect(model.pendingPermissionRequest != nil)
        #expect(model.selectedSettingsTab == tab)
        #expect(model.shortcutDraft == draft)

        // Removing the approval makes a new PetSettingsView read the same selection.
        try model.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [], permissionNoticeCount: 1))
        #expect(model.pendingPermissionRequest == nil)
        #expect(model.isShowingSettings)
        #expect(model.selectedSettingsTab == tab)
        #expect(model.shortcutDraft == draft)
    }

    @Test("Explicit entry, cancel, save and update menu retain their reset semantics")
    func explicitEntryAndExit() async throws {
        let model = makeModel()
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: .defaults) { _ in }
        model.attachHotKeyRegistry(registry)
        defer { model.stopPolling() }

        await model.beginOnboarding()
        #expect(model.selectedSettingsTab == .general)
        model.selectSettingsTab(.shortcuts)
        #expect(model.selectedSettingsTab == .shortcuts)
        model.updatePreviewShortcutDraft(.disabled)
        model.cancelShortcutSettings()
        #expect(!model.isShowingSettings)
        #expect(model.shortcutDraft == model.shortcutConfiguration)

        model.beginShortcutSettings()
        model.updatePreviewShortcutDraft(.disabled)
        model.selectSettingsTab(.projects)
        model.showAppUpdateSettings()
        #expect(model.selectedSettingsTab == .general && model.isShowingOnboarding)
        #expect(model.shortcutDraft == model.shortcutConfiguration)
        #expect(model.appUpdateState == .notChecked)

        model.beginShortcutSettings()
        model.updatePreviewShortcutDraft(.disabled)
        model.saveShortcutSettings()
        #expect(!model.isShowingSettings)
        #expect(model.shortcutConfiguration.previewPreset == .disabled)
        await model.beginOnboarding()
        #expect(model.selectedSettingsTab == .general)
        model.closeOnboarding()
        #expect(!model.isShowingSettings)
    }

    @Test("Closing settings after shortcut edits invalidates pending cleanup preparation")
    func closingFromShortcutModeCancelsPreparation() async {
        let manager = SettingsNavigationCleanupManager(pausePreparation: true)
        let model = makeModel(cleanup: manager)
        model.beginShortcutSettings()
        model.selectSettingsTab(.connection)
        await model.inspectLegacyShellCleanup()
        let preparation = Task { await model.prepareLegacyShellCleanup() }
        await manager.waitForPreparation()
        model.cancelShortcutSettings()
        model.beginShortcutSettings()
        model.selectSettingsTab(.connection)
        await manager.resume()
        await preparation.value
        #expect(model.legacyShellCleanupConfirmation == nil)
        await model.confirmLegacyShellCleanup()
        #expect(await manager.cleanups == 0)
    }

    private func makeModel(
        cleanup: any LegacyCodexShellCleanupManaging = LegacyUnavailableCodexShellCleanupManager()
    ) -> PetViewModel {
        PetViewModel(
            transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
            legacyShellCleanupManager: cleanup, suggestionModeStore: SettingsNavigationSuggestionStore(),
            processIdentifier: 999
        )
    }
}
