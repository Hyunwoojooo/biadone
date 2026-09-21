import CoordinatorSwift
import Foundation

struct PetEventReference: Sendable, Equatable, Hashable {
    enum Kind: String, Sendable { case decision, permission, managed }
    let kind: Kind
    let eventID: String

    init(kind: Kind, eventID: String) {
        self.kind = kind
        self.eventID = eventID
    }

    init(jsonObject: [String: Any]) throws {
        guard Set(jsonObject.keys) == ["event_kind", "event_id"],
              let rawKind = jsonObject["event_kind"] as? String,
              let kind = Kind(rawValue: rawKind),
              let eventID = jsonObject["event_id"] as? String,
              !eventID.isEmpty, eventID.count <= 512
        else { throw PetModelError.invalid("event_navigation.reference") }
        self.init(kind: kind, eventID: eventID)
    }

    var jsonObject: [String: Any] {
        ["event_kind": kind.rawValue, "event_id": eventID]
    }
}

/// The identity and exact immutable binding submitted by a navigation click.
/// Equality deliberately excludes countdowns, reminder flags and display text.
struct PetEventFocusTarget: Sendable, Equatable {
    let reference: PetEventReference
    let data: Data
}

enum PetQueuedEvent: Sendable, Equatable {
    case decision(PetInteraction)
    case permission(PetPermissionRequest)
    case managed(PetManagedCommandApproval)

    var reference: PetEventReference {
        switch self {
        case .decision(let interaction):
            PetEventReference(kind: .decision, eventID: interaction.identity.interactionID)
        case .permission(let request):
            PetEventReference(kind: .permission, eventID: request.requestID)
        case .managed(let request):
            PetEventReference(kind: .managed, eventID: request.managedRequestID)
        }
    }

    var approval: PetApprovalHead? {
        switch self {
        case .decision: nil
        case .permission(let request): .permission(request)
        case .managed(let request): .managed(request)
        }
    }

    var deliveryPending: Bool {
        switch self {
        case .decision: false
        case .permission(let request): request.deliveryPending
        case .managed(let request): request.deliveryPending
        }
    }

    func focusTarget() throws -> PetEventFocusTarget {
        let target: [String: Any]
        switch self {
        case .decision(let interaction):
            target = PetFocusRequest(identity: interaction.identity).jsonObject
        case .permission(let request):
            target = [
                "schema_version": "1.0", "kind": "blabee_permission_resolution_request",
                "request_id": request.requestID, "project_id": request.projectID,
                "session_id": request.sessionID, "turn_id": request.turnID,
            ]
        case .managed(let request):
            var object = request.bindingObject
            object["schema_version"] = "1.0"
            object["kind"] = "blabee_managed_command_approval_resolution_request"
            object["managed_request_id"] = request.managedRequestID
            target = object
        }
        let data = try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "1.0", "kind": "blabee_pet_event_focus_request",
            "event_kind": reference.kind.rawValue, "target": target,
        ])
        return PetEventFocusTarget(reference: reference, data: data)
    }
}

struct PetEventNavigationSnapshot: Sendable, Equatable {
    let events: [PetEventReference]
    let focused: PetEventReference?
    let revision: Int64
    let deliveryPending: Bool

    init(jsonObject: [String: Any], availableEvents: [PetQueuedEvent]) throws {
        guard Set(jsonObject.keys) == ["events", "focused", "revision", "delivery_pending"],
              let rawEvents = jsonObject["events"] as? [[String: Any]],
              let revision = ExactJSONInteger.int64(jsonObject["revision"], minimum: 0),
              let deliveryPending = petStrictBooleanValue(jsonObject["delivery_pending"])
        else { throw PetModelError.invalid("event_navigation") }
        events = try rawEvents.map(PetEventReference.init(jsonObject:))
        let availableReferences = availableEvents.map(\.reference)
        guard Set(events).count == events.count,
              Set(availableReferences).count == availableReferences.count,
              Set(events) == Set(availableReferences)
        else { throw PetModelError.invalid("event_navigation.events") }
        if jsonObject["focused"] is NSNull {
            focused = nil
        } else if let rawFocused = jsonObject["focused"] as? [String: Any] {
            let reference = try PetEventReference(jsonObject: rawFocused)
            guard events.contains(reference) else {
                throw PetModelError.invalid("event_navigation.focused")
            }
            focused = reference
        } else {
            throw PetModelError.invalid("event_navigation.focused")
        }
        guard deliveryPending == availableEvents.contains(where: \.deliveryPending) else {
            throw PetModelError.invalid("event_navigation.delivery_pending")
        }
        self.revision = revision
        self.deliveryPending = deliveryPending
    }
}

extension PetSnapshot {
    var queuedEvents: [PetQueuedEvent] {
        let decisions = interactions.filter { $0.state == .waiting }.map(PetQueuedEvent.decision)
        let approvals = permissionRequests.map(PetQueuedEvent.permission)
            + managedCommandApprovals.map(PetQueuedEvent.managed)
        guard let eventNavigation else {
            return approvals.sorted { $0.approval!.arrivalSequence < $1.approval!.arrivalSequence }
                + decisions
        }
        let byReference = Dictionary(uniqueKeysWithValues: (decisions + approvals).map {
            ($0.reference, $0)
        })
        return eventNavigation.events.compactMap { byReference[$0] }
    }

    func event(reference: PetEventReference) -> PetQueuedEvent? {
        queuedEvents.first { $0.reference == reference }
    }
}
