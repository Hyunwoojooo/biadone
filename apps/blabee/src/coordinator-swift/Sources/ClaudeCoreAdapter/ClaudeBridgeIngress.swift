import CoordinatorSwift
import Foundation

/// Trusted configuration, loaded before creating a scope's isolated journal.
/// Credentials are role-specific and are never inferred from request content.
public struct ClaudeBridgeScope: Sendable {
    public let scopeID: String
    public let projectID: String
    public let sessionID: String
    public let bridgeToken: String
    public let selectionToken: String
    public let expiresAt: Date

    public init(scopeID: String, projectID: String, sessionID: String,
                bridgeToken: String, selectionToken: String, expiresAt: Date) throws {
        guard let canonical = UUID(uuidString: scopeID)?.uuidString.lowercased(), scopeID == canonical,
              Self.validIdentifier(projectID), Self.validIdentifier(sessionID),
              Self.validToken(bridgeToken), Self.validToken(selectionToken),
              expiresAt.timeIntervalSince1970.isFinite else {
            throw CoordinatorError("claude_bridge_configuration_invalid")
        }
        self.scopeID = scopeID
        self.projectID = projectID
        self.sessionID = sessionID
        self.bridgeToken = bridgeToken
        self.selectionToken = selectionToken
        self.expiresAt = expiresAt
    }

    fileprivate static func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 256
            && value.utf8.elementsEqual(value.precomposedStringWithCanonicalMapping.utf8)
            && !value.unicodeScalars.contains { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }
    }

    fileprivate static func validToken(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

/// Authenticated provider boundary for the existing Coordinator transport.
/// Every configured scope must own a distinct adapter and isolated journal.
/// Authentication does not assert native Hook, Channel, readiness, or execution
/// evidence; those observations remain the provider bridge's responsibility.
public final class ClaudeBridgeIngress: Sendable {
    public static let schemaVersion = "blabee.claude-bridge.v1"
    public static let maximumPayloadBytes = 128 * 1024
    /// Synchronous, exactly-once metadata prepare/core/finalize executor.
    /// The concrete journal separately owns the final authority commit gate.
    public typealias ProductCoreMutation = @Sendable (UUID, CoordinatorBinding?, () throws -> Data) throws -> Data

    private let scopes: [String: ClaudeBridgeScope]
    private let adapters: [String: ClaudeCoreAdapter]
    private let secretCorpus: RuntimeSecretCorpus
    private let now: @Sendable () -> Date
    private let productAuthority: ClaudeSessionAuthority?
    private let productMutation: ProductCoreMutation?

    /// Run this before opening/creating any scope storage. A malformed or
    /// duplicate configuration must not issue credentials or create databases.
    public static func validateScopes(_ scopes: [ClaudeBridgeScope], now: Date = Date()) throws {
        guard scopes.count <= 16, now.timeIntervalSince1970.isFinite else {
            throw CoordinatorError("claude_bridge_configuration_invalid")
        }
        var identifiers: Set<String> = []
        var credentials: Set<String> = []
        for scope in scopes {
            guard let canonical = UUID(uuidString: scope.scopeID)?.uuidString.lowercased(),
                  scope.scopeID == canonical, identifiers.insert(canonical).inserted, scope.expiresAt > now,
                  credentials.insert(scope.bridgeToken).inserted,
                  credentials.insert(scope.selectionToken).inserted else {
                throw CoordinatorError("claude_bridge_configuration_invalid")
            }
        }
        for scope in scopes {
            for identifier in [scope.scopeID, scope.projectID, scope.sessionID] {
                guard !credentials.contains(where: { identifier.contains($0) }) else {
                    throw CoordinatorError("claude_bridge_configuration_invalid")
                }
            }
        }
    }

    public init(scopes: [ClaudeBridgeScope], adapters: [String: ClaudeCoreAdapter],
                secretCorpus: RuntimeSecretCorpus,
                now: @escaping @Sendable () -> Date = { Date() }) throws {
        try Self.validateScopes(scopes, now: now())
        guard Set(adapters.keys) == Set(scopes.map(\.scopeID)),
              Set(adapters.values.map(ObjectIdentifier.init)).count == adapters.count else {
            throw CoordinatorError("claude_bridge_configuration_invalid")
        }
        self.scopes = Dictionary(uniqueKeysWithValues: scopes.map { ($0.scopeID, $0) })
        self.adapters = adapters
        self.secretCorpus = secretCorpus
        self.now = now
        self.productAuthority = nil
        self.productMutation = nil
        // No caller-supplied guess is ever registered into this global corpus.
        for scope in scopes {
            secretCorpus.register(scope.bridgeToken)
            secretCorpus.register(scope.selectionToken)
        }
    }

    /// Product-only construction creates its adapter with the same authority's
    /// admission journal. The registry MUST configure `journal` with that
    /// authority's final appendCommitGate; preparation is outside its lock.
    public init(productConfiguration: ClaudeProductNativeConfiguration, authority: ClaudeSessionAuthority,
                journal: any CoordinatorSemanticJournalPort, secretCorpus: RuntimeSecretCorpus,
                clock: any CoordinatorContinuousClock,
                wallNow: @escaping @Sendable () -> Date = { Date() },
                withCoreMutation: @escaping ProductCoreMutation) throws {
        guard authority.identity == productConfiguration.identity else {
            throw CoordinatorError("claude_bridge_configuration_invalid")
        }
        do { _ = try authority.authorize(identity: productConfiguration.identity) }
        catch { throw CoordinatorError("claude_bridge_configuration_invalid") }
        let scope = try productConfiguration.bridgeScope()
        // Descriptor shape/credential uniqueness only. Fixed wall TTL remains
        // exclusive to the legacy constructor and legacy handle(payload:).
        try Self.validateScopes([scope], now: Date(timeIntervalSince1970: 0))
        self.scopes = [scope.scopeID: scope]
        self.adapters = [scope.scopeID: try ClaudeCoreAdapter(
            journal: ClaudeProductAuthorityJournal(journal: journal, authority: authority),
            clock: clock, wallNow: wallNow)]
        self.secretCorpus = secretCorpus
        self.now = wallNow
        self.productAuthority = authority
        self.productMutation = withCoreMutation
        secretCorpus.register(scope.bridgeToken)
        secretCorpus.register(scope.selectionToken)
    }

    public func handle(payload: Data) throws -> Data {
        guard productAuthority == nil else { throw Self.invalidRequest() }
        guard payload.count <= Self.maximumPayloadBytes else { throw Self.invalidRequest() }
        let envelope: [String: Any]
        do {
            envelope = try StrictJSONTransport.object(from: payload, limits: StrictJSONLimits(
                maximumBytes: Self.maximumPayloadBytes, maximumDepth: 24
            ))
        } catch { throw Self.invalidRequest() }
        guard Set(envelope.keys) == ["schema_version", "provider", "scope_id", "session_id", "role", "auth_token", "request"],
              envelope["schema_version"] as? String == Self.schemaVersion else { throw Self.invalidRequest() }

        // Authenticate before reporting role/operation errors. All invalid
        // scope/provider/session/token/expiry failures have one public code.
        let observedNow = now()
        guard envelope["provider"] as? String == "claude",
              let scopeID = envelope["scope_id"] as? String,
              let scope = scopes[scopeID], let adapter = adapters[scopeID],
              let sessionID = envelope["session_id"] as? String,
              Self.exact(sessionID, scope.sessionID),
              observedNow.timeIntervalSince1970.isFinite, scope.expiresAt > observedNow,
              let credential = envelope["auth_token"] as? String,
              ClaudeBridgeScope.validToken(credential) else { throw Self.unauthorized() }
        let isBridge = ContinuationTokenMaterial.constantTimeEqual(credential, scope.bridgeToken)
        let isSelector = ContinuationTokenMaterial.constantTimeEqual(credential, scope.selectionToken)
        guard isBridge || isSelector else { throw Self.unauthorized() }
        guard let role = envelope["role"] as? String,
              (role == "bridge" && isBridge) || (role == "selector" && isSelector) else {
            throw CoordinatorError("claude_bridge_forbidden")
        }
        guard let request = envelope["request"] as? [String: Any],
              request["schema_version"] as? String == ClaudeCoreAdapter.schemaVersion,
              let requestID = request["request_id"] as? String,
              requestID.utf8.count == 36, UUID(uuidString: requestID) != nil,
              let operation = request["operation"] as? String else { throw Self.invalidRequest() }
        let allowed: Set<String> = role == "bridge"
            ? ["activate", "claim", "complete", "invalidate", "snapshot"] : ["select", "snapshot", "pet.snapshot"]
        guard allowed.contains(operation) else { throw CoordinatorError("claude_bridge_forbidden") }
        if operation != "snapshot" && operation != "pet.snapshot" {
            guard let binding = request["binding"] as? [String: Any],
                  let project = binding["project_id"] as? String,
                  let session = binding["session_id"] as? String,
                  Self.exact(project, scope.projectID), Self.exact(session, scope.sessionID) else {
                throw Self.unauthorized()
            }
        }
        // Existing CoordinatorBinding has exactly nine fields, with no
        // correlation token. No secret-bearing binding exception is invented.
        try assertPublicBody(request)
        let adapterResponse = try StrictJSONTransport.object(from: adapter.respond(
            to: StrictJSONTransport.data(forJSONObject: request)
        ))
        guard adapterResponse["schema_version"] as? String == ClaudeCoreAdapter.schemaVersion,
              adapterResponse["request_id"] as? String == requestID,
              let ok = adapterResponse["ok"] as? Bool else { throw Self.invalidResponse() }
        var result: [String: Any] = [
            "schema_version": Self.schemaVersion, "provider": "claude", "scope_id": scope.scopeID,
            "session_id": scope.sessionID, "role": role, "request_id": requestID, "ok": ok,
        ]
        if ok {
            guard let body = adapterResponse["result"] as? [String: Any] else { throw Self.invalidResponse() }
            result["result"] = try projectResult(body, operation: operation, scope: scope)
        } else {
            guard let error = adapterResponse["error"] as? [String: Any],
                  Set(error.keys) == ["code"], let code = error["code"] as? String,
                  code.range(of: "^[a-z0-9_]{1,96}$", options: .regularExpression) != nil else {
                throw Self.invalidResponse()
            }
            result["error"] = ["code": code]
        }
        try assertPublicBody(result)
        let encoded = try StrictJSONTransport.data(forJSONObject: result)
        guard encoded.count <= Self.maximumPayloadBytes else {
            throw CoordinatorError("claude_bridge_response_too_large")
        }
        return encoded
    }

    /// Explicit product-to-core port, not a public v1 fallback. The complete
    /// six-field registration, role capability and core binding are checked
    /// again here before metadata or adapter work. Never renews the authority.
    public func handleProduct(request data: Data, identity: ClaudeSessionAuthority.Identity,
                              role: String, credential: String) throws -> Data {
        guard let authority = productAuthority, let execute = productMutation,
              identity == authority.identity,
              let scope = scopes[identity.scopeID.uuidString.lowercased()],
              let adapter = adapters[scope.scopeID], ClaudeBridgeScope.validToken(credential) else {
            throw Self.unauthorized()
        }
        let isBridge = ContinuationTokenMaterial.constantTimeEqual(credential, scope.bridgeToken)
        let isSelector = ContinuationTokenMaterial.constantTimeEqual(credential, scope.selectionToken)
        guard isBridge || isSelector else { throw Self.unauthorized() }
        guard (role == "bridge" && isBridge) || (role == "selector" && isSelector) else {
            throw CoordinatorError("claude_bridge_forbidden")
        }
        try Self.authorizeProduct(authority, identity: identity)
        let request: [String: Any]
        do {
            request = try StrictJSONTransport.object(from: data, limits: StrictJSONLimits(
                maximumBytes: Self.maximumPayloadBytes, maximumDepth: 24))
        } catch { throw Self.invalidRequest() }
        guard request["schema_version"] as? String == ClaudeCoreAdapter.schemaVersion,
              let requestID = request["request_id"] as? String, let id = UUID(uuidString: requestID),
              requestID == id.uuidString.lowercased(), let operation = request["operation"] as? String else {
            throw Self.invalidRequest()
        }
        let allowed: Set<String> = role == "bridge"
            ? ["activate", "claim", "complete", "invalidate", "snapshot"] : ["select", "snapshot", "pet.snapshot"]
        guard allowed.contains(operation) else { throw CoordinatorError("claude_bridge_forbidden") }
        let binding: CoordinatorBinding?
        if operation == "snapshot" || operation == "pet.snapshot" { binding = nil }
        else {
            guard let object = request["binding"] as? [String: Any],
                  let decoded = try? CoordinatorBinding(jsonObject: object),
                  Self.exact(decoded.projectID, scope.projectID), Self.exact(decoded.sessionID, scope.sessionID) else {
                throw Self.unauthorized()
            }
            binding = decoded
        }
        try assertPublicBody(request)
        // Preserve JSON failures for the executor: it can distinguish a safe
        // validation failure with an unchanged core checkpoint from an uncertain
        // partially committed failure that must quarantine the scope.
        let responseData = try execute(id, binding) { adapter.respond(to: data) }
        try Self.authorizeProduct(authority, identity: identity)
        let response = try StrictJSONTransport.object(from: responseData)
        guard response["schema_version"] as? String == ClaudeCoreAdapter.schemaVersion,
              response["request_id"] as? String == requestID,
              let ok = Self.strictBoolean(response["ok"]) else { throw Self.invalidResponse() }
        var projected: [String: Any] = ["schema_version": ClaudeCoreAdapter.schemaVersion,
            "request_id": requestID, "ok": ok]
        if ok {
            guard let body = response["result"] as? [String: Any] else { throw Self.invalidResponse() }
            projected["result"] = try projectResult(body, operation: operation, scope: scope)
        } else {
            guard let error = response["error"] as? [String: Any], Set(error.keys) == ["code"],
                  let code = error["code"] as? String,
                  code.range(of: "^[a-z0-9_]{1,96}$", options: .regularExpression) != nil else { throw Self.invalidResponse() }
            projected["error"] = ["code": code]
        }
        try assertPublicBody(projected)
        let encoded = try StrictJSONTransport.data(forJSONObject: projected)
        guard encoded.count <= Self.maximumPayloadBytes else { throw Self.invalidResponse() }
        return encoded
    }

    private static func authorizeProduct(_ authority: ClaudeSessionAuthority,
                                         identity: ClaudeSessionAuthority.Identity) throws {
        do { _ = try authority.authorize(identity: identity) }
        catch { throw unauthorized() }
    }

    /// In-process scheduling query; no new core/v1 wire operation or mutation.
    func productMillisecondsUntilNextDeadline(identity: ClaudeSessionAuthority.Identity) throws -> Int32? {
        guard let authority = productAuthority, authority.identity == identity,
              let adapter = adapters[identity.scopeID.uuidString.lowercased()] else { throw Self.unauthorized() }
        try Self.authorizeProduct(authority, identity: identity)
        return adapter.millisecondsUntilNextDeadline()
    }

    private func projectResult(_ result: [String: Any], operation: String, scope: ClaudeBridgeScope) throws -> [String: Any] {
        switch operation {
        case "activate":
            var value = try Self.pick(result, ["packet", "claude_proposal", "option_bindings"])
            value["packet"] = try publicPacket(result["packet"], scope: scope)
            value["option_bindings"] = try Self.publicOptionBindings(result["option_bindings"])
            return value
        case "snapshot", "pet.snapshot":
            guard let cards = result["cards"] as? [[String: Any]],
                  let outcomes = result["outcomes"] as? [[String: Any]] else { throw Self.invalidResponse() }
            let publicCards = try cards.map { card -> [String: Any] in
                var value = try Self.pick(card, ["binding", "packet", "claude_proposal", "option_bindings"])
                value["binding"] = try publicBinding(card["binding"], scope: scope)
                value["packet"] = try publicPacket(card["packet"], scope: scope)
                value["option_bindings"] = try Self.publicOptionBindings(card["option_bindings"])
                return value
            }
            let publicOutcomes = try outcomes.map { outcome -> [String: Any] in
                var value = try Self.pick(outcome, ["selection_id", "binding", "continuation_id", "status", "summary", "reported_by"])
                guard outcome["reported_by"] as? String == "model" else { throw Self.invalidResponse() }
                value["binding"] = try publicBinding(outcome["binding"], scope: scope)
                return value
            }
            guard let history = result["history"] as? [String: Any] else { throw Self.invalidResponse() }
            var projection: [String: Any] = ["cards": publicCards, "outcomes": publicOutcomes,
                "history": try Self.pick(history, ["total_outcomes", "omitted_outcomes"])]
            if operation == "pet.snapshot" {
                projection["routing"] = try publicRouting(result["routing"], cards: publicCards, scope: scope)
            }
            return projection
        case "select":
            var value = try Self.pick(result, ["selection_id", "continuation_id", "packet_id", "revision", "option_id"])
            value["delivery"] = "awaiting_claude_claim"
            return value
        case "claim":
            var value = try Self.pick(result, ["selection_id", "continuation_id", "packet_id", "revision", "option_id", "action_id"])
            guard let option = result["option"] as? [String: Any] else { throw Self.invalidResponse() }
            value["action"] = try Self.exactUserObject(option, ["id", "title", "description", "task", "done_when", "constraints"])
            value["delivery"] = "claimed"
            return value
        case "complete":
            guard result["recorded"] as? Bool == true, result["reported_by"] as? String == "model" else {
                throw Self.invalidResponse()
            }
            return try Self.pick(result, ["recorded", "reported_by", "selection_id"])
        case "invalidate":
            guard let status = result["status"] as? String,
                  ["closed_unclaimed", "revoked_unclaimed_selection", "preserved_claimed"].contains(status) else {
                throw Self.invalidResponse()
            }
            return ["status": status]
        default: throw Self.invalidResponse()
        }
    }

    private func publicBinding(_ value: Any?, scope: ClaudeBridgeScope) throws -> [String: Any] {
        guard var object = value as? [String: Any] else { throw Self.invalidResponse() }
        // Only this typed engine metadata location may omit a correlation
        // field. Never remove/modify arbitrary text in a user's task or note.
        object.removeValue(forKey: "correlation_token")
        let binding = try CoordinatorBinding(jsonObject: object)
        guard Self.exact(binding.projectID, scope.projectID), Self.exact(binding.sessionID, scope.sessionID) else {
            throw Self.invalidResponse()
        }
        return binding.jsonObject
    }

    /// Pet alone needs routing timers and foreground authority. Keep the
    /// established bridge snapshot unchanged and join every public routing
    /// identity to exactly one card before exposing this selector projection.
    private func publicRouting(_ value: Any?, cards: [[String: Any]], scope: ClaudeBridgeScope) throws -> [String: Any] {
        let identityKeys: Set<String> = ["interaction_id", "packet_id", "revision", "project_id", "session_id",
            "source_turn_id", "source_prompt_id", "episode_id", "episode_root_prompt_id",
            "episode_baseline_checkpoint_id", "decision_boundary_id", "boundary_sequence"]
        func identity(_ object: [String: Any]) throws -> Data {
            let binding = try publicBinding(object, scope: scope)
            guard let interaction = object["interaction_id"] as? String, !interaction.isEmpty, interaction.utf8.count <= 512,
                  let packet = object["packet_id"] as? String, !packet.isEmpty, packet.utf8.count <= 512,
                  let revision = ExactJSONInteger.int64(object["revision"], minimum: 1) else { throw Self.invalidResponse() }
            var result = binding
            result["interaction_id"] = interaction
            result["packet_id"] = packet
            result["revision"] = revision
            return try StrictJSONTransport.data(forJSONObject: result)
        }
        guard let routing = value as? [String: Any],
              Set(routing.keys) == ["schema_version", "kind", "selection_enabled", "foreground", "pending", "in_flight_count"],
              routing["schema_version"] as? String == "1.0", routing["kind"] as? String == "blabee_routing_snapshot",
              let enabled = Self.strictBoolean(routing["selection_enabled"]),
              let pending = routing["pending"] as? [[String: Any]], pending.count <= 64,
              ExactJSONInteger.int64(routing["in_flight_count"], minimum: 0) != nil else { throw Self.invalidResponse() }
        let cardIdentities = try cards.map { card -> Data in
            guard let packet = card["packet"] as? [String: Any], let binding = card["binding"] as? [String: Any],
                  try CoordinatorBinding(jsonObject: binding) == CoordinatorBinding(jsonObject: packet) else {
                throw Self.invalidResponse()
            }
            return try identity(packet)
        }
        var pendingIdentities = Set<Data>(), marked: [Data] = []
        for item in pending {
            guard Set(item.keys) == identityKeys.union(["state", "foreground", "reminder_due", "milliseconds_until_expiry"]),
                  item["state"] as? String == "pending", let foreground = Self.strictBoolean(item["foreground"]),
                  Self.strictBoolean(item["reminder_due"]) != nil,
                  ExactJSONInteger.int64(item["milliseconds_until_expiry"], minimum: 0) != nil else { throw Self.invalidResponse() }
            let key = try identity(item)
            guard pendingIdentities.insert(key).inserted else { throw Self.invalidResponse() }
            if foreground { marked.append(key) }
        }
        guard Set(cardIdentities).count == cards.count, Set(cardIdentities) == pendingIdentities else { throw Self.invalidResponse() }
        if let foreground = routing["foreground"] as? [String: Any] {
            guard Set(foreground.keys) == identityKeys, enabled, marked.count == 1,
                  try identity(foreground) == marked[0] else { throw Self.invalidResponse() }
        } else {
            guard routing["foreground"] is NSNull, !enabled, marked.isEmpty else { throw Self.invalidResponse() }
        }
        return routing
    }

    private static func strictBoolean(_ value: Any?) -> Bool? {
        guard let value, CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() else { return nil }
        return value as? Bool
    }

    private func publicPacket(_ value: Any?, scope: ClaudeBridgeScope) throws -> [String: Any] {
        guard let object = value as? [String: Any] else { throw Self.invalidResponse() }
        var packet = try Self.pick(object, ["schema_version", "kind", "interaction_id", "packet_id", "revision",
            "valid_after_event_sequence", "sealed_at", "expires_at", "summary", "evidence", "risk", "checkpoint",
            "decision_layout", "choices"])
        packet.merge(try publicBinding(object, scope: scope)) { current, _ in current }
        guard let choices = object["choices"] as? [[String: Any]] else { throw Self.invalidResponse() }
        packet["choices"] = try choices.map { choice -> [String: Any] in
            var value = try Self.pick(choice, ["slot", "kind", "enabled", "disabled_reason", "option_id", "action_id"])
            guard let action = choice["action"] as? [String: Any] else { throw Self.invalidResponse() }
            value["action"] = try Self.exactUserObject(action, ["title", "objective", "constraints", "done_when"])
            return value
        }
        return packet
    }

    private func assertPublicBody(_ value: Any) throws {
        if let string = value as? String {
            guard !secretCorpus.containsKnownSecret(in: Data(string.utf8)) else {
                throw CoordinatorError("claude_bridge_secret_reflection")
            }
        } else if let values = value as? [Any] {
            for child in values { try assertPublicBody(child) }
        } else if let object = value as? [String: Any] {
            for (key, child) in object {
                guard !Self.secretKeys.contains(key) else {
                    throw CoordinatorError("claude_bridge_secret_reflection")
                }
                try assertPublicBody(key)
                try assertPublicBody(child)
            }
        }
    }

    private static let secretKeys: Set<String> = ["auth_token", "bridge_token", "selection_token", "correlation_token",
        "continuation_token", "raw_continuation_token", "delivery_token", "session_token"]
    private static func exact(_ left: String, _ right: String) -> Bool { left.utf8.elementsEqual(right.utf8) }
    private static func invalidRequest() -> CoordinatorError { CoordinatorError("claude_bridge_invalid_request") }
    private static func unauthorized() -> CoordinatorError { CoordinatorError("claude_bridge_unauthorized") }
    private static func invalidResponse() -> CoordinatorError { CoordinatorError("claude_bridge_response_invalid") }
    private static func exactUserObject(_ object: [String: Any], _ keys: Set<String>) throws -> [String: Any] {
        guard Set(object.keys) == keys else { throw invalidResponse() }
        return object
    }
    private static func publicOptionBindings(_ value: Any?) throws -> [[String: Any]] {
        guard let entries = value as? [[String: Any]] else { throw invalidResponse() }
        return try entries.map { try pick($0, ["claude_option_id", "option_id", "action_id"]) }
    }
    private static func pick(_ object: [String: Any], _ keys: Set<String>) throws -> [String: Any] {
        guard keys.isSubset(of: Set(object.keys)) else { throw invalidResponse() }
        return object.filter { keys.contains($0.key) }
    }
}
