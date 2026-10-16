import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Unified connection setup views", .petLanguage(.korean))
@MainActor
struct PetConnectionSetupViewTests {
    init() throws { try PetTypographyTestResources.register() }

    @Test("Partial failure offers remaining setup while deferring that provider preserves completed setup")
    func partialFailureAction() async {
        let transport = PetFakeTransport()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
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
        model.setConnectionProviderSelected(.claude, selected: false)
        #expect(controller.canFinish)
        #expect(view.primaryActionTitle == "설정 다시 확인")
        #expect(controller.state(for: .codex).sessionEvidence == .waitingForSession)
        #expect(await transport.requestCount(type: "select") == 0)
    }

    @Test("Unconfigured and missing tools stay explicit without mutating settings during rendering")
    func renderProviderStates() async throws {
        let transport = PetFakeTransport()
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        defer { model.stopPolling() }
        let scenarios: [(String, Set<PetConnectionSetupProvider>, PetConnectionSetupInspection)] = [
            ("not-installed", [], .init(serviceReady: false, providers: [
                .codex: .init(status: .needsInstall, detail: "Codex를 찾지 못했어요."),
                .claude: .init(status: .needsInstall, detail: "Claude를 찾지 못했어요.")
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
                let width: CGFloat = name == "partial" ? 340 : 420
                let size = NSSize(width: width, height: 980)
                let view = ScrollView {
                    PetConnectionSetupView(viewModel: model).padding(8)
                }
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
                // Rendering starts SwiftUI's appearance task. Let its fixture
                // inspection settle before capturing the named status scenario.
                for _ in 0..<100 {
                    await Task.yield()
                    if !controller.isWorking && controller.hasCurrentInspection { break }
                }
                #expect(!controller.isWorking && controller.hasCurrentInspection)
                try await Task.sleep(for: .milliseconds(20))
                host.layoutSubtreeIfNeeded()
                host.effectiveAppearance.performAsCurrentDrawingAppearance {
                    host.cacheDisplay(in: host.bounds, to: bitmap)
                }
                #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                #expect(abs(host.bounds.width - size.width) < 0.1)
                if let directory = ProcessInfo.processInfo.environment["BLABEE_CONNECTION_SETUP_RENDER_DIRECTORY"] {
                    try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                    let data = try #require(bitmap.representation(using: .png, properties: [:]))
                    try data.write(to: URL(fileURLWithPath: directory).appendingPathComponent(
                        "connection-setup-\(name)-\(Int(width))-\(dark ? "dark" : "light").png"))
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
