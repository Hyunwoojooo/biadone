import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation
import Security

enum CodexPluginSetupLegacyPathIdentity: Sendable, Equatable {
    case missing
    case present(CodexRuntimeFileIdentity)
}

struct CodexPluginSetupLegacyFilesystemIdentity: Sendable, Equatable {
    let marketplaceRoot: CodexPluginSetupLegacyPathIdentity
    let marketplaceManifest: CodexPluginSetupLegacyPathIdentity
    let pluginRoot: CodexPluginSetupLegacyPathIdentity
    let pluginManifest: CodexPluginSetupLegacyPathIdentity

    static let allMissing = CodexPluginSetupLegacyFilesystemIdentity(
        marketplaceRoot: .missing,
        marketplaceManifest: .missing,
        pluginRoot: .missing,
        pluginManifest: .missing
    )
}

struct CodexPluginSetupLegacyMigrationConfirmation: Sendable, Equatable {
    let marketplaceName: String
    let marketplaceRootPath: String
    let pluginSelector: String
    let pluginRootPath: String
    let pluginIsInstalled: Bool
    let pluginVersion: String?
    let filesystemIdentity: CodexPluginSetupLegacyFilesystemIdentity
}

enum CodexPluginSetupState: Sendable, Equatable {
    case unchecked
    case unavailable(reason: String)
    case notInstalled
    case marketplaceInstalledNeedsPlugin
    case legacyInstallationDetected(
        marketplaceName: String,
        confirmation: CodexPluginSetupLegacyMigrationConfirmation
    )
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
        case .legacyInstallationDetected:
            return "이전 Blabee 연결 발견"
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
        case let .legacyInstallationDetected(marketplaceName, _):
            return "이전 테스트 연결(\(marketplaceName))이 발견되었습니다. 사용자가 이전 연결 마이그레이션을 명시적으로 선택해야만 변경합니다."
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
    func migrateLegacyInstallation(
        confirmation: CodexPluginSetupLegacyMigrationConfirmation
    ) async -> CodexPluginSetupState
}

actor CodexUnavailablePluginSetupManager: CodexPluginSetupManaging {
    private let reason: String

    init(reason: String = "제품 앱에서만 Codex 연결 설정을 사용할 수 있습니다.") {
        self.reason = reason
    }

    func inspect() async -> CodexPluginSetupState { .unavailable(reason: reason) }
    func connect() async -> CodexPluginSetupState { .unavailable(reason: reason) }
    func disconnect() async -> CodexPluginSetupState { .unavailable(reason: reason) }
    func migrateLegacyInstallation(
        confirmation _: CodexPluginSetupLegacyMigrationConfirmation
    ) async -> CodexPluginSetupState {
        .unavailable(reason: reason)
    }
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
    fileprivate let pinnedTrustEvidence: CodexPluginSetupPinnedTrustEvidence?

    static func testOnly(url: URL, version: String = "0.152.1")
        -> CodexPluginSetupQualifiedExecutable
    {
        CodexPluginSetupQualifiedExecutable(
            sourceURL: url,
            canonicalURL: url,
            version: version,
            trustSnapshot: nil,
            pinnedTrustEvidence: nil
        )
    }
}

typealias CodexPluginSetupExecutableQualifying = @Sendable (
    _ timeoutMilliseconds: Int
) throws
    -> CodexPluginSetupQualifiedExecutable
typealias CodexPluginSetupExecutableRevalidating = @Sendable (
    _ selection: CodexPluginSetupQualifiedExecutable
) throws -> URL
typealias CodexPluginSetupBundleRevalidating = @Sendable () throws -> Void
typealias CodexPluginSetupMonotonicNow = @Sendable () -> UInt64
typealias CodexPluginSetupTrustInspecting = @Sendable (
    _ executable: URL
) throws -> CodexRuntimeTrustSnapshot
typealias CodexPluginSetupSignatureValidating = @Sendable (URL) throws -> Void
typealias CodexPluginSetupPinnedExecutableValidating = @Sendable (
    _ executable: URL,
    _ expectedIdentity: CodexRuntimeFileIdentity,
    _ expectedVersion: String?
) throws -> CodexPluginSetupPinnedArtifact

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
            } catch let error as CoordinatorError
                where error.code == "codex_plugin_setup_operation_timed_out"
            {
                throw error
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

struct CodexPluginSetupPinnedArtifact: Equatable, Sendable {
    let version: String
    let architecture: UInt32
    let executableBytes: Int64
    let executableSHA256: String
}

fileprivate struct CodexPluginSetupPinnedTrustEvidence: Equatable, Sendable {
    let trustSnapshot: CodexRuntimeTrustSnapshot
    let artifact: CodexPluginSetupPinnedArtifact
}

enum CodexPluginSetupPinnedExecutableTrust {
    static let arm64CPUType: UInt32 = 0x0100_000C
    // OpenAI rust-v0.153.2 aarch64 package:
    // https://github.com/openai/codex/releases/download/rust-v0.153.2/codex-package-aarch64-apple-darwin.tar.gz
    // Archive SHA-256: 287e2dd0a9bbfb58581b0a9150399458b4f094ea42caf02860f1e8cb5a202a0b.
    // Its codex binary currently fails strict macOS signature validation, so
    // only this exact executable hash receives the narrow Plugin CLI fallback.
    static let officialArtifacts = [
        CodexPluginSetupPinnedArtifact(
            version: "0.153.2",
            architecture: arm64CPUType,
            executableBytes: 220_551_344,
            executableSHA256: "195ace4100a634a9df39147f493e730e666b5bd87795f3c9f3251d8542400424"
        ),
    ]

    static func matchingArtifact(
        version: String?,
        architecture: UInt32,
        executableBytes: Int64,
        executableSHA256: String,
        artifacts: [CodexPluginSetupPinnedArtifact] = officialArtifacts
    ) -> CodexPluginSetupPinnedArtifact? {
        artifacts.first { artifact in
            (version == nil || artifact.version == version)
                && artifact.architecture == architecture
                && artifact.executableBytes == executableBytes
                && artifact.executableSHA256 == executableSHA256
        }
    }

    static func validate(
        executable: URL,
        expectedIdentity: CodexRuntimeFileIdentity,
        expectedVersion: String?,
        artifacts: [CodexPluginSetupPinnedArtifact] = officialArtifacts,
        beforeExactEOFCheck: () throws -> Void = {},
        deadlineNanoseconds: UInt64? = nil,
        monotonicNow: () -> UInt64 = {
            DispatchTime.now().uptimeNanoseconds
        }
    ) throws -> CodexPluginSetupPinnedArtifact {
        let failure = CoordinatorError("codex_plugin_setup_signature_invalid")
        guard executable.isFileURL,
              executable.path.hasPrefix("/"),
              !executable.path.utf8.contains(0)
        else { throw failure }

        let descriptor = open(
            executable.path,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else { throw failure }
        defer { close(descriptor) }
        try requireBeforeDeadline(
            deadlineNanoseconds,
            monotonicNow: monotonicNow
        )

        var before = stat()
        guard fstat(descriptor, &before) == 0,
              before.st_mode & S_IFMT == S_IFREG,
              before.st_nlink == 1,
              fileIdentity(before) == expectedIdentity,
              before.st_size >= 8
        else { throw failure }

        let architecture = try machOArchitecture(
            descriptor: descriptor,
            failure: failure
        )
        let candidates = artifacts.filter { artifact in
            (expectedVersion == nil || artifact.version == expectedVersion)
                && artifact.architecture == architecture
                && artifact.executableBytes == Int64(before.st_size)
        }
        guard !candidates.isEmpty else { throw failure }

        let digest = try sha256(
            descriptor: descriptor,
            executableBytes: Int64(before.st_size),
            failure: failure,
            beforeExactEOFCheck: beforeExactEOFCheck,
            deadlineNanoseconds: deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
        var after = stat()
        var pathAfter = stat()
        // The existing process runner is URL-based rather than fd-bound. These
        // checks detect changes through the end of hashing, but deliberately do
        // not claim to eliminate a later path replacement by the same UID or
        // another authorized writer of a monitored ancestor.
        guard fstat(descriptor, &after) == 0,
              lstat(executable.path, &pathAfter) == 0,
              after.st_nlink == 1,
              pathAfter.st_nlink == 1,
              fileIdentity(after) == expectedIdentity,
              fileIdentity(pathAfter) == expectedIdentity,
              let artifact = matchingArtifact(
                version: expectedVersion,
                architecture: architecture,
                executableBytes: Int64(after.st_size),
                executableSHA256: digest,
                artifacts: candidates
              )
        else { throw failure }
        return artifact
    }

    private static func machOArchitecture(
        descriptor: Int32,
        failure: CoordinatorError
    ) throws -> UInt32 {
        var bytes = [UInt8](repeating: 0, count: 8)
        let count = bytes.withUnsafeMutableBytes { buffer -> Int in
            var result: Int
            repeat {
                result = pread(descriptor, buffer.baseAddress, buffer.count, 0)
            } while result < 0 && errno == EINTR
            return result
        }
        guard count == bytes.count,
              bytes[0] == 0xCF,
              bytes[1] == 0xFA,
              bytes[2] == 0xED,
              bytes[3] == 0xFE
        else { throw failure }
        return UInt32(bytes[4])
            | UInt32(bytes[5]) << 8
            | UInt32(bytes[6]) << 16
            | UInt32(bytes[7]) << 24
    }

    private static func sha256(
        descriptor: Int32,
        executableBytes: Int64,
        failure: CoordinatorError,
        beforeExactEOFCheck: () throws -> Void,
        deadlineNanoseconds: UInt64?,
        monotonicNow: () -> UInt64
    ) throws -> String {
        var hasher = SHA256()
        let capacity = 1024 * 1024
        let buffer = UnsafeMutableRawPointer.allocate(
            byteCount: capacity,
            alignment: MemoryLayout<UInt64>.alignment
        )
        defer { buffer.deallocate() }

        var offset: Int64 = 0
        while offset < executableBytes {
            try requireBeforeDeadline(
                deadlineNanoseconds,
                monotonicNow: monotonicNow
            )
            let requested = min(capacity, Int(executableBytes - offset))
            var count: Int
            repeat {
                count = pread(descriptor, buffer, requested, off_t(offset))
            } while count < 0 && errno == EINTR
            guard count > 0 else { throw failure }
            hasher.update(bufferPointer: UnsafeRawBufferPointer(
                start: buffer,
                count: count
            ))
            offset += Int64(count)
        }
        try beforeExactEOFCheck()
        try requireBeforeDeadline(
            deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
        var extra: UInt8 = 0
        var extraCount: Int
        repeat {
            extraCount = pread(descriptor, &extra, 1, off_t(executableBytes))
        } while extraCount < 0 && errno == EINTR
        guard extraCount == 0 else { throw failure }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func requireBeforeDeadline(
        _ deadlineNanoseconds: UInt64?,
        monotonicNow: () -> UInt64
    ) throws {
        guard let deadlineNanoseconds else { return }
        guard monotonicNow() < deadlineNanoseconds else {
            throw CoordinatorError("codex_plugin_setup_operation_timed_out")
        }
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

enum CodexPluginSetupProductionTrust {
    static let supportedPluginCLIVersions =
        CodexCompatibility.pluginCLISupportedVersions
    private static let expectedIdentifier = "codex"
    private static let expectedTeamIdentifier = "2DC432GLL2"
    private static let maximumVersionOutputBytes = 4_096

    static func qualify(
        sourceURL: URL,
        processRunner: CodexPluginSetupProcessRunning,
        deadlineNanoseconds: UInt64? = nil,
        monotonicNow: @escaping CodexPluginSetupMonotonicNow = {
            DispatchTime.now().uptimeNanoseconds
        }
    ) throws -> CodexPluginSetupQualifiedExecutable {
        let gate = CodexRuntimeTrustGate()
        return try qualify(
            sourceURL: sourceURL,
            processRunner: processRunner,
            trustInspector: gate.inspect,
            signatureValidator: validateOfficialSignature,
            pinnedExecutableValidator: {
                try CodexPluginSetupPinnedExecutableTrust.validate(
                    executable: $0,
                    expectedIdentity: $1,
                    expectedVersion: $2,
                    deadlineNanoseconds: deadlineNanoseconds,
                    monotonicNow: monotonicNow
                )
            },
            deadlineNanoseconds: deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
    }

    static func qualify(
        sourceURL: URL,
        processRunner: CodexPluginSetupProcessRunning,
        trustInspector: CodexPluginSetupTrustInspecting,
        signatureValidator: CodexPluginSetupSignatureValidating,
        pinnedExecutableValidator: CodexPluginSetupPinnedExecutableValidating,
        deadlineNanoseconds: UInt64? = nil,
        monotonicNow: @escaping CodexPluginSetupMonotonicNow = {
            DispatchTime.now().uptimeNanoseconds
        }
    ) throws -> CodexPluginSetupQualifiedExecutable {
        try requireBeforeDeadline(
            deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
        let before = try trustInspector(sourceURL)
        try requireBeforeDeadline(
            deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
        let canonicalURL = URL(fileURLWithPath: before.canonicalPath)
        let pinnedArtifact = try validateExecutableTrust(
            canonicalURL,
            expectedIdentity: before.targetIdentity,
            expectedVersion: nil,
            signatureValidator: signatureValidator,
            pinnedExecutableValidator: pinnedExecutableValidator
        )

        let result = try processRunner(
            canonicalURL,
            ["--version"],
            try remainingTimeout(
                maximumMilliseconds: 5_000,
                deadlineNanoseconds: deadlineNanoseconds,
                monotonicNow: monotonicNow
            )
        )
        try requireBeforeDeadline(
            deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
        let version = try supportedVersion(from: result)
        guard pinnedArtifact == nil || pinnedArtifact?.version == version
        else { throw CoordinatorError("codex_plugin_setup_signature_invalid") }

        let after = try trustInspector(sourceURL)
        try requireBeforeDeadline(
            deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
        guard before == after else {
            throw CodexRuntimeTrustError.changedDuringQualification
        }
        let pinnedTrustEvidence: CodexPluginSetupPinnedTrustEvidence?
        if let pinnedArtifact {
            pinnedTrustEvidence = CodexPluginSetupPinnedTrustEvidence(
                trustSnapshot: after,
                artifact: pinnedArtifact
            )
        } else {
            _ = try validateExecutableTrust(
                URL(fileURLWithPath: after.canonicalPath),
                expectedIdentity: after.targetIdentity,
                expectedVersion: version,
                signatureValidator: signatureValidator,
                pinnedExecutableValidator: pinnedExecutableValidator
            )
            pinnedTrustEvidence = nil
        }
        try requireBeforeDeadline(
            deadlineNanoseconds,
            monotonicNow: monotonicNow
        )
        return CodexPluginSetupQualifiedExecutable(
            sourceURL: URL(fileURLWithPath: after.stableSourcePath),
            canonicalURL: URL(fileURLWithPath: after.canonicalPath),
            version: version,
            trustSnapshot: after,
            pinnedTrustEvidence: pinnedTrustEvidence
        )
    }

    private static func remainingTimeout(
        maximumMilliseconds: Int,
        deadlineNanoseconds: UInt64?,
        monotonicNow: CodexPluginSetupMonotonicNow
    ) throws -> Int {
        guard let deadlineNanoseconds else { return maximumMilliseconds }
        let current = monotonicNow()
        guard current < deadlineNanoseconds else {
            throw CoordinatorError("codex_plugin_setup_operation_timed_out")
        }
        let remaining = deadlineNanoseconds - current
        let milliseconds = Int((remaining - 1) / 1_000_000 + 1)
        return min(maximumMilliseconds, max(1, milliseconds))
    }

    private static func requireBeforeDeadline(
        _ deadlineNanoseconds: UInt64?,
        monotonicNow: CodexPluginSetupMonotonicNow
    ) throws {
        guard let deadlineNanoseconds else { return }
        guard monotonicNow() < deadlineNanoseconds else {
            throw CoordinatorError("codex_plugin_setup_operation_timed_out")
        }
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
        let gate = CodexRuntimeTrustGate()
        return try revalidate(
            selection,
            trustInspector: gate.inspect,
            signatureValidator: validateOfficialSignature,
            pinnedExecutableValidator: {
                try CodexPluginSetupPinnedExecutableTrust.validate(
                    executable: $0,
                    expectedIdentity: $1,
                    expectedVersion: $2
                )
            }
        )
    }

    static func revalidate(
        _ selection: CodexPluginSetupQualifiedExecutable,
        trustInspector: CodexPluginSetupTrustInspecting,
        signatureValidator: CodexPluginSetupSignatureValidating,
        pinnedExecutableValidator: CodexPluginSetupPinnedExecutableValidating
    ) throws -> URL {
        guard let expected = selection.trustSnapshot,
              expected.stableSourcePath == selection.sourceURL.path,
              expected.canonicalPath == selection.canonicalURL.path,
              supportedPluginCLIVersions.contains(selection.version)
        else { throw CodexRuntimeTrustError.approvalDrift }
        let current = try trustInspector(selection.sourceURL)
        guard current == expected else { throw CodexRuntimeTrustError.approvalDrift }
        let executable = URL(fileURLWithPath: current.canonicalPath)
        if let pinned = selection.pinnedTrustEvidence {
            guard pinned.trustSnapshot == current,
                  pinned.artifact.version == selection.version
            else { throw CodexRuntimeTrustError.approvalDrift }
            // The runner still launches by canonical URL. This structural
            // snapshot revalidation intentionally preserves the documented
            // same-UID post-check/pre-spawn replacement residual; eliminating
            // it requires an fd-bound launcher rather than another full hash.
            return executable
        }
        _ = try validateExecutableTrust(
            executable,
            expectedIdentity: current.targetIdentity,
            expectedVersion: selection.version,
            signatureValidator: signatureValidator,
            pinnedExecutableValidator: pinnedExecutableValidator
        )
        return executable
    }

    private static func validateExecutableTrust(
        _ executable: URL,
        expectedIdentity: CodexRuntimeFileIdentity,
        expectedVersion: String?,
        signatureValidator: CodexPluginSetupSignatureValidating,
        pinnedExecutableValidator: CodexPluginSetupPinnedExecutableValidating
    ) throws -> CodexPluginSetupPinnedArtifact? {
        do {
            try signatureValidator(executable)
            return nil
        } catch let error as CoordinatorError
            where error.code == "codex_plugin_setup_signature_invalid"
        {
            return try pinnedExecutableValidator(
                executable,
                expectedIdentity,
                expectedVersion
            )
        }
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
    private static let maximumOperationTimeoutMilliseconds = 45_000

    private let marketplaceRoot: URL?
    private let requireStandardApplicationRoot: Bool
    private let executableQualifier: CodexPluginSetupExecutableQualifying
    private let executableRevalidator: CodexPluginSetupExecutableRevalidating
    private let processRunner: CodexPluginSetupProcessRunning
    private let bundleRevalidator: CodexPluginSetupBundleRevalidating
    private let mutationLock: CodexPluginSetupMutationLock?
    private let requiresMutationLock: Bool
    private let monotonicNow: CodexPluginSetupMonotonicNow
    private let operationTimeoutMilliseconds: Int

    private(set) var state: CodexPluginSetupState = .unchecked

    init(
        marketplaceRoot: URL,
        requireStandardApplicationRoot: Bool = false,
        executableResolver: @escaping CodexPluginSetupExecutableResolving,
        processRunner: @escaping CodexPluginSetupProcessRunning,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating = {},
        mutationLock: CodexPluginSetupMutationLock? = nil,
        monotonicNow: @escaping CodexPluginSetupMonotonicNow = {
            DispatchTime.now().uptimeNanoseconds
        },
        operationTimeoutMilliseconds: Int = maximumOperationTimeoutMilliseconds
    ) {
        self.marketplaceRoot = marketplaceRoot
        self.requireStandardApplicationRoot = requireStandardApplicationRoot
        executableQualifier = { _ in
            .testOnly(url: try executableResolver())
        }
        executableRevalidator = { $0.canonicalURL }
        self.processRunner = processRunner
        self.bundleRevalidator = bundleRevalidator
        self.mutationLock = mutationLock
        requiresMutationLock = false
        self.monotonicNow = monotonicNow
        self.operationTimeoutMilliseconds = max(
            1,
            min(operationTimeoutMilliseconds, Self.maximumOperationTimeoutMilliseconds)
        )
    }

    init(
        marketplaceRoot: URL,
        requireStandardApplicationRoot: Bool = false,
        executableQualifier: @escaping CodexPluginSetupExecutableQualifying,
        executableRevalidator: @escaping CodexPluginSetupExecutableRevalidating,
        processRunner: @escaping CodexPluginSetupProcessRunning,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating = {},
        mutationLock: CodexPluginSetupMutationLock? = nil,
        monotonicNow: @escaping CodexPluginSetupMonotonicNow = {
            DispatchTime.now().uptimeNanoseconds
        },
        operationTimeoutMilliseconds: Int = maximumOperationTimeoutMilliseconds
    ) {
        self.marketplaceRoot = marketplaceRoot
        self.requireStandardApplicationRoot = requireStandardApplicationRoot
        self.executableQualifier = executableQualifier
        self.executableRevalidator = executableRevalidator
        self.processRunner = processRunner
        self.bundleRevalidator = bundleRevalidator
        self.mutationLock = mutationLock
        requiresMutationLock = false
        self.monotonicNow = monotonicNow
        self.operationTimeoutMilliseconds = max(
            1,
            min(operationTimeoutMilliseconds, Self.maximumOperationTimeoutMilliseconds)
        )
    }

    private init(
        optionalMarketplaceRoot: URL?,
        requireStandardApplicationRoot: Bool,
        executableQualifier: @escaping CodexPluginSetupExecutableQualifying,
        executableRevalidator: @escaping CodexPluginSetupExecutableRevalidating,
        processRunner: @escaping CodexPluginSetupProcessRunning,
        bundleRevalidator: @escaping CodexPluginSetupBundleRevalidating,
        mutationLock: CodexPluginSetupMutationLock?,
        requiresMutationLock: Bool,
        monotonicNow: @escaping CodexPluginSetupMonotonicNow,
        operationTimeoutMilliseconds: Int
    ) {
        marketplaceRoot = optionalMarketplaceRoot
        self.requireStandardApplicationRoot = requireStandardApplicationRoot
        self.executableQualifier = executableQualifier
        self.executableRevalidator = executableRevalidator
        self.processRunner = processRunner
        self.bundleRevalidator = bundleRevalidator
        self.mutationLock = mutationLock
        self.requiresMutationLock = requiresMutationLock
        self.monotonicNow = monotonicNow
        self.operationTimeoutMilliseconds = max(
            1,
            min(operationTimeoutMilliseconds, Self.maximumOperationTimeoutMilliseconds)
        )
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
            executableQualifier: { timeoutMilliseconds in
                let startedAt = DispatchTime.now().uptimeNanoseconds
                let budget = UInt64(timeoutMilliseconds) * 1_000_000
                let deadline = startedAt > UInt64.max - budget
                    ? UInt64.max
                    : startedAt + budget
                let candidates = CodexPluginSetupExecutableResolver.candidateURLs(
                    environment: environment
                )
                return try CodexPluginSetupExecutableResolver.qualifyFirst(
                    candidates: candidates,
                    qualifier: { sourceURL in
                        try CodexPluginSetupProductionTrust.qualify(
                            sourceURL: sourceURL,
                            processRunner: processRunner,
                            deadlineNanoseconds: deadline
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
            requiresMutationLock: true,
            monotonicNow: { DispatchTime.now().uptimeNanoseconds },
            operationTimeoutMilliseconds: Self.maximumOperationTimeoutMilliseconds
        )
    }

    func inspect() async -> CodexPluginSetupState {
        var operation = makeOperationContext()
        let inspection = performInspection(operation: &operation)
        state = inspection.state
        return state
    }

    func connect() async -> CodexPluginSetupState {
        withMutationLock {
            var operation = makeOperationContext()
            return connectWhileLocked(operation: &operation)
        }
    }

    private func connectWhileLocked(
        operation: inout OperationContext
    ) -> CodexPluginSetupState {
        let initial = performInspection(operation: &operation)
        state = initial.state

        switch initial.state {
        case .installedNeedsHookReview:
            return state
        case .notInstalled, .marketplaceInstalledNeedsPlugin:
            return connectNotInstalled(initial, operation: &operation)
        case .updateAvailable:
            return updateOwnedPlugin(initial, operation: &operation)
        case .unchecked, .unavailable, .legacyInstallationDetected, .conflict, .error:
            return state
        }
    }

    func disconnect() async -> CodexPluginSetupState {
        withMutationLock {
            var operation = makeOperationContext()
            return disconnectWhileLocked(operation: &operation)
        }
    }

    private func disconnectWhileLocked(
        operation: inout OperationContext
    ) -> CodexPluginSetupState {
        let initial = performInspection(operation: &operation)
        state = initial.state

        switch initial.state {
        case .notInstalled:
            return state
        case .marketplaceInstalledNeedsPlugin:
            return removeOwnedMarketplace(operation: &operation)
        case .installedNeedsHookReview, .updateAvailable:
            // Re-read ownership immediately before the first destructive call.
            // Another `codex plugin` process does not share Blabee's lock.
            let destructive = performInspection(operation: &operation)
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
                expectation: .pluginRemoved(selector: Self.pluginSelector),
                operation: &operation
            )
            guard removal.succeeded else {
                state = .error(code: removal.errorCode
                    ?? "plugin_remove_unverified")
                return state
            }
            let afterPluginRemoval = performInspection(operation: &operation)
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
            return removeOwnedMarketplace(operation: &operation)
        case .unchecked, .unavailable, .legacyInstallationDetected, .conflict, .error:
            return state
        }
    }

    func migrateLegacyInstallation(
        confirmation: CodexPluginSetupLegacyMigrationConfirmation
    ) async -> CodexPluginSetupState {
        withMutationLock {
            var operation = makeOperationContext()
            return migrateLegacyInstallationWhileLocked(
                confirmation: confirmation,
                operation: &operation
            )
        }
    }

    private func migrateLegacyInstallationWhileLocked(
        confirmation: CodexPluginSetupLegacyMigrationConfirmation,
        operation: inout OperationContext
    ) -> CodexPluginSetupState {
        let initial = performInspection(operation: &operation)
        state = initial.state
        guard case let .legacyInstallationDetected(_, inspectedConfirmation) = initial.state,
              inspectedConfirmation == confirmation,
              let legacy = initial.context?.legacyInstallation,
              legacy.migrationConfirmation == confirmation,
              let confirmedExecutable = initial.context?.executable
        else { return state }

        // `codex plugin remove` has no compare-and-remove token. Complete the
        // bundle/executable trust preflight first, then make the legacy
        // ownership and descriptor identities the final checked precondition
        // before each destructive process call. This narrows, but cannot make
        // atomic, the final interval before the external CLI consumes paths.
        // A retry after a partial removal resumes at the Marketplace step and
        // never repeats Plugin removal.
        if legacy.pluginIsInstalled {
            let preparedPluginRemoval: PreparedMutation
            do {
                preparedPluginRemoval = try prepareMutation(
                    executable: confirmedExecutable,
                    operation: operation
                )
            } catch let error as CoordinatorError
                where error.code == "codex_plugin_setup_operation_timed_out"
            {
                state = .error(code: error.code)
                return state
            } catch {
                state = .error(code: "legacy_plugin_remove_unverified")
                return state
            }

            switch verifyLegacyOwnership(legacy, operation: &operation) {
            case let .installation(executable)
                where executable == preparedPluginRemoval.selection:
                break
            case .installation:
                state = .error(code: "legacy_installation_executable_changed")
                return state
            case .marketplaceOnly:
                state = .conflict(
                    reason: "이전 Blabee Plugin이 마이그레이션 전에 변경되었습니다."
                )
                return state
            case .absent:
                state = .conflict(
                    reason: "이전 Blabee Marketplace가 마이그레이션 전에 변경되었습니다."
                )
                return state
            case let .conflict(reason):
                state = .conflict(reason: reason)
                return state
            case let .error(code):
                state = .error(code: code)
                return state
            }

            let pluginRemoval = runPreparedMutation(
                preparedPluginRemoval,
                arguments: ["plugin", "remove", legacy.pluginSelector, "--json"],
                expectation: .pluginRemoved(selector: legacy.pluginSelector),
                operation: &operation
            )
            guard pluginRemoval.succeeded else {
                state = .error(code: pluginRemoval.errorCode
                    ?? "legacy_plugin_remove_unverified")
                return state
            }
        }

        let preparedMarketplaceRemoval: PreparedMutation
        do {
            preparedMarketplaceRemoval = try prepareMutation(
                executable: confirmedExecutable,
                operation: operation
            )
        } catch let error as CoordinatorError
            where error.code == "codex_plugin_setup_operation_timed_out"
        {
            state = .error(code: error.code)
            return state
        } catch {
            state = .error(code: "legacy_marketplace_remove_unverified")
            return state
        }

        switch verifyLegacyOwnership(legacy, operation: &operation) {
        case let .marketplaceOnly(executable)
            where executable == preparedMarketplaceRemoval.selection:
            break
        case .marketplaceOnly:
            state = .error(code: "legacy_installation_executable_changed")
            return state
        case .installation:
            state = legacy.pluginIsInstalled
                ? .error(code: "legacy_plugin_remove_not_applied")
                : .conflict(
                    reason: "제거한 이전 Blabee Plugin이 마이그레이션 중 다시 나타났습니다."
                )
            return state
        case .absent:
            state = .conflict(
                reason: "이전 Blabee Marketplace가 마이그레이션 중 외부에서 변경되었습니다."
            )
            return state
        case let .conflict(reason):
            state = .conflict(reason: reason)
            return state
        case let .error(code):
            state = .error(code: code)
            return state
        }

        let marketplaceRemoval = runPreparedMutation(
            preparedMarketplaceRemoval,
            arguments: [
                "plugin", "marketplace", "remove",
                legacy.marketplaceName, "--json",
            ],
            expectation: .marketplaceRemoved(name: legacy.marketplaceName),
            operation: &operation
        )
        guard marketplaceRemoval.succeeded else {
            state = .error(code: marketplaceRemoval.errorCode
                ?? "legacy_marketplace_remove_unverified")
            return state
        }

        switch verifyLegacyOwnership(legacy, operation: &operation) {
        case .absent:
            break
        case .marketplaceOnly:
            state = .error(code: "legacy_marketplace_remove_not_applied")
            return state
        case .installation:
            state = .conflict(
                reason: "제거한 이전 Blabee Plugin이 마이그레이션 중 다시 나타났습니다."
            )
            return state
        case let .conflict(reason):
            state = .conflict(reason: reason)
            return state
        case let .error(code):
            state = .error(code: code)
            return state
        }

        let current = performInspection(operation: &operation)
        switch current.state {
        case .notInstalled, .marketplaceInstalledNeedsPlugin:
            return connectNotInstalled(current, operation: &operation)
        case .installedNeedsHookReview, .updateAvailable:
            state = current.state
            return state
        case .unchecked, .unavailable, .legacyInstallationDetected, .conflict, .error:
            state = current.state
            return state
        }
    }

    private func verifyLegacyOwnership(
        _ expected: LegacyInstallation,
        operation: inout OperationContext
    ) -> LegacyOwnershipVerification {
        let executable: CodexPluginSetupQualifiedExecutable
        let marketplaces: [MarketplaceRecord]
        let plugins: [PluginRecord]
        do {
            executable = try qualifiedExecutable(operation: &operation)
            marketplaces = try queryMarketplaces(
                executable: executable,
                operation: &operation
            )
            plugins = try queryInstalledPlugins(
                executable: executable,
                operation: &operation
            )
        } catch let error as CoordinatorError {
            return .error(code: error.code)
        } catch {
            return .error(code: "legacy_installation_reinspection_failed")
        }

        let namedMarketplaces = marketplaces.filter {
            $0.name == expected.marketplaceName
        }
        let legacyMarketplaceCandidates = marketplaces.filter {
            isLegacyMarketplaceName($0.name)
        }
        let legacyMarketplaces = legacyMarketplaceCandidates.filter {
            isExactLegacyMarketplace($0)
        }
        guard legacyMarketplaces.count == legacyMarketplaceCandidates.count else {
            return .conflict(
                reason: "이전 Blabee Marketplace 이름과 경로의 결합을 확인할 수 없습니다."
            )
        }
        let currentMarketplaces = marketplaces.filter {
            $0.name == Self.marketplaceName
        }
        let marketplacePlugins = plugins.filter {
            $0.marketplaceName == expected.marketplaceName
                || $0.pluginID == expected.pluginSelector
        }
        let blabeePlugins = plugins.filter {
            $0.name == Self.pluginName
                || $0.pluginID == Self.pluginSelector
                || $0.pluginID.hasPrefix("\(Self.pluginName)@")
        }
        if namedMarketplaces.isEmpty, marketplacePlugins.isEmpty {
            guard legacyMarketplaces.isEmpty,
                  currentMarketplaces.isEmpty,
                  blabeePlugins.isEmpty
            else {
                return .conflict(
                    reason: "이전 Blabee Marketplace 제거 후 다른 Blabee 연결이 나타났습니다."
                )
            }
            return .absent
        }
        guard blabeePlugins.allSatisfy({ plugin in
            plugin.marketplaceName == expected.marketplaceName
                && plugin.pluginID == expected.pluginSelector
        }) else {
            return .conflict(
                reason: "이전 Blabee Marketplace 제거 전에 다른 Blabee Plugin이 나타났습니다."
            )
        }
        guard legacyMarketplaces.count == 1,
              legacyMarketplaces.first?.name == expected.marketplaceName,
              currentMarketplaces.isEmpty,
              namedMarketplaces.count == 1,
              let marketplace = namedMarketplaces.first,
              normalizedPath(marketplace.root)
                == normalizedPath(expected.marketplaceRoot)
        else {
            return .conflict(
                reason: "이전 Blabee Marketplace의 경로 또는 개수가 변경되었습니다."
            )
        }
        guard marketplacePlugins.count <= 1 else {
            return .conflict(
                reason: "이전 Blabee Marketplace에 여러 Plugin이 연결되어 있어 변경하지 않습니다."
            )
        }
        if let plugin = marketplacePlugins.first {
            guard isExactLegacyPlugin(plugin, marketplace: marketplace),
                  plugin.pluginID == expected.pluginSelector,
                  plugin.version == expected.pluginVersion,
                  normalizedPath(legacyPluginRoot(for: marketplace.root))
                    == normalizedPath(expected.pluginRoot)
            else {
                return .conflict(
                    reason: "이전 Blabee Plugin의 소유권 정보가 변경되었습니다."
                )
            }
        }

        // Keep descriptor-derived filesystem identity as the final target
        // precondition. Callers that remove legacy content invoke the prepared
        // subprocess immediately after this verification returns.
        let currentFilesystemIdentity: CodexPluginSetupLegacyFilesystemIdentity
        do {
            currentFilesystemIdentity = try stableLegacyFilesystemIdentity(
                marketplaceRoot: expected.marketplaceRoot,
                pluginRoot: expected.pluginRoot
            )
        } catch let error as CoordinatorError {
            return .error(code: error.code)
        } catch {
            return .error(code: "legacy_installation_identity_unavailable")
        }
        guard currentFilesystemIdentity == expected.filesystemIdentity else {
            return .conflict(
                reason: "이전 Blabee Marketplace 또는 Plugin 파일이 변경되었습니다."
            )
        }
        return marketplacePlugins.isEmpty
            ? .marketplaceOnly(executable: executable)
            : .installation(executable: executable)
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

    private func makeOperationContext() -> OperationContext {
        let startedAt = monotonicNow()
        let budget = UInt64(operationTimeoutMilliseconds) * 1_000_000
        let deadline = startedAt > UInt64.max - budget
            ? UInt64.max
            : startedAt + budget
        return OperationContext(deadlineNanoseconds: deadline)
    }

    private func qualifiedExecutable(
        operation: inout OperationContext
    ) throws -> CodexPluginSetupQualifiedExecutable {
        let timeout = try remainingTimeout(
            maximumMilliseconds: operationTimeoutMilliseconds,
            operation: operation
        )
        if let executable = operation.executable {
            return executable
        }
        let executable = try executableQualifier(timeout)
        _ = try remainingTimeout(
            maximumMilliseconds: Self.inspectionTimeoutMilliseconds,
            operation: operation
        )
        operation.executable = executable
        return executable
    }

    private func remainingTimeout(
        maximumMilliseconds: Int,
        operation: OperationContext
    ) throws -> Int {
        let current = monotonicNow()
        guard current < operation.deadlineNanoseconds else {
            throw CoordinatorError("codex_plugin_setup_operation_timed_out")
        }
        let remainingNanoseconds = operation.deadlineNanoseconds - current
        let remainingMilliseconds = max(
            1,
            Int((remainingNanoseconds - 1) / 1_000_000 + 1)
        )
        return min(maximumMilliseconds, remainingMilliseconds)
    }

    private func connectNotInstalled(
        _ initial: Inspection,
        operation: inout OperationContext
    ) -> CodexPluginSetupState {
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
                expectation: .marketplaceAdded(root: context.marketplaceRoot),
                operation: &operation
            )
            let afterMarketplaceAdd = performInspection(operation: &operation)
            if case .installedNeedsHookReview = afterMarketplaceAdd.state {
                state = afterMarketplaceAdd.state
                return state
            }
            guard case .marketplaceInstalledNeedsPlugin = afterMarketplaceAdd.state,
                  afterMarketplaceAdd.context?.marketplaceIsExact == true
            else {
                if case .notInstalled = afterMarketplaceAdd.state {
                    state = .error(code: addResult.errorCode ?? (
                        addResult.succeeded
                            ? "marketplace_add_not_applied"
                            : "marketplace_add_failed"
                    ))
                } else {
                    state = afterMarketplaceAdd.state
                }
                return state
            }
            guard addResult.succeeded else {
                state = .error(code: addResult.errorCode
                    ?? "marketplace_add_unverified")
                return state
            }
            // Only the strict Codex receipt's `alreadyAdded: false`, combined
            // with this exact post-state, authorizes bounded cleanup ownership.
            addedMarketplace = addResult.createdMarketplace
        }

        let refreshed = performInspection(operation: &operation)
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
            expectation: .pluginAdded(
                selector: Self.pluginSelector,
                version: bundledVersion
            ),
            operation: &operation
        )
        let final = performInspection(operation: &operation)
        if case .installedNeedsHookReview = final.state {
            state = addResult.succeeded
                ? final.state
                : .error(code: addResult.errorCode
                    ?? "plugin_add_unverified")
            return state
        }

        if case .marketplaceInstalledNeedsPlugin = final.state {
            guard addedMarketplace else {
                state = final.state
                return state
            }
            let cleanupState = cleanupNewMarketplaceIfUnambiguous(
                final,
                operation: &operation
            )
            if case .notInstalled = cleanupState {
                state = .error(code: addResult.errorCode ?? (
                    addResult.succeeded
                        ? "plugin_add_not_applied"
                        : "plugin_add_failed"
                ))
            } else {
                state = cleanupState
            }
            return state
        }
        if !addResult.succeeded, case .notInstalled = final.state {
            state = .error(code: addResult.errorCode ?? "plugin_add_failed")
        } else {
            state = final.state
        }
        return state
    }

    private func updateOwnedPlugin(
        _ initial: Inspection,
        operation: inout OperationContext
    ) -> CodexPluginSetupState {
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
            expectation: .pluginAdded(
                selector: Self.pluginSelector,
                version: context.bundledVersion
            ),
            operation: &operation
        )
        let final = performInspection(operation: &operation)
        if case .installedNeedsHookReview = final.state {
            state = addResult.succeeded
                ? final.state
                : .error(code: addResult.errorCode
                    ?? "plugin_update_add_unverified")
        } else {
            state = addResult.succeeded
                ? final.state
                : .error(code: addResult.errorCode
                    ?? "plugin_update_add_failed")
        }
        return state
    }

    private func cleanupNewMarketplaceIfUnambiguous(
        _ inspection: Inspection,
        operation: inout OperationContext
    ) -> CodexPluginSetupState {
        guard case .marketplaceInstalledNeedsPlugin = inspection.state,
              let context = inspection.context,
              context.marketplaceIsExact,
              context.ownedPlugin == nil
        else { return inspection.state }

        let destructive = performInspection(operation: &operation)
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
            expectation: .marketplaceRemoved(name: Self.marketplaceName),
            operation: &operation
        )
        let final = performInspection(operation: &operation)
        return removal.succeeded
            ? final.state
            : .error(code: removal.errorCode
                ?? "marketplace_cleanup_unverified")
    }

    private func removeOwnedMarketplace(
        operation: inout OperationContext
    ) -> CodexPluginSetupState {
        let destructive = performInspection(operation: &operation)
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
            expectation: .marketplaceRemoved(name: Self.marketplaceName),
            operation: &operation
        )
        let final = performInspection(operation: &operation)
        guard removal.succeeded else {
            state = .error(code: removal.errorCode
                ?? "marketplace_remove_unverified")
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
        expectation: MutationExpectation,
        operation: inout OperationContext
    ) -> MutationResult {
        let prepared: PreparedMutation
        do {
            prepared = try prepareMutation(
                executable: executable,
                operation: operation
            )
        } catch let error as CoordinatorError
            where error.code == "codex_plugin_setup_operation_timed_out"
        {
            return .failed(code: error.code)
        } catch {
            return .failed
        }
        return runPreparedMutation(
            prepared,
            arguments: arguments,
            expectation: expectation,
            operation: &operation
        )
    }

    private func prepareMutation(
        executable: CodexPluginSetupQualifiedExecutable,
        operation: OperationContext
    ) throws -> PreparedMutation {
        _ = try remainingTimeout(
            maximumMilliseconds: Self.mutationTimeoutMilliseconds,
            operation: operation
        )
        try bundleRevalidator()
        let revalidated = try revalidatedExecutable(executable)
        // The executable check may be comparatively expensive. Re-check the
        // app payload after it, before any final target-specific precondition.
        try bundleRevalidator()
        return PreparedMutation(selection: executable, executable: revalidated)
    }

    private func runPreparedMutation(
        _ prepared: PreparedMutation,
        arguments: [String],
        expectation: MutationExpectation,
        operation: inout OperationContext
    ) -> MutationResult {
        let result: CodexPluginSetupProcessResult
        do {
            let timeout = try remainingTimeout(
                maximumMilliseconds: Self.mutationTimeoutMilliseconds,
                operation: operation
            )
            result = try processRunner(
                prepared.executable,
                arguments,
                timeout
            )
            _ = try remainingTimeout(
                maximumMilliseconds: Self.mutationTimeoutMilliseconds,
                operation: operation
            )
            _ = try revalidatedExecutable(prepared.selection)
            try bundleRevalidator()
        } catch let error as CoordinatorError
            where error.code == "codex_plugin_setup_operation_timed_out"
        {
            return .failed(code: error.code)
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
                createdMarketplace: !alreadyAdded,
                errorCode: nil
            )
        case let .pluginAdded(selector, version):
            guard boundedString(object["pluginId"], maximumBytes: 512)
                    == selector,
                  boundedString(object["version"], maximumBytes: 128) == version
            else { return .failed }
        case let .pluginRemoved(selector):
            guard boundedString(object["pluginId"], maximumBytes: 512)
                    == selector
            else { return .failed }
        case let .marketplaceRemoved(name):
            guard boundedString(object["marketplaceName"], maximumBytes: 256)
                    == name
            else { return .failed }
        }
        return MutationResult(
            succeeded: true,
            createdMarketplace: false,
            errorCode: nil
        )
    }

    private func performInspection(
        operation: inout OperationContext
    ) -> Inspection {
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
            executable = try qualifiedExecutable(operation: &operation)
        } catch let error as CoordinatorError
            where error.code == "codex_plugin_setup_operation_timed_out"
        {
            return Inspection(state: .error(code: error.code), context: nil)
        } catch {
            return Inspection(
                state: .unavailable(reason: "안전하고 지원되는 Codex CLI를 찾을 수 없습니다."),
                context: nil
            )
        }

        let marketplaces: [MarketplaceRecord]
        do {
            marketplaces = try queryMarketplaces(
                executable: executable,
                operation: &operation
            )
        } catch let error as CoordinatorError {
            return Inspection(state: .error(code: error.code), context: nil)
        } catch {
            return Inspection(state: .error(code: "marketplace_list_failed"), context: nil)
        }

        let plugins: [PluginRecord]
        do {
            plugins = try queryInstalledPlugins(
                executable: executable,
                operation: &operation
            )
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
        let legacyMarketplaceCandidates = marketplaces.filter {
            isLegacyMarketplaceName($0.name)
        }
        let legacyMarketplaces = legacyMarketplaceCandidates.filter {
            isExactLegacyMarketplace($0)
        }
        guard legacyMarketplaces.count == legacyMarketplaceCandidates.count else {
            return Inspection(
                state: .conflict(
                    reason: "이전 Blabee Marketplace 이름과 경로의 결합을 확인할 수 없습니다."
                ),
                context: nil
            )
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
        var legacyInstallation: LegacyInstallation?
        if let plugin = blabeePlugins.first {
            if isExactOwnedPlugin(
                plugin,
                marketplaceIsExact: marketplaceIsExact,
                pluginRoot: configuration.pluginRoot
            ) {
                guard legacyMarketplaces.isEmpty else {
                    return Inspection(
                        state: .conflict(
                            reason: "현재 연결과 이전 Blabee 테스트 Marketplace가 함께 있어 자동 변경하지 않습니다."
                        ),
                        context: nil
                    )
                }
                ownedPlugin = plugin
            } else if isLegacyMarketplaceName(plugin.marketplaceName) {
                let matchingMarketplaces = marketplaces.filter {
                    $0.name == plugin.marketplaceName
                }
                let marketplacePlugins = plugins.filter {
                    $0.marketplaceName == plugin.marketplaceName
                }
                guard legacyMarketplaces.count == 1,
                      matchingMarketplaces.count == 1,
                      marketplacePlugins.count == 1,
                      let marketplace = matchingMarketplaces.first,
                      isExactLegacyPlugin(plugin, marketplace: marketplace)
                else {
                    return Inspection(
                        state: .conflict(
                            reason: "이전 Blabee 테스트 연결의 소유권을 정확히 확인할 수 없습니다."
                        ),
                        context: nil
                    )
                }
                let pluginRoot = legacyPluginRoot(for: marketplace.root)
                do {
                    legacyInstallation = LegacyInstallation(
                        marketplaceName: plugin.marketplaceName,
                        marketplaceRoot: marketplace.root,
                        pluginSelector: plugin.pluginID,
                        pluginRoot: pluginRoot,
                        pluginIsInstalled: true,
                        pluginVersion: plugin.version,
                        filesystemIdentity: try stableLegacyFilesystemIdentity(
                            marketplaceRoot: marketplace.root,
                            pluginRoot: pluginRoot
                        )
                    )
                } catch let error as CoordinatorError {
                    return Inspection(state: .error(code: error.code), context: nil)
                } catch {
                    return Inspection(
                        state: .error(code: "legacy_installation_identity_unavailable"),
                        context: nil
                    )
                }
            } else {
                return Inspection(
                    state: .conflict(reason: "기존 Blabee Plugin이 다른 Marketplace 또는 경로를 사용합니다."),
                    context: nil
                )
            }
        }
        if blabeePlugins.isEmpty, !legacyMarketplaces.isEmpty {
            let legacyMarketplacePlugins = plugins.filter { plugin in
                legacyMarketplaces.contains { marketplace in
                    plugin.marketplaceName == marketplace.name
                        || plugin.pluginID == "\(Self.pluginName)@\(marketplace.name)"
                }
            }
            guard legacyMarketplaces.count == 1,
                  !marketplaceIsExact,
                  legacyMarketplacePlugins.isEmpty,
                  let marketplace = legacyMarketplaces.first
            else {
                return Inspection(
                    state: .conflict(
                        reason: "Plugin 없이 남은 이전 Blabee 테스트 Marketplace의 소유권을 정확히 확인할 수 없습니다."
                    ),
                    context: nil
                )
            }
            let pluginRoot = legacyPluginRoot(for: marketplace.root)
            do {
                legacyInstallation = LegacyInstallation(
                    marketplaceName: marketplace.name,
                    marketplaceRoot: marketplace.root,
                    pluginSelector: "\(Self.pluginName)@\(marketplace.name)",
                    pluginRoot: pluginRoot,
                    pluginIsInstalled: false,
                    pluginVersion: nil,
                    filesystemIdentity: try stableLegacyFilesystemIdentity(
                        marketplaceRoot: marketplace.root,
                        pluginRoot: pluginRoot
                    )
                )
            } catch let error as CoordinatorError {
                return Inspection(state: .error(code: error.code), context: nil)
            } catch {
                return Inspection(
                    state: .error(code: "legacy_installation_identity_unavailable"),
                    context: nil
                )
            }
        }

        let context = InspectionContext(
            executable: executable,
            marketplaceRoot: configuration.marketplaceRoot,
            bundledVersion: configuration.pluginVersion,
            marketplaceIsExact: marketplaceIsExact,
            ownedPlugin: ownedPlugin,
            legacyInstallation: legacyInstallation
        )
        if let legacyInstallation {
            return Inspection(
                state: .legacyInstallationDetected(
                    marketplaceName: legacyInstallation.marketplaceName,
                    confirmation: legacyInstallation.migrationConfirmation
                ),
                context: context
            )
        }
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
        guard marketplaceIsExact,
              plugin.pluginID == Self.pluginSelector,
              plugin.name == Self.pluginName,
              plugin.marketplaceName == Self.marketplaceName,
              plugin.installed,
              plugin.sourceKind == "local",
              let sourcePath = plugin.sourcePath
        else { return false }
        return normalizedPath(sourcePath) == normalizedPath(pluginRoot)
    }

    private func isLegacyMarketplaceName(_ name: String) -> Bool {
        let prefix = "blabee-local-dogfood-"
        guard name.hasPrefix(prefix) else { return false }
        let suffix = name.dropFirst(prefix.count)
        return suffix.utf8.count == 12 && suffix.utf8.allSatisfy {
            (48 ... 57).contains($0) || (97 ... 102).contains($0)
        }
    }

    private func isExactLegacyMarketplace(_ marketplace: MarketplaceRecord) -> Bool {
        guard isLegacyMarketplaceName(marketplace.name) else { return false }
        let marketplaceRoot = marketplace.root.standardizedFileURL
        guard marketplaceRoot.isFileURL,
              marketplaceRoot.lastPathComponent == "marketplace"
        else { return false }
        let outputRoot = marketplaceRoot.deletingLastPathComponent().standardizedFileURL
        let suffix = SHA256.hash(data: Data(outputRoot.path.utf8))
            .prefix(6)
            .map { String(format: "%02x", $0) }
            .joined()
        return marketplace.name == "blabee-local-dogfood-\(suffix)"
    }

    private func legacyPluginRoot(for marketplaceRoot: URL) -> URL {
        marketplaceRoot.standardizedFileURL
            .appendingPathComponent("plugins", isDirectory: true)
            .appendingPathComponent(Self.pluginName, isDirectory: true)
            .standardizedFileURL
    }

    private func isExactLegacyPlugin(
        _ plugin: PluginRecord,
        marketplace: MarketplaceRecord
    ) -> Bool {
        guard plugin.pluginID == "\(Self.pluginName)@\(marketplace.name)",
              plugin.name == Self.pluginName,
              plugin.marketplaceName == marketplace.name,
              plugin.installed,
              plugin.enabled,
              plugin.sourceKind == "local",
              let sourcePath = plugin.sourcePath,
              sourcePath.isFileURL
        else { return false }
        let expectedRoot = legacyPluginRoot(for: marketplace.root)
        return normalizedPath(sourcePath) == normalizedPath(expectedRoot)
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
        executable: CodexPluginSetupQualifiedExecutable,
        operation: inout OperationContext
    ) throws -> [MarketplaceRecord] {
        let object = try queryObject(
            executable: executable,
            arguments: ["plugin", "marketplace", "list", "--json"],
            failureCode: "marketplace_list_failed",
            operation: &operation
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
        executable: CodexPluginSetupQualifiedExecutable,
        operation: inout OperationContext
    ) throws -> [PluginRecord] {
        let object = try queryObject(
            executable: executable,
            arguments: ["plugin", "list", "--json"],
            failureCode: "plugin_list_failed",
            operation: &operation
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
                  let sourceKind = boundedString(source["source"], maximumBytes: 64)
            else { throw CoordinatorError("plugin_list_malformed") }
            let sourcePath: URL?
            if sourceKind == "local" {
                guard let localPath = boundedAbsoluteURL(source["path"])
                else { throw CoordinatorError("plugin_list_malformed") }
                sourcePath = localPath
            } else {
                sourcePath = nil
            }
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
        failureCode: String,
        operation: inout OperationContext
    ) throws -> [String: Any] {
        let result: CodexPluginSetupProcessResult
        do {
            let revalidated = try revalidatedExecutable(executable)
            let timeout = try remainingTimeout(
                maximumMilliseconds: Self.inspectionTimeoutMilliseconds,
                operation: operation
            )
            result = try processRunner(
                revalidated,
                arguments,
                timeout
            )
            _ = try remainingTimeout(
                maximumMilliseconds: Self.inspectionTimeoutMilliseconds,
                operation: operation
            )
            _ = try revalidatedExecutable(executable)
        } catch let error as CoordinatorError
            where error.code == "codex_plugin_setup_operation_timed_out"
        {
            throw error
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

    private func stableLegacyFilesystemIdentity(
        marketplaceRoot: URL,
        pluginRoot: URL
    ) throws -> CodexPluginSetupLegacyFilesystemIdentity {
        func readIdentity() throws -> CodexPluginSetupLegacyFilesystemIdentity {
            try CodexPluginSetupLegacyFilesystemIdentity(
                marketplaceRoot: legacyPathIdentity(
                    marketplaceRoot,
                    expectedType: mode_t(S_IFDIR)
                ),
                marketplaceManifest: legacyPathIdentity(
                    marketplaceRoot.appendingPathComponent(
                        ".agents/plugins/marketplace.json",
                        isDirectory: false
                    ),
                    expectedType: mode_t(S_IFREG)
                ),
                pluginRoot: legacyPathIdentity(
                    pluginRoot,
                    expectedType: mode_t(S_IFDIR)
                ),
                pluginManifest: legacyPathIdentity(
                    pluginRoot.appendingPathComponent(
                        ".codex-plugin/plugin.json",
                        isDirectory: false
                    ),
                    expectedType: mode_t(S_IFREG)
                )
            )
        }

        let before = try readIdentity()
        let after = try readIdentity()
        guard before == after else {
            throw CoordinatorError("legacy_installation_identity_changed")
        }
        return after
    }

    private func legacyPathIdentity(
        _ url: URL,
        expectedType: mode_t
    ) throws -> CodexPluginSetupLegacyPathIdentity {
        let path = url.standardizedFileURL.path
        guard url.isFileURL,
              path.hasPrefix("/"),
              !path.utf8.contains(0)
        else {
            throw CoordinatorError("legacy_installation_identity_unavailable")
        }

        var namedBefore = stat()
        guard lstat(path, &namedBefore) == 0 else {
            guard errno == ENOENT else {
                throw CoordinatorError("legacy_installation_identity_unavailable")
            }
            return .missing
        }
        guard namedBefore.st_mode & mode_t(S_IFMT) == expectedType else {
            throw CoordinatorError("legacy_installation_identity_unavailable")
        }

        let descriptor = open(
            path,
            O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            throw CoordinatorError("legacy_installation_identity_unavailable")
        }
        defer { close(descriptor) }

        var descriptorInfo = stat()
        var namedAfter = stat()
        guard fstat(descriptor, &descriptorInfo) == 0,
              lstat(path, &namedAfter) == 0,
              descriptorInfo.st_mode & mode_t(S_IFMT) == expectedType,
              namedAfter.st_mode & mode_t(S_IFMT) == expectedType
        else {
            throw CoordinatorError("legacy_installation_identity_unavailable")
        }
        let descriptorIdentity = legacyFileIdentity(descriptorInfo)
        guard descriptorIdentity == legacyFileIdentity(namedBefore),
              descriptorIdentity == legacyFileIdentity(namedAfter)
        else {
            throw CoordinatorError("legacy_installation_identity_changed")
        }
        return .present(descriptorIdentity)
    }

    private func legacyFileIdentity(_ info: stat) -> CodexRuntimeFileIdentity {
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

    private struct BundledConfiguration {
        let marketplaceRoot: URL
        let pluginRoot: URL
        let pluginVersion: String
    }

    private enum MutationExpectation {
        case marketplaceAdded(root: URL)
        case pluginAdded(selector: String, version: String)
        case pluginRemoved(selector: String)
        case marketplaceRemoved(name: String)
    }

    private struct MutationResult {
        static let failed = MutationResult(
            succeeded: false,
            createdMarketplace: false,
            errorCode: nil
        )

        static func failed(code: String) -> MutationResult {
            MutationResult(
                succeeded: false,
                createdMarketplace: false,
                errorCode: code
            )
        }

        let succeeded: Bool
        let createdMarketplace: Bool
        let errorCode: String?
    }

    private struct PreparedMutation {
        let selection: CodexPluginSetupQualifiedExecutable
        let executable: URL
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
        let sourcePath: URL?
    }

    private struct InspectionContext {
        let executable: CodexPluginSetupQualifiedExecutable
        let marketplaceRoot: URL
        let bundledVersion: String
        let marketplaceIsExact: Bool
        let ownedPlugin: PluginRecord?
        let legacyInstallation: LegacyInstallation?
    }

    private struct Inspection {
        let state: CodexPluginSetupState
        let context: InspectionContext?
    }

    private struct LegacyInstallation: Equatable {
        let marketplaceName: String
        let marketplaceRoot: URL
        let pluginSelector: String
        let pluginRoot: URL
        let pluginIsInstalled: Bool
        let pluginVersion: String?
        let filesystemIdentity: CodexPluginSetupLegacyFilesystemIdentity

        var migrationConfirmation: CodexPluginSetupLegacyMigrationConfirmation {
            CodexPluginSetupLegacyMigrationConfirmation(
                marketplaceName: marketplaceName,
                marketplaceRootPath: marketplaceRoot.standardizedFileURL.path,
                pluginSelector: pluginSelector,
                pluginRootPath: pluginRoot.standardizedFileURL.path,
                pluginIsInstalled: pluginIsInstalled,
                pluginVersion: pluginVersion,
                filesystemIdentity: filesystemIdentity
            )
        }
    }

    private enum LegacyOwnershipVerification {
        case installation(executable: CodexPluginSetupQualifiedExecutable)
        case marketplaceOnly(executable: CodexPluginSetupQualifiedExecutable)
        case absent
        case conflict(reason: String)
        case error(code: String)
    }

    private struct OperationContext {
        let deadlineNanoseconds: UInt64
        var executable: CodexPluginSetupQualifiedExecutable?

        init(deadlineNanoseconds: UInt64) {
            self.deadlineNanoseconds = deadlineNanoseconds
            executable = nil
        }
    }
}
