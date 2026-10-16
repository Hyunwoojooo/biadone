import CoordinatorSwift
import Foundation

/// A card's presentation identity includes its immutable binding and authority
/// incarnation, but not a readiness generation or changing countdown text.
struct PetProviderInboxIdentity: Sendable, Hashable {
    let data: Data

    init(context: PetProviderContext, event: PetQueuedEvent) throws {
        var target = context.target
        target.removeValue(forKey: "ui_generation")
        data = try StrictJSONTransport.data(forJSONObject: [
            "provider": context.provider == .claude ? "claude" : "codex",
            "target": target,
            "event": StrictJSONTransport.object(from: event.focusTarget().data),
        ])
    }
}

struct PetProviderInboxEntry: Sendable, Equatable, Identifiable {
    let id: PetProviderInboxIdentity
    let session: PetProviderSession
    let event: PetQueuedEvent
    let arrivalSequence: UInt64
    var context: PetProviderContext { session.context }

    init(session: PetProviderSession, event: PetQueuedEvent, arrivalSequence: UInt64) throws {
        id = try PetProviderInboxIdentity(context: session.context, event: event)
        self.session = session
        self.event = event
        self.arrivalSequence = arrivalSequence
    }
}

struct PetProviderInboxSession: Sendable, Equatable, Identifiable {
    let session: PetProviderSession
    let status: PetProviderStatus?
    let diagnostic: String?
    var id: String { session.id }

    init(session: PetProviderSession, status: PetProviderStatus?, diagnostic: String?) {
        self.session = session
        self.status = status
        self.diagnostic = diagnostic
    }
}

/// Settings evidence comes only from a successful Codex projection in this
/// refresh. The currently displayed Claude card is never a Codex status source.
struct PetCodexSettingsEvidence: Sendable, Equatable {
    let activeProjectPaths: Set<String>
    let receivedCardProjectPaths: Set<String>

    init(snapshot: PetSnapshot) {
        activeProjectPaths = Set(snapshot.projects.filter(\.enabled).map(\.cwd))
        receivedCardProjectPaths = Set(snapshot.interactions.filter(\.isSelectionReady).map(\.cwd))
            .intersection(activeProjectPaths)
    }
}

/// All provider queues are presentation-only. Mutations still require the exact
/// selected provider context and the provider's original selection contract.
struct PetProviderInbox: Sendable, Equatable {
    let entries: [PetProviderInboxEntry]
    let sessions: [PetProviderInboxSession]
    let arrivalOrderComplete: Bool
    let codexSettings: PetCodexSettingsEvidence?

    init(entries: [PetProviderInboxEntry], sessions: [PetProviderInboxSession], arrivalOrderComplete: Bool,
         codexSettings: PetCodexSettingsEvidence? = nil) {
        self.entries = entries.sorted {
            if $0.arrivalSequence != $1.arrivalSequence { return $0.arrivalSequence < $1.arrivalSequence }
            return $0.id.data.lexicographicallyPrecedes($1.id.data)
        }
        self.sessions = sessions
        self.arrivalOrderComplete = arrivalOrderComplete
        self.codexSettings = codexSettings
    }
}

/// Private app envelope: adds queue-order metadata without extending either
/// provider's frozen snapshot, binding or selection leaf contracts.
enum PetProviderInboxCodec {
    static let schema = "blabee.pet-inbox.v1"
    static let maximumRows = 128

    struct Query: Sendable, Equatable {
        let context: PetProviderContext
        let reference: PetEventReference

        var jsonObject: [String: Any] {
            ["provider": context.provider == .claude ? "claude" : "codex",
             "target": context.target, "event_kind": reference.kind.rawValue,
             "event_id": reference.eventID]
        }
    }

    static func request(queries: [Query], service: String) throws -> [String: Any] {
        let value: [String: Any] = ["schema_version": schema, "kind": "request",
            "request_id": UUID().uuidString.lowercased(), "operation": "order",
            "service_incarnation": service, "queries": queries.map(\.jsonObject)]
        _ = try validateRequest(value)
        return value
    }

    static func validateRequest(_ value: [String: Any]) throws -> [Query] {
        guard Set(value.keys) == ["schema_version", "kind", "request_id", "operation", "service_incarnation", "queries"],
              value["schema_version"] as? String == schema, value["kind"] as? String == "request",
              value["operation"] as? String == "order",
              let id = value["request_id"] as? String, PetProviderContext.isUUID(id),
              let service = value["service_incarnation"] as? String, PetProviderContext.isUUID(service),
              let rows = value["queries"] as? [[String: Any]], rows.count <= maximumRows else {
            throw PetModelError.invalid("provider_inbox_request")
        }
        var seen = Set<PetEventArrivalLedger.Key>()
        return try rows.map { row in
            guard Set(row.keys) == ["provider", "target", "event_kind", "event_id"],
                  let rawProvider = row["provider"] as? String, ["claude", "codex"].contains(rawProvider),
                  let target = row["target"] as? [String: Any] else {
                throw PetModelError.invalid("provider_inbox_query")
            }
            let context = try PetProviderContext(provider: rawProvider == "claude" ? .claude : .codex, target: target)
            let reference = try PetEventReference(jsonObject: [
                "event_kind": row["event_kind"]!, "event_id": row["event_id"]!,
            ])
            guard context.serviceIncarnation == service,
                  context.provider == .codex || reference.kind == .decision,
                  seen.insert(.init(scopeID: context.scopeID, kind: reference.kind.rawValue,
                                    eventID: reference.eventID)).inserted else {
                throw PetModelError.invalid("provider_inbox_query")
            }
            return Query(context: context, reference: reference)
        }
    }

    static func response(request: [String: Any], sequences: [UInt64?]) throws -> Data {
        let queries = try validateRequest(request)
        guard sequences.count == queries.count else { throw PetModelError.invalid("provider_inbox_response") }
        return try StrictJSONTransport.data(forJSONObject: [
            "schema_version": schema, "kind": "response", "request_id": request["request_id"]!,
            "operation": "order", "service_incarnation": request["service_incarnation"]!,
            "sequences": sequences.map { $0.map { String($0) } as Any? ?? NSNull() },
        ])
    }

    static func decode(_ data: Data, matching request: [String: Any]) throws -> [UInt64?] {
        let queries = try validateRequest(request)
        let value = try StrictJSONTransport.object(from: data)
        guard Set(value.keys) == ["schema_version", "kind", "request_id", "operation", "service_incarnation", "sequences"],
              value["schema_version"] as? String == schema, value["kind"] as? String == "response",
              value["operation"] as? String == "order",
              value["request_id"] as? String == request["request_id"] as? String,
              value["service_incarnation"] as? String == request["service_incarnation"] as? String,
              let sequences = value["sequences"] as? [Any], sequences.count == queries.count else {
            throw PetModelError.invalid("provider_inbox_response")
        }
        var seen = Set<UInt64>()
        return try sequences.map { raw in
            if raw is NSNull { return nil }
            guard let text = raw as? String, let value = UInt64(text), value > 0,
                  value != UInt64.max, String(value) == text, seen.insert(value).inserted else {
                throw PetModelError.invalid("provider_inbox_sequence")
            }
            return value
        }
    }
}
