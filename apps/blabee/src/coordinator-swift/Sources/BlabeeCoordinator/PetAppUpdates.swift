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

    var displayLabel: String { "\(version) (빌드 \(build))" }

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

struct PetAppUpdateRelease: Equatable, Sendable {
    let version: PetAppUpdateVersion
    let releaseURL: URL
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
        case .notChecked: "업데이트 확인"
        case .checking: "업데이트 확인 중"
        case .upToDate: "최신 버전입니다"
        case .noPublishedRelease: "등록된 배포 버전이 없습니다"
        case .available: "업데이트할 수 있습니다"
        case .unavailable: "업데이트를 확인하지 못했습니다"
        }
    }

    var detail: String {
        switch self {
        case .notChecked:
            "GitHub Releases에서 배포된 Blabee 버전을 확인합니다."
        case .checking:
            "GitHub Releases의 최신 배포 정보를 가져오고 있습니다."
        case .upToDate:
            "GitHub Releases에 현재 앱보다 새로운 배포 버전이 없습니다."
        case .noPublishedRelease:
            "이 저장소의 GitHub Releases에 공개된 정식 Blabee 배포 버전이 아직 없습니다."
        case let .available(release):
            "\(release.version.displayLabel) 버전이 있습니다. 릴리스 페이지에서 변경 내용과 설치본을 확인하세요."
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
    var locationActionTitle: String? { availableRelease == nil ? nil : "릴리스 페이지 열기" }
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
        reason: String = "이 앱에는 GitHub 업데이트 저장소가 설정되어 있지 않습니다."
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
            return .unavailable("현재 앱의 버전 정보를 읽을 수 없어 업데이트를 비교할 수 없습니다.")
        }
        guard let repository else {
            return .unavailable("이 앱의 GitHub 업데이트 저장소가 설정되지 않았거나 올바르지 않습니다.")
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
                    return .unavailable("GitHub 업데이트 응답의 주소를 확인할 수 없습니다.")
                }
                guard response.statusCode == 200 else {
                    return Self.httpFailure(response.statusCode)
                }
                guard response.data.count <= Self.maximumResponseBytes else {
                    return .unavailable("GitHub 배포 정보가 너무 커서 업데이트를 확인하지 못했습니다.")
                }
                let releases = try JSONDecoder().decode([GitHubRelease].self, from: response.data)
                guard releases.count <= Self.pageSize else {
                    return .unavailable("GitHub 배포 목록의 형식을 확인할 수 없습니다.")
                }
                for release in releases where !release.draft && !release.prerelease {
                    try Task.checkCancellation()
                    guard release.tagName.hasPrefix(Self.releaseTagPrefix) else { continue }
                    guard let version = Self.version(forTag: release.tagName) else {
                        return .unavailable("GitHub에 게시된 Blabee 배포 버전 표기가 올바르지 않습니다. 릴리스 정보를 확인하세요.")
                    }
                    if latest.map({ version > $0.version }) ?? true {
                        latest = PetAppUpdateRelease(
                            version: version,
                            releaseURL: Self.releaseURL(repository: repository, tag: release.tagName)
                        )
                    }
                }
                if releases.count < Self.pageSize {
                    guard let latest else { return .noPublishedRelease }
                    return latest.version > currentVersion ? .available(latest) : .upToDate
                }
            }
            return .unavailable("GitHub 배포 목록이 확인 범위를 초과했습니다. 전체 버전을 비교할 수 없어 최신 여부를 판단하지 않았습니다.")
        } catch is CancellationError {
            return .notChecked
        } catch let error as URLError {
            if Task.isCancelled { return .notChecked }
            if error.code == .timedOut { return Self.timedOut }
            if error.code == .dataLengthExceedsMaximum {
                return .unavailable("GitHub 배포 정보가 너무 커서 업데이트를 확인하지 못했습니다.")
            }
            return .unavailable("GitHub에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.")
        } catch {
            if Task.isCancelled { return .notChecked }
            return .unavailable("GitHub 배포 정보를 읽을 수 없습니다. 잠시 후 다시 확인하세요.")
        }
    }

    private struct GitHubRelease: Decodable {
        let tagName: String
        let draft: Bool
        let prerelease: Bool

        enum CodingKeys: String, CodingKey {
            case tagName = "tag_name"
            case draft, prerelease
        }
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
        .unavailable("GitHub 업데이트 확인 시간이 초과됐습니다. 잠시 후 다시 시도하세요.")
    }

    private static func httpFailure(_ status: Int) -> PetAppUpdateState {
        switch status {
        case 403, 429:
            .unavailable("GitHub 요청이 제한되었습니다. 잠시 후 다시 업데이트를 확인하세요.")
        case 404:
            .unavailable("GitHub 업데이트 저장소를 찾을 수 없습니다. 저장소 공개 여부와 배포 설정을 확인하세요.")
        default:
            .unavailable("GitHub에서 배포 정보를 가져오지 못했습니다. 잠시 후 다시 시도하세요.")
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
