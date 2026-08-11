import Foundation

enum LauncherSourceMode: String, Codable, Equatable, Sendable {
    case managed
    case readOnly = "read_only"
}

struct ResolvedLauncherDataRoot: Equatable, Sendable {
    let url: URL
    let sourceMode: LauncherSourceMode
}

enum LauncherDataRootPolicy {
    static let maximumPathLength = 1_024

    private static let knownStoreMarkers = [
        ".local/sync/latest.json",
        ".local/attention/monitor.json",
        ".local/connectors/github/snapshot.json",
        ".local/connectors/codex/snapshot.json",
        ".local/connectors/notion/snapshot.json",
        ".local/connectors/google-calendar/snapshot.json"
    ]

    static func managedDefaultURL(
        fileManager: FileManager = .default
    ) throws -> URL {
        guard let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw LauncherDataRootError.applicationSupportUnavailable
        }
        let candidate = applicationSupport
            .appendingPathComponent("Blabase", isDirectory: true)
            .standardizedFileURL
        try rejectManagedLocation(candidate, fileManager: fileManager)
        var isDirectory: ObjCBool = false
        if fileManager.fileExists(
            atPath: candidate.path,
            isDirectory: &isDirectory
        ) {
            let attributes = try? fileManager.attributesOfItem(
                atPath: candidate.path
            )
            guard
                attributes?[.type] as? FileAttributeType != .typeSymbolicLink
            else {
                throw LauncherDataRootError.unsafeRoot
            }
            guard isDirectory.boolValue else {
                throw LauncherDataRootError.notDirectory
            }
            let resolved = candidate
                .resolvingSymlinksInPath()
                .standardizedFileURL
            let values = try? resolved.resourceValues(
                forKeys: [.isDirectoryKey, .isPackageKey]
            )
            guard values?.isDirectory == true else {
                throw LauncherDataRootError.notDirectory
            }
            guard values?.isPackage != true else {
                throw LauncherDataRootError.appBundle
            }
        }
        return candidate
    }

    static func resolveManagedDefault(
        fileManager: FileManager = .default
    ) throws -> ResolvedLauncherDataRoot {
        let candidate = try managedDefaultURL(fileManager: fileManager)
        try rejectManagedLocation(candidate, fileManager: fileManager)
        try fileManager.createDirectory(
            at: candidate,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try fileManager.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: candidate.path
        )
        let resolved = candidate
            .resolvingSymlinksInPath()
            .standardizedFileURL
        try rejectManagedLocation(resolved, fileManager: fileManager)
        guard fileManager.isWritableFile(atPath: resolved.path) else {
            throw LauncherDataRootError.notWritableForRuntime
        }
        return ResolvedLauncherDataRoot(
            url: resolved,
            sourceMode: .managed
        )
    }

    static func validateExistingRoot(
        path rawPath: String,
        fileManager: FileManager = .default,
        requireKnownStore: Bool = true
    ) throws -> URL {
        try validatePathText(rawPath)
        let candidate = URL(
            fileURLWithPath: rawPath,
            isDirectory: true
        ).standardizedFileURL
        guard candidate.lastPathComponent != ".local" else {
            throw LauncherDataRootError.selectParentOfLocal
        }

        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(
            atPath: candidate.path,
            isDirectory: &isDirectory
        ) else {
            throw LauncherDataRootError.missing
        }
        guard isDirectory.boolValue else {
            throw LauncherDataRootError.notDirectory
        }
        guard fileManager.isReadableFile(atPath: candidate.path) else {
            throw LauncherDataRootError.notReadable
        }
        guard fileManager.isWritableFile(atPath: candidate.path) else {
            throw LauncherDataRootError.notWritableForRuntime
        }

        let resolved = candidate
            .resolvingSymlinksInPath()
            .standardizedFileURL
        try rejectUnsafe(resolved, fileManager: fileManager)
        let values = try? resolved.resourceValues(
            forKeys: [.isDirectoryKey, .isPackageKey]
        )
        guard values?.isDirectory == true else {
            throw LauncherDataRootError.notDirectory
        }
        guard values?.isPackage != true else {
            throw LauncherDataRootError.appBundle
        }

        if requireKnownStore {
            let localStore = resolved.appendingPathComponent(
                ".local",
                isDirectory: true
            )
            var isLocalDirectory: ObjCBool = false
            guard
                fileManager.fileExists(
                    atPath: localStore.path,
                    isDirectory: &isLocalDirectory
                ),
                isLocalDirectory.boolValue,
                fileManager.isReadableFile(atPath: localStore.path),
                fileManager.isWritableFile(atPath: localStore.path)
            else {
                throw LauncherDataRootError.notWritableForRuntime
            }
            let resolvedLocalStore = localStore
                .resolvingSymlinksInPath()
                .standardizedFileURL
            let rootPrefix = resolved.path.hasSuffix("/")
                ? resolved.path
                : resolved.path + "/"
            guard resolvedLocalStore.path.hasPrefix(rootPrefix) else {
                throw LauncherDataRootError.unsafeRoot
            }
            guard hasKnownStoreMarker(
                root: resolved,
                fileManager: fileManager
            ) else {
                throw LauncherDataRootError.unrecognizedStore
            }
        }
        return resolved
    }

    static func resolveLegacyOverride(
        path rawPath: String,
        fileManager: FileManager = .default
    ) throws -> ResolvedLauncherDataRoot {
        try validatePathText(rawPath)
        let candidate = URL(
            fileURLWithPath: rawPath,
            isDirectory: true
        ).standardizedFileURL
        try rejectUnsafe(candidate, fileManager: fileManager)
        try fileManager.createDirectory(
            at: candidate,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let resolved = candidate
            .resolvingSymlinksInPath()
            .standardizedFileURL
        try rejectUnsafe(resolved, fileManager: fileManager)
        return ResolvedLauncherDataRoot(
            url: resolved,
            sourceMode: .readOnly
        )
    }

    private static func validatePathText(_ rawPath: String) throws {
        guard
            rawPath.hasPrefix("/"),
            !rawPath.isEmpty,
            rawPath.count <= maximumPathLength,
            rawPath.unicodeScalars.allSatisfy({ scalar in
                !CharacterSet.controlCharacters.contains(scalar)
                    && !(0x202A...0x202E).contains(scalar.value)
                    && !(0x2066...0x2069).contains(scalar.value)
            })
        else {
            throw LauncherDataRootError.invalidPath
        }
    }

    private static func rejectUnsafe(
        _ candidate: URL,
        fileManager: FileManager
    ) throws {
        let resolved = candidate
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let home = fileManager.homeDirectoryForCurrentUser
            .resolvingSymlinksInPath()
            .standardizedFileURL
        guard resolved.path != "/", resolved != home else {
            throw LauncherDataRootError.unsafeRoot
        }
    }

    private static func rejectManagedLocation(
        _ candidate: URL,
        fileManager: FileManager
    ) throws {
        try rejectUnsafe(candidate, fileManager: fileManager)
        let resolved = candidate
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let home = fileManager.homeDirectoryForCurrentUser
            .resolvingSymlinksInPath()
            .standardizedFileURL
        let homePrefix = home.path.hasSuffix("/")
            ? home.path
            : home.path + "/"
        let expected = home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("Blabase", isDirectory: true)
            .standardizedFileURL
        guard
            resolved.path.hasPrefix(homePrefix),
            resolved == expected
        else {
            throw LauncherDataRootError.unsafeRoot
        }
    }

    private static func hasKnownStoreMarker(
        root: URL,
        fileManager: FileManager
    ) -> Bool {
        let rootPrefix = root.path.hasSuffix("/")
            ? root.path
            : root.path + "/"
        return knownStoreMarkers.contains { relativePath in
            let marker = root.appendingPathComponent(relativePath)
            var isDirectory: ObjCBool = false
            guard
                fileManager.fileExists(
                    atPath: marker.path,
                    isDirectory: &isDirectory
                ),
                !isDirectory.boolValue,
                fileManager.isReadableFile(atPath: marker.path)
            else {
                return false
            }
            let resolvedMarker = marker
                .resolvingSymlinksInPath()
                .standardizedFileURL
            let values = try? resolvedMarker.resourceValues(
                forKeys: [.isRegularFileKey]
            )
            return
                resolvedMarker.path.hasPrefix(rootPrefix) &&
                values?.isRegularFile == true
        }
    }
}

enum LauncherDataRootError: LocalizedError, Equatable {
    case applicationSupportUnavailable
    case invalidPath
    case unsafeRoot
    case missing
    case notDirectory
    case notReadable
    case notWritableForRuntime
    case selectParentOfLocal
    case appBundle
    case unrecognizedStore

    var errorDescription: String? {
        switch self {
        case .applicationSupportUnavailable:
            "Blabase 기본 저장소 위치를 확인하지 못했습니다."
        case .invalidPath:
            "절대 경로인 폴더만 연결할 수 있습니다."
        case .unsafeRoot:
            "홈 폴더 전체나 디스크 전체는 연결할 수 없습니다."
        case .missing:
            "선택한 폴더가 더 이상 존재하지 않습니다."
        case .notDirectory:
            "파일이 아니라 Blabase 데이터 폴더를 선택해주세요."
        case .notReadable:
            "선택한 폴더를 읽을 권한이 없습니다."
        case .notWritableForRuntime:
            "Codex 작업 이어가기 상태를 기록할 수 있는 폴더를 선택해주세요."
        case .selectParentOfLocal:
            "`.local` 폴더가 아니라 그 상위 Blabase 폴더를 선택해주세요."
        case .appBundle:
            "앱 자체는 데이터 폴더로 연결할 수 없습니다."
        case .unrecognizedStore:
            "기존 Blabase snapshot이 있는 폴더인지 확인하지 못했습니다."
        }
    }
}
