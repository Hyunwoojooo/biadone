#if BLABEE_TEST_APP
import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class BlabeeTestCompositionFixture {
    let parent: URL
    let store: BlabeeTestRunStore
    let run: BlabeeTestRunManifest
    let composition: BlabeeTestComposition

    init(_ scenario: BlabeeTestScenario, initialTheme: PetFirstRunTheme? = nil,
         applyTheme: @escaping @MainActor (PetFirstRunTheme) -> Void = { _ in },
         now: @escaping @MainActor () -> Date = Date.init) throws {
        parent = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-test-composition-" + UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        store = try BlabeeTestRunStore(rootURL: parent.appendingPathComponent("test-store", isDirectory: true))
        let created = try store.create(scenario: scenario)
        run = try store.recordDefaultsSuiteUse(for: created)
        if let initialTheme {
            UserDefaults(suiteName: run.defaultsSuiteName)?.set(initialTheme.rawValue,
                forKey: PetFirstRunPreferences.themeKey)
        }
        composition = try BlabeeTestComposition(store: store, run: run, applyTheme: applyTheme, now: now)
    }

    func cleanup() async {
        await composition.stop()
        UserDefaults(suiteName: run.defaultsSuiteName)?.removePersistentDomain(forName: run.defaultsSuiteName)
        try? FileManager.default.removeItem(at: parent)
    }

    func selectCodexOnly() {
        composition.viewModel.setConnectionProviderSelected(.codex, selected: true)
        composition.viewModel.setConnectionProviderSelected(.claude, selected: false)
    }
}

@MainActor
private func blabeeSimulationEventually(_ condition: @MainActor () async -> Bool) async -> Bool {
    for _ in 0..<500 {
        if await condition() { return true }
        await Task.yield()
    }
    return await condition()
}

@Suite("Blabee Test composition (M1 simulation only)", .serialized)
@MainActor
struct BlabeeTestCompositionTests {
    @Test("A fresh run initializes only its fixture scope on Connect, after passive reloads preserve missing settings")
    func freshDefaultScopeIsRunOwnedAndExplicit() async throws {
        let fixture = try BlabeeTestCompositionFixture(.freshInstall)
        let composition = fixture.composition
        await composition.activate()
        await composition.viewModel.refreshConnectionSetup()
        #expect(composition.viewModel.configuredProjectPathsAreAuthoritative)
        #expect(!composition.viewModel.configuredProjectScopeExists)
        #expect(composition.viewModel.configuredProjectPaths.isEmpty)
        #expect((await composition.simulationMetrics()).simulatedServiceStarts == 0)

        // Persist another preference before connection, then reload this run.
        // The missing scope must survive rather than becoming a saved empty one.
        try composition.replayOnboarding()
        await composition.stop()
        let restored = try BlabeeTestComposition(store: fixture.store, run: fixture.run, applyTheme: { _ in })
        await restored.activate()
        await restored.viewModel.refreshConnectionSetup()
        #expect(!restored.viewModel.configuredProjectScopeExists)
        #expect(restored.viewModel.configuredProjectPaths.isEmpty)
        #expect((await restored.simulationMetrics()).simulatedServiceStarts == 0)

        restored.viewModel.setConnectionProviderSelected(.codex, selected: true)
        restored.viewModel.setConnectionProviderSelected(.claude, selected: false)
        await restored.viewModel.connectSelectedProviders()
        #expect(restored.viewModel.configuredProjectScopeExists)
        #expect(restored.viewModel.configuredProjectPaths == [fixture.run.settingsURL.standardizedFileURL.path])
        #expect(restored.viewModel.isConnectionSetupReady)
        let before = await restored.simulationMetrics()
        await restored.viewModel.connectSelectedProviders()
        let after = await restored.simulationMetrics()
        #expect(restored.viewModel.configuredProjectPaths == [fixture.run.settingsURL.standardizedFileURL.path])
        #expect(after.pluginConnections == before.pluginConnections)
        #expect(after.deniedExternalOperations == 0)
        await restored.stop()
        await fixture.cleanup()
    }

    @Test("Removing the last fixture scope remains an intentional empty setting across reload and Connect")
    func savedEmptyScopeIsNotRepopulated() async throws {
        let fixture = try BlabeeTestCompositionFixture(.connected)
        let composition = fixture.composition
        await composition.activate()
        fixture.selectCodexOnly()
        #expect(composition.viewModel.configuredProjectScopeExists)
        await composition.viewModel.disableConfiguredProject(fixture.run.settingsURL.standardizedFileURL.path)
        #expect(composition.viewModel.configuredProjectScopeExists)
        #expect(composition.viewModel.configuredProjectPaths.isEmpty)
        await composition.stop()

        let restored = try BlabeeTestComposition(store: fixture.store, run: fixture.run, applyTheme: { _ in })
        await restored.activate()
        restored.viewModel.setConnectionProviderSelected(.codex, selected: true)
        restored.viewModel.setConnectionProviderSelected(.claude, selected: false)
        await restored.viewModel.refreshConnectionSetup()
        await restored.viewModel.connectSelectedProviders()
        #expect(restored.viewModel.configuredProjectScopeExists)
        #expect(restored.viewModel.configuredProjectPaths.isEmpty)
        #expect(restored.viewModel.connectionSetup.state(for: .codex).status == .needsAction)
        #expect(!restored.viewModel.isConnectionSetupReady)
        #expect((await restored.simulationMetrics()).pluginConnections == 0)
        #expect((await restored.simulationMetrics()).deniedExternalOperations == 0)
        await restored.stop()
        await fixture.cleanup()
    }

    @Test("Legacy snapshots keep their recorded fixture scope, including an empty scope", arguments: [false, true])
    func legacyScopeIsAlwaysTreatedAsSaved(empty: Bool) async throws {
        let fixture = try BlabeeTestCompositionFixture(.connected)
        let composition = fixture.composition
        await composition.activate()
        fixture.selectCodexOnly()
        if empty {
            await composition.viewModel.disableConfiguredProject(fixture.run.settingsURL.standardizedFileURL.path)
        } else {
            try composition.replayOnboarding()
        }
        await composition.stop()
        let snapshot = try #require(try fixture.store.loadSnapshot(for: fixture.run))
        var legacy = try #require(JSONSerialization.jsonObject(with: snapshot) as? [String: Any])
        #expect(legacy.removeValue(forKey: "projectScopeIsSaved") as? Bool == true)
        try fixture.store.saveSnapshot(JSONSerialization.data(withJSONObject: legacy), for: fixture.run)

        let restored = try BlabeeTestComposition(store: fixture.store, run: fixture.run, applyTheme: { _ in })
        await restored.activate()
        restored.viewModel.setConnectionProviderSelected(.codex, selected: true)
        restored.viewModel.setConnectionProviderSelected(.claude, selected: false)
        await restored.viewModel.refreshConnectionSetup()
        await restored.viewModel.connectSelectedProviders()
        #expect(restored.viewModel.configuredProjectScopeExists)
        #expect(restored.viewModel.configuredProjectPaths == (empty ? [] : [fixture.run.settingsURL.standardizedFileURL.path]))
        #expect((await restored.simulationMetrics()).pluginConnections == 0)
        #expect((await restored.simulationMetrics()).deniedExternalOperations == 0)
        await restored.stop()
        await fixture.cleanup()
    }

    @Test("First-run social sign-in and consent use local ports and never persist a token")
    func simulatedSignInAndConsent() async throws {
        let fixture = try BlabeeTestCompositionFixture(.freshInstall)
        let composition = fixture.composition
        await composition.activate()
        #expect(composition.firstRun.step == .tutorial)
        #expect(composition.viewModel.account?.phase == .signedOut)
        #expect(composition.viewModel.usageAnalytics == nil)
        #expect(composition.viewModel.errorDiagnostics == nil)
        #expect(composition.viewModel.feedback == nil)
        #expect(!composition.viewModel.automaticAppUpdate.canPrepare)
        composition.firstRun.skipTutorial()
        await composition.viewModel.account?.signIn(.google)
        #expect(composition.firstRun.accountID == fixture.run.runID.uuidString.lowercased())
        #expect(composition.firstRun.continueAfterSignIn())
        composition.firstRun.acceptsTerms = true
        #expect(composition.firstRun.acceptTerms())
        #expect(composition.firstRun.step == .setup)
        let data = try #require(try fixture.store.loadSnapshot(for: fixture.run))
        let text = String(decoding: data, as: UTF8.self)
        #expect(!text.contains("simulation-access-"))
        #expect(!text.contains("simulation-refresh-"))
        #expect((await composition.simulationMetrics()).simulatedBrowserRequests == 1)
        #expect((await composition.simulationMetrics()).simulatedServiceStarts == 0)
        #expect((await composition.simulationMetrics()).deniedExternalOperations == 0)
        await fixture.cleanup()
    }

    @Test("Cancelled or failed simulated login can be retried without opening a browser",
          arguments: [BlabeeTestScenario.loginCancelled, .loginFailed])
    func simulatedLoginFailure(_ scenario: BlabeeTestScenario) async throws {
        let fixture = try BlabeeTestCompositionFixture(scenario)
        let composition = fixture.composition
        await composition.activate()
        composition.firstRun.skipTutorial()
        await composition.viewModel.account?.signIn(.google)
        #expect(composition.viewModel.account?.phase == .signedOut)
        #expect(composition.firstRun.accountID == nil)
        #expect(composition.viewModel.account?.message.isEmpty == false)
        await composition.viewModel.account?.signIn(.github)
        #expect(composition.firstRun.accountID == fixture.run.runID.uuidString.lowercased())
        #expect((await composition.simulationMetrics()).simulatedBrowserRequests == 2)
        #expect((await composition.simulationMetrics()).deniedExternalOperations == 0)
        await fixture.cleanup()
    }

    @Test("One-click setup runs common service and Plugin state transitions, then recovers a simulated failure")
    func connectionFailureRetry() async throws {
        let fixture = try BlabeeTestCompositionFixture(.connectionFailed)
        let model = fixture.composition.viewModel
        await fixture.composition.activate()
        fixture.selectCodexOnly()
        await model.connectSelectedProviders()
        #expect(model.codexPluginSetupState == .error(code: "codex_native_path_unsafe"))
        #expect(!model.isConnectionSetupReady)
        #expect((await fixture.composition.simulationMetrics()).pluginConnections == 1)
        await model.recoverAndContinueCodexSetup()
        #expect(model.isConnectionSetupReady)
        #expect(model.codexHookReadiness == .trusted)
        let metrics = await fixture.composition.simulationMetrics()
        #expect(metrics.pluginConnections == 2)
        #expect(metrics.simulatedServiceStarts == 1)
        #expect(metrics.selections == 0 && metrics.skips == 0)
        #expect(metrics.deniedExternalOperations == 0)
        await fixture.cleanup()
    }

    @Test("A preparing Plugin does not accumulate duplicate setup requests; cancelling cannot complete setup")
    func duplicateAndCancelledSetup() async throws {
        let fixture = try BlabeeTestCompositionFixture(.pluginPreparing)
        let composition = fixture.composition
        let model = composition.viewModel
        await composition.activate()
        fixture.selectCodexOnly()
        let first = Task { await model.connectSelectedProviders() }
        #expect(await blabeeSimulationEventually { (await composition.simulationMetrics()).pluginConnections == 1 })
        #expect(model.connectionSetup.isWorking)
        await model.connectSelectedProviders()
        #expect((await composition.simulationMetrics()).pluginConnections == 1)
        model.cancelConnectionSetup()
        await composition.releaseDelayedResponse()
        await first.value
        #expect(!model.isConnectionSetupReady)
        #expect(model.connectionSetup.phase == .cancelled)
        #expect(model.codexPluginSetupState != .installedNeedsHookReview(version: "simulation"))
        await fixture.cleanup()
    }

    @Test("Invalidation fences a delayed response and releases local work without activating a replacement")
    func delayedResponseAfterInvalidation() async throws {
        let fixture = try BlabeeTestCompositionFixture(.delayedResponse)
        let composition = fixture.composition
        // Activation itself requests the intentionally delayed first snapshot.
        // Keep it in flight so invalidation can release that exact response.
        let activation = Task { await composition.activate() }
        #expect(await blabeeSimulationEventually { (await composition.simulationMetrics()).snapshotRequests > 0 })
        composition.invalidate()
        await composition.stop()
        await activation.value
        #expect(!composition.isActive)
        #expect(!composition.viewModel.isConnectionSetupReady)
        #expect((await composition.simulationMetrics()).pluginConnections == 0)
        #expect((await composition.simulationMetrics()).selections == 0)
        #expect(throws: CancellationError.self) { try composition.replayOnboarding() }
        await fixture.cleanup()
    }

    @Test("Replaying onboarding preserves the simulated account and setup without repeating login or installation")
    func replayPreservesSetup() async throws {
        let fixture = try BlabeeTestCompositionFixture(.connected)
        let composition = fixture.composition
        await composition.activate()
        fixture.selectCodexOnly()
        await composition.viewModel.refreshConnectionSetup()
        #expect(composition.viewModel.isConnectionSetupReady)
        let first = composition.firstRun
        let before = await composition.simulationMetrics()
        try composition.replayOnboarding()
        #expect(composition.firstRun !== first)
        #expect(composition.firstRun.step == .tutorial)
        #expect(composition.firstRun.accountID == fixture.run.runID.uuidString.lowercased())
        first.skipTutorial()
        #expect(!first.errorMessage.isEmpty)
        #expect(composition.firstRun.step == .tutorial)
        await composition.viewModel.refreshFirstRunSetup()
        // The configuration survives, while common read-only refresh revokes
        // transient Hook evidence until the explicit recheck finishes.
        #expect(composition.viewModel.codexPluginSetupState == .installedNeedsHookReview(version: "simulation"))
        #expect(!composition.viewModel.isConnectionSetupReady)
        await composition.viewModel.checkCodexHooks()
        #expect(composition.viewModel.isConnectionSetupReady)
        let after = await composition.simulationMetrics()
        #expect(after.pluginConnections == before.pluginConnections)
        #expect(after.simulatedBrowserRequests == before.simulatedBrowserRequests)
        #expect(after.simulatedServiceStarts == before.simulatedServiceStarts)
        await fixture.cleanup()
    }

    @Test("The real Pet card buttons record only a local simulated choice or skip", arguments: [false, true])
    func simulateCardButtons(skip: Bool) async throws {
        let fixture = try BlabeeTestCompositionFixture(.connected)
        let composition = fixture.composition
        let model = composition.viewModel
        await composition.activate()
        #expect(await blabeeSimulationEventually { model.productAccessAllowsActions })
        model.endFirstRunSetup()
        model.setPanelVisible(true)
        await model.refresh()
        let card = try #require(model.displayInteraction)
        #expect(card.summary.contains("TEST"))
        #expect(model.focusedInteraction?.identity == card.identity)
        if skip {
            #expect(model.canSkipDecision(card.identity))
            await model.skipDecision(for: card.identity)
        } else {
            await model.requestPanelSelection(1)
            await model.requestPanelSelection(1)
        }
        let metrics = await composition.simulationMetrics()
        #expect(metrics.selections == (skip ? 0 : 1))
        #expect(metrics.skips == (skip ? 1 : 0))
        #expect(metrics.deniedExternalOperations == 0)
        #expect(model.displayInteraction == nil)
        await fixture.cleanup()
    }

    @Test("Unavailable native Codex is simulated without adopting the real installation")
    func codexMissing() async throws {
        let fixture = try BlabeeTestCompositionFixture(.codexMissing)
        await fixture.composition.activate()
        fixture.selectCodexOnly()
        await fixture.composition.viewModel.connectSelectedProviders()
        #expect(fixture.composition.viewModel.codexPluginSetupState == .error(code: "codex_native_not_installed"))
        #expect(fixture.composition.viewModel.connectionSetup.state(for: .codex).status == .needsInstall)
        let metrics = await fixture.composition.simulationMetrics()
        #expect(metrics.simulatedServiceStarts == 0)
        #expect(metrics.pluginConnections == 0)
        #expect(metrics.deniedExternalOperations == 0)
        await fixture.cleanup()
    }

    @Test("Installed Plugin and simulated Hook review remain separate until an explicit recheck")
    func hookReview() async throws {
        let fixture = try BlabeeTestCompositionFixture(.hookPending)
        let model = fixture.composition.viewModel
        await fixture.composition.activate()
        fixture.selectCodexOnly()
        await model.refreshConnectionSetup()
        #expect(model.codexPluginSetupState == .installedNeedsHookReview(version: "simulation"))
        #expect(model.codexHookReadiness == .reviewRequired)
        #expect(!model.isConnectionSetupReady)
        await model.checkCodexHooks()
        #expect(model.codexHookReadiness == .trusted)
        #expect(model.isConnectionSetupReady)
        #expect((await fixture.composition.simulationMetrics()).pluginConnections == 0)
        await fixture.cleanup()
    }

    @Test("Activation applies run appearance while an invalidated preference cannot change it",
          arguments: [PetFirstRunTheme.system, .dark])
    func runAppearance(_ theme: PetFirstRunTheme) async throws {
        var applied: [PetFirstRunTheme] = []
        let fixture = try BlabeeTestCompositionFixture(.freshInstall,
            initialTheme: theme == .system ? nil : theme,
            applyTheme: { applied.append($0) })
        #expect(fixture.composition.preferences.theme == theme)
        #expect(applied.isEmpty)
        await fixture.composition.activate()
        #expect(applied == [theme])
        let oldPreferences = fixture.composition.preferences
        fixture.composition.invalidate()
        oldPreferences.setTheme(.light)
        #expect(applied == [theme])
        await fixture.cleanup()
    }

    @Test("Signing in after a service is already running completes the common access ACK loop")
    func subsequentLoginRestoresSimulatedAccess() async throws {
        let fixture = try BlabeeTestCompositionFixture(.connected)
        let model = fixture.composition.viewModel
        await fixture.composition.activate()
        #expect(await blabeeSimulationEventually { model.productAccessAllowsActions })
        await model.account?.signOut()
        #expect(!model.productAccessAllowsActions)
        await model.account?.signIn(.google)
        #expect(await blabeeSimulationEventually { model.productAccessAllowsActions })
        #expect((await fixture.composition.simulationMetrics()).simulatedBrowserRequests == 1)
        #expect((await fixture.composition.simulationMetrics()).deniedExternalOperations == 0)
        await fixture.cleanup()
    }

    @Test("A run-relative card keeps one deadline and expires without renewing on the next snapshot")
    func simulatedCardExpiry() async throws {
        var clock = Date()
        let fixture = try BlabeeTestCompositionFixture(.connected, now: { clock })
        let model = fixture.composition.viewModel
        clock = fixture.run.createdAt
        await fixture.composition.activate()
        #expect(await blabeeSimulationEventually { model.productAccessAllowsActions })
        model.endFirstRunSetup()
        model.setPanelVisible(true)
        await model.refresh()
        let first = try #require(model.displayInteraction)
        #expect(first.millisecondsUntilExpiry == 600_000)
        #expect(first.isSelectionReady)
        clock = fixture.run.createdAt.addingTimeInterval(30)
        await model.refresh()
        let later = try #require(model.displayInteraction)
        #expect(later.sealedAt == first.sealedAt && later.expiresAt == first.expiresAt)
        #expect(later.millisecondsUntilExpiry == 570_000)
        clock = fixture.run.createdAt.addingTimeInterval(601)
        await model.refresh()
        let expired = try #require(model.displayInteraction)
        #expect(expired.expiresAt == first.expiresAt && expired.isExpired)
        #expect(model.focusedInteraction == nil)
        await model.requestPanelSelection(1)
        #expect((await fixture.composition.simulationMetrics()).selections == 0)
        await fixture.cleanup()
    }

}
#endif
