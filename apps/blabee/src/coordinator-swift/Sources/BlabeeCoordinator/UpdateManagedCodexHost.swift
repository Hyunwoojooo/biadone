import CoordinatorSwift
import Darwin
import Foundation

/// Lives in the original terminal in a separately signed app copy. A paused
/// supervisor owns no Codex child, but keeps its tty so resume needs no tab input.
final class UpdateManagedCodexHost: @unchecked Sendable {
    private let registry = UpdateManagedCodexRegistry()
    private let recordLock = NSLock()
    private let operationLock = NSLock()
    private var record: UpdateManagedCodexRecord
    private var runtime: UpdateManagedCodexRuntime?
    private var control: UpdateManagedCodexControlServer?
    private var transitioning = true
    private var hostFailure = false
    private let isRestoration: Bool

    init(sessionID: String, claim: String?) throws {
        let sessions = UpdateManagedCodexSessions.live()
        guard let stored = try sessions.registry.records().first(where: { $0.session.id == sessionID }),
              let executable = Bundle.main.executableURL,
              executable.resolvingSymlinksInPath().path
                == URL(fileURLWithPath: stored.runtimeAppPath)
                    .appendingPathComponent("Contents/MacOS/blabee-coordinator").path,
              OperationalRuntimeIdentity.resolveSnapshot(executableURL: executable) != nil,
              !stored.runtimeAppPath.hasPrefix("/Applications/"),
              isatty(STDIN_FILENO) == 1 else {
            throw CoordinatorError("update_managed_host_identity_invalid")
        }
        if let claim {
            guard stored.session.state == .resuming, stored.restorationClaim == claim,
                  stored.session.threadID != nil, stored.transactionID != nil,
                  try !UpdateManagedCodexProcessIdentity.isAlive(pid: stored.hostPID, startTime: stored.hostStartTime)
            else { throw CoordinatorError("update_managed_restoration_claim_invalid") }
        } else {
            guard stored.session.state == .starting, stored.hostPID == 0,
                  stored.hostStartTime == 0, stored.restorationClaim == nil else {
                throw CoordinatorError("update_managed_host_already_started")
            }
        }
        isRestoration = claim != nil
        record = stored
        record.hostPID = getpid()
        record.hostStartTime = try UpdateManagedCodexProcessIdentity.startTime(pid: getpid())
        record.incarnation = UUID().uuidString.lowercased()
        record.nonce = UUID().uuidString + UUID().uuidString
        record.socketPath = try UpdateManagedCodexControlServer.makeSocketPath()
        // Incarnation CAS also prevents two Terminal windows executing the same
        // .command from creating two writable hosts.
        try registry.save(record, expectedIncarnation: stored.incarnation)
    }

    func run() throws -> Int32 {
        control = try UpdateManagedCodexControlServer(record: record) { [weak self] action, transactionID, expectedSession in
            guard let self else { throw CoordinatorError("update_managed_host_unavailable") }
            return try self.handle(action, transactionID: transactionID, expectedSession: expectedSession)
        }
        try control?.start()
        do {
            try startRuntime(requireIdentity: isRestoration)
        } catch {
            try? recordFailure("update_managed_start_failed")
            control?.stop()
            throw error
        }
        // Keep the copied supervisor alive while paused, even though its TUI is
        // gone. The updater authenticates this incarnation, never a PID alone.
        while true {
            recordLock.lock()
            let state = record.session.state
            let activeRuntime = runtime
            let inTransition = transitioning
            recordLock.unlock()
            if !inTransition, ![.paused, .pausing, .resuming].contains(state),
               activeRuntime?.isTUIRunning != true { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        let terminalExitConfirmed = runtime?.terminalEnded() == true
        control?.stop()
        if terminalExitConfirmed {
            try registry.remove(id: record.session.id, expectedIncarnation: record.incarnation)
        } else {
            try? recordFailure("update_managed_terminal_ended_unconfirmed")
        }
        return 0
    }

    private func handle(_ action: UpdateManagedCodexControlAction,
                        transactionID: String?, expectedSession: UpdateManagedSession) throws -> UpdateManagedCodexRecord {
        if action == .status { return try status() }
        guard let transactionID, UUID(uuidString: transactionID) != nil else {
            throw CoordinatorError("update_managed_transaction_invalid")
        }
        operationLock.lock(); defer { operationLock.unlock() }
        switch action {
        case .status: return try status()
        case .pause:
            let current = try status()
            try UpdateManagedCodexSessions.requireFrozenIdentity(expectedSession, record: current)
            if current.session.state == .paused, current.transactionID == transactionID { return current }
            guard current.session.state == .running, let runtime else {
                throw CoordinatorError("update_managed_session_busy_or_unconfirmed")
            }
            try transition(.pausing, transactionID: transactionID)
            do {
                try runtime.pause(expectedThreadID: expectedSession.threadID!, expectedCWD: expectedSession.cwd)
                let snapshot = runtime.snapshot
                guard snapshot.state == .paused, let threadID = snapshot.threadID,
                      let cwd = snapshot.cwd else { throw CoordinatorError("update_managed_pause_unconfirmed") }
                recordLock.lock()
                record.session.threadID = threadID
                record.session.cwd = cwd
                record.session.state = .paused
                record.session.detail = nil
                record.restorationClaim = nil
                transitioning = false
                let saved = record
                recordLock.unlock()
                try registry.save(saved, expectedIncarnation: saved.incarnation)
                return saved
            } catch {
                try? recordFailure("update_managed_pause_unconfirmed")
                throw error
            }
        case .resume:
            let current = try status()
            try UpdateManagedCodexSessions.requireFrozenIdentity(expectedSession, record: current)
            if [.running, .busy].contains(current.session.state), current.transactionID == transactionID {
                return current // Only an already observed exact writable identity gets this ACK.
            }
            guard current.session.state == .paused, current.transactionID == transactionID,
                  current.session.threadID != nil else {
                throw CoordinatorError("update_managed_resume_receipt_invalid")
            }
            // Durable resuming is written before Process.run; a timeout never
            // automatically starts a second writer in another terminal.
            try transition(.resuming, transactionID: transactionID)
            do {
                try startRuntime(requireIdentity: true)
                return try status()
            } catch {
                try? recordFailure("update_managed_resume_unconfirmed")
                throw error
            }
        }
    }

    private func startRuntime(requireIdentity: Bool) throws {
        recordLock.lock()
        let starting = record
        recordLock.unlock()
        var environment = ProcessInfo.processInfo.environment
        if let home = starting.codexHome { environment["CODEX_HOME"] = home }
        let native = CodexNativeRuntime.live(explicitExecutableURL: URL(fileURLWithPath: starting.codexPath),
                                             environment: environment)
        let selection = try native.qualify(timeoutMilliseconds: 15_000)
        try UpdateManagedCodexProfile.requireSupported(selection.version)
        let child = UpdateManagedCodexRuntime(cwd: starting.session.cwd,
            resumeThreadID: starting.session.threadID) { [weak self] in self?.publishRuntimeState() }
        recordLock.lock()
        runtime = child
        recordLock.unlock()
        try child.start(executable: selection, native: native, environment: environment)
        if requireIdentity { try child.waitForIdentity() }
        recordLock.lock()
        transitioning = false
        recordLock.unlock()
        publishRuntimeState()
    }

    private func status() throws -> UpdateManagedCodexRecord {
        publishRuntimeState()
        recordLock.lock(); defer { recordLock.unlock() }
        return record
    }

    private func publishRuntimeState() {
        recordLock.lock()
        guard !transitioning, !hostFailure, let runtime else { recordLock.unlock(); return }
        let snapshot = runtime.snapshot
        var updated = record
        updated.session.state = snapshot.state
        updated.session.detail = snapshot.detail
        if let threadID = snapshot.threadID, let cwd = snapshot.cwd {
            updated.session.threadID = threadID
            updated.session.cwd = cwd
        }
        guard updated != record else { recordLock.unlock(); return }
        do {
            try registry.save(updated, expectedIncarnation: record.incarnation)
            record = updated
        } catch {
            // In-memory failure prevents a pause ACK even when disk state could
            // not be saved. Never silently continue with stale ownership.
            record.session.state = .failed
            record.session.detail = "update_managed_registry_write_failed"
            hostFailure = true
            transitioning = false
        }
        recordLock.unlock()
    }

    private func transition(_ state: UpdateManagedSessionState, transactionID: String) throws {
        recordLock.lock(); defer { recordLock.unlock() }
        var updated = record
        updated.session.state = state
        updated.transactionID = transactionID
        updated.session.detail = nil
        try registry.save(updated, expectedIncarnation: record.incarnation)
        record = updated
        transitioning = true
    }

    private func recordFailure(_ code: String) throws {
        recordLock.lock(); defer { recordLock.unlock() }
        record.session.state = .failed
        record.session.detail = code
        hostFailure = true
        transitioning = false
        try registry.save(record, expectedIncarnation: record.incarnation)
    }
}
