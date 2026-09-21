import Darwin
import Foundation

/// Owns only a separate PATH shim and an exact, reversible .zshrc block.
/// The upstream Claude executable (including its updater symlink) is never changed.
actor ClaudeAutoConnectSetup {
    struct Inspection: Equatable, Sendable {
        let isEnabled: Bool
        let canEnable: Bool
        let canDisable: Bool
        let detail: String
    }

    private enum Failure: Error { case manualReview, executableUnavailable, installedRuntimeUnavailable }
    private let home: URL
    private let environment: [String: String]
    private let coordinator: URL
    private let claude: URL
    private let requiresInstalledRuntime: Bool
    private let beforeStartupReplace: (@Sendable () throws -> Void)?
    private static let opening = "# >>> Blabee Claude Auto Connect v1 >>>"
    private static let closing = "# <<< Blabee Claude Auto Connect v1 <<<"
    private static let maximumStartupBytes = 256 * 1_024
    static let manualReviewDetail = "Claude 자동 연결 설정이 변경되었거나 경로를 안전하게 확인할 수 없습니다. 셸 설정과 Blabee 관리 파일을 직접 확인해 주세요."

    init(homeURL: URL, environment: [String: String] = [:], coordinatorExecutable: URL,
         claudeExecutable: URL, requiresInstalledRuntime: Bool = false,
         beforeStartupReplace: (@Sendable () throws -> Void)? = nil) {
        home = homeURL
        self.environment = environment
        coordinator = coordinatorExecutable
        claude = claudeExecutable
        self.requiresInstalledRuntime = requiresInstalledRuntime
        self.beforeStartupReplace = beforeStartupReplace
    }

    static func live(environment: [String: String] = ProcessInfo.processInfo.environment) -> ClaudeAutoConnectSetup {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates = PetClaudeLauncher.claudeCandidates(homeDirectory: home)
        // Keep the public symlink path so Claude's own updater can replace its target.
        let claude = candidates.first { FileManager.default.isExecutableFile(atPath: $0.path) } ?? candidates[0]
        return ClaudeAutoConnectSetup(homeURL: home, environment: environment,
            coordinatorExecutable: URL(fileURLWithPath: "/Applications/Blabee.app/Contents/MacOS/blabee-coordinator"),
            claudeExecutable: claude, requiresInstalledRuntime: true)
    }

    func inspect() async -> Inspection {
        do {
            let snapshot = try snapshot()
            if snapshot.shim != nil { return enabled() }
            try validateExecutables()
            return disabled()
        } catch { return rejected(error) }
    }

    func enable() async -> Inspection {
        do {
            // Read the user's startup first, but inspect managed ownership only
            // under the lock: another manager can be between shim and rc writes.
            let initial = try startupSnapshot()
            try validateExecutables()
            if requiresInstalledRuntime { try validateInstalledRuntime() }
            let root = try openDirectory(directory, create: true, privateLeaf: true)
            defer { close(root) }
            let bin = try openDirectory(binDirectory, create: true, privateLeaf: true)
            defer { close(bin) }
            let lock = try acquireLock(root)
            defer { flock(lock, LOCK_UN); close(lock) }
            let current = try snapshot()
            if current.shim != nil { return enabled() }
            guard current.startupURL == initial.url, current.startup == initial.file else { throw Failure.manualReview }
            let bytes = Self.shimBytes(coordinator: coordinator.path, claude: claude.path,
                startup: current.startupURL.path, originallyMissing: current.startup == nil)
            let created = try writeExclusive(parent: bin, name: "claude", bytes: bytes, mode: 0o700)
            do {
                try backup(current.startup, root: root)
                var newBytes = current.startup?.bytes ?? Data()
                newBytes.append(Data(Self.managedBlock(binPath: binDirectory.path).utf8))
                try replaceStartup(current, bytes: newBytes, root: root)
                try verifyDirectory(root, at: directory)
                try verifyDirectory(bin, at: binDirectory)
                guard let actual = try readFile(parent: bin, name: "claude", limit: 32 * 1_024),
                      actual.matchesMoved(created), (try snapshot()).shim != nil else { throw Failure.manualReview }
                return enabled()
            } catch {
                // Roll back only our exact shim, when startup has no managed
                // reference. Never restore an old whole-file backup.
                if let now = try? startupSnapshot(),
                   (try? requireNoManagedReference(now.file?.bytes ?? Data())) != nil {
                    try? removeExact(parent: bin, name: "claude", expected: created, recovery: root)
                }
                throw error
            }
        } catch { return rejected(error) }
    }

    func disable() async -> Inspection {
        do {
            let initial = try snapshot()
            guard initial.shim != nil else { return disabled() }
            let root = try openDirectory(directory, privateLeaf: true)
            defer { close(root) }
            let bin = try openDirectory(binDirectory, privateLeaf: true)
            defer { close(bin) }
            let lock = try acquireLock(root)
            defer { flock(lock, LOCK_UN); close(lock) }
            let current = try snapshot()
            guard let shim = current.shim, let startup = current.startup,
                  let owned = current.owned else { return disabled() }
            let remaining = try removingBlock(from: startup.bytes)
            try backup(startup, root: root)
            if owned.originallyMissing && remaining.isEmpty {
                try beforeStartupReplace?()
                let parent = try openDirectory(current.startupURL.deletingLastPathComponent())
                defer { close(parent) }
                try verifyDirectory(root, at: directory)
                try removeExact(parent: parent, name: ".zshrc", expected: startup, recovery: root)
            } else {
                try replaceStartup(current, bytes: remaining, root: root)
            }
            try verifyDirectory(bin, at: binDirectory)
            try removeExact(parent: bin, name: "claude", expected: shim, recovery: root)
            return disabled()
        } catch { return rejected(error) }
    }

    private var directory: URL { home.appendingPathComponent("Library/Application Support/Blabee/shell/claude-v1") }
    private var binDirectory: URL { directory.appendingPathComponent("bin") }
    private var shimURL: URL { binDirectory.appendingPathComponent("claude") }

    private struct Identity: Sendable, Equatable {
        let device: dev_t, inode: ino_t, mode: mode_t, owner: uid_t, group: gid_t, links: nlink_t, flags: UInt32
        init(_ s: stat) {
            device = s.st_dev; inode = s.st_ino; mode = s.st_mode; owner = s.st_uid; group = s.st_gid
            links = s.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) ? 0 : s.st_nlink
            flags = s.st_flags
        }
    }
    private struct FileSnapshot: Sendable, Equatable {
        let identity: Identity
        let bytes: Data
        let modifiedSeconds: Int, modifiedNanos: Int, changedSeconds: Int, changedNanos: Int
        init(_ s: stat, _ data: Data) {
            identity = Identity(s); bytes = data
            modifiedSeconds = s.st_mtimespec.tv_sec; modifiedNanos = s.st_mtimespec.tv_nsec
            changedSeconds = s.st_ctimespec.tv_sec; changedNanos = s.st_ctimespec.tv_nsec
        }
        func matchesMoved(_ other: Self) -> Bool {
            identity == other.identity && bytes == other.bytes && modifiedSeconds == other.modifiedSeconds
                && modifiedNanos == other.modifiedNanos
        }
    }
    private struct Owned: Sendable {
        let coordinator: String, claude: String, startup: String
        let originallyMissing: Bool
    }
    private struct Snapshot {
        let startupURL: URL
        let startup: FileSnapshot?
        let shim: FileSnapshot?
        let owned: Owned?
    }

    private func snapshot() throws -> Snapshot {
        let startup = try startupSnapshot()
        let root = try openDirectory(directory, allowMissing: true, privateLeaf: true)
        defer { if root >= 0 { close(root) } }
        var shim: FileSnapshot?
        if root >= 0 {
            let bin = try openDirectory(binDirectory, allowMissing: true, privateLeaf: true)
            defer { if bin >= 0 { close(bin) } }
            if bin >= 0 { shim = try readFile(parent: bin, name: "claude", limit: 32 * 1_024) }
        }
        if let shim {
            let owned = try parseOwnedShim(shim.bytes)
            guard owned.startup == startup.url.path, owned.coordinator == coordinator.path,
                  shim.identity.mode & 0o777 == 0o700,
                  let file = startup.file else { throw Failure.manualReview }
            _ = try removingBlock(from: file.bytes)
            return Snapshot(startupURL: startup.url, startup: file, shim: shim, owned: owned)
        }
        if let file = startup.file { try requireNoManagedReference(file.bytes) }
        return Snapshot(startupURL: startup.url, startup: startup.file, shim: nil, owned: nil)
    }

    private func startupSnapshot() throws -> (url: URL, file: FileSnapshot?) {
        guard Self.safeAbsolutePath(home.path), home.path != "/", !home.path.contains(":") else { throw Failure.manualReview }
        let dot: URL
        if let configured = environment["ZDOTDIR"] {
            guard Self.safeAbsolutePath(configured), configured == home.path || configured.hasPrefix(home.path + "/")
            else { throw Failure.manualReview }
            dot = URL(fileURLWithPath: configured, isDirectory: true)
        } else { dot = home }
        let startup = dot.appendingPathComponent(".zshrc")
        var file: FileSnapshot?
        // A GUI process cannot infer a dynamic ZDOTDIR assignment by running a
        // user's startup scripts. Such setups require manual review instead.
        for base in Set([home.path, dot.path]).sorted() {
            let parent = try openDirectory(URL(fileURLWithPath: base, isDirectory: true))
            defer { close(parent) }
            for name in [".zshenv", ".zprofile", ".zlogin", ".zshrc"] {
                guard let observed = try readFile(parent: parent, name: name, limit: Self.maximumStartupBytes) else { continue }
                guard let text = String(data: observed.bytes, encoding: .utf8), !text.contains("ZDOTDIR") else { throw Failure.manualReview }
                if base + "/" + name == startup.path { file = observed }
                else { try requireNoManagedReference(observed.bytes) }
            }
        }
        return (startup, file)
    }

    private func parseOwnedShim(_ bytes: Data) throws -> Owned {
        guard let source = String(data: bytes, encoding: .utf8) else { throw Failure.manualReview }
        let lines = source.components(separatedBy: "\n")
        guard lines.count > 8,
              let coordinator = Self.decode(lines[3], prefix: "# coordinator-base64: "),
              let claude = Self.decode(lines[4], prefix: "# claude-base64: "),
              let startup = Self.decode(lines[5], prefix: "# startup-base64: "),
              ["# startup-origin: missing", "# startup-origin: present"].contains(lines[6]),
              coordinator != shimURL.path, !claude.hasPrefix(directory.path + "/"),
              bytes == Self.shimBytes(coordinator: coordinator, claude: claude, startup: startup,
                                     originallyMissing: lines[6] == "# startup-origin: missing") else { throw Failure.manualReview }
        return Owned(coordinator: coordinator, claude: claude, startup: startup,
                     originallyMissing: lines[6] == "# startup-origin: missing")
    }

    private func removingBlock(from bytes: Data) throws -> Data {
        guard let source = String(data: bytes, encoding: .utf8) else { throw Failure.manualReview }
        let block = Self.managedBlock(binPath: binDirectory.path)
        guard let range = source.range(of: block) else { throw Failure.manualReview }
        let remainder = Data((String(source[..<range.lowerBound]) + String(source[range.upperBound...])).utf8)
        try requireNoManagedReference(remainder)
        return remainder
    }

    private func requireNoManagedReference(_ bytes: Data) throws {
        guard let source = String(data: bytes, encoding: .utf8),
              ![Self.opening, Self.closing, binDirectory.path, "shell/claude-v1", "Blabee Claude Auto Connect v1"].contains(where: { source.contains($0) })
        else { throw Failure.manualReview }
    }

    private func validateExecutables() throws {
        for executable in [coordinator, claude] {
            guard Self.safeAbsolutePath(executable.path), executable.path != shimURL.path else { throw Failure.executableUnavailable }
            let canonical = executable.resolvingSymlinksInPath()
            var s = stat()
            guard !canonical.path.hasPrefix(directory.path + "/"), stat(canonical.path, &s) == 0,
                  s.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), s.st_uid == getuid() || s.st_uid == 0,
                  s.st_mode & 0o022 == 0, s.st_mode & 0o6000 == 0,
                  FileManager.default.isExecutableFile(atPath: executable.path) else { throw Failure.executableUnavailable }
        }
    }

    private func validateInstalledRuntime() throws {
        do {
            guard coordinator.path == "/Applications/Blabee.app/Contents/MacOS/blabee-coordinator",
                  let identity = OperationalRuntimeIdentity.installedIdentity(forExecutable: coordinator),
                  try OperationalRuntimeIdentity.requireCurrent() == identity else { throw Failure.installedRuntimeUnavailable }
            let pin = try ClaudeInstalledLauncher.signedManifestPin(executable: coordinator, runtimeIdentity: identity)
            let root = coordinator.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources/claude")
            _ = try ClaudeRuntimePayload.qualify(rootURL: root,
                expectedArchitecture: ClaudeInstalledLauncher.runtimeArchitecture, expectedManifestSHA256: pin)
        } catch { throw Failure.installedRuntimeUnavailable }
    }

    /// Directory descriptors anchor every mutation. No component under HOME is
    /// followed through a symlink, and existing directories are never chmod'ed.
    private func openDirectory(_ url: URL, allowMissing: Bool = false, create: Bool = false,
                               privateLeaf: Bool = false) throws -> Int32 {
        guard Self.safeAbsolutePath(home.path), home.path != "/", Self.safeAbsolutePath(url.path),
              url.path == home.path || url.path.hasPrefix(home.path + "/") else { throw Failure.manualReview }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else { throw Failure.manualReview }
        var path = ""
        do {
            for part in url.path.split(separator: "/") {
                let name = String(part)
                path += "/" + name
                let inside = path == home.path || path.hasPrefix(home.path + "/")
                var next = openat(descriptor, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0 && errno == ENOENT && create && inside && path != home.path {
                    guard mkdirat(descriptor, name, 0o700) == 0 || errno == EEXIST else { throw Failure.manualReview }
                    next = openat(descriptor, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                }
                if next < 0 {
                    if allowMissing && errno == ENOENT { close(descriptor); return -1 }
                    throw Failure.manualReview
                }
                close(descriptor); descriptor = next
                let s = try metadata(descriptor)
                let temporaryAncestor = !inside && s.st_uid == 0 && s.st_mode & mode_t(S_ISVTX) != 0
                guard s.st_uid == getuid() || (!inside && s.st_uid == 0),
                      s.st_mode & 0o022 == 0 || temporaryAncestor,
                      !(try hasACL(descriptor, allowingDeny: true)) else { throw Failure.manualReview }
            }
            if privateLeaf {
                let s = try metadata(descriptor)
                guard s.st_uid == getuid(), s.st_mode & 0o077 == 0 else { throw Failure.manualReview }
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    private func verifyDirectory(_ descriptor: Int32, at url: URL) throws {
        let actual = try openDirectory(url)
        defer { close(actual) }
        guard try Identity(metadata(actual)) == Identity(metadata(descriptor)) else { throw Failure.manualReview }
    }

    private func metadata(_ descriptor: Int32) throws -> stat {
        var value = stat()
        guard fstat(descriptor, &value) == 0 else { throw Failure.manualReview }
        return value
    }

    private func hasACL(_ descriptor: Int32, allowingDeny: Bool) throws -> Bool {
        errno = 0
        guard let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED) else {
            if errno == ENOENT { return false }
            throw Failure.manualReview
        }
        defer { acl_free(UnsafeMutableRawPointer(acl)) }
        var entry: acl_entry_t?
        var flag: Int32 = 0
        while true {
            let result = acl_get_entry(acl, flag, &entry)
            if result == -1 && errno == EINVAL { return false }
            guard result == 0, let entry else { throw Failure.manualReview }
            var tag = acl_tag_t(0)
            guard acl_get_tag_type(entry, &tag) == 0 else { throw Failure.manualReview }
            if !allowingDeny || tag != ACL_EXTENDED_DENY { return true }
            flag = -1
        }
    }

    private func readFile(parent: Int32, name: String, limit: Int) throws -> FileSnapshot? {
        let descriptor = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else {
            if errno == ENOENT { return nil }
            throw Failure.manualReview
        }
        defer { close(descriptor) }
        let before = try metadata(descriptor)
        guard before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), before.st_uid == getuid(),
              before.st_nlink == 1, before.st_mode & 0o7022 == 0, before.st_flags == 0,
              before.st_size >= 0, before.st_size <= limit, !(try hasACL(descriptor, allowingDeny: false))
        else { throw Failure.manualReview }
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count == -1 && errno == EINTR { continue }
            guard count >= 0 else { throw Failure.manualReview }
            if count == 0 { break }
            bytes.append(contentsOf: buffer.prefix(count))
            guard bytes.count <= limit else { throw Failure.manualReview }
        }
        let after = try metadata(descriptor)
        var named = stat()
        guard fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              FileSnapshot(before, bytes) == FileSnapshot(after, bytes),
              FileSnapshot(after, bytes) == FileSnapshot(named, bytes), bytes.count == before.st_size
        else { throw Failure.manualReview }
        return FileSnapshot(after, bytes)
    }

    private func writeExclusive(parent: Int32, name: String, bytes: Data, mode: mode_t) throws -> FileSnapshot {
        let descriptor = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw Failure.manualReview }
        defer { close(descriptor) }
        do {
            try bytes.withUnsafeBytes { buffer in
                var offset = 0
                while offset < buffer.count {
                    let count = write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                    if count < 0 && errno == EINTR { continue }
                    guard count > 0 else { throw Failure.manualReview }
                    offset += count
                }
            }
            guard fchmod(descriptor, mode) == 0, fsync(descriptor) == 0 else { throw Failure.manualReview }
            let written = FileSnapshot(try metadata(descriptor), bytes)
            guard let actual = try readFile(parent: parent, name: name, limit: max(bytes.count, 1)), actual == written
            else { throw Failure.manualReview }
            return written
        } catch {
            // Leave an incomplete exclusive file for review; never delete a
            // pathname that might have been replaced by another process.
            throw error
        }
    }

    private func backup(_ file: FileSnapshot?, root: Int32) throws {
        guard let file else { return }
        try verifyDirectory(root, at: directory)
        let backups = try openDirectory(directory.appendingPathComponent("backups"), create: true, privateLeaf: true)
        defer { close(backups) }
        _ = try writeExclusive(parent: backups, name: "zshrc-" + UUID().uuidString.lowercased(), bytes: file.bytes, mode: 0o600)
        guard fsync(backups) == 0 else { throw Failure.manualReview }
    }

    private func replaceStartup(_ expected: Snapshot, bytes: Data, root: Int32) throws {
        guard bytes.count <= Self.maximumStartupBytes else { throw Failure.manualReview }
        let parentURL = expected.startupURL.deletingLastPathComponent()
        let parent = try openDirectory(parentURL)
        defer { close(parent) }
        let temporary = ".blabee-claude-" + UUID().uuidString.lowercased()
        let mode = expected.startup.map { $0.identity.mode & 0o777 } ?? 0o600
        let written = try writeExclusive(parent: parent, name: temporary, bytes: bytes, mode: mode)
        defer {
            // This only removes our still-identical staged bytes. A displaced
            // editor file is retained for manual recovery after a race.
            if let current = try? readFile(parent: parent, name: temporary, limit: Self.maximumStartupBytes),
               current.matchesMoved(written) { _ = unlinkat(parent, temporary, 0) }
        }
        try beforeStartupReplace?()
        try verifyDirectory(root, at: directory)
        try verifyDirectory(parent, at: parentURL)
        let current = try startupSnapshot()
        guard current.url == expected.startupURL, current.file == expected.startup else { throw Failure.manualReview }
        if let previous = expected.startup {
            guard renameatx_np(parent, temporary, parent, ".zshrc", UInt32(RENAME_SWAP)) == 0 else { throw Failure.manualReview }
            guard let displaced = try? readFile(parent: parent, name: temporary, limit: Self.maximumStartupBytes),
                  displaced.matchesMoved(previous) else {
                // An editor won the final race. Swap back only while the named
                // startup is our exact inode/bytes; retain any further changes.
                if let named = try? readFile(parent: parent, name: ".zshrc", limit: Self.maximumStartupBytes), named.matchesMoved(written) {
                    _ = renameatx_np(parent, temporary, parent, ".zshrc", UInt32(RENAME_SWAP))
                }
                throw Failure.manualReview
            }
            guard let named = try readFile(parent: parent, name: ".zshrc", limit: Self.maximumStartupBytes),
                  named.matchesMoved(written) else { throw Failure.manualReview }
            // A private backup already contains these exact displaced bytes.
            guard unlinkat(parent, temporary, 0) == 0 else { throw Failure.manualReview }
        } else {
            guard renameatx_np(parent, temporary, parent, ".zshrc", UInt32(RENAME_EXCL)) == 0 else { throw Failure.manualReview }
        }
        guard fsync(parent) == 0 else { throw Failure.manualReview }
    }

    private func removeExact(parent: Int32, name: String, expected: FileSnapshot, recovery: Int32) throws {
        guard let current = try readFile(parent: parent, name: name, limit: Self.maximumStartupBytes),
              current.matchesMoved(expected) else { throw Failure.manualReview }
        let movedName = ".removed-" + UUID().uuidString.lowercased()
        guard renameatx_np(parent, name, recovery, movedName, UInt32(RENAME_EXCL)) == 0 else { throw Failure.manualReview }
        guard let moved = try? readFile(parent: recovery, name: movedName, limit: Self.maximumStartupBytes),
              moved.matchesMoved(expected) else {
            // Exclusive restoration never overwrites a new user file.
            _ = renameatx_np(recovery, movedName, parent, name, UInt32(RENAME_EXCL))
            throw Failure.manualReview
        }
        guard unlinkat(recovery, movedName, 0) == 0, fsync(parent) == 0, fsync(recovery) == 0 else { throw Failure.manualReview }
    }

    private func acquireLock(_ parent: Int32) throws -> Int32 {
        let name = ".setup.lock"
        let flags = O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
        var descriptor = openat(parent, name, flags | O_CREAT | O_EXCL, 0o600)
        if descriptor < 0 && errno == EEXIST { descriptor = openat(parent, name, flags) }
        guard descriptor >= 0 else { throw Failure.manualReview }
        do {
            let s = try metadata(descriptor)
            guard s.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), s.st_uid == getuid(), s.st_nlink == 1,
                  s.st_mode & 0o077 == 0, s.st_size == 0, !(try hasACL(descriptor, allowingDeny: false)) else { throw Failure.manualReview }
            for _ in 0..<50 {
                if flock(descriptor, LOCK_EX | LOCK_NB) == 0 {
                    var named = stat()
                    guard fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
                          Identity(named) == Identity(s) else { throw Failure.manualReview }
                    return descriptor
                }
                guard errno == EWOULDBLOCK || errno == EINTR else { throw Failure.manualReview }
                usleep(10_000)
            }
            throw Failure.manualReview
        } catch { close(descriptor); throw error }
    }

    private func enabled() -> Inspection {
        Inspection(isEnabled: true, canEnable: false, canDisable: true,
            detail: "새 zsh 터미널에서 claude와 claude --resume이 Blabee에 자동 연결됩니다. 이미 열린 터미널과 대화는 그대로 유지됩니다.")
    }
    private func disabled() -> Inspection {
        Inspection(isEnabled: false, canEnable: true, canDisable: false,
            detail: "켜면 .zshrc에 Blabee 관리 PATH 구간을 추가합니다. Claude 실행 파일과 이미 열린 터미널은 변경하지 않습니다.")
    }
    private func rejected(_ error: Error) -> Inspection {
        let detail: String
        switch error as? Failure {
        case .executableUnavailable: detail = "설치된 Blabee와 Claude Code 실행 파일을 확인한 뒤 자동 연결을 켜 주세요."
        case .installedRuntimeUnavailable: detail = "Claude 연결을 지원하는 서명된 /Applications/Blabee.app에서 자동 연결을 켜 주세요."
        default: detail = Self.manualReviewDetail
        }
        return Inspection(isEnabled: false, canEnable: false, canDisable: false, detail: detail)
    }

    private static func safeAbsolutePath(_ path: String) -> Bool {
        path.hasPrefix("/") && !path.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
            && !path.contains("//") && (path == "/" || !path.hasSuffix("/"))
            && !path.split(separator: "/").contains { $0 == "." || $0 == ".." }
    }
    private static func decode(_ line: String, prefix: String) -> String? {
        guard line.hasPrefix(prefix), let bytes = Data(base64Encoded: String(line.dropFirst(prefix.count))),
              let value = String(data: bytes, encoding: .utf8), safeAbsolutePath(value),
              bytes.base64EncodedString() == line.dropFirst(prefix.count) else { return nil }
        return value
    }
    private static func quote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    static func managedBlock(binPath: String) -> String {
        let bin = quote(binPath), shim = quote(binPath + "/claude")
        return "\n" + opening + "\n"
            + "if (( ${+aliases[claude]} || ${+functions[claude]} )); then\n"
            + "  builtin print -ru2 -- '[Blabee] claude alias/function exists; automatic connection was skipped.'\n"
            + "elif [[ -x " + shim + " ]]; then\n"
            + "  () {\n    builtin emulate -L zsh\n"
            + "    local _blabee_claude_entry\n    local -a _blabee_claude_remaining=()\n"
            + "    for _blabee_claude_entry in \"${path[@]}\"; do\n"
            + "      [[ \"$_blabee_claude_entry\" == " + bin + " ]] || _blabee_claude_remaining+=(\"$_blabee_claude_entry\")\n"
            + "    done\n    path=(" + bin + " \"${_blabee_claude_remaining[@]}\")\n"
            + "    export PATH\n  }\nfi\n" + closing + "\n"
    }

    static func shimBytes(coordinator: String, claude: String, startup: String, originallyMissing: Bool) -> Data {
        let lines = [
            "#!/bin/sh\n# Blabee Claude Auto Connect v1\n# Generated by Blabee. Do not edit.\n",
            "# coordinator-base64: \(Data(coordinator.utf8).base64EncodedString())\n",
            "# claude-base64: \(Data(claude.utf8).base64EncodedString())\n",
            "# startup-base64: \(Data(startup.utf8).base64EncodedString())\n",
            "# startup-origin: \(originallyMissing ? "missing" : "present")\n\n",
            "if [ ! -x \(quote(claude)) ]; then\n",
            "  printf '%s\\n' '[Blabee] Claude Code executable is unavailable.' >&2\n  exit 127\nfi\n",
            "if [ -x \(quote(coordinator)) ]; then\n",
            "  exec \(quote(coordinator)) claude-auto-launch --claude-bin \(quote(claude)) -- \"$@\"\nfi\n",
            "exec \(quote(claude)) \"$@\"\n",
        ]
        return Data(lines.joined().utf8)
    }
}
