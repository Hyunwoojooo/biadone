import Darwin
import Foundation

/// Returns whether an extended ACL contains an allow entry. Standard macOS
/// home directories commonly carry a deny-delete ACL; deny-only ACLs narrow
/// access and are safe for this trust boundary. Unknown entries or parse
/// failures return nil so callers can fail closed.
func blabeeExtendedACLContainsGrant(_ accessControlList: acl_t) -> Bool? {
    var entry: acl_entry_t?
    // Darwin exposes these C enum constants as a non-convertible Swift enum,
    // while `acl_get_entry` imports its selector as Int32. Their ABI values
    // are defined as 0 (first) and -1 (next).
    var entryIdentifier: Int32 = 0
    while true {
        errno = 0
        let result = acl_get_entry(
            accessControlList,
            entryIdentifier,
            &entry
        )
        if result == -1 { return errno == EINVAL ? false : nil }
        guard result == 0, let entry else { return nil }
        var tag = acl_tag_t(0)
        guard acl_get_tag_type(entry, &tag) == 0 else { return nil }
        if tag == ACL_EXTENDED_ALLOW { return true }
        guard tag == ACL_EXTENDED_DENY else { return nil }
        entryIdentifier = -1
    }
}

/// A failure from the launch-time Codex trust gate.
///
/// Callers may treat `approvalDrift` as a request to run `qualify` again. Every
/// other error is fail-closed: no executable path from the failed inspection
/// should be launched.
enum CodexRuntimeTrustError: LocalizedError, Equatable, Sendable {
    case invalidRecord(String)
    case invalidSource(String)
    case unsafePath(String)
    case dynamicShim(String)
    case changedDuringInspection
    case changedDuringQualification
    case approvalDrift
    case unsupportedVersion(String?)

    var errorDescription: String? {
        switch self {
        case let .invalidRecord(reason):
            "Codex runtime qualification is invalid: \(reason)"
        case let .invalidSource(reason):
            "Codex runtime source is invalid: \(reason)"
        case let .unsafePath(reason):
            "Codex runtime path is unsafe: \(reason)"
        case let .dynamicShim(label):
            "Codex runtime source resolves through the dynamic \(label) shim."
        case .changedDuringInspection:
            "Codex runtime path changed while its trust identity was inspected."
        case .changedDuringQualification:
            "Codex runtime path changed while its version was qualified."
        case .approvalDrift:
            "Codex runtime path no longer matches its approved identity."
        case let .unsupportedVersion(version):
            if let version {
                "Codex CLI \(version) is not approved for managed use."
            } else {
                "Codex CLI version could not be read safely."
            }
        }
    }
}

/// A stable launcher name whose group-writable ancestors are monitored on
/// every launch. Production entries are intentionally limited to the two
/// conventional Homebrew launcher names and their versioned package roots.
struct CodexRuntimeMonitoredEntry: Equatable, Sendable {
    let stableSourcePath: String
    let groupWritableRootPath: String
    let canonicalRootPaths: [String]

    init(stableSourceURL: URL, canonicalRootURLs: [URL]) {
        stableSourcePath = stableSourceURL.path
        groupWritableRootPath = stableSourceURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .path
        canonicalRootPaths = canonicalRootURLs.map(\.path)
    }
}

/// Security identity retained for one managed process tree. It deliberately
/// includes mutation metadata so later child spawns can detect both in-place
/// updates and path replacement without running another version process.
struct CodexRuntimeFileIdentity: Equatable, Sendable {
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

    init(
        device: UInt64,
        inode: UInt64,
        mode: UInt32,
        owner: UInt32,
        group: UInt32,
        size: Int64,
        modificationSeconds: Int64,
        modificationNanoseconds: Int64,
        changeSeconds: Int64,
        changeNanoseconds: Int64
    ) {
        self.device = device
        self.inode = inode
        self.mode = mode
        self.owner = owner
        self.group = group
        self.size = size
        self.modificationSeconds = modificationSeconds
        self.modificationNanoseconds = modificationNanoseconds
        self.changeSeconds = changeSeconds
        self.changeNanoseconds = changeNanoseconds
    }

}

struct CodexRuntimePathIdentity: Equatable, Sendable {
    let path: String
    let identity: CodexRuntimeFileIdentity

    init(path: String, identity: CodexRuntimeFileIdentity) {
        self.path = path
        self.identity = identity
    }

}

/// Complete result of one structural inspection.
struct CodexRuntimeTrustSnapshot: Equatable, Sendable {
    let stableSourcePath: String
    let canonicalPath: String
    let sourceIdentity: CodexRuntimeFileIdentity
    let targetIdentity: CodexRuntimeFileIdentity
    let sourceAncestors: [CodexRuntimePathIdentity]
    let canonicalAncestors: [CodexRuntimePathIdentity]
}

/// Process-local qualification captured before any managed Codex child starts.
struct CodexRuntimeApproval: Equatable, Sendable {
    let stableSourcePath: String
    let canonicalPath: String
    let sourceIdentity: CodexRuntimeFileIdentity
    let targetIdentity: CodexRuntimeFileIdentity
    let sourceAncestors: [CodexRuntimePathIdentity]
    let canonicalAncestors: [CodexRuntimePathIdentity]
    let qualifiedVersion: String

    init(snapshot: CodexRuntimeTrustSnapshot, qualifiedVersion: String) {
        stableSourcePath = snapshot.stableSourcePath
        canonicalPath = snapshot.canonicalPath
        sourceIdentity = snapshot.sourceIdentity
        targetIdentity = snapshot.targetIdentity
        sourceAncestors = snapshot.sourceAncestors
        canonicalAncestors = snapshot.canonicalAncestors
        self.qualifiedVersion = qualifiedVersion
    }

    var snapshot: CodexRuntimeTrustSnapshot {
        CodexRuntimeTrustSnapshot(
            stableSourcePath: stableSourcePath,
            canonicalPath: canonicalPath,
            sourceIdentity: sourceIdentity,
            targetIdentity: targetIdentity,
            sourceAncestors: sourceAncestors,
            canonicalAncestors: canonicalAncestors
        )
    }

}

/// A short-lived token returned only after a complete approval revalidation.
/// The integration layer should use `canonicalURL` immediately for `exec` or
/// spawn and must not persist the token itself.
struct CodexRuntimeApprovedExecutable: Equatable, Sendable {
    let stableSourceURL: URL
    let canonicalURL: URL
    let targetIdentity: CodexRuntimeFileIdentity
    let qualifiedVersion: String
}

/// Hybrid launch-time trust gate.
///
/// `revalidate` performs no process launch and no version read. If any pinned
/// identity changed, the current process tree fails closed; a new explicit
/// invocation may call `qualify` again.
struct CodexRuntimeTrustGate: Sendable {
    static let standardHomebrewEntries = [
        CodexRuntimeMonitoredEntry(
            stableSourceURL: URL(fileURLWithPath: "/opt/homebrew/bin/codex"),
            canonicalRootURLs: [
                URL(fileURLWithPath: "/opt/homebrew/Cellar", isDirectory: true),
                URL(fileURLWithPath: "/opt/homebrew/Caskroom", isDirectory: true),
            ]
        ),
        CodexRuntimeMonitoredEntry(
            stableSourceURL: URL(fileURLWithPath: "/usr/local/bin/codex"),
            canonicalRootURLs: [
                URL(fileURLWithPath: "/usr/local/Cellar", isDirectory: true),
                URL(fileURLWithPath: "/usr/local/Caskroom", isDirectory: true),
            ]
        ),
    ]

    private let monitoredEntries: [CodexRuntimeMonitoredEntry]
    private let dynamicShimRootPaths: [String]

    init(
        monitoredEntries: [CodexRuntimeMonitoredEntry] = Self.standardHomebrewEntries,
        dynamicShimRootURLs: [URL] = []
    ) {
        self.monitoredEntries = monitoredEntries
        dynamicShimRootPaths = Array(Set(dynamicShimRootURLs.map {
            $0.path
        })).sorted()
    }

    func inspect(sourceURL: URL) throws -> CodexRuntimeTrustSnapshot {
        guard sourceURL.isFileURL else {
            throw CodexRuntimeTrustError.invalidSource("source must be a file URL")
        }
        let sourcePath = sourceURL.path
        try CodexRuntimePathSupport.requireCanonicalAbsolutePath(sourcePath)
        if let shim = dynamicShimLabel(for: sourcePath) {
            throw CodexRuntimeTrustError.dynamicShim(shim)
        }

        let sourceIdentity = try identity(at: sourcePath, label: "stable source")
        guard CodexRuntimePathSupport.isRegularOrSymbolicLink(sourceIdentity.mode),
              CodexRuntimePathSupport.isTrustedOwner(sourceIdentity.owner)
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "stable source must be a root/current-user regular file or symbolic link"
            )
        }
        if CodexRuntimePathSupport.isRegular(sourceIdentity.mode),
           sourceIdentity.mode & 0o022 != 0
        {
            throw CodexRuntimeTrustError.unsafePath(
                "stable source executable is group- or world-writable"
            )
        }
        try requireNoExtendedACL(at: sourcePath, expected: sourceIdentity)

        let canonicalPath = try resolvedPath(for: sourcePath)
        if let shim = dynamicShimLabel(for: canonicalPath) {
            throw CodexRuntimeTrustError.dynamicShim(shim)
        }
        let monitored = matchingMonitoredEntry(
            sourcePath: sourcePath,
            canonicalPath: canonicalPath
        )

        let targetIdentity = try identity(at: canonicalPath, label: "canonical target")
        guard CodexRuntimePathSupport.isRegular(targetIdentity.mode),
              CodexRuntimePathSupport.isTrustedOwner(targetIdentity.owner),
              targetIdentity.mode & 0o022 == 0,
              access(canonicalPath, X_OK) == 0
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "canonical target must be an executable root/current-user file with mode 0755 or stricter"
            )
        }
        try requireNoExtendedACL(at: canonicalPath, expected: targetIdentity)

        let sourceAncestors = try captureAncestors(
            of: sourcePath,
            groupWritableRootPath: monitored?.groupWritableRootPath,
            label: "stable source"
        )
        let canonicalAncestors = try captureAncestors(
            of: canonicalPath,
            groupWritableRootPath: monitored?.groupWritableRootPath,
            label: "canonical target"
        )
        let snapshot = CodexRuntimeTrustSnapshot(
            stableSourcePath: sourcePath,
            canonicalPath: canonicalPath,
            sourceIdentity: sourceIdentity,
            targetIdentity: targetIdentity,
            sourceAncestors: sourceAncestors,
            canonicalAncestors: canonicalAncestors
        )
        try verifyEndOfInspection(snapshot)
        return snapshot
    }

    func qualify(
        sourceURL: URL,
        versionReader: (URL) throws -> String?
    ) throws -> CodexRuntimeApproval {
        let before = try inspect(sourceURL: sourceURL)
        let version = try versionReader(URL(fileURLWithPath: before.canonicalPath))
        let after = try inspect(sourceURL: sourceURL)
        guard before == after else {
            throw CodexRuntimeTrustError.changedDuringQualification
        }
        guard case let .supported(qualifiedVersion) = CodexCompatibility.qualify(version: version)
        else {
            throw CodexRuntimeTrustError.unsupportedVersion(version)
        }
        return CodexRuntimeApproval(
            snapshot: after,
            qualifiedVersion: qualifiedVersion
        )
    }

    func revalidate(
        approval: CodexRuntimeApproval
    ) throws -> CodexRuntimeApprovedExecutable {
        guard CodexCompatibility.qualify(
            version: approval.qualifiedVersion
        ).isApprovedForManagedUse else {
            throw CodexRuntimeTrustError.unsupportedVersion(
                approval.qualifiedVersion
            )
        }
        let current = try inspect(
            sourceURL: URL(fileURLWithPath: approval.stableSourcePath)
        )
        guard current == approval.snapshot else {
            throw CodexRuntimeTrustError.approvalDrift
        }
        return CodexRuntimeApprovedExecutable(
            stableSourceURL: URL(fileURLWithPath: current.stableSourcePath),
            canonicalURL: URL(fileURLWithPath: current.canonicalPath),
            targetIdentity: current.targetIdentity,
            qualifiedVersion: approval.qualifiedVersion
        )
    }

    private func matchingMonitoredEntry(
        sourcePath: String,
        canonicalPath: String
    ) -> CodexRuntimeMonitoredEntry? {
        monitoredEntries.first { entry in
            sourcePath == entry.stableSourcePath
                && entry.canonicalRootPaths.contains {
                    CodexRuntimePathSupport.isDescendant(canonicalPath, of: $0)
                }
        }
    }

    private func dynamicShimLabel(for path: String) -> String? {
        if path.contains("/.asdf/shims/") || path.hasSuffix("/.asdf/shims") {
            return "asdf"
        }
        if path.contains("/.volta/bin/") || path.hasSuffix("/.volta/bin") {
            return "Volta"
        }
        for root in dynamicShimRootPaths
        where path == root || CodexRuntimePathSupport.isDescendant(path, of: root) {
            return "configured"
        }
        return nil
    }

    private func captureAncestors(
        of path: String,
        groupWritableRootPath: String?,
        label: String
    ) throws -> [CodexRuntimePathIdentity] {
        try CodexRuntimePathSupport.ancestorPaths(of: path).map { ancestor in
            let captured = try identity(at: ancestor, label: "\(label) ancestor")
            let groupWriteIsMonitored = groupWritableRootPath.map { root in
                ancestor == root || CodexRuntimePathSupport.isDescendant(ancestor, of: root)
            } ?? false
            guard CodexRuntimePathSupport.isDirectory(captured.mode),
                  CodexRuntimePathSupport.isTrustedOwner(captured.owner),
                  captured.mode & 0o002 == 0,
                  groupWriteIsMonitored || captured.mode & 0o020 == 0
            else {
                throw CodexRuntimeTrustError.unsafePath(
                    "\(label) ancestor is not safely owned or writable: \(ancestor)"
                )
            }
            try requireNoExtendedACL(at: ancestor, expected: captured)
            return CodexRuntimePathIdentity(
                path: ancestor,
                identity: securityIdentity(forDirectory: captured)
            )
        }
    }

    private func verifyEndOfInspection(_ snapshot: CodexRuntimeTrustSnapshot) throws {
        guard try resolvedPath(for: snapshot.stableSourcePath) == snapshot.canonicalPath,
              try identity(at: snapshot.stableSourcePath, label: "stable source")
                == snapshot.sourceIdentity,
              try identity(at: snapshot.canonicalPath, label: "canonical target")
                == snapshot.targetIdentity,
              access(snapshot.canonicalPath, X_OK) == 0
        else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }
        try requireNoExtendedACL(
            at: snapshot.stableSourcePath,
            expected: snapshot.sourceIdentity
        )
        try requireNoExtendedACL(
            at: snapshot.canonicalPath,
            expected: snapshot.targetIdentity
        )
        for pathIdentity in snapshot.sourceAncestors + snapshot.canonicalAncestors {
            let current = try identity(at: pathIdentity.path, label: "ancestor")
            guard securityIdentity(forDirectory: current) == pathIdentity.identity
            else {
                throw CodexRuntimeTrustError.changedDuringInspection
            }
            try requireNoExtendedACL(at: pathIdentity.path, expected: current)
        }
    }

    /// Directory contents may change for unrelated reasons (for example when
    /// another test or Homebrew creates a sibling). Runtime trust depends on
    /// the directory object and its write policy, not its entry count or
    /// mutation timestamps, so only security-relevant identity is persisted.
    private func securityIdentity(
        forDirectory identity: CodexRuntimeFileIdentity
    ) -> CodexRuntimeFileIdentity {
        CodexRuntimeFileIdentity(
            device: identity.device,
            inode: identity.inode,
            mode: identity.mode,
            owner: identity.owner,
            group: identity.group,
            size: 0,
            modificationSeconds: 0,
            modificationNanoseconds: 0,
            changeSeconds: 0,
            changeNanoseconds: 0
        )
    }

    private func identity(at path: String, label: String) throws -> CodexRuntimeFileIdentity {
        var info = stat()
        guard lstat(path, &info) == 0 else {
            throw CodexRuntimeTrustError.invalidSource(
                "\(label) cannot be inspected at \(path)"
            )
        }
        return CodexRuntimePathSupport.identity(info)
    }

    private func resolvedPath(for sourcePath: String) throws -> String {
        guard let pointer = realpath(sourcePath, nil) else {
            throw CodexRuntimeTrustError.invalidSource(
                "stable source target cannot be resolved"
            )
        }
        defer { free(pointer) }
        let path = String(cString: pointer)
        try CodexRuntimePathSupport.requireCanonicalAbsolutePath(path)
        return path
    }

    private func requireNoExtendedACL(
        at path: String,
        expected: CodexRuntimeFileIdentity
    ) throws {
        let fileType = mode_t(expected.mode) & mode_t(S_IFMT)
        if fileType == mode_t(S_IFLNK) {
            errno = 0
            let acl = acl_get_link_np(path, ACL_TYPE_EXTENDED)
            let aclError = errno
            if let acl {
                let containsGrant = blabeeExtendedACLContainsGrant(acl)
                acl_free(UnsafeMutableRawPointer(acl))
                guard containsGrant == false else {
                    throw CodexRuntimeTrustError.unsafePath(
                        "extended ACL grants permissions or cannot be inspected: \(path)"
                    )
                }
            }
            guard acl != nil || aclError == ENOENT,
                  identitiesMatch(
                    try identity(at: path, label: "ACL path"),
                    expected
                  )
            else {
                throw CodexRuntimeTrustError.changedDuringInspection
            }
            return
        }

        var flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        if fileType == mode_t(S_IFDIR) { flags |= O_DIRECTORY }
        let descriptor = open(path, flags)
        guard descriptor >= 0 else {
            throw CodexRuntimeTrustError.unsafePath("path cannot be opened without following links: \(path)")
        }
        defer { close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0,
              identitiesMatch(CodexRuntimePathSupport.identity(opened), expected)
        else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }

        errno = 0
        let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let aclError = errno
        if let acl {
            let containsGrant = blabeeExtendedACLContainsGrant(acl)
            acl_free(UnsafeMutableRawPointer(acl))
            guard containsGrant == false else {
                throw CodexRuntimeTrustError.unsafePath(
                    "extended ACL grants permissions or cannot be inspected: \(path)"
                )
            }
        }
        guard acl != nil || aclError == ENOENT else {
            throw CodexRuntimeTrustError.unsafePath("extended ACL cannot be inspected: \(path)")
        }
        var completed = stat()
        guard fstat(descriptor, &completed) == 0,
              identitiesMatch(CodexRuntimePathSupport.identity(completed), expected),
              identitiesMatch(
                try identity(at: path, label: "ACL path"),
                expected
              )
        else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }
    }

    private func identitiesMatch(
        _ current: CodexRuntimeFileIdentity,
        _ expected: CodexRuntimeFileIdentity
    ) -> Bool {
        if CodexRuntimePathSupport.isDirectory(expected.mode) {
            return securityIdentity(forDirectory: current)
                == securityIdentity(forDirectory: expected)
        }
        return current == expected
    }
}

private enum CodexRuntimePathSupport {
    static func identity(_ info: stat) -> CodexRuntimeFileIdentity {
        CodexRuntimeFileIdentity(
            device: UInt64(bitPattern: Int64(info.st_dev)),
            inode: UInt64(info.st_ino),
            mode: UInt32(info.st_mode),
            owner: UInt32(info.st_uid),
            group: UInt32(info.st_gid),
            size: Int64(info.st_size),
            modificationSeconds: Int64(info.st_mtimespec.tv_sec),
            modificationNanoseconds: Int64(info.st_mtimespec.tv_nsec),
            changeSeconds: Int64(info.st_ctimespec.tv_sec),
            changeNanoseconds: Int64(info.st_ctimespec.tv_nsec)
        )
    }

    static func requireCanonicalAbsolutePath(_ path: String) throws {
        guard path.hasPrefix("/"), !path.utf8.contains(0) else {
            throw CodexRuntimeTrustError.invalidRecord("path must be absolute and normalized")
        }
        if path == "/" { return }
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard components.first?.isEmpty == true,
              components.dropFirst().allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." })
        else {
            throw CodexRuntimeTrustError.invalidRecord("path must be absolute and normalized")
        }
    }

    static func ancestorPaths(of path: String) -> [String] {
        var result: [String] = []
        var directory = (path as NSString).deletingLastPathComponent
        while true {
            result.append(directory)
            let parent = (directory as NSString).deletingLastPathComponent
            if parent == directory { break }
            directory = parent
        }
        return result
    }

    static func isDescendant(_ path: String, of root: String) -> Bool {
        path.hasPrefix(root == "/" ? "/" : root + "/")
    }

    static func isTrustedOwner(_ owner: UInt32) -> Bool {
        owner == 0 || owner == UInt32(geteuid())
    }

    static func isRegular(_ mode: UInt32) -> Bool {
        mode_t(mode) & mode_t(S_IFMT) == mode_t(S_IFREG)
    }

    static func isDirectory(_ mode: UInt32) -> Bool {
        mode_t(mode) & mode_t(S_IFMT) == mode_t(S_IFDIR)
    }

    static func isRegularOrSymbolicLink(_ mode: UInt32) -> Bool {
        let fileType = mode_t(mode) & mode_t(S_IFMT)
        return fileType == mode_t(S_IFREG) || fileType == mode_t(S_IFLNK)
    }
}
