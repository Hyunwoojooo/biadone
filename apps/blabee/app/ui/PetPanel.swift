import AppKit
import BlabeeProductSupport
import Combine
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
    var isShowingChoicePreview = false
    var isProductAccessBlocked = false
    var hasSelectionDeliveryNotice = false

    var usesAdaptiveDecisionSize: Bool {
        actionCount != nil && !isExpanded && !isEditingShortcuts && !isShowingOnboarding
            && !hasPermissionNotice && !isShowingChoicePreview && !isProductAccessBlocked
    }
}

/// A measurement describes one rendered decision at one actual window width.
/// It is never reused for another card, language, service generation, or mode.
struct PetDecisionContentMeasurement: Sendable, Equatable {
    let identity: PetDecisionLayoutIdentity
    let size: CGSize

    func accepted(for currentIdentity: PetDecisionLayoutIdentity?, width: CGFloat) -> CGSize? {
        guard identity == currentIdentity,
              size.width.isFinite, size.height.isFinite, width.isFinite,
              size.width > 0, size.height > 0, width > 0,
              abs(size.width - width) <= 0.5 else { return nil }
        return size
    }
}

enum PetDecisionViewportPolicy {
    static func requiresScrolling(contentHeight: CGFloat, availableHeight: CGFloat) -> Bool {
        contentHeight.isFinite && availableHeight.isFinite
            && contentHeight > availableHeight + 0.5
    }
}

enum PetPanelScreenMode: Sendable, Equatable {
    case ready
    case permission
    case decision(actionCount: Int)
    case details
    case choicePreview
    case shortcutSettings
    case projectSettings
}

enum PetPanelContentPolicy {
    static let projectNameLineLimit = 1
    static let summaryLineLimit = 2
    static let actionTitleLineLimit: Int? = nil
    static let disabledReasonLineLimit = 1
    static let statusMessageLineLimit = 2

    static func allowsScrolling(in mode: PetPanelScreenMode) -> Bool {
        switch mode {
        case .permission, .decision, .details, .choicePreview, .shortcutSettings, .projectSettings:
            true
        case .ready:
            false
        }
    }
}

enum PetPanelSizePolicy {
    static let width: CGFloat = 460
    static let compactHeight: CGFloat = 480
    static let expandedHeight: CGFloat = 680
    static let minimumDecisionHeight: CGFloat = 500
    static let decisionBaseHeight: CGFloat = 350
    // Fallback until the collapsed decision reports its natural content size.
    static let actionHeight: CGFloat = 150
    static let fifoQueueHeight: CGFloat = 44
    static let permissionRequestHeight: CGFloat = 520
    static let statusMessageHeight: CGFloat = 48
    static let selectionDeliveryNoticeExtraHeight: CGFloat = 96
    static let choicePreviewSize = CGSize(width: width, height: 640)

    static let compactSize = CGSize(width: width, height: compactHeight)
    static let expandedSize = CGSize(width: width, height: expandedHeight)

    static func preferredSize(
        for state: PetPanelLayoutState,
        decisionMeasurement: PetDecisionContentMeasurement? = nil,
        decisionIdentity: PetDecisionLayoutIdentity? = nil,
        availableSize: CGSize? = nil
    ) -> CGSize {
        let available = availableSize.flatMap { size in
            size.width.isFinite && size.height.isFinite && size.width > 0 && size.height > 0 ? size : nil
        }
        let actualWidth = min(width, available?.width ?? width)
        var size = unmeasuredPreferredSize(for: state)
        if state.usesAdaptiveDecisionSize,
           let measured = decisionMeasurement?.accepted(for: decisionIdentity, width: actualWidth) {
            // No count-based minimum: chrome, wrapped text, cards, and footer
            // are already included in this natural-height measurement.
            size = CGSize(width: actualWidth, height: ceil(measured.height))
        }
        if let available {
            size.width = min(size.width, available.width)
            size.height = min(size.height, available.height)
        }
        return size
    }

    private static func unmeasuredPreferredSize(for state: PetPanelLayoutState) -> CGSize {
        if state.isProductAccessBlocked { return expandedSize }
        if state.hasPermissionNotice {
            let height = permissionRequestHeight
                + (state.fifoQueueCount > 1 ? fifoQueueHeight : 0)
                + (state.hasStatusMessage ? statusMessageHeight : 0)
                + (state.hasSelectionDeliveryNotice ? selectionDeliveryNoticeExtraHeight : 0)
            return CGSize(width: width, height: min(height, expandedHeight))
        }

        if state.isEditingShortcuts || state.isShowingOnboarding {
            return expandedSize
        }

        if state.isShowingChoicePreview, let actionCount = state.actionCount, actionCount > 0 {
            return choicePreviewSize
        }

        var height: CGFloat
        if let actionCount = state.actionCount {
            if state.isExpanded {
                return expandedSize
            }
            height = max(
                minimumDecisionHeight,
                decisionBaseHeight + CGFloat((min(max(actionCount, 0), 4) + 1) / 2) * actionHeight
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
        if state.hasSelectionDeliveryNotice {
            height += selectionDeliveryNoticeExtraHeight
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

enum PetMenuBarInteractionAction: Sendable, Equatable {
    case togglePanel
    case showQuitMenu
}

enum PetMenuBarInteractionPolicy {
    static var quitMenuTitle: String {
        PetL10n.text("Quit \(BlabeeProductProfile.current.displayName)",
                     korean: "\(BlabeeProductProfile.current.displayName) 종료")
    }

    static func action(for eventType: NSEvent.EventType?) -> PetMenuBarInteractionAction {
        guard let eventType else { return .togglePanel }
        switch eventType {
        case .rightMouseDown, .rightMouseUp:
            return .showQuitMenu
        default:
            return .togglePanel
        }
    }
}

@MainActor
enum PetAppUpdateMenuAction {
    static func perform(
        showSettings: () -> Void,
        showPanel: () -> Void,
        checkForUpdates: () async -> Void
    ) async {
        // Present settings explicitly, including when the panel is already open.
        showSettings()
        showPanel()
        await checkForUpdates()
    }
}

enum PetStatusItemUpdatePolicy {
    static func shouldApply(previousAttention: Bool?, newAttention: Bool) -> Bool {
        previousAttention != newAttention
    }
}

enum PetAutomaticPresentationOwner: Sendable, Equatable {
    case genericAttention
    case approval(PetApprovalHeadIdentity)
}

enum PetApprovalPresentationTransition: Sendable, Equatable {
    case none
    case present(PetApprovalHeadIdentity)
    case hide
    case replace(PetApprovalHeadIdentity)
    case handoffToGenericAttention
}

enum PetApprovalPresentationPolicy {
    static func transition(
        panelIsVisible: Bool,
        automaticOwner: PetAutomaticPresentationOwner?,
        newApprovalIdentity: PetApprovalHeadIdentity?,
        genericAttentionActive: Bool
    ) -> PetApprovalPresentationTransition {
        if case .approval(let displayedIdentity) = automaticOwner {
            guard displayedIdentity != newApprovalIdentity else { return .none }
            if let newApprovalIdentity {
                return .replace(newApprovalIdentity)
            }
            return genericAttentionActive ? .handoffToGenericAttention : .hide
        }
        guard let newApprovalIdentity, !panelIsVisible else { return .none }
        return .present(newApprovalIdentity)
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
    private var openedOnlyForChoicePreview = false
    private var decisionMeasurement: PetDecisionContentMeasurement?

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
        let hostingView = NSHostingView(rootView: PetRootView(
            viewModel: viewModel,
            onDecisionContentSize: { [weak self] measurement in
                self?.decisionContentSizeChanged(measurement)
            }
        ))
        // The controller owns screen clamping. Intrinsic hosting-size updates
        // must not race the measured size and recursively resize the window.
        hostingView.sizingOptions = []
        panel.contentView = hostingView
        placeInitially()
        viewModel.onPanelLayoutChanged = { [weak self] in
            self?.refreshContentSize()
        }
        viewModel.onChoicePreviewChanged = { [weak self] isShowing in
            self?.choicePreviewChanged(isShowing: isShowing)
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
        // A normal presentation takes ownership even if a preview opened first.
        openedOnlyForChoicePreview = false
        placeAtStatusItem(display: false)
        panel.orderFrontRegardless()
        viewModel.setPanelVisible(panel.isVisible)
        startObservingOutsideClicks()
    }

    func hide() {
        // Clear ownership before ending the preview to avoid callback recursion.
        openedOnlyForChoicePreview = false
        viewModel.setPanelVisible(false)
        viewModel.endChoicePreview()
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
        viewModel.setPanelVisible(false)
        viewModel.endChoicePreview()
        viewModel.onChoicePreviewChanged = nil
        viewModel.onPanelLayoutChanged = nil
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        screenObserver = nil
        stopObservingOutsideClicks()
    }

    func windowDidMove(_ notification: Notification) {
        if let screen = panel.screen {
            lastScreenID = Self.screenID(screen)
        }
    }

    func windowWillClose(_ notification: Notification) {
        viewModel.setPanelVisible(false)
        stopObservingOutsideClicks()
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

    private func decisionContentSizeChanged(_ measurement: PetDecisionContentMeasurement) {
        let identity = PetDecisionLayoutIdentity.current(for: viewModel, language: PetL10n.language)
        let width = min(PetPanelSizePolicy.width, availableDisplaySize?.width ?? PetPanelSizePolicy.width)
        guard measurement.accepted(for: identity, width: width) != nil else { return }
        if let previous = decisionMeasurement,
           previous.identity == measurement.identity,
           abs(previous.size.width - measurement.size.width) <= 0.5,
           abs(previous.size.height - measurement.size.height) <= 0.5 { return }
        decisionMeasurement = measurement
        refreshContentSize()
    }

    private func choicePreviewChanged(isShowing: Bool) {
        if isShowing {
            if !panel.isVisible {
                showWithoutActivation()
                openedOnlyForChoicePreview = true
            }
            refreshContentSize()
        } else {
            // Opening settings is an explicit request to keep the panel open.
            let shouldHide = openedOnlyForChoicePreview
                && !viewModel.isEditingShortcuts && !viewModel.isShowingOnboarding
            openedOnlyForChoicePreview = false
            refreshContentSize()
            if shouldHide { hide() }
        }
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
        let identity = PetDecisionLayoutIdentity.current(for: viewModel, language: PetL10n.language)
        let availableSize = availableDisplaySize
        let actualWidth = min(PetPanelSizePolicy.width, availableSize?.width ?? PetPanelSizePolicy.width)
        if decisionMeasurement?.accepted(for: identity, width: actualWidth) == nil {
            decisionMeasurement = nil
        }
        return PetPanelSizePolicy.preferredSize(
            for: Self.layoutState(for: viewModel),
            decisionMeasurement: decisionMeasurement,
            decisionIdentity: identity,
            availableSize: availableSize
        )
    }

    private var availableDisplaySize: CGSize? {
        statusItemButton?.window?.screen?.visibleFrame.size
            ?? preferredDisplay(stable: true)?.visibleFrame.size
    }

    private static func layoutState(for viewModel: PetViewModel) -> PetPanelLayoutState {
        PetPanelLayoutState(
            isExpanded: viewModel.isExpanded,
            isEditingShortcuts: viewModel.isEditingShortcuts,
            isShowingOnboarding: viewModel.isShowingOnboarding,
            actionCount: viewModel.displayInteraction?.actionChoices.count,
            fifoQueueCount: viewModel.eventQueueCount,
            hasPermissionNotice: viewModel.hasNewPermissionNotice,
            hasStatusMessage: viewModel.hasVisibleStatusMessage,
            isShowingChoicePreview: viewModel.choicePreview != nil,
            isProductAccessBlocked: viewModel.isProductAccessBlocked,
            hasSelectionDeliveryNotice: viewModel.selectionDeliveryNotice != nil
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
        viewModel.acknowledgeApprovalResolutionError()
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
        image.isTemplate = true
        return image
    }

    static func render(
        baseImage: NSImage?, attention: Bool, appearance: NSAppearance? = nil
    ) -> NSImage {
        render(
            baseImage: baseImage,
            attention: attention,
            foreground: foreground(attention: attention, appearance: appearance)
        )
    }

    static func foreground(attention: Bool, appearance: NSAppearance?) -> NSColor {
        // Resolve only the colored composite ourselves. Idle uses a template so
        // the menu bar can apply its own foreground, including highlighted states.
        var ink = NSColor.black
        if attention {
            (appearance ?? NSAppearance.currentDrawing()).performAsCurrentDrawingAppearance {
                ink = NSColor.labelColor.usingColorSpace(.deviceRGB) ?? .black
            }
        }
        return ink
    }

    static func render(baseImage: NSImage?, attention: Bool, foreground: NSColor) -> NSImage {
        let image = NSImage(size: size, flipped: false) { frame in
            if let baseImage {
                baseImage.draw(in: frame)
                foreground.setFill()
                frame.fill(using: .sourceIn)
            } else if let context = NSGraphicsContext.current?.cgContext {
                // SwiftUI's bee coordinates point down; AppKit's badge points up.
                context.saveGState()
                context.translateBy(x: 0, y: frame.height)
                context.scaleBy(x: 1, y: -1)
                context.addPath(PetAirBeeMark().path(in: frame.insetBy(dx: 2, dy: 0)).cgPath)
                context.setFillColor(foreground.cgColor)
                context.fillPath()
                context.restoreGState()
            }
            if attention {
                NSColor.systemRed.setFill()
                NSBezierPath(ovalIn: badgeFrame).fill()
            }
            return true
        }
        image.isTemplate = !attention
        return image
    }
}

/// Avoid writing image/title back during AppKit's status-item appearance
/// snapshots. A setter schedules another snapshot, whose temporary appearance
/// changes used to schedule yet another forced setter indefinitely.
@MainActor
final class PetStatusItemPresenter {
    private let button: NSButton
    private let baseImage: NSImage?
    private let idleImage: NSImage
    private var appearanceObservation: NSKeyValueObservation?
    private var languageObservation: AnyCancellable?
    private var appearanceRefresh: Task<Void, Never>?
    private var renderedAttention: Bool?
    private var renderedForeground: NSColor?
    private var stopped = false

    init(button: NSButton, baseImage: NSImage?) {
        self.button = button
        self.baseImage = baseImage
        idleImage = PetStatusItemIcon.render(baseImage: baseImage, attention: false)
        button.attributedTitle = NSAttributedString(string: "")
        appearanceObservation = button.observe(\.effectiveAppearance) { [weak self] _, _ in
            Task { @MainActor [weak self] in
                self?.scheduleAppearanceRefresh()
            }
        }
        languageObservation = PetLocalization.shared.$language.dropFirst().sink { [weak self] _ in
            self?.refreshAccessibilityText()
        }
    }

    func update(attention: Bool) {
        guard !stopped else { return }
        let attentionChanged = PetStatusItemUpdatePolicy.shouldApply(
            previousAttention: renderedAttention, newAttention: attention
        )
        let foreground = PetStatusItemIcon.foreground(
            attention: attention, appearance: button.effectiveAppearance
        )
        // Idle templates adapt themselves; colored attention images only need
        // replacement when their resolved ink actually changes.
        guard attentionChanged || (attention && foreground != renderedForeground) else { return }
        renderedAttention = attention
        renderedForeground = foreground
        button.image = attention ? PetStatusItemIcon.render(
            baseImage: baseImage, attention: true, foreground: foreground
        ) : idleImage
        if attentionChanged {
            refreshAccessibilityText()
        }
    }

    private func refreshAccessibilityText() {
        guard !stopped else { return }
        let attention = renderedAttention == true
        let name = BlabeeProductProfile.current.displayName
        button.toolTip = attention ? name + PetL10n.text(" · Decision needed", korean: " · 결정 필요") : name
        button.setAccessibilityLabel(attention ? name + PetL10n.text(", decision needed", korean: ", 결정 필요") : name + PetL10n.text(" menu", korean: " 메뉴"))
    }

    func stop() {
        stopped = true
        appearanceObservation = nil
        languageObservation = nil
        appearanceRefresh?.cancel()
        appearanceRefresh = nil
    }

    private func scheduleAppearanceRefresh() {
        guard !stopped, renderedAttention == true, appearanceRefresh == nil else { return }
        appearanceRefresh = Task { @MainActor [weak self] in
            // Coalesce AppKit's transient snapshot appearances and inspect the
            // final value, not the appearance captured by a KVO notification.
            await Task.yield()
            guard let self, !Task.isCancelled else { return }
            self.appearanceRefresh = nil
            self.update(attention: self.renderedAttention == true)
        }
    }
}

@MainActor
final class PetMenuBarController: NSObject {
    private let viewModel: PetViewModel
    private let panelController: PetPanelController
    private let statusItem: NSStatusItem
    private var statusItemPresenter: PetStatusItemPresenter?
    private var automaticPresentationOwner: PetAutomaticPresentationOwner?

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        panelController = PetPanelController(viewModel: viewModel)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()

        if let button = statusItem.button {
            button.imagePosition = .imageOnly
            button.imageScaling = .scaleProportionallyDown
            button.target = self
            button.action = #selector(handleStatusItemInteraction(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            panelController.attach(to: button)
            statusItemPresenter = PetStatusItemPresenter(
                button: button, baseImage: PetStatusItemIcon.loadBaseImage()
            )
        }
        statusItemPresenter?.update(attention: viewModel.hasAttention)

        viewModel.onPanelToggleRequested = { [weak self] in
            self?.togglePanel(nil)
        }
        viewModel.onAttentionChanged = { [weak self] attention in
            self?.attentionChanged(attention)
        }
        viewModel.onAttentionEvent = { [weak self] in
            self?.presentForGenericAttention()
        }
        viewModel.onApprovalHeadChanged = { [weak self] identity in
            self?.approvalHeadChanged(identity)
        }
        viewModel.onApprovalResolutionFailed = { [weak self] in
            self?.presentForGenericAttention()
        }
    }

    func stop() {
        statusItemPresenter?.stop()
        statusItemPresenter = nil
        viewModel.onPanelToggleRequested = nil
        viewModel.onAttentionChanged = nil
        viewModel.onAttentionEvent = nil
        viewModel.onApprovalHeadChanged = nil
        viewModel.onApprovalResolutionFailed = nil
        panelController.stopObservingScreenChanges()
        panelController.hide()
        NSStatusBar.system.removeStatusItem(statusItem)
    }

    func showAccountAfterSignIn() {
        automaticPresentationOwner = nil
        panelController.showWithoutActivation()
    }

    @objc private func handleStatusItemInteraction(_ sender: NSStatusBarButton) {
        let event = NSApplication.shared.currentEvent
        switch PetMenuBarInteractionPolicy.action(for: event?.type) {
        case .togglePanel:
            togglePanel(sender)
        case .showQuitMenu:
            guard let event else { return }
            let menu = NSMenu()
            let updateItem = NSMenuItem(
                title: PetL10n.text("Check for Updates…", korean: "업데이트 확인…"),
                action: #selector(checkForAppUpdates(_:)),
                keyEquivalent: ""
            )
            updateItem.target = self
            menu.addItem(updateItem)
            menu.addItem(.separator())
            let quitItem = NSMenuItem(
                title: PetMenuBarInteractionPolicy.quitMenuTitle,
                action: #selector(terminateApplication(_:)),
                keyEquivalent: ""
            )
            quitItem.target = self
            menu.addItem(quitItem)
            NSMenu.popUpContextMenu(menu, with: event, for: sender)
        }
    }

    @objc private func checkForAppUpdates(_ sender: NSMenuItem) {
        automaticPresentationOwner = nil
        Task { [weak self] in
            guard let self else { return }
            await PetAppUpdateMenuAction.perform(
                showSettings: viewModel.showAppUpdateSettings,
                showPanel: panelController.showWithoutActivation,
                checkForUpdates: viewModel.checkForAppUpdates
            )
        }
    }

    @objc private func terminateApplication(_ sender: NSMenuItem) {
        NSApplication.shared.terminate(sender)
    }

    @objc private func togglePanel(_ sender: Any?) {
        let wasVisible = panelController.panel.isVisible
        automaticPresentationOwner = nil
        panelController.toggleVisibility()
        if wasVisible {
            viewModel.acknowledgeApprovalResolutionError()
        }
    }

    private func presentForGenericAttention() {
        guard viewModel.productAccessAllowsActions else { return }
        if !panelController.panel.isVisible {
            automaticPresentationOwner = .genericAttention
        }
        showPanelForAttention()
    }

    private func approvalHeadChanged(_ identity: PetApprovalHeadIdentity?) {
        guard viewModel.productAccessAllowsActions else {
            automaticPresentationOwner = nil
            return
        }
        let transition = PetApprovalPresentationPolicy.transition(
            panelIsVisible: panelController.panel.isVisible,
            automaticOwner: automaticPresentationOwner,
            newApprovalIdentity: identity,
            genericAttentionActive: viewModel.fifoHeadInteraction?.isSelectionReady == true
                || viewModel.hasPersistentApprovalResolutionError
        )
        switch transition {
        case .none:
            return
        case .present(let identity):
            automaticPresentationOwner = .approval(identity)
            showPanelForAttention()
        case .hide:
            automaticPresentationOwner = nil
            panelController.hide()
        case .replace(let identity):
            automaticPresentationOwner = nil
            panelController.hide()
            automaticPresentationOwner = .approval(identity)
            showPanelForAttention()
        case .handoffToGenericAttention:
            automaticPresentationOwner = .genericAttention
        }
    }

    private func showPanelForAttention() {
        if !viewModel.isEditingShortcuts && !viewModel.isShowingOnboarding {
            viewModel.setExpanded(false)
        }
        panelController.showWithoutActivation()
    }

    private func attentionChanged(_ attention: Bool) {
        statusItemPresenter?.update(attention: attention)
        guard viewModel.productAccessAllowsActions else {
            automaticPresentationOwner = nil
            return
        }
        guard !attention,
              automaticPresentationOwner != nil,
              !viewModel.isEditingShortcuts,
              !viewModel.isShowingOnboarding
        else { return }
        automaticPresentationOwner = nil
        panelController.hide()
    }

}
