import Foundation

struct PetAppUpdateVersion: Equatable, Sendable, Comparable {
    let version: String
    let build: String
    private let components: [UInt64]
    private let buildNumber: UInt64

    init?(version: String, build: String) {
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let numbers = Self.canonicalNumbers(parts),
              let buildNumber = Self.canonicalNumber(Substring(build)),
              (1...9_999).contains(buildNumber)
        else { return nil }
        self.version = version
        self.build = build
        components = numbers
        self.buildNumber = buildNumber
    }

    var displayLabel: String { PetL10n.text("\(version) (build \(build))", korean: "\(version) (빌드 \(build))") }

    static func < (lhs: Self, rhs: Self) -> Bool {
        if lhs.components != rhs.components {
            return lhs.components.lexicographicallyPrecedes(rhs.components)
        }
        return lhs.buildNumber < rhs.buildNumber
    }

    private static func canonicalNumbers(_ parts: [Substring]) -> [UInt64]? {
        let numbers = parts.compactMap(canonicalNumber)
        return numbers.count == parts.count ? numbers : nil
    }

    private static func canonicalNumber(_ value: Substring) -> UInt64? {
        guard !value.isEmpty,
              value.utf8.allSatisfy({ (48...57).contains($0) }),
              value.count == 1 || value.first != "0"
        else { return nil }
        return UInt64(value)
    }
}

struct PetAppUpdateAsset: Equatable, Sendable {
    let name: String
    let url: URL
    let size: Int64
}

struct PetAppUpdateInstallerAssets: Equatable, Sendable {
    let dmg: PetAppUpdateAsset
    let checksum: PetAppUpdateAsset
}

struct PetAppUpdateRelease: Equatable, Sendable {
    let version: PetAppUpdateVersion
    let releaseURL: URL
    let installerAssets: PetAppUpdateInstallerAssets?
    let installerUnavailableReason: String?

    init(
        version: PetAppUpdateVersion, releaseURL: URL,
        installerAssets: PetAppUpdateInstallerAssets? = nil,
        installerUnavailableReason: String? = nil
    ) {
        self.version = version
        self.releaseURL = releaseURL
        self.installerAssets = installerAssets
        self.installerUnavailableReason = installerUnavailableReason
    }
}

enum PetAppUpdateState: Equatable, Sendable {
    case notChecked
    case checking
    case upToDate
    case noPublishedRelease
    case available(PetAppUpdateRelease)
    case unavailable(String)

    var title: String {
        switch self {
        case .notChecked: PetL10n.text("Check for Updates", korean: "업데이트 확인")
        case .checking: PetL10n.text("Checking for updates", korean: "업데이트 확인 중")
        case .upToDate: PetL10n.text("You're up to date", korean: "최신 버전입니다")
        case .noPublishedRelease: PetL10n.text("No release available", korean: "등록된 배포 버전이 없습니다")
        case .available: PetL10n.text("An update is available", korean: "업데이트할 수 있습니다")
        case .unavailable: PetL10n.text("Unable to check for updates", korean: "업데이트를 확인하지 못했습니다")
        }
    }

    var detail: String {
        switch self {
        case .notChecked:
            PetL10n.text("Check GitHub Releases for distributed Blabee versions.", korean: "GitHub Releases에서 배포된 Blabee 버전을 확인합니다.")
        case .checking:
            PetL10n.text("Fetching the latest release information from GitHub Releases.", korean: "GitHub Releases의 최신 배포 정보를 가져오고 있습니다.")
        case .upToDate:
            PetL10n.text("GitHub Releases has no newer release than your current app.", korean: "GitHub Releases에 현재 앱보다 새로운 배포 버전이 없습니다.")
        case .noPublishedRelease:
            PetL10n.text("This repository has no public stable Blabee releases yet.", korean: "이 저장소의 GitHub Releases에 공개된 정식 Blabee 배포 버전이 아직 없습니다.")
        case let .available(release):
            if release.installerAssets != nil {
                PetL10n.text("Choose Update to download and verify the installer. A separate window will guide you to save your work and close connected Codex and Claude sessions before Blabee restarts.", korean: "업데이트를 누르면 설치 파일을 다운로드하고 검증합니다. 별도 창에서 작업 저장과 Codex·Claude 세션 종료를 안내한 뒤 Blabee를 재시작합니다.")
            } else {
                PetL10n.text("Version \(release.version.displayLabel) is available, but no in-app installer could be verified. Check the release page for installation files.", korean: "\(release.version.displayLabel) 버전이 있지만 앱에서 설치할 수 있는 배포 파일을 확인하지 못했습니다. 릴리스 페이지에서 설치본을 확인하세요.")
            }
        case let .unavailable(reason):
            reason
        }
    }

    var symbolName: String {
        switch self {
        case .notChecked: "arrow.triangle.2.circlepath"
        case .checking: "arrow.triangle.2.circlepath"
        case .upToDate: "checkmark.circle.fill"
        case .noPublishedRelease: "info.circle"
        case .available: "arrow.down.circle.fill"
        case .unavailable: "exclamationmark.triangle.fill"
        }
    }

    var latestVersionDisplay: String? { availableRelease?.version.displayLabel }
    var locationActionTitle: String? {
        guard let release = availableRelease, release.installerAssets == nil else { return nil }
        return PetL10n.text("Open Release Page", korean: "릴리스 페이지 열기")
    }
    var isChecking: Bool { self == .checking }
    var isFailure: Bool {
        if case .unavailable = self { return true }
        return false
    }
    var availableRelease: PetAppUpdateRelease? {
        if case let .available(release) = self { return release }
        return nil
    }
}

protocol PetAppUpdateChecking: Sendable {
    var currentVersion: PetAppUpdateVersion? { get }
    func checkForUpdates() async -> PetAppUpdateState
}

struct PetUnavailableAppUpdateChecker: PetAppUpdateChecking {
    let currentVersion: PetAppUpdateVersion?
    let reason: String

    init(
        currentVersion: PetAppUpdateVersion? = nil,
        reason: String = PetL10n.text("This app has no GitHub update repository configured.", korean: "이 앱에는 GitHub 업데이트 저장소가 설정되어 있지 않습니다.")
    ) {
        self.currentVersion = currentVersion
        self.reason = reason
    }

    func checkForUpdates() async -> PetAppUpdateState { .unavailable(reason) }
}

struct PetAppUpdateHTTPResponse: Sendable {
    let statusCode: Int
    let data: Data
    let url: URL
}

struct PetGitHubAppUpdateChecker: PetAppUpdateChecking {
    typealias Fetch = @Sendable (URLRequest) async throws -> PetAppUpdateHTTPResponse

    static let repositoryInfoKey = "BlabeeUpdateRepository"
    static let releaseTagPrefix = "blabee-v"
    static let maximumResponseBytes = 1_048_576
    static let maximumPages = 5
    private static let pageSize = 100
    private static let maximumCheckDuration: TimeInterval = 30

    let currentVersion: PetAppUpdateVersion?
    private let repository: String?
    private let fetch: Fetch

    init(
        currentVersion: PetAppUpdateVersion?,
        repository: String?,
        fetch: @escaping Fetch = PetGitHubAppUpdateChecker.fetchReleasePage
    ) {
        self.currentVersion = currentVersion
        self.repository = repository.flatMap(Self.validatedRepository)
        self.fetch = fetch
    }

    static func live(bundle: Bundle = .main) -> Self {
        let version = (bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
            .flatMap { version in
                (bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
                    .flatMap { PetAppUpdateVersion(version: version, build: $0) }
            }
        return Self(
            currentVersion: version,
            repository: bundle.object(forInfoDictionaryKey: repositoryInfoKey) as? String
        )
    }

    func checkForUpdates() async -> PetAppUpdateState {
        guard !Task.isCancelled else { return .notChecked }
        guard let currentVersion else {
            return .unavailable(PetL10n.text("Unable to read the current app version to compare updates.", korean: "현재 앱의 버전 정보를 읽을 수 없어 업데이트를 비교할 수 없습니다."))
        }
        guard let repository else {
            return .unavailable(PetL10n.text("The GitHub update repository is missing or invalid.", korean: "이 앱의 GitHub 업데이트 저장소가 설정되지 않았거나 올바르지 않습니다."))
        }
        let deadline = ProcessInfo.processInfo.systemUptime + Self.maximumCheckDuration
        var latest: PetAppUpdateRelease?
        do {
            for page in 1...Self.maximumPages {
                try Task.checkCancellation()
                let remaining = deadline - ProcessInfo.processInfo.systemUptime
                guard remaining > 0 else { return Self.timedOut }
                let request = Self.request(
                    repository: repository,
                    page: page,
                    timeout: min(10, remaining)
                )
                let response = try await fetch(request)
                try Task.checkCancellation()
                guard ProcessInfo.processInfo.systemUptime < deadline else { return Self.timedOut }
                guard response.url == request.url else {
                    return .unavailable(PetL10n.text("Unable to verify the GitHub update response address.", korean: "GitHub 업데이트 응답의 주소를 확인할 수 없습니다."))
                }
                guard response.statusCode == 200 else {
                    return Self.httpFailure(response.statusCode)
                }
                guard response.data.count <= Self.maximumResponseBytes else {
                    return .unavailable(PetL10n.text("GitHub release information is too large to check for updates.", korean: "GitHub 배포 정보가 너무 커서 업데이트를 확인하지 못했습니다."))
                }
                let releases = try JSONDecoder().decode([GitHubRelease].self, from: response.data)
                guard releases.count <= Self.pageSize else {
                    return .unavailable(PetL10n.text("Unable to verify the GitHub release list format.", korean: "GitHub 배포 목록의 형식을 확인할 수 없습니다."))
                }
                for release in releases where !release.draft && !release.prerelease {
                    try Task.checkCancellation()
                    guard release.tagName.hasPrefix(Self.releaseTagPrefix) else { continue }
                    guard let version = Self.version(forTag: release.tagName) else {
                        return .unavailable(PetL10n.text("A published Blabee version on GitHub has an invalid format. Check the release information.", korean: "GitHub에 게시된 Blabee 배포 버전 표기가 올바르지 않습니다. 릴리스 정보를 확인하세요."))
                    }
                    if latest.map({ version > $0.version }) ?? true {
                        let installer = Self.installerAssets(
                            release.assets ?? [], version: version,
                            repository: repository, tag: release.tagName
                        )
                        latest = PetAppUpdateRelease(
                            version: version,
                            releaseURL: Self.releaseURL(repository: repository, tag: release.tagName),
                            installerAssets: installer.assets,
                            installerUnavailableReason: installer.reason
                        )
                    }
                }
                if releases.count < Self.pageSize {
                    guard let latest else { return .noPublishedRelease }
                    return latest.version > currentVersion ? .available(latest) : .upToDate
                }
            }
            return .unavailable(PetL10n.text("The GitHub release list exceeds the check limit. Not all versions could be compared, so update status is unknown.", korean: "GitHub 배포 목록이 확인 범위를 초과했습니다. 전체 버전을 비교할 수 없어 최신 여부를 판단하지 않았습니다."))
        } catch is CancellationError {
            return .notChecked
        } catch let error as URLError {
            if Task.isCancelled { return .notChecked }
            if error.code == .timedOut { return Self.timedOut }
            if error.code == .dataLengthExceedsMaximum {
                return .unavailable(PetL10n.text("GitHub release information is too large to check for updates.", korean: "GitHub 배포 정보가 너무 커서 업데이트를 확인하지 못했습니다."))
            }
            return .unavailable(PetL10n.text("Unable to connect to GitHub. Check your internet connection and try again.", korean: "GitHub에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요."))
        } catch {
            if Task.isCancelled { return .notChecked }
            return .unavailable(PetL10n.text("Unable to read GitHub release information. Check again shortly.", korean: "GitHub 배포 정보를 읽을 수 없습니다. 잠시 후 다시 확인하세요."))
        }
    }

    private struct GitHubRelease: Decodable {
        let tagName: String
        let draft: Bool
        let prerelease: Bool
        let assets: [GitHubAsset]?

        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case draft, prerelease, assets
        }
    }

    private struct GitHubAsset: Decodable {
        let name: String
        let state: String
        let size: Int64
        let browserDownloadURL: String

        enum CodingKeys: String, CodingKey {
            case name, state, size
            case browserDownloadURL = "browser_download_url"
        }
    }

    private static func installerAssets(
        _ assets: [GitHubAsset], version: PetAppUpdateVersion,
        repository: String, tag: String
    ) -> (assets: PetAppUpdateInstallerAssets?, reason: String?) {
        let name = AppUpdateDownloadPolicy.diskImageName(version)
        let images = assets.filter { $0.name == name }
        let checksums = assets.filter { $0.name == name + ".sha256" }
        guard !images.isEmpty, !checksums.isEmpty else {
            return (nil, PetL10n.text("The DMG or SHA-256 file for automatic updates is missing from this release.", korean: "자동 업데이트용 DMG 또는 SHA-256 파일이 이 릴리스에 등록되지 않았습니다."))
        }
        guard images.count == 1, checksums.count == 1 else {
            return (nil, PetL10n.text("Duplicate automatic update filenames prevent identifying the installer.", korean: "자동 업데이트 파일 이름이 중복되어 설치본을 확인할 수 없습니다."))
        }
        func validated(_ asset: GitHubAsset, limit: Int64) -> PetAppUpdateAsset? {
            guard asset.state == "uploaded", (1...limit).contains(asset.size),
                  let url = URL(string: asset.browserDownloadURL),
                  AppUpdateDownloadPolicy.isAssetURL(url, repository: repository, tag: tag, name: asset.name)
            else { return nil }
            return PetAppUpdateAsset(name: asset.name, url: url, size: asset.size)
        }
        guard let dmg = validated(images[0], limit: AppUpdateDownloadPolicy.maximumDiskImageBytes),
              let checksum = validated(checksums[0], limit: AppUpdateDownloadPolicy.maximumChecksumBytes)
        else { return (nil, PetL10n.text("Unable to verify the automatic update file's upload status, size, or GitHub address.", korean: "자동 업데이트 파일의 업로드 상태, 크기 또는 GitHub 주소를 확인할 수 없습니다.")) }
        return (PetAppUpdateInstallerAssets(dmg: dmg, checksum: checksum), nil)
    }

    private static func validatedRepository(_ value: String) -> String? {
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let owner = parts[0]
        let repository = parts[1]
        let lettersAndDigits: (UInt8) -> Bool = {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0)
        }
        guard (1...39).contains(owner.utf8.count),
              let first = owner.utf8.first, lettersAndDigits(first),
              let last = owner.utf8.last, lettersAndDigits(last),
              owner.utf8.allSatisfy({ lettersAndDigits($0) || $0 == 45 }),
              (1...100).contains(repository.utf8.count),
              repository != ".", repository != "..",
              repository.utf8.allSatisfy({ lettersAndDigits($0) || [45, 46, 95].contains($0) })
        else { return nil }
        return value
    }

    private static func version(forTag tag: String) -> PetAppUpdateVersion? {
        let parts = tag.dropFirst(releaseTagPrefix.count)
            .components(separatedBy: "+build.")
        guard parts.count == 2 else { return nil }
        return PetAppUpdateVersion(version: parts[0], build: parts[1])
    }

    private static func request(repository: String, page: Int, timeout: TimeInterval) -> URLRequest {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "api.github.com"
        components.path = "/repos/\(repository)/releases"
        components.queryItems = [
            URLQueryItem(name: "per_page", value: String(pageSize)),
            URLQueryItem(name: "page", value: String(page)),
        ]
        // Repository components are restricted to ASCII path-safe slugs above.
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "GET"
        request.timeoutInterval = timeout
        request.httpShouldHandleCookies = false
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2026-03-10", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("Blabee-Update-Check", forHTTPHeaderField: "User-Agent")
        return request
    }

    private static func releaseURL(repository: String, tag: String) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "github.com"
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.")
        let encodedTag = tag.addingPercentEncoding(withAllowedCharacters: allowed)!
        components.percentEncodedPath = "/\(repository)/releases/tag/\(encodedTag)"
        return components.url!
    }

    private static var timedOut: PetAppUpdateState {
        .unavailable(PetL10n.text("The GitHub update check timed out. Try again shortly.", korean: "GitHub 업데이트 확인 시간이 초과됐습니다. 잠시 후 다시 시도하세요."))
    }

    private static func httpFailure(_ status: Int) -> PetAppUpdateState {
        switch status {
        case 403, 429:
            .unavailable(PetL10n.text("GitHub requests are rate-limited. Check for updates again shortly.", korean: "GitHub 요청이 제한되었습니다. 잠시 후 다시 업데이트를 확인하세요."))
        case 404:
            .unavailable(PetL10n.text("Unable to find the GitHub update repository. Check repository visibility and release settings.", korean: "GitHub 업데이트 저장소를 찾을 수 없습니다. 저장소 공개 여부와 배포 설정을 확인하세요."))
        default:
            .unavailable(PetL10n.text("Unable to fetch release information from GitHub. Try again shortly.", korean: "GitHub에서 배포 정보를 가져오지 못했습니다. 잠시 후 다시 시도하세요."))
        }
    }

    private static func fetchReleasePage(_ request: URLRequest) async throws -> PetAppUpdateHTTPResponse {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForRequest = request.timeoutInterval
        configuration.timeoutIntervalForResource = request.timeoutInterval
        let session = URLSession(
            configuration: configuration,
            delegate: PetAppUpdateRedirectBlocker(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse,
              let url = response.url,
              url == request.url
        else { throw URLError(.badServerResponse) }
        guard response.statusCode == 200 else {
            return PetAppUpdateHTTPResponse(statusCode: response.statusCode, data: Data(), url: url)
        }
        guard response.expectedContentLength <= Int64(maximumResponseBytes) else {
            throw URLError(.dataLengthExceedsMaximum)
        }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < maximumResponseBytes else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        return PetAppUpdateHTTPResponse(statusCode: response.statusCode, data: data, url: url)
    }
}

private final class PetAppUpdateRedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
