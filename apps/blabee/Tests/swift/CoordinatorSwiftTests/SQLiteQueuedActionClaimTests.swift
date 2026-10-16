import Foundation
import Testing
@testable import CoordinatorSwift

private let sqliteClaimRepositoryRoot: URL = {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}()

private func sqliteClaimData(_ object: Any) throws -> Data {
    try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
}

private func sqliteClaimObject(_ data: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CoordinatorError("test_json_invalid")
    }
    return object
}

private func sqliteClaimTemporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
        "blabee-sqlite-claim-\(UUID().uuidString)",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: url,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    return url
}

private struct SQLiteClaimIOCounts: Equatable {
    var publicLoads = 0
    var publicAppends = 0
    var appendedEventCounts: [Int] = []
    var freshnessLoads = 0
    var freshnessCAS = 0
}

private struct SQLiteClaimWorkCounts: Equatable {
    var fullValidationScans = 0
    var eventPreparations = 0
    var documentPreparations = 0
    var verificationPreparations = 0
    var strictJSONDecodingPasses = 0
    var sidecarCandidates = 0
    var fullReplayEvents: [Int] = []
    var incrementalEvents: [Int] = []
    var validationNanoseconds: [UInt64] = []
    var fullReplayNanoseconds: [UInt64] = []
    var incrementalNanoseconds: [UInt64] = []
}

/// Enabled only around the operation under measurement, excluding fixture
/// creation, journal reopen, and assertions. Freshness uses memory, not Keychain.
private final class SQLiteClaimIOMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var recording = false
    private var counts = SQLiteClaimIOCounts()
    private var workCounts = SQLiteClaimWorkCounts()

    func start() {
        lock.lock()
        defer { lock.unlock() }
        counts = SQLiteClaimIOCounts()
        workCounts = SQLiteClaimWorkCounts()
        recording = true
    }

    func record(_ update: (inout SQLiteClaimIOCounts) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        if recording { update(&counts) }
    }

    func stop() -> SQLiteClaimIOCounts {
        lock.lock()
        defer { lock.unlock() }
        recording = false
        return counts
    }

    func observe(_ work: SQLiteJournalWork) {
        lock.lock()
        defer { lock.unlock() }
        guard recording else { return }
        switch work {
        case .fullValidationScan: workCounts.fullValidationScans += 1
        case let .fullValidationFinished(elapsedNanoseconds):
            workCounts.validationNanoseconds.append(elapsedNanoseconds)
        case .eventPreparation: workCounts.eventPreparations += 1
        case .documentPreparation: workCounts.documentPreparations += 1
        case .verificationPreparation: workCounts.verificationPreparations += 1
        case .strictJSONDecodingPass: workCounts.strictJSONDecodingPasses += 1
        case let .sidecarCandidates(count): workCounts.sidecarCandidates += count
        }
    }

    func observe(_ work: CoordinatorSemanticReplayWork) {
        lock.lock()
        defer { lock.unlock() }
        guard recording else { return }
        switch work {
        case let .fullReplay(eventCount): workCounts.fullReplayEvents.append(eventCount)
        case let .incrementalApplication(eventCount): workCounts.incrementalEvents.append(eventCount)
        case let .fullReplayFinished(elapsedNanoseconds):
            workCounts.fullReplayNanoseconds.append(elapsedNanoseconds)
        case let .incrementalApplicationFinished(elapsedNanoseconds):
            workCounts.incrementalNanoseconds.append(elapsedNanoseconds)
        }
    }

    func measuredWork() -> SQLiteClaimWorkCounts {
        lock.lock()
        defer { lock.unlock() }
        return workCounts
    }
}

private final class SQLiteClaimMeteredJournal: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let journal: SQLiteJournal
    private let meter: SQLiteClaimIOMeter

    init(journal: SQLiteJournal, meter: SQLiteClaimIOMeter) {
        self.journal = journal
        self.meter = meter
    }

    func load() throws -> JournalSnapshot {
        meter.record { $0.publicLoads += 1 }
        return try journal.load()
    }

    func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data]
    ) throws -> JournalAppendResult {
        try append(expectedSequence: expectedSequence, events: events, documents: documents,
            verificationRecords: verificationRecords, validateAdmission: {})
    }

    func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data],
        validateAdmission: () throws -> Void
    ) throws -> JournalAppendResult {
        meter.record {
            $0.publicAppends += 1
            $0.appendedEventCounts.append(events.count)
        }
        return try journal.append(
            expectedSequence: expectedSequence, events: events,
            documents: documents, verificationRecords: verificationRecords,
            validateAdmission: validateAdmission
        )
    }
}

private final class SQLiteClaimFreshnessStore: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "test-\(UUID().uuidString)"

    private let lock = NSLock()
    private let meter: SQLiteClaimIOMeter
    private var stored: FreshnessStoredRecord?

    init(meter: SQLiteClaimIOMeter) {
        self.meter = meter
    }

    func load() throws -> FreshnessStoredRecord? {
        meter.record { $0.freshnessLoads += 1 }
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
        let created = try FreshnessStoredRecord(
            record: record,
            revision: record.revision
        )
        stored = created
        return created
    }

    func compareAndSwap(
        expectedRevision: Data,
        replacement: FreshnessRecord
    ) throws -> FreshnessStoredRecord {
        meter.record { $0.freshnessCAS += 1 }
        lock.lock()
        defer { lock.unlock() }
        guard let current = stored, current.revision == expectedRevision else {
            throw CoordinatorError("freshness_anchor_conflict")
        }
        guard replacement.storageSlot == storageSlot else {
            throw CoordinatorError("freshness_anchor_corrupt")
        }
        let updated = try FreshnessStoredRecord(
            record: replacement,
            revision: replacement.revision
        )
        stored = updated
        return updated
    }
}

private final class SQLiteClaimClock: CoordinatorContinuousClock, @unchecked Sendable {
    func nowNanoseconds() -> UInt64 { 0 }
}

private final class SQLiteClaimIDs: @unchecked Sendable {
    private let prefix: String
    private let lock = NSLock()
    private var value = 0

    init(prefix: String) {
        self.prefix = prefix
    }

    func next(_ purpose: String) -> String {
        lock.lock()
        value += 1
        let current = value
        lock.unlock()
        return "event_sqlite_claim_\(prefix)_\(purpose)_\(current)"
    }
}

private final class SQLiteClaimFixture: @unchecked Sendable {
    let directory: URL
    let binding: [String: Any]
    let continuationID: String
    let actionJSON: Data
    let meter: SQLiteClaimIOMeter
    private var retainedJournalA: SQLiteJournal?
    private var retainedJournalB: SQLiteJournal?
    private var retainedRoutingA: CoordinatorRoutingApplication?
    private var retainedRoutingB: CoordinatorRoutingApplication?

    init(
        directory: URL,
        journalA: SQLiteJournal,
        journalB: SQLiteJournal,
        routingA: CoordinatorRoutingApplication,
        routingB: CoordinatorRoutingApplication,
        binding: [String: Any],
        continuationID: String,
        actionJSON: Data,
        meter: SQLiteClaimIOMeter
    ) {
        self.directory = directory
        retainedJournalA = journalA
        retainedJournalB = journalB
        retainedRoutingA = routingA
        retainedRoutingB = routingB
        self.binding = binding
        self.continuationID = continuationID
        self.actionJSON = actionJSON
        self.meter = meter
    }

    var journalA: SQLiteJournal { retainedJournalA! }
    var journalB: SQLiteJournal { retainedJournalB! }
    var routingA: CoordinatorRoutingApplication { retainedRoutingA! }
    var routingB: CoordinatorRoutingApplication { retainedRoutingB! }

    func remove() {
        retainedRoutingA = nil
        retainedRoutingB = nil
        retainedJournalA = nil
        retainedJournalB = nil
        try? FileManager.default.removeItem(at: directory)
    }
}

private func sqliteClaimBinding(_ suffix: String) -> [String: Any] {
    [
        "project_id": "project_sqlite_claim_\(suffix)",
        "session_id": "session_sqlite_claim_\(suffix)",
        "source_turn_id": "turn_sqlite_claim_\(suffix)",
        "source_prompt_id": "prompt_sqlite_claim_\(suffix)",
        "episode_id": "episode_sqlite_claim_\(suffix)",
        "episode_root_prompt_id": "prompt_sqlite_claim_\(suffix)",
        "episode_baseline_checkpoint_id": "checkpoint_sqlite_claim_\(suffix)",
        "decision_boundary_id": "boundary_sqlite_claim_\(suffix)",
        "boundary_sequence": 1,
    ]
}

private func sqliteClaimPacket(
    suffix: String,
    binding: [String: Any],
    validAfterEventSequence: Int64 = 2,
    rankedActions: Bool = false
) throws -> [String: Any] {
    let source = sqliteClaimRepositoryRoot.appendingPathComponent(
        "Fixtures/v1/contracts/valid/decision-packet-\(rankedActions ? "ranked-actions" : "rollback-disabled").json"
    )
    guard var packet = try JSONSerialization.jsonObject(
        with: Data(contentsOf: source)
    ) as? [String: Any],
    var checkpoint = packet["checkpoint"] as? [String: Any],
    var choices = packet["choices"] as? [[String: Any]]
    else { throw CoordinatorError("test_fixture_invalid") }

    for (key, value) in binding { packet[key] = value }
    packet["interaction_id"] = "interaction_sqlite_claim_\(suffix)"
    packet["packet_id"] = "packet_sqlite_claim_\(suffix)"
    packet["revision"] = 1
    packet["valid_after_event_sequence"] = validAfterEventSequence
    let sealedAt = "2026-08-21T12:00:01Z"
    packet["sealed_at"] = sealedAt
    packet["expires_at"] = try RFC3339Instant(sealedAt)
        .adding(nanoseconds: CoordinatorRoutingApplication.expiryAfterNanoseconds)
        .rawValue
    checkpoint["id"] = binding["episode_baseline_checkpoint_id"]
    packet["checkpoint"] = checkpoint
    for index in choices.indices {
        choices[index]["option_id"] = "option_sqlite_claim_\(suffix)_\(index + 1)"
        if choices[index]["action_id"] is String {
            choices[index]["action_id"] = "action_sqlite_claim_\(suffix)_\(index + 1)"
        }
    }
    packet["choices"] = choices
    return packet
}

private func sqliteClaimClosedHistory(suffix: String, pairCount: Int) throws -> [Data] {
    var events: [Data] = []
    for index in 0..<pairCount {
        let historySuffix = "\(suffix)_history_\(index)"
        var event = sqliteClaimBinding(historySuffix)
        event["schema_version"] = "1.0"
        event["kind"] = "blabee_runtime_event"
        event["event_id"] = "event_sqlite_claim_\(historySuffix)_open"
        event["event_sequence"] = events.count + 1
        event["event_type"] = "decision_boundary_opened"
        event["event_category"] = "decision_lifecycle"
        event["occurred_at"] = "2026-08-20T12:00:00Z"
        event["payload"] = ["proposal_id": "proposal_sqlite_claim_\(historySuffix)"]
        events.append(try sqliteClaimData(event))
        event["event_id"] = "event_sqlite_claim_\(historySuffix)_close"
        event["event_sequence"] = events.count + 1
        event["event_type"] = "decision_boundary_closed"
        event["occurred_at"] = "2026-08-20T12:00:01Z"
        event["payload"] = ["close_reason": "synthetic_history_closed"]
        events.append(try sqliteClaimData(event))
    }
    return events
}

private func makeSQLiteClaimFixture(
    _ suffix: String,
    closedHistoryPairs: Int = 0,
    completeTransport: ((SQLiteJournal, CoordinatorRoutingApplication, SQLiteClaimIOMeter, Data, Data) throws -> Void)? = nil
) throws -> SQLiteClaimFixture {
    let directory = try sqliteClaimTemporaryDirectory()
    let databaseURL = directory.appendingPathComponent("journal.sqlite")
    let keyURL = directory.appendingPathComponent("journal.key")
    let meter = SQLiteClaimIOMeter()
    let freshness = SQLiteClaimFreshnessStore(meter: meter)
    let journalA = try SQLiteJournal(
        databaseURL: databaseURL,
        keyURL: keyURL,
        freshnessStore: freshness,
        workObserver: { meter.observe($0) }
    )
    let history = try sqliteClaimClosedHistory(suffix: suffix, pairCount: closedHistoryPairs)
    if !history.isEmpty {
        _ = try CoordinatorSemanticReplay.replay(JournalSnapshot(
            events: history, documents: [], verificationRecords: [],
            journalSequence: Int64(history.count)
        ))
        _ = try journalA.append(expectedSequence: 0, events: history)
    }
    let routingA = try CoordinatorRoutingApplication(
        journal: SQLiteClaimMeteredJournal(journal: journalA, meter: meter),
        clock: SQLiteClaimClock(),
        eventIDGenerator: SQLiteClaimIDs(prefix: "\(suffix)_a").next
    )
    let binding = sqliteClaimBinding(suffix)
    let packet = try sqliteClaimPacket(
        suffix: suffix, binding: binding,
        validAfterEventSequence: Int64(history.count) + 2
    )
    _ = try routingA.executeCommand(sqliteClaimData([
        "type": "open_boundary",
        "event_id": "event_sqlite_claim_\(suffix)_open",
        "occurred_at": "2026-08-21T12:00:00Z",
        "binding": binding,
        "proposal_id": "proposal_sqlite_claim_\(suffix)",
    ]))
    _ = try routingA.executeCommand(sqliteClaimData([
        "type": "seal_packet",
        "event_id": "event_sqlite_claim_\(suffix)_seal",
        "packet": packet,
    ]))
    var target: [String: Any] = [
        "expected_state": "pending",
        "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!,
        "revision": packet["revision"]!,
    ]
    for (key, value) in binding { target[key] = value }
    _ = try routingA.setForeground(sqliteClaimData(target))

    guard let choices = packet["choices"] as? [[String: Any]] else {
        throw CoordinatorError("test_fixture_invalid")
    }
    var request: [String: Any] = [
        "schema_version": "1.0",
        "kind": "blabee_selection_request",
        "selection_id": "selection_sqlite_claim_\(suffix)",
        "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!,
        "revision": packet["revision"]!,
        "option_id": choices[0]["option_id"]!,
    ]
    for (key, value) in binding { request[key] = value }
    let continuationID = "continuation_sqlite_claim_\(suffix)"
    let selection = try routingA.routeSelection(sqliteClaimData([
        "type": "select_option",
        "expected_state": "pending",
        "event_ids": [
            "selection_claimed": "event_sqlite_claim_\(suffix)_selection",
            "continuation_dispatched": "event_sqlite_claim_\(suffix)_dispatch",
            "decision_boundary_closed": "event_sqlite_claim_\(suffix)_pause_close",
        ],
        "occurred_at": "2099-01-01T00:00:00Z",
        "request": request,
        "continuation_id": continuationID,
        "issued_at": "2099-01-01T00:00:00Z",
        "expires_at": "2199-01-01T00:00:00Z",
        "in_flight_deadline_at": "2299-01-01T00:00:00Z",
    ]))
    let effect = try sqliteClaimObject(try #require(selection.effects.first))
    let envelope = try #require(effect["envelope"] as? [String: Any])
    _ = try routingA.routeConsumePetAction(sqliteClaimData([
        "type": "consume_pet_action",
        "event_id": "event_sqlite_claim_\(suffix)_consume",
        "occurred_at": "2099-01-01T00:00:00Z",
        "envelope": envelope,
    ]))
    let completion = try sqliteClaimData([
        "type": "complete_transport",
        "event_id": "event_sqlite_claim_\(suffix)_complete",
        "occurred_at": "2026-08-21T12:00:02Z",
        "binding": binding,
        "continuation_id": continuationID,
    ])
    let close = try sqliteClaimData([
        "type": "close_boundary",
        "event_id": "event_sqlite_claim_\(suffix)_close",
        "occurred_at": "2026-08-21T12:00:03Z",
        "binding": binding,
        "close_reason": "queued_transport_completed",
    ])
    if let completeTransport {
        try completeTransport(journalA, routingA, meter, completion, close)
    } else {
        _ = try routingA.executeCommand(completion)
        _ = try routingA.executeCommand(close)
    }
    let state = try routingA.authoritativeState()
    let actionJSON = try state.selectedActionJSON(for: continuationID)

    let journalB = try SQLiteJournal(
        databaseURL: databaseURL,
        keyURL: keyURL,
        freshnessStore: freshness,
        workObserver: { meter.observe($0) }
    )
    let routingB = try CoordinatorRoutingApplication(
        journal: SQLiteClaimMeteredJournal(journal: journalB, meter: meter),
        clock: SQLiteClaimClock(),
        eventIDGenerator: SQLiteClaimIDs(prefix: "\(suffix)_b").next
    )
    return SQLiteClaimFixture(
        directory: directory,
        journalA: journalA,
        journalB: journalB,
        routingA: routingA,
        routingB: routingB,
        binding: binding,
        continuationID: continuationID,
        actionJSON: actionJSON,
        meter: meter
    )
}

private func sqliteClaimCommand(
    fixture: SQLiteClaimFixture,
    eventID: String,
    turnID: String
) throws -> Data {
    try sqliteClaimData([
        "type": "claim_queued_action_context",
        "event_id": eventID,
        "occurred_at": "2026-08-21T12:00:04Z",
        "binding": fixture.binding,
        "continuation_id": fixture.continuationID,
        "delivery_turn_id": turnID,
        "queued_prompt_sha256": "sha256:" + String(repeating: "a", count: 64),
        "cwd_sha256": "sha256:" + String(repeating: "b", count: 64),
        "action_sha256": CoordinatorSHA256.fingerprint(fixture.actionJSON),
    ])
}

private func sqliteClaimEvents(_ snapshot: JournalSnapshot) throws -> [[String: Any]] {
    try snapshot.events.compactMap { data in
        let event = try sqliteClaimObject(data)
        return event["event_type"] as? String == "queued_action_context_claimed"
            ? event
            : nil
    }
}

private func sqliteClaimExpectCode(_ expected: String, _ body: () throws -> Void) {
    do {
        try body()
        Issue.record("expected error \(expected)")
    } catch let error as CoordinatorError {
        #expect(error.code == expected)
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

private actor SQLiteClaimBarrier {
    private let participantCount: Int
    private var continuations: [CheckedContinuation<Void, Never>] = []

    init(participantCount: Int) {
        self.participantCount = participantCount
    }

    func arriveAndWait() async {
        await withCheckedContinuation { continuation in
            continuations.append(continuation)
            if continuations.count == participantCount {
                let ready = continuations
                continuations.removeAll()
                for item in ready { item.resume() }
            }
        }
    }
}

private enum SQLiteClaimOutcome: Sendable {
    case success(Data)
    case failure(String)
}

private func runOverlappingSQLiteClaims(
    _ first: @escaping @Sendable () throws -> Data,
    _ second: @escaping @Sendable () throws -> Data
) async -> [SQLiteClaimOutcome] {
    let barrier = SQLiteClaimBarrier(participantCount: 2)
    async let firstOutcome: SQLiteClaimOutcome = {
        await barrier.arriveAndWait()
        do { return .success(try first()) }
        catch let error as CoordinatorError { return .failure(error.code) }
        catch { return .failure("unexpected_error") }
    }()
    async let secondOutcome: SQLiteClaimOutcome = {
        await barrier.arriveAndWait()
        do { return .success(try second()) }
        catch let error as CoordinatorError { return .failure(error.code) }
        catch { return .failure("unexpected_error") }
    }()
    return await [firstOutcome, secondOutcome]
}

private func withSQLiteClaimFixture<Result>(
    _ suffix: String,
    perform body: (SQLiteClaimFixture) throws -> Result
) throws -> Result {
    let fixture = try makeSQLiteClaimFixture(suffix)
    defer { fixture.remove() }
    return try body(fixture)
}

private func withSQLiteClaimFixture<Result>(
    _ suffix: String,
    perform body: (SQLiteClaimFixture) async throws -> Result
) async throws -> Result {
    let fixture = try makeSQLiteClaimFixture(suffix)
    defer { fixture.remove() }
    return try await body(fixture)
}

@Test("SQLite rejects a persisted duplicate queued action claim")
func sqliteQueuedActionClaimPersistsOneUniqueEvent() throws {
    try withSQLiteClaimFixture("direct_unique") { fixture in
        let command = try sqliteClaimCommand(
            fixture: fixture,
            eventID: "event_sqlite_claim_direct_unique_first",
            turnID: "delivery_turn_direct_unique"
        )
        let semantic = CoordinatorSemanticApplication(journal: fixture.journalA)
        let first = try semantic.execute(command: command)
        #expect(first.commit.eventCount == 1)
        let exactRetry = try semantic.execute(command: command)
        #expect(exactRetry.commit.eventCount == 0)

        let snapshot = try fixture.journalB.load()
        let claims = try sqliteClaimEvents(snapshot)
        #expect(claims.count == 1)
        var duplicate = try #require(claims.first)
        duplicate["event_id"] = "event_sqlite_claim_direct_unique_duplicate"
        duplicate["event_sequence"] = snapshot.journalSequence + 1
        duplicate["occurred_at"] = "2026-08-21T12:00:05Z"
        sqliteClaimExpectCode("queued_action_context_already_claimed") {
            _ = try fixture.journalB.append(
                expectedSequence: snapshot.journalSequence,
                events: [sqliteClaimData(duplicate)]
            )
        }
        let afterDuplicate = try fixture.journalA.load()
        #expect(afterDuplicate.journalSequence == snapshot.journalSequence)
        #expect(try sqliteClaimEvents(afterDuplicate).count == 1)

        sqliteClaimExpectCode("queued_action_context_already_claimed") {
            _ = try semantic.execute(command: sqliteClaimCommand(
                fixture: fixture,
                eventID: "event_sqlite_claim_direct_unique_other_turn",
                turnID: "delivery_turn_direct_other"
            ))
        }
    }
}

@Test("two SQLite routing instances recover one same-turn claim")
func sqliteQueuedActionClaimConcurrentSameTurnIsIdempotent() async throws {
    try await withSQLiteClaimFixture("concurrent_same") { fixture in
        let commandA = try sqliteClaimCommand(
            fixture: fixture,
            eventID: "event_sqlite_claim_concurrent_same_a",
            turnID: "delivery_turn_concurrent_same"
        )
        let commandB = try sqliteClaimCommand(
            fixture: fixture,
            eventID: "event_sqlite_claim_concurrent_same_b",
            turnID: "delivery_turn_concurrent_same"
        )
        let routingA = fixture.routingA
        let routingB = fixture.routingB

        let outcomes = await runOverlappingSQLiteClaims(
            { try routingA.routeQueuedActionContextClaim(commandA) },
            { try routingB.routeQueuedActionContextClaim(commandB) }
        )
        #expect(outcomes.count == 2)
        for outcome in outcomes {
            guard case let .success(actionJSON) = outcome else {
                Issue.record("same-turn claim must recover through both routing instances")
                continue
            }
            #expect(actionJSON == fixture.actionJSON)
        }
        #expect(try sqliteClaimEvents(fixture.journalA.load()).count == 1)
    }
}

@Test("two SQLite routing instances allow only one different-turn claim")
func sqliteQueuedActionClaimConcurrentDifferentTurnsHasOneWinner() async throws {
    try await withSQLiteClaimFixture("concurrent_different") { fixture in
        let commandA = try sqliteClaimCommand(
            fixture: fixture,
            eventID: "event_sqlite_claim_concurrent_different_a",
            turnID: "delivery_turn_concurrent_a"
        )
        let commandB = try sqliteClaimCommand(
            fixture: fixture,
            eventID: "event_sqlite_claim_concurrent_different_b",
            turnID: "delivery_turn_concurrent_b"
        )
        let routingA = fixture.routingA
        let routingB = fixture.routingB

        let outcomes = await runOverlappingSQLiteClaims(
            { try routingA.routeQueuedActionContextClaim(commandA) },
            { try routingB.routeQueuedActionContextClaim(commandB) }
        )
        let successes = outcomes.compactMap { outcome -> Data? in
            guard case let .success(data) = outcome else { return nil }
            return data
        }
        let failures = outcomes.compactMap { outcome -> String? in
            guard case let .failure(code) = outcome else { return nil }
            return code
        }
        #expect(successes == [fixture.actionJSON])
        #expect(failures == ["queued_action_context_already_claimed"])
        let claims = try sqliteClaimEvents(fixture.journalB.load())
        #expect(claims.count == 1)
        let firstClaim = try #require(claims.first)
        let payload = try #require(firstClaim["payload"] as? [String: Any])
        let winningTurn = payload["delivery_turn_id"] as? String
        #expect(
            winningTurn == "delivery_turn_concurrent_a"
                || winningTurn == "delivery_turn_concurrent_b"
        )
    }
}

private struct SQLiteReceiptPhaseSample {
    let elapsedSeconds: Double
    let counts: SQLiteClaimIOCounts
}

@Test("SQLite queued claims retain full scans while preparing history only once per scan")
func sqliteQueuedClaimValidationWorkIsOperationLocal() throws {
    let fixture = try makeSQLiteClaimFixture("validation_work", closedHistoryPairs: 12)
    defer { fixture.remove() }
    let before = try fixture.journalA.load()
    let meter = fixture.meter
    let semantic = CoordinatorSemanticApplication(
        journal: SQLiteClaimMeteredJournal(journal: fixture.journalA, meter: meter),
        workObserver: { meter.observe($0) }
    )
    let command = try sqliteClaimCommand(
        fixture: fixture, eventID: "event_validation_work_claim", turnID: "turn_validation_work"
    )
    meter.start()
    let first = try semantic.execute(command: command)
    let io = meter.stop()
    let work = meter.measuredWork()
    #expect(first.commit.eventCount == 1)
    #expect(io == SQLiteClaimIOCounts(
        publicLoads: 1, publicAppends: 1, appendedEventCounts: [1],
        freshnessLoads: 3, freshnessCAS: 2
    ))
    // Authority, preappend and postcommit all authenticate complete history.
    // Before the fix the preappend history was parsed a fourth time; the new
    // row is still prepared once on ingress and once on postcommit validation.
    #expect(work.fullValidationScans == 3)
    #expect(work.eventPreparations == 3 * before.events.count + 2)
    #expect(work.documentPreparations == 3 * before.documents.count)
    #expect(work.verificationPreparations == 3 * before.verificationRecords.count)
    #expect(work.fullReplayEvents == [before.events.count])
    #expect(work.incrementalEvents == [1])
    #expect(work.validationNanoseconds.count == 3)
    #expect(work.fullReplayNanoseconds.count == 1)
    #expect(work.incrementalNanoseconds.count == 1)

    meter.start()
    let retry = try semantic.execute(command: command)
    let retryIO = meter.stop()
    let retryWork = meter.measuredWork()
    #expect(retry.commit.eventCount == 0)
    #expect(retryIO == SQLiteClaimIOCounts(publicLoads: 1, freshnessLoads: 1))
    #expect(retryWork.fullValidationScans == 1)
    #expect(retryWork.eventPreparations == before.events.count + 1)
    #expect(retryWork.fullReplayEvents == [before.events.count + 1])
    #expect(retryWork.incrementalEvents.isEmpty)

    var otherSession = try sqliteClaimObject(command)
    var wrongBinding = fixture.binding
    wrongBinding["session_id"] = "session_validation_work_other"
    otherSession["binding"] = wrongBinding
    sqliteClaimExpectCode("decision_boundary_binding_mismatch") {
        _ = try semantic.execute(command: sqliteClaimData(otherSession))
    }
    var wrongDigest = try sqliteClaimObject(command)
    wrongDigest["queued_prompt_sha256"] = "sha256:" + String(repeating: "c", count: 64)
    sqliteClaimExpectCode("queued_action_context_claim_mismatch") {
        _ = try semantic.execute(command: sqliteClaimData(wrongDigest))
    }
    #expect(try sqliteClaimEvents(fixture.journalB.load()).count == 1)
}

@Test("SQLite competing writer invalidates a projected queued claim before effects escape")
func sqliteQueuedClaimIncrementalProjectionReloadsAfterWriterChange() throws {
    let fixture = try makeSQLiteClaimFixture("projection_writer")
    defer { fixture.remove() }
    let meter = fixture.meter
    let semantic = CoordinatorSemanticApplication(
        journal: fixture.journalA, workObserver: { meter.observe($0) }
    )
    let stale = try semantic.authorityProjection()
    let winner = try sqliteClaimCommand(
        fixture: fixture, eventID: "event_projection_writer_winner", turnID: "turn_projection_writer_winner"
    )
    _ = try CoordinatorSemanticApplication(journal: fixture.journalB).execute(command: winner)
    meter.start()
    sqliteClaimExpectCode("queued_action_context_already_claimed") {
        _ = try semantic.execute(command: sqliteClaimCommand(
            fixture: fixture,
            eventID: "event_projection_writer_loser",
            turnID: "turn_projection_writer_loser"
        ), using: stale)
    }
    _ = meter.stop()
    let work = meter.measuredWork()
    #expect(work.fullValidationScans == 2) // Rejected append, then fresh authority.
    #expect(work.incrementalEvents == [1])
    #expect(work.fullReplayEvents == [stale.snapshot.events.count + 1])
    let snapshot = try fixture.journalA.load()
    #expect(snapshot.journalSequence == stale.state.eventSequence + 1)
    #expect(try sqliteClaimEvents(snapshot).count == 1)
}

@Test("queued delivery applies its three events without replaying the verified prefix again")
func sqliteQueuedDeliveryUsesOneFullSemanticReplay() throws {
    // Commit before opening routingB: a real second service startup must keep
    // its fail-closed recovery of otherwise unterminated continuations.
    let fixture = try makeSQLiteClaimFixture("delivery_replay", closedHistoryPairs: 12) { journal, routing, meter, completion, close in
        let before = try journal.load()
        let state = try routing.authoritativeState()
        let continuationID = "continuation_sqlite_claim_delivery_replay"
        let action = try state.selectedActionJSON(for: continuationID)
        let semantic = CoordinatorSemanticApplication(
            journal: SQLiteClaimMeteredJournal(journal: journal, meter: meter),
            workObserver: { meter.observe($0) }
        )
        let claim = try sqliteClaimData([
            "type": "claim_queued_action_context", "event_id": "event_delivery_replay_claim",
            "occurred_at": "2026-08-21T12:00:04Z",
            "binding": sqliteClaimBinding("delivery_replay"), "continuation_id": continuationID,
            "delivery_turn_id": "turn_delivery_replay",
            "queued_prompt_sha256": "sha256:" + String(repeating: "a", count: 64),
            "cwd_sha256": "sha256:" + String(repeating: "b", count: 64),
            "action_sha256": CoordinatorSHA256.fingerprint(action),
        ])
        meter.start()
        let result = try semantic.executeQueuedActionDelivery(
            commands: [completion, close, claim], using: semantic.authorityProjection()
        )
        let io = meter.stop()
        let work = meter.measuredWork()
        #expect(result.commit.eventCount == 3)
        #expect(io == SQLiteClaimIOCounts(
            publicLoads: 1, publicAppends: 1, appendedEventCounts: [3],
            freshnessLoads: 3, freshnessCAS: 2
        ))
        #expect(work.fullValidationScans == 3)
        #expect(work.eventPreparations == 3 * before.events.count + 6)
        #expect(work.fullReplayEvents == [before.events.count])
        #expect(work.incrementalEvents == [1, 1, 1])
    }
    defer { fixture.remove() }
    let after = try fixture.journalB.load()
    #expect(try sqliteClaimEvents(after).count == 1)
    let state = try CoordinatorSemanticReplay.replay(after)
    #expect(state.continuation(id: fixture.continuationID)?.workOutcome == nil)
    #expect(try state.selectedActionJSON(for: fixture.continuationID) == fixture.actionJSON)
}

private func sqliteReceiptMeasure(
    _ meter: SQLiteClaimIOMeter,
    _ operation: () throws -> Void
) throws -> SQLiteReceiptPhaseSample {
    meter.start()
    let started = DispatchTime.now().uptimeNanoseconds
    do {
        try operation()
    } catch {
        _ = meter.stop()
        throw error
    }
    let elapsed = DispatchTime.now().uptimeNanoseconds - started
    return SQLiteReceiptPhaseSample(
        elapsedSeconds: Double(elapsed) / 1_000_000_000,
        counts: meter.stop()
    )
}

private func sqliteReceiptExercise(
    closedHistoryPairs: Int,
    atomic: Bool
) throws -> (completion: SQLiteReceiptPhaseSample, claim: SQLiteReceiptPhaseSample) {
    let mode = atomic ? "atomic" : "sequential"
    let suffix = "receipt_\(closedHistoryPairs)_\(mode)"
    var completionSample: SQLiteReceiptPhaseSample?
    var sequenceBeforeCompletion: Int64 = 0
    let fixture = try makeSQLiteClaimFixture(
        suffix,
        closedHistoryPairs: closedHistoryPairs
    ) { _, routing, meter, completion, originalClose in
        let before = try routing.authoritativeState()
        sequenceBeforeCompletion = before.eventSequence
        let continuation = try #require(before.continuation(id: "continuation_sqlite_claim_\(suffix)"))
        #expect(continuation.consumedAt != nil)
        #expect(continuation.transport == nil)
        var close = try sqliteClaimObject(originalClose)
        close["close_reason"] = "transport_terminal_observed"
        let closeData = try sqliteClaimData(close)
        completionSample = try sqliteReceiptMeasure(meter) {
            if atomic {
                try routing.completeTransportAndCloseBoundary(completion, close: closeData)
            } else {
                _ = try routing.executeCommand(completion)
                _ = try routing.executeCommand(closeData)
            }
        }
    }
    defer { fixture.remove() }

    let snapshot = try fixture.journalA.load()
    #expect(sequenceBeforeCompletion == Int64(closedHistoryPairs * 2) + 5)
    #expect(snapshot.journalSequence == sequenceBeforeCompletion + 2)
    let terminalEvents = try snapshot.events.suffix(2).map(sqliteClaimObject)
    #expect(terminalEvents.compactMap { $0["event_type"] as? String } == [
        "continuation_transport_completed", "decision_boundary_closed",
    ])
    let state = try CoordinatorSemanticReplay.replay(snapshot)
    let continuation = try #require(state.continuation(id: fixture.continuationID))
    #expect(continuation.transport?.status == .completed)
    #expect(continuation.transport?.workOutcomeStatus == nil)
    #expect(continuation.workOutcome == nil)
    #expect(continuation.queuedActionContextClaim == nil)
    #expect(state.boundary(for: continuation.binding)?.closeReason == "transport_terminal_observed")
    #expect(state.boundaries.values.filter(\.closed).count == closedHistoryPairs + 1)

    let claim = try sqliteClaimCommand(
        fixture: fixture,
        eventID: "event_sqlite_claim_\(suffix)_claim",
        turnID: "delivery_turn_\(suffix)"
    )
    var claimedAction = Data()
    let claimSample = try sqliteReceiptMeasure(fixture.meter) {
        claimedAction = try fixture.routingA.routeQueuedActionContextClaim(claim)
    }
    #expect(claimedAction == fixture.actionJSON)
    #expect(claimSample.counts == SQLiteClaimIOCounts(
        publicLoads: 1, publicAppends: 1, appendedEventCounts: [1],
        freshnessLoads: 3, freshnessCAS: 2
    ))

    // Reopen happened after completion. A second routing instance must recover
    // the same durable delivery tuple without another append or action outcome.
    let sameTurn = try sqliteClaimCommand(
        fixture: fixture,
        eventID: "event_sqlite_claim_\(suffix)_recovered",
        turnID: "delivery_turn_\(suffix)"
    )
    var recoveredAction = Data()
    let recoverySample = try sqliteReceiptMeasure(fixture.meter) {
        recoveredAction = try fixture.routingB.routeQueuedActionContextClaim(sameTurn)
    }
    #expect(recoveredAction == fixture.actionJSON)
    #expect(recoverySample.counts == SQLiteClaimIOCounts(publicLoads: 1, freshnessLoads: 1))

    let otherTurn = try sqliteClaimCommand(
        fixture: fixture,
        eventID: "event_sqlite_claim_\(suffix)_other_turn",
        turnID: "delivery_turn_\(suffix)_other"
    )
    let rejectionSample = try sqliteReceiptMeasure(fixture.meter) {
        sqliteClaimExpectCode("queued_action_context_already_claimed") {
            _ = try fixture.routingB.routeQueuedActionContextClaim(otherTurn)
        }
    }
    #expect(rejectionSample.counts == SQLiteClaimIOCounts(publicLoads: 1, freshnessLoads: 1))
    let afterClaims = try fixture.journalA.load()
    #expect(afterClaims.journalSequence == snapshot.journalSequence + 1)
    #expect(try sqliteClaimEvents(afterClaims).count == 1)
    let finalState = try CoordinatorSemanticReplay.replay(afterClaims)
    #expect(finalState.continuation(id: fixture.continuationID)?.workOutcome == nil)

    let measuredCompletion = try #require(completionSample)
    for (phase, sample) in [("completion", measuredCompletion), ("claim", claimSample)] {
        print(
            "SQLITE_RECEIPT_BENCHMARK mode=\(mode) phase=\(phase)"
                + " history_events=\(closedHistoryPairs * 2) freshness_backend=in_memory"
                + " elapsed_ms=\(String(format: "%.3f", sample.elapsedSeconds * 1_000))"
                + " public_loads=\(sample.counts.publicLoads)"
                + " public_appends=\(sample.counts.publicAppends)"
                + " freshness_loads=\(sample.counts.freshnessLoads)"
                + " freshness_cas=\(sample.counts.freshnessCAS)"
        )
    }
    return (measuredCompletion, claimSample)
}

private func sqliteReceiptCompare(closedHistoryPairs: Int) throws {
    let baseline = try sqliteReceiptExercise(closedHistoryPairs: closedHistoryPairs, atomic: false)
    let atomic = try sqliteReceiptExercise(closedHistoryPairs: closedHistoryPairs, atomic: true)
    #expect(baseline.completion.counts.publicAppends == 2)
    #expect(baseline.completion.counts.appendedEventCounts == [1, 1])
    #expect(baseline.completion.counts.freshnessCAS == 4)
    #expect(atomic.completion.counts == SQLiteClaimIOCounts(
        publicLoads: 1, publicAppends: 1, appendedEventCounts: [2],
        freshnessLoads: 3, freshnessCAS: 2
    ))
    #expect(atomic.completion.counts.publicLoads < baseline.completion.counts.publicLoads)
    #expect(atomic.completion.counts.freshnessLoads < baseline.completion.counts.freshnessLoads)
    #expect(atomic.claim.counts == baseline.claim.counts)
}

@Test("SQLite receipt completion batches two events and preserves durable claim isolation")
func sqliteReceiptCompletionBatchPreservesQueuedClaim() throws {
    try sqliteReceiptCompare(closedHistoryPairs: 0)
}

// Opt in for an isolated large-journal measurement; timing is evidence only,
// never a pass/fail threshold and never a measurement of live Keychain latency.
@Test(
    "SQLite receipt completion benchmark with 1200 closed-history events",
    .enabled(if: ProcessInfo.processInfo.environment["BLABEE_SQLITE_RECEIPT_BENCHMARK"] == "1")
)
func sqliteReceiptCompletionBenchmarkWithClosedHistory() throws {
    try sqliteReceiptCompare(closedHistoryPairs: 600)
}

private struct SQLitePacketClaimLifecycle {
    let snapshot: JournalSnapshot
    let completion: Data
    let close: Data
    let claim: Data
    let continuationID: String
    let actionJSON: Data
}

/// Builds only synthetic persisted bytes. Fingerprints identify fixture text;
/// no production token, database, storage key, or Keychain item is consulted.
private func sqlitePacketClaimLifecycle(
    suffix: String,
    firstSequence: Int64,
    completed: Bool,
    claimed: Bool,
    padded: Bool
) throws -> SQLitePacketClaimLifecycle {
    let binding = sqliteClaimBinding(suffix)
    var packet = try sqliteClaimPacket(
        suffix: suffix, binding: binding,
        validAfterEventSequence: firstSequence + 1, rankedActions: true
    )
    var choices = try #require(packet["choices"] as? [[String: Any]])
    if padded {
        packet["summary"] = String(repeating: "s", count: 4_096)
        for index in choices.indices {
            var action = try #require(choices[index]["action"] as? [String: Any])
            action["objective"] = String(repeating: "o", count: 1_024)
            choices[index]["action"] = action
        }
        packet["choices"] = choices
    }
    let choice = try #require(choices.first)
    let actionJSON = try sqliteClaimData(try #require(choice["action"] as? [String: Any]))
    let continuationID = "continuation_sqlite_claim_\(suffix)"
    func eventID(_ type: String) -> String { "event_sqlite_claim_\(suffix)_\(type)" }
    var events: [Data] = []
    func appendEvent(_ type: String, second: Int, payload: [String: Any]) throws {
        var object = binding
        object["schema_version"] = "1.0"
        object["kind"] = "blabee_runtime_event"
        object["event_id"] = eventID(type)
        object["event_sequence"] = firstSequence + Int64(events.count)
        object["event_type"] = type
        object["event_category"] = type.hasPrefix("decision_") ? "decision_lifecycle" : "transport"
        object["occurred_at"] = String(format: "2026-08-21T12:00:%02dZ", second)
        object["payload"] = payload
        events.append(try sqliteClaimData(object))
    }
    try appendEvent("decision_boundary_opened", second: 0, payload: ["proposal_id": "proposal_\(suffix)"])
    try appendEvent("decision_packet_sealed", second: 1, payload: [
        "interaction_id": packet["interaction_id"]!, "packet_id": packet["packet_id"]!,
        "revision": 1, "expires_at": packet["expires_at"]!,
    ])
    try appendEvent("decision_selection_claimed", second: 2, payload: [
        "selection_id": "selection_\(suffix)", "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!, "revision": 1, "option_id": choice["option_id"]!,
    ])
    try appendEvent("continuation_dispatched", second: 2, payload: [
        "continuation_id": continuationID, "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!, "revision": 1,
        "option_id": choice["option_id"]!, "action_id": choice["action_id"]!,
        "dispatch_mode": "queued_next_turn", "queued_action_context_claim_protocol": "v1",
        "issued_at": "2026-08-21T12:00:02Z", "expires_at": "2026-08-21T12:02:02Z",
        "in_flight_deadline_at": "2026-08-21T12:05:02Z",
    ])
    try appendEvent("continuation_consumed", second: 3, payload: [
        "continuation_id": continuationID, "dispatch_mode": "queued_next_turn",
    ])
    if completed {
        try appendEvent("continuation_transport_completed", second: 4, payload: [
            "continuation_id": continuationID, "transport_status": "completed",
            "work_outcome_status": "not_recorded",
        ])
        try appendEvent("decision_boundary_closed", second: 5, payload: [
            "close_reason": "queued_transport_completed",
        ])
    }
    let claimPayload: [String: Any] = [
        "continuation_id": continuationID, "delivery_turn_id": "delivery_\(suffix)",
        "queued_prompt_sha256": CoordinatorSHA256.fingerprint(Data("fixture_prompt_\(suffix)".utf8)),
        "cwd_sha256": CoordinatorSHA256.fingerprint(Data("fixture_cwd_\(suffix)".utf8)),
        "action_sha256": CoordinatorSHA256.fingerprint(actionJSON),
    ]
    if claimed { try appendEvent("queued_action_context_claimed", second: 6, payload: claimPayload) }
    var verification = binding
    verification.merge([
        "schema_version": "1.0", "kind": "blabee_continuation_verification_record",
        "dispatch_event_id": eventID("continuation_dispatched"), "continuation_id": continuationID,
        "interaction_id": packet["interaction_id"]!, "packet_id": packet["packet_id"]!,
        "revision": 1, "option_id": choice["option_id"]!, "action_id": choice["action_id"]!,
        "correlation_token_fingerprint": CoordinatorSHA256.fingerprint(Data("fixture_fingerprint_\(suffix)".utf8)),
    ]) { _, replacement in replacement }
    let completion = try sqliteClaimData([
        "type": "complete_transport", "event_id": eventID("continuation_transport_completed"),
        "occurred_at": "2026-08-21T12:00:04Z", "binding": binding, "continuation_id": continuationID,
    ])
    let close = try sqliteClaimData([
        "type": "close_boundary", "event_id": eventID("decision_boundary_closed"),
        "occurred_at": "2026-08-21T12:00:05Z", "binding": binding,
        "close_reason": "queued_transport_completed",
    ])
    var claim = claimPayload
    claim.merge([
        "type": "claim_queued_action_context", "event_id": eventID("queued_action_context_claimed"),
        "occurred_at": "2026-08-21T12:00:06Z", "binding": binding,
    ]) { _, replacement in replacement }
    return SQLitePacketClaimLifecycle(
        snapshot: JournalSnapshot(
            events: events, documents: [try sqliteClaimData(packet)],
            verificationRecords: [try sqliteClaimData(verification)],
            journalSequence: firstSequence + Int64(events.count) - 1
        ),
        completion: completion, close: close, claim: try sqliteClaimData(claim),
        continuationID: continuationID, actionJSON: actionJSON
    )
}

private func sqlitePacketClaimHistory(
    packetCount: Int,
    closedOnlyPairs: Int,
    padded: Bool
) throws -> JournalSnapshot {
    var events = try sqliteClaimClosedHistory(suffix: "packet_rich", pairCount: closedOnlyPairs)
    var documents: [Data] = []
    var verifications: [Data] = []
    for index in 0..<packetCount {
        let lifecycle = try sqlitePacketClaimLifecycle(
            suffix: "packet_history_\(index)", firstSequence: Int64(events.count) + 1,
            completed: true, claimed: true, padded: padded
        )
        events += lifecycle.snapshot.events
        documents += lifecycle.snapshot.documents
        verifications += lifecycle.snapshot.verificationRecords
    }
    return JournalSnapshot(
        events: events, documents: documents, verificationRecords: verifications,
        journalSequence: Int64(events.count)
    )
}

@discardableResult
private func sqlitePacketClaimExercise(
    history: JournalSnapshot,
    preReceipt: Bool,
    benchmark: Bool
) throws -> SQLiteClaimWorkCounts {
    let mode = preReceipt ? "pre_receipt_delivery" : "post_receipt_claim"
    let target = try sqlitePacketClaimLifecycle(
        suffix: mode, firstSequence: history.journalSequence + 1,
        completed: !preReceipt, claimed: false, padded: false
    )
    let seed = JournalSnapshot(
        events: history.events + target.snapshot.events,
        documents: history.documents + target.snapshot.documents,
        verificationRecords: history.verificationRecords + target.snapshot.verificationRecords,
        journalSequence: target.snapshot.journalSequence
    )
    let initialState = try CoordinatorSemanticReplay.replay(seed)
    #expect(try initialState.selectedActionJSON(for: target.continuationID) == target.actionJSON)
    #expect(initialState.continuation(id: target.continuationID)?.queuedActionContextClaim == nil)
    let directory = try sqliteClaimTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let meter = SQLiteClaimIOMeter()
    let freshness = SQLiteClaimFreshnessStore(meter: meter)
    let journal = try SQLiteJournal(
        databaseURL: directory.appendingPathComponent("journal.sqlite"),
        keyURL: directory.appendingPathComponent("journal.key"), freshnessStore: freshness,
        workObserver: { meter.observe($0) }
    )
    // All fixture setup stays outside the measured span and uses one append.
    _ = try journal.append(
        expectedSequence: 0, events: seed.events, documents: seed.documents,
        verificationRecords: seed.verificationRecords
    )
    let semantic = CoordinatorSemanticApplication(
        journal: SQLiteClaimMeteredJournal(journal: journal, meter: meter),
        workObserver: { meter.observe($0) }
    )
    let appendedCount = preReceipt ? 3 : 1
    let sample = try sqliteReceiptMeasure(meter) {
        let result: CoordinatorSemanticExecutionResult
        if preReceipt {
            result = try semantic.executeQueuedActionDelivery(
                commands: [target.completion, target.close, target.claim],
                using: semantic.authorityProjection()
            )
        } else {
            result = try semantic.execute(command: target.claim)
        }
        #expect(result.commit.eventCount == appendedCount)
        #expect(result.commit.lastSequence == seed.journalSequence + Int64(appendedCount))
    }
    let work = meter.measuredWork()
    #expect(sample.counts == SQLiteClaimIOCounts(
        publicLoads: 1, publicAppends: 1, appendedEventCounts: [appendedCount],
        freshnessLoads: 3, freshnessCAS: 2
    ))
    #expect(work.fullValidationScans == 3)
    #expect(work.eventPreparations == 3 * seed.events.count + 2 * appendedCount)
    #expect(work.documentPreparations == 3 * seed.documents.count)
    #expect(work.verificationPreparations == 3 * seed.verificationRecords.count)
    #expect(work.fullReplayEvents == [seed.events.count])
    #expect(work.incrementalEvents == Array(repeating: 1, count: appendedCount))
    let after = try journal.load()
    let state = try CoordinatorSemanticReplay.replay(after)
    let continuation = try #require(state.continuation(id: target.continuationID))
    #expect(continuation.transport?.status == .completed)
    #expect(continuation.workOutcome == nil)
    #expect(continuation.queuedActionContextClaim?.deliveryTurnID == "delivery_\(mode)")
    #expect(try state.selectedActionJSON(for: target.continuationID) == target.actionJSON)
    #expect(try sqliteClaimEvents(after).count == history.verificationRecords.count + 1)
    if benchmark {
        let payloadBytes = (seed.events + seed.documents + seed.verificationRecords).reduce(0) { $0 + $1.count }
        func milliseconds(_ values: [UInt64]) -> String {
            String(format: "%.3f", Double(values.reduce(0, +)) / 1_000_000)
        }
        print(
            "SQLITE_QUEUED_CLAIM_BENCHMARK mode=\(mode) scope=semantic_and_sqlite"
                + " history_events=\(history.events.count) seed_events=\(seed.events.count)"
                + " packets=\(seed.documents.count) verifications=\(seed.verificationRecords.count)"
                + " canonical_payload_bytes=\(payloadBytes) freshness_backend=in_memory"
                + " elapsed_ms=\(String(format: "%.3f", sample.elapsedSeconds * 1_000))"
                + " validation_ms=\(milliseconds(work.validationNanoseconds))"
                + " replay_ms=\(milliseconds(work.fullReplayNanoseconds))"
                + " incremental_ms=\(milliseconds(work.incrementalNanoseconds))"
                + " full_scans=\(work.fullValidationScans) event_preparations=\(work.eventPreparations)"
                + " document_preparations=\(work.documentPreparations) verification_preparations=\(work.verificationPreparations)"
                + " strict_json_decodes=\(work.strictJSONDecodingPasses) sidecar_candidates=\(work.sidecarCandidates)"
                + " public_loads=\(sample.counts.publicLoads) public_appends=\(sample.counts.publicAppends)"
                + " freshness_loads=\(sample.counts.freshnessLoads) freshness_cas=\(sample.counts.freshnessCAS)"
        )
    }
    return work
}

@Test("SQLite queued claims validate packet and continuation history per operation", arguments: [false, true])
func sqliteQueuedClaimWorkWithPacketRichHistory(preReceipt: Bool) throws {
    let history = try sqlitePacketClaimHistory(packetCount: 4, closedOnlyPairs: 2, padded: false)
    let work = try sqlitePacketClaimExercise(history: history, preReceipt: preReceipt, benchmark: false)
    // Ingress and canonical bytes both retain their strict gate. Reusing the
    // already decoded ingress object must not add a third decoding pass.
    #expect(work.strictJSONDecodingPasses == 2 * (work.eventPreparations + work.documentPreparations)
        + work.verificationPreparations)
    // Each of seven bidirectional sidecar relationships inspects exactly one
    // candidate for each history packet and the target, on every full scan.
    #expect(work.sidecarCandidates == 7 * (history.documents.count + 1) * work.fullValidationScans)
}

// Timings are comparative evidence, not a timing assertion or a claim about
// actor wait, UDS transport, startup, or the live Keychain backend.
@Test(
    "SQLite queued claim benchmark with 2500 events and packet-rich 5-8 MiB history",
    .enabled(if: ProcessInfo.processInfo.environment["BLABEE_SQLITE_QUEUED_CLAIM_BENCHMARK"] == "1")
)
func sqliteQueuedClaimBenchmarkWithPacketRichHistory() throws {
    let history = try sqlitePacketClaimHistory(packetCount: 300, closedOnlyPairs: 50, padded: true)
    let bytes = (history.events + history.documents + history.verificationRecords).reduce(0) { $0 + $1.count }
    #expect(history.events.count == 2_500)
    #expect(history.documents.count == 300 && history.verificationRecords.count == 300)
    #expect((5 * 1_024 * 1_024...8 * 1_024 * 1_024).contains(bytes))
    for preReceipt in [false, true] {
        try sqlitePacketClaimExercise(history: history, preReceipt: preReceipt, benchmark: true)
    }
}

/// Synthetic history is validated in memory and seeded in one SQLite batch.
/// No production database, storage key, or Keychain item is consulted.
private func sqliteDismissalHistory(packetCount: Int, closedOnlyCount: Int) throws -> JournalSnapshot {
    var events: [Data] = []
    var documents: [Data] = []
    for index in 0..<(packetCount + closedOnlyCount) {
        let suffix = "dismiss_history_\(index)"
        let binding = sqliteClaimBinding(suffix)
        var event = binding
        event["schema_version"] = "1.0"
        event["kind"] = "blabee_runtime_event"
        event["event_category"] = "decision_lifecycle"
        event["event_id"] = "event_\(suffix)_open"
        event["event_sequence"] = events.count + 1
        event["event_type"] = "decision_boundary_opened"
        event["occurred_at"] = "2026-08-21T12:00:00Z"
        event["payload"] = ["proposal_id": "proposal_\(suffix)"]
        events.append(try sqliteClaimData(event))
        if index < packetCount {
            let packet = try sqliteClaimPacket(
                suffix: suffix, binding: binding,
                validAfterEventSequence: Int64(events.count) + 1, rankedActions: true
            )
            documents.append(try sqliteClaimData(packet))
            event["event_id"] = "event_\(suffix)_seal"
            event["event_sequence"] = events.count + 1
            event["event_type"] = "decision_packet_sealed"
            event["occurred_at"] = packet["sealed_at"]
            event["payload"] = [
                "interaction_id": packet["interaction_id"]!,
                "packet_id": packet["packet_id"]!, "revision": packet["revision"]!,
                "expires_at": packet["expires_at"]!,
            ]
            events.append(try sqliteClaimData(event))
        }
        event["event_id"] = "event_\(suffix)_close"
        event["event_sequence"] = events.count + 1
        event["event_type"] = "decision_boundary_closed"
        event["occurred_at"] = "2026-08-21T12:00:02Z"
        event["payload"] = ["close_reason": "user_dismissed"]
        events.append(try sqliteClaimData(event))
    }
    let snapshot = JournalSnapshot(
        events: events, documents: documents, verificationRecords: [],
        journalSequence: Int64(events.count)
    )
    _ = try CoordinatorSemanticReplay.replay(snapshot)
    return snapshot
}

@Test("SQLite dismissal uses one authenticated projection with 2000 events and 320 packets", arguments: [0, 320])
func sqliteDismissalJournalBudgetWithAuthenticatedHistory(packetHistoryCount: Int) throws {
    let directory = try sqliteClaimTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let meter = SQLiteClaimIOMeter()
    let freshness = SQLiteClaimFreshnessStore(meter: meter)
    let journal = try SQLiteJournal(
        databaseURL: directory.appendingPathComponent("journal.sqlite"),
        keyURL: directory.appendingPathComponent("journal.key"), freshnessStore: freshness
    )
    let history = try sqliteDismissalHistory(
        packetCount: packetHistoryCount, closedOnlyCount: packetHistoryCount == 0 ? 0 : 520
    )
    if !history.events.isEmpty {
        _ = try journal.append(
            expectedSequence: 0, events: history.events, documents: history.documents
        )
    }
    let routing = try CoordinatorRoutingApplication(
        journal: SQLiteClaimMeteredJournal(journal: journal, meter: meter),
        clock: SQLiteClaimClock(), eventIDGenerator: SQLiteClaimIDs(prefix: "dismiss_budget").next
    )
    var samples: [(String, SQLiteReceiptPhaseSample)] = []
    for optimized in [false, true] {
        let mode = optimized ? "single_projection" : "previous_read_close_read"
        let suffix = "dismiss_\(mode)"
        let binding = sqliteClaimBinding(suffix)
        let sequenceBefore = try journal.load().journalSequence
        let packet = try sqliteClaimPacket(
            suffix: suffix, binding: binding,
            validAfterEventSequence: sequenceBefore + 2, rankedActions: true
        )
        _ = try routing.executeCommand(sqliteClaimData([
            "type": "open_boundary", "event_id": "event_\(suffix)_open",
            "occurred_at": "2026-08-21T12:00:00Z", "binding": binding,
            "proposal_id": "proposal_\(suffix)",
        ]))
        _ = try routing.executeCommand(sqliteClaimData([
            "type": "seal_packet", "event_id": "event_\(suffix)_seal", "packet": packet,
        ]))
        var request = binding
        request["interaction_id"] = packet["interaction_id"]
        request["packet_id"] = packet["packet_id"]
        request["revision"] = packet["revision"]
        let requestData = try sqliteClaimData(request)
        let close = try sqliteClaimData([
            "type": "close_boundary", "event_id": "event_\(suffix)_close",
            "occurred_at": "2026-08-21T12:00:02Z", "binding": binding,
            "close_reason": "user_dismissed",
        ])
        let sample = try sqliteReceiptMeasure(meter) {
            if optimized {
                try routing.dismissInteraction(requestData, closingWith: close, allowNonHead: false) {}
            } else {
                // Reproduce the previous verified read/close/read sequence
                // for comparison, outside the production dismissal entrypoint.
                _ = try routing.authoritativeState()
                _ = try routing.executeCommand(close)
                _ = try routing.authoritativeState()
            }
        }
        samples.append((mode, sample))
        #expect(sample.counts == SQLiteClaimIOCounts(
            publicLoads: optimized ? 1 : 5, publicAppends: 1, appendedEventCounts: [1],
            freshnessLoads: optimized ? 3 : 7, freshnessCAS: 2
        ))
        let snapshot = try journal.load()
        #expect(snapshot.journalSequence == sequenceBefore + 3)
        #expect(snapshot.documents.count == history.documents.count + (optimized ? 2 : 1))
        let state = try CoordinatorSemanticReplay.replay(snapshot)
        let boundary = try #require(state.boundary(for: CoordinatorBinding(jsonObject: binding)))
        #expect(boundary.closed && boundary.closeReason == "user_dismissed" && boundary.selection == nil)
        #expect(state.continuations.isEmpty)
        if optimized {
            let retry = try sqliteReceiptMeasure(meter) {
                try routing.dismissInteraction(requestData, closingWith: close, allowNonHead: false) {
                    Issue.record("An exact committed retry must not require a new pending card")
                }
            }
            samples.append(("exact_retry", retry))
            #expect(retry.counts == SQLiteClaimIOCounts(publicLoads: 1, freshnessLoads: 1))
            #expect(try journal.load() == snapshot)
        }
    }
    for (mode, sample) in samples {
        print(
            "SQLITE_DISMISS_BENCHMARK mode=\(mode) history_events=\(history.events.count)"
                + " history_packets=\(history.documents.count) freshness_backend=in_memory"
                + " elapsed_ms=\(String(format: "%.3f", sample.elapsedSeconds * 1_000))"
                + " public_loads=\(sample.counts.publicLoads) public_appends=\(sample.counts.publicAppends)"
                + " freshness_loads=\(sample.counts.freshnessLoads) freshness_cas=\(sample.counts.freshnessCAS)"
        )
    }
}
