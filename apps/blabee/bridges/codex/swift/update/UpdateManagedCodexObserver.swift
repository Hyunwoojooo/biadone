import CoordinatorSwift
import CoreFoundation
import Foundation

enum UpdateManagedSessionState: String, Codable, Sendable {
    case starting, running, busy, pausing, paused, resuming, failed
}

struct UpdateManagedSession: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var threadID: String?
    var cwd: String
    var state: UpdateManagedSessionState
    var detail: String?
}

/// A deliberately separate lifecycle qualification. It grants no approval-broker capability.
enum UpdateManagedCodexProfile {
    static let supportedVersions: Set<String> = ["0.154.0", "0.155.0", "0.155.1", "0.156.0", "0.156.1", "0.157.0", "0.157.1", "0.158.0", "0.159.0", "0.159.1", "0.159.2", "0.159.3", "0.160.0", "0.160.1", "0.161.0", "0.162.0", "0.162.1", "0.163.0", "0.164.0"]
    static func requireSupported(_ version: String) throws {
        guard supportedVersions.contains(version) else {
            throw CoordinatorError("update_managed_codex_version_unsupported")
        }
    }
}

/// Serialized by the bridge lock. Unsubscribe ACK is never a persistence ACK.
/// Root identity comes only from a successful writable start/resume response;
/// notifications additionally track subagents, whose persistence must also drain.
struct UpdateManagedCodexObserver {
    struct ClientRequest {
        let method: String
        let threadID: String?
        let readOnly: Bool
        let auxiliary: Bool
        let ambiguousLegacyOrigin: Bool
    }
    struct Thread: Equatable {
        let id: String
        var cwd: String
        var idle: Bool
        var ephemeral: Bool
    }
    struct ServerRequest { let threadID: String? }
    private(set) var threads: [String: Thread] = [:]
    private(set) var clientRequests: [String: ClientRequest] = [:]
    private(set) var serverRequests: [String: ServerRequest] = [:]
    private var resolvedServerRequests: [String: ServerRequest] = [:]
    private var resolvedServerOrder: [String] = []
    private(set) var pendingStatuses: [String: String] = [:]
    private(set) var rootThreadID: String?
    private(set) var rootCWD: String?
    private(set) var rootRolloutPath: String?
    private(set) var frozen = false
    private(set) var closedThreads: Set<String> = []
    private(set) var unsubscribeRequests: [String: String] = [:]
    private(set) var failure: String?
    private(set) var stdoutEOF = false
    private(set) var stderrEOF = false
    private(set) var serverExit: Int32?
    let expectedResumeID: String?
    let expectedCWD: String
    let reservation = "blabee-update-" + UUID().uuidString.lowercased() + "-"

    init(expectedResumeID: String?, expectedCWD: String) {
        self.expectedResumeID = expectedResumeID?.lowercased()
        self.expectedCWD = expectedCWD
    }

    var busy: Bool {
        rootThreadID == nil || !clientRequests.isEmpty || !serverRequests.isEmpty || !pendingStatuses.isEmpty
            || threads.values.contains { !$0.idle }
    }
    var allThreadsClosed: Bool {
        frozen && !threads.isEmpty && Set(threads.keys).isSubset(of: closedThreads)
            && unsubscribeRequests.isEmpty && failure == nil
    }
    var persistenceBarrierComplete: Bool {
        allThreadsClosed && stdoutEOF && stderrEOF && serverExit == 0
    }

    static func object(_ data: Data) throws -> [String: Any] {
        guard data.count <= ManagedCodexTransportLimits.maximumMessageBytes,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw CoordinatorError("update_managed_protocol_invalid") }
        return object
    }

    static func identity(_ value: Any?) throws -> String? {
        guard let value else { return nil }
        if let string = value as? String, !string.isEmpty, string.utf8.count <= 512 {
            return "s:" + string
        }
        if let number = value as? NSNumber,
           CFGetTypeID(number) != CFBooleanGetTypeID(),
           number.doubleValue.isFinite,
           number.doubleValue.rounded() == number.doubleValue {
            return "n:" + number.stringValue
        }
        throw CoordinatorError("update_managed_rpc_id_invalid")
    }

    mutating func admitClient(_ object: [String: Any]) throws {
        guard !frozen else { throw CoordinatorError("update_managed_session_pausing") }
        let id = try Self.identity(object["id"])
        if let rawID = object["id"] as? String, rawID.hasPrefix("blabee-update-") {
            throw CoordinatorError("update_managed_reserved_rpc_id")
        }
        if let method = object["method"] as? String {
            if let id {
                guard clientRequests[id] == nil else {
                    throw CoordinatorError("update_managed_duplicate_rpc_id")
                }
                let params = object["params"] as? [String: Any] ?? [:]
                clientRequests[id] = ClientRequest(
                    method: method, threadID: params["threadId"] as? String,
                    readOnly: params["readOnly"] as? Bool == true,
                    auxiliary: ["s:tui-dynamic-", "s:temporary-"].contains(where: id.hasPrefix),
                    ambiguousLegacyOrigin: id.hasPrefix("s:legacy-thread-start-")
                )
            }
        } else if let id {
            if let request = serverRequests.removeValue(forKey: id) {
                rememberResolved(id, request: request)
            } else if resolvedServerRequests[id] == nil {
                throw CoordinatorError("update_managed_unknown_client_response")
            }
        } else { throw CoordinatorError("update_managed_protocol_invalid") }
    }

    /// True means this is an internal unsubscribe response, not a TUI response.
    mutating func observeServer(_ object: [String: Any]) throws -> Bool {
        let id = try Self.identity(object["id"])
        if let method = object["method"] as? String {
            let params = object["params"] as? [String: Any] ?? [:]
            if let id {
                guard serverRequests[id] == nil else {
                    throw CoordinatorError("update_managed_duplicate_server_rpc_id")
                }
                let threadID = try params["threadId"].map(validThreadID)
                serverRequests[id] = ServerRequest(threadID: threadID)
                resolvedServerRequests.removeValue(forKey: id)
                if frozen { fail("update_managed_request_during_pause") }
            }
            switch method {
            case "serverRequest/resolved":
                guard let requestID = try Self.identity(params["requestId"]) else {
                    throw CoordinatorError("update_managed_resolved_request_invalid")
                }
                let threadID = try validThreadID(params["threadId"])
                guard let request = serverRequests[requestID] ?? resolvedServerRequests[requestID],
                      request.threadID == nil || request.threadID == threadID else {
                    throw CoordinatorError("update_managed_resolved_request_mismatch")
                }
                serverRequests.removeValue(forKey: requestID)
                rememberResolved(requestID, request: request)
            case "thread/started":
                guard let thread = params["thread"] as? [String: Any] else {
                    throw CoordinatorError("update_managed_thread_invalid")
                }
                let known = try threads[validThreadID(thread["id"])] != nil
                try observeThread(thread)
                if frozen && !known { fail("update_managed_thread_started_during_pause") }
            case "thread/status/changed":
                let threadID = try validThreadID(params["threadId"])
                guard let status = params["status"] as? [String: Any],
                      let type = status["type"] as? String,
                      ["notLoaded", "idle", "active", "systemError"].contains(type) else {
                    throw CoordinatorError("update_managed_thread_status_invalid")
                }
                guard var thread = threads[threadID] else {
                    // Cold resume and subagent attach publish status BEFORE the
                    // full thread response/notification. Never infer root identity
                    // from this partial evidence; unresolved entries block pause.
                    if type == "notLoaded" { pendingStatuses.removeValue(forKey: threadID) }
                    else {
                        guard pendingStatuses.count < 256 || pendingStatuses[threadID] != nil else {
                            throw CoordinatorError("update_managed_pending_threads_limit")
                        }
                        pendingStatuses[threadID] = type
                    }
                    if frozen { fail("update_managed_untracked_status_during_pause") }
                    return false
                }
                thread.idle = type == "idle"
                threads[threadID] = thread
                if frozen && !thread.idle && type != "notLoaded" {
                    fail("update_managed_thread_became_busy")
                }
            case "turn/started":
                let threadID = try validThreadID(params["threadId"])
                guard var thread = threads[threadID] else {
                    throw CoordinatorError("update_managed_untracked_turn")
                }
                thread.idle = false
                threads[threadID] = thread
                if frozen { fail("update_managed_turn_during_pause") }
            case "thread/closed":
                let threadID = try validThreadID(params["threadId"])
                guard threads[threadID] != nil else {
                    if pendingStatuses.removeValue(forKey: threadID) != nil { return false }
                    throw CoordinatorError("update_managed_untracked_close")
                }
                closedThreads.insert(threadID)
                if !frozen { threads.removeValue(forKey: threadID) }
            case "error":
                if frozen { fail("update_managed_server_error_during_pause") }
            default: break
            }
            return false
        }
        guard let id else { throw CoordinatorError("update_managed_protocol_invalid") }
        if unsubscribeRequests.removeValue(forKey: id) != nil {
            guard object["error"] == nil,
                  let result = object["result"] as? [String: Any],
                  ["unsubscribed", "notSubscribed", "notLoaded"].contains(result["status"] as? String ?? "")
            else { fail("update_managed_unsubscribe_failed"); return true }
            return true
        }
        guard let request = clientRequests.removeValue(forKey: id) else {
            throw CoordinatorError("update_managed_unknown_server_response")
        }
        if ["thread/start", "thread/resume", "thread/fork"].contains(request.method),
           object["error"] == nil {
            guard let result = object["result"] as? [String: Any],
                  let thread = result["thread"] as? [String: Any] else {
                throw CoordinatorError("update_managed_thread_response_invalid")
            }
            try observeThread(thread)
            let threadID = try validThreadID(thread["id"])
            // Native TUI uses these same RPCs for ephemeral title/recap work
            // and for subagent navigation. They are tracked for drain, not root.
            if request.auxiliary || thread["ephemeral"] as? Bool == true || thread["parentThreadId"] is String {
                return false
            }
            // A history/tool fallback changes request IDs and erases origin.
            // Likewise a different durable parentless thread may be UI navigation
            // or background work. Keep the confirmed root; refuse to guess.
            guard !request.ambiguousLegacyOrigin,
                  rootThreadID == nil || rootThreadID == threadID else {
                fail("update_managed_root_transition_ambiguous")
                return false
            }
            guard !request.readOnly,
                  let rawCWD = result["cwd"] as? String,
                  let cwd = try? UpdateManagedCodexPath.canonicalDirectory(rawCWD),
                  cwd == threads[threadID]?.cwd,
                  rootThreadID != nil || cwd == expectedCWD,
                  rootThreadID != nil || expectedResumeID == nil || (request.method == "thread/resume"
                    && request.threadID?.lowercased() == expectedResumeID && threadID == expectedResumeID)
            else { fail("update_managed_resume_identity_unconfirmed"); return false }
            rootThreadID = threadID
            rootCWD = cwd
            rootRolloutPath = thread["path"] as? String
        }
        return false
    }

    mutating func beginPause() throws -> [[String: Any]] {
        guard !frozen, failure == nil, !busy, rootThreadID != nil,
              !threads.isEmpty
        else { throw CoordinatorError("update_managed_session_busy_or_unconfirmed") }
        frozen = true
        return threads.keys.sorted().enumerated().map { index, threadID in
            let id = reservation + String(index)
            unsubscribeRequests["s:" + id] = threadID
            return ["id": id, "method": "thread/unsubscribe", "params": ["threadId": threadID]]
        }
    }

    mutating func observeDiagnostic(_ line: Data) throws {
        // The pinned app-server is configured with LOG_FORMAT=json and RUST_LOG=warn.
        // Unknown/truncated output refuses auto-update rather than guessing persistence.
        let object = try Self.object(line)
        guard let level = object["level"] as? String,
              let fields = object["fields"] as? [String: Any],
              let message = fields["message"] as? String else {
            throw CoordinatorError("update_managed_diagnostics_invalid")
        }
        // Codex 0.162 keeps awaiting the same shutdown after this progress warning.
        // Stderr may lag stdout's thread/closed; do not require a still-open thread.
        // This grants no completion, changes no deadline, and preserves prior failures.
        if level == "WARN",
           object["target"] as? String == "codex_app_server::request_processors::thread_lifecycle",
           fields["event.name"] as? String == "codex.app_server.thread_shutdown_slow",
           message.hasPrefix("thread "),
           let threadID = UUID(uuidString: String(message.dropFirst("thread ".count).prefix(36))),
           message == "thread \(threadID.uuidString.lowercased()) shutdown is taking longer than expected; continuing to wait" {
            return
        }
        let lower = message.lowercased()
        let target = (object["target"] as? String ?? "").lowercased()
        let persistence = ["persist", "rollout", "shutdown", "shut down", "flush", "storage", "database"]
            .contains(where: lower.contains)
            || ["rollout", "persistence", "codex_state"].contains(where: target.contains)
        // A recoverable model/tool ERROR before pause is not disk failure.
        // Once draining, an otherwise-unclassified ERROR remains uncertainty.
        if persistence || (frozen && level.uppercased() == "ERROR") {
            fail("update_managed_persistence_diagnostic")
        }
    }
    mutating func didReachStdoutEOF() { stdoutEOF = true }
    mutating func didReachStderrEOF() { stderrEOF = true }
    mutating func didExitServer(_ status: Int32) {
        serverExit = status
        if status != 0 { fail("update_managed_server_exit_failed") }
    }
    mutating func fail(_ code: String) { if failure == nil { failure = code } }

    private mutating func observeThread(_ object: [String: Any]) throws {
        let id = try validThreadID(object["id"])
        guard let rawCWD = object["cwd"] as? String,
              let cwd = try? UpdateManagedCodexPath.canonicalDirectory(rawCWD),
              let ephemeral = object["ephemeral"] as? Bool,
              let status = object["status"] as? [String: Any], let type = status["type"] as? String
        else { throw CoordinatorError("update_managed_thread_invalid") }
        let observedStatus = pendingStatuses.removeValue(forKey: id) ?? type
        threads[id] = Thread(id: id, cwd: cwd, idle: observedStatus == "idle", ephemeral: ephemeral)
        closedThreads.remove(id)
    }
    private func validThreadID(_ value: Any?) throws -> String {
        guard let string = value as? String, let uuid = UUID(uuidString: string) else {
            throw CoordinatorError("update_managed_thread_id_invalid")
        }
        return uuid.uuidString.lowercased()
    }

    private mutating func rememberResolved(_ id: String, request: ServerRequest) {
        if resolvedServerRequests[id] == nil { resolvedServerOrder.append(id) }
        resolvedServerRequests[id] = request
        while resolvedServerOrder.count > 512 {
            resolvedServerRequests.removeValue(forKey: resolvedServerOrder.removeFirst())
        }
    }
}
