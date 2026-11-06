import AppKit
import Testing
@testable import BlabeeCoordinator

@Suite("Manual feedback window shortcut suppression", .petLanguage(.korean)) @MainActor
struct PetFeedbackWindowTests {
    @Test("only the key feedback window suppresses shortcuts and duplicate events are ignored")
    func keyWindowTransitions() {
        let f = FeedbackWindowFixture(); defer { f.feedback.stop() }
        f.state.value.isKeyWindow = false
        f.window.windowDidResignKey(.init(name: NSWindow.didResignKeyNotification))
        #expect(f.suppressionChanges.isEmpty)

        f.state.value.isKeyWindow = true
        f.window.windowDidBecomeKey(.init(name: NSWindow.didBecomeKeyNotification))
        f.window.windowDidBecomeKey(.init(name: NSWindow.didBecomeKeyNotification))
        #expect(f.suppressionChanges == [true])

        f.state.value.isKeyWindow = false
        f.window.windowDidResignKey(.init(name: NSWindow.didResignKeyNotification))
        f.window.windowDidResignKey(.init(name: NSWindow.didResignKeyNotification))
        #expect(f.suppressionChanges == [true, false])

        f.state.value.isKeyWindow = true
        f.window.windowDidBecomeKey(.init(name: NSWindow.didBecomeKeyNotification))
        #expect(f.suppressionChanges == [true, false, true])
        #expect(f.window.window == nil)
    }

    @Test("switching applications releases shortcuts without closing feedback or clearing the draft")
    func applicationFocusTransitionsPreserveDraft() {
        let f = FeedbackWindowFixture(); defer { f.feedback.stop() }
        f.feedback.draft.note = "작성 중인 피드백"
        f.feedback.offerSuggestion("포함할 제안")
        let editingSessionID = f.feedback.editingSessionID
        f.window.windowDidBecomeKey(.init(name: NSWindow.didBecomeKeyNotification))

        // A background application's window can retain its key-window state.
        f.state.value.isApplicationActive = false
        f.notifications.post(name: NSApplication.didResignActiveNotification, object: nil)
        #expect(f.suppressionChanges == [true, false])
        #expect(f.state.value.isVisible && f.state.value.isKeyWindow)
        #expect(f.feedback.draft.note == "작성 중인 피드백")
        #expect(f.feedback.suggestedContent == "포함할 제안")
        #expect(f.feedback.editingSessionID == editingSessionID)

        f.state.value.isApplicationActive = true
        f.notifications.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        f.notifications.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        #expect(f.suppressionChanges == [true, false, true])
        #expect(f.feedback.draft.note == "작성 중인 피드백")
        #expect(f.feedback.editingSessionID == editingSessionID)
    }

    @Test("minimizing and restoring require visible key focus before suppressing shortcuts again")
    func minimizeAndVisibilityTransitions() {
        let f = FeedbackWindowFixture(); defer { f.feedback.stop() }
        f.feedback.draft.note = "최소화해도 유지"
        let editingSessionID = f.feedback.editingSessionID
        f.window.windowDidBecomeKey(.init(name: NSWindow.didBecomeKeyNotification))

        f.state.value.isMiniaturized = true
        f.window.windowDidMiniaturize(.init(name: NSWindow.didMiniaturizeNotification))
        f.notifications.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        #expect(f.suppressionChanges == [true, false])

        f.state.value.isMiniaturized = false
        f.state.value.isKeyWindow = false
        f.window.windowDidDeminiaturize(.init(name: NSWindow.didDeminiaturizeNotification))
        #expect(f.suppressionChanges == [true, false])

        f.state.value.isKeyWindow = true
        f.window.windowDidBecomeKey(.init(name: NSWindow.didBecomeKeyNotification))
        #expect(f.suppressionChanges == [true, false, true])

        f.state.value.isVisible = false
        f.notifications.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        #expect(f.suppressionChanges == [true, false, true, false])
        #expect(f.feedback.draft.note == "최소화해도 유지")
        #expect(f.feedback.editingSessionID == editingSessionID)
    }

    @Test("closing releases shortcuts immediately and retains the existing draft reset", arguments: [false, true])
    func closeReleasesSuppression(delegateNotification: Bool) {
        let f = FeedbackWindowFixture(); defer { f.feedback.stop() }
        f.feedback.draft.note = "닫으면 비우기"
        let editingSessionID = f.feedback.editingSessionID
        f.window.windowDidBecomeKey(.init(name: NSWindow.didBecomeKeyNotification))

        // The will-close callback precedes the window's visibility change.
        if delegateNotification {
            f.window.windowWillClose(.init(name: NSWindow.willCloseNotification))
        } else {
            f.window.close()
        }
        #expect(f.suppressionChanges == [true, false])
        #expect(f.feedback.draft == PetFeedbackDraft())
        #expect(f.feedback.editingSessionID != editingSessionID)

        f.state.value.isVisible = false
        f.state.value.isKeyWindow = false
        f.notifications.post(name: NSApplication.didBecomeActiveNotification, object: nil)
        #expect(f.suppressionChanges == [true, false])
        #expect(f.window.window == nil)
    }
}

@MainActor
private final class FeedbackWindowInputState {
    var value = PetFeedbackWindowController.InputState(
        isVisible: true, isMiniaturized: false, isKeyWindow: true, isApplicationActive: true)
}

@MainActor
private final class FeedbackWindowFixture {
    let state = FeedbackWindowInputState()
    let notifications = NotificationCenter()
    let feedback: PetFeedbackController
    let window: PetFeedbackWindowController
    var suppressionChanges: [Bool] = []

    init() {
        feedback = PetFeedbackController(service: FeedbackWindowService(), authorization: { nil },
            environment: .init(appVersion: "0.1.0", appBuild: "55", osMajor: "15", uiLanguage: .ko))
        window = PetFeedbackWindowController(controller: feedback, notificationCenter: notifications,
            inputState: { [state] _ in state.value })
        window.onShortcutSuppressionChanged = { [weak self] in self?.suppressionChanges.append($0) }
    }
}

@MainActor
private struct FeedbackWindowService: PetFeedbackServing {
    func submit(_ payload: PetFeedbackPayload, authorization: PetUsageAuthorization) async throws -> UUID {
        Issue.record("Focus transitions must not submit feedback")
        throw PetFeedbackError.invalidInput
    }
    func list(authorization: PetUsageAuthorization) async throws -> [PetFeedbackSummary] {
        Issue.record("Focus transitions must not load feedback")
        return []
    }
    func delete(_ submissionID: UUID, authorization: PetUsageAuthorization) async throws {
        Issue.record("Focus transitions must not delete feedback")
    }
}
