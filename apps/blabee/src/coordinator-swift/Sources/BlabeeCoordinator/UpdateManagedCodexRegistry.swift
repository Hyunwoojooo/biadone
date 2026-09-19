import CoordinatorSwift
import Darwin
import Dispatch
import Foundation

/// A capability for a single supervisor incarnation. A disk entry, PID, or
/// thread UUID alone never grants permission to signal or resume a process.
struct UpdateManagedCodexRecord: Codable, Sendable, Equatable {
    var session: UpdateManagedSession
    var nonce: String
    var hostPID: Int32
    var hostStartTime: UInt64
    var incarnation: String
    var socketPath: String
    var codexPath: String
    var terminal: String?
    var transactionID: String?
    var runtimeAppPath: String
    var restorationClaim: String?
    var codexHome: String? = nil
}

enum UpdateManagedCodexProcessIdentity {
    static func isAlive(pid: Int32, startTime: UInt64) throws -> Bool {
        guard pid > 0, startTime > 0 else { throw updateManagedError("host_identity_unavailable") }
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
        errno = 0
        let count = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size)
        if count <= 0, errno == ESRCH { return false }
        guard count == size, info.pbi_pid == UInt32(pid), info.pbi_start_tvusec < 1_000_000 else {
            throw updateManagedError("host_identity_unavailable")
        }
        if info.pbi_status == UInt32(SZOMB) { return false }
        let (seconds, overflow) = info.pbi_start_tvsec.multipliedReportingOverflow(by: 1_000_000)
        let (actual, additionOverflow) = seconds.addingReportingOverflow(info.pbi_start_tvusec)
        guard !overflow, !additionOverflow, actual > 0 else {
            throw updateManagedError("host_identity_unavailable")
        }
        return info.pbi_uid == geteuid() && actual == startTime
    }

    static func startTime(pid: Int32) throws -> UInt64 {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.stride)
        guard pid > 0,
              proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
              info.pbi_pid == UInt32(pid), info.pbi_uid == geteuid(),
              info.pbi_status != UInt32(SZOMB), info.pbi_start_tvusec < 1_000_000
        else { throw updateManagedError("host_identity_unavailable") }
        let (seconds, overflow) = info.pbi_start_tvsec.multipliedReportingOverflow(by: 1_000_000)
        let (value, additionOverflow) = seconds.addingReportingOverflow(info.pbi_start_tvusec)
        guard !overflow, !additionOverflow, value > 0 else {
            throw updateManagedError("host_identity_unavailable")
        }
        return value
    }
}

/// Private, bounded and atomically replaced records. The lock covers reads,
/// replacement and incarnation-qualified deletion across app/supervisor PIDs.
struct UpdateManagedCodexRegistry: Sendable {
    let directoryURL: URL
    static let maximumRecordBytes = 65_536
    static let maximumRecords = 256

    init(directory: URL? = nil) {
        directoryURL = directory ?? Self.accountDirectory()
    }

    var runtimesDirectoryURL: URL { directoryURL.appendingPathComponent("runtimes", isDirectory: true) }

    func prepareRuntimesDirectory() throws -> URL {
        try withDirectory { _ in
            let descriptor = try Self.openPrivateDirectory(runtimesDirectoryURL, create: true)
            close(descriptor)
        }
        return runtimesDirectoryURL
    }

    func records() throws -> [UpdateManagedCodexRecord] {
        try withDirectory { directory in
            try recordNames(directory: directory).map { name in
                guard let record = try readRecord(directory: directory, name: name) else {
                    throw updateManagedError("registry_changed")
                }
                return record
            }.sorted { $0.session.id < $1.session.id }
        }
    }

    func save(_ record: UpdateManagedCodexRecord, expectedIncarnation: String? = nil) throws {
        try Self.validate(record)
        let data = try JSONEncoder().encode(record)
        guard data.count <= Self.maximumRecordBytes else {
            throw updateManagedError("registry_record_too_large")
        }
        try withDirectory { directory in
            let name = try Self.fileName(record.session.id)
            let existing = try readRecord(directory: directory, name: name)
            if let expectedIncarnation {
                guard existing?.incarnation == expectedIncarnation else {
                    throw updateManagedError("incarnation_mismatch")
                }
            }
            let names = try recordNames(directory: directory)
            guard existing != nil || names.count < Self.maximumRecords else {
                throw updateManagedError("registry_full")
            }
            try writeRecordData(data, directory: directory, name: name)
        }
    }

    func claimRestoration(id: String, expectedIncarnation: String,
                          transactionID: String, claimID: String) throws -> UpdateManagedCodexRecord {
        guard UUID(uuidString: transactionID) != nil, UUID(uuidString: claimID) != nil else {
            throw updateManagedError("restoration_claim_invalid")
        }
        return try withDirectory { directory in
            let name = try Self.fileName(id)
            guard var record = try readRecord(directory: directory, name: name),
                  record.incarnation == expectedIncarnation,
                  record.transactionID == transactionID, record.session.state == .paused,
                  record.restorationClaim == nil else {
                throw updateManagedError("restoration_claim_conflict")
            }
            guard try !UpdateManagedCodexProcessIdentity.isAlive(
                pid: record.hostPID, startTime: record.hostStartTime) else {
                throw updateManagedError("restoration_host_still_running")
            }
            record.restorationClaim = claimID
            record.session.state = .resuming
            let data = try JSONEncoder().encode(record)
            guard data.count <= Self.maximumRecordBytes else {
                throw updateManagedError("registry_record_too_large")
            }
            try writeRecordData(data, directory: directory, name: name)
            return record
        }
    }

    private func writeRecordData(_ data: Data, directory: Int32, name: String) throws {
        let temporary = ".pending-" + UUID().uuidString.lowercased()
        let descriptor = openat(directory, temporary,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard descriptor >= 0 else { throw updateManagedError("registry_unavailable") }
        defer { close(descriptor); _ = unlinkat(directory, temporary, 0) }
        let before = try Self.requirePrivateFile(descriptor)
        var offset = 0
        while offset < data.count {
            let count = data.withUnsafeBytes {
                Darwin.write(descriptor, $0.baseAddress!.advanced(by: offset), $0.count - offset)
            }
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { throw updateManagedError("registry_unavailable") }
            offset += count
        }
        guard fsync(descriptor) == 0 else { throw updateManagedError("registry_unavailable") }
        try Self.requireNamedFile(directory: directory, name: temporary, identity: before)
        _ = try readRecord(directory: directory, name: name)
        guard renameat(directory, temporary, directory, name) == 0, fsync(directory) == 0 else {
            throw updateManagedError("registry_unavailable")
        }
    }

    func remove(id: String, expectedIncarnation: String) throws {
        try withDirectory { directory in
            let name = try Self.fileName(id)
            guard let record = try readRecord(directory: directory, name: name) else { return }
            guard record.incarnation == expectedIncarnation else {
                throw updateManagedError("incarnation_mismatch")
            }
            guard unlinkat(directory, name, 0) == 0, fsync(directory) == 0 else {
                throw updateManagedError("registry_unavailable")
            }
        }
    }

    private static func accountDirectory() -> URL {
        var buffer = [CChar](repeating: 0, count: 16_384)
        let home: String? = buffer.withUnsafeMutableBufferPointer { buffer in
            var account = passwd()
            var result: UnsafeMutablePointer<passwd>?
            guard getpwuid_r(geteuid(), &account, buffer.baseAddress, buffer.count, &result) == 0,
                  result != nil, let path = account.pw_dir else { return nil }
            return String(cString: path)
        }
        guard let home, home.hasPrefix("/") else {
            return URL(string: "blabee-update-registry-unavailable:")!
        }
        return URL(fileURLWithPath: home, isDirectory: true)
            .appendingPathComponent("Library/Application Support/Blabee/update-managed/v1", isDirectory: true)
    }

    fileprivate static func validate(_ record: UpdateManagedCodexRecord) throws {
        _ = try fileName(record.session.id)
        guard UUID(uuidString: record.incarnation) != nil,
              record.nonce.utf8.count >= 32, record.nonce.utf8.count <= 256,
              record.nonce.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0)
                  || (97...122).contains($0) || $0 == 45 }),
              (record.hostPID > 0 && record.hostStartTime > 0)
                || (record.hostPID == 0 && record.hostStartTime == 0 && record.session.state == .starting),
              [record.socketPath, record.codexPath, record.runtimeAppPath, record.session.cwd]
                .allSatisfy(Self.isSafeAbsolutePath),
              record.codexHome.map(Self.isSafeAbsolutePath) ?? true,
              record.session.threadID.map({ UUID(uuidString: $0) != nil }) ?? true,
              record.transactionID.map({ UUID(uuidString: $0) != nil }) ?? true,
              record.restorationClaim.map({ UUID(uuidString: $0) != nil }) ?? true
        else { throw updateManagedError("registry_record_invalid") }
    }

    private static func isSafeAbsolutePath(_ path: String) -> Bool {
        path.hasPrefix("/") && path.utf8.count < 4096
            && !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }

    private static func fileName(_ id: String) throws -> String {
        guard let uuid = UUID(uuidString: id) else { throw updateManagedError("registry_record_invalid") }
        return uuid.uuidString.lowercased() + ".json"
    }

    private func withDirectory<T>(_ operation: (Int32) throws -> T) throws -> T {
        let directory = try Self.openPrivateDirectory(directoryURL, create: true)
        defer { close(directory) }
        let lock = openat(directory, ".lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, mode_t(0o600))
        guard lock >= 0 else { throw updateManagedError("registry_unavailable") }
        defer { close(lock) }
        let identity = try Self.requirePrivateFile(lock)
        let deadline = DispatchTime.now().uptimeNanoseconds + 2_000_000_000
        while flock(lock, LOCK_EX | LOCK_NB) != 0 {
            guard (errno == EINTR || errno == EWOULDBLOCK || errno == EAGAIN),
                  DispatchTime.now().uptimeNanoseconds < deadline else {
                throw updateManagedError("registry_busy")
            }
            usleep(5_000)
        }
        defer { _ = flock(lock, LOCK_UN) }
        try Self.requireNamedFile(directory: directory, name: ".lock", identity: identity)
        return try operation(directory)
    }

    private func recordNames(directory: Int32) throws -> [String] {
        let duplicate = dup(directory)
        guard duplicate >= 0 else { throw updateManagedError("registry_unavailable") }
        guard let stream = fdopendir(duplicate) else {
            close(duplicate)
            throw updateManagedError("registry_unavailable")
        }
        defer { closedir(stream) }
        var names: [String] = []
        var scanned = 0
        while true {
            errno = 0
            guard let entry = readdir(stream) else {
                guard errno == 0 else { throw updateManagedError("registry_unavailable") }
                break
            }
            let name = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(entry.pointee.d_namlen) + 1) {
                    String(cString: $0)
                }
            }
            scanned += 1
            guard scanned <= Self.maximumRecords * 2 + 3 else { throw updateManagedError("registry_full") }
            if name == "." || name == ".." || name == ".lock" { continue }
            if name == "runtimes" {
                let runtimeDirectory = openat(directory, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard runtimeDirectory >= 0 else { throw updateManagedError("registry_unavailable") }
                defer { close(runtimeDirectory) }
                var info = stat()
                guard fstat(runtimeDirectory, &info) == 0, info.st_uid == geteuid(),
                      info.st_mode & 0o777 == 0o700 else {
                    throw updateManagedError("registry_unavailable")
                }
                try Self.requireNoGrantACL(runtimeDirectory)
                continue
            }
            // Interrupted writes are never interpreted as resumable sessions.
            if name.hasPrefix(".pending-"), UUID(uuidString: String(name.dropFirst(9))) != nil { continue }
            guard name.hasSuffix(".json"),
                  (try? Self.fileName(String(name.dropLast(5)))) == name else {
                throw updateManagedError("registry_record_invalid")
            }
            names.append(name)
            guard names.count <= Self.maximumRecords else { throw updateManagedError("registry_full") }
        }
        return names
    }

    private func readRecord(directory: Int32, name: String) throws -> UpdateManagedCodexRecord? {
        let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        if descriptor < 0, errno == ENOENT { return nil }
        guard descriptor >= 0 else { throw updateManagedError("registry_unavailable") }
        defer { close(descriptor) }
        let before = try Self.requirePrivateFile(descriptor)
        guard before.st_size > 0, before.st_size <= Self.maximumRecordBytes else {
            throw updateManagedError("registry_record_invalid")
        }
        var data = [UInt8](repeating: 0, count: Int(before.st_size))
        var offset = 0
        while offset < data.count {
            let count = data.withUnsafeMutableBytes {
                Darwin.read(descriptor, $0.baseAddress!.advanced(by: offset), $0.count - offset)
            }
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { throw updateManagedError("registry_record_invalid") }
            offset += count
        }
        let after = try Self.requirePrivateFile(descriptor)
        guard before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec else {
            throw updateManagedError("registry_changed")
        }
        try Self.requireNamedFile(directory: directory, name: name, identity: before)
        let record = try JSONDecoder().decode(UpdateManagedCodexRecord.self, from: Data(data))
        try Self.validate(record)
        guard try Self.fileName(record.session.id) == name else { throw updateManagedError("registry_record_invalid") }
        return record
    }

    fileprivate static func openPrivateDirectory(_ url: URL, create: Bool) throws -> Int32 {
        guard url.isFileURL, url.path.hasPrefix("/"), !url.path.utf8.contains(0) else {
            throw updateManagedError("registry_unavailable")
        }
        var path = url.path
        if path == "/tmp" || path.hasPrefix("/tmp/") { path = "/private" + path }
        if path == "/var" || path.hasPrefix("/var/") { path = "/private" + path }
        let components = path.split(separator: "/").map(String.init)
        guard !components.isEmpty, !components.contains(".."), !components.contains(".") else {
            throw updateManagedError("registry_unavailable")
        }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw updateManagedError("registry_unavailable") }
        do {
            var currentPath = ""
            for (index, component) in components.enumerated() {
                currentPath += "/" + component
                var next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                var created = false
                if next < 0, errno == ENOENT, create {
                    if mkdirat(descriptor, component, mode_t(0o700)) == 0 {
                        created = true
                    } else if errno != EEXIST { throw updateManagedError("registry_unavailable") }
                    next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else { throw updateManagedError("registry_unavailable") }
                do {
                    var info = stat()
                    guard fstat(next, &info) == 0,
                          info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                          info.st_uid == 0 || info.st_uid == geteuid() else {
                        throw updateManagedError("registry_unavailable")
                    }
                    let systemTemporary = currentPath == "/private/tmp" && info.st_uid == 0
                        && info.st_mode & 0o7777 == 0o1777
                    let privateOwner = created || index == components.count - 1
                    guard info.st_mode & 0o022 == 0 || systemTemporary,
                          !privateOwner || (info.st_uid == geteuid() && info.st_mode & 0o777 == 0o700) else {
                        throw updateManagedError("registry_unavailable")
                    }
                    try requireNoGrantACL(next)
                    if created, fsync(descriptor) != 0 { throw updateManagedError("registry_unavailable") }
                } catch { close(next); throw error }
                close(descriptor)
                descriptor = next
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    private static func requirePrivateFile(_ descriptor: Int32) throws -> stat {
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_mode & 0o777 == 0o600,
              info.st_uid == geteuid(), info.st_nlink == 1 else {
            throw updateManagedError("registry_unavailable")
        }
        try requireNoGrantACL(descriptor)
        return info
    }

    private static func requireNamedFile(directory: Int32, name: String, identity: stat) throws {
        var info = stat()
        guard fstatat(directory, name, &info, AT_SYMLINK_NOFOLLOW) == 0,
              info.st_dev == identity.st_dev, info.st_ino == identity.st_ino,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), info.st_mode & 0o777 == 0o600,
              info.st_uid == geteuid(), info.st_nlink == 1 else {
            throw updateManagedError("registry_changed")
        }
    }

    private static func requireNoGrantACL(_ descriptor: Int32) throws {
        errno = 0
        let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let aclError = errno
        if let acl {
            let grants = blabeeExtendedACLContainsGrant(acl)
            acl_free(UnsafeMutableRawPointer(acl))
            guard grants == false else { throw updateManagedError("registry_unavailable") }
        }
        guard acl != nil || aclError == ENOENT else { throw updateManagedError("registry_unavailable") }
    }
}

enum UpdateManagedCodexControlAction: String, Codable, Sendable { case status, pause, resume }

private struct UpdateManagedCodexControlRequest: Codable {
    let requestID: String
    let sessionID: String
    let nonce: String
    let incarnation: String
    let hostPID: Int32
    let hostStartTime: UInt64
    let action: UpdateManagedCodexControlAction
    let transactionID: String?
    let expectedThreadID: String?
    let expectedCWD: String
}

private struct UpdateManagedCodexControlReply: Codable {
    let requestID: String
    let record: UpdateManagedCodexRecord?
    let error: String?
}

struct UpdateManagedCodexControlClient: Sendable {
    var timeoutMilliseconds: Int32 = 60_000

    func request(_ record: UpdateManagedCodexRecord, action: UpdateManagedCodexControlAction,
                 transactionID: String? = nil) throws -> UpdateManagedCodexRecord {
        try UpdateManagedCodexRegistry.validate(record)
        guard try UpdateManagedCodexProcessIdentity.startTime(pid: record.hostPID) == record.hostStartTime else {
            throw updateManagedError("host_identity_mismatch")
        }
        let timeout = action == .status ? min(timeoutMilliseconds, 2_000) : timeoutMilliseconds
        let descriptor = try UpdateManagedCodexSocket.connect(path: record.socketPath, timeout: timeout)
        defer { close(descriptor) }
        try UpdateManagedCodexSocket.requirePeer(descriptor, expectedPID: record.hostPID)
        guard try UpdateManagedCodexProcessIdentity.startTime(pid: record.hostPID) == record.hostStartTime else {
            throw updateManagedError("host_identity_mismatch")
        }
        let requestID = UUID().uuidString.lowercased()
        let request = UpdateManagedCodexControlRequest(requestID: requestID, sessionID: record.session.id,
            nonce: record.nonce, incarnation: record.incarnation, hostPID: record.hostPID,
            hostStartTime: record.hostStartTime, action: action, transactionID: transactionID,
            expectedThreadID: record.session.threadID, expectedCWD: record.session.cwd)
        let deadline = UpdateManagedCodexSocket.deadline(timeout)
        try UpdateManagedCodexSocket.write(request, to: descriptor, deadline: deadline)
        let reply: UpdateManagedCodexControlReply = try UpdateManagedCodexSocket.read(from: descriptor, deadline: deadline)
        guard reply.requestID == requestID else { throw updateManagedError("control_reply_invalid") }
        if reply.error != nil { throw updateManagedError("control_request_rejected") }
        guard let result = reply.record,
              result.session.id == record.session.id, result.incarnation == record.incarnation,
              result.hostPID == record.hostPID, result.hostStartTime == record.hostStartTime,
              result.nonce == record.nonce else { throw updateManagedError("control_reply_invalid") }
        try UpdateManagedCodexRegistry.validate(result)
        return result
    }
}

/// The listener controls only the supervisor that constructed it. It never
/// enumerates unrelated Codex processes or accepts a PID to signal from callers.
final class UpdateManagedCodexControlServer: @unchecked Sendable {
    private let record: UpdateManagedCodexRecord
    private let handler: @Sendable (UpdateManagedCodexControlAction, String?, UpdateManagedSession) throws -> UpdateManagedCodexRecord
    private let queue = DispatchQueue(label: "com.biadone.blabee.update-managed.control")
    private let lock = NSLock()
    private var source: DispatchSourceRead?
    private var stopped = false

    init(record: UpdateManagedCodexRecord,
         handler: @escaping @Sendable (UpdateManagedCodexControlAction, String?, UpdateManagedSession) throws -> UpdateManagedCodexRecord) {
        self.record = record
        self.handler = handler
    }

    static func makeSocketPath() throws -> String {
        var bytes = Array("/private/tmp/blabee-update-\(geteuid())-XXXXXXXX".utf8CString)
        let result = bytes.withUnsafeMutableBufferPointer { mkdtemp($0.baseAddress!) }
        guard result != nil else { throw updateManagedError("control_socket_unavailable") }
        return String(cString: bytes) + "/control.sock"
    }

    func start() throws {
        lock.lock()
        defer { lock.unlock() }
        guard source == nil, !stopped else { throw updateManagedError("control_already_started") }
        try UpdateManagedCodexRegistry.validate(record)
        guard record.hostPID == getpid(),
              try UpdateManagedCodexProcessIdentity.startTime(pid: getpid()) == record.hostStartTime else {
            throw updateManagedError("host_identity_mismatch")
        }
        let descriptor = try UpdateManagedCodexSocket.listen(path: record.socketPath)
        let source = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptRequest(descriptor) }
        let socketPath = record.socketPath
        source.setCancelHandler {
            close(descriptor)
            _ = unlink(socketPath)
            _ = rmdir(URL(fileURLWithPath: socketPath).deletingLastPathComponent().path)
        }
        self.source = source
        source.resume()
    }

    func stop() {
        lock.lock()
        stopped = true
        let current = source
        source = nil
        lock.unlock()
        current?.cancel()
    }

    deinit { stop() }

    private func acceptRequest(_ listener: Int32) {
        let peer = accept(listener, nil, nil)
        guard peer >= 0 else { return }
        defer { close(peer) }
        do {
            try UpdateManagedCodexSocket.configure(peer)
            try UpdateManagedCodexSocket.requirePeer(peer)
            let request: UpdateManagedCodexControlRequest = try UpdateManagedCodexSocket.read(
                from: peer, deadline: UpdateManagedCodexSocket.deadline(5_000))
            guard UUID(uuidString: request.requestID) != nil,
                  request.sessionID == record.session.id, request.nonce == record.nonce,
                  request.incarnation == record.incarnation, request.hostPID == getpid(),
                  request.hostStartTime == record.hostStartTime,
                  try UpdateManagedCodexProcessIdentity.startTime(pid: getpid()) == record.hostStartTime,
                  request.transactionID.map({ UUID(uuidString: $0) != nil }) ?? true,
                  request.expectedThreadID.map({ UUID(uuidString: $0) != nil }) ?? true,
                  request.expectedCWD.hasPrefix("/"), request.expectedCWD.utf8.count < 4096,
                  !request.expectedCWD.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
                  request.action == .status || (request.transactionID != nil && request.expectedThreadID != nil) else {
                throw updateManagedError("control_authentication_failed")
            }
            let reply: UpdateManagedCodexControlReply
            do {
                let expected = UpdateManagedSession(id: request.sessionID, threadID: request.expectedThreadID,
                    cwd: request.expectedCWD, state: .running, detail: nil)
                let result = try handler(request.action, request.transactionID, expected)
                try UpdateManagedCodexRegistry.validate(result)
                guard result.session.id == record.session.id, result.incarnation == record.incarnation,
                      result.hostPID == record.hostPID, result.hostStartTime == record.hostStartTime,
                      result.nonce == record.nonce else { throw updateManagedError("control_reply_invalid") }
                reply = UpdateManagedCodexControlReply(requestID: request.requestID, record: result, error: nil)
            } catch {
                // Do not return arbitrary exception text, paths or capabilities.
                reply = UpdateManagedCodexControlReply(requestID: request.requestID, record: nil,
                    error: "control_request_rejected")
            }
            try UpdateManagedCodexSocket.write(reply, to: peer, deadline: UpdateManagedCodexSocket.deadline(5_000))
        } catch { /* An unauthenticated/malformed request has no side effects. */ }
    }
}

private enum UpdateManagedCodexSocket {
    static let maximumBytes = 65_536

    static func deadline(_ timeout: Int32) -> UInt64 {
        DispatchTime.now().uptimeNanoseconds + UInt64(max(1, timeout)) * 1_000_000
    }

    static func configure(_ descriptor: Int32) throws {
        var noSignal: Int32 = 1
        guard fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0,
              fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0,
              setsockopt(descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal,
                  socklen_t(MemoryLayout<Int32>.size)) == 0 else {
            throw updateManagedError("control_socket_unavailable")
        }
    }

    static func requirePeer(_ descriptor: Int32, expectedPID: Int32? = nil) throws {
        var uid: uid_t = 0
        var gid: gid_t = 0
        guard getpeereid(descriptor, &uid, &gid) == 0, uid == geteuid() else {
            throw updateManagedError("control_peer_rejected")
        }
        if let expectedPID {
            var peerPID: Int32 = 0
            var size = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &peerPID, &size) == 0,
                  size == MemoryLayout<Int32>.size, peerPID == expectedPID else {
                throw updateManagedError("control_peer_rejected")
            }
        }
    }

    static func listen(path: String) throws -> Int32 {
        let directoryURL = URL(fileURLWithPath: path).deletingLastPathComponent()
        let directory = try UpdateManagedCodexRegistry.openPrivateDirectory(directoryURL, create: false)
        defer { close(directory) }
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw updateManagedError("control_socket_unavailable") }
        do {
            try configure(descriptor)
            // Never remove an existing socket: its owner may still be running.
            guard try withAddress(path, { Darwin.bind(descriptor, $0, $1) }) == 0,
                  chmod(path, mode_t(0o600)) == 0,
                  Darwin.listen(descriptor, 8) == 0 else {
                throw updateManagedError("control_socket_unavailable")
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    static func connect(path: String, timeout: Int32) throws -> Int32 {
        let url = URL(fileURLWithPath: path)
        let directory = try UpdateManagedCodexRegistry.openPrivateDirectory(url.deletingLastPathComponent(), create: false)
        defer { close(directory) }
        var info = stat()
        guard fstatat(directory, url.lastPathComponent, &info, AT_SYMLINK_NOFOLLOW) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFSOCK),
              info.st_uid == geteuid(), info.st_mode & 0o777 == 0o600 else {
            throw updateManagedError("control_socket_unavailable")
        }
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw updateManagedError("control_socket_unavailable") }
        do {
            try configure(descriptor)
            if try withAddress(path, { Darwin.connect(descriptor, $0, $1) }) != 0 {
                guard errno == EINPROGRESS || errno == EAGAIN else {
                    throw updateManagedError("control_socket_unavailable")
                }
                try wait(descriptor, events: Int16(POLLOUT), deadline: deadline(min(timeout, 5_000)))
                var error: Int32 = 0
                var size = socklen_t(MemoryLayout<Int32>.size)
                guard getsockopt(descriptor, SOL_SOCKET, SO_ERROR, &error, &size) == 0, error == 0 else {
                    throw updateManagedError("control_socket_unavailable")
                }
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    static func write<T: Encodable>(_ value: T, to descriptor: Int32, deadline: UInt64) throws {
        var data = try JSONEncoder().encode(value)
        guard data.count < maximumBytes else { throw updateManagedError("control_message_too_large") }
        data.append(10)
        var offset = 0
        while offset < data.count {
            try wait(descriptor, events: Int16(POLLOUT), deadline: deadline)
            let count = data.withUnsafeBytes {
                Darwin.write(descriptor, $0.baseAddress!.advanced(by: offset), $0.count - offset)
            }
            if count < 0, errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK { continue }
            guard count > 0 else { throw updateManagedError("control_closed") }
            offset += count
        }
    }

    static func read<T: Decodable>(from descriptor: Int32, deadline: UInt64) throws -> T {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while data.count < maximumBytes {
            try wait(descriptor, events: Int16(POLLIN), deadline: deadline)
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress!, $0.count) }
            if count < 0, errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK { continue }
            guard count > 0 else { throw updateManagedError("control_closed") }
            data.append(contentsOf: buffer.prefix(count))
            guard data.count <= maximumBytes else { throw updateManagedError("control_message_too_large") }
            if let end = data.firstIndex(of: 10) {
                guard end == data.count - 1 else { throw updateManagedError("control_message_invalid") }
                return try JSONDecoder().decode(T.self, from: data.prefix(upTo: end))
            }
        }
        throw updateManagedError("control_message_too_large")
    }

    private static func wait(_ descriptor: Int32, events: Int16, deadline: UInt64) throws {
        while true {
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline else { throw updateManagedError("control_timeout") }
            var item = pollfd(fd: descriptor, events: events, revents: 0)
            let remaining = Int32(min(UInt64(Int32.max), max(1, (deadline - now) / 1_000_000)))
            let result = poll(&item, 1, remaining)
            if result < 0, errno == EINTR { continue }
            guard result >= 0 else { throw updateManagedError("control_closed") }
            if result == 0 { throw updateManagedError("control_timeout") }
            if item.revents & events != 0 { return }
            if item.revents & Int16(POLLERR | POLLHUP | POLLNVAL) != 0 {
                throw updateManagedError("control_closed")
            }
        }
    }

    private static func withAddress<T>(_ path: String,
        _ operation: (UnsafePointer<sockaddr>, socklen_t) throws -> T) throws -> T {
        var address = sockaddr_un()
        let bytes = Array(path.utf8) + [0]
        guard path.hasPrefix("/"), !path.utf8.contains(0),
              bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            throw updateManagedError("control_socket_invalid")
        }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        address.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
        return try withUnsafePointer(to: &address) {
            try $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                try operation($0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
    }
}

private func updateManagedError(_ suffix: String) -> CoordinatorError {
    CoordinatorError("update_managed_" + suffix)
}
