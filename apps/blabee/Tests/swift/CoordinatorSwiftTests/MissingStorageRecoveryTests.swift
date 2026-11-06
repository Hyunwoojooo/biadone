import Darwin
import Foundation
import Testing
@testable import CoordinatorSwift

private final class RecoveryTestAuthority: StorageRecoveryAuthority {}

private final class RecoveryTestAnchor: ArchivableFreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "test-\(UUID().uuidString)"
    private let lock = NSLock()
    private var current: FreshnessStoredRecord?
    private(set) var archives: [UUID: FreshnessStoredRecord] = [:]
    private(set) var archiveAttempts = 0
    var loadFailure: String?
    var archiveFailure: String?
    var failAfterArchive = false

    func load() throws -> FreshnessStoredRecord? {
        lock.lock()
        defer { lock.unlock() }
        if let loadFailure { throw CoordinatorError(loadFailure) }
        return current
    }

    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard current == nil else { throw CoordinatorError("freshness_transition_mismatch") }
        let stored = try FreshnessStoredRecord(record: record, revision: record.revision)
        current = stored
        return stored
    }

    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard current?.revision == expectedRevision else { throw CoordinatorError("freshness_transition_mismatch") }
        let stored = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
        current = stored
        return stored
    }

    func archive(expectedRevision: Data, recoveryID: UUID) throws {
        lock.lock()
        defer { lock.unlock() }
        archiveAttempts += 1
        guard let current, current.revision == expectedRevision else {
            throw CoordinatorError("freshness_transition_mismatch")
        }
        if let archiveFailure { throw CoordinatorError(archiveFailure) }
        archives[recoveryID] = current
        self.current = nil
        if failAfterArchive { throw CoordinatorError("storage_recovery_archive_uncertain") }
    }

    func seed(_ state: FreshnessState) throws {
        let checkpoint = try FreshnessCheckpoint(
            databaseID: UUID().uuidString,
            generation: 4,
            sequence: 20,
            headMAC: Data(repeating: 19, count: 32)
        )
        let record: FreshnessRecord
        switch state {
        case .initializing:
            record = try .initializing(storageSlot: storageSlot)
        case .committed:
            record = try .committed(storageSlot: storageSlot, checkpoint: checkpoint)
        case .pending:
            let transition = try FreshnessPendingTransition(
                from: checkpoint,
                to: FreshnessCheckpoint(
                    databaseID: checkpoint.databaseID,
                    generation: 5,
                    sequence: 21,
                    headMAC: Data(repeating: 20, count: 32)
                ),
                batchDigest: Data(repeating: 21, count: 32)
            )
            record = try .pending(storageSlot: storageSlot, transition: transition)
        }
        lock.lock()
        defer { lock.unlock() }
        current = try FreshnessStoredRecord(record: record, revision: record.revision)
    }
}

private struct RecoveryFixture {
    let root: URL
    let storage: URL
    let database: URL
    let key: URL
    let backups: URL
    let anchor = RecoveryTestAnchor()

    init(storageExists: Bool = true, state: FreshnessState? = .committed) throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-recovery-test-\(UUID().uuidString)")
            .resolvingSymlinksInPath()
        storage = root.appendingPathComponent("storage")
        database = storage.appendingPathComponent("coordinator.sqlite3")
        key = storage.appendingPathComponent("coordinator.key")
        backups = root.appendingPathComponent("recovery")
        try Self.directory(root)
        if storageExists { try Self.directory(storage) }
        if let state { try anchor.seed(state) }
    }

    func engine(
        acquire: @escaping @Sendable () throws -> any StorageRecoveryAuthority = { RecoveryTestAuthority() }
    ) -> MissingStorageRecovery {
        MissingStorageRecovery(
            databaseURL: database,
            keyURL: key,
            backupRootURL: backups,
            freshnessStore: anchor,
            acquireAuthority: acquire
        )
    }

    func clean() { try? FileManager.default.removeItem(at: root) }

    static func directory(_ url: URL) throws {
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
    }

    static func file(_ url: URL, content: String = "test-only residual bytes") throws {
        try Data(content.utf8).write(to: url, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    func sidecar(_ suffix: String) -> URL { URL(fileURLWithPath: database.path + suffix) }
}

private func recoveryExpect(_ code: String, operation: () throws -> Void) {
    do {
        try operation()
        Issue.record("Expected \(code)")
    } catch let error as CoordinatorError {
        #expect(error.code == code)
    } catch { Issue.record("Unexpected recovery error: \(error)") }
}

@Test("Recovery prepare does not create storage, backups, or mutate the anchor")
func missingStorageRecoveryPrepareIsReadOnly() throws {
    let fixture = try RecoveryFixture(storageExists: false)
    defer { fixture.clean() }
    let original = try fixture.anchor.load()
    let before = try FileManager.default.contentsOfDirectory(atPath: fixture.root.path)
    let plan = try fixture.engine().prepare()
    #expect(plan.residualFileNames.isEmpty)
    #expect(try fixture.anchor.load() == original)
    #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.root.path) == before)
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Confirmed missing storage recovery preserves the old anchor and allows fresh bootstrap", arguments: [FreshnessState.committed, .pending])
func missingStorageRecoveryAllowsFreshBootstrap(state: FreshnessState) throws {
    let fixture = try RecoveryFixture(storageExists: false, state: state)
    defer { fixture.clean() }
    let old = try #require(try fixture.anchor.load())
    let engine = fixture.engine()
    let plan = try engine.prepare()
    let receipt = try engine.execute(plan)
    #expect(receipt.recoveryID == plan.recoveryID)
    #expect(receipt.completionRecordWritten)
    #expect(fixture.anchor.archives[plan.recoveryID] == old)
    #expect(try fixture.anchor.load() == nil)
    #expect(!FileManager.default.fileExists(atPath: fixture.database.path))
    #expect(!FileManager.default.fileExists(atPath: fixture.key.path))
    let journal = try SQLiteJournal(databaseURL: fixture.database, keyURL: fixture.key, freshnessStore: fixture.anchor)
    #expect(try journal.load().journalSequence == 0)
    #expect(try fixture.anchor.load()?.record.checkpoint.databaseID != old.record.checkpoint.databaseID)
}

@Test("Recovery keeps residual WAL, SHM and rollback journal bytes and unrelated config")
func missingStorageRecoveryPreservesResidualFiles() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let configuration = fixture.root.appendingPathComponent("service.json")
    try RecoveryFixture.file(configuration, content: "unchanged project settings")
    for suffix in ["-wal", "-shm", "-journal"] {
        try RecoveryFixture.file(fixture.sidecar(suffix), content: "residual \(suffix)")
    }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    #expect(plan.residualFileNames.count == 3)
    let receipt = try engine.execute(plan)
    for suffix in ["-wal", "-shm", "-journal"] {
        let original = fixture.sidecar(suffix)
        #expect(!FileManager.default.fileExists(atPath: original.path))
        let archived = receipt.backupDirectoryURL.appendingPathComponent(original.lastPathComponent)
        #expect(try String(contentsOf: archived, encoding: .utf8) == "residual \(suffix)")
    }
    #expect(try String(contentsOf: configuration, encoding: .utf8) == "unchanged project settings")
    let manifest = try String(contentsOf: receipt.backupDirectoryURL.appendingPathComponent("recovery-plan.json"), encoding: .utf8)
    #expect(manifest.contains("archive_missing_storage_anchor"))
    #expect(!manifest.contains("head_mac"))
    #expect(!manifest.contains("residual -wal"))
}

@Test("Absent or initializing anchors are not eligible", arguments: [false, true])
func missingStorageRecoveryRejectsUntrustedBootstrap(initializing: Bool) throws {
    let fixture = try RecoveryFixture(state: initializing ? .initializing : nil)
    defer { fixture.clean() }
    recoveryExpect("storage_recovery_not_eligible") { _ = try fixture.engine().prepare() }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Corrupt or unavailable anchors are never bypassed", arguments: ["freshness_anchor_corrupt", "freshness_anchor_unavailable"])
func missingStorageRecoveryPreservesAnchorFailures(code: String) throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    fixture.anchor.loadFailure = code
    recoveryExpect(code) { _ = try fixture.engine().prepare() }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Existing database or key must never be reset", arguments: ["database", "key", "both", "database_symlink", "key_symlink"])
func missingStorageRecoveryRejectsRemainingStorage(kind: String) throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    if kind == "database" || kind == "both" { try RecoveryFixture.file(fixture.database) }
    if kind == "key" || kind == "both" { try RecoveryFixture.file(fixture.key) }
    if kind == "database_symlink" || kind == "key_symlink" {
        try FileManager.default.createSymbolicLink(
            at: kind == "database_symlink" ? fixture.database : fixture.key,
            withDestinationURL: fixture.root.appendingPathComponent("absent-target")
        )
    }
    recoveryExpect("storage_recovery_not_eligible") { _ = try fixture.engine().prepare() }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Changed anchor revision invalidates the confirmation plan")
func missingStorageRecoveryRejectsChangedRevision() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    try fixture.anchor.seed(.committed)
    let changed = try fixture.anchor.load()
    recoveryExpect("storage_recovery_plan_changed") { _ = try engine.execute(plan) }
    #expect(try fixture.anchor.load() == changed)
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Storage recreated after confirmation is never archived", arguments: ["database", "key"])
func missingStorageRecoveryRejectsRecreatedStorage(kind: String) throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    try RecoveryFixture.file(kind == "database" ? fixture.database : fixture.key)
    recoveryExpect("storage_recovery_not_eligible") { _ = try engine.execute(plan) }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Directory replacement invalidates confirmation")
func missingStorageRecoveryRejectsReplacedParent() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    try FileManager.default.moveItem(at: fixture.storage, to: fixture.root.appendingPathComponent("old-storage"))
    try RecoveryFixture.directory(fixture.storage)
    recoveryExpect("storage_recovery_plan_changed") { _ = try engine.execute(plan) }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Sidecar mutation invalidates confirmation")
func missingStorageRecoveryRejectsChangedSidecar() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let sidecar = fixture.sidecar("-wal")
    try RecoveryFixture.file(sidecar)
    let engine = fixture.engine()
    let plan = try engine.prepare()
    try Data("changed contents".utf8).write(to: sidecar)
    recoveryExpect("storage_recovery_plan_changed") { _ = try engine.execute(plan) }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Symlinked storage and unsafe residual files are refused", arguments: ["parent", "sidecar", "permissions", "world_writable", "executable", "special_bits", "hardlink"])
func missingStorageRecoveryRejectsUnsafeFiles(kind: String) throws {
    let fixture = try RecoveryFixture(storageExists: kind != "parent")
    defer { fixture.clean() }
    if kind == "parent" {
        let destination = fixture.root.appendingPathComponent("other")
        try RecoveryFixture.directory(destination)
        try FileManager.default.createSymbolicLink(at: fixture.storage, withDestinationURL: destination)
    } else if kind == "sidecar" {
        try FileManager.default.createSymbolicLink(at: fixture.sidecar("-wal"), withDestinationURL: fixture.root.appendingPathComponent("absent"))
    } else {
        let sidecar = fixture.sidecar("-wal")
        try RecoveryFixture.file(sidecar)
        if kind == "permissions" {
            try FileManager.default.setAttributes([.posixPermissions: 0o664], ofItemAtPath: sidecar.path)
        } else if kind == "world_writable" {
            try FileManager.default.setAttributes([.posixPermissions: 0o666], ofItemAtPath: sidecar.path)
        } else if kind == "executable" {
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: sidecar.path)
        } else if kind == "special_bits" {
            try FileManager.default.setAttributes([.posixPermissions: 0o4600], ofItemAtPath: sidecar.path)
        } else {
            try FileManager.default.linkItem(at: sidecar, to: fixture.root.appendingPathComponent("linked"))
        }
    }
    recoveryExpect("storage_recovery_unsafe_path") { _ = try fixture.engine().prepare() }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("SQLite mode 0644 residuals in a private directory are backed up with mode 0600")
func missingStorageRecoveryPreservesOrdinarySQLitePermissions() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    for suffix in ["-wal", "-shm"] {
        let sidecar = fixture.sidecar(suffix)
        try RecoveryFixture.file(sidecar, content: "SQLite residual \(suffix)")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: sidecar.path)
    }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    let receipt = try engine.execute(plan)
    for suffix in ["-wal", "-shm"] {
        let archived = receipt.backupDirectoryURL.appendingPathComponent(fixture.sidecar(suffix).lastPathComponent)
        #expect(try String(contentsOf: archived, encoding: .utf8) == "SQLite residual \(suffix)")
        var info = stat()
        #expect(lstat(archived.path, &info) == 0)
        #expect(info.st_mode & 0o7777 == 0o600)
    }
}

@Test("Recovery refuses an active authority")
func missingStorageRecoveryRejectsActiveService() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let engine = fixture.engine { throw CoordinatorError("operational_owner_active") }
    recoveryExpect("operational_owner_active") { _ = try engine.prepare() }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Recovery fails promptly with an in-process journal writer")
func missingStorageRecoveryRejectsInProcessWriter() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    let writer = try StorageProcessLock(keyURL: fixture.key, allowParentCreation: false)
    try writer.withLock {
        recoveryExpect("storage_recovery_busy") { _ = try engine.execute(plan) }
    }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Recovery fails promptly with another file-lock owner")
func missingStorageRecoveryRejectsFileLockWriter() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    let path = fixture.storage.appendingPathComponent(".blabee-coordinator-freshness.lock").path
    let descriptor = open(path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
    #expect(descriptor >= 0)
    defer { close(descriptor) }
    #expect(flock(descriptor, LOCK_EX | LOCK_NB) == 0)
    defer { _ = flock(descriptor, LOCK_UN) }
    recoveryExpect("storage_recovery_busy") { _ = try engine.execute(plan) }
    #expect(fixture.anchor.archiveAttempts == 0)
}

@Test("Archive failure after sidecar backup keeps the primary guard and is retryable")
func missingStorageRecoveryArchiveFailurePreservesGuard() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    try RecoveryFixture.file(fixture.sidecar("-wal"))
    let original = try fixture.anchor.load()
    let engine = fixture.engine()
    let plan = try engine.prepare()
    fixture.anchor.archiveFailure = "freshness_anchor_unavailable"
    recoveryExpect("freshness_anchor_unavailable") { _ = try engine.execute(plan) }
    #expect(try fixture.anchor.load() == original)
    #expect(FileManager.default.fileExists(atPath: plan.backupDirectoryURL.appendingPathComponent("coordinator.sqlite3-wal").path))
    recoveryExpect("freshness_storage_missing") {
        _ = try SQLiteJournal(databaseURL: fixture.database, keyURL: fixture.key, freshnessStore: fixture.anchor)
    }
    fixture.anchor.archiveFailure = nil
    let retry = try engine.prepare()
    #expect(retry.recoveryID != plan.recoveryID)
    _ = try engine.execute(retry)
    #expect(FileManager.default.fileExists(atPath: plan.backupDirectoryURL.appendingPathComponent("coordinator.sqlite3-wal").path))
}

@Test("Ambiguous post-archive result never restores or automatically rearchives the anchor")
func missingStorageRecoveryDoesNotUndoVerifiedArchive() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let engine = fixture.engine()
    let plan = try engine.prepare()
    fixture.anchor.failAfterArchive = true
    recoveryExpect("storage_recovery_archive_uncertain") { _ = try engine.execute(plan) }
    #expect(try fixture.anchor.load() == nil)
    #expect(fixture.anchor.archives[plan.recoveryID] != nil)
    #expect(fixture.anchor.archiveAttempts == 1)
    recoveryExpect("storage_recovery_not_eligible") { _ = try engine.execute(plan) }
    #expect(fixture.anchor.archiveAttempts == 1)
}

@Test("A prepared plan cannot be executed by another recovery instance")
func missingStorageRecoveryPlanIsBoundToEngine() throws {
    let fixture = try RecoveryFixture()
    defer { fixture.clean() }
    let plan = try fixture.engine().prepare()
    recoveryExpect("storage_recovery_plan_changed") { _ = try fixture.engine().execute(plan) }
    #expect(fixture.anchor.archiveAttempts == 0)
}
