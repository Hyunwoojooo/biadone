import CoordinatorSwift
import Darwin
import Foundation

enum AppUpdateAdmissionError: Error, Equatable, LocalizedError {
    case busy, unavailable
    var errorDescription: String? {
        switch self {
        case .busy:
            PetL10n.text("Waiting for a Blabee request to finish before restarting.", korean: "Blabee 요청 처리가 끝난 뒤 다시 시작합니다.")
        case .unavailable:
            PetL10n.text("Unable to verify the update transition. Keep Blabee open and try again.", korean: "안전한 업데이트 전환을 확인하지 못했습니다. Blabee를 유지하고 다시 시도해 주세요.")
        }
    }
}

/// A separate open-file description for every request. Never unlock a shared
/// descriptor while another request still owns it. Closing releases even on crash.
final class AppUpdateAdmissionLease: @unchecked Sendable {
    private let lock = NSLock()
    private var descriptor: Int32
    private let device: dev_t
    private let inode: ino_t
    private let fileURL: URL
    private let exclusive: Bool

    fileprivate init(descriptor: Int32, info: stat, fileURL: URL, exclusive: Bool) {
        self.descriptor = descriptor; device = info.st_dev; inode = info.st_ino
        self.fileURL = fileURL; self.exclusive = exclusive
    }

    deinit { release() }

    func release() {
        lock.lock(); defer { lock.unlock() }
        guard descriptor >= 0 else { return }
        close(descriptor); descriptor = -1
    }

    func verifyForUpdate() throws {
        lock.lock(); defer { lock.unlock() }
        guard exclusive else { throw AppUpdateAdmissionError.unavailable }
        _ = try verifiedMetadata()
    }

    /// A short bridge startup keeps request admission across exec. An update
    /// lease must never be transferred through the client bootstrap path.
    func prepareForExec() throws -> Int32 {
        lock.lock(); defer { lock.unlock() }
        guard !exclusive else { throw AppUpdateAdmissionError.unavailable }
        _ = try verifiedMetadata()
        let flags = fcntl(descriptor, F_GETFD)
        guard flags >= 0, fcntl(descriptor, F_SETFD, flags & ~FD_CLOEXEC) == 0 else {
            throw AppUpdateAdmissionError.unavailable
        }
        return descriptor
    }

    fileprivate func verifyInheritedRequest(_ inherited: Int32) throws {
        lock.lock(); defer { lock.unlock() }
        guard !exclusive, inherited >= 3, inherited != descriptor else { throw AppUpdateAdmissionError.unavailable }
        let current = try verifiedMetadata()
        var candidate = stat()
        let flags = fcntl(inherited, F_GETFL)
        let fdFlags = fcntl(inherited, F_GETFD)
        guard fstat(inherited, &candidate) == 0, AppUpdateAdmissionGate.valid(candidate),
              candidate.st_dev == current.st_dev, candidate.st_ino == current.st_ino,
              flags >= 0, flags & O_ACCMODE == O_RDWR,
              fdFlags >= 0, fdFlags & FD_CLOEXEC == 0 else { throw AppUpdateAdmissionError.unavailable }
    }

    /// Called while this object's lock is held. Verify the parent descriptor as
    /// well as the leaf so a renamed/symlink ancestor cannot redirect authority.
    private func verifiedMetadata() throws -> stat {
        let parent: Int32
        do { parent = try UnixDomainSocketServer.openSecureRuntimeDirectory(fileURL.deletingLastPathComponent()) }
        catch { throw AppUpdateAdmissionError.unavailable }
        defer { close(parent) }
        var held = stat(), named = stat()
        guard descriptor >= 0,
              fstat(descriptor, &held) == 0, fstatat(parent, fileURL.lastPathComponent, &named, AT_SYMLINK_NOFOLLOW) == 0,
              held.st_dev == device, held.st_ino == inode,
              named.st_dev == device, named.st_ino == inode,
              AppUpdateAdmissionGate.valid(held), AppUpdateAdmissionGate.valid(named)
        else { throw AppUpdateAdmissionError.unavailable }
        return held
    }
}

enum AppUpdateAdmissionGate {
    static var defaultDirectoryURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Blabee/update-admission", isDirectory: true)
    }

    static func acquireForUpdate(directoryURL: URL = defaultDirectoryURL) throws -> AppUpdateAdmissionLease {
        try acquire(directoryURL: directoryURL, exclusive: true)
    }

    static func acquireRequest(directoryURL: URL = defaultDirectoryURL) throws -> AppUpdateAdmissionLease {
        try acquire(directoryURL: directoryURL, exclusive: false)
    }

    /// Do not trust a numeric environment FD or modify its flock mode. First
    /// obtain a fresh SH description, verify the inherited FD names that exact
    /// private lock, then close only the verified old FD. There is never a gap
    /// without request admission. Failed adoption never closes an arbitrary FD.
    static func adoptInheritedRequest(
        descriptor: Int32, directoryURL: URL = defaultDirectoryURL
    ) throws -> AppUpdateAdmissionLease {
        var metadata = stat()
        guard descriptor >= 3, fstat(descriptor, &metadata) == 0, valid(metadata) else {
            throw AppUpdateAdmissionError.unavailable
        }
        let lease = try acquireRequest(directoryURL: directoryURL)
        try lease.verifyInheritedRequest(descriptor)
        close(descriptor)
        return lease
    }

    fileprivate static func valid(_ info: stat) -> Bool {
        info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && info.st_mode & 0o7777 == 0o600 && info.st_uid == geteuid()
            && info.st_nlink == 1 && info.st_size == 0
    }

    private static func acquire(directoryURL: URL, exclusive: Bool) throws -> AppUpdateAdmissionLease {
        guard directoryURL.isFileURL, directoryURL.path.hasPrefix("/") else {
            throw AppUpdateAdmissionError.unavailable
        }
        let parent: Int32
        do { parent = try UnixDomainSocketServer.openSecureRuntimeDirectory(directoryURL) }
        catch { throw AppUpdateAdmissionError.unavailable }
        defer { close(parent) }
        let name = "transition.lock"
        let fd = try openLock(parent: parent, name: name)
        do {
            var held = stat(), named = stat()
            guard fstat(fd, &held) == 0, valid(held),
                  fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
                  valid(named), held.st_dev == named.st_dev, held.st_ino == named.st_ino
            else { throw AppUpdateAdmissionError.unavailable }
            guard flock(fd, (exclusive ? LOCK_EX : LOCK_SH) | LOCK_NB) == 0 else {
                throw errno == EWOULDBLOCK ? AppUpdateAdmissionError.busy : .unavailable
            }
            guard fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
                  valid(named), held.st_dev == named.st_dev, held.st_ino == named.st_ino
            else { throw AppUpdateAdmissionError.unavailable }
            return AppUpdateAdmissionLease(descriptor: fd, info: held,
                fileURL: directoryURL.appendingPathComponent(name), exclusive: exclusive)
        } catch { close(fd); throw error }
    }

    private static func openLock(parent: Int32, name: String) throws -> Int32 {
        let flags = O_RDWR | O_NOFOLLOW | O_CLOEXEC
        // Match runtime-store admission: concurrent nonexclusive O_CREAT
        // opens can report ENOENT while the parent directory is still live.
        // Existing files are only opened; only an EEXIST creation race retries.
        for _ in 0..<8 {
            let existing = openat(parent, name, flags)
            if existing >= 0 { return existing }
            guard errno == ENOENT else { throw AppUpdateAdmissionError.unavailable }
            let created = openat(parent, name, flags | O_CREAT | O_EXCL, 0o600)
            if created >= 0 { return created }
            guard errno == EEXIST else { throw AppUpdateAdmissionError.unavailable }
        }
        throw AppUpdateAdmissionError.unavailable
    }
}
