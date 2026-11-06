import Foundation
import Testing
@testable import CoordinatorSwift

private let ingressTimestampBase = "2026-08-21T01:00:00Z"

private let ingressTimestampInvalidValues = [
    "2026-08-21T01:00:00Z\n",
    "2026-08-21T01:00:00Z\r",
    "2026-08-21T01:00:00Z\r\n",
    "2026-08-21T01:00:00Z\u{0085}",
    "2026-08-21T01:00:00Z\u{2028}",
    "2026-08-21T01:00:00Z\u{2029}",
    "2026-08-21T01:00:00Zextra",
    "2026-08-21T01:00:00Z\0",
    "2026-08-21T01:00:00+09:00\n",
    "2026-08-21T01:00:00.123456789-23:59\r\n",
    " 2026-08-21T01:00:00Z",
    "2026-08-21T01:00:00Z ",
    "1900-02-29T00:00:00Z",
    "2026-02-29T01:00:00Z",
    "2026-04-31T01:00:00Z",
    "2026-00-21T01:00:00Z",
    "2026-13-21T01:00:00Z",
    "2026-08-00T01:00:00Z",
    "2026-08-32T01:00:00Z",
    "2026-08-21T24:00:00Z",
    "2026-08-21T01:60:00Z",
    "2026-08-21T01:00:60Z",
    "2026-08-21T01:00:00+24:00",
    "2026-08-21T01:00:00-00:60",
    "2026-08-21T01:00:00+0900",
    "2026-08-21T01:00:00+09",
    "2026-08-21T01:00:00",
    "2026-08-21t01:00:00z",
    "2026-08-21T01:00:00.Z",
    "2026-08-21T01:00:00.1234567890Z",
    "2026-08-21T01:00:00.１２３Z",
]

private func ingressTimestampData(_ object: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
}

private func ingressTimestampFixture(_ name: String) throws -> [String: Any] {
    let root = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let data = try Data(contentsOf: root.appendingPathComponent("Fixtures/v1/contracts/valid/\(name).json"))
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func ingressTimestampEvent(
    _ timestamp: String = ingressTimestampBase,
    sequence: Int = 1,
    type: String = "decision_boundary_opened",
    category: String = "decision_lifecycle",
    payload: [String: Any] = ["proposal_id": "proposal_ingress_timestamp"]
) -> [String: Any] {
    [
        "schema_version": "1.0",
        "kind": "blabee_runtime_event",
        "event_id": "event_ingress_timestamp_\(sequence)",
        "event_sequence": sequence,
        "event_type": type,
        "event_category": category,
        "occurred_at": timestamp,
        "project_id": "project_ingress_timestamp",
        "session_id": "session_ingress_timestamp",
        "source_turn_id": "turn_ingress_timestamp",
        "source_prompt_id": "prompt_ingress_timestamp",
        "episode_id": "episode_ingress_timestamp",
        "episode_root_prompt_id": "prompt_ingress_timestamp",
        "episode_baseline_checkpoint_id": "checkpoint_ingress_timestamp",
        "decision_boundary_id": "boundary_ingress_timestamp",
        "boundary_sequence": 1,
        "payload": payload,
    ]
}

private func ingressTimestampReplacing(
    _ object: [String: Any],
    path: [String],
    value: Any
) throws -> [String: Any] {
    let key = try #require(path.first)
    var result = object
    if path.count == 1 {
        result[key] = value
    } else {
        let child = try #require(object[key] as? [String: Any])
        result[key] = try ingressTimestampReplacing(child, path: Array(path.dropFirst()), value: value)
    }
    return result
}

private func expectIngressTimestampCode(
    _ expected: String,
    context: String,
    _ operation: () throws -> Void
) {
    do {
        try operation()
        Issue.record("expected \(expected): \(context)")
    } catch let error as CoordinatorError {
        #expect(error.code == expected, "\(context)")
    } catch {
        Issue.record("unexpected error \(error): \(context)")
    }
}

@Test("ingress and semantic replay reject malformed timestamps with their existing error codes")
func ingressTimestampRejectsMalformedInstants() throws {
    let validator = V1IngressValidator()
    for value in ingressTimestampInvalidValues {
        let data = try ingressTimestampData(ingressTimestampEvent(value))
        let parsed = try StrictJSON.object(from: data, limits: validator.limits)
        expectIngressTimestampCode("contract_validation_failed", context: value.debugDescription) {
            _ = try validator.validate(data, as: .runtimeEvent)
        }
        expectIngressTimestampCode("contract_validation_failed", context: value.debugDescription) {
            _ = try validator.validatedObject(parsed, as: .runtimeEvent)
        }
        expectIngressTimestampCode("timestamp_invalid", context: value.debugDescription) {
            _ = try RFC3339Instant(value)
        }
        expectIngressTimestampCode("runtime_event_time_invalid", context: value.debugDescription) {
            _ = try CoordinatorSemanticReplay.replay(events: [data])
        }
    }
}

@Test("ingress preserves valid fractional seconds, calendar edges, and timezone offsets for replay")
func ingressTimestampAcceptsSemanticInstants() throws {
    let validator = V1IngressValidator()
    let values = [
        ingressTimestampBase,
        "2026-08-21T01:00:00.1Z",
        "2026-08-21T01:00:00.000000001Z",
        "2026-08-21T10:00:00.123456789+09:00",
        "2026-08-20T18:00:00.123456789-07:00",
        "2026-08-21T01:00:00+00:00",
        "2026-08-21T01:00:00-00:00",
        "2000-02-29T23:59:59.9-23:59",
        "0000-02-29T00:00:00+23:59",
        "9999-12-31T23:59:59.999999999Z",
    ]
    for value in values {
        let instant = try RFC3339Instant(value)
        let data = try ingressTimestampData(ingressTimestampEvent(value))
        guard case let .runtimeEvent(dto) = try validator.validate(data, as: .runtimeEvent) else {
            Issue.record("expected runtime event DTO")
            continue
        }
        let canonical = try StrictJSONTransport.object(from: dto.canonicalJSON)
        #expect(canonical["occurred_at"] as? String == instant.rawValue)
        let state = try CoordinatorSemanticReplay.replay(events: [dto.canonicalJSON])
        #expect(state.eventSequence == 1)
        #expect(state.boundaries.count == 1)
    }
}

@Test("every timestamp-bearing v1 document and runtime payload uses the strict ingress parser")
func ingressTimestampValidatesEveryField() throws {
    let packet = try ingressTimestampFixture("decision-packet-rollback-disabled")
    let pet = try ingressTimestampFixture("continuation-pet-action")
    let repair = try ingressTimestampFixture("continuation-format-repair")
    let reserved = try ingressTimestampFixture("runtime-format-repair-reserved")
    let claimed = try ingressTimestampFixture("runtime-format-repair-claimed")
    let sealed = ingressTimestampEvent(type: "decision_packet_sealed", payload: [
        "interaction_id": "interaction_ingress_timestamp",
        "packet_id": "packet_ingress_timestamp",
        "revision": 1,
        "expires_at": ingressTimestampBase,
    ])
    let dispatchKeys: Set<String> = [
        "continuation_id", "interaction_id", "packet_id", "revision", "option_id", "action_id",
        "dispatch_mode", "issued_at", "expires_at", "in_flight_deadline_at",
    ]
    let dispatched = ingressTimestampEvent(
        type: "continuation_dispatched",
        category: "transport",
        payload: pet.filter { dispatchKeys.contains($0.key) }
    )
    let cases: [(V1Contract, [String: Any], [String])] = [
        (.runtimeEvent, ingressTimestampEvent(), ["occurred_at"]),
        (.decisionPacket, packet, ["sealed_at", "expires_at"]),
        (.continuationEnvelope, pet, ["issued_at", "expires_at", "in_flight_deadline_at"]),
        (.continuationEnvelope, repair, ["issued_at", "expires_at"]),
        (.runtimeEvent, sealed, ["payload.expires_at"]),
        (.runtimeEvent, reserved, ["payload.issued_at", "payload.expires_at"]),
        (.runtimeEvent, claimed, ["payload.issued_at", "payload.expires_at"]),
        (.runtimeEvent, dispatched, ["payload.issued_at", "payload.expires_at", "payload.in_flight_deadline_at"]),
    ]
    let validator = V1IngressValidator()
    for (contract, object, fields) in cases {
        _ = try validator.validate(try ingressTimestampData(object), as: contract)
        for field in fields {
            for invalid in [ingressTimestampBase + "\n", "2026-02-30T01:00:00Z"] {
                let changed = try ingressTimestampReplacing(
                    object,
                    path: field.components(separatedBy: "."),
                    value: invalid
                )
                expectIngressTimestampCode("contract_validation_failed", context: "\(contract).\(field)") {
                    _ = try validator.validate(try ingressTimestampData(changed), as: contract)
                }
            }
        }
    }
}

@Test("pattern-constrained codes, tokens, and fingerprints must consume the whole string")
func ingressTimestampFullPatternMatches() throws {
    let envelope = try ingressTimestampFixture("continuation-pet-action")
    let repair = try ingressTimestampFixture("runtime-format-repair-reserved")
    let packet = try ingressTimestampFixture("decision-packet-rollback-disabled")
    let closed = ingressTimestampEvent(type: "decision_boundary_closed", payload: ["close_reason": "completed"])
    let cases: [(V1Contract, [String: Any], [String], String)] = [
        (.runtimeEvent, closed, ["payload", "close_reason"], "completed"),
        (.continuationEnvelope, envelope, ["continuation_token"], "fixture_continuation_token_pet_0001"),
        (.runtimeEvent, repair, ["payload", "correlation_token_fingerprint"], "sha256:" + String(repeating: "a", count: 64)),
    ]
    let validator = V1IngressValidator()
    for (contract, object, path, valid) in cases {
        _ = try validator.validate(try ingressTimestampData(object), as: contract)
        for suffix in ["\n", "\r", "\r\n", "\u{0085}", "\u{2028}", "\u{2029}", "#"] {
            let changed = try ingressTimestampReplacing(object, path: path, value: valid + suffix)
            expectIngressTimestampCode("contract_validation_failed", context: path.joined(separator: ".")) {
                _ = try validator.validate(try ingressTimestampData(changed), as: contract)
            }
        }
    }
    let invalidReason = try ingressTimestampReplacing(packet, path: ["risk", "reasons"], value: ["fixture_only\n"])
    expectIngressTimestampCode("contract_validation_failed", context: "risk.reasons") {
        _ = try validator.validate(try ingressTimestampData(invalidReason), as: .decisionPacket)
    }
    let multilineSummary = try ingressTimestampReplacing(packet, path: ["summary"], value: "first line\nsecond line\n")
    _ = try validator.validate(try ingressTimestampData(multilineSummary), as: .decisionPacket)
}

private final class IngressTimestampFreshnessStore: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "test-ingress-timestamp-\(UUID().uuidString)"
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?

    func load() throws -> FreshnessStoredRecord? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard stored == nil else { throw CoordinatorError("freshness_anchor_conflict") }
        guard record.storageSlot == storageSlot else { throw CoordinatorError("freshness_anchor_corrupt") }
        let result = try FreshnessStoredRecord(record: record, revision: record.revision)
        stored = result
        return result
    }

    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard stored?.revision == expectedRevision else { throw CoordinatorError("freshness_anchor_conflict") }
        guard replacement.storageSlot == storageSlot else { throw CoordinatorError("freshness_anchor_corrupt") }
        let result = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
        stored = result
        return result
    }
}

@Test("low-level append rejects invalid timestamp batches before journal or freshness state changes")
func ingressTimestampAppendCannotPoisonJournal() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-ingress-timestamp-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    defer { try? FileManager.default.removeItem(at: directory) }
    let freshness = IngressTimestampFreshnessStore()
    let journal = try SQLiteJournal(
        databaseURL: directory.appendingPathComponent("journal.sqlite"),
        keyURL: directory.appendingPathComponent("journal.key"),
        freshnessStore: freshness
    )
    let initialSnapshot = try journal.load()
    let initialAnchor = try #require(try freshness.load())
    let valid = try ingressTimestampData(ingressTimestampEvent())
    for invalid in ingressTimestampInvalidValues {
        let malformed = try ingressTimestampData(ingressTimestampEvent(
            invalid,
            sequence: 2,
            type: "decision_boundary_closed",
            payload: ["close_reason": "completed"]
        ))
        expectIngressTimestampCode("contract_validation_failed", context: invalid.debugDescription) {
            _ = try journal.append(expectedSequence: 0, events: [valid, malformed])
        }
        let snapshot = try journal.load()
        let anchor = try #require(try freshness.load())
        #expect(snapshot == initialSnapshot)
        #expect(anchor == initialAnchor)
    }
    let result = try journal.append(expectedSequence: 0, events: [valid])
    #expect(result.eventCount == 1)
    let snapshot = try journal.load()
    #expect(snapshot.journalSequence == 1)
    let state = try CoordinatorSemanticReplay.replay(snapshot)
    #expect(state.eventSequence == 1)
    #expect(state.boundaries.count == 1)
}
