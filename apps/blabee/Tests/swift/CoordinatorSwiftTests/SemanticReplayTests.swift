import Foundation
import XCTest
@testable import CoordinatorSwift

private struct PendingSlotWorkCounts {
    var lookups = 0
    var fullEvents: [Int] = []
    var incrementalEvents: [Int] = []
    var fullNanoseconds: [UInt64] = []
}

private final class PendingSlotWorkMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var counts = PendingSlotWorkCounts()

    func observe(_ work: CoordinatorSemanticReplayWork) {
        lock.lock()
        defer { lock.unlock() }
        switch work {
        case .sessionPendingSlotLookup: counts.lookups += 1
        case let .fullReplay(eventCount): counts.fullEvents.append(eventCount)
        case let .incrementalApplication(eventCount): counts.incrementalEvents.append(eventCount)
        case let .fullReplayFinished(elapsedNanoseconds): counts.fullNanoseconds.append(elapsedNanoseconds)
        case .incrementalApplicationFinished: break
        }
    }

    func snapshot() -> PendingSlotWorkCounts {
        lock.lock()
        defer { lock.unlock() }
        return counts
    }
}

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

        var incremental = CoordinatorSemanticState()
        for count in 1...events.count {
            let state = try CoordinatorSemanticReplay.replay(
                events: Array(events.prefix(count)),
                documents: count >= 2 ? [packetData] : [],
                verificationRecords: count >= 4 ? [verification] : []
            )
            XCTAssertEqual(state.eventSequence, Int64(count))
            incremental = try CoordinatorSemanticReplay.applying(
                CoordinatorSemanticChange(
                    events: [events[count - 1]],
                    documents: count == 2 ? [packetData] : [],
                    verificationRecords: count == 4 ? [verification] : []
                ), to: incremental
            )
            XCTAssertEqual(incremental, state)
        }

        let activation = CoordinatorSemanticChange(
            events: Array(events.prefix(2)), documents: [packetData]
        )
        XCTAssertEqual(
            try CoordinatorSemanticReplay.applying(activation, to: CoordinatorSemanticState()),
            try CoordinatorSemanticReplay.replay(events: activation.events, documents: activation.documents)
        )

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
        XCTAssertEqual(incremental, state)
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [], documents: [packetData]), to: state
        )) { XCTAssertEqual($0.coordinatorError.code, "packet_document_duplicate") }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [], verificationRecords: [verification]), to: state
        )) { XCTAssertEqual($0.coordinatorError.code, "verification_record_duplicate") }
        var colliding = verificationRecord(binding: binding, fingerprint: fingerprint)
        colliding["continuation_id"] = "continuation_other"
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [], verificationRecords: [data(colliding)]), to: state
        )) { XCTAssertEqual($0.coordinatorError.code, "token_fingerprint_duplicate") }
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
        let prefix = try CoordinatorSemanticReplay.replay(events: [opened])
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [close]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "decision_boundary_binding_mismatch") }

        let skipped = data(event(3, "decision_boundary_closed", "2026-08-21T01:00:01Z", original, [
            "close_reason": "checkpoint_complete",
        ]))
        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(events: [opened, skipped])) {
            XCTAssertEqual($0.coordinatorError.code, "event_sequence_not_contiguous")
        }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [skipped]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "event_sequence_not_contiguous") }
        var duplicateID = event(2, "decision_boundary_closed", "2026-08-21T01:00:01Z", original, [
            "close_reason": "checkpoint_complete",
        ])
        duplicateID["event_id"] = "event_1"
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [data(duplicateID)]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "runtime_event_id_duplicate") }
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

        let prefix = try CoordinatorSemanticReplay.replay(events: [data(event(
            1, "decision_boundary_opened", "2026-08-21T01:00:00Z", binding,
            ["proposal_id": "proposal_001"]
        ))])
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [], documents: [data(packet(binding: binding))]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "packet_document_orphaned") }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [], verificationRecords: [data(verificationRecord(
                binding: binding, fingerprint: "sha256:\(String(repeating: "b", count: 64))"
            ))]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "verification_record_orphaned") }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [], documents: [data(rawPacket)]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "raw_continuation_token_forbidden") }
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
        let reserved = try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [reserve]),
            to: CoordinatorSemanticReplay.replay(events: [open])
        )
        XCTAssertEqual(
            try CoordinatorSemanticReplay.applying(CoordinatorSemanticChange(events: [claim]), to: reserved),
            state
        )
        let typedBinding = try CoordinatorBinding(jsonObject: binding)
        XCTAssertEqual(state.boundary(for: typedBinding)?.repair?.claimedAt?.rawValue, "2026-08-21T01:00:02Z")

        var mismatch = repairPayload
        mismatch["repair_request_id"] = "repair_request_other"
        let invalidClaim = data(event(3, "internal_format_repair_claimed", "2026-08-21T01:00:02Z", binding, mismatch))
        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(events: [open, reserve, invalidClaim])) {
            XCTAssertEqual($0.coordinatorError.code, "format_repair_reservation_mismatch")
        }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [invalidClaim]), to: reserved
        )) { XCTAssertEqual($0.coordinatorError.code, "format_repair_reservation_mismatch") }
        // Full replay preloads verification fingerprints before replaying old
        // repair reservations. Suffix application must reject the same cross-
        // origin collision against the already populated prefix registry.
        let collision = data(verificationRecord(
            binding: binding, fingerprint: "sha256:\(String(repeating: "c", count: 64))"
        ))
        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(
            events: [open, reserve, claim], verificationRecords: [collision]
        )) { XCTAssertEqual($0.coordinatorError.code, "token_fingerprint_duplicate") }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [], verificationRecords: [collision]), to: state
        )) { XCTAssertEqual($0.coordinatorError.code, "token_fingerprint_duplicate") }
    }

    func testIncrementalResealMatchesFullReplayAndRetainsRevisionAndSidecarChecks() throws {
        let binding = binding()
        let packetData = data(packet(binding: binding))
        let prefixEvents = [
            data(event(1, "decision_boundary_opened", "2026-08-21T01:00:00Z", binding, [
                "proposal_id": "proposal_001",
            ])),
            data(event(2, "decision_packet_sealed", "2026-08-21T01:00:01Z", binding, [
                "interaction_id": "interaction_001", "packet_id": "packet_001", "revision": 1,
                "expires_at": "2026-08-21T01:02:01Z",
            ])),
        ]
        let prefix = try CoordinatorSemanticReplay.replay(events: prefixEvents, documents: [packetData])
        var nextPacket = packet(binding: binding)
        nextPacket["revision"] = 2
        nextPacket["valid_after_event_sequence"] = 3
        nextPacket["sealed_at"] = "2026-08-21T01:00:02Z"
        nextPacket["expires_at"] = "2026-08-21T01:02:02Z"
        let payload: [String: Any] = [
            "interaction_id": "interaction_001", "packet_id": "packet_001", "revision": 2,
            "expires_at": "2026-08-21T01:02:02Z",
        ]
        let reseal = data(event(3, "decision_packet_sealed", "2026-08-21T01:00:02Z", binding, payload))
        let change = CoordinatorSemanticChange(events: [reseal], documents: [data(nextPacket)])
        let incremental = try CoordinatorSemanticReplay.applying(change, to: prefix)
        XCTAssertEqual(incremental, try CoordinatorSemanticReplay.replay(
            events: prefixEvents + change.events, documents: [packetData] + change.documents
        ))
        let typedBinding = try CoordinatorBinding(jsonObject: binding)
        XCTAssertEqual(incremental.packet(for: typedBinding)?.revision, 2)

        var skippedPacket = nextPacket
        skippedPacket["revision"] = 3
        var skippedPayload = payload
        skippedPayload["revision"] = 3
        let skipped = CoordinatorSemanticChange(
            events: [data(event(3, "decision_packet_sealed", "2026-08-21T01:00:02Z", binding, skippedPayload))],
            documents: [data(skippedPacket)]
        )
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(skipped, to: prefix)) {
            XCTAssertEqual($0.coordinatorError.code, "decision_packet_revision_not_contiguous")
        }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(
            events: prefixEvents + skipped.events, documents: [packetData] + skipped.documents
        )) { XCTAssertEqual($0.coordinatorError.code, "decision_packet_revision_not_contiguous") }

        var wrongSession = nextPacket
        wrongSession["session_id"] = "session_other"
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [reseal], documents: [data(wrongSession)]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "packet_document_binding_mismatch") }
        XCTAssertEqual(prefix.eventSequence, 2)
        XCTAssertEqual(prefix.packetDocuments.count, 1)
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

    func testClosedClaimedQueuedOutcomeReplaysWithoutReopeningBoundary() throws {
        let snapshot = try closedQueuedOutcomePrefix()
        let prefix = try CoordinatorSemanticReplay.replay(snapshot)
        let outcome = data(event(9, "work_outcome_recorded", "2026-08-21T01:10:00Z", binding(), outcomePayload()))
        let change = CoordinatorSemanticChange(events: [outcome])
        let incremental = try CoordinatorSemanticReplay.applying(change, to: prefix)
        let full = try CoordinatorSemanticReplay.replay(
            events: snapshot.events + [outcome], documents: snapshot.documents,
            verificationRecords: snapshot.verificationRecords
        )
        XCTAssertEqual(incremental, full)
        XCTAssertEqual(full.boundaries, prefix.boundaries)
        XCTAssertTrue(try XCTUnwrap(full.boundaries.values.first).closed)
        XCTAssertEqual(full.continuation(id: "continuation_001")?.workOutcome?.status, "succeeded")
        XCTAssertEqual(full.continuation(id: "continuation_001")?.queuedActionContextClaim,
                       prefix.continuation(id: "continuation_001")?.queuedActionContextClaim)
        XCTAssertEqual(full.continuation(id: "continuation_001")?.transport?.status, .completed)

        let duplicate = data(event(10, "work_outcome_recorded", "2026-08-21T01:10:01Z", binding(), outcomePayload()))
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [duplicate]), to: full
        )) { XCTAssertEqual($0.coordinatorError.code, "work_outcome_already_recorded") }
        XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(
            events: snapshot.events + [outcome, duplicate], documents: snapshot.documents,
            verificationRecords: snapshot.verificationRecords
        )) { XCTAssertEqual($0.coordinatorError.code, "work_outcome_already_recorded") }
        XCTAssertEqual(full.eventSequence, 9)
    }

    func testClosedQueuedOutcomeReplayRetainsExactOriginalBindingAndAction() throws {
        let snapshot = try closedQueuedOutcomePrefix()
        let prefix = try CoordinatorSemanticReplay.replay(snapshot)
        for kind in ["action", "continuation", "session", "source_turn", "project", "before_claim"] {
            var payload = outcomePayload()
            var binding = binding()
            var occurredAt = "2026-08-21T01:10:00Z"
            let expected: String
            switch kind {
            case "action":
                payload["action_id"] = "action_other"
                expected = "decision_boundary_binding_mismatch"
            case "continuation":
                payload["continuation_id"] = "continuation_other"
                expected = "continuation_not_dispatched"
            case "session", "source_turn", "project":
                binding["\(kind)_id"] = "other_\(kind)"
                expected = kind == "project" ? "unknown_decision_boundary" : "decision_boundary_binding_mismatch"
            default:
                occurredAt = "2026-08-21T01:00:06Z"
                expected = "work_outcome_before_context_claim"
            }
            let outcome = data(event(9, "work_outcome_recorded", occurredAt, binding, payload))
            XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
                CoordinatorSemanticChange(events: [outcome]), to: prefix
            )) { XCTAssertEqual($0.coordinatorError.code, expected, kind) }
            XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(
                events: snapshot.events + [outcome], documents: snapshot.documents,
                verificationRecords: snapshot.verificationRecords
            )) { XCTAssertEqual($0.coordinatorError.code, expected, kind) }
        }
        XCTAssertNil(prefix.continuation(id: "continuation_001")?.workOutcome)
        XCTAssertEqual(prefix.eventSequence, 8)
    }

    func testClosedOutcomeReplayDoesNotPromoteUnclaimedTimeoutOrLegacyDelivery() throws {
        for kind in ["unclaimed", "timeout", "legacy", "same_turn"] {
            let snapshot = try closedQueuedOutcomePrefix(
                completed: kind != "timeout", includeClaim: false,
                dispatchMode: kind == "same_turn" ? "same_turn_stop" : "queued_next_turn",
                claimProtocol: kind != "legacy" && kind != "same_turn"
            )
            let prefix = try CoordinatorSemanticReplay.replay(snapshot)
            let expected: String
            switch kind {
            case "timeout": expected = "transport_terminal_observation_missing"
            case "legacy": expected = "queued_action_context_claim_protocol_missing"
            case "same_turn": expected = "decision_boundary_closed"
            default: expected = "queued_action_context_not_claimed"
            }
            let outcome = data(event(8, "work_outcome_recorded", "2026-08-21T01:10:00Z", binding(), outcomePayload()))
            XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
                CoordinatorSemanticChange(events: [outcome]), to: prefix
            )) { XCTAssertEqual($0.coordinatorError.code, expected, kind) }
            XCTAssertThrowsError(try CoordinatorSemanticReplay.replay(
                events: snapshot.events + [outcome], documents: snapshot.documents,
                verificationRecords: snapshot.verificationRecords
            )) { XCTAssertEqual($0.coordinatorError.code, expected, kind) }
            XCTAssertNil(prefix.continuation(id: "continuation_001")?.workOutcome)
            XCTAssertEqual(prefix.eventSequence, 7)
        }
    }

    func testPendingIndexMatchesScanAcrossSessionsProjectsAndReseals() throws {
        let first = pendingBinding("first")
        let next = pendingBinding("next")
        var otherProject = pendingBinding("project")
        otherProject["project_id"] = "project_other"
        var otherSession = pendingBinding("session")
        otherSession["session_id"] = "session_other"
        let probes = try [first, next, otherProject, otherSession].map(CoordinatorBinding.init(jsonObject:))
        var changes = pendingActivation(first, suffix: "first", startingAt: 1)
        changes.append(pendingSeal(first, suffix: "first", sequence: 3, revision: 2))
        changes += pendingActivation(otherProject, suffix: "project", startingAt: 4)
        changes += pendingActivation(otherSession, suffix: "session", startingAt: 6)
        let state = try replayPendingTrace(changes, probes: probes)
        XCTAssertEqual(state.pendingInteractions.count, 3)
        XCTAssertNoThrow(try state.assertSessionPendingSlotAvailable(for: probes[0]))
        XCTAssertThrowsError(try state.assertSessionPendingSlotAvailable(for: probes[1])) {
            XCTAssertEqual($0.coordinatorError.code, "session_pending_interaction_conflict")
        }
        let conflicting = pendingActivation(next, suffix: "next", startingAt: 8)
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(
                events: conflicting.flatMap(\.events), documents: conflicting.flatMap(\.documents)
            ), to: state
        )) { XCTAssertEqual($0.coordinatorError.code, "session_pending_interaction_conflict") }
        try assertPendingIndexMatchesScan(state, probes: probes)
        XCTAssertEqual(state.eventSequence, 7)
    }

    func testEverySupportedSelectionReleasesOnlyItsPendingSlot() throws {
        // Rollback remains unsupported/disabled; do not enable it for this optimization.
        for slot in 1...3 {
            let first = pendingBinding("selected_\(slot)")
            let next = pendingBinding("after_selection_\(slot)")
            let probes = try [first, next].map(CoordinatorBinding.init(jsonObject:))
            var changes = pendingActivation(first, suffix: "selected_\(slot)", startingAt: 1)
            changes.append(CoordinatorSemanticChange(events: [data(event(
                3, "decision_selection_claimed", "2026-08-21T01:00:02Z", first, [
                    "selection_id": "selection_\(slot)", "interaction_id": "interaction_selected_\(slot)",
                    "packet_id": "packet_selected_\(slot)", "revision": 1, "option_id": "option_\(slot)",
                ]
            ))]))
            let selected = try replayPendingTrace(changes, probes: probes)
            XCTAssertTrue(selected.pendingInteractions.isEmpty)
            XCTAssertNoThrow(try selected.assertSessionPendingSlotAvailable(for: probes[1]))
            changes += pendingActivation(next, suffix: "after_selection_\(slot)", startingAt: 4)
            if slot == 3 {
                // A delayed close of the old pause must retain the newer card's slot.
                changes.append(CoordinatorSemanticChange(events: [data(event(
                    6, "decision_boundary_closed", "2026-08-21T01:00:03Z", first,
                    ["close_reason": "episode_paused"]
                ))]))
            }
            let state = try replayPendingTrace(changes, probes: probes)
            XCTAssertEqual(state.pendingInteractions.map(\.binding), [probes[1]])
            XCTAssertThrowsError(try state.assertSessionPendingSlotAvailable(for: probes[0])) {
                XCTAssertEqual($0.coordinatorError.code, "session_pending_interaction_conflict")
            }
        }
    }

    func testClosingAnUnsealedOldBoundaryKeepsTheNewPendingOwner() throws {
        let old = pendingBinding("unsealed")
        let current = pendingBinding("current")
        let probes = try [old, current].map(CoordinatorBinding.init(jsonObject:))
        let changes = [CoordinatorSemanticChange(events: [data(event(
            1, "decision_boundary_opened", "2026-08-21T01:00:00Z", old,
            ["proposal_id": "proposal_unsealed"]
        ))])] + pendingActivation(current, suffix: "current", startingAt: 2) + [
            CoordinatorSemanticChange(events: [data(event(
                4, "decision_boundary_closed", "2026-08-21T01:00:03Z", old,
                ["close_reason": "checkpoint_complete"]
            ))]),
        ]
        let state = try replayPendingTrace(changes, probes: probes)
        XCTAssertEqual(state.pendingInteractions.map(\.binding), [probes[1]])
    }

    func testPendingIndexRetainsAuthorityUntilExplicitExpiryAndRejectsInvalidSuffixes() throws {
        let first = pendingBinding("expiry")
        let next = pendingBinding("after_expiry")
        let probes = try [first, next].map(CoordinatorBinding.init(jsonObject:))
        let initial = pendingActivation(first, suffix: "expiry", startingAt: 1)
        let prefix = try replayPendingTrace(initial, probes: probes)
        let expiryPayload: [String: Any] = [
            "interaction_id": "interaction_expiry", "packet_id": "packet_expiry", "revision": 1,
            "reason": "decision_timeout", "automatic_selection": false,
        ]
        let early = data(event(3, "interaction_expired", "2026-08-21T01:02:00Z", first, expiryPayload))
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(
            CoordinatorSemanticChange(events: [early]), to: prefix
        )) { XCTAssertEqual($0.coordinatorError.code, "interaction_expired_before_packet_expiry") }
        var stalePayload = expiryPayload
        stalePayload["revision"] = 2
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(CoordinatorSemanticChange(events: [data(event(
            3, "interaction_expired", "2026-08-21T01:02:01Z", first, stalePayload
        ))]), to: prefix)) { XCTAssertEqual($0.coordinatorError.code, "decision_packet_revision_stale") }
        // Wall-clock expiry alone does not mutate replay authority or release its slot.
        let afterDeadline = pendingActivation(
            next, suffix: "after_expiry", startingAt: 3,
            sealedAt: "2026-08-21T01:03:01Z", expiresAt: "2026-08-21T01:05:01Z"
        )
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(CoordinatorSemanticChange(
            events: afterDeadline.flatMap(\.events), documents: afterDeadline.flatMap(\.documents)
        ), to: prefix)) { XCTAssertEqual($0.coordinatorError.code, "session_pending_interaction_conflict") }

        let expiry = CoordinatorSemanticChange(events: [data(event(
            3, "interaction_expired", "2026-08-21T01:02:01Z", first, expiryPayload
        ))])
        let unknown = pendingBinding("unknown")
        let invalidAfterRelease = CoordinatorSemanticChange(events: expiry.events + [data(event(
            4, "decision_boundary_closed", "2026-08-21T01:02:02Z", unknown,
            ["close_reason": "checkpoint_complete"]
        ))])
        XCTAssertThrowsError(try CoordinatorSemanticReplay.applying(invalidAfterRelease, to: prefix)) {
            XCTAssertEqual($0.coordinatorError.code, "unknown_decision_boundary")
        }
        XCTAssertEqual(prefix.eventSequence, 2)
        try assertPendingIndexMatchesScan(prefix, probes: probes)
        XCTAssertThrowsError(try prefix.assertSessionPendingSlotAvailable(for: probes[1])) {
            XCTAssertEqual($0.coordinatorError.code, "session_pending_interaction_conflict")
        }
        let changes = initial + [expiry] + pendingActivation(
            next, suffix: "after_expiry", startingAt: 4,
            sealedAt: "2026-08-21T01:03:01Z", expiresAt: "2026-08-21T01:05:01Z"
        ) + [CoordinatorSemanticChange(events: [data(event(
            6, "decision_boundary_closed", "2026-08-21T01:03:02Z", first,
            ["close_reason": "checkpoint_complete"]
        ))])]
        let state = try replayPendingTrace(changes, probes: probes)
        XCTAssertEqual(state.pendingInteractions.map(\.binding), [probes[1]])
    }

    func testPendingSlotLookupWorkDoesNotGrowWithClosedHistory() throws {
        for cardCount in [100, 200, 400] {
            var changes: [CoordinatorSemanticChange] = []
            for index in 0..<cardCount {
                let binding = pendingBinding("history_\(index)")
                let start = index * 3 + 1
                changes += pendingActivation(binding, suffix: "history_\(index)", startingAt: start)
                changes.append(CoordinatorSemanticChange(events: [data(event(
                    start + 2, "decision_boundary_closed", "2026-08-21T01:00:02Z", binding,
                    ["close_reason": "checkpoint_complete"]
                ))]))
            }
            let snapshot = JournalSnapshot(
                events: changes.flatMap(\.events), documents: changes.flatMap(\.documents),
                verificationRecords: [], journalSequence: Int64(cardCount * 3)
            )
            // Fixture construction and warmup are outside each measured replay.
            _ = try CoordinatorSemanticReplay.replay(snapshot)
            for sample in 1...3 {
                let meter = PendingSlotWorkMeter()
                let state = try CoordinatorSemanticReplay.replay(snapshot, observing: meter.observe)
                let work = meter.snapshot()
                XCTAssertEqual(work.lookups, cardCount)
                XCTAssertEqual(work.fullEvents, [cardCount * 3])
                XCTAssertTrue(work.incrementalEvents.isEmpty)
                XCTAssertEqual(work.fullNanoseconds.count, 1)
                XCTAssertEqual(state.boundaries.count, cardCount)
                XCTAssertTrue(state.pendingInteractions.isEmpty)
                print("pending_index_history cards=\(cardCount) sample=\(sample)"
                    + " lookup_count=\(work.lookups) old_scan_candidates_calculated=\(cardCount * (cardCount + 1) / 2)"
                    + " replay_ns=\(work.fullNanoseconds.first ?? 0)")

                let next = pendingBinding("history_next")
                let activation = pendingActivation(next, suffix: "history_next", startingAt: cardCount * 3 + 1)
                let incrementalMeter = PendingSlotWorkMeter()
                let updated = try CoordinatorSemanticReplay.applying(CoordinatorSemanticChange(
                    events: activation.flatMap(\.events), documents: activation.flatMap(\.documents)
                ), to: state, observing: incrementalMeter.observe)
                let incrementalWork = incrementalMeter.snapshot()
                XCTAssertEqual(incrementalWork.lookups, 1)
                XCTAssertEqual(incrementalWork.incrementalEvents, [2])
                XCTAssertTrue(incrementalWork.fullEvents.isEmpty)
                XCTAssertEqual(updated.pendingInteractions.count, 1)
                XCTAssertTrue(state.pendingInteractions.isEmpty)
            }
        }
    }

    private func pendingBinding(_ suffix: String) -> [String: Any] {
        var value = binding()
        value["source_turn_id"] = "turn_\(suffix)"
        value["source_prompt_id"] = "prompt_\(suffix)"
        value["episode_id"] = "episode_\(suffix)"
        value["episode_root_prompt_id"] = "prompt_\(suffix)"
        value["decision_boundary_id"] = "boundary_\(suffix)"
        return value
    }

    private func pendingActivation(
        _ binding: [String: Any], suffix: String, startingAt sequence: Int,
        sealedAt: String = "2026-08-21T01:00:01Z", expiresAt: String = "2026-08-21T01:02:01Z"
    ) -> [CoordinatorSemanticChange] {
        [CoordinatorSemanticChange(events: [data(event(
            sequence, "decision_boundary_opened", sealedAt, binding,
            ["proposal_id": "proposal_\(suffix)"]
        ))]), pendingSeal(binding, suffix: suffix, sequence: sequence + 1, sealedAt: sealedAt, expiresAt: expiresAt)]
    }

    private func pendingSeal(
        _ binding: [String: Any], suffix: String, sequence: Int, revision: Int = 1,
        sealedAt: String = "2026-08-21T01:00:01Z", expiresAt: String = "2026-08-21T01:02:01Z"
    ) -> CoordinatorSemanticChange {
        var document = packet(binding: binding)
        document["interaction_id"] = "interaction_\(suffix)"
        document["packet_id"] = "packet_\(suffix)"
        document["revision"] = revision
        document["valid_after_event_sequence"] = sequence
        document["sealed_at"] = sealedAt
        document["expires_at"] = expiresAt
        var choices = document["choices"] as! [[String: Any]]
        choices[1]["enabled"] = true
        choices[1]["disabled_reason"] = NSNull()
        choices[1]["action_id"] = "action_2"
        choices[1]["action"] = action("Alternative")
        document["choices"] = choices
        return CoordinatorSemanticChange(events: [data(event(
            sequence, "decision_packet_sealed", sealedAt, binding, [
                "interaction_id": "interaction_\(suffix)", "packet_id": "packet_\(suffix)",
                "revision": revision, "expires_at": expiresAt,
            ]
        ))], documents: [data(document)])
    }

    @discardableResult
    private func replayPendingTrace(
        _ changes: [CoordinatorSemanticChange], probes: [CoordinatorBinding]
    ) throws -> CoordinatorSemanticState {
        var incremental = CoordinatorSemanticState()
        var events: [Data] = []
        var documents: [Data] = []
        for change in changes {
            events += change.events
            documents += change.documents
            incremental = try CoordinatorSemanticReplay.applying(change, to: incremental)
            let full = try CoordinatorSemanticReplay.replay(events: events, documents: documents)
            XCTAssertEqual(incremental, full)
            try assertPendingIndexMatchesScan(incremental, probes: probes)
            try assertPendingIndexMatchesScan(full, probes: probes)
        }
        return incremental
    }

    private func assertPendingIndexMatchesScan(
        _ state: CoordinatorSemanticState, probes: [CoordinatorBinding],
        file: StaticString = #filePath, line: UInt = #line
    ) throws {
        for probe in probes {
            // Independent oracle using the original guard, only in tests.
            let conflicting = state.boundaries.values.contains {
                $0.binding.fullKey != probe.fullKey && $0.binding.sessionKey == probe.sessionKey
                    && $0.isPendingInteraction
            }
            if conflicting {
                XCTAssertThrowsError(try state.assertSessionPendingSlotAvailable(for: probe), file: file, line: line) {
                    XCTAssertEqual($0.coordinatorError.code, "session_pending_interaction_conflict", file: file, line: line)
                }
            } else {
                XCTAssertNoThrow(try state.assertSessionPendingSlotAvailable(for: probe), file: file, line: line)
            }
        }
    }

    private func outcomePayload() -> [String: Any] {
        [
            "continuation_id": "continuation_001", "action_id": "action_1",
            "work_outcome_status": "succeeded", "summary": "Fictional claimed work completed.",
            "evidence_ids": ["evidence_001"],
        ]
    }

    private func closedQueuedOutcomePrefix(
        completed: Bool = true,
        includeClaim: Bool = true,
        dispatchMode: String = "queued_next_turn",
        claimProtocol: Bool = true
    ) throws -> JournalSnapshot {
        let binding = binding()
        var dispatch: [String: Any] = [
            "continuation_id": "continuation_001", "interaction_id": "interaction_001",
            "packet_id": "packet_001", "revision": 1, "option_id": "option_1", "action_id": "action_1",
            "dispatch_mode": dispatchMode, "issued_at": "2026-08-21T01:00:03Z",
            "expires_at": "2026-08-21T01:02:03Z", "in_flight_deadline_at": "2026-08-21T01:05:03Z",
        ]
        if claimProtocol { dispatch["queued_action_context_claim_protocol"] = "v1" }
        var events = [
            event(1, "decision_boundary_opened", "2026-08-21T01:00:00Z", binding, ["proposal_id": "proposal_001"]),
            event(2, "decision_packet_sealed", "2026-08-21T01:00:01Z", binding, [
                "interaction_id": "interaction_001", "packet_id": "packet_001", "revision": 1,
                "expires_at": "2026-08-21T01:02:01Z",
            ]),
            event(3, "decision_selection_claimed", "2026-08-21T01:00:02Z", binding, [
                "selection_id": "selection_001", "interaction_id": "interaction_001",
                "packet_id": "packet_001", "revision": 1, "option_id": "option_1",
            ]),
            event(4, "continuation_dispatched", "2026-08-21T01:00:03Z", binding, dispatch),
            event(5, "continuation_consumed", "2026-08-21T01:00:04Z", binding, [
                "continuation_id": "continuation_001", "dispatch_mode": dispatchMode,
            ]),
        ].map(data)
        if completed {
            events.append(data(event(6, "continuation_transport_completed", "2026-08-21T01:00:05Z", binding, [
                "continuation_id": "continuation_001", "transport_status": "completed", "work_outcome_status": "not_recorded",
            ])))
        } else {
            events.append(data(event(6, "continuation_transport_timed_out_unknown", "2026-08-21T01:05:03Z", binding, [
                "continuation_id": "continuation_001", "transport_status": "timed_out_unknown", "work_outcome_status": "unknown",
                "automatic_retry": false, "cancellation_inferred": false, "failure_inferred": false,
            ])))
        }
        events.append(data(event(7, "decision_boundary_closed", completed ? "2026-08-21T01:00:06Z" : "2026-08-21T01:05:03Z",
                                 binding, ["close_reason": "transport_terminal_observed"])))
        let documents = [data(packet(binding: binding))]
        let verifications = [data(verificationRecord(binding: binding, fingerprint: "sha256:" + String(repeating: "a", count: 64)))]
        if includeClaim {
            let prefix = try CoordinatorSemanticReplay.replay(events: events, documents: documents, verificationRecords: verifications)
            events.append(data(event(8, "queued_action_context_claimed", "2026-08-21T01:00:07Z", binding, [
                "continuation_id": "continuation_001", "delivery_turn_id": "delivery_turn_001",
                "queued_prompt_sha256": "sha256:" + String(repeating: "b", count: 64),
                "cwd_sha256": "sha256:" + String(repeating: "c", count: 64),
                "action_sha256": CoordinatorSHA256.fingerprint(try prefix.selectedActionJSON(for: "continuation_001")),
            ])))
        }
        return JournalSnapshot(events: events, documents: documents, verificationRecords: verifications,
                               journalSequence: Int64(events.count))
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
             "internal_format_repair_reserved", "internal_format_repair_claimed", "queued_action_context_claimed":
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
