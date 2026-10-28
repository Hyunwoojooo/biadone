#if BLABEE_TEST_APP
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import SQLite3
import Testing
@testable import BlabeeCoordinator

/// Protocol fixture only. These tests do not construct or call a Keychain store.
private final class BlabeeM2MemoryFreshness: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot: String
    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?
    private var loads = 0
    private var failCAS = false

    init(storageSlot: String) { self.storageSlot = storageSlot }

    func load() throws -> FreshnessStoredRecord? {
        lock.lock()
        defer { lock.unlock() }
        loads += 1
        return stored
    }

    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard stored == nil else { throw CoordinatorError("freshness_anchor_conflict") }
        guard record.storageSlot == storageSlot else { throw CoordinatorError("freshness_anchor_corrupt") }
        let created = try FreshnessStoredRecord(record: record, revision: record.revision)
        stored = created
        return created
    }

    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard let current = stored, current.revision == expectedRevision else {
            throw CoordinatorError("freshness_anchor_conflict")
        }
        guard replacement.storageSlot == storageSlot else { throw CoordinatorError("freshness_anchor_corrupt") }
        if failCAS {
            failCAS = false
            throw CoordinatorError("freshness_anchor_conflict")
        }
        let updated = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
        stored = updated
        return updated
    }

    func restore(_ record: FreshnessStoredRecord?) {
        lock.lock()
        stored = record
        lock.unlock()
    }

    func failNextCompareAndSwap() {
        lock.lock()
        failCAS = true
        lock.unlock()
    }

    var loadCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return loads
    }
}

private final class BlabeeM2Clock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var instant: UInt64 = 0

    func nowNanoseconds() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return instant
    }

    func advance(by nanoseconds: UInt64) {
        lock.lock()
        instant += nanoseconds
        lock.unlock()
    }

    func wallInstant() throws -> RFC3339Instant {
        try RFC3339Instant("2026-10-19T00:00:00Z").adding(nanoseconds: nowNanoseconds())
    }
}

private final class BlabeeM2Fixture {
    let parent: URL
    let store: BlabeeTestRunStore
    let run: BlabeeTestRunManifest
    let paths: BlabeeTestEnginePaths
    let freshness: BlabeeM2MemoryFreshness
    let clock = BlabeeM2Clock()
    let selector = String(repeating: "a", count: 64)
    let launchID = UUID()
    let core: BlabeeTestEngineCore

    init() throws {
        parent = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-m2-engine-" + UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        store = try BlabeeTestRunStore(rootURL: parent.appendingPathComponent("test-store", isDirectory: true))
        run = try store.create(scenario: .engineIsolation)
        paths = try store.prepareEngineStorage(for: run)
        freshness = BlabeeM2MemoryFreshness(storageSlot: paths.freshnessAccount)
        let clock = self.clock
        core = try BlabeeTestEngineCore(paths: paths, run: run, freshnessStore: freshness,
                                        selectorCredential: selector, launchID: launchID,
                                        clock: clock, wallInstantGenerator: { try clock.wallInstant() })
    }

    func clean() {
        // All paths came from this fixture's validated run. Keep the shared
        // short socket root/marker and every sibling run intact.
        try? FileManager.default.removeItem(at: paths.socketURL.deletingLastPathComponent())
        try? FileManager.default.removeItem(at: parent)
    }

    var scope: [String: Any] {
        ["profile": "test", "store_id": run.storeID.uuidString.lowercased(),
         "run_id": run.runID.uuidString.lowercased(), "launch_id": launchID.uuidString.lowercased()]
    }

    func payload(_ fields: [String: Any], launchID: UUID? = nil) throws -> Data {
        var object = fields
        var binding = scope
        if let launchID { binding["launch_id"] = launchID.uuidString.lowercased() }
        object["blabee_test_scope"] = binding
        object["auth_token"] = selector
        return try StrictJSONTransport.data(forJSONObject: object)
    }

    func request(_ type: String, _ fields: [String: Any] = [:]) async throws -> Data {
        try await core.handle(type: type, payload: payload(fields))
    }

    func control(_ operation: String, core replacement: BlabeeTestEngineCore? = nil,
                 launchID: UUID? = nil) async throws -> BlabeeTestEngineReport {
        let data = try await (replacement ?? core).doctorStatus(payload: payload(
            ["blabee_test_engine": ["operation": operation]], launchID: launchID
        ))
        return try JSONDecoder().decode(BlabeeTestEngineReport.self, from: data)
    }

    func snapshot() async throws -> PetSnapshot {
        let data = try await request("get_state")
        return try PetSnapshot.parse(data)
    }

    func select() async throws -> CoordinatorNextTurnDispatchRequest {
        _ = try await control("seed")
        let card = try #require(await snapshot().interactions.first)
        let choice = try #require(card.actionChoices.first)
        _ = try await request("focus_interaction", PetFocusRequest(identity: card.identity).jsonObject)
        let selection = try PetSelectionRequest(identity: card.identity,
                                                selectionID: "m2_test_selection", optionID: choice.optionID)
        _ = try await request("select", selection.jsonObject)
        return try #require(await core.fixtureQueue.recordedRequests().first)
    }

    func delivery(_ request: CoordinatorNextTurnDispatchRequest, sessionID: String? = nil,
                  turnID: String = "m2_test_delivery", message: String? = nil) async throws -> [String: Any] {
        let data = try await self.request("user_prompt_submit", [
            "session_id": sessionID ?? request.sessionID, "turn_id": turnID,
            "cwd": paths.projectURL.path, "prompt": message ?? request.message,
            "hook_event_name": "UserPromptSubmit",
        ])
        return try StrictJSONTransport.object(from: data)
    }
}

private func blabeeM2ExpectCode(_ code: String, _ operation: () async throws -> Void) async {
    do {
        try await operation()
        Issue.record("Expected Engine error \(code)")
    } catch let error as CoordinatorError {
        #expect(error.code == code)
    } catch {
        Issue.record("Unexpected non-Engine error while expecting \(code)")
    }
}

@Suite("Blabee Test M2 common Engine (SQLite and protocol fixtures; no Keychain)", .serialized)
struct BlabeeTestEngineTests {
    @MainActor
    @Test("A failed CLI check reports delayed cleanup and holds its run lease until child exit")
    func checkCleanupRetainsLease() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        let lease = try fixture.store.acquireLease(for: fixture.run)
        let child = BlabeeM2UIChild(credential: fixture.selector)
        child.allowsStop = false
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run,
            dependencies: .init(executable: { fixture.parent.appendingPathComponent("unused-test-executable") },
                selectorKey: { _, _ in Data(repeating: 0xaa, count: 32) }, spawn: { _ in child }))
        _ = try session.start()
        var pendingReports = 0
        var waitCount = 0
        let cleanup = await drainBlabeeTestEngineCheck(session: session, lease: lease, onPendingCleanup: { code in
            #expect(code == "test_engine_shutdown_timeout")
            #expect(child.isRunning && session.ownedChild != nil && !session.isActive)
            #expect(throws: BlabeeTestRunStoreError.runInUse) { try fixture.store.acquireLease(for: fixture.run) }
            pendingReports += 1
        }, wait: {
            #expect(throws: BlabeeTestRunStoreError.runInUse) { try fixture.store.acquireLease(for: fixture.run) }
            waitCount += 1
            if waitCount == 2 { child.isRunning = false }
        })
        #expect(cleanup == "test_engine_shutdown_timeout" && pendingReports == 1 && waitCount == 2)
        #expect(session.ownedChild == nil && !child.isRunning)
        let replacementLease = try fixture.store.acquireLease(for: fixture.run)
        replacementLease.release()
    }

    @MainActor
    @Test("A failed old Engine report cannot publish an error after a new run starts")
    func lateReportFailureIsFenced() async throws {
        let fixture = try BlabeeM2Fixture()
        let relay = BlabeeM2CoreRelay(core: fixture.core)
        let child = BlabeeM2UIChild(credential: fixture.selector)
        let gate = BlabeeM2ReportGate()
        let controller = try BlabeeTestWorkspaceController(store: fixture.store,
            makeComposition: { store, run in
                if !run.scenario.usesRealEngine { return try BlabeeTestComposition(store: store, run: run, applyTheme: { _ in }) }
                return try BlabeeTestComposition(store: store, run: run, applyTheme: { _ in },
                    makeEngineSession: { store, run in
                        try BlabeeTestEngineSession(store: store, run: run, launchID: fixture.launchID,
                            dependencies: .init(executable: { fixture.parent.appendingPathComponent("unused-test-executable") },
                                selectorKey: { _, _ in Data(repeating: 0xaa, count: 32) },
                                spawn: { _ in child }, request: { try relay.send($0) }))
                    })
            }, readEngineReport: { _ in try await gate.pause() })
        await controller.resume(fixture.run)
        #expect(controller.isRunActive)
        let report = Task { await controller.saveResult() }
        for _ in 0..<500 { if gate.entered { break }; await Task.yield() }
        #expect(gate.entered)
        await controller.startNew(scenario: .freshInstall)
        gate.fail()
        await report.value
        #expect(controller.isRunActive && controller.run?.runID != fixture.run.runID)
        #expect(controller.errorMessage == nil && controller.resultMessage == nil && controller.engineReport == nil)
        let ownedSuites = controller.availableRuns.map(\.defaultsSuiteName)
        #expect(await controller.shutdown())
        for name in ownedSuites { UserDefaults(suiteName: name)?.removePersistentDomain(forName: name) }
        fixture.clean()
    }

    @MainActor
    @Test("M2 UI access follows its generated child selector and selects through the actual Engine")
    func realEngineUISelection() async throws {
        let fixture = try BlabeeM2Fixture()
        let selector = String(repeating: "2a", count: 32)
        let core = try BlabeeTestEngineCore(paths: fixture.paths, run: fixture.run,
            freshnessStore: fixture.freshness, selectorCredential: selector, launchID: fixture.launchID)
        let relay = BlabeeM2CoreRelay(core: core)
        let child = BlabeeM2UIChild(credential: selector)
        let composition = try BlabeeTestComposition(store: fixture.store, run: fixture.run, applyTheme: { _ in },
            makeEngineSession: { store, run in
                try BlabeeTestEngineSession(store: store, run: run, launchID: fixture.launchID,
                    dependencies: .init(executable: { fixture.parent.appendingPathComponent("unused-test-executable") },
                        selectorKey: { _, _ in Data(repeating: 0x2a, count: 32) },
                        spawn: { _ in child }, request: { try relay.send($0) }))
            })
        do {
            await composition.activate()
            for _ in 0..<500 {
                if composition.viewModel.productAccessAllowsActions { break }
                await Task.yield()
            }
            #expect(composition.viewModel.productAccessAllowsActions)
            _ = try await composition.engineSession?.seed()
            composition.viewModel.endFirstRunSetup()
            composition.viewModel.setPanelVisible(true)
            await composition.viewModel.refresh()
            let card = try #require(composition.viewModel.displayInteraction)
            #expect(composition.viewModel.canRequestPanelSelection(card.identity))
            await composition.viewModel.requestPanelSelection(1)
            let queued = try #require(try await composition.engineSession?.report())
            #expect(queued.fixtureQueueCount == 1 && queued.claimCount == 0)
            let claimed = try #require(try await composition.engineSession?.claim())
            #expect(claimed.claimCount == 1 && claimed.providerExecutionCount == 0)
            #expect(claimed.lastClaimPromptOrigin == "blabee_next_turn")
            try await composition.drain()
            #expect(!child.isRunning)
            UserDefaults(suiteName: fixture.run.defaultsSuiteName)?.removePersistentDomain(forName: fixture.run.defaultsSuiteName)
            fixture.clean()
        } catch {
            try? await composition.drain()
            UserDefaults(suiteName: fixture.run.defaultsSuiteName)?.removePersistentDomain(forName: fixture.run.defaultsSuiteName)
            fixture.clean()
            throw error
        }
    }

    @Test("Only explicit controls seed and claim; exact retry records one durable claim")
    func explicitLifecycle() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        let initial = try await fixture.control("report")
        #expect(initial.eventCount == 0 && initial.fixtureQueueCount == 0 && initial.claimCount == 0)
        #expect(initial.engineIdentity == "common_swift_engine")
        #expect(initial.journalImplementation == "SQLiteJournal")
        #expect(initial.routingImplementation == "CoordinatorRoutingApplication")
        #expect(initial.operationalImplementation == "CoordinatorOperationalApplication")
        let queued = try await fixture.select()
        let selected = try await fixture.control("report")
        #expect(selected.eventCount > 0 && selected.journalSequence == Int64(selected.eventCount))
        #expect(selected.integrityCheck == "ok" && selected.quickCheck == "ok")
        #expect(selected.sidecarsVerified > 0)
        #expect(selected.fixtureQueueCount == 1 && selected.durableQueuedCount == 1 && selected.claimCount == 0)
        await blabeeM2ExpectCode("blabee_test_engine_seed_requires_empty_journal") {
            _ = try await fixture.control("seed")
        }
        let claimed = try await fixture.control("claim")
        let retried = try await fixture.control("claim")
        #expect(claimed == retried)
        #expect(claimed.claimCount == 1 && claimed.durableQueuedCount == 0)
        #expect(claimed.lastClaimPromptOrigin == "blabee_next_turn")
        #expect(claimed.fixtureQueueCount == 1)
        #expect(claimed.providerExecutionCount == 0 && claimed.providerQueueSubmissionCount == 0)
        let reportData = try JSONEncoder().encode(claimed)
        #expect(!reportData.contains(Data(fixture.selector.utf8)))
        #expect(!reportData.contains(Data(queued.message.utf8)))
        #expect(!reportData.contains(Data("ref=".utf8)))
        #expect(!reportData.contains(Data("correlation_token".utf8)))
        #expect(!reportData.contains(Data("continuation_token".utf8)))
        #expect(!reportData.contains(try Data(contentsOf: fixture.paths.keyURL)))
        #expect(!reportData.contains(try Data(contentsOf: fixture.paths.tokenKeyURL)))
    }

    @Test("Profile, store, run, launch, and selector mismatches fail before Engine mutation")
    func scopeFences() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        for key in ["profile", "store_id", "run_id", "launch_id", "auth_token", "missing_scope"] {
            var object = try StrictJSONTransport.object(from: fixture.payload([:]))
            if key == "auth_token" { object[key] = String(repeating: "b", count: 64) }
            else if key == "missing_scope" { object.removeValue(forKey: "blabee_test_scope") }
            else {
                var scope = fixture.scope
                scope[key] = key == "profile" ? "blabee" : UUID().uuidString.lowercased()
                object["blabee_test_scope"] = scope
            }
            let payload = try StrictJSONTransport.data(forJSONObject: object)
            await blabeeM2ExpectCode("blabee_test_engine_scope_mismatch") {
                _ = try await fixture.core.handle(type: "enable_project", payload: payload)
            }
            await blabeeM2ExpectCode("blabee_test_engine_scope_mismatch") {
                _ = try await fixture.core.doctorStatus(payload: payload)
            }
        }
        #expect(try await fixture.control("report").eventCount == 0)
    }

    @Test("A primary or other run's freshness slot is rejected without even loading it",
          arguments: ["primary", "test-00000000-0000-0000-0000-000000000000"])
    func rejectFreshnessSlot(slot: String) throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        let wrong = BlabeeM2MemoryFreshness(storageSlot: slot)
        do {
            _ = try BlabeeTestEngineCore(paths: fixture.paths, run: fixture.run, freshnessStore: wrong,
                                        selectorCredential: fixture.selector, launchID: UUID())
            Issue.record("Expected mismatched freshness scope to fail")
        } catch let error as CoordinatorError {
            #expect(error.code == "blabee_test_engine_scope_invalid")
        }
        #expect(wrong.loadCount == 0)
    }

    @Test("The actual claim handler rejects cross-session, altered-message, and cross-run references")
    func queuedReferenceFences() async throws {
        let first = try BlabeeM2Fixture()
        defer { first.clean() }
        let second = try BlabeeM2Fixture()
        defer { second.clean() }
        let queued = try await first.select()
        let crossSession = try await first.delivery(queued, sessionID: "m2_other_session")
        #expect(crossSession["prompt_origin"] as? String == "blabee_rejected")
        let edited = try await first.delivery(queued, turnID: "m2_edited_turn", message: queued.message + " edited")
        #expect(edited["prompt_origin"] as? String == "blabee_rejected")
        let crossRun = try await second.delivery(queued)
        #expect(crossRun["prompt_origin"] as? String == "blabee_rejected")
        #expect(try await first.control("report").claimCount == 0)
        #expect(try await second.control("report").claimCount == 0)
        #expect(try await first.control("claim").claimCount == 1)
        #expect(try await second.control("report").providerExecutionCount == 0)
    }

    @Test("A claimed reference cannot claim another delivery turn")
    func rejectDifferentDeliveryTurn() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        let queued = try await fixture.select()
        let claimed = try await fixture.control("claim")
        let replay = try await fixture.delivery(queued, turnID: "m2_another_delivery_turn")
        #expect(replay["prompt_origin"] as? String == "blabee_rejected")
        #expect(!(replay["additionalContext"] as? String ?? "").contains("Record an Engine claim"))
        let report = try await fixture.control("report")
        #expect(report.claimCount == 1 && report.eventCount == claimed.eventCount)
    }

    @Test("Stale packet revision and mismatched turn/session never dispatch")
    func selectionFences() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        _ = try await fixture.control("seed")
        let card = try #require(await fixture.snapshot().interactions.first)
        let choice = try #require(card.actionChoices.first)
        _ = try await fixture.request("focus_interaction", PetFocusRequest(identity: card.identity).jsonObject)
        let selection = try PetSelectionRequest(identity: card.identity,
                                                selectionID: "m2_stale_selection", optionID: choice.optionID)
        let before = try await fixture.control("report")
        for key in ["revision", "session_id", "source_turn_id"] {
            var altered = selection.jsonObject
            if key == "revision" { altered[key] = card.identity.revision + 1 }
            else { altered[key] = "m2_wrong_binding" }
            await blabeeM2ExpectCode("selection_binding_mismatch") {
                _ = try await fixture.request("select", altered)
            }
        }
        let after = try await fixture.control("report")
        #expect(after.eventCount == before.eventCount && after.fixtureQueueCount == 0 && after.claimCount == 0)
    }

    @Test("The actual routing deadline expires authority before a selection can queue")
    func expiredCardCannotDispatch() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        _ = try await fixture.control("seed")
        let card = try #require(await fixture.snapshot().interactions.first)
        let choice = try #require(card.actionChoices.first)
        _ = try await fixture.request("focus_interaction", PetFocusRequest(identity: card.identity).jsonObject)
        let selection = try PetSelectionRequest(identity: card.identity,
                                                selectionID: "m2_expired_selection", optionID: choice.optionID)
        fixture.clock.advance(by: CoordinatorRoutingApplication.expiryAfterNanoseconds)
        _ = try await fixture.core.processTime()
        await blabeeM2ExpectCode("interaction_not_waiting") {
            _ = try await fixture.request("select", selection.jsonObject)
        }
        let report = try await fixture.control("report")
        #expect(report.fixtureQueueCount == 0 && report.claimCount == 0 && report.providerExecutionCount == 0)
    }

    @Test("Restart preserves durable history but never seeds, restores a queue, or claims")
    func restartDoesNotReplay() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        _ = try await fixture.select()
        let before = try await fixture.control("report")
        let launchID = UUID()
        let clock = fixture.clock
        let reopened = try BlabeeTestEngineCore(paths: fixture.paths, run: fixture.run,
            freshnessStore: fixture.freshness, selectorCredential: fixture.selector,
            launchID: launchID, clock: clock, wallInstantGenerator: { try clock.wallInstant() })
        let after = try await fixture.control("report", core: reopened, launchID: launchID)
        #expect(after.eventCount == before.eventCount && after.durableQueuedCount == 1)
        #expect(after.fixtureQueueCount == 0 && after.claimCount == 0 && after.providerExecutionCount == 0)
        await blabeeM2ExpectCode("blabee_test_engine_seed_requires_empty_journal") {
            _ = try await fixture.control("seed", core: reopened, launchID: launchID)
        }
        await blabeeM2ExpectCode("blabee_test_engine_no_queued_action") {
            _ = try await fixture.control("claim", core: reopened, launchID: launchID)
        }
        await blabeeM2ExpectCode("blabee_test_engine_scope_mismatch") {
            _ = try await reopened.handle(type: "get_state", payload: fixture.payload([:]))
        }
    }

    @Test("Copying another run's storage key cannot reopen a journal")
    func copiedKeyIsRejected() throws {
        let first = try BlabeeM2Fixture()
        defer { first.clean() }
        let second = try BlabeeM2Fixture()
        defer { second.clean() }
        try Data(contentsOf: first.paths.keyURL).write(to: second.paths.keyURL)
        #expect(chmod(second.paths.keyURL.path, 0o600) == 0)
        do {
            _ = try BlabeeTestEngineCore(paths: second.paths, run: second.run,
                freshnessStore: second.freshness, selectorCredential: second.selector, launchID: UUID())
            Issue.record("Expected copied storage key to fail")
        } catch let error as CoordinatorError {
            #expect(error.code == "storage_key_invalid")
        }
    }

    @Test("Journal reports fail closed on missing or rolled-back freshness", arguments: [false, true])
    func freshnessRollbackIsRejected(missing: Bool) async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        let initial = try #require(try fixture.freshness.load())
        _ = try await fixture.control("seed")
        fixture.freshness.restore(missing ? nil : initial)
        await blabeeM2ExpectCode(missing ? "freshness_anchor_missing" : "freshness_rollback_detected") {
            _ = try await fixture.control("report")
        }
    }

    @Test("A failed freshness CAS cannot silently become a successful fixture")
    func compareAndSwapFailureIsNotSuccess() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        fixture.freshness.failNextCompareAndSwap()
        await blabeeM2ExpectCode("freshness_anchor_conflict") {
            _ = try await fixture.control("seed")
        }
        let report = try await fixture.control("report")
        #expect(report.eventCount == 0 && report.fixtureQueueCount == 0 && report.claimCount == 0)
        #expect(report.integrityCheck == "ok" && report.providerExecutionCount == 0)
    }

    @Test("A second actual journal rejects a stale writer sequence")
    func competingWriterCannotUseStaleSequence() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        _ = try await fixture.control("seed")
        let writer = try SQLiteJournal(databaseURL: fixture.paths.databaseURL, keyURL: fixture.paths.keyURL,
                                        freshnessStore: fixture.freshness)
        let snapshot = try writer.load()
        let event = try #require(snapshot.events.first)
        do {
            _ = try writer.append(expectedSequence: 0, events: [event])
            Issue.record("Expected stale journal sequence to fail")
        } catch let error as CoordinatorError {
            #expect(error.code == "journal_sequence_conflict")
        }
        #expect(try writer.load().journalSequence == snapshot.journalSequence)
        #expect(try await fixture.control("report").journalSequence == snapshot.journalSequence)
    }

    @Test("Reports validate actual event MACs after a separate SQLite writer tampers with them")
    func eventMACTamperingIsRejected() async throws {
        let fixture = try BlabeeM2Fixture()
        defer { fixture.clean() }
        _ = try await fixture.control("seed")
        var database: OpaquePointer?
        #expect(sqlite3_open_v2(fixture.paths.databaseURL.path, &database, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK)
        let opened = try #require(database)
        defer { sqlite3_close_v2(opened) }
        #expect(sqlite3_exec(opened, "UPDATE runtime_events SET mac=zeroblob(32) WHERE event_sequence=1", nil, nil, nil) == SQLITE_OK)
        await blabeeM2ExpectCode("runtime_event_integrity_mismatch") {
            _ = try await fixture.control("report")
        }
    }
}
@MainActor
private final class BlabeeM2UIChild: AppOwnedServiceChild {
    let credential: String
    var isRunning = true
    var allowsStop = true
    var hasPublishedService: Bool { isRunning }
    var terminationSummary: String? { nil }
    var petSelectorCredential: String? { credential }
    init(credential: String) { self.credential = credential }
    func stop() async { if allowsStop { isRunning = false } }
}

@MainActor
private final class BlabeeM2ReportGate {
    private var continuation: CheckedContinuation<BlabeeTestEngineReport, any Error>?
    private(set) var entered = false
    func pause() async throws -> BlabeeTestEngineReport {
        try await withCheckedThrowingContinuation { continuation in
            entered = true
            self.continuation = continuation
        }
    }
    func fail() {
        let pending = continuation
        continuation = nil
        pending?.resume(throwing: CoordinatorError("m2_expected_old_report_failure"))
    }
}

/// The session invokes this only on its dedicated blocking-I/O Dispatch worker.
/// No socket, child process or Keychain is used by this UI regression.
private final class BlabeeM2CoreRelay: @unchecked Sendable {
    let core: BlabeeTestEngineCore
    init(core: BlabeeTestEngineCore) { self.core = core }
    func send(_ request: BlabeeTestEngineRequest) throws -> Data {
        let payload = try StrictJSONTransport.data(forJSONObject: request.authenticatedPayload())
        let result = BlabeeM2RelayResult()
        let semaphore = DispatchSemaphore(value: 0)
        let task = Task {
            do {
                let bytes = request.type == "doctor_status"
                    ? try await core.doctorStatus(payload: payload)
                    : try await core.handle(type: request.type, payload: payload)
                result.store(.success(bytes))
            } catch { result.store(.failure(error)) }
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + .seconds(5)) == .success else {
            task.cancel()
            throw CoordinatorError("m2_test_relay_timeout")
        }
        return try result.load().get()
    }
}

private final class BlabeeM2RelayResult: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Result<Data, any Error>?
    func store(_ result: Result<Data, any Error>) { lock.withLock { value = result } }
    func load() -> Result<Data, any Error> {
        lock.withLock { value ?? .failure(CoordinatorError("m2_test_relay_missing_result")) }
    }
}
#endif
