import CoordinatorSwift
import CryptoKit
import Darwin
import Dispatch
import Foundation

private let operationalMaximumMessageBytes = 1_048_576

protocol CoordinatorOperationalHandling: Sendable {
    func handle(type: String, payload: Data) async throws -> Data
    func processTime() async throws -> [Data]
    func millisecondsUntilNextDeadline() async -> Int32?
}

extension CoordinatorOperationalApplication: CoordinatorOperationalHandling {}

struct OperationalSocketPath {
    static func resolve(
        explicitPath: String?,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> String {
        let candidate: String
        if let explicitPath, !explicitPath.isEmpty {
            candidate = explicitPath
        } else if let configured = environment["BLABEE_SOCKET"], !configured.isEmpty {
            candidate = configured
        } else {
            let userHomePath = environment["HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.path
            candidate = URL(fileURLWithPath: userHomePath, isDirectory: true)
                .appendingPathComponent("Library/Application Support/Blabee/runtime", isDirectory: true)
                .appendingPathComponent("blabee.sock", isDirectory: false)
                .path
        }

        guard candidate.hasPrefix("/") else {
            throw CoordinatorError("operational_socket_invalid", "socket path must be absolute")
        }
        let standardized = URL(fileURLWithPath: candidate).standardizedFileURL.path
        try validateUnixSocketPathLength(standardized)
        return standardized
    }
}

struct UnixDomainSocketClient {
    let socketPath: String

    init(socketPath: String) throws {
        guard socketPath.hasPrefix("/") else {
            throw CoordinatorError("operational_socket_invalid", "socket path must be absolute")
        }
        try validateUnixSocketPathLength(socketPath)
        self.socketPath = socketPath
    }

    func request(
        type: String,
        payload: [String: Any],
        connectTimeoutMilliseconds: Int32,
        responseTimeoutMilliseconds: Int32
    ) throws -> [String: Any] {
        let requestID = "request_" + UUID().uuidString.lowercased()
        let request: [String: Any] = [
            "request_id": requestID,
            "type": type,
            "payload": payload,
        ]
        var requestData = try StrictJSONTransport.data(forJSONObject: request)
        guard requestData.count < operationalMaximumMessageBytes else {
            throw CoordinatorError("operational_request_too_large")
        }
        requestData.append(0x0A)

        let descriptor = try connectUnixSocket(
            at: socketPath,
            timeoutMilliseconds: connectTimeoutMilliseconds,
            verifyFilesystemEntry: true
        )
        defer { close(descriptor) }
        setNoSigPipe(descriptor)
        try writeAll(
            requestData,
            descriptor: descriptor,
            timeoutMilliseconds: responseTimeoutMilliseconds
        )
        let responseData = try readOneLine(
            descriptor: descriptor,
            timeoutMilliseconds: responseTimeoutMilliseconds
        )
        let response = try StrictJSONTransport.object(
            from: responseData,
            limits: StrictJSONLimits(
                maximumBytes: operationalMaximumMessageBytes,
                maximumDepth: 72
            )
        )
        guard response["request_id"] as? String == requestID else {
            throw CoordinatorError("operational_response_invalid")
        }
        guard let ok = response["ok"] as? Bool else {
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
}

final class UnixDomainSocketServer: @unchecked Sendable {
    private static let allowedTypes: Set<String> = [
        "enable_project",
        "session_start",
        "user_prompt_submit",
        "emit_decision",
        "stop",
        "permission_request",
        "pet_snapshot",
        "get_state",
        "focus_interaction",
        "select",
    ]

    private let socketPath: String
    private let lockDescriptor: Int32
    private let admissionGate = ConnectionAdmissionGate(limit: 64)
    private let stateLock = NSLock()
    private var listenerDescriptor: Int32 = -1
    private var socketDevice: dev_t = 0
    private var socketInode: ino_t = 0
    private var stopped = false

    init(socketPath: String) throws {
        guard socketPath.hasPrefix("/") else {
            throw CoordinatorError("operational_socket_invalid", "socket path must be absolute")
        }
        try validateUnixSocketPathLength(socketPath)
        self.socketPath = socketPath

        let socketURL = URL(fileURLWithPath: socketPath, isDirectory: false)
        let parent = socketURL.deletingLastPathComponent()
        let parentDescriptor = try Self.openSecureRuntimeDirectory(parent)
        defer { close(parentDescriptor) }

        let lockName = socketURL.lastPathComponent + ".lock"
        let lease = try Self.openAndAcquireOwnerLease(
            parentDescriptor: parentDescriptor,
            name: lockName
        )
        var leaseOwned = true
        do {
            try Self.prepareSocketEntry(
                parentDescriptor: parentDescriptor,
                name: socketURL.lastPathComponent,
                fullPath: socketPath
            )
            lockDescriptor = lease
            leaseOwned = false
        } catch {
            if leaseOwned {
                _ = flock(lease, LOCK_UN)
                close(lease)
            }
            throw error
        }
    }

    deinit {
        stop()
        _ = flock(lockDescriptor, LOCK_UN)
        close(lockDescriptor)
    }

    /// Publishes the socket only after storage, routing, and operational state
    /// have initialized successfully. The owner lease is already held, so a
    /// second daemon cannot touch storage while this initialization proceeds.
    func activate() throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !stopped, listenerDescriptor < 0 else {
            throw CoordinatorError("operational_server_state_invalid")
        }
        let listener = try Self.makeListener(at: socketPath)
        listenerDescriptor = listener.descriptor
        socketDevice = listener.device
        socketInode = listener.inode
    }

    func run(
        application: any CoordinatorOperationalHandling,
        secretCorpus: RuntimeSecretCorpus
    ) throws {
        stateLock.lock()
        let activeListener = listenerDescriptor
        stateLock.unlock()
        guard activeListener >= 0 else {
            throw CoordinatorError("operational_server_not_active")
        }
        signal(SIGPIPE, SIG_IGN)
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        let interruptSource = DispatchSource.makeSignalSource(signal: SIGINT)
        let terminationSource = DispatchSource.makeSignalSource(signal: SIGTERM)
        for source in [interruptSource, terminationSource] {
            source.setEventHandler { [weak self] in self?.stop() }
            source.resume()
        }
        defer {
            interruptSource.cancel()
            terminationSource.cancel()
        }
        Self.startScheduler(application: application)
        while true {
            let descriptor = accept(activeListener, nil, nil)
            if descriptor < 0 {
                let acceptError = errno
                if acceptError == EINTR || acceptError == ECONNABORTED { continue }
                stateLock.lock()
                let wasStopped = stopped
                stateLock.unlock()
                if wasStopped { return }
                if acceptError == EMFILE || acceptError == ENFILE
                    || acceptError == ENOBUFS || acceptError == ENOMEM
                {
                    usleep(50_000)
                    continue
                }
                throw CoordinatorError("operational_accept_failed")
            }
            guard admissionGate.tryAcquire() else {
                close(descriptor)
                continue
            }
            setCloseOnExec(descriptor)
            setNoSigPipe(descriptor)
            let gate = admissionGate
            Task.detached(priority: .userInitiated) {
                defer { gate.release() }
                await Self.handleConnection(
                    descriptor: descriptor,
                    application: application,
                    secretCorpus: secretCorpus
                )
            }
        }
    }

    func stop() {
        stateLock.lock()
        guard !stopped else {
            stateLock.unlock()
            return
        }
        stopped = true
        let activeListener = listenerDescriptor
        listenerDescriptor = -1
        let ownedDevice = socketDevice
        let ownedInode = socketInode
        stateLock.unlock()

        guard activeListener >= 0 else { return }
        // Remove the owned pathname before waking accept. If the listener is
        // closed first, run() can return and the process can exit while this
        // signal-handler task is still between lstat and unlink.
        var info = stat()
        if lstat(socketPath, &info) == 0,
           info.st_dev == ownedDevice,
           info.st_ino == ownedInode,
           info.st_uid == geteuid(),
           info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK)
        {
            _ = unlink(socketPath)
        }
        _ = shutdown(activeListener, SHUT_RDWR)
        close(activeListener)
    }

    private static func handleConnection(
        descriptor: Int32,
        application: any CoordinatorOperationalHandling,
        secretCorpus: RuntimeSecretCorpus
    ) async {
        defer { close(descriptor) }
        guard peerHasCurrentEffectiveUserID(descriptor) else { return }

        var requestID = "unknown"
        let requestSecretCorpus = RuntimeSecretCorpus()
        do {
            let line = try readOneLine(descriptor: descriptor, timeoutMilliseconds: 5_000)
            let request = try StrictJSONTransport.object(
                from: line,
                limits: StrictJSONLimits(
                    maximumBytes: operationalMaximumMessageBytes,
                    maximumDepth: 72
                )
            )
            requestID = try safeRequestID(request["request_id"])
            guard let type = request["type"] as? String,
                  allowedTypes.contains(type),
                  let payload = request["payload"] as? [String: Any]
            else {
                throw CoordinatorError("operational_request_invalid")
            }

            // Never add unvalidated client material to the daemon-wide corpus:
            // one malicious request could otherwise poison all later output.
            // The application registers only tokens it validates or issues;
            // this request-local corpus still prevents an input secret echo.
            requestSecretCorpus.registerKnownSecrets(inJSONObject: payload)
            let payloadData = try StrictJSONTransport.data(forJSONObject: payload)
            let resultData = try await application.handle(type: type, payload: payloadData)
            guard resultData.count <= operationalMaximumMessageBytes else {
                throw CoordinatorError("operational_response_too_large")
            }
            let result = try StrictJSONTransport.object(
                from: resultData,
                limits: StrictJSONLimits(
                    maximumBytes: operationalMaximumMessageBytes,
                    maximumDepth: 72
                )
            )
            try rejectRawTokenKeys(result)
            try requestSecretCorpus.assertNoKnownSecret(inJSONObject: result)
            try requestSecretCorpus.assertNoKnownSecret(in: resultData)
            try secretCorpus.assertNoKnownSecret(inJSONObject: result)
            try secretCorpus.assertNoKnownSecret(in: resultData)
            try writeOperationalJSON([
                "request_id": requestID,
                "ok": true,
                "result": result,
            ],
            descriptor: descriptor,
            secretCorpus: secretCorpus,
            requestSecretCorpus: requestSecretCorpus)
        } catch {
            let failure = error.coordinatorError
            try? writeOperationalJSON([
                "request_id": requestID,
                "ok": false,
                "error": [
                    "code": safeErrorCode(failure.code),
                    "message": "request failed",
                ],
            ],
            descriptor: descriptor,
            secretCorpus: secretCorpus,
            requestSecretCorpus: requestSecretCorpus)
        }
    }

    private static func startScheduler(application: any CoordinatorOperationalHandling) {
        Task.detached(priority: .utility) {
            while !Task.isCancelled {
                let requestedDelay = await application.millisecondsUntilNextDeadline()
                let delay = max(1, min(requestedDelay ?? 250, 250))
                try? await Task.sleep(for: .milliseconds(Int64(delay)))
                if Task.isCancelled { return }
                _ = try? await application.processTime()
            }
        }
    }

    fileprivate static func openSecureRuntimeDirectory(_ directoryURL: URL) throws -> Int32 {
        let standardized = normalizedSystemAlias(directoryURL.standardizedFileURL.path)
        guard standardized.hasPrefix("/") else {
            throw CoordinatorError("operational_runtime_directory_unsafe")
        }
        let components = standardized.split(separator: "/").map(String.init)
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else {
            throw CoordinatorError("operational_runtime_directory_unavailable")
        }
        do {
            for component in components {
                var next = openat(
                    descriptor,
                    component,
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                )
                if next < 0 && errno == ENOENT {
                    guard mkdirat(descriptor, component, mode_t(0o700)) == 0 || errno == EEXIST else {
                        throw CoordinatorError("operational_runtime_directory_unavailable")
                    }
                    next = openat(
                        descriptor,
                        component,
                        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                    )
                }
                guard next >= 0 else {
                    throw CoordinatorError("operational_runtime_directory_unsafe")
                }
                close(descriptor)
                descriptor = next
            }
            var info = stat()
            guard fstat(descriptor, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                  info.st_mode & 0o777 == 0o700,
                  info.st_uid == geteuid()
            else {
                throw CoordinatorError("operational_runtime_directory_unsafe")
            }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    fileprivate static func openAndAcquireOwnerLease(
        parentDescriptor: Int32,
        name: String
    ) throws -> Int32 {
        let descriptor = openat(
            parentDescriptor,
            name,
            O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else {
            throw CoordinatorError("operational_owner_lock_unavailable")
        }
        do {
            var info = stat()
            guard fstat(descriptor, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
                  info.st_mode & 0o777 == 0o600,
                  info.st_uid == geteuid()
            else {
                throw CoordinatorError("operational_owner_lock_unsafe")
            }
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
                throw CoordinatorError("operational_owner_active")
            }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func prepareSocketEntry(
        parentDescriptor: Int32,
        name: String,
        fullPath: String
    ) throws {
        var info = stat()
        if fstatat(parentDescriptor, name, &info, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT else {
                throw CoordinatorError("operational_socket_unsafe")
            }
            return
        }
        guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK),
              info.st_mode & 0o777 == 0o600,
              info.st_uid == geteuid()
        else {
            throw CoordinatorError("operational_socket_unsafe")
        }

        do {
            let activeDescriptor = try connectUnixSocket(
                at: fullPath,
                timeoutMilliseconds: 150,
                verifyFilesystemEntry: false
            )
            close(activeDescriptor)
            throw CoordinatorError("operational_owner_active")
        } catch let error as CoordinatorError {
            guard error.code == "operational_connect_refused" else { throw error }
        }
        var current = stat()
        guard fstatat(parentDescriptor, name, &current, AT_SYMLINK_NOFOLLOW) == 0,
              current.st_dev == info.st_dev,
              current.st_ino == info.st_ino,
              current.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK),
              current.st_mode & 0o777 == 0o600,
              current.st_uid == geteuid()
        else {
            throw CoordinatorError("operational_socket_unsafe")
        }
        guard unlinkat(parentDescriptor, name, 0) == 0 else {
            throw CoordinatorError("operational_socket_unsafe")
        }
    }

    private static func makeListener(
        at path: String
    ) throws -> (descriptor: Int32, device: dev_t, inode: ino_t) {
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else {
            throw CoordinatorError("operational_socket_unavailable")
        }
        setCloseOnExec(descriptor)
        setNoSigPipe(descriptor)
        var boundIdentity: (device: dev_t, inode: ino_t)?
        do {
            try withUnixSocketAddress(path) { address, length in
                guard Darwin.bind(descriptor, address, length) == 0 else {
                    throw CoordinatorError("operational_socket_bind_failed")
                }
            }
            var info = stat()
            guard lstat(path, &info) == 0,
                  info.st_uid == geteuid(),
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK)
            else {
                throw CoordinatorError("operational_socket_unsafe")
            }
            boundIdentity = (info.st_dev, info.st_ino)
            guard chmod(path, mode_t(0o600)) == 0 else {
                throw CoordinatorError("operational_socket_unsafe")
            }
            guard listen(descriptor, 128) == 0 else {
                throw CoordinatorError("operational_socket_listen_failed")
            }
            return (descriptor, info.st_dev, info.st_ino)
        } catch {
            close(descriptor)
            if let boundIdentity {
                var current = stat()
                if lstat(path, &current) == 0,
                   current.st_dev == boundIdentity.device,
                   current.st_ino == boundIdentity.inode,
                   current.st_uid == geteuid(),
                   current.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK)
                {
                    _ = unlink(path)
                }
            }
            throw error
        }
    }
}

/// Process-lifetime authority for one coordinator database. Socket and key
/// paths are configurable implementation details, so neither can define the
/// singleton. The lease lives in a fixed per-user runtime root rather than the
/// database parent, preserving SQLiteJournal's no-storage-mutation preflight.
final class CoordinatorAuthorityLease: @unchecked Sendable {
    private let descriptor: Int32

    init(databaseURL: URL) throws {
        descriptor = try Self.acquire(
            databaseURL: databaseURL,
            authorityRootURL: Self.defaultAuthorityRootURL
        )
    }

    #if BLABEE_JOURNAL_TEST_HARNESS
    init(databaseURL: URL, testAuthorityRootURL: URL) throws {
        descriptor = try Self.acquire(
            databaseURL: databaseURL,
            authorityRootURL: testAuthorityRootURL
        )
    }
    #endif

    deinit {
        _ = flock(descriptor, LOCK_UN)
        close(descriptor)
    }

    private static var defaultAuthorityRootURL: URL {
        // HOME is intentionally ignored: two product invocations with
        // different inherited environments must still share one authority.
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(
                "Library/Application Support/Blabee/runtime/authority",
                isDirectory: true
            )
    }

    private static func acquire(
        databaseURL: URL,
        authorityRootURL: URL
    ) throws -> Int32 {
        let databasePath = normalizedSystemAlias(databaseURL.standardizedFileURL.path)
        guard databasePath.hasPrefix("/"), !databasePath.utf8.contains(0) else {
            throw CoordinatorError("operational_owner_lock_unsafe")
        }
        var identity = Data("blabee-coordinator-database-authority-v1".utf8)
        identity.append(0)
        identity.append(Data(databasePath.utf8))
        let digest = SHA256.hash(data: identity)
            .map { String(format: "%02x", $0) }
            .joined()
        let parent = try UnixDomainSocketServer.openSecureRuntimeDirectory(
            authorityRootURL.standardizedFileURL
        )
        defer { close(parent) }
        return try UnixDomainSocketServer.openAndAcquireOwnerLease(
            parentDescriptor: parent,
            name: "db-\(digest).lock"
        )
    }
}

private final class ConnectionAdmissionGate: @unchecked Sendable {
    private let limit: Int
    private let lock = NSLock()
    private var active = 0

    init(limit: Int) {
        self.limit = limit
    }

    func tryAcquire() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard active < limit else { return false }
        active += 1
        return true
    }

    func release() {
        lock.lock()
        active = max(0, active - 1)
        lock.unlock()
    }
}

private func safeRequestID(_ value: Any?) throws -> String {
    guard let value = value as? String,
          value.range(
            of: "^[A-Za-z][A-Za-z0-9_.:-]{0,127}$",
            options: .regularExpression
          ) != nil
    else {
        throw CoordinatorError("operational_request_invalid")
    }
    return value
}

private func safeErrorCode(_ code: String) -> String {
    guard code.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil else {
        return "operational_request_failed"
    }
    return code
}

private func rejectRawTokenKeys(_ value: Any) throws {
    if let object = value as? [String: Any] {
        for (key, child) in object {
            if key == "continuation_token" || key == "correlation_token" {
                throw CoordinatorError("raw_continuation_token_forbidden")
            }
            try rejectRawTokenKeys(child)
        }
    } else if let array = value as? [Any] {
        for child in array { try rejectRawTokenKeys(child) }
    }
}

private func writeOperationalJSON(
    _ object: [String: Any],
    descriptor: Int32,
    secretCorpus: RuntimeSecretCorpus,
    requestSecretCorpus: RuntimeSecretCorpus? = nil
) throws {
    try requestSecretCorpus?.assertNoKnownSecret(inJSONObject: object)
    try secretCorpus.assertNoKnownSecret(inJSONObject: object)
    var data = try JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys, .withoutEscapingSlashes]
    )
    try requestSecretCorpus?.assertNoKnownSecret(in: data)
    try secretCorpus.assertNoKnownSecret(in: data)
    guard data.count < operationalMaximumMessageBytes else {
        throw CoordinatorError("operational_response_too_large")
    }
    data.append(0x0A)
    try writeAll(data, descriptor: descriptor, timeoutMilliseconds: 5_000)
}

private func connectUnixSocket(
    at path: String,
    timeoutMilliseconds: Int32,
    verifyFilesystemEntry: Bool
) throws -> Int32 {
    if verifyFilesystemEntry {
        var info = stat()
        guard lstat(path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK),
              info.st_mode & 0o777 == 0o600,
              info.st_uid == geteuid()
        else {
            throw CoordinatorError("operational_socket_unavailable")
        }
    }

    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
        throw CoordinatorError("operational_socket_unavailable")
    }
    setCloseOnExec(descriptor)
    setNoSigPipe(descriptor)
    do {
        let originalFlags = fcntl(descriptor, F_GETFL)
        guard originalFlags >= 0,
              fcntl(descriptor, F_SETFL, originalFlags | O_NONBLOCK) == 0
        else {
            throw CoordinatorError("operational_socket_unavailable")
        }

        let connectResult = try withUnixSocketAddress(path) { address, length in
            Darwin.connect(descriptor, address, length)
        }
        if connectResult != 0 {
            guard errno == EINPROGRESS else {
                throw CoordinatorError(
                    errno == ECONNREFUSED
                        ? "operational_connect_refused"
                        : "operational_connect_failed"
                )
            }
            try waitForDescriptor(
                descriptor,
                events: Int16(POLLOUT),
                timeoutMilliseconds: timeoutMilliseconds,
                timeoutCode: "operational_connect_timeout"
            )
            var socketError: Int32 = 0
            var length = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &socketError, &length) == 0 else {
                throw CoordinatorError("operational_connect_failed")
            }
            guard socketError == 0 else {
                throw CoordinatorError(
                    socketError == ECONNREFUSED
                        ? "operational_connect_refused"
                        : "operational_connect_failed"
                )
            }
        }
        guard fcntl(descriptor, F_SETFL, originalFlags) == 0 else {
            throw CoordinatorError("operational_socket_unavailable")
        }
        guard peerHasCurrentEffectiveUserID(descriptor) else {
            throw CoordinatorError("operational_peer_rejected")
        }
        return descriptor
    } catch {
        close(descriptor)
        throw error
    }
}

private func readOneLine(
    descriptor: Int32,
    timeoutMilliseconds: Int32
) throws -> Data {
    let deadline = monotonicDeadline(afterMilliseconds: timeoutMilliseconds)
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 16 * 1024)
    while true {
        let remaining = remainingMilliseconds(until: deadline)
        try waitForDescriptor(
            descriptor,
            events: Int16(POLLIN),
            timeoutMilliseconds: remaining,
            timeoutCode: "operational_response_timeout"
        )
        let count = buffer.withUnsafeMutableBytes { bytes in
            Darwin.read(descriptor, bytes.baseAddress, bytes.count)
        }
        if count < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("operational_transport_failed")
        }
        guard count > 0 else {
            throw CoordinatorError("operational_transport_closed")
        }
        data.append(contentsOf: buffer.prefix(count))
        guard data.count <= operationalMaximumMessageBytes else {
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

private func writeAll(
    _ data: Data,
    descriptor: Int32,
    timeoutMilliseconds: Int32
) throws {
    let deadline = monotonicDeadline(afterMilliseconds: timeoutMilliseconds)
    var offset = 0
    while offset < data.count {
        let remaining = remainingMilliseconds(until: deadline)
        try waitForDescriptor(
            descriptor,
            events: Int16(POLLOUT),
            timeoutMilliseconds: remaining,
            timeoutCode: "operational_response_timeout"
        )
        let written = data.withUnsafeBytes { bytes in
            Darwin.write(
                descriptor,
                bytes.baseAddress!.advanced(by: offset),
                data.count - offset
            )
        }
        if written < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("operational_transport_failed")
        }
        guard written > 0 else {
            throw CoordinatorError("operational_transport_closed")
        }
        offset += written
    }
}

private func waitForDescriptor(
    _ descriptor: Int32,
    events: Int16,
    timeoutMilliseconds: Int32,
    timeoutCode: String
) throws {
    guard timeoutMilliseconds > 0 else { throw CoordinatorError(timeoutCode) }
    var descriptorState = pollfd(fd: descriptor, events: events, revents: 0)
    while true {
        let result = poll(&descriptorState, 1, timeoutMilliseconds)
        if result < 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("operational_transport_failed")
        }
        guard result > 0 else { throw CoordinatorError(timeoutCode) }
        if descriptorState.revents & Int16(POLLNVAL | POLLERR) != 0 {
            throw CoordinatorError("operational_transport_failed")
        }
        return
    }
}

private func monotonicDeadline(afterMilliseconds milliseconds: Int32) -> UInt64 {
    let now = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)
    return now &+ UInt64(max(0, milliseconds)) * 1_000_000
}

private func remainingMilliseconds(until deadline: UInt64) -> Int32 {
    let now = clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)
    guard deadline > now else { return 0 }
    let roundedUp = (deadline - now + 999_999) / 1_000_000
    return Int32(min(UInt64(Int32.max), roundedUp))
}

private func peerHasCurrentEffectiveUserID(_ descriptor: Int32) -> Bool {
    var userID: uid_t = 0
    var groupID: gid_t = 0
    return getpeereid(descriptor, &userID, &groupID) == 0 && userID == geteuid()
}

private func setCloseOnExec(_ descriptor: Int32) {
    let flags = fcntl(descriptor, F_GETFD)
    if flags >= 0 { _ = fcntl(descriptor, F_SETFD, flags | FD_CLOEXEC) }
}

private func setNoSigPipe(_ descriptor: Int32) {
    var enabled: Int32 = 1
    _ = setsockopt(
        descriptor,
        SOL_SOCKET,
        SO_NOSIGPIPE,
        &enabled,
        socklen_t(MemoryLayout<Int32>.size)
    )
}

private func validateUnixSocketPathLength(_ path: String) throws {
    let address = sockaddr_un()
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard !path.utf8.contains(0), path.utf8.count + 1 <= capacity else {
        throw CoordinatorError("operational_socket_invalid", "socket path is too long")
    }
}

private func withUnixSocketAddress<T>(
    _ path: String,
    _ operation: (UnsafePointer<sockaddr>, socklen_t) throws -> T
) throws -> T {
    try validateUnixSocketPathLength(path)
    var address = sockaddr_un()
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8) + [0]
    withUnsafeMutableBytes(of: &address.sun_path) { destination in
        destination.copyBytes(from: bytes)
    }
    return try withUnsafePointer(to: &address) { pointer in
        try pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            try operation($0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
}

private func normalizedSystemAlias(_ path: String) -> String {
    if path == "/var" { return "/private/var" }
    if path.hasPrefix("/var/") { return "/private" + path }
    if path == "/tmp" { return "/private/tmp" }
    if path.hasPrefix("/tmp/") { return "/private" + path }
    return path
}
