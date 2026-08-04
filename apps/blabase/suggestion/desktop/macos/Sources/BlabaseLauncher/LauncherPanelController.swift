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
            contentRect: NSRect(
                x: 0,
                y: 0,
                width: LauncherVisualTokens.panelWidth,
                height: LauncherVisualTokens.panelHeight
            ),
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
        panel.cancelHandler = { [weak viewModel] in
            viewModel?.handleCancel() ?? false
        }
    }

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    func show(loadsAttention: Bool = true) {
        viewModel.prepareForPresentation()
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
        let preferredX = visibleFrame.midX - panel.frame.width / 2
        let preferredY = visibleFrame.midY - panel.frame.height / 2 + 60
        let maximumX = max(
            visibleFrame.minX,
            visibleFrame.maxX - panel.frame.width
        )
        let maximumY = max(
            visibleFrame.minY,
            visibleFrame.maxY - panel.frame.height
        )
        let origin = NSPoint(
            x: min(max(preferredX, visibleFrame.minX), maximumX),
            y: min(max(preferredY, visibleFrame.minY), maximumY)
        )
        panel.setFrameOrigin(origin)
    }
}

private final class LauncherPanel: NSPanel {
    var cancelHandler: (() -> Bool)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        if cancelHandler?() == true { return }
        orderOut(sender)
    }
}
