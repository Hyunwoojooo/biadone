import ClaudeCoreAdapter
import CoordinatorSwift
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

private final class ProviderServiceAnchor: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot: String
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    init(_ slot: String) { storageSlot = slot }
    func load() -> FreshnessStoredRecord? { lock.withLock { stored } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored == nil else { throw CoordinatorError("fixture_anchor_conflict") }
            let value = try FreshnessStoredRecord(record: record, revision: record.revision)
            stored = value
            return value
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored?.revision == expectedRevision else { throw CoordinatorError("fixture_anchor_conflict") }
            let value = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            stored = value
            return value
        }
    }
}

private final class ProviderServiceCodex: CoordinatorOperationalHandling, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var requestCount: Int { lock.withLock { count } }
    func handle(type: String, payload: Data) async throws -> Data {
        guard type == "get_state" else { throw CoordinatorError("fixture_codex_unsupported") }
        lock.withLock { count += 1 }
        return Data("{\"codex_preserved\":true}".utf8)
    }
    func doctorStatus(payload: Data) async throws -> Data { Data("{\"codex_preserved\":true}".utf8) }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
}

private struct ProviderServiceScope {
    let authority: [String: String]
    let capabilities: [String: String]
    var scopeID: String { authority["scope_id"]! }
}

/// App bootstrap authentication itself is covered by the private-pipe tests.
/// Here an already-issued in-memory app capability reaches the real general
/// UDS dispatcher, which must never promote Hook/bridge credentials to it.
private final class ProviderServiceFixture {
    let root: URL
    let corpus = RuntimeSecretCorpus()
    let credential = String(repeating: "f", count: 64)
    let runtime = "sha256:" + String(repeating: "a", count: 64)
    let codex = ProviderServiceCodex()
    let arrivals = PetEventArrivalLedger()
    let registry: ClaudeSessionRegistry?
    let pet: PetProviderService
    let application: ClaudeProductServiceCoordinator
    let server: UnixDomainSocketServer
    let client: UnixDomainSocketClient
    let finished = DispatchSemaphore(value: 0)
    private var waiters: [String: [String: Any]] = [:]

    init(claude: Bool = true) throws {
        root = URL(fileURLWithPath: "/private/tmp/bc6svc-" + UUID().uuidString.lowercased().prefix(10))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        if claude {
            let state = try ClaudeBridgeConfiguration.privateChild(of: root, name: "state")
            registry = try ClaudeSessionRegistry(rootURL: state, runtimeIdentity: runtime, secretCorpus: corpus,
                freshnessFactory: { ProviderServiceAnchor($0) })
        } else { registry = nil }
        pet = try PetProviderService(credential: credential, codex: codex, registry: registry,
            secretCorpus: corpus, arrivalLedger: arrivals)
        application = ClaudeProductServiceCoordinator(codex: codex, registry: registry, pet: pet)
        let socket = root.appendingPathComponent("service.sock").path
        server = try UnixDomainSocketServer(socketPath: socket, runtimeIdentity: runtime)
        client = try UnixDomainSocketClient(socketPath: socket, runtimeIdentity: runtime)
        try server.activate()
        DispatchQueue.global().async { [server, application, corpus, finished] in
            defer { finished.signal() }
            do { try server.run(application: application, secretCorpus: corpus) }
            catch { Issue.record("Provider service fixture stopped unexpectedly") }
        }
    }

    deinit {
        application.stop()
        server.stop()
        _ = finished.wait(timeout: .now() + 5)
        try? FileManager.default.removeItem(at: root)
    }

    func enroll() throws -> ProviderServiceScope {
        let registry = try #require(registry), owner = UUID()
        let envelope = try ClaudeProductWireCodec(credentialCorpus: corpus).decodeRequest(
            StrictJSONTransport.data(forJSONObject: ownerEnvelope(registry: registry, owner: owner)))
        var grant = Data()
        _ = try registry.enroll(connectionID: owner, request: envelope) { grant = $0 }
        let value = try StrictJSONTransport.object(from: grant)
        let capabilities = try #require(value["role_capabilities"] as? [String: String])
        #expect(capabilities["selector"] == nil)
        return ProviderServiceScope(authority: try #require(value["authority"] as? [String: String]), capabilities: capabilities)
    }

    func ownerEnvelope(registry: ClaudeSessionRegistry, owner: UUID = UUID()) -> [String: Any] {
        ["schema_version": "blabee.claude-owner.v1", "kind": "request", "provider": "claude",
         "request_id": UUID().uuidString.lowercased(), "role": "owner", "operation": "enroll",
         "payload": ["service_incarnation": registry.serviceIncarnation.uuidString.lowercased(),
             "owner_connection_id": owner.uuidString.lowercased(), "challenge_id": UUID().uuidString.lowercased(),
             "grant_pipe_id": UUID().uuidString.lowercased(), "cwd": root.path, "channel_source": "blabee-claude"]]
    }

    func request(_ type: String, envelope: [String: Any], credential supplied: String? = nil) throws -> [String: Any] {
        let response = try client.request(type: type, payload: ["auth_token": supplied ?? credential, "envelope": envelope],
            connectTimeoutMilliseconds: 1_000, responseTimeoutMilliseconds: 5_000)
        #expect(!corpus.containsKnownSecret(in: try StrictJSONTransport.data(forJSONObject: response)))
        return response
    }

    func listEnvelope() throws -> [String: Any] {
        try PetProviderDirectoryCodec.request(operation: "list", payload: ["after_scope_id": NSNull()])
    }

    func directory() throws -> [String: Any] {
        let envelope = try listEnvelope()
        let response = try request("pet_directory_v1", envelope: envelope)
        return try PetProviderDirectoryCodec.decode(StrictJSONTransport.data(forJSONObject: response), matching: envelope).result
    }

    func row(_ scope: ProviderServiceScope) throws -> [String: Any] {
        let rows = try #require(directory()["sessions"] as? [[String: Any]])
        return try #require(rows.first { ($0["target"] as? [String: Any])?["scope_id"] as? String == scope.scopeID })
    }

    func snapshotEnvelope(provider: String = "claude", target: [String: Any]) -> [String: Any] {
        ["schema_version": "blabee.pet-provider.v1", "kind": "request", "provider": provider,
         "request_id": UUID().uuidString.lowercased(), "role": "selector", "operation": "snapshot",
         "target": target, "payload": [:]]
    }

    func snapshot(_ scope: ProviderServiceScope) throws -> [String: Any] {
        let target = try #require(row(scope)["target"] as? [String: Any])
        return try request("pet_provider_v1", envelope: snapshotEnvelope(target: target))
    }

    func session(_ scope: ProviderServiceScope, _ operation: String, payload: [String: Any] = [:],
                 role: String = "bridge") throws -> [String: Any] {
        let envelope: [String: Any] = ["schema_version": "blabee.claude-session.v3", "kind": "request",
            "provider": "claude", "request_id": UUID().uuidString.lowercased(), "role": role,
            "operation": operation, "authority": scope.authority, "payload": payload]
        let response = try request("claude_session_v2", envelope: envelope, credential: scope.capabilities[role]!)
        guard response["ok"] as? Bool == true, let result = response["result"] as? [String: Any] else {
            throw CoordinatorError((response["error"] as? [String: Any])?["code"] as? String ?? "fixture_session_failure")
        }
        return result
    }

    func prepareCard(_ scope: ProviderServiceScope) throws -> String {
        let base: [String: Any] = ["native_session_id": scope.authority["native_session_id"]!, "cwd": root.path]
        _ = try session(scope, "hook", payload: base.merging(["event": "SessionStart", "source": "startup"]) { _, next in next }, role: "hook")
        let bridge = try #require(session(scope, "bridge.open")["bridge_id"] as? String)
        let probe = try session(scope, "readiness.begin", payload: ["bridge_id": bridge])
        _ = try session(scope, "readiness.ack", payload: ["bridge_id": bridge, "probe_id": probe["probe_id"]!, "nonce": probe["nonce"]!])
        let promptID = UUID().uuidString.lowercased()
        let prompt = try session(scope, "hook", payload: base.merging(["event": "UserPromptSubmit",
            "prompt_id": promptID, "prompt_sha256": String(repeating: "c", count: 64)]) { _, next in next }, role: "hook")
        let boundary = try #require(prompt["boundary_id"] as? String)
        let proposal: [String: Any] = ["schema_version": "blabee.claude-proposal.v1", "value": [
            "proposal_id": UUID().uuidString.lowercased(), "task_goal": "Test a user dismissal.",
            "outcome": ["status": "completed", "summary": "Fixture choices are ready."], "reported_side_effects": [],
            "options": [
                ["id": "read", "title": "Read fixture", "description": "Read fixture only.", "task": "Read fixture.txt",
                 "done_when": "Report the content.", "constraints": ["No writes."]],
                ["id": "list", "title": "List fixtures", "description": "List fixture names.", "task": "List fixtures",
                 "done_when": "Report the names.", "constraints": []],
            ],
        ]]
        _ = try session(scope, "proposal.emit", payload: ["bridge_id": bridge, "boundary_id": boundary, "proposal": proposal])
        let stopped = try session(scope, "hook", payload: base.merging(["event": "Stop", "prompt_id": promptID,
            "background_task_ids": [String]()]) { _, next in next }, role: "hook")
        waiters[scope.scopeID] = try #require(stopped["waiter"] as? [String: Any])
        // The Stop descriptor becomes selectable only after its delivery
        // process proves receipt with the first exact Hook poll.
        let polled = try pollWaiter(scope)
        #expect(polled["status"] as? String == "waiting")
        #expect(polled["event"] is NSNull)
        return bridge
    }

    func pollWaiter(_ scope: ProviderServiceScope) throws -> [String: Any] {
        let waiter = try #require(waiters[scope.scopeID])
        return try session(scope, "hook.poll", payload: [
            "native_session_id": scope.authority["native_session_id"]!, "cwd": root.path,
            "prompt_id": waiter["prompt_id"]!, "waiter_generation": waiter["generation"]!,
        ], role: "hook")
    }

    func dismissalEnvelope(_ scope: ProviderServiceScope) throws -> [String: Any] {
        let reply = try snapshot(scope)
        guard reply["ok"] as? Bool == true else {
            let code = (reply["error"] as? [String: Any])?["code"] as? String ?? "missing_status"
            throw CoordinatorError("fixture_dismissal_snapshot_" + code)
        }
        let result = try #require(reply["result"] as? [String: Any])
        let projection = try #require(result["projection"] as? [String: Any])
        let value = try #require(projection["value"] as? [String: Any])
        #expect(value["selection_enabled"] as? Bool == true)
        let card = try #require((value["cards"] as? [[String: Any]])?.first)
        let packet = try #require(card["packet"] as? [String: Any])
        var envelope = snapshotEnvelope(target: try #require(reply["target"] as? [String: Any]))
        envelope["operation"] = "dismiss_interaction"
        envelope["payload"] = ["binding": card["binding"]!, "interaction_id": packet["interaction_id"]!,
            "packet_id": packet["packet_id"]!, "revision": packet["revision"]!]
        return envelope
    }

    func expectDenied(_ type: String, envelope: [String: Any], credential supplied: String? = nil) {
        do {
            _ = try request(type, envelope: envelope, credential: supplied)
            Issue.record("An unauthorized provider request was accepted")
        } catch {
            let description = String(describing: error)
            #expect(!description.contains(credential))
            if let supplied, supplied.count >= 8 { #expect(!description.contains(supplied)) }
        }
    }

    func assertCodex() throws {
        let result = try client.request(type: "get_state", payload: [:], connectTimeoutMilliseconds: 1_000,
                                        responseTimeoutMilliseconds: 5_000)
        #expect(result["codex_preserved"] as? Bool == true)
    }
}

@Suite("Authenticated Pet provider service", .serialized)
struct PetProviderServiceTests {
    @Test("Authenticated Claude dismissal removes only its card and creates no Hook delivery or Codex request")
    func claudeDismissalOverUDS() throws {
        let f = try ProviderServiceFixture(), a = try f.enroll(), b = try f.enroll()
        let bridgeA = try f.prepareCard(a), bridgeB = try f.prepareCard(b)
        let envelope = try f.dismissalEnvelope(a)
        f.expectDenied("pet_provider_v1", envelope: envelope, credential: a.capabilities["hook"]!)
        f.expectDenied("pet_provider_v1", envelope: envelope, credential: a.capabilities["bridge"]!)
        let response = try f.request("pet_provider_v1", envelope: envelope)
        let codec = ClaudeProductWireCodec(credentialCorpus: f.corpus)
        let request = try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: envelope))
        _ = try codec.decodeResponse(StrictJSONTransport.data(forJSONObject: response), matching: request,
            connection: .init(serviceIncarnation: try #require(f.registry).serviceIncarnation))
        #expect(response["ok"] as? Bool == true)
        #expect((response["result"] as? [String: Any])?["dismissed"] as? Bool == true)
        #expect(try f.session(a, "bridge.poll", payload: ["bridge_id": bridgeA])["event"] is NSNull)
        #expect(try f.session(b, "bridge.poll", payload: ["bridge_id": bridgeB])["event"] is NSNull)
        let dismissedWaiter = try f.pollWaiter(a), otherWaiter = try f.pollWaiter(b)
        #expect(dismissedWaiter["status"] as? String == "closed")
        #expect(dismissedWaiter["event"] is NSNull)
        #expect(otherWaiter["status"] as? String == "waiting")
        #expect(otherWaiter["event"] is NSNull)
        #expect(try f.dismissalEnvelope(b)["operation"] as? String == "dismiss_interaction")
        let stale = try f.request("pet_provider_v1", envelope: envelope)
        #expect(stale["ok"] as? Bool == false)
        #expect(f.codex.requestCount == 0)
    }

    @Test("Provider dismissal rejects stale revision and another scoped session without closing either card")
    func claudeDismissalStaleCardAndScope() throws {
        let f = try ProviderServiceFixture(), a = try f.enroll(), b = try f.enroll()
        _ = try f.prepareCard(a); _ = try f.prepareCard(b)
        for invalid in ["revision", "interaction_id", "scope"] {
            var envelope = try f.dismissalEnvelope(a)
            if invalid == "scope" { envelope["target"] = try f.dismissalEnvelope(b)["target"] }
            else {
                var payload = try #require(envelope["payload"] as? [String: Any])
                payload[invalid] = invalid == "revision" ? 99 : "another-interaction"
                envelope["payload"] = payload
            }
            let response = try f.request("pet_provider_v1", envelope: envelope)
            #expect(response["ok"] as? Bool == false)
            #expect(try f.dismissalEnvelope(a)["operation"] as? String == "dismiss_interaction")
            #expect(try f.dismissalEnvelope(b)["operation"] as? String == "dismiss_interaction")
        }
        #expect(f.codex.requestCount == 0)
    }

    @Test("Private inbox order preserves service admission across providers and never records polling")
    func inboxAdmissionMetadataOverUDS() throws {
        let f = try ProviderServiceFixture(), claude = try f.enroll()
        let target = try #require(f.row(claude)["target"] as? [String: Any])
        let claudeContext = try PetProviderContext(provider: .claude, target: target)
        let claudeReference = PetEventReference(kind: .decision, eventID: "claude-admitted-card")
        let codexReference = PetEventReference(kind: .permission, eventID: "codex-admitted-approval")
        #expect(f.arrivals.record(scopeID: claude.scopeID, kind: "decision", eventID: claudeReference.eventID) == 1)
        #expect(f.arrivals.record(scopeID: "codex-primary", kind: "permission", eventID: codexReference.eventID) == 2)
        let request = try PetProviderInboxCodec.request(queries: [
            .init(context: f.pet.codexContext, reference: codexReference),
            .init(context: claudeContext, reference: claudeReference),
            .init(context: f.pet.codexContext, reference: .init(kind: .decision, eventID: "unknown-recovered-card")),
        ], service: f.pet.codexContext.serviceIncarnation)
        let data = try StrictJSONTransport.data(forJSONObject: f.request("pet_inbox_v1", envelope: request))
        #expect(try PetProviderInboxCodec.decode(data, matching: request) == [2, 1, nil])
        _ = try f.request("pet_inbox_v1", envelope: request)
        #expect(f.arrivals.sequence(scopeID: "codex-primary", kind: "decision", eventID: "unknown-recovered-card") == nil)
        #expect(f.arrivals.record(scopeID: "codex-primary", kind: "decision", eventID: "next-real-admission") == 3)
        #expect(f.codex.requestCount == 0)
    }

    @Test("Inbox metadata requires app capability and exact current authority without expanding native roles")
    func inboxMetadataAuthority() throws {
        let f = try ProviderServiceFixture(), claude = try f.enroll()
        let context = try PetProviderContext(provider: .claude, target: #require(f.row(claude)["target"] as? [String: Any]))
        let query = PetProviderInboxCodec.Query(context: context, reference: .init(kind: .decision, eventID: "card"))
        let request = try PetProviderInboxCodec.request(queries: [query], service: f.pet.codexContext.serviceIncarnation)
        f.expectDenied("pet_inbox_v1", envelope: request, credential: claude.capabilities["hook"]!)
        f.expectDenied("pet_inbox_v1", envelope: request, credential: claude.capabilities["bridge"]!)
        let replaced = PetProviderContext(provider: .claude, scopeID: context.scopeID,
            serviceIncarnation: context.serviceIncarnation, sessionIncarnation: UUID().uuidString.lowercased(),
            authorityEpoch: context.authorityEpoch, uiGeneration: context.uiGeneration)
        f.expectDenied("pet_inbox_v1", envelope: try PetProviderInboxCodec.request(queries: [
            .init(context: replaced, reference: query.reference),
        ], service: f.pet.codexContext.serviceIncarnation))
        #expect(throws: (any Error).self) {
            try PetProviderInboxCodec.request(queries: [
                .init(context: context, reference: .init(kind: .permission, eventID: "native-approval")),
            ], service: context.serviceIncarnation)
        }
        #expect(throws: (any Error).self) {
            try PetProviderInboxCodec.request(queries: [query, query], service: context.serviceIncarnation)
        }
        f.pet.stop()
        f.expectDenied("pet_inbox_v1", envelope: request)
        try f.assertCodex()
    }

    @Test("Real UDS accepts only the app capability and rejects role tokens, substrings and reflection")
    func authenticatedUDS() throws {
        let f = try ProviderServiceFixture(), scope = try f.enroll()
        let request = try f.listEnvelope()
        #expect(try f.request("pet_directory_v1", envelope: request)["kind"] as? String == "response")
        let denied = [scope.capabilities["hook"]!, scope.capabilities["bridge"]!, scope.capabilities["owner"]!,
            String(repeating: "e", count: 64), "prefix" + f.credential + "suffix", String(f.credential.dropLast()),
            "blabee.pet-directory.v1"]
        for value in denied { f.expectDenied("pet_directory_v1", envelope: request, credential: value) }
        var reflected = request
        reflected["unrecognized"] = "prefix-" + f.credential + "-suffix"
        f.expectDenied("pet_directory_v1", envelope: reflected)
        // An unauthenticated token resembling an ordinary response value must
        // not poison the service-wide corpus for subsequent valid requests.
        #expect((try f.directory()["sessions"] as? [[String: Any]])?.count == 1)
        try f.assertCodex()
    }

    @Test("Two Claude scopes list and snapshot independently; disconnect and stop preserve Codex")
    func scopeIsolationOverUDS() throws {
        let f = try ProviderServiceFixture(), a = try f.enroll(), b = try f.enroll()
        let directory = try f.directory()
        #expect(directory["claude_available"] as? Bool == true)
        #expect((directory["sessions"] as? [[String: Any]])?.count == 2)
        for scope in [a, b] {
            let snapshot = try f.snapshot(scope)
            #expect(snapshot["ok"] as? Bool == true)
            let projection = try #require((snapshot["result"] as? [String: Any])?["projection"] as? [String: Any])
            #expect(projection["schema_version"] as? String == "blabee.pet.claude.v1")
            #expect((projection["value"] as? [String: Any])?["readiness_status"] as? String == "starting")
        }
        let oldTarget = try #require(f.row(a)["target"] as? [String: Any])
        let disconnect = try PetProviderDirectoryCodec.request(operation: "disconnect", payload: ["target": oldTarget])
        let ended = try f.request("pet_directory_v1", envelope: disconnect)
        #expect((ended["result"] as? [String: Any])?["disconnected"] as? Bool == true)
        #expect(f.registry?.activeScopeCount == 1)
        #expect(try f.row(a)["state"] as? String == "disconnected")
        #expect(try f.snapshot(b)["ok"] as? Bool == true)
        let stale = try f.request("pet_provider_v1", envelope: f.snapshotEnvelope(target: oldTarget))
        #expect(stale["ok"] as? Bool == false)
        #expect((stale["error"] as? [String: Any])?["code"] as? String == "stale_authority")
        try f.assertCodex()
        let currentB = try #require(f.row(b)["target"] as? [String: Any])
        f.application.stop()
        #expect(f.registry?.activeScopeCount == 0)
        f.expectDenied("pet_directory_v1", envelope: try f.listEnvelope())
        f.expectDenied("pet_provider_v1", envelope: f.snapshotEnvelope(target: currentB))
        try f.assertCodex()
    }

    @Test("General UDS provider dispatch cannot gain Hook, owner or an unsupported provider version")
    func noRoleEscalation() throws {
        let f = try ProviderServiceFixture(), scope = try f.enroll()
        let target = try #require(f.row(scope)["target"] as? [String: Any])
        let hook: [String: Any] = ["schema_version": "blabee.claude-session.v3", "kind": "request", "provider": "claude",
            "request_id": UUID().uuidString.lowercased(), "role": "hook", "operation": "hook", "authority": scope.authority,
            "payload": ["event": "SessionStart", "source": "startup", "native_session_id": scope.authority["native_session_id"]!,
                "cwd": f.root.path]]
        f.expectDenied("pet_provider_v1", envelope: hook)
        f.expectDenied("pet_provider_v1", envelope: hook, credential: scope.capabilities["hook"]!)
        f.expectDenied("claude_session_v2", envelope: hook)
        var legacyHook = hook
        legacyHook["schema_version"] = "blabee.claude-session.v2"
        f.expectDenied("claude_session_v2", envelope: legacyHook, credential: scope.capabilities["hook"]!)
        let owner = f.ownerEnvelope(registry: try #require(f.registry))
        f.expectDenied("pet_provider_v1", envelope: owner)
        f.expectDenied("claude_owner_v1", envelope: owner)
        f.expectDenied("pet_provider_v2", envelope: f.snapshotEnvelope(target: target))
        var forgedSelector = f.snapshotEnvelope(target: target)
        forgedSelector["role"] = "hook"
        f.expectDenied("pet_provider_v1", envelope: forgedSelector)
        #expect(f.registry?.activeScopeCount == 1)
        #expect(f.codex.requestCount == 0)
        // Correct native role and correct wire remain usable after rejections.
        let observed = try f.request("claude_session_v2", envelope: hook, credential: scope.capabilities["hook"]!)
        #expect(observed["ok"] as? Bool == true)
        #expect(try f.snapshot(scope)["ok"] as? Bool == true)
        try f.assertCodex()
    }

    @Test("Codex-only fallback still has an authenticated directory and Codex projection")
    func codexOnlyFallback() throws {
        let f = try ProviderServiceFixture(claude: false)
        let directory = try f.directory()
        #expect(directory["claude_available"] as? Bool == false)
        #expect((directory["sessions"] as? [[String: Any]])?.isEmpty == true)
        let target = try #require(directory["codex_target"] as? [String: Any])
        let result = try f.request("pet_provider_v1", envelope: f.snapshotEnvelope(provider: "codex", target: target))
        #expect(result["ok"] as? Bool == true)
        let projection = try #require((result["result"] as? [String: Any])?["projection"] as? [String: Any])
        #expect(projection["schema_version"] as? String == "blabee.pet.codex.v1")
        #expect((projection["value"] as? [String: Any])?["codex_preserved"] as? Bool == true)
        #expect(throws: (any Error).self) {
            try PetProviderService(credential: "short", codex: f.codex, registry: nil, secretCorpus: f.corpus)
        }
        #expect(throws: (any Error).self) {
            try PetProviderService(credential: String(repeating: "A", count: 64), codex: f.codex, registry: nil, secretCorpus: f.corpus)
        }
        f.pet.stop()
        f.expectDenied("pet_directory_v1", envelope: try f.listEnvelope())
        try f.assertCodex()
    }
}
