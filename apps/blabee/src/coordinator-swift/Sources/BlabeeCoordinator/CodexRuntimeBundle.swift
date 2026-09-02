import CryptoKit
import Darwin
import Foundation
import Security

/// Stable, fail-closed reasons returned by the shared managed-runtime validator.
/// Doctor and the launcher use the same validator so their accept/reject rules
/// cannot drift apart.
enum ManagedCodexRuntimeBundleError: LocalizedError, Equatable, Sendable {
    case layout(String)
    case identity(String)
    case bounds(String)
    case changed
    case versionMismatch(manifest: String, qualified: String)
    case targetMismatch(expected: String, actual: String)

    var errorDescription: String? {
        switch self {
        case let .layout(reason):
            "Codex runtime bundle layout is invalid: \(reason)"
        case let .identity(reason):
            "Codex runtime bundle identity is unsafe: \(reason)"
        case let .bounds(reason):
            "Codex runtime bundle exceeds a safety bound: \(reason)"
        case .changed:
            "Codex runtime bundle changed while it was inspected or copied."
        case let .versionMismatch(manifest, qualified):
            "Codex runtime manifest version \(manifest) does not match qualified version \(qualified)."
        case let .targetMismatch(expected, actual):
            "Codex runtime target \(actual) does not match this build (\(expected))."
        }
    }
}

struct ManagedCodexRuntimeBundleManifest: Codable, Equatable, Sendable {
    let layoutVersion: Int
    let version: String
    let target: String
    let variant: String
    let entrypoint: String
    let resourcesDir: String?
    let pathDir: String
}

private enum ManagedCodexRuntimeBundleEntryKind: String, Codable, Sendable {
    case directory
    case file
}

private struct ManagedCodexRuntimeBundleEntry: Codable, Equatable, Sendable {
    let path: String
    let kind: ManagedCodexRuntimeBundleEntryKind
    let identity: ManagedCodexRuntimeBundleStoredIdentity
    let digest: String?
    let executable: Bool
    let signingTeamIdentifier: String?
    let architectures: [Int32]
}

enum ManagedCodexRuntimeExecutableVerification: Equatable, Sendable {
    case production
    #if DEBUG
        case trustedTestFixture
        case mismatchedTeamTestFixture
    #endif
}

private struct ManagedCodexRuntimeBundleStoredIdentity: Codable, Equatable, Sendable {
    let device: UInt64
    let inode: UInt64
    let mode: UInt32
    let owner: UInt32
    let group: UInt32
    let size: Int64
    let modificationSeconds: Int64
    let modificationNanoseconds: Int64
    let changeSeconds: Int64
    let changeNanoseconds: Int64

    init(_ info: stat, stableDirectory: Bool = false) {
        device = UInt64(bitPattern: Int64(info.st_dev))
        inode = UInt64(info.st_ino)
        mode = UInt32(info.st_mode)
        owner = UInt32(info.st_uid)
        group = UInt32(info.st_gid)
        size = stableDirectory ? 0 : Int64(info.st_size)
        modificationSeconds = stableDirectory ? 0 : Int64(info.st_mtimespec.tv_sec)
        modificationNanoseconds = stableDirectory ? 0 : Int64(info.st_mtimespec.tv_nsec)
        changeSeconds = stableDirectory ? 0 : Int64(info.st_ctimespec.tv_sec)
        changeNanoseconds = stableDirectory ? 0 : Int64(info.st_ctimespec.tv_nsec)
    }

    var fileIdentity: CodexRuntimeFileIdentity {
        CodexRuntimeFileIdentity(
            device: device,
            inode: inode,
            mode: mode,
            owner: owner,
            group: group,
            size: size,
            modificationSeconds: modificationSeconds,
            modificationNanoseconds: modificationNanoseconds,
            changeSeconds: changeSeconds,
            changeNanoseconds: changeNanoseconds
        )
    }
}

/// Complete, bounded read-only inspection of one official Codex package.
/// The executable URL is always the real `bin/codex` path, never a launcher
/// symlink. Entry identities and content hashes are retained for revalidation.
struct ManagedCodexRuntimeBundleInspection: Equatable, Sendable {
    let rootURL: URL
    let executableURL: URL
    let codeModeHostURL: URL
    let pathDirectoryURL: URL
    let resourcesDirectoryURL: URL?
    let manifest: ManagedCodexRuntimeBundleManifest
    fileprivate let rootIdentity: ManagedCodexRuntimeBundleStoredIdentity
    fileprivate let entries: [ManagedCodexRuntimeBundleEntry]
    fileprivate let allowsManagedMetadata: Bool
    fileprivate let allowsStagingMetadata: Bool
    fileprivate let executableVerification:
        ManagedCodexRuntimeExecutableVerification

    var manifestVersion: String { manifest.version }
    var target: String { manifest.target }
}

/// Shared production validator for both Doctor and explicit managed launches.
enum ManagedCodexRuntimeBundleInspector {
    static let maximumManifestBytes: Int64 = 64 * 1_024
    static let maximumFileBytes: Int64 = 512 * 1_024 * 1_024
    static let maximumTotalBytes: Int64 = 1_024 * 1_024 * 1_024
    static let maximumEntryCount = 4_096
    static let maximumDirectoryDepth = 12
    static let maximumRelativePathBytes = 1_024

    private static let leaseName = ".lease"
    private static let sealName = ".blabee-runtime-manifest.json"
    private static let stagingMarkerName = ".blabee-runtime-staging.json"

    #if DEBUG
        private static let testingLock = NSLock()
        private nonisolated(unsafe) static var signatureValidationHook:
            (@Sendable (_ label: String, _ path: String) throws -> Void)?
    #endif

    static var expectedTarget: String {
        #if arch(arm64)
            "aarch64-apple-darwin"
        #elseif arch(x86_64)
            "x86_64-apple-darwin"
        #else
            "unsupported-apple-darwin"
        #endif
    }

    static func inspect(
        executableURL: URL,
        expectedExecutableIdentity: CodexRuntimeFileIdentity? = nil,
        executableVerification: ManagedCodexRuntimeExecutableVerification =
            .production
    ) throws -> ManagedCodexRuntimeBundleInspection {
        try inspect(
            executableURL: executableURL,
            expectedExecutableIdentity: expectedExecutableIdentity,
            allowManagedMetadata: false,
            allowStagingMetadata: false,
            executableVerification: executableVerification
        )
    }

    static func revalidate(
        _ inspection: ManagedCodexRuntimeBundleInspection
    ) throws {
        let current = try inspect(
            executableURL: inspection.executableURL,
            expectedExecutableIdentity: nil,
            allowManagedMetadata: inspection.allowsManagedMetadata,
            allowStagingMetadata: inspection.allowsStagingMetadata,
            executableVerification: inspection.executableVerification
        )
        guard current == inspection else {
            throw ManagedCodexRuntimeBundleError.changed
        }
    }

    fileprivate static func inspectPrivateBundle(
        executableURL: URL,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) throws -> ManagedCodexRuntimeBundleInspection {
        try inspect(
            executableURL: executableURL,
            expectedExecutableIdentity: nil,
            allowManagedMetadata: true,
            allowStagingMetadata: false,
            executableVerification: executableVerification
        )
    }

    fileprivate static func inspectPrivateStagingBundle(
        executableURL: URL,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) throws -> ManagedCodexRuntimeBundleInspection {
        try inspect(
            executableURL: executableURL,
            expectedExecutableIdentity: nil,
            allowManagedMetadata: true,
            allowStagingMetadata: true,
            executableVerification: executableVerification
        )
    }

    private static func inspect(
        executableURL: URL,
        expectedExecutableIdentity: CodexRuntimeFileIdentity?,
        allowManagedMetadata: Bool,
        allowStagingMetadata: Bool,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) throws -> ManagedCodexRuntimeBundleInspection {
        guard executableURL.isFileURL,
              !executableURL.path.utf8.contains(0),
              let resolved = realpath(executableURL.path, nil)
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "entrypoint cannot be resolved"
            )
        }
        defer { free(resolved) }
        let canonicalExecutable = URL(
            fileURLWithPath: String(cString: resolved),
            isDirectory: false
        )
        guard canonicalExecutable.lastPathComponent == "codex",
              canonicalExecutable.deletingLastPathComponent().lastPathComponent
                == "bin"
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "entrypoint must be bin/codex"
            )
        }
        let rootURL = canonicalExecutable.deletingLastPathComponent()
            .deletingLastPathComponent()
        let rootDescriptor = open(
            rootURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "bundle root cannot be opened without following links"
            )
        }
        defer { close(rootDescriptor) }
        let rootInfo = try inspectedDirectory(
            descriptor: rootDescriptor,
            label: "bundle root"
        )

        var rootNames = Set(try directoryNames(
            rootDescriptor,
            maximumNames: 7
        ))
        var metadataNames = Set([leaseName, sealName])
        if allowStagingMetadata { metadataNames.insert(stagingMarkerName) }
        if allowManagedMetadata {
            rootNames.subtract(metadataNames)
        } else if !rootNames.isDisjoint(with: metadataNames) {
            throw ManagedCodexRuntimeBundleError.layout(
                "source package contains reserved Blabee metadata"
            )
        }

        var namedManifest = stat()
        guard fstatat(
            rootDescriptor,
            "codex-package.json",
            &namedManifest,
            AT_SYMLINK_NOFOLLOW
        ) == 0,
              namedManifest.st_mode & S_IFMT == S_IFREG,
              namedManifest.st_nlink == 1
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "codex-package.json is a link or special file"
            )
        }
        let manifestDescriptor = openat(
            rootDescriptor,
            "codex-package.json",
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard manifestDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.layout(
                "codex-package.json is missing"
            )
        }
        defer { close(manifestDescriptor) }
        var count = 0
        var totalBytes: Int64 = 0
        let manifestCapture = try inspectedManifestFile(
            descriptor: manifestDescriptor,
            count: &count,
            totalBytes: &totalBytes
        )
        guard manifestCapture.entry.identity
            == ManagedCodexRuntimeBundleStoredIdentity(namedManifest)
        else { throw ManagedCodexRuntimeBundleError.changed }
        let manifestData = manifestCapture.data
        let manifest = try decodeManifest(manifestData)
        guard manifest.layoutVersion == 1 else {
            throw ManagedCodexRuntimeBundleError.layout(
                "layoutVersion must be 1"
            )
        }
        guard manifest.variant == "codex",
              manifest.entrypoint == "bin/codex",
              manifest.pathDir == "codex-path",
              manifest.resourcesDir == nil
                || manifest.resourcesDir == "codex-resources"
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "manifest paths or variant are unsupported"
            )
        }
        guard manifest.version.count <= 64,
              isSimpleVersion(manifest.version)
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "manifest version is malformed"
            )
        }
        guard manifest.target == expectedTarget else {
            throw ManagedCodexRuntimeBundleError.targetMismatch(
                expected: expectedTarget,
                actual: manifest.target
            )
        }

        var expectedTop = Set(["codex-package.json", "bin", "codex-path"])
        if manifest.resourcesDir != nil { expectedTop.insert("codex-resources") }
        guard rootNames == expectedTop else {
            throw ManagedCodexRuntimeBundleError.layout(
                "bundle root contains missing or unknown entries"
            )
        }

        var entries = [manifestCapture.entry]
        let binDescriptor = try openInspectedDirectory(
            parentDescriptor: rootDescriptor,
            name: "bin",
            relativePath: "bin",
            entries: &entries,
            count: &count
        )
        defer { close(binDescriptor) }
        guard Set(try directoryNames(binDescriptor, maximumNames: 3))
            == Set(["codex", "codex-code-mode-host"])
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "bin must contain only codex and codex-code-mode-host"
            )
        }
        let codexEntry = try inspectedFile(
            parentDescriptor: binDescriptor,
            name: "codex",
            relativePath: "bin/codex",
            requiresNativeExecutable: true,
            maximumBytes: maximumFileBytes,
            count: &count,
            totalBytes: &totalBytes,
            executableVerification: executableVerification
        )
        entries.append(codexEntry)
        entries.append(try inspectedFile(
            parentDescriptor: binDescriptor,
            name: "codex-code-mode-host",
            relativePath: "bin/codex-code-mode-host",
            requiresNativeExecutable: true,
            maximumBytes: maximumFileBytes,
            count: &count,
            totalBytes: &totalBytes,
            executableVerification: executableVerification
        ))

        let pathDescriptor = try openInspectedDirectory(
            parentDescriptor: rootDescriptor,
            name: "codex-path",
            relativePath: "codex-path",
            entries: &entries,
            count: &count
        )
        defer { close(pathDescriptor) }
        guard Set(try directoryNames(pathDescriptor, maximumNames: 2))
            == Set(["rg"])
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "codex-path must contain only rg"
            )
        }
        entries.append(try inspectedFile(
            parentDescriptor: pathDescriptor,
            name: "rg",
            relativePath: "codex-path/rg",
            requiresNativeExecutable: true,
            maximumBytes: maximumFileBytes,
            count: &count,
            totalBytes: &totalBytes,
            executableVerification: executableVerification
        ))

        var resourcesURL: URL?
        if manifest.resourcesDir != nil {
            let resourcesDescriptor = try openInspectedDirectory(
                parentDescriptor: rootDescriptor,
                name: "codex-resources",
                relativePath: "codex-resources",
                entries: &entries,
                count: &count
            )
            defer { close(resourcesDescriptor) }
            try inspectResourceDirectory(
                descriptor: resourcesDescriptor,
                relativePath: "codex-resources",
                depth: 1,
                entries: &entries,
                count: &count,
                totalBytes: &totalBytes
                , executableVerification: executableVerification
            )
            resourcesURL = rootURL.appendingPathComponent(
                "codex-resources",
                isDirectory: true
            )
        }

        if let expectedExecutableIdentity {
            guard codexEntry.identity.fileIdentity == expectedExecutableIdentity
            else { throw ManagedCodexRuntimeBundleError.changed }
        }
        guard count == entries.count,
              count <= maximumEntryCount,
              totalBytes <= maximumTotalBytes
        else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "entry count or total byte limit exceeded"
            )
        }
        if allowManagedMetadata {
            guard rootInfo.st_uid == geteuid(),
                  rootInfo.st_mode & 0o777 == 0o700,
                  entries.allSatisfy({ entry in
                      let expectedMode: UInt32
                      switch entry.kind {
                      case .directory:
                          expectedMode = 0o700
                      case .file:
                          expectedMode = entry.executable ? 0o500 : 0o400
                      }
                      return entry.identity.owner == UInt32(geteuid())
                        && entry.identity.mode & 0o777 == expectedMode
                  })
            else {
                throw ManagedCodexRuntimeBundleError.identity(
                    "private runtime permissions are not sealed"
                )
            }
        }
        let executableEntries = entries.filter(\.executable)
        let teams = Set(executableEntries.compactMap(\.signingTeamIdentifier))
        guard !executableEntries.isEmpty,
              executableEntries.allSatisfy({
                  $0.signingTeamIdentifier?.isEmpty == false
                    && $0.architectures.contains(expectedCPUType)
              }),
              teams.count == 1
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "executables must be valid, share one Team ID, and contain the current architecture"
            )
        }

        return ManagedCodexRuntimeBundleInspection(
            rootURL: rootURL,
            executableURL: canonicalExecutable,
            codeModeHostURL: rootURL.appendingPathComponent(
                "bin/codex-code-mode-host",
                isDirectory: false
            ),
            pathDirectoryURL: rootURL.appendingPathComponent(
                "codex-path",
                isDirectory: true
            ),
            resourcesDirectoryURL: resourcesURL,
            manifest: manifest,
            rootIdentity: ManagedCodexRuntimeBundleStoredIdentity(
                rootInfo,
                stableDirectory: true
            ),
            entries: entries.sorted { $0.path < $1.path },
            allowsManagedMetadata: allowManagedMetadata,
            allowsStagingMetadata: allowStagingMetadata,
            executableVerification: executableVerification
        )
    }

    private static func decodeManifest(
        _ data: Data
    ) throws -> ManagedCodexRuntimeBundleManifest {
        try requireBoundedJSONDepth(data)
        try requireUniqueJSONKeys(data)
        let object: Any
        do { object = try JSONSerialization.jsonObject(with: data) }
        catch {
            throw ManagedCodexRuntimeBundleError.layout(
                "codex-package.json is not valid JSON"
            )
        }
        guard let dictionary = object as? [String: Any] else {
            throw ManagedCodexRuntimeBundleError.layout(
                "codex-package.json must be an object"
            )
        }
        let required = Set([
            "layoutVersion", "version", "target", "variant", "entrypoint",
            "pathDir",
        ])
        let allowed = required.union(["resourcesDir"])
        guard required.isSubset(of: dictionary.keys),
              Set(dictionary.keys).isSubset(of: allowed)
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "codex-package.json has missing or unknown fields"
            )
        }
        if dictionary.keys.contains("resourcesDir"),
           !(dictionary["resourcesDir"] is String)
        {
            throw ManagedCodexRuntimeBundleError.layout(
                "resourcesDir must be an explicit supported string"
            )
        }
        do { return try JSONDecoder().decode(
            ManagedCodexRuntimeBundleManifest.self,
            from: data
        ) } catch {
            throw ManagedCodexRuntimeBundleError.layout(
                "codex-package.json field types are invalid"
            )
        }
    }

    private static func inspectResourceDirectory(
        descriptor: Int32,
        relativePath: String,
        depth: Int,
        entries: inout [ManagedCodexRuntimeBundleEntry],
        count: inout Int,
        totalBytes: inout Int64,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) throws {
        guard depth <= maximumDirectoryDepth else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "resource directory depth exceeded"
            )
        }
        let remaining = maximumEntryCount - count
        guard remaining >= 0 else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "entry count exceeded"
            )
        }
        for name in try directoryNames(
            descriptor,
            maximumNames: remaining
        ) {
            try inspectResourceEntry(
                parentDescriptor: descriptor,
                name: name,
                parentPath: relativePath,
                depth: depth,
                entries: &entries,
                count: &count,
                totalBytes: &totalBytes,
                executableVerification: executableVerification
            )
        }
    }

    /// Keeps the number of open descriptors proportional to tree depth rather
    /// than sibling count. A `defer` in the caller's loop would otherwise hold
    /// every visited directory until the complete walk returned.
    private static func inspectResourceEntry(
        parentDescriptor: Int32,
        name: String,
        parentPath: String,
        depth: Int,
        entries: inout [ManagedCodexRuntimeBundleEntry],
        count: inout Int,
        totalBytes: inout Int64,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) throws {
        try requireSafeName(name)
        let childPath = parentPath + "/" + name
        try requireBoundedPath(childPath)
        var info = stat()
        guard fstatat(
            parentDescriptor,
            name,
            &info,
            AT_SYMLINK_NOFOLLOW
        ) == 0 else { throw ManagedCodexRuntimeBundleError.changed }
        let fileType = info.st_mode & S_IFMT
        if fileType == S_IFDIR {
            let child = try openInspectedDirectory(
                parentDescriptor: parentDescriptor,
                name: name,
                relativePath: childPath,
                entries: &entries,
                count: &count
            )
            defer { close(child) }
            try inspectResourceDirectory(
                descriptor: child,
                relativePath: childPath,
                depth: depth + 1,
                entries: &entries,
                count: &count,
                totalBytes: &totalBytes,
                executableVerification: executableVerification
            )
        } else if fileType == S_IFREG {
            entries.append(try inspectedFile(
                parentDescriptor: parentDescriptor,
                name: name,
                relativePath: childPath,
                requiresNativeExecutable: false,
                maximumBytes: maximumFileBytes,
                count: &count,
                totalBytes: &totalBytes,
                executableVerification: executableVerification
            ))
        } else {
            throw ManagedCodexRuntimeBundleError.identity(
                "resource entry is a link or special file: \(childPath)"
            )
        }
    }

    private static func openInspectedDirectory(
        parentDescriptor: Int32,
        name: String,
        relativePath: String,
        entries: inout [ManagedCodexRuntimeBundleEntry],
        count: inout Int
    ) throws -> Int32 {
        try requireSafeName(name)
        try requireBoundedPath(relativePath)
        let descriptor = openat(
            parentDescriptor,
            name,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "directory cannot be opened without following links: \(relativePath)"
            )
        }
        do {
            let info = try inspectedDirectory(
                descriptor: descriptor,
                label: relativePath
            )
            count += 1
            guard count <= maximumEntryCount else {
                throw ManagedCodexRuntimeBundleError.bounds(
                    "entry count exceeded"
                )
            }
            entries.append(ManagedCodexRuntimeBundleEntry(
                path: relativePath,
                kind: .directory,
                identity: ManagedCodexRuntimeBundleStoredIdentity(
                    info,
                    stableDirectory: true
                ),
                digest: nil,
                executable: false,
                signingTeamIdentifier: nil,
                architectures: []
            ))
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func inspectedDirectory(
        descriptor: Int32,
        label: String
    ) throws -> stat {
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & S_IFMT == S_IFDIR,
              isTrustedOwner(info.st_uid),
              info.st_mode & 0o002 == 0
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "directory ownership or mode is unsafe: \(label)"
            )
        }
        try requireNoGrantACL(descriptor, label: label)
        return info
    }

    private static func inspectedFile(
        parentDescriptor: Int32,
        name: String,
        relativePath: String,
        requiresNativeExecutable: Bool,
        maximumBytes: Int64,
        count: inout Int,
        totalBytes: inout Int64,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) throws -> ManagedCodexRuntimeBundleEntry {
        try requireSafeName(name)
        try requireBoundedPath(relativePath)
        var named = stat()
        guard fstatat(
            parentDescriptor,
            name,
            &named,
            AT_SYMLINK_NOFOLLOW
        ) == 0 else {
            throw ManagedCodexRuntimeBundleError.layout(
                "required file is missing: \(relativePath)"
            )
        }
        guard named.st_mode & S_IFMT == S_IFREG,
              named.st_nlink == 1
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "required file is a link, special file, or hardlink: \(relativePath)"
            )
        }
        let descriptor = openat(
            parentDescriptor,
            name,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.layout(
                "required file is missing or unsafe: \(relativePath)"
            )
        }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(info)
                == ManagedCodexRuntimeBundleStoredIdentity(named),
              info.st_mode & S_IFMT == S_IFREG,
              info.st_nlink == 1,
              isTrustedOwner(info.st_uid),
              info.st_mode & 0o022 == 0
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "file ownership, mode, type, or links are unsafe: \(relativePath)"
            )
        }
        guard info.st_size >= 0, info.st_size <= maximumBytes else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "file size exceeded: \(relativePath)"
            )
        }
        try requireNoGrantACL(descriptor, label: relativePath)
        let executable = info.st_mode & 0o111 != 0
        if requiresNativeExecutable {
            guard info.st_mode & 0o111 != 0 else {
                throw ManagedCodexRuntimeBundleError.identity(
                    "required executable is not executable: \(relativePath)"
                )
            }
            try requireNativeExecutable(descriptor, label: relativePath)
        }
        let executableEvidence = executable
            ? try verifyExecutable(
                descriptor: descriptor,
                parentDescriptor: parentDescriptor,
                name: name,
                mode: executableVerification,
                label: relativePath
            )
            : nil
        let digest = try digestFile(
            descriptor: descriptor,
            expectedBytes: Int64(info.st_size),
            label: relativePath
        )
        var completed = stat()
        guard fstat(descriptor, &completed) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(completed)
                == ManagedCodexRuntimeBundleStoredIdentity(info)
        else { throw ManagedCodexRuntimeBundleError.changed }
        count += 1
        totalBytes += Int64(info.st_size)
        guard count <= maximumEntryCount,
              totalBytes <= maximumTotalBytes
        else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "entry count or total byte limit exceeded"
            )
        }
        return ManagedCodexRuntimeBundleEntry(
            path: relativePath,
            kind: .file,
            identity: ManagedCodexRuntimeBundleStoredIdentity(info),
            digest: digest,
            executable: executable,
            signingTeamIdentifier: executableEvidence?.teamIdentifier,
            architectures: executableEvidence?.architectures ?? []
        )
    }

    private static func inspectedManifestFile(
        descriptor: Int32,
        count: inout Int,
        totalBytes: inout Int64
    ) throws -> (entry: ManagedCodexRuntimeBundleEntry, data: Data) {
        var before = stat()
        guard fstat(descriptor, &before) == 0,
              before.st_mode & S_IFMT == S_IFREG,
              before.st_nlink == 1,
              isTrustedOwner(before.st_uid),
              before.st_mode & 0o022 == 0
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "codex-package.json ownership, mode, or links are unsafe"
            )
        }
        guard before.st_size >= 2,
              before.st_size <= maximumManifestBytes
        else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "codex-package.json is empty or too large"
            )
        }
        try requireNoGrantACL(descriptor, label: "codex-package.json")
        let data = try readBoundedFile(
            descriptor: descriptor,
            maximumBytes: maximumManifestBytes,
            label: "codex-package.json"
        )
        var after = stat()
        guard fstat(descriptor, &after) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(after)
                == ManagedCodexRuntimeBundleStoredIdentity(before)
        else { throw ManagedCodexRuntimeBundleError.changed }
        count += 1
        totalBytes += Int64(before.st_size)
        return (
            ManagedCodexRuntimeBundleEntry(
                path: "codex-package.json",
                kind: .file,
                identity: ManagedCodexRuntimeBundleStoredIdentity(before),
                digest: SHA256.hash(data: data)
                    .map { String(format: "%02x", $0) }.joined(),
                executable: false,
                signingTeamIdentifier: nil,
                architectures: []
            ),
            data
        )
    }

    private struct ExecutableEvidence {
        let teamIdentifier: String
        let architectures: [Int32]
    }

    private static var expectedCPUType: Int32 {
        #if arch(arm64)
            Int32(bitPattern: 0x0100_000C)
        #elseif arch(x86_64)
            Int32(bitPattern: 0x0100_0007)
        #else
            0
        #endif
    }

    private static func verifyExecutable(
        descriptor: Int32,
        parentDescriptor: Int32,
        name: String,
        mode: ManagedCodexRuntimeExecutableVerification,
        label: String
    ) throws -> ExecutableEvidence {
        let architectures = try machOArchitectures(
            descriptor: descriptor,
            label: label
        )
        guard architectures.contains(expectedCPUType) else {
            throw ManagedCodexRuntimeBundleError.identity(
                "executable lacks the current CPU architecture: \(label)"
            )
        }
        var pathBuffer = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard fcntl(descriptor, F_GETPATH, &pathBuffer) == 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "executable path cannot be recovered: \(label)"
            )
        }
        guard let terminator = pathBuffer.firstIndex(of: 0),
              let path = String(
                bytes: pathBuffer[..<terminator].map {
                    UInt8(bitPattern: $0)
                },
                encoding: .utf8
              ),
              path.hasPrefix("/"),
              path.precomposedStringWithCanonicalMapping.utf8
                .elementsEqual(path.utf8)
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "executable descriptor path is invalid UTF-8: \(label)"
            )
        }
        let ancestorChain = try openNamedAncestorChain(path: path)
        defer { ancestorChain.descriptors.forEach { close($0) } }
        var before = stat()
        var namedBefore = stat()
        guard fstat(descriptor, &before) == 0,
              fstatat(
                parentDescriptor,
                name,
                &namedBefore,
                AT_SYMLINK_NOFOLLOW
              ) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(namedBefore)
                == ManagedCodexRuntimeBundleStoredIdentity(before),
              lstat(path, &namedBefore) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(namedBefore)
                == ManagedCodexRuntimeBundleStoredIdentity(before),
              validateNamedAncestorChain(ancestorChain)
        else { throw ManagedCodexRuntimeBundleError.changed }
        let teamIdentifier: String
        #if DEBUG
            if mode == .trustedTestFixture
                || mode == .mismatchedTeamTestFixture
            {
                let hook = testingLock.withLock { signatureValidationHook }
                try hook?(label, path)
                teamIdentifier = mode == .mismatchedTeamTestFixture
                    && label == "bin/codex-code-mode-host"
                    ? "BLABEE_OTHER_TEST_FIXTURE"
                    : "BLABEE_TEST_FIXTURE"
            } else {
                teamIdentifier = try signingTeamIdentifier(
                    path: path,
                    label: label
                )
            }
        #else
            teamIdentifier = try signingTeamIdentifier(
                path: path,
                label: label
            )
        #endif
        var after = stat()
        var namedAfter = stat()
        guard fstat(descriptor, &after) == 0,
              fstatat(
                parentDescriptor,
                name,
                &namedAfter,
                AT_SYMLINK_NOFOLLOW
              ) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(namedAfter)
                == ManagedCodexRuntimeBundleStoredIdentity(before),
              lstat(path, &namedAfter) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(after)
                == ManagedCodexRuntimeBundleStoredIdentity(before),
              ManagedCodexRuntimeBundleStoredIdentity(namedAfter)
                == ManagedCodexRuntimeBundleStoredIdentity(before),
              validateNamedAncestorChain(ancestorChain)
        else { throw ManagedCodexRuntimeBundleError.changed }
        return ExecutableEvidence(
            teamIdentifier: teamIdentifier,
            architectures: architectures
        )
    }

    private struct NamedAncestorChain {
        let descriptors: [Int32]
        let componentNames: [String]
        let identities: [ManagedCodexRuntimeBundleStoredIdentity]
    }

    private static func openNamedAncestorChain(
        path: String
    ) throws -> NamedAncestorChain {
        let components = path.split(separator: "/").dropLast().map(String.init)
        var descriptors: [Int32] = []
        var identities: [ManagedCodexRuntimeBundleStoredIdentity] = []
        let root = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "executable ancestor root cannot be opened"
            )
        }
        descriptors.append(root)
        do {
            var rootInfo = stat()
            guard fstat(root, &rootInfo) == 0 else {
                throw ManagedCodexRuntimeBundleError.changed
            }
            identities.append(ManagedCodexRuntimeBundleStoredIdentity(rootInfo))
            var parent = root
            for component in components {
                let child = openat(
                    parent,
                    component,
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                )
                guard child >= 0 else {
                    throw ManagedCodexRuntimeBundleError.changed
                }
                descriptors.append(child)
                var info = stat()
                guard fstat(child, &info) == 0 else {
                    throw ManagedCodexRuntimeBundleError.changed
                }
                identities.append(ManagedCodexRuntimeBundleStoredIdentity(info))
                parent = child
            }
            let chain = NamedAncestorChain(
                descriptors: descriptors,
                componentNames: components,
                identities: identities
            )
            guard validateNamedAncestorChain(chain) else {
                throw ManagedCodexRuntimeBundleError.changed
            }
            return chain
        } catch {
            descriptors.forEach { close($0) }
            throw error
        }
    }

    private static func validateNamedAncestorChain(
        _ chain: NamedAncestorChain
    ) -> Bool {
        guard chain.descriptors.count == chain.identities.count,
              chain.descriptors.count == chain.componentNames.count + 1
        else { return false }
        for index in chain.descriptors.indices {
            var current = stat()
            guard fstat(chain.descriptors[index], &current) == 0,
                  ManagedCodexRuntimeBundleStoredIdentity(current)
                    == chain.identities[index]
            else { return false }
            if index > 0 {
                var named = stat()
                guard fstatat(
                    chain.descriptors[index - 1],
                    chain.componentNames[index - 1],
                    &named,
                    AT_SYMLINK_NOFOLLOW
                ) == 0,
                      ManagedCodexRuntimeBundleStoredIdentity(named)
                        == chain.identities[index]
                else { return false }
            }
        }
        return true
    }

    private static func signingTeamIdentifier(
        path: String,
        label: String
    ) throws -> String {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(
            URL(fileURLWithPath: path) as CFURL,
            SecCSFlags(),
            &code
        ) == errSecSuccess,
        let code
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "code signature cannot be opened: \(label)"
            )
        }
        let flags = SecCSFlags(
            rawValue: UInt32(kSecCSCheckAllArchitectures | kSecCSStrictValidate)
        )
        guard SecStaticCodeCheckValidity(code, flags, nil) == errSecSuccess else {
            throw ManagedCodexRuntimeBundleError.identity(
                "code signature is invalid: \(label)"
            )
        }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(
            code,
            SecCSFlags(rawValue: UInt32(kSecCSSigningInformation)),
            &information
        ) == errSecSuccess,
              let dictionary = information as? [CFString: Any],
              let teamIdentifier = dictionary[kSecCodeInfoTeamIdentifier]
                as? String,
              !teamIdentifier.isEmpty
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "code signature has no Team ID: \(label)"
            )
        }
        return teamIdentifier
    }

    #if DEBUG
        static func setSignatureValidationHook(
            _ hook: (@Sendable (_ label: String, _ path: String) throws -> Void)?
        ) {
            testingLock.withLock { signatureValidationHook = hook }
        }
    #endif

    private static func machOArchitectures(
        descriptor: Int32,
        label: String
    ) throws -> [Int32] {
        var bytes = [UInt8](repeating: 0, count: 4_096)
        let count = bytes.withUnsafeMutableBytes {
            pread(descriptor, $0.baseAddress, $0.count, 0)
        }
        guard count >= 8 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "Mach-O header is truncated: \(label)"
            )
        }
        bytes.removeSubrange(count..<bytes.count)
        let magic = Array(bytes.prefix(4))
        if magic == [0xcf, 0xfa, 0xed, 0xfe]
            || magic == [0xce, 0xfa, 0xed, 0xfe]
        {
            return [Int32(bitPattern: readUInt32(
                bytes,
                at: 4,
                littleEndian: true
            ))]
        }
        if magic == [0xfe, 0xed, 0xfa, 0xcf]
            || magic == [0xfe, 0xed, 0xfa, 0xce]
        {
            return [Int32(bitPattern: readUInt32(
                bytes,
                at: 4,
                littleEndian: false
            ))]
        }
        let fat64: Bool
        let littleEndian: Bool
        if magic == [0xca, 0xfe, 0xba, 0xbe] {
            fat64 = false
            littleEndian = false
        } else if magic == [0xca, 0xfe, 0xba, 0xbf] {
            fat64 = true
            littleEndian = false
        } else if magic == [0xbe, 0xba, 0xfe, 0xca] {
            fat64 = false
            littleEndian = true
        } else if magic == [0xbf, 0xba, 0xfe, 0xca] {
            fat64 = true
            littleEndian = true
        } else {
            throw ManagedCodexRuntimeBundleError.identity(
                "executable is not Mach-O: \(label)"
            )
        }
        let architectureCount = Int(readUInt32(
            bytes,
            at: 4,
            littleEndian: littleEndian
        ))
        guard architectureCount > 0, architectureCount <= 64 else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "Mach-O architecture count is invalid: \(label)"
            )
        }
        let stride = fat64 ? 32 : 20
        guard 8 + architectureCount * stride <= bytes.count else {
            throw ManagedCodexRuntimeBundleError.identity(
                "Mach-O fat header is truncated: \(label)"
            )
        }
        return Array(Set((0..<architectureCount).map { index in
            Int32(bitPattern: readUInt32(
                bytes,
                at: 8 + index * stride,
                littleEndian: littleEndian
            ))
        })).sorted()
    }

    private static func readUInt32(
        _ bytes: [UInt8],
        at offset: Int,
        littleEndian: Bool
    ) -> UInt32 {
        let values = bytes[offset..<(offset + 4)].map(UInt32.init)
        if littleEndian {
            return values[0] | values[1] << 8 | values[2] << 16
                | values[3] << 24
        }
        return values[0] << 24 | values[1] << 16 | values[2] << 8
            | values[3]
    }

    fileprivate static func digestFile(
        descriptor: Int32,
        expectedBytes: Int64,
        label: String
    ) throws -> String {
        guard expectedBytes >= 0, expectedBytes <= maximumFileBytes else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "file size exceeded: \(label)"
            )
        }
        var hasher = SHA256()
        let capacity = 128 * 1_024
        let buffer = UnsafeMutableRawPointer.allocate(
            byteCount: capacity,
            alignment: MemoryLayout<UInt64>.alignment
        )
        defer { buffer.deallocate() }
        var offset: Int64 = 0
        while offset < expectedBytes {
            let requested = min(capacity, Int(expectedBytes - offset))
            var count: Int
            repeat {
                count = pread(descriptor, buffer, requested, off_t(offset))
            } while count < 0 && errno == EINTR
            guard count > 0 else { throw ManagedCodexRuntimeBundleError.changed }
            hasher.update(bufferPointer: UnsafeRawBufferPointer(
                start: buffer,
                count: count
            ))
            offset += Int64(count)
        }
        var extra: UInt8 = 0
        var extraCount: Int
        repeat {
            extraCount = pread(descriptor, &extra, 1, off_t(expectedBytes))
        } while extraCount < 0 && errno == EINTR
        guard extraCount == 0 else { throw ManagedCodexRuntimeBundleError.changed }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func readBoundedFile(
        descriptor: Int32,
        maximumBytes: Int64,
        label: String
    ) throws -> Data {
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & S_IFMT == S_IFREG,
              info.st_nlink == 1,
              info.st_size >= 2,
              info.st_size <= maximumBytes
        else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "file is empty or too large: \(label)"
            )
        }
        var data = Data(count: Int(info.st_size))
        let readCount = data.withUnsafeMutableBytes { bytes -> Int in
            var offset = 0
            while offset < bytes.count {
                var count: Int
                repeat {
                    count = pread(
                        descriptor,
                        bytes.baseAddress?.advanced(by: offset),
                        bytes.count - offset,
                        off_t(offset)
                    )
                } while count < 0 && errno == EINTR
                if count <= 0 { return -1 }
                offset += count
            }
            return offset
        }
        guard readCount == data.count else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        return data
    }

    fileprivate static func directoryNames(
        _ descriptor: Int32,
        maximumNames: Int = maximumEntryCount + 3
    ) throws -> [String] {
        guard maximumNames >= 0,
              maximumNames <= maximumEntryCount + 3
        else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "directory entry count exceeded"
            )
        }
        let duplicate = fcntl(descriptor, F_DUPFD_CLOEXEC, 0)
        guard duplicate >= 0, let directory = fdopendir(duplicate) else {
            if duplicate >= 0 { close(duplicate) }
            throw ManagedCodexRuntimeBundleError.changed
        }
        defer { closedir(directory) }
        rewinddir(directory)
        var names: [String] = []
        var foldedNames = Set<String>()
        while true {
            errno = 0
            guard let entry = readdir(directory) else {
                guard errno == 0 else {
                    throw ManagedCodexRuntimeBundleError.changed
                }
                break
            }
            let decoded = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: Int(NAME_MAX) + 1) {
                    String(validatingCString: $0)
                }
            }
            guard let name = decoded,
                  name.precomposedStringWithCanonicalMapping.utf8
                    .elementsEqual(name.utf8)
            else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "entry name is not valid canonical UTF-8"
                )
            }
            if name == "." || name == ".." { continue }
            try requireSafeName(name)
            guard names.count < maximumNames else {
                throw ManagedCodexRuntimeBundleError.bounds(
                    "directory entry count exceeded"
                )
            }
            let folded = name.folding(
                options: [.caseInsensitive],
                locale: Locale(identifier: "en_US_POSIX")
            )
            guard foldedNames.insert(folded).inserted else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "entry names collide under case folding"
                )
            }
            names.append(name)
        }
        return names.sorted()
    }

    fileprivate static func requireBoundedJSONDepth(_ data: Data) throws {
        var depth = 0
        var inString = false
        var escaped = false
        for byte in data {
            if inString {
                if escaped {
                    escaped = false
                } else if byte == 0x5c {
                    escaped = true
                } else if byte == 0x22 {
                    inString = false
                }
                continue
            }
            if byte == 0x22 {
                inString = true
            } else if byte == 0x7b || byte == 0x5b {
                depth += 1
                guard depth <= 8 else {
                    throw ManagedCodexRuntimeBundleError.bounds(
                        "manifest JSON nesting is too deep"
                    )
                }
            } else if byte == 0x7d || byte == 0x5d {
                depth -= 1
                guard depth >= 0 else {
                    throw ManagedCodexRuntimeBundleError.layout(
                        "manifest JSON delimiters are unbalanced"
                    )
                }
            }
        }
        guard depth == 0, !inString, !escaped else {
            throw ManagedCodexRuntimeBundleError.layout(
                "manifest JSON is incomplete"
            )
        }
    }

    fileprivate static func requireUniqueJSONKeys(_ data: Data) throws {
        let bytes = [UInt8](data)
        var index = 0
        try scanJSONValue(bytes, index: &index, depth: 0)
        skipJSONWhitespace(bytes, index: &index)
        guard index == bytes.count else {
            throw ManagedCodexRuntimeBundleError.layout(
                "manifest JSON contains trailing data"
            )
        }
    }

    private static func scanJSONValue(
        _ bytes: [UInt8],
        index: inout Int,
        depth: Int
    ) throws {
        guard depth <= 8 else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "manifest JSON nesting is too deep"
            )
        }
        skipJSONWhitespace(bytes, index: &index)
        guard index < bytes.count else {
            throw ManagedCodexRuntimeBundleError.layout(
                "manifest JSON value is missing"
            )
        }
        switch bytes[index] {
        case 0x7b:
            try scanJSONObject(bytes, index: &index, depth: depth + 1)
        case 0x5b:
            try scanJSONArray(bytes, index: &index, depth: depth + 1)
        case 0x22:
            _ = try scanJSONString(bytes, index: &index)
        default:
            let start = index
            while index < bytes.count,
                  ![0x20, 0x09, 0x0a, 0x0d, 0x2c, 0x5d, 0x7d]
                    .contains(bytes[index])
            {
                index += 1
            }
            guard index > start else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON scalar is malformed"
                )
            }
        }
    }

    private static func scanJSONObject(
        _ bytes: [UInt8],
        index: inout Int,
        depth: Int
    ) throws {
        index += 1
        skipJSONWhitespace(bytes, index: &index)
        if index < bytes.count, bytes[index] == 0x7d {
            index += 1
            return
        }
        var keys = Set<String>()
        while true {
            skipJSONWhitespace(bytes, index: &index)
            let key = try scanJSONString(bytes, index: &index)
            guard keys.insert(key).inserted else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON contains duplicate keys"
                )
            }
            skipJSONWhitespace(bytes, index: &index)
            guard index < bytes.count, bytes[index] == 0x3a else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON object is malformed"
                )
            }
            index += 1
            try scanJSONValue(bytes, index: &index, depth: depth)
            skipJSONWhitespace(bytes, index: &index)
            guard index < bytes.count else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON object is incomplete"
                )
            }
            if bytes[index] == 0x7d {
                index += 1
                return
            }
            guard bytes[index] == 0x2c else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON object is malformed"
                )
            }
            index += 1
        }
    }

    private static func scanJSONArray(
        _ bytes: [UInt8],
        index: inout Int,
        depth: Int
    ) throws {
        index += 1
        skipJSONWhitespace(bytes, index: &index)
        if index < bytes.count, bytes[index] == 0x5d {
            index += 1
            return
        }
        while true {
            try scanJSONValue(bytes, index: &index, depth: depth)
            skipJSONWhitespace(bytes, index: &index)
            guard index < bytes.count else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON array is incomplete"
                )
            }
            if bytes[index] == 0x5d {
                index += 1
                return
            }
            guard bytes[index] == 0x2c else {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON array is malformed"
                )
            }
            index += 1
        }
    }

    private static func scanJSONString(
        _ bytes: [UInt8],
        index: inout Int
    ) throws -> String {
        guard index < bytes.count, bytes[index] == 0x22 else {
            throw ManagedCodexRuntimeBundleError.layout(
                "manifest JSON object key is malformed"
            )
        }
        let start = index
        index += 1
        var escaped = false
        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if escaped {
                escaped = false
            } else if byte == 0x5c {
                escaped = true
            } else if byte == 0x22 {
                let encoded = Data(bytes[start..<index])
                guard let value = try? JSONDecoder().decode(
                    String.self,
                    from: encoded
                ) else {
                    throw ManagedCodexRuntimeBundleError.layout(
                        "manifest JSON string is malformed"
                    )
                }
                return value
            } else if byte < 0x20 {
                throw ManagedCodexRuntimeBundleError.layout(
                    "manifest JSON string contains a control byte"
                )
            }
        }
        throw ManagedCodexRuntimeBundleError.layout(
            "manifest JSON string is incomplete"
        )
    }

    private static func skipJSONWhitespace(
        _ bytes: [UInt8],
        index: inout Int
    ) {
        while index < bytes.count,
              [0x20, 0x09, 0x0a, 0x0d].contains(bytes[index])
        {
            index += 1
        }
    }

    fileprivate static func requireNoGrantACL(
        _ descriptor: Int32,
        label: String
    ) throws {
        errno = 0
        let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let aclError = errno
        if let acl {
            let containsGrant = blabeeExtendedACLContainsGrant(acl)
            acl_free(UnsafeMutableRawPointer(acl))
            guard containsGrant == false else {
                throw ManagedCodexRuntimeBundleError.identity(
                    "extended ACL grants access: \(label)"
                )
            }
        }
        guard acl != nil || aclError == ENOENT else {
            throw ManagedCodexRuntimeBundleError.identity(
                "extended ACL cannot be inspected: \(label)"
            )
        }
    }

    fileprivate static func requireNativeExecutable(
        _ descriptor: Int32,
        label: String
    ) throws {
        var prefix = [UInt8](repeating: 0, count: 4)
        let count = prefix.withUnsafeMutableBytes {
            pread(descriptor, $0.baseAddress, $0.count, 0)
        }
        guard count == 4 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "native executable header is missing: \(label)"
            )
        }
        let magic = UInt32(prefix[0])
            | UInt32(prefix[1]) << 8
            | UInt32(prefix[2]) << 16
            | UInt32(prefix[3]) << 24
        let nativeMagics: Set<UInt32> = [
            0xfeed_face, 0xcefa_edfe, 0xfeed_facf, 0xcffa_edfe,
            0xcafe_babe, 0xbeba_feca, 0xcafe_babf, 0xbfba_feca,
        ]
        guard nativeMagics.contains(magic) else {
            throw ManagedCodexRuntimeBundleError.identity(
                "required executable is not a native binary: \(label)"
            )
        }
    }

    fileprivate static func storedIdentity(
        _ info: stat,
        stableDirectory: Bool = false
    ) -> ManagedCodexRuntimeBundleStoredIdentity {
        ManagedCodexRuntimeBundleStoredIdentity(
            info,
            stableDirectory: stableDirectory
        )
    }

    fileprivate static func isTrustedOwner(_ owner: uid_t) -> Bool {
        owner == 0 || owner == geteuid()
    }

    fileprivate static func requireSafeName(_ name: String) throws {
        guard !name.isEmpty,
              name != ".", name != "..",
              !name.contains("/"),
              !name.utf8.contains(0),
              name.utf8.count <= Int(NAME_MAX)
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "entry name is unsafe"
            )
        }
    }

    fileprivate static func requireBoundedPath(_ path: String) throws {
        guard !path.hasPrefix("/"),
              !path.utf8.contains(0),
              path.utf8.count <= maximumRelativePathBytes,
              path.split(separator: "/").allSatisfy({
                  !$0.isEmpty && $0 != "." && $0 != ".."
              })
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "relative path is unsafe or too long"
            )
        }
    }

    private static func isSimpleVersion(_ version: String) -> Bool {
        !version.isEmpty && version.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || $0 == 46 || $0 == 45
        }
    }
}

enum ManagedCodexRuntimeBundleQualificationError:
    LocalizedError, Equatable, Sendable
{
    case required(version: String, target: String)
    case fingerprintMismatch(version: String, target: String)

    var errorDescription: String? {
        switch self {
        case let .required(version, target):
            "Codex runtime \(version) for \(target) has no trusted Blabee build qualification."
        case let .fingerprintMismatch(version, target):
            "Codex runtime \(version) for \(target) does not match its trusted Blabee build qualification."
        }
    }
}

/// Immutable build qualifications for explicit managed execution. Structural
/// inspection proves that a bundle is closed and signed; this catalog also
/// proves that every path contains the exact bytes from one trusted release.
enum ManagedCodexRuntimeBundleQualificationCatalog {
    private struct Key: Hashable {
        let version: String
        let target: String
    }

    private struct Record {
        let signingTeamIdentifier: String
        let fileDigests: [String: String]
        let fingerprint: String
    }

    // Provenance: the Homebrew cask record for Codex 0.151.0 points to the
    // official OpenAI release asset below with archive SHA-256
    // cb6e78eba80c1bc310a533f6f1c6c948377733bc06f9e837949334e04abde9c6.
    // Its closed tree was independently extracted and matched every file hash
    // in this record on 2026-09-02:
    // https://github.com/openai/codex/releases/download/rust-v0.151.0/
    // codex-package-aarch64-apple-darwin.tar.gz
    // New releases require an explicit reviewed catalog update; they never
    // inherit trust from a matching Team ID or semantic version.
    private static let production: [Key: Record] = [
        Key(version: "0.151.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "98491713ffb196061003ee148636e743997cc31d76144ba7c53462269896891d",
                "bin/codex-code-mode-host":
                    "f5c96dc8cca0f760f525076c1f9f4efad31355c0fe18efb56e76df7e40592376",
                "codex-package.json":
                    "90082c2535f1be7f4abe613d8d20efadad490d9fb8b6f623c2799a181cf9e7ca",
                "codex-path/rg":
                    "345c4e819ed4a17806cec23fc0b54592731ccc265052d2bac6c400e2d24ba728",
                "codex-resources/zsh/bin/zsh":
                    "612bc88e8f9705f40a6cf54fe551cbce9cf8e7582c45bf3c0569860161a5db8f",
            ],
            fingerprint:
                "3519a4614dbea34f15941b0886e29aa4c9a961b5b40bab942a3f38f61cc8eef9"
        ),
    ]

    static func requireQualified(
        _ inspection: ManagedCodexRuntimeBundleInspection
    ) throws {
        #if DEBUG
            if inspection.executableVerification != .production { return }
        #endif
        try requireProductionQualification(inspection)
    }

    #if DEBUG
        static func requireProductionQualificationForTesting(
            _ inspection: ManagedCodexRuntimeBundleInspection
        ) throws {
            try requireProductionQualification(inspection)
        }

        static func fingerprintForTesting(
            _ inspection: ManagedCodexRuntimeBundleInspection
        ) -> String {
            fingerprint(inspection)
        }
    #endif

    private static func requireProductionQualification(
        _ inspection: ManagedCodexRuntimeBundleInspection
    ) throws {
        let key = Key(
            version: inspection.manifest.version,
            target: inspection.manifest.target
        )
        guard let record = production[key] else {
            throw ManagedCodexRuntimeBundleQualificationError.required(
                version: key.version,
                target: key.target
            )
        }
        let files = Dictionary(uniqueKeysWithValues: inspection.entries
            .filter { $0.kind == .file }
            .compactMap { entry in
                entry.digest.map { (entry.path, $0) }
            })
        let executableTeams = Set(inspection.entries
            .filter(\.executable)
            .compactMap(\.signingTeamIdentifier))
        guard files == record.fileDigests,
              executableTeams == Set([record.signingTeamIdentifier]),
              fingerprint(inspection) == record.fingerprint
        else {
            throw ManagedCodexRuntimeBundleQualificationError
                .fingerprintMismatch(
                    version: key.version,
                    target: key.target
                )
        }
    }

    /// SHA-256 over an unambiguous length-prefixed stream. It binds every
    /// manifest field and every sorted entry's path, kind, digest, executable
    /// bit, signer Team ID, and architecture list. Directory entries are
    /// included, so empty/extra resource directories also change the build ID.
    private static func fingerprint(
        _ inspection: ManagedCodexRuntimeBundleInspection
    ) -> String {
        var bytes = Data()
        append("blabee-codex-runtime-qualification-v1", to: &bytes)
        append(String(inspection.manifest.layoutVersion), to: &bytes)
        append(inspection.manifest.version, to: &bytes)
        append(inspection.manifest.target, to: &bytes)
        append(inspection.manifest.variant, to: &bytes)
        append(inspection.manifest.entrypoint, to: &bytes)
        append(inspection.manifest.resourcesDir, to: &bytes)
        append(inspection.manifest.pathDir, to: &bytes)
        let entries = inspection.entries.sorted { $0.path < $1.path }
        append(String(entries.count), to: &bytes)
        for entry in entries {
            append(entry.path, to: &bytes)
            append(entry.kind.rawValue, to: &bytes)
            append(entry.digest, to: &bytes)
            append(entry.executable ? "1" : "0", to: &bytes)
            append(entry.signingTeamIdentifier, to: &bytes)
            let architectures = entry.architectures.sorted()
            append(String(architectures.count), to: &bytes)
            for architecture in architectures {
                append(String(architecture), to: &bytes)
            }
        }
        return SHA256.hash(data: bytes)
            .map { String(format: "%02x", $0) }.joined()
    }

    private static func append(_ value: String?, to data: inout Data) {
        guard let value else {
            var marker = UInt64.max.bigEndian
            withUnsafeBytes(of: &marker) { data.append(contentsOf: $0) }
            return
        }
        let encoded = Array(value.utf8)
        var length = UInt64(encoded.count).bigEndian
        withUnsafeBytes(of: &length) { data.append(contentsOf: $0) }
        data.append(contentsOf: encoded)
    }
}

private struct ManagedCodexRuntimeBundleSeal: Codable, Equatable, Sendable {
    let sealVersion: Int
    let rootIdentity: ManagedCodexRuntimeBundleStoredIdentity
    let leaseIdentity: ManagedCodexRuntimeBundleStoredIdentity
    let manifest: ManagedCodexRuntimeBundleManifest
    let entries: [ManagedCodexRuntimeBundleEntry]
}

/// Durable recovery metadata written before payload copying begins. It lets a
/// later process distinguish one abandoned Blabee staging tree from unrelated
/// data and delete only a bounded subset of the declared runtime paths.
private struct ManagedCodexRuntimeBundleStagingPlan:
    Codable, Equatable, Sendable
{
    let planVersion: Int
    let createdAtSeconds: Int64
    let rootIdentity: ManagedCodexRuntimeBundleStoredIdentity
    let leaseIdentity: ManagedCodexRuntimeBundleStoredIdentity
    let manifest: ManagedCodexRuntimeBundleManifest
    let entries: [ManagedCodexRuntimeBundleEntry]
}

/// One process-local, owner-only copy of the complete official Codex runtime.
/// The source package is never edited. The staged directory becomes visible
/// under its final name only after every payload file and the seal are fsynced.
final class ManagedCodexPinnedRuntimeBundle: @unchecked Sendable {
    private static let directoryPrefix = "blabee-managed-codex."
    private static let stagingMarker = "staging."
    private static let leaseName = ".lease"
    private static let sealName = ".blabee-runtime-manifest.json"
    private static let stagingPlanName = ".blabee-runtime-staging.json"
    private static let stagingPlanTemporaryName =
        ".blabee-runtime-staging.json.partial"
    private static let maximumSealBytes: Int64 = 2 * 1_024 * 1_024
    private static let maximumStagingPlanBytes: Int64 = 2 * 1_024 * 1_024

    let directoryURL: URL
    let executableURL: URL
    let codeModeHostURL: URL
    let pathDirectoryURL: URL
    let resourcesDirectoryURL: URL?

    private let inspection: ManagedCodexRuntimeBundleInspection
    private let leaseDescriptor: Int32
    private let leaseIdentity: ManagedCodexRuntimeBundleStoredIdentity
    private let sealIdentity: ManagedCodexRuntimeBundleStoredIdentity
    private let sealDigest: String
    private let cleanupLock = NSLock()
    private var cleaned = false

    #if DEBUG
        private static let testingLock = NSLock()
        private nonisolated(unsafe) static var injectedFailurePoint:
            ManagedCodexPinnedExecutableCreateFailurePoint?
        private nonisolated(unsafe) static var beforeSourceRevalidationHook:
            (@Sendable () throws -> Void)?
        private nonisolated(unsafe) static var preserveFailedStaging = false
    #endif

    private init(
        directoryURL: URL,
        inspection: ManagedCodexRuntimeBundleInspection,
        leaseDescriptor: Int32,
        leaseIdentity: ManagedCodexRuntimeBundleStoredIdentity,
        sealIdentity: ManagedCodexRuntimeBundleStoredIdentity,
        sealDigest: String
    ) {
        self.directoryURL = directoryURL
        executableURL = inspection.executableURL
        codeModeHostURL = inspection.codeModeHostURL
        pathDirectoryURL = inspection.pathDirectoryURL
        resourcesDirectoryURL = inspection.resourcesDirectoryURL
        self.inspection = inspection
        self.leaseDescriptor = leaseDescriptor
        self.leaseIdentity = leaseIdentity
        self.sealIdentity = sealIdentity
        self.sealDigest = sealDigest
    }

    deinit { cleanup() }

    static func create(
        from source: ManagedCodexRuntimeBundleInspection,
        parentURL: URL
    ) throws -> ManagedCodexPinnedRuntimeBundle {
        let canonicalParentPath = try validatedParentPath(parentURL)
        ManagedCodexPinnedExecutable.scavengeLegacyPinsForRuntimeBundle(
            in: canonicalParentPath
        )
        scavengeAbandonedStagingBundles(in: canonicalParentPath)
        scavengeSealedBundles(
            in: canonicalParentPath,
            executableVerification: source.executableVerification
        )

        let parentDescriptor = open(
            canonicalParentPath,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard parentDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private parent cannot be opened"
            )
        }
        defer { close(parentDescriptor) }

        let identifier = UUID().uuidString.lowercased()
        let stagingName = directoryPrefix + stagingMarker + identifier
        let finalName = directoryPrefix + identifier
        guard mkdirat(parentDescriptor, stagingName, mode_t(0o700)) == 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private staging directory cannot be created"
            )
        }
        let stagingURL = URL(fileURLWithPath: canonicalParentPath, isDirectory: true)
            .appendingPathComponent(stagingName, isDirectory: true)
        let finalURL = URL(fileURLWithPath: canonicalParentPath, isDirectory: true)
            .appendingPathComponent(finalName, isDirectory: true)
        let stagingDescriptor = openat(
            parentDescriptor,
            stagingName,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard stagingDescriptor >= 0 else {
            _ = unlinkat(parentDescriptor, stagingName, AT_REMOVEDIR)
            throw ManagedCodexRuntimeBundleError.identity(
                "private staging directory cannot be opened"
            )
        }
        defer { close(stagingDescriptor) }
        var stagingInfo = stat()
        guard fstat(stagingDescriptor, &stagingInfo) == 0,
              stagingInfo.st_mode & S_IFMT == S_IFDIR,
              stagingInfo.st_uid == geteuid(),
              stagingInfo.st_mode & 0o777 == 0o700
        else {
            _ = unlinkat(parentDescriptor, stagingName, AT_REMOVEDIR)
            throw ManagedCodexRuntimeBundleError.identity(
                "private staging directory metadata is unsafe"
            )
        }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            stagingDescriptor,
            label: "private staging directory"
        )
        let stagingObject = ManagedCodexRuntimeBundleStoredIdentity(
            stagingInfo,
            stableDirectory: true
        )
        var createdFiles: [String: ManagedCodexRuntimeBundleStoredIdentity] = [:]
        var createdDirectories: [String: ManagedCodexRuntimeBundleStoredIdentity] = [:]
        var preserveStaging = false
        defer {
            if !preserveStaging && !shouldPreserveFailedStagingForTesting() {
                removePartialTreeIfExact(
                    rootURL: stagingURL,
                    expectedRoot: stagingObject,
                    files: createdFiles,
                    directories: createdDirectories
                )
            }
        }

        // No O_CLOEXEC: the native fallback uses execve, so the lease remains
        // held by the resulting Codex process until that process exits.
        let leaseDescriptor = openat(
            stagingDescriptor,
            leaseName,
            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW,
            mode_t(0o600)
        )
        guard leaseDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private runtime lease cannot be created"
            )
        }
        var preserveLease = false
        defer {
            if !preserveLease {
                _ = flock(leaseDescriptor, LOCK_UN)
                close(leaseDescriptor)
            }
        }
        guard flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private runtime lease cannot be locked"
            )
        }
        var leaseInfo = stat()
        guard fstat(leaseDescriptor, &leaseInfo) == 0,
              leaseInfo.st_mode & S_IFMT == S_IFREG,
              leaseInfo.st_nlink == 1,
              leaseInfo.st_uid == geteuid(),
              leaseInfo.st_mode & 0o777 == 0o600
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private runtime lease metadata is unsafe"
            )
        }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            leaseDescriptor,
            label: "private runtime lease"
        )
        guard fsync(leaseDescriptor) == 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        let leaseIdentity = ManagedCodexRuntimeBundleStoredIdentity(leaseInfo)
        createdFiles[leaseName] = leaseIdentity

        let stagingPlan = ManagedCodexRuntimeBundleStagingPlan(
            planVersion: 1,
            createdAtSeconds: Int64(time(nil)),
            rootIdentity: stagingObject,
            leaseIdentity: leaseIdentity,
            manifest: source.manifest,
            entries: source.entries
        )
        let stagingPlanEncoder = JSONEncoder()
        stagingPlanEncoder.outputFormatting = [.sortedKeys]
        let stagingPlanData = try stagingPlanEncoder.encode(stagingPlan)
        guard stagingPlanData.count <= maximumStagingPlanBytes else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "private staging recovery plan is too large"
            )
        }
        let stagingPlanDescriptor = openat(
            stagingDescriptor,
            stagingPlanTemporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard stagingPlanDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private staging recovery plan cannot be created"
            )
        }
        do {
            try writeAll(stagingPlanData, to: stagingPlanDescriptor)
            guard fchmod(stagingPlanDescriptor, mode_t(0o400)) == 0,
                  fsync(stagingPlanDescriptor) == 0
            else { throw ManagedCodexRuntimeBundleError.changed }
            var stagingPlanInfo = stat()
            guard fstat(stagingPlanDescriptor, &stagingPlanInfo) == 0,
                  stagingPlanInfo.st_mode & S_IFMT == S_IFREG,
                  stagingPlanInfo.st_nlink == 1,
                  stagingPlanInfo.st_uid == geteuid(),
                  stagingPlanInfo.st_mode & 0o777 == 0o400
            else { throw ManagedCodexRuntimeBundleError.changed }
            try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
                stagingPlanDescriptor,
                label: "private staging recovery plan"
            )
            createdFiles[stagingPlanTemporaryName] =
                ManagedCodexRuntimeBundleStoredIdentity(stagingPlanInfo)
        } catch {
            var failedPlan = stat()
            if fstat(stagingPlanDescriptor, &failedPlan) == 0 {
                createdFiles[stagingPlanTemporaryName] =
                    ManagedCodexRuntimeBundleStoredIdentity(failedPlan)
            }
            close(stagingPlanDescriptor)
            throw error
        }
        close(stagingPlanDescriptor)
        guard renameatx_np(
            stagingDescriptor,
            stagingPlanTemporaryName,
            stagingDescriptor,
            stagingPlanName,
            UInt32(RENAME_EXCL)
        ) == 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        guard let temporaryPlanIdentity = createdFiles.removeValue(
            forKey: stagingPlanTemporaryName
        ) else { throw ManagedCodexRuntimeBundleError.changed }
        var publishedPlanInfo = stat()
        guard fstatat(
            stagingDescriptor,
            stagingPlanName,
            &publishedPlanInfo,
            AT_SYMLINK_NOFOLLOW
        ) == 0,
              publishedPlanInfo.st_mode & S_IFMT == S_IFREG,
              publishedPlanInfo.st_nlink == 1,
              publishedPlanInfo.st_uid == geteuid(),
              publishedPlanInfo.st_mode & 0o777 == 0o400
        else { throw ManagedCodexRuntimeBundleError.changed }
        let publishedPlanIdentity = ManagedCodexRuntimeBundleStoredIdentity(
            publishedPlanInfo
        )
        // rename(2) may legitimately advance ctime, but it must preserve the
        // exact object, content, permissions, and data timestamps.
        guard publishedPlanIdentity.device == temporaryPlanIdentity.device,
              publishedPlanIdentity.inode == temporaryPlanIdentity.inode,
              publishedPlanIdentity.mode == temporaryPlanIdentity.mode,
              publishedPlanIdentity.owner == temporaryPlanIdentity.owner,
              publishedPlanIdentity.group == temporaryPlanIdentity.group,
              publishedPlanIdentity.size == temporaryPlanIdentity.size,
              publishedPlanIdentity.modificationSeconds
                == temporaryPlanIdentity.modificationSeconds,
              publishedPlanIdentity.modificationNanoseconds
                == temporaryPlanIdentity.modificationNanoseconds
        else { throw ManagedCodexRuntimeBundleError.changed }
        createdFiles[stagingPlanName] = publishedPlanIdentity
        guard fsync(stagingDescriptor) == 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        try failIfRequested(.afterLease)

        let sourceRootDescriptor = open(
            source.rootURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard sourceRootDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        defer { close(sourceRootDescriptor) }
        var sourceRootInfo = stat()
        guard fstat(sourceRootDescriptor, &sourceRootInfo) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(
                sourceRootInfo,
                stableDirectory: true
              ) == source.rootIdentity
        else { throw ManagedCodexRuntimeBundleError.changed }

        let directoryEntries = source.entries
            .filter { $0.kind == .directory }
            .sorted { pathDepth($0.path) < pathDepth($1.path) }
        for entry in directoryEntries {
            try createPrivateDirectoryEntry(
                entry,
                rootDescriptor: stagingDescriptor,
                createdDirectories: &createdDirectories
            )
        }

        let fileEntries = source.entries
            .filter { $0.kind == .file }
            .sorted { $0.path < $1.path }
        for (index, entry) in fileEntries.enumerated() {
            try copyPrivateFileEntry(
                entry,
                sourceRootDescriptor: sourceRootDescriptor,
                destinationRootDescriptor: stagingDescriptor,
                injectCreateFailure: index == 0,
                injectPartialFailure: index == 0
                    && shouldFail(.afterPartialCopy),
                createdFiles: &createdFiles
            )
        }

        for entry in directoryEntries.sorted(by: {
            pathDepth($0.path) > pathDepth($1.path)
        }) {
            let descriptor = try openRelativeDirectory(
                rootDescriptor: stagingDescriptor,
                relativePath: entry.path
            )
            let result = fsync(descriptor)
            close(descriptor)
            guard result == 0 else {
                throw ManagedCodexRuntimeBundleError.changed
            }
        }
        guard fsync(stagingDescriptor) == 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }

        // A second full source walk catches added, removed, renamed, or
        // same-inode content changes that occurred during the copy.
        #if DEBUG
            try runBeforeSourceRevalidationHook()
        #endif
        try ManagedCodexRuntimeBundleInspector.revalidate(source)
        let stagedExecutable = stagingURL.appendingPathComponent(
            "bin/codex",
            isDirectory: false
        )
        let stagedInspection = try ManagedCodexRuntimeBundleInspector
            .inspectPrivateStagingBundle(
                executableURL: stagedExecutable,
                executableVerification: source.executableVerification
            )
        guard sameRuntimeContent(source, stagedInspection) else {
            throw ManagedCodexRuntimeBundleError.changed
        }

        let seal = ManagedCodexRuntimeBundleSeal(
            sealVersion: 1,
            rootIdentity: stagingObject,
            leaseIdentity: leaseIdentity,
            manifest: stagedInspection.manifest,
            entries: stagedInspection.entries
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let sealData = try encoder.encode(seal)
        guard sealData.count <= maximumSealBytes else {
            throw ManagedCodexRuntimeBundleError.bounds(
                "private seal is too large"
            )
        }
        let sealDescriptor = openat(
            stagingDescriptor,
            sealName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o400)
        )
        guard sealDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private runtime seal cannot be created"
            )
        }
        defer { close(sealDescriptor) }
        try writeAll(sealData, to: sealDescriptor)
        guard fchmod(sealDescriptor, mode_t(0o400)) == 0,
              fsync(sealDescriptor) == 0,
              fsync(stagingDescriptor) == 0
        else { throw ManagedCodexRuntimeBundleError.changed }
        var sealInfo = stat()
        guard fstat(sealDescriptor, &sealInfo) == 0,
              sealInfo.st_uid == geteuid(),
              sealInfo.st_mode & 0o777 == 0o400,
              sealInfo.st_nlink == 1
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            sealDescriptor,
            label: "private runtime seal"
        )
        let sealIdentity = ManagedCodexRuntimeBundleStoredIdentity(sealInfo)
        let sealDigest = SHA256.hash(data: sealData)
            .map { String(format: "%02x", $0) }.joined()
        createdFiles[sealName] = sealIdentity

        // Seal creation mutates the staging root. Rewalk exact file identities
        // immediately before publication; the full digest/signature pass has
        // already sealed this copy and any write necessarily changes ctime.
        guard let expectedStagingPlan = createdFiles[stagingPlanName] else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        try verifyPrivateTreeIdentity(
            directoryURL: stagingURL,
            expectedInspection: stagedInspection,
            expectedLease: leaseIdentity,
            expectedSealIdentity: sealIdentity,
            expectedSealDigest: sealDigest,
            additionalFiles: [stagingPlanName: expectedStagingPlan]
        )

        guard renameatx_np(
            parentDescriptor,
            stagingName,
            parentDescriptor,
            finalName,
            UInt32(RENAME_EXCL)
        ) == 0,
              fsync(parentDescriptor) == 0
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private runtime cannot be atomically published"
            )
        }
        preserveStaging = true
        try failIfRequested(.afterStagingPublish)

        // Keep the recovery plan across the atomic rename. If the process is
        // killed in this narrow window, the next run can still recognize and
        // safely reap the unpublished final-name tree. A usable bundle never
        // reaches the final inspector until this exact marker is removed.
        var namedStagingPlan = stat()
        guard fstatat(
            stagingDescriptor,
            stagingPlanName,
            &namedStagingPlan,
            AT_SYMLINK_NOFOLLOW
        ) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(namedStagingPlan)
                == expectedStagingPlan,
              unlinkat(stagingDescriptor, stagingPlanName, 0) == 0
        else { throw ManagedCodexRuntimeBundleError.changed }
        createdFiles.removeValue(forKey: stagingPlanName)
        guard fsync(stagingDescriptor) == 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }

        let finalInspection = try ManagedCodexRuntimeBundleInspector
            .inspectPrivateBundle(
                executableURL: finalURL.appendingPathComponent(
                    "bin/codex",
                    isDirectory: false
                ),
                executableVerification: source.executableVerification
            )
        guard sameRuntimeContent(stagedInspection, finalInspection),
              finalInspection.rootIdentity == stagingObject
        else { throw ManagedCodexRuntimeBundleError.changed }

        let pin = ManagedCodexPinnedRuntimeBundle(
            directoryURL: finalURL,
            inspection: finalInspection,
            leaseDescriptor: leaseDescriptor,
            leaseIdentity: leaseIdentity,
            sealIdentity: sealIdentity,
            sealDigest: sealDigest
        )
        preserveLease = true
        do {
            try pin.verifyIdentity()
            return pin
        } catch {
            // `pin` owns the descriptor and performs exact cleanup.
            throw error
        }
    }

    func revalidate(
        qualifiedVersion: String
    ) throws -> CodexRuntimeApprovedExecutable {
        guard CodexCompatibility.qualify(version: qualifiedVersion)
            .isApprovedForManagedUse
        else {
            throw CodexRuntimeTrustError.unsupportedVersion(qualifiedVersion)
        }
        guard inspection.manifest.version == qualifiedVersion else {
            throw ManagedCodexRuntimeBundleError.versionMismatch(
                manifest: inspection.manifest.version,
                qualified: qualifiedVersion
            )
        }
        try ManagedCodexRuntimeBundleQualificationCatalog.requireQualified(
            inspection
        )
        try verifyIdentity()
        let executableEntry = try Self.requiredEntry(
            path: "bin/codex",
            in: inspection
        )
        return CodexRuntimeApprovedExecutable(
            stableSourceURL: executableURL,
            canonicalURL: executableURL,
            targetIdentity: executableEntry.identity.fileIdentity,
            qualifiedVersion: qualifiedVersion
        )
    }

    private func verifyIdentity() throws {
        var heldLease = stat()
        guard fstat(leaseDescriptor, &heldLease) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(heldLease)
                == leaseIdentity,
              flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0
        else { throw CodexRuntimeTrustError.approvalDrift }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            leaseDescriptor,
            label: "private runtime lease"
        )
        do {
            try Self.verifyPrivateTreeIdentity(
                directoryURL: directoryURL,
                expectedInspection: inspection,
                expectedLease: leaseIdentity,
                expectedSealIdentity: sealIdentity,
                expectedSealDigest: sealDigest
            )
        } catch {
            throw CodexRuntimeTrustError.approvalDrift
        }
    }

    private func cleanup() {
        cleanupLock.lock()
        defer { cleanupLock.unlock() }
        guard !cleaned else { return }
        cleaned = true
        Self.removeSealedBundleIfExact(
            directoryURL: directoryURL,
            expectedInspection: inspection,
            leaseDescriptor: leaseDescriptor,
            expectedLease: leaseIdentity,
            expectedSealIdentity: sealIdentity,
            expectedSealDigest: sealDigest
        )
        _ = flock(leaseDescriptor, LOCK_UN)
        close(leaseDescriptor)
    }

    private static func sameRuntimeContent(
        _ lhs: ManagedCodexRuntimeBundleInspection,
        _ rhs: ManagedCodexRuntimeBundleInspection
    ) -> Bool {
        guard lhs.manifest == rhs.manifest,
              lhs.entries.count == rhs.entries.count
        else { return false }
        return zip(lhs.entries, rhs.entries).allSatisfy { left, right in
            left.path == right.path
                && left.kind == right.kind
                && left.digest == right.digest
                && left.executable == right.executable
                && left.signingTeamIdentifier == right.signingTeamIdentifier
                && left.architectures == right.architectures
                && (left.kind == .directory || left.identity.size == right.identity.size)
        }
    }

    private static func requiredEntry(
        path: String,
        in inspection: ManagedCodexRuntimeBundleInspection
    ) throws -> ManagedCodexRuntimeBundleEntry {
        guard let entry = inspection.entries.first(where: { $0.path == path })
        else {
            throw ManagedCodexRuntimeBundleError.layout(
                "required entry is missing: \(path)"
            )
        }
        return entry
    }

    private static func validatedParentPath(_ parentURL: URL) throws -> String {
        guard parentURL.isFileURL,
              parentURL.path.hasPrefix("/"),
              !parentURL.path.utf8.contains(0),
              let resolved = realpath(parentURL.path, nil)
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private parent cannot be resolved"
            )
        }
        defer { free(resolved) }
        let path = String(cString: resolved)
        let descriptor = open(
            path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private parent cannot be opened"
            )
        }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & S_IFMT == S_IFDIR,
              info.st_uid == geteuid(),
              info.st_mode & 0o022 == 0
        else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private parent ownership or mode is unsafe"
            )
        }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            descriptor,
            label: "private parent"
        )
        return path
    }

    private static func openRelativeDirectory(
        rootDescriptor: Int32,
        relativePath: String
    ) throws -> Int32 {
        var descriptor = fcntl(rootDescriptor, F_DUPFD_CLOEXEC, 0)
        guard descriptor >= 0 else { throw ManagedCodexRuntimeBundleError.changed }
        if relativePath.isEmpty { return descriptor }
        for component in relativePath.split(separator: "/") {
            let next = openat(
                descriptor,
                String(component),
                O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
            )
            close(descriptor)
            guard next >= 0 else { throw ManagedCodexRuntimeBundleError.changed }
            descriptor = next
        }
        return descriptor
    }

    private static func parentPath(of path: String) -> String {
        let value = (path as NSString).deletingLastPathComponent
        return value == "." ? "" : value
    }

    private static func lastComponent(of path: String) -> String {
        (path as NSString).lastPathComponent
    }

    private static func pathDepth(_ path: String) -> Int {
        path.split(separator: "/").count
    }

    private static func createPrivateDirectoryEntry(
        _ entry: ManagedCodexRuntimeBundleEntry,
        rootDescriptor: Int32,
        createdDirectories:
            inout [String: ManagedCodexRuntimeBundleStoredIdentity]
    ) throws {
        let parent = try openRelativeDirectory(
            rootDescriptor: rootDescriptor,
            relativePath: parentPath(of: entry.path)
        )
        defer { close(parent) }
        let name = lastComponent(of: entry.path)
        guard mkdirat(parent, name, mode_t(0o700)) == 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private runtime directory cannot be created: \(entry.path)"
            )
        }
        var named = stat()
        guard fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              named.st_mode & S_IFMT == S_IFDIR
        else { throw ManagedCodexRuntimeBundleError.changed }
        createdDirectories[entry.path] =
            ManagedCodexRuntimeBundleStoredIdentity(
                named,
                stableDirectory: true
            )

        let child = openat(
            parent,
            name,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard child >= 0 else { throw ManagedCodexRuntimeBundleError.changed }
        defer { close(child) }
        var opened = stat()
        guard fstat(child, &opened) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(
                opened,
                stableDirectory: true
              ) == createdDirectories[entry.path],
              opened.st_uid == geteuid(),
              opened.st_mode & 0o777 == 0o700
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            child,
            label: entry.path
        )
    }

    private static func copyPrivateFileEntry(
        _ entry: ManagedCodexRuntimeBundleEntry,
        sourceRootDescriptor: Int32,
        destinationRootDescriptor: Int32,
        injectCreateFailure: Bool,
        injectPartialFailure: Bool,
        createdFiles: inout [String: ManagedCodexRuntimeBundleStoredIdentity]
    ) throws {
        let relativeParent = parentPath(of: entry.path)
        let sourceParent = try openRelativeDirectory(
            rootDescriptor: sourceRootDescriptor,
            relativePath: relativeParent
        )
        defer { close(sourceParent) }
        let destinationParent = try openRelativeDirectory(
            rootDescriptor: destinationRootDescriptor,
            relativePath: relativeParent
        )
        defer { close(destinationParent) }
        let name = lastComponent(of: entry.path)
        let sourceFile = openat(
            sourceParent,
            name,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard sourceFile >= 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        defer { close(sourceFile) }
        var openedSource = stat()
        guard fstat(sourceFile, &openedSource) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(openedSource)
                == entry.identity
        else { throw ManagedCodexRuntimeBundleError.changed }

        let mode: mode_t = entry.executable ? 0o500 : 0o400
        let destinationFile = openat(
            destinationParent,
            name,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode
        )
        guard destinationFile >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "private runtime file cannot be created: \(entry.path)"
            )
        }
        defer { close(destinationFile) }
        var partialDestination = stat()
        guard fstat(destinationFile, &partialDestination) == 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        createdFiles[entry.path] = ManagedCodexRuntimeBundleStoredIdentity(
            partialDestination
        )

        do {
            if injectCreateFailure {
                try failIfRequested(.afterDestinationCreate)
            }
            let copiedDigest = try copyExactFile(
                sourceDescriptor: sourceFile,
                destinationDescriptor: destinationFile,
                expectedBytes: entry.identity.size,
                injectPartialFailure: injectPartialFailure
            )
            if injectCreateFailure {
                try failIfRequested(.afterDestinationCopy)
            }
            guard copiedDigest == entry.digest,
                  fchmod(destinationFile, mode) == 0,
                  fsync(destinationFile) == 0
            else { throw ManagedCodexRuntimeBundleError.changed }
            try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
                destinationFile,
                label: entry.path
            )
            var completedSource = stat()
            var completedDestination = stat()
            guard fstat(sourceFile, &completedSource) == 0,
                  ManagedCodexRuntimeBundleStoredIdentity(completedSource)
                    == entry.identity,
                  fstat(destinationFile, &completedDestination) == 0,
                  completedDestination.st_mode & S_IFMT == S_IFREG,
                  completedDestination.st_nlink == 1,
                  completedDestination.st_uid == geteuid(),
                  completedDestination.st_mode & 0o777 == mode
            else { throw ManagedCodexRuntimeBundleError.changed }
            createdFiles[entry.path] =
                ManagedCodexRuntimeBundleStoredIdentity(completedDestination)
        } catch {
            // Any write, chmod, fsync, ACL, or final-identity failure can alter
            // the destination metadata. Refresh the exact cleanup baseline so
            // the same turn does not strand a large staging tree.
            var failedDestination = stat()
            if fstat(destinationFile, &failedDestination) == 0 {
                createdFiles[entry.path] =
                    ManagedCodexRuntimeBundleStoredIdentity(failedDestination)
            }
            throw error
        }
    }

    private static func copyExactFile(
        sourceDescriptor: Int32,
        destinationDescriptor: Int32,
        expectedBytes: Int64,
        injectPartialFailure: Bool
    ) throws -> String {
        guard expectedBytes >= 0,
              expectedBytes <= ManagedCodexRuntimeBundleInspector.maximumFileBytes
        else { throw ManagedCodexRuntimeBundleError.bounds("file size exceeded") }
        var hasher = SHA256()
        let capacity = 128 * 1_024
        let buffer = UnsafeMutableRawPointer.allocate(
            byteCount: capacity,
            alignment: MemoryLayout<UInt64>.alignment
        )
        defer { buffer.deallocate() }
        var offset: Int64 = 0
        var didInject = false
        while offset < expectedBytes {
            let requested = injectPartialFailure && !didInject
                ? min(4, Int(expectedBytes - offset))
                : min(capacity, Int(expectedBytes - offset))
            var readCount: Int
            repeat {
                readCount = pread(
                    sourceDescriptor,
                    buffer,
                    requested,
                    off_t(offset)
                )
            } while readCount < 0 && errno == EINTR
            guard readCount > 0 else { throw ManagedCodexRuntimeBundleError.changed }
            hasher.update(bufferPointer: UnsafeRawBufferPointer(
                start: buffer,
                count: readCount
            ))
            var written = 0
            while written < readCount {
                var writeCount: Int
                repeat {
                    writeCount = Darwin.write(
                        destinationDescriptor,
                        buffer.advanced(by: written),
                        readCount - written
                    )
                } while writeCount < 0 && errno == EINTR
                guard writeCount > 0 else {
                    throw ManagedCodexRuntimeBundleError.changed
                }
                written += writeCount
            }
            offset += Int64(readCount)
            if injectPartialFailure && !didInject {
                didInject = true
                try failIfRequested(.afterPartialCopy)
            }
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func writeAll(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                var count: Int
                repeat {
                    count = Darwin.write(
                        descriptor,
                        bytes.baseAddress?.advanced(by: offset),
                        bytes.count - offset
                    )
                } while count < 0 && errno == EINTR
                guard count > 0 else { throw ManagedCodexRuntimeBundleError.changed }
                offset += count
            }
        }
    }

    private static func removePartialTreeIfExact(
        rootURL: URL,
        expectedRoot: ManagedCodexRuntimeBundleStoredIdentity,
        files: [String: ManagedCodexRuntimeBundleStoredIdentity],
        directories: [String: ManagedCodexRuntimeBundleStoredIdentity]
    ) {
        guard let current = try? enumeratePrivateTree(rootURL: rootURL),
              current.rootIdentity == expectedRoot,
              Set(current.files.keys) == Set(files.keys),
              Set(current.directories.keys) == Set(directories.keys),
              current.files == files,
              current.directories == directories
        else { return }
        removeKnownTree(
            rootURL: rootURL,
            expectedRoot: expectedRoot,
            files: files,
            directories: directories
        )
    }

    private static func removeSealedBundleIfExact(
        directoryURL: URL,
        expectedInspection: ManagedCodexRuntimeBundleInspection,
        leaseDescriptor: Int32,
        expectedLease: ManagedCodexRuntimeBundleStoredIdentity,
        expectedSealIdentity: ManagedCodexRuntimeBundleStoredIdentity,
        expectedSealDigest: String
    ) {
        var heldLease = stat()
        guard fstat(leaseDescriptor, &heldLease) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(heldLease) == expectedLease,
              flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0
        else { return }
        guard (try? verifyPrivateTreeIdentity(
            directoryURL: directoryURL,
            expectedInspection: expectedInspection,
            expectedLease: expectedLease,
            expectedSealIdentity: expectedSealIdentity,
            expectedSealDigest: expectedSealDigest
        )) != nil else { return }
        var files = Dictionary(uniqueKeysWithValues: expectedInspection.entries
            .filter { $0.kind == .file }
            .map { ($0.path, $0.identity) })
        files[sealName] = expectedSealIdentity
        files[leaseName] = expectedLease
        let directories = Dictionary(uniqueKeysWithValues:
            expectedInspection.entries
            .filter { $0.kind == .directory }
            .map { ($0.path, $0.identity) })
        removeKnownTree(
            rootURL: directoryURL,
            expectedRoot: expectedInspection.rootIdentity,
            files: files,
            directories: directories
        )
    }

    /// Repeated launch admissions must remain fail-closed without re-reading
    /// and hashing the complete runtime. The original full inspection sealed
    /// every file identity; unprivileged writes cannot restore ctime, so an
    /// exact descriptor walk detects content, metadata, replacement, and
    /// unknown-entry drift. Only the small immutable seal is hashed again.
    private static func verifyPrivateTreeIdentity(
        directoryURL: URL,
        expectedInspection: ManagedCodexRuntimeBundleInspection,
        expectedLease: ManagedCodexRuntimeBundleStoredIdentity,
        expectedSealIdentity: ManagedCodexRuntimeBundleStoredIdentity,
        expectedSealDigest: String,
        additionalFiles: [String: ManagedCodexRuntimeBundleStoredIdentity] = [:]
    ) throws {
        let current = try enumeratePrivateTree(rootURL: directoryURL)
        var expectedFiles = Dictionary(uniqueKeysWithValues:
            expectedInspection.entries
                .filter { $0.kind == .file }
                .map { ($0.path, $0.identity) })
        expectedFiles[leaseName] = expectedLease
        expectedFiles[sealName] = expectedSealIdentity
        for (path, identity) in additionalFiles {
            guard expectedFiles.updateValue(identity, forKey: path) == nil
            else { throw ManagedCodexRuntimeBundleError.changed }
        }
        let expectedDirectories = Dictionary(uniqueKeysWithValues:
            expectedInspection.entries
                .filter { $0.kind == .directory }
                .map { ($0.path, $0.identity) })
        guard current.rootIdentity == expectedInspection.rootIdentity,
              current.files == expectedFiles,
              current.directories == expectedDirectories
        else { throw ManagedCodexRuntimeBundleError.changed }

        let rootDescriptor = open(
            directoryURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        defer { close(rootDescriptor) }
        let sealDescriptor = openat(
            rootDescriptor,
            sealName,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard sealDescriptor >= 0 else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        defer { close(sealDescriptor) }
        guard try ManagedCodexRuntimeBundleInspector.digestFile(
            descriptor: sealDescriptor,
            expectedBytes: expectedSealIdentity.size,
            label: sealName
        ) == expectedSealDigest else {
            throw ManagedCodexRuntimeBundleError.changed
        }
    }

    private static func removeKnownTree(
        rootURL: URL,
        expectedRoot: ManagedCodexRuntimeBundleStoredIdentity,
        files: [String: ManagedCodexRuntimeBundleStoredIdentity],
        directories: [String: ManagedCodexRuntimeBundleStoredIdentity]
    ) {
        let rootDescriptor = open(
            rootURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootDescriptor >= 0 else { return }
        defer { close(rootDescriptor) }
        var openedRoot = stat()
        guard fstat(rootDescriptor, &openedRoot) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(
                openedRoot,
                stableDirectory: true
              ) == expectedRoot
        else { return }
        for path in files.keys.sorted(by: { pathDepth($0) > pathDepth($1) }) {
            guard let parent = try? openRelativeDirectory(
                rootDescriptor: rootDescriptor,
                relativePath: parentPath(of: path)
            ) else { return }
            var named = stat()
            guard let expectedFile = files[path] else {
                close(parent)
                return
            }
            guard fstatat(
                parent,
                lastComponent(of: path),
                &named,
                AT_SYMLINK_NOFOLLOW
            ) == 0,
                  ManagedCodexRuntimeBundleStoredIdentity(named) == expectedFile,
                  named.st_mode & S_IFMT == S_IFREG,
                  named.st_nlink == 1
            else {
                close(parent)
                return
            }
            let result = unlinkat(parent, lastComponent(of: path), 0)
            close(parent)
            guard result == 0 else { return }
        }
        for path in directories.keys.sorted(by: {
            pathDepth($0) > pathDepth($1)
        }) {
            guard let parent = try? openRelativeDirectory(
                rootDescriptor: rootDescriptor,
                relativePath: parentPath(of: path)
            ) else { return }
            var named = stat()
            guard let expectedDirectory = directories[path] else {
                close(parent)
                return
            }
            guard fstatat(
                parent,
                lastComponent(of: path),
                &named,
                AT_SYMLINK_NOFOLLOW
            ) == 0,
                  ManagedCodexRuntimeBundleStoredIdentity(
                    named,
                    stableDirectory: true
                  ) == expectedDirectory,
                  named.st_mode & S_IFMT == S_IFDIR
            else {
                close(parent)
                return
            }
            let result = unlinkat(parent, lastComponent(of: path), AT_REMOVEDIR)
            close(parent)
            guard result == 0 else { return }
        }
        let parentURL = rootURL.deletingLastPathComponent()
        let parentDescriptor = open(
            parentURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard parentDescriptor >= 0 else { return }
        defer { close(parentDescriptor) }
        var namedRoot = stat()
        var completedRoot = stat()
        guard fstatat(
            parentDescriptor,
            rootURL.lastPathComponent,
            &namedRoot,
            AT_SYMLINK_NOFOLLOW
        ) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(
                namedRoot,
                stableDirectory: true
              ) == expectedRoot,
              fstat(rootDescriptor, &completedRoot) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(
                completedRoot,
                stableDirectory: true
              ) == expectedRoot,
              (try? ManagedCodexRuntimeBundleInspector.directoryNames(
                rootDescriptor,
                maximumNames: 1
              ))?.isEmpty == true
        else { return }
        _ = unlinkat(
            parentDescriptor,
            rootURL.lastPathComponent,
            AT_REMOVEDIR
        )
    }

    private struct EnumeratedPrivateTree {
        let rootIdentity: ManagedCodexRuntimeBundleStoredIdentity
        let files: [String: ManagedCodexRuntimeBundleStoredIdentity]
        let directories: [String: ManagedCodexRuntimeBundleStoredIdentity]
    }

    private static func enumeratePrivateTree(
        rootURL: URL
    ) throws -> EnumeratedPrivateTree {
        let rootDescriptor = open(
            rootURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootDescriptor >= 0 else { throw ManagedCodexRuntimeBundleError.changed }
        defer { close(rootDescriptor) }
        var rootInfo = stat()
        guard fstat(rootDescriptor, &rootInfo) == 0,
              rootInfo.st_mode & S_IFMT == S_IFDIR,
              rootInfo.st_uid == geteuid(),
              rootInfo.st_mode & 0o777 == 0o700
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            rootDescriptor,
            label: "private runtime root"
        )
        var files: [String: ManagedCodexRuntimeBundleStoredIdentity] = [:]
        var directories: [String: ManagedCodexRuntimeBundleStoredIdentity] = [:]
        try enumeratePrivateDirectory(
            descriptor: rootDescriptor,
            relativePath: "",
            depth: 0,
            files: &files,
            directories: &directories
        )
        return EnumeratedPrivateTree(
            rootIdentity: ManagedCodexRuntimeBundleStoredIdentity(
                rootInfo,
                stableDirectory: true
            ),
            files: files,
            directories: directories
        )
    }

    private static func enumeratePrivateDirectory(
        descriptor: Int32,
        relativePath: String,
        depth: Int,
        files: inout [String: ManagedCodexRuntimeBundleStoredIdentity],
        directories: inout [String: ManagedCodexRuntimeBundleStoredIdentity]
    ) throws {
        guard depth <= ManagedCodexRuntimeBundleInspector.maximumDirectoryDepth,
              files.count + directories.count
                <= ManagedCodexRuntimeBundleInspector.maximumEntryCount + 3
        else { throw ManagedCodexRuntimeBundleError.bounds("private tree") }
        let remaining = ManagedCodexRuntimeBundleInspector.maximumEntryCount + 3
            - files.count - directories.count
        guard remaining >= 0 else {
            throw ManagedCodexRuntimeBundleError.bounds("private tree")
        }
        for name in try ManagedCodexRuntimeBundleInspector.directoryNames(
            descriptor,
            maximumNames: remaining
        ) {
            guard files.count + directories.count
                < ManagedCodexRuntimeBundleInspector.maximumEntryCount + 3
            else { throw ManagedCodexRuntimeBundleError.bounds("private tree") }
            try enumeratePrivateEntry(
                parentDescriptor: descriptor,
                name: name,
                relativePath: relativePath,
                depth: depth,
                files: &files,
                directories: &directories
            )
        }
    }

    private static func enumeratePrivateEntry(
        parentDescriptor: Int32,
        name: String,
        relativePath: String,
        depth: Int,
        files: inout [String: ManagedCodexRuntimeBundleStoredIdentity],
        directories: inout [String: ManagedCodexRuntimeBundleStoredIdentity]
    ) throws {
        let path = relativePath.isEmpty ? name : relativePath + "/" + name
        var named = stat()
        guard fstatat(
            parentDescriptor,
            name,
            &named,
            AT_SYMLINK_NOFOLLOW
        ) == 0,
              named.st_uid == geteuid()
        else { throw ManagedCodexRuntimeBundleError.changed }

        if named.st_mode & S_IFMT == S_IFDIR {
            guard named.st_mode & 0o777 == 0o700 else {
                throw ManagedCodexRuntimeBundleError.changed
            }
            let child = openat(
                parentDescriptor,
                name,
                O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
            )
            guard child >= 0 else {
                throw ManagedCodexRuntimeBundleError.changed
            }
            defer { close(child) }
            var opened = stat()
            guard fstat(child, &opened) == 0,
                  ManagedCodexRuntimeBundleStoredIdentity(
                    opened,
                    stableDirectory: true
                  ) == ManagedCodexRuntimeBundleStoredIdentity(
                    named,
                    stableDirectory: true
                  )
            else { throw ManagedCodexRuntimeBundleError.changed }
            try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
                child,
                label: path
            )
            directories[path] = ManagedCodexRuntimeBundleStoredIdentity(
                opened,
                stableDirectory: true
            )
            try enumeratePrivateDirectory(
                descriptor: child,
                relativePath: path,
                depth: depth + 1,
                files: &files,
                directories: &directories
            )
            return
        }

        guard named.st_mode & S_IFMT == S_IFREG,
              named.st_nlink == 1,
              named.st_mode & 0o7077 == 0
        else { throw ManagedCodexRuntimeBundleError.changed }
        let file = openat(
            parentDescriptor,
            name,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard file >= 0 else { throw ManagedCodexRuntimeBundleError.changed }
        defer { close(file) }
        var opened = stat()
        guard fstat(file, &opened) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(opened)
                == ManagedCodexRuntimeBundleStoredIdentity(named)
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            file,
            label: path
        )
        files[path] = ManagedCodexRuntimeBundleStoredIdentity(opened)
    }

    private static func scavengeAbandonedStagingBundles(
        in parentPath: String,
        minimumAgeSeconds: Int64 = 60
    ) {
        let parentURL = URL(fileURLWithPath: parentPath, isDirectory: true)
        let parentDescriptor = open(
            parentPath,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard parentDescriptor >= 0 else { return }
        defer { close(parentDescriptor) }
        let now = Int64(time(nil))
        var cursor: String?
        while true {
            guard let names = managedRuntimeNames(
                in: parentDescriptor,
                after: cursor
            ),
                  !names.isEmpty
            else { return }
            for name in names {
                scavengeAbandonedStagingCandidate(
                    name: name,
                    parentURL: parentURL,
                    parentDescriptor: parentDescriptor,
                    now: now,
                    minimumAgeSeconds: minimumAgeSeconds
                )
            }
            cursor = names.last
        }
    }

    private static func isExactManagedRuntimeName(_ name: String) -> Bool {
        let stagingPrefix = directoryPrefix + stagingMarker
        let identifier: String
        if name.hasPrefix(stagingPrefix) {
            identifier = String(name.dropFirst(stagingPrefix.count))
        } else if name.hasPrefix(directoryPrefix) {
            identifier = String(name.dropFirst(directoryPrefix.count))
        } else {
            return false
        }
        guard let uuid = UUID(uuidString: identifier) else { return false }
        return identifier == uuid.uuidString.lowercased()
    }

    /// Enumerates a shared temporary parent without charging unrelated user
    /// entries against the managed-runtime safety bound. Only exact lowercase
    /// Blabee UUID names are retained, and the retained set remains bounded.
    private static func managedRuntimeNames(
        in parentDescriptor: Int32,
        after cursor: String?
    ) -> [String]? {
        let duplicate = fcntl(parentDescriptor, F_DUPFD_CLOEXEC, 0)
        guard duplicate >= 0, let directory = fdopendir(duplicate) else {
            if duplicate >= 0 { close(duplicate) }
            return nil
        }
        defer { closedir(directory) }
        rewinddir(directory)
        let limit = ManagedCodexRuntimeBundleInspector.maximumEntryCount + 3
        var names: [String] = []
        names.reserveCapacity(limit)
        while true {
            errno = 0
            guard let entry = readdir(directory) else {
                guard errno == 0 else { return nil }
                break
            }
            let decoded = withUnsafePointer(to: &entry.pointee.d_name) {
                pointer in
                pointer.withMemoryRebound(
                    to: CChar.self,
                    capacity: Int(NAME_MAX) + 1
                ) { String(validatingCString: $0) }
            }
            guard let name = decoded,
                  isExactManagedRuntimeName(name),
                  cursor.map({ name > $0 }) ?? true
            else { continue }
            insertIntoManagedRuntimeBatch(
                name,
                limit: limit,
                maxHeap: &names
            )
        }
        return names.sorted()
    }

    /// Maintains the lexicographically smallest bounded set in a max heap.
    /// Thus a crowded parent never requires unbounded memory. The caller
    /// advances an examined-name cursor and requests the next deterministic
    /// window only after the current directory stream has been closed.
    private static func insertIntoManagedRuntimeBatch(
        _ name: String,
        limit: Int,
        maxHeap: inout [String]
    ) {
        guard limit > 0 else { return }
        if maxHeap.count < limit {
            maxHeap.append(name)
            var index = maxHeap.count - 1
            while index > 0 {
                let parent = (index - 1) / 2
                guard maxHeap[parent] < maxHeap[index] else { break }
                maxHeap.swapAt(parent, index)
                index = parent
            }
            return
        }
        guard let largest = maxHeap.first, name < largest else { return }
        maxHeap[0] = name
        var index = 0
        while true {
            let left = index * 2 + 1
            guard left < maxHeap.count else { return }
            let right = left + 1
            let largerChild = right < maxHeap.count
                && maxHeap[left] < maxHeap[right] ? right : left
            guard maxHeap[index] < maxHeap[largerChild] else { return }
            maxHeap.swapAt(index, largerChild)
            index = largerChild
        }
    }

    private static func hasMinimumAge(
        now: Int64,
        since: Int64,
        minimumAgeSeconds: Int64
    ) -> Bool {
        let (age, overflow) = now.subtractingReportingOverflow(since)
        return !overflow
            && age >= 0
            && age >= max(0, minimumAgeSeconds)
    }

    private static func scavengeAbandonedStagingCandidate(
        name: String,
        parentURL: URL,
        parentDescriptor: Int32,
        now: Int64,
        minimumAgeSeconds: Int64
    ) {
        var namedRoot = stat()
        guard fstatat(
            parentDescriptor,
            name,
            &namedRoot,
            AT_SYMLINK_NOFOLLOW
        ) == 0,
              namedRoot.st_mode & S_IFMT == S_IFDIR,
              namedRoot.st_uid == geteuid(),
              namedRoot.st_mode & 0o777 == 0o700
        else { return }
        let modifiedAt = Int64(namedRoot.st_mtimespec.tv_sec)
        guard hasMinimumAge(
            now: now,
            since: modifiedAt,
            minimumAgeSeconds: minimumAgeSeconds
        )
        else { return }

        let rootDescriptor = openat(
            parentDescriptor,
            name,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootDescriptor >= 0 else { return }
        defer { close(rootDescriptor) }
        var openedRoot = stat()
        guard fstat(rootDescriptor, &openedRoot) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(
                openedRoot,
                stableDirectory: true
              ) == ManagedCodexRuntimeBundleStoredIdentity(
                namedRoot,
                stableDirectory: true
              ),
              (try? ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
                rootDescriptor,
                label: "abandoned private runtime root"
              )) != nil,
              let rootNames = try? ManagedCodexRuntimeBundleInspector
                .directoryNames(
                    rootDescriptor,
                    maximumNames:
                        ManagedCodexRuntimeBundleInspector.maximumEntryCount + 3
                )
        else { return }
        let rootURL = parentURL.appendingPathComponent(name, isDirectory: true)
        let rootIdentity = ManagedCodexRuntimeBundleStoredIdentity(
            openedRoot,
            stableDirectory: true
        )
        if rootNames.isEmpty {
            removeKnownTree(
                rootURL: rootURL,
                expectedRoot: rootIdentity,
                files: [:],
                directories: [:]
            )
            return
        }

        guard rootNames.contains(leaseName) else { return }
        let leaseDescriptor = openat(
            rootDescriptor,
            leaseName,
            O_RDWR | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard leaseDescriptor >= 0 else { return }
        defer { close(leaseDescriptor) }
        var leaseInfo = stat()
        guard fstat(leaseDescriptor, &leaseInfo) == 0,
              leaseInfo.st_mode & S_IFMT == S_IFREG,
              leaseInfo.st_nlink == 1,
              leaseInfo.st_uid == geteuid(),
              leaseInfo.st_mode & 0o777 == 0o600,
              (try? ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
                leaseDescriptor,
                label: "abandoned private runtime lease"
              )) != nil,
              flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0
        else { return }
        defer { _ = flock(leaseDescriptor, LOCK_UN) }
        let leaseIdentity = ManagedCodexRuntimeBundleStoredIdentity(leaseInfo)

        guard let current = try? enumeratePrivateTree(rootURL: rootURL),
              current.rootIdentity == rootIdentity,
              current.files[leaseName] == leaseIdentity
        else { return }
        if rootNames.count == 1 {
            guard current.files == [leaseName: leaseIdentity],
                  current.directories.isEmpty
            else { return }
            removeKnownTree(
                rootURL: rootURL,
                expectedRoot: rootIdentity,
                files: current.files,
                directories: current.directories
            )
            return
        }

        if Set(rootNames) == Set([leaseName, stagingPlanTemporaryName]) {
            guard current.directories.isEmpty,
                  current.files.count == 2,
                  current.files[leaseName] == leaseIdentity,
                  let partialPlan = current.files[stagingPlanTemporaryName],
                  (partialPlan.mode & 0o777 == 0o400
                    || partialPlan.mode & 0o777 == 0o600),
                  partialPlan.size >= 0,
                  partialPlan.size <= maximumStagingPlanBytes
            else { return }
            removeKnownTree(
                rootURL: rootURL,
                expectedRoot: rootIdentity,
                files: current.files,
                directories: current.directories
            )
            return
        }

        guard rootNames.contains(stagingPlanName) else { return }
        let planDescriptor = openat(
            rootDescriptor,
            stagingPlanName,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard planDescriptor >= 0 else { return }
        defer { close(planDescriptor) }
        guard let planData = try? readStagingPlanData(planDescriptor),
              let plan = try? JSONDecoder().decode(
                ManagedCodexRuntimeBundleStagingPlan.self,
                from: planData
              ),
              validateStagingPlan(
                plan,
                rootIdentity: rootIdentity,
                leaseIdentity: leaseIdentity,
                current: current,
                now: now,
                minimumAgeSeconds: minimumAgeSeconds
              )
        else { return }
        removeKnownTree(
            rootURL: rootURL,
            expectedRoot: rootIdentity,
            files: current.files,
            directories: current.directories
        )
    }

    private static func validateStagingPlan(
        _ plan: ManagedCodexRuntimeBundleStagingPlan,
        rootIdentity: ManagedCodexRuntimeBundleStoredIdentity,
        leaseIdentity: ManagedCodexRuntimeBundleStoredIdentity,
        current: EnumeratedPrivateTree,
        now: Int64,
        minimumAgeSeconds: Int64
    ) -> Bool {
        guard plan.planVersion == 1,
              plan.rootIdentity == rootIdentity,
              plan.leaseIdentity == leaseIdentity,
              hasMinimumAge(
                now: now,
                since: plan.createdAtSeconds,
                minimumAgeSeconds: minimumAgeSeconds
              ),
              plan.entries.count
                <= ManagedCodexRuntimeBundleInspector.maximumEntryCount,
              Set(plan.entries.map(\.path)).count == plan.entries.count,
              plan.manifest.layoutVersion == 1,
              plan.manifest.target
                == ManagedCodexRuntimeBundleInspector.expectedTarget,
              plan.manifest.variant == "codex",
              !plan.manifest.version.isEmpty,
              plan.manifest.version.utf8.count <= 64,
              plan.manifest.version.utf8.allSatisfy({ byte in
                  (byte >= 48 && byte <= 57) || byte == 46 || byte == 45
              }),
              plan.manifest.entrypoint == "bin/codex",
              plan.manifest.pathDir == "codex-path",
              plan.manifest.resourcesDir == nil
                || plan.manifest.resourcesDir == "codex-resources"
        else { return false }

        var totalBytes: Int64 = 0
        var declaredFiles:
            [String: ManagedCodexRuntimeBundleEntry] = [:]
        var declaredDirectories = Set<String>()
        for entry in plan.entries {
            guard (try? ManagedCodexRuntimeBundleInspector.requireBoundedPath(
                entry.path
            )) != nil,
                  entry.path != leaseName,
                  entry.path != sealName,
                  entry.path != stagingPlanName
            else { return false }
            switch entry.kind {
            case .directory:
                declaredDirectories.insert(entry.path)
            case .file:
                guard entry.identity.size >= 0,
                      entry.identity.size
                        <= ManagedCodexRuntimeBundleInspector.maximumFileBytes
                else { return false }
                let (sum, overflow) = totalBytes.addingReportingOverflow(
                    entry.identity.size
                )
                guard !overflow,
                      sum <= ManagedCodexRuntimeBundleInspector.maximumTotalBytes
                else { return false }
                totalBytes = sum
                declaredFiles[entry.path] = entry
            }
        }
        let fixedRuntimePaths = Set([
            "codex-package.json", "bin", "bin/codex",
            "bin/codex-code-mode-host", "codex-path", "codex-path/rg",
        ])
        guard declaredFiles["codex-package.json"]?.executable == false,
              declaredDirectories.contains("bin"),
              declaredFiles["bin/codex"]?.executable == true,
              declaredFiles["bin/codex-code-mode-host"]?.executable == true,
              declaredDirectories.contains("codex-path"),
              declaredFiles["codex-path/rg"]?.executable == true,
              plan.entries.allSatisfy({ entry in
                  if fixedRuntimePaths.contains(entry.path) { return true }
                  guard plan.manifest.resourcesDir == "codex-resources"
                  else { return false }
                  return entry.path == "codex-resources"
                    || entry.path.hasPrefix("codex-resources/")
              }),
              (plan.manifest.resourcesDir == nil)
                == !declaredDirectories.contains("codex-resources"),
              current.directories.keys.allSatisfy({
                  declaredDirectories.contains($0)
                    && current.directories[$0]!.mode & 0o777 == 0o700
              })
        else { return false }

        let metadata = Set([leaseName, sealName, stagingPlanName])
        guard let stagingPlanIdentity = current.files[stagingPlanName]
        else { return false }
        guard current.files.keys.allSatisfy({ path in
            if metadata.contains(path) { return true }
            guard let declared = declaredFiles[path],
                  let identity = current.files[path]
            else { return false }
            let expectedMode: UInt32 = declared.executable ? 0o500 : 0o400
            return identity.mode & 0o777 == expectedMode
                && identity.size >= 0
                && identity.size <= declared.identity.size
        }),
              current.files[leaseName] == leaseIdentity,
              stagingPlanIdentity.mode & 0o777 == 0o400,
              stagingPlanIdentity.size > 0,
              stagingPlanIdentity.size <= maximumStagingPlanBytes,
              current.files[sealName].map({
                  $0.mode & 0o777 == 0o400
                    && $0.size > 0 && $0.size <= maximumSealBytes
              }) ?? true
        else { return false }
        return true
    }

    private static func readStagingPlanData(_ descriptor: Int32) throws -> Data {
        var before = stat()
        guard fstat(descriptor, &before) == 0,
              before.st_mode & S_IFMT == S_IFREG,
              before.st_nlink == 1,
              before.st_uid == geteuid(),
              before.st_mode & 0o777 == 0o400,
              before.st_size > 0,
              before.st_size <= maximumStagingPlanBytes
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            descriptor,
            label: stagingPlanName
        )
        var data = Data(count: Int(before.st_size))
        let didRead = data.withUnsafeMutableBytes { bytes -> Bool in
            var offset = 0
            while offset < bytes.count {
                let count = pread(
                    descriptor,
                    bytes.baseAddress?.advanced(by: offset),
                    bytes.count - offset,
                    off_t(offset)
                )
                if count <= 0 { return false }
                offset += count
            }
            return true
        }
        var after = stat()
        guard didRead,
              fstat(descriptor, &after) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(after)
                == ManagedCodexRuntimeBundleStoredIdentity(before)
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireBoundedJSONDepth(data)
        try ManagedCodexRuntimeBundleInspector.requireUniqueJSONKeys(data)
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              Set(dictionary.keys) == Set([
                "planVersion", "createdAtSeconds", "rootIdentity",
                "leaseIdentity", "manifest", "entries",
              ])
        else { throw ManagedCodexRuntimeBundleError.changed }
        return data
    }

    private static func scavengeSealedBundles(
        in parentPath: String,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) {
        let parent = URL(fileURLWithPath: parentPath, isDirectory: true)
        let parentDescriptor = open(
            parentPath,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard parentDescriptor >= 0 else { return }
        defer { close(parentDescriptor) }
        let now = Int64(time(nil))
        var cursor: String?
        while true {
            guard let names = managedRuntimeNames(
                in: parentDescriptor,
                after: cursor
            ),
                  !names.isEmpty
            else { return }
            for name in names {
                guard !name.hasPrefix(directoryPrefix + stagingMarker)
                else { continue }
                scavengeSealedCandidate(
                    name: name,
                    parent: parent,
                    now: now,
                    executableVerification: executableVerification
                )
            }
            cursor = names.last
        }
    }

    private static func scavengeSealedCandidate(
        name: String,
        parent: URL,
        now: Int64,
        executableVerification: ManagedCodexRuntimeExecutableVerification
    ) {
        let directoryURL = parent.appendingPathComponent(name, isDirectory: true)
        var rootInfo = stat()
        guard lstat(directoryURL.path, &rootInfo) == 0,
              rootInfo.st_mode & S_IFMT == S_IFDIR,
              rootInfo.st_uid == geteuid(),
              rootInfo.st_mode & 0o777 == 0o700,
              hasMinimumAge(
                now: now,
                since: Int64(rootInfo.st_mtimespec.tv_sec),
                minimumAgeSeconds: 60
              )
        else { return }
        let rootDescriptor = open(
            directoryURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootDescriptor >= 0 else { return }
        defer { close(rootDescriptor) }
        let leaseDescriptor = openat(
            rootDescriptor,
            leaseName,
            O_RDWR | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard leaseDescriptor >= 0 else { return }
        defer { close(leaseDescriptor) }
        guard flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0 else { return }
        defer { _ = flock(leaseDescriptor, LOCK_UN) }
        let sealDescriptor = openat(
            rootDescriptor,
            sealName,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard sealDescriptor >= 0 else { return }
        defer { close(sealDescriptor) }
        guard let sealData = try? readSealData(sealDescriptor),
              let seal = try? JSONDecoder().decode(
                ManagedCodexRuntimeBundleSeal.self,
                from: sealData
              ),
              seal.sealVersion == 1,
              seal.rootIdentity == ManagedCodexRuntimeBundleStoredIdentity(
                rootInfo,
                stableDirectory: true
              )
        else { return }
        var openedLease = stat()
        guard fstat(leaseDescriptor, &openedLease) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(openedLease)
                == seal.leaseIdentity
        else { return }
        let executable = directoryURL.appendingPathComponent(
            "bin/codex",
            isDirectory: false
        )
        guard let inspection = try? ManagedCodexRuntimeBundleInspector
            .inspectPrivateBundle(
                executableURL: executable,
                executableVerification: executableVerification
            ),
              inspection.manifest == seal.manifest,
              inspection.entries == seal.entries
        else { return }
        var sealInfo = stat()
        guard fstat(sealDescriptor, &sealInfo) == 0 else { return }
        let sealIdentity = ManagedCodexRuntimeBundleStoredIdentity(sealInfo)
        let sealDigest = SHA256.hash(data: sealData)
            .map { String(format: "%02x", $0) }.joined()
        removeSealedBundleIfExact(
            directoryURL: directoryURL,
            expectedInspection: inspection,
            leaseDescriptor: leaseDescriptor,
            expectedLease: seal.leaseIdentity,
            expectedSealIdentity: sealIdentity,
            expectedSealDigest: sealDigest
        )
    }

    #if DEBUG
        static func scavengeSealedBundlesForTesting(in parentURL: URL) throws {
            let parentPath = try validatedParentPath(parentURL)
            scavengeAbandonedStagingBundles(
                in: parentPath,
                minimumAgeSeconds: 0
            )
            scavengeSealedBundles(
                in: parentPath,
                executableVerification: .trustedTestFixture
            )
        }
    #endif

    private static func readSealData(_ descriptor: Int32) throws -> Data {
        var before = stat()
        guard fstat(descriptor, &before) == 0,
              before.st_mode & S_IFMT == S_IFREG,
              before.st_nlink == 1,
              before.st_uid == geteuid(),
              before.st_mode & 0o777 == 0o400,
              before.st_size > 0,
              before.st_size <= maximumSealBytes
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireNoGrantACL(
            descriptor,
            label: sealName
        )
        var data = Data(count: Int(before.st_size))
        let result = data.withUnsafeMutableBytes { bytes -> Bool in
            var offset = 0
            while offset < bytes.count {
                let count = pread(
                    descriptor,
                    bytes.baseAddress?.advanced(by: offset),
                    bytes.count - offset,
                    off_t(offset)
                )
                if count <= 0 { return false }
                offset += count
            }
            return true
        }
        var after = stat()
        guard result,
              fstat(descriptor, &after) == 0,
              ManagedCodexRuntimeBundleStoredIdentity(after)
                == ManagedCodexRuntimeBundleStoredIdentity(before)
        else { throw ManagedCodexRuntimeBundleError.changed }
        try ManagedCodexRuntimeBundleInspector.requireBoundedJSONDepth(data)
        try ManagedCodexRuntimeBundleInspector.requireUniqueJSONKeys(data)
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any],
              Set(dictionary.keys) == Set([
                "sealVersion", "rootIdentity", "leaseIdentity", "manifest",
                "entries",
              ])
        else { throw ManagedCodexRuntimeBundleError.changed }
        return data
    }

    #if DEBUG
        static func setInjectedFailurePoint(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint?
        ) {
            testingLock.withLock { injectedFailurePoint = point }
        }

        static func setBeforeSourceRevalidationHook(
            _ hook: (@Sendable () throws -> Void)?
        ) {
            testingLock.withLock { beforeSourceRevalidationHook = hook }
        }

        static func setPreserveFailedStagingForTesting(_ preserve: Bool) {
            testingLock.withLock { preserveFailedStaging = preserve }
        }

        private static func runBeforeSourceRevalidationHook() throws {
            let hook = testingLock.withLock { beforeSourceRevalidationHook }
            try hook?()
        }

        private static func shouldFail(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint
        ) -> Bool {
            testingLock.withLock { injectedFailurePoint == point }
        }

        private static func shouldPreserveFailedStagingForTesting() -> Bool {
            testingLock.withLock { preserveFailedStaging }
        }

        private static func failIfRequested(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint
        ) throws {
            guard shouldFail(point) else { return }
            testingLock.withLock { injectedFailurePoint = nil }
            throw ManagedCodexPinnedExecutableInjectedFailure(point)
        }
    #else
        static func setInjectedFailurePoint(
            _: ManagedCodexPinnedExecutableCreateFailurePoint?
        ) {}
        static func setBeforeSourceRevalidationHook(
            _: (@Sendable () throws -> Void)?
        ) {}
        static func setPreserveFailedStagingForTesting(_: Bool) {}
        private static func shouldFail(
            _: ManagedCodexPinnedExecutableCreateFailurePoint
        ) -> Bool { false }
        private static func shouldPreserveFailedStagingForTesting() -> Bool {
            false
        }
        private static func failIfRequested(
            _: ManagedCodexPinnedExecutableCreateFailurePoint
        ) throws {}
    #endif
}
