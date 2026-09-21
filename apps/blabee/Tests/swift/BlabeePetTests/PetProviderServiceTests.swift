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
    let registry: ClaudeSessionRegistry?
    let pet: PetProviderService
    let application: ClaudeProductServiceCoordinator
    let server: UnixDomainSocketServer
    let client: UnixDomainSocketClient
    let finished = DispatchSemaphore(value: 0)

    init(claude: Bool = true) throws {
        root = URL(fileURLWithPath: "/private/tmp/bc6svc-" + UUID().uuidString.lowercased().prefix(10))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        if claude {
            let state = try ClaudeBridgeConfiguration.privateChild(of: root, name: "state")
            registry = try ClaudeSessionRegistry(rootURL: state, runtimeIdentity: runtime, secretCorpus: corpus,
                freshnessFactory: { ProviderServiceAnchor($0) })
        } else { registry = nil }
        pet = try PetProviderService(credential: credential, codex: codex, registry: registry, secretCorpus: corpus)
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
        let hook: [String: Any] = ["schema_version": "blabee.claude-session.v2", "kind": "request", "provider": "claude",
            "request_id": UUID().uuidString.lowercased(), "role": "hook", "operation": "hook", "authority": scope.authority,
            "payload": ["event": "SessionStart", "source": "startup", "native_session_id": scope.authority["native_session_id"]!,
                "cwd": f.root.path]]
        f.expectDenied("pet_provider_v1", envelope: hook)
        f.expectDenied("pet_provider_v1", envelope: hook, credential: scope.capabilities["hook"]!)
        f.expectDenied("claude_session_v2", envelope: hook)
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
