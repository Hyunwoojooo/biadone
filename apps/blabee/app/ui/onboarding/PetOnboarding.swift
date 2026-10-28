import AppKit
import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation
import ServiceManagement

enum PetServiceRegistrationState: Sendable, Equatable {
    case notRegistered
    case enabled
    case requiresApproval
    case notFound
    case unknown

    var displayTitle: String {
        switch self {
        case .notRegistered: PetL10n.text("Not registered", korean: "등록되지 않음")
        case .enabled: PetL10n.text("Registered", korean: "등록됨")
        case .requiresApproval: PetL10n.text("User approval required", korean: "사용자 승인 필요")
        case .notFound: PetL10n.text("Service not found", korean: "서비스를 찾을 수 없음")
        case .unknown: PetL10n.text("Unable to verify", korean: "확인할 수 없음")
        }
    }

    var displayDescription: String {
        switch self {
        case .notRegistered:
            PetL10n.text("The background service has not been registered yet.", korean: "아직 백그라운드 서비스를 등록하지 않았습니다.")
        case .enabled:
            PetL10n.text("The service is eligible to run. This does not mean it is currently running.", korean: "서비스가 실행될 자격이 있습니다. 현재 실행 중이라는 뜻은 아닙니다.")
        case .requiresApproval:
            PetL10n.text("Approve background execution in macOS System Settings.", korean: "macOS 시스템 설정에서 백그라운드 실행을 승인해야 합니다.")
        case .notFound:
            PetL10n.text("macOS may not have seen this service yet. Try registering it to check its status.", korean: "macOS가 아직 이 서비스를 본 적이 없을 수 있습니다. 등록을 시도해 상태를 확인하세요.")
        case .unknown:
            PetL10n.text("Registration is not changed when its status is unknown.", korean: "알 수 없는 상태에서는 안전을 위해 등록 상태를 변경하지 않습니다.")
        }
    }
}

@MainActor
protocol PetOnboardingAdapting: AnyObject {
    func serviceRegistrationState() -> PetServiceRegistrationState
    func configuredProjectPaths() throws -> [String]
    /// nil means no saved configuration. An empty array is an explicit saved scope.
    func configuredProjectPathsIfPresent() throws -> [String]?
    func initializeDefaultProjectScopeIfMissing() throws
    func registerService() throws
    func unregisterService() async throws
    func openSystemSettingsLoginItems()
    func enableProject(at path: String) throws
    func disableProject(at path: String) throws
}

extension PetOnboardingAdapting {
    // Older/fixture adapters remain explicit scopes. They must opt in to default
    // initialization and must never inherit the live user's home implicitly.
    func configuredProjectPathsIfPresent() throws -> [String]? {
        try configuredProjectPaths()
    }

    func initializeDefaultProjectScopeIfMissing() throws {
        throw CoordinatorError("pet_onboarding_unavailable", "default working folder setup is unavailable")
    }
}

@MainActor
protocol PetProjectFolderChoosing: AnyObject {
    func chooseProjectFolder() -> URL?
}

@MainActor
final class PetLiveOnboardingAdapter: PetOnboardingAdapting {
    static let servicePlistName = "com.biadone.blabee.coordinator.plist"

    private let service: SMAppService
    private let environment: ProductServiceEnvironment
    private let settingsWriter: ProductServiceSettingsWriter

    init() throws {
        let environment = try ProductServiceEnvironment.live()
        guard ProductInvocationResolver.isExpectedAppBundle(environment.invocation) else {
            throw CoordinatorError(
                "pet_onboarding_unavailable",
                "service onboarding requires the exact Blabee app bundle"
            )
        }
        service = SMAppService.agent(plistName: Self.servicePlistName)
        self.environment = environment
        settingsWriter = ProductServiceSettingsWriter()
    }

    func serviceRegistrationState() -> PetServiceRegistrationState {
        switch service.status {
        case .notRegistered: .notRegistered
        case .enabled: .enabled
        case .requiresApproval: .requiresApproval
        case .notFound: .notFound
        @unknown default: .unknown
        }
    }

    func configuredProjectPaths() throws -> [String] {
        try configuredProjectPathsIfPresent() ?? []
    }

    func configuredProjectPathsIfPresent() throws -> [String]? {
        try ProductServiceBootstrap.loadEnabledProjectsIfPresent(environment: environment)
    }

    func initializeDefaultProjectScopeIfMissing() throws {
        // Avoid even resolving the default when the user already saved a scope.
        // The writer checks again under its lock and publishes without replacing.
        guard try configuredProjectPathsIfPresent() == nil else { return }
        _ = try settingsWriter.initializeIfMissing(
            defaultProject: Self.accountHomeDirectory(),
            environment: environment
        )
    }

    private static func accountHomeDirectory() throws -> String {
        // HOME/CODEX_HOME can be overridden by a launcher; use the OS account.
        var buffer = [CChar](repeating: 0, count: 16_384)
        let home: String? = buffer.withUnsafeMutableBufferPointer { buffer in
            var account = passwd()
            var result: UnsafeMutablePointer<passwd>?
            guard getpwuid_r(geteuid(), &account, buffer.baseAddress, buffer.count, &result) == 0,
                  result != nil, let path = account.pw_dir else { return nil }
            return String(cString: path)
        }
        guard let home, home.hasPrefix("/"), home != "/" else {
            throw CoordinatorError("pet_home_directory_unavailable", "the OS account home directory is unavailable")
        }
        return home
    }

    func registerService() throws {
        try service.register()
    }

    func unregisterService() async throws {
        try await service.unregister()
    }

    func openSystemSettingsLoginItems() {
        SMAppService.openSystemSettingsLoginItems()
    }

    func enableProject(at path: String) throws {
        _ = try settingsWriter.update(
            action: .enable,
            project: path,
            environment: environment
        )
    }

    func disableProject(at path: String) throws {
        _ = try settingsWriter.update(
            action: .disable,
            project: path,
            environment: environment
        )
    }
}

@MainActor
final class PetUnavailableOnboardingAdapter: PetOnboardingAdapting {
    private let reason: String

    init(reason: String = PetL10n.text("Onboarding settings are available only in the product app.", korean: "제품 앱 환경에서만 온보딩 설정을 사용할 수 있습니다.")) {
        self.reason = reason
    }

    func serviceRegistrationState() -> PetServiceRegistrationState { .unknown }

    func configuredProjectPaths() throws -> [String] {
        throw CoordinatorError("pet_onboarding_unavailable", reason)
    }

    func registerService() throws {
        throw CoordinatorError("pet_onboarding_unavailable", reason)
    }

    func unregisterService() async throws {
        throw CoordinatorError("pet_onboarding_unavailable", reason)
    }

    func openSystemSettingsLoginItems() {}

    func enableProject(at path: String) throws {
        throw CoordinatorError("pet_onboarding_unavailable", reason)
    }

    func disableProject(at path: String) throws {
        throw CoordinatorError("pet_onboarding_unavailable", reason)
    }
}

@MainActor
final class PetOpenPanelProjectFolderChooser: PetProjectFolderChoosing {
    func chooseProjectFolder() -> URL? {
        let panel = NSOpenPanel()
        panel.title = PetL10n.text("Choose a Blabee Project", korean: "Blabee 프로젝트 선택")
        panel.message = PetL10n.text("Choose a project folder for the background service to watch.", korean: "백그라운드 서비스가 관찰할 프로젝트 폴더를 선택하세요.")
        panel.prompt = PetL10n.text("Add Project", korean: "프로젝트 추가")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.resolvesAliases = false
        guard panel.runModal() == .OK else { return nil }
        return panel.url
    }
}

@MainActor
final class PetUnavailableProjectFolderChooser: PetProjectFolderChoosing {
    func chooseProjectFolder() -> URL? { nil }
}
