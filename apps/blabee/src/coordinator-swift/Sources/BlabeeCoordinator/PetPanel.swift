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

struct PetPanelLayoutState: Sendable, Equatable {
    let isExpanded: Bool
    let isEditingShortcuts: Bool
    let isShowingOnboarding: Bool
    let actionCount: Int?
    let fifoQueueCount: Int
    let hasPermissionNotice: Bool
    let hasStatusMessage: Bool
}

enum PetPanelScreenMode: Sendable, Equatable {
    case ready
    case permission
    case decision(actionCount: Int)
    case details
    case shortcutSettings
    case projectSettings
}

enum PetPanelContentPolicy {
    static let projectNameLineLimit = 1
    static let summaryLineLimit = 2
    static let actionTitleLineLimit = 1
    static let disabledReasonLineLimit = 1
    static let statusMessageLineLimit = 2

    static func allowsScrolling(in mode: PetPanelScreenMode) -> Bool {
        switch mode {
        case .details, .projectSettings:
            true
        case .ready, .permission, .decision, .shortcutSettings:
            false
        }
    }
}

enum PetPanelSizePolicy {
    static let width: CGFloat = 460
    static let compactHeight: CGFloat = 240
    static let expandedHeight: CGFloat = 680
    static let minimumDecisionHeight: CGFloat = 300
    static let decisionBaseHeight: CGFloat = 214
    static let actionHeight: CGFloat = 70
    static let fifoQueueHeight: CGFloat = 44
    static let permissionRequestHeight: CGFloat = 520
    static let statusMessageHeight: CGFloat = 48

    static let compactSize = CGSize(width: width, height: compactHeight)
    static let expandedSize = CGSize(width: width, height: expandedHeight)

    static func preferredSize(for state: PetPanelLayoutState) -> CGSize {
        if state.hasPermissionNotice {
            let height = permissionRequestHeight
                + (state.hasStatusMessage ? statusMessageHeight : 0)
            return CGSize(width: width, height: min(height, expandedHeight))
        }

        if state.isEditingShortcuts || state.isShowingOnboarding {
            return expandedSize
        }

        var height: CGFloat
        if let actionCount = state.actionCount {
            if state.isExpanded {
                return expandedSize
            }
            height = max(
                minimumDecisionHeight,
                decisionBaseHeight + CGFloat(max(actionCount, 0)) * actionHeight
            )
            if state.fifoQueueCount > 1 {
                height += fifoQueueHeight
            }
        } else {
            // A stale detail flag must not keep an idle Pet unnecessarily tall.
            height = compactHeight
        }

        if state.hasStatusMessage {
            height += statusMessageHeight
        }
        return CGSize(width: width, height: min(height, expandedHeight))
    }
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

    static func resizedLowerTrailingFrame(
        from currentFrame: CGRect,
        to size: CGSize,
        in visibleFrame: CGRect
    ) -> CGRect {
        clamp(
            CGRect(
                x: currentFrame.maxX - size.width,
                y: currentFrame.minY,
                width: size.width,
                height: size.height
            ),
            to: visibleFrame
        )
    }

    static func belowStatusItemFrame(
        size: CGSize,
        statusItemFrame: CGRect,
        in visibleFrame: CGRect,
        gap: CGFloat = 0
    ) -> CGRect {
        clamp(
            CGRect(
                x: statusItemFrame.midX - (size.width / 2),
                y: statusItemFrame.minY - size.height - gap,
                width: size.width,
                height: size.height
            ),
            to: visibleFrame
        )
    }
}

enum PetPanelDismissalPolicy {
    static func shouldDismiss(
        panelIsVisible: Bool,
        clickLocation: CGPoint,
        panelFrame: CGRect,
        statusItemFrame: CGRect?
    ) -> Bool {
        guard panelIsVisible else { return false }
        guard !panelFrame.contains(clickLocation) else { return false }
        if let statusItemFrame, statusItemFrame.contains(clickLocation) {
            return false
        }
        return true
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
    static let collapsedSize = PetPanelSizePolicy.compactSize
    static let expandedSize = PetPanelSizePolicy.expandedSize

    let panel: PetNonactivatingPanel
    private let viewModel: PetViewModel
    private var lastRequestedSize: CGSize
    private weak var statusItemButton: NSStatusBarButton?
    private var screenObserver: NSObjectProtocol?
    private var localMouseMonitor: Any?
    private var globalMouseMonitor: Any?
    private var lastScreenID: Int?

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        let initialSize = PetPanelSizePolicy.preferredSize(
            for: Self.layoutState(for: viewModel)
        )
        lastRequestedSize = initialSize
        panel = PetNonactivatingPanel(
            contentRect: CGRect(origin: .zero, size: initialSize),
            styleMask: PetPanelPolicy.styleMask,
            backing: .buffered,
            defer: false
        )
        super.init()
        configurePanel()
        panel.delegate = self
        panel.contentView = NSHostingView(rootView: PetRootView(viewModel: viewModel))
        placeInitially()
        viewModel.onPanelLayoutChanged = { [weak self] in
            self?.refreshContentSize()
        }
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.screenParametersChanged() }
        }
    }

    func attach(to statusItemButton: NSStatusBarButton) {
        self.statusItemButton = statusItemButton
        placeAtStatusItem(display: false)
    }

    func showWithoutActivation() {
        placeAtStatusItem(display: false)
        panel.orderFrontRegardless()
        startObservingOutsideClicks()
    }

    func hide() {
        panel.orderOut(nil)
        stopObservingOutsideClicks()
    }

    func toggleVisibility() {
        if panel.isVisible {
            hide()
        } else {
            showWithoutActivation()
        }
    }

    func stopObservingScreenChanges() {
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        screenObserver = nil
        stopObservingOutsideClicks()
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
        placeAtStatusItem(display: false)
    }

    private func refreshContentSize() {
        let requestedSize = preferredSize
        guard requestedSize != lastRequestedSize else { return }
        placeAtStatusItem(display: true)
        if panel.isVisible { panel.orderFrontRegardless() }
    }

    private func screenParametersChanged() {
        placeAtStatusItem(display: true)
        if panel.isVisible { panel.orderFrontRegardless() }
    }

    private func placeAtStatusItem(display: Bool) {
        let size = preferredSize
        lastRequestedSize = size
        if let statusItemFrame = statusItemFrameInScreen(),
           let screen = statusItemButton?.window?.screen
        {
            lastScreenID = Self.screenID(screen)
            panel.setFrame(
                PetFrameClamp.belowStatusItemFrame(
                    size: size,
                    statusItemFrame: statusItemFrame,
                    in: screen.visibleFrame
                ),
                display: display
            )
            return
        }

        guard let targetDisplay = preferredDisplay(stable: true) else { return }
        lastScreenID = targetDisplay.id
        panel.setFrame(
            PetFrameClamp.lowerTrailingFrame(size: size, in: targetDisplay.visibleFrame),
            display: display
        )
    }

    private var preferredSize: CGSize {
        PetPanelSizePolicy.preferredSize(for: Self.layoutState(for: viewModel))
    }

    private static func layoutState(for viewModel: PetViewModel) -> PetPanelLayoutState {
        PetPanelLayoutState(
            isExpanded: viewModel.isExpanded,
            isEditingShortcuts: viewModel.isEditingShortcuts,
            isShowingOnboarding: viewModel.isShowingOnboarding,
            actionCount: viewModel.displayInteraction?.actionChoices.count,
            fifoQueueCount: viewModel.fifoQueueCount,
            hasPermissionNotice: viewModel.hasNewPermissionNotice,
            hasStatusMessage: viewModel.lastError != nil
                || viewModel.shortcutDiagnostic != nil
        )
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

    private func startObservingOutsideClicks() {
        let mouseDownEvents: NSEvent.EventTypeMask = [
            .leftMouseDown,
            .rightMouseDown,
            .otherMouseDown,
        ]
        if localMouseMonitor == nil {
            localMouseMonitor = NSEvent.addLocalMonitorForEvents(
                matching: mouseDownEvents
            ) { [weak self] event in
                let clickLocation = Self.screenLocation(for: event)
                Task { @MainActor [weak self] in
                    self?.dismissForOutsideClick(at: clickLocation)
                }
                return event
            }
        }
        if globalMouseMonitor == nil {
            globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(
                matching: mouseDownEvents
            ) { [weak self] event in
                let clickLocation = event.locationInWindow
                Task { @MainActor [weak self] in
                    self?.dismissForOutsideClick(at: clickLocation)
                }
            }
        }
    }

    private func stopObservingOutsideClicks() {
        if let localMouseMonitor { NSEvent.removeMonitor(localMouseMonitor) }
        if let globalMouseMonitor { NSEvent.removeMonitor(globalMouseMonitor) }
        localMouseMonitor = nil
        globalMouseMonitor = nil
    }

    private func dismissForOutsideClick(at clickLocation: CGPoint) {
        guard PetPanelDismissalPolicy.shouldDismiss(
            panelIsVisible: panel.isVisible,
            clickLocation: clickLocation,
            panelFrame: panel.frame,
            statusItemFrame: statusItemFrameInScreen()
        ) else { return }
        hide()
    }

    private func statusItemFrameInScreen() -> CGRect? {
        guard let statusItemButton, let window = statusItemButton.window else { return nil }
        return window.convertToScreen(
            statusItemButton.convert(statusItemButton.bounds, to: nil)
        )
    }

    private static func screenLocation(for event: NSEvent) -> CGPoint {
        guard let window = event.window else { return event.locationInWindow }
        return window.convertPoint(toScreen: event.locationInWindow)
    }

    private static func geometry(_ screen: NSScreen) -> PetDisplayGeometry? {
        guard let id = screenID(screen) else { return nil }
        return PetDisplayGeometry(id: id, frame: screen.frame, visibleFrame: screen.visibleFrame)
    }

    private static func screenID(_ screen: NSScreen) -> Int? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
    }

}

@MainActor
enum PetStatusItemIcon {
    static let size = NSSize(width: 28, height: 24)
    private static let badgeFrame = NSRect(x: 20.5, y: 16.5, width: 7, height: 7)

    static func loadBaseImage(bundle: Bundle = .main) -> NSImage? {
        guard let url = bundle.url(
            forResource: "BlabeeMenuBar",
            withExtension: "svg"
        ) else { return nil }
        return loadBaseImage(at: url)
    }

    static func loadBaseImage(at url: URL) -> NSImage? {
        guard let image = NSImage(contentsOf: url), image.isValid else { return nil }
        image.size = size
        image.isTemplate = false
        return image
    }

    static func render(baseImage: NSImage?, attention: Bool) -> NSImage {
        let usesFallback = baseImage == nil
        let source = baseImage
            ?? NSImage(
                systemSymbolName: "ladybug.fill",
                accessibilityDescription: "Blabee"
            )
            ?? NSImage(size: size)
        let image = NSImage(size: size, flipped: false) { frame in
            let imageFrame = usesFallback
                ? frame.insetBy(dx: 4, dy: 2)
                : frame
            source.draw(in: imageFrame)
            if attention {
                NSColor.systemRed.setFill()
                NSBezierPath(ovalIn: badgeFrame).fill()
            }
            return true
        }
        image.isTemplate = false
        return image
    }
}

@MainActor
final class PetMenuBarController: NSObject {
    private let viewModel: PetViewModel
    private let panelController: PetPanelController
    private let statusItem: NSStatusItem
    private let baseStatusImage: NSImage?
    private var wasAutomaticallyPresented = false

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        panelController = PetPanelController(viewModel: viewModel)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        baseStatusImage = PetStatusItemIcon.loadBaseImage()
        super.init()

        if let button = statusItem.button {
            button.imagePosition = .imageOnly
            button.imageScaling = .scaleProportionallyDown
            button.target = self
            button.action = #selector(togglePanel(_:))
            button.toolTip = "Blabee"
            button.setAccessibilityLabel("Blabee 메뉴")
            panelController.attach(to: button)
        }
        updateStatusItem(attention: viewModel.hasAttention)

        viewModel.onPanelToggleRequested = { [weak self] in
            self?.togglePanel(nil)
        }
        viewModel.onAttentionChanged = { [weak self] attention in
            self?.attentionChanged(attention)
        }
        viewModel.onAttentionEvent = { [weak self] in
            self?.presentForAttention()
        }
        viewModel.onPermissionRequestChanged = { [weak self] request in
            guard request != nil else { return }
            self?.presentForAttention()
        }
    }

    func stop() {
        viewModel.onPanelToggleRequested = nil
        viewModel.onAttentionChanged = nil
        viewModel.onAttentionEvent = nil
        viewModel.onPermissionRequestChanged = nil
        panelController.stopObservingScreenChanges()
        panelController.hide()
        NSStatusBar.system.removeStatusItem(statusItem)
    }

    @objc private func togglePanel(_ sender: Any?) {
        wasAutomaticallyPresented = false
        panelController.toggleVisibility()
    }

    private func presentForAttention() {
        if !panelController.panel.isVisible {
            wasAutomaticallyPresented = true
        }
        if !viewModel.isEditingShortcuts && !viewModel.isShowingOnboarding {
            viewModel.setExpanded(false)
        }
        panelController.showWithoutActivation()
    }

    private func attentionChanged(_ attention: Bool) {
        updateStatusItem(attention: attention)
        guard !attention,
              wasAutomaticallyPresented,
              !viewModel.isEditingShortcuts,
              !viewModel.isShowingOnboarding
        else { return }
        wasAutomaticallyPresented = false
        panelController.hide()
    }

    private func updateStatusItem(attention: Bool) {
        guard let button = statusItem.button else { return }
        button.image = PetStatusItemIcon.render(
            baseImage: baseStatusImage,
            attention: attention
        )
        button.attributedTitle = NSAttributedString(string: "")
        button.toolTip = attention ? "Blabee · 결정 필요" : "Blabee"
        button.setAccessibilityLabel(attention ? "Blabee, 결정 필요" : "Blabee 메뉴")
    }
}
