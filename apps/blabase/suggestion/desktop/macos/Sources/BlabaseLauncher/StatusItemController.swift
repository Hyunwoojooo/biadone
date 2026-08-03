import AppKit

@MainActor
final class StatusItemController: NSObject {
    private let statusItem = NSStatusBar.system.statusItem(
        withLength: NSStatusItem.squareLength
    )
    private let loginItemController: LoginItemController
    private let hotKeyRegistered: Bool
    private let togglePanel: () -> Void
    private let openDashboard: () -> Void

    init(
        loginItemController: LoginItemController,
        hotKeyRegistered: Bool,
        togglePanel: @escaping () -> Void,
        openDashboard: @escaping () -> Void
    ) {
        self.loginItemController = loginItemController
        self.hotKeyRegistered = hotKeyRegistered
        self.togglePanel = togglePanel
        self.openDashboard = openDashboard
        super.init()
        if let button = statusItem.button {
            button.image = NSImage(
                systemSymbolName: "sparkles.square.filled",
                accessibilityDescription: "Blabase"
            )
            button.image?.isTemplate = true
            button.target = self
            button.action = #selector(handleStatusClick)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
    }

    @objc private func handleStatusClick() {
        guard let event = NSApplication.shared.currentEvent else {
            togglePanel()
            return
        }
        if event.type == .rightMouseUp {
            showMenu()
        } else {
            togglePanel()
        }
    }

    private func showMenu() {
        let menu = NSMenu()
        menu.addItem(menuItem("지금 할 일 보기", action: #selector(showLauncher)))
        if !hotKeyRegistered {
            let warning = NSMenuItem(
                title: "\(LauncherShortcut.displayName)를 등록하지 못했습니다",
                action: nil,
                keyEquivalent: ""
            )
            warning.isEnabled = false
            menu.addItem(warning)
        }
        menu.addItem(menuItem("대시보드 열기", action: #selector(openDashboardItem)))
        menu.addItem(.separator())
        let loginItem = menuItem(
            loginItemController.statusLabel,
            action: #selector(toggleLoginItem)
        )
        loginItem.state = loginItemController.isEnabled ? .on : .off
        menu.addItem(loginItem)
        menu.addItem(.separator())
        menu.addItem(menuItem("Blabase 종료", action: #selector(quit)))
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    private func menuItem(_ title: String, action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func showLauncher() {
        togglePanel()
    }

    @objc private func openDashboardItem() {
        openDashboard()
    }

    @objc private func toggleLoginItem() {
        loginItemController.toggle()
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}
