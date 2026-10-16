import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation
import Testing

func claudeFixtureCanonicalPath(_ url: URL) throws -> String {
    guard let resolved = realpath(url.path, nil) else { throw CoordinatorError("fixture_directory_missing") }
    defer { free(resolved) }
    guard let path = String(validatingCString: resolved) else { throw CoordinatorError("fixture_directory_invalid") }
    return path
}

func claudeFixtureCanonicalDirectory(_ url: URL) throws -> URL {
    URL(fileURLWithPath: try claudeFixtureCanonicalPath(url))
}

private final class NativeAnchor: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "claude-native-session-fixture"
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    func load() -> FreshnessStoredRecord? { lock.withLock { stored } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored == nil else { throw CoordinatorError("freshness_anchor_conflict") }
            let value = try FreshnessStoredRecord(record: record, revision: record.revision)
            stored = value
            return value
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard stored?.revision == expectedRevision else { throw CoordinatorError("freshness_anchor_conflict") }
            let value = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            stored = value
            return value
        }
    }
}

private final class NativeClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var seconds: UInt64 = 0
    func nowNanoseconds() -> UInt64 { lock.withLock { seconds * 1_000_000_000 } }
    func date() -> Date { lock.withLock { Date(timeIntervalSince1970: 1_800_000_000 + Double(seconds)) } }
    func advance(_ count: UInt64) { lock.withLock { seconds += count } }
}

private final class NativeFaultPort: CoordinatorSemanticJournalPort, @unchecked Sendable {
    let journal: SQLiteJournal
    private let lock = NSLock()
    private var fault: (String, Bool)?
    init(_ journal: SQLiteJournal) { self.journal = journal }
    func failNext(_ type: String, afterCommit: Bool) { lock.withLock { fault = (type, afterCommit) } }
    func load() throws -> JournalSnapshot { try journal.load() }
    func append(expectedSequence: Int64, events: [Data], documents: [Data], verificationRecords: [Data]) throws -> JournalAppendResult {
        let kinds = try events.map { try StrictJSONTransport.object(from: $0)["event_type"] as? String }
        let matched = lock.withLock { () -> (String, Bool)? in
            guard let current = fault, kinds.contains(current.0) else { return nil }
            fault = nil
            return current
        }
        if let matched, !matched.1 { throw CoordinatorError("fixture_append_failed") }
        let result = try journal.append(expectedSequence: expectedSequence, events: events, documents: documents,
                                        verificationRecords: verificationRecords)
        if matched != nil { throw CoordinatorError("fixture_response_lost") }
        return result
    }
}

private func nativeID() -> String { UUID().uuidString.lowercased() }
private func nativeToken(_ index: Int) -> String {
    let suffix = String(index, radix: 16)
    return String(repeating: "0", count: 64 - suffix.count) + suffix
}
private func digest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
}
private func nativeProposal(_ suffix: String = "a") -> [String: Any] {
    ["proposal_id": "native-fixture-" + suffix, "task_goal": "Exercise native Claude observations.",
     "outcome": ["status": "completed", "summary": "Choices prepared for " + suffix], "reported_side_effects": [],
     "options": [
        ["id": "read-" + suffix, "title": "Read fixture", "description": "Read the selected fixture only.",
         "task": "Read fixture-" + suffix + ".txt", "done_when": "Report the file content.", "constraints": ["Do not modify files."]],
        ["id": "list-" + suffix, "title": "List fixtures", "description": "List the fixture directory.",
         "task": "List the current directory", "done_when": "Report the listing.", "constraints": []],
     ]]
}
private func nativeReject(_ code: String, _ body: () throws -> Void) {
    do { try body(); Issue.record("Expected rejection: \(code)") }
    catch let error as CoordinatorError { #expect(error.code == code) }
    catch { Issue.record("Unexpected error type") }
}

private final class NativeFixture {
    let directory: URL
    let clock = NativeClock()
    let corpus = RuntimeSecretCorpus()
    let grant: ClaudeNativeGrant
    var journal: SQLiteJournal!
    var port: NativeFaultPort!
    var adapter: ClaudeCoreAdapter!
    var controller: ClaudeNativeSession!
    var bridgeID: String?
    var boundaryID: String?
    var promptID: String?

    init(sessionID: String = nativeID(), tokenBase: Int = 0, lifetime: TimeInterval = 3600) throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        let path = root.appendingPathComponent("build/shared-engine/native-" + nativeID())
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        directory = try claudeFixtureCanonicalDirectory(path)
        let scope = try ClaudeBridgeScope(scopeID: nativeID(), projectID: "native-fixture-project", sessionID: sessionID,
            bridgeToken: nativeToken(tokenBase + 1), selectionToken: nativeToken(tokenBase + 2),
            expiresAt: clock.date().addingTimeInterval(lifetime))
        grant = try ClaudeNativeGrant(scope: scope, cwd: directory.path, hookToken: nativeToken(tokenBase + 3),
                                      controlToken: nativeToken(tokenBase + 4))
        journal = try SQLiteJournal(databaseURL: directory.appendingPathComponent("journal.sqlite"),
            keyURL: directory.appendingPathComponent("fixture.key"), freshnessStore: NativeAnchor(), secretCorpus: corpus)
        port = NativeFaultPort(journal)
        adapter = try ClaudeCoreAdapter(journal: port, clock: clock, wallNow: { [clock] in clock.date() })
        controller = try ClaudeNativeSession(grant: grant, adapter: adapter, secretCorpus: corpus, now: { [clock] in clock.date() })
    }
    deinit {
        controller = nil
        adapter = nil
        port = nil
        journal = nil
        try? FileManager.default.removeItem(at: directory)
    }
    func envelope(_ operation: String, fields: [String: Any] = [:], role: String = "bridge") -> [String: Any] {
        let tokens = ["bridge": grant.scope.bridgeToken, "selector": grant.scope.selectionToken,
                      "hook": grant.hookToken, "control": grant.controlToken]
        var request = fields
        request["schema_version"] = "1.0"
        request["request_id"] = nativeID()
        request["operation"] = operation
        return ["schema_version": ClaudeNativeSession.schemaVersion, "provider": "claude", "scope_id": grant.scope.scopeID,
                "session_id": grant.scope.sessionID, "role": role, "auth_token": tokens[role]!, "request": request]
    }
    func response(_ envelope: [String: Any]) throws -> [String: Any] {
        try StrictJSONTransport.object(from: controller.handle(payload: StrictJSONTransport.data(forJSONObject: envelope)))
    }
    func call(_ operation: String, fields: [String: Any] = [:], role: String = "bridge") throws -> [String: Any] {
        let reply = try response(envelope(operation, fields: fields, role: role))
        guard reply["ok"] as? Bool == true, let result = reply["result"] as? [String: Any] else {
            throw CoordinatorError((reply["error"] as? [String: Any])?["code"] as? String ?? "fixture_response_invalid")
        }
        return result
    }
    @discardableResult func hook(_ event: String, extra: [String: Any] = [:]) throws -> [String: Any] {
        var fields: [String: Any] = ["event": event, "session_id_native": grant.scope.sessionID, "cwd": grant.cwd]
        fields.merge(extra) { _, value in value }
        let result = try call("hook", fields: fields, role: "hook")
        if let id = result["boundary_id"] as? String { boundaryID = id }
        if let id = result["prompt_id"] as? String { promptID = id }
        return result
    }
    @discardableResult func prompt(_ text: String = "Prepare fixture choices.", id: String = nativeID()) throws -> [String: Any] {
        try hook("UserPromptSubmit", extra: ["prompt_id": id, "prompt_sha256": digest(text)])
    }
    func open() throws {
        bridgeID = try #require(try call("bridge.open")["bridge_id"] as? String)
    }
    func poll() throws -> [String: Any]? {
        try call("bridge.poll", fields: ["bridge_id": bridgeID!])["event"] as? [String: Any]
    }
    func begin() throws -> [String: Any] { try call("readiness.begin", fields: ["bridge_id": bridgeID!]) }
    func ack(_ event: [String: Any]) throws {
        _ = try call("readiness.ack", fields: ["bridge_id": bridgeID!, "probe_id": event["probe_id"]!, "nonce": event["nonce"]!])
    }
    @discardableResult func ready() throws -> [String: Any] {
        _ = try begin()
        let event = try #require(try poll())
        try ack(event)
        return event
    }
    func stop() throws { try hook("Stop", extra: ["prompt_id": promptID!]) }
    @discardableResult func emit(_ suffix: String = "a", proposal: [String: Any]? = nil) throws -> [String: Any] {
        try call("proposal.emit", fields: ["bridge_id": bridgeID!, "boundary_id": boundaryID!,
                                          "proposal": proposal ?? nativeProposal(suffix)])
    }
    func snapshot() throws -> [String: Any] { try call("snapshot", role: "selector") }
    func card() throws -> [String: Any] { try #require((try snapshot()["cards"] as? [[String: Any]])?.first) }
    func selectionFields(id: String = nativeID()) throws -> [String: Any] {
        let card = try card(), packet = try #require(card["packet"] as? [String: Any])
        let options = try #require(card["option_bindings"] as? [[String: Any]])
        return ["boundary_id": boundaryID!, "packet_id": packet["packet_id"]!, "revision": packet["revision"]!,
                "option_id": options[0]["option_id"]!, "selection_id": id]
    }
    func dismissalFields() throws -> [String: Any] {
        let value = try card(), packet = try #require(value["packet"] as? [String: Any])
        return ["boundary_id": boundaryID!, "interaction_id": packet["interaction_id"]!,
                "packet_id": packet["packet_id"]!, "revision": packet["revision"]!]
    }
    @discardableResult func select() throws -> [String: Any] {
        let result = try call("select", fields: selectionFields(), role: "selector")
        #expect(result["delivery"] as? String == "awaiting_claude_claim")
        return result
    }
    @discardableResult func claim(_ event: [String: Any]) throws -> [String: Any] {
        let result = try call("selection.claim", fields: ["bridge_id": bridgeID!, "selection_id": event["selection_id"]!,
                                                         "delivery_token": event["delivery_token"]!])
        boundaryID = try #require(result["boundary_id"] as? String)
        promptID = try #require(result["prompt_id"] as? String)
        return result
    }
    func complete(_ selectionID: String, outcome: String = "completed", note: String = "The model reports fixture completion.") throws {
        let result = try call("selection.complete", fields: ["bridge_id": bridgeID!, "selection_id": selectionID,
            "outcome": outcome, "note": note])
        #expect(result["recorded"] as? Bool == true)
        #expect(result["reported_by"] as? String == "model")
    }
    func prepare() throws {
        try hook("SessionStart", extra: ["source": "startup"])
        try prompt()
        try open()
        try ready()
        try emit()
        try stop()
    }
}

@Suite("Native Claude session")
struct ClaudeNativeSessionTests {
    @Test("Native selector dismissal emits no Channel task and an old request cannot dismiss the next card")
    func dismissalNoChannelOrExecution() throws {
        let f = try NativeFixture()
        try f.prepare()
        let request = try f.dismissalFields()
        let result = try f.call("dismiss_interaction", fields: request, role: "selector")
        #expect(result["dismissed"] as? Bool == true)
        #expect(result["interaction_id"] as? String == request["interaction_id"] as? String)
        #expect((try f.snapshot()["cards"] as? [Any])?.isEmpty == true)
        #expect(try f.poll() == nil)
        let state = try CoordinatorSemanticReplay.replay(f.journal.load())
        #expect(state.continuations.isEmpty)
        #expect(state.boundaries.values.allSatisfy { $0.selection == nil && $0.closeReason == "user_dismissed" })

        try f.prompt("Prepare a different proposal."); try f.emit("next"); try f.stop()
        nativeReject("claude_session_boundary_mismatch") {
            _ = try f.call("dismiss_interaction", fields: request, role: "selector")
        }
        #expect((try f.snapshot()["cards"] as? [Any])?.count == 1)
        #expect(try f.poll() == nil)
    }

    @Test("Native dismissal requires selector authority and current readiness", arguments: ["role", "session", "readiness"])
    func dismissalAuthorityAndReadiness(_ kind: String) throws {
        let f = try NativeFixture()
        try f.prepare()
        let fields = try f.dismissalFields()
        if kind == "readiness" {
            f.clock.advance(5)
            nativeReject("claude_session_readiness_required") {
                _ = try f.call("dismiss_interaction", fields: fields, role: "selector")
            }
        } else {
            var envelope = f.envelope("dismiss_interaction", fields: fields, role: kind == "role" ? "bridge" : "selector")
            if kind == "session" { envelope["session_id"] = nativeID() }
            nativeReject(kind == "role" ? "claude_session_forbidden" : "claude_session_unauthorized") {
                _ = try f.controller.handle(payload: StrictJSONTransport.data(forJSONObject: envelope))
            }
        }
        let state = try CoordinatorSemanticReplay.replay(f.journal.load())
        #expect(state.continuations.isEmpty)
        #expect(state.boundaries.values.allSatisfy { $0.selection == nil && $0.closeReason != "user_dismissed" })
    }

    @Test("Canonical grants accept physical paths and reject aliases or non-directories")
    func canonicalGrantDirectory() throws {
        let f = try NativeFixture()
        #expect(f.grant.cwd == (try claudeFixtureCanonicalDirectory(f.directory)).path)
        for name in ["project 한글", "accent e\u{301}"] {
            let project = f.directory.appendingPathComponent(name)
            try FileManager.default.createDirectory(at: project, withIntermediateDirectories: false)
            let cwd = try claudeFixtureCanonicalPath(project)
            let grant = try ClaudeNativeGrant(scope: f.grant.scope, cwd: cwd,
                                              hookToken: f.grant.hookToken, controlToken: f.grant.controlToken)
            #expect(grant.cwd.utf8.elementsEqual(cwd.utf8))
        }
        let alias = f.directory.appendingPathComponent("project-alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: f.directory)
        let file = f.directory.appendingPathComponent("plain-file")
        try Data().write(to: file)
        var invalid = [alias.path, file.path, f.grant.cwd + "/missing", f.grant.cwd + "/.",
                       f.grant.cwd + "/", f.grant.cwd + "//child", "relative", f.grant.cwd + "\0tail"]
        if f.grant.cwd.hasPrefix("/private/tmp/") {
            invalid.append(String(f.grant.cwd.dropFirst("/private".count)))
        }
        for cwd in invalid {
            nativeReject("claude_session_configuration_invalid") {
                _ = try ClaudeNativeGrant(scope: f.grant.scope, cwd: cwd,
                                          hookToken: f.grant.hookToken, controlToken: f.grant.controlToken)
            }
        }
    }

    @Test("Fresh grants, role credentials and observed Hook identities are exact")
    func authenticationAndGrant() throws {
        let f = try NativeFixture()
        nativeReject("claude_session_configuration_invalid") {
            _ = try ClaudeNativeGrant(scope: f.grant.scope, cwd: f.grant.cwd + "/../" + f.directory.lastPathComponent,
                                      hookToken: f.grant.hookToken, controlToken: f.grant.controlToken)
        }
        nativeReject("claude_session_configuration_invalid") {
            _ = try ClaudeNativeGrant(scope: f.grant.scope, cwd: f.grant.cwd,
                                      hookToken: f.grant.scope.bridgeToken, controlToken: f.grant.controlToken)
        }
        for (key, value) in ["provider": "codex", "scope_id": nativeID(), "session_id": nativeID(), "auth_token": nativeToken(99)] {
            var envelope = f.envelope("snapshot", role: "selector")
            envelope[key] = value
            nativeReject("claude_session_unauthorized") { _ = try f.response(envelope) }
        }
        #expect(!f.corpus.containsKnownSecret(in: Data(nativeToken(99).utf8)))
        nativeReject("claude_session_forbidden") { _ = try f.call("select") }
        nativeReject("claude_session_forbidden") { _ = try f.call("proposal.emit", role: "selector") }
        nativeReject("claude_session_forbidden") { _ = try f.call("snapshot", role: "bridge") }
        var forged = f.envelope("snapshot", role: "selector")
        forged["role"] = "control"
        nativeReject("claude_session_forbidden") { _ = try f.response(forged) }
        for extra in [["cwd": "/"], ["session_id_native": nativeID()]] {
            nativeReject("claude_session_hook_mismatch") { try f.hook("SessionStart", extra: extra) }
        }
        for source in ["resume", "fork", "unknown"] {
            nativeReject("claude_session_unsupported_resume") { try f.hook("SessionStart", extra: ["source": source]) }
        }
        nativeReject("claude_session_invalid_request") {
            try f.hook("SessionStart", extra: ["prompt_id": nativeID()])
        }
        #expect(try f.journal.load().journalSequence == 0)
    }

    @Test("Readiness is independent of delivery, expires, and still requires matching Stop")
    func readiness() throws {
        let f = try NativeFixture()
        try f.prompt()
        try f.open()
        try f.emit()
        let fields = try f.selectionFields()
        nativeReject("claude_session_readiness_required") { _ = try f.call("select", fields: fields, role: "selector") }
        let begin = try f.begin()
        nativeReject("claude_session_readiness_invalid") {
            _ = try f.call("readiness.ack", fields: ["bridge_id": f.bridgeID!, "probe_id": begin["probe_id"]!, "nonce": nativeToken(99)])
        }
        let event = try #require(try f.poll())
        #expect(try f.snapshot()["ready"] as? Bool == false)
        try f.ack(event)
        #expect(try f.snapshot()["ready"] as? Bool == true)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == false)
        nativeReject("claude_session_stop_required") { _ = try f.call("select", fields: fields, role: "selector") }
        try f.stop()
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        #expect((try f.snapshot()["outcomes"] as? [[String: Any]])?.isEmpty == true)
        _ = try f.begin()
        nativeReject("claude_session_readiness_invalid") { try f.ack(event) }
        try f.ack(try #require(try f.poll()))
        // Keep the Channel live while proving ACK itself expires independently.
        for _ in 0..<75 { f.clock.advance(4); _ = try f.poll() }
        #expect(try f.snapshot()["bridge_connected"] as? Bool == true)
        #expect(try f.snapshot()["ready"] as? Bool == false)
        try f.ready()
        f.clock.advance(5)
        #expect(try f.snapshot()["bridge_connected"] as? Bool == false)
        _ = try f.poll()
        #expect(try f.snapshot()["bridge_connected"] as? Bool == true)
        #expect(try f.snapshot()["ready"] as? Bool == false)
    }

    @Test("Actual native prompt bindings survive a no-Hook claim and late original result", arguments: ["completed", "failed"])
    func lateOriginalResult(outcome: String) throws {
        let f = try NativeFixture()
        try f.prepare()
        let originalPrompt = f.promptID!, originalBoundary = f.boundaryID!
        let originalCard = try f.card()
        let originalBinding = try #require(originalCard["binding"] as? [String: Any])
        #expect(originalBinding["source_prompt_id"] as? String == originalPrompt)
        #expect((originalBinding["source_turn_id"] as? String)?.hasPrefix("claude_internal_turn_") == true)
        #expect(originalBinding["source_turn_id"] as? String != originalPrompt)
        _ = try f.select()
        let delivered = try #require(try f.poll())
        let beforeClaim = try f.journal.load()
        nativeReject("claude_session_invalid_claim") {
            _ = try f.call("selection.claim", fields: ["bridge_id": f.bridgeID!, "selection_id": delivered["selection_id"]!,
                                                       "delivery_token": nativeToken(99)])
        }
        nativeReject("claude_session_invalid_claim") {
            _ = try f.call("selection.claim", fields: ["bridge_id": f.bridgeID!, "selection_id": nativeID(),
                                                       "delivery_token": delivered["delivery_token"]!])
        }
        #expect(try f.journal.load() == beforeClaim)
        let claimed = try f.claim(delivered)
        #expect(Set(claimed.keys) == ["selection_id", "boundary_id", "prompt_id", "action"])
        #expect(claimed["prompt_id"] as? String == originalPrompt)
        #expect(claimed["boundary_id"] as? String != originalBoundary)
        #expect((claimed["action"] as? [String: Any])?["task"] as? String == "Read fixture-a.txt")
        nativeReject("claude_session_invalid_claim") { _ = try f.claim(delivered) }
        let nextNativePrompt = nativeID()
        try f.prompt("Prepare new C/D choices.", id: nextNativePrompt)
        try f.emit("cd")
        try f.stop()
        let before = try f.card()
        #expect((before["binding"] as? [String: Any])?["source_prompt_id"] as? String == nextNativePrompt)
        let beforeBoundary = f.boundaryID
        nativeReject("claude_session_invalid_completion") { try f.complete(nativeID(), outcome: outcome) }
        try f.complete(delivered["selection_id"] as! String, outcome: outcome)
        let after = try f.card()
        #expect(try StrictJSONTransport.data(forJSONObject: before) == StrictJSONTransport.data(forJSONObject: after))
        #expect(f.boundaryID == beforeBoundary)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        let reported = try #require((try f.snapshot()["outcomes"] as? [[String: Any]])?.first)
        #expect(reported["status"] as? String == (outcome == "completed" ? "succeeded" : "failed"))
        #expect(reported["reported_by"] as? String == "model")
        #expect(reported["summary"] as? String == "The model reports fixture completion.")
        let durableState = try CoordinatorSemanticReplay.replay(f.journal.load())
        let durableOutcome = try #require(durableState.continuation(id: reported["continuation_id"] as! String)?.workOutcome)
        #expect(durableOutcome.summary.hasPrefix(ClaudeCoreAdapter.modelReportPrefix))
        #expect((reported["binding"] as? [String: Any])?["decision_boundary_id"] as? String == originalBoundary)
        nativeReject("claude_session_invalid_completion") { try f.complete(delivered["selection_id"] as! String) }
    }

    @Test("Only exact Channel content or its canonical wrapper associates a native prompt", arguments: [false, true])
    func exactChannelPrompt(wrapper: Bool) throws {
        let f = try NativeFixture()
        try f.prompt()
        let originalBoundary = f.boundaryID!
        let originalPrompt = f.promptID!
        try f.open()
        try f.emit()
        _ = try f.begin()
        let probe = try #require(try f.poll())
        let content = probe["content"] as! String
        let probeText = wrapper
            ? "<channel source=\"blabee-claude\" kind=\"readiness_probe\" probe_id=\"\(probe["probe_id"]!)\">\n\(content)\n</channel>"
            : content
        let probePrompt = nativeID()
        try f.prompt(probeText, id: probePrompt)
        #expect(f.boundaryID == originalBoundary)
        try f.prompt(probeText, id: probePrompt)
        try f.ack(probe)
        try f.stop()
        _ = try f.select()
        let selection = try #require(try f.poll())
        let selectionContent = selection["content"] as! String
        let selectionText = wrapper
            ? "<channel source=\"blabee-claude\" selection_id=\"\(selection["selection_id"]!)\">\n\(selectionContent)\n</channel>"
            : selectionContent
        let selectionPrompt = nativeID()
        try f.prompt(selectionText, id: selectionPrompt)
        try f.prompt(selectionText, id: selectionPrompt)
        #expect(f.boundaryID == originalBoundary)
        let claim = try f.claim(selection)
        #expect(claim["prompt_id"] as? String == selectionPrompt)
        try f.emit("next")
        let next = try f.card()
        #expect((next["binding"] as? [String: Any])?["source_prompt_id"] as? String == selectionPrompt)
        #expect((next["binding"] as? [String: Any])?["episode_root_prompt_id"] as? String == originalPrompt)
        try f.complete(selection["selection_id"] as! String)
        nativeReject("claude_session_prompt_replay") { try f.prompt(selectionText, id: selectionPrompt) }
    }

    @Test("Unknown input, a second native ID for one reference, and stale Stop revoke unclaimed work")
    func unknownInputAndStop() throws {
        for secondReferenceID in [false, true] {
            let f = try NativeFixture()
            try f.prepare()
            _ = try f.select()
            let event = try #require(try f.poll())
            let content = event["content"] as! String
            let before = f.boundaryID
            if secondReferenceID { try f.prompt(content) }
            try f.prompt(secondReferenceID ? content : content + "\nUnexpected extra instruction")
            #expect(f.boundaryID != before)
            nativeReject("claude_session_invalid_claim") { _ = try f.claim(event) }
            #expect((try f.snapshot()["cards"] as? [[String: Any]])?.isEmpty == true)
        }
        let f = try NativeFixture()
        try f.prepare()
        let fields = try f.selectionFields()
        nativeReject("claude_session_hook_mismatch") { try f.hook("Stop", extra: ["prompt_id": nativeID()]) }
        #expect(try f.snapshot()["selection_enabled"] as? Bool == false)
        nativeReject("claude_session_readiness_required") { _ = try f.call("select", fields: fields, role: "selector") }
    }

    @Test("Bridge replacement and offline expiry never restore delivery or readiness")
    func bridgeEpochs() throws {
        let f = try NativeFixture()
        try f.prepare()
        _ = try f.select()
        let oldDelivery = try #require(try f.poll())
        let oldBridge = f.bridgeID!
        try f.open()
        #expect(try f.snapshot()["ready"] as? Bool == false)
        #expect(try f.poll() == nil)
        nativeReject("claude_session_invalid_claim") { _ = try f.claim(oldDelivery) }
        nativeReject("claude_session_bridge_mismatch") { _ = try f.call("bridge.poll", fields: ["bridge_id": oldBridge]) }
        try f.prompt("Prepare another task.")
        try f.ready()
        try f.emit("b")
        try f.stop()
        _ = try f.select()
        let claimedDelivery = try #require(try f.poll())
        _ = try f.claim(claimedDelivery)
        try f.open()
        // A new bridge can report the original already-claimed task without
        // fabricating a fresh selection or requiring a new execution ACK.
        try f.complete(claimedDelivery["selection_id"] as! String)
        try f.prompt("Prepare a third task.")
        try f.ready()
        try f.emit("c")
        try f.stop()
        _ = try f.select()
        let offlineDelivery = try #require(try f.poll())
        f.clock.advance(5)
        #expect(try f.snapshot()["ready"] as? Bool == false)
        #expect(try f.poll() == nil)
        nativeReject("claude_session_invalid_claim") { _ = try f.claim(offlineDelivery) }
    }

    @Test("Scope credentials and Channel references cannot enter proposals, notes or the core journal")
    func noSecretPersistence() throws {
        let f = try NativeFixture()
        try f.prompt()
        try f.open()
        let probe = try f.ready()
        let values = [f.grant.scope.bridgeToken, f.grant.scope.selectionToken, f.grant.hookToken,
                      f.grant.controlToken, probe["nonce"] as! String]
        let before = try f.journal.load()
        for secret in values {
            var proposal = nativeProposal()
            var options = proposal["options"] as! [[String: Any]]
            options[0]["constraints"] = ["Keep the task bounded", secret]
            proposal["options"] = options
            nativeReject("claude_session_secret_reflection") { _ = try f.emit(proposal: proposal) }
            #expect(try f.journal.load() == before)
        }
        try f.emit()
        try f.stop()
        _ = try f.select()
        let event = try #require(try f.poll())
        _ = try f.claim(event)
        let durableBefore = try f.journal.load()
        for secret in values + [event["delivery_token"] as! String] {
            nativeReject("claude_session_secret_reflection") { try f.complete(event["selection_id"] as! String, note: secret) }
            #expect(try f.journal.load() == durableBefore)
        }
        try f.complete(event["selection_id"] as! String)
        let durable = try f.journal.load()
        for row in durable.events + durable.documents + durable.verificationRecords {
            #expect(!f.corpus.containsKnownSecret(in: row))
            for reference in [probe["nonce"] as! String, event["delivery_token"] as! String] {
                #expect(row.range(of: Data(reference.utf8)) == nil)
            }
        }
        let output = try StrictJSONTransport.data(forJSONObject: f.snapshot())
        #expect(!f.corpus.containsKnownSecret(in: output))
        #expect(!String(decoding: output, as: UTF8.self).contains("queued_next_turn"))
        #expect(!String(decoding: output, as: UTF8.self).contains("continuation_token"))
    }

    @Test("A failed core claim never replays and an ambiguous committed result cannot be replaced")
    func ambiguousCoreOperations() throws {
        let f = try NativeFixture()
        try f.prepare()
        _ = try f.select()
        let delivery = try #require(try f.poll())
        f.port.failNext("continuation_consumed", afterCommit: true)
        nativeReject("fixture_response_lost") { _ = try f.claim(delivery) }
        nativeReject("claude_session_invalid_claim") { _ = try f.claim(delivery) }
        try f.prompt("Prepare a separate task after the uncertain claim.")
        try f.emit("fresh")
        try f.stop()
        _ = try f.select()
        let freshDelivery = try #require(try f.poll())
        _ = try f.claim(freshDelivery)
        f.port.failNext("work_outcome_recorded", afterCommit: true)
        nativeReject("fixture_response_lost") { try f.complete(freshDelivery["selection_id"] as! String) }
        nativeReject("claude_session_invalid_completion") { try f.complete(freshDelivery["selection_id"] as! String, outcome: "failed") }
        let outcome = try #require((try f.snapshot()["outcomes"] as? [[String: Any]])?.first)
        #expect(outcome["status"] as? String == "succeeded")
    }

    @Test("Session end and grant expiry revoke every role", arguments: ["control", "hook", "expiry"])
    func terminalGrant(mode: String) throws {
        let f = try NativeFixture(lifetime: 10)
        try f.prepare()
        if mode == "control" { _ = try f.call("session.end", role: "control") }
        else if mode == "hook" { try f.hook("SessionEnd") }
        else { f.clock.advance(10) }
        for (role, operation) in [("control", "snapshot"), ("selector", "snapshot"), ("bridge", "bridge.open"), ("hook", "hook")] {
            nativeReject("claude_session_unauthorized") { _ = try f.call(operation, role: role) }
        }
    }

    @Test("Identical native IDs in separate stores cannot cross scope or restore controller authority")
    func scopeAndRestartIsolation() throws {
        let session = nativeID(), prompt = nativeID()
        let first = try NativeFixture(sessionID: session)
        let second = try NativeFixture(sessionID: session, tokenBase: 10)
        for f in [first, second] {
            try f.prompt(id: prompt)
            try f.open()
            try f.ready()
            try f.emit()
            try f.stop()
        }
        let untouched = try second.journal.load()
        _ = try first.select()
        let event = try #require(try first.poll())
        nativeReject("claude_session_invalid_claim") { _ = try second.claim(event) }
        #expect(try second.journal.load() == untouched)
        var wrongScope = first.envelope("snapshot", role: "selector")
        wrongScope["scope_id"] = second.grant.scope.scopeID
        nativeReject("claude_session_unauthorized") { _ = try first.response(wrongScope) }
        // The outer launcher refuses a grant restart. Even a fresh in-process
        // controller cannot reconstruct an earlier delivered reference.
        first.controller = try ClaudeNativeSession(grant: first.grant, adapter: first.adapter, secretCorpus: first.corpus,
                                                   now: { [clock = first.clock] in clock.date() })
        try first.open()
        nativeReject("claude_session_invalid_claim") { _ = try first.claim(event) }
        #expect(try first.snapshot()["boundary_id"] is NSNull)
        #expect(try first.snapshot()["selection_enabled"] as? Bool == false)
    }

    @Test("An authenticated unusable observation retires current authority but keeps an original report")
    func observationUnavailable() throws {
        let f = try NativeFixture()
        try f.prepare()
        _ = try f.select()
        let delivery = try #require(try f.poll())
        _ = try f.claim(delivery)
        try f.emit("next")
        try f.stop()
        let before = try f.snapshot()
        for mismatch in [["session_id_native": nativeID()], ["cwd": "/"]] {
            var fields = mismatch
            fields["reason"] = "invalid_prompt_id"
            nativeReject("claude_session_hook_mismatch") { try f.hook("ObservationUnavailable", extra: fields) }
            #expect(try StrictJSONTransport.data(forJSONObject: before) == StrictJSONTransport.data(forJSONObject: f.snapshot()))
        }
        let reply = try f.hook("ObservationUnavailable", extra: ["reason": "invalid_prompt_text"])
        #expect(reply["invalidated"] as? Bool == true)
        let snapshot = try f.snapshot()
        #expect(snapshot["boundary_id"] is NSNull)
        #expect(snapshot["ready"] as? Bool == false)
        #expect(snapshot["selection_enabled"] as? Bool == false)
        #expect((snapshot["cards"] as? [[String: Any]])?.isEmpty == true)
        try f.complete(delivery["selection_id"] as! String)
    }

    @Test("The prompt observation capacity cannot leave an earlier stopped card executable")
    func promptCapacityFailsClosed() throws {
        let f = try NativeFixture()
        try f.open()
        try f.ready()
        for index in 0..<256 { try f.prompt("Native input \(index)") }
        try f.emit()
        try f.stop()
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        let fields = try f.selectionFields()
        nativeReject("claude_session_capacity") { try f.prompt("Native input beyond bounded history") }
        let snapshot = try f.snapshot()
        #expect(snapshot["boundary_id"] is NSNull)
        #expect(snapshot["ready"] as? Bool == false)
        #expect(snapshot["selection_enabled"] as? Bool == false)
        nativeReject("claude_session_readiness_required") { _ = try f.call("select", fields: fields, role: "selector") }
    }
}
