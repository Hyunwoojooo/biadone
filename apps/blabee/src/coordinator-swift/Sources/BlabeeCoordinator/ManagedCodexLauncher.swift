import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Security

typealias ManagedCodexExecutableProvider = @Sendable () throws -> URL

struct ManagedCodexLauncherArguments: Equatable {
    let explicitCodexURL: URL?
    let coordinatorSocketPath: String
    let tuiArguments: [String]

    init(
        _ values: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws {
        var explicitCodexURL: URL?
        var coordinatorSocketPath: String?
        var index = 0
        var separatorFound = false
        while index < values.count {
            let value = values[index]
            if value == "--" {
                separatorFound = true
                index += 1
                break
            }
            guard index + 1 < values.count, !values[index + 1].isEmpty else {
                throw CoordinatorError("managed_codex_arguments_invalid")
            }
            let argument = values[index + 1]
            switch value {
            case "--codex":
                guard explicitCodexURL == nil, argument.hasPrefix("/") else {
                    throw CoordinatorError("managed_codex_arguments_invalid")
                }
                explicitCodexURL = URL(fileURLWithPath: argument, isDirectory: false)
            case "--coordinator-socket":
                guard coordinatorSocketPath == nil else {
                    throw CoordinatorError("managed_codex_arguments_invalid")
                }
                coordinatorSocketPath = argument
            default:
                throw CoordinatorError("managed_codex_arguments_invalid")
            }
            index += 2
        }
        guard separatorFound else {
            throw CoordinatorError(
                "managed_codex_arguments_invalid",
                "managed-codex requires -- before Codex TUI arguments"
            )
        }
        let tuiArguments = Array(values[index...])
        guard !tuiArguments.contains(where: Self.isReservedRemoteArgument) else {
            throw CoordinatorError(
                "managed_codex_arguments_invalid",
                "managed-codex owns the Codex remote transport arguments"
            )
        }
        self.explicitCodexURL = explicitCodexURL
        self.coordinatorSocketPath = try OperationalSocketPath.resolve(
            explicitPath: coordinatorSocketPath,
            environment: environment
        )
        self.tuiArguments = tuiArguments
    }

    private static func isReservedRemoteArgument(_ value: String) -> Bool {
        value == "--remote"
            || value.hasPrefix("--remote=")
            || value == "--remote-auth-token-env"
            || value.hasPrefix("--remote-auth-token-env=")
    }
}

private final class ManagedCodexErrorBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Error?

    func record(_ error: Error) {
        lock.lock()
        defer { lock.unlock() }
        if stored == nil { stored = error }
    }

    var error: Error? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

private final class ManagedCodexChildProcesses: @unchecked Sendable {
    let appServer: Process
    let tui: Process
    private let lock = NSLock()

    init(appServer: Process, tui: Process) {
        self.appServer = appServer
        self.tui = tui
    }

    func terminateAll() {
        lock.lock()
        defer { lock.unlock() }
        managedCodexTerminateProcess(tui)
        managedCodexTerminateProcess(appServer)
    }

    func finish(graceMilliseconds: Int) -> Int32 {
        lock.lock()
        defer { lock.unlock() }
        let now = DispatchTime.now().uptimeNanoseconds
        let duration = UInt64(max(0, graceMilliseconds)) * 1_000_000
        let (deadline, overflow) = now.addingReportingOverflow(duration)
        while tui.isRunning,
              !overflow,
              DispatchTime.now().uptimeNanoseconds < deadline
        {
            usleep(20_000)
        }
        if tui.isRunning { _ = managedCodexTerminateProcess(tui) }
        else { tui.waitUntilExit() }
        let appServerTerminatedByBroker = managedCodexTerminateProcess(appServer)
        return managedCodexResolvedExitStatus(
            tuiStatus: tui.terminationStatus,
            appServerStatus: appServer.terminationStatus,
            appServerTerminatedByBroker: appServerTerminatedByBroker
        )
    }
}

private final class ManagedCodexSignalRelay: @unchecked Sendable {
    private let sources: [DispatchSourceSignal]

    init(children: ManagedCodexChildProcesses) {
        var retained: [DispatchSourceSignal] = []
        for signalNumber in [SIGINT, SIGTERM] {
            // Children are already running and retain the terminal's default
            // signal disposition. Only this broker parent switches to dispatch
            // delivery so it can reap those exact child processes.
            signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(
                signal: signalNumber,
                queue: DispatchQueue.global(qos: .userInitiated)
            )
            source.setEventHandler {
                children.terminateAll()
                _exit(128 + signalNumber)
            }
            source.resume()
            retained.append(source)
        }
        sources = retained
    }

    deinit {
        for source in sources { source.cancel() }
        signal(SIGINT, SIG_DFL)
        signal(SIGTERM, SIG_DFL)
    }

    func retainUntilScopeExit() {}
}

private final class ManagedCodexTerminalForegroundLease: @unchecked Sendable {
    private let descriptor: Int32
    private let originalProcessGroup: pid_t
    private let lock = NSLock()
    private var active = false

    init(tui: Process) throws {
        descriptor = STDIN_FILENO
        guard isatty(descriptor) == 1 else {
            throw CoordinatorError("managed_codex_terminal_unavailable")
        }
        let foregroundProcessGroup = tcgetpgrp(descriptor)
        guard foregroundProcessGroup > 0,
              foregroundProcessGroup == getpgrp()
        else {
            throw CoordinatorError("managed_codex_terminal_not_foreground")
        }
        originalProcessGroup = foregroundProcessGroup
        let tuiProcessGroup = getpgid(tui.processIdentifier)
        guard tuiProcessGroup > 0 else {
            throw CoordinatorError("managed_codex_tui_process_group_unavailable")
        }
        try Self.withSIGTTOUBlocked {
            guard tcsetpgrp(descriptor, tuiProcessGroup) == 0 else {
                throw CoordinatorError("managed_codex_terminal_handoff_failed")
            }
        }
        active = true
        if kill(tui.processIdentifier, SIGCONT) != 0, errno != ESRCH {
            try? restore()
            throw CoordinatorError("managed_codex_tui_resume_failed")
        }
    }

    func restore() throws {
        lock.lock()
        guard active else {
            lock.unlock()
            return
        }
        lock.unlock()
        try Self.withSIGTTOUBlocked {
            guard tcsetpgrp(descriptor, originalProcessGroup) == 0 else {
                throw CoordinatorError("managed_codex_terminal_restore_failed")
            }
        }
        lock.lock()
        active = false
        lock.unlock()
    }

    func restoreIgnoringErrors() {
        try? restore()
    }

    deinit { restoreIgnoringErrors() }

    private static func withSIGTTOUBlocked<T>(
        _ operation: () throws -> T
    ) throws -> T {
        var blockedSignals = sigset_t()
        var previousSignals = sigset_t()
        guard sigemptyset(&blockedSignals) == 0,
              sigaddset(&blockedSignals, SIGTTOU) == 0,
              pthread_sigmask(SIG_BLOCK, &blockedSignals, &previousSignals) == 0
        else {
            throw CoordinatorError("managed_codex_terminal_signal_mask_failed")
        }
        defer {
            _ = pthread_sigmask(SIG_SETMASK, &previousSignals, nil)
        }
        return try operation()
    }
}

private final class ManagedCodexJSONLineReader: @unchecked Sendable {
    private static let maximumLineBytes = ManagedCodexTransportLimits.maximumMessageBytes
    private let handle: FileHandle
    private let descriptor: Int32
    private let closeLock = NSLock()
    private var closed = false
    private var handleClosed = false

    init(_ handle: FileHandle) {
        self.handle = handle
        descriptor = handle.fileDescriptor
        let flags = fcntl(descriptor, F_GETFL)
        if flags >= 0 { _ = fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) }
    }

    func readLines(_ handler: (Data) throws -> Void) throws {
        defer { finishClosingHandle() }
        var buffer = Data()
        var bytes = [UInt8](repeating: 0, count: 16_384)
        while true {
            if isClosed { return }
            var item = pollfd(
                fd: descriptor,
                events: Int16(POLLIN | POLLHUP | POLLERR),
                revents: 0
            )
            let pollResult = poll(&item, 1, 200)
            if pollResult < 0 {
                if errno == EINTR { continue }
                if isClosed { return }
                throw CoordinatorError("managed_codex_app_server_read_failed")
            }
            if pollResult == 0 { continue }
            if item.revents & Int16(POLLNVAL) != 0 {
                if isClosed { return }
                throw CoordinatorError("managed_codex_app_server_read_failed")
            }
            let count = bytes.withUnsafeMutableBytes { rawBuffer in
                Darwin.read(descriptor, rawBuffer.baseAddress, rawBuffer.count)
            }
            if count < 0 {
                if errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK { continue }
                if isClosed { return }
                throw CoordinatorError("managed_codex_app_server_read_failed")
            }
            if count == 0 {
                guard buffer.isEmpty else {
                    throw CoordinatorError("managed_codex_app_server_protocol_invalid")
                }
                return
            }
            buffer.append(contentsOf: bytes[0..<count])
            while let newline = buffer.firstIndex(of: 0x0A) {
                var line = Data(buffer[..<newline])
                buffer.removeSubrange(...newline)
                if line.last == 0x0D { line.removeLast() }
                guard !line.isEmpty, line.count <= Self.maximumLineBytes else {
                    throw CoordinatorError("managed_codex_app_server_protocol_invalid")
                }
                try handler(line)
            }
            guard buffer.count <= Self.maximumLineBytes else {
                throw CoordinatorError("managed_codex_app_server_message_too_large")
            }
        }
    }

    func close() {
        closeLock.lock()
        closed = true
        closeLock.unlock()
    }

    private var isClosed: Bool {
        closeLock.lock()
        defer { closeLock.unlock() }
        return closed
    }

    private func finishClosingHandle() {
        closeLock.lock()
        closed = true
        guard !handleClosed else {
            closeLock.unlock()
            return
        }
        handleClosed = true
        closeLock.unlock()
        try? handle.close()
    }

    deinit {
        close()
        finishClosingHandle()
    }
}

private final class ManagedCodexJSONLineWriter: @unchecked Sendable {
    private static let maximumLineBytes = ManagedCodexTransportLimits.maximumMessageBytes
    private let handle: FileHandle
    private let lock = NSLock()
    private var closed = false

    init(_ handle: FileHandle) throws {
        self.handle = handle
        let descriptor = handle.fileDescriptor
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0,
              fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETNOSIGPIPE, 1) == 0
        else {
            throw CoordinatorError("managed_codex_app_server_pipe_unsafe")
        }
    }

    func write(_ line: Data) throws {
        guard !line.isEmpty,
              line.count <= Self.maximumLineBytes,
              !line.contains(0x0A),
              !line.contains(0x0D)
        else {
            throw CoordinatorError("managed_codex_app_server_protocol_invalid")
        }
        var framed = line
        framed.append(0x0A)
        lock.lock()
        defer { lock.unlock() }
        guard !closed else {
            throw CoordinatorError("managed_codex_app_server_closed")
        }
        try writeAll(framed)
    }

    func close() {
        lock.lock()
        guard !closed else {
            lock.unlock()
            return
        }
        closed = true
        lock.unlock()
        try? handle.close()
    }

    private func writeAll(_ data: Data) throws {
        let descriptor = handle.fileDescriptor
        let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
        try data.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let now = DispatchTime.now().uptimeNanoseconds
                guard now < deadline else {
                    throw CoordinatorError("managed_codex_app_server_write_timeout")
                }
                let remainingMilliseconds = max(
                    1,
                    Int32(min((deadline - now) / 1_000_000, UInt64(Int32.max)))
                )
                var pollDescriptor = pollfd(
                    fd: descriptor,
                    events: Int16(POLLOUT),
                    revents: 0
                )
                let pollResult = poll(
                    &pollDescriptor,
                    1,
                    remainingMilliseconds
                )
                if pollResult < 0 && errno == EINTR { continue }
                guard pollResult > 0 else {
                    throw CoordinatorError("managed_codex_app_server_write_timeout")
                }
                let count = Darwin.write(
                    descriptor,
                    baseAddress.advanced(by: offset),
                    rawBuffer.count - offset
                )
                if count < 0 && (
                    errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK
                ) { continue }
                guard count > 0 else {
                    throw CoordinatorError("managed_codex_app_server_closed")
                }
                offset += count
            }
        }
    }
}

private enum ManagedCodexApprovalRequestIdentity: Hashable {
    case string(String)
    case integer(Int64)

    init?(jsonValue: Any?) {
        if let value = jsonValue as? String {
            guard !value.isEmpty,
                  value.unicodeScalars.count <= 512,
                  !value.contains("\n"),
                  !value.contains("\r"),
                  value.precomposedStringWithCanonicalMapping.utf8
                    .elementsEqual(value.utf8)
            else { return nil }
            self = .string(value)
            return
        }
        guard let value = ExactJSONInteger.int64(jsonValue) else { return nil }
        self = .integer(value)
    }
}

private func managedCodexApprovalEnvelopeIdentity(
    _ data: Data
) -> ManagedCodexApprovalRequestIdentity? {
    guard let object = try? StrictJSONTransport.object(
        from: data,
        limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
    ),
          object["method"] as? String
            == CodexAppServerApprovalAdapter.commandApprovalMethod
    else { return nil }
    return ManagedCodexApprovalRequestIdentity(jsonValue: object["id"])
}

private func recordManagedCodexApprovalFallback(_ error: Error) {
    guard ProcessInfo.processInfo.environment[
        "BLABEE_MANAGED_CODEX_DIAGNOSTICS"
    ] == "1" else { return }

    let reason: String
    switch error as? CodexAppServerApprovalAdapterError {
    case .invalid(let field): reason = "invalid_\(field)"
    case .unsupportedMethod: reason = "unsupported_method"
    case .unavailableDecision(let decision):
        reason = "unavailable_decision_\(decision)"
    case nil: reason = "unexpected_adapter_error"
    }
    guard var data = try? StrictJSONTransport.data(forJSONObject: [
        "code": "managed_codex_approval_fallback",
        "reason": reason,
    ]) else { return }
    data.append(0x0A)
    try? FileHandle.standardError.write(contentsOf: data)
}

/// One process-local, non-replayable bridge between the Codex remote TUI and
/// `codex app-server --listen stdio://`. Approval waits run on their own serial
/// queue, leaving both transport read loops free to forward unrelated traffic.
final class ManagedCodexAppServerBridge: @unchecked Sendable {
    private enum ApprovalAdmission {
        case admitted(UUID, ManagedCodexApprovalCancellation)
        case full
        case nativeOnly
        case duplicate
        case stopped
    }

    private let connection: ManagedCodexWebSocketConnection
    private let appServerReader: ManagedCodexJSONLineReader
    private let appServerWriter: ManagedCodexJSONLineWriter
    private let approvalRouter: ManagedCodexApprovalRouter
    private let connectionContext: ManagedCodexConnectionContext
    private let approvalQueue = DispatchQueue(
        label: "com.biadone.blabee.managed-codex.approvals",
        qos: .userInitiated
    )
    private let approvalGroup = DispatchGroup()
    private let maximumPendingApprovals: Int
    private let maximumSeenApprovalRequestIDs: Int
    private let approvalWaitNanoseconds: UInt64
    private let stateLock = NSLock()
    private var stopped = false
    private var managedInterceptionDisabled = false
    private var seenApprovalRequestIDs: Set<ManagedCodexApprovalRequestIdentity> = []
    private var pendingApprovalCancellations: [
        UUID: ManagedCodexApprovalCancellation
    ] = [:]

    init(
        connection: ManagedCodexWebSocketConnection,
        appServerOutput: FileHandle,
        appServerInput: FileHandle,
        approvalRouter: ManagedCodexApprovalRouter,
        brokerEpoch: String,
        maximumPendingApprovals: Int = 8,
        maximumSeenApprovalRequestIDs: Int = 256,
        approvalWaitNanoseconds: UInt64 =
            ManagedCodexApprovalTimingPolicy.brokerDeadlineNanoseconds
    ) throws {
        self.connection = connection
        appServerReader = ManagedCodexJSONLineReader(appServerOutput)
        appServerWriter = try ManagedCodexJSONLineWriter(appServerInput)
        self.approvalRouter = approvalRouter
        connectionContext = ManagedCodexConnectionContext(
            brokerEpoch: brokerEpoch,
            connectionID: connection.connectionID
        )
        self.maximumPendingApprovals = max(1, min(8, maximumPendingApprovals))
        self.maximumSeenApprovalRequestIDs = max(
            1,
            min(256, maximumSeenApprovalRequestIDs)
        )
        self.approvalWaitNanoseconds = max(
            1,
            min(
                ManagedCodexApprovalTimingPolicy.brokerDeadlineNanoseconds,
                approvalWaitNanoseconds
            )
        )
    }

    func run() throws {
        let group = DispatchGroup()
        let errors = ManagedCodexErrorBox()

        group.enter()
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            defer {
                stop()
                group.leave()
            }
            do {
                try connection.readMessages { [self] message in
                    guard !message.contains(0x0A), !message.contains(0x0D) else {
                        throw CoordinatorError("managed_codex_tui_protocol_invalid")
                    }
                    try appServerWriter.write(message)
                }
            } catch {
                if !isStopped { errors.record(error) }
            }
        }

        group.enter()
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            defer {
                stop()
                group.leave()
            }
            do {
                try appServerReader.readLines { [self] message in
                    if let requestID = managedCodexApprovalEnvelopeIdentity(message) {
                        let interceptable: Bool
                        do {
                            _ = try CodexAppServerApprovalAdapter.parse(message)
                            interceptable = true
                        } catch {
                            recordManagedCodexApprovalFallback(error)
                            interceptable = false
                        }
                        switch admitApproval(
                            requestID: requestID,
                            interceptable: interceptable
                        ) {
                        case .admitted(let admissionID, let cancellation):
                            approvalQueue.async { [self] in
                                defer { releaseApproval(admissionID) }
                                guard !cancellation.isCancelled else { return }
                                let route = approvalRouter.route(
                                    appServerMessage: message,
                                    context: connectionContext,
                                    cancellation: cancellation
                                )
                                guard !cancellation.isCancelled, !isStopped else {
                                    return
                                }
                                do {
                                    if cancellation.isExpired {
                                        try connection.sendText(message)
                                        return
                                    }
                                    switch route {
                                    case .appServer(let response):
                                        try appServerWriter.write(response)
                                    case .codex(let request):
                                        try connection.sendText(request)
                                    }
                                } catch {
                                    if !isStopped { errors.record(error) }
                                    stop()
                                }
                            }
                        case .full:
                            // Admission pressure is not authority to delay or
                            // reject Codex. Preserve the exact request bytes and
                            // return ownership to the official TUI immediately.
                            guard !isStopped else { return }
                            try connection.sendText(message)
                        case .nativeOnly:
                            guard !isStopped else { return }
                            try connection.sendText(message)
                        case .duplicate:
                            throw CoordinatorError(
                                "managed_codex_duplicate_approval_request"
                            )
                        case .stopped:
                            return
                        }
                    } else {
                        try connection.sendText(message)
                    }
                }
            } catch {
                if !isStopped { errors.record(error) }
            }
        }

        group.wait()
        stop()
        approvalGroup.wait()
        if let error = errors.error { throw error }
    }

    func stop() {
        stateLock.lock()
        guard !stopped else {
            stateLock.unlock()
            return
        }
        stopped = true
        let cancellations = Array(pendingApprovalCancellations.values)
        stateLock.unlock()
        for cancellation in cancellations { cancellation.cancel() }
        connection.close()
        appServerReader.close()
        appServerWriter.close()
    }

    private var isStopped: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return stopped
    }

    private func admitApproval(
        requestID: ManagedCodexApprovalRequestIdentity,
        interceptable: Bool
    ) -> ApprovalAdmission {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !stopped else { return .stopped }
        guard !seenApprovalRequestIDs.contains(requestID) else {
            return .duplicate
        }
        guard !managedInterceptionDisabled else { return .nativeOnly }
        guard seenApprovalRequestIDs.count < maximumSeenApprovalRequestIDs else {
            // The bounded identity memory is exhausted. Disable interception
            // for the rest of this connection rather than evicting old IDs or
            // terminating a valid Codex session. Every later approval remains
            // owned by the official TUI.
            managedInterceptionDisabled = true
            return .nativeOnly
        }
        seenApprovalRequestIDs.insert(requestID)
        guard interceptable else { return .nativeOnly }
        guard pendingApprovalCancellations.count < maximumPendingApprovals else {
            return .full
        }
        let admissionID = UUID()
        let now = DispatchTime.now().uptimeNanoseconds
        let (deadline, overflow) = now.addingReportingOverflow(
            approvalWaitNanoseconds
        )
        guard !overflow else { return .full }
        let cancellation = ManagedCodexApprovalCancellation(
            deadlineNanoseconds: deadline
        )
        pendingApprovalCancellations[admissionID] = cancellation
        approvalGroup.enter()
        return .admitted(admissionID, cancellation)
    }

    private func releaseApproval(_ admissionID: UUID) {
        stateLock.lock()
        let removed = pendingApprovalCancellations.removeValue(forKey: admissionID)
        stateLock.unlock()
        if removed != nil { approvalGroup.leave() }
    }
}

struct ManagedCodexLauncher {
    private static let authenticationEnvironmentName = "BLABEE_MANAGED_CODEX_AUTH_TOKEN"

    func run(
        arguments rawArguments: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment,
        approvedExecutableProvider: ManagedCodexExecutableProvider? = nil
    ) throws -> Int32 {
        let arguments = try ManagedCodexLauncherArguments(
            rawArguments,
            environment: environment
        )
        let executable: URL
        if let approvedExecutableProvider {
            guard arguments.explicitCodexURL == nil else {
                throw CoordinatorError("managed_codex_arguments_invalid")
            }
            executable = try approvedExecutableProvider()
        } else {
            executable = try CodexQueueExecutableResolver.resolve(
                explicitURL: arguments.explicitCodexURL,
                environment: environment
            )
        }
        let token = try Self.authenticationToken()
        let listener = try ManagedCodexWebSocketListener(expectedToken: token)
        let appServerInput = Pipe()
        let appServerOutput = Pipe()
        let appServer = Process()
        appServer.executableURL = executable
        appServer.arguments = ["app-server", "--listen", "stdio://"]
        appServer.standardInput = appServerInput
        appServer.standardOutput = appServerOutput
        appServer.standardError = FileHandle.standardError
        appServer.environment = Self.childEnvironment(
            environment,
            authenticationToken: nil,
            coordinatorSocketPath: arguments.coordinatorSocketPath
        )

        let tui = Process()
        tui.executableURL = executable
        tui.arguments = [
            "--remote", "ws://127.0.0.1:\(listener.port)",
            "--remote-auth-token-env", Self.authenticationEnvironmentName,
        ] + arguments.tuiArguments
        tui.standardInput = FileHandle.standardInput
        tui.standardOutput = FileHandle.standardOutput
        tui.standardError = FileHandle.standardError
        tui.environment = Self.childEnvironment(
            environment,
            authenticationToken: token,
            coordinatorSocketPath: arguments.coordinatorSocketPath
        )

        do {
            try appServer.run()
            try? appServerInput.fileHandleForReading.close()
            try? appServerOutput.fileHandleForWriting.close()
        } catch {
            listener.close()
            throw CoordinatorError("managed_codex_app_server_unavailable")
        }

        if let approvedExecutableProvider {
            do {
                let revalidated = try approvedExecutableProvider()
                guard revalidated == executable else {
                    throw CoordinatorError("managed_codex_executable_changed")
                }
            } catch {
                listener.close()
                Self.terminate(appServer)
                throw error
            }
        }
        do {
            try tui.run()
        } catch {
            listener.close()
            Self.terminate(appServer)
            throw CoordinatorError("managed_codex_tui_unavailable")
        }
        let terminalLease: ManagedCodexTerminalForegroundLease
        do {
            terminalLease = try ManagedCodexTerminalForegroundLease(tui: tui)
        } catch {
            listener.close()
            Self.terminate(tui)
            Self.terminate(appServer)
            throw error
        }
        defer { terminalLease.restoreIgnoringErrors() }
        let children = ManagedCodexChildProcesses(appServer: appServer, tui: tui)
        let signalRelay = ManagedCodexSignalRelay(children: children)
        defer { signalRelay.retainUntilScopeExit() }

        let bridge: ManagedCodexAppServerBridge
        do {
            let connection = try Self.acceptConnection(listener: listener, tui: tui)
            listener.close()
            let coordinatorClient = try ManagedCodexApprovalCoordinatorClient(
                socketPath: arguments.coordinatorSocketPath,
                responseTimeoutMilliseconds:
                    ManagedCodexApprovalTimingPolicy.socketResponseTimeoutMilliseconds
            )
            bridge = try ManagedCodexAppServerBridge(
                connection: connection,
                appServerOutput: appServerOutput.fileHandleForReading,
                appServerInput: appServerInput.fileHandleForWriting,
                approvalRouter: ManagedCodexApprovalRouter(decider: coordinatorClient),
                brokerEpoch: UUID().uuidString.lowercased()
            )
        } catch {
            listener.close()
            if !tui.isRunning {
                tui.waitUntilExit()
                let appServerTerminatedByBroker = Self.terminate(appServer)
                return managedCodexResolvedExitStatus(
                    tuiStatus: tui.terminationStatus,
                    appServerStatus: appServer.terminationStatus,
                    appServerTerminatedByBroker: appServerTerminatedByBroker
                )
            }
            children.terminateAll()
            throw error
        }

        do {
            try bridge.run()
        } catch {
            bridge.stop()
            children.terminateAll()
            throw error
        }
        bridge.stop()

        // A normally closing TUI tears down the bridge first. Give it a short
        // grace period, then terminate only these two exact managed children.
        let status = children.finish(graceMilliseconds: 2_000)
        try terminalLease.restore()
        return status
    }

    static func childEnvironment(
        _ inherited: [String: String],
        authenticationToken: String?,
        coordinatorSocketPath: String
    ) -> [String: String] {
        var child = inherited
        child["BLABEE_MANAGED_APPROVALS"] = "1"
        child["BLABEE_SOCKET"] = coordinatorSocketPath
        if let authenticationToken {
            child[authenticationEnvironmentName] = authenticationToken
        } else {
            child.removeValue(forKey: authenticationEnvironmentName)
        }
        return child
    }

    private static func authenticationToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw CoordinatorError("managed_codex_random_unavailable")
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private static func acceptConnection(
        listener: ManagedCodexWebSocketListener,
        tui: Process
    ) throws -> ManagedCodexWebSocketConnection {
        let deadline = DispatchTime.now().uptimeNanoseconds + 15_000_000_000
        var lastHandshakeFailure: ManagedCodexWebSocketError?
        while true {
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline else { break }
            guard tui.isRunning else {
                throw CoordinatorError("managed_codex_tui_exited_before_connect")
            }
            let remainingMilliseconds = max(
                1,
                Int32(min((deadline - now) / 1_000_000, UInt64(Int32.max)))
            )
            do {
                return try listener.accept(
                    timeoutMilliseconds: min(250, remainingMilliseconds),
                    handshakeTimeoutMilliseconds: min(5_000, remainingMilliseconds)
                )
            } catch ManagedCodexWebSocketError.acceptTimedOut {
                continue
            } catch ManagedCodexWebSocketError.authenticationFailed {
                lastHandshakeFailure = .authenticationFailed
                continue
            } catch ManagedCodexWebSocketError.invalidHandshake {
                lastHandshakeFailure = .invalidHandshake
                continue
            }
        }
        if let lastHandshakeFailure { throw lastHandshakeFailure }
        throw ManagedCodexWebSocketError.acceptTimedOut
    }

    @discardableResult
    private static func terminate(_ process: Process) -> Bool {
        managedCodexTerminateProcess(process)
    }
}

func managedCodexResolvedExitStatus(
    tuiStatus: Int32,
    appServerStatus: Int32,
    appServerTerminatedByBroker: Bool
) -> Int32 {
    if tuiStatus != 0 { return tuiStatus }
    if !appServerTerminatedByBroker, appServerStatus != 0 { return appServerStatus }
    return 0
}

@discardableResult
private func managedCodexTerminateProcess(_ process: Process) -> Bool {
    guard process.isRunning else {
        process.waitUntilExit()
        return false
    }
    process.terminate()
    let deadline = DispatchTime.now().uptimeNanoseconds + 750_000_000
    while process.isRunning,
          DispatchTime.now().uptimeNanoseconds < deadline
    {
        usleep(20_000)
    }
    if process.isRunning {
        _ = kill(process.processIdentifier, SIGKILL)
    }
    process.waitUntilExit()
    return true
}
