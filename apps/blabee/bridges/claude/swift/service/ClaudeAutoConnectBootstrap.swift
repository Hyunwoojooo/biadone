import ClaudeCoreAdapter
import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Security

/// Per-launch rendezvous for the real Hook observation and an MCP that may
/// initialize first. A picker has this socket but no owner/service authority.
/// Requests are limited to the pinned Claude process tree and role credential.
final class ClaudeAutoConnectBootstrap: @unchecked Sendable {
    static let schema = "blabee.claude-launch-bootstrap.v1"
    static let maximumFrameBytes = 16 * 1024
    typealias Enroll = @Sendable (ClaudeInstalledOwnerConnection.ObservedSession) throws -> [String: String]

    private struct ProcessIdentity: Equatable {
        let pid: Int32
        let startTime: UInt64
        let parent: Int32
    }
    private enum State {
        case pending
        case starting(UUID)
        case ready(UUID, [String: String])
        case ended
    }
    private struct Request {
        let id: String
        let operation: String
        let role: String
        let token: String
        let nativeSessionID: UUID
        let cwd: String
        let source: String?
    }
    private enum Failure: String, Error {
        case unauthorized = "claude_bootstrap_unauthorized"
        case invalidRequest = "claude_bootstrap_invalid_request"
        case unavailable = "claude_bootstrap_unavailable"
        case sessionChanged = "claude_bootstrap_session_changed"
        case alreadyStarted = "claude_bootstrap_already_started"
    }

    let directory: URL
    let socketPath: String
    private let cwd: String
    private let hookToken: String
    private let bridgeToken: String
    private let enroll: Enroll
    private let available: @Sendable () -> Bool
    private let invalidated: @Sendable () -> Void
    private let lock = NSLock()
    private let acceptQueue = DispatchQueue(label: "com.biadone.blabee.claude-bootstrap.accept")
    private var state: State = .pending
    private var child: ProcessIdentity?
    private var listener: Int32 = -1
    private var listenerSource: (any DispatchSourceRead)?
    private var connections: [UUID: Int32] = [:]
    private var closed = false
    private var directoryFD: Int32 = -1
    private var directoryIdentity: (dev_t, ino_t)?
    private var socketIdentity: (dev_t, ino_t)?

    init(cwd: String, root: URL? = nil, enroll: @escaping Enroll,
         available: @escaping @Sendable () -> Bool, invalidated: @escaping @Sendable () -> Void) throws {
        guard ClaudeCanonicalDirectory.matches(cwd) else { throw Failure.invalidRequest }
        self.cwd = cwd
        self.enroll = enroll
        self.available = available
        self.invalidated = invalidated
        hookToken = try Self.randomToken()
        bridgeToken = try Self.randomToken()
        let base = try ClaudeInstalledLaunchConfiguration.canonicalDirectory(root ?? URL(fileURLWithPath: "/private/tmp"))
        var template = Array(base.appendingPathComponent("bc-auto-XXXXXX").path.utf8CString)
        guard let path = template.withUnsafeMutableBufferPointer({ buffer -> String? in
            guard let value = mkdtemp(buffer.baseAddress!) else { return nil }
            return String(cString: value)
        }) else { throw Failure.unavailable }
        directory = URL(fileURLWithPath: path, isDirectory: true)
        socketPath = directory.appendingPathComponent("b.sock").path
        do {
            directoryFD = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            var directoryInfo = stat()
            guard directoryFD >= 0, fstat(directoryFD, &directoryInfo) == 0,
                  directoryInfo.st_uid == geteuid(), directoryInfo.st_mode & S_IFMT == S_IFDIR,
                  directoryInfo.st_mode & 0o777 == 0o700,
                  socketPath.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else { throw Failure.unavailable }
            directoryIdentity = (directoryInfo.st_dev, directoryInfo.st_ino)
            let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
            guard descriptor >= 0 else { throw Failure.unavailable }
            listener = descriptor
            try ClaudeInstalledOwnerIO.configure(descriptor, socket: true)
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: Array(socketPath.utf8) + [0]) }
            let bound = withUnsafePointer(to: &address) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            guard bound == 0, fchmodat(directoryFD, "b.sock", 0o600, 0) == 0,
                  listen(descriptor, 8) == 0 else { throw Failure.unavailable }
            var socketInfo = stat()
            guard fstatat(directoryFD, "b.sock", &socketInfo, AT_SYMLINK_NOFOLLOW) == 0,
                  socketInfo.st_mode & S_IFMT == S_IFSOCK, socketInfo.st_uid == geteuid(),
                  socketInfo.st_mode & 0o777 == 0o600 else { throw Failure.unavailable }
            socketIdentity = (socketInfo.st_dev, socketInfo.st_ino)
        } catch {
            close()
            throw Failure.unavailable
        }
    }

    deinit { close() }

    var childEnvironment: [String: String] {
        ["BLABEE_CLAUDE_BOOTSTRAP_SOCKET": socketPath, "BLABEE_CLAUDE_BOOTSTRAP_CWD": cwd,
         "BLABEE_CLAUDE_BOOTSTRAP_HOOK_TOKEN": hookToken, "BLABEE_CLAUDE_BOOTSTRAP_BRIDGE_TOKEN": bridgeToken]
    }

    /// Called only after the supervisor owns a suspended direct child, before
    /// the child can run Hooks. PID reuse is checked with the kernel start time.
    func activate(childPID: Int32) throws {
        let identity = try Self.process(childPID)
        try lock.withLock {
            guard !closed, child == nil, listener >= 0 else { throw Failure.unavailable }
            child = identity
            let source = DispatchSource.makeReadSource(fileDescriptor: listener, queue: acceptQueue)
            let descriptor = listener
            source.setEventHandler { [weak self] in self?.acceptReady() }
            source.setCancelHandler { Darwin.close(descriptor) }
            listenerSource = source
            source.resume()
        }
    }

    /// Does not await a stalled peer or enrollment. Shutdown interrupts every
    /// accepted reader; a late enrollment result is rejected by the lifetime.
    func close() {
        let directoryDescriptor: Int32 = lock.withLock {
            guard !closed else { return -1 }
            closed = true
            state = .ended
            if listener >= 0 {
                _ = shutdown(listener, SHUT_RDWR)
                if let listenerSource { listenerSource.cancel() }
                else { Darwin.close(listener) }
            }
            listenerSource = nil
            for descriptor in connections.values { _ = shutdown(descriptor, SHUT_RDWR) }
            let value = directoryFD
            listener = -1; directoryFD = -1
            return value
        }
        if directoryDescriptor >= 0 {
            var info = stat()
            if let expected = socketIdentity,
               fstatat(directoryDescriptor, "b.sock", &info, AT_SYMLINK_NOFOLLOW) == 0,
               info.st_dev == expected.0, info.st_ino == expected.1 {
                _ = unlinkat(directoryDescriptor, "b.sock", 0)
            }
            Darwin.close(directoryDescriptor)
        }
        var info = stat()
        if let expected = directoryIdentity, lstat(directory.path, &info) == 0,
           info.st_dev == expected.0, info.st_ino == expected.1 { _ = rmdir(directory.path) }
    }

    private func acceptReady() {
        while true {
            let accepted: (UUID, Int32)? = lock.withLock {
                guard !closed, listener >= 0, child != nil else { return nil }
                let descriptor = Darwin.accept(listener, nil, nil)
                guard descriptor >= 0 else { return nil }
                guard connections.count < 8 else { Darwin.close(descriptor); return nil }
                let id = UUID()
                connections[id] = descriptor
                return (id, descriptor)
            }
            guard let (id, descriptor) = accepted else { return }
            DispatchQueue.global(qos: .utility).async { [self] in
                defer {
                    lock.withLock { connections[id] = nil; Darwin.close(descriptor) }
                }
                handle(descriptor)
            }
        }
    }

    private func handle(_ descriptor: Int32) {
        var requestID: String?
        do {
            try ClaudeInstalledOwnerIO.configure(descriptor, socket: true)
            let peer = try verifiedPeer(descriptor)
            let deadline = try ClaudeInstalledOwnerIO.deadline()
            let data = try ClaudeInstalledOwnerIO.readFrame(descriptor, deadline: deadline,
                                                            maximumBytes: Self.maximumFrameBytes)
            let object = try StrictJSONTransport.object(from: data,
                limits: StrictJSONLimits(maximumBytes: Self.maximumFrameBytes, maximumDepth: 4))
            if let id = object["request_id"] as? String, Self.uuid(id) != nil { requestID = id }
            let request = try Self.request(object)
            guard try verifiedPeer(descriptor) == peer else { throw Failure.unauthorized }
            let response = try perform(request)
            guard try verifiedPeer(descriptor) == peer else { throw Failure.unauthorized }
            try ClaudeInstalledOwnerIO.sendFrame(response, descriptor: descriptor, passing: nil,
                                                 deadline: ClaudeInstalledOwnerIO.deadline())
        } catch {
            guard let requestID else { return }
            let failure = error as? Failure ?? .unavailable
            if failure == .sessionChanged || failure == .alreadyStarted { invalidate() }
            let object: [String: Any] = ["schema_version": Self.schema, "request_id": requestID,
                                       "ok": false, "error": ["code": failure.rawValue]]
            if let data = try? StrictJSONTransport.data(forJSONObject: object) {
                try? ClaudeInstalledOwnerIO.sendFrame(data, descriptor: descriptor, passing: nil,
                                                      deadline: ClaudeInstalledOwnerIO.deadline())
            }
        }
    }

    private func perform(_ request: Request) throws -> Data {
        guard Self.equal(request.token, request.role == "hook" ? hookToken : bridgeToken) else { throw Failure.unauthorized }
        if request.operation == "start", request.role != "hook" { throw Failure.unauthorized }
        let initial: [String: String]? = try lock.withLock {
            guard !closed else { throw Failure.unavailable }
            guard request.cwd == cwd else { throw Failure.sessionChanged }
            switch state {
            case .ended: throw Failure.unavailable
            case .pending:
                if request.operation == "start" { state = .starting(request.nativeSessionID) }
                return nil
            case .starting(let native), .ready(let native, _):
                guard native == request.nativeSessionID else { throw Failure.sessionChanged }
                guard request.operation != "start" else { throw Failure.alreadyStarted }
                if case .ready(_, let environment) = state { return environment }
                return nil
            }
        }
        if request.operation == "start" {
            do {
                let observation = ClaudeInstalledOwnerConnection.ObservedSession(nativeSessionID: request.nativeSessionID,
                                                                                  source: request.source!)
                let environment = try enroll(observation)
                try Self.requireEnvironment(environment, nativeSessionID: request.nativeSessionID, cwd: cwd)
                try lock.withLock {
                    guard !closed, case .starting(let native) = state, native == request.nativeSessionID,
                          available() else { throw Failure.unavailable }
                    state = .ready(native, environment)
                }
                return try response(request, environment: environment)
            } catch {
                invalidate()
                throw Failure.unavailable
            }
        }
        if initial != nil, !available() { invalidate(); throw Failure.unavailable }
        return try response(request, environment: initial)
    }

    private func response(_ request: Request, environment: [String: String]?) throws -> Data {
        var object: [String: Any] = ["schema_version": Self.schema, "request_id": request.id,
                                   "ok": true, "status": environment == nil ? "pending" : "ready"]
        if var environment {
            let prefix = ClaudeInstalledLaunchConfiguration.prefix
            environment[prefix + (request.role == "hook" ? "BRIDGE_TOKEN" : "HOOK_TOKEN")] = nil
            object["environment"] = environment
        }
        return try StrictJSONTransport.data(forJSONObject: object)
    }

    private func invalidate() {
        let notify = lock.withLock {
            if case .ended = state { return false }
            state = .ended
            return true
        }
        if notify { invalidated() }
    }

    private func verifiedPeer(_ descriptor: Int32) throws -> ProcessIdentity {
        let expected = try lock.withLock { () throws -> ProcessIdentity in
            guard !closed, let child else { throw Failure.unauthorized }
            return child
        }
        var uid: uid_t = 0, gid: gid_t = 0, pid: Int32 = 0
        var size = socklen_t(MemoryLayout<Int32>.size)
        guard getpeereid(descriptor, &uid, &gid) == 0, uid == geteuid(),
              getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0,
              size == MemoryLayout<Int32>.size else { throw Failure.unauthorized }
        let peer = try Self.process(pid)
        var current = peer
        var visited: Set<Int32> = []
        for _ in 0..<128 {
            guard visited.insert(current.pid).inserted else { throw Failure.unauthorized }
            if current.pid == expected.pid {
                guard current.startTime == expected.startTime,
                      try Self.process(peer.pid) == peer,
                      try Self.process(expected.pid).startTime == expected.startTime else { throw Failure.unauthorized }
                return peer
            }
            guard current.parent > 1, current.parent != current.pid else { throw Failure.unauthorized }
            current = try Self.process(current.parent)
        }
        throw Failure.unauthorized
    }

    private static func process(_ pid: Int32) throws -> ProcessIdentity {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
        guard pid > 1, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
              info.pbi_pid == UInt32(pid), info.pbi_uid == geteuid(), info.pbi_status != UInt32(SZOMB),
              info.pbi_start_tvusec < 1_000_000 else { throw Failure.unauthorized }
        let (seconds, overflow) = info.pbi_start_tvsec.multipliedReportingOverflow(by: 1_000_000)
        let (time, additionOverflow) = seconds.addingReportingOverflow(info.pbi_start_tvusec)
        guard !overflow, !additionOverflow, time > 0 else { throw Failure.unauthorized }
        return ProcessIdentity(pid: pid, startTime: time, parent: Int32(info.pbi_ppid))
    }

    private static func request(_ object: [String: Any]) throws -> Request {
        guard let id = object["request_id"] as? String, uuid(id) != nil,
              object["schema_version"] as? String == schema,
              let operation = object["operation"] as? String, ["start", "grant"].contains(operation),
              let role = object["role"] as? String, ["hook", "bridge"].contains(role),
              let token = object["auth_token"] as? String, token.utf8.count == 64,
              token.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let nativeText = object["native_session_id"] as? String, let native = uuid(nativeText),
              let cwd = object["cwd"] as? String, ClaudeCanonicalDirectory.isNormalizedAbsolute(cwd) else {
            throw Failure.invalidRequest
        }
        var keys: Set<String> = ["schema_version", "request_id", "operation", "role", "auth_token", "native_session_id", "cwd"]
        let source = object["source"] as? String
        if operation == "start" {
            keys.insert("source")
            guard let source, ["startup", "resume", "fork"].contains(source) else { throw Failure.invalidRequest }
        }
        guard Set(object.keys) == keys else { throw Failure.invalidRequest }
        return Request(id: id, operation: operation, role: role, token: token, nativeSessionID: native, cwd: cwd, source: source)
    }

    private static func requireEnvironment(_ environment: [String: String], nativeSessionID: UUID, cwd: String) throws {
        let prefix = ClaudeInstalledLaunchConfiguration.prefix
        let expected = Set((ClaudeInstalledLaunchConfiguration.publicEnvironmentNames + ["HOOK_TOKEN", "BRIDGE_TOKEN"]).map { prefix + $0 })
        guard Set(environment.keys) == expected,
              environment[prefix + "NATIVE_SESSION_ID"] == nativeSessionID.uuidString.lowercased(),
              environment[prefix + "CWD"] == cwd else { throw Failure.unavailable }
    }

    private static func uuid(_ text: String) -> UUID? {
        guard let value = UUID(uuidString: text), value.uuidString.lowercased() == text else { return nil }
        return value
    }

    private static func equal(_ lhs: String, _ rhs: String) -> Bool {
        guard lhs.utf8.count == rhs.utf8.count else { return false }
        return zip(lhs.utf8, rhs.utf8).reduce(UInt8(0)) { $0 | ($1.0 ^ $1.1) } == 0
    }

    private static func randomToken() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard bytes.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!) }) == errSecSuccess else {
            throw Failure.unavailable
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
