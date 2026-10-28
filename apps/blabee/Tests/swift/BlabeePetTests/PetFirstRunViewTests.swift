import AppKit
import CoordinatorSwift
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("First-run onboarding views", .petLanguage(.korean))
@MainActor
struct PetFirstRunViewTests {
    init() throws { try PetTypographyTestResources.register() }

    @Test("Deferred onboarding presents optional preferences and account-gated continue actions")
    func deferredPreferencesPresentation() throws {
        let suite = "blabee-first-run-deferred-view-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunRenderLoginItem(), applyTheme: { _ in })
        let model = firstRunRenderModel()
        let store = FirstRunRenderStore()
        let controller = PetFirstRunController(store: store, legalDocuments: .deferred)
        let view = PetFirstRunView(controller: controller, viewModel: model, preferences: preferences,
                                  onFinish: { _ in }, onClose: {})
        controller.skipTutorial()
        #expect(view.thirdStepTitle == "데이터 공유")
        #expect(!view.showsLegalAgreement)
        #expect(view.continueTitle == "계속")
        #expect(view.navigationHint == "위에서 로그인을 마치면 다음 단계로 갈 수 있어요.")
        #expect(!view.canContinue)
        controller.synchronizeAccount(id: "verified-account", email: nil)
        #expect(view.navigationHint == "로그인됐어요. 아래 버튼으로 계속하세요.")
        #expect(view.canContinue)
        #expect(controller.continueAfterSignIn())
        #expect(controller.step == .terms)
        #expect(view.continueTitle == "설정 저장하고 계속")
        #expect(view.navigationHint == "선택 항목은 꺼 두어도 괜찮아요. 아래 버튼으로 설정을 저장하세요.")
        #expect(!controller.acceptsTerms)
        #expect(view.canContinue)
        #expect(!view.canDeferConnection)
        controller.synchronizeAccount(id: nil, email: nil, isVerifying: true)
        #expect(controller.step == .terms)
        #expect(view.navigationHint == nil)
        #expect(!view.canContinue)
        controller.synchronizeAccount(id: "verified-account", email: nil)
        #expect(controller.saveDataSharingPreferences())
        #expect(view.canDeferConnection)
        #expect(store.state?.consentReceipt == nil)
    }

    @Test("Published and invalid document configurations retain mandatory agreement gating")
    func legalAgreementPresentation() throws {
        let suite = "blabee-first-run-legal-view-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunRenderLoginItem(), applyTheme: { _ in })
        let model = firstRunRenderModel()
        let published = PetFirstRunLegalDocuments.configured(info: [
            "BlabeeTermsURL": "https://example.test/terms",
            "BlabeePrivacyURL": "https://example.test/privacy",
            "BlabeeLegalDocumentVersion": "v1",
        ])
        for documents in [published, .placeholder, nil] {
            let controller = PetFirstRunController(store: FirstRunRenderStore(), legalDocuments: documents)
            let view = PetFirstRunView(controller: controller, viewModel: model, preferences: preferences,
                                      onFinish: { _ in }, onClose: {})
            controller.skipTutorial()
            #expect(view.thirdStepTitle == "약관")
            #expect(view.showsLegalAgreement)
            #expect(view.continueTitle == "약관 확인하기")
            controller.synchronizeAccount(id: "verified-account", email: nil)
            #expect(controller.continueAfterSignIn())
            #expect(view.continueTitle == "동의하고 계속")
            #expect(!view.canContinue)
            controller.acceptsTerms = true
            #expect(view.canContinue == (documents != nil))
            #expect(!view.canDeferConnection)
        }
    }

    @Test("Tutorial example requires a valid choice and cannot deliver twice")
    func isolatedTutorialState() {
        var example = PetFirstRunTutorialExampleState()
        example.deliver()
        #expect(!example.delivered)
        example.select(-1)
        example.select(2)
        #expect(example.selected == nil)
        example.select(1)
        example.deliver()
        #expect(example.delivered)
        #expect(example.selected == 1)
        example.select(0)
        example.deliver()
        #expect(example.selected == 1)
    }

    @Test("Primary action shows a local delivery result before advancing and skip never fabricates a delivery")
    func tutorialPrimaryActionTransition() {
        var example = PetFirstRunTutorialExampleState()
        #expect(PetFirstRunTutorialAction.current(scene: 0, example: example) == .preview)
        let advancesPreview = example.activatePrimaryAction(scene: 0)
        #expect(advancesPreview)
        #expect(!example.delivered)
        #expect(PetFirstRunTutorialAction.current(scene: 1, example: example) == .choose)
        let skipsPractice = example.activatePrimaryAction(scene: 1)
        #expect(skipsPractice)
        #expect(example.selected == nil)
        #expect(!example.delivered)
        #expect(PetFirstRunTutorialAction.current(scene: 2, example: example) == .resultPreview)
        let advancesResultPreview = example.activatePrimaryAction(scene: 2)
        #expect(advancesResultPreview)
        #expect(!example.delivered)

        example.select(0)
        example.select(1)
        #expect(example.selected == 1)
        #expect(PetFirstRunTutorialAction.current(scene: 1, example: example) == .send)
        let advancesOnSend = example.activatePrimaryAction(scene: 1)
        #expect(!advancesOnSend)
        #expect(example.delivered)
        #expect(PetFirstRunTutorialAction.current(scene: 1, example: example) == .next)
        let delivered = example
        let advancesAfterSend = example.activatePrimaryAction(scene: 1)
        #expect(advancesAfterSend)
        #expect(example == delivered)
        example.select(0)
        #expect(example == delivered)
    }

    @Test("Korean tutorial buttons distinguish preview, skip, send and a result preview")
    func tutorialActionPresentation() throws {
        try verifyTutorialActionPresentation(english: false)
    }

    @Test("English tutorial buttons and guidance retain the same explicit action sequence", .petLanguage(.english))
    func englishTutorialActionPresentation() throws {
        try verifyTutorialActionPresentation(english: true)
        #expect(PetFirstRunTutorialAction.choose.title == "1. Click either card below")
        #expect(PetFirstRunTutorialAction.send.detail.contains("No real task will run"))
        #expect(PetFirstRunTutorialAction.resultPreview.detail.contains("previews the result"))
    }

    private func verifyTutorialActionPresentation(english: Bool) throws {
        let suite = "blabee-first-run-tutorial-actions-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunRenderLoginItem(), applyTheme: { _ in })
        let model = firstRunRenderModel()
        defer { model.endFirstRunSetup(); model.stopPolling() }
        let controller = PetFirstRunController(store: FirstRunRenderStore(), legalDocuments: .placeholder)
        func view(_ example: PetFirstRunTutorialExampleState = .init()) -> PetFirstRunView {
            PetFirstRunView(controller: controller, viewModel: model, preferences: preferences, tutorialExample: example,
                            onFinish: { _ in Issue.record("Tutorial presentation must not complete setup") }, onClose: {})
        }
        #expect(view().tutorialAction == .preview)
        #expect(view().continueTitle == (english ? "Try Choosing a Card" : "카드 선택해 보기"))
        #expect(view().canContinue)
        controller.advanceTutorial()
        #expect(view().tutorialAction == .choose)
        #expect(view().continueTitle == (english ? "Skip Practice and Continue" : "체험 건너뛰고 다음"))
        #expect(view().canContinue)
        #expect(view().navigationHint == nil)
        var selected = PetFirstRunTutorialExampleState()
        selected.select(0)
        #expect(view(selected).tutorialAction == .send)
        #expect(view(selected).continueTitle == (english ? "Send Example Choice" : "예시 선택 전달하기"))
        let advancesOnSend = selected.activatePrimaryAction(scene: 1)
        #expect(!advancesOnSend)
        #expect(controller.tutorialIndex == 1)
        #expect(view(selected).tutorialAction == .next)
        #expect(view(selected).continueTitle == (english ? "Next" : "다음"))
        controller.advanceTutorial()
        #expect(view().tutorialAction == .resultPreview)
        #expect(view().continueTitle == (english ? "Continue to Sign In" : "로그인으로 계속"))
        #expect(!controller.isComplete)
        controller.advanceTutorial()
        #expect(controller.step == .signIn)
        #expect(!view().canContinue)
        #expect(view().navigationHint == (english ? "Complete sign-in above to unlock the next step."
                                          : "위에서 로그인을 마치면 다음 단계로 갈 수 있어요."))
    }

    @Test("First-run window fits the visible screen, including a small display")
    func screenBounds() {
        #expect(PetFirstRunWindowController.contentSize(available: NSSize(width: 1440, height: 900))
            == NSSize(width: 590, height: 720))
        #expect(PetFirstRunWindowController.contentSize(available: NSSize(width: 500, height: 600))
            == NSSize(width: 468, height: 568))
    }

    @Test("Navigation waits for storage recovery and setup completion waits for account verification")
    func recoveryAndVerificationGates() throws {
        let suite = "blabee-first-run-gates-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunRenderLoginItem(), applyTheme: { _ in })
        let model = firstRunRenderModel()
        let store = FirstRunRenderStore()
        store.failLoad = true
        let controller = PetFirstRunController(store: store, legalDocuments: .placeholder)
        let view = PetFirstRunView(controller: controller, viewModel: model, preferences: preferences,
                                  onFinish: { _ in }, onClose: {})
        #expect(controller.canRetryLoading)
        #expect(view.navigationHint == nil)
        #expect(!view.canContinue)
        #expect(!view.canDeferConnection)
        store.failLoad = false
        controller.retryLoading()
        #expect(!controller.canRetryLoading)
        #expect(view.canContinue)
        controller.skipTutorial()
        let userID = "11111111-1111-4111-8111-111111111111"
        controller.synchronizeAccount(id: userID, email: "tester@example.test")
        #expect(controller.continueAfterSignIn())
        controller.acceptsTerms = true
        #expect(controller.acceptTerms())
        #expect(view.canDeferConnection)
        controller.synchronizeAccount(id: nil, email: nil, isVerifying: true)
        #expect(controller.step == .setup)
        #expect(view.navigationHint == nil)
        #expect(!view.canContinue)
        #expect(!view.canDeferConnection)
        controller.synchronizeAccount(id: userID, email: "tester@example.test")
        #expect(view.canDeferConnection)
        #expect(!controller.isComplete)
    }

    @Test("Claude-only setup can finish and an explicitly selected incomplete provider still blocks completion")
    func providerAwareSetupCompletion() async throws {
        let suite = "blabee-first-run-provider-gates-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunRenderLoginItem(), applyTheme: { _ in })
        let transport = PetFakeTransport()
        let model = firstRunRenderModel(transport: transport)
        defer { model.endFirstRunSetup(); model.stopPolling() }
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await model.refreshFirstRunSetup(inspectSettings: false)
        let inspection = PetConnectionSetupInspection(serviceReady: true, providers: [
            .codex: .init(status: .needsInstall, detail: "설치 필요"),
            .claude: .init(status: .configured, detail: "설정 완료", sessionEvidence: .waitingForSession)
        ])
        let connection = PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]),
            inspect: { inspection },
            prepare: { Issue.record("Completion must not prepare a service") },
            configure: { _ in Issue.record("Completion must not change provider settings") }
        )
        model.connectionSetup = connection
        await connection.refresh()
        let controller = readyFirstRunController()
        let view = PetFirstRunView(controller: controller, viewModel: model, preferences: preferences,
                                  onFinish: { _ in }, onClose: {})
        #expect(view.canContinue)
        #expect(connection.state(for: .claude).sessionEvidence != .ready)
        model.setConnectionProviderSelected(.codex, selected: true)
        #expect(!view.canContinue)
        #expect(view.canDeferConnection)
        model.setConnectionProviderSelected(.codex, selected: false)
        #expect(view.canContinue)
        #expect(!controller.isComplete)
    }

    @Test("Setup refresh blocks completion and defer until the current operation returns")
    func setupOperationBlocksNavigation() async throws {
        let suite = "blabee-first-run-busy-gates-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: FirstRunRenderLoginItem(), applyTheme: { _ in })
        let transport = PetFakeTransport()
        let model = firstRunRenderModel(transport: transport)
        defer { model.endFirstRunSetup(); model.stopPolling() }
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await model.refreshFirstRunSetup(inspectSettings: false)
        let inspection = PetConnectionSetupInspection(serviceReady: true, providers: [
            .claude: .init(status: .configured, detail: "설정 완료", sessionEvidence: .waitingForSession)
        ])
        var pending: CheckedContinuation<PetConnectionSetupInspection, any Error>?
        let connection = PetConnectionSetupController(
            store: PetConnectionSetupMemorySelectionStore(selectedProviders: [.claude]),
            inspect: { try await withCheckedThrowingContinuation { pending = $0 } },
            prepare: { Issue.record("Read-only refresh must not prepare a service") },
            configure: { _ in Issue.record("Read-only refresh must not configure a provider") }
        )
        model.connectionSetup = connection
        connection.receiveObservation(inspection)
        let view = PetFirstRunView(controller: readyFirstRunController(), viewModel: model, preferences: preferences,
                                  onFinish: { _ in }, onClose: {})
        #expect(view.canContinue)
        let operation = Task { await connection.refresh() }
        for _ in 0..<100 where pending == nil { await Task.yield() }
        let waiter = try #require(pending)
        #expect(connection.isWorking)
        #expect(view.navigationHint == nil)
        #expect(!view.canContinue)
        #expect(!view.canDeferConnection)
        connection.cancel()
        #expect(!view.canDeferConnection)
        waiter.resume(returning: inspection)
        pending = nil
        await operation.value
        #expect(!connection.isWorking)
        #expect(!view.canContinue)
        #expect(view.canDeferConnection)
    }

    private func readyFirstRunController() -> PetFirstRunController {
        let controller = PetFirstRunController(store: FirstRunRenderStore(), legalDocuments: .placeholder)
        controller.skipTutorial()
        controller.synchronizeAccount(id: "11111111-1111-4111-8111-111111111111", email: "tester@example.test")
        _ = controller.continueAfterSignIn()
        controller.acceptsTerms = true
        _ = controller.acceptTerms()
        return controller
    }

    @Test("Korean tutorial guidance and account gate render at standard and narrow sizes")
    func renderStages() async throws {
        try await render([
            .init(name: "preview", scene: 0, size: .standard, dark: false),
            .init(name: "choose", scene: 1, size: .narrow, dark: false),
            .init(name: "send", scene: 1, selected: 0, size: .standard, dark: true),
            .init(name: "delivered", scene: 1, selected: 1, delivered: true, size: .narrow, dark: true),
            .init(name: "finish-tutorial", scene: 2, size: .standard, dark: false),
            .init(name: "sign-in", stage: .signIn, size: .narrow, dark: false),
        ])
    }

    @Test("English tutorial guidance, consent and setup render without real connection side effects", .petLanguage(.english))
    func renderEnglishStages() async throws {
        try await render([
            .init(name: "choose", scene: 1, size: .standard, dark: true),
            .init(name: "send", scene: 1, selected: 1, size: .narrow, dark: false),
            .init(name: "delivered", scene: 1, selected: 0, delivered: true, size: .standard, dark: false),
            .init(name: "finish-tutorial", scene: 2, size: .narrow, dark: true),
            .init(name: "terms", stage: .terms, size: .narrow, dark: false),
            .init(name: "setup", stage: .setup, size: .standard, dark: true),
        ])
    }

    private func render(_ cases: [FirstRunRenderCase]) async throws {
        let restoreLanguage = petRenderLanguageOverride(PetL10n.language)
        defer { restoreLanguage() }
        let suite = "blabee-first-run-view-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let loginItem = FirstRunRenderLoginItem()
        let preferences = PetFirstRunPreferences(defaults: defaults, loginItem: loginItem, applyTheme: { _ in
            Issue.record("Rendering must not change app appearance")
        })
        let transport = PetFakeTransport()
        let account = PetAccountController(service: FirstRunRenderAccountService(), store: FirstRunRenderAccountStore(),
                                           browser: FirstRunRenderAccountBrowser(), automaticRefresh: false)
        let viewModel = firstRunRenderModel(transport: transport, account: account)
        defer { viewModel.endFirstRunSetup(); viewModel.stopPolling(); account.stop() }
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: .defaults) { _ in
            Issue.record("Rendering must not dispatch a keyboard shortcut")
        }
        viewModel.attachHotKeyRegistry(registry)
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await viewModel.refreshFirstRunSetup(inspectSettings: false)
        let userID = "11111111-1111-4111-8111-111111111111"

        for fixture in cases {
            let controller = PetFirstRunController(store: FirstRunRenderStore(), legalDocuments: .placeholder)
            for _ in 0..<fixture.scene { controller.advanceTutorial() }
            if fixture.stage != .tutorial { controller.skipTutorial() }
            if fixture.stage == .terms || fixture.stage == .setup {
                controller.synchronizeAccount(id: userID, email: "tester@example.test")
                #expect(controller.continueAfterSignIn())
            }
            if fixture.stage == .setup {
                controller.acceptsTerms = true
                #expect(controller.acceptTerms())
            }
            #expect(controller.step == fixture.stage)
            var example = PetFirstRunTutorialExampleState()
            if let selected = fixture.selected { example.select(selected) }
            if fixture.delivered { example.deliver() }
            let size = fixture.size.value
            let view = PetFirstRunView(controller: controller, viewModel: viewModel, preferences: preferences,
                tutorialExample: example,
                onFinish: { _ in Issue.record("Rendering must not finish onboarding") },
                onClose: { Issue.record("Rendering must not close onboarding") })
                .frame(width: size.width, height: size.height)
                .foregroundStyle(fixture.dark ? Color.white : Color.black)
                .background(fixture.dark ? Color.black : Color.white)
                .environment(\.colorScheme, fixture.dark ? .dark : .light)
                .environment(\.petAirForceOpaqueSurfaces, true)
            let host = NSHostingView(rootView: view)
            host.appearance = NSAppearance(named: fixture.dark ? .darkAqua : .aqua)
            let window = NSWindow(contentRect: NSRect(x: -20_000, y: -20_000, width: size.width, height: size.height),
                                  styleMask: .borderless, backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = host
            // Never order this fixture window or activate the app.
            defer { window.contentView = nil; window.close() }
            host.frame = NSRect(origin: .zero, size: size)
            for _ in 0..<5 {
                host.layoutSubtreeIfNeeded()
                window.displayIfNeeded()
                try await Task.sleep(for: .milliseconds(20))
            }
            host.layoutSubtreeIfNeeded()
            let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.effectiveAppearance.performAsCurrentDrawingAppearance {
                host.cacheDisplay(in: host.bounds, to: bitmap)
            }
            #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
            #expect(abs(host.bounds.width - size.width) < 0.1)
            #expect(abs(host.bounds.height - size.height) < 0.1)
            #expect(host.fittingSize.width <= size.width + 1)
            var colors = Set<String>()
            var contentEdges = 0
            for y in stride(from: 8, to: bitmap.pixelsHigh - 8, by: 4) {
                for x in stride(from: 8, to: bitmap.pixelsWide - 8, by: 4) {
                    guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                          let nearby = bitmap.colorAt(x: x + 2, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                    colors.insert("\(Int(color.redComponent * 255)),\(Int(color.greenComponent * 255)),\(Int(color.blueComponent * 255))")
                    let intensity = (color.redComponent + color.greenComponent + color.blueComponent) / 3
                    let nearbyIntensity = (nearby.redComponent + nearby.greenComponent + nearby.blueComponent) / 3
                    if abs(intensity - nearbyIntensity) > 0.2 { contentEdges += 1 }
                }
            }
            #expect(colors.count > 12, "A blank bitmap must not count as a rendered screen")
            #expect(contentEdges > 20, "A background gradient alone must not count as visible content")
            if let directory = ProcessInfo.processInfo.environment["BLABEE_FIRST_RUN_RENDER_DIRECTORY"] {
                try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                let data = try #require(bitmap.representation(using: .png, properties: [:]))
                try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent(
                    "first-run-\(fixture.name)-\(PetL10n.language.rawValue)-\(Int(size.width))-\(fixture.dark ? "dark" : "light").png"))
            }
            #expect(!controller.isComplete)
        }
        #expect(await transport.requestCount(type: "select") == 0)
        for payload in await transport.requestPayloads(type: "get_state") {
            let object = try #require(JSONSerialization.jsonObject(with: payload) as? [String: Any])
            #expect(object["consumer_heartbeat"] as? Bool != true)
        }
        #expect(await transport.requestCount(type: "focus_interaction") == 0)
        #expect(await transport.requestCount(type: "focus_event") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 0)
        #expect(loginItem.mutations == 0)
    }

}

private struct FirstRunRenderCase {
    enum Size {
        case standard, narrow
        var value: NSSize {
            switch self {
            case .standard: NSSize(width: 590, height: 720)
            case .narrow: NSSize(width: 460, height: 550)
            }
        }
    }
    let name: String
    var stage: PetFirstRunStep = .tutorial
    var scene = 0
    var selected: Int? = nil
    var delivered = false
    let size: Size
    let dark: Bool
}

private struct FirstRunRenderSuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) { Issue.record("Onboarding presentation must not change saved suggestion settings") }
}

@MainActor
private func firstRunRenderModel(transport: PetFakeTransport = PetFakeTransport(),
                                 account: PetAccountController? = nil) -> PetViewModel {
    let inspection = ClaudeAutoConnectSetup.Inspection(isEnabled: false, canEnable: false, canDisable: false,
                                                        detail: "Test-only Claude fixture", canLaunch: false)
    let claude = PetClaudeConnectionController(inspect: { inspection }, enable: {
        Issue.record("Onboarding presentation must not enable a real Claude connection")
        return inspection
    }, disable: {
        Issue.record("Onboarding presentation must not disable a real Claude connection")
        return inspection
    })
    let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
                            claudeConnection: claude, suggestionModeStore: FirstRunRenderSuggestionStore(),
                            appUpdateURLOpener: { _ in
                                Issue.record("Onboarding presentation must not open a browser")
                                return false
                            }, account: account)
    model.beginFirstRunSetup()
    return model
}

@MainActor final class FirstRunRenderStore: PetFirstRunStoring {
    var state: PetFirstRunState?
    var failLoad = false
    func load() throws -> PetFirstRunState? {
        if failLoad { throw PetFirstRunStorageError.invalidFile }
        return state
    }
    func save(_ state: PetFirstRunState) throws { self.state = state }
}

@MainActor final class FirstRunRenderLoginItem: PetLoginItemManaging {
    let status: PetLaunchAtLoginStatus = .notRegistered
    var mutations = 0
    func register() throws { mutations += 1 }
    func unregister() throws { mutations += 1 }
    func openSettings() { Issue.record("Rendering must not open system settings") }
}

@MainActor private struct FirstRunRenderAccountService: PetAccountServicing {
    func exchange(code: String, verifier: String) async throws -> PetAccountSession { throw PetAccountAuthError.serviceUnavailable }
    func refresh(_ session: PetAccountSession) async throws -> PetAccountSession { throw PetAccountAuthError.serviceUnavailable }
    func user(accessToken: String) async throws -> PetAccountUser { throw PetAccountAuthError.serviceUnavailable }
    func signOut(accessToken: String) async throws { Issue.record("Rendering must not sign out") }
}

@MainActor private struct FirstRunRenderAccountStore: PetAccountSessionStoring {
    func load() throws -> PetAccountSession? { nil }
    func save(_ session: PetAccountSession) throws { Issue.record("Rendering must not persist OAuth credentials") }
    func clear() throws { Issue.record("Rendering must not clear OAuth credentials") }
}

@MainActor private final class FirstRunRenderAccountBrowser: PetAccountBrowsing {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        Issue.record("Rendering must not open OAuth")
        throw PetAccountAuthError.cancelled
    }
    func cancel() {}
}
