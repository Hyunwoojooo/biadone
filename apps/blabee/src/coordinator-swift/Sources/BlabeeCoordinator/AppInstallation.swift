import Darwin
import CryptoKit
import Foundation

struct AppInstallationBundle: Equatable, Sendable {
    let runtimeIdentity: String
    let version: String
    let build: String
    var runtimeUseLeaseProtocol: String? = nil
    var runtimeUseLeasePreviousIdentities: [String] = []
    var runtimeUseLeasePayloadSupported = false
    var launcherSHA256: String? = nil

    var supportsRuntimeUseLease: Bool {
        runtimeUseLeaseProtocol == AppRuntimeUseLease.protocolVersion && runtimeUseLeasePayloadSupported
    }

    func admitsRuntimeUseLease(for previous: Self) -> Bool {
        // A target's own flag is not authority. The currently running, verified
        // installer must be this same release or explicitly admit that exact
        // previous signed runtime. Extra helpers or changed wrappers fall back.
        supportsRuntimeUseLease && previous.supportsRuntimeUseLease
            && launcherSHA256 == previous.launcherSHA256
            && (runtimeIdentity == previous.runtimeIdentity
                || runtimeUseLeasePreviousIdentities.contains(previous.runtimeIdentity))
    }
}

enum AppInstallationComparison: Equatable, Sendable {
    case freshInstall, sameIdentity, sameVersion, upgrade, downgrade, unknown
}

struct AppInstallationPlan: Sendable {
    let sourceURL: URL
    let destinationURL: URL
    let source: AppInstallationBundle
    let existing: AppInstallationBundle?
    let comparison: AppInstallationComparison
    fileprivate let sourceFile: AppInstallationFileIdentity
    fileprivate let existingFile: AppInstallationFileIdentity?
    fileprivate let parentFile: AppInstallationFileIdentity
}

struct AppInstallationReceipt: Sendable {
    let destinationURL: URL
    let backupURL: URL?
    let identity: String
}

struct AppInstallationError: Error, LocalizedError, Sendable {
    enum Code: Equatable, Sendable {
        case invalidSource, invalidDestination, identityMismatch, changedSinceInspection
        case replacementApprovalRequired, destinationActive, activityInspectionUnavailable, runtimeUseLeaseUnavailable, insufficientPermissions
        case installationBusy, sizeLimitExceeded, deadlineExceeded, copyFailed, publishFailed
        case recoveryRequired
    }

    let code: Code
    let recoveryURL: URL?

    init(_ code: Code, recoveryURL: URL? = nil) {
        self.code = code
        self.recoveryURL = recoveryURL
    }

    var errorDescription: String? { userMessage }

    var userMessage: String {
        switch code {
        case .invalidSource:
            "유효한 Blabee 앱 번들을 확인하지 못했습니다. 배포된 앱을 다시 받아 주세요."
        case .invalidDestination:
            "설치 위치나 기존 앱을 안전하게 확인하지 못했습니다. Finder에서 응용 프로그램 폴더를 확인해 주세요."
        case .identityMismatch:
            "실행 중인 앱과 설치할 앱의 서명 또는 빌드가 일치하지 않습니다. 앱을 다시 열어 주세요."
        case .changedSinceInspection:
            "확인한 뒤 앱이나 설치 폴더가 변경되었습니다. 설치 화면에서 다시 확인해 주세요."
        case .replacementApprovalRequired:
            "기존 Blabee 앱을 백업하고 교체하려면 먼저 교체를 확인해 주세요."
        case .destinationActive:
            "Blabee 또는 Codex에 연결된 Blabee 보조 프로세스가 실행 중입니다. 작업을 저장하고 Blabee와 연결된 Codex 세션을 종료한 뒤 다시 설치해 주세요."
        case .activityInspectionUnavailable:
            "구형 앱의 사용 여부를 macOS에서 확인하지 못했습니다. Blabee가 실행 중이라는 뜻은 아닙니다. 작업을 저장한 뒤 Mac을 재시작하고, Blabee와 Codex를 열기 전에 다시 설치해 주세요."
        case .runtimeUseLeaseUnavailable:
            "Blabee 실행 잠금을 확인할 수 없어 안전하게 설치를 중단했습니다. 앱을 다시 열어 재시도해 주세요."
        case .insufficientPermissions:
            "응용 프로그램 폴더에 설치할 권한이 없습니다. Finder에서 앱을 복사하고 macOS의 권한 안내를 따라 주세요."
        case .installationBusy:
            "다른 Blabee 설치가 진행 중이거나 설치 잠금을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
        case .sizeLimitExceeded:
            "앱의 파일 수나 크기가 자동 설치 범위를 벗어났습니다. 배포된 앱을 다시 확인해 주세요."
        case .deadlineExceeded:
            "설치 작업이 제한 시간을 넘었습니다. 남은 설치 자료를 확인한 뒤 다시 시도해 주세요."
        case .copyFailed:
            "앱 전체를 복사하지 못했습니다. 디스크 여유 공간과 접근 권한을 확인해 주세요."
        case .publishFailed:
            "설치를 완료하지 못했습니다. 설치 위치와 남은 설치 자료를 확인한 뒤 다시 시도해 주세요."
        case .recoveryRequired:
            "설치 중 다른 변경을 감지했습니다. 앱과 복구 자료를 보존했으므로 Finder에서 확인해 주세요."
        }
    }
}

enum AppInstallationCheckpoint: Equatable, Sendable {
    case beforeCopy, afterCopy, beforeBackup, afterBackup, beforePublish, afterPublish, beforeRestore
}

struct AppInstallationLimits: Sendable {
    var maximumEntries = 30_000
    var maximumBytes: Int64 = 4 * 1_024 * 1_024 * 1_024
    var maximumDepth = 96
    var maximumDuration: TimeInterval = 180
}

/// Copies a verified, complete app into private staging and publishes with
/// exclusive renames. It never removes an installed app, modifies signing or
/// quarantine, starts a process, or requests privileged execution.
struct AppInstallationService: Sendable {
    static let productionDestinationURL = URL(fileURLWithPath: "/Applications/Blabee.app", isDirectory: true)

    typealias Validator = @Sendable (URL) throws -> String
    typealias ActivityGuard = @Sendable (URL) throws -> Void
    typealias Checkpoint = @Sendable (AppInstallationCheckpoint, URL?) throws -> Void

    private let destinationURL: URL
    private let expectedSourceIdentity: String
    private let validator: Validator
    private let activityGuard: ActivityGuard
    private let copyBundle: @Sendable (URL, URL) throws -> Void
    private let checkpoint: Checkpoint
    private let limits: AppInstallationLimits

    static func live(
        expectedSourceIdentity: String,
        activityGuard: @escaping ActivityGuard
    ) -> Self {
        Self(
            destinationURL: productionDestinationURL,
            expectedSourceIdentity: expectedSourceIdentity,
            validator: { app in
                let executable = app.appendingPathComponent("Contents/MacOS/blabee-coordinator")
                guard let inspection = OperationalRuntimeIdentity.installedInspection(forExecutable: executable)
                else { throw AppInstallationError(.invalidSource) }
                return inspection.snapshot.runtimeIdentity
            },
            activityGuard: activityGuard
        )
    }

    /// Injection is for isolated fixtures; the production factory fixes the destination.
    init(
        destinationURL: URL,
        expectedSourceIdentity: String,
        validator: @escaping Validator,
        activityGuard: @escaping ActivityGuard = { _ in },
        copyBundle: @escaping @Sendable (URL, URL) throws -> Void = {
            try FileManager().copyItem(at: $0, to: $1)
        },
        checkpoint: @escaping Checkpoint = { _, _ in },
        limits: AppInstallationLimits = AppInstallationLimits()
    ) {
        self.destinationURL = destinationURL
        self.expectedSourceIdentity = expectedSourceIdentity
        self.validator = validator
        self.activityGuard = activityGuard
        self.copyBundle = copyBundle
        self.checkpoint = checkpoint
        self.limits = limits
    }

    func inspect(source: URL) throws -> AppInstallationPlan {
        let deadline = Date.timeIntervalSinceReferenceDate + limits.maximumDuration
        guard source.isFileURL, source.path.hasPrefix("/"),
              destinationURL.isFileURL, destinationURL.lastPathComponent == "Blabee.app",
              OperationalRuntimeIdentity.isValid(expectedSourceIdentity)
        else { throw AppInstallationError(.invalidSource) }
        // Resolve aliases in the source parent, but never follow the .app root.
        let sourceURL = URL(fileURLWithPath: try Self.physicalPath(source.deletingLastPathComponent().path), isDirectory: true)
            .appendingPathComponent(source.lastPathComponent, isDirectory: true)
        guard sourceURL.path != destinationURL.path,
              !sourceURL.path.hasPrefix(destinationURL.path + "/"),
              !destinationURL.path.hasPrefix(sourceURL.path + "/")
        else { throw AppInstallationError(.invalidSource) }
        let parent = try openParent()
        defer { close(parent) }
        let parentFile = try Self.identity(parent)
        let inspectedSource = try inspectBundle(sourceURL, deadline: deadline)
        guard inspectedSource.bundle.runtimeIdentity == expectedSourceIdentity
        else { throw AppInstallationError(.identityMismatch) }
        let existing = try inspectExisting(parent: parent, deadline: deadline)
        try verifyParent(parent, expected: parentFile)
        return AppInstallationPlan(
            sourceURL: sourceURL, destinationURL: destinationURL,
            source: inspectedSource.bundle, existing: existing?.bundle,
            comparison: Self.comparison(source: inspectedSource.bundle, existing: existing?.bundle),
            sourceFile: inspectedSource.file, existingFile: existing?.file, parentFile: parentFile
        )
    }

    func install(_ plan: AppInstallationPlan, replacementApproved: Bool) throws -> AppInstallationReceipt {
        guard plan.destinationURL == destinationURL,
              plan.source.runtimeIdentity == expectedSourceIdentity
        else { throw AppInstallationError(.changedSinceInspection) }
        guard plan.existing == nil || replacementApproved
        else { throw AppInstallationError(.replacementApprovalRequired) }
        let deadline = Date.timeIntervalSinceReferenceDate + limits.maximumDuration
        let parent = try openParent()
        defer { close(parent) }
        try verifyParent(parent, expected: plan.parentFile)
        let lock = try acquireLock(parent: parent)
        defer { _ = flock(lock, LOCK_UN); close(lock) }
        let lockFile = try Self.identity(lock)
        try verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)
        try recheck(plan, parent: parent, deadline: deadline)
        let oldLease: AppRuntimeUseLease?
        if let existing = plan.existing, plan.source.admitsRuntimeUseLease(for: existing) {
            oldLease = try acquireUseLease(at: destinationURL)
            // A byte-identical executable replacement is still a different
            // lock inode; bind the lease to the revalidated bundle.
            try recheck(plan, parent: parent, deadline: deadline)
            try verifyUseLease(oldLease, at: destinationURL)
        } else {
            oldLease = nil
            if plan.existing != nil { try requireLegacyInactive(destinationURL) }
        }
        var stagedLease: AppRuntimeUseLease?
        defer { withExtendedLifetime((oldLease, stagedLease)) {} }

        let stageName = ".Blabee.install-" + UUID().uuidString.lowercased()
        guard mkdirat(parent, stageName, 0o700) == 0 else { throw Self.fileError(.copyFailed) }
        let stage = openat(parent, stageName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard stage >= 0 else {
            throw AppInstallationError(.recoveryRequired, recoveryURL: parentURL.appendingPathComponent(stageName))
        }
        defer { close(stage) }
        let stageFile = try Self.identity(stage)
        guard stageFile.device == plan.parentFile.device else {
            throw AppInstallationError(.recoveryRequired, recoveryURL: parentURL.appendingPathComponent(stageName))
        }
        let stageURL = parentURL.appendingPathComponent(stageName, isDirectory: true)
        let stagedApp = stageURL.appendingPathComponent("Blabee.app", isDirectory: true)
        var backupName: String?
        var backupVerified = false
        var published = false
        do {
            try verifyStage(parent: parent, name: stageName, expected: stageFile)
            try checkpoint(.beforeCopy, stagedApp)
            try verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)
            try verifyStage(parent: parent, name: stageName, expected: stageFile)
            do { try copyBundle(plan.sourceURL, stagedApp) }
            catch {
                let failure = error as NSError
                if failure.domain == NSCocoaErrorDomain,
                   [NSFileReadNoPermissionError, NSFileWriteNoPermissionError].contains(failure.code) {
                    throw AppInstallationError(.insufficientPermissions)
                }
                throw AppInstallationError(.copyFailed)
            }
            try checkpoint(.afterCopy, stagedApp)
            try checkDeadline(deadline)
            try verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)
            try verifyStage(parent: parent, name: stageName, expected: stageFile)
            let staged = try inspectBundle(stagedApp, deadline: deadline)
            guard staged.bundle == plan.source else { throw AppInstallationError(.identityMismatch) }
            if staged.bundle.supportsRuntimeUseLease {
                stagedLease = try acquireUseLease(at: stagedApp)
            }
            try recheck(plan, parent: parent, deadline: deadline)
            if oldLease != nil { try verifyUseLease(oldLease, at: destinationURL) }
            else if plan.existing != nil { try requireLegacyInactive(destinationURL) }

            if let expectedOld = plan.existing, let expectedFile = plan.existingFile {
                try verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)
                let name = ".Blabee.backup-" + UUID().uuidString.lowercased() + ".app"
                try checkpoint(.beforeBackup, parentURL.appendingPathComponent(name))
                try verifyUseLease(oldLease, at: destinationURL)
                guard renameatx_np(parent, "Blabee.app", parent, name, UInt32(RENAME_EXCL)) == 0
                else { throw Self.fileError(.publishFailed) }
                backupName = name
                try checkpoint(.afterBackup, parentURL.appendingPathComponent(name))
                try verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)
                let moved = try inspectBundle(parentURL.appendingPathComponent(name), deadline: deadline)
                try verifyUseLease(oldLease, at: parentURL.appendingPathComponent(name))
                guard moved.file == expectedFile, moved.bundle == expectedOld else {
                    // rename cannot conditionally bind the source inode. Keep any
                    // raced-in bundle here, and never claim it was the approved app.
                    throw AppInstallationError(.recoveryRequired)
                }
                backupVerified = true
                guard try Self.childIdentity(parent: parent, name: "Blabee.app") == nil
                else { throw AppInstallationError(.changedSinceInspection) }
            }

            try checkDeadline(deadline)
            try verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)
            try verifyStage(parent: parent, name: stageName, expected: stageFile)
            // Source and staged content are checked again immediately before publication.
            let currentSource = try inspectBundle(plan.sourceURL, deadline: deadline)
            let currentStage = try inspectBundle(stagedApp, deadline: deadline)
            guard currentSource.file == plan.sourceFile, currentSource.bundle == plan.source,
                  currentStage.file == staged.file, currentStage.bundle == plan.source
            else { throw AppInstallationError(.changedSinceInspection) }
            if oldLease == nil, plan.existing != nil {
                try requireLegacyInactive(destinationURL)
                if let backupName {
                    // A process may expose its renamed executable path after backup.
                    // These checks are snapshots, not a lock on future app launches.
                    try requireLegacyInactive(parentURL.appendingPathComponent(backupName))
                }
            }
            // A confirmed-absent fresh target has no bundle to move. A later
            // appearance is still protected by the exclusive publication below.
            try checkpoint(.beforePublish, stagedApp)
            try verifyUseLease(stagedLease, at: stagedApp)
            if let backupName { try verifyUseLease(oldLease, at: parentURL.appendingPathComponent(backupName)) }
            guard renameatx_np(stage, "Blabee.app", parent, "Blabee.app", UInt32(RENAME_EXCL)) == 0
            else { throw Self.fileError(.publishFailed) }
            published = true
            try checkpoint(.afterPublish, destinationURL)
            try verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)
            let installed = try inspectBundle(destinationURL, deadline: deadline)
            try verifyUseLease(stagedLease, at: destinationURL)
            if let backupName { try verifyUseLease(oldLease, at: parentURL.appendingPathComponent(backupName)) }
            guard installed.file == staged.file, installed.bundle == plan.source
            else { throw AppInstallationError(.recoveryRequired) }
            guard fsync(parent) == 0 else { throw AppInstallationError(.recoveryRequired) }
            // Only an empty directory we still own can be removed. Failed copies
            // are intentionally retained; there is no recursive cleanup here.
            if (try? verifyStage(parent: parent, name: stageName, expected: stageFile)) != nil {
                _ = unlinkat(parent, stageName, AT_REMOVEDIR)
            }
            return AppInstallationReceipt(
                destinationURL: destinationURL,
                backupURL: backupName.map { parentURL.appendingPathComponent($0) },
                identity: installed.bundle.runtimeIdentity
            )
        } catch {
            let recoveryRoot = Self.actualURL(parent) ?? parentURL
            let recoveryURL = backupName.map { recoveryRoot.appendingPathComponent($0) }
                ?? (published ? recoveryRoot.appendingPathComponent("Blabee.app")
                    : recoveryRoot.appendingPathComponent(stageName))
            guard !published else { throw AppInstallationError(.recoveryRequired, recoveryURL: recoveryURL) }
            if let backupName {
                guard backupVerified,
                      (try? verifyTransaction(parent: parent, plan: plan, lock: lock, lockFile: lockFile)) != nil,
                      let old = try? inspectBundle(recoveryURL, deadline: Date.timeIntervalSinceReferenceDate + 30),
                      old.file == plan.existingFile, old.bundle == plan.existing
                else { throw AppInstallationError(.recoveryRequired, recoveryURL: recoveryURL) }
                do {
                    try checkpoint(.beforeRestore, recoveryURL)
                    try verifyUseLease(oldLease, at: recoveryURL)
                    // A concurrent app/file always wins; restoration never overwrites it.
                    guard renameatx_np(parent, backupName, parent, "Blabee.app", UInt32(RENAME_EXCL)) == 0
                    else { throw AppInstallationError(.recoveryRequired) }
                    let restored = try inspectBundle(destinationURL, deadline: Date.timeIntervalSinceReferenceDate + 30)
                    try verifyUseLease(oldLease, at: destinationURL)
                    guard restored.file == plan.existingFile, restored.bundle == plan.existing,
                          fsync(parent) == 0
                    else { throw AppInstallationError(.recoveryRequired) }
                } catch {
                    throw AppInstallationError(.recoveryRequired, recoveryURL: recoveryRoot)
                }
            }
            let failure = Self.transactionFailure(error)
            throw AppInstallationError(failure.code, recoveryURL: recoveryRoot.appendingPathComponent(stageName))
        }
    }

    private var parentURL: URL { destinationURL.deletingLastPathComponent() }
    private static let lockName = ".Blabee.install.lock"

    private func requireLegacyInactive(_ appURL: URL) throws {
        do { try activityGuard(appURL) }
        catch { throw Self.transactionFailure(error) }
    }

    private func acquireUseLease(at appURL: URL) throws -> AppRuntimeUseLease {
        do {
            return try AppRuntimeUseLease.acquire(
                executableURL: appURL.appendingPathComponent(AppRuntimeUseLease.executablePath), use: .installation
            )
        } catch AppRuntimeUseLeaseError.busy {
            throw AppInstallationError(.destinationActive)
        } catch AppRuntimeUseLeaseError.changed {
            throw AppInstallationError(.changedSinceInspection)
        } catch {
            throw AppInstallationError(.runtimeUseLeaseUnavailable)
        }
    }

    private func verifyUseLease(_ lease: AppRuntimeUseLease?, at appURL: URL) throws {
        do { try lease?.verify(at: appURL.appendingPathComponent(AppRuntimeUseLease.executablePath)) }
        catch { throw AppInstallationError(.changedSinceInspection) }
    }

    private struct Inspection {
        let bundle: AppInstallationBundle
        let file: AppInstallationFileIdentity
    }

    private func inspectExisting(parent: Int32, deadline: TimeInterval) throws -> Inspection? {
        guard let file = try Self.childIdentity(parent: parent, name: "Blabee.app") else { return nil }
        guard file.isDirectory else { throw AppInstallationError(.invalidDestination) }
        do { return try inspectBundle(destinationURL, deadline: deadline) }
        catch { throw AppInstallationError(.invalidDestination) }
    }

    private func recheck(_ plan: AppInstallationPlan, parent: Int32, deadline: TimeInterval) throws {
        let source = try inspectBundle(plan.sourceURL, deadline: deadline)
        let existing = try inspectExisting(parent: parent, deadline: deadline)
        guard source.file == plan.sourceFile, source.bundle == plan.source,
              existing?.file == plan.existingFile, existing?.bundle == plan.existing
        else { throw AppInstallationError(.changedSinceInspection) }
    }

    private func inspectBundle(_ url: URL, deadline: TimeInterval) throws -> Inspection {
        try checkDeadline(deadline)
        guard url.pathExtension.lowercased() == "app" else { throw AppInstallationError(.invalidSource) }
        let root = try Self.openDirectory(url)
        defer { close(root) }
        let before = try Self.identity(root)
        guard before.owner == geteuid() || before.owner == 0,
              before.mode & 0o002 == 0
        else { throw AppInstallationError(.invalidSource) }
        let contents = openat(root, "Contents", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard contents >= 0 else { throw AppInstallationError(.invalidSource) }
        defer { close(contents) }
        let infoData = try Self.readFile(parent: contents, name: "Info.plist", maximumBytes: 65_536)
        guard let info = try? PropertyListSerialization.propertyList(from: infoData, format: nil) as? [String: Any],
              info["CFBundleIdentifier"] as? String == "com.biadone.blabee",
              info["CFBundleName"] as? String == "Blabee",
              info["CFBundleExecutable"] as? String == "blabee-coordinator",
              let version = info["CFBundleShortVersionString"] as? String,
              let build = info["CFBundleVersion"] as? String,
              Self.validMetadata(version), Self.validMetadata(build)
        else { throw AppInstallationError(.invalidSource) }
        let macOS = openat(contents, "MacOS", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard macOS >= 0 else { throw AppInstallationError(.invalidSource) }
        defer { close(macOS) }
        guard let executable = try Self.childIdentity(parent: macOS, name: "blabee-coordinator"),
              executable.isRegularFile, executable.mode & 0o111 != 0
        else { throw AppInstallationError(.invalidSource) }
        var entries = 0
        var bytes: Int64 = 0
        var leasePayloadSupported = true
        var launcherSHA256: String?
        try scan(directory: root, rootURL: url, relative: "", depth: 0,
                 entries: &entries, bytes: &bytes, leasePayloadSupported: &leasePayloadSupported,
                 launcherSHA256: &launcherSHA256, deadline: deadline)
        let previousIdentities: [String]
        if let raw = info[AppRuntimeUseLease.previousIdentitiesInfoKey] {
            guard let values = raw as? [String], values.count <= 2,
                  values.allSatisfy(OperationalRuntimeIdentity.isValid), Set(values).count == values.count
            else { throw AppInstallationError(.invalidSource) }
            previousIdentities = values
        } else { previousIdentities = [] }
        let identity = try validator(url)
        guard OperationalRuntimeIdentity.isValid(identity) else { throw AppInstallationError(.invalidSource) }
        try checkDeadline(deadline)
        let reopened = try Self.openDirectory(url)
        defer { close(reopened) }
        guard try Self.identity(reopened) == before,
              try Self.readFile(parent: contents, name: "Info.plist", maximumBytes: 65_536) == infoData
        else { throw AppInstallationError(.changedSinceInspection) }
        return Inspection(bundle: AppInstallationBundle(
            runtimeIdentity: identity, version: version, build: build,
            runtimeUseLeaseProtocol: info[AppRuntimeUseLease.protocolInfoKey] as? String,
            runtimeUseLeasePreviousIdentities: previousIdentities,
            runtimeUseLeasePayloadSupported: leasePayloadSupported,
            launcherSHA256: launcherSHA256
        ), file: before)
    }

    /// Descriptor-relative traversal never follows directory symlinks. Internal
    /// relative symlinks (frameworks) are copied intact; escaping links and
    /// special files are refused before Foundation starts the whole-bundle copy.
    private func scan(
        directory: Int32, rootURL: URL, relative: String, depth: Int,
        entries: inout Int, bytes: inout Int64, leasePayloadSupported: inout Bool,
        launcherSHA256: inout String?, deadline: TimeInterval
    ) throws {
        guard depth <= limits.maximumDepth else { throw AppInstallationError(.sizeLimitExceeded) }
        let duplicate = dup(directory)
        guard duplicate >= 0 else { throw AppInstallationError(.invalidSource) }
        guard let stream = fdopendir(duplicate) else {
            close(duplicate)
            throw AppInstallationError(.invalidSource)
        }
        defer { closedir(stream) }
        while true {
            try checkDeadline(deadline)
            errno = 0
            guard let entry = readdir(stream) else {
                guard errno == 0 else { throw AppInstallationError(.invalidSource) }
                break
            }
            let name = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
            }
            if name == "." || name == ".." { continue }
            entries += 1
            guard entries <= limits.maximumEntries else { throw AppInstallationError(.sizeLimitExceeded) }
            var value = stat()
            guard fstatat(directory, name, &value, AT_SYMLINK_NOFOLLOW) == 0,
                  value.st_uid == geteuid() || value.st_uid == 0
            else { throw AppInstallationError(.invalidSource) }
            let kind = value.st_mode & mode_t(S_IFMT)
            let path = relative.isEmpty ? name : relative + "/" + name
            switch kind {
            case mode_t(S_IFDIR):
                guard value.st_mode & 0o002 == 0 else { throw AppInstallationError(.invalidSource) }
                let child = openat(directory, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard child >= 0 else { throw AppInstallationError(.invalidSource) }
                defer { close(child) }
                guard try Self.identity(child) == AppInstallationFileIdentity(value)
                else { throw AppInstallationError(.changedSinceInspection) }
                try scan(directory: child, rootURL: rootURL, relative: path, depth: depth + 1,
                         entries: &entries, bytes: &bytes, leasePayloadSupported: &leasePayloadSupported,
                         launcherSHA256: &launcherSHA256, deadline: deadline)
            case mode_t(S_IFREG):
                guard value.st_nlink == 1, value.st_mode & 0o022 == 0,
                      value.st_mode & 0o6000 == 0, value.st_size >= 0
                else { throw AppInstallationError(.invalidSource) }
                guard value.st_size <= limits.maximumBytes - bytes
                else { throw AppInstallationError(.sizeLimitExceeded) }
                bytes += value.st_size
                if value.st_mode & 0o111 != 0,
                   path != AppRuntimeUseLease.executablePath && path != AppRuntimeUseLease.launcherPath {
                    leasePayloadSupported = false
                }
                if path == AppRuntimeUseLease.launcherPath {
                    let data = try Self.readFile(parent: directory, name: name, maximumBytes: 256 * 1_024)
                    launcherSHA256 = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                }
            case mode_t(S_IFLNK):
                // Other layouts retain the legacy guard until every executable
                // path is covered by the cooperative protocol.
                leasePayloadSupported = false
                var buffer = [CChar](repeating: 0, count: Int(PATH_MAX) + 1)
                let length = readlinkat(directory, name, &buffer, buffer.count - 1)
                guard length > 0, length < buffer.count - 1, buffer[0] != 47 else {
                    throw AppInstallationError(.invalidSource)
                }
                let resolved = try Self.physicalPath(rootURL.appendingPathComponent(path).path)
                guard resolved.hasPrefix(rootURL.path + "/") else { throw AppInstallationError(.invalidSource) }
            default:
                throw AppInstallationError(.invalidSource)
            }
        }
    }

    private func openParent() throws -> Int32 {
        let descriptor: Int32
        do { descriptor = try Self.openDirectory(parentURL) }
        catch { throw Self.fileError(.invalidDestination) }
        do {
            let file = try Self.identity(descriptor)
            guard file.owner == geteuid() || file.owner == 0,
                  file.mode & 0o002 == 0
            else { throw AppInstallationError(.insufficientPermissions) }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    private func verifyParent(_ parent: Int32, expected: AppInstallationFileIdentity) throws {
        let current = try Self.openDirectory(parentURL)
        defer { close(current) }
        guard try Self.identity(current) == expected, try Self.identity(parent) == expected
        else { throw AppInstallationError(.changedSinceInspection) }
    }

    private func acquireLock(parent: Int32) throws -> Int32 {
        var descriptor = openat(parent, Self.lockName, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        if descriptor < 0, errno == EEXIST {
            guard let existing = try Self.childIdentity(parent: parent, name: Self.lockName),
                  existing.isRegularFile, existing.owner == geteuid(), existing.mode & 0o7777 == 0o600
            else { throw AppInstallationError(.installationBusy) }
            descriptor = openat(parent, Self.lockName, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        }
        guard descriptor >= 0 else { throw Self.fileError(.installationBusy) }
        do {
            let file = try Self.identity(descriptor)
            var value = stat()
            guard fstat(descriptor, &value) == 0, file.isRegularFile,
                  file.owner == geteuid(), file.mode & 0o7777 == 0o600, value.st_nlink == 1,
                  flock(descriptor, LOCK_EX | LOCK_NB) == 0,
                  try Self.childIdentity(parent: parent, name: Self.lockName) == file
            else { throw AppInstallationError(.installationBusy) }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    private func verifyTransaction(
        parent: Int32, plan: AppInstallationPlan, lock: Int32, lockFile: AppInstallationFileIdentity
    ) throws {
        try verifyParent(parent, expected: plan.parentFile)
        var currentLock = stat()
        guard fstat(lock, &currentLock) == 0, currentLock.st_nlink == 1,
              try Self.identity(lock) == lockFile,
              try Self.childIdentity(parent: parent, name: Self.lockName) == lockFile
        else { throw AppInstallationError(.installationBusy) }
    }

    private func verifyStage(parent: Int32, name: String, expected: AppInstallationFileIdentity) throws {
        guard expected.isDirectory, expected.owner == geteuid(), expected.mode & 0o7777 == 0o700,
              try Self.childIdentity(parent: parent, name: name) == expected
        else { throw AppInstallationError(.changedSinceInspection) }
    }

    private func checkDeadline(_ deadline: TimeInterval) throws {
        guard Date.timeIntervalSinceReferenceDate < deadline else { throw AppInstallationError(.deadlineExceeded) }
    }

    private static func validMetadata(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 64 && !value.unicodeScalars.contains {
            CharacterSet.controlCharacters.contains($0) || $0.value == 0x2028 || $0.value == 0x2029
        }
    }

    private static func comparison(source: AppInstallationBundle, existing: AppInstallationBundle?) -> AppInstallationComparison {
        guard let existing else { return .freshInstall }
        if source.runtimeIdentity == existing.runtimeIdentity { return .sameIdentity }
        guard [source.version, source.build, existing.version, existing.build].allSatisfy({
            $0.range(of: "^[0-9]+(\\.[0-9]+)*$", options: .regularExpression) != nil
        }) else { return .unknown }
        let versionOrder = source.version.compare(existing.version, options: .numeric)
        let order = versionOrder == .orderedSame ? source.build.compare(existing.build, options: .numeric) : versionOrder
        switch order {
        case .orderedAscending: return .downgrade
        case .orderedDescending: return .upgrade
        case .orderedSame: return .sameVersion
        }
    }

    private static func openDirectory(_ url: URL) throws -> Int32 {
        let components = url.path.split(separator: "/")
        guard url.isFileURL, url.path.hasPrefix("/"),
              !components.contains(where: { $0 == "." || $0 == ".." })
        else { throw AppInstallationError(.invalidDestination) }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw fileError(.invalidDestination) }
        for component in components {
            let child = openat(descriptor, String(component), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            close(descriptor)
            guard child >= 0 else { throw fileError(.invalidDestination) }
            descriptor = child
        }
        return descriptor
    }

    private static func identity(_ descriptor: Int32) throws -> AppInstallationFileIdentity {
        var value = stat()
        guard fstat(descriptor, &value) == 0 else { throw AppInstallationError(.changedSinceInspection) }
        return AppInstallationFileIdentity(value)
    }

    private static func childIdentity(parent: Int32, name: String) throws -> AppInstallationFileIdentity? {
        var value = stat()
        guard fstatat(parent, name, &value, AT_SYMLINK_NOFOLLOW) == 0 else {
            if errno == ENOENT { return nil }
            throw fileError(.changedSinceInspection)
        }
        return AppInstallationFileIdentity(value)
    }

    private static func readFile(parent: Int32, name: String, maximumBytes: Int) throws -> Data {
        let descriptor = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw AppInstallationError(.invalidSource) }
        defer { close(descriptor) }
        var before = stat()
        guard fstat(descriptor, &before) == 0,
              before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), before.st_nlink == 1,
              before.st_size > 0, before.st_size <= maximumBytes
        else { throw AppInstallationError(.invalidSource) }
        var data = Data(count: Int(before.st_size))
        let readOK = data.withUnsafeMutableBytes { buffer -> Bool in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.read(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { return false }
                offset += count
            }
            return true
        }
        var after = stat()
        guard readOK, fstat(descriptor, &after) == 0,
              AppInstallationFileIdentity(before) == AppInstallationFileIdentity(after),
              before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec
        else { throw AppInstallationError(.changedSinceInspection) }
        return data
    }

    private static func actualURL(_ descriptor: Int32) -> URL? {
        var path = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard fcntl(descriptor, F_GETPATH, &path) == 0 else { return nil }
        return path.withUnsafeBufferPointer {
            URL(fileURLWithPath: String(cString: $0.baseAddress!), isDirectory: true)
        }
    }

    private static func physicalPath(_ path: String) throws -> String {
        // Foundation's resolvingSymlinksInPath may map /private/var back to
        // /var. Native realpath preserves the path used by no-follow traversal.
        guard let resolved = realpath(path, nil) else { throw fileError(.invalidSource) }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    private static func fileError(_ fallback: AppInstallationError.Code) -> AppInstallationError {
        AppInstallationError([EACCES, EPERM, EROFS].contains(errno) ? .insufficientPermissions : fallback)
    }

    private static func transactionFailure(_ error: Error) -> AppInstallationError {
        if let failure = error as? AppInstallationError { return failure }
        switch error as? AppInstallationPlatformError {
        case .applicationActive: return AppInstallationError(.destinationActive)
        case .processInspectionUnavailable: return AppInstallationError(.activityInspectionUnavailable)
        default: return AppInstallationError(.publishFailed)
        }
    }
}

fileprivate struct AppInstallationFileIdentity: Equatable, Sendable {
    let device: dev_t
    let inode: ino_t
    let owner: uid_t
    let group: gid_t
    let mode: mode_t
    let flags: UInt32

    init(_ value: stat) {
        device = value.st_dev
        inode = value.st_ino
        owner = value.st_uid
        group = value.st_gid
        mode = value.st_mode
        flags = value.st_flags
    }

    var isDirectory: Bool { mode & mode_t(S_IFMT) == mode_t(S_IFDIR) }
    var isRegularFile: Bool { mode & mode_t(S_IFMT) == mode_t(S_IFREG) }
}
