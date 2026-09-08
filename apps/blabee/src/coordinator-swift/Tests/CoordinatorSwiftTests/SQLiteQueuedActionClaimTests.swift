import Foundation
import Testing
@testable import CoordinatorSwift

private let sqliteClaimRepositoryRoot: URL = {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
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

/// Enabled only around the operation under measurement, excluding fixture
/// creation, journal reopen, and assertions. Freshness uses memory, not Keychain.
private final class SQLiteClaimIOMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var recording = false
    private var counts = SQLiteClaimIOCounts()

    func start() {
        lock.lock()
        defer { lock.unlock() }
        counts = SQLiteClaimIOCounts()
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
        meter.record {
            $0.publicAppends += 1
            $0.appendedEventCounts.append(events.count)
        }
        return try journal.append(
            expectedSequence: expectedSequence, events: events,
            documents: documents, verificationRecords: verificationRecords
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
    validAfterEventSequence: Int64 = 2
) throws -> [String: Any] {
    let source = sqliteClaimRepositoryRoot.appendingPathComponent(
        "Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json"
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
    packet["sealed_at"] = "2026-08-21T12:00:01Z"
    packet["expires_at"] = "2026-08-21T12:02:01Z"
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
    completeTransport: ((CoordinatorRoutingApplication, SQLiteClaimIOMeter, Data, Data) throws -> Void)? = nil
) throws -> SQLiteClaimFixture {
    let directory = try sqliteClaimTemporaryDirectory()
    let databaseURL = directory.appendingPathComponent("journal.sqlite")
    let keyURL = directory.appendingPathComponent("journal.key")
    let meter = SQLiteClaimIOMeter()
    let freshness = SQLiteClaimFreshnessStore(meter: meter)
    let journalA = try SQLiteJournal(
        databaseURL: databaseURL,
        keyURL: keyURL,
        freshnessStore: freshness
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
        try completeTransport(routingA, meter, completion, close)
    } else {
        _ = try routingA.executeCommand(completion)
        _ = try routingA.executeCommand(close)
    }
    let state = try routingA.authoritativeState()
    let actionJSON = try state.selectedActionJSON(for: continuationID)

    let journalB = try SQLiteJournal(
        databaseURL: databaseURL,
        keyURL: keyURL,
        freshnessStore: freshness
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
    ) { routing, meter, completion, originalClose in
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
