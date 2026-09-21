import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Dispatch
import Foundation

/// Runs in the same signed executable as the common service. It retains the
/// private owner socket and renews its lease while one interactive child lives.
enum ClaudeInstalledLauncher {
    /// The automatic command may invoke the original CLI once only when no
    /// Claude spawn has been attempted. Nothing after that point is replayed.
    struct PreSpawnFailure: Error {}
    struct Options: Sendable {
        let ownerSocketPath: String
        let sessionSocketPath: String
        let runtimeIdentity: String
        let cwd: URL
        let claudeExecutable: URL
        let nodeExecutable: URL
        let payloadRoot: URL
        let channelSource: String
        let configurationRoot: URL?
        let observeSession: Bool
        let claudeArguments: [String]

        init(ownerSocketPath: String, sessionSocketPath: String, runtimeIdentity: String,
             cwd: URL, claudeExecutable: URL, nodeExecutable: URL, payloadRoot: URL,
             channelSource: String = "blabee-claude", configurationRoot: URL? = nil,
             observeSession: Bool = false, claudeArguments: [String] = []) {
            self.ownerSocketPath = ownerSocketPath; self.sessionSocketPath = sessionSocketPath
            self.runtimeIdentity = runtimeIdentity; self.cwd = cwd
            self.claudeExecutable = claudeExecutable; self.nodeExecutable = nodeExecutable
            self.payloadRoot = payloadRoot; self.channelSource = channelSource
            self.configurationRoot = configurationRoot
            self.observeSession = observeSession; self.claudeArguments = claudeArguments
        }
    }

    static func run(_ options: Options) throws -> Int32 {
        try supervise(options, prepare: prepareInstalledRuntime, connect: { try ClaudeInstalledOwnerConnection.connect(ownerSocketPath: $0.ownerSocketPath,
            runtimeIdentity: $0.runtimeIdentity, canonicalCWD: $0.cwd.path, channelSource: $0.channelSource,
            observedSession: $1) })
    }

    #if BLABEE_JOURNAL_TEST_HARNESS
    /// The test binary alone can enroll with kernel peer checks. Every TTY,
    /// process/FD, configuration, version and renewal path remains identical.
    static func runTesting(_ options: Options) throws -> Int32 {
        try supervise(options, prepare: { ($0, nil) }, connect: { try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: $0.ownerSocketPath,
            runtimeIdentity: $0.runtimeIdentity, canonicalCWD: $0.cwd.path, channelSource: $0.channelSource,
            observedSession: $1) })
    }

    /// The source/signature qualification is replaced only in this compiled
    /// fixture. Copy, admission, use lifetime, configuration and TTY are real.
    static func runPackagedTesting(_ options: Options, storeRootURL: URL) throws -> Int32 {
        try supervise(options, prepare: {
            try prepareRuntime($0, runtimeRoot: $0.payloadRoot.deletingLastPathComponent(), storeRoot: storeRootURL)
        }, connect: { try ClaudeInstalledOwnerConnection.connectTesting(ownerSocketPath: $0.ownerSocketPath,
            runtimeIdentity: $0.runtimeIdentity, canonicalCWD: $0.cwd.path, channelSource: $0.channelSource,
            observedSession: $1) })
    }
    #endif

    private static func supervise(_ options: Options,
                                   prepare: (Options) throws -> (Options, ClaudeRuntimePayloadUse?),
                                   connect: @escaping @Sendable (Options, ClaudeInstalledOwnerConnection.ObservedSession?) throws -> ClaudeInstalledOwnerConnection) throws -> Int32 {
        var spawnAttempted = false
        do {
            return try superviseChild(options, prepare: prepare, connect: connect,
                                      willSpawn: { spawnAttempted = true })
        } catch {
            if options.observeSession && !spawnAttempted { throw PreSpawnFailure() }
            throw error
        }
    }

    private static func superviseChild(_ options: Options,
                                   prepare: (Options) throws -> (Options, ClaudeRuntimePayloadUse?),
                                   connect: @escaping @Sendable (Options, ClaudeInstalledOwnerConnection.ObservedSession?) throws -> ClaudeInstalledOwnerConnection,
                                   willSpawn: () -> Void) throws -> Int32 {
        let terminal = try ClaudeInstalledTerminal()
        defer { terminal.restore() }
        let signals = ClaudeInstalledSignals()
        defer { signals.close() }
        do {
        let clean = ClaudeInstalledLaunchConfiguration.cleanEnvironment(ProcessInfo.processInfo.environment)
        let (preparedOptions, payloadUse) = try prepare(options)
        var ownedChild: ClaudeInstalledChild?
        defer {
            ownedChild?.terminateAndReap()
            // Failure to prove waitpid completion leaves the durable blocker.
            // SIGKILL of this owner skips defer entirely, also preserving it.
            if ownedChild == nil || ownedChild?.isReaped == true {
                do { try payloadUse?.complete() }
                catch {
                    FileHandle.standardError.write(Data("Blabee 실행 파일 사용 종료를 확인하지 못했습니다. 다음 업데이트가 보류될 수 있습니다.\n".utf8))
                }
            }
        }
        let options = try validated(preparedOptions)
        try ClaudeInstalledLaunchConfiguration.requireNoMCPCollision(cwd: options.cwd, environment: clean)
        try preflight(executable: options.claudeExecutable, environment: clean,
                      accepts: ClaudeInstalledLaunchConfiguration.supportsVersion, failure: "claude_version_unsupported")
        try preflight(executable: options.nodeExecutable, environment: clean,
                      accepts: payloadUse == nil ? ClaudeInstalledLaunchConfiguration.supportsNodeVersion
                          : ClaudeRuntimePayload.supportsNodeVersion, failure: "node_version_unsupported")
        if let signal = signals.pendingTermination { return 128 + signal }
        let state = ClaudeInstalledDisconnectState()
        let lifetime = ClaudeInstalledOwnerLifetime(disconnected: { state.markDisconnected() })
        defer { lifetime.stop() }
        var bootstrap: ClaudeAutoConnectBootstrap?
        defer { bootstrap?.close() }
        var nativeSessionID: UUID?
        var environment = clean
        if options.observeSession {
            let pending = try ClaudeAutoConnectBootstrap(cwd: options.cwd.path,
                root: options.configurationRoot, enroll: { observed in
                    let owner = try connect(options, observed)
                    try lifetime.install(owner)
                    return try owner.childEnvironment(sessionSocketPath: options.sessionSocketPath)
                }, available: { lifetime.isActive }, invalidated: { lifetime.stop(); state.markDisconnected() })
            bootstrap = pending
            environment.merge(pending.childEnvironment) { _, value in value }
        } else {
            let owner = try connect(options, nil)
            try lifetime.install(owner)
            nativeSessionID = owner.identity.nativeSessionID
            environment.merge(try owner.childEnvironment(sessionSocketPath: options.sessionSocketPath)) { _, value in value }
        }
        let files = try ClaudeInstalledConfigurationFiles(root: options.configurationRoot,
            documents: ClaudeInstalledLaunchConfiguration.documents(nodeExecutable: options.nodeExecutable,
                payloadRoot: options.payloadRoot, nativeSessionID: nativeSessionID, observeSession: options.observeSession))
        // Keep public Hook settings available even if Blabee disconnects while
        // Claude remains usable. Cleanup happens only after the child is reaped.
        defer { withExtendedLifetime(files) {} }
        if let signal = signals.pendingTermination { lifetime.end(reason: .userDisconnected); return 128 + signal }
        willSpawn()
        let child = try ClaudeInstalledChild(executable: options.claudeExecutable,
            arguments: ClaudeInstalledLaunchConfiguration.arguments(nativeSessionID: nativeSessionID,
                settings: files.settings, mcp: files.mcp, claudeArguments: options.claudeArguments),
            cwd: options.cwd, environment: environment)
        ownedChild = child
        try bootstrap?.activate(childPID: child.pid)
        try terminal.handOff(to: child.pid)
        try child.resume()
        var requestedTermination = false
        var terminationDeadline: UInt64?
        var stoppedTerminal: termios?
        while true {
            if let result = try child.pollExit() {
                terminal.restore()
                bootstrap?.close()
                lifetime.end(reason: requestedTermination ? .userDisconnected : .childExited)
                return result
            }
            // Explicit termination already queued for this iteration takes
            // precedence over child suspension or a foreground handoff.
            let pending = signals.takeSignals()
            if pending.interrupts > 0 {
                // A physical Ctrl-C already goes to the foreground child group.
                // Only SIGINT addressed to this supervisor reaches this handler.
                child.send(SIGINT)
            }
            if pending.termination != nil && !requestedTermination {
                requestedTermination = true
                // Closing the owner immediately revokes this one connection and
                // unblocks renewal I/O; child cleanup never awaits service I/O.
                bootstrap?.close()
                lifetime.stop()
                child.send(SIGTERM)
                child.send(SIGCONT)
                terminationDeadline = SystemCoordinatorContinuousClock().nowNanoseconds() &+ 2_000_000_000
            }
            if child.takeStopSignal() != nil {
                if requestedTermination { child.send(SIGCONT) }
                else {
                    stoppedTerminal = try terminal.captureChildAndRestore()
                    // Stop only this supervisor, not a possibly shared caller
                    // group. The invoking shell can now observe/foreground it.
                    guard kill(getpid(), SIGSTOP) == 0 else { throw failure("supervisor_suspend_failed") }
                    // On resume, process newly queued termination before any
                    // handoff. The existing renewal timer checks continuous
                    // time on its next tick without blocking this signal loop.
                    continue
                }
            }
            if let saved = stoppedTerminal, terminal.isForeground, !requestedTermination {
                try terminal.handOff(to: child.pid, restoring: saved)
                try child.resume()
                stoppedTerminal = nil
            }
            if let deadline = terminationDeadline,
               SystemCoordinatorContinuousClock().nowNanoseconds() >= deadline {
                child.send(SIGKILL)
                terminationDeadline = nil
            }
            if terminal.ownsForeground(childPID: child.pid), state.takeNotice() {
                terminal.writeDisconnectNotice()
            }
            usleep(20_000)
        }
        } catch {
            // A failed preflight must not turn a queued cancellation into the
            // automatic command's one-time fallback launch of the original CLI.
            if let signal = signals.pendingTermination { return 128 + signal }
            throw error
        }
    }

    typealias TerminalRunner = (URL, [String], [String: String]) throws -> ManagedCodexVersionProbeResult

    static func openInTerminal(_ options: Options, coordinatorExecutable: URL,
                               runner: TerminalRunner = terminalRunner) throws {
        let executable = try ClaudeInstalledLaunchConfiguration.canonicalFile(coordinatorExecutable, executable: true)
        let options = try validated(options)
        let arguments = ["-e", ClaudeInstalledLaunchConfiguration.terminalScript, "--"]
            + terminalArguments(options, coordinatorExecutable: executable)
        let environment = ClaudeInstalledLaunchConfiguration.cleanEnvironment(ProcessInfo.processInfo.environment)
        let result: ManagedCodexVersionProbeResult
        do { result = try runner(URL(fileURLWithPath: "/usr/bin/osascript"), arguments, environment) }
        catch { throw failure("terminal_open_unconfirmed") }
        guard result.exitCode == 0, result.terminationSignal == nil else { throw failure("terminal_open_unconfirmed") }
        // One attempt only: failure/timeout can still mean a window was opened.
    }

    static func terminalArguments(_ options: Options, coordinatorExecutable: URL) -> [String] {
        var values = [coordinatorExecutable.path, "claude-installed-launcher", "--owner-socket", options.ownerSocketPath,
            "--session-socket", options.sessionSocketPath, "--runtime-identity", options.runtimeIdentity,
            "--cwd", options.cwd.path, "--claude-bin", options.claudeExecutable.path,
            "--node-bin", options.nodeExecutable.path, "--payload-root", options.payloadRoot.path]
        if let root = options.configurationRoot { values += ["--configuration-root", root.path] }
        if options.observeSession { values += ["--observe-session"] }
        if !options.claudeArguments.isEmpty { values += ["--"] + options.claudeArguments }
        return values
    }

    private static func terminalRunner(_ executable: URL, _ arguments: [String],
                                       _ environment: [String: String]) throws -> ManagedCodexVersionProbeResult {
        try ManagedCodexVersionProbeRunner.run(executable: executable, arguments: arguments, environment: environment,
            timeoutMilliseconds: 15_000, outputLimit: 16 * 1024)
    }

    /// No CLI/environment path can substitute a developer runtime for the
    /// current signed app. The common executable lease is already held by main.
    private static func prepareInstalledRuntime(_ options: Options) throws -> (Options, ClaudeRuntimePayloadUse?) {
        guard let executable = AppRuntimeUseLease.packagedExecutable(Bundle.main.executableURL),
              try OperationalRuntimeIdentity.requireCurrent() == options.runtimeIdentity else {
            throw failure("runtime_payload_unverified")
        }
        let pin = try signedManifestPin(executable: executable, runtimeIdentity: options.runtimeIdentity)
        let contents = executable.deletingLastPathComponent().deletingLastPathComponent()
        return try prepareRuntime(options, runtimeRoot: contents.appendingPathComponent("Resources/claude"),
                                  storeRoot: ClaudeRuntimePayload.defaultStoreRootURL, manifestSHA256: pin)
    }

    private static func prepareRuntime(_ options: Options, runtimeRoot: URL,
                                       storeRoot: URL, manifestSHA256: String? = nil) throws -> (Options, ClaudeRuntimePayloadUse?) {
        guard options.payloadRoot.path == runtimeRoot.appendingPathComponent("payload").path,
              options.nodeExecutable.path == runtimeRoot.appendingPathComponent("node/bin/node").path else {
            throw failure("runtime_payload_unverified")
        }
        let prepared = try ClaudeRuntimePayload.prepare(bundleRootURL: runtimeRoot, storeRootURL: storeRoot,
            expectedArchitecture: runtimeArchitecture, expectedManifestSHA256: manifestSHA256)
        let use = try ClaudeRuntimePayloadUse.begin(prepared: prepared, runtimeIdentity: options.runtimeIdentity,
                                                    storeRootURL: storeRoot)
        return (Options(ownerSocketPath: options.ownerSocketPath, sessionSocketPath: options.sessionSocketPath,
                        runtimeIdentity: options.runtimeIdentity, cwd: options.cwd,
                        claudeExecutable: options.claudeExecutable, nodeExecutable: prepared.nodeExecutable,
                        payloadRoot: prepared.payloadRoot, channelSource: options.channelSource,
                        configurationRoot: options.configurationRoot, observeSession: options.observeSession,
                        claudeArguments: options.claudeArguments), use)
    }

    static func signedManifestPin(executable: URL, runtimeIdentity: String) throws -> String {
        guard let inspection = OperationalRuntimeIdentity.installedInspection(forExecutable: executable),
              inspection.snapshot.runtimeIdentity == runtimeIdentity else { throw failure("runtime_payload_unverified") }
        let resources = executable.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources")
        guard let directory = try ClaudePayloadFS.openAbsoluteDirectory(resources, create: false) else {
            throw failure("runtime_payload_unverified")
        }
        defer { close(directory) }
        let descriptor = try ClaudePayloadFS.openRegular(parent: directory, name: "assembly-manifest.json")
        defer { close(descriptor) }
        return try manifestPin(in: ClaudePayloadFS.read(descriptor, maximumBytes: 1_048_576),
                               verifiedAssemblySHA256: inspection.assemblyManifestSHA256)
    }

    /// The assembly digest comes from signature validation of exact bytes.
    /// Re-reading a replaced assembly/descriptor cannot introduce a new pin.
    static func manifestPin(in assembly: Data, verifiedAssemblySHA256: String) throws -> String {
        let hash = SHA256.hash(data: assembly).map { String(format: "%02x", $0) }.joined()
        guard "sha256:" + hash == verifiedAssemblySHA256,
              OperationalRuntimeIdentity.compatibilityPolicies(inAssemblyManifest: assembly) != nil,
              let files = try StrictJSONTransport.object(from: assembly)["files"] as? [[String: Any]],
              let descriptor = files.first(where: { $0["path"] as? String == "Contents/Resources/claude/manifest.json" }),
              let pin = descriptor["sha256"] as? String else { throw failure("runtime_payload_unverified") }
        return pin
    }

    static var runtimeArchitecture: String {
        #if arch(arm64)
        "arm64"
        #elseif arch(x86_64)
        "x64"
        #else
        "unsupported"
        #endif
    }

    private static func preflight(executable: URL, environment: [String: String],
                                  accepts: (Data) -> Bool, failure suffix: String) throws {
        let value: ManagedCodexVersionProbeResult
        do { value = try ManagedCodexVersionProbeRunner.run(executable: executable, arguments: ["--version"],
            environment: environment, timeoutMilliseconds: 5_000, outputLimit: 16 * 1024) }
        catch { throw failure(suffix) }
        guard value.exitCode == 0, value.terminationSignal == nil, accepts(value.stdout) else { throw failure(suffix) }
    }

    private static func validated(_ options: Options) throws -> Options {
        guard options.channelSource == "blabee-claude", OperationalRuntimeIdentity.isValid(options.runtimeIdentity),
              options.observeSession || options.claudeArguments.isEmpty,
              options.claudeArguments.count <= 8192,
              options.claudeArguments.allSatisfy({ !$0.contains("\0") && $0.utf8.count <= 65_536 }),
              options.claudeArguments.reduce(0, { $0 + $1.utf8.count }) <= 1_048_576 else {
            throw failure("configuration_invalid")
        }
        try ClaudeInstalledOwnerIO.requireSocketPath(options.ownerSocketPath)
        try ClaudeInstalledOwnerIO.requireSocketPath(options.sessionSocketPath)
        let payload = try ClaudeInstalledLaunchConfiguration.canonicalDirectory(options.payloadRoot)
        _ = try ClaudeInstalledLaunchConfiguration.canonicalFile(payload.appendingPathComponent("src/session-v2-hook.mjs"))
        _ = try ClaudeInstalledLaunchConfiguration.canonicalFile(payload.appendingPathComponent("src/session-v2-mcp.mjs"))
        if options.observeSession {
            _ = try ClaudeInstalledLaunchConfiguration.canonicalFile(payload.appendingPathComponent("src/auto-connect-hook.mjs"))
            _ = try ClaudeInstalledLaunchConfiguration.canonicalFile(payload.appendingPathComponent("src/auto-connect-mcp.mjs"))
        }
        return try Options(ownerSocketPath: options.ownerSocketPath, sessionSocketPath: options.sessionSocketPath,
            runtimeIdentity: options.runtimeIdentity, cwd: ClaudeInstalledLaunchConfiguration.canonicalDirectory(options.cwd),
            claudeExecutable: ClaudeInstalledLaunchConfiguration.canonicalFile(options.claudeExecutable, executable: true),
            nodeExecutable: ClaudeInstalledLaunchConfiguration.canonicalFile(options.nodeExecutable, executable: true),
            payloadRoot: payload, channelSource: options.channelSource,
            configurationRoot: options.configurationRoot.map(ClaudeInstalledLaunchConfiguration.canonicalDirectory),
            observeSession: options.observeSession, claudeArguments: options.claudeArguments)
    }

    private static func failure(_ suffix: String) -> CoordinatorError { ClaudeInstalledLaunchConfiguration.failure(suffix) }
}

private final class ClaudeInstalledDisconnectState: @unchecked Sendable {
    private let lock = NSLock()
    private var disconnected = false
    private var notified = false
    func markDisconnected() { lock.withLock { disconnected = true } }
    func takeNotice() -> Bool {
        lock.withLock {
            guard disconnected, !notified else { return false }
            notified = true; return true
        }
    }
}

/// A resumed conversation is not known until a Hook is observed. This holder
/// lets the supervisor close its lifetime immediately even while enrollment is
/// in flight; a late grant can never resurrect a stopped launch.
private final class ClaudeInstalledOwnerLifetime: @unchecked Sendable {
    private let lock = NSLock()
    private let disconnected: @Sendable () -> Void
    private var owner: ClaudeInstalledOwnerConnection?
    private var renewal: ClaudeOwnerRenewalController?
    private var closed = false

    init(disconnected: @escaping @Sendable () -> Void) { self.disconnected = disconnected }

    var isActive: Bool {
        let controller = lock.withLock { closed ? nil : renewal }
        return controller != nil && controller?.snapshot().terminalReason == nil
    }

    func install(_ connection: ClaudeInstalledOwnerConnection) throws {
        let controller = try ClaudeOwnerRenewalController(identity: connection.identity,
            initialDeadlineNanoseconds: connection.initialDeadlineNanoseconds, secretCorpus: connection.secretCorpus,
            exchange: { try connection.exchange($0) }, disconnected: { [weak self] reason in
                connection.close()
                if reason != .ended && reason != .stopped { self?.disconnected() }
            })
        do {
            try lock.withLock {
                guard !closed, owner == nil else { throw ClaudeInstalledLaunchConfiguration.failure("owner_closed") }
                owner = connection
                renewal = controller
            }
            try connection.startEOFMonitor { [weak self, weak controller] in
                controller?.stop()
                self?.disconnected()
            }
            try controller.start()
            guard isActive else { throw ClaudeInstalledLaunchConfiguration.failure("owner_closed") }
        } catch {
            controller.stop()
            connection.close()
            throw error
        }
    }

    func stop() {
        let values = take()
        values.0?.close()
        values.1?.stop()
    }

    func end(reason: ClaudeSessionAuthority.RevocationReason) {
        let values = take()
        values.1?.end(reason: reason)
        values.0?.close()
    }

    private func take() -> (ClaudeInstalledOwnerConnection?, ClaudeOwnerRenewalController?) {
        lock.withLock {
            closed = true
            let values = (owner, renewal)
            owner = nil; renewal = nil
            return values
        }
    }
}

/// Signal handlers only enqueue intent. No allocation, socket operation or
/// child kill is performed from an asynchronous POSIX signal handler.
private final class ClaudeInstalledSignals: @unchecked Sendable {
    private let lock = NSLock()
    private var interrupts = 0
    private var termination: Int32?
    private var sources: [any DispatchSourceSignal] = []
    private var restorations: [() -> Void] = []
    init() {
        for number in [SIGINT, SIGTERM, SIGHUP] {
            let old = Darwin.signal(number, SIG_IGN)
            restorations.append { _ = Darwin.signal(number, old) }
            let source = DispatchSource.makeSignalSource(signal: number,
                queue: DispatchQueue(label: "com.biadone.blabee.claude-installed-signal.\(number)"))
            source.setEventHandler { [weak self] in
                self?.lock.withLock {
                    if number == SIGINT { self?.interrupts += 1 }
                    else { self?.termination = number }
                }
            }
            source.resume(); sources.append(source)
        }
    }
    var pendingTermination: Int32? { lock.withLock { termination ?? (interrupts > 0 ? SIGINT : nil) } }
    func takeSignals() -> (interrupts: Int, termination: Int32?) {
        lock.withLock { let value = (interrupts, termination); interrupts = 0; return value }
    }
    func close() {
        sources.forEach { $0.cancel() }; sources.removeAll()
        restorations.forEach { $0() }; restorations.removeAll()
    }
    deinit { close() }
}

private final class ClaudeInstalledTerminal {
    private let group: pid_t
    private var original = termios()
    private var handedOff = false
    init() throws {
        group = tcgetpgrp(STDIN_FILENO)
        guard isatty(STDIN_FILENO) == 1, isatty(STDOUT_FILENO) == 1, group > 0, group == getpgrp(),
              tcgetattr(STDIN_FILENO, &original) == 0 else { throw ClaudeInstalledLaunchConfiguration.failure("interactive_tty_required") }
    }
    var isForeground: Bool { tcgetpgrp(STDIN_FILENO) == group }
    func ownsForeground(childPID: pid_t) -> Bool {
        let current = tcgetpgrp(STDIN_FILENO)
        return current == group || current == childPID
    }
    func writeDisconnectNotice() {
        // A TOSTOP-enabled terminal must not suspend the owner merely because
        // its own foreground child is running. Defer notices while another job
        // owns the terminal; never change the user's termios flags.
        try? Self.withTTOUBlocked {
            FileHandle.standardError.write(Data("Blabee 연결이 종료됐습니다. Claude 작업은 계속 사용할 수 있습니다.\n".utf8))
        }
    }
    func handOff(to pid: pid_t, restoring saved: termios? = nil) throws {
        guard isForeground else { throw ClaudeInstalledLaunchConfiguration.failure("terminal_not_foreground") }
        guard getpgid(pid) == pid else { throw ClaudeInstalledLaunchConfiguration.failure("child_process_group_invalid") }
        try Self.withTTOUBlocked {
            guard tcsetpgrp(STDIN_FILENO, pid) == 0 else { throw ClaudeInstalledLaunchConfiguration.failure("terminal_handoff_failed") }
            handedOff = true
            if var saved, tcsetattr(STDIN_FILENO, TCSANOW, &saved) != 0 {
                throw ClaudeInstalledLaunchConfiguration.failure("terminal_handoff_failed")
            }
        }
    }
    func captureChildAndRestore() throws -> termios {
        var saved = termios()
        guard handedOff, tcgetattr(STDIN_FILENO, &saved) == 0 else {
            throw ClaudeInstalledLaunchConfiguration.failure("terminal_restore_failed")
        }
        try Self.withTTOUBlocked {
            guard tcsetpgrp(STDIN_FILENO, group) == 0, tcsetattr(STDIN_FILENO, TCSANOW, &original) == 0 else {
                throw ClaudeInstalledLaunchConfiguration.failure("terminal_restore_failed")
            }
        }
        handedOff = false
        return saved
    }
    func restore() {
        guard handedOff else { return }
        try? Self.withTTOUBlocked {
            _ = tcsetpgrp(STDIN_FILENO, group)
            _ = tcsetattr(STDIN_FILENO, TCSANOW, &original)
        }
        handedOff = false
    }
    private static func withTTOUBlocked<T>(_ body: () throws -> T) throws -> T {
        var set = sigset_t(), old = sigset_t()
        guard sigemptyset(&set) == 0, sigaddset(&set, SIGTTOU) == 0,
              pthread_sigmask(SIG_BLOCK, &set, &old) == 0 else { throw ClaudeInstalledLaunchConfiguration.failure("terminal_signal_mask_failed") }
        defer { _ = pthread_sigmask(SIG_SETMASK, &old, nil) }
        return try body()
    }
}

/// A direct child stays unreaped until this object observes it, so its PID
/// cannot be recycled while signals are sent. Only its own process group is used.
final class ClaudeInstalledChild {
    let pid: pid_t
    private var result: Int32?
    private var stopSignal: Int32?

    init(executable: URL, arguments: [String], cwd: URL, environment: [String: String],
         standardDescriptors: [Int32] = [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO]) throws {
        guard standardDescriptors.count == 3, standardDescriptors.allSatisfy({ $0 >= 0 }),
              !arguments.contains(where: { $0.utf8.contains(0) }) else { throw Self.failure() }
        let environment = try ManagedCodexLaunchEnvironment.validated(environment)
        var actions: posix_spawn_file_actions_t?, attributes: posix_spawnattr_t?
        guard posix_spawn_file_actions_init(&actions) == 0 else { throw Self.failure() }
        defer { posix_spawn_file_actions_destroy(&actions) }
        guard posix_spawnattr_init(&attributes) == 0 else { throw Self.failure() }
        defer { posix_spawnattr_destroy(&attributes) }
        for (target, descriptor) in standardDescriptors.enumerated() {
            let status = descriptor == Int32(target)
                ? posix_spawn_file_actions_addinherit_np(&actions, descriptor)
                : posix_spawn_file_actions_adddup2(&actions, descriptor, Int32(target))
            guard status == 0 else { throw Self.failure() }
        }
        guard posix_spawn_file_actions_addchdir_np(&actions, cwd.path) == 0 else { throw Self.failure() }
        var mask = sigset_t(), defaults = sigset_t()
        guard sigemptyset(&mask) == 0, sigemptyset(&defaults) == 0 else { throw Self.failure() }
        for number in [SIGINT, SIGTERM, SIGHUP, SIGPIPE, SIGQUIT, SIGTSTP, SIGTTIN, SIGTTOU] {
            guard sigaddset(&defaults, number) == 0 else { throw Self.failure() }
        }
        let flags = POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK
            | POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_START_SUSPENDED
        guard posix_spawnattr_setflags(&attributes, Int16(flags)) == 0,
              posix_spawnattr_setpgroup(&attributes, 0) == 0,
              posix_spawnattr_setsigdefault(&attributes, &defaults) == 0,
              posix_spawnattr_setsigmask(&attributes, &mask) == 0 else { throw Self.failure() }
        var argv = ([executable.path] + arguments).map { strdup($0) }
        var envp = environment.keys.sorted().map { strdup($0 + "=" + environment[$0]!) }
        defer { argv.forEach { free($0) }; envp.forEach { free($0) } }
        guard argv.allSatisfy({ $0 != nil }), envp.allSatisfy({ $0 != nil }) else { throw Self.failure() }
        argv.append(nil); envp.append(nil)
        var child: pid_t = 0
        let status = argv.withUnsafeMutableBufferPointer { arguments in
            envp.withUnsafeMutableBufferPointer { environment in
                posix_spawn(&child, executable.path, &actions, &attributes, arguments.baseAddress, environment.baseAddress)
            }
        }
        guard status == 0, child > 0 else { throw Self.failure() }
        pid = child
    }
    deinit { terminateAndReap() }
    func resume() throws { guard kill(-pid, SIGCONT) == 0 else { throw Self.failure() } }
    func takeStopSignal() -> Int32? { defer { stopSignal = nil }; return stopSignal }
    func send(_ signal: Int32) {
        guard result == nil else { return }
        _ = kill(-pid, signal)
    }
    func pollExit() throws -> Int32? {
        if let result { return result }
        var status: Int32 = 0
        let reaped = waitpid(pid, &status, WNOHANG | WUNTRACED)
        if reaped == 0 || (reaped < 0 && errno == EINTR) { return nil }
        guard reaped == pid else { throw Self.failure() }
        let signal = status & 0x7f
        if signal == 0x7f { stopSignal = (status >> 8) & 0xff; return nil }
        let code = signal == 0 ? (status >> 8) & 0xff : 128 + signal
        result = code
        return code
    }
    func terminateAndReap() {
        guard result == nil else { return }
        _ = kill(-pid, SIGKILL)
        var status: Int32 = 0
        var reaped: pid_t
        repeat { reaped = waitpid(pid, &status, 0) } while reaped < 0 && errno == EINTR
        if reaped == pid { result = 128 + SIGKILL }
    }
    var isReaped: Bool { result != nil }
    private static func failure() -> CoordinatorError { ClaudeInstalledLaunchConfiguration.failure("child_launch_unavailable") }
}

/// A private owner connection is never inherited by Claude. Public UUIDs bind
/// its frames; peer signing and this exact open socket authenticate enrollment.
final class ClaudeInstalledOwnerConnection: @unchecked Sendable {
    typealias PeerVerifier = @Sendable (Int32) throws -> ClaudeSessionEnrollment.PeerIdentity
    struct ObservedSession: Sendable, Equatable {
        let nativeSessionID: UUID
        let source: String
    }
    let identity: ClaudeSessionAuthority.Identity
    let initialDeadlineNanoseconds: UInt64
    let coreProjectID: String
    let coreSessionID: String
    let secretCorpus: RuntimeSecretCorpus
    private let runtimeIdentity: String
    private let cwd: String
    private let channelSource: String
    private let hookToken: String
    private let bridgeToken: String
    private let peer: ClaudeSessionEnrollment.PeerIdentity
    private let peerVerifier: PeerVerifier
    private let descriptorLock = NSLock()
    private let ioLock = NSLock()
    private var descriptor: Int32
    private var operations = 0
    private var closed = false
    private var monitor: DispatchSourceTimer?

    static func connect(ownerSocketPath: String, runtimeIdentity: String, canonicalCWD: String,
                        channelSource: String = "blabee-claude",
                        observedSession: ObservedSession? = nil,
                        clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock()) throws -> ClaudeInstalledOwnerConnection {
        try establish(ownerSocketPath: ownerSocketPath, runtimeIdentity: runtimeIdentity,
            canonicalCWD: canonicalCWD, channelSource: channelSource, observedSession: observedSession, clock: clock,
            peerVerifier: { try ClaudeSessionEnrollment.verifySignedPeer($0, runtimeIdentity: runtimeIdentity) })
    }

    #if BLABEE_JOURNAL_TEST_HARNESS
    /// Compile-time-only fixture seam. No CLI, environment or release switch
    /// can accept an unsigned service, and the real UDS/FD protocol is retained.
    static func connectTesting(ownerSocketPath: String, runtimeIdentity: String, canonicalCWD: String,
                               channelSource: String = "blabee-claude",
                               observedSession: ObservedSession? = nil,
                               clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
                               peerVerifier: @escaping PeerVerifier = { try ClaudeSessionEnrollment.testingPeer($0) }) throws -> ClaudeInstalledOwnerConnection {
        try establish(ownerSocketPath: ownerSocketPath, runtimeIdentity: runtimeIdentity,
            canonicalCWD: canonicalCWD, channelSource: channelSource, observedSession: observedSession,
            clock: clock, peerVerifier: peerVerifier)
    }

    static func readFrameTesting(_ descriptor: Int32) throws -> Data {
        try ClaudeInstalledOwnerIO.readFrame(descriptor, deadline: ClaudeInstalledOwnerIO.deadline())
    }

    var descriptorIsCloseOnExecTesting: Bool {
        (try? withDescriptor { fcntl($0, F_GETFD) & FD_CLOEXEC != 0 }) == true
    }
    #endif

    private init(descriptor: Int32, identity: ClaudeSessionAuthority.Identity, deadline: UInt64,
                 coreProjectID: String, coreSessionID: String, runtimeIdentity: String,
                 cwd: String, channelSource: String, tokens: [String: String], corpus: RuntimeSecretCorpus,
                 peer: ClaudeSessionEnrollment.PeerIdentity, peerVerifier: @escaping PeerVerifier) {
        self.descriptor = descriptor
        self.identity = identity
        initialDeadlineNanoseconds = deadline
        self.coreProjectID = coreProjectID
        self.coreSessionID = coreSessionID
        self.runtimeIdentity = runtimeIdentity
        self.cwd = cwd
        self.channelSource = channelSource
        hookToken = tokens["hook"]!
        bridgeToken = tokens["bridge"]!
        secretCorpus = corpus
        self.peer = peer
        self.peerVerifier = peerVerifier
    }

    deinit { close() }

    private static func establish(ownerSocketPath: String, runtimeIdentity: String, canonicalCWD: String,
                                  channelSource: String, observedSession: ObservedSession?, clock: any CoordinatorContinuousClock,
                                  peerVerifier: @escaping PeerVerifier) throws -> ClaudeInstalledOwnerConnection {
        guard OperationalRuntimeIdentity.isValid(runtimeIdentity), channelSource == "blabee-claude",
              ClaudeCanonicalDirectory.matches(canonicalCWD),
              observedSession.map({ ["startup", "resume", "fork"].contains($0.source) }) ?? true else {
            throw failure("configuration_invalid")
        }
        let descriptor = try ClaudeInstalledOwnerIO.connect(ownerSocketPath)
        var owned = true
        defer { if owned { _ = shutdown(descriptor, SHUT_RDWR); Darwin.close(descriptor) } }
        let deadline = try ClaudeInstalledOwnerIO.deadline()
        let peer = try peerVerifier(descriptor)
        let challenge = try StrictJSONTransport.object(from: ClaudeInstalledOwnerIO.readFrame(descriptor, deadline: deadline))
        guard Set(challenge.keys) == ["schema_version", "runtime_identity", "service_incarnation", "owner_connection_id", "challenge_id", "grant_pipe_id"],
              challenge["schema_version"] as? String == "blabee.claude-enrollment-challenge.v1",
              challenge["runtime_identity"] as? String == runtimeIdentity else { throw failure("challenge_invalid") }
        let service = try uuid(challenge["service_incarnation"]), owner = try uuid(challenge["owner_connection_id"])
        _ = try uuid(challenge["challenge_id"]); _ = try uuid(challenge["grant_pipe_id"])
        let corpus = RuntimeSecretCorpus()
        let codec = ClaudeProductWireCodec(credentialCorpus: corpus)
        var payload: [String: Any] = [
            "service_incarnation": service.uuidString.lowercased(), "owner_connection_id": owner.uuidString.lowercased(),
            "challenge_id": challenge["challenge_id"]!, "grant_pipe_id": challenge["grant_pipe_id"]!,
            "cwd": canonicalCWD, "channel_source": channelSource,
        ]
        if let observedSession {
            payload["native_session_id"] = observedSession.nativeSessionID.uuidString.lowercased()
            payload["source"] = observedSession.source
        }
        let request = try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-owner.v1", "kind": "request", "provider": "claude", "role": "owner",
            "request_id": UUID().uuidString.lowercased(), "operation": observedSession == nil ? "enroll" : "enroll_observed",
            "payload": payload
        ]))
        var pipeFDs: [Int32] = [-1, -1]
        guard Darwin.pipe(&pipeFDs) == 0 else { throw failure("grant_unavailable") }
        defer { for value in pipeFDs where value >= 0 { Darwin.close(value) } }
        for value in pipeFDs { try ClaudeInstalledOwnerIO.configure(value, socket: false) }
        guard try peerVerifier(descriptor) == peer else { throw failure("peer_changed") }
        try ClaudeInstalledOwnerIO.sendFrame(request.canonicalJSON, descriptor: descriptor, passing: pipeFDs[1], deadline: deadline)
        Darwin.close(pipeFDs[1]); pipeFDs[1] = -1
        let grantData = try ClaudeInstalledOwnerIO.readPipe(pipeFDs[0], deadline: deadline)
        Darwin.close(pipeFDs[0]); pipeFDs[0] = -1
        let grant = try StrictJSONTransport.object(from: grantData,
            limits: StrictJSONLimits(maximumBytes: 16 * 1024, maximumDepth: 6))
        guard Set(grant.keys) == ["schema_version", "authority", "core_project_id", "core_session_id", "role_capabilities"],
              grant["schema_version"] as? String == "blabee.claude-private-grant.v1",
              let grantAuthority = grant["authority"] as? [String: String],
              Set(grantAuthority.keys) == ["scope_id", "native_session_id", "session_incarnation", "service_incarnation", "owner_connection_id", "authority_epoch"],
              let project = grant["core_project_id"] as? String, let session = grant["core_session_id"] as? String,
              let tokens = grant["role_capabilities"] as? [String: String], Set(tokens.keys) == ["hook", "bridge", "owner"],
              Set(tokens.values).count == 3, tokens.values.allSatisfy(validToken),
              validCoreID(project, prefix: "claude_project_"), validCoreID(session, prefix: "claude_session_") else {
            throw failure("grant_invalid")
        }
        for value in tokens.values { corpus.register(value) }
        let responseData = try ClaudeInstalledOwnerIO.readFrame(descriptor, deadline: deadline)
        let response = try codec.decodeResponse(responseData, matching: request,
            connection: .init(serviceIncarnation: service, ownerConnectionID: owner))
        let object = try StrictJSONTransport.object(from: response.canonicalJSON)
        guard object["ok"] as? Bool == true, object["authority"] as? [String: String] == grantAuthority,
              let result = object["result"] as? [String: Any], result["core_session_id"] as? String == session,
              result["grant_pipe_id"] as? String == challenge["grant_pipe_id"] as? String,
              result["grant_delivery"] as? String == "private_pipe",
              let lease = result["lease"] as? [String: String], lease["renewal_sequence"] == "0",
              let expiry = lease["deadline_nanoseconds"].flatMap(UInt64.init) else { throw failure("response_invalid") }
        let now = clock.nowNanoseconds()
        let (latest, overflow) = now.addingReportingOverflow(ClaudeSessionAuthority.leaseDurationNanoseconds)
        guard !overflow, now != UInt64.max, expiry > now, expiry <= latest,
              try peerVerifier(descriptor) == peer else { throw failure("response_invalid") }
        let identity = try ClaudeSessionAuthority.Identity(scopeID: uuid(grantAuthority["scope_id"]),
            nativeSessionID: uuid(grantAuthority["native_session_id"]), sessionIncarnation: uuid(grantAuthority["session_incarnation"]),
            serviceIncarnation: uuid(grantAuthority["service_incarnation"]), ownerConnectionID: uuid(grantAuthority["owner_connection_id"]),
            authorityEpoch: uuid(grantAuthority["authority_epoch"]))
        guard observedSession == nil || identity.nativeSessionID == observedSession?.nativeSessionID else {
            throw failure("binding_invalid")
        }
        owned = false
        return ClaudeInstalledOwnerConnection(descriptor: descriptor, identity: identity, deadline: expiry,
            coreProjectID: project, coreSessionID: session, runtimeIdentity: runtimeIdentity, cwd: canonicalCWD,
            channelSource: channelSource, tokens: tokens, corpus: corpus, peer: peer, peerVerifier: peerVerifier)
    }

    func childEnvironment(sessionSocketPath: String) throws -> [String: String] {
        try ClaudeInstalledOwnerIO.requireSocketPath(sessionSocketPath)
        let p = ClaudeInstalledLaunchConfiguration.prefix
        var values = ClaudeSessionRegistry.authorityObject(identity).reduce(into: [String: String]()) {
            $0[p + $1.key.uppercased()] = $1.value
        }
        values[p + "SOCKET"] = sessionSocketPath
        values[p + "RUNTIME_IDENTITY"] = runtimeIdentity
        values[p + "CWD"] = cwd
        values[p + "CHANNEL_SOURCE"] = channelSource
        values[p + "HOOK_TOKEN"] = hookToken
        values[p + "BRIDGE_TOKEN"] = bridgeToken
        return values
    }

    func exchange(_ request: Data) throws -> Data {
        try ioLock.withLock {
            try withDescriptor { descriptor in
                let codec = ClaudeProductWireCodec(credentialCorpus: secretCorpus)
                let command = try codec.decodeRequest(request)
                let object = try StrictJSONTransport.object(from: command.canonicalJSON)
                guard command.contract == .owner, command.role == "owner",
                      command.operation == "renew" || command.operation == "end",
                      object["authority"] as? [String: String] == ClaudeSessionRegistry.authorityObject(identity) else {
                    throw Self.failure("binding_invalid")
                }
                guard try peerVerifier(descriptor) == peer else { throw Self.failure("peer_changed") }
                let deadline = try ClaudeInstalledOwnerIO.deadline()
                try ClaudeInstalledOwnerIO.sendFrame(command.canonicalJSON, descriptor: descriptor, passing: nil, deadline: deadline)
                let response = try ClaudeInstalledOwnerIO.readFrame(descriptor, deadline: deadline)
                let checked = try codec.decodeResponse(response, matching: command,
                    connection: .init(serviceIncarnation: identity.serviceIncarnation, ownerConnectionID: identity.ownerConnectionID))
                let reply = try StrictJSONTransport.object(from: checked.canonicalJSON)
                if command.operation == "end" || reply["ok"] as? Bool == false {
                    // End and control errors close this exact pinned UDS. Its
                    // already-read, fully correlated receipt remains valid even
                    // after EOF makes LOCAL_PEERPID unavailable. Never reopen.
                    close()
                    return checked.canonicalJSON
                }
                guard try peerVerifier(descriptor) == peer else { throw Self.failure("peer_changed") }
                return checked.canonicalJSON
            }
        }
    }

    func startEOFMonitor(_ callback: @escaping @Sendable () -> Void) throws {
        try descriptorLock.withLock {
            guard !closed, monitor == nil else { throw Self.failure("owner_closed") }
            let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.biadone.blabee.claude-installed-owner"))
            timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(20))
            timer.setEventHandler { [weak self] in
                guard let self, self.ioLock.try() else { return }
                let failed: Bool
                do {
                    failed = try self.withDescriptor { descriptor in
                        var item = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
                        let result = poll(&item, 1, 0)
                        // No unsolicited owner frames exist. An idle readable
                        // socket means EOF or a protocol violation, never retry.
                        return result < 0 ? errno != EINTR : result > 0
                    }
                } catch { failed = true }
                self.ioLock.unlock()
                if failed { self.close(); callback() }
            }
            monitor = timer
            timer.resume()
        }
    }

    func close() {
        descriptorLock.withLock {
            guard !closed else { return }
            closed = true
            monitor?.cancel(); monitor = nil
            _ = shutdown(descriptor, SHUT_RDWR)
            if operations == 0 { Darwin.close(descriptor); descriptor = -1 }
        }
    }

    private func withDescriptor<T>(_ body: (Int32) throws -> T) throws -> T {
        let value = try descriptorLock.withLock {
            guard !closed, descriptor >= 0 else { throw Self.failure("owner_closed") }
            operations += 1
            return descriptor
        }
        defer {
            descriptorLock.withLock {
                operations -= 1
                if closed && operations == 0 && descriptor >= 0 { Darwin.close(descriptor); descriptor = -1 }
            }
        }
        return try body(value)
    }

    private static func uuid(_ value: Any?) throws -> UUID {
        guard let text = value as? String, let parsed = UUID(uuidString: text), parsed.uuidString.lowercased() == text else {
            throw failure("binding_invalid")
        }
        return parsed
    }
    private static func validToken(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private static func validCoreID(_ value: String, prefix: String) -> Bool {
        value.hasPrefix(prefix) && (try? uuid(String(value.dropFirst(prefix.count)))) != nil
    }
    private static func failure(_ suffix: String) -> CoordinatorError { ClaudeInstalledLaunchConfiguration.failure(suffix) }
}

enum ClaudeInstalledOwnerIO {
    static func deadline() throws -> UInt64 {
        let (result, overflow) = SystemCoordinatorContinuousClock().nowNanoseconds().addingReportingOverflow(7_000_000_000)
        guard !overflow else { throw failure() }; return result
    }
    static func requireSocketPath(_ path: String) throws {
        guard ClaudeCanonicalDirectory.isNormalizedAbsolute(path),
              path.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path),
              ClaudeCanonicalDirectory.matches(URL(fileURLWithPath: path).deletingLastPathComponent().path) else { throw failure() }
        var info = stat()
        if lstat(path, &info) == 0 {
            guard let raw = realpath(path, nil) else { throw failure() }
            defer { free(raw) }
            guard let canonical = String(validatingCString: raw), canonical.utf8.elementsEqual(path.utf8) else { throw failure() }
        } else if errno != ENOENT { throw failure() }
    }
    static func connect(_ path: String) throws -> Int32 {
        try requireSocketPath(path)
        let parent = try UnixDomainSocketServer.openSecureRuntimeDirectory(URL(fileURLWithPath: path).deletingLastPathComponent())
        defer { Darwin.close(parent) }
        var info = stat()
        guard lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFSOCK,
              info.st_uid == geteuid(), info.st_mode & 0o777 == 0o600 else { throw failure() }
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw failure() }
        do {
            try configure(descriptor, socket: true)
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: Array(path.utf8) + [0]) }
            let result = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            if result != 0 {
                guard errno == EINPROGRESS else { throw failure() }
                try wait(descriptor, events: Int16(POLLOUT), deadline: deadline())
                var code: Int32 = 0, size = socklen_t(MemoryLayout<Int32>.size)
                guard getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &code, &size) == 0, code == 0 else { throw failure() }
            }
            var after = stat()
            guard lstat(path, &after) == 0, after.st_dev == info.st_dev, after.st_ino == info.st_ino else { throw failure() }
            return descriptor
        } catch { Darwin.close(descriptor); throw failure() }
    }
    static func configure(_ descriptor: Int32, socket: Bool) throws {
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0, fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0 else { throw failure() }
        if socket {
            var one: Int32 = 1
            guard setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size)) == 0 else { throw failure() }
        }
    }
    static func wait(_ descriptor: Int32, events: Int16, deadline: UInt64) throws {
        while true {
            let now = SystemCoordinatorContinuousClock().nowNanoseconds()
            guard now < deadline else { throw failure() }
            var item = pollfd(fd: descriptor, events: events, revents: 0)
            let milliseconds = Int32(min((deadline - now) / 1_000_000 + 1, 100))
            let result = poll(&item, 1, milliseconds)
            if result < 0 && errno == EINTR { continue }
            guard result >= 0 else { throw failure() }
            if result == 0 { continue }
            guard item.revents & events != 0 || item.revents & Int16(POLLHUP) != 0 else { throw failure() }
            return
        }
    }
    static func sendFrame(_ data: Data, descriptor: Int32, passing: Int32?, deadline: UInt64) throws {
        guard !data.isEmpty, data.count <= ClaudeProductWireCodec.maximumMessageBytes, !data.contains(10) else { throw failure() }
        let frame = data + Data([10])
        let aligned = (MemoryLayout<cmsghdr>.size + 3) & ~3
        var offset = 0, transferred = false
        while offset < frame.count {
            try wait(descriptor, events: Int16(POLLOUT), deadline: deadline)
            let rights = passing != nil && !transferred
            var controls = [UInt32](repeating: 0, count: (aligned + 4 + 3) / 4)
            let count = frame.withUnsafeBytes { bytes in
                controls.withUnsafeMutableBytes { control in
                    if rights {
                        control.storeBytes(of: cmsghdr(cmsg_len: socklen_t(aligned + 4), cmsg_level: SOL_SOCKET, cmsg_type: SCM_RIGHTS), as: cmsghdr.self)
                        control.storeBytes(of: passing!, toByteOffset: aligned, as: Int32.self)
                    }
                    var vector = iovec(iov_base: UnsafeMutableRawPointer(mutating: bytes.baseAddress!.advanced(by: offset)), iov_len: bytes.count - offset)
                    return withUnsafeMutablePointer(to: &vector) { pointer in
                        var header = msghdr()
                        header.msg_iov = pointer; header.msg_iovlen = 1
                        header.msg_control = rights ? control.baseAddress : nil
                        header.msg_controllen = rights ? socklen_t(aligned + 4) : 0
                        return Darwin.sendmsg(descriptor, &header, 0)
                    }
                }
            }
            if count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) { continue }
            guard count > 0 else { throw failure() }
            transferred = transferred || rights
            offset += count
        }
    }
    static func readFrame(_ descriptor: Int32, deadline: UInt64,
                          maximumBytes: Int = ClaudeProductWireCodec.maximumMessageBytes) throws -> Data {
        var result = Data()
        while result.count <= maximumBytes {
            try wait(descriptor, events: Int16(POLLIN), deadline: deadline)
            // XNU can externalize FDs that an undersized ancillary copyout
            // hides. Reject all rights in a non-consuming peek first. Limit the
            // following receive to those exact peeked bytes, under one reader.
            let available = try peekWithoutRights(descriptor)
            var bytes = [UInt8](repeating: 0, count: available)
            var controls = [UInt32](repeating: 0, count: 128)
            var header = msghdr()
            let count = bytes.withUnsafeMutableBytes { buffer in
                controls.withUnsafeMutableBytes { control in
                    var vector = iovec(iov_base: buffer.baseAddress, iov_len: buffer.count)
                    return withUnsafeMutablePointer(to: &vector) { pointer in
                        header.msg_iov = pointer; header.msg_iovlen = 1
                        header.msg_control = control.baseAddress; header.msg_controllen = socklen_t(control.count)
                        return Darwin.recvmsg(descriptor, &header, 0)
                    }
                }
            }
            if count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) { continue }
            var extraRights = false
            controls.withUnsafeBytes { control in
                let end = min(Int(header.msg_controllen), control.count)
                var offset = 0
                while offset + MemoryLayout<cmsghdr>.size <= end {
                    extraRights = true
                    let item = control.loadUnaligned(fromByteOffset: offset, as: cmsghdr.self)
                    let aligned = (MemoryLayout<cmsghdr>.size + 3) & ~3
                    let length = Int(item.cmsg_len)
                    guard length >= aligned else { break }
                    if item.cmsg_level == SOL_SOCKET && item.cmsg_type == SCM_RIGHTS {
                        let stop = min(offset + length, end)
                        if stop >= offset + aligned + 4 {
                            for position in stride(from: offset + aligned, through: stop - 4, by: 4) {
                                Darwin.close(control.loadUnaligned(fromByteOffset: position, as: Int32.self))
                            }
                        }
                    }
                    offset += (length + 3) & ~3
                }
            }
            guard count > 0, !extraRights, header.msg_flags & (MSG_CTRUNC | MSG_TRUNC) == 0 else { throw failure() }
            let received = bytes.prefix(count)
            if let newline = received.firstIndex(of: 10) {
                guard newline == count - 1 else { throw failure() }
                result.append(contentsOf: received.prefix(newline))
                guard !result.isEmpty, result.count <= maximumBytes else { throw failure() }
                return result
            }
            result.append(contentsOf: received)
        }
        throw failure()
    }
    private static func peekWithoutRights(_ descriptor: Int32) throws -> Int {
        var bytes = [UInt8](repeating: 0, count: 4096)
        var controls = [UInt32](repeating: 0, count: 4)
        var header = msghdr()
        let count = bytes.withUnsafeMutableBytes { buffer in
            controls.withUnsafeMutableBytes { control in
                var vector = iovec(iov_base: buffer.baseAddress, iov_len: buffer.count)
                return withUnsafeMutablePointer(to: &vector) { pointer in
                    header.msg_iov = pointer; header.msg_iovlen = 1
                    header.msg_control = control.baseAddress; header.msg_controllen = socklen_t(control.count)
                    return Darwin.recvmsg(descriptor, &header, MSG_PEEK | MSG_DONTWAIT)
                }
            }
        }
        // Peek's zero-valued rights payload is not an owned descriptor. Never
        // close it; closing the rejected socket leaves disposal to the kernel.
        guard count > 0, header.msg_controllen == 0,
              header.msg_flags & (MSG_CTRUNC | MSG_TRUNC) == 0 else { throw failure() }
        return count
    }
    static func readPipe(_ descriptor: Int32, deadline: UInt64) throws -> Data {
        var result = Data()
        while result.count <= 16 * 1024 {
            try wait(descriptor, events: Int16(POLLIN), deadline: deadline)
            var bytes = [UInt8](repeating: 0, count: 4096)
            let count = bytes.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, $0.count) }
            if count < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) { continue }
            guard count >= 0 else { throw failure() }
            if count == 0 { guard !result.isEmpty else { throw failure() }; return result }
            result.append(contentsOf: bytes.prefix(count))
        }
        throw failure()
    }
    private static func failure() -> CoordinatorError { ClaudeInstalledLaunchConfiguration.failure("owner_transport_unavailable") }
}
