import CoordinatorSwift
import CryptoKit
import Foundation

/// A fresh launcher-issued grant. The launcher must refuse to reopen a consumed
/// runtime directory; this controller never restores native authority from disk.
public struct ClaudeNativeGrant: Sendable {
    public let scope: ClaudeBridgeScope
    public let cwd: String
    public let hookToken: String
    public let controlToken: String

    public init(scope: ClaudeBridgeScope, cwd: String, hookToken: String, controlToken: String) throws {
        let credentials = [scope.bridgeToken, scope.selectionToken, hookToken, controlToken]
        var isDirectory: ObjCBool = false
        guard UUID(uuidString: scope.sessionID) != nil, scope.sessionID.utf8.count == 36,
              credentials.allSatisfy(Self.validToken), Set(credentials).count == 4,
              cwd.hasPrefix("/"), cwd.utf8.count <= 4096,
              !cwd.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              URL(fileURLWithPath: cwd).standardizedFileURL.resolvingSymlinksInPath().path.utf8.elementsEqual(cwd.utf8),
              FileManager.default.fileExists(atPath: cwd, isDirectory: &isDirectory), isDirectory.boolValue,
              !credentials.contains(where: { credential in
                  [cwd, scope.projectID, scope.sessionID, scope.scopeID].contains { $0.contains(credential) }
              }) else { throw CoordinatorError("claude_session_configuration_invalid") }
        self.scope = scope
        self.cwd = cwd
        self.hookToken = hookToken
        self.controlToken = controlToken
    }

    fileprivate static func validToken(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

/// Trusted registry configuration for a newly enrolled product session.
/// Native observations and immutable core bindings deliberately use different
/// session identifiers. Capabilities remain process-local/private-pipe values.
public struct ClaudeProductNativeConfiguration: Sendable {
    public let identity: ClaudeSessionAuthority.Identity
    public let coreProjectID: String
    public let coreSessionID: String
    public let canonicalCWD: String
    public let channelSource: String
    public let hookToken: String
    public let bridgeToken: String
    public let selectorToken: String

    public init(identity: ClaudeSessionAuthority.Identity, coreProjectID: String, coreSessionID: String,
                canonicalCWD: String, channelSource: String, hookToken: String,
                bridgeToken: String, selectorToken: String) throws {
        let tokens = [hookToken, bridgeToken, selectorToken]
        var directory: ObjCBool = false
        guard tokens.allSatisfy(ClaudeNativeGrant.validToken), Set(tokens).count == tokens.count,
              canonicalCWD.hasPrefix("/"), canonicalCWD.utf8.count <= 4096,
              !canonicalCWD.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              URL(fileURLWithPath: canonicalCWD).standardizedFileURL.resolvingSymlinksInPath().path == canonicalCWD,
              FileManager.default.fileExists(atPath: canonicalCWD, isDirectory: &directory), directory.boolValue,
              channelSource.utf8.count <= 256,
              channelSource.range(of: "^[A-Za-z0-9][A-Za-z0-9:._-]*(?![\\s\\S])", options: .regularExpression) != nil,
              !tokens.contains(where: { token in
                  [coreProjectID, coreSessionID, canonicalCWD, channelSource].contains { $0.contains(token) }
              }) else { throw CoordinatorError("claude_session_configuration_invalid") }
        self.identity = identity
        self.coreProjectID = coreProjectID
        self.coreSessionID = coreSessionID
        self.canonicalCWD = canonicalCWD
        self.channelSource = channelSource
        self.hookToken = hookToken
        self.bridgeToken = bridgeToken
        self.selectorToken = selectorToken
        _ = try bridgeScope()
    }

    /// This descriptor reuses projection/credential validation, not TTL policy.
    /// Product authentication never reads this legacy descriptor's expiresAt.
    func bridgeScope() throws -> ClaudeBridgeScope {
        try ClaudeBridgeScope(scopeID: identity.scopeID.uuidString.lowercased(), projectID: coreProjectID,
            sessionID: coreSessionID, bridgeToken: bridgeToken, selectionToken: selectorToken, expiresAt: .distantFuture)
    }
}

/// Native observations and transient Channel references over the shared core.
/// Task/selection/result truth remains in the core journal. No native execution
/// authority is reconstructed after failure or restart. Calls are serialized.
public final class ClaudeNativeSession: @unchecked Sendable {
    public static let schemaVersion = "blabee.claude-session.v1"
    public static let maximumPayloadBytes = 128 * 1024
    public static let heartbeatLifetime: TimeInterval = 5
    public static let readinessLifetime: TimeInterval = 300

    private struct Card {
        let packetID: String
        let revision: Int64
        let optionIDs: Set<String>
    }
    private struct Boundary {
        let binding: CoordinatorBinding
        var attemptedActivation = false
        var card: Card?
    }
    private enum PromptKind: Equatable {
        case ordinary
        case probe(String)
        case selection(String)
    }
    private struct Prompt {
        let digest: String
        let kind: PromptKind
    }
    private struct Probe {
        let id: String
        let nonce: String
        let bridgeID: String
        let expires: Date
        let expiresNanoseconds: UInt64?
        let content: String
        var delivered = false
        var nativePromptID: String?
    }
    private struct Delivery {
        let selectionID: String
        let binding: CoordinatorBinding
        let token: String
        let bridgeID: String
        let content: String
        let expiresNanoseconds: UInt64?
        var delivered = false
        var nativePromptID: String?
    }
    private struct RateWindow {
        var anchor: UInt64
        var count: UInt32
    }
    private enum BackgroundObservation {
        case unknown, idle, active(Int)
        var isIdle: Bool { if case .idle = self { return true }; return false }
        var name: String {
            switch self { case .unknown: return "unknown"; case .idle: return "idle"; case .active: return "active" }
        }
        var count: Int? {
            switch self { case .unknown: return nil; case .idle: return 0; case .active(let count): return count }
        }
    }

    private let scope: ClaudeBridgeScope
    private let cwd: String
    private let hookToken: String
    private let controlToken: String?
    private let nativeSessionID: String
    private let channelSource: String
    private let productConfiguration: ClaudeProductNativeConfiguration?
    private let productAuthority: ClaudeSessionAuthority?
    private let productClock: (any CoordinatorContinuousClock)?
    private let productCodec: ClaudeProductWireCodec?
    private let replayPort: (any ClaudeNativeReplayPort)?
    private let ingress: ClaudeBridgeIngress
    private let secretCorpus: RuntimeSecretCorpus
    // These are Channel confirmation references, NOT scope credentials or core
    // continuation tokens. Keep them out of the global response guard so only
    // bridge.poll can intentionally deliver them. Never persist them.
    private let channelReferences = RuntimeSecretCorpus()
    private let now: @Sendable () -> Date
    private let lock = NSLock()
    private var revoked = false
    private var boundary: Boundary?
    private var latestPromptID: String?
    private var seenPrompts: [String: Prompt] = [:]
    private var stoppedPromptID: String?
    private var bridgeID: String?
    private var heartbeat: Date?
    private var heartbeatNanoseconds: UInt64?
    private var probe: Probe?
    private var readyUntil: Date?
    private var readyUntilNanoseconds: UInt64?
    private var productStarted = false
    private var pending: Delivery?
    private var claims: [String: CoordinatorBinding] = [:]
    private var seenSelectionIDs: Set<String> = []
    private var bridgeCount = 0
    private var probeCount = 0
    private var proposalCount = 0
    private var pollCount = 0
    private var currentProductPrompt: (id: String, value: Prompt)?
    private var productClaimReferences: [String: String] = [:]
    private var readyReference: String?
    private var deliverySequence: UInt64 = 0
    private var pollWindow: RateWindow?
    private var probeWindow: RateWindow?
    private var productBackground: BackgroundObservation = .unknown
    private var productObservation = "starting"
    private var productFailure: String?
    private var productProjection: [String: Any]?
    private var productProjectionDirty = true
    private var productCoreDeadline: UInt64?
    // Poll may observe a gap without entering storage. Preserve that fact until
    // the serial mutation/scheduler path has durably retired the old binding.
    private var productObservationRetirementPending = false
    private var productDeliveryRevocationPending = false

    public init(grant: ClaudeNativeGrant, adapter: ClaudeCoreAdapter, secretCorpus: RuntimeSecretCorpus,
                now: @escaping @Sendable () -> Date = { Date() }) throws {
        do { try ClaudeBridgeIngress.validateScopes([grant.scope], now: now()) }
        catch { throw CoordinatorError("claude_session_configuration_invalid") }
        self.scope = grant.scope
        self.cwd = grant.cwd
        self.hookToken = grant.hookToken
        self.controlToken = grant.controlToken
        self.nativeSessionID = grant.scope.sessionID
        self.channelSource = "blabee-claude"
        self.productConfiguration = nil
        self.productAuthority = nil
        self.productClock = nil
        self.productCodec = nil
        self.replayPort = nil
        self.secretCorpus = secretCorpus
        self.now = now
        self.ingress = try ClaudeBridgeIngress(scopes: [grant.scope], adapters: [grant.scope.scopeID: adapter],
                                               secretCorpus: secretCorpus, now: now)
        secretCorpus.register(grant.hookToken)
        secretCorpus.register(grant.controlToken)
    }

    /// `journal` must have the same authority's final append-commit gate. The
    /// metadata executor serializes prepare/core/finalize without holding an
    /// authority lock during preparation. It must never retry its body.
    public init(productConfiguration: ClaudeProductNativeConfiguration, authority: ClaudeSessionAuthority,
                journal: any CoordinatorSemanticJournalPort, secretCorpus: RuntimeSecretCorpus,
                clock: any CoordinatorContinuousClock,
                wallNow: @escaping @Sendable () -> Date = { Date() },
                replayPort: any ClaudeNativeReplayPort,
                withCoreMutation: @escaping ClaudeBridgeIngress.ProductCoreMutation) throws {
        guard authority.identity == productConfiguration.identity else {
            throw Self.error("configuration_invalid")
        }
        do { _ = try authority.authorize(identity: productConfiguration.identity) }
        catch { throw Self.error("configuration_invalid") }
        self.scope = try productConfiguration.bridgeScope()
        self.cwd = productConfiguration.canonicalCWD
        self.hookToken = productConfiguration.hookToken
        self.controlToken = nil
        self.nativeSessionID = productConfiguration.identity.nativeSessionID.uuidString.lowercased()
        self.channelSource = productConfiguration.channelSource
        self.productConfiguration = productConfiguration
        self.productAuthority = authority
        self.productClock = clock
        self.productCodec = ClaudeProductWireCodec(credentialCorpus: secretCorpus)
        self.replayPort = replayPort
        self.secretCorpus = secretCorpus
        self.now = wallNow
        self.ingress = try ClaudeBridgeIngress(productConfiguration: productConfiguration, authority: authority,
            journal: journal, secretCorpus: secretCorpus, clock: clock, wallNow: wallNow,
            withCoreMutation: withCoreMutation)
        secretCorpus.register(productConfiguration.hookToken)
    }

    public func handle(payload: Data) throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        guard productAuthority == nil else { throw Self.error("invalid_request") }
        guard payload.count <= Self.maximumPayloadBytes else { throw Self.error("invalid_request") }
        let envelope: [String: Any]
        do {
            envelope = try StrictJSONTransport.object(from: payload, limits: StrictJSONLimits(
                maximumBytes: Self.maximumPayloadBytes, maximumDepth: 24
            ))
        } catch { throw Self.error("invalid_request") }
        guard Set(envelope.keys) == ["schema_version", "provider", "scope_id", "session_id", "role", "auth_token", "request"],
              envelope["schema_version"] as? String == Self.schemaVersion else { throw Self.error("invalid_request") }
        let instant = now()
        guard !revoked, instant.timeIntervalSince1970.isFinite,
              (0...8_000_000_000_000).contains(instant.timeIntervalSince1970), scope.expiresAt > instant,
              envelope["provider"] as? String == "claude",
              envelope["scope_id"] as? String == scope.scopeID,
              envelope["session_id"] as? String == scope.sessionID,
              let credential = envelope["auth_token"] as? String, ClaudeNativeGrant.validToken(credential) else {
            throw Self.error("unauthorized")
        }
        let roleTokens = [("hook", hookToken), ("bridge", scope.bridgeToken),
                          ("selector", scope.selectionToken), ("control", controlToken!)]
        // Evaluate every comparison, including an invalid role, before refusing.
        let authenticatedRoles = roleTokens.map { ($0.0, ContinuationTokenMaterial.constantTimeEqual(credential, $0.1)) }
        guard let actualRole = authenticatedRoles.first(where: { $0.1 })?.0 else { throw Self.error("unauthorized") }
        guard let role = envelope["role"] as? String, role == actualRole else { throw Self.error("forbidden") }
        guard let request = envelope["request"] as? [String: Any],
              request["schema_version"] as? String == "1.0",
              let requestID = request["request_id"] as? String, Self.isUUID(requestID),
              let operation = request["operation"] as? String else { throw Self.error("invalid_request") }
        let operations: [String: Set<String>] = [
            "hook": ["hook"], "selector": ["select", "snapshot", "pet.snapshot"], "control": ["snapshot", "session.end"],
            "bridge": ["bridge.open", "bridge.close", "bridge.poll", "readiness.begin", "readiness.ack",
                       "proposal.emit", "selection.claim", "selection.complete"],
        ]
        guard operations[role]?.contains(operation) == true else { throw Self.error("forbidden") }

        var response: [String: Any] = [
            "schema_version": Self.schemaVersion, "provider": "claude", "scope_id": scope.scopeID,
            "session_id": scope.sessionID, "role": role, "request_id": requestID,
        ]
        do {
            try assertSafeRequest(request, operation: operation)
            try expireObservations(at: instant)
            let result = try dispatch(operation, request: request, at: instant)
            try assertPublic(result, includeReferences: operation != "bridge.poll")
            response["ok"] = true
            response["result"] = result
        } catch {
            let code = (error as? CoordinatorError)?.code ?? "claude_session_internal_error"
            response["ok"] = false
            response["error"] = ["code": code.range(of: "^[a-z0-9_]{1,96}$", options: .regularExpression) != nil
                ? code : "claude_session_internal_error"]
        }
        let encoded = try StrictJSONTransport.data(forJSONObject: response)
        guard encoded.count <= Self.maximumPayloadBytes else { throw Self.error("response_too_large") }
        guard !secretCorpus.containsKnownSecret(in: encoded) else { throw Self.error("secret_reflection") }
        return encoded
    }

    /// The registry dispatches only an explicitly decoded session-v2 envelope.
    /// Parsing does not prove authentication: this port rechecks the current
    /// registration, role capability and shared authority before any observation.
    public func handleProduct(request: ClaudeProductWireCodec.Envelope, credential: String) throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        guard let codec = productCodec, let configuration = productConfiguration,
              request.contract == .session, request.kind == .request, request.provider == .claude else {
            throw Self.error("invalid_request")
        }
        let checked = try codec.decodeRequest(request.canonicalJSON)
        let object = try StrictJSONTransport.object(from: checked.canonicalJSON)
        let identity = try Self.productIdentity(object["authority"])
        let ticket = try authorizeProduct(identity: identity, role: checked.role, credential: credential)
        guard let payload = object["payload"] as? [String: Any] else { throw Self.error("invalid_request") }
        var response: [String: Any] = [
            "schema_version": ClaudeProductWireCodec.Contract.session.rawValue, "kind": "response",
            "provider": "claude", "request_id": checked.requestID.uuidString.lowercased(),
            "role": checked.role, "operation": checked.operation, "authority": object["authority"]!,
        ]
        var ended = false
        do {
            var inner = payload
            inner["schema_version"] = "1.0"
            inner["request_id"] = checked.requestID.uuidString.lowercased()
            inner["operation"] = checked.operation
            if checked.operation == "hook" {
                guard payload["native_session_id"] as? String == nativeSessionID,
                      let observedCWD = payload["cwd"] as? String,
                      observedCWD.utf8.elementsEqual(cwd.utf8) else {
                    // The correct registration and Hook capability reported a
                    // different native owner. It cannot retain the old task's
                    // authority after an unsupported in-place transition.
                    end()
                    throw Self.error("hook_mismatch")
                }
                inner["session_id_native"] = inner.removeValue(forKey: "native_session_id")
                if payload["event"] as? String == "ObservationUnavailable",
                   let reason = payload["reason"] as? String {
                    if reason == "unsupported_source" {
                        // Resume, fork and clear cannot inherit this product
                        // registration, even when the native ID is unchanged.
                        end()
                        throw Self.error("unsupported_lifecycle")
                    }
                    if reason == "unknown_event" { inner["reason"] = "invalid_prompt_text" }
                }
                let event = payload["event"] as? String
                guard productStarted || event == "SessionStart" || event == "SessionEnd"
                    || event == "ObservationUnavailable" else { throw Self.error("native_start_required") }
            } else if checked.operation == "proposal.emit" {
                guard productStarted else { throw Self.error("native_start_required") }
                guard let proposal = payload["proposal"] as? [String: Any],
                      proposal["schema_version"] as? String == "blabee.claude-proposal.v1",
                      let value = proposal["value"] as? [String: Any] else { throw Self.error("invalid_request") }
                inner["proposal"] = value
            }
            try assertSafeRequest(inner, operation: checked.operation)
            try admitProductReplay(inner, operation: checked.operation)
            let instant = now()
            if checked.operation != "bridge.poll" { try expireObservations(at: instant) }
            let result = try dispatch(checked.operation, request: inner, at: instant)
            ended = checked.operation == "hook" && payload["event"] as? String == "SessionEnd"
            let projected = try projectProductResult(result, operation: checked.operation, payload: payload)
            try assertPublic(projected, includeReferences: checked.operation != "bridge.poll")
            response["ok"] = true
            response["result"] = projected
        } catch {
            response["ok"] = false
            response["error"] = ["code": productErrorCode(error)]
        }
        let encoded = try codec.encodeResponse(response, matching: checked,
            connection: .init(serviceIncarnation: configuration.identity.serviceIncarnation,
                              ownerConnectionID: configuration.identity.ownerConnectionID))
        // SessionEnd acknowledges the already-linearized revocation itself.
        // Every other successful reply, including an executable claimed action,
        // is released only while the same admitted authority remains valid.
        if response["ok"] as? Bool == true, !ended { return try finishProduct(ticket, result: encoded) }
        return encoded
    }

    /// Private service-side selector port pending CP-06 Pet wire integration.
    /// No session-v2 selector operation or model-visible selector capability.
    public func productSnapshot(identity: ClaudeSessionAuthority.Identity, credential: String) throws -> Data {
        try lock.withLock {
            let ticket = try authorizeProduct(identity: identity, role: "selector", credential: credential)
            let value = try cachedProductSnapshot(at: now())
            try assertPublic(value, includeReferences: true)
            return try finishProduct(ticket, result: StrictJSONTransport.data(forJSONObject: value))
        }
    }

    /// Called by the scope's serial executor after construction/mutations and
    /// on a scheduled deadline. Normal poll and Pet reads perform no core I/O.
    /// Returns an absolute, sleep-inclusive continuous deadline, or nil.
    public func processProductTime(identity: ClaudeSessionAuthority.Identity, credential: String) throws -> UInt64? {
        try lock.withLock {
            let ticket = try authorizeProduct(identity: identity, role: "selector", credential: credential)
            try expireObservations(at: now())
            let instant = productClock!.nowNanoseconds()
            if productProjection == nil || productProjectionDirty || productCoreDeadline.map({ $0 <= instant }) == true {
                productProjection = try refreshedSnapshot()
                productProjectionDirty = false
                if let milliseconds = try ingress.productMillisecondsUntilNextDeadline(identity: identity) {
                    productCoreDeadline = try productDeadline(after: UInt64(max(0, milliseconds)) * 1_000_000)
                } else { productCoreDeadline = nil }
            }
            return try finishProduct(ticket, result: nextProductWakeLocked())
        }
    }

    public func nextProductWakeNanoseconds(identity: ClaudeSessionAuthority.Identity, credential: String) throws -> UInt64? {
        try lock.withLock {
            let ticket = try authorizeProduct(identity: identity, role: "selector", credential: credential)
            return try finishProduct(ticket, result: nextProductWakeLocked())
        }
    }

    public func productSelect(identity: ClaudeSessionAuthority.Identity, credential: String,
                              binding: CoordinatorBinding, packetID: String, revision: Int64,
                              optionID: String, selectionID: UUID) throws -> Data {
        try lock.withLock {
            let ticket = try authorizeProduct(identity: identity, role: "selector", credential: credential)
            guard productStarted else { throw Self.error("native_start_required") }
            guard boundary?.binding == binding else { throw Self.error("boundary_mismatch") }
            var request = Self.internalRequest("select")
            request.merge(["boundary_id": binding.decisionBoundaryID, "packet_id": packetID,
                "revision": revision, "option_id": optionID,
                "selection_id": selectionID.uuidString.lowercased()]) { _, next in next }
            try assertSafeRequest(request, operation: "select")
            try consumeReplay(.selection, id: selectionID.uuidString.lowercased(), request: request)
            let instant = now()
            try expireObservations(at: instant)
            let value = try dispatch("select", request: request, at: instant)
            try assertPublic(value, includeReferences: true)
            return try finishProduct(ticket, result: StrictJSONTransport.data(forJSONObject: value))
        }
    }

    private func authorizeProduct(identity: ClaudeSessionAuthority.Identity, role: String,
                                  credential: String) throws -> ClaudeSessionAuthority.Ticket {
        guard !revoked, let configuration = productConfiguration, let authority = productAuthority,
              configuration.identity == identity, ClaudeNativeGrant.validToken(credential) else {
            throw Self.error("unauthorized")
        }
        let matches = [("hook", hookToken), ("bridge", scope.bridgeToken), ("selector", scope.selectionToken)]
            .map { ($0.0, ContinuationTokenMaterial.constantTimeEqual(credential, $0.1)) }
        guard let actual = matches.first(where: { $0.1 })?.0 else { throw Self.error("unauthorized") }
        guard role == actual else { throw Self.error("forbidden") }
        do { return try authority.authorize(identity: identity) }
        catch { throw Self.error("unauthorized") }
    }

    private func finishProduct<T>(_ ticket: ClaudeSessionAuthority.Ticket, result: T) throws -> T {
        guard let authority = productAuthority else { throw Self.error("unauthorized") }
        do { return try authority.withMutationFence(ticket) { result } }
        catch { throw Self.error("unauthorized") }
    }

    private func consumeReplay(_ kind: ClaudeReplayKind, id: String, request: [String: Any]) throws {
        guard let replayPort, let requestID = request["request_id"] as? String,
              let operationID = UUID(uuidString: requestID) else { throw Self.error("invalid_request") }
        let key = try ClaudeReplayKey(kind: kind, id: id)
        do { try replayPort.consume(key, operationID: operationID) }
        catch let error as CoordinatorError where error.code == "claude_metadata_replay" { throw error }
        catch {
            productAuthority?.revoke(reason: .serviceReplaced)
            end()
            throw error
        }
    }

    private func admitProductReplay(_ request: [String: Any], operation: String) throws {
        if operation == "proposal.emit" {
            guard let proposal = request["proposal"] as? [String: Any], let id = proposal["proposal_id"] as? String else {
                throw Self.error("invalid_request")
            }
            try consumeReplay(.proposal, id: id, request: request)
        } else if operation == "hook", let event = request["event"] as? String {
            if event == "UserPromptSubmit" {
                let id = try Self.uuid(request, "prompt_id")
                if let current = currentProductPrompt, current.id == id {
                    guard request["prompt_sha256"] as? String == current.value.digest else {
                        // An authenticated conflicting observation cannot leave
                        // the earlier card selectable. Preserve claimed reports,
                        // but retire the uncertain current input before refusing.
                        try retireUnusableObservation()
                        throw Self.error("prompt_replay")
                    }
                    if !productObservationRetirementPending,
                       !(heartbeat != nil && !isConnected(at: now())),
                       latestPromptID == id,
                       promptReferenceIsActive(current.value, promptID: id) { return }
                }
                try consumeReplay(.prompt, id: id, request: request)
            } else if event == "Stop" || event == "StopFailure"
                || (event == "SessionStart" && request["source"] as? String == "compact") {
                try consumeReplay(.hookRequest, id: try Self.uuid(request, "request_id"), request: request)
            }
        }
    }

    private func promptReferenceIsActive(_ prompt: Prompt, promptID: String) -> Bool {
        switch prompt.kind {
        case .ordinary: return true
        case .probe(let id): return probe?.id == id && probe?.nativePromptID == promptID
        case .selection(let id): return pending?.selectionID == id && pending?.nativePromptID == promptID
        }
    }

    private func cachedProductSnapshot(at instant: Date) throws -> [String: Any] {
        guard var result = productProjection else { throw Self.error("projection_unavailable") }
        let coreDue = productCoreDeadline.map { $0 <= productClock!.nowNanoseconds() } ?? false
        let lostObservation = productObservationRetirementPending || (heartbeat != nil && !isConnected(at: instant))
        let liveCard = lostObservation ? nil : boundary?.card
        result["cards"] = (result["cards"] as? [[String: Any]] ?? []).filter {
            ($0["packet"] as? [String: Any])?["packet_id"] as? String == liveCard?.packetID && liveCard != nil
        }
        result["boundary_id"] = (lostObservation ? nil : boundary?.binding.decisionBoundaryID) as Any? ?? NSNull()
        result["ready"] = isReady(at: instant)
        result["bridge_connected"] = isConnected(at: instant)
        result["selection_enabled"] = !productProjectionDirty && !coreDue && isReady(at: instant)
            && productBackground.isIdle && stoppedPromptID != nil && stoppedPromptID == latestPromptID && liveCard != nil
        result["pending_report_count"] = claims.count
        result["native_observation"] = ["status": lostObservation ? "new_prompt_required" : productObservation,
            "background_state": lostObservation ? "unknown" : productBackground.name,
            "background_task_count": (lostObservation ? nil : productBackground.count) as Any? ?? NSNull(),
            "failure_code": (lostObservation ? nil : productFailure) as Any? ?? NSNull()]
        return result
    }

    private func nextProductWakeLocked() -> UInt64? {
        guard let clock = productClock else { return nil }
        if productProjection == nil || productProjectionDirty { return clock.nowNanoseconds() }
        var deadlines = [productCoreDeadline, probe?.expiresNanoseconds, readyUntil == nil ? nil : readyUntilNanoseconds,
                         pending?.expiresNanoseconds].compactMap { $0 }
        if heartbeat != nil, let value = heartbeatNanoseconds {
            let (deadline, overflow) = value.addingReportingOverflow(5_000_000_000)
            if !overflow { deadlines.append(deadline) }
        }
        if let authority = productAuthority, case .active(let lease) = authority.snapshot() {
            deadlines.append(lease.deadlineNanoseconds)
        }
        return deadlines.min()
    }

    private static func admitRate(_ window: inout RateWindow?, at instant: UInt64,
                                  period: UInt64, maximum: UInt32) throws {
        if let current = window {
            guard instant >= current.anchor else { throw error("time_invalid") }
            if instant - current.anchor < period {
                guard current.count < maximum else { throw error("capacity") }
                window = RateWindow(anchor: current.anchor, count: current.count + 1)
                return
            }
        }
        window = RateWindow(anchor: instant, count: 1)
    }

    private func nextDeliverySequence() throws -> String {
        let (next, overflow) = deliverySequence.addingReportingOverflow(1)
        guard !overflow else { end(); throw Self.error("capacity") }
        deliverySequence = next
        return String(next)
    }

    // Test-visible counts only. No identifiers, tokens or implementation
    // counters are added to a model tool or Pet response.
    func productRetainedStateCounts() -> (prompts: Int, selections: Int, references: Int, claims: Int) {
        lock.withLock {
            (currentProductPrompt == nil ? 0 : 1, seenSelectionIDs.count,
             activeChannelReferences().count, claims.count)
        }
    }

    private func projectProductResult(_ result: [String: Any], operation: String,
                                      payload: [String: Any]) throws -> [String: Any] {
        switch operation {
        case "hook":
            let status = result["invalidated"] as? Bool == true ? "invalidated"
                : (boundary == nil && payload["event"] as? String != "SessionEnd" ? "new_prompt_required" : "accepted")
            return ["observed": true, "boundary_id": boundary?.binding.decisionBoundaryID as Any? ?? NSNull(),
                    "observation_status": status]
        case "readiness.begin":
            guard let expires = probe?.expiresNanoseconds else { throw Self.error("response_invalid") }
            return ["probe_id": result["probe_id"]!, "expires_at_nanoseconds": String(expires), "status": "pending"]
        case "readiness.ack": return ["acknowledged": true]
        case "bridge.poll":
            guard let event = result["event"] as? [String: Any] else { return ["event": NSNull()] }
            let kind = event["kind"] as? String
            let expiry = kind == "readiness_probe" ? probe?.expiresNanoseconds : pending?.expiresNanoseconds
            guard let expiry, let kind else { throw Self.error("response_invalid") }
            guard let sequence = event["delivery_sequence"] as? String else { throw Self.error("response_invalid") }
            var value: [String: Any] = ["kind": kind, "expires_at_nanoseconds": String(expiry), "channel_source": channelSource,
                                        "delivery_sequence": sequence]
            if kind == "readiness_probe" { value["probe_id"] = event["probe_id"]; value["nonce"] = event["nonce"] }
            else { value["selection_id"] = event["selection_id"]; value["delivery_token"] = event["delivery_token"] }
            return ["event": value]
        case "selection.claim":
            guard let action = result["action"] as? [String: Any] else { throw Self.error("response_invalid") }
            var value = result
            value["action"] = ["schema_version": "blabee.claude-action.v1", "value": action]
            return value
        case "selection.complete":
            return ["selection_id": payload["selection_id"]!, "recorded": true, "reported_by": "claude"]
        default: return result
        }
    }

    private static func productIdentity(_ value: Any?) throws -> ClaudeSessionAuthority.Identity {
        guard let object = value as? [String: Any] else { throw error("invalid_request") }
        func id(_ name: String) throws -> UUID {
            guard let text = object[name] as? String, let value = UUID(uuidString: text),
                  value.uuidString.lowercased() == text else { throw error("invalid_request") }
            return value
        }
        return try .init(scopeID: id("scope_id"), nativeSessionID: id("native_session_id"),
            sessionIncarnation: id("session_incarnation"), serviceIncarnation: id("service_incarnation"),
            ownerConnectionID: id("owner_connection_id"), authorityEpoch: id("authority_epoch"))
    }

    private static func internalRequest(_ operation: String) -> [String: Any] {
        ["schema_version": "1.0", "request_id": id(), "operation": operation]
    }

    /// Product replies use the closed CP-01B vocabulary. Native/core error
    /// names remain internal; an uncertain result never implies safe replay.
    private func productErrorCode(_ error: Error) -> String {
        if let authority = productAuthority, case .terminated(let reason) = authority.snapshot() {
            switch reason {
            case .expired: return "expired"
            case .revoked: return "revoked"
            case .clockRegression, .clockOverflow: return "unavailable"
            }
        }
        if let error = error as? ClaudeSessionAuthority.AuthorityError {
            switch error {
            case .terminated(.expired): return "expired"
            case .terminated: return "revoked"
            case .identityMismatch, .ownerMismatch, .staleTicket: return "stale_authority"
            case .invalidRenewalSequence: return "invalid_request"
            }
        }
        switch (error as? CoordinatorError)?.code {
        case "claude_session_unauthorized", "claude_bridge_unauthorized": return "unauthorized"
        case "claude_session_forbidden", "claude_bridge_forbidden", "unsupported_operation",
             "claude_session_secret_reflection", "claude_bridge_secret_reflection": return "forbidden"
        case "unsupported_schema_version": return "unsupported_version"
        case "claude_session_capacity", "live_claim_capacity", "live_proposal_capacity", "snapshot_capacity":
            return "capacity"
        case "claude_session_native_start_required", "claude_session_readiness_required",
             "claude_session_readiness_invalid", "claude_session_stop_required",
             "claude_session_unsupported_lifecycle", "claude_session_unsupported_resume",
             "claude_session_projection_unavailable": return "unavailable"
        case "claude_session_hook_mismatch", "claude_session_bridge_mismatch", "claude_session_boundary_mismatch",
             "claude_session_prompt_replay", "claude_session_invalid_claim", "claude_session_invalid_completion",
             "binding_incomplete", "decision_boundary_already_closed", "unknown_decision_boundary",
             "invalid_claim", "invalid_completion", "invalid_selection", "claude_metadata_replay": return "binding_mismatch"
        case "claude_session_invalid_request", "claude_bridge_invalid_request", "invalid_request_id",
             "invalid_fields", "invalid_proposal", "invalid_proposal_outcome", "invalid_reported_side_effects",
             "invalid_text", "invalid_options", "duplicate_option_id", "invalid_constraints",
             "proposal_too_large", "request_too_large", "claude_replay_key_invalid": return "invalid_request"
        default: return "unknown_result"
        }
    }

    private func dispatch(_ operation: String, request: [String: Any], at instant: Date) throws -> [String: Any] {
        switch operation {
        case "hook": return try handleHook(request)
        case "bridge.open":
            try Self.fields(request, [])
            if productAuthority != nil, bridgeCount != 0 {
                end()
                throw Self.error("bridge_reopen_forbidden")
            }
            guard bridgeCount < 64 else { throw Self.error("capacity") }
            readyUntil = nil
            readyReference = nil
            probe = nil
            bridgeID = nil
            heartbeat = nil
            try revokeDelivery()
            bridgeCount += 1
            let id = Self.id()
            bridgeID = id
            heartbeat = instant
            heartbeatNanoseconds = productClock?.nowNanoseconds()
            return ["bridge_id": id]
        case "bridge.close":
            try Self.fields(request, ["bridge_id"])
            try requireBridge(request)
            bridgeID = nil
            heartbeat = nil
            readyUntil = nil
            readyReference = nil
            probe = nil
            try revokeDelivery()
            return ["closed": true]
        case "bridge.poll":
            try Self.fields(request, ["bridge_id"])
            try requireBridge(request)
            if let clock = productClock {
                try Self.admitRate(&pollWindow, at: clock.nowNanoseconds(), period: 1_000_000_000, maximum: 8)
            } else {
                guard pollCount < 65_536 else { throw Self.error("capacity") }
                pollCount += 1
            }
            if productAuthority != nil { observeProductPollExpiry(at: instant) }
            heartbeat = instant
            heartbeatNanoseconds = productClock?.nowNanoseconds()
            if var value = probe, !value.delivered {
                var event: [String: Any] = ["kind": "readiness_probe", "probe_id": value.id, "nonce": value.nonce,
                    "expires_at": Self.epochMilliseconds(value.expires), "content": value.content]
                if productAuthority != nil { event["delivery_sequence"] = try nextDeliverySequence() }
                value.delivered = true
                probe = value
                return ["event": event]
            }
            if var value = pending, !value.delivered,
               !productObservationRetirementPending, !productDeliveryRevocationPending {
                var event: [String: Any] = ["kind": "selection", "selection_id": value.selectionID,
                    "delivery_token": value.token, "content": value.content]
                if productAuthority != nil { event["delivery_sequence"] = try nextDeliverySequence() }
                value.delivered = true
                pending = value
                return ["event": event]
            }
            return ["event": NSNull()]
        case "readiness.begin":
            try Self.fields(request, ["bridge_id"])
            try requireBridge(request)
            if let clock = productClock {
                try Self.admitRate(&probeWindow, at: clock.nowNanoseconds(), period: 60_000_000_000, maximum: 12)
            } else {
                guard probeCount < 128 else { throw Self.error("capacity") }
                probeCount += 1
            }
            readyUntil = nil
            readyReference = nil
            let id = Self.id(), nonce = Self.reference()
            let expires = instant.addingTimeInterval(Self.readinessLifetime)
            let expiresNanoseconds = try productDeadline(after: 300_000_000_000)
            if productAuthority == nil { channelReferences.register(nonce) }
            probe = Probe(id: id, nonce: nonce, bridgeID: bridgeID!, expires: expires, expiresNanoseconds: expiresNanoseconds,
                          content: Self.probeContent(id: id, nonce: nonce))
            return ["probe_id": id, "expires_at": productAuthority == nil ? Self.epochMilliseconds(expires) : 0, "status": "awaiting_ack"]
        case "readiness.ack":
            try Self.fields(request, ["bridge_id", "probe_id", "nonce"])
            try requireBridge(request)
            guard isConnected(at: instant), let value = probe, value.delivered,
                  observationIsLive(expires: value.expires, continuous: value.expiresNanoseconds, at: instant),
                  value.bridgeID == bridgeID, request["probe_id"] as? String == value.id,
                  let nonce = request["nonce"] as? String,
                  ContinuationTokenMaterial.constantTimeEqual(nonce, value.nonce) else { throw Self.error("readiness_invalid") }
            probe = nil
            readyUntil = value.expires
            readyUntilNanoseconds = value.expiresNanoseconds
            if productAuthority != nil { readyReference = value.nonce }
            return ["ready": true, "expires_at": productAuthority == nil ? Self.epochMilliseconds(value.expires) : 0]
        case "proposal.emit": return try emit(request)
        case "select": return try select(request, at: instant)
        case "selection.claim": return try claim(request, at: instant)
        case "selection.complete": return try complete(request)
        case "snapshot", "pet.snapshot":
            try Self.fields(request, [])
            var result = try refreshedSnapshot(forPet: operation == "pet.snapshot")
            if operation == "pet.snapshot" {
                result["schema_version"] = "blabee.claude-pet.v1"
                // refreshedSnapshot reconciles completed durable reports first.
                // Transport consumption alone is not a model task result.
                result["pending_report_count"] = claims.count
            }
            result["boundary_id"] = boundary?.binding.decisionBoundaryID as Any? ?? NSNull()
            result["ready"] = isReady(at: instant)
            result["bridge_connected"] = isConnected(at: instant)
            result["selection_enabled"] = isReady(at: instant) && stoppedPromptID != nil
                && stoppedPromptID == latestPromptID && boundary?.card != nil
                && (productAuthority == nil || productBackground.isIdle)
            return result
        case "session.end":
            try Self.fields(request, [])
            end()
            return ["ended": true]
        default: throw Self.error("forbidden")
        }
    }

    private func handleHook(_ request: [String: Any]) throws -> [String: Any] {
        guard let event = request["event"] as? String else { throw Self.error("invalid_request") }
        // Legacy mismatched observations cannot retire another session. The
        // product entry point separately treats an authenticated observation of
        // a changed native owner as an unsupported registration transition.
        guard request["session_id_native"] as? String == nativeSessionID,
              let cwd = request["cwd"] as? String, cwd.utf8.elementsEqual(self.cwd.utf8) else {
            throw Self.error("hook_mismatch")
        }
        let base: Set<String> = ["event", "session_id_native", "cwd"]
        switch event {
        case "SessionStart": try Self.fields(request, base,
            optional: productAuthority == nil ? ["source"] : ["source", "prompt_id"])
        case "UserPromptSubmit": try Self.fields(request, base.union(["prompt_id", "prompt_sha256"]))
        case "Stop": try Self.fields(request, base.union(["prompt_id"]),
            optional: productAuthority == nil ? [] : ["background_task_ids"])
        case "StopFailure" where productAuthority != nil:
            try Self.fields(request, base.union(["failure_code"]), optional: ["prompt_id"])
        case "SessionEnd": try Self.fields(request, base)
        case "ObservationUnavailable": try Self.fields(request, base.union(["reason"]))
        default: throw Self.error("invalid_request")
        }
        if event == "ObservationUnavailable" {
            guard let reason = request["reason"] as? String,
                  ["invalid_prompt_id", "invalid_prompt_text"].contains(reason) else { throw Self.error("invalid_request") }
            try retireUnusableObservation()
            return ["invalidated": true]
        }
        if event == "SessionEnd" { end(); return ["ended": true] }
        if event == "StopFailure" {
            let failure = request["failure_code"] as? String ?? "unknown"
            try retireUnusableObservation()
            productFailure = failure
            productObservation = "failed"
            return hookResult()
        }
        if event == "SessionStart" {
            if let source = request["source"], !(source is String && ["startup", "compact"].contains(source as! String)) {
                try retireUnusableObservation()
                throw Self.error("unsupported_resume")
            }
            if productAuthority != nil, request["source"] as? String == "compact" {
                let previous = boundary?.binding
                let current = currentProductPrompt
                let observed = request["prompt_id"] as? String
                let matches = productStarted && observed != nil && observed == latestPromptID && previous != nil
                try retireUnusableObservation()
                if matches, let previous, let observed {
                    boundary = try freshBoundary(promptID: observed, episode: previous)
                    latestPromptID = observed
                    currentProductPrompt = current
                    productObservation = "compacted"
                }
                return hookResult()
            }
            if productAuthority != nil { productStarted = true; productObservation = "started" }
            return hookResult()
        }
        let promptID: String
        do { promptID = try Self.uuid(request, "prompt_id") }
        catch { try retireUnusableObservation(); throw error }
        if event == "Stop" {
            guard promptID == latestPromptID else {
                // An unobserved native prompt may have superseded the card.
                // Refuse selection even when an earlier Stop was valid.
                try retireUnusableObservation()
                throw Self.error("hook_mismatch")
            }
            stoppedPromptID = promptID
            if productAuthority != nil {
                if let tasks = request["background_task_ids"] as? [String] {
                    productBackground = tasks.isEmpty ? .idle : .active(tasks.count)
                } else { productBackground = .unknown }
                productObservation = "stopped"
                productFailure = nil
            }
            return hookResult()
        }
        guard let digest = request["prompt_sha256"] as? String, ClaudeNativeGrant.validToken(digest) else {
            try retireUnusableObservation()
            throw Self.error("invalid_request")
        }
        let seen = productAuthority == nil ? seenPrompts[promptID]
            : (currentProductPrompt?.id == promptID ? currentProductPrompt?.value : nil)
        if let seen {
            guard promptID == latestPromptID, digest == seen.digest, promptReferenceIsActive(seen, promptID: promptID) else {
                try retireUnusableObservation()
                throw Self.error("prompt_replay")
            }
            return hookResult()
        }
        guard productAuthority != nil || seenPrompts.count < 256 else {
            try retireUnusableObservation()
            throw Self.error("capacity")
        }
        let kind: PromptKind
        if var value = probe, value.delivered, value.nativePromptID == nil,
           Self.matches(digest: digest, content: value.content, wrapper: Self.probeWrapper(value, source: channelSource)) {
            value.nativePromptID = promptID
            probe = value
            kind = .probe(value.id)
        } else if var value = pending, value.delivered, value.nativePromptID == nil,
                  Self.matches(digest: digest, content: value.content, wrapper: Self.selectionWrapper(value, source: channelSource)) {
            value.nativePromptID = promptID
            pending = value
            kind = .selection(value.selectionID)
        } else {
            try retireCurrentUnclaimed()
            boundary = try freshBoundary(promptID: promptID)
            kind = .ordinary
        }
        latestPromptID = promptID
        stoppedPromptID = nil
        let observation = Prompt(digest: digest, kind: kind)
        if productAuthority != nil {
            currentProductPrompt = (promptID, observation)
            productObservation = "running"
            productBackground = .unknown
            productFailure = nil
        } else { seenPrompts[promptID] = observation }
        return hookResult()
    }

    private func emit(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["bridge_id", "boundary_id", "proposal"])
        try requireBridge(request)
        guard var value = boundary, request["boundary_id"] as? String == value.binding.decisionBoundaryID,
              !value.attemptedActivation, pending == nil else { throw Self.error("boundary_mismatch") }
        if productAuthority == nil {
            guard proposalCount < 128 else { throw Self.error("capacity") }
            proposalCount += 1
        }
        // A possibly committed activation is never automatically reconstructed
        // or retried. New native input can retire this exact attempted boundary.
        value.attemptedActivation = true
        boundary = value
        let result = try core("activate", fields: ["binding": value.binding.jsonObject, "proposal": request["proposal"]!])
        guard let packet = result["packet"] as? [String: Any], let packetID = packet["packet_id"] as? String,
              let revision = ExactJSONInteger.int64(packet["revision"], minimum: 1),
              let options = result["option_bindings"] as? [[String: Any]] else { throw Self.error("response_invalid") }
        let optionIDs = Set(options.compactMap { $0["option_id"] as? String })
        guard optionIDs.count == options.count else { throw Self.error("response_invalid") }
        value.card = Card(packetID: packetID, revision: revision, optionIDs: optionIDs)
        boundary = value
        return ["packet_id": packetID, "revision": revision]
    }

    private func select(_ request: [String: Any], at instant: Date) throws -> [String: Any] {
        try Self.fields(request, ["boundary_id", "packet_id", "revision", "option_id", "selection_id"])
        guard isReady(at: instant) else { throw Self.error("readiness_required") }
        guard latestPromptID != nil, stoppedPromptID == latestPromptID else { throw Self.error("stop_required") }
        guard productAuthority == nil || productBackground.isIdle else { throw Self.error("stop_required") }
        let selectionID = try Self.uuid(request, "selection_id")
        _ = try refreshedSnapshot()
        guard var value = boundary, let card = value.card, pending == nil,
              request["boundary_id"] as? String == value.binding.decisionBoundaryID,
              request["packet_id"] as? String == card.packetID,
              ExactJSONInteger.int64(request["revision"], minimum: 1) == card.revision,
              let optionID = request["option_id"] as? String, card.optionIDs.contains(optionID),
              productAuthority != nil || !seenSelectionIDs.contains(selectionID) else { throw Self.error("boundary_mismatch") }
        guard (productAuthority != nil || seenSelectionIDs.count < 128), claims.count < 32 else { throw Self.error("capacity") }
        if productAuthority == nil { seenSelectionIDs.insert(selectionID) }
        value.card = nil
        boundary = value
        let deliveryDeadline = try productDeadline(after: CoordinatorRoutingApplication.continuationValidityNanoseconds)
        let result = try core("select", fields: ["binding": value.binding.jsonObject, "packet_id": card.packetID,
            "revision": card.revision, "option_id": optionID, "selection_id": selectionID], role: "selector")
        let reference = Self.reference()
        if productAuthority == nil { channelReferences.register(reference) }
        pending = Delivery(selectionID: selectionID, binding: value.binding, token: reference, bridgeID: bridgeID!,
                           content: Self.selectionContent(id: selectionID, token: reference), expiresNanoseconds: deliveryDeadline)
        return result
    }

    private func claim(_ request: [String: Any], at instant: Date) throws -> [String: Any] {
        try Self.fields(request, ["bridge_id", "selection_id", "delivery_token"])
        try requireBridge(request)
        guard isConnected(at: instant), let value = pending, value.delivered, value.bridgeID == bridgeID,
              productReferenceIsLive(value.expiresNanoseconds),
              request["selection_id"] as? String == value.selectionID,
              let reference = request["delivery_token"] as? String,
              ContinuationTokenMaterial.constantTimeEqual(reference, value.token), let promptID = latestPromptID else {
            throw Self.error("invalid_claim")
        }
        guard claims.count < 32 else { throw Self.error("capacity") }
        // Consume before any core call. An ambiguous response can never return
        // the action again, even if an outer transport retries this exact call.
        pending = nil
        let result = try core("claim", fields: ["binding": value.binding.jsonObject, "selection_id": value.selectionID])
        guard let action = result["action"] as? [String: Any] else { throw Self.error("response_invalid") }
        claims[value.selectionID] = value.binding
        if productAuthority != nil { productClaimReferences[value.selectionID] = value.token; productBackground = .unknown }
        boundary = try freshBoundary(promptID: promptID, episode: value.binding)
        stoppedPromptID = nil
        return ["selection_id": value.selectionID, "boundary_id": boundary!.binding.decisionBoundaryID,
                "prompt_id": promptID, "action": action]
    }

    private func complete(_ request: [String: Any]) throws -> [String: Any] {
        try Self.fields(request, ["bridge_id", "selection_id", "outcome", "note"])
        try requireBridge(request)
        guard let selectionID = request["selection_id"] as? String, let binding = claims[selectionID],
              let outcome = request["outcome"] as? String, ["completed", "failed"].contains(outcome),
              let note = request["note"] as? String else { throw Self.error("invalid_completion") }
        do {
            _ = try core("complete", fields: ["binding": binding.jsonObject, "selection_id": selectionID,
                                               "outcome": outcome, "note": note])
        } catch {
            // A committed outcome followed by a lost close/response consumes
            // report rights. Only fresh matching durable evidence removes it.
            if let snapshot = try? core("snapshot"), let outcomes = snapshot["outcomes"] as? [[String: Any]] {
                reconcileClaims(outcomes)
            }
            throw error
        }
        claims.removeValue(forKey: selectionID)
        productClaimReferences.removeValue(forKey: selectionID)
        return ["recorded": true, "reported_by": "model"]
    }

    /// Poll latches loss before advancing its heartbeat, but never enters the
    /// core/metadata path. A later fresh ACK cannot erase this retirement debt.
    private func observeProductPollExpiry(at instant: Date) {
        if heartbeat != nil && !isConnected(at: instant) {
            productObservationRetirementPending = true
            productProjectionDirty = true
            readyUntil = nil
            readyReference = nil
            probe = nil
        }
        if let value = probe, !observationIsLive(expires: value.expires, continuous: value.expiresNanoseconds, at: instant) {
            probe = nil
        }
        if let value = readyUntil, !observationIsLive(expires: value, continuous: readyUntilNanoseconds, at: instant) {
            readyUntil = nil
            readyReference = nil
        }
        if let value = pending, !productReferenceIsLive(value.expiresNanoseconds) {
            productDeliveryRevocationPending = true
            productProjectionDirty = true
        }
    }

    private func expireObservations(at instant: Date) throws {
        if productObservationRetirementPending {
            try retireUnusableObservation()
            productObservationRetirementPending = false
            productDeliveryRevocationPending = false
        } else if productDeliveryRevocationPending {
            try revokeDelivery()
            productDeliveryRevocationPending = false
        }
        if heartbeat != nil && !isConnected(at: instant) {
            heartbeat = nil
            readyUntil = nil
            probe = nil
            if productAuthority != nil {
                // A fresh probe proves model delivery, not continuity of the
                // old prompt across a transport gap. Require a new observed
                // prompt and proposal; already claimed reports remain bound.
                try retireUnusableObservation()
            } else { try revokeDelivery() }
        }
        if let value = probe, !observationIsLive(expires: value.expires, continuous: value.expiresNanoseconds, at: instant) { probe = nil }
        if let value = readyUntil, !observationIsLive(expires: value, continuous: readyUntilNanoseconds, at: instant) {
            readyUntil = nil
            readyReference = nil
        }
        if let delivery = pending, !productReferenceIsLive(delivery.expiresNanoseconds) { try revokeDelivery() }
    }

    private func revokeDelivery() throws {
        guard let value = pending else { return }
        pending = nil
        if boundary?.binding == value.binding { boundary?.card = nil }
        try invalidate(value.binding)
    }

    private func retireCurrentUnclaimed() throws {
        let previous = boundary
        boundary?.card = nil
        stoppedPromptID = nil
        if productAuthority != nil { productProjectionDirty = true; productBackground = .unknown }
        try revokeDelivery()
        if let previous, previous.attemptedActivation { try invalidate(previous.binding) }
    }

    private func retireUnusableObservation() throws {
        readyUntil = nil
        readyReference = nil
        probe = nil
        defer {
            boundary = nil
            latestPromptID = nil
            stoppedPromptID = nil
            currentProductPrompt = nil
            if productAuthority != nil { productObservation = "new_prompt_required"; productFailure = nil }
        }
        try retireCurrentUnclaimed()
    }

    private func invalidate(_ binding: CoordinatorBinding) throws {
        do { _ = try core("invalidate", fields: ["binding": binding.jsonObject]) }
        catch let error as CoordinatorError where ["unknown_decision_boundary", "decision_boundary_already_closed"].contains(error.code) {
            // These are terminal/never-admitted facts, not restored authority.
        }
    }

    private func end() {
        revoked = true
        readyUntil = nil
        probe = nil
        heartbeat = nil
        bridgeID = nil
        pending = nil
        claims.removeAll()
        productClaimReferences.removeAll()
        currentProductPrompt = nil
        readyReference = nil
        productProjection = nil
        productObservationRetirementPending = false
        productDeliveryRevocationPending = false
        if let authority = productAuthority { authority.revoke(reason: .sessionEnded) }
        else if let boundary, boundary.attemptedActivation { try? invalidate(boundary.binding) }
        boundary = nil
    }

    private func refreshedSnapshot(forPet: Bool = false) throws -> [String: Any] {
        let result = try core(forPet ? "pet.snapshot" : "snapshot", role: forPet ? "selector" : "bridge")
        if let card = boundary?.card, let cards = result["cards"] as? [[String: Any]],
           !cards.contains(where: { ($0["packet"] as? [String: Any])?["packet_id"] as? String == card.packetID }) {
            boundary?.card = nil
        }
        if let outcomes = result["outcomes"] as? [[String: Any]] { reconcileClaims(outcomes) }
        return result
    }

    private func reconcileClaims(_ outcomes: [[String: Any]]) {
        for outcome in outcomes {
            guard outcome["reported_by"] as? String == "model", let id = outcome["selection_id"] as? String,
                  let original = claims[id], let object = outcome["binding"] as? [String: Any],
                  let binding = try? CoordinatorBinding(jsonObject: object), binding == original else { continue }
            claims.removeValue(forKey: id)
            productClaimReferences.removeValue(forKey: id)
        }
    }

    private func freshBoundary(promptID: String, episode: CoordinatorBinding? = nil) throws -> Boundary {
        Boundary(binding: try CoordinatorBinding(projectID: scope.projectID, sessionID: scope.sessionID,
            // This is explicitly an INTERNAL core turn; Claude has not issued
            // a native turn ID. Native prompt observations remain unmodified.
            sourceTurnID: "claude_internal_turn_" + Self.id(), sourcePromptID: promptID,
            episodeID: episode?.episodeID ?? "claude_internal_episode_" + Self.id(),
            episodeRootPromptID: episode?.episodeRootPromptID ?? promptID,
            episodeBaselineCheckpointID: episode?.episodeBaselineCheckpointID ?? "claude_unavailable_checkpoint_" + Self.id(),
            decisionBoundaryID: Self.id(), boundarySequence: 1))
    }

    private func core(_ operation: String, fields: [String: Any] = [:], role: String = "bridge") throws -> [String: Any] {
        var request = fields
        request["schema_version"] = ClaudeCoreAdapter.schemaVersion
        request["request_id"] = Self.id()
        request["operation"] = operation
        if let configuration = productConfiguration {
            productProjectionDirty = true
            let data = try ingress.handleProduct(request: StrictJSONTransport.data(forJSONObject: request),
                identity: configuration.identity, role: role,
                credential: role == "selector" ? scope.selectionToken : scope.bridgeToken)
            let response = try StrictJSONTransport.object(from: data)
            guard response["ok"] as? Bool == true, let result = response["result"] as? [String: Any] else {
                throw CoordinatorError((response["error"] as? [String: Any])?["code"] as? String ?? "claude_session_response_invalid")
            }
            return result
        }
        let envelope: [String: Any] = ["schema_version": ClaudeBridgeIngress.schemaVersion, "provider": "claude",
            "scope_id": scope.scopeID, "session_id": scope.sessionID, "role": role,
            "auth_token": role == "selector" ? scope.selectionToken : scope.bridgeToken, "request": request]
        let response = try StrictJSONTransport.object(from: ingress.handle(payload: StrictJSONTransport.data(forJSONObject: envelope)))
        guard response["ok"] as? Bool == true, let result = response["result"] as? [String: Any] else {
            throw CoordinatorError((response["error"] as? [String: Any])?["code"] as? String ?? "claude_session_response_invalid")
        }
        return result
    }

    private func requireBridge(_ request: [String: Any]) throws {
        guard let current = bridgeID, request["bridge_id"] as? String == current else { throw Self.error("bridge_mismatch") }
    }
    private func isConnected(at instant: Date) -> Bool {
        guard bridgeID != nil, let heartbeat else { return false }
        if let clock = productClock {
            guard let continuous = heartbeatNanoseconds else { return false }
            let observed = clock.nowNanoseconds()
            return observed >= continuous && observed - continuous < 5_000_000_000
        }
        let elapsed = instant.timeIntervalSince(heartbeat)
        return elapsed >= 0 && elapsed < Self.heartbeatLifetime
    }
    private func isReady(at instant: Date) -> Bool {
        !productObservationRetirementPending && isConnected(at: instant) && (readyUntil.map {
            observationIsLive(expires: $0, continuous: readyUntilNanoseconds, at: instant)
        } ?? false)
    }

    private func observationIsLive(expires: Date, continuous: UInt64?, at instant: Date) -> Bool {
        if let clock = productClock { return continuous.map { clock.nowNanoseconds() < $0 } ?? false }
        return expires > instant
    }

    private func productReferenceIsLive(_ deadline: UInt64?) -> Bool {
        guard let clock = productClock else { return true }
        return deadline.map { clock.nowNanoseconds() < $0 } ?? false
    }

    private func productDeadline(after lifetime: UInt64) throws -> UInt64? {
        guard let clock = productClock else { return nil }
        let (deadline, overflow) = clock.nowNanoseconds().addingReportingOverflow(lifetime)
        guard !overflow else { throw Self.error("time_invalid") }
        return deadline
    }
    private func hookResult() -> [String: Any] {
        ["boundary_id": boundary?.binding.decisionBoundaryID as Any? ?? NSNull(),
         "prompt_id": latestPromptID as Any? ?? NSNull()]
    }

    private func assertSafeRequest(_ request: [String: Any], operation: String) throws {
        for (key, value) in request {
            if (operation == "readiness.ack" && key == "nonce") || (operation == "selection.claim" && key == "delivery_token") {
                // Only this exact confirmation slot may carry a Channel ref.
                try assertPublic(value, includeReferences: false)
            } else {
                guard !Self.secretKeys.contains(key) else { throw Self.error("secret_reflection") }
                try assertPublic(key, includeReferences: true)
                try assertPublic(value, includeReferences: true)
            }
        }
    }
    private func assertPublic(_ value: Any, includeReferences: Bool) throws {
        if let text = value as? String {
            let data = Data(text.utf8)
            guard !secretCorpus.containsKnownSecret(in: data),
                  !includeReferences || !containsChannelReference(in: data) else { throw Self.error("secret_reflection") }
        } else if let array = value as? [Any] {
            for child in array { try assertPublic(child, includeReferences: includeReferences) }
        } else if let object = value as? [String: Any] {
            for (key, child) in object {
                // Poll intentionally publishes only its own transient refs.
                guard !Self.secretKeys.contains(key) || (!includeReferences && ["nonce", "delivery_token"].contains(key)) else {
                    throw Self.error("secret_reflection")
                }
                try assertPublic(key, includeReferences: includeReferences)
                try assertPublic(child, includeReferences: includeReferences)
            }
        }
    }
    private func activeChannelReferences() -> [String] {
        [probe?.nonce, readyReference, pending?.token].compactMap { $0 } + Array(productClaimReferences.values)
    }
    private func containsChannelReference(in data: Data) -> Bool {
        if productAuthority == nil { return channelReferences.containsKnownSecret(in: data) }
        return activeChannelReferences().contains { data.range(of: Data($0.utf8)) != nil }
    }
    private static let secretKeys: Set<String> = ["auth_token", "bridge_token", "selection_token", "hook_token", "control_token",
        "correlation_token", "continuation_token", "raw_continuation_token", "delivery_token", "session_token", "nonce"]
    private static func fields(_ request: [String: Any], _ required: Set<String>, optional: Set<String> = []) throws {
        let base: Set<String> = ["schema_version", "request_id", "operation"]
        let keys = Set(request.keys)
        guard base.union(required).isSubset(of: keys), keys.isSubset(of: base.union(required).union(optional)) else {
            throw error("invalid_request")
        }
    }
    private static func uuid(_ object: [String: Any], _ key: String) throws -> String {
        guard let value = object[key] as? String, isUUID(value) else { throw error("invalid_request") }
        return value
    }
    private static func isUUID(_ value: String) -> Bool { value.utf8.count == 36 && UUID(uuidString: value) != nil }
    private static func id() -> String { UUID().uuidString.lowercased() }
    private static func error(_ suffix: String) -> CoordinatorError { CoordinatorError("claude_session_" + suffix) }
    private static func reference() -> String {
        SymmetricKey(size: .bits256).withUnsafeBytes { $0.map { String(format: "%02x", $0) }.joined() }
    }
    private static func epochMilliseconds(_ value: Date) -> Int64 { Int64(value.timeIntervalSince1970 * 1000) }
    private static func probeContent(id: String, nonce: String) -> String {
        "Blabee connection probe. Call ack_readiness_probe_v1 with these values; do not run a task.\n"
            + "{\"probe_id\":\"\(id)\",\"nonce\":\"\(nonce)\"}"
    }
    private static func selectionContent(id: String, token: String) -> String {
        "Blabee selection reference. Call claim_selection_v1 with these values; execute only the returned action after a successful claim.\n"
            + "{\"selection_id\":\"\(id)\",\"delivery_token\":\"\(token)\"}"
    }
    private static func probeWrapper(_ value: Probe, source: String) -> String {
        "<channel source=\"\(source)\" kind=\"readiness_probe\" probe_id=\"\(value.id)\">\n\(value.content)\n</channel>"
    }
    private static func selectionWrapper(_ value: Delivery, source: String) -> String {
        "<channel source=\"\(source)\" selection_id=\"\(value.selectionID)\">\n\(value.content)\n</channel>"
    }
    private static func matches(digest: String, content: String, wrapper: String) -> Bool {
        // Deliberately narrow fixture compatibility, not every possible native
        // renderer. Unknown text follows the ordinary-new-input invalidation.
        [content, wrapper].contains { text in
            SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() == digest
        }
    }
}
