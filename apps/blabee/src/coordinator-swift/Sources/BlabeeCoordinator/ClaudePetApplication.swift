import AppKit
import CoordinatorSwift
import Dispatch
import Foundation

/// The qualification host uses the same Pet content and panel, with no global
/// Pet lease, product settings, installed service, telemetry, or hotkey owner.
/// Selector authority stays in this launcher-owned native process.
struct ClaudePetSuggestionModeStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult {
        BlabeeSuggestionModeLoadResult(mode: .smart, diagnostic: nil)
    }
    func save(_ mode: BlabeeSuggestionMode) {}
}

@MainActor
func makeClaudePetViewModel(
    transport: any PetCoordinatorTransport,
    opener: any PetExternalApplicationOpening = PetWorkspaceApplicationOpener()
) -> PetViewModel {
    PetViewModel(
        transport: transport,
        externalApplicationOpener: opener,
        provider: .claude,
        suggestionModeStore: ClaudePetSuggestionModeStore(),
        selectionIDGenerator: { UUID().uuidString.lowercased() }
    )
}

@MainActor
private final class ClaudePetApplicationDelegate: NSObject, NSApplicationDelegate {
    private let viewModel: PetViewModel
    private var panel: PetPanelController?
    private var statusItem: NSStatusItem?
    private(set) var serverStopped = false

    init(transport: any PetCoordinatorTransport) {
        viewModel = makeClaudePetViewModel(transport: transport)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let panel = PetPanelController(viewModel: viewModel)
        self.panel = panel
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem = item
        if let button = item.button {
            button.title = "Blabee · Claude"
            button.toolTip = "이 Claude 세션의 Blabee 패널 열기"
            button.target = self
            button.action = #selector(togglePanel)
            panel.attach(to: button)
        }
        viewModel.onPanelToggleRequested = { [weak panel] in panel?.toggleVisibility() }
        viewModel.onAttentionEvent = { [weak panel] in panel?.showWithoutActivation() }
        viewModel.startPolling()
        panel.showWithoutActivation()
    }

    @objc private func togglePanel() { panel?.toggleVisibility() }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) { stop() }

    func stop() {
        viewModel.stopPolling()
        panel?.hide()
        panel?.stopObservingScreenChanges()
        if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
        statusItem = nil
    }

    func stopAfterServerExit() {
        serverStopped = true
        stop()
        let application = NSApplication.shared
        application.stop(nil)
        if let event = NSEvent.otherEvent(
            with: .applicationDefined, location: .zero, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: 0,
            context: nil, subtype: 0, data1: 0, data2: 0
        ) { application.postEvent(event, atStart: false) }
    }
}

@MainActor
func runClaudePet(
    transport: any PetCoordinatorTransport,
    serve: @escaping @Sendable () throws -> Void
) throws {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = ClaudePetApplicationDelegate(transport: transport)
    application.delegate = delegate
    DispatchQueue.global(qos: .userInitiated).async {
        // A stopped host can no longer validate a click. Close its UI rather
        // than retaining a usable-looking card; report only a fixed error.
        do { try serve() } catch {}
        Task { @MainActor in delegate.stopAfterServerExit() }
    }
    application.run()
    delegate.stop()
    if delegate.serverStopped { throw CoordinatorError("claude_pet_host_stopped") }
    withExtendedLifetime(delegate) {}
}
