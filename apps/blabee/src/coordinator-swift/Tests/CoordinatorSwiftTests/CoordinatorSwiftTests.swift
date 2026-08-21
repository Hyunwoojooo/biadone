import CryptoKit
import Foundation
import Security
import SQLite3
import Testing
@testable import CoordinatorSwift

private let appRoot: URL = {
    let packageRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    return packageRoot.deletingLastPathComponent().deletingLastPathComponent()
}()

private func JSONData(_ object: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
}

private func temporaryDirectory() throws -> URL {
    let URL = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-swift-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: URL,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: URL.path)
    return URL
}

private func expectCode(_ expected: String, _ operation: () throws -> Void) {
    do {
        try operation()
        Issue.record("expected error \(expected)")
    } catch let error as CoordinatorError {
        #expect(error.code == expected)
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

private final class TestFreshnessAnchorStore: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot: String

    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    private var nextLoadFailureCode: String?
    private var throwAfterPendingWriteCode: String?
    private var nextCommittedCASFailureCode: String?

    init(storageSlot: String = "test-\(UUID().uuidString)") {
        self.storageSlot = storageSlot
    }

    func load() throws -> FreshnessStoredRecord? {
        lock.lock()
        defer { lock.unlock() }
        if let code = nextLoadFailureCode {
            nextLoadFailureCode = nil
            throw CoordinatorError(code)
        }
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
        lock.lock()
        defer { lock.unlock() }
        guard let current = stored, current.revision == expectedRevision else {
            throw CoordinatorError("freshness_anchor_conflict")
        }
        guard replacement.storageSlot == storageSlot else {
            throw CoordinatorError("freshness_anchor_corrupt")
        }
        if replacement.state == .committed, let code = nextCommittedCASFailureCode {
            nextCommittedCASFailureCode = nil
            throw CoordinatorError(code)
        }
        let updated = try FreshnessStoredRecord(
            record: replacement,
            revision: replacement.revision
        )
        stored = updated
        if replacement.state == .pending, let code = throwAfterPendingWriteCode {
            throwAfterPendingWriteCode = nil
            throw CoordinatorError(code)
        }
        return updated
    }

    func failNextLoad(with code: String) {
        lock.lock()
        nextLoadFailureCode = code
        lock.unlock()
    }

    func failAfterNextPendingWrite(with code: String) {
        lock.lock()
        throwAfterPendingWriteCode = code
        lock.unlock()
    }

    func failNextCommittedCAS(with code: String) {
        lock.lock()
        nextCommittedCASFailureCode = code
        lock.unlock()
    }

    func removeRecord() {
        lock.lock()
        stored = nil
        lock.unlock()
    }

    func replaceRecord(_ record: FreshnessRecord) throws {
        lock.lock()
        defer { lock.unlock() }
        stored = try FreshnessStoredRecord(record: record, revision: record.revision)
    }
}

private final class TestFreshnessStoreRegistry: @unchecked Sendable {
    static let shared = TestFreshnessStoreRegistry()

    private let lock = NSLock()
    private var stores: [String: TestFreshnessAnchorStore] = [:]

    func store(for databaseURL: URL) -> TestFreshnessAnchorStore {
        let key = databaseURL.standardizedFileURL.path
        lock.lock()
        defer { lock.unlock() }
        if let existing = stores[key] { return existing }
        let created = TestFreshnessAnchorStore()
        stores[key] = created
        return created
    }
}

private func testJournal(
    databaseURL: URL,
    keyURL: URL,
    secretCorpus: RuntimeSecretCorpus = RuntimeSecretCorpus(),
    freshnessStore: TestFreshnessAnchorStore? = nil
) throws -> SQLiteJournal {
    try SQLiteJournal(
        databaseURL: databaseURL,
        keyURL: keyURL,
        freshnessStore: freshnessStore ?? TestFreshnessStoreRegistry.shared.store(for: databaseURL),
        secretCorpus: secretCorpus
    )
}

private func binding() -> [String: Any] {
    [
        "project_id": "project_swift_test",
        "session_id": "session_swift_test",
        "source_turn_id": "turn_swift_test",
        "source_prompt_id": "prompt_swift_test",
        "episode_id": "episode_swift_test",
        "episode_root_prompt_id": "prompt_swift_test",
        "episode_baseline_checkpoint_id": "checkpoint_swift_test",
        "decision_boundary_id": "boundary_swift_test",
        "boundary_sequence": 1,
    ]
}

private func event(
    sequence: Int,
    id: String,
    type: String = "decision_boundary_opened",
    category: String = "decision_lifecycle",
    payload: [String: Any] = ["proposal_id": "proposal_swift_test"]
) -> [String: Any] {
    var value: [String: Any] = [
        "schema_version": "1.0",
        "kind": "blabee_runtime_event",
        "event_id": id,
        "event_sequence": sequence,
        "event_type": type,
        "event_category": category,
        "occurred_at": "2026-08-21T01:00:00.123456789Z",
        "payload": payload,
    ]
    value.merge(binding()) { current, _ in current }
    return value
}

private func sealedPacket(sequence: Int = 1) throws -> (packet: [String: Any], data: Data, seal: [String: Any]) {
    let fixtureData = try Data(contentsOf: appRoot.appendingPathComponent(
        "Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json"
    ))
    var packet = try #require(try JSONSerialization.jsonObject(with: fixtureData) as? [String: Any])
    let sealedAt = "2026-08-21T01:00:00.123456789Z"
    packet["valid_after_event_sequence"] = sequence
    packet["sealed_at"] = sealedAt

    var seal = event(
        sequence: sequence,
        id: "event_swift_packet_seal_\(sequence)",
        type: "decision_packet_sealed",
        payload: [
            "interaction_id": packet["interaction_id"]!,
            "packet_id": packet["packet_id"]!,
            "revision": packet["revision"]!,
            "expires_at": packet["expires_at"]!,
        ]
    )
    for key in binding().keys { seal[key] = packet[key] }
    seal["occurred_at"] = sealedAt
    return (packet, try JSONData(packet), seal)
}

private func actionContinuation(
    packet: [String: Any],
    actionID: String,
    optionID: String = "option_fixture_recommended_001",
    firstSequence: Int = 2,
    identifierSuffix: String = "action",
    fingerprintCharacter: Character = "a"
) -> (events: [[String: Any]], verification: [String: Any]) {
    let continuationID = "continuation_swift_\(identifierSuffix)"
    var selection = event(
        sequence: firstSequence,
        id: "event_swift_\(identifierSuffix)_selection",
        type: "decision_selection_claimed",
        payload: [
            "selection_id": "selection_swift_\(identifierSuffix)",
            "interaction_id": packet["interaction_id"]!,
            "packet_id": packet["packet_id"]!,
            "revision": packet["revision"]!,
            "option_id": optionID,
        ]
    )
    for key in binding().keys { selection[key] = packet[key] }
    var dispatch = event(
        sequence: firstSequence + 1,
        id: "event_swift_\(identifierSuffix)_dispatch",
        type: "continuation_dispatched",
        category: "transport",
        payload: [
            "continuation_id": continuationID,
            "interaction_id": packet["interaction_id"]!,
            "packet_id": packet["packet_id"]!,
            "revision": packet["revision"]!,
            "option_id": optionID,
            "action_id": actionID,
            "dispatch_mode": "same_turn_stop",
            "issued_at": "2026-08-21T01:00:02Z",
            "expires_at": "2026-08-21T01:02:02Z",
            "in_flight_deadline_at": "2026-08-21T01:05:02Z",
        ]
    )
    for key in binding().keys { dispatch[key] = packet[key] }
    var verification: [String: Any] = [
        "schema_version": "1.0",
        "kind": "blabee_continuation_verification_record",
        "dispatch_event_id": dispatch["event_id"]!,
        "continuation_id": continuationID,
        "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!,
        "revision": packet["revision"]!,
        "option_id": optionID,
        "action_id": actionID,
        "correlation_token_fingerprint": "hmac-sha256:" + String(repeating: fingerprintCharacter, count: 64),
    ]
    for key in binding().keys { verification[key] = packet[key] }
    return ([selection, dispatch], verification)
}

private func hexadecimal(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

private func executeSQLite(_ databaseURL: URL, _ SQL: String) throws {
    var database: OpaquePointer?
    guard sqlite3_open_v2(databaseURL.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK,
          let database
    else { throw CoordinatorError("test_sqlite_open_failed") }
    defer { sqlite3_close_v2(database) }
    guard sqlite3_exec(database, SQL, nil, nil, nil) == SQLITE_OK else {
        throw CoordinatorError("test_sqlite_exec_failed", String(cString: sqlite3_errmsg(database)))
    }
}

@Test("supported v1 fixtures match the fixed Swift ingress validator")
func fixtureParity() throws {
    let fixtureRoot = appRoot.appendingPathComponent("Fixtures/v1")
    let manifestData = try Data(contentsOf: fixtureRoot.appendingPathComponent("manifest.json"))
    let manifest = try #require(try JSONSerialization.jsonObject(with: manifestData) as? [String: Any])
    let cases = try #require(manifest["cases"] as? [[String: Any]])
    let validator = V1IngressValidator()
    var checked = 0
    for fixture in cases {
        guard let schema = fixture["schema"] as? String,
              let contract = V1Contract(rawValue: schema),
              let relativePath = fixture["file"] as? String,
              let expected = fixture["valid"] as? Bool
        else { continue }
        let data = try Data(contentsOf: fixtureRoot.appendingPathComponent(relativePath))
        if expected {
            _ = try validator.validate(data, as: contract)
        } else {
            expectCode("contract_validation_failed") { _ = try validator.validate(data, as: contract) }
        }
        checked += 1
    }
    #expect(checked == 20)
}

@Test("raw JSON gate rejects duplicates, invalid UTF-8, excessive depth, and invalid calendar dates")
func rawGate() throws {
    let validator = V1IngressValidator()
    let duplicate = Data("{\"schema_version\":\"1.0\",\"schema_version\":\"1.0\"}".utf8)
    expectCode("contract_validation_failed") { _ = try validator.validate(duplicate, as: .runtimeEvent) }
    expectCode("contract_validation_failed") {
        _ = try validator.validate(Data([0x7B, 0x22, 0xFF, 0x22, 0x3A, 0x31, 0x7D]), as: .runtimeEvent)
    }

    let tooDeep = Data((String(repeating: "[", count: 65) + "0" + String(repeating: "]", count: 65)).utf8)
    expectCode("contract_validation_failed") {
        _ = try StrictJSONTransport.object(from: tooDeep, limits: .v1)
    }

    var invalidDate = event(sequence: 1, id: "event_invalid_calendar")
    invalidDate["occurred_at"] = "2026-02-30T01:00:00Z"
    expectCode("contract_validation_failed") {
        _ = try validator.validate(try JSONData(invalidDate), as: .runtimeEvent)
    }
}

@Test("Int64 JSON boundaries are converted without Double rounding or wraparound")
func exactIntegerBoundaries() throws {
    let validator = V1IngressValidator()
    var maximum = event(sequence: 1, id: "event_int64_max")
    maximum["event_sequence"] = NSNumber(value: Int64.max)
    guard case let .runtimeEvent(dto) = try validator.validate(try JSONData(maximum), as: .runtimeEvent) else {
        Issue.record("expected runtime event DTO")
        return
    }
    #expect(dto.eventSequence == Int64.max)

    let base = try #require(String(data: try JSONData(event(sequence: 1, id: "event_int64_overflow")), encoding: .utf8))
    let overflow = Data(base.replacingOccurrences(
        of: "\"event_sequence\":1",
        with: "\"event_sequence\":9223372036854775808"
    ).utf8)
    expectCode("contract_validation_failed") {
        _ = try validator.validate(overflow, as: .runtimeEvent)
    }

    for lexeme in ["1.0", "1e0", "10e-1", "1.0000000000000000"] {
        let exact = Data(base.replacingOccurrences(
            of: "\"event_sequence\":1",
            with: "\"event_sequence\":\(lexeme)"
        ).utf8)
        guard case let .runtimeEvent(dto) = try validator.validate(exact, as: .runtimeEvent) else {
            Issue.record("expected runtime event DTO for \(lexeme)")
            continue
        }
        #expect(dto.eventSequence == 1)
    }

    for lexeme in [
        "1.0000000000000001",
        "9007199254740992.1",
        "9007199254740993.0",
        "9007199254740993e0",
        "9.007199254740993e15",
    ] {
        let roundedFraction = Data(base.replacingOccurrences(
            of: "\"event_sequence\":1",
            with: "\"event_sequence\":\(lexeme)"
        ).utf8)
        expectCode("contract_validation_failed") {
            _ = try validator.validate(roundedFraction, as: .runtimeEvent)
        }
    }

    let largePlainInteger = Data(base.replacingOccurrences(
        of: "\"event_sequence\":1",
        with: "\"event_sequence\":9007199254740993"
    ).utf8)
    guard case let .runtimeEvent(largeDTO) = try validator.validate(
        largePlainInteger,
        as: .runtimeEvent
    ) else {
        Issue.record("expected a runtime event for the exact plain integer")
        return
    }
    #expect(largeDTO.eventSequence == 9_007_199_254_740_993)

    expectCode("contract_validation_failed") {
        _ = try StrictJSONTransport.object(from: Data("{\"n\":9223372036854775808}".utf8))
    }
    #expect(ExactJSONInteger.int64(NSNumber(value: Int64.max), minimum: 0) == Int64.max)
}

@Test("request correlation recovery ignores only integer range violations")
func requestCorrelationRecovery() throws {
    let overflow = Data(
        "{\"request_id\":\"integer_boundary_overflow\",\"expected_sequence\":9223372036854775808}"
            .utf8
    )
    expectCode("contract_validation_failed") {
        _ = try StrictJSONTransport.object(from: overflow)
    }
    let recovered = try StrictJSONTransport.recoverRequestCorrelation(from: overflow)
    #expect(recovered.requestID == "integer_boundary_overflow")
    #expect(recovered.ignoredIntegerRangeViolation)

    let maximum = Data(
        "{\"request_id\":\"integer_boundary_max\",\"expected_sequence\":9223372036854775807}"
            .utf8
    )
    let maximumRecovery = try StrictJSONTransport.recoverRequestCorrelation(from: maximum)
    #expect(maximumRecovery.requestID == "integer_boundary_max")
    #expect(!maximumRecovery.ignoredIntegerRangeViolation)

    let duplicate = Data(
        "{\"request_id\":\"first\",\"request_id\":\"second\",\"n\":9223372036854775808}"
            .utf8
    )
    expectCode("contract_validation_failed") {
        _ = try StrictJSONTransport.recoverRequestCorrelation(from: duplicate)
    }
    expectCode("contract_validation_failed") {
        _ = try StrictJSONTransport.recoverRequestCorrelation(
            from: Data("{\"request_id\":\"fractional\",\"n\":1.5}".utf8)
        )
    }
    expectCode("contract_validation_failed") {
        _ = try StrictJSONTransport.recoverRequestCorrelation(
            from: Data([0x7B, 0x22, 0xFF, 0x22, 0x3A, 0x31, 0x7D])
        )
    }

    let tooDeep = Data((
        "{\"request_id\":\"too_deep\",\"value\":"
            + String(repeating: "[", count: 65)
            + "0"
            + String(repeating: "]", count: 65)
            + "}"
    ).utf8)
    expectCode("contract_validation_failed") {
        _ = try StrictJSONTransport.recoverRequestCorrelation(from: tooDeep, limits: .v1)
    }
}

@Test("Contracts/v1 manifest and every schema remain pinned")
func contractPin() throws {
    try ContractPin.verify(contractsDirectory: appRoot.appendingPathComponent("Contracts/v1"))
}

@Test("freshness records round-trip canonically and reject malformed state")
func freshnessRecordCodec() throws {
    let databaseID = UUID().uuidString
    let source = try FreshnessCheckpoint(
        databaseID: databaseID,
        generation: 3,
        sequence: 7,
        headMAC: Data(repeating: 0x11, count: 32)
    )
    let target = try FreshnessCheckpoint(
        databaseID: databaseID,
        generation: 4,
        sequence: 8,
        headMAC: Data(repeating: 0x22, count: 32)
    )
    let transition = try FreshnessPendingTransition(
        from: source,
        to: target,
        batchDigest: Data(repeating: 0x33, count: 32),
        transitionID: UUID().uuidString
    )
    let record = try FreshnessRecord.pending(
        storageSlot: "test-codec",
        transition: transition
    )
    let encoded = try record.encoded()
    #expect(try FreshnessRecord.decode(encoded, expectedStorageSlot: "test-codec") == record)
    #expect(try record.revision == Data(SHA256.hash(data: encoded)))

    var unknownField = try #require(
        JSONSerialization.jsonObject(with: encoded) as? [String: Any]
    )
    unknownField["unexpected"] = true
    expectCode("freshness_anchor_corrupt") {
        _ = try FreshnessRecord.decode(
            try JSONSerialization.data(
                withJSONObject: unknownField,
                options: [.sortedKeys, .withoutEscapingSlashes]
            ),
            expectedStorageSlot: "test-codec"
        )
    }
    expectCode("freshness_anchor_corrupt") {
        _ = try FreshnessRecord.decode(encoded, expectedStorageSlot: "different-slot")
    }
    let nonCanonical = try JSONSerialization.data(
        withJSONObject: unknownField.filter { $0.key != "unexpected" },
        options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    )
    expectCode("freshness_anchor_corrupt") {
        _ = try FreshnessRecord.decode(nonCanonical, expectedStorageSlot: "test-codec")
    }
    expectCode("freshness_anchor_corrupt") {
        _ = try FreshnessPendingTransition(
            from: source,
            to: source,
            batchDigest: Data(repeating: 0x44, count: 32)
        )
    }
}

@Test("macOS Keychain freshness store supports readback CAS and test-only cleanup")
func keychainFreshnessStoreIntegration() throws {
    let account = "test-\(UUID().uuidString.lowercased())"
    let store = try KeychainFreshnessAnchorStore(
        account: account,
        allowsTestDeletion: true
    )
    try store.deleteForTesting()
    defer { try? store.deleteForTesting() }
    #expect(try store.load() == nil)

    let initializing = try FreshnessRecord.initializing(storageSlot: account)
    let created = try store.create(initializing)
    #expect(try store.load() == created)
    let committed = try FreshnessRecord.committed(
        storageSlot: account,
        checkpoint: initializing.checkpoint
    )
    let updated = try store.compareAndSwap(
        expectedRevision: created.revision,
        replacement: committed
    )
    #expect(updated.record == committed)
    expectCode("freshness_transition_mismatch") {
        _ = try store.compareAndSwap(
            expectedRevision: created.revision,
            replacement: initializing
        )
    }
}

@Test("Keychain OSStatus corruption is distinct from temporary unavailability")
func keychainFreshnessStatusClassification() {
    for status in [errSecDecode, errSecInvalidKeychain] {
        #expect(
            KeychainFreshnessAnchorStore.classifyStatusForTesting(status)
                == "freshness_anchor_corrupt"
        )
    }
    for status in [errSecInteractionNotAllowed, errSecNotAvailable, errSecAuthFailed] {
        #expect(
            KeychainFreshnessAnchorStore.classifyStatusForTesting(status)
                == "freshness_anchor_unavailable"
        )
    }
}

@Test("freshness store failures, deletion, and mismatched high-water state fail closed")
func freshnessFailureStates() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let store = TestFreshnessAnchorStore()
    var journal: SQLiteJournal? = try testJournal(
        databaseURL: database,
        keyURL: key,
        freshnessStore: store
    )
    _ = try journal?.append(
        expectedSequence: 0,
        events: [try JSONData(event(sequence: 1, id: "event_freshness_failure"))]
    )
    journal = nil
    let committed = try #require(try store.load())

    for code in ["freshness_anchor_unavailable", "freshness_anchor_corrupt"] {
        store.failNextLoad(with: code)
        expectCode(code) {
            _ = try testJournal(databaseURL: database, keyURL: key, freshnessStore: store)
        }
    }

    let checkpoint = committed.record.checkpoint
    let identityMismatch = try FreshnessRecord.committed(
        storageSlot: store.storageSlot,
        checkpoint: FreshnessCheckpoint(
            databaseID: UUID().uuidString,
            generation: checkpoint.generation,
            sequence: checkpoint.sequence,
            headMAC: checkpoint.headMAC
        )
    )
    try store.replaceRecord(identityMismatch)
    expectCode("freshness_database_identity_mismatch") {
        _ = try testJournal(databaseURL: database, keyURL: key, freshnessStore: store)
    }

    let rollbackMismatches = [
        try FreshnessCheckpoint(
            databaseID: checkpoint.databaseID,
            generation: checkpoint.generation,
            sequence: checkpoint.sequence,
            headMAC: Data(repeating: 0xA5, count: 32)
        ),
        try FreshnessCheckpoint(
            databaseID: checkpoint.databaseID,
            generation: checkpoint.generation + 1,
            sequence: checkpoint.sequence,
            headMAC: checkpoint.headMAC
        ),
        try FreshnessCheckpoint(
            databaseID: checkpoint.databaseID,
            generation: checkpoint.generation + 1,
            sequence: checkpoint.sequence + 1,
            headMAC: Data(repeating: 0xB6, count: 32)
        ),
    ]
    for mismatch in rollbackMismatches {
        try store.replaceRecord(try FreshnessRecord.committed(
            storageSlot: store.storageSlot,
            checkpoint: mismatch
        ))
        expectCode("freshness_rollback_detected") {
            _ = try testJournal(databaseURL: database, keyURL: key, freshnessStore: store)
        }
    }

    try store.replaceRecord(committed.record)
    store.removeRecord()
    expectCode("freshness_anchor_missing") {
        _ = try testJournal(databaseURL: database, keyURL: key, freshnessStore: store)
    }
}

@Test("initializing freshness bootstrap resumes every supported partial storage state")
func freshnessInitializingBootstrapTable() throws {
    enum PartialState: CaseIterable, Equatable {
        case noFiles
        case keyOnly
        case zeroByteDatabaseAndKey
    }

    for state in PartialState.allCases {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("journal.sqlite3")
        let keyParent = directory.appendingPathComponent("keys", isDirectory: true)
        let key = keyParent.appendingPathComponent("journal.key")
        let store = TestFreshnessAnchorStore()
        _ = try store.create(try FreshnessRecord.initializing(storageSlot: store.storageSlot))
        if state != .noFiles {
            try FileManager.default.createDirectory(
                at: keyParent,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
            try Data(repeating: 0x5A, count: 32).write(to: key, options: .atomic)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: key.path
            )
        }
        if state == .zeroByteDatabaseAndKey {
            try Data().write(to: database)
        }

        let journal = try testJournal(
            databaseURL: database,
            keyURL: key,
            freshnessStore: store
        )
        #expect(try journal.health().journalSequence == 0)
        #expect(try store.load()?.record.state == .committed)
        #expect(FileManager.default.fileExists(atPath: database.path))
        #expect(FileManager.default.fileExists(atPath: key.path))
    }

    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let store = TestFreshnessAnchorStore()
    var journal: SQLiteJournal? = try testJournal(
        databaseURL: database,
        keyURL: key,
        freshnessStore: store
    )
    #expect(try journal?.health().journalSequence == 0)
    journal = nil
    let committed = try #require(try store.load())
    try store.replaceRecord(try FreshnessRecord.initializing(
        storageSlot: store.storageSlot,
        databaseID: committed.record.checkpoint.databaseID
    ))
    let resumed = try testJournal(
        databaseURL: database,
        keyURL: key,
        freshnessStore: store
    )
    #expect(try resumed.health().journalSequence == 0)
    #expect(try store.load()?.record.state == .committed)
}

@Test("initializing freshness rejects a database without its key before recreating storage")
func freshnessInitializingDatabaseWithoutKeyFailsWithoutMutation() throws {
    let databaseContents = [
        Data(),
        Data("not-a-sqlite-database".utf8),
    ]

    for originalDatabase in databaseContents {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("journal.sqlite3")
        let keyParent = directory.appendingPathComponent("keys", isDirectory: true)
        let key = keyParent.appendingPathComponent("journal.key")
        let lock = keyParent.appendingPathComponent(".blabee-coordinator-freshness.lock")
        try originalDatabase.write(to: database)
        let store = TestFreshnessAnchorStore()
        _ = try store.create(try FreshnessRecord.initializing(storageSlot: store.storageSlot))

        expectCode("freshness_storage_missing") {
            _ = try testJournal(
                databaseURL: database,
                keyURL: key,
                freshnessStore: store
            )
        }

        #expect(!FileManager.default.fileExists(atPath: keyParent.path))
        #expect(!FileManager.default.fileExists(atPath: lock.path))
        #expect(!FileManager.default.fileExists(atPath: key.path))
        #expect(try Data(contentsOf: database) == originalDatabase)
        #expect(try store.load()?.record.state == .initializing)
    }
}

@Test("an existing pre-A2 database is never adopted when the Keychain anchor is absent")
func freshnessPreA2NonAdoption() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let originalStore = TestFreshnessAnchorStore()
    var journal: SQLiteJournal? = try testJournal(
        databaseURL: database,
        keyURL: key,
        freshnessStore: originalStore
    )
    #expect(try journal?.health().journalSequence == 0)
    journal = nil
    try executeSQLite(
        database,
        "DELETE FROM coordinator_metadata WHERE key IN ('database_id','freshness_generation')"
    )
    let absentStore = TestFreshnessAnchorStore(storageSlot: originalStore.storageSlot)
    expectCode("freshness_anchor_missing") {
        _ = try testJournal(
            databaseURL: database,
            keyURL: key,
            freshnessStore: absentStore
        )
    }
    #expect(try absentStore.load() == nil)
}

@Test("pending source blocks reads and only the exact batch can recover")
func freshnessPendingExactRetry() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let store = TestFreshnessAnchorStore()
    let journal = try testJournal(databaseURL: database, keyURL: key, freshnessStore: store)
    let original = try JSONData(event(sequence: 1, id: "event_pending_exact"))
    store.failAfterNextPendingWrite(with: "test_pending_write_interruption")
    expectCode("test_pending_write_interruption") {
        _ = try journal.append(expectedSequence: 0, events: [original])
    }
    let blockedOperations: [() throws -> Void] = [
        { _ = try journal.health() },
        { _ = try journal.load() },
        { _ = try journal.integrity() },
    ]
    for operation in blockedOperations {
        expectCode("freshness_transition_pending", operation)
    }
    expectCode("freshness_transition_pending") {
        _ = try journal.append(
            expectedSequence: 0,
            events: [try JSONData(event(sequence: 1, id: "event_pending_different"))]
        )
    }
    _ = try journal.append(expectedSequence: 0, events: [original])
    let loaded = try journal.load()
    #expect(loaded.journalSequence == 1)
    #expect(loaded.events == [original])
}

@Test("pending target is finalized after a post-commit store failure")
func freshnessPendingTargetRecovery() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let store = TestFreshnessAnchorStore()
    var journal: SQLiteJournal? = try testJournal(
        databaseURL: database,
        keyURL: key,
        freshnessStore: store
    )
    let committedEvent = try JSONData(event(sequence: 1, id: "event_pending_target"))
    store.failNextCommittedCAS(with: "freshness_anchor_unavailable")
    expectCode("freshness_commit_ambiguous") {
        _ = try journal?.append(expectedSequence: 0, events: [committedEvent])
    }
    journal = nil

    let recovered = try testJournal(
        databaseURL: database,
        keyURL: key,
        freshnessStore: store
    )
    let loaded = try recovered.load()
    #expect(loaded.journalSequence == 1)
    #expect(loaded.events == [committedEvent])
    #expect(try store.load()?.record.state == .committed)
}

@Test("SQLite journal enforces WAL FULL FK, CAS, contiguous sequence, and durable replay")
func journalBasics() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let journal = try testJournal(databaseURL: database, keyURL: key)
    let health = try journal.health()
    #expect(health.sqlite.journalMode == "wal")
    #expect(health.sqlite.synchronous == "full")
    #expect(health.sqlite.foreignKeys)
    #expect(health.integrityCheck == "ok")

    let first = try JSONData(event(sequence: 1, id: "event_swift_001"))
    let result = try journal.append(expectedSequence: 0, events: [first])
    #expect(result == JournalAppendResult(firstSequence: 1, lastSequence: 1, eventCount: 1))
    #expect(try journal.load().journalSequence == 1)
    expectCode("journal_sequence_conflict") {
        _ = try journal.append(
            expectedSequence: 0,
            events: [try JSONData(event(sequence: 1, id: "event_swift_loser"))]
        )
    }
    expectCode("journal_batch_sequence_not_contiguous") {
        _ = try journal.append(
            expectedSequence: 1,
            events: [try JSONData(event(sequence: 3, id: "event_swift_gap"))]
        )
    }

    let attributes = try FileManager.default.attributesOfItem(atPath: key.path)
    #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    #expect((attributes[.size] as? NSNumber)?.intValue == 32)
}

@Test("runtime event MAC chain rejects a schema-valid payload mutation")
func eventMACChain() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    var journal: SQLiteJournal? = try testJournal(databaseURL: database, keyURL: key)
    _ = try journal?.append(
        expectedSequence: 0,
        events: [try JSONData(event(sequence: 1, id: "event_swift_chain_001"))]
    )
    journal = nil
    try executeSQLite(
        database,
        "UPDATE runtime_events SET json=replace(CAST(json AS TEXT),'proposal_swift_test','proposal_swift_tesx') WHERE event_sequence=1"
    )
    expectCode("runtime_event_integrity_mismatch") {
        _ = try testJournal(databaseURL: database, keyURL: key)
    }
}

@Test("packet sidecar is sealed atomically and tampering fails closed")
func packetSidecarMAC() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let prepared = try sealedPacket()

    var journal: SQLiteJournal? = try testJournal(databaseURL: database, keyURL: key)
    _ = try journal?.append(
        expectedSequence: 0,
        events: [try JSONData(prepared.seal)],
        documents: [prepared.data]
    )
    #expect(try journal?.integrity().sidecarsVerified == 1)
    journal = nil
    try executeSQLite(database, "UPDATE packet_documents SET mac=zeroblob(32)")
    expectCode("packet_document_integrity_mismatch") {
        _ = try testJournal(databaseURL: database, keyURL: key)
    }
}

@Test("packet seal and selection require the full decision-boundary binding")
func packetBindingIsExact() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let prepared = try sealedPacket()
    let journal = try testJournal(databaseURL: database, keyURL: key)

    var substitutedPacket = prepared.packet
    substitutedPacket["session_id"] = "session_swift_substitution"
    expectCode("packet_document_integrity_mismatch") {
        _ = try journal.append(
            expectedSequence: 0,
            events: [try JSONData(prepared.seal)],
            documents: [try JSONData(substitutedPacket)]
        )
    }
    #expect(try journal.load().journalSequence == 0)

    _ = try journal.append(
        expectedSequence: 0,
        events: [try JSONData(prepared.seal)],
        documents: [prepared.data]
    )
    var selection = event(
        sequence: 2,
        id: "event_swift_selection_substitution",
        type: "decision_selection_claimed",
        payload: [
            "selection_id": "selection_swift_substitution",
            "interaction_id": prepared.packet["interaction_id"]!,
            "packet_id": prepared.packet["packet_id"]!,
            "revision": prepared.packet["revision"]!,
            "option_id": "option_fixture_pause_001",
        ]
    )
    for key in binding().keys { selection[key] = prepared.packet[key] }
    selection["session_id"] = "session_swift_substitution"
    var close = event(
        sequence: 3,
        id: "event_swift_selection_substitution_close",
        type: "decision_boundary_closed",
        payload: ["close_reason": "episode_paused"]
    )
    for key in binding().keys { close[key] = selection[key] }
    expectCode("packet_document_integrity_mismatch") {
        _ = try journal.append(
            expectedSequence: 1,
            events: [try JSONData(selection), try JSONData(close)]
        )
    }
    #expect(try journal.load().journalSequence == 1)

    let forged = actionContinuation(packet: prepared.packet, actionID: "action_swift_forged")
    expectCode("packet_document_integrity_mismatch") {
        _ = try journal.append(
            expectedSequence: 1,
            events: try forged.events.map(JSONData),
            verificationRecords: [try JSONData(forged.verification)]
        )
    }
    #expect(try journal.load().journalSequence == 1)
}

@Test("one decision packet cannot be selected twice within one append batch")
func selectionUniquenessWithinBatch() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let prepared = try sealedPacket()
    let journal = try testJournal(databaseURL: database, keyURL: key)
    _ = try journal.append(
        expectedSequence: 0,
        events: [try JSONData(prepared.seal)],
        documents: [prepared.data]
    )

    let first = actionContinuation(
        packet: prepared.packet,
        actionID: "action_fixture_recommended_001"
    )
    let second = actionContinuation(
        packet: prepared.packet,
        actionID: "action_fixture_alternative_001",
        optionID: "option_fixture_alternative_001",
        firstSequence: 4,
        identifierSuffix: "batch_alternative",
        fingerprintCharacter: "b"
    )
    expectCode("selection_already_claimed") {
        _ = try journal.append(
            expectedSequence: 1,
            events: try (first.events + second.events).map(JSONData),
            verificationRecords: try [first.verification, second.verification].map(JSONData)
        )
    }
    let snapshot = try journal.load()
    #expect(snapshot.journalSequence == 1)
    #expect(snapshot.events.count == 1)
    #expect(snapshot.verificationRecords.isEmpty)
}

@Test("a persisted selection rejects same and different option claims without corrupting replay")
func selectionUniquenessAgainstPersistedEvents() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let prepared = try sealedPacket()
    let journal = try testJournal(databaseURL: database, keyURL: key)
    _ = try journal.append(
        expectedSequence: 0,
        events: [try JSONData(prepared.seal)],
        documents: [prepared.data]
    )
    let committed = actionContinuation(
        packet: prepared.packet,
        actionID: "action_fixture_recommended_001"
    )
    _ = try journal.append(
        expectedSequence: 1,
        events: try committed.events.map(JSONData),
        verificationRecords: [try JSONData(committed.verification)]
    )
    let baseline = try journal.load()

    let attempts = [
        actionContinuation(
            packet: prepared.packet,
            actionID: "action_fixture_recommended_001",
            firstSequence: 4,
            identifierSuffix: "repeat_same",
            fingerprintCharacter: "b"
        ),
        actionContinuation(
            packet: prepared.packet,
            actionID: "action_fixture_alternative_001",
            optionID: "option_fixture_alternative_001",
            firstSequence: 4,
            identifierSuffix: "repeat_alternative",
            fingerprintCharacter: "c"
        ),
    ]
    for attempt in attempts {
        expectCode("selection_already_claimed") {
            _ = try journal.append(
                expectedSequence: baseline.journalSequence,
                events: try attempt.events.map(JSONData),
                verificationRecords: [try JSONData(attempt.verification)]
            )
        }
        #expect(try journal.load() == baseline)
    }

    var revisionTwoPacket = prepared.packet
    revisionTwoPacket["revision"] = 2
    revisionTwoPacket["valid_after_event_sequence"] = 4
    revisionTwoPacket["sealed_at"] = "2026-08-21T01:00:03Z"
    var revisionTwoSeal = event(
        sequence: 4,
        id: "event_swift_repeat_revision_seal",
        type: "decision_packet_sealed",
        payload: [
            "interaction_id": revisionTwoPacket["interaction_id"]!,
            "packet_id": revisionTwoPacket["packet_id"]!,
            "revision": revisionTwoPacket["revision"]!,
            "expires_at": revisionTwoPacket["expires_at"]!,
        ]
    )
    for key in binding().keys { revisionTwoSeal[key] = revisionTwoPacket[key] }
    revisionTwoSeal["occurred_at"] = revisionTwoPacket["sealed_at"]
    let revisionAttempt = actionContinuation(
        packet: revisionTwoPacket,
        actionID: "action_fixture_alternative_001",
        optionID: "option_fixture_alternative_001",
        firstSequence: 5,
        identifierSuffix: "repeat_revision",
        fingerprintCharacter: "d"
    )
    expectCode("selection_already_claimed") {
        _ = try journal.append(
            expectedSequence: baseline.journalSequence,
            events: try ([revisionTwoSeal] + revisionAttempt.events).map(JSONData),
            documents: [try JSONData(revisionTwoPacket)],
            verificationRecords: [try JSONData(revisionAttempt.verification)]
        )
    }
    #expect(try journal.load() == baseline)

    var reboundPacket = prepared.packet
    reboundPacket["interaction_id"] = "interaction_swift_rebound"
    reboundPacket["packet_id"] = "packet_swift_rebound"
    reboundPacket["valid_after_event_sequence"] = 4
    reboundPacket["sealed_at"] = "2026-08-21T01:00:03Z"
    var reboundSeal = event(
        sequence: 4,
        id: "event_swift_repeat_rebound_seal",
        type: "decision_packet_sealed",
        payload: [
            "interaction_id": reboundPacket["interaction_id"]!,
            "packet_id": reboundPacket["packet_id"]!,
            "revision": reboundPacket["revision"]!,
            "expires_at": reboundPacket["expires_at"]!,
        ]
    )
    for key in binding().keys { reboundSeal[key] = reboundPacket[key] }
    reboundSeal["occurred_at"] = reboundPacket["sealed_at"]
    let reboundAttempt = actionContinuation(
        packet: reboundPacket,
        actionID: "action_fixture_alternative_001",
        optionID: "option_fixture_alternative_001",
        firstSequence: 5,
        identifierSuffix: "repeat_rebound",
        fingerprintCharacter: "e"
    )
    expectCode("selection_already_claimed") {
        _ = try journal.append(
            expectedSequence: baseline.journalSequence,
            events: try ([reboundSeal] + reboundAttempt.events).map(JSONData),
            documents: [try JSONData(reboundPacket)],
            verificationRecords: [try JSONData(reboundAttempt.verification)]
        )
    }
    #expect(try journal.load() == baseline)
}

@Test("authenticated verification replay must exactly match its dispatch binding")
func verificationReplayBindingIsExact() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let prepared = try sealedPacket()
    let actualActionID = "action_fixture_recommended_001"
    let continuation = actionContinuation(packet: prepared.packet, actionID: actualActionID)
    var journal: SQLiteJournal? = try testJournal(databaseURL: database, keyURL: key)
    _ = try journal?.append(
        expectedSequence: 0,
        events: [try JSONData(prepared.seal)],
        documents: [prepared.data]
    )
    _ = try journal?.append(
        expectedSequence: 1,
        events: try continuation.events.map(JSONData),
        verificationRecords: [try JSONData(continuation.verification)]
    )
    journal = nil

    var substituted = continuation.verification
    substituted["session_id"] = "session_swift_authenticated_substitution"
    let canonical = try JSONData(substituted)
    let storageKey = try StorageKey(bytes: Data(contentsOf: key))
    let authenticator = SidecarAuthenticator(storageKey: storageKey)
    let continuationID = try #require(substituted["continuation_id"] as? String)
    let identity = "\(continuationID.utf8.count):\(continuationID)"
    let MAC = authenticator.authenticationCode(
        domain: SidecarAuthenticator.verificationDomain,
        identity: identity,
        canonicalJSON: canonical
    )
    try executeSQLite(
        database,
        "UPDATE verification_records SET json=X'\(hexadecimal(canonical))',mac=X'\(hexadecimal(MAC))'"
    )
    expectCode("verification_record_integrity_mismatch") {
        _ = try testJournal(databaseURL: database, keyURL: key)
    }
}

@Test("wrong external key and raw continuation tokens fail closed")
func keyAndRawTokenFailures() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    var journal: SQLiteJournal? = try testJournal(databaseURL: database, keyURL: key)
    _ = try journal?.append(
        expectedSequence: 0,
        events: [try JSONData(event(sequence: 1, id: "event_swift_key_001"))]
    )
    var raw = event(sequence: 2, id: "event_swift_raw_token")
    raw["continuation_token"] = "raw_token_must_not_persist"
    expectCode("raw_continuation_token_forbidden") {
        _ = try journal?.append(expectedSequence: 1, events: [try JSONData(raw)])
    }
    journal = nil

    let replacement = directory.appendingPathComponent("replacement.key")
    try Data(repeating: 0xA5, count: 32).write(to: replacement, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: replacement.path)
    expectCode("storage_key_invalid") {
        _ = try testJournal(databaseURL: database, keyURL: replacement)
    }
}

@Test("all runtime-known secret representations are rejected from durable JSON")
func knownSecretValueFailures() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let corpus = RuntimeSecretCorpus()
    let journal = try testJournal(databaseURL: database, keyURL: key, secretCorpus: corpus)

    let continuationToken = "FictionalRuntimeSecretToken_0123456789"
    corpus.register(continuationToken)
    var hidden = event(sequence: 1, id: "event_swift_hidden_secret")
    hidden["payload"] = ["proposal_id": continuationToken]
    expectCode("raw_continuation_token_forbidden") {
        _ = try journal.append(expectedSequence: 0, events: [try JSONData(hidden)])
    }

    let keyBytes = try Data(contentsOf: key)
    let keyHex = keyBytes.map { String(format: "%02x", $0) }.joined()
    var keyAlias = event(sequence: 1, id: "event_swift_key_alias")
    keyAlias["payload"] = ["proposal_id": keyHex]
    expectCode("raw_continuation_token_forbidden") {
        _ = try journal.append(expectedSequence: 0, events: [try JSONData(keyAlias)])
    }
    #expect(try journal.load().journalSequence == 0)
}

@Test("database and key pair state fails closed after database loss or truncation")
func databaseKeyPairState() throws {
    for removeDatabase in [false, true] {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("journal.sqlite3")
        let key = directory.appendingPathComponent("journal.key")
        var journal: SQLiteJournal? = try testJournal(databaseURL: database, keyURL: key)
        _ = try journal?.append(
            expectedSequence: 0,
            events: [try JSONData(event(sequence: 1, id: "event_pair_\(removeDatabase)"))]
        )
        journal = nil
        if removeDatabase {
            try FileManager.default.removeItem(at: database)
        } else {
            let handle = try FileHandle(forWritingTo: database)
            try handle.truncate(atOffset: 0)
            try handle.close()
        }
        expectCode("freshness_storage_missing") {
            _ = try testJournal(databaseURL: database, keyURL: key)
        }
    }
}

@Test("storage key path rejects an ancestor symbolic link")
func keyAncestorSymlink() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let realRoot = directory.appendingPathComponent("real-root", isDirectory: true)
    let keyParent = realRoot.appendingPathComponent("keys", isDirectory: true)
    let aliasRoot = directory.appendingPathComponent("alias-root", isDirectory: true)
    try FileManager.default.createDirectory(at: keyParent, withIntermediateDirectories: true)
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: keyParent.path)
    try FileManager.default.createSymbolicLink(at: aliasRoot, withDestinationURL: realRoot)

    expectCode("freshness_lock_unavailable") {
        _ = try testJournal(
            databaseURL: directory.appendingPathComponent("journal.sqlite3"),
            keyURL: aliasRoot.appendingPathComponent("keys/journal.key")
        )
    }
}

@Test("pinned SQLite schema rejects triggers, views, and extra indexes")
func exactSQLiteSchemaAllowlist() throws {
    let mutations = [
        "CREATE TRIGGER malicious_trigger AFTER INSERT ON runtime_events BEGIN DELETE FROM runtime_events; END",
        "CREATE VIEW malicious_view AS SELECT * FROM runtime_events",
        "CREATE INDEX malicious_index ON runtime_events(event_id)",
    ]
    for (index, SQL) in mutations.enumerated() {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("journal.sqlite3")
        let key = directory.appendingPathComponent("journal.key")
        var journal: SQLiteJournal? = try testJournal(databaseURL: database, keyURL: key)
        #expect(try journal?.health().schemaVersion == 1)
        journal = nil
        try executeSQLite(database, SQL)
        expectCode("schema_version_mismatch") {
            _ = try testJournal(databaseURL: database, keyURL: key)
        }
        #expect(index < mutations.count)
    }
}

@Test("transaction-time schema verification blocks a fake-commit trigger")
func fakeCommitTriggerIsBlocked() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    let journal = try testJournal(databaseURL: database, keyURL: key)
    _ = try journal.append(
        expectedSequence: 0,
        events: [try JSONData(event(sequence: 1, id: "event_fake_commit_001"))]
    )
    try executeSQLite(
        database,
        """
        CREATE TRIGGER malicious_fake_commit AFTER INSERT ON runtime_events BEGIN
          DELETE FROM runtime_events WHERE event_sequence=NEW.event_sequence;
        END
        """
    )
    expectCode("schema_version_mismatch") {
        _ = try journal.append(
            expectedSequence: 1,
            events: [try JSONData(event(sequence: 2, id: "event_fake_commit_002"))]
        )
    }
    try executeSQLite(database, "DROP TRIGGER malicious_fake_commit")
    #expect(try journal.load().journalSequence == 1)
}

@Test("unsupported SQLite schema versions fail closed without migration")
func schemaVersionMismatch() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let database = directory.appendingPathComponent("journal.sqlite3")
    let key = directory.appendingPathComponent("journal.key")
    var journal: SQLiteJournal? = try testJournal(databaseURL: database, keyURL: key)
    #expect(try journal?.health().schemaVersion == 1)
    journal = nil
    try executeSQLite(database, "PRAGMA user_version=99")
    expectCode("schema_version_mismatch") {
        _ = try testJournal(databaseURL: database, keyURL: key)
    }
}
