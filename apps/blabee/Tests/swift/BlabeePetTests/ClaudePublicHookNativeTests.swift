#if BLABEE_JOURNAL_TEST_HARNESS
import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

private final class PublicHookNativeFreshness: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot: String
    private let lock = NSLock()
    private var value: FreshnessStoredRecord?
    init(_ slot: String) { storageSlot = slot }
    func load() throws -> FreshnessStoredRecord? { lock.withLock { value } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard value == nil else { throw CoordinatorError("native_fixture_anchor_conflict") }
            let next = try FreshnessStoredRecord(record: record, revision: record.revision)
            value = next
            return next
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard value?.revision == expectedRevision else { throw CoordinatorError("native_fixture_anchor_conflict") }
            let next = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            value = next
            return next
        }
    }
}

private struct PublicHookNativeCodexStub: CoordinatorOperationalHandling {
    func handle(type: String, payload: Data) async throws -> Data { throw CoordinatorError("native_fixture_unexpected_route") }
    func doctorStatus(payload: Data) async throws -> Data { Data("{}".utf8) }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
}

/// Observes the real product endpoint. No Hook, readiness, delivery, claim, or
/// completion request is fabricated by the fixture. Sensitive IDs stay in RAM.
private final class PublicHookNativeAudit: CoordinatorOperationalHandling, @unchecked Sendable {
    struct Snapshot: Sendable {
        var attempts: [String: Int] = [:]
        var successes: [String: Int] = [:]
        var prompts: [String: Int] = [:]
        var packets: [String] = []
        var claims: [String] = []
        var completions: [String] = []
        var deliveries = 0
        var completedStops = 0
        var cancelledStops = 0
        var sameSession = true
        var exactSelection = true
        var selectedAction = false
        var newPromptClaim = true
        var completionMarker = false
        var json: [String: Any] {
            ["attempts": attempts, "successes": successes, "accepted_prompts": prompts,
             "emitted_packet_count": packets.count, "delivery_count": deliveries,
             "claim_count": claims.count, "unique_claim_count": Set(claims).count,
             "completion_count": completions.count, "unique_completion_count": Set(completions).count,
             "stops_after_completion": completedStops, "stops_after_cancel": cancelledStops,
             "same_native_session": sameSession, "exact_selected_reference": exactSelection,
             "claim_uses_verified_new_prompt": newPromptClaim, "selected_action_matches": selectedAction,
             "completion_note_marker": completionMarker]
        }
    }
    let application: ClaudeProductServiceCoordinator
    private let lock = NSLock()
    private var value = Snapshot()
    private var nativeSessionID: String?
    private var selectedID: String?
    private var promptHashes: [String: String] = [:]
    private var promptIDs: [String: String] = [:]
    init(_ application: ClaudeProductServiceCoordinator) { self.application = application }
    func configure(nativeSessionID: UUID, prompts: [String: String]) {
        lock.withLock {
            self.nativeSessionID = nativeSessionID.uuidString.lowercased()
            promptHashes = Dictionary(uniqueKeysWithValues: prompts.map { name, prompt in
                (SHA256.hash(data: Data(prompt.utf8)).map { String(format: "%02x", $0) }.joined(), name)
            })
        }
    }
    func select(_ id: String) { lock.withLock { selectedID = id } }
    var snapshot: Snapshot { lock.withLock { value } }
    func handle(type: String, payload: Data) async throws -> Data {
        let result = try await application.handle(type: type, payload: payload)
        guard type == "claude_session_v2",
              let request = try? StrictJSONTransport.object(from: payload),
              let envelope = request["envelope"] as? [String: Any],
              let response = try? StrictJSONTransport.object(from: result) else { return result }
        lock.withLock {
            let operation = envelope["operation"] as? String ?? "unknown"
            let fields = envelope["payload"] as? [String: Any] ?? [:]
            let event = fields["event"] as? String ?? "unknown"
            let known = ["bridge.open", "bridge.close", "bridge.poll", "readiness.begin", "readiness.ack",
                         "proposal.emit", "selection.claim", "selection.complete", "hook", "hook.poll"]
            let label = operation == "hook" && ["SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SessionEnd"].contains(event)
                ? "hook." + event : (known.contains(operation) ? operation : "unknown")
            value.attempts[label, default: 0] += 1
            let authority = envelope["authority"] as? [String: Any]
            value.sameSession = value.sameSession && (authority?["native_session_id"] as? String) == nativeSessionID
            if operation == "hook" || operation == "hook.poll" {
                value.sameSession = value.sameSession && (fields["native_session_id"] as? String) == nativeSessionID
            }
            guard response["ok"] as? Bool == true, let reply = response["result"] as? [String: Any] else { return }
            value.successes[label, default: 0] += 1
            if operation == "hook", reply["observation_status"] as? String == "accepted" {
                if event == "UserPromptSubmit" {
                    let name = promptHashes[fields["prompt_sha256"] as? String ?? ""] ?? "rewake"
                    value.prompts[name, default: 0] += 1
                    promptIDs[name] = fields["prompt_id"] as? String
                } else if event == "Stop" {
                    if !value.completions.isEmpty { value.completedStops += 1 }
                    if value.prompts["cancel"] == 1 { value.cancelledStops += 1 }
                }
            }
            if operation == "proposal.emit", let packet = reply["packet_id"] as? String { value.packets.append(packet) }
            if operation == "hook.poll", reply["status"] as? String == "delivered" {
                value.deliveries += 1
                value.exactSelection = value.exactSelection && ((reply["event"] as? [String: Any])?["selection_id"] as? String) == selectedID
            }
            if operation == "selection.claim", let id = reply["selection_id"] as? String {
                value.claims.append(id)
                value.exactSelection = value.exactSelection && id == selectedID
                value.newPromptClaim = value.newPromptClaim && promptIDs["rewake"] != nil
                    && (reply["prompt_id"] as? String) == promptIDs["rewake"] && promptIDs["rewake"] != promptIDs["first"]
                let action = (reply["action"] as? [String: Any])?["value"] as? [String: Any]
                value.selectedAction = (action?["task"] as? String)?.contains("BLABEE_NATIVE_SELECTION_DONE") == true
            }
            if operation == "selection.complete", reply["recorded"] as? Bool == true,
               let id = reply["selection_id"] as? String {
                value.completions.append(id)
                value.exactSelection = value.exactSelection && id == selectedID
                value.completionMarker = fields["outcome"] as? String == "completed"
                    && fields["note"] as? String == "BLABEE_NATIVE_SELECTION_DONE"
            }
        }
        return result
    }
    func doctorStatus(payload: Data) async throws -> Data { try await application.doctorStatus(payload: payload) }
    func processTime() async throws -> [Data] { try await application.processTime() }
    func millisecondsUntilNextDeadline() async -> Int32? { await application.millisecondsUntilNextDeadline() }
}

/// Explicit opt-in only: this submits three harmless prompts to a real model.
/// Required environment: BLABEE_PUBLIC_HOOK_NATIVE=1 plus *_CLAUDE, *_NODE,
/// *_AUTH_ROOT (an already authenticated temporary root containing config/ and
/// plugins/). HOME and credentials are never copied, read, or rewritten here.
@Suite("Claude public Hook native qualification", .serialized)
struct ClaudePublicHookNativeTests {
    @Test("Pinned interactive MCP/Hook continuation and actual-prompt cancellation",
          .enabled(if: ProcessInfo.processInfo.environment["BLABEE_PUBLIC_HOOK_NATIVE"] == "1"))
    func interactiveContinuationAndCancellation() async throws {
        try await Task.detached { try Self.run() }.value
    }

    private static func run() throws {
        let inherited = ProcessInfo.processInfo.environment
        func required(_ suffix: String) throws -> String {
            guard let value = inherited["BLABEE_PUBLIC_HOOK_NATIVE_" + suffix], value.hasPrefix("/"),
                  !value.contains("\n"), !value.contains("\0") else { throw CoordinatorError("native_fixture_environment") }
            return value
        }
        let claude = try required("CLAUDE"), node = try required("NODE"), auth = try required("AUTH_ROOT")
        guard claude == "/Users/joo/.local/share/claude/versions/2.1.282",
              FileManager.default.isExecutableFile(atPath: claude), FileManager.default.isExecutableFile(atPath: node),
              auth.hasPrefix("/private/tmp/") else { throw CoordinatorError("native_fixture_paths") }
        // Metadata only. The native CLI reads its own temporary authentication.
        for path in [auth, auth + "/config", auth + "/plugins"] {
            var info = stat()
            guard lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
                  info.st_uid == geteuid(), info.st_mode & 0o022 == 0 else { throw CoordinatorError("native_fixture_auth_directory") }
        }
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { repository.deleteLastPathComponent() }
        let root = URL(fileURLWithPath: "/private/tmp/bph-native-" + UUID().uuidString.lowercased().prefix(10))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let work = try ClaudeBridgeConfiguration.privateChild(of: root, name: "work")
        let evidence = try ClaudeBridgeConfiguration.privateChild(of: root, name: "evidence")
        let project = try ClaudeBridgeConfiguration.privateChild(of: work, name: "project")
        print("CLAUDE_PUBLIC_HOOK_NATIVE_EVIDENCE " + evidence.path)
        defer { try? FileManager.default.removeItem(at: work) }
        let corpus = RuntimeSecretCorpus()
        let runtime = "sha256:" + String(repeating: "a", count: 64)
        let registry = try ClaudeSessionRegistry(rootURL: ClaudeBridgeConfiguration.privateChild(of: work, name: "store"),
            runtimeIdentity: runtime, secretCorpus: corpus, freshnessFactory: { PublicHookNativeFreshness($0) })
        let ownerSocket = work.appendingPathComponent("owner.sock").path
        let enrollment = try ClaudeSessionEnrollment.makeTesting(socketPath: ownerSocket, runtimeIdentity: runtime,
            serviceIncarnation: registry.serviceIncarnation, secretCorpus: corpus,
            enroll: { try registry.enroll(connectionID: $0, request: $1, deliverGrant: $2) },
            control: { try registry.control(connectionID: $0, request: $1) },
            disconnected: { registry.disconnect(connectionID: $0) })
        try enrollment.start()
        let application = ClaudeProductServiceCoordinator(codex: PublicHookNativeCodexStub(), registry: registry, enrollment: enrollment)
        defer { application.stop() }
        let audit = PublicHookNativeAudit(application)
        let socket = work.appendingPathComponent("session.sock").path
        let server = try UnixDomainSocketServer(socketPath: socket, runtimeIdentity: runtime)
        try server.activate()
        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            defer { finished.signal() }
            try? server.run(application: audit, secretCorpus: corpus)
        }
        defer { server.stop(); _ = finished.wait(timeout: .now() + 5) }
        let owner = try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: ownerSocket,
            runtimeIdentity: runtime, canonicalCWD: project.path)
        defer { owner.close() }
        // The real 3,600s owner grant covers this 180s fixture; its first normal
        // renewal is due at 300s. Never substitute MCP heartbeat or extend TTL.
        let now = SystemCoordinatorContinuousClock().nowNanoseconds()
        guard owner.initialDeadlineNanoseconds > now,
              owner.initialDeadlineNanoseconds - now > 200_000_000_000 else {
            throw CoordinatorError("native_fixture_owner_lease_too_short")
        }
        let prompts = try ["first": proposalPrompt(number: 1), "second": proposalPrompt(number: 2),
            "cancel": "Cancel the pending Blabee choice. This is a new user request; do not select, claim, complete, emit, or call any tool. Reply only BLABEE_NATIVE_CANCELLED and stop."]
        audit.configure(nativeSessionID: owner.identity.nativeSessionID, prompts: prompts)
        let documents = try ClaudeInstalledLaunchConfiguration.documents(nodeExecutable: URL(fileURLWithPath: node),
            payloadRoot: repository.appendingPathComponent("bridges/claude"), nativeSessionID: owner.identity.nativeSessionID)
        var settings = try StrictJSONTransport.object(from: documents.settings)
        settings["syncClaudeAiPlugins"] = false
        settings["disableClaudeAiConnectors"] = true
        let configuration = try ClaudeInstalledConfigurationFiles(root: work,
            documents: .init(settings: StrictJSONTransport.data(forJSONObject: settings), mcp: documents.mcp))
        defer { withExtendedLifetime(configuration) {} }
        let allowed = ["check_connection_v1", "ack_readiness_probe_v1", "emit_decision_v1", "claim_selection_v1", "complete_selection_v1"]
            .map { "mcp__blabee-claude__" + $0 }.joined(separator: ",")
        let arguments = ClaudeInstalledLaunchConfiguration.arguments(nativeSessionID: owner.identity.nativeSessionID,
            settings: configuration.settings, mcp: configuration.mcp,
            claudeArguments: ["--setting-sources", "", "--strict-mcp-config", "--tools", "", "--allowedTools", allowed, "--no-chrome"])
        let launch = work.appendingPathComponent("launch.json"), control = work.appendingPathComponent("control.json")
        try writeJSON(["executable": claude, "arguments": arguments], to: launch, corpus: corpus)
        var environment = ClaudeInstalledLaunchConfiguration.cleanEnvironment(inherited).filter {
            !$0.key.hasPrefix("CLAUDE_") && !$0.key.hasPrefix("ANTHROPIC_")
        }
        environment.merge(try owner.childEnvironment(sessionSocketPath: socket)) { _, value in value }
        environment["CLAUDE_CONFIG_DIR"] = auth + "/config"
        environment["CLAUDE_CODE_PLUGIN_CACHE_DIR"] = auth + "/plugins"
        environment["DISABLE_AUTOUPDATER"] = "1"
        environment["DISABLE_UPDATES"] = "1"
        environment["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] = "1"
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        environment["TERM"] = "xterm-256color"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [repository.appendingPathComponent("Tests/bridges/claude/integration/public-hook-native-pty.py").path,
                             launch.path, control.path, project.path, evidence.path]
        process.currentDirectoryURL = project
        process.environment = environment
        // The driver writes only fixed diagnostics and redacted evidence files.
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        defer {
            if process.isRunning {
                process.terminate()
                let deadline = Date().addingTimeInterval(8)
                while process.isRunning && Date() < deadline { usleep(50_000) }
                if process.isRunning {
                    _ = kill(process.processIdentifier, SIGKILL)
                    let reapDeadline = Date().addingTimeInterval(2)
                    while process.isRunning && Date() < reapDeadline { usleep(50_000) }
                }
            }
        }
        let deadline = DispatchTime.now().uptimeNanoseconds + 180_000_000_000
        var phase = "initial_card", passed = false, staleRejected = false
        var sequence = 0
        func command(_ prompt: String?) throws {
            sequence += 1
            var value: [String: Any] = ["sequence": sequence, "kind": prompt == nil ? "stop" : "prompt"]
            if let prompt { value["text"] = prompt }
            try writeJSON(value, to: control, corpus: corpus)
        }
        func wait(_ predicate: () throws -> Bool) throws {
            while DispatchTime.now().uptimeNanoseconds < deadline {
                if try predicate() { return }
                guard process.isRunning else { throw CoordinatorError("native_fixture_child_exited") }
                usleep(50_000)
            }
            throw CoordinatorError("native_fixture_timeout")
        }
        func target() throws -> [String: Any] {
            guard let descriptor = try registry.petSessions().first(where: { $0.mapping.authority.scopeID == owner.identity.scopeID }) else {
                throw CoordinatorError("native_fixture_scope_missing")
            }
            let identity = owner.identity
            return ["scope_id": identity.scopeID.uuidString.lowercased(),
                "service_incarnation": identity.serviceIncarnation.uuidString.lowercased(),
                "session_incarnation": identity.sessionIncarnation.uuidString.lowercased(),
                "authority_epoch": identity.authorityEpoch.uuidString.lowercased(), "ui_generation": String(descriptor.uiGeneration)]
        }
        func pet(_ destination: [String: Any], _ operation: String, _ payload: [String: Any] = [:]) throws -> [String: Any] {
            let request = try ClaudeProductWireCodec(credentialCorpus: corpus).decodeRequest(StrictJSONTransport.data(forJSONObject: [
                "schema_version": "blabee.pet-provider.v1", "kind": "request", "provider": "claude",
                "request_id": UUID().uuidString.lowercased(), "role": "selector", "operation": operation,
                "target": destination, "payload": payload]))
            return try StrictJSONTransport.object(from: registry.handlePet(request: request))
        }
        func card(_ index: Int) throws -> (target: [String: Any], selection: [String: Any])? {
            let packets = audit.snapshot.packets
            guard packets.count > index else { return nil }
            let destination = try target(), response = try pet(destination, "snapshot")
            guard response["ok"] as? Bool == true,
                  let result = response["result"] as? [String: Any],
                  let projection = (result["projection"] as? [String: Any])?["value"] as? [String: Any],
                  projection["selection_enabled"] as? Bool == true,
                  let card = (projection["cards"] as? [[String: Any]])?.first(where: {
                      ($0["packet"] as? [String: Any])?["packet_id"] as? String == packets[index]
                  }), let packet = card["packet"] as? [String: Any],
                  let choices = packet["choices"] as? [[String: Any]], choices.count == 2,
                  let binding = card["binding"], let revision = packet["revision"],
                  let option = choices.first?["option_id"] else { return nil }
            return (destination, ["binding": binding, "packet_id": packets[index], "revision": revision,
                "option_id": option, "selection_id": UUID().uuidString.lowercased()])
        }
        do {
            try command(prompts["first"]!)
            var first: (target: [String: Any], selection: [String: Any])?
            try wait { first = try card(0); return first != nil }
            let selected = try #require(first)
            audit.select(try #require(selected.selection["selection_id"] as? String))
            phase = "selected_continuation"
            let receipt = try pet(selected.target, "select", selected.selection)
            guard receipt["ok"] as? Bool == true,
                  (receipt["result"] as? [String: Any])?["status"] as? String == "awaiting_claude_claim" else {
                throw CoordinatorError("native_fixture_selection_rejected")
            }
            try wait { let value = audit.snapshot; return value.completions.count == 1 && value.completedStops > 0 }
            phase = "second_card"
            try command(prompts["second"]!)
            var second: (target: [String: Any], selection: [String: Any])?
            try wait { second = try card(1); return second != nil }
            let staleCard = try #require(second)
            let stale = staleCard.selection
            phase = "actual_prompt_cancellation"
            try command(prompts["cancel"]!)
            try wait { let value = audit.snapshot; return value.prompts["cancel"] == 1 && value.cancelledStops > 0 }
            // Fresh directory generation with the OLD card binding isolates
            // cancellation from a merely stale Pet directory generation.
            staleRejected = try pet(target(), "select", stale)["ok"] as? Bool == false
            let settle = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
            try wait { DispatchTime.now().uptimeNanoseconds >= settle }
            phase = "counts"
            let value = audit.snapshot
            let exact: [String: Int] = ["readiness.begin": 2, "readiness.ack": 2, "proposal.emit": 2,
                                       "selection.claim": 1, "selection.complete": 1]
            guard staleRejected, value.sameSession, value.exactSelection, value.newPromptClaim,
                  value.selectedAction, value.completionMarker,
                  value.deliveries == 1, value.claims.count == 1, value.completions == value.claims,
                  value.prompts == ["first": 1, "rewake": 1, "second": 1, "cancel": 1],
                  exact.allSatisfy({ value.attempts[$0.key] == $0.value && value.successes[$0.key] == $0.value }) else {
                throw CoordinatorError("native_fixture_evidence_mismatch")
            }
            phase = "driver_exit"
            try command(nil)
            try wait { !process.isRunning }
            let driver = try StrictJSONTransport.object(from: Data(contentsOf: evidence.appendingPathComponent("driver.json")))
            let terminal = try Data(contentsOf: evidence.appendingPathComponent("pty-redacted.txt"))
            guard process.terminationStatus == 0, driver["ok"] as? Bool == true,
                  driver["prompts_sent"] as? Int == 3, driver["native_version_seen"] as? Bool == true,
                  terminal.count <= 1_048_576, !corpus.containsKnownSecret(in: terminal) else {
                throw CoordinatorError("native_fixture_driver_failed")
            }
            passed = true
            phase = "complete"
        } catch {
            try? command(nil)
            try? writeJSON(["schema_version": "blabee.claude-public-hook-native.v1", "passed": false,
                "phase": phase, "stale_selection_rejected": staleRejected, "audit": audit.snapshot.json],
                to: evidence.appendingPathComponent("result.json"), corpus: corpus)
            throw CoordinatorError("native_fixture_failed_" + phase)
        }
        try writeJSON(["schema_version": "blabee.claude-public-hook-native.v1", "passed": passed,
            "candidate_version": "2.1.282", "real_model": true, "phase": phase,
            "stale_selection_rejected": staleRejected, "audit": audit.snapshot.json],
            to: evidence.appendingPathComponent("result.json"), corpus: corpus)
    }

    private static func writeJSON(_ value: [String: Any], to url: URL, corpus: RuntimeSecretCorpus) throws {
        let data = try StrictJSONTransport.data(forJSONObject: value)
        guard !corpus.containsKnownSecret(in: data) else { throw CoordinatorError("native_fixture_secret_output") }
        // Set mode before the atomic rename so the polling driver never sees
        // a temporarily world-readable control file.
        let temporary = url.deletingLastPathComponent().appendingPathComponent(".native-" + UUID().uuidString)
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw CoordinatorError("native_fixture_output") }
        defer { close(descriptor); try? FileManager.default.removeItem(at: temporary) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw CoordinatorError("native_fixture_output") }
                offset += count
            }
        }
        guard rename(temporary.path, url.path) == 0 else { throw CoordinatorError("native_fixture_output") }
    }

    private static func proposalPrompt(number: Int) throws -> String {
        let options = ["a", "b"].map { id in
            let marker = id == "a" ? "BLABEE_NATIVE_SELECTION_DONE" : "BLABEE_NATIVE_ALTERNATIVE_DONE"
            return ["id": id, "title": "Harmless reply " + id, "description": "Only a brief text reply",
             "task": "Reply with \(marker). Do not use any other tool or change files.",
             "done_when": "The marker has been stated and this selection is reported completed.",
             "constraints": ["Text only; no file, shell, browser, or network actions."]] as [String: Any]
        }
        let proposal: [String: Any] = ["proposal_id": UUID().uuidString.lowercased(),
            "task_goal": "Isolated native Hook qualification case \(number)",
            "outcome": ["status": "completed", "summary": "Ready for a harmless choice"],
            "reported_side_effects": [], "options": options]
        let encoded = String(decoding: try StrictJSONTransport.data(forJSONObject: proposal), as: UTF8.self)
        return """
        This is isolated Blabee native qualification case \(number). Use only the five Blabee MCP tools. Call check_connection_v1 once, then ack_readiness_probe_v1 once using the returned probe_id and nonce; require acknowledged:true. Use the CURRENT boundary_id supplied by the UserPromptSubmit Hook and emit_decision_v1 once with this exact proposal: \(encoded)
        After successful emit, say BLABEE_NATIVE_WAITING_\(number) and stop. Do not poll, select, claim early, retry any failed tool, or invent any identifier. A later genuine Blabee Stop Hook selection notice authorizes one claim_selection_v1 using its exact references. Only after successful claim, perform the returned harmless action, then call complete_selection_v1 once with outcome completed and note exactly BLABEE_NATIVE_SELECTION_DONE; say that marker and stop. Do not emit another card unless a new user prompt asks. If a tool fails, stop and report the failure briefly.
        """
    }
}
#endif
