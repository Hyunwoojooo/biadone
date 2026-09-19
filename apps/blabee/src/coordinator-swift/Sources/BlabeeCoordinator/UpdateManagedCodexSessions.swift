import AppKit
import CoordinatorSwift
import Darwin
import Foundation

enum UpdateManagedCodexPath {
    /// Foundation's standardizedFileURL can turn the physical /private/tmp
    /// back into /tmp. Codex's Rust cwd is physical, so compare POSIX realpaths.
    static func canonicalDirectory(_ path: String) throws -> String {
        guard path.hasPrefix("/"), UpdateManagedCodexArguments.safeText(path),
              let resolved = realpath(path, nil) else {
            throw CoordinatorError("update_managed_cwd_unavailable")
        }
        defer { free(resolved) }
        var info = stat()
        guard stat(resolved, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else {
            throw CoordinatorError("update_managed_cwd_unavailable")
        }
        return String(cString: resolved)
    }
}

/// Arguments deliberately cannot carry prompts, --last, --continue, arbitrary
/// commands, remote addresses, config overrides, or shell fragments.
struct UpdateManagedCodexArguments: Equatable {
    var cwd: String
    var resumeThreadID: String?
    var codexPath: String?

    init(_ arguments: [String], currentDirectory: String = FileManager.default.currentDirectoryPath) throws {
        cwd = currentDirectory
        var seen: Set<String> = []
        var index = 0
        while index < arguments.count {
            let key = arguments[index]
            guard ["--cwd", "--resume", "--codex"].contains(key), seen.insert(key).inserted,
                  index + 1 < arguments.count else { throw CoordinatorError("update_managed_arguments_invalid") }
            let value = arguments[index + 1]
            guard Self.safeText(value) else { throw CoordinatorError("update_managed_arguments_invalid") }
            switch key {
            case "--cwd": cwd = value
            case "--codex": codexPath = value
            case "--resume":
                guard let id = UUID(uuidString: value) else { throw CoordinatorError("update_managed_resume_id_invalid") }
                resumeThreadID = id.uuidString.lowercased()
            default: break
            }
            index += 2
        }
        guard cwd.hasPrefix("/"), codexPath == nil || codexPath!.hasPrefix("/"), Self.safeText(cwd) else {
            throw CoordinatorError("update_managed_arguments_invalid")
        }
        cwd = try UpdateManagedCodexPath.canonicalDirectory(cwd)
    }

    static func safeText(_ text: String) -> Bool {
        !text.isEmpty && text.utf8.count <= 4096
            && !text.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

    static func shellQuote(_ argument: String) throws -> String {
        guard safeText(argument) else { throw CoordinatorError("update_managed_command_unsafe") }
        return "'" + argument.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func terminalScript(executable: String, sessionID: String, claim: String? = nil) throws -> String {
        guard executable.hasPrefix("/"), UUID(uuidString: sessionID) != nil,
              claim == nil || UUID(uuidString: claim!) != nil else {
            throw CoordinatorError("update_managed_command_unsafe")
        }
        let argv = [executable, "managed-session-host", "--session", sessionID]
            + (claim.map { ["--claim", $0] } ?? [])
        return "#!/bin/sh\nexec " + (try argv.map(shellQuote).joined(separator: " ")) + "\n"
    }
}

struct UpdateManagedCodexSessions: Sendable {
    let registry: UpdateManagedCodexRegistry
    static func live() -> Self { Self(registry: UpdateManagedCodexRegistry()) }

    func sessions() async throws -> [UpdateManagedSession] {
        try await Task.detached { try self.currentSessions() }.value
    }

    private func currentSessions() throws -> [UpdateManagedSession] {
        try registry.records().map { record in
            do {
                return try UpdateManagedCodexControlClient().request(record, action: .status).session
            } catch {
                var session = record.session
                if record.session.state == .paused {
                    // Retain the durable pause receipt, but it cannot authorize a PID.
                    session.detail = "원래 터미널 연결을 확인할 수 없습니다. 복원 시 정확한 세션 ID로 Terminal 창을 엽니다."
                } else {
                    session.state = .failed
                    session.detail = "관리 세션 연결을 확인하지 못했습니다. 기존 터미널을 확인하세요."
                }
                return session
            }
        }
    }

    func pause(_ session: UpdateManagedSession, transactionID: String) async throws {
        try await Task.detached {
            let record = try self.record(id: session.id)
            try Self.requireFrozenIdentity(session, record: record)
            let result = try UpdateManagedCodexControlClient().request(record, action: .pause, transactionID: transactionID)
            guard result.session.state == .paused, result.session.threadID == session.threadID,
                  result.session.cwd == session.cwd, result.session.threadID != nil,
                  result.transactionID == transactionID else {
                throw CoordinatorError("update_managed_pause_receipt_invalid")
            }
        }.value
    }

    func resume(_ session: UpdateManagedSession, transactionID: String) async throws {
        try await Task.detached {
            let record = try self.record(id: session.id)
            try Self.requireFrozenIdentity(session, record: record)
            guard record.transactionID == transactionID, let threadID = record.session.threadID,
                  UUID(uuidString: threadID) != nil else {
                throw CoordinatorError("update_managed_resume_receipt_invalid")
            }
            if try UpdateManagedCodexProcessIdentity.isAlive(pid: record.hostPID, startTime: record.hostStartTime) {
                let result = try UpdateManagedCodexControlClient().request(record, action: .resume, transactionID: transactionID)
                guard [.running, .busy].contains(result.session.state), result.session.threadID == threadID,
                      result.session.cwd == record.session.cwd else {
                    throw CoordinatorError("update_managed_resume_unconfirmed")
                }
                return
            }
            let claim = UUID().uuidString.lowercased()
            let claimed = try self.registry.claimRestoration(id: record.session.id,
                expectedIncarnation: record.incarnation, transactionID: transactionID, claimID: claim)
            try Self.openTerminal(record: claimed, claim: claim)
            let deadline = Date().addingTimeInterval(60)
            while Date() < deadline {
                let current = try self.record(id: session.id)
                if current.restorationClaim == claim,
                   [.running, .busy].contains(current.session.state),
                   current.session.threadID == threadID, current.session.cwd == record.session.cwd,
                   current.incarnation != record.incarnation {
                    let verified = try UpdateManagedCodexControlClient().request(current, action: .status)
                    guard verified.session.threadID == threadID,
                          [.running, .busy].contains(verified.session.state) else {
                        throw CoordinatorError("update_managed_resume_unconfirmed")
                    }
                    return
                }
                if current.session.state == .failed { throw CoordinatorError("update_managed_resume_failed") }
                try await Task.sleep(for: .milliseconds(100))
            }
            // The durable claim intentionally survives. Never open a second window
            // just because the first window's acknowledgement was delayed/lost.
            throw CoordinatorError("update_managed_resume_unconfirmed")
        }.value
    }

    func openSession(cwd: URL, resumeThreadID: String?) async throws {
        try await Task.detached {
            let arguments = try UpdateManagedCodexArguments(["--cwd", cwd.path]
                + (resumeThreadID.map { ["--resume", $0] } ?? []))
            let record = try self.prepare(arguments)
            try Self.openTerminal(record: record)
        }.value
    }

    fileprivate func prepare(_ arguments: UpdateManagedCodexArguments) throws -> UpdateManagedCodexRecord {
        let native = CodexNativeRuntime.live(explicitExecutableURL: arguments.codexPath.map(URL.init(fileURLWithPath:)))
        let executable = try native.qualify(timeoutMilliseconds: 15_000)
        try UpdateManagedCodexProfile.requireSupported(executable.version)
        _ = try registry.records() // Creates/validates the private parent without following symlinks.
        let id = UUID().uuidString.lowercased()
        let runtimes = try registry.prepareRuntimesDirectory()
        let parent = runtimes.appendingPathComponent(id, isDirectory: true)
        guard mkdir(parent.path, 0o700) == 0 else { throw CoordinatorError("update_managed_runtime_directory_failed") }
        let app = try AppUpdateRuntimeCopy.prepareCurrent(in: parent)
        let record = UpdateManagedCodexRecord(
            session: UpdateManagedSession(id: id, threadID: arguments.resumeThreadID, cwd: arguments.cwd,
                                          state: .starting, detail: nil),
            nonce: UUID().uuidString + UUID().uuidString, hostPID: 0, hostStartTime: 0,
            incarnation: UUID().uuidString.lowercased(),
            socketPath: try UpdateManagedCodexControlServer.makeSocketPath(),
            codexPath: executable.sourceURL.path,
            terminal: ProcessInfo.processInfo.environment["TERM_PROGRAM"],
            transactionID: nil, runtimeAppPath: app.path, restorationClaim: nil,
            codexHome: URL(fileURLWithPath: ProcessInfo.processInfo.environment["CODEX_HOME"]
                ?? NSHomeDirectory() + "/.codex").resolvingSymlinksInPath().standardizedFileURL.path
        )
        try registry.save(record)
        return record
    }

    static func requireFrozenIdentity(_ session: UpdateManagedSession, record: UpdateManagedCodexRecord) throws {
        guard let threadID = session.threadID, UUID(uuidString: threadID) != nil,
              record.session.id == session.id, record.session.threadID == threadID,
              record.session.cwd == session.cwd else {
            throw CoordinatorError("update_managed_frozen_session_changed")
        }
    }

    fileprivate func record(id: String) throws -> UpdateManagedCodexRecord {
        guard UUID(uuidString: id) != nil,
              let record = try registry.records().first(where: { $0.session.id == id }) else {
            throw CoordinatorError("update_managed_session_unknown")
        }
        return record
    }

    fileprivate static func executable(_ record: UpdateManagedCodexRecord) -> String {
        URL(fileURLWithPath: record.runtimeAppPath).appendingPathComponent("Contents/MacOS/blabee-coordinator").path
    }

    fileprivate static func openTerminal(record: UpdateManagedCodexRecord, claim: String? = nil) throws {
        let executable = executable(record)
        let script = try UpdateManagedCodexArguments.terminalScript(executable: executable,
            sessionID: record.session.id, claim: claim)
        let scriptURL = URL(fileURLWithPath: record.runtimeAppPath).deletingLastPathComponent()
            .appendingPathComponent("session-\(claim ?? record.session.id).command")
        let descriptor = Darwin.open(scriptURL.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o700)
        guard descriptor >= 0 else { throw CoordinatorError("update_managed_terminal_command_exists") }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        try handle.write(contentsOf: Data(script.utf8))
        guard fsync(descriptor) == 0 else { throw CoordinatorError("update_managed_terminal_command_failed") }
        try handle.close()
        try UpdateManagedCodexTerminal.open(commandURL: scriptURL)
    }
}

enum UpdateManagedCodexCommand {
    static func run(arguments: [String]) throws -> Int32 {
        guard let mode = arguments.first else { throw CoordinatorError("update_managed_arguments_invalid") }
        switch mode {
        case "managed-session":
            guard isatty(STDIN_FILENO) == 1 else { throw CoordinatorError("update_managed_terminal_unavailable") }
            let record = try UpdateManagedCodexSessions.live().prepare(UpdateManagedCodexArguments(Array(arguments.dropFirst())))
            let executable = UpdateManagedCodexSessions.executable(record)
            let arguments = [executable, "managed-session-host", "--session", record.session.id]
            let strings = arguments.map { strdup($0) }
            defer { strings.forEach { free($0) } }
            var pointers = strings + [nil]
            pointers.withUnsafeMutableBufferPointer { _ = execv(executable, $0.baseAddress!) }
            throw CoordinatorError("update_managed_host_exec_failed")
        case "managed-session-host":
            let tail = Array(arguments.dropFirst())
            guard tail.count == 2 || tail.count == 4, tail[0] == "--session",
                  UUID(uuidString: tail[1]) != nil,
                  tail.count == 2 || (tail[2] == "--claim" && UUID(uuidString: tail[3]) != nil) else {
                throw CoordinatorError("update_managed_arguments_invalid")
            }
            let host = try UpdateManagedCodexHost(sessionID: tail[1], claim: tail.count == 4 ? tail[3] : nil)
            return try host.run()
        default: throw CoordinatorError("update_managed_arguments_invalid")
        }
    }
}
