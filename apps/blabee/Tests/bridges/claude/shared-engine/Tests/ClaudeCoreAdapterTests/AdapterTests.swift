import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing

private final class FixtureAnchor: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "claude-adapter-unit-fixture"
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    func load() -> FreshnessStoredRecord? { lock.withLock { stored } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored == nil else { throw CoordinatorError("freshness_anchor_conflict") }
            let value = try FreshnessStoredRecord(record: record, revision: record.revision)
            stored = value
            return value
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored?.revision == expectedRevision else { throw CoordinatorError("freshness_anchor_conflict") }
            let value = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            stored = value
            return value
        }
    }
}

private final class FixtureClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 0
    func nowNanoseconds() -> UInt64 { lock.withLock { value } }
    func advance(seconds: UInt64) { lock.withLock { value += seconds * 1_000_000_000 } }
    func set(seconds: UInt64) { lock.withLock { value = seconds * 1_000_000_000 } }
}

/// Failure injection still commits to the real SQLiteJournal. It does not
/// implement replay, lifecycle, snapshots, or persistence of its own.
private final class FaultPort: CoordinatorSemanticJournalPort, @unchecked Sendable {
    let sqlite: SQLiteJournal
    private let lock = NSLock()
    private var fault: (type: String, afterCommit: Bool)?
    private var nextLoad: (@Sendable () -> Void)?
    init(_ sqlite: SQLiteJournal) { self.sqlite = sqlite }
    func failNext(_ type: String, afterCommit: Bool = false) {
        lock.withLock { fault = (type, afterCommit) }
    }
    func beforeNextLoad(_ body: @escaping @Sendable () -> Void) { lock.withLock { nextLoad = body } }
    func load() throws -> JournalSnapshot {
        let body = lock.withLock { let body = nextLoad; nextLoad = nil; return body }
        body?()
        return try sqlite.load()
    }
    func append(expectedSequence: Int64, events: [Data], documents: [Data], verificationRecords: [Data]) throws -> JournalAppendResult {
        let eventTypes = try events.map { try StrictJSONTransport.object(from: $0)["event_type"] as? String }
        let matching = lock.withLock { () -> (type: String, afterCommit: Bool)? in
            guard let value = fault, eventTypes.contains(value.type) else { return nil }
            fault = nil
            return value
        }
        if let matching, !matching.afterCommit { throw CoordinatorError("fixture_append_failed") }
        let result = try sqlite.append(expectedSequence: expectedSequence, events: events,
                                       documents: documents, verificationRecords: verificationRecords)
        if matching != nil { throw CoordinatorError("fixture_response_lost") }
        return result
    }
}

private final class Fixture {
    let directory: URL
    let anchor = FixtureAnchor()
    let clock = FixtureClock()
    var sqlite: SQLiteJournal!
    var port: FaultPort!
    var adapter: ClaudeCoreAdapter!

    init() throws {
        var claudeRoot = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { claudeRoot.deleteLastPathComponent() }
        directory = claudeRoot.appendingPathComponent("build/shared-engine/unit-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try reopen()
    }
    deinit {
        adapter = nil
        port = nil
        sqlite = nil
        try? FileManager.default.removeItem(at: directory)
    }
    func reopen() throws {
        adapter = nil
        port = nil
        sqlite = nil
        sqlite = try SQLiteJournal(databaseURL: directory.appendingPathComponent("journal.sqlite"),
                                   keyURL: directory.appendingPathComponent("fixture.key"), freshnessStore: anchor)
        port = FaultPort(sqlite)
        adapter = try ClaudeCoreAdapter(journal: port, clock: clock,
                                        wallNow: { Date(timeIntervalSince1970: 1_788_768_000) })
    }
    func state() throws -> CoordinatorSemanticState { try CoordinatorSemanticReplay.replay(sqlite.load()) }
}

private func binding(_ suffix: String = "a") -> [String: Any] {
    ["project_id": "claude-fixture-project", "session_id": "native-session-same",
     // Explicit INTERNAL core turn identity; source_prompt_id is the native observation.
     "source_turn_id": "internal-core-turn-\(suffix)", "source_prompt_id": "native-prompt-\(suffix)",
     "episode_id": "fixture-episode", "episode_root_prompt_id": "native-prompt-a",
     "episode_baseline_checkpoint_id": "fixture-checkpoint",
     "decision_boundary_id": "fixture-boundary-\(suffix)", "boundary_sequence": 1]
}

private func proposal(_ suffix: String = "a") -> [String: Any] {
    ["proposal_id": "proposal-\(suffix)", "task_goal": "Exercise the shared engine with explicit model inputs.",
     "outcome": ["status": "completed", "summary": "Fixture proposal \(suffix)"],
     "reported_side_effects": [],
     "options": [
        ["id": "read-\(suffix)", "title": "Read fixture", "description": "Read the named fixture only.",
         "task": "Read fixture-\(suffix).txt", "done_when": "The file contents are reported.",
         "constraints": ["Do not modify any files."]],
        ["id": "list-\(suffix)", "title": "List fixtures", "description": "List the current fixture directory.",
         "task": "List the current directory", "done_when": "The listing is reported.", "constraints": []],
     ]]
}

private func response(_ adapter: ClaudeCoreAdapter, _ operation: String, _ fields: [String: Any] = [:]) throws -> [String: Any] {
    var request = fields
    request["operation"] = operation
    request["schema_version"] = "0.1"
    request["request_id"] = UUID().uuidString
    return try StrictJSONTransport.object(from: adapter.respond(to: StrictJSONTransport.data(forJSONObject: request)))
}

private func success(_ adapter: ClaudeCoreAdapter, _ operation: String, _ fields: [String: Any] = [:]) throws -> [String: Any] {
    let reply = try response(adapter, operation, fields)
    guard reply["ok"] as? Bool == true, let result = reply["result"] as? [String: Any] else {
        let code = (reply["error"] as? [String: Any])?["code"] as? String ?? "test_bad_response"
        throw CoordinatorError(code)
    }
    return result
}

private func rejected(_ adapter: ClaudeCoreAdapter, _ operation: String, _ fields: [String: Any], code: String? = nil) throws {
    let reply = try response(adapter, operation, fields)
    #expect(reply["ok"] as? Bool == false)
    if let code { #expect((reply["error"] as? [String: Any])?["code"] as? String == code) }
    #expect(reply["result"] == nil)
}

private func activate(_ fixture: Fixture, _ suffix: String = "a") throws -> [String: Any] {
    try success(fixture.adapter, "activate", ["binding": binding(suffix), "proposal": proposal(suffix)])
}

private func select(_ fixture: Fixture, _ activation: [String: Any], _ suffix: String = "a") throws -> [String: Any] {
    let packet = try #require(activation["packet"] as? [String: Any])
    let options = try #require(activation["option_bindings"] as? [[String: Any]])
    return try success(fixture.adapter, "select", [
        "binding": binding(suffix), "packet_id": packet["packet_id"]!, "revision": packet["revision"]!,
        "selection_id": "selection-\(suffix)", "option_id": options[0]["option_id"]!,
    ])
}

private func claim(_ fixture: Fixture, _ suffix: String = "a") throws -> [String: Any] {
    try success(fixture.adapter, "claim", ["binding": binding(suffix), "selection_id": "selection-\(suffix)"])
}

private func completeFields(_ suffix: String = "a", outcome: String = "completed") -> [String: Any] {
    ["binding": binding(suffix), "selection_id": "selection-\(suffix)", "outcome": outcome,
     "note": "Model reports the requested fixture action result."]
}

private func canonical(_ value: Any) throws -> Data { try StrictJSONTransport.data(forJSONObject: value) }

private func dismissalFields(_ activation: [String: Any], suffix: String = "a") throws -> [String: Any] {
    let packet = try #require(activation["packet"] as? [String: Any])
    return ["binding": binding(suffix), "interaction_id": packet["interaction_id"]!,
            "packet_id": packet["packet_id"]!, "revision": packet["revision"]!]
}

@Test("Claude dismissal closes the exact ranked card without selection or continuation and retries only its receipt")
func dismissalClosesWithoutExecutionAndRetriesExactCard() throws {
    let f = try Fixture(), activated = try activate(f)
    let fields = try dismissalFields(activated)
    let result = try success(f.adapter, "dismiss_interaction", fields)
    #expect(result["dismissed"] as? Bool == true)
    #expect(result["interaction_id"] as? String == fields["interaction_id"] as? String)
    let current = try #require(f.state().boundary(for: CoordinatorBinding(jsonObject: binding())))
    #expect(current.closed && current.closeReason == "user_dismissed")
    #expect(current.selection == nil)
    #expect(try f.state().continuations.isEmpty)
    #expect((try success(f.adapter, "snapshot")["cards"] as? [Any])?.isEmpty == true)
    let after = try f.sqlite.load().events.count
    #expect(try canonical(success(f.adapter, "dismiss_interaction", fields)) == canonical(result))
    #expect(try f.sqlite.load().events.count == after)
    try rejected(f.adapter, "claim", ["binding": binding(), "selection_id": "never-created"], code: "invalid_claim")

    _ = try activate(f, "b")
    _ = try success(f.adapter, "dismiss_interaction", fields)
    #expect(try f.state().boundary(for: CoordinatorBinding(jsonObject: binding("b")))?.isPendingInteraction == true)
    #expect(try f.state().continuations.isEmpty)
}

@Test("Claude dismissal rejects stale card, revision and session bindings", arguments: ["interaction_id", "packet_id", "revision", "session_id", "source_prompt_id"])
func dismissalRejectsStaleIdentity(_ field: String) throws {
    let f = try Fixture(), activated = try activate(f)
    var fields = try dismissalFields(activated)
    if field == "session_id" || field == "source_prompt_id" {
        var different = binding(); different[field] = "another-identity"; fields["binding"] = different
    } else { fields[field] = field == "revision" ? 2 : "another-card" }
    let before = try f.sqlite.load().events.count
    try rejected(f.adapter, "dismiss_interaction", fields)
    #expect(try f.sqlite.load().events.count == before)
    #expect(try f.state().boundary(for: CoordinatorBinding(jsonObject: binding()))?.isPendingInteraction == true)
    #expect(try f.state().continuations.isEmpty)
}

@Test("Claude dismissal rechecks monotonic expiry after a previously ready projection")
func dismissalRejectsExpiredCard() throws {
    let f = try Fixture(), activated = try activate(f)
    let fields = try dismissalFields(activated)
    #expect((try success(f.adapter, "snapshot")["cards"] as? [Any])?.count == 1)
    f.clock.advance(seconds: CoordinatorRoutingApplication.expiryAfterNanoseconds / 1_000_000_000)
    try rejected(f.adapter, "dismiss_interaction", fields, code: "interaction_not_waiting")
    #expect(try f.state().boundary(for: CoordinatorBinding(jsonObject: binding()))?.closeReason != "user_dismissed")
    #expect(try f.state().continuations.isEmpty)
}

@Test("Provider dismissal defers expiry writes and latches replay-time clock regression until scheduler cleanup", arguments: ["expiry", "regression"])
func dismissalDelayedValidationDefersDueWrites(_ kind: String) throws {
    let f = try Fixture(), activated = try activate(f)
    let fields = try dismissalFields(activated)
    f.clock.set(seconds: kind == "expiry" ? 596 : 8)
    _ = try success(f.adapter, "snapshot")
    if kind == "regression" { f.clock.set(seconds: 10) }
    let before = try f.sqlite.load().events.count
    f.port.beforeNextLoad { [clock = f.clock] in clock.set(seconds: kind == "expiry" ? 600 : 9) }
    try rejected(f.adapter, "dismiss_interaction", fields, code: "interaction_not_waiting")
    #expect(try f.sqlite.load().events.count == before)
    // Recover above the admission sample without running the scheduler first.
    // Clock recovery must not restore the rejected card's dismissal authority.
    f.clock.set(seconds: kind == "expiry" ? 601 : 11)
    try rejected(f.adapter, "dismiss_interaction", fields, code: "interaction_not_waiting")
    #expect(try f.sqlite.load().events.count == before)
    #expect(f.adapter.millisecondsUntilNextDeadline() == 0)
    let snapshot = try success(f.adapter, "snapshot")
    #expect((snapshot["cards"] as? [Any])?.isEmpty == true)
    let state = try f.state()
    let closed = try #require(state.boundary(for: CoordinatorBinding(jsonObject: binding())))
    #expect(closed.expired && closed.selection == nil)
    #expect(state.continuations.isEmpty)
    #expect(try f.sqlite.load().events.count > before)
}

@Test("Real SQLite roundtrip preserves original proposal and one-time core action identity")
func roundtrip() throws {
    let f = try Fixture()
    let activated = try activate(f)
    #expect(try canonical(activated["claude_proposal"]!) == canonical(proposal()))
    let packet = try #require(activated["packet"] as? [String: Any])
    #expect((packet["evidence"] as? [Any])?.isEmpty == true)
    #expect(packet["valid_after_event_sequence"] as? Int == 2)
    let selected = try select(f, activated)
    var continuation = try #require(f.state().continuation(id: selected["continuation_id"] as! String))
    #expect(continuation.consumedAt == nil)
    #expect(continuation.transport == nil) // Selection/notification is not receipt.
    try rejected(f.adapter, "complete", completeFields(), code: "invalid_completion")
    let claimed = try claim(f)
    let original = try #require((proposal()["options"] as? [[String: Any]])?.first)
    #expect(try canonical(claimed["option"]!) == canonical(original))
    continuation = try #require(f.state().continuation(id: selected["continuation_id"] as! String))
    #expect(continuation.consumedAt != nil)
    #expect(continuation.transport?.status == .completed)
    #expect(continuation.queuedActionContextClaim == nil)
    let reply = try success(f.adapter, "complete", completeFields())
    #expect(reply["reported_by"] as? String == "model")
    let state = try f.state()
    #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding()))?.closed == true)
    let outcome = try #require(state.continuation(id: continuation.continuationID)?.workOutcome)
    #expect(outcome.status == "succeeded")
    #expect(outcome.summary.hasPrefix(ClaudeCoreAdapter.modelReportPrefix))
    #expect(outcome.evidenceIDs.isEmpty)
    let persisted = try f.sqlite.load()
    #expect(persisted.events.count == 8)
    #expect(!String(decoding: try canonical(claimed), as: UTF8.self).contains("continuation_token"))
    #expect(!persisted.events.contains { String(decoding: $0, as: UTF8.self).contains("continuation_token") })
}

@Test("C-L01 old completed or failed result preserves new card binding and foreground", arguments: ["completed", "failed"])
func oldResultPreservesLatest(outcome: String) throws {
    let f = try Fixture()
    let a = try activate(f)
    _ = try select(f, a)
    _ = try claim(f)
    #expect(try success(f.adapter, "invalidate", ["binding": binding()])["status"] as? String == "preserved_claimed")
    let newer = try activate(f, "new-native-prompt")
    let before = try success(f.adapter, "snapshot")
    _ = try success(f.adapter, "complete", completeFields(outcome: outcome))
    let after = try success(f.adapter, "snapshot")
    #expect(try canonical(before["routing"]!) == canonical(after["routing"]!))
    #expect(try canonical(before["cards"]!) == canonical(after["cards"]!))
    #expect((after["outcomes"] as? [[String: Any]])?.first?["status"] as? String == (outcome == "completed" ? "succeeded" : "failed"))
    _ = try select(f, newer, "new-native-prompt")
    _ = try claim(f, "new-native-prompt")
}

@Test("Wrong and repeated claims/results cannot execute or replace an original result")
func wrongAndDuplicateAuthority() throws {
    let f = try Fixture()
    let a = try activate(f)
    _ = try select(f, a)
    try rejected(f.adapter, "claim", ["binding": binding("other"), "selection_id": "selection-a"], code: "invalid_claim")
    _ = try claim(f)
    try rejected(f.adapter, "claim", ["binding": binding(), "selection_id": "selection-a"], code: "invalid_claim")
    var wrong = completeFields()
    wrong["binding"] = binding("other")
    try rejected(f.adapter, "complete", wrong, code: "invalid_completion")
    _ = try success(f.adapter, "complete", completeFields())
    let state = try f.state()
    try rejected(f.adapter, "complete", completeFields(outcome: "failed"), code: "invalid_completion")
    #expect(try f.state() == state)
}

@Test("Native new input closes an unselected card and revokes unclaimed selected execution")
func invalidateUnclaimed() throws {
    let f = try Fixture()
    let a = try activate(f)
    #expect(try success(f.adapter, "invalidate", ["binding": binding()])["status"] as? String == "closed_unclaimed")
    #expect((try success(f.adapter, "snapshot")["cards"] as? [Any])?.isEmpty == true)
    let b = try activate(f, "b")
    _ = try select(f, b, "b")
    #expect(try success(f.adapter, "invalidate", ["binding": binding("b")])["status"] as? String == "revoked_unclaimed_selection")
    try rejected(f.adapter, "claim", ["binding": binding("b"), "selection_id": "selection-b"], code: "invalid_claim")
    let packet = try #require(a["packet"] as? [String: Any])
    try rejected(f.adapter, "select", ["binding": binding(), "packet_id": packet["packet_id"]!, "revision": 1,
                                      "selection_id": "stale-a", "option_id": "unknown"], code: "invalid_selection")
    _ = try activate(f, "c")
}

@Test("Two runtime scopes with identical native identities cannot claim each other's selection")
func independentScopes() throws {
    let left = try Fixture()
    let right = try Fixture()
    let a = try activate(left)
    _ = try activate(right)
    _ = try select(left, a)
    let rightBefore = try right.state()
    try rejected(right.adapter, "claim", ["binding": binding(), "selection_id": "selection-a"], code: "invalid_claim")
    #expect(try right.state() == rightBefore)
    _ = try claim(left)
    _ = try success(left.adapter, "complete", completeFields())
    #expect(try right.state() == rightBefore)
}

@Test("Restart retains audit but never restores card, claim, or result authority", arguments: ["pending", "selected", "claimed"])
func restartFailsClosed(stage: String) throws {
    let f = try Fixture()
    let a = try activate(f)
    if stage != "pending" { _ = try select(f, a) }
    if stage == "claimed" { _ = try claim(f) }
    let priorCount = try f.sqlite.load().journalSequence
    try f.reopen()
    #expect(try f.sqlite.load().journalSequence >= priorCount)
    let snapshot = try success(f.adapter, "snapshot")
    #expect((snapshot["cards"] as? [Any])?.isEmpty == true)
    #expect((snapshot["routing"] as? [String: Any])?["selection_enabled"] as? Bool == false)
    try rejected(f.adapter, "claim", ["binding": binding(), "selection_id": "selection-a"], code: "invalid_claim")
    try rejected(f.adapter, "complete", completeFields(), code: "invalid_completion")
    try rejected(f.adapter, "activate", ["binding": binding(), "proposal": proposal()])
    _ = try activate(f, "after-restart-native-prompt")
}

@Test("Failed or ambiguous consume/transport never returns or replays a task", arguments: [
    "continuation_consumed", "continuation_transport_completed",
])
func claimPersistenceFailures(eventType: String) throws {
    for afterCommit in [false, true] {
        let f = try Fixture()
        let a = try activate(f)
        _ = try select(f, a)
        f.port.failNext(eventType, afterCommit: afterCommit)
        try rejected(f.adapter, "claim", ["binding": binding(), "selection_id": "selection-a"])
        try rejected(f.adapter, "claim", ["binding": binding(), "selection_id": "selection-a"], code: "invalid_claim")
        try rejected(f.adapter, "complete", completeFields(), code: "invalid_completion")
        try f.reopen()
        try rejected(f.adapter, "claim", ["binding": binding(), "selection_id": "selection-a"], code: "invalid_claim")
        #expect(try f.state().continuations.values.allSatisfy { $0.workOutcome == nil })
    }
}

@Test("Token expiry is enforced by the production continuous clock")
func expiry() throws {
    let f = try Fixture()
    _ = try select(f, activate(f))
    f.clock.advance(seconds: 120)
    try rejected(f.adapter, "claim", ["binding": binding(), "selection_id": "selection-a"], code: "continuation_expired")
    #expect(try f.state().continuations.values.allSatisfy { $0.consumedAt == nil })
}

@Test("Result or close failure preserves durable first outcome and the newer card", arguments: [
    "work_outcome_recorded", "decision_boundary_closed",
])
func resultPersistenceFailures(eventType: String) throws {
    for afterCommit in [false, true] {
        let f = try Fixture()
        let a = try activate(f)
        let selected = try select(f, a)
        _ = try claim(f)
        _ = try activate(f, "newer")
        let before = try success(f.adapter, "snapshot")
        f.port.failNext(eventType, afterCommit: afterCommit)
        try rejected(f.adapter, "complete", completeFields())
        let afterFailure = try success(f.adapter, "snapshot")
        #expect(try canonical(before["routing"]!) == canonical(afterFailure["routing"]!))
        #expect(try canonical(before["cards"]!) == canonical(afterFailure["cards"]!))
        let continuationID = try #require(selected["continuation_id"] as? String)
        let recorded = try f.state().continuation(id: continuationID)?.workOutcome
        if eventType == "work_outcome_recorded" && !afterCommit {
            #expect(recorded == nil)
            // A known uncommitted result can be reported again, with no new
            // execution claim and without disturbing the foreground card.
            _ = try success(f.adapter, "complete", completeFields())
        } else {
            #expect(recorded?.status == "succeeded")
            try rejected(f.adapter, "complete", completeFields(outcome: "failed"))
            #expect(try f.state().continuation(id: continuationID)?.workOutcome == recorded)
        }
        let final = try success(f.adapter, "snapshot")
        #expect(try canonical(before["cards"]!) == canonical(final["cards"]!))
        #expect((final["outcomes"] as? [[String: Any]])?.count == 1)
    }
}

@Test("Missing outcome, constraints, or side effects never become invented proposal content")
func proposalValidation() throws {
    let f = try Fixture()
    for key in ["outcome", "reported_side_effects", "task_goal"] {
        var incomplete = proposal()
        incomplete.removeValue(forKey: key)
        try rejected(f.adapter, "activate", ["binding": binding(), "proposal": incomplete], code: "invalid_fields")
    }
    var incomplete = proposal()
    var options = try #require(incomplete["options"] as? [[String: Any]])
    options[0].removeValue(forKey: "constraints")
    incomplete["options"] = options
    try rejected(f.adapter, "activate", ["binding": binding(), "proposal": incomplete], code: "invalid_fields")
    var large = proposal()
    var largeOptions = try #require(large["options"] as? [[String: Any]])
    largeOptions[0]["constraints"] = Array(repeating: String(repeating: "x", count: 1024), count: 25)
    large["options"] = largeOptions
    try rejected(f.adapter, "activate", ["binding": binding(), "proposal": large], code: "proposal_too_large")
    #expect(try f.sqlite.load().journalSequence == 0)
    let oversized = f.adapter.respond(to: Data(repeating: 32, count: ClaudeCoreAdapter.maximumMessageBytes + 1))
    let reply = try StrictJSONTransport.object(from: oversized)
    #expect((reply["error"] as? [String: Any])?["code"] as? String == "request_too_large")
}

@Test("Large live proposals are rejected before commit if all current cards cannot fit")
func aggregateSnapshotAdmission() throws {
    let f = try Fixture()
    func largeProposal(_ suffix: String) throws -> [String: Any] {
        var value = proposal(suffix)
        var options = try #require(value["options"] as? [[String: Any]])
        for index in options.indices {
            options[index]["constraints"] = Array(repeating: String(repeating: "x", count: 1000), count: 10)
        }
        value["options"] = options
        return value
    }
    _ = try success(f.adapter, "activate", ["binding": binding(), "proposal": largeProposal("a")])
    let before = try f.sqlite.load()
    var other = binding("b")
    other["session_id"] = "native-other-session"
    try rejected(f.adapter, "activate", ["binding": other, "proposal": largeProposal("b")], code: "snapshot_capacity")
    #expect(try f.sqlite.load() == before)
    let snapshot = try success(f.adapter, "snapshot")
    #expect((snapshot["cards"] as? [Any])?.count == 1)
    #expect(try canonical(snapshot).count < ClaudeCoreAdapter.maximumMessageBytes)
    // A smaller second card still fits and remains fully represented.
    _ = try success(f.adapter, "activate", ["binding": other, "proposal": proposal("b")])
    let accepted = try success(f.adapter, "snapshot")
    #expect((accepted["cards"] as? [Any])?.count == 2)
    #expect(try canonical(accepted).count < ClaudeCoreAdapter.maximumMessageBytes)
}

@Test("Ambiguous committed result releases its quota slot and history remains bounded")
func recoveredResultQuotaAndBoundedHistory() throws {
    let f = try Fixture()
    for index in 0..<32 {
        let suffix = "quota-\(index)"
        _ = try select(f, activate(f, suffix), suffix)
        _ = try claim(f, suffix)
    }
    let extra = try activate(f, "extra")
    let packet = try #require(extra["packet"] as? [String: Any])
    let options = try #require(extra["option_bindings"] as? [[String: Any]])
    let selectionFields: [String: Any] = [
        "binding": binding("extra"), "packet_id": packet["packet_id"]!, "revision": packet["revision"]!,
        "selection_id": "selection-extra", "option_id": options[0]["option_id"]!,
    ]
    try rejected(f.adapter, "select", selectionFields, code: "live_claim_capacity")
    f.port.failNext("work_outcome_recorded", afterCommit: true)
    try rejected(f.adapter, "complete", completeFields("quota-0"))
    try rejected(f.adapter, "complete", completeFields("quota-0", outcome: "failed"), code: "invalid_completion")
    _ = try success(f.adapter, "select", selectionFields)
    _ = try claim(f, "extra")
    // More than 48KiB of real model result notes is retained in SQLite. The
    // wire reports omitted history explicitly while preserving its newest note.
    for index in 1..<13 {
        var report = completeFields("quota-\(index)")
        report["note"] = String(repeating: "x", count: 4096)
        _ = try success(f.adapter, "complete", report)
    }
    let snapshot = try success(f.adapter, "snapshot")
    let outcomes = try #require(snapshot["outcomes"] as? [[String: Any]])
    let history = try #require(snapshot["history"] as? [String: Any])
    #expect(history["total_outcomes"] as? Int == 13)
    #expect((history["omitted_outcomes"] as? Int ?? 0) > 0)
    #expect(outcomes.last?["selection_id"] as? String == "selection-quota-12")
    #expect(try canonical(snapshot).count < ClaudeCoreAdapter.maximumMessageBytes)
    #expect(try f.state().continuations.values.filter { $0.workOutcome != nil }.count == 13)
}
