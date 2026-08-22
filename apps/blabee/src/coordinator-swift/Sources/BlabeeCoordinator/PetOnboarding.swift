import AppKit
import BlabeeProductSupport
import CoordinatorSwift
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
        case .notRegistered: "등록되지 않음"
        case .enabled: "등록됨"
        case .requiresApproval: "사용자 승인 필요"
        case .notFound: "서비스를 찾을 수 없음"
        case .unknown: "확인할 수 없음"
        }
    }

    var displayDescription: String {
        switch self {
        case .notRegistered:
            "아직 백그라운드 서비스를 등록하지 않았습니다."
        case .enabled:
            "서비스가 실행될 자격이 있습니다. 현재 실행 중이라는 뜻은 아닙니다."
        case .requiresApproval:
            "macOS 시스템 설정에서 백그라운드 실행을 승인해야 합니다."
        case .notFound:
            "앱 번들에서 등록할 서비스를 확인할 수 없습니다."
        case .unknown:
            "알 수 없는 상태에서는 안전을 위해 등록 상태를 변경하지 않습니다."
        }
    }
}

@MainActor
protocol PetOnboardingAdapting: AnyObject {
    func serviceRegistrationState() -> PetServiceRegistrationState
    func configuredProjectPaths() throws -> [String]
    func registerService() throws
    func unregisterService() async throws
    func openSystemSettingsLoginItems()
    func enableProject(at path: String) throws
    func disableProject(at path: String) throws
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
        try ProductServiceBootstrap.resolve(environment: environment).enabledProjectPaths
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

    init(reason: String = "제품 앱 환경에서만 온보딩 설정을 사용할 수 있습니다.") {
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
        panel.title = "Blabee 프로젝트 선택"
        panel.message = "백그라운드 서비스가 관찰할 프로젝트 폴더를 선택하세요."
        panel.prompt = "프로젝트 추가"
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
