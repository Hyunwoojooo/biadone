import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct LegacyCleanupSuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) {}
}

private actor LegacyCleanupFake: LegacyCodexShellCleanupManaging {
    enum PauseAt { case prepare, cleanup }
    private let pauseAt: PauseAt?
    private let available: Bool
    private var inspections = 0
    private var preparations = 0
    private var cleanups = 0
    private var gate: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []

    init(pauseAt: PauseAt? = nil, available: Bool = true) {
        self.pauseAt = pauseAt
        self.available = available
    }

    func inspect() async -> LegacyCodexShellCleanupInspection {
        inspections += 1
        return .init(status: available ? .available : .manualReview, detail: "fixture only")
    }

    func prepare() async -> LegacyCodexShellCleanupConfirmation? {
        preparations += 1
        if pauseAt == .prepare { await pause() }
        return .init(id: UUID(), wrapperPath: "/fixture/wrapper", startupPath: "/fixture/.zshrc", detail: "fixture confirmation")
    }

    func cleanup(confirmation _: LegacyCodexShellCleanupConfirmation) async -> LegacyCodexShellCleanupInspection {
        cleanups += 1
        if pauseAt == .cleanup { await pause() }
        return .init(status: .cleaned, detail: "only wrapper moved", backupPath: "/fixture/backup")
    }

    func counts() -> (inspect: Int, prepare: Int, cleanup: Int) { (inspections, preparations, cleanups) }
    func waitForPause() async {
        if gate != nil { return }
        await withCheckedContinuation { observers.append($0) }
    }
    func resume() {
        let pending = gate
        gate = nil
        pending?.resume()
    }
    private func pause() async {
        await withCheckedContinuation { continuation in
            gate = continuation
            let pending = observers
            observers.removeAll()
            for observer in pending { observer.resume() }
        }
    }
}

@MainActor
private func cleanupViewModel(_ manager: LegacyCleanupFake) -> PetViewModel {
    PetViewModel(
        transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(),
        legacyShellCleanupManager: manager, suggestionModeStore: LegacyCleanupSuggestionStore(),
        processIdentifier: 999
    )
}

@Test("Opening or refreshing settings never inspects or changes the user's shell")
@MainActor
func petLegacyCleanupOnlyExplicitInspection() async {
    let manager = LegacyCleanupFake()
    let model = cleanupViewModel(manager)
    await model.beginOnboarding()
    await model.refreshAllOnboardingSettings()
    #expect(await manager.counts().inspect == 0)
    #expect(model.legacyShellCleanupInspection == nil)
    await model.inspectLegacyShellCleanup()
    #expect(await manager.counts().inspect == 1)
    #expect(await manager.counts().prepare == 0)
    #expect(await manager.counts().cleanup == 0)
}

@Test("Cleanup requires separate inspection, preparation and consumed explicit confirmation")
@MainActor
func petLegacyCleanupExplicitConfirmation() async {
    let manager = LegacyCleanupFake()
    let model = cleanupViewModel(manager)
    await model.beginOnboarding()
    await model.prepareLegacyShellCleanup()
    await model.confirmLegacyShellCleanup()
    #expect(await manager.counts().prepare == 0)
    #expect(await manager.counts().cleanup == 0)
    await model.inspectLegacyShellCleanup()
    await model.prepareLegacyShellCleanup()
    #expect(model.legacyShellCleanupConfirmation != nil)
    #expect(await manager.counts().cleanup == 0)
    model.cancelLegacyShellCleanup()
    await model.confirmLegacyShellCleanup()
    #expect(await manager.counts().cleanup == 0)
    await model.prepareLegacyShellCleanup()
    await model.confirmLegacyShellCleanup()
    await model.confirmLegacyShellCleanup()
    #expect(await manager.counts().cleanup == 1)
    #expect(model.legacyShellCleanupConfirmation == nil)
    #expect(model.legacyShellCleanupInspection?.backupPath == "/fixture/backup")
    #expect(!model.isOnboardingOperationInFlight)
}

@Test("Closing settings invalidates an already awaiting cleanup confirmation")
@MainActor
func petLegacyCleanupCloseCancelsPendingPreparation() async {
    let manager = LegacyCleanupFake(pauseAt: .prepare)
    let model = cleanupViewModel(manager)
    await model.beginOnboarding()
    await model.inspectLegacyShellCleanup()
    let request = Task { await model.prepareLegacyShellCleanup() }
    await manager.waitForPause()
    model.closeOnboarding()
    await model.beginOnboarding()
    await manager.resume()
    await request.value
    #expect(model.legacyShellCleanupConfirmation == nil)
    await model.confirmLegacyShellCleanup()
    #expect(await manager.counts().cleanup == 0)
}

@Test("Repeated cleanup clicks and inspection during cleanup never replay the mutation")
@MainActor
func petLegacyCleanupDropsRepeatedActions() async {
    let manager = LegacyCleanupFake(pauseAt: .cleanup)
    let model = cleanupViewModel(manager)
    await model.beginOnboarding()
    await model.inspectLegacyShellCleanup()
    await model.prepareLegacyShellCleanup()
    let request = Task { await model.confirmLegacyShellCleanup() }
    await manager.waitForPause()
    #expect(model.isLegacyShellCleanupOperationInFlight)
    #expect(model.isOnboardingOperationInFlight)
    await model.confirmLegacyShellCleanup()
    await model.prepareLegacyShellCleanup()
    await model.inspectLegacyShellCleanup()
    #expect(await manager.counts().cleanup == 1)
    #expect(await manager.counts().inspect == 1)
    await manager.resume()
    await request.value
    #expect(!model.isLegacyShellCleanupOperationInFlight)
    #expect(model.legacyShellCleanupInspection?.status == .cleaned)
}

@Test("Unknown or modified shell settings cannot be prepared for automatic cleanup")
@MainActor
func petLegacyCleanupManualReviewBlocksMutation() async {
    let manager = LegacyCleanupFake(available: false)
    let model = cleanupViewModel(manager)
    await model.beginOnboarding()
    await model.inspectLegacyShellCleanup()
    await model.prepareLegacyShellCleanup()
    await model.confirmLegacyShellCleanup()
    #expect(await manager.counts().prepare == 0)
    #expect(await manager.counts().cleanup == 0)
    #expect(model.legacyShellCleanupInspection?.status == .manualReview)
}

@Test("Starting a new shell inspection invalidates the previous confirmation")
@MainActor
func petLegacyCleanupNewScanCancelsConfirmation() async {
    let manager = LegacyCleanupFake()
    let model = cleanupViewModel(manager)
    await model.beginOnboarding()
    await model.inspectLegacyShellCleanup()
    await model.prepareLegacyShellCleanup()
    #expect(model.legacyShellCleanupConfirmation != nil)
    await model.inspectLegacyShellCleanup()
    await model.confirmLegacyShellCleanup()
    #expect(model.legacyShellCleanupConfirmation == nil)
    #expect(await manager.counts().cleanup == 0)
}
