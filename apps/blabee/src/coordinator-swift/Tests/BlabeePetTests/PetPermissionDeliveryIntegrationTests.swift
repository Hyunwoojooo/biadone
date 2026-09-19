import Foundation
import Testing
@testable import CoordinatorSwift
@testable import BlabeeCoordinator

// Hook approvals and empty-session prompt changes are process-local. A write
// here is unexpected; this fixture never opens a real journal or Keychain.
private struct PermissionDeliveryEmptyJournal: CoordinatorSemanticJournalPort {
    func load() throws -> JournalSnapshot {
        JournalSnapshot(events: [], documents: [], verificationRecords: [], journalSequence: 0)
    }

    func append(expectedSequence: Int64, events: [Data], documents: [Data],
                verificationRecords: [Data]) throws -> JournalAppendResult {
        throw CoordinatorError("unexpected_permission_journal_write")
    }
}

@Test("Root approval delivery survives a new prompt while another approval is pending",
      arguments: PetPermissionDecision.allCases)
@MainActor
func petRootApprovalDeliveryNewPrompt(decision: PetPermissionDecision) async throws {
    let app = CoordinatorOperationalApplication(
        routing: try CoordinatorRoutingApplication(journal: PermissionDeliveryEmptyJournal()),
        monotonicInstantGenerator: { 0 },
        petConsumerLeaseDurationNanoseconds: 10_000_000_000
    )
    let cwd = "/tmp/blabee-permission-delivery-integration"
    _ = try await app.handle(type: "enable_project", payload: petTestData([
        "cwd": cwd, "project_id": "project_delivery",
    ]))
    for session in ["root", "other"] {
        _ = try await app.handle(type: "user_prompt_submit", payload: petTestData([
            "session_id": session, "turn_id": "turn_\(session)",
            "cwd": cwd, "prompt": "First prompt",
        ]))
    }
    let heartbeat = try PetTransportRequestPayload.snapshotWithConsumerHeartbeat()
    _ = try await app.handle(type: "get_state", payload: heartbeat)

    func permissionPayload(_ session: String) throws -> Data {
        try petTestData([
            "session_id": session, "turn_id": "turn_\(session)", "cwd": cwd,
            "hook_event_name": "PermissionRequest", "permission_mode": "default",
            "tool_name": "Bash", "tool_input": ["command": "printf fixture"],
            HookPermissionPolicy.qualificationKey: HookPermissionPolicy.qualifiedRuntime,
        ])
    }
    func snapshot(count: Int) async throws -> PetSnapshot {
        for _ in 0..<100 {
            let result = try PetSnapshot.parse(await app.handle(type: "get_state", payload: heartbeat))
            if result.permissionRequests.count == count { return result }
            try await Task.sleep(for: .milliseconds(5))
        }
        throw CoordinatorError("permission_fixture_timeout")
    }
    let rootPayload = try permissionPayload("root")
    let rootWaiter = Task { try await app.handle(type: "permission_request", payload: rootPayload) }
    defer { rootWaiter.cancel() }
    let root = try #require(try await snapshot(count: 1).permissionRequests.first)
    let otherPayload = try permissionPayload("other")
    let otherWaiter = Task { try await app.handle(type: "permission_request", payload: otherPayload) }
    defer { otherWaiter.cancel() }
    _ = try await snapshot(count: 2)

    let resolution = try petTestData(PetPermissionResolutionRequest(
        request: root, responseID: "response_delivery", decision: decision
    ).jsonObject)
    let resolving = Task { try await app.handle(type: "resolve_permission_request", payload: resolution) }
    defer { resolving.cancel() }
    let hookResponse = try #require(try JSONSerialization.jsonObject(with: await rootWaiter.value) as? [String: Any])
    _ = try await app.handle(type: "user_prompt_submit", payload: petTestData([
        "session_id": "root", "turn_id": "turn_root_new",
        "cwd": cwd, "prompt": "New prompt before the old delivery ACK",
    ]))

    // Parse the actual coordinator output, not a hand-written snapshot. The
    // selected approval still belongs to the old turn until its exact ACK.
    let pending = try await snapshot(count: 2)
    let delivering = try #require(pending.permissionRequests.first)
    #expect(delivering.requestID == root.requestID)
    #expect(delivering.turnID == "turn_root")
    #expect(delivering.deliveryPending)
    #expect(pending.sessions.first { $0.sessionID == "root" }?.sourceTurnID == "turn_root_new")

    let transport = PetFakeTransport()
    let model = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(), processIdentifier: 999)
    defer { model.stopPolling() }
    model.applySnapshotForTesting(pending)
    #expect(!model.canActOnDisplayedEvent)
    for repeated in PetPermissionDecision.allCases {
        await model.resolvePermissionRequest(repeated, for: delivering)
    }
    #expect(await transport.requestCount(type: "resolve_permission_request") == 0)

    var ack: [String: Any] = [
        "schema_version": "1.0", "kind": "blabee_permission_request_delivery_ack",
        "request_id": hookResponse["request_id"]!, "session_id": hookResponse["session_id"]!,
        "turn_id": "turn_root_new", "delivery_token": hookResponse["delivery_token"]!,
    ]
    do {
        _ = try await app.handle(type: "ack_permission_request_delivery", payload: petTestData(ack))
        Issue.record("a new turn must not acknowledge the original approval")
    } catch is CoordinatorError {}
    ack["turn_id"] = hookResponse["turn_id"]!
    _ = try await app.handle(type: "ack_permission_request_delivery", payload: petTestData(ack))
    _ = try await resolving.value
    let remaining = try await snapshot(count: 1)
    #expect(remaining.permissionRequests.first?.sessionID == "other")
    model.applySnapshotForTesting(remaining)
    #expect(model.canActOnDisplayedEvent)
    otherWaiter.cancel()
    _ = await otherWaiter.result
}

@Test("Root delivery exceptions preserve project, session, cwd and waiting-turn fences",
      arguments: ["project", "session", "cwd", "waiting_turn"])
func petRootApprovalDeliveryRejectsForeignBinding(change: String) throws {
    var object = petTestSnapshotObject(cards: [], permissionRequests: [
        PetTestPermissionRequest(suffix: "delivery", allowOnceAvailable: true, deliveryPending: true),
    ])
    var sessions = try #require(object["sessions"] as? [[String: Any]])
    sessions[0]["source_turn_id"] = "turn_new"
    object["sessions"] = sessions
    var requests = try #require(object["permission_requests"] as? [[String: Any]])
    switch change {
    case "project": requests[0]["project_id"] = "foreign_project"
    case "session": requests[0]["session_id"] = "foreign_session"
    case "cwd": requests[0]["cwd"] = "/tmp/foreign-project"
    default: requests[0]["delivery_pending"] = false
    }
    object["permission_requests"] = requests
    #expect(throws: (any Error).self) { try PetSnapshot.parse(petTestData(object)) }
}
