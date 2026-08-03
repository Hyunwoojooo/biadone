import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var viewModel: LauncherViewModel?
    private var panelController: LauncherPanelController?
    private var statusItemController: StatusItemController?
    private var hotKey: GlobalHotKey?
    private let loginItemController = LoginItemController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)

        let viewModel = LauncherViewModel()
        let panelController = LauncherPanelController(viewModel: viewModel)
        let hotKey = GlobalHotKey { [weak panelController] in
            panelController?.toggle()
        }
        viewModel.updateHotKeyRegistration(hotKey.isRegistered)
        let statusItemController = StatusItemController(
            loginItemController: loginItemController,
            hotKeyRegistered: hotKey.isRegistered,
            togglePanel: { [weak panelController] in
                panelController?.toggle()
            },
            openDashboard: { [weak viewModel] in
                viewModel?.openDashboard()
            }
        )
        self.viewModel = viewModel
        self.panelController = panelController
        self.statusItemController = statusItemController
        self.hotKey = hotKey

        loginItemController.enableBestEffort()
        viewModel.load(refresh: false)
        if ProcessInfo.processInfo.environment[
            "BLABASE_SHOW_ON_LAUNCH"
        ] == "1" {
            panelController.show()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        hotKey?.invalidate()
        viewModel?.shutdown()
    }
}
