import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation

/// An immutable public target. Credentials belong to the owned service handle,
/// not the view model, menu item, card binding or persisted settings.
struct PetProviderContext: Hashable, Sendable {
    let provider: PetProvider
    let scopeID: String
    let serviceIncarnation: String
    let sessionIncarnation: String
    let authorityEpoch: String?
    let uiGeneration: UInt64

    var target: [String: Any] {
        var value: [String: Any] = ["scope_id": scopeID, "service_incarnation": serviceIncarnation,
            "session_incarnation": sessionIncarnation, "ui_generation": String(uiGeneration)]
        if let authorityEpoch { value["authority_epoch"] = authorityEpoch }
        return value
    }

    init(provider: PetProvider, scopeID: String, serviceIncarnation: String,
         sessionIncarnation: String, authorityEpoch: String?, uiGeneration: UInt64) {
        self.provider = provider; self.scopeID = scopeID
        self.serviceIncarnation = serviceIncarnation; self.sessionIncarnation = sessionIncarnation
        self.authorityEpoch = authorityEpoch; self.uiGeneration = uiGeneration
    }

    init(provider: PetProvider, target: [String: Any]) throws {
        let required: Set<String> = ["scope_id", "service_incarnation", "session_incarnation", "ui_generation"]
        guard Set(target.keys) == (provider == .claude ? required.union(["authority_epoch"]) : required),
              let scope = target["scope_id"] as? String, !scope.isEmpty, scope.utf8.count <= 256,
              !scope.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }),
              let service = target["service_incarnation"] as? String, Self.isUUID(service),
              let session = target["session_incarnation"] as? String, Self.isUUID(session),
              let generation = target["ui_generation"] as? String, let number = UInt64(generation),
              String(number) == generation else { throw PetModelError.invalid("provider_context") }
        let epoch = target["authority_epoch"] as? String
        guard provider == .codex || (Self.isUUID(scope) && epoch.map(Self.isUUID) == true) else {
            throw PetModelError.invalid("provider_context")
        }
        self.init(provider: provider, scopeID: scope, serviceIncarnation: service,
                  sessionIncarnation: session, authorityEpoch: epoch, uiGeneration: number)
    }

    static func isUUID(_ value: String) -> Bool {
        UUID(uuidString: value)?.uuidString.lowercased() == value
    }
}

struct PetProviderSession: Equatable, Sendable, Identifiable {
    let id: String
    let context: PetProviderContext
    let projectID: String
    let sessionID: String
    let cwd: String
    let state: String
    let title: String
    /// Public correlation only. Authority still comes from the current context
    /// and the app-owned service capability.
    let nativeSessionID: String?

    init(id: String, context: PetProviderContext, projectID: String, sessionID: String,
         cwd: String, state: String, title: String, nativeSessionID: String? = nil) {
        self.id = id; self.context = context; self.projectID = projectID; self.sessionID = sessionID
        self.cwd = cwd; self.state = state; self.title = title; self.nativeSessionID = nativeSessionID
    }
}

/// The capability is available only while the exact app-owned child is alive
/// and has published its service. A public generation alone is not authority.
struct PetProviderServiceAccess: Sendable, Equatable {
    let generation: UInt64
    let credential: String
}

/// In-process evidence from a fresh authenticated directory response. Unlike
/// providerDiagnostic, it is independent of the currently selected projection.
struct PetProviderDirectoryStatus: Sendable, Equatable {
    let serviceGeneration: UInt64
    let serviceIncarnation: String
}

enum PetProviderDirectoryCodec {
    static let schema = "blabee.pet-directory.v1"
    static let maximumRows = 32

    static func request(operation: String, payload: [String: Any] = [:]) throws -> [String: Any] {
        let value: [String: Any] = ["schema_version": schema, "kind": "request",
            "request_id": UUID().uuidString.lowercased(), "operation": operation, "payload": payload]
        _ = try validateRequest(value)
        return value
    }

    @discardableResult
    static func validateRequest(_ value: [String: Any]) throws -> String {
        guard Set(value.keys) == ["schema_version", "kind", "request_id", "operation", "payload"],
              value["schema_version"] as? String == schema, value["kind"] as? String == "request",
              let id = value["request_id"] as? String, PetProviderContext.isUUID(id),
              let operation = value["operation"] as? String, let payload = value["payload"] as? [String: Any] else {
            throw PetModelError.invalid("provider_directory_request")
        }
        switch operation {
        case "list":
            guard Set(payload.keys) == ["after_scope_id"],
                  payload["after_scope_id"] is NSNull || (payload["after_scope_id"] as? String).map(PetProviderContext.isUUID) == true else {
                throw PetModelError.invalid("provider_directory_cursor")
            }
        case "disconnect":
            guard Set(payload.keys) == ["target"], let target = payload["target"] as? [String: Any] else {
                throw PetModelError.invalid("provider_directory_target")
            }
            _ = try PetProviderContext(provider: .claude, target: target)
        default: throw PetModelError.invalid("provider_directory_operation")
        }
        return operation
    }

    static func response(request: [String: Any], service: String, result: [String: Any]) throws -> Data {
        try StrictJSONTransport.data(forJSONObject: ["schema_version": schema, "kind": "response",
            "request_id": request["request_id"]!, "operation": request["operation"]!,
            "service_incarnation": service, "result": result])
    }

    static func decode(_ data: Data, matching request: [String: Any]) throws -> (service: String, result: [String: Any]) {
        let value = try StrictJSONTransport.object(from: data)
        guard Set(value.keys) == ["schema_version", "kind", "request_id", "operation", "service_incarnation", "result"],
              value["schema_version"] as? String == schema, value["kind"] as? String == "response",
              value["request_id"] as? String == request["request_id"] as? String,
              value["operation"] as? String == request["operation"] as? String,
              let service = value["service_incarnation"] as? String, PetProviderContext.isUUID(service),
              let result = value["result"] as? [String: Any] else {
            throw PetModelError.invalid("provider_directory_response")
        }
        return (service, result)
    }
}
