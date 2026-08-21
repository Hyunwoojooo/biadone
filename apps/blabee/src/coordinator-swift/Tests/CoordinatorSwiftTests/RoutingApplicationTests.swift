import Foundation
import Testing
@testable import CoordinatorSwift

private let routingRepositoryRoot: URL = {
    URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
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

    func load() throws -> JournalSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data]
    ) throws -> JournalAppendResult {
        lock.lock()
        defer { lock.unlock() }
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
        let candidate = JournalSnapshot(
            events: stored.events + events,
            documents: stored.documents + documents,
            verificationRecords: stored.verificationRecords + verificationRecords,
            journalSequence: expectedSequence + Int64(events.count)
        )
        _ = try CoordinatorSemanticReplay.replay(candidate)
        stored = candidate
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

    clock.advance(seconds: 30)
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

@Test("restart expires ambiguous pending state and never restores foreground")
func routingRestartPendingFailsClosed() throws {
    let journal = RoutingMemoryJournal()
    let semantic = CoordinatorSemanticApplication(journal: journal)
    let binding = routingBinding(suffix: "restart_pending")
    let packet = try routingPacket(
        binding: binding,
        validAfter: 2,
        suffix: "restart_pending",
        sealedAt: "2026-08-21T06:00:00Z"
    )
    _ = try semantic.execute(
        command: routingOpen(binding: binding, suffix: "restart_pending", occurredAt: "2026-08-21T05:59:59Z")
    )
    _ = try semantic.execute(command: routingSeal(packet: packet, suffix: "restart_pending"))

    let app = try routingApplication(journal: journal, clock: RoutingFakeClock())
    let state = try CoordinatorSemanticReplay.replay(journal.load())
    #expect(state.pendingInteractions.isEmpty)
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.expired == true)
    let snapshot = try routingObject(app.snapshot().canonicalJSON)
    #expect(snapshot["selection_enabled"] as? Bool == false)
    #expect((snapshot["pending"] as? [Any])?.isEmpty == true)
    let notices = try app.processTime().map(routingObject)
    #expect(notices.first?["reason"] as? String == "restart_elapsed_ambiguous")
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
    clock.advance(seconds: 120)
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
    clock.advance(seconds: 120)

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
