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
    private let recheckState: CodexPluginSetupState
    private var inspectCalls = 0
    private var recheckCalls = 0
    private var connectCalls = 0
    private var pauseContinuation: CheckedContinuation<Void, Never>?
    private var pauseObservers: [CheckedContinuation<Void, Never>] = []

    init(
        blocksRecheck: Bool = false,
        blocksConnect: Bool = false,
        recheckState: CodexPluginSetupState = .installedNeedsHookReview(version: "0.1.0")
    ) {
        self.blocksRecheck = blocksRecheck
        self.blocksConnect = blocksConnect
        self.recheckState = recheckState
    }

    func inspect() async -> CodexPluginSetupState {
        inspectCalls += 1
        return .notInstalled
    }

    func recheckNativeExecutable() async -> CodexPluginSetupState {
        recheckCalls += 1
        if blocksRecheck { await pause() }
        return recheckState
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
    #expect(viewModel.codexNativeRecheckReport == nil)

    await viewModel.recheckCodexNativeExecutable()
    #expect((await manager.callCounts()).recheck == 1)
    #expect((await manager.callCounts()).inspect == 2)
    #expect(viewModel.codexPluginSetupState == .installedNeedsHookReview(version: "0.1.0"))
    #expect(!viewModel.isCodexPluginOperationInFlight)
    #expect(viewModel.codexNativeRecheckReport?.isChecking == false)
    #expect(viewModel.codexNativeRecheckReport?.result?.state == .installedNeedsHookReview(version: "0.1.0"))
}

@Test("Pet drops repeated native recheck clicks and drains queued refreshes as inspect only")
@MainActor
func petCodexNativeRecheckDoesNotQueueRepeatedClicks() async {
    let manager = PetNativeRecheckManager(blocksRecheck: true)
    let viewModel = petNativeRecheckViewModel(manager: manager)
    let first = Task { @MainActor in await viewModel.recheckCodexNativeExecutable() }
    await manager.waitUntilPaused()
    #expect(viewModel.isCodexPluginOperationInFlight)
    let reportID = viewModel.codexNativeRecheckReport?.id
    #expect(viewModel.codexNativeRecheckReport?.isChecking == true)
    #expect(viewModel.codexNativeRecheckReport?.result == nil)

    await viewModel.recheckCodexNativeExecutable()
    await viewModel.recheckCodexNativeExecutable()
    await viewModel.refreshCodexPluginSetup()
    await viewModel.refreshAllOnboardingSettings()
    #expect((await manager.callCounts()).recheck == 1)
    #expect((await manager.callCounts()).inspect == 0)
    #expect(viewModel.codexNativeRecheckReport?.id == reportID)

    await manager.resume()
    await first.value
    #expect((await manager.callCounts()).recheck == 1)
    #expect((await manager.callCounts()).inspect == 1)
    #expect(viewModel.codexPluginSetupState == .notInstalled)
    #expect(viewModel.codexNativeRecheckReport?.id == reportID)
    #expect(viewModel.codexNativeRecheckReport?.result?.state == .installedNeedsHookReview(version: "0.1.0"))
    #expect(viewModel.codexNativeRecheckReport?.completedAt != nil)
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
    #expect(viewModel.codexNativeRecheckReport == nil)

    await manager.resume()
    await connect.value
    #expect((await manager.callCounts()).connect == 1)
    #expect((await manager.callCounts()).recheck == 0)
    #expect((await manager.callCounts()).inspect == 1)
    #expect(!viewModel.isCodexPluginOperationInFlight)

    await viewModel.recheckCodexNativeExecutable()
    #expect((await manager.callCounts()).recheck == 1)
}

@Test("Repeated identical errors produce fresh explicit check receipts retained through passive refresh")
@MainActor
func petCodexNativeRecheckSameErrorStillCompletesFreshReport() async throws {
    let manager = PetNativeRecheckManager(recheckState: .error(code: "codex_native_probe_timeout"))
    let viewModel = petNativeRecheckViewModel(manager: manager)
    await viewModel.recheckCodexNativeExecutable()
    let first = try #require(viewModel.codexNativeRecheckReport)
    #expect(first.completedAt != nil)
    #expect(first.elapsedSeconds != nil)

    await viewModel.recheckCodexNativeExecutable()
    let second = try #require(viewModel.codexNativeRecheckReport)
    #expect(second.id != first.id)
    #expect(second.startedAt >= first.startedAt)
    #expect(try #require(second.completedAt) >= second.startedAt)
    #expect(try #require(second.elapsedSeconds) >= 0)
    #expect(second.result == first.result)
    #expect(second.result?.evidence.stage == .unknown)
    #expect(second.result?.evidence.sourcePath == nil)

    await viewModel.refreshCodexPluginSetup()
    #expect(viewModel.codexPluginSetupState == .notInstalled)
    #expect(viewModel.codexNativeRecheckReport == second)
    #expect((await manager.callCounts()).recheck == 2)
    #expect((await manager.callCounts()).inspect == 1)
}
