#if BLABEE_TEST_APP
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class BlabeeTestEngineServiceFixture {
    let parent: URL
    let store: BlabeeTestRunStore
    let run: BlabeeTestRunManifest
    let executable: URL

    init() throws {
        parent = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent("blabee-engine-service-tests-" + UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        store = try BlabeeTestRunStore(rootURL: parent.appendingPathComponent("store", isDirectory: true))
        run = try store.create(scenario: .engineIsolation)
        executable = parent.appendingPathComponent("Blabee Test.app/Contents/MacOS/blabee-coordinator")
    }

    func dependencies(child: BlabeeTestEngineFakeChild = .init(),
                      request: @escaping @Sendable (BlabeeTestEngineRequest) throws -> Data = { _ in Data("{}".utf8) })
        -> BlabeeTestEngineSessionDependencies {
        .init(executable: { self.executable }, selectorKey: { _, _ in Data(repeating: 0x2a, count: 32) },
              spawn: { _ in child }, request: request)
    }

    func cleanup() {
        if let socket = try? BlabeeTestRunStore.proposedSocketURL(runID: run.runID) {
            try? FileManager.default.removeItem(at: socket.deletingLastPathComponent())
        }
        try? FileManager.default.removeItem(at: parent)
    }
}

@MainActor
private final class BlabeeTestEngineFakeChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = false
    var terminationSummary: String?
    var petSelectorCredential: String? { String(repeating: "a", count: 64) }
    var exitsOnStop = true
    private(set) var stopCount = 0
    func stop() async { stopCount += 1; if exitsOnStop { isRunning = false } }
}

private final class BlabeeTestEngineRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [BlabeeTestEngineRequest] = []
    let release = DispatchSemaphore(value: 0)
    var count: Int { lock.withLock { requests.count } }
    var last: BlabeeTestEngineRequest? { lock.withLock { requests.last } }
    func record(_ request: BlabeeTestEngineRequest, hold: Bool = false) -> Data {
        lock.withLock { requests.append(request) }
        if hold { _ = release.wait(timeout: .now() + .seconds(5)) }
        return Data("{}".utf8)
    }
}

private struct BlabeeTestEngineUnusedFreshness: FreshnessAnchorStore {
    let storageSlot: String
    func load() throws -> FreshnessStoredRecord? { throw CoordinatorError("unexpected_freshness_call") }
    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord { throw CoordinatorError("unexpected_freshness_call") }
    func compareAndSwap(expectedRevision: Data, replacement: FreshnessRecord) throws -> FreshnessStoredRecord {
        throw CoordinatorError("unexpected_freshness_call")
    }
}

@Suite("Blabee Test Engine service ownership (no live process or Keychain)", .serialized)
@MainActor
struct BlabeeTestEngineServiceTests {
    @Test("Child arguments admit only canonical store/run/launch/parent coordinates")
    func strictArguments() throws {
        let run = UUID(uuidString: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")!, launch = UUID()
        let values = ["--store-root", "/private/tmp/blabee-owned-test", "--run-id", run.uuidString.lowercased(),
                      "--launch-id", launch.uuidString.lowercased(), "--parent-pid", "123"]
        let parsed = try BlabeeTestEngineServiceArguments(arguments: values)
        #expect(parsed.arguments == values)
        try parsed.validateParent(currentParentPID: 123)
        #expect(throws: CoordinatorError.self) { try parsed.validateParent(currentParentPID: 124) }
        var invalid = [Array(values.dropLast()), values + ["--key", "secret"], ["test-engine-service"] + values]
        for (index, value) in [(1, "relative"), (1, "/private/tmp/../other"), (1, "/private/./tmp"),
                               (1, "/private//tmp"), (1, "/private/tmp/"), (1, "/private/tmp\u{0}ignored"),
                               (3, run.uuidString.uppercased()),
                               (5, "invalid"), (7, "1"), (7, "0123"), (7, "-123")] {
            var changed = values
            changed[index] = value
            invalid.append(changed)
        }
        for arguments in invalid {
            #expect(throws: CoordinatorError.self) { try BlabeeTestEngineServiceArguments(arguments: arguments) }
        }
    }

    @Test("Existing private temporary paths retain their spelling while system aliases remain rejected")
    func existingPrivateTemporaryPath() throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let invocation = try BlabeeTestEngineServiceArguments(storeRootURL: fixture.store.rootURL,
            runID: fixture.run.runID, launchID: UUID(), parentPID: getpid())
        #expect(invocation.storeRootURL.path == fixture.store.rootURL.path)
        #expect(invocation.arguments[1].hasPrefix("/private/tmp/"))
        let descriptor = try BlabeeTestEngineBundleGuard.openDirectory(fixture.parent)
        close(descriptor)
        let alias = URL(fileURLWithPath: "/tmp", isDirectory: true)
            .appendingPathComponent(fixture.parent.lastPathComponent, isDirectory: true)
        #expect(throws: CoordinatorError.self) {
            let aliasDescriptor = try BlabeeTestEngineBundleGuard.openDirectory(alias)
            close(aliasDescriptor)
        }
    }

    @Test("Bundle guard rejects profile mismatch, substituted executables, links and writable code")
    func exactBundleGuard() throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let bundle = fixture.parent.appendingPathComponent("Blabee Test.app", isDirectory: true)
        let info: [String: Any] = [
            "CFBundleIdentifier": "com.biadone.blabee.test", "CFBundleExecutable": "blabee-coordinator",
            "BlabeeDistributionProfile": "blabee-test", "BlabeeTestMode": "isolated-development",
            "BlabeeTestMilestone": "M2", "BlabeeTestSimulationOnly": false, "BlabeeTestEngineEnabled": true,
        ]
        try FileManager.default.createDirectory(at: fixture.executable.deletingLastPathComponent(),
            withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data("test-only-stub".utf8).write(to: fixture.executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fixture.executable.path)
        #expect(try BlabeeTestEngineBundleGuard.executable(bundleURL: bundle, info: info,
                                                         executableURL: fixture.executable) == fixture.executable)
        var productInfo = info
        productInfo["CFBundleIdentifier"] = "com.biadone.blabee"
        #expect(throws: (any Error).self) {
            try BlabeeTestEngineBundleGuard.executable(bundleURL: bundle, info: productInfo, executableURL: fixture.executable)
        }
        #expect(throws: CoordinatorError.self) {
            try BlabeeTestEngineBundleGuard.executable(bundleURL: bundle, info: info,
                                                       executableURL: fixture.parent.appendingPathComponent("blabee-coordinator"))
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o777], ofItemAtPath: fixture.executable.path)
        #expect(throws: CoordinatorError.self) {
            try BlabeeTestEngineBundleGuard.executable(bundleURL: bundle, info: info, executableURL: fixture.executable)
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: fixture.executable.path)
        let replacement = fixture.parent.appendingPathComponent("replacement")
        try FileManager.default.moveItem(at: fixture.executable, to: replacement)
        try FileManager.default.createSymbolicLink(at: fixture.executable, withDestinationURL: replacement)
        #expect(throws: CoordinatorError.self) {
            try BlabeeTestEngineBundleGuard.executable(bundleURL: bundle, info: info, executableURL: fixture.executable)
        }
        try FileManager.default.removeItem(at: fixture.executable)
        try FileManager.default.moveItem(at: replacement, to: fixture.executable)
        let contents = bundle.appendingPathComponent("Contents", isDirectory: true)
        let movedContents = fixture.parent.appendingPathComponent("relocated-contents", isDirectory: true)
        try FileManager.default.moveItem(at: contents, to: movedContents)
        try FileManager.default.createSymbolicLink(at: contents, withDestinationURL: movedContents)
        #expect(throws: CoordinatorError.self) {
            try BlabeeTestEngineBundleGuard.executable(bundleURL: bundle, info: info, executableURL: fixture.executable)
        }
    }

    @Test("Runtime identity changes for every run, launch and selector key")
    func runtimeBinding() throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let second = try fixture.store.create(scenario: .engineIsolation)
        defer {
            if let socket = try? BlabeeTestRunStore.proposedSocketURL(runID: second.runID) {
                try? FileManager.default.removeItem(at: socket.deletingLastPathComponent())
            }
        }
        let launch = UUID(), key = Data(repeating: 0x31, count: 32)
        let identity = try BlabeeTestEngineRuntimeBinding.identity(run: fixture.run, launchID: launch, selectorKey: key)
        #expect(OperationalRuntimeIdentity.isValid(identity))
        #expect(identity == (try BlabeeTestEngineRuntimeBinding.identity(run: fixture.run, launchID: launch, selectorKey: key)))
        #expect(identity != (try BlabeeTestEngineRuntimeBinding.identity(run: second, launchID: launch, selectorKey: key)))
        #expect(identity != (try BlabeeTestEngineRuntimeBinding.identity(run: fixture.run, launchID: UUID(), selectorKey: key)))
        #expect(identity != (try BlabeeTestEngineRuntimeBinding.identity(run: fixture.run, launchID: launch, selectorKey: Data(repeating: 0x32, count: 32))))
        #expect(try BlabeeTestEngineRuntimeBinding.selectorCredential(key: key) == String(repeating: "31", count: 32))
        #expect(throws: CoordinatorError.self) { try BlabeeTestEngineRuntimeBinding.selectorCredential(key: Data()) }
    }

    @Test("Bundle admission precedes key creation and child creation")
    func constructorAdmission() throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        var keyCalls = 0, spawnCalls = 0
        var dependencies = BlabeeTestEngineSessionDependencies(executable: {
            throw CoordinatorError("test_engine_bundle_invalid")
        }, selectorKey: { _, _ in keyCalls += 1; return Data(repeating: 1, count: 32) }, spawn: { _ in
            spawnCalls += 1
            return BlabeeTestEngineFakeChild()
        })
        #expect(throws: CoordinatorError.self) {
            try BlabeeTestEngineSession(store: fixture.store, run: fixture.run, dependencies: dependencies)
        }
        #expect(keyCalls == 0 && spawnCalls == 0)
        #expect(!FileManager.default.fileExists(atPath: fixture.run.rootURL.appendingPathComponent("engine").path))
        let foreignStore = try BlabeeTestRunStore(rootURL: fixture.parent.appendingPathComponent("foreign-store", isDirectory: true))
        let foreignRun = try foreignStore.create(scenario: .engineIsolation)
        dependencies.executable = { fixture.executable }
        #expect(throws: (any Error).self) {
            try BlabeeTestEngineSession(store: fixture.store, run: foreignRun, dependencies: dependencies)
        }
        #expect(keyCalls == 0 && spawnCalls == 0)
    }

    @Test("Launch metadata contains no selector capability or inherited credentials")
    func launchConfiguration() throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        var observed: BlabeeTestEngineChildConfiguration?
        var dependencies = fixture.dependencies()
        dependencies.spawn = { observed = $0; return BlabeeTestEngineFakeChild() }
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run, dependencies: dependencies)
        _ = try session.start()
        let configuration = try #require(observed)
        #expect(configuration.executableURL == fixture.executable)
        #expect(configuration.arguments.first == "test-engine-service")
        #expect(configuration.arguments.count == 9)
        #expect(configuration.invocation.parentPID == getpid())
        #expect(Set(configuration.environment.keys) == ["HOME", "PATH", "LANG"])
        #expect(!configuration.arguments.contains { $0.contains(configuration.selectorCredential) })
        #expect(!configuration.environment.values.contains { $0.contains(configuration.selectorCredential) })
        #expect(throws: CoordinatorError.self) { try session.start() }
    }

    @Test("A failed spawn preserves its exclusive log and consumes its launch ID before retry")
    func retryAfterExclusiveLogCreation() async throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let child = BlabeeTestEngineFakeChild()
        var configurations: [BlabeeTestEngineChildConfiguration] = []
        var logs: [URL] = []
        var dependencies = fixture.dependencies()
        dependencies.spawn = { configuration in
            configurations.append(configuration)
            let log = configuration.run.logsURL.appendingPathComponent(
                "engine-service-" + configuration.invocation.launchID.uuidString.lowercased() + ".log"
            )
            let descriptor = open(log.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard descriptor >= 0 else { throw CoordinatorError("test_engine_log_unavailable") }
            close(descriptor)
            logs.append(log)
            if configurations.count == 1 { throw CoordinatorError("test_engine_startup_failed") }
            return child
        }
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run, dependencies: dependencies)
        let firstIdentity = session.runtimeIdentity
        #expect(throws: CoordinatorError.self) { try session.start() }
        #expect(session.ownedChild == nil)
        #expect(logs.count == 1 && FileManager.default.fileExists(atPath: logs[0].path))
        _ = try session.start()
        #expect(configurations.count == 2 && logs.count == 2)
        #expect(configurations[0].invocation.launchID != configurations[1].invocation.launchID)
        #expect(logs[0].path != logs[1].path)
        #expect(logs.allSatisfy { FileManager.default.fileExists(atPath: $0.path) })
        #expect(session.launchID == configurations[1].invocation.launchID)
        #expect(session.runtimeIdentity != firstIdentity)
        #expect(session.ownedChild === child)
        try await session.drain()
    }

    @Test("A confirmed child exit permits a newly admitted launch without reseeding or reclaiming")
    func restartAfterConfirmedExit() async throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let first = BlabeeTestEngineFakeChild(), second = BlabeeTestEngineFakeChild()
        let firstLaunch = UUID()
        let recorder = BlabeeTestEngineRequestRecorder()
        var configurations: [BlabeeTestEngineChildConfiguration] = []
        var admissionAllowed = true, admissionCalls = 0, keyCalls = 0
        let dependencies = BlabeeTestEngineSessionDependencies(executable: {
            admissionCalls += 1
            guard admissionAllowed else { throw CoordinatorError("test_engine_bundle_invalid") }
            return fixture.executable
        }, selectorKey: { _, _ in keyCalls += 1; return Data(repeating: 0x2a, count: 32) }, spawn: {
            configurations.append($0)
            return configurations.count == 1 ? first : second
        }, request: { request in
            let data = recorder.record(request)
            // A previous successful request must not suppress the new child's
            // bounded startup retry after its incarnation has changed.
            if request.launchID != firstLaunch, recorder.count == 2 {
                throw CoordinatorError("operational_socket_unavailable")
            }
            return data
        })
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run,
                                                 launchID: firstLaunch, dependencies: dependencies)
        _ = try session.start()
        let firstIdentity = session.runtimeIdentity
        _ = try await session.request(type: "pet_snapshot", payload: Data("{}".utf8))
        first.isRunning = false
        admissionAllowed = false
        #expect(throws: CoordinatorError.self) { try session.start() }
        #expect(session.ownedChild === first)
        #expect(session.launchID == firstLaunch && session.runtimeIdentity == firstIdentity)
        #expect(configurations.count == 1)
        admissionAllowed = true
        _ = try session.start()
        #expect(session.ownedChild === second)
        #expect(session.launchID != firstLaunch && session.runtimeIdentity != firstIdentity)
        #expect(configurations.count == 2 && admissionCalls == 4 && keyCalls == 1)
        #expect(configurations[0].invocation.runID == configurations[1].invocation.runID)
        #expect(configurations[0].paths == configurations[1].paths)
        #expect(configurations[0].invocation.launchID != configurations[1].invocation.launchID)
        #expect(configurations[0].selectorCredential == configurations[1].selectorCredential)
        #expect(recorder.count == 1)
        _ = try await session.request(type: "pet_snapshot", payload: Data("{}".utf8))
        #expect(recorder.count == 3)
        #expect(recorder.last?.launchID == session.launchID)
        #expect(recorder.last?.type == "pet_snapshot")
        try await session.drain()
    }

    @Test("Responses and connection failures from a previous child cannot cross a restart", arguments: [false, true])
    func staleRequestAfterRestart(connectionFailure: Bool) async throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let first = BlabeeTestEngineFakeChild(), second = BlabeeTestEngineFakeChild()
        let recorder = BlabeeTestEngineRequestRecorder()
        defer { recorder.release.signal() }
        var spawns = 0
        var dependencies = fixture.dependencies(request: {
            let data = recorder.record($0, hold: true)
            if connectionFailure { throw CoordinatorError("operational_socket_unavailable") }
            return data
        })
        dependencies.spawn = { _ in spawns += 1; return spawns == 1 ? first : second }
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run, dependencies: dependencies)
        _ = try session.start()
        let firstLaunch = session.launchID
        let pending = Task { try await session.request(type: "pet_snapshot", payload: Data("{}".utf8)) }
        for _ in 0..<1_000 {
            if recorder.count == 1 { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(recorder.count == 1)
        first.isRunning = false
        _ = try session.start()
        #expect(session.launchID != firstLaunch)
        recorder.release.signal()
        switch await pending.result {
        case .success: Issue.record("An earlier Engine incarnation returned a result after restart")
        case .failure(let error):
            #expect((error as? CoordinatorError)?.code == "test_engine_launch_changed")
        }
        #expect(recorder.count == 1)
        try await session.drain()
    }

    @Test("Every transport request binds exact run and launch and rejects caller credentials")
    func scopedRequests() async throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let recorder = BlabeeTestEngineRequestRecorder()
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run,
            dependencies: fixture.dependencies(request: { recorder.record($0) }))
        _ = try session.start()
        _ = try await session.request(type: "pet_snapshot", payload: Data("{}".utf8))
        let request = try #require(recorder.last)
        let payload = try request.authenticatedPayload()
        #expect(request.runtimeIdentity == session.runtimeIdentity)
        #expect(request.socketPath == session.paths.socketURL.path)
        #expect(payload["auth_token"] as? String == String(repeating: "2a", count: 32))
        let scope = try #require(payload["blabee_test_scope"] as? [String: String])
        #expect(scope == ["profile": "test", "store_id": fixture.run.storeID.uuidString.lowercased(),
                          "run_id": fixture.run.runID.uuidString.lowercased(), "launch_id": session.launchID.uuidString.lowercased()])
        for data in [Data("{\"auth_token\":\"other\"}".utf8), Data("{\"blabee_test_scope\":{}}".utf8)] {
            await #expect(throws: CoordinatorError.self) { try await session.request(type: "pet_snapshot", payload: data) }
        }
        #expect(recorder.count == 1)
        session.invalidate()
        await #expect(throws: CoordinatorError.self) { try await session.request(type: "pet_snapshot", payload: Data("{}".utf8)) }
        #expect(recorder.count == 1)
        try await session.drain()
    }

    @Test("An in-flight response cannot revive an invalidated session")
    func staleResponse() async throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let recorder = BlabeeTestEngineRequestRecorder()
        defer { recorder.release.signal() }
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run,
            dependencies: fixture.dependencies(request: { recorder.record($0, hold: true) }))
        _ = try session.start()
        let pending = Task { try await session.request(type: "pet_snapshot", payload: Data("{}".utf8)) }
        for _ in 0..<1_000 {
            if recorder.count == 1 { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(recorder.count == 1)
        session.invalidate()
        recorder.release.signal()
        await #expect(throws: CoordinatorError.self) { try await pending.value }
        try await session.drain()
    }

    @Test("Shutdown timeout preserves the child and prevents a replacement launch")
    func failedDrainPreservesOwnership() async throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let child = BlabeeTestEngineFakeChild()
        child.exitsOnStop = false
        let session = try BlabeeTestEngineSession(store: fixture.store, run: fixture.run,
                                                 dependencies: fixture.dependencies(child: child))
        _ = try session.start()
        let launch = session.launchID, identity = session.runtimeIdentity
        // Common UI shutdown can return while the child is still running.
        await child.stop()
        #expect(session.isActive && child.isRunning)
        #expect(throws: CoordinatorError.self) { try session.start() }
        #expect(session.launchID == launch && session.runtimeIdentity == identity)
        await #expect(throws: CoordinatorError.self) { try await session.drain() }
        #expect(child.stopCount == 2 && child.isRunning)
        #expect(session.ownedChild === child)
        #expect(!session.isActive)
        #expect(throws: CoordinatorError.self) { try session.start() }
        child.exitsOnStop = true
        try await session.drain()
        #expect(session.ownedChild == nil && !child.isRunning)
    }

    @Test("Freshness factory admits exactly the run's test account with deletion disabled")
    func exactFreshnessFactory() throws {
        let fixture = try BlabeeTestEngineServiceFixture()
        defer { fixture.cleanup() }
        let paths = try fixture.store.prepareEngineStorage(for: fixture.run)
        var calls: [(String, String, Bool)] = []
        let fake = try BlabeeTestEngineFreshnessFactory.make(run: fixture.run, paths: paths) { service, account, deletion in
            calls.append((service, account, deletion))
            return BlabeeTestEngineUnusedFreshness(storageSlot: account)
        }
        #expect(calls.count == 1)
        #expect(calls[0].0 == KeychainFreshnessAnchorStore.defaultService)
        #expect(calls[0].1 == "test-" + fixture.run.runID.uuidString.lowercased())
        #expect(calls[0].2 == false)
        #expect(fake.storageSlot == paths.freshnessAccount)
        let wrong = BlabeeTestEnginePaths(rootURL: paths.rootURL, databaseURL: paths.databaseURL,
            keyURL: paths.keyURL, tokenKeyURL: paths.tokenKeyURL, selectorKeyURL: paths.selectorKeyURL,
            authorityRootURL: paths.authorityRootURL, projectURL: paths.projectURL, socketURL: paths.socketURL,
            freshnessAccount: "primary")
        #expect(throws: CoordinatorError.self) {
            try BlabeeTestEngineFreshnessFactory.make(run: fixture.run, paths: wrong) { service, account, deletion in
                calls.append((service, account, deletion))
                return BlabeeTestEngineUnusedFreshness(storageSlot: account)
            }
        }
        #expect(calls.count == 1)
    }

    @Test("Startup diagnostics accept exact bounded codes and discard arbitrary child text")
    func safeDiagnostics() {
        let valid = BlabeeTestEngineControlFrame.failure(CoordinatorError("freshness_anchor_unavailable", "private details"))
        #expect(BlabeeTestEngineControlFrame.code(in: valid) == "freshness_anchor_unavailable")
        #expect(!String(decoding: valid, as: UTF8.self).contains("private details"))
        for value in ["token_secret", "/Users/example/private", "test_engine_secret", String(repeating: "x", count: 200)] {
            let data = BlabeeTestEngineControlFrame.failure(CoordinatorError(value))
            #expect(BlabeeTestEngineControlFrame.code(in: data) == "test_engine_startup_failed")
            #expect(data.count <= BlabeeTestEngineControlFrame.maximumBytes)
        }
        #expect(BlabeeTestEngineControlFrame.code(in: valid + valid) == nil)
        #expect(BlabeeTestEngineControlFrame.code(in: Data((BlabeeTestEngineControlFrame.prefix + "untrusted\n").utf8)) == nil)
    }
}
#endif
