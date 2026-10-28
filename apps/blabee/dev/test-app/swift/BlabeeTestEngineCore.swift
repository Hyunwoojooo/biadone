#if BLABEE_TEST_APP
import CoordinatorSwift
import Darwin
import Foundation

/// A report of common Engine verification. Queue acceptance and a durable claim
/// are observations only; neither records provider execution or work completion.
struct BlabeeTestEngineReport: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let kind: String
    let milestone: String
    let profile: String
    let storeID: UUID
    let runID: UUID
    let launchID: UUID
    let engineIdentity: String
    let journalImplementation: String
    let routingImplementation: String
    let operationalImplementation: String
    let freshnessAccount: String
    let eventCount: Int
    let journalSequence: Int64
    let integrityCheck: String
    let quickCheck: String
    let sidecarsVerified: Int
    let fixtureQueueCount: Int
    let durableQueuedCount: Int
    let claimCount: Int
    let providerQueueSubmissionCount: Int
    let providerExecutionCount: Int
    let lastClaimPromptOrigin: String?
}

/// The only next-turn destination assembled by M2. Its messages never leave the
/// Test-owned child. A restart intentionally begins with an empty memory queue.
actor BlabeeTestEngineFixtureQueue {
    private var requests: [CoordinatorNextTurnDispatchRequest] = []

    func record(_ request: CoordinatorNextTurnDispatchRequest) -> CoordinatorNextTurnDispatchReceipt {
        requests.append(request)
        return .init(queuedSubmissionID: "m2_fixture_" + String(requests.count))
    }

    // Also used by protocol fixtures to exercise the actual wrong-session,
    // altered-message and different-turn rejection paths. Never put this on IPC.
    func recordedRequests() -> [CoordinatorNextTurnDispatchRequest] { requests }
}

/// Reuses the common key generator/validator, then reads only its private,
/// regular 32-byte file. This adapter grants no default path or Keychain access.
enum BlabeeTestEngineKeyMaterial {
    static func loadOrCreate(at keyURL: URL, allowCreate: Bool) throws -> Data {
        _ = try ExternalStorageKeyStore.loadOrCreate(at: keyURL, allowCreate: allowCreate)
        let parent = open(keyURL.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parent >= 0 else { throw CoordinatorError("blabee_test_engine_key_invalid") }
        defer { close(parent) }
        let descriptor = openat(parent, keyURL.lastPathComponent, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw CoordinatorError("blabee_test_engine_key_invalid") }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_mode & 0o777 == 0o600,
              info.st_uid == geteuid(), info.st_nlink == 1, info.st_size == 32
        else { throw CoordinatorError("blabee_test_engine_key_invalid") }
        var bytes = [UInt8](repeating: 0, count: 32)
        var offset = 0
        while offset < bytes.count {
            let count = bytes.withUnsafeMutableBytes { buffer in
                read(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            }
            guard count > 0 else { throw CoordinatorError("blabee_test_engine_key_invalid") }
            offset += count
        }
        var extra: UInt8 = 0
        guard read(descriptor, &extra, 1) == 0 else {
            throw CoordinatorError("blabee_test_engine_key_invalid")
        }
        return Data(bytes)
    }
}

/// Test-only composition around the unchanged Swift journal, router and
/// operational actor. No product bootstrap, provider dispatcher or default
/// authority/freshness namespace is reachable from this composition.
actor BlabeeTestEngineCore: CoordinatorOperationalHandling {
    nonisolated let secretCorpus: RuntimeSecretCorpus
    nonisolated let fixtureQueue: BlabeeTestEngineFixtureQueue

    private let paths: BlabeeTestEnginePaths
    private let run: BlabeeTestRunManifest
    private let launchID: UUID
    private let selectorCredential: String
    private let journal: SQLiteJournal
    private let operational: CoordinatorOperationalApplication
    private var controlInProgress = false
    private var lastClaimPromptOrigin: String?
    private var deliveryTurns: [String: String] = [:]

    init(
        paths: BlabeeTestEnginePaths,
        run: BlabeeTestRunManifest,
        freshnessStore: any FreshnessAnchorStore,
        selectorCredential: String,
        launchID: UUID,
        clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
        wallInstantGenerator: CoordinatorOperationalApplication.WallInstantGenerator? = nil
    ) throws {
        let store = try BlabeeTestRunStore(
            rootURL: run.rootURL.deletingLastPathComponent().deletingLastPathComponent()
        )
        try store.validateEngineStorage(for: run, paths: paths)
        let expectedAccount = "test-" + run.runID.uuidString.lowercased()
        guard run.profile == "test", paths.freshnessAccount == expectedAccount,
              freshnessStore.storageSlot == expectedAccount,
              selectorCredential.utf8.count == 64,
              selectorCredential.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        else { throw CoordinatorError("blabee_test_engine_scope_invalid") }
        if let keychain = freshnessStore as? KeychainFreshnessAnchorStore,
           keychain.service != KeychainFreshnessAnchorStore.defaultService {
            throw CoordinatorError("blabee_test_engine_scope_invalid")
        }

        let journal = try SQLiteJournal(databaseURL: paths.databaseURL, keyURL: paths.keyURL,
                                        freshnessStore: freshnessStore)
        let empty = try journal.load().events.isEmpty
        let tokenKey = try BlabeeTestEngineKeyMaterial.loadOrCreate(at: paths.tokenKeyURL, allowCreate: empty)
        let corpus = journal.secretCorpus
        corpus.register(selectorCredential)
        corpus.register(tokenKey)
        corpus.register(tokenKey.base64EncodedString())
        corpus.register(tokenKey.map { String(format: "%02x", $0) }.joined())
        let routing = try CoordinatorRoutingApplication(journal: journal, clock: clock, tokenHMACKey: tokenKey)
        let queue = BlabeeTestEngineFixtureQueue()
        self.paths = paths
        self.run = run
        self.launchID = launchID
        self.selectorCredential = selectorCredential
        self.journal = journal
        self.secretCorpus = corpus
        self.fixtureQueue = queue
        self.operational = CoordinatorOperationalApplication(
            routing: routing,
            enabledProjectPaths: [paths.projectURL.path],
            secretCorpus: corpus,
            wallInstantGenerator: wallInstantGenerator,
            monotonicInstantGenerator: { clock.nowNanoseconds() },
            stopObservationHMACKey: tokenKey,
            nextTurnDispatcher: { request in await queue.record(request) }
        )
        // Initialization does not seed, deliver, claim or restore a memory queue.
    }

    func handle(type: String, payload: Data) async throws -> Data {
        guard !controlInProgress else { throw CoordinatorError("blabee_test_engine_control_in_progress") }
        let object = try scopedObject(payload)
        guard object["blabee_test_engine"] == nil else {
            throw CoordinatorError("blabee_test_engine_control_invalid")
        }
        if let cwd = object["cwd"] as? String, cwd != paths.projectURL.path {
            throw CoordinatorError("blabee_test_engine_project_mismatch")
        }
        return try await operational.handle(type: type, payload: StrictJSONTransport.data(forJSONObject: object))
    }

    /// M2 controls use the existing doctor_status transport route. The product
    /// server allowlist and the common Engine command contract stay unchanged.
    func doctorStatus(payload: Data) async throws -> Data {
        let object = try scopedObject(payload)
        guard Set(object.keys) == ["blabee_test_engine"],
              let control = object["blabee_test_engine"] as? [String: Any],
              Set(control.keys) == ["operation"], let operation = control["operation"] as? String,
              ["report", "seed", "claim"].contains(operation)
        else { throw CoordinatorError("blabee_test_engine_control_invalid") }
        guard !controlInProgress else { throw CoordinatorError("blabee_test_engine_control_in_progress") }
        controlInProgress = true
        defer { controlInProgress = false }
        switch operation {
        case "seed": try await seed()
        case "claim": try await claim()
        default: break
        }
        let result = try await report()
        return try JSONEncoder().encode(result)
    }

    func processTime() async throws -> [Data] { try await operational.processTime() }
    func millisecondsUntilNextDeadline() async -> Int32? { await operational.millisecondsUntilNextDeadline() }

    private func scopedObject(_ data: Data) throws -> [String: Any] {
        var object = try StrictJSONTransport.object(from: data)
        guard let scope = object.removeValue(forKey: "blabee_test_scope") as? [String: Any],
              Set(scope.keys) == ["profile", "store_id", "run_id", "launch_id"],
              scope["profile"] as? String == "test",
              scope["store_id"] as? String == run.storeID.uuidString.lowercased(),
              scope["run_id"] as? String == run.runID.uuidString.lowercased(),
              scope["launch_id"] as? String == launchID.uuidString.lowercased(),
              let token = object.removeValue(forKey: "auth_token") as? String,
              ContinuationTokenMaterial.constantTimeEqual(token, selectorCredential)
        else { throw CoordinatorError("blabee_test_engine_scope_mismatch") }
        return object
    }

    private func seed() async throws {
        guard try journal.load().events.isEmpty else {
            throw CoordinatorError("blabee_test_engine_seed_requires_empty_journal")
        }
        let suffix = run.runID.uuidString.lowercased()
        let cwd = paths.projectURL.path
        let sessionID = "m2_session_" + suffix
        let turnID = "m2_source_turn_" + suffix
        let project = try await invoke("enable_project", ["cwd": cwd])
        guard let projectID = project["project_id"] as? String else {
            throw CoordinatorError("blabee_test_engine_fixture_invalid")
        }
        _ = try await invoke("session_start", ["session_id": sessionID, "cwd": cwd,
                                               "hook_event_name": "SessionStart"])
        let prompt = try await invoke("user_prompt_submit", [
            "session_id": sessionID, "turn_id": turnID, "cwd": cwd,
            "prompt": "Prepare a local M2 Engine fixture. No provider work is requested.",
            "hook_event_name": "UserPromptSubmit",
        ])
        guard let identifiers = prompt["identifiers"] as? [String: Any],
              let promptID = identifiers["source_prompt_id"] as? String,
              let episodeID = identifiers["episode_id"] as? String,
              let context = prompt["additionalContext"] as? String
        else { throw CoordinatorError("blabee_test_engine_fixture_invalid") }
        let correlationToken = try Self.contextValue(context, key: "correlation_token")
        let proposal: [String: Any] = [
            "schema_version": "1.0", "proposal_id": "m2_proposal_" + suffix,
            "correlation_token": correlationToken, "interaction_kind": "blabee_decision",
            "task_goal": "Verify the isolated common Swift Engine",
            "outcome": ["status": "completed", "summary": "TEST · Actual Engine fixture prepared."],
            "next_actions": [
                ["title": "Record an Engine claim", "objective": "Verify a local durable claim",
                 "constraints": ["Keep this fixture inside the Test run"],
                 "done_when": ["One durable claim is recorded"]],
                ["title": "Review the Engine fixture", "objective": "Verify the alternate local claim",
                 "constraints": ["No provider execution"],
                 "done_when": ["One alternate claim is recorded"]],
            ],
            "reported_side_effects": [],
        ]
        _ = try await invoke("get_state", ["schema_version": "1.0", "kind": "blabee_pet_snapshot_request",
                                            "consumer_heartbeat": true])
        _ = try await invoke("emit_decision", [
            "project_id": projectID, "session_id": sessionID, "source_turn_id": turnID,
            "source_prompt_id": promptID, "episode_id": episodeID,
            "correlation_token": correlationToken, "proposal": proposal,
        ])
        _ = try await invoke("stop", ["session_id": sessionID, "turn_id": turnID,
                                      "stop_hook_active": false, "hook_event_name": "Stop",
                                      "last_assistant_message": "TEST · Choose a local Engine fixture."])
    }

    private func claim() async throws {
        guard let request = await fixtureQueue.recordedRequests().last else {
            throw CoordinatorError("blabee_test_engine_no_queued_action")
        }
        let turnID: String
        if let prior = deliveryTurns[request.continuationID] { turnID = prior }
        else {
            turnID = "m2_delivery_" + UUID().uuidString.lowercased()
            deliveryTurns[request.continuationID] = turnID
        }
        let result = try await invoke("user_prompt_submit", [
            "session_id": request.sessionID, "turn_id": turnID, "cwd": paths.projectURL.path,
            "prompt": request.message, "hook_event_name": "UserPromptSubmit",
        ])
        let origin = result["prompt_origin"] as? String
        lastClaimPromptOrigin = ["blabee_next_turn", "blabee_rejected"].contains(origin ?? "") ? origin : nil
    }

    private func report() async throws -> BlabeeTestEngineReport {
        let snapshot = try journal.load()
        let integrity = try journal.integrity()
        let state = try CoordinatorSemanticReplay.replay(snapshot)
        let queueCount = await fixtureQueue.recordedRequests().count
        return BlabeeTestEngineReport(
            schemaVersion: 1, kind: "blabee_test_engine_report", milestone: "M2", profile: "test",
            storeID: run.storeID, runID: run.runID, launchID: launchID,
            engineIdentity: "common_swift_engine", journalImplementation: "SQLiteJournal",
            routingImplementation: "CoordinatorRoutingApplication",
            operationalImplementation: "CoordinatorOperationalApplication", freshnessAccount: paths.freshnessAccount,
            eventCount: snapshot.events.count, journalSequence: snapshot.journalSequence,
            integrityCheck: integrity.integrityCheck, quickCheck: integrity.quickCheck,
            sidecarsVerified: integrity.sidecarsVerified, fixtureQueueCount: queueCount,
            durableQueuedCount: state.continuations.values.filter {
                $0.dispatchMode == "queued_next_turn" && $0.consumedAt != nil && $0.queuedActionContextClaim == nil
            }.count,
            claimCount: state.continuations.values.filter { $0.queuedActionContextClaim != nil }.count,
            providerQueueSubmissionCount: 0, providerExecutionCount: 0,
            lastClaimPromptOrigin: lastClaimPromptOrigin
        )
    }

    private func invoke(_ type: String, _ payload: [String: Any]) async throws -> [String: Any] {
        let data = try await operational.handle(
            type: type, payload: StrictJSONTransport.data(forJSONObject: payload)
        )
        return try StrictJSONTransport.object(from: data)
    }

    private static func contextValue(_ context: String, key: String) throws -> String {
        guard let start = context.range(of: key + "=")?.upperBound else {
            throw CoordinatorError("blabee_test_engine_fixture_invalid")
        }
        let suffix = context[start...]
        let end = suffix.firstIndex(where: { $0 == ";" || $0 == "." }) ?? suffix.endIndex
        let result = String(suffix[..<end])
        guard !result.isEmpty else { throw CoordinatorError("blabee_test_engine_fixture_invalid") }
        return result
    }
}
#endif
