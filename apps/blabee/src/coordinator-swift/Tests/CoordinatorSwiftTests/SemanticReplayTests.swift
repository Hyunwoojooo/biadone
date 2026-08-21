import Foundation
import XCTest
@testable import CoordinatorSwift

final class SemanticReplayTests: XCTestCase {
    func testEveryCommittedPrefixReplaysAndProjectsTerminalAction() throws {
        let binding = binding()
        let packet = packet(binding: binding)
        let fingerprint = "sha256:\(String(repeating: "a", count: 64))"
        let events = [
            event(1, "decision_boundary_opened", "2026-08-21T01:00:00Z", binding, [
                "proposal_id": "proposal_001",
            ]),
            event(2, "decision_packet_sealed", "2026-08-21T01:00:01Z", binding, [
                "interaction_id": "interaction_001",
                "packet_id": "packet_001",
                "revision": 1,
                "expires_at": "2026-08-21T01:02:01Z",
            ]),
            event(3, "decision_selection_claimed", "2026-08-21T01:00:02Z", binding, [
                "selection_id": "selection_001",
                "interaction_id": "interaction_001",
                "packet_id": "packet_001",
                "revision": 1,
                "option_id": "option_1",
            ]),
            event(4, "continuation_dispatched", "2026-08-21T01:00:03Z", binding, [
                "continuation_id": "continuation_001",
                "interaction_id": "interaction_001",
                "packet_id": "packet_001",
                "revision": 1,
                "option_id": "option_1",
                "action_id": "action_1",
                "dispatch_mode": "same_turn_stop",
                "issued_at": "2026-08-21T01:00:03Z",
                "expires_at": "2026-08-21T01:02:03Z",
                "in_flight_deadline_at": "2026-08-21T01:05:03Z",
            ]),
            event(5, "continuation_consumed", "2026-08-21T01:00:04Z", binding, [
                "continuation_id": "continuation_001",
                "dispatch_mode": "same_turn_stop",
            ]),
            event(6, "continuation_transport_completed", "2026-08-21T01:00:05Z", binding, [
                "continuation_id": "continuation_001",
                "transport_status": "completed",
                "work_outcome_status": "not_recorded",
            ]),
            event(7, "work_outcome_recorded", "2026-08-21T01:00:06Z", binding, [
                "continuation_id": "continuation_001",
                "action_id": "action_1",
                "work_outcome_status": "succeeded",
                "summary": "Fictional work completed.",
                "evidence_ids": ["evidence_001"],
            ]),
            event(8, "decision_boundary_closed", "2026-08-21T01:00:07Z", binding, [
                "close_reason": "work_completed",
            ]),
        ].map(data)
        let packetData = data(packet)
        let verification = data(verificationRecord(binding: binding, fingerprint: fingerprint))

        for count in 1...events.count {
            let state = try CoordinatorSemanticReplay.replay(
                events: Array(events.prefix(count)),
                documents: count >= 2 ? [packetData] : [],
                verificationRecords: count >= 4 ? [verification] : []
            )
            XCTAssertEqual(state.eventSequence, Int64(count))
        }

        let state = try CoordinatorSemanticReplay.replay(
            events: events,
            documents: [packetData],
            verificationRecords: [verification]
        )
        let typedBinding = try CoordinatorBinding(jsonObject: binding)
        XCTAssertEqual(state.packet(for: typedBinding)?.packetID, "packet_001")
        XCTAssertEqual(state.boundary(for: typedBinding)?.closeReason, "work_completed")
        XCTAssertEqual(state.continuation(id: "continuation_001")?.transport?.status, .completed)
        XCTAssertEqual(state.continuation(id: "continuation_001")?.workOutcome?.status, "succeeded")
        XCTAssertTrue(state.usedVerificationRecords.contains("continuation_001"))
    }

    func testBoundaryIdentityMismatchAndNoncontiguousSequenceFailClosed() throws {
        let original = binding()
        let opened = data(event(1, "decision_boundary_opened", "2026-08-21T01:00:00Z", original, [
            "proposal_id": "proposal_001",
        ]))
        var mismatched = original
        mismatched["session_id"] = "session_other"
        let close = data(event(2, "decision_boundary_closed", "2026-08-21T01:00:01Z", mismatched, [
            "close_reason": "checkpoint_complete",
        ]))

        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(events: [opened, close])) {
            XCTAssertEqual($0.coordinatorError.code, "decision_boundary_binding_mismatch")
        }

        let skipped = data(event(3, "decision_boundary_closed", "2026-08-21T01:00:01Z", original, [
            "close_reason": "checkpoint_complete",
        ]))
        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(events: [opened, skipped])) {
            XCTAssertEqual($0.coordinatorError.code, "event_sequence_not_contiguous")
        }
    }

    func testOrphanSidecarsAndRawTokensAreRejected() throws {
        let binding = binding()
        XCTAssertThrowsError(
            try CoordinatorSemanticReplay.replay(events: [], documents: [data(packet(binding: binding))])
        ) {
            XCTAssertEqual($0.coordinatorError.code, "packet_document_orphaned")
        }

        XCTAssertThrowsError(
            try CoordinatorSemanticReplay.replay(
                events: [],
                verificationRecords: [data(verificationRecord(
                    binding: binding,
                    fingerprint: "sha256:\(String(repeating: "b", count: 64))"
                ))]
            )
        ) {
            XCTAssertEqual($0.coordinatorError.code, "verification_record_orphaned")
        }

        var rawPacket = packet(binding: binding)
        rawPacket["evidence"] = [["nested": [["continuation_token": "must_not_persist"]]]]
        XCTAssertThrowsError(try CoordinatorPacketDocument.parse(data(rawPacket))) {
            XCTAssertEqual($0.coordinatorError.code, "raw_continuation_token_forbidden")
        }
    }

    func testRepairReservationSurvivesReplayAndMustMatchClaimExactly() throws {
        let binding = binding()
        let open = data(event(1, "decision_boundary_opened", "2026-08-21T01:00:00Z", binding, [
            "proposal_id": "proposal_001",
        ]))
        let repairPayload: [String: Any] = [
            "continuation_origin": "internal_format_repair",
            "continuation_id": "repair_continuation_001",
            "repair_request_id": "repair_request_001",
            "parent_prompt_id": "prompt_001",
            "repair_kind": "decision_proposal_schema",
            "repair_attempt": 1,
            "max_repair_attempts": 1,
            "dispatch_mode": "submitted_envelope",
            "issued_at": "2026-08-21T01:00:01Z",
            "expires_at": "2026-08-21T01:02:01Z",
            "correlation_token_fingerprint": "sha256:\(String(repeating: "c", count: 64))",
        ]
        let reserve = data(event(2, "internal_format_repair_reserved", "2026-08-21T01:00:01Z", binding, repairPayload))
        let claim = data(event(3, "internal_format_repair_claimed", "2026-08-21T01:00:02Z", binding, repairPayload))
        let state = try CoordinatorSemanticReplay.replay(events: [open, reserve, claim])
        let typedBinding = try CoordinatorBinding(jsonObject: binding)
        XCTAssertEqual(state.boundary(for: typedBinding)?.repair?.claimedAt?.rawValue, "2026-08-21T01:00:02Z")

        var mismatch = repairPayload
        mismatch["repair_request_id"] = "repair_request_other"
        let invalidClaim = data(event(3, "internal_format_repair_claimed", "2026-08-21T01:00:02Z", binding, mismatch))
        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(events: [open, reserve, invalidClaim])) {
            XCTAssertEqual($0.coordinatorError.code, "format_repair_reservation_mismatch")
        }
    }

    func testPauseSelectionRequiresAtomicEpisodePausedClose() throws {
        let binding = binding()
        let packetData = data(packet(binding: binding))
        let events = [
            event(1, "decision_boundary_opened", "2026-08-21T01:00:00Z", binding, [
                "proposal_id": "proposal_001",
            ]),
            event(2, "decision_packet_sealed", "2026-08-21T01:00:01Z", binding, [
                "interaction_id": "interaction_001",
                "packet_id": "packet_001",
                "revision": 1,
                "expires_at": "2026-08-21T01:02:01Z",
            ]),
            event(3, "decision_selection_claimed", "2026-08-21T01:00:02Z", binding, [
                "selection_id": "selection_pause",
                "interaction_id": "interaction_001",
                "packet_id": "packet_001",
                "revision": 1,
                "option_id": "option_3",
            ]),
            event(4, "decision_boundary_closed", "2026-08-21T01:00:02Z", binding, [
                "close_reason": "episode_paused",
            ]),
        ].map(data)
        let state = try CoordinatorSemanticReplay.replay(events: events, documents: [packetData])
        XCTAssertEqual(state.boundaries.values.first?.selection?.slot, 3)
        XCTAssertEqual(state.boundaries.values.first?.closeReason, "episode_paused")

        var wrongClose = event(4, "decision_boundary_closed", "2026-08-21T01:00:02Z", binding, [
            "close_reason": "checkpoint_complete",
        ])
        wrongClose["event_id"] = "event_wrong_close"
        XCTAssertThrowsError(
            try CoordinatorSemanticReplay.replay(
                events: Array(events.prefix(3)) + [data(wrongClose)],
                documents: [packetData]
            )
        ) {
            XCTAssertEqual($0.coordinatorError.code, "pause_selection_close_reason_invalid")
        }
    }

    private func binding() -> [String: Any] {
        [
            "project_id": "project_001",
            "session_id": "session_001",
            "source_turn_id": "turn_001",
            "source_prompt_id": "prompt_001",
            "episode_id": "episode_001",
            "episode_root_prompt_id": "prompt_001",
            "episode_baseline_checkpoint_id": "checkpoint_001",
            "decision_boundary_id": "boundary_001",
            "boundary_sequence": 1,
        ]
    }

    private func event(
        _ sequence: Int,
        _ type: String,
        _ occurredAt: String,
        _ binding: [String: Any],
        _ payload: [String: Any]
    ) -> [String: Any] {
        var value = binding
        value.merge([
            "schema_version": "1.0",
            "kind": "blabee_runtime_event",
            "event_id": "event_\(sequence)",
            "event_sequence": sequence,
            "event_type": type,
            "event_category": eventCategory(type),
            "occurred_at": occurredAt,
            "payload": payload,
        ]) { _, new in new }
        return value
    }

    private func eventCategory(_ type: String) -> String {
        switch type {
        case "continuation_dispatched", "continuation_consumed",
             "continuation_transport_completed", "continuation_transport_timed_out_unknown",
             "internal_format_repair_reserved", "internal_format_repair_claimed":
            return "transport"
        case "work_outcome_recorded":
            return "work_outcome"
        default:
            return "decision_lifecycle"
        }
    }

    private func packet(binding: [String: Any]) -> [String: Any] {
        var value = binding
        value.merge([
            "schema_version": "1.0",
            "kind": "blabee_decision_packet",
            "interaction_id": "interaction_001",
            "packet_id": "packet_001",
            "revision": 1,
            "valid_after_event_sequence": 2,
            "sealed_at": "2026-08-21T01:00:01Z",
            "expires_at": "2026-08-21T01:02:01Z",
            "summary": "Fictional decision.",
            "evidence": [],
            "risk": ["level": "low", "reasons": []],
            "checkpoint": ["id": "checkpoint_001", "coverage": "complete"],
            "choices": [
                [
                    "slot": 1, "kind": "recommended_action", "enabled": true,
                    "disabled_reason": NSNull(), "option_id": "option_1", "action_id": "action_1",
                    "action": action("Recommended"),
                ],
                [
                    "slot": 2, "kind": "alternative_action", "enabled": false,
                    "disabled_reason": "not_available", "option_id": "option_2", "action_id": NSNull(),
                ],
                [
                    "slot": 3, "kind": "pause", "enabled": true,
                    "disabled_reason": NSNull(), "option_id": "option_3", "action_id": "action_3",
                ],
                [
                    "slot": 4, "kind": "rollback", "enabled": false,
                    "disabled_reason": "rollback_unavailable", "option_id": "option_4", "action_id": NSNull(),
                ],
            ],
        ]) { _, new in new }
        return value
    }

    private func action(_ title: String) -> [String: Any] {
        [
            "title": title,
            "objective": "Perform a fictional action.",
            "constraints": [],
            "done_when": ["Fictional evidence exists."],
        ]
    }

    private func verificationRecord(binding: [String: Any], fingerprint: String) -> [String: Any] {
        var value = binding
        value.merge([
            "schema_version": "1.0",
            "kind": "blabee_continuation_verification_record",
            "dispatch_event_id": "event_4",
            "continuation_id": "continuation_001",
            "interaction_id": "interaction_001",
            "packet_id": "packet_001",
            "revision": 1,
            "option_id": "option_1",
            "action_id": "action_1",
            "correlation_token_fingerprint": fingerprint,
        ]) { _, new in new }
        return value
    }

    private func data(_ object: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }
}
