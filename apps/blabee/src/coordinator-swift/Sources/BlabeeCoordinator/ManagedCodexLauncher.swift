import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import OSLog
import Security

typealias ManagedCodexExecutableProvider = @Sendable () throws -> URL
typealias ManagedCodexAppServerDiagnosticsFactory = @Sendable () ->
    ManagedCodexAppServerDiagnostics

enum ManagedCodexRuntimeEnvironment {
    private static let codeModeHostEnvironmentName =
        "CODEX_CODE_MODE_HOST_PATH"

    /// Prevents a managed launch or its native fallback from escaping the
    /// pinned bundle through an inherited host override. PATH is deliberately
    /// unchanged; the bundle manifest owns its separate codex-path directory.
    static func bindPinnedBundle(
        in environment: inout [String: String],
        executable: URL
    ) {
        let executableDirectory = executable.deletingLastPathComponent()
        environment[codeModeHostEnvironmentName] = executableDirectory
            .appendingPathComponent(
                "codex-code-mode-host",
                isDirectory: false
            )
            .path
    }
}

/// Drains App Server stderr away from the interactive terminal. The captured
/// bytes remain available in macOS unified logging for local diagnostics, but
/// are private and capped per child so a noisy App Server cannot corrupt the
/// TUI or create an unbounded in-memory/logging workload.
final class ManagedCodexAppServerDiagnostics: @unchecked Sendable {
    typealias Recorder = @Sendable (Data) -> Void

    static let maximumRecordedBytes = 256 * 1_024

    let childPipe = Pipe()

    private static let logger = Logger(
        subsystem: "com.biadone.blabee",
        category: "managed-codex-app-server"
    )
    private let recorder: Recorder
    private let maximumBytes: Int
    private let stateLock = NSLock()
    private let drained = DispatchGroup()
    private var recordedBytes = 0
    private var reachedEnd = false
    private var parentWriterClosed = false

    init(
        maximumBytes: Int = maximumRecordedBytes,
        recorder: @escaping Recorder = { data in
            let message = String(decoding: data, as: UTF8.self)
            logger.error("\(message, privacy: .private)")
        }
    ) {
        self.maximumBytes = max(0, maximumBytes)
        self.recorder = recorder
        drained.enter()
        childPipe.fileHandleForReading.readabilityHandler = { [self] handle in
            consume(handle.availableData)
        }
    }

    func closeParentWriter() {
        stateLock.lock()
        guard !parentWriterClosed else {
            stateLock.unlock()
            return
        }
        parentWriterClosed = true
        stateLock.unlock()
        try? childPipe.fileHandleForWriting.close()
    }

    func waitUntilDrained(timeout: DispatchTime) -> Bool {
        drained.wait(timeout: timeout) == .success
    }

    private func consume(_ data: Data) {
        if data.isEmpty {
            finishReading()
            return
        }

        let captured: Data
        stateLock.lock()
        let available = max(0, maximumBytes - recordedBytes)
        let count = min(available, data.count)
        captured = count == 0 ? Data() : data.prefix(count)
        recordedBytes += count
        stateLock.unlock()

        // Continue draining after the cap is reached. Discarding excess bytes
        // avoids back-pressure on Codex while bounding Blabee's own work.
        if !captured.isEmpty { recorder(captured) }
    }

    private func finishReading() {
        stateLock.lock()
        guard !reachedEnd else {
            stateLock.unlock()
            return
        }
        reachedEnd = true
        stateLock.unlock()

        childPipe.fileHandleForReading.readabilityHandler = nil
        try? childPipe.fileHandleForReading.close()
        drained.leave()
    }
}

enum ManagedCodexChildStartState: Equatable {
    case notStarted
    case started
}

struct ManagedCodexLaunchFailure: Error {
    let childStartState: ManagedCodexChildStartState
    let nativeExecutableURL: URL
    let tuiArguments: [String]
    let underlyingError: Error
}

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

final class ManagedCodexChildProcesses: @unchecked Sendable {
    let appServer: Process
    let tui: Process
    private let lock = NSLock()
    private let processIsRunning: (Process) -> Bool
    private let terminateProcess: (Process) -> Bool

    init(
        appServer: Process,
        tui: Process,
        processIsRunning: @escaping (Process) -> Bool = { $0.isRunning },
        terminateProcess: @escaping (Process) -> Bool =
            managedCodexTerminateProcess
    ) {
        self.appServer = appServer
        self.tui = tui
        self.processIsRunning = processIsRunning
        self.terminateProcess = terminateProcess
    }

    func terminateAll() {
        lock.lock()
        defer { lock.unlock() }
        _ = terminateProcess(tui)
        _ = terminateProcess(appServer)
    }

    func finish(graceMilliseconds: Int) -> Int32 {
        lock.lock()
        defer { lock.unlock() }
        let now = DispatchTime.now().uptimeNanoseconds
        let duration = UInt64(max(0, graceMilliseconds)) * 1_000_000
        let (deadline, overflow) = now.addingReportingOverflow(duration)
        while processIsRunning(tui),
              !overflow,
              DispatchTime.now().uptimeNanoseconds < deadline
        {
            usleep(20_000)
        }
        if processIsRunning(tui) { _ = terminateProcess(tui) }
        let appServerTerminatedByBroker = terminateProcess(appServer)
        guard !processIsRunning(tui) else {
            // Foundation can fail to publish a reaped child's termination
            // state. Never block the broker indefinitely waiting for that
            // notification. Both exact children have already received bounded
            // cleanup before this synthetic status is returned.
            return managedCodexShellExitStatus(
                status: SIGKILL,
                reason: .uncaughtSignal
            )
        }
        let tuiStatus = tui.terminationStatus
        let tuiReason = tui.terminationReason
        guard !processIsRunning(appServer) else {
            // The App Server is broker-owned, so an unobservable status after
            // bounded TERM/KILL cleanup must not replace the TUI's real exit.
            return managedCodexShellExitStatus(
                status: tuiStatus,
                reason: tuiReason
            )
        }
        return managedCodexResolvedExitStatus(
            tuiStatus: tuiStatus,
            tuiReason: tuiReason,
            appServerStatus: appServer.terminationStatus,
            appServerReason: appServer.terminationReason,
            appServerTerminatedByBroker: appServerTerminatedByBroker
        )
    }
}

private final class ManagedCodexSignalRelay: @unchecked Sendable {
    private let sources: [DispatchSourceSignal]

    init(terminationHandler: @escaping @Sendable () -> Void) {
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
                terminationHandler()
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

private func recordManagedCodexDeliveryAckFailure(_ error: Error) {
    guard ProcessInfo.processInfo.environment[
        "BLABEE_MANAGED_CODEX_DIAGNOSTICS"
    ] == "1" else { return }
    guard var data = try? StrictJSONTransport.data(forJSONObject: [
        "code": "managed_codex_approval_delivery_ack_failed",
        "reason": error.coordinatorError.code,
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
    private let resumeConflictObserver: ManagedCodexResumeConflictObserver
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
        maximumTrackedResumeRequestIDs: Int = 32,
        resumeConflictReporter: @escaping ManagedCodexResumeConflictObserver.Reporter = {
            _ in
        },
        approvalWaitNanoseconds: UInt64 =
            ManagedCodexApprovalTimingPolicy.brokerDeadlineNanoseconds
    ) throws {
        self.connection = connection
        appServerReader = ManagedCodexJSONLineReader(appServerOutput)
        appServerWriter = try ManagedCodexJSONLineWriter(appServerInput)
        self.approvalRouter = approvalRouter
        resumeConflictObserver = ManagedCodexResumeConflictObserver(
            maximumTrackedRequestIDs: maximumTrackedResumeRequestIDs,
            reporter: resumeConflictReporter
        )
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
                    try resumeConflictObserver.forwardRequest(message) {
                        try appServerWriter.write(message)
                    }
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
                                let routingResult = approvalRouter.routeWithDelivery(
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
                                    switch routingResult.route {
                                    case .appServer(let response):
                                        try appServerWriter.write(response)
                                    case .codex(let request):
                                        try connection.sendText(request)
                                    }
                                    if let delivery = routingResult.delivery {
                                        // Selection receipt and downstream delivery are
                                        // separate facts. Acknowledge exactly once only
                                        // after the intended peer accepted every byte.
                                        do {
                                            try approvalRouter.acknowledgeDelivery(delivery)
                                        } catch {
                                            // The downstream response cannot be rolled
                                            // back. Do not retry or tear down a healthy
                                            // Codex session; the coordinator retains the
                                            // unresolved delivery state instead.
                                            recordManagedCodexDeliveryAckFailure(error)
                                        }
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
                        resumeConflictObserver.observeForwardedResponse(message)
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

final class ManagedCodexListenerAdmission: @unchecked Sendable {
    let port: UInt16
    private let listener: ManagedCodexWebSocketListener
    private let acceptOperationLock = NSLock()
    private let stateLock = NSLock()
    private var stopped = false

    init(listener: ManagedCodexWebSocketListener) {
        self.listener = listener
        port = listener.port
    }

    func accept(
        timeoutMilliseconds: Int32,
        handshakeTimeoutMilliseconds: Int32
    ) throws -> ManagedCodexWebSocketConnection {
        acceptOperationLock.lock()
        defer { acceptOperationLock.unlock() }
        guard !isStopped else {
            throw CoordinatorError("managed_codex_listener_stopped")
        }
        return try listener.accept(
            timeoutMilliseconds: timeoutMilliseconds,
            handshakeTimeoutMilliseconds: handshakeTimeoutMilliseconds
        )
    }

    func stop() {
        stateLock.lock()
        guard !stopped else {
            stateLock.unlock()
            return
        }
        stopped = true
        stateLock.unlock()

        // Wake a blocked poll before waiting for the current accept operation.
        // Only the operation owner can perform the final descriptor close.
        Self.wakeListener(port: port)
        acceptOperationLock.lock()
        listener.close()
        acceptOperationLock.unlock()
    }

    private var isStopped: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return stopped
    }

    private static func wakeListener(port: UInt16) {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return }
        defer { Darwin.close(descriptor) }
        let flags = fcntl(descriptor, F_GETFL)
        guard flags >= 0,
              fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0
        else { return }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let connectResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(
                    descriptor,
                    $0,
                    socklen_t(MemoryLayout<sockaddr_in>.size)
                )
            }
        }
        if connectResult == 0 { return }
        guard errno == EINPROGRESS else { return }

        let deadline = DispatchTime.now().uptimeNanoseconds + 100_000_000
        while true {
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline else { return }
            let remainingMilliseconds = max(
                1,
                Int32(min((deadline - now) / 1_000_000, UInt64(Int32.max)))
            )
            var item = pollfd(
                fd: descriptor,
                events: Int16(POLLOUT),
                revents: 0
            )
            let pollResult = Darwin.poll(
                &item,
                1,
                remainingMilliseconds
            )
            if pollResult < 0 && errno == EINTR { continue }
            guard pollResult > 0 else { return }

            var socketError: Int32 = 0
            var socketErrorLength = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(
                descriptor,
                SOL_SOCKET,
                SO_ERROR,
                &socketError,
                &socketErrorLength
            ) == 0,
                  socketError == 0
            else { return }
            return
        }
    }
}

private final class ManagedCodexAuxiliarySession: @unchecked Sendable {
    let id = UUID()
    private let process: Process
    private let bridge: ManagedCodexAppServerBridge
    private let appServerDiagnostics: ManagedCodexAppServerDiagnostics
    private let stateLock = NSLock()
    private var stopped = false

    init(
        process: Process,
        bridge: ManagedCodexAppServerBridge,
        appServerDiagnostics: ManagedCodexAppServerDiagnostics
    ) {
        self.process = process
        self.bridge = bridge
        self.appServerDiagnostics = appServerDiagnostics
    }

    func run() throws {
        defer { stop() }
        try bridge.run()
    }

    func stop() {
        stateLock.lock()
        guard !stopped else {
            stateLock.unlock()
            return
        }
        stopped = true
        stateLock.unlock()
        bridge.stop()
        managedCodexTerminateProcess(process)
    }
}

/// Accepts the additional remote connections Codex opens for in-session
/// pickers such as `/resume`. Each connection owns an isolated stdio App
/// Server so JSON-RPC request IDs and approval state never cross sessions.
final class ManagedCodexAuxiliaryConnectionBroker: @unchecked Sendable {
    private let admission: ManagedCodexListenerAdmission
    private let executable: URL
    private let environment: [String: String]
    private let coordinatorSocketPath: String
    private let brokerEpoch: String
    private let approvedExecutableProvider: ManagedCodexExecutableProvider?
    private let resumeConflictReporter: ManagedCodexResumeConflictObserver.Reporter
    private let appServerDiagnosticsFactory:
        ManagedCodexAppServerDiagnosticsFactory
    private let maximumSessions: Int
    private let stateLock = NSLock()
    private let workGroup = DispatchGroup()
    private var started = false
    private var stopped = false
    private var pendingSessionCount = 0
    private var sessions: [UUID: ManagedCodexAuxiliarySession] = [:]

    init(
        admission: ManagedCodexListenerAdmission,
        executable: URL,
        environment: [String: String],
        coordinatorSocketPath: String,
        brokerEpoch: String,
        approvedExecutableProvider: ManagedCodexExecutableProvider? = nil,
        resumeConflictReporter: @escaping ManagedCodexResumeConflictObserver.Reporter = {
            _ in
        },
        appServerDiagnosticsFactory: @escaping
            ManagedCodexAppServerDiagnosticsFactory = {
                ManagedCodexAppServerDiagnostics()
            },
        maximumSessions: Int = 4
    ) {
        self.admission = admission
        self.executable = executable
        self.environment = environment
        self.coordinatorSocketPath = coordinatorSocketPath
        self.brokerEpoch = brokerEpoch
        self.approvedExecutableProvider = approvedExecutableProvider
        self.resumeConflictReporter = resumeConflictReporter
        self.appServerDiagnosticsFactory = appServerDiagnosticsFactory
        self.maximumSessions = max(1, min(4, maximumSessions))
    }

    func start() {
        stateLock.lock()
        guard !started, !stopped else {
            stateLock.unlock()
            return
        }
        started = true
        workGroup.enter()
        stateLock.unlock()

        DispatchQueue.global(qos: .userInitiated).async { [self] in
            defer { workGroup.leave() }
            acceptConnections()
        }
    }

    func stop() {
        stateLock.lock()
        guard !stopped else {
            stateLock.unlock()
            return
        }
        stopped = true
        let activeSessions = Array(sessions.values)
        stateLock.unlock()

        admission.stop()

        for session in activeSessions { session.stop() }
    }

    func stopAndWait() {
        stop()
        workGroup.wait()
    }

    private func acceptConnections() {
        while !isStopped {
            let result: Result<ManagedCodexWebSocketConnection, Error>
            do {
                result = .success(try admission.accept(
                    timeoutMilliseconds: 250,
                    handshakeTimeoutMilliseconds: 500
                ))
            } catch {
                result = .failure(error)
            }

            switch result {
            case .success(let connection):
                guard !isStopped else {
                    connection.close()
                    return
                }
                startSession(for: connection)
            case .failure(let error):
                if isStopped { return }
                guard Self.isConnectionScopedAcceptError(error) else {
                    // Fatal listener errors end auxiliary admission without
                    // affecting the already-running primary TUI.
                    return
                }
            }
        }
    }

    private static func isConnectionScopedAcceptError(_ error: Error) -> Bool {
        guard let error = error as? ManagedCodexWebSocketError else {
            return false
        }
        switch error {
        case .acceptTimedOut,
             .authenticationFailed,
             .invalidHandshake,
             .connectionClosed,
             .writeTimedOut:
            return true
        case .socketFailure(let operation):
            return operation == "write"
                || operation == "write_poll"
                || operation == "write_nonblocking"
        case .invalidFrame, .messageTooLarge:
            return false
        }
    }

    private func startSession(
        for connection: ManagedCodexWebSocketConnection
    ) {
        guard reserveSession() else {
            connection.close()
            return
        }

        let session: ManagedCodexAuxiliarySession
        do {
            session = try makeSession(connection: connection)
        } catch {
            connection.close()
            releaseFailedReservation()
            return
        }

        stateLock.lock()
        pendingSessionCount -= 1
        let shouldStop = stopped
        if !shouldStop { sessions[session.id] = session }
        stateLock.unlock()

        if shouldStop {
            session.stop()
            workGroup.leave()
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [self] in
            try? session.run()
            stateLock.lock()
            sessions.removeValue(forKey: session.id)
            stateLock.unlock()
            workGroup.leave()
        }
    }

    private func reserveSession() -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !stopped,
              pendingSessionCount + sessions.count < maximumSessions
        else { return false }
        pendingSessionCount += 1
        // Enter before spawning. stopAndWait() therefore covers a process that
        // is between authentication and registration as well as active ones.
        workGroup.enter()
        return true
    }

    private func releaseFailedReservation() {
        stateLock.lock()
        pendingSessionCount -= 1
        stateLock.unlock()
        workGroup.leave()
    }

    private func makeSession(
        connection: ManagedCodexWebSocketConnection
    ) throws -> ManagedCodexAuxiliarySession {
        let appServerInput = Pipe()
        let appServerOutput = Pipe()
        let appServerDiagnostics = appServerDiagnosticsFactory()
        let process = Process()
        process.executableURL = executable
        process.arguments = ["app-server", "--listen", "stdio://"]
        process.standardInput = appServerInput
        process.standardOutput = appServerOutput
        process.standardError = appServerDiagnostics.childPipe
        process.environment = try ManagedCodexLauncher.childEnvironment(
            environment,
            executable: executable,
            authenticationToken: nil,
            coordinatorSocketPath: coordinatorSocketPath
        )

        if let approvedExecutableProvider {
            let revalidated = try approvedExecutableProvider()
            guard revalidated == executable else {
                throw CoordinatorError("managed_codex_executable_changed")
            }
        }
        guard !isStopped else {
            throw CoordinatorError("managed_codex_stopped")
        }

        var started = false
        do {
            try process.run()
            started = true
            appServerDiagnostics.closeParentWriter()
            try? appServerInput.fileHandleForReading.close()
            try? appServerOutput.fileHandleForWriting.close()

            if let approvedExecutableProvider {
                let revalidated = try approvedExecutableProvider()
                guard revalidated == executable else {
                    throw CoordinatorError("managed_codex_executable_changed")
                }
            }

            let coordinatorClient = try ManagedCodexApprovalCoordinatorClient(
                socketPath: coordinatorSocketPath,
                responseTimeoutMilliseconds:
                    ManagedCodexApprovalTimingPolicy.socketResponseTimeoutMilliseconds
            )
            let bridge = try ManagedCodexAppServerBridge(
                connection: connection,
                appServerOutput: appServerOutput.fileHandleForReading,
                appServerInput: appServerInput.fileHandleForWriting,
                approvalRouter: ManagedCodexApprovalRouter(
                    decider: coordinatorClient
                ),
                brokerEpoch: brokerEpoch,
                resumeConflictReporter: resumeConflictReporter
            )
            return ManagedCodexAuxiliarySession(
                process: process,
                bridge: bridge,
                appServerDiagnostics: appServerDiagnostics
            )
        } catch {
            appServerDiagnostics.closeParentWriter()
            connection.close()
            try? appServerInput.fileHandleForWriting.close()
            try? appServerOutput.fileHandleForReading.close()
            if started { managedCodexTerminateProcess(process) }
            throw error
        }
    }

    private var isStopped: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return stopped
    }
}

private final class ManagedCodexLauncherShutdown: @unchecked Sendable {
    private let admission: ManagedCodexListenerAdmission
    private let children: ManagedCodexChildProcesses
    private let stateLock = NSLock()
    private var stopped = false
    private var auxiliaryBroker: ManagedCodexAuxiliaryConnectionBroker?

    init(
        admission: ManagedCodexListenerAdmission,
        children: ManagedCodexChildProcesses
    ) {
        self.admission = admission
        self.children = children
    }

    func attach(_ broker: ManagedCodexAuxiliaryConnectionBroker) {
        stateLock.lock()
        let shouldStop = stopped
        if !shouldStop { auxiliaryBroker = broker }
        stateLock.unlock()
        if shouldStop { broker.stopAndWait() }
    }

    func terminateAll() {
        admission.stop()
        stateLock.lock()
        stopped = true
        let broker = auxiliaryBroker
        stateLock.unlock()
        broker?.stopAndWait()
        children.terminateAll()
    }
}

struct ManagedCodexLauncher {
    private static let authenticationEnvironmentName = "BLABEE_MANAGED_CODEX_AUTH_TOKEN"

    func run(
        arguments rawArguments: [String],
        environment: [String: String] = ProcessInfo.processInfo.environment,
        approvedExecutableProvider: ManagedCodexExecutableProvider? = nil,
        appServerDiagnosticsFactory: @escaping
            ManagedCodexAppServerDiagnosticsFactory = {
                ManagedCodexAppServerDiagnostics()
            }
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
        var childStartState = ManagedCodexChildStartState.notStarted
        do {
        let token = try Self.authenticationToken()
        let listener = try ManagedCodexWebSocketListener(expectedToken: token)
        let admission = ManagedCodexListenerAdmission(listener: listener)
        let appServerInput = Pipe()
        let appServerOutput = Pipe()
        let appServerDiagnostics = appServerDiagnosticsFactory()
        let appServer = Process()
        appServer.executableURL = executable
        appServer.arguments = ["app-server", "--listen", "stdio://"]
        appServer.standardInput = appServerInput
        appServer.standardOutput = appServerOutput
        appServer.standardError = appServerDiagnostics.childPipe
        appServer.environment = try Self.childEnvironment(
            environment,
            executable: executable,
            authenticationToken: nil,
            coordinatorSocketPath: arguments.coordinatorSocketPath
        )

        let tui = Process()
        tui.executableURL = executable
        tui.arguments = [
            "--remote", "ws://127.0.0.1:\(admission.port)",
            "--remote-auth-token-env", Self.authenticationEnvironmentName,
        ] + arguments.tuiArguments
        tui.standardInput = FileHandle.standardInput
        tui.standardOutput = FileHandle.standardOutput
        tui.standardError = FileHandle.standardError
        tui.environment = try Self.childEnvironment(
            environment,
            executable: executable,
            authenticationToken: token,
            coordinatorSocketPath: arguments.coordinatorSocketPath
        )

        if let approvedExecutableProvider {
            do {
                let revalidated = try approvedExecutableProvider()
                guard revalidated == executable else {
                    throw CoordinatorError("managed_codex_executable_changed")
                }
            } catch {
                admission.stop()
                throw error
            }
        }
        do {
            try appServer.run()
            childStartState = .started
            appServerDiagnostics.closeParentWriter()
            try? appServerInput.fileHandleForReading.close()
            try? appServerOutput.fileHandleForWriting.close()
        } catch {
            appServerDiagnostics.closeParentWriter()
            admission.stop()
            throw CoordinatorError("managed_codex_app_server_unavailable")
        }

        if let approvedExecutableProvider {
            do {
                let revalidated = try approvedExecutableProvider()
                guard revalidated == executable else {
                    throw CoordinatorError("managed_codex_executable_changed")
                }
            } catch {
                admission.stop()
                Self.terminate(appServer)
                throw error
            }
        }
        do {
            try tui.run()
        } catch {
            admission.stop()
            Self.terminate(appServer)
            throw CoordinatorError("managed_codex_tui_unavailable")
        }
        if let approvedExecutableProvider {
            do {
                let revalidated = try approvedExecutableProvider()
                guard revalidated == executable else {
                    throw CoordinatorError("managed_codex_executable_changed")
                }
            } catch {
                admission.stop()
                Self.terminate(tui)
                Self.terminate(appServer)
                throw error
            }
        }
        let terminalLease: ManagedCodexTerminalForegroundLease
        do {
            terminalLease = try ManagedCodexTerminalForegroundLease(tui: tui)
        } catch {
            admission.stop()
            Self.terminate(tui)
            Self.terminate(appServer)
            throw error
        }
        defer { terminalLease.restoreIgnoringErrors() }
        let children = ManagedCodexChildProcesses(appServer: appServer, tui: tui)
        let shutdown = ManagedCodexLauncherShutdown(
            admission: admission,
            children: children
        )
        let signalRelay = ManagedCodexSignalRelay {
            shutdown.terminateAll()
        }
        defer { signalRelay.retainUntilScopeExit() }

        let bridge: ManagedCodexAppServerBridge
        let auxiliaryBroker: ManagedCodexAuxiliaryConnectionBroker
        do {
            let connection = try Self.acceptConnection(
                admission: admission,
                tui: tui
            )
            let brokerEpoch = UUID().uuidString.lowercased()
            let coordinatorClient = try ManagedCodexApprovalCoordinatorClient(
                socketPath: arguments.coordinatorSocketPath,
                responseTimeoutMilliseconds:
                    ManagedCodexApprovalTimingPolicy.socketResponseTimeoutMilliseconds
            )
            let activeWriterNoticeEmitter = ManagedCodexActiveWriterNoticeEmitter()
            let resumeConflictReporter: ManagedCodexResumeConflictObserver.Reporter = {
                event in
                activeWriterNoticeEmitter.report(event)
            }
            bridge = try ManagedCodexAppServerBridge(
                connection: connection,
                appServerOutput: appServerOutput.fileHandleForReading,
                appServerInput: appServerInput.fileHandleForWriting,
                approvalRouter: ManagedCodexApprovalRouter(decider: coordinatorClient),
                brokerEpoch: brokerEpoch,
                resumeConflictReporter: resumeConflictReporter
            )
            auxiliaryBroker = ManagedCodexAuxiliaryConnectionBroker(
                admission: admission,
                executable: executable,
                environment: environment,
                coordinatorSocketPath: arguments.coordinatorSocketPath,
                brokerEpoch: brokerEpoch,
                approvedExecutableProvider: approvedExecutableProvider,
                resumeConflictReporter: resumeConflictReporter,
                appServerDiagnosticsFactory: appServerDiagnosticsFactory
            )
            shutdown.attach(auxiliaryBroker)
            auxiliaryBroker.start()
        } catch {
            admission.stop()
            if !tui.isRunning {
                let appServerTerminatedByBroker = Self.terminate(appServer)
                let tuiStatus = tui.terminationStatus
                let tuiReason = tui.terminationReason
                guard !appServer.isRunning else {
                    return managedCodexShellExitStatus(
                        status: tuiStatus,
                        reason: tuiReason
                    )
                }
                return managedCodexResolvedExitStatus(
                    tuiStatus: tuiStatus,
                    tuiReason: tuiReason,
                    appServerStatus: appServer.terminationStatus,
                    appServerReason: appServer.terminationReason,
                    appServerTerminatedByBroker: appServerTerminatedByBroker
                )
            }
            shutdown.terminateAll()
            throw error
        }

        do {
            try bridge.run()
        } catch {
            bridge.stop()
            shutdown.terminateAll()
            throw error
        }
        bridge.stop()
        auxiliaryBroker.stopAndWait()

        // A normally closing TUI tears down the bridge first. Give it a short
        // grace period, then terminate only these two exact managed children.
        let status = children.finish(graceMilliseconds: 2_000)
        try terminalLease.restore()
        return status
        } catch let failure as ManagedCodexLaunchFailure {
            throw failure
        } catch {
            throw ManagedCodexLaunchFailure(
                childStartState: childStartState,
                nativeExecutableURL: executable,
                tuiArguments: arguments.tuiArguments,
                underlyingError: error
            )
        }
    }

    static func childEnvironment(
        _ inherited: [String: String],
        executable: URL,
        authenticationToken: String?,
        coordinatorSocketPath: String
    ) throws -> [String: String] {
        var child = try ManagedCodexLaunchEnvironment.validated(inherited)
        ManagedCodexRuntimeEnvironment.bindPinnedBundle(
            in: &child,
            executable: executable
        )
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
        admission: ManagedCodexListenerAdmission,
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
                return try admission.accept(
                    timeoutMilliseconds: min(250, remainingMilliseconds),
                    handshakeTimeoutMilliseconds: min(500, remainingMilliseconds)
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
    tuiReason: Process.TerminationReason,
    appServerStatus: Int32,
    appServerReason: Process.TerminationReason,
    appServerTerminatedByBroker: Bool
) -> Int32 {
    let tuiShellStatus = managedCodexShellExitStatus(
        status: tuiStatus,
        reason: tuiReason
    )
    if tuiShellStatus != 0 { return tuiShellStatus }
    let appServerShellStatus = managedCodexShellExitStatus(
        status: appServerStatus,
        reason: appServerReason
    )
    if !appServerTerminatedByBroker, appServerShellStatus != 0 {
        return appServerShellStatus
    }
    return 0
}

func managedCodexShellExitStatus(
    status: Int32,
    reason: Process.TerminationReason
) -> Int32 {
    reason == .uncaughtSignal ? 128 + status : status
}

@discardableResult
func managedCodexTerminateProcess(_ process: Process) -> Bool {
    guard process.isRunning else { return false }
    process.terminate()
    if !managedCodexAwaitProcessExit(
        process,
        timeoutMilliseconds: 750
    ), process.isRunning {
        _ = kill(process.processIdentifier, SIGKILL)
    }
    _ = managedCodexAwaitProcessExit(
        process,
        timeoutMilliseconds: 750
    )
    return true
}

private func managedCodexAwaitProcessExit(
    _ process: Process,
    timeoutMilliseconds: Int
) -> Bool {
    let now = DispatchTime.now().uptimeNanoseconds
    let duration = UInt64(max(0, timeoutMilliseconds)) * 1_000_000
    let (deadline, overflow) = now.addingReportingOverflow(duration)
    guard !overflow else { return !process.isRunning }
    while process.isRunning,
          DispatchTime.now().uptimeNanoseconds < deadline
    {
        usleep(20_000)
    }
    return !process.isRunning
}
