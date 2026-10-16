import ClaudeCoreAdapter
import CryptoKit
import Darwin
import Dispatch
import Foundation
import Testing
@testable import CoordinatorSwift
@testable import BlabeeCoordinator

private final class ClaudePetMemoryJournal: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let lock = NSLock()
    private var stored = JournalSnapshot(events: [], documents: [], verificationRecords: [], journalSequence: 0)
    func load() throws -> JournalSnapshot { lock.withLock { stored } }
    func append(expectedSequence: Int64, events: [Data], documents: [Data], verificationRecords: [Data]) throws -> JournalAppendResult {
        try lock.withLock {
            guard expectedSequence == stored.journalSequence else { throw CoordinatorError("journal_sequence_conflict") }
            let candidate = JournalSnapshot(events: stored.events + events, documents: stored.documents + documents,
                verificationRecords: stored.verificationRecords + verificationRecords,
                journalSequence: expectedSequence + Int64(events.count))
            _ = try CoordinatorSemanticReplay.replay(candidate)
            stored = candidate
            return JournalAppendResult(firstSequence: expectedSequence + 1, lastSequence: candidate.journalSequence, eventCount: events.count)
        }
    }
}

final class ClaudePetClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var seconds: UInt64 = 0
    private var monotonicSeconds: UInt64 = 0
    func nowNanoseconds() -> UInt64 { lock.withLock { monotonicSeconds * 1_000_000_000 } }
    func date() -> Date { lock.withLock { Date(timeIntervalSince1970: 1_800_000_000 + Double(seconds)) } }
    func advance(_ count: UInt64) { lock.withLock { seconds += count; monotonicSeconds += count } }
    func advanceMonotonic(_ count: UInt64) { lock.withLock { monotonicSeconds += count } }
}

private func claudePetID() -> String { UUID().uuidString.lowercased() }
private func claudePetDigest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
}

/// Shared by transport and Pet view-model tests. Native roles and the common
/// semantic engine are real; only persistence and the clock are in memory.
final class ClaudePetFixture {
    let directory: URL
    let clock = ClaudePetClock()
    let grant: ClaudeNativeGrant
    let controller: ClaudeNativeSession
    let transport: ClaudePetTransport
    private let journal = ClaudePetMemoryJournal()
    var bridgeID: String?
    var boundaryID: String?
    var promptID: String?

    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("blabee-claude-pet-" + claudePetID())
            .standardizedFileURL.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let resolvedDirectory = try #require(realpath(directory.path, nil))
        defer { free(resolvedDirectory) }
        let canonicalCWD = String(cString: resolvedDirectory)
        try #require(ClaudeCanonicalDirectory.matches(canonicalCWD), "Invalid fixture directory: \(canonicalCWD)")
        let scope = try ClaudeBridgeScope(scopeID: claudePetID(), projectID: "claude-pet-fixture", sessionID: claudePetID(),
            bridgeToken: String(repeating: "1", count: 64), selectionToken: String(repeating: "2", count: 64),
            expiresAt: clock.date().addingTimeInterval(3600))
        grant = try ClaudeNativeGrant(scope: scope, cwd: canonicalCWD,
            hookToken: String(repeating: "3", count: 64), controlToken: String(repeating: "4", count: 64))
        let adapter = try ClaudeCoreAdapter(journal: journal, clock: clock, wallNow: { [clock] in clock.date() })
        let native = try ClaudeNativeSession(grant: grant, adapter: adapter, secretCorpus: RuntimeSecretCorpus(), now: { [clock] in clock.date() })
        controller = native
        transport = try ClaudePetTransport(scopeID: scope.scopeID, projectID: scope.projectID, sessionID: scope.sessionID,
            cwd: canonicalCWD, selectionToken: scope.selectionToken, handle: { try native.handle(payload: $0) })
    }
    deinit { try? FileManager.default.removeItem(at: directory) }

    func makeTransport(handle: @escaping @Sendable (Data) throws -> Data) throws -> ClaudePetTransport {
        try ClaudePetTransport(scopeID: grant.scope.scopeID, projectID: grant.scope.projectID, sessionID: grant.scope.sessionID,
            cwd: grant.cwd, selectionToken: grant.scope.selectionToken, handle: handle)
    }
    func call(_ operation: String, fields: [String: Any] = [:], role: String = "bridge") throws -> [String: Any] {
        let tokens = ["bridge": grant.scope.bridgeToken, "selector": grant.scope.selectionToken,
            "hook": grant.hookToken, "control": grant.controlToken]
        var request = fields
        request["schema_version"] = "1.0"
        request["request_id"] = claudePetID()
        request["operation"] = operation
        let data = try StrictJSONTransport.data(forJSONObject: [
            "schema_version": ClaudeNativeSession.schemaVersion, "provider": "claude", "scope_id": grant.scope.scopeID,
            "session_id": grant.scope.sessionID, "role": role, "auth_token": tokens[role]!, "request": request,
        ])
        let response = try StrictJSONTransport.object(from: controller.handle(payload: data))
        guard response["ok"] as? Bool == true, let result = response["result"] as? [String: Any] else {
            throw CoordinatorError((response["error"] as? [String: Any])?["code"] as? String ?? "fixture_response_invalid")
        }
        return result
    }
    @discardableResult func hook(_ event: String, extra: [String: Any] = [:]) throws -> [String: Any] {
        var fields: [String: Any] = ["event": event, "session_id_native": grant.scope.sessionID, "cwd": grant.cwd]
        fields.merge(extra) { _, new in new }
        let value = try call("hook", fields: fields, role: "hook")
        if let id = value["boundary_id"] as? String { boundaryID = id }
        if let id = value["prompt_id"] as? String { promptID = id }
        return value
    }
    func prompt(_ text: String = "Prepare A/B choices.", id: String = UUID().uuidString.lowercased()) throws {
        try hook("UserPromptSubmit", extra: ["prompt_id": id, "prompt_sha256": claudePetDigest(text)])
    }
    func open() throws { bridgeID = try #require(try call("bridge.open")["bridge_id"] as? String) }
    func ready() throws {
        _ = try call("readiness.begin", fields: ["bridge_id": bridgeID!])
        let probe = try #require(try poll())
        _ = try call("readiness.ack", fields: ["bridge_id": bridgeID!, "probe_id": probe["probe_id"]!, "nonce": probe["nonce"]!])
    }
    func poll() throws -> [String: Any]? { try call("bridge.poll", fields: ["bridge_id": bridgeID!])["event"] as? [String: Any] }
    func stop() throws { try hook("Stop", extra: ["prompt_id": promptID!]) }
    func emit(_ suffix: String = "a", reportedSideEffects: [[String: Any]] = []) throws {
        let proposal: [String: Any] = ["proposal_id": claudePetID(), "task_goal": "Exercise the shared Pet for " + suffix,
            "outcome": ["status": "completed", "summary": "Choices prepared for " + suffix], "reported_side_effects": reportedSideEffects,
            "options": [
                ["id": "read-" + suffix, "title": "Read " + suffix, "description": "Read the selected fixture.",
                 "task": "Read fixture-" + suffix + ".txt", "done_when": "Report the content.", "constraints": ["Do not modify files."]],
                ["id": "list-" + suffix, "title": "List " + suffix, "description": "List the directory.",
                 "task": "List the current directory", "done_when": "Report the listing.", "constraints": []],
            ]]
        _ = try call("proposal.emit", fields: ["bridge_id": bridgeID!, "boundary_id": boundaryID!, "proposal": proposal])
    }
    func snapshot() async throws -> PetSnapshot {
        let data = try await transport.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
        return try await transport.decodeSnapshot(data)
    }
    @discardableResult func claim(_ event: [String: Any]) throws -> [String: Any] {
        let value = try call("selection.claim", fields: ["bridge_id": bridgeID!, "selection_id": event["selection_id"]!,
            "delivery_token": event["delivery_token"]!])
        boundaryID = try #require(value["boundary_id"] as? String)
        promptID = try #require(value["prompt_id"] as? String)
        return value
    }
    func complete(_ selectionID: String, outcome: String = "completed", note: String = "The model reports fixture completion.") throws {
        _ = try call("selection.complete", fields: ["bridge_id": bridgeID!, "selection_id": selectionID, "outcome": outcome, "note": note])
    }
    func prepare() throws { try prompt(); try open(); try ready(); try emit(); try stop() }
    func journalSequence() throws -> Int64 { try journal.load().journalSequence }
}

private func claudePetExpectRejected(_ action: () async throws -> Void) async {
    do { try await action(); Issue.record("Expected Claude Pet rejection") }
    catch { #expect(error is PetModelError || error is CoordinatorError) }
}

private func claudePetSelection(_ snapshot: PetSnapshot) throws -> PetSelectionRequest {
    let card = try #require(snapshot.interactions.first)
    return try PetSelectionRequest(identity: card.identity, selectionID: claudePetID(), optionID: card.choices[0].optionID)
}

@Suite("Claude Pet transport")
struct ClaudePetTransportTests {
    @Test("Native versioned projection retains the original snapshot contract and selector-only access")
    func projectionBoundary() async throws {
        let f = try ClaudePetFixture()
        let old = try f.call("snapshot", role: "selector")
        #expect(Set(old.keys) == ["cards", "outcomes", "history", "boundary_id", "ready", "bridge_connected", "selection_enabled"])
        for role in ["bridge", "hook", "control"] {
            await claudePetExpectRejected { _ = try f.call("pet.snapshot", role: role) }
        }
        let data = try await f.transport.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
        let envelope = try StrictJSONTransport.object(from: data)
        #expect(envelope["schema_version"] as? String == "blabee.claude-session.v1")
        #expect((envelope["result"] as? [String: Any])?["schema_version"] as? String == "blabee.claude-pet.v1")
        await claudePetExpectRejected { _ = try PetSnapshot.parse(data) }
        let snapshot = try await f.transport.decodeSnapshot(data)
        #expect(snapshot.projects.count == 1 && snapshot.sessions.count == 1)
        #expect(snapshot.sessions[0].sourcePromptID == nil && snapshot.sessions[0].sourceTurnID == nil)
        #expect(snapshot.providerStatus?.provider == .claude)
        #expect(snapshot.providerStatus?.ready == false)
        #expect(snapshot.providerStatus?.pendingReportCount == 0)
        #expect(snapshot.interactions.isEmpty)
        await claudePetExpectRejected { _ = try await f.transport.decodeSnapshot(data) }
        let copied = snapshot
        var changed = snapshot
        changed.providerStatus = nil
        #expect(copied != changed)
    }

    @Test("A card remains unselectable before ACK and matching Stop; heartbeat loss revokes readiness")
    func readinessAndStop() async throws {
        let f = try ClaudePetFixture()
        try f.prompt(); try f.open(); try f.emit()
        let unready = try await f.snapshot()
        let selection = try claudePetSelection(unready)
        #expect(unready.interactions[0].state == .sealed)
        #expect(unready.routing.foreground == nil && !unready.routing.selectionEnabled)
        await claudePetExpectRejected { _ = try await f.transport.request(type: "focus_interaction", payload: PetFocusRequest(identity: selection.identity).data()) }
        await claudePetExpectRejected { _ = try await f.transport.request(type: "select", payload: selection.data()) }
        try f.ready()
        let unstopped = try await f.snapshot()
        #expect(unstopped.providerStatus?.ready == true && !unstopped.routing.selectionEnabled)
        try f.stop()
        let stopped = try await f.snapshot()
        #expect(stopped.routing.selectionEnabled && stopped.interactions[0].isSelectionReady)
        #expect(stopped.interactions[0].identity == selection.identity)
        let before = try f.journalSequence()
        let focused = try await f.transport.request(type: "focus_interaction", payload: PetFocusRequest(identity: selection.identity).data())
        try PetTransportResponse.requireFocused(focused)
        #expect(try f.journalSequence() == before)
        f.clock.advance(5)
        let offline = try await f.snapshot()
        #expect(offline.providerStatus?.bridgeConnected == false && !offline.routing.selectionEnabled)
        await claudePetExpectRejected { _ = try await f.transport.request(type: "select", payload: selection.data()) }
        _ = try f.poll()
        let alive = try await f.snapshot()
        #expect(alive.providerStatus?.bridgeConnected == true && alive.providerStatus?.ready == false)
    }

    @Test("A is selected exactly once and reports channel pending without a queued submission")
    func exactSelection() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let before = try await f.snapshot()
        let request = try claudePetSelection(before)
        let data = try await f.transport.request(type: "select", payload: request.data())
        #expect(!String(decoding: data, as: UTF8.self).contains("queued_submission_id"))
        #expect(try await f.transport.selectionOutcome(data, request: request) == .channelPending)
        await claudePetExpectRejected { _ = try await f.transport.selectionOutcome(data, request: request) }
        await claudePetExpectRejected { _ = try await f.transport.request(type: "select", payload: request.data()) }
        let pending = try await f.snapshot()
        #expect(pending.interactions.isEmpty && pending.providerStatus?.latestOutcome == nil)
        #expect(pending.providerStatus?.pendingReportCount == 0)
        let event = try #require(try f.poll())
        #expect(event["selection_id"] as? String == request.selectionID)
        let claimed = try f.claim(event)
        #expect((claimed["action"] as? [String: Any])?["task"] as? String == "Read fixture-a.txt")
        #expect(claimed["prompt_id"] as? String == request.identity.binding.sourcePromptID)
        let claimedSnapshot = try await f.snapshot()
        #expect(claimedSnapshot.providerStatus?.pendingReportCount == 1)
        #expect(claimedSnapshot.routing.inFlightCount == 0)
        #expect(claimedSnapshot.providerStatus?.latestOutcome == nil)
        #expect(try f.poll() == nil)
    }

    @Test("Monotonic core expiry rejects a stale click even while native readiness remains valid")
    func monotonicCardExpiry() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let before = try await f.snapshot()
        let request = try claudePetSelection(before)
        #expect(before.interactions[0].millisecondsUntilExpiry == 600_000)
        // Hold the independent native wall clock/readiness lease steady so
        // this proves the core monotonic expiry, rather than heartbeat expiry.
        f.clock.advanceMonotonic(CoordinatorRoutingApplication.expiryAfterNanoseconds / 1_000_000_000)
        let expired = try await f.snapshot()
        #expect(expired.providerStatus?.ready == true && expired.providerStatus?.bridgeConnected == true)
        #expect(expired.interactions.isEmpty && !expired.routing.selectionEnabled)
        await claudePetExpectRejected { _ = try await f.transport.request(type: "focus_interaction", payload: PetFocusRequest(identity: request.identity).data()) }
        await claudePetExpectRejected { _ = try await f.transport.request(type: "select", payload: request.data()) }
        #expect(try f.poll() == nil)
    }

    @Test("A valid heartbeat cannot extend the readiness ACK lifetime")
    func readinessLeaseExpiry() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let request = try claudePetSelection(try await f.snapshot())
        for _ in 0..<75 { f.clock.advance(4); _ = try f.poll() }
        let expired = try await f.snapshot()
        #expect(expired.providerStatus?.bridgeConnected == true && expired.providerStatus?.ready == false)
        #expect(expired.interactions.count == 1 && expired.interactions[0].millisecondsUntilExpiry == 300_000)
        #expect(!expired.routing.selectionEnabled && expired.interactions[0].state == .sealed)
        await claudePetExpectRejected { _ = try await f.transport.request(type: "select", payload: request.data()) }
        try f.ready()
        let renewed = try await f.snapshot()
        #expect(renewed.routing.selectionEnabled && renewed.interactions[0].identity == request.identity)
    }

    @Test("New Hook input and any forged full identity reject old focus or selection")
    func staleAndFullBinding() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let request = try claudePetSelection(try await f.snapshot())
        let before = try f.journalSequence()
        for key in ["project_id", "session_id", "source_turn_id", "source_prompt_id", "episode_id", "episode_root_prompt_id", "episode_baseline_checkpoint_id", "decision_boundary_id", "interaction_id", "packet_id", "revision", "boundary_sequence", "option_id"] {
            var payload = request.jsonObject
            payload[key] = ["revision", "boundary_sequence"].contains(key) ? 2 : claudePetID()
            let data = try StrictJSONTransport.data(forJSONObject: payload)
            await claudePetExpectRejected { _ = try await f.transport.request(type: "select", payload: data) }
        }
        #expect(try f.journalSequence() == before)
        try f.prompt("A new user request")
        try f.emit("c"); try f.stop()
        let current = try await f.snapshot()
        await claudePetExpectRejected { _ = try await f.transport.request(type: "focus_interaction", payload: PetFocusRequest(identity: request.identity).data()) }
        await claudePetExpectRejected { _ = try await f.transport.request(type: "select", payload: request.data()) }
        #expect(try await f.snapshot() == current)
    }

    @Test("A late original model result leaves successor C/D unchanged", arguments: ["completed", "failed"])
    func lateReport(outcome: String) async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let request = try claudePetSelection(try await f.snapshot())
        let response = try await f.transport.request(type: "select", payload: request.data())
        _ = try await f.transport.selectionOutcome(response, request: request)
        let event = try #require(try f.poll()); try f.claim(event)
        try f.prompt("Prepare C/D"); try f.emit("cd"); try f.stop()
        let before = try await f.snapshot()
        #expect(before.providerStatus?.pendingReportCount == 1)
        try f.complete(request.selectionID, outcome: outcome)
        let after = try await f.snapshot()
        #expect(after.interactions == before.interactions && after.routing == before.routing)
        #expect(after.providerStatus?.selectionEnabled == true)
        #expect(after.providerStatus?.pendingReportCount == 0)
        #expect(after.providerStatus?.latestOutcome == PetProviderOutcome(selectionID: request.selectionID,
            sourcePromptID: request.identity.binding.sourcePromptID, status: outcome == "completed" ? "succeeded" : "failed",
            summary: "The model reports fixture completion."))
        #expect(after.sessions[0].sourcePromptID != after.providerStatus?.latestOutcome?.sourcePromptID)
    }

    @Test("An uncertain native selection response is not retried")
    func uncertainMutation() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let request = try claudePetSelection(try await f.snapshot())
        let native = f.controller
        let fault = ClaudePetSelectFault()
        let transport = try f.makeTransport { data in
            let object = try StrictJSONTransport.object(from: data)
            let operation = (object["request"] as? [String: Any])?["operation"] as? String
            let response = try native.handle(payload: data)
            if operation == "select" { fault.record(); throw CoordinatorError("fixture_response_lost") }
            return response
        }
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: request.data()) }
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: request.data()) }
        let another = try PetSelectionRequest(identity: request.identity, selectionID: claudePetID(), optionID: request.optionID)
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: another.data()) }
        #expect(fault.count == 1)
        let event = try #require(try f.poll())
        #expect(event["selection_id"] as? String == request.selectionID)
    }

    @Test("500 Pet selections keep one current attempt and one receipt, including abandoned receipts", arguments: [true, false])
    func boundedSelectionState(consumeReceipts: Bool) async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        // The projection starts at the real legacy native/Pet boundary. This
        // test then uses a consumed-ID oracle to exercise the client beyond the
        // legacy server's 128-selection cap; it is not product-v2 UI integration.
        let server = try ClaudePetBoundedServer(projection: f.call("pet.snapshot", role: "selector"))
        let transport = try f.makeTransport { try server.handle($0) }
        var firstRequest: PetSelectionRequest?
        var firstResponse: Data?
        var latestRequest: PetSelectionRequest?
        var latestResponse: Data?
        for _ in 0..<500 {
            let snapshotData = try await transport.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
            let request = try claudePetSelection(try await transport.decodeSnapshot(snapshotData))
            let response = try await transport.request(type: "select", payload: request.data())
            if firstRequest == nil { firstRequest = request; firstResponse = response }
            latestRequest = request; latestResponse = response
            if consumeReceipts { #expect(try await transport.selectionOutcome(response, request: request) == .channelPending) }
            let counts = await transport.retainedSelectionStateCounts
            #expect(counts.attempts == 1 && counts.receipts == (consumeReceipts ? 0 : 1) && counts.inFlight == 0)
        }
        #expect(server.acceptedSelections == 500)
        let first = try #require(firstRequest), firstData = try #require(firstResponse)
        await claudePetExpectRejected { _ = try await transport.selectionOutcome(firstData, request: first) }
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: first.data()) }
        if !consumeReceipts {
            let latest = try #require(latestRequest), latestData = try #require(latestResponse)
            #expect(try await transport.selectionOutcome(latestData, request: latest) == .channelPending)
        }
        // An old ID attached to a new current card must reach the server's
        // historical consumed-state check, never execute again after local GC.
        let currentData = try await transport.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
        let current = try claudePetSelection(try await transport.decodeSnapshot(currentData))
        let replay = try PetSelectionRequest(identity: current.identity, selectionID: first.selectionID, optionID: current.optionID)
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: replay.data()) }
        #expect(server.replayedSelections == 1 && server.acceptedSelections == 500)
        let counts = await transport.retainedSelectionStateCounts
        #expect(counts.attempts == 1 && counts.receipts == 0 && counts.inFlight == 0)
    }

    @Test("An uncertain mutation blocks new IDs on the same still-visible card without retaining historical cards")
    func uncertainStillVisibleCard() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let server = try ClaudePetBoundedServer(projection: f.call("pet.snapshot", role: "selector"))
        let transport = try f.makeTransport { try server.handle($0) }
        let first = try claudePetSelection(try await f.snapshot())
        server.loseNextSelectionBeforeCommit()
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: first.data()) }
        let changedID = try PetSelectionRequest(identity: first.identity, selectionID: claudePetID(), optionID: first.optionID)
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: changedID.data()) }
        #expect(server.selectionCalls == 1 && server.acceptedSelections == 0)
        server.advanceCard()
        let data = try await transport.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
        let next = try claudePetSelection(try await transport.decodeSnapshot(data))
        let response = try await transport.request(type: "select", payload: next.data())
        #expect(try await transport.selectionOutcome(response, request: next) == .channelPending)
        #expect(server.selectionCalls == 2 && server.acceptedSelections == 1)
        let counts = await transport.retainedSelectionStateCounts
        #expect(counts.attempts == 1 && counts.receipts == 0 && counts.inFlight == 0)
    }

    @Test("A second click cannot enter the fresh snapshot await while the first selection owns its slot")
    func reservesBeforeFirstAwait() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let request = try claudePetSelection(try await f.snapshot())
        let gate = ClaudePetSnapshotGate()
        let server = try ClaudePetBoundedServer(projection: f.call("pet.snapshot", role: "selector"), snapshotGate: gate)
        let transport = try f.makeTransport { try server.handle($0) }
        let first = Task { try await transport.request(type: "select", payload: request.data()) }
        let entered = await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: gate.entered.wait(timeout: .now() + 5) == .success)
            }
        }
        defer { gate.release.signal() }
        #expect(entered)
        let second = try PetSelectionRequest(identity: request.identity, selectionID: claudePetID(), optionID: request.optionID)
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: second.data()) }
        #expect(server.snapshotCalls == 1 && server.selectionCalls == 0)
        let pending = await transport.retainedSelectionStateCounts
        #expect(pending.inFlight == 1 && pending.attempts == 0)
        gate.release.signal()
        let response = try await first.value
        #expect(try await transport.selectionOutcome(response, request: request) == .channelPending)
        #expect(server.selectionCalls == 1)
    }

    @Test("Malformed or cross-scope projection never becomes a Pet card", arguments: [
        "scope", "session", "role", "request", "schema", "card_project", "binding_extra", "packet_revision",
        "mapping", "route_orphan", "outcome_reporter", "history", "numeric_boolean", "card_task", "route_foreground", "pending_count",
    ])
    func malformedProjection(field: String) async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let native = f.controller
        let transport = try f.makeTransport { data in
            try claudePetTamper(native.handle(payload: data), field: field)
        }
        await claudePetExpectRejected {
            let data = try await transport.request(type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat())
            _ = try await transport.decodeSnapshot(data)
        }
        #expect(try await f.snapshot().routing.selectionEnabled)
    }

    @Test("Only supported Pet operations reach the native selector")
    func unsupportedAndReceipts() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        for type in ["resolve_permission_request", "session.end", "selection.claim"] {
            await claudePetExpectRejected { _ = try await f.transport.request(type: type, payload: Data("{}".utf8)) }
        }
        await claudePetExpectRejected {
            _ = try await f.transport.request(type: "dismiss_interaction", payload: Data("{}".utf8))
        }
        let request = try claudePetSelection(try await f.snapshot())
        let data = try await f.transport.request(type: "select", payload: request.data())
        let forged = try PetSelectionRequest(identity: request.identity, selectionID: request.selectionID, optionID: "different-option")
        await claudePetExpectRejected { _ = try await f.transport.selectionOutcome(data, request: forged) }
        await claudePetExpectRejected { _ = try await f.transport.selectionOutcome(petTestSelectionResponse(), request: request) }
        #expect(try await f.transport.selectionOutcome(data, request: request) == .channelPending)
    }

    @Test("Dismissal rejects stale full identities and expired cards without selecting or delivering")
    func dismissalIdentityAndExpiry() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let identity = try #require(try await f.snapshot().interactions.first?.identity)
        let request = PetDismissRequest(identity: identity)
        let before = try f.journalSequence()
        let mutations: [(String, Any)] = [
            ("project_id", "another-project"), ("session_id", claudePetID()),
            ("source_prompt_id", claudePetID()), ("decision_boundary_id", claudePetID()),
            ("interaction_id", "another-interaction"), ("packet_id", "another-packet"), ("revision", 2),
        ]
        for (field, value) in mutations {
            var object = request.jsonObject; object[field] = value
            let data = try petTestData(object)
            await claudePetExpectRejected { _ = try await f.transport.request(type: "dismiss_interaction", payload: data) }
        }
        #expect(try f.journalSequence() == before)
        #expect(try await f.snapshot().interactions.first?.identity == identity)
        f.clock.advanceMonotonic(600)
        await claudePetExpectRejected { _ = try await f.transport.request(type: "dismiss_interaction", payload: request.data()) }
        #expect(try await f.snapshot().routing.inFlightCount == 0)
        #expect(try f.poll() == nil)
    }

    @Test("Dismissal owns the same mutation slot as selection before a slow fresh read")
    func dismissalReservesBeforeRead() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let selection = try claudePetSelection(try await f.snapshot())
        let request = PetDismissRequest(identity: selection.identity)
        let gate = ClaudePetSnapshotGate()
        let native = f.controller
        let transport = try f.makeTransport { data in
            let object = try StrictJSONTransport.object(from: data)
            if (object["request"] as? [String: Any])?["operation"] as? String == "pet.snapshot" {
                gate.entered.signal()
                guard gate.release.wait(timeout: .now() + 10) == .success else { throw PetTestError.injected("gate_timeout") }
            }
            return try native.handle(payload: data)
        }
        let pending = Task { try await transport.request(type: "dismiss_interaction", payload: request.data()) }
        let entered = await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: gate.entered.wait(timeout: .now() + 5) == .success)
            }
        }
        #expect(entered)
        defer { gate.release.signal() }
        await claudePetExpectRejected { _ = try await transport.request(type: "select", payload: selection.data()) }
        await claudePetExpectRejected { _ = try await transport.request(type: "dismiss_interaction", payload: request.data()) }
        gate.release.signal()
        try request.requireDismissed(await pending.value)
        #expect(try f.poll() == nil)
        #expect(try await f.snapshot().interactions.isEmpty)
    }

    @Test("An uncertain dismissal response is never converted into execution or automatically retried")
    func lostDismissalResponse() async throws {
        let f = try ClaudePetFixture(); try f.prepare()
        let request = PetDismissRequest(identity: try #require(try await f.snapshot().interactions.first?.identity))
        let native = f.controller
        let calls = ClaudePetSelectFault()
        let transport = try f.makeTransport { data in
            let request = try StrictJSONTransport.object(from: data)["request"] as? [String: Any]
            let response = try native.handle(payload: data)
            if request?["operation"] as? String == "dismiss_interaction" {
                calls.record()
                throw CoordinatorError("lost_dismissal_receipt")
            }
            return response
        }
        await claudePetExpectRejected { _ = try await transport.request(type: "dismiss_interaction", payload: request.data()) }
        #expect(calls.count == 1)
        #expect(try await f.snapshot().interactions.isEmpty)
        #expect(try await f.snapshot().routing.inFlightCount == 0)
        #expect(try f.poll() == nil)
    }

    @Test("Side-effect kinds are rejected before admission or remain displayable by the common Pet", arguments: [
        "file_change", "a", String(repeating: "a", count: 64), "file-change", "File_change", "1file_change",
        "file_change\n", "", String(repeating: "a", count: 65),
    ])
    func sideEffectAdmission(kind: String) async throws {
        let f = try ClaudePetFixture(); try f.prompt(); try f.open()
        let effects: [[String: Any]] = [["kind": kind, "summary": "The selected file was changed.", "reversibility": "reversible"]]
        if ["file_change", "a", String(repeating: "a", count: 64)].contains(kind) {
            try f.emit(reportedSideEffects: effects)
            let snapshot = try await f.snapshot()
            #expect(snapshot.interactions.first?.reportedSideEffects.map(\.kind) == [kind])
        } else {
            let before = try f.journalSequence()
            do { try f.emit(reportedSideEffects: effects); Issue.record("Invalid side-effect kind was admitted") }
            catch let error as CoordinatorError { #expect(error.code == "invalid_reported_side_effects") }
            #expect(try f.journalSequence() == before)
            #expect(try await f.snapshot().interactions.isEmpty)
        }
    }
}

private final class ClaudePetSelectFault: @unchecked Sendable {
    private let lock = NSLock()
    private var stored = 0
    var count: Int { lock.withLock { stored } }
    func record() { lock.withLock { stored += 1 } }
}

private final class ClaudePetSnapshotGate: @unchecked Sendable {
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
}

/// A transport-only oracle: historical IDs are server-side, separate from the
/// bounded Pet state under test. Real product durable replay is tested by the
/// registry/native suites; this does not remove any legacy native server quota.
private final class ClaudePetBoundedServer: @unchecked Sendable {
    private let lock = NSLock()
    private var projection: [String: Any]
    private var currentIdentity: PetInteractionIdentity
    private var consumed = Set<String>()
    private var snapshots = 0
    private var selections = 0
    private var replayed = 0
    private var loseNext = false
    private var snapshotGate: ClaudePetSnapshotGate?

    init(projection: [String: Any], snapshotGate: ClaudePetSnapshotGate? = nil) throws {
        guard let card = (projection["cards"] as? [[String: Any]])?.first,
              let packet = card["packet"] as? [String: Any] else { throw CoordinatorError("fixture_invalid_projection") }
        self.projection = projection
        self.currentIdentity = try PetInteractionIdentity(jsonObject: packet)
        self.snapshotGate = snapshotGate
    }

    var snapshotCalls: Int { lock.withLock { snapshots } }
    var selectionCalls: Int { lock.withLock { selections } }
    var acceptedSelections: Int { lock.withLock { consumed.count } }
    var replayedSelections: Int { lock.withLock { replayed } }
    func loseNextSelectionBeforeCommit() { lock.withLock { loseNext = true } }
    func advanceCard() { lock.withLock { advanceCardLocked() } }

    private func advanceCardLocked() {
        let replacements = [currentIdentity.packetID: "fixture_packet_" + claudePetID(),
                            currentIdentity.interactionID: "fixture_interaction_" + claudePetID(),
                            currentIdentity.binding.decisionBoundaryID: claudePetID()]
        func replace(_ value: Any) -> Any {
            if let string = value as? String { return replacements[string] ?? string }
            if let object = value as? [String: Any] { return object.mapValues(replace) }
            if let array = value as? [Any] { return array.map(replace) }
            return value
        }
        projection = replace(projection) as! [String: Any]
        let card = (projection["cards"] as! [[String: Any]])[0]
        currentIdentity = try! PetInteractionIdentity(jsonObject: card["packet"] as! [String: Any])
    }

    func handle(_ data: Data) throws -> Data {
        let envelope = try StrictJSONTransport.object(from: data)
        guard let request = envelope["request"] as? [String: Any], let operation = request["operation"] as? String else {
            throw CoordinatorError("fixture_invalid_request")
        }
        if operation == "pet.snapshot" {
            let gate = lock.withLock { () -> ClaudePetSnapshotGate? in
                snapshots += 1
                let gate = snapshotGate
                snapshotGate = nil
                return gate
            }
            if let gate {
                gate.entered.signal()
                guard gate.release.wait(timeout: .now() + 10) == .success else { throw CoordinatorError("fixture_timeout") }
            }
        }
        return try lock.withLock {
            let result: [String: Any]
            if operation == "pet.snapshot" { result = projection }
            else if operation == "select" {
                selections += 1
                guard let id = request["selection_id"] as? String,
                      request["boundary_id"] as? String == currentIdentity.binding.decisionBoundaryID,
                      request["packet_id"] as? String == currentIdentity.packetID else {
                    throw CoordinatorError("fixture_stale_card")
                }
                guard !consumed.contains(id) else { replayed += 1; throw CoordinatorError("already_claimed") }
                if loseNext { loseNext = false; throw CoordinatorError("fixture_response_unknown") }
                consumed.insert(id)
                result = ["selection_id": id, "continuation_id": "fixture_continuation_" + id,
                          "packet_id": currentIdentity.packetID, "revision": currentIdentity.revision,
                          "option_id": request["option_id"]!, "delivery": "awaiting_claude_claim"]
                advanceCardLocked()
            } else { throw CoordinatorError("fixture_unsupported_operation") }
            return try StrictJSONTransport.data(forJSONObject: [
                "schema_version": envelope["schema_version"]!, "provider": "claude", "scope_id": envelope["scope_id"]!,
                "session_id": envelope["session_id"]!, "role": "selector", "request_id": request["request_id"]!,
                "ok": true, "result": result,
            ])
        }
    }
}

private func claudePetTamper(_ data: Data, field: String) throws -> Data {
    var envelope = try StrictJSONTransport.object(from: data)
    var result = envelope["result"] as! [String: Any]
    var cards = result["cards"] as! [[String: Any]]
    var routing = result["routing"] as! [String: Any]
    switch field {
    case "scope": envelope["scope_id"] = claudePetID()
    case "session": envelope["session_id"] = claudePetID()
    case "role": envelope["role"] = "bridge"
    case "request": envelope["request_id"] = claudePetID()
    case "schema": result["schema_version"] = "1.0"
    case "card_project", "binding_extra":
        var binding = cards[0]["binding"] as! [String: Any]
        binding[field == "card_project" ? "project_id" : "foreign_identity"] = "foreign"
        cards[0]["binding"] = binding
    case "packet_revision", "card_task":
        var packet = cards[0]["packet"] as! [String: Any]
        if field == "packet_revision" { packet["revision"] = 2 }
        else {
            var choices = packet["choices"] as! [[String: Any]]
            var action = choices[0]["action"] as! [String: Any]
            action["objective"] = "Execute a different action"
            choices[0]["action"] = action
            packet["choices"] = choices
        }
        cards[0]["packet"] = packet
    case "mapping":
        var mapping = cards[0]["option_bindings"] as! [[String: Any]]
        mapping[0]["option_id"] = mapping[1]["option_id"]
        cards[0]["option_bindings"] = mapping
    case "route_orphan": routing["pending"] = []
    case "route_foreground": routing["foreground"] = NSNull()
    case "numeric_boolean": result["selection_enabled"] = 1
    case "pending_count": result["pending_report_count"] = 33
    case "history": result["history"] = ["total_outcomes": 1, "omitted_outcomes": 0]
    case "outcome_reporter":
        result["outcomes"] = [["selection_id": claudePetID(), "binding": cards[0]["binding"]!,
            "continuation_id": "fixture-continuation", "status": "succeeded", "summary": "Unverified report", "reported_by": "local_verified"]]
        result["history"] = ["total_outcomes": 1, "omitted_outcomes": 0]
    default: throw CoordinatorError("fixture_unknown_mutation")
    }
    result["cards"] = cards
    result["routing"] = routing
    envelope["result"] = result
    return try StrictJSONTransport.data(forJSONObject: envelope)
}
