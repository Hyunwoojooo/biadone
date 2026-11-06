import AppKit
import Combine
import SwiftUI

/// An ordinary key-capable window is required for editing and pasting text.
/// The floating PetPanel intentionally cannot become key.
@MainActor
final class PetFeedbackWindowController: NSWindowController, NSWindowDelegate {
    struct InputState {
        var isVisible: Bool
        var isMiniaturized: Bool
        var isKeyWindow: Bool
        var isApplicationActive: Bool
    }

    let controller: PetFeedbackController
    var onShortcutSuppressionChanged: ((Bool) -> Void)?
    private let inputState: @MainActor (NSWindow?) -> InputState
    private var shortcutsSuppressed = false
    private var openingTask: Task<Void, Never>?
    private var editorResetObservation: AnyCancellable?
    private var applicationFocusObservation: AnyCancellable?
    private var languageObservation: AnyCancellable?

    init(controller: PetFeedbackController, notificationCenter: NotificationCenter = .default,
         inputState: @escaping @MainActor (NSWindow?) -> InputState = { window in
             .init(isVisible: window?.isVisible == true,
                   isMiniaturized: window?.isMiniaturized == true,
                   isKeyWindow: window?.isKeyWindow == true,
                   isApplicationActive: NSApplication.shared.isActive)
         }) {
        self.controller = controller
        self.inputState = inputState
        super.init(window: nil)
        languageObservation = PetLocalization.shared.$language.dropFirst().sink { [weak self] _ in
            self?.window?.title = PetL10n.text("Blabee Feedback", korean: "Blabee 피드백")
        }
        editorResetObservation = controller.$editingSessionID.sink { [weak self] _ in
            self?.window?.undoManager?.removeAllActions()
        }
        applicationFocusObservation = notificationCenter.publisher(for: NSApplication.didBecomeActiveNotification)
            .merge(with: notificationCenter.publisher(for: NSApplication.didResignActiveNotification))
            .sink { [weak self] _ in self?.refreshShortcutSuppression() }
    }
    required init?(coder: NSCoder) { nil }

    func show(suggestion: String? = nil) {
        if window == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 800),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
            window.title = PetL10n.text("Blabee Feedback", korean: "Blabee 피드백")
            window.minSize = NSSize(width: 600, height: 620)
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: PetFeedbackView(controller: controller))
            window.delegate = self
            window.center()
            self.window = window
        }
        controller.accountStateChanged()
        if let suggestion { controller.offerSuggestion(suggestion) }
        window?.deminiaturize(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        refreshShortcutSuppression()
        openingTask?.cancel()
        openingTask = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await controller.refreshHistory()
        }
    }

    override func close() {
        openingTask?.cancel(); openingTask = nil
        controller.close()
        super.close()
        setShortcutSuppression(false)
    }
    func windowWillClose(_ notification: Notification) {
        openingTask?.cancel(); openingTask = nil
        controller.close()
        setShortcutSuppression(false)
    }
    func windowDidBecomeKey(_ notification: Notification) { refreshShortcutSuppression() }
    func windowDidResignKey(_ notification: Notification) { refreshShortcutSuppression() }
    func windowDidMiniaturize(_ notification: Notification) { refreshShortcutSuppression() }
    func windowDidDeminiaturize(_ notification: Notification) { refreshShortcutSuppression() }

    private func refreshShortcutSuppression() {
        let state = inputState(window)
        setShortcutSuppression(state.isVisible && !state.isMiniaturized
            && state.isKeyWindow && state.isApplicationActive)
    }

    private func setShortcutSuppression(_ suppressed: Bool) {
        guard shortcutsSuppressed != suppressed else { return }
        shortcutsSuppressed = suppressed
        onShortcutSuppressionChanged?(suppressed)
    }
}
