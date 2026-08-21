import Foundation
import Testing
@testable import CoordinatorSwift

private func operationalData(_ object: Any) throws -> Data {
    try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
}

private func operationalObject(_ data: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CoordinatorError("test_json_invalid")
    }
    return object
}

private final class OperationalMemoryJournal: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let lock = NSLock()
    private var snapshot = JournalSnapshot(
        events: [],
        documents: [],
        verificationRecords: [],
        journalSequence: 0
    )
    private var failuresByEventType: [String: Int] = [:]
    private var loadFailuresAfterFailureByEventType: [String: Int] = [:]
    private var lostResponsesByEventType: [String: Int] = [:]
    private var loadFailuresAfterLostResponseByEventType: [String: Int] = [:]
    private var loadFailuresRemaining = 0

    func load() throws -> JournalSnapshot {
        lock.lock()
        defer { lock.unlock() }
        if loadFailuresRemaining > 0 {
            loadFailuresRemaining -= 1
            throw CoordinatorError("simulated_load_failure")
        }
        return snapshot
    }

    func append(
        expectedSequence: Int64,
        events: [Data],
        documents: [Data],
        verificationRecords: [Data]
    ) throws -> JournalAppendResult {
        lock.lock()
        defer { lock.unlock() }
        for eventData in events {
            guard let event = try JSONSerialization.jsonObject(with: eventData) as? [String: Any],
                  let eventType = event["event_type"] as? String,
                  let remaining = failuresByEventType[eventType],
                  remaining > 0
            else { continue }
            failuresByEventType[eventType] = remaining - 1
            loadFailuresRemaining += loadFailuresAfterFailureByEventType[eventType] ?? 0
            loadFailuresAfterFailureByEventType[eventType] = 0
            throw CoordinatorError("injected_append_failure")
        }
        guard snapshot.journalSequence == expectedSequence else {
            throw CoordinatorError("journal_sequence_conflict")
        }
        let candidate = JournalSnapshot(
            events: snapshot.events + events,
            documents: snapshot.documents + documents,
            verificationRecords: snapshot.verificationRecords + verificationRecords,
            journalSequence: expectedSequence + Int64(events.count)
        )
        _ = try CoordinatorSemanticReplay.replay(candidate)
        snapshot = candidate
        let result = JournalAppendResult(
            firstSequence: expectedSequence + 1,
            lastSequence: candidate.journalSequence,
            eventCount: events.count
        )
        for eventData in events {
            guard let event = try JSONSerialization.jsonObject(with: eventData) as? [String: Any],
                  let eventType = event["event_type"] as? String,
                  let remaining = lostResponsesByEventType[eventType],
                  remaining > 0
            else { continue }
            lostResponsesByEventType[eventType] = remaining - 1
            loadFailuresRemaining += loadFailuresAfterLostResponseByEventType[eventType] ?? 0
            loadFailuresAfterLostResponseByEventType[eventType] = 0
            throw CoordinatorError("simulated_lost_response")
        }
        return result
    }

    func failNextAppend(
        eventType: String,
        failFollowingLoads: Int = 0
    ) {
        lock.lock()
        failuresByEventType[eventType, default: 0] += 1
        loadFailuresAfterFailureByEventType[eventType, default: 0]
            += failFollowingLoads
        lock.unlock()
    }

    func loseNextCommittedResponse(
        eventType: String,
        failFollowingLoads: Int = 0
    ) {
        lock.lock()
        lostResponsesByEventType[eventType, default: 0] += 1
        loadFailuresAfterLostResponseByEventType[eventType, default: 0]
            += failFollowingLoads
        lock.unlock()
    }
}

private final class OperationalClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 0

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

private final class OperationalIDs: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func next(_ purpose: String) -> String {
        lock.lock()
        value += 1
        let current = value
        lock.unlock()
        return "id_\(purpose)_\(String(format: "%016d", current))"
    }
}

private final class OperationalTokens: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [ContinuationTokenMaterial] = []

    func next() throws -> ContinuationTokenMaterial {
        let value = try ContinuationTokenMaterial.generate()
        lock.lock()
        values.append(value)
        lock.unlock()
        return value
    }

    func token(at index: Int) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard values.indices.contains(index) else { return nil }
        return values[index].token
    }
}

private struct OperationalFixture {
    let app: CoordinatorOperationalApplication
    let journal: OperationalMemoryJournal
    let clock: OperationalClock
    let tokens: OperationalTokens
}

private func operationalFixture() throws -> OperationalFixture {
    let journal = OperationalMemoryJournal()
    let clock = OperationalClock()
    let ids = OperationalIDs()
    let tokens = OperationalTokens()
    let routing = try CoordinatorRoutingApplication(
        journal: journal,
        clock: clock,
        tokenGenerator: tokens.next,
        eventIDGenerator: ids.next
    )
    let app = CoordinatorOperationalApplication(
        routing: routing,
        secretCorpus: RuntimeSecretCorpus(),
        idGenerator: ids.next,
        wallInstantGenerator: { try RFC3339Instant("2026-08-21T12:00:00Z") },
        stopObservationHMACKey: Data(repeating: 0xA5, count: 32)
    )
    return OperationalFixture(app: app, journal: journal, clock: clock, tokens: tokens)
}

private func contextValue(_ context: String, key: String) throws -> String {
    let marker = key + "="
    guard let start = context.range(of: marker)?.upperBound else {
        throw CoordinatorError("test_context_invalid")
    }
    let suffix = context[start...]
    let end = suffix.firstIndex(where: { $0 == ";" || $0 == "." }) ?? suffix.endIndex
    return String(suffix[..<end])
}

private func operationalBegin(
    _ fixture: OperationalFixture,
    suffix: String = "alpha"
) async throws -> [String: String] {
    let cwd = "/tmp/blabee-operational-\(suffix)"
    let projectID = "project_operational_\(suffix)"
    let sessionID = "session_operational_\(suffix)"
    let turnID = "turn_operational_\(suffix)"
    _ = try await fixture.app.handle(type: "enable_project", payload: operationalData([
        "cwd": cwd,
        "project_id": projectID,
    ]))
    _ = try await fixture.app.handle(type: "session_start", payload: operationalData([
        "session_id": sessionID,
        "cwd": cwd,
        "hook_event_name": "SessionStart",
    ]))
    let prompt = try operationalObject(
        await fixture.app.handle(type: "user_prompt_submit", payload: operationalData([
            "session_id": sessionID,
            "turn_id": turnID,
            "cwd": cwd,
            "prompt": "Implement the operational test \(suffix)",
            "hook_event_name": "UserPromptSubmit",
        ]))
    )
    let identifiers = try #require(prompt["identifiers"] as? [String: Any])
    #expect(identifiers["correlation_token"] == nil)
    let context = try #require(prompt["additionalContext"] as? String)
    return [
        "cwd": cwd,
        "project_id": projectID,
        "session_id": sessionID,
        "source_turn_id": turnID,
        "source_prompt_id": try #require(identifiers["source_prompt_id"] as? String),
        "episode_id": try #require(identifiers["episode_id"] as? String),
        "correlation_token": try contextValue(context, key: "correlation_token"),
    ]
}

private func operationalProposal(
    _ ids: [String: String],
    suffix: String,
    alternative: Bool = true
) -> [String: Any] {
    [
        "schema_version": "1.0",
        "proposal_id": "proposal_operational_\(suffix)",
        "correlation_token": ids["correlation_token"]!,
        "interaction_kind": "blabee_decision",
        "task_goal": "Operational goal \(suffix)",
        "outcome": ["status": "completed", "summary": "Operational summary \(suffix)"],
        "recommended_next": [
            "title": "Recommended \(suffix)",
            "objective": "Run recommended work \(suffix)",
            "constraints": ["Keep the binding exact"],
            "done_when": ["The focused test passes"],
        ],
        "alternative_next": alternative ? [
            "title": "Alternative \(suffix)",
            "objective": "Run alternative work \(suffix)",
            "constraints": ["Do not reinterpret slot two"],
            "done_when": ["The alternative is recorded"],
        ] : NSNull(),
        "pause_capsule": ["resume_first": "Re-open the operational report"],
        "reported_side_effects": [],
    ]
}

private func operationalWrapper(
    _ ids: [String: String],
    proposal: [String: Any]
) -> [String: Any] {
    [
        "project_id": ids["project_id"]!,
        "session_id": ids["session_id"]!,
        "source_turn_id": ids["source_turn_id"]!,
        "source_prompt_id": ids["source_prompt_id"]!,
        "episode_id": ids["episode_id"]!,
        "correlation_token": ids["correlation_token"]!,
        "proposal": proposal,
    ]
}

private func waitForOperationalInteraction(
    _ app: CoordinatorOperationalApplication,
    boundarySequence: Int64 = 1,
    state requiredState: String? = nil
) async throws -> [String: Any] {
    for _ in 0..<100 {
        let state = try operationalObject(await app.handle(type: "get_state", payload: operationalData([:])))
        if let interactions = state["interactions"] as? [[String: Any]],
           let interaction = interactions.first(where: {
               ExactJSONInteger.int64($0["boundary_sequence"], minimum: 1) == boundarySequence
                   && (requiredState == nil || $0["state"] as? String == requiredState)
           })
        {
            return interaction
        }
        await Task.yield()
    }
    throw CoordinatorError("test_interaction_missing")
}

private func operationalSelection(
    _ interaction: [String: Any],
    slot: Int
) throws -> [String: Any] {
    let choices = try #require(interaction["choices"] as? [[String: Any]])
    let choice = try #require(choices.first(where: {
        ExactJSONInteger.int64($0["slot"], minimum: 1) == Int64(slot)
    }))
    var request: [String: Any] = [
        "schema_version": "1.0",
        "kind": "blabee_selection_request",
        "selection_id": "selection_operational_\(slot)_\(interaction["boundary_sequence"]!)",
        "interaction_id": interaction["interaction_id"]!,
        "packet_id": interaction["packet_id"]!,
        "revision": interaction["revision"]!,
        "option_id": choice["option_id"]!,
    ]
    for key in [
        "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
        "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id",
        "boundary_sequence",
    ] {
        request[key] = interaction[key]
    }
    return request
}

private func operationalStop(
    ids: [String: String],
    active: Bool,
    message: String
) throws -> Data {
    try operationalData([
        "session_id": ids["session_id"]!,
        "turn_id": ids["source_turn_id"]!,
        "stop_hook_active": active,
        "last_assistant_message": message,
        "hook_event_name": "Stop",
    ])
}

private func expectOperationalError(
    _ code: String,
    operation: () async throws -> Void
) async {
    do {
        try await operation()
        Issue.record("expected error \(code)")
    } catch let error as CoordinatorError {
        #expect(error.code == code)
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

private func expectAnyOperationalError(
    operation: () async throws -> Void
) async {
    do {
        try await operation()
        Issue.record("expected CoordinatorError")
    } catch is CoordinatorError {
        return
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

@Test("Operational proposal seals rollback-disabled packet and consumes token before Stop completion")
func operationalPacketSelectionAndCompletion() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture)
    let proposal = operationalProposal(ids, suffix: "first", alternative: false)
    let wrapper = operationalWrapper(ids, proposal: proposal)
    let acceptedData = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(wrapper)
    )
    #expect(try await fixture.app.handle(type: "emit_decision", payload: operationalData(wrapper)) == acceptedData)
    let accepted = try operationalObject(acceptedData)
    let packet = try #require(accepted["packet"] as? [String: Any])
    #expect((packet["checkpoint"] as? [String: Any])?["coverage"] as? String == "unavailable")
    let choices = try #require(packet["choices"] as? [[String: Any]])
    #expect(choices[1]["enabled"] as? Bool == false)
    #expect(choices[3]["disabled_reason"] as? String == "rollback_not_enabled_in_build")

    var conflict = proposal
    conflict["task_goal"] = "Different body"
    await expectOperationalError("proposal_id_conflict") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(ids, proposal: conflict))
        )
    }

    let stopPayload = try operationalStop(ids: ids, active: false, message: "first assistant message")
    let stopTask = Task { try await fixture.app.handle(type: "stop", payload: stopPayload) }
    let interaction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let selected = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(interaction, slot: 1))
    )
    let stopResult = try await stopTask.value
    let rawToken = try #require(fixture.tokens.token(at: 0))
    #expect(!selected.contains(Data(rawToken.utf8)))
    #expect(!stopResult.contains(Data(rawToken.utf8)))
    #expect(!stopResult.contains(Data("continuation_token".utf8)))

    var state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    let continuation = try #require(state.continuations.values.first)
    #expect(continuation.consumedAt != nil)
    #expect(continuation.transport == nil)

    let ambiguous = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: true, message: "first assistant message")
        )
    )
    #expect(ambiguous["reason"] as? String == "stop_delivery_observation_ambiguous")
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.transport == nil)

    let completed = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: true, message: "selected work returned")
        )
    )
    #expect(completed["status"] as? String == "continuation_completed")
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.transport?.status == .completed)
    #expect(state.boundaries.values.first?.closed == true)
}

@Test("Operational initial activation resumes exact packet after seal append failure")
func operationalInitialActivationRetry() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "initial_retry")
    let proposal = operationalProposal(ids, suffix: "initial_retry")
    let wrapper = operationalWrapper(ids, proposal: proposal)

    fixture.journal.failNextAppend(eventType: "decision_packet_sealed")
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(wrapper)
        )
    }
    var journalSnapshot = try fixture.journal.load()
    #expect(journalSnapshot.journalSequence == 1)
    #expect(journalSnapshot.documents.isEmpty)

    // Pet polling is also a reconciliation tick. It must seal the packet that
    // was constructed for the durable open, without appending a second open.
    let snapshot = try operationalObject(
        await fixture.app.handle(type: "get_state", payload: operationalData([:]))
    )
    let interaction = try #require((snapshot["interactions"] as? [[String: Any]])?.first)
    let accepted = try operationalObject(
        await fixture.app.handle(type: "emit_decision", payload: operationalData(wrapper))
    )
    let packet = try #require(accepted["packet"] as? [String: Any])
    #expect(packet["packet_id"] as? String == interaction["packet_id"] as? String)
    journalSnapshot = try fixture.journal.load()
    #expect(journalSnapshot.journalSequence == 2)
    #expect(journalSnapshot.documents.count == 1)
    #expect(try CoordinatorSemanticReplay.replay(journalSnapshot).boundaries.count == 1)
}

@Test("Operational recovers committed open and seal responses without duplicate events")
func operationalCommittedActivationResponseLoss() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "activation_response_loss")
    fixture.journal.loseNextCommittedResponse(eventType: "decision_boundary_opened")
    fixture.journal.loseNextCommittedResponse(eventType: "decision_packet_sealed")

    let accepted = try operationalObject(
        await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(
                ids,
                proposal: operationalProposal(ids, suffix: "activation_response_loss")
            ))
        )
    )
    #expect(accepted["accepted"] as? Bool == true)
    let journalSnapshot = try fixture.journal.load()
    #expect(journalSnapshot.journalSequence == 2)
    #expect(journalSnapshot.events.count == 2)
    #expect(journalSnapshot.documents.count == 1)

    // A committed seal whose response was lost must also restore routing's
    // process-local pending authority, otherwise this exact selection fails.
    let stopTask = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: false,
                message: "committed activation response was recovered"
            )
        )
    }
    let interaction = try await waitForOperationalInteraction(
        fixture.app,
        state: "waiting"
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(interaction, slot: 3))
    )
    #expect(try operationalObject(await stopTask.value)["status"] as? String == "paused")
}

@Test("Operational seal recovery preserves the original monotonic expiry anchor")
func operationalCommittedSealDelayedRecoveryExpires() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "seal_delayed_recovery")
    let wrapper = operationalWrapper(
        ids,
        proposal: operationalProposal(ids, suffix: "seal_delayed_recovery")
    )
    fixture.journal.loseNextCommittedResponse(
        eventType: "decision_packet_sealed",
        failFollowingLoads: 1
    )
    await expectOperationalError("simulated_load_failure") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(wrapper)
        )
    }
    #expect(try fixture.journal.load().journalSequence == 2)

    fixture.clock.advance(seconds: 120)
    fixture.journal.failNextAppend(eventType: "interaction_expired")
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(wrapper)
        )
    }
    #expect(
        try CoordinatorSemanticReplay.replay(fixture.journal.load())
            .boundaries.values.first?.expired == false
    )
    fixture.journal.loseNextCommittedResponse(
        eventType: "interaction_expired",
        failFollowingLoads: 1
    )
    await expectOperationalError("simulated_load_failure") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(wrapper)
        )
    }
    let snapshot = try operationalObject(
        await fixture.app.handle(type: "get_state", payload: operationalData([:]))
    )
    #expect((snapshot["interactions"] as? [[String: Any]])?.isEmpty == true)
    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.values.first?.expired == true)
    #expect(state.boundaries.values.first?.closed == true)
    let expiryEvents = try fixture.journal.load().events.filter {
        try operationalObject($0)["event_type"] as? String == "interaction_expired"
    }
    #expect(expiryEvents.count == 1)
}

@Test("Operational staged boundary reuses completion Stop only as waiter and rejects its replay")
func operationalTwoBoundariesRejectOldStopReplay() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "two")
    let first = operationalProposal(ids, suffix: "two_first")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(ids, proposal: first))
    )
    let firstWait = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: false, message: "boundary one ready")
        )
    }
    let firstInteraction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(firstInteraction, slot: 1))
    )
    _ = try await firstWait.value

    let second = operationalProposal(ids, suffix: "two_second")
    let staged = try operationalObject(
        await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(ids, proposal: second))
        )
    )
    #expect(staged["staged"] as? Bool == true)

    let deliveryStop = try operationalStop(
        ids: ids,
        active: true,
        message: "boundary one continuation returned"
    )
    let secondWait = Task { try await fixture.app.handle(type: "stop", payload: deliveryStop) }
    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(secondInteraction, slot: 1))
    )
    _ = try await secondWait.value

    let duplicate = try operationalObject(
        await fixture.app.handle(type: "stop", payload: deliveryStop)
    )
    #expect(duplicate["status"] as? String == "duplicate_stop_observation")
    var state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.filter { $0.transport == nil }.count == 1)

    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(ids: ids, active: true, message: "boundary two continuation returned")
    )
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.allSatisfy { $0.consumedAt != nil && $0.transport?.status == .completed })
}

@Test("Operational completion and staged activation resume after partial appends")
func operationalCompletionAndStagedActivationRetry() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "partial_retry")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "partial_retry_first")
        ))
    )
    let firstWait = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: false, message: "partial retry first ready")
        )
    }
    let firstInteraction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(firstInteraction, slot: 1))
    )
    _ = try await firstWait.value
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "partial_retry_second")
        ))
    )

    fixture.journal.failNextAppend(eventType: "continuation_transport_completed")
    fixture.journal.failNextAppend(eventType: "decision_boundary_closed")
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: true,
                message: "partial retry first continuation returned"
            )
        )
    }
    var state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.transport == nil)
    #expect(state.boundaries.count == 1)
    #expect(state.boundaries.values.first?.closed == false)

    // The consumed Stop cannot be replayed, so the empty scheduler tick must
    // retry transport completion. Its following close append fails once too.
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.processTime()
    }
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.transport?.status == .completed)
    #expect(state.boundaries.values.first?.closed == false)

    // Recovery first closes boundary one, then deliberately loses the seal
    // append for boundary two after its open was committed.
    fixture.journal.failNextAppend(eventType: "decision_packet_sealed")
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.processTime()
    }
    var journalSnapshot = try fixture.journal.load()
    state = try CoordinatorSemanticReplay.replay(journalSnapshot)
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.filter(\.closed).count == 1)
    #expect(journalSnapshot.documents.count == 1)

    // The completion key, staged mapping, durable-open sequence, and exact
    // packet all remain retry anchors. An empty tick seals without reopening.
    _ = try await fixture.app.processTime()
    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2
    )
    journalSnapshot = try fixture.journal.load()
    #expect(journalSnapshot.documents.count == 2)
    #expect(try CoordinatorSemanticReplay.replay(journalSnapshot).boundaries.count == 2)

    let secondWait = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: true,
                message: "partial retry promoted boundary ready"
            )
        )
    }
    _ = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(secondInteraction, slot: 1))
    )
    _ = try await secondWait.value
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: ids,
            active: true,
            message: "partial retry second continuation returned"
        )
    )
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.allSatisfy { $0.transport?.status == .completed })
}

@Test("Operational completion response losses promote one staged successor exactly once")
func operationalCommittedCompletionResponseLoss() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "completion_response_loss")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "completion_response_loss_first")
        ))
    )
    let firstWait = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: false,
                message: "completion response loss first ready"
            )
        )
    }
    let firstInteraction = try await waitForOperationalInteraction(
        fixture.app,
        state: "waiting"
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(firstInteraction, slot: 1))
    )
    _ = try await firstWait.value
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "completion_response_loss_second")
        ))
    )

    fixture.journal.loseNextCommittedResponse(eventType: "continuation_transport_completed")
    await expectOperationalError("simulated_lost_response") {
        _ = try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: true,
                message: "completion response was lost"
            )
        )
    }
    fixture.journal.loseNextCommittedResponse(eventType: "decision_boundary_closed")
    await expectOperationalError("simulated_lost_response") {
        _ = try await fixture.app.processTime()
    }
    _ = try await fixture.app.processTime()
    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2
    )

    let snapshot = try fixture.journal.load()
    let eventTypes = try snapshot.events.map {
        try #require(operationalObject($0)["event_type"] as? String)
    }
    #expect(eventTypes.filter { $0 == "continuation_transport_completed" }.count == 1)
    #expect(eventTypes.filter { $0 == "decision_boundary_closed" }.count == 1)
    #expect(eventTypes.filter { $0 == "decision_boundary_opened" }.count == 2)
    #expect(eventTypes.filter { $0 == "decision_packet_sealed" }.count == 2)

    let secondWait = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: true,
                message: "completion response loss promoted ready"
            )
        )
    }
    _ = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(secondInteraction, slot: 3))
    )
    #expect(try operationalObject(await secondWait.value)["status"] as? String == "paused")
    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.allSatisfy { $0.closed })
}

@Test("Operational timeout notice cannot orphan a successor promoted in the same tick")
func operationalCompletionTimeoutPromotionInterleaving() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "timeout_interleave")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "timeout_interleave_first")
        ))
    )
    let firstWait = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: false, message: "interleave first ready")
        )
    }
    let firstInteraction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(firstInteraction, slot: 1))
    )
    _ = try await firstWait.value
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "timeout_interleave_second")
        ))
    )

    fixture.journal.failNextAppend(eventType: "continuation_transport_completed")
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: true,
                message: "interleave completion append failed"
            )
        )
    }
    fixture.clock.advance(seconds: 300)

    // One tick both observes the routing timeout and retries the pending
    // completion workflow. The old timeout notice must not remove boundary
    // two after that boundary was promoted earlier in this same tick.
    _ = try await fixture.app.processTime()
    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2
    )
    let secondWait = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: true,
                message: "interleave promoted boundary ready"
            )
        )
    }
    _ = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(secondInteraction, slot: 1))
    )
    _ = try await secondWait.value
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: ids,
            active: true,
            message: "interleave second continuation returned"
        )
    )
    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.contains { $0.transport?.status == .timedOutUnknown })
    #expect(state.continuations.values.contains { $0.transport?.status == .completed })
}

@Test("Operational selection response loss never reissues action tokens and releases waiters")
func operationalCommittedSelectionResponseLoss() async throws {
    let actionFixture = try operationalFixture()
    let actionIDs = try await operationalBegin(actionFixture, suffix: "select_loss_action")
    _ = try await actionFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            actionIDs,
            proposal: operationalProposal(actionIDs, suffix: "select_loss_action")
        ))
    )
    let actionWait = Task {
        try await actionFixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: actionIDs,
                active: false,
                message: "selection action response loss"
            )
        )
    }
    let actionInteraction = try await waitForOperationalInteraction(
        actionFixture.app,
        state: "waiting"
    )
    actionFixture.journal.loseNextCommittedResponse(
        eventType: "decision_selection_claimed",
        failFollowingLoads: 3
    )
    await expectOperationalError("simulated_load_failure") {
        _ = try await actionFixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(actionInteraction, slot: 1))
        )
    }
    #expect(await actionFixture.app.millisecondsUntilNextDeadline() == 250)
    actionFixture.clock.advance(seconds: 300)
    #expect(await actionFixture.app.millisecondsUntilNextDeadline() == 250)
    for _ in 0..<2 {
        await expectOperationalError("simulated_load_failure") {
            _ = try await actionFixture.app.processTime()
        }
        #expect(await actionFixture.app.millisecondsUntilNextDeadline() == 250)
    }
    _ = try await actionFixture.app.processTime()
    let failedClosed = try await actionWait.value
    #expect(
        try operationalObject(failedClosed)["status"] as? String
            == "continuation_dispatch_failed_closed"
    )
    let rawToken = try #require(actionFixture.tokens.token(at: 0))
    #expect(!failedClosed.contains(Data(rawToken.utf8)))
    var state = try CoordinatorSemanticReplay.replay(actionFixture.journal.load())
    #expect(state.continuations.values.first?.consumedAt == nil)
    #expect(state.boundaries.values.first?.closed == true)
    #expect(state.continuations.values.first?.transport?.status == .timedOutUnknown)

    let pauseFixture = try operationalFixture()
    let pauseIDs = try await operationalBegin(pauseFixture, suffix: "select_loss_pause")
    _ = try await pauseFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            pauseIDs,
            proposal: operationalProposal(pauseIDs, suffix: "select_loss_pause")
        ))
    )
    let pauseWait = Task {
        try await pauseFixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: pauseIDs,
                active: false,
                message: "selection pause response loss"
            )
        )
    }
    let pauseInteraction = try await waitForOperationalInteraction(
        pauseFixture.app,
        state: "waiting"
    )
    pauseFixture.journal.loseNextCommittedResponse(
        eventType: "decision_selection_claimed",
        failFollowingLoads: 1
    )
    await expectOperationalError("simulated_load_failure") {
        _ = try await pauseFixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(pauseInteraction, slot: 3))
        )
    }
    _ = try await pauseFixture.app.processTime()
    #expect(try operationalObject(await pauseWait.value)["status"] as? String == "paused")
    state = try CoordinatorSemanticReplay.replay(pauseFixture.journal.load())
    #expect(state.boundaries.values.first?.closed == true)

    let retryFixture = try operationalFixture()
    let retryIDs = try await operationalBegin(retryFixture, suffix: "select_uncommitted_retry")
    _ = try await retryFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            retryIDs,
            proposal: operationalProposal(retryIDs, suffix: "select_uncommitted_retry")
        ))
    )
    let retryWait = Task {
        try await retryFixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: retryIDs,
                active: false,
                message: "selection uncommitted retry"
            )
        )
    }
    let retryInteraction = try await waitForOperationalInteraction(
        retryFixture.app,
        state: "waiting"
    )
    let retrySelection = try operationalSelection(retryInteraction, slot: 1)
    retryFixture.journal.failNextAppend(
        eventType: "decision_selection_claimed",
        failFollowingLoads: 1
    )
    await expectOperationalError("simulated_load_failure") {
        _ = try await retryFixture.app.handle(
            type: "select",
            payload: operationalData(retrySelection)
        )
    }
    _ = try await retryFixture.app.processTime()
    _ = try await waitForOperationalInteraction(retryFixture.app, state: "waiting")
    _ = try await retryFixture.app.handle(
        type: "select",
        payload: operationalData(retrySelection)
    )
    let retryBlock = try await retryWait.value
    #expect(try operationalObject(retryBlock)["decision"] as? String == "block")
    _ = try await retryFixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: retryIDs,
            active: true,
            message: "selection uncommitted retry completed"
        )
    )
    state = try CoordinatorSemanticReplay.replay(retryFixture.journal.load())
    #expect(state.boundaries.values.first?.closed == true)
}

@Test("Operational proposal and full Pet binding fail closed while pause remains available")
func operationalValidationAndPause() async throws {
    let fixture = try operationalFixture()
    await expectOperationalError("project_path_invalid") {
        _ = try await fixture.app.handle(
            type: "enable_project",
            payload: operationalData(["cwd": "relative/path", "project_id": "project_relative"])
        )
    }
    let ids = try await operationalBegin(fixture, suffix: "validation")
    var invalid = operationalProposal(ids, suffix: "invalid")
    var action = invalid["recommended_next"] as! [String: Any]
    action["done_when"] = []
    invalid["recommended_next"] = action
    await expectOperationalError("invalid_proposal") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(ids, proposal: invalid))
        )
    }
    #expect(try fixture.journal.load().journalSequence == 0)

    let token = ids["correlation_token"]!
    var leaked = operationalProposal(ids, suffix: "leaked")
    var leakedAction = leaked["recommended_next"] as! [String: Any]
    leakedAction["objective"] = "Echo \(token) into a packet"
    leaked["recommended_next"] = leakedAction
    await expectOperationalError("raw_continuation_token_forbidden") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(ids, proposal: leaked))
        )
    }
    #expect(try fixture.journal.load().journalSequence == 0)
    #expect(try fixture.journal.load().documents.isEmpty)

    var valid = leaked
    var validAction = valid["recommended_next"] as! [String: Any]
    validAction["objective"] = "A safe objective after the rejected retry"
    valid["recommended_next"] = validAction
    valid["alternative_next"] = NSNull()
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(ids, proposal: valid))
    )
    let stopTask = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: false, message: "pause packet ready")
        )
    }
    let interaction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let before = try fixture.journal.load().journalSequence
    let validPauseSelection = try operationalSelection(interaction, slot: 3)
    for key in validPauseSelection.keys {
        var omitted = validPauseSelection
        omitted.removeValue(forKey: key)
        await expectOperationalError("contract_validation_failed") {
            _ = try await fixture.app.handle(type: "select", payload: operationalData(omitted))
        }
        #expect(try fixture.journal.load().journalSequence == before)
    }
    for key in [
        "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
        "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id",
    ] {
        var tampered = validPauseSelection
        tampered[key] = "tampered_\(key)"
        await expectAnyOperationalError {
            _ = try await fixture.app.handle(type: "select", payload: operationalData(tampered))
        }
        #expect(try fixture.journal.load().journalSequence == before)
    }
    var sequenceTampered = validPauseSelection
    sequenceTampered["boundary_sequence"] = 2
    await expectAnyOperationalError {
        _ = try await fixture.app.handle(type: "select", payload: operationalData(sequenceTampered))
    }
    #expect(try fixture.journal.load().journalSequence == before)

    await expectOperationalError("decision_option_disabled") {
        _ = try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(interaction, slot: 4))
        )
    }
    #expect(try fixture.journal.load().journalSequence == before)

    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(validPauseSelection)
    )
    let paused = try operationalObject(await stopTask.value)
    #expect(paused["status"] as? String == "paused")
    #expect(try CoordinatorSemanticReplay.replay(fixture.journal.load()).boundaries.values.first?.closed == true)
}

@Test("Operational scheduler closes expiry and timeout before activating staged work")
func operationalSchedulerTerminalTransitions() async throws {
    let expiryFixture = try operationalFixture()
    let expiryIDs = try await operationalBegin(expiryFixture, suffix: "expiry")
    _ = try await expiryFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            expiryIDs,
            proposal: operationalProposal(expiryIDs, suffix: "expiry")
        ))
    )
    let expiryWait = Task {
        try await expiryFixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: expiryIDs, active: false, message: "expiry waiting")
        )
    }
    _ = try await waitForOperationalInteraction(expiryFixture.app, state: "waiting")
    expiryFixture.clock.advance(seconds: 120)
    _ = try await expiryFixture.app.processTime()
    #expect(try operationalObject(await expiryWait.value)["status"] as? String == "expired")
    #expect(try CoordinatorSemanticReplay.replay(expiryFixture.journal.load()).boundaries.values.first?.closed == true)

    let timeoutFixture = try operationalFixture()
    let timeoutIDs = try await operationalBegin(timeoutFixture, suffix: "timeout")
    _ = try await timeoutFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            timeoutIDs,
            proposal: operationalProposal(timeoutIDs, suffix: "timeout_first")
        ))
    )
    let firstWait = Task {
        try await timeoutFixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: timeoutIDs, active: false, message: "timeout packet ready")
        )
    }
    let interaction = try await waitForOperationalInteraction(timeoutFixture.app, state: "waiting")
    _ = try await timeoutFixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(interaction, slot: 1))
    )
    _ = try await firstWait.value
    _ = try await timeoutFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            timeoutIDs,
            proposal: operationalProposal(timeoutIDs, suffix: "timeout_second")
        ))
    )
    timeoutFixture.clock.advance(seconds: 300)
    timeoutFixture.journal.failNextAppend(eventType: "decision_boundary_closed")
    await expectOperationalError("injected_append_failure") {
        _ = try await timeoutFixture.app.processTime()
    }
    var state = try CoordinatorSemanticReplay.replay(timeoutFixture.journal.load())
    #expect(state.boundaries.count == 1)
    #expect(state.boundaries.values.first?.closed == false)
    #expect(state.continuations.values.first?.transport?.status == .timedOutUnknown)

    // The routing notice was already drained, so this empty scheduler tick can
    // recover only if the operational layer retained it until close succeeded.
    _ = try await timeoutFixture.app.processTime()
    let staged = try await waitForOperationalInteraction(timeoutFixture.app, boundarySequence: 2)
    #expect(staged["state"] as? String == "sealed")
    state = try CoordinatorSemanticReplay.replay(timeoutFixture.journal.load())
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.contains { $0.closeReason == "transport_timed_out_unknown" })

    // The next real Stop still belongs to the continuation-enabled Codex turn,
    // so stop_hook_active remains true. Timeout promotion must admit this exact
    // observation as boundary two's waiter instead of deadlocking the session.
    let promotedWait = Task {
        try await timeoutFixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: timeoutIDs,
                active: true,
                message: "the timed out continuation emitted another Stop"
            )
        )
    }
    let promotedInteraction = try await waitForOperationalInteraction(
        timeoutFixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    _ = try await timeoutFixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(promotedInteraction, slot: 1))
    )
    let promotedBlock = try operationalObject(await promotedWait.value)
    #expect(promotedBlock["decision"] as? String == "block")
    _ = try await timeoutFixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: timeoutIDs,
            active: true,
            message: "the promoted boundary continuation returned"
        )
    )
    state = try CoordinatorSemanticReplay.replay(timeoutFixture.journal.load())
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.contains { $0.transport?.status == .timedOutUnknown })
    #expect(state.continuations.values.contains { $0.transport?.status == .completed })
}

@Test("Operational scheduler emits terminal notices after committed responses are lost")
func operationalSchedulerCommittedResponseLoss() async throws {
    let expiryFixture = try operationalFixture()
    let expiryIDs = try await operationalBegin(expiryFixture, suffix: "expiry_response_loss")
    _ = try await expiryFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            expiryIDs,
            proposal: operationalProposal(expiryIDs, suffix: "expiry_response_loss")
        ))
    )
    let expiryWait = Task {
        try await expiryFixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: expiryIDs,
                active: false,
                message: "expiry committed response loss"
            )
        )
    }
    _ = try await waitForOperationalInteraction(expiryFixture.app, state: "waiting")
    expiryFixture.journal.loseNextCommittedResponse(eventType: "interaction_expired")
    expiryFixture.clock.advance(seconds: 120)
    _ = try await expiryFixture.app.processTime()
    #expect(try operationalObject(await expiryWait.value)["status"] as? String == "expired")
    var state = try CoordinatorSemanticReplay.replay(expiryFixture.journal.load())
    #expect(state.boundaries.values.first?.expired == true)
    #expect(state.boundaries.values.first?.closed == true)

    let timeoutFixture = try operationalFixture()
    let timeoutIDs = try await operationalBegin(timeoutFixture, suffix: "timeout_response_loss")
    _ = try await timeoutFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            timeoutIDs,
            proposal: operationalProposal(timeoutIDs, suffix: "timeout_response_loss_first")
        ))
    )
    let firstWait = Task {
        try await timeoutFixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: timeoutIDs,
                active: false,
                message: "timeout committed response loss first"
            )
        )
    }
    let firstInteraction = try await waitForOperationalInteraction(
        timeoutFixture.app,
        state: "waiting"
    )
    _ = try await timeoutFixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(firstInteraction, slot: 1))
    )
    _ = try await firstWait.value
    _ = try await timeoutFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            timeoutIDs,
            proposal: operationalProposal(timeoutIDs, suffix: "timeout_response_loss_second")
        ))
    )
    timeoutFixture.journal.loseNextCommittedResponse(
        eventType: "continuation_transport_timed_out_unknown"
    )
    timeoutFixture.clock.advance(seconds: 300)
    _ = try await timeoutFixture.app.processTime()

    let promoted = try await waitForOperationalInteraction(
        timeoutFixture.app,
        boundarySequence: 2
    )
    let promotedWait = Task {
        try await timeoutFixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: timeoutIDs,
                active: true,
                message: "timeout response loss promoted boundary"
            )
        )
    }
    _ = try await waitForOperationalInteraction(
        timeoutFixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    _ = try await timeoutFixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(promoted, slot: 1))
    )
    _ = try await promotedWait.value
    _ = try await timeoutFixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: timeoutIDs,
            active: true,
            message: "timeout response loss second continuation returned"
        )
    )
    state = try CoordinatorSemanticReplay.replay(timeoutFixture.journal.load())
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.contains { $0.transport?.status == .timedOutUnknown })
    #expect(state.continuations.values.contains { $0.transport?.status == .completed })
}
