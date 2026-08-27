import Darwin
import Foundation

enum CodexAutoConnectState: Sendable, Equatable {
    case disabled
    case enabled
    case repairRequired(String)
    case conflict(String)
    case unavailable(String)
}

enum CodexAutoConnectError: LocalizedError, Equatable {
    case conflict(String)
    case unavailable(String)
    case unsafeFilesystem(String)
    case writeFailed(String)

    var errorDescription: String? {
        switch self {
        case let .conflict(message), let .unavailable(message),
             let .unsafeFilesystem(message), let .writeFailed(message):
            message
        }
    }
}

/// Installs a small, opt-in zsh integration without replacing the user's Codex binary.
///
/// File inspection is deliberately side-effect free. Mutations happen only from
/// `enable()` and `disable()`, under both a process mutex and an on-disk lock.
struct CodexAutoConnectManager: Sendable {
    private static let processMutex = NSLock()
    private static let openingMarker = "# >>> Blabee Codex Auto Connect v1 >>>"
    private static let closingMarker = "# <<< Blabee Codex Auto Connect v1 <<<"
    private static let generatedHeader = "# Blabee Codex Auto Connect v1\n"
    private static let maximumZshRCBytes = 256 * 1_024
    private static let maximumManagedFileBytes = 64 * 1_024

    private let homeURL: URL
    private let applicationSupportURL: URL
    private let coordinatorURL: URL
    private let discoveredOfficialCodexURL: URL?
    private let beforeDestinationReplace: (@Sendable (URL) throws -> Void)?
    private let lockAttemptLimit: Int
    private let lockRetryMicroseconds: useconds_t

    init(
        homeURL: URL,
        applicationSupportURL: URL,
        coordinatorURL: URL,
        officialCodexURL: URL?,
        beforeDestinationReplace: (@Sendable (URL) throws -> Void)? = nil,
        lockAttemptLimit: Int = 200,
        lockRetryMicroseconds: useconds_t = 10_000
    ) {
        self.homeURL = homeURL.standardizedFileURL
        self.applicationSupportURL = applicationSupportURL.standardizedFileURL
        self.coordinatorURL = coordinatorURL.standardizedFileURL
        self.discoveredOfficialCodexURL = officialCodexURL?.standardizedFileURL
        self.beforeDestinationReplace = beforeDestinationReplace
        self.lockAttemptLimit = max(1, lockAttemptLimit)
        self.lockRetryMicroseconds = lockRetryMicroseconds
    }

    var canEnable: Bool {
        guard let officialCodexURL = discoveredOfficialCodexURL else { return false }
        return (try? validateExecutables(officialCodexURL: officialCodexURL)) != nil
    }

    static func live(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> CodexAutoConnectManager {
        guard let rawHome = environment["HOME"], rawHome.hasPrefix("/"),
              let executableURL = bundle.executableURL
        else {
            throw CodexAutoConnectError.unavailable(
                "Codex 자동 연결에 필요한 HOME 또는 Blabee 실행 파일을 찾을 수 없습니다."
            )
        }
        return try live(
            homeURL: URL(fileURLWithPath: rawHome, isDirectory: true),
            coordinatorURL: executableURL,
            environment: environment
        )
    }

    static func live(
        homeURL: URL,
        coordinatorURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> CodexAutoConnectManager {
        let home = homeURL.standardizedFileURL
        let applicationSupport = home
            .appendingPathComponent("Library/Application Support/Blabee", isDirectory: true)
        let integration = applicationSupport
            .appendingPathComponent("shell/v1/codex-auto-connect.zsh", isDirectory: false)
        let official = try? discoverOfficialCodex(
            environment: environment,
            coordinatorURL: coordinatorURL.standardizedFileURL,
            integrationURL: integration
        )
        return CodexAutoConnectManager(
            homeURL: home,
            applicationSupportURL: applicationSupport,
            coordinatorURL: coordinatorURL,
            officialCodexURL: official
        )
    }

    func state() -> CodexAutoConnectState {
        do {
            let zshRC = try secureFile(at: zshRCURL, maximumBytes: Self.maximumZshRCBytes)
            let managed = try secureFile(
                at: managedFileURL,
                maximumBytes: Self.maximumManagedFileBytes
            )
            let layout = try zshRCLayout(zshRC?.data)

            switch layout {
            case .disabled:
                guard let managed else {
                    return canEnable
                        ? .disabled
                        : .unavailable("공식 Codex 실행 파일을 찾지 못했습니다.")
                }
                guard isOwnedManagedFile(managed.data) else {
                    return .conflict("Blabee 관리 파일 경로에 다른 파일이 있습니다.")
                }
                guard managedConfiguration(managed.data) != nil else {
                    return .conflict("Blabee 관리 파일 형식이 손상되었습니다.")
                }
                return .repairRequired("완료되지 않은 자동 연결 설정이 남아 있습니다.")
            case .owned(_, _, let exactMarker):
                guard let managed else {
                    return .repairRequired("Blabee 관리 파일이 없습니다.")
                }
                guard isOwnedManagedFile(managed.data) else {
                    return .conflict("Blabee 관리 파일이 다른 프로그램의 파일과 충돌합니다.")
                }
                guard let configuration = managedConfiguration(managed.data) else {
                    return .conflict("Blabee 관리 파일 형식이 손상되었습니다.")
                }
                let installedOfficial = URL(
                    fileURLWithPath: configuration.officialCodexPath,
                    isDirectory: false
                )
                guard managed.data == generatedManagedFile(
                    zshRCWasMissing: configuration.zshRCWasMissing,
                    officialCodexURL: installedOfficial
                ) else {
                    return .repairRequired("Blabee 관리 파일이 현재 설치 정보와 다릅니다.")
                }
                guard exactMarker else {
                    return .repairRequired(".zshrc의 Blabee 연결 경로가 오래되었습니다.")
                }
                do { try validateExecutables(officialCodexURL: installedOfficial) }
                catch { return .repairRequired(error.localizedDescription) }
                return .enabled
            }
        } catch let error as CodexAutoConnectError {
            switch error {
            case let .conflict(message): return .conflict(message)
            case let .unavailable(message): return .unavailable(message)
            case let .unsafeFilesystem(message), let .writeFailed(message):
                return .conflict(message)
            }
        } catch {
            return .unavailable(error.localizedDescription)
        }
    }

    func enable() throws {
        guard let officialCodexURL = discoveredOfficialCodexURL else {
            throw CodexAutoConnectError.unavailable(
                "공식 Codex 실행 파일을 찾지 못해 자동 연결을 활성화하거나 복구할 수 없습니다."
            )
        }
        try withExclusiveLock(createDirectories: true) {
            try validateExecutables(officialCodexURL: officialCodexURL)
            let zshRC = try secureFile(at: zshRCURL, maximumBytes: Self.maximumZshRCBytes)
            let managed = try secureFile(
                at: managedFileURL,
                maximumBytes: Self.maximumManagedFileBytes
            )
            let layout = try zshRCLayout(zshRC?.data)
            let prefix: Data
            let suffix: Data
            switch layout {
            case .disabled(let data):
                prefix = data
                suffix = Data()
            case .owned(let ownedPrefix, let ownedSuffix, _):
                prefix = ownedPrefix
                suffix = ownedSuffix
            }

            if let managed, !isOwnedManagedFile(managed.data) {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 경로에 다른 파일이 있어 덮어쓰지 않았습니다."
                )
            }
            if let managed, managedConfiguration(managed.data) == nil {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 형식이 손상되어 자동 복구하지 않았습니다."
                )
            }
            let origin = managed.flatMap { managedConfiguration($0.data)?.zshRCWasMissing }
                ?? (zshRC == nil)
            let desiredManaged = generatedManagedFile(
                zshRCWasMissing: origin,
                officialCodexURL: officialCodexURL
            )
            let desiredZshRC = enabledZshRC(prefix: prefix, suffix: suffix)

            // Managed code must be durable before .zshrc begins sourcing it.
            if managed?.data != desiredManaged {
                try atomicWrite(
                    desiredManaged,
                    to: managedFileURL,
                    expected: managed,
                    defaultMode: 0o600
                )
            }
            if zshRC?.data != desiredZshRC {
                try atomicWrite(
                    desiredZshRC,
                    to: zshRCURL,
                    expected: zshRC,
                    defaultMode: 0o600
                )
            }
        }
    }

    func disable() throws {
        let initialZshRC = try secureFile(at: zshRCURL, maximumBytes: Self.maximumZshRCBytes)
        let initialManaged = try secureFile(
            at: managedFileURL,
            maximumBytes: Self.maximumManagedFileBytes
        )
        if initialZshRC == nil, initialManaged == nil { return }
        let initialLayout = try zshRCLayout(initialZshRC?.data)
        let markerExists: Bool
        switch initialLayout {
        case .disabled: markerExists = false
        case .owned: markerExists = true
        }
        // A plain user .zshrc with no owned block is a true no-op. Every path
        // that can mutate either owned file creates/acquires the same secure
        // cross-process lock before re-reading current state.
        guard initialManaged != nil || markerExists else { return }

        try withExclusiveLock(createDirectories: true) {
            let zshRC = try secureFile(at: zshRCURL, maximumBytes: Self.maximumZshRCBytes)
            let managed = try secureFile(
                at: managedFileURL,
                maximumBytes: Self.maximumManagedFileBytes
            )
            let layout = try zshRCLayout(zshRC?.data)
            if let managed, !isOwnedManagedFile(managed.data) {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 경로에 다른 파일이 있어 삭제하지 않았습니다."
                )
            }
            if let managed, managedConfiguration(managed.data) == nil {
                throw CodexAutoConnectError.conflict(
                    "Blabee 관리 파일 형식이 손상되어 자동 삭제하지 않았습니다."
                )
            }
            let originWasMissing = managed
                .flatMap { managedConfiguration($0.data)?.zshRCWasMissing } ?? false

            // Stop sourcing managed code before removing the managed file.
            if case let .owned(prefix, suffix, _) = layout, let zshRC {
                let restored = restoredZshRC(prefix: prefix, suffix: suffix)
                if originWasMissing, restored.isEmpty {
                    try secureUnlink(zshRCURL, expected: zshRC)
                } else {
                    try atomicWrite(
                        restored,
                        to: zshRCURL,
                        expected: zshRC,
                        defaultMode: 0o600
                    )
                }
            }
            if let managed {
                try secureUnlink(managedFileURL, expected: managed)
            }
        }
    }

    private var zshRCURL: URL {
        homeURL.appendingPathComponent(".zshrc", isDirectory: false)
    }

    private var shellDirectoryURL: URL {
        applicationSupportURL.appendingPathComponent("shell/v1", isDirectory: true)
    }

    private var managedFileURL: URL {
        shellDirectoryURL.appendingPathComponent("codex-auto-connect.zsh", isDirectory: false)
    }

    private var lockFileURL: URL {
        shellDirectoryURL.appendingPathComponent(".codex-auto-connect.lock", isDirectory: false)
    }

    private func markerBlock() -> Data {
        let managed = Self.shellQuote(managedFileURL.path)
        return Data((
            Self.openingMarker + "\n"
                + "if [[ -r " + managed + " ]]; then\n"
                + "  source " + managed + "\n"
                + "fi\n"
                + Self.closingMarker + "\n"
        ).utf8)
    }

    private func enabledZshRC(prefix: Data, suffix: Data) -> Data {
        var result = prefix
        if !result.isEmpty { result.append(0x0A) }
        result.append(markerBlock())
        result.append(suffix)
        return result
    }

    private func restoredZshRC(prefix: Data, suffix: Data) -> Data {
        var result = prefix
        // The managed block carried the line boundary while installed. Keep
        // one boundary when later user bytes would otherwise join an existing
        // unterminated line during disable.
        if !prefix.isEmpty, !suffix.isEmpty, prefix.last != 0x0A {
            result.append(0x0A)
        }
        result.append(suffix)
        return result
    }

    private func generatedManagedFile(
        zshRCWasMissing: Bool,
        officialCodexURL: URL
    ) -> Data {
        let coordinator = Self.shellQuote(coordinatorURL.path)
        let official = Self.shellQuote(officialCodexURL.path)
        let coordinatorMetadata = Data(coordinatorURL.path.utf8).base64EncodedString()
        let officialMetadata = Data(officialCodexURL.path.utf8).base64EncodedString()
        return Data((
            Self.generatedHeader
                + "# Generated by Blabee. Do not edit.\n"
                + "# zshrc-origin: \(zshRCWasMissing ? "missing" : "present")\n"
                + "# coordinator-path-base64: \(coordinatorMetadata)\n"
                + "# official-codex-path-base64: \(officialMetadata)\n"
                + "\n"
                + "if (( $+aliases[codex] )); then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=alias\n"
                + "elif (( $+functions[codex] )) && [[ ${functions[codex]} != '_blabee_codex_auto_connect_v1 \"$@\"' ]]; then\n"
                + "  typeset -gx BLABEE_CODEX_AUTO_CONNECT_CONFLICT=function\n"
                + "else\n"
                + "  unset BLABEE_CODEX_AUTO_CONNECT_CONFLICT\n"
                + "  function _blabee_codex_auto_connect_v1 {\n"
                + "    local _blabee_coordinator=\(coordinator)\n"
                + "    local _blabee_official=\(official)\n"
                + "    if (( $# == 0 )) || [[ $1 == resume ]]; then\n"
                + "      if [[ ! -x \"$_blabee_coordinator\" ]]; then\n"
                + "        (\n"
                + "          unset BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN\n"
                + "          command \"$_blabee_official\" \"$@\"\n"
                + "        )\n"
                + "        return $?\n"
                + "      fi\n"
                + "      (\n"
                + "        unset BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN\n"
                + "        command \"$_blabee_coordinator\" managed-codex --codex \"$_blabee_official\" -- \"$@\"\n"
                + "      )\n"
                + "      return $?\n"
                + "    fi\n"
                + "    (\n"
                + "      unset BLABEE_SOCKET BLABEE_MANAGED_APPROVALS BLABEE_MANAGED_CODEX_AUTH_TOKEN\n"
                + "      command \"$_blabee_official\" \"$@\"\n"
                + "    )\n"
                + "  }\n"
                + "  function codex { _blabee_codex_auto_connect_v1 \"$@\" }\n"
                + "fi\n"
        ).utf8)
    }

    private func zshRCLayout(_ data: Data?) throws -> ZshRCLayout {
        guard let data else { return .disabled(Data()) }
        let openingBytes = Data(Self.openingMarker.utf8)
        let closingBytes = Data(Self.closingMarker.utf8)
        let openingRanges = Self.ranges(of: openingBytes, in: data)
        let closingRanges = Self.ranges(of: closingBytes, in: data)
        if openingRanges.isEmpty, closingRanges.isEmpty { return .disabled(data) }
        guard openingRanges.count == 1, closingRanges.count == 1 else {
            throw CodexAutoConnectError.conflict(
                ".zshrc의 Blabee 마커가 중복되었거나 손상되었습니다."
            )
        }
        let opening = openingRanges[0]
        let closing = closingRanges[0]
        guard opening.lowerBound < closing.lowerBound,
              opening.upperBound < data.count, data[opening.upperBound] == 0x0A,
              closing.upperBound < data.count, data[closing.upperBound] == 0x0A
        else {
            throw CodexAutoConnectError.conflict(
                ".zshrc의 Blabee 마커 경계가 손상되었습니다."
            )
        }
        let betweenData = data.subdata(in: opening.upperBound..<closing.lowerBound)
        guard let between = String(data: betweenData, encoding: .utf8) else {
            throw CodexAutoConnectError.conflict(".zshrc의 Blabee 블록이 UTF-8 텍스트가 아닙니다.")
        }
        let lines = between.split(separator: "\n", omittingEmptySubsequences: false)
        let legacySource = lines.count == 3 && lines[0].isEmpty && lines[2].isEmpty
            && lines[1].hasPrefix("source ")
        let guardedSource = lines.count == 5 && lines[0].isEmpty && lines[4].isEmpty
            && lines[1].hasPrefix("if [[ -r ") && lines[1].hasSuffix("]]; then")
            && lines[2].hasPrefix("  source ") && lines[3] == "fi"
        guard legacySource || guardedSource else {
            throw CodexAutoConnectError.conflict(".zshrc의 Blabee 블록 형식이 손상되었습니다.")
        }

        var prefixEnd = opening.lowerBound
        if opening.lowerBound != data.startIndex {
            let previous = opening.lowerBound - 1
            guard data[previous] == 0x0A else {
                throw CodexAutoConnectError.conflict(".zshrc의 Blabee 블록 경계가 손상되었습니다.")
            }
            prefixEnd = previous
        }
        let blockEnd = closing.upperBound + 1
        let prefix = data.subdata(in: data.startIndex..<prefixEnd)
        let suffix = data.subdata(in: blockEnd..<data.endIndex)
        let block = data.subdata(in: opening.lowerBound..<blockEnd)
        return .owned(prefix: prefix, suffix: suffix, exactMarker: block == markerBlock())
    }

    private static func ranges(of needle: Data, in haystack: Data) -> [Range<Int>] {
        guard !needle.isEmpty, haystack.count >= needle.count else { return [] }
        var result: [Range<Int>] = []
        var searchStart = haystack.startIndex
        while searchStart <= haystack.endIndex - needle.count,
              let range = haystack.range(of: needle, in: searchStart..<haystack.endIndex)
        {
            result.append(range)
            searchStart = range.upperBound
        }
        return result
    }

    private func managedConfiguration(_ data: Data) -> ManagedConfiguration? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        guard lines.count >= 5,
              lines[0] == "# Blabee Codex Auto Connect v1",
              lines[1] == "# Generated by Blabee. Do not edit."
        else { return nil }
        let zshRCWasMissing: Bool
        switch lines[2] {
        case "# zshrc-origin: missing": zshRCWasMissing = true
        case "# zshrc-origin: present": zshRCWasMissing = false
        default: return nil
        }
        let coordinatorPrefix = "# coordinator-path-base64: "
        let officialPrefix = "# official-codex-path-base64: "
        guard lines[3].hasPrefix(coordinatorPrefix), lines[4].hasPrefix(officialPrefix),
              let coordinatorData = Data(base64Encoded: String(lines[3].dropFirst(coordinatorPrefix.count))),
              let officialData = Data(base64Encoded: String(lines[4].dropFirst(officialPrefix.count))),
              let coordinatorPath = String(data: coordinatorData, encoding: .utf8),
              let officialCodexPath = String(data: officialData, encoding: .utf8),
              coordinatorPath.hasPrefix("/"), officialCodexPath.hasPrefix("/"),
              !coordinatorPath.utf8.contains(0), !officialCodexPath.utf8.contains(0)
        else { return nil }
        return ManagedConfiguration(
            zshRCWasMissing: zshRCWasMissing,
            coordinatorPath: coordinatorPath,
            officialCodexPath: officialCodexPath
        )
    }

    private func isOwnedManagedFile(_ data: Data) -> Bool {
        data.starts(with: Data(Self.generatedHeader.utf8))
    }

    private func validateExecutables(officialCodexURL: URL) throws {
        guard coordinatorURL.path.hasPrefix("/"), officialCodexURL.path.hasPrefix("/") else {
            throw CodexAutoConnectError.unavailable("Codex와 Blabee 실행 경로는 절대 경로여야 합니다.")
        }
        let coordinatorIdentity = try Self.executableIdentity(
            coordinatorURL,
            label: "Blabee coordinator"
        )
        let officialIdentity = try Self.executableIdentity(
            officialCodexURL,
            label: "공식 Codex"
        )
        guard coordinatorIdentity != officialIdentity,
              officialCodexURL.standardizedFileURL != managedFileURL.standardizedFileURL
        else {
            throw CodexAutoConnectError.conflict(
                "공식 Codex 경로가 Blabee 실행 파일 또는 자동 연결 파일을 다시 가리킵니다."
            )
        }
        if let managedIdentity = try Self.optionalTargetIdentity(managedFileURL),
           officialIdentity == managedIdentity
        {
            throw CodexAutoConnectError.conflict("공식 Codex 경로가 자동 연결 파일을 다시 가리킵니다.")
        }
    }

    private func withExclusiveLock<T>(
        createDirectories: Bool,
        _ body: () throws -> T
    ) throws -> T {
        Self.processMutex.lock()
        defer { Self.processMutex.unlock() }

        if createDirectories { try ensureSecureDirectories() }
        else if FileManager.default.fileExists(atPath: shellDirectoryURL.path) {
            try validateSecureDirectories()
        }
        guard FileManager.default.fileExists(atPath: shellDirectoryURL.path) else {
            return try body()
        }
        let descriptor = open(
            lockFileURL.path,
            O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 잠금 파일을 안전하게 열 수 없습니다.")
        }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              info.st_uid == geteuid(), info.st_nlink == 1,
              info.st_mode & 0o022 == 0
        else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 잠금 파일의 메타데이터가 안전하지 않습니다.")
        }
        var failedAttempts = 0
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            if errno == EINTR { continue }
            guard errno == EWOULDBLOCK || errno == EAGAIN else {
                throw CodexAutoConnectError.writeFailed("자동 연결 잠금을 획득할 수 없습니다.")
            }
            failedAttempts += 1
            guard failedAttempts < lockAttemptLimit else {
                throw CodexAutoConnectError.writeFailed(
                    "다른 Blabee 설정 작업이 끝나지 않아 자동 연결 잠금 시간이 초과되었습니다."
                )
            }
            if lockRetryMicroseconds > 0 { usleep(lockRetryMicroseconds) }
        }
        defer { _ = flock(descriptor, LOCK_UN) }
        return try body()
    }

    private func ensureSecureDirectories() throws {
        try ensureOwnedDirectory(applicationSupportURL)
        try ensureOwnedDirectory(applicationSupportURL.appendingPathComponent("shell", isDirectory: true))
        try ensureOwnedDirectory(shellDirectoryURL)
        try validateSecureDirectories()
    }

    private func ensureOwnedDirectory(_ url: URL) throws {
        var info = stat()
        if lstat(url.path, &info) == 0 {
            try Self.validateOwnedDirectory(info, name: url.lastPathComponent)
            return
        }
        guard errno == ENOENT else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(url.lastPathComponent) 디렉터리를 검사할 수 없습니다."
            )
        }
        let parent = url.deletingLastPathComponent()
        guard parent.path != url.path, !url.lastPathComponent.isEmpty else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 디렉터리 경로가 안전하지 않습니다.")
        }
        try ensureOwnedDirectory(parent)
        let parentDescriptor = open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parentDescriptor >= 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("자동 연결 상위 디렉터리를 안전하게 열 수 없습니다.")
        }
        defer { close(parentDescriptor) }
        if mkdirat(parentDescriptor, url.lastPathComponent, mode_t(0o700)) != 0, errno != EEXIST {
            throw CodexAutoConnectError.writeFailed("자동 연결 디렉터리를 만들 수 없습니다.")
        }
        guard lstat(url.path, &info) == 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("새 자동 연결 디렉터리를 확인할 수 없습니다.")
        }
        try Self.validateOwnedDirectory(info, name: url.lastPathComponent)
    }

    private func validateSecureDirectories() throws {
        for url in [applicationSupportURL, applicationSupportURL.appendingPathComponent("shell"), shellDirectoryURL] {
            var info = stat()
            guard lstat(url.path, &info) == 0 else {
                throw CodexAutoConnectError.unsafeFilesystem(
                    "Blabee 자동 연결 디렉터리를 검사할 수 없습니다."
                )
            }
            try Self.validateOwnedDirectory(info, name: url.lastPathComponent)
        }
    }

    private static func validateOwnedDirectory(_ info: stat, name: String) throws {
        guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              info.st_uid == geteuid(), info.st_mode & 0o022 == 0
        else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(name) 디렉터리가 현재 사용자 소유의 안전한 디렉터리가 아닙니다."
            )
        }
    }

    private func secureFile(at url: URL, maximumBytes: Int) throws -> SecureFile? {
        var named = stat()
        guard lstat(url.path, &named) == 0 else {
            if errno == ENOENT { return nil }
            throw CodexAutoConnectError.unsafeFilesystem("\(url.lastPathComponent)을 검사할 수 없습니다.")
        }
        guard named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              named.st_uid == geteuid(), named.st_nlink == 1,
              named.st_mode & 0o022 == 0,
              named.st_size >= 0, named.st_size <= off_t(maximumBytes)
        else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(url.lastPathComponent)이 심볼릭 링크, 특수 파일, 하드링크, 잘못된 소유자 또는 과도한 크기입니다."
            )
        }
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("\(url.lastPathComponent)을 안전하게 열 수 없습니다.")
        }
        defer { close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0,
              opened.st_dev == named.st_dev, opened.st_ino == named.st_ino,
              opened.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              opened.st_uid == geteuid(), opened.st_nlink == 1,
              opened.st_size == named.st_size,
              Self.sameMutationMetadata(named, opened)
        else {
            throw CodexAutoConnectError.unsafeFilesystem("\(url.lastPathComponent)이 검사 중 변경되었습니다.")
        }
        let data = try Self.readAll(descriptor, expectedBytes: Int(opened.st_size))
        var completed = stat()
        guard fstat(descriptor, &completed) == 0,
              completed.st_dev == opened.st_dev, completed.st_ino == opened.st_ino,
              completed.st_size == opened.st_size,
              Self.sameMutationMetadata(opened, completed)
        else {
            throw CodexAutoConnectError.unsafeFilesystem(
                "\(url.lastPathComponent)이 내용을 읽는 동안 변경되었습니다."
            )
        }
        return SecureFile(
            data: data,
            device: opened.st_dev,
            inode: opened.st_ino,
            mode: opened.st_mode & 0o777,
            size: opened.st_size,
            modificationSeconds: Int64(opened.st_mtimespec.tv_sec),
            modificationNanoseconds: Int64(opened.st_mtimespec.tv_nsec),
            changeSeconds: Int64(opened.st_ctimespec.tv_sec),
            changeNanoseconds: Int64(opened.st_ctimespec.tv_nsec),
            flags: opened.st_flags
        )
    }

    private func atomicWrite(
        _ data: Data,
        to destination: URL,
        expected: SecureFile?,
        defaultMode: mode_t
    ) throws {
        let directory = destination.deletingLastPathComponent()
        let temporary = directory.appendingPathComponent(
            ".\(destination.lastPathComponent).\(getpid()).\(UUID().uuidString).tmp"
        )
        let mode = expected?.mode ?? defaultMode
        let descriptor = open(
            temporary.path,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK,
            mode_t(mode)
        )
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일을 만들 수 없습니다.")
        }
        var openDescriptor = true
        defer {
            if openDescriptor { close(descriptor) }
            _ = unlink(temporary.path)
        }
        guard fchmod(descriptor, mode_t(mode)) == 0 else {
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일 권한을 설정할 수 없습니다.")
        }
        try Self.writeAll(data, descriptor: descriptor)
        if let expected {
            // ACLs and xattrs are copied explicitly because inode replacement
            // does not preserve them. Non-zero BSD file flags fail closed:
            // safely reproducing every immutable/append flag is outside this MVP.
            guard expected.flags == 0 else {
                throw CodexAutoConnectError.unsafeFilesystem(
                    "BSD 파일 플래그가 있는 설정 파일은 자동으로 교체하지 않습니다."
                )
            }
            try copyPreservedMetadata(
                from: destination,
                expected: expected,
                toDescriptor: descriptor
            )
            guard fchmod(descriptor, mode_t(mode)) == 0 else {
                throw CodexAutoConnectError.writeFailed("기존 설정 파일 모드를 보존할 수 없습니다.")
            }
        }
        guard fsync(descriptor) == 0 else {
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일을 동기화할 수 없습니다.")
        }
        guard close(descriptor) == 0 else {
            openDescriptor = false
            throw CodexAutoConnectError.writeFailed("임시 자동 연결 파일을 닫을 수 없습니다.")
        }
        openDescriptor = false
        try beforeDestinationReplace?(destination)
        if let expected {
            try verifyDestination(destination, expected: expected)
            guard rename(temporary.path, destination.path) == 0 else {
                throw CodexAutoConnectError.writeFailed("자동 연결 파일을 원자적으로 교체할 수 없습니다.")
            }
        } else {
            guard renameatx_np(
                AT_FDCWD,
                temporary.path,
                AT_FDCWD,
                destination.path,
                UInt32(RENAME_EXCL)
            ) == 0 else {
                throw CodexAutoConnectError.writeFailed(
                    "예상하지 못한 대상 파일이 생겨 새 자동 연결 파일을 설치하지 않았습니다."
                )
            }
        }
        try Self.syncDirectory(directory)
    }

    private func secureUnlink(_ url: URL, expected: SecureFile) throws {
        try verifyDestination(url, expected: expected)
        guard unlink(url.path) == 0 else {
            throw CodexAutoConnectError.writeFailed("\(url.lastPathComponent)을 안전하게 삭제할 수 없습니다.")
        }
        try Self.syncDirectory(url.deletingLastPathComponent())
    }

    private func copyPreservedMetadata(
        from source: URL,
        expected: SecureFile,
        toDescriptor destinationDescriptor: Int32
    ) throws {
        let sourceDescriptor = open(
            source.path,
            O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK
        )
        guard sourceDescriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("기존 설정 파일 메타데이터를 열 수 없습니다.")
        }
        defer { close(sourceDescriptor) }
        var info = stat()
        guard fstat(sourceDescriptor, &info) == 0,
              info.st_dev == expected.device, info.st_ino == expected.inode,
              info.st_size == expected.size,
              info.st_mtimespec.tv_sec == expected.modificationSeconds,
              info.st_mtimespec.tv_nsec == expected.modificationNanoseconds,
              info.st_ctimespec.tv_sec == expected.changeSeconds,
              info.st_ctimespec.tv_nsec == expected.changeNanoseconds
        else {
            throw CodexAutoConnectError.writeFailed(
                "기존 설정 파일이 메타데이터 복사 전에 변경되었습니다."
            )
        }
        let currentData = try Self.readAll(sourceDescriptor, expectedBytes: Int(info.st_size))
        guard currentData == expected.data else {
            throw CodexAutoConnectError.writeFailed(
                "기존 설정 파일 내용이 메타데이터 복사 전에 변경되었습니다."
            )
        }
        let flags = copyfile_flags_t(COPYFILE_ACL | COPYFILE_XATTR)
        guard fcopyfile(sourceDescriptor, destinationDescriptor, nil, flags) == 0 else {
            throw CodexAutoConnectError.writeFailed("기존 설정 파일의 ACL 또는 확장 속성을 보존할 수 없습니다.")
        }
    }

    private func verifyDestination(_ url: URL, expected: SecureFile?) throws {
        if let expected {
            let current = try secureFile(
                at: url,
                maximumBytes: maximumBytes(for: url)
            )
            guard current == expected else {
                throw CodexAutoConnectError.writeFailed("대상 파일이 변경되어 쓰기를 중단했습니다.")
            }
        } else {
            var info = stat()
            guard lstat(url.path, &info) != 0, errno == ENOENT else {
                throw CodexAutoConnectError.writeFailed("예상하지 못한 대상 파일이 생겨 쓰기를 중단했습니다.")
            }
        }
    }

    private func maximumBytes(for url: URL) -> Int {
        url.standardizedFileURL == zshRCURL.standardizedFileURL
            ? Self.maximumZshRCBytes : Self.maximumManagedFileBytes
    }

    private static func sameMutationMetadata(_ lhs: stat, _ rhs: stat) -> Bool {
        lhs.st_mtimespec.tv_sec == rhs.st_mtimespec.tv_sec
            && lhs.st_mtimespec.tv_nsec == rhs.st_mtimespec.tv_nsec
            && lhs.st_ctimespec.tv_sec == rhs.st_ctimespec.tv_sec
            && lhs.st_ctimespec.tv_nsec == rhs.st_ctimespec.tv_nsec
    }

    private static func discoverOfficialCodex(
        environment: [String: String],
        coordinatorURL: URL,
        integrationURL: URL
    ) throws -> URL {
        var candidates: [URL] = []
        for entry in (environment["PATH"] ?? "").split(separator: ":", omittingEmptySubsequences: false) {
            let path = String(entry)
            guard path.hasPrefix("/") else { continue }
            candidates.append(URL(fileURLWithPath: path, isDirectory: true).appendingPathComponent("codex"))
        }
        candidates.append(URL(fileURLWithPath: "/opt/homebrew/bin/codex"))
        candidates.append(URL(fileURLWithPath: "/usr/local/bin/codex"))
        var seen = Set<String>()
        let coordinatorIdentity = try? executableIdentity(coordinatorURL, label: "Blabee coordinator")
        let integrationIdentity = try? optionalTargetIdentity(integrationURL)
        for candidate in candidates {
            let stable = candidate.standardizedFileURL
            guard seen.insert(stable.path).inserted,
                  let identity = try? executableIdentity(stable, label: "공식 Codex"),
                  identity != coordinatorIdentity, identity != integrationIdentity,
                  stable != integrationURL.standardizedFileURL
            else { continue }
            return stable
        }
        throw CodexAutoConnectError.unavailable(
            "절대 PATH 항목과 표준 설치 경로에서 공식 Codex 실행 파일을 찾지 못했습니다."
        )
    }

    private static func executableIdentity(_ url: URL, label: String) throws -> FileIdentity {
        var named = stat()
        guard lstat(url.path, &named) == 0,
              named.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
                || named.st_mode & mode_t(S_IFMT) == mode_t(S_IFLNK)
        else {
            throw CodexAutoConnectError.unavailable("\(label) 경로가 파일이나 심볼릭 링크가 아닙니다.")
        }
        var target = stat()
        guard stat(url.path, &target) == 0,
              target.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              access(url.path, X_OK) == 0
        else {
            throw CodexAutoConnectError.unavailable("\(label) 실행 파일이 없거나 실행할 수 없습니다.")
        }
        return FileIdentity(device: target.st_dev, inode: target.st_ino)
    }

    private static func optionalTargetIdentity(_ url: URL) throws -> FileIdentity? {
        var info = stat()
        guard lstat(url.path, &info) == 0 else {
            if errno == ENOENT { return nil }
            throw CodexAutoConnectError.unsafeFilesystem("파일 identity를 검사할 수 없습니다.")
        }
        guard stat(url.path, &info) == 0 else {
            throw CodexAutoConnectError.unsafeFilesystem("파일 target identity를 검사할 수 없습니다.")
        }
        return FileIdentity(device: info.st_dev, inode: info.st_ino)
    }

    private static func readAll(_ descriptor: Int32, expectedBytes: Int) throws -> Data {
        var data = Data()
        data.reserveCapacity(expectedBytes)
        var buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = Darwin.read(descriptor, &buffer, buffer.count)
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw CodexAutoConnectError.unsafeFilesystem("파일 내용을 읽을 수 없습니다.")
            }
            data.append(contentsOf: buffer[0..<count])
        }
        guard data.count == expectedBytes else {
            throw CodexAutoConnectError.unsafeFilesystem("파일 크기가 읽는 동안 변경되었습니다.")
        }
        return data
    }

    private static func writeAll(_ data: Data, descriptor: Int32) throws {
        try data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var offset = 0
            while offset < rawBuffer.count {
                let count = Darwin.write(descriptor, base.advanced(by: offset), rawBuffer.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw CodexAutoConnectError.writeFailed("자동 연결 파일을 쓸 수 없습니다.")
                }
                offset += count
            }
        }
    }

    private static func syncDirectory(_ url: URL) throws {
        let descriptor = open(url.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else {
            throw CodexAutoConnectError.writeFailed("자동 연결 디렉터리를 열 수 없습니다.")
        }
        defer { close(descriptor) }
        guard fsync(descriptor) == 0 else {
            throw CodexAutoConnectError.writeFailed("자동 연결 디렉터리를 동기화할 수 없습니다.")
        }
    }

    private static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

private enum ZshRCLayout {
    case disabled(Data)
    case owned(prefix: Data, suffix: Data, exactMarker: Bool)
}

private struct SecureFile: Equatable {
    let data: Data
    let device: dev_t
    let inode: ino_t
    let mode: mode_t
    let size: off_t
    let modificationSeconds: Int64
    let modificationNanoseconds: Int64
    let changeSeconds: Int64
    let changeNanoseconds: Int64
    let flags: UInt32
}

private struct FileIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
}

private struct ManagedConfiguration {
    let zshRCWasMissing: Bool
    let coordinatorPath: String
    let officialCodexPath: String
}
