import AppKit
import Combine
import SwiftUI

/// An ordinary key-capable window is required for editing and pasting text.
/// The floating PetPanel intentionally cannot become key.
@MainActor
final class PetFeedbackWindowController: NSWindowController, NSWindowDelegate {
    let controller: PetFeedbackController
    var onVisibilityChanged: ((Bool) -> Void)?
    private var visibility = false
    private var openingTask: Task<Void, Never>?
    private var editorResetObservation: AnyCancellable?

    init(controller: PetFeedbackController) {
        self.controller = controller
        super.init(window: nil)
        editorResetObservation = controller.$editingSessionID.sink { [weak self] _ in
            self?.window?.undoManager?.removeAllActions()
        }
    }
    required init?(coder: NSCoder) { nil }

    func show(suggestion: String? = nil) {
        if window == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 800),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
            window.title = "Blabee 피드백"
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
        setVisibility(true)
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
        setVisibility(false)
    }
    func windowWillClose(_ notification: Notification) {
        openingTask?.cancel(); openingTask = nil
        controller.close()
        setVisibility(false)
    }
    func windowDidMiniaturize(_ notification: Notification) { setVisibility(false) }
    func windowDidDeminiaturize(_ notification: Notification) { setVisibility(true) }

    private func setVisibility(_ visible: Bool) {
        guard visibility != visible else { return }
        visibility = visible
        onVisibilityChanged?(visible)
    }
}
