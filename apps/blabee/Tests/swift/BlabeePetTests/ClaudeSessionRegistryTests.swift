import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import SQLite3
import Testing
@testable import BlabeeCoordinator

private func registryWait(_ semaphore: DispatchSemaphore, seconds: Double) async -> Bool {
    await withCheckedContinuation { continuation in
        DispatchQueue.global().async {
            continuation.resume(returning: semaphore.wait(timeout: .now() + seconds) == .success)
        }
    }
}

private final class RegistryFreshness: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot: String
    private let lock = NSLock()
    private var value: FreshnessStoredRecord?
    private var nextLoad: (@Sendable () throws -> Void)?
    private var nextPending: (@Sendable () throws -> Void)?
    init(_ slot: String) { storageSlot = slot }
    func load() throws -> FreshnessStoredRecord? {
        let hook = lock.withLock { let result = nextLoad; nextLoad = nil; return result }
        try hook?()
        return lock.withLock { value }
    }
    func onNextLoad(_ operation: @escaping @Sendable () throws -> Void) { lock.withLock { nextLoad = operation } }
    func onNextPending(_ operation: @escaping @Sendable () throws -> Void) { lock.withLock { nextPending = operation } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard value == nil else { throw CoordinatorError("freshness_conflict") }
            let stored = try FreshnessStoredRecord(record: record, revision: record.revision)
            value = stored
            return stored
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        let saved = try lock.withLock {
            guard value?.revision == expectedRevision else { throw CoordinatorError("freshness_conflict") }
            let stored = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            value = stored
            return stored
        }
        if replacement.state == .pending {
            let hook = lock.withLock { let result = nextPending; nextPending = nil; return result }
            try hook?()
        }
        return saved
    }
}

private final class RegistryAnchors: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: RegistryFreshness] = [:]
    func get(_ slot: String) -> RegistryFreshness {
        lock.withLock {
            if let stored = values[slot] { return stored }
            let store = RegistryFreshness(slot)
            values[slot] = store
            return store
        }
    }
}

private final class RegistryIDs: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [UUID]
    init(_ values: [UUID]) { self.values = values }
    func next() -> UUID { lock.withLock { values.isEmpty ? UUID() : values.removeFirst() } }
}

private final class RegistryClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var instant: UInt64 = 0
    func nowNanoseconds() -> UInt64 { lock.withLock { instant } }
    func advance(seconds: UInt64) { lock.withLock { instant += seconds * 1_000_000_000 } }
}

private struct RegistryCodexProbe: CoordinatorOperationalHandling {
    func handle(type: String, payload: Data) async throws -> Data { Data("{\"codex\":true}".utf8) }
    func doctorStatus(payload: Data) async throws -> Data { Data("{}".utf8) }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
}

private final class RegistrySchedulerProbe: CoordinatorOperationalHandling, @unchecked Sendable {
    let processed = DispatchSemaphore(value: 0)
    let inspected = DispatchSemaphore(value: 0)
    func handle(type: String, payload: Data) async throws -> Data { Data("{}".utf8) }
    func doctorStatus(payload: Data) async throws -> Data { Data("{}".utf8) }
    func processTime() async throws -> [Data] { processed.signal(); return [] }
    func millisecondsUntilNextDeadline() async -> Int32? { inspected.signal(); return 19 }
}

private func registryDrainTime(_ registry: ClaudeSessionRegistry) async throws {
    let timeout = Date().addingTimeInterval(10)
    while registry.hasScheduledTimeWork {
        try #require(Date() < timeout, "Product maintenance did not finish")
        try await Task.sleep(for: .milliseconds(5))
    }
}

private func registryIdentity(_ value: [String: Any]) throws -> ClaudeSessionAuthority.Identity {
    let a = try #require(value["authority"] as? [String: String])
    func id(_ field: String) throws -> UUID { try #require(UUID(uuidString: a[field] ?? "")) }
    return try .init(scopeID: id("scope_id"), nativeSessionID: id("native_session_id"),
        sessionIncarnation: id("session_incarnation"), serviceIncarnation: id("service_incarnation"),
        ownerConnectionID: id("owner_connection_id"), authorityEpoch: id("authority_epoch"))
}

private func registryProposal() -> [String: Any] {
    ["schema_version": "blabee.claude-proposal.v1", "value": [
        "proposal_id": UUID().uuidString.lowercased(), "task_goal": "Exercise one isolated product scope",
        "outcome": ["status": "completed", "summary": "Fixture inspection completed"], "reported_side_effects": [],
        "options": [
            ["id": "a", "title": "Read fixture", "description": "Read a fixture", "task": "Read fixture.txt",
             "done_when": "Report fixture contents", "constraints": ["Do not change files"]],
            ["id": "b", "title": "List fixture", "description": "List the fixture directory", "task": "List files",
             "done_when": "Report the list", "constraints": []],
        ],
    ]]
}

private final class RegistryFixture {
    let directory: URL
    let root: URL
    let canonicalProjectPath: String
    let anchors = RegistryAnchors()
    let corpus = RuntimeSecretCorpus()
    let runtime = "sha256:" + String(repeating: "a", count: 64)
    var registry: ClaudeSessionRegistry?

    init(ids: RegistryIDs? = nil, clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock()) throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("blabee-cp02-" + UUID().uuidString)
            .standardizedFileURL.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        root = try ClaudeBridgeConfiguration.privateChild(of: directory, name: "product")
        let projectDirectory = try ClaudeBridgeConfiguration.privateChild(of: directory, name: "project 한글")
        let canonicalProject = try #require(realpath(projectDirectory.path, nil))
        defer { free(canonicalProject) }
        // Match the launcher's POSIX canonical path, including /private/tmp.
        canonicalProjectPath = try #require(String(validatingCString: canonicalProject))
        try #require(ClaudeCanonicalDirectory.matches(canonicalProjectPath))
        registry = try ClaudeSessionRegistry(rootURL: root, runtimeIdentity: runtime, secretCorpus: corpus,
            freshnessFactory: { [anchors] in anchors.get($0) }, clock: clock,
            wallNow: { Date(timeIntervalSince1970: 1_800_000_000 + Double(clock.nowNanoseconds()) / 1_000_000_000) },
            newID: { ids?.next() ?? UUID() })
    }
    deinit {
        registry = nil
        try? FileManager.default.removeItem(at: directory)
    }
    func request(connection: UUID = UUID(), operation: String = "enroll",
                 modify: (inout [String: Any]) -> Void = { _ in }) throws -> (UUID, ClaudeProductWireCodec.Envelope) {
        let current = try #require(registry)
        var payload: [String: Any] = [
            "service_incarnation": current.serviceIncarnation.uuidString.lowercased(),
            "owner_connection_id": connection.uuidString.lowercased(), "challenge_id": UUID().uuidString.lowercased(),
            "grant_pipe_id": UUID().uuidString.lowercased(), "cwd": canonicalProjectPath, "channel_source": "blabee-claude",
        ]
        modify(&payload)
        let envelope = try ClaudeProductWireCodec(credentialCorpus: corpus).decodeRequest(
            StrictJSONTransport.data(forJSONObject: [
                "schema_version": "blabee.claude-owner.v1", "kind": "request", "request_id": UUID().uuidString.lowercased(),
                "provider": "claude", "role": "owner", "operation": operation, "payload": payload,
            ]))
        return (connection, envelope)
    }
    func enroll(connection: UUID = UUID()) throws -> (UUID, [String: Any], [String: Any]) {
        let (owner, request) = try self.request(connection: connection)
        var grant = Data()
        let registry = try #require(registry)
        let response = try registry.enroll(connectionID: owner, request: request) { grant = $0 }
        #expect(!corpus.containsKnownSecret(in: response))
        return (owner, try StrictJSONTransport.object(from: response), try StrictJSONTransport.object(from: grant))
    }
    func enrollObserved(nativeID: UUID, source: String) throws -> (UUID, [String: Any], [String: Any]) {
        let (owner, request) = try self.request(operation: "enroll_observed") {
            $0["native_session_id"] = nativeID.uuidString.lowercased()
            $0["source"] = source
        }
        var grant = Data()
        let registry = try #require(registry)
        let response = try registry.enroll(connectionID: owner, request: request) { grant = $0 }
        #expect(!corpus.containsKnownSecret(in: response))
        return (owner, try StrictJSONTransport.object(from: response), try StrictJSONTransport.object(from: grant))
    }

    func petSnapshot(_ publicGrant: [String: Any]) throws -> [String: Any] {
        let identity = try registryIdentity(publicGrant)
        let registry = try #require(registry)
        let descriptors = try registry.petSessions()
        let descriptor = try #require(descriptors.first { $0.mapping.authority == identity })
        let request = try ClaudeProductWireCodec(credentialCorpus: corpus).decodeRequest(
            StrictJSONTransport.data(forJSONObject: [
                "schema_version": "blabee.pet-provider.v1", "kind": "request", "request_id": UUID().uuidString.lowercased(),
                "provider": "claude", "role": "selector", "operation": "snapshot", "payload": [:],
                "target": ["scope_id": identity.scopeID.uuidString.lowercased(),
                    "service_incarnation": identity.serviceIncarnation.uuidString.lowercased(),
                    "session_incarnation": identity.sessionIncarnation.uuidString.lowercased(),
                    "authority_epoch": identity.authorityEpoch.uuidString.lowercased(),
                    "ui_generation": String(descriptor.uiGeneration)],
            ]))
        let response = try StrictJSONTransport.object(from: registry.handlePet(request: request))
        #expect(response["ok"] as? Bool == true)
        let result = try #require(response["result"] as? [String: Any])
        let projection = try #require(result["projection"] as? [String: Any])
        return try #require(projection["value"] as? [String: Any])
    }
    func coreSequences() throws -> [String: Int64] {
        let directories = try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("scopes"),
                                                                      includingPropertiesForKeys: nil)
        var values: [String: Int64] = [:]
        for scope in directories {
            let database = scope.appendingPathComponent("core/coordinator.sqlite3")
            guard FileManager.default.fileExists(atPath: database.path) else { continue }
            var handle: OpaquePointer?
            guard sqlite3_open_v2(database.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                throw CoordinatorError("fixture_database")
            }
            defer { sqlite3_close(handle) }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "SELECT count(*) FROM runtime_events", -1, &statement, nil) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_ROW else { throw CoordinatorError("fixture_database") }
            values[scope.lastPathComponent] = sqlite3_column_int64(statement, 0)
            sqlite3_finalize(statement)
        }
        return values
    }

    func ownerRequest(_ publicGrant: [String: Any], operation: String,
                      payload: [String: Any]) throws -> ClaudeProductWireCodec.Envelope {
        try ClaudeProductWireCodec(credentialCorpus: corpus).decodeRequest(StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-owner.v1", "kind": "request", "request_id": UUID().uuidString.lowercased(),
            "provider": "claude", "role": "owner", "operation": operation,
            "authority": publicGrant["authority"]!, "payload": payload,
        ]))
    }

    func metadataSequences() throws -> [String: Int64] {
        let scopes = try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("scopes"),
                                                                 includingPropertiesForKeys: nil)
        var values: [String: Int64] = [:]
        for scope in scopes {
            let path = scope.appendingPathComponent("metadata/metadata.sqlite3").path
            var database: OpaquePointer?
            guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                throw CoordinatorError("fixture_database")
            }
            defer { sqlite3_close(database) }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, "SELECT count(*) FROM metadata_operations", -1, &statement, nil) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_ROW else { throw CoordinatorError("fixture_database") }
            values[scope.lastPathComponent] = sqlite3_column_int64(statement, 0)
            sqlite3_finalize(statement)
        }
        return values
    }

    func session(_ publicGrant: [String: Any], grant: [String: Any], operation: String,
                 role: String = "bridge", payload: [String: Any] = [:]) throws -> [String: Any] {
        let object = try sessionPayload(publicGrant, grant: grant, operation: operation, role: role, payload: payload)
        let current = try #require(registry)
        return try StrictJSONTransport.object(from: current.handleSession(StrictJSONTransport.data(forJSONObject: object)))
    }

    func sessionPayload(_ publicGrant: [String: Any], grant: [String: Any], operation: String,
                        role: String = "bridge", payload: [String: Any] = [:]) throws -> [String: Any] {
        let tokens = try #require(grant["role_capabilities"] as? [String: String])
        let token = try #require(tokens[role])
        return ["auth_token": token, "envelope": [
            "schema_version": "blabee.claude-session.v2", "kind": "request", "request_id": UUID().uuidString.lowercased(),
            "provider": "claude", "role": role, "operation": operation,
            "authority": publicGrant["authority"]!, "payload": payload,
        ]]
    }

    func hook(_ publicGrant: [String: Any], grant: [String: Any], event: String,
              fields: [String: Any] = [:]) throws -> [String: Any] {
        let identity = try #require(publicGrant["authority"] as? [String: String])
        var payload: [String: Any] = ["native_session_id": identity["native_session_id"]!, "cwd": canonicalProjectPath, "event": event]
        payload.merge(fields) { _, value in value }
        return try session(publicGrant, grant: grant, operation: "hook", role: "hook", payload: payload)
    }
}

@Suite("Claude product registry")
struct ClaudeSessionRegistryTests {
    @Test("An observed first start binds Claude's real ID without creating a boundary or readiness",
          arguments: ["startup", "resume", "fork"])
    func observedFirstStart(source: String) throws {
        let f = try RegistryFixture(clock: RegistryClock())
        let nativeID = UUID()
        let (_, issued, grant) = try f.enrollObserved(nativeID: nativeID, source: source)
        #expect(issued["operation"] as? String == "enroll_observed")
        #expect(try registryIdentity(issued).nativeSessionID == nativeID)
        #expect(try f.coreSequences().values.allSatisfy { $0 == 0 })
        let opened = try f.session(issued, grant: grant, operation: "bridge.open")
        let bridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
        let initial = try f.petSnapshot(issued)
        #expect(initial["boundary_id"] is NSNull)
        #expect(initial["ready"] as? Bool == false)
        #expect(initial["selection_enabled"] as? Bool == false)
        #expect((initial["native_observation"] as? [String: Any])?["status"] as? String == "started")
        let polled = try f.session(issued, grant: grant, operation: "bridge.poll", payload: ["bridge_id": bridge])
        #expect(((polled["result"] as? [String: Any])?["event"] as? [String: Any])?["kind"] as? String == "readiness_probe")
        #expect(try f.petSnapshot(issued)["ready"] as? Bool == false)
        // No synthetic SessionStart was sent through session-v2. The fresh
        // user observation can open a boundary after the typed initial start.
        let promptID = UUID().uuidString.lowercased()
        let prompt = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": promptID, "prompt_sha256": String(repeating: "a", count: 64)])
        #expect(prompt["ok"] as? Bool == true)
        #expect((prompt["result"] as? [String: Any])?["boundary_id"] is String)
        #expect(try f.petSnapshot(issued)["ready"] as? Bool == false)
        let compact = try f.hook(issued, grant: grant, event: "SessionStart", fields: ["source": "compact", "prompt_id": promptID])
        #expect(compact["ok"] as? Bool == true)
        #expect((compact["result"] as? [String: Any])?["boundary_id"] as? String
            != (prompt["result"] as? [String: Any])?["boundary_id"] as? String)
        #expect(f.registry?.activeScopeCount == 1)
    }

    @Test("Concurrent launches of the same native conversation receive independent fresh authority")
    func observedSameConversationScopes() throws {
        let f = try RegistryFixture(clock: RegistryClock())
        let nativeID = UUID()
        let (ownerA, issuedA, grantA) = try f.enrollObserved(nativeID: nativeID, source: "startup")
        let (_, issuedB, grantB) = try f.enrollObserved(nativeID: nativeID, source: "resume")
        let a = try registryIdentity(issuedA), b = try registryIdentity(issuedB)
        #expect(a.nativeSessionID == b.nativeSessionID)
        #expect(a.serviceIncarnation == b.serviceIncarnation)
        #expect(a.scopeID != b.scopeID && a.ownerConnectionID != b.ownerConnectionID)
        #expect(a.sessionIncarnation != b.sessionIncarnation && a.authorityEpoch != b.authorityEpoch)
        #expect(grantA["core_project_id"] as? String != grantB["core_project_id"] as? String)
        #expect(grantA["core_session_id"] as? String != grantB["core_session_id"] as? String)
        let rolesA = try #require(grantA["role_capabilities"] as? [String: String])
        let rolesB = try #require(grantB["role_capabilities"] as? [String: String])
        #expect(Set(rolesA.values).intersection(Set(rolesB.values)).isEmpty)
        #expect(throws: (any Error).self) {
            try f.session(issuedB, grant: grantA, operation: "bridge.open")
        }
        f.registry?.disconnect(connectionID: ownerA)
        #expect(f.registry?.activeScopeCount == 1)
        #expect(throws: (any Error).self) { try f.session(issuedA, grant: grantA, operation: "bridge.open") }
        #expect(try f.session(issuedB, grant: grantB, operation: "bridge.open")["ok"] as? Bool == true)
        #expect(try f.petSnapshot(issuedB)["boundary_id"] is NSNull)
    }

    @Test("A new resume scope cannot reuse a historical authority, boundary or readiness acknowledgement")
    func observedResumeDoesNotRestoreHistory() throws {
        let f = try RegistryFixture(clock: RegistryClock())
        let nativeID = UUID()
        let (owner, old, oldGrant) = try f.enrollObserved(nativeID: nativeID, source: "startup")
        let opened = try f.session(old, grant: oldGrant, operation: "bridge.open")
        let oldBridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
        let polled = try f.session(old, grant: oldGrant, operation: "bridge.poll", payload: ["bridge_id": oldBridge])
        let probe = try #require((polled["result"] as? [String: Any])?["event"] as? [String: Any])
        let prompt = try f.hook(old, grant: oldGrant, event: "UserPromptSubmit", fields: [
            "prompt_id": UUID().uuidString.lowercased(), "prompt_sha256": String(repeating: "a", count: 64)])
        let boundary = try #require((prompt["result"] as? [String: Any])?["boundary_id"] as? String)
        let proposal = try f.session(old, grant: oldGrant, operation: "proposal.emit", payload: [
            "bridge_id": oldBridge, "boundary_id": boundary, "proposal": registryProposal()])
        #expect(proposal["ok"] as? Bool == true)
        f.registry?.disconnect(connectionID: owner)
        let (_, fresh, freshGrant) = try f.enrollObserved(nativeID: nativeID, source: "resume")
        let freshOpened = try f.session(fresh, grant: freshGrant, operation: "bridge.open")
        let freshBridge = try #require((freshOpened["result"] as? [String: Any])?["bridge_id"] as? String)
        #expect(throws: (any Error).self) { try f.session(old, grant: oldGrant, operation: "bridge.poll", payload: ["bridge_id": oldBridge]) }
        let oldProposal = try f.session(fresh, grant: freshGrant, operation: "proposal.emit", payload: [
            "bridge_id": freshBridge, "boundary_id": boundary, "proposal": registryProposal()])
        #expect(oldProposal["ok"] as? Bool == false)
        let oldACK = try f.session(fresh, grant: freshGrant, operation: "readiness.ack", payload: [
            "bridge_id": freshBridge, "probe_id": probe["probe_id"]!, "nonce": probe["nonce"]!])
        #expect(oldACK["ok"] as? Bool == false)
        let snapshot = try f.petSnapshot(fresh)
        #expect(snapshot["boundary_id"] is NSNull)
        #expect((snapshot["cards"] as? [[String: Any]])?.isEmpty == true)
        #expect(snapshot["ready"] as? Bool == false)
        #expect(f.registry?.activeScopeCount == 1)
    }

    @Test("After observed enrollment a second startup or unsupported in-place transition revokes only that scope",
          arguments: ["startup", "unsupported_source", "native_id", "cwd"])
    func observedLaterTransitionRevokes(kind: String) throws {
        let f = try RegistryFixture(clock: RegistryClock())
        let (_, issued, grant) = try f.enrollObserved(nativeID: UUID(), source: "resume")
        let (_, other, otherGrant) = try f.enrollObserved(nativeID: UUID(), source: "startup")
        let event: String
        let fields: [String: Any]
        switch kind {
        case "startup": event = "SessionStart"; fields = ["source": "startup"]
        case "native_id": event = "SessionStart"; fields = ["source": "compact", "native_session_id": UUID().uuidString.lowercased()]
        case "cwd": event = "SessionStart"; fields = ["source": "compact", "cwd": f.directory.path]
        default: event = "ObservationUnavailable"; fields = ["reason": "unsupported_source"]
        }
        let response = try f.hook(issued, grant: grant, event: event, fields: fields)
        #expect(response["ok"] as? Bool == false)
        #expect(f.registry?.activeScopeCount == 1)
        #expect(throws: (any Error).self) { try f.session(issued, grant: grant, operation: "bridge.open") }
        #expect(try f.session(other, grant: otherGrant, operation: "bridge.open")["ok"] as? Bool == true)
    }

    @Test("Product compact replaces the current boundary and durable prompt/proposal replay stays rejected")
    func productCompactReplay() throws {
        let f = try RegistryFixture(clock: RegistryClock())
        let (_, issued, grant) = try f.enroll()
        _ = try f.hook(issued, grant: grant, event: "SessionStart", fields: ["source": "startup"])
        let opened = try f.session(issued, grant: grant, operation: "bridge.open")
        let bridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
        let prompt = UUID().uuidString.lowercased()
        let observed = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": prompt, "prompt_sha256": String(repeating: "a", count: 64)])
        let before = try #require((observed["result"] as? [String: Any])?["boundary_id"] as? String)
        _ = try f.hook(issued, grant: grant, event: "Stop", fields: ["prompt_id": prompt, "background_task_ids": []])
        let proposal = registryProposal()
        let emitted = try f.session(issued, grant: grant, operation: "proposal.emit", payload: [
            "bridge_id": bridge, "boundary_id": before, "proposal": proposal])
        #expect(emitted["ok"] as? Bool == true)
        let compact = try f.hook(issued, grant: grant, event: "SessionStart", fields: ["source": "compact", "prompt_id": prompt])
        let after = try #require((compact["result"] as? [String: Any])?["boundary_id"] as? String)
        #expect(after != before)
        _ = try f.hook(issued, grant: grant, event: "Stop", fields: ["prompt_id": prompt, "background_task_ids": []])
        let repeated = try f.session(issued, grant: grant, operation: "proposal.emit", payload: [
            "bridge_id": bridge, "boundary_id": after, "proposal": proposal])
        #expect(repeated["ok"] as? Bool == false)
        #expect((repeated["error"] as? [String: Any])?["code"] as? String == "binding_mismatch")
        _ = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": UUID().uuidString.lowercased(), "prompt_sha256": String(repeating: "b", count: 64)])
        let replay = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": prompt, "prompt_sha256": String(repeating: "a", count: 64)])
        #expect(replay["ok"] as? Bool == false)
        #expect(f.registry?.activeScopeCount == 1)
        #expect(try f.metadataSequences().values.allSatisfy { $0 > 2 })
    }

    @Test("Product bridge polling and no-op scheduling never append metadata; due writes remain bracketed")
    func productPollingAndScheduler() async throws {
        let clock = RegistryClock()
        let f = try RegistryFixture(clock: clock)
        let (_, issued, grant) = try f.enroll()
        let registry = try #require(f.registry)
        _ = try f.hook(issued, grant: grant, event: "SessionStart", fields: ["source": "startup"])
        let opened = try f.session(issued, grant: grant, operation: "bridge.open")
        let bridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
        let prompt = UUID().uuidString.lowercased()
        let observed = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": prompt, "prompt_sha256": String(repeating: "c", count: 64)])
        let boundary = try #require((observed["result"] as? [String: Any])?["boundary_id"] as? String)
        _ = try f.hook(issued, grant: grant, event: "Stop", fields: ["prompt_id": prompt, "background_task_ids": []])
        _ = try f.session(issued, grant: grant, operation: "proposal.emit", payload: [
            "bridge_id": bridge, "boundary_id": boundary, "proposal": registryProposal()])
        let coreBefore = try f.coreSequences(), metadataBefore = try f.metadataSequences()
        for index in 0..<100 {
            if index > 0, index % 7 == 0 { clock.advance(seconds: 1) }
            let result = try f.session(issued, grant: grant, operation: "bridge.poll", payload: ["bridge_id": bridge])
            #expect(result["ok"] as? Bool == true)
            registry.processTime()
        }
        try await registryDrainTime(registry)
        #expect(try f.coreSequences() == coreBefore)
        #expect(try f.metadataSequences() == metadataBefore)
        #expect(try #require(registry.millisecondsUntilNextDeadline()) > 0)
        clock.advance(seconds: 6)
        let expiredPoll = try f.session(issued, grant: grant, operation: "bridge.poll", payload: ["bridge_id": bridge])
        #expect(expiredPoll["ok"] as? Bool == true)
        #expect(try f.coreSequences() == coreBefore)
        #expect(try f.metadataSequences() == metadataBefore)
        registry.processTime()
        try await registryDrainTime(registry)
        #expect(try f.coreSequences() != coreBefore)
        #expect(try f.metadataSequences() != metadataBefore)
        #expect(try registry.summaries().allSatisfy { $0.state != .quarantined })
        #expect(registry.activeScopeCount == 1)
    }

    @Test("The common scheduler expires one product scope without reviving it or removing a renewed peer")
    func schedulerScopeExpiry() async throws {
        let clock = RegistryClock()
        let f = try RegistryFixture(clock: clock)
        let (_, _, _) = try f.enroll()
        let (other, issued, _) = try f.enroll()
        let registry = try #require(f.registry)
        clock.advance(seconds: 3000)
        _ = try registry.control(connectionID: other, request: f.ownerRequest(issued, operation: "renew",
            payload: ["renewal_sequence": "1"]))
        clock.advance(seconds: 600)
        registry.processTime()
        try await registryDrainTime(registry)
        #expect(registry.activeScopeCount == 1)
        #expect(registry.millisecondsUntilNextDeadline() == 3_000_000)
    }

    @Test("Blocked Claude timer storage never delays Codex deadlines or another Claude scope")
    func schedulerStorageIsolation() async throws {
        let clock = RegistryClock()
        let f = try RegistryFixture(clock: clock)
        let registry = try #require(f.registry)
        var scopeIDs: [String] = []
        for _ in 0..<2 {
            let (_, issued, grant) = try f.enroll()
            let identity = try registryIdentity(issued)
            scopeIDs.append(identity.scopeID.uuidString.lowercased())
            _ = try f.hook(issued, grant: grant, event: "SessionStart", fields: ["source": "startup"])
            let opened = try f.session(issued, grant: grant, operation: "bridge.open")
            let bridge = try #require((opened["result"] as? [String: Any])?["bridge_id"] as? String)
            let prompt = UUID().uuidString.lowercased()
            let observed = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
                "prompt_id": prompt, "prompt_sha256": String(repeating: "d", count: 64)])
            let boundary = try #require((observed["result"] as? [String: Any])?["boundary_id"] as? String)
            _ = try f.hook(issued, grant: grant, event: "Stop", fields: ["prompt_id": prompt, "background_task_ids": []])
            _ = try f.session(issued, grant: grant, operation: "proposal.emit", payload: [
                "bridge_id": bridge, "boundary_id": boundary, "proposal": registryProposal()])
        }
        let before = try f.coreSequences()
        let database = registry.rootURL.appendingPathComponent("scopes/\(scopeIDs[0])/core/coordinator.sqlite3")
        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        f.anchors.get(ClaudeSessionRegistry.account(database, family: "core")).onNextLoad {
            entered.signal()
            guard release.wait(timeout: .now() + 10) == .success else { throw CoordinatorError("fixture_timeout") }
        }
        defer { release.signal() }
        clock.advance(seconds: 6)
        let codex = RegistrySchedulerProbe()
        let app = ClaudeProductServiceCoordinator(codex: codex, registry: registry)
        let processing = Task.detached { try await app.processTime() }
        #expect(await registryWait(entered, seconds: 5))
        let codexProgressed = await registryWait(codex.processed, seconds: 1)
        let inspection = Task.detached { await app.millisecondsUntilNextDeadline() }
        let codexInspected = await registryWait(codex.inspected, seconds: 1)
        var peerProgressed = false
        for _ in 0..<100 {
            let after = try f.coreSequences()
            if after[scopeIDs[1]] != before[scopeIDs[1]] { peerProgressed = true; break }
            try await Task.sleep(for: .milliseconds(10))
        }
        release.signal()
        _ = try await processing.value
        let deadline = try #require(await inspection.value)
        #expect((0...19).contains(deadline))
        try await registryDrainTime(registry)
        #expect(codexProgressed)
        #expect(codexInspected)
        #expect(peerProgressed)
        #expect(registry.activeScopeCount == 2)
    }

    @Test("Private owner renewals keep one registry identity for 24 hours without core writes")
    func ownerRenewalDay() throws {
        let clock = RegistryClock()
        let f = try RegistryFixture(clock: clock)
        let (owner, issued, _) = try f.enroll()
        let registry = try #require(f.registry)
        let before = try f.coreSequences()
        for sequence in 1...288 {
            clock.advance(seconds: 300)
            let request = try f.ownerRequest(issued, operation: "renew", payload: ["renewal_sequence": String(sequence)])
            let data = try registry.control(connectionID: owner, request: request)
            let response = try StrictJSONTransport.object(from: data)
            #expect(response["ok"] as? Bool == true)
            #expect(response["authority"] as? [String: String] == issued["authority"] as? [String: String])
            let result = try #require(response["result"] as? [String: Any])
            let lease = try #require(result["lease"] as? [String: String])
            #expect(lease["deadline_nanoseconds"] == String(clock.nowNanoseconds() + ClaudeSessionAuthority.leaseDurationNanoseconds))
            #expect(lease["renewal_sequence"] == String(sequence))
        }
        #expect(try f.coreSequences() == before)
        #expect(try registry.summaries().first?.state == .awaitingNativeStart)
    }

    @Test("Owner duplicate renewal is stable, wrong connection and expired renewal cannot restore authority")
    func ownerRenewalFailureBoundaries() throws {
        let clock = RegistryClock()
        let f = try RegistryFixture(clock: clock)
        let (owner, issued, _) = try f.enroll()
        let registry = try #require(f.registry)
        clock.advance(seconds: 300)
        let first = try f.ownerRequest(issued, operation: "renew", payload: ["renewal_sequence": "1"])
        let a = try StrictJSONTransport.object(from: registry.control(connectionID: owner, request: first))
        clock.advance(seconds: 100)
        let b = try StrictJSONTransport.object(from: registry.control(connectionID: owner, request: first))
        #expect(try StrictJSONTransport.data(forJSONObject: a["result"]!) == StrictJSONTransport.data(forJSONObject: b["result"]!))
        #expect(throws: (any Error).self) { try registry.control(connectionID: UUID(), request: first) }
        let skipped = try f.ownerRequest(issued, operation: "renew", payload: ["renewal_sequence": "3"])
        let rejected = try StrictJSONTransport.object(from: registry.control(connectionID: owner, request: skipped))
        #expect(rejected["ok"] as? Bool == false)
        clock.advance(seconds: 3500) // Exactly the successful renewal's deadline.
        let expired = try StrictJSONTransport.object(from: registry.control(connectionID: owner, request: first))
        #expect((expired["error"] as? [String: String])?["code"] == "expired")
        let next = try f.ownerRequest(issued, operation: "renew", payload: ["renewal_sequence": "2"])
        #expect(try StrictJSONTransport.object(from: registry.control(connectionID: owner, request: next))["ok"] as? Bool == false)
    }

    @Test("Every authenticated owner end reason revokes only its own registry scope",
          arguments: ["owner_disconnected", "child_exited", "session_ended", "user_disconnected", "service_replaced"])
    func ownerEndsOnlyOwnScope(reason: String) throws {
        let f = try RegistryFixture()
        let (owner, issued, _) = try f.enroll()
        let (other, otherIssued, _) = try f.enroll()
        let registry = try #require(f.registry)
        let end = try f.ownerRequest(issued, operation: "end", payload: ["reason": reason])
        let reply = try StrictJSONTransport.object(from: registry.control(connectionID: owner, request: end))
        #expect(reply["ok"] as? Bool == true)
        #expect(registry.activeScopeCount == 1)
        let old = try f.ownerRequest(issued, operation: "renew", payload: ["renewal_sequence": "1"])
        #expect(try StrictJSONTransport.object(from: registry.control(connectionID: owner, request: old))["ok"] as? Bool == false)
        let current = try f.ownerRequest(otherIssued, operation: "renew", payload: ["renewal_sequence": "1"])
        #expect(try StrictJSONTransport.object(from: registry.control(connectionID: other, request: current))["ok"] as? Bool == true)
    }

    @Test("Expiry or owner EOF during SQLite freshness preparation blocks the actual COMMIT",
          arguments: ["expiry", "eof"])
    func finalCommitFence(reason: String) throws {
        let clock = RegistryClock()
        let f = try RegistryFixture(clock: clock)
        let (owner, issued, grant) = try f.enroll()
        let (otherOwner, otherIssued, _) = try f.enroll()
        let registry = try #require(f.registry)
        if reason == "expiry" {
            clock.advance(seconds: 3000)
            let renew = try f.ownerRequest(otherIssued, operation: "renew", payload: ["renewal_sequence": "1"])
            _ = try registry.control(connectionID: otherOwner, request: renew)
        }
        _ = try f.hook(issued, grant: grant, event: "SessionStart", fields: ["source": "startup"])
        let open = try f.session(issued, grant: grant, operation: "bridge.open")
        let result = try #require(open["result"] as? [String: Any])
        let bridge = try #require(result["bridge_id"] as? String)
        let prompt = UUID().uuidString.lowercased()
        let hook = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": prompt, "prompt_sha256": String(repeating: "d", count: 64)])
        let observation = try #require(hook["result"] as? [String: Any])
        let boundary = try #require(observation["boundary_id"] as? String)
        _ = try f.hook(issued, grant: grant, event: "Stop", fields: ["prompt_id": prompt, "background_task_ids": []])
        let identity = try registryIdentity(issued)
        let database = registry.rootURL.appendingPathComponent("scopes/\(identity.scopeID.uuidString.lowercased())/core/coordinator.sqlite3")
        let before = try f.coreSequences()
        let triggered = DispatchSemaphore(value: 0)
        f.anchors.get(ClaudeSessionRegistry.account(database, family: "core")).onNextPending {
            if reason == "expiry" { clock.advance(seconds: 600) }
            else { registry.disconnect(connectionID: owner) }
            triggered.signal()
        }
        do {
            let response = try f.session(issued, grant: grant, operation: "proposal.emit", payload: [
                "bridge_id": bridge, "boundary_id": boundary, "proposal": registryProposal()])
            #expect(response["ok"] as? Bool == false)
        } catch { /* A transport-level refusal is also non-executable. */ }
        #expect(triggered.wait(timeout: .now() + 1) == .success)
        #expect(try f.coreSequences() == before)
        let summaries = try registry.summaries()
        #expect(summaries.filter { $0.state == .quarantined }.count == 1)
        #expect(summaries.filter { $0.state == .awaitingNativeStart }.count == 1)
        #expect(registry.activeScopeCount == 1)
    }

    @Test("A malformed opaque proposal cannot quarantine a valid scope when no core commit occurred")
    func invalidProposalDoesNotRevoke() throws {
        let f = try RegistryFixture()
        let (_, issued, grant) = try f.enroll()
        _ = try f.hook(issued, grant: grant, event: "SessionStart", fields: ["source": "startup"])
        let opened = try f.session(issued, grant: grant, operation: "bridge.open")
        let result = try #require(opened["result"] as? [String: Any])
        let bridge = try #require(result["bridge_id"] as? String)
        let prompt = UUID().uuidString.lowercased()
        let hook = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": prompt, "prompt_sha256": String(repeating: "e", count: 64)])
        let observation = try #require(hook["result"] as? [String: Any])
        let boundary = try #require(observation["boundary_id"] as? String)
        _ = try f.hook(issued, grant: grant, event: "Stop", fields: ["prompt_id": prompt, "background_task_ids": []])
        let before = try f.coreSequences()
        let invalid: [String: Any] = ["schema_version": "blabee.claude-proposal.v1", "value": ["invalid": true]]
        let bad = try f.session(issued, grant: grant, operation: "proposal.emit", payload: [
            "bridge_id": bridge, "boundary_id": boundary, "proposal": invalid])
        #expect(bad["ok"] as? Bool == false)
        #expect(try f.coreSequences() == before)
        #expect(f.registry?.activeScopeCount == 1)
        let next = try f.hook(issued, grant: grant, event: "UserPromptSubmit", fields: [
            "prompt_id": UUID().uuidString.lowercased(), "prompt_sha256": String(repeating: "f", count: 64)])
        #expect(next["ok"] as? Bool == true)
    }

    @Test("Two Claude scopes at the same cwd have separate credentials, core IDs, storage and initial state")
    func twoScopes() throws {
        let f = try RegistryFixture()
        let (_, a, grantA) = try f.enroll()
        let (_, b, grantB) = try f.enroll()
        let authorityA = try #require(a["authority"] as? [String: String])
        let authorityB = try #require(b["authority"] as? [String: String])
        #expect(authorityA["scope_id"] != authorityB["scope_id"])
        #expect(authorityA["native_session_id"] != authorityB["native_session_id"])
        #expect(authorityA["session_incarnation"] != authorityB["session_incarnation"])
        #expect(grantA["core_session_id"] as? String != grantB["core_session_id"] as? String)
        let rolesA = try #require(grantA["role_capabilities"] as? [String: String])
        let rolesB = try #require(grantB["role_capabilities"] as? [String: String])
        #expect(Set(rolesA.keys) == ["owner", "hook", "bridge"])
        #expect(Set(rolesA.values).intersection(Set(rolesB.values)).isEmpty)
        let summaries = try #require(f.registry).summaries()
        #expect(summaries.count == 2)
        #expect(summaries.allSatisfy { $0.state == .awaitingNativeStart && $0.mapping?.canonicalCWD == f.canonicalProjectPath })
        #expect(try f.coreSequences().values.allSatisfy { $0 == 0 })
        // A registration/lookup creates no core runtime event or Codex schema extension.
        let enumerator = try #require(FileManager.default.enumerator(at: f.root, includingPropertiesForKeys: [.isRegularFileKey]))
        for case let file as URL in enumerator {
            guard (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { continue }
            let bytes = try Data(contentsOf: file)
            for token in Array(rolesA.values) + Array(rolesB.values) {
                #expect(bytes.range(of: Data(token.utf8)) == nil)
            }
        }
    }

    @Test("Wrong connection, service, cwd or unqualified Channel source cannot initialize storage",
          arguments: ["owner", "service", "cwd", "channel"])
    func invalidRegistration(which: String) throws {
        let f = try RegistryFixture()
        let (connection, request) = try f.request { value in
            switch which {
            case "owner": value["owner_connection_id"] = UUID().uuidString.lowercased()
            case "service": value["service_incarnation"] = UUID().uuidString.lowercased()
            case "cwd": value["cwd"] = f.canonicalProjectPath + "/.."
            default: value["channel_source"] = "plugin:unqualified:bridge"
            }
        }
        let registry = try #require(f.registry)
        #expect(throws: (any Error).self) { try registry.enroll(connectionID: connection, request: request) { _ in
            Issue.record("An invalid registration must never receive a grant")
        } }
        #expect(try registry.summaries().isEmpty)
    }

    @Test("A failed private grant delivery does not activate a scope or disturb another Claude")
    func grantFailure() throws {
        let f = try RegistryFixture()
        _ = try f.enroll()
        let (owner, request) = try f.request()
        let registry = try #require(f.registry)
        #expect(throws: (any Error).self) { try registry.enroll(connectionID: owner, request: request) { _ in
            throw CoordinatorError("fixture_pipe_closed")
        } }
        #expect(registry.activeScopeCount == 1)
        let summaries = try registry.summaries()
        #expect(summaries.filter { $0.state == .awaitingNativeStart }.count == 1)
        #expect(summaries.filter { $0.state == .historyOnly }.count == 1)
    }

    @Test("Scope descriptor collisions are rejected before duplicate storage initialization")
    func duplicateDescriptor() throws {
        let duplicate = UUID()
        let ids = RegistryIDs([duplicate, UUID(), UUID(), UUID(), UUID(), UUID(),
                               duplicate, UUID(), UUID(), UUID(), UUID(), UUID()])
        let f = try RegistryFixture(ids: ids)
        _ = try f.enroll()
        let before = try f.coreSequences()
        #expect(throws: (any Error).self) { try f.enroll() }
        #expect(try f.coreSequences() == before)
        let registry = try #require(f.registry)
        #expect(registry.activeScopeCount == 1)
    }

    @Test("Owner disconnect is scoped; history and service restart do not restore authority or advance core", arguments: [false, true])
    func scopedDisconnectAndRestart(observed: Bool) throws {
        let f = try RegistryFixture()
        let (owner, _, _) = try observed ? f.enrollObserved(nativeID: UUID(), source: "resume") : f.enroll()
        _ = try f.enroll()
        let oldIncarnation = try #require(f.registry).serviceIncarnation
        let before = try f.coreSequences()
        f.registry?.disconnect(connectionID: owner)
        #expect(f.registry?.activeScopeCount == 1)
        let oldStatuses = try f.registry?.summaries()
        #expect(oldStatuses?.filter { $0.state == .historyOnly }.count == 1)
        #expect(try f.coreSequences() == before)
        f.registry = nil
        f.registry = try ClaudeSessionRegistry(rootURL: f.root, runtimeIdentity: f.runtime, secretCorpus: f.corpus,
            freshnessFactory: { [anchors = f.anchors] in anchors.get($0) })
        let restarted = try #require(f.registry)
        #expect(restarted.serviceIncarnation != oldIncarnation)
        #expect(restarted.activeScopeCount == 0)
        let history = try restarted.summaries()
        #expect(history.count == 2)
        #expect(history.allSatisfy { $0.state == .historyOnly })
        #expect(try f.coreSequences() == before)
    }

    @Test("A damaged scope is quarantined while another live scope remains usable")
    func damagedHistoryIsIsolated() throws {
        let f = try RegistryFixture()
        let (owner, response, _) = try f.enroll()
        _ = try f.enroll()
        let authority = try #require(response["authority"] as? [String: String])
        let scope = try #require(authority["scope_id"])
        let before = try f.coreSequences()
        f.registry?.disconnect(connectionID: owner)
        let path = f.root.appendingPathComponent("scopes/\(scope)/metadata/metadata.sqlite3")
        try Data("damaged fixture".utf8).write(to: path)
        let statuses = try #require(f.registry).summaries()
        #expect(statuses.filter { $0.state == .quarantined }.count == 1)
        #expect(statuses.filter { $0.state == .awaitingNativeStart }.count == 1)
        #expect(try f.coreSequences() == before)
    }

    @Test("A second registry cannot own the same product storage root")
    func secondServiceRejected() throws {
        let f = try RegistryFixture()
        #expect(throws: (any Error).self) {
            try ClaudeSessionRegistry(rootURL: f.root, runtimeIdentity: f.runtime, secretCorpus: f.corpus,
                freshnessFactory: { [anchors = f.anchors] in anchors.get($0) })
        }
    }

    @Test("A blocked history read cannot delay another owner's revocation")
    func historyDoesNotBlockDisconnect() async throws {
        let f = try RegistryFixture()
        let (_, response, _) = try f.enroll()
        let (otherOwner, _, _) = try f.enroll()
        let registry = try #require(f.registry)
        let authority = try #require(response["authority"] as? [String: String])
        let scopeID = try #require(authority["scope_id"])
        let database = registry.rootURL.appendingPathComponent("scopes/\(scopeID)/core/coordinator.sqlite3")
        let started = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        f.anchors.get(ClaudeSessionRegistry.account(database, family: "core")).onNextLoad {
            started.signal()
            guard release.wait(timeout: .now() + 10) == .success else { throw CoordinatorError("fixture_timeout") }
        }
        let task = Task.detached { try registry.summaries() }
        let arrived = await registryWait(started, seconds: 5)
        #expect(arrived)
        let disconnected = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { registry.disconnect(connectionID: otherOwner); disconnected.signal() }
        let finishedBeforeRead = await registryWait(disconnected, seconds: 2)
        release.signal()
        _ = try await task.value
        #expect(finishedBeforeRead)
        #expect(registry.activeScopeCount == 1)
    }

    @Test("Moving an active scope is detected even when it disappeared from the disk listing")
    func missingActiveScope() throws {
        let f = try RegistryFixture()
        let (_, response, _) = try f.enroll()
        _ = try f.enroll()
        let registry = try #require(f.registry)
        let authority = try #require(response["authority"] as? [String: String])
        let scope = try #require(authority["scope_id"])
        try FileManager.default.moveItem(at: f.root.appendingPathComponent("scopes/\(scope)"),
                                         to: f.directory.appendingPathComponent("moved-scope"))
        let statuses = try registry.summaries()
        #expect(statuses.first { $0.scopeID.uuidString.lowercased() == scope }?.state == .quarantined)
        #expect(statuses.filter { $0.state == .awaitingNativeStart }.count == 1)
        #expect(registry.activeScopeCount == 1)
    }

    @Test("A stopped service cannot enroll again even before a reservation exists")
    func stoppedServiceCannotEnroll() throws {
        let f = try RegistryFixture()
        let registry = try #require(f.registry)
        let (owner, request) = try f.request()
        registry.disconnectAll()
        #expect(throws: (any Error).self) { try registry.enroll(connectionID: owner, request: request) { _ in
            Issue.record("Stopped service delivered a grant")
        } }
        #expect(registry.activeScopeCount == 0)
        #expect(try registry.summaries().isEmpty)
    }

    @Test("Concurrent history polls share the read path without falsely quarantining a healthy scope")
    func concurrentHistoryPolls() async throws {
        let f = try RegistryFixture()
        let (owner, response, _) = try f.enroll()
        let registry = try #require(f.registry)
        registry.disconnect(connectionID: owner)
        let authority = try #require(response["authority"] as? [String: String])
        let scopeID = try #require(authority["scope_id"])
        let database = registry.rootURL.appendingPathComponent("scopes/\(scopeID)/core/coordinator.sqlite3")
        let started = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        f.anchors.get(ClaudeSessionRegistry.account(database, family: "core")).onNextLoad {
            started.signal()
            guard release.wait(timeout: .now() + 10) == .success else { throw CoordinatorError("fixture_timeout") }
        }
        let first = Task.detached { try registry.summaries() }
        let arrived = await registryWait(started, seconds: 5)
        #expect(arrived)
        let second = Task.detached { try registry.summaries() }
        release.signal()
        let a = try await first.value
        let b = try await second.value
        #expect(a.count == 1 && a.first?.state == .historyOnly)
        #expect(b.count == 1 && b.first?.state == .historyOnly)
    }

    #if BLABEE_JOURNAL_TEST_HARNESS
    @Test("A real private owner controller renews for 24 hours while v2 UDS keeps Hook and core ingress usable")
    func productOwnerAndNativeDay() throws {
        let clock = RegistryClock()
        let f = try RegistryFixture(clock: clock)
        let registry = try #require(f.registry)
        let socketRoot = URL(fileURLWithPath: "/private/tmp/bcl-" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(at: socketRoot, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: socketRoot) }
        let endpoint = try ClaudeSessionEnrollment.makeTesting(socketPath: socketRoot.appendingPathComponent("owner.sock").path,
            runtimeIdentity: f.runtime, serviceIncarnation: registry.serviceIncarnation, secretCorpus: f.corpus,
            enroll: { connection, request, deliver in
                try registry.enroll(connectionID: connection, request: request, deliverGrant: deliver)
            }, control: { connection, request in try registry.control(connectionID: connection, request: request) },
            disconnected: { registry.disconnect(connectionID: $0) })
        try endpoint.start()
        defer { endpoint.stop() }
        let owner = try CP02EnrollmentTestClient(socketPath: socketRoot.appendingPathComponent("owner.sock").path)
        defer { owner.close() }
        let challenge = try owner.readChallenge()
        let pipe = try CP02EnrollmentTestClient.makePipe()
        defer { Darwin.close(pipe.read) }
        try owner.send(CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: f.canonicalProjectPath), passing: [pipe.write])
        Darwin.close(pipe.write)
        let issued = try StrictJSONTransport.object(from: owner.readResponse())
        let grant = try StrictJSONTransport.object(from: CP02EnrollmentTestClient.readGrant(pipe.read))
        let identity = try registryIdentity(issued)
        let enrolled = try #require(issued["result"] as? [String: Any])
        let lease = try #require(enrolled["lease"] as? [String: String])
        let deadline = try #require(lease["deadline_nanoseconds"].flatMap(UInt64.init))
        let controller = try ClaudeOwnerRenewalController(identity: identity,
            initialDeadlineNanoseconds: deadline, clock: clock, secretCorpus: f.corpus,
            exchange: { data in try owner.send(data, passing: []); return try owner.readResponse() },
            disconnected: { _ in owner.close() })
        defer { controller.stop() }

        let server = try UnixDomainSocketServer(socketPath: socketRoot.appendingPathComponent("service.sock").path,
                                               runtimeIdentity: f.runtime)
        try server.activate()
        let application = ClaudeProductServiceCoordinator(codex: RegistryCodexProbe(), registry: registry)
        let stopped = DispatchSemaphore(value: 0)
        let corpus = f.corpus
        DispatchQueue.global().async {
            defer { stopped.signal() }
            do { try server.run(application: application, secretCorpus: corpus) }
            catch { Issue.record("Fixture common UDS failed") }
        }
        defer { server.stop(); _ = stopped.wait(timeout: .now() + 5) }
        let client = try UnixDomainSocketClient(socketPath: socketRoot.appendingPathComponent("service.sock").path,
                                               runtimeIdentity: f.runtime)
        func call(_ operation: String, role: String = "bridge", payload: [String: Any] = [:]) throws -> [String: Any] {
            let response = try client.request(type: "claude_session_v2",
                payload: f.sessionPayload(issued, grant: grant, operation: operation, role: role, payload: payload),
                connectTimeoutMilliseconds: 1000, responseTimeoutMilliseconds: 5000)
            #expect(!f.corpus.containsKnownSecret(inJSONObject: response))
            #expect(response["ok"] as? Bool == true)
            return try #require(response["result"] as? [String: Any])
        }
        let native = identity.nativeSessionID.uuidString.lowercased()
        _ = try call("hook", role: "hook", payload: ["native_session_id": native, "cwd": f.canonicalProjectPath,
            "event": "SessionStart", "source": "startup"])
        let opened = try call("bridge.open")
        let bridgeID = try #require(opened["bridge_id"] as? String)
        for step in 1...288 {
            clock.advance(seconds: 300)
            controller.tick()
            #expect(controller.snapshot().renewalSequence == UInt64(step))
            #expect(controller.snapshot().terminalReason == nil)
            // Poll is not an owner renewal and does not assert model readiness.
            _ = try call("bridge.poll", payload: ["bridge_id": bridgeID])
        }
        let promptID = UUID().uuidString.lowercased()
        let boundary = try call("hook", role: "hook", payload: ["native_session_id": native, "cwd": f.canonicalProjectPath,
            "event": "UserPromptSubmit", "prompt_id": promptID, "prompt_sha256": String(repeating: "c", count: 64)])
        let boundaryID = try #require(boundary["boundary_id"] as? String)
        _ = try call("hook", role: "hook", payload: ["native_session_id": native, "cwd": f.canonicalProjectPath,
            "event": "Stop", "prompt_id": promptID, "background_task_ids": []])
        _ = try call("proposal.emit", payload: ["bridge_id": bridgeID, "boundary_id": boundaryID, "proposal": registryProposal()])
        #expect(try f.coreSequences().values.contains(where: { $0 > 0 }))
        let codex = try client.request(type: "get_state", payload: [:],
            connectTimeoutMilliseconds: 1000, responseTimeoutMilliseconds: 5000)
        #expect(codex["codex"] as? Bool == true)
        controller.end(reason: .childExited)
        #expect(controller.snapshot().terminalReason == .ended)
        #expect(registry.activeScopeCount == 0)
        #expect(throws: (any Error).self) { try f.session(issued, grant: grant, operation: "bridge.poll", payload: ["bridge_id": bridgeID]) }
    }

    @Test("Actual private sockets and SCM_RIGHTS pipes enroll two real registry scopes and isolate EOF", arguments: [false, true])
    func actualPrivateEnrollment(observed: Bool) throws {
        let f = try RegistryFixture()
        let registry = try #require(f.registry)
        let socketRoot = URL(fileURLWithPath: "/private/tmp/bcr-" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(at: socketRoot, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: socketRoot) }
        let socket = socketRoot.appendingPathComponent("owner.sock").path
        let disconnected = DispatchSemaphore(value: 0)
        let endpoint = try ClaudeSessionEnrollment.makeTesting(socketPath: socket, runtimeIdentity: f.runtime,
            serviceIncarnation: registry.serviceIncarnation, secretCorpus: f.corpus,
            enroll: { owner, request, deliver in
                try registry.enroll(connectionID: owner, request: request, deliverGrant: deliver)
            }, disconnected: { owner in registry.disconnect(connectionID: owner); disconnected.signal() })
        try endpoint.start()
        defer { endpoint.stop() }
        let a = try CP02EnrollmentTestClient(socketPath: socket)
        let b = try CP02EnrollmentTestClient(socketPath: socket)
        defer { a.close(); b.close() }
        var scopes: [String] = []
        let nativeSessionID = UUID()
        for client in [a, b] {
            let challenge = try client.readChallenge()
            let pipe = try CP02EnrollmentTestClient.makePipe()
            defer { Darwin.close(pipe.read) }
            let request = try CP02EnrollmentTestClient.enrollRequest(challenge: challenge, cwd: f.canonicalProjectPath,
                nativeSessionID: observed ? nativeSessionID : nil, source: "resume")
            try client.send(request, passing: [pipe.write])
            Darwin.close(pipe.write)
            let response = try client.readResponse()
            #expect(!f.corpus.containsKnownSecret(in: response))
            let publicValue = try StrictJSONTransport.object(from: response)
            #expect(publicValue["ok"] as? Bool == true)
            let grant = try StrictJSONTransport.object(from: CP02EnrollmentTestClient.readGrant(pipe.read))
            let roles = try #require(grant["role_capabilities"] as? [String: String])
            #expect(Set(roles.keys) == ["hook", "bridge", "owner"])
            let granted = try #require(grant["authority"] as? [String: String])
            #expect(granted == publicValue["authority"] as? [String: String])
            if observed { #expect(granted["native_session_id"] == nativeSessionID.uuidString.lowercased()) }
            scopes.append(try #require(granted["scope_id"]))
        }
        #expect(Set(scopes).count == 2)
        #expect(registry.activeScopeCount == 2)
        a.close()
        #expect(disconnected.wait(timeout: .now() + 5) == .success)
        #expect(registry.activeScopeCount == 1)
        #expect(try registry.summaries().filter { $0.state == .historyOnly }.count == 1)
        b.close()
        #expect(disconnected.wait(timeout: .now() + 5) == .success)
        #expect(registry.activeScopeCount == 0)
        #expect(try f.coreSequences().values.allSatisfy { $0 == 0 })
    }
    #endif

    @Test("The common service keeps a real Codex session running beside two Claude scopes and after Claude failure")
    func codexAlongsideClaude() async throws {
        let f = try RegistryFixture()
        let codexStore = try ClaudeBridgeConfiguration.privateChild(of: f.directory, name: "codex")
        let journal = try SQLiteJournal(databaseURL: codexStore.appendingPathComponent("coordinator.sqlite3"),
            keyURL: codexStore.appendingPathComponent("coordinator.key"),
            freshnessStore: f.anchors.get("fixture-codex"), secretCorpus: f.corpus)
        let codex = CoordinatorOperationalApplication(routing: try CoordinatorRoutingApplication(journal: journal),
            enabledProjectPaths: [f.canonicalProjectPath], secretCorpus: f.corpus)
        let app = ClaudeProductServiceCoordinator(codex: codex, registry: f.registry)
        let sessionID = "codex-cp02-regression"
        let started = try await app.handle(type: "session_start", payload: StrictJSONTransport.data(forJSONObject: [
            "session_id": sessionID, "cwd": f.canonicalProjectPath, "hook_event_name": "SessionStart",
        ]))
        #expect(try StrictJSONTransport.object(from: started)["additionalContext"] is String)
        let (owner, _, _) = try f.enroll()
        _ = try f.enroll()
        f.registry?.disconnect(connectionID: owner)
        let (failedOwner, request) = try f.request()
        let registry = try #require(f.registry)
        #expect(throws: (any Error).self) {
            try registry.enroll(connectionID: failedOwner, request: request) { _ in throw CoordinatorError("fixture_pipe_failure") }
        }
        // General UDS cannot manufacture a private enrollment or use native v1.
        do {
            _ = try await app.handle(type: "claude_owner_v1", payload: request.canonicalJSON)
            Issue.record("General UDS enrolled a private owner")
        } catch { #expect(error.coordinatorError.code == "claude_private_endpoint_required") }
        do {
            _ = try await app.handle(type: "claude_session_v1", payload: Data("{}".utf8))
            Issue.record("Product scope exposed a native v1 bypass")
        } catch { #expect(error.coordinatorError.code == "claude_product_unavailable") }
        let prompt = try await app.handle(type: "user_prompt_submit", payload: StrictJSONTransport.data(forJSONObject: [
            "session_id": sessionID, "turn_id": "codex-cp02-turn", "cwd": f.canonicalProjectPath,
            "prompt": "Inspect this fixture only", "hook_event_name": "UserPromptSubmit",
        ]))
        #expect(try StrictJSONTransport.object(from: prompt)["additionalContext"] is String)
        #expect(registry.activeScopeCount == 1)
        #expect(try journal.health().schemaVersion == 1)
        let snapshot = try await app.handle(type: "pet_snapshot", payload: Data("{}".utf8))
        #expect(!f.corpus.containsKnownSecret(in: snapshot))
        _ = try await app.processTime()
        app.stop()
        #expect(registry.activeScopeCount == 0)
        // Claude shutdown leaves ownership of Codex with its original service.
        _ = try await app.handle(type: "pet_snapshot", payload: Data("{}".utf8))
    }
}
