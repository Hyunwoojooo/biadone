import AppKit
import SwiftUI

/// A normal key-capable window permits OAuth presentation and keyboard navigation.
/// Closing the unfinished wizard is handled by its application owner; it never
/// marks onboarding complete by itself.
@MainActor
final class PetFirstRunWindowController: NSWindowController, NSWindowDelegate {
    private let controller: PetFirstRunController
    private let viewModel: PetViewModel
    private let preferences: PetFirstRunPreferences
    var onFinish: ((_ connectionDeferred: Bool) -> Void)?
    var onClose: (() -> Void)?
    private var dismissingAfterCompletion = false

    init(controller: PetFirstRunController, viewModel: PetViewModel, preferences: PetFirstRunPreferences) {
        self.controller = controller
        self.viewModel = viewModel
        self.preferences = preferences
        super.init(window: nil)
    }

    required init?(coder: NSCoder) { nil }

    func show() {
        if window == nil {
            let available = NSScreen.main?.visibleFrame.size ?? NSSize(width: 900, height: 800)
            let size = Self.contentSize(available: available)
            let window = NSWindow(
                contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered, defer: false
            )
            window.title = PetL10n.text("Get Started with Blabee", korean: "Blabee 시작하기")
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.isReleasedWhenClosed = false
            window.isOpaque = false
            window.backgroundColor = .clear
            window.minSize = NSSize(width: min(460, size.width), height: min(550, size.height))
            window.standardWindowButton(.closeButton)?.isHidden = true
            window.standardWindowButton(.miniaturizeButton)?.isHidden = true
            window.standardWindowButton(.zoomButton)?.isHidden = true
            window.contentView = NSHostingView(rootView: PetFirstRunView(
                controller: controller, viewModel: viewModel, preferences: preferences,
                onFinish: { [weak self] deferred in self?.onFinish?(deferred) },
                onClose: { [weak self] in self?.window?.performClose(nil) }
            ))
            window.delegate = self
            window.center()
            self.window = window
        }
        preferences.applyAppearance()
        window?.deminiaturize(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func closeAfterCompletion() {
        dismissingAfterCompletion = true
        close()
    }

    func windowWillClose(_ notification: Notification) {
        if !dismissingAfterCompletion { onClose?() }
    }

    static func contentSize(available: NSSize) -> NSSize {
        NSSize(width: max(1, min(590, available.width - 32)),
               height: max(1, min(720, available.height - 32)))
    }
}
