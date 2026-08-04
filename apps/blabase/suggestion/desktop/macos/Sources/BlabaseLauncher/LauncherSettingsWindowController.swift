import AppKit
import SwiftUI

@MainActor
final class LauncherSettingsWindowController: NSObject, NSWindowDelegate {
    private let viewModel: LauncherSettingsViewModel
    private let window: NSWindow

    init(
        viewModel: LauncherSettingsViewModel,
        launcherViewModel: LauncherViewModel
    ) {
        self.viewModel = viewModel
        self.window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 650, height: 700),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        super.init()
        window.title = "Blabase 설정"
        window.isReleasedWhenClosed = false
        window.center()
        window.contentViewController = NSHostingController(
            rootView: LauncherSettingsView(
                viewModel: viewModel,
                launcherViewModel: launcherViewModel
            )
        )
        window.delegate = self
    }

    func show() {
        viewModel.reloadFromStore()
        window.title = viewModel.isSetupRequired
            ? "Blabase 시작 설정"
            : "Blabase 설정"
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func close() {
        window.orderOut(nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        !viewModel.isApplying
    }
}
