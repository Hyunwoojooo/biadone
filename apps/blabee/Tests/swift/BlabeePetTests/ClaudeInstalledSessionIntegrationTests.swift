#if BLABEE_JOURNAL_TEST_HARNESS
import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

private final class CP05Freshness: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot: String
    private let lock = NSLock()
    private var value: FreshnessStoredRecord?
    init(_ slot: String) { storageSlot = slot }
    func load() throws -> FreshnessStoredRecord? { lock.withLock { value } }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard value == nil else { throw CoordinatorError("cp05_fixture_conflict") }
            let result = try FreshnessStoredRecord(record: record, revision: record.revision)
            value = result
            return result
        }
    }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        try lock.withLock {
            guard value?.revision == expectedRevision else { throw CoordinatorError("cp05_fixture_conflict") }
            let result = try FreshnessStoredRecord(record: replacement, revision: replacement.revision)
            value = result
            return result
        }
    }
}

private struct CP05CodexProbe: CoordinatorOperationalHandling {
    func handle(type: String, payload: Data) async throws -> Data { Data("{\"codex_preserved\":true}".utf8) }
    func doctorStatus(payload: Data) async throws -> Data { Data("{}".utf8) }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
}

private final class CP05EnrollmentCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.withLock { value } }
    func increment() { lock.withLock { value += 1 } }
}

@Suite("Installed session actual IPC", .serialized)
struct ClaudeInstalledSessionIntegrationTests {
    private var publicArguments: [String] {
        ["--owner-socket", "/private/tmp/owner.sock", "--session-socket", "/private/tmp/session.sock",
         "--runtime-identity", "sha256:" + String(repeating: "a", count: 64),
         "--cwd", "/private/tmp/한글 project ' $literal", "--claude-bin", "/opt/tools/claude",
         "--node-bin", "/opt/tools/node", "--payload-root", "/opt/Blabee bridge"]
    }

    @Test("The native CLI preserves path arguments without interpreting shell characters")
    func publicCLIArguments() throws {
        let parsed = try ClaudeInstalledLauncherArguments(publicArguments + ["--terminal"])
        #expect(parsed.openTerminal)
        #expect(parsed.options.cwd.path == "/private/tmp/한글 project ' $literal")
        #expect(parsed.options.payloadRoot.path == "/opt/Blabee bridge")
        #expect(try ClaudeInstalledLauncherArguments(publicArguments).openTerminal == false)
    }

    @Test("Observe mode forwards ordinary resume and literal prompt arguments after its own delimiter")
    func observedCLIArguments() throws {
        let forwarded = ["--resume", "native-id-or-name", "--", "literal ' $(do-not-run)"]
        let parsed = try ClaudeInstalledLauncherArguments(publicArguments + ["--observe-session", "--"] + forwarded)
        #expect(parsed.options.observeSession)
        #expect(parsed.options.claudeArguments == forwarded)
        #expect(!parsed.openTerminal)
        #expect(throws: CoordinatorError.self) {
            _ = try ClaudeInstalledLauncherArguments(publicArguments + ["--"] + forwarded)
        }
        #expect(throws: CoordinatorError.self) {
            _ = try ClaudeInstalledLauncherArguments(publicArguments + ["--observe-session", "--observe-session"])
        }
        #expect(throws: CoordinatorError.self) {
            _ = try ClaudeInstalledLauncherArguments(publicArguments + ["--observe-session", "--", "bad\0value"])
        }
    }

    @Test("Credentials and native permission or session overrides are never CLI inputs",
          arguments: ["--owner-token", "--hook-token", "--resume", "--continue", "--mcp-config",
                      "--permission-mode", "--dangerously-skip-permissions", "--channel-source"])
    func rejectCLIOverrides(_ argument: String) {
        #expect(throws: CoordinatorError.self) {
            _ = try ClaudeInstalledLauncherArguments(publicArguments + [argument, "forbidden"])
        }
    }

    @Test("Duplicate options, relative paths and incomplete launch bindings fail before registration")
    func rejectMalformedCLI() {
        #expect(throws: CoordinatorError.self) {
            _ = try ClaudeInstalledLauncherArguments(publicArguments + ["--cwd", "/another"])
        }
        #expect(throws: CoordinatorError.self) {
            _ = try ClaudeInstalledLauncherArguments(publicArguments + ["--terminal", "--terminal"])
        }
        var relative = publicArguments
        relative[1] = "relative.sock"
        #expect(throws: CoordinatorError.self) { _ = try ClaudeInstalledLauncherArguments(relative) }
        #expect(throws: CoordinatorError.self) { _ = try ClaudeInstalledLauncherArguments(Array(publicArguments.dropLast())) }
    }

    @Test("Native private registration reaches command Hook and stdio MCP over the common product UDS")
    func actualHookAndMCP() async throws {
        let application = try await Task.detached { try Self.runActualIPC() }.value
        let codex = try await application.handle(type: "codex_fixture", payload: Data("{}".utf8))
        #expect(try StrictJSONTransport.object(from: codex)["codex_preserved"] as? Bool == true)
    }

    @Test("A real PTY child owns the foreground, inherits no private FDs, and restores the native launcher")
    func actualSupervisorPTY() async throws {
        _ = try await Task.detached { try Self.runActualIPC(tty: true) }.value
    }

    static func runActualIPC(tty: Bool = false, packaged: Bool = false, orphan: Bool = false,
                             autoSource: String? = nil) throws -> ClaudeProductServiceCoordinator {
        var node = try #require(ProcessInfo.processInfo.environment["BLABEE_CP05_NODE"],
                                "Use the isolated test:installed-session runner")
        var repository = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { repository.deleteLastPathComponent() }
        let root = URL(fileURLWithPath: "/private/tmp/bc5-" + UUID().uuidString.lowercased().prefix(10))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        defer {
            // Immutable product copies are never GC'd. This owned test tree is
            // explicitly dismantled only after every fixture child has ended.
            if let paths = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) {
                for case let path as URL in paths {
                    var isDirectory: ObjCBool = false
                    if FileManager.default.fileExists(atPath: path.path, isDirectory: &isDirectory), isDirectory.boolValue {
                        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path.path)
                    }
                }
            }
            try? FileManager.default.removeItem(at: root)
        }
        var payload = repository.appendingPathComponent("bridges/claude")
        let payloadStore = root.appendingPathComponent("runtime-payload")
        var payloadUse: ClaudeRuntimePayloadUse?
        if packaged {
            let input = try #require(ProcessInfo.processInfo.environment["BLABEE_CP07_RUNTIME_ROOT"],
                                     "Prepare a qualified runtime and use test:runtime-payload -- --packaged")
            let copied = root.appendingPathComponent("bundled-runtime")
            try FileManager.default.copyItem(at: URL(fileURLWithPath: input), to: copied)
            if tty {
                payload = copied.appendingPathComponent("payload")
                node = copied.appendingPathComponent("node/bin/node").path
            } else {
                let prepared = try ClaudeRuntimePayload.prepare(bundleRootURL: copied, storeRootURL: payloadStore)
                payloadUse = try ClaudeRuntimePayloadUse.begin(prepared: prepared,
                    runtimeIdentity: "sha256:" + String(repeating: "a", count: 64), storeRootURL: payloadStore)
                payload = prepared.payloadRoot
                node = prepared.nodeExecutable.path
                try FileManager.default.removeItem(at: copied)
            }
        }
        defer { try? payloadUse?.complete() }
        let corpus = RuntimeSecretCorpus()
        let identity = "sha256:" + String(repeating: "a", count: 64)
        let store = try ClaudeBridgeConfiguration.privateChild(of: root, name: "store")
        let registry = try ClaudeSessionRegistry(rootURL: store, runtimeIdentity: identity,
            secretCorpus: corpus, freshnessFactory: { CP05Freshness($0) })
        let ownerSocket = root.appendingPathComponent("owner.sock").path
        let enrollments = CP05EnrollmentCounter()
        let enrollment = try ClaudeSessionEnrollment.makeTesting(socketPath: ownerSocket,
            runtimeIdentity: identity, serviceIncarnation: registry.serviceIncarnation, secretCorpus: corpus,
            enroll: { connection, request, grant in
                enrollments.increment()
                return try registry.enroll(connectionID: connection, request: request, deliverGrant: grant)
            },
            control: { try registry.control(connectionID: $0, request: $1) },
            disconnected: { registry.disconnect(connectionID: $0) })
        try enrollment.start()
        let application = ClaudeProductServiceCoordinator(codex: CP05CodexProbe(), registry: registry, enrollment: enrollment)
        defer { application.stop() }
        let socket = root.appendingPathComponent("session.sock").path
        let server = try UnixDomainSocketServer(socketPath: socket, runtimeIdentity: identity)
        try server.activate()
        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            defer { finished.signal() }
            try? server.run(application: application, secretCorpus: corpus)
        }
        defer { server.stop(); _ = finished.wait(timeout: .now() + 5) }
        let owner = tty ? nil : try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: ownerSocket,
            runtimeIdentity: identity, canonicalCWD: root.path)
        defer { owner?.close() }
        let other = try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: ownerSocket,
            runtimeIdentity: identity, canonicalCWD: root.path)
        defer { other.close() }
        #expect(registry.activeScopeCount == (tty ? 1 : 2))

        var environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("BLABEE_") }
        if packaged {
            environment["PATH"] = "/usr/bin:/bin"
            environment["HOME"] = root.path
            environment["NODE_PATH"] = nil
            environment["NODE_OPTIONS"] = nil
        }
        if let owner { environment.merge(try owner.childEnvironment(sessionSocketPath: socket)) { _, next in next } }
        let configuration = try owner.map { owner in
            try ClaudeInstalledConfigurationFiles(root: root,
                documents: ClaudeInstalledLaunchConfiguration.documents(nodeExecutable: URL(fileURLWithPath: node),
                    payloadRoot: payload,
                    nativeSessionID: owner.identity.nativeSessionID))
        }
        defer { withExtendedLifetime(configuration) {} }
        let process = Process()
        let copiedDriver = root.appendingPathComponent("runtime-driver.mjs")
        if packaged {
            try FileManager.default.copyItem(at: repository.appendingPathComponent("Tests/bridges/claude/integration/installed-session-driver.mjs"), to: copiedDriver)
        }
        if let autoSource {
            let coordinator = try #require(ProcessInfo.processInfo.environment["BLABEE_CP05_COORDINATOR"])
            process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            process.arguments = [repository.appendingPathComponent("Tests/bridges/claude/integration/auto-connect-session-pty.py").path,
                coordinator, node, payload.path, root.path, ownerSocket, socket, identity, autoSource]
        } else if tty && packaged {
            let coordinator = try #require(ProcessInfo.processInfo.environment["BLABEE_CP05_COORDINATOR"])
            process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            process.arguments = [repository.appendingPathComponent("Tests/bridges/claude/integration/packaged-session-pty.py").path,
                coordinator, node, payload.path, root.path, ownerSocket, socket, identity, payloadStore.path,
                orphan ? "owner-kill" : "normal"]
        } else if tty {
            let coordinator = try #require(ProcessInfo.processInfo.environment["BLABEE_CP05_COORDINATOR"])
            process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            process.arguments = [repository.appendingPathComponent("Tests/bridges/claude/integration/installed-session-pty.py").path,
                coordinator, node, repository.appendingPathComponent("bridges/claude").path, root.path,
                ownerSocket, socket, identity]
        } else {
            let configuration = try #require(configuration)
            process.executableURL = URL(fileURLWithPath: node)
            process.arguments = [packaged ? copiedDriver.path : repository.appendingPathComponent("Tests/bridges/claude/integration/installed-session-driver.mjs").path,
                                 configuration.settings.path, configuration.mcp.path]
        }
        process.currentDirectoryURL = root
        process.environment = environment
        let stdout = Pipe(), stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        let exited = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in exited.signal() }
        try process.run()
        let completed = exited.wait(timeout: .now() + 45) == .success
        if !completed {
            process.terminate()
            if exited.wait(timeout: .now() + 2) != .success, process.isRunning {
                _ = kill(process.processIdentifier, SIGKILL)
                _ = exited.wait(timeout: .now() + 2)
            }
        }
        #expect(completed, "Node Hook/MCP fixture exceeded its bounded runtime")
        guard completed else { throw CoordinatorError("cp05_fixture_timeout") }
        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        let diagnostics = stderr.fileHandleForReading.readDataToEndOfFile()
        let roleValues = environment.filter { $0.key.hasSuffix("_TOKEN") && $0.key.hasPrefix("BLABEE_") }.map(\.value)
        for value in roleValues {
            #expect(output.range(of: Data(value.utf8)) == nil)
            #expect(diagnostics.range(of: Data(value.utf8)) == nil)
        }
        #expect(process.terminationStatus == 0,
                "Node fixture failed: \(String(data: diagnostics, encoding: .utf8) ?? "invalid diagnostic")")
        guard process.terminationStatus == 0 else { throw CoordinatorError("cp05_fixture_failed") }
        let report = try StrictJSONTransport.object(from: output)
        #expect(report["ok"] as? Bool == true)
        if let autoSource {
            #expect(report["source"] as? String == autoSource)
            #expect(report["foregroundRestored"] as? Bool == true)
            if autoSource == "preflight-cancel" {
                #expect(report["cancelledBeforeSpawn"] as? Bool == true)
                #expect(enrollments.count == 1)
            } else {
                #expect(report["mcpInitializedWhilePending"] as? Bool == true)
                #expect(report["argumentsPreserved"] as? Bool == true)
                #expect(report["privateFDsAbsent"] as? Bool == true)
            }
            if autoSource == "picker-cancel" {
                #expect(report["cancelledWithoutRegistration"] as? Bool == true)
                #expect(enrollments.count == 1, "Only the unrelated control session may enroll while a picker waits")
            } else if autoSource != "preflight-cancel" {
                #expect(enrollments.count == 2, "Exactly one observed native session may enroll")
                #expect(report["nativeIdentityPreserved"] as? Bool == true)
                #expect(report["channelAcknowledged"] as? Bool == true)
                #expect(report["freshBoundary"] as? Bool == true)
            }
        } else if tty && packaged {
            #expect(report["immutablePaths"] as? Bool == true)
            if orphan {
                #expect(report["ownerKilled"] as? Bool == true)
                #expect(report["delayedImport"] as? Bool == true)
                #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: payloadStore) == .inUse)
                #expect(throws: (any Error).self) {
                    _ = try ClaudeRuntimePayloadUse.acquireInstallationGuard(storeRootURL: payloadStore)
                }
            } else {
                #expect(report["channelAcknowledged"] as? Bool == true)
                #expect(ClaudeRuntimePayloadUse.inspect(storeRootURL: payloadStore) == .clear)
            }
        } else if tty {
            #expect(report["tty"] as? Bool == true)
            #expect(report["foregroundRestored"] as? Bool == true)
            #expect(report["childExitObserved"] as? Bool == true)
            #expect(report["privateFDsAbsent"] as? Bool == true)
            #expect(report["suspendResumed"] as? Bool == true)
            #expect(report["backgroundPreserved"] as? Bool == true)
        } else {
            #expect(report["channelAcknowledged"] as? Bool == true)
            #expect(report["proposalSaved"] as? Bool == true)
            #expect(report["compactRebound"] as? Bool == true)
            #expect(report["sessionEnded"] as? Bool == true)
        }
        #expect(report["realModel"] as? Bool == false)
        #expect(registry.activeScopeCount == 1)
        if let entries = FileManager.default.enumerator(at: store, includingPropertiesForKeys: [.isRegularFileKey]) {
            for case let path as URL in entries where (try path.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true {
                let bytes = try Data(contentsOf: path)
                for value in roleValues { #expect(bytes.range(of: Data(value.utf8)) == nil, "Role credential was persisted") }
            }
        }
        return application
    }
}

@Suite("Automatic Claude session actual IPC", .serialized)
struct ClaudeAutoConnectIntegrationTests {
    @Test("A real PTY child picks its native session before Hook/MCP authority exists",
          arguments: ["startup", "resume", "picker-cancel", "preflight-cancel"])
    func actualAutomaticSupervisor(source: String) async throws {
        _ = try await Task.detached {
            try ClaudeInstalledSessionIntegrationTests.runActualIPC(tty: true, autoSource: source)
        }.value
    }
}

@Suite("Packaged Claude runtime actual IPC", .serialized)
struct ClaudeInstalledPackagedIntegrationTests {
    @Test("Copied Node and SDK run Hooks and MCP without checkout or user Node in PATH")
    func actualPackagedHookAndMCP() async throws {
        _ = try await Task.detached { try ClaudeInstalledSessionIntegrationTests.runActualIPC(packaged: true) }.value
    }
    @Test("The real owner pins generated Hook and MCP paths until its child is reaped")
    func actualPackagedLauncher() async throws {
        _ = try await Task.detached { try ClaudeInstalledSessionIntegrationTests.runActualIPC(tty: true, packaged: true) }.value
    }
    @Test("Killing the owner retains an update blocker and orphan Node can import a module later")
    func ownerKillPreservesRuntime() async throws {
        _ = try await Task.detached { try ClaudeInstalledSessionIntegrationTests.runActualIPC(tty: true, packaged: true, orphan: true) }.value
    }
}
#endif
