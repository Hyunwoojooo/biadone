import Darwin
import Foundation

/// Bounded, non-authorizing detail for the existing `codex_native_path_unsafe`
/// diagnostic. Raw errors and arbitrary path components must not become codes.
enum CodexRuntimePathIssue: String, CaseIterable, Equatable, Sendable {
    case invalidPath = "invalid_path"
    case inspectionUnavailable = "inspection_unavailable"
    case untrustedOwner = "untrusted_owner"
    case groupWritable = "group_writable"
    case worldWritable = "world_writable"
    case notExecutable = "not_executable"
    case unsupportedFileType = "unsupported_file_type"
    case linkUnresolved = "link_unresolved"
    case symbolicLinkAncestor = "symbolic_link_ancestor"
    case aclGrantsAccess = "acl_grants_access"
    case aclUnreadable = "acl_unreadable"
    case dynamicShim = "dynamic_shim"
    case changedDuringInspection = "changed_during_inspection"
    case changedDuringQualification = "changed_during_qualification"
    case approvalDrift = "approval_drift"

    var detail: String {
        switch self {
        case .invalidPath: PetL10n.text("Unable to verify the Codex execution path format.", korean: "Codex 실행 경로의 형식을 확인하지 못했습니다.")
        case .inspectionUnavailable: PetL10n.text("Unable to read and inspect the Codex file or parent folder.", korean: "Codex 파일 또는 상위 폴더를 읽어 검사하지 못했습니다.")
        case .untrustedOwner: PetL10n.text("The Codex file or parent folder is not owned by the current user or root.", korean: "Codex 파일 또는 상위 폴더가 현재 사용자나 시스템(root)의 소유가 아닙니다.")
        case .groupWritable: PetL10n.text("The Codex file or parent folder has disallowed group-write permissions.", korean: "Codex 파일 또는 상위 폴더에 허용되지 않은 그룹 쓰기 권한이 있습니다.")
        case .worldWritable: PetL10n.text("The Codex file or parent folder is writable by all users.", korean: "Codex 파일 또는 상위 폴더를 모든 사용자가 변경할 수 있습니다.")
        case .notExecutable: PetL10n.text("The Codex file is not executable.", korean: "Codex 파일에 실행 권한이 없습니다.")
        case .unsupportedFileType: PetL10n.text("The Codex executable or parent folder has an unexpected type.", korean: "Codex 실행 파일 또는 상위 폴더의 종류가 예상과 다릅니다.")
        case .linkUnresolved: PetL10n.text("Unable to find the Codex target or resolve its link.", korean: "Codex 경로가 가리키는 파일을 찾거나 링크를 해석하지 못했습니다.")
        case .symbolicLinkAncestor: PetL10n.text("The Codex path has a disallowed symbolic-link ancestor.", korean: "Codex 경로의 상위 폴더에 허용되지 않은 심볼릭 링크가 있습니다.")
        case .aclGrantsAccess: PetL10n.text("The Codex file or parent folder's ACL grants additional access.", korean: "Codex 파일 또는 상위 폴더의 ACL에 추가 접근을 허용하는 항목이 있습니다.")
        case .aclUnreadable: PetL10n.text("Unable to safely read the Codex file or parent folder's ACL.", korean: "Codex 파일 또는 상위 폴더의 ACL을 안전하게 확인하지 못했습니다.")
        case .dynamicShim: PetL10n.text("The Codex path points to a dynamic shim that can change its execution target.", korean: "Codex 경로가 실행 대상을 바꿀 수 있는 동적 실행 연결(shim)을 가리킵니다.")
        case .changedDuringInspection: PetL10n.text("Codex files or folders changed during path inspection.", korean: "경로를 검사하는 동안 Codex 파일이나 폴더가 변경되었습니다.")
        case .changedDuringQualification: PetL10n.text("The Codex execution path changed during version verification.", korean: "버전을 검사하는 동안 Codex 실행 경로가 변경되었습니다.")
        case .approvalDrift: PetL10n.text("The Codex execution path differs from the file verified previously.", korean: "Codex 실행 경로가 이전 검사에서 확인한 파일과 달라졌습니다.")
        }
    }

    var recovery: String {
        switch self {
        case .changedDuringInspection, .changedDuringQualification, .approvalDrift:
            PetL10n.text("Choose Check Again after the Codex update finishes.", korean: "Codex 업데이트가 끝난 뒤 ‘다시 검사’를 누르세요.")
        case .inspectionUnavailable, .aclUnreadable:
            PetL10n.text("Check permissions and installation at the displayed path, then retry.", korean: "표시된 경로의 접근 권한과 설치 상태를 확인한 뒤 다시 검사하세요.")
        case .dynamicShim:
            PetL10n.text("Check an installation path containing the official native Codex executable.", korean: "공식 native Codex 실행 파일을 사용할 수 있는 설치 경로를 확인하세요.")
        case .untrustedOwner, .groupWritable, .worldWritable, .aclGrantsAccess:
            PetL10n.text("Check ownership and permissions at the displayed path, or reinstall Codex in the current account's official installation location.", korean: "표시된 경로의 소유권·권한을 확인하거나 현재 계정의 공식 설치 경로에 Codex를 다시 설치하세요.")
        case .invalidPath, .notExecutable, .unsupportedFileType, .linkUnresolved, .symbolicLinkAncestor:
            PetL10n.text("Check the official Codex installation path or repair the installation, then retry.", korean: "공식 Codex 설치 경로를 확인하거나 설치를 복구한 뒤 다시 검사하세요.")
        }
    }
}

enum CodexRuntimePathRole: String, Equatable, Sendable {
    case source = "source"
    case target = "target"
    case sourceAncestor = "source_ancestor"
    case targetAncestor = "target_ancestor"
    case unknown = "unknown"

    var title: String {
        switch self {
        case .source: PetL10n.text("Selected path", korean: "선택 경로")
        case .target: PetL10n.text("Actual executable", korean: "실제 실행 파일")
        case .sourceAncestor: PetL10n.text("Selected path's parent folder", korean: "선택 경로의 상위 폴더")
        case .targetAncestor: PetL10n.text("Executable's parent folder", korean: "실제 실행 파일의 상위 폴더")
        case .unknown: PetL10n.text("Path unknown", korean: "경로 미확인")
        }
    }
}

struct CodexRuntimePathDiagnostic: Equatable, Sendable {
    let issue: CodexRuntimePathIssue
    var role: CodexRuntimePathRole = .unknown
    var path: String?
    /// The target already observed by this failed inspection. This is not a
    /// trusted canonical path, an approval, or permission to launch the file.
    var resolvedTargetPath: String? = nil
}

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
    case invalidSource(String, diagnostic: CodexRuntimePathDiagnostic? = nil)
    case unsafePath(String, diagnostic: CodexRuntimePathDiagnostic? = nil)
    case dynamicShim(String)
    case changedDuringInspection
    case changedDuringQualification
    case approvalDrift
    case unsupportedVersion(String?)

    var errorDescription: String? {
        switch self {
        case let .invalidRecord(reason):
            "Codex runtime qualification is invalid: \(reason)"
        case let .invalidSource(reason, _):
            "Codex runtime source is invalid: \(reason)"
        case let .unsafePath(reason, _):
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

    var pathDiagnostic: CodexRuntimePathDiagnostic? {
        switch self {
        case .invalidSource(_, let diagnostic), .unsafePath(_, let diagnostic): diagnostic
        case .invalidRecord: .init(issue: .invalidPath)
        case .dynamicShim: .init(issue: .dynamicShim)
        case .changedDuringInspection: .init(issue: .changedDuringInspection)
        case .changedDuringQualification: .init(issue: .changedDuringQualification)
        case .approvalDrift: .init(issue: .approvalDrift)
        case .unsupportedVersion: nil
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
            throw CodexRuntimeTrustError.invalidSource(
                "source must be a file URL", diagnostic: .init(issue: .invalidPath, role: .source)
            )
        }
        let sourcePath = sourceURL.path
        try CodexRuntimePathSupport.requireCanonicalAbsolutePath(sourcePath)
        if let shim = dynamicShimLabel(for: sourcePath) {
            throw CodexRuntimeTrustError.dynamicShim(shim)
        }

        let sourceIdentity = try identity(at: sourcePath, role: .source)
        guard CodexRuntimePathSupport.isRegularOrSymbolicLink(sourceIdentity.mode) else {
            throw pathRejection(.unsupportedFileType, at: sourcePath, role: .source)
        }
        try requireTrustedOwner(sourceIdentity, at: sourcePath, role: .source)
        if CodexRuntimePathSupport.isRegular(sourceIdentity.mode) {
            try requireSafeWritePermissions(sourceIdentity, at: sourcePath, role: .source)
        }
        try requireNoExtendedACL(at: sourcePath, expected: sourceIdentity, role: .source)

        let canonicalPath = try resolvedPath(for: sourcePath)
        do {
            return try inspectResolvedSource(
                sourcePath: sourcePath, sourceIdentity: sourceIdentity,
                canonicalPath: canonicalPath
            )
        } catch let error as CodexRuntimeTrustError {
            // Preserve this inspection's observation without resolving the
            // source again or changing which errors reject the executable.
            switch error {
            case let .invalidSource(reason, diagnostic):
                var observed = diagnostic
                observed?.resolvedTargetPath = canonicalPath
                throw CodexRuntimeTrustError.invalidSource(reason, diagnostic: observed)
            case let .unsafePath(reason, diagnostic):
                var observed = diagnostic
                observed?.resolvedTargetPath = canonicalPath
                throw CodexRuntimeTrustError.unsafePath(reason, diagnostic: observed)
            default:
                throw error
            }
        }
    }

    private func inspectResolvedSource(
        sourcePath: String,
        sourceIdentity: CodexRuntimeFileIdentity,
        canonicalPath: String
    ) throws -> CodexRuntimeTrustSnapshot {
        if let shim = dynamicShimLabel(for: canonicalPath) {
            throw CodexRuntimeTrustError.dynamicShim(shim)
        }
        let monitored = matchingMonitoredEntry(
            sourcePath: sourcePath,
            canonicalPath: canonicalPath
        )

        let targetIdentity = try identity(at: canonicalPath, role: .target)
        guard CodexRuntimePathSupport.isRegular(targetIdentity.mode) else {
            throw pathRejection(.unsupportedFileType, at: canonicalPath, role: .target)
        }
        try requireTrustedOwner(targetIdentity, at: canonicalPath, role: .target)
        try requireSafeWritePermissions(targetIdentity, at: canonicalPath, role: .target)
        guard access(canonicalPath, X_OK) == 0 else {
            throw pathRejection(.notExecutable, at: canonicalPath, role: .target)
        }
        try requireNoExtendedACL(at: canonicalPath, expected: targetIdentity, role: .target)

        let sourceAncestors = try captureAncestors(
            of: sourcePath,
            groupWritableRootPath: monitored?.groupWritableRootPath,
            role: .sourceAncestor
        )
        let canonicalAncestors = try captureAncestors(
            of: canonicalPath,
            groupWritableRootPath: monitored?.groupWritableRootPath,
            role: .targetAncestor
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
        role: CodexRuntimePathRole
    ) throws -> [CodexRuntimePathIdentity] {
        try CodexRuntimePathSupport.ancestorPaths(of: path).map { ancestor in
            let captured = try identity(at: ancestor, role: role)
            let groupWriteIsMonitored = groupWritableRootPath.map { root in
                ancestor == root || CodexRuntimePathSupport.isDescendant(ancestor, of: root)
            } ?? false
            guard CodexRuntimePathSupport.isDirectory(captured.mode) else {
                let isLink = mode_t(captured.mode) & mode_t(S_IFMT) == mode_t(S_IFLNK)
                throw pathRejection(
                    isLink ? .symbolicLinkAncestor : .unsupportedFileType, at: ancestor, role: role
                )
            }
            try requireTrustedOwner(captured, at: ancestor, role: role)
            try requireSafeWritePermissions(
                captured, at: ancestor, role: role, groupWriteIsMonitored: groupWriteIsMonitored
            )
            try requireNoExtendedACL(at: ancestor, expected: captured, role: role)
            return CodexRuntimePathIdentity(
                path: ancestor,
                identity: securityIdentity(forDirectory: captured)
            )
        }
    }

    private func verifyEndOfInspection(_ snapshot: CodexRuntimeTrustSnapshot) throws {
        guard try resolvedPath(for: snapshot.stableSourcePath) == snapshot.canonicalPath,
              try identity(at: snapshot.stableSourcePath, role: .source)
                == snapshot.sourceIdentity,
              try identity(at: snapshot.canonicalPath, role: .target)
                == snapshot.targetIdentity,
              access(snapshot.canonicalPath, X_OK) == 0
        else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }
        try requireNoExtendedACL(
            at: snapshot.stableSourcePath,
            expected: snapshot.sourceIdentity,
            role: .source
        )
        try requireNoExtendedACL(
            at: snapshot.canonicalPath,
            expected: snapshot.targetIdentity,
            role: .target
        )
        for (ancestors, role) in [
            (snapshot.sourceAncestors, CodexRuntimePathRole.sourceAncestor),
            (snapshot.canonicalAncestors, CodexRuntimePathRole.targetAncestor),
        ] {
            for pathIdentity in ancestors {
                let current = try identity(at: pathIdentity.path, role: role)
                guard securityIdentity(forDirectory: current) == pathIdentity.identity else {
                    throw CodexRuntimeTrustError.changedDuringInspection
                }
                try requireNoExtendedACL(at: pathIdentity.path, expected: current, role: role)
            }
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

    private func pathRejection(
        _ issue: CodexRuntimePathIssue, at path: String, role: CodexRuntimePathRole
    ) -> CodexRuntimeTrustError {
        .unsafePath(
            "\(role.rawValue): \(issue.rawValue)",
            diagnostic: .init(issue: issue, role: role, path: path)
        )
    }

    private func requireTrustedOwner(
        _ identity: CodexRuntimeFileIdentity, at path: String, role: CodexRuntimePathRole
    ) throws {
        guard CodexRuntimePathSupport.isTrustedOwner(identity.owner) else {
            throw pathRejection(.untrustedOwner, at: path, role: role)
        }
    }

    private func requireSafeWritePermissions(
        _ identity: CodexRuntimeFileIdentity, at path: String, role: CodexRuntimePathRole,
        groupWriteIsMonitored: Bool = false
    ) throws {
        guard identity.mode & 0o002 == 0 else {
            throw pathRejection(.worldWritable, at: path, role: role)
        }
        guard groupWriteIsMonitored || identity.mode & 0o020 == 0 else {
            throw pathRejection(.groupWritable, at: path, role: role)
        }
    }

    private func identity(at path: String, role: CodexRuntimePathRole) throws -> CodexRuntimeFileIdentity {
        var info = stat()
        guard lstat(path, &info) == 0 else {
            throw CodexRuntimeTrustError.invalidSource(
                "\(role.rawValue) cannot be inspected",
                diagnostic: .init(issue: .inspectionUnavailable, role: role, path: path)
            )
        }
        return CodexRuntimePathSupport.identity(info)
    }

    private func resolvedPath(for sourcePath: String) throws -> String {
        guard let pointer = realpath(sourcePath, nil) else {
            throw CodexRuntimeTrustError.invalidSource(
                "stable source target cannot be resolved",
                diagnostic: .init(issue: .linkUnresolved, role: .source, path: sourcePath)
            )
        }
        defer { free(pointer) }
        let path = String(cString: pointer)
        try CodexRuntimePathSupport.requireCanonicalAbsolutePath(path)
        return path
    }

    private func requireNoExtendedACL(
        at path: String,
        expected: CodexRuntimeFileIdentity,
        role: CodexRuntimePathRole
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
                    throw pathRejection(
                        containsGrant == true ? .aclGrantsAccess : .aclUnreadable, at: path, role: role
                    )
                }
            }
            guard acl != nil || aclError == ENOENT,
                  identitiesMatch(
                    try identity(at: path, role: role),
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
            throw pathRejection(.inspectionUnavailable, at: path, role: role)
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
                throw pathRejection(
                    containsGrant == true ? .aclGrantsAccess : .aclUnreadable, at: path, role: role
                )
            }
        }
        guard acl != nil || aclError == ENOENT else {
            throw pathRejection(.aclUnreadable, at: path, role: role)
        }
        var completed = stat()
        guard fstat(descriptor, &completed) == 0,
              identitiesMatch(CodexRuntimePathSupport.identity(completed), expected),
              identitiesMatch(
                try identity(at: path, role: role),
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
