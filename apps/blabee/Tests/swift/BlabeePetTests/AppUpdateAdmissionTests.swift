import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Update admission and preserved-connection readiness")
struct AppUpdateAdmissionTests {
    @Test("Concurrent first requests share one admission lock until every lease releases", arguments: 0..<20)
    func concurrentFreshAdmission(_: Int) async throws {
        let f = try Fixture(); defer { f.remove() }
        let directory = f.directory
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path).isEmpty)
        let start = ConcurrentStart(participants: 8)
        let requests = try await withThrowingTaskGroup(of: AppUpdateAdmissionLease.self) { group in
            for _ in 0..<8 {
                group.addTask {
                    await start.wait()
                    return try AppUpdateAdmissionGate.acquireRequest(directoryURL: directory)
                }
            }
            var leases: [AppUpdateAdmissionLease] = []
            for try await lease in group { leases.append(lease) }
            return leases
        }
        defer { for request in requests { request.release() } }
        #expect(requests.count == 8)
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path) == ["transition.lock"])
        for request in requests {
            // Even after the first seven releases, the last shared lease must
            // still exclude replacement; successful opens never share one FD.
            #expect(throws: AppUpdateAdmissionError.busy) {
                try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: directory)
            }
            request.release()
        }
        let update = try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: directory)
        defer { update.release() }
        try update.verifyForUpdate()
    }

    @Test("All in-flight requests release before replacement, and new ingress is fenced")
    func sharedRequestsAndExclusiveUpdate() throws {
        let f = try Fixture(); defer { f.remove() }
        let first = try AppUpdateAdmissionGate.acquireRequest(directoryURL: f.directory)
        let second = try AppUpdateAdmissionGate.acquireRequest(directoryURL: f.directory)
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
        first.release()
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
        second.release()
        let update = try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        try update.verifyForUpdate()
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppUpdateAdmissionGate.acquireRequest(directoryURL: f.directory)
        }
        update.release(); update.release()
        #expect(throws: AppUpdateAdmissionError.unavailable) { try update.verifyForUpdate() }
        let next = try AppUpdateAdmissionGate.acquireRequest(directoryURL: f.directory)
        withExtendedLifetime(next) {}
    }

    @Test("A bridge request keeps update admission continuously through exec adoption")
    func continuousExecAdmission() throws {
        let f = try Fixture(); defer { f.remove() }
        let original = try AppUpdateAdmissionGate.acquireRequest(directoryURL: f.directory)
        let inherited = dup(try original.prepareForExec())
        guard inherited >= 3 else { throw CocoaError(.fileReadUnknown) }
        var ownsInherited = true
        defer { if ownsInherited { close(inherited) } }
        original.release() // Model exec closing the original process's normal descriptions.
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
        let adopted = try AppBridgeRuntimeBootstrap.acquireStartupAdmission(
            inheritedDescriptor: String(inherited), directoryURL: f.directory
        )
        ownsInherited = false
        #expect(fcntl(inherited, F_GETFD) == -1)
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
        // main releases this only after the final runtime inode lease exists.
        adopted.release()
        let update = try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        try update.verifyForUpdate()
    }

    @Test("A direct copied launch cannot bypass active update admission")
    func copiedLaunchParticipatesInGate() throws {
        let f = try Fixture(); defer { f.remove() }
        let update = try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppBridgeRuntimeBootstrap.acquireStartupAdmission(inheritedDescriptor: nil, directoryURL: f.directory)
        }
        #expect(throws: AppUpdateAdmissionError.unavailable) { try update.prepareForExec() }
        try update.verifyForUpdate()
        update.release()
        let startup = try AppBridgeRuntimeBootstrap.acquireStartupAdmission(inheritedDescriptor: nil, directoryURL: f.directory)
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
        startup.release()
    }

    @Test("Exec adoption preserves unrelated descriptors and cannot weaken an exclusive update")
    func untrustedExecDescriptor() throws {
        let f = try Fixture(); defer { f.remove() }
        let unrelatedURL = f.root.appendingPathComponent("unrelated")
        try Data().write(to: unrelatedURL)
        #expect(chmod(unrelatedURL.path, 0o600) == 0)
        let unrelated = open(unrelatedURL.path, O_RDWR | O_NOFOLLOW)
        guard unrelated >= 3 else { throw CocoaError(.fileReadUnknown) }
        defer { close(unrelated) }
        #expect(throws: AppUpdateAdmissionError.unavailable) {
            try AppUpdateAdmissionGate.adoptInheritedRequest(descriptor: unrelated, directoryURL: f.directory)
        }
        #expect(fcntl(unrelated, F_GETFD) >= 0)
        let update = try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        let unlockedAlias = open(f.directory.appendingPathComponent("transition.lock").path, O_RDWR | O_NOFOLLOW)
        guard unlockedAlias >= 3 else { throw CocoaError(.fileReadUnknown) }
        defer { close(unlockedAlias) }
        #expect(throws: AppUpdateAdmissionError.busy) {
            try AppUpdateAdmissionGate.adoptInheritedRequest(descriptor: unlockedAlias, directoryURL: f.directory)
        }
        #expect(fcntl(unlockedAlias, F_GETFD) >= 0)
        try update.verifyForUpdate()
    }

    @Test("Shared admission cannot authorize replacement and inode replacement is detected")
    func changedLock() throws {
        let f = try Fixture(); defer { f.remove() }
        let request = try AppUpdateAdmissionGate.acquireRequest(directoryURL: f.directory)
        #expect(throws: AppUpdateAdmissionError.unavailable) { try request.verifyForUpdate() }
        request.release()
        let update = try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        let file = f.directory.appendingPathComponent("transition.lock")
        try FileManager.default.moveItem(at: file, to: f.root.appendingPathComponent("old-lock"))
        try Data().write(to: file); #expect(chmod(file.path, 0o600) == 0)
        #expect(throws: AppUpdateAdmissionError.unavailable) { try update.verifyForUpdate() }
    }

    @Test("Symlinks, hardlinks and public admission files do not become transition authority")
    func unsafeLock() throws {
        let f = try Fixture(); defer { f.remove() }
        let marker = f.root.appendingPathComponent("untouched")
        try Data("keep".utf8).write(to: marker)
        let file = f.directory.appendingPathComponent("transition.lock")
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: marker)
        #expect(throws: AppUpdateAdmissionError.unavailable) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
        #expect(try Data(contentsOf: marker) == Data("keep".utf8))
        try FileManager.default.removeItem(at: file)
        #expect(chmod(marker.path, 0o600) == 0)
        #expect(link(marker.path, file.path) == 0)
        #expect(throws: AppUpdateAdmissionError.unavailable) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
        try FileManager.default.removeItem(at: file)
        try Data().write(to: file); #expect(chmod(file.path, 0o644) == 0)
        #expect(throws: AppUpdateAdmissionError.unavailable) {
            try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: f.directory)
        }
    }

    @Test("Only long-lived client entrypoints move into the runtime store")
    func bootstrapModes() {
        for command in ["mcp", "claude-installed-launcher"] {
            #expect(AppBridgeRuntimeBootstrap.requiresDetachedRuntime(commandLine: ["coordinator", command]))
        }
        for command in ["pet", "service", "app-service", "update-helper", "hook", "claude-auto-connect", "claude-auto-launch", "runtime-identity"] {
            #expect(!AppBridgeRuntimeBootstrap.requiresDetachedRuntime(commandLine: ["coordinator", command]))
        }
        #expect(!AppBridgeRuntimeBootstrap.requiresDetachedRuntime(commandLine: []))
    }

    @Test("Active previous generations need the exact signed MCP request policy")
    func compatibility() throws {
        let current = "sha256:" + String(repeating: "a", count: 64)
        let old = "sha256:" + String(repeating: "b", count: 64)
        let other = "sha256:" + String(repeating: "c", count: 64)
        let requests = ["emit_decision", "session_start", "stop", "user_prompt_submit"]
        let candidate = OperationalRuntimeIdentitySnapshot(runtimeIdentity: current,
            compatiblePreviousRuntimes: [.init(runtimeIdentity: old, allowedRequestTypes: requests)])
        try AppUpdateTransitionPreflight.requireCompatibleRuntimes(candidate: candidate, activeIdentities: [old, current])
        #expect(throws: (any Error).self) {
            try AppUpdateTransitionPreflight.requireCompatibleRuntimes(candidate: candidate, activeIdentities: [other])
        }
        #expect(throws: (any Error).self) {
            try AppUpdateTransitionPreflight.requireCompatibleRuntimes(candidate: .init(runtimeIdentity: current,
                compatiblePreviousRuntimes: [.init(runtimeIdentity: old, allowedRequestTypes: ["emit_decision"])]),
                activeIdentities: [old])
        }
        #expect(candidate.allowedRequestTypes(forCompatibleIdentity: old)?.contains("permission_request") == false)
    }

    @Test("Unknown Claude evidence defers even if no running PID was found")
    func claudeReadiness() throws {
        try AppUpdateTransitionPreflight.requireClaudeReady(.init(status: .clear, outstandingUseCount: 0, referencedRuntimeIdentities: []))
        #expect(throws: (any Error).self) {
            try AppUpdateTransitionPreflight.requireClaudeReady(.init(status: .inUse, outstandingUseCount: 1, referencedRuntimeIdentities: []))
        }
        #expect(throws: AppUpdateTransitionError.unverified) {
            try AppUpdateTransitionPreflight.requireClaudeReady(.init(status: .unavailable, outstandingUseCount: nil, referencedRuntimeIdentities: []))
        }
    }

    @Test("Readiness rejects ambiguous replies and pending delivery acknowledgments")
    func readinessReply() throws {
        var object: [String: Any] = ["schema_version": "1.0", "kind": "blabee_update_status", "ready": true,
            "pending_approvals": 0, "pending_deliveries": 0, "pending_cards": 0, "pending_queued_actions": 0,
            "pending_reconciliation": 0, "pending_claim_responses": 0, "pending_prompt_contexts": 0,
            "service_pid": 123, "service_parent_pid": 122]
        try AppUpdateServiceReadiness.parse(JSONSerialization.data(withJSONObject: object)).requireReady()
        object["pending_deliveries"] = 1
        #expect(throws: (any Error).self) {
            try AppUpdateServiceReadiness.parse(JSONSerialization.data(withJSONObject: object))
        }
        object["ready"] = false
        let waiting = try AppUpdateServiceReadiness.parse(JSONSerialization.data(withJSONObject: object))
        #expect(throws: (any Error).self) { try waiting.requireReady() }
        object["pending_deliveries"] = -1
        #expect(throws: (any Error).self) {
            try AppUpdateServiceReadiness.parse(JSONSerialization.data(withJSONObject: object))
        }
    }

    private actor ConcurrentStart {
        let participants: Int
        var waiting: [CheckedContinuation<Void, Never>] = []
        init(participants: Int) { self.participants = participants }
        func wait() async {
            await withCheckedContinuation { continuation in
                waiting.append(continuation)
                if waiting.count == participants {
                    for continuation in waiting { continuation.resume() }
                    waiting.removeAll()
                }
            }
        }
    }

    private struct Fixture {
        let root: URL, directory: URL
        init() throws {
            let base = try #require(AppUpdateRuntimeCopy.physicalPath(FileManager.default.temporaryDirectory))
            root = URL(fileURLWithPath: base).appendingPathComponent("blabee-update-admission-test-" + UUID().uuidString)
            directory = root.appendingPathComponent("admission")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
        }
        func remove() { try? FileManager.default.removeItem(at: root) }
    }
}
