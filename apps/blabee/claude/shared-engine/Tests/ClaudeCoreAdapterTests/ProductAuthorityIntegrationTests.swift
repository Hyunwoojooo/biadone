import ClaudeCoreAdapter
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

func productID() -> String { UUID().uuidString.lowercased() }
func productDigest(_ text: String) -> String {
    SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
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
    var native: ClaudeNativeSession!
    var bridgeID: String?
    var boundaryID: String?
    var promptID: String?

    init(storage: Storage = .sqlite) throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        directory = root.appendingPathComponent("build/cp03-authority/" + productID())
            .standardizedFileURL.resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        database = directory.appendingPathComponent("journal.sqlite")
        configuration = try ClaudeProductNativeConfiguration(identity: .init(scopeID: UUID(), nativeSessionID: UUID(),
            sessionIncarnation: UUID(), serviceIncarnation: UUID(), ownerConnectionID: UUID(), authorityEpoch: UUID()),
            coreProjectID: "product-core-project", coreSessionID: "claude_session_" + productID(),
            canonicalCWD: directory.path, channelSource: "blabee-claude",
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
        native = try ClaudeNativeSession(productConfiguration: configuration, authority: authority,
            journal: journal, secretCorpus: corpus, clock: clock, wallNow: { [clock] in clock.date() },
            replayPort: replay,
            withCoreMutation: { [meter] in try meter.execute(id: $0, binding: $1, body: $2) })
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
            "schema_version": "blabee.claude-session.v2", "kind": "request", "provider": "claude",
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
        if request.operation != "bridge.poll", case .active = authority.snapshot() { try processTime() }
        if object["ok"] as? Bool == false {
            let code = try #require((object["error"] as? [String: Any])?["code"] as? String)
            throw ProductWireRejection(code: code)
        }
        let result = try #require(object["result"] as? [String: Any])
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
        let value = try poll()
        let event = try #require(value)
        try call("readiness.ack", ["bridge_id": bridgeID!, "probe_id": event["probe_id"]!, "nonce": event["nonce"]!])
        return probe
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
    @discardableResult func claim(_ event: [String: Any]) throws -> [String: Any] {
        try call("selection.claim", ["bridge_id": bridgeID!, "selection_id": event["selection_id"]!, "delivery_token": event["delivery_token"]!])
    }
    func complete(_ selectionID: String) throws {
        let result = try call("selection.complete", ["bridge_id": bridgeID!, "selection_id": selectionID,
            "outcome": "completed", "note": "The model reports that the fixture was read."])
        #expect(result["reported_by"] as? String == "claude")
    }
    func prepare() throws { try startup(); try prompt(); try open(); try ready(); try emit(); try hook("Stop", ["prompt_id": promptID!, "background_task_ids": [String]()]) }
    func selectedEvent() throws -> [String: Any] {
        try select()
        let value = try poll()
        return try #require(value)
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
        for _ in 0..<76 { f.clock.advance(4); _ = try f.poll() }
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
        try f.prepare()
        let event = try f.selectedEvent()
        f.clock.advance(4)
        _ = try f.authority.renew(owner: f.authority.ownerHandle, sequence: 1)
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
