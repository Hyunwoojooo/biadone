import AppKit
import SwiftUI

@MainActor
final class LauncherPanelController: NSObject {
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
        super.init()
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
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [
            .fullScreenAuxiliary,
            .transient,
            .moveToActiveSpace
        ]
        panel.animationBehavior = .utilityWindow
        panel.cancelHandler = { [weak self, weak viewModel] in
            if viewModel?.handleCancel() == true { return true }
            self?.hide()
            return true
        }
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidResignActive),
            name: NSApplication.didResignActiveNotification,
            object: NSApplication.shared
        )
    }

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    func show(loadsAttention: Bool = true) {
        viewModel.prepareForPresentation()
        positionOnActiveScreen()
        LauncherWindowPresenter.shared.present(panel)
        if loadsAttention {
            viewModel.load(refresh: false)
        }
    }

    func hide() {
        LauncherWindowPresenter.shared.cancel(panel)
        panel.orderOut(nil)
    }

    @objc private func applicationDidResignActive(_ notification: Notification) {
        hide()
    }

    private func positionOnActiveScreen() {
        let contentSize = NSSize(
            width: LauncherVisualTokens.panelWidth,
            height: LauncherVisualTokens.panelHeight
        )
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main
            ?? NSScreen.screens.first
        guard let visibleFrame = screen?.visibleFrame else {
            panel.setContentSize(contentSize)
            panel.center()
            return
        }
        panel.setFrame(
            LauncherPanelPositioning.positionedFrame(
                currentFrame: panel.frame,
                contentSize: contentSize,
                visibleFrame: visibleFrame
            ),
            display: false
        )
    }
}

enum LauncherPanelPositioning {
    static func positionedFrame(
        currentFrame: NSRect,
        contentSize: NSSize,
        visibleFrame: NSRect
    ) -> NSRect {
        var frame = currentFrame
        frame.size = contentSize
        let preferredX = visibleFrame.midX - contentSize.width / 2
        let preferredY = visibleFrame.midY - contentSize.height / 2 + 60
        let maximumX = max(
            visibleFrame.minX,
            visibleFrame.maxX - contentSize.width
        )
        let maximumY = max(
            visibleFrame.minY,
            visibleFrame.maxY - contentSize.height
        )
        frame.origin = NSPoint(
            x: min(max(preferredX, visibleFrame.minX), maximumX),
            y: min(max(preferredY, visibleFrame.minY), maximumY)
        )
        return frame
    }
}

@MainActor
final class LauncherWindowPresenter: NSObject {
    static let shared = LauncherWindowPresenter(
        applicationIsActive: { NSApplication.shared.isActive },
        activateApplication: {
            if #available(macOS 14.0, *) {
                NSApplication.shared.activate()
            } else {
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
        },
        observesApplicationActivation: true
    )

    private struct PendingPresentation {
        let id: ObjectIdentifier
        let makeKey: () -> Void
    }

    private let applicationIsActive: () -> Bool
    private let activateApplication: () -> Void
    private var pendingPresentation: PendingPresentation?

    init(
        applicationIsActive: @escaping () -> Bool,
        activateApplication: @escaping () -> Void,
        observesApplicationActivation: Bool = false
    ) {
        self.applicationIsActive = applicationIsActive
        self.activateApplication = activateApplication
        super.init()
        if observesApplicationActivation {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(handleApplicationDidBecomeActive),
                name: NSApplication.didBecomeActiveNotification,
                object: NSApplication.shared
            )
        }
    }

    func present(_ window: NSWindow) {
        present(
            id: ObjectIdentifier(window),
            orderFrontRegardless: { window.orderFrontRegardless() },
            makeKey: { [weak window] in
                guard let window, window.isVisible else { return }
                window.makeKey()
            }
        )
    }

    func present(
        id: ObjectIdentifier,
        orderFrontRegardless: () -> Void,
        makeKey: @escaping () -> Void
    ) {
        orderFrontRegardless()
        pendingPresentation = nil
        if applicationIsActive() {
            makeKey()
            return
        }
        pendingPresentation = PendingPresentation(id: id, makeKey: makeKey)
        activateApplication()
    }

    func cancel(_ window: NSWindow) {
        cancel(id: ObjectIdentifier(window))
    }

    func cancel(id: ObjectIdentifier) {
        guard pendingPresentation?.id == id else { return }
        pendingPresentation = nil
    }

    func applicationDidBecomeActive() {
        guard applicationIsActive(), let pendingPresentation else { return }
        self.pendingPresentation = nil
        pendingPresentation.makeKey()
    }

    @objc private func handleApplicationDidBecomeActive(
        _ notification: Notification
    ) {
        applicationDidBecomeActive()
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
