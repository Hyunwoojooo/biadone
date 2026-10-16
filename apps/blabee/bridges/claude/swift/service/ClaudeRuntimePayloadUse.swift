import CoordinatorSwift
import Darwin
import Foundation

/// Persistent evidence of potential payload use, not a live PID registry.
/// Dropping this object, owner death and successful app replacement never
/// delete its record. Only the owner with positive no-child/reaped evidence
/// calls complete(). No role capabilities or user content are serialized.
final class ClaudeRuntimePayloadUse: @unchecked Sendable {
    enum Status: Equatable, Sendable { case clear, inUse, unavailable }
    /// Counts durable evidence, not running Claude sessions. Neither PID
    /// disappearance nor a detached native executable proves these children
    /// stopped using their pinned capabilities or payload generation.
    struct UpdateInspection: Equatable, Sendable {
        let status: Status
        let outstandingUseCount: Int?
        let referencedRuntimeIdentities: Set<String>
    }
    private struct UseRecord {
        let id: String
        let data: Data
        let runtimeIdentity: String
    }
    static let maximumUseRecords = 4096
    private let lock = NSLock()
    private let storeRootURL: URL
    private let useID: UUID
    private let record: Data
    private let processID: pid_t
    private var completed = false

    private init(storeRootURL: URL, useID: UUID, record: Data) {
        self.storeRootURL = storeRootURL; self.useID = useID; self.record = record
        processID = getpid()
    }

    static func begin(prepared: ClaudeRuntimePayload.Prepared, runtimeIdentity: String,
                      storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL) throws -> ClaudeRuntimePayloadUse {
        guard OperationalRuntimeIdentity.isValid(runtimeIdentity) else { throw ClaudePayloadFS.unavailable() }
        let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: true)
        defer { admission.release() }
        try ClaudeRuntimePayload.verifyPrepared(prepared, storeRootURL: storeRootURL)
        // Malformed existing evidence blocks both new use and installation.
        guard try readRecords(root: admission.root).count < maximumUseRecords else { throw ClaudePayloadFS.unavailable() }
        let uses = try ClaudePayloadFS.privateDirectory(parent: admission.root, name: "uses", create: true)
        defer { close(uses) }
        let id = UUID()
        let record = try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-runtime-use.v1", "use_id": id.uuidString.lowercased(),
            "payload_digest": prepared.digest, "runtime_identity": runtimeIdentity,
        ])
        let temporary = ".registering-" + id.uuidString.lowercased()
        try ClaudePayloadFS.writeNew(parent: uses, name: temporary, data: record)
        try admission.verify()
        guard renameatx_np(uses, temporary, uses, id.uuidString.lowercased() + ".json", UInt32(RENAME_EXCL)) == 0 else {
            throw ClaudePayloadFS.unavailable()
        }
        try ClaudePayloadFS.sync(uses)
        return .init(storeRootURL: storeRootURL, useID: id, record: record)
    }

    /// Caller must know that spawning never happened or its actual child has
    /// been reaped. There is intentionally no automatic deinit/atexit cleanup.
    func complete() throws {
        try lock.withLock {
            guard processID == getpid() else { throw ClaudePayloadFS.unavailable() }
            if completed { return }
            let admission = try Self.completionAdmission(rootURL: storeRootURL)
            defer { admission.release() }
            let records = try Self.readRecords(root: admission.root)
            guard records[useID.uuidString.lowercased()]?.data == record else { throw ClaudePayloadFS.unavailable() }
            let uses = try ClaudePayloadFS.privateDirectory(parent: admission.root, name: "uses", create: false)
            defer { close(uses) }
            // Re-read the exact file immediately before unlinking; another
            // token, corrupt file or replaced name never becomes our cleanup.
            let name = useID.uuidString.lowercased() + ".json"
            guard try Self.readRecord(parent: uses, name: name).data == record else { throw ClaudePayloadFS.unavailable() }
            try admission.verify()
            guard unlinkat(uses, name, 0) == 0 else { throw ClaudePayloadFS.unavailable() }
            try ClaudePayloadFS.sync(uses)
            completed = true
        }
    }

    private static func completionAdmission(rootURL: URL) throws -> ClaudePayloadAdmission {
        let clock = SystemCoordinatorContinuousClock()
        let (deadline, overflow) = clock.nowNanoseconds().addingReportingOverflow(5_000_000_000)
        guard !overflow else { throw ClaudePayloadFS.unavailable() }
        while true {
            do { return try ClaudePayloadAdmission.acquire(rootURL: rootURL, create: false, reportContention: true) }
            catch let error as CoordinatorError where error.code == "claude_runtime_admission_busy" {
                guard clock.nowNanoseconds() < deadline else { throw ClaudePayloadFS.unavailable() }
                usleep(10_000)
            }
        }
    }

    /// Advisory read only. A missing store is clear; uncertainty, a concurrent
    /// admission or a malformed record is unavailable. Never looks up a PID.
    static func inspect(storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL) -> Status {
        inspectForUpdate(storeRootURL: storeRootURL).status
    }

    /// A valid record still blocks service replacement: current Claude role
    /// grants bind to one service incarnation and cannot be renewed in-place
    /// across that boundary. A runtime copy alone must never waive this rule.
    /// An unavailable result provides no complete count or retention set.
    static func inspectForUpdate(storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL) -> UpdateInspection {
        do {
            guard let existing = try ClaudePayloadFS.openAbsoluteDirectory(storeRootURL, create: false) else {
                return .init(status: .clear, outstandingUseCount: 0, referencedRuntimeIdentities: [])
            }
            close(existing)
            let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: false)
            defer { admission.release() }
            let records = try readRecords(root: admission.root)
            try admission.verify()
            return .init(status: records.isEmpty ? .clear : .inUse, outstandingUseCount: records.count,
                         referencedRuntimeIdentities: Set(records.values.map(\.runtimeIdentity)))
        } catch {
            return .init(status: .unavailable, outstandingUseCount: nil, referencedRuntimeIdentities: [])
        }
    }

    final class InstallationGuard: @unchecked Sendable {
        private let admission: ClaudePayloadAdmission
        fileprivate init(_ admission: ClaudePayloadAdmission) { self.admission = admission }
        func release() { admission.release() }
        deinit { release() }
    }

    /// Keep this guard alive through publication AND rollback. Runtime users
    /// must hold their existing app executable lease before taking admission;
    /// all admission locks are nonblocking so inverse contention cannot wait.
    static func acquireInstallationGuard(storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL) throws -> InstallationGuard {
        let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: true)
        do {
            guard try readRecords(root: admission.root).isEmpty else { throw CoordinatorError("claude_runtime_in_use") }
            try admission.verify()
            return InstallationGuard(admission)
        } catch { admission.release(); throw error }
    }

    private static func readRecords(root: Int32) throws -> [String: UseRecord] {
        var metadata = stat()
        if fstatat(root, "uses", &metadata, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT else { throw ClaudePayloadFS.unavailable() }
            return [:]
        }
        let uses = try ClaudePayloadFS.privateDirectory(parent: root, name: "uses", create: false)
        defer { close(uses) }
        let names = try ClaudePayloadFS.names(uses)
        guard names.count <= maximumUseRecords else { throw ClaudePayloadFS.unavailable() }
        var records: [String: UseRecord] = [:]
        for name in names {
            let record = try readRecord(parent: uses, name: name)
            guard records.updateValue(record, forKey: record.id) == nil else { throw ClaudePayloadFS.unavailable() }
        }
        return records
    }

    private static func readRecord(parent: Int32, name: String) throws -> UseRecord {
        guard name.hasSuffix(".json") else { throw ClaudePayloadFS.unavailable() }
        let id = String(name.dropLast(5))
        guard UUID(uuidString: id)?.uuidString.lowercased() == id else { throw ClaudePayloadFS.unavailable() }
        let descriptor = try ClaudePayloadFS.openRegular(parent: parent, name: name)
        defer { close(descriptor) }
        let metadata = try ClaudePayloadFS.info(descriptor)
        guard metadata.st_uid == geteuid(), metadata.st_mode & 0o7777 == 0o600 else { throw ClaudePayloadFS.unavailable() }
        let data = try ClaudePayloadFS.read(descriptor, maximumBytes: 4096)
        guard let value = try? StrictJSONTransport.object(from: data, limits: .init(maximumBytes: 4096, maximumDepth: 2)),
              Set(value.keys) == ["schema_version", "use_id", "payload_digest", "runtime_identity"],
              value["schema_version"] as? String == "blabee.claude-runtime-use.v1", value["use_id"] as? String == id,
              let digest = value["payload_digest"] as? String, ClaudeRuntimePayload.validDigest(digest),
              let runtime = value["runtime_identity"] as? String, OperationalRuntimeIdentity.isValid(runtime) else {
            throw ClaudePayloadFS.unavailable()
        }
        return .init(id: id, data: data, runtimeIdentity: runtime)
    }
}

/// One persistent inode is the admission authority. Root and lock replacement
/// fail closed. close(), not LOCK_UN, prevents a forked descriptor's cleanup
/// from explicitly releasing another process's shared open-file description.
final class ClaudePayloadAdmission: @unchecked Sendable {
    let root: Int32
    private let rootURL: URL
    private let lockDescriptor: Int32
    private let rootIdentity: stat
    private let fileIdentity: stat
    private let state = NSLock()
    private var released = false

    private init(root: Int32, rootURL: URL, lockDescriptor: Int32, rootIdentity: stat, fileIdentity: stat) {
        self.root = root; self.rootURL = rootURL; self.lockDescriptor = lockDescriptor
        self.rootIdentity = rootIdentity; self.fileIdentity = fileIdentity
    }

    static func acquire(rootURL: URL, create: Bool, reportContention: Bool = false) throws -> ClaudePayloadAdmission {
        guard let root = try ClaudePayloadFS.openAbsoluteDirectory(rootURL, create: create) else { throw ClaudePayloadFS.unavailable() }
        var lock: Int32 = -1
        var ownsRoot = true
        do {
            let rootInfo = try ClaudePayloadFS.info(root)
            guard rootInfo.st_uid == geteuid(), rootInfo.st_mode & 0o7777 == 0o700,
                  Set(try ClaudePayloadFS.names(root)).isSubset(of: ["admission.lock", "payloads", "uses"]) else {
                throw ClaudePayloadFS.unavailable()
            }
            lock = openat(root, "admission.lock", O_RDWR | O_NOFOLLOW | O_CLOEXEC | (create ? O_CREAT : 0), 0o600)
            guard lock >= 0 else { throw ClaudePayloadFS.unavailable() }
            let fileInfo = try ClaudePayloadFS.info(lock)
            guard fileInfo.st_mode & S_IFMT == S_IFREG, fileInfo.st_mode & 0o7777 == 0o600,
                  fileInfo.st_uid == geteuid(), fileInfo.st_nlink == 1, fileInfo.st_size == 0 else { throw ClaudePayloadFS.unavailable() }
            guard flock(lock, LOCK_EX | LOCK_NB) == 0 else {
                if reportContention, errno == EWOULDBLOCK { throw CoordinatorError("claude_runtime_admission_busy") }
                throw ClaudePayloadFS.unavailable()
            }
            if create { try ClaudePayloadFS.sync(root) }
            let admission = ClaudePayloadAdmission(root: root, rootURL: rootURL, lockDescriptor: lock,
                                                   rootIdentity: rootInfo, fileIdentity: fileInfo)
            // Ownership transfers after nonthrowing initialization; verify's
            // failure path closes only through this object's release().
            lock = -1
            ownsRoot = false
            do { try admission.verify(); return admission }
            catch { admission.release(); throw error }
        } catch {
            if lock >= 0 { close(lock) }
            if ownsRoot { close(root) }
            throw error
        }
    }

    func verify() throws {
        try state.withLock {
            guard !released, let namedRoot = try ClaudePayloadFS.openAbsoluteDirectory(rootURL, create: false) else {
                throw ClaudePayloadFS.unavailable()
            }
            defer { close(namedRoot) }
            let value = try ClaudePayloadFS.info(namedRoot)
            var namedLock = stat()
            guard value.st_dev == rootIdentity.st_dev, value.st_ino == rootIdentity.st_ino,
                  value.st_uid == geteuid(), value.st_mode & 0o7777 == 0o700,
                  fstatat(root, "admission.lock", &namedLock, AT_SYMLINK_NOFOLLOW) == 0,
                  ClaudePayloadFS.same(fileIdentity, namedLock),
                  ClaudePayloadFS.same(fileIdentity, try ClaudePayloadFS.info(lockDescriptor)) else { throw ClaudePayloadFS.unavailable() }
        }
    }
    func release() {
        state.withLock {
            guard !released else { return }
            released = true; close(lockDescriptor); close(root)
        }
    }
    deinit { release() }
}
