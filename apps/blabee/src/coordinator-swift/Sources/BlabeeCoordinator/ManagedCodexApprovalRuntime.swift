import CoordinatorSwift
import Darwin
import Dispatch
import Foundation

enum ManagedCodexApprovalRuntimeError: Error, Equatable, CustomStringConvertible {
    case invalidCoordinatorResponse

    var description: String {
        switch self {
        case .invalidCoordinatorResponse:
            return "the managed approval coordinator response is invalid"
        }
    }
}

struct ManagedCodexConnectionContext: Sendable, Equatable {
    let brokerEpoch: String
    let connectionID: String
}

final class ManagedCodexApprovalCancellation: @unchecked Sendable {
    fileprivate final class Registration: @unchecked Sendable {
        private let descriptor: Int32
        private let lock = NSLock()
        private var active = true

        init(descriptor: Int32) {
            self.descriptor = descriptor
        }

        func cancel() {
            lock.lock()
            defer { lock.unlock() }
            guard active else { return }
            _ = shutdown(descriptor, SHUT_RDWR)
        }

        func finish() {
            lock.lock()
            active = false
            lock.unlock()
        }
    }

    private let lock = NSLock()
    private let deadlineNanoseconds: UInt64?
    private var cancelled = false
    private var registration: Registration?

    init(deadlineNanoseconds: UInt64? = nil) {
        self.deadlineNanoseconds = deadlineNanoseconds
    }

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    var isExpired: Bool {
        guard let deadlineNanoseconds else { return false }
        return DispatchTime.now().uptimeNanoseconds >= deadlineNanoseconds
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let current = registration
        lock.unlock()
        current?.cancel()
    }

    func check() throws {
        if isCancelled || isExpired { throw CancellationError() }
    }

    func boundedDeadline(_ proposed: UInt64) -> UInt64 {
        guard let deadlineNanoseconds else { return proposed }
        return min(proposed, deadlineNanoseconds)
    }

    fileprivate func register(descriptor: Int32) -> Registration? {
        let candidate = Registration(descriptor: descriptor)
        lock.lock()
        guard !cancelled, registration == nil else {
            let wasCancelled = cancelled
            lock.unlock()
            if wasCancelled { candidate.cancel() }
            return nil
        }
        registration = candidate
        lock.unlock()
        return candidate
    }

    fileprivate func unregister(_ candidate: Registration) {
        // Mark the descriptor inactive before it can be closed and reused.
        // A concurrent cancel either shuts it down first or observes inactive.
        candidate.finish()
        lock.lock()
        if registration === candidate { registration = nil }
        lock.unlock()
    }
}

protocol ManagedCodexApprovalDeciding: Sendable {
    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision
}

struct ManagedCodexApprovalCoordinatorClient: ManagedCodexApprovalDeciding {
    private let socketPath: String
    private let connectTimeoutMilliseconds: Int32
    private let responseTimeoutMilliseconds: Int32

    init(
        socketPath: String,
        connectTimeoutMilliseconds: Int32 = 2_000,
        responseTimeoutMilliseconds: Int32 =
            ManagedCodexApprovalTimingPolicy.socketResponseTimeoutMilliseconds
    ) throws {
        self.socketPath = try OperationalSocketPath.resolve(explicitPath: socketPath)
        self.connectTimeoutMilliseconds = connectTimeoutMilliseconds
        self.responseTimeoutMilliseconds = responseTimeoutMilliseconds
    }

    func decision(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> CodexAppServerApprovalDecision {
        let result = try ManagedCodexApprovalSocketRequest(
            socketPath: socketPath,
            connectTimeoutMilliseconds: connectTimeoutMilliseconds,
            responseTimeoutMilliseconds: responseTimeoutMilliseconds
        ).request(
            type: "managed_command_approval",
            payload: Self.payload(for: request, context: context),
            cancellation: cancellation
        )
        guard Set(result.keys) == ["decision"],
              let rawDecision = result["decision"] as? String
        else {
            throw ManagedCodexApprovalRuntimeError.invalidCoordinatorResponse
        }
        switch rawDecision {
        case "accept_once": return .allowOnce
        case "decline": return .deny
        case "decide_in_codex": return .decideInCodex
        default: throw ManagedCodexApprovalRuntimeError.invalidCoordinatorResponse
        }
    }

    static func payload(
        for request: CodexAppServerCommandApprovalRequest,
        context: ManagedCodexConnectionContext
    ) -> [String: Any] {
        let requestID: [String: Any]
        switch request.requestID {
        case .string(let value):
            requestID = ["type": "string", "value": value]
        case .integer(let value):
            requestID = ["type": "integer", "value": value]
        }
        return [
            "schema_version": "1.0",
            "kind": "blabee_managed_command_approval_request",
            "broker_epoch": context.brokerEpoch,
            "connection_id": context.connectionID,
            "jsonrpc_request_id": requestID,
            "thread_id": request.threadID,
            "turn_id": request.turnID,
            "item_id": request.itemID,
            "approval_id": request.approvalID as Any? ?? NSNull(),
            "environment_id": request.environmentID as Any? ?? NSNull(),
            "cwd": request.cwd,
            "command_preview": request.command,
            "allow_once_available": request.availableDecisions.contains(.accept),
            "decline_available": request.availableDecisions.contains(.decline)
                || request.availableDecisions.contains(.cancel),
        ]
    }
}

enum ManagedCodexApprovalRoute: Equatable {
    case appServer(Data)
    case codex(Data)
}

/// Resolves one intercepted App Server command approval. The router deliberately
/// owns no retry or persistence mechanism: a coordinator failure immediately
/// restores the official Codex approval path using the exact original bytes.
struct ManagedCodexApprovalRouter: Sendable {
    let decider: any ManagedCodexApprovalDeciding

    func route(
        appServerMessage: Data,
        context: ManagedCodexConnectionContext,
        cancellation: ManagedCodexApprovalCancellation =
            ManagedCodexApprovalCancellation()
    ) -> ManagedCodexApprovalRoute {
        let request: CodexAppServerCommandApprovalRequest
        do {
            request = try CodexAppServerApprovalAdapter.parse(appServerMessage)
        } catch {
            return .codex(appServerMessage)
        }

        let decision: CodexAppServerApprovalDecision
        do {
            decision = try decider.decision(
                for: request,
                context: context,
                cancellation: cancellation
            )
        } catch {
            return .codex(request.forwardingData)
        }

        do {
            switch try CodexAppServerApprovalAdapter.resolve(decision, for: request) {
            case .respond(let response):
                return .appServer(try response.encodedData())
            case .forwardToCodex(let requestData):
                return .codex(requestData)
            }
        } catch {
            return .codex(request.forwardingData)
        }
    }
}

private struct ManagedCodexApprovalSocketRequest {
    private static let maximumMessageBytes = 1_048_576
    let socketPath: String
    let connectTimeoutMilliseconds: Int32
    let responseTimeoutMilliseconds: Int32

    func request(
        type: String,
        payload: [String: Any],
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> [String: Any] {
        try cancellation.check()
        var socketInfo = stat()
        guard lstat(socketPath, &socketInfo) == 0,
              socketInfo.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK),
              socketInfo.st_mode & 0o777 == 0o600,
              socketInfo.st_uid == geteuid()
        else {
            throw CoordinatorError("operational_socket_unavailable")
        }

        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw CoordinatorError("operational_socket_unavailable")
        }
        let descriptorFlags = fcntl(descriptor, F_GETFD)
        if descriptorFlags >= 0 {
            _ = fcntl(descriptor, F_SETFD, descriptorFlags | FD_CLOEXEC)
        }
        var noSigPipe: Int32 = 1
        _ = setsockopt(
            descriptor,
            SOL_SOCKET,
            SO_NOSIGPIPE,
            &noSigPipe,
            socklen_t(MemoryLayout<Int32>.size)
        )
        guard let registration = cancellation.register(descriptor: descriptor) else {
            Darwin.close(descriptor)
            throw CancellationError()
        }
        defer {
            cancellation.unregister(registration)
            Darwin.close(descriptor)
        }

        let originalFlags = fcntl(descriptor, F_GETFL)
        guard originalFlags >= 0,
              fcntl(descriptor, F_SETFL, originalFlags | O_NONBLOCK) == 0
        else {
            throw CoordinatorError("operational_socket_unavailable")
        }
        let connectDeadline = cancellation.boundedDeadline(
            try deadline(after: connectTimeoutMilliseconds)
        )
        let connectResult = try withSocketAddress { address, length in
            Darwin.connect(descriptor, address, length)
        }
        if connectResult != 0 {
            guard errno == EINPROGRESS else {
                throw CoordinatorError("operational_connect_failed")
            }
            try wait(
                descriptor: descriptor,
                events: Int16(POLLOUT),
                deadline: connectDeadline,
                cancellation: cancellation,
                timeoutCode: "operational_connect_timeout"
            )
            var socketError: Int32 = 0
            var socketErrorLength = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(
                descriptor,
                SOL_SOCKET,
                SO_ERROR,
                &socketError,
                &socketErrorLength
            ) == 0, socketError == 0 else {
                throw CoordinatorError("operational_connect_failed")
            }
        }
        try cancellation.check()
        var peerUserID: uid_t = 0
        var peerGroupID: gid_t = 0
        guard getpeereid(descriptor, &peerUserID, &peerGroupID) == 0,
              peerUserID == geteuid()
        else {
            throw CoordinatorError("operational_peer_rejected")
        }

        let requestID = "request_" + UUID().uuidString.lowercased()
        var requestData = try StrictJSONTransport.data(forJSONObject: [
            "request_id": requestID,
            "type": type,
            "payload": payload,
        ])
        guard requestData.count < Self.maximumMessageBytes else {
            throw CoordinatorError("operational_request_too_large")
        }
        requestData.append(0x0A)
        let responseDeadline = cancellation.boundedDeadline(
            try deadline(after: responseTimeoutMilliseconds)
        )
        try write(
            requestData,
            descriptor: descriptor,
            deadline: responseDeadline,
            cancellation: cancellation
        )
        let responseData = try readLine(
            descriptor: descriptor,
            deadline: responseDeadline,
            cancellation: cancellation
        )
        try cancellation.check()
        let response = try StrictJSONTransport.object(
            from: responseData,
            limits: StrictJSONLimits(
                maximumBytes: Self.maximumMessageBytes,
                maximumDepth: 72
            )
        )
        guard response["request_id"] as? String == requestID,
              let ok = response["ok"] as? Bool
        else {
            throw CoordinatorError("operational_response_invalid")
        }
        if !ok {
            let code = (response["error"] as? [String: Any])?["code"] as? String
            throw CoordinatorError(code ?? "operational_request_failed")
        }
        guard let result = response["result"] as? [String: Any] else {
            throw CoordinatorError("operational_response_invalid")
        }
        return result
    }

    private func withSocketAddress<T>(
        _ operation: (UnsafePointer<sockaddr>, socklen_t) throws -> T
    ) throws -> T {
        var address = sockaddr_un()
        let bytes = Array(socketPath.utf8) + [0]
        guard !socketPath.utf8.contains(0),
              bytes.count <= MemoryLayout.size(ofValue: address.sun_path)
        else {
            throw CoordinatorError("operational_socket_invalid")
        }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { destination in
            destination.copyBytes(from: bytes)
        }
        return try withUnsafePointer(to: &address) { pointer in
            try pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                try operation($0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
    }

    private func deadline(after milliseconds: Int32) throws -> UInt64 {
        let duration = UInt64(max(1, milliseconds)) * 1_000_000
        let (value, overflow) = DispatchTime.now().uptimeNanoseconds
            .addingReportingOverflow(duration)
        guard !overflow else { throw CoordinatorError("operational_response_timeout") }
        return value
    }

    private func wait(
        descriptor: Int32,
        events: Int16,
        deadline: UInt64,
        cancellation: ManagedCodexApprovalCancellation,
        timeoutCode: String
    ) throws {
        while true {
            try cancellation.check()
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline else { throw CoordinatorError(timeoutCode) }
            let remaining = (deadline - now + 999_999) / 1_000_000
            let slice = Int32(min(UInt64(100), max(UInt64(1), remaining)))
            var state = pollfd(fd: descriptor, events: events, revents: 0)
            let result = Darwin.poll(&state, 1, slice)
            if result < 0 {
                if errno == EINTR { continue }
                throw CoordinatorError("operational_transport_failed")
            }
            if result == 0 { continue }
            try cancellation.check()
            if state.revents & events != 0 { return }
            if state.revents & Int16(POLLHUP | POLLERR | POLLNVAL) != 0 {
                throw CoordinatorError("operational_transport_closed")
            }
        }
    }

    private func write(
        _ data: Data,
        descriptor: Int32,
        deadline: UInt64,
        cancellation: ManagedCodexApprovalCancellation
    ) throws {
        try data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var offset = 0
            while offset < bytes.count {
                try wait(
                    descriptor: descriptor,
                    events: Int16(POLLOUT),
                    deadline: deadline,
                    cancellation: cancellation,
                    timeoutCode: "operational_response_timeout"
                )
                let count = Darwin.write(
                    descriptor,
                    baseAddress.advanced(by: offset),
                    bytes.count - offset
                )
                if count < 0 && (
                    errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK
                ) { continue }
                guard count > 0 else {
                    throw CoordinatorError("operational_transport_closed")
                }
                offset += count
            }
        }
    }

    private func readLine(
        descriptor: Int32,
        deadline: UInt64,
        cancellation: ManagedCodexApprovalCancellation
    ) throws -> Data {
        var data = Data()
        var bytes = [UInt8](repeating: 0, count: 16_384)
        while true {
            try wait(
                descriptor: descriptor,
                events: Int16(POLLIN),
                deadline: deadline,
                cancellation: cancellation,
                timeoutCode: "operational_response_timeout"
            )
            let count = bytes.withUnsafeMutableBytes { buffer in
                Darwin.read(descriptor, buffer.baseAddress, buffer.count)
            }
            if count < 0 && (
                errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK
            ) { continue }
            guard count > 0 else {
                throw CoordinatorError("operational_transport_closed")
            }
            data.append(contentsOf: bytes[0..<count])
            guard data.count <= Self.maximumMessageBytes else {
                throw CoordinatorError("operational_message_too_large")
            }
            if let newline = data.firstIndex(of: 0x0A) {
                let line = Data(data[..<newline])
                guard newline == data.index(before: data.endIndex) else {
                    throw CoordinatorError("operational_message_invalid")
                }
                return line
            }
        }
    }
}
