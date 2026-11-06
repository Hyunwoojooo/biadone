import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing

private final class IngressAnchor: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "claude-authenticated-ingress-fixture"
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    func load() -> FreshnessStoredRecord? { lock.withLock { stored } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored == nil else { throw CoordinatorError("freshness_anchor_conflict") }
            let result = try FreshnessStoredRecord(record: record, revision: record.revision)
            stored = result
            return result
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored?.revision == expectedRevision else { throw CoordinatorError("freshness_anchor_conflict") }
            let result = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            stored = result
            return result
        }
    }
}

private final class IngressNow: @unchecked Sendable {
    private let lock = NSLock()
    private var date = Date(timeIntervalSince1970: 1_800_000_000)
    func read() -> Date { lock.withLock { date } }
    func advance(_ seconds: TimeInterval) { lock.withLock { date += seconds } }
}

private func token(_ index: Int) -> String {
    let suffix = String(index, radix: 16)
    return String(repeating: "0", count: 64 - suffix.count) + suffix
}

private final class IngressFixture {
    let directory: URL
    let corpus = RuntimeSecretCorpus()
    let clock = IngressNow()
    let scopes: [ClaudeBridgeScope]
    var journals: [SQLiteJournal] = []
    var adapters: [String: ClaudeCoreAdapter] = [:]
    var ingress: ClaudeBridgeIngress!

    init(count: Int = 2, productAccessCheck: @escaping @Sendable () throws -> UInt64 = { 0 }) throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        directory = root.appendingPathComponent("build/shared-engine/ingress-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let expires = clock.read().addingTimeInterval(60)
        scopes = try (0..<count).map { index in
            try ClaudeBridgeScope(scopeID: UUID().uuidString.lowercased(), projectID: "fixture-project",
                                  sessionID: "same-native-session", bridgeToken: token(index * 2 + 1),
                                  selectionToken: token(index * 2 + 2), expiresAt: expires)
        }
        try ClaudeBridgeIngress.validateScopes(scopes, now: clock.read())
        for (index, scope) in scopes.enumerated() {
            let journal = try SQLiteJournal(databaseURL: directory.appendingPathComponent("scope-\(index).sqlite"),
                                             keyURL: directory.appendingPathComponent("scope-\(index).key"),
                                             freshnessStore: IngressAnchor(), secretCorpus: corpus)
            journals.append(journal)
            adapters[scope.scopeID] = try ClaudeCoreAdapter(journal: journal)
        }
        ingress = try ClaudeBridgeIngress(scopes: scopes, adapters: adapters, secretCorpus: corpus,
                                          now: { [clock] in clock.read() }, productAccessCheck: productAccessCheck)
    }
    deinit {
        ingress = nil
        adapters.removeAll()
        journals.removeAll()
        try? FileManager.default.removeItem(at: directory)
    }
    func envelope(_ operation: String, fields: [String: Any] = [:], scope index: Int = 0,
                  role: String = "bridge") -> [String: Any] {
        let scope = scopes[index]
        var request = fields
        request["schema_version"] = "0.1"
        request["request_id"] = UUID().uuidString.lowercased()
        request["operation"] = operation
        return ["schema_version": ClaudeBridgeIngress.schemaVersion, "provider": "claude",
                "scope_id": scope.scopeID, "session_id": scope.sessionID, "role": role,
                "auth_token": role == "selector" ? scope.selectionToken : scope.bridgeToken,
                "request": request]
    }
    func response(_ envelope: [String: Any]) throws -> [String: Any] {
        try StrictJSONTransport.object(from: ingress.handle(payload: StrictJSONTransport.data(forJSONObject: envelope)))
    }
    func call(_ operation: String, fields: [String: Any] = [:], scope: Int = 0,
              role: String = "bridge") throws -> [String: Any] {
        let response = try response(envelope(operation, fields: fields, scope: scope, role: role))
        guard response["ok"] as? Bool == true, let result = response["result"] as? [String: Any] else {
            throw CoordinatorError((response["error"] as? [String: Any])?["code"] as? String ?? "fixture_response_invalid")
        }
        return result
    }
}

private func ingressBinding() -> [String: Any] {
    ["project_id": "fixture-project", "session_id": "same-native-session",
     "source_turn_id": "internal-core-turn", "source_prompt_id": "observed-native-prompt",
     "episode_id": "fixture-episode", "episode_root_prompt_id": "observed-native-prompt",
     "episode_baseline_checkpoint_id": "fixture-checkpoint", "decision_boundary_id": "fixture-boundary",
     "boundary_sequence": 1]
}

private func ingressProposal() -> [String: Any] {
    ["proposal_id": "fixture-proposal", "task_goal": "Qualify authenticated Claude ingress.",
     "outcome": ["status": "completed", "summary": "Fixture choices prepared."], "reported_side_effects": [],
     "options": [
        ["id": "a", "title": "Read A", "description": "Read the original A fixture.", "task": "Read fixture-a.txt",
         "done_when": "Report A content.", "constraints": ["Do not modify any files."]],
        ["id": "b", "title": "Read B", "description": "Read the original B fixture.", "task": "Read fixture-b.txt",
         "done_when": "Report B content.", "constraints": []],
     ]]
}

private func reject(_ code: String, _ body: () throws -> Void) {
    do { try body(); Issue.record("Expected rejection: \(code)") }
    catch let error as CoordinatorError { #expect(error.code == code) }
    catch { Issue.record("Unexpected error type") }
}

private func selected(_ fixture: IngressFixture, scope: Int = 0) throws -> [String: Any] {
    let activated = try fixture.call("activate", fields: ["binding": ingressBinding(), "proposal": ingressProposal()], scope: scope)
    let packet = try #require(activated["packet"] as? [String: Any])
    let options = try #require(activated["option_bindings"] as? [[String: Any]])
    return try fixture.call("select", fields: ["binding": ingressBinding(), "packet_id": packet["packet_id"]!,
        "revision": packet["revision"]!, "option_id": options[0]["option_id"]!, "selection_id": "fixture-selection"],
        scope: scope, role: "selector")
}

@Suite("Authenticated Claude ingress")
struct ClaudeIngressTests {
    @Test("Legacy configured scopes also bind action claims to the original account authority")
    func productAccessGeneration() throws {
        let clock = IngressNow()
        let fixture = try IngressFixture(productAccessCheck: { UInt64(clock.read().timeIntervalSince1970) })
        _ = try selected(fixture)
        clock.advance(1)
        reject("product_access_changed") {
            _ = try fixture.call("claim", fields: ["binding": ingressBinding(), "selection_id": "fixture-selection"])
        }
    }

    @Test("Configured credentials and scope identities validate before storage is created")
    func configuration() throws {
        let now = Date()
        func scope(id: String = UUID().uuidString.lowercased(), bridge: String = token(1), selector: String = token(2),
                   project: String = "project", expires: Date? = nil) throws -> ClaudeBridgeScope {
            try ClaudeBridgeScope(scopeID: id, projectID: project, sessionID: "session", bridgeToken: bridge,
                                  selectionToken: selector, expiresAt: expires ?? now.addingTimeInterval(60))
        }
        let first = try scope()
        try ClaudeBridgeIngress.validateScopes([first], now: now)
        reject("claude_bridge_configuration_invalid") {
            try ClaudeBridgeIngress.validateScopes([first, scope(bridge: token(3), selector: token(1))], now: now)
        }
        reject("claude_bridge_configuration_invalid") {
            try ClaudeBridgeIngress.validateScopes([first, scope(id: first.scopeID.uppercased(), bridge: token(3), selector: token(4))], now: now)
        }
        reject("claude_bridge_configuration_invalid") { _ = try scope(bridge: "A" + String(repeating: "0", count: 63)) }
        reject("claude_bridge_configuration_invalid") { _ = try scope(id: "abcdef12-1234-4123-8123-abcdef123456".uppercased()) }
        reject("claude_bridge_configuration_invalid") { _ = try scope(id: "invalid") }
        reject("claude_bridge_configuration_invalid") {
            try ClaudeBridgeIngress.validateScopes([scope(expires: now)], now: now)
        }
        reject("claude_bridge_configuration_invalid") {
            try ClaudeBridgeIngress.validateScopes([scope(project: "prefix-" + token(1))], now: now)
        }
        let tooMany = try (0..<17).map { try scope(bridge: token($0 * 2 + 1), selector: token($0 * 2 + 2)) }
        reject("claude_bridge_configuration_invalid") { try ClaudeBridgeIngress.validateScopes(tooMany, now: now) }
    }

    @Test("Bad provider, session, scope, token and expiry share one generic authentication error")
    func authentication() throws {
        let f = try IngressFixture()
        for (key, value) in ["provider": "codex", "scope_id": UUID().uuidString.lowercased(),
                             "session_id": "other-session", "auth_token": String(repeating: "f", count: 64)] {
            var request = f.envelope("snapshot")
            request[key] = value
            reject("claude_bridge_unauthorized") { _ = try f.response(request) }
        }
        var otherToken = f.envelope("snapshot", scope: 1)
        otherToken["auth_token"] = f.scopes[0].bridgeToken
        reject("claude_bridge_unauthorized") { _ = try f.response(otherToken) }
        f.clock.advance(60)
        reject("claude_bridge_unauthorized") { _ = try f.call("snapshot") }
        #expect(try f.journals.allSatisfy { try $0.load().journalSequence == 0 })
    }

    @Test("Role separation and binding checks happen before any mutation")
    func rolesAndBindings() throws {
        let f = try IngressFixture()
        reject("claude_bridge_forbidden") { _ = try f.call("select", fields: ["binding": ingressBinding()]) }
        reject("claude_bridge_forbidden") { _ = try f.call("claim", fields: ["binding": ingressBinding()], role: "selector") }
        var forgedRole = f.envelope("snapshot")
        forgedRole["role"] = "selector"
        reject("claude_bridge_forbidden") { _ = try f.response(forgedRole) }
        for key in ["project_id", "session_id"] {
            var wrong = ingressBinding()
            wrong[key] = "other"
            reject("claude_bridge_unauthorized") {
                _ = try f.call("activate", fields: ["binding": wrong, "proposal": ingressProposal()])
            }
        }
        #expect(try f.journals[0].load().journalSequence == 0)
        reject("claude_bridge_configuration_invalid") {
            _ = try ClaudeBridgeIngress(scopes: f.scopes,
                adapters: [f.scopes[0].scopeID: f.adapters[f.scopes[0].scopeID]!,
                           f.scopes[1].scopeID: f.adapters[f.scopes[0].scopeID]!], secretCorpus: RuntimeSecretCorpus(),
                now: { [clock = f.clock] in clock.read() })
        }
    }

    @Test("Known credentials in string arrays, task fields and notes are rejected before commit")
    func secretPreflight() throws {
        let f = try IngressFixture()
        for location in ["summary", "task", "constraints", "reserved_key"] {
            var proposal = ingressProposal()
            var options = try #require(proposal["options"] as? [[String: Any]])
            let secret = f.scopes[1].selectionToken
            switch location {
            case "summary": proposal["outcome"] = ["status": "completed", "summary": secret]
            case "task": options[0]["task"] = "Do not reflect " + secret
            case "constraints": options[0]["constraints"] = ["No files", secret]
            default: options[0]["correlation_token"] = "arbitrary-caller-guess"
            }
            proposal["options"] = options
            reject("claude_bridge_secret_reflection") {
                _ = try f.call("activate", fields: ["binding": ingressBinding(), "proposal": proposal])
            }
            #expect(try f.journals[0].load().journalSequence == 0)
        }
        _ = try selected(f)
        _ = try f.call("claim", fields: ["binding": ingressBinding(), "selection_id": "fixture-selection"])
        let before = try f.journals[0].load()
        reject("claude_bridge_secret_reflection") {
            _ = try f.call("complete", fields: ["binding": ingressBinding(), "selection_id": "fixture-selection",
                "outcome": "completed", "note": f.scopes[0].bridgeToken])
        }
        #expect(try f.journals[0].load() == before)
    }

    @Test("Unauthenticated token guesses never poison the global secret corpus")
    func noSecretPoisoning() throws {
        let f = try IngressFixture()
        let guess = String(repeating: "f", count: 64)
        var invalid = f.envelope("snapshot")
        invalid["auth_token"] = guess
        reject("claude_bridge_unauthorized") { _ = try f.response(invalid) }
        #expect(!f.corpus.containsKnownSecret(in: Data(guess.utf8)))
        var proposal = ingressProposal()
        var options = try #require(proposal["options"] as? [[String: Any]])
        options[0]["task"] = "Inspect the non-secret fixture value " + guess
        proposal["options"] = options
        let response = try f.call("activate", fields: ["binding": ingressBinding(), "proposal": proposal])
        #expect(try StrictJSONTransport.data(forJSONObject: response["claude_proposal"]!) == StrictJSONTransport.data(forJSONObject: proposal))
    }

    @Test("Actual SQLite roundtrip exposes provider DTOs without raw routing or durable credentials")
    func authenticatedRoundtrip() throws {
        let f = try IngressFixture()
        let selected = try selected(f)
        #expect(selected["delivery"] as? String == "awaiting_claude_claim")
        let claimed = try f.call("claim", fields: ["binding": ingressBinding(), "selection_id": "fixture-selection"])
        #expect(claimed["delivery"] as? String == "claimed")
        #expect((claimed["action"] as? [String: Any])?["task"] as? String == "Read fixture-a.txt")
        #expect(claimed["option"] == nil)
        let complete = try f.call("complete", fields: ["binding": ingressBinding(), "selection_id": "fixture-selection",
            "outcome": "completed", "note": "The model reports that A was read."])
        #expect(complete["reported_by"] as? String == "model")
        let snapshot = try f.call("snapshot", role: "selector")
        #expect(Set(snapshot.keys) == ["cards", "outcomes", "history"])
        let output = try StrictJSONTransport.data(forJSONObject: snapshot)
        #expect(!f.corpus.containsKnownSecret(in: output))
        #expect(!String(decoding: output, as: UTF8.self).contains("queued_next_turn"))
        #expect(!String(decoding: output, as: UTF8.self).contains("correlation_token"))
        let durable = try f.journals[0].load()
        for row in durable.events + durable.documents + durable.verificationRecords {
            #expect(!f.corpus.containsKnownSecret(in: row))
        }
    }

    @Test("Identical native identities stay isolated behind distinct authenticated scope stores")
    func sameNativeIDsDifferentScopes() throws {
        let f = try IngressFixture()
        _ = try selected(f)
        _ = try f.call("activate", fields: ["binding": ingressBinding(), "proposal": ingressProposal()], scope: 1)
        let untouched = try f.journals[1].load()
        let wrong = try f.response(f.envelope("claim", fields: ["binding": ingressBinding(), "selection_id": "fixture-selection"], scope: 1))
        #expect(wrong["ok"] as? Bool == false)
        #expect((wrong["error"] as? [String: Any])?["code"] as? String == "invalid_claim")
        #expect(try f.journals[1].load() == untouched)
        _ = try f.call("claim", fields: ["binding": ingressBinding(), "selection_id": "fixture-selection"])
        #expect(try f.journals[1].load() == untouched)
    }
}
