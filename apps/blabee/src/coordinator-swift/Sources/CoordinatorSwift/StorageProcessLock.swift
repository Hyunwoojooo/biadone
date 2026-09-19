import Darwin
import Foundation

package final class StorageProcessLock: @unchecked Sendable {
    private static let registry = ProcessMutexRegistry()

    private let lockURL: URL
    private let processMutex: NSLock
    private let allowParentCreation: Bool

    package init(keyURL: URL, allowParentCreation: Bool) throws {
        let parent = keyURL.standardizedFileURL.deletingLastPathComponent()
        lockURL = parent.appendingPathComponent(".blabee-coordinator-freshness.lock", isDirectory: false)
        processMutex = Self.registry.mutex(for: Self.normalizedSystemAlias(lockURL.path))
        self.allowParentCreation = allowParentCreation
    }

    package func withLock<T>(_ operation: () throws -> T) throws -> T {
        try withLock(wait: true) { _ in try operation() }
    }

    /// Interactive recovery must refuse an active writer rather than wait for it.
    func withNonblockingLock<T>(_ operation: (Int32) throws -> T) throws -> T {
        try withLock(wait: false, operation)
    }

    private func withLock<T>(wait: Bool, _ operation: (Int32) throws -> T) throws -> T {
        if wait {
            processMutex.lock()
        } else if !processMutex.try() {
            throw CoordinatorError("freshness_lock_busy", "freshness storage is in use")
        }
        defer { processMutex.unlock() }

        let parent = try Self.openSecureParent(
            lockURL.deletingLastPathComponent(),
            allowCreation: allowParentCreation
        )
        defer { close(parent) }
        let descriptor = openat(
            parent,
            lockURL.lastPathComponent,
            O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else {
            throw CoordinatorError("freshness_lock_unavailable", "cannot open freshness lock")
        }
        defer { close(descriptor) }
        try Self.verifyLockFile(descriptor)
        if wait {
            try Self.acquire(descriptor)
        } else {
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
                throw CoordinatorError("freshness_lock_busy", "freshness storage is in use")
            }
            var opened = stat()
            var entry = stat()
            guard fstat(descriptor, &opened) == 0,
                  fstatat(parent, lockURL.lastPathComponent, &entry, AT_SYMLINK_NOFOLLOW) == 0,
                  opened.st_dev == entry.st_dev,
                  opened.st_ino == entry.st_ino,
                  opened.st_nlink == 1
            else {
                throw CoordinatorError("freshness_lock_unavailable", "freshness lock identity changed")
            }
        }
        defer { _ = flock(descriptor, LOCK_UN) }
        return try operation(parent)
    }

    private static func acquire(_ descriptor: Int32) throws {
        while flock(descriptor, LOCK_EX) != 0 {
            if errno == EINTR { continue }
            throw CoordinatorError("freshness_lock_unavailable", "cannot acquire freshness lock")
        }
    }

    private static func verifyLockFile(_ descriptor: Int32) throws {
        var info = stat()
        guard fstat(descriptor, &info) == 0 else {
            throw CoordinatorError("freshness_lock_unavailable", "cannot inspect freshness lock")
        }
        let type = info.st_mode & mode_t(S_IFMT)
        let permissions = info.st_mode & 0o777
        try require(
            type == mode_t(S_IFREG),
            "freshness_lock_unavailable",
            "freshness lock must be a regular file"
        )
        try require(
            permissions == 0o600,
            "freshness_lock_unavailable",
            "freshness lock permissions must be 0600"
        )
        try require(
            info.st_uid == geteuid(),
            "freshness_lock_unavailable",
            "freshness lock owner mismatch"
        )
    }

    private static func openSecureParent(_ parent: URL, allowCreation: Bool) throws -> Int32 {
        let path = normalizedSystemAlias(parent.standardizedFileURL.path)
        try require(path.hasPrefix("/"), "freshness_lock_unavailable", "lock parent must be absolute")
        let components = path.split(separator: "/").map(String.init)
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else {
            throw CoordinatorError("freshness_lock_unavailable", "cannot open filesystem root")
        }

        do {
            for component in components {
                var next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0 && errno == ENOENT && allowCreation {
                    guard mkdirat(descriptor, component, mode_t(0o700)) == 0 || errno == EEXIST else {
                        throw CoordinatorError("freshness_lock_unavailable", "cannot create lock parent")
                    }
                    next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else {
                    throw CoordinatorError("freshness_lock_unavailable", "lock path contains an unsafe component")
                }
                close(descriptor)
                descriptor = next
            }
        } catch {
            close(descriptor)
            throw error
        }

        var info = stat()
        guard fstat(descriptor, &info) == 0 else {
            close(descriptor)
            throw CoordinatorError("freshness_lock_unavailable", "cannot inspect lock parent")
        }
        let type = info.st_mode & mode_t(S_IFMT)
        let permissions = info.st_mode & 0o777
        do {
            try require(type == mode_t(S_IFDIR), "freshness_lock_unavailable", "lock parent must be a real directory")
            try require(permissions == 0o700, "freshness_lock_unavailable", "lock parent permissions must be 0700")
            try require(info.st_uid == geteuid(), "freshness_lock_unavailable", "lock parent owner mismatch")
        } catch {
            close(descriptor)
            throw error
        }
        return descriptor
    }

    private static func normalizedSystemAlias(_ path: String) -> String {
        if path == "/var" { return "/private/var" }
        if path.hasPrefix("/var/") { return "/private" + path }
        if path == "/tmp" { return "/private/tmp" }
        if path.hasPrefix("/tmp/") { return "/private" + path }
        return path
    }
}

private final class ProcessMutexRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var mutexes: [String: NSLock] = [:]

    func mutex(for path: String) -> NSLock {
        lock.lock()
        defer { lock.unlock() }
        if let existing = mutexes[path] { return existing }
        let mutex = NSLock()
        mutexes[path] = mutex
        return mutex
    }
}
