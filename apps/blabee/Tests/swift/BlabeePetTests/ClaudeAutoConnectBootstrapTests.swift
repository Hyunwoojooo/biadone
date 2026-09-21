#if BLABEE_JOURNAL_TEST_HARNESS
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Claude automatic connection bootstrap", .serialized)
struct ClaudeAutoConnectBootstrapTests {
    @Test("MCP-first and a cancelled picker create no owner authority")
    func pendingPicker() throws {
        let fixture = try BootstrapFixture()
        defer { fixture.close() }
        let response = try fixture.request(operation: "grant", role: "bridge")
        #expect(response["status"] as? String == "pending")
        #expect(response["environment"] == nil)
        #expect(fixture.state.count == 0)
        #expect(fixture.state.invalidations == 0)
        let path = fixture.bootstrap.socketPath
        fixture.bootstrap.close()
        #expect(!FileManager.default.fileExists(atPath: path))
        #expect(fixture.state.count == 0)
    }

    @Test("Real Hook registration gives each requester only its own role capability", arguments: ["startup", "resume", "fork"])
    func roleScopedGrant(source: String) throws {
        let fixture = try BootstrapFixture()
        defer { fixture.close() }
        let first = try fixture.request(operation: "start", source: source)
        #expect(first["status"] as? String == "ready")
        let hook = try #require(first["environment"] as? [String: String])
        let bridge = try #require(fixture.request(operation: "grant", role: "bridge")["environment"] as? [String: String])
        let prefix = ClaudeInstalledLaunchConfiguration.prefix
        #expect(hook[prefix + "HOOK_TOKEN"] == String(repeating: "a", count: 64))
        #expect(hook[prefix + "BRIDGE_TOKEN"] == nil)
        #expect(bridge[prefix + "BRIDGE_TOKEN"] == String(repeating: "b", count: 64))
        #expect(bridge[prefix + "HOOK_TOKEN"] == nil)
        #expect(hook.count == 11 && bridge.count == 11)
        #expect(fixture.state.count == 1)
        #expect(fixture.state.observed == .init(nativeSessionID: fixture.native, source: source))
    }

    @Test("Authenticated replay, native ID change and cwd change retire rather than rebind", arguments: ["replay", "native", "cwd"])
    func changesRetire(_ change: String) throws {
        let fixture = try BootstrapFixture()
        defer { fixture.close() }
        _ = try fixture.request(operation: "start", source: "resume")
        var overrides: [String: Any] = [:]
        if change == "native" { overrides["native_session_id"] = UUID().uuidString.lowercased() }
        if change == "cwd" { overrides["cwd"] = "/private/tmp" }
        let response = try fixture.request(operation: change == "replay" ? "start" : "grant",
            source: change == "replay" ? "resume" : nil, overrides: overrides)
        #expect(response["ok"] as? Bool == false)
        #expect(fixture.state.count == 1)
        #expect(fixture.state.invalidations == 1)
        let later = try fixture.request(operation: "grant")
        #expect((later["error"] as? [String: String])?["code"] == "claude_bootstrap_unavailable")
    }

    @Test("Wrong role and another launch's token cannot enroll or revoke this launch")
    func roleAndLaunchIsolation() throws {
        let fixture = try BootstrapFixture(), other = try BootstrapFixture()
        defer { fixture.close(); other.close() }
        let bridgeStart = try fixture.request(operation: "start", role: "bridge", source: "startup")
        #expect((bridgeStart["error"] as? [String: String])?["code"] == "claude_bootstrap_unauthorized")
        let stale = try fixture.request(operation: "start", source: "startup", overrides: [
            "auth_token": other.bootstrap.childEnvironment["BLABEE_CLAUDE_BOOTSTRAP_HOOK_TOKEN"]!])
        #expect((stale["error"] as? [String: String])?["code"] == "claude_bootstrap_unauthorized")
        #expect(fixture.state.count == 0 && fixture.state.invalidations == 0)
        _ = try fixture.request(operation: "start", source: "startup")
        #expect(fixture.state.count == 1)
    }

    @Test("Socket and directory are private; credentials are absent from filesystem content")
    func privateFiles() throws {
        let fixture = try BootstrapFixture()
        defer { fixture.close() }
        for (path, mode) in [(fixture.bootstrap.directory.path, mode_t(0o700)), (fixture.bootstrap.socketPath, mode_t(0o600))] {
            var info = stat()
            #expect(lstat(path, &info) == 0)
            #expect(info.st_uid == geteuid())
            #expect(info.st_mode & 0o777 == mode)
        }
        #expect(try FileManager.default.contentsOfDirectory(atPath: fixture.bootstrap.directory.path) == ["b.sock"])
    }

    @Test("A foreign same-user process is rejected despite knowing a role token")
    func foreignProcess() throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["10"]
        try child.run()
        defer { child.terminate(); child.waitUntilExit() }
        let fixture = try BootstrapFixture(childPID: child.processIdentifier)
        defer { fixture.close() }
        #expect(throws: (any Error).self) { _ = try fixture.request(operation: "start", source: "startup") }
        #expect(fixture.state.count == 0)
    }

    @Test("Strict bounded frames reject extra fields, duplicate JSON keys and oversized payloads")
    func boundedFrames() throws {
        let fixture = try BootstrapFixture()
        defer { fixture.close() }
        let extra = try fixture.request(operation: "grant", overrides: ["owner_token": "not-a-capability"])
        #expect((extra["error"] as? [String: String])?["code"] == "claude_bootstrap_invalid_request")
        #expect(throws: (any Error).self) {
            _ = try fixture.exchange(Data("{\"request_id\":\"a\",\"request_id\":\"b\"}".utf8))
        }
        let large = Data(("{\"padding\":\"" + String(repeating: "x", count: 20_000) + "\"}").utf8)
        #expect(throws: (any Error).self) { _ = try fixture.exchange(large) }
        #expect(fixture.state.count == 0)
    }

    @Test("Closing interrupts partial readers and rejects a delayed enrollment result")
    func closeDuringEnrollment() throws {
        let fixture = try BootstrapFixture(blockEnrollment: true)
        defer { fixture.close() }
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            _ = try? fixture.request(operation: "start", source: "resume")
            done.signal()
        }
        #expect(fixture.state.started.wait(timeout: .now() + 2) == .success)
        fixture.bootstrap.close()
        #expect(done.wait(timeout: .now() + 1) == .success)
        fixture.state.release.signal()
        #expect(fixture.state.finished.wait(timeout: .now() + 2) == .success)
        #expect(fixture.state.count == 1)
        #expect(!FileManager.default.fileExists(atPath: fixture.bootstrap.socketPath))
    }
}

private final class BootstrapState: @unchecked Sendable {
    private let lock = NSLock()
    private var enrollments = 0
    private var revoked = 0
    private var observation: ClaudeInstalledOwnerConnection.ObservedSession?
    private var active = false
    let started = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    let finished = DispatchSemaphore(value: 0)
    let block: Bool
    init(block: Bool) { self.block = block }
    var count: Int { lock.withLock { enrollments } }
    var invalidations: Int { lock.withLock { revoked } }
    var observed: ClaudeInstalledOwnerConnection.ObservedSession? { lock.withLock { observation } }
    var available: Bool { lock.withLock { active } }
    func invalidate() { lock.withLock { revoked += 1; active = false } }
    func enroll(_ value: ClaudeInstalledOwnerConnection.ObservedSession, cwd: String) throws -> [String: String] {
        lock.withLock { enrollments += 1; observation = value }
        started.signal()
        if block { _ = release.wait(timeout: .now() + 5) }
        defer { finished.signal() }
        lock.withLock { active = true }
        let prefix = ClaudeInstalledLaunchConfiguration.prefix
        var environment = ClaudeInstalledLaunchConfiguration.publicEnvironmentNames.reduce(into: [String: String]()) {
            $0[prefix + $1] = UUID().uuidString.lowercased()
        }
        environment[prefix + "SOCKET"] = cwd + "/session.sock"
        environment[prefix + "RUNTIME_IDENTITY"] = "sha256:" + String(repeating: "c", count: 64)
        environment[prefix + "CWD"] = cwd
        environment[prefix + "CHANNEL_SOURCE"] = "blabee-claude"
        environment[prefix + "NATIVE_SESSION_ID"] = value.nativeSessionID.uuidString.lowercased()
        environment[prefix + "HOOK_TOKEN"] = String(repeating: "a", count: 64)
        environment[prefix + "BRIDGE_TOKEN"] = String(repeating: "b", count: 64)
        return environment
    }
}

private final class BootstrapFixture: @unchecked Sendable {
    let root: URL
    let native = UUID()
    let state: BootstrapState
    let bootstrap: ClaudeAutoConnectBootstrap
    init(childPID: Int32 = getpid(), blockEnrollment: Bool = false) throws {
        let root = URL(fileURLWithPath: "/private/tmp/bca-" + UUID().uuidString.lowercased().prefix(10))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        self.root = root
        let state = BootstrapState(block: blockEnrollment)
        self.state = state
        bootstrap = try ClaudeAutoConnectBootstrap(cwd: root.path, root: root,
            enroll: { try state.enroll($0, cwd: root.path) }, available: { state.available },
            invalidated: { state.invalidate() })
        try bootstrap.activate(childPID: childPID)
    }
    func close() { bootstrap.close(); state.release.signal(); try? FileManager.default.removeItem(at: root) }
    func request(operation: String, role: String = "hook", source: String? = nil,
                 overrides: [String: Any] = [:]) throws -> [String: Any] {
        var request: [String: Any] = ["schema_version": ClaudeAutoConnectBootstrap.schema,
            "request_id": UUID().uuidString.lowercased(), "operation": operation, "role": role,
            "auth_token": bootstrap.childEnvironment["BLABEE_CLAUDE_BOOTSTRAP_" + role.uppercased() + "_TOKEN"]!,
            "native_session_id": native.uuidString.lowercased(), "cwd": root.path]
        if let source { request["source"] = source }
        request.merge(overrides) { _, next in next }
        return try StrictJSONTransport.object(from: exchange(StrictJSONTransport.data(forJSONObject: request)))
    }
    func exchange(_ data: Data) throws -> Data {
        let descriptor = try ClaudeInstalledOwnerIO.connect(bootstrap.socketPath)
        defer { Darwin.close(descriptor) }
        try ClaudeInstalledOwnerIO.sendFrame(data, descriptor: descriptor, passing: nil, deadline: ClaudeInstalledOwnerIO.deadline())
        return try ClaudeInstalledOwnerIO.readFrame(descriptor, deadline: ClaudeInstalledOwnerIO.deadline())
    }
}
#endif
