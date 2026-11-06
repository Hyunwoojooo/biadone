import AppKit
import CoordinatorSwift
import SwiftUI
import Testing
import Vision
@testable import BlabeeCoordinator

/// Rendering must not switch sessions, focus a card or submit a selection.
private actor InboxRenderTransport: PetProviderControlling {
    private(set) var operationCount = 0
    private(set) var inspectionCount = 0
    private let allowsConnectionInspection: Bool

    init(allowsConnectionInspection: Bool = false) {
        self.allowsConnectionInspection = allowsConnectionInspection
    }

    func request(type: String, payload: Data) throws -> Data {
        if allowsConnectionInspection, type == "get_state" {
            inspectionCount += 1
            throw PetTestError.injected("render_service_unavailable")
        }
        operationCount += 1
        throw PetTestError.injected("unexpected_render_request")
    }

    func selectSession(_ session: PetProviderSession) { operationCount += 1 }
    func checkConnection(_ context: PetProviderContext) { operationCount += 1 }
    func disconnect(_ context: PetProviderContext) { operationCount += 1 }
}

private struct InboxRenderSuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_ mode: BlabeeSuggestionMode) {}
}

@Suite("Pet unified inbox views", .petLanguage(.korean))
@MainActor
struct PetUnifiedInboxViewTests {
    init() throws { try PetTypographyTestResources.register() }

    @Test("Cards show their contents without the former session picker", arguments: [PetProvider.codex, .claude])
    func sharedCardWithoutSessionPicker(_ provider: PetProvider) async throws {
        let transport = InboxRenderTransport()
        let model = try model(provider: provider, hasCard: true, transport: transport)
        defer { model.stopPolling() }
        #expect(model.supportsProviderSessions && model.providerSessions.count == 2)
        #expect(model.provider == provider)
        #expect(model.displayInteraction?.actionChoices.count == 2)

        for width in [460.0, 340.0] {
            for dark in [false, true] {
                let size = CGSize(width: width, height: 570)
                let (host, window) = hosting(model: model, size: size, dark: dark)
                defer { window.contentView = nil; window.close() }
                await settle(host)
                let bitmap = try render(host, name: "card-\(provider.displayName.lowercased())-\(Int(width))-\(dark ? "dark" : "light")")
                let copy = try recognizedText(bitmap).lowercased()
                #expect(copy.contains("first"), "Rendered copy: \(copy)")
                #expect(copy.contains("second"), "Rendered copy: \(copy)")
                #expect(!copy.contains("session"), "A session picker must not reappear: \(copy)")
                #expect(!copy.contains("sentinel"), "Session metadata must not precede the card: \(copy)")
                #expect(abs(host.bounds.width - width) < 0.01)
            }
        }
        #expect(await transport.operationCount == 0)
    }

    @Test("The ready inbox has one Waiting presentation for both providers", arguments: [PetProvider.codex, .claude])
    func sharedWaitingWithoutSessionPicker(_ provider: PetProvider) async throws {
        let transport = InboxRenderTransport()
        let model = try model(provider: provider, hasCard: false, transport: transport)
        defer { model.stopPolling() }
        #expect(model.presentationState == .ready)
        #expect(model.displayInteraction == nil)

        for dark in [false, true] {
            let (host, window) = hosting(model: model, size: CGSize(width: 340, height: 480), dark: dark)
            defer { window.contentView = nil; window.close() }
            await settle(host)
            let bitmap = try render(host, name: "waiting-\(provider.displayName.lowercased())-\(dark ? "dark" : "light")")
            let copy = try recognizedText(bitmap).lowercased()
            #expect(copy.contains("waiting"), "Rendered copy: \(copy)")
            #expect(!copy.contains("session") && !copy.contains("sentinel"), "Rendered copy: \(copy)")
            #expect(!copy.contains("codex") && !copy.contains("claude"), "Rendered copy: \(copy)")
        }
        #expect(await transport.operationCount == 0)
    }

    @Test("Provider marks are name badges with distinct tints in light and dark")
    func distinctProviderMarks() async throws {
        #expect(PetProvider.codex.badgeTint(for: .light) != PetProvider.claude.badgeTint(for: .light))
        #expect(PetProvider.codex.badgeTint(for: .dark) != PetProvider.claude.badgeTint(for: .dark))
        var renderedMarks: [String: Data] = [:]
        for dark in [false, true] {
            for provider in [PetProvider.codex, .claude] {
                let size = CGSize(width: 80, height: 32)
                let view = PetProviderMark(provider: provider)
                    .frame(width: size.width, height: size.height)
                    .background(dark ? Color.black : Color.white)
                let (host, window) = hosting(view: AnyView(view), size: size, dark: dark)
                defer { window.contentView = nil; window.close() }
                await settle(host)
                let name = "\(provider.displayName)-\(dark ? "dark" : "light")"
                let bitmap = try render(host, name: "source-mark-\(name.lowercased())")
                var tintedPixels = 0
                var red = 0.0, green = 0.0
                for y in 0..<bitmap.pixelsHigh {
                    for x in 0..<bitmap.pixelsWide {
                        guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                        // Neutral background/ink has r ≈ g ≈ b; the badge tint does not.
                        if abs(color.redComponent - color.greenComponent) > 0.05
                            || abs(color.greenComponent - color.blueComponent) > 0.05 {
                            tintedPixels += 1
                            red += color.redComponent
                            green += color.greenComponent
                        }
                    }
                }
                #expect(tintedPixels > 40, "\(name): \(tintedPixels)")
                #expect(tintedPixels < bitmap.pixelsWide * bitmap.pixelsHigh / 2)
                // Claude's tint is warm (red over green) and Codex's is teal (green over red)
                // in both schemes; a swapped or scheme-ignoring tint would flip one of them.
                #expect((red > green) == (provider == .claude), "\(name): red \(red) green \(green)")
                renderedMarks[name] = try #require(bitmap.representation(using: .png, properties: [:]))
            }
            #expect(renderedMarks["Codex-\(dark ? "dark" : "light")"] != renderedMarks["Claude-\(dark ? "dark" : "light")"])
        }
        #expect(renderedMarks["Codex-light"] != renderedMarks["Codex-dark"])
        #expect(renderedMarks["Claude-light"] != renderedMarks["Claude-dark"])
    }

    @Test("The header keeps the whole status title beside the Claude badge at narrow widths")
    func headerStatusTitleBesideBadge() async throws {
        let transport = InboxRenderTransport()
        let model = try model(provider: .claude, hasCard: true, transport: transport)
        defer { model.stopPolling() }
        let title = model.presentationTitle
        #expect(!title.isEmpty)
        for width in [340.0, 380.0, 460.0] {
            for dark in [false, true] {
                let (host, window) = hosting(model: model, size: CGSize(width: width, height: 570), dark: dark)
                defer { window.contentView = nil; window.close() }
                await settle(host)
                let bitmap = try render(host, name: "header-claude-\(Int(width))-\(dark ? "dark" : "light")")
                // The 11pt Korean status title needs the upscaled, Korean-aware pass.
                let words = try recognizedSettingsText(bitmap).map { normalized($0.text) }
                let copy = words.joined(separator: "|")
                let label = "\(Int(width)) \(dark ? "dark" : "light"): \(copy)"
                // The wordmark always stays. At the product width (460) the name badge
                // and the whole title fit; at 380 the badge collapses to its tinted dot
                // so the title still fits. 340 is below any real screen width: the
                // header there is as tight as before the badge (the title may be
                // ellipsized, which Vision cannot read reliably), so only the wordmark
                // is required.
                #expect(words.contains { $0.hasPrefix("blabee") }, "\(label)")
                if width >= 380 { #expect(words.contains { $0.contains(normalized(title)) }, "\(label)") }
                if width == 460 { #expect(words.contains { $0.contains("claude") }, "\(label)") }
            }
        }
        #expect(await transport.operationCount == 0)
    }

    @Test("General and Connection settings show Codex and Claude at the same level", arguments: [PetSettingsTab.general, .connection])
    func sharedProviderSettings(_ tab: PetSettingsTab) async throws {
        // Connection settings perform their automatic status inspection; no
        // selection, focus, provider control or other operation is permitted.
        let transport = InboxRenderTransport(allowsConnectionInspection: true)
        let model = try model(provider: .codex, hasCard: false, transport: transport)
        defer { model.stopPolling() }
        // Enter settings without beginOnboarding's environment refresh. The
        // model uses a fake shortcut backend and never saves its draft.
        model.beginShortcutSettings()
        model.selectSettingsTab(tab)
        #expect(model.isShowingSettings && model.selectedSettingsTab == tab)

        let size = CGSize(width: 460, height: 680)
        let (host, window) = hosting(model: model, size: size, dark: false)
        defer { window.contentView = nil; window.close() }
        await settle(host)
        let bitmap = try render(host, name: "settings-\(tab.rawValue)-460-light")
        let words = try recognizedSettingsText(bitmap)
        let copy = words.map(\.text).joined(separator: "\n")
        // General shows the two connection summary rows ("Codex 연결" and
        // "Claude 연결"). Connection shows the two disclosure rows under the
        // shared setup card; the card's own side-by-side Codex/Claude
        // checkboxes are not the peer rows checked here. Test builds share one
        // presentation language across suites, so either language may render.
        let codexLabels = tab == .general
            ? ["Codex 연결", "Codex connection"]
            : ["Codex · 수동 설정", "Codex · Manual Settings"]
        let claudeLabels = tab == .general
            ? ["Claude 연결", "Claude connection"]
            : ["Claude · 터미널", "Claude · Terminal Settings"]
        let codex = try #require(words.first { word in
            codexLabels.contains { normalized(word.text).contains(normalized($0)) }
        }, "Codex settings should be fully readable: \(copy)")
        let claude = try #require(words.first { word in
            claudeLabels.contains { normalized(word.text).contains(normalized($0)) }
        }, "Claude settings should be fully readable: \(copy)")
        // Vision coordinates start at the bottom: these peer rows must both
        // be visible, vertically separate and share the same left alignment.
        #expect(codex.frame.minY > claude.frame.maxY)
        #expect(abs(codex.frame.minX - claude.frame.minX) < 0.03)
        #expect(codex.frame.minX > 0 && claude.frame.maxX < 1)
        #expect(abs(host.bounds.width - size.width) < 0.01)
        #expect(await transport.operationCount == 0)
        #expect(await transport.inspectionCount == (tab == .connection ? 1 : 0))
        #expect(model.automaticAppUpdate.phase == .idle)
    }

    private func model(provider: PetProvider, hasCard: Bool, transport: InboxRenderTransport) throws -> PetViewModel {
        let inspection = ClaudeAutoConnectSetup.Inspection(
            isEnabled: false, canEnable: false, canDisable: false, detail: "렌더 검증용 상태")
        let unusedJournalRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-inbox-render-\(UUID().uuidString)", isDirectory: true)
        let model = PetViewModel(
            transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            claudeConnection: PetClaudeConnectionController(
                inspect: { inspection }, enable: { inspection }, disable: { inspection }),
            suggestionModeStore: InboxRenderSuggestionStore(),
            appUpdateURLOpener: { _ in false },
            automaticAppUpdate: AppUpdateTransactionController(
                store: .init(rootURL: unusedJournalRoot), safePointWaiter: .init(requireReady: { _ in }))
        )
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: .defaults) { _ in }
        model.attachHotKeyRegistry(registry)
        let providers: [PetProvider] = [.codex, .claude]
        let sessions = providers.map { source in
            let context = PetProviderContext(provider: source, scopeID: UUID().uuidString.lowercased(),
                serviceIncarnation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                sessionIncarnation: UUID().uuidString.lowercased(),
                authorityEpoch: source == .claude ? UUID().uuidString.lowercased() : nil, uiGeneration: 1)
            return PetProviderSession(id: source.displayName, context: context, projectID: "project_inbox",
                sessionID: "session_inbox", cwd: "/tmp/session-sentinel", state: "ready",
                title: "SESSION PICKER SENTINEL")
        }
        let selected = try #require(sessions.first { $0.context.provider == provider })
        let cards = hasCard ? [PetTestCard(suffix: "inbox", rankedActionCount: 2)] : []
        var object = petTestSnapshotObject(cards: cards, foregroundSuffix: hasCard ? "inbox" : nil)
        if hasCard {
            var interactions = try #require(object["interactions"] as? [[String: Any]])
            var choices = try #require(interactions[0]["choices"] as? [[String: Any]])
            for (index, title) in ["First", "Second"].enumerated() {
                var action = try #require(choices[index]["action"] as? [String: Any])
                action["title"] = title
                choices[index]["action"] = action
            }
            interactions[0]["choices"] = choices
            object["interactions"] = interactions
        }
        var snapshot = try PetSnapshot.parse(petTestData(object))
        snapshot.providerContext = selected.context
        snapshot.providerSessions = sessions
        if provider == .claude {
            snapshot.providerStatus = PetProviderStatus(provider: provider, scopeID: selected.context.scopeID,
                sessionID: selected.sessionID, cwd: selected.cwd, bridgeConnected: true,
                ready: true, selectionEnabled: true, latestOutcome: nil)
        }
        model.applySnapshotForTesting(snapshot)
        registry.reconcile(eligibleSlots: hasCard ? [1, 2] : [])
        return model
    }

    private func hosting(model: PetViewModel, size: CGSize, dark: Bool) -> (NSHostingView<AnyView>, NSWindow) {
        let scheme: ColorScheme = dark ? .dark : .light
        let view = PetRootView(viewModel: model, usesSystemGlassSurface: false)
            .environment(\.colorScheme, scheme)
            .environment(\.petAirForceOpaqueSurfaces, true)
            .frame(width: size.width, height: size.height)
            .background(PetAirPalette.panel(for: scheme))
        return hosting(view: AnyView(view), size: size, dark: dark)
    }

    private func hosting(view: AnyView, size: CGSize, dark: Bool) -> (NSHostingView<AnyView>, NSWindow) {
        let host = NSHostingView(rootView: view)
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let window = NSWindow(contentRect: CGRect(origin: CGPoint(x: -20_000, y: -20_000), size: size),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        host.frame = CGRect(origin: .zero, size: size)
        // Never order the window, activate a live app, or register global keys.
        return (host, window)
    }

    private func settle(_ host: NSView) async {
        for _ in 0..<5 {
            host.layoutSubtreeIfNeeded()
            host.window?.displayIfNeeded()
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    private func render(_ host: NSView, name: String) throws -> NSBitmapImageRep {
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.effectiveAppearance.performAsCurrentDrawingAppearance {
            host.cacheDisplay(in: host.bounds, to: bitmap)
        }
        #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
        if let path = ProcessInfo.processInfo.environment["BLABEE_UNIFIED_INBOX_RENDER_DIRECTORY"] {
            let directory = URL(fileURLWithPath: path, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try #require(bitmap.representation(using: .png, properties: [:]))
            try data.write(to: directory.appendingPathComponent(name + ".png"))
        }
        return bitmap
    }

    private func recognizedText(_ bitmap: NSBitmapImageRep) throws -> String {
        // Pixel checks avoid pretending an offscreen view has a live AX tree.
        // A separate VoiceOver pass is required to qualify spoken labels.
        let image = try #require(bitmap.cgImage)
        let request = VNRecognizeTextRequest()
        request.recognitionLanguages = ["en-US"]
        request.recognitionLevel = .accurate
        request.minimumTextHeight = 0
        request.customWords = ["Waiting", "First", "Second", "SESSION", "PICKER", "SENTINEL"]
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    private struct RecognizedSettingsText {
        let text: String
        let frame: CGRect
    }

    private func normalized(_ text: String) -> String {
        text.lowercased().filter { !$0.isWhitespace && !$0.isPunctuation }
    }

    private func recognizedSettingsText(_ bitmap: NSBitmapImageRep) throws -> [RecognizedSettingsText] {
        let original = try #require(bitmap.cgImage)
        let context = try #require(CGContext(
            data: nil, width: original.width * 3, height: original.height * 3,
            bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.interpolationQuality = .high
        context.draw(original, in: CGRect(x: 0, y: 0, width: context.width, height: context.height))
        let image = try #require(context.makeImage())
        let request = VNRecognizeTextRequest()
        request.recognitionLanguages = ["ko-KR", "en-US"]
        request.recognitionLevel = .accurate
        request.minimumTextHeight = 0
        request.customWords = [
            "Codex 연결", "Claude 연결", "Codex · 수동 설정과 진단", "Claude · 터미널 설정",
            "Codex connection", "Claude connection", "Codex · Manual Settings and Diagnostics", "Claude · Terminal Settings",
        ]
        try VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { observation in
            observation.topCandidates(1).first.map {
                RecognizedSettingsText(text: $0.string, frame: observation.boundingBox)
            }
        }
    }
}
