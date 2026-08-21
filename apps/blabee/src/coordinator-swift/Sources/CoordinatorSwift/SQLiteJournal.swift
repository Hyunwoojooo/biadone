import Darwin
import Foundation
import CoreFoundation
import SQLite3

public enum JournalCrashPoint: String, Sendable {
    case beforeCommit = "before_commit"
    case afterFreshnessPendingBeforeSQLiteCommit = "after_freshness_pending_before_sqlite_commit"
    case afterSQLiteCommitBeforeFreshnessFinalize = "after_sqlite_commit_before_freshness_finalize"
    case afterCommitBeforeResponse = "after_commit_before_response"
}

public struct JournalSnapshot: Sendable, Equatable {
    public let events: [Data]
    public let documents: [Data]
    public let verificationRecords: [Data]
    public let journalSequence: Int64
}

public struct JournalAppendResult: Sendable, Equatable {
    public let firstSequence: Int64
    public let lastSequence: Int64
    public let eventCount: Int
}

public struct SQLiteConfiguration: Sendable, Equatable {
    public let journalMode: String
    public let synchronous: String
    public let foreignKeys: Bool
    public let busyTimeoutMilliseconds: Int32
}

public struct JournalIntegrityResult: Sendable, Equatable {
    public let integrityCheck: String
    public let quickCheck: String
    public let sidecarsVerified: Int
}

public struct JournalHealth: Sendable, Equatable {
    public let schemaVersion: Int
    public let journalSequence: Int64
    public let sqlite: SQLiteConfiguration
    public let integrityCheck: String
}

public final class SQLiteJournal: @unchecked Sendable {
    public static let schemaVersion = 1

    private static let schemaTableDefinitions: [(name: String, sql: String)] = [
        (
            "coordinator_metadata",
            """
            CREATE TABLE coordinator_metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value BLOB NOT NULL
            ) WITHOUT ROWID
            """
        ),
        (
            "runtime_events",
            """
            CREATE TABLE runtime_events (
                event_sequence INTEGER PRIMARY KEY NOT NULL CHECK(event_sequence >= 1),
                event_id TEXT NOT NULL UNIQUE,
                json BLOB NOT NULL CHECK(length(json) > 0),
                prev_mac BLOB NOT NULL CHECK(length(prev_mac) = 32),
                mac BLOB NOT NULL CHECK(length(mac) = 32)
            )
            """
        ),
        (
            "packet_documents",
            """
            CREATE TABLE packet_documents (
                packet_id TEXT NOT NULL,
                revision INTEGER NOT NULL CHECK(revision >= 1),
                json BLOB NOT NULL CHECK(length(json) > 0),
                mac BLOB NOT NULL CHECK(length(mac) = 32),
                PRIMARY KEY(packet_id, revision)
            )
            """
        ),
        (
            "verification_records",
            """
            CREATE TABLE verification_records (
                continuation_id TEXT PRIMARY KEY NOT NULL,
                dispatch_event_id TEXT NOT NULL UNIQUE,
                token_fingerprint TEXT NOT NULL UNIQUE,
                json BLOB NOT NULL CHECK(length(json) > 0),
                mac BLOB NOT NULL CHECK(length(mac) = 32),
                FOREIGN KEY(dispatch_event_id) REFERENCES runtime_events(event_id)
            )
            """
        ),
    ]

    private static let schemaAutomaticIndexes: [(name: String, table: String)] = [
        ("sqlite_autoindex_packet_documents_1", "packet_documents"),
        ("sqlite_autoindex_runtime_events_1", "runtime_events"),
        ("sqlite_autoindex_verification_records_1", "verification_records"),
        ("sqlite_autoindex_verification_records_2", "verification_records"),
        ("sqlite_autoindex_verification_records_3", "verification_records"),
    ]

    public let databaseURL: URL
    public let keyURL: URL
    public let secretCorpus: RuntimeSecretCorpus
    public private(set) var configuration = SQLiteConfiguration(
        journalMode: "uninitialized",
        synchronous: "uninitialized",
        foreignKeys: false,
        busyTimeoutMilliseconds: 0
    )

    private let validator: V1IngressValidator
    private let freshnessStore: any FreshnessAnchorStore
    private let storageProcessLock: StorageProcessLock
    private var authenticator: SidecarAuthenticator!
    private let lock = NSLock()
    private var database: OpaquePointer?

    public init(
        databaseURL: URL,
        keyURL: URL,
        freshnessStore: any FreshnessAnchorStore,
        busyTimeoutMilliseconds: Int32 = 5_000,
        validator: V1IngressValidator = V1IngressValidator(),
        secretCorpus: RuntimeSecretCorpus = RuntimeSecretCorpus()
    ) throws {
        self.databaseURL = databaseURL.standardizedFileURL
        self.keyURL = keyURL.standardizedFileURL
        self.validator = validator
        self.secretCorpus = secretCorpus
        self.freshnessStore = freshnessStore
        let allowLockParentCreation = try Self.preflightFreshnessStorage(
            databaseURL: self.databaseURL,
            keyURL: self.keyURL,
            freshnessStore: freshnessStore
        )
        storageProcessLock = try StorageProcessLock(
            keyURL: self.keyURL,
            allowParentCreation: allowLockParentCreation
        )

        do {
            try storageProcessLock.withLock {
                let bootstrap = try prepareFreshnessBootstrap()
                let storageKey = try ExternalStorageKeyStore.loadOrCreate(
                    at: keyURL,
                    allowCreate: bootstrap.allowKeyCreation
                )
                registerStorageKey(storageKey)
                authenticator = SidecarAuthenticator(storageKey: storageKey)
                try openDatabase(
                    createFile: bootstrap.createDatabaseFile,
                    busyTimeoutMilliseconds: busyTimeoutMilliseconds
                )
                try configureDatabase(busyTimeoutMilliseconds: busyTimeoutMilliseconds)
                try migrateOrVerifySchema(
                    allowCreate: bootstrap.initializeDatabase,
                    databaseID: bootstrap.stored.record.checkpoint.databaseID
                )
                try execute("BEGIN IMMEDIATE")
                do {
                    let precheck = try precheckFreshness(
                        stored: try requiredFreshnessRecord(),
                        databaseCheckpoint: try currentCheckpoint(),
                        allowPendingSource: true
                    )
                    _ = try integrityUnlocked(includeQuickCheck: false)
                    _ = try finishFreshnessAfterReplay(precheck)
                    try execute("COMMIT")
                } catch {
                    try? execute("ROLLBACK")
                    throw error
                }
            }
        } catch {
            if let database { sqlite3_close_v2(database) }
            database = nil
            throw error
        }
    }

    deinit {
        if let database { sqlite3_close_v2(database) }
    }

    public func health() throws -> JournalHealth {
        try synchronizedWithStorageLock {
            try withImmediateTransaction {
                let precheck = try precheckFreshness(
                    stored: try requiredFreshnessRecord(),
                    databaseCheckpoint: try currentCheckpoint(),
                    allowPendingSource: false
                )
                let integrity = try integrityUnlocked(includeQuickCheck: false)
                try requireFreshnessReady(after: precheck)
                return JournalHealth(
                    schemaVersion: Self.schemaVersion,
                    journalSequence: try currentSequence(),
                    sqlite: configuration,
                    integrityCheck: integrity.integrityCheck
                )
            }
        }
    }

    public func load() throws -> JournalSnapshot {
        try synchronizedWithStorageLock {
            try withImmediateTransaction {
                let precheck = try precheckFreshness(
                    stored: try requiredFreshnessRecord(),
                    databaseCheckpoint: try currentCheckpoint(),
                    allowPendingSource: false
                )
                let snapshot = try loadUnlocked()
                try requireFreshnessReady(after: precheck)
                return snapshot
            }
        }
    }

    public func integrity() throws -> JournalIntegrityResult {
        try synchronizedWithStorageLock {
            try withImmediateTransaction {
                let precheck = try precheckFreshness(
                    stored: try requiredFreshnessRecord(),
                    databaseCheckpoint: try currentCheckpoint(),
                    allowPendingSource: false
                )
                let result = try integrityUnlocked(includeQuickCheck: true)
                try requireFreshnessReady(after: precheck)
                return result
            }
        }
    }

    public func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data] = [],
        verificationRecords: [Data] = [],
        crashPoint: JournalCrashPoint? = nil
    ) throws -> JournalAppendResult {
        try synchronized {
            try require(expectedSequence >= 0, "journal_sequence_conflict", "expected sequence is negative")
            try require(!events.isEmpty, "journal_empty_batch")

            let preparedEvents = try events.map { try prepareRuntimeEvent($0) }
            let preparedDocuments = try documents.map { try preparePacketDocument($0) }
            let preparedVerifications = try verificationRecords.map { try prepareVerificationRecord($0) }
            try assertBatchUniqueness(
                events: preparedEvents,
                documents: preparedDocuments,
                verifications: preparedVerifications
            )
            let batchDigest = FreshnessBatchDigest.compute(
                expectedSequence: expectedSequence,
                events: preparedEvents.map(\.json),
                documents: preparedDocuments.map(\.json),
                verificationRecords: preparedVerifications.map(\.json)
            )
            return try storageProcessLock.withLock {
                try appendLocked(
                    expectedSequence: expectedSequence,
                    preparedEvents: preparedEvents,
                    preparedDocuments: preparedDocuments,
                    preparedVerifications: preparedVerifications,
                    batchDigest: batchDigest,
                    crashPoint: crashPoint
                )
            }
        }
    }

    private func appendLocked(
        expectedSequence: Int64,
        preparedEvents: [PreparedEvent],
        preparedDocuments: [PreparedDocument],
        preparedVerifications: [PreparedVerification],
        batchDigest: Data,
        crashPoint: JournalCrashPoint?
    ) throws -> JournalAppendResult {
        var pendingStored: FreshnessStoredRecord?
        var targetCheckpoint: FreshnessCheckpoint?
        try execute("BEGIN IMMEDIATE")
        do {
            try verifySchemaV1()
            let sourceCheckpoint = try currentCheckpoint()
            let precheck = try precheckFreshness(
                stored: try requiredFreshnessRecord(),
                databaseCheckpoint: sourceCheckpoint,
                allowPendingSource: true
            )
            if case let .pendingSource(_, transition) = precheck {
                try require(
                    batchDigest == transition.batchDigest
                        && expectedSequence == transition.from.sequence,
                    "freshness_transition_pending",
                    "a different freshness transition is pending"
                )
            }
            let currentSnapshot = try loadUnlocked()
            let reconciliation = try finishFreshnessAfterReplay(precheck)
            switch reconciliation {
            case let .ready(stored):
                guard currentSnapshot.journalSequence == expectedSequence else {
                    throw CoordinatorError(
                        "journal_sequence_conflict",
                        "expected \(expectedSequence), current \(currentSnapshot.journalSequence)"
                    )
                }
                pendingStored = stored
            case let .pendingSource(stored, _):
                pendingStored = stored
            }

            for (index, event) in preparedEvents.enumerated() {
                let (requiredSequence, overflow) = expectedSequence.addingReportingOverflow(Int64(index) + 1)
                try require(
                    !overflow && event.sequence == requiredSequence,
                    "journal_batch_sequence_not_contiguous"
                )
            }
            let existingEvents = try currentSnapshot.events.map { try prepareRuntimeEvent($0) }
            let existingDocuments = try currentSnapshot.documents.map { try preparePacketDocument($0) }
            try assertSelectionUniqueness(existingEvents: existingEvents, events: preparedEvents)
            try assertAtomicSidecars(
                events: preparedEvents,
                existingDocuments: existingDocuments,
                documents: preparedDocuments,
                verifications: preparedVerifications
            )
            try rejectExistingDuplicates(
                events: preparedEvents,
                documents: preparedDocuments,
                verifications: preparedVerifications
            )

            var previousMAC = sourceCheckpoint.headMAC
            for event in preparedEvents { previousMAC = try insert(event, previousMAC: previousMAC) }
            let (targetGeneration, generationOverflow) = sourceCheckpoint.generation.addingReportingOverflow(1)
            try require(!generationOverflow, "freshness_transition_mismatch", "freshness generation overflow")
            let target = try FreshnessCheckpoint(
                databaseID: sourceCheckpoint.databaseID,
                generation: targetGeneration,
                sequence: preparedEvents[preparedEvents.count - 1].sequence,
                headMAC: previousMAC
            )
            try updateEventChainAnchor(checkpoint: target)
            for document in preparedDocuments { try insert(document) }
            for verification in preparedVerifications { try insert(verification) }

            guard let stored = pendingStored else {
                throw CoordinatorError("freshness_transition_mismatch", "freshness record is unavailable")
            }
            if case let .pendingSource(_, transition) = reconciliation {
                try require(
                    transition.from == sourceCheckpoint && transition.to == target,
                    "freshness_transition_mismatch",
                    "pending freshness target does not match the exact retry"
                )
            } else {
                let transition = try FreshnessPendingTransition(
                    from: sourceCheckpoint,
                    to: target,
                    batchDigest: batchDigest
                )
                let pending = try FreshnessRecord.pending(
                    storageSlot: freshnessStore.storageSlot,
                    transition: transition
                )
                pendingStored = try freshnessStore.compareAndSwap(
                    expectedRevision: stored.revision,
                    replacement: pending
                )
            }
            targetCheckpoint = target
            if crashPoint == .beforeCommit
                || crashPoint == .afterFreshnessPendingBeforeSQLiteCommit {
                _exit(crashPoint == .beforeCommit ? 85 : 87)
            }
            do {
                try execute("COMMIT")
            } catch {
                throw CoordinatorError(
                    "freshness_commit_ambiguous",
                    "SQLite commit outcome could not be determined"
                )
            }
        } catch {
            try? execute("ROLLBACK")
            throw error
        }

        guard pendingStored != nil, let targetCheckpoint else {
            throw CoordinatorError("freshness_commit_ambiguous", "freshness transition state was lost")
        }
        if crashPoint == .afterSQLiteCommitBeforeFreshnessFinalize { _exit(88) }
        do {
            try execute("BEGIN IMMEDIATE")
            do {
                let committedCheckpoint = try currentCheckpoint()
                let precheck = try precheckFreshness(
                    stored: try requiredFreshnessRecord(),
                    databaseCheckpoint: committedCheckpoint,
                    allowPendingSource: false
                )
                let committed = try loadUnlocked()
                let expectedSuffix = preparedEvents.map(\.json)
                try require(
                    committedCheckpoint == targetCheckpoint
                        && committed.journalSequence == targetCheckpoint.sequence
                        && Array(committed.events.suffix(preparedEvents.count)) == expectedSuffix,
                    "freshness_commit_ambiguous",
                    "committed journal effect does not match the freshness target"
                )
                try requireFreshnessReady(after: precheck)
                try execute("COMMIT")
            } catch {
                try? execute("ROLLBACK")
                throw error
            }
        } catch {
            if (try? freshnessStore.load()?.record) == (try? FreshnessRecord.committed(
                storageSlot: freshnessStore.storageSlot,
                checkpoint: targetCheckpoint
            )) {
                // A write that completed but whose immediate result was lost is still safe.
            } else {
                throw CoordinatorError(
                    "freshness_commit_ambiguous",
                    "committed journal freshness could not be authenticated"
                )
            }
        }
        if crashPoint == .afterCommitBeforeResponse { _exit(86) }
        return JournalAppendResult(
            firstSequence: preparedEvents[0].sequence,
            lastSequence: preparedEvents[preparedEvents.count - 1].sequence,
            eventCount: preparedEvents.count
        )
    }

    private func synchronized<T>(_ operation: () throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        return try operation()
    }

    private func synchronizedWithStorageLock<T>(_ operation: () throws -> T) throws -> T {
        try synchronized { try storageProcessLock.withLock(operation) }
    }

    private func withImmediateTransaction<T>(_ operation: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try operation()
            try execute("COMMIT")
            return result
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private struct FreshnessBootstrap {
        let stored: FreshnessStoredRecord
        let allowKeyCreation: Bool
        let initializeDatabase: Bool
        let createDatabaseFile: Bool
    }

    private enum FreshnessReconciliation {
        case ready(FreshnessStoredRecord)
        case pendingSource(FreshnessStoredRecord, FreshnessPendingTransition)
    }

    private enum FreshnessPrecheck {
        case initializing(FreshnessStoredRecord)
        case committed(FreshnessStoredRecord)
        case pendingSource(FreshnessStoredRecord, FreshnessPendingTransition)
        case pendingTarget(FreshnessStoredRecord, FreshnessPendingTransition)
    }

    private static func preflightFreshnessStorage(
        databaseURL: URL,
        keyURL: URL,
        freshnessStore: any FreshnessAnchorStore
    ) throws -> Bool {
        let databaseState = try databaseFileState(databaseURL.path)
        let keyExists = pathEntryExists(keyURL.path)
        guard let stored = try freshnessStore.load() else {
            guard databaseState == .missing && !keyExists else {
                throw CoordinatorError(
                    "freshness_anchor_missing",
                    "an existing storage pair has no trusted freshness anchor"
                )
            }
            return true
        }
        switch stored.record.state {
        case .initializing:
            switch (databaseState, keyExists) {
            case (.missing, false):
                return true
            case (.missing, true), (.regularEmpty, true), (.regularNonEmpty, true):
                return false
            case (.invalid, _):
                throw CoordinatorError("freshness_storage_missing", "database path is not a regular file")
            case (.regularEmpty, false), (.regularNonEmpty, false):
                throw CoordinatorError("freshness_storage_missing", "initializing storage lost its key")
            }
        case .committed, .pending:
            guard databaseState == .regularNonEmpty && keyExists else {
                throw CoordinatorError(
                    "freshness_storage_missing",
                    "trusted freshness state exists but database storage is missing"
                )
            }
            return false
        }
    }

    private func prepareFreshnessBootstrap() throws -> FreshnessBootstrap {
        let databaseState = try Self.databaseFileState(databaseURL.path)
        let keyExists = Self.pathEntryExists(keyURL.path)
        var stored = try freshnessStore.load()

        if stored == nil {
            guard databaseState == .missing && !keyExists else {
                throw CoordinatorError(
                    "freshness_anchor_missing",
                    "an existing storage pair has no trusted freshness anchor"
                )
            }
            let initializing = try FreshnessRecord.initializing(storageSlot: freshnessStore.storageSlot)
            stored = try freshnessStore.create(initializing)
        }
        guard let stored else {
            throw CoordinatorError("freshness_anchor_unavailable", "freshness anchor creation failed")
        }

        switch stored.record.state {
        case .initializing:
            switch (databaseState, keyExists) {
            case (.missing, false):
                return FreshnessBootstrap(
                    stored: stored,
                    allowKeyCreation: true,
                    initializeDatabase: true,
                    createDatabaseFile: true
                )
            case (.missing, true):
                return FreshnessBootstrap(
                    stored: stored,
                    allowKeyCreation: false,
                    initializeDatabase: true,
                    createDatabaseFile: true
                )
            case (.regularEmpty, true):
                return FreshnessBootstrap(
                    stored: stored,
                    allowKeyCreation: false,
                    initializeDatabase: true,
                    createDatabaseFile: false
                )
            case (.regularNonEmpty, true):
                return FreshnessBootstrap(
                    stored: stored,
                    allowKeyCreation: false,
                    initializeDatabase: true,
                    createDatabaseFile: false
                )
            case (.invalid, _):
                throw CoordinatorError("freshness_storage_missing", "database path is not a regular file")
            case (.regularEmpty, false), (.regularNonEmpty, false):
                throw CoordinatorError("freshness_storage_missing", "initializing storage lost its key")
            }
        case .committed, .pending:
            guard databaseState == .regularNonEmpty && keyExists else {
                throw CoordinatorError(
                    "freshness_storage_missing",
                    "trusted freshness state exists but database storage is missing"
                )
            }
            return FreshnessBootstrap(
                stored: stored,
                allowKeyCreation: false,
                initializeDatabase: false,
                createDatabaseFile: false
            )
        }
    }

    private func registerStorageKey(_ storageKey: StorageKey) {
        secretCorpus.register(storageKey.bytes)
        secretCorpus.register(storageKey.bytes.base64EncodedString())
        let keyHex = storageKey.bytes.map { String(format: "%02x", $0) }.joined()
        secretCorpus.register(keyHex)
        secretCorpus.register(keyHex.uppercased())
    }

    private func openDatabase(createFile: Bool, busyTimeoutMilliseconds: Int32) throws {
        try FileManager.default.createDirectory(
            at: databaseURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        var handle: OpaquePointer?
        var flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        if createFile { flags |= SQLITE_OPEN_CREATE | SQLITE_OPEN_EXCLUSIVE }
        guard sqlite3_open_v2(databaseURL.path, &handle, flags, nil) == SQLITE_OK, let handle else {
            if let handle { sqlite3_close_v2(handle) }
            throw CoordinatorError("database_integrity_failed", "cannot open SQLite database")
        }
        database = handle
        guard sqlite3_busy_timeout(handle, busyTimeoutMilliseconds) == SQLITE_OK else {
            throw sqliteError(code: "database_integrity_failed")
        }
    }

    private func configureDatabase(busyTimeoutMilliseconds: Int32) throws {
        let configuredBusyTimeout = try integerPragma("PRAGMA busy_timeout")
        try require(
            configuredBusyTimeout == Int64(busyTimeoutMilliseconds),
            "database_integrity_failed",
            "SQLite busy timeout was not applied"
        )
        let mode = try textPragma("PRAGMA journal_mode=WAL").lowercased()
        try require(mode == "wal", "database_integrity_failed", "SQLite WAL mode was not enabled")
        try execute("PRAGMA synchronous=FULL")
        let synchronous = try integerPragma("PRAGMA synchronous")
        try require(
            synchronous == 2,
            "database_integrity_failed",
            "SQLite synchronous is not FULL"
        )
        try execute("PRAGMA foreign_keys=ON")
        let foreignKeys = try integerPragma("PRAGMA foreign_keys")
        try require(
            foreignKeys == 1,
            "database_integrity_failed",
            "SQLite foreign keys are not enabled"
        )
        configuration = SQLiteConfiguration(
            journalMode: mode,
            synchronous: "full",
            foreignKeys: true,
            busyTimeoutMilliseconds: busyTimeoutMilliseconds
        )
    }

    private func requiredFreshnessRecord() throws -> FreshnessStoredRecord {
        guard let stored = try freshnessStore.load() else {
            throw CoordinatorError("freshness_anchor_missing", "trusted freshness anchor is missing")
        }
        return stored
    }

    private func requireFreshnessReady(after precheck: FreshnessPrecheck) throws {
        let result = try finishFreshnessAfterReplay(precheck)
        guard case .ready = result else {
            throw CoordinatorError("freshness_transition_pending", "a freshness transition is pending")
        }
    }

    private func precheckFreshness(
        stored: FreshnessStoredRecord,
        databaseCheckpoint: FreshnessCheckpoint,
        allowPendingSource: Bool
    ) throws -> FreshnessPrecheck {
        let record = stored.record
        guard record.checkpoint.databaseID == databaseCheckpoint.databaseID else {
            throw CoordinatorError(
                "freshness_database_identity_mismatch",
                "database identity differs from the trusted freshness anchor"
            )
        }
        switch record.state {
        case .initializing:
            guard record.checkpoint == databaseCheckpoint else {
                throw CoordinatorError(
                    "freshness_transition_mismatch",
                    "initializing database does not match its freshness anchor"
                )
            }
            return .initializing(stored)
        case .committed:
            guard record.checkpoint == databaseCheckpoint else {
                throw CoordinatorError(
                    "freshness_rollback_detected",
                    "database checkpoint differs from the trusted high-water mark"
                )
            }
            return .committed(stored)
        case .pending:
            guard let transition = record.pendingTransition else {
                throw CoordinatorError("freshness_anchor_corrupt", "pending transition is missing")
            }
            if databaseCheckpoint == transition.to {
                return .pendingTarget(stored, transition)
            }
            if databaseCheckpoint == transition.from {
                guard allowPendingSource else {
                    throw CoordinatorError(
                        "freshness_transition_pending",
                        "a freshness transition requires the exact original batch retry"
                    )
                }
                return .pendingSource(stored, transition)
            }
            throw CoordinatorError(
                "freshness_transition_mismatch",
                "database checkpoint matches neither side of the pending transition"
            )
        }
    }

    private func finishFreshnessAfterReplay(
        _ precheck: FreshnessPrecheck
    ) throws -> FreshnessReconciliation {
        switch precheck {
        case let .committed(stored):
            return .ready(stored)
        case let .initializing(stored):
            let committed = try FreshnessRecord.committed(
                storageSlot: freshnessStore.storageSlot,
                checkpoint: stored.record.checkpoint
            )
            return .ready(try freshnessStore.compareAndSwap(
                expectedRevision: stored.revision,
                replacement: committed
            ))
        case let .pendingSource(stored, transition):
            return .pendingSource(stored, transition)
        case let .pendingTarget(stored, transition):
            return .ready(try finalizePendingRecord(
                pendingStored: stored,
                target: transition.to
            ))
        }
    }

    private func finalizePendingRecord(
        pendingStored: FreshnessStoredRecord,
        target: FreshnessCheckpoint
    ) throws -> FreshnessStoredRecord {
        guard pendingStored.record.state == .pending,
              pendingStored.record.pendingTransition?.to == target
        else {
            throw CoordinatorError("freshness_transition_mismatch", "freshness transition cannot be finalized")
        }
        let committed = try FreshnessRecord.committed(
            storageSlot: freshnessStore.storageSlot,
            checkpoint: target
        )
        return try freshnessStore.compareAndSwap(
            expectedRevision: pendingStored.revision,
            replacement: committed
        )
    }

    private func migrateOrVerifySchema(allowCreate: Bool, databaseID: String) throws {
        try execute("BEGIN IMMEDIATE")
        do {
            let version = try integerPragma("PRAGMA user_version")
            switch version {
            case 0:
                try require(
                    allowCreate,
                    "database_integrity_failed",
                    "an existing database cannot be initialized as a new journal"
                )
                let metadataExists = try tableExists("coordinator_metadata")
                let existingTables = try userTableCount()
                try require(
                    !metadataExists && existingTables == 0,
                    "schema_version_mismatch",
                    "unversioned coordinator schema exists"
                )
                try createSchemaV1(databaseID: databaseID)
            case Int64(Self.schemaVersion):
                try verifySchemaV1()
            default:
                throw CoordinatorError("schema_version_mismatch", "unsupported SQLite schema version \(version)")
            }
            try execute("COMMIT")
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func createSchemaV1(databaseID: String) throws {
        for definition in Self.schemaTableDefinitions { try execute(definition.sql) }
        try execute("PRAGMA user_version=1")
        try insertMetadata(key: "schema_version", value: Data("1".utf8))
        let verifier = authenticator.authenticationCode(
            domain: SidecarAuthenticator.keyVerifierDomain,
            identity: "schema:1",
            canonicalJSON: Data("blabee-coordinator-storage-key".utf8)
        )
        try insertMetadata(key: "key_verifier", value: verifier)
        let emptyHead = Data(repeating: 0, count: 32)
        try insertMetadata(key: "database_id", value: Data(databaseID.utf8))
        try insertMetadata(key: "freshness_generation", value: Data("0".utf8))
        try insertMetadata(key: "event_chain_sequence", value: Data("0".utf8))
        try insertMetadata(key: "event_chain_head", value: emptyHead)
        let checkpoint = try FreshnessCheckpoint(
            databaseID: databaseID,
            generation: 0,
            sequence: 0,
            headMAC: emptyHead
        )
        try insertMetadata(
            key: "event_chain_anchor",
            value: eventChainAnchor(checkpoint: checkpoint)
        )
    }

    private func verifySchemaV1() throws {
        try verifyExactSchemaObjects()
        let storedVersion = try metadataValue(key: "schema_version")
        try require(
            storedVersion == Data("1".utf8),
            "schema_version_mismatch",
            "metadata schema version mismatch"
        )
        guard let verifier = try metadataValue(key: "key_verifier") else {
            throw CoordinatorError("storage_key_invalid", "storage key verifier is missing")
        }
        try require(
            authenticator.verify(
                verifier,
                domain: SidecarAuthenticator.keyVerifierDomain,
                identity: "schema:1",
                canonicalJSON: Data("blabee-coordinator-storage-key".utf8)
            ),
            "storage_key_invalid",
            "storage key does not authenticate this database"
        )
        _ = try databaseIdentityAndGeneration()
    }

    private struct SchemaObject: Equatable {
        let type: String
        let name: String
        let table: String
        let normalizedSQL: String?
    }

    private func verifyExactSchemaObjects() throws {
        var actual: [String: SchemaObject] = [:]
        try query("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name") { statement in
            let type = try columnText(statement, 0)
            let name = try columnText(statement, 1)
            let table = try columnText(statement, 2)
            let SQL: String?
            if sqlite3_column_type(statement, 3) == SQLITE_NULL {
                SQL = nil
            } else {
                SQL = Self.normalizedSchemaSQL(try columnText(statement, 3))
            }
            actual["\(type):\(name)"] = SchemaObject(
                type: type,
                name: name,
                table: table,
                normalizedSQL: SQL
            )
        }

        var expected: [String: SchemaObject] = [:]
        for definition in Self.schemaTableDefinitions {
            let object = SchemaObject(
                type: "table",
                name: definition.name,
                table: definition.name,
                normalizedSQL: Self.normalizedSchemaSQL(definition.sql)
            )
            expected["table:\(definition.name)"] = object
        }
        for index in Self.schemaAutomaticIndexes {
            let object = SchemaObject(
                type: "index",
                name: index.name,
                table: index.table,
                normalizedSQL: nil
            )
            expected["index:\(index.name)"] = object
        }
        try require(
            actual == expected,
            "schema_version_mismatch",
            "SQLite schema objects or definitions differ from the pinned v1 schema"
        )
    }

    private static func normalizedSchemaSQL(_ SQL: String) -> String {
        SQL.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased()
    }

    private func loadUnlocked() throws -> JournalSnapshot {
        try verifySchemaV1()
        var events: [Data] = []
        var documents: [Data] = []
        var verifications: [Data] = []
        var preparedEvents: [PreparedEvent] = []
        var preparedDocuments: [PreparedDocument] = []
        var preparedVerifications: [PreparedVerification] = []
        var nextExpectedSequence: Int64? = 1
        var lastSequence: Int64 = 0
        var expectedPreviousMAC = Data(repeating: 0, count: 32)

        try query("SELECT event_sequence, event_id, json, prev_mac, mac FROM runtime_events ORDER BY event_sequence") { statement in
            let rowSequence = sqlite3_column_int64(statement, 0)
            let rowID = try columnText(statement, 1)
            let json = try columnData(statement, 2)
            let previousMAC = try columnData(statement, 3)
            let mac = try columnData(statement, 4)
            let identity = eventIdentity(sequence: rowSequence, eventID: rowID)
            try require(
                rowSequence == nextExpectedSequence && previousMAC == expectedPreviousMAC,
                "runtime_event_integrity_mismatch",
                "runtime event chain is not contiguous"
            )
            try require(
                authenticator.verify(
                    mac,
                    domain: SidecarAuthenticator.eventDomain,
                    identity: identity,
                    canonicalJSON: previousMAC + json
                ),
                "runtime_event_integrity_mismatch",
                "runtime event MAC mismatch"
            )
            let event: PreparedEvent
            do {
                event = try prepareRuntimeEvent(json)
            } catch {
                throw CoordinatorError("runtime_event_integrity_mismatch", "stored runtime event is invalid")
            }
            try require(
                event.sequence == rowSequence && event.eventID == rowID && event.json == json,
                "runtime_event_integrity_mismatch",
                "runtime event row identity or canonical form mismatch"
            )
            lastSequence = rowSequence
            nextExpectedSequence = rowSequence == Int64.max ? nil : rowSequence + 1
            expectedPreviousMAC = mac
            preparedEvents.append(event)
            events.append(event.json)
        }
        try query("SELECT packet_id, revision, json, mac FROM packet_documents ORDER BY packet_id, revision") { statement in
            let rowPacketID = try columnText(statement, 0)
            let rowRevision = sqlite3_column_int64(statement, 1)
            let json = try columnData(statement, 2)
            let mac = try columnData(statement, 3)
            let identity = packetIdentity(packetID: rowPacketID, revision: rowRevision)
            try require(
                authenticator.verify(mac, domain: SidecarAuthenticator.packetDomain, identity: identity, canonicalJSON: json),
                "packet_document_integrity_mismatch"
            )
            let document: PreparedDocument
            do {
                document = try preparePacketDocument(json)
            } catch {
                throw CoordinatorError("packet_document_integrity_mismatch", "stored packet document is invalid")
            }
            try require(
                document.packetID == rowPacketID && document.revision == rowRevision && document.json == json,
                "packet_document_integrity_mismatch",
                "packet row identity or canonical form mismatch"
            )
            preparedDocuments.append(document)
            documents.append(document.json)
        }
        try query("SELECT continuation_id, dispatch_event_id, token_fingerprint, json, mac FROM verification_records ORDER BY continuation_id") { statement in
            let rowContinuationID = try columnText(statement, 0)
            let rowDispatchID = try columnText(statement, 1)
            let rowFingerprint = try columnText(statement, 2)
            let json = try columnData(statement, 3)
            let mac = try columnData(statement, 4)
            let identity = verificationIdentity(continuationID: rowContinuationID)
            try require(
                authenticator.verify(mac, domain: SidecarAuthenticator.verificationDomain, identity: identity, canonicalJSON: json),
                "verification_record_integrity_mismatch"
            )
            let verification: PreparedVerification
            do {
                verification = try prepareVerificationRecord(json)
            } catch {
                throw CoordinatorError("verification_record_integrity_mismatch", "stored verification record is invalid")
            }
            try require(
                verification.continuationID == rowContinuationID
                    && verification.dispatchEventID == rowDispatchID
                    && verification.fingerprint == rowFingerprint
                    && verification.json == json,
                "verification_record_integrity_mismatch",
                "verification row identity or canonical form mismatch"
            )
            preparedVerifications.append(verification)
            verifications.append(verification.json)
        }

        try verifyEventChainAnchor(sequence: lastSequence, headMAC: expectedPreviousMAC)
        try verifyPersistedSidecarCompleteness(
            events: preparedEvents,
            documents: preparedDocuments,
            verifications: preparedVerifications
        )

        return JournalSnapshot(
            events: events,
            documents: documents,
            verificationRecords: verifications,
            journalSequence: lastSequence
        )
    }

    private func integrityUnlocked(includeQuickCheck: Bool) throws -> JournalIntegrityResult {
        let integrity = try textPragma("PRAGMA integrity_check")
        try require(integrity == "ok", "database_integrity_failed", "SQLite integrity_check failed")
        let quick = includeQuickCheck ? try textPragma("PRAGMA quick_check") : "ok"
        try require(quick == "ok", "database_integrity_failed", "SQLite quick_check failed")
        var foreignKeyViolation = false
        try query("PRAGMA foreign_key_check") { _ in foreignKeyViolation = true }
        try require(!foreignKeyViolation, "database_integrity_failed", "SQLite foreign key check failed")
        let snapshot = try loadUnlocked()
        return JournalIntegrityResult(
            integrityCheck: integrity,
            quickCheck: quick,
            sidecarsVerified: snapshot.documents.count + snapshot.verificationRecords.count
        )
    }

    private struct PreparedEvent {
        let eventID: String
        let sequence: Int64
        let type: String
        let object: [String: Any]
        let json: Data
    }

    private struct PreparedDocument {
        let packetID: String
        let revision: Int64
        let object: [String: Any]
        let json: Data
        let mac: Data
    }

    private struct PreparedVerification {
        let continuationID: String
        let dispatchEventID: String
        let fingerprint: String
        let object: [String: Any]
        let json: Data
        let mac: Data
    }

    private func prepareRuntimeEvent(_ data: Data) throws -> PreparedEvent {
        let raw = try StrictJSON.object(from: data, limits: validator.limits)
        try StrictJSON.rejectRawTokenKeys(raw.value)
        let parsed = try validator.validatedObject(data, as: .runtimeEvent)
        try secretCorpus.assertNoKnownSecret(inJSONObject: parsed.value)
        try secretCorpus.assertNoKnownSecret(in: parsed.canonicalData)
        guard case let .runtimeEvent(dto) = try validator.validate(parsed.canonicalData, as: .runtimeEvent) else {
            throw CoordinatorError("contract_validation_failed")
        }
        return PreparedEvent(
            eventID: dto.eventID,
            sequence: dto.eventSequence,
            type: dto.eventType,
            object: parsed.value,
            json: parsed.canonicalData
        )
    }

    private func preparePacketDocument(_ data: Data) throws -> PreparedDocument {
        let raw = try StrictJSON.object(from: data, limits: validator.limits)
        try StrictJSON.rejectRawTokenKeys(raw.value)
        let parsed = try validator.validatedObject(data, as: .decisionPacket)
        try secretCorpus.assertNoKnownSecret(inJSONObject: parsed.value)
        try secretCorpus.assertNoKnownSecret(in: parsed.canonicalData)
        guard case let .decisionPacket(dto) = try validator.validate(parsed.canonicalData, as: .decisionPacket) else {
            throw CoordinatorError("contract_validation_failed")
        }
        let identity = packetIdentity(packetID: dto.packetID, revision: dto.revision)
        return PreparedDocument(
            packetID: dto.packetID,
            revision: dto.revision,
            object: parsed.value,
            json: parsed.canonicalData,
            mac: authenticator.authenticationCode(
                domain: SidecarAuthenticator.packetDomain,
                identity: identity,
                canonicalJSON: parsed.canonicalData
            )
        )
    }

    private func prepareVerificationRecord(_ data: Data) throws -> PreparedVerification {
        let parsed = try StrictJSON.object(from: data, limits: validator.limits)
        try StrictJSON.rejectRawTokenKeys(parsed.value)
        let object = parsed.value
        try secretCorpus.assertNoKnownSecret(inJSONObject: object)
        try secretCorpus.assertNoKnownSecret(in: parsed.canonicalData)
        let binding = Set([
            "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
            "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id",
            "boundary_sequence",
        ])
        let required = Set([
            "schema_version", "kind", "dispatch_event_id", "continuation_id", "interaction_id",
            "packet_id", "revision", "option_id", "action_id", "correlation_token_fingerprint",
        ]).union(binding)
        guard Set(object.keys) == required,
              object["schema_version"] as? String == "1.0",
              object["kind"] as? String == "blabee_continuation_verification_record"
        else { throw CoordinatorError("verification_record_invalid") }
        for key in required.subtracting(["revision", "boundary_sequence", "schema_version", "kind"]) {
            guard let value = object[key] as? String,
                  value.unicodeScalars.count >= 1,
                  value.unicodeScalars.count <= 512
            else { throw CoordinatorError("verification_record_invalid") }
        }
        guard let revision = positiveInt64(object["revision"]),
              positiveInt64(object["boundary_sequence"]) != nil,
              let continuationID = object["continuation_id"] as? String,
              let dispatchID = object["dispatch_event_id"] as? String,
              let fingerprint = object["correlation_token_fingerprint"] as? String,
              fingerprint.range(
                of: "^(sha256|hmac-sha256):[0-9a-f]{64}$",
                options: .regularExpression
              ) != nil,
              revision >= 1
        else { throw CoordinatorError("verification_record_invalid") }
        let identity = verificationIdentity(continuationID: continuationID)
        return PreparedVerification(
            continuationID: continuationID,
            dispatchEventID: dispatchID,
            fingerprint: fingerprint,
            object: object,
            json: parsed.canonicalData,
            mac: authenticator.authenticationCode(
                domain: SidecarAuthenticator.verificationDomain,
                identity: identity,
                canonicalJSON: parsed.canonicalData
            )
        )
    }

    private func assertBatchUniqueness(
        events: [PreparedEvent],
        documents: [PreparedDocument],
        verifications: [PreparedVerification]
    ) throws {
        try require(Set(events.map(\.eventID)).count == events.count, "runtime_event_id_duplicate")
        try require(
            Set(documents.map { packetIdentity(packetID: $0.packetID, revision: $0.revision) }).count == documents.count,
            "packet_document_duplicate"
        )
        try require(Set(verifications.map(\.continuationID)).count == verifications.count, "verification_record_duplicate")
        try require(Set(verifications.map(\.dispatchEventID)).count == verifications.count, "verification_record_duplicate")
        try require(Set(verifications.map(\.fingerprint)).count == verifications.count, "verification_record_duplicate")
    }

    private func assertSelectionUniqueness(
        existingEvents: [PreparedEvent],
        events: [PreparedEvent]
    ) throws {
        var claimedSelections: [PreparedEvent] = []
        for selection in (existingEvents + events) where selection.type == "decision_selection_claimed" {
            try require(
                !claimedSelections.contains {
                    sameDecisionBoundarySelection($0.object, selection.object)
                },
                "selection_already_claimed"
            )
            claimedSelections.append(selection)
        }
    }

    private func assertAtomicSidecars(
        events: [PreparedEvent],
        existingDocuments: [PreparedDocument],
        documents: [PreparedDocument],
        verifications: [PreparedVerification]
    ) throws {
        let sealed = events.filter { $0.type == "decision_packet_sealed" }
        for document in documents {
            let matches = sealed.filter {
                payloadString($0.object, "packet_id") == document.packetID
                    && payloadInteger($0.object, "revision") == document.revision
            }
            try require(matches.count == 1, "packet_document_seal_atomic_batch_required")
            try require(
                packet(document, matchesSeal: matches[0]),
                "packet_document_integrity_mismatch",
                "packet document does not exactly match its seal event"
            )
        }
        for event in sealed {
            let matches = documents.filter {
                $0.packetID == payloadString(event.object, "packet_id")
                    && $0.revision == payloadInteger(event.object, "revision")
            }
            try require(matches.count == 1, "packet_document_seal_atomic_batch_required")
            try require(
                packet(matches[0], matchesSeal: event),
                "packet_document_integrity_mismatch",
                "seal event does not exactly match its packet document"
            )
        }
        let dispatches = events.filter { $0.type == "continuation_dispatched" }
        let selections = events.filter { $0.type == "decision_selection_claimed" }
        for verification in verifications {
            let dispatch = dispatches.filter { verificationMatchesDispatch(verification, dispatch: $0) }
            try require(dispatch.count == 1, "verification_dispatch_atomic_batch_required")
        }
        for dispatch in dispatches {
            let verification = verifications.filter {
                verificationMatchesDispatch($0, dispatch: dispatch)
            }
            try require(verification.count == 1, "verification_dispatch_atomic_batch_required")
            let selection = selections.filter {
                sameSelectionDispatch(selection: $0.object, dispatch: dispatch.object)
            }
            try require(selection.count == 1, "selection_dispatch_atomic_batch_required")
            try require(
                isImmediatelyAfter(dispatch.sequence, selection[0].sequence),
                "selection_dispatch_sequence_not_adjacent"
            )
        }
        let allDocuments = existingDocuments + documents
        for selection in selections {
            let packetID = payloadString(selection.object, "packet_id")
            let revision = payloadInteger(selection.object, "revision")
            let packets = allDocuments.filter { $0.packetID == packetID && $0.revision == revision }
            try require(packets.count == 1, "packet_document_missing")
            try require(
                packet(packets[0], matchesSelection: selection),
                "packet_document_integrity_mismatch",
                "selection does not exactly match its packet document"
            )
            let choices = packets[0].object["choices"] as? [[String: Any]] ?? []
            let optionID = payloadString(selection.object, "option_id")
            let choicesForSelection = choices.filter { $0["option_id"] as? String == optionID }
            try require(choicesForSelection.count == 1, "decision_option_not_found")
            let choice = choicesForSelection[0]
            try require((choice["enabled"] as? NSNumber)?.boolValue == true, "decision_option_disabled")
            if choice["action"] is [String: Any] {
                let matches = dispatches.filter { sameSelectionDispatch(selection: selection.object, dispatch: $0.object) }
                try require(matches.count == 1, "selection_dispatch_atomic_batch_required")
                try require(
                    jsonScalarEqual(choice["action_id"], payload(matches[0].object)["action_id"]),
                    "packet_document_integrity_mismatch",
                    "dispatch action does not match the selected sealed packet choice"
                )
            } else if ExactJSONInteger.int64(choice["slot"], minimum: 1) == 3 {
                let closes = events.filter {
                    $0.type == "decision_boundary_closed"
                        && sameTopBinding(selection.object, $0.object)
                        && payloadString($0.object, "close_reason") == "episode_paused"
                }
                try require(closes.count == 1, "pause_selection_close_atomic_batch_required")
                try require(
                    isImmediatelyAfter(closes[0].sequence, selection.sequence),
                    "pause_selection_close_sequence_not_adjacent"
                )
            } else {
                throw CoordinatorError("selection_atomic_outcome_required")
            }
        }
    }

    private func sameSelectionDispatch(selection: [String: Any], dispatch: [String: Any]) -> Bool {
        guard sameTopBinding(selection, dispatch) else { return false }
        for key in ["interaction_id", "packet_id", "revision", "option_id"] {
            guard jsonScalarEqual(payload(selection)[key], payload(dispatch)[key]) else { return false }
        }
        return true
    }

    private func sameDecisionBoundarySelection(
        _ left: [String: Any],
        _ right: [String: Any]
    ) -> Bool {
        sameTopBinding(left, right)
    }

    private func isImmediatelyAfter(_ later: Int64, _ earlier: Int64) -> Bool {
        let (next, overflow) = earlier.addingReportingOverflow(1)
        return !overflow && later == next
    }

    private func packet(_ document: PreparedDocument, matchesSeal seal: PreparedEvent) -> Bool {
        let sealPayload = payload(seal.object)
        return sameTopBinding(document.object, seal.object)
            && jsonScalarEqual(document.object["interaction_id"], sealPayload["interaction_id"])
            && jsonScalarEqual(document.object["packet_id"], sealPayload["packet_id"])
            && jsonScalarEqual(document.object["revision"], sealPayload["revision"])
            && jsonScalarEqual(document.object["expires_at"], sealPayload["expires_at"])
            && jsonScalarEqual(document.object["sealed_at"], seal.object["occurred_at"])
            && ExactJSONInteger.int64(document.object["valid_after_event_sequence"], minimum: 1) == seal.sequence
    }

    private func packet(_ document: PreparedDocument, matchesSelection selection: PreparedEvent) -> Bool {
        let selectionPayload = payload(selection.object)
        return sameTopBinding(document.object, selection.object)
            && jsonScalarEqual(document.object["interaction_id"], selectionPayload["interaction_id"])
            && jsonScalarEqual(document.object["packet_id"], selectionPayload["packet_id"])
            && jsonScalarEqual(document.object["revision"], selectionPayload["revision"])
    }

    private func sameTopBinding(_ left: [String: Any], _ right: [String: Any]) -> Bool {
        let top = [
            "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
            "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id",
            "boundary_sequence",
        ]
        return top.allSatisfy { jsonScalarEqual(left[$0], right[$0]) }
    }

    private func verificationMatchesDispatch(
        _ verification: PreparedVerification,
        dispatch: PreparedEvent
    ) -> Bool {
        guard verification.dispatchEventID == dispatch.eventID,
              sameTopBinding(verification.object, dispatch.object)
        else { return false }
        let dispatchPayload = payload(dispatch.object)
        let keys = ["continuation_id", "interaction_id", "packet_id", "revision", "option_id", "action_id"]
        return keys.allSatisfy { jsonScalarEqual(verification.object[$0], dispatchPayload[$0]) }
    }

    private func rejectExistingDuplicates(
        events: [PreparedEvent],
        documents: [PreparedDocument],
        verifications: [PreparedVerification]
    ) throws {
        for event in events {
            let duplicate = try exists("SELECT 1 FROM runtime_events WHERE event_id=? LIMIT 1", text: event.eventID)
            try require(
                !duplicate,
                "runtime_event_id_duplicate"
            )
        }
        for document in documents {
            let duplicate = try exists(
                "SELECT 1 FROM packet_documents WHERE packet_id=? AND revision=? LIMIT 1",
                text: document.packetID,
                integer: document.revision
            )
            try require(
                !duplicate,
                "packet_document_duplicate"
            )
        }
        for verification in verifications {
            let duplicate = try exists(
                "SELECT 1 FROM verification_records WHERE continuation_id=? OR dispatch_event_id=? OR token_fingerprint=? LIMIT 1",
                texts: [verification.continuationID, verification.dispatchEventID, verification.fingerprint]
            )
            try require(
                !duplicate,
                "verification_record_duplicate"
            )
        }
    }

    private func insert(_ event: PreparedEvent, previousMAC: Data) throws -> Data {
        let identity = eventIdentity(sequence: event.sequence, eventID: event.eventID)
        let mac = authenticator.authenticationCode(
            domain: SidecarAuthenticator.eventDomain,
            identity: identity,
            canonicalJSON: previousMAC + event.json
        )
        try withStatement("INSERT INTO runtime_events(event_sequence,event_id,json,prev_mac,mac) VALUES(?,?,?,?,?)") { statement in
            sqlite3_bind_int64(statement, 1, event.sequence)
            try bindText(event.eventID, to: statement, at: 2)
            try bindData(event.json, to: statement, at: 3)
            try bindData(previousMAC, to: statement, at: 4)
            try bindData(mac, to: statement, at: 5)
            try stepDone(statement)
        }
        return mac
    }

    private func insert(_ document: PreparedDocument) throws {
        try withStatement("INSERT INTO packet_documents(packet_id,revision,json,mac) VALUES(?,?,?,?)") { statement in
            try bindText(document.packetID, to: statement, at: 1)
            sqlite3_bind_int64(statement, 2, document.revision)
            try bindData(document.json, to: statement, at: 3)
            try bindData(document.mac, to: statement, at: 4)
            try stepDone(statement)
        }
    }

    private func insert(_ verification: PreparedVerification) throws {
        try withStatement("INSERT INTO verification_records(continuation_id,dispatch_event_id,token_fingerprint,json,mac) VALUES(?,?,?,?,?)") { statement in
            try bindText(verification.continuationID, to: statement, at: 1)
            try bindText(verification.dispatchEventID, to: statement, at: 2)
            try bindText(verification.fingerprint, to: statement, at: 3)
            try bindData(verification.json, to: statement, at: 4)
            try bindData(verification.mac, to: statement, at: 5)
            try stepDone(statement)
        }
    }

    private func currentSequence() throws -> Int64 {
        var result: Int64 = 0
        try query("SELECT COALESCE(MAX(event_sequence),0) FROM runtime_events") { statement in
            result = sqlite3_column_int64(statement, 0)
        }
        return result
    }

    private func eventChainAnchor(checkpoint: FreshnessCheckpoint) -> Data {
        authenticator.authenticationCode(
            domain: SidecarAuthenticator.eventAnchorDomain,
            identity: "database:\(checkpoint.databaseID):generation:\(checkpoint.generation):sequence:\(checkpoint.sequence)",
            canonicalJSON: checkpoint.headMAC
        )
    }

    private func updateEventChainAnchor(checkpoint: FreshnessCheckpoint) throws {
        try updateMetadata(key: "freshness_generation", value: Data(String(checkpoint.generation).utf8))
        try updateMetadata(key: "event_chain_sequence", value: Data(String(checkpoint.sequence).utf8))
        try updateMetadata(key: "event_chain_head", value: checkpoint.headMAC)
        try updateMetadata(key: "event_chain_anchor", value: eventChainAnchor(checkpoint: checkpoint))
    }

    private func verifyEventChainAnchor(sequence: Int64, headMAC: Data) throws {
        let identity = try databaseIdentityAndGeneration()
        guard let sequenceData = try metadataValue(key: "event_chain_sequence"),
              let storedSequenceText = String(data: sequenceData, encoding: .utf8),
              let storedSequence = Int64(storedSequenceText),
              String(storedSequence) == storedSequenceText,
              let storedHead = try metadataValue(key: "event_chain_head"),
              let storedAnchor = try metadataValue(key: "event_chain_anchor")
        else { throw CoordinatorError("runtime_event_integrity_mismatch", "event chain anchor is missing") }
        let checkpoint: FreshnessCheckpoint
        do {
            checkpoint = try FreshnessCheckpoint(
                databaseID: identity.databaseID,
                generation: identity.generation,
                sequence: storedSequence,
                headMAC: storedHead
            )
        } catch {
            throw CoordinatorError(
                "runtime_event_integrity_mismatch",
                "database event-chain checkpoint is invalid"
            )
        }
        try require(
            storedSequence == sequence
                && storedHead == headMAC
                && authenticator.verify(
                    storedAnchor,
                    domain: SidecarAuthenticator.eventAnchorDomain,
                    identity: "database:\(checkpoint.databaseID):generation:\(checkpoint.generation):sequence:\(checkpoint.sequence)",
                    canonicalJSON: checkpoint.headMAC
                ),
            "runtime_event_integrity_mismatch",
            "event chain anchor mismatch"
        )
    }

    private func databaseIdentityAndGeneration() throws -> (databaseID: String, generation: Int64) {
        guard let identityData = try metadataValue(key: "database_id"),
              let databaseID = String(data: identityData, encoding: .utf8),
              let uuid = UUID(uuidString: databaseID),
              uuid.uuidString == databaseID
        else {
            throw CoordinatorError(
                "freshness_database_identity_mismatch",
                "database freshness identity is missing or invalid"
            )
        }
        guard let generationData = try metadataValue(key: "freshness_generation"),
              let generationText = String(data: generationData, encoding: .utf8),
              let generation = Int64(generationText),
              generation >= 0,
              String(generation) == generationText
        else {
            throw CoordinatorError("freshness_rollback_detected", "database freshness generation is invalid")
        }
        return (databaseID, generation)
    }

    private func currentCheckpoint() throws -> FreshnessCheckpoint {
        let identity = try databaseIdentityAndGeneration()
        guard let sequenceData = try metadataValue(key: "event_chain_sequence"),
              let sequenceText = String(data: sequenceData, encoding: .utf8),
              let sequence = Int64(sequenceText),
              sequence >= 0,
              String(sequence) == sequenceText,
              let head = try metadataValue(key: "event_chain_head")
        else {
            throw CoordinatorError("freshness_rollback_detected", "database freshness checkpoint is invalid")
        }
        do {
            return try FreshnessCheckpoint(
                databaseID: identity.databaseID,
                generation: identity.generation,
                sequence: sequence,
                headMAC: head
            )
        } catch {
            throw CoordinatorError(
                "freshness_rollback_detected",
                "database freshness checkpoint is invalid"
            )
        }
    }

    private func verifyPersistedSidecarCompleteness(
        events: [PreparedEvent],
        documents: [PreparedDocument],
        verifications: [PreparedVerification]
    ) throws {
        let seals = events.filter { $0.type == "decision_packet_sealed" }
        for seal in seals {
            let matches = documents.filter {
                $0.packetID == payloadString(seal.object, "packet_id")
                    && $0.revision == payloadInteger(seal.object, "revision")
            }
            try require(matches.count == 1, "packet_document_integrity_mismatch", "sealed packet sidecar is missing")
            try require(
                packet(matches[0], matchesSeal: seal),
                "packet_document_integrity_mismatch",
                "persisted packet document does not exactly match its seal event"
            )
        }
        for document in documents {
            let matches = seals.filter {
                payloadString($0.object, "packet_id") == document.packetID
                    && payloadInteger($0.object, "revision") == document.revision
            }
            try require(matches.count == 1, "packet_document_integrity_mismatch", "packet sidecar has no seal event")
            try require(
                packet(document, matchesSeal: matches[0]),
                "packet_document_integrity_mismatch",
                "persisted packet seal does not exactly match its document"
            )
        }

        let selections = events.filter { $0.type == "decision_selection_claimed" }
        let dispatches = events.filter { $0.type == "continuation_dispatched" }
        for selection in selections {
            let matches = documents.filter {
                $0.packetID == payloadString(selection.object, "packet_id")
                    && $0.revision == payloadInteger(selection.object, "revision")
            }
            try require(matches.count == 1, "packet_document_integrity_mismatch", "selection packet sidecar is missing")
            try require(
                packet(matches[0], matchesSelection: selection),
                "packet_document_integrity_mismatch",
                "persisted selection does not exactly match its packet document"
            )
            let choices = matches[0].object["choices"] as? [[String: Any]] ?? []
            let selectedChoices = choices.filter {
                jsonScalarEqual($0["option_id"], payload(selection.object)["option_id"])
            }
            try require(
                selectedChoices.count == 1,
                "packet_document_integrity_mismatch",
                "persisted selection option is absent from its packet"
            )
            let choice = selectedChoices[0]
            try require(
                (choice["enabled"] as? NSNumber)?.boolValue == true,
                "packet_document_integrity_mismatch",
                "persisted selection references a disabled packet choice"
            )
            if choice["action"] is [String: Any] {
                let matchingDispatches = dispatches.filter {
                    sameSelectionDispatch(selection: selection.object, dispatch: $0.object)
                }
                try require(
                    matchingDispatches.count == 1
                        && isImmediatelyAfter(matchingDispatches[0].sequence, selection.sequence)
                        && jsonScalarEqual(
                            choice["action_id"],
                            payload(matchingDispatches[0].object)["action_id"]
                        ),
                    "packet_document_integrity_mismatch",
                    "persisted dispatch action does not match its selected packet choice"
                )
            } else if ExactJSONInteger.int64(choice["slot"], minimum: 1) == 3 {
                let closes = events.filter {
                    $0.type == "decision_boundary_closed"
                        && sameTopBinding(selection.object, $0.object)
                        && payloadString($0.object, "close_reason") == "episode_paused"
                }
                try require(
                    closes.count == 1 && isImmediatelyAfter(closes[0].sequence, selection.sequence),
                    "runtime_event_integrity_mismatch",
                    "persisted pause selection has no adjacent pause close event"
                )
            } else {
                throw CoordinatorError(
                    "packet_document_integrity_mismatch",
                    "persisted selection has no valid sealed outcome"
                )
            }
        }

        for dispatch in dispatches {
            let matchingSelections = selections.filter {
                sameSelectionDispatch(selection: $0.object, dispatch: dispatch.object)
            }
            try require(
                matchingSelections.count == 1
                    && isImmediatelyAfter(dispatch.sequence, matchingSelections[0].sequence),
                "runtime_event_integrity_mismatch",
                "persisted dispatch has no adjacent matching selection"
            )
            let matches = verifications.filter {
                verificationMatchesDispatch($0, dispatch: dispatch)
            }
            try require(
                matches.count == 1,
                "verification_record_integrity_mismatch",
                "dispatch verification sidecar is missing or does not exactly match"
            )
        }
        for verification in verifications {
            let matches = dispatches.filter {
                verificationMatchesDispatch(verification, dispatch: $0)
            }
            try require(
                matches.count == 1,
                "verification_record_integrity_mismatch",
                "verification sidecar has no exactly matching dispatch event"
            )
        }
    }

    private func createStatement(_ SQL: String) throws -> OpaquePointer {
        guard let database else { throw CoordinatorError("database_integrity_failed", "database is closed") }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, SQL, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw sqliteError(code: "database_integrity_failed")
        }
        return statement
    }

    private func withStatement<T>(_ SQL: String, _ body: (OpaquePointer) throws -> T) throws -> T {
        let statement = try createStatement(SQL)
        defer { sqlite3_finalize(statement) }
        return try body(statement)
    }

    private func execute(_ SQL: String) throws {
        guard let database else { throw CoordinatorError("database_integrity_failed", "database is closed") }
        var message: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(database, SQL, nil, nil, &message)
        guard result == SQLITE_OK else {
            let detail = message.map { String(cString: $0) } ?? "SQLite execution failed"
            if let message { sqlite3_free(message) }
            throw CoordinatorError("database_integrity_failed", detail)
        }
    }

    private func query(_ SQL: String, row: (OpaquePointer) throws -> Void) throws {
        try withStatement(SQL) { statement in
            while true {
                let result = sqlite3_step(statement)
                if result == SQLITE_DONE { return }
                guard result == SQLITE_ROW else { throw sqliteError(code: "database_integrity_failed") }
                try row(statement)
            }
        }
    }

    private func textPragma(_ SQL: String) throws -> String {
        var result: String?
        try query(SQL) { statement in result = try columnText(statement, 0) }
        guard let result else { throw CoordinatorError("database_integrity_failed", "SQLite pragma returned no value") }
        return result
    }

    private func integerPragma(_ SQL: String) throws -> Int64 {
        var result: Int64?
        try query(SQL) { statement in result = sqlite3_column_int64(statement, 0) }
        guard let result else { throw CoordinatorError("database_integrity_failed", "SQLite pragma returned no value") }
        return result
    }

    private func tableExists(_ name: String) throws -> Bool {
        try exists("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", text: name)
    }

    private func userTableCount() throws -> Int64 {
        var result: Int64 = 0
        try query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") { statement in
            result = sqlite3_column_int64(statement, 0)
        }
        return result
    }

    private func exists(_ SQL: String, text: String, integer: Int64? = nil) throws -> Bool {
        try withStatement(SQL) { statement in
            try bindText(text, to: statement, at: 1)
            if let integer { sqlite3_bind_int64(statement, 2, integer) }
            let result = sqlite3_step(statement)
            if result == SQLITE_ROW { return true }
            if result == SQLITE_DONE { return false }
            throw sqliteError(code: "database_integrity_failed")
        }
    }

    private func exists(_ SQL: String, texts: [String]) throws -> Bool {
        try withStatement(SQL) { statement in
            for (index, text) in texts.enumerated() { try bindText(text, to: statement, at: Int32(index + 1)) }
            let result = sqlite3_step(statement)
            if result == SQLITE_ROW { return true }
            if result == SQLITE_DONE { return false }
            throw sqliteError(code: "database_integrity_failed")
        }
    }

    private func insertMetadata(key: String, value: Data) throws {
        try withStatement("INSERT INTO coordinator_metadata(key,value) VALUES(?,?)") { statement in
            try bindText(key, to: statement, at: 1)
            try bindData(value, to: statement, at: 2)
            try stepDone(statement)
        }
    }

    private func updateMetadata(key: String, value: Data) throws {
        try withStatement("UPDATE coordinator_metadata SET value=? WHERE key=?") { statement in
            try bindData(value, to: statement, at: 1)
            try bindText(key, to: statement, at: 2)
            try stepDone(statement)
        }
        guard let database, sqlite3_changes(database) == 1 else {
            throw CoordinatorError("database_integrity_failed", "coordinator metadata row is missing")
        }
    }

    private func metadataValue(key: String) throws -> Data? {
        try withStatement("SELECT value FROM coordinator_metadata WHERE key=?") { statement in
            try bindText(key, to: statement, at: 1)
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { return nil }
            guard result == SQLITE_ROW else { throw sqliteError(code: "database_integrity_failed") }
            return try columnData(statement, 0)
        }
    }

    private func bindText(_ value: String, to statement: OpaquePointer, at index: Int32) throws {
        var bytes = Array(value.utf8)
        guard bytes.count <= Int(Int32.max) else {
            throw CoordinatorError("database_integrity_failed", "SQLite text value is too large")
        }
        bytes.append(0)
        let result = bytes.withUnsafeBufferPointer { pointer in
            sqlite3_bind_text(
                statement,
                index,
                UnsafeRawPointer(pointer.baseAddress!).assumingMemoryBound(to: CChar.self),
                Int32(pointer.count - 1),
                unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            )
        }
        guard result == SQLITE_OK else { throw sqliteError(code: "database_integrity_failed") }
    }

    private func bindData(_ value: Data, to statement: OpaquePointer, at index: Int32) throws {
        let result = value.withUnsafeBytes { pointer in
            sqlite3_bind_blob(
                statement,
                index,
                pointer.baseAddress,
                Int32(pointer.count),
                unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            )
        }
        guard result == SQLITE_OK else { throw sqliteError(code: "database_integrity_failed") }
    }

    private func stepDone(_ statement: OpaquePointer) throws {
        guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteError(code: "database_integrity_failed") }
    }

    private func columnText(_ statement: OpaquePointer, _ index: Int32) throws -> String {
        guard let pointer = sqlite3_column_text(statement, index) else {
            throw CoordinatorError("database_integrity_failed", "unexpected SQLite NULL text")
        }
        let count = Int(sqlite3_column_bytes(statement, index))
        let data = Data(bytes: pointer, count: count)
        guard let value = String(data: data, encoding: .utf8) else {
            throw CoordinatorError("database_integrity_failed", "SQLite text is not valid UTF-8")
        }
        return value
    }

    private func columnData(_ statement: OpaquePointer, _ index: Int32) throws -> Data {
        let count = Int(sqlite3_column_bytes(statement, index))
        if count == 0 { return Data() }
        guard let pointer = sqlite3_column_blob(statement, index) else {
            throw CoordinatorError("database_integrity_failed", "unexpected SQLite NULL blob")
        }
        return Data(bytes: pointer, count: count)
    }

    private func sqliteError(code: String) -> CoordinatorError {
        guard let database else { return CoordinatorError(code, "database is closed") }
        return CoordinatorError(code, String(cString: sqlite3_errmsg(database)))
    }

    private func payload(_ event: [String: Any]) -> [String: Any] {
        event["payload"] as? [String: Any] ?? [:]
    }

    private func payloadString(_ event: [String: Any], _ key: String) -> String? {
        payload(event)[key] as? String
    }

    private func payloadInteger(_ event: [String: Any], _ key: String) -> Int64? {
        positiveInt64(payload(event)[key])
    }

    private func positiveInt64(_ value: Any?) -> Int64? {
        ExactJSONInteger.int64(value, minimum: 1)
    }

    private func jsonScalarEqual(_ left: Any?, _ right: Any?) -> Bool {
        switch (left, right) {
        case let (left as String, right as String): left == right
        case let (left as NSNumber, right as NSNumber): left == right
        case (_ as NSNull, _ as NSNull): true
        default: false
        }
    }

    private func packetIdentity(packetID: String, revision: Int64) -> String {
        "\(packetID.utf8.count):\(packetID):\(revision)"
    }

    private func eventIdentity(sequence: Int64, eventID: String) -> String {
        "\(sequence):\(eventID.utf8.count):\(eventID)"
    }

    private func verificationIdentity(continuationID: String) -> String {
        "\(continuationID.utf8.count):\(continuationID)"
    }

    private enum DatabaseFileState: Equatable {
        case missing
        case regularEmpty
        case regularNonEmpty
        case invalid
    }

    private static func databaseFileState(_ path: String) throws -> DatabaseFileState {
        var info = stat()
        if lstat(path, &info) != 0 {
            if errno == ENOENT { return .missing }
            throw CoordinatorError("database_integrity_failed", "cannot inspect database path")
        }
        guard (info.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG) else { return .invalid }
        return info.st_size == 0 ? .regularEmpty : .regularNonEmpty
    }

    private static func pathEntryExists(_ path: String) -> Bool {
        var info = stat()
        return lstat(path, &info) == 0
    }
}
