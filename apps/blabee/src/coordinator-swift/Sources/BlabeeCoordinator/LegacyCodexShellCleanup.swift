import Darwin
import Foundation

enum LegacyCodexShellCleanupStatus: Sendable, Equatable {
    case notFound, available, manualReview, cleaned, recoveryRequired, unavailable
}

struct LegacyCodexShellCleanupInspection: Sendable, Equatable {
    let status: LegacyCodexShellCleanupStatus
    let detail: String
    var wrapperPath: String? = nil
    var startupPath: String? = nil
    var backupPath: String? = nil

    var canPrepare: Bool { status == .available }
    var title: String {
        switch status {
        case .notFound: "구형 셸 연결 없음"
        case .available: "구형 셸 연결 발견"
        case .manualReview: "구형 셸 연결 수동 확인 필요"
        case .cleaned: "구형 셸 연결 비활성화 완료"
        case .recoveryRequired: "백업과 현재 설정 확인 필요"
        case .unavailable: "구형 셸 연결 검사 불가"
        }
    }
}

struct LegacyCodexShellCleanupConfirmation: Sendable, Equatable {
    let id: UUID
    let wrapperPath: String
    let startupPath: String
    let detail: String
}

protocol LegacyCodexShellCleanupManaging: Sendable {
    func inspect() async -> LegacyCodexShellCleanupInspection
    func prepare() async -> LegacyCodexShellCleanupConfirmation?
    func cleanup(confirmation: LegacyCodexShellCleanupConfirmation) async -> LegacyCodexShellCleanupInspection
}

struct LegacyUnavailableCodexShellCleanupManager: LegacyCodexShellCleanupManaging {
    func inspect() async -> LegacyCodexShellCleanupInspection {
        LegacyCodexShellCleanupInspection(status: .unavailable, detail: "구형 셸 연결 검사가 구성되지 않았습니다.")
    }
    func prepare() async -> LegacyCodexShellCleanupConfirmation? { nil }
    func cleanup(confirmation _: LegacyCodexShellCleanupConfirmation) async -> LegacyCodexShellCleanupInspection {
        await inspect()
    }
}

/// Retires only an exact historical v4 wrapper. Never writes .zshrc, runs a shell,
/// changes a Codex executable, or attempts to modify an existing terminal's functions.
actor LegacyCodexShellCleanupManager: LegacyCodexShellCleanupManaging {
    private let home: URL
    private let environment: [String: String]
    private let beforeMove: (@Sendable () throws -> Void)?
    private let afterMove: (@Sendable () throws -> Void)?
    private let lockAttempts: Int
    private var pending: (LegacyCodexShellCleanupConfirmation, Snapshot)?
    private static let wrapperName = "codex-auto-connect.zsh"
    private static let lockName = ".legacy-shell-cleanup.lock"
    private static let opening = "# >>> Blabee Codex Auto Connect v1 >>>"
    private static let closing = "# <<< Blabee Codex Auto Connect v1 <<<"

    init(
        homeURL: URL,
        environment: [String: String] = [:],
        beforeMove: (@Sendable () throws -> Void)? = nil,
        afterMove: (@Sendable () throws -> Void)? = nil,
        lockAttempts: Int = 50
    ) {
        // Foundation standardization can rewrite /private/var to the /var
        // symlink. Preserve the lexical path and verify every component below.
        home = homeURL
        self.environment = environment
        self.beforeMove = beforeMove
        self.afterMove = afterMove
        self.lockAttempts = max(1, min(lockAttempts, 50))
    }

    static func live(environment: [String: String] = ProcessInfo.processInfo.environment) -> LegacyCodexShellCleanupManager {
        LegacyCodexShellCleanupManager(
            homeURL: FileManager.default.homeDirectoryForCurrentUser,
            environment: environment
        )
    }

    private var directory: URL { home.appendingPathComponent("Library/Application Support/Blabee/shell/v1") }
    private var wrapper: URL { directory.appendingPathComponent(Self.wrapperName) }

    func inspect() async -> LegacyCodexShellCleanupInspection {
        do {
            guard let snapshot = try inspectSnapshot() else { return absent() }
            return result(.available, "확인된 v4 래퍼만 백업 이름으로 이동합니다. .zshrc와 Codex는 변경하지 않습니다.", snapshot: snapshot)
        } catch { return rejected(error) }
    }

    func prepare() async -> LegacyCodexShellCleanupConfirmation? {
        pending = nil
        guard let snapshot = try? inspectSnapshot() else { return nil }
        let confirmation = LegacyCodexShellCleanupConfirmation(
            id: UUID(), wrapperPath: wrapper.path, startupPath: snapshot.startupPath,
            detail: "이 래퍼를 고유한 백업 이름으로 이동합니다. .zshrc의 조건부 source 구간은 그대로 남지만 더 이상 실행되지 않습니다. 열린 터미널은 바뀌지 않으므로 새 터미널에서 확인하세요."
        )
        pending = (confirmation, snapshot)
        return confirmation
    }

    func cleanup(confirmation: LegacyCodexShellCleanupConfirmation) async -> LegacyCodexShellCleanupInspection {
        guard let prepared = pending, prepared.0 == confirmation else {
            return rejected(Failure("확인 요청이 만료되었습니다. 다시 검사하고 확인해 주세요."))
        }
        pending = nil // Single use, including failures; no implicit replay.
        do {
            let parent = try openDirectory(directory)
            defer { close(parent) }
            try verifyPrivateDirectory(parent)
            let lock = try acquireLock(parent)
            defer { flock(lock, LOCK_UN); close(lock) }
            // Even the absent/no-op judgment is made under the common file lock.
            guard let current = try inspectSnapshot() else { return absent() }
            guard current == prepared.1 else { throw Failure("확인 후 설정이 변경되었습니다. 다시 검사해 주세요.") }
            try verifyDirectory(parent)
            try beforeMove?()
            let backupName = Self.wrapperName + ".blabee-backup-" + UUID().uuidString.lowercased()
            guard renameatx_np(parent, Self.wrapperName, parent, backupName, UInt32(RENAME_EXCL)) == 0 else {
                throw Failure("래퍼를 안전하게 백업하지 못했습니다. 기존 파일은 덮어쓰지 않았습니다.")
            }
            let backupPath = directory.appendingPathComponent(backupName).path
            do {
                try afterMove?()
                try verifyDirectory(parent)
                guard let moved = try readFile(parent: parent, name: backupName, limit: 64 * 1_024),
                      moved.matchesMoved(current.wrapper),
                      try inspectStartup() == current.startup,
                      try readFile(parent: parent, name: Self.wrapperName, limit: 64 * 1_024) == nil
                else { throw Failure("백업 중 파일이나 시작 설정이 변경되었습니다.") }
                guard fsync(parent) == 0 else { throw Failure("백업 디렉터리 동기화를 확인하지 못했습니다.") }
                return result(.cleaned, confirmation.detail, snapshot: current, backup: backupPath)
            } catch {
                // A rotated directory must not be reported as restored at the old path.
                guard (try? verifyDirectory(parent)) != nil else {
                    return result(.recoveryRequired, "정리 중 디렉터리가 교체되었습니다. 열린 디렉터리 안의 백업을 보존했으며 자동 복원하지 않습니다.", snapshot: current, backup: actualDirectoryPath(parent).map { $0 + "/" + backupName } ?? backupPath)
                }
                // Never replace an editor's new file. A recovery move is exclusive too.
                if renameatx_np(parent, backupName, parent, Self.wrapperName, UInt32(RENAME_EXCL)) == 0 {
                    _ = fsync(parent)
                    return result(.manualReview, "정리 중 변경을 감지해 이동한 파일을 원래 이름으로 되돌렸습니다. 설정은 다시 확인해야 합니다.", snapshot: current)
                }
                return result(.recoveryRequired, "정리 중 변경을 감지했습니다. 현재 파일을 덮어쓰지 않고 백업을 보존했습니다. 두 경로를 직접 확인해 주세요.", snapshot: current, backup: backupPath)
            }
        } catch { return rejected(error) }
    }

    private struct Failure: Error { let message: String; init(_ message: String) { self.message = message } }
    private struct Identity: Sendable, Equatable {
        let device: dev_t, inode: ino_t, mode: mode_t, owner: uid_t, links: nlink_t
        let group: gid_t, flags: UInt32
        init(_ s: stat) {
            device = s.st_dev; inode = s.st_ino; mode = s.st_mode; owner = s.st_uid
            // APFS directory link counts change when our lock/backup is added.
            // File hard-link counts remain part of the strict identity.
            links = s.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR) ? 0 : s.st_nlink
            group = s.st_gid; flags = s.st_flags
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
        func matchesMoved(_ other: FileSnapshot) -> Bool {
            identity == other.identity && bytes == other.bytes && modifiedSeconds == other.modifiedSeconds && modifiedNanos == other.modifiedNanos
        }
    }
    private struct Startup: Sendable, Equatable {
        let path: String
        let files: [String: FileSnapshot]
    }
    private struct Snapshot: Sendable, Equatable {
        let parent: Identity
        let wrapper: FileSnapshot
        let startup: Startup
        var startupPath: String { startup.path }
    }

    private func inspectSnapshot() throws -> Snapshot? {
        let parent: Int32
        do { parent = try openDirectory(directory, allowMissing: true) }
        catch { throw error }
        if parent < 0 { return nil }
        defer { close(parent) }
        try verifyPrivateDirectory(parent)
        guard let file = try readFile(parent: parent, name: Self.wrapperName, limit: 64 * 1_024) else { return nil }
        let startup = try inspectStartup()
        guard let source = String(data: file.bytes, encoding: .utf8),
              source.hasPrefix("# Blabee Codex Auto Connect v4\n") else {
            throw Failure("자동 정리는 변경되지 않은 구형 v4 래퍼만 지원합니다. 이전 버전이나 수정된 파일은 수동 확인이 필요합니다.")
        }
        let lines = source.components(separatedBy: "\n")
        guard lines.count > 6,
              ["# zshrc-origin: missing", "# zshrc-origin: present"].contains(lines[2]),
              let coordinator = decoded(lines[3], prefix: "# coordinator-path-base64: "),
              let official = decoded(lines[4], prefix: "# official-codex-path-base64: "),
              let startupMetadata = decoded(lines[5], prefix: "# zshrc-path-base64: "),
              coordinator == directory.appendingPathComponent("codex-stable-launcher").path,
              startupMetadata == startup.path,
              file.bytes == Self.generatedV4(
                official: official, coordinator: coordinator, startup: startup.path,
                originallyMissing: lines[2] == "# zshrc-origin: missing"
              )
        else { throw Failure("래퍼 본문과 생성 메타데이터가 일치하지 않습니다. 수동 수정본은 자동 정리하지 않습니다.") }
        let block = Self.managedBlock(wrapperPath: wrapper.path)
        guard let zshrc = startup.files[startup.path], let text = String(data: zshrc.bytes, encoding: .utf8),
              let range = text.range(of: block),
              range.lowerBound == text.startIndex || text[text.index(before: range.lowerBound)] == "\n"
        else { throw Failure("실제 .zshrc에서 정확한 조건부 Blabee 연결 구간을 확인하지 못했습니다.") }
        let remainder = String(text[..<range.lowerBound]) + String(text[range.upperBound...])
        guard !Self.hasLegacyReference(remainder), !remainder.contains("ZDOTDIR") else {
            throw Failure("관리 구간 밖에 추가 Blabee 연결 또는 ZDOTDIR 설정이 있습니다. 자동 정리를 중단합니다.")
        }
        return Snapshot(parent: try identity(parent), wrapper: file, startup: startup)
    }

    private func inspectStartup() throws -> Startup {
        let dotDirectory: URL
        if let value = environment["ZDOTDIR"] {
            guard Self.isSafeAbsolutePath(value), value == home.path || value.hasPrefix(home.path + "/") else {
                throw Failure("ZDOTDIR가 홈 내부의 명확한 절대 경로가 아닙니다. 수동 확인이 필요합니다.")
            }
            dotDirectory = URL(fileURLWithPath: value, isDirectory: true)
        } else { dotDirectory = home }
        var files: [String: FileSnapshot] = [:]
        for base in Set([home.path, dotDirectory.path]).sorted() {
            let directoryURL = URL(fileURLWithPath: base, isDirectory: true)
            let parent = try openDirectory(directoryURL)
            defer { close(parent) }
            for name in [".zshenv", ".zprofile", ".zlogin", ".zshrc"] {
                let path = directoryURL.appendingPathComponent(name).path
                if let file = try readFile(parent: parent, name: name, limit: 256 * 1_024) {
                    files[path] = file
                    if path != dotDirectory.appendingPathComponent(".zshrc").path {
                        guard let source = String(data: file.bytes, encoding: .utf8),
                              !source.contains("ZDOTDIR"), !Self.hasLegacyReference(source) else {
                            throw Failure("시작 파일에 추가 연결 또는 동적인 ZDOTDIR 설정이 있습니다. 셸을 실행하지 않고는 확정할 수 없어 자동 정리하지 않습니다.")
                        }
                    }
                }
            }
        }
        return Startup(path: dotDirectory.appendingPathComponent(".zshrc").path, files: files)
    }

    private static func hasLegacyReference(_ text: String) -> Bool {
        [wrapperName, "_blabee_codex_auto_connect", "BLABEE_CODEX_AUTO_CONNECT", opening, closing].contains { text.contains($0) }
    }
    private func decoded(_ line: String, prefix: String) -> String? {
        guard line.hasPrefix(prefix), let data = Data(base64Encoded: String(line.dropFirst(prefix.count))),
              let value = String(data: data, encoding: .utf8), Self.isSafeAbsolutePath(value),
              data.base64EncodedString() == line.dropFirst(prefix.count) else { return nil }
        return value
    }
    private static func isSafeAbsolutePath(_ value: String) -> Bool {
        value.hasPrefix("/") && !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
            && !value.contains("//") && (value == "/" || !value.hasSuffix("/"))
            && !value.split(separator: "/").contains { $0 == "." || $0 == ".." }
    }

    /// Traverse with directory descriptors: no symlink component can be followed.
    private func openDirectory(_ url: URL, allowMissing: Bool = false) throws -> Int32 {
        guard Self.isSafeAbsolutePath(home.path), home.path != "/", Self.isSafeAbsolutePath(url.path),
              url.path == home.path || url.path.hasPrefix(home.path + "/") else { throw Failure("안전한 홈 경로를 확인하지 못했습니다.") }
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else { throw Failure("디렉터리를 열 수 없습니다.") }
        var path = ""
        do {
            for component in url.path.split(separator: "/") {
                path += "/" + component
                let next = openat(descriptor, String(component), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0 {
                    if allowMissing && errno == ENOENT { close(descriptor); return -1 }
                    throw Failure("경로에 심볼릭 링크가 있거나 디렉터리를 읽을 수 없습니다: \(path) (errno \(errno))")
                }
                close(descriptor); descriptor = next
                let s = try metadata(descriptor)
                let inside = path == home.path || path.hasPrefix(home.path + "/")
                let safeTemporaryAncestor = !inside && s.st_uid == 0 && s.st_mode & mode_t(S_ISVTX) != 0
                guard s.st_uid == getuid() || (!inside && s.st_uid == 0),
                      s.st_mode & 0o022 == 0 || safeTemporaryAncestor,
                      !(try hasACLGrant(descriptor)) else { throw Failure("경로 소유권·쓰기 권한·ACL이 안전하지 않습니다.") }
            }
            return descriptor
        } catch { close(descriptor); throw error }
    }

    private func metadata(_ descriptor: Int32) throws -> stat {
        var s = stat()
        guard fstat(descriptor, &s) == 0 else { throw Failure("파일 상태를 확인할 수 없습니다.") }
        return s
    }
    private func identity(_ descriptor: Int32) throws -> Identity { Identity(try metadata(descriptor)) }
    private func hasACLGrant(_ descriptor: Int32) throws -> Bool {
        errno = 0
        guard let acl = acl_get_fd_np(descriptor, ACL_TYPE_EXTENDED) else {
            if errno == ENOENT { return false }
            throw Failure("ACL을 확인할 수 없습니다.")
        }
        defer { acl_free(UnsafeMutableRawPointer(acl)) }
        var entry: acl_entry_t?
        var flag: Int32 = 0
        while true {
            let next = acl_get_entry(acl, flag, &entry)
            if next == -1 && errno == EINVAL { return false }
            guard next == 0, let entry else { throw Failure("ACL 항목을 확인할 수 없습니다.") }
            var tag = acl_tag_t(0)
            guard acl_get_tag_type(entry, &tag) == 0 else { throw Failure("ACL 종류를 확인할 수 없습니다.") }
            if tag == ACL_EXTENDED_ALLOW { return true }
            guard tag == ACL_EXTENDED_DENY else { throw Failure("ACL 종류를 확인할 수 없습니다.") }
            flag = -1
        }
    }
    private func readFile(parent: Int32, name: String, limit: Int) throws -> FileSnapshot? {
        let descriptor = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else {
            if errno == ENOENT { return nil }
            throw Failure("파일을 안전하게 읽을 수 없습니다.")
        }
        defer { close(descriptor) }
        let before = try metadata(descriptor)
        guard before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), before.st_uid == getuid(), before.st_nlink == 1,
              before.st_mode & 0o022 == 0, before.st_size >= 0, before.st_size <= limit,
              !(try hasACLGrant(descriptor)) else { throw Failure("파일 형식·소유권·권한·크기 또는 하드 링크가 안전하지 않습니다.") }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = read(descriptor, &buffer, buffer.count)
            if count == -1 && errno == EINTR { continue }
            guard count >= 0 else { throw Failure("파일 읽기에 실패했습니다.") }
            if count == 0 { break }
            data.append(contentsOf: buffer.prefix(count))
            guard data.count <= limit else { throw Failure("파일 크기 제한을 초과했습니다.") }
        }
        let after = try metadata(descriptor)
        var named = stat()
        guard fstatat(parent, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              FileSnapshot(before, data) == FileSnapshot(after, data),
              FileSnapshot(after, data) == FileSnapshot(named, data), data.count == before.st_size else {
            throw Failure("읽는 동안 파일이 변경되었습니다.")
        }
        return FileSnapshot(after, data)
    }
    private func verifyDirectory(_ expected: Int32) throws {
        let actual = try openDirectory(directory)
        defer { close(actual) }
        guard try identity(actual) == identity(expected) else { throw Failure("디렉터리가 교체되었습니다.") }
    }
    private func verifyPrivateDirectory(_ descriptor: Int32) throws {
        let state = try metadata(descriptor)
        guard state.st_uid == getuid(), state.st_mode & 0o077 == 0 else {
            throw Failure("백업을 보관할 구형 shell/v1 디렉터리가 사용자 전용(0700)이 아닙니다. 자동 정리하지 않습니다.")
        }
    }
    private func actualDirectoryPath(_ descriptor: Int32) -> String? {
        var bytes = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        guard fcntl(descriptor, F_GETPATH, &bytes) == 0 else { return nil }
        return bytes.withUnsafeBufferPointer { pointer in String(cString: pointer.baseAddress!) }
    }
    private func acquireLock(_ parent: Int32) throws -> Int32 {
        let flags = O_RDWR | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
        // Distinguish creation from opening an existing lock. Concurrent plain
        // O_CREAT opens on APFS can fail with ENOENT while the other creator
        // succeeds. Exclusive creation gives the loser an explicit existing-file
        // path, which must still pass all ownership, ACL and inode checks below.
        var descriptor = openat(parent, Self.lockName, flags | O_CREAT | O_EXCL, 0o600)
        let creationError = errno
        if descriptor < 0, creationError == EEXIST {
            descriptor = openat(parent, Self.lockName, flags)
        }
        let openError = errno
        guard descriptor >= 0 else { throw Failure("정리 잠금 파일을 열 수 없습니다. (errno \(openError))") }
        do {
            let s = try metadata(descriptor)
            guard s.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG), s.st_uid == getuid(), s.st_nlink == 1,
                  s.st_mode & 0o077 == 0, s.st_size == 0, !(try hasACLGrant(descriptor)) else { throw Failure("정리 잠금 파일이 안전하지 않습니다.") }
            for _ in 0..<lockAttempts {
                if flock(descriptor, LOCK_EX | LOCK_NB) == 0 {
                    var named = stat()
                    guard fstatat(parent, Self.lockName, &named, AT_SYMLINK_NOFOLLOW) == 0,
                          Identity(named) == Identity(s) else { throw Failure("정리 잠금 파일이 교체되었습니다.") }
                    return descriptor
                }
                guard errno == EWOULDBLOCK || errno == EINTR else { throw Failure("정리 잠금을 얻지 못했습니다.") }
                usleep(10_000)
            }
            throw Failure("다른 정리가 진행 중입니다. 잠시 후 다시 검사해 주세요.")
        } catch { close(descriptor); throw error }
    }
    private func absent() -> LegacyCodexShellCleanupInspection {
        LegacyCodexShellCleanupInspection(status: .notFound, detail: "검사 대상 경로에 구형 래퍼가 없습니다. 이미 열린 터미널에 남은 함수까지 확인한 결과는 아닙니다.", wrapperPath: wrapper.path)
    }
    private func rejected(_ error: Error) -> LegacyCodexShellCleanupInspection {
        LegacyCodexShellCleanupInspection(status: .manualReview, detail: (error as? Failure)?.message ?? "안전 검증에 실패했습니다. 파일을 변경하지 않고 수동 확인을 요청합니다.", wrapperPath: wrapper.path)
    }
    private func result(_ status: LegacyCodexShellCleanupStatus, _ detail: String, snapshot: Snapshot, backup: String? = nil) -> LegacyCodexShellCleanupInspection {
        LegacyCodexShellCleanupInspection(status: status, detail: detail, wrapperPath: wrapper.path, startupPath: snapshot.startupPath, backupPath: backup)
    }

    private static func quote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }
    static func managedBlock(wrapperPath: String) -> String {
        opening + "\nif [[ -r " + quote(wrapperPath) + " ]]; then\n  source " + quote(wrapperPath) + "\nfi\n" + closing + "\n"
    }

    // Exact bytes from the retired generator. Matching metadata alone is not ownership proof.
    static func generatedV4(official: String, coordinator: String, startup: String, originallyMissing: Bool) -> Data {
        Data((
            "# Blabee Codex Auto Connect v4\n# Generated by Blabee. Do not edit.\n"
                + "# zshrc-origin: \(originallyMissing ? "missing" : "present")\n"
                + "# coordinator-path-base64: \(Data(coordinator.utf8).base64EncodedString())\n"
                + "# official-codex-path-base64: \(Data(official.utf8).base64EncodedString())\n"
                + "# zshrc-path-base64: \(Data(startup.utf8).base64EncodedString())\n\n"
                + "if (( $+aliases[codex] )); then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=alias\n"
                + "elif (( $+functions[codex] )) && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v1 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v2 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v3 \"$@\"' ]] && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v4 \"$@\"' ]]; then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=function\nelse\n"
                + "  unset BLABEE_CODEX_AUTO_CONNECT_CONFLICT\n"
                + "  function _blabee_codex_auto_connect_v4 {\n"
                + "    local _blabee_official=\(quote(official))\n    (\n"
                + "      unset BLABEE_COORDINATOR_BINARY BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN BLABEE_RUNTIME_IDENTITY\n"
                + "      if [[ -x \"$_blabee_official\" ]]; then\n"
                + "        exec \"$_blabee_official\" \"$@\"\n      fi\n"
                + "      print -u2 -- \"공식 Codex 실행 파일을 찾을 수 없습니다. Codex 설치를 확인해 주세요.\"\n"
                + "      exit 127\n    )\n  }\n"
                + "  function codex { _blabee_codex_auto_connect_v4 \"$@\" }\nfi\n"
        ).utf8)
    }
}
