import AppKit
import Combine
import Foundation
import ServiceManagement

enum PetFirstRunTheme: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: PetL10n.text("System", korean: "시스템 설정")
        case .light: PetL10n.text("Light", korean: "라이트")
        case .dark: PetL10n.text("Dark", korean: "다크")
        }
    }
}

enum PetLaunchAtLoginStatus: Equatable, Sendable {
    case notRegistered
    case enabled
    case requiresApproval
    case notFound
    case unavailable

    var title: String {
        switch self {
        case .notRegistered: PetL10n.text("Off", korean: "꺼짐")
        case .enabled: PetL10n.text("On", korean: "켜짐")
        case .requiresApproval: PetL10n.text("Approval required in System Settings", korean: "시스템 설정에서 승인 필요")
        case .notFound: PetL10n.text("Check app registration", korean: "앱 등록 확인 필요")
        case .unavailable: PetL10n.text("Status unavailable", korean: "상태 확인 불가")
        }
    }
}

@MainActor
protocol PetLoginItemManaging {
    var status: PetLaunchAtLoginStatus { get }
    func register() throws
    func unregister() throws
    func openSettings()
}

/// Controls only the main app's login item, independently of the coordinator service.
@MainActor
final class PetMainAppLoginItem: PetLoginItemManaging {
    var status: PetLaunchAtLoginStatus {
        switch SMAppService.mainApp.status {
        case .notRegistered: .notRegistered
        case .enabled: .enabled
        case .requiresApproval: .requiresApproval
        case .notFound: .notFound
        @unknown default: .unavailable
        }
    }

    func register() throws { try SMAppService.mainApp.register() }
    func unregister() throws { try SMAppService.mainApp.unregister() }
    func openSettings() { SMAppService.openSystemSettingsLoginItems() }
}

@MainActor
final class PetFirstRunPreferences: ObservableObject {
    static let themeKey = "com.biadone.blabee.pet.appearance.v1"

    @Published private(set) var theme: PetFirstRunTheme
    @Published private(set) var launchAtLoginStatus: PetLaunchAtLoginStatus
    @Published private(set) var launchAtLoginError: String?

    private let defaults: UserDefaults
    private let loginItem: any PetLoginItemManaging
    private let applyTheme: @MainActor (PetFirstRunTheme) -> Void

    var launchAtLoginEnabled: Bool { launchAtLoginStatus == .enabled }

    init(
        defaults: UserDefaults = .standard,
        loginItem: (any PetLoginItemManaging)? = nil,
        applyTheme: @escaping @MainActor (PetFirstRunTheme) -> Void = { theme in
            switch theme {
            case .system: NSApplication.shared.appearance = nil
            case .light: NSApplication.shared.appearance = NSAppearance(named: .aqua)
            case .dark: NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
            }
        }
    ) {
        self.defaults = defaults
        self.loginItem = loginItem ?? PetMainAppLoginItem()
        self.applyTheme = applyTheme
        theme = defaults.string(forKey: Self.themeKey).flatMap(PetFirstRunTheme.init(rawValue:)) ?? .system
        launchAtLoginStatus = self.loginItem.status
    }

    /// Called explicitly at app startup, including after onboarding has been completed.
    func applyAppearance() { applyTheme(theme) }

    func setTheme(_ theme: PetFirstRunTheme) {
        self.theme = theme
        defaults.set(theme.rawValue, forKey: Self.themeKey)
        applyAppearance()
    }

    /// Read the OS state when the app becomes active; never re-register automatically.
    func reloadLaunchAtLoginStatus() {
        let status = loginItem.status
        if status != launchAtLoginStatus { launchAtLoginError = nil }
        launchAtLoginStatus = status
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        reloadLaunchAtLoginStatus()
        launchAtLoginError = nil
        do {
            if enabled {
                // A pending approval is already registered. Re-registering cannot grant consent.
                guard launchAtLoginStatus != .enabled, launchAtLoginStatus != .requiresApproval else { return }
                try loginItem.register()
            } else {
                guard launchAtLoginStatus != .notRegistered, launchAtLoginStatus != .notFound else { return }
                try loginItem.unregister()
            }
            launchAtLoginStatus = loginItem.status
            if enabled && launchAtLoginStatus != .enabled && launchAtLoginStatus != .requiresApproval {
                launchAtLoginError = PetL10n.text("Unable to verify Launch at Login. Please try again.", korean: "로그인 시 실행 설정을 확인하지 못했습니다. 다시 시도해 주세요.")
            } else if !enabled && launchAtLoginStatus != .notRegistered && launchAtLoginStatus != .notFound {
                launchAtLoginError = PetL10n.text("Unable to verify that Launch at Login is off. Check System Settings.", korean: "로그인 시 실행이 꺼졌는지 확인하지 못했습니다. 시스템 설정을 확인해 주세요.")
            }
        } catch {
            // Reflect the actual state even if the registration call changed it before failing.
            launchAtLoginStatus = loginItem.status
            launchAtLoginError = PetL10n.text("Unable to change Launch at Login. \(String(error.localizedDescription.prefix(300)))", korean: "로그인 시 실행 설정을 변경하지 못했습니다. \(String(error.localizedDescription.prefix(300)))")
        }
    }

    func openLoginItemsSettings() { loginItem.openSettings() }
}
