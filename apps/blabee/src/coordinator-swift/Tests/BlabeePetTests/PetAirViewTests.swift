import AppKit
import SwiftUI
import Testing
import Vision
@testable import BlabeeCoordinator

@Suite("Pet native Air views")
@MainActor
struct PetAirViewTests {
    @Test("Ready renders Waiting without the former empty-state copy")
    func readyArtworkAndCopy() async throws {
        let transport = PetFakeTransport()
        let model = try viewModel(transport: transport)
        defer { model.stopPolling() }
        #expect(model.presentationState == .ready)

        for width in [460.0, 340.0] {
            for dark in [false, true] {
                for forceOpaque in [false, true] {
                    let (host, window) = hosting(
                        model,
                        size: CGSize(width: width, height: 480),
                        dark: dark,
                        forceOpaque: forceOpaque
                    )
                    defer { window.contentView = nil; window.close() }
                    await settleLayout(host)
                    let bitmap = try render(host, name: artifactName("ready", width, dark, forceOpaque))
                    let copy = try recognizedText(in: bitmap).map(\.text).joined(separator: "\n")
                    #expect(copy.contains("Waiting"))
                    #expect(!copy.contains("유효한 결정 카드가 생기면 여기에 표시됩니다."))
                }
            }
        }
        await expectNoSelectionRequests(transport)
    }

    @Test("Two through four choices retain the grid and actions across light, dark and opaque surfaces", arguments: [2, 3, 4])
    func choiceGrid(count: Int) async throws {
        let transport = PetFakeTransport()
        let model = try viewModel(transport: transport, count: count)
        defer { model.stopPolling() }
        #expect(model.displayInteraction?.actionChoices.count == count)

        for width in [460.0, 340.0] {
            for dark in [false, true] {
                for forceOpaque in [false, true] {
                    let (host, window) = hosting(
                        model,
                        size: CGSize(width: width, height: decisionSize(count: count).height),
                        dark: dark,
                        forceOpaque: forceOpaque
                    )
                    defer { window.contentView = nil; window.close() }
                    await settleLayout(host)
                    let bitmap = try render(host, name: artifactName("choices-\(count)", width, dark, forceOpaque))
                    var words = try recognizedText(in: bitmap)
                    let visibleWords = words
                    if let scroll = scrollViews(in: host).first, let document = scroll.documentView,
                       document.bounds.height > scroll.contentView.bounds.height + 1 {
                        let initialY = scroll.documentVisibleRect.minY
                        scrollToEnd(scroll)
                        await settleLayout(host)
                        let displacement = (scroll.documentVisibleRect.minY - initialY)
                            * (document.isFlipped ? 1 : -1) / host.bounds.height
                        let end = try render(host, name: artifactName("choices-\(count)-end", width, dark, forceOpaque))
                        words += try recognizedText(in: end).map {
                            RecognizedText(text: $0.text, frame: $0.frame.offsetBy(dx: 0, dy: -displacement))
                        }
                    }
                    let frames = try Self.choiceTitles.prefix(count).map { title in
                        try #require(words.first { normalized($0.text).contains(normalized(title)) }).frame
                    }
                    #expect(frames.allSatisfy { $0.width > 0 && $0.height > 0 })
                    #expect(frames[0].maxX <= frames[1].minX)
                    #expect(abs(frames[0].midY - frames[1].midY) < 0.02)
                    if count > 2 {
                        #expect(abs(frames[0].minX - frames[2].minX) < 0.02)
                        #expect(frames[2].maxY <= frames[0].minY)
                    }
                    if count > 3 {
                        #expect(frames[2].maxX <= frames[3].minX)
                        #expect(abs(frames[2].midY - frames[3].midY) < 0.02)
                    }
                    let copy = words.map(\.text).joined(separator: "\n")
                    var hasRecommendation = copy.contains("권장")
                    // Whole-frame OCR can misread the small badge after layout
                    // changes. Re-read its observed region; still require the
                    // exact text, and do not alter the grid/title OCR sequence.
                    for candidate in visibleWords where !hasRecommendation && candidate.text.hasPrefix("권") {
                        hasRecommendation = try recognizedText(in: bitmap, region: candidate.frame)
                            .contains { normalized($0.text) == "권장" }
                    }
                    if !hasRecommendation {
                        // Dark surfaces can make whole-frame OCR omit the
                        // badge entirely. Anchor a second pass below the
                        // observed first title, and still require exact text.
                        let recommendationRegion = CGRect(
                            x: frames[0].minX,
                            y: frames[0].minY - 4 * frames[0].height,
                            width: frames[1].minX - frames[0].minX,
                            height: 4 * frames[0].height
                        )
                        hasRecommendation = try recognizedText(in: bitmap, region: recommendationRegion)
                            .contains { normalized($0.text) == "권장" }
                    }
                    #expect(hasRecommendation, "\(artifactName("choices-\(count)", width, dark, forceOpaque)): \(copy)")
                    #expect(!copy.contains("2순위"))
                    #expect(!copy.contains("3순위"))
                    #expect(!copy.contains("4순위"))
                    let skip = try #require(visibleWords.first { normalized($0.text).contains("선택건너뛰기") })
                    #expect(CGRect(x: 0, y: 0, width: 1, height: 1).contains(skip.frame))
                    #expect(skip.frame.minY > 0.01)
                }
            }
        }
        await expectNoSelectionRequests(transport)
    }

    @Test("Long choice titles wrap in a narrow panel and their final text is reachable by scrolling")
    func longChoiceTitles() async throws {
        let transport = PetFakeTransport()
        let title = String(String(repeating: "선택하기 전에 변경 범위와 완료 기준을 충분히 확인합니다. ", count: 8).prefix(220)) + " AIR TITLE END"
        let model = try viewModel(transport: transport, count: 2, title: title)
        defer { model.stopPolling() }
        var normalContentHeight: CGFloat?

        for width in [460.0, 340.0] {
            let (host, window) = hosting(
                model,
                size: CGSize(width: width, height: 480),
                dark: false,
                forceOpaque: true
            )
            defer { window.contentView = nil; window.close() }
            await settleLayout(host)
            #expect(abs(host.bounds.width - width) < 0.01)
            _ = try render(host, name: artifactName("long-choices", width, false, true))
            let scroll = try #require(scrollViews(in: host).first)
            let document = try #require(scroll.documentView)
            #expect(document.bounds.height > scroll.contentView.bounds.height)
            if let normalContentHeight {
                #expect(document.bounds.height > normalContentHeight)
            } else {
                normalContentHeight = document.bounds.height
            }
            scrollToEnd(scroll)
            await settleLayout(host)
            if document.isFlipped {
                #expect(abs(scroll.documentVisibleRect.maxY - document.bounds.maxY) < 1)
            } else {
                #expect(abs(scroll.documentVisibleRect.minY - document.bounds.minY) < 1)
            }
            let bitmap = try render(host, name: artifactName("long-choices-end", width, false, true))
            let words = try recognizedText(in: bitmap)
            #expect(normalized(words.map(\.text).joined()).contains("airtitleend"))
            #expect(words.contains { normalized($0.text).contains("선택건너뛰기") })
        }
        await expectNoSelectionRequests(transport)
    }

    private func viewModel(
        transport: PetFakeTransport,
        count: Int? = nil,
        title: String? = nil
    ) throws -> PetViewModel {
        let model = PetViewModel(
            transport: transport,
            externalApplicationOpener: PetFakeApplicationOpener()
        )
        // Render configured shortcut labels through a fake backend; never
        // register global keys or change the user's shortcut preferences.
        let registry = try PetHotKeyRegistry(
            backend: PetFakeHotKeyBackend(), configuration: .defaults
        ) { _ in }
        model.attachHotKeyRegistry(registry)
        // Ranked fixtures accept 2...4 actions; the one-action sizing boundary
        // is covered separately by PetPanelSizePolicyTests.
        let cards = count.map { [PetTestCard(suffix: "air", rankedActionCount: $0)] } ?? []
        var snapshot = petTestSnapshotObject(cards: cards, foregroundSuffix: count == nil ? nil : "air")
        if count != nil {
            var interactions = try #require(snapshot["interactions"] as? [[String: Any]])
            var choices = try #require(interactions[0]["choices"] as? [[String: Any]])
            for index in choices.indices {
                var action = try #require(choices[index]["action"] as? [String: Any])
                action["title"] = title ?? Self.choiceTitles[index]
                choices[index]["action"] = action
            }
            interactions[0]["choices"] = choices
            snapshot["interactions"] = interactions
        }
        try model.receiveSnapshotDataForTesting(petTestData(snapshot))
        if let count {
            // Model the registered-key appearance without a coordinator focus
            // round trip; this fixture only renders and never submits a choice.
            registry.reconcile(eligibleSlots: Set(1...count))
        }
        return model
    }

    private func hosting(
        _ model: PetViewModel,
        size: CGSize,
        dark: Bool,
        forceOpaque: Bool
    ) -> (NSHostingView<AnyView>, NSWindow) {
        let scheme: ColorScheme = dark ? .dark : .light
        // The system accessibility environment value is read-only. This scoped
        // override exercises the same opaque branch without changing macOS
        // settings or claiming a live accessibility-preference check.
        let view = PetRootView(viewModel: model, usesSystemGlassSurface: forceOpaque)
            .environment(\.colorScheme, scheme)
            .environment(\.petAirForceOpaqueSurfaces, forceOpaque)
            .frame(width: size.width, height: size.height)
            .background(PetAirPalette.panel(for: scheme))
        let host = NSHostingView(rootView: AnyView(view))
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let window = NSWindow(
            contentRect: CGRect(origin: CGPoint(x: -20_000, y: -20_000), size: size),
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.contentView = host
        host.frame = CGRect(origin: .zero, size: size)
        host.layoutSubtreeIfNeeded()
        // Keep the test window offscreen and never order it, activate the app
        // or request live accessibility permissions.
        return (host, window)
    }

    private static let choiceTitles = ["First", "Second", "Third", "Fourth"]

    private func decisionSize(count: Int) -> CGSize {
        PetPanelSizePolicy.preferredSize(for: PetPanelLayoutState(
            isExpanded: false, isEditingShortcuts: false, isShowingOnboarding: false,
            actionCount: count, fifoQueueCount: 1, hasPermissionNotice: false, hasStatusMessage: false
        ))
    }

    private struct RecognizedText {
        let text: String
        let frame: CGRect
    }

    private func normalized(_ text: String) -> String {
        text.lowercased().filter { !$0.isWhitespace && !$0.isPunctuation }
    }

    private func recognizedText(in bitmap: NSBitmapImageRep, region: CGRect? = nil) throws -> [RecognizedText] {
        // SwiftUI does not publish an AX tree in this offscreen test process.
        // Verify actual pixels and geometry using Apple's local Vision engine;
        // these checks do not stand in for a live VoiceOver qualification.
        let original = try #require(bitmap.cgImage)
        let context = try #require(CGContext(
            data: nil, width: original.width * 3, height: original.height * 3,
            bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.interpolationQuality = .high
        context.draw(original, in: CGRect(x: 0, y: 0, width: context.width, height: context.height))
        var image = try #require(context.makeImage())
        if let region {
            let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
            let crop = CGRect(
                x: region.minX * bounds.width, y: (1 - region.maxY) * bounds.height,
                width: region.width * bounds.width, height: region.height * bounds.height
            ).insetBy(dx: -2, dy: -2).intersection(bounds)
            image = try #require(image.cropping(to: crop))
        }
        var words: [RecognizedText] = []
        for language in ["en-US", "ko-KR"] {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = [language]
            request.minimumTextHeight = 0
            request.usesLanguageCorrection = region == nil
            request.customWords = ["권장", "선택 건너뛰기", "AIR TITLE END"]
            try VNImageRequestHandler(cgImage: image).perform([request])
            // Small Korean badges can rank a near-homograph first (for
            // example, 권창). A cropped fallback may use Vision's alternatives,
            // while still requiring the exact visible label from the region.
            words += (request.results ?? []).flatMap { observation in
                observation.topCandidates(region == nil ? 1 : 3).map {
                    RecognizedText(text: $0.string, frame: observation.boundingBox)
                }
            }
        }
        return words
    }

    private func settleLayout(_ host: NSView) async {
        for _ in 0..<5 {
            host.layoutSubtreeIfNeeded()
            host.window?.displayIfNeeded()
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    private func scrollViews(in view: NSView) -> [NSScrollView] {
        let current = (view as? NSScrollView).map { [$0] } ?? []
        return current + view.subviews.flatMap { scrollViews(in: $0) }
    }

    private func scrollToEnd(_ scroll: NSScrollView) {
        guard let document = scroll.documentView else { return }
        let y = document.isFlipped
            ? max(document.bounds.minY, document.bounds.maxY - scroll.contentView.bounds.height)
            : document.bounds.minY
        scroll.contentView.scroll(to: CGPoint(x: 0, y: y))
        scroll.reflectScrolledClipView(scroll.contentView)
    }

    private func artifactName(_ name: String, _ width: Double, _ dark: Bool, _ solid: Bool) -> String {
        "\(name)-\(Int(width))-\(dark ? "dark" : "light")-\(solid ? "solid" : "material")"
    }

    private func render(_ host: NSView, name: String) throws -> NSBitmapImageRep {
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
        // A blank material/background is not evidence of rendered content.
        #expect(colors.count > 12)
        if let directory = ProcessInfo.processInfo.environment["BLABEE_AIR_RENDER_DIRECTORY"] {
            let url = URL(fileURLWithPath: directory, isDirectory: true)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            let data = try #require(bitmap.representation(using: .png, properties: [:]))
            try data.write(to: url.appendingPathComponent(name + ".png"))
        }
        return bitmap
    }

    private func expectNoSelectionRequests(_ transport: PetFakeTransport) async {
        for type in ["select", "focus_interaction", "focus_event", "dismiss_interaction", "resolve_permission_request", "resolve_managed_command_approval"] {
            #expect(await transport.requestCount(type: type) == 0)
        }
    }
}
