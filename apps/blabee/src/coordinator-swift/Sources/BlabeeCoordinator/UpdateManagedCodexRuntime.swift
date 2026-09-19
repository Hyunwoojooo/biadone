import CoordinatorSwift
import Darwin
import Foundation

/// One exclusive native app-server and its remote TUI. Approval requests are
/// forwarded byte-for-byte; this bridge never supplies a decision or a prompt.
final class UpdateManagedCodexRuntime: @unchecked Sendable {
    private let condition = NSCondition()
    private var observer: UpdateManagedCodexObserver
    private let appServer = Process()
    private let tui = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let diagnostics = Pipe()
    private var writer: ManagedCodexJSONLineWriter?
    private var reader: ManagedCodexJSONLineReader?
    private var diagnosticReader: ManagedCodexJSONLineReader?
    private var listener: ManagedCodexWebSocketListener?
    private var connection: ManagedCodexWebSocketConnection?
    private var terminalLease: ManagedCodexTerminalForegroundLease?
    private var originalTerminal = termios()
    private var savedTerminal = false
    private var started = false
    private var paused = false
    private var codexHome: String?
    private let changed: @Sendable () -> Void

    init(cwd: String, resumeThreadID: String?, changed: @escaping @Sendable () -> Void = {}) {
        observer = UpdateManagedCodexObserver(expectedResumeID: resumeThreadID, expectedCWD: cwd)
        self.changed = changed
    }

    var snapshot: (threadID: String?, cwd: String?, state: UpdateManagedSessionState, detail: String?) {
        condition.lock(); defer { condition.unlock() }
        if let failure = observer.failure { return (observer.rootThreadID, observer.rootCWD, .failed, failure) }
        var state: UpdateManagedSessionState = paused ? .paused
            : observer.frozen ? .pausing : observer.rootThreadID == nil ? .starting
            : observer.busy ? .busy : .running
        var detail: String?
        if state == .running, !hasDurableRoot() {
            state = .busy
            detail = "아직 저장된 대화 기록이 없습니다. 이 세션을 계속 사용하거나 직접 닫은 뒤 업데이트하세요."
        }
        return (observer.rootThreadID, observer.rootCWD, state, detail)
    }

    var isTUIRunning: Bool { tui.isRunning }

    func start(executable selection: CodexPluginSetupQualifiedExecutable,
               native: CodexNativeRuntime,
               environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        try UpdateManagedCodexProfile.requireSupported(selection.version)
        guard isatty(STDIN_FILENO) == 1, tcgetattr(STDIN_FILENO, &originalTerminal) == 0 else {
            throw CoordinatorError("update_managed_terminal_unavailable")
        }
        savedTerminal = true
        codexHome = environment["CODEX_HOME"] ?? NSHomeDirectory() + "/.codex"
        let executable = try native.revalidator(selection)
        try native.preflight(executable, 5_000)
        guard try native.revalidator(selection) == executable else {
            throw CodexNativeDiagnostic.binaryChanged.error
        }
        let token = UUID().uuidString + UUID().uuidString
        let listener = try ManagedCodexWebSocketListener(expectedToken: token)
        self.listener = listener
        var serverEnvironment = environment.filter { !$0.key.hasPrefix("BLABEE_MANAGED_") }
        serverEnvironment["RUST_LOG"] = "warn"
        serverEnvironment["LOG_FORMAT"] = "json"
        appServer.executableURL = executable
        appServer.arguments = ["-c", "thread_unload_delay_secs=0", "app-server", "--listen", "stdio://"]
        appServer.currentDirectoryURL = URL(fileURLWithPath: observer.expectedCWD)
        appServer.environment = serverEnvironment
        appServer.standardInput = input
        appServer.standardOutput = output
        appServer.standardError = diagnostics
        appServer.terminationHandler = { [weak self] process in
            guard let self else { return }
            self.condition.lock()
            self.observer.didExitServer(process.terminationReason == .exit ? process.terminationStatus : -1)
            self.condition.broadcast()
            self.condition.unlock()
            self.changed()
        }
        writer = try ManagedCodexJSONLineWriter(input.fileHandleForWriting)
        reader = ManagedCodexJSONLineReader(output.fileHandleForReading)
        diagnosticReader = ManagedCodexJSONLineReader(diagnostics.fileHandleForReading)
        try appServer.run()
        started = true
        try? input.fileHandleForReading.close()
        try? output.fileHandleForWriting.close()
        try? diagnostics.fileHandleForWriting.close()
        drainServer()
        drainDiagnostics()
        do {
            guard try native.revalidator(selection) == executable else {
                throw CodexNativeDiagnostic.binaryChanged.error
            }
            var tuiEnvironment = environment.filter { !$0.key.hasPrefix("BLABEE_MANAGED_") }
            tuiEnvironment["BLABEE_UPDATE_REMOTE_TOKEN"] = token
            tui.executableURL = executable
            tui.currentDirectoryURL = URL(fileURLWithPath: observer.expectedCWD)
            tui.arguments = ["--remote", "ws://127.0.0.1:\(listener.port)",
                             "--remote-auth-token-env", "BLABEE_UPDATE_REMOTE_TOKEN",
                             "--cd", observer.expectedCWD]
                + (observer.expectedResumeID.map { ["resume", $0] } ?? [])
            tui.environment = tuiEnvironment
            tui.standardInput = FileHandle.standardInput
            tui.standardOutput = FileHandle.standardOutput
            tui.standardError = FileHandle.standardError
            try tui.run()
            terminalLease = try ManagedCodexTerminalForegroundLease(tui: tui)
            let accepted = try listener.accept(timeoutMilliseconds: 15_000)
            condition.lock()
            connection = accepted
            condition.unlock()
            listener.close() // No auxiliary clients or external subscribers are admitted.
            drainClient(accepted)
        } catch {
            latch("update_managed_start_unconfirmed")
            // Closing stdin is safe before any TUI request was admitted. No TERM/KILL
            // is sent to app-server, even if startup or shutdown hangs.
            writer?.close()
            if tui.isRunning { tui.terminate() }
            restoreTerminal()
            throw error
        }
    }

    func waitForIdentity(timeout: TimeInterval = 15) throws {
        try wait(timeout: timeout) {
            self.observer.rootThreadID != nil && self.observer.rootCWD == self.observer.expectedCWD
        }
    }

    /// After admission is frozen, no signal may replace any persistence barrier.
    func pause(expectedThreadID: String, expectedCWD: String, timeout: TimeInterval = 40) throws {
        let pauseDeadline = DispatchTime.now().uptimeNanoseconds + UInt64(max(0, timeout) * 1_000_000_000)
        condition.lock()
        let requests: [[String: Any]]
        do {
            guard observer.rootThreadID == expectedThreadID, observer.rootCWD == expectedCWD else {
                throw CoordinatorError("update_managed_frozen_session_changed")
            }
            guard let codexHome else { throw CoordinatorError("update_managed_root_not_persisted") }
            try UpdateManagedCodexPersistence.requireRoot(threadID: observer.rootThreadID,
                rolloutPath: observer.rootRolloutPath, codexHome: codexHome)
            requests = try observer.beginPause()
            for request in requests {
                guard DispatchTime.now().uptimeNanoseconds < pauseDeadline else { throw CoordinatorError("update_managed_pause_timeout") }
                try writer?.write(JSONSerialization.data(withJSONObject: request, options: [.sortedKeys]))
            }
        } catch {
            if observer.frozen { observer.fail("update_managed_pause_write_failed") }
            condition.unlock()
            throw error
        }
        condition.unlock()
        changed()
        do {
            try wait(timeout: Self.remaining(pauseDeadline)) { self.observer.allThreadsClosed }
            writer?.close()
            try wait(timeout: Self.remaining(pauseDeadline)) { self.observer.persistenceBarrierComplete }
            condition.lock()
            let persistedThreadID = observer.rootThreadID
            let persistedPath = observer.rootRolloutPath
            condition.unlock()
            try UpdateManagedCodexPersistence.requireRoot(threadID: persistedThreadID,
                rolloutPath: persistedPath, codexHome: codexHome ?? "")
            // Only this exact Process object is stopped, and only after complete
            // app-server persistence plus exit and both pipe EOF observations.
            if tui.isRunning { tui.terminate() }
            let tuiDeadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
            while tui.isRunning && DispatchTime.now().uptimeNanoseconds < tuiDeadline { Thread.sleep(forTimeInterval: 0.02) }
            guard !tui.isRunning else { throw CoordinatorError("update_managed_tui_exit_unconfirmed") }
            connection?.close()
            restoreTerminal()
            condition.lock()
            paused = true
            condition.unlock()
            changed()
        } catch {
            latch("update_managed_pause_unconfirmed")
            // Preserve the live process/terminal; the updater must refuse replacement.
            throw error
        }
    }

    /// User-initiated terminal exit, not an update success. Never claims a flush.
    @discardableResult
    func terminalEnded() -> Bool {
        connection?.close()
        writer?.close()
        listener?.close()
        restoreTerminal()
        // The user has already closed the TUI. Confirm only that the exact owned
        // processes/pipes are gone before retiring its registry entry. This is
        // deliberately not an update pause/persistence receipt and never permits
        // an automatic resume of a session the user chose to close.
        let deadline = DispatchTime.now().uptimeNanoseconds + 15_000_000_000
        condition.lock(); defer { condition.unlock() }
        while observer.serverExit == nil || !observer.stdoutEOF || !observer.stderrEOF {
            let remaining = Self.remaining(deadline)
            guard remaining > 0 else { return false }
            _ = condition.wait(until: Date().addingTimeInterval(min(0.1, remaining)))
        }
        return observer.serverExit == 0 && !tui.isRunning
    }

    private func wait(timeout: TimeInterval, until predicate: () -> Bool) throws {
        let deadline = DispatchTime.now().uptimeNanoseconds + UInt64(max(0, timeout) * 1_000_000_000)
        condition.lock(); defer { condition.unlock() }
        while !predicate() {
            if let failure = observer.failure { throw CoordinatorError(failure) }
            let remaining = Self.remaining(deadline)
            guard remaining > 0 else { throw CoordinatorError("update_managed_pause_timeout") }
            _ = condition.wait(until: Date().addingTimeInterval(min(0.1, remaining)))
        }
        if let failure = observer.failure { throw CoordinatorError(failure) }
    }

    private static func remaining(_ deadline: UInt64) -> TimeInterval {
        let now = DispatchTime.now().uptimeNanoseconds
        return now < deadline ? Double(deadline - now) / 1_000_000_000 : 0
    }

    /// Caller holds condition. Metadata inspection does not read conversation text.
    private func hasDurableRoot() -> Bool {
        guard let codexHome else { return false }
        do {
            try UpdateManagedCodexPersistence.requireRoot(threadID: observer.rootThreadID,
                rolloutPath: observer.rootRolloutPath, codexHome: codexHome)
            return true
        } catch { return false }
    }

    private func drainClient(_ connection: ManagedCodexWebSocketConnection) {
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                try connection.readMessages { data in
                    let object = try UpdateManagedCodexObserver.object(data)
                    condition.lock()
                    if observer.frozen {
                        condition.unlock()
                        if let id = object["id"], object["method"] != nil {
                            let response: [String: Any] = ["id": id, "error": ["code": -32000,
                                "message": "Blabee update is pausing this session; input was not submitted."]]
                            try connection.sendText(JSONSerialization.data(withJSONObject: response))
                        }
                        return
                    }
                    do {
                        try observer.admitClient(object)
                        try writer?.write(data)
                    } catch {
                        observer.fail("update_managed_client_protocol_failed")
                        condition.broadcast()
                        condition.unlock()
                        throw error
                    }
                    condition.broadcast()
                    condition.unlock()
                    changed()
                }
                condition.lock()
                let unexpected = !observer.frozen
                condition.unlock()
                if unexpected { latch("update_managed_terminal_connection_closed") }
            } catch {
                condition.lock()
                let unexpected = !observer.frozen
                condition.unlock()
                if unexpected { latch("update_managed_terminal_connection_failed") }
            }
        }
    }

    private func drainServer() {
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                try reader?.readLines { data in
                    let object = try UpdateManagedCodexObserver.object(data)
                    condition.lock()
                    let internalResponse: Bool
                    do { internalResponse = try observer.observeServer(object) }
                    catch {
                        observer.fail("update_managed_server_protocol_failed")
                        condition.broadcast(); condition.unlock(); throw error
                    }
                    let current = connection
                    let freezing = observer.frozen
                    condition.broadcast()
                    condition.unlock()
                    if !internalResponse {
                        do { try current?.sendText(data) }
                        catch { if !freezing { throw error } }
                    }
                    changed()
                }
                condition.lock()
                observer.didReachStdoutEOF()
                if !observer.frozen { observer.fail("update_managed_server_stdout_closed") }
                condition.broadcast(); condition.unlock()
                changed()
            } catch { latch("update_managed_server_pipe_failed") }
        }
    }

    private func drainDiagnostics() {
        DispatchQueue.global(qos: .utility).async { [self] in
            do {
                try diagnosticReader?.readLines { data in
                    condition.lock()
                    do { try observer.observeDiagnostic(data) }
                    catch { observer.fail("update_managed_diagnostics_invalid") }
                    // Keep draining after a diagnostic error; never let a full
                    // stderr pipe prevent the owned server from finishing.
                    condition.broadcast(); condition.unlock()
                    changed()
                }
                condition.lock()
                observer.didReachStderrEOF()
                condition.broadcast(); condition.unlock()
                changed()
            } catch { latch("update_managed_diagnostics_pipe_failed") }
        }
    }

    private func latch(_ code: String) {
        condition.lock()
        observer.fail(code)
        condition.broadcast()
        condition.unlock()
        changed()
    }

    private func restoreTerminal() {
        terminalLease?.restoreIgnoringErrors()
        if savedTerminal { _ = tcsetattr(STDIN_FILENO, TCSANOW, &originalTerminal) }
    }
}
