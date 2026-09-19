import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Manual feedback views") @MainActor
struct PetFeedbackViewTests {
    @Test("editor and redacted review render at minimum and standard window sizes")
    func renderEditorAndReview() throws {
        if let directory = ProcessInfo.processInfo.environment["BLABEE_FEEDBACK_RENDER_DIRECTORY"] {
            try FileManager.default.createDirectory(at: URL(fileURLWithPath: directory, isDirectory: true),
                                                     withIntermediateDirectories: true)
        }
        let controller = PetFeedbackController(service: FeedbackRenderService(), authorization: {
            .init(userID: "00000000-0000-0000-0000-000000000001", accessToken: "test-only-token",
                  expiresAt: Date().addingTimeInterval(3_600))
        }, environment: .init(appVersion: "0.1.0", appBuild: "55", osMajor: "15", uiLanguage: .ko))
        defer { controller.stop() }
        for review in [false, true] {
            controller.close()
            controller.draft.rating = .helpful
            controller.draft.reason = .nextStepClear
            controller.draft.usePurpose = .development
            controller.draft.note = "다음 할 일을 바로 확인할 수 있어서 편했습니다. person@example.com"
            if review { controller.preparePreview() }
            for size in [NSSize(width: 600, height: 620), NSSize(width: 720, height: 800)] {
                for dark in [false, true] {
                    let view = PetFeedbackView(controller: controller)
                        .frame(width: size.width, height: size.height)
                        .environment(\.colorScheme, dark ? .dark : .light)
                    let host = NSHostingView(rootView: view)
                    host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                    host.frame = NSRect(origin: .zero, size: size)
                    host.layoutSubtreeIfNeeded()
                    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.effectiveAppearance.performAsCurrentDrawingAppearance {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                    }
                    #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                    #expect(!controller.isSubmitting)
                    if let directory = ProcessInfo.processInfo.environment["BLABEE_FEEDBACK_RENDER_DIRECTORY"] {
                        let bytes = try #require(bitmap.representation(using: .png, properties: [:]))
                        try bytes.write(to: URL(fileURLWithPath: directory, isDirectory: true)
                            .appendingPathComponent("feedback-\(review ? "review" : "editor")-\(Int(size.width))-\(dark ? "dark" : "light").png"))
                    }
                }
            }
        }
    }
}

@MainActor
private struct FeedbackRenderService: PetFeedbackServing {
    func submit(_ payload: PetFeedbackPayload, authorization: PetUsageAuthorization) async throws -> UUID {
        Issue.record("Rendering must not submit feedback")
        throw PetFeedbackError.invalidInput
    }
    func list(authorization: PetUsageAuthorization) async throws -> [PetFeedbackSummary] {
        Issue.record("Rendering must not load feedback")
        return []
    }
    func delete(_ submissionID: UUID, authorization: PetUsageAuthorization) async throws {
        Issue.record("Rendering must not delete feedback")
    }
}
