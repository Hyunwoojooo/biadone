import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var viewModel: LauncherViewModel?
    private var panelController: LauncherPanelController?
    private var settingsStore: LauncherSettingsStore?
    private var settingsViewModel: LauncherSettingsViewModel?
    private var settingsWindowController: LauncherSettingsWindowController?
    private var statusItemController: StatusItemController?
    private var hotKey: GlobalHotKey?
    private let loginItemController = LoginItemController()
    private var isAgentActive = false
    private var isTerminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)

        let settingsStore = LauncherSettingsStore()
        let client = LauncherAgentClient(configurationResolver: {
            guard let choice = settingsStore.currentDataRootChoice else {
                throw LauncherAgentError.invalidRuntime("setup required")
            }
            return try LauncherRuntimeConfiguration.resolve(
                dataRootChoice: choice
            )
        })
        let viewModel = LauncherViewModel(
            client: client,
            dashboardBaseURLProvider: {
                settingsStore.currentDashboardBaseURL
            },
            sourceModeProvider: {
                settingsStore.currentDataRootChoice?.sourceMode ?? .managed
            }
        )
        let settingsViewModel = LauncherSettingsViewModel(
            store: settingsStore,
            applyHandler: { [weak self] choice, dashboard in
                guard let self else { throw CancellationError() }
                return try await self.applySettings(
                    dataRootChoice: choice,
                    dashboardBaseURLText: dashboard
                )
            }
        )
        let settingsWindowController = LauncherSettingsWindowController(
            viewModel: settingsViewModel,
            launcherViewModel: viewModel
        )
        let panelController = LauncherPanelController(
            viewModel: viewModel,
            openSettings: { [weak self] in
                self?.showSettings()
            }
        )
        let hotKey = GlobalHotKey { [weak self] in
            self?.showPrimaryInterface()
        }
        viewModel.updateHotKeyRegistration(hotKey.isRegistered)
        let statusItemController = StatusItemController(
            loginItemController: loginItemController,
            hotKeyRegistered: hotKey.isRegistered,
            togglePanel: { [weak self, weak panelController] in
                if settingsStore.requiresSetup {
                    self?.showSettings()
                } else {
                    panelController?.toggle()
                }
            },
            openDashboard: { [weak viewModel] in
                viewModel?.openDashboard()
            },
            openSettings: { [weak self] in
                self?.showSettings()
            },
            setupRequired: {
                settingsStore.requiresSetup
            }
        )
        settingsViewModel.onApplied = { [weak self] in
            self?.settingsWindowController?.close()
            self?.panelController?.show(loadsAttention: false)
        }
        self.viewModel = viewModel
        self.panelController = panelController
        self.settingsStore = settingsStore
        self.settingsViewModel = settingsViewModel
        self.settingsWindowController = settingsWindowController
        self.statusItemController = statusItemController
        self.hotKey = hotKey

        loginItemController.enableBestEffort()
        if settingsStore.requiresSetup {
            viewModel.markSetupRequired(Self.setupMessage(settingsStore.loadResult))
            settingsWindowController.show()
        } else {
            isAgentActive = true
            viewModel.load(refresh: false)
            if ProcessInfo.processInfo.environment[
                "BLABASE_SHOW_ON_LAUNCH"
            ] == "1" {
                panelController.show(loadsAttention: false)
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        hotKey?.invalidate()
        viewModel?.shutdown()
    }

    private func showPrimaryInterface() {
        guard let settingsStore else { return }
        if settingsStore.requiresSetup {
            showSettings()
        } else {
            panelController?.toggle()
        }
    }

    private func showSettings() {
        panelController?.hide()
        settingsWindowController?.show()
    }

    private func applySettings(
        dataRootChoice: LauncherDataRootChoice,
        dashboardBaseURLText: String
    ) async throws -> LauncherSettingsSnapshot {
        guard let settingsStore, let viewModel else {
            throw CancellationError()
        }
        let prepared = try settingsStore.prepare(
            dataRootChoice: dataRootChoice,
            dashboardBaseURLText: dashboardBaseURLText
        )
        let previousChoice = settingsStore.currentDataRootChoice
        let applyPlan = LauncherSettingsApplyPlan.make(
            previousChoice: previousChoice,
            nextChoice: prepared.snapshot.dataRootChoice,
            isAgentActive: isAgentActive
        )
        try await LauncherSettingsTransaction.run(
            plan: applyPlan,
            isTerminating: { [weak self] in
                self?.isTerminating ?? true
            },
            stopAgent: { [weak self, weak viewModel] in
                guard let self, let viewModel else {
                    throw CancellationError()
                }
                try await viewModel.stopForConfigurationChange()
                self.isAgentActive = false
            },
            activateDataRoot: {
                _ = try settingsStore.activateDataRoot(prepared)
            },
            persist: {
                settingsStore.persist(prepared)
            },
            loadAttention: { [weak self, weak viewModel] in
                guard let self, let viewModel else { return }
                self.isAgentActive = true
                viewModel.loadAfterConfigurationChange()
            }
        )
        return prepared.snapshot
    }

    private static func setupMessage(
        _ result: LauncherSettingsLoadResult
    ) -> String? {
        guard case .setupRequired(_, _, let message) = result else {
            return nil
        }
        return message
    }
}
