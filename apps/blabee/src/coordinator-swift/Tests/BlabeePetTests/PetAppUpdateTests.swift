import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Pet app update versions and release checks")
struct PetAppUpdateTests {
    @Test("Version and build ordering is numeric")
    func comparesVersionsNumerically() throws {
        let build9 = try #require(PetAppUpdateVersion(version: "0.1.0", build: "9"))
        let build29 = try #require(PetAppUpdateVersion(version: "0.1.0", build: "29"))
        let build30 = try #require(PetAppUpdateVersion(version: "0.1.0", build: "30"))
        let minor10 = try #require(PetAppUpdateVersion(version: "0.10.0", build: "1"))
        let major1 = try #require(PetAppUpdateVersion(version: "1.0.0", build: "1"))
        #expect([major1, build29, minor10, build9, build30].sorted() == [
            build9, build29, build30, minor10, major1,
        ])
        #expect(build30.displayLabel == "0.1.0 (빌드 30)")
        #expect(build30 == PetAppUpdateVersion(version: "0.1.0", build: "30"))
    }

    @Test("Malformed marketing versions are rejected", arguments: [
        "", "0", "0.1", "0.1.0.0", "00.1.0", "0.01.0", "0.1.00",
        "0.1.-1", "0.1.+1", "0.1.1 ", " 0.1.1", "0.1.１", "0.1.0-beta.1",
        "v0.1.0", "0..0", "18446744073709551616.1.0",
    ])
    func rejectsMalformedVersion(_ version: String) {
        #expect(PetAppUpdateVersion(version: version, build: "30") == nil)
    }

    @Test("Build numbers follow the app assembler contract", arguments: [
        "", "0", "00", "01", "+1", "-1", "1.0", "10000", "1 ", " 1", "１",
        "18446744073709551616",
    ])
    func rejectsMalformedBuild(_ build: String) {
        #expect(PetAppUpdateVersion(version: "0.1.0", build: build) == nil)
    }

    @Test("Only an available release offers navigation")
    func exposesReleaseNavigationOnlyWhenAvailable() throws {
        let release = PetAppUpdateRelease(
            version: try #require(PetAppUpdateVersion(version: "0.1.0", build: "30")),
            releaseURL: try #require(URL(string: "https://github.com/example/blabee/releases/tag/v0.1.0"))
        )
        let available = PetAppUpdateState.available(release)
        #expect(available.availableRelease == release)
        #expect(available.latestVersionDisplay == "0.1.0 (빌드 30)")
        #expect(available.locationActionTitle == "릴리스 페이지 열기")
        for state in [
            PetAppUpdateState.notChecked, .checking, .upToDate, .noPublishedRelease,
            .unavailable("연결 실패"),
        ] {
            #expect(state.availableRelease == nil)
            #expect(state.locationActionTitle == nil)
            #expect(state.latestVersionDisplay == nil)
        }
        #expect(PetAppUpdateState.checking.isChecking)
        #expect(PetAppUpdateState.unavailable("연결 실패").isFailure)
        #expect(!PetAppUpdateState.upToDate.isFailure)
    }

    @Test("A newer build is offered with a trusted release URL and an unauthenticated request")
    func offersNewerBuild() async throws {
        let response = try releaseData([
            release("blabee-v0.1.0+build.9"),
            release("blabee-v0.1.0+build.30", htmlURL: "https://untrusted.example/download"),
            release("blabee-v0.1.0+build.29"),
        ])
        let transport = PetAppUpdateFixtureTransport([.init(data: response)])
        let checker = try checker(transport: transport)
        let state = await checker.checkForUpdates()
        let update = try #require(state.availableRelease)
        #expect(update.version == PetAppUpdateVersion(version: "0.1.0", build: "30"))
        #expect(update.releaseURL.absoluteString ==
            "https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.30")
        let requests = await transport.requests
        #expect(requests.count == 1)
        let request = try #require(requests.first)
        #expect(request.url?.absoluteString ==
            "https://api.github.com/repos/Hyunwoojooo/biadone/releases?per_page=100&page=1")
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
        #expect(request.value(forHTTPHeaderField: "Accept") == "application/vnd.github+json")
        #expect(request.value(forHTTPHeaderField: "X-GitHub-Api-Version") == "2026-03-10")
        #expect(request.httpShouldHandleCookies == false)
        #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
        #expect(request.timeoutInterval <= 10)
    }

    @Test("The same or a newer installed build is up to date", arguments: ["30", "31", "9999"])
    func recognizesCurrentOrNewerInstalledBuild(_ build: String) async throws {
        let transport = PetAppUpdateFixtureTransport([
            .init(data: try releaseData([release("blabee-v0.1.0+build.30")]))
        ])
        let checker = try checker(transport: transport, build: build)
        #expect(await checker.checkForUpdates() == .upToDate)
    }

    @Test("All pages are compared numerically across marketing versions and builds")
    func comparesEveryPage() async throws {
        var firstPage = (0..<98).map { release("blabase-v1.0.\($0)") }
        firstPage.append(release("blabee-v0.1.0+build.9999"))
        firstPage.append(release("blabee-v0.2.0+build.9"))
        let transport = PetAppUpdateFixtureTransport([
            .init(data: try releaseData(firstPage)),
            .init(data: try releaseData([
                release("blabee-v0.2.0+build.30"), release("blabee-v0.2.0+build.29"),
            ])),
        ])
        let checker = try checker(transport: transport)
        let state = await checker.checkForUpdates()
        #expect(state.availableRelease?.version == PetAppUpdateVersion(version: "0.2.0", build: "30"))
        let requests = await transport.requests
        #expect(requests.count == 2)
        #expect(requests.last?.url?.query == "per_page=100&page=2")
    }

    @Test("A full last permitted page fails instead of claiming a complete comparison")
    func rejectsIncompletePagination() async throws {
        let page = try releaseData((0..<100).map { release("blabase-v1.0.\($0)") })
        let transport = PetAppUpdateFixtureTransport(
            Array(repeating: .init(data: page), count: PetGitHubAppUpdateChecker.maximumPages)
        )
        let checker = try checker(transport: transport)
        let state = await checker.checkForUpdates()
        #expect(state.isFailure)
        #expect(state.detail.contains("확인 범위"))
        #expect(await transport.requests.count == PetGitHubAppUpdateChecker.maximumPages)
    }

    @Test("A later failed page never uses an earlier available candidate")
    func rejectsPartialResultsAfterPageFailure() async throws {
        var firstPage = (0..<99).map { release("other-v\($0)") }
        firstPage.append(release("blabee-v0.1.0+build.30"))
        let transport = PetAppUpdateFixtureTransport([
            .init(data: try releaseData(firstPage)),
            .init(statusCode: 500, data: Data()),
        ])
        let checker = try checker(transport: transport)
        let state = await checker.checkForUpdates()
        #expect(state.isFailure)
        #expect(state.availableRelease == nil)
        #expect(await transport.requests.count == 2)
    }

    @Test("Unrelated, draft and prerelease tags are excluded")
    func ignoresIneligibleReleases() async throws {
        let transport = PetAppUpdateFixtureTransport([
            .init(data: try releaseData([
                release("blabase-v99.0.0"),
                release("blabee-v99.0.0+build.99", draft: true),
                release("blabee-v99.0.0-beta", prerelease: true),
                release("blabee-v0.1.0+build.29"),
            ])),
        ])
        let checker = try checker(transport: transport)
        #expect(await checker.checkForUpdates() == .upToDate)
    }

    @Test("No eligible public release is reported distinctly from latest", arguments: [false, true])
    func reportsNoPublishedRelease(_ includeUnrelated: Bool) async throws {
        let records = includeUnrelated ? [
            release("blabase-v1.0.0"), release("blabee-v0.2.0", prerelease: true),
        ] : []
        let transport = PetAppUpdateFixtureTransport([.init(data: try releaseData(records))])
        let checker = try checker(transport: transport)
        let state = await checker.checkForUpdates()
        #expect(state == .noPublishedRelease)
        #expect(state.title == "등록된 배포 버전이 없습니다")
        #expect(!state.isFailure)
    }

    @Test("Malformed stable Blabee tags prevent a false latest result", arguments: [
        "blabee-v0.1.0", "blabee-v0.1.0+build.0", "blabee-v0.1.0+build.030",
        "blabee-v0.1.0+build.10000", "blabee-v0.1.0+build.30+build.31",
        "blabee-v0.1.0+build.30/redirect", "blabee-v0.1.0+build.30?redirect=1",
        "blabee-v0.1.0+build.30#fragment", "blabee-v0.01.0+build.30", "blabee-v",
    ])
    func rejectsMalformedStableBlabeeTag(_ tag: String) async throws {
        let transport = PetAppUpdateFixtureTransport([
            .init(data: try releaseData([release("blabee-v0.1.0+build.29"), release(tag)])),
        ])
        let checker = try checker(transport: transport)
        let state = await checker.checkForUpdates()
        #expect(state.isFailure)
        #expect(state.detail.contains("버전 표기"))
    }

    @Test("HTTP failures never claim latest", arguments: [301, 302, 403, 404, 429, 500])
    func reportsHTTPFailures(_ status: Int) async throws {
        let transport = PetAppUpdateFixtureTransport([.init(statusCode: status, data: Data())])
        let checker = try checker(transport: transport)
        let state = await checker.checkForUpdates()
        #expect(state.isFailure)
        #expect(state.availableRelease == nil)
        if status == 403 || status == 429 { #expect(state.detail.contains("제한")) }
        if status == 404 { #expect(state.detail.contains("저장소")) }
    }

    @Test("Network failures and timeout stay unavailable", arguments: [
        URLError.notConnectedToInternet, URLError.timedOut, URLError.dataLengthExceedsMaximum,
    ])
    func reportsNetworkFailure(_ code: URLError.Code) async throws {
        let currentVersion: PetAppUpdateVersion = try #require(
            PetAppUpdateVersion(version: "0.1.0", build: "29")
        )
        let checker = PetGitHubAppUpdateChecker(
            currentVersion: currentVersion,
            repository: "Hyunwoojooo/biadone",
            fetch: { _ in throw URLError(code) }
        )
        let state = await checker.checkForUpdates()
        #expect(state.isFailure)
        if code == .timedOut { #expect(state.detail.contains("시간이 초과")) }
        if code == .dataLengthExceedsMaximum { #expect(state.detail.contains("너무 커서")) }
    }

    @Test("Cancellation does not leave a stale update result")
    func clearsCancelledCheck() async throws {
        let currentVersion: PetAppUpdateVersion = try #require(
            PetAppUpdateVersion(version: "0.1.0", build: "29")
        )
        let checker = PetGitHubAppUpdateChecker(
            currentVersion: currentVersion,
            repository: "Hyunwoojooo/biadone",
            fetch: { _ in throw CancellationError() }
        )
        #expect(await checker.checkForUpdates() == .notChecked)
    }

    @Test("Malformed JSON and oversized responses stay unavailable")
    func rejectsInvalidResponseBodies() async throws {
        let bodies = [
            Data("not-json".utf8),
            Data("{}".utf8),
            Data("[{\"tag_name\":\"blabee-v0.1.0+build.30\"}]".utf8),
            Data(repeating: 32, count: PetGitHubAppUpdateChecker.maximumResponseBytes + 1),
            try releaseData((0..<101).map { release("other-\($0)") }),
        ]
        for body in bodies {
            let transport = PetAppUpdateFixtureTransport([.init(data: body)])
            let checker = try checker(transport: transport)
            #expect(await checker.checkForUpdates().isFailure)
        }
    }

    @Test("Redirected and foreign response URLs are rejected", arguments: [
        "https://untrusted.example/releases", "http://api.github.com/repos/Hyunwoojooo/biadone/releases",
        "https://api.github.com/repos/other/repo/releases?per_page=100&page=1",
    ])
    func rejectsUnexpectedResponseURL(_ url: String) async throws {
        let responseURL: URL = try #require(URL(string: url))
        let transport = PetAppUpdateFixtureTransport([
            .init(data: try releaseData([release("blabee-v0.1.0+build.30")]), url: responseURL),
        ])
        let checker = try checker(transport: transport)
        #expect(await checker.checkForUpdates().isFailure)
    }

    @Test("Unconfigured and unsafe repository names never perform a request", arguments: [
        "", "owner", "/owner/repo", "owner/repo/extra", "../repo", "owner/..",
        "https://github.com/owner/repo", "owner/repo?token=secret", "owner/repo#fragment",
        "owner/repo%2Fextra", "owner /repo", "-owner/repo", "owner-/repo", "owner/한글",
    ])
    func rejectsUnsafeRepository(_ repository: String) async throws {
        let transport = PetAppUpdateFixtureTransport([])
        let currentVersion: PetAppUpdateVersion = try #require(
            PetAppUpdateVersion(version: "0.1.0", build: "29")
        )
        let checker = PetGitHubAppUpdateChecker(
            currentVersion: currentVersion,
            repository: repository,
            fetch: { request in try await transport.fetch(request) }
        )
        #expect(await checker.checkForUpdates().isFailure)
        #expect(await transport.requests.isEmpty)
    }

    @Test("Unreadable current version and missing repository do not fabricate a version")
    func rejectsMissingConfiguration() async throws {
        let transport = PetAppUpdateFixtureTransport([])
        let currentVersion: PetAppUpdateVersion = try #require(
            PetAppUpdateVersion(version: "0.1.0", build: "29")
        )
        let unreadable = PetGitHubAppUpdateChecker(
            currentVersion: nil,
            repository: "Hyunwoojooo/biadone",
            fetch: { request in try await transport.fetch(request) }
        )
        let unconfigured = PetGitHubAppUpdateChecker(
            currentVersion: currentVersion,
            repository: nil,
            fetch: { request in try await transport.fetch(request) }
        )
        #expect(unreadable.currentVersion == nil)
        #expect(await unreadable.checkForUpdates().isFailure)
        #expect(await unconfigured.checkForUpdates().isFailure)
        #expect(await transport.requests.isEmpty)
        #expect(await PetUnavailableAppUpdateChecker().checkForUpdates().isFailure)
    }

    private func checker(
        transport: PetAppUpdateFixtureTransport,
        version: String = "0.1.0",
        build: String = "29"
    ) throws -> PetGitHubAppUpdateChecker {
        let currentVersion: PetAppUpdateVersion = try #require(
            PetAppUpdateVersion(version: version, build: build)
        )
        return PetGitHubAppUpdateChecker(
            currentVersion: currentVersion,
            repository: "Hyunwoojooo/biadone",
            fetch: { request in try await transport.fetch(request) }
        )
    }

    private func release(
        _ tag: String,
        draft: Bool = false,
        prerelease: Bool = false,
        htmlURL: String = "https://github.com/Hyunwoojooo/biadone/releases"
    ) -> [String: Any] {
        ["tag_name": tag, "draft": draft, "prerelease": prerelease, "html_url": htmlURL]
    }

    private func releaseData(_ releases: [[String: Any]]) throws -> Data {
        try JSONSerialization.data(withJSONObject: releases)
    }
}

private struct PetAppUpdateFixtureResponse: Sendable {
    var statusCode = 200
    let data: Data
    var url: URL? = nil
}

private actor PetAppUpdateFixtureTransport {
    private var responses: [PetAppUpdateFixtureResponse]
    private(set) var requests: [URLRequest] = []

    init(_ responses: [PetAppUpdateFixtureResponse]) { self.responses = responses }

    func fetch(_ request: URLRequest) throws -> PetAppUpdateHTTPResponse {
        requests.append(request)
        guard !responses.isEmpty, let url = request.url else { throw URLError(.badServerResponse) }
        let response = responses.removeFirst()
        return PetAppUpdateHTTPResponse(
            statusCode: response.statusCode,
            data: response.data,
            url: response.url ?? url
        )
    }
}
