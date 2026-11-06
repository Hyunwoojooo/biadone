import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation

/// Persistent evidence of potential payload use, not a live PID registry.
/// Owner death does not prove child exit. Completion requires positive reaped
/// evidence; recovery instead requires a kernel-proved later boot. No role
/// capabilities or user content are serialized.
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
    enum RecoveryPreparation: Equatable, Sendable {
        case clear
        case restartRequired(outstandingUseCount: Int)
    }
    typealias BootSessionIDProvider = @Sendable () throws -> String
    private struct UseRecord {
        let id: String
        let data: Data
        let runtimeIdentity: String
        let bootSessionID: String?
    }
    static let maximumUseRecords = 4096
    private let lock = NSLock()
    private let storeRootURL: URL
    private let useID: UUID
    private let record: Data
    private let recordFingerprint: FileFingerprint
    private let processID: pid_t
    private var completed = false

    private init(storeRootURL: URL, useID: UUID, record: Data, fingerprint: FileFingerprint) {
        self.storeRootURL = storeRootURL; self.useID = useID; self.record = record
        recordFingerprint = fingerprint
        processID = getpid()
    }

    static func begin(prepared: ClaudeRuntimePayload.Prepared, runtimeIdentity: String,
                      storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL,
                      bootSessionID: BootSessionIDProvider = systemBootSessionID) throws -> ClaudeRuntimePayloadUse {
        guard OperationalRuntimeIdentity.isValid(runtimeIdentity) else { throw ClaudePayloadFS.unavailable() }
        let boot = try validatedBootSessionID(bootSessionID)
        let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: true)
        defer { admission.release() }
        _ = try recoverLocked(admission, boot: boot)
        try ClaudeRuntimePayload.verifyPrepared(prepared, storeRootURL: storeRootURL)
        // Malformed existing evidence blocks both new use and installation.
        guard try readRecords(root: admission.root).count < maximumUseRecords else { throw ClaudePayloadFS.unavailable() }
        let uses = try ClaudePayloadFS.privateDirectory(parent: admission.root, name: "uses", create: true)
        defer { close(uses) }
        let usesIdentity = try ClaudePayloadFS.info(uses)
        let id = UUID()
        let record = try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-runtime-use.v2", "use_id": id.uuidString.lowercased(),
            "payload_digest": prepared.digest, "runtime_identity": runtimeIdentity,
            "boot_session_id": boot,
        ])
        let temporary = ".registering-" + boot + "-" + id.uuidString.lowercased()
        try ClaudePayloadFS.writeNew(parent: uses, name: temporary, data: record)
        let staged = try snapshot(parent: uses, name: temporary, maximumBytes: 4096)
        try admission.verify()
        try verifyUses(admission: admission, descriptor: uses, identity: usesIdentity)
        try verifyNamed(parent: uses, snapshot: staged)
        guard renameatx_np(uses, temporary, uses, id.uuidString.lowercased() + ".json", UInt32(RENAME_EXCL)) == 0 else {
            throw ClaudePayloadFS.unavailable()
        }
        try ClaudePayloadFS.sync(uses)
        let published = try snapshot(parent: uses, name: id.uuidString.lowercased() + ".json", maximumBytes: 4096)
        guard published.fingerprint == staged.fingerprint else { throw ClaudePayloadFS.unavailable() }
        try verifyUses(admission: admission, descriptor: uses, identity: usesIdentity)
        return .init(storeRootURL: storeRootURL, useID: id, record: record, fingerprint: published.fingerprint)
    }

    /// Caller must know that spawning never happened or its actual child has
    /// been reaped. There is intentionally no automatic deinit/atexit cleanup.
    func complete() throws {
        try lock.withLock {
            guard processID == getpid() else { throw ClaudePayloadFS.unavailable() }
            if completed { return }
            let admission = try Self.completionAdmission(rootURL: storeRootURL)
            defer { admission.release() }
            let uses = try ClaudePayloadFS.privateDirectory(parent: admission.root, name: "uses", create: false)
            defer { close(uses) }
            let usesIdentity = try ClaudePayloadFS.info(uses)
            // Re-read the exact file immediately before unlinking; another
            // token, corrupt file or replaced name never becomes our cleanup.
            let name = useID.uuidString.lowercased() + ".json"
            let owned = try Self.snapshot(parent: uses, name: name, maximumBytes: 4096)
            guard owned.data == record, owned.fingerprint == recordFingerprint else { throw ClaudePayloadFS.unavailable() }
            try Self.verifyUses(admission: admission, descriptor: uses, identity: usesIdentity)
            try Self.verifyNamed(parent: uses, snapshot: owned)
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
            try validateRecoveryMarker(admission: admission)
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
    static func acquireInstallationGuard(storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL,
                                        bootSessionID: BootSessionIDProvider = systemBootSessionID) throws -> InstallationGuard {
        let boot = try validatedBootSessionID(bootSessionID)
        let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: true)
        do {
            _ = try recoverLocked(admission, boot: boot)
            guard try readRecords(root: admission.root).isEmpty else { throw CoordinatorError("claude_runtime_in_use") }
            try admission.verify()
            return InstallationGuard(admission)
        } catch { admission.release(); throw error }
    }

    static let recoveryMarkerName = "recovery-after-restart.json"
    static let recoveryTemporaryName = ".recovery-after-restart.pending"
    private static let maximumRecoveryBytes = 2 * 1024 * 1024

    /// This kernel UUID changes on a system boot, not on logout, app restart,
    /// wall-clock adjustment or PID reuse. No fallback supplies weaker evidence.
    static func systemBootSessionID() throws -> String {
        var size = 0
        guard sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 1, size <= 128 else {
            throw ClaudePayloadFS.unavailable()
        }
        var buffer = [CChar](repeating: 0, count: size)
        let result = buffer.withUnsafeMutableBytes { sysctlbyname("kern.bootsessionuuid", $0.baseAddress, &size, nil, 0) }
        guard result == 0, size > 1, size <= buffer.count, buffer[size - 1] == 0,
              let raw = String(bytes: buffer.prefix(size - 1).map { UInt8(bitPattern: $0) }, encoding: .utf8),
              let id = UUID(uuidString: raw), id.uuidString.caseInsensitiveCompare(raw) == .orderedSame else {
            throw ClaudePayloadFS.unavailable()
        }
        return id.uuidString.lowercased()
    }

    /// Explicit preparation pins exact evidence for the next Mac boot. It does
    /// not release a use, terminate a process, or change payload/role authority.
    static func prepareRecoveryAfterRestart(storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL,
        bootSessionID: BootSessionIDProvider = systemBootSessionID) throws -> RecoveryPreparation {
        let boot = try validatedBootSessionID(bootSessionID)
        guard let existing = try ClaudePayloadFS.openAbsoluteDirectory(storeRootURL, create: false) else { return .clear }
        close(existing)
        let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: false)
        defer { admission.release() }
        let marker = try readMarker(root: admission.root)
        let uses = try openUses(root: admission.root)
        defer { if let uses { close(uses) } }
        let entries = try uses.map { try recoveryEntries(uses: $0) } ?? [:]
        // Explicit re-preparation may replace a structurally valid private
        // marker whose old inode/device fingerprints no longer match. It pins
        // only today's fully validated files and requires another boot; it
        // never converts the old marker into permission to delete them now.
        if let marker { try verifyNamed(parent: admission.root, snapshot: marker.file) }
        try discardUnpublishedMarker(admission: admission)
        guard let uses, !entries.isEmpty else {
            if let marker { try removeMarker(marker, admission: admission) }
            return .clear
        }
        let usesIdentity = try ClaudePayloadFS.info(uses)
        let value: [String: Any] = [
            "schema_version": "blabee.claude-runtime-recovery.v1", "boot_session_id": boot,
            "uses_device": String(usesIdentity.st_dev), "uses_inode": String(usesIdentity.st_ino),
            "records": entries.keys.sorted().map { entries[$0]!.file.fingerprint.object(name: $0) },
        ]
        let data = try StrictJSONTransport.data(forJSONObject: value)
        guard data.count <= maximumRecoveryBytes else { throw ClaudePayloadFS.unavailable() }
        try ClaudePayloadFS.writeNew(parent: admission.root, name: recoveryTemporaryName, data: data)
        let temporary = try snapshot(parent: admission.root, name: recoveryTemporaryName, maximumBytes: maximumRecoveryBytes)
        guard temporary.data == data else { throw ClaudePayloadFS.unavailable() }
        try verifyUses(admission: admission, descriptor: uses, identity: usesIdentity)
        for entry in entries.values { try verifyNamed(parent: uses, snapshot: entry.file) }
        if let marker { try verifyNamed(parent: admission.root, snapshot: marker.file) }
        try verifyNamed(parent: admission.root, snapshot: temporary)
        let flags: UInt32 = marker == nil ? UInt32(RENAME_EXCL) : 0
        guard renameatx_np(admission.root, recoveryTemporaryName, admission.root, recoveryMarkerName, flags) == 0 else {
            throw ClaudePayloadFS.unavailable()
        }
        try ClaudePayloadFS.sync(admission.root)
        let published = try snapshot(parent: admission.root, name: recoveryMarkerName, maximumBytes: maximumRecoveryBytes)
        guard published.fingerprint == temporary.fingerprint else { throw ClaudePayloadFS.unavailable() }
        try verifyUses(admission: admission, descriptor: uses, identity: usesIdentity)
        return .restartRequired(outstandingUseCount: entries.count)
    }

    /// A missing marker is normal: boot-bound v2 records prove prior-boot use
    /// directly. Legacy records require explicit preparation on an earlier boot.
    /// Returns only the number of exact evidence files removed, never sessions.
    @discardableResult
    static func recoverAfterRestart(storeRootURL: URL = ClaudeRuntimePayload.defaultStoreRootURL,
        bootSessionID: BootSessionIDProvider = systemBootSessionID) throws -> Int {
        let boot = try validatedBootSessionID(bootSessionID)
        guard let existing = try ClaudePayloadFS.openAbsoluteDirectory(storeRootURL, create: false) else { return 0 }
        close(existing)
        let admission = try ClaudePayloadAdmission.acquire(rootURL: storeRootURL, create: false)
        defer { admission.release() }
        return try recoverLocked(admission, boot: boot)
    }

    private struct FileFingerprint: Equatable {
        let device: Int64
        let inode: UInt64
        let size: Int64
        let sha256: String

        func object(name: String) -> [String: String] {
            ["name": name, "device": String(device), "inode": String(inode), "size": String(size), "sha256": sha256]
        }
    }
    private struct FileSnapshot {
        let name: String
        let data: Data
        let metadata: stat
        var fingerprint: FileFingerprint {
            .init(device: Int64(metadata.st_dev), inode: UInt64(metadata.st_ino), size: Int64(metadata.st_size),
                  sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
        }
    }
    private struct RecoveryEntry {
        let file: FileSnapshot
        let boot: String?
    }
    private struct RecoveryMarker {
        let file: FileSnapshot
        let boot: String
        let usesDevice: Int64
        let usesInode: UInt64
        let targets: [String: FileFingerprint]
    }

    private static func validUUID(_ value: String) -> Bool { UUID(uuidString: value)?.uuidString.lowercased() == value }
    private static func validatedBootSessionID(_ provider: BootSessionIDProvider) throws -> String {
        let value = try provider()
        guard validUUID(value), value != "00000000-0000-0000-0000-000000000000" else { throw ClaudePayloadFS.unavailable() }
        return value
    }
    private static func snapshot(parent: Int32, name: String, maximumBytes: Int) throws -> FileSnapshot {
        let descriptor = try ClaudePayloadFS.openRegular(parent: parent, name: name)
        defer { close(descriptor) }
        let metadata = try ClaudePayloadFS.info(descriptor)
        guard metadata.st_uid == geteuid(), metadata.st_mode & 0o7777 == 0o600 else { throw ClaudePayloadFS.unavailable() }
        let data = try ClaudePayloadFS.read(descriptor, maximumBytes: maximumBytes)
        let value = FileSnapshot(name: name, data: data, metadata: metadata)
        try verifyNamed(parent: parent, snapshot: value)
        return value
    }
    private static func verifyNamed(parent: Int32, snapshot: FileSnapshot) throws {
        var named = stat()
        guard fstatat(parent, snapshot.name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              ClaudePayloadFS.same(snapshot.metadata, named) else { throw ClaudePayloadFS.unavailable() }
    }
    private static func openUses(root: Int32) throws -> Int32? {
        var metadata = stat()
        if fstatat(root, "uses", &metadata, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT else { throw ClaudePayloadFS.unavailable() }
            return nil
        }
        return try ClaudePayloadFS.privateDirectory(parent: root, name: "uses", create: false)
    }
    private static func verifyUses(admission: ClaudePayloadAdmission, descriptor: Int32, identity: stat) throws {
        try admission.verify()
        try verifyUses(root: admission.root, descriptor: descriptor, identity: identity)
    }
    private static func verifyUses(root: Int32, descriptor: Int32, identity: stat) throws {
        var named = stat()
        let current = try ClaudePayloadFS.info(descriptor)
        guard fstatat(root, "uses", &named, AT_SYMLINK_NOFOLLOW) == 0,
              named.st_dev == identity.st_dev, named.st_ino == identity.st_ino,
              current.st_dev == identity.st_dev, current.st_ino == identity.st_ino,
              named.st_mode & S_IFMT == S_IFDIR, named.st_mode & 0o7777 == 0o700, named.st_uid == geteuid(),
              current.st_mode == named.st_mode, current.st_uid == named.st_uid else { throw ClaudePayloadFS.unavailable() }
    }

    /// Only writer-created names are eligible. Incomplete registration bytes
    /// can be retained safely because publication must precede child launch.
    private static func entryName(_ name: String) throws -> (id: String, partial: Bool, boot: String?) {
        if name.hasSuffix(".json"), validUUID(String(name.dropLast(5))) {
            return (String(name.dropLast(5)), false, nil)
        }
        guard name.hasPrefix(".registering-") else { throw ClaudePayloadFS.unavailable() }
        let suffix = String(name.dropFirst(".registering-".count))
        if validUUID(suffix) { return (suffix, true, nil) }
        guard suffix.utf8.count == 73 else { throw ClaudePayloadFS.unavailable() }
        let boot = String(suffix.prefix(36)), id = String(suffix.suffix(36))
        guard suffix[suffix.index(suffix.startIndex, offsetBy: 36)] == "-", validUUID(boot), validUUID(id),
              boot != "00000000-0000-0000-0000-000000000000" else { throw ClaudePayloadFS.unavailable() }
        return (id, true, boot)
    }
    private static func recoveryEntries(uses: Int32) throws -> [String: RecoveryEntry] {
        let names = try ClaudePayloadFS.names(uses)
        guard names.count <= maximumUseRecords else { throw ClaudePayloadFS.unavailable() }
        var result: [String: RecoveryEntry] = [:]
        for name in names {
            let parsed = try entryName(name)
            let file = try snapshot(parent: uses, name: name, maximumBytes: 4096)
            var boot = parsed.boot
            if !parsed.partial {
                boot = try parseRecord(name: name, data: file.data).bootSessionID
            } else if (try? StrictJSONTransport.object(from: file.data, limits: .init(maximumBytes: 4096, maximumDepth: 2))) != nil {
                let record = try parseRecord(name: parsed.id + ".json", data: file.data)
                guard record.bootSessionID == boot else { throw ClaudePayloadFS.unavailable() }
            }
            result[name] = .init(file: file, boot: boot)
        }
        return result
    }

    private static func readMarker(root: Int32) throws -> RecoveryMarker? {
        var metadata = stat()
        if fstatat(root, recoveryMarkerName, &metadata, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT else { throw ClaudePayloadFS.unavailable() }
            return nil
        }
        let file = try snapshot(parent: root, name: recoveryMarkerName, maximumBytes: maximumRecoveryBytes)
        let value = try StrictJSONTransport.object(from: file.data, limits: .init(maximumBytes: maximumRecoveryBytes, maximumDepth: 4))
        guard Set(value.keys) == ["schema_version", "boot_session_id", "uses_device", "uses_inode", "records"],
              value["schema_version"] as? String == "blabee.claude-runtime-recovery.v1",
              let boot = value["boot_session_id"] as? String, validUUID(boot),
              boot != "00000000-0000-0000-0000-000000000000",
              let deviceString = value["uses_device"] as? String, let device = Int64(deviceString), String(device) == deviceString,
              let inodeString = value["uses_inode"] as? String, let inode = UInt64(inodeString), String(inode) == inodeString,
              let raw = value["records"] as? [[String: String]], !raw.isEmpty, raw.count <= maximumUseRecords else {
            throw ClaudePayloadFS.unavailable()
        }
        var targets: [String: FileFingerprint] = [:]
        for target in raw {
            guard Set(target.keys) == ["name", "device", "inode", "size", "sha256"], let name = target["name"],
                  let deviceString = target["device"], let fileDevice = Int64(deviceString), String(fileDevice) == deviceString,
                  let inodeString = target["inode"], let fileInode = UInt64(inodeString), String(fileInode) == inodeString,
                  let sizeString = target["size"], let size = Int64(sizeString), String(size) == sizeString, (0...4096).contains(size),
                  let sha256 = target["sha256"], ClaudeRuntimePayload.validHash(sha256), targets[name] == nil else {
                throw ClaudePayloadFS.unavailable()
            }
            _ = try entryName(name)
            targets[name] = .init(device: fileDevice, inode: fileInode, size: size, sha256: sha256)
        }
        return .init(file: file, boot: boot, usesDevice: device, usesInode: inode, targets: targets)
    }
    private static func validate(marker: RecoveryMarker, uses: Int32?, entries: [String: RecoveryEntry],
                                 admission: ClaudePayloadAdmission) throws {
        guard let uses else { throw ClaudePayloadFS.unavailable() }
        let info = try ClaudePayloadFS.info(uses)
        guard Int64(info.st_dev) == marker.usesDevice, UInt64(info.st_ino) == marker.usesInode else { throw ClaudePayloadFS.unavailable() }
        try verifyUses(admission: admission, descriptor: uses, identity: info)
        try verifyNamed(parent: admission.root, snapshot: marker.file)
        for (name, fingerprint) in marker.targets {
            if let current = entries[name] {
                guard current.file.fingerprint == fingerprint else { throw ClaudePayloadFS.unavailable() }
            } else {
                var metadata = stat()
                guard fstatat(uses, name, &metadata, AT_SYMLINK_NOFOLLOW) != 0, errno == ENOENT else { throw ClaudePayloadFS.unavailable() }
            }
        }
    }
    private static func validateRecoveryMarker(admission: ClaudePayloadAdmission) throws {
        _ = try unpublishedMarker(root: admission.root)
        guard let marker = try readMarker(root: admission.root) else { return }
        let uses = try openUses(root: admission.root)
        defer { if let uses { close(uses) } }
        let entries = try uses.map { try recoveryEntries(uses: $0) } ?? [:]
        try validate(marker: marker, uses: uses, entries: entries, admission: admission)
    }
    private static func unpublishedMarker(root: Int32) throws -> FileSnapshot? {
        var metadata = stat()
        if fstatat(root, recoveryTemporaryName, &metadata, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT else { throw ClaudePayloadFS.unavailable() }
            return nil
        }
        return try snapshot(parent: root, name: recoveryTemporaryName, maximumBytes: maximumRecoveryBytes)
    }
    private static func discardUnpublishedMarker(admission: ClaudePayloadAdmission) throws {
        // A temp file is never recovery authority, including a truncated write.
        // Only this exact private regular filename may be discarded on retry.
        guard let file = try unpublishedMarker(root: admission.root) else { return }
        try admission.verify()
        try verifyNamed(parent: admission.root, snapshot: file)
        guard unlinkat(admission.root, recoveryTemporaryName, 0) == 0 else { throw ClaudePayloadFS.unavailable() }
        try ClaudePayloadFS.sync(admission.root)
    }
    private static func removeMarker(_ marker: RecoveryMarker, admission: ClaudePayloadAdmission) throws {
        try admission.verify()
        try verifyNamed(parent: admission.root, snapshot: marker.file)
        guard unlinkat(admission.root, recoveryMarkerName, 0) == 0 else { throw ClaudePayloadFS.unavailable() }
        try ClaudePayloadFS.sync(admission.root)
    }
    private static func recoverLocked(_ admission: ClaudePayloadAdmission, boot: String) throws -> Int {
        let marker = try readMarker(root: admission.root)
        let uses = try openUses(root: admission.root)
        defer { if let uses { close(uses) } }
        let entries = try uses.map { try recoveryEntries(uses: $0) } ?? [:]
        if let marker { try validate(marker: marker, uses: uses, entries: entries, admission: admission) }
        // Validate before changing anything. In particular a later mismatching
        // target must not allow earlier valid targets to be partly removed.
        var targets = entries.filter { $0.value.boot.map { $0 != boot } ?? false }
        if let marker, marker.boot != boot {
            for name in marker.targets.keys { if let entry = entries[name] { targets[name] = entry } }
        }
        try discardUnpublishedMarker(admission: admission)
        guard let uses else { try admission.verify(); return 0 }
        let identity = try ClaudePayloadFS.info(uses)
        try verifyUses(admission: admission, descriptor: uses, identity: identity)
        for entry in entries.values { try verifyNamed(parent: uses, snapshot: entry.file) }
        for name in targets.keys.sorted() {
            let original = targets[name]!.file
            let current = try snapshot(parent: uses, name: name, maximumBytes: 4096)
            guard current.fingerprint == original.fingerprint else { throw ClaudePayloadFS.unavailable() }
            try verifyUses(admission: admission, descriptor: uses, identity: identity)
            try verifyNamed(parent: uses, snapshot: current)
            guard unlinkat(uses, name, 0) == 0 else { throw ClaudePayloadFS.unavailable() }
        }
        if !targets.isEmpty { try ClaudePayloadFS.sync(uses) }
        try verifyUses(admission: admission, descriptor: uses, identity: identity)
        let remaining = try recoveryEntries(uses: uses)
        if let marker, marker.targets.keys.allSatisfy({ remaining[$0] == nil }) {
            try removeMarker(marker, admission: admission)
        }
        try admission.verify()
        return targets.count
    }

    private static func readRecords(root: Int32) throws -> [String: UseRecord] {
        var metadata = stat()
        if fstatat(root, "uses", &metadata, AT_SYMLINK_NOFOLLOW) != 0 {
            guard errno == ENOENT else { throw ClaudePayloadFS.unavailable() }
            return [:]
        }
        let uses = try ClaudePayloadFS.privateDirectory(parent: root, name: "uses", create: false)
        defer { close(uses) }
        let identity = try ClaudePayloadFS.info(uses)
        let names = try ClaudePayloadFS.names(uses)
        guard names.count <= maximumUseRecords else { throw ClaudePayloadFS.unavailable() }
        var records: [String: UseRecord] = [:]
        for name in names {
            let record = try readRecord(parent: uses, name: name)
            guard records.updateValue(record, forKey: record.id) == nil else { throw ClaudePayloadFS.unavailable() }
        }
        try verifyUses(root: root, descriptor: uses, identity: identity)
        return records
    }

    private static func readRecord(parent: Int32, name: String) throws -> UseRecord {
        try parseRecord(name: name, data: snapshot(parent: parent, name: name, maximumBytes: 4096).data)
    }
    private static func parseRecord(name: String, data: Data) throws -> UseRecord {
        guard name.hasSuffix(".json") else { throw ClaudePayloadFS.unavailable() }
        let id = String(name.dropLast(5))
        guard UUID(uuidString: id)?.uuidString.lowercased() == id else { throw ClaudePayloadFS.unavailable() }
        guard let value = try? StrictJSONTransport.object(from: data, limits: .init(maximumBytes: 4096, maximumDepth: 2)),
              value["use_id"] as? String == id,
              let digest = value["payload_digest"] as? String, ClaudeRuntimePayload.validDigest(digest),
              let runtime = value["runtime_identity"] as? String, OperationalRuntimeIdentity.isValid(runtime) else {
            throw ClaudePayloadFS.unavailable()
        }
        let boot: String?
        switch value["schema_version"] as? String {
        case "blabee.claude-runtime-use.v1":
            guard Set(value.keys) == ["schema_version", "use_id", "payload_digest", "runtime_identity"] else {
                throw ClaudePayloadFS.unavailable()
            }
            boot = nil
        case "blabee.claude-runtime-use.v2":
            guard Set(value.keys) == ["schema_version", "use_id", "payload_digest", "runtime_identity", "boot_session_id"],
                  let value = value["boot_session_id"] as? String, validUUID(value),
                  value != "00000000-0000-0000-0000-000000000000" else { throw ClaudePayloadFS.unavailable() }
            boot = value
        default: throw ClaudePayloadFS.unavailable()
        }
        return .init(id: id, data: data, runtimeIdentity: runtime, bootSessionID: boot)
    }
}

/// One persistent inode is the admission authority. Root and lock replacement
/// fail closed. close(), not LOCK_UN, prevents a forked descriptor's cleanup
/// from explicitly releasing another process's shared open-file description.
final class ClaudePayloadAdmission: @unchecked Sendable {
    private static let rootNames: Set<String> = ["admission.lock", "payloads", "uses",
        ClaudeRuntimePayloadUse.recoveryMarkerName, ClaudeRuntimePayloadUse.recoveryTemporaryName]
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
                  Set(try ClaudePayloadFS.names(root)).isSubset(of: rootNames) else {
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
                  Set(try ClaudePayloadFS.names(root)).isSubset(of: Self.rootNames),
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
