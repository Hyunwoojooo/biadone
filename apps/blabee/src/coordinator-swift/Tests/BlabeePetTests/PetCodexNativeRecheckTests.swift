import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct PetRecheckSuggestionModeStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult {
        BlabeeSuggestionModeLoadResult(mode: .smart, diagnostic: nil)
    }

    func save(_: BlabeeSuggestionMode) {}
}

private actor PetNativeRecheckManager: CodexPluginSetupManaging {
    private let blocksRecheck: Bool
    private let blocksConnect: Bool
    private var inspectCalls = 0
    private var recheckCalls = 0
    private var connectCalls = 0
    private var pauseContinuation: CheckedContinuation<Void, Never>?
    private var pauseObservers: [CheckedContinuation<Void, Never>] = []

    init(blocksRecheck: Bool = false, blocksConnect: Bool = false) {
        self.blocksRecheck = blocksRecheck
        self.blocksConnect = blocksConnect
    }

    func inspect() async -> CodexPluginSetupState {
        inspectCalls += 1
        return .notInstalled
    }

    func recheckNativeExecutable() async -> CodexPluginSetupState {
        recheckCalls += 1
        if blocksRecheck { await pause() }
        return .installedNeedsHookReview(version: "0.1.0")
    }

    func connect() async -> CodexPluginSetupState {
        connectCalls += 1
        if blocksConnect { await pause() }
        return .installedNeedsHookReview(version: "0.1.0")
    }

    func disconnect() async -> CodexPluginSetupState { .notInstalled }

    func migrateLegacyInstallation(
        confirmation _: CodexPluginSetupLegacyMigrationConfirmation
    ) async -> CodexPluginSetupState { .notInstalled }

    func callCounts() -> (inspect: Int, recheck: Int, connect: Int) {
        (inspectCalls, recheckCalls, connectCalls)
    }

    func waitUntilPaused() async {
        if pauseContinuation != nil { return }
        await withCheckedContinuation { pauseObservers.append($0) }
    }

    func resume() {
        let continuation = pauseContinuation
        pauseContinuation = nil
        continuation?.resume()
    }

    private func pause() async {
        await withCheckedContinuation { continuation in
            pauseContinuation = continuation
            let observers = pauseObservers
            pauseObservers = []
            for observer in observers { observer.resume() }
        }
    }
}

@MainActor
private func petNativeRecheckViewModel(
    manager: PetNativeRecheckManager
) -> PetViewModel {
    PetViewModel(
        transport: PetFakeTransport(),
        externalApplicationOpener: PetFakeApplicationOpener(),
        codexPluginSetupManager: manager,
        suggestionModeStore: PetRecheckSuggestionModeStore(),
        processIdentifier: 999
    )
}

@Test("Passive Pet settings refresh never requests native Codex execution recheck")
@MainActor
func petCodexNativeRecheckRequiresExplicitAction() async {
    let manager = PetNativeRecheckManager()
    let viewModel = petNativeRecheckViewModel(manager: manager)

    await viewModel.beginOnboarding()
    await viewModel.refreshAllOnboardingSettings()
    await viewModel.refreshCodexPluginSetup()
    #expect((await manager.callCounts()).inspect == 2)
    #expect((await manager.callCounts()).recheck == 0)

    await viewModel.recheckCodexNativeExecutable()
    #expect((await manager.callCounts()).recheck == 1)
    #expect((await manager.callCounts()).inspect == 2)
    #expect(viewModel.codexPluginSetupState == .installedNeedsHookReview(version: "0.1.0"))
    #expect(!viewModel.isCodexPluginOperationInFlight)
}

@Test("Pet drops repeated native recheck clicks and drains queued refreshes as inspect only")
@MainActor
func petCodexNativeRecheckDoesNotQueueRepeatedClicks() async {
    let manager = PetNativeRecheckManager(blocksRecheck: true)
    let viewModel = petNativeRecheckViewModel(manager: manager)
    let first = Task { @MainActor in await viewModel.recheckCodexNativeExecutable() }
    await manager.waitUntilPaused()
    #expect(viewModel.isCodexPluginOperationInFlight)

    await viewModel.recheckCodexNativeExecutable()
    await viewModel.recheckCodexNativeExecutable()
    await viewModel.refreshCodexPluginSetup()
    await viewModel.refreshAllOnboardingSettings()
    #expect((await manager.callCounts()).recheck == 1)
    #expect((await manager.callCounts()).inspect == 0)

    await manager.resume()
    await first.value
    #expect((await manager.callCounts()).recheck == 1)
    #expect((await manager.callCounts()).inspect == 1)
    #expect(viewModel.codexPluginSetupState == .notInstalled)
    #expect(!viewModel.isCodexPluginOperationInFlight)
}

@Test("Pet does not retain native recheck requests received during another Plugin operation")
@MainActor
func petCodexNativeRecheckDoesNotQueueBehindConnect() async {
    let manager = PetNativeRecheckManager(blocksConnect: true)
    let viewModel = petNativeRecheckViewModel(manager: manager)
    let connect = Task { @MainActor in await viewModel.connectCodexPlugin() }
    await manager.waitUntilPaused()

    await viewModel.recheckCodexNativeExecutable()
    await viewModel.refreshCodexPluginSetup()
    #expect((await manager.callCounts()).recheck == 0)

    await manager.resume()
    await connect.value
    #expect((await manager.callCounts()).connect == 1)
    #expect((await manager.callCounts()).recheck == 0)
    #expect((await manager.callCounts()).inspect == 1)
    #expect(!viewModel.isCodexPluginOperationInFlight)

    await viewModel.recheckCodexNativeExecutable()
    #expect((await manager.callCounts()).recheck == 1)
}
