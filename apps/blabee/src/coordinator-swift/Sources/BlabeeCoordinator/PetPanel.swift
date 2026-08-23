import AppKit
import Combine
import SwiftUI

struct PetPanelPolicy {
    static let styleMask: NSWindow.StyleMask = [.borderless, .nonactivatingPanel]
    static let collectionBehavior: NSWindow.CollectionBehavior = [
        .canJoinAllSpaces,
        .fullScreenAuxiliary,
        .ignoresCycle,
    ]
    static let level: NSWindow.Level = .popUpMenu
    static let hidesOnDeactivate = false
    static let activatesApplication = false
    static let canBecomeKey = false
    static let canBecomeMain = false
}

enum PetStatusItemMetrics {
    static let statusItemLength: CGFloat = 32
    static let panelSize = CGSize(width: 420, height: 346)
}

enum PetStatusPanelPlacement {
    static func clamp(_ frame: CGRect, to visibleFrame: CGRect) -> CGRect {
        guard visibleFrame.width > 0, visibleFrame.height > 0 else { return frame }
        let width = min(max(frame.width, 1), visibleFrame.width)
        let height = min(max(frame.height, 1), visibleFrame.height)
        let maximumX = visibleFrame.maxX - width
        let maximumY = visibleFrame.maxY - height
        return CGRect(
            x: min(max(frame.minX, visibleFrame.minX), maximumX),
            y: min(max(frame.minY, visibleFrame.minY), maximumY),
            width: width,
            height: height
        )
    }

    static func frame(
        size: CGSize,
        below statusItemFrame: CGRect,
        in visibleFrame: CGRect
    ) -> CGRect {
        clamp(
            CGRect(
                x: statusItemFrame.midX - (size.width / 2),
                y: statusItemFrame.minY - size.height,
                width: size.width,
                height: size.height
            ),
            to: visibleFrame
        )
    }
}

final class PetNonactivatingPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class PetPassThroughHostingView<Content: View>: NSHostingView<Content> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

@MainActor
final class PetPanelController: NSObject, NSWindowDelegate {
    static let panelSize = PetStatusItemMetrics.panelSize
    static let statusItemLength = PetStatusItemMetrics.statusItemLength

    let panel: PetNonactivatingPanel
    let statusItem: NSStatusItem

    private let viewModel: PetViewModel
    private let statusBar: NSStatusBar
    private var screenObserver: NSObjectProtocol?
    private var statusHostingView: NSView?
    private var cancellables: Set<AnyCancellable> = []

    init(
        viewModel: PetViewModel,
        assets: PetAssetCatalog,
        statusBar: NSStatusBar = .system
    ) {
        self.viewModel = viewModel
        self.statusBar = statusBar
        statusItem = statusBar.statusItem(withLength: Self.statusItemLength)
        panel = PetNonactivatingPanel(
            contentRect: CGRect(origin: .zero, size: Self.panelSize),
            styleMask: PetPanelPolicy.styleMask,
            backing: .buffered,
            defer: false
        )
        super.init()
        configureStatusItem(assets: assets)
        configurePanel(assets: assets)
        panel.delegate = self

        viewModel.onExpansionChanged = { [weak self] expanded in
            guard let self else { return }
            if expanded {
                self.showPanel(animated: true)
            } else {
                self.hidePanel()
            }
        }
        viewModel.objectWillChange
            .sink { [weak self] _ in
                DispatchQueue.main.async { self?.refreshStatusItemAccessibility() }
            }
            .store(in: &cancellables)

        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.screenParametersChanged() }
        }
    }

    func showWithoutActivation() {
        refreshStatusItemAccessibility()
        if viewModel.isExpanded {
            showPanel(animated: false)
        } else {
            panel.orderOut(nil)
        }
    }

    func stopObservingScreenChanges() {
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        screenObserver = nil
        cancellables.removeAll()
        statusBar.removeStatusItem(statusItem)
        panel.orderOut(nil)
    }

    @objc private func togglePanel() {
        viewModel.toggleExpanded()
    }

    private func configureStatusItem(assets: PetAssetCatalog) {
        guard let button = statusItem.button else { return }
        button.image = nil
        button.title = ""
        button.target = self
        button.action = #selector(togglePanel)
        button.sendAction(on: [.leftMouseUp])
        button.setAccessibilityRole(.button)

        let hostingView = PetPassThroughHostingView(
            rootView: PetStatusItemView(viewModel: viewModel, assets: assets)
                .allowsHitTesting(false)
        )
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        hostingView.wantsLayer = true
        button.addSubview(hostingView)
        NSLayoutConstraint.activate([
            hostingView.centerXAnchor.constraint(equalTo: button.centerXAnchor),
            hostingView.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            hostingView.widthAnchor.constraint(equalToConstant: Self.statusItemLength),
            hostingView.heightAnchor.constraint(equalToConstant: Self.statusItemLength),
        ])
        statusHostingView = hostingView
    }

    private func configurePanel(assets: PetAssetCatalog) {
        panel.level = PetPanelPolicy.level
        panel.collectionBehavior = PetPanelPolicy.collectionBehavior
        panel.hidesOnDeactivate = PetPanelPolicy.hidesOnDeactivate
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = false
        panel.isReleasedWhenClosed = false
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.animationBehavior = .none
        panel.contentView = NSHostingView(
            rootView: PetRootView(viewModel: viewModel, assets: assets)
        )
    }

    private func showPanel(animated: Bool) {
        guard let placement = currentPlacement() else {
            DispatchQueue.main.async { [weak self] in
                guard self?.viewModel.isExpanded == true else { return }
                self?.showPanel(animated: animated)
            }
            return
        }

        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let shouldAnimate = animated && !reduceMotion
        if shouldAnimate {
            var startFrame = placement
            startFrame.origin.y += 8
            panel.setFrame(startFrame, display: false)
            panel.alphaValue = 0
            panel.orderFrontRegardless()
            pulseStatusItem()
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.24
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().setFrame(placement, display: true)
                panel.animator().alphaValue = 1
            }
        } else {
            panel.setFrame(placement, display: true)
            panel.alphaValue = 1
            panel.orderFrontRegardless()
        }
    }

    private func hidePanel() {
        panel.orderOut(nil)
        panel.alphaValue = 1
    }

    private func currentPlacement() -> CGRect? {
        guard let button = statusItem.button,
              let window = button.window,
              let screen = window.screen
        else { return nil }
        let frameInWindow = button.convert(button.bounds, to: nil)
        let frameOnScreen = window.convertToScreen(frameInWindow)
        return PetStatusPanelPlacement.frame(
            size: Self.panelSize,
            below: frameOnScreen,
            in: screen.visibleFrame
        )
    }

    private func screenParametersChanged() {
        guard viewModel.isExpanded, let placement = currentPlacement() else { return }
        panel.setFrame(placement, display: true)
        panel.orderFrontRegardless()
    }

    private func pulseStatusItem() {
        guard let layer = statusHostingView?.layer else { return }
        let animation = CAKeyframeAnimation(keyPath: "transform.scale")
        animation.values = [1.0, 1.06, 1.0]
        animation.keyTimes = [0, 0.55, 1]
        animation.duration = 0.28
        animation.timingFunctions = [
            CAMediaTimingFunction(name: .easeOut),
            CAMediaTimingFunction(name: .easeOut),
        ]
        layer.add(animation, forKey: "blabee-status-pulse")
    }

    private func refreshStatusItemAccessibility() {
        guard let button = statusItem.button else { return }
        let state = viewModel.presentationState.displayTitle
        let pendingCount = viewModel.snapshotInteractions.count
        button.setAccessibilityLabel("Blabee")
        button.setAccessibilityValue("\(state), 대기 카드 \(pendingCount)개")
        button.toolTip = "Blabee · \(state)"
    }
}
