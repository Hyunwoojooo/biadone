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
    var state: String = "waiting"
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
    permissionNoticeCount: Int64 = 0
) -> [String: Any] {
    let projects: [[String: Any]] = cards.map { card in
        [
            "project_id": "project_\(card.suffix)",
            "cwd": "/tmp/blabee-pet-\(card.suffix)",
            "enabled": true,
        ]
    }
    let sessions: [[String: Any]] = cards.map { card in
        [
            "project_id": "project_\(card.suffix)",
            "session_id": "session_\(card.suffix)",
            "source_turn_id": "turn_\(card.suffix)",
            "source_prompt_id": "prompt_\(card.suffix)",
            "episode_id": "episode_\(card.suffix)",
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
        "permission_notice_count": permissionNoticeCount,
    ]
}

func petTestSnapshotData(
    cards: [PetTestCard],
    foregroundSuffix: String? = nil,
    permissionNoticeCount: Int64 = 0
) throws -> Data {
    try petTestData(petTestSnapshotObject(
        cards: cards,
        foregroundSuffix: foregroundSuffix,
        permissionNoticeCount: permissionNoticeCount
    ))
}

func petTestFocusResponse() throws -> Data {
    try petTestData(["focused": true])
}

func petTestSelectionResponse(kind: String = "continuation") throws -> Data {
    let outcome: [String: Any] = kind == "pause"
        ? ["kind": "pause"]
        : ["kind": "continuation", "continuation_id": "continuation_test"]
    return try petTestData(["accepted": true, "outcome": outcome])
}

actor PetFakeTransport: PetCoordinatorTransport {
    private var responses: [String: [Data]] = [:]
    private var failures: [String: [String]] = [:]
    private var requests: [(String, Data)] = []
    private var blockSelection = false
    private var selectionWaiters: [CheckedContinuation<Void, Never>] = []

    func enqueue(type: String, response: Data) {
        responses[type, default: []].append(response)
    }

    func enqueueFailure(type: String, code: String) {
        failures[type, default: []].append(code)
    }

    func setSelectionBlocked(_ blocked: Bool) {
        blockSelection = blocked
        if !blocked {
            let waiters = selectionWaiters
            selectionWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
    }

    func request(type: String, payload: Data) async throws -> Data {
        requests.append((type, payload))
        if type == "select", blockSelection {
            await withCheckedContinuation { continuation in
                selectionWaiters.append(continuation)
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
