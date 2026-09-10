import CoordinatorSwift
import Darwin
import Foundation

enum AppRuntimeUseLeaseError: Error, Equatable {
    case busy, unavailable, changed
}

/// Cooperative usage of one *executable inode*, not a claim about all Mac
/// processes. Runtime users share the lease; an installer owns it exclusively
/// through publication/rollback. The OS releases it even after an abrupt exit.
final class AppRuntimeUseLease: @unchecked Sendable {
    static let protocolVersion = "blabee.runtime-use-lease.v1"
    static let protocolInfoKey = "BlabeeRuntimeUseLeaseProtocol"
    static let previousIdentitiesInfoKey = "BlabeeRuntimeUseLeasePreviousIdentities"
    static let executablePath = "Contents/MacOS/blabee-coordinator"
    static let launcherPath = "Contents/Resources/Plugin/blabee/scripts/blabee-launcher"

    enum Use { case runtime, installation }

    private let descriptor: Int32
    private let identity: Identity

    private struct Identity: Equatable {
        let device: dev_t
        let inode: ino_t
        let size: off_t
        let owner: uid_t
        let mode: mode_t
        let modifiedSeconds: Int
        let modifiedNanoseconds: Int

        init(_ value: stat) {
            device = value.st_dev
            inode = value.st_ino
            size = value.st_size
            owner = value.st_uid
            mode = value.st_mode
            modifiedSeconds = value.st_mtimespec.tv_sec
            modifiedNanoseconds = value.st_mtimespec.tv_nsec
        }
    }

    private init(descriptor: Int32, identity: Identity) {
        self.descriptor = descriptor
        self.identity = identity
    }

    deinit {
        // Do not LOCK_UN: a forked child could otherwise unlock its parent's
        // shared open-file description. CLOEXEC prevents retention by Codex.
        close(descriptor)
    }

    static func acquire(executableURL: URL, use: Use) throws -> AppRuntimeUseLease {
        guard executableURL.isFileURL, executableURL.path.hasPrefix("/") else {
            throw AppRuntimeUseLeaseError.unavailable
        }
        let fd = open(executableURL.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw AppRuntimeUseLeaseError.unavailable }
        do {
            var value = stat()
            let descriptorFlags = fcntl(fd, F_GETFD)
            guard fstat(fd, &value) == 0,
                  permitsMetadata(value, use: use),
                  descriptorFlags >= 0, descriptorFlags & FD_CLOEXEC != 0
            else { throw AppRuntimeUseLeaseError.unavailable }
            guard flock(fd, (use == .runtime ? LOCK_SH : LOCK_EX) | LOCK_NB) == 0 else {
                throw errno == EWOULDBLOCK ? AppRuntimeUseLeaseError.busy : .unavailable
            }
            let identity = Identity(value)
            // Ownership of fd transfers only after every throwing check.
            try verify(fd: fd, expected: identity, at: executableURL)
            return AppRuntimeUseLease(descriptor: fd, identity: identity)
        } catch {
            close(fd)
            throw error
        }
    }

    static func permitsMetadata(_ value: stat, use: Use) -> Bool {
        value.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && value.st_mode & 0o111 != 0 && value.st_mode & 0o022 == 0
            // A second Mac account may run the signed app installed by the
            // first account. Runtime SH is read-only; ownership restrictions
            // belong to the replacing installer, not ordinary app startup.
            && (use == .runtime || value.st_uid == geteuid() || value.st_uid == 0)
    }

    func verify(at executableURL: URL) throws {
        try Self.verify(fd: descriptor, expected: identity, at: executableURL)
    }

    private static func verify(fd: Int32, expected: Identity, at url: URL) throws {
        var held = stat()
        var current = stat()
        guard fstat(fd, &held) == 0, lstat(url.path, &current) == 0,
              Identity(held) == expected, Identity(current) == expected
        else { throw AppRuntimeUseLeaseError.changed }
    }

    /// Resolve symlink invocations before recognizing the bundle. Mutable
    /// Info.plist GUI-routing fields must not be able to disable the lease.
    static func packagedExecutable(_ url: URL?) -> URL? {
        guard let url, url.isFileURL else { return nil }
        let resolved = url.resolvingSymlinksInPath().standardizedFileURL
        let macOS = resolved.deletingLastPathComponent()
        let contents = macOS.deletingLastPathComponent()
        guard resolved.lastPathComponent == "blabee-coordinator",
              macOS.lastPathComponent == "MacOS", contents.lastPathComponent == "Contents",
              contents.deletingLastPathComponent().pathExtension.lowercased() == "app"
        else { return nil }
        return resolved
    }

    static func acquireCurrent(
        executableURL: URL? = Bundle.main.executableURL,
        verifyRunningCode: (URL) throws -> Void = { executable in
            // Uncached: a loaded old binary must not acquire the new file's
            // lease after replacement and continue with mismatched resources.
            guard packagedExecutable(executable) == nil
                    || OperationalRuntimeIdentity.resolveSnapshot(executableURL: executable) != nil else {
                throw AppRuntimeUseLeaseError.changed
            }
        }
    ) throws -> AppRuntimeUseLease {
        do {
            guard let executableURL, executableURL.isFileURL else { throw AppRuntimeUseLeaseError.unavailable }
            let executable = executableURL.resolvingSymlinksInPath().standardizedFileURL
            // Normal developer/standalone dispatch participates too: an app
            // can be renamed into .app while its coordinator is still alive.
            // Only static signature/resource validation depends on app layout.
            let lease = try acquire(executableURL: executable, use: .runtime)
            try verifyRunningCode(executable)
            try lease.verify(at: executable)
            return lease
        } catch AppRuntimeUseLeaseError.busy {
            throw CoordinatorError("app_runtime_installation_in_progress", "Blabee를 교체하고 있습니다. 잠시 후 다시 열어 주세요.")
        } catch {
            throw CoordinatorError("app_runtime_use_lease_unverified", "Blabee 실행 파일을 안전하게 확인하지 못했습니다. 설치된 앱을 다시 열어 주세요.")
        }
    }
}
