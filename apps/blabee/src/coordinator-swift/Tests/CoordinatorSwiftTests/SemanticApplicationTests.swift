import Foundation
import Testing
@testable import CoordinatorSwift

private let semanticAppRoot: URL = {
    let packageRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    return packageRoot.deletingLastPathComponent().deletingLastPathComponent()
}()

private func semanticData(_ object: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
}

private func semanticObject(_ data: Data) throws -> [String: Any] {
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw CoordinatorError("test_json_invalid")
    }
    return value
}

private func semanticBinding(
    suffix: String,
    boundarySequence: Int = 1,
    boundaryID: String? = nil
) -> [String: Any] {
    [
        "project_id": "project_semantic_\(suffix)",
        "session_id": "session_semantic_\(suffix)",
        "source_turn_id": "turn_semantic_\(suffix)",
        "source_prompt_id": "prompt_semantic_\(suffix)",
        "episode_id": "episode_semantic_\(suffix)",
        "episode_root_prompt_id": "prompt_semantic_\(suffix)",
        "episode_baseline_checkpoint_id": "checkpoint_semantic_\(suffix)",
        "decision_boundary_id": boundaryID ?? "boundary_semantic_\(suffix)",
        "boundary_sequence": boundarySequence,
    ]
}

private func semanticPacket(
    binding: [String: Any],
    validAfter: Int,
    suffix: String,
    sealedAt: String = "2026-08-21T01:00:01Z",
    expiresAt: String = "2026-08-21T01:02:01Z"
) throws -> [String: Any] {
    let source = semanticAppRoot.appendingPathComponent(
        "Fixtures/v1/contracts/valid/decision-packet-rollback-disabled.json"
    )
    guard var packet = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as? [String: Any],
          var checkpoint = packet["checkpoint"] as? [String: Any],
          var choices = packet["choices"] as? [[String: Any]]
    else { throw CoordinatorError("test_fixture_invalid") }
    for (key, value) in binding { packet[key] = value }
    packet["interaction_id"] = "interaction_semantic_\(suffix)"
    packet["packet_id"] = "packet_semantic_\(suffix)"
    packet["revision"] = 1
    packet["valid_after_event_sequence"] = validAfter
    packet["sealed_at"] = sealedAt
    packet["expires_at"] = expiresAt
    checkpoint["id"] = binding["episode_baseline_checkpoint_id"]
    packet["checkpoint"] = checkpoint
    for index in choices.indices {
        choices[index]["option_id"] = "option_semantic_\(suffix)_\(index + 1)"
        if choices[index]["action_id"] is String {
            choices[index]["action_id"] = "action_semantic_\(suffix)_\(index + 1)"
        }
    }
    packet["choices"] = choices
    return packet
}

private func semanticOpen(
    binding: [String: Any],
    suffix: String,
    occurredAt: String = "2026-08-21T01:00:00Z"
) throws -> Data {
    try semanticData([
        "type": "open_boundary",
        "event_id": "event_semantic_\(suffix)_open",
        "occurred_at": occurredAt,
        "binding": binding,
        "proposal_id": "proposal_semantic_\(suffix)",
    ])
}

private func semanticSeal(packet: [String: Any], suffix: String) throws -> Data {
    try semanticData([
        "type": "seal_packet",
        "event_id": "event_semantic_\(suffix)_seal",
        "packet": packet,
    ])
}

private func semanticSelection(
    packet: [String: Any],
    slot: Int,
    suffix: String,
    occurredAt: String = "2026-08-21T01:00:03Z",
    expiresAt: String = "2026-08-21T01:02:03Z",
    deadlineAt: String = "2026-08-21T01:05:03Z"
) throws -> Data {
    guard let choices = packet["choices"] as? [[String: Any]] else {
        throw CoordinatorError("test_fixture_invalid")
    }
    var request: [String: Any] = [
        "schema_version": "1.0",
        "kind": "blabee_selection_request",
        "selection_id": "selection_semantic_\(suffix)",
        "interaction_id": packet["interaction_id"]!,
        "packet_id": packet["packet_id"]!,
        "revision": packet["revision"]!,
        "option_id": choices[slot - 1]["option_id"]!,
    ]
    for key in semanticBinding(suffix: suffix).keys { request[key] = packet[key] }
    return try semanticData([
        "type": "select_option",
        "event_ids": [
            "selection_claimed": "event_semantic_\(suffix)_selection",
            "continuation_dispatched": "event_semantic_\(suffix)_dispatch",
            "decision_boundary_closed": "event_semantic_\(suffix)_pause_close",
        ],
        "occurred_at": occurredAt,
        "request": request,
        "continuation_id": "continuation_semantic_\(suffix)",
        "issued_at": occurredAt,
        "expires_at": expiresAt,
        "in_flight_deadline_at": deadlineAt,
    ])
}

private func semanticEnvelope(from result: CoordinatorSemanticExecutionResult) throws -> [String: Any] {
    let effect = try semanticObject(try #require(result.effects.first))
    return try #require(effect["envelope"] as? [String: Any])
}

private func semanticExpectCode(_ expected: String, _ operation: () throws -> Void) {
    do {
        try operation()
        Issue.record("expected error \(expected)")
    } catch let error as CoordinatorError {
        #expect(error.code == expected)
    } catch {
        Issue.record("unexpected error \(error)")
    }
}

private final class SemanticMemoryJournal: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: JournalSnapshot
    private var sequenceConflicts = 0
    private var loseResponseAfterCommit = false
    private var appendAttemptCount = 0

    init(snapshot: JournalSnapshot = JournalSnapshot(
        events: [],
        documents: [],
        verificationRecords: [],
        journalSequence: 0
    )) {
        stored = snapshot
    }

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
        appendAttemptCount += 1
        if sequenceConflicts > 0 {
            sequenceConflicts -= 1
            throw CoordinatorError("journal_sequence_conflict")
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
        let commit = JournalAppendResult(
            firstSequence: expectedSequence + 1,
            lastSequence: candidate.journalSequence,
            eventCount: events.count
        )
        if loseResponseAfterCommit {
            loseResponseAfterCommit = false
            throw CoordinatorError("simulated_lost_response")
        }
        return commit
    }

    func conflictOnNextAppend() {
        lock.lock()
        sequenceConflicts += 1
        lock.unlock()
    }

    func loseNextCommittedResponse() {
        lock.lock()
        loseResponseAfterCommit = true
        lock.unlock()
    }

    var appendAttempts: Int {
        lock.lock()
        defer { lock.unlock() }
        return appendAttemptCount
    }
}

private final class SemanticTokenCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func generate() throws -> ContinuationTokenMaterial {
        lock.lock()
        value += 1
        lock.unlock()
        return try ContinuationTokenMaterial.generate()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

@Test("semantic application completes the action lifecycle with canonical sidecars")
func semanticActionLifecycle() throws {
    let suffix = "lifecycle"
    let binding = semanticBinding(suffix: suffix)
    let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
    let journal = SemanticMemoryJournal()
    let app = CoordinatorSemanticApplication(journal: journal)

    _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
    _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
    let selected = try app.execute(command: semanticSelection(packet: packet, slot: 1, suffix: suffix))
    let envelope = try semanticEnvelope(from: selected)
    let token = try #require(envelope["continuation_token"] as? String)
    let selectedSnapshot = try journal.load()
    #expect(!selectedSnapshot.events.contains { String(decoding: $0, as: UTF8.self).contains(token) })
    #expect(!selectedSnapshot.verificationRecords.contains { String(decoding: $0, as: UTF8.self).contains(token) })
    #expect(selectedSnapshot.events.count == 4)
    #expect(selectedSnapshot.verificationRecords.count == 1)

    _ = try app.execute(command: semanticData([
        "type": "consume_pet_action",
        "event_id": "event_semantic_lifecycle_consume",
        "occurred_at": "2026-08-21T01:00:04Z",
        "envelope": envelope,
    ]))
    _ = try app.execute(command: semanticData([
        "type": "complete_transport",
        "event_id": "event_semantic_lifecycle_complete",
        "occurred_at": "2026-08-21T01:00:05Z",
        "binding": binding,
        "continuation_id": "continuation_semantic_lifecycle",
    ]))
    _ = try app.execute(command: semanticData([
        "type": "record_work_outcome",
        "event_id": "event_semantic_lifecycle_outcome",
        "occurred_at": "2026-08-21T01:00:06Z",
        "binding": binding,
        "continuation_id": "continuation_semantic_lifecycle",
        "status": "succeeded",
        "summary": "The fictional semantic action completed.",
        "evidence_ids": ["evidence_semantic_lifecycle"],
    ]))
    _ = try app.execute(command: semanticData([
        "type": "close_boundary",
        "event_id": "event_semantic_lifecycle_close",
        "occurred_at": "2026-08-21T01:00:07Z",
        "binding": binding,
        "close_reason": "work_outcome_recorded",
    ]))

    let state = try CoordinatorSemanticReplay.replay(journal.load())
    let typedBinding = try CoordinatorBinding(jsonObject: binding)
    #expect(state.boundary(for: typedBinding)?.closed == true)
    #expect(state.continuation(id: "continuation_semantic_lifecycle")?.transport?.status == .completed)
    #expect(state.continuation(id: "continuation_semantic_lifecycle")?.workOutcome?.status == "succeeded")
}

@Test("pause, timeout-unknown, repair, and expiry decisions preserve fail-closed semantics")
func semanticRemainingCommandParity() throws {
    do {
        let suffix = "pause"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
        let result = try app.execute(command: semanticSelection(packet: packet, slot: 3, suffix: suffix))
        #expect(try semanticObject(try #require(result.effects.first))["kind"] as? String == "episode_paused")
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.closed == true)
    }

    do {
        let suffix = "timeout"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
        _ = try app.execute(command: semanticSelection(packet: packet, slot: 2, suffix: suffix))
        _ = try app.execute(command: semanticData([
            "type": "timeout_transport_unknown",
            "event_id": "event_semantic_timeout_terminal",
            "occurred_at": "2026-08-21T01:05:03Z",
            "binding": binding,
            "continuation_id": "continuation_semantic_timeout",
        ]))
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        let transport = state.continuation(id: "continuation_semantic_timeout")?.transport
        #expect(transport?.status == .timedOutUnknown)
        #expect(transport?.automaticRetry == false)
    }

    do {
        let suffix = "repair"
        let binding = semanticBinding(suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        let reserved = try app.execute(command: semanticData([
            "type": "reserve_format_repair",
            "event_id": "event_semantic_repair_reserve",
            "occurred_at": "2026-08-21T01:00:01Z",
            "binding": binding,
            "continuation_id": "continuation_semantic_repair",
            "repair_request_id": "repair_request_semantic_repair",
            "parent_prompt_id": binding["source_prompt_id"]!,
            "issued_at": "2026-08-21T01:00:01Z",
            "expires_at": "2026-08-21T01:02:01Z",
        ]))
        let envelope = try semanticEnvelope(from: reserved)
        _ = try app.execute(command: semanticData([
            "type": "claim_format_repair",
            "event_id": "event_semantic_repair_claim",
            "occurred_at": "2026-08-21T01:00:02Z",
            "envelope": envelope,
        ]))
        semanticExpectCode("format_repair_already_claimed_for_boundary") {
            _ = try app.execute(command: semanticData([
                "type": "claim_format_repair",
                "event_id": "event_semantic_repair_claim_again",
                "occurred_at": "2026-08-21T01:00:03Z",
                "envelope": envelope,
            ]))
        }
    }

    do {
        let suffix = "expiry"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
        _ = try app.execute(command: semanticData([
            "type": "expire_interaction",
            "event_id": "event_semantic_expiry_expire",
            "occurred_at": "2026-08-21T01:02:01Z",
            "binding": binding,
        ]))
        let state = try CoordinatorSemanticReplay.replay(journal.load())
        #expect(state.boundary(for: try CoordinatorBinding(jsonObject: binding))?.expired == true)
    }
}

@Test("CAS retry reuses one token and never exposes effects before commit")
func semanticCASRetryAndLostResponse() throws {
    let suffix = "retry"
    let binding = semanticBinding(suffix: suffix)
    let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
    let journal = SemanticMemoryJournal()
    let setup = CoordinatorSemanticApplication(journal: journal)
    _ = try setup.execute(command: semanticOpen(binding: binding, suffix: suffix))
    _ = try setup.execute(command: semanticSeal(packet: packet, suffix: suffix))

    let counter = SemanticTokenCounter()
    let app = CoordinatorSemanticApplication(journal: journal, tokenGenerator: counter.generate)
    let attemptsBefore = journal.appendAttempts
    journal.conflictOnNextAppend()
    let selected = try app.execute(command: semanticSelection(packet: packet, slot: 1, suffix: suffix))
    #expect(counter.count == 1)
    #expect(journal.appendAttempts == attemptsBefore + 2)
    let envelope = try semanticEnvelope(from: selected)
    let verification = try semanticObject(try #require(journal.load().verificationRecords.first))
    #expect(ContinuationTokenMaterial.verify(
        token: try #require(envelope["continuation_token"] as? String),
        fingerprint: try #require(verification["correlation_token_fingerprint"] as? String)
    ))

    let lostSuffix = "lost"
    let lostBinding = semanticBinding(suffix: lostSuffix)
    let lostPacket = try semanticPacket(binding: lostBinding, validAfter: 2, suffix: lostSuffix)
    let lostJournal = SemanticMemoryJournal()
    let lostApp = CoordinatorSemanticApplication(journal: lostJournal)
    _ = try lostApp.execute(command: semanticOpen(binding: lostBinding, suffix: lostSuffix))
    _ = try lostApp.execute(command: semanticSeal(packet: lostPacket, suffix: lostSuffix))
    let command = try semanticSelection(packet: lostPacket, slot: 1, suffix: lostSuffix)
    lostJournal.loseNextCommittedResponse()
    semanticExpectCode("simulated_lost_response") { _ = try lostApp.execute(command: command) }
    #expect(try lostJournal.load().journalSequence == 4)
    semanticExpectCode("selection_already_claimed") { _ = try lostApp.execute(command: command) }
    #expect(try lostJournal.load().journalSequence == 4)
}

@Test("malformed non-null nested bindings never fall back to top-level authority")
func semanticMalformedNestedBindingFailsClosed() throws {
    let suffix = "malformed_binding"
    let binding = semanticBinding(suffix: suffix)
    let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
    let journal = SemanticMemoryJournal()
    let app = CoordinatorSemanticApplication(journal: journal)
    _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
    _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
    _ = try app.execute(command: semanticSelection(packet: packet, slot: 1, suffix: suffix))

    let commands: [[String: Any]] = [
        [
            "type": "complete_transport",
            "event_id": "event_semantic_malformed_binding_complete",
            "occurred_at": "2026-08-21T01:00:04Z",
            "continuation_id": "continuation_semantic_malformed_binding",
            "binding": "not_an_object",
        ],
        [
            "type": "timeout_transport_unknown",
            "event_id": "event_semantic_malformed_binding_timeout",
            "occurred_at": "2026-08-21T01:05:03Z",
            "continuation_id": "continuation_semantic_malformed_binding",
            "binding": ["not", "an", "object"],
        ],
        [
            "type": "record_work_outcome",
            "event_id": "event_semantic_malformed_binding_outcome",
            "occurred_at": "2026-08-21T01:00:05Z",
            "continuation_id": "continuation_semantic_malformed_binding",
            "binding": true,
            "status": "unknown",
            "summary": "Must not be accepted through top-level binding fallback.",
            "evidence_ids": [],
        ],
    ]
    for var command in commands {
        for (key, value) in binding { command[key] = value }
        semanticExpectCode("binding_incomplete") {
            _ = try app.execute(command: semanticData(command))
        }
    }
    #expect(try journal.load().journalSequence == 4)
}

@Test("application and custom token generator must use the same fingerprint key")
func semanticTokenIssuerKeyMismatchFailsBeforeAppend() throws {
    let applicationKey = Data("semantic-application-key".utf8)
    let differentKey = Data("different-generator-key".utf8)

    do {
        let suffix = "key_mismatch_action"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let setup = CoordinatorSemanticApplication(journal: journal)
        _ = try setup.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try setup.execute(command: semanticSeal(packet: packet, suffix: suffix))
        let mismatched = CoordinatorSemanticApplication(
            journal: journal,
            tokenHMACKey: applicationKey,
            tokenGenerator: { try ContinuationTokenMaterial.generate(hmacKey: differentKey) }
        )
        semanticExpectCode("token_fingerprint_mismatch") {
            _ = try mismatched.execute(
                command: semanticSelection(packet: packet, slot: 1, suffix: suffix)
            )
        }
        #expect(try journal.load().journalSequence == 2)
    }

    do {
        let suffix = "key_mismatch_repair"
        let binding = semanticBinding(suffix: suffix)
        let journal = SemanticMemoryJournal()
        let setup = CoordinatorSemanticApplication(journal: journal)
        _ = try setup.execute(command: semanticOpen(binding: binding, suffix: suffix))
        let mismatched = CoordinatorSemanticApplication(
            journal: journal,
            tokenHMACKey: applicationKey,
            tokenGenerator: { try ContinuationTokenMaterial.generate(hmacKey: differentKey) }
        )
        semanticExpectCode("token_fingerprint_mismatch") {
            _ = try mismatched.execute(command: semanticData([
                "type": "reserve_format_repair",
                "event_id": "event_semantic_key_mismatch_repair_reserve",
                "occurred_at": "2026-08-21T01:00:01Z",
                "binding": binding,
                "continuation_id": "continuation_semantic_key_mismatch_repair",
                "repair_request_id": "repair_request_semantic_key_mismatch_repair",
                "parent_prompt_id": binding["source_prompt_id"]!,
                "issued_at": "2026-08-21T01:00:01Z",
                "expires_at": "2026-08-21T01:02:01Z",
            ]))
        }
        #expect(try journal.load().journalSequence == 1)
    }

    do {
        let suffix = "key_mismatch_pause"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let setup = CoordinatorSemanticApplication(journal: journal)
        _ = try setup.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try setup.execute(command: semanticSeal(packet: packet, suffix: suffix))
        let mismatched = CoordinatorSemanticApplication(
            journal: journal,
            tokenHMACKey: applicationKey,
            tokenGenerator: { try ContinuationTokenMaterial.generate(hmacKey: differentKey) }
        )
        let paused = try mismatched.execute(
            command: semanticSelection(packet: packet, slot: 3, suffix: suffix)
        )
        #expect(try semanticObject(try #require(paused.effects.first))["kind"] as? String == "episode_paused")
        #expect(try journal.load().journalSequence == 4)
    }
}

@Test("semantic identifiers use NFC and identity references are byte exact")
func semanticIdentifierNormalizationAndLookupParity() throws {
    let composed = "caf\u{00E9}"
    let decomposed = "cafe\u{0301}"

    do {
        let suffix = "nfc_event"
        let binding = semanticBinding(suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        var command = try semanticObject(semanticOpen(binding: binding, suffix: suffix))
        command["event_id"] = "event_\(decomposed)"
        semanticExpectCode("event_id_invalid") {
            _ = try app.execute(command: semanticData(command))
        }
        #expect(try journal.load().journalSequence == 0)
    }

    do {
        let suffix = "nfc_selection"
        let binding = semanticBinding(suffix: suffix)
        var packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        packet["interaction_id"] = "interaction_\(composed)"
        packet["packet_id"] = "packet_\(composed)"
        var choices = try #require(packet["choices"] as? [[String: Any]])
        choices[0]["option_id"] = "option_\(composed)"
        packet["choices"] = choices
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))

        var interactionAlias = try semanticObject(
            semanticSelection(packet: packet, slot: 1, suffix: suffix)
        )
        var interactionRequest = try #require(interactionAlias["request"] as? [String: Any])
        interactionRequest["interaction_id"] = "interaction_\(decomposed)"
        interactionAlias["request"] = interactionRequest
        semanticExpectCode("decision_boundary_binding_mismatch") {
            _ = try app.execute(command: semanticData(interactionAlias))
        }

        var packetAlias = try semanticObject(
            semanticSelection(packet: packet, slot: 1, suffix: suffix)
        )
        var packetRequest = try #require(packetAlias["request"] as? [String: Any])
        packetRequest["packet_id"] = "packet_\(decomposed)"
        packetAlias["request"] = packetRequest
        semanticExpectCode("decision_boundary_binding_mismatch") {
            _ = try app.execute(command: semanticData(packetAlias))
        }

        var optionAlias = try semanticObject(
            semanticSelection(packet: packet, slot: 1, suffix: suffix)
        )
        var optionRequest = try #require(optionAlias["request"] as? [String: Any])
        optionRequest["option_id"] = "option_\(decomposed)"
        optionAlias["request"] = optionRequest
        semanticExpectCode("decision_option_not_found") {
            _ = try app.execute(command: semanticData(optionAlias))
        }
        #expect(try journal.load().journalSequence == 2)
    }

    do {
        let suffix = "nfc_checkpoint"
        var binding = semanticBinding(suffix: suffix)
        binding["episode_baseline_checkpoint_id"] = "checkpoint_\(composed)"
        var packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        var checkpoint = try #require(packet["checkpoint"] as? [String: Any])
        checkpoint["id"] = "checkpoint_\(decomposed)"
        packet["checkpoint"] = checkpoint
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        semanticExpectCode("decision_packet_checkpoint_mismatch") {
            _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
        }
        #expect(try journal.load().journalSequence == 1)
    }

    do {
        let suffix = "nfc_continuation"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
        var selection = try semanticObject(
            semanticSelection(packet: packet, slot: 1, suffix: suffix)
        )
        let composedContinuationID = "continuation_\(composed)"
        selection["continuation_id"] = composedContinuationID
        let selected = try app.execute(command: semanticData(selection))
        let envelope = try semanticEnvelope(from: selected)

        var aliasedEnvelope = envelope
        aliasedEnvelope["continuation_id"] = "continuation_\(decomposed)"
        semanticExpectCode("continuation_not_dispatched") {
            _ = try app.execute(command: semanticData([
                "type": "consume_pet_action",
                "event_id": "event_semantic_nfc_continuation_consume_alias",
                "occurred_at": "2026-08-21T01:00:04Z",
                "envelope": aliasedEnvelope,
            ]))
        }

        for type in ["complete_transport", "timeout_transport_unknown", "record_work_outcome"] {
            var command: [String: Any] = [
                "type": type,
                "event_id": "event_semantic_nfc_continuation_\(type)",
                "occurred_at": "2026-08-21T01:00:04Z",
                "binding": binding,
                "continuation_id": "continuation_\(decomposed)",
            ]
            if type == "record_work_outcome" {
                command["status"] = "unknown"
                command["summary"] = "This alias must not resolve to the stored continuation."
                command["evidence_ids"] = []
            }
            semanticExpectCode("continuation_not_dispatched") {
                _ = try app.execute(command: semanticData(command))
            }
        }

        let state = try CoordinatorSemanticReplay.replay(journal.load())
        #expect(state.continuation(id: composedContinuationID) != nil)
        #expect(state.continuation(id: "continuation_\(decomposed)") == nil)
        #expect(try journal.load().journalSequence == 4)
    }
}

@Test("multi-invalid commands preserve the JS reference error priority")
func semanticCommandErrorPrecedenceParity() throws {
    do {
        let suffix = "precedence_action"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
        var missingContinuation = try semanticObject(
            semanticSelection(packet: packet, slot: 1, suffix: suffix)
        )
        missingContinuation.removeValue(forKey: "continuation_id")
        var missingEventIDs = try #require(missingContinuation["event_ids"] as? [String: Any])
        missingEventIDs.removeValue(forKey: "selection_claimed")
        missingContinuation["event_ids"] = missingEventIDs
        semanticExpectCode("continuation_id_missing") {
            _ = try app.execute(command: semanticData(missingContinuation))
        }
        let selected = try app.execute(
            command: semanticSelection(packet: packet, slot: 1, suffix: suffix)
        )

        semanticExpectCode("transport_terminal_observation_missing") {
            _ = try app.execute(command: semanticData([
                "type": "close_boundary",
                "event_id": "event_semantic_precedence_action_close_early",
                "occurred_at": "not-a-time",
                "binding": binding,
                "close_reason": "BAD",
            ]))
        }

        let envelope = try semanticEnvelope(from: selected)
        _ = try app.execute(command: semanticData([
            "type": "consume_pet_action",
            "event_id": "event_semantic_precedence_action_consume",
            "occurred_at": "2026-08-21T01:00:04Z",
            "envelope": envelope,
        ]))
        _ = try app.execute(command: semanticData([
            "type": "complete_transport",
            "event_id": "event_semantic_precedence_action_complete",
            "occurred_at": "2026-08-21T01:00:05Z",
            "binding": binding,
            "continuation_id": "continuation_semantic_precedence_action",
        ]))

        semanticExpectCode("runtime_event_id_duplicate") {
            _ = try app.execute(command: semanticData([
                "type": "record_work_outcome",
                "event_id": "event_semantic_precedence_action_open",
                "occurred_at": "not-a-time",
                "binding": binding,
                "continuation_id": "continuation_semantic_precedence_action",
                "status": "unknown",
                "summary": "The duplicate event ID must win over the invalid time.",
                "evidence_ids": [],
            ]))
        }
        semanticExpectCode("runtime_event_id_duplicate") {
            _ = try app.execute(command: semanticData([
                "type": "close_boundary",
                "event_id": "event_semantic_precedence_action_open",
                "occurred_at": "not-a-time",
                "binding": binding,
                "close_reason": "manual_close",
            ]))
        }
    }

    do {
        let suffix = "precedence_pause"
        let binding = semanticBinding(suffix: suffix)
        let packet = try semanticPacket(binding: binding, validAfter: 2, suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticSeal(packet: packet, suffix: suffix))
        let before = try journal.load()
        let state = try CoordinatorSemanticReplay.replay(before)
        let pause = try CoordinatorSemanticDecision.decide(
            state: state,
            command: semanticSelection(packet: packet, slot: 3, suffix: suffix)
        )
        let prefix = JournalSnapshot(
            events: before.events + [try #require(pause.events.first)],
            documents: before.documents,
            verificationRecords: before.verificationRecords,
            journalSequence: before.journalSequence + 1
        )
        let pauseSelected = try CoordinatorSemanticReplay.replay(prefix)
        semanticExpectCode("pause_selection_close_reason_invalid") {
            _ = try CoordinatorSemanticDecision.decide(
                state: pauseSelected,
                command: semanticData([
                    "type": "close_boundary",
                    "event_id": "event_semantic_precedence_pause_manual_close",
                    "occurred_at": "not-a-time",
                    "binding": binding,
                    "close_reason": "BAD",
                ])
            )
        }
    }

    do {
        let suffix = "precedence_repair"
        let binding = semanticBinding(suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        var repair: [String: Any] = [
            "type": "reserve_format_repair",
            "event_id": "event_semantic_precedence_repair_reserve",
            "occurred_at": "not-a-time",
            "binding": binding,
            "continuation_id": "continuation_semantic_precedence_repair",
            "repair_request_id": "repair_request_semantic_precedence_repair",
            "parent_prompt_id": "prompt_wrong",
            "issued_at": "2026-08-21T01:00:01Z",
            "expires_at": "2026-08-21T01:02:01Z",
        ]
        semanticExpectCode("format_repair_time_invalid") {
            _ = try app.execute(command: semanticData(repair))
        }
        repair["occurred_at"] = "2026-08-21T01:00:01Z"
        semanticExpectCode("format_repair_parent_prompt_mismatch") {
            _ = try app.execute(command: semanticData(repair))
        }
    }

    do {
        let suffix = "precedence_open"
        let binding = semanticBinding(suffix: suffix)
        let journal = SemanticMemoryJournal()
        let app = CoordinatorSemanticApplication(journal: journal)
        _ = try app.execute(command: semanticOpen(binding: binding, suffix: suffix))
        _ = try app.execute(command: semanticData([
            "type": "close_boundary",
            "event_id": "event_semantic_precedence_open_close",
            "occurred_at": "2026-08-21T01:00:01Z",
            "binding": binding,
            "close_reason": "manual_close",
        ]))
        var next = binding
        next["decision_boundary_id"] = "boundary_semantic_precedence_open_2"
        next["boundary_sequence"] = 2
        var duplicateOpen: [String: Any] = [
            "type": "open_boundary",
            "event_id": "event_semantic_precedence_open_open",
            "occurred_at": "not-a-time",
            "binding": next,
            "proposal_id": "proposal_cafe\u{301}",
        ]
        semanticExpectCode("proposal_id_invalid") {
            _ = try app.execute(command: semanticData(duplicateOpen))
        }
        duplicateOpen["proposal_id"] = "proposal_semantic_precedence_open_2"
        semanticExpectCode("runtime_event_id_duplicate") {
            _ = try app.execute(command: semanticData(duplicateOpen))
        }
    }
}
