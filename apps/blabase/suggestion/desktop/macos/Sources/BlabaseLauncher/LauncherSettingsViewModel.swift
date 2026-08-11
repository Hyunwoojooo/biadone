import AppKit
import Foundation

@MainActor
final class LauncherSettingsViewModel: ObservableObject {
    @Published var dataRootChoice: LauncherDataRootChoice = .managedDefault
    @Published var dashboardBaseURLText =
        SafeURLPolicy.defaultDashboardBaseURL.absoluteString
    @Published private(set) var isApplying = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var statusMessage: String?
    @Published private(set) var isSetupRequired = true
    @Published private(set) var activeDataRootChoice: LauncherDataRootChoice?
    @Published private(set) var activeDashboardBaseURLText: String?

    var onApplied: (() -> Void)?

    private let store: LauncherSettingsStore
    private let fileManager: FileManager
    private let applyHandler: (
        LauncherDataRootChoice,
        String
    ) async throws -> LauncherSettingsSnapshot

    init(
        store: LauncherSettingsStore,
        fileManager: FileManager = .default,
        applyHandler: @escaping (
            LauncherDataRootChoice,
            String
        ) async throws -> LauncherSettingsSnapshot
    ) {
        self.store = store
        self.fileManager = fileManager
        self.applyHandler = applyHandler
        reloadFromStore()
    }

    func reloadFromStore() {
        isSetupRequired = store.requiresSetup
        errorMessage = nil
        statusMessage = nil
        switch store.loadResult {
        case .configured(let snapshot):
            activeDataRootChoice = snapshot.dataRootChoice
            activeDashboardBaseURLText = snapshot.dashboardBaseURLString
            dataRootChoice = snapshot.dataRootChoice
            dashboardBaseURLText = snapshot.dashboardBaseURLString
        case .setupRequired(
            let savedDraft,
            let legacyDataRootPath,
            let message
        ):
            activeDataRootChoice = nil
            activeDashboardBaseURLText = nil
            if let savedDraft {
                dataRootChoice = savedDraft.dataRootChoice
                dashboardBaseURLText = savedDraft.dashboardBaseURLString
            } else if let legacyDataRootPath {
                dataRootChoice = .existingReadOnly(
                    path: legacyDataRootPath
                )
                dashboardBaseURLText = store.legacyDashboardBaseURLString
                    ?? SafeURLPolicy.defaultDashboardBaseURL.absoluteString
            } else {
                dataRootChoice = .managedDefault
                dashboardBaseURLText = store.legacyDashboardBaseURLString
                    ?? SafeURLPolicy.defaultDashboardBaseURL.absoluteString
            }
            statusMessage = message
        }
    }

    func chooseExistingDataRoot() {
        let panel = NSOpenPanel()
        panel.title = "기존 Blabase 데이터 폴더 연결"
        panel.message = "`.local` 폴더가 들어 있는 Blabase 폴더를 선택하세요."
        panel.prompt = "연결"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        if case .existingReadOnly(let path) = dataRootChoice {
            panel.directoryURL = URL(fileURLWithPath: path, isDirectory: true)
        }
        guard panel.runModal() == .OK, let selectedURL = panel.url else {
            return
        }
        do {
            try connectExistingDataRoot(at: selectedURL)
        } catch {
            errorMessage = Self.message(for: error)
        }
    }

    func connectExistingDataRoot(at selectedURL: URL) throws {
        let resolved = try LauncherDataRootPolicy.validateExistingRoot(
            path: selectedURL.path,
            fileManager: fileManager
        )
        dataRootChoice = .existingReadOnly(path: resolved.path)
        dashboardBaseURLText =
            LauncherDataRootSelectionPolicy
                .dashboardBaseURLStringForExistingRoot(
                    current: dashboardBaseURLText
                )
        errorMessage = nil
        statusMessage =
            "데이터는 복사하지 않고 이 폴더의 snapshot을 연결합니다. 새 데이터는 로컬 Work Cockpit에서 갱신합니다."
    }

    func useManagedDefault() {
        dataRootChoice = .managedDefault
        errorMessage = nil
        statusMessage =
            "개발 베타에서 Source를 연결하려면 로컬 Work Cockpit이 소유한 기존 데이터 폴더를 선택하세요."
    }

    func useCloudDashboard() {
        dashboardBaseURLText =
            SafeURLPolicy.defaultDashboardBaseURL.absoluteString
        errorMessage = nil
    }

    func useLocalDashboard() {
        dashboardBaseURLText = "http://localhost:3102"
        errorMessage = nil
    }

    func apply() {
        guard !isApplying else { return }
        isApplying = true
        errorMessage = nil
        statusMessage = nil
        let choice = dataRootChoice
        let dashboard = dashboardBaseURLText
        Task { [weak self] in
            guard let self else { return }
            defer { self.isApplying = false }
            do {
                let snapshot = try await self.applyHandler(
                    choice,
                    dashboard
                )
                self.dataRootChoice = snapshot.dataRootChoice
                self.activeDataRootChoice = snapshot.dataRootChoice
                self.dashboardBaseURLText = snapshot.dashboardBaseURLString
                self.activeDashboardBaseURLText =
                    snapshot.dashboardBaseURLString
                self.isSetupRequired = false
                self.statusMessage = "설정을 저장했습니다."
                self.onApplied?()
            } catch is CancellationError {
                return
            } catch {
                self.errorMessage = Self.message(for: error)
            }
        }
    }

    var selectedDataRootPath: String {
        switch dataRootChoice {
        case .managedDefault:
            (try? LauncherDataRootPolicy.managedDefaultURL(
                fileManager: fileManager
            ).path) ?? "~/Library/Application Support/Blabase"
        case .existingReadOnly(let path):
            path
        }
    }

    var sourceMode: LauncherSourceMode {
        dataRootChoice.sourceMode
    }

    var isDataRootDraftDirty: Bool {
        activeDataRootChoice != dataRootChoice
    }

    var isSourceNavigationDraftDirty: Bool {
        isDataRootDraftDirty
            || activeDashboardBaseURLText != dashboardBaseURLText
    }

    private static func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription
            ?? "설정을 적용하지 못했습니다."
    }
}
