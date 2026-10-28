import CoordinatorSwift
import CoreFoundation
import Foundation

/// Transport-free syntax and response-correlation checks for the new product
/// envelopes. This codec never authenticates a peer/capability, verifies an FD
/// or challenge, enrolls, renews, dispatches, or creates an authority ticket.
/// A parsed envelope MUST still pass private transport authentication, current
/// registry authority/fence checks, and its named provider DTO validator.
/// Legacy v1 payloads are never promoted into these product versions.
public final class ClaudeProductWireCodec: Sendable {
    public enum Contract: String, Sendable, CaseIterable {
        case owner = "blabee.claude-owner.v1"
        case session = "blabee.claude-session.v3"
        case pet = "blabee.pet-provider.v1"
    }
    public enum Kind: String, Sendable { case request, response }
    public enum Provider: String, Sendable { case claude, codex }
    public enum WireError: Error, Sendable, Equatable {
        case malformedJSON, unsupportedVersion, invalidEnvelope
        case secretReflection, correlationMismatch, missingConnectionContext
    }

    /// These public references are supplied by the caller's already verified
    /// connection. Constructing this value is NOT proof of peer identity.
    public struct ExpectedConnection: Sendable {
        public let serviceIncarnation: UUID
        public let ownerConnectionID: UUID?
        public init(serviceIncarnation: UUID, ownerConnectionID: UUID? = nil) {
            self.serviceIncarnation = serviceIncarnation
            self.ownerConnectionID = ownerConnectionID
        }
    }

    /// Immutable transport data, not an authorization proof. The canonical JSON
    /// may contain short-lived delivery references and must not be logged/stored.
    public struct Envelope: Sendable {
        public let contract: Contract
        public let kind: Kind
        public let provider: Provider
        public let requestID: UUID
        public let role: String
        public let operation: String
        public let canonicalJSON: Data
        /// True means the named opaque DTO has NOT received inner validation.
        /// False still says nothing about authentication or execution authority.
        public let requiresInnerValidation: Bool
        fileprivate init(contract: Contract, kind: Kind, provider: Provider, requestID: UUID,
                         role: String, operation: String, canonicalJSON: Data, requiresInnerValidation: Bool) {
            self.contract = contract
            self.kind = kind
            self.provider = provider
            self.requestID = requestID
            self.role = role
            self.operation = operation
            self.canonicalJSON = canonicalJSON
            self.requiresInnerValidation = requiresInnerValidation
        }
    }

    public static let maximumMessageBytes = 256 * 1024
    public static let maximumDepth = 32
    private let credentialCorpus: RuntimeSecretCorpus

    /// Supply the process's known long-lived private capabilities, including
    /// owner/Hook/bridge/UI credentials. Values never observed by this corpus
    /// cannot be discovered by syntax checking. Do not populate it by trusting
    /// arbitrary input, or confuse permitted transient references with grants.
    /// This codec does not register or change the supplied corpus.
    public init(credentialCorpus: RuntimeSecretCorpus) {
        self.credentialCorpus = credentialCorpus
    }

    /// Structural inspection ONLY, including for uncorrelated response fixtures.
    /// Consumers must use decodeResponse(_:matching:connection:) for a reply.
    public func inspectEnvelope(_ data: Data) throws -> Envelope {
        let value = try Self.parse(data)
        guard let version = value["schema_version"] as? String,
              let contract = Contract(rawValue: version) else { throw WireError.unsupportedVersion }
        guard let rawKind = value["kind"] as? String, let kind = Kind(rawValue: rawKind),
              let rawProvider = value["provider"] as? String, let provider = Provider(rawValue: rawProvider),
              let role = value["role"] as? String, let operation = value["operation"] as? String else {
            throw WireError.invalidEnvelope
        }
        let rule = try Self.envelopeRule(contract: contract, kind: kind, provider: provider,
                                         role: role, operation: operation, value: value)
        try Self.check(rule, value)
        try inspectSecrets(value)
        if contract == .pet && ["select", "dismiss_interaction"].contains(operation) {
            let payload: [String: Any]
            if kind == .request {
                payload = try Self.object(value["payload"])
            } else if Self.boolean(value["ok"]) == true {
                payload = try Self.object(try Self.object(value["result"])[operation == "select" ? "selection" : "dismissal"])
            } else {
                payload = [:]
            }
            if let binding = payload["binding"] {
                do { _ = try CoordinatorBinding(jsonObject: Self.object(binding)) }
                catch { throw WireError.invalidEnvelope }
            }
        }
        guard let requestID = UUID(uuidString: value["request_id"] as? String ?? "") else {
            throw WireError.invalidEnvelope
        }
        let hasOpaque = (contract == .session && operation == "proposal.emit" && kind == .request)
            || (contract == .session && operation == "selection.claim" && kind == .response && Self.boolean(value["ok"]) == true)
            || (contract == .pet && kind == .response && Self.boolean(value["ok"]) == true
                && (operation == "snapshot" || (provider == .codex && operation == "select")))
        return Envelope(contract: contract, kind: kind, provider: provider, requestID: requestID,
                        role: role, operation: operation,
                        canonicalJSON: try StrictJSONTransport.data(forJSONObject: value),
                        requiresInnerValidation: hasOpaque)
    }

    public func decodeRequest(_ data: Data) throws -> Envelope {
        let envelope = try inspectEnvelope(data)
        guard envelope.kind == .request else { throw WireError.invalidEnvelope }
        return envelope
    }

    /// Checks every common correlation field, the complete authority/target,
    /// owner connection references, and operation-specific returned bindings.
    /// ExpectedConnection itself is a caller-supplied reference, NOT evidence
    /// that CP-02 peer/challenge/pipe or credential authentication has occurred.
    public func decodeResponse(_ data: Data, matching request: Envelope,
                               connection: ExpectedConnection) throws -> Envelope {
        let response = try inspectEnvelope(data)
        guard request.kind == .request, response.kind == .response,
              request.contract == response.contract, request.provider == response.provider,
              request.requestID == response.requestID, request.role == response.role,
              request.operation == response.operation else { throw WireError.correlationMismatch }
        let original = try Self.parse(request.canonicalJSON)
        let reply = try Self.parse(response.canonicalJSON)
        let payload = try Self.object(original["payload"])
        let expected: [String: Any]
        if request.contract == .pet {
            expected = try Self.object(original["target"])
            try Self.requireEqual(original["target"], reply["target"])
        } else if request.contract == .owner && ["enroll", "enroll_observed"].contains(request.operation) {
            expected = payload
        } else {
            expected = try Self.object(original["authority"])
            try Self.requireEqual(original["authority"], reply["authority"])
        }
        guard expected["service_incarnation"] as? String == connection.serviceIncarnation.uuidString.lowercased() else {
            throw WireError.correlationMismatch
        }
        if request.contract != .pet {
            guard let owner = connection.ownerConnectionID else { throw WireError.missingConnectionContext }
            guard expected["owner_connection_id"] as? String == owner.uuidString.lowercased() else {
                throw WireError.correlationMismatch
            }
        }
        if Self.boolean(reply["ok"]) == true {
            let result = try Self.object(reply["result"])
            if request.contract == .owner && ["enroll", "enroll_observed"].contains(request.operation) {
                let issued = try Self.object(reply["authority"])
                for field in ["service_incarnation", "owner_connection_id"] {
                    try Self.requireEqual(expected[field], issued[field])
                }
                if request.operation == "enroll_observed" {
                    try Self.requireEqual(payload["native_session_id"], issued["native_session_id"])
                }
                try Self.requireEqual(payload["grant_pipe_id"], result["grant_pipe_id"])
            }
            if request.contract == .owner && request.operation == "renew" {
                try Self.requireEqual(payload["renewal_sequence"], try Self.object(result["lease"])["renewal_sequence"])
            }
            if request.contract == .session && ["selection.claim", "selection.complete"].contains(request.operation) {
                try Self.requireEqual(payload["selection_id"], result["selection_id"])
            }
            if request.contract == .session, request.operation == "hook", let waiter = result["waiter"] as? [String: Any] {
                guard payload["event"] as? String == "Stop", result["observation_status"] as? String == "accepted",
                      let background = payload["background_task_ids"] as? [String], background.isEmpty else {
                    throw WireError.correlationMismatch
                }
                try Self.requireEqual(payload["prompt_id"], waiter["prompt_id"])
                try Self.requireEqual(result["boundary_id"], waiter["boundary_id"])
            }
            if request.contract == .pet && request.operation == "select" {
                try Self.requireEqual(payload, result["selection"])
            }
            if request.contract == .pet && request.operation == "dismiss_interaction" {
                try Self.requireEqual(payload, result["dismissal"])
            }
        }
        return response
    }

    /// No emission path bypasses structural, correlation, or known-value checks.
    public func encodeResponse(_ object: [String: Any], matching request: Envelope,
                               connection: ExpectedConnection) throws -> Data {
        let data: Data
        do { data = try StrictJSONTransport.data(forJSONObject: object) }
        catch { throw WireError.malformedJSON }
        return try decodeResponse(data, matching: request, connection: connection).canonicalJSON
    }

    private func inspectSecrets(_ value: Any) throws {
        if let text = value as? String {
            if credentialCorpus.containsKnownSecret(in: Data(text.utf8)) { throw WireError.secretReflection }
        } else if let object = value as? [String: Any] {
            for (key, child) in object {
                // RuntimeSecretCorpus's object convenience does not visit keys
                // or bare array strings. Both must be checked here as well.
                if credentialCorpus.containsKnownSecret(in: Data(key.utf8)) { throw WireError.secretReflection }
                try inspectSecrets(child)
            }
        } else if let array = value as? [Any] {
            for child in array { try inspectSecrets(child) }
        }
    }

    private static func parse(_ data: Data) throws -> [String: Any] {
        do {
            return try StrictJSONTransport.object(from: data, limits: StrictJSONLimits(
                maximumBytes: maximumMessageBytes, maximumDepth: maximumDepth))
        } catch { throw WireError.malformedJSON }
    }

    private static func object(_ value: Any?) throws -> [String: Any] {
        guard let value = value as? [String: Any] else { throw WireError.invalidEnvelope }
        return value
    }

    private static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    private static func requireEqual(_ lhs: Any?, _ rhs: Any?) throws {
        guard let lhs, let rhs else { throw WireError.correlationMismatch }
        // Array wrapping admits scalar values while keeping exact canonical
        // bytes (including NFC differences) instead of Swift String equivalence.
        guard try StrictJSONTransport.data(forJSONObject: [lhs])
            == StrictJSONTransport.data(forJSONObject: [rhs]) else { throw WireError.correlationMismatch }
    }

    private indirect enum Rule: Sendable {
        case object([String: Rule], optional: [String: Rule])
        case array(Rule, maximum: Int)
        case string(minimum: Int, maximum: Int, pattern: String?)
        case literal(String), flag(Bool), choices([String]), oneOf([Rule])
        case uuid, uint64(positive: Bool), revision, null, opaqueObject
    }
    private static let end = "(?![\\s\\S])"
    private static let identifier = Rule.string(minimum: 1, maximum: 512, pattern: nil)
    private static let nonce = Rule.string(minimum: 64, maximum: 64, pattern: "^[0-9a-f]{64}" + end)
    private static let cwd = Rule.string(minimum: 1, maximum: 4096, pattern: "^/[^\\u0000]*" + end)
    private static let channel = Rule.string(minimum: 1, maximum: 256, pattern: "^[A-Za-z0-9][A-Za-z0-9:._-]*" + end)
    private static let authorityKeys = [
        "scope_id", "native_session_id", "session_incarnation", "service_incarnation", "owner_connection_id", "authority_epoch",
    ]
    private static let bindingKeys = [
        "project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id",
        "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id",
    ]
    private static let reservedKeys: Set<String> = [
        "authtoken", "hooktoken", "bridgetoken", "selectortoken", "selectiontoken", "ownertoken", "controltoken",
        "capability", "capabilities", "credential", "credentials", "ownerhandle", "authorizationticket", "ticket",
        "continuationtoken", "correlationtoken", "rawcontinuationtoken", "privatekey", "nonce", "deliverytoken",
    ]
    private static let authority = closed(Dictionary(uniqueKeysWithValues: authorityKeys.map { ($0, Rule.uuid) }))
    private static let binding = closed(Dictionary(uniqueKeysWithValues: bindingKeys.map { ($0, identifier) })
        .merging(["boundary_sequence": .revision]) { _, last in last })
    private static let error = closed(["code": .choices([
        "invalid_request", "unsupported_version", "unauthorized", "forbidden", "stale_authority",
        "binding_mismatch", "expired", "revoked", "capacity", "unavailable", "unknown_result",
    ])])
    private static let probeResult = closed([
        "probe_id": .uuid, "expires_at_nanoseconds": .uint64(positive: false), "status": .literal("pending"),
    ])
    private static let waiter = closed([
        "generation": .uuid, "prompt_id": .uuid, "boundary_id": .uuid,
        "expires_at_nanoseconds": .uint64(positive: false),
    ])
    private static let selectionEvent = closed([
        "kind": .literal("selection"), "selection_id": .uuid, "delivery_token": nonce,
        "delivery_sequence": .uint64(positive: true), "expires_at_nanoseconds": .uint64(positive: false),
    ])

    private static func closed(_ fields: [String: Rule], optional: [String: Rule] = [:]) -> Rule {
        .object(fields, optional: optional)
    }
    private static func dto(_ version: String) -> Rule {
        closed(["schema_version": .literal(version), "value": .opaqueObject])
    }
    private static func lease(initial: Bool = false, positive: Bool = false) -> Rule {
        closed(["deadline_nanoseconds": .uint64(positive: false),
                "renewal_sequence": initial ? .literal("0") : .uint64(positive: positive)])
    }

    private static func envelopeRule(contract: Contract, kind: Kind, provider: Provider,
                                     role: String, operation: String, value: [String: Any]) throws -> Rule {
        var fields: [String: Rule] = [
            "schema_version": .literal(contract.rawValue), "kind": .literal(kind.rawValue), "request_id": .uuid,
            "provider": .literal(provider.rawValue), "role": .literal(role), "operation": .literal(operation),
        ]
        let body: (request: Rule, result: Rule)
        let ok: Bool
        if kind == .response {
            guard let value = boolean(value["ok"]) else { throw WireError.invalidEnvelope }
            ok = value
            fields["ok"] = .flag(ok)
        } else { ok = false }

        switch contract {
        case .owner:
            guard provider == .claude, role == "owner" else { throw WireError.invalidEnvelope }
            if !["enroll", "enroll_observed"].contains(operation) || (kind == .response && ok) {
                fields["authority"] = authority
            }
            switch operation {
            case "enroll", "enroll_observed":
                var enrollment: [String: Rule] = [
                    "service_incarnation": .uuid, "owner_connection_id": .uuid, "challenge_id": .uuid, "grant_pipe_id": .uuid,
                    "cwd": cwd, "channel_source": channel,
                ]
                if operation == "enroll_observed" {
                    enrollment["native_session_id"] = .uuid
                    enrollment["source"] = .choices(["startup", "resume", "fork"])
                }
                body = (closed(enrollment), closed(["core_session_id": identifier, "lease": lease(initial: true),
                            "grant_delivery": .literal("private_pipe"), "grant_pipe_id": .uuid]))
            case "renew":
                body = (closed(["renewal_sequence": .uint64(positive: true)]), closed(["lease": lease(positive: true)]))
            case "end":
                body = (closed(["reason": .choices(["owner_disconnected", "child_exited", "session_ended", "user_disconnected", "service_replaced"])]),
                        closed(["ended": .flag(true)]))
            default: throw WireError.invalidEnvelope
            }
        case .session:
            guard provider == .claude else { throw WireError.invalidEnvelope }
            fields["authority"] = authority
            if operation == "hook" {
                guard role == "hook" else { throw WireError.invalidEnvelope }
                body = (hookRule, closed(["observed": .flag(true), "boundary_id": .oneOf([.uuid, .null]),
                                         "observation_status": .choices(["accepted", "new_prompt_required", "invalidated"]),
                                         "waiter": .oneOf([.null, waiter])]))
            } else if ["hook.poll", "hook.cancel"].contains(operation) {
                guard role == "hook" else { throw WireError.invalidEnvelope }
                let request = closed(["native_session_id": .uuid, "cwd": cwd,
                    "prompt_id": .uuid, "waiter_generation": .uuid])
                body = (request, operation == "hook.cancel"
                    ? .oneOf([closed(["cancelled": .flag(true)]), closed(["cancelled": .flag(false)])])
                    : .oneOf([
                        closed(["status": .choices(["waiting", "closed"]), "event": .null]),
                        closed(["status": .literal("delivered"), "event": selectionEvent]),
                    ]))
            } else {
                guard role == "bridge" else { throw WireError.invalidEnvelope }
                body = try bridgeRule(operation)
            }
        case .pet:
            guard role == "selector" else { throw WireError.invalidEnvelope }
            var target: [String: Rule] = [
                "scope_id": provider == .claude ? .uuid : identifier, "service_incarnation": .uuid,
                "session_incarnation": .uuid, "ui_generation": .uint64(positive: false),
            ]
            if provider == .claude { target["authority_epoch"] = .uuid }
            fields["target"] = closed(target)
            let selection = closed(["packet_id": identifier, "revision": .revision, "option_id": identifier,
                                    "selection_id": provider == .claude ? .uuid : identifier, "binding": binding])
            switch operation {
            case "snapshot":
                body = (closed([:]), closed(["projection": dto("blabee.pet.\(provider.rawValue).v1")]))
            case "select":
                body = (selection, provider == .claude
                    ? closed(["selection": selection, "status": .literal("awaiting_claude_claim")])
                    : closed(["selection": selection, "receipt": dto("blabee.pet.codex-receipt.v1")]))
            case "dismiss_interaction":
                guard provider == .claude else { throw WireError.invalidEnvelope }
                let dismissal = closed(["binding": binding, "interaction_id": identifier,
                    "packet_id": identifier, "revision": .revision])
                body = (dismissal, closed(["dismissal": dismissal, "dismissed": .flag(true)]))
            case "readiness.begin":
                guard provider == .claude else { throw WireError.invalidEnvelope }
                body = (closed([:]), probeResult)
            default: throw WireError.invalidEnvelope
            }
        }
        if kind == .request { fields["payload"] = body.request }
        else { fields[ok ? "result" : "error"] = ok ? body.result : error }
        return closed(fields)
    }

    private static var hookRule: Rule {
        let base: [String: Rule] = ["native_session_id": .uuid, "cwd": cwd]
        func event(_ name: String, _ extra: [String: Rule] = [:], optional: [String: Rule] = [:]) -> Rule {
            closed(base.merging(["event": .literal(name)]) { _, last in last }
                .merging(extra) { _, last in last }, optional: optional)
        }
        return .oneOf([
            event("SessionStart", ["source": .literal("startup")]),
            event("SessionStart", ["source": .literal("compact")], optional: ["prompt_id": .uuid]),
            event("UserPromptSubmit", ["prompt_id": .uuid, "prompt_sha256": nonce]),
            event("Stop", ["prompt_id": .uuid], optional: ["background_task_ids": .array(identifier, maximum: 256)]),
            event("StopFailure", ["failure_code": .choices(["api_error", "interrupted", "unknown"])], optional: ["prompt_id": .uuid]),
            event("SessionEnd"),
            event("ObservationUnavailable", ["reason": .choices(["invalid_prompt_id", "invalid_prompt_text", "unknown_event", "unsupported_source"])]),
        ])
    }

    private static func bridgeRule(_ operation: String) throws -> (request: Rule, result: Rule) {
        let bridge: [String: Rule] = ["bridge_id": .uuid]
        func request(_ extra: [String: Rule] = [:]) -> Rule { closed(bridge.merging(extra) { _, last in last }) }
        switch operation {
        case "bridge.open": return (closed([:]), closed(bridge))
        case "bridge.poll": return (request(), closed(["event": .null]))
        case "bridge.close": return (request(), closed(["closed": .flag(true)]))
        case "readiness.begin": return (request(), closed([
            "probe_id": .uuid, "nonce": nonce, "expires_at_nanoseconds": .uint64(positive: false),
            "status": .literal("pending"),
        ]))
        case "readiness.ack":
            return (request(["probe_id": .uuid, "nonce": nonce]), closed(["acknowledged": .flag(true)]))
        case "proposal.emit":
            return (request(["boundary_id": .uuid, "proposal": dto("blabee.claude-proposal.v1")]),
                    closed(["packet_id": identifier, "revision": .revision]))
        case "selection.claim":
            return (request(["selection_id": .uuid, "delivery_token": nonce]),
                    closed(["selection_id": .uuid, "boundary_id": .uuid, "prompt_id": .uuid, "action": dto("blabee.claude-action.v1")]))
        case "selection.complete":
            return (request(["selection_id": .uuid, "outcome": .choices(["completed", "failed"]),
                             "note": .string(minimum: 1, maximum: 4096, pattern: nil)]),
                    closed(["selection_id": .uuid, "recorded": .flag(true), "reported_by": .literal("claude")]))
        default: throw WireError.invalidEnvelope
        }
    }

    private static func check(_ rule: Rule, _ value: Any) throws {
        switch rule {
        case let .object(fields, optional):
            let object = try object(value)
            guard Set(fields.keys).isSubset(of: Set(object.keys)),
                  Set(object.keys).isSubset(of: Set(fields.keys).union(optional.keys)) else { throw WireError.invalidEnvelope }
            for (key, child) in object {
                guard let rule = fields[key] ?? optional[key] else { throw WireError.invalidEnvelope }
                try check(rule, child)
            }
        case let .array(rule, maximum):
            guard let values = value as? [Any], values.count <= maximum else { throw WireError.invalidEnvelope }
            for value in values { try check(rule, value) }
        case let .string(minimum, maximum, pattern):
            guard let text = value as? String, (minimum...maximum).contains(text.unicodeScalars.count) else {
                throw WireError.invalidEnvelope
            }
            if let pattern, text.range(of: pattern, options: .regularExpression) == nil { throw WireError.invalidEnvelope }
        case let .literal(expected):
            guard let text = value as? String, text.utf8.elementsEqual(expected.utf8) else { throw WireError.invalidEnvelope }
        case let .flag(expected):
            guard boolean(value) == expected else { throw WireError.invalidEnvelope }
        case let .choices(expected):
            guard let text = value as? String, expected.contains(text) else { throw WireError.invalidEnvelope }
        case let .oneOf(choices):
            var matches = 0
            for choice in choices { if (try? check(choice, value)) != nil { matches += 1 } }
            guard matches == 1 else { throw WireError.invalidEnvelope }
        case .uuid:
            try check(.string(minimum: 36, maximum: 36,
                              pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" + end), value)
        case let .uint64(positive):
            guard let text = value as? String, !text.isEmpty, text.utf8.count <= 20,
                  text.utf8.allSatisfy({ (48...57).contains($0) }),
                  text == "0" || text.first != "0", let number = UInt64(text),
                  !positive || number > 0 else { throw WireError.invalidEnvelope }
        case .revision:
            guard let number = ExactJSONInteger.int64(value, minimum: 1), number <= 9_007_199_254_740_991 else {
                throw WireError.invalidEnvelope
            }
        case .null:
            guard value is NSNull else { throw WireError.invalidEnvelope }
        case .opaqueObject:
            _ = try object(value)
            try checkOpaque(value)
        }
    }

    /// Only explicitly versioned opaque provider DTOs permit unknown keys.
    /// They remain unvalidated inner data and cannot supply routing authority.
    private static func checkOpaque(_ value: Any) throws {
        if let object = value as? [String: Any] {
            guard object.count <= 256 else { throw WireError.invalidEnvelope }
            for (key, child) in object {
                // Match the schema's ASCII case/separator pattern exactly;
                // Unicode case folding (for example Kelvin sign -> k) would
                // create a different reserved-key language on Swift and JS.
                let normalized = String(decoding: key.utf8.filter { $0 != 45 && $0 != 95 }
                    .map { (65...90).contains($0) ? $0 + 32 : $0 }, as: UTF8.self)
                guard !reservedKeys.contains(normalized) else { throw WireError.invalidEnvelope }
                try checkOpaque(child)
            }
        } else if let values = value as? [Any] {
            guard values.count <= 256 else { throw WireError.invalidEnvelope }
            for value in values { try checkOpaque(value) }
        } else if let text = value as? String {
            guard text.unicodeScalars.count <= 65_536 else { throw WireError.invalidEnvelope }
        } else if value is NSNull || boolean(value) != nil {
            return
        } else if value is NSNumber {
            guard let number = ExactJSONInteger.int64(value, minimum: -9_007_199_254_740_991),
                  number <= 9_007_199_254_740_991 else {
                throw WireError.invalidEnvelope
            }
        } else { throw WireError.invalidEnvelope }
    }
}
