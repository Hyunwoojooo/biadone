import Foundation

@MainActor
protocol LauncherSettingsPersistence: AnyObject {
    func object(forKey defaultName: String) -> Any?
    func set(_ value: Any?, forKey defaultName: String)
}

extension UserDefaults: LauncherSettingsPersistence {}

enum LauncherDataRootChoice: Equatable, Sendable {
    case managedDefault
    case existingReadOnly(path: String)

    var sourceMode: LauncherSourceMode {
        switch self {
        case .managedDefault: .managed
        case .existingReadOnly: .readOnly
        }
    }

    var existingPath: String? {
        guard case .existingReadOnly(let path) = self else { return nil }
        return path
    }
}

extension LauncherDataRootChoice: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind
        case path
    }

    private enum Kind: String, Codable {
        case managedDefault = "managed_default"
        case existingReadOnly = "existing_read_only"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .managedDefault:
            guard !container.contains(.path) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .path,
                    in: container,
                    debugDescription: "Managed root must not contain a path."
                )
            }
            self = .managedDefault
        case .existingReadOnly:
            let path = try container.decode(String.self, forKey: .path)
            guard !path.isEmpty else {
                throw DecodingError.dataCorruptedError(
                    forKey: .path,
                    in: container,
                    debugDescription: "Existing root path is empty."
                )
            }
            self = .existingReadOnly(path: path)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .managedDefault:
            try container.encode(Kind.managedDefault, forKey: .kind)
        case .existingReadOnly(let path):
            try container.encode(Kind.existingReadOnly, forKey: .kind)
            try container.encode(path, forKey: .path)
        }
    }
}

struct LauncherSettingsSnapshot: Codable, Equatable, Sendable {
    static let currentSchemaVersion = 1
    static let maximumRevision = 1_000_000_000

    let schemaVersion: Int
    let revision: Int
    let dataRootChoice: LauncherDataRootChoice
    let dashboardBaseURLString: String
    let onboardingCompleted: Bool

    var dashboardBaseURL: URL? {
        SafeURLPolicy.dashboardBaseURL(from: dashboardBaseURLString)
    }
}

enum LauncherSettingsLoadResult: Equatable, Sendable {
    case setupRequired(
        savedDraft: LauncherSettingsSnapshot?,
        legacyDataRootPath: String?,
        message: String?
    )
    case configured(LauncherSettingsSnapshot)

    var configuredSnapshot: LauncherSettingsSnapshot? {
        guard case .configured(let snapshot) = self else { return nil }
        return snapshot
    }
}

struct PreparedLauncherSettings: Equatable, Sendable {
    let snapshot: LauncherSettingsSnapshot
    fileprivate let encodedData: Data
}

struct LauncherSettingsApplyPlan: Equatable, Sendable {
    let stopCurrentAgent: Bool
    let loadAttention: Bool

    static func make(
        previousChoice: LauncherDataRootChoice?,
        nextChoice: LauncherDataRootChoice,
        isAgentActive: Bool
    ) -> LauncherSettingsApplyPlan {
        let rootChanged = previousChoice != nextChoice
        return LauncherSettingsApplyPlan(
            stopCurrentAgent: rootChanged,
            loadAttention: !isAgentActive || rootChanged
        )
    }
}

enum LauncherDataRootSelectionPolicy {
    static let localDashboardBaseURLString = "http://localhost:3102"

    static func dashboardBaseURLStringForExistingRoot(
        current: String
    ) -> String {
        current == SafeURLPolicy.defaultDashboardBaseURL.absoluteString
            ? localDashboardBaseURLString
            : current
    }
}

@MainActor
enum LauncherSettingsTransaction {
    static func run(
        plan: LauncherSettingsApplyPlan,
        isTerminating: () -> Bool,
        stopAgent: () async throws -> Void,
        activateDataRoot: () throws -> Void,
        persist: () -> Void,
        loadAttention: () -> Void
    ) async throws {
        if plan.stopCurrentAgent {
            try await stopAgent()
        }
        try Task.checkCancellation()
        guard !isTerminating() else { throw CancellationError() }
        if plan.loadAttention {
            try activateDataRoot()
        }
        try Task.checkCancellation()
        guard !isTerminating() else { throw CancellationError() }
        persist()
        if plan.loadAttention {
            loadAttention()
        }
    }
}

@MainActor
final class LauncherSettingsStore {
    static let storageKey = "com.biadone.blabase.launcher.settings.v1"

    private let persistence: LauncherSettingsPersistence
    private let environment: [String: String]
    private let fileManager: FileManager
    private(set) var loadResult: LauncherSettingsLoadResult

    convenience init(
        userDefaults: UserDefaults = .standard,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) {
        self.init(
            persistence: userDefaults,
            environment: environment,
            fileManager: fileManager
        )
    }

    init(
        persistence: LauncherSettingsPersistence,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) {
        self.persistence = persistence
        self.environment = environment
        self.fileManager = fileManager
        self.loadResult = .setupRequired(
            savedDraft: nil,
            legacyDataRootPath: nil,
            message: nil
        )
        self.loadResult = loadPersistedSettings()
    }

    var requiresSetup: Bool {
        loadResult.configuredSnapshot == nil
    }

    var currentSnapshot: LauncherSettingsSnapshot? {
        loadResult.configuredSnapshot
    }

    var currentDataRootChoice: LauncherDataRootChoice? {
        currentSnapshot?.dataRootChoice
    }

    var currentDashboardBaseURL: URL? {
        currentSnapshot?.dashboardBaseURL
    }

    var legacyDashboardBaseURLString: String? {
        guard persistence.object(forKey: Self.storageKey) == nil else {
            return nil
        }
        return environment["BLABASE_DASHBOARD_URL"]
            .flatMap(SafeURLPolicy.dashboardBaseURL)
            .map(\.absoluteString)
    }

    func prepare(
        dataRootChoice: LauncherDataRootChoice,
        dashboardBaseURLText: String
    ) throws -> PreparedLauncherSettings {
        let normalizedChoice: LauncherDataRootChoice
        switch dataRootChoice {
        case .managedDefault:
            _ = try LauncherDataRootPolicy.managedDefaultURL(
                fileManager: fileManager
            )
            normalizedChoice = .managedDefault
        case .existingReadOnly(let path):
            let resolved = try LauncherDataRootPolicy.validateExistingRoot(
                path: path,
                fileManager: fileManager
            )
            normalizedChoice = .existingReadOnly(path: resolved.path)
        }
        guard let dashboardURL = SafeURLPolicy.dashboardBaseURL(
            from: dashboardBaseURLText
        ) else {
            throw LauncherSettingsError.invalidDashboardURL
        }
        let previousRevision: Int
        switch loadResult {
        case .configured(let snapshot):
            previousRevision = snapshot.revision
        case .setupRequired(let savedDraft, _, _):
            previousRevision = savedDraft?.revision ?? 0
        }
        let (nextRevision, overflow) = previousRevision
            .addingReportingOverflow(1)
        guard
            !overflow,
            nextRevision <= LauncherSettingsSnapshot.maximumRevision
        else {
            throw LauncherSettingsError.revisionExhausted
        }
        let snapshot = LauncherSettingsSnapshot(
            schemaVersion: LauncherSettingsSnapshot.currentSchemaVersion,
            revision: nextRevision,
            dataRootChoice: normalizedChoice,
            dashboardBaseURLString: dashboardURL.absoluteString,
            onboardingCompleted: true
        )
        return PreparedLauncherSettings(
            snapshot: snapshot,
            encodedData: try Self.encode(snapshot)
        )
    }

    func persist(_ prepared: PreparedLauncherSettings) {
        persistence.set(prepared.encodedData, forKey: Self.storageKey)
        loadResult = .configured(prepared.snapshot)
    }

    func activateDataRoot(
        _ prepared: PreparedLauncherSettings
    ) throws -> ResolvedLauncherDataRoot {
        switch prepared.snapshot.dataRootChoice {
        case .managedDefault:
            return try LauncherDataRootPolicy.resolveManagedDefault(
                fileManager: fileManager
            )
        case .existingReadOnly(let path):
            let root = try LauncherDataRootPolicy.validateExistingRoot(
                path: path,
                fileManager: fileManager
            )
            return ResolvedLauncherDataRoot(
                url: root,
                sourceMode: .readOnly
            )
        }
    }

    static func encode(_ snapshot: LauncherSettingsSnapshot) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(snapshot)
    }

    static func decode(_ data: Data) throws -> LauncherSettingsSnapshot {
        let snapshot: LauncherSettingsSnapshot
        do {
            snapshot = try JSONDecoder().decode(
                LauncherSettingsSnapshot.self,
                from: data
            )
        } catch {
            throw LauncherSettingsError.corruptSettings
        }
        guard
            snapshot.schemaVersion ==
                LauncherSettingsSnapshot.currentSchemaVersion,
            snapshot.revision > 0,
            snapshot.revision <= LauncherSettingsSnapshot.maximumRevision,
            snapshot.onboardingCompleted,
            snapshot.dashboardBaseURL != nil
        else {
            throw LauncherSettingsError.unsupportedSettings
        }
        return snapshot
    }

    private func loadPersistedSettings() -> LauncherSettingsLoadResult {
        guard let storedObject = persistence.object(forKey: Self.storageKey) else {
            let legacyPath = validatedLegacyDataRootPath()
            let hasLegacyCandidate = legacyPath != nil ||
                legacyDashboardBaseURLString != nil
            return .setupRequired(
                savedDraft: nil,
                legacyDataRootPath: legacyPath,
                message: hasLegacyCandidate
                    ? "기존 실행 환경의 설정을 찾았습니다. 확인 후 저장해주세요."
                    : nil
            )
        }
        guard let data = storedObject as? Data else {
            return .setupRequired(
                savedDraft: nil,
                legacyDataRootPath: nil,
                message: "저장된 설정을 읽지 못했습니다. 다시 확인해주세요."
            )
        }
        let snapshot: LauncherSettingsSnapshot
        do {
            snapshot = try Self.decode(data)
        } catch {
            return .setupRequired(
                savedDraft: nil,
                legacyDataRootPath: nil,
                message: "저장된 설정을 읽지 못했습니다. 다시 확인해주세요."
            )
        }
        do {
            try validate(snapshot)
            return .configured(snapshot)
        } catch {
            return .setupRequired(
                savedDraft: snapshot,
                legacyDataRootPath: nil,
                message: (error as? LocalizedError)?.errorDescription
                    ?? "저장된 데이터 폴더를 다시 연결해주세요."
            )
        }
    }

    private func validate(_ snapshot: LauncherSettingsSnapshot) throws {
        guard snapshot.dashboardBaseURL != nil else {
            throw LauncherSettingsError.invalidDashboardURL
        }
        switch snapshot.dataRootChoice {
        case .managedDefault:
            _ = try LauncherDataRootPolicy.managedDefaultURL(
                fileManager: fileManager
            )
        case .existingReadOnly(let path):
            let resolved = try LauncherDataRootPolicy.validateExistingRoot(
                path: path,
                fileManager: fileManager
            )
            guard resolved.path == path else {
                throw LauncherSettingsError.dataRootIdentityChanged
            }
        }
    }

    private func validatedLegacyDataRootPath() -> String? {
        guard let rawPath = environment["BLABASE_LAUNCHER_DATA_ROOT"] else {
            return nil
        }
        return try? LauncherDataRootPolicy.validateExistingRoot(
            path: rawPath,
            fileManager: fileManager
        ).path
    }
}

enum LauncherSettingsError: LocalizedError, Equatable {
    case corruptSettings
    case unsupportedSettings
    case invalidDashboardURL
    case dataRootIdentityChanged
    case revisionExhausted

    var errorDescription: String? {
        switch self {
        case .corruptSettings:
            "저장된 Blabase 설정 형식이 손상되었습니다."
        case .unsupportedSettings:
            "이 버전에서 지원하지 않는 Blabase 설정입니다."
        case .invalidDashboardURL:
            "Blabase Cloud 또는 localhost 대시보드 주소만 사용할 수 있습니다."
        case .dataRootIdentityChanged:
            "저장 후 데이터 폴더의 실제 위치가 바뀌었습니다. 다시 선택해주세요."
        case .revisionExhausted:
            "저장된 설정 revision을 더 이상 갱신할 수 없습니다. 설정을 다시 만들어주세요."
        }
    }
}
