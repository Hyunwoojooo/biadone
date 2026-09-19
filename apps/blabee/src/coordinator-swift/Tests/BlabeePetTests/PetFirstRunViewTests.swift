import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("First-run onboarding views")
@MainActor
struct PetFirstRunViewTests {
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
        let model = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener())
        let store = FirstRunRenderStore()
        store.failLoad = true
        let controller = PetFirstRunController(store: store, legalDocuments: .placeholder)
        let view = PetFirstRunView(controller: controller, viewModel: model, preferences: preferences,
                                  onFinish: { _ in }, onClose: {})
        #expect(controller.canRetryLoading)
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
        #expect(!view.canContinue)
        #expect(!view.canDeferConnection)
        controller.synchronizeAccount(id: userID, email: "tester@example.test")
        #expect(view.canDeferConnection)
        #expect(!controller.isComplete)
    }

    @Test("Four stages render at standard and narrow sizes without finishing or selecting real work")
    func renderStages() async throws {
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
        let viewModel = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(), account: account)
        defer { viewModel.stopPolling(); account.stop() }
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: .defaults) { _ in }
        viewModel.attachHotKeyRegistry(registry)
        let store = FirstRunRenderStore()
        let controller = PetFirstRunController(store: store, legalDocuments: .placeholder)
        let userID = "11111111-1111-4111-8111-111111111111"

        for stage in PetFirstRunStep.allCases {
            switch stage {
            case .tutorial: break
            case .signIn: controller.skipTutorial()
            case .terms:
                controller.synchronizeAccount(id: userID, email: "tester@example.test")
                #expect(controller.continueAfterSignIn())
            case .setup:
                controller.acceptsTerms = true
                #expect(controller.acceptTerms())
            }
            #expect(controller.step == stage)
            for size in [NSSize(width: 590, height: 720), NSSize(width: 460, height: 550)] {
                for dark in [false, true] {
                    let view = PetFirstRunView(controller: controller, viewModel: viewModel, preferences: preferences,
                        onFinish: { _ in Issue.record("Rendering must not finish onboarding") },
                        onClose: { Issue.record("Rendering must not close onboarding") })
                        .frame(width: size.width, height: size.height)
                        .environment(\.colorScheme, dark ? .dark : .light)
                        .environment(\.petAirForceOpaqueSurfaces, true)
                    let host = NSHostingView(rootView: view)
                    host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                    host.frame = NSRect(origin: .zero, size: size)
                    host.layoutSubtreeIfNeeded()
                    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.effectiveAppearance.performAsCurrentDrawingAppearance {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                    }
                    #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                    #expect(abs(host.bounds.width - size.width) < 0.1)
                    if let directory = ProcessInfo.processInfo.environment["BLABEE_FIRST_RUN_RENDER_DIRECTORY"] {
                        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                        let data = try #require(bitmap.representation(using: .png, properties: [:]))
                        try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent(
                            "first-run-\(stage.rawValue)-\(Int(size.width))-\(dark ? "dark" : "light").png"))
                    }
                }
            }
            #expect(!controller.isComplete)
        }
        #expect(await transport.requestCount(type: "select") == 0)
        for payload in await transport.requestPayloads(type: "get_state") {
            let object = try #require(JSONSerialization.jsonObject(with: payload) as? [String: Any])
            #expect(object["consumer_heartbeat"] as? Bool != true)
        }
        #expect(await transport.requestCount(type: "focus_interaction") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(loginItem.mutations == 0)
    }
}

@MainActor private final class FirstRunRenderStore: PetFirstRunStoring {
    var state: PetFirstRunState?
    var failLoad = false
    func load() throws -> PetFirstRunState? {
        if failLoad { throw PetFirstRunStorageError.invalidFile }
        return state
    }
    func save(_ state: PetFirstRunState) throws { self.state = state }
}

@MainActor private final class FirstRunRenderLoginItem: PetLoginItemManaging {
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
