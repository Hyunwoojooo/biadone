import Carbon
import Foundation
@testable import BlabeeCoordinator

enum PetTestError: Error, Sendable {
    case missingResponse(String)
    case injected(String)
}

final class PetTestSelectionIDSequence: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func next() -> String {
        lock.lock()
        value += 1
        let current = value
        lock.unlock()
        return "selection_fresh_\(current)"
    }
}

struct PetTestCard: Sendable, Equatable {
    var suffix: String
    var revision: Int64 = 1
    var packetID: String? = nil
    var millisecondsUntilExpiry: Int64 = 90_000
    var reminderDue: Bool = false
    var risk: String = "low"
    var alternativeEnabled: Bool = true
    var rollbackEnabled: Bool = false
    var rankedActionCount: Int? = nil
    var state: String = "waiting"
}

struct PetTestPermissionRequest: Sendable, Equatable {
    var suffix: String
    var arrivalSequence: Int64? = nil
    var toolName: String = "Bash"
    var requestDescription: String? = "테스트 명령 실행 권한이 필요합니다."
    var commandPreview: String? = "npm test"
    var deliveryPending: Bool = false
}

struct PetTestManagedCommandApproval: Sendable, Equatable {
    var suffix: String
    var arrivalSequence: Int64? = nil
    var jsonRPCRequestID: AnySendableJSONRPCID = .string("request-managed")
    var approvalID: String? = "approval-managed"
    var environmentID: String? = "local"
    var commandPreview: String = "swift test"
    var allowOnceAvailable: Bool = true
    var declineAvailable: Bool = true
    var deliveryPending: Bool = false
}

enum AnySendableJSONRPCID: Sendable, Equatable {
    case string(String)
    case integer(Int64)

    var object: [String: Any] {
        switch self {
        case .string(let value): ["type": "string", "value": value]
        case .integer(let value): ["type": "integer", "value": value]
        }
    }
}

func petTestData(_ object: Any) throws -> Data {
    try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
}

func petTestObject(_ data: Data) throws -> [String: Any] {
    guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw PetTestError.injected("not_object")
    }
    return value
}

func petTestIdentityObject(_ card: PetTestCard) -> [String: Any] {
    [
        "interaction_id": "interaction_\(card.suffix)",
        "packet_id": card.packetID ?? "packet_\(card.suffix)",
        "revision": card.revision,
        "project_id": "project_\(card.suffix)",
        "session_id": "session_\(card.suffix)",
        "source_turn_id": "turn_\(card.suffix)",
        "source_prompt_id": "prompt_\(card.suffix)",
        "episode_id": "episode_\(card.suffix)",
        "episode_root_prompt_id": "root_prompt_\(card.suffix)",
        "episode_baseline_checkpoint_id": "checkpoint_\(card.suffix)",
        "decision_boundary_id": "boundary_\(card.suffix)",
        "boundary_sequence": 1,
    ]
}

private func petTestAction(_ title: String) -> [String: Any] {
    [
        "title": title,
        "objective": "Objective for \(title)",
        "constraints": ["Keep scope narrow"],
        "done_when": ["The focused check passes"],
    ]
}

private func petTestChoices(_ card: PetTestCard) -> [[String: Any]] {
    if let rankedActionCount = card.rankedActionCount {
        precondition((2...4).contains(rankedActionCount))
        return (1...rankedActionCount).map { slot in
            [
                "slot": slot,
                "kind": slot == 1 ? "recommended_action" : "alternative_action",
                "enabled": true,
                "disabled_reason": NSNull(),
                "option_id": "option_rank_\(slot)_\(card.suffix)",
                "action_id": "action_rank_\(slot)_\(card.suffix)",
                "action": petTestAction("Rank \(slot) \(card.suffix)"),
            ]
        }
    }
    var alternative: [String: Any] = [
        "slot": 2,
        "kind": "alternative_action",
        "enabled": card.alternativeEnabled,
        "disabled_reason": card.alternativeEnabled
            ? NSNull()
            : "no_safe_meaningful_alternative",
        "option_id": "option_alt_\(card.suffix)",
        "action_id": card.alternativeEnabled ? "action_alt_\(card.suffix)" : NSNull(),
    ]
    if card.alternativeEnabled {
        alternative["action"] = petTestAction("Alternative \(card.suffix)")
    }

    var rollback: [String: Any] = [
        "slot": 4,
        "kind": "rollback",
        "enabled": card.rollbackEnabled,
        "disabled_reason": card.rollbackEnabled ? NSNull() : "rollback_unavailable",
        "option_id": "option_rollback_\(card.suffix)",
        "action_id": card.rollbackEnabled ? "action_rollback_\(card.suffix)" : NSNull(),
    ]
    if card.rollbackEnabled {
        rollback["target_checkpoint_id"] = "checkpoint_\(card.suffix)"
    }

    return [
        [
            "slot": 1,
            "kind": "recommended_action",
            "enabled": true,
            "disabled_reason": NSNull(),
            "option_id": "option_recommended_\(card.suffix)",
            "action_id": "action_recommended_\(card.suffix)",
            "action": petTestAction("Recommended \(card.suffix)"),
        ],
        alternative,
        [
            "slot": 3,
            "kind": "pause",
            "enabled": true,
            "disabled_reason": NSNull(),
            "option_id": "option_pause_\(card.suffix)",
            "action_id": "action_pause_\(card.suffix)",
        ],
        rollback,
    ]
}

func petTestSnapshotObject(
    cards: [PetTestCard],
    foregroundSuffix: String? = nil,
    permissionRequests: [PetTestPermissionRequest] = [],
    permissionNoticeCount: Int64 = 0,
    managedCommandApprovals: [PetTestManagedCommandApproval] = [],
    managedCommandApprovalNoticeCount: Int64 = 0
) -> [String: Any] {
    let suffixes = Array(Set(cards.map(\.suffix) + permissionRequests.map(\.suffix))).sorted()
    let projects: [[String: Any]] = suffixes.map { suffix in
        [
            "project_id": "project_\(suffix)",
            "cwd": "/tmp/blabee-pet-\(suffix)",
            "enabled": true,
        ]
    }
    let sessions: [[String: Any]] = suffixes.map { suffix in
        [
            "project_id": "project_\(suffix)",
            "session_id": "session_\(suffix)",
            "source_turn_id": "turn_\(suffix)",
            "source_prompt_id": "prompt_\(suffix)",
            "episode_id": "episode_\(suffix)",
        ]
    }
    let pending: [[String: Any]] = cards.map { card in
        var value = petTestIdentityObject(card)
        value["state"] = "pending"
        value["foreground"] = card.suffix == foregroundSuffix
        value["reminder_due"] = card.reminderDue
        value["milliseconds_until_expiry"] = card.millisecondsUntilExpiry
        return value
    }
    let interactions: [[String: Any]] = cards.map { card in
        var value = petTestIdentityObject(card)
        value["state"] = card.state
        value["cwd"] = "/tmp/blabee-pet-\(card.suffix)"
        value["summary"] = "Summary \(card.suffix)"
        value["outcome"] = ["status": "completed", "summary": "Outcome \(card.suffix)"]
        value["reported_side_effects"] = [[
            "kind": "file_change",
            "summary": "Changed a test fixture",
            "reversibility": "reversible",
        ]]
        value["sealed_at"] = "2026-08-22T00:00:00Z"
        value["expires_at"] = "2026-08-22T00:02:00Z"
        value["valid_after_event_sequence"] = 1
        value["risk"] = ["level": card.risk, "reasons": []]
        value["evidence"] = [[
            "evidence_id": "evidence_\(card.suffix)",
            "kind": "unit_test",
            "status": "passed",
            "summary": "Focused fixture passed",
            "source": "local_verified",
        ]]
        value["checkpoint"] = [
            "id": "checkpoint_\(card.suffix)",
            "coverage": card.rollbackEnabled ? "complete" : "unavailable",
        ]
        value["choices"] = petTestChoices(card)
        value["foreground"] = card.suffix == foregroundSuffix
        value["reminder_due"] = card.reminderDue
        value["milliseconds_until_expiry"] = card.millisecondsUntilExpiry
        return value
    }

    let foregroundCard = cards.first(where: { $0.suffix == foregroundSuffix })
    let foregroundObject: Any = foregroundCard.map { petTestIdentityObject($0) } ?? NSNull()
    let permissionObjects: [[String: Any]] = permissionRequests.enumerated().map {
        index, request in
        [
            "arrival_sequence": request.arrivalSequence ?? Int64(index * 2 + 1),
            "request_id": "permission_\(request.suffix)",
            "project_id": "project_\(request.suffix)",
            "session_id": "session_\(request.suffix)",
            "turn_id": "turn_\(request.suffix)",
            "cwd": "/tmp/blabee-pet-\(request.suffix)",
            "tool_name": request.toolName,
            "description": request.requestDescription ?? NSNull(),
            "command_preview": request.commandPreview ?? NSNull(),
            "delivery_pending": request.deliveryPending,
        ]
    }
    let managedApprovalObjects: [[String: Any]] = managedCommandApprovals.enumerated().map {
        index, request in
        [
            "arrival_sequence": request.arrivalSequence
                ?? Int64((permissionRequests.count + index) * 2 + 1),
            "managed_request_id": "managed_request_\(request.suffix)",
            "broker_epoch": "broker_epoch_\(request.suffix)",
            "connection_id": "connection_\(request.suffix)",
            "jsonrpc_request_id": request.jsonRPCRequestID.object,
            "thread_id": "thread_\(request.suffix)",
            "turn_id": "managed_turn_\(request.suffix)",
            "item_id": "item_\(request.suffix)",
            "approval_id": request.approvalID as Any? ?? NSNull(),
            "environment_id": request.environmentID as Any? ?? NSNull(),
            "cwd": "/tmp/blabee-managed-\(request.suffix)",
            "command_preview": request.commandPreview,
            "allow_once_available": request.allowOnceAvailable,
            "decline_available": request.declineAvailable,
            "delivery_pending": request.deliveryPending,
        ]
    }
    return [
        "schema_version": "1.0",
        "kind": "blabee_operational_snapshot",
        "routing": [
            "schema_version": "1.0",
            "kind": "blabee_routing_snapshot",
            "selection_enabled": foregroundCard != nil,
            "foreground": foregroundObject,
            "pending": pending,
            "in_flight_count": 0,
        ],
        "projects": projects,
        "sessions": sessions,
        "interactions": interactions,
        "permission_requests": permissionObjects,
        "permission_notice_count": permissionNoticeCount,
        "managed_command_approvals": managedApprovalObjects,
        "managed_command_approval_notice_count": managedCommandApprovalNoticeCount,
    ]
}

func petTestSnapshotData(
    cards: [PetTestCard],
    foregroundSuffix: String? = nil,
    permissionRequests: [PetTestPermissionRequest] = [],
    permissionNoticeCount: Int64 = 0,
    managedCommandApprovals: [PetTestManagedCommandApproval] = [],
    managedCommandApprovalNoticeCount: Int64 = 0
) throws -> Data {
    try petTestData(petTestSnapshotObject(
        cards: cards,
        foregroundSuffix: foregroundSuffix,
        permissionRequests: permissionRequests,
        permissionNoticeCount: permissionNoticeCount,
        managedCommandApprovals: managedCommandApprovals,
        managedCommandApprovalNoticeCount: managedCommandApprovalNoticeCount
    ))
}

func petTestFocusResponse() throws -> Data {
    try petTestData(["focused": true])
}

func petTestSelectionResponse(kind: String = "next_turn") throws -> Data {
    let outcome: [String: Any] = kind == "pause"
        ? ["kind": "pause"]
        : [
            "kind": "next_turn",
            "continuation_id": "continuation_test",
            "queued_submission_id": "queued_submission_test",
        ]
    return try petTestData(["accepted": true, "outcome": outcome])
}

func petTestPermissionResolutionResponse(
    _ decision: PetPermissionDecision,
    requestID: String,
    responseID: String = "permission_response_test"
) throws -> Data {
    try petTestData([
        "resolved": true,
        "request_id": requestID,
        "response_id": responseID,
        "decision": decision.rawValue,
    ])
}

func petTestManagedCommandApprovalResolutionResponse(
    _ decision: PetManagedCommandApprovalDecision,
    managedRequestID: String,
    responseID: String = "managed_approval_response_test"
) throws -> Data {
    try petTestData([
        "resolved": true,
        "managed_request_id": managedRequestID,
        "response_id": responseID,
        "decision": decision.rawValue,
    ])
}

actor PetFakeTransport: PetCoordinatorTransport {
    private var responses: [String: [Data]] = [:]
    private var failures: [String: [String]] = [:]
    private var requests: [(String, Data)] = []
    private var blockFocus = false
    private var focusWaiters: [CheckedContinuation<Void, Never>] = []
    private var blockSelection = false
    private var selectionWaiters: [CheckedContinuation<Void, Never>] = []
    private var blockNextManagedApprovalResolution = false
    private var managedApprovalResolutionWaiters: [CheckedContinuation<Void, Never>] = []

    func enqueue(type: String, response: Data) {
        responses[type, default: []].append(response)
    }

    func enqueueFailure(type: String, code: String) {
        failures[type, default: []].append(code)
    }

    func setFocusBlocked(_ blocked: Bool) {
        blockFocus = blocked
        if !blocked {
            let waiters = focusWaiters
            focusWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
    }

    func setSelectionBlocked(_ blocked: Bool) {
        blockSelection = blocked
        if !blocked {
            let waiters = selectionWaiters
            selectionWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
    }

    func setNextManagedApprovalResolutionBlocked(_ blocked: Bool) {
        blockNextManagedApprovalResolution = blocked
        if !blocked {
            let waiters = managedApprovalResolutionWaiters
            managedApprovalResolutionWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
    }

    func request(type: String, payload: Data) async throws -> Data {
        requests.append((type, payload))
        if type == "focus_interaction", blockFocus {
            await withCheckedContinuation { continuation in
                focusWaiters.append(continuation)
            }
        }
        if type == "select", blockSelection {
            await withCheckedContinuation { continuation in
                selectionWaiters.append(continuation)
            }
        }
        if type == "resolve_managed_command_approval",
           blockNextManagedApprovalResolution
        {
            blockNextManagedApprovalResolution = false
            await withCheckedContinuation { continuation in
                managedApprovalResolutionWaiters.append(continuation)
            }
        }
        if var queuedFailures = failures[type], !queuedFailures.isEmpty {
            let code = queuedFailures.removeFirst()
            failures[type] = queuedFailures
            throw PetTestError.injected(code)
        }
        guard var queuedResponses = responses[type], !queuedResponses.isEmpty else {
            throw PetTestError.missingResponse(type)
        }
        let response = queuedResponses.removeFirst()
        responses[type] = queuedResponses
        return response
    }

    func requestCount(type: String) -> Int {
        requests.filter { $0.0 == type }.count
    }

    func requestPayloads(type: String) -> [Data] {
        requests.filter { $0.0 == type }.map(\.1)
    }
}

@MainActor
final class PetFakeApplicationOpener: PetExternalApplicationOpening {
    var captured = PetExternalApplicationReference(
        processIdentifier: 400,
        localizedName: "Test Codex Host"
    )
    private(set) var captureCalls = 0
    private(set) var opened: [PetExternalApplicationReference] = []
    var openResult = true

    func captureFrontmostExternalApplication(
        excludingProcessIdentifier: pid_t
    ) -> PetExternalApplicationReference? {
        captureCalls += 1
        return captured.processIdentifier == excludingProcessIdentifier ? nil : captured
    }

    func open(_ reference: PetExternalApplicationReference) -> Bool {
        opened.append(reference)
        return openResult
    }
}

final class PetFakeHotKeyReference: PetHotKeyReference, @unchecked Sendable {
    let id: UInt32

    init(id: UInt32) { self.id = id }
}

final class PetFakeHotKeyBackend: PetHotKeyBackend, @unchecked Sendable {
    struct Registration: Equatable {
        let event: PetHotKeyEvent
        let shortcut: PetShortcut
        let exclusive: Bool
    }

    private(set) var installCount = 0
    private(set) var registrations: [UInt32: Registration] = [:]
    private(set) var registrationHistory: [Registration] = []
    private(set) var retiredEventIDs: [UInt32] = []
    var failingShortcuts: Set<PetShortcut> = []
    var registrationErrors: [PetShortcut: OSStatus] = [:]
    private var handler: (@Sendable (PetHotKeyEvent) -> Void)?

    func installHandler(_ handler: @escaping @Sendable (PetHotKeyEvent) -> Void) throws {
        installCount += 1
        self.handler = handler
    }

    func register(
        event: PetHotKeyEvent,
        shortcut: PetShortcut,
        exclusive: Bool
    ) throws -> PetHotKeyReference {
        if let status = registrationErrors[shortcut] {
            throw PetHotKeyBackendError.registration(status)
        }
        if failingShortcuts.contains(shortcut)
            || registrations.values.contains(where: { $0.shortcut == shortcut })
        {
            throw PetHotKeyBackendError.registration(OSStatus(eventHotKeyExistsErr))
        }
        let registration = Registration(
            event: event,
            shortcut: shortcut,
            exclusive: exclusive
        )
        registrations[event.id] = registration
        registrationHistory.append(registration)
        return PetFakeHotKeyReference(id: event.id)
    }

    func unregister(_ reference: PetHotKeyReference) {
        guard let reference = reference as? PetFakeHotKeyReference else { return }
        registrations.removeValue(forKey: reference.id)
        retiredEventIDs.append(reference.id)
    }

    func emit(_ event: PetHotKeyEvent) {
        handler?(event)
    }
}
