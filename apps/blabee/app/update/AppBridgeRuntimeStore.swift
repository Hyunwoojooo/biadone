import BlabeeProductSupport
import CoordinatorSwift
import Darwin
import Foundation

/// Immutable, identity-addressed copies for long-lived bridge processes. This
/// store does not select a service, grant compatibility, or restart a session.
/// A copy retains all signed resources and owns a different executable inode
/// from /Applications, so its lifetime need not block replacing that app.
enum AppBridgeRuntimeStore {
    static let admissionFileName = "admission.lock"
    private static let originFileName = ".staging-origin"
    private static let maximumStoreEntries = 4_096

    static var defaultStoreRootURL: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let canonicalHome = AppUpdateRuntimeCopy.physicalPath(home).map {
            URL(fileURLWithPath: $0, isDirectory: true)
        } ?? home
        return canonicalHome.appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(BlabeeProductProfile.current.applicationSupportDirectoryName, isDirectory: true)
            .appendingPathComponent("runtimes", isDirectory: true)
    }

    static func prepareCurrent() throws -> URL {
        guard let executable = Bundle.main.executableURL,
              AppRuntimeUseLease.packagedExecutable(executable) != nil,
              let snapshot = OperationalRuntimeIdentity.resolveSnapshot(executableURL: executable)
        else { throw unverified() }
        if let current = try verifiedCurrentAppURL(
            executableURL: executable, expectedIdentity: snapshot.runtimeIdentity
        ) { return current }
        let source = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try prepare(sourceURL: source, storeRootURL: defaultStoreRootURL,
                           expectedIdentity: snapshot.runtimeIdentity, validator: signedIdentity)
    }

    /// Validators are injectable only for inert, isolated fixture tests. A
    /// returned URL is not a lifetime pin: acquireRuntimeAdmission before exec.
    static func prepare(
        sourceURL: URL, storeRootURL: URL, expectedIdentity: String,
        validator: (URL) -> String?
    ) throws -> URL {
        let name = try generationName(expectedIdentity)
        guard sourceURL.isFileURL, sourceURL.lastPathComponent == "Blabee.app",
              AppUpdateRuntimeCopy.physicalPath(sourceURL) == sourceURL.path,
              !storeRootURL.path.hasPrefix(sourceURL.path + "/")
        else { throw unverified() }
        let executable = sourceURL.appendingPathComponent(AppRuntimeUseLease.executablePath)
        let sourceLease = try AppRuntimeUseLease.acquire(executableURL: executable, use: .runtime)
        defer { withExtendedLifetime(sourceLease) {} }
        guard validator(sourceURL) == expectedIdentity else { throw unverified() }
        let destination = appURL(root: storeRootURL, name: name)

        // Most starts only take SH. Publication upgrades by dropping SH and
        // taking EX, then rechecks the destination; never upgrade flock in place.
        do {
            let admission = try StoreAdmission.acquire(rootURL: storeRootURL, use: .shared, create: true)
            if try exists(parent: admission.root, name: name) {
                try verifyGeneration(admission: admission, name: name, identity: expectedIdentity, validator: validator)
                try verifyIndependentCopy(source: sourceURL, destination: destination)
                try sourceLease.verify(at: executable)
                return destination
            }
        }
        let admission = try StoreAdmission.acquire(rootURL: storeRootURL, use: .exclusive, create: true)
        if try exists(parent: admission.root, name: name) {
            try verifyGeneration(admission: admission, name: name, identity: expectedIdentity, validator: validator)
            try verifyIndependentCopy(source: sourceURL, destination: destination)
            try sourceLease.verify(at: executable)
            return destination
        }
        let stagingName = ".staging-" + UUID().uuidString.lowercased()
        guard mkdirat(admission.root, stagingName, 0o700) == 0 else { throw unverified() }
        try sync(admission.root)
        let stagingURL = storeRootURL.appendingPathComponent(stagingName, isDirectory: true)
        let staging = try openChildDirectory(parent: admission.root, name: stagingName, mode: 0o700)
        defer { close(staging) }
        try writeOrigin(parent: staging, stageName: stagingName, identity: expectedIdentity)
        // A failed/incomplete stage is never reused or swept automatically.
        let copied = try AppUpdateRuntimeCopy.prepare(sourceURL: sourceURL, in: stagingURL,
                                                     expectedIdentity: expectedIdentity, validator: validator)
        let copiedRoot = try openChildDirectory(parent: staging, name: "Blabee.app")
        defer { close(copiedRoot) }
        try walkApp(copiedRoot, freeze: true)
        guard fchmod(staging, 0o500) == 0 else { throw unverified() }
        try sync(staging)
        guard validator(sourceURL) == expectedIdentity, validator(copied) == expectedIdentity else { throw unverified() }
        try sourceLease.verify(at: executable)
        try admission.verify()
        try verifyNamedDirectory(parent: admission.root, name: stagingName, descriptor: staging, mode: 0o500)
        // Publication cannot overwrite even a concurrently planted destination.
        guard renameatx_np(admission.root, stagingName, admission.root, name, UInt32(RENAME_EXCL)) == 0 else {
            throw unverified()
        }
        try sync(admission.root)
        try verifyGeneration(admission: admission, name: name, identity: expectedIdentity, validator: validator)
        try verifyIndependentCopy(source: sourceURL, destination: destination)
        try sourceLease.verify(at: executable)
        return destination
    }

    /// nil means genuinely outside this store. A malformed path, link, wrong
    /// identity or partial generation within the store fails closed instead.
    static func verifiedCurrentAppURL(
        executableURL: URL, storeRootURL: URL = defaultStoreRootURL, expectedIdentity: String,
        validator: (URL) -> String? = signedIdentity
    ) throws -> URL? {
        let prefix = storeRootURL.path + "/"
        let physical = AppUpdateRuntimeCopy.physicalPath(executableURL)
        guard executableURL.path.hasPrefix(prefix) || physical?.hasPrefix(prefix) == true else { return nil }
        let name = try generationName(expectedIdentity)
        let app = appURL(root: storeRootURL, name: name)
        guard executableURL.path == app.appendingPathComponent(AppRuntimeUseLease.executablePath).path,
              physical == executableURL.path else { throw unverified() }
        let admission = try acquireRuntimeAdmission(appURL: app, storeRootURL: storeRootURL,
                                                    expectedIdentity: expectedIdentity, validator: validator)
        defer { withExtendedLifetime(admission) {} }
        return app
    }

    /// The short SH admission covers verification through exec. Existing bridge
    /// lifetimes keep only the executable SH lease, allowing another generation
    /// to be published while they continue using their own resources.
    final class Admission {
        let appURL: URL
        private let store: StoreAdmission
        private let runtime: AppRuntimeUseLease

        fileprivate init(appURL: URL, store: StoreAdmission, runtime: AppRuntimeUseLease) {
            self.appURL = appURL; self.store = store; self.runtime = runtime
        }

        /// Only the store admission FD crosses exec. The source and prepared
        /// executable leases remain CLOEXEC. On exec failure, release this
        /// object normally; no unrelated descriptor is closed.
        func prepareForExec() throws -> Int32 {
            try store.verify()
            try runtime.verify(at: appURL.appendingPathComponent(AppRuntimeUseLease.executablePath))
            let flags = fcntl(store.descriptor, F_GETFD)
            guard flags >= 0, fcntl(store.descriptor, F_SETFD, flags & ~FD_CLOEXEC) == 0 else { throw unverified() }
            return store.descriptor
        }
    }

    static func acquireRuntimeAdmission(
        appURL: URL, storeRootURL: URL = defaultStoreRootURL, expectedIdentity: String,
        validator: (URL) -> String? = signedIdentity
    ) throws -> Admission {
        let name = try generationName(expectedIdentity)
        guard appURL.path == Self.appURL(root: storeRootURL, name: name).path else { throw unverified() }
        let store = try StoreAdmission.acquire(rootURL: storeRootURL, use: .shared, create: false)
        let runtime = try AppRuntimeUseLease.acquire(
            executableURL: appURL.appendingPathComponent(AppRuntimeUseLease.executablePath), use: .runtime
        )
        try verifyGeneration(admission: store, name: name, identity: expectedIdentity, validator: validator)
        try runtime.verify(at: appURL.appendingPathComponent(AppRuntimeUseLease.executablePath))
        return Admission(appURL: appURL, store: store, runtime: runtime)
    }

    /// Called in the exec target AFTER acquireCurrent(). An environment/argv FD
    /// number is not authority. Close it only after proving it names this exact
    /// private store lock and after the caller owns the target executable lease.
    static func completeExecAdmission(
        descriptor: Int32, executableURL: URL, runtimeLease: AppRuntimeUseLease,
        storeRootURL: URL = defaultStoreRootURL, expectedIdentity: String,
        validator: (URL) -> String? = signedIdentity
    ) throws -> URL {
        guard descriptor >= 3 else { throw unverified() }
        let store = try StoreAdmission.acquire(rootURL: storeRootURL, use: .shared, create: false)
        try store.verifyInherited(descriptor)
        let name = try generationName(expectedIdentity)
        let app = appURL(root: storeRootURL, name: name)
        guard executableURL.path == app.appendingPathComponent(AppRuntimeUseLease.executablePath).path,
              AppUpdateRuntimeCopy.physicalPath(executableURL) == executableURL.path else { throw unverified() }
        try runtimeLease.verify(at: executableURL)
        try verifyGeneration(admission: store, name: name, identity: expectedIdentity, validator: validator)
        try store.verifyInherited(descriptor)
        try runtimeLease.verify(at: executableURL)
        close(descriptor)
        return app
    }

    /// Conservative opt-in GC. The provider guard must retain positive
    /// no-child/no-unknown-use evidence until deletion finishes. No guard means
    /// no deletion; a throwing guard, invalid generation or busy native lease
    /// preserves that generation. Staging and unknown names are always kept.
    @discardableResult
    static func collectUnused(
        storeRootURL: URL = defaultStoreRootURL, keepingIdentities: Set<String>,
        validator: (URL) -> String? = signedIdentity,
        providerUseGuard: ((String) throws -> AnyObject)? = nil
    ) throws -> [String] {
        guard let providerUseGuard else { return [] }
        let store = try StoreAdmission.acquire(rootURL: storeRootURL, use: .exclusive, create: false)
        var removed: [String] = []
        for name in try names(store.root).sorted() {
            let identity = "sha256:" + name
            guard OperationalRuntimeIdentity.isValid(identity), !keepingIdentities.contains(identity) else { continue }
            let app = appURL(root: storeRootURL, name: name)
            let executable = app.appendingPathComponent(AppRuntimeUseLease.executablePath)
            let runtime: AppRuntimeUseLease
            let provider: AnyObject
            do {
                runtime = try AppRuntimeUseLease.acquire(executableURL: executable, use: .installation)
                try verifyGeneration(admission: store, name: name, identity: identity, validator: validator)
                provider = try providerUseGuard(identity)
                try verifyGeneration(admission: store, name: name, identity: identity, validator: validator)
                try runtime.verify(at: executable)
                try store.verify()
            } catch { continue }
            try withExtendedLifetime((runtime, provider)) {
                let generation = try openChildDirectory(parent: store.root, name: name, mode: 0o500)
                defer { close(generation) }
                try verifyNamedDirectory(parent: store.root, name: name, descriptor: generation, mode: 0o500)
                try removeTreeContents(generation)
                try verifyNamedDirectory(parent: store.root, name: name, descriptor: generation, mode: 0o700)
                guard unlinkat(store.root, name, AT_REMOVEDIR) == 0 else { throw unverified() }
                try sync(store.root)
            }
            removed.append(identity)
        }
        return removed
    }

    /// Advisory preflight only; callers still need their installation admission
    /// policy to prevent new connections after this snapshot. EX inventory also
    /// excludes an inherited SH handoff whose native SH closed at exec and has
    /// not yet been reacquired. Such a handoff is busy, never an empty snapshot.
    static func activeRuntimeIdentities(
        storeRootURL: URL = defaultStoreRootURL, validator: (URL) -> String? = signedIdentity
    ) throws -> Set<String> {
        var rootInfo = stat()
        if lstat(storeRootURL.path, &rootInfo) != 0 {
            guard errno == ENOENT else { throw unverified() }
            return []
        }
        let store = try StoreAdmission.acquire(rootURL: storeRootURL, use: .exclusive, create: false, waitForContention: false)
        var active: Set<String> = []
        for name in try names(store.root) where name != admissionFileName {
            if name.hasPrefix(".staging-") {
                do { try verifyUnpublishedStage(admission: store, name: name) }
                catch AppRuntimeUseLeaseError.busy { throw CoordinatorError("app_bridge_runtime_store_busy") }
                catch {
                    throw CoordinatorError("app_bridge_runtime_staging_unverified", PetL10n.text(
                        "An unfinished Blabee connection runtime could not be verified. Keep the app open and try again; contact support if this persists.",
                        korean: "완료되지 않은 Blabee 연결 실행 파일을 확인하지 못했습니다. 앱을 유지하고 다시 시도해 주세요. 계속되면 지원팀에 문의해 주세요."
                    ))
                }
                continue
            }
            let identity = "sha256:" + name
            guard OperationalRuntimeIdentity.isValid(identity) else { throw unverified() }
            try verifyGeneration(admission: store, name: name, identity: identity, validator: validator)
            let executable = appURL(root: storeRootURL, name: name).appendingPathComponent(AppRuntimeUseLease.executablePath)
            do {
                let lease = try AppRuntimeUseLease.acquire(executableURL: executable, use: .installation)
                try lease.verify(at: executable)
            } catch AppRuntimeUseLeaseError.busy { active.insert(identity) }
        }
        try store.verify()
        return active
    }

    private static func signedIdentity(_ app: URL) -> String? {
        OperationalRuntimeIdentity.installedIdentity(forExecutable: app.appendingPathComponent(AppRuntimeUseLease.executablePath))
    }

    private static func generationName(_ identity: String) throws -> String {
        guard OperationalRuntimeIdentity.isValid(identity) else { throw unverified() }
        return String(identity.dropFirst(7))
    }

    private static func appURL(root: URL, name: String) -> URL {
        root.appendingPathComponent(name, isDirectory: true).appendingPathComponent("Blabee.app", isDirectory: true)
    }

    private static func verifyIndependentCopy(source: URL, destination: URL) throws {
        if source.path == destination.path { return }
        var first = stat(), second = stat()
        guard lstat(source.appendingPathComponent(AppRuntimeUseLease.executablePath).path, &first) == 0,
              lstat(destination.appendingPathComponent(AppRuntimeUseLease.executablePath).path, &second) == 0,
              first.st_dev != second.st_dev || first.st_ino != second.st_ino else { throw unverified() }
    }

    private static func verifyGeneration(
        admission: StoreAdmission, name: String, identity: String, validator: (URL) -> String?
    ) throws {
        try admission.verify()
        let generation = try openChildDirectory(parent: admission.root, name: name, mode: 0o500)
        defer { close(generation) }
        let generationBefore = try info(generation)
        guard try Set(names(generation)) == ["Blabee.app", originFileName],
              try readOrigin(parent: generation).identity == identity else { throw unverified() }
        let app = try openChildDirectory(parent: generation, name: "Blabee.app", mode: 0o500)
        defer { close(app) }
        let appBefore = try info(app)
        try walkApp(app, freeze: false)
        guard validator(appURL(root: admission.rootURL, name: name)) == identity else { throw unverified() }
        try verifyNamedDirectory(parent: generation, name: "Blabee.app", descriptor: app, mode: 0o500)
        try verifyNamedDirectory(parent: admission.root, name: name, descriptor: generation, mode: 0o500)
        guard sameFile(appBefore, try info(app)), sameFile(generationBefore, try info(generation)) else { throw unverified() }
        try admission.verify()
    }

    /// A recognized stage has a bound creation record, safe bounded contents,
    /// and no native user. It is never a valid bootstrap execution location.
    /// Keep it on disk for diagnosis; do not adopt, repair or delete it here.
    private static func verifyUnpublishedStage(admission: StoreAdmission, name: String) throws {
        guard validStageName(name) else { throw unverified() }
        let staging = try openChildDirectory(parent: admission.root, name: name)
        defer { close(staging) }
        let before = try info(staging)
        let mode = before.st_mode & 0o7777
        var nativeLease: AppRuntimeUseLease?
        defer { withExtendedLifetime(nativeLease) {} }
        guard mode == 0o700 || mode == 0o500,
              try readOrigin(parent: staging).name == name,
              try Set(names(staging)).isSubset(of: [originFileName, "Blabee.app"]) else { throw unverified() }
        if try exists(parent: staging, name: "Blabee.app") {
            let app = try openChildDirectory(parent: staging, name: "Blabee.app")
            defer { close(app) }
            try walkApp(app, freeze: false, allowMutableStage: true)
            let executable = admission.rootURL.appendingPathComponent(name)
                .appendingPathComponent("Blabee.app").appendingPathComponent(AppRuntimeUseLease.executablePath)
            var metadata = stat()
            if lstat(executable.path, &metadata) == 0 {
                nativeLease = try AppRuntimeUseLease.acquire(executableURL: executable, use: .installation)
                try nativeLease?.verify(at: executable)
            } else if errno != ENOENT { throw unverified() }
            try verifyNamedDirectory(parent: staging, name: "Blabee.app", descriptor: app, mode: try info(app).st_mode & 0o7777)
        }
        try verifyNamedDirectory(parent: admission.root, name: name, descriptor: staging, mode: mode)
        guard sameFile(before, try info(staging)) else { throw unverified() }
        try admission.verify()
    }

    private static func validStageName(_ name: String) -> Bool {
        guard name.hasPrefix(".staging-") else { return false }
        let suffix = String(name.dropFirst(9))
        return UUID(uuidString: suffix)?.uuidString.lowercased() == suffix
    }

    private static func writeOrigin(parent: Int32, stageName: String, identity: String) throws {
        let data = Data(("blabee.bridge-runtime-stage.v1\n" + stageName + "\n" + identity + "\n").utf8)
        let descriptor = openat(parent, originFileName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw unverified() }
        defer { close(descriptor) }
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw unverified() }
                offset += count
            }
        }
        guard fchmod(descriptor, 0o400) == 0 else { throw unverified() }
        try sync(descriptor)
        try sync(parent)
    }

    private static func readOrigin(parent: Int32) throws -> (name: String, identity: String) {
        let descriptor = openat(parent, originFileName, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw unverified() }
        defer { close(descriptor) }
        let before = try info(descriptor)
        guard before.st_mode & S_IFMT == S_IFREG, before.st_mode & 0o7777 == 0o400,
              before.st_uid == geteuid(), before.st_nlink == 1, before.st_size > 0, before.st_size <= 256 else { throw unverified() }
        var bytes = [UInt8](repeating: 0, count: Int(before.st_size))
        try bytes.withUnsafeMutableBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = read(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw unverified() }
                offset += count
            }
        }
        var named = stat()
        guard sameFile(before, try info(descriptor)),
              fstatat(parent, originFileName, &named, AT_SYMLINK_NOFOLLOW) == 0, sameFile(before, named),
              let value = String(bytes: bytes, encoding: .utf8) else { throw unverified() }
        let fields = value.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard fields.count == 4, fields[0] == "blabee.bridge-runtime-stage.v1", fields[3].isEmpty,
              validStageName(fields[1]), OperationalRuntimeIdentity.isValid(fields[2]) else { throw unverified() }
        return (fields[1], fields[2])
    }

    fileprivate enum AdmissionUse { case shared, exclusive }

    fileprivate final class StoreAdmission {
        let root: Int32
        let descriptor: Int32
        let rootURL: URL
        private let rootIdentity: stat
        private let lockIdentity: stat

        private init(root: Int32, descriptor: Int32, rootURL: URL, rootIdentity: stat, lockIdentity: stat) {
            self.root = root; self.descriptor = descriptor; self.rootURL = rootURL
            self.rootIdentity = rootIdentity; self.lockIdentity = lockIdentity
        }
        deinit { close(descriptor); close(root) }

        static func acquire(rootURL: URL, use: AdmissionUse, create: Bool, waitForContention: Bool = true) throws -> StoreAdmission {
            let root = try openAbsoluteDirectory(rootURL, create: create)
            var lock: Int32 = -1
            var ownsRoot = true
            do {
                let rootInfo = try info(root)
                guard rootInfo.st_uid == geteuid(), rootInfo.st_mode & 0o7777 == 0o700 else { throw unverified() }
                lock = try openAdmissionLock(parent: root, create: create)
                let lockInfo = try info(lock)
                try verifyLockMetadata(lockInfo)
                // Contention is bounded and does not enqueue an unbounded set
                // of blocked process launches. No NS/main-actor dependency.
                let deadline = DispatchTime.now().uptimeNanoseconds + 10_000_000_000
                while flock(lock, (use == .shared ? LOCK_SH : LOCK_EX) | LOCK_NB) != 0 {
                    guard errno == EWOULDBLOCK, waitForContention, DispatchTime.now().uptimeNanoseconds < deadline else {
                        throw CoordinatorError("app_bridge_runtime_store_busy")
                    }
                    usleep(10_000)
                }
                if create { try sync(root) }
                let admission = StoreAdmission(root: root, descriptor: lock, rootURL: rootURL,
                                               rootIdentity: rootInfo, lockIdentity: lockInfo)
                // Ownership has transferred; verification failure is released
                // by deinit rather than closing the same descriptors twice.
                lock = -1
                ownsRoot = false
                try admission.verify()
                return admission
            } catch {
                if lock >= 0 { close(lock) }
                if ownsRoot { close(root) }
                throw error
            }
        }

        func verify() throws {
            let currentRoot = try openAbsoluteDirectory(rootURL, create: false)
            defer { close(currentRoot) }
            var namedLock = stat()
            guard sameDirectory(rootIdentity, try info(root)), sameDirectory(rootIdentity, try info(currentRoot)),
                  fstatat(root, admissionFileName, &namedLock, AT_SYMLINK_NOFOLLOW) == 0,
                  sameFile(lockIdentity, namedLock), sameFile(lockIdentity, try info(descriptor)) else { throw unverified() }
            try Self.verifyLockMetadata(namedLock)
        }

        func verifyInherited(_ inherited: Int32) throws {
            try verify()
            let metadata = try info(inherited)
            let flags = fcntl(inherited, F_GETFL)
            let fdFlags = fcntl(inherited, F_GETFD)
            guard sameFile(lockIdentity, metadata), flags >= 0, flags & O_ACCMODE == O_RDWR,
                  fdFlags >= 0, fdFlags & FD_CLOEXEC == 0 else { throw unverified() }
            try Self.verifyLockMetadata(metadata)
        }

        private static func verifyLockMetadata(_ value: stat) throws {
            guard value.st_mode & S_IFMT == S_IFREG, value.st_mode & 0o7777 == 0o600,
                  value.st_uid == geteuid(), value.st_nlink == 1, value.st_size == 0 else { throw unverified() }
        }

        private static func openAdmissionLock(parent: Int32, create: Bool) throws -> Int32 {
            let flags = O_RDWR | O_NOFOLLOW | O_CLOEXEC
            // Concurrent O_CREAT opens can report ENOENT even while the parent
            // is live. Open an existing lock first; exclusive creation makes
            // the first-start race explicit without touching an existing inode.
            for _ in 0..<8 {
                let existing = openat(parent, admissionFileName, flags)
                if existing >= 0 { return existing }
                guard errno == ENOENT, create else { throw unverified() }
                let created = openat(parent, admissionFileName, flags | O_CREAT | O_EXCL, 0o600)
                if created >= 0 { return created }
                guard errno == EEXIST else { throw unverified() }
            }
            throw unverified()
        }
    }

    /// Open every path component without following links. Creation only adds
    /// missing private directories; existing ownership/modes are never repaired.
    private static func openAbsoluteDirectory(_ url: URL, create: Bool) throws -> Int32 {
        guard url.isFileURL, url.path.hasPrefix("/"), url.path.utf8.count <= 4_096,
              !url.path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw unverified() }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard !parts.isEmpty, !parts.contains("."), !parts.contains("..") else { throw unverified() }
        var current = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard current >= 0 else { throw unverified() }
        do {
            for component in parts {
                var next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0, errno == ENOENT, create {
                    guard mkdirat(current, component, 0o700) == 0 || errno == EEXIST else { throw unverified() }
                    try sync(current)
                    next = openat(current, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                guard next >= 0 else { throw unverified() }
                do {
                    let metadata = try info(next)
                    guard metadata.st_uid == geteuid() || metadata.st_uid == 0,
                          metadata.st_mode & 0o002 == 0 || (metadata.st_uid == 0 && metadata.st_mode & 0o1000 != 0),
                          metadata.st_mode & 0o020 == 0 || metadata.st_uid == 0 else { throw unverified() }
                } catch { close(next); throw error }
                close(current); current = next
            }
            guard AppUpdateRuntimeCopy.physicalPath(url) == url.path else { throw unverified() }
            return current
        } catch { close(current); throw error }
    }

    private static func openChildDirectory(parent: Int32, name: String, mode: mode_t? = nil) throws -> Int32 {
        let descriptor = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw unverified() }
        do {
            let metadata = try info(descriptor)
            guard metadata.st_mode & S_IFMT == S_IFDIR, metadata.st_uid == geteuid(),
                  mode.map({ metadata.st_mode & 0o7777 == $0 }) ?? (metadata.st_mode & 0o022 == 0) else { throw unverified() }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    private static func verifyNamedDirectory(parent: Int32, name: String, descriptor: Int32, mode: mode_t) throws {
        var named = stat()
        let held = try info(descriptor)
        guard held.st_uid == geteuid(), held.st_mode & 0o7777 == mode,
              fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              sameDirectory(held, named) else { throw unverified() }
    }

    private static func walkApp(_ root: Int32, freeze: Bool, allowMutableStage: Bool = false) throws {
        var count = 0, bytes: Int64 = 0
        let deadline = DispatchTime.now().uptimeNanoseconds + 60_000_000_000
        func walk(_ directory: Int32, depth: Int) throws {
            count += 1
            let before = try info(directory)
            guard count <= AppUpdateRuntimeCopy.maximumEntries, depth <= 64,
                  DispatchTime.now().uptimeNanoseconds < deadline,
                  before.st_mode & S_IFMT == S_IFDIR, before.st_uid == geteuid(),
                  (freeze || allowMutableStage) ? before.st_mode & 0o7022 == 0 : before.st_mode & 0o7777 == 0o500 else { throw unverified() }
            for name in try names(directory) {
                var named = stat()
                guard fstatat(directory, name, &named, AT_SYMLINK_NOFOLLOW) == 0 else { throw unverified() }
                if named.st_mode & S_IFMT == S_IFDIR {
                    let child = try openChildDirectory(parent: directory, name: name)
                    defer { close(child) }
                    guard sameDirectory(named, try info(child)) else { throw unverified() }
                    try walk(child, depth: depth + 1)
                    try verifyNamedDirectory(parent: directory, name: name, descriptor: child,
                                             mode: allowMutableStage ? named.st_mode & 0o7777 : 0o500)
                } else {
                    count += 1
                    guard named.st_mode & S_IFMT == S_IFREG, named.st_nlink == 1, named.st_uid == geteuid(),
                          named.st_size >= 0, Int64(named.st_size) <= AppUpdateRuntimeCopy.maximumBytes - bytes,
                          count <= AppUpdateRuntimeCopy.maximumEntries else { throw unverified() }
                    bytes += Int64(named.st_size)
                    let file = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
                    guard file >= 0 else { throw unverified() }
                    defer { close(file) }
                    guard sameFile(named, try info(file)) else { throw unverified() }
                    let finalMode: mode_t = named.st_mode & 0o111 == 0 ? 0o400 : 0o500
                    if freeze {
                        guard named.st_mode & 0o022 == 0, fchmod(file, finalMode) == 0 else { throw unverified() }
                        try sync(file)
                    } else if allowMutableStage {
                        guard named.st_mode & 0o7022 == 0 else { throw unverified() }
                    } else if named.st_mode & 0o7777 != finalMode { throw unverified() }
                    var after = stat()
                    guard fstatat(directory, name, &after, AT_SYMLINK_NOFOLLOW) == 0,
                          sameFile(try info(file), after), after.st_nlink == 1 else { throw unverified() }
                }
            }
            if freeze {
                guard fchmod(directory, 0o500) == 0 else { throw unverified() }
                try sync(directory)
            }
            let after = try info(directory)
            guard before.st_dev == after.st_dev, before.st_ino == after.st_ino,
                  after.st_uid == geteuid(),
                  after.st_mode & 0o7777 == (allowMutableStage ? before.st_mode & 0o7777 : 0o500) else { throw unverified() }
        }
        try walk(root, depth: 0)
    }

    private static func removeTreeContents(_ directory: Int32) throws {
        guard fchmod(directory, 0o700) == 0 else { throw unverified() }
        for name in try names(directory) {
            var named = stat()
            guard fstatat(directory, name, &named, AT_SYMLINK_NOFOLLOW) == 0 else { throw unverified() }
            if named.st_mode & S_IFMT == S_IFDIR {
                let child = try openChildDirectory(parent: directory, name: name, mode: 0o500)
                defer { close(child) }
                guard sameDirectory(named, try info(child)) else { throw unverified() }
                try removeTreeContents(child)
                try verifyNamedDirectory(parent: directory, name: name, descriptor: child, mode: 0o700)
                guard unlinkat(directory, name, AT_REMOVEDIR) == 0 else { throw unverified() }
            } else {
                guard named.st_mode & S_IFMT == S_IFREG, named.st_nlink == 1, named.st_uid == geteuid(),
                      named.st_mode & 0o7777 == 0o400 || named.st_mode & 0o7777 == 0o500 else { throw unverified() }
                guard unlinkat(directory, name, 0) == 0 else { throw unverified() }
            }
        }
        try sync(directory)
    }

    private static func exists(parent: Int32, name: String) throws -> Bool {
        var metadata = stat()
        if fstatat(parent, name, &metadata, AT_SYMLINK_NOFOLLOW) == 0 { return true }
        guard errno == ENOENT else { throw unverified() }
        return false
    }

    private static func names(_ descriptor: Int32) throws -> [String] {
        let duplicate = fcntl(descriptor, F_DUPFD_CLOEXEC, 3)
        guard duplicate >= 0 else { throw unverified() }
        guard let directory = fdopendir(duplicate) else { close(duplicate); throw unverified() }
        defer { closedir(directory) }
        // dup shares the directory offset with descriptor. Rewind each scan.
        rewinddir(directory)
        var result: [String] = []
        while true {
            errno = 0
            guard let entry = readdir(directory) else {
                guard errno == 0 else { throw unverified() }
                return result
            }
            let name = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(entry.pointee.d_namlen) + 1) { String(cString: $0) }
            }
            if name == "." || name == ".." { continue }
            result.append(name)
            guard result.count <= maximumStoreEntries else { throw unverified() }
        }
    }

    private static func info(_ descriptor: Int32) throws -> stat {
        var value = stat()
        guard fstat(descriptor, &value) == 0 else { throw unverified() }
        return value
    }
    private static func sameDirectory(_ first: stat, _ second: stat) -> Bool {
        first.st_dev == second.st_dev && first.st_ino == second.st_ino && first.st_uid == second.st_uid
            && first.st_mode == second.st_mode && first.st_mode & S_IFMT == S_IFDIR
    }
    private static func sameFile(_ first: stat, _ second: stat) -> Bool {
        first.st_dev == second.st_dev && first.st_ino == second.st_ino && first.st_uid == second.st_uid
            && first.st_mode == second.st_mode && first.st_nlink == second.st_nlink && first.st_size == second.st_size
            && first.st_mtimespec.tv_sec == second.st_mtimespec.tv_sec
            && first.st_mtimespec.tv_nsec == second.st_mtimespec.tv_nsec
            && first.st_ctimespec.tv_sec == second.st_ctimespec.tv_sec
            && first.st_ctimespec.tv_nsec == second.st_ctimespec.tv_nsec
    }
    private static func sync(_ descriptor: Int32) throws {
        guard fsync(descriptor) == 0 else { throw unverified() }
    }
    private static func unverified() -> CoordinatorError {
        let message = PetL10n.text(
            "Unable to verify Blabee's isolated connection runtime. Reopen the installed app.",
            korean: "Blabee의 분리된 연결 실행 파일을 확인하지 못했습니다. 설치된 앱을 다시 열어 주세요."
        )
        return CoordinatorError("app_bridge_runtime_store_unverified", message)
    }
}
