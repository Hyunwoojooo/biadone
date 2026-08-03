import Foundation
import ServiceManagement

@MainActor
final class LoginItemController {
    var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    var statusLabel: String {
        switch SMAppService.mainApp.status {
        case .enabled:
            "로그인 시 실행 켜짐"
        case .requiresApproval:
            "시스템 설정에서 로그인 실행 승인 필요"
        case .notRegistered, .notFound:
            "로그인 시 실행 꺼짐"
        @unknown default:
            "로그인 실행 상태 알 수 없음"
        }
    }

    func enableBestEffort() {
        guard shouldRegisterAutomatically else { return }
        guard SMAppService.mainApp.status == .notRegistered else { return }
        try? SMAppService.mainApp.register()
    }

    func toggle() {
        do {
            switch SMAppService.mainApp.status {
            case .enabled:
                try SMAppService.mainApp.unregister()
            case .requiresApproval:
                SMAppService.openSystemSettingsLoginItems()
            case .notRegistered, .notFound:
                try SMAppService.mainApp.register()
            @unknown default:
                SMAppService.openSystemSettingsLoginItems()
            }
        } catch {
            // The menu label exposes requires-approval/not-registered state.
        }
    }

    private var shouldRegisterAutomatically: Bool {
        guard ProcessInfo.processInfo.environment[
            "BLABASE_DISABLE_LOGIN_ITEM_AUTOREGISTER"
        ] != "1" else {
            return false
        }

        let appPath = Bundle.main.bundleURL.standardizedFileURL.path
        let systemApplications = "/Applications/"
        let userApplications = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications", isDirectory: true)
            .standardizedFileURL.path + "/"
        return appPath.hasPrefix(systemApplications)
            || appPath.hasPrefix(userApplications)
    }
}
