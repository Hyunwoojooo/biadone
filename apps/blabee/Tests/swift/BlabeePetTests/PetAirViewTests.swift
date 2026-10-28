import AppKit
import SwiftUI
import Testing
import Vision
@testable import BlabeeCoordinator

@Suite("Pet native Air views", .petLanguage(.korean))
@MainActor
struct PetAirViewTests {
    init() throws { try PetTypographyTestResources.register() }

    @Test("Compact Codex overview and its action remain visible at 460 by 550 when opted in")
    func compactConnectionSettingsPresentation() async throws {
        guard ProcessInfo.processInfo.environment["BLABEE_HOME_DEFAULT_SETTINGS_RENDERS"] == "1" else { return }
        for language in [PetUILanguage.english, .korean] {
            try await PetL10n.$languageOverride.withValue(language) {
                let restoreLanguage = petRenderLanguageOverride(language)
                defer { restoreLanguage() }
                let transport = PetFakeTransport()
                let model = try viewModel(transport: transport)
                defer { model.stopPolling() }
                model.beginShortcutSettings()
                model.selectSettingsTab(.general)
                for dark in [false, true] {
                    let (host, window) = hosting(model, size: CGSize(width: 460, height: 550), dark: dark, forceOpaque: true)
                    defer { window.contentView = nil; window.close() }
                    await settleLayout(host)
                    let bitmap = try render(host, name: "compact-settings-460-550-\(language.rawValue)-\(dark ? "dark" : "light")")
                    let copy = normalized(try recognizedText(in: bitmap).map(\.text).joined(separator: " "))
                    let expectedSummary = language == .english ? "Codex connection" : "Codex 연결"
                    let expectedAction = language == .english ? "Connection Settings" : "연결 설정"
                    #expect(copy.contains(normalized(expectedSummary)), "\(copy)")
                    #expect(copy.contains(normalized(expectedAction)), "\(copy)")
                    for removed in ["Codex Plugin", "Codex Hook trust", "Codex watched projects", "Codex selection delivery",
                                    "Codex Hook 신뢰", "Codex 관찰 프로젝트", "Codex 선택 전달"] {
                        #expect(!copy.contains(normalized(removed)), "\(copy)")
                    }
                    #expect(host.fittingSize.width <= 461)
                }
                await expectNoSelectionRequests(transport)
            }
        }
    }

    @Test("English settings and choice controls fit normal and narrow panels while card text stays exact")
    func englishPresentation() async throws {
        try await PetL10n.$languageOverride.withValue(.english) {
            let transport = PetFakeTransport()
            let title = "원문 카드 / Original card"
            let model = try viewModel(transport: transport, count: 2, title: title)
            defer { model.stopPolling() }
            let identity = model.displayInteraction?.identity
            for width in [460.0, 340.0] {
                let size = CGSize(width: width, height: decisionSize(count: 2).height)
                let (host, window) = hosting(model, size: size, dark: false, forceOpaque: true)
                defer { window.contentView = nil; window.close() }
                await settleLayout(host)
                let bitmap = try render(host, name: "language-en-choices-\(Int(width))")
                let words = try recognizedText(in: bitmap)
                let copy = normalized(words.map(\.text).joined(separator: " "))
                #expect(words.contains { normalized($0.text) == "blabee" }, "\(copy)")
                #expect(copy.contains("recommended"), "\(copy)")
                #expect(copy.contains("skipchoices"), "\(copy)")
                #expect(model.displayInteraction?.identity == identity)
                #expect(model.displayInteraction?.actionChoices.allSatisfy { $0.displayTitle == title } == true)
            }
            model.beginShortcutSettings()
            model.selectSettingsTab(.general)
            for width in [460.0, 340.0] {
                let (host, window) = hosting(model, size: CGSize(width: width, height: 700), dark: false, forceOpaque: true)
                defer { window.contentView = nil; window.close() }
                await settleLayout(host)
                let bitmap = try render(host, name: "language-en-settings-\(Int(width))")
                let words = try recognizedText(in: bitmap)
                let copy = normalized(words.map(\.text).joined(separator: " "))
                #expect(copy.contains("blabeesettings"), "\(copy)")
                #expect(copy.contains("language"), "\(copy)")
                #expect(copy.contains("english"), "\(copy)")
                let tabs = try ["general", "shortcuts", "projects", "connection"].map { title in
                    // Vision can attach the adjacent SF Symbol to a label.
                    // Require the complete word on the tab row, not a joined
                    // pair of wrapped lines or a matching row farther below.
                    try #require(words.first {
                        normalized($0.text).contains(title) && $0.frame.minY > 0.75 && $0.frame.maxY < 0.9
                    }, "\(copy)").frame
                }
                #expect(tabs.allSatisfy { abs($0.midY - tabs[0].midY) < 0.01 })
            }
            await expectNoSelectionRequests(transport)
        }
    }

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

    @Test(
        "Suggestion kind headers render with details without restoring project or provider banners",
        arguments: [nil, "current_task", "new_suggestion"] as [String?]
    )
    func suggestionKindHeader(kind: String?) async throws {
        let transport = PetFakeTransport()
        let model = try viewModel(transport: transport, count: 2, suggestionKind: kind)
        defer { model.stopPolling() }
        let expectedLabel: String
        switch kind {
        case "current_task": expectedLabel = "현재 작업의 다음 선택"
        case "new_suggestion": expectedLabel = "새로운 제안"
        default: expectedLabel = "다음 선택"
        }

        for width in [460.0, 340.0] {
            for dark in [false, true] {
                let name = artifactName("suggestion-\(kind ?? "legacy")", width, dark, true)
                let (host, window) = hosting(
                    model,
                    size: CGSize(width: width, height: decisionSize(count: 2).height),
                    dark: dark,
                    forceOpaque: true
                )
                defer { window.contentView = nil; window.close() }
                await settleLayout(host)
                let bitmap = try render(host, name: name)
                let words = try recognizedText(in: bitmap)
                let copy = words.map(\.text).joined(separator: "\n")
                var hasKindLabel = normalized(copy).contains(normalized(expectedLabel))
                if !hasKindLabel {
                    hasKindLabel = try recognizedText(in: bitmap, scale: 1)
                        .contains { normalized($0.text).contains(normalized(expectedLabel)) }
                }
                #expect(hasKindLabel, "\(name): \(copy)")
                #expect(normalized(copy).contains("상세보기"), "\(name): \(copy)")
                #expect(!normalized(copy).contains("codex"))
                #expect(!normalized(copy).contains("blabeepetair"))
                #expect(!normalized(copy).contains("projectair"))
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
                    // Upscaling can merge the small Korean badge's strokes
                    // (권장 -> 권창). Check the original pixels before a crop;
                    // require the exact label and keep title geometry unchanged.
                    if !hasRecommendation {
                        hasRecommendation = try recognizedText(in: bitmap, scale: 1)
                            .contains { normalized($0.text) == "권장" }
                    }
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

    @Test("Measured decisions shrink to their content with nearby footer controls", arguments: [2, 3, 4])
    func adaptiveDecisionHeight(count: Int) async throws {
        try await PetL10n.$languageOverride.withValue(.english) {
            let transport = PetFakeTransport()
            let model = try viewModel(transport: transport, count: count)
            defer { model.stopPolling() }
            for width in [460.0, 340.0] {
                let (host, window, capture) = adaptiveHosting(model, width: width, maximumHeight: 900)
                defer { window.contentView = nil; window.close() }
                await settleLayout(host)
                let measurement = try #require(capture.latest)
                #expect(abs(window.frame.height - ceil(measurement.size.height)) < 1)
                #expect(window.frame.height < 680)
                #expect(capture.resizeCount <= 3, "Layout must settle instead of chasing its viewport height")
                for scroll in scrollViews(in: host) {
                    if let document = scroll.documentView {
                        #expect(document.bounds.height <= scroll.contentView.bounds.height + 1)
                    }
                }
                let bitmap = try render(host, name: "adaptive-\(count)-\(Int(width))")
                let words = try recognizedText(in: bitmap)
                let skip = try #require(words.first { normalized($0.text).contains("skipchoices") })
                let lastTitle = try #require(words.first {
                    normalized($0.text).contains(normalized(Self.choiceTitles[count - 1]))
                })
                // Pixel-derived separation catches the original empty viewport
                // between the final card row and its secondary actions.
                let titleToFooter = (lastTitle.frame.minY - skip.frame.maxY) * host.bounds.height
                #expect(titleToFooter > 0 && titleToFooter < 190, "\(width): \(titleToFooter)")
                #expect(words.contains { normalized($0.text).contains("first") })
                #expect(words.contains { normalized($0.text).contains("second") })
            }
            await expectNoSelectionRequests(transport)
        }
    }

    @Test("A same-count decision grows for longer content and shrinks again")
    func adaptiveDecisionRemeasuresText() async throws {
        let transport = PetFakeTransport()
        let model = try viewModel(transport: transport, count: 2)
        defer { model.stopPolling() }
        let (host, window, capture) = adaptiveHosting(model, width: 460, maximumHeight: 900)
        defer { window.contentView = nil; window.close() }
        await settleLayout(host)
        let shortMeasurement = try #require(capture.latest)
        let shortHeight = window.frame.height
        let card = PetTestCard(suffix: "air", rankedActionCount: 2)
        var snapshot = petTestSnapshotObject(cards: [card], foregroundSuffix: "air")
        var interactions = try #require(snapshot["interactions"] as? [[String: Any]])
        interactions[0]["summary"] = String(repeating: "선택한 작업의 변경 내용과 검증 결과를 확인할 수 있습니다. ", count: 5)
        snapshot["interactions"] = interactions
        try model.receiveSnapshotDataForTesting(petTestData(snapshot))
        await settleLayout(host)
        let longMeasurement = try #require(capture.latest)
        #expect(longMeasurement.identity != shortMeasurement.identity)
        #expect(window.frame.height > shortHeight + 40)
        #expect(shortMeasurement.accepted(for: longMeasurement.identity, width: 460) == nil)
        try model.receiveSnapshotDataForTesting(petTestData(petTestSnapshotObject(cards: [card], foregroundSuffix: "air")))
        await settleLayout(host)
        #expect(window.frame.height < longMeasurement.size.height - 40)
        #expect(capture.resizeCount <= 7)
        await expectNoSelectionRequests(transport)
    }

    @Test("Adaptive decisions use overflow only when the display cannot fit the full text")
    func adaptiveDecisionSmallDisplayOverflow() async throws {
        let transport = PetFakeTransport()
        let title = String(repeating: "작업 범위와 완료 조건을 확인합니다. ", count: 9) + " AIR TITLE END"
        let model = try viewModel(transport: transport, count: 2, title: title)
        defer { model.stopPolling() }
        let (host, window, capture) = adaptiveHosting(model, width: 340, maximumHeight: 460)
        defer { window.contentView = nil; window.close() }
        await settleLayout(host)
        #expect(window.frame.height == 460)
        #expect(try #require(capture.latest).size.height > 460)
        let scroll = try #require(scrollViews(in: host).first)
        #expect(try #require(scroll.documentView).bounds.height > scroll.contentView.bounds.height)
        scrollToEnd(scroll)
        await settleLayout(host)
        let bitmap = try render(host, name: "adaptive-small-display-end")
        let words = try recognizedText(in: bitmap)
        let copy = normalized(words.map(\.text).joined())
        #expect(copy.contains("airtitleend"))
        #expect(copy.contains("선택건너뛰기"))
        #expect(capture.resizeCount <= 3)
        await expectNoSelectionRequests(transport)
    }

    @Test("An overflowed decision resets its scroll position only for a new card")
    func adaptiveDecisionCardResetsScroll() async throws {
        let transport = PetFakeTransport()
        let model = try viewModel(transport: transport, count: 2,
                                  title: String(repeating: "변경 범위와 완료 조건을 확인합니다. ", count: 8))
        defer { model.stopPolling() }
        let (host, window, capture) = adaptiveHosting(model, width: 340, maximumHeight: 420)
        defer { window.contentView = nil; window.close() }
        await settleLayout(host)
        let firstIdentity = try #require(capture.latest).identity
        let oldScroll = try #require(scrollViews(in: host).first)
        scrollToEnd(oldScroll)
        await settleLayout(host)
        let card = PetTestCard(suffix: "new-card", rankedActionCount: 2)
        var snapshot = petTestSnapshotObject(cards: [card], foregroundSuffix: card.suffix)
        var interactions = try #require(snapshot["interactions"] as? [[String: Any]])
        interactions[0]["summary"] = String(repeating: "새 카드에서는 맨 위부터 작업을 확인합니다. ", count: 20)
        snapshot["interactions"] = interactions
        try model.receiveSnapshotDataForTesting(petTestData(snapshot))
        await settleLayout(host)
        #expect(try #require(capture.latest).identity != firstIdentity)
        let scroll = try #require(scrollViews(in: host).first)
        let document = try #require(scroll.documentView)
        #expect(document.bounds.height > scroll.contentView.bounds.height + 1)
        if document.isFlipped {
            #expect(abs(scroll.documentVisibleRect.minY - document.bounds.minY) < 1)
        } else {
            #expect(abs(scroll.documentVisibleRect.maxY - document.bounds.maxY) < 1)
        }
        let bitmap = try render(host, name: "adaptive-new-card-top")
        #expect(try recognizedText(in: bitmap).contains { normalized($0.text) == "blabee" })
        scrollToEnd(scroll)
        await settleLayout(host)
        let readingPosition = scroll.documentVisibleRect.minY
        // An ordinary timer snapshot must not send the reader back to the top.
        interactions[0]["milliseconds_until_expiry"] = 80_000
        snapshot["interactions"] = interactions
        var routing = try #require(snapshot["routing"] as? [String: Any])
        var pending = try #require(routing["pending"] as? [[String: Any]])
        pending[0]["milliseconds_until_expiry"] = 80_000
        routing["pending"] = pending
        snapshot["routing"] = routing
        try model.receiveSnapshotDataForTesting(petTestData(snapshot))
        await settleLayout(host)
        let updatedScroll = try #require(scrollViews(in: host).first)
        #expect(abs(updatedScroll.documentVisibleRect.minY - readingPosition) < 1)
        await expectNoSelectionRequests(transport)
    }

    @Test("One hosted decision remeasures when display width narrows and widens")
    func adaptiveDecisionWidthChanges() async throws {
        let transport = PetFakeTransport()
        let model = try viewModel(transport: transport, count: 2,
                                  title: "작업 내용과 완료 기준을 확인하고 선택합니다")
        defer { model.stopPolling() }
        let (host, window, capture) = adaptiveHosting(model, width: 460, maximumHeight: 900)
        defer { window.contentView = nil; window.close() }
        await settleLayout(host)
        let wide = try #require(capture.latest)
        capture.maximumSize.width = 340
        window.setContentSize(CGSize(width: 340, height: 900))
        await settleLayout(host)
        #expect(try #require(capture.latest).size.width == 340)
        #expect(window.frame.height > wide.size.height)
        #expect(wide.accepted(for: capture.latest?.identity, width: 340) == nil)
        capture.maximumSize.width = 460
        window.setContentSize(CGSize(width: 460, height: 900))
        await settleLayout(host)
        #expect(abs(window.frame.height - ceil(wide.size.height)) < 1)
        #expect(capture.resizeCount <= 5)
        await expectNoSelectionRequests(transport)
    }

    @Test("Screenshot-sized summary keeps both cards and footer in a compact panel")
    func adaptiveDecisionScreenshot() async throws {
        try await PetL10n.$languageOverride.withValue(.english) {
            let transport = PetFakeTransport()
            let model = try viewModel(
                transport: transport, count: 2, suggestionKind: "current_task",
                summary: "선택한 옵션의 제목·목표·제약·완료 조건을 Codex에 전달하는 프롬프트에 표시하도록 수정했습니다. ref와 Hook 검증은 유지하며, 변조·재시도·구형 전달 형식의 회귀 검사도 통과했습니다. 설치 앱은 아직 변경하지 않았습니다.",
                titles: ["Codex 실제 전달 확인", "수정본 빌드·공증"]
            )
            defer { model.stopPolling() }
            let (host, window, capture) = adaptiveHosting(model, width: 460, maximumHeight: 900)
            defer { window.contentView = nil; window.close() }
            await settleLayout(host)
            #expect(try #require(capture.latest).size.height < 520)
            let bitmap = try render(host, name: "adaptive-user-example")
            let words = try recognizedText(in: bitmap)
            let copy = normalized(words.map(\.text).joined())
            #expect(copy.contains("codex실제전달확인"))
            #expect(copy.contains("수정본빌드공증"))
            #expect(copy.contains("skipchoices"))
            await expectNoSelectionRequests(transport)
        }
    }

    @Test("The panel controller preserves other modes and returns to adaptive decisions")
    func adaptiveDecisionControllerTransitions() async throws {
        let transport = PetFakeTransport()
        let model = try viewModel(transport: transport, count: 2)
        let controller = PetPanelController(viewModel: model)
        defer {
            controller.stopObservingScreenChanges()
            controller.panel.contentView = nil
            controller.panel.close()
            model.stopPolling()
        }
        let host = try #require(controller.panel.contentView)
        await settleLayout(host)
        #expect(!controller.panel.isVisible)
        let naturalHeight = controller.panel.frame.height
        #expect(naturalHeight < 500)
        model.beginShortcutSettings()
        await settleLayout(host)
        #expect(controller.panel.frame.height > naturalHeight)
        model.cancelShortcutSettings()
        await settleLayout(host)
        // Settings already leave the details flag expanded. Preserve that
        // behavior, then exercise the user's return to the collapsed card.
        #expect(model.isExpanded)
        #expect(controller.panel.frame.height > naturalHeight)
        model.setExpanded(false)
        await settleLayout(host)
        #expect(abs(controller.panel.frame.height - naturalHeight) < 1)

        let card = PetTestCard(suffix: "air", rankedActionCount: 2)
        let approval = petTestSnapshotObject(cards: [card], foregroundSuffix: "air",
                                            permissionRequests: [.init(suffix: "air")], permissionNoticeCount: 1)
        try model.receiveSnapshotDataForTesting(petTestData(approval))
        await settleLayout(host)
        #expect(model.hasNewPermissionNotice)
        #expect(PetDecisionLayoutIdentity.current(for: model, language: PetL10n.language) == nil)
        #expect(controller.panel.frame.height > naturalHeight)
        try model.receiveSnapshotDataForTesting(petTestData(petTestSnapshotObject(cards: [card], foregroundSuffix: "air")))
        await settleLayout(host)
        #expect(PetDecisionLayoutIdentity.current(for: model, language: PetL10n.language) != nil)
        #expect(controller.panel.frame.height < 500)
        #expect(!controller.panel.isVisible)
        await expectNoSelectionRequests(transport)
    }

    @MainActor
    private final class AdaptiveLayoutCapture {
        let model: PetViewModel
        var maximumSize: CGSize
        weak var window: NSWindow?
        var latest: PetDecisionContentMeasurement?
        var resizeCount = 0

        init(model: PetViewModel, maximumSize: CGSize) {
            self.model = model
            self.maximumSize = maximumSize
        }

        func receive(_ measurement: PetDecisionContentMeasurement) {
            let identity = PetDecisionLayoutIdentity.current(for: model, language: PetL10n.language)
            guard measurement.accepted(for: identity, width: maximumSize.width) != nil,
                  let window else { return }
            latest = measurement
            let state = PetPanelLayoutState(
                isExpanded: model.isExpanded, isEditingShortcuts: model.isEditingShortcuts,
                isShowingOnboarding: model.isShowingOnboarding,
                actionCount: model.displayInteraction?.actionChoices.count,
                fifoQueueCount: model.eventQueueCount,
                hasPermissionNotice: model.hasNewPermissionNotice,
                hasStatusMessage: model.hasVisibleStatusMessage
            )
            let size = PetPanelSizePolicy.preferredSize(
                for: state, decisionMeasurement: measurement, decisionIdentity: identity,
                availableSize: maximumSize
            )
            guard window.frame.size != size else { return }
            resizeCount += 1
            window.setContentSize(size)
        }
    }

    private func adaptiveHosting(
        _ model: PetViewModel, width: CGFloat, maximumHeight: CGFloat
    ) -> (NSHostingView<AnyView>, NSWindow, AdaptiveLayoutCapture) {
        let capture = AdaptiveLayoutCapture(model: model, maximumSize: CGSize(width: width, height: maximumHeight))
        let view = PetRootView(viewModel: model, usesSystemGlassSurface: false,
                              onDecisionContentSize: { capture.receive($0) })
            .environment(\.colorScheme, .light)
            .environment(\.petAirForceOpaqueSurfaces, true)
            .background(PetAirPalette.panel(for: .light))
        let host = NSHostingView(rootView: AnyView(view))
        host.sizingOptions = []
        host.appearance = NSAppearance(named: .aqua)
        let window = NSWindow(
            contentRect: CGRect(x: -20_000, y: -20_000, width: width, height: maximumHeight),
            styleMask: .borderless, backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        capture.window = window
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        return (host, window, capture)
    }

    private func viewModel(
        transport: PetFakeTransport,
        count: Int? = nil,
        title: String? = nil,
        suggestionKind: String? = nil,
        summary: String? = nil,
        titles: [String]? = nil
    ) throws -> PetViewModel {
        let model = PetViewModel(
            transport: transport,
            externalApplicationOpener: PetFakeApplicationOpener(),
            automaticAppUpdate: AppUpdateTransactionController(store: .init(
                rootURL: FileManager.default.temporaryDirectory
                    .appendingPathComponent("blabee-air-update-test-\(UUID().uuidString)")
            ))
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
            if let suggestionKind { interactions[0]["suggestion_kind"] = suggestionKind }
            if let summary { interactions[0]["summary"] = summary }
            var choices = try #require(interactions[0]["choices"] as? [[String: Any]])
            for index in choices.indices {
                var action = try #require(choices[index]["action"] as? [String: Any])
                action["title"] = title ?? titles?[index] ?? Self.choiceTitles[index]
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

    private func recognizedText(in bitmap: NSBitmapImageRep, region: CGRect? = nil, scale: Int = 3) throws -> [RecognizedText] {
        // SwiftUI does not publish an AX tree in this offscreen test process.
        // Verify actual pixels and geometry using Apple's local Vision engine;
        // these checks do not stand in for a live VoiceOver qualification.
        let original = try #require(bitmap.cgImage)
        let context = try #require(CGContext(
            data: nil, width: original.width * scale, height: original.height * scale,
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
            request.customWords = [
                "권장", "선택 건너뛰기", "AIR TITLE END", "상세 보기",
                "현재 작업의 다음 선택", "새로운 제안", "다음 선택",
            ]
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
