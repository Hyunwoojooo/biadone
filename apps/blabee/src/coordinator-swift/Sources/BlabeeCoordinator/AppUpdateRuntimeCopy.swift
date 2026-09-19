import CoordinatorSwift
import Darwin
import Foundation

/// A supervisor/updater must use another executable inode so it cannot retain
/// the installed app's runtime-use lease while that app is replaced.
enum AppUpdateRuntimeCopy {
    static let maximumBytes: Int64 = 512 * 1_024 * 1_024
    static let maximumEntries = 30_000

    static func prepareCurrent(in parentURL: URL) throws -> URL {
        guard let executable = Bundle.main.executableURL,
              let current = OperationalRuntimeIdentity.resolveSnapshot(executableURL: executable),
              AppRuntimeUseLease.packagedExecutable(executable) != nil
        else { throw failure("관리 도우미는 설치된 Blabee 앱에서 시작해야 합니다.") }
        let source = executable.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
        return try prepare(
            sourceURL: source, in: parentURL, expectedIdentity: current.runtimeIdentity,
            validator: { app in
                OperationalRuntimeIdentity.installedIdentity(
                    forExecutable: app.appendingPathComponent(AppRuntimeUseLease.executablePath)
                )
            }
        )
    }

    /// Injected identity inspection is only used by isolated fixture tests.
    static func prepare(
        sourceURL: URL, in parentURL: URL, expectedIdentity: String,
        validator: (URL) -> String?
    ) throws -> URL {
        guard OperationalRuntimeIdentity.isValid(expectedIdentity),
              sourceURL.isFileURL, parentURL.isFileURL,
              sourceURL.lastPathComponent == "Blabee.app",
              sourceURL.path.hasPrefix("/"), parentURL.path.hasPrefix("/"),
              !parentURL.path.hasPrefix(sourceURL.path + "/")
        else { throw failure("관리 도우미의 원본이나 저장 위치가 올바르지 않습니다.") }
        let source = try physicalDirectory(sourceURL)
        let parent = try physicalDirectory(parentURL)
        // Parent directories must have been created by the owning subsystem.
        // A symlink anywhere in this path cannot redirect our helper copy.
        guard parent.path == parentURL.path, source.path == sourceURL.path
        else { throw failure("관리 도우미 경로에 심볼릭 링크가 있습니다.") }
        let parentIdentity = try privateDirectoryIdentity(parent)
        let sourceIdentity = try directoryIdentity(source)
        try inspectTree(source)
        guard validator(source) == expectedIdentity else {
            throw failure("현재 앱의 서명을 다시 확인하지 못했습니다.")
        }
        let destination = parent.appendingPathComponent("Blabee.app", isDirectory: true)
        var existing = stat()
        guard lstat(destination.path, &existing) != 0, errno == ENOENT else {
            throw failure("관리 도우미 저장 위치가 이미 사용 중입니다.")
        }
        // copyItem never overwrites a pre-existing destination and preserves
        // the app's code-signature resources and quarantine attributes.
        try FileManager.default.copyItem(at: source, to: destination)
        let copiedIdentity = try directoryIdentity(destination)
        guard try privateDirectoryIdentity(parent) == parentIdentity,
              try directoryIdentity(source) == sourceIdentity,
              try directoryIdentity(destination) == copiedIdentity
        else { throw failure("관리 도우미를 복사하는 동안 파일이 바뀌었습니다.") }
        try inspectTree(destination)
        let sourceExecutable = source.appendingPathComponent(AppRuntimeUseLease.executablePath)
        let copiedExecutable = destination.appendingPathComponent(AppRuntimeUseLease.executablePath)
        var before = stat(), after = stat()
        guard lstat(sourceExecutable.path, &before) == 0,
              lstat(copiedExecutable.path, &after) == 0,
              before.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              after.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              before.st_dev != after.st_dev || before.st_ino != after.st_ino,
              validator(source) == expectedIdentity,
              validator(destination) == expectedIdentity,
              try privateDirectoryIdentity(parent) == parentIdentity,
              try directoryIdentity(destination) == copiedIdentity
        else { throw failure("복사한 관리 도우미의 서명이나 실행 파일을 확인하지 못했습니다.") }
        return destination
    }

    private static func physicalDirectory(_ url: URL) throws -> URL {
        // Foundation can fold /private/var and /private/tmp back into symlink
        // aliases, which is unsuitable for a no-symlink identity comparison.
        guard let path = physicalPath(url) else {
            throw failure("관리 도우미의 실제 저장 경로를 확인하지 못했습니다.")
        }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    static func physicalPath(_ url: URL) -> String? {
        guard url.isFileURL, let resolved = realpath(url.path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    private struct DirectoryIdentity: Equatable {
        let device: dev_t
        let inode: ino_t
        let uid: uid_t
        let mode: mode_t
    }

    private static func directoryIdentity(_ url: URL) throws -> DirectoryIdentity {
        var info = stat()
        guard lstat(url.path, &info) == 0,
              info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
        else { throw failure("관리 도우미의 폴더를 확인하지 못했습니다.") }
        return DirectoryIdentity(device: info.st_dev, inode: info.st_ino, uid: info.st_uid, mode: info.st_mode)
    }

    private static func privateDirectoryIdentity(_ url: URL) throws -> DirectoryIdentity {
        let identity = try directoryIdentity(url)
        guard identity.uid == geteuid(), identity.mode & 0o077 == 0 else {
            throw failure("관리 도우미 폴더의 소유권과 접근 권한을 확인해 주세요.")
        }
        return identity
    }

    private static func inspectTree(_ root: URL) throws {
        var count = 0
        var bytes: Int64 = 0
        let deadline = Date().addingTimeInterval(60)
        func walk(_ url: URL, depth: Int) throws {
            count += 1
            var info = stat()
            guard count <= maximumEntries, depth <= 64, Date() < deadline,
                  lstat(url.path, &info) == 0
            else { throw failure("관리 도우미 파일이 자동 복사 범위를 벗어났습니다.") }
            switch info.st_mode & mode_t(S_IFMT) {
            case mode_t(S_IFDIR):
                for child in try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
                    try walk(child, depth: depth + 1)
                }
            case mode_t(S_IFREG):
                guard info.st_size >= 0, Int64(info.st_size) <= maximumBytes - bytes else {
                    throw failure("관리 도우미 파일이 자동 복사 범위를 벗어났습니다.")
                }
                bytes += Int64(info.st_size)
            default:
                throw failure("관리 도우미에 지원하지 않는 링크나 특수 파일이 있습니다.")
            }
        }
        try walk(root, depth: 0)
    }

    private static func failure(_ message: String) -> CoordinatorError {
        CoordinatorError("app_update_runtime_copy_unverified", message)
    }
}
