import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Update managed Codex persistence barrier")
struct UpdateManagedCodexObserverTests {
    let root = "019a1111-2222-7333-8444-555555555555"
    let child = "019a1111-2222-7333-8444-666666666666"
    let cwd = "/private/tmp"

    func thread(_ id: String, idle: Bool = true, ephemeral: Bool = false) -> [String: Any] {
        ["id": id, "cwd": cwd, "ephemeral": ephemeral, "status": ["type": idle ? "idle" : "active"]]
    }
    func ready(resume: Bool = false) throws -> UpdateManagedCodexObserver {
        var observer = UpdateManagedCodexObserver(expectedResumeID: resume ? root : nil, expectedCWD: cwd)
        try observer.admitClient(["id": 1, "method": resume ? "thread/resume" : "thread/start",
                                  "params": resume ? ["threadId": root] : [:]])
        _ = try observer.observeServer(["id": 1, "result": ["thread": thread(root), "cwd": cwd]])
        return observer
    }

    @Test func successfulWritableResponseConfirmsExactIdentity() throws {
        let observer = try ready(resume: true)
        #expect(observer.rootThreadID == root)
        #expect(observer.rootCWD == cwd)
        #expect(!observer.busy)
    }

    @Test func notificationAloneCannotConfirmWritableRoot() throws {
        var observer = UpdateManagedCodexObserver(expectedResumeID: root, expectedCWD: cwd)
        _ = try observer.observeServer(["method": "thread/started", "params": ["thread": thread(root)]])
        #expect(observer.rootThreadID == nil)
        #expect(throws: (any Error).self) { try observer.beginPause() }
    }

    @Test(arguments: ["thread", "cwd", "readOnly"])
    func mismatchedResumeNeverAcknowledges(_ mismatch: String) throws {
        var observer = UpdateManagedCodexObserver(expectedResumeID: root, expectedCWD: cwd)
        try observer.admitClient(["id": 1, "method": "thread/resume",
            "params": ["threadId": root, "readOnly": mismatch == "readOnly"]])
        _ = try observer.observeServer(["id": 1, "result": [
            "thread": thread(mismatch == "thread" ? child : root, ephemeral: mismatch == "ephemeral"),
            "cwd": mismatch == "cwd" ? "/different" : cwd]])
        #expect(observer.rootThreadID == nil)
        #expect(observer.failure != nil)
    }

    @Test func temporaryStructuredThreadDoesNotBecomeRootOrDisableUpdates() throws {
        var observer = try ready(resume: true)
        try observer.admitClient(["id": "temporary-structured-title", "method": "thread/start",
                                  "params": ["ephemeral": true]])
        _ = try observer.observeServer(["id": "temporary-structured-title", "result": [
            "thread": thread(child, ephemeral: true), "cwd": cwd]])
        #expect(observer.rootThreadID == root)
        #expect(observer.failure == nil)
        #expect(try observer.beginPause().count == 2)
    }

    @Test func resumingSubagentDoesNotReplaceOrFailRoot() throws {
        var observer = try ready(resume: true)
        var subagent = thread(child)
        subagent["parentThreadId"] = root
        try observer.admitClient(["id": 2, "method": "thread/resume", "params": ["threadId": child]])
        _ = try observer.observeServer(["id": 2, "result": ["thread": subagent, "cwd": cwd]])
        #expect(observer.rootThreadID == root)
        #expect(observer.failure == nil)
        #expect(try observer.beginPause().count == 2)
    }

    @Test(arguments: ["thread/start", "thread/resume"])
    func durableParentlessDynamicHelpersNeverReplaceRoot(method: String) throws {
        var observer = try ready(resume: true)
        try observer.admitClient(["id": "tui-dynamic-" + UUID().uuidString, "method": method,
                                  "params": ["threadId": child]])
        let id = observer.clientRequests.keys.first!
        _ = try observer.observeServer(["id": String(id.dropFirst(2)),
                                         "result": ["thread": thread(child), "cwd": cwd]])
        #expect(observer.rootThreadID == root)
        #expect(observer.failure == nil)
        #expect(observer.threads[child] != nil)
    }

    @Test(arguments: ["legacy-thread-start-", "unclassified-parentless-"])
    func ambiguousNewRootBlocksUpdateWithoutRetargeting(prefix: String) throws {
        var observer = try ready()
        let id = prefix + UUID().uuidString
        try observer.admitClient(["id": id, "method": "thread/start"])
        _ = try observer.observeServer(["id": id, "result": ["thread": thread(child), "cwd": cwd]])
        #expect(observer.rootThreadID == root)
        #expect(observer.failure == "update_managed_root_transition_ambiguous")
        #expect(throws: (any Error).self) { try observer.beginPause() }
    }

    @Test func coldResumeStatusMayPrecedeFullResponse() throws {
        var observer = UpdateManagedCodexObserver(expectedResumeID: root, expectedCWD: cwd)
        try observer.admitClient(["id": 1, "method": "thread/resume", "params": ["threadId": root]])
        _ = try observer.observeServer(["method": "thread/status/changed",
            "params": ["threadId": root, "status": ["type": "idle"]]])
        #expect(observer.rootThreadID == nil)
        #expect(observer.pendingStatuses.count == 1)
        #expect(observer.busy)
        _ = try observer.observeServer(["id": 1, "result": ["thread": thread(root), "cwd": cwd]])
        #expect(observer.pendingStatuses.isEmpty)
        #expect(observer.rootThreadID == root)
        #expect(observer.failure == nil)
    }

    @Test func subagentEarlyStatusIsBoundedAndBlocksPauseUntilMetadata() throws {
        var observer = try ready()
        _ = try observer.observeServer(["method": "thread/status/changed",
            "params": ["threadId": child, "status": ["type": "idle"]]])
        #expect(throws: (any Error).self) { try observer.beginPause() }
        var subagent = thread(child)
        subagent["parentThreadId"] = root
        _ = try observer.observeServer(["method": "thread/started", "params": ["thread": subagent]])
        #expect(observer.pendingStatuses.isEmpty)
        #expect(try observer.beginPause().count == 2)
    }

    @Test(arguments: [true, false])
    func canceledApprovalAndLateReplyAreIdempotent(replyFirst: Bool) throws {
        var observer = try ready()
        _ = try observer.observeServer(["id": "approval", "method": "item/commandExecution/requestApproval",
                                         "params": ["threadId": root]])
        let response: [String: Any] = ["id": "approval", "result": ["decision": "decline"]]
        let resolved: [String: Any] = ["method": "serverRequest/resolved",
                                       "params": ["threadId": root, "requestId": "approval"]]
        if replyFirst { try observer.admitClient(response) }
        _ = try observer.observeServer(resolved)
        _ = try observer.observeServer(resolved)
        if !replyFirst { try observer.admitClient(response) }
        #expect(observer.serverRequests.isEmpty)
        #expect(observer.failure == nil)
        #expect(!observer.busy)
    }

    @Test func resolvedApprovalCannotClearAnotherThreadsRequest() throws {
        var observer = try ready()
        _ = try observer.observeServer(["id": 9, "method": "item/commandExecution/requestApproval",
                                         "params": ["threadId": root]])
        #expect(throws: (any Error).self) {
            try observer.observeServer(["method": "serverRequest/resolved",
                "params": ["threadId": child, "requestId": 9]])
        }
        #expect(observer.busy)
    }

    @Test func recoverableToolErrorDoesNotBecomePersistenceFailure() throws {
        var observer = try ready()
        let line = Data(#"{"level":"ERROR","target":"codex_core::mcp_tool_call","fields":{"message":"failed to parse model-generated tool arguments"}}"#.utf8)
        try observer.observeDiagnostic(line)
        #expect(observer.failure == nil)
        _ = try observer.beginPause()
        try observer.observeDiagnostic(line)
        #expect(observer.failure != nil) // While draining, unexplained errors are uncertainty.
    }

    @Test(arguments: ["client", "server", "turn", "subagent"])
    func pendingWorkRefusesBeforeFreezing(_ source: String) throws {
        var observer = try ready()
        switch source {
        case "client": try observer.admitClient(["id": 8, "method": "thread/read", "params": ["threadId": root]])
        case "server": _ = try observer.observeServer(["id": "approve", "method": "item/commandExecution/requestApproval", "params": ["threadId": root]])
        case "turn": _ = try observer.observeServer(["method": "turn/started", "params": ["threadId": root]])
        default: _ = try observer.observeServer(["method": "thread/started", "params": ["thread": thread(child, idle: false)]])
        }
        #expect(throws: (any Error).self) { try observer.beginPause() }
        #expect(!observer.frozen)
    }

    @Test func approvalsAreTrackedUntilActualClientResponse() throws {
        var observer = try ready()
        _ = try observer.observeServer(["id": "approval", "method": "item/fileChange/requestApproval"])
        #expect(observer.busy)
        try observer.admitClient(["id": "approval", "result": ["decision": "accept"]])
        #expect(!observer.busy)
        // Observer only records RPC completion; it supplies no decision itself.
    }

    @Test func everyThreadACKCloseExitAndBothEOFRequired() throws {
        var observer = try ready()
        _ = try observer.observeServer(["method": "thread/started", "params": ["thread": thread(child)]])
        let requests = try observer.beginPause()
        #expect(requests.count == 2)
        for request in requests {
            #expect(try observer.observeServer(["id": request["id"]!, "result": ["status": "unsubscribed"]]))
        }
        #expect(!observer.allThreadsClosed) // ACK is not persistence.
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": root]])
        #expect(!observer.allThreadsClosed) // Root alone does not cover subagent.
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": child]])
        #expect(observer.allThreadsClosed)
        #expect(!observer.persistenceBarrierComplete)
        observer.didExitServer(0)
        observer.didReachStdoutEOF()
        #expect(!observer.persistenceBarrierComplete)
        observer.didReachStderrEOF()
        #expect(observer.persistenceBarrierComplete)
    }

    @Test func latePersistenceWarningInvalidatesOtherwiseCompleteDrain() throws {
        var observer = try ready()
        let request = try observer.beginPause()[0]
        _ = try observer.observeServer(["id": request["id"]!, "result": ["status": "unsubscribed"]])
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": root]])
        observer.didExitServer(0)
        observer.didReachStdoutEOF()
        try observer.observeDiagnostic(Data(#"{"level":"WARN","fields":{"message":"failed to shutdown thread persistence: disk full"}}"#.utf8))
        observer.didReachStderrEOF()
        #expect(!observer.persistenceBarrierComplete)
        #expect(observer.failure == "update_managed_persistence_diagnostic")
    }

    func slowShutdownWarning(_ id: String) -> [String: Any] {
        ["level": "WARN", "target": "codex_app_server::request_processors::thread_lifecycle",
         "fields": ["event.name": "codex.app_server.thread_shutdown_slow",
                    "message": "thread \(id) shutdown is taking longer than expected; continuing to wait"]]
    }

    @Test func slowShutdownProgressStillRequiresEveryPersistenceBarrier() throws {
        var observer = try ready()
        _ = try observer.observeServer(["method": "thread/started", "params": ["thread": thread(child)]])
        let requests = try observer.beginPause()
        for id in [root, child] {
            try observer.observeDiagnostic(JSONSerialization.data(withJSONObject: slowShutdownWarning(id)))
        }
        #expect(observer.failure == nil)
        #expect(observer.unsubscribeRequests.count == 2)
        #expect(observer.closedThreads.isEmpty)
        #expect(!observer.allThreadsClosed)
        #expect(!observer.persistenceBarrierComplete)
        _ = try observer.observeServer(["id": requests[0]["id"]!, "result": ["status": "unsubscribed"]])
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": root]])
        #expect(!observer.allThreadsClosed)
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": child]])
        #expect(!observer.allThreadsClosed) // Both closes still need the second ACK.
        _ = try observer.observeServer(["id": requests[1]["id"]!, "result": ["status": "unsubscribed"]])
        #expect(observer.allThreadsClosed)
        #expect(!observer.persistenceBarrierComplete)
        observer.didReachStdoutEOF()
        #expect(!observer.persistenceBarrierComplete)
        observer.didExitServer(0)
        #expect(!observer.persistenceBarrierComplete)
        observer.didReachStderrEOF()
        #expect(observer.persistenceBarrierComplete)
    }

    @Test func slowShutdownProgressBeforeMetadataDoesNotConfirmIdentity() throws {
        var observer = UpdateManagedCodexObserver(expectedResumeID: root, expectedCWD: cwd)
        try observer.observeDiagnostic(JSONSerialization.data(withJSONObject: slowShutdownWarning(root)))
        #expect(observer.failure == nil)
        #expect(observer.rootThreadID == nil)
        #expect(observer.threads.isEmpty)
        #expect(observer.busy)
        #expect(!observer.persistenceBarrierComplete)
        #expect(throws: (any Error).self) { try observer.beginPause() }
    }

    @Test func lateSlowShutdownProgressWaitsForStderrEOF() throws {
        var observer = try ready()
        let request = try observer.beginPause()[0]
        _ = try observer.observeServer(["id": request["id"]!, "result": ["status": "unsubscribed"]])
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": root]])
        observer.didExitServer(0)
        observer.didReachStdoutEOF()
        try observer.observeDiagnostic(JSONSerialization.data(withJSONObject: slowShutdownWarning(root)))
        #expect(observer.failure == nil)
        #expect(observer.allThreadsClosed)
        #expect(!observer.persistenceBarrierComplete)
        observer.didReachStderrEOF()
        #expect(observer.persistenceBarrierComplete)
    }

    @Test(arguments: ["level", "target", "missingTarget", "event", "missingEvent", "message",
                      "invalidThreadID", "noncanonicalThreadID"])
    func shutdownProgressLookalikesStillFailClosed(_ mismatch: String) throws {
        var observer = try ready()
        _ = try observer.beginPause()
        var diagnostic = slowShutdownWarning(root)
        var fields = diagnostic["fields"] as! [String: Any]
        switch mismatch {
        case "level": diagnostic["level"] = "ERROR"
        case "target": diagnostic["target"] = "codex_core::rollout"
        case "missingTarget": diagnostic.removeValue(forKey: "target")
        case "event": fields["event.name"] = "codex.app_server.thread_shutdown_failed"
        case "missingEvent": fields.removeValue(forKey: "event.name")
        case "message": fields["message"] = (fields["message"] as! String) + "; disk full"
        case "invalidThreadID": fields = slowShutdownWarning("not-a-uuid")["fields"] as! [String: Any]
        default: fields = slowShutdownWarning("019A1111-2222-7333-8444-555555555555")["fields"] as! [String: Any]
        }
        diagnostic["fields"] = fields
        try observer.observeDiagnostic(JSONSerialization.data(withJSONObject: diagnostic))
        #expect(observer.failure == "update_managed_persistence_diagnostic")
        #expect(!observer.persistenceBarrierComplete)
    }

    @Test(arguments: [true, false])
    func slowShutdownProgressNeverClearsOrMasksPersistenceFailure(failureFirst: Bool) throws {
        var observer = try ready()
        let request = try observer.beginPause()[0]
        let failure = Data(#"{"level":"ERROR","fields":{"message":"failed to flush thread persistence: disk full"}}"#.utf8)
        if failureFirst { try observer.observeDiagnostic(failure) }
        try observer.observeDiagnostic(JSONSerialization.data(withJSONObject: slowShutdownWarning(root)))
        if !failureFirst { try observer.observeDiagnostic(failure) }
        _ = try observer.observeServer(["id": request["id"]!, "result": ["status": "unsubscribed"]])
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": root]])
        observer.didExitServer(0)
        observer.didReachStdoutEOF()
        observer.didReachStderrEOF()
        #expect(observer.failure == "update_managed_persistence_diagnostic")
        #expect(!observer.persistenceBarrierComplete)
    }

    @Test func shutdownErrorNotificationLatchesEvenIfClosedArrives() throws {
        var observer = try ready()
        let request = try observer.beginPause()[0]
        _ = try observer.observeServer(["method": "error", "params": ["message": "Failed to shutdown thread persistence"]])
        _ = try observer.observeServer(["id": request["id"]!, "result": ["status": "unsubscribed"]])
        _ = try observer.observeServer(["method": "thread/closed", "params": ["threadId": root]])
        observer.didExitServer(0)
        observer.didReachStdoutEOF()
        observer.didReachStderrEOF()
        #expect(!observer.persistenceBarrierComplete)
    }

    @Test(arguments: ["request", "turn", "thread"])
    func racesAfterFreezeRefuseUpdate(_ event: String) throws {
        var observer = try ready()
        _ = try observer.beginPause()
        switch event {
        case "request": _ = try observer.observeServer(["id": "approval", "method": "item/commandExecution/requestApproval"])
        case "turn": _ = try observer.observeServer(["method": "turn/started", "params": ["threadId": root]])
        default: _ = try observer.observeServer(["method": "thread/started", "params": ["thread": thread(child)]])
        }
        #expect(observer.failure != nil)
    }

    @Test func frozenAdmissionDoesNotRecordOrSendNewMutation() throws {
        var observer = try ready()
        _ = try observer.beginPause()
        #expect(throws: (any Error).self) {
            try observer.admitClient(["id": 99, "method": "turn/start", "params": ["threadId": root]])
        }
        #expect(observer.clientRequests.isEmpty)
    }

    @Test(arguments: ["notLoaded", "notSubscribed"])
    func unsubscribeStatusCannotSubstituteForClose(_ status: String) throws {
        var observer = try ready()
        let request = try observer.beginPause()[0]
        _ = try observer.observeServer(["id": request["id"]!, "result": ["status": status]])
        observer.didExitServer(0)
        observer.didReachStdoutEOF()
        observer.didReachStderrEOF()
        #expect(!observer.persistenceBarrierComplete)
    }

    @Test func malformedDiagnosticsAndIDsFailClosed() throws {
        var observer = try ready()
        #expect(throws: (any Error).self) { try observer.observeDiagnostic(Data("not JSON".utf8)) }
        #expect(throws: (any Error).self) { try observer.observeDiagnostic(Data(#"{"level":"WARN"}"#.utf8)) }
        #expect(throws: (any Error).self) { try UpdateManagedCodexObserver.identity(true) }
        #expect(throws: (any Error).self) {
            try observer.admitClient(["id": "blabee-update-forged", "method": "turn/start"])
        }
    }

    @Test(arguments: ["0.154.0", "0.155.0", "0.155.1", "0.156.0", "0.156.1", "0.157.0", "0.157.1", "0.158.0", "0.159.0", "0.159.1", "0.159.2", "0.159.3", "0.160.0", "0.160.1", "0.161.0", "0.162.0", "0.162.1", "0.163.0", "0.164.0"])
    func acceptsQualifiedLifecycleVersion(_ version: String) throws {
        try UpdateManagedCodexProfile.requireSupported(version)
    }

    @Test(arguments: ["0.149.1", "0.152.1", "0.155.2", "0.156.2", "0.157.2", "0.158.1", "0.159.4", "0.160.2", "0.161.1", "0.162.2", "0.163.1", "0.164.1", "0.165.0", "0.156.1-alpha.1", "0.157.1-alpha.1", "0.159.2-alpha.1", "0.160.0-alpha.1", "0.162.1-alpha.1", "0.163.0-alpha.1", "0.164.0-alpha.1", "latest"])
    func separateLifecycleProfileRejectsUnqualifiedExactVersions(_ version: String) {
        #expect(throws: (any Error).self) { try UpdateManagedCodexProfile.requireSupported(version) }
    }
}

@Suite("Update managed Codex command boundaries")
struct UpdateManagedCodexArgumentsTests {
    @Test(arguments: ["thread", "cwd", "session", "missing"])
    func transactionSnapshotCannotFollowChangedSession(_ mismatch: String) throws {
        let frozen = UpdateManagedSession(id: UUID().uuidString.lowercased(),
            threadID: UUID().uuidString.lowercased(), cwd: "/private/tmp", state: .running, detail: nil)
        var record = UpdateManagedCodexRecord(session: frozen, nonce: UUID().uuidString,
            hostPID: 1, hostStartTime: 1, incarnation: UUID().uuidString,
            socketPath: "/private/tmp/control.sock", codexPath: "/private/tmp/codex",
            terminal: nil, transactionID: nil, runtimeAppPath: "/private/tmp/Blabee.app",
            restorationClaim: nil)
        try UpdateManagedCodexSessions.requireFrozenIdentity(frozen, record: record)
        switch mismatch {
        case "thread": record.session.threadID = UUID().uuidString
        case "cwd": record.session.cwd = "/different"
        case "session": record.session.id = UUID().uuidString
        default: record.session.threadID = nil
        }
        #expect(throws: (any Error).self) {
            try UpdateManagedCodexSessions.requireFrozenIdentity(frozen, record: record)
        }
    }

    @Test(arguments: [
        ["--last"], ["--resume", "--last"], ["--continue"], ["hello"],
        ["--cwd", "/private/tmp", "--cwd", "/"], ["--codex", "relative"],
        ["--cwd", "/private/tmp\n/bin/echo bad"], ["--remote", "ws://evil"],
        ["-c", "approval_policy=never"],
    ])
    func rejectsUnboundedArguments(_ arguments: [String]) {
        #expect(throws: (any Error).self) { try UpdateManagedCodexArguments(arguments) }
    }

    @Test func exactResumeArguments() throws {
        let id = UUID().uuidString
        let args = try UpdateManagedCodexArguments(["--cwd", "/private/tmp", "--resume", id])
        #expect(args.cwd == "/private/tmp")
        #expect(args.resumeThreadID == id.lowercased())
    }

    @Test func symlinkCWDUsesPhysicalPathWithoutFoundationRecollapse() throws {
        let base = URL(fileURLWithPath: "/private/tmp").appendingPathComponent("blabee-cwd-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: base) }
        let target = base.appendingPathComponent("actual")
        let link = base.appendingPathComponent("alias")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: target)
        let argument = try UpdateManagedCodexArguments(["--cwd", link.path])
        #expect(argument.cwd == "/private/tmp/" + base.lastPathComponent + "/actual")
        #expect(try UpdateManagedCodexPath.canonicalDirectory("/tmp/" + base.lastPathComponent + "/actual") == argument.cwd)
    }

    @Test func shellMetacharactersAreLiteralArguments() throws {
        let executable = "/private/tmp/it'$(touch bad)`echo no`/Blabee.app/Contents/MacOS/blabee-coordinator"
        let script = try UpdateManagedCodexArguments.terminalScript(executable: executable, sessionID: UUID().uuidString)
        #expect(script.hasPrefix("#!/bin/sh\nexec '/private/tmp/it'\\''$(touch bad)`echo no`/"))
        #expect(!script.contains("--last"))
        #expect(!script.contains("tell application"))
    }
}
