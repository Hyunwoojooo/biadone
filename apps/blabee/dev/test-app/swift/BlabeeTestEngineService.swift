#if BLABEE_TEST_APP
import BlabeeProductSupport
import CoordinatorSwift
import CryptoKit
import Darwin
import Dispatch
import Foundation

/// Validate the supplied POSIX spelling without asking Foundation to resolve
/// system aliases. Directory descriptors, rather than URL normalization,
/// establish the filesystem identity and reject every symlink component.
private enum BlabeeTestEnginePathSyntax {
    static func components(_ path: String) -> [String]? {
        guard path.hasPrefix("/"), path != "/", !path.utf8.contains(0) else { return nil }
        let values = path.dropFirst().split(separator: "/", omittingEmptySubsequences: false)
        guard values.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        return values.map(String.init)
    }

    static func components(_ url: URL) -> [String]? {
        guard url.isFileURL, url.host == nil || url.host == "",
              url.query == nil, url.fragment == nil else { return nil }
        return components(url.path)
    }
}

/// Public arguments contain only ownership coordinates. Capabilities and keys
/// are read from the validated run, never from argv or inherited environment.
struct BlabeeTestEngineServiceArguments: Equatable, Sendable {
    let storeRootURL: URL
    let runID: UUID
    let launchID: UUID
    let parentPID: Int32

    init(arguments: [String]) throws {
        guard arguments.count == 8,
              arguments[0] == "--store-root", arguments[2] == "--run-id",
              arguments[4] == "--launch-id", arguments[6] == "--parent-pid",
              BlabeeTestEnginePathSyntax.components(arguments[1]) != nil,
              let run = UUID(uuidString: arguments[3]), arguments[3] == run.uuidString.lowercased(),
              let launch = UUID(uuidString: arguments[5]), arguments[5] == launch.uuidString.lowercased(),
              let parent = Int32(arguments[7]), parent > 1, arguments[7] == String(parent)
        else { throw CoordinatorError("test_engine_arguments_invalid") }
        let root = URL(fileURLWithPath: arguments[1], isDirectory: true)
        guard root.path == arguments[1] else {
            throw CoordinatorError("test_engine_arguments_invalid")
        }
        storeRootURL = root
        runID = run
        launchID = launch
        parentPID = parent
    }

    init(storeRootURL: URL, runID: UUID, launchID: UUID, parentPID: Int32) throws {
        try self.init(arguments: ["--store-root", storeRootURL.path,
                                 "--run-id", runID.uuidString.lowercased(),
                                 "--launch-id", launchID.uuidString.lowercased(),
                                 "--parent-pid", String(parentPID)])
    }

    var arguments: [String] {
        ["--store-root", storeRootURL.path, "--run-id", runID.uuidString.lowercased(),
         "--launch-id", launchID.uuidString.lowercased(), "--parent-pid", String(parentPID)]
    }

    func validateParent(currentParentPID: Int32) throws {
        guard currentParentPID == parentPID, currentParentPID > 1 else {
            throw CoordinatorError("test_engine_parent_mismatch")
        }
    }
}

enum BlabeeTestEngineRuntimeBinding {
    static func selectorCredential(key: Data) throws -> String {
        guard key.count == 32 else { throw CoordinatorError("test_engine_selector_invalid") }
        return key.map { String(format: "%02x", $0) }.joined()
    }

    static func identity(run: BlabeeTestRunManifest, launchID: UUID, selectorKey: Data) throws -> String {
        guard run.profile == "test", selectorKey.count == 32 else {
            throw CoordinatorError("test_engine_scope_invalid")
        }
        var framed = Data("blabee-test-engine-runtime-v1\0".utf8)
        for value in [run.storeID, run.runID, launchID] {
            framed.append(Data(value.uuidString.lowercased().utf8))
            framed.append(0)
        }
        framed.append(selectorKey)
        let value = "sha256:" + SHA256.hash(data: framed).map { String(format: "%02x", $0) }.joined()
        guard OperationalRuntimeIdentity.isValid(value) else {
            throw CoordinatorError("operational_runtime_identity_invalid")
        }
        return value
    }
}

/// Test bootstrap admission is deliberately independent of the product's
/// signed assembly manifest, installation, runtime lease and primary account.
enum BlabeeTestEngineBundleGuard {
    static func currentExecutable() throws -> URL {
        try executable(bundleURL: Bundle.main.bundleURL, info: Bundle.main.infoDictionary ?? [:],
                       executableURL: Bundle.main.executableURL)
    }

    static func executable(bundleURL: URL, info: [String: Any], executableURL: URL?) throws -> URL {
        try BlabeeTestLaunchPolicy.validate(arguments: [], bundleURL: bundleURL, info: info)
        let expectedPath = bundleURL.path + "/Contents/MacOS/blabee-coordinator"
        guard BlabeeTestEnginePathSyntax.components(bundleURL) != nil,
              let executableURL, BlabeeTestEnginePathSyntax.components(executableURL) != nil,
              expectedPath == executableURL.path else {
            throw CoordinatorError("test_engine_bundle_invalid")
        }
        let parent = try openDirectory(executableURL.deletingLastPathComponent())
        defer { close(parent) }
        let descriptor = openat(parent, executableURL.lastPathComponent, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw CoordinatorError("test_engine_bundle_invalid") }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == geteuid(), info.st_nlink == 1,
              info.st_mode & 0o022 == 0, info.st_mode & 0o100 != 0 else {
            throw CoordinatorError("test_engine_bundle_invalid")
        }
        return executableURL
    }

    /// Walk every component so an ancestor symlink cannot bypass a final lstat.
    static func openDirectory(_ url: URL) throws -> Int32 {
        guard let components = BlabeeTestEnginePathSyntax.components(url) else {
            throw CoordinatorError("test_engine_path_unsafe")
        }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw CoordinatorError("test_engine_path_unsafe") }
        do {
            for name in components {
                let next = openat(descriptor, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard next >= 0 else { throw CoordinatorError("test_engine_path_unsafe") }
                close(descriptor)
                descriptor = next
                var info = stat()
                guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFDIR,
                      info.st_uid == 0 || info.st_uid == geteuid() else {
                    throw CoordinatorError("test_engine_path_unsafe")
                }
                let rootSticky = info.st_uid == 0 && info.st_mode & S_ISVTX != 0
                guard info.st_mode & 0o022 == 0 || rootSticky else {
                    throw CoordinatorError("test_engine_path_unsafe")
                }
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    static func verifyDirectParent(_ parentPID: Int32, executable: URL) throws {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
        var bytes = [UInt8](repeating: 0, count: 4 * 1_024)
        let count = bytes.withUnsafeMutableBytes { proc_pidpath(parentPID, $0.baseAddress, UInt32($0.count)) }
        guard parentPID == getppid(), parentPID > 1,
              proc_pidinfo(parentPID, PROC_PIDTBSDINFO, 0, &info, size) == size,
              info.pbi_pid == UInt32(parentPID), info.pbi_uid == geteuid(),
              info.pbi_status != UInt32(SZOMB), count > 0,
              let end = bytes.firstIndex(of: 0),
              String(bytes: bytes[..<end], encoding: .utf8) == executable.path,
              parentPID == getppid() else { throw CoordinatorError("test_engine_parent_mismatch") }
    }
}

enum BlabeeTestEngineFreshnessFactory {
    static func make(
        run: BlabeeTestRunManifest, paths: BlabeeTestEnginePaths,
        factory: (String, String, Bool) throws -> any FreshnessAnchorStore = {
            try KeychainFreshnessAnchorStore(service: $0, account: $1, allowsTestDeletion: $2)
        }
    ) throws -> any FreshnessAnchorStore {
        guard run.profile == "test", paths.freshnessAccount == "test-" + run.runID.uuidString.lowercased() else {
            throw CoordinatorError("test_engine_freshness_scope_invalid")
        }
        return try factory(KeychainFreshnessAnchorStore.defaultService, paths.freshnessAccount, false)
    }
}

struct BlabeeTestEngineChildConfiguration: Sendable {
    let executableURL: URL
    let invocation: BlabeeTestEngineServiceArguments
    let run: BlabeeTestRunManifest
    let paths: BlabeeTestEnginePaths
    let selectorCredential: String

    var arguments: [String] { ["test-engine-service"] + invocation.arguments }
    var environment: [String: String] {
        ["HOME": FileManager.default.homeDirectoryForCurrentUser.path,
         "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8"]
    }
}

struct BlabeeTestEngineRequest: Sendable {
    let type: String
    let payload: Data
    let socketPath: String
    let runtimeIdentity: String
    let selectorCredential: String
    let storeID: UUID
    let runID: UUID
    let launchID: UUID

    func authenticatedPayload() throws -> [String: Any] {
        var value = try StrictJSONTransport.object(from: payload)
        guard value["blabee_test_scope"] == nil, value["auth_token"] == nil else {
            throw CoordinatorError("test_engine_request_scope_invalid")
        }
        value["blabee_test_scope"] = ["profile": "test", "store_id": storeID.uuidString.lowercased(),
                                     "run_id": runID.uuidString.lowercased(), "launch_id": launchID.uuidString.lowercased()]
        value["auth_token"] = selectorCredential
        return value
    }

    static func send(_ request: Self) throws -> Data {
        let client = try UnixDomainSocketClient(socketPath: request.socketPath, runtimeIdentity: request.runtimeIdentity)
        let response = try client.request(type: request.type, payload: request.authenticatedPayload(),
                                          connectTimeoutMilliseconds: 100, responseTimeoutMilliseconds: 2_000)
        return try StrictJSONTransport.data(forJSONObject: response)
    }
}

@MainActor
struct BlabeeTestEngineSessionDependencies {
    var executable: @MainActor () throws -> URL = BlabeeTestEngineBundleGuard.currentExecutable
    var selectorKey: (URL, Bool) throws -> Data = { try BlabeeTestEngineKeyMaterial.loadOrCreate(at: $0, allowCreate: $1) }
    var spawn: @MainActor (BlabeeTestEngineChildConfiguration) throws -> any AppOwnedServiceChild = {
        try BlabeeTestOwnedEngineChild(configuration: $0)
    }
    var request: @Sendable (BlabeeTestEngineRequest) throws -> Data = BlabeeTestEngineRequest.send
}

/// Only the GUI owns this handle. Invalidation fences responses immediately;
/// drain succeeds only after the directly created child has actually exited.
@MainActor
final class BlabeeTestEngineSession {
    let store: BlabeeTestRunStore
    let run: BlabeeTestRunManifest
    let paths: BlabeeTestEnginePaths
    private(set) var launchID: UUID
    private(set) var runtimeIdentity: String
    private let executableURL: URL
    private let selectorKey: Data
    private let selectorCredential: String
    private let dependencies: BlabeeTestEngineSessionDependencies
    private(set) var ownedChild: (any AppOwnedServiceChild)?
    private(set) var isActive = true
    private var hasConnected = false
    private var hasAttemptedLaunch = false

    init(store: BlabeeTestRunStore, run: BlabeeTestRunManifest, launchID: UUID = UUID(),
         dependencies: BlabeeTestEngineSessionDependencies = .init()) throws {
        // Bundle and manifest admission precede key creation or process creation.
        let executable = try dependencies.executable()
        try store.validate(run)
        let paths = try store.prepareEngineStorage(for: run)
        let key = try dependencies.selectorKey(paths.selectorKeyURL, true)
        let credential = try BlabeeTestEngineRuntimeBinding.selectorCredential(key: key)
        self.store = store
        self.run = run
        self.paths = paths
        self.launchID = launchID
        executableURL = executable
        selectorKey = key
        selectorCredential = credential
        runtimeIdentity = try BlabeeTestEngineRuntimeBinding.identity(run: run, launchID: launchID, selectorKey: key)
        self.dependencies = dependencies
    }

    func start() throws -> any AppOwnedServiceChild {
        guard isActive else { throw CoordinatorError("test_engine_session_inactive") }
        guard ownedChild?.isRunning != true else { throw CoordinatorError("test_engine_child_already_owned") }
        // A common UI disable/enable may start a new child in the same run.
        // Repeat admission and retain a failed predecessor until replacement
        // succeeds; no process is adopted and no run history is replayed.
        guard try dependencies.executable().path == executableURL.path else {
            throw CoordinatorError("test_engine_bundle_invalid")
        }
        try store.validateEngineStorage(for: run, paths: paths)
        let nextLaunchID = hasAttemptedLaunch ? UUID() : launchID
        let nextRuntimeIdentity = try BlabeeTestEngineRuntimeBinding.identity(
            run: run, launchID: nextLaunchID, selectorKey: selectorKey
        )
        let configuration = BlabeeTestEngineChildConfiguration(
            executableURL: executableURL,
            invocation: try .init(storeRootURL: store.rootURL, runID: run.runID, launchID: nextLaunchID, parentPID: getpid()),
            run: run, paths: paths, selectorCredential: selectorCredential
        )
        // The factory may create this incarnation's exclusive log before
        // process creation fails. Preserve that evidence and consume its ID
        // before entering the factory so a retry always gets a new log path.
        hasAttemptedLaunch = true
        let child = try dependencies.spawn(configuration)
        launchID = nextLaunchID
        runtimeIdentity = nextRuntimeIdentity
        hasConnected = false
        ownedChild = child
        return child
    }

    func invalidate() { isActive = false }

    func request(type: String, payload: Data) async throws -> Data {
        guard isActive else { throw CoordinatorError("test_engine_session_inactive") }
        let expectedLaunchID = launchID
        let request = BlabeeTestEngineRequest(type: type, payload: payload, socketPath: paths.socketURL.path,
            runtimeIdentity: runtimeIdentity, selectorCredential: selectorCredential,
            storeID: run.storeID, runID: run.runID, launchID: expectedLaunchID)
        // Reject caller-supplied scope/auth before contacting any transport.
        _ = try request.authenticatedPayload()
        let send = dependencies.request
        let startupDeadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        for attempt in 0..<40 {
            try Task.checkCancellation()
            try requireActiveLaunch(expectedLaunchID)
            guard let child = ownedChild, child.isRunning else {
                throw CoordinatorError(BlabeeTestEngineControlFrame.safeCode(ownedChild?.terminationSummary))
            }
            do {
                // The existing UDS client is synchronous. Keep its bounded I/O
                // off both the GUI actor and Swift's cooperative executor.
                let data = try await withCheckedThrowingContinuation { continuation in
                    DispatchQueue.global(qos: .userInitiated).async {
                        continuation.resume(with: Result { try send(request) })
                    }
                }
                try Task.checkCancellation()
                try requireActiveLaunch(expectedLaunchID)
                hasConnected = true
                return data
            } catch let error as CoordinatorError {
                try requireActiveLaunch(expectedLaunchID)
                let retryable = ["operational_socket_unavailable", "operational_connect_refused", "operational_connect_failed"]
                guard !hasConnected, retryable.contains(error.code) else { throw error }
                guard attempt < 39, DispatchTime.now().uptimeNanoseconds < startupDeadline else {
                    throw CoordinatorError("test_engine_startup_timeout")
                }
                try await Task.sleep(for: .milliseconds(50))
            } catch {
                try requireActiveLaunch(expectedLaunchID)
                throw error
            }
        }
        throw CoordinatorError("test_engine_startup_timeout")
    }

    private func requireActiveLaunch(_ expectedLaunchID: UUID) throws {
        guard isActive else { throw CoordinatorError("test_engine_session_inactive") }
        guard launchID == expectedLaunchID else { throw CoordinatorError("test_engine_launch_changed") }
    }

    func report() async throws -> BlabeeTestEngineReport { try await control("report") }
    func seed() async throws -> BlabeeTestEngineReport { try await control("seed") }
    func claim() async throws -> BlabeeTestEngineReport { try await control("claim") }

    private func control(_ operation: String) async throws -> BlabeeTestEngineReport {
        let payload = try StrictJSONTransport.data(forJSONObject: ["blabee_test_engine": ["operation": operation]])
        let data = try await request(type: "doctor_status", payload: payload)
        return try JSONDecoder().decode(BlabeeTestEngineReport.self, from: data)
    }

    func drain() async throws {
        invalidate()
        guard let child = ownedChild else { return }
        await child.stop()
        guard !child.isRunning else { throw CoordinatorError("test_engine_shutdown_timeout") }
        ownedChild = nil
    }
}

/// No raw child output is persisted or shown. Only one bounded startup frame
/// is accepted; unexpected output becomes a fixed diagnostic code.
enum BlabeeTestEngineControlFrame {
    static let ready = Data("BLABEE_TEST_ENGINE_READY_V1\n".utf8)
    static let prefix = "BLABEE_TEST_ENGINE_ERROR_V1 "
    static let maximumBytes = 128
    static let safeCodes: Set<String> = [
        "test_engine_startup_failed", "test_engine_startup_timeout", "test_engine_shutdown_timeout",
        "test_engine_arguments_invalid", "test_engine_parent_mismatch", "test_engine_bundle_invalid",
        "test_engine_path_unsafe", "test_engine_storage_invalid", "test_engine_scope_invalid", "test_engine_selector_invalid",
        "test_engine_freshness_scope_invalid", "test_engine_child_exited", "test_engine_log_unavailable",
        "blabee_test_engine_scope_invalid", "blabee_test_engine_key_invalid",
        "storage_key_invalid", "operational_owner_active", "operational_owner_lock_unsafe",
        "operational_owner_lock_unavailable", "operational_socket_unsafe", "operational_socket_unavailable",
        "operational_socket_bind_failed", "operational_socket_listen_failed", "operational_socket_invalid",
        "operational_runtime_directory_unsafe", "operational_runtime_directory_unavailable",
        "freshness_anchor_unavailable", "freshness_anchor_missing", "freshness_anchor_corrupt",
        "freshness_storage_missing", "freshness_transition_pending", "freshness_lock_busy",
        "freshness_transition_mismatch", "database_integrity_failed",
    ]

    static func safeCode(_ candidate: String?) -> String {
        guard let candidate, safeCodes.contains(candidate) else { return "test_engine_startup_failed" }
        return candidate
    }

    static func safeCode(for error: any Error) -> String {
        if error is BlabeeTestRunStoreError { return "test_engine_storage_invalid" }
        if error is BlabeeTestLaunchError { return "test_engine_bundle_invalid" }
        return safeCode((error as? CoordinatorError)?.code)
    }

    static func failure(_ error: any Error) -> Data {
        Data((prefix + safeCode(for: error) + "\n").utf8)
    }

    static func code(in frame: Data) -> String? {
        guard frame.count <= maximumBytes, let text = String(data: frame, encoding: .utf8),
              text.hasPrefix(prefix), text.hasSuffix("\n") else { return nil }
        let code = String(text.dropFirst(prefix.count).dropLast())
        return safeCodes.contains(code) ? code : nil
    }

    static func write(_ frame: Data) {
        guard frame.count <= maximumBytes else { return }
        _ = frame.withUnsafeBytes { Darwin.write(STDOUT_FILENO, $0.baseAddress, $0.count) }
    }
}

private final class BlabeeTestEngineOutputCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var bytes = Data()
    private var complete = false
    private var ready = false
    private var failure: String?
    private let logDescriptor: Int32

    init(run: BlabeeTestRunManifest, launchID: UUID) throws {
        let directory = try BlabeeTestEngineBundleGuard.openDirectory(run.logsURL)
        defer { close(directory) }
        var info = stat()
        guard fstat(directory, &info) == 0, info.st_uid == geteuid(), info.st_mode & 0o7777 == 0o700 else {
            throw CoordinatorError("test_engine_log_unavailable")
        }
        let name = "engine-service-" + launchID.uuidString.lowercased() + ".log"
        let descriptor = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw CoordinatorError("test_engine_log_unavailable") }
        var file = stat()
        guard fstat(descriptor, &file) == 0, file.st_mode & S_IFMT == S_IFREG,
              file.st_uid == geteuid(), file.st_nlink == 1, file.st_mode & 0o7777 == 0o600 else {
            close(descriptor)
            throw CoordinatorError("test_engine_log_unavailable")
        }
        logDescriptor = descriptor
    }

    deinit { close(logDescriptor) }
    var isReady: Bool { lock.withLock { ready } }
    var failureCode: String? { lock.withLock { failure } }

    func consume(_ data: Data) {
        lock.withLock {
            guard !complete else { return }
            guard data.count <= BlabeeTestEngineControlFrame.maximumBytes - bytes.count else {
                finish(code: "test_engine_startup_failed"); return
            }
            bytes.append(data)
            guard bytes.contains(10) else { return }
            if bytes == BlabeeTestEngineControlFrame.ready {
                ready = true
                finish(code: "test_engine_ready")
            } else { finish(code: BlabeeTestEngineControlFrame.code(in: bytes) ?? "test_engine_startup_failed") }
        }
    }

    private func finish(code: String) {
        complete = true
        if !ready { failure = code }
        bytes.removeAll(keepingCapacity: false)
        let line = Data((code + "\n").utf8)
        _ = line.withUnsafeBytes { Darwin.write(logDescriptor, $0.baseAddress, $0.count) }
    }
}

@MainActor
private final class BlabeeTestOwnedEngineChild: AppOwnedServiceChild {
    private let process: Process
    private let ownedPID: Int32
    private let output: Pipe
    private let diagnostics: BlabeeTestEngineOutputCapture
    private let configuration: BlabeeTestEngineChildConfiguration
    private var terminationRequested = false
    private var shutdownTimedOut = false
    private var socketIdentity: (device: dev_t, inode: ino_t)?

    init(configuration: BlabeeTestEngineChildConfiguration) throws {
        guard try BlabeeTestEngineBundleGuard.currentExecutable().path == configuration.executableURL.path,
              configuration.invocation.runID == configuration.run.runID,
              configuration.run.profile == "test",
              AppPetSelectorBootstrap.validCredential(configuration.selectorCredential) else {
            throw CoordinatorError("test_engine_bundle_invalid")
        }
        let diagnostics = try BlabeeTestEngineOutputCapture(run: configuration.run, launchID: configuration.invocation.launchID)
        let output = Pipe()
        let process = Process()
        process.executableURL = configuration.executableURL
        process.arguments = configuration.arguments
        process.environment = configuration.environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { handle in
            guard let data = try? handle.read(upToCount: 256), !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            diagnostics.consume(data)
        }
        do { try process.run() }
        catch {
            output.fileHandleForReading.readabilityHandler = nil
            throw CoordinatorError("test_engine_startup_failed")
        }
        self.process = process
        ownedPID = process.processIdentifier
        self.output = output
        self.diagnostics = diagnostics
        self.configuration = configuration
        try? output.fileHandleForWriting.close()
    }

    var isRunning: Bool { process.processIdentifier == ownedPID && process.isRunning }
    var hasPublishedService: Bool {
        guard isRunning, diagnostics.isReady else { return false }
        var info = stat()
        guard lstat(configuration.paths.socketURL.path, &info) == 0,
              info.st_mode & S_IFMT == S_IFSOCK, info.st_uid == geteuid(),
              info.st_mode & 0o7777 == 0o600 else { return false }
        if let identity = socketIdentity {
            return info.st_dev == identity.device && info.st_ino == identity.inode
        }
        socketIdentity = (info.st_dev, info.st_ino)
        return true
    }
    var terminationSummary: String? {
        if shutdownTimedOut { return "test_engine_shutdown_timeout" }
        return diagnostics.failureCode ?? (isRunning ? nil : "test_engine_child_exited")
    }
    var petSelectorCredential: String? { isRunning ? configuration.selectorCredential : nil }

    func stop() async {
        guard isRunning else { return }
        // Foundation's directly created Process is the only signaling target.
        // Never look up a process by socket, PID, executable name or run file.
        if !terminationRequested, process.processIdentifier == ownedPID, process.isRunning {
            terminationRequested = true
            process.terminate()
        }
        let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        while isRunning, DispatchTime.now().uptimeNanoseconds < deadline {
            // A cancelled transition must still yield while its child drains.
            await withCheckedContinuation { continuation in
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .milliseconds(20)) {
                    continuation.resume()
                }
            }
        }
        shutdownTimedOut = isRunning
        if !isRunning { output.fileHandleForReading.readabilityHandler = nil }
    }
}

/// This synchronous entrypoint belongs exclusively to the child process. The
/// UDS server's process-global signal handlers and scheduler never enter GUI.
func runBlabeeTestEngineService(arguments: [String]) throws {
    do {
        let invocation = try BlabeeTestEngineServiceArguments(arguments: arguments)
        try invocation.validateParent(currentParentPID: getppid())
        let executable = try BlabeeTestEngineBundleGuard.currentExecutable()
        try BlabeeTestEngineBundleGuard.verifyDirectParent(invocation.parentPID, executable: executable)
        let store = try BlabeeTestRunStore(rootURL: invocation.storeRootURL)
        let run = try store.resume(runID: invocation.runID)
        let paths = try store.loadEngineStorage(for: run)
        let selectorKey = try BlabeeTestEngineKeyMaterial.loadOrCreate(at: paths.selectorKeyURL, allowCreate: false)
        let selector = try BlabeeTestEngineRuntimeBinding.selectorCredential(key: selectorKey)
        let identity = try BlabeeTestEngineRuntimeBinding.identity(run: run, launchID: invocation.launchID, selectorKey: selectorKey)
        let authority = try CoordinatorAuthorityLease(databaseURL: paths.databaseURL,
            authorityRootURL: paths.authorityRootURL, includesPrimaryNamespace: false)
        let server = try UnixDomainSocketServer(socketPath: paths.socketURL.path,
            runtimeIdentity: identity, compatiblePreviousRuntimes: [])
        let parentWatcher = Task.detached(priority: .utility) {
            while !Task.isCancelled {
                guard getppid() == invocation.parentPID else { server.stop(); return }
                do { try await Task.sleep(for: .milliseconds(100)) } catch { return }
            }
        }
        defer { parentWatcher.cancel(); server.stop() }
        let freshness = try BlabeeTestEngineFreshnessFactory.make(run: run, paths: paths)
        let core = try BlabeeTestEngineCore(paths: paths, run: run, freshnessStore: freshness,
                                          selectorCredential: selector, launchID: invocation.launchID)
        try invocation.validateParent(currentParentPID: getppid())
        try store.validateEngineStorage(for: run, paths: paths)
        try server.activate()
        BlabeeTestEngineControlFrame.write(BlabeeTestEngineControlFrame.ready)
        try withExtendedLifetime(authority) { try server.run(application: core, secretCorpus: core.secretCorpus) }
    } catch {
        let code = BlabeeTestEngineControlFrame.safeCode(for: error)
        BlabeeTestEngineControlFrame.write(BlabeeTestEngineControlFrame.failure(CoordinatorError(code)))
        throw CoordinatorError(code)
    }
}
#endif
