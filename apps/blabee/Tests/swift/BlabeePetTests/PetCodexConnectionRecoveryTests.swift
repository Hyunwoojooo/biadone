import AppKit
import CoordinatorSwift
import SwiftUI
import Testing
@testable import BlabeeCoordinator

private struct RecoverySuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) {}
}

private actor RecoveryDisplayManager: CodexPluginSetupManaging {
    let code: String
    var connects = 0
    var checks = 0
    init(code: String) { self.code = code }
    func inspect() -> CodexPluginSetupState { .error(code: code) }
    func recheckNativeExecutableWithReport() -> CodexPluginCheckResult {
        checks += 1
        if code == "codex_native_version_unqualified" {
            return .init(state: .error(code: code), evidence: .init(stage: .nativeExecutable,
                sourcePath: "/opt/homebrew/bin/codex",
                canonicalPath: "/opt/homebrew/Caskroom/codex/99.0.0/codex-aarch64-apple-darwin",
                codexVersion: "99.0.0"))
        }
        return .init(state: .error(code: code), evidence: .init(stage: .nativeExecutable,
            sourcePath: "/opt/homebrew/bin/codex",
            pathDiagnostic: .init(issue: .groupWritable, role: .sourceAncestor,
                path: "/opt/homebrew/bin",
                resolvedTargetPath: "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js")))
    }
    func connect() -> CodexPluginSetupState { connects += 1; return .error(code: code) }
    func disconnect() -> CodexPluginSetupState { .error(code: code) }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) -> CodexPluginSetupState {
        .error(code: code)
    }
    func calls() -> (checks: Int, connects: Int) { (checks, connects) }
}

@Suite("Codex connection recovery", .petLanguage(.korean))
@MainActor
struct PetCodexConnectionRecoveryTests {
    @Test("Recovery distinguishes missing CLI, path rejection and version mismatch from app or Plugin errors")
    func actionableRecovery() throws {
        let path = try #require(PetCodexConnectionRecovery(state: .error(code: "codex_native_path_unsafe")))
        #expect(path.offersInstallGuide)
        #expect(!path.offersAppUpdate)
        #expect(path.detail.contains("악성 파일이라는 뜻은 아닙니다"))
        let version = try #require(PetCodexConnectionRecovery(state: .error(code: "codex_native_version_unqualified")))
        #expect(version.offersAppUpdate)
        #expect(!version.offersInstallGuide)
        #expect(version.detail.contains("Blabee 업데이트"))
        let missing = try #require(PetCodexConnectionRecovery(state: .error(code: "codex_native_not_installed")))
        #expect(missing.offersInstallGuide)
        #expect(PetCodexConnectionRecovery(state: .notInstalled) == nil)
        #expect(PetCodexConnectionRecovery(state: .installedNeedsHookReview(version: "0.1.3")) == nil)
        #expect(PetCodexConnectionRecovery(state: .conflict(reason: "fixture")) == nil)
        #expect(PetCodexConnectionRecovery(state: .error(code: "codex_plugin_setup_resources_invalid")) == nil)
        #expect(PetCodexConnectionRecovery(state: .error(code: "unknown")) == nil)
    }

    @Test("Recovery copy follows the selected language", .petLanguage(.english))
    func englishRecovery() throws {
        let path = try #require(PetCodexConnectionRecovery(state: .error(code: "codex_native_path_unsafe")))
        #expect(path.title == "Check your Codex installation")
        #expect(path.detail.contains("does not mean the file is malicious"))
    }

    @Test("Opening the installation guide only opens the official documentation")
    func guideDoesNotStartSetup() async {
        let manager = RecoveryDisplayManager(code: "codex_native_path_unsafe")
        var opened: [URL] = []
        let model = PetViewModel(transport: PetFakeTransport(),
            externalApplicationOpener: PetFakeApplicationOpener(), codexPluginSetupManager: manager,
            suggestionModeStore: RecoverySuggestionStore(), appUpdateURLOpener: { opened.append($0); return true })
        defer { model.stopPolling() }
        await model.refreshCodexPluginSetup()
        model.openConnectionInstallGuide(for: .codex)
        #expect(opened.map(\.absoluteString) == ["https://developers.openai.com/codex/cli/"])
        #expect((await manager.calls()).checks == 0)
        #expect((await manager.calls()).connects == 0)
        #expect(model.codexHookReadiness != .trusted)
    }

    @Test("Narrow recovery views render without executing Codex, opening a browser or sending selections",
          arguments: ["codex_native_path_unsafe", "codex_native_version_unqualified"])
    func renderRecovery(code: String) async throws {
        try await render(code: code)
    }

    @Test("English recovery and expanded diagnostics fit narrow screens", .petLanguage(.english),
          arguments: ["codex_native_path_unsafe", "codex_native_version_unqualified"])
    func renderEnglishRecovery(code: String) async throws {
        try await render(code: code)
    }

    private func render(code: String) async throws {
        try PetTypographyTestResources.register()
        let manager = RecoveryDisplayManager(code: code)
        let transport = PetFakeTransport()
        var opened: [URL] = []
        let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            codexPluginSetupManager: manager, suggestionModeStore: RecoverySuggestionStore(),
            appUpdateURLOpener: { opened.append($0); return true })
        defer { model.stopPolling() }
        await model.recheckCodexNativeExecutable()
        #expect(model.canRetryCodexPluginConnection)
        for width: CGFloat in [340, 440] {
            let view = CodexConnectionRecoveryView(viewModel: model, showsReport: true, initiallyExpanded: true)
                .padding(16).frame(width: width)
                .foregroundStyle(Color.black).background(Color.white)
                .environment(\.colorScheme, .light)
                .environment(\.petAirForceOpaqueSurfaces, true)
            let host = NSHostingView(rootView: view)
            host.appearance = NSAppearance(named: .aqua)
            let size = NSSize(width: width, height: host.fittingSize.height)
            let window = NSWindow(contentRect: NSRect(x: -20_000, y: -20_000, width: size.width, height: size.height),
                                  styleMask: .borderless, backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = host
            // Never order this fixture window or activate the app.
            defer { window.close() }
            host.frame = NSRect(origin: .zero, size: size)
            for _ in 0..<5 {
                host.layoutSubtreeIfNeeded()
                window.displayIfNeeded()
                try await Task.sleep(for: .milliseconds(20))
            }
            host.layoutSubtreeIfNeeded()
            #expect(host.bounds.width == width)
            #expect(host.fittingSize.width <= width + 1)
            let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.effectiveAppearance.performAsCurrentDrawingAppearance {
                host.cacheDisplay(in: host.bounds, to: bitmap)
            }
            #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
            var colors = Set<String>()
            for y in stride(from: 0, to: bitmap.pixelsHigh, by: 8) {
                for x in stride(from: 0, to: bitmap.pixelsWide, by: 8) {
                    if let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) {
                        colors.insert("\(Int(color.redComponent * 255)),\(Int(color.greenComponent * 255)),\(Int(color.blueComponent * 255))")
                    }
                }
            }
            #expect(colors.count > 12)
            if let directory = ProcessInfo.processInfo.environment["BLABEE_CONNECTION_SETUP_RENDER_DIRECTORY"] {
                try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                let data = try #require(bitmap.representation(using: .png, properties: [:]))
                try data.write(to: URL(fileURLWithPath: directory)
                    .appendingPathComponent("recovery-\(code)-\(Int(width))-\(PetL10n.language.rawValue)-expanded.png"))
            }
        }
        #expect(opened.isEmpty)
        #expect((await manager.calls()).checks == 1)
        #expect((await manager.calls()).connects == 0)
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
    }
}
