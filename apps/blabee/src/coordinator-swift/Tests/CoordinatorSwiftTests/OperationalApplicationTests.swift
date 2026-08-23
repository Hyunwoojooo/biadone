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

private actor OperationalNextTurnDispatchRecorder {
    enum Mode: Sendable {
        case succeed
        case fail(String)
        case suspendThenSucceed
        case suspendThenFail(String)
    }

    private let mode: Mode
    private var requests: [CoordinatorNextTurnDispatchRequest] = []
    private var suspended: [CheckedContinuation<Void, Never>] = []

    init(mode: Mode = .succeed) {
        self.mode = mode
    }

    func dispatch(
        _ request: CoordinatorNextTurnDispatchRequest
    ) async throws -> CoordinatorNextTurnDispatchReceipt {
        requests.append(request)
        switch mode {
        case .succeed:
            break
        case .fail(let code):
            throw CoordinatorError(code)
        case .suspendThenSucceed:
            await withCheckedContinuation { suspended.append($0) }
        case .suspendThenFail(let code):
            await withCheckedContinuation { suspended.append($0) }
            throw CoordinatorError(code)
        }
        return CoordinatorNextTurnDispatchReceipt(
            queuedSubmissionID: "queued_submission_operational_\(requests.count)"
        )
    }

    func recordedRequests() -> [CoordinatorNextTurnDispatchRequest] {
        requests
    }

    func resumeSuspendedDispatches() {
        let continuations = suspended
        suspended.removeAll()
        for continuation in continuations {
            continuation.resume()
        }
    }
}

private struct OperationalFixture {
    let app: CoordinatorOperationalApplication
    let journal: OperationalMemoryJournal
    let clock: OperationalClock
    let tokens: OperationalTokens
    let nextTurnDispatcher: OperationalNextTurnDispatchRecorder
}

private func operationalFixture(
    dispatchMode: OperationalNextTurnDispatchRecorder.Mode = .succeed
) throws -> OperationalFixture {
    let journal = OperationalMemoryJournal()
    let clock = OperationalClock()
    let ids = OperationalIDs()
    let tokens = OperationalTokens()
    let nextTurnDispatcher = OperationalNextTurnDispatchRecorder(mode: dispatchMode)
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
        stopObservationHMACKey: Data(repeating: 0xA5, count: 32),
        nextTurnDispatcher: { request in
            try await nextTurnDispatcher.dispatch(request)
        }
    )
    return OperationalFixture(
        app: app,
        journal: journal,
        clock: clock,
        tokens: tokens,
        nextTurnDispatcher: nextTurnDispatcher
    )
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
    state requiredState: String? = nil,
    sessionID: String? = nil,
    focusWhenWaiting: Bool = true
) async throws -> [String: Any] {
    for _ in 0..<100 {
        let state = try operationalObject(await app.handle(type: "get_state", payload: operationalData([:])))
        if let interactions = state["interactions"] as? [[String: Any]],
           let interaction = interactions.first(where: {
               ExactJSONInteger.int64($0["boundary_sequence"], minimum: 1) == boundarySequence
                   && (requiredState == nil || $0["state"] as? String == requiredState)
                   && (sessionID == nil || $0["session_id"] as? String == sessionID)
           })
        {
            if focusWhenWaiting, interaction["state"] as? String == "waiting" {
                _ = try await app.handle(
                    type: "focus_interaction",
                    payload: operationalData(operationalFocus(interaction))
                )
            }
            return interaction
        }
        await Task.yield()
    }
    throw CoordinatorError("test_interaction_missing")
}

private func waitForRecordedDispatch(
    _ recorder: OperationalNextTurnDispatchRecorder
) async throws -> CoordinatorNextTurnDispatchRequest {
    for _ in 0..<100 {
        if let request = await recorder.recordedRequests().first {
            return request
        }
        try await Task.sleep(for: .milliseconds(2))
    }
    throw CoordinatorError("test_dispatch_missing")
}

private func waitForRecordedDispatches(
    _ recorder: OperationalNextTurnDispatchRecorder,
    count: Int
) async throws -> [CoordinatorNextTurnDispatchRequest] {
    for _ in 0..<100 {
        let requests = await recorder.recordedRequests()
        if requests.count >= count {
            return requests
        }
        try await Task.sleep(for: .milliseconds(2))
    }
    throw CoordinatorError("test_dispatch_missing")
}

private func operationalFocus(_ interaction: [String: Any]) throws -> [String: Any] {
    var request: [String: Any] = [
        "schema_version": "1.0",
        "kind": "blabee_pet_focus_request",
        "interaction_id": interaction["interaction_id"]!,
        "packet_id": interaction["packet_id"]!,
        "revision": interaction["revision"]!,
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

@Test("Operational prompt late-registers a missing session without changing resume semantics")
func operationalPromptLateRegistersMissingSession() async throws {
    let fixture = try operationalFixture()
    let cwd = "/tmp/blabee-operational-late-register"
    let projectID = "project_operational_late_register"
    let sessionID = "session_operational_late_register"
    let turnID = "turn_operational_late_register"
    let promptText = "Attach this already-open Codex session"

    _ = try await fixture.app.handle(
        type: "enable_project",
        payload: operationalData([
            "cwd": cwd,
            "project_id": projectID,
        ])
    )
    let first = try operationalObject(
        await fixture.app.handle(
            type: "user_prompt_submit",
            payload: operationalData([
                "session_id": sessionID,
                "turn_id": turnID,
                "cwd": cwd,
                "prompt": promptText,
                "hook_event_name": "UserPromptSubmit",
            ])
        )
    )
    #expect(first["enabled"] as? Bool == true)
    #expect(first["prompt_origin"] as? String == "human")
    let firstIdentifiers = try #require(first["identifiers"] as? [String: Any])
    #expect(first["additionalContext"] as? String != nil)

    let resumed = try operationalObject(
        await fixture.app.handle(
            type: "session_start",
            payload: operationalData([
                "session_id": sessionID,
                "cwd": cwd,
                "source": "resume",
                "hook_event_name": "SessionStart",
            ])
        )
    )
    #expect(resumed["enabled"] as? Bool == true)
    #expect(resumed["additionalContext"] as? String != nil)

    let retried = try operationalObject(
        await fixture.app.handle(
            type: "user_prompt_submit",
            payload: operationalData([
                "session_id": sessionID,
                "turn_id": turnID,
                "cwd": cwd,
                "prompt": promptText,
                "hook_event_name": "UserPromptSubmit",
            ])
        )
    )
    let retriedIdentifiers = try #require(retried["identifiers"] as? [String: Any])
    for key in [
        "project_id", "session_id", "source_turn_id", "source_prompt_id",
        "episode_id", "episode_root_prompt_id", "episode_baseline_checkpoint_id",
    ] {
        #expect(retriedIdentifiers[key] as? String == firstIdentifiers[key] as? String)
    }

    let otherCWD = "/tmp/blabee-operational-late-register-other"
    _ = try await fixture.app.handle(
        type: "enable_project",
        payload: operationalData([
            "cwd": otherCWD,
            "project_id": "project_operational_late_register_other",
        ])
    )
    await expectOperationalError("session_project_conflict") {
        _ = try await fixture.app.handle(
            type: "user_prompt_submit",
            payload: operationalData([
                "session_id": sessionID,
                "turn_id": "turn_operational_late_register_other",
                "cwd": otherCWD,
                "prompt": "Must not cross project ownership",
                "hook_event_name": "UserPromptSubmit",
            ])
        )
    }
}

@Test("Operational disabled prompt stays unregistered until an enabled project receives it")
func operationalDisabledPromptDoesNotLateRegister() async throws {
    let fixture = try operationalFixture()
    let sessionID = "session_operational_disabled_late_register"
    let disabledCWD = "/tmp/blabee-operational-disabled-late-register"
    _ = try await fixture.app.handle(
        type: "enable_project",
        payload: operationalData([
            "cwd": disabledCWD,
            "project_id": "project_operational_disabled_late_register",
            "enabled": false,
        ])
    )
    let disabled = try operationalObject(
        await fixture.app.handle(
            type: "user_prompt_submit",
            payload: operationalData([
                "session_id": sessionID,
                "turn_id": "turn_operational_disabled_late_register",
                "cwd": disabledCWD,
                "prompt": "Do not attach this disabled project",
                "hook_event_name": "UserPromptSubmit",
            ])
        )
    )
    #expect(disabled["enabled"] as? Bool == false)
    #expect(disabled["additionalContext"] == nil)

    let enabledCWD = "/tmp/blabee-operational-enabled-after-disabled"
    _ = try await fixture.app.handle(
        type: "enable_project",
        payload: operationalData([
            "cwd": enabledCWD,
            "project_id": "project_operational_enabled_after_disabled",
        ])
    )
    let attached = try operationalObject(
        await fixture.app.handle(
            type: "user_prompt_submit",
            payload: operationalData([
                "session_id": sessionID,
                "turn_id": "turn_operational_enabled_after_disabled",
                "cwd": enabledCWD,
                "prompt": "Attach only after reaching an enabled project",
                "hook_event_name": "UserPromptSubmit",
            ])
        )
    )
    #expect(attached["enabled"] as? Bool == true)
    let identifiers = try #require(attached["identifiers"] as? [String: Any])
    #expect(identifiers["project_id"] as? String == "project_operational_enabled_after_disabled")
}

@Test("Operational doctor status is an exact read-only projection")
func operationalDoctorStatusIsPure() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "doctor")
    _ = try await fixture.app.handle(
        type: "enable_project",
        payload: operationalData([
            "cwd": "/tmp/blabee-operational-disabled",
            "project_id": "project_operational_disabled",
            "enabled": false,
        ])
    )
    for (path, projectID) in [
        ("/tmp/z-doctor", "project_operational_z_doctor"),
        ("/tmp/é-doctor", "project_operational_unicode_doctor"),
    ] {
        _ = try await fixture.app.handle(
            type: "enable_project",
            payload: operationalData(["cwd": path, "project_id": projectID])
        )
    }
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "doctor")
        ))
    )
    let stopTask = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: false, message: "doctor due boundary")
        )
    }
    _ = try await waitForOperationalInteraction(
        fixture.app,
        state: "waiting",
        focusWhenWaiting: false
    )
    fixture.clock.advance(seconds: 120)
    let before = try fixture.journal.load()

    let first = try await fixture.app.doctorStatus(payload: operationalData([:]))
    let second = try await fixture.app.doctorStatus(payload: operationalData([:]))
    #expect(first == second)
    let status = try operationalObject(first)
    #expect(status["schema_version"] as? String == "1.0")
    #expect(status["kind"] as? String == "blabee_doctor_status")
    let projects = try #require(status["projects"] as? [[String: Any]])
    #expect(projects.count == 3)
    #expect(projects.allSatisfy { Set($0.keys) == Set(["cwd", "enabled"]) })
    let projectPaths = try projects.map { try #require($0["cwd"] as? String) }
    #expect(projectPaths == projectPaths.sorted {
        $0.utf8.lexicographicallyPrecedes($1.utf8)
    })
    #expect(projectPaths.contains(ids["cwd"]!))
    #expect(projects.allSatisfy { $0["enabled"] as? Bool == true })
    #expect(!first.contains(Data("project_id".utf8)))

    let after = try fixture.journal.load()
    #expect(after.journalSequence == before.journalSequence)
    #expect(after.events == before.events)
    #expect(try CoordinatorSemanticReplay.replay(after).boundaries.values.first?.closed == false)

    await expectOperationalError("doctor_status_payload_invalid") {
        _ = try await fixture.app.doctorStatus(payload: operationalData(["unexpected": true]))
    }
    _ = try await fixture.app.processTime()
    #expect(try operationalObject(await stopTask.value)["status"] as? String == "decision_available")
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

@Test("Operational Stop without a proposal always finishes without blocking")
func operationalStopWithoutProposalDoesNotBlock() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "finalization_once")
    let firstStop = try operationalStop(
        ids: ids,
        active: false,
        message: "A short text-only action result"
    )

    let first = try await fixture.app.handle(type: "stop", payload: firstStop)
    let firstObject = try operationalObject(first)
    #expect(firstObject["status"] as? String == "no_proposal")
    #expect(firstObject["decision"] == nil)
    #expect(firstObject["reason"] == nil)

    let replayed = try await fixture.app.handle(type: "stop", payload: firstStop)
    #expect(replayed == first)

    let changedInitial = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: false,
                message: "A different initial Stop must not start another check"
            )
        )
    )
    #expect(changedInitial["status"] as? String == "no_proposal")

    let explanationCompletion = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: true,
                message: "This was only an explanation, so no proposal was emitted"
            )
        )
    )
    #expect(explanationCompletion["status"] as? String == "no_proposal")
    #expect(try fixture.journal.load().journalSequence == 0)
}

@Test("Operational proposal becomes selectable without holding Stop open")
func operationalProposalDoesNotHoldStopOpen() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "finalization_emit")
    let fallback = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: false,
                message: "Action completed without an initial proposal"
            )
        )
    )
    #expect(fallback["status"] as? String == "no_proposal")

    let accepted = try operationalObject(
        await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(
                ids,
                proposal: operationalProposal(ids, suffix: "finalization_emit")
            ))
        )
    )
    #expect(accepted["accepted"] as? Bool == true)
    #expect(accepted["staged"] as? Bool == false)

    let stopResult = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: false,
                message: "The answer containing the proposal has finished"
            )
        )
    )
    #expect(stopResult["status"] as? String == "decision_available")
    let interaction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let selected = try operationalObject(
        await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(interaction, slot: 1))
        )
    )
    #expect((selected["outcome"] as? [String: Any])?["kind"] as? String == "next_turn")
}

@Test("Operational selection queues one exact next-turn action and closes transport")
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
    let selectedObject = try operationalObject(selected)
    let selectedOutcome = try #require(selectedObject["outcome"] as? [String: Any])
    #expect(selectedOutcome["kind"] as? String == "next_turn")
    #expect(selectedOutcome["queued_submission_id"] as? String == "queued_submission_operational_1")
    #expect(try operationalObject(stopResult)["status"] as? String == "decision_available")
    let rawToken = try #require(fixture.tokens.token(at: 0))
    #expect(!selected.contains(Data(rawToken.utf8)))
    #expect(!stopResult.contains(Data(rawToken.utf8)))
    #expect(!stopResult.contains(Data("continuation_token".utf8)))

    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    let continuation = try #require(state.continuations.values.first)
    #expect(continuation.consumedAt != nil)
    #expect(continuation.transport?.status == .completed)
    #expect(state.boundaries.values.first?.closed == true)

    let dispatches = await fixture.nextTurnDispatcher.recordedRequests()
    #expect(dispatches.count == 1)
    let dispatch = try #require(dispatches.first)
    #expect(dispatch.sessionID == ids["session_id"])
    #expect(dispatch.continuationID == selectedOutcome["continuation_id"] as? String)
    let messageJSON = try #require(dispatch.message.split(separator: "\n").last)
    let nextTurn = try operationalObject(Data(messageJSON.utf8))
    #expect(nextTurn["kind"] as? String == "blabee_next_turn_action")
    #expect((nextTurn["binding"] as? [String: Any])?["session_id"] as? String == ids["session_id"])
    #expect((nextTurn["action"] as? [String: Any])?["title"] as? String == "Recommended first")

    await expectOperationalError("interaction_not_waiting") {
        _ = try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(interaction, slot: 1))
        )
    }
}

@Test("Operational pause closes the card without dispatching a new turn")
func operationalPauseDoesNotDispatch() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "next_turn_pause")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "next_turn_pause")
        ))
    )
    let stopped = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(
                ids: ids,
                active: false,
                message: "Pause card is ready"
            )
        )
    )
    #expect(stopped["status"] as? String == "decision_available")
    let interaction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let selected = try operationalObject(
        await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(interaction, slot: 3))
        )
    )
    #expect((selected["outcome"] as? [String: Any])?["kind"] as? String == "pause")
    #expect(await fixture.nextTurnDispatcher.recordedRequests().isEmpty)
    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.values.first?.closed == true)
    #expect(state.continuations.isEmpty)
}

@Test("Operational dispatch failure is explicit and the committed selection is not retried")
func operationalNextTurnDispatchFailureIsExplicit() async throws {
    let fixture = try operationalFixture(
        dispatchMode: .fail("simulated_next_turn_dispatch_failure")
    )
    let ids = try await operationalBegin(fixture, suffix: "next_turn_failure")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "next_turn_failure")
        ))
    )
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: ids,
            active: false,
            message: "Failure card is ready"
        )
    )
    let interaction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let selection = try operationalSelection(interaction, slot: 1)
    await expectOperationalError("simulated_next_turn_dispatch_failure") {
        _ = try await fixture.app.handle(
            type: "select",
            payload: operationalData(selection)
        )
    }
    #expect(await fixture.nextTurnDispatcher.recordedRequests().count == 1)
    await expectOperationalError("interaction_not_waiting") {
        _ = try await fixture.app.handle(
            type: "select",
            payload: operationalData(selection)
        )
    }
    #expect(await fixture.nextTurnDispatcher.recordedRequests().count == 1)
    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.consumedAt != nil)
    #expect(state.continuations.values.first?.transport == nil)
}

@Test("Operational queued prompt may arrive before the queue receipt")
func operationalPromptRaceClosesPreviousBoundaryIdempotently() async throws {
    let fixture = try operationalFixture(dispatchMode: .suspendThenSucceed)
    let ids = try await operationalBegin(fixture, suffix: "next_turn_race")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "next_turn_race")
        ))
    )
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: ids,
            active: false,
            message: "Race card is ready"
        )
    )
    let interaction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let selectionTask = Task {
        try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(interaction, slot: 1))
        )
    }
    let dispatch = try await waitForRecordedDispatch(fixture.nextTurnDispatcher)
    #expect(dispatch.sessionID == ids["session_id"])

    let nextPrompt = try operationalObject(
        await fixture.app.handle(
            type: "user_prompt_submit",
            payload: operationalData([
                "session_id": ids["session_id"]!,
                "turn_id": "turn_operational_next_turn_race_queued",
                "cwd": ids["cwd"]!,
                "prompt": dispatch.message,
                "hook_event_name": "UserPromptSubmit",
            ])
        )
    )
    let nextIdentifiers = try #require(nextPrompt["identifiers"] as? [String: Any])
    #expect(nextIdentifiers["episode_id"] as? String != ids["episode_id"])
    #expect(nextIdentifiers["source_prompt_id"] as? String != ids["source_prompt_id"])
    let stateBeforeReceipt = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(stateBeforeReceipt.boundaries.values.first?.closed == true)
    #expect(stateBeforeReceipt.continuations.values.first?.transport?.status == .completed)

    await fixture.nextTurnDispatcher.resumeSuspendedDispatches()
    let selected = try operationalObject(await selectionTask.value)
    #expect((selected["outcome"] as? [String: Any])?["kind"] as? String == "next_turn")
    #expect(
        (selected["outcome"] as? [String: Any])?["queued_submission_id"] as? String
            == "queued_submission_operational_1"
    )
    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.values.first?.closed == true)
    #expect(state.continuations.values.first?.transport?.status == .completed)
}

@Test("Operational unrelated prompt does not complete an in-flight queued transport")
func operationalUnrelatedPromptDoesNotCompletePreviousDispatch() async throws {
    let fixture = try operationalFixture(
        dispatchMode: .suspendThenFail("simulated_unrelated_prompt_dispatch_failure")
    )
    let ids = try await operationalBegin(fixture, suffix: "next_turn_unrelated_race")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "next_turn_unrelated_race")
        ))
    )
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(
            ids: ids,
            active: false,
            message: "Unrelated prompt race card is ready"
        )
    )
    let interaction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let selectionTask = Task {
        try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(interaction, slot: 1))
        )
    }
    let dispatch = try await waitForRecordedDispatch(fixture.nextTurnDispatcher)
    #expect(dispatch.sessionID == ids["session_id"])

    let unrelatedPrompt = try operationalObject(
        await fixture.app.handle(
            type: "user_prompt_submit",
            payload: operationalData([
                "session_id": ids["session_id"]!,
                "turn_id": "turn_operational_next_turn_unrelated_human",
                "cwd": ids["cwd"]!,
                "prompt": "An unrelated human prompt while Blabee dispatch is in flight",
                "hook_event_name": "UserPromptSubmit",
            ])
        )
    )
    let unrelatedIdentifiers = try #require(unrelatedPrompt["identifiers"] as? [String: Any])
    #expect(unrelatedIdentifiers["episode_id"] as? String != ids["episode_id"])
    #expect(unrelatedIdentifiers["source_prompt_id"] as? String != ids["source_prompt_id"])

    let stateBeforeFailure = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(stateBeforeFailure.boundaries.values.first?.closed == false)
    #expect(stateBeforeFailure.continuations.values.first?.transport == nil)
    let eventTypesBeforeFailure = try fixture.journal.load().events.map {
        try #require(operationalObject($0)["event_type"] as? String)
    }
    #expect(!eventTypesBeforeFailure.contains("continuation_transport_completed"))

    await fixture.nextTurnDispatcher.resumeSuspendedDispatches()
    await expectOperationalError("simulated_unrelated_prompt_dispatch_failure") {
        _ = try await selectionTask.value
    }

    let stateAfterFailure = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(stateAfterFailure.boundaries.values.first?.closed == false)
    #expect(stateAfterFailure.continuations.values.first?.transport == nil)
    let eventTypesAfterFailure = try fixture.journal.load().events.map {
        try #require(operationalObject($0)["event_type"] as? String)
    }
    #expect(!eventTypesAfterFailure.contains("continuation_transport_completed"))
}

@Test("Operational Pet focus is explicit, exact, and required before selection")
func operationalExplicitPetFocusContract() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "pet_focus")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "pet_focus")
        ))
    )
    let stopTask = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: false, message: "Pet focus contract")
        )
    }
    let interaction = try await waitForOperationalInteraction(
        fixture.app,
        state: "waiting",
        focusWhenWaiting: false
    )

    #expect(interaction["cwd"] as? String == ids["cwd"])
    #expect(interaction["sealed_at"] as? String == "2026-08-21T12:00:00Z")
    #expect(interaction["expires_at"] as? String == "2026-08-21T12:02:00Z")
    #expect((interaction["outcome"] as? [String: Any])?["status"] as? String == "completed")
    #expect(interaction["reported_side_effects"] as? [[String: Any]] != nil)
    #expect(ExactJSONInteger.int64(interaction["valid_after_event_sequence"], minimum: 1) != nil)
    #expect((interaction["risk"] as? [String: Any])?["level"] as? String == "info")
    #expect(interaction["evidence"] as? [[String: Any]] != nil)
    #expect((interaction["checkpoint"] as? [String: Any])?["coverage"] as? String == "unavailable")
    #expect(interaction["foreground"] as? Bool == false)
    #expect(interaction["reminder_due"] as? Bool == false)
    #expect(ExactJSONInteger.int64(interaction["milliseconds_until_expiry"], minimum: 0) == 120_000)

    await expectOperationalError("foreground_interaction_required") {
        _ = try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(interaction, slot: 3))
        )
    }

    var mismatched = try operationalFocus(interaction)
    mismatched["packet_id"] = "packet_tampered"
    await expectOperationalError("focus_binding_mismatch") {
        _ = try await fixture.app.handle(
            type: "focus_interaction",
            payload: operationalData(mismatched)
        )
    }

    let focused = try operationalObject(
        await fixture.app.handle(
            type: "focus_interaction",
            payload: operationalData(operationalFocus(interaction))
        )
    )
    #expect(focused["focused"] as? Bool == true)
    let focusedSnapshot = try operationalObject(
        await fixture.app.handle(type: "pet_snapshot", payload: operationalData([:]))
    )
    let focusedInteraction = try #require(
        (focusedSnapshot["interactions"] as? [[String: Any]])?.first
    )
    #expect(focusedInteraction["foreground"] as? Bool == true)

    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(interaction, slot: 3))
    )
    #expect(try operationalObject(await stopTask.value)["status"] as? String == "decision_available")
}

@Test("Operational new sessions never steal Pet foreground")
func operationalPetForegroundDoesNotAutoSwitch() async throws {
    let fixture = try operationalFixture()
    let firstIDs = try await operationalBegin(fixture, suffix: "pet_first")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            firstIDs,
            proposal: operationalProposal(firstIDs, suffix: "pet_first")
        ))
    )
    let firstStop = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: firstIDs, active: false, message: "first Pet card")
        )
    }
    let first = try await waitForOperationalInteraction(
        fixture.app,
        state: "waiting",
        focusWhenWaiting: false
    )
    _ = try await fixture.app.handle(
        type: "focus_interaction",
        payload: operationalData(operationalFocus(first))
    )

    let secondIDs = try await operationalBegin(fixture, suffix: "pet_second")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            secondIDs,
            proposal: operationalProposal(secondIDs, suffix: "pet_second")
        ))
    )
    let secondStop = Task {
        try await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: secondIDs, active: false, message: "second Pet card")
        )
    }
    let second = try await waitForOperationalInteraction(
        fixture.app,
        state: "waiting",
        sessionID: secondIDs["session_id"],
        focusWhenWaiting: false
    )
    let snapshot = try operationalObject(
        await fixture.app.handle(type: "pet_snapshot", payload: operationalData([:]))
    )
    let interactions = try #require(snapshot["interactions"] as? [[String: Any]])
    #expect(interactions.first(where: { $0["session_id"] as? String == firstIDs["session_id"] })?["foreground"] as? Bool == true)
    #expect(interactions.first(where: { $0["session_id"] as? String == secondIDs["session_id"] })?["foreground"] as? Bool == false)

    await expectOperationalError("foreground_interaction_mismatch") {
        _ = try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(second, slot: 3))
        )
    }
    _ = try await fixture.app.handle(
        type: "focus_interaction",
        payload: operationalData(operationalFocus(second))
    )
    await expectOperationalError("foreground_interaction_mismatch") {
        _ = try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(first, slot: 3))
        )
    }
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(second, slot: 3))
    )
    #expect(try operationalObject(await secondStop.value)["status"] as? String == "decision_available")

    _ = try await fixture.app.handle(
        type: "focus_interaction",
        payload: operationalData(operationalFocus(first))
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(first, slot: 3))
    )
    #expect(try operationalObject(await firstStop.value)["status"] as? String == "decision_available")
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
    #expect(try operationalObject(await stopTask.value)["status"] as? String == "decision_available")
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

@Test("Operational queue receipt promotes one staged boundary without another Stop")
func operationalTwoBoundariesRejectOldStopReplay() async throws {
    let fixture = try operationalFixture(dispatchMode: .suspendThenSucceed)
    let ids = try await operationalBegin(fixture, suffix: "queued_staged")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "queued_staged_first")
        ))
    )
    let stopped = try operationalObject(
        await fixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: ids, active: false, message: "first queued card")
        )
    )
    #expect(stopped["status"] as? String == "decision_available")
    let firstInteraction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let firstSelection = Task {
        try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(firstInteraction, slot: 1))
        )
    }
    _ = try await waitForRecordedDispatches(fixture.nextTurnDispatcher, count: 1)

    let staged = try operationalObject(
        await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(
                ids,
                proposal: operationalProposal(ids, suffix: "queued_staged_second")
            ))
        )
    )
    #expect(staged["staged"] as? Bool == true)
    #expect(ExactJSONInteger.int64(staged["boundary_sequence"], minimum: 1) == 2)

    await fixture.nextTurnDispatcher.resumeSuspendedDispatches()
    #expect(
        (try operationalObject(await firstSelection.value)["outcome"] as? [String: Any])?["kind"] as? String
            == "next_turn"
    )
    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    let secondSelection = Task {
        try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(secondInteraction, slot: 1))
        )
    }
    _ = try await waitForRecordedDispatches(fixture.nextTurnDispatcher, count: 2)
    await fixture.nextTurnDispatcher.resumeSuspendedDispatches()
    _ = try await secondSelection.value

    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.allSatisfy {
        $0.consumedAt != nil && $0.transport?.status == .completed
    })
}

@Test("Operational queued completion and staged activation recover after partial appends")
func operationalCompletionAndStagedActivationRetry() async throws {
    let fixture = try operationalFixture(dispatchMode: .suspendThenSucceed)
    let ids = try await operationalBegin(fixture, suffix: "queued_partial_retry")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "queued_partial_retry_first")
        ))
    )
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(ids: ids, active: false, message: "partial retry card")
    )
    let firstInteraction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let firstSelection = Task {
        try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(firstInteraction, slot: 1))
        )
    }
    _ = try await waitForRecordedDispatches(fixture.nextTurnDispatcher, count: 1)
    let staged = try operationalObject(
        await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(
                ids,
                proposal: operationalProposal(ids, suffix: "queued_partial_retry_second")
            ))
        )
    )
    #expect(staged["staged"] as? Bool == true)

    fixture.journal.failNextAppend(eventType: "continuation_transport_completed")
    await fixture.nextTurnDispatcher.resumeSuspendedDispatches()
    await expectOperationalError("injected_append_failure") {
        _ = try await firstSelection.value
    }
    var state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.transport == nil)
    #expect(state.boundaries.count == 1)

    fixture.journal.failNextAppend(eventType: "decision_boundary_closed")
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.processTime()
    }
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.transport?.status == .completed)
    #expect(state.boundaries.values.first?.closed == false)

    fixture.journal.failNextAppend(eventType: "decision_packet_sealed")
    await expectOperationalError("injected_append_failure") {
        _ = try await fixture.app.processTime()
    }
    var journalSnapshot = try fixture.journal.load()
    state = try CoordinatorSemanticReplay.replay(journalSnapshot)
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.filter(\.closed).count == 1)
    #expect(journalSnapshot.documents.count == 1)

    _ = try await fixture.app.processTime()
    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    journalSnapshot = try fixture.journal.load()
    #expect(journalSnapshot.documents.count == 2)
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(secondInteraction, slot: 3))
    )
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.count == 1)
    #expect(state.continuations.values.first?.transport?.status == .completed)
}

@Test("Operational committed queue completion responses promote one successor exactly once")
func operationalCommittedCompletionResponseLoss() async throws {
    let fixture = try operationalFixture(dispatchMode: .suspendThenSucceed)
    let ids = try await operationalBegin(fixture, suffix: "queued_completion_loss")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "queued_completion_loss_first")
        ))
    )
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(ids: ids, active: false, message: "response-loss card")
    )
    let firstInteraction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let firstSelection = Task {
        try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(firstInteraction, slot: 1))
        )
    }
    _ = try await waitForRecordedDispatches(fixture.nextTurnDispatcher, count: 1)
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "queued_completion_loss_second")
        ))
    )

    fixture.journal.loseNextCommittedResponse(eventType: "continuation_transport_completed")
    fixture.journal.loseNextCommittedResponse(eventType: "decision_boundary_closed")
    await fixture.nextTurnDispatcher.resumeSuspendedDispatches()
    await expectOperationalError("simulated_lost_response") {
        _ = try await firstSelection.value
    }
    await expectOperationalError("simulated_lost_response") {
        _ = try await fixture.app.processTime()
    }
    _ = try await fixture.app.processTime()

    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    let snapshot = try fixture.journal.load()
    let eventTypes = try snapshot.events.map {
        try #require(operationalObject($0)["event_type"] as? String)
    }
    #expect(eventTypes.filter { $0 == "continuation_transport_completed" }.count == 1)
    #expect(eventTypes.filter { $0 == "decision_boundary_closed" }.count == 1)
    #expect(eventTypes.filter { $0 == "decision_boundary_opened" }.count == 2)
    #expect(eventTypes.filter { $0 == "decision_packet_sealed" }.count == 2)

    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(secondInteraction, slot: 3))
    )
    let state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.allSatisfy { $0.closed })
}

@Test("Operational failed queued dispatch times out before promoting its staged successor")
func operationalCompletionTimeoutPromotionInterleaving() async throws {
    let fixture = try operationalFixture(
        dispatchMode: .suspendThenFail("simulated_queued_dispatch_failure")
    )
    let ids = try await operationalBegin(fixture, suffix: "queued_timeout_promotion")
    _ = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            ids,
            proposal: operationalProposal(ids, suffix: "queued_timeout_first")
        ))
    )
    _ = try await fixture.app.handle(
        type: "stop",
        payload: operationalStop(ids: ids, active: false, message: "timeout card")
    )
    let firstInteraction = try await waitForOperationalInteraction(fixture.app, state: "waiting")
    let firstSelection = Task {
        try await fixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(firstInteraction, slot: 1))
        )
    }
    _ = try await waitForRecordedDispatches(fixture.nextTurnDispatcher, count: 1)
    let staged = try operationalObject(
        await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(operationalWrapper(
                ids,
                proposal: operationalProposal(ids, suffix: "queued_timeout_second")
            ))
        )
    )
    #expect(staged["staged"] as? Bool == true)

    await fixture.nextTurnDispatcher.resumeSuspendedDispatches()
    await expectOperationalError("simulated_queued_dispatch_failure") {
        _ = try await firstSelection.value
    }
    var state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.continuations.values.first?.consumedAt != nil)
    #expect(state.continuations.values.first?.transport == nil)

    fixture.clock.advance(seconds: 300)
    _ = try await fixture.app.processTime()
    let secondInteraction = try await waitForOperationalInteraction(
        fixture.app,
        boundarySequence: 2,
        state: "waiting"
    )
    _ = try await fixture.app.handle(
        type: "select",
        payload: operationalData(operationalSelection(secondInteraction, slot: 3))
    )
    state = try CoordinatorSemanticReplay.replay(fixture.journal.load())
    #expect(state.boundaries.count == 2)
    #expect(state.boundaries.values.allSatisfy { $0.closed })
    #expect(state.continuations.values.count == 1)
    #expect(state.continuations.values.first?.transport?.status == .timedOutUnknown)
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
    #expect(try operationalObject(failedClosed)["status"] as? String == "decision_available")
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
    #expect(try operationalObject(await pauseWait.value)["status"] as? String == "decision_available")
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
    let retryStop = try await retryWait.value
    #expect(try operationalObject(retryStop)["status"] as? String == "decision_available")
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
    #expect(paused["status"] as? String == "decision_available")
    #expect(try CoordinatorSemanticReplay.replay(fixture.journal.load()).boundaries.values.first?.closed == true)
}

@Test("Operational prompt-only proposal correction is pre-write and idempotent")
func operationalPromptOnlyProposalCorrection() async throws {
    let fixture = try operationalFixture()
    let ids = try await operationalBegin(fixture, suffix: "prompt_correction")
    let proposal = operationalProposal(ids, suffix: "prompt_correction")

    var secretBearingProposal = proposal
    var secretBearingAction = secretBearingProposal["recommended_next"] as! [String: Any]
    secretBearingAction["objective"] = "Do not persist \(ids["correlation_token"]!)"
    secretBearingProposal["recommended_next"] = secretBearingAction
    var secretBearingWrongPrompt = operationalWrapper(ids, proposal: secretBearingProposal)
    secretBearingWrongPrompt["source_prompt_id"] = "prompt_transcribed_incorrectly"
    await expectOperationalError("raw_continuation_token_forbidden") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(secretBearingWrongPrompt)
        )
    }

    var wrongPrompt = operationalWrapper(ids, proposal: proposal)
    wrongPrompt["source_prompt_id"] = "prompt_transcribed_incorrectly"
    await expectOperationalError("proposal_source_prompt_mismatch") {
        _ = try await fixture.app.handle(
            type: "emit_decision",
            payload: operationalData(wrongPrompt)
        )
    }
    var snapshot = try fixture.journal.load()
    #expect(snapshot.journalSequence == 0)
    #expect(snapshot.documents.isEmpty)

    var nonPromptMismatches: [[String: Any]] = []
    for key in ["project_id", "session_id", "source_turn_id", "episode_id"] {
        var wrapper = operationalWrapper(ids, proposal: proposal)
        wrapper[key] = "mismatched_\(key)"
        nonPromptMismatches.append(wrapper)
    }
    var wrongTokenIDs = ids
    wrongTokenIDs["correlation_token"] = "mismatched_correlation_token"
    nonPromptMismatches.append(operationalWrapper(
        wrongTokenIDs,
        proposal: operationalProposal(wrongTokenIDs, suffix: "prompt_correction")
    ))

    for wrapper in nonPromptMismatches {
        await expectOperationalError("proposal_binding_mismatch") {
            _ = try await fixture.app.handle(
                type: "emit_decision",
                payload: operationalData(wrapper)
            )
        }
        snapshot = try fixture.journal.load()
        #expect(snapshot.journalSequence == 0)
        #expect(snapshot.documents.isEmpty)
    }

    let corrected = operationalWrapper(ids, proposal: proposal)
    let accepted = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(corrected)
    )
    snapshot = try fixture.journal.load()
    #expect(snapshot.journalSequence == 2)
    #expect(snapshot.documents.count == 1)

    let repeated = try await fixture.app.handle(
        type: "emit_decision",
        payload: operationalData(corrected)
    )
    #expect(repeated == accepted)
    let repeatedSnapshot = try fixture.journal.load()
    #expect(repeatedSnapshot.journalSequence == snapshot.journalSequence)
    #expect(repeatedSnapshot.documents == snapshot.documents)
}

@Test("Operational scheduler closes waiting expiry and failed queued dispatch timeout")
func operationalSchedulerTerminalTransitions() async throws {
    let expiryFixture = try operationalFixture()
    let expiryIDs = try await operationalBegin(expiryFixture, suffix: "queued_expiry")
    _ = try await expiryFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            expiryIDs,
            proposal: operationalProposal(expiryIDs, suffix: "queued_expiry")
        ))
    )
    let expiryStop = try operationalObject(
        await expiryFixture.app.handle(
            type: "stop",
            payload: operationalStop(ids: expiryIDs, active: false, message: "expiry card")
        )
    )
    #expect(expiryStop["status"] as? String == "decision_available")
    let expiryInteraction = try await waitForOperationalInteraction(
        expiryFixture.app,
        state: "waiting"
    )
    expiryFixture.clock.advance(seconds: 120)
    _ = try await expiryFixture.app.processTime()
    let expiryState = try CoordinatorSemanticReplay.replay(expiryFixture.journal.load())
    #expect(expiryState.boundaries.values.first?.expired == true)
    #expect(expiryState.boundaries.values.first?.closed == true)
    await expectOperationalError("interaction_not_waiting") {
        _ = try await expiryFixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(expiryInteraction, slot: 3))
        )
    }

    let timeoutFixture = try operationalFixture(
        dispatchMode: .fail("simulated_scheduler_dispatch_failure")
    )
    let timeoutIDs = try await operationalBegin(timeoutFixture, suffix: "queued_timeout")
    _ = try await timeoutFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            timeoutIDs,
            proposal: operationalProposal(timeoutIDs, suffix: "queued_timeout")
        ))
    )
    _ = try await timeoutFixture.app.handle(
        type: "stop",
        payload: operationalStop(ids: timeoutIDs, active: false, message: "timeout card")
    )
    let timeoutInteraction = try await waitForOperationalInteraction(
        timeoutFixture.app,
        state: "waiting"
    )
    await expectOperationalError("simulated_scheduler_dispatch_failure") {
        _ = try await timeoutFixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(timeoutInteraction, slot: 1))
        )
    }
    timeoutFixture.clock.advance(seconds: 300)
    timeoutFixture.journal.failNextAppend(eventType: "decision_boundary_closed")
    await expectOperationalError("injected_append_failure") {
        _ = try await timeoutFixture.app.processTime()
    }
    var timeoutState = try CoordinatorSemanticReplay.replay(timeoutFixture.journal.load())
    #expect(timeoutState.continuations.values.first?.transport?.status == .timedOutUnknown)
    #expect(timeoutState.boundaries.values.first?.closed == false)

    _ = try await timeoutFixture.app.processTime()
    timeoutState = try CoordinatorSemanticReplay.replay(timeoutFixture.journal.load())
    #expect(timeoutState.boundaries.values.first?.closed == true)
    #expect(timeoutState.boundaries.values.first?.closeReason == "transport_timed_out_unknown")
}

@Test("Operational scheduler recovers committed expiry and queued-timeout response loss")
func operationalSchedulerCommittedResponseLoss() async throws {
    let expiryFixture = try operationalFixture()
    let expiryIDs = try await operationalBegin(expiryFixture, suffix: "queued_expiry_loss")
    _ = try await expiryFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            expiryIDs,
            proposal: operationalProposal(expiryIDs, suffix: "queued_expiry_loss")
        ))
    )
    _ = try await expiryFixture.app.handle(
        type: "stop",
        payload: operationalStop(ids: expiryIDs, active: false, message: "expiry loss card")
    )
    _ = try await waitForOperationalInteraction(expiryFixture.app, state: "waiting")
    expiryFixture.journal.loseNextCommittedResponse(eventType: "interaction_expired")
    expiryFixture.clock.advance(seconds: 120)
    _ = try await expiryFixture.app.processTime()
    let expiryState = try CoordinatorSemanticReplay.replay(expiryFixture.journal.load())
    #expect(expiryState.boundaries.values.first?.expired == true)
    #expect(expiryState.boundaries.values.first?.closed == true)

    let timeoutFixture = try operationalFixture(
        dispatchMode: .fail("simulated_timeout_response_loss_dispatch_failure")
    )
    let timeoutIDs = try await operationalBegin(timeoutFixture, suffix: "queued_timeout_loss")
    _ = try await timeoutFixture.app.handle(
        type: "emit_decision",
        payload: operationalData(operationalWrapper(
            timeoutIDs,
            proposal: operationalProposal(timeoutIDs, suffix: "queued_timeout_loss")
        ))
    )
    _ = try await timeoutFixture.app.handle(
        type: "stop",
        payload: operationalStop(ids: timeoutIDs, active: false, message: "timeout loss card")
    )
    let timeoutInteraction = try await waitForOperationalInteraction(
        timeoutFixture.app,
        state: "waiting"
    )
    await expectOperationalError("simulated_timeout_response_loss_dispatch_failure") {
        _ = try await timeoutFixture.app.handle(
            type: "select",
            payload: operationalData(operationalSelection(timeoutInteraction, slot: 1))
        )
    }
    timeoutFixture.journal.loseNextCommittedResponse(
        eventType: "continuation_transport_timed_out_unknown"
    )
    timeoutFixture.clock.advance(seconds: 300)
    _ = try await timeoutFixture.app.processTime()

    let timeoutSnapshot = try timeoutFixture.journal.load()
    let timeoutState = try CoordinatorSemanticReplay.replay(timeoutSnapshot)
    #expect(timeoutState.continuations.values.first?.transport?.status == .timedOutUnknown)
    #expect(timeoutState.boundaries.values.first?.closed == true)
    let timeoutEvents = try timeoutSnapshot.events.filter {
        try operationalObject($0)["event_type"] as? String
            == "continuation_transport_timed_out_unknown"
    }
    #expect(timeoutEvents.count == 1)
}
