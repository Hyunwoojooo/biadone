import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation
import Security

/// The common service owns every product scope and its storage descriptor.
/// Enrollment is an in-process port used ONLY by the verified private owner
/// endpoint. Public UUIDs and a parsed envelope are not authentication evidence.
/// Product sessions never expose an adapter/native-v1 bypass.
final class ClaudeSessionRegistry: @unchecked Sendable {
    typealias FreshnessFactory = @Sendable (String) throws -> any FreshnessAnchorStore
    typealias Mapping = ClaudeSessionMetadataStore.Mapping

    struct ScopeSummary: Sendable {
        enum State: String, Sendable { case registering, awaitingNativeStart, historyOnly, quarantined }
        let scopeID: UUID
        let state: State
        let mapping: Mapping?
    }

    /// Public references only. Possessing this descriptor does not authenticate
    /// a Pet; the app's separate private bootstrap protects the calling port.
    struct PetSessionDescriptor: Sendable {
        enum State: String, Sendable { case awaitingNativeStart, active, disconnected }
        let mapping: Mapping
        let state: State
        let uiGeneration: UInt64
    }

    private final class Entry: @unchecked Sendable {
        let mapping: Mapping
        let authority: ClaudeSessionAuthority
        let journal: SQLiteJournal
        let coreFreshness: any FreshnessAnchorStore
        let metadata: ClaudeSessionMetadataStore
        let leases: [CoordinatorAuthorityLease]
        // Hook/bridge/owner leave memory only through the one-use grant FD.
        // Selector stays private to the service for future Pet integration.
        let capabilities: [String: String]
        let executionLock = NSLock()
        let maintenanceLock = NSLock()
        var maintenanceScheduled = false
        var native: ClaudeNativeSession?
        // Only live authenticated enrollment supplies this first observation.
        // It is consumed once by lazy native creation and is never persisted
        // or recovered from historical metadata.
        var initialStart: ClaudeProductInitialStart?
        let presentationLock = NSLock()
        var presentationGeneration: UInt64 = 0
        var presentationDigest: Data?
        var presentationState: PetSessionDescriptor.State = .awaitingNativeStart

        init(mapping: Mapping, authority: ClaudeSessionAuthority, journal: SQLiteJournal,
             coreFreshness: any FreshnessAnchorStore, metadata: ClaudeSessionMetadataStore,
             leases: [CoordinatorAuthorityLease], capabilities: [String: String],
             initialStart: ClaudeProductInitialStart?) {
            self.mapping = mapping
            self.authority = authority
            self.journal = journal
            self.coreFreshness = coreFreshness
            self.metadata = metadata
            self.leases = leases
            self.capabilities = capabilities
            self.initialStart = initialStart
        }

        var petDescriptor: PetSessionDescriptor {
            presentationLock.withLock {
                PetSessionDescriptor(mapping: mapping, state: presentationState, uiGeneration: presentationGeneration)
            }
        }
    }

    private struct ReplayPort: ClaudeNativeReplayPort {
        let body: @Sendable (ClaudeReplayKey, UUID) throws -> Void
        func consume(_ key: ClaudeReplayKey, operationID: UUID) throws { try body(key, operationID) }
    }

    let serviceIncarnation: UUID
    let runtimeIdentity: String
    let rootURL: URL
    private let scopesURL: URL
    private let authorityURL: URL
    private let registryLease: CoordinatorAuthorityLease
    private let secretCorpus: RuntimeSecretCorpus
    private let codec: ClaudeProductWireCodec
    private let freshnessFactory: FreshnessFactory
    private let clock: any CoordinatorContinuousClock
    private let wallNow: @Sendable () -> Date
    private let allowedChannelSources: Set<String>
    private let newID: @Sendable () -> UUID
    private let lock = NSLock()
    private let historyLock = NSLock()
    private let maintenanceQueue = DispatchQueue(label: "com.blabee.claude.maintenance", attributes: .concurrent)
    private var entries: [UUID: Entry] = [:]
    private var reservations: [UUID: Mapping] = [:]
    // Only recent in-process disconnects are retained for UI explanation. Disk
    // history has a separate authenticated read path and is never scanned here.
    private var disconnectedPetSessions: [PetSessionDescriptor] = []
    private var stopped = false

    init(rootURL: URL, runtimeIdentity: String, serviceIncarnation: UUID = UUID(),
         allowedChannelSources: Set<String> = ["blabee-claude"],
         secretCorpus: RuntimeSecretCorpus,
         freshnessFactory: @escaping FreshnessFactory = { try KeychainFreshnessAnchorStore(account: $0) },
         clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
         wallNow: @escaping @Sendable () -> Date = { Date() },
         newID: @escaping @Sendable () -> UUID = { UUID() }) throws {
        guard OperationalRuntimeIdentity.isValid(runtimeIdentity), !allowedChannelSources.isEmpty else {
            throw CoordinatorError("claude_registry_configuration_invalid")
        }
        self.rootURL = try ClaudeBridgeConfiguration.normalizedURL(rootURL)
        self.runtimeIdentity = runtimeIdentity
        self.serviceIncarnation = serviceIncarnation
        self.allowedChannelSources = allowedChannelSources
        self.secretCorpus = secretCorpus
        self.codec = ClaudeProductWireCodec(credentialCorpus: secretCorpus)
        self.freshnessFactory = freshnessFactory
        self.clock = clock
        self.wallNow = wallNow
        self.newID = newID
        scopesURL = try ClaudeBridgeConfiguration.privateChild(of: self.rootURL, name: "scopes")
        authorityURL = try ClaudeBridgeConfiguration.privateChild(of: self.rootURL, name: "authority")
        registryLease = try CoordinatorAuthorityLease(
            databaseURL: self.rootURL.appendingPathComponent("registry"),
            authorityRootURL: authorityURL, includesPrimaryNamespace: false
        )
    }

    deinit { disconnectAll() }

    /// Only the already-authenticated, still-live private owner endpoint calls
    /// this port. A JSON identity alone is never owner authentication.
    func control(connectionID: UUID, request: ClaudeProductWireCodec.Envelope) throws -> Data {
        guard request.contract == .owner, request.kind == .request,
              request.provider == .claude, request.role == "owner",
              ["renew", "end"].contains(request.operation) else {
            throw CoordinatorError("claude_owner_forbidden")
        }
        let original = try StrictJSONTransport.object(from: request.canonicalJSON)
        let identity = try Self.identity(in: original)
        guard identity.serviceIncarnation == serviceIncarnation,
              identity.ownerConnectionID == connectionID else {
            throw CoordinatorError("claude_session_unauthorized")
        }
        let entry = lock.withLock { entries[identity.scopeID] }
        var response = original
        response.removeValue(forKey: "payload")
        response["kind"] = "response"
        do {
            guard let entry, entry.mapping.authority == identity else {
                throw CoordinatorError("unauthorized")
            }
            let payload = original["payload"] as? [String: Any] ?? [:]
            if request.operation == "renew" {
                guard let value = payload["renewal_sequence"] as? String, let sequence = UInt64(value) else {
                    throw CoordinatorError("invalid_request")
                }
                let lease = try entry.authority.renew(owner: entry.authority.ownerHandle, sequence: sequence)
                response["result"] = ["lease": [
                    "deadline_nanoseconds": String(lease.deadlineNanoseconds),
                    "renewal_sequence": String(lease.renewalSequence),
                ]]
            } else {
                _ = try entry.authority.authorize(identity: identity)
                let reason: ClaudeSessionAuthority.RevocationReason
                switch payload["reason"] as? String {
                case "owner_disconnected": reason = .ownerDisconnected
                case "child_exited": reason = .childExited
                case "session_ended": reason = .sessionEnded
                case "user_disconnected": reason = .userDisconnected
                case "service_replaced": reason = .serviceReplaced
                default: throw CoordinatorError("invalid_request")
                }
                entry.authority.revoke(reason: reason)
                lock.withLock { removeEntryLocked(entry) }
                response["result"] = ["ended": true]
            }
            response["ok"] = true
        } catch {
            response["ok"] = false
            response["error"] = ["code": Self.productErrorCode(error)]
        }
        return try codec.encodeResponse(response, matching: request,
            connection: .init(serviceIncarnation: serviceIncarnation, ownerConnectionID: connectionID))
    }

    private static func identity(in envelope: [String: Any]) throws -> ClaudeSessionAuthority.Identity {
        guard let value = envelope["authority"] as? [String: String],
              let scope = UUID(uuidString: value["scope_id"] ?? ""),
              let native = UUID(uuidString: value["native_session_id"] ?? ""),
              let session = UUID(uuidString: value["session_incarnation"] ?? ""),
              let service = UUID(uuidString: value["service_incarnation"] ?? ""),
              let owner = UUID(uuidString: value["owner_connection_id"] ?? ""),
              let epoch = UUID(uuidString: value["authority_epoch"] ?? "") else {
            throw CoordinatorError("claude_session_unauthorized")
        }
        return .init(scopeID: scope, nativeSessionID: native, sessionIncarnation: session,
                     serviceIncarnation: service, ownerConnectionID: owner, authorityEpoch: epoch)
    }

    private static func productErrorCode(_ error: any Error) -> String {
        if let authority = error as? ClaudeSessionAuthority.AuthorityError {
            switch authority {
            case .terminated(.expired): return "expired"
            case .terminated: return "revoked"
            case .invalidRenewalSequence: return "invalid_request"
            case .identityMismatch, .ownerMismatch, .staleTicket: return "stale_authority"
            }
        }
        if let code = (error as? CoordinatorError)?.code, ["unauthorized", "invalid_request"].contains(code) {
            return code
        }
        return "unavailable"
    }

    /// Called after the private endpoint has consumed its authenticated
    /// connection challenge and the one-use, validated anonymous pipe FD.
    func enroll(connectionID: UUID, request: ClaudeProductWireCodec.Envelope,
                deliverGrant: (Data) throws -> Void) throws -> Data {
        guard request.contract == .owner, request.kind == .request,
              request.provider == .claude, request.role == "owner",
              ["enroll", "enroll_observed"].contains(request.operation) else {
            throw CoordinatorError("claude_enrollment_rejected")
        }
        let object = try StrictJSONTransport.object(from: request.canonicalJSON)
        guard let payload = object["payload"] as? [String: Any],
              payload["service_incarnation"] as? String == serviceIncarnation.uuidString.lowercased(),
              payload["owner_connection_id"] as? String == connectionID.uuidString.lowercased(),
              let cwd = payload["cwd"] as? String,
              let channelSource = payload["channel_source"] as? String,
              allowedChannelSources.contains(channelSource),
              let grantPipeID = payload["grant_pipe_id"] as? String else {
            throw CoordinatorError("claude_enrollment_rejected")
        }
        try Self.requireCanonicalProject(cwd)
        let initialStart: ClaudeProductInitialStart?
        if request.operation == "enroll_observed" {
            guard let nativeID = (payload["native_session_id"] as? String).flatMap(UUID.init(uuidString:)),
                  let source = (payload["source"] as? String).flatMap(ClaudeProductInitialStart.Source.init(rawValue:)) else {
                throw CoordinatorError("claude_enrollment_rejected")
            }
            initialStart = ClaudeProductInitialStart(nativeSessionID: nativeID, canonicalCWD: cwd, source: source)
        } else { initialStart = nil }
        let identity = ClaudeSessionAuthority.Identity(
            scopeID: newID(), nativeSessionID: initialStart?.nativeSessionID ?? newID(), sessionIncarnation: newID(),
            serviceIncarnation: serviceIncarnation, ownerConnectionID: connectionID, authorityEpoch: newID()
        )
        let mapping = Mapping(authority: identity,
            coreProjectID: "claude_project_" + newID().uuidString.lowercased(),
            coreSessionID: "claude_session_" + newID().uuidString.lowercased(),
            canonicalCWD: cwd, channelSource: channelSource, runtimeIdentity: runtimeIdentity)
        // The caller cannot select paths/accounts, recover an old directory,
        // or alias another descriptor. Reject collisions before any store init.
        try lock.withLock {
            let activeMappings = entries.values.map(\.mapping) + Array(reservations.values)
            guard !stopped, activeMappings.count < 32,
                  !activeMappings.contains(where: { $0.authority.ownerConnectionID == connectionID }),
                  entries[identity.scopeID] == nil, reservations[identity.scopeID] == nil,
                  !activeMappings.contains(where: { $0.coreSessionID == mapping.coreSessionID }),
                  !Self.entryExists(scopesURL.appendingPathComponent(identity.scopeID.uuidString.lowercased())) else {
                throw CoordinatorError("claude_scope_collision")
            }
            reservations[identity.scopeID] = mapping
        }
        defer { lock.withLock { _ = reservations.removeValue(forKey: identity.scopeID) } }
        let scope = try createExclusiveScope(identity.scopeID)
        let paths = try ScopePaths(scope: scope, create: true)
        let leases = try [paths.coreDatabase, paths.metadataDatabase].map {
            try CoordinatorAuthorityLease(databaseURL: $0, authorityRootURL: authorityURL,
                                          includesPrimaryNamespace: false)
        }
        let authority = try ClaudeSessionAuthority(identity: identity, clock: clock)
        let tokens = try Self.roleCapabilities()
        for token in tokens.values { secretCorpus.register(token) }
        let coreFreshness = try freshnessFactory(Self.account(paths.coreDatabase, family: "core"))
        let metadata = try ClaudeSessionMetadataStore(
            databaseURL: paths.metadataDatabase, keyURL: paths.metadataKey, coreKeyURL: paths.coreKey,
            freshnessStore: freshnessFactory(Self.account(paths.metadataDatabase, family: "metadata")),
            secretCorpus: secretCorpus, creating: mapping, coreCheckpoint: nil
        )
        var journal: SQLiteJournal?
        do {
            try metadata.withMutation(operationID: request.requestID,
                readCoreCheckpoint: {
                    guard let journal else { return nil }
                    return try Self.checkpoint(journal: journal, freshness: coreFreshness)
                }) {
                    journal = try SQLiteJournal(databaseURL: paths.coreDatabase, keyURL: paths.coreKey,
                        freshnessStore: coreFreshness, secretCorpus: secretCorpus,
                        appendCommitGate: { commit in
                            let ticket = try authority.authorize(identity: identity)
                            try authority.withMutationFence(ticket, commit)
                        })
                    try Self.secureCoreFiles(paths.coreDatabase)
                }
            guard let journal else { throw CoordinatorError("claude_scope_initialization_failed") }
            let checkpoint = try Self.checkpoint(journal: journal, freshness: coreFreshness)
            _ = try metadata.authenticatedSummary(coreCheckpoint: checkpoint)
            let ticket = try authority.authorize(identity: identity)
            guard case .active(let lease) = authority.snapshot() else {
                throw CoordinatorError("claude_authority_unavailable")
            }
            // No credential is exposed until both journals are consistent.
            // A pipe write failure never registers a live scope.
            let response = try authority.withMutationFence(ticket) {
                return try enrollmentResponse(request: request, identity: identity,
                    coreSessionID: mapping.coreSessionID, grantPipeID: grantPipeID, lease: lease)
            }
            let grant = try StrictJSONTransport.data(forJSONObject: [
                "schema_version": "blabee.claude-private-grant.v1",
                "authority": Self.authorityObject(identity),
                "core_project_id": mapping.coreProjectID, "core_session_id": mapping.coreSessionID,
                "role_capabilities": tokens.filter { $0.key != "selector" },
            ])
            try deliverGrant(grant)
            // Recheck after a potentially blocked pipe. An expired grant may
            // be in the owner pipe but cannot be activated or renewed.
            _ = try authority.authorize(identity: identity)
            try lock.withLock {
                guard !stopped, reservations[identity.scopeID]?.authority.ownerConnectionID == connectionID else {
                    throw CoordinatorError("claude_owner_disconnected")
                }
                entries[identity.scopeID] = Entry(mapping: mapping, authority: authority,
                    journal: journal, coreFreshness: coreFreshness, metadata: metadata,
                    leases: leases, capabilities: tokens, initialStart: initialStart)
                reservations.removeValue(forKey: identity.scopeID)
            }
            return response
        } catch {
            authority.revoke(reason: .ownerDisconnected)
            throw CoordinatorError("claude_enrollment_unavailable")
        }
    }

    func disconnect(connectionID: UUID) {
        let revoked: [Entry] = lock.withLock {
            reservations = reservations.filter { $0.value.authority.ownerConnectionID != connectionID }
            let scopes = entries.filter { $0.value.mapping.authority.ownerConnectionID == connectionID }.map(\.key)
            return scopes.compactMap { scope in
                guard let entry = entries[scope] else { return nil }
                removeEntryLocked(entry)
                return entry
            }
        }
        for entry in revoked { entry.authority.revoke(reason: .ownerDisconnected) }
    }

    func disconnectAll() {
        let revoked: [Entry] = lock.withLock {
            stopped = true
            let result = Array(entries.values)
            for entry in result { rememberPetDisconnectLocked(entry) }
            entries.removeAll()
            reservations.removeAll()
            return result
        }
        for entry in revoked { entry.authority.revoke(reason: .serviceReplaced) }
    }

    var activeScopeCount: Int { lock.withLock { entries.count } }

    /// Bounded in-memory directory. A busy scope returns its last verified
    /// descriptor, so one SQLite operation cannot block all other scopes.
    /// Actions always revalidate under that scope's serial executor.
    func petSessions(afterScopeID: UUID? = nil, limit: Int = 32) throws -> [PetSessionDescriptor] {
        guard (1...33).contains(limit) else { throw CoordinatorError("claude_pet_invalid_request") }
        let (active, disconnected) = lock.withLock { (Array(entries.values), disconnectedPetSessions) }
        var values = disconnected
        for entry in active {
            if entry.executionLock.try() {
                defer { entry.executionLock.unlock() }
                // Read-only projection failures cannot initialize native state
                // or turn a disk history record back into live authority.
                do { _ = try refreshPetPresentation(entry) }
                catch {
                    if case .terminated = entry.authority.snapshot() {
                        try? setPetPresentation(entry, state: .disconnected, projection: nil)
                    }
                }
            }
            values.append(entry.petDescriptor)
        }
        let after = afterScopeID?.uuidString.lowercased()
        return Array(values.filter { after == nil || $0.mapping.authority.scopeID.uuidString.lowercased() > after! }
            .sorted { $0.mapping.authority.scopeID.uuidString < $1.mapping.authority.scopeID.uuidString }.prefix(limit))
    }

    /// The caller must already authenticate the application selector bootstrap.
    /// No per-scope selector capability is accepted from or returned to the UI.
    func handlePet(request: ClaudeProductWireCodec.Envelope) throws -> Data {
        let checked = try codec.decodeRequest(request.canonicalJSON)
        guard checked.contract == .pet, checked.provider == .claude, checked.role == "selector" else {
            throw CoordinatorError("claude_pet_forbidden")
        }
        let object = try StrictJSONTransport.object(from: checked.canonicalJSON)
        let target = object["target"] as! [String: Any]
        let payload = object["payload"] as! [String: Any]
        var response = object
        response["kind"] = "response"
        response.removeValue(forKey: "payload")
        do {
            let entry = try petEntry(target: target)
            return try entry.executionLock.withLock {
                let projection = try refreshPetPresentation(entry)
                try requirePetTarget(target, entry: entry)
                let identity = entry.mapping.authority
                let ticket = try entry.authority.authorize(identity: identity)
                switch checked.operation {
                case "snapshot":
                    response["result"] = ["projection": ["schema_version": "blabee.pet.claude.v1", "value": projection]]
                case "select":
                    guard let native = entry.native else { throw CoordinatorError("claude_pet_unavailable") }
                    let binding = try CoordinatorBinding(jsonObject: payload["binding"] as! [String: Any])
                    guard binding.projectID == entry.mapping.coreProjectID,
                          binding.sessionID == entry.mapping.coreSessionID else {
                        throw CoordinatorError("claude_pet_binding_mismatch")
                    }
                    _ = try native.productSelect(identity: identity, credential: entry.capabilities["selector"]!,
                        binding: binding, packetID: payload["packet_id"] as! String,
                        revision: ExactJSONInteger.int64(payload["revision"], minimum: 1)!,
                        optionID: payload["option_id"] as! String,
                        selectionID: UUID(uuidString: payload["selection_id"] as! String)!)
                    _ = try native.processProductTime(identity: identity, credential: entry.capabilities["selector"]!)
                    _ = try refreshPetPresentation(entry)
                    response["result"] = ["selection": payload, "status": "awaiting_claude_claim"]
                case "readiness.begin":
                    guard let native = entry.native else { throw CoordinatorError("claude_pet_unavailable") }
                    let data = try native.beginProductReadiness(identity: identity, credential: entry.capabilities["selector"]!)
                    _ = try refreshPetPresentation(entry, forceAdvance: true)
                    response["result"] = try StrictJSONTransport.object(from: data)
                default: throw CoordinatorError("claude_pet_forbidden")
                }
                // Successful mutations echo the request generation as a
                // receipt. Only the next directory read issues the new target.
                response["ok"] = true
                let encoded = try codec.encodeResponse(response, matching: checked,
                    connection: .init(serviceIncarnation: serviceIncarnation))
                return try entry.authority.withMutationFence(ticket) { encoded }
            }
        } catch {
            response.removeValue(forKey: "result")
            response["ok"] = false
            response["error"] = ["code": Self.petErrorCode(error)]
        }
        return try codec.encodeResponse(response, matching: checked,
            connection: .init(serviceIncarnation: serviceIncarnation))
    }

    /// Disconnect is authority revocation only. The launcher receives renewal
    /// rejection and leaves the user's native Claude process running.
    func disconnectPet(target: [String: Any]) throws {
        let entry = try petEntry(target: target)
        try entry.executionLock.withLock {
            _ = try refreshPetPresentation(entry)
            try requirePetTarget(target, entry: entry)
            _ = try entry.authority.authorize(identity: entry.mapping.authority)
            entry.authority.revoke(reason: .userDisconnected)
            lock.withLock {
                removeEntryLocked(entry)
            }
        }
    }

    private func petEntry(target: [String: Any]) throws -> Entry {
        guard Set(target.keys) == ["scope_id", "service_incarnation", "session_incarnation", "authority_epoch", "ui_generation"],
              let scope = target["scope_id"] as? String, let id = UUID(uuidString: scope),
              id.uuidString.lowercased() == scope,
              let entry = lock.withLock({ entries[id] }) else {
            throw CoordinatorError("claude_pet_stale_authority")
        }
        return entry
    }

    private func requirePetTarget(_ target: [String: Any], entry: Entry) throws {
        let identity = entry.mapping.authority
        let descriptor = entry.petDescriptor
        guard target["scope_id"] as? String == identity.scopeID.uuidString.lowercased(),
              target["service_incarnation"] as? String == serviceIncarnation.uuidString.lowercased(),
              target["session_incarnation"] as? String == identity.sessionIncarnation.uuidString.lowercased(),
              target["authority_epoch"] as? String == identity.authorityEpoch.uuidString.lowercased(),
              target["ui_generation"] as? String == String(descriptor.uiGeneration),
              descriptor.state != .disconnected,
              lock.withLock({ entries[identity.scopeID] === entry }) else {
            throw CoordinatorError("claude_pet_stale_authority")
        }
    }

    /// Projection reads cannot create native state. Pre-start scopes display an
    /// explicit empty starting view until authenticated Hook/bridge input does.
    private func refreshPetPresentation(_ entry: Entry, forceAdvance: Bool = false) throws -> [String: Any] {
        let ticket = try entry.authority.authorize(identity: entry.mapping.authority)
        let projection: [String: Any]
        if let native = entry.native {
            projection = try StrictJSONTransport.object(from: native.productPetSnapshot(
                identity: entry.mapping.authority, credential: entry.capabilities["selector"]!))
        } else {
            projection = ["schema_version": "blabee.claude-pet.v1", "cards": [], "outcomes": [],
                "history": ["total_outcomes": 0, "omitted_outcomes": 0],
                "routing": ["schema_version": "1.0", "kind": "blabee_routing_snapshot", "selection_enabled": false,
                    "foreground": NSNull(), "pending": [], "in_flight_count": 0],
                "boundary_id": NSNull(), "ready": false, "bridge_connected": false, "selection_enabled": false,
                "pending_report_count": 0, "readiness_status": "starting",
                "native_observation": ["status": "starting", "background_state": "unknown",
                    "background_task_count": NSNull(), "failure_code": NSNull()]]
        }
        let state: PetSessionDescriptor.State = projection["readiness_status"] as? String == "starting"
            ? .awaitingNativeStart : .active
        try setPetPresentation(entry, state: state, projection: projection, forceAdvance: forceAdvance)
        return try entry.authority.withMutationFence(ticket) { projection }
    }

    private func setPetPresentation(_ entry: Entry, state: PetSessionDescriptor.State,
                                    projection: [String: Any]?, forceAdvance: Bool = false) throws {
        // Countdown changes are presentation details, not permission changes.
        // Expiry/readiness/selection/routing changes remain in this digest.
        func stable(_ value: Any) -> Any {
            if let object = value as? [String: Any] {
                return object.filter { $0.key != "milliseconds_until_expiry" }.mapValues(stable)
            }
            if let array = value as? [Any] { return array.map(stable) }
            return value
        }
        let digest = try projection.map { Data(SHA256.hash(data: try StrictJSONTransport.data(forJSONObject: stable($0)))) }
        try entry.presentationLock.withLock {
            let changed = entry.presentationState != state
                || (entry.presentationDigest != nil && entry.presentationDigest != digest)
            if changed || forceAdvance {
                let (generation, overflow) = entry.presentationGeneration.addingReportingOverflow(1)
                guard !overflow else { throw CoordinatorError("claude_pet_capacity") }
                entry.presentationGeneration = generation
            }
            entry.presentationState = state
            entry.presentationDigest = digest
        }
    }

    /// Registry lock is held. No native/core operation or scope execution lock
    /// is taken while recording these bounded, non-authoritative UI entries.
    private func rememberPetDisconnectLocked(_ entry: Entry) {
        let descriptor = entry.petDescriptor
        disconnectedPetSessions.removeAll { $0.mapping.authority.scopeID == descriptor.mapping.authority.scopeID }
        disconnectedPetSessions.append(PetSessionDescriptor(mapping: descriptor.mapping, state: .disconnected,
            uiGeneration: descriptor.uiGeneration == UInt64.max ? UInt64.max : descriptor.uiGeneration + 1))
        if disconnectedPetSessions.count > 32 { disconnectedPetSessions.removeFirst(disconnectedPetSessions.count - 32) }
    }

    private func removeEntryLocked(_ entry: Entry) {
        guard entries[entry.mapping.authority.scopeID] === entry else { return }
        entries.removeValue(forKey: entry.mapping.authority.scopeID)
        rememberPetDisconnectLocked(entry)
    }

    private static func petErrorCode(_ error: any Error) -> String {
        if let code = (error as? CoordinatorError)?.code {
            switch code {
            case "claude_pet_stale_authority": return "stale_authority"
            case "claude_pet_binding_mismatch", "claude_session_boundary_mismatch", "claude_metadata_replay": return "binding_mismatch"
            case "claude_pet_forbidden": return "forbidden"
            case "claude_pet_invalid_request": return "invalid_request"
            case "claude_pet_capacity": return "capacity"
            default: break
            }
        }
        return productErrorCode(error)
    }

    /// One queued job per scope. Storage work must never block the common
    /// scheduler, even while another request owns this scope's executor.
    func processTime() {
        for entry in lock.withLock({ Array(entries.values) }) {
            let schedule = entry.maintenanceLock.withLock {
                guard !entry.maintenanceScheduled else { return false }
                entry.maintenanceScheduled = true
                return true
            }
            guard schedule else { continue }
            maintenanceQueue.async { [weak self, entry] in
                defer { entry.maintenanceLock.withLock { entry.maintenanceScheduled = false } }
                guard let self else { return }
                do {
                    try entry.executionLock.withLock {
                        _ = try entry.authority.authorize(identity: entry.mapping.authority)
                        if let native = entry.native {
                            _ = try native.processProductTime(identity: entry.mapping.authority,
                                credential: entry.capabilities["selector"]!)
                            _ = try native.beginInitialProductReadiness(identity: entry.mapping.authority,
                                credential: entry.capabilities["selector"]!)
                        }
                        _ = try self.refreshPetPresentation(entry)
                    }
                } catch { self.retire(entry) }
            }
        }
    }

    func millisecondsUntilNextDeadline() -> Int32? {
        var deadline: UInt64?
        for entry in lock.withLock({ Array(entries.values) }) {
            do {
                let next: UInt64
                if entry.executionLock.try() {
                    defer { entry.executionLock.unlock() }
                    _ = try entry.authority.authorize(identity: entry.mapping.authority)
                    guard case .active(let lease) = entry.authority.snapshot() else {
                        throw CoordinatorError("claude_session_unauthorized")
                    }
                    let native = try entry.native?.nextProductWakeNanoseconds(identity: entry.mapping.authority,
                        credential: entry.capabilities["selector"]!)
                    next = min(lease.deadlineNanoseconds, native ?? lease.deadlineNanoseconds)
                } else {
                    // A core COMMIT may hold authority's fence lock. Do not
                    // inspect authority until this scope's executor is free.
                    let (retry, overflow) = clock.nowNanoseconds().addingReportingOverflow(100_000_000)
                    next = overflow ? UInt64.max : retry
                }
                deadline = min(deadline ?? next, next)
            } catch { retire(entry) }
        }
        guard let deadline else { return nil }
        let now = clock.nowNanoseconds()
        guard deadline > now else { return 0 }
        let remaining = deadline - now
        let milliseconds = remaining / 1_000_000 + (remaining % 1_000_000 == 0 ? 0 : 1)
        return Int32(min(UInt64(Int32.max), milliseconds))
    }

    /// Test observation only; production never waits for asynchronous work.
    var hasScheduledTimeWork: Bool {
        lock.withLock { Array(entries.values) }.contains { entry in
            entry.maintenanceLock.withLock { entry.maintenanceScheduled }
        }
    }

    private func retire(_ entry: Entry) {
        entry.authority.revoke(reason: .serviceReplaced)
        lock.withLock { removeEntryLocked(entry) }
    }

    /// A read-only projection: it never constructs a routing application,
    /// advances due timers, restores a grant, or calls a native/bridge adapter.
    func summaries() throws -> [ScopeSummary] {
        try historyLock.withLock { try summariesSerially() }
    }

    private func summariesSerially() throws -> [ScopeSummary] {
        let disk: [URL]
        do { disk = try FileManager.default.contentsOfDirectory(at: scopesURL, includingPropertiesForKeys: nil) }
        catch {
            disconnectAll()
            throw CoordinatorError("claude_storage_unavailable")
        }
        let known = lock.withLock { Set(entries.keys).union(reservations.keys) }
        let all = Set(disk).union(known.map { scopesURL.appendingPathComponent($0.uuidString.lowercased()) })
        return all
            .compactMap { scope -> ScopeSummary? in
                guard let id = UUID(uuidString: scope.lastPathComponent),
                      id.uuidString.lowercased() == scope.lastPathComponent else { return nil }
                let (reservation, current) = lock.withLock { (reservations[id], entries[id]) }
                if let mapping = reservation {
                    return ScopeSummary(scopeID: id, state: .registering, mapping: mapping)
                }
                do {
                    if let entry = current {
                        try entry.executionLock.withLock {
                            _ = try ScopePaths(scope: scope, create: false)
                            _ = try entry.metadata.authenticatedSummary(
                                coreCheckpoint: Self.checkpoint(journal: entry.journal, freshness: entry.coreFreshness)
                            )
                        }
                        if case .active = entry.authority.snapshot(), lock.withLock({ entries[id] === entry }) {
                            return ScopeSummary(scopeID: id, state: .awaitingNativeStart, mapping: entry.mapping)
                        }
                        lock.withLock { removeEntryLocked(entry) }
                        return ScopeSummary(scopeID: id, state: .historyOnly, mapping: entry.mapping)
                    }
                    let paths = try ScopePaths(scope: scope, create: false)
                    let leases = try [paths.coreDatabase, paths.metadataDatabase].map {
                        try CoordinatorAuthorityLease(databaseURL: $0, authorityRootURL: authorityURL,
                                                      includesPrimaryNamespace: false)
                    }
                    return try withExtendedLifetime(leases) {
                        let coreFreshness = try freshnessFactory(Self.account(paths.coreDatabase, family: "core"))
                        let journal = try SQLiteJournal(databaseURL: paths.coreDatabase, keyURL: paths.coreKey,
                            freshnessStore: coreFreshness, secretCorpus: secretCorpus)
                        let metadata = try ClaudeSessionMetadataStore(
                            databaseURL: paths.metadataDatabase, keyURL: paths.metadataKey, coreKeyURL: paths.coreKey,
                            freshnessStore: freshnessFactory(Self.account(paths.metadataDatabase, family: "metadata")),
                            secretCorpus: secretCorpus, opening: id
                        )
                        let history = try metadata.authenticatedSummary(
                            coreCheckpoint: Self.checkpoint(journal: journal, freshness: coreFreshness)
                        )
                        return ScopeSummary(scopeID: id, state: .historyOnly, mapping: history.mapping)
                    }
                } catch {
                    if let current {
                        lock.withLock { removeEntryLocked(current) }
                        current.authority.revoke(reason: .serviceReplaced)
                    }
                    return ScopeSummary(scopeID: id, state: .quarantined, mapping: nil)
                }
            }.sorted { $0.scopeID.uuidString < $1.scopeID.uuidString }
    }

    /// Credentials live in the transport wrapper, outside the secret-free v2
    /// envelope. Ordinary UDS carries only Hook/bridge capabilities as input.
    /// It cannot gain an owner or selector port by changing the role/type.
    func handleSession(_ payload: Data) throws -> Data {
        let wrapper = try StrictJSONTransport.object(from: payload, limits: .init(
            maximumBytes: ClaudeProductWireCodec.maximumMessageBytes + 1024,
            maximumDepth: ClaudeProductWireCodec.maximumDepth + 1))
        guard Set(wrapper.keys) == ["auth_token", "envelope"],
              let token = wrapper["auth_token"] as? String,
              token.utf8.count == 64, token.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let object = wrapper["envelope"] as? [String: Any] else {
            throw CoordinatorError("claude_session_unauthorized")
        }
        let request = try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: object))
        guard request.contract == .session, ["hook", "bridge"].contains(request.role) else {
            throw CoordinatorError("claude_session_unauthorized")
        }
        let identity = try Self.identity(in: object)
        guard identity.serviceIncarnation == serviceIncarnation,
              let entry = lock.withLock({ entries[identity.scopeID] }), entry.mapping.authority == identity else {
            throw CoordinatorError("claude_session_unauthorized")
        }
        let roles = ["hook", "bridge"].map { role in
            (role, ContinuationTokenMaterial.constantTimeEqual(token, entry.capabilities[role] ?? ""))
        }
        guard roles.contains(where: { $0.0 == request.role && $0.1 }) else {
            throw CoordinatorError("claude_session_unauthorized")
        }
        // The global registry lock is never held across native/metadata I/O.
        // EOF can revoke while a request is preparing its next commit.
        defer {
            if case .terminated = entry.authority.snapshot() {
                lock.withLock { removeEntryLocked(entry) }
            }
        }
        return try entry.executionLock.withLock {
            _ = try entry.authority.authorize(identity: identity)
            if entry.native == nil {
                do {
                    entry.native = try entry.metadata.withMutation(operationID: UUID(),
                        readCoreCheckpoint: { try Self.checkpoint(journal: entry.journal, freshness: entry.coreFreshness) }) {
                            try makeNative(entry)
                        }
                    // Prime outside the constructor's metadata bracket; the
                    // ingress snapshot has its own non-reentrant bracket.
                    _ = try entry.native?.processProductTime(identity: identity,
                        credential: entry.capabilities["selector"]!)
                } catch {
                    entry.authority.revoke(reason: .serviceReplaced)
                    throw CoordinatorError("claude_product_unavailable")
                }
            }
            guard let native = entry.native else { throw CoordinatorError("claude_product_unavailable") }
            let response = try native.handleProduct(request: request, credential: token)
            let result = try StrictJSONTransport.object(from: response)
            if result["ok"] as? Bool == true,
               request.operation == "bridge.open" || (request.operation == "hook"
                   && (object["payload"] as? [String: Any])?["event"] as? String == "SessionStart"
                   && (object["payload"] as? [String: Any])?["source"] as? String == "startup") {
                _ = try native.beginInitialProductReadiness(identity: identity, credential: entry.capabilities["selector"]!)
            }
            if request.operation != "bridge.poll", case .active = entry.authority.snapshot() {
                do {
                    _ = try native.processProductTime(identity: identity,
                        credential: entry.capabilities["selector"]!)
                } catch { retire(entry); throw error }
            }
            if case .active = entry.authority.snapshot() { _ = try refreshPetPresentation(entry) }
            let isEnd = request.operation == "hook"
                && (object["payload"] as? [String: Any])?["event"] as? String == "SessionEnd"
            if result["ok"] as? Bool == true, !isEnd {
                let ticket = try entry.authority.authorize(identity: identity)
                return try entry.authority.withMutationFence(ticket) { response }
            }
            return response
        }
    }

    private func makeNative(_ entry: Entry) throws -> ClaudeNativeSession {
        let mapping = entry.mapping
        let tokens = entry.capabilities
        let configuration = try ClaudeProductNativeConfiguration(identity: mapping.authority,
            coreProjectID: mapping.coreProjectID, coreSessionID: mapping.coreSessionID,
            canonicalCWD: mapping.canonicalCWD, channelSource: mapping.channelSource,
            hookToken: tokens["hook"]!, bridgeToken: tokens["bridge"]!, selectorToken: tokens["selector"]!)
        // Capture stores/authority, not Entry; Entry retains NativeSession.
        let metadata = entry.metadata, journal = entry.journal, freshness = entry.coreFreshness
        let authority = entry.authority
        let replay = ReplayPort { key, operationID in
            do {
                _ = try authority.authorize(identity: mapping.authority)
                try metadata.consumeReplayID(key, operationID: operationID,
                    readCoreCheckpoint: { try Self.checkpoint(journal: journal, freshness: freshness) })
                _ = try authority.authorize(identity: mapping.authority)
            } catch let error as CoordinatorError where error.code == "claude_metadata_replay" {
                throw error
            } catch {
                authority.revoke(reason: .serviceReplaced)
                throw error
            }
        }
        let native = try ClaudeNativeSession(productConfiguration: configuration, authority: authority,
            journal: journal, secretCorpus: secretCorpus, clock: clock, wallNow: wallNow, replayPort: replay,
            withCoreMutation: { operationID, binding, body in
                do {
                    return try metadata.withMutation(operationID: operationID, binding: binding,
                        readCoreCheckpoint: { try Self.checkpoint(journal: journal, freshness: freshness) }) {
                            let before = try Self.checkpoint(journal: journal, freshness: freshness)
                            let result = try body()
                            let response = try StrictJSONTransport.object(from: result)
                            if response["ok"] as? Bool == false {
                                // Invalid opaque DTOs may return a normal error
                                // only when no core commit occurred. A partial or
                                // unreadable commit must quarantine the scope.
                                guard try Self.checkpoint(journal: journal, freshness: freshness) == before else {
                                    throw CoordinatorError("claude_core_mutation_uncertain")
                                }
                            }
                            return result
                        }
                } catch {
                    authority.revoke(reason: .serviceReplaced)
                    throw error
                }
            }, initialStart: entry.initialStart)
        entry.initialStart = nil
        return native
    }

    private func enrollmentResponse(request: ClaudeProductWireCodec.Envelope,
                                    identity: ClaudeSessionAuthority.Identity, coreSessionID: String,
                                    grantPipeID: String, lease: ClaudeSessionAuthority.Lease) throws -> Data {
        try codec.encodeResponse([
            "schema_version": request.contract.rawValue, "kind": "response",
            "request_id": request.requestID.uuidString.lowercased(), "provider": "claude", "role": "owner",
            "operation": request.operation, "authority": Self.authorityObject(identity), "ok": true,
            "result": ["core_session_id": coreSessionID, "grant_delivery": "private_pipe",
                       "grant_pipe_id": grantPipeID,
                       "lease": ["deadline_nanoseconds": String(lease.deadlineNanoseconds), "renewal_sequence": "0"]],
        ], matching: request, connection: .init(serviceIncarnation: serviceIncarnation,
                                               ownerConnectionID: identity.ownerConnectionID))
    }

    static func authorityObject(_ value: ClaudeSessionAuthority.Identity) -> [String: String] {
        ["scope_id": value.scopeID.uuidString.lowercased(),
         "native_session_id": value.nativeSessionID.uuidString.lowercased(),
         "session_incarnation": value.sessionIncarnation.uuidString.lowercased(),
         "service_incarnation": value.serviceIncarnation.uuidString.lowercased(),
         "owner_connection_id": value.ownerConnectionID.uuidString.lowercased(),
         "authority_epoch": value.authorityEpoch.uuidString.lowercased()]
    }

    private func createExclusiveScope(_ id: UUID) throws -> URL {
        let descriptor = open(scopesURL.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw CoordinatorError("claude_storage_unsafe") }
        defer { close(descriptor) }
        let name = id.uuidString.lowercased()
        guard mkdirat(descriptor, name, 0o700) == 0 else { throw CoordinatorError("claude_scope_collision") }
        guard fsync(descriptor) == 0 else { throw CoordinatorError("claude_storage_unavailable") }
        return try ClaudeBridgeConfiguration.privateChild(of: scopesURL, name: name)
    }

    private static func roleCapabilities() throws -> [String: String] {
        var result: [String: String] = [:]
        for role in ["hook", "bridge", "owner", "selector"] {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                throw CoordinatorError("claude_capability_unavailable")
            }
            result[role] = bytes.map { String(format: "%02x", $0) }.joined()
        }
        guard Set(result.values).count == 4 else { throw CoordinatorError("claude_capability_unavailable") }
        return result
    }

    private static func checkpoint(journal: SQLiteJournal, freshness: any FreshnessAnchorStore) throws -> FreshnessCheckpoint {
        let snapshot = try journal.load()
        guard let stored = try freshness.load(), stored.record.state == .committed,
              stored.record.checkpoint.sequence == snapshot.journalSequence else {
            throw CoordinatorError("claude_core_checkpoint_unavailable")
        }
        _ = try CoordinatorSemanticReplay.replay(snapshot)
        return stored.record.checkpoint
    }

    static func account(_ database: URL, family: String) -> String {
        "claude-product-" + family + "-" + SHA256.hash(data: Data(database.path.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    private static func requireCanonicalProject(_ path: String) throws {
        guard ClaudeCanonicalDirectory.matches(path) else {
            throw CoordinatorError("claude_project_invalid")
        }
    }

    private static func entryExists(_ path: URL) -> Bool {
        var info = stat()
        return lstat(path.path, &info) == 0 || errno != ENOENT
    }

    private static func secureCoreFiles(_ database: URL) throws {
        // SQLite uses the process umask for new files. The surrounding scope is
        // already 0700; tighten only our new core files before publishing a grant.
        for suffix in ["", "-wal", "-shm"] {
            let descriptor = open(database.path + suffix, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
            if descriptor < 0, suffix != "", errno == ENOENT { continue }
            guard descriptor >= 0 else { throw CoordinatorError("claude_storage_unsafe") }
            defer { close(descriptor) }
            var info = stat()
            guard fstat(descriptor, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                  info.st_uid == geteuid(), info.st_nlink == 1, fchmod(descriptor, 0o600) == 0 else {
                throw CoordinatorError("claude_storage_unsafe")
            }
        }
    }

    private struct ScopePaths {
        let coreDatabase: URL
        let coreKey: URL
        let metadataDatabase: URL
        let metadataKey: URL
        init(scope: URL, create: Bool) throws {
            let core: URL
            let metadata: URL
            if create {
                core = try ClaudeBridgeConfiguration.privateChild(of: scope, name: "core")
                metadata = try ClaudeBridgeConfiguration.privateChild(of: scope, name: "metadata")
            } else {
                core = scope.appendingPathComponent("core")
                metadata = scope.appendingPathComponent("metadata")
                for directory in [scope, core, metadata] {
                    var info = stat()
                    // Foundation can render /private/var as /var even after
                    // resolving symlinks. Compare our canonical namespace.
                    let resolved = try ClaudeBridgeConfiguration.normalizedURL(directory.resolvingSymlinksInPath())
                    guard resolved.path == directory.path,
                          lstat(directory.path, &info) == 0,
                          info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR), info.st_uid == geteuid(),
                          info.st_mode & 0o7777 == 0o700 else { throw CoordinatorError("claude_storage_unsafe") }
                }
            }
            coreDatabase = core.appendingPathComponent("coordinator.sqlite3")
            coreKey = core.appendingPathComponent("coordinator.key")
            metadataDatabase = metadata.appendingPathComponent("metadata.sqlite3")
            metadataKey = metadata.appendingPathComponent("metadata.key")
            if !create {
                for file in [coreDatabase, coreKey, metadataDatabase, metadataKey] {
                    var info = stat()
                    guard lstat(file.path, &info) == 0, info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                          info.st_uid == geteuid(), info.st_nlink == 1,
                          info.st_mode & 0o7777 == 0o600 else { throw CoordinatorError("claude_storage_unsafe") }
                }
            }
        }
    }
}
