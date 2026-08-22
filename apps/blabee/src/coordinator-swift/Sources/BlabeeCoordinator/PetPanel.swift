import AppKit
import SwiftUI

struct PetPanelPolicy {
    static let styleMask: NSWindow.StyleMask = [.borderless, .nonactivatingPanel]
    static let collectionBehavior: NSWindow.CollectionBehavior = [
        .canJoinAllSpaces,
        .fullScreenAuxiliary,
        .ignoresCycle,
    ]
    static let level: NSWindow.Level = .floating
    static let hidesOnDeactivate = false
    static let activatesApplication = false
    static let canBecomeKey = false
    static let canBecomeMain = false
}

enum PetFrameClamp {
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

    static func lowerTrailingFrame(
        size: CGSize,
        in visibleFrame: CGRect,
        margin: CGFloat = 20
    ) -> CGRect {
        clamp(
            CGRect(
                x: visibleFrame.maxX - size.width - margin,
                y: visibleFrame.minY + margin,
                width: size.width,
                height: size.height
            ),
            to: visibleFrame
        )
    }
}

struct PetDisplayGeometry: Sendable, Equatable {
    let id: Int
    let frame: CGRect
    let visibleFrame: CGRect
}

enum PetDisplaySelection {
    static func preferred(
        displays: [PetDisplayGeometry],
        mouseLocation: CGPoint,
        activeDisplayID: Int?,
        stableDisplayID: Int?
    ) -> PetDisplayGeometry? {
        if let stableDisplayID,
           let stable = displays.first(where: { $0.id == stableDisplayID })
        {
            return stable
        }
        if let underMouse = displays.first(where: { $0.frame.contains(mouseLocation) }) {
            return underMouse
        }
        if let activeDisplayID,
           let active = displays.first(where: { $0.id == activeDisplayID })
        {
            return active
        }
        return displays.first
    }
}

final class PetNonactivatingPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class PetPanelController: NSObject, NSWindowDelegate {
    static let collapsedSize = CGSize(width: 92, height: 92)
    static let expandedSize = CGSize(width: 440, height: 620)

    let panel: PetNonactivatingPanel
    private let viewModel: PetViewModel
    private var screenObserver: NSObjectProtocol?
    private var lastScreenID: Int?

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        panel = PetNonactivatingPanel(
            contentRect: CGRect(origin: .zero, size: Self.collapsedSize),
            styleMask: PetPanelPolicy.styleMask,
            backing: .buffered,
            defer: false
        )
        super.init()
        configurePanel()
        panel.delegate = self
        panel.contentView = NSHostingView(rootView: PetRootView(viewModel: viewModel))
        placeInitially()
        viewModel.onExpansionChanged = { [weak self] expanded in
            self?.resize(expanded: expanded)
        }
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.screenParametersChanged() }
        }
    }

    func showWithoutActivation() {
        panel.orderFrontRegardless()
    }

    func stopObservingScreenChanges() {
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        screenObserver = nil
    }

    func windowDidMove(_ notification: Notification) {
        if let screen = panel.screen {
            lastScreenID = Self.screenID(screen)
        }
    }

    private func configurePanel() {
        panel.level = PetPanelPolicy.level
        panel.collectionBehavior = PetPanelPolicy.collectionBehavior
        panel.hidesOnDeactivate = PetPanelPolicy.hidesOnDeactivate
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.isReleasedWhenClosed = false
        panel.hasShadow = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.animationBehavior = .utilityWindow
    }

    private func placeInitially() {
        guard let display = preferredDisplay(stable: false) else { return }
        lastScreenID = display.id
        panel.setFrame(
            PetFrameClamp.lowerTrailingFrame(size: Self.collapsedSize, in: display.visibleFrame),
            display: false
        )
    }

    private func resize(expanded: Bool) {
        guard let display = preferredDisplay(stable: true) else { return }
        lastScreenID = display.id
        let size = expanded ? Self.expandedSize : Self.collapsedSize
        let current = panel.frame
        let proposed = CGRect(
            x: current.maxX - size.width,
            y: current.maxY - size.height,
            width: size.width,
            height: size.height
        )
        panel.setFrame(PetFrameClamp.clamp(proposed, to: display.visibleFrame), display: true)
        panel.orderFrontRegardless()
    }

    private func screenParametersChanged() {
        guard let display = preferredDisplay(stable: true) else { return }
        lastScreenID = display.id
        panel.setFrame(PetFrameClamp.clamp(panel.frame, to: display.visibleFrame), display: true)
        panel.orderFrontRegardless()
    }

    private func preferredDisplay(stable: Bool) -> PetDisplayGeometry? {
        let screens = NSScreen.screens
        let displays = screens.compactMap(Self.geometry)
        let activeID = NSScreen.main.flatMap(Self.screenID)
        return PetDisplaySelection.preferred(
            displays: displays,
            mouseLocation: NSEvent.mouseLocation,
            activeDisplayID: activeID,
            stableDisplayID: stable ? lastScreenID : nil
        )
    }

    private static func geometry(_ screen: NSScreen) -> PetDisplayGeometry? {
        guard let id = screenID(screen) else { return nil }
        return PetDisplayGeometry(id: id, frame: screen.frame, visibleFrame: screen.visibleFrame)
    }

    private static func screenID(_ screen: NSScreen) -> Int? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
    }

}
