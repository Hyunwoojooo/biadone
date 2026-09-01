import CoordinatorSwift
import Darwin
import CryptoKit
import Dispatch
import Foundation

enum ManagedCodexTransportLimits {
    // Keep the boundary adapter aligned with the qualified Codex 0.149.1 and
    // 0.150.1 remote TUI transports.
    // Approval parsing remains separately bounded to the much smaller
    // contract envelope limit; oversized approval requests fail open to the
    // official Codex UI instead of being decoded by Blabee.
    static let maximumMessageBytes = 128 * 1024 * 1024
}

enum ManagedCodexWebSocketError: Error, Equatable, CustomStringConvertible {
    case acceptTimedOut
    case authenticationFailed
    case connectionClosed
    case invalidHandshake
    case invalidFrame
    case messageTooLarge
    case writeTimedOut
    case socketFailure(String)

    var description: String {
        switch self {
        case .acceptTimedOut: return "the managed Codex WebSocket connection timed out"
        case .authenticationFailed: return "the managed Codex WebSocket token was rejected"
        case .connectionClosed: return "the managed Codex WebSocket connection closed"
        case .invalidHandshake: return "the managed Codex WebSocket handshake is invalid"
        case .invalidFrame: return "the managed Codex WebSocket frame is invalid"
        case .messageTooLarge: return "the managed Codex WebSocket message is too large"
        case .writeTimedOut: return "the managed Codex WebSocket write timed out"
        case .socketFailure(let operation):
            return "the managed Codex WebSocket socket failed during \(operation)"
        }
    }
}

func managedCodexCoordinatorError(_ error: Error) -> CoordinatorError {
    if let error = error as? CoordinatorError { return error }
    if let error = error as? CodexRuntimeTrustError {
        switch error {
        case .changedDuringInspection,
             .changedDuringQualification,
             .approvalDrift:
            return CoordinatorError("managed_codex_executable_changed")
        case .unsupportedVersion:
            return CoordinatorError("managed_codex_version_unsupported")
        case .invalidRecord,
             .invalidSource,
             .unsafePath,
             .dynamicShim:
            return CoordinatorError("managed_codex_executable_unsafe")
        }
    }
    guard let error = error as? ManagedCodexWebSocketError else {
        return error.coordinatorError
    }
    let code: String
    switch error {
    case .acceptTimedOut:
        code = "managed_codex_websocket_accept_timeout"
    case .authenticationFailed:
        code = "managed_codex_websocket_authentication_failed"
    case .connectionClosed:
        code = "managed_codex_websocket_connection_closed"
    case .invalidHandshake:
        code = "managed_codex_websocket_invalid_handshake"
    case .invalidFrame:
        code = "managed_codex_websocket_invalid_frame"
    case .messageTooLarge:
        code = "managed_codex_websocket_message_too_large"
    case .writeTimedOut:
        code = "managed_codex_websocket_write_timeout"
    case .socketFailure:
        code = "managed_codex_websocket_socket_failure"
    }
    return CoordinatorError(code)
}

enum ManagedCodexWebSocketInboundEvent: Equatable {
    case text(Data)
    case ping(Data)
    case pong(Data)
    case close(Data)
}

struct ManagedCodexWebSocketFrameParser {
    static let maximumMessageBytes = ManagedCodexTransportLimits.maximumMessageBytes

    private var buffer: [UInt8] = []
    private var fragmentedPayload = Data()
    private var fragmentedOpcode: UInt8?

    mutating func append(_ data: Data) throws -> [ManagedCodexWebSocketInboundEvent] {
        guard buffer.count <= Self.maximumMessageBytes + 14 else {
            throw ManagedCodexWebSocketError.messageTooLarge
        }
        buffer.append(contentsOf: data)
        var events: [ManagedCodexWebSocketInboundEvent] = []
        while let frame = try parseFrame() {
            if let event = try consume(frame) {
                events.append(event)
            }
        }
        return events
    }

    private mutating func parseFrame() throws -> (fin: Bool, opcode: UInt8, payload: Data)? {
        guard buffer.count >= 2 else { return nil }
        let first = buffer[0]
        let second = buffer[1]
        guard first & 0x70 == 0, second & 0x80 != 0 else {
            throw ManagedCodexWebSocketError.invalidFrame
        }
        let fin = first & 0x80 != 0
        let opcode = first & 0x0F
        var headerCount = 2
        var payloadLength = UInt64(second & 0x7F)
        if payloadLength == 126 {
            guard buffer.count >= 4 else { return nil }
            payloadLength = UInt64(buffer[2]) << 8 | UInt64(buffer[3])
            guard payloadLength >= 126 else {
                throw ManagedCodexWebSocketError.invalidFrame
            }
            headerCount = 4
        } else if payloadLength == 127 {
            guard buffer.count >= 10 else { return nil }
            guard buffer[2] & 0x80 == 0 else {
                throw ManagedCodexWebSocketError.invalidFrame
            }
            payloadLength = 0
            for byte in buffer[2..<10] {
                payloadLength = payloadLength << 8 | UInt64(byte)
            }
            guard payloadLength >= 65_536 else {
                throw ManagedCodexWebSocketError.invalidFrame
            }
            headerCount = 10
        }
        let isControl = opcode & 0x08 != 0
        guard !isControl || (fin && payloadLength <= 125) else {
            throw ManagedCodexWebSocketError.invalidFrame
        }
        guard payloadLength <= UInt64(Self.maximumMessageBytes),
              payloadLength <= UInt64(Int.max)
        else {
            throw ManagedCodexWebSocketError.messageTooLarge
        }
        let totalHeaderCount = headerCount + 4
        let payloadCount = Int(payloadLength)
        guard buffer.count >= totalHeaderCount + payloadCount else { return nil }

        let mask = Array(buffer[headerCount..<totalHeaderCount])
        var payload = Data(count: payloadCount)
        payload.withUnsafeMutableBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
                return
            }
            for index in 0..<payloadCount {
                base[index] = buffer[totalHeaderCount + index] ^ mask[index % 4]
            }
        }
        buffer.removeFirst(totalHeaderCount + payloadCount)
        return (fin, opcode, payload)
    }

    private mutating func consume(
        _ frame: (fin: Bool, opcode: UInt8, payload: Data)
    ) throws -> ManagedCodexWebSocketInboundEvent? {
        switch frame.opcode {
        case 0x0:
            guard fragmentedOpcode == 0x1 else {
                throw ManagedCodexWebSocketError.invalidFrame
            }
            guard fragmentedPayload.count <= Self.maximumMessageBytes - frame.payload.count else {
                throw ManagedCodexWebSocketError.messageTooLarge
            }
            fragmentedPayload.append(frame.payload)
            guard frame.fin else { return nil }
            let complete = fragmentedPayload
            fragmentedPayload.removeAll(keepingCapacity: false)
            fragmentedOpcode = nil
            try requireUTF8(complete)
            return .text(complete)
        case 0x1:
            guard fragmentedOpcode == nil else {
                throw ManagedCodexWebSocketError.invalidFrame
            }
            if frame.fin {
                try requireUTF8(frame.payload)
                return .text(frame.payload)
            }
            fragmentedOpcode = 0x1
            fragmentedPayload = frame.payload
            return nil
        case 0x8:
            guard frame.payload.count != 1 else {
                throw ManagedCodexWebSocketError.invalidFrame
            }
            if frame.payload.count > 2 {
                try requireUTF8(frame.payload.dropFirst(2))
            }
            return .close(frame.payload)
        case 0x9: return .ping(frame.payload)
        case 0xA: return .pong(frame.payload)
        default:
            // Codex App Server transports JSON-RPC as WebSocket text messages.
            // Binary and extension opcodes are deliberately unsupported.
            throw ManagedCodexWebSocketError.invalidFrame
        }
    }

    private func requireUTF8<T: DataProtocol>(_ data: T) throws {
        guard String(data: Data(data), encoding: .utf8) != nil else {
            throw ManagedCodexWebSocketError.invalidFrame
        }
    }
}

enum ManagedCodexWebSocketFrameEncoder {
    static func serverFrame(opcode: UInt8, payload: Data, fin: Bool = true) throws -> Data {
        guard opcode <= 0x0F,
              payload.count <= ManagedCodexWebSocketFrameParser.maximumMessageBytes
        else {
            throw ManagedCodexWebSocketError.messageTooLarge
        }
        var frame = Data([((fin ? 0x80 : 0x00) | opcode)])
        if payload.count <= 125 {
            frame.append(UInt8(payload.count))
        } else if payload.count <= Int(UInt16.max) {
            frame.append(126)
            let length = UInt16(payload.count).bigEndian
            withUnsafeBytes(of: length) { frame.append(contentsOf: $0) }
        } else {
            frame.append(127)
            let length = UInt64(payload.count).bigEndian
            withUnsafeBytes(of: length) { frame.append(contentsOf: $0) }
        }
        frame.append(payload)
        return frame
    }
}

enum ManagedCodexWebSocketHandshake {
    private static let webSocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    static func response(for requestData: Data, expectedToken: String) throws -> Data {
        guard requestData.count <= 16_384,
              requestData.suffix(4) == Data([13, 10, 13, 10]),
              let request = String(data: requestData.dropLast(4), encoding: .utf8)
        else {
            throw ManagedCodexWebSocketError.invalidHandshake
        }
        let lines = request.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            throw ManagedCodexWebSocketError.invalidHandshake
        }
        let requestParts = requestLine.split(separator: " ", omittingEmptySubsequences: false)
        guard requestParts.count == 3,
              requestParts[0] == "GET",
              !requestParts[1].isEmpty,
              requestParts[2] == "HTTP/1.1"
        else {
            throw ManagedCodexWebSocketError.invalidHandshake
        }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else {
                throw ManagedCodexWebSocketError.invalidHandshake
            }
            let name = line[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: separator)...]
                .trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty, headers[name] == nil else {
                throw ManagedCodexWebSocketError.invalidHandshake
            }
            headers[name] = value
        }
        guard headers["upgrade"]?.lowercased() == "websocket",
              headerTokens(headers["connection"]).contains("upgrade"),
              headers["sec-websocket-version"] == "13",
              let key = headers["sec-websocket-key"],
              Data(base64Encoded: key)?.count == 16
        else {
            throw ManagedCodexWebSocketError.invalidHandshake
        }
        guard let authorization = headers["authorization"],
              authorization.hasPrefix("Bearer "),
              secureEquals(String(authorization.dropFirst(7)), expectedToken)
        else {
            throw ManagedCodexWebSocketError.authenticationFailed
        }
        let digest = Data(Insecure.SHA1.hash(data: Data((key + webSocketGUID).utf8)))
            .base64EncodedString()
        return Data((
            "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: \(digest)\r\n\r\n"
        ).utf8)
    }

    private static func headerTokens(_ value: String?) -> Set<String> {
        Set((value ?? "").split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespaces).lowercased()
        })
    }

    private static func secureEquals(_ lhs: String, _ rhs: String) -> Bool {
        let left = Array(lhs.utf8)
        let right = Array(rhs.utf8)
        guard left.count == right.count else { return false }
        var difference: UInt8 = 0
        for index in left.indices {
            difference |= left[index] ^ right[index]
        }
        return difference == 0
    }
}

final class ManagedCodexWebSocketConnection: @unchecked Sendable {
    let connectionID: String

    private let descriptor: Int32
    private let sendLock = NSLock()
    private let closeLock = NSLock()
    private var closed = false

    fileprivate init(descriptor: Int32, connectionID: String) {
        self.descriptor = descriptor
        self.connectionID = connectionID
        managedCodexSetCloseOnExec(descriptor)
        managedCodexSetNoSigPipe(descriptor)
    }

    deinit { close() }

    func readMessages(_ handler: (Data) throws -> Void) throws {
        var parser = ManagedCodexWebSocketFrameParser()
        var bytes = [UInt8](repeating: 0, count: 16_384)
        while true {
            if isClosed { return }
            var item = pollfd(
                fd: descriptor,
                events: Int16(POLLIN | POLLHUP | POLLERR),
                revents: 0
            )
            let pollResult = Darwin.poll(&item, 1, 200)
            if pollResult < 0 {
                if errno == EINTR { continue }
                if isClosed { return }
                throw ManagedCodexWebSocketError.socketFailure("read_poll")
            }
            if pollResult == 0 { continue }
            if item.revents & Int16(POLLNVAL) != 0 {
                if isClosed { return }
                throw ManagedCodexWebSocketError.socketFailure("read_poll")
            }
            let count = bytes.withUnsafeMutableBytes { buffer in
                Darwin.read(descriptor, buffer.baseAddress, buffer.count)
            }
            if count == 0 { return }
            if count < 0 {
                if errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK {
                    continue
                }
                if isClosed { return }
                throw ManagedCodexWebSocketError.socketFailure("read")
            }
            let events = try parser.append(Data(bytes[0..<count]))
            for event in events {
                switch event {
                case .text(let payload): try handler(payload)
                case .ping(let payload): try send(opcode: 0xA, payload: payload)
                case .pong: continue
                case .close(let payload):
                    try? send(opcode: 0x8, payload: payload)
                    return
                }
            }
        }
    }

    func sendText(_ data: Data) throws {
        try send(opcode: 0x1, payload: data)
    }

    func close() {
        closeLock.lock()
        guard !closed else {
            closeLock.unlock()
            return
        }
        closed = true
        closeLock.unlock()

        // `shutdown` is deliberately performed before waiting for the writer
        // lock. It wakes a blocked read/write immediately; the descriptor is
        // closed only after the in-flight writer has released its ownership.
        _ = shutdown(descriptor, SHUT_RDWR)
        sendLock.lock()
        Darwin.close(descriptor)
        sendLock.unlock()
    }

    private var isClosed: Bool {
        closeLock.lock()
        defer { closeLock.unlock() }
        return closed
    }

    private func send(opcode: UInt8, payload: Data) throws {
        let frame = try ManagedCodexWebSocketFrameEncoder.serverFrame(
            opcode: opcode,
            payload: payload
        )
        sendLock.lock()
        defer { sendLock.unlock() }
        guard !isClosed else {
            throw ManagedCodexWebSocketError.connectionClosed
        }
        try managedCodexWriteAll(frame, descriptor: descriptor)
    }
}

final class ManagedCodexWebSocketListener: @unchecked Sendable {
    let port: UInt16

    private let descriptor: Int32
    private let expectedToken: String
    private let closeLock = NSLock()
    private var closed = false

    init(expectedToken: String) throws {
        guard !expectedToken.isEmpty else {
            throw ManagedCodexWebSocketError.authenticationFailed
        }
        self.expectedToken = expectedToken
        let listenerDescriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard listenerDescriptor >= 0 else {
            throw ManagedCodexWebSocketError.socketFailure("socket")
        }
        descriptor = listenerDescriptor
        managedCodexSetCloseOnExec(listenerDescriptor)
        managedCodexSetNoSigPipe(listenerDescriptor)
        var reuse: Int32 = 1
        _ = setsockopt(
            listenerDescriptor,
            SOL_SOCKET,
            SO_REUSEADDR,
            &reuse,
            socklen_t(MemoryLayout<Int32>.size)
        )
        do {
            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = 0
            address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
            let bindResult = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(
                        listenerDescriptor,
                        $0,
                        socklen_t(MemoryLayout<sockaddr_in>.size)
                    )
                }
            }
            guard bindResult == 0 else {
                throw ManagedCodexWebSocketError.socketFailure("bind")
            }
            guard listen(listenerDescriptor, 1) == 0 else {
                throw ManagedCodexWebSocketError.socketFailure("listen")
            }
            var boundAddress = sockaddr_in()
            var boundLength = socklen_t(MemoryLayout<sockaddr_in>.size)
            let nameResult = withUnsafeMutablePointer(to: &boundAddress) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    getsockname(listenerDescriptor, $0, &boundLength)
                }
            }
            guard nameResult == 0,
                  boundAddress.sin_addr.s_addr == inet_addr("127.0.0.1")
            else {
                throw ManagedCodexWebSocketError.socketFailure("getsockname")
            }
            port = UInt16(bigEndian: boundAddress.sin_port)
        } catch {
            Darwin.close(listenerDescriptor)
            throw error
        }
    }

    deinit { close() }

    func accept(
        timeoutMilliseconds: Int32 = 15_000,
        handshakeTimeoutMilliseconds: Int32 = 5_000
    ) throws -> ManagedCodexWebSocketConnection {
        var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        var pollResult: Int32
        repeat {
            pollResult = poll(&pollDescriptor, 1, timeoutMilliseconds)
        } while pollResult < 0 && errno == EINTR
        guard pollResult > 0 else {
            if pollResult == 0 { throw ManagedCodexWebSocketError.acceptTimedOut }
            throw ManagedCodexWebSocketError.socketFailure("poll")
        }
        var peerAddress = sockaddr_in()
        var peerLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let accepted = withUnsafeMutablePointer(to: &peerAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.accept(descriptor, $0, &peerLength)
            }
        }
        guard accepted >= 0,
              peerAddress.sin_family == sa_family_t(AF_INET),
              peerAddress.sin_addr.s_addr == inet_addr("127.0.0.1")
        else {
            if accepted >= 0 { Darwin.close(accepted) }
            throw ManagedCodexWebSocketError.socketFailure("accept")
        }
        managedCodexSetCloseOnExec(accepted)
        managedCodexSetNoSigPipe(accepted)
        do {
            let request = try managedCodexReadHTTPHeaders(
                descriptor: accepted,
                maximumBytes: 16_384,
                timeoutMilliseconds: handshakeTimeoutMilliseconds
            )
            let response = try ManagedCodexWebSocketHandshake.response(
                for: request,
                expectedToken: expectedToken
            )
            try managedCodexWriteAll(response, descriptor: accepted)
            return ManagedCodexWebSocketConnection(
                descriptor: accepted,
                connectionID: UUID().uuidString.lowercased()
            )
        } catch {
            Darwin.close(accepted)
            throw error
        }
    }

    func close() {
        closeLock.lock()
        defer { closeLock.unlock() }
        guard !closed else { return }
        closed = true
        _ = shutdown(descriptor, SHUT_RDWR)
        Darwin.close(descriptor)
    }
}

private func managedCodexReadHTTPHeaders(
    descriptor: Int32,
    maximumBytes: Int,
    timeoutMilliseconds: Int32
) throws -> Data {
    var result = Data()
    var byte: UInt8 = 0
    let deadline = DispatchTime.now().uptimeNanoseconds
        + UInt64(max(1, timeoutMilliseconds)) * 1_000_000
    while result.count < maximumBytes {
        let now = DispatchTime.now().uptimeNanoseconds
        guard now < deadline else {
            throw ManagedCodexWebSocketError.invalidHandshake
        }
        let remainingMilliseconds = max(
            1,
            Int32(min((deadline - now) / 1_000_000, UInt64(Int32.max)))
        )
        var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
        let pollResult = poll(&pollDescriptor, 1, remainingMilliseconds)
        if pollResult < 0 && errno == EINTR { continue }
        guard pollResult > 0 else {
            throw ManagedCodexWebSocketError.invalidHandshake
        }
        let count = Darwin.read(descriptor, &byte, 1)
        if count < 0 && errno == EINTR { continue }
        guard count == 1 else {
            throw ManagedCodexWebSocketError.invalidHandshake
        }
        result.append(byte)
        if result.count >= 4, result.suffix(4) == Data([13, 10, 13, 10]) {
            return result
        }
    }
    throw ManagedCodexWebSocketError.invalidHandshake
}

func managedCodexWriteAll(
    _ data: Data,
    descriptor: Int32,
    timeoutMilliseconds: Int32 = 5_000
) throws {
    let flags = fcntl(descriptor, F_GETFL)
    guard flags >= 0,
          flags & O_NONBLOCK != 0
            || fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0
    else {
        throw ManagedCodexWebSocketError.socketFailure("write_nonblocking")
    }
    let now = DispatchTime.now().uptimeNanoseconds
    let duration = UInt64(max(1, timeoutMilliseconds)) * 1_000_000
    let (deadline, overflow) = now.addingReportingOverflow(duration)
    guard !overflow else { throw ManagedCodexWebSocketError.writeTimedOut }
    try data.withUnsafeBytes { rawBuffer in
        guard let baseAddress = rawBuffer.baseAddress else { return }
        var offset = 0
        while offset < rawBuffer.count {
            let current = DispatchTime.now().uptimeNanoseconds
            guard current < deadline else {
                throw ManagedCodexWebSocketError.writeTimedOut
            }
            let remainingNanoseconds = deadline - current
            let remainingMilliseconds = Int32(min(
                UInt64(Int32.max),
                max(1, (remainingNanoseconds + 999_999) / 1_000_000)
            ))
            var pollDescriptor = pollfd(
                fd: descriptor,
                events: Int16(POLLOUT),
                revents: 0
            )
            let pollResult = Darwin.poll(
                &pollDescriptor,
                1,
                remainingMilliseconds
            )
            if pollResult < 0 {
                if errno == EINTR { continue }
                throw ManagedCodexWebSocketError.socketFailure("write_poll")
            }
            guard pollResult > 0 else {
                throw ManagedCodexWebSocketError.writeTimedOut
            }
            if pollDescriptor.revents & Int16(POLLERR | POLLHUP | POLLNVAL) != 0 {
                throw ManagedCodexWebSocketError.connectionClosed
            }
            guard pollDescriptor.revents & Int16(POLLOUT) != 0 else { continue }
            let count = Darwin.send(
                descriptor,
                baseAddress.advanced(by: offset),
                rawBuffer.count - offset,
                MSG_DONTWAIT
            )
            if count < 0 && (
                errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK
            ) { continue }
            guard count > 0 else {
                throw ManagedCodexWebSocketError.socketFailure("write")
            }
            offset += count
        }
    }
}

private func managedCodexSetCloseOnExec(_ descriptor: Int32) {
    let flags = fcntl(descriptor, F_GETFD)
    if flags >= 0 { _ = fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC) }
}

private func managedCodexSetNoSigPipe(_ descriptor: Int32) {
    var enabled: Int32 = 1
    _ = setsockopt(
        descriptor,
        SOL_SOCKET,
        SO_NOSIGPIPE,
        &enabled,
        socklen_t(MemoryLayout<Int32>.size)
    )
}
