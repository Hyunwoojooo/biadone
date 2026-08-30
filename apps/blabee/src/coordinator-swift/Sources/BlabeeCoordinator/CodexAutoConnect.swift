import Darwin
import Foundation

enum CodexAutoConnectState: Sendable, Equatable {
    case disabled
    case enabled
    case repairRequired(String)
    case conflict(String)
    case unavailable(String)
}

enum CodexAutoConnectError: LocalizedError, Equatable, Sendable {
    case conflict(String)
    case unavailable(String)
    case unsafeFilesystem(String)
    case writeFailed(String)

    var errorDescription: String? {
        switch self {
        case let .conflict(message), let .unavailable(message),
             let .unsafeFilesystem(message), let .writeFailed(message):
            message
        }
    }
}

struct CodexAutoConnectInspection: Sendable, Equatable {
    let state: CodexAutoConnectState
    let canEnable: Bool
}

/// Installs a small, opt-in zsh integration without replacing the user's Codex binary.
///
/// File inspection is deliberately side-effect free. Mutations happen only from
/// `enable()` and `disable()`, under both a process mutex and an on-disk lock.
struct CodexAutoConnectManager: Sendable {
    private static let processMutex = NSLock()
    private static let openingMarker = "# >>> Blabee Codex Auto Connect v1 >>>"
    private static let closingMarker = "# <<< Blabee Codex Auto Connect v1 <<<"
    private static let generatedHeader = "# Blabee Codex Auto Connect v4\n"
    private static let legacyV3GeneratedHeader = "# Blabee Codex Auto Connect v3\n"
    private static let legacyV2GeneratedHeader = "# Blabee Codex Auto Connect v2\n"
    private static let legacyGeneratedHeader = "# Blabee Codex Auto Connect v1\n"
    private static let stableLauncherHeader = "#!/bin/sh\n# Blabee Codex Stable Launcher v2\n"
    private static let legacyStableLauncherHeader = "#!/bin/sh\n# Blabee Codex Stable Launcher v1\n"
    private static let maximumZshRCBytes = 256 * 1_024
    private static let maximumManagedFileBytes = 64 * 1_024
    private static let maximumStableLauncherBytes = 16 * 1_024
    private static let maximumRuntimeApprovalBytes = 64 * 1_024
    private static let maximumPreservedMetadataBytes = 256 * 1_024
    private static let systemManagedProvenanceAttribute = Data("com.apple.provenance".utf8)

    private let homeURL: URL
    private let applicationSupportURL: URL
    private let coordinatorURL: URL
    private let discoveredOfficialCodexSourceURL: URL?
    private let discoveredOfficialCodexURL: URL?
    private let prequalifiedOfficialCodexIdentity: FileIdentity?
    private let officialCodexResolutionError: CodexAutoConnectError?
    private let dynamicShimRoots: [DynamicShimRoot]
    private let codexVersionReader: @Sendable (URL) -> String?
    private let configuredZshRCURL: URL
    private let zshRCResolutionError: CodexAutoConnectError?
    private let beforeDestinationReplace: (@Sendable (URL) throws -> Void)?
    private let afterPathMutation: (@Sendable (URL) throws -> Void)?
    private let lockAttemptLimit: Int
    private let lockRetryMicroseconds: useconds_t

    init(
        homeURL: URL,
        applicationSupportURL: URL,
        coordinatorURL: URL,
        officialCodexURL: URL?,
        officialCodexSourceURL: URL? = nil,
        prequalifiedOfficialCodexIdentity: FileIdentity? = nil,
        officialCodexResolutionError: CodexAutoConnectError? = nil,
        dynamicShimRoots: [DynamicShimRoot] = [],
        codexVersionReader: @escaping @Sendable (URL) -> String? = CodexAutoConnectManager.readCodexVersion,
        zshRCURL: URL? = nil,
        zshRCResolutionError: CodexAutoConnectError? = nil,
        beforeDestinationReplace: (@Sendable (URL) throws -> Void)? = nil,
        afterPathMutation: (@Sendable (URL) throws -> Void)? = nil,
        // The five-second version deadline can also spend bounded time
        // terminating and draining a stuck child. Keep the lock wait above
        // that complete worst-case path so a concurrent launcher can observe
        // the first process's published approval instead of timing out early.
        lockAttemptLimit: Int = 1_000,
        lockRetryMicroseconds: useconds_t = 10_000
    ) {
        self.homeURL = homeURL.standardizedFileURL
        self.applicationSupportURL = applicationSupportURL.standardizedFileURL
        self.coordinatorURL = coordinatorURL.standardizedFileURL
        self.discoveredOfficialCodexSourceURL = (
            officialCodexSourceURL ?? officialCodexURL
        )?.standardizedFileURL
        self.discoveredOfficialCodexURL = officialCodexURL?.standardizedFileURL
        self.prequalifiedOfficialCodexIdentity = prequalifiedOfficialCodexIdentity
        self.officialCodexResolutionError = officialCodexResolutionError
        self.dynamicShimRoots = dynamicShimRoots
        self.codexVersionReader = codexVersionReader
        self.configuredZshRCURL = (zshRCURL
            ?? homeURL.appendingPathComponent(".zshrc", isDirectory: false))
            .standardizedFileURL
        self.zshRCResolutionError = zshRCResolutionError
        self.beforeDestinationReplace = beforeDestinationReplace
        self.afterPathMutation = afterPathMutation
        self.lockAttemptLimit = max(1, lockAttemptLimit)
        self.lockRetryMicroseconds = lockRetryMicroseconds
    }

    var canEnable: Bool {
        switch discoveredCodexApproval() {
        case .success: true
        case .failure: false
        }
    }

    static func live(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> CodexAutoConnectManager {
        guard let rawHome = environment["HOME"], rawHome.hasPrefix("/"),
              let executableURL = bundle.executableURL
        else {
            throw CodexAutoConnectError.unavailable(
                "Codex 자동 연결에 필요한 HOME 또는 Blabee 실행 파일을 찾을 수 없습니다."
            )
        }
        return try live(
            homeURL: URL(fileURLWithPath: rawHome, isDirectory: true),
            coordinatorURL: executableURL,
            environment: environment
        )
    }

    /// Builds the launch-time manager without discovering Codex or running a
    /// version probe. The persisted runtime approval is the only authority on
    /// this hot path; discovery remains an explicit enable/repair operation.
    static func liveForRuntime(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> CodexAutoConnectManager {
        guard let rawHome = environment["HOME"], rawHome.hasPrefix("/"),
              let executableURL = bundle.executableURL
        else {
            throw CodexAutoConnectError.unavailable(
                "Codex 실행 신뢰 확인에 필요한 HOME 또는 Blabee 실행 파일을 찾을 수 없습니다."
            )
        }
        let home = URL(fileURLWithPath: rawHome, isDirectory: true).standardizedFileURL
        return CodexAutoConnectManager(
            homeURL: home,
            applicationSupportURL: home.appendingPathComponent(
                "Library/Application Support/Blabee",
                isDirectory: true
            ),
            coordinatorURL: executableURL,
            officialCodexURL: nil,
            dynamicShimRoots: dynamicShimRoots(environment: environment, homeURL: home)
        )
    }

    static func live(
        homeURL: URL,
        coordinatorURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        versionReader: @escaping @Sendable (URL) -> String? = readCodexVersion
    ) throws -> CodexAutoConnectManager {
        let home = homeURL.standardizedFileURL
        let applicationSupport = home
            .appendingPathComponent("Library/Application Support/Blabee", isDirectory: true)
        let integration = applicationSupport
            .appendingPathComponent("shell/v1/codex-auto-connect.zsh", isDirectory: false)
        let shimRoots = dynamicShimRoots(environment: environment, homeURL: home)
        let zshRC: URL
        let zshRCResolutionError: CodexAutoConnectError?
        do {
            zshRC = try resolveZshRCURL(homeURL: home, environment: environment)
            zshRCResolutionError = nil
        } catch let error as CodexAutoConnectError {
            // A persisted managed file may still identify the exact historical
            // zshrc. Preserve that disable/repair route while keeping a clean
            // installation unavailable until the environment is unambiguous.
            zshRC = home.appendingPathComponent(".zshrc", isDirectory: false)
            zshRCResolutionError = error
        }
        let official: DiscoveredOfficialCodex?
        let officialCodexResolutionError: CodexAutoConnectError?
        do {
            official = try discoverOfficialCodex(
                environment: environment,
                homeURL: home,
                coordinatorURL: coordinatorURL.standardizedFileURL,
                integrationURL: integration,
                dynamicShimRoots: shimRoots,
                versionReader: versionReader
            )
            officialCodexResolutionError = nil
        } catch let error as CodexAutoConnectError {
            official = nil
            officialCodexResolutionError = error
        }
        return CodexAutoConnectManager(
            homeURL: home,
            applicationSupportURL: applicationSupport,
            coordinatorURL: coordinatorURL,
            officialCodexURL: official?.url,
            officialCodexSourceURL: official?.sourceURL,
            prequalifiedOfficialCodexIdentity: official?.identity,
            officialCodexResolutionError: officialCodexResolutionError,
            dynamicShimRoots: shimRoots,
            codexVersionReader: versionReader,
            zshRCURL: zshRC,
            zshRCResolutionError: zshRCResolutionError
        )
    }

    func inspection() -> CodexAutoConnectInspection {
        let approval = discoveredCodexApproval()
        return CodexAutoConnectInspection(
            state: state(discoveredApproval: approval),
            canEnable: {
                if case .success = approval { return true }
                return false
            }()
        )
    }

    func state() -> CodexAutoConnectState {
        state(discoveredApproval: nil)
    }

    private func state(
        discoveredApproval: Result<FileIdentity, CodexAutoConnectError>?
    ) -> CodexAutoConnectState {
        do {
            try validateSecureDirectoriesIfPresent()
            let managed = try secureFile(
                at: managedFileURL,
                maximumBytes: Self.maximumManagedFileBytes
            )
            let stableLauncher = try secureFile(
                at: stableLauncherURL,
                maximumBytes: Self.maximumStableLauncherBytes
            )
            let runtimeApprovalFile = try secureFile(
                at: runtimeApprovalURL,
                maximumBytes: Self.maximumRuntimeApprovalBytes
            )
            let targetZshRCURL = try installedZshRCURL(managed: managed)
            let zshRC = try secureFile(at: targetZshRCURL, maximumBytes: Self.maximumZshRCBytes)
            let layout = try zshRCLayout(zshRC?.data)

            switch layout {
            case .disabled:
                guard let managed else {
                    if runtimeApprovalFile != nil {
                        return .repairRequired("완료되지 않은 Codex 자동 연결 실행 파일이 남아 있습니다.")
                    }
                    if let stableLauncher {
                        guard isOwnedStableLauncher(stableLauncher.data) else {
                            return .conflict("Blabee 고정 실행기 경로에 다른 파일이 있습니다.")
                        }
                        guard isUsableStableLauncher(stableLauncher),
                              currentStableLauncherOfficialCodexURL(
                                  stableLauncher.data
                              ) != nil
                        else {
                            return .repairRequired("Blabee 고정 실행기가 손상되었습니다.")
                        }
                    }
                    switch discoveredApproval ?? discoveredCodexApproval() {
                    case .success:
                        return .disabled
                    case let .failure(error):
                        return .unavailable(error.localizedDescription)
                    }
                }
                guard isOwnedManagedFile(managed.data) else {
                    return .conflict("Blabee 관리 파일 경로에 다른 파일이 있습니다.")
                }
                guard let configuration = managedConfiguration(managed.data) else {
                    return .conflict("Blabee 관리 파일 형식이 손상되었습니다.")
                }
                if configuration.schema == .legacyV1 {
                    return .conflict(
                        "기존 v1 관리 파일의 $HOME/.zshrc 표식을 확인할 수 없어 자동 복구하지 않습니다."
                    )
                }
                return .repairRequired("완료되지 않은 자동 연결 설정이 남아 있습니다.")
            case .owned(_, _, let exactMarker):
                guard let managed else {
                    return .repairRequired("Blabee 관리 파일이 없습니다.")
                }
                guard isOwnedManagedFile(managed.data) else {
                    return .conflict("Blabee 관리 파일이 다른 프로그램의 파일과 충돌합니다.")
                }
                guard let configuration = managedConfiguration(managed.data) else {
                    return .conflict("Blabee 관리 파일 형식이 손상되었습니다.")
                }
                let installedOfficial = URL(
                    fileURLWithPath: configuration.officialCodexPath,
                    isDirectory: false
                )
                let expectedManaged: Data
                switch configuration.schema {
                case .currentV4:
                    expectedManaged = generatedManagedFile(
                        zshRCWasMissing: configuration.zshRCWasMissing,
                        officialCodexURL: installedOfficial,
                        zshRCURL: targetZshRCURL
                    )
                case .legacyV3:
                    expectedManaged = generatedLegacyV3ManagedFile(
                        coordinatorURL: URL(
                            fileURLWithPath: configuration.coordinatorPath,
                            isDirectory: false
                        ),
                        zshRCWasMissing: configuration.zshRCWasMissing,
                        officialCodexURL: installedOfficial,
                        zshRCURL: targetZshRCURL
                    )
                case .legacyV2:
                    expectedManaged = generatedLegacyV2ManagedFile(
                        zshRCWasMissing: configuration.zshRCWasMissing,
                        officialCodexURL: installedOfficial,
                        zshRCURL: targetZshRCURL
                    )
                case .legacyV1:
                    guard targetZshRCURL == legacyZshRCURL else {
                        return .repairRequired("기존 v1 관리 파일의 .zshrc 대상이 올바르지 않습니다.")
                    }
                    expectedManaged = generatedLegacyManagedFile(
                        zshRCWasMissing: configuration.zshRCWasMissing,
                        officialCodexURL: installedOfficial
                    )
                }
                guard managed.data == expectedManaged else {
                    return .repairRequired("Blabee 관리 파일이 현재 설치 정보와 다릅니다.")
                }
                guard exactMarker else {
                    return .repairRequired(".zshrc의 Blabee 연결 경로가 오래되었습니다.")
                }
                guard configuration.schema == .currentV4 else {
                    return .repairRequired(
                        "이전 자동 연결 실행 경로가 남아 있습니다. 자동 연결을 다시 활성화해 갱신해 주세요."
                    )
                }
                guard let stableLauncher else {
                    return .repairRequired(
                        "Blabee 고정 실행기가 없습니다. 자동 연결을 다시 활성화해 복구해 주세요."
                    )
                }
                guard isOwnedStableLauncher(stableLauncher.data) else {
                    return .conflict("Blabee 고정 실행기 경로에 다른 파일이 있습니다.")
                }
                guard isUsableStableLauncher(stableLauncher),
                      stableLauncher.data == generatedStableLauncher(
                          officialCodexURL: installedOfficial
                      )
                else {
                    return .repairRequired(
                        "Blabee 고정 실행기가 이전 실행 경로를 사용합니다. 자동 연결을 다시 활성화해 복구해 주세요."
                    )
                }
                guard let runtimeApproval = try decodedRuntimeApproval(runtimeApprovalFile),
                      runtimeApproval.stableSourcePath == configuration.officialCodexPath
                else {
                    return .repairRequired("Codex 실행 승인 기록이 없거나 현재 설정과 다릅니다.")
                }
                do {
                    _ = try runtimeTrustGate.revalidate(approval: runtimeApproval)
                } catch CodexRuntimeTrustError.dynamicShim {
                    return .repairRequired(
                        "저장된 Codex 이름 경로가 프로젝트별로 달라지는 shim입니다. 자동 연결을 다시 설정해 주세요."
                    )
                } catch {
                    return .repairRequired(
                        "Codex 실행 파일이 마지막 승인 이후 변경되었습니다. 다음 실행에서 다시 검증합니다."
                    )
                }
                return .enabled
            }
        } catch let error as CodexAutoConnectError {
            switch error {
            case let .conflict(message): return .conflict(message)
            case let .unavailable(message): return .unavailable(message)
            case let .unsafeFilesystem(message), let .writeFailed(message):
                return .conflict(message)
            }
        } catch {
            return .unavailable(error.localizedDescription)
        }
    }

    func enable() throws {
        guard let officialCodexURL = discoveredOfficialCodexURL,
              let officialCodexSourceURL = discoveredOfficialCodexSourceURL
        else {
            throw officialCodexResolutionError ?? CodexAutoConnectError.unavailable(
                "공식 Codex 실행 파일을 찾지 못해 자동 연결을 활성화하거나 복구할 수 없습니다."
            )
        }
        try withExclusiveLock(createDirectories: true) {
            let runtimeSourceURL = try Self.normalizedStableSourceURL(
                officialCodexSourceURL
            )
            try validateExecutables(
                officialCodexURL: officialCodexURL,
                sourceURL: officialCodexSourceURL
            )
            let runtimeApproval: CodexRuntimeApproval
            do {
                runtimeApproval = try runtimeTrustGate.qualify(
                    sourceURL: runtimeSourceURL,
                    versionReader: { codexVersionReader($0) }
                )
            } catch {
                throw CodexAutoConnectError.unavailable(error.localizedDescription)
            }
            let approvedOfficialIdentity = try Self.executableIdentity(
                officialCodexURL,
                label: "공식 Codex"
            )
            guard Self.sameIdentity(
                runtimeApproval.targetIdentity,
                approvedOfficialIdentity
            ) else {
                throw CodexAutoConnectError.unavailable(
                    "Codex 실행 target이 활성화 준비 중 변경되었습니다."
                )
            }
            let managed = try secureFile(
                at: managedFileURL,
                maximumBytes: Self.maximumManagedFileBytes
            )
            let stableLauncher = try secureFile(
                at: stableLauncherURL,
                maximumBytes: Self.maximumStableLauncherBytes
            )
            let existingApproval = try secureFile(
                at: runtimeApprovalURL,
                maximumBytes: Self.maximumRuntimeApprovalBytes
            )
            let targetZshRCURL = try installedZshRCURL(managed: managed)
            try validateZshRCDirectory(targetZshRCURL)
            let zshRC = try secureFile(at: targetZshRCURL, maximumBytes: Self.maximumZshRCBytes)
            let layout = try zshRCLayout(zshRC?.data)
            let prefix: Data
            let suffix: Data
            switch layout {
            case .disabled(let data):
                prefix = data
                suffix = Data()
            case .owned(let ownedPrefix, let ownedSuffix, _):
                prefix = ownedPrefix
                suffix = ownedSuffix
            }

            if let managed, !isOwnedManagedFile(managed.data) {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 경로에 다른 파일이 있어 덮어쓰지 않았습니다."
                )
            }
            if let managed, managedConfiguration(managed.data) == nil {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 형식이 손상되어 자동 복구하지 않았습니다."
                )
            }
            if let stableLauncher, !isOwnedStableLauncher(stableLauncher.data) {
                throw CodexAutoConnectError.conflict(
                    "Blabee 고정 실행기 경로에 다른 파일이 있어 덮어쓰지 않았습니다."
                )
            }
            if let managed,
               managedConfiguration(managed.data)?.schema == .legacyV1,
               case .disabled = layout
            {
                throw CodexAutoConnectError.conflict(
                    "기존 v1 관리 파일의 $HOME/.zshrc 표식이 없어 자동 복구하지 않았습니다."
                )
            }
            let origin = managed.flatMap { managedConfiguration($0.data)?.zshRCWasMissing }
                ?? (zshRC == nil)
            let desiredManaged = generatedManagedFile(
                zshRCWasMissing: origin,
                officialCodexURL: runtimeSourceURL,
                zshRCURL: targetZshRCURL
            )
            let desiredZshRC = enabledZshRC(prefix: prefix, suffix: suffix)
            let desiredApproval = try runtimeApproval.encodedData()
            let desiredStableLauncher = generatedStableLauncher(
                officialCodexURL: runtimeSourceURL
            )

            // Approval and both launcher layers must be durable before .zshrc
            // begins sourcing the managed function. The stable launcher path
            // lets shells that are already open follow a later app replacement
            // without re-sourcing their zsh startup files.
            if existingApproval?.data != desiredApproval {
                try atomicWrite(
                    desiredApproval,
                    to: runtimeApprovalURL,
                    expected: existingApproval,
                    defaultMode: 0o600
                )
            }
            if stableLauncher?.data != desiredStableLauncher || stableLauncher?.mode != 0o700 {
                try atomicWrite(
                    desiredStableLauncher,
                    to: stableLauncherURL,
                    expected: stableLauncher,
                    defaultMode: 0o700,
                    replacementMode: 0o700
                )
            }
            if managed?.data != desiredManaged {
                try atomicWrite(
                    desiredManaged,
                    to: managedFileURL,
                    expected: managed,
                    defaultMode: 0o600
                )
            }
            if zshRC?.data != desiredZshRC {
                try atomicWrite(
                    desiredZshRC,
                    to: targetZshRCURL,
                    expected: zshRC,
                    defaultMode: 0o600
                )
            }
        }
    }

    func disable() throws {
        try withExclusiveLock(createDirectories: true) {
            let managed = try secureFile(
                at: managedFileURL,
                maximumBytes: Self.maximumManagedFileBytes
            )
            let stableLauncher = try secureFile(
                at: stableLauncherURL,
                maximumBytes: Self.maximumStableLauncherBytes
            )
            let runtimeApproval = try secureFile(
                at: runtimeApprovalURL,
                maximumBytes: Self.maximumRuntimeApprovalBytes
            )
            let targetZshRCURL = try installedZshRCURL(managed: managed)
            try validateZshRCDirectory(targetZshRCURL)
            let zshRC = try secureFile(at: targetZshRCURL, maximumBytes: Self.maximumZshRCBytes)
            let layout = try zshRCLayout(zshRC?.data)
            if managed == nil, runtimeApproval == nil, case .disabled = layout {
                if stableLauncher == nil { return }
                if let stableLauncher,
                   isUsableStableLauncher(stableLauncher),
                   currentStableLauncherOfficialCodexURL(stableLauncher.data) != nil
                { return }
            }
            if let managed, !isOwnedManagedFile(managed.data) {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 경로에 다른 파일이 있어 삭제하지 않았습니다."
                )
            }
            if let managed, managedConfiguration(managed.data) == nil {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 형식이 손상되어 자동 삭제하지 않았습니다."
                )
            }
            if let stableLauncher, !isOwnedStableLauncher(stableLauncher.data) {
                throw CodexAutoConnectError.conflict(
                    "Blabee 고정 실행기 경로에 다른 파일이 있어 삭제하지 않았습니다."
                )
            }
            if let managed,
               managedConfiguration(managed.data)?.schema == .legacyV1,
               case .disabled = layout
            {
                throw CodexAutoConnectError.conflict(
                    "기존 v1 관리 파일의 $HOME/.zshrc 표식이 없어 자동 삭제하지 않았습니다."
                )
            }
            if runtimeApproval != nil {
                _ = try decodedRuntimeApproval(runtimeApproval)
            }
            let originWasMissing = managed
                .flatMap { managedConfiguration($0.data)?.zshRCWasMissing } ?? false
            let retainedOfficialCodexURL = managed
                .flatMap { managedConfiguration($0.data)?.officialCodexPath }
                .map { URL(fileURLWithPath: $0, isDirectory: false) }

            // An already-open shell keeps the sourced function after .zshrc is
            // restored. Leave its stable path as a native-only pass-through so
            // disabling Blabee cannot make the user's next Codex invocation fail.
            if let retainedOfficialCodexURL {
                let passThrough = generatedStableLauncher(
                    officialCodexURL: retainedOfficialCodexURL
                )
                if stableLauncher?.data != passThrough || stableLauncher?.mode != 0o700 {
                    try atomicWrite(
                        passThrough,
                        to: stableLauncherURL,
                        expected: stableLauncher,
                        defaultMode: 0o700,
                        replacementMode: 0o700
                    )
                }
            }

            // Stop sourcing managed code before removing the managed file.
            if case let .owned(prefix, suffix, _) = layout, let zshRC {
                let restored = restoredZshRC(prefix: prefix, suffix: suffix)
                if originWasMissing, restored.isEmpty {
                    try secureUnlink(targetZshRCURL, expected: zshRC)
                } else {
                    try atomicWrite(
                        restored,
                        to: targetZshRCURL,
                        expected: zshRC,
                        defaultMode: 0o600
                    )
                }
            }
            if let managed {
                try secureUnlink(managedFileURL, expected: managed)
            }
            if let runtimeApproval {
                try secureUnlink(runtimeApprovalURL, expected: runtimeApproval)
            }
            if let stableLauncher, retainedOfficialCodexURL == nil {
                try secureUnlink(stableLauncherURL, expected: stableLauncher)
            }
        }
    }

    private var legacyZshRCURL: URL {
        homeURL.appendingPathComponent(".zshrc", isDirectory: false)
    }

    private var shellDirectoryURL: URL {
        applicationSupportURL.appendingPathComponent("shell/v1", isDirectory: true)
    }

    private var managedFileURL: URL {
        shellDirectoryURL.appendingPathComponent("codex-auto-connect.zsh", isDirectory: false)
    }

    private var stableLauncherURL: URL {
        shellDirectoryURL.appendingPathComponent("codex-stable-launcher", isDirectory: false)
    }

    private var runtimeApprovalURL: URL {
        shellDirectoryURL.appendingPathComponent(
            "codex-runtime-approval.json",
            isDirectory: false
        )
    }

    private var lockFileURL: URL {
        shellDirectoryURL.appendingPathComponent(".codex-auto-connect.lock", isDirectory: false)
    }

    private var runtimeTrustGate: CodexRuntimeTrustGate {
        CodexRuntimeTrustGate(dynamicShimRootURLs: dynamicShimRoots.map(\.url))
    }

    private func decodedRuntimeApproval(
        _ file: SecureFile?
    ) throws -> CodexRuntimeApproval? {
        guard let file else { return nil }
        do {
            return try CodexRuntimeApproval.decodeStrict(
                from: file.data,
                fileMode: file.mode,
                fileOwner: file.owner
            )
        } catch {
            throw CodexAutoConnectError.unsafeFilesystem(
                "Codex 실행 승인 기록이 손상되었거나 안전하지 않습니다."
            )
        }
    }

    private func runtimeConfiguration() throws -> ManagedConfiguration {
        try validateSecureDirectories()
        guard let managed = try secureFile(
            at: managedFileURL,
            maximumBytes: Self.maximumManagedFileBytes
        ), let configuration = managedConfiguration(managed.data)
        else {
            throw CodexAutoConnectError.unavailable(
                "Blabee Codex 자동 연결 설정이 없어 실행을 중단했습니다."
            )
        }
        guard configuration.schema == .currentV4,
              let zshRCPath = configuration.zshRCPath
        else {
            throw CodexAutoConnectError.unavailable(
                "이전 자동 연결 설정은 실행하지 않습니다. Blabee 설정에서 자동 연결을 복구해 주세요."
            )
        }
        let sourceURL = URL(
            fileURLWithPath: configuration.officialCodexPath,
            isDirectory: false
        )
        let expected = generatedManagedFile(
            zshRCWasMissing: configuration.zshRCWasMissing,
            officialCodexURL: sourceURL,
            zshRCURL: URL(fileURLWithPath: zshRCPath, isDirectory: false)
        )
        guard managed.data == expected else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "Blabee Codex 자동 연결 설정이 현재 앱과 일치하지 않습니다."
            )
        }
        guard let stableLauncher = try secureFile(
            at: stableLauncherURL,
            maximumBytes: Self.maximumStableLauncherBytes
        ), isUsableStableLauncher(stableLauncher),
        stableLauncher.data == generatedStableLauncher(officialCodexURL: sourceURL)
        else {
            throw CodexAutoConnectError.unavailable(
                "Blabee 고정 실행기가 없거나 이전 앱을 가리킵니다. "
                    + "Blabee 설정에서 Codex 자동 연결을 다시 활성화해 복구해 주세요."
            )
        }
        return configuration
    }

    /// Keeps an already-sourced v3 shell usable during an app upgrade. v3 is
    /// the only legacy shell contract that delegates ordinary `codex` back to
    /// the coordinator through `codex-launch`; rejecting it here would make
    /// native Codex unavailable until the user opened a new shell. Managed
    /// approval still requires the current v4 contract above.
    private func nativeRuntimeConfiguration() throws -> ManagedConfiguration {
        try validateSecureDirectories()
        guard let managed = try secureFile(
            at: managedFileURL,
            maximumBytes: Self.maximumManagedFileBytes
        ), let configuration = managedConfiguration(managed.data)
        else {
            throw CodexAutoConnectError.unavailable(
                "Blabee Codex 자동 연결 설정이 없어 실행을 중단했습니다."
            )
        }
        if configuration.schema == .currentV4 {
            return try runtimeConfiguration()
        }
        guard configuration.schema == .legacyV3,
              let zshRCPath = configuration.zshRCPath,
              URL(
                fileURLWithPath: configuration.coordinatorPath,
                isDirectory: false
              ).standardizedFileURL == coordinatorURL.standardizedFileURL
        else {
            throw CodexAutoConnectError.unavailable(
                "이전 자동 연결 설정은 실행하지 않습니다. Blabee 설정에서 자동 연결을 복구해 주세요."
            )
        }
        let sourceURL = URL(
            fileURLWithPath: configuration.officialCodexPath,
            isDirectory: false
        )
        let expected = generatedLegacyV3ManagedFile(
            coordinatorURL: coordinatorURL,
            zshRCWasMissing: configuration.zshRCWasMissing,
            officialCodexURL: sourceURL,
            zshRCURL: URL(fileURLWithPath: zshRCPath, isDirectory: false)
        )
        guard managed.data == expected else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "이전 Blabee Codex 자동 연결 설정이 손상되었습니다."
            )
        }
        return configuration
    }

    /// Resolves the native Codex name path recorded by the opt-in shell
    /// integration without applying Blabee's managed-mode version allowlist.
    /// This path is used only for native pass-through; managed approval keeps
    /// its separate, fail-closed trust gate.
    func nativeCodexForLaunch() throws -> URL {
        let configuration = try nativeRuntimeConfiguration()
        let executable = URL(
            fileURLWithPath: configuration.officialCodexPath,
            isDirectory: false
        ).standardizedFileURL
        guard executable.path.hasPrefix("/"),
              executable != coordinatorURL.standardizedFileURL,
              executable != stableLauncherURL.standardizedFileURL,
              FileManager.default.isExecutableFile(atPath: executable.path)
        else {
            throw CodexAutoConnectError.unavailable(
                "기록된 공식 Codex 실행 경로를 사용할 수 없습니다."
            )
        }
        return executable
    }

    /// Returns a short-lived, revalidated executable token. The common fast
    /// path performs no version process and takes no mutation lock. Only a
    /// safe identity drift enters the locked qualification path.
    func approvedCodexForLaunch() throws -> CodexRuntimeApprovedExecutable {
        let configuration = try runtimeConfiguration()
        let sourcePath = configuration.officialCodexPath
        let approvalFile = try secureFile(
            at: runtimeApprovalURL,
            maximumBytes: Self.maximumRuntimeApprovalBytes
        )
        guard let approval = try decodedRuntimeApproval(approvalFile),
              approval.stableSourcePath == sourcePath
        else {
            throw CodexAutoConnectError.unavailable(
                "Codex 실행 승인 기록이 없어 자동 연결을 복구해야 합니다."
            )
        }
        do {
            return try runtimeTrustGate.revalidate(approval: approval)
        } catch CodexRuntimeTrustError.approvalDrift {
            // A supported Homebrew update is requalified once under the same
            // lock used by enable/disable and approval publication.
        } catch {
            throw CodexAutoConnectError.unavailable(error.localizedDescription)
        }

        return try withExclusiveLock(createDirectories: false) {
            let lockedConfiguration = try runtimeConfiguration()
            guard lockedConfiguration.officialCodexPath == sourcePath else {
                throw CodexAutoConnectError.unavailable(
                    "Codex 승인 이름 경로가 실행 준비 중 변경되었습니다."
                )
            }
            let currentFile = try secureFile(
                at: runtimeApprovalURL,
                maximumBytes: Self.maximumRuntimeApprovalBytes
            )
            guard let currentApproval = try decodedRuntimeApproval(currentFile),
                  currentApproval.stableSourcePath == sourcePath
            else {
                throw CodexAutoConnectError.unavailable(
                    "Codex 실행 승인 기록이 실행 준비 중 사라졌습니다."
                )
            }
            if let alreadyApproved = try? runtimeTrustGate.revalidate(
                approval: currentApproval
            ) {
                return alreadyApproved
            }
            let replacement: CodexRuntimeApproval
            do {
                replacement = try runtimeTrustGate.qualify(
                    sourceURL: URL(fileURLWithPath: sourcePath, isDirectory: false),
                    versionReader: { codexVersionReader($0) }
                )
            } catch {
                throw CodexAutoConnectError.unavailable(error.localizedDescription)
            }
            try atomicWrite(
                try replacement.encodedData(),
                to: runtimeApprovalURL,
                expected: currentFile,
                defaultMode: 0o600
            )
            do {
                return try runtimeTrustGate.revalidate(approval: replacement)
            } catch {
                throw CodexAutoConnectError.unavailable(error.localizedDescription)
            }
        }
    }

    /// Re-checks an already selected executable without permitting a new
    /// target to be qualified. Managed app-server and TUI launches use this
    /// between spawns so one session cannot mix two Codex versions.
    func revalidateCodexForSpawn(
        _ expected: CodexRuntimeApprovedExecutable
    ) throws -> URL {
        let configuration = try runtimeConfiguration()
        let approvalFile = try secureFile(
            at: runtimeApprovalURL,
            maximumBytes: Self.maximumRuntimeApprovalBytes
        )
        guard let approval = try decodedRuntimeApproval(approvalFile),
              approval.stableSourcePath == configuration.officialCodexPath
        else {
            throw CodexAutoConnectError.unavailable(
                "Codex 실행 승인 기록이 관리형 실행 중 사라졌습니다."
            )
        }
        let current: CodexRuntimeApprovedExecutable
        do {
            current = try runtimeTrustGate.revalidate(approval: approval)
        } catch {
            throw CodexAutoConnectError.unavailable(error.localizedDescription)
        }
        guard current == expected else {
            throw CodexAutoConnectError.unavailable(
                "Codex 실행 파일이 관리형 프로세스를 시작하는 사이 변경되었습니다."
            )
        }
        return current.canonicalURL
    }

    private func markerBlock() -> Data {
        let managed = Self.shellQuote(managedFileURL.path)
        return Data((
            Self.openingMarker + "\n"
                + "if [[ -r " + managed + " ]]; then\n"
                + "  source " + managed + "\n"
                + "fi\n"
                + Self.closingMarker + "\n"
        ).utf8)
    }

    private func enabledZshRC(prefix: Data, suffix: Data) -> Data {
        var result = prefix
        if !result.isEmpty { result.append(0x0A) }
        result.append(markerBlock())
        result.append(suffix)
        return result
    }

    private func restoredZshRC(prefix: Data, suffix: Data) -> Data {
        var result = prefix
        // The managed block carried the line boundary while installed. Keep
        // one boundary when later user bytes would otherwise join an existing
        // unterminated line during disable.
        if !prefix.isEmpty, !suffix.isEmpty, prefix.last != 0x0A {
            result.append(0x0A)
        }
        result.append(suffix)
        return result
    }

    private func generatedManagedFile(
        zshRCWasMissing: Bool,
        officialCodexURL: URL,
        zshRCURL: URL
    ) -> Data {
        let officialCodex = Self.shellQuote(officialCodexURL.path)
        let coordinatorMetadata = Data(stableLauncherURL.path.utf8).base64EncodedString()
        let officialMetadata = Data(officialCodexURL.path.utf8).base64EncodedString()
        let zshRCMetadata = Data(zshRCURL.path.utf8).base64EncodedString()
        return Data((
            Self.generatedHeader
                + "# Generated by Blabee. Do not edit.\n"
                + "# zshrc-origin: \(zshRCWasMissing ? "missing" : "present")\n"
                + "# coordinator-path-base64: \(coordinatorMetadata)\n"
                + "# official-codex-path-base64: \(officialMetadata)\n"
                + "# zshrc-path-base64: \(zshRCMetadata)\n"
                + "\n"
                + "if (( $+aliases[codex] )); then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=alias\n"
                + "elif (( $+functions[codex] )) && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v1 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v2 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v3 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v4 \"$@\"' ]]; then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=function\n"
                + "else\n"
                + "  unset BLABEE_CODEX_AUTO_CONNECT_CONFLICT\n"
                + "  function _blabee_codex_auto_connect_v4 {\n"
                + "    local _blabee_official=\(officialCodex)\n"
                + "    (\n"
                + "      unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "      if [[ -x \"$_blabee_official\" ]]; then\n"
                + "        exec \"$_blabee_official\" \"$@\"\n"
                + "      fi\n"
                + "      print -u2 -- \"공식 Codex 실행 파일을 찾을 수 없습니다. Codex 설치를 확인해 주세요.\"\n"
                + "      exit 127\n"
                + "    )\n"
                + "  }\n"
                + "  function codex { _blabee_codex_auto_connect_v4 \"$@\" }\n"
                + "fi\n"
        ).utf8)
    }

    private func generatedStableLauncher(officialCodexURL: URL) -> Data {
        let officialCodex = Self.shellQuote(officialCodexURL.path)
        let officialMetadata = Data(officialCodexURL.path.utf8).base64EncodedString()
        return Data((
            Self.stableLauncherHeader
                + "# Generated by Blabee. Do not edit.\n"
                + "# official-codex-path-base64: \(officialMetadata)\n"
                + "_blabee_official=\(officialCodex)\n"
                + "if [ ! -x \"$_blabee_official\" ]; then\n"
                + "  printf '%s\\n' \"공식 Codex 실행 파일을 찾을 수 없습니다. Codex 설치를 확인해 주세요.\" >&2\n"
                + "  exit 127\n"
                + "fi\n"
                + "unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "exec \"$_blabee_official\" \"$@\"\n"
        ).utf8)
    }

    private func generatedLegacyV3ManagedFile(
        coordinatorURL: URL,
        zshRCWasMissing: Bool,
        officialCodexURL: URL,
        zshRCURL: URL
    ) -> Data {
        let coordinator = Self.shellQuote(coordinatorURL.path)
        let official = Self.shellQuote(officialCodexURL.path)
        let coordinatorMetadata = Data(coordinatorURL.path.utf8).base64EncodedString()
        let officialMetadata = Data(officialCodexURL.path.utf8).base64EncodedString()
        let zshRCMetadata = Data(zshRCURL.path.utf8).base64EncodedString()
        return Data((
            Self.legacyV3GeneratedHeader
                + "# Generated by Blabee. Do not edit.\n"
                + "# zshrc-origin: \(zshRCWasMissing ? "missing" : "present")\n"
                + "# coordinator-path-base64: \(coordinatorMetadata)\n"
                + "# official-codex-path-base64: \(officialMetadata)\n"
                + "# zshrc-path-base64: \(zshRCMetadata)\n"
                + "\n"
                + "if (( $+aliases[codex] )); then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=alias\n"
                + "elif (( $+functions[codex] )) && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v1 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v2 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v3 \"$@\"' ]]; then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=function\n"
                + "else\n"
                + "  unset BLABEE_CODEX_AUTO_CONNECT_CONFLICT\n"
                + "  function _blabee_codex_auto_connect_v3 {\n"
                + "    local _blabee_coordinator=\(coordinator)\n"
                + "    local _blabee_official=\(official)\n"
                + "    if [[ ! -x \"$_blabee_coordinator\" ]]; then\n"
                + "      print -u2 -- \"Blabee 실행기를 찾을 수 없어 Codex를 자동 실행하지 않았습니다. Blabee를 복구하거나 $_blabee_official 을 직접 실행하세요.\"\n"
                + "      return 127\n"
                + "    fi\n"
                + "    (\n"
                + "      unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "      exec \"$_blabee_coordinator\" codex-launch -- \"$@\"\n"
                + "    )\n"
                + "  }\n"
                + "  function codex { _blabee_codex_auto_connect_v3 \"$@\" }\n"
                + "fi\n"
        ).utf8)
    }

    private func generatedLegacyManagedFile(
        zshRCWasMissing: Bool,
        officialCodexURL: URL
    ) -> Data {
        generatedLegacyManagedFile(
            header: Self.legacyGeneratedHeader,
            zshRCWasMissing: zshRCWasMissing,
            officialCodexURL: officialCodexURL,
            zshRCURL: nil
        )
    }

    private func generatedLegacyV2ManagedFile(
        zshRCWasMissing: Bool,
        officialCodexURL: URL,
        zshRCURL: URL
    ) -> Data {
        generatedLegacyManagedFile(
            header: Self.legacyV2GeneratedHeader,
            zshRCWasMissing: zshRCWasMissing,
            officialCodexURL: officialCodexURL,
            zshRCURL: zshRCURL
        )
    }

    private func generatedLegacyManagedFile(
        header: String,
        zshRCWasMissing: Bool,
        officialCodexURL: URL,
        zshRCURL: URL?
    ) -> Data {
        let coordinator = Self.shellQuote(coordinatorURL.path)
        let official = Self.shellQuote(officialCodexURL.path)
        let coordinatorMetadata = Data(coordinatorURL.path.utf8).base64EncodedString()
        let officialMetadata = Data(officialCodexURL.path.utf8).base64EncodedString()
        let zshRCMetadata = zshRCURL.map {
            "# zshrc-path-base64: " + Data($0.path.utf8).base64EncodedString() + "\n"
        } ?? ""
        return Data((
            header
                + "# Generated by Blabee. Do not edit.\n"
                + "# zshrc-origin: \(zshRCWasMissing ? "missing" : "present")\n"
                + "# coordinator-path-base64: \(coordinatorMetadata)\n"
                + "# official-codex-path-base64: \(officialMetadata)\n"
                + zshRCMetadata
                + "\n"
                + "if (( $+aliases[codex] )); then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=alias\n"
                + "elif (( $+functions[codex] )) && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v1 \"$@\"' ]]; then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=function\n"
                + "else\n"
                + "  unset BLABEE_CODEX_AUTO_CONNECT_CONFLICT\n"
                + "  function _blabee_codex_auto_connect_v1 {\n"
                + "    local _blabee_coordinator=\(coordinator)\n"
                + "    local _blabee_official=\(official)\n"
                + "    if (( $# == 0 )) || [[ $1 == resume ]]; then\n"
                + "      if [[ ! -x \"$_blabee_coordinator\" ]]; then\n"
                + "        (\n"
                + "          unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "          command \"$_blabee_official\" \"$@\"\n"
                + "        )\n"
                + "        return $?\n"
                + "      fi\n"
                + "      (\n"
                + "        unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "        command \"$_blabee_coordinator\" managed-codex --codex \"$_blabee_official\" -- \"$@\"\n"
                + "      )\n"
                + "      return $?\n"
                + "    fi\n"
                + "    (\n"
                + "      unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "      command \"$_blabee_official\" \"$@\"\n"
                + "    )\n"
                + "  }\n"
                + "  function codex { _blabee_codex_auto_connect_v1 \"$@\" }\n"
                + "fi\n"
        ).utf8)
    }

    private func zshRCLayout(_ data: Data?) throws -> ZshRCLayout {
        guard let data else { return .disabled(Data()) }
        let openingBytes = Data(Self.openingMarker.utf8)
        let closingBytes = Data(Self.closingMarker.utf8)
        let openingRanges = Self.ranges(of: openingBytes, in: data)
        let closingRanges = Self.ranges(of: closingBytes, in: data)
        if openingRanges.isEmpty, closingRanges.isEmpty { return .disabled(data) }
        guard openingRanges.count == 1, closingRanges.count == 1 else {
            throw CodexAutoConnectError.conflict(
                ".zshrc의 Blabee 마커가 중복되었거나 손상되었습니다."
            )
        }
        let opening = openingRanges[0]
        let closing = closingRanges[0]
        guard opening.lowerBound < closing.lowerBound,
              opening.upperBound < data.count, data[opening.upperBound] == 0x0A,
              closing.upperBound < data.count, data[closing.upperBound] == 0x0A
        else {
            throw CodexAutoConnectError.conflict(
                ".zshrc의 Blabee 마커 경계가 손상되었습니다."
            )
        }
        let betweenData = data.subdata(in: opening.upperBound..<closing.lowerBound)
        guard let between = String(data: betweenData, encoding: .utf8) else {
            throw CodexAutoConnectError.conflict(".zshrc의 Blabee 블록이 UTF-8 텍스트가 아닙니다.")
        }
        let lines = between.split(separator: "\n", omittingEmptySubsequences: false)
        let legacySource = lines.count == 3 && lines[0].isEmpty && lines[2].isEmpty
            && lines[1].hasPrefix("source ")
        let guardedSource = lines.count == 5 && lines[0].isEmpty && lines[4].isEmpty
            && lines[1].hasPrefix("if [[ -r ") && lines[1].hasSuffix("]]; then")
            && lines[2].hasPrefix("  source ") && lines[3] == "fi"
        guard legacySource || guardedSource else {
            throw CodexAutoConnectError.conflict(".zshrc의 Blabee 블록 형식이 손상되었습니다.")
        }

        var prefixEnd = opening.lowerBound
        if opening.lowerBound != data.startIndex {
            let previous = opening.lowerBound - 1
            guard data[previous] == 0x0A else {
                throw CodexAutoConnectError.conflict(".zshrc의 Blabee 블록 경계가 손상되었습니다.")
            }
            prefixEnd = previous
        }
        let blockEnd = closing.upperBound + 1
        let prefix = data.subdata(in: data.startIndex..<prefixEnd)
        let suffix = data.subdata(in: blockEnd..<data.endIndex)
        let block = data.subdata(in: opening.lowerBound..<blockEnd)
        return .owned(prefix: prefix, suffix: suffix, exactMarker: block == markerBlock())
    }

    private static func ranges(of needle: Data, in haystack: Data) -> [Range<Int>] {
        guard !needle.isEmpty, haystack.count >= needle.count else { return [] }
        var result: [Range<Int>] = []
        var searchStart = haystack.startIndex
        while searchStart <= haystack.endIndex - needle.count,
              let range = haystack.range(of: needle, in: searchStart..<haystack.endIndex)
        {
            result.append(range)
            searchStart = range.upperBound
        }
        return result
    }

    private func managedConfiguration(_ data: Data) -> ManagedConfiguration? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count >= 6,
              lines[1] == "# Generated by Blabee. Do not edit."
        else { return nil }
        let schema: ManagedConfigurationSchema
        switch lines[0] {
        case "# Blabee Codex Auto Connect v4": schema = .currentV4
        case "# Blabee Codex Auto Connect v3": schema = .legacyV3
        case "# Blabee Codex Auto Connect v2": schema = .legacyV2
        case "# Blabee Codex Auto Connect v1": schema = .legacyV1
        default: return nil
        }
        let zshRCWasMissing: Bool
        switch lines[2] {
        case "# zshrc-origin: missing": zshRCWasMissing = true
        case "# zshrc-origin: present": zshRCWasMissing = false
        default: return nil
        }
        let coordinatorPrefix = "# coordinator-path-base64: "
        let officialPrefix = "# official-codex-path-base64: "
        let zshRCPrefix = "# zshrc-path-base64: "
        guard lines[3].hasPrefix(coordinatorPrefix), lines[4].hasPrefix(officialPrefix),
              let coordinatorData = Data(base64Encoded: String(lines[3].dropFirst(coordinatorPrefix.count))),
              let officialData = Data(base64Encoded: String(lines[4].dropFirst(officialPrefix.count))),
              let coordinatorPath = String(data: coordinatorData, encoding: .utf8),
              let officialCodexPath = String(data: officialData, encoding: .utf8),
              coordinatorPath.hasPrefix("/"), officialCodexPath.hasPrefix("/"),
              !coordinatorPath.utf8.contains(0), !officialCodexPath.utf8.contains(0)
        else { return nil }
        let zshRCPath: String?
        switch schema {
        case .currentV4, .legacyV3, .legacyV2:
            guard lines[5].hasPrefix(zshRCPrefix) else { return nil }
            guard let zshRCData = Data(
                base64Encoded: String(lines[5].dropFirst(zshRCPrefix.count))
            ), let decodedZshRCPath = String(data: zshRCData, encoding: .utf8),
            decodedZshRCPath.hasPrefix("/"), !decodedZshRCPath.utf8.contains(0)
            else { return nil }
            zshRCPath = decodedZshRCPath
        case .legacyV1:
            // Shipped v1 files had a blank line after the official path and
            // always targeted $HOME/.zshrc. A path-bearing or damaged v1 file
            // is ambiguous and must not be interpreted as the current schema.
            guard lines[5].isEmpty else { return nil }
            zshRCPath = nil
        }
        return ManagedConfiguration(
            schema: schema,
            zshRCWasMissing: zshRCWasMissing,
            coordinatorPath: coordinatorPath,
            officialCodexPath: officialCodexPath,
            zshRCPath: zshRCPath
        )
    }

    private func installedZshRCURL(managed: SecureFile?) throws -> URL {
        if let managed, let configuration = managedConfiguration(managed.data) {
            guard let path = configuration.zshRCPath else { return legacyZshRCURL }
            let target = URL(fileURLWithPath: path, isDirectory: false).standardizedFileURL
            guard target.path.hasPrefix("/"), target.lastPathComponent == ".zshrc" else {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일의 zshrc 경로가 안전하지 않습니다."
                )
            }
            return target
        }
        // Malformed owned metadata is diagnosed by the caller without trying
        // to guess a dynamic zsh path.
        if let managed, isOwnedManagedFile(managed.data) { return legacyZshRCURL }
        if let zshRCResolutionError { throw zshRCResolutionError }
        return configuredZshRCURL
    }

    private func validateZshRCDirectory(_ url: URL) throws {
        let directory = url.deletingLastPathComponent()
        var info = stat()
        guard lstat(directory.path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              info.st_uid == geteuid(), info.st_mode & 0o022 == 0
        else {
            throw CodexAutoConnectError.unsafeFilesystem(
                ".zshrc 상위 디렉터리가 현재 사용자 소유의 안전한 디렉터리가 아닙니다."
            )
        }
    }

    private func isOwnedManagedFile(_ data: Data) -> Bool {
        data.starts(with: Data(Self.generatedHeader.utf8))
            || data.starts(with: Data(Self.legacyV3GeneratedHeader.utf8))
            || data.starts(with: Data(Self.legacyV2GeneratedHeader.utf8))
            || data.starts(with: Data(Self.legacyGeneratedHeader.utf8))
    }

    private func isOwnedStableLauncher(_ data: Data) -> Bool {
        data.starts(with: Data(Self.stableLauncherHeader.utf8))
            || data.starts(with: Data(Self.legacyStableLauncherHeader.utf8))
    }

    private func isUsableStableLauncher(_ file: SecureFile) -> Bool {
        file.mode == 0o700 && isOwnedStableLauncher(file.data)
    }

    private func currentStableLauncherOfficialCodexURL(_ data: Data) -> URL? {
        guard let contents = String(data: data, encoding: .utf8) else { return nil }
        let lines = contents.split(separator: "\n", omittingEmptySubsequences: false)
        let prefix = "# official-codex-path-base64: "
        guard lines.count > 3,
              lines[0] == "#!/bin/sh",
              lines[1] == "# Blabee Codex Stable Launcher v2",
              lines[3].hasPrefix(prefix),
              let pathData = Data(base64Encoded: String(lines[3].dropFirst(prefix.count))),
              let path = String(data: pathData, encoding: .utf8),
              path.hasPrefix("/")
        else { return nil }
        // Preserve the recorded spelling exactly. Foundation can rewrite
        // equivalent macOS paths (for example /private/var to /var) during
        // standardization, which would make an authentic launcher fail its
        // byte-for-byte regeneration check.
        let url = URL(fileURLWithPath: path, isDirectory: false)
        guard generatedStableLauncher(officialCodexURL: url) == data else { return nil }
        return url
    }

    private func validateExecutables(
        officialCodexURL: URL,
        sourceURL: URL? = nil
    ) throws {
        guard coordinatorURL.path.hasPrefix("/"), officialCodexURL.path.hasPrefix("/") else {
            throw CodexAutoConnectError.unavailable("Codex와 Blabee 실행 경로는 절대 경로여야 합니다.")
        }
        let coordinatorIdentity = try Self.executableIdentity(
            coordinatorURL,
            label: "Blabee coordinator"
        )
        let trustedOfficial = try Self.trustedExecutable(
            sourceURL ?? officialCodexURL,
            label: "공식 Codex",
            dynamicShimRoots: dynamicShimRoots
        )
        let expectedOfficialIdentity = try Self.executableIdentity(
            officialCodexURL,
            label: "공식 Codex"
        )
        guard trustedOfficial.identity == expectedOfficialIdentity else {
            throw CodexAutoConnectError.unavailable(
                "공식 Codex의 승인된 이름 경로가 다른 실행 파일을 가리킵니다."
            )
        }
        let officialIdentity = trustedOfficial.identity
        guard coordinatorIdentity != officialIdentity,
              officialCodexURL.standardizedFileURL != managedFileURL.standardizedFileURL,
              officialCodexURL.standardizedFileURL != stableLauncherURL.standardizedFileURL
        else {
            throw CodexAutoConnectError.conflict(
                "공식 Codex 경로가 Blabee 실행 파일 또는 자동 연결 파일을 다시 가리킵니다."
            )
        }
        if let managedIdentity = try Self.optionalTargetIdentity(managedFileURL),
           officialIdentity == managedIdentity
        {
            throw CodexAutoConnectError.conflict("공식 Codex 경로가 자동 연결 파일을 다시 가리킵니다.")
        }
        if let launcherIdentity = try Self.optionalTargetIdentity(stableLauncherURL),
           officialIdentity == launcherIdentity
        {
            throw CodexAutoConnectError.conflict("공식 Codex 경로가 Blabee 고정 실행기를 다시 가리킵니다.")
        }
    }

    /// Re-checks both identity and the shared Doctor qualification policy.
    /// `enable()` calls this while holding the mutation lock immediately before
    /// any managed file is prepared, so a stale Pet snapshot cannot authorize
    /// an unsupported Codex update.
    private func validateApprovedCodex(
        officialCodexURL: URL,
        sourceURL: URL? = nil
    ) throws -> FileIdentity {
        let stableSource = sourceURL ?? officialCodexURL
        try validateExecutables(
            officialCodexURL: officialCodexURL,
            sourceURL: stableSource
        )
        let identityBefore = try Self.trustedExecutableIdentity(
            stableSource,
            label: "공식 Codex",
            dynamicShimRoots: dynamicShimRoots
        )
        let version = codexVersionReader(officialCodexURL)
        let identityAfter = try Self.trustedExecutableIdentity(
            stableSource,
            label: "공식 Codex",
            dynamicShimRoots: dynamicShimRoots
        )
        guard identityBefore == identityAfter else {
            throw CodexAutoConnectError.unavailable(
                "Codex 버전을 확인하는 동안 실행 파일이 변경되어 자동 연결을 중단했습니다."
            )
        }
        try Self.requireApprovedCodexVersion(version)
        return identityAfter
    }

    private func discoveredCodexApproval() -> Result<FileIdentity, CodexAutoConnectError> {
        guard let officialCodexURL = discoveredOfficialCodexURL,
              let officialCodexSourceURL = discoveredOfficialCodexSourceURL
        else {
            return .failure(officialCodexResolutionError ?? .unavailable(
                "공식 Codex 실행 파일을 찾지 못했습니다."
            ))
        }
        do {
            let current = try Self.trustedExecutableIdentity(
                officialCodexSourceURL,
                label: "공식 Codex",
                dynamicShimRoots: dynamicShimRoots
            )
            if current == prequalifiedOfficialCodexIdentity {
                return .success(current)
            }
            return .success(try validateApprovedCodex(
                officialCodexURL: officialCodexURL,
                sourceURL: officialCodexSourceURL
            ))
        } catch let error as CodexAutoConnectError {
            return .failure(error)
        } catch {
            return .failure(.unavailable(error.localizedDescription))
        }
    }

    private static func requireApprovedCodexVersion(_ version: String?) throws {
        switch CodexCompatibility.qualify(version: version) {
        case .supported:
            return
        case let .alphaQualificationRequired(version):
            throw CodexAutoConnectError.unavailable(
                "Codex CLI \(version)은 추가 호환성 승인이 필요해 자동 연결할 수 없습니다."
            )
        case let .notAllowlisted(version):
            throw CodexAutoConnectError.unavailable(
                "Codex CLI \(version)은 Blabee 지원 버전이 아니어서 자동 연결할 수 없습니다."
            )
        case .unavailable:
            throw CodexAutoConnectError.unavailable(
                "Codex CLI 버전을 안전하게 확인하지 못해 자동 연결할 수 없습니다."
            )
        }
    }

    private static func readCodexVersion(_ url: URL) -> String? {
        guard let result = try? DoctorProcessRunner.run(
            executable: url,
            arguments: ["--version"],
            timeoutMilliseconds: 5_000
        ),
              result.exitCode == 0
        else { return nil }
        return CodexCompatibility.parseVersionOutput(result.stdout)
    }

    private func withExclusiveLock<T>(
        createDirectories: Bool,
        _ body: () throws -> T
    ) throws -> T {
        Self.processMutex.lock()
        defer { Self.processMutex.unlock() }

        if createDirectories { try ensureSecureDirectories() }
        else if FileManager.default.fileExists(atPath: shellDirectoryURL.path) {
            try validateSecureDirectories()
        }
        guard FileManager.default.fileExists(atPath: shellDirectoryURL.path) else {
            return try body()
        }
        let descriptor = open(
            lockFileURL.path,
            O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 잠금 파일을 안전하게 열 수 없습니다.")
        }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_uid == geteuid(), info.st_nlink == 1,
              info.st_mode & 0o022 == 0,
              Self.extendedAccessControlListState(
                lockFileURL.path,
                expected: info
              ) == false
        else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 잠금 파일의 메타데이터가 안전하지 않습니다.")
        }
        var failedAttempts = 0
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            if errno == EINTR { continue }
            guard errno == EWOULDBLOCK || errno == EAGAIN else {
                throw CodexAutoConnectError.writeFailed("자동 연결 잠금을 획득할 수 없습니다.")
            }
            failedAttempts += 1
            guard failedAttempts < lockAttemptLimit else {
                throw CodexAutoConnectError.writeFailed(
                    "다른 Blabee 설정 작업이 끝나지 않아 자동 연결 잠금 시간이 초과되었습니다."
                )
            }
            if lockRetryMicroseconds > 0 { usleep(lockRetryMicroseconds) }
        }
        defer { _ = flock(descriptor, LOCK_UN) }
        return try body()
    }

    private func ensureSecureDirectories() throws {
        try ensureOwnedDirectory(applicationSupportURL)
        try ensureOwnedDirectory(applicationSupportURL.appendingPathComponent("shell", isDirectory: true))
        try ensureOwnedDirectory(shellDirectoryURL)
        try validateSecureDirectories()
    }

    private func ensureOwnedDirectory(_ url: URL) throws {
        var info = stat()
        if lstat(url.path, &info) == 0 {
            try Self.validateOwnedDirectory(info, url: url)
            return
        }
        guard errno == ENOENT else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(url.lastPathComponent) 디렉터리를 검사할 수 없습니다."
            )
        }
        let parent = url.deletingLastPathComponent()
        guard parent.path != url.path, !url.lastPathComponent.isEmpty else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 디렉터리 경로가 안전하지 않습니다.")
        }
        try ensureOwnedDirectory(parent)
        let parentDescriptor = open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parentDescriptor >= 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 상위 디렉터리를 안전하게 열 수 없습니다.")
        }
        defer { close(parentDescriptor) }
        if mkdirat(parentDescriptor, url.lastPathComponent, mode_t(0o700)) != 0, errno != EEXIST {
            throw CodexAutoConnectError.writeFailed("자동 연결 디렉터리를 만들 수 없습니다.")
        }
        guard lstat(url.path, &info) == 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("새 자동 연결 디렉터리를 확인할 수 없습니다.")
        }
        try Self.validateOwnedDirectory(info, url: url)
    }

    private func validateSecureDirectories() throws {
        for url in [applicationSupportURL, applicationSupportURL.appendingPathComponent("shell"), shellDirectoryURL] {
            var info = stat()
            guard lstat(url.path, &info) == 0 else {
                throw CodexAutoConnectError.unsafeFilesystem(
                    "Blabee 자동 연결 디렉터리를 검사할 수 없습니다."
                )
            }
            try Self.validateOwnedDirectory(info, url: url)
        }
    }

    private func validateSecureDirectoriesIfPresent() throws {
        var info = stat()
        guard lstat(shellDirectoryURL.path, &info) == 0 else {
            if errno == ENOENT { return }
            throw CodexAutoConnectError.unsafeFilesystem(
                "Blabee 자동 연결 디렉터리를 검사할 수 없습니다."
            )
        }
        try validateSecureDirectories()
    }

    private static func validateOwnedDirectory(_ info: stat, url: URL) throws {
        guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              info.st_uid == geteuid(), info.st_mode & 0o022 == 0,
              extendedAccessControlListState(url.path, expected: info) == false
        else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(url.lastPathComponent) 디렉터리가 현재 사용자 소유의 안전한 디렉터리가 아닙니다."
            )
        }
    }

    private func secureFile(at url: URL, maximumBytes: Int) throws -> SecureFile? {
        let stableURL = url.standardizedFileURL
        let protectsRuntimeAuthority = stableURL == managedFileURL.standardizedFileURL
            || stableURL == stableLauncherURL.standardizedFileURL
            || stableURL == runtimeApprovalURL.standardizedFileURL
        var named = stat()
        guard lstat(url.path, &named) == 0 else {
            if errno == ENOENT { return nil }
            throw CodexAutoConnectError.unsafeFilesystem("\(url.lastPathComponent)을 검사할 수 없습니다.")
        }
        guard named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              named.st_uid == geteuid(), named.st_nlink == 1,
              named.st_mode & 0o022 == 0,
              named.st_size >= 0, named.st_size <= off_t(maximumBytes),
              (!protectsRuntimeAuthority
                || Self.extendedAccessControlListState(url.path, expected: named) == false)
        else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(url.lastPathComponent)이 심볼릭 링크, 특수 파일, 하드링크, 잘못된 소유자 또는 과도한 크기입니다."
            )
        }
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("\(url.lastPathComponent)을 안전하게 열 수 없습니다.")
        }
        defer { close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0,
              opened.st_dev == named.st_dev, opened.st_ino == named.st_ino,
              opened.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              opened.st_uid == geteuid(), opened.st_nlink == 1,
              opened.st_size == named.st_size,
              Self.sameMutationMetadata(named, opened)
        else {
            throw CodexAutoConnectError.unsafeFilesystem("\(url.lastPathComponent)이 검사 중 변경되었습니다.")
        }
        let data = try Self.readAll(descriptor, expectedBytes: Int(opened.st_size))
        var completed = stat()
        guard fstat(descriptor, &completed) == 0,
              completed.st_dev == opened.st_dev, completed.st_ino == opened.st_ino,
              completed.st_size == opened.st_size,
              Self.sameMutationMetadata(opened, completed)
        else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(url.lastPathComponent)이 내용을 읽는 동안 변경되었습니다."
            )
        }
        return SecureFile(
            data: data,
            device: opened.st_dev,
            inode: opened.st_ino,
            mode: opened.st_mode & 0o777,
            owner: opened.st_uid,
            size: opened.st_size,
            modificationSeconds: Int64(opened.st_mtimespec.tv_sec),
            modificationNanoseconds: Int64(opened.st_mtimespec.tv_nsec),
            changeSeconds: Int64(opened.st_ctimespec.tv_sec),
            changeNanoseconds: Int64(opened.st_ctimespec.tv_nsec),
            flags: opened.st_flags
        )
    }

    private func atomicWrite(
        _ data: Data,
        to destination: URL,
        expected: SecureFile?,
        defaultMode: mode_t,
        replacementMode: mode_t? = nil
    ) throws {
        let directory = destination.deletingLastPathComponent()
        let temporary = directory.appendingPathComponent(
            ".\(destination.lastPathComponent).\(getpid()).\(UUID().uuidString).tmp"
        )
        let mode = replacementMode ?? expected?.mode ?? defaultMode
        let descriptor = open(
            temporary.path,
            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK,
            mode_t(mode)
        )
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일을 만들 수 없습니다.")
        }
        var createdInfo = stat()
        guard fstat(descriptor, &createdInfo) == 0 else {
            close(descriptor)
            throw CodexAutoConnectError.writeFailed(
                "만든 임시 자동 연결 파일의 identity를 확인하지 못해 경로를 보존했습니다: "
                    + temporary.path
            )
        }
        let createdIdentity = RawPathIdentity(
            device: createdInfo.st_dev,
            inode: createdInfo.st_ino,
            fileType: createdInfo.st_mode & mode_t(S_IFMT)
        )
        var openDescriptor = true
        var removePreparedTemporary = true
        var preparedForCleanup: SecureFile?
        defer {
            if openDescriptor { close(descriptor) }
            if removePreparedTemporary {
                if let preparedForCleanup {
                    try? secureUnlink(temporary, expected: preparedForCleanup)
                } else {
                    // Even before the test hook is reachable, do not unlink a
                    // pathname unless it still resolves to the inode we made.
                    cleanupUnpublishedTemporary(
                        temporary,
                        expected: createdIdentity
                    )
                }
            }
        }
        guard fchmod(descriptor, mode_t(mode)) == 0 else {
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일 권한을 설정할 수 없습니다.")
        }
        try Self.writeAll(data, descriptor: descriptor)
        if let expected {
            // ACLs and xattrs are copied explicitly because inode replacement
            // does not preserve them. Non-zero BSD file flags fail closed:
            // safely reproducing every immutable/append flag is outside this MVP.
            guard expected.flags == 0 else {
                throw CodexAutoConnectError.unsafeFilesystem(
                    "BSD 파일 플래그가 있는 설정 파일은 자동으로 교체하지 않습니다."
                )
            }
            try copyPreservedMetadata(
                from: destination,
                expected: expected,
                toDescriptor: descriptor
            )
            guard fchmod(descriptor, mode_t(mode)) == 0 else {
                throw CodexAutoConnectError.writeFailed("기존 설정 파일 모드를 보존할 수 없습니다.")
            }
        }
        guard fsync(descriptor) == 0 else {
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일을 동기화할 수 없습니다.")
        }
        guard close(descriptor) == 0 else {
            openDescriptor = false
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일을 닫을 수 없습니다.")
        }
        openDescriptor = false
        guard let prepared = try secureFile(
            at: temporary,
            maximumBytes: maximumBytes(for: destination)
        ) else {
            throw CodexAutoConnectError.writeFailed("준비한 자동 연결 파일이 사라졌습니다.")
        }
        preparedForCleanup = prepared
        try beforeDestinationReplace?(destination)
        if let expected {
            guard renameatx_np(
                AT_FDCWD,
                temporary.path,
                AT_FDCWD,
                destination.path,
                UInt32(RENAME_SWAP)
            ) == 0 else {
                if !pathContainsPreparedFile(temporary, expected: prepared) {
                    removePreparedTemporary = false
                    throw CodexAutoConnectError.writeFailed(
                        "교환 직전 준비 파일이 바뀌어 대체 파일을 보존했습니다: "
                            + temporary.path
                    )
                }
                throw CodexAutoConnectError.writeFailed(
                    "자동 연결 파일을 원자적으로 교환할 수 없습니다."
                )
            }
            // From this point onward the temporary name may contain user data.
            // Never delete that name from a generic defer path.
            removePreparedTemporary = false
            let displaced: SecureFile
            do {
                _ = try validatePublishedPrepared(destination, expected: prepared)
                try afterPathMutation?(destination)
                let published = try validatePublishedPrepared(destination, expected: prepared)
                displaced = try validateDisplacedFile(temporary, expected: expected)
                try copyCapturedMetadata(
                    from: temporary,
                    expectedSource: displaced,
                    to: destination,
                    expectedDestination: published
                )
                _ = try validatePublishedPrepared(destination, expected: prepared)
                _ = try validateDisplacedFile(temporary, expected: expected)
            } catch {
                try restoreUnexpectedExchange(
                    destination: destination,
                    temporary: temporary,
                    prepared: prepared,
                    reason: error.localizedDescription
                )
            }
            // The expected old inode was atomically displaced. Removing the
            // private capture cannot delete a later editor save at destination.
            try secureUnlink(temporary, expected: displaced)
        } else {
            guard renameatx_np(
                AT_FDCWD,
                temporary.path,
                AT_FDCWD,
                destination.path,
                UInt32(RENAME_EXCL)
            ) == 0 else {
                if !pathContainsPreparedFile(temporary, expected: prepared) {
                    removePreparedTemporary = false
                    throw CodexAutoConnectError.writeFailed(
                        "설치 직전 준비 파일이 바뀌어 대체 파일을 보존했습니다: "
                            + temporary.path
                    )
                }
                throw CodexAutoConnectError.writeFailed(
                    "예상하지 못한 대상 파일이 생겨 새 자동 연결 파일을 설치하지 않았습니다."
                )
            }
            removePreparedTemporary = false
            do {
                _ = try validatePublishedPrepared(destination, expected: prepared)
                try afterPathMutation?(destination)
                _ = try validatePublishedPrepared(destination, expected: prepared)
            } catch {
                try restoreUnexpectedNewInstall(
                    destination: destination,
                    temporary: temporary,
                    prepared: prepared,
                    reason: error.localizedDescription
                )
            }
        }
        try Self.syncDirectory(directory)
    }

    private func secureUnlink(_ url: URL, expected: SecureFile) throws {
        let directory = url.deletingLastPathComponent()
        let captured = directory.appendingPathComponent(
            ".\(url.lastPathComponent).\(getpid()).\(UUID().uuidString).remove"
        )
        guard renameatx_np(
            AT_FDCWD,
            url.path,
            AT_FDCWD,
            captured.path,
            UInt32(RENAME_EXCL)
        ) == 0 else {
            throw CodexAutoConnectError.writeFailed(
                "\(url.lastPathComponent)을 안전하게 분리할 수 없습니다."
            )
        }
        do {
            try afterPathMutation?(url)
            let capturedFile = try secureFile(
                at: captured,
                maximumBytes: maximumBytes(for: url)
            )
            guard let capturedFile,
                  Self.matchesAfterRename(capturedFile, expected: expected)
            else {
                try restoreCapturedFile(captured, to: url)
                throw CodexAutoConnectError.writeFailed(
                    "삭제 대상 파일이 변경되어 삭제를 중단했습니다."
                )
            }
        } catch {
            if try rawPathIdentity(captured) != nil {
                try restoreCapturedFile(captured, to: url)
            }
            throw error
        }
        guard unlink(captured.path) == 0 else {
            throw CodexAutoConnectError.writeFailed(
                "분리한 \(url.lastPathComponent)을 삭제하지 못해 복구 파일을 보존했습니다: "
                    + captured.path
            )
        }
        try Self.syncDirectory(directory)
    }

    private func cleanupUnpublishedTemporary(
        _ url: URL,
        expected: RawPathIdentity
    ) {
        guard (try? rawPathIdentity(url)) == expected else { return }
        let directory = url.deletingLastPathComponent()
        let captured = directory.appendingPathComponent(
            ".\(url.lastPathComponent).\(getpid()).\(UUID().uuidString).discard"
        )
        guard renameatx_np(
            AT_FDCWD,
            url.path,
            AT_FDCWD,
            captured.path,
            UInt32(RENAME_EXCL)
        ) == 0 else { return }
        guard (try? rawPathIdentity(captured)) == expected else {
            try? restoreCapturedFile(captured, to: url)
            return
        }
        _ = unlink(captured.path)
        try? Self.syncDirectory(directory)
    }

    private func restoreUnexpectedExchange(
        destination: URL,
        temporary: URL,
        prepared: SecureFile,
        reason: String
    ) throws -> Never {
        guard let destinationBefore = try rawPathIdentity(destination),
              let temporaryBefore = try rawPathIdentity(temporary)
        else {
            throw CodexAutoConnectError.writeFailed(
                reason + " 두 교환 경로를 그대로 보존했습니다: "
                    + destination.path + ", " + temporary.path
            )
        }
        guard renameatx_np(
            AT_FDCWD,
            temporary.path,
            AT_FDCWD,
            destination.path,
            UInt32(RENAME_SWAP)
        ) == 0 else {
            throw CodexAutoConnectError.writeFailed(
                reason + " 역교환하지 못해 두 경로를 보존했습니다: "
                    + destination.path + ", " + temporary.path
            )
        }
        do {
            try Self.syncDirectory(destination.deletingLastPathComponent())
        } catch {
            throw CodexAutoConnectError.writeFailed(
                reason + " 역교환은 완료됐지만 디렉터리를 동기화하지 못했습니다. 두 경로를 보존했습니다: "
                    + destination.path + ", " + temporary.path
            )
        }
        guard try rawPathIdentity(destination) == temporaryBefore,
              try rawPathIdentity(temporary) == destinationBefore
        else {
            throw CodexAutoConnectError.writeFailed(
                reason + " 역교환 중 추가 변경을 감지해 두 경로를 보존했습니다: "
                    + destination.path + ", " + temporary.path
            )
        }
        if let recoveredPrepared = try? secureFile(
            at: temporary,
            maximumBytes: maximumBytes(for: destination)
        ), Self.matchesAfterRename(recoveredPrepared, expected: prepared) {
            try secureUnlink(temporary, expected: recoveredPrepared)
            throw CodexAutoConnectError.writeFailed(reason)
        }
        throw CodexAutoConnectError.writeFailed(
            reason + " 대체 파일을 검증 없이 삭제하지 않고 보존했습니다: "
                + temporary.path
        )
    }

    private func restoreUnexpectedNewInstall(
        destination: URL,
        temporary: URL,
        prepared: SecureFile,
        reason: String
    ) throws -> Never {
        guard let installedIdentity = try rawPathIdentity(destination) else {
            throw CodexAutoConnectError.writeFailed(
                reason + " 설치 대상 경로를 확인할 수 없습니다: " + destination.path
            )
        }
        guard renameatx_np(
            AT_FDCWD,
            destination.path,
            AT_FDCWD,
            temporary.path,
            UInt32(RENAME_EXCL)
        ) == 0 else {
            throw CodexAutoConnectError.writeFailed(
                reason + " 대체 파일을 보존한 두 경로: "
                    + destination.path + ", " + temporary.path
            )
        }
        do {
            try Self.syncDirectory(destination.deletingLastPathComponent())
        } catch {
            throw CodexAutoConnectError.writeFailed(
                reason + " 설치 복구는 완료됐지만 디렉터리를 동기화하지 못했습니다. 복구 파일을 보존했습니다: "
                    + temporary.path
            )
        }
        guard try rawPathIdentity(temporary) == installedIdentity else {
            throw CodexAutoConnectError.writeFailed(
                reason + " 복구 중 추가 변경을 감지했습니다: " + temporary.path
            )
        }
        if let recoveredPrepared = try? secureFile(
            at: temporary,
            maximumBytes: maximumBytes(for: destination)
        ), Self.matchesAfterRename(recoveredPrepared, expected: prepared) {
            try secureUnlink(temporary, expected: recoveredPrepared)
            throw CodexAutoConnectError.writeFailed(reason)
        }
        throw CodexAutoConnectError.writeFailed(
            reason + " 대체 파일을 검증 없이 삭제하지 않고 보존했습니다: "
                + temporary.path
        )
    }

    private func restoreCapturedFile(_ captured: URL, to original: URL) throws {
        guard renameatx_np(
            AT_FDCWD,
            captured.path,
            AT_FDCWD,
            original.path,
            UInt32(RENAME_EXCL)
        ) == 0 else {
            throw CodexAutoConnectError.writeFailed(
                "변경된 파일을 원래 이름으로 복구하지 못해 복구 파일을 보존했습니다: "
                    + captured.path
            )
        }
        try Self.syncDirectory(original.deletingLastPathComponent())
    }

    private func validatePublishedPrepared(
        _ url: URL,
        expected: SecureFile
    ) throws -> SecureFile {
        guard let current = try secureFile(
            at: url,
            maximumBytes: maximumBytes(for: url)
        ), Self.matchesAfterRename(current, expected: expected) else {
            throw CodexAutoConnectError.writeFailed(
                "게시된 자동 연결 파일이 준비한 inode 또는 내용과 다릅니다."
            )
        }
        return current
    }

    private func validateDisplacedFile(
        _ url: URL,
        expected: SecureFile
    ) throws -> SecureFile {
        guard let current = try secureFile(
            at: url,
            maximumBytes: maximumBytes(for: url)
        ), Self.matchesAfterRename(current, expected: expected) else {
            throw CodexAutoConnectError.writeFailed(
                "원자 교환으로 분리한 기존 파일이 예상 inode 또는 내용과 다릅니다."
            )
        }
        return current
    }

    private func pathContainsPreparedFile(_ url: URL, expected: SecureFile) -> Bool {
        guard let current = try? secureFile(
            at: url,
            maximumBytes: maximumBytes(for: url)
        ) else { return false }
        return Self.matchesAfterRename(current, expected: expected)
    }

    private func rawPathIdentity(_ url: URL) throws -> RawPathIdentity? {
        var info = stat()
        guard lstat(url.path, &info) == 0 else {
            if errno == ENOENT { return nil }
            throw CodexAutoConnectError.writeFailed(
                "복구 경로 identity를 검사할 수 없습니다: " + url.path
            )
        }
        return RawPathIdentity(
            device: info.st_dev,
            inode: info.st_ino,
            fileType: info.st_mode & mode_t(S_IFMT)
        )
    }

    private func copyPreservedMetadata(
        from source: URL,
        expected: SecureFile,
        toDescriptor destinationDescriptor: Int32
    ) throws {
        let sourceDescriptor = open(
            source.path,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        )
        guard sourceDescriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("기존 설정 파일 메타데이터를 열 수 없습니다.")
        }
        defer { close(sourceDescriptor) }
        var info = stat()
        guard fstat(sourceDescriptor, &info) == 0,
              info.st_dev == expected.device, info.st_ino == expected.inode,
              info.st_size == expected.size,
              info.st_mtimespec.tv_sec == expected.modificationSeconds,
              info.st_mtimespec.tv_nsec == expected.modificationNanoseconds,
              info.st_ctimespec.tv_sec == expected.changeSeconds,
              info.st_ctimespec.tv_nsec == expected.changeNanoseconds
        else {
            throw CodexAutoConnectError.writeFailed(
                "기존 설정 파일이 메타데이터 복사 전에 변경되었습니다."
            )
        }
        let currentData = try Self.readAll(sourceDescriptor, expectedBytes: Int(info.st_size))
        guard currentData == expected.data else {
            throw CodexAutoConnectError.writeFailed(
                "기존 설정 파일 내용이 메타데이터 복사 전에 변경되었습니다."
            )
        }
        let sourceMetadataBefore = try Self.capturedMetadata(sourceDescriptor)
        let flags = copyfile_flags_t(COPYFILE_ACL | COPYFILE_XATTR)
        guard fcopyfile(sourceDescriptor, destinationDescriptor, nil, flags) == 0 else {
            throw CodexAutoConnectError.writeFailed("기존 설정 파일의 ACL 또는 확장 속성을 보존할 수 없습니다.")
        }
        let sourceMetadataAfter = try Self.capturedMetadata(sourceDescriptor)
        let destinationMetadata = try Self.capturedMetadata(destinationDescriptor)
        guard sourceMetadataBefore == sourceMetadataAfter,
              destinationMetadata == sourceMetadataAfter
        else {
            throw CodexAutoConnectError.writeFailed(
                "기존 설정 파일의 ACL 또는 확장 속성이 복사 중 변경되었거나 정확히 보존되지 않았습니다."
            )
        }
    }

    private func copyCapturedMetadata(
        from source: URL,
        expectedSource: SecureFile,
        to destination: URL,
        expectedDestination: SecureFile
    ) throws {
        let sourceDescriptor = open(
            source.path,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        )
        guard sourceDescriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("교환된 기존 파일 메타데이터를 열 수 없습니다.")
        }
        defer { close(sourceDescriptor) }
        let destinationDescriptor = open(
            destination.path,
            O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        )
        guard destinationDescriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("게시된 자동 연결 파일 메타데이터를 열 수 없습니다.")
        }
        defer { close(destinationDescriptor) }

        guard Self.descriptorMatches(sourceDescriptor, expected: expectedSource),
              Self.descriptorMatches(destinationDescriptor, expected: expectedDestination)
        else {
            throw CodexAutoConnectError.writeFailed(
                "ACL 또는 확장 속성 동기화 전에 교환된 inode가 변경되었습니다."
            )
        }
        let sourceMetadataBefore = try Self.capturedMetadata(sourceDescriptor)
        let flags = copyfile_flags_t(COPYFILE_ACL | COPYFILE_XATTR)
        guard fcopyfile(sourceDescriptor, destinationDescriptor, nil, flags) == 0 else {
            throw CodexAutoConnectError.writeFailed(
                "교환 직전의 ACL 또는 확장 속성을 게시 파일에 동기화할 수 없습니다."
            )
        }
        guard fsync(destinationDescriptor) == 0 else {
            throw CodexAutoConnectError.writeFailed(
                "동기화한 ACL 또는 확장 속성을 디스크에 반영할 수 없습니다."
            )
        }
        let sourceMetadataAfter = try Self.capturedMetadata(sourceDescriptor)
        let destinationMetadata = try Self.capturedMetadata(destinationDescriptor)
        guard sourceMetadataBefore == sourceMetadataAfter,
              destinationMetadata == sourceMetadataAfter,
              Self.descriptorMatches(sourceDescriptor, expected: expectedSource),
              Self.descriptorMatches(destinationDescriptor, expected: expectedDestination)
        else {
            throw CodexAutoConnectError.writeFailed(
                "교환 직전의 ACL 또는 확장 속성이 복사 중 변경되었거나 정확히 반영되지 않았습니다."
            )
        }
    }

    private static func descriptorMatches(_ descriptor: Int32, expected: SecureFile) -> Bool {
        var info = stat()
        return fstat(descriptor, &info) == 0
            && info.st_dev == expected.device
            && info.st_ino == expected.inode
            && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && info.st_uid == geteuid()
            && info.st_nlink == 1
            && info.st_mode & 0o777 == expected.mode
            && info.st_size == expected.size
            && info.st_mtimespec.tv_sec == expected.modificationSeconds
            && info.st_mtimespec.tv_nsec == expected.modificationNanoseconds
            && info.st_flags == expected.flags
    }

    private static func capturedMetadata(_ descriptor: Int32) throws -> CapturedFileMetadata {
        let acl = try capturedACL(descriptor)
        let xattrs = try capturedExtendedAttributes(descriptor)
        let totalBytes = (acl?.count ?? 0) + xattrs.reduce(0) { partial, entry in
            partial + entry.key.count + entry.value.count
        }
        guard totalBytes <= maximumPreservedMetadataBytes else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "ACL 또는 확장 속성이 안전한 보존 한도를 초과합니다."
            )
        }
        return CapturedFileMetadata(acl: acl, extendedAttributes: xattrs)
    }

    private static func capturedACL(_ descriptor: Int32) throws -> Data? {
        errno = 0
        guard let acl = acl_get_fd(descriptor) else {
            if errno == ENOENT { return nil }
            throw CodexAutoConnectError.writeFailed("파일 ACL을 검사할 수 없습니다.")
        }
        defer { acl_free(UnsafeMutableRawPointer(acl)) }
        var length: ssize_t = 0
        guard let text = acl_to_text(acl, &length), length >= 0 else {
            throw CodexAutoConnectError.writeFailed("파일 ACL을 정규화할 수 없습니다.")
        }
        defer { acl_free(text) }
        return Data(bytes: text, count: Int(length))
    }

    private static func capturedExtendedAttributes(_ descriptor: Int32) throws -> [Data: Data] {
        let namesSize = flistxattr(descriptor, nil, 0, 0)
        guard namesSize >= 0, namesSize <= maximumPreservedMetadataBytes else {
            throw CodexAutoConnectError.writeFailed("확장 속성 이름을 검사할 수 없습니다.")
        }
        if namesSize == 0 { return [:] }
        var names = [UInt8](repeating: 0, count: namesSize)
        let namesRead = names.withUnsafeMutableBytes { bytes in
            flistxattr(
                descriptor,
                bytes.baseAddress?.assumingMemoryBound(to: CChar.self),
                bytes.count,
                0
            )
        }
        guard namesRead == namesSize else {
            throw CodexAutoConnectError.writeFailed("확장 속성 목록이 검사 중 변경되었습니다.")
        }

        var result: [Data: Data] = [:]
        var start = 0
        for index in 0..<names.count where names[index] == 0 {
            guard index > start else {
                throw CodexAutoConnectError.writeFailed("확장 속성 이름 형식이 손상되었습니다.")
            }
            let name = Data(names[start..<index])
            if name == systemManagedProvenanceAttribute {
                // macOS rewrites this system-managed value when metadata is
                // copied to a new inode. It cannot be byte-preserved by the
                // application, so exclude it from equality checks while still
                // preserving every user-managed xattr through fcopyfile.
                start = index + 1
                continue
            }
            var cName = Array(names[start..<index])
            cName.append(0)
            let valueSize = cName.withUnsafeBytes { bytes in
                fgetxattr(
                    descriptor,
                    bytes.baseAddress!.assumingMemoryBound(to: CChar.self),
                    nil,
                    0,
                    0,
                    0
                )
            }
            guard valueSize >= 0, valueSize <= maximumPreservedMetadataBytes else {
                throw CodexAutoConnectError.writeFailed("확장 속성 값을 검사할 수 없습니다.")
            }
            var value = [UInt8](repeating: 0, count: valueSize)
            let valueRead = cName.withUnsafeBytes { nameBytes in
                value.withUnsafeMutableBytes { valueBytes in
                    fgetxattr(
                        descriptor,
                        nameBytes.baseAddress!.assumingMemoryBound(to: CChar.self),
                        valueBytes.baseAddress,
                        valueBytes.count,
                        0,
                        0
                    )
                }
            }
            guard valueRead == valueSize else {
                throw CodexAutoConnectError.writeFailed("확장 속성 값이 검사 중 변경되었습니다.")
            }
            result[name] = Data(value)
            start = index + 1
        }
        guard start == names.count else {
            throw CodexAutoConnectError.writeFailed("확장 속성 목록이 NUL로 끝나지 않습니다.")
        }
        return result
    }

    private func maximumBytes(for url: URL) -> Int {
        let stable = url.standardizedFileURL
        if stable == managedFileURL.standardizedFileURL {
            return Self.maximumManagedFileBytes
        }
        if stable == stableLauncherURL.standardizedFileURL {
            return Self.maximumStableLauncherBytes
        }
        if stable == runtimeApprovalURL.standardizedFileURL {
            return Self.maximumRuntimeApprovalBytes
        }
        return Self.maximumZshRCBytes
    }

    private static func sameMutationMetadata(_ lhs: stat, _ rhs: stat) -> Bool {
        lhs.st_mtimespec.tv_sec == rhs.st_mtimespec.tv_sec
            && lhs.st_mtimespec.tv_nsec == rhs.st_mtimespec.tv_nsec
            && lhs.st_ctimespec.tv_sec == rhs.st_ctimespec.tv_sec
            && lhs.st_ctimespec.tv_nsec == rhs.st_ctimespec.tv_nsec
    }

    /// Renaming changes ctime even when the same inode and bytes were moved.
    /// Compare all stable file/content properties while deliberately ignoring
    /// only that path-mutation timestamp.
    private static func matchesAfterRename(_ current: SecureFile, expected: SecureFile) -> Bool {
        current.data == expected.data
            && current.device == expected.device
            && current.inode == expected.inode
            && current.mode == expected.mode
            && current.size == expected.size
            && current.modificationSeconds == expected.modificationSeconds
            && current.modificationNanoseconds == expected.modificationNanoseconds
            && current.flags == expected.flags
    }

    private static func resolveZshRCURL(
        homeURL: URL,
        environment: [String: String]
    ) throws -> URL {
        let zDotDirectory: URL
        if let rawZDOTDIR = environment["ZDOTDIR"], !rawZDOTDIR.isEmpty {
            guard rawZDOTDIR.hasPrefix("/"), !rawZDOTDIR.utf8.contains(0) else {
                throw CodexAutoConnectError.unavailable(
                    "상대 경로 ZDOTDIR는 안전하게 자동 연결할 수 없습니다."
                )
            }
            zDotDirectory = URL(fileURLWithPath: rawZDOTDIR, isDirectory: true)
                .standardizedFileURL
        } else {
            zDotDirectory = homeURL.standardizedFileURL
        }

        let startupFiles: [(url: URL, allowedOwners: Set<uid_t>, label: String)] = [
            (
                zDotDirectory.appendingPathComponent(".zshenv", isDirectory: false),
                [geteuid()],
                "초기 ZDOTDIR의 .zshenv"
            ),
            (URL(fileURLWithPath: "/etc/zshenv"), [0], "시스템 /etc/zshenv"),
            (URL(fileURLWithPath: "/etc/zsh/zshenv"), [0], "시스템 /etc/zsh/zshenv"),
        ]
        for startupFile in startupFiles {
            guard let data = try readOptionalStartupFile(
                startupFile.url,
                allowedOwners: startupFile.allowedOwners,
                label: startupFile.label
            ) else { continue }
            guard let text = String(data: data, encoding: .utf8) else {
                throw CodexAutoConnectError.unavailable(
                    "\(startupFile.label)가 UTF-8 텍스트가 아니어서 ZDOTDIR를 판별할 수 없습니다."
                )
            }
            let hasExecutableConfiguration = text
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .contains { !$0.isEmpty && !$0.hasPrefix("#") }
            if hasExecutableConfiguration {
                throw CodexAutoConnectError.unavailable(
                    "\(startupFile.label)에 실행 가능한 설정이 있어 간접 ZDOTDIR를 안전하게 판별하지 못했습니다. "
                        + "해당 시작 파일을 정리한 뒤 다시 시도해 주세요."
                )
            }
        }
        return zDotDirectory.appendingPathComponent(".zshrc", isDirectory: false)
    }

    private static func readOptionalStartupFile(
        _ url: URL,
        allowedOwners: Set<uid_t>,
        label: String
    ) throws -> Data? {
        var named = stat()
        guard lstat(url.path, &named) == 0 else {
            if errno == ENOENT { return nil }
            throw CodexAutoConnectError.unavailable("\(label)를 안전하게 검사할 수 없습니다.")
        }
        guard named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              allowedOwners.contains(named.st_uid), named.st_nlink == 1,
              named.st_mode & 0o022 == 0,
              extendedAccessControlListState(url.path, expected: named) == false,
              named.st_size >= 0, named.st_size <= 64 * 1_024
        else {
            throw CodexAutoConnectError.unavailable(
                "\(label)가 안전한 일반 파일이 아니어서 ZDOTDIR를 판별할 수 없습니다."
            )
        }
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.unavailable("\(label)를 안전하게 열 수 없습니다.")
        }
        defer { close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0,
              opened.st_dev == named.st_dev, opened.st_ino == named.st_ino,
              opened.st_size == named.st_size, sameMutationMetadata(named, opened)
        else {
            throw CodexAutoConnectError.unavailable("\(label)가 검사 중 변경되었습니다.")
        }
        let data = try readAll(descriptor, expectedBytes: Int(opened.st_size))
        var completed = stat()
        guard fstat(descriptor, &completed) == 0,
              completed.st_dev == opened.st_dev, completed.st_ino == opened.st_ino,
              completed.st_size == opened.st_size, sameMutationMetadata(opened, completed)
        else {
            throw CodexAutoConnectError.unavailable("\(label)가 읽는 동안 변경되었습니다.")
        }
        return data
    }

    private static func discoverOfficialCodex(
        environment: [String: String],
        homeURL: URL,
        coordinatorURL: URL,
        integrationURL: URL,
        dynamicShimRoots shimRoots: [DynamicShimRoot],
        versionReader: @Sendable (URL) -> String?
    ) throws -> DiscoveredOfficialCodex {
        var candidates: [URL] = []
        for entry in (environment["PATH"] ?? "").split(separator: ":", omittingEmptySubsequences: false) {
            let path = String(entry)
            guard path.hasPrefix("/") else { continue }
            candidates.append(URL(fileURLWithPath: path, isDirectory: true).appendingPathComponent("codex"))
        }
        if let nvmBin = environment["NVM_BIN"], nvmBin.hasPrefix("/"),
           !nvmBin.utf8.contains(0)
        {
            candidates.append(
                URL(fileURLWithPath: nvmBin, isDirectory: true).appendingPathComponent("codex")
            )
        }
        candidates.append(homeURL.appendingPathComponent(".local/bin/codex"))
        candidates.append(contentsOf: safeNVMVersionCandidates(homeURL: homeURL))
        candidates.append(URL(fileURLWithPath: "/opt/homebrew/bin/codex"))
        candidates.append(URL(fileURLWithPath: "/usr/local/bin/codex"))
        var seen = Set<String>()
        let coordinatorIdentity = try? executableIdentity(coordinatorURL, label: "Blabee coordinator")
        let integrationIdentity = try? optionalTargetIdentity(integrationURL)
        var firstCandidateError: CodexAutoConnectError?
        for candidate in candidates {
            let stable = candidate.standardizedFileURL
            guard seen.insert(stable.path).inserted else { continue }
            if let shim = dynamicShimLabel(for: stable, roots: shimRoots) {
                firstCandidateError = firstCandidateError ?? .unavailable(
                    "\(shim) shim의 Codex는 프로젝트에 따라 target이 달라져 자동 연결에서 제외했습니다. "
                        + "shim이 아닌 실제 Codex 실행 파일을 안전한 PATH 또는 NVM_BIN으로 제공해 주세요."
                )
                continue
            }
            let trusted: DiscoveredOfficialCodex
            do {
                trusted = try trustedExecutable(
                    stable,
                    label: "공식 Codex",
                    dynamicShimRoots: shimRoots
                )
            } catch let error as CodexAutoConnectError {
                var existing = stat()
                if lstat(stable.path, &existing) == 0 {
                    firstCandidateError = firstCandidateError ?? error
                }
                continue
            } catch {
                continue
            }
            guard trusted.identity != coordinatorIdentity,
                  trusted.identity != integrationIdentity,
                  stable != integrationURL.standardizedFileURL
            else { continue }
            let version = versionReader(trusted.url)
            guard let executableAfterVersion = try? trustedExecutable(
                stable,
                label: "공식 Codex",
                dynamicShimRoots: shimRoots
            ), executableAfterVersion.identity == trusted.identity else {
                firstCandidateError = firstCandidateError ?? .unavailable(
                    "Codex 버전을 확인하는 동안 실행 파일이 변경되었습니다."
                )
                continue
            }
            do {
                try requireApprovedCodexVersion(version)
            } catch let error as CodexAutoConnectError {
                firstCandidateError = firstCandidateError ?? error
                continue
            } catch {
                continue
            }
            return executableAfterVersion
        }
        if let firstCandidateError { throw firstCandidateError }
        throw CodexAutoConnectError.unavailable(
            "절대 PATH 항목과 지원하는 사용자/표준 설치 경로에서 공식 Codex 실행 파일을 찾지 못했습니다."
        )
    }

    private static func safeNVMVersionCandidates(homeURL: URL) -> [URL] {
        let versions = homeURL.appendingPathComponent(".nvm/versions/node", isDirectory: true)
        guard isSafeOwnedDirectory(versions),
              let entries = try? FileManager.default.contentsOfDirectory(
                at: versions,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
              )
        else { return [] }
        return entries
            .filter {
                isSafeOwnedDirectory($0)
                    && isSafeOwnedDirectory($0.appendingPathComponent("bin", isDirectory: true))
            }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedDescending }
            .map { $0.appendingPathComponent("bin/codex", isDirectory: false) }
    }

    private static func isSafeOwnedDirectory(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0
            && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && info.st_uid == geteuid()
            && info.st_mode & 0o022 == 0
    }

    private static func trustedExecutableIdentity(
        _ url: URL,
        label: String,
        dynamicShimRoots: [DynamicShimRoot] = []
    ) throws -> FileIdentity {
        try trustedExecutable(
            url,
            label: label,
            dynamicShimRoots: dynamicShimRoots
        ).identity
    }

    private static func trustedExecutable(
        _ url: URL,
        label: String,
        dynamicShimRoots: [DynamicShimRoot] = []
    ) throws -> DiscoveredOfficialCodex {
        let namedURL = url.standardizedFileURL
        if let namedShim = dynamicShimLabel(for: namedURL, roots: dynamicShimRoots) {
            throw CodexAutoConnectError.unavailable(
                "\(label) 경로가 프로젝트별로 달라지는 \(namedShim) shim입니다. "
                    + "shim이 아닌 실제 Codex 실행 파일을 선택해 주세요."
            )
        }
        return try trustedNonShimExecutable(
            namedURL,
            label: label,
            dynamicShimRoots: dynamicShimRoots
        )
    }

    private static func trustedNonShimExecutable(
        _ namedURL: URL,
        label: String,
        dynamicShimRoots: [DynamicShimRoot]
    ) throws -> DiscoveredOfficialCodex {
        let stableSourceURL = try normalizedStableSourceURL(namedURL)
        var named = stat()
        guard lstat(stableSourceURL.path, &named) == 0,
              named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
                || named.st_mode & mode_t(S_IFMT) == mode_t(S_IFLNK),
              named.st_uid == 0 || named.st_uid == geteuid()
        else {
            throw CodexAutoConnectError.unavailable(
                "\(label) 이름 경로의 소유권 또는 파일 형식이 안전하지 않습니다."
            )
        }
        if named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
           named.st_mode & 0o022 != 0
        {
            throw CodexAutoConnectError.unavailable(
                "\(label) 실행 파일을 그룹 또는 다른 사용자가 수정할 수 있습니다."
            )
        }

        guard let resolvedPointer = realpath(stableSourceURL.path, nil) else {
            throw CodexAutoConnectError.unavailable(
                "\(label) target의 실제 경로를 안전하게 확인할 수 없습니다."
            )
        }
        defer { free(resolvedPointer) }
        let resolvedPath = String(cString: resolvedPointer)
        let resolvedURL = URL(fileURLWithPath: resolvedPath, isDirectory: false)
        guard let resolvedShim = dynamicShimLabel(for: resolvedURL, roots: dynamicShimRoots) else {
            let monitoredHomebrewRoot = monitoredHomebrewRoot(
                sourcePath: stableSourceURL.path,
                resolvedPath: resolvedPath
            )
            try validateTrustedAncestors(
                ofPath: stableSourceURL.path,
                label: label,
                monitoredHomebrewRoot: monitoredHomebrewRoot
            )
            try validateTrustedAncestors(
                ofPath: resolvedPath,
                label: label,
                monitoredHomebrewRoot: monitoredHomebrewRoot
            )
            var target = stat()
            guard lstat(resolvedPath, &target) == 0,
                  target.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                  target.st_uid == 0 || target.st_uid == geteuid(),
                  target.st_mode & 0o022 == 0,
                  extendedAccessControlListState(resolvedPath, expected: target) == false,
                  access(resolvedPath, X_OK) == 0
            else {
                throw CodexAutoConnectError.unavailable(
                    "\(label) target이 신뢰할 수 있는 실행 파일이 아닙니다."
                )
            }
            return DiscoveredOfficialCodex(
                sourceURL: stableSourceURL,
                url: resolvedURL,
                identity: fileIdentity(target)
            )
        }
        throw CodexAutoConnectError.unavailable(
            "\(label) target이 프로젝트별로 달라지는 \(resolvedShim) shim입니다. "
                + "shim이 아닌 실제 Codex 실행 파일을 선택해 주세요."
        )
    }

    private static func validateTrustedAncestors(
        ofPath path: String,
        label: String,
        monitoredHomebrewRoot: String?
    ) throws {
        var directory = (path as NSString).deletingLastPathComponent
        while true {
            var info = stat()
            guard lstat(directory, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                  info.st_uid == 0 || info.st_uid == geteuid(),
                  extendedAccessControlListState(directory, expected: info) == false,
                  isTrustedExecutableDirectory(
                      info,
                      path: directory,
                      monitoredHomebrewRoot: monitoredHomebrewRoot
                  )
            else {
                throw CodexAutoConnectError.unavailable(
                    "\(label) 상위 경로의 권한, 그룹 구성 또는 ACL을 안전하게 증명할 수 없습니다: \(directory)"
                )
            }
            let parent = (directory as NSString).deletingLastPathComponent
            if parent == directory { break }
            directory = parent
        }
    }

    private static func isTrustedExecutableDirectory(
        _ info: stat,
        path: String,
        monitoredHomebrewRoot: String?
    ) -> Bool {
        guard info.st_mode & 0o002 == 0 else { return false }
        guard info.st_mode & 0o020 != 0 else { return true }
        guard let monitoredHomebrewRoot else { return false }
        return path == monitoredHomebrewRoot
            || path.hasPrefix(monitoredHomebrewRoot + "/")
    }

    private static func monitoredHomebrewRoot(
        sourcePath: String,
        resolvedPath: String
    ) -> String? {
        if sourcePath == "/opt/homebrew/bin/codex",
           resolvedPath.hasPrefix("/opt/homebrew/Cellar/")
            || resolvedPath.hasPrefix("/opt/homebrew/Caskroom/")
        {
            return "/opt/homebrew"
        }
        if sourcePath == "/usr/local/bin/codex",
           resolvedPath.hasPrefix("/usr/local/Cellar/")
            || resolvedPath.hasPrefix("/usr/local/Caskroom/")
        {
            return "/usr/local"
        }
        return nil
    }

    private static func extendedAccessControlListState(
        _ path: String,
        expected: stat
    ) -> Bool? {
        var flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        if expected.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) {
            flags |= O_DIRECTORY
        }
        let descriptor = open(path, flags)
        guard descriptor >= 0 else { return nil }
        defer { close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0,
              sameTrustIdentity(expected, opened)
        else { return nil }

        errno = 0
        let accessControlList = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let accessControlListErrno = errno
        var completed = stat()
        var namedAfter = stat()
        guard fstat(descriptor, &completed) == 0,
              lstat(path, &namedAfter) == 0,
              sameTrustIdentity(opened, completed),
              sameTrustIdentity(opened, namedAfter)
        else {
            if let accessControlList {
                acl_free(UnsafeMutableRawPointer(accessControlList))
            }
            return nil
        }
        if let accessControlList {
            let containsGrant = blabeeExtendedACLContainsGrant(accessControlList)
            acl_free(UnsafeMutableRawPointer(accessControlList))
            return containsGrant
        }
        guard accessControlListErrno == ENOENT else { return nil }
        return false
    }

    private static func sameTrustIdentity(_ lhs: stat, _ rhs: stat) -> Bool {
        lhs.st_dev == rhs.st_dev
            && lhs.st_ino == rhs.st_ino
            && lhs.st_mode == rhs.st_mode
            && lhs.st_uid == rhs.st_uid
            && lhs.st_gid == rhs.st_gid
    }

    private static func dynamicShimRoots(
        environment: [String: String],
        homeURL: URL
    ) -> [DynamicShimRoot] {
        var result = [
            DynamicShimRoot(
                url: homeURL.appendingPathComponent(".asdf/shims", isDirectory: true),
                label: "asdf"
            ),
            DynamicShimRoot(
                url: homeURL.appendingPathComponent(".volta/bin", isDirectory: true),
                label: "Volta"
            ),
        ]
        if let asdfData = environment["ASDF_DATA_DIR"],
           asdfData.hasPrefix("/"), !asdfData.utf8.contains(0)
        {
            result.append(DynamicShimRoot(
                url: URL(fileURLWithPath: asdfData, isDirectory: true)
                    .appendingPathComponent("shims", isDirectory: true),
                label: "ASDF_DATA_DIR"
            ))
        }
        if let voltaHome = environment["VOLTA_HOME"],
           voltaHome.hasPrefix("/"), !voltaHome.utf8.contains(0)
        {
            result.append(DynamicShimRoot(
                url: URL(fileURLWithPath: voltaHome, isDirectory: true)
                    .appendingPathComponent("bin", isDirectory: true),
                label: "VOLTA_HOME"
            ))
        }
        var seen = Set<String>()
        return result.compactMap { root in
            let stable = (try? normalizedStableSourceURL(root.url))
                ?? root.url.standardizedFileURL
            guard seen.insert(stable.path).inserted else { return nil }
            return DynamicShimRoot(url: stable, label: root.label)
        }
    }

    private static func dynamicShimLabel(
        for url: URL,
        roots: [DynamicShimRoot]
    ) -> String? {
        let candidatePaths = Set([
            url.standardizedFileURL.path,
            ((try? normalizedStableSourceURL(url))
                ?? url.standardizedFileURL).path,
        ])
        if candidatePaths.contains(where: { $0.contains("/.asdf/shims/") }) {
            return "asdf"
        }
        if candidatePaths.contains(where: { $0.contains("/.volta/bin/") }) {
            return "Volta"
        }
        for root in roots {
            let rootPaths = Set([
                root.url.standardizedFileURL.path,
                ((try? normalizedStableSourceURL(root.url))
                    ?? root.url.standardizedFileURL).path,
            ])
            if candidatePaths.contains(where: { candidate in
                rootPaths.contains(where: { rootPath in
                    candidate == rootPath || candidate.hasPrefix(rootPath + "/")
                })
            }) {
                return root.label
            }
        }
        return nil
    }

    private static func executableIdentity(_ url: URL, label: String) throws -> FileIdentity {
        var named = stat()
        guard lstat(url.path, &named) == 0,
              named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
                || named.st_mode & mode_t(S_IFMT) == mode_t(S_IFLNK)
        else {
            throw CodexAutoConnectError.unavailable("\(label) 경로가 파일이나 심볼릭 링크가 아닙니다.")
        }
        var target = stat()
        guard stat(url.path, &target) == 0,
              target.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              access(url.path, X_OK) == 0
        else {
            throw CodexAutoConnectError.unavailable("\(label) 실행 파일이 없거나 실행할 수 없습니다.")
        }
        return fileIdentity(target)
    }

    private static func optionalTargetIdentity(_ url: URL) throws -> FileIdentity? {
        var info = stat()
        guard lstat(url.path, &info) == 0 else {
            if errno == ENOENT { return nil }
            throw CodexAutoConnectError.unsafeFilesystem("파일 identity를 검사할 수 없습니다.")
        }
        guard stat(url.path, &info) == 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("파일 target identity를 검사할 수 없습니다.")
        }
        return fileIdentity(info)
    }

    private static func fileIdentity(_ info: stat) -> FileIdentity {
        FileIdentity(
            device: info.st_dev,
            inode: info.st_ino,
            mode: info.st_mode,
            owner: info.st_uid,
            group: info.st_gid,
            size: info.st_size,
            modificationSeconds: Int64(info.st_mtimespec.tv_sec),
            modificationNanoseconds: Int64(info.st_mtimespec.tv_nsec),
            changeSeconds: Int64(info.st_ctimespec.tv_sec),
            changeNanoseconds: Int64(info.st_ctimespec.tv_nsec)
        )
    }

    /// Resolves aliases in the parent directory without resolving the final
    /// launcher entry itself. This keeps a Homebrew symlink stable while
    /// avoiding lexical aliases such as `/var` versus `/private/var` in the
    /// durable runtime approval.
    private static func normalizedStableSourceURL(_ url: URL) throws -> URL {
        let stable = url.standardizedFileURL
        let parent = stable.deletingLastPathComponent()
        guard !stable.lastPathComponent.isEmpty,
              let resolvedParentPointer = realpath(parent.path, nil)
        else {
            throw CodexAutoConnectError.unavailable(
                "공식 Codex 이름 경로의 상위 디렉터리를 안전하게 확인할 수 없습니다."
            )
        }
        defer { free(resolvedParentPointer) }
        return URL(
            fileURLWithPath: String(cString: resolvedParentPointer),
            isDirectory: true
        ).appendingPathComponent(stable.lastPathComponent, isDirectory: false)
    }

    private static func sameIdentity(
        _ runtime: CodexRuntimeFileIdentity,
        _ expected: FileIdentity
    ) -> Bool {
        runtime.device == UInt64(expected.device)
            && runtime.inode == UInt64(expected.inode)
            && runtime.mode == UInt32(expected.mode)
            && runtime.owner == UInt32(expected.owner)
            && runtime.group == UInt32(expected.group)
            && runtime.size == Int64(expected.size)
            && runtime.modificationSeconds == expected.modificationSeconds
            && runtime.modificationNanoseconds == expected.modificationNanoseconds
            && runtime.changeSeconds == expected.changeSeconds
            && runtime.changeNanoseconds == expected.changeNanoseconds
    }

    private static func readAll(_ descriptor: Int32, expectedBytes: Int) throws -> Data {
        var data = Data()
        data.reserveCapacity(expectedBytes)
        var buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw CodexAutoConnectError.unsafeFilesystem("파일 내용을 읽을 수 없습니다.")
            }
            data.append(contentsOf: buffer[0..<count])
        }
        guard data.count == expectedBytes else {
            throw CodexAutoConnectError.unsafeFilesystem("파일 크기가 읽는 동안 변경되었습니다.")
        }
        return data
    }

    private static func writeAll(_ data: Data, descriptor: Int32) throws {
        try data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let count = Darwin.write(descriptor, base.advanced(by: offset), rawBuffer.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw CodexAutoConnectError.writeFailed("자동 연결 파일을 쓸 수 없습니다.")
                }
                offset += count
            }
        }
    }

    private static func syncDirectory(_ url: URL) throws {
        let descriptor = open(url.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("자동 연결 디렉터리를 열 수 없습니다.")
        }
        defer { close(descriptor) }
        guard fsync(descriptor) == 0 else {
            throw CodexAutoConnectError.writeFailed("자동 연결 디렉터리를 동기화할 수 없습니다.")
        }
    }

    private static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

/// Pins one managed Codex process tree to the first fully approved executable.
///
/// The first call may perform the manager's bounded qualification path. Every
/// later call only revalidates that exact token, so a supported Codex update
/// cannot silently enter an already-running managed session. The lock covers
/// both initial selection and subsequent validation, making `next` safe to
/// share with the primary launcher and auxiliary-session broker.
final class CodexAutoConnectApprovedExecutableProvider: @unchecked Sendable {
    private let manager: CodexAutoConnectManager
    private let stateLock = NSLock()
    private var approvedExecutable: CodexRuntimeApprovedExecutable?

    init(manager: CodexAutoConnectManager) {
        self.manager = manager
    }

    func next() throws -> URL {
        stateLock.lock()
        defer { stateLock.unlock() }

        if let approvedExecutable {
            return try manager.revalidateCodexForSpawn(approvedExecutable)
        }

        let selected = try manager.approvedCodexForLaunch()
        approvedExecutable = selected
        return selected.canonicalURL
    }
}

private enum ZshRCLayout {
    case disabled(Data)
    case owned(prefix: Data, suffix: Data, exactMarker: Bool)
}

private struct SecureFile: Equatable {
    let data: Data
    let device: dev_t
    let inode: ino_t
    let mode: mode_t
    let owner: uid_t
    let size: off_t
    let modificationSeconds: Int64
    let modificationNanoseconds: Int64
    let changeSeconds: Int64
    let changeNanoseconds: Int64
    let flags: UInt32
}

private struct RawPathIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
    let fileType: mode_t
}

private struct CapturedFileMetadata: Equatable {
    let acl: Data?
    let extendedAttributes: [Data: Data]
}

struct FileIdentity: Equatable, Sendable {
    let device: dev_t
    let inode: ino_t
    let mode: mode_t
    let owner: uid_t
    let group: gid_t
    let size: off_t
    let modificationSeconds: Int64
    let modificationNanoseconds: Int64
    let changeSeconds: Int64
    let changeNanoseconds: Int64
}

private enum ManagedConfigurationSchema: Equatable {
    case legacyV1
    case legacyV2
    case legacyV3
    case currentV4
}

private struct ManagedConfiguration {
    let schema: ManagedConfigurationSchema
    let zshRCWasMissing: Bool
    let coordinatorPath: String
    let officialCodexPath: String
    let zshRCPath: String?
}

private struct DiscoveredOfficialCodex {
    let sourceURL: URL
    let url: URL
    let identity: FileIdentity
}

struct DynamicShimRoot: Sendable {
    let url: URL
    let label: String
}
