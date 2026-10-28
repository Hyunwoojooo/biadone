import CryptoKit
import Darwin
import Foundation

/// The repository and release tag come from the checked release, never from a redirect.
enum AppUpdateDownloadPolicy {
    static let maximumDiskImageBytes: Int64 = 512 * 1_024 * 1_024
    static let maximumChecksumBytes: Int64 = 4 * 1_024
    static let maximumApplicationBytes: Int64 = 1_024 * 1_024 * 1_024
    static let teamID = "VN7AMDG677"

    static func diskImageName(_ version: PetAppUpdateVersion) -> String {
        "Blabee-\(version.version)-arm64-r\(version.build).dmg"
    }

    static func isHTTPS(_ url: URL) -> Bool {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return c.scheme == "https" && c.user == nil && c.password == nil
            && (c.port == nil || c.port == 443) && c.fragment == nil
    }

    static func isAssetURL(_ url: URL, repository: String, tag: String, name: String) -> Bool {
        guard isHTTPS(url), url.host?.lowercased() == "github.com", url.query == nil,
              let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let path = c.percentEncodedPath.removingPercentEncoding,
              !path.contains("%"), !path.contains("\\")
        else { return false }
        return path == "/\(repository)/releases/download/\(tag)/\(name)"
    }

    static func allowsRedirect(_ url: URL, original: URL) -> Bool {
        guard isHTTPS(url) else { return false }
        if url.host?.lowercased() == "github.com" { return url == original }
        return ["release-assets.githubusercontent.com", "objects.githubusercontent.com"]
            .contains(url.host?.lowercased() ?? "")
    }

    static func validatedAssets(_ release: PetAppUpdateRelease) throws -> PetAppUpdateInstallerAssets {
        guard isHTTPS(release.releaseURL), release.releaseURL.host?.lowercased() == "github.com",
              release.releaseURL.query == nil,
              let components = URLComponents(url: release.releaseURL, resolvingAgainstBaseURL: false),
              let path = components.percentEncodedPath.removingPercentEncoding
        else { throw AppUpdateDownloadError.invalidRelease }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        let tag = "blabee-v\(release.version.version)+build.\(release.version.build)"
        guard parts.count == 6, parts[0].isEmpty, parts[3] == "releases", parts[4] == "tag",
              parts[5] == Substring(tag),
              [parts[1], parts[2]].allSatisfy({ part in
                  !part.isEmpty && part != "." && part != ".." && part.utf8.allSatisfy {
                      (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
                          || [45, 46, 95].contains($0)
                  }
              })
        else { throw AppUpdateDownloadError.invalidRelease }
        guard let assets = release.installerAssets else { throw AppUpdateDownloadError.assetsUnavailable }
        let repository = "\(parts[1])/\(parts[2])"
        let name = diskImageName(release.version)
        guard assets.dmg.name == name, assets.checksum.name == name + ".sha256",
              (1...maximumDiskImageBytes).contains(assets.dmg.size),
              (1...maximumChecksumBytes).contains(assets.checksum.size),
              isAssetURL(assets.dmg.url, repository: repository, tag: tag, name: name),
              isAssetURL(assets.checksum.url, repository: repository, tag: tag, name: name + ".sha256")
        else { throw AppUpdateDownloadError.invalidRelease }
        return assets
    }
}

enum AppUpdateDownloadError: Error, LocalizedError, Equatable {
    case assetsUnavailable, invalidRelease, downloadRejected, checksumMismatch
    case unsafeStaging, signatureRejected, notarizationRejected, versionMismatch, invalidImage, cleanupFailed
    case runtimeIdentityMismatch

    var errorDescription: String? {
        switch self {
        case .assetsUnavailable: PetL10n.text("This release has no DMG and SHA-256 files for automatic updates.", korean: "이 릴리스에는 자동 업데이트용 DMG와 SHA-256 파일이 없습니다.")
        case .invalidRelease: PetL10n.text("Unable to verify the update file's version, size, or GitHub download address.", korean: "업데이트 파일의 버전, 크기 또는 GitHub 배포 주소를 확인하지 못했습니다.")
        case .downloadRejected: PetL10n.text("Unable to verify the update download address, response, or file size.", korean: "업데이트 다운로드의 주소, 응답 또는 파일 크기를 확인하지 못했습니다.")
        case .checksumMismatch: PetL10n.text("The downloaded installer's SHA-256 does not match the release information.", korean: "다운로드한 설치 파일의 SHA-256이 배포 정보와 일치하지 않습니다.")
        case .unsafeStaging: PetL10n.text("Unable to safely verify the update temporary folder or file.", korean: "업데이트 임시 폴더 또는 파일을 안전하게 확인하지 못했습니다.")
        case .signatureRejected: PetL10n.text("Unable to verify the Blabee distribution signature on the update file.", korean: "업데이트 파일의 Blabee 배포 서명을 확인하지 못했습니다.")
        case .notarizationRejected: PetL10n.text("macOS could not verify notarization or permission to run the update file.", korean: "macOS가 업데이트 파일의 공증 또는 실행 허용을 확인하지 못했습니다.")
        case .versionMismatch: PetL10n.text("The app version inside the installer does not match the GitHub release version.", korean: "설치 파일 안의 앱 버전이 GitHub 배포 버전과 일치하지 않습니다.")
        case .invalidImage: PetL10n.text("Unable to verify the app structure inside the update disk image.", korean: "업데이트 디스크 이미지의 앱 구성을 확인하지 못했습니다.")
        case .cleanupFailed: PetL10n.text("Unable to detach the update disk image. Temporary files have been preserved.", korean: "업데이트 디스크 이미지를 분리하지 못했습니다. 임시 파일을 보존했습니다.")
        case .runtimeIdentityMismatch: PetL10n.text("The verified installer and update app have different signed executable identities.", korean: "검증한 설치본과 업데이트 앱의 서명된 실행 식별자가 일치하지 않습니다.")
        }
    }
}

struct AppUpdatePreparedDownload: Equatable, Sendable {
    let release: PetAppUpdateRelease
    let workRootURL: URL
    let applicationURL: URL
    let diskImageURL: URL
    let sha256: String
    let runtimeIdentity: String
}

struct AppUpdateDownloadedFile: Sendable {
    let statusCode: Int
    let finalURL: URL
    let byteCount: Int64
}

/// No installed paths or Codex processes are touched by this preparer.
struct AppUpdateDownloadPreparer: Sendable {
    typealias Download = @Sendable (PetAppUpdateAsset, URL) async throws -> AppUpdateDownloadedFile
    typealias Run = @Sendable (String, [String], Int) throws -> ManagedCodexVersionProbeResult
    typealias RuntimeInspector = @Sendable (URL) throws -> String

    private let temporaryDirectory: URL
    private let download: Download
    private let run: Run
    private let runtimeInspector: RuntimeInspector

    init(
        temporaryDirectory: URL = FileManager.default.temporaryDirectory,
        download: @escaping Download = AppUpdateAssetDownloader.download,
        run: @escaping Run = Self.runSystemCommand,
        runtimeInspector: @escaping RuntimeInspector = Self.inspectRuntimeIdentity
    ) {
        // Keep the caller's directory until POSIX canonicalization below. Foundation
        // may rewrite physical /private/var or /private/tmp paths to symlink aliases,
        // which the detached helper's no-follow directory traversal must reject.
        self.temporaryDirectory = temporaryDirectory
        self.download = download
        self.run = run
        self.runtimeInspector = runtimeInspector
    }

    func prepare(_ release: PetAppUpdateRelease) async throws -> AppUpdatePreparedDownload {
        let assets = try AppUpdateDownloadPolicy.validatedAssets(release)
        try Task.checkCancellation()
        let root = try await Task.detached { try makeWorkRoot() }.value
        let image = root.appendingPathComponent(assets.dmg.name)
        let checksum = root.appendingPathComponent(assets.checksum.name)
        do {
            for (asset, target) in [(assets.checksum, checksum), (assets.dmg, image)] {
                try Task.checkCancellation()
                let receipt = try await download(asset, target)
                guard receipt.statusCode == 200, receipt.byteCount == asset.size,
                      AppUpdateDownloadPolicy.allowsRedirect(receipt.finalURL, original: asset.url)
                else { throw AppUpdateDownloadError.downloadRejected }
                try await Task.detached { try requireRegularFile(target, size: asset.size) }.value
            }
            try Task.checkCancellation()
            let prepared = try await Task.detached {
                try prepareDownloaded(release, root: root, image: image, checksum: checksum)
            }.value
            if Task.isCancelled {
                try await cleanup(prepared)
                throw CancellationError()
            }
            return prepared
        } catch {
            // A failed detach must retain the mount directory and all files; deleting a
            // still-mounted tree is never a safe cleanup operation.
            if error as? AppUpdateDownloadError != .cleanupFailed {
                try? await Task.detached { try removeWorkRoot(root) }.value
            }
            throw error
        }
    }

    /// Called again by the detached updater before any process shutdown or replacement.
    func reverify(_ prepared: AppUpdatePreparedDownload) async throws {
        try Task.checkCancellation()
        try await Task.detached {
            let assets = try AppUpdateDownloadPolicy.validatedAssets(prepared.release)
            try requireWorkRoot(prepared.workRootURL)
            guard prepared.applicationURL.isFileURL, prepared.diskImageURL.isFileURL,
                  prepared.applicationURL.path == prepared.workRootURL.appendingPathComponent("Blabee.app", isDirectory: true).path,
                  prepared.diskImageURL.path == prepared.workRootURL.appendingPathComponent(assets.dmg.name).path
            else { throw AppUpdateDownloadError.unsafeStaging }
            let checksum = prepared.workRootURL.appendingPathComponent(assets.checksum.name)
            try requireRegularFile(prepared.diskImageURL, size: assets.dmg.size)
            try requireRegularFile(checksum, size: assets.checksum.size)
            let hash = try Self.readChecksum(checksum, expectedName: assets.dmg.name)
            guard hash == prepared.sha256, try Self.hashFile(prepared.diskImageURL) == hash else {
                throw AppUpdateDownloadError.checksumMismatch
            }
            try verifyDiskImage(prepared.diskImageURL)
            let actualIdentity = try verifyApplication(prepared.applicationURL, version: prepared.release.version)
            guard actualIdentity == prepared.runtimeIdentity else { throw AppUpdateDownloadError.runtimeIdentityMismatch }
        }.value
        try Task.checkCancellation()
    }

    func cleanup(_ prepared: AppUpdatePreparedDownload) async throws {
        try await Task.detached { try removeWorkRoot(prepared.workRootURL) }.value
    }

    private func prepareDownloaded(
        _ release: PetAppUpdateRelease, root: URL, image: URL, checksum: URL
    ) throws -> AppUpdatePreparedDownload {
        try requireWorkRoot(root)
        let expected = try Self.readChecksum(checksum, expectedName: image.lastPathComponent)
        guard try Self.hashFile(image) == expected else { throw AppUpdateDownloadError.checksumMismatch }
        try verifyDiskImage(image)
        let mount = root.appendingPathComponent("mount", isDirectory: true)
        try FileManager.default.createDirectory(at: mount, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        // Even a nonzero attach result may have mounted a volume before failing.
        var attachAttempted = false
        var attached = false
        do {
            attachAttempted = true
            let result = try command("/usr/bin/hdiutil", [
                "attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount.path, "-plist", image.path,
            ], timeout: 120_000, failure: .invalidImage)
            attached = true
            guard let plist = try PropertyListSerialization.propertyList(from: result.stdout, format: nil) as? [String: Any],
                  let entities = plist["system-entities"] as? [[String: Any]]
            else { throw AppUpdateDownloadError.invalidImage }
            let points = entities.compactMap { $0["mount-point"] as? String }
            guard points == [mount.path] else { throw AppUpdateDownloadError.invalidImage }
            let mountedApp = mount.appendingPathComponent("Blabee.app", isDirectory: true)
            let mountedIdentity = try verifyApplication(mountedApp, version: release.version)
            let stagedApp = root.appendingPathComponent("Blabee.app", isDirectory: true)
            try FileManager.default.copyItem(at: mountedApp, to: stagedApp)
            let stagedIdentity = try verifyApplication(stagedApp, version: release.version)
            guard mountedIdentity == stagedIdentity else { throw AppUpdateDownloadError.runtimeIdentityMismatch }
            try detach(mount)
            attachAttempted = false
            attached = false
            try FileManager.default.removeItem(at: mount)
            return AppUpdatePreparedDownload(
                release: release, workRootURL: root, applicationURL: stagedApp,
                diskImageURL: image, sha256: expected, runtimeIdentity: mountedIdentity
            )
        } catch {
            if attachAttempted {
                // No volume means a failed attach is already clean. Otherwise require
                // an actual detach; do not force unmount or remove mounted contents.
                if attached || Self.isMounted(mount) {
                    do { try detach(mount) } catch { throw AppUpdateDownloadError.cleanupFailed }
                }
            }
            throw error
        }
    }

    private func verifyDiskImage(_ url: URL) throws {
        try verifySignature(url, app: false)
        // Gatekeeper validates notarization without requiring Xcode/CLT on the tester Mac.
        // Release packaging separately validates the stapled outer-DMG ticket.
        let assessment = try command("/usr/sbin/spctl", [
            "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", url.path,
        ], timeout: 120_000, failure: .notarizationRejected)
        try Self.requireNotarizedAssessment(assessment)
    }

    private func verifyApplication(_ url: URL, version: PetAppUpdateVersion) throws -> String {
        try Self.requireApplicationLayout(url)
        try verifySignature(url, app: true)
        let data = try Data(contentsOf: url.appendingPathComponent("Contents/Info.plist"))
        guard let info = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              info["CFBundleIdentifier"] as? String == "com.biadone.blabee",
              info["CFBundleExecutable"] as? String == "blabee-coordinator",
              info["CFBundleShortVersionString"] as? String == version.version,
              info["CFBundleVersion"] as? String == version.build
        else { throw AppUpdateDownloadError.versionMismatch }
        let assessment = try command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", url.path], timeout: 120_000, failure: .notarizationRejected)
        try Self.requireNotarizedAssessment(assessment)
        let identity = try runtimeInspector(url)
        guard OperationalRuntimeIdentity.isValid(identity) else { throw AppUpdateDownloadError.signatureRejected }
        return identity
    }

    private static func inspectRuntimeIdentity(_ applicationURL: URL) throws -> String {
        let executable = applicationURL.appendingPathComponent("Contents/MacOS/blabee-coordinator")
        guard let inspection = OperationalRuntimeIdentity.installedInspection(forExecutable: executable) else {
            throw AppUpdateDownloadError.signatureRejected
        }
        return inspection.snapshot.runtimeIdentity
    }

    private static func requireNotarizedAssessment(_ result: ManagedCodexVersionProbeResult) throws {
        let lines = String(decoding: result.stdout + result.stderr, as: UTF8.self).components(separatedBy: .newlines)
        guard lines.filter({ $0 == "source=Notarized Developer ID" }).count == 1 else {
            throw AppUpdateDownloadError.notarizationRejected
        }
    }

    private func verifySignature(_ url: URL, app: Bool) throws {
        let identifier = app ? "com.biadone.blabee" : "com.biadone.blabee.dmg"
        let requirement = "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"\(AppUpdateDownloadPolicy.teamID)\" and identifier \"\(identifier)\""
        _ = try command("/usr/bin/codesign", ["--verify"] + (app ? ["--deep"] : []) + [
            "--strict", "--verbose=2", "--test-requirement", "=" + requirement, url.path,
        ], failure: .signatureRejected)
        let display = try command("/usr/bin/codesign", ["--display", "--verbose=4", url.path], failure: .signatureRejected)
        let lines = String(decoding: display.stdout + display.stderr, as: UTF8.self)
            .components(separatedBy: .newlines)
        func field(_ key: String) -> String? {
            let matches = lines.filter { $0.hasPrefix(key + "=") }
            return matches.count == 1 ? String(matches[0].dropFirst(key.count + 1)) : nil
        }
        guard !lines.contains("Signature=adhoc"), field("TeamIdentifier") == AppUpdateDownloadPolicy.teamID,
              field("Identifier") == identifier, let timestamp = field("Timestamp"),
              !timestamp.trimmingCharacters(in: .whitespaces).isEmpty,
              !["none", "n/a", "not set"].contains(timestamp.lowercased()),
              let authority = lines.first(where: { $0.hasPrefix("Authority=") }),
              authority.hasPrefix("Authority=Developer ID Application: "), authority.hasSuffix(" (\(AppUpdateDownloadPolicy.teamID))")
        else { throw AppUpdateDownloadError.signatureRejected }
        if app {
            guard let directory = lines.first(where: { $0.hasPrefix("CodeDirectory ") }),
                  let flagsStart = directory.range(of: "flags=0x"),
                  let flags = UInt64(directory[flagsStart.upperBound...].prefix(while: { $0.isHexDigit }), radix: 16),
                  flags & 0x10000 != 0
            else { throw AppUpdateDownloadError.signatureRejected }
        }
    }

    private func detach(_ mount: URL) throws {
        _ = try command("/usr/bin/hdiutil", ["detach", mount.path], timeout: 30_000, failure: .cleanupFailed)
    }

    private func command(_ executable: String, _ arguments: [String], timeout: Int = 30_000, failure: AppUpdateDownloadError) throws -> ManagedCodexVersionProbeResult {
        do {
            let result = try run(executable, arguments, timeout)
            guard result.exitCode == 0, result.terminationSignal == nil else { throw failure }
            return result
        } catch { throw failure }
    }

    private static func runSystemCommand(_ executable: String, _ arguments: [String], _ timeout: Int) throws -> ManagedCodexVersionProbeResult {
        // All callers are the fixed verification commands above; no shell or downloaded executable runs.
        try ManagedCodexVersionProbeRunner.run(
            executable: URL(fileURLWithPath: executable), arguments: arguments,
            environment: ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C", "LC_ALL": "C"],
            timeoutMilliseconds: timeout, outputLimit: 1_048_576
        )
    }

    private func makeWorkRoot() throws -> URL {
        let parent = try Self.physicalDirectoryURL(temporaryDirectory)
        let root = parent.appendingPathComponent("blabee-update-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try requireWorkRoot(root)
        return root
    }

    private func requireWorkRoot(_ root: URL) throws {
        let parent = try Self.physicalDirectoryURL(temporaryDirectory)
        var metadata = stat()
        guard root.isFileURL,
              root.deletingLastPathComponent().path == parent.path,
              root.lastPathComponent.hasPrefix("blabee-update-"),
              UUID(uuidString: String(root.lastPathComponent.dropFirst("blabee-update-".count))) != nil,
              lstat(root.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR,
              metadata.st_uid == getuid(), metadata.st_mode & 0o777 == 0o700,
              try Self.physicalDirectoryURL(root).path == root.path
        else { throw AppUpdateDownloadError.unsafeStaging }
    }

    private static func physicalDirectoryURL(_ url: URL) throws -> URL {
        guard url.isFileURL, url.path.hasPrefix("/"),
              let physical = realpath(url.path, nil)
        else { throw AppUpdateDownloadError.unsafeStaging }
        defer { free(physical) }
        let result = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
        var metadata = stat()
        guard lstat(result.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR else {
            throw AppUpdateDownloadError.unsafeStaging
        }
        return result
    }

    private func removeWorkRoot(_ root: URL) throws {
        try requireWorkRoot(root)
        let mount = root.appendingPathComponent("mount", isDirectory: true)
        guard !Self.isMounted(mount) else { throw AppUpdateDownloadError.cleanupFailed }
        try FileManager.default.removeItem(at: root)
    }

    private static func isMounted(_ mount: URL) -> Bool {
        var metadata = statfs()
        guard statfs(mount.path, &metadata) == 0 else { return false }
        return withUnsafeBytes(of: metadata.f_mntonname) { bytes in
            String(cString: bytes.baseAddress!.assumingMemoryBound(to: CChar.self)) == mount.path
        }
    }

    private func requireRegularFile(_ url: URL, size: Int64) throws {
        var metadata = stat()
        guard lstat(url.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFREG,
              metadata.st_nlink == 1, metadata.st_uid == getuid(), metadata.st_size == size
        else { throw AppUpdateDownloadError.downloadRejected }
    }

    static func readChecksum(_ url: URL, expectedName: String) throws -> String {
        let data = try Data(contentsOf: url)
        guard data.count <= AppUpdateDownloadPolicy.maximumChecksumBytes,
              let raw = String(data: data, encoding: .utf8) else { throw AppUpdateDownloadError.checksumMismatch }
        let line = raw.hasSuffix("\n") ? String(raw.dropLast()) : raw
        // Exactly one GNU/shasum record, bound to this asset's filename. No path, second record or CR.
        guard line.count == 64 + 2 + expectedName.count,
              line.dropFirst(64) == "  " + expectedName,
              line.prefix(64).utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        else { throw AppUpdateDownloadError.checksumMismatch }
        return String(line.prefix(64))
    }

    static func hashFile(_ url: URL) throws -> String {
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw AppUpdateDownloadError.unsafeStaging }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func requireApplicationLayout(_ root: URL) throws {
        var count = 0
        var total: Int64 = 0
        func visit(_ url: URL, depth: Int) throws {
            var metadata = stat()
            guard depth <= 64, lstat(url.path, &metadata) == 0 else { throw AppUpdateDownloadError.invalidImage }
            count += 1
            guard count <= 10_000 else { throw AppUpdateDownloadError.invalidImage }
            switch metadata.st_mode & S_IFMT {
            case S_IFDIR:
                for entry in try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
                    try visit(entry, depth: depth + 1)
                }
            case S_IFREG:
                guard metadata.st_nlink == 1 else { throw AppUpdateDownloadError.invalidImage }
                total += metadata.st_size
                guard total <= AppUpdateDownloadPolicy.maximumApplicationBytes else { throw AppUpdateDownloadError.invalidImage }
            default: throw AppUpdateDownloadError.invalidImage
            }
        }
        var metadata = stat()
        guard lstat(root.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR else { throw AppUpdateDownloadError.invalidImage }
        try visit(root, depth: 0)
        let info = root.appendingPathComponent("Contents/Info.plist")
        guard lstat(info.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFREG, metadata.st_size <= 1_048_576 else { throw AppUpdateDownloadError.invalidImage }
    }
}

/// URLSession owns its network temporary file; only a completed, bounded file is
/// moved into the private staging root. Redirects are checked before following.
private final class AppUpdateAssetDownloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let asset: PetAppUpdateAsset
    private let destination: URL
    private let lock = NSLock()
    private var continuation: CheckedContinuation<AppUpdateDownloadedFile, Error>?
    private var task: URLSessionDownloadTask?
    private var cancelled = false
    private var redirects = 0
    private var completedFile: AppUpdateDownloadedFile?

    private init(asset: PetAppUpdateAsset, destination: URL) {
        self.asset = asset
        self.destination = destination
    }

    static func download(_ asset: PetAppUpdateAsset, to destination: URL) async throws -> AppUpdateDownloadedFile {
        let delegate = AppUpdateAssetDownloader(asset: asset, destination: destination)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 300
        let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                delegate.start(session: session, continuation: continuation)
            }
        } onCancel: { delegate.cancel() }
    }

    private func start(session: URLSession, continuation: CheckedContinuation<AppUpdateDownloadedFile, Error>) {
        lock.lock()
        defer { lock.unlock() }
        if cancelled { continuation.resume(throwing: CancellationError()); return }
        self.continuation = continuation
        var request = URLRequest(url: asset.url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpShouldHandleCookies = false
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        request.setValue("Blabee-Update-Download", forHTTPHeaderField: "User-Agent")
        let task = session.downloadTask(with: request)
        self.task = task
        task.resume()
    }

    private func cancel() {
        lock.lock()
        cancelled = true
        let task = task
        lock.unlock()
        task?.cancel()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        redirects += 1 // URLSession's delegate queue is serial.
        guard redirects <= 5, let url = request.url,
              AppUpdateDownloadPolicy.allowsRedirect(url, original: asset.url)
        else { completionHandler(nil); task.cancel(); return }
        completionHandler(request)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > asset.size || totalBytesExpectedToWrite > asset.size { downloadTask.cancel() }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let response = downloadTask.response as? HTTPURLResponse, let url = response.url,
              response.statusCode == 200,
              AppUpdateDownloadPolicy.allowsRedirect(url, original: asset.url),
              let size = (try? FileManager.default.attributesOfItem(atPath: location.path)[.size]) as? NSNumber,
              size.int64Value == asset.size
        else { return }
        do {
            try FileManager.default.moveItem(at: location, to: destination)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
            completedFile = AppUpdateDownloadedFile(statusCode: response.statusCode, finalURL: url, byteCount: size.int64Value)
        } catch { completedFile = nil }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let continuation = continuation
        self.continuation = nil
        let cancelled = cancelled
        lock.unlock()
        if cancelled { continuation?.resume(throwing: CancellationError()) }
        else if let error { continuation?.resume(throwing: error) }
        else if let completedFile { continuation?.resume(returning: completedFile) }
        else { continuation?.resume(throwing: AppUpdateDownloadError.downloadRejected) }
    }
}
