import Foundation
import Testing
@testable import CoordinatorSwift

private let routingRepositoryRoot: URL = {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
}()

private func routingData(_ object: Any) throws -> Data {
    try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
}

private func routingObject(_ data: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CoordinatorError("test_json_invalid")
    }
    return object
}

private func routingBinding(
    suffix: String,
    projectID: String? = nil,
    sessionID: String? = nil
) -> [String: Any] {
    [
        "project_id": projectID ?? "project_routing_\(suffix)",
        "session_id": sessionID ?? "session_routing_\(suffix)",
        "source_turn_id": "turn_routing_\(suffix)",
        "source_prompt_id": "prompt_routing_\(suffix)",
        "episode_id": "episode_routing_\(suffix)",
        "episode_root_prompt_id": "prompt_routing_\(suffix)",
        "episode_baseline_checkpoint_id": "checkpoint_routing_\(suffix)",
        "decision_boundary_id": "boundary_routing_\(suffix)",
        "boundary_sequence": 1,
    ]
}

private func routingPacket(
    binding: [String: Any],
    validAfter: Int,
    suffix: String,
    sealedAt: String
) throws -> [String: Any] {
    let source = routingRepositoryRoot.appendingPathComponent(
        "Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json"
    )
    guard var packet = try JSONSerialization.jsonObject(
        with: Data(contentsOf: source)
    ) as? [String: Any],
    var checkpoint = packet["checkpoint"] as? [String: Any],
    var choices = packet["choices"] as? [[String: Any]]
    else { throw CoordinatorError("test_fixture_invalid") }

    for (key, value) in binding { packet[key] = value }
    packet["interaction_id"] = "interaction_routing_\(suffix)"
    packet["packet_id"] = "packet_routing_\(suffix)"
    packet["revision"] = 1
    packet["valid_after_event_sequence"] = validAfter
    packet["sealed_at"] = sealedAt
    packet["expires_at"] = try RFC3339Instant(sealedAt)
        .adding(nanoseconds: CoordinatorRoutingApplication.expiryAfterNanoseconds)
        .rawValue
    checkpoint["id"] = binding["episode_baseline_checkpoint_id"]
    packet["checkpoint"] = checkpoint
    for index in choices.indices {
        choices[index]["option_id"] = "option_routing_\(suffix)_\(index + 1)"
        if choices[index]["action_id"] is String {
            choices[index]["action_id"] = "action_routing_\(suffix)_\(index + 1)"
        }
    }
    packet["choices"] = choices
    return packet
}

private func routingOpen(
    binding: [String: Any],
    suffix: String,
    occurredAt: String
) throws -> Data {
    try routingData([
        "type": "open_boundary",
        "event_id": "event_routing_\(suffix)_open",
        "occurred_at": occurredAt,
        "binding": binding,
        "proposal_id": "proposal_routing_\(suffix)",
    ])
}

private func routingSeal(packet: [String: Any], suffix: String) throws -> Data {
    try routingData([
        "type": "seal_packet",
        "event_id": "event_routing_\(suffix)_seal",
        "packet": packet,
    ])
}

private func routingInitialActivation(
    binding: [String: Any],
    packet: [String: Any],
    suffix: String,
    occurredAt: String
) throws -> Data {
    try routingData([
        "type": "activate_initial_boundary",
        "open_event_id": "event_routing_\(suffix)_open",
        "seal_event_id": "event_routing_\(suffix)_seal",
        "occurred_at": occurredAt,
        "binding": binding,
        "proposal_id": "proposal_routing_\(suffix)",
        "packet": packet,
    ])
}

private func routingTarget(
    packet: [String: Any],
    binding: [String: Any]
) throws -> Data {
    var target: [String: Any] = [
        "expected_state": "pending",
        "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!,
        "revision": packet["revision"]!,
    ]
    for (key, value) in binding { target[key] = value }
    return try routingData(target)
}

private func routingSelection(
    packet: [String: Any],
    binding: [String: Any],
    suffix: String,
    slot: Int = 1,
    externalOccurredAt: String = "2099-01-01T00:00:00Z"
) throws -> Data {
    guard let choices = packet["choices"] as? [[String: Any]] else {
        throw CoordinatorError("test_fixture_invalid")
    }
    var request: [String: Any] = [
        "schema_version": "1.0",
        "kind": "blabee_selection_request",
        "selection_id": "selection_routing_\(suffix)",
        "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!,
        "revision": packet["revision"]!,
        "option_id": choices[slot - 1]["option_id"]!,
    ]
    for (key, value) in binding { request[key] = value }
    return try routingData([
        "type": "select_option",
        "expected_state": "pending",
        "event_ids": [
            "selection_claimed": "event_routing_\(suffix)_selection",
            "continuation_dispatched": "event_routing_\(suffix)_dispatch",
            "decision_boundary_closed": "event_routing_\(suffix)_pause_close",
        ],
        "occurred_at": externalOccurredAt,
        "request": request,
        "continuation_id": "continuation_routing_\(suffix)",
        // These values are deliberately untrusted. B2 replaces them with its
        // fixed 120/300-second authority windows.
        "issued_at": externalOccurredAt,
        "expires_at": "2199-01-01T00:00:00Z",
        "in_flight_deadline_at": "2299-01-01T00:00:00Z",
    ])
}

private func routingEnvelope(
    _ result: CoordinatorSemanticExecutionResult
) throws -> [String: Any] {
    let effect = try routingObject(try #require(result.effects.first))
    return try #require(effect["envelope"] as? [String: Any])
}

private func routingConsume(
    envelope: [String: Any],
    suffix: String,
    externalOccurredAt: String = "2099-01-01T00:00:00Z"
) throws -> Data {
    try routingData([
        "type": "consume_pet_action",
        "event_id": "event_routing_\(suffix)_consume",
        "occurred_at": externalOccurredAt,
        "envelope": envelope,
    ])
}

private func routingReserveRepair(
    binding: [String: Any],
    suffix: String,
    occurredAt: String,
    externalIssuedAt: String = "2099-01-01T00:00:00Z",
    externalExpiresAt: String = "2299-01-01T00:00:00Z"
) throws -> Data {
    try routingData([
        "type": "reserve_format_repair",
        "event_id": "event_routing_\(suffix)_repair_reserve",
        "occurred_at": occurredAt,
        "binding": binding,
        "continuation_id": "continuation_routing_\(suffix)_repair",
        "repair_request_id": "repair_request_routing_\(suffix)",
        "parent_prompt_id": binding["source_prompt_id"]!,
        "issued_at": externalIssuedAt,
        "expires_at": externalExpiresAt,
    ])
}

private func routingClaimRepair(
    envelope: [String: Any],
    suffix: String,
    externalOccurredAt: String = "2099-01-01T00:00:00Z"
) throws -> Data {
    try routingData([
        "type": "claim_format_repair",
        "event_id": "event_routing_\(suffix)_repair_claim",
        "occurred_at": externalOccurredAt,
        "envelope": envelope,
    ])
}

private func routingExpectCode(_ expected: String, _ body: () throws -> Void) {
    do {
        try body()
        Issue.record("expected error \(expected)")
    } catch let error as CoordinatorError {
        #expect(error.code == expected)
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

private final class RoutingFakeClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64

    init(_ initial: UInt64 = 0) { value = initial }

    func nowNanoseconds() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func advance(seconds: UInt64) {
        lock.lock()
        value += seconds * 1_000_000_000
        lock.unlock()
    }

    func set(seconds: UInt64) {
        lock.lock()
        value = seconds * 1_000_000_000
        lock.unlock()
    }
}

private final class RoutingEventIDs: @unchecked Sendable {
    private let lock = NSLock()
    private var next = 0

    func generate(_ purpose: String) -> String {
        lock.lock()
        next += 1
        let value = next
        lock.unlock()
        return "event_routing_internal_\(purpose)_\(value)"
    }
}

private final class RoutingMemoryJournal: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let lock = NSLock()
    private var stored = JournalSnapshot(
        events: [],
        documents: [],
        verificationRecords: [],
        journalSequence: 0
    )
    private var competingChange: CoordinatorSemanticChange?
    private var loads = 0
    private var afterLoad: (@Sendable () -> Void)?
    private var afterAppend: (eventType: String, action: @Sendable () -> Void)?
    private var beforeAdmission: (eventType: String, action: @Sendable () -> Void)?
    private var loadFailure: String?
    private var appendFailure: (
        eventType: String, errorCode: String, commitFirst: Bool, followingLoadError: String?
    )?
    private var appendAttempts: [String: Int] = [:]

    func load() throws -> JournalSnapshot {
        lock.lock()
        let action = afterLoad
        afterLoad = nil
        defer {
            lock.unlock()
            action?()
        }
        loads += 1
        if let code = loadFailure {
            loadFailure = nil
            throw CoordinatorError(code)
        }
        return stored
    }

    func loadCount() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return loads
    }

    func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data],
        validateAdmission: () throws -> Void
    ) throws -> JournalAppendResult {
        let types = try events.map { try routingObject($0)["event_type"] as? String ?? "" }
        lock.lock()
        let action = beforeAdmission.flatMap { types.contains($0.eventType) ? $0.action : nil }
        if action != nil { beforeAdmission = nil }
        lock.unlock()
        action?()
        try validateAdmission()
        return try append(expectedSequence: expectedSequence, events: events,
            documents: documents, verificationRecords: verificationRecords)
    }

    func beforeNextAdmission(eventType: String, _ action: @escaping @Sendable () -> Void) {
        lock.lock()
        beforeAdmission = (eventType, action)
        lock.unlock()
    }

    func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data]
    ) throws -> JournalAppendResult {
        let types = try events.map { try routingObject($0)["event_type"] as? String ?? "" }
        var action: (@Sendable () -> Void)?
        lock.lock()
        defer {
            lock.unlock()
            action?()
        }
        for type in types { appendAttempts[type, default: 0] += 1 }
        if let competingChange {
            self.competingChange = nil
            let competed = JournalSnapshot(
                events: stored.events + competingChange.events,
                documents: stored.documents + competingChange.documents,
                verificationRecords: stored.verificationRecords + competingChange.verificationRecords,
                journalSequence: stored.journalSequence + Int64(competingChange.events.count)
            )
            _ = try CoordinatorSemanticReplay.replay(competed)
            stored = competed
        }
        guard stored.journalSequence == expectedSequence else {
            throw CoordinatorError("journal_sequence_conflict")
        }
        let failure = appendFailure.flatMap { types.contains($0.eventType) ? $0 : nil }
        if let failure {
            appendFailure = nil
            loadFailure = failure.followingLoadError
            if !failure.commitFirst {
                if let callback = afterAppend, types.contains(callback.eventType) {
                    afterAppend = nil
                    action = callback.action
                }
                throw CoordinatorError(failure.errorCode)
            }
        }
        let candidate = JournalSnapshot(
            events: stored.events + events,
            documents: stored.documents + documents,
            verificationRecords: stored.verificationRecords + verificationRecords,
            journalSequence: expectedSequence + Int64(events.count)
        )
        _ = try CoordinatorSemanticReplay.replay(candidate)
        stored = candidate
        if let callback = afterAppend, types.contains(callback.eventType) {
            afterAppend = nil
            action = callback.action
        }
        if let failure { throw CoordinatorError(failure.errorCode) }
        return JournalAppendResult(
            firstSequence: expectedSequence + 1,
            lastSequence: candidate.journalSequence,
            eventCount: events.count
        )
    }

    func installCompetingChange(_ change: CoordinatorSemanticChange) {
        lock.lock()
        competingChange = change
        lock.unlock()
    }

    func afterNextLoad(_ action: @escaping @Sendable () -> Void) {
        lock.lock()
        afterLoad = action
        lock.unlock()
    }

    func afterNextAppend(eventType: String, _ action: @escaping @Sendable () -> Void) {
        lock.lock()
        afterAppend = (eventType, action)
        lock.unlock()
    }

    func failNextLoad(_ code: String) {
        lock.lock()
        loadFailure = code
        lock.unlock()
    }

    func failNextAppend(
        eventType: String,
        errorCode: String = "test_append_failed",
        commitFirst: Bool = false,
        followingLoadError: String? = nil
    ) {
        lock.lock()
        appendFailure = (eventType, errorCode, commitFirst, followingLoadError)
        lock.unlock()
    }

    func appendAttemptCount(_ eventType: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return appendAttempts[eventType, default: 0]
    }
}

private func routingApplication(
    journal: RoutingMemoryJournal,
    clock: RoutingFakeClock
) throws -> CoordinatorRoutingApplication {
    let ids = RoutingEventIDs()
    return try CoordinatorRoutingApplication(
        journal: journal,
        clock: clock,
        eventIDGenerator: ids.generate
    )
}

private func routingSetup(
    _ app: CoordinatorRoutingApplication,
    suffix: String,
    binding: [String: Any],
    packet: [String: Any],
    openedAt: String
) throws {
    _ = try app.executeCommand(
        routingOpen(binding: binding, suffix: suffix, occurredAt: openedAt)
    )
    _ = try app.executeCommand(routingSeal(packet: packet, suffix: suffix))
}

@Test("same foreground still reads durable authority and rejects another writer's reseal")
func routingSameForegroundRevalidatesExactRevision() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "focus_reseal")
    let packet = try routingPacket(
        binding: binding, validAfter: 2, suffix: "focus_reseal",
        sealedAt: "2026-08-21T02:00:00Z"
    )
    try routingSetup(
        app, suffix: "focus_reseal", binding: binding, packet: packet,
        openedAt: "2026-08-21T01:59:59Z"
    )
    let target = try routingTarget(packet: packet, binding: binding)
    _ = try app.setForeground(target)
    let beforeRepeat = journal.loadCount()
    _ = try app.setForeground(target)
    // One full read, including on a same-target request; the post-read clock
    // check must not introduce another full journal load/replay.
    #expect(journal.loadCount() == beforeRepeat + 1)

    var revised = packet
    revised["revision"] = 2
    revised["valid_after_event_sequence"] = 3
    revised["sealed_at"] = "2026-08-21T02:00:01Z"
    let writer = CoordinatorSemanticApplication(journal: journal)
    _ = try writer.execute(command: routingSeal(packet: revised, suffix: "focus_reseal_v2"))

    let beforeStale = journal.loadCount()
    routingExpectCode("foreground_target_not_pending") {
        _ = try app.setForeground(target)
    }
    #expect(journal.loadCount() == beforeStale + 1)
    let snapshot = try routingObject(app.snapshot().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.packet(for: try CoordinatorBinding(jsonObject: binding))?.revision == 2)
    #expect(state.continuations.isEmpty)
}

private func routingFocusedFixture(suffix: String) throws -> (
    journal: RoutingMemoryJournal, clock: RoutingFakeClock, app: CoordinatorRoutingApplication,
    binding: [String: Any], packet: [String: Any]
) {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: suffix)
    let packet = try routingPacket(
        binding: binding, validAfter: 2, suffix: suffix,
        sealedAt: "2026-08-21T02:00:00Z"
    )
    try routingSetup(
        app, suffix: suffix, binding: binding, packet: packet,
        openedAt: "2026-08-21T01:59:59Z"
    )
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    return (journal, clock, app, binding, packet)
}

@Test(
    "due expiry retires only its cached revision before or during an external reseal",
    arguments: [false, true], ["2026-08-21T02:09:59Z", "2026-08-21T02:10:00Z", "2026-08-21T02:10:01Z"]
)
func routingExpiryRevalidatesRevision(raceAppend: Bool, replacementExpiry: String) throws {
    let (journal, clock, app, binding, packet) = try routingFocusedFixture(suffix: "expiry_reseal")
    var revised = packet
    revised["revision"] = 2
    revised["valid_after_event_sequence"] = 3
    revised["sealed_at"] = "2026-08-21T02:00:01Z"
    revised["expires_at"] = replacementExpiry
    let reseal = try routingSeal(packet: revised, suffix: "expiry_reseal_v2")
    if raceAppend {
        journal.installCompetingChange(try CoordinatorSemanticDecision.decide(
            state: CoordinatorSemanticReplay.replay(journal.load()), command: reseal
        ))
    } else {
        _ = try CoordinatorSemanticApplication(journal: journal).execute(command: reseal)
    }
    clock.set(seconds: 600)
    let before = journal.loadCount()
    #expect(try app.processTime().isEmpty)
    #expect(journal.loadCount() == before + (raceAppend ? 2 : 1))
    #expect(journal.appendAttemptCount("interaction_expired") == (raceAppend ? 1 : 0))
    let snapshot = try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect(snapshot["foreground"] is NSNull)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    #expect(app.millisecondsUntilNextDeadline() == nil)
    clock.advance(seconds: 2)
    let afterRetirement = journal.loadCount()
    #expect(try app.processTime().isEmpty)
    #expect(journal.loadCount() == afterRetirement)

    let authority = try CoordinatorSemanticReplay.replay(journal.load())
    let durable = try #require(authority.boundary(for: CoordinatorBinding(jsonObject: binding)))
    #expect(durable.packet?.revision == 2)
    #expect(durable.isPendingInteraction)
    #expect(durable.selection == nil)
    #expect(authority.continuations.isEmpty)
    #expect(authority.eventSequence == 3) // no expiry for either revision
}

@Test("expiry retries an unrelated writer conflict against fresh exact authority once")
func routingExpiryRetriesUnrelatedWriter() throws {
    let (journal, clock, app, binding, _) = try routingFocusedFixture(suffix: "expiry_conflict")
    journal.installCompetingChange(try CoordinatorSemanticDecision.decide(
        state: CoordinatorSemanticReplay.replay(journal.load()),
        command: routingOpen(
            binding: routingBinding(suffix: "unrelated_writer"), suffix: "unrelated_writer",
            occurredAt: "2026-08-21T02:00:01Z"
        )
    ))
    clock.set(seconds: 600)
    let before = journal.loadCount()
    let notices = try app.processTime().map(routingObject)
    #expect(journal.loadCount() == before + 2)
    #expect(journal.appendAttemptCount("interaction_expired") == 2)
    #expect(notices.count == 1)
    #expect(notices.first?["kind"] as? String == "interaction_expired")
    #expect(try app.processTime().isEmpty)
    let authority = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(authority.boundary(for: try CoordinatorBinding(jsonObject: binding))?.expired == true)
    #expect(authority.eventSequence == 4) // open, seal, competing open, one expiry
    #expect(authority.continuations.isEmpty)
}

@Test(
    "expiry verification failures revoke focus but retain the pending item for verified cleanup",
    arguments: ["runtime_event_integrity_mismatch", "freshness_rollback_detected"]
)
func routingExpiryAuthorityFailureRetainsPending(code: String) throws {
    let (journal, clock, app, _, _) = try routingFocusedFixture(suffix: "expiry_authority_failure")
    clock.set(seconds: 600)
    // Inject the port failure; this is not a SQLite MAC/Keychain test.
    journal.failNextLoad(code)
    routingExpectCode(code) { _ = try app.processTime() }
    let snapshot = try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect(snapshot["foreground"] is NSNull)
    #expect((snapshot["pending"] as? [Any])?.count == 1)
    #expect(journal.appendAttemptCount("interaction_expired") == 0)
    let notices = try app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices.first?["kind"] as? String == "interaction_expired")
    #expect(journal.appendAttemptCount("interaction_expired") == 1)
    #expect(try app.processTime().isEmpty)
    #expect(try journal.load().journalSequence == 3)
}

@Test(
    "expiry append recovery emits exactly one notice only after verified exact expiry",
    arguments: ["before_commit", "lost_response", "recovery_failure"]
)
func routingExpiryAppendRecovery(mode: String) throws {
    let (journal, clock, app, binding, _) = try routingFocusedFixture(suffix: "expiry_recovery")
    clock.set(seconds: 600)
    journal.failNextAppend(
        eventType: "interaction_expired", commitFirst: mode != "before_commit",
        followingLoadError: mode == "recovery_failure" ? "freshness_rollback_detected" : nil
    )
    let before = journal.loadCount()
    var notices: [[String: Any]] = []
    if mode == "lost_response" {
        notices = try app.processTime().map(routingObject)
    } else {
        let expectedCode = mode == "recovery_failure" ? "freshness_rollback_detected" : "test_append_failed"
        routingExpectCode(expectedCode) { _ = try app.processTime() }
        let failed = try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)
        #expect(failed["selection_enabled"] as? Bool == false)
        #expect(failed["foreground"] is NSNull)
        #expect((failed["pending"] as? [Any])?.count == 1)
    }
    #expect(journal.loadCount() == before + 2) // authority plus recovery, including failed load
    notices += try app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices.first?["kind"] as? String == "interaction_expired")
    #expect(notices.first?["revision"] as? Int == 1)
    #expect(journal.appendAttemptCount("interaction_expired") == (mode == "before_commit" ? 2 : 1))
    #expect(try app.processTime().isEmpty)
    let authority = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(authority.eventSequence == 3)
    #expect(authority.boundary(for: try CoordinatorBinding(jsonObject: binding))?.expired == true)
    #expect(authority.continuations.isEmpty)
}

@Test(
    "ambiguous expiry never synthesizes an old notice from replacement or other terminal state",
    arguments: ["replacement_pending", "replacement_expired", "closed"]
)
func routingExpiryRecoveryRejectsOtherAuthority(mode: String) throws {
    let (journal, clock, app, binding, packet) = try routingFocusedFixture(suffix: "expiry_other_authority")
    var revised = packet
    revised["revision"] = 2
    revised["valid_after_event_sequence"] = 3
    revised["sealed_at"] = "2026-08-21T02:00:01Z"
    let reseal = try routingSeal(packet: revised, suffix: "expiry_other_authority_v2")
    var terminalCommand: [String: Any] = [
        "type": mode == "closed" ? "close_boundary" : "expire_interaction",
        "event_id": "event_routing_other_authority_terminal",
        "binding": binding,
        "occurred_at": "2026-08-21T02:10:00Z",
    ]
    if mode == "closed" { terminalCommand["close_reason"] = "superseded_by_user_prompt" }
    let terminal = try routingData(terminalCommand)
    journal.failNextAppend(eventType: "interaction_expired")
    // After the failed attempt releases the journal lock, another writer
    // commits before routing's ambiguous-result recovery read.
    journal.afterNextAppend(eventType: "interaction_expired") {
        do {
            let writer = CoordinatorSemanticApplication(journal: journal)
            if mode != "closed" { _ = try writer.execute(command: reseal) }
            if mode != "replacement_pending" { _ = try writer.execute(command: terminal) }
        } catch {
            Issue.record("competing writer failed: \(error)")
        }
    }
    clock.set(seconds: 600)
    #expect(try app.processTime().isEmpty)
    let snapshot = try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect(snapshot["foreground"] is NSNull)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    #expect(try app.processTime().isEmpty)
    let authority = try CoordinatorSemanticReplay.replay(journal.load())
    let boundary = try #require(authority.boundary(for: CoordinatorBinding(jsonObject: binding)))
    #expect(boundary.packet?.revision == (mode == "closed" ? 1 : 2))
    #expect(boundary.expired == (mode == "replacement_expired"))
    #expect(boundary.closed == (mode == "closed"))
    #expect(authority.eventSequence == (mode == "replacement_expired" ? 4 : 3))
    #expect(boundary.selection == nil)
    #expect(authority.continuations.isEmpty)
}

@Test(
    "focus rechecks its target after another continuation's slow timeout append",
    arguments: [false, true], [false, true]
)
func routingFocusChecksTimeAfterDueWrites(regressClock: Bool, failCleanup: Bool) throws {
    let (journal, clock, app, bindingA, packetA) = try routingFocusedFixture(suffix: "slow_timeout")
    _ = try app.routeSelection(routingSelection(packet: packetA, binding: bindingA, suffix: "slow_timeout"))
    let bindingB = routingBinding(suffix: "focus_after_timeout")
    let packetB = try routingPacket(
        binding: bindingB, validAfter: 6, suffix: "focus_after_timeout",
        sealedAt: "2026-08-21T02:00:00Z"
    )
    try routingSetup(
        app, suffix: "focus_after_timeout", binding: bindingB, packet: packetB,
        openedAt: "2026-08-21T01:59:59Z"
    )
    let target = try routingTarget(packet: packetB, binding: bindingB)
    _ = try app.setForeground(target)
    clock.set(seconds: 299)
    // First due pass samples 299. Its authority read ends at 300. The second
    // pass samples 300, checks B, then waits on A's timeout until 600 (or 299).
    journal.afterNextLoad { clock.set(seconds: 300) }
    journal.afterNextAppend(eventType: "continuation_transport_timed_out_unknown") {
        clock.set(seconds: regressClock ? 299 : 600)
    }
    if failCleanup { journal.failNextAppend(eventType: "interaction_expired") }
    let before = journal.loadCount()
    routingExpectCode(failCleanup ? "test_append_failed" : "foreground_target_not_pending") {
        _ = try app.setForeground(target)
    }
    // Focus authority, timeout authority, expiry authority, and only on a
    // failed append, a recovery read. No extra full due/replay loop.
    #expect(journal.loadCount() == before + (failCleanup ? 4 : 3))
    let snapshot = try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect(snapshot["foreground"] is NSNull)
    #expect((snapshot["pending"] as? [Any])?.count == (failCleanup ? 1 : 0))
    #expect(journal.appendAttemptCount("interaction_expired") == 1)
    #expect(journal.appendAttemptCount("continuation_transport_timed_out_unknown") == 1)
    #expect(journal.appendAttemptCount("decision_selection_claimed") == 1)
    #expect(journal.appendAttemptCount("continuation_dispatched") == 1)
    let authority = try CoordinatorSemanticReplay.replay(journal.load())
    let boundary = try #require(authority.boundary(for: CoordinatorBinding(jsonObject: bindingB)))
    #expect(boundary.expired == !failCleanup)
    #expect(boundary.selection == nil)
    #expect(authority.continuations.count == 1)
    #expect(authority.continuation(id: "continuation_routing_slow_timeout")?.transport?.status == .timedOutUnknown)

    let notices = try app.processTime().map(routingObject)
    #expect(notices.filter { $0["kind"] as? String == "interaction_expired" }.count == 1)
    let timeout = try #require(notices.first { $0["kind"] as? String == "continuation_timed_out_unknown" })
    #expect(timeout["automatic_retry"] as? Bool == false)
    #expect(try app.processTime().isEmpty)
    #expect(journal.appendAttemptCount("decision_selection_claimed") == 1)
    #expect(journal.appendAttemptCount("continuation_dispatched") == 1)
}

@Test("two sessions queue without foreground stealing and switch only explicitly")
func routingQueueForegroundAndExactBinding() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let bindingA = routingBinding(suffix: "queue_a")
    let packetA = try routingPacket(
        binding: bindingA,
        validAfter: 2,
        suffix: "queue_a",
        sealedAt: "2026-08-21T02:00:00Z"
    )
    try routingSetup(
        app,
        suffix: "queue_a",
        binding: bindingA,
        packet: packetA,
        openedAt: "2026-08-21T01:59:59Z"
    )
    let noForegroundSequence = try journal.load().journalSequence
    routingExpectCode("foreground_interaction_required") {
        _ = try app.routeSelection(
            routingSelection(packet: packetA, binding: bindingA, suffix: "queue_a")
        )
    }
    #expect(try journal.load().journalSequence == noForegroundSequence)
    _ = try app.setForeground(routingTarget(packet: packetA, binding: bindingA))

    let bindingB = routingBinding(suffix: "queue_b")
    let packetB = try routingPacket(
        binding: bindingB,
        validAfter: 4,
        suffix: "queue_b",
        sealedAt: "2026-08-21T02:00:01Z"
    )
    try routingSetup(
        app,
        suffix: "queue_b",
        binding: bindingB,
        packet: packetB,
        openedAt: "2026-08-21T02:00:00Z"
    )

    let snapshot = try routingObject(app.snapshot().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == true)
    let pending = try #require(snapshot["pending"] as? [[String: Any]])
    #expect(pending.count == 2)
    #expect(pending.first(where: { $0["session_id"] as? String == bindingA["session_id"] as? String })?["foreground"] as? Bool == true)
    #expect(pending.first(where: { $0["session_id"] as? String == bindingB["session_id"] as? String })?["foreground"] as? Bool == false)

    let beforeMismatch = try journal.load().journalSequence
    routingExpectCode("foreground_interaction_mismatch") {
        _ = try app.routeSelection(
            routingSelection(packet: packetB, binding: bindingB, suffix: "queue_b")
        )
    }
    #expect(try journal.load().journalSequence == beforeMismatch)

    _ = try app.setForeground(routingTarget(packet: packetB, binding: bindingB))
    var routed = try routingObject(
        routingSelection(packet: packetB, binding: bindingB, suffix: "queue_b")
    )
    routed["action"] = ["untrusted": "must_not_be_dispatched"]
    let selected = try app.routeSelection(routingData(routed))
    let effect = try routingObject(try #require(selected.effects.first))
    let envelope = try #require(effect["envelope"] as? [String: Any])
    let choices = try #require(packetB["choices"] as? [[String: Any]])
    #expect(envelope["action_id"] as? String == choices[0]["action_id"] as? String)
    #expect((envelope["action"] as? [String: Any])?["untrusted"] == nil)
    #expect(try routingObject(app.snapshot().canonicalJSON)["selection_enabled"] as? Bool == false)
}

@Test("same session cannot seal two pending interactions atomically")
func routingSameSessionConflict() throws {
    let journal = RoutingMemoryJournal()
    let app = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let project = "project_routing_shared"
    let session = "session_routing_shared"
    let bindingA = routingBinding(suffix: "same_a", projectID: project, sessionID: session)
    let bindingB = routingBinding(suffix: "same_b", projectID: project, sessionID: session)
    _ = try app.executeCommand(
        routingOpen(binding: bindingA, suffix: "same_a", occurredAt: "2026-08-21T03:00:00Z")
    )
    _ = try app.executeCommand(
        routingOpen(binding: bindingB, suffix: "same_b", occurredAt: "2026-08-21T03:00:00Z")
    )
    let packetA = try routingPacket(
        binding: bindingA,
        validAfter: 3,
        suffix: "same_a",
        sealedAt: "2026-08-21T03:00:01Z"
    )
    _ = try app.executeCommand(routingSeal(packet: packetA, suffix: "same_a"))
    let packetB = try routingPacket(
        binding: bindingB,
        validAfter: 4,
        suffix: "same_b",
        sealedAt: "2026-08-21T03:00:01Z"
    )
    routingExpectCode("session_pending_interaction_conflict") {
        _ = try app.executeCommand(routingSeal(packet: packetB, suffix: "same_b"))
    }
    #expect(try journal.load().journalSequence == 3)
    #expect(try CoordinatorSemanticReplay.replay(journal.load()).pendingInteractions.count == 1)
}

@Test("equal queue anchors use the complete binding for deterministic order")
func routingQueueTieUsesFullBindingOrder() throws {
    let journal = RoutingMemoryJournal()
    let app = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let sharedSession = "session_routing_tied"
    let bindingZ = routingBinding(
        suffix: "tie_z",
        projectID: "project_routing_z",
        sessionID: sharedSession
    )
    let bindingA = routingBinding(
        suffix: "tie_a",
        projectID: "project_routing_a",
        sessionID: sharedSession
    )
    let packetZ = try routingPacket(
        binding: bindingZ,
        validAfter: 2,
        suffix: "tie_z",
        sealedAt: "2026-08-21T03:10:00Z"
    )
    try routingSetup(
        app,
        suffix: "tie_z",
        binding: bindingZ,
        packet: packetZ,
        openedAt: "2026-08-21T03:09:59Z"
    )
    let packetA = try routingPacket(
        binding: bindingA,
        validAfter: 4,
        suffix: "tie_a",
        sealedAt: "2026-08-21T03:10:00Z"
    )
    try routingSetup(
        app,
        suffix: "tie_a",
        binding: bindingA,
        packet: packetA,
        openedAt: "2026-08-21T03:09:59Z"
    )

    let snapshot = try routingObject(app.snapshot().canonicalJSON)
    let pending = try #require(snapshot["pending"] as? [[String: Any]])
    #expect(pending.map { $0["project_id"] as? String } == [
        "project_routing_a",
        "project_routing_z",
    ])
}

@Test("foreground routing rejects every stale or mismatched identity without mutation")
func routingForegroundIdentityMismatchMatrix() throws {
    let journal = RoutingMemoryJournal()
    let app = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let binding = routingBinding(suffix: "identity")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "identity",
        sealedAt: "2026-08-21T03:30:00Z"
    )
    try routingSetup(
        app,
        suffix: "identity",
        binding: binding,
        packet: packet,
        openedAt: "2026-08-21T03:29:59Z"
    )
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    let baseline = try journal.load().journalSequence

    let cases: [(String, Any, String)] = [
        ("interaction_id", "interaction_routing_other", "foreground_interaction_mismatch"),
        ("packet_id", "packet_routing_other", "foreground_interaction_mismatch"),
        ("revision", 2, "foreground_interaction_mismatch"),
        ("project_id", "project_routing_other", "routing_interaction_not_pending"),
        ("session_id", "session_routing_other", "routing_interaction_not_pending"),
        ("episode_id", "episode_routing_other", "routing_interaction_not_pending"),
        ("option_id", "option_routing_other", "decision_option_not_found"),
    ]
    for (field, value, code) in cases {
        var command = try routingObject(
            routingSelection(packet: packet, binding: binding, suffix: "identity")
        )
        var request = try #require(command["request"] as? [String: Any])
        request[field] = value
        command["request"] = request
        routingExpectCode(code) {
            _ = try app.routeSelection(routingData(command))
        }
        #expect(try journal.load().journalSequence == baseline)
    }

    var staleState = try routingObject(
        routingSelection(packet: packet, binding: binding, suffix: "identity")
    )
    staleState["expected_state"] = "expired"
    routingExpectCode("routing_expected_state_mismatch") {
        _ = try app.routeSelection(routingData(staleState))
    }
    #expect(try journal.load().journalSequence == baseline)
}

@Test("reminder and expiry clocks are independent per packet")
func routingIndependentReminderAndExpiry() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let bindingA = routingBinding(suffix: "timer_a")
    let packetA = try routingPacket(
        binding: bindingA,
        validAfter: 2,
        suffix: "timer_a",
        sealedAt: "2026-08-21T04:00:00Z"
    )
    try routingSetup(app, suffix: "timer_a", binding: bindingA, packet: packetA, openedAt: "2026-08-21T03:59:59Z")
    clock.advance(seconds: 30)

    let bindingB = routingBinding(suffix: "timer_b")
    let packetB = try routingPacket(
        binding: bindingB,
        validAfter: 4,
        suffix: "timer_b",
        sealedAt: "2026-08-21T04:00:30Z"
    )
    try routingSetup(app, suffix: "timer_b", binding: bindingB, packet: packetB, openedAt: "2026-08-21T04:00:29Z")

    clock.advance(seconds: 30)
    var notices = try app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices[0]["interaction_id"] as? String == packetA["interaction_id"] as? String)

    clock.advance(seconds: 30)
    notices = try app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices[0]["interaction_id"] as? String == packetB["interaction_id"] as? String)

    clock.advance(seconds: 510)
    notices = try app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices[0]["kind"] as? String == "interaction_expired")
    #expect(notices[0]["interaction_id"] as? String == packetA["interaction_id"] as? String)
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.pendingInteractions.count == 1)
    #expect(state.pendingInteractions.first?.binding.sessionID == bindingB["session_id"] as? String)
}

@Test("selection CAS loss clears stale foreground authority")
func routingSelectionCASLossReconcilesForeground() throws {
    let journal = RoutingMemoryJournal()
    let app = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let binding = routingBinding(suffix: "cas_loss")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "cas_loss",
        sealedAt: "2026-08-21T04:30:00Z"
    )
    try routingSetup(app, suffix: "cas_loss", binding: binding, packet: packet, openedAt: "2026-08-21T04:29:59Z")
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))

    var winningCommand = try routingObject(
        routingSelection(
            packet: packet,
            binding: binding,
            suffix: "cas_winner",
            externalOccurredAt: "2026-08-21T04:30:01Z"
        )
    )
    winningCommand["issued_at"] = "2026-08-21T04:30:01Z"
    winningCommand["expires_at"] = "2026-08-21T04:32:01Z"
    winningCommand["in_flight_deadline_at"] = "2026-08-21T04:35:01Z"
    var winningRequest = try #require(winningCommand["request"] as? [String: Any])
    winningRequest["selection_id"] = "selection_routing_cas_winner"
    winningRequest["option_id"] = (packet["choices"] as? [[String: Any]])?[1]["option_id"]
    winningCommand["request"] = winningRequest
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    let winningChange = try CoordinatorSemanticDecision.decide(
        state: state,
        command: routingData(winningCommand),
        tokenMaterial: ContinuationTokenMaterial.generate()
    )
    journal.installCompetingChange(winningChange)

    routingExpectCode("selection_already_claimed") {
        _ = try app.routeSelection(
            routingSelection(packet: packet, binding: binding, suffix: "cas_loss")
        )
    }
    let snapshot = try routingObject(app.snapshot().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    #expect(try journal.load().journalSequence == 4)
}

@Test("wall clock jumps cannot steal or extend the continuous selection window")
func routingWallJumpUsesLogicalTime() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "wall_jump")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "wall_jump",
        sealedAt: "2026-08-21T05:00:00Z"
    )
    try routingSetup(app, suffix: "wall_jump", binding: binding, packet: packet, openedAt: "2026-08-21T04:59:59Z")
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    clock.advance(seconds: 10) // includes simulated sleep/continuous advance
    _ = try app.routeSelection(
        routingSelection(
            packet: packet,
            binding: binding,
            suffix: "wall_jump",
            externalOccurredAt: "2099-12-31T23:59:59Z"
        )
    )
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    let continuation = try #require(state.continuation(id: "continuation_routing_wall_jump"))
    #expect(continuation.issuedAt.rawValue == "2026-08-21T05:00:10Z")
    #expect(continuation.expiresAt.rawValue == "2026-08-21T05:02:10Z")
    #expect(continuation.inFlightDeadlineAt.rawValue == "2026-08-21T05:05:10Z")
}

@Test("Pet token consumption uses exact authority and the continuous 120-second window")
func routingPetTokenConsumptionAuthority() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "consume")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "consume",
        sealedAt: "2026-08-21T05:30:00Z"
    )
    try routingSetup(
        app,
        suffix: "consume",
        binding: binding,
        packet: packet,
        openedAt: "2026-08-21T05:29:59Z"
    )
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    let envelope = try routingEnvelope(
        app.routeSelection(
            routingSelection(packet: packet, binding: binding, suffix: "consume")
        )
    )
    let direct = try routingConsume(envelope: envelope, suffix: "consume_direct")
    routingExpectCode("routing_token_consumption_required") {
        _ = try app.executeCommand(direct)
    }

    clock.advance(seconds: 119)
    let baseline = try journal.load().journalSequence
    var wrongContinuation = envelope
    wrongContinuation["continuation_id"] = "continuation_routing_other"
    routingExpectCode("routing_continuation_not_in_flight") {
        _ = try app.routeConsumePetAction(
            routingConsume(envelope: wrongContinuation, suffix: "consume_wrong_id")
        )
    }
    var wrongBinding = envelope
    wrongBinding["project_id"] = "project_routing_other"
    routingExpectCode("decision_boundary_binding_mismatch") {
        _ = try app.routeConsumePetAction(
            routingConsume(envelope: wrongBinding, suffix: "consume_wrong_binding")
        )
    }
    var wrongToken = envelope
    wrongToken["continuation_token"] = "AAAAAAAAAAAAAAAAAAAAAA"
    routingExpectCode("continuation_token_invalid") {
        _ = try app.routeConsumePetAction(
            routingConsume(envelope: wrongToken, suffix: "consume_wrong_token")
        )
    }
    #expect(try journal.load().journalSequence == baseline)

    _ = try app.routeConsumePetAction(
        routingConsume(
            envelope: envelope,
            suffix: "consume_valid",
            externalOccurredAt: "2099-12-31T23:59:59Z"
        )
    )
    var state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(
        state.continuation(id: "continuation_routing_consume")?.consumedAt?.rawValue
            == "2026-08-21T05:31:59Z"
    )

    _ = try app.executeCommand(routingData([
        "type": "complete_transport",
        "event_id": "event_routing_consume_complete",
        "occurred_at": "2000-01-01T00:00:00Z",
        "binding": binding,
        "continuation_id": "continuation_routing_consume",
    ]))
    state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(
        state.continuation(id: "continuation_routing_consume")?.transport?.occurredAt.rawValue
            == "2026-08-21T05:31:59Z"
    )
}

@Test("Pet token rejects forged wall time at and after 120 continuous seconds")
func routingPetTokenExpiryBoundary() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "consume_expiry")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "consume_expiry",
        sealedAt: "2026-08-21T05:45:00Z"
    )
    try routingSetup(
        app,
        suffix: "consume_expiry",
        binding: binding,
        packet: packet,
        openedAt: "2026-08-21T05:44:59Z"
    )
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    let envelope = try routingEnvelope(
        app.routeSelection(
            routingSelection(packet: packet, binding: binding, suffix: "consume_expiry")
        )
    )
    let forgedWall = try #require(envelope["issued_at"] as? String)
    clock.advance(seconds: 120)
    let baseline = try journal.load().journalSequence
    routingExpectCode("continuation_expired") {
        _ = try app.routeConsumePetAction(
            routingConsume(
                envelope: envelope,
                suffix: "consume_at_120",
                externalOccurredAt: forgedWall
            )
        )
    }
    clock.advance(seconds: 1)
    routingExpectCode("continuation_expired") {
        _ = try app.routeConsumePetAction(
            routingConsume(
                envelope: envelope,
                suffix: "consume_at_121",
                externalOccurredAt: forgedWall
            )
        )
    }
    #expect(try journal.load().journalSequence == baseline)
    #expect(
        try CoordinatorSemanticReplay.replay(journal.load())
            .continuation(id: "continuation_routing_consume_expiry")?.consumedAt == nil
    )
}

@Test("format repair authority fixes duration and fails closed at expiry")
func routingFormatRepairAuthorityAndExpiry() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "repair_window")
    _ = try app.executeCommand(
        routingOpen(
            binding: binding,
            suffix: "repair_window",
            occurredAt: "2026-08-21T05:59:59Z"
        )
    )
    let reserved = try app.executeCommand(
        routingReserveRepair(
            binding: binding,
            suffix: "repair_window",
            occurredAt: "2026-08-21T06:00:00Z"
        )
    )
    let envelope = try routingEnvelope(reserved)
    #expect(envelope["issued_at"] as? String == "2026-08-21T06:00:00Z")
    #expect(envelope["expires_at"] as? String == "2026-08-21T06:02:00Z")
    clock.advance(seconds: 119)
    _ = try app.executeCommand(
        routingClaimRepair(
            envelope: envelope,
            suffix: "repair_window",
            externalOccurredAt: "2299-12-31T23:59:59Z"
        )
    )
    let claimed = try #require(
        CoordinatorSemanticReplay.replay(journal.load())
            .boundary(for: try CoordinatorBinding(jsonObject: binding))?.repair?.claimedAt
    )
    #expect(claimed.rawValue == "2026-08-21T06:01:59Z")

    let expiredJournal = RoutingMemoryJournal()
    let expiredClock = RoutingFakeClock()
    let expiredApp = try routingApplication(journal: expiredJournal, clock: expiredClock)
    let expiredBinding = routingBinding(suffix: "repair_expiry")
    _ = try expiredApp.executeCommand(
        routingOpen(
            binding: expiredBinding,
            suffix: "repair_expiry",
            occurredAt: "2026-08-21T06:09:59Z"
        )
    )
    let expiredReservation = try expiredApp.executeCommand(
        routingReserveRepair(
            binding: expiredBinding,
            suffix: "repair_expiry",
            occurredAt: "2026-08-21T06:10:00Z"
        )
    )
    let expiredEnvelope = try routingEnvelope(expiredReservation)
    expiredClock.advance(seconds: 120)
    let baseline = try expiredJournal.load().journalSequence
    routingExpectCode("routing_format_repair_not_active") {
        _ = try expiredApp.executeCommand(
            routingClaimRepair(
                envelope: expiredEnvelope,
                suffix: "repair_at_120",
                externalOccurredAt: "2026-08-21T06:10:00Z"
            )
        )
    }
    expiredClock.advance(seconds: 1)
    routingExpectCode("routing_format_repair_not_active") {
        _ = try expiredApp.executeCommand(
            routingClaimRepair(
                envelope: expiredEnvelope,
                suffix: "repair_at_121",
                externalOccurredAt: "2026-08-21T06:10:00Z"
            )
        )
    }
    #expect(try expiredJournal.load().journalSequence == baseline)
}

@Test("restart never restores a format repair claim anchor")
func routingFormatRepairRestartFailsClosed() throws {
    let journal = RoutingMemoryJournal()
    let first = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let binding = routingBinding(suffix: "repair_restart")
    _ = try first.executeCommand(
        routingOpen(
            binding: binding,
            suffix: "repair_restart",
            occurredAt: "2026-08-21T06:19:59Z"
        )
    )
    let reserved = try first.executeCommand(
        routingReserveRepair(
            binding: binding,
            suffix: "repair_restart",
            occurredAt: "2026-08-21T06:20:00Z"
        )
    )
    let envelope = try routingEnvelope(reserved)
    let restarted = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let baseline = try journal.load().journalSequence
    routingExpectCode("routing_format_repair_not_active") {
        _ = try restarted.executeCommand(
            routingClaimRepair(envelope: envelope, suffix: "repair_restart")
        )
    }
    #expect(try journal.load().journalSequence == baseline)
}

@Test("restart expires old and current pending packets without extending their recorded lifetime", arguments: [120, 600])
func routingRestartPendingFailsClosed(lifetimeSeconds: UInt64) throws {
    let journal = RoutingMemoryJournal()
    let semantic = CoordinatorSemanticApplication(journal: journal)
    let binding = routingBinding(suffix: "restart_pending")
    var packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "restart_pending",
        sealedAt: "2026-08-21T06:00:00Z"
    )
    let originalExpiry = try RFC3339Instant("2026-08-21T06:00:00Z")
        .adding(nanoseconds: lifetimeSeconds * 1_000_000_000).rawValue
    packet["expires_at"] = originalExpiry
    _ = try semantic.execute(
        command: routingOpen(binding: binding, suffix: "restart_pending", occurredAt: "2026-08-21T05:59:59Z")
    )
    _ = try semantic.execute(command: routingSeal(packet: packet, suffix: "restart_pending"))

    let app = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.pendingInteractions.isEmpty)
    let boundary = try #require(state.boundary(for: try CoordinatorBinding(jsonObject: binding)))
    #expect(boundary.expired)
    #expect(boundary.packet?.expiresAt.rawValue == originalExpiry)
    let expiryEvent = try #require(try journal.load().events.last)
    #expect(try routingObject(expiryEvent)["occurred_at"] as? String == originalExpiry)
    let snapshot = try routingObject(app.snapshot().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    let notices = try app.processTime().map(routingObject)
    #expect(notices.first?["reason"] as? String == "restart_elapsed_ambiguous")
}

@Test("decision cards remain selectable after two minutes and immediately before ten minutes", arguments: [120, 599])
func routingDecisionSelectionBeforeTenMinutes(elapsedSeconds: UInt64) throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let suffix = "extended_decision_wait"
    let binding = routingBinding(suffix: suffix)
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: suffix,
        sealedAt: "2026-08-21T06:00:00Z"
    )
    try routingSetup(app, suffix: suffix, binding: binding, packet: packet,
                     openedAt: "2026-08-21T05:59:59Z")
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    clock.advance(seconds: elapsedSeconds)
    let snapshot = try routingObject(app.snapshot().canonicalJSON)
    let pending = try #require(snapshot["pending"] as? [[String: Any]])
    #expect(pending.count == 1)
    #expect(pending.first?["milliseconds_until_expiry"] as? Int64 == Int64((600 - elapsedSeconds) * 1_000))
    #expect(snapshot["selection_enabled"] as? Bool == true)
    _ = try routingEnvelope(app.routeSelection(
        routingSelection(packet: packet, binding: binding, suffix: suffix)
    ))
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.selection != nil)
}

@Test("atomic activation recovery rejects a changed packet under the same event ids")
func routingAtomicActivationRecoveryIsExact() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let suffix = "atomic_recovery_exact"
    let binding = routingBinding(suffix: suffix)
    let template = try routingPacket(
        binding: binding,
        validAfter: 1,
        suffix: suffix,
        sealedAt: "2026-08-21T06:10:00Z"
    )
    let command = try routingInitialActivation(
        binding: binding,
        packet: template,
        suffix: suffix,
        occurredAt: "2026-08-21T06:10:00Z"
    )
    let committed = try app.executeCommand(command)
    #expect(committed.commit.eventCount == 2)
    let baseline = try journal.load()

    var changed = template
    changed["summary"] = "Changed bytes must not authenticate recovery"
    routingExpectCode("decision_boundary_reopened") {
        _ = try app.executeCommand(
            routingInitialActivation(
                binding: binding,
                packet: changed,
                suffix: suffix,
                occurredAt: "2026-08-21T06:10:00Z"
            )
        )
    }
    let after = try journal.load()
    #expect(after.journalSequence == baseline.journalSequence)
    #expect(after.events == baseline.events)
    #expect(after.documents == baseline.documents)
}

@Test("atomic activation starts its monotonic expiry window at activation time")
func routingAtomicActivationUsesFreshAnchor() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    clock.advance(seconds: 599)

    let suffix = "atomic_fresh_anchor"
    let binding = routingBinding(suffix: suffix)
    let packet = try routingPacket(
        binding: binding,
        validAfter: 1,
        suffix: suffix,
        sealedAt: "2026-08-21T06:20:00Z"
    )
    _ = try app.executeCommand(routingInitialActivation(
        binding: binding,
        packet: packet,
        suffix: suffix,
        occurredAt: "2026-08-21T06:20:00Z"
    ))

    clock.advance(seconds: 599)
    let beforeExpiry = try app.processTime().map(routingObject)
    #expect(beforeExpiry.contains { $0["kind"] as? String == "interaction_reminder_due" })
    var state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.pendingInteractions.count == 1)
    #expect(state.boundaries.values.first?.expired == false)

    clock.advance(seconds: 1)
    let atExpiry = try app.processTime().map(routingObject)
    #expect(atExpiry.contains { $0["kind"] as? String == "interaction_expired" })
    state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.pendingInteractions.isEmpty)
    #expect(state.boundaries.values.first?.expired == true)
}

@Test("restart quarantines a legacy unsealed open before any recovery write")
func routingRestartLegacyUnsealedOpenQuarantines() throws {
    let journal = RoutingMemoryJournal()
    let semantic = CoordinatorSemanticApplication(journal: journal)
    let orphanBinding = routingBinding(suffix: "restart_orphan")
    _ = try semantic.execute(
        command: routingOpen(
            binding: orphanBinding,
            suffix: "restart_orphan",
            occurredAt: "2026-08-21T06:29:59Z"
        )
    )

    // Include both kinds of ordinary restart recovery work. The orphan must
    // prevent either one from appending and consuming its required sequence.
    let pendingBinding = routingBinding(suffix: "restart_orphan_pending")
    let pendingPacket = try routingPacket(
        binding: pendingBinding,
        validAfter: 3,
        suffix: "restart_orphan_pending",
        sealedAt: "2026-08-21T06:30:00Z"
    )
    _ = try semantic.execute(
        command: routingOpen(
            binding: pendingBinding,
            suffix: "restart_orphan_pending",
            occurredAt: "2026-08-21T06:29:59Z"
        )
    )
    _ = try semantic.execute(
        command: routingSeal(packet: pendingPacket, suffix: "restart_orphan_pending")
    )
    let flightBinding = routingBinding(suffix: "restart_orphan_flight")
    let flightPacket = try routingPacket(
        binding: flightBinding,
        validAfter: 5,
        suffix: "restart_orphan_flight",
        sealedAt: "2026-08-21T06:31:00Z"
    )
    _ = try semantic.execute(
        command: routingOpen(
            binding: flightBinding,
            suffix: "restart_orphan_flight",
            occurredAt: "2026-08-21T06:30:59Z"
        )
    )
    _ = try semantic.execute(
        command: routingSeal(packet: flightPacket, suffix: "restart_orphan_flight")
    )
    var flightSelection = try routingObject(routingSelection(
        packet: flightPacket,
        binding: flightBinding,
        suffix: "restart_orphan_flight",
        externalOccurredAt: "2026-08-21T06:31:01Z"
    ))
    flightSelection["expires_at"] = "2026-08-21T06:33:01Z"
    flightSelection["in_flight_deadline_at"] = "2026-08-21T06:36:01Z"
    _ = try semantic.execute(command: routingData(flightSelection))
    let baseline = try journal.load().journalSequence

    let app = try routingApplication(journal: journal, clock: RoutingFakeClock())
    #expect(app.recoveryStatus().unsealedBoundaryCount == 1)
    #expect(app.millisecondsUntilNextDeadline() == nil)
    let readOnly = try routingObject(
        app.snapshotWithoutProcessingTime().canonicalJSON
    )
    #expect(readOnly["selection_enabled"] as? Bool == false)
    #expect((readOnly["pending"] as? [Any])?.isEmpty == true)
    #expect(try app.authoritativeState().boundaries.count == 3)

    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        _ = try app.processTime()
    }
    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        _ = try app.snapshot()
    }
    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        _ = try app.clearForeground()
    }
    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        _ = try app.setForeground(routingData([:]))
    }
    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        _ = try app.routeSelection(routingData([:]))
    }
    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        _ = try app.routeConsumePetAction(routingData([:]))
    }
    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        try app.processTimeKeepingNotices()
    }
    routingExpectCode("routing_restart_unsealed_boundary_quarantined") {
        _ = try app.executeCommand(
            routingOpen(
                binding: routingBinding(suffix: "restart_orphan_blocked"),
                suffix: "restart_orphan_blocked",
                occurredAt: "2026-08-21T06:32:00Z"
            )
        )
    }
    #expect(try journal.load().journalSequence == baseline)
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.pendingInteractions.count == 1)
    #expect(state.unterminatedContinuations.count == 1)
}

@Test("late selection cannot mutate any session after scheduler expiry")
func routingLateSelectionNoMutation() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "late")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "late",
        sealedAt: "2026-08-21T07:00:00Z"
    )
    try routingSetup(app, suffix: "late", binding: binding, packet: packet, openedAt: "2026-08-21T06:59:59Z")
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    clock.advance(seconds: 600)
    _ = try app.processTime()
    let expiredSequence = try journal.load().journalSequence
    routingExpectCode("routing_interaction_not_pending") {
        _ = try app.routeSelection(
            routingSelection(packet: packet, binding: binding, suffix: "late")
        )
    }
    #expect(try journal.load().journalSequence == expiredSequence)
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.continuations.isEmpty)
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.selection == nil)
}

@Test("clear foreground processes expiry before returning its snapshot")
func routingClearForegroundProcessesDueExpiry() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "clear_due")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "clear_due",
        sealedAt: "2026-08-21T07:30:00Z"
    )
    try routingSetup(
        app,
        suffix: "clear_due",
        binding: binding,
        packet: packet,
        openedAt: "2026-08-21T07:29:59Z"
    )
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    let beforeExpiry = try journal.load().journalSequence
    clock.advance(seconds: 600)

    let snapshot = try routingObject(app.clearForeground().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    #expect(try journal.load().journalSequence == beforeExpiry + 1)
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.pendingInteractions.isEmpty)
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.expired == true)
}

@Test("in-flight deadline emits unknown once without retry")
func routingInFlightTimeoutOnce() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "deadline")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "deadline",
        sealedAt: "2026-08-21T08:00:00Z"
    )
    try routingSetup(app, suffix: "deadline", binding: binding, packet: packet, openedAt: "2026-08-21T07:59:59Z")
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    _ = try app.routeSelection(
        routingSelection(packet: packet, binding: binding, suffix: "deadline")
    )
    let selectedSequence = try journal.load().journalSequence
    clock.advance(seconds: 299)
    #expect(try app.processTime().isEmpty)
    #expect(try journal.load().journalSequence == selectedSequence)
    clock.advance(seconds: 1)
    var notices = try app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices[0]["kind"] as? String == "continuation_timed_out_unknown")
    #expect(notices[0]["automatic_retry"] as? Bool == false)
    let timedOutSequence = try journal.load().journalSequence
    notices = try app.processTime().map(routingObject)
    #expect(notices.isEmpty)
    #expect(try journal.load().journalSequence == timedOutSequence)
    let transport = try #require(
        CoordinatorSemanticReplay.replay(journal.load())
            .continuation(id: "continuation_routing_deadline")?.transport
    )
    #expect(transport.status == .timedOutUnknown)
    #expect(transport.automaticRetry == false)
}

private func routingQueuedDeliveryFixture(
    suffix: String,
    wallTime: String
) throws -> (
    journal: RoutingMemoryJournal, clock: RoutingFakeClock,
    app: CoordinatorRoutingApplication, continuationID: String,
    completion: Data, close: Data, claim: Data
) {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: suffix)
    let packet = try routingPacket(
        binding: binding, validAfter: 2, suffix: suffix,
        sealedAt: "2026-08-21T12:00:00Z"
    )
    try routingSetup(
        app, suffix: suffix, binding: binding, packet: packet,
        openedAt: "2026-08-21T11:59:59Z"
    )
    _ = try app.setForeground(routingTarget(packet: packet, binding: binding))
    clock.advance(seconds: 1)
    let envelope = try routingEnvelope(app.routeSelection(
        routingSelection(packet: packet, binding: binding, suffix: suffix)
    ))
    _ = try app.routeConsumePetAction(routingConsume(envelope: envelope, suffix: suffix))
    let continuationID = "continuation_routing_\(suffix)"
    let action = try app.authoritativeState().selectedActionJSON(for: continuationID)
    return (
        journal, clock, app, continuationID,
        try routingData([
            "type": "complete_transport", "event_id": "event_\(suffix)_complete",
            "occurred_at": wallTime, "binding": binding, "continuation_id": continuationID,
        ]),
        try routingData([
            "type": "close_boundary", "event_id": "event_\(suffix)_close",
            "occurred_at": wallTime, "binding": binding,
            "close_reason": "transport_terminal_observed",
        ]),
        try routingData([
            "type": "claim_queued_action_context", "event_id": "event_\(suffix)_claim",
            "occurred_at": wallTime, "binding": binding, "continuation_id": continuationID,
            "delivery_turn_id": "delivery_\(suffix)",
            "queued_prompt_sha256": "sha256:" + String(repeating: "a", count: 64),
            "cwd_sha256": "sha256:" + String(repeating: "b", count: 64),
            "action_sha256": CoordinatorSHA256.fingerprint(action),
        ])
    )
}

@Test(
    "queued completion uses continuous time in both delivery orderings after a wall jump",
    arguments: [false, true], ["2026-08-21T12:10:02Z", "2026-08-21T11:50:02Z"]
)
func routingQueuedCompletionUsesContinuousTime(receiptFirst: Bool, wallTime: String) throws {
    let suffix = "queued_clock_\(receiptFirst ? "receipt" : "hook")"
    let f = try routingQueuedDeliveryFixture(suffix: suffix, wallTime: wallTime)
    f.clock.advance(seconds: 1)
    if receiptFirst {
        try f.app.completeTransportAndCloseBoundary(f.completion, close: f.close)
    }
    let loadsBefore = f.journal.loadCount()
    let authority = try f.app.queuedActionAuthorityProjection()
    let action = try authority.state.selectedActionJSON(for: f.continuationID)
    let delivered: Data
    if receiptFirst {
        delivered = try f.app.routeQueuedActionContextClaim(
            f.claim, using: authority, expectedActionJSON: action
        )
    } else {
        delivered = try f.app.routeQueuedActionContextClaim(
            f.claim, completingTransportWith: f.completion, closingBoundaryWith: f.close,
            using: authority, expectedActionJSON: action
        )
    }
    #expect(delivered == action)
    // Clock normalization must not add another journal load/replay to the claim.
    #expect(f.journal.loadCount() - loadsBefore == 1)
    let state = try CoordinatorSemanticReplay.replay(f.journal.load())
    let continuation = try #require(state.continuation(id: f.continuationID))
    #expect(continuation.transport?.status == .completed)
    #expect(continuation.transport?.occurredAt.rawValue == "2026-08-21T12:00:02Z")
    #expect(continuation.queuedActionContextClaim?.deliveryTurnID == "delivery_\(suffix)")
    #expect(state.eventSequence == 8)
    #expect(f.journal.appendAttemptCount("continuation_transport_completed") == 1)
    #expect(f.journal.appendAttemptCount("queued_action_context_claimed") == 1)

    // Durable exact retries remain valid after restart, without a live anchor
    // or a new deadline, and never create another claim or dispatch.
    f.clock.advance(seconds: 600)
    let restarted = try routingApplication(journal: f.journal, clock: f.clock)
    #expect(try restarted.routeQueuedActionContextClaim(f.claim) == action)
    #expect(try f.journal.load().journalSequence == 8)
    #expect(f.journal.appendAttemptCount("queued_action_context_claimed") == 1)
    #expect(f.journal.appendAttemptCount("continuation_dispatched") == 1)
}

@Test("queued Hook completion rechecks the real deadline after authority load")
func routingQueuedCompletionChecksDeadlineAfterLoad() throws {
    let f = try routingQueuedDeliveryFixture(
        suffix: "queued_deadline", wallTime: "2026-08-21T12:00:02Z"
    )
    // The continuation was selected at clock=1; admission is still within
    // its 300-second window, but verified replay crosses the deadline.
    f.clock.set(seconds: 300)
    _ = try f.app.processTime()
    f.journal.afterNextLoad { f.clock.set(seconds: 301) }
    let authority = try f.app.queuedActionAuthorityProjection()
    let action = try authority.state.selectedActionJSON(for: f.continuationID)
    let loadsBefore = f.journal.loadCount()
    routingExpectCode("transport_completion_after_in_flight_deadline") {
        _ = try f.app.routeQueuedActionContextClaim(
            f.claim, completingTransportWith: f.completion, closingBoundaryWith: f.close,
            using: authority, expectedActionJSON: action
        )
    }
    #expect(f.journal.loadCount() == loadsBefore)
    #expect(try f.journal.load().journalSequence == 5)
    #expect(f.journal.appendAttemptCount("continuation_transport_completed") == 0)
    #expect(f.journal.appendAttemptCount("queued_action_context_claimed") == 0)
    let notices = try f.app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices.first?["automatic_retry"] as? Bool == false)
    let state = try CoordinatorSemanticReplay.replay(f.journal.load())
    #expect(state.continuation(id: f.continuationID)?.transport?.status == .timedOutUnknown)
    #expect(state.continuation(id: f.continuationID)?.queuedActionContextClaim == nil)
}

@Test("queued Hook completion latches a continuous clock regression until scheduled cleanup")
func routingQueuedCompletionRejectsClockRegression() throws {
    let f = try routingQueuedDeliveryFixture(
        suffix: "queued_regression", wallTime: "2026-08-21T12:00:02Z"
    )
    f.clock.set(seconds: 100)
    _ = try f.app.processTime()
    // Still above the dispatch anchor, but behind the last accepted sample.
    f.journal.afterNextLoad { f.clock.set(seconds: 99) }
    let authority = try f.app.queuedActionAuthorityProjection()
    let action = try authority.state.selectedActionJSON(for: f.continuationID)
    let loadsBefore = f.journal.loadCount()
    for now in [UInt64(99), 100] {
        f.clock.set(seconds: now)
        routingExpectCode("routing_continuation_not_in_flight") {
            _ = try f.app.routeQueuedActionContextClaim(
                f.claim, completingTransportWith: f.completion, closingBoundaryWith: f.close,
                using: authority, expectedActionJSON: action
            )
        }
    }
    #expect(f.journal.loadCount() == loadsBefore)
    #expect(try f.journal.load().journalSequence == 5)
    #expect(f.journal.appendAttemptCount("continuation_transport_completed") == 0)
    #expect(f.journal.appendAttemptCount("queued_action_context_claimed") == 0)
    #expect(f.app.millisecondsUntilNextDeadline() == 0)
    let notices = try f.app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices.first?["automatic_retry"] as? Bool == false)
    let state = try CoordinatorSemanticReplay.replay(f.journal.load())
    #expect(state.continuation(id: f.continuationID)?.transport?.status == .timedOutUnknown)
    #expect(state.continuation(id: f.continuationID)?.queuedActionContextClaim == nil)
    #expect(try f.app.processTime().isEmpty)
}

@Test("restart marks unterminated dispatch unknown without issuing a second action")
func routingRestartInFlightFailsClosed() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let first = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "restart_flight")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "restart_flight",
        sealedAt: "2026-08-21T09:00:00Z"
    )
    try routingSetup(first, suffix: "restart_flight", binding: binding, packet: packet, openedAt: "2026-08-21T08:59:59Z")
    _ = try first.setForeground(routingTarget(packet: packet, binding: binding))
    let envelope = try routingEnvelope(
        first.routeSelection(
            routingSelection(packet: packet, binding: binding, suffix: "restart_flight")
        )
    )
    let beforeRestart = try journal.load().journalSequence

    let restarted = try routingApplication(journal: journal, clock: RoutingFakeClock())
    #expect(try journal.load().journalSequence == beforeRestart + 1)
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    let continuation = try #require(state.continuation(id: "continuation_routing_restart_flight"))
    #expect(continuation.transport?.status == .timedOutUnknown)
    #expect(state.continuations.count == 1)
    #expect(try routingObject(restarted.snapshot().canonicalJSON)["selection_enabled"] as? Bool == false)
    let afterRecovery = try journal.load().journalSequence
    routingExpectCode("routing_continuation_not_in_flight") {
        _ = try restarted.routeConsumePetAction(
            routingConsume(envelope: envelope, suffix: "restart_flight")
        )
    }
    #expect(try journal.load().journalSequence == afterRecovery)
}

@Test("receipt-first completion rejects a deadline crossed by authority replay")
func routingReceiptCompletionChecksDeadlineAfterLoad() throws {
    let f = try routingQueuedDeliveryFixture(
        suffix: "receipt_deadline_probe", wallTime: "2026-08-21T12:00:02Z"
    )
    // Selection is anchored at clock=1. Admission at 300 is valid, but the
    // authenticated projection returns at the exact 300-second deadline.
    f.clock.set(seconds: 300)
    f.journal.afterNextLoad { f.clock.set(seconds: 301) }
    routingExpectCode("transport_completion_after_in_flight_deadline") {
        try f.app.completeTransportAndCloseBoundary(f.completion, close: f.close)
    }
    let snapshot = try f.journal.load()
    let state = try CoordinatorSemanticReplay.replay(snapshot)
    #expect(snapshot.journalSequence == 5)
    #expect(state.continuation(id: f.continuationID)?.transport == nil)
    #expect(f.journal.appendAttemptCount("continuation_transport_completed") == 0)
    #expect(f.journal.appendAttemptCount("queued_action_context_claimed") == 0)
    // Only scheduler cleanup may now make it terminal, without dispatching again.
    let notices = try f.app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices.first?["automatic_retry"] as? Bool == false)
    #expect(try CoordinatorSemanticReplay.replay(f.journal.load())
        .continuation(id: f.continuationID)?.transport?.status == .timedOutUnknown)
}

@Test("format-repair claim rejects authority replay crossing its 120-second window")
func routingRepairClaimChecksDeadlineAfterLoad() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "repair_load_probe")
    _ = try app.executeCommand(routingOpen(
        binding: binding, suffix: "repair_load_probe", occurredAt: "2026-08-21T05:59:59Z"
    ))
    let reserved = try app.executeCommand(routingReserveRepair(
        binding: binding, suffix: "repair_load_probe", occurredAt: "2026-08-21T06:00:00Z"
    ))
    let envelope = try routingEnvelope(reserved)
    clock.set(seconds: 119)
    journal.afterNextLoad { clock.set(seconds: 120) }
    routingExpectCode("routing_format_repair_not_active") {
        _ = try app.executeCommand(routingClaimRepair(envelope: envelope, suffix: "repair_load_probe"))
    }
    let snapshot = try journal.load()
    #expect(snapshot.journalSequence == 2)
    #expect(try CoordinatorSemanticReplay.replay(snapshot)
        .boundary(for: CoordinatorBinding(jsonObject: binding))?.repair?.claimedAt == nil)
    #expect(journal.appendAttemptCount("internal_format_repair_claimed") == 0)
}

@Test("selection rejects a deadline crossed by its packet authority lookup")
func routingSelectionChecksDeadlineAfterLoad() throws {
    let (journal, clock, app, binding, packet) = try routingFocusedFixture(suffix: "selection_load_probe")
    clock.set(seconds: 599)
    // First load belongs to processDueLocked. Advance during the second load,
    // before routeSelection may establish current time authority.
    journal.afterNextLoad { journal.afterNextLoad { clock.set(seconds: 600) } }
    routingExpectCode("routing_interaction_expired") {
        _ = try app.routeSelection(routingSelection(
            packet: packet, binding: binding, suffix: "selection_load_probe"
        ))
    }
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.selection == nil)
    #expect(state.continuations.isEmpty)
    #expect(journal.appendAttemptCount("decision_selection_claimed") == 0)
    #expect(journal.appendAttemptCount("continuation_dispatched") == 0)
}

@Test("seal registration must not adopt another writer's replacement revision")
func routingSealRegistrationRejectsReplacedRevision() throws {
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: "registration_race_probe")
    let packet = try routingPacket(
        binding: binding, validAfter: 2, suffix: "registration_race_probe",
        sealedAt: "2026-08-21T02:00:00Z"
    )
    _ = try app.executeCommand(routingOpen(
        binding: binding, suffix: "registration_race_probe", occurredAt: "2026-08-21T01:59:59Z"
    ))
    var replacement = packet
    replacement["revision"] = 2
    replacement["valid_after_event_sequence"] = 3
    replacement["sealed_at"] = "2026-08-21T02:00:01Z"
    replacement["expires_at"] = "2026-08-21T02:10:01Z"
    let reseal = try routingSeal(packet: replacement, suffix: "registration_race_probe_v2")
    let writer = CoordinatorSemanticApplication(journal: journal)
    journal.afterNextAppend(eventType: "decision_packet_sealed") {
        do { _ = try writer.execute(command: reseal) }
        catch { Issue.record("replacement fixture failed: \(error)") }
    }
    // The initial durable seal may be acknowledged or explicitly rejected, but
    // neither result may install local monotonic authority for writer's rev2.
    do { _ = try app.executeCommand(routingSeal(packet: packet, suffix: "registration_race_probe")) }
    catch let error as CoordinatorError {
        #expect(error.code == "routing_interaction_not_pending" || error.code == "decision_packet_revision_stale")
    }
    let snapshot = try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    routingExpectCode("foreground_target_not_pending") {
        _ = try app.setForeground(routingTarget(packet: replacement, binding: binding))
    }
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.packet(for: try CoordinatorBinding(jsonObject: binding))?.revision == 2)
    #expect(state.eventSequence == 3)
}

private func routingInstallUnrelatedConflict(_ journal: RoutingMemoryJournal, suffix: String) throws {
    journal.installCompetingChange(try CoordinatorSemanticDecision.decide(
        state: CoordinatorSemanticReplay.replay(journal.load()),
        command: routingOpen(binding: routingBinding(suffix: suffix), suffix: suffix,
            occurredAt: "2026-08-21T12:00:03Z")
    ))
}

@Test("selection revalidates final storage admission and conflict reload", arguments: [false, true])
func routingSelectionChecksFinalAdmission(conflict: Bool) throws {
    let suffix = "selection_admission_\(conflict)"
    let (journal, clock, app, binding, packet) = try routingFocusedFixture(suffix: suffix)
    clock.set(seconds: 599)
    if conflict { try routingInstallUnrelatedConflict(journal, suffix: suffix + "_writer") }
    journal.beforeNextAdmission(eventType: "decision_selection_claimed") {
        if conflict { journal.afterNextLoad { clock.set(seconds: 600) } }
        else { clock.set(seconds: 600) }
    }
    routingExpectCode("routing_interaction_expired") {
        _ = try app.routeSelection(routingSelection(packet: packet, binding: binding, suffix: suffix))
    }
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.selection == nil)
    #expect(state.continuations.isEmpty)
    #expect(journal.appendAttemptCount("decision_selection_claimed") == (conflict ? 1 : 0))
    #expect(try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)["selection_enabled"] as? Bool == false)
}

@Test("receipt and generic completion revalidate storage admission and conflict reload",
      arguments: ["receipt", "generic"], [false, true])
func routingCompletionChecksFinalAdmission(path: String, conflict: Bool) throws {
    let suffix = "completion_admission_\(path)_\(conflict)"
    let f = try routingQueuedDeliveryFixture(suffix: suffix, wallTime: "2026-08-21T12:00:02Z")
    f.clock.set(seconds: 300)
    if conflict { try routingInstallUnrelatedConflict(f.journal, suffix: suffix + "_writer") }
    f.journal.beforeNextAdmission(eventType: "continuation_transport_completed") {
        if conflict { f.journal.afterNextLoad { f.clock.set(seconds: 301) } }
        else { f.clock.set(seconds: 301) }
    }
    routingExpectCode("transport_completion_after_in_flight_deadline") {
        if path == "receipt" { try f.app.completeTransportAndCloseBoundary(f.completion, close: f.close) }
        else { _ = try f.app.executeCommand(f.completion) }
    }
    let state = try CoordinatorSemanticReplay.replay(f.journal.load())
    #expect(state.continuation(id: f.continuationID)?.transport == nil)
    #expect(state.continuation(id: f.continuationID)?.queuedActionContextClaim == nil)
    #expect(f.journal.appendAttemptCount("continuation_transport_completed") == (conflict ? 1 : 0))
    let notices = try f.app.processTime().map(routingObject)
    #expect(notices.count == 1)
    #expect(notices.first?["automatic_retry"] as? Bool == false)
    #expect(f.journal.appendAttemptCount("continuation_dispatched") == 1)
}

@Test("Hook-first atomic batch rejects a deadline crossed during storage validation")
func routingQueuedCompletionChecksFinalAdmission() throws {
    let f = try routingQueuedDeliveryFixture(suffix: "hook_admission", wallTime: "2026-08-21T12:00:02Z")
    f.clock.set(seconds: 300)
    let authority = try f.app.queuedActionAuthorityProjection()
    let action = try authority.state.selectedActionJSON(for: f.continuationID)
    f.journal.beforeNextAdmission(eventType: "continuation_transport_completed") { f.clock.set(seconds: 301) }
    routingExpectCode("transport_completion_after_in_flight_deadline") {
        _ = try f.app.routeQueuedActionContextClaim(f.claim, completingTransportWith: f.completion,
            closingBoundaryWith: f.close, using: authority, expectedActionJSON: action)
    }
    #expect(try f.journal.load().journalSequence == 5)
    #expect(f.journal.appendAttemptCount("queued_action_context_claimed") == 0)
    #expect(f.journal.appendAttemptCount("continuation_transport_completed") == 0)
}

@Test("repair claim revalidates semantic load, storage admission, and conflict reload",
      arguments: ["semantic_load", "append", "conflict"])
func routingRepairChecksFinalAdmission(phase: String) throws {
    let suffix = "repair_admission_\(phase)"
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: suffix)
    _ = try app.executeCommand(routingOpen(binding: binding, suffix: suffix, occurredAt: "2026-08-21T05:59:59Z"))
    let envelope = try routingEnvelope(app.executeCommand(routingReserveRepair(
        binding: binding, suffix: suffix, occurredAt: "2026-08-21T06:00:00Z")))
    clock.set(seconds: 119)
    if phase == "semantic_load" {
        journal.afterNextLoad { journal.afterNextLoad { clock.set(seconds: 120) } }
    } else {
        if phase == "conflict" { try routingInstallUnrelatedConflict(journal, suffix: suffix + "_writer") }
        journal.beforeNextAdmission(eventType: "internal_format_repair_claimed") {
            if phase == "conflict" { journal.afterNextLoad { clock.set(seconds: 120) } }
            else { clock.set(seconds: 120) }
        }
    }
    routingExpectCode("routing_format_repair_not_active") {
        _ = try app.executeCommand(routingClaimRepair(envelope: envelope, suffix: suffix))
    }
    #expect(try CoordinatorSemanticReplay.replay(journal.load())
        .boundary(for: CoordinatorBinding(jsonObject: binding))?.repair?.claimedAt == nil)
    #expect(journal.appendAttemptCount("internal_format_repair_claimed") == (phase == "conflict" ? 1 : 0))
}

@Test("token consumption revalidates storage admission and conflict reload", arguments: [false, true])
func routingConsumeChecksFinalAdmission(conflict: Bool) throws {
    let suffix = "consume_admission_\(conflict)"
    let (journal, clock, app, binding, packet) = try routingFocusedFixture(suffix: suffix)
    let envelope = try routingEnvelope(app.routeSelection(routingSelection(packet: packet, binding: binding, suffix: suffix)))
    clock.set(seconds: 119)
    if conflict { try routingInstallUnrelatedConflict(journal, suffix: suffix + "_writer") }
    journal.beforeNextAdmission(eventType: "continuation_consumed") {
        if conflict { journal.afterNextLoad { clock.set(seconds: 120) } }
        else { clock.set(seconds: 120) }
    }
    routingExpectCode("continuation_expired") {
        _ = try app.routeConsumePetAction(routingConsume(envelope: envelope, suffix: suffix))
    }
    let continuation = try #require(CoordinatorSemanticReplay.replay(journal.load()).continuations.values.first)
    #expect(continuation.consumedAt == nil)
    #expect(journal.appendAttemptCount("continuation_consumed") == (conflict ? 1 : 0))
}

@Test("regression cleanup failure cannot revive authority when the clock catches up")
func routingClockRegressionRemainsLatchedAfterCleanupFailure() throws {
    let (journal, clock, app, binding, packet) = try routingFocusedFixture(suffix: "regression_latch")
    clock.set(seconds: 100)
    _ = try app.processTime()
    clock.set(seconds: 99)
    journal.failNextAppend(eventType: "interaction_expired")
    routingExpectCode("test_append_failed") { _ = try app.processTime() }
    clock.set(seconds: 101)
    routingExpectCode("routing_interaction_not_pending") {
        _ = try app.routeSelection(routingSelection(packet: packet, binding: binding, suffix: "regression_latch"))
    }
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.expired == true)
    #expect(state.continuations.isEmpty)
}

@Test("dismissal rejects expiry during final storage admission without closing the card")
func routingDismissChecksFinalAdmission() throws {
    let suffix = "dismiss_admission"
    let journal = RoutingMemoryJournal()
    let clock = RoutingFakeClock()
    let app = try routingApplication(journal: journal, clock: clock)
    let binding = routingBinding(suffix: suffix)
    var packet = try routingPacket(binding: binding, validAfter: 2, suffix: suffix,
        sealedAt: "2026-08-21T02:00:00Z")
    packet["decision_layout"] = "ranked_next_actions"
    packet["choices"] = Array(try #require(packet["choices"] as? [[String: Any]]).prefix(2))
    try routingSetup(app, suffix: suffix, binding: binding, packet: packet,
        openedAt: "2026-08-21T01:59:59Z")
    let target = try routingTarget(packet: packet, binding: binding)
    _ = try app.setForeground(target)
    let before = try journal.load()
    clock.set(seconds: 599)
    journal.beforeNextAdmission(eventType: "decision_boundary_closed") { clock.set(seconds: 600) }
    let close = try routingData([
        "type": "close_boundary", "event_id": "event_dismiss_admission",
        "occurred_at": "2026-08-21T02:09:59Z", "binding": binding, "close_reason": "user_dismissed",
    ])
    routingExpectCode("interaction_not_waiting") { try app.dismissInteraction(target, closingWith: close) }
    #expect(try journal.load() == before)
    #expect(journal.appendAttemptCount("decision_boundary_closed") == 0)
    #expect(try routingObject(app.snapshotWithoutProcessingTime().canonicalJSON)["selection_enabled"] as? Bool == false)
}
