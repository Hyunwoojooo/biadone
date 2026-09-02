import CoordinatorSwift
import Darwin
import Foundation

/// A process-local managed Codex selection. Only the private pinned copy is
/// exposed to App Server, TUI, and fallback child spawns.
struct ManagedCodexApprovedSelection: Sendable {
    fileprivate let pin: ManagedCodexPinnedRuntimeBundle
    let executable: CodexRuntimeApprovedExecutable
}

private struct ManagedCodexFileObjectIdentity: Hashable, Sendable {
    let device: UInt64
    let inode: UInt64

    init(_ identity: CodexRuntimeFileIdentity) {
        device = identity.device
        inode = identity.inode
    }

    init(_ info: stat) {
        device = UInt64(bitPattern: Int64(info.st_dev))
        inode = UInt64(info.st_ino)
    }
}

/// Environment accepted by the explicit managed execution boundary. Dynamic
/// loader overrides would make the inspected Mach-O and the executed program
/// different trust subjects, so managed mode rejects them instead of silently
/// changing the user's default `codex` environment.
enum ManagedCodexLaunchEnvironment {
    private static let loaderOverridePrefixes = [
        "DYLD_",
        "__XPC_DYLD_",
        "LD_",
    ]

    static func validated(
        _ environment: [String: String]
    ) throws -> [String: String] {
        for (name, value) in environment {
            guard !name.isEmpty,
                  !name.utf8.contains(0),
                  !name.contains("="),
                  !value.utf8.contains(0),
                  !loaderOverridePrefixes.contains(where: name.hasPrefix)
            else {
                throw CoordinatorError("managed_codex_environment_unsafe")
            }
        }
        return environment
    }
}

/// Resolves Codex only for an explicit `blabee-codex` invocation.
///
/// Candidate order is authoritative. Missing entries are skipped, but the
/// first existing entry either qualifies or fails closed. This prevents an
/// unsafe or unsupported PATH entry from silently selecting another install.
struct ManagedCodexTrustResolver: Sendable {
    private let candidateURLs: [URL]
    private let excludedCanonicalPaths: Set<String>
    private let excludedFileObjects: Set<ManagedCodexFileObjectIdentity>
    private let trustGate: CodexRuntimeTrustGate
    private let runtimeExecutableVerification:
        ManagedCodexRuntimeExecutableVerification
    private let pinParentURL: URL
    private let versionReader: @Sendable (URL) throws -> String?

    init(
        candidateURLs: [URL],
        excludedExecutableURLs: [URL] = [],
        dynamicShimRootURLs: [URL] = [],
        monitoredEntries: [CodexRuntimeMonitoredEntry] =
            CodexRuntimeTrustGate.standardHomebrewEntries,
        runtimeExecutableVerification:
            ManagedCodexRuntimeExecutableVerification? = nil,
        pinParentURL: URL = FileManager.default.temporaryDirectory,
        versionReader: @escaping @Sendable (URL) throws -> String?
    ) {
        var seen = Set<String>()
        self.candidateURLs = candidateURLs.compactMap { candidate in
            guard let stable = try? Self.normalizedStableSourceURL(candidate),
                  seen.insert(stable.path).inserted
            else { return nil }
            return stable
        }
        excludedCanonicalPaths = Set(excludedExecutableURLs.compactMap {
            Self.canonicalPathIfPresent($0)
        })
        excludedFileObjects = Set(excludedExecutableURLs.compactMap {
            Self.followingFileObjectIdentityIfPresent($0)
        })
        trustGate = CodexRuntimeTrustGate(
            monitoredEntries: monitoredEntries,
            dynamicShimRootURLs: dynamicShimRootURLs
        )
        #if DEBUG
            self.runtimeExecutableVerification = runtimeExecutableVerification
                ?? (monitoredEntries.isEmpty ? .trustedTestFixture : .production)
        #else
            self.runtimeExecutableVerification = runtimeExecutableVerification
                ?? .production
        #endif
        self.pinParentURL = pinParentURL
        self.versionReader = versionReader
    }

    static func live(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        pinParentURL: URL = FileManager.default.temporaryDirectory,
        runtimeExecutableVerification:
            ManagedCodexRuntimeExecutableVerification = .production,
        versionReader: (@Sendable (URL) throws -> String?)? = nil
    ) throws -> ManagedCodexTrustResolver {
        let launchEnvironment = try ManagedCodexLaunchEnvironment.validated(
            environment
        )
        guard let rawHome = launchEnvironment["HOME"], rawHome.hasPrefix("/"),
              !rawHome.utf8.contains(0),
              let coordinatorURL = bundle.executableURL
        else {
            throw CoordinatorError("managed_codex_executable_unavailable")
        }
        guard let resolvedHome = realpath(rawHome, nil) else {
            throw CoordinatorError("managed_codex_executable_unavailable")
        }
        defer { free(resolvedHome) }
        let homeURL = URL(
            fileURLWithPath: String(cString: resolvedHome),
            isDirectory: true
        )
        var excluded = [coordinatorURL]
        if let rawCoordinator = launchEnvironment["BLABEE_COORDINATOR_BINARY"],
           rawCoordinator.hasPrefix("/"), !rawCoordinator.utf8.contains(0)
        {
            excluded.append(URL(fileURLWithPath: rawCoordinator, isDirectory: false))
        }
        let effectiveVersionReader = versionReader ?? { executable in
            var probeEnvironment = launchEnvironment
            probeEnvironment["CODEX_CODE_MODE_HOST_PATH"] = executable
                .deletingLastPathComponent()
                .appendingPathComponent(
                    "codex-code-mode-host",
                    isDirectory: false
                ).path
            return try readCodexVersion(
                executable,
                environment: probeEnvironment
            )
        }
        return ManagedCodexTrustResolver(
            candidateURLs: candidateURLs(
                environment: launchEnvironment,
                homeURL: homeURL
            ),
            excludedExecutableURLs: excluded,
            dynamicShimRootURLs: dynamicShimRootURLs(
                environment: launchEnvironment,
                homeURL: homeURL
            ),
            runtimeExecutableVerification: runtimeExecutableVerification,
            pinParentURL: pinParentURL,
            versionReader: effectiveVersionReader
        )
    }

    func resolveApproved() throws -> ManagedCodexApprovedSelection {
        for sourceURL in candidateURLs {
            var named = stat()
            guard lstat(sourceURL.path, &named) == 0 else {
                if errno == ENOENT { continue }
                throw CodexRuntimeTrustError.invalidSource(
                    "candidate cannot be inspected at \(sourceURL.path)"
                )
            }

            // From the first existing candidate onward there is no fallback.
            // Inspection performs no process launch and must finish before the
            // exact device/inode exclusion and native-format checks.
            let inspected = try trustGate.inspect(sourceURL: sourceURL)
            guard !isExcluded(inspected) else {
                throw CodexRuntimeTrustError.invalidSource(
                    "managed Codex candidate is the running coordinator executable"
                )
            }

            let runtime = try ManagedCodexRuntimeBundleInspector.inspect(
                executableURL: URL(fileURLWithPath: inspected.canonicalPath),
                expectedExecutableIdentity: inspected.targetIdentity,
                executableVerification: runtimeExecutableVerification
            )
            try ManagedCodexRuntimeBundleQualificationCatalog.requireQualified(
                runtime
            )
            let pin = try ManagedCodexPinnedRuntimeBundle.create(
                from: runtime,
                parentURL: pinParentURL
            )
            let approval = try trustGate.qualify(sourceURL: sourceURL) { _ in
                // The only version process executes the private inode copy,
                // never the group-writable package-manager source path.
                try versionReader(pin.executableURL)
            }
            guard approval.snapshot == inspected else {
                throw CodexRuntimeTrustError.changedDuringQualification
            }
            guard runtime.manifest.version == approval.qualifiedVersion else {
                throw ManagedCodexRuntimeBundleError.versionMismatch(
                    manifest: runtime.manifest.version,
                    qualified: approval.qualifiedVersion
                )
            }
            let executable = try pin.revalidate(
                qualifiedVersion: approval.qualifiedVersion
            )
            return ManagedCodexApprovedSelection(pin: pin, executable: executable)
        }
        throw CoordinatorError("managed_codex_executable_unavailable")
    }

    func revalidate(
        _ selection: ManagedCodexApprovedSelection
    ) throws -> CodexRuntimeApprovedExecutable {
        let current = try selection.pin.revalidate(
            qualifiedVersion: selection.executable.qualifiedVersion
        )
        guard current == selection.executable else {
            throw CodexRuntimeTrustError.approvalDrift
        }
        return current
    }

    private func isExcluded(_ snapshot: CodexRuntimeTrustSnapshot) -> Bool {
        excludedCanonicalPaths.contains(snapshot.canonicalPath)
            || excludedFileObjects.contains(
                ManagedCodexFileObjectIdentity(snapshot.targetIdentity)
            )
    }

    private static func canonicalPathIfPresent(_ url: URL) -> String? {
        guard url.isFileURL, let resolved = realpath(url.path, nil) else {
            return nil
        }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    private static func followingFileObjectIdentityIfPresent(
        _ url: URL
    ) -> ManagedCodexFileObjectIdentity? {
        guard url.isFileURL else { return nil }
        var info = stat()
        guard stat(url.path, &info) == 0 else { return nil }
        return ManagedCodexFileObjectIdentity(info)
    }

    private static func candidateURLs(
        environment: [String: String],
        homeURL: URL
    ) -> [URL] {
        var candidates: [URL] = []
        for entry in (environment["PATH"] ?? "").split(
            separator: ":",
            omittingEmptySubsequences: false
        ) {
            let path = String(entry)
            guard path.hasPrefix("/"), !path.utf8.contains(0) else { continue }
            candidates.append(
                URL(fileURLWithPath: path, isDirectory: true)
                    .appendingPathComponent("codex", isDirectory: false)
            )
        }
        if let nvmBin = environment["NVM_BIN"],
           nvmBin.hasPrefix("/"), !nvmBin.utf8.contains(0)
        {
            candidates.append(
                URL(fileURLWithPath: nvmBin, isDirectory: true)
                    .appendingPathComponent("codex", isDirectory: false)
            )
        }
        candidates.append(
            homeURL.appendingPathComponent(".local/bin/codex", isDirectory: false)
        )
        candidates.append(contentsOf: safeNVMVersionCandidates(homeURL: homeURL))
        candidates.append(URL(fileURLWithPath: "/opt/homebrew/bin/codex"))
        candidates.append(URL(fileURLWithPath: "/usr/local/bin/codex"))
        return candidates
    }

    static func safeNVMVersionCandidates(homeURL: URL) -> [URL] {
        let versions = homeURL.appendingPathComponent(
            ".nvm/versions/node",
            isDirectory: true
        )
        guard isSafeOwnedDirectory(versions),
              let entries = try? FileManager.default.contentsOfDirectory(
                at: versions,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
              )
        else { return [] }
        let versionCandidates: [(
            url: URL,
            version: (major: UInt64, minor: UInt64, patch: UInt64)
        )] = entries.compactMap { versionURL -> (
            url: URL,
            version: (major: UInt64, minor: UInt64, patch: UInt64)
        )? in
            let binURL = versionURL.appendingPathComponent(
                "bin",
                isDirectory: true
            )
            guard isSafeOwnedDirectory(versionURL),
                  isSafeOwnedDirectory(binURL),
                  let version = nvmVersion(
                    directoryName: versionURL.lastPathComponent
                  )
            else { return nil }
            return (versionURL, version)
        }
        return versionCandidates
            .sorted { lhs, rhs in
                if lhs.version.major != rhs.version.major {
                    return lhs.version.major > rhs.version.major
                }
                if lhs.version.minor != rhs.version.minor {
                    return lhs.version.minor > rhs.version.minor
                }
                return lhs.version.patch > rhs.version.patch
            }
            .map {
                $0.url.appendingPathComponent("bin/codex", isDirectory: false)
            }
    }

    private static func nvmVersion(
        directoryName: String
    ) -> (major: UInt64, minor: UInt64, patch: UInt64)? {
        guard directoryName.first == "v" else { return nil }
        let components = directoryName.dropFirst().split(
            separator: ".",
            omittingEmptySubsequences: false
        )
        guard components.count == 3 else { return nil }
        var values: [UInt64] = []
        values.reserveCapacity(3)
        for component in components {
            guard !component.isEmpty,
                  component.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let value = UInt64(component),
                  String(value) == component
            else { return nil }
            values.append(value)
        }
        return (values[0], values[1], values[2])
    }

    private static func isSafeOwnedDirectory(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0
            && info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && info.st_uid == geteuid()
            && info.st_mode & 0o022 == 0
    }

    private static func dynamicShimRootURLs(
        environment: [String: String],
        homeURL: URL
    ) -> [URL] {
        var roots = [
            homeURL.appendingPathComponent(".asdf/shims", isDirectory: true),
            homeURL.appendingPathComponent(".volta/bin", isDirectory: true),
        ]
        if let asdfData = environment["ASDF_DATA_DIR"],
           asdfData.hasPrefix("/"), !asdfData.utf8.contains(0)
        {
            roots.append(
                URL(fileURLWithPath: asdfData, isDirectory: true)
                    .appendingPathComponent("shims", isDirectory: true)
            )
        }
        if let voltaHome = environment["VOLTA_HOME"],
           voltaHome.hasPrefix("/"), !voltaHome.utf8.contains(0)
        {
            roots.append(
                URL(fileURLWithPath: voltaHome, isDirectory: true)
                    .appendingPathComponent("bin", isDirectory: true)
            )
        }
        return roots
    }

    private static func normalizedStableSourceURL(_ url: URL) throws -> URL {
        guard url.isFileURL else {
            throw CodexRuntimeTrustError.invalidSource("candidate must be a file URL")
        }
        let path = url.path
        let components = path.split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        guard path.hasPrefix("/"), !path.utf8.contains(0),
              components.first?.isEmpty == true,
              components.dropFirst().allSatisfy({
                !$0.isEmpty && $0 != "." && $0 != ".."
              }),
              !url.lastPathComponent.isEmpty
        else {
            throw CodexRuntimeTrustError.invalidSource(
                "candidate path must be absolute and normalized"
            )
        }
        return url
    }

    static func readCodexVersion(
        _ url: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> String? {
        let result = try ManagedCodexVersionProbeRunner.run(
            executable: url,
            arguments: ["--version"],
            environment: environment,
            timeoutMilliseconds: 5_000
        )
        guard result.exitCode == 0 else { return nil }
        return CodexCompatibility.parseVersionOutput(result.stdout)
    }
}

struct ManagedCodexVersionProbeResult: Sendable {
    let exitCode: Int32
    let stdout: Data
    let stderr: Data
}

/// Runs only the managed Codex version probe. The child starts in its own
/// session, output is drained without waiting for pipe EOF, and every exit path
/// terminates remaining group members. Timeout and output-limit failures own
/// the entire process group through TERM, KILL, and direct-child reaping.
enum ManagedCodexVersionProbeRunner {
    private static let outputLimit = 64 * 1_024
    private static let drainIntervalMicroseconds: useconds_t = 5_000
    private static let terminationGraceMilliseconds = 250

    private struct BoundedCapture {
        var data = Data()
        var exceededLimit = false

        mutating func drain(_ descriptor: Int32) throws {
            var buffer = [UInt8](repeating: 0, count: 16 * 1_024)
            while true {
                let count = buffer.withUnsafeMutableBytes { bytes in
                    Darwin.read(descriptor, bytes.baseAddress, bytes.count)
                }
                if count > 0 {
                    let remaining = max(0, outputLimit - data.count)
                    let retained = min(count, remaining)
                    if retained > 0 {
                        data.append(contentsOf: buffer.prefix(retained))
                    }
                    if count > remaining {
                        exceededLimit = true
                        return
                    }
                    continue
                }
                if count == 0 { return }
                if errno == EINTR { continue }
                if errno == EAGAIN || errno == EWOULDBLOCK { return }
                throw CoordinatorError("managed_codex_version_probe_output_invalid")
            }
        }
    }

    static func run(
        executable: URL,
        arguments: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment,
        timeoutMilliseconds: Int
    ) throws -> ManagedCodexVersionProbeResult {
        guard executable.isFileURL, executable.path.hasPrefix("/"),
              !executable.path.utf8.contains(0)
        else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }

        let launchEnvironment = try ManagedCodexLaunchEnvironment.validated(
            environment
        )
        var outputDescriptors = [Int32](repeating: -1, count: 2)
        var errorDescriptors = [Int32](repeating: -1, count: 2)
        guard pipe(&outputDescriptors) == 0 else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }
        guard pipe(&errorDescriptors) == 0 else {
            close(outputDescriptors[0])
            close(outputDescriptors[1])
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }
        defer {
            close(outputDescriptors[0])
            close(outputDescriptors[1])
            close(errorDescriptors[0])
            close(errorDescriptors[1])
        }
        for descriptor in [outputDescriptors[0], errorDescriptors[0]] {
            let flags = fcntl(descriptor, F_GETFL)
            guard flags >= 0,
                  fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0
            else {
                throw CoordinatorError(
                    "managed_codex_version_probe_unavailable"
                )
            }
        }

        let nullDescriptor = open("/dev/null", O_RDONLY | O_CLOEXEC)
        guard nullDescriptor >= 0 else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }
        defer { close(nullDescriptor) }

        var fileActions: posix_spawn_file_actions_t?
        guard posix_spawn_file_actions_init(&fileActions) == 0 else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }
        defer { posix_spawn_file_actions_destroy(&fileActions) }
        let actionResults = [
            posix_spawn_file_actions_adddup2(
                &fileActions,
                nullDescriptor,
                STDIN_FILENO
            ),
            posix_spawn_file_actions_adddup2(
                &fileActions,
                outputDescriptors[1],
                STDOUT_FILENO
            ),
            posix_spawn_file_actions_adddup2(
                &fileActions,
                errorDescriptors[1],
                STDERR_FILENO
            ),
            posix_spawn_file_actions_addclose(
                &fileActions,
                outputDescriptors[0]
            ),
            posix_spawn_file_actions_addclose(
                &fileActions,
                errorDescriptors[0]
            ),
            posix_spawn_file_actions_addclose(
                &fileActions,
                outputDescriptors[1]
            ),
            posix_spawn_file_actions_addclose(
                &fileActions,
                errorDescriptors[1]
            ),
            posix_spawn_file_actions_addclose(&fileActions, nullDescriptor),
        ]
        guard actionResults.allSatisfy({ $0 == 0 }) else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }

        var attributes: posix_spawnattr_t?
        guard posix_spawnattr_init(&attributes) == 0 else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }
        defer { posix_spawnattr_destroy(&attributes) }
        guard posix_spawnattr_setflags(
            &attributes,
            Int16(POSIX_SPAWN_SETSID | POSIX_SPAWN_CLOEXEC_DEFAULT)
        ) == 0 else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }

        let argumentStrings = [executable.path] + arguments
        var argumentPointers = argumentStrings.map { strdup($0) }
        guard argumentPointers.allSatisfy({ $0 != nil }) else {
            argumentPointers.forEach { free($0) }
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }
        argumentPointers.append(nil)
        defer { argumentPointers.dropLast().forEach { free($0) } }
        let environmentStrings = launchEnvironment.keys.sorted().map {
            "\($0)=\(launchEnvironment[$0]!)"
        }
        var environmentPointers = environmentStrings.map { strdup($0) }
        guard environmentPointers.allSatisfy({ $0 != nil }) else {
            environmentPointers.forEach { free($0) }
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }
        environmentPointers.append(nil)
        defer { environmentPointers.dropLast().forEach { free($0) } }

        var childPID = pid_t()
        let spawnResult = executable.path.withCString { executablePath in
            argumentPointers.withUnsafeMutableBufferPointer { argumentsBuffer in
                environmentPointers.withUnsafeMutableBufferPointer {
                    environmentBuffer in
                    posix_spawn(
                        &childPID,
                        executablePath,
                        &fileActions,
                        &attributes,
                        argumentsBuffer.baseAddress,
                        environmentBuffer.baseAddress
                    )
                }
            }
        }
        guard spawnResult == 0, childPID > 0 else {
            throw CoordinatorError("managed_codex_version_probe_unavailable")
        }

        close(outputDescriptors[1])
        outputDescriptors[1] = -1
        close(errorDescriptors[1])
        errorDescriptors[1] = -1

        var childNeedsReaping = true
        defer {
            if childNeedsReaping {
                _ = kill(-childPID, SIGKILL)
                var abandonedStatus: Int32 = 0
                while waitpid(childPID, &abandonedStatus, 0) < 0
                        && errno == EINTR
                {}
            }
        }

        var output = BoundedCapture()
        var errors = BoundedCapture()
        let deadline = DispatchTime.now().uptimeNanoseconds
            + UInt64(max(1, timeoutMilliseconds)) * 1_000_000
        var waitStatus: Int32 = 0
        while true {
            try output.drain(outputDescriptors[0])
            try errors.drain(errorDescriptors[0])
            if output.exceededLimit || errors.exceededLimit {
                terminateProcessGroup(
                    childPID,
                    childNeedsReaping: &childNeedsReaping,
                    waitStatus: &waitStatus,
                    outputDescriptor: outputDescriptors[0],
                    errorDescriptor: errorDescriptors[0],
                    output: &output,
                    errors: &errors
                )
                throw CoordinatorError(
                    "managed_codex_version_probe_output_too_large"
                )
            }
            let waited = waitpid(childPID, &waitStatus, WNOHANG)
            if waited == childPID {
                childNeedsReaping = false
                terminateProcessGroup(
                    childPID,
                    childNeedsReaping: &childNeedsReaping,
                    waitStatus: &waitStatus,
                    outputDescriptor: outputDescriptors[0],
                    errorDescriptor: errorDescriptors[0],
                    output: &output,
                    errors: &errors
                )
                break
            }
            if waited < 0, errno != EINTR {
                throw CoordinatorError("managed_codex_version_probe_unavailable")
            }
            guard DispatchTime.now().uptimeNanoseconds < deadline else {
                terminateProcessGroup(
                    childPID,
                    childNeedsReaping: &childNeedsReaping,
                    waitStatus: &waitStatus,
                    outputDescriptor: outputDescriptors[0],
                    errorDescriptor: errorDescriptors[0],
                    output: &output,
                    errors: &errors
                )
                throw CoordinatorError("managed_codex_version_probe_timeout")
            }
            usleep(drainIntervalMicroseconds)
        }

        // Never wait for EOF: an untrusted descendant may still hold either
        // inherited pipe open after the direct child exits.
        try output.drain(outputDescriptors[0])
        try errors.drain(errorDescriptors[0])
        guard !output.exceededLimit, !errors.exceededLimit else {
            throw CoordinatorError("managed_codex_version_probe_output_too_large")
        }
        return ManagedCodexVersionProbeResult(
            exitCode: shellExitStatus(waitStatus),
            stdout: output.data,
            stderr: errors.data
        )
    }

    private static func terminateProcessGroup(
        _ childPID: pid_t,
        childNeedsReaping: inout Bool,
        waitStatus: inout Int32,
        outputDescriptor: Int32,
        errorDescriptor: Int32,
        output: inout BoundedCapture,
        errors: inout BoundedCapture
    ) {
        _ = kill(-childPID, SIGTERM)
        let graceDeadline = DispatchTime.now().uptimeNanoseconds
            + UInt64(terminationGraceMilliseconds) * 1_000_000
        while DispatchTime.now().uptimeNanoseconds < graceDeadline {
            try? output.drain(outputDescriptor)
            try? errors.drain(errorDescriptor)
            if childNeedsReaping {
                let waited = waitpid(childPID, &waitStatus, WNOHANG)
                if waited == childPID { childNeedsReaping = false }
            }
            if kill(-childPID, 0) < 0, errno == ESRCH { break }
            usleep(drainIntervalMicroseconds)
        }
        _ = kill(-childPID, SIGKILL)
        if childNeedsReaping {
            while true {
                let waited = waitpid(childPID, &waitStatus, 0)
                if waited == childPID {
                    childNeedsReaping = false
                    break
                }
                if waited < 0, errno == EINTR { continue }
                break
            }
        }
        try? output.drain(outputDescriptor)
        try? errors.drain(errorDescriptor)
    }

    private static func shellExitStatus(_ status: Int32) -> Int32 {
        let signal = status & 0x7f
        if signal == 0 { return (status >> 8) & 0xff }
        return 128 + signal
    }
}

/// An owner-only copy of one inspected native executable. The source is
/// O_NOFOLLOW-opened and its descriptor identity must exactly match the trust
/// snapshot before and after the copy. All later spawns use this private path.
final class ManagedCodexPinnedExecutable: @unchecked Sendable {
    private static let directoryPrefix = "blabee-managed-codex."
    private static let leaseName = ".lease"
    private static let maximumExecutableSize: Int64 = 512 * 1_024 * 1_024

    let directoryURL: URL
    let executableURL: URL
    private let leaseURL: URL
    private let leaseDescriptor: Int32
    private let leaseIdentity: CodexRuntimeFileIdentity
    private let directoryIdentity: CodexRuntimeFileIdentity
    private let executableIdentity: CodexRuntimeFileIdentity
    private let cleanupLock = NSLock()
    private var cleaned = false

    private init(
        directoryURL: URL,
        executableURL: URL,
        leaseURL: URL,
        leaseDescriptor: Int32,
        leaseIdentity: CodexRuntimeFileIdentity,
        directoryIdentity: CodexRuntimeFileIdentity,
        executableIdentity: CodexRuntimeFileIdentity
    ) {
        self.directoryURL = directoryURL
        self.executableURL = executableURL
        self.leaseURL = leaseURL
        self.leaseDescriptor = leaseDescriptor
        self.leaseIdentity = leaseIdentity
        self.directoryIdentity = directoryIdentity
        self.executableIdentity = executableIdentity
    }

    deinit { cleanup() }

    #if DEBUG
        private static let injectedCreateFailureLock = NSLock()
        private nonisolated(unsafe) static var injectedCreateFailurePoint:
            ManagedCodexPinnedExecutableCreateFailurePoint?
    #endif

    static func create(
        from snapshot: CodexRuntimeTrustSnapshot,
        parentURL: URL
    ) throws -> ManagedCodexPinnedExecutable {
        let sourceDescriptor = open(
            snapshot.canonicalPath,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC
        )
        guard sourceDescriptor >= 0 else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }
        defer { close(sourceDescriptor) }

        var openedSource = stat()
        guard fstat(sourceDescriptor, &openedSource) == 0,
              fileIdentity(openedSource) == snapshot.targetIdentity
        else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }
        try requireNativeExecutable(sourceDescriptor)

        let directoryURL = try makePrivateDirectory(parentURL: parentURL)
        var partialDirectoryIdentity: ManagedCodexFileObjectIdentity?
        var preserveDirectory = false
        defer {
            if !preserveDirectory, let partialDirectoryIdentity {
                removeEmptyDirectoryIfExact(
                    directoryURL: directoryURL,
                    expectedDirectory: partialDirectoryIdentity
                )
            }
        }
        var createdDirectory = stat()
        guard lstat(directoryURL.path, &createdDirectory) == 0,
              isPrivateDirectory(fileIdentity(createdDirectory))
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory cannot be inspected"
            )
        }
        partialDirectoryIdentity = ManagedCodexFileObjectIdentity(createdDirectory)
        let leaseURL = directoryURL.appendingPathComponent(
            leaseName,
            isDirectory: false
        )
        // Deliberately omit O_CLOEXEC. A successful native fallback replaces
        // this process, so the lease must remain locked in the Codex process
        // until it exits. The next explicit invocation can then safely reap it.
        let leaseDescriptor = open(
            leaseURL.path,
            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW,
            mode_t(S_IRUSR | S_IWUSR)
        )
        guard leaseDescriptor >= 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed lease cannot be created"
            )
        }
        var preserveLease = false
        var partialLeaseIdentity: ManagedCodexFileObjectIdentity?
        var partialExecutableIdentity: ManagedCodexFileObjectIdentity?
        defer {
            if !preserveLease {
                if let partialLeaseIdentity, let partialDirectoryIdentity {
                    removePartialPinIfExact(
                        directoryURL: directoryURL,
                        expectedDirectory: partialDirectoryIdentity,
                        leaseURL: leaseURL,
                        leaseLockDescriptor: leaseDescriptor,
                        expectedLease: partialLeaseIdentity,
                        executableURL: partialExecutableIdentity == nil
                            ? nil
                            : directoryURL.appendingPathComponent(
                                "codex",
                                isDirectory: false
                            ),
                        expectedExecutable: partialExecutableIdentity
                    )
                }
                _ = flock(leaseDescriptor, LOCK_UN)
                close(leaseDescriptor)
            }
        }
        var openedLease = stat()
        if fstat(leaseDescriptor, &openedLease) == 0 {
            partialLeaseIdentity = ManagedCodexFileObjectIdentity(openedLease)
        }
        guard fchmod(leaseDescriptor, mode_t(S_IRUSR | S_IWUSR)) == 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed lease cannot be locked"
            )
        }
        guard flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed lease cannot be locked"
            )
        }
        var capturedLease = stat()
        guard fstat(leaseDescriptor, &capturedLease) == 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed lease cannot be inspected"
            )
        }
        let leaseIdentity = fileIdentity(capturedLease)
        guard isPrivateLease(leaseIdentity) else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed lease has unsafe metadata"
            )
        }
        partialLeaseIdentity = ManagedCodexFileObjectIdentity(leaseIdentity)
        try requireNoGrantACL(leaseDescriptor)
        try failCreateIfRequested(.afterLease)

        let executableURL = directoryURL.appendingPathComponent(
            "codex",
            isDirectory: false
        )
        let destinationDescriptor = open(
            executableURL.path,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(S_IRUSR | S_IXUSR)
        )
        guard destinationDescriptor >= 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed executable cannot be created"
            )
        }
        defer { close(destinationDescriptor) }
        var openedDestination = stat()
        guard fstat(destinationDescriptor, &openedDestination) == 0,
              isPrivatePartialExecutable(fileIdentity(openedDestination))
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed executable has unsafe metadata"
            )
        }
        partialExecutableIdentity = ManagedCodexFileObjectIdentity(
            openedDestination
        )
        try failCreateIfRequested(.afterDestinationCreate)

        try copyExactBytes(
            from: sourceDescriptor,
            to: destinationDescriptor,
            expectedCount: snapshot.targetIdentity.size,
            injectPartialCopyFailure: shouldInjectCreateFailure(.afterPartialCopy)
        )
        guard fchmod(destinationDescriptor, mode_t(S_IRUSR | S_IXUSR)) == 0,
              fsync(destinationDescriptor) == 0
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed executable cannot be sealed"
            )
        }
        try requireNoGrantACL(destinationDescriptor)

        var completedSource = stat()
        var namedSource = stat()
        var completedDestination = stat()
        guard fstat(sourceDescriptor, &completedSource) == 0,
              fileIdentity(completedSource) == snapshot.targetIdentity,
              lstat(snapshot.canonicalPath, &namedSource) == 0,
              fileIdentity(namedSource) == snapshot.targetIdentity,
              fstat(destinationDescriptor, &completedDestination) == 0
        else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }
        let destinationIdentity = fileIdentity(completedDestination)
        guard isPrivateNativeExecutable(destinationIdentity),
              access(executableURL.path, X_OK) == 0
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed executable has unsafe metadata"
            )
        }

        var directoryInfo = stat()
        guard lstat(directoryURL.path, &directoryInfo) == 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory cannot be inspected"
            )
        }
        let capturedDirectoryIdentity = fileIdentity(directoryInfo)
        guard isPrivateDirectory(capturedDirectoryIdentity) else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory has unsafe metadata"
            )
        }

        let pin = ManagedCodexPinnedExecutable(
            directoryURL: directoryURL,
            executableURL: executableURL,
            leaseURL: leaseURL,
            leaseDescriptor: leaseDescriptor,
            leaseIdentity: leaseIdentity,
            directoryIdentity: capturedDirectoryIdentity,
            executableIdentity: destinationIdentity
        )
        // Ownership of the descriptor and exact paths transfers to `pin`
        // before the final verification. If verification fails, `pin` alone
        // performs bounded cleanup; the construction defers must not close the
        // same descriptor a second time.
        preserveLease = true
        preserveDirectory = true
        try pin.verifyIdentity()
        return pin
    }

    func revalidate(
        qualifiedVersion: String
    ) throws -> CodexRuntimeApprovedExecutable {
        guard CodexCompatibility.qualify(
            version: qualifiedVersion
        ).isApprovedForManagedUse else {
            throw CodexRuntimeTrustError.unsupportedVersion(qualifiedVersion)
        }
        try verifyIdentity()
        return CodexRuntimeApprovedExecutable(
            stableSourceURL: executableURL,
            canonicalURL: executableURL,
            targetIdentity: executableIdentity,
            qualifiedVersion: qualifiedVersion
        )
    }

    private func verifyIdentity() throws {
        var namedDirectory = stat()
        var namedLease = stat()
        var namedExecutable = stat()
        guard lstat(directoryURL.path, &namedDirectory) == 0,
              Self.fileIdentity(namedDirectory) == directoryIdentity,
              Self.isPrivateDirectory(Self.fileIdentity(namedDirectory)),
              lstat(leaseURL.path, &namedLease) == 0,
              Self.fileIdentity(namedLease) == leaseIdentity,
              Self.isPrivateLease(Self.fileIdentity(namedLease)),
              lstat(executableURL.path, &namedExecutable) == 0,
              Self.fileIdentity(namedExecutable) == executableIdentity,
              Self.isPrivateNativeExecutable(Self.fileIdentity(namedExecutable))
        else {
            throw CodexRuntimeTrustError.approvalDrift
        }

        let directoryDescriptor = open(
            directoryURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard directoryDescriptor >= 0 else {
            throw CodexRuntimeTrustError.approvalDrift
        }
        defer { close(directoryDescriptor) }
        var openedDirectory = stat()
        guard fstat(directoryDescriptor, &openedDirectory) == 0,
              Self.fileIdentity(openedDirectory) == directoryIdentity
        else {
            throw CodexRuntimeTrustError.approvalDrift
        }
        try Self.requireNoGrantACL(directoryDescriptor)

        var openedLease = stat()
        guard fstat(leaseDescriptor, &openedLease) == 0,
              Self.fileIdentity(openedLease) == leaseIdentity,
              flock(leaseDescriptor, LOCK_EX | LOCK_NB) == 0
        else {
            throw CodexRuntimeTrustError.approvalDrift
        }
        try Self.requireNoGrantACL(leaseDescriptor)

        let executableDescriptor = open(
            executableURL.path,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC
        )
        guard executableDescriptor >= 0 else {
            throw CodexRuntimeTrustError.approvalDrift
        }
        defer { close(executableDescriptor) }
        var openedExecutable = stat()
        guard fstat(executableDescriptor, &openedExecutable) == 0,
              Self.fileIdentity(openedExecutable) == executableIdentity,
              access(executableURL.path, X_OK) == 0
        else {
            throw CodexRuntimeTrustError.approvalDrift
        }
        try Self.requireNoGrantACL(executableDescriptor)
        try Self.requireNativeExecutable(executableDescriptor)
    }

    private func cleanup() {
        cleanupLock.lock()
        defer { cleanupLock.unlock() }
        guard !cleaned else { return }
        cleaned = true
        Self.removePinIfExact(
            directoryURL: directoryURL,
            expectedDirectory: directoryIdentity,
            leaseURL: leaseURL,
            expectedLease: leaseIdentity,
            executableURL: executableURL,
            expectedExecutable: executableIdentity
        )
        _ = flock(leaseDescriptor, LOCK_UN)
        close(leaseDescriptor)
    }

    private static func makePrivateDirectory(parentURL: URL) throws -> URL {
        guard parentURL.isFileURL, parentURL.path.hasPrefix("/"),
              !parentURL.path.utf8.contains(0),
              let resolvedTemporary = realpath(parentURL.path, nil)
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "temporary directory cannot be resolved"
            )
        }
        defer { free(resolvedTemporary) }
        let parent = String(cString: resolvedTemporary)
        guard let stableTemporary = realpath(parent, nil) else {
            throw CodexRuntimeTrustError.unsafePath(
                "temporary directory cannot be resolved"
            )
        }
        defer { free(stableTemporary) }
        guard String(cString: stableTemporary) == parent else {
            throw CodexRuntimeTrustError.unsafePath(
                "temporary directory is not a stable canonical path"
            )
        }

        let parentDescriptor = open(
            parent,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard parentDescriptor >= 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "temporary directory cannot be inspected"
            )
        }
        defer { close(parentDescriptor) }
        var openedParent = stat()
        var namedParent = stat()
        guard fstat(parentDescriptor, &openedParent) == 0,
              lstat(parent, &namedParent) == 0,
              ManagedCodexFileObjectIdentity(openedParent)
                == ManagedCodexFileObjectIdentity(namedParent),
              openedParent.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              openedParent.st_uid == geteuid(),
              openedParent.st_mode & 0o022 == 0
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "temporary directory has unsafe metadata"
            )
        }
        try requireNoGrantACL(
            parentDescriptor,
            subject: "temporary directory"
        )
        scavengeAbandonedPins(in: parent)
        var template = Array(
            (parent + "/" + directoryPrefix + "XXXXXX").utf8CString
        )
        let createdPath: String? = template.withUnsafeMutableBufferPointer { buffer in
            guard let base = buffer.baseAddress, let created = mkdtemp(base) else {
                return nil
            }
            return String(cString: created)
        }
        guard let createdPath else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory cannot be created"
            )
        }
        let createdName = URL(fileURLWithPath: createdPath).lastPathComponent
        var namedCreated = stat()
        guard fstatat(
            parentDescriptor,
            createdName,
            &namedCreated,
            AT_SYMLINK_NOFOLLOW
        ) == 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory cannot be inspected"
            )
        }
        let createdIdentity = ManagedCodexFileObjectIdentity(namedCreated)
        var preserveCreated = false
        defer {
            if !preserveCreated {
                var relativeCreated = stat()
                if fstatat(
                    parentDescriptor,
                    createdName,
                    &relativeCreated,
                    AT_SYMLINK_NOFOLLOW
                ) == 0,
                    ManagedCodexFileObjectIdentity(relativeCreated)
                        == createdIdentity
                {
                    _ = unlinkat(parentDescriptor, createdName, AT_REMOVEDIR)
                }
            }
        }
        guard isPrivateDirectory(fileIdentity(namedCreated)) else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory has unsafe metadata"
            )
        }
        let createdDescriptor = openat(
            parentDescriptor,
            createdName,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard createdDescriptor >= 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory cannot be inspected"
            )
        }
        defer { close(createdDescriptor) }
        var openedCreated = stat()
        guard fstat(createdDescriptor, &openedCreated) == 0,
              ManagedCodexFileObjectIdentity(openedCreated) == createdIdentity
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory cannot be inspected"
            )
        }
        guard isPrivateDirectory(fileIdentity(openedCreated)) else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory has unsafe metadata"
            )
        }
        guard fchmod(createdDescriptor, mode_t(S_IRWXU)) == 0 else {
            throw CodexRuntimeTrustError.unsafePath(
                "private managed directory cannot be sealed"
            )
        }
        try requireNoGrantACL(
            createdDescriptor,
            subject: "private managed directory"
        )
        var stableOpenedParent = stat()
        var stableNamedParent = stat()
        var stableNamedCreated = stat()
        guard fstat(parentDescriptor, &stableOpenedParent) == 0,
              lstat(parent, &stableNamedParent) == 0,
              ManagedCodexFileObjectIdentity(stableOpenedParent)
                == ManagedCodexFileObjectIdentity(openedParent),
              ManagedCodexFileObjectIdentity(stableNamedParent)
                == ManagedCodexFileObjectIdentity(openedParent),
              stableOpenedParent.st_uid == geteuid(),
              stableOpenedParent.st_mode & 0o022 == 0,
              lstat(createdPath, &stableNamedCreated) == 0,
              ManagedCodexFileObjectIdentity(stableNamedCreated)
                == createdIdentity,
              isPrivateDirectory(fileIdentity(stableNamedCreated))
        else {
            throw CodexRuntimeTrustError.unsafePath(
                "temporary directory changed during pin creation"
            )
        }
        do {
            try requireNoGrantACL(
                parentDescriptor,
                subject: "temporary directory"
            )
        } catch {
            throw error
        }
        preserveCreated = true
        return URL(fileURLWithPath: createdPath, isDirectory: true)
    }

    /// Reaps only old, owner-private pin directories whose exact lease file is
    /// safely lockable. Exact lease-only and partially copied states are valid
    /// recovery candidates. Active providers and exec-replaced native Codex
    /// processes retain the inherited exclusive lock and are never removed.
    private static func scavengeAbandonedPins(in parent: String) {
        let fileManager = FileManager.default
        let parentURL = URL(fileURLWithPath: parent, isDirectory: true)
        guard let entries = try? fileManager.contentsOfDirectory(
            at: parentURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return }

        let now = time(nil)
        for directoryURL in entries
        where directoryURL.lastPathComponent.hasPrefix(directoryPrefix) {
            var namedDirectory = stat()
            guard lstat(directoryURL.path, &namedDirectory) == 0,
                  isPrivateDirectory(fileIdentity(namedDirectory)),
                  now - namedDirectory.st_mtimespec.tv_sec >= 60
            else { continue }
            let expectedDirectory = ManagedCodexFileObjectIdentity(
                namedDirectory
            )

            guard let pinEntries = try? fileManager.contentsOfDirectory(
                atPath: directoryURL.path
            ) else { continue }
            let entryNames = Set(pinEntries)
            if entryNames.isEmpty {
                removeEmptyDirectoryIfExact(
                    directoryURL: directoryURL,
                    expectedDirectory: expectedDirectory
                )
                continue
            }
            guard entryNames == Set([leaseName])
                    || entryNames == Set([leaseName, "codex"])
            else { continue }

            let leaseURL = directoryURL.appendingPathComponent(
                leaseName,
                isDirectory: false
            )
            let executableURL = entryNames.contains("codex")
                ? directoryURL.appendingPathComponent(
                    "codex",
                    isDirectory: false
                )
                : nil
            var namedLease = stat()
            guard lstat(leaseURL.path, &namedLease) == 0,
                  isPrivateLease(fileIdentity(namedLease))
            else { continue }
            var expectedExecutable: ManagedCodexFileObjectIdentity?
            if let executableURL {
                var namedExecutable = stat()
                guard lstat(executableURL.path, &namedExecutable) == 0,
                      isPrivatePartialExecutable(fileIdentity(namedExecutable))
                else { continue }
                expectedExecutable = ManagedCodexFileObjectIdentity(
                    namedExecutable
                )
            }
            let expectedLease = ManagedCodexFileObjectIdentity(namedLease)

            let descriptor = open(
                leaseURL.path,
                O_RDWR | O_NOFOLLOW | O_CLOEXEC
            )
            guard descriptor >= 0 else { continue }
            var openedLease = stat()
            guard fstat(descriptor, &openedLease) == 0,
                  ManagedCodexFileObjectIdentity(openedLease) == expectedLease,
                  isPrivateLease(fileIdentity(openedLease)),
                  flock(descriptor, LOCK_EX | LOCK_NB) == 0
            else {
                close(descriptor)
                continue
            }

            removePartialPinIfExact(
                directoryURL: directoryURL,
                expectedDirectory: expectedDirectory,
                leaseURL: leaseURL,
                leaseLockDescriptor: descriptor,
                expectedLease: expectedLease,
                executableURL: executableURL,
                expectedExecutable: expectedExecutable
            )
            _ = flock(descriptor, LOCK_UN)
            close(descriptor)
        }
    }

    static func scavengeLegacyPinsForRuntimeBundle(in parent: String) {
        scavengeAbandonedPins(in: parent)
    }

    /// Removes only the two captured regular files from the captured private
    /// directory. Unknown entries, symlinks, special files, or any identity
    /// drift make cleanup a no-op rather than risking unrelated user data.
    private static func removePinIfExact(
        directoryURL: URL,
        expectedDirectory: CodexRuntimeFileIdentity,
        leaseURL: URL,
        expectedLease: CodexRuntimeFileIdentity,
        executableURL: URL,
        expectedExecutable: CodexRuntimeFileIdentity
    ) {
        var namedDirectory = stat()
        guard lstat(directoryURL.path, &namedDirectory) == 0,
              fileIdentity(namedDirectory) == expectedDirectory,
              isPrivateDirectory(expectedDirectory),
              let entries = try? FileManager.default.contentsOfDirectory(
                atPath: directoryURL.path
              ),
              Set(entries) == Set([leaseName, "codex"])
        else { return }

        let directoryDescriptor = open(
            directoryURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard directoryDescriptor >= 0 else { return }
        defer { close(directoryDescriptor) }

        var openedDirectory = stat()
        var relativeLease = stat()
        var relativeExecutable = stat()
        guard fstat(directoryDescriptor, &openedDirectory) == 0,
              fileIdentity(openedDirectory) == expectedDirectory,
              fstatat(
                directoryDescriptor,
                leaseName,
                &relativeLease,
                AT_SYMLINK_NOFOLLOW
              ) == 0,
              fileIdentity(relativeLease) == expectedLease,
              isPrivateLease(expectedLease),
              fstatat(
                directoryDescriptor,
                "codex",
                &relativeExecutable,
                AT_SYMLINK_NOFOLLOW
              ) == 0,
              fileIdentity(relativeExecutable) == expectedExecutable,
              isPrivateNativeExecutable(expectedExecutable),
              leaseURL.deletingLastPathComponent() == directoryURL,
              executableURL.deletingLastPathComponent() == directoryURL
        else { return }

        let cleanupLeaseDescriptor = openat(
            directoryDescriptor,
            leaseName,
            O_RDWR | O_NOFOLLOW | O_CLOEXEC
        )
        guard cleanupLeaseDescriptor >= 0 else { return }
        defer { close(cleanupLeaseDescriptor) }
        let cleanupExecutableDescriptor = openat(
            directoryDescriptor,
            "codex",
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC
        )
        guard cleanupExecutableDescriptor >= 0 else { return }
        defer { close(cleanupExecutableDescriptor) }
        var openedLease = stat()
        var openedExecutable = stat()
        guard fstat(cleanupLeaseDescriptor, &openedLease) == 0,
              fileIdentity(openedLease) == expectedLease,
              fstat(cleanupExecutableDescriptor, &openedExecutable) == 0,
              fileIdentity(openedExecutable) == expectedExecutable
        else { return }
        do {
            try requireNoGrantACL(directoryDescriptor)
            try requireNoGrantACL(cleanupLeaseDescriptor)
            try requireNoGrantACL(cleanupExecutableDescriptor)
            try requireNativeExecutable(cleanupExecutableDescriptor)
        } catch {
            return
        }

        guard unlinkat(directoryDescriptor, "codex", 0) == 0,
              unlinkat(directoryDescriptor, leaseName, 0) == 0
        else { return }

        // The content mutations above intentionally changed timestamps, so
        // compare the stable directory object identity before removing it.
        var remainingDirectory = stat()
        var remainingNamedDirectory = stat()
        guard fstat(directoryDescriptor, &remainingDirectory) == 0,
              ManagedCodexFileObjectIdentity(remainingDirectory)
                == ManagedCodexFileObjectIdentity(expectedDirectory),
              lstat(directoryURL.path, &remainingNamedDirectory) == 0,
              ManagedCodexFileObjectIdentity(remainingNamedDirectory)
                == ManagedCodexFileObjectIdentity(expectedDirectory)
        else { return }
        _ = rmdir(directoryURL.path)
    }

    /// Removes only an exact partial pin created by this protocol. A lease is
    /// mandatory and must be exclusively lockable through the captured file
    /// object. The executable may be absent or incompletely copied, but no
    /// unrecognized directory entry is ever unlinked.
    private static func removePartialPinIfExact(
        directoryURL: URL,
        expectedDirectory: ManagedCodexFileObjectIdentity,
        leaseURL: URL,
        leaseLockDescriptor: Int32,
        expectedLease: ManagedCodexFileObjectIdentity,
        executableURL: URL?,
        expectedExecutable: ManagedCodexFileObjectIdentity?
    ) {
        guard (executableURL == nil) == (expectedExecutable == nil),
              leaseURL.deletingLastPathComponent() == directoryURL,
              executableURL?.deletingLastPathComponent() == directoryURL
                  || executableURL == nil
        else { return }

        var namedDirectory = stat()
        guard lstat(directoryURL.path, &namedDirectory) == 0,
              ManagedCodexFileObjectIdentity(namedDirectory)
                == expectedDirectory,
              isPrivateDirectory(fileIdentity(namedDirectory))
        else { return }

        var expectedEntries = Set([leaseName])
        if expectedExecutable != nil { expectedEntries.insert("codex") }
        guard let entries = try? FileManager.default.contentsOfDirectory(
            atPath: directoryURL.path
        ), Set(entries) == expectedEntries else { return }

        let directoryDescriptor = open(
            directoryURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard directoryDescriptor >= 0 else { return }
        defer { close(directoryDescriptor) }

        var openedDirectory = stat()
        var heldLease = stat()
        var relativeLease = stat()
        guard fstat(directoryDescriptor, &openedDirectory) == 0,
              ManagedCodexFileObjectIdentity(openedDirectory)
                == expectedDirectory,
              isPrivateDirectory(fileIdentity(openedDirectory)),
              fstat(leaseLockDescriptor, &heldLease) == 0,
              ManagedCodexFileObjectIdentity(heldLease) == expectedLease,
              isPrivateLease(fileIdentity(heldLease)),
              flock(leaseLockDescriptor, LOCK_EX | LOCK_NB) == 0,
              fstatat(
                directoryDescriptor,
                leaseName,
                &relativeLease,
                AT_SYMLINK_NOFOLLOW
              ) == 0,
              ManagedCodexFileObjectIdentity(relativeLease) == expectedLease,
              isPrivateLease(fileIdentity(relativeLease))
        else { return }

        let cleanupLeaseDescriptor = openat(
            directoryDescriptor,
            leaseName,
            O_RDWR | O_NOFOLLOW | O_CLOEXEC
        )
        guard cleanupLeaseDescriptor >= 0 else { return }
        defer { close(cleanupLeaseDescriptor) }
        var openedCleanupLease = stat()
        guard fstat(cleanupLeaseDescriptor, &openedCleanupLease) == 0,
              ManagedCodexFileObjectIdentity(openedCleanupLease)
                == expectedLease,
              fileIdentity(openedCleanupLease) == fileIdentity(relativeLease)
        else { return }

        var cleanupExecutableDescriptor: Int32 = -1
        defer {
            if cleanupExecutableDescriptor >= 0 {
                close(cleanupExecutableDescriptor)
            }
        }
        if let expectedExecutable {
            var relativeExecutable = stat()
            guard fstatat(
                directoryDescriptor,
                "codex",
                &relativeExecutable,
                AT_SYMLINK_NOFOLLOW
            ) == 0,
                  ManagedCodexFileObjectIdentity(relativeExecutable)
                    == expectedExecutable,
                  isPrivatePartialExecutable(fileIdentity(relativeExecutable))
            else { return }
            cleanupExecutableDescriptor = openat(
                directoryDescriptor,
                "codex",
                O_RDONLY | O_NOFOLLOW | O_CLOEXEC
            )
            guard cleanupExecutableDescriptor >= 0 else { return }
            var openedExecutable = stat()
            guard fstat(cleanupExecutableDescriptor, &openedExecutable) == 0,
                  ManagedCodexFileObjectIdentity(openedExecutable)
                    == expectedExecutable,
                  fileIdentity(openedExecutable)
                    == fileIdentity(relativeExecutable)
            else { return }
        }

        do {
            try requireNoGrantACL(directoryDescriptor)
            try requireNoGrantACL(cleanupLeaseDescriptor)
            if cleanupExecutableDescriptor >= 0 {
                try requireNoGrantACL(cleanupExecutableDescriptor)
            }
        } catch {
            return
        }

        if expectedExecutable != nil,
           unlinkat(directoryDescriptor, "codex", 0) != 0
        {
            return
        }
        guard unlinkat(directoryDescriptor, leaseName, 0) == 0 else { return }

        var remainingDirectory = stat()
        var remainingNamedDirectory = stat()
        guard fstat(directoryDescriptor, &remainingDirectory) == 0,
              ManagedCodexFileObjectIdentity(remainingDirectory)
                == expectedDirectory,
              lstat(directoryURL.path, &remainingNamedDirectory) == 0,
              ManagedCodexFileObjectIdentity(remainingNamedDirectory)
                == expectedDirectory
        else { return }
        _ = rmdir(directoryURL.path)
    }

    private static func removeEmptyDirectoryIfExact(
        directoryURL: URL,
        expectedDirectory: ManagedCodexFileObjectIdentity
    ) {
        var namedDirectory = stat()
        guard lstat(directoryURL.path, &namedDirectory) == 0,
              ManagedCodexFileObjectIdentity(namedDirectory)
                == expectedDirectory,
              isPrivateDirectory(fileIdentity(namedDirectory)),
              let entries = try? FileManager.default.contentsOfDirectory(
                atPath: directoryURL.path
              ),
              entries.isEmpty
        else { return }

        let directoryDescriptor = open(
            directoryURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard directoryDescriptor >= 0 else { return }
        defer { close(directoryDescriptor) }

        var openedDirectory = stat()
        guard fstat(directoryDescriptor, &openedDirectory) == 0,
              ManagedCodexFileObjectIdentity(openedDirectory)
                == expectedDirectory,
              isPrivateDirectory(fileIdentity(openedDirectory))
        else { return }
        do {
            try requireNoGrantACL(directoryDescriptor)
        } catch {
            return
        }

        var remainingNamedDirectory = stat()
        guard lstat(directoryURL.path, &remainingNamedDirectory) == 0,
              ManagedCodexFileObjectIdentity(remainingNamedDirectory)
                == expectedDirectory
        else { return }
        _ = rmdir(directoryURL.path)
    }

    private static func copyExactBytes(
        from sourceDescriptor: Int32,
        to destinationDescriptor: Int32,
        expectedCount: Int64,
        injectPartialCopyFailure: Bool = false
    ) throws {
        guard expectedCount >= 4, expectedCount <= maximumExecutableSize,
              lseek(sourceDescriptor, 0, SEEK_SET) == 0
        else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }

        let capacity = 64 * 1_024
        let buffer = UnsafeMutableRawPointer.allocate(
            byteCount: capacity,
            alignment: MemoryLayout<UInt64>.alignment
        )
        defer { buffer.deallocate() }
        var remaining = expectedCount
        var partialFailureInjected = false
        while remaining > 0 {
            let requested = injectPartialCopyFailure && !partialFailureInjected
                ? min(4, Int(remaining))
                : min(capacity, Int(remaining))
            var readCount: Int
            repeat {
                readCount = Darwin.read(sourceDescriptor, buffer, requested)
            } while readCount < 0 && errno == EINTR
            guard readCount > 0 else {
                throw CodexRuntimeTrustError.changedDuringInspection
            }

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
                    throw CodexRuntimeTrustError.unsafePath(
                        "private managed executable cannot be copied"
                    )
                }
                written += writeCount
            }
            if injectPartialCopyFailure && !partialFailureInjected {
                partialFailureInjected = true
                try failCreateIfRequested(.afterPartialCopy)
            }
            remaining -= Int64(readCount)
        }

        var extra: UInt8 = 0
        var extraCount: Int
        repeat {
            extraCount = Darwin.read(sourceDescriptor, &extra, 1)
        } while extraCount < 0 && errno == EINTR
        guard extraCount == 0 else {
            throw CodexRuntimeTrustError.changedDuringInspection
        }
    }

    #if DEBUG
        private static func failCreateIfRequested(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint
        ) throws {
            guard shouldInjectCreateFailure(point) else { return }
            injectedCreateFailureLock.withLock {
                injectedCreateFailurePoint = nil
            }
            throw ManagedCodexPinnedExecutableInjectedFailure(point)
        }

        private static func shouldInjectCreateFailure(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint
        ) -> Bool {
            injectedCreateFailureLock.withLock {
                injectedCreateFailurePoint == point
            }
        }

        fileprivate static func setInjectedCreateFailurePoint(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint?
        ) {
            injectedCreateFailureLock.withLock {
                injectedCreateFailurePoint = point
            }
        }
    #else
        private static func failCreateIfRequested(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint
        ) throws {}

        private static func shouldInjectCreateFailure(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint
        ) -> Bool { false }

        fileprivate static func setInjectedCreateFailurePoint(
            _ point: ManagedCodexPinnedExecutableCreateFailurePoint?
        ) {}
    #endif

    private static func requireNativeExecutable(_ descriptor: Int32) throws {
        var prefix = [UInt8](repeating: 0, count: 4)
        let count = prefix.withUnsafeMutableBytes { bytes in
            pread(descriptor, bytes.baseAddress, bytes.count, 0)
        }
        guard count == prefix.count else {
            throw CodexRuntimeTrustError.invalidSource(
                "managed Codex candidate must be a direct native executable"
            )
        }
        guard !(prefix[0] == 0x23 && prefix[1] == 0x21) else {
            throw CodexRuntimeTrustError.invalidSource(
                "managed Codex candidate must not be an interpreter script"
            )
        }
        let magic = UInt32(prefix[0])
            | UInt32(prefix[1]) << 8
            | UInt32(prefix[2]) << 16
            | UInt32(prefix[3]) << 24
        let nativeMagics: Set<UInt32> = [
            0xfeed_face, 0xcefa_edfe,
            0xfeed_facf, 0xcffa_edfe,
            0xcafe_babe, 0xbeba_feca,
            0xcafe_babf, 0xbfba_feca,
        ]
        guard nativeMagics.contains(magic) else {
            throw CodexRuntimeTrustError.invalidSource(
                "managed Codex candidate must be a direct native executable"
            )
        }
    }

    private static func requireNoGrantACL(
        _ descriptor: Int32,
        subject: String = "private managed executable"
    ) throws {
        errno = 0
        let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let aclError = errno
        if let acl {
            let containsGrant = blabeeExtendedACLContainsGrant(acl)
            acl_free(UnsafeMutableRawPointer(acl))
            guard containsGrant == false else {
                throw CodexRuntimeTrustError.unsafePath(
                    "\(subject) has an unsafe ACL"
                )
            }
        }
        guard acl != nil || aclError == ENOENT else {
            throw CodexRuntimeTrustError.unsafePath(
                "\(subject) ACL cannot be inspected"
            )
        }
    }

    private static func isPrivateDirectory(
        _ identity: CodexRuntimeFileIdentity
    ) -> Bool {
        mode_t(identity.mode) & mode_t(S_IFMT) == mode_t(S_IFDIR)
            && identity.owner == UInt32(geteuid())
            && identity.mode & 0o077 == 0
    }

    private static func isPrivateNativeExecutable(
        _ identity: CodexRuntimeFileIdentity
    ) -> Bool {
        mode_t(identity.mode) & mode_t(S_IFMT) == mode_t(S_IFREG)
            && identity.owner == UInt32(geteuid())
            && identity.mode & 0o777 == 0o500
    }

    private static func isPrivatePartialExecutable(
        _ identity: CodexRuntimeFileIdentity
    ) -> Bool {
        let permissions = identity.mode & 0o7777
        return mode_t(identity.mode) & mode_t(S_IFMT) == mode_t(S_IFREG)
            && identity.owner == UInt32(geteuid())
            && permissions & 0o277 == 0
            && permissions & 0o7000 == 0
            && identity.size >= 0
            && identity.size <= maximumExecutableSize
    }

    private static func isPrivateLease(
        _ identity: CodexRuntimeFileIdentity
    ) -> Bool {
        mode_t(identity.mode) & mode_t(S_IFMT) == mode_t(S_IFREG)
            && identity.owner == UInt32(geteuid())
            && identity.mode & 0o777 == 0o600
    }

    private static func fileIdentity(_ info: stat) -> CodexRuntimeFileIdentity {
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
}

enum ManagedCodexPinnedExecutableCreateFailurePoint: Sendable {
    case afterLease
    case afterDestinationCreate
    case afterDestinationCopy
    case afterStagingPublish
    case afterPartialCopy
}

struct ManagedCodexPinnedExecutableTesting {
    static func injectCreateFailure(
        _ point: ManagedCodexPinnedExecutableCreateFailurePoint?
    ) {
        ManagedCodexPinnedExecutable.setInjectedCreateFailurePoint(point)
        ManagedCodexPinnedRuntimeBundle.setInjectedFailurePoint(point)
    }

    static func beforeRuntimeSourceRevalidation(
        _ hook: (@Sendable () throws -> Void)?
    ) {
        ManagedCodexPinnedRuntimeBundle.setBeforeSourceRevalidationHook(hook)
    }

    static func preserveFailedRuntimeStaging(_ preserve: Bool) {
        ManagedCodexPinnedRuntimeBundle
            .setPreserveFailedStagingForTesting(preserve)
    }

    static func signatureValidation(
        _ hook: (@Sendable (_ label: String, _ path: String) throws -> Void)?
    ) {
        #if DEBUG
            ManagedCodexRuntimeBundleInspector.setSignatureValidationHook(hook)
        #endif
    }

    static func scavengeRuntimeBundles(in parentURL: URL) throws {
        #if DEBUG
            try ManagedCodexPinnedRuntimeBundle
                .scavengeSealedBundlesForTesting(in: parentURL)
        #endif
    }
}

struct ManagedCodexPinnedExecutableInjectedFailure: Error, Equatable, Sendable {
    let point: ManagedCodexPinnedExecutableCreateFailurePoint

    init(_ point: ManagedCodexPinnedExecutableCreateFailurePoint) {
        self.point = point
    }
}

/// Pins one explicit managed invocation to one private executable. The source
/// installation may change afterward; any mutation of the private pin fails.
final class ManagedCodexApprovedExecutableProvider: @unchecked Sendable {
    private let resolver: ManagedCodexTrustResolver
    private let stateLock = NSLock()
    private var selection: ManagedCodexApprovedSelection?

    init(resolver: ManagedCodexTrustResolver) {
        self.resolver = resolver
    }

    static func live(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        pinParentURL: URL = FileManager.default.temporaryDirectory,
        runtimeExecutableVerification:
            ManagedCodexRuntimeExecutableVerification = .production,
        versionReader: (@Sendable (URL) throws -> String?)? = nil
    ) throws -> ManagedCodexApprovedExecutableProvider {
        ManagedCodexApprovedExecutableProvider(
            resolver: try ManagedCodexTrustResolver.live(
                bundle: bundle,
                environment: environment,
                pinParentURL: pinParentURL,
                runtimeExecutableVerification: runtimeExecutableVerification,
                versionReader: versionReader
            )
        )
    }

    func next() throws -> URL {
        stateLock.lock()
        defer { stateLock.unlock() }

        if let selection {
            return try resolver.revalidate(selection).canonicalURL
        }
        let resolved = try resolver.resolveApproved()
        selection = resolved
        return resolved.executable.canonicalURL
    }
}
