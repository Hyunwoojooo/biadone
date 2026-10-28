import CryptoKit
import Darwin
import Foundation

/// The caller supplies the same process-lifetime authority used by the service
/// and CLI. Recovery retains it until all storage and Keychain work is done.
public protocol StorageRecoveryAuthority: AnyObject, Sendable {}

public protocol ArchivableFreshnessAnchorStore: FreshnessAnchorStore {
    func archive(expectedRevision: Data, recoveryID: UUID) throws
}

public struct MissingStorageRecoveryPlan: Sendable, Equatable {
    public let recoveryID: UUID
    public let databaseURL: URL
    public let keyURL: URL
    public let backupDirectoryURL: URL
    public let residualFileNames: [String]
    public var archivedAnchorService: String {
        KeychainFreshnessAnchorStore.archivedService(recoveryID: recoveryID)
    }

    fileprivate let engineID: UUID
    fileprivate let snapshot: MissingStorageSnapshot
}

public struct MissingStorageRecoveryReceipt: Sendable, Equatable {
    public let recoveryID: UUID
    public let backupDirectoryURL: URL
    public let archivedAnchorService: String
    public let completionRecordWritten: Bool
}

/// An explicit reset for the narrowly diagnosed state where *both* the database
/// and its key are missing, but a valid committed/pending anchor remains.
/// It never opens or adopts an existing database and never creates a new key.
public final class MissingStorageRecovery: Sendable {
    private let engineID = UUID()
    private let databaseURL: URL
    private let keyURL: URL
    private let backupRootURL: URL
    private let freshnessStore: any ArchivableFreshnessAnchorStore
    private let acquireAuthority: @Sendable () throws -> any StorageRecoveryAuthority

    public init(
        databaseURL: URL,
        keyURL: URL,
        backupRootURL: URL,
        freshnessStore: any ArchivableFreshnessAnchorStore,
        acquireAuthority: @escaping @Sendable () throws -> any StorageRecoveryAuthority
    ) {
        self.databaseURL = MissingStorageFiles.normalized(databaseURL)
        self.keyURL = MissingStorageFiles.normalized(keyURL)
        self.backupRootURL = MissingStorageFiles.normalized(backupRootURL)
        self.freshnessStore = freshnessStore
        self.acquireAuthority = acquireAuthority
    }

    /// Reads only storage/anchor metadata. No storage directory or backup is
    /// created until the user confirms the returned plan and calls execute.
    public func prepare() throws -> MissingStorageRecoveryPlan {
        let authority = try acquireAuthority()
        return try withExtendedLifetime(authority) {
            try validatePaths()
            let snapshot = try inspect()
            let recoveryID = UUID()
            return MissingStorageRecoveryPlan(
                recoveryID: recoveryID,
                databaseURL: databaseURL,
                keyURL: keyURL,
                backupDirectoryURL: backupRootURL.appendingPathComponent(recoveryID.uuidString),
                residualFileNames: snapshot.files.map(\.name),
                engineID: engineID,
                snapshot: snapshot
            )
        }
    }

    /// Call only after displaying and explicitly confirming this exact plan.
    /// Every mutable precondition is checked again under both authority and
    /// journal locks. A crash before the final CAS leaves the original anchor
    /// blocking startup; a crash after it leaves only clean, absent storage.
    public func execute(_ plan: MissingStorageRecoveryPlan) throws -> MissingStorageRecoveryReceipt {
        guard plan.engineID == engineID else {
            throw CoordinatorError("storage_recovery_plan_changed")
        }
        let authority = try acquireAuthority()
        return try withExtendedLifetime(authority) {
            try validatePaths()
            try requireSameSnapshot(plan.snapshot, inspect(), includingDirectory: true)
            let writer = try StorageProcessLock(keyURL: keyURL, allowParentCreation: true)
            do {
                return try writer.withNonblockingLock { parent in
                    try requireSameSnapshot(plan.snapshot, inspect(), includingDirectory: plan.snapshot.directory != nil)
                    try MissingStorageFiles.requireDirectoryIdentity(parent, at: databaseURL.deletingLastPathComponent())
                    return try archive(plan, parent: parent)
                }
            } catch let error as CoordinatorError where error.code == "freshness_lock_busy" {
                throw CoordinatorError("storage_recovery_busy", "storage has an active writer")
            }
        }
    }

    private func validatePaths() throws {
        let parent = databaseURL.deletingLastPathComponent()
        let backup = backupRootURL.path
        guard databaseURL.isFileURL, keyURL.isFileURL, backupRootURL.isFileURL,
              databaseURL != keyURL,
              parent == keyURL.deletingLastPathComponent(),
              ![databaseURL.path, keyURL.path, backup].contains(where: { $0.utf8.contains(0) }),
              backup != parent.path,
              !backup.hasPrefix(parent.path + "/"),
              !parent.path.hasPrefix(backup + "/"),
              !residualNames.contains(keyURL.lastPathComponent),
              ![databaseURL.lastPathComponent, keyURL.lastPathComponent].contains(".blabee-coordinator-freshness.lock")
        else {
            throw CoordinatorError("storage_recovery_unsafe_path", "storage and backup paths must be distinct and non-overlapping")
        }
        if let backupDescriptor = try MissingStorageFiles.directory(backupRootURL, create: false) {
            close(backupDescriptor)
        }
    }

    private var residualNames: [String] {
        ["-wal", "-shm", "-journal"].map { databaseURL.lastPathComponent + $0 }
    }

    private func inspect() throws -> MissingStorageSnapshot {
        guard let stored = try freshnessStore.load(),
              stored.record.state == .committed || stored.record.state == .pending
        else { throw CoordinatorError("storage_recovery_not_eligible") }
        let parentURL = databaseURL.deletingLastPathComponent()
        guard let parent = try MissingStorageFiles.directory(parentURL, create: false) else {
            return MissingStorageSnapshot(revision: stored.revision, directory: nil, files: [])
        }
        defer { close(parent) }
        try requireAbsentStorage(parent: parent)
        let files = try residualNames.compactMap {
            try MissingStorageFiles.fingerprint(parent: parent, name: $0)
        }
        try MissingStorageFiles.requireDirectoryIdentity(parent, at: parentURL)
        return MissingStorageSnapshot(
            revision: stored.revision,
            directory: try MissingStorageFiles.identity(parent),
            files: files
        )
    }

    private func requireAbsentStorage(parent: Int32) throws {
        guard try !MissingStorageFiles.exists(parent: parent, name: databaseURL.lastPathComponent),
              try !MissingStorageFiles.exists(parent: parent, name: keyURL.lastPathComponent)
        else { throw CoordinatorError("storage_recovery_not_eligible") }
    }

    private func requireSameSnapshot(
        _ expected: MissingStorageSnapshot,
        _ actual: MissingStorageSnapshot,
        includingDirectory: Bool
    ) throws {
        guard expected.revision == actual.revision,
              expected.files == actual.files,
              !includingDirectory || expected.directory == actual.directory
        else { throw CoordinatorError("storage_recovery_plan_changed") }
    }

    private func archive(_ plan: MissingStorageRecoveryPlan, parent: Int32) throws -> MissingStorageRecoveryReceipt {
        let parentURL = databaseURL.deletingLastPathComponent()
        guard let backupRoot = try MissingStorageFiles.directory(backupRootURL, create: true) else {
            throw CoordinatorError("storage_recovery_backup_failed")
        }
        defer { close(backupRoot) }
        let backupName = plan.recoveryID.uuidString
        guard mkdirat(backupRoot, backupName, mode_t(0o700)) == 0 else {
            throw CoordinatorError("storage_recovery_backup_failed")
        }
        let backup = openat(backupRoot, backupName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard backup >= 0 else { throw CoordinatorError("storage_recovery_backup_failed") }
        defer { close(backup) }
        try MissingStorageFiles.writeJSON(
            [
                "format_version": 1,
                "recovery_id": plan.recoveryID.uuidString,
                "operation": "archive_missing_storage_anchor",
                "database_path": databaseURL.path,
                "key_path": keyURL.path,
                "storage_slot": freshnessStore.storageSlot,
                "archived_anchor_service": plan.archivedAnchorService,
                "expected_revision": plan.snapshot.revision.base64EncodedString(),
                "files": plan.snapshot.files.map {
                    ["name": $0.name, "size": $0.size, "sha256": $0.digest] as [String: Any]
                },
            ],
            parent: backup,
            name: "recovery-plan.json"
        )
        try MissingStorageFiles.synchronize(backupRoot)
        for file in plan.snapshot.files {
            guard try MissingStorageFiles.fingerprint(parent: parent, name: file.name) == file else {
                throw CoordinatorError("storage_recovery_plan_changed")
            }
            guard renameatx_np(parent, file.name, backup, file.name, UInt32(RENAME_EXCL)) == 0 else {
                throw CoordinatorError("storage_recovery_backup_failed")
            }
            guard try MissingStorageFiles.fingerprint(parent: backup, name: file.name) == file else {
                throw CoordinatorError("storage_recovery_backup_failed")
            }
            try MissingStorageFiles.synchronizeFile(parent: backup, file: file)
        }
        // The backups and absence of old sidecars must be durable before the
        // Keychain primary name is freed. No rollback restores the old anchor.
        try MissingStorageFiles.synchronize(backup)
        try MissingStorageFiles.synchronize(parent)
        try MissingStorageFiles.requireDirectoryIdentity(parent, at: parentURL)
        try MissingStorageFiles.requireDirectoryIdentity(backupRoot, at: backupRootURL)
        try MissingStorageFiles.requireDirectoryIdentity(backup, at: plan.backupDirectoryURL)
        try requireAbsentStorage(parent: parent)
        for name in residualNames {
            guard try !MissingStorageFiles.exists(parent: parent, name: name) else {
                throw CoordinatorError("storage_recovery_plan_changed")
            }
        }
        guard try freshnessStore.load()?.revision == plan.snapshot.revision else {
            throw CoordinatorError("storage_recovery_plan_changed")
        }
        try freshnessStore.archive(expectedRevision: plan.snapshot.revision, recoveryID: plan.recoveryID)
        let completionRecordWritten: Bool
        do {
            try MissingStorageFiles.writeJSON(
                ["recovery_id": plan.recoveryID.uuidString, "anchor_archived": true],
                parent: backup,
                name: "archive-completed.json"
            )
            completionRecordWritten = true
        } catch {
            // The verified Keychain transition has completed. Report the
            // optional receipt-write failure without attempting to undo it.
            completionRecordWritten = false
        }
        return MissingStorageRecoveryReceipt(
            recoveryID: plan.recoveryID,
            backupDirectoryURL: plan.backupDirectoryURL,
            archivedAnchorService: plan.archivedAnchorService,
            completionRecordWritten: completionRecordWritten
        )
    }
}

fileprivate struct MissingStorageSnapshot: Sendable, Equatable {
    let revision: Data
    let directory: MissingStorageFileIdentity?
    let files: [MissingStorageFileFingerprint]
}

fileprivate struct MissingStorageFileIdentity: Sendable, Equatable {
    let device: Int32
    let inode: UInt64
}

fileprivate struct MissingStorageFileFingerprint: Sendable, Equatable {
    let name: String
    let identity: MissingStorageFileIdentity
    let size: Int64
    let modifiedSeconds: Int
    let modifiedNanoseconds: Int
    let digest: String
}

private enum MissingStorageFiles {
    // Bound recovery work and memory independently of an untrusted sidecar size.
    static let maximumSidecarSize: Int64 = 64 * 1_024 * 1_024

    static func normalized(_ url: URL) -> URL {
        let path = url.standardizedFileURL.path
        if path == "/var" || path.hasPrefix("/var/") || path == "/tmp" || path.hasPrefix("/tmp/") {
            return URL(fileURLWithPath: "/private" + path)
        }
        return url.standardizedFileURL
    }

    static func directory(_ url: URL, create: Bool) throws -> Int32? {
        let path = normalized(url).path
        guard path.hasPrefix("/"), !path.utf8.contains(0) else {
            throw CoordinatorError("storage_recovery_unsafe_path", "recovery directory path must be absolute")
        }
        var current = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard current >= 0 else { throw CoordinatorError("storage_recovery_unsafe_path", "cannot open filesystem root") }
        do {
            for component in path.split(separator: "/").map(String.init) {
                var next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0 && errno == ENOENT {
                    if !create { close(current); return nil }
                    let created = mkdirat(current, component, mode_t(0o700)) == 0
                    guard created || errno == EEXIST else {
                        throw CoordinatorError("storage_recovery_backup_failed")
                    }
                    if created { try synchronize(current) }
                    next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else {
                    throw CoordinatorError("storage_recovery_unsafe_path", "cannot open recovery directory without following links")
                }
                close(current)
                current = next
            }
            var info = stat()
            guard fstat(current, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                  info.st_mode & 0o777 == 0o700,
                  info.st_uid == geteuid()
            else {
                throw CoordinatorError("storage_recovery_unsafe_path", "recovery directory must be owned by this user with mode 0700")
            }
            return current
        } catch { close(current); throw error }
    }

    static func identity(_ descriptor: Int32) throws -> MissingStorageFileIdentity {
        var info = stat()
        guard fstat(descriptor, &info) == 0 else {
            throw CoordinatorError("storage_recovery_unsafe_path", "cannot inspect opened recovery file identity")
        }
        return MissingStorageFileIdentity(device: info.st_dev, inode: info.st_ino)
    }

    static func requireDirectoryIdentity(_ descriptor: Int32, at url: URL) throws {
        guard let reopened = try directory(url, create: false) else {
            throw CoordinatorError("storage_recovery_plan_changed")
        }
        defer { close(reopened) }
        guard try identity(descriptor) == identity(reopened) else {
            throw CoordinatorError("storage_recovery_plan_changed")
        }
    }

    static func exists(parent: Int32, name: String) throws -> Bool {
        var info = stat()
        if fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) == 0 { return true }
        guard errno == ENOENT else {
            throw CoordinatorError("storage_recovery_unsafe_path", "cannot inspect storage entry without following links")
        }
        return false
    }

    static func fingerprint(parent: Int32, name: String) throws -> MissingStorageFileFingerprint? {
        var directoryInfo = stat()
        guard fstat(parent, &directoryInfo) == 0,
              directoryInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              directoryInfo.st_mode & 0o7777 == 0o700,
              directoryInfo.st_uid == geteuid()
        else {
            throw CoordinatorError("storage_recovery_unsafe_path", "residual files require an owner-only directory")
        }
        guard try exists(parent: parent, name: name) else { return nil }
        let descriptor = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else {
            throw CoordinatorError("storage_recovery_unsafe_path", "cannot open residual file without following links")
        }
        defer { close(descriptor) }
        var before = stat()
        guard fstat(descriptor, &before) == 0,
              before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              [mode_t(0o600), mode_t(0o644)].contains(before.st_mode & 0o7777),
              before.st_uid == geteuid(), before.st_nlink == 1,
              before.st_size >= 0, before.st_size <= maximumSidecarSize
        else {
            throw CoordinatorError("storage_recovery_unsafe_path", "residual file must be owned, regular, mode 0600 or 0644, single-linked, and at most 64 MiB")
        }
        var hash = SHA256()
        var bytes = [UInt8](repeating: 0, count: 64 * 1_024)
        var total: Int64 = 0
        while true {
            let count = read(descriptor, &bytes, bytes.count)
            if count < 0 && errno == EINTR { continue }
            guard count >= 0 else { throw CoordinatorError("storage_recovery_backup_failed") }
            if count == 0 { break }
            total += Int64(count)
            guard total <= maximumSidecarSize else {
                throw CoordinatorError("storage_recovery_unsafe_path", "residual file exceeded 64 MiB while reading")
            }
            hash.update(data: Data(bytes.prefix(count)))
        }
        var after = stat()
        var entry = stat()
        guard fstat(descriptor, &after) == 0,
              fstatat(parent, name, &entry, AT_SYMLINK_NOFOLLOW) == 0,
              before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_size == after.st_size, total == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_dev == entry.st_dev, before.st_ino == entry.st_ino
        else { throw CoordinatorError("storage_recovery_plan_changed") }
        return MissingStorageFileFingerprint(
            name: name,
            identity: MissingStorageFileIdentity(device: before.st_dev, inode: before.st_ino),
            size: before.st_size,
            modifiedSeconds: before.st_mtimespec.tv_sec,
            modifiedNanoseconds: before.st_mtimespec.tv_nsec,
            digest: hash.finalize().map { String(format: "%02x", $0) }.joined()
        )
    }

    static func writeJSON(_ object: [String: Any], parent: Int32, name: String) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let descriptor = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard descriptor >= 0 else { throw CoordinatorError("storage_recovery_backup_failed") }
        defer { close(descriptor) }
        try data.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let count = write(descriptor, base.advanced(by: offset), buffer.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw CoordinatorError("storage_recovery_backup_failed") }
                offset += count
            }
        }
        try synchronize(descriptor)
        try synchronize(parent)
    }

    static func synchronizeFile(parent: Int32, file: MissingStorageFileFingerprint) throws {
        let descriptor = openat(parent, file.name, O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw CoordinatorError("storage_recovery_backup_failed") }
        defer { close(descriptor) }
        var info = stat()
        guard try identity(descriptor) == file.identity,
              fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_uid == geteuid(), info.st_nlink == 1
        else {
            throw CoordinatorError("storage_recovery_plan_changed")
        }
        // SQLite creates 0644 WAL/SHM files inside its private 0700 storage
        // directory. Preserve those legitimate residuals, then make the backup
        // file itself owner-only before the anchor is archived.
        guard fchmod(descriptor, mode_t(0o600)) == 0 else {
            throw CoordinatorError("storage_recovery_backup_failed")
        }
        try synchronize(descriptor)
        var entry = stat()
        guard fstat(descriptor, &info) == 0,
              fstatat(parent, file.name, &entry, AT_SYMLINK_NOFOLLOW) == 0,
              info.st_dev == file.identity.device, info.st_ino == file.identity.inode,
              entry.st_dev == info.st_dev, entry.st_ino == info.st_ino,
              info.st_uid == geteuid(), info.st_nlink == 1,
              info.st_mode & 0o7777 == 0o600
        else { throw CoordinatorError("storage_recovery_plan_changed") }
    }

    static func synchronize(_ descriptor: Int32) throws {
        guard fsync(descriptor) == 0 else { throw CoordinatorError("storage_recovery_backup_failed") }
    }
}
