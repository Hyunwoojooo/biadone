import Foundation
import SQLite3
import Testing
@testable import CoordinatorSwift

private final class AdmissionProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var now = 299
    private var admissionCalls = 0
    private var gateCalls = 0
    private var validationScans = 0
    private var expireAfterValidation = false
    private var providerRevoked = false

    func requireBeforeDeadline() throws {
        lock.lock()
        defer { lock.unlock() }
        admissionCalls += 1
        guard now < 300 else { throw CoordinatorError("test_admission_expired") }
    }

    func expire() {
        lock.lock()
        now = 300
        lock.unlock()
    }

    func expireAfterNextValidation() {
        lock.lock()
        expireAfterValidation = true
        lock.unlock()
    }

    func observe(_ work: SQLiteJournalWork) {
        guard case .fullValidationFinished = work else { return }
        lock.lock()
        validationScans += 1
        if expireAfterValidation {
            now = 300
            expireAfterValidation = false
        }
        lock.unlock()
    }

    func revokeProvider() {
        lock.lock()
        providerRevoked = true
        lock.unlock()
    }

    func commitGate(_ commit: () throws -> Void) throws {
        lock.lock()
        gateCalls += 1
        let revoked = providerRevoked
        lock.unlock()
        guard !revoked else { throw CoordinatorError("test_provider_revoked") }
        try commit()
    }

    var counts: (admissions: Int, gates: Int, scans: Int) {
        lock.lock()
        defer { lock.unlock() }
        return (admissionCalls, gateCalls, validationScans)
    }
}

/// An in-memory test authority. No Keychain or installed service is consulted.
private final class AdmissionFreshnessStore: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "sqlite-admission-test-\(UUID().uuidString)"
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    private var pendingWrites = 0
    private var pendingInterruption: (@Sendable () -> Void)?

    func load() throws -> FreshnessStoredRecord? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard stored == nil else { throw CoordinatorError("freshness_anchor_conflict") }
        guard record.storageSlot == storageSlot else {
            throw CoordinatorError("freshness_anchor_corrupt")
        }
        let created = try FreshnessStoredRecord(record: record, revision: record.revision)
        stored = created
        return created
    }

    func compareAndSwap(
        expectedRevision: Data,
        replacement: FreshnessRecord
    ) throws -> FreshnessStoredRecord {
        var interrupt: (@Sendable () -> Void)?
        lock.lock()
        defer {
            lock.unlock()
            interrupt?()
        }
        guard stored?.revision == expectedRevision else {
            throw CoordinatorError("freshness_anchor_conflict")
        }
        guard replacement.storageSlot == storageSlot else {
            throw CoordinatorError("freshness_anchor_corrupt")
        }
        let updated = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
        stored = updated
        if replacement.state == .pending {
            pendingWrites += 1
            if let callback = pendingInterruption {
                pendingInterruption = nil
                interrupt = callback
                throw CoordinatorError("test_pending_write_interruption")
            }
        }
        return updated
    }

    func interruptAfterNextPendingWrite(_ callback: @escaping @Sendable () -> Void) {
        lock.lock()
        pendingInterruption = callback
        lock.unlock()
    }

    var pendingWriteCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return pendingWrites
    }
}

private func admissionTemporaryDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-sqlite-admission-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]
    )
    return directory
}

private func admissionEvent(sequence: Int) throws -> Data {
    try JSONSerialization.data(withJSONObject: [
        "schema_version": "1.0",
        "kind": "blabee_runtime_event",
        "event_id": "event_sqlite_admission_\(sequence)",
        "event_sequence": sequence,
        "event_type": "decision_boundary_opened",
        "event_category": "decision_lifecycle",
        "occurred_at": "2026-08-21T01:00:00.123456789Z",
        "project_id": "project_sqlite_admission",
        "session_id": "session_sqlite_admission",
        "source_turn_id": "turn_sqlite_admission_\(sequence)",
        "source_prompt_id": "prompt_sqlite_admission_\(sequence)",
        "episode_id": "episode_sqlite_admission_\(sequence)",
        "episode_root_prompt_id": "prompt_sqlite_admission_\(sequence)",
        "episode_baseline_checkpoint_id": "checkpoint_sqlite_admission_\(sequence)",
        "decision_boundary_id": "boundary_sqlite_admission_\(sequence)",
        "boundary_sequence": sequence,
        "payload": ["proposal_id": "proposal_sqlite_admission_\(sequence)"],
    ], options: [.sortedKeys, .withoutEscapingSlashes])
}

private func admissionExpectCode(_ code: String, _ operation: () throws -> Void) {
    do {
        try operation()
        Issue.record("expected error \(code)")
    } catch let error as CoordinatorError {
        #expect(error.code == code)
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

private func admissionStoredEventCount(_ url: URL) throws -> Int64 {
    var database: OpaquePointer?
    let status = sqlite3_open_v2(url.path, &database, SQLITE_OPEN_READONLY, nil)
    defer { if let database { sqlite3_close_v2(database) } }
    guard status == SQLITE_OK, let database else {
        throw CoordinatorError("test_sqlite_open_failed")
    }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, "SELECT count(*) FROM runtime_events", -1, &statement, nil) == SQLITE_OK,
          let statement else { throw CoordinatorError("test_sqlite_prepare_failed") }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW else {
        throw CoordinatorError("test_sqlite_query_failed")
    }
    return sqlite3_column_int64(statement, 0)
}

@Test("SQLite admission rechecks time after validation without poisoning freshness on expiry")
func sqliteAdmissionExpiresAfterStorageValidation() throws {
    let directory = try admissionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = AdmissionFreshnessStore()
    let probe = AdmissionProbe()
    let journal = try SQLiteJournal(
        databaseURL: directory.appendingPathComponent("journal.sqlite3"),
        keyURL: directory.appendingPathComponent("journal.key"),
        freshnessStore: store,
        workObserver: probe.observe
    )
    let opening = try admissionEvent(sequence: 1)
    _ = try journal.append(expectedSequence: 0, events: [opening])
    let before = try journal.load()
    let freshnessBefore = try #require(try store.load())
    let pendingWritesBefore = store.pendingWriteCount
    let scansBefore = probe.counts.scans
    let next = try admissionEvent(sequence: 2)

    // Deterministically model a slow MAC/sidecar scan; no wall-clock sleep or
    // performance threshold is involved in this functional deadline test.
    probe.expireAfterNextValidation()
    let port: any CoordinatorSemanticJournalPort = journal
    admissionExpectCode("test_admission_expired") {
        _ = try port.append(expectedSequence: 1, events: [next], documents: [],
            verificationRecords: [], validateAdmission: probe.requireBeforeDeadline)
    }
    #expect(probe.counts.admissions == 1)
    #expect(probe.counts.scans == scansBefore + 1)
    #expect(store.pendingWriteCount == pendingWritesBefore)
    #expect(try store.load() == freshnessBefore)
    #expect(try journal.load() == before)
    #expect(try admissionStoredEventCount(journal.databaseURL) == 1)

    _ = try journal.append(expectedSequence: 1, events: [next])
    #expect(try journal.load().events == [opening, next])
    #expect(try store.load()?.record.state == .committed)
    #expect(store.pendingWriteCount == pendingWritesBefore + 1)
}

@Test("SQLite admission survives only its own immutable pending-source recovery")
func sqliteAdmissionSurvivesOnlySameCallExactPendingRetry() throws {
    let directory = try admissionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = AdmissionFreshnessStore()
    let probe = AdmissionProbe()
    let journal = try SQLiteJournal(
        databaseURL: directory.appendingPathComponent("journal.sqlite3"),
        keyURL: directory.appendingPathComponent("journal.key"),
        freshnessStore: store, appendCommitGate: probe.commitGate
    )
    let opening = try admissionEvent(sequence: 1)
    store.interruptAfterNextPendingWrite { probe.expire() }
    let port: any CoordinatorSemanticJournalPort = journal
    let result = try port.append(expectedSequence: 0, events: [opening], documents: [],
        verificationRecords: [], validateAdmission: probe.requireBeforeDeadline)

    #expect(result == JournalAppendResult(firstSequence: 1, lastSequence: 1, eventCount: 1))
    #expect(probe.counts.admissions == 1)
    #expect(probe.counts.gates == 1)
    #expect(store.pendingWriteCount == 1)
    #expect(try journal.load().events == [opening])
    #expect(try admissionStoredEventCount(journal.databaseURL) == 1)
    let freshnessAfter = try #require(try store.load())
    #expect(freshnessAfter.record.state == .committed)

    let next = try admissionEvent(sequence: 2)
    admissionExpectCode("test_admission_expired") {
        _ = try port.append(expectedSequence: 1, events: [next], documents: [],
            verificationRecords: [], validateAdmission: probe.requireBeforeDeadline)
    }
    #expect(probe.counts.admissions == 2)
    #expect(probe.counts.gates == 1)
    #expect(store.pendingWriteCount == 1)
    #expect(try store.load() == freshnessAfter)
    #expect(try journal.load().events == [opening])
}

@Test("SQLite deadline admission never bypasses provider revocation or transfers to another call")
func sqliteAdmissionNeverBypassesProviderGate() throws {
    let directory = try admissionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = AdmissionFreshnessStore()
    let probe = AdmissionProbe()
    let journal = try SQLiteJournal(
        databaseURL: directory.appendingPathComponent("journal.sqlite3"),
        keyURL: directory.appendingPathComponent("journal.key"),
        freshnessStore: store, appendCommitGate: probe.commitGate
    )
    let opening = try admissionEvent(sequence: 1)
    store.interruptAfterNextPendingWrite {
        probe.expire()
        probe.revokeProvider()
    }
    let port: any CoordinatorSemanticJournalPort = journal
    admissionExpectCode("freshness_commit_ambiguous") {
        _ = try port.append(expectedSequence: 0, events: [opening], documents: [],
            verificationRecords: [], validateAdmission: probe.requireBeforeDeadline)
    }
    #expect(probe.counts.admissions == 1)
    #expect(probe.counts.gates == 1)
    #expect(store.pendingWriteCount == 1)
    #expect(try admissionStoredEventCount(journal.databaseURL) == 0)
    let pending = try #require(try store.load())
    #expect(pending.record.state == .pending)
    admissionExpectCode("freshness_transition_pending") { _ = try journal.load() }

    // Even the exact bytes of the earlier admitted transition cannot reuse its
    // deadline admission after control has returned to the caller.
    admissionExpectCode("test_admission_expired") {
        _ = try port.append(expectedSequence: 0, events: [opening], documents: [],
            verificationRecords: [], validateAdmission: probe.requireBeforeDeadline)
    }
    #expect(probe.counts.admissions == 2)
    #expect(probe.counts.gates == 1)
    #expect(store.pendingWriteCount == 1)
    #expect(try store.load() == pending)
    #expect(try admissionStoredEventCount(journal.databaseURL) == 0)
}
