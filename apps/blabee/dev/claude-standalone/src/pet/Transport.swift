import Foundation
import Darwin

struct DecisionOption: Decodable, Equatable, Sendable {
    let id: String
    let title: String
    let description: String
    let task: String
    let done_when: String
}

struct DecisionPacket: Decodable, Equatable, Sendable {
    let packet_id: String
    let revision: Int
    let summary: String
    let options: [DecisionOption]
}

struct DecisionSelection: Decodable, Equatable, Sendable {
    let selection_id: String
    let option_id: String
    let status: String
    let note: String?
}

struct SessionSnapshot: Decodable, Equatable, Sendable {
    let session_id: String
    let cwd: String
    let phase: String
    let prompt_id: String?
    let boundary_id: String?
    let connected: Bool
    let continuation_ready: Bool?
    let packet: DecisionPacket?
    let selection: DecisionSelection?

    var isSelectionReady: Bool {
        phase == "ready" && connected && continuation_ready == true && packet != nil
    }
}

struct PendingPetSelection: Sendable {
    let sessionID: String
    let packetID: String
    var selectionID: String?

    func isInvalidated(by session: SessionSnapshot) -> Bool {
        guard let selectionID else { return false }
        return session.session_id == sessionID && session.packet?.packet_id == packetID
            && session.selection?.selection_id == selectionID && session.selection?.status == "invalidated"
    }

    func blocks(_ session: SessionSnapshot) -> Bool {
        session.session_id == sessionID && session.packet?.packet_id == packetID && !isInvalidated(by: session)
    }
}

private struct IPCRequest: Encodable {
    let `protocol` = "blabee-claude.v1"
    let provider = "claude"
    let type: String
    let auth: String?
    let payload: [String: IPCValue]
}

private enum IPCValue: Encodable {
    case string(String), integer(Int)
    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .integer(let value): try container.encode(value)
        }
    }
}

private struct IPCError: Decodable {
    let code: String
    let message: String
}

private struct IPCResponse<T: Decodable>: Decodable {
    let ok: Bool
    let result: T?
    let error: IPCError?
}

private struct Health: Decodable {
    let product: String
    let provider: String
    let `protocol`: String
    let version: Int
}

private struct SessionList: Decodable { let sessions: [SessionSnapshot] }
private struct SelectionReceipt: Decodable {
    let selection_id: String
    let status: String
}

/// An immutable client used exclusively off the AppKit thread.
final class CoordinatorClient: Sendable {
    private let socketPath: String
    private let token: String
    private let maximumBytes = 128 * 1024
    private let timeout: TimeInterval = 4

    init(runtime: String, token: String) {
        socketPath = runtime + "/blabee-claude.sock"
        self.token = token
    }

    func list() throws -> [SessionSnapshot] {
        try verifyIdentity()
        let result: SessionList = try request(type: "ui.list")
        return result.sessions
    }

    private func verifyIdentity() throws {
        let health: Health = try request(type: "health", authenticated: false)
        guard health.product == "blabee-claude", health.provider == "claude",
              health.protocol == "blabee-claude.v1", health.version == 1 else {
            throw PetFailure.invalid("The socket does not identify a compatible Blabee Claude coordinator.")
        }
    }

    @discardableResult
    func select(session: String, packet: String, revision: Int, option: String) throws -> String {
        try verifyIdentity()
        let receipt: SelectionReceipt = try request(type: "ui.select", payload: [
            "session_id": .string(session), "packet_id": .string(packet),
            "revision": .integer(revision), "option_id": .string(option)
        ])
        guard UUID(uuidString: receipt.selection_id) != nil, receipt.status == "selected" else {
            throw PetFailure.invalid("The coordinator did not return a valid selection receipt.")
        }
        return receipt.selection_id
    }

    private func request<T: Decodable>(type: String, authenticated: Bool = true,
                                       payload: [String: IPCValue] = [:]) throws -> T {
        var bytes = try JSONEncoder().encode(IPCRequest(type: type, auth: authenticated ? token : nil, payload: payload))
        bytes.append(0x0a)
        guard bytes.count <= maximumBytes else { throw PetFailure.invalid("Coordinator request exceeds 128 KiB.") }
        let received = try exchange(bytes)
        let envelope = try JSONDecoder().decode(IPCResponse<T>.self, from: received)
        guard envelope.ok, let result = envelope.result else {
            // The token is never interpolated into diagnostics.
            let message = envelope.error.map { "\($0.code): \($0.message)" } ?? "Invalid coordinator response."
            throw PetFailure.invalid(message.replacingOccurrences(of: token, with: "[redacted]"))
        }
        return result
    }

    private func exchange(_ request: Data) throws -> Data {
        var info = stat()
        guard lstat(socketPath, &info) == 0 else { throw PetFailure.system("Connect to Claude coordinator", errno) }
        guard (info.st_mode & S_IFMT) == S_IFSOCK, info.st_uid == geteuid(),
              (info.st_mode & 0o077) == 0 else {
            throw PetFailure.invalid("Claude coordinator socket must be private and owned by this user.")
        }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(socketPath.utf8) + [0]
        guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            throw PetFailure.invalid("Claude runtime path is too long for a Unix socket.")
        }
        withUnsafeMutableBytes(of: &address.sun_path) { target in target.copyBytes(from: pathBytes) }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw PetFailure.system("Create Claude socket", errno) }
        defer { close(fd) }
        guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { throw PetFailure.system("Configure Claude socket", errno) }
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        var enabled: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &enabled, socklen_t(MemoryLayout<Int32>.size))
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        let connection = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if connection != 0 {
            guard errno == EINPROGRESS else { throw PetFailure.system("Connect to Claude coordinator", errno) }
            try wait(fd, events: Int16(POLLOUT), deadline: deadline)
            var failure: Int32 = 0
            var length = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(fd, SOL_SOCKET, SO_ERROR, &failure, &length) == 0 else {
                throw PetFailure.system("Check Claude connection", errno)
            }
            guard failure == 0 else { throw PetFailure.system("Connect to Claude coordinator", failure) }
        }
        var offset = 0
        while offset < request.count {
            try wait(fd, events: Int16(POLLOUT), deadline: deadline)
            let sent = request.withUnsafeBytes { bytes in
                Darwin.send(fd, bytes.baseAddress!.advanced(by: offset), request.count - offset, 0)
            }
            if sent < 0, errno == EAGAIN || errno == EINTR { continue }
            guard sent > 0 else { throw PetFailure.system("Send Claude request", errno) }
            offset += sent
        }
        var response = Data()
        var buffer = [UInt8](repeating: 0, count: 8192)
        while true {
            try wait(fd, events: Int16(POLLIN), deadline: deadline)
            let count = recv(fd, &buffer, buffer.count, 0)
            if count < 0, errno == EAGAIN || errno == EINTR { continue }
            guard count > 0 else { throw PetFailure.invalid("Claude coordinator closed the connection without a complete response.") }
            response.append(contentsOf: buffer.prefix(count))
            guard response.count <= maximumBytes else { throw PetFailure.invalid("Coordinator response exceeds 128 KiB.") }
            if let newline = response.firstIndex(of: 0x0a) { return response.prefix(upTo: newline) }
        }
    }

    private func wait(_ descriptor: Int32, events: Int16, deadline: TimeInterval) throws {
        while true {
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            guard remaining > 0 else { throw PetFailure.invalid("Claude coordinator timed out.") }
            var entry = pollfd(fd: descriptor, events: events, revents: 0)
            let result = poll(&entry, 1, Int32(max(1, remaining * 1000)))
            if result < 0, errno == EINTR { continue }
            guard result >= 0 else { throw PetFailure.system("Wait for Claude coordinator", errno) }
            if result == 0 { throw PetFailure.invalid("Claude coordinator timed out.") }
            if entry.revents & events != 0 { return }
            if entry.revents & Int16(POLLERR | POLLHUP | POLLNVAL) != 0 {
                throw PetFailure.invalid("Claude coordinator connection ended.")
            }
        }
    }
}
