@testable import ClaudeCoreAdapter
@testable import CoordinatorSwift
import CryptoKit
import Foundation
import SQLite3
import Testing

final class ProductAuthorityClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var nanos: UInt64 = 0
    private var wallOffset: TimeInterval = 0
    func nowNanoseconds() -> UInt64 { lock.withLock { nanos } }
    func advance(_ seconds: UInt64) { lock.withLock { nanos += seconds * 1_000_000_000 } }
    func shiftWall(_ seconds: TimeInterval) { lock.withLock { wallOffset += seconds } }
    func date() -> Date { lock.withLock { Date(timeIntervalSince1970: 1_800_000_000 + Double(nanos) / 1_000_000_000 + wallOffset) } }
}

final class ProductAuthorityAnchor: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "product-authority-" + UUID().uuidString
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    private var nextLoad: (@Sendable () -> Void)?
    func delayNextLoad(_ body: @escaping @Sendable () -> Void) { lock.withLock { nextLoad = body } }
    func load() -> FreshnessStoredRecord? {
        let (value, body) = lock.withLock {
            let result = (stored, nextLoad)
            nextLoad = nil
            return result
        }
        body?()
        return value
    }
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

final class ProductAuthorityGate: @unchecked Sendable {
    let authority: ClaudeSessionAuthority
    private let lock = NSLock()
    private var before: (@Sendable () throws -> Void)?
    private var after: (@Sendable () throws -> Void)?
    init(_ authority: ClaudeSessionAuthority) { self.authority = authority }
    func onNext(before: (@Sendable () throws -> Void)? = nil,
                after: (@Sendable () throws -> Void)? = nil) {
        lock.withLock { self.before = before; self.after = after }
    }
    func commit(_ body: () throws -> Void) throws {
        let callbacks = lock.withLock { () -> ((@Sendable () throws -> Void)?, (@Sendable () throws -> Void)?) in
            let result = (before, after)
            before = nil; after = nil
            return result
        }
        // An earlier ticket must still be rechecked after slow preparation or
        // an independent owner EOF, at the concrete SQLite COMMIT seam.
        let ticket = try authority.authorize(identity: authority.identity)
        try callbacks.0?()
        try authority.withMutationFence(ticket) { try body() }
        try callbacks.1?()
    }
}

final class ProductMutationMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var ids: [UUID] = []
    var count: Int { lock.withLock { ids.count } }
    func execute(id: UUID, binding: CoordinatorBinding?, body: () throws -> Data) throws -> Data {
        lock.withLock { ids.append(id) }
        return try body()
    }
}

/// Test-only single-read delay. The real SQLite journal, freshness anchor and
/// product authority still own all validation and commits.
final class ProductMutationReadProbe: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let journal: any CoordinatorSemanticJournalPort
    private let lock = NSLock()
    private var pending: (@Sendable () -> Void)?
    private var nextRead: (@Sendable () -> Void)?
    init(_ journal: any CoordinatorSemanticJournalPort) { self.journal = journal }
    func delayNextBoundMutationLoad(_ body: @escaping @Sendable () -> Void) { lock.withLock { pending = body } }
    func admit(_ binding: CoordinatorBinding?) {
        guard binding != nil else { return }
        lock.withLock { nextRead = pending; pending = nil }
    }
    func load() throws -> JournalSnapshot {
        let body = lock.withLock { let body = nextRead; nextRead = nil; return body }
        body?()
        return try journal.load()
    }
    func append(expectedSequence: Int64, events: [Data], documents: [Data], verificationRecords: [Data]) throws -> JournalAppendResult {
        try journal.append(expectedSequence: expectedSequence, events: events,
            documents: documents, verificationRecords: verificationRecords)
    }
    func append(expectedSequence: Int64, events: [Data], documents: [Data],
                verificationRecords: [Data], validateAdmission: () throws -> Void) throws -> JournalAppendResult {
        try journal.append(expectedSequence: expectedSequence, events: events,
            documents: documents, verificationRecords: verificationRecords,
            validateAdmission: validateAdmission)
    }
}

func productID() -> String { UUID().uuidString.lowercased() }
func productDigest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
}
func productHookNoticeFixture() throws -> [String: Any] {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<4 { root.deleteLastPathComponent() }
    return try StrictJSONTransport.object(from: Data(contentsOf:
        root.appendingPathComponent("fixtures/product-hook/selection-notice.json")))
}
func productHookText(_ event: [String: Any], field: String = "native_prompt_text") throws -> String {
    let fixture = try productHookNoticeFixture()
    let original = try #require(fixture["selection_event"] as? [String: Any])
    var text = try #require(fixture[field] as? String)
    for key in ["selection_id", "delivery_token"] {
        text = text.replacingOccurrences(of: try #require(original[key] as? String),
            with: try #require(event[key] as? String))
    }
    return text
}
struct ProductWireRejection: Error {
    let code: String
}
func productProposal() -> [String: Any] {
    ["schema_version": "blabee.claude-proposal.v1", "value": [
        "proposal_id": productID(), "task_goal": "Verify shared product authority.",
        "outcome": ["status": "completed", "summary": "Fixture choices are ready."], "reported_side_effects": [],
        "options": [
            ["id": "read", "title": "Read", "description": "Read the selected fixture.",
             "task": "Read fixture.txt", "done_when": "Report its contents.", "constraints": ["No writes."]],
            ["id": "list", "title": "List", "description": "List fixture names.",
             "task": "List fixtures", "done_when": "Report the names.", "constraints": []],
        ],
    ]]
}

final class ProductAuthorityReplay: ClaudeNativeReplayPort, @unchecked Sendable {
    private let lock = NSLock()
    private var keys: Set<String> = []
    private var operations: Set<UUID> = []
    private var failNext = false
    var count: Int { lock.withLock { keys.count } }
    func failNextConsume() { lock.withLock { failNext = true } }
    func consume(_ key: ClaudeReplayKey, operationID: UUID) throws {
        try lock.withLock {
            if failNext { failNext = false; throw CoordinatorError("fixture_replay_storage_failed") }
            let identifier = key.kind.rawValue + ":" + key.id
            guard !keys.contains(identifier), !operations.contains(operationID) else {
                throw CoordinatorError("claude_metadata_replay")
            }
            keys.insert(identifier)
            operations.insert(operationID)
        }
    }
}

/// Volatile test storage for the long lifecycle-count exercise only. Native,
/// ingress and the semantic core remain real; this is not a SQLite, HMAC,
/// freshness, crash-recovery or durable-replay-storage qualification.
private final class ProductLifecycleMemoryJournal: CoordinatorSemanticJournalPort, @unchecked Sendable {
    private let lock = NSLock()
    private let gate: ProductAuthorityGate
    private var stored = JournalSnapshot(events: [], documents: [], verificationRecords: [], journalSequence: 0)
    init(gate: ProductAuthorityGate) { self.gate = gate }
    var eventCount: Int64 { lock.withLock { Int64(stored.events.count) } }
    func load() throws -> JournalSnapshot { lock.withLock { stored } }
    func append(expectedSequence: Int64, events: [Data], documents: [Data],
                verificationRecords: [Data]) throws -> JournalAppendResult {
        try lock.withLock {
            guard expectedSequence == stored.journalSequence else { throw CoordinatorError("journal_sequence_conflict") }
            let candidate = JournalSnapshot(events: stored.events + events, documents: stored.documents + documents,
                verificationRecords: stored.verificationRecords + verificationRecords,
                journalSequence: expectedSequence + Int64(events.count))
            // The real semantic application validates this candidate before
            // append. Keep this count-test port to atomic storage/CAS only.
            try gate.commit { stored = candidate }
            return JournalAppendResult(firstSequence: expectedSequence + 1,
                lastSequence: candidate.journalSequence, eventCount: events.count)
        }
    }
}

final class ProductAuthorityFixture: @unchecked Sendable {
    enum Storage { case sqlite, lifecycleMemory }
    let directory: URL
    let database: URL
    let clock = ProductAuthorityClock()
    let corpus = RuntimeSecretCorpus()
    let meter = ProductMutationMeter()
    let replay = ProductAuthorityReplay()
    let configuration: ClaudeProductNativeConfiguration
    let authority: ClaudeSessionAuthority
    let gate: ProductAuthorityGate
    let codec: ClaudeProductWireCodec
    var journal: (any CoordinatorSemanticJournalPort)!
    var readProbe: ProductMutationReadProbe?
    var native: ClaudeNativeSession!
    var bridgeID: String?
    var boundaryID: String?
    var promptID: String?
    var waiter: [String: Any]?

    init(storage: Storage = .sqlite, channelSource: String = "blabee-claude",
         checkRejectedMutationSequence: Bool = false,
         productAccessCheck: @escaping @Sendable () throws -> UInt64 = { 0 }) throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        let path = root.appendingPathComponent("build/cp03-authority/" + productID())
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        directory = try claudeFixtureCanonicalDirectory(path)
        database = directory.appendingPathComponent("journal.sqlite")
        configuration = try ClaudeProductNativeConfiguration(identity: .init(scopeID: UUID(), nativeSessionID: UUID(),
            sessionIncarnation: UUID(), serviceIncarnation: UUID(), ownerConnectionID: UUID(), authorityEpoch: UUID()),
            coreProjectID: "product-core-project", coreSessionID: "claude_session_" + productID(),
            canonicalCWD: directory.path, channelSource: channelSource,
            hookToken: String(repeating: "1", count: 64), bridgeToken: String(repeating: "2", count: 64),
            selectorToken: String(repeating: "3", count: 64))
        authority = try ClaudeSessionAuthority(identity: configuration.identity, clock: clock)
        gate = ProductAuthorityGate(authority)
        codec = ClaudeProductWireCodec(credentialCorpus: corpus)
        switch storage {
        case .sqlite:
            journal = try SQLiteJournal(databaseURL: database, keyURL: directory.appendingPathComponent("storage.key"),
                freshnessStore: ProductAuthorityAnchor(), secretCorpus: corpus,
                appendCommitGate: { [gate] in try gate.commit($0) })
        case .lifecycleMemory:
            journal = ProductLifecycleMemoryJournal(gate: gate)
        }
        if checkRejectedMutationSequence {
            let probe = ProductMutationReadProbe(journal)
            readProbe = probe; journal = probe
        }
        native = try ClaudeNativeSession(productConfiguration: configuration, authority: authority,
            journal: journal, secretCorpus: corpus, clock: clock, wallNow: { [clock] in clock.date() },
            replayPort: replay,
            withCoreMutation: { [meter, journal = journal!, authority, readProbe] id, binding, body in
                try meter.execute(id: id, binding: binding) {
                    let before = try readProbe.map { _ in try journal.load().journalSequence }
                    readProbe?.admit(binding)
                    let result = try body()
                    if let before, try StrictJSONTransport.object(from: result)["ok"] as? Bool == false,
                       try journal.load().journalSequence != before {
                        // Mirror the registry's failed-mutation checkpoint
                        // rule in this isolated single-writer meter fixture.
                        authority.revoke(reason: .serviceReplaced)
                        throw CoordinatorError("fixture_core_mutation_uncertain")
                    }
                    return result
                }
            }, productAccessCheck: productAccessCheck)
        try processTime()
    }
    deinit { native = nil; journal = nil; try? FileManager.default.removeItem(at: directory) }

    func authorityObject() -> [String: Any] {
        let i = configuration.identity
        return ["scope_id": i.scopeID.uuidString.lowercased(), "native_session_id": i.nativeSessionID.uuidString.lowercased(),
            "session_incarnation": i.sessionIncarnation.uuidString.lowercased(), "service_incarnation": i.serviceIncarnation.uuidString.lowercased(),
            "owner_connection_id": i.ownerConnectionID.uuidString.lowercased(), "authority_epoch": i.authorityEpoch.uuidString.lowercased()]
    }
    func envelope(_ operation: String, payload: [String: Any] = [:], role: String = "bridge",
                  identity: [String: Any]? = nil) throws -> ClaudeProductWireCodec.Envelope {
        try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-session.v3", "kind": "request", "provider": "claude",
            "request_id": productID(), "role": role, "operation": operation,
            "authority": identity ?? authorityObject(), "payload": payload,
        ]))
    }
    @discardableResult func call(_ operation: String, _ payload: [String: Any] = [:], role: String = "bridge") throws -> [String: Any] {
        let request = try envelope(operation, payload: payload, role: role)
        return try call(request)
    }
    @discardableResult func call(_ request: ClaudeProductWireCodec.Envelope) throws -> [String: Any] {
        let data = try native.handleProduct(request: request,
            credential: request.role == "hook" ? configuration.hookToken : configuration.bridgeToken)
        let reply = try codec.decodeResponse(data, matching: request,
            connection: .init(serviceIncarnation: configuration.identity.serviceIncarnation,
                              ownerConnectionID: configuration.identity.ownerConnectionID))
        let object = try StrictJSONTransport.object(from: reply.canonicalJSON)
        if !["bridge.poll", "hook.poll", "hook.cancel"].contains(request.operation),
           case .active = authority.snapshot() { try processTime() }
        if object["ok"] as? Bool == false {
            let code = try #require((object["error"] as? [String: Any])?["code"] as? String)
            throw ProductWireRejection(code: code)
        }
        let result = try #require(object["result"] as? [String: Any])
        if request.operation == "hook" {
            let original = try StrictJSONTransport.object(from: request.canonicalJSON)
            if (original["payload"] as? [String: Any])?["event"] as? String == "Stop" {
                waiter = result["waiter"] as? [String: Any]
            }
        }
        return result
    }
    func processTime() throws {
        _ = try native.processProductTime(identity: configuration.identity, credential: configuration.selectorToken)
    }
    @discardableResult func hook(_ event: String, _ extra: [String: Any] = [:]) throws -> [String: Any] {
        var payload: [String: Any] = ["event": event, "native_session_id": configuration.identity.nativeSessionID.uuidString.lowercased(),
            "cwd": directory.path]
        payload.merge(extra) { _, next in next }
        let result = try call("hook", payload, role: "hook")
        boundaryID = result["boundary_id"] as? String
        // Simulate the command Hook receiving its descriptor and starting the
        // immediate first poll. Raw call(envelope) tests can leave it unarmed.
        if event == "Stop", waiter != nil { _ = try waiterRequest("hook.poll") }
        return result
    }
    func startup() throws { try hook("SessionStart", ["source": "startup"]) }
    func prompt() throws {
        let id = productID()
        try hook("UserPromptSubmit", ["prompt_id": id, "prompt_sha256": productDigest("Prepare fixture choices.")])
        promptID = id
    }
    func open() throws {
        let value = try call("bridge.open")["bridge_id"] as? String
        bridgeID = try #require(value)
    }
    @discardableResult func poll() throws -> [String: Any]? { try call("bridge.poll", ["bridge_id": bridgeID!])["event"] as? [String: Any] }
    @discardableResult func ready() throws -> [String: Any] {
        let probe = try call("readiness.begin", ["bridge_id": bridgeID!])
        try call("readiness.ack", ["bridge_id": bridgeID!, "probe_id": probe["probe_id"]!, "nonce": probe["nonce"]!])
        return probe
    }
    func waiterRequest(_ operation: String, waiter supplied: [String: Any]? = nil) throws -> [String: Any] {
        let value = try #require(supplied ?? waiter)
        return try call(operation, ["native_session_id": configuration.identity.nativeSessionID.uuidString.lowercased(),
            "cwd": directory.path, "prompt_id": value["prompt_id"]!, "waiter_generation": value["generation"]!], role: "hook")
    }
    func emit() throws { try call("proposal.emit", ["bridge_id": bridgeID!, "boundary_id": boundaryID!, "proposal": productProposal()]) }
    func snapshot() throws -> [String: Any] {
        try StrictJSONTransport.object(from: native.productSnapshot(identity: configuration.identity, credential: configuration.selectorToken))
    }
    @discardableResult func select(card supplied: [String: Any]? = nil) throws -> [String: Any] {
        let card: [String: Any]
        if let supplied { card = supplied }
        else {
            let snapshot = try snapshot()
            card = try #require((snapshot["cards"] as? [[String: Any]])?.first)
        }
        let object = try #require(card["binding"] as? [String: Any])
        let binding = try CoordinatorBinding(jsonObject: object)
        let packet = try #require(card["packet"] as? [String: Any])
        let choices = try #require(packet["choices"] as? [[String: Any]])
        let packetID = try #require(packet["packet_id"] as? String)
        let revision = try #require(ExactJSONInteger.int64(packet["revision"], minimum: 1))
        let optionID = try #require(choices.first?["option_id"] as? String)
        let result = try StrictJSONTransport.object(from: native.productSelect(identity: configuration.identity,
            credential: configuration.selectorToken, binding: binding, packetID: packetID,
            revision: revision, optionID: optionID, selectionID: UUID()))
        try processTime()
        return result
    }
    @discardableResult func dismiss(card supplied: [String: Any]? = nil) throws -> [String: Any] {
        let card: [String: Any]
        if let supplied { card = supplied }
        else { card = try #require((snapshot()["cards"] as? [[String: Any]])?.first) }
        let binding = try CoordinatorBinding(jsonObject: #require(card["binding"] as? [String: Any]))
        let packet = try #require(card["packet"] as? [String: Any])
        let result = try StrictJSONTransport.object(from: native.productDismiss(identity: configuration.identity,
            credential: configuration.selectorToken, binding: binding,
            interactionID: #require(packet["interaction_id"] as? String),
            packetID: #require(packet["packet_id"] as? String),
            revision: #require(ExactJSONInteger.int64(packet["revision"], minimum: 1))))
        try processTime()
        return result
    }
    @discardableResult func claim(_ event: [String: Any]) throws -> [String: Any] {
        try call("selection.claim", ["bridge_id": bridgeID!, "selection_id": event["selection_id"]!, "delivery_token": event["delivery_token"]!])
    }
    func complete(_ selectionID: String) throws {
        let result = try call("selection.complete", ["bridge_id": bridgeID!, "selection_id": selectionID,
            "outcome": "completed", "note": "The model reports that the fixture was read."])
        #expect(result["reported_by"] as? String == "claude")
    }
    func prepare() throws { try startup(); try prompt(); try open(); try ready(); try emit(); try hook("Stop", ["prompt_id": promptID!, "background_task_ids": [String]()]) }
    func observeSelection(_ event: [String: Any], promptID: String = productID()) throws {
        let text = try productHookText(event)
        try hook("UserPromptSubmit", ["prompt_id": promptID, "prompt_sha256": productDigest(text)])
        self.promptID = promptID
    }
    func selectedEvent(observeNative: Bool = true) throws -> [String: Any] {
        try select()
        let value = try waiterRequest("hook.poll")
        #expect(value["status"] as? String == "delivered")
        let event = try #require(value["event"] as? [String: Any])
        if observeNative { try observeSelection(event) }
        return event
    }
    func rawEventCount() throws -> Int64 {
        if let memory = journal as? ProductLifecycleMemoryJournal { return memory.eventCount }
        var handle: OpaquePointer?
        guard sqlite3_open_v2(database.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw CoordinatorError("fixture_sql_open") }
        defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "SELECT count(*) FROM runtime_events", -1, &statement, nil) == SQLITE_OK else {
            throw CoordinatorError("fixture_sql_prepare")
        }
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw CoordinatorError("fixture_sql_read") }
        return sqlite3_column_int64(statement, 0)
    }
}

func productRejected(_ expected: String? = nil, _ body: () throws -> Void) {
    do { try body(); Issue.record("Expected product authority rejection") }
    catch let error as CoordinatorError { if let expected { #expect(error.code == expected) } }
    catch let error as ClaudeSessionAuthority.AuthorityError {
        if expected != nil { Issue.record("Expected mapped public error, received \(error)") }
    } catch { Issue.record("Unexpected product error type") }
}

func productWireRejected(_ expected: String, _ body: () throws -> Void) {
    do { try body(); Issue.record("Expected a decoded product wire error response") }
    catch let error as ProductWireRejection { #expect(error.code == expected) }
    catch { Issue.record("Product failure did not return a codec-validated error response: \(error)") }
}

private func productRevokeConcurrently(_ authority: ClaudeSessionAuthority) throws {
    let done = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
        authority.revoke(reason: .ownerDisconnected)
        done.signal()
    }
    let completed = done.wait(timeout: .now() + 5) == .success
    #expect(completed, "Owner revocation must not wait for the in-progress native request")
    guard completed else { throw CoordinatorError("fixture_revoke_timeout") }
}

@Suite("Product authority integration")
struct ProductAuthorityIntegrationTests {
    @Test("Product journal and read probe preserve admission after SQLite freshness validation")
    func forwardsLateStorageAdmission() throws {
        let directory = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("blabee-claude-admission-" + productID(), isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let clock = ProductAuthorityClock()
        let anchor = ProductAuthorityAnchor()
        let authority = try ClaudeSessionAuthority(identity: .init(scopeID: UUID(), nativeSessionID: UUID(),
            sessionIncarnation: UUID(), serviceIncarnation: UUID(), ownerConnectionID: UUID(), authorityEpoch: UUID()),
            clock: clock)
        let gate = ProductAuthorityGate(authority)
        let journal = try SQLiteJournal(databaseURL: directory.appendingPathComponent("journal.sqlite"),
            keyURL: directory.appendingPathComponent("storage.key"), freshnessStore: anchor,
            appendCommitGate: { try gate.commit($0) })
        let wrapped: any CoordinatorSemanticJournalPort = ClaudeProductAuthorityJournal(
            journal: ProductMutationReadProbe(journal), authority: authority)
        let before = try journal.load()
        let freshnessBefore = try #require(anchor.load())
        let event = try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "1.0", "kind": "blabee_runtime_event",
            "event_id": "event_product_late_admission", "event_sequence": 1,
            "event_type": "decision_boundary_opened", "event_category": "decision_lifecycle",
            "occurred_at": "2026-08-21T01:00:00Z",
            "project_id": "project_product_admission", "session_id": "session_product_admission",
            "source_turn_id": "turn_product_admission", "source_prompt_id": "prompt_product_admission",
            "episode_id": "episode_product_admission", "episode_root_prompt_id": "prompt_product_admission",
            "episode_baseline_checkpoint_id": "checkpoint_product_admission",
            "decision_boundary_id": "boundary_product_admission", "boundary_sequence": 1,
            "payload": ["proposal_id": "proposal_product_admission"],
        ])
        // This read occurs inside SQLite's transaction. A wrapper that uses the
        // protocol default would check at 0 ns and incorrectly commit afterward.
        anchor.delayNextLoad { clock.advance(1) }
        var admissionTimes: [UInt64] = []
        productRejected("fixture_admission_expired") {
            _ = try wrapped.append(expectedSequence: 0, events: [event], documents: [],
                verificationRecords: [], validateAdmission: {
                    let now = clock.nowNanoseconds()
                    admissionTimes.append(now)
                    guard now < 1_000_000_000 else { throw CoordinatorError("fixture_admission_expired") }
                })
        }
        #expect(admissionTimes == [1_000_000_000])
        #expect(try journal.load() == before)
        #expect(anchor.load() == freshnessBefore)

        _ = try wrapped.append(expectedSequence: 0, events: [event], documents: [],
            verificationRecords: [], validateAdmission: {})
        #expect(try journal.load().journalSequence == 1)
        authority.revoke(reason: .ownerDisconnected)
        productRejected("claude_bridge_unauthorized") {
            _ = try wrapped.append(expectedSequence: 1, events: [event], documents: [],
                verificationRecords: [], validateAdmission: { Issue.record("Unauthorized append reached admission") })
        }
        #expect(try journal.load().journalSequence == 1)
    }

    @Test("Product dismissal retires one ready card without a selection, Channel delivery or model claim")
    func productDismissalNoExecution() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let card = try #require((f.snapshot()["cards"] as? [[String: Any]])?.first)
        let replayCount = f.replay.count
        let result = try f.dismiss(card: card)
        #expect(result["dismissed"] as? Bool == true)
        #expect(f.replay.count == replayCount)
        #expect(try f.poll() == nil)
        #expect((try f.snapshot()["cards"] as? [Any])?.isEmpty == true)
        let state = try CoordinatorSemanticReplay.replay(f.journal.load())
        #expect(state.continuations.isEmpty)
        #expect(state.boundaries.values.allSatisfy { $0.selection == nil && $0.closeReason == "user_dismissed" })
        try f.prompt(); try f.emit()
        try f.hook("Stop", ["prompt_id": f.promptID!, "background_task_ids": [String]()])
        productRejected("claude_session_boundary_mismatch") { try f.dismiss(card: card) }
        #expect((try f.snapshot()["cards"] as? [Any])?.count == 1)
        #expect(try f.poll() == nil)
    }

    @Test("Dismissal rechecks authority before commit and before releasing the receipt", arguments: ["revoked_before", "revoked_at_commit", "expired_at_commit", "revoked_after_commit"])
    func productDismissalAuthorityFence(_ kind: String) throws {
        let f = try ProductAuthorityFixture()
        if kind == "expired_at_commit" { f.clock.advance(3599) }
        try f.prepare()
        let card = try #require((f.snapshot()["cards"] as? [[String: Any]])?.first)
        let before = try f.rawEventCount()
        switch kind {
        case "revoked_before": f.authority.revoke(reason: .ownerDisconnected)
        case "revoked_at_commit":
            f.gate.onNext(before: { [authority = f.authority] in try productRevokeConcurrently(authority) })
        case "expired_at_commit": f.gate.onNext(before: { [clock = f.clock] in clock.advance(1) })
        default: f.gate.onNext(after: { [authority = f.authority] in authority.revoke(reason: .ownerDisconnected) })
        }
        productRejected { try f.dismiss(card: card) }
        #expect(try f.rawEventCount() == before + (kind == "revoked_after_commit" ? 1 : 0))
        if kind == "revoked_at_commit" || kind == "expired_at_commit" {
            // The concrete commit gate deliberately interrupted a prepared
            // freshness transition. Its unchanged raw SQLite event count is
            // the evidence of no commit; normal journal loads must fail closed.
            productRejected("freshness_transition_pending") { _ = try f.journal.load() }
        } else {
            let state = try CoordinatorSemanticReplay.replay(f.journal.load())
            #expect(state.continuations.isEmpty)
            #expect(state.boundaries.values.allSatisfy { $0.selection == nil })
        }
    }

    @Test("A ready cached card cannot be dismissed once its monotonic lifetime ends during service admission")
    func productDismissalRejectsExpiredProjection() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        for step in 1...149 {
            f.clock.advance(4); _ = try f.poll()
            _ = try f.waiterRequest("hook.poll")
            if step == 74 || step == 148 { try f.ready() }
        }
        let snapshot = try f.snapshot()
        #expect(snapshot["selection_enabled"] as? Bool == true)
        let card = try #require((snapshot["cards"] as? [[String: Any]])?.first)
        f.clock.advance(4)
        productRejected("claude_session_stop_required") { try f.dismiss(card: card) }
        let state = try CoordinatorSemanticReplay.replay(f.journal.load())
        #expect(state.continuations.isEmpty)
        #expect(state.boundaries.values.allSatisfy { $0.selection == nil && $0.closeReason != "user_dismissed" })
    }

    @Test("Expiry during dismissal replay refuses without a partial core mutation or incidental authority revocation")
    func productDismissalDelayedExpiryKeepsAuthority() throws {
        let f = try ProductAuthorityFixture(checkRejectedMutationSequence: true)
        try f.prepare()
        for step in 1...149 {
            f.clock.advance(4); _ = try f.poll()
            _ = try f.waiterRequest("hook.poll")
            if step == 74 || step == 148 { try f.ready() }
        }
        let card = try #require((f.snapshot()["cards"] as? [[String: Any]])?.first)
        let before = try f.rawEventCount()
        let mutations = f.meter.count
        f.readProbe?.delayNextBoundMutationLoad { [clock = f.clock] in clock.advance(4) }
        productRejected("interaction_not_waiting") { try f.dismiss(card: card) }
        #expect(try f.rawEventCount() == before)
        #expect(f.meter.count == mutations + 2) // Native refresh, then dismissal validation.
        if case .active = f.authority.snapshot() {} else { Issue.record("Ordinary card expiry revoked product authority") }
        #expect(try f.poll() == nil)
        try f.processTime() // The separately successful scheduler mutation retires the expired card.
        #expect(try f.rawEventCount() > before)
        #expect((try f.snapshot()["cards"] as? [Any])?.isEmpty == true)
        let state = try CoordinatorSemanticReplay.replay(f.journal.load())
        #expect(state.continuations.isEmpty)
        #expect(state.boundaries.values.allSatisfy { $0.selection == nil && $0.expired && $0.closeReason != "user_dismissed" })
        if case .active = f.authority.snapshot() {} else { Issue.record("Expiry cleanup revoked product authority") }
    }

    @Test("Typed first-start metadata must match the fresh product authority and canonical cwd", arguments: ["native_id", "cwd"])
    func initialStartMatchesConfiguration(field: String) throws {
        let f = try ProductAuthorityFixture()
        let initial = ClaudeProductInitialStart(
            nativeSessionID: field == "native_id" ? UUID() : f.configuration.identity.nativeSessionID,
            canonicalCWD: field == "cwd" ? f.directory.path + "/.." : f.directory.path, source: .resume)
        let before = try f.rawEventCount()
        let authority = f.authority.snapshot()
        productRejected("claude_session_configuration_invalid") {
            _ = try ClaudeNativeSession(productConfiguration: f.configuration, authority: f.authority,
                journal: f.journal, secretCorpus: f.corpus, clock: f.clock,
                replayPort: f.replay, withCoreMutation: { _, _, body in try body() }, initialStart: initial)
        }
        #expect(try f.rawEventCount() == before)
        #expect(f.authority.snapshot() == authority)
    }

    @Test("Product start observes a distinct native ID before admitting a core proposal")
    func nativeAndCoreIdentityAreSeparate() throws {
        let f = try ProductAuthorityFixture()
        try f.open()
        productWireRejected("unavailable") {
            try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": productID(), "proposal": productProposal()])
        }
        #expect(f.meter.count == 1)
        try f.startup(); try f.prompt(); try f.emit()
        let cards = try #require(try f.snapshot()["cards"] as? [[String: Any]])
        let binding = try #require(cards.first?["binding"] as? [String: Any])
        #expect(binding["session_id"] as? String == f.configuration.coreSessionID)
        #expect(binding["session_id"] as? String != f.configuration.identity.nativeSessionID.uuidString.lowercased())
    }

    @Test("An invalid inner proposal returns a correlated wire error and preserves the live scope")
    func invalidProposalReturnsWireError() throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.prompt(); try f.open()
        let before = try f.rawEventCount()
        let authority = f.authority.snapshot()
        let invalid: [String: Any] = ["schema_version": "blabee.claude-proposal.v1", "value": ["invalid": true]]
        productWireRejected("invalid_request") {
            try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": f.boundaryID!, "proposal": invalid])
        }
        #expect(try f.rawEventCount() == before)
        #expect(f.authority.snapshot() == authority)
        try f.prompt(); try f.emit()
        #expect((try f.snapshot()["cards"] as? [[String: Any]])?.count == 1)
        productWireRejected("binding_mismatch") {
            try f.call("bridge.poll", ["bridge_id": productID()])
        }
    }

    @Test("Authenticated native owner or cwd transition revokes the old product registration", arguments: ["native_session_id", "cwd"])
    func observedOwnerMismatchRevokes(_ field: String) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let snapshot = try f.snapshot()
        let card = try #require((snapshot["cards"] as? [[String: Any]])?.first)
        let count = try f.rawEventCount()
        let observation = field == "cwd" ? f.directory.deletingLastPathComponent().path : productID()
        var spoof: [String: Any] = ["event": "UserPromptSubmit", "cwd": f.directory.path,
            "native_session_id": f.configuration.identity.nativeSessionID.uuidString.lowercased(),
            "prompt_id": productID(), "prompt_sha256": productDigest("A different native owner.")]
        spoof[field] = observation
        let request = try f.envelope("hook", payload: spoof, role: "hook")
        productRejected("claude_session_forbidden") {
            _ = try f.native.handleProduct(request: request, credential: f.configuration.bridgeToken)
        }
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        productWireRejected("revoked") {
            try f.hook("UserPromptSubmit", [field: observation, "prompt_id": productID(),
                "prompt_sha256": productDigest("A different native owner.")])
        }
        #expect(f.authority.snapshot() == .terminated(.revoked(.sessionEnded)))
        productRejected("claude_session_unauthorized") { try f.select(card: card) }
        #expect(try f.rawEventCount() == count)
    }

    @Test("Trusted unsupported lifecycle source terminates only that product registration", arguments: [false, true])
    func unsupportedSourceTerminatesRegistration(_ claimed: Bool) throws {
        let f = try ProductAuthorityFixture(), independent = try ProductAuthorityFixture()
        try f.prepare(); try independent.prepare()
        let snapshot = try f.snapshot()
        let card = try #require((snapshot["cards"] as? [[String: Any]])?.first)
        var selectionID: String?
        if claimed {
            let event = try f.selectedEvent()
            try f.claim(event)
            selectionID = try #require(event["selection_id"] as? String)
        }
        let count = try f.rawEventCount()
        productWireRejected("revoked") {
            try f.hook("ObservationUnavailable", ["reason": "unsupported_source"])
        }
        #expect(f.authority.snapshot() == .terminated(.revoked(.sessionEnded)))
        productRejected("claude_session_unauthorized") { try f.select(card: card) }
        if let selectionID {
            productRejected("claude_session_unauthorized") { try f.complete(selectionID) }
        }
        productRejected { _ = try f.authority.renew(owner: f.authority.ownerHandle, sequence: 1) }
        #expect(try f.rawEventCount() == count)
        #expect(try independent.snapshot()["selection_enabled"] as? Bool == true)
    }

    @Test("Product heartbeat loss retires the old unclaimed card even after a fresh probe")
    func heartbeatLossRequiresNewObservation() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let before = try f.snapshot()
        let card = try #require((before["cards"] as? [[String: Any]])?.first)
        let authority = f.authority.snapshot()
        f.clock.advance(5)
        _ = try f.poll()
        try f.ready()
        let expired = try f.snapshot()
        #expect(expired["selection_enabled"] as? Bool == false)
        #expect(expired["boundary_id"] is NSNull)
        #expect((expired["cards"] as? [[String: Any]])?.isEmpty == true)
        productRejected("claude_session_boundary_mismatch") { try f.select(card: card) }
        #expect(f.authority.snapshot() == authority)
        try f.prompt(); try f.emit(); try f.hook("Stop", ["prompt_id": f.promptID!, "background_task_ids": [String]()])
        try f.select()
    }

    @Test("Readiness expiry with uninterrupted heartbeat preserves the current card")
    func readinessOnlyExpiryPreservesCard() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let before = try f.snapshot()
        let card = try #require((before["cards"] as? [[String: Any]])?.first)
        let authority = f.authority.snapshot()
        for _ in 0..<76 { f.clock.advance(4); _ = try f.poll(); _ = try f.waiterRequest("hook.poll") }
        let expired = try f.snapshot()
        #expect(expired["ready"] as? Bool == false)
        #expect(expired["boundary_id"] as? String == before["boundary_id"] as? String)
        #expect((expired["cards"] as? [[String: Any]])?.count == 1)
        try f.ready()
        try f.select(card: card)
        #expect(f.authority.snapshot() == authority)
    }

    @Test("Heartbeat loss denies an unclaimed reference but preserves an already claimed report", arguments: [false, true])
    func heartbeatLossSeparatesDeliveryAndReport(_ claimed: Bool) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let event = try f.selectedEvent()
        if claimed { try f.claim(event) }
        f.clock.advance(5)
        _ = try f.poll()
        let snapshot = try f.snapshot()
        #expect(snapshot["ready"] as? Bool == false)
        #expect(snapshot["selection_enabled"] as? Bool == false)
        if claimed {
            try f.complete(event["selection_id"] as! String)
            #expect((try f.snapshot()["outcomes"] as? [[String: Any]])?.count == 1)
        } else {
            productWireRejected("binding_mismatch") { try f.claim(event) }
            #expect((try f.snapshot()["outcomes"] as? [[String: Any]])?.isEmpty == true)
        }
    }

    @Test("Owner renewals keep both auth layers alive for 24 hours without renewing readiness")
    func dayLongOwnerRenewal() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let epoch = f.configuration.identity.authorityEpoch
        for sequence in 1...288 {
            f.clock.advance(300)
            let renewed = try f.authority.renew(owner: f.authority.ownerHandle, sequence: UInt64(sequence))
            #expect(renewed.authorityEpoch == epoch)
            _ = try f.poll()
        }
        let expired = try f.snapshot()
        #expect(expired["ready"] as? Bool == false)
        #expect((expired["cards"] as? [[String: Any]])?.isEmpty == true)
        try f.prompt(); try f.emit()
        #expect((try f.snapshot()["cards"] as? [[String: Any]])?.count == 1)
        guard case .active(let lease) = f.authority.snapshot() else { Issue.record("Renewed authority terminated"); return }
        #expect(lease.renewalSequence == 288)
    }

    @Test("Ready state follows monotonic probe expiry; polling and ACK never renew authority")
    func separateClocksAndReadiness() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let original = f.authority.snapshot()
        f.clock.shiftWall(-86_400)
        _ = try f.poll()
        #expect(try f.snapshot()["ready"] as? Bool == true)
        f.clock.shiftWall(172_800)
        f.clock.advance(299); _ = try f.poll(); try f.ready()
        let deadline = f.authority.snapshot()
        #expect(deadline == original)
        f.clock.advance(300); _ = try f.poll()
        #expect(try f.snapshot()["ready"] as? Bool == false)
        #expect(f.authority.snapshot() == original)
    }

    @Test("Wrong identity fields and role credentials cannot enter metadata", arguments: ["scope_id", "native_session_id", "session_incarnation", "service_incarnation", "owner_connection_id", "authority_epoch"])
    func foreignIdentities(_ field: String) throws {
        let f = try ProductAuthorityFixture()
        var identity = f.authorityObject(); identity[field] = productID()
        let request = try f.envelope("bridge.open", identity: identity)
        productRejected("claude_session_unauthorized") { _ = try f.native.handleProduct(request: request, credential: f.configuration.bridgeToken) }
        let valid = try f.envelope("bridge.open")
        productRejected("claude_session_forbidden") { _ = try f.native.handleProduct(request: valid, credential: f.configuration.hookToken) }
        #expect(f.meter.count == 1)
        try f.open()
    }

    @Test("Renewed authority permits claim and completion beyond the original hour")
    func claimAfterRenewal() throws {
        let f = try ProductAuthorityFixture()
        f.clock.advance(3595)
        _ = try f.authority.renew(owner: f.authority.ownerHandle, sequence: 1)
        try f.prepare()
        let event = try f.selectedEvent()
        f.clock.advance(4)
        _ = try f.poll()
        f.clock.advance(2)
        let claimed = try f.claim(event)
        #expect((claimed["action"] as? [String: Any])?["schema_version"] as? String == "blabee.claude-action.v1")
        let selection = try #require(event["selection_id"] as? String)
        try f.complete(selection)
        let outcomes = try #require(try f.snapshot()["outcomes"] as? [[String: Any]])
        #expect(outcomes.count == 1)
        #expect(outcomes[0]["reported_by"] as? String == "model")
    }

    @Test("Exact lease expiry at actual claim/completion COMMIT refuses the append", arguments: ["claim", "complete"])
    func expiryAtConcreteCommit(_ operation: String) throws {
        let f = try ProductAuthorityFixture()
        f.clock.advance(3599)
        try f.prepare()
        let event = try f.selectedEvent()
        if operation == "complete" { try f.claim(event) }
        let count = try f.rawEventCount()
        f.gate.onNext(before: { [clock = f.clock] in clock.advance(1) })
        productWireRejected("expired") {
            if operation == "claim" { try f.claim(event) }
            else { try f.complete(event["selection_id"] as! String) }
        }
        #expect(try f.rawEventCount() == count)
        #expect(f.authority.snapshot() == .terminated(.expired))
        productRejected { _ = try f.authority.renew(owner: f.authority.ownerHandle, sequence: 1) }
        productRejected("claude_session_unauthorized") { try f.startup() }
    }

    @Test("Owner revoke before claim/completion commit wins without blocking on the native lock", arguments: ["claim", "complete"])
    func ownerRevokeAtCommit(_ operation: String) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let event = try f.selectedEvent()
        if operation == "complete" { try f.claim(event) }
        let count = try f.rawEventCount()
        f.gate.onNext(before: { [authority = f.authority] in try productRevokeConcurrently(authority) })
        productWireRejected("revoked") {
            if operation == "claim" { try f.claim(event) }
            else { try f.complete(event["selection_id"] as! String) }
        }
        #expect(try f.rawEventCount() == count)
        #expect(f.authority.snapshot() == .terminated(.revoked(.ownerDisconnected)))
    }

    @Test("Revocation after a claim commit never releases or replays the action")
    func revokeAfterCommitSuppressesAction() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let event = try f.selectedEvent()
        let before = try f.rawEventCount()
        f.gate.onNext(after: { [authority = f.authority] in authority.revoke(reason: .ownerDisconnected) })
        productWireRejected("revoked") { try f.claim(event) }
        #expect(try f.rawEventCount() > before)
        let after = try f.rawEventCount()
        productRejected("claude_session_unauthorized") { try f.claim(event) }
        #expect(try f.rawEventCount() == after)
    }

    @Test("SessionEnd and unsupported bridge reopen revoke only their own authority")
    func lifecycleIsolation() throws {
        let first = try ProductAuthorityFixture(), second = try ProductAuthorityFixture()
        try first.startup(); try first.open()
        try second.startup(); try second.open()
        try first.hook("SessionEnd")
        productRejected("claude_session_unauthorized") { _ = try first.poll() }
        _ = try second.poll()
        productWireRejected("revoked") { try second.open() }
        productRejected("claude_session_unauthorized") { try second.startup() }
        #expect(first.authority.snapshot() == .terminated(.revoked(.sessionEnded)))
    }

    @Test("Product objects reject legacy wire and inner ingress checks the same terminal authority")
    func explicitProductBoundary() throws {
        let f = try ProductAuthorityFixture()
        let ingress = try ClaudeBridgeIngress(productConfiguration: f.configuration, authority: f.authority,
            journal: f.journal, secretCorpus: f.corpus, clock: f.clock, wallNow: { [clock = f.clock] in clock.date() },
            withCoreMutation: { [meter = f.meter] in try meter.execute(id: $0, binding: $1, body: $2) })
        productRejected("claude_session_invalid_request") { _ = try f.native.handle(payload: Data("{}".utf8)) }
        productRejected("claude_bridge_invalid_request") { _ = try ingress.handle(payload: Data("{}".utf8)) }
        let request = try StrictJSONTransport.data(forJSONObject: ["schema_version": ClaudeCoreAdapter.schemaVersion,
            "request_id": productID(), "operation": "snapshot"])
        _ = try ingress.handleProduct(request: request, identity: f.configuration.identity,
            role: "bridge", credential: f.configuration.bridgeToken)
        f.authority.revoke(reason: .serviceReplaced)
        let calls = f.meter.count
        productRejected("claude_bridge_unauthorized") {
            _ = try ingress.handleProduct(request: request, identity: f.configuration.identity,
                role: "bridge", credential: f.configuration.bridgeToken)
        }
        productRejected("claude_session_unauthorized") { try f.open() }
        #expect(f.meter.count == calls)
    }
}
