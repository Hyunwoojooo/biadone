import CoordinatorSwift
import Darwin
import Foundation
import Security

enum CodexPluginSetupState: Sendable, Equatable {
    case unchecked
    case unavailable(reason: String)
    case notInstalled
    case marketplaceInstalledNeedsPlugin
    case installedNeedsHookReview(version: String)
    case updateAvailable(installedVersion: String, bundledVersion: String)
    case conflict(reason: String)
    case error(code: String)

    var title: String {
        switch self {
        case .unchecked:
            return "Codex 연결 확인 전"
        case .unavailable:
            return "Codex 연결을 사용할 수 없음"
        case .notInstalled:
            return "Codex Plugin 미설치"
        case .marketplaceInstalledNeedsPlugin:
            return "Codex 연결 마무리 필요"
        case .installedNeedsHookReview:
            return "Plugin 설치됨 · Hook 상태 확인"
        case .updateAvailable:
            return "Blabee Plugin 업데이트 필요"
        case .conflict:
            return "기존 Blabee Plugin 충돌"
        case .error:
            return "Codex 연결 확인 실패"
        }
    }

    var detail: String {
        switch self {
        case .unchecked:
            return "아직 Codex Plugin 상태를 확인하지 않았습니다."
        case let .unavailable(reason):
            return reason
        case .notInstalled:
            return "연결 후 새 Codex 세션을 열고 /hooks에서 Blabee Hook을 검토해야 합니다."
        case .marketplaceInstalledNeedsPlugin:
            return "Blabee Marketplace만 연결되어 있습니다. 연결을 다시 시도하거나 안전하게 정리하세요."
        case .installedNeedsHookReview:
            return "Blabee는 Hook 신뢰 완료 여부를 자동 확인할 수 없습니다. 새 Codex 세션 또는 다시 연 세션에서 /hooks로 현재 상태를 확인하세요."
        case .updateAvailable:
            return "앱에 포함된 최신 Plugin으로 다시 연결한 뒤 새 세션에서 /hooks를 검토하세요."
        case let .conflict(reason):
            return reason
        case let .error(code):
            return "Codex Plugin 상태를 안전하게 확인하지 못했습니다. (\(code))"
        }
    }
}

protocol CodexPluginSetupManaging: Sendable {
    func inspect() async -> CodexPluginSetupState
    func connect() async -> CodexPluginSetupState
    func disconnect() async -> CodexPluginSetupState
}

actor CodexUnavailablePluginSetupManager: CodexPluginSetupManaging {
    private let reason: String

    init(reason: String = "제품 앱에서만 Codex 연결 설정을 사용할 수 있습니다.") {
        self.reason = reason
    }

    func inspect() async -> CodexPluginSetupState { .unavailable(reason: reason) }
    func connect() async -> CodexPluginSetupState { .unavailable(reason: reason) }
    func disconnect() async -> CodexPluginSetupState { .unavailable(reason: reason) }
}

struct CodexPluginSetupProcessResult: Sendable, Equatable {
    let exitCode: Int32
    let stdout: Data
}

typealias CodexPluginSetupExecutableResolving = @Sendable () throws -> URL
typealias CodexPluginSetupProcessRunning = @Sendable (
    _ executable: URL,
    _ arguments: [String],
    _ timeoutMilliseconds: Int
) throws -> CodexPluginSetupProcessResult

struct CodexPluginSetupQualifiedExecutable: Sendable, Equatable {
    let sourceURL: URL
    let canonicalURL: URL
    let version: String
    fileprivate let trustSnapshot: CodexRuntimeTrustSnapshot?

    static func testOnly(url: URL, version: String = "0.152.1")
        -> CodexPluginSetupQualifiedExecutable
    {
        CodexPluginSetupQualifiedExecutable(
            sourceURL: url,
            canonicalURL: url,
            version: version,
            trustSnapshot: nil
        )
    }
}

typealias CodexPluginSetupExecutableQualifying = @Sendable () throws
    -> CodexPluginSetupQualifiedExecutable
typealias CodexPluginSetupExecutableRevalidating = @Sendable (
    _ selection: CodexPluginSetupQualifiedExecutable
) throws -> URL
typealias CodexPluginSetupBundleRevalidating = @Sendable () throws -> Void

enum CodexPluginSetupExecutableResolver {
    private static let maximumNVMDirectoryEntries = 256
    private static let maximumNVMCandidates = 64

    static func candidateURLs(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        fixedCandidates: [URL] = [
            URL(fileURLWithPath: "/opt/homebrew/bin/codex"),
            URL(fileURLWithPath: "/usr/local/bin/codex"),
        ]
    ) -> [URL] {
        var candidates: [URL] = []
        if let path = environment["PATH"] {
            for entry in path.split(separator: ":", omittingEmptySubsequences: true) {
                let directory = String(entry)
                guard directory.hasPrefix("/"), directory.utf8.count <= 4_096 else {
                    continue
                }
                candidates.append(
                    URL(fileURLWithPath: directory, isDirectory: true)
                        .appendingPathComponent("codex", isDirectory: false)
                )
            }
        }

        candidates.append(contentsOf: fixedCandidates.prefix(16))

        if let home = safeHomeURL(environment: environment) {
            candidates.append(
                home.appendingPathComponent(".local/bin/codex", isDirectory: false)
            )
            candidates.append(
                home.appendingPathComponent(".volta/bin/codex", isDirectory: false)
            )
            candidates.append(contentsOf: nvmCandidates(home: home, fileManager: fileManager))
        }

        var visited: Set<String> = []
        return candidates.compactMap { candidate in
            let normalized = candidate.standardizedFileURL
            guard visited.insert(normalized.path).inserted else { return nil }
            return normalized
        }
    }

    static func qualifyFirst(
        candidates: [URL],
        qualifier: (URL) throws -> CodexPluginSetupQualifiedExecutable
    ) throws -> CodexPluginSetupQualifiedExecutable {
        for candidate in candidates.prefix(256) {
            var info = stat()
            guard lstat(candidate.path, &info) == 0 else { continue }
            do {
                return try qualifier(candidate)
            } catch {
                // Candidate order is preferred, not authoritative. An unsafe or
                // unsupported install must never prevent a later safe install.
                continue
            }
        }
        throw CoordinatorError("codex_plugin_setup_executable_unavailable")
    }

    static func safeHomeURL(environment: [String: String]) -> URL? {
        guard let path = environment["HOME"],
              path.hasPrefix("/"),
              path.utf8.count <= 4_096,
              !path.contains("\0")
        else { return nil }
        let url = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        guard url.path == path || url.path == String(path.dropLast(path.hasSuffix("/") ? 1 : 0))
        else { return nil }
        return url
    }

    private static func nvmCandidates(home: URL, fileManager: FileManager) -> [URL] {
        let versionsRoot = home
            .appendingPathComponent(".nvm/versions/node", isDirectory: true)
        var enumerationFailed = false
        guard let enumerator = fileManager.enumerator(
            at: versionsRoot,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles, .skipsSubdirectoryDescendants],
            errorHandler: { _, _ in
                enumerationFailed = true
                return false
            }
        ) else { return [] }

        var entries: [(url: URL, version: (Int, Int, Int))] = []
        var scannedEntryCount = 0
        while let value = enumerator.nextObject() {
            guard let entry = value as? URL else { return [] }
            scannedEntryCount += 1
            guard scannedEntryCount <= maximumNVMDirectoryEntries else {
                // An unexpectedly large version directory is not required for
                // discovery. Fail closed instead of loading or sorting it all.
                return []
            }
            guard let version = safeNVMVersion(entry.lastPathComponent) else {
                continue
            }
            entries.append((entry, version))
        }
        guard !enumerationFailed else { return [] }

        return entries
            .sorted { left, right in
                if left.version.0 != right.version.0 {
                    return left.version.0 > right.version.0
                }
                if left.version.1 != right.version.1 {
                    return left.version.1 > right.version.1
                }
                return left.version.2 > right.version.2
            }
            .prefix(maximumNVMCandidates)
            .map {
                $0.url.appendingPathComponent("bin/codex", isDirectory: false)
            }
    }

    private static func safeNVMVersion(_ value: String) -> (Int, Int, Int)? {
        guard value.utf8.count <= 32, value.first == "v" else { return nil }
        let components = value.dropFirst().split(separator: ".", omittingEmptySubsequences: false)
        guard components.count == 3,
              components.allSatisfy({ component in
                  !component.isEmpty
                      && component.count <= 8
                      && component.allSatisfy(\.isNumber)
              }),
              let major = Int(components[0]),
              let minor = Int(components[1]),
              let patch = Int(components[2])
        else { return nil }
        return (major, minor, patch)
    }
}

enum CodexPluginSetupProductionTrust {
    static let supportedPluginCLIVersions =
        CodexCompatibility.pluginCLISupportedVersions
    private static let expectedIdentifier = "codex"
    private static let expectedTeamIdentifier = "2DC432GLL2"
    private static let maximumVersionOutputBytes = 4_096

    static func qualify(
        sourceURL: URL,
        processRunner: CodexPluginSetupProcessRunning
    ) throws -> CodexPluginSetupQualifiedExecutable {
        let gate = CodexRuntimeTrustGate()
        let before = try gate.inspect(sourceURL: sourceURL)
        let canonicalURL = URL(fileURLWithPath: before.canonicalPath)
        try validateOfficialSignature(canonicalURL)

        let result = try processRunner(canonicalURL, ["--version"], 5_000)
        let version = try supportedVersion(from: result)

        let after = try gate.inspect(sourceURL: sourceURL)
        guard before == after else {
            throw CodexRuntimeTrustError.changedDuringQualification
        }
        try validateOfficialSignature(URL(fileURLWithPath: after.canonicalPath))
        return CodexPluginSetupQualifiedExecutable(
            sourceURL: URL(fileURLWithPath: after.stableSourcePath),
            canonicalURL: URL(fileURLWithPath: after.canonicalPath),
            version: version,
            trustSnapshot: after
        )
    }

    static func supportedVersion(
        from result: CodexPluginSetupProcessResult
    ) throws -> String {
        let parsed = result.stdout.count <= maximumVersionOutputBytes
            ? CodexCompatibility.parseVersionOutput(result.stdout)
            : nil
        guard result.exitCode == 0,
              let parsed,
              supportedPluginCLIVersions.contains(parsed)
        else { throw CodexRuntimeTrustError.unsupportedVersion(parsed) }
        return parsed
    }

    static func revalidate(
        _ selection: CodexPluginSetupQualifiedExecutable
    ) throws -> URL {
        guard let expected = selection.trustSnapshot,
              expected.stableSourcePath == selection.sourceURL.path,
              expected.canonicalPath == selection.canonicalURL.path,
              supportedPluginCLIVersions.contains(selection.version)
        else { throw CodexRuntimeTrustError.approvalDrift }
        let current = try CodexRuntimeTrustGate().inspect(sourceURL: selection.sourceURL)
        guard current == expected else { throw CodexRuntimeTrustError.approvalDrift }
        let executable = URL(fileURLWithPath: current.canonicalPath)
        try validateOfficialSignature(executable)
        return executable
    }

    private static func validateOfficialSignature(_ executable: URL) throws {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(
            executable as CFURL,
            SecCSFlags(),
            &code
        ) == errSecSuccess,
        let code
        else { throw CoordinatorError("codex_plugin_setup_signature_invalid") }

        var requirement: SecRequirement?
        let expression = "identifier \"\(expectedIdentifier)\" and anchor apple generic and certificate leaf[subject.OU] = \"\(expectedTeamIdentifier)\""
        guard SecRequirementCreateWithString(
            expression as CFString,
            SecCSFlags(),
            &requirement
        ) == errSecSuccess,
        let requirement
        else { throw CoordinatorError("codex_plugin_setup_signature_invalid") }
        let flags = SecCSFlags(
            rawValue: UInt32(kSecCSCheckAllArchitectures | kSecCSStrictValidate)
        )
        guard SecStaticCodeCheckValidity(code, flags, requirement) == errSecSuccess
        else { throw CoordinatorError("codex_plugin_setup_signature_invalid") }

        var information: CFDictionary?
        guard SecCodeCopySigningInformation(
            code,
            SecCSFlags(rawValue: UInt32(kSecCSSigningInformation)),
            &information
        ) == errSecSuccess,
              let dictionary = information as? [CFString: Any],
              dictionary[kSecCodeInfoIdentifier] as? String == expectedIdentifier,
              dictionary[kSecCodeInfoTeamIdentifier] as? String == expectedTeamIdentifier,
              let signedExecutable = dictionary[kSecCodeInfoMainExecutable] as? URL,
              signedExecutable.standardizedFileURL.resolvingSymlinksInPath().path
                == executable.standardizedFileURL.resolvingSymlinksInPath().path
        else { throw CoordinatorError("codex_plugin_setup_signature_invalid") }
    }
}

enum CodexPluginSetupProcessRunner {
    private static let outputLimit = 512 * 1_024
    private static let preservedEnvironmentKeys: Set<String> = [
        "HOME", "LANG", "LC_ALL", "LC_CTYPE", "LOGNAME", "PATH", "SHELL",
        "TMPDIR", "USER",
    ]

    static func run(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int
    ) throws -> CodexPluginSetupProcessResult {
        try run(
            executable: executable,
            arguments: arguments,
            timeoutMilliseconds: timeoutMilliseconds,
            environment: ProcessInfo.processInfo.environment
        )
    }

    static func run(
        executable: URL,
        arguments: [String],
        timeoutMilliseconds: Int,
        environment: [String: String]
    ) throws -> CodexPluginSetupProcessResult {
        let result = try ManagedCodexVersionProbeRunner.run(
            executable: executable,
            arguments: arguments,
            environment: sanitizedEnvironment(environment),
            timeoutMilliseconds: timeoutMilliseconds,
            outputLimit: outputLimit
        )
        return CodexPluginSetupProcessResult(
            exitCode: result.exitCode,
            stdout: result.stdout
        )
    }

    static func sanitizedEnvironment(
        _ environment: [String: String]
    ) -> [String: String] {
        environment.filter { preservedEnvironmentKeys.contains($0.key) }
    }
}

/// Serializes Plugin mutations across every running Blabee process. The lock
/// lives in Blabee's owner-only application-support directory and is itself an
/// owner-only, no-follow regular file. External `codex plugin` calls do not use
/// this lock, so destructive paths still perform a fresh ownership inspection.
final class CodexPluginSetupMutationLock: @unchecked Sendable {
    private static let registryLock = NSLock()
    private nonisolated(unsafe) static var processMutexes: [String: DispatchSemaphore] = [:]
    private static let retryDelayMicroseconds: useconds_t = 10_000

    private let lockURL: URL
    private let processMutex: DispatchSemaphore
    private let timeoutMilliseconds: Int

    init(lockURL: URL, timeoutMilliseconds: Int = 2_000) {
        self.lockURL = lockURL.standardizedFileURL
        self.timeoutMilliseconds = max(1, min(timeoutMilliseconds, 10_000))
        Self.registryLock.lock()
        if let existing = Self.processMutexes[self.lockURL.path] {
            processMutex = existing
        } else {
            let created = DispatchSemaphore(value: 1)
            Self.processMutexes[self.lockURL.path] = created
            processMutex = created
        }
        Self.registryLock.unlock()
    }

    func withLock<T>(_ operation: () throws -> T) throws -> T {
        let deadline = DispatchTime.now().uptimeNanoseconds
            + UInt64(timeoutMilliseconds) * 1_000_000
        guard processMutex.wait(
            timeout: DispatchTime(uptimeNanoseconds: deadline)
        ) == .success else {
            throw CoordinatorError("codex_plugin_setup_lock_unavailable")
        }
        defer { processMutex.signal() }

        let parentURL = lockURL.deletingLastPathComponent()
        // Descriptor traversal from `/` rejects a symlink or unsafe ownership
        // and permissions in any ancestor, rather than checking only the final
        // `runtime` component.
        let parent = try Self.openSecureParentDirectory(parentURL)
        defer { close(parent) }

        let descriptor = openat(
            parent,
            lockURL.lastPathComponent,
            O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else {
            throw CoordinatorError("codex_plugin_setup_lock_unavailable")
        }
        defer { close(descriptor) }
        let identity = try Self.requireSecureLock(descriptor)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            if errno == EINTR { continue }
            guard errno == EWOULDBLOCK || errno == EAGAIN,
                  DispatchTime.now().uptimeNanoseconds < deadline
            else {
                throw CoordinatorError("codex_plugin_setup_lock_unavailable")
            }
            usleep(Self.retryDelayMicroseconds)
        }
        defer { _ = flock(descriptor, LOCK_UN) }
        let lockedIdentity = try Self.requireSecureLock(descriptor)
        guard lockedIdentity.device == identity.device,
              lockedIdentity.inode == identity.inode
        else {
            throw CoordinatorError("codex_plugin_setup_lock_unavailable")
        }
        try Self.requireNamedLock(
            parent: parent,
            name: lockURL.lastPathComponent,
            identity: identity
        )
        return try operation()
    }

    private static func openSecureParentDirectory(_ directoryURL: URL) throws -> Int32 {
        let standardized = normalizedSystemAlias(directoryURL.standardizedFileURL.path)
        guard standardized.hasPrefix("/"), !standardized.utf8.contains(0) else {
            throw CoordinatorError("codex_plugin_setup_lock_unavailable")
        }
        let components = standardized.split(separator: "/").map(String.init)
        var descriptor = open(
            "/",
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw CoordinatorError("codex_plugin_setup_lock_unavailable")
        }
        do {
            try requireSecureAncestor(descriptor, requirePrivateOwner: false)
            for (index, component) in components.enumerated() {
                var created = false
                var next = openat(
                    descriptor,
                    component,
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                )
                if next < 0, errno == ENOENT {
                    guard mkdirat(descriptor, component, mode_t(0o700)) == 0
                            || errno == EEXIST
                    else {
                        throw CoordinatorError("codex_plugin_setup_lock_unavailable")
                    }
                    created = true
                    next = openat(
                        descriptor,
                        component,
                        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                    )
                }
                guard next >= 0 else {
                    throw CoordinatorError("codex_plugin_setup_lock_unavailable")
                }
                close(descriptor)
                descriptor = next
                try requireSecureAncestor(
                    descriptor,
                    requirePrivateOwner: created || index == components.count - 1
                )
            }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func requireSecureAncestor(
        _ descriptor: Int32,
        requirePrivateOwner: Bool
    ) throws {
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              (info.st_uid == 0 || info.st_uid == geteuid()),
              info.st_mode & 0o022 == 0,
              !requirePrivateOwner || (
                  info.st_uid == geteuid() && info.st_mode & 0o777 == 0o700
              )
        else { throw CoordinatorError("codex_plugin_setup_lock_unavailable") }
        try requireNoGrantACL(descriptor)
    }

    private static func normalizedSystemAlias(_ path: String) -> String {
        if path == "/var" { return "/private/var" }
        if path.hasPrefix("/var/") { return "/private" + path }
        if path == "/tmp" { return "/private/tmp" }
        if path.hasPrefix("/tmp/") { return "/private" + path }
        return path
    }

    private static func requireSecureLock(
        _ descriptor: Int32
    ) throws -> (device: dev_t, inode: ino_t) {
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_mode & 0o777 == 0o600,
              info.st_uid == geteuid(),
              info.st_nlink == 1
        else { throw CoordinatorError("codex_plugin_setup_lock_unavailable") }
        try requireNoGrantACL(descriptor)
        return (info.st_dev, info.st_ino)
    }

    private static func requireNoGrantACL(_ descriptor: Int32) throws {
        errno = 0
        let accessControlList = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let aclError = errno
        if let accessControlList {
            let containsGrant = blabeeExtendedACLContainsGrant(accessControlList)
            acl_free(UnsafeMutableRawPointer(accessControlList))
            guard containsGrant == false else {
                throw CoordinatorError("codex_plugin_setup_lock_unavailable")
            }
        }
        guard accessControlList != nil || aclError == ENOENT else {
            throw CoordinatorError("codex_plugin_setup_lock_unavailable")
        }
    }

    private static func requireNamedLock(
        parent: Int32,
        name: String,
        identity: (device: dev_t, inode: ino_t)
    ) throws {
        var named = stat()
        guard fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              named.st_dev == identity.device,
              named.st_ino == identity.inode
        else { throw CoordinatorError("codex_plugin_setup_lock_unavailable") }
    }
}

actor CodexPluginSetupManager: CodexPluginSetupManaging {
    static let marketplaceName = "blabee-app"
    static let pluginName = "blabee"
    static let pluginSelector = "blabee@blabee-app"
    static let standardMarketplaceRootPath = "/Applications/Blabee.app/Contents/Resources"

    private static let maximumOutputBytes = 512 * 1_024
    private static let maximumManifestBytes = 256 * 1_024
    private static let maximumCollectionCount = 256
    private static let inspectionTimeoutMilliseconds = 5_000
    private static let mutationTimeoutMilliseconds = 15_000

    private let marketplaceRoot: URL?
    private let requireStandardApplicationRoot: Bool
    private let executableQualifier: CodexPluginSetupExecutableQualifying
    private let executableRevalidator: CodexPluginSetupExecutableRevalidating
    private let processRunner: CodexPluginSetupProcessRunning
    private let bundleRevalidator: CodexPluginSetupBundleRevalidating
    private let mutationLock: CodexPluginSetupMutationLock?
    private let requiresMutationLock: Bool

    private(set) var state: CodexPluginSetupState = .unchecked

    init(
        marketplaceRoot: URL,
        requireStandardApplicationRoot: Bool = false,
        executableResolver: @escaping CodexPluginSetupExecutableResolving,
        processRunner: @escaping CodexPluginSetupProcessRunning,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating = {},
        mutationLock: CodexPluginSetupMutationLock? = nil
    ) {
        self.marketplaceRoot = marketplaceRoot
        self.requireStandardApplicationRoot = requireStandardApplicationRoot
        executableQualifier = {
            .testOnly(url: try executableResolver())
        }
        executableRevalidator = { $0.canonicalURL }
        self.processRunner = processRunner
        self.bundleRevalidator = bundleRevalidator
        self.mutationLock = mutationLock
        requiresMutationLock = false
    }

    init(
        marketplaceRoot: URL,
        requireStandardApplicationRoot: Bool = false,
        executableQualifier: @escaping CodexPluginSetupExecutableQualifying,
        executableRevalidator: @escaping CodexPluginSetupExecutableRevalidating,
        processRunner: @escaping CodexPluginSetupProcessRunning,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating = {},
        mutationLock: CodexPluginSetupMutationLock? = nil
    ) {
        self.marketplaceRoot = marketplaceRoot
        self.requireStandardApplicationRoot = requireStandardApplicationRoot
        self.executableQualifier = executableQualifier
        self.executableRevalidator = executableRevalidator
        self.processRunner = processRunner
        self.bundleRevalidator = bundleRevalidator
        self.mutationLock = mutationLock
        requiresMutationLock = false
    }

    private init(
        optionalMarketplaceRoot: URL?,
        requireStandardApplicationRoot: Bool,
        executableQualifier: @escaping CodexPluginSetupExecutableQualifying,
        executableRevalidator: @escaping CodexPluginSetupExecutableRevalidating,
        processRunner: @escaping CodexPluginSetupProcessRunning,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating,
        mutationLock: CodexPluginSetupMutationLock?,
        requiresMutationLock: Bool
    ) {
        marketplaceRoot = optionalMarketplaceRoot
        self.requireStandardApplicationRoot = requireStandardApplicationRoot
        self.executableQualifier = executableQualifier
        self.executableRevalidator = executableRevalidator
        self.processRunner = processRunner
        self.bundleRevalidator = bundleRevalidator
        self.mutationLock = mutationLock
        self.requiresMutationLock = requiresMutationLock
    }

    static func live(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> CodexPluginSetupManager {
        let processRunner: CodexPluginSetupProcessRunning = { executable, arguments, timeout in
            try CodexPluginSetupProcessRunner.run(
                executable: executable,
                arguments: arguments,
                timeoutMilliseconds: timeout,
                environment: environment
            )
        }
        let coordinatorExecutable = bundle.executableURL ?? bundle.bundleURL
            .appendingPathComponent("Contents/MacOS/blabee-coordinator", isDirectory: false)
        // Bind later disk checks to the signed identity of this running app,
        // not merely to whatever app happens to occupy /Applications when the
        // settings panel is first opened.
        let expectedBundleIdentity = try? OperationalRuntimeIdentity.requireCurrent()
        // Lock authority is tied to the OS account, not ambient HOME, so every
        // Blabee instance contends on the same file.
        let mutationLock = CodexPluginSetupMutationLock(
            lockURL: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent(
                    "Library/Application Support/Blabee/runtime",
                    isDirectory: true
                )
                .appendingPathComponent(
                    "codex-plugin-setup.lock",
                    isDirectory: false
                )
        )
        return CodexPluginSetupManager(
            optionalMarketplaceRoot: bundle.resourceURL,
            requireStandardApplicationRoot: true,
            executableQualifier: {
                let candidates = CodexPluginSetupExecutableResolver.candidateURLs(
                    environment: environment
                )
                return try CodexPluginSetupExecutableResolver.qualifyFirst(
                    candidates: candidates,
                    qualifier: { sourceURL in
                        try CodexPluginSetupProductionTrust.qualify(
                            sourceURL: sourceURL,
                            processRunner: processRunner
                        )
                    }
                )
            },
            executableRevalidator: CodexPluginSetupProductionTrust.revalidate,
            processRunner: processRunner,
            bundleRevalidator: {
                guard let expectedBundleIdentity,
                      OperationalRuntimeIdentity.installedIdentity(
                    forExecutable: coordinatorExecutable
                ) == expectedBundleIdentity
                else {
                    throw CoordinatorError("codex_plugin_setup_bundle_identity_invalid")
                }
            },
            mutationLock: mutationLock,
            requiresMutationLock: true
        )
    }

    func inspect() async -> CodexPluginSetupState {
        let inspection = performInspection()
        state = inspection.state
        return state
    }

    func connect() async -> CodexPluginSetupState {
        withMutationLock { connectWhileLocked() }
    }

    private func connectWhileLocked() -> CodexPluginSetupState {
        let initial = performInspection()
        state = initial.state

        switch initial.state {
        case .installedNeedsHookReview:
            return state
        case .notInstalled, .marketplaceInstalledNeedsPlugin:
            return connectNotInstalled(initial)
        case .updateAvailable:
            return updateOwnedPlugin(initial)
        case .unchecked, .unavailable, .conflict, .error:
            return state
        }
    }

    func disconnect() async -> CodexPluginSetupState {
        withMutationLock { disconnectWhileLocked() }
    }

    private func disconnectWhileLocked() -> CodexPluginSetupState {
        let initial = performInspection()
        state = initial.state

        switch initial.state {
        case .notInstalled:
            return state
        case .marketplaceInstalledNeedsPlugin:
            return removeOwnedMarketplace()
        case .installedNeedsHookReview, .updateAvailable:
            // Re-read ownership immediately before the first destructive call.
            // Another `codex plugin` process does not share Blabee's lock.
            let destructive = performInspection()
            let remainsOwnedInstallation: Bool
            switch destructive.state {
            case .installedNeedsHookReview, .updateAvailable:
                remainsOwnedInstallation = true
            default:
                remainsOwnedInstallation = false
            }
            guard remainsOwnedInstallation,
                  let context = destructive.context,
                  context.ownedPlugin != nil,
                  context.marketplaceIsExact
            else {
                state = destructive.state
                return state
            }
            let removal = runMutation(
                executable: context.executable,
                arguments: ["plugin", "remove", Self.pluginSelector, "--json"],
                expectation: .pluginRemoved
            )
            guard removal.succeeded else {
                state = .error(code: "plugin_remove_unverified")
                return state
            }
            let afterPluginRemoval = performInspection()
            if afterPluginRemoval.context?.ownedPlugin != nil {
                state = .error(code: "plugin_remove_not_applied")
                return state
            }
            guard case .marketplaceInstalledNeedsPlugin = afterPluginRemoval.state,
                  afterPluginRemoval.context?.marketplaceIsExact == true
            else {
                state = afterPluginRemoval.state
                return state
            }
            return removeOwnedMarketplace()
        case .unchecked, .unavailable, .conflict, .error:
            return state
        }
    }

    private func withMutationLock(
        _ operation: () -> CodexPluginSetupState
    ) -> CodexPluginSetupState {
        guard let mutationLock else {
            guard !requiresMutationLock else {
                state = .error(code: "codex_plugin_setup_lock_unavailable")
                return state
            }
            return operation()
        }
        do {
            return try mutationLock.withLock(operation)
        } catch {
            state = .error(code: "codex_plugin_setup_lock_unavailable")
            return state
        }
    }

    private func connectNotInstalled(_ initial: Inspection) -> CodexPluginSetupState {
        guard let context = initial.context else {
            state = .error(code: "inspection_context_missing")
            return state
        }

        let addedMarketplace: Bool
        if context.marketplaceIsExact {
            addedMarketplace = false
        } else {
            let addResult = runMutation(
                executable: context.executable,
                arguments: [
                    "plugin", "marketplace", "add", context.marketplaceRoot.path, "--json",
                ],
                expectation: .marketplaceAdded(root: context.marketplaceRoot)
            )
            let afterMarketplaceAdd = performInspection()
            if case .installedNeedsHookReview = afterMarketplaceAdd.state {
                state = afterMarketplaceAdd.state
                return state
            }
            guard case .marketplaceInstalledNeedsPlugin = afterMarketplaceAdd.state,
                  afterMarketplaceAdd.context?.marketplaceIsExact == true
            else {
                if case .notInstalled = afterMarketplaceAdd.state {
                    state = .error(code: addResult.succeeded
                        ? "marketplace_add_not_applied"
                        : "marketplace_add_failed")
                } else {
                    state = afterMarketplaceAdd.state
                }
                return state
            }
            guard addResult.succeeded else {
                state = .error(code: "marketplace_add_unverified")
                return state
            }
            // Only the strict Codex receipt's `alreadyAdded: false`, combined
            // with this exact post-state, authorizes bounded cleanup ownership.
            addedMarketplace = addResult.createdMarketplace
        }

        let refreshed = performInspection()
        guard case .marketplaceInstalledNeedsPlugin = refreshed.state,
              refreshed.context?.marketplaceIsExact == true,
              let executable = refreshed.context?.executable,
              let bundledVersion = refreshed.context?.bundledVersion
        else {
            state = refreshed.state
            return state
        }

        let addResult = runMutation(
            executable: executable,
            arguments: ["plugin", "add", Self.pluginSelector, "--json"],
            expectation: .pluginAdded(version: bundledVersion)
        )
        let final = performInspection()
        if case .installedNeedsHookReview = final.state {
            state = addResult.succeeded
                ? final.state
                : .error(code: "plugin_add_unverified")
            return state
        }

        if case .marketplaceInstalledNeedsPlugin = final.state {
            guard addedMarketplace else {
                state = final.state
                return state
            }
            let cleanupState = cleanupNewMarketplaceIfUnambiguous(final)
            if case .notInstalled = cleanupState {
                state = .error(code: addResult.succeeded
                    ? "plugin_add_not_applied"
                    : "plugin_add_failed")
            } else {
                state = cleanupState
            }
            return state
        }
        if !addResult.succeeded, case .notInstalled = final.state {
            state = .error(code: "plugin_add_failed")
        } else {
            state = final.state
        }
        return state
    }

    private func updateOwnedPlugin(_ initial: Inspection) -> CodexPluginSetupState {
        guard let context = initial.context,
              context.marketplaceIsExact,
              context.ownedPlugin != nil
        else {
            state = .conflict(reason: "업데이트할 Blabee Plugin의 소유권을 확인할 수 없습니다.")
            return state
        }

        let addResult = runMutation(
            executable: context.executable,
            arguments: ["plugin", "add", Self.pluginSelector, "--json"],
            expectation: .pluginAdded(version: context.bundledVersion)
        )
        let final = performInspection()
        if case .installedNeedsHookReview = final.state {
            state = addResult.succeeded
                ? final.state
                : .error(code: "plugin_update_add_unverified")
        } else {
            state = addResult.succeeded
                ? final.state
                : .error(code: "plugin_update_add_failed")
        }
        return state
    }

    private func cleanupNewMarketplaceIfUnambiguous(
        _ inspection: Inspection
    ) -> CodexPluginSetupState {
        guard case .marketplaceInstalledNeedsPlugin = inspection.state,
              let context = inspection.context,
              context.marketplaceIsExact,
              context.ownedPlugin == nil
        else { return inspection.state }

        let destructive = performInspection()
        guard case .marketplaceInstalledNeedsPlugin = destructive.state,
              let destructiveContext = destructive.context,
              destructiveContext.marketplaceIsExact,
              destructiveContext.ownedPlugin == nil
        else {
            return destructive.state
        }
        let removal = runMutation(
            executable: destructiveContext.executable,
            arguments: ["plugin", "marketplace", "remove", Self.marketplaceName, "--json"],
            expectation: .marketplaceRemoved
        )
        let final = performInspection()
        return removal.succeeded
            ? final.state
            : .error(code: "marketplace_cleanup_unverified")
    }

    private func removeOwnedMarketplace() -> CodexPluginSetupState {
        let destructive = performInspection()
        guard case .marketplaceInstalledNeedsPlugin = destructive.state,
              let context = destructive.context,
              context.marketplaceIsExact,
              context.ownedPlugin == nil
        else {
            state = destructive.state
            return state
        }
        let removal = runMutation(
            executable: context.executable,
            arguments: ["plugin", "marketplace", "remove", Self.marketplaceName, "--json"],
            expectation: .marketplaceRemoved
        )
        let final = performInspection()
        guard removal.succeeded else {
            state = .error(code: "marketplace_remove_unverified")
            return state
        }
        if case .notInstalled = final.state,
           final.context?.marketplaceIsExact == false
        {
            state = .notInstalled
        } else {
            // A zero exit without a post-state change is not success. Keep the
            // partial state actionable through retry or disconnect.
            state = final.state
        }
        return state
    }

    private func runMutation(
        executable: CodexPluginSetupQualifiedExecutable,
        arguments: [String],
        expectation: MutationExpectation
    ) -> MutationResult {
        let result: CodexPluginSetupProcessResult
        do {
            try bundleRevalidator()
            let revalidated = try revalidatedExecutable(executable)
            // The executable check may be comparatively expensive. Re-check
            // the app payload immediately before Codex consumes its local
            // Marketplace path, then verify both subjects again afterwards.
            try bundleRevalidator()
            result = try processRunner(
                revalidated,
                arguments,
                Self.mutationTimeoutMilliseconds
            )
            _ = try revalidatedExecutable(executable)
            try bundleRevalidator()
        } catch {
            return .failed
        }
        guard result.exitCode == 0,
              !result.stdout.isEmpty,
              result.stdout.count <= Self.maximumOutputBytes,
              let object = try? StrictJSONTransport.object(
                from: result.stdout,
                limits: StrictJSONLimits(
                    maximumBytes: Self.maximumOutputBytes,
                    maximumDepth: 24
                )
              )
        else { return .failed }

        switch expectation {
        case let .marketplaceAdded(root):
            guard boundedString(object["marketplaceName"], maximumBytes: 256)
                    == Self.marketplaceName,
                  let installedRoot = boundedAbsoluteURL(object["installedRoot"]),
                  normalizedPath(installedRoot) == normalizedPath(root),
                  let alreadyAdded = strictBoolean(object["alreadyAdded"])
            else { return .failed }
            return MutationResult(
                succeeded: true,
                // Codex 0.152.1 reports whether add was idempotent. Only an
                // exact `alreadyAdded: false` receipt can authorize rollback.
                createdMarketplace: !alreadyAdded
            )
        case let .pluginAdded(version):
            guard boundedString(object["pluginId"], maximumBytes: 512)
                    == Self.pluginSelector,
                  boundedString(object["version"], maximumBytes: 128) == version
            else { return .failed }
        case .pluginRemoved:
            guard boundedString(object["pluginId"], maximumBytes: 512)
                    == Self.pluginSelector
            else { return .failed }
        case .marketplaceRemoved:
            guard boundedString(object["marketplaceName"], maximumBytes: 256)
                    == Self.marketplaceName
            else { return .failed }
        }
        return MutationResult(succeeded: true, createdMarketplace: false)
    }

    private func performInspection() -> Inspection {
        let configuration: BundledConfiguration
        do {
            configuration = try bundledConfiguration()
        } catch let error as CoordinatorError {
            return Inspection(state: .unavailable(reason: error.message), context: nil)
        } catch {
            return Inspection(
                state: .unavailable(reason: "Blabee 앱의 Plugin 리소스를 확인할 수 없습니다."),
                context: nil
            )
        }

        let executable: CodexPluginSetupQualifiedExecutable
        do {
            executable = try executableQualifier()
        } catch {
            return Inspection(
                state: .unavailable(reason: "안전하고 지원되는 Codex CLI를 찾을 수 없습니다."),
                context: nil
            )
        }

        let marketplaces: [MarketplaceRecord]
        do {
            marketplaces = try queryMarketplaces(executable: executable)
        } catch let error as CoordinatorError {
            return Inspection(state: .error(code: error.code), context: nil)
        } catch {
            return Inspection(state: .error(code: "marketplace_list_failed"), context: nil)
        }

        let plugins: [PluginRecord]
        do {
            plugins = try queryInstalledPlugins(executable: executable)
        } catch let error as CoordinatorError {
            return Inspection(state: .error(code: error.code), context: nil)
        } catch {
            return Inspection(state: .error(code: "plugin_list_failed"), context: nil)
        }

        let namedMarketplaces = marketplaces.filter { $0.name == Self.marketplaceName }
        guard namedMarketplaces.count <= 1 else {
            return Inspection(
                state: .conflict(reason: "blabee-app Marketplace 항목이 중복되어 있습니다."),
                context: nil
            )
        }
        let marketplaceIsExact: Bool
        if let marketplace = namedMarketplaces.first {
            guard normalizedPath(marketplace.root) == normalizedPath(configuration.marketplaceRoot) else {
                return Inspection(
                    state: .conflict(reason: "같은 blabee-app 이름이 다른 경로에 연결되어 있습니다."),
                    context: nil
                )
            }
            marketplaceIsExact = true
        } else {
            marketplaceIsExact = false
        }

        let blabeePlugins = plugins.filter {
            $0.name == Self.pluginName
                || $0.pluginID == Self.pluginSelector
                || $0.pluginID.hasPrefix("\(Self.pluginName)@")
        }

        let foreignMarketplacePlugins = plugins.filter { plugin in
            plugin.marketplaceName == Self.marketplaceName
                && !isExactOwnedPlugin(
                    plugin,
                    marketplaceIsExact: marketplaceIsExact,
                    pluginRoot: configuration.pluginRoot
                )
        }
        guard foreignMarketplacePlugins.isEmpty else {
            return Inspection(
                state: .conflict(
                    reason: "blabee-app Marketplace에 다른 Plugin이 연결되어 있어 자동 변경하지 않습니다."
                ),
                context: nil
            )
        }
        guard blabeePlugins.count <= 1 else {
            return Inspection(
                state: .conflict(reason: "여러 Blabee Plugin 설치가 발견되어 자동 변경하지 않습니다."),
                context: nil
            )
        }

        var ownedPlugin: PluginRecord?
        if let plugin = blabeePlugins.first {
            guard isExactOwnedPlugin(
                plugin,
                marketplaceIsExact: marketplaceIsExact,
                pluginRoot: configuration.pluginRoot
            )
            else {
                return Inspection(
                    state: .conflict(reason: "기존 Blabee Plugin이 다른 Marketplace 또는 경로를 사용합니다."),
                    context: nil
                )
            }
            ownedPlugin = plugin
        }

        let context = InspectionContext(
            executable: executable,
            marketplaceRoot: configuration.marketplaceRoot,
            bundledVersion: configuration.pluginVersion,
            marketplaceIsExact: marketplaceIsExact,
            ownedPlugin: ownedPlugin
        )
        guard let ownedPlugin else {
            return Inspection(
                state: marketplaceIsExact
                    ? .marketplaceInstalledNeedsPlugin
                    : .notInstalled,
                context: context
            )
        }
        guard ownedPlugin.version == configuration.pluginVersion,
              ownedPlugin.enabled
        else {
            return Inspection(
                state: .updateAvailable(
                    installedVersion: ownedPlugin.version,
                    bundledVersion: configuration.pluginVersion
                ),
                context: context
            )
        }
        return Inspection(
            state: .installedNeedsHookReview(version: ownedPlugin.version),
            context: context
        )
    }

    private func isExactOwnedPlugin(
        _ plugin: PluginRecord,
        marketplaceIsExact: Bool,
        pluginRoot: URL
    ) -> Bool {
        marketplaceIsExact
            && plugin.pluginID == Self.pluginSelector
            && plugin.name == Self.pluginName
            && plugin.marketplaceName == Self.marketplaceName
            && plugin.installed
            && plugin.sourceKind == "local"
            && normalizedPath(plugin.sourcePath) == normalizedPath(pluginRoot)
    }

    private func bundledConfiguration() throws -> BundledConfiguration {
        guard let marketplaceRoot else {
            throw CoordinatorError(
                "codex_plugin_setup_resources_unavailable",
                "Blabee 앱의 Resources 경로를 찾을 수 없습니다."
            )
        }
        let root = marketplaceRoot.standardizedFileURL
        guard root.isFileURL, root.path.hasPrefix("/") else {
            throw CoordinatorError(
                "codex_plugin_setup_resources_invalid",
                "Blabee 앱의 Resources 경로가 올바르지 않습니다."
            )
        }
        if requireStandardApplicationRoot,
           root.path != Self.standardMarketplaceRootPath
        {
            throw CoordinatorError(
                "codex_plugin_setup_nonstandard_app_location",
                "Blabee를 /Applications 폴더로 옮긴 뒤 다시 연결하세요."
            )
        }

        let pluginRoot = root.appendingPathComponent("Plugin/blabee", isDirectory: true)
        let marketplaceManifest = root
            .appendingPathComponent(".agents/plugins/marketplace.json", isDirectory: false)
        let pluginManifest = pluginRoot
            .appendingPathComponent(".codex-plugin/plugin.json", isDirectory: false)

        let marketplace = try strictObject(fromFile: marketplaceManifest)
        guard marketplace["name"] as? String == Self.marketplaceName,
              let pluginEntries = marketplace["plugins"] as? [Any],
              pluginEntries.count == 1,
              let plugin = pluginEntries.first as? [String: Any],
              plugin["name"] as? String == Self.pluginName,
              let source = plugin["source"] as? [String: Any],
              source["source"] as? String == "local",
              source["path"] as? String == "./Plugin/blabee"
        else {
            throw CoordinatorError(
                "codex_plugin_setup_marketplace_manifest_invalid",
                "Blabee 앱의 Marketplace 구성이 올바르지 않습니다."
            )
        }

        let manifest = try strictObject(fromFile: pluginManifest)
        guard manifest["name"] as? String == Self.pluginName,
              let version = boundedString(manifest["version"], maximumBytes: 64),
              !version.isEmpty,
              canonicalPath(pluginRoot).hasPrefix(canonicalPath(root) + "/")
        else {
            throw CoordinatorError(
                "codex_plugin_setup_plugin_manifest_invalid",
                "Blabee 앱의 Plugin 구성이 올바르지 않습니다."
            )
        }
        return BundledConfiguration(
            marketplaceRoot: root,
            pluginRoot: pluginRoot,
            pluginVersion: version
        )
    }

    private func queryMarketplaces(
        executable: CodexPluginSetupQualifiedExecutable
    ) throws -> [MarketplaceRecord] {
        let object = try queryObject(
            executable: executable,
            arguments: ["plugin", "marketplace", "list", "--json"],
            failureCode: "marketplace_list_failed"
        )
        guard let entries = object["marketplaces"] as? [Any],
              entries.count <= Self.maximumCollectionCount
        else { throw CoordinatorError("marketplace_list_malformed") }
        return try entries.map { value in
            guard let entry = value as? [String: Any],
                  let name = boundedString(entry["name"], maximumBytes: 256),
                  let root = boundedAbsoluteURL(entry["root"])
            else { throw CoordinatorError("marketplace_list_malformed") }
            return MarketplaceRecord(name: name, root: root)
        }
    }

    private func queryInstalledPlugins(
        executable: CodexPluginSetupQualifiedExecutable
    ) throws -> [PluginRecord] {
        let object = try queryObject(
            executable: executable,
            arguments: ["plugin", "list", "--json"],
            failureCode: "plugin_list_failed"
        )
        guard let entries = object["installed"] as? [Any],
              entries.count <= Self.maximumCollectionCount
        else { throw CoordinatorError("plugin_list_malformed") }
        return try entries.map { value in
            guard let entry = value as? [String: Any],
                  let pluginID = boundedString(entry["pluginId"], maximumBytes: 512),
                  let name = boundedString(entry["name"], maximumBytes: 256),
                  let marketplaceName = boundedString(
                    entry["marketplaceName"], maximumBytes: 256
                  ),
                  let version = boundedString(entry["version"], maximumBytes: 128),
                  let installed = strictBoolean(entry["installed"]),
                  let enabled = strictBoolean(entry["enabled"]),
                  let source = entry["source"] as? [String: Any],
                  let sourceKind = boundedString(source["source"], maximumBytes: 64),
                  let sourcePath = boundedAbsoluteURL(source["path"])
            else { throw CoordinatorError("plugin_list_malformed") }
            return PluginRecord(
                pluginID: pluginID,
                name: name,
                marketplaceName: marketplaceName,
                version: version,
                installed: installed,
                enabled: enabled,
                sourceKind: sourceKind,
                sourcePath: sourcePath
            )
        }
    }

    private func queryObject(
        executable: CodexPluginSetupQualifiedExecutable,
        arguments: [String],
        failureCode: String
    ) throws -> [String: Any] {
        let result: CodexPluginSetupProcessResult
        do {
            let revalidated = try revalidatedExecutable(executable)
            result = try processRunner(
                revalidated,
                arguments,
                Self.inspectionTimeoutMilliseconds
            )
            _ = try revalidatedExecutable(executable)
        } catch {
            throw CoordinatorError(failureCode)
        }
        guard result.exitCode == 0,
              !result.stdout.isEmpty,
              result.stdout.count <= Self.maximumOutputBytes
        else { throw CoordinatorError(failureCode) }
        do {
            return try StrictJSONTransport.object(
                from: result.stdout,
                limits: StrictJSONLimits(
                    maximumBytes: Self.maximumOutputBytes,
                    maximumDepth: 24
                )
            )
        } catch {
            throw CoordinatorError("\(failureCode.replacingOccurrences(of: "_failed", with: ""))_malformed")
        }
    }

    private func revalidatedExecutable(
        _ selection: CodexPluginSetupQualifiedExecutable
    ) throws -> URL {
        let executable = try executableRevalidator(selection)
        guard canonicalPath(executable) == canonicalPath(selection.canonicalURL)
        else { throw CodexRuntimeTrustError.approvalDrift }
        return executable
    }

    private func strictObject(fromFile url: URL) throws -> [String: Any] {
        let data = try boundedFileData(url, maximumBytes: Self.maximumManifestBytes)
        return try StrictJSONTransport.object(
            from: data,
            limits: StrictJSONLimits(
                maximumBytes: Self.maximumManifestBytes,
                maximumDepth: 24
            )
        )
    }

    private func boundedFileData(_ url: URL, maximumBytes: Int) throws -> Data {
        guard url.isFileURL,
              url.path.hasPrefix("/"),
              !url.path.utf8.contains(0),
              maximumBytes > 0
        else { throw CoordinatorError("codex_plugin_setup_manifest_unavailable") }

        let descriptor = open(
            url.path,
            O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw CoordinatorError("codex_plugin_setup_manifest_unavailable")
        }
        defer { close(descriptor) }

        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_size >= 0,
              UInt64(info.st_size) <= UInt64(maximumBytes)
        else { throw CoordinatorError("codex_plugin_setup_manifest_unavailable") }

        var data = Data()
        data.reserveCapacity(Int(info.st_size))
        var buffer = [UInt8](repeating: 0, count: min(16_384, maximumBytes + 1))
        while true {
            errno = 0
            let count = buffer.withUnsafeMutableBytes { bytes in
                read(descriptor, bytes.baseAddress, bytes.count)
            }
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw CoordinatorError("codex_plugin_setup_manifest_unavailable")
            }
            guard count <= maximumBytes - data.count else {
                throw CoordinatorError("codex_plugin_setup_manifest_unavailable")
            }
            data.append(contentsOf: buffer.prefix(count))
        }
        guard !data.isEmpty else {
            throw CoordinatorError("codex_plugin_setup_manifest_unavailable")
        }
        return data
    }

    private func boundedString(_ value: Any?, maximumBytes: Int) -> String? {
        guard let value = value as? String,
              !value.contains("\0"),
              value.utf8.count <= maximumBytes
        else { return nil }
        return value
    }

    private func strictBoolean(_ value: Any?) -> Bool? {
        guard let value else { return nil }
        let object = value as AnyObject
        guard CFGetTypeID(object) == CFBooleanGetTypeID() else { return nil }
        return (object as? NSNumber)?.boolValue
    }

    private func boundedAbsoluteURL(_ value: Any?) -> URL? {
        guard let path = boundedString(value, maximumBytes: 4_096),
              path.hasPrefix("/"),
              !path.contains("\n"),
              !path.contains("\r")
        else { return nil }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.path == path || url.path == String(path.dropLast(path.hasSuffix("/") ? 1 : 0))
        else { return nil }
        return url
    }

    private func canonicalPath(_ url: URL) -> String {
        url.standardizedFileURL.resolvingSymlinksInPath().standardizedFileURL.path
    }

    private func normalizedPath(_ url: URL) -> String {
        url.standardizedFileURL.path
    }

    private struct BundledConfiguration {
        let marketplaceRoot: URL
        let pluginRoot: URL
        let pluginVersion: String
    }

    private enum MutationExpectation {
        case marketplaceAdded(root: URL)
        case pluginAdded(version: String)
        case pluginRemoved
        case marketplaceRemoved
    }

    private struct MutationResult {
        static let failed = MutationResult(
            succeeded: false,
            createdMarketplace: false
        )

        let succeeded: Bool
        let createdMarketplace: Bool
    }

    private struct MarketplaceRecord {
        let name: String
        let root: URL
    }

    private struct PluginRecord {
        let pluginID: String
        let name: String
        let marketplaceName: String
        let version: String
        let installed: Bool
        let enabled: Bool
        let sourceKind: String
        let sourcePath: URL
    }

    private struct InspectionContext {
        let executable: CodexPluginSetupQualifiedExecutable
        let marketplaceRoot: URL
        let bundledVersion: String
        let marketplaceIsExact: Bool
        let ownedPlugin: PluginRecord?
    }

    private struct Inspection {
        let state: CodexPluginSetupState
        let context: InspectionContext?
    }
}
