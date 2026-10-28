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
        // A test hook changes process-wide validation behavior. Keep the lock
        // for the entire scoped test body so independently serialized suites
        // cannot observe each other's hook. Validation re-enters the lock on
        // the same thread, hence the recursive lock.
        private static let testingLock = NSRecursiveLock()
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
        let digest = try digestFile(
            descriptor: descriptor,
            expectedBytes: Int64(info.st_size),
            label: relativePath
        )
        // Official 0.155-0.160 packages mark voice/runtime.json executable despite
        // its being data. Only that exact catalog-pinned resource may lose the
        // executable classification; arbitrary scripts/JSON still fail closed.
        // Private custody seals this data as 0400 without changing the source.
        let executable = info.st_mode & 0o111 != 0
            && !ManagedCodexRuntimeBundleQualificationCatalog.isQualifiedDataResource(
                path: relativePath, digest: digest
            )
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
        defer { ancestorChain.close() }
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
                try testingLock.withLock {
                    try signatureValidationHook?(label, path)
                }
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
        let eventQueue: Int32?
        let usesStableDirectoryIdentity: Bool

        func close() {
            if let eventQueue { Darwin.close(eventQueue) }
            descriptors.forEach { Darwin.close($0) }
        }
    }

    private static func openNamedAncestorChain(
        path: String
    ) throws -> NamedAncestorChain {
        let components = path.split(separator: "/").dropLast().map(String.init)
        var descriptors: [Int32] = []
        var metadata: [stat] = []
        var eventQueue: Int32?
        var allAncestorsUseLocalAPFS = true
        let root = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else {
            throw ManagedCodexRuntimeBundleError.identity(
                "executable ancestor root cannot be opened"
            )
        }
        descriptors.append(root)
        do {
            allAncestorsUseLocalAPFS = try observeNamedAncestor(
                descriptor: root,
                eventQueue: &eventQueue
            )
            var rootInfo = stat()
            guard fstat(root, &rootInfo) == 0 else {
                throw ManagedCodexRuntimeBundleError.changed
            }
            metadata.append(rootInfo)
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
                let observed = try observeNamedAncestor(
                    descriptor: child,
                    eventQueue: &eventQueue
                )
                allAncestorsUseLocalAPFS = allAncestorsUseLocalAPFS && observed
                var info = stat()
                guard fstat(child, &info) == 0 else {
                    throw ManagedCodexRuntimeBundleError.changed
                }
                metadata.append(info)
                parent = child
            }
            let chain = NamedAncestorChain(
                descriptors: descriptors,
                componentNames: components,
                identities: metadata.map {
                    ManagedCodexRuntimeBundleStoredIdentity(
                        $0,
                        stableDirectory: allAncestorsUseLocalAPFS
                    )
                },
                eventQueue: eventQueue,
                usesStableDirectoryIdentity: allAncestorsUseLocalAPFS
            )
            guard validateNamedAncestorChain(chain) else {
                throw ManagedCodexRuntimeBundleError.changed
            }
            return chain
        } catch {
            if let eventQueue { close(eventQueue) }
            descriptors.forEach { close($0) }
            throw error
        }
    }

    private static func observeNamedAncestor(
        descriptor: Int32,
        eventQueue: inout Int32?
    ) throws -> Bool {
        // Vnode notification support varies by filesystem. Keep the previous
        // strict metadata comparison unless every ancestor is on local APFS.
        var filesystem = statfs()
        guard fstatfs(descriptor, &filesystem) == 0,
              filesystem.f_flags & UInt32(MNT_LOCAL) != 0
        else { return false }
        let filesystemName = withUnsafeBytes(of: &filesystem.f_fstypename) {
            String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self)
        }
        guard filesystemName == "apfs" else { return false }

        if eventQueue == nil {
            let queue = kqueue()
            guard queue >= 0 else {
                throw ManagedCodexRuntimeBundleError.changed
            }
            eventQueue = queue
            guard fcntl(queue, F_SETFD, FD_CLOEXEC) == 0 else {
                throw ManagedCodexRuntimeBundleError.changed
            }
        }
        guard let eventQueue else {
            throw ManagedCodexRuntimeBundleError.changed
        }
        // Register before the stat baseline. WRITE/LINK describe child-entry
        // churn, while these flags preserve rename and permission/ACL ABA
        // evidence during the path-based signature check.
        var change = kevent(
            ident: UInt(descriptor),
            filter: Int16(EVFILT_VNODE),
            flags: UInt16(EV_ADD | EV_CLEAR | EV_RECEIPT),
            fflags: UInt32(NOTE_RENAME | NOTE_DELETE | NOTE_REVOKE | NOTE_ATTRIB),
            data: 0,
            udata: nil
        )
        var receipt = kevent()
        var timeout = timespec(tv_sec: 0, tv_nsec: 0)
        guard kevent(eventQueue, &change, 1, &receipt, 1, &timeout) == 1,
              receipt.ident == change.ident,
              receipt.filter == change.filter,
              receipt.flags & UInt16(EV_ERROR) != 0,
              receipt.data == 0
        else { throw ManagedCodexRuntimeBundleError.changed }
        return true
    }

    private static func namedAncestorEventsAreUnchanged(
        _ chain: NamedAncestorChain
    ) -> Bool {
        guard chain.usesStableDirectoryIdentity else { return true }
        guard let eventQueue = chain.eventQueue else { return false }
        var event = kevent()
        var timeout = timespec(tv_sec: 0, tv_nsec: 0)
        // Any event (including EV_ERROR), query failure, or interruption fails
        // closed. An observed change is never drained and then forgotten.
        return kevent(eventQueue, nil, 0, &event, 1, &timeout) == 0
    }

    private static func validateNamedAncestorChain(
        _ chain: NamedAncestorChain
    ) -> Bool {
        guard chain.descriptors.count == chain.identities.count,
              chain.descriptors.count == chain.componentNames.count + 1,
              namedAncestorEventsAreUnchanged(chain)
        else { return false }
        for index in chain.descriptors.indices {
            var current = stat()
            guard fstat(chain.descriptors[index], &current) == 0,
                  ManagedCodexRuntimeBundleStoredIdentity(
                    current,
                    stableDirectory: chain.usesStableDirectoryIdentity
                  )
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
                      ManagedCodexRuntimeBundleStoredIdentity(
                        named,
                        stableDirectory: chain.usesStableDirectoryIdentity
                      )
                        == chain.identities[index]
                else { return false }
            }
        }
        return namedAncestorEventsAreUnchanged(chain)
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

    static func withSignatureValidationHook<Result>(
        _ hook: @escaping @Sendable (
            _ label: String,
            _ path: String
        ) throws -> Void,
        perform body: () throws -> Result
    ) rethrows -> Result {
        #if DEBUG
            return try testingLock.withLock {
                let previous = signatureValidationHook
                signatureValidationHook = hook
                defer { signatureValidationHook = previous }
                return try body()
            }
        #else
            return try body()
        #endif
    }

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
        // Official rust-v0.155.0 arm64 archive sha256:b1411ec00ac410467e05cf8fb5b063cf83632613530201cd4724ef8dd0e9c33f.
        Key(version: "0.155.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "b0b14f9c1901c1ec44671094b2dc18b39e4bd8d36a6dc2302cc9d961a7e2a197",
                "bin/codex-code-mode-host":
                    "c9a1c8ffa0c709ed96cb41073d24ce5a354c37a22e11cf1e4f150b9de07ce0d9",
                "codex-package.json":
                    "a120c47da87730d3a8565fcf1363ee32850c191ef34f01594dd19cd55855812f",
                "codex-path/rg":
                    "308ce8ad0cc5c9da6c054894cb6cebb7811602774dad22969a600206c220206e",
                "codex-resources/voice/NOTICE.md":
                    "edadf0a401a293778fdb7416707b1ac55df26a686388d3b2db72cd2043763c16",
                "codex-resources/voice/bin/codex-voice-host":
                    "3c04012f83e416e990bb59d254cdbdf4011dda3fba91630d0dffcfe5104f1f76",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "39fa3122a90c495a8c467ffb6cf34d9988ea1dbec8f4a244144f636d2e8360e5",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "7b9e609c8a4e22ac680576c99b771f1e1c3066de0f513a792610dd034d11d131",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "b89d5b7a17004e176064457a6291802b9d8f45f98bdb3d969e8c8f9ae755d4b5",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "fa92e6289a7597be49330f7c1a5018c587899d05aa7cfd7771e6de329493d9d3",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "3db95dd1ee9f1fc8401fb40b17aac58ed3bd502e765fb648616626e9b973fdba",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "35ad7067e5c47e1144bfc69e3bea692b4959a4b9b4afaca0513b3748590799f7",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "b40164340b5b2e8f628372e44be46f334f4a8a27f5a52194bda93ec185335190",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "40da4e0d1da746a1dcab5eef161581db9156fb8f02d707f8e75565f043da934f",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "56fe075d30c01d586751b288e1321a1df126e339b758b2d6df0e56643fb3bbf5",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "fd8757e572264d121db49ab1c067f6c1eb836551871c4f66dc61f1d5c57794f1",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "e90e226a461dd38ccf6ab4f5689e92b284637973ef46dded56dbf64b0d9c76f5",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "397e72c1cf6272ddafec7908ae047f3445fb6b3efc47830c225973239ec41ee6",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "b2ac072faaa0e8f0a8b3338fdb5b56dfd3a262e40b71a0f8a81c67fea04d365c",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "41b902a4730e9468af77241bdf16e188147b634be06100c03f43bc579345bfa7",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "ce5aa2a476ad9dafcc79fbabca9797f55ff95b26d4aae69867aaeb008b1802df",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "f7a731391a179457e9501259b6b233a3468aaa7ba8d42ad2f573ca6a520f5b10",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "f2dfe3188a7e552911047871022cb3dc2c2c52b7ca7a03d9385d5f0d968b23fe",
                "codex-resources/voice/lib/libz.1.dylib":
                    "0bee3a6d55258a8c7b7e129ebb5107fc3b9ca2b6117d4c519ecd5b28327080b1",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "2060f74604d250ebbd30965635bc22cc6ec4968232e3327135c811d2a69ece89",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "35d082995eb06c111646af53c59d9250caf596124250a1f4775bfd464f772748",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "1a051850c4a683b925d5bd63340a795ae832d1c34224f4bbe5638eb884cf8683",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "25799f7ce01023253545eba481467847978720fed6225c143b324b292b824b7b",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "7bb1b68ee0bd27b9c3cda1b9bf18f4f405f0dcb946cf43991dd033e4c3345e1a",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "996f1d7b85dd0bf32e1dea37ea86f325cc708b489996b58a4c0ec960c4204e89",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "12ed6f374c7ebb7ce4c220fb5b0af2d29cfcd8f88dbbf0cdb70db3208b46895d",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "93632f02fd99c9de71a984f2e1527c3d5fa0d602433d8b41b7859d5096f92c0b",
                "codex-resources/voice/runtime.json":
                    "d2374a345b9533cf306beb9638c3887c9d7ac11c48fb0f7acfc7ff30bcab3c9e",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "c195d556b3afafd4e6fa667bbb6d1c2c6ec0e105f263460071db18ffdaaa34c8",
            ],
            fingerprint:
                "115a008c1ab06a4070b7078954189b192c8e1278cf8b49ba5d80920ec5dc6095"
        ),
        // Official rust-v0.155.1 arm64 archive sha256:e6e08717da9e35b72332eff753527fe79a9ae876081033c5c6820a8e5f58b943.
        Key(version: "0.155.1", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e",
                "bin/codex-code-mode-host":
                    "59a702a68f1ef79fceaca644db46b8385ceefbb66035e78b8ade7cdcc21fda55",
                "codex-package.json":
                    "b4895dbb7a0b6532d819809d798eca98e0f6c3dcaa417ad9b39bc32640618424",
                "codex-path/rg":
                    "c6c50764c763f44464bd4681dc0392668b2cb42f88bd123f8d0b43fbf3b02576",
                "codex-resources/voice/NOTICE.md":
                    "edadf0a401a293778fdb7416707b1ac55df26a686388d3b2db72cd2043763c16",
                "codex-resources/voice/bin/codex-voice-host":
                    "be67257c4308d9f8460493ab1789297350b2d398547087fe0bff7bcc624c443d",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "4fa18eb30e8407e5cc16afa30a643b402a22c0ea37a6dc9450ab99aecd88f62e",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "0e31023e6498d08ae702019ac4cd8d388c96afba6085e28c9ea5ba5efb8075e1",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "23c39e06b864f74d8b86b3ae9596568a5b009823e38d29fe462b44804cb2e606",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "46058202a8a679fae5b248bf74f5daaa37ada6c46991d35bb65b9a2d5f1cf686",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "eca170837e173884a736343c58268d1ef7adae9034b6d3b8d3e0b8d36336301a",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "3f6a6542b8bcbf3cbfb0fd9246abc9a858722d1dd5b74e268f15c8e06c74d2c1",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "0d8ee5b5dc742324c9ab74e4384378e7373900b8fbfa5a4101f153e429033561",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "0b4ecd24beb23e6f258bfd661a33ff3d1e4a7383e46aedba2085df567a9951ab",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "a5edfbbddd1875472d0ce14a2673a740705a2449780b95c70149fd425fa6244c",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "d2cef4b2287ed3bdb5d71f50f4071917531155312aed24d869e0228e03827571",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "39c1725b3aae9d9aa154e7937988032b23f67d98c4ab6e4a38fb2bad247d544b",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "473813e09b9a1db3ea131662c90907eb9aaaec504078767f503440243866c4b3",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "645fdcf191167e7be94f3cdf6c526960d27ce99665ba5947eb407132286340c4",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "39fb8be790e196e686690ebf75e5f7c4558d5a4e4e79c57c41743004a68f1e39",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "686944b9fccfc3179bb91a3d12ebd5cfcf8fb1d0100da63c4f3b0f3be86305db",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "3090c1988f7046c78c4856e115ac93d9917830e4d8bb27327b43c64447f82a92",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "fcae9e2caaf8c516244c95b386299b0c8a706df95b3a4f20245b1a61732a8b5c",
                "codex-resources/voice/lib/libz.1.dylib":
                    "df31491c6d32ec00c2411359524b0bc0ed3e6e1e8c49bd5561ed8890911ec25c",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "0e5ab5f2c4d3b9b07aa7ef0166cb4cca9f30672b63c90ebb11f1acd5920b0928",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "127b3740d40a727102239061bd179e850c78c4736291fe55a38da9c8630b91f4",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "ea1048cab051959cdc8730ec186274389f41b22848e7aed470ae936e1cf5a01e",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "b1faf437f781386e98e79688fec332816fc741304d70c1fca41ca52447b5b5e4",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "3fec07badb54b1364e1a906efa305ac73b7c86275c79cb2767eae9a39df0453f",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "fd2b9cb054f7dec866c508212d345a5459097f7f550e676f2a29ba14fb48f8a8",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "c8910ce8ffdd66e5d1e8c3d69beb282506905d73e8baf3a73f18216a43cec76d",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "338cd280a8d2693358d21039b8c429199ab178b9b5b7693c2d35443bdf04ac64",
                "codex-resources/voice/runtime.json":
                    "27db27d294d7c76fadb0c7dfd6d6e9130f4c2fd2448ec633517067ad1542ca00",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "7f3cb812c2954e63cafd045acfcc8093319529eea532979a73a813e3745c9bd3",
            ],
            fingerprint:
                "91948415ab606b4e7272b60b8f7d53cc10b5eef2d931591ae93e3a27c969856a"
        ),
        // Official rust-v0.156.0 arm64 archive sha256:6f7bdad25693f464a146ad6f24d477ad6fbffe07b62556f829ee5d3b04f48f8b.
        Key(version: "0.156.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "6b42db4d33fd53516162bd76a0e2d07e0567287c44e036d4e4c06cb555a432f9",
                "bin/codex-code-mode-host":
                    "5be43a1e34665382fa2526803bece18e8d6c42c299d9b4b025b43304203e7b2f",
                "codex-package.json":
                    "dd353ccc9403d84664d7850500c319b077e5ac94da32644076e7f26f277df7d9",
                "codex-path/rg":
                    "b80edb4751e1606284acac0435a976ce4cf581086fe71b029ce9cea4a7c63577",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "60a95c51ecdf2c62b0f143a8991436870bbdc0e18973fdc3fdfdcfc5d6947968",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "8e2eb9c2ce0b5d3ae29239c7f4827bfce13482e4d5e758bb7cf6c545e2192a94",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "aab3d9ee17a9f314aa27b650cb89a12b4a693b431b7e88a71e03a95ee2cb69e6",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "39dadeae0d41f057ef754cef648d61813f58264c0e94862049f51ea80b2d772a",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "39918bc2a9b623b7ac3f0d9ccd9127a514e22e5842571d440da473d36ab0c2c9",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "24f270059526dc1a1c380433ccb82842287a67f0a3f42eb278c02a171e3d18f0",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "f21f669727d765db21ada03e19a8c8d4a74c3b9bf01c05c5152c005fdd897be7",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "8bc0575463c34f456acebde8f2e4c3f10abaa978f062963deece970a679fe6fe",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "4a90b09ea7d2290e05e80fdf486a5a89d1a41b8f9fa749ee9ffa5c237407de66",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "8bc31407562b394d8273e93e00ef7f4e3c59e1e1920ac19e8e0ffbe98d262095",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "9c0b701a05738bbe8ab4cc164ba89585f996089cc9d5a9ad50253711ed27867a",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "d0d26a43fb783dc6eb9e84becf39c457729dd42d01aa887c3b11ddb10b0648b9",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "b95783647ca9a6b2075c1fd55ab8f700fec24ca4e23b9fb3bb5890e2d0b91cbe",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "2631794ad08e4292e3691d9a3b387265eff6ff9fd7c4b89fcc6cf314b30713fd",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "224384fbf84ac0e848cc66357a0a3e2a6df6f9137afe07d82b3ecb7c738f6d1b",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "d31cef1e8b15252834a852962f77d8472f69a4c89f8f18e88fd53b38e44b4f8b",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "4a5b77b0d7c505b36455770b11f10ec97f70a2c4861cab96d605a131655d723f",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "c2e852a28ffb515fbfa33b908055ab9e1ce26d5d3248927fd2501f290ab92d48",
                "codex-resources/voice/lib/libz.1.dylib":
                    "b22f0764b21052b1bfe0ebaff2d4c77f34e3d06cbba70f31cbb67a05cee94cc4",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "83c48caa2f5175fdf7f5ada026f2e4991e815130a075635bc052760ac89802a6",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "75dbe3bd20fdf7c6aa0207b44b9de264bfa7f1ddfc2725b74c52b446f3e058f2",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "acc812668b9950c2267ba095eb8768e5fb7f45d27860be1be6b2642dd189af91",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "685b365ab37baffdbb97880b9f1d00a2ed400eea22b61f58c42a6abcc31d21c0",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "9d89a83482e1fcab27c0b467cb58e1d6dd0cc042f7dd42e0b757db1ff04e14aa",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "d4d359f9ae4f8521d40c47adc09af26d51c472f52d0bd36277a3ca5114fae464",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "b0edb287168e70aae0dc327b7668c62c5e20a161beff349e907407b7e65f17c3",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "ba64ea4ec4eef0ee4e4145f7a7ec467ee91420f7a2f9bc324a62b57dded033c2",
                "codex-resources/voice/runtime.json":
                    "f37bcefac13b318e008e3e06e19025798cc612e136f3c2d9c518866c7b5a3214",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "173a6cef40f13bfdd2d89184c481b9b8ca55ab0a481dbb1ad297b9266d0d1ac9",
            ],
            fingerprint:
                "d0306e399bfd8310d8b8b07006c5ba3ec05c81491ebd510177d3676ddf1d2b52"
        ),
        // Official rust-v0.156.1 arm64 archive sha256:fea42f9625091f011e38f059da974d52e57ba31831648bb1c7f0b1a385fde547.
        Key(version: "0.156.1", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "0196e89fe5a7598f816ee54232c3d7c26d75e502ab5cfe2c9240e81d90f7255a",
                "bin/codex-code-mode-host":
                    "588df0df1dab35f99f272f9f499a9fada658c613d09ef34562fe274dd54287d6",
                "codex-package.json":
                    "8cfe3c74213893c106dd8ba8eb13562cde2e6de50b022558e88ef8665f8a0f1a",
                "codex-path/rg":
                    "70e1d8ccc5fed31fe710379ed8f2466f1e31364e57598cac6c96d6a0723b1842",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "e15e7aa3122251780bbd2e299aa0619bcb820a5efe9f811b70139a776eb8814d",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "a1e2feeb78827bc94740232e888215d688418c9cad75a501dcf2f37ea4c95211",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "3248dee760c95615f2f8280e5013fd3dccc27eb0e42dba3e29aa8347eb342f87",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "bee9de72fc93be3b497a997bd62e0749e8653a2e9a0738dc4ec7739ec4a3a210",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "4e4b821db8702fd2bf435b32a360b823a184f13e35d9d1e7025f829ef7ac715b",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "025d16230934502579273443c9ddabb8936d08d439bbb7565fc3d23dcb586001",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "f39ae64b4466ce098d848123cdcdcb9fb350cf3d526df9ef5b8cdae3a14d0b59",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "c1f626409f788a03ea03681cc37626a4a5d8af6f1f4dab9b8024114481e04db0",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "2a6d4c5457eb61af5dd2d0e2bb0f9718c19f147ee8cbf027a694328faec61856",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "abc1df29683c585109aafe8ec777998646970e3f875543bc16c5d66ff1d4c42d",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "da8e9070b47e1f8dd8baea874bc784a79daac25377a414c131f3865bac982a99",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "972ea08caf24d5816c2df29f531260459b2e2feb171328be8d46a31298564531",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "55fbd30a5c00c72a83c36ef6b788659cd8ba502094b9c25e9a2f7ed69a2b5346",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "148cd4755b457be7cc083a2513b76ca6c4ac6587488626ccf317f696880f6971",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "f0cb9e44a28d5a8f8e81bf355de86397d95f3efacd2bb76b29bca42bb58f9fce",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "8a0bc703b61f30012d36bebf0037b80852eb001a82f44ae520327c6c5d80e143",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "acb3307c245ff627da58bfffc5754fbd702bf6a511b17d2d0c9f0a65a7dd39f7",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "cff9e846cad92adcbcfc2bbca3a27cc308daca5405aff038251d535d462f01b5",
                "codex-resources/voice/lib/libz.1.dylib":
                    "4410a0dcb338127888f95d7547785e63193f797865e6024e1dab9fcaf934a4f0",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "7ead5f0a1fd5e805fdfbffec2c61ddcde8c2a8e59b5a305df3049cf58177654a",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "90ec173fd508f051823de92ce0866dbc90ebfdd55250e61ef4555d090f7c35eb",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "5d313918c967529c123e1ca04bdf08f9c086c7921c8441f4b3098925217ef394",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "cda302cd809210ebe975e5254718fd4fab630129c1259772b4266d717eec5d8b",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "207b96034eeb74bf9deb32e731e7d33ee8f1e0d715869a4f8860a0d9df570ff4",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "df10d767407c999302382921c45165136f9a9133d74d985e903c4ebd2c2e86c9",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "7a1eef95aeca30078e6a8373751224fad796b3d06851dd7140d30c576f474c9a",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "c444c846a1aed111ef5573282db096ef140a51ddedb09f37972a4d9608cb3743",
                "codex-resources/voice/runtime.json":
                    "9d7dfeb74cf2073c8cb5c36e67e10b131ac1db091324f59fcfbaa33a79404566",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "0bf624bdb53d1fa7ad979016f31e837c59bce197de27cfbf065d867fb866f098",
            ],
            fingerprint:
                "f38f13051ab45aa8d4d58b4e05d642dd29522e071d605d14778271004f3354bc"
        ),
        // Official rust-v0.157.0 arm64 archive sha256:97809f91cb355e55480cd7a126f9ad24bb7b162222515e30286bcac6fba94acd.
        Key(version: "0.157.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "ad0be20d04e2ba6146ecdb51d7f8b7b0fe15420a15dc9b0057518d858f1f3714",
                "bin/codex-code-mode-host":
                    "92672414d06556905c775c8ee8a8840f259055f66708adbf819b57dd613dd388",
                "codex-package.json":
                    "635aebe966216d8a94a2e6ea6ce6089388ac1d68cfb7e1eb82a73ae86fdefaa7",
                "codex-path/rg":
                    "87cf97cab3dec2f4219003ff38201a244f8172172a53fd05288c68179c85f805",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "a609601572ef5a02e99bac2a9f9de2a156be425f28b8fb8e523796b9f9a651da",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "9fcbdd4182cd140a278b10565ae40f0efa44fbdcb6b80557faa41496ca077b06",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "c9066d5ddfcb91234004fe68645a37459cd14648659b9b7d5f3c1c592bb61340",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "f96656b0fb1354198b807a5b49e97cc7bcc029fe886f8a3f999138809d665db7",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "75b953985d22bce32190d317edded0991319487026ddd29bacd991c941000bdb",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "0cf327eaae0614ebee73620b417bf982b1c2863b57132919e664f8b590500264",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "fbac84f4f03bf200430bdfd5413d657ed17f1c9fe7eaae4285fbe131c6b488ea",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "d7d9dd9dd0c9c9682f499cf370260a292c1fa756b59041005d7d8294fc030ddf",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "9e3a3ffbaf21fb1459ecefe93f635ae04cf165934c62e4df9fbe46ca22c678f8",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "91a40d44f87c6894bd968e2db7a41714f85e67d7fc7644a00b73bce9b4e9ba7c",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "9e4b3a43c35d837c8731ac05fac1c67e80c6077702f949faf69948e604970308",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "ea0ab974cf6468c6aaf24d270cf04180e5b27d1793900f2fda26cb051c9d20fd",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "cf8c4ac33ea36c542671f763fc113ee6b2e908d7c2b744346602b6b3ee5d19b9",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "1fd9d9804c6ce51b47e828e79817d5e506763508a39bc4cc4d9d6bbc73c58f6e",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "4ada365f141dec9bc01033dff47a0e00b60355743947f4a49f9202bfbbc6299e",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "b1ad405b7cd85f07c01c1d4e3594062fc80701bb110b876f0b523c8699f41a5d",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "ce3f940c838a8944b3497720f29624ecc518e5674d79c6e8b83198d0a67c29a6",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "83f52a23b7ac25ef3b8d5d07422a3c8469aad7afbc3fca01d731e949981bb59a",
                "codex-resources/voice/lib/libz.1.dylib":
                    "f8ba03245898bdfb82b48a8fd68d1c1fe7749c443e8acfb2ec2468e25bf23c48",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "b5472819e75d7cbb4c26fb4c4f31816774ffe68d713fb5977afbe6c98dd5b597",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "dd70823e26305f886737bf68dfc6f92f519a40e21185ec53fac70050be61d939",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "5041462023bed5f2a99cd4ad33a100fcbdeb7180d5ce55451d081aa0e43e6d2e",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "3a70dff77e59c1ce62d4f4448649b858e4728a7c273dd81cefbfda3f13b583b2",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "80a5f7095012b2e369152f8f146c9058df56e015ab0a3af72b1bc8d2c06bf60f",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "442fa3d9ca726b604bd9f29d4314927f1d262d3c4e6f3ea0b90138582de668df",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "3e9dd81f543c8ed24431584be8eae7c816aed217f838f4080579d109a37e45ab",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "698e61784461957daf57267cd66e842bc1f67dae519519785b85e3440325a922",
                "codex-resources/voice/runtime.json":
                    "5fc40f3a890f4ffa17cccfea72e3483773730c400cf32be195d7b805cdb9693d",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "66fd9574dede6815614ef09ce8768f448f276ff3829e009fa5ff16e25423abb7",
            ],
            fingerprint:
                "888c03595317eb339c789e91f658a55046cbbf3688bb6b78f7c5e7f85c241c90"
        ),
        // Official rust-v0.157.1 arm64 archive sha256:6cda538d19c2f4d9dce965369aa22011afa9dce8c7a73c234b66eb3611ea4aab.
        Key(version: "0.157.1", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "27ceb5f9b957b43a519efe4eaa3816a0bffb0a531a2c89af18840c0a3c016a7d",
                "bin/codex-code-mode-host":
                    "80fdf166c3da068282d5692f67a852715a327ae7dc1913abb93b8c3d3030103f",
                "codex-package.json":
                    "f5d6a6aa5ee1543956149181716572b97a2125aa16d7aeb4c939ab65a9f9268d",
                "codex-path/rg":
                    "95af588695f6a8583e065072df7a6a3b491b3c53d1cef7a91bb936b76a421bc5",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "9500429e81499c3df28f6010074b89ee0afed4a114776927ba5d41a7e129a623",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "fb86327a19b16ac8c4c15109f95c116c90ea66fef1644e5cc55f7e31d1449321",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "8b85ce9c09c1972b8707e542c072e162fa1737a11f4e8e023551eb87f64f75bc",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "3498460291ba26f77ac7c3d54ade522d10183007ef49660a1430350e90255246",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "5def3f24358d693a033297628a64d51ecd44be9e922b85742f899f270c4f8741",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "8e52c0026252a6031b8483d49a3d7413ea4ba9e5de6fbc96b7732b753b1da0e5",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "92d4293984dc2940fbffa9ce22b4be57f61c45280afd3b4c63be548e30353611",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "092bc7be8ba2466d451f9e11fcbd91bc1dd27c48475d54c781fb0df83d687dae",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "0e73d1d3036eac7e7e70ebedde09f3ee0a2b6aa1038507d8ebeee38314bf603a",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "168bf1e96405fdd762048f064a48d70b9c65569f68a2aae180c7e60e774146ba",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "ba17de24d69272ef92a21a7d802a80fbf1873e6dd7a76d21437dc2b966fb43c4",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "318e53294094c9509c85840fd4b09d11dac8ce047ba89a2ba0feb6425c5c3038",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "efcdc49822a6d21eb62169df72962e5976165d869900f36849f4f97b1f231955",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "4f1c808cf63b46db6f1e1aaa684ab9cd307a6979c0d32f3378721c9d2b18ab45",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "5b0cdf16c869066db102dbb344e5e68275660849d299c85c8cc360642d589f00",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "61693a8ddb17e268f720b1734455bad1ad03c7ec7b35bd330e316dc0855398e8",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "c3376eec88f74e15acc4467913b69f019467cb1de6a50b77065e85d258a9fd9b",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "5fcf4caf127e8450234391d905590cb306ea4fab7cf16ba31a1cbdb7972d1e82",
                "codex-resources/voice/lib/libz.1.dylib":
                    "9860ae0cb60afea0cbbea0583716d5a4a029e3737d02b2e91c642aaa16c796fb",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "5df9a1d4feb55a8a2e3f81ec384a88a5da9c91f2b5049d1773c3f1e72d1ceec0",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "7f3bedb528857c36b945c0e05cb792926bba41e69e912678cb5185c63eecea03",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "0844e65b9cc12249cec449f83def9af7be754e82a64cba1561fb615938b57f59",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "e674da1af899ce945402e3c2dee6e998d1f18c03ba9955003c3422bac659f49f",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "9505e99aecda18254768c5ada81b1aeaf7e5158c42b7041ad7bd8b5489ec0ad2",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "2d88058a3d2e31c6b7f2faeaf59c0afdf5bef211ba48ccec3a2f86445b4beb3d",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "30386e71122abc91c7de19d0ea66024dceead22655a5a5260c53a5e1d962dd79",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "1a06b65cae3f4efc75c1757b1037bfe497fccff5962ceadb580a7d50ce6b4499",
                "codex-resources/voice/runtime.json":
                    "97efaae6e76df13350c8c698d4e0f48ff7d5050a91ac73ebb55753709c86dfd7",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "9a6310493bd28c2b5a2d3dba4d4043700de7fbfe5c25f053bad26427f328141e",
            ],
            fingerprint:
                "3b555cccb72141df5e2cd847dba0f97a2bf28fda54b7c4347a00a6ba1e96ab2a"
        ),
        // Official rust-v0.158.0 arm64 archive sha256:09f2a9fde318fbcd384f15b4850c1b90930678f4805647b6bded196ccf32f590.
        Key(version: "0.158.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "788a818fbb9596869c7a487554507cb8bdca17584b8671112b23f9e225ba35c8",
                "bin/codex-code-mode-host":
                    "d47e28a83f8b5c38f3dbf59f9590c580b3d95ae66102e3e180f0e0d6f050fc4c",
                "codex-package.json":
                    "95b3408a236c342f1208cee223ce64bca7a32de0462c3d36460267347db3fc14",
                "codex-path/rg":
                    "e04d453360b68749ce735f65e8dbbe70685a51f7b88288f617e610076cce3aac",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "a48994cd3316afd592eb5aa810b073483b20767cc2954c6b43d327189cd776ca",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "b162a2e8c23da94f5648fc97f51aa470b7cfe1134475313d151c1f3c1aded613",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "d5b5af2805fa5ebb7b5b344f28868cec5503fc3b2a99406cf8e2a160d3526296",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "e6a6c85dbd952707785b132aafd13b027f28835e566f5ca5222b19a2e25af5c4",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "f83954fe6b31719f02ccb06f5270735fa47110cc19f7e0f223cc7ddd74546641",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "9bc426de418be86e5f71abb69d6f598c1f274c16327eeb20a2cb2c093f4e9d08",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "31777b730a4472686fb2f00f6fbcfb756e536bb6b5af691be58a4d102297b06a",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "5ddf0d10562f5aa44a007bb176515cc75a3fa8344b45c4d21575508c51bbf501",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "1139f9174aa05983b67744a673e95aab0133b57299c86b0ff1bfef58992f8c7d",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "73ec57022ea43a6afdc9a1e5787c4e743d137f928def15b9fdfd083018e06048",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "e8656b707dbf7f4f8963f7a237009fb11421c048e6cfbd2a3214db6c8e603954",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "37def5103a879246dd74864bc9720cd24ea7ee04a3d3ab67c82716b789f6a222",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "49d1b8df8e93df0ad639747e4442ad5da6e056718ce1ecb39edce6820b325332",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "76ab4f580ff8104b9d00e8c0dcb0af4c95a4b1ffaf2b6740fbb5aba06ac192e2",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "87c9159d046ea4d362b0e212447f8128a0c0abb04b73a94f9c8523a435855c63",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "0b61809e6b1a35fc67ffcbe9403ed2075224ede71d7ba89d435fb4866c066d30",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "2532ea8fb8f4d628e782ca934cc0e48e24b9dc1c42464e654a92a0db6f9ef5b3",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "ceb5475c5baeccd19653a9ec37ad5f8b1937c34f923de33d9060b8ba6db1ec89",
                "codex-resources/voice/lib/libz.1.dylib":
                    "76ea3dafb19e705fbd88bf41c6c8018dbe0b127d63095b7329139216dbd78967",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "2557ae05d696f9247d01e7337a620d88daa76acf36a84beb5634ba4aa67c0ec5",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "9b61c18e1989bdec76fb760c7df872074411f32d192609e351799275918adb4a",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "c21328c1caea841ad023cb275cd02d4657faa12ab9fe692e1240f9f1fd59c733",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "d07948e8fd10b720359e2f883f8b5370c4b1d34d1a4f916b4cce4040c5ab72e6",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "e96a47f4e6e28ee976e475b9de4f438487f5f714aab9d4ae2790d494877cf5c0",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "ca0ac8d2b9341215e240b8559a743d21cd44156350bc87471003da2e259035c9",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "d1b30005bef6943620e683bd1af8966de24f201ea4a9be92cd2e9c2650e14e12",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "1fb2baacacfa1fa48d53aae9426cdb24ab6353f8d22456c2e5d1c592d5a44f53",
                "codex-resources/voice/runtime.json":
                    "57231eb32a9baef47593d8803d9baec051563f8c1c7f3127d88501f7c21baacd",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "49b8e90beef5b802e1808908c2b0fc73733d7308a2df13fe5fcbc5b2009c4d11",
            ],
            fingerprint:
                "c1d34a32761e1c6e6548c009a8af242ce91b60695e9a6f347db3ae61b87d490c"
        ),
        // Official rust-v0.159.0 arm64 archive sha256:7748d07d7921a67b91d015e9d0f43177c675977e67f955b2f8fb96dc880dd5d7.
        Key(version: "0.159.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "e89718aa1969bfc4a471277bdc4679a3a3529293de0a309909822dfd67ddb77a",
                "bin/codex-code-mode-host":
                    "c83b50d881ea5153fa9855cad6763fd7f847b24e60931b26513311fed3f71fbd",
                "codex-package.json":
                    "b51997f7485c06f1307c07c59afab83b0dd54d9536a063f9db15f8d24bc3c93e",
                "codex-path/rg":
                    "bec23e3dcb8c00f4d215983a7762ef66b0302abab8450b96b55bf380998926d4",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "32d2044ad58ff42ee566f018b98810528e5beddac393f2351f5cd3ba2c523747",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "b4cfed0cdbbb1c00db4e59da0caf5ccaf9315e4b9f7dbe253baf9ff244b040d8",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "2d7c4bac30dc92e788da22baa2cfa2e7fb882b8f813aa4852c2bb704e97ad36a",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "b21a31544a40ba80ec3288ce34cc732cc4d89fadc9367b81a1bbc5f34522a968",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "0eb9e92316e42ebf34ee73c1745014efd6265ff6cf0407108213fc81a7ea5e0a",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "9a9ffed1abfbd6020cfd49e6550a7a092fffc02bcbbfbe6107c820c0b49e4f5b",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "0dcf7df18b448d7197381f0cddaff6efff7281b5e30e9632b40cac406ad86afd",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "428c3bc8cc712539b557cb94170d969f978e044c9c35d8b329cdae63ff5b1d3a",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "ddfbf8826ae066293c14100a25e9aa43df07014a9185ae00b484ff7306382dc3",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "06840653d4dbf61fc60ceb2c7b23dc4a7abaa72e39014f3c2f29dff006dea3b7",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "04baede24afdffeb83c73ba5ff0403ec48736b55f36cb515935e31efaa57c9df",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "76b254f5c1345a3dceed61b6ae79ae226a33dc40419f27ccb2bda3b9f115f06b",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "415adb8bb9a23681bf91b2b48fc6cab6b5791c5e3a55fee13a78b7e0432eb6d6",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "6c2f519cdfcb06e8e3406d61ffa4c39121be2815d36f05be0d8519e8a7fee2ee",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "5e5952891a0b09d0e614817344cd5252e83012655b1654cac8cc348bbe75d3a5",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "2a2341d63ab559fdc2a525e2fea925335a7cbf28ee86486cbf1e5b8bd24e9811",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "d79993722d26df3d1c1f4cb8aa8757e5c0f5dfc378967ae6cd04691f60c6c7c0",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "06f0a75d38adacada6e2d1c6ec5cb94382d892001c2e9088fa7c4e7b29cc8541",
                "codex-resources/voice/lib/libz.1.dylib":
                    "ba7782fb4c1129dd02d5f9b18aebb29311ab65cd7235d88bde6bb7e78f96424f",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "e4d72edda31963185a677ab9e2f5049fe3f9d4dbe4b82d666e4d094111b881fb",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "ceed652451a0bafbb27a71e5899b0c397e22099efcc1a18377b75882b91691cd",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "dacd18aa737fd819224e7bf619800e5beb9712e25bb45c4d581145e46f6b5283",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "35d1a5977a3d32a45324f238967aea34341368d9b22ee80300c0e0efa26a8283",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "520cfe2cace17bade2d7eb93d2a714b775a3c79b4f7a5d10d913597df71d7a14",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "0ae7c4415f98edb7d03bf1117ca3104103698add3f69327810d99bd7a86f5790",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "e9f1bcc403e7ec89912f3957b2176fe5db064e443331e769cc56892787a7386d",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "34d5311f1ecd3676cbc37f895b3e3e0781a1b271b9393d9be03b492af38b82d0",
                "codex-resources/voice/runtime.json":
                    "1ebba99b736593eadef887f99b0213c50d29eb7a2fabac875961058cae2b8a16",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "f53612989533bfa013dd28338009638e2afd4bf10cd95dc2dd0c4857916059f1",
            ],
            fingerprint:
                "ee1402b1cd2d00c734557bb02422fe0c80518a978bee481e9313ea5faa5ca77c"
        ),
        // Official rust-v0.159.1 arm64 archive sha256:a8fc76ccb5230dd97fb6db01873fa9c12b5e1efdf32d13c2ba7f6e8489ccd893.
        Key(version: "0.159.1", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "ab2ed513b0ae735151799ab57045e05ca721c4730859b5aa2f2a9e9bed287eb8",
                "bin/codex-code-mode-host":
                    "b4b3a741c08ae62495ba8d0326c821ddf7001068518c7cf98fd8bc791d1d18e8",
                "codex-package.json":
                    "5afdd00bfd806714c993093d049caaaf635f928a3a56582542bfc8742c2c9226",
                "codex-path/rg":
                    "4391a1cd0fb441bcc8e301faecbc5f85b5c0d13fea1353146c15ad9c8cdf488c",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "c2fb0f56cf6ed4949c584fcc28b23388ceabdda31d7a566068cd8dc6d7f19605",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "2c5e505c6c876bacb5d607bd38dee4875fb47fd9366082535cf2595e5ea15588",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "6cea1f196e67e3dc8ae74c26429d4b457ae47650447cd0103883aedd14dd56d0",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "b5aa125a2ee79d97f6097d10074bd65520f7ef9ecf1602c1af22b6922e245c1b",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "475c985c35e17db7275619459b5df2cb80ccfcd7d93a46ae531e8b7803f1c726",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "7b852768ce31c6cfac966ca6fbd93557cc0e3a55afc37f00daf8fb592e5ce4e2",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "6b605ad93d2976b2ccb33200f8f44b14d11ce6421733d9d4c1e65baff5ae5d63",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "2898c0bf5daba2b4750d24339433055e789a487c691f276c1a0f53fdd1df9179",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "aa9e7045e5f39167e40beff620ba76c0c3e662bf5ceccba4a1f5010a1038fcb8",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "44b79706073a371156634141235b4339cdefc066df6ae8e787ac711ed4e8251b",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "f247978c920af1b7ff971aca57260876ca427214d3d0f4df2961185e820ccb56",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "af393a248ce44d237ac565035ae4f9fe0bb3ba1677f92fc0baa0f1e807d2ed8c",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "5a8f208d715cc3754df7cc9aedd7e1a0387b94eb25d8d9761c03e808a75948c8",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "7b7b39f28e10ab4de02f55b4b6dcedce0308550a0bb46c62e94cbf11cdbed59c",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "d92a172e960159020c2e3a6dac78232a28e8d2ce8cced83bf9a68ac3b460573a",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "1717d638f02ac3afe6710ccc84fd09a2383e21f28b96808ba8c53aab626b54bd",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "f0ef327b67f43507b0c416ab10e27c462084c98224be56a6d841b76080ee6af7",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "05592a8b901e2e5bd03ff37c6776f74c481804420ee411d1ba688f1fcf6ef448",
                "codex-resources/voice/lib/libz.1.dylib":
                    "b90bd607979e909c3390ebfda56d0a2a17eb340028407f304cb5a1810f84937b",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "b22e7331de4d67f9dc4fdaa63d553629ac7ca95cae6718701d6d22978a168708",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "874855524c99e6252b863aea00d97bf1dc6a9a175d35e14f14bc6115a2629e03",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "e4a78574f37daa0a9d57f937b157ac9a1d08cdda7a62f178e967c8401e996046",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "507ef4e92b42a94e5d3e6070da741754b79b6bb2d34a969e9e6b272796317058",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "684e2456ee59a5b3092d7b052ea2bb7588e0864b72477243fc298f73ae5e4649",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "1f7714af5b429eb12a7991488400eda818904649b2263c5b3b3df3bcc9c3d5c1",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "f00dcbb845a43c506ad10a05c0efad806ebcbf5e462d31c2392d8c5c4488161d",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "f800e9824016b5d77eaf89497271616d8e48359c57991ebe206d27da63da29c9",
                "codex-resources/voice/runtime.json":
                    "0592ae3cccc476ab6bb6762da4a5ebcf2aa389d204a8db0af31fd69af8be97fb",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "f00899559dca955eb96f27bfbce9143ca6b0c209c35dd6521f6b72dca00e7be3",
            ],
            fingerprint:
                "2daa378b3bbe94aeaf45c389d4ec68328b3793502689c2702cf9e6c4de0df4d2"
        ),
        // Official rust-v0.159.2 arm64 archive sha256:38aaf6dce63099fd10988948d03bbc6c0474253aef6961fcbe60f8d154b39101.
        Key(version: "0.159.2", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "16593cc2f422d5f398a8e40f550ebbaf1245392528957be342c295920a300704",
                "bin/codex-code-mode-host":
                    "ed79fbc9e1683feb29d73fb421f3e16932d178a459f63741754014c6c7ea6107",
                "codex-package.json":
                    "824178a0339491c83a5b74d045e7aa1874102dfb66552a9ab787ebbd5accbff1",
                "codex-path/rg":
                    "411373534230a3529230784c4290a1a2a99ffe7c7e00feab5fc400f5ffc6b518",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "65419b8a53356b32442220f8d549d5e088b219856ff9d1175e7efc9ff51b62c7",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "e8c7c3b4147e4ff7b1f0c573c24d3583e0b3def17c84a40aed9fcee462891c03",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "7eb05cd1971a96e081a2f0d29e8f17fa5d53c38c14e1cf1bdd09484c5ff102d8",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "5348603ca471efde3b3e5521e9f62789c9bf5a282b42c4f287644b936eb69d17",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "52cb0ebf461e33473cd3d797a4b0cda145d3c429556266d853078dacf18b575e",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "31da67b38db38aa32037ac0d0909757c05e865abca66dc276d7331edd3769917",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "5c83c0f5bf61c381a8a88524e5afd5d78b4593a0c751fff7471bd3acf4e3779a",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "2c1967e49b54334fa6c395983d4c7235f52a84d92bc2c3a57ae869ec6a05d81d",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "486c660daa7e891325d738d09cb68c82190ccd7f498edd1de792de44b15dec01",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "a240560e2a05ae05951937bcaf37011f9931b014c372bba0adac4c25d15e5d7f",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "690f3630cf5461ce3821704092d0b7d2834ae93c518f894d3ce0a5505f895d5b",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "b7f5b59b794f106fd29355abe9706e7e7b2c396901fb26af9fecd3eace46bcd9",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "f6f9ba2d4ad08d33dcd028d4f7cb53a8b249d4ac065a3c23daa39368162fafa7",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "a071e2f24ced71ed3f03161343bab1bc592555d7dabc1270a503d547fdf208f3",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "529cd41f7aaf7232a19874e422c53c35120abc72c0b841da7c3b81ec1a8cb1c9",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "9ddee26312301b9c901458877a8f0da35137bf84768eb44fa05df68c3cd6e77e",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "90cedd1ad93caa063673d48edbdadfc6787f264b385a6b163ae9afa9c57acf48",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "904129be3b70d6712a37225c0bc30d1dbe9c56580e58fa8d490a7bf9fca7f5e3",
                "codex-resources/voice/lib/libz.1.dylib":
                    "631a1aa1f535f95223227874a5a024843c53ffae9a5346ad911bef5fa6500220",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "e7b170a2be9f55d411c6ef3ec7c59c216a2477c9808d77c7b9bf6f9e666e5ae4",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "a6e2c99ac5589aaa9f8e05f27c3907dc1a82b1a5d7a722895fd25607dcfd6460",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "81f6d43debffa690e1df447e29878a0fdf0bf36dc5a19e287a438bff8f270929",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "b9142f9a05a2c1eea678dfc33748675cfaf1ab990b1c8fe0a853846c0fa8507f",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "7bec8ee0f3af95dce6e151c445e5da83c81a4fdf675f7d164900a4c92c692370",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "f02be252c08ef71dd362086c9010b98b7bf6b1dde78101747ff08e1f1067bc90",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "3df9d1b30d350f671bbee5d18a86e12b2b7759864d9887d74c052b9972154818",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "a70edb6d089c8a3a5f4f79e73e8ab8955f70c104964666552e9244e8da6bab2e",
                "codex-resources/voice/runtime.json":
                    "406a41bd010e667af1434c7f0609919bb4f5f0e3e150f6f84061642f1d923efa",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "3603aed8b9be695f2b26d931bda1036a08f3207d3fccdb6010202499ed560ec4",
            ],
            fingerprint:
                "5ceec30c6abdef67db6df3faca91915574fccb89f6569e37afecb33289a1a05d"
        ),
        // Official rust-v0.159.3 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:fad57a5681cabcef21d322af5aec938975cfb711b5f25d4ce4907e6561616d07.
        Key(version: "0.159.3", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "4d210f7c5a18fd0386434df23b5bdbb8c0e7257d3e8a2b30b0769c8bbe99a878",
                "bin/codex-code-mode-host":
                    "9a4f2a846c9f509ca2a9f68ace6f0df2f73c7ed21835e8b186ee52bfccdfa8f3",
                "codex-package.json":
                    "8660ce5bb4e302c2739c7ddcc9974a45fa8d568d123b9066c9135d6dba0ac121",
                "codex-path/rg":
                    "e7255c478a1363dd4bd79af76d3caa66a5ff3cd208aa5226497274e83c204f86",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "ad94f82d589afe73f094067214ccdc6dee5510b2a391832be4595a712abec0e1",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "1b2e82eaa025016aff1c43338bc843595e64f72888a7366b27e8f46675dd46ee",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "5506ccab45c84ecb88516b0adb12055e70f9a1b0cfcbb7fb0c1710ff5fed6c8b",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "e306dfaf579998acec889f1c9abb7f701d0f1b94f1fa50182afb58c2bb6eb58a",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "799abcbad7034d4f593c4049f0bc6968341c271c79e88b7e0f68ad56b279d229",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "cba0a4e3538180fb1f409d7533633c5af62ac17a95e2a015d31bf78bb1504531",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "9337b1396ad4e6c6492c6f9aa9a041dbddb406f09b67307b8c59c11ce5d0fb63",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "d53aeb7be607fa715dc600851f4d117f7ef18615e852148b2fa9730e1baa5ba8",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "27a1713f9b08fcacd0922f0a059582ec1f7f4d5b054f4d2b447ce95f1da12e11",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "402845ab2fc6c411eb1bf126660f60985adac9853b72d77e8011fcd7176d22a5",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "7ecac2437f46e1f02cbde7bc1ff764ff545e19f82a7b053635ec0d74003162c7",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "54ab3667de423b9b02bd61865ea9f175b794429ea738d980d2defcf87b80dec0",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "7c46fa3ef24914b7356839021b1a6eb3fb6f36fbec84d7568ac0eaec9eb6b9b5",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "41b7a5059df67fa2c85989756b4bfc71106bdbeae102aa5244f9986633d1d32f",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "9274a5bddfafc705dcccca197f22f4088f4cc61ac9c20d0de1876a506b67e123",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "6560c440795a52413aecd60b6646312da5787d688acbed9d9fa2d0a6423bd1d2",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "4c5a3840d400b4df9e229b65946cdf2c1f3737c9a2867979137211bae117be52",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "8db37cf1760ee4223a9d5d6fa87b5391fb32b67fce1afcd1bee5cbf39111efe9",
                "codex-resources/voice/lib/libz.1.dylib":
                    "5663a064119000058a63e3e1f23776c59400e658cca56fe2f045432b1b354c6f",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "87b73c89b6a229a66ee72e462706123066117393c0ab14ab2c07d3433c94d7e5",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "5e6ff49d383fcbb5a11db9d12d2548c7e69b93fa22ea5f041580859d128601b0",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "b233573987930b34882f50afd1d398230d2d2bb4f8c91edfedf0285bfd4faff2",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "2aaf72c1f64d6cc84faa1ad5821a76b6a2fe1e7e1cf8196cc27e2aa616c4494a",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "8943ec133f7f1599ac7a3f28f297984c7650caef68b8a54dfbfabdde728a13ca",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "9b4425aaee5488bac6f12f3c1e8cebb41d873641bd85677d04dd8efa64032316",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "ac8d4e6b53fb4eb9f28e160d3af1893fe81ee5cc8ca893d7786ebc17608d1f5b",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "7c56484083fc88bd8984708ede9e6c28216efdb14126b6b784d6b007ed8d89a4",
                "codex-resources/voice/runtime.json":
                    "60a388b1b9404d65f49eb45b757dd9ceedc4c9f1a1848063678dbc4069baf196",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "ab5c301dc25caec1c94fa8472046c3a7d67d195e5cead0f3223161dbbbc9b88a",
            ],
            fingerprint:
                "6decf4a44bcdc6affc04398edcfc778605d3264dea29f4f387a06fb2b7b0b4f2"
        ),
        // Official rust-v0.160.0 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:007df41b607dbbc8d204b9746ce7fed2d4ce6c813f44c32ceee54175ca796525.
        Key(version: "0.160.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "112fae7a5a1223e673c8a1791d32338f37df8b527ff1159bb8adac6c4dbf1b4b",
                "bin/codex-code-mode-host":
                    "679eedaea70529aa1cffc9bc0a0788c186412663544fa76c09d63b57f383a65a",
                "codex-package.json":
                    "404c4c935bf9b7a57fc02b6f0d09ba6b7bbbf15cf14286fc017de2a6c01cab47",
                "codex-path/rg":
                    "7c7d5b09c3a57de864500c65dc2e9c4d2a5e96a3fc7b7d5318480c19887a739b",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "e408413b79d76e518966046ce1d7758523c606844269fe4dd56446bed80c1062",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "3dfe23b471423eb61bf38785c21ddb7054c5be1f87f87fbed7aa8a8c91e3bde0",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "b0c1b06de1deef21fde623c38a604cf413b1d607dda85644e296fb6d97067c39",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "65a0785497ed134d79284c08118d8bba560f7f60e20682debe4ee12e848a5f8c",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "3b4b70cdd569c088c28d6618b330d1acdc0fe456cf34267525c594f89e5dae84",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "ae78667a1a328528169ade0b18aa4ef547ce6b5f70db891781db8dab95ac46a1",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "04d8b371136a375f1efe0af61d18a7605a8556b80599b2cfa0c91a5a235a43e4",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "3fa362d9b53ef65993108a7fdc88471086e95012f5de4cb35ab37991490cfb60",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "437beaf6d2f2b1204a58d987d0698fd8c1c796a6c341f25c8a7a797b0e045540",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "5173345f4b6ab9fa75ca731c8fe94ae187d6ac395eb213844312a04218924e3e",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "e3f9bb0e56280e1572267f2cf482cd26b5341cecae4cc279e2d1dd2b6d80920c",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "0e6826b74f874848e8a0e37fdcb7f5061abc711edfb802587771c5dc1c399f1b",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "fd50798327e0f20605c02ff133a3ca4583ebb8cf13f082205360da8b07389209",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "3b40bd0003b56507d701d3c4111ee5b8c58be3a2dcaf6da9e0a30498611222bc",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "ae8adbb687f26decf3c685265e595f1649769e49202e38b6854f1debdc06d363",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "d9ee5a31754b382365628fad50df33b6111ad84e133d6f141e73822611c9f727",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "c51f552406b80e7026659f77902488eea4ddad101af84f244cfe4912e90bccb2",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "ce76aa5a13b32e8d8d8ddfd723f519e025e028b53250f3e11a90df39ec473e53",
                "codex-resources/voice/lib/libz.1.dylib":
                    "d80d2b42ec19b265c361d5bba2070c29c38a6ef389ffecd87822e248fc700993",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "dcf75f68cd3d1e94e557f80998dd1a707283dc2a9799c9c14c5d46aa6e158909",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "86a4f96e8ecc4802777eec36391105226976dce1a80ce68e561989aa83314e9d",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "4c85c9ea1568cf778f8f1365979cc8383376bb2a4630768de24eb66a1b254c52",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "757a61f900ed50c0a51ec9928c4ca0b27798ff6b0a3a235329d240faedd438c1",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "a2e96bac9f9a88712a94320d9017077346f212e77c4fc4b20f02f23c3ee6ff49",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "42eac3b57ef0ec6de84c9aed32453b07482294738345062f4699ec9e0454c867",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "591b36944f84d8740b2813ff7bee74b15fdd364b5ac3351bd40c91a498d7f54b",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "5109cff21697ce04c93ea822577aac3bcb0fb659a53ea32f332f10ca44c0496e",
                "codex-resources/voice/runtime.json":
                    "2a2e60d93e82a335039dc5a08a26963ca853f2238e927c2498d76dc2466f7d74",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "d715e06edcf1661edb2e7767d65fbd1b44af505edfb217281b701f0a6ae93b15",
            ],
            fingerprint:
                "4f6a4a3db956806862596c026345284181337cf60e3168ce549cf864f1c596bf"
        ),
        // Official rust-v0.160.1 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:f73527ee09c6db869acbb37b709866b339ea74ef91d2de255e9c74ec960c6314.
        Key(version: "0.160.1", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "09fa44fdc37a5fc70dc1ace31235f90468a2e193d0e85f7552eab068ea2582be",
                "bin/codex-code-mode-host":
                    "6ac432b170e2c30f90de5af0da584def5201497a0d3d988d37dc58b951236b2f",
                "codex-package.json":
                    "ad2608c17f5098f66ce104c915ac56bbb5f59b034eb8bd9ff4759e2ceabf3413",
                "codex-path/rg":
                    "21c0dc01dea8097868918fdded08e0986a2396a2992fbadcb3091f02864d7810",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "e3d7569b9b4072b2b297bf10e6df76d18393f1f9077c29a6f6c0cb190f00f00c",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "d1cd73e16711151960c054d0728aaf2bf5ff2f87468ba8225bcd08b7b5e93c4a",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "6b6c44e4be2141c7dad16bd1d6ff914cc81fa02cc0894fcdd9fef97dbd0d0ed5",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "ac352e21b67d5917be3f1f02823afc9000c99a0db0afb41b33c25835130783cb",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "30dcb8c1f94e348b5500ebbd10a5ad289886dcdb665ea70496a3ca85a886d308",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "4623649f0091521f5f5585b3a38763f30bfdd96abae50a6935b7601c97be9ae2",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "e3d3c1035ad64f7d3438ba0cafc979ee9bae4021cdcd3fae7580954823a1dabb",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "d63456e5328532986643e762337dd4de1920ab4cce3e6cc8811c68da94913e9d",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "fe9fcb4477b5ef61cbb391b0fc35f5746bfef1157033a7ec70244401f4cca311",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "ce787799e2c446e76b2a1ad51dfe4eaee5cbca98dcb2339c5a8eee9bd3976eee",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "f16ff6a4cbe2fd9ade54dac15a01ad44112dd7803e16a738b8a30d4fa130a609",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "20717b2167aa26a402f68e46bac17735d97f4f76e1d9ffdc50675553f395a14c",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "63b42f98d24eafeedc237a2f319ba0dce9652f8b45c3ced2370c973ca56c5dc0",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "7537168f14723da523b80b98306668ac0d8aa1d10a7e99a28d2f423970b5b39a",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "cac9c0a7b931c77d3537b37ee47f38c1614aa938c090d4f43ebb689f283c547e",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "d895a295cbc702555465505965ce59019c9cc6376351cee626ce9b9d13fa75f0",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "b4fc8b1f741aa0ecc042231eeeeb9d01bbef5ed26a1031f8f2ce2cb724f5532a",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "dc912aa13ef18c3f03f2595df2d8484f84136d05380e9c2225db91f8abff9fee",
                "codex-resources/voice/lib/libz.1.dylib":
                    "ef3415ed52e111573b84e422830469f42c5a4948985838841bf58638d0448a0e",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "eed5b95ee90bab2269d83d691c4e6a7813ee097928269ca44f0b208bf4513faf",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "bac84316717b36f63e0d765390311123a965cad27f001b5eb8a66d417cfca94d",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "376303f12b63c1e51a5687ba3a981facd3888725ce55728a1724940d8ec3b17f",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "01fed09b76cf9cff10e9cf97588d06d5470ed406af80de66e182e64bb9bc9e85",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "9251149870658a49c1d39d600d7d6fecb0e5a1ce56b7500a9d2ec33658d4f544",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "53473164999f20b5a3f3a114ff00b5b36ca28c338c38a155f50a8feb8795bf02",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "a191d01bd49fe2a25f5b1e31c40044f1926f9db43c06c0e4e1e7e1d2013d0e6a",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "5a0fe1904800aec435c8e13a6b08a88b943bccb2d61172daa6ff293d5ec1331b",
                "codex-resources/voice/runtime.json":
                    "04e457013a73f9e9eb230c0e2a992c39c35252b76f93b481aa1fa07270105e45",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "0eea87aedef0ac13b140a41fc4e6c489bfc1ffee021b1e654a0c3b05b3c6525a",
            ],
            fingerprint:
                "0230997d8fc2c3950e2fe28f07548942b4662666958dd5079eb581922c35f8ee"
        ),
        // Official rust-v0.161.0 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:f0feee8537daf8dd6b4e0a36e764549ad14afdbb419d8775aeab9feb20182313.
        Key(version: "0.161.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "12ac11d2c7eee27cfae34393986d7b7c9ed0dea537cb749831cdd7033893e6de",
                "bin/codex-code-mode-host":
                    "35f1c633130f7b214fc568b6f643f6831aac0c6f25e3cf78287ebadb7820ddf9",
                "codex-package.json":
                    "b4eb71a8f3ddb1485eed344700b1b51a187bb6308aa64df9081823ba1d0fae80",
                "codex-path/rg":
                    "e2844a54c470c06c1f6e96b16f13beafbb03244854657aabf86726bba30df888",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "32cd9f1152c5d5618c169de5f5007fe1d61e1f53e050ab66f3b3e95fa12e0455",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "9a11e553da73688d2a8516a3c4b1b954f0e8bfd34f6f52745664b88302f178c6",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "4e083d981aa3845f875df13b83b41610b7bbaca00f7bea2cfa85c33a00621933",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "35739aa95580df312d85dbf1a6466e74431012484dcd1643fb2b74da0bb96b8f",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "3352fb2928e6384ab2eabe783bcaa7e4f027a27492123cbd85663bac0c520f3c",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "799a07ab83d0db3018ece243c63643004855c187ca3b693e3f43bd7f1de30267",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "0e40934d28ee00f46d2a2f6742c1ac802bec8248fa478af8eabd65c770e0ca89",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "f81e62de5209ee8fbdb72633a8ceccdcd34e784d3a175df400fe048951161b7c",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "6ef1f6a9a5dc7de40d1819a0b7341763fea417a543b0667f8bd22127ae449398",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "71a3c81bc9f8a7b4fbbf2346b0642c5ed84ac301b4dc4f8a82cea2f6b80aa3a3",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "c75734b4ea2ba75ca059d9055c80d6951fb7dd9753fe9695505bc8d206df7737",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "b3ddee6302979607729f97aec158aee920afa3b3fbeea7ba5cf868739d5c8ca6",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "04a5de8ae4cdd652cb175dc2900f0e77eb8a6335b0424df443985812332f32a3",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "90fea3efdd95ba2ee0dd2657e31a241a9d5a27c032d0df8c2db87c9095e127c8",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "4a936a59d2ba5112b9f3a75e5af5ac719bce8408b5bd8a01d4c29a47dfc9174b",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "6810e9da5bd70463919bc85a988f88561a476d13f81c16d7091180f2744eedb3",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "31ae91d185618b9afd01fc8502c16524a9cf2ea95384861f40c58bf629ba04e5",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "eb07e392d4f5f28cdc226a3c4b7a397b1e547b5998bc122b21eb32aa78d87e9b",
                "codex-resources/voice/lib/libz.1.dylib":
                    "016332d7aa951804e714ae33753a3d1604324aa9e302c23958f2fc5039db4a39",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "167d13fff0efc8f733f35ca23ad67be88f18f2bb308d81a09e1ffdee5bbcb4e6",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "1027407691da551ca4d65dc6319bab1064d353379c28623927e63dcdf856657d",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "f28bd23a779914d22bd58a895db69e1778a6578807ac4079e5feedb7ed33103a",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "19b68d6874b76453f749d15a65427b7651138bce9e2eac8a2943feb84a929352",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "a97ad3f435ed5e996d2a94fe29e073b50f2a67c056a0c6576a2413479f7b5eb6",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "691a4939d44a488e696934be98055d807343c7072a6250a4053e77e8154a77e3",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "a5fe4e4860b5a7eb0fdf223818dd9d50dd6e5fdfe586c393b6f23c11581ef1de",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "4e901cc63c5c7098c6ad1abd9809f3ee8a233d7a225150e2134933da6bfec6a2",
                "codex-resources/voice/runtime.json":
                    "5f14e9fc920f87b8a224d8d8781e3cf5d8881f8bc691dc36c7db3eafa0f1de51",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "62de130e3913026fa3a0c65d70d905396c83c89543a79f0b9f35da4e83e65d18",
            ],
            fingerprint:
                "26d0cccbb01790e6646f836c0c53afb73e6081626d254984b280a41c06d04652"
        ),
        // Official rust-v0.162.0 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:5809ee90a9c3b59d438bb2663aefa0b43d86f825438b65d4504b31f82343628b.
        Key(version: "0.162.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "8238273076041e55beded03ba1d51e034f997b7d100b0642d36daf036620fe57",
                "bin/codex-code-mode-host":
                    "0b74f513cd960f32e60836f39c574761e6fd1500e608135f3f34347acc3e0e6a",
                "codex-package.json":
                    "68011d7a57614e514c4ab37a21e05037914d3ab2ae1c6a7c25389362a947fc0e",
                "codex-path/rg":
                    "4259cec27866c48bf1c0fc1ae7281e25328ecc94eaf7f139b0584bb80a8e3511",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "e3652f4ec9d5e5ec24ede4b1ec75d5e6b2247c6f8d59a01d1ea764525b362fe5",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "1d33dbe1a6a06e2db12b8bb79b48d87190460875ff608879b82e133752a272af",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "7a5684c96e5720f96687eef12744055e707ac07a8f8b6b978d759b036ec341e1",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "d5a0b84348ed97b8724e2ad28db9c5c3319e2a1f98bda8e33b7b53b4e9c94af8",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "c49e51ca7bdb6d2ff949652da6e087859710270caa6fbb6eebb17b2bb21928b3",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "28a37aac1f2d2775ddfda9f73c6025381964c5d421279807133e45e2e8529fe3",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "6932a5f21aed55489b3f7f023c331202b77b4102577a33d09611d81fc5c370ec",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "2360c48575ecd520d7830fe40c38f4c61723d8dbb63a503684fda44af48af868",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "ea10c765484e085a76b07391b1eb21877ec9c3bdcdbbd37d6932571750d0cac2",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "e8aa63901b8cd93dfd40892c1436e15c9a0890258d41c4278fba546e327477b7",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "eb7b1c41be3a44da36b544264dc78ff259a266aa71b3544917a632988981aa9f",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "221cc45aabe0f452d4aecc61598916cc919478eb0de5e75010b46b7772f373a5",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "06d91fc6e2259224adb9151e0a1b425784d041905a5990e23f9a002f8fbf7a91",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "4c1ecacb32028c387efbcf5ce158e0b20679ccebdaec2b199c57b71853370fe1",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "31808eed7046410c26ed4e0807f1531ea12a0741a5daa99a666683f02f22557e",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "dfa29809041aec5e5f7493ca33cbe6643a4473b4e3f38d3905a073337e969b9b",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "fc3df274266823c43939606c0e44e6cdf4061dfdd88e3bf89b36035d74d5454b",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "53b70f6a87753730e7348592e0c559dcfff45053c7bea54f91ce11d680c931c0",
                "codex-resources/voice/lib/libz.1.dylib":
                    "e60be067b0f797a92531abb4dce9eed13e46f03d244304e52ee54d1e8c24f0c2",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "e6f52edc82da4df9035cbaf0da323cb8d9e634a2a8e92ff5eb4df41293c22410",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "8a7a2c79cb4eed9533cbcb8fd7c7f6763bfd37201bdb0dfadf91438801f177ed",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "bade8026b30fe60a0dc1ac264149c0b7c6568a202b6b5ff62cf5054b0c83391a",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "f85220e1aebe780738ee456ff7f83b5ccdd4ca2e69c2b53f056d7a36eae83925",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "b61a522cdefcd843dd9c2ab9891a9e5985b5c2eaa7af4a9ab719214711806a2c",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "ae9ac83d01524ac334179e36995cfed59af6aaf8ad69dbcef1040599e1f7ac1d",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "5dc4bda2147ae3c38ec77fee2ff738600846ad1628ac2f21b27a4a8573fecb38",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "eebb908256315e8ff056febb4b149809f9d3bb50f67bc1bbd535f3e372c2474b",
                "codex-resources/voice/runtime.json":
                    "9eeac1b48d1745b9f12422f2a8ea53bc68ddbf9e152e152b58c7e4940232cd7d",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "a93eb9bf040ee40a012c53e48ff3d5fdc3ed9cfe06aeb2733285f32681df8014",
            ],
            fingerprint:
                "5b0eedbe2ec32aa0e61e6ed4956b0a1c42db696613bdf004c55d3050581f4993"
        ),
        // Official rust-v0.162.1 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:88e37ccddf5a0f4ea9dc1be13c66a2a94f9c2d1a04f3ace9053d71b3939e885d.
        Key(version: "0.162.1", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0",
                "bin/codex-code-mode-host":
                    "0960435a104cf926e18bb938b8f6f8fcdf7e27be0c8d88e1911bc22a1de7d3e6",
                "codex-package.json":
                    "d932d8aed7d2cd6aee5dedccad6c30ddfa8ca10bce945f19c5780ab21291eb29",
                "codex-path/rg":
                    "cdd3c7bcc328730ac6bfbc04d19c0cfa1d23c1a3a838a8dc45ea7d84fda11b15",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "6eb49dab10fc05f194c00756983322cec2ea8616167e1ba211fd7644eccdbea0",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "b1ff1b3991077b5ef07b48086a606b6721b389bd6d80a7e9fc272ff6e0a2a6b2",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "52961a6a07771ab291c935681c11271e4ddcaa91c6e6b8844a269dee9fbf8471",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "22dd7861eafb255f2e3c9df68c135b814ff7cc7e2df62c43eca4057a8566af38",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "04c54d4ed33a9c6da84f0fbf4eed886c7831bace1072292ef1a6d1d92ca2a212",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "7fe9dcb3d46a895d9603a9649d1869a7ccbcb22e1146cb388cad23ff7a959131",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "60d292a0244fdcdc151697a588aff85ce2c694fbffbeba4064d33ec3d528098a",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "001d3e530bfedd96525c8f17316bc9f1a5404b90bde624ffce715dad2dc331ec",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "c3daea12ac920f150a2dff1ec04fe5df5b62afcb91c26fd19e35298ec6422d22",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "3a4d0a4548a855da4a3177452bdb6aa241dbff6c897f70bdf4899b18076dbe4f",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "7ea144e47caa6a86a985caf52e9e22d534af83ff78cc1c96169f47362deca2db",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "dacb18af857dad90289996d081daf6d5e2cb620849c1e3a67736442ef2185ed5",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "2730a668bd74836f4ad41db905cc3cf8dccc4640694c499106fa4588aa20959e",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "9ce4b251fa369a31f66699ca5c81f3f9d96b1fec6caa70b7ce2ef65d14396cef",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "8cb30bf7e78aba49349651b30ec69481c74515e89841ece32b8197673d273836",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "5830221d765ec70c4665d12f6793577ffa195dcf2d48ac817bab467c9b96196d",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "ff22818e6e37234273ea66b1b1c05b0264af69155f47aba4b8a3410317ef4726",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "4fadca0cf338adca06f7dc5740d62d923d09f995b9b642b79a48acc6e6969b25",
                "codex-resources/voice/lib/libz.1.dylib":
                    "3d66fd4454918261655f939812ccbc6577b39d6a45663906a61164f2fb770359",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "0cb5bbc51080939d07e78ee373185f61a82067877e0186bea236a07cbc862893",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "955b942b351fd80766b6324500b1e27e8c95040ba9fc62e505041758df39dac0",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "04984ebf169f844da1eab0a3708cfc9402217c27702baf710fad9caa28f389f6",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "e9dd49f4a7384ce41111ddb911650e9726c7cbcd9729073e1f8cfc0ffc7f9688",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "679206e939d10cc75dc4b007af4c4617fa286150ea4a61e3a37fa56ab981617a",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "28e7fe4a1e4396b142d87472a4ed4478c79fa7ff8c70c3500c51f0a39c74d183",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "b1f641047adaeb4c84c22fc29239b79b9588273ceecf8f887e3202247e14726d",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "470b47cbb797dd57672565158e2ec90d92afe6a112cb4a2ee71042a86d8a2ed6",
                "codex-resources/voice/runtime.json":
                    "e7bcd873e4bcaf6c4f0410c55485157d3d557a76b0d0ab5fd41cca0aadff1bbb",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
                "codex-resources/zsh/bin/zsh":
                    "78baefdeac8715fe8a99b60d112f45daa2feaeb5068cd7b116c75300f1402d50",
            ],
            fingerprint:
                "37d07b6af6cd84ff0953704fcd1b8c933b79c360a94d4ceeef5eb07ef77c6961"
        ),
        // Official rust-v0.163.0 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:b0344fc2e41f15e0071147e5869008047b8ff4bf2c4a8897975d3bae3f103b34.
        // This 41-file package no longer bundles patched zsh.
        Key(version: "0.163.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "8813367285524ac798dd96d1b071aea30d58708c7226fd236cd275cf1cfdee31",
                "bin/codex-code-mode-host":
                    "79f123a85dbc61e8f5d0f0c050dfc3f4b81a8305d33a32b41e008b7f6e035698",
                "codex-package.json":
                    "f64449f0d5760647c5fc5eb16de7794f47746465198da76061261374c0333c9d",
                "codex-path/rg":
                    "27d09e29c478fddbfc750a2cb5fd06965bad0ea223e776f8667160a0de63c6e4",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "5df9baeb50cef23fcd451a6682469f28318ff4a18422da22a6c8d0aa1b2711b0",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "7579e686549301db61c75a499a8069778e338ccadc3fd36859d2add955f86499",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "907cecd67b7fa0c117d768c0e36177fa2cf3b6db2e9d5b5b82af11e01be2aa2b",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "45c5d63922608712e8a2e757d02a84584e2642e2b8441a46747c3121dcbb733e",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "3a18360b8728a030489e65c08e7761da5d030ca68e85e54b405139103abf913f",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "83151e325aaca0fc3d5e04d136028e8a7bfc7fd94450a0902c5901c984ab4a0f",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "0146f4085fcfe4fd9dfb0c69fb671845acdeea127747ffe71184df160718ef59",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "f4d177276e786386b264f897380f5a2d31fa2807be1df8115e659ccf5043274f",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "da1541a7bd5edd7b10d6483cb9355d36120ceacb631122e3f4fb2a3db4ca605f",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "f96e5e46e8a9feae9aaaa207cdc4119d0bfa37bcb763fd521ce2b25aa262fd02",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "79b0d9deab6cfdafb09cdd6fa43f51d9d6c2ea2d6001a4554b4607059ce67d10",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "ac42a918c04a450a4732b8eb1b58bc38d7803f81e542e36207e13904bf9dcbce",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "a590fee375095ae878c22ea91005340a748af4796dcefec8ed41264a33cf1d0a",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "65993b372ecbd1a2aba1d781944355bc714d2c1ef829d9c1c3cb4fe4b8912596",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "19fed42d520129f7923801b549432e087bf7110317ac9ba5bcdf75008b4900a0",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "d160fc65c4e9aef8dc47dfff61286e686d1a46a23ebc2d60c2c63de46ab9701b",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "23aa0b26edad2cae87a3b4c574b3077f2da9395b2b5c54d34afd9439666ae1bc",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "a8eb9aeae3de4061bd55fff97b58285d687023eebdc91c93ac043b7787eaaa33",
                "codex-resources/voice/lib/libz.1.dylib":
                    "720fb0e310ba1537606f731e19886551794b82e1c88d913a66f7363157681d85",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "cbfe09b320c15173f9ce69f19d698ee8ffbd79f10b1f4b528e721f51f5400bd0",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "5759f0bc9718facb06e37dd1e9ce39ecf4f8d940e263a135f938c120d0d4e380",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "32243ec25c851e9430ed0ad0b6cb3e73331049e59172faa089f20b8370b558bc",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "0b7fd8a74a8ebaa9ab3f88d5af7b82fea92e4b15aa9da06eb9f064d12866cecf",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "69afac4e6a3c074da7a1526c157349d55e83edcce3367379734bd7785607e7e1",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "214778f96cc4f515a93f26b71587163ca5d9f6a9486613babda40ba461bd1438",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "0ffe1df81e5d42106c1bb091566778f68b44376097723cd4fafc6e0e8cefe0c2",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "b0bfb34da72a0fb6cef388b8b7c8570572dca5502a96097c92f89f57fd25584c",
                "codex-resources/voice/runtime.json":
                    "ff2f7b67a9c4d769970c6a4c433fb7deccdc03c3734f11291d91f73c3fb508d8",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
            ],
            fingerprint:
                "8455dbc0e6ca06359af0b7bf675767273c063ed92fa7a881380efc34771836b8"
        ),
        // Official rust-v0.164.0 codex-package-aarch64-apple-darwin.tar.gz
        // sha256:dd99e9092270691a67bdde7be04ac283dea9da8e86cbde356c2cc851a79205fa.
        // Reviewed 41-file package; see CODEX_0164_QUALIFICATION.md.
        Key(version: "0.164.0", target: "aarch64-apple-darwin"): Record(
            signingTeamIdentifier: "2DC432GLL2",
            fileDigests: [
                "bin/codex":
                    "d8990e3ee7acfbc26f91265b12a1a83f0fee40d0e0f8f1f40a37d4ec21f499cf",
                "bin/codex-code-mode-host":
                    "416721e33af8822041dc650793512b3e58d43e0be4f3a5c6187eb4dfaad3148a",
                "codex-package.json":
                    "c77eb3abe21da837655153670c53ccbb89c26995ba3ccad2b72204b4670e1ad8",
                "codex-path/rg":
                    "fd819df955fce19b2ee89c89c94e19a16127481de1ab0e5099add82cdfdc96a0",
                "codex-resources/voice/NOTICE.md":
                    "40097a1799441051aa0b6645cdc819cceb19be73cdd265eb602aa2b15e0b1f48",
                "codex-resources/voice/bin/codex-voice-host":
                    "ecfcf05fe021c5ad2e1c1e3975cf884eecbb90ad1a32e25fa7f216d6f178e437",
                "codex-resources/voice/lib/libffi.8.dylib":
                    "76a199d09fc77a42b59317185f1e42b1ec0f5f288e8ff367d68a893318d5f036",
                "codex-resources/voice/lib/libgio-2.0.0.dylib":
                    "e48f50ccb00d78ec1f8b422e0fff69ec1751ed34a147662a70bd638ed617fb1a",
                "codex-resources/voice/lib/libglib-2.0.0.dylib":
                    "47d1519d17e11f220d79d29a4926008433286a98ef92c6503902917d370f3bbd",
                "codex-resources/voice/lib/libgmodule-2.0.0.dylib":
                    "7b63fe175daa2aaafe131cae60851c5a8c71b209617ced0d2d4f273b73c8860b",
                "codex-resources/voice/lib/libgobject-2.0.0.dylib":
                    "444d41be63bb6593914ad2e73a127cc4dc8ad4907bd5c1c5e6e9657a02b4ed38",
                "codex-resources/voice/lib/libgstapp-1.0.0.dylib":
                    "1fb42be568a30d07d4f54cbfdb9f64b3b906b68f5e7e536edd159ad7a1ed2541",
                "codex-resources/voice/lib/libgstaudio-1.0.0.dylib":
                    "d4a48c604ac793f6dbc3afdc68c61d1c1144b9c35720f440669cc7be39758792",
                "codex-resources/voice/lib/libgstbase-1.0.0.dylib":
                    "50715fac0c1ee1168a58b8191867977001831a8cd1b2ffc4d40064e92d7ec357",
                "codex-resources/voice/lib/libgstnet-1.0.0.dylib":
                    "efb57393d18a236202b3e2a4f4326f0761c4e9da678d1fb2cefb62a953efd5db",
                "codex-resources/voice/lib/libgstpbutils-1.0.0.dylib":
                    "adb620bdc2190a157e2e5f765a703640a73c498fb081d83629acc76f840d2011",
                "codex-resources/voice/lib/libgstreamer-1.0.0.dylib":
                    "a1b30c536ced0265b3a8da01c6e79366c4f81f84367497ee03fd09a9efb711ad",
                "codex-resources/voice/lib/libgstrtp-1.0.0.dylib":
                    "04e3e4ae32e9f31112de4e0f0be4a7562aef7b9a8447e8c2ac0c40f2f4833d27",
                "codex-resources/voice/lib/libgsttag-1.0.0.dylib":
                    "c451148da91f64d149d9993e98f7ca8a1a338ed0545fa80a559201aede82ca3d",
                "codex-resources/voice/lib/libgstvideo-1.0.0.dylib":
                    "597ee1f7cd55013b2d42d8d049d09fdffe64d85ee5e0907596fe1752d0f08122",
                "codex-resources/voice/lib/libintl.8.dylib":
                    "cdbc95ae3e8350047bc8b7510761b4a70285afe2a6924aa912109f93a9a12629",
                "codex-resources/voice/lib/libopus.0.dylib":
                    "951c20cc9df5e242bd386e1145dbc755d61fc23619848166c63c1ec1e03a91b5",
                "codex-resources/voice/lib/libpcre2-8.0.dylib":
                    "944fa068df87698d23452b6a590de741012897b54419cd785bcbd2c1bf3d5409",
                "codex-resources/voice/lib/libz.1.dylib":
                    "73a57393eaea45753dcc60a130122dfdd10b981be65e98b216af1d0a7eb652a4",
                "codex-resources/voice/licenses/LGPL-2.1.txt":
                    "ad2eec519ebd4b5df86ea84dff24ae3bfa2edea846a703b58902dd221ae375db",
                "codex-resources/voice/licenses/Opus.txt":
                    "01e1167d54a096d123cf6dfbbeb19587278845c6481d2d66d545669846079551",
                "codex-resources/voice/licenses/PCRE2.md":
                    "197d8a73ffee0d6b09adba2f9c677b5f5aede24edf89258a68e48248d010d811",
                "codex-resources/voice/licenses/libffi.txt":
                    "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c",
                "codex-resources/voice/licenses/proxy-libintl.txt":
                    "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5",
                "codex-resources/voice/licenses/sljit.txt":
                    "5f216505c0f6ea3273caec89e766eef93cdeb7bbb0c429f9360116d7c938feeb",
                "codex-resources/voice/licenses/zlib.txt":
                    "e32ff4e00d9d94930537635291da39e7e612703334bf6fde8c7f1686fe8a45a2",
                "codex-resources/voice/manifest.json":
                    "d6663e9c89b260f2936501e5822495081fb66c9eb629386a9fed0aef17b977fb",
                "codex-resources/voice/plugins/libgstapp.dylib":
                    "681e43dbe55976e63ee4931e532e45be48215ff7bcacf4b1f50cffae4c9954b4",
                "codex-resources/voice/plugins/libgstaudioconvert.dylib":
                    "ac1060be8fab2d9859fd06f960463ffdefc0b4a0e0e5a4ad288704d9fc447816",
                "codex-resources/voice/plugins/libgstaudioresample.dylib":
                    "af908e7efbb6bc41ccd0b1f79285321436a09ea856b63dcea361f577b8efaf5f",
                "codex-resources/voice/plugins/libgstcoreelements.dylib":
                    "9c95059f3fcc08ea94f11aa6dfdd9feaa839e1d7e324413b36f58e57c2689be0",
                "codex-resources/voice/plugins/libgstopus.dylib":
                    "0bbd4c12369394322edbfec44bcc6e6b3c6833699b98f40bbfa614dad11e66a7",
                "codex-resources/voice/plugins/libgstrtp.dylib":
                    "79a6612d349973ee87cd33e278db37d85ca7355d1dc8b8248c3c7fd591f0fbd7",
                "codex-resources/voice/plugins/libgstrtpmanager.dylib":
                    "828a6ab627e1cb4ea4a87ba1c9b8d2a5872d8d3990672df8523e4d946b69cf8a",
                "codex-resources/voice/runtime.json":
                    "8ed3dddbd77cc253897240234a756823d94e936921424eb098c9e1b549da9d95",
                "codex-resources/voice/sources.json":
                    "e2f6b124f6277e7c3c4f5c7cc8830c66190f671ad65e972bb2cc9507dbfcb937",
            ],
            fingerprint:
                "d517a3752fe11e23aae487b07d6a9699b55031bc118253159c8d23bd26c01fb3"
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

    static func isQualifiedDataResource(path: String, digest: String) -> Bool {
        guard path == "codex-resources/voice/runtime.json" else { return false }
        return production.values.contains { $0.fileDigests[path] == digest }
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
