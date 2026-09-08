import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation

/// Durable negative evidence only. A missing record still requires the caller's
/// normal trust checks; a successful attempt never creates a trust receipt.
/// A completed operation keeps its result even when cleanup fails. Such a
/// failure blocks later attempts with uncertainty until explicit recovery;
/// disk restoration is best effort, backed by bounded process-local memory.
final class CodexNativeFailureGuard: @unchecked Sendable {
    private static let processMutex = DispatchSemaphore(value: 1)
    // Accessed only while processMutex is held. If negative-memory capacity is
    // exhausted, retain all evidence and fail closed for the process lifetime.
    private nonisolated(unsafe) static var uncertainIdentities: [String: String] = [:]
    private nonisolated(unsafe) static var uncertaintyOverflowNamespace: String?

    enum StorageEvent: Sendable {
        case unlinkRecord
        case synchronizeFile
        case synchronizeDirectory
    }
    private static let maximumRecords = 32
    private static let maximumRecordBytes = 1_024
    private static let uncertainCode = "codex_native_execution_uncertain"
    private static let storedCodes: Set<String> = [
        "codex_native_version_unqualified",
        "codex_native_signature_invalid",
        "codex_native_notarization_unavailable",
        "codex_native_execution_terminated",
        "codex_native_launch_unavailable",
        "codex_native_probe_timeout",
        "codex_native_probe_output_invalid",
        uncertainCode,
    ]

    private struct Identity: Equatable {
        let key: String
        let digest: String
    }

    private struct Record: Codable {
        let schemaVersion: Int
        let key: String
        let identity: String
        let code: String
    }

    private let directoryURL: URL
    private let policyRevision: String
    private let memoryNamespace: String
    private let storageFault: @Sendable (StorageEvent) throws -> Void

    static func live(policyRevision: String = "native-v1") -> CodexNativeFailureGuard {
        // Resolve the OS account directly; HOME and CODEX_HOME are untrusted
        // child-process configuration and cannot relocate this failure memory.
        var buffer = [CChar](repeating: 0, count: 16_384)
        let home: String? = buffer.withUnsafeMutableBufferPointer { buffer in
            var account = passwd()
            var result: UnsafeMutablePointer<passwd>?
            let status = getpwuid_r(
                geteuid(), &account, buffer.baseAddress, buffer.count, &result
            )
            guard status == 0, result != nil, let path = account.pw_dir else { return nil }
            // pw_dir points into buffer and must be copied while it is pinned.
            return String(cString: path)
        }
        guard let home, home.hasPrefix("/") else {
            return CodexNativeFailureGuard(
                directoryURL: URL(string: "blabee-native-guard-unavailable:")!,
                policyRevision: policyRevision
            )
        }
        return CodexNativeFailureGuard(
            directoryURL: URL(fileURLWithPath: home, isDirectory: true)
                .appendingPathComponent(
                    "Library/Application Support/Blabee/runtime/native-codex-failures",
                    isDirectory: true
                ),
            policyRevision: policyRevision
        )
    }

    init(
        directoryURL: URL,
        policyRevision: String = "native-v1",
        storageFault: @escaping @Sendable (StorageEvent) throws -> Void = { _ in }
    ) {
        self.directoryURL = directoryURL.standardizedFileURL
        self.policyRevision = policyRevision
        // Filesystem-dependent URL resolution differs before/after mkdir.
        // Use exactly the stable path normalization enforced by traversal.
        memoryNamespace = Self.digest(Self.storagePath(self.directoryURL))
        self.storageFault = storageFault
    }

    func withAttempt<T>(
        executable: URL,
        retry: Bool = false,
        waitTimeoutMilliseconds: Int = 2_000,
        operation: () throws -> T
    ) throws -> T {
        try withStorage(waitTimeoutMilliseconds: waitTimeoutMilliseconds) { directory in
            let identity = try executableIdentity(executable)
            let memoryKey = self.memoryKey(for: identity)
            guard Self.uncertaintyOverflowNamespace == nil else { throw Self.unavailable() }
            if let uncertain = Self.uncertainIdentities[memoryKey] {
                if uncertain == identity.digest, !retry {
                    throw CoordinatorError(Self.uncertainCode)
                }
                if uncertain != identity.digest {
                    Self.uncertainIdentities.removeValue(forKey: memoryKey)
                }
            }
            let slot = try findSlot(directory: directory, key: identity.key)
            guard !slot.name.isEmpty else { throw Self.unavailable() }
            if let existing = slot.record,
               existing.identity == identity.digest, !retry
            {
                throw CoordinatorError(existing.code)
            }

            // fsync precedes the callback: termination anywhere after this
            // point cannot silently reopen the executable on the next launch.
            try writeRecord(
                Record(schemaVersion: 1, key: identity.key,
                       identity: identity.digest, code: Self.uncertainCode),
                directory: directory, name: slot.name
            )
            // Explicit retry may release memory only after uncertainty is
            // durable again. A failed record write never reopens the callback.
            Self.uncertainIdentities.removeValue(forKey: memoryKey)
            let result: T
            do {
                // Replacing the binary while we prepared storage must not
                // turn the original snapshot into permission for a new file.
                guard try executableIdentity(executable) == identity else {
                    throw Self.unavailable()
                }
                result = try operation()
            } catch {
                let originalError = error
                if let current = try? executableIdentity(executable), current == identity,
                   let failure = originalError as? CoordinatorError,
                   Self.storedCodes.contains(failure.code)
                {
                    try writeRecord(
                        Record(schemaVersion: 1, key: identity.key,
                               identity: identity.digest, code: failure.code),
                        directory: directory, name: slot.name
                    )
                } else {
                    // Non-native failures are not evidence against this binary.
                    // A replacement must never inherit the previous one's error.
                    try removeRecord(directory: directory, name: slot.name)
                }
                throw originalError
            }

            // Execution success is already authoritative. Bookkeeping failure
            // must not be returned as a retryable execution failure.
            do {
                try removeRecord(directory: directory, name: slot.name)
            } catch {
                rememberUncertain(identity, key: memoryKey)
                // unlink may have succeeded before its directory fsync failed.
                // Restore the durable block when possible, without calling the
                // operation again or changing its known successful result.
                try? writeRecord(
                    Record(schemaVersion: 1, key: identity.key,
                           identity: identity.digest, code: Self.uncertainCode),
                    directory: directory, name: slot.name
                )
            }
            return result
        }
    }

    /// Explicit recovery is a no-op when either the executable or storage is
    /// absent. Existing unsafe storage still fails closed and is never repaired.
    func clearFailure(executable: URL) throws {
        guard executable.isFileURL else { throw Self.unavailable() }
        for path in [executable.path, directoryURL.path] {
            var info = stat()
            if stat(path, &info) != 0 {
                if errno == ENOENT || errno == ENOTDIR { return }
                throw Self.unavailable()
            }
        }
        try withStorage { directory in
            let identity = try executableIdentity(executable)
            let slot = try findSlot(directory: directory, key: identity.key)
            if let record = slot.record, record.identity == identity.digest {
                try removeRecord(directory: directory, name: slot.name)
            }
            let key = memoryKey(for: identity)
            if Self.uncertainIdentities[key] == identity.digest {
                Self.uncertainIdentities.removeValue(forKey: key)
            }
        }
    }

    /// Explicit user recovery only. Validate all bounded records before deleting
    /// any of them; never invoke a native callback or reset automatically when
    /// capacity is exhausted. This also recovers vanished paths and old policies
    /// that cannot be addressed by identity-specific clearFailure.
    func resetAllFailures() throws {
        try withStorage { directory in
            var identities: [(name: String, identity: stat)] = []
            for index in 0..<Self.maximumRecords {
                let name = String(format: "failure-%02d.json", index)
                guard try readRecord(directory: directory, name: name) != nil else { continue }
                let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
                guard descriptor >= 0 else { throw Self.unavailable() }
                let identity: stat
                do {
                    identity = try Self.requirePrivateFile(descriptor)
                    try Self.requireNamedFile(directory: directory, name: name, identity: identity)
                } catch {
                    close(descriptor)
                    throw error
                }
                close(descriptor)
                identities.append((name, identity))
            }
            // Pending writes can be incomplete after interruption, but they
            // still must have the same private, no-follow file properties.
            let pending = openat(directory, ".pending", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
            if pending >= 0 {
                do {
                    let identity = try Self.requirePrivateFile(pending)
                    guard identity.st_size <= Self.maximumRecordBytes else { throw Self.unavailable() }
                    try Self.requireNamedFile(directory: directory, name: ".pending", identity: identity)
                    identities.append((".pending", identity))
                } catch {
                    close(pending)
                    throw error
                }
                close(pending)
            } else if errno != ENOENT { throw Self.unavailable() }
            // Complete validation precedes the first unlink, including the
            // named inode identities obtained for every target.
            for entry in identities {
                try Self.requireNamedFile(
                    directory: directory, name: entry.name, identity: entry.identity,
                    requireStableMetadata: true
                )
            }
            for entry in identities {
                try removeRecord(
                    directory: directory, name: entry.name, expectedIdentity: entry.identity
                )
            }
            let prefix = memoryNamespace + "."
            Self.uncertainIdentities = Self.uncertainIdentities.filter {
                !$0.key.hasPrefix(prefix)
            }
            if Self.uncertaintyOverflowNamespace == memoryNamespace {
                Self.uncertaintyOverflowNamespace = nil
            }
        }
    }

    private func memoryKey(for identity: Identity) -> String {
        memoryNamespace + "." + identity.key
    }

    private func rememberUncertain(_ identity: Identity, key: String) {
        if Self.uncertainIdentities[key] != nil
            || Self.uncertainIdentities.count < Self.maximumRecords
        {
            Self.uncertainIdentities[key] = identity.digest
        } else {
            Self.uncertaintyOverflowNamespace = memoryNamespace
        }
    }

    private func synchronizeDirectory(_ descriptor: Int32) throws {
        try storageFault(.synchronizeDirectory)
        guard fsync(descriptor) == 0 else { throw Self.unavailable() }
    }

    private func executableIdentity(_ executable: URL) throws -> Identity {
        guard executable.isFileURL, !executable.path.utf8.contains(0) else {
            throw Self.unavailable()
        }
        let canonical = executable.resolvingSymlinksInPath().standardizedFileURL.path
        let descriptor = open(canonical, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw Self.unavailable() }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
        else { throw Self.unavailable() }
        let fields = [
            canonical, String(info.st_dev), String(info.st_ino), String(info.st_mode),
            String(info.st_uid), String(info.st_gid), String(info.st_size),
            String(info.st_mtimespec.tv_sec), String(info.st_mtimespec.tv_nsec),
            String(info.st_ctimespec.tv_sec), String(info.st_ctimespec.tv_nsec), policyRevision,
        ]
        // Length prefixes make arbitrary filenames and policy strings unambiguous.
        let material = fields.map { "\($0.utf8.count):\($0)" }.joined()
        let keyMaterial = [canonical, policyRevision]
            .map { "\($0.utf8.count):\($0)" }.joined()
        return Identity(key: Self.digest(keyMaterial), digest: Self.digest(material))
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func findSlot(
        directory: Int32, key: String
    ) throws -> (name: String, record: Record?) {
        var firstEmpty: String?
        var matched: (String, Record)?
        for index in 0..<Self.maximumRecords {
            let name = String(format: "failure-%02d.json", index)
            if let record = try readRecord(directory: directory, name: name) {
                if record.key == key {
                    guard matched == nil else { throw Self.unavailable() }
                    matched = (name, record)
                }
            } else if firstEmpty == nil {
                firstEmpty = name
            }
        }
        if let matched { return (matched.0, matched.1) }
        // A clear of a missing entry remains a no-op even at capacity. Only
        // withAttempt requires a free slot before it may invoke a callback.
        return (firstEmpty ?? "", nil)
    }

    private func readRecord(directory: Int32, name: String) throws -> Record? {
        let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if descriptor < 0, errno == ENOENT { return nil }
        guard descriptor >= 0 else { throw Self.unavailable() }
        defer { close(descriptor) }
        let before = try Self.requirePrivateFile(descriptor)
        guard before.st_size > 0, before.st_size <= Self.maximumRecordBytes else {
            throw Self.unavailable()
        }
        var bytes = [UInt8](repeating: 0, count: Int(before.st_size))
        var offset = 0
        while offset < bytes.count {
            let count = bytes.withUnsafeMutableBytes {
                read(descriptor, $0.baseAddress!.advanced(by: offset), $0.count - offset)
            }
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { throw Self.unavailable() }
            offset += count
        }
        try Self.requireNamedFile(directory: directory, name: name, identity: before)
        guard let record = try? JSONDecoder().decode(Record.self, from: Data(bytes)),
              record.schemaVersion == 1,
              Self.isDigest(record.key), Self.isDigest(record.identity),
              Self.storedCodes.contains(record.code)
        else { throw Self.unavailable() }
        return record
    }

    private static func isDigest(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        }
    }

    private func writeRecord(_ record: Record, directory: Int32, name: String) throws {
        let data = try JSONEncoder().encode(record)
        guard data.count <= Self.maximumRecordBytes else { throw Self.unavailable() }
        // A crash may leave this fixed temporary name. It is safe to discard
        // under the lock because the callback begins only after atomic rename.
        try removeRecord(directory: directory, name: ".pending")
        let descriptor = openat(
            directory, ".pending", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else { throw Self.unavailable() }
        defer { close(descriptor) }
        let identity = try Self.requirePrivateFile(descriptor)
        var offset = 0
        while offset < data.count {
            let count = data.withUnsafeBytes {
                write(descriptor, $0.baseAddress!.advanced(by: offset), $0.count - offset)
            }
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { throw Self.unavailable() }
            offset += count
        }
        try storageFault(.synchronizeFile)
        guard fsync(descriptor) == 0 else { throw Self.unavailable() }
        try Self.requireNamedFile(directory: directory, name: ".pending", identity: identity)
        // Validate the destination before replacing it, even though it was
        // checked during slot selection and our directory is private.
        _ = try readRecord(directory: directory, name: name)
        guard renameat(directory, ".pending", directory, name) == 0 else {
            throw Self.unavailable()
        }
        try synchronizeDirectory(directory)
    }

    private func removeRecord(
        directory: Int32, name: String, expectedIdentity: stat? = nil
    ) throws {
        let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if descriptor < 0, errno == ENOENT {
            guard expectedIdentity == nil else { throw Self.unavailable() }
            return
        }
        guard descriptor >= 0 else { throw Self.unavailable() }
        defer { close(descriptor) }
        let identity = try Self.requirePrivateFile(descriptor)
        if let expectedIdentity {
            guard identity.st_dev == expectedIdentity.st_dev,
                  identity.st_ino == expectedIdentity.st_ino,
                  identity.st_size == expectedIdentity.st_size,
                  identity.st_mtimespec.tv_sec == expectedIdentity.st_mtimespec.tv_sec,
                  identity.st_mtimespec.tv_nsec == expectedIdentity.st_mtimespec.tv_nsec,
                  identity.st_ctimespec.tv_sec == expectedIdentity.st_ctimespec.tv_sec,
                  identity.st_ctimespec.tv_nsec == expectedIdentity.st_ctimespec.tv_nsec
            else { throw Self.unavailable() }
        }
        guard identity.st_size <= Self.maximumRecordBytes else { throw Self.unavailable() }
        try Self.requireNamedFile(directory: directory, name: name, identity: identity)
        if name.hasPrefix("failure-") { try storageFault(.unlinkRecord) }
        guard unlinkat(directory, name, 0) == 0 else { throw Self.unavailable() }
        try synchronizeDirectory(directory)
    }

    private func withStorage<T>(
        waitTimeoutMilliseconds: Int = 2_000,
        _ operation: (Int32) throws -> T
    ) throws -> T {
        let wait = max(0, min(waitTimeoutMilliseconds, 2_000))
        let deadline = DispatchTime.now() + .milliseconds(wait)
        guard Self.processMutex.wait(timeout: deadline) == .success else {
            throw CoordinatorError("codex_native_execution_in_progress")
        }
        defer { Self.processMutex.signal() }
        let directory = try openDirectory()
        defer { close(directory) }
        let lock = openat(
            directory, ".lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK,
            mode_t(0o600)
        )
        guard lock >= 0 else { throw Self.unavailable() }
        defer { close(lock) }
        let identity = try Self.requirePrivateFile(lock)
        guard identity.st_size == 0 else { throw Self.unavailable() }
        while flock(lock, LOCK_EX | LOCK_NB) != 0 {
            let lockError = errno
            guard lockError == EINTR || lockError == EWOULDBLOCK || lockError == EAGAIN else {
                throw Self.unavailable()
            }
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < deadline.uptimeNanoseconds else {
                throw CoordinatorError("codex_native_execution_in_progress")
            }
            if lockError == EINTR { continue }
            let remainingMicroseconds = (deadline.uptimeNanoseconds - now) / 1_000
            let delay = useconds_t(min(10_000, remainingMicroseconds))
            if delay > 0 { usleep(delay) }
        }
        defer { _ = flock(lock, LOCK_UN) }
        try Self.requireNamedFile(directory: directory, name: ".lock", identity: identity)
        return try operation(directory)
    }

    private static func storagePath(_ directoryURL: URL) -> String {
        var path = directoryURL.path
        while path.count > 1, path.hasSuffix("/") { path.removeLast() }
        if path == "/tmp" || path.hasPrefix("/tmp/") { path = "/private" + path }
        if path == "/var" || path.hasPrefix("/var/") { path = "/private" + path }
        return path
    }

    private func openDirectory() throws -> Int32 {
        let path = Self.storagePath(directoryURL)
        guard directoryURL.isFileURL, path.hasPrefix("/"), !path.utf8.contains(0) else {
            throw Self.unavailable()
        }
        let components = path.split(separator: "/").map(String.init)
        guard !components.isEmpty else { throw Self.unavailable() }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw Self.unavailable() }
        do {
            try Self.requireDirectory(descriptor, path: "/", privateOwner: false)
            var currentPath = ""
            for (index, component) in components.enumerated() {
                currentPath += "/" + component
                var created = false
                var next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0, errno == ENOENT {
                    guard mkdirat(descriptor, component, mode_t(0o700)) == 0 || errno == EEXIST else {
                        throw Self.unavailable()
                    }
                    created = true
                    next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else { throw Self.unavailable() }
                do {
                    try Self.requireDirectory(
                        next, path: currentPath,
                        privateOwner: created || index == components.count - 1
                    )
                    // Persist each newly created ancestor entry before a native
                    // callback can rely on records beneath that directory.
                    if created { try synchronizeDirectory(descriptor) }
                } catch {
                    close(next)
                    throw error
                }
                close(descriptor)
                descriptor = next
            }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }

    private static func requireDirectory(_ descriptor: Int32, path: String, privateOwner: Bool) throws {
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              info.st_uid == 0 || info.st_uid == geteuid()
        else { throw unavailable() }
        let systemTemporary = path == "/private/tmp" && info.st_uid == 0
            && info.st_mode & 0o7777 == 0o1777
        guard (info.st_mode & 0o022 == 0 || systemTemporary),
              !privateOwner || (info.st_uid == geteuid() && info.st_mode & 0o777 == 0o700)
        else { throw unavailable() }
        try requireNoGrantACL(descriptor)
    }

    private static func requirePrivateFile(_ descriptor: Int32) throws -> stat {
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_mode & 0o777 == 0o600,
              info.st_uid == geteuid(), info.st_nlink == 1
        else { throw unavailable() }
        try requireNoGrantACL(descriptor)
        return info
    }

    private static func requireNamedFile(
        directory: Int32, name: String, identity: stat,
        requireStableMetadata: Bool = false
    ) throws {
        var named = stat()
        guard fstatat(directory, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              named.st_dev == identity.st_dev, named.st_ino == identity.st_ino,
              named.st_uid == geteuid(), named.st_mode & 0o777 == 0o600,
              named.st_nlink == 1
        else { throw unavailable() }
        if requireStableMetadata {
            guard named.st_size == identity.st_size,
                  named.st_mtimespec.tv_sec == identity.st_mtimespec.tv_sec,
                  named.st_mtimespec.tv_nsec == identity.st_mtimespec.tv_nsec,
                  named.st_ctimespec.tv_sec == identity.st_ctimespec.tv_sec,
                  named.st_ctimespec.tv_nsec == identity.st_ctimespec.tv_nsec
            else { throw unavailable() }
        }
    }

    private static func requireNoGrantACL(_ descriptor: Int32) throws {
        errno = 0
        let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let aclError = errno
        if let acl {
            let containsGrant = blabeeExtendedACLContainsGrant(acl)
            acl_free(UnsafeMutableRawPointer(acl))
            guard containsGrant == false else { throw unavailable() }
        }
        guard acl != nil || aclError == ENOENT else { throw unavailable() }
    }

    private static func unavailable() -> CoordinatorError {
        CoordinatorError("codex_native_guard_unavailable")
    }
}
