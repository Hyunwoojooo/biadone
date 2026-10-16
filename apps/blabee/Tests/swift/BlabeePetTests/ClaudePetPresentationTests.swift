import AppKit
import Foundation
import SwiftUI
import Testing
import Vision
@testable import BlabeeCoordinator

@Suite("Claude shared Pet presentation", .petLanguage(.korean))
@MainActor
struct ClaudePetPresentationTests {
    @Test("Shared buttons require native readiness and Stop; a model result keeps the next card")
    func buttonRoundTrip() async throws {
        let fixture = try ClaudePetFixture()
        try fixture.prompt()
        try fixture.open()
        try fixture.emit()
        let model = makeClaudePetViewModel(transport: fixture.transport, opener: PetFakeApplicationOpener())
        defer { model.stopPolling() }
        await model.refresh()
        let original = try #require(model.displayInteraction)
        #expect(!model.canRequestPanelSelection(original.identity))
        #expect(model.presentationTitle == "연결 확인 필요")
        #expect(!model.supportsProductSettings && model.supportsDecisionDismissal)
        #expect(!model.canSkipDecision(original.identity))
        await model.focusAndRequestPanelSelection(1, interaction: original.identity)
        #expect(model.snapshot?.routing.inFlightCount == 0)

        try fixture.ready()
        await model.refresh()
        #expect(!model.canRequestPanelSelection(original.identity))
        try fixture.stop()
        await model.refresh()
        #expect(model.canRequestPanelSelection(original.identity))
        #expect(model.canSkipDecision(original.identity))
        await model.beginOnboarding()
        model.beginShortcutSettings()
        #expect(!model.isShowingSettings)
        await model.focusAndRequestPanelSelection(1, interaction: original.identity)
        #expect(model.displayInteraction == nil)
        #expect(model.snapshot?.providerStatus?.latestOutcome == nil)
        #expect(model.presentationTitle == "선택 결과 대기")
        let event = try #require(try fixture.poll())
        let claimed = try fixture.claim(event)
        let selectionID = try #require(claimed["selection_id"] as? String)
        #expect(UUID(uuidString: selectionID) != nil)
        await model.refresh()
        #expect(model.snapshot?.routing.inFlightCount == 0)
        #expect(model.snapshot?.providerStatus?.pendingReportCount == 1)
        #expect(model.presentationTitle == "선택 결과 대기")

        try fixture.prompt("Next user request")
        try fixture.emit("next")
        try fixture.stop()
        await model.refresh()
        let successor = try #require(model.displayInteraction)
        #expect(successor.identity != original.identity)
        try fixture.complete(selectionID, note: "BLABEE_PET_A_OK")
        await model.refresh()
        #expect(model.displayInteraction?.identity == successor.identity)
        #expect(model.canRequestPanelSelection(successor.identity))
        #expect(model.snapshot?.providerStatus?.latestOutcome?.selectionID == selectionID)
        #expect(model.snapshot?.providerStatus?.latestOutcome?.status == "succeeded")
        #expect(model.snapshot?.providerStatus?.latestOutcome?.summary == "BLABEE_PET_A_OK")
        #expect(model.presentationTitle == "결정 대기")
    }

    @Test("Common view renders Claude choices and accurate model reports", arguments: ["completed", "failed"])
    func commonView(outcome: String) async throws {
        let fixture = try ClaudePetFixture()
        try fixture.prepare()
        let model = makeClaudePetViewModel(transport: fixture.transport, opener: PetFakeApplicationOpener())
        defer { model.stopPolling() }
        await model.refresh()
        let original = try #require(model.displayInteraction)
        await model.focusAndRequestPanelSelection(1, interaction: original.identity)
        let event = try #require(try fixture.poll())
        let claimed = try fixture.claim(event)
        try fixture.complete(try #require(claimed["selection_id"] as? String), outcome: outcome, note: "BLABEE_PET_REPORT")
        await model.refresh()
        #expect(model.presentationTitle == "준비됨")
        try fixture.prompt("Prepare the next card")
        try fixture.emit("next")
        try fixture.stop()
        await model.refresh()
        #expect(model.displayInteraction?.actionChoices.count == 2)
        for dark in [false, true] {
            let host = NSHostingView(rootView: PetRootView(viewModel: model, usesSystemGlassSurface: false)
                .environment(\.colorScheme, dark ? .dark : .light))
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 540),
                                  styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = host
            host.frame = NSRect(x: 0, y: 0, width: 460, height: 540)
            defer { window.contentView = nil; window.close() }
            try await Task.sleep(for: .milliseconds(150))
            host.layoutSubtreeIfNeeded()
            host.displayIfNeeded()
            let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.cacheDisplay(in: host.bounds, to: bitmap)
            let image = try #require(bitmap.cgImage)
            let request = VNRecognizeTextRequest()
            request.recognitionLanguages = ["ko-KR", "en-US"]
            request.recognitionLevel = .accurate
            try VNImageRequestHandler(cgImage: image).perform([request])
            let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
            #expect(text.lowercased().contains("claude"), "Rendered copy: \(text)")
            #expect(!text.contains("Codex"))
            #expect(text.filter { !$0.isWhitespace }.contains("선택건너뛰기"), "Rendered copy: \(text)")
            #expect(!text.contains("사용 불가"))
            let normalized = text.filter { !$0.isWhitespace }
            #expect(normalized.contains(outcome == "completed" ? "완료보고" : "실패보고"), "Rendered copy: \(text)")
            if let path = ProcessInfo.processInfo.environment["BLABEE_CLAUDE_PET_ARTIFACTS"] {
                let directory = URL(fileURLWithPath: path)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try bitmap.representation(using: .png, properties: [:])?.write(
                    to: directory.appendingPathComponent("claude-\(outcome)-\(dark ? "dark" : "light").png"))
            }
        }
    }

    @Test("Skipping a ready Claude card closes it without delivery and accepts a later independent card")
    func skipRoundTrip() async throws {
        let fixture = try ClaudePetFixture()
        try fixture.prepare()
        let opener = PetFakeApplicationOpener()
        let model = makeClaudePetViewModel(transport: fixture.transport, opener: opener)
        defer { model.stopPolling() }
        await model.refresh()
        let identity = try #require(model.displayInteraction?.identity)
        #expect(model.canSkipDecision(identity))

        await model.skipDecision(for: identity)

        #expect(model.lastError == nil && model.displayInteraction == nil)
        #expect(model.selectionSubmission == nil && model.lastTerminalPresentation == nil)
        #expect(model.snapshot?.routing.inFlightCount == 0)
        #expect(model.snapshot?.providerStatus?.pendingReportCount == 0)
        #expect(try fixture.poll() == nil)
        #expect(opener.opened.isEmpty)
        try fixture.prompt("A new user request after skipping")
        try fixture.emit("successor")
        try fixture.stop()
        await model.refresh()
        let next = try #require(model.displayInteraction?.identity)
        #expect(next != identity && model.canSkipDecision(next))
        await model.skipDecision(for: identity)
        #expect(model.displayInteraction?.identity == next)
        #expect(try fixture.poll() == nil)
    }
}
