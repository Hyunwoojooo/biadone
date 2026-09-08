import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation

@MainActor
protocol AppOwnedServiceChild: AnyObject {
    var isRunning: Bool { get }
    var hasPublishedService: Bool { get }
    var terminationSummary: String? { get }
    func stop() async
}

@MainActor
protocol AppOwnedServiceLaunching {
    func launch() throws -> any AppOwnedServiceChild
}

/// An explicit app-owned launch, not an SMAppService fallback or process adoption.
/// It can only start the exact, currently running signed Blabee bundle.
@MainActor
struct AppOwnedServiceProcessLauncher: AppOwnedServiceLaunching {
    let socketPath: String

    func launch() throws -> any AppOwnedServiceChild {
        let configuration = try ProductServiceBootstrap.resolve(
            arguments: [], environment: ProductServiceEnvironment.live()
        )
        guard configuration.socketPath == socketPath else {
            throw CoordinatorError("app_service_socket_mismatch")
        }
        let invocation = ProductInvocationEnvironment.live()
        let currentIdentity = try OperationalRuntimeIdentity.requireCurrent()
        guard ProductInvocationResolver.isExpectedAppBundle(invocation),
              let executable = invocation.executableURL,
              let installedIdentity = OperationalRuntimeIdentity.installedIdentity(
                forExecutable: executable
              ),
              installedIdentity == currentIdentity
        else { throw CoordinatorError("app_service_bundle_unverified") }

        // Do not inherit PATH, injected dynamic-loader variables, test gates,
        // socket overrides, credentials, or another Codex runtime configuration.
        return try AppOwnedServiceProcess.spawn(
            executable: executable,
            arguments: ["app-service"],
            environment: [
                "HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "LANG": "en_US.UTF-8",
                AppOwnedServiceLaunchBinding.environmentKey: currentIdentity,
            ]
        )
    }
}

enum AppOwnedServiceLaunchBinding {
    static let environmentKey = "BLABEE_APP_SERVICE_EXPECTED_IDENTITY"

    /// This value is a comparison-only binding, never an identity/path override.
    static func verify(environment: [String: String], currentIdentity: String) throws {
        guard let expected = environment[environmentKey],
              OperationalRuntimeIdentity.isValid(expected),
              OperationalRuntimeIdentity.isValid(currentIdentity),
              expected == currentIdentity
        else { throw CoordinatorError("app_service_identity_mismatch") }
    }
}

/// Private, bounded startup diagnostics; no arbitrary child output is accepted.
enum AppOwnedServiceControlFrame {
    static let ready = Data("BLABEE_APP_SERVICE_READY_V1\n".utf8)
    static let failurePrefix = "BLABEE_APP_SERVICE_ERROR_V1 "
    static let maximumBytes = 128
    private static let safeFailureCodes: Set<String> = [
        "app_service_startup_failed", "app_service_identity_mismatch",
        "operational_runtime_identity_unverified", "operational_runtime_identity_invalid",
        "product_service_bundle_invalid", "product_service_config_invalid",
        "product_service_config_unsafe", "contract_pin_mismatch",
        "operational_owner_active", "operational_owner_lock_unsafe",
        "operational_owner_lock_unavailable", "operational_runtime_directory_unsafe",
        "operational_runtime_directory_unavailable", "operational_socket_invalid",
        "operational_socket_unsafe", "operational_socket_unavailable",
        "operational_socket_bind_failed", "operational_socket_listen_failed",
        "freshness_anchor_unavailable", "freshness_anchor_missing", "freshness_anchor_corrupt",
        "freshness_storage_missing", "freshness_transition_pending",
        "freshness_transition_mismatch", "database_integrity_failed",
    ]

    static func failure(code: String) -> Data {
        let safe = safeFailureCodes.contains(code) ? code : "app_service_startup_failed"
        return Data("\(failurePrefix)\(safe)\n".utf8)
    }

    static func failureCode(in frame: Data) -> String? {
        guard frame.count <= maximumBytes,
              let text = String(data: frame, encoding: .utf8),
              text.hasPrefix(failurePrefix), text.hasSuffix("\n")
        else { return nil }
        let code = String(text.dropFirst(failurePrefix.count).dropLast())
        return safeFailureCodes.contains(code) ? code : nil
    }

    static func couldBePartial(_ data: Data) -> Bool {
        guard data.count < maximumBytes, !data.contains(0x0a) else { return false }
        let prefix = Data(failurePrefix.utf8)
        return ready.starts(with: data) || prefix.starts(with: data) || data.starts(with: prefix)
    }
}

/// Owns one directly spawned child. waitpid and signals share one lock: no PID
/// can be reaped/reused between the ownership check and a termination signal.
@MainActor
final class AppOwnedServiceProcess: AppOwnedServiceChild {
    private let child: AppOwnedChildProcessState

    private init(child: AppOwnedChildProcessState) {
        self.child = child
    }

    var isRunning: Bool { child.isRunning }
    var hasPublishedService: Bool { child.hasPublishedService }
    var terminationSummary: String? { child.terminationSummary }

    func stop() async {
        await withCheckedContinuation { continuation in
            child.stop { continuation.resume() }
        }
    }

    deinit { child.stop {} }

    // Internal seam for isolated child/pipe tests. The product launcher above
    // supplies the sole production executable, arguments, and environment.
    static func spawn(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        stopGraceMilliseconds: Int = 2_000
    ) throws -> AppOwnedServiceProcess {
        guard executable.isFileURL, executable.path.hasPrefix("/"),
              !executable.path.utf8.contains(0),
              arguments.allSatisfy({ !$0.utf8.contains(0) }),
              environment.allSatisfy({
                !$0.key.isEmpty && !$0.key.contains("=")
                    && !$0.key.utf8.contains(0) && !$0.value.utf8.contains(0)
              }),
              (10...2_000).contains(stopGraceMilliseconds)
        else { throw CoordinatorError("app_service_launch_invalid") }

        let lifetime = try appServicePipe()
        defer { close(lifetime.read) }
        let ready: (read: Int32, write: Int32)
        do { ready = try appServicePipe() }
        catch { close(lifetime.write); throw error }
        var transfersOwnership = false
        defer {
            close(ready.write)
            if !transfersOwnership {
                close(lifetime.write)
                close(ready.read)
            }
        }
        let flags = fcntl(ready.read, F_GETFL)
        guard flags >= 0, fcntl(ready.read, F_SETFL, flags | O_NONBLOCK) == 0 else {
            throw CoordinatorError("app_service_pipe_unavailable")
        }

        var actions: posix_spawn_file_actions_t?
        var attributes: posix_spawnattr_t?
        guard posix_spawn_file_actions_init(&actions) == 0 else {
            throw CoordinatorError("app_service_launch_failed")
        }
        defer { posix_spawn_file_actions_destroy(&actions) }
        guard posix_spawnattr_init(&attributes) == 0 else {
            throw CoordinatorError("app_service_launch_failed")
        }
        defer { posix_spawnattr_destroy(&attributes) }
        var signalMask = sigset_t()
        var defaults = sigset_t()
        sigemptyset(&signalMask)
        sigemptyset(&defaults)
        for value in [SIGINT, SIGTERM, SIGPIPE] { sigaddset(&defaults, value) }
        let spawnFlags = Int16(
            POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF
        )
        guard posix_spawnattr_setflags(&attributes, spawnFlags) == 0,
              posix_spawnattr_setsigmask(&attributes, &signalMask) == 0,
              posix_spawnattr_setsigdefault(&attributes, &defaults) == 0,
              posix_spawn_file_actions_adddup2(&actions, lifetime.read, STDIN_FILENO) == 0,
              posix_spawn_file_actions_adddup2(&actions, ready.write, STDOUT_FILENO) == 0,
              posix_spawn_file_actions_addopen(
                &actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0
              ) == 0
        else { throw CoordinatorError("app_service_launch_failed") }

        let argv = ([executable.path] + arguments).map { strdup($0) } + [nil]
        let envp = environment.keys.sorted().map { strdup("\($0)=\(environment[$0]!)") } + [nil]
        defer {
            for value in argv { free(value) }
            for value in envp { free(value) }
        }
        guard argv.dropLast().allSatisfy({ $0 != nil }),
              envp.dropLast().allSatisfy({ $0 != nil })
        else { throw CoordinatorError("app_service_launch_failed") }
        var pid: pid_t = 0
        let result = argv.withUnsafeBufferPointer { argvBuffer in
            envp.withUnsafeBufferPointer { envBuffer in
                posix_spawn(
                    &pid, executable.path, &actions, &attributes,
                    argvBuffer.baseAddress!, envBuffer.baseAddress!
                )
            }
        }
        guard result == 0, pid > 0 else {
            // Only an errno number is exposed; argv, paths, and child logs are not.
            throw CoordinatorError("app_service_spawn_errno_\(result)")
        }
        transfersOwnership = true
        let state = AppOwnedChildProcessState(
            pid: pid,
            lifetimeWriter: lifetime.write,
            readyReader: ready.read,
            stopGraceMilliseconds: stopGraceMilliseconds
        )
        state.monitor()
        return AppOwnedServiceProcess(child: state)
    }
}

private final class AppOwnedChildProcessState: @unchecked Sendable {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.biadone.blabee.app-service-child")
    private var pid: pid_t?
    private var lifetimeWriter: Int32
    private let readyReader: Int32
    private let stopGraceMilliseconds: Int
    private var summary: String?
    private var startupFailure: String?
    private var published = false
    private var readyBytes = Data()
    private var readySource: (any DispatchSourceRead)?
    private var exitSource: (any DispatchSourceProcess)?
    private var stopCompleted = false

    init(pid: pid_t, lifetimeWriter: Int32, readyReader: Int32, stopGraceMilliseconds: Int) {
        self.pid = pid
        self.lifetimeWriter = lifetimeWriter
        self.readyReader = readyReader
        self.stopGraceMilliseconds = stopGraceMilliseconds
    }

    var isRunning: Bool { lock.withLock { reapLocked(); return pid != nil } }
    var hasPublishedService: Bool { lock.withLock { reapLocked(); return pid != nil && published } }
    var terminationSummary: String? { lock.withLock { reapLocked(); return startupFailure ?? summary } }

    func monitor() {
        // Called before publication of the handle, while the owned PID cannot
        // have been reaped by any other code in this component.
        let process = DispatchSource.makeProcessSource(
            identifier: pid!, eventMask: .exit, queue: queue
        )
        // Retain the reaper until the directly owned child exits, even if the
        // UI releases its handle after a bounded shutdown timeout.
        process.setEventHandler { [self] in
            self.lock.withLock { self.reapLocked() }
            self.finishMonitoring()
        }
        exitSource = process
        let ready = DispatchSource.makeReadSource(fileDescriptor: readyReader, queue: queue)
        ready.setEventHandler { [weak self] in self?.readReady() }
        let descriptor = readyReader
        ready.setCancelHandler { close(descriptor) }
        readySource = ready
        process.resume()
        ready.resume()
    }

    func stop(completion: @escaping @Sendable () -> Void) {
        queue.async { [self] in
            guard !stopCompleted else { completion(); return }
            closeLifetimeWriter()
            if !waitForExit(milliseconds: stopGraceMilliseconds) {
                signalOwned(SIGTERM)
                if !waitForExit(milliseconds: 500) {
                    signalOwned(SIGKILL)
                    if !waitForExit(milliseconds: 1_000) {
                        lock.withLock { summary = "app_service_shutdown_timeout" }
                    }
                }
            }
            if !isRunning { finishMonitoring() }
            stopCompleted = true
            completion()
        }
    }

    private func closeLifetimeWriter() {
        lock.withLock {
            if lifetimeWriter >= 0 { close(lifetimeWriter); lifetimeWriter = -1 }
        }
    }

    private func reapLocked() {
        guard let ownedPID = pid else { return }
        var status: Int32 = 0
        var result: pid_t
        repeat { result = waitpid(ownedPID, &status, WNOHANG) }
        while result < 0 && errno == EINTR
        if result == ownedPID {
            // A process exit event (or getter) may beat the pipe read event.
            // Consume the bounded nonblocking frame before dropping the reader.
            drainReadyLocked()
            pid = nil
            let signal = status & 0x7f
            summary = signal == 0
                ? "app_service_exit_\((status >> 8) & 0xff)"
                : "app_service_signal_\(signal)"
        } else if result < 0 && errno == ECHILD {
            // Another reaper must never turn an arbitrary recycled PID into
            // an owned child. Relinquish signalling authority immediately.
            drainReadyLocked()
            pid = nil
            summary = "app_service_child_ownership_lost"
        }
    }

    private func signalOwned(_ signal: Int32) {
        lock.withLock {
            reapLocked()
            guard let ownedPID = pid else { return }
            _ = kill(ownedPID, signal)
        }
    }

    private func waitForExit(milliseconds: Int) -> Bool {
        let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(milliseconds) * 1_000_000
        while isRunning {
            if DispatchTime.now().uptimeNanoseconds >= deadline { return false }
            usleep(10_000)
        }
        return true
    }

    private func readReady() {
        lock.withLock { readReadyLocked() }
    }

    private func readReadyLocked() {
        guard readySource != nil else { return }
        var bytes = [UInt8](repeating: 0, count: 64)
        let count = read(readyReader, &bytes, bytes.count)
        if count < 0 && (errno == EINTR || errno == EAGAIN) { return }
        if count > 0 {
            guard readyBytes.count + count <= AppOwnedServiceControlFrame.maximumBytes else {
                cancelReadyLocked()
                return
            }
            readyBytes.append(contentsOf: bytes.prefix(count))
            let expected = AppOwnedServiceControlFrame.ready
            if readyBytes == expected {
                published = true
            } else if let code = AppOwnedServiceControlFrame.failureCode(in: readyBytes) {
                startupFailure = code
            } else if AppOwnedServiceControlFrame.couldBePartial(readyBytes) {
                return
            }
        }
        cancelReadyLocked()
    }

    private func drainReadyLocked() {
        // At most maximumBytes plus one read, even if a child emits garbage.
        for _ in 0...AppOwnedServiceControlFrame.maximumBytes / 64 {
            guard readySource != nil else { break }
            readReadyLocked()
        }
    }

    private func cancelReadyLocked() {
        readySource?.cancel()
        readySource = nil
    }

    private func finishMonitoring() {
        closeLifetimeWriter()
        lock.withLock {
            drainReadyLocked()
            cancelReadyLocked()
        }
        exitSource?.cancel()
        exitSource = nil
    }
}

/// Private parent-lifetime channel for app-service. EOF is independent of the
/// main thread, so even blocked service initialization cannot leave an orphan.
final class AppOwnedServiceLifetime: @unchecked Sendable {
    static let readyMarker = AppOwnedServiceControlFrame.ready
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.biadone.blabee.app-service-lifetime")
    private let reader: Int32
    private var readyWriter: Int32
    private var source: (any DispatchSourceRead)?
    private var fallback: DispatchWorkItem?
    private var stopping = false
    private var cancelled = false
    private var stopHandler: (@Sendable () -> Void)?
    private let exitProcess: @Sendable (Int32) -> Void

    static func captureStandardIO(arguments: [String]) throws -> AppOwnedServiceLifetime {
        guard arguments.isEmpty else { throw CoordinatorError("invalid_arguments") }
        let lifetime = try AppOwnedServiceLifetime(
            inputDescriptor: STDIN_FILENO,
            readyDescriptor: STDOUT_FILENO
        )
        let null = open("/dev/null", O_RDWR | O_CLOEXEC)
        guard null >= 0 else { throw CoordinatorError("app_service_pipe_unavailable") }
        defer { close(null) }
        guard dup2(null, STDIN_FILENO) == STDIN_FILENO,
              dup2(null, STDOUT_FILENO) == STDOUT_FILENO
        else { throw CoordinatorError("app_service_pipe_unavailable") }
        // Neither stdio nor the CLOEXEC private descriptors survive into Codex
        // queue children. This process never uses the parent's TTY for input.
        signal(SIGPIPE, SIG_IGN)
        return lifetime
    }

    init(
        inputDescriptor: Int32,
        readyDescriptor: Int32,
        exitProcess: @escaping @Sendable (Int32) -> Void = { _exit($0) }
    ) throws {
        try Self.requireAnonymousPipe(inputDescriptor, access: O_RDONLY)
        try Self.requireAnonymousPipe(readyDescriptor, access: O_WRONLY)
        reader = fcntl(inputDescriptor, F_DUPFD_CLOEXEC, 3)
        guard reader >= 0 else { throw CoordinatorError("app_service_pipe_unavailable") }
        readyWriter = fcntl(readyDescriptor, F_DUPFD_CLOEXEC, 3)
        guard readyWriter >= 0 else {
            close(reader)
            throw CoordinatorError("app_service_pipe_unavailable")
        }
        let flags = fcntl(reader, F_GETFL)
        guard flags >= 0, fcntl(reader, F_SETFL, flags | O_NONBLOCK) == 0 else {
            close(reader)
            close(readyWriter)
            throw CoordinatorError("app_service_pipe_unavailable")
        }
        self.exitProcess = exitProcess
    }

    func start() {
        let monitor: (any DispatchSourceRead)? = lock.withLock {
            guard source == nil, !cancelled else { return nil }
            let monitor = DispatchSource.makeReadSource(fileDescriptor: reader, queue: queue)
            monitor.setEventHandler { [weak self] in
                guard let self else { return }
                var byte: UInt8 = 0
                let count = read(self.reader, &byte, 1)
                if count < 0 && (errno == EINTR || errno == EAGAIN) { return }
                self.parentEnded(exitCode: count == 0 ? 0 : 78)
            }
            let descriptor = reader
            monitor.setCancelHandler { close(descriptor) }
            source = monitor
            return monitor
        }
        monitor?.resume()
    }

    func installShutdownHandler(_ handler: @escaping @Sendable () -> Void) {
        let alreadyStopping = lock.withLock {
            stopHandler = handler
            return stopping
        }
        if alreadyStopping { handler() }
    }

    func publishReady() throws {
        try publish(Self.readyMarker)
    }

    func publishStartupFailure(code: String) {
        try? publish(AppOwnedServiceControlFrame.failure(code: code))
    }

    private func publish(_ frame: Data) throws {
        try lock.withLock {
            guard !stopping, readyWriter >= 0 else {
                throw CoordinatorError("app_service_parent_unavailable")
            }
            let result = frame.withUnsafeBytes {
                write(readyWriter, $0.baseAddress, $0.count)
            }
            close(readyWriter)
            readyWriter = -1
            guard result == frame.count else {
                throw CoordinatorError("app_service_parent_unavailable")
            }
        }
    }

    func cancel() {
        let pending = lock.withLock {
            cancelled = true
            if readyWriter >= 0 { close(readyWriter); readyWriter = -1 }
            return (source, fallback)
        }
        pending.0?.cancel()
        pending.1?.cancel()
    }

    deinit {
        if let source { source.cancel() } else { close(reader) }
        fallback?.cancel()
        if readyWriter >= 0 { close(readyWriter) }
    }

    private func parentEnded(exitCode: Int32) {
        let pending: (Bool, (@Sendable () -> Void)?, (any DispatchSourceRead)?) = lock.withLock {
            guard !stopping, !cancelled else { return (false, nil, nil) }
            stopping = true
            return (true, stopHandler, source)
        }
        guard pending.0 else { return }
        pending.2?.cancel()
        // If the server does not exist yet, no user work can be in flight.
        guard let shutdown = pending.1 else { exitProcess(exitCode); return }
        // A stalled Keychain/storage initialization cannot prevent this bound.
        let work = DispatchWorkItem { [weak self] in
            guard let self, !self.lock.withLock({ self.cancelled }) else { return }
            self.exitProcess(exitCode)
        }
        let scheduled = lock.withLock {
            guard !cancelled else { return false }
            fallback = work
            return true
        }
        guard scheduled else { return }
        // This watchdog must not share the queue running a potentially blocked
        // graceful handler (for example a filesystem-held server state lock).
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + .seconds(2), execute: work
        )
        shutdown()
    }

    private static func requireAnonymousPipe(_ descriptor: Int32, access: Int32) throws {
        var info = stat()
        let flags = fcntl(descriptor, F_GETFL)
        guard descriptor >= 0, fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFIFO),
              info.st_nlink == 0, info.st_uid == geteuid(),
              flags >= 0, flags & O_ACCMODE == access
        else { throw CoordinatorError("app_service_lifetime_pipe_required") }
    }
}

private func appServicePipe() throws -> (read: Int32, write: Int32) {
    var descriptors: [Int32] = [-1, -1]
    guard pipe(&descriptors) == 0 else { throw CoordinatorError("app_service_pipe_unavailable") }
    // Keep descriptors away from stdio and mark both endpoints close-on-exec.
    let reader = fcntl(descriptors[0], F_DUPFD_CLOEXEC, 3)
    close(descriptors[0])
    let writer = fcntl(descriptors[1], F_DUPFD_CLOEXEC, 3)
    close(descriptors[1])
    guard reader >= 0, writer >= 0 else {
        if reader >= 0 { close(reader) }
        if writer >= 0 { close(writer) }
        throw CoordinatorError("app_service_pipe_unavailable")
    }
    return (reader, writer)
}
