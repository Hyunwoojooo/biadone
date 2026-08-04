import AppKit
import SwiftUI

@MainActor
final class LauncherPanelController {
    private let viewModel: LauncherViewModel
    private let panel: LauncherPanel

    init(
        viewModel: LauncherViewModel,
        openSettings: @escaping () -> Void
    ) {
        self.viewModel = viewModel
        panel = LauncherPanel(
            contentRect: NSRect(x: 0, y: 0, width: 680, height: 430),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.contentViewController = NSHostingController(
            rootView: LauncherView(
                viewModel: viewModel,
                openSettings: openSettings
            )
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.hidesOnDeactivate = true
        panel.collectionBehavior = [
            .fullScreenAuxiliary,
            .transient,
            .moveToActiveSpace
        ]
        panel.animationBehavior = .utilityWindow
    }

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    func show(loadsAttention: Bool = true) {
        positionOnActiveScreen()
        NSApplication.shared.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        if loadsAttention {
            viewModel.load(refresh: false)
        }
    }

    func hide() {
        panel.orderOut(nil)
    }

    private func positionOnActiveScreen() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main
            ?? NSScreen.screens.first
        guard let visibleFrame = screen?.visibleFrame else {
            panel.center()
            return
        }
        let origin = NSPoint(
            x: visibleFrame.midX - panel.frame.width / 2,
            y: visibleFrame.midY - panel.frame.height / 2 + 60
        )
        panel.setFrameOrigin(origin)
    }
}

private final class LauncherPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        orderOut(sender)
    }
}
