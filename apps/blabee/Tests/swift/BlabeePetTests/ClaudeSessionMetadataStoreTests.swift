import ClaudeCoreAdapter
import CryptoKit
import Darwin
import Foundation
import SQLite3
import Testing
@testable import BlabeeCoordinator
@testable import CoordinatorSwift

private final class MetadataTestAnchor: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "metadata-test-" + UUID().uuidString
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    private var casCount = 0
    private var failAt: Int?
    private var writeCount = 0
    private var pendingInterception: (() throws -> Void)?

    var writes: Int { lock.withLock { writeCount } }
    func failCAS(after count: Int) { lock.withLock { failAt = casCount + count } }
    func interceptNextPending(_ action: @escaping () throws -> Void) { lock.withLock { pendingInterception = action } }
    func load() throws -> FreshnessStoredRecord? { lock.withLock { stored } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored == nil, record.storageSlot == storageSlot else { throw CoordinatorError("test_anchor_conflict") }
            let value = try FreshnessStoredRecord(record: record, revision: record.revision)
            stored = value
            writeCount += 1
            return value
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            casCount += 1
            if casCount == failAt { throw CoordinatorError("test_anchor_unavailable") }
            guard stored?.revision == expectedRevision, replacement.storageSlot == storageSlot else {
                throw CoordinatorError("test_anchor_conflict")
            }
            if replacement.state == .pending, let intercept = pendingInterception {
                pendingInterception = nil
                try intercept()
            }
            let value = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            stored = value
            writeCount += 1
            return value
        }
    }
}

private final class MetadataFixture: @unchecked Sendable {
    typealias Store = ClaudeSessionMetadataStore
    let directory: URL
    let database: URL
    let key: URL
    let coreDatabase: URL
    let coreKey: URL
    let anchor = MetadataTestAnchor()
    let coreAnchor = MetadataTestAnchor()
    let corpus = RuntimeSecretCorpus()
    let mapping: Store.Mapping
    let enrollmentID = UUID()
    var store: Store?
    var journal: SQLiteJournal?

    init(enroll: Bool = true) throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        directory = root.appendingPathComponent("build/claude/cp02-metadata/fixtures/" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        // Foundation may shorten /private/tmp to /tmp only after the directory exists.
        let canonicalCWD = directory.standardizedFileURL.path
        database = directory.appendingPathComponent("metadata/metadata.sqlite3")
        key = directory.appendingPathComponent("metadata/metadata.key")
        coreDatabase = directory.appendingPathComponent("core/coordinator.sqlite3")
        coreKey = directory.appendingPathComponent("core/coordinator.key")
        mapping = Store.Mapping(authority: .init(scopeID: UUID(), nativeSessionID: UUID(),
            sessionIncarnation: UUID(), serviceIncarnation: UUID(), ownerConnectionID: UUID(), authorityEpoch: UUID()),
            coreProjectID: "metadata-project", coreSessionID: "metadata-session-" + UUID().uuidString.lowercased(),
            canonicalCWD: canonicalCWD, channelSource: "blabee-claude", runtimeIdentity: "sha256:" + String(repeating: "a", count: 64))
        store = try Store(databaseURL: database, keyURL: key, coreKeyURL: coreKey,
            freshnessStore: anchor, secretCorpus: corpus, creating: mapping)
        if enroll { try initializeCore() }
    }

    deinit {
        store = nil
        journal = nil
        try? FileManager.default.removeItem(at: directory)
    }

    func initializeCore(crashPoint: Store.CrashPoint? = nil) throws {
        try store!.withMutation(operationID: enrollmentID, crashPoint: crashPoint,
            readCoreCheckpoint: { try self.coreCheckpoint() }) {
                journal = try SQLiteJournal(databaseURL: coreDatabase, keyURL: coreKey,
                    freshnessStore: coreAnchor, secretCorpus: corpus)
            }
    }

    func coreCheckpoint() throws -> FreshnessCheckpoint? {
        guard let journal else { return nil }
        let snapshot = try journal.load()
        guard let anchor = try coreAnchor.load(), anchor.record.state == .committed,
              anchor.record.checkpoint.sequence == snapshot.journalSequence else {
            throw CoordinatorError("test_core_unconfirmed")
        }
        return anchor.record.checkpoint
    }

    func binding(sequence: Int64 = 1) throws -> CoordinatorBinding {
        try CoordinatorBinding(projectID: mapping.coreProjectID, sessionID: mapping.coreSessionID,
            sourceTurnID: "turn-\(sequence)", sourcePromptID: "prompt-\(sequence)", episodeID: "episode-\(sequence)",
            episodeRootPromptID: "prompt-\(sequence)", episodeBaselineCheckpointID: "checkpoint-\(sequence)",
            decisionBoundaryID: "boundary-\(sequence)", boundarySequence: sequence)
    }

    func appendCore() throws {
        let journal = try #require(journal)
        let sequence = try journal.load().journalSequence + 1
        var event: [String: Any] = ["schema_version": "1.0", "kind": "blabee_runtime_event",
            "event_id": "event-" + UUID().uuidString.lowercased(), "event_sequence": sequence,
            "event_type": "decision_boundary_opened", "event_category": "decision_lifecycle",
            "occurred_at": "2026-09-19T01:00:00.123456789Z", "payload": ["proposal_id": "proposal-\(sequence)"]]
        event.merge(try binding(sequence: sequence).jsonObject) { _, new in new }
        _ = try journal.append(expectedSequence: sequence - 1, events: [StrictJSONTransport.data(forJSONObject: event)])
    }

    @discardableResult func mutate(id: UUID = UUID(), crash: Store.CrashPoint? = nil) throws -> UUID {
        try store!.withMutation(operationID: id, binding: binding(), crashPoint: crash,
            readCoreCheckpoint: { try self.coreCheckpoint() }) { try appendCore() }
        return id
    }

    func reopen(expected: UUID? = nil) throws -> Store {
        try Store(databaseURL: database, keyURL: key, coreKeyURL: coreKey,
            freshnessStore: anchor, secretCorpus: corpus, opening: expected ?? mapping.authority.scopeID)
    }

    func history(_ opened: Store? = nil) throws -> Store.History {
        let value = try coreCheckpoint()
        let checkpoint = try #require(value)
        return try (opened ?? store!).authenticatedHistory(coreCheckpoint: checkpoint)
    }

    func summary(_ opened: Store? = nil) throws -> Store.Summary {
        let value = try coreCheckpoint()
        let checkpoint = try #require(value)
        return try (opened ?? store!).authenticatedSummary(coreCheckpoint: checkpoint)
    }

    func consume(_ key: ClaudeReplayKey, operationID: UUID = UUID()) throws {
        let value = try coreCheckpoint()
        let checkpoint = try #require(value)
        try store!.consumeReplayID(key, operationID: operationID, readCoreCheckpoint: { checkpoint })
    }
}

private func metadataRejected(_ code: String? = nil, _ body: () throws -> Void) {
    do { try body(); Issue.record("Expected metadata operation rejection") }
    catch let error as CoordinatorError {
        if let code { #expect(error.code == code) }
    } catch { Issue.record("Unexpected metadata error type") }
}

private func metadataSQL(_ url: URL, _ sql: String) throws {
    var database: OpaquePointer?
    guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
        throw CoordinatorError("test_sql_open")
    }
    defer { sqlite3_close(database) }
    guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw CoordinatorError("test_sql_execute") }
}

private func metadataCount(_ url: URL, table: String) throws -> Int64 {
    var database: OpaquePointer?
    guard sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        throw CoordinatorError("test_sql_open")
    }
    defer { sqlite3_close(database) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, "SELECT COUNT(*) FROM \(table)", -1, &statement, nil) == SQLITE_OK else {
        throw CoordinatorError("test_sql_prepare")
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else { throw CoordinatorError("test_sql_read") }
    return sqlite3_column_int64(statement, 0)
}

/// Builds an authentic old-format fixture with the independent historical anchor.
/// Production code has no migration or v1 writer path.
private func metadataMakeLegacy(_ fixture: MetadataFixture, repeatOperation: Bool = false) throws {
    fixture.store = nil
    var database: OpaquePointer?
    guard sqlite3_open_v2(fixture.database.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK else {
        throw CoordinatorError("test_sql_open")
    }
    defer { sqlite3_close(database) }
    let storageKey = try ExternalStorageKeyStore.loadOrCreate(at: fixture.key, allowCreate: false)
    let authenticator = SidecarAuthenticator(storageKey: storageKey)
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    func objects(_ table: String) throws -> [[String: Any]] {
        var statement: OpaquePointer?
        let order = table == "metadata_header" ? "singleton" : "sequence"
        guard sqlite3_prepare_v2(database, "SELECT json FROM \(table) ORDER BY \(order)", -1, &statement, nil) == SQLITE_OK else {
            throw CoordinatorError("test_sql_prepare")
        }
        defer { sqlite3_finalize(statement) }
        var values: [[String: Any]] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let data = Data(bytes: sqlite3_column_blob(statement, 0)!, count: Int(sqlite3_column_bytes(statement, 0)))
            values.append(try StrictJSONTransport.object(from: data))
        }
        return values
    }
    func replace(_ table: String, key: Int64, object: [String: Any], mac: Data) throws {
        let bytes = try StrictJSONTransport.data(forJSONObject: object)
        var statement: OpaquePointer?
        let column = table == "metadata_header" ? "singleton" : "sequence"
        guard sqlite3_prepare_v2(database, "UPDATE \(table) SET json = ?, mac = ? WHERE \(column) = ?", -1, &statement, nil) == SQLITE_OK else {
            throw CoordinatorError("test_sql_prepare")
        }
        defer { sqlite3_finalize(statement) }
        guard bytes.withUnsafeBytes({ sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32($0.count), transient) }) == SQLITE_OK,
              mac.withUnsafeBytes({ sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32($0.count), transient) }) == SQLITE_OK,
              sqlite3_bind_int64(statement, 3, key) == SQLITE_OK,
              sqlite3_step(statement) == SQLITE_DONE else { throw CoordinatorError("test_sql_write") }
    }
    let headers = try objects("metadata_header")
    var header = try #require(headers.first)
    let records = try objects("metadata_operations")
    header["schema_version"] = "blabee.claude-session-metadata.v1"
    let databaseID = try #require(header["database_id"] as? String)
    var head = authenticator.authenticationCode(domain: "blabee.claude-metadata-header.v1",
        identity: fixture.mapping.authority.scopeID.uuidString,
        canonicalJSON: try StrictJSONTransport.data(forJSONObject: header))
    try replace("metadata_header", key: 1, object: header, mac: head)
    for (offset, original) in records.enumerated() {
        var record = original
        record["schema_version"] = "blabee.claude-session-metadata.v1"
        record.removeValue(forKey: "replay_key")
        record["previous_mac"] = head.base64EncodedString()
        if repeatOperation, offset >= 2 { record["operation_id"] = records[0]["operation_id"] }
        head = authenticator.authenticationCode(domain: "blabee.claude-metadata-record.v1",
            identity: databaseID, canonicalJSON: try StrictJSONTransport.data(forJSONObject: record))
        try replace("metadata_operations", key: Int64(offset + 1), object: record, mac: head)
    }
    guard sqlite3_exec(database, "DROP TABLE metadata_operation_lookup; DROP TABLE metadata_replay_lookup; PRAGMA user_version = 1", nil, nil, nil) == SQLITE_OK else {
        throw CoordinatorError("test_sql_write")
    }
    let storedAnchor = try fixture.anchor.load()
    let old = try #require(storedAnchor)
    let checkpoint = try FreshnessCheckpoint(databaseID: databaseID, generation: Int64(records.count),
        sequence: Int64(records.count), headMAC: head)
    _ = try fixture.anchor.compareAndSwap(expectedRevision: old.revision,
        replacement: .committed(storageSlot: fixture.anchor.storageSlot, checkpoint: checkpoint))
}

private final class MetadataRaceResult: @unchecked Sendable {
    private let lock = NSLock()
    private var failures: [String] = []
    var errors: [String] { lock.withLock { failures } }
    func run(_ operation: () throws -> Void) {
        do { try operation() } catch { lock.withLock { failures.append(error.coordinatorError.code) } }
    }
}

@Suite("Claude session metadata", .petLanguage(.korean))
struct ClaudeSessionMetadataStoreTests {
    @Test("Enrollment brackets actual core initialization; restart is pure authenticated history")
    func enrollmentAndReadOnlyRestart() throws {
        let fixture = try MetadataFixture()
        let before = try fixture.history()
        #expect(before.mapping == fixture.mapping)
        #expect(before.operations.count == 1)
        #expect(before.operations[0].operationID == fixture.enrollmentID)
        #expect(before.operations[0].before == nil)
        #expect(before.coreCheckpoint.sequence == 0)
        #expect(before.metadataCheckpoint.sequence == 2)
        #expect(before.metadataCheckpoint.generation == 2)
        let metadataBytes = try Data(contentsOf: fixture.database)
        let coreSnapshot = try fixture.journal!.load()
        let anchor = try fixture.anchor.load()
        let coreWrites = fixture.coreAnchor.writes
        fixture.store = nil
        let reopened = try fixture.reopen()
        #expect(try fixture.history(reopened) == before)
        #expect(try Data(contentsOf: fixture.database) == metadataBytes)
        #expect(try fixture.anchor.load() == anchor)
        #expect(fixture.coreAnchor.writes == coreWrites)
        #expect(try fixture.journal!.load() == coreSnapshot)
        var called = false
        metadataRejected("claude_metadata_history_only") {
            try reopened.withMutation(operationID: UUID(), readCoreCheckpoint: { try fixture.coreCheckpoint() }) { called = true }
        }
        #expect(!called)
    }

    @Test("Actual SQLite core commits retain complete v1 bindings and operation replay protection")
    func coreCommitAndReplay() throws {
        let fixture = try MetadataFixture()
        let operation = try fixture.mutate()
        let history = try fixture.history()
        #expect(history.coreCheckpoint.sequence == 1)
        #expect(history.operations[1].binding == (try fixture.binding()))
        #expect(history.operations[1].before?.sequence == 0)
        #expect(history.metadataCheckpoint.sequence == 4)
        var replayed = false
        metadataRejected("claude_metadata_operation_replay") {
            try fixture.store!.withMutation(operationID: operation, readCoreCheckpoint: { try fixture.coreCheckpoint() }) { replayed = true }
        }
        #expect(!replayed)
        try fixture.mutate()
        #expect(try fixture.history().coreCheckpoint.sequence == 2)
    }

    @Test("Every prepare/core/finalize crash boundary fails closed without rerunning core", arguments: ClaudeSessionMetadataStore.CrashPoint.allCases)
    func crashBoundaries(_ point: ClaudeSessionMetadataStore.CrashPoint) throws {
        let fixture = try MetadataFixture()
        metadataRejected("claude_metadata_injected_" + point.rawValue) { try fixture.mutate(crash: point) }
        let committed: Bool
        switch point {
        case .afterCoreCommit, .afterFinalizeFreshnessPending, .afterFinalizeSQLiteCommit, .afterFinalize: committed = true
        default: committed = false
        }
        #expect(try fixture.journal!.load().journalSequence == (committed ? 1 : 0))
        var retried = false
        metadataRejected("claude_metadata_quarantined") {
            try fixture.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { try fixture.coreCheckpoint() }) { retried = true }
        }
        #expect(!retried)
        fixture.store = nil
        if point == .beforePrepare || point == .afterFinalize {
            let history = try fixture.history(fixture.reopen())
            #expect(history.operations.count == (committed ? 2 : 1))
        } else {
            let code = point == .afterPrepare || point == .afterCoreCommit
                ? "claude_metadata_incomplete" : "claude_metadata_freshness_unconfirmed"
            metadataRejected(code) { _ = try fixture.reopen() }
        }
    }

    @Test("An uncertain core error leaves prepared audit and cannot authorize replay", arguments: [false, true])
    func coreFailure(_ afterCommit: Bool) throws {
        let fixture = try MetadataFixture()
        metadataRejected("test_core_failure") {
            try fixture.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { try fixture.coreCheckpoint() }) {
                if afterCommit { try fixture.appendCore() }
                throw CoordinatorError("test_core_failure")
            }
        }
        #expect(try fixture.journal!.load().journalSequence == (afterCommit ? 1 : 0))
        fixture.store = nil
        metadataRejected("claude_metadata_incomplete") { _ = try fixture.reopen() }
    }

    @Test("Freshness failures before and after both SQLite commits never produce confirmed new history", arguments: [1, 2, 3, 4])
    func anchorFailures(_ offset: Int) throws {
        let fixture = try MetadataFixture()
        fixture.anchor.failCAS(after: offset)
        metadataRejected("test_anchor_unavailable") { try fixture.mutate() }
        #expect(try fixture.journal!.load().journalSequence == (offset >= 3 ? 1 : 0))
        fixture.store = nil
        if offset == 1 {
            #expect(try fixture.history(fixture.reopen()).operations.count == 1)
        } else { metadataRejected { _ = try fixture.reopen() } }
    }

    @Test("A fake INSERT trigger at the independent-anchor seam cannot admit the core mutation")
    func fakePreparedCommitIsRejectedBeforeCore() throws {
        let fixture = try MetadataFixture()
        fixture.anchor.interceptNextPending {
            try metadataSQL(fixture.database, "CREATE TRIGGER ignore_prepare BEFORE INSERT ON metadata_operations BEGIN SELECT RAISE(IGNORE); END")
        }
        var coreCalled = false
        metadataRejected("claude_metadata_schema_invalid") {
            try fixture.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { try fixture.coreCheckpoint() }) {
                coreCalled = true
                try fixture.appendCore()
            }
        }
        #expect(!coreCalled)
        #expect(try fixture.journal!.load().journalSequence == 0)
        fixture.store = nil
        metadataRejected { _ = try fixture.reopen() }
    }

    @Test("Unfinished enrollment never appears as restorable authority or complete history", arguments: [ClaudeSessionMetadataStore.CrashPoint.beforePrepare, .afterPrepare, .afterCoreCommit])
    func incompleteEnrollment(_ point: ClaudeSessionMetadataStore.CrashPoint) throws {
        let fixture = try MetadataFixture(enroll: false)
        metadataRejected { try fixture.initializeCore(crashPoint: point) }
        fixture.store = nil
        metadataRejected("claude_metadata_incomplete") { _ = try fixture.reopen() }
    }

    @Test("Schema, HMAC, mapping and sequence tampering are rejected", arguments: [
        "UPDATE metadata_header SET mac = zeroblob(32)",
        "UPDATE metadata_header SET json = CAST(replace(CAST(json AS TEXT), 'blabee-claude', 'blabee-other') AS BLOB)",
        "UPDATE metadata_operations SET mac = zeroblob(32) WHERE sequence = 1",
        "UPDATE metadata_operations SET sequence = 20 WHERE sequence = 2",
        "DELETE FROM metadata_operations WHERE sequence = 2",
        "CREATE TABLE extra (value TEXT)",
        "PRAGMA user_version = 3",
    ])
    func tampering(_ sql: String) throws {
        let fixture = try MetadataFixture()
        fixture.store = nil
        try metadataSQL(fixture.database, sql)
        metadataRejected { _ = try fixture.reopen() }
    }

    @Test("Restoring an authentic older metadata file fails against the independent freshness anchor")
    func authenticRollback() throws {
        let fixture = try MetadataFixture()
        let old = try Data(contentsOf: fixture.database)
        try fixture.mutate()
        let currentAnchor = try fixture.anchor.load()
        fixture.store = nil
        try old.write(to: fixture.database)
        #expect(try fixture.anchor.load() == currentAnchor)
        metadataRejected("claude_metadata_rollback_or_fork") { _ = try fixture.reopen() }
    }

    @Test("Foreign scope and different core identity, sequence, generation or head are rejected", arguments: ["scope", "database", "sequence", "generation", "head"])
    func wrongBindings(_ field: String) throws {
        let fixture = try MetadataFixture()
        if field == "scope" {
            metadataRejected { _ = try fixture.reopen(expected: UUID()) }
        } else {
            let value = try fixture.coreCheckpoint()
            let core = try #require(value)
            let mismatch = try FreshnessCheckpoint(databaseID: field == "database" ? UUID().uuidString : core.databaseID,
                generation: core.generation + (field == "generation" ? 1 : 0),
                sequence: core.sequence + (field == "sequence" ? 1 : 0),
                headMAC: field == "head" ? Data(repeating: 0x7f, count: 32) : core.headMAC)
            metadataRejected("claude_metadata_core_mismatch") { _ = try fixture.store!.authenticatedHistory(coreCheckpoint: mismatch) }
        }
    }

    @Test("External core writes and core identity switches during mutation quarantine only that scope")
    func coreDivergenceAndIsolation() throws {
        let first = try MetadataFixture()
        let second = try MetadataFixture()
        try first.appendCore()
        var called = false
        metadataRejected("claude_metadata_core_mismatch") {
            try first.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { try first.coreCheckpoint() }) { called = true }
        }
        #expect(!called)
        try second.mutate()
        #expect(try second.history().coreCheckpoint.sequence == 1)
        var checkpoint = try second.coreCheckpoint()
        metadataRejected("claude_metadata_core_mismatch") {
            try second.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { checkpoint }) {
                checkpoint = try FreshnessCheckpoint(databaseID: UUID().uuidString, generation: 0, sequence: 0, headMAC: Data(repeating: 0, count: 32))
            }
        }
        second.store = nil
        metadataRejected("claude_metadata_incomplete") { _ = try second.reopen() }
    }

    @Test("Snapshot or timer mutations still cross both metadata commits, including core no-op")
    func noOpAndNilCompletion() throws {
        let fixture = try MetadataFixture()
        let value = try fixture.coreCheckpoint()
        let before = try #require(value)
        try fixture.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { try fixture.coreCheckpoint() }) {}
        #expect(try fixture.history().coreCheckpoint == before)
        #expect(try fixture.history().metadataCheckpoint.sequence == 4)
        var checkpoint: FreshnessCheckpoint? = before
        metadataRejected("claude_metadata_core_missing") {
            try fixture.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { checkpoint }) { checkpoint = nil }
        }
    }

    @Test("Mutation validates full binding and known secret values before writing any prepared row")
    func bindingAndSecretExclusion() throws {
        let fixture = try MetadataFixture()
        let before = try fixture.history()
        let foreign = try CoordinatorBinding(projectID: "other", sessionID: fixture.mapping.coreSessionID,
            sourceTurnID: "turn", sourcePromptID: "prompt", episodeID: "episode", episodeRootPromptID: "root",
            episodeBaselineCheckpointID: "baseline", decisionBoundaryID: "boundary", boundarySequence: 1)
        metadataRejected("claude_metadata_binding_mismatch") {
            try fixture.store!.withMutation(operationID: UUID(), binding: foreign,
                readCoreCheckpoint: { try fixture.coreCheckpoint() }) { Issue.record("Must not call core") }
        }
        let secret = "fixture-secret-with-quote-\"-and-slash-/"
        fixture.corpus.register(secret)
        let secretBinding = try CoordinatorBinding(projectID: fixture.mapping.coreProjectID,
            sessionID: fixture.mapping.coreSessionID, sourceTurnID: "turn", sourcePromptID: secret,
            episodeID: "episode", episodeRootPromptID: "root", episodeBaselineCheckpointID: "baseline",
            decisionBoundaryID: "boundary", boundarySequence: 1)
        metadataRejected("claude_metadata_secret_reflection") {
            try fixture.store!.withMutation(operationID: UUID(), binding: secretBinding,
                readCoreCheckpoint: { try fixture.coreCheckpoint() }) { Issue.record("Must not call core") }
        }
        #expect(try fixture.history() == before)
        #expect(!fixture.corpus.containsKnownSecret(in: try Data(contentsOf: fixture.database)))
    }

    @Test("Key tampering, file replacement, unsafe links and shared key lock parents fail closed", arguments: ["key", "database-link", "key-link", "core-parent", "core-parent-alias", "replace-during-core"])
    func unsafeStorage(_ kind: String) throws {
        let fixture = try MetadataFixture()
        if kind == "core-parent" || kind == "core-parent-alias" {
            var parent = fixture.key.deletingLastPathComponent()
            if kind == "core-parent-alias" {
                let alias = fixture.directory.appendingPathComponent("metadata-parent-alias")
                try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: parent)
                parent = alias
            }
            metadataRejected("claude_metadata_paths_invalid") {
                _ = try ClaudeSessionMetadataStore(databaseURL: fixture.database, keyURL: fixture.key,
                    coreKeyURL: parent.appendingPathComponent("core.key"),
                    freshnessStore: fixture.anchor, secretCorpus: fixture.corpus, opening: fixture.mapping.authority.scopeID)
            }
        } else if kind == "key" {
            try Data(repeating: 0x78, count: 32).write(to: fixture.key)
            metadataRejected("claude_metadata_key_changed") { _ = try fixture.history() }
        } else if kind == "replace-during-core" {
            metadataRejected("claude_metadata_file_unsafe") {
                try fixture.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { try fixture.coreCheckpoint() }) {
                    let copy = fixture.directory.appendingPathComponent("replacement.sqlite3")
                    try FileManager.default.copyItem(at: fixture.database, to: copy)
                    try FileManager.default.removeItem(at: fixture.database)
                    try FileManager.default.moveItem(at: copy, to: fixture.database)
                }
            }
        } else {
            let target = kind == "database-link" ? fixture.database : fixture.key
            let alias = fixture.directory.appendingPathComponent("hard-link")
            try FileManager.default.linkItem(at: target, to: alias)
            metadataRejected { _ = try fixture.history() }
        }
    }

    @Test("Same-scope mutation serialization permits independent scopes to progress")
    func concurrentScopes() throws {
        let first = try MetadataFixture()
        let second = try MetadataFixture()
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let finished = DispatchGroup()
        let result = MetadataRaceResult()
        defer { release.signal(); _ = finished.wait(timeout: .now() + 5) }
        finished.enter()
        DispatchQueue.global().async {
            defer { finished.leave() }
            result.run {
                try first.store!.withMutation(operationID: UUID(), readCoreCheckpoint: { try first.coreCheckpoint() }) {
                    entered.signal()
                    guard release.wait(timeout: .now() + 5) == .success else { throw CoordinatorError("test_gate_timeout") }
                    try first.appendCore()
                }
            }
        }
        try #require(entered.wait(timeout: .now() + 5) == .success)
        // Different metadata and core key parents must not share the first lock.
        try second.mutate()
        #expect(try second.history().coreCheckpoint.sequence == 1)
        finished.enter()
        DispatchQueue.global().async {
            defer { finished.leave() }
            result.run { try first.mutate() }
        }
        release.signal()
        try #require(finished.wait(timeout: .now() + 5) == .success)
        #expect(result.errors.isEmpty)
        #expect(try first.history().coreCheckpoint.sequence == 2)
        #expect(try first.history().operations.count == 3)
    }

    @Test("Replay keys are durable by kind, and a normal replay rejection does not quarantine")
    func replayKindsAndHistory() throws {
        let fixture = try MetadataFixture()
        let id = UUID().uuidString.lowercased()
        let checkpoint = try fixture.coreCheckpoint()
        let core = try #require(checkpoint)
        for kind in ClaudeReplayKind.allCases {
            let key = try ClaudeReplayKey(kind: kind, id: id)
            let operationID = UUID()
            try fixture.consume(key, operationID: operationID)
            let before = try fixture.summary()
            metadataRejected("claude_metadata_replay") { try fixture.consume(key, operationID: operationID) }
            metadataRejected("claude_metadata_replay") { try fixture.consume(key) }
            #expect(try fixture.summary() == before)
        }
        let proposal = try ClaudeReplayKey(kind: .proposal, id: "\t기존 proposal A \n")
        try fixture.consume(proposal)
        let history = try fixture.history()
        #expect(history.coreCheckpoint == core)
        #expect(history.operations.count == 6)
        #expect(history.operations.last?.replayKey == proposal)
        #expect(try fixture.summary().operationCount == 6)
        let bytes = try Data(contentsOf: fixture.database)
        let anchor = try fixture.anchor.load()
        fixture.store = nil
        let reopened = try fixture.reopen()
        #expect(try fixture.history(reopened) == history)
        #expect(try fixture.summary(reopened).operationCount == 6)
        metadataRejected("claude_metadata_history_only") {
            try reopened.consumeReplayID(proposal, operationID: UUID(), readCoreCheckpoint: { core })
        }
        #expect(try Data(contentsOf: fixture.database) == bytes)
        #expect(try fixture.anchor.load() == anchor)
    }

    @Test("Old replay IDs remain rejected after 1000 durable consumptions; summary retains counts only")
    func thousandReplayIDs() throws {
        let fixture = try MetadataFixture()
        let checkpoint = try fixture.coreCheckpoint()
        let core = try #require(checkpoint)
        func key(_ index: Int) throws -> ClaudeReplayKey {
            try ClaudeReplayKey(kind: .proposal, id: "historical-proposal-\(index)")
        }
        for index in 0..<1000 {
            try fixture.store!.consumeReplayID(key(index), operationID: UUID(), readCoreCheckpoint: { core })
        }
        let summary = try fixture.summary()
        #expect(summary.operationCount == 1001)
        #expect(summary.metadataCheckpoint.sequence == 2002)
        #expect(summary.coreCheckpoint == core)
        for index in [0, 127, 255, 499, 999] {
            metadataRejected("claude_metadata_replay") { try fixture.consume(key(index)) }
        }
        #expect(try fixture.summary() == summary)
        fixture.store = nil
        #expect(try fixture.summary(fixture.reopen()) == summary)
    }

    @Test("Derived lookup deletion, addition and first-sequence changes are rejected against authenticated audit", arguments: [
        "DELETE FROM metadata_operation_lookup",
        "UPDATE metadata_operation_lookup SET first_sequence = 99",
        "INSERT INTO metadata_operation_lookup VALUES ('00000000-0000-4000-8000-000000000001', 1)",
        "DELETE FROM metadata_replay_lookup",
        "UPDATE metadata_replay_lookup SET first_sequence = 1",
        "UPDATE metadata_replay_lookup SET kind = 'selection'",
        "UPDATE metadata_replay_lookup SET replay_id = '00000000-0000-4000-8000-000000000001'",
        "INSERT INTO metadata_replay_lookup VALUES ('proposal', 'extra-proposal', 3)",
    ])
    func replayLookupTampering(_ sql: String) throws {
        let fixture = try MetadataFixture()
        let key = try ClaudeReplayKey(kind: .prompt, id: UUID().uuidString.lowercased())
        try fixture.consume(key)
        try metadataSQL(fixture.database, sql)
        metadataRejected("claude_metadata_lookup_invalid") { _ = try fixture.summary() }
        metadataRejected("claude_metadata_quarantined") { try fixture.consume(key) }
        fixture.store = nil
        metadataRejected("claude_metadata_lookup_invalid") { _ = try fixture.reopen() }
    }

    @Test("Replay lookup writes share the audit SQLite commit at every crash boundary", arguments: ClaudeSessionMetadataStore.CrashPoint.allCases)
    func replayCrashBoundaries(_ point: ClaudeSessionMetadataStore.CrashPoint) throws {
        let fixture = try MetadataFixture()
        let key = try ClaudeReplayKey(kind: .hookRequest, id: UUID().uuidString.lowercased())
        let checkpoint = try fixture.coreCheckpoint()
        let before = try #require(checkpoint)
        metadataRejected("claude_metadata_injected_" + point.rawValue) {
            try fixture.store!.withMutation(operationID: UUID(), replayKey: key, crashPoint: point,
                readCoreCheckpoint: { before }) {}
        }
        let preparedCommitted = ![ClaudeSessionMetadataStore.CrashPoint.beforePrepare, .afterPrepareFreshnessPending].contains(point)
        #expect(try metadataCount(fixture.database, table: "metadata_replay_lookup") == (preparedCommitted ? 1 : 0))
        #expect(try metadataCount(fixture.database, table: "metadata_operation_lookup") == (preparedCommitted ? 2 : 1))
        #expect(try fixture.coreCheckpoint() == before)
        fixture.store = nil
        if point == .beforePrepare || point == .afterFinalize {
            #expect(try fixture.summary(fixture.reopen()).operationCount == (point == .afterFinalize ? 2 : 1))
        } else { metadataRejected { _ = try fixture.reopen() } }
    }

    @Test("Rollback, deletion and cross-scope access cannot make a replay tombstone usable again")
    func replayRollbackDeletionAndScope() throws {
        let first = try MetadataFixture()
        let second = try MetadataFixture()
        let key = try ClaudeReplayKey(kind: .selection, id: UUID().uuidString.lowercased())
        let old = try Data(contentsOf: first.database)
        try first.consume(key)
        try second.consume(key)
        #expect(try second.summary().operationCount == 2)
        metadataRejected("claude_metadata_header_invalid") { _ = try first.reopen(expected: second.mapping.authority.scopeID) }
        first.store = nil
        try old.write(to: first.database)
        metadataRejected("claude_metadata_rollback_or_fork") { _ = try first.reopen() }
        try FileManager.default.removeItem(at: first.database)
        metadataRejected("claude_metadata_missing") { _ = try first.reopen() }
        metadataRejected("claude_metadata_replay") { try second.consume(key) }
    }

    @Test("Same replay key admitted concurrently is consumed exactly once without poisoning the store")
    func concurrentReplayConsumption() throws {
        let fixture = try MetadataFixture()
        let key = try ClaudeReplayKey(kind: .proposal, id: "concurrent-proposal")
        let checkpoint = try fixture.coreCheckpoint()
        let core = try #require(checkpoint)
        let store = try #require(fixture.store)
        let result = MetadataRaceResult()
        let finished = DispatchGroup()
        for _ in 0..<8 {
            finished.enter()
            DispatchQueue.global().async {
                defer { finished.leave() }
                result.run { try store.consumeReplayID(key, operationID: UUID(), readCoreCheckpoint: { core }) }
            }
        }
        try #require(finished.wait(timeout: .now() + 10) == .success)
        #expect(result.errors.count == 7)
        #expect(result.errors.allSatisfy { $0 == "claude_metadata_replay" })
        #expect(try fixture.summary().operationCount == 2)
        try fixture.consume(ClaudeReplayKey(kind: .proposal, id: "next-proposal"))
        #expect(try fixture.summary().operationCount == 3)
    }

    @Test("Replay identifiers cannot persist known secrets")
    func replaySecretExclusion() throws {
        let fixture = try MetadataFixture()
        let secret = "fixture-only-private-credential-value"
        fixture.corpus.register(secret)
        let before = try fixture.summary()
        metadataRejected("claude_metadata_secret_reflection") {
            try fixture.consume(ClaudeReplayKey(kind: .proposal, id: secret))
        }
        #expect(try fixture.summary() == before)
        #expect(!fixture.corpus.containsKnownSecret(in: try Data(contentsOf: fixture.database)))
    }

    @Test("Authenticated v1 metadata remains history-only without silently adding lookup tables")
    func legacyHistoryCompatibility() throws {
        let fixture = try MetadataFixture()
        try fixture.mutate()
        let before = try fixture.history()
        try metadataMakeLegacy(fixture)
        let bytes = try Data(contentsOf: fixture.database)
        let anchor = try fixture.anchor.load()
        let reopened = try fixture.reopen()
        let history = try fixture.history(reopened)
        #expect(history.mapping == before.mapping)
        #expect(history.operations == before.operations)
        #expect(history.coreCheckpoint == before.coreCheckpoint)
        #expect(try fixture.summary(reopened).operationCount == 2)
        metadataRejected("claude_metadata_history_only") {
            try reopened.consumeReplayID(ClaudeReplayKey(kind: .proposal, id: "new"), operationID: UUID(),
                readCoreCheckpoint: { history.coreCheckpoint })
        }
        #expect(try Data(contentsOf: fixture.database) == bytes)
        #expect(try fixture.anchor.load() == anchor)
    }

    @Test("Legacy streaming verification still rejects repeated authenticated operation IDs")
    func legacyOperationReplay() throws {
        let fixture = try MetadataFixture()
        try fixture.mutate()
        try metadataMakeLegacy(fixture, repeatOperation: true)
        metadataRejected("claude_metadata_operation_order_invalid") { _ = try fixture.reopen() }
    }
}
