import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation
import SQLite3
import Testing
@testable import BlabeeCoordinator

private final class PetRegistryClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 0
    func nowNanoseconds() -> UInt64 { lock.withLock { value } }
    func advance(_ seconds: UInt64) { lock.withLock { value += seconds * 1_000_000_000 } }
}

private final class PetRegistryAnchor: FreshnessAnchorStore, @unchecked Sendable {
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

private final class PetRegistryAnchors: @unchecked Sendable {
    private let lock = NSLock()
    private var stores: [String: PetRegistryAnchor] = [:]
    func get(_ slot: String) -> PetRegistryAnchor {
        lock.withLock {
            if let value = stores[slot] { return value }
            let value = PetRegistryAnchor(slot)
            stores[slot] = value
            return value
        }
    }
}

private struct PetRegistryScope {
    let authority: [String: String]
    let tokens: [String: String]
    var id: UUID { UUID(uuidString: authority["scope_id"]!)! }
}

private final class PetRegistryFixture {
    let root: URL
    let cwd: String
    let clock = PetRegistryClock()
    let corpus = RuntimeSecretCorpus()
    let anchors = PetRegistryAnchors()
    let registry: ClaudeSessionRegistry

    init() throws {
        root = URL(fileURLWithPath: "/private/tmp/blabee-cp06-registry-" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        cwd = root.path
        let state = try ClaudeBridgeConfiguration.privateChild(of: root, name: "state")
        registry = try ClaudeSessionRegistry(rootURL: state,
            runtimeIdentity: "sha256:" + String(repeating: "c", count: 64), secretCorpus: corpus,
            freshnessFactory: { [anchors] in anchors.get($0) }, clock: clock,
            wallNow: { [clock] in Date(timeIntervalSince1970: 1_800_000_000 + Double(clock.nowNanoseconds()) / 1_000_000_000) })
    }
    deinit { registry.disconnectAll(); try? FileManager.default.removeItem(at: root) }

    func enroll() throws -> PetRegistryScope {
        let owner = UUID()
        let request = try codecRequest([
            "schema_version": "blabee.claude-owner.v1", "kind": "request", "provider": "claude",
            "role": "owner", "operation": "enroll", "request_id": UUID().uuidString.lowercased(),
            "payload": ["service_incarnation": registry.serviceIncarnation.uuidString.lowercased(),
                "owner_connection_id": owner.uuidString.lowercased(), "challenge_id": UUID().uuidString.lowercased(),
                "grant_pipe_id": UUID().uuidString.lowercased(), "cwd": cwd, "channel_source": "blabee-claude"],
        ])
        var grant = Data()
        _ = try registry.enroll(connectionID: owner, request: request) { grant = $0 }
        let value = try StrictJSONTransport.object(from: grant)
        return PetRegistryScope(authority: try #require(value["authority"] as? [String: String]),
            tokens: try #require(value["role_capabilities"] as? [String: String]))
    }

    func codecRequest(_ value: [String: Any]) throws -> ClaudeProductWireCodec.Envelope {
        try ClaudeProductWireCodec(credentialCorpus: corpus).decodeRequest(StrictJSONTransport.data(forJSONObject: value))
    }

    func session(_ scope: PetRegistryScope, _ operation: String, _ payload: [String: Any] = [:],
                 role: String = "bridge") throws -> [String: Any] {
        let envelope: [String: Any] = ["schema_version": "blabee.claude-session.v2", "kind": "request",
            "provider": "claude", "request_id": UUID().uuidString.lowercased(), "role": role,
            "operation": operation, "authority": scope.authority, "payload": payload]
        return try StrictJSONTransport.object(from: registry.handleSession(StrictJSONTransport.data(forJSONObject: [
            "auth_token": scope.tokens[role]!, "envelope": envelope])))
    }

    @discardableResult
    func hook(_ scope: PetRegistryScope, _ event: String, _ fields: [String: Any] = [:]) throws -> [String: Any] {
        var payload: [String: Any] = ["event": event, "cwd": cwd, "native_session_id": scope.authority["native_session_id"]!]
        payload.merge(fields) { _, value in value }
        let response = try session(scope, "hook", payload, role: "hook")
        #expect(response["ok"] as? Bool == true)
        return try #require(response["result"] as? [String: Any])
    }

    func target(_ scope: PetRegistryScope) throws -> [String: Any] {
        let descriptor = try #require(registry.petSessions(limit: 33).first { $0.mapping.authority.scopeID == scope.id })
        return ["scope_id": scope.authority["scope_id"]!, "service_incarnation": scope.authority["service_incarnation"]!,
            "session_incarnation": scope.authority["session_incarnation"]!, "authority_epoch": scope.authority["authority_epoch"]!,
            "ui_generation": String(descriptor.uiGeneration)]
    }

    func pet(_ target: [String: Any], _ operation: String = "snapshot", _ payload: [String: Any] = [:]) throws -> [String: Any] {
        let request = try codecRequest(["schema_version": "blabee.pet-provider.v1", "kind": "request", "provider": "claude",
            "request_id": UUID().uuidString.lowercased(), "role": "selector", "operation": operation,
            "target": target, "payload": payload])
        let data = try registry.handlePet(request: request)
        #expect(!corpus.containsKnownSecret(in: data))
        return try StrictJSONTransport.object(from: data)
    }

    func snapshot(_ scope: PetRegistryScope) throws -> [String: Any] {
        let response = try pet(target(scope))
        #expect(response["ok"] as? Bool == true)
        let result = try #require(response["result"] as? [String: Any])
        let projection = try #require(result["projection"] as? [String: Any])
        #expect(projection["schema_version"] as? String == "blabee.pet.claude.v1")
        return try #require(projection["value"] as? [String: Any])
    }

    func poll(_ scope: PetRegistryScope, bridge: String) throws -> [String: Any]? {
        let response = try session(scope, "bridge.poll", ["bridge_id": bridge])
        #expect(response["ok"] as? Bool == true)
        return (response["result"] as? [String: Any])?["event"] as? [String: Any]
    }

    func acknowledge(_ scope: PetRegistryScope, bridge: String, event: [String: Any]) throws {
        let id = try #require(event["probe_id"] as? String), nonce = try #require(event["nonce"] as? String)
        let text = "<channel source=\"blabee-claude\" kind=\"readiness_probe\" probe_id=\"\(id)\">\n"
            + "Blabee connection probe. Call ack_readiness_probe_v1 with these values; do not run a task.\n"
            + "{\"probe_id\":\"\(id)\",\"nonce\":\"\(nonce)\"}\n</channel>"
        let prompt = UUID().uuidString.lowercased()
        try hook(scope, "UserPromptSubmit", ["prompt_id": prompt,
            "prompt_sha256": SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()])
        let ack = try session(scope, "readiness.ack", ["bridge_id": bridge, "probe_id": id, "nonce": nonce])
        #expect(ack["ok"] as? Bool == true)
        try hook(scope, "Stop", ["prompt_id": prompt, "background_task_ids": []])
    }

    func start(_ scope: PetRegistryScope, bridgeFirst: Bool = false) throws -> String {
        if !bridgeFirst { try hook(scope, "SessionStart", ["source": "startup"]) }
        let opened = try session(scope, "bridge.open")
        let bridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
        if bridgeFirst { try hook(scope, "SessionStart", ["source": "startup"]) }
        return bridge
    }

    func readyCard(_ scope: PetRegistryScope) throws -> String {
        let bridge = try start(scope)
        try acknowledge(scope, bridge: bridge, event: #require(try poll(scope, bridge: bridge)))
        let prompt = UUID().uuidString.lowercased()
        let hook = try hook(scope, "UserPromptSubmit", ["prompt_id": prompt, "prompt_sha256": String(repeating: "d", count: 64)])
        let boundary = try #require(hook["boundary_id"] as? String)
        let proposal: [String: Any] = ["schema_version": "blabee.claude-proposal.v1", "value": [
            "proposal_id": UUID().uuidString.lowercased(), "task_goal": "Inspect isolated fixture",
            "outcome": ["status": "completed", "summary": "Fixture inspected"], "reported_side_effects": [],
            "options": [
                ["id": "a", "title": "Read file", "description": "Read fixture", "task": "Read fixture.txt",
                 "done_when": "Report contents", "constraints": ["No changes"]],
                ["id": "b", "title": "List files", "description": "List fixture", "task": "List files",
                 "done_when": "Report files", "constraints": []],
            ],
        ]]
        let emitted = try session(scope, "proposal.emit", ["bridge_id": bridge, "boundary_id": boundary, "proposal": proposal])
        #expect(emitted["ok"] as? Bool == true)
        try self.hook(scope, "Stop", ["prompt_id": prompt, "background_task_ids": []])
        return bridge
    }

    func selection(_ scope: PetRegistryScope) throws -> [String: Any] {
        let value = try snapshot(scope)
        #expect(value["selection_enabled"] as? Bool == true)
        let card = try #require((value["cards"] as? [[String: Any]])?.first)
        let packet = try #require(card["packet"] as? [String: Any])
        let choice = try #require((packet["choices"] as? [[String: Any]])?.first)
        return ["binding": card["binding"]!, "packet_id": packet["packet_id"]!, "revision": packet["revision"]!,
            "option_id": choice["option_id"]!, "selection_id": UUID().uuidString.lowercased()]
    }

    func sequences(_ scope: PetRegistryScope) throws -> [Int64] {
        try [("core/coordinator.sqlite3", "runtime_events"), ("metadata/metadata.sqlite3", "metadata_operations")].map { file, table in
            let path = root.appendingPathComponent("state/scopes/" + scope.id.uuidString.lowercased() + "/" + file).path
            var database: OpaquePointer?, statement: OpaquePointer?
            guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw CoordinatorError("fixture_database") }
            defer { sqlite3_finalize(statement); sqlite3_close(database) }
            guard sqlite3_prepare_v2(database, "SELECT count(*) FROM " + table, -1, &statement, nil) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_ROW else { throw CoordinatorError("fixture_database") }
            return sqlite3_column_int64(statement, 0)
        }
    }
}

@Suite("Claude Pet provider registry")
struct ClaudePetProviderRegistryTests {
    @Test("Directory and pre-start snapshot are bounded memory reads with no native/core initialization")
    func directoryReadOnly() throws {
        let f = try PetRegistryFixture(), a = try f.enroll(), b = try f.enroll()
        let before = try f.sequences(a)
        let staleDisk = f.root.appendingPathComponent("state/scopes/" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(at: staleDisk, withIntermediateDirectories: false)
        let first = try #require(f.registry.petSessions(limit: 1).first)
        let second = try f.registry.petSessions(afterScopeID: first.mapping.authority.scopeID, limit: 1)
        #expect(second.count == 1 && second.first?.mapping.authority.scopeID != first.mapping.authority.scopeID)
        #expect(try f.registry.petSessions(limit: 33).count == 2)
        for _ in 0..<5 {
            let snapshot = try f.snapshot(a)
            #expect(snapshot["readiness_status"] as? String == "starting")
            #expect((snapshot["cards"] as? [[String: Any]])?.isEmpty == true)
        }
        #expect(try f.sequences(a) == before)
        #expect(try f.target(a)["ui_generation"] as? String == "0")
        #expect(try f.target(b)["ui_generation"] as? String == "0")
        #expect(throws: (any Error).self) { try f.registry.petSessions(limit: 34) }
    }

    @Test("Initial readiness waits for real Hook and bridge in either order and runs only once", arguments: [false, true])
    func initialReadiness(_ bridgeFirst: Bool) throws {
        let f = try PetRegistryFixture(), scope = try f.enroll()
        if !bridgeFirst {
            try f.hook(scope, "SessionStart", ["source": "startup"])
            #expect(try f.snapshot(scope)["readiness_status"] as? String == "starting")
        }
        let opened = try f.session(scope, "bridge.open")
        let bridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
        if bridgeFirst {
            #expect(try f.poll(scope, bridge: bridge) == nil)
            #expect(try f.snapshot(scope)["readiness_status"] as? String == "starting")
            try f.hook(scope, "SessionStart", ["source": "startup"])
        }
        let initial = try #require(try f.poll(scope, bridge: bridge))
        #expect(initial["kind"] as? String == "readiness_probe")
        let pending = try f.snapshot(scope)
        #expect(pending["readiness_status"] as? String == "pending")
        let snapshotBytes = try StrictJSONTransport.data(forJSONObject: pending)
        #expect(!String(decoding: snapshotBytes, as: UTF8.self).contains(initial["nonce"] as! String))
        #expect(try f.poll(scope, bridge: bridge) == nil)
        // Keep heartbeats live through probe expiry without requesting a new
        // connection check; the registry never sends periodic model wakeups.
        for _ in 0..<76 { f.clock.advance(4); _ = try f.poll(scope, bridge: bridge) }
        try f.hook(scope, "SessionStart", ["source": "startup"])
        #expect(try f.poll(scope, bridge: bridge) == nil)
        #expect(try f.snapshot(scope)["readiness_status"] as? String == "required")
    }

    @Test("Scope, service, session, epoch and UI generation cannot be substituted")
    func staleTargets() throws {
        let f = try PetRegistryFixture(), a = try f.enroll(), b = try f.enroll()
        let current = try f.target(a)
        for key in ["scope_id", "service_incarnation", "session_incarnation", "authority_epoch", "ui_generation"] {
            var stale = current
            stale[key] = key == "ui_generation" ? "99" : (key == "scope_id" ? b.id.uuidString.lowercased() : UUID().uuidString.lowercased())
            do {
                let response = try f.pet(stale)
                #expect(response["ok"] as? Bool == false)
                #expect((response["error"] as? [String: Any])?["code"] as? String == "stale_authority")
            } catch {
                // A foreign service incarnation also fails the codec's
                // authenticated connection correlation check.
                #expect(key == "service_incarnation")
            }
            #expect(throws: (any Error).self) { try f.registry.disconnectPet(target: stale) }
        }
        #expect(f.registry.activeScopeCount == 2)
        #expect(try f.pet(current)["ok"] as? Bool == true)
    }

    @Test("Late startup waits for heartbeat recovery and schedules the first probe outside poll")
    func delayedStartupReadiness() async throws {
        let f = try PetRegistryFixture(), scope = try f.enroll()
        let opened = try f.session(scope, "bridge.open")
        let bridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
        f.clock.advance(6)
        try f.hook(scope, "SessionStart", ["source": "startup"])
        let beforePoll = try f.sequences(scope)
        #expect(try f.poll(scope, bridge: bridge) == nil)
        #expect(try f.sequences(scope) == beforePoll)
        #expect(f.registry.millisecondsUntilNextDeadline() == 0)
        f.registry.processTime()
        let deadline = Date().addingTimeInterval(10)
        while f.registry.hasScheduledTimeWork {
            try #require(Date() < deadline)
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(try f.poll(scope, bridge: bridge)?["kind"] as? String == "readiness_probe")
        #expect(try f.poll(scope, bridge: bridge) == nil)
    }

    @Test("UI readiness preserves a valid card and exact Channel Hook boundary; reads append nothing")
    func explicitReadinessPreservesCard() throws {
        let f = try PetRegistryFixture(), scope = try f.enroll()
        let bridge = try f.readyCard(scope)
        let before = try f.snapshot(scope), sequence = try f.sequences(scope)
        let oldTarget = try f.target(scope)
        let begin = try f.pet(oldTarget, "readiness.begin")
        #expect(begin["ok"] as? Bool == true)
        #expect(try f.pet(oldTarget)["ok"] as? Bool == false)
        let checking = try f.snapshot(scope)
        #expect(checking["selection_enabled"] as? Bool == false)
        #expect(checking["boundary_id"] as? String == before["boundary_id"] as? String)
        #expect((checking["cards"] as? [[String: Any]])?.count == 1)
        #expect(try f.sequences(scope) == sequence)
        f.clock.advance(1)
        try f.acknowledge(scope, bridge: bridge, event: #require(try f.poll(scope, bridge: bridge)))
        let ready = try f.snapshot(scope)
        #expect(ready["selection_enabled"] as? Bool == true)
        #expect(ready["boundary_id"] as? String == before["boundary_id"] as? String)
        let beforeRead = try f.sequences(scope), target = try f.target(scope)
        for _ in 0..<5 { _ = try f.pet(target); _ = try f.registry.petSessions() }
        #expect(try f.sequences(scope) == beforeRead)
        #expect(try f.target(scope)["ui_generation"] as? String == target["ui_generation"] as? String)
    }

    @Test("Selection is bound to one scope/card and disconnect does not affect another owner")
    func scopedSelectionAndDisconnect() throws {
        let f = try PetRegistryFixture(), a = try f.enroll(), b = try f.enroll()
        let bridgeA = try f.readyCard(a), bridgeB = try f.readyCard(b)
        let selectionA = try f.selection(a), selectionB = try f.selection(b)
        let targetA = try f.target(a), targetB = try f.target(b)
        let foreign = try f.pet(targetA, "select", selectionB)
        #expect((foreign["error"] as? [String: Any])?["code"] as? String == "binding_mismatch")
        let selected = try f.pet(targetA, "select", selectionA)
        #expect(selected["ok"] as? Bool == true)
        #expect((selected["result"] as? [String: Any])?["status"] as? String == "awaiting_claude_claim")
        #expect(try f.pet(targetA, "select", selectionA)["ok"] as? Bool == false)
        #expect(try f.pet(targetB)["ok"] as? Bool == true)
        f.clock.advance(1)
        #expect(try f.poll(a, bridge: bridgeA)?["kind"] as? String == "selection")
        let seqB = try f.sequences(b)
        try f.registry.disconnectPet(target: f.target(a))
        #expect(f.registry.activeScopeCount == 1)
        #expect(try f.registry.petSessions().first(where: { $0.mapping.authority.scopeID == a.id })?.state == .disconnected)
        #expect(throws: (any Error).self) { try f.session(a, "bridge.poll", ["bridge_id": bridgeA]) }
        #expect(try f.session(b, "bridge.poll", ["bridge_id": bridgeB])["ok"] as? Bool == true)
        #expect(try f.snapshot(b)["selection_enabled"] as? Bool == true)
        #expect(try f.sequences(b) == seqB)
    }

    @Test("Heartbeat loss redacts cached routes with their cards and affects only its scope")
    func staleRoutingRead() throws {
        let f = try PetRegistryFixture(), a = try f.enroll(), b = try f.enroll()
        _ = try f.readyCard(a)
        let bridgeB = try f.readyCard(b)
        f.clock.advance(4); _ = try f.poll(b, bridge: bridgeB)
        f.clock.advance(2)
        let before = try f.sequences(a)
        let snapshot = try f.snapshot(a)
        #expect((snapshot["cards"] as? [[String: Any]])?.isEmpty == true)
        let routing = try #require(snapshot["routing"] as? [String: Any])
        #expect((routing["pending"] as? [[String: Any]])?.isEmpty == true)
        #expect(routing["foreground"] is NSNull)
        #expect(routing["selection_enabled"] as? Bool == false)
        #expect(snapshot["readiness_status"] as? String == "disconnected")
        #expect(try f.sequences(a) == before)
        #expect(try f.snapshot(b)["selection_enabled"] as? Bool == true)
    }
}
