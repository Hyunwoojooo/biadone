import Darwin
import Foundation

/// A durable record is evidence of progress, never authority to execute arbitrary commands.
struct AppUpdateJournal: Codable, Equatable, Sendable {
    enum Phase: String, Codable, Sendable {
        case prepared, ready, waitingForExit, pausing, installing, published, restoring
        case succeeded, failed, partialRestore, recoveryRequired
        var isTerminal: Bool {
            [.succeeded, .failed, .partialRestore, .recoveryRequired].contains(self)
        }
    }
    enum SessionStep: String, Codable, Sendable { case pending, pausing, paused, restoring, restored, uncertain }
    struct Session: Codable, Equatable, Sendable {
        let value: UpdateManagedSession
        var step: SessionStep = .pending
    }
    struct Download: Codable, Equatable, Sendable {
        let version: String
        let build: String
        let releaseURL: URL
        let dmgURL: URL
        let dmgSize: Int64
        let checksumURL: URL
        let checksumSize: Int64
        let workRootURL: URL
        let sha256: String
        let runtimeIdentity: String
        init(_ prepared: AppUpdatePreparedDownload) throws {
            let assets = try AppUpdateDownloadPolicy.validatedAssets(prepared.release)
            version = prepared.release.version.version; build = prepared.release.version.build
            releaseURL = prepared.release.releaseURL; dmgURL = assets.dmg.url; dmgSize = assets.dmg.size
            checksumURL = assets.checksum.url; checksumSize = assets.checksum.size
            workRootURL = prepared.workRootURL; sha256 = prepared.sha256; runtimeIdentity = prepared.runtimeIdentity
        }
        func prepared() throws -> AppUpdatePreparedDownload {
            guard let version = PetAppUpdateVersion(version: version, build: build) else {
                throw AppUpdateTransactionError.invalidJournal
            }
            let name = AppUpdateDownloadPolicy.diskImageName(version)
            let release = PetAppUpdateRelease(version: version, releaseURL: releaseURL,
                installerAssets: .init(dmg: .init(name: name, url: dmgURL, size: dmgSize),
                    checksum: .init(name: name + ".sha256", url: checksumURL, size: checksumSize)))
            _ = try AppUpdateDownloadPolicy.validatedAssets(release)
            return .init(release: release, workRootURL: workRootURL,
                applicationURL: workRootURL.appendingPathComponent("Blabee.app"),
                diskImageURL: workRootURL.appendingPathComponent(name), sha256: sha256, runtimeIdentity: runtimeIdentity)
        }
    }
    let schema: Int
    let jobID: String
    let nonce: String
    let parentPID: Int32
    let parentStartTime: UInt64
    let createdAt: Date
    let previousIdentity: String
    let candidateIdentity: String
    let download: Download
    let helperApplicationURL: URL
    var phase: Phase = .prepared
    var helperPID: Int32?
    var helperStartTime: UInt64?
    var sessions: [Session]
    var backupURL: URL?
    var detail: String = "업데이트 실행 준비 중입니다."
    var updatedAt: Date

    func requireValid(jobID expectedID: String? = nil, nonce expectedNonce: String? = nil) throws {
        guard schema == 1, UUID(uuidString: jobID)?.uuidString.lowercased() == jobID,
              UUID(uuidString: nonce)?.uuidString.lowercased() == nonce,
              expectedID == nil || expectedID == jobID, expectedNonce == nil || expectedNonce == nonce,
              parentPID > 0, parentStartTime > 0, OperationalRuntimeIdentity.isValid(previousIdentity),
              OperationalRuntimeIdentity.isValid(candidateIdentity), previousIdentity != candidateIdentity,
              download.runtimeIdentity == candidateIdentity,
              sessions.count <= 100, Set(sessions.map { $0.value.id }).count == sessions.count,
              download.workRootURL.isFileURL, download.workRootURL.path.hasPrefix("/"),
              helperApplicationURL.path == download.workRootURL.appendingPathComponent("helper-runtime/Blabee.app").path,
              detail.utf8.count <= 8_192
        else { throw AppUpdateTransactionError.invalidJournal }
        _ = try download.prepared()
        for session in sessions {
            guard let thread = session.value.threadID, UUID(uuidString: thread) != nil,
                  !session.value.id.isEmpty, session.value.id.utf8.count <= 256,
                  session.value.cwd.hasPrefix("/"), session.value.cwd.utf8.count <= 4_096,
                  !session.value.cwd.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
            else { throw AppUpdateTransactionError.invalidJournal }
        }
        if let backupURL {
            guard backupURL.isFileURL, backupURL.deletingLastPathComponent().path == "/Applications",
                  backupURL.lastPathComponent.hasPrefix("Blabee.backup-")
                    || backupURL.lastPathComponent.hasPrefix(".Blabee.backup-")
            else { throw AppUpdateTransactionError.invalidJournal }
        }
    }
}

/// Descriptor-relative, no-follow I/O. Existing permissions are rejected rather than repaired.
struct AppUpdateJournalStore: Sendable {
    static let maximumBytes = 512 * 1_024
    let rootURL: URL
    static func live() -> Self {
        Self(rootURL: FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Blabee/Updates", isDirectory: true))
    }

    func journalURL(_ jobID: String) throws -> URL {
        try requireJobID(jobID)
        return rootURL.appendingPathComponent(jobID + ".json")
    }

    func save(_ journal: AppUpdateJournal) throws {
        try journal.requireValid()
        let bytes = try JSONEncoder().encode(journal)
        guard bytes.count <= Self.maximumBytes else { throw AppUpdateTransactionError.invalidJournal }
        let directory = try openRoot(create: true)
        defer { close(directory) }
        try atomicWrite(bytes, name: journal.jobID + ".json", directory: directory)
        try atomicWrite(Data(journal.jobID.utf8), name: "latest", directory: directory)
    }

    func load(jobID: String, nonce: String? = nil) throws -> AppUpdateJournal {
        try requireJobID(jobID)
        let directory = try openRoot(create: false)
        defer { close(directory) }
        let journal = try JSONDecoder().decode(AppUpdateJournal.self,
            from: read(name: jobID + ".json", directory: directory))
        try journal.requireValid(jobID: jobID, nonce: nonce)
        return journal
    }

    func latest() throws -> AppUpdateJournal? {
        if !FileManager.default.fileExists(atPath: rootURL.path) { return nil }
        let directory = try openRoot(create: false)
        defer { close(directory) }
        var value = stat()
        if fstatat(directory, "latest", &value, AT_SYMLINK_NOFOLLOW) != 0, errno == ENOENT { return nil }
        guard let name = String(data: try read(name: "latest", directory: directory), encoding: .utf8) else {
            throw AppUpdateTransactionError.invalidJournal
        }
        return try load(jobID: name)
    }

    func acquireHelperLock() throws -> AppUpdateJournalLock {
        let directory = try openRoot(create: true)
        defer { close(directory) }
        let descriptor = openat(directory, "helper.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw AppUpdateTransactionError.unsafeJournal }
        do {
            try requireFile(descriptor)
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { throw AppUpdateTransactionError.updateBusy }
            return AppUpdateJournalLock(descriptor)
        } catch { close(descriptor); throw error }
    }

    private func requireJobID(_ value: String) throws {
        guard UUID(uuidString: value)?.uuidString.lowercased() == value else {
            throw AppUpdateTransactionError.invalidJournal
        }
    }

    private func openRoot(create: Bool) throws -> Int32 {
        // Foundation can rewrite a physical /private/var path back to /var.
        // Validate spelling lexically; the descriptor walk below proves every
        // actual component is a directory and refuses all symlink aliases.
        let parts = rootURL.path.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
        guard rootURL.isFileURL, rootURL.path.hasPrefix("/"), !parts.isEmpty,
              parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw AppUpdateTransactionError.unsafeJournal
        }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw AppUpdateTransactionError.unsafeJournal }
        do {
            for (index, part) in parts.enumerated() {
                var next = openat(descriptor, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0, errno == ENOENT, create {
                    guard mkdirat(descriptor, part, 0o700) == 0 else { throw AppUpdateTransactionError.unsafeJournal }
                    next = openat(descriptor, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else { throw AppUpdateTransactionError.unsafeJournal }
                close(descriptor); descriptor = next
                var info = stat()
                guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFDIR else {
                    throw AppUpdateTransactionError.unsafeJournal
                }
                try requireNoGrantACL(descriptor)
                if index == parts.count - 1 {
                    guard info.st_uid == getuid(), info.st_mode & 0o777 == 0o700 else {
                        throw AppUpdateTransactionError.unsafeJournal
                    }
                } else {
                    guard info.st_uid == 0 || info.st_uid == getuid(),
                          info.st_mode & 0o022 == 0 || info.st_mode & S_ISVTX != 0 else {
                        throw AppUpdateTransactionError.unsafeJournal
                    }
                }
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    private func requireFile(_ descriptor: Int32) throws {
        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
              info.st_uid == getuid(), info.st_mode & 0o777 == 0o600,
              info.st_nlink == 1, info.st_size >= 0, info.st_size <= Int64(Self.maximumBytes) else {
            throw AppUpdateTransactionError.unsafeJournal
        }
        try requireNoGrantACL(descriptor)
    }

    private func requireNoGrantACL(_ descriptor: Int32) throws {
        errno = 0
        let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED)
        let failure = errno
        if let acl {
            let grants = blabeeExtendedACLContainsGrant(acl)
            acl_free(UnsafeMutableRawPointer(acl))
            guard grants == false else { throw AppUpdateTransactionError.unsafeJournal }
        }
        guard acl != nil || failure == ENOENT else { throw AppUpdateTransactionError.unsafeJournal }
    }

    private func read(name: String, directory: Int32) throws -> Data {
        let descriptor = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw AppUpdateTransactionError.unsafeJournal }
        defer { close(descriptor) }
        try requireFile(descriptor)
        var data = Data(), buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count < 0 { if errno == EINTR { continue }; throw AppUpdateTransactionError.unsafeJournal }
            if count == 0 { break }
            data.append(contentsOf: buffer.prefix(count))
            guard data.count <= Self.maximumBytes else { throw AppUpdateTransactionError.invalidJournal }
        }
        return data
    }

    private func atomicWrite(_ data: Data, name: String, directory: Int32) throws {
        let temporary = ".write-" + UUID().uuidString.lowercased()
        let descriptor = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw AppUpdateTransactionError.unsafeJournal }
        defer { close(descriptor); _ = unlinkat(directory, temporary, 0) }
        try requireFile(descriptor)
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < data.count {
                let written = Darwin.write(descriptor, bytes.baseAddress!.advanced(by: offset), data.count - offset)
                if written < 0, errno == EINTR { continue }
                guard written > 0 else { throw AppUpdateTransactionError.unsafeJournal }
                offset += written
            }
        }
        guard fsync(descriptor) == 0, renameat(directory, temporary, directory, name) == 0,
              fsync(directory) == 0 else { throw AppUpdateTransactionError.unsafeJournal }
    }
}

final class AppUpdateJournalLock {
    private let descriptor: Int32
    init(_ descriptor: Int32) { self.descriptor = descriptor }
    deinit { _ = flock(descriptor, LOCK_UN); close(descriptor) }
}
