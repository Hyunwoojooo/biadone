import Foundation
import XCTest
@testable import BlabaseLauncher

@MainActor
final class LauncherRootContextTests: XCTestCase {
    private let rootA = "root_11111111111111111111111111111111"
    private let rootB = "root_22222222222222222222222222222222"

    func testDecodesStrictLauncherStatusContract() throws {
        let readOnly = try decodeAgentStatus(
            agentStatusObject(
                rootId: nil,
                sourceMode: "read_only",
                mutationAuthority: "none",
                syncRevision: nil
            )
        )
        XCTAssertNil(readOnly.rootId)
        XCTAssertEqual(readOnly.sourceMode, .readOnly)
        XCTAssertEqual(readOnly.mutationAuthority, .none)
        XCTAssertNil(readOnly.syncRevision)

        let managed = try decodeAgentStatus(
            agentStatusObject(
                rootId: rootA,
                sourceMode: "managed",
                mutationAuthority: "launcher_agent",
                syncRevision: "sync:2026-08-05.1"
            )
        )
        XCTAssertEqual(managed.rootId, rootA)
        XCTAssertEqual(managed.sourceMode, .managed)
        XCTAssertEqual(managed.mutationAuthority, .launcherAgent)
    }

    func testLauncherStatusRejectsUnknownOrMissingFields() throws {
        var extra = agentStatusObject(
            rootId: rootA,
            sourceMode: "read_only",
            mutationAuthority: "none",
            syncRevision: "sync-1"
        )
        extra["dataRootPath"] = "/private/root"
        XCTAssertThrowsError(try decodeAgentStatus(extra))

        var missing = agentStatusObject(
            rootId: rootA,
            sourceMode: "read_only",
            mutationAuthority: "none",
            syncRevision: "sync-1"
        )
        missing.removeValue(forKey: "syncRevision")
        XCTAssertThrowsError(try decodeAgentStatus(missing))
    }

    func testLauncherStatusRejectsInvalidAuthorityAndIdentityInvariants() throws {
        let invalidObjects = [
            agentStatusObject(
                rootId: nil,
                sourceMode: "managed",
                mutationAuthority: "launcher_agent",
                syncRevision: nil
            ),
            agentStatusObject(
                rootId: rootA,
                sourceMode: "managed",
                mutationAuthority: "none",
                syncRevision: nil
            ),
            agentStatusObject(
                rootId: rootA,
                sourceMode: "read_only",
                mutationAuthority: "launcher_agent",
                syncRevision: nil
            ),
            agentStatusObject(
                rootId: "root_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                sourceMode: "read_only",
                mutationAuthority: "none",
                syncRevision: nil
            ),
            agentStatusObject(
                rootId: rootA,
                sourceMode: "unknown",
                mutationAuthority: "none",
                syncRevision: nil
            )
        ]

        for object in invalidObjects {
            XCTAssertThrowsError(try decodeAgentStatus(object))
        }
    }

    func testRootContextsBoundSyncRevisionSyntaxAndLength() throws {
        for invalidRevision in [
            "",
            "-starts-with-punctuation",
            "contains space",
            "ends-with-newline\n",
            String(repeating: "a", count: 129)
        ] {
            XCTAssertThrowsError(
                try decodeAgentStatus(
                    agentStatusObject(
                        rootId: rootA,
                        sourceMode: "read_only",
                        mutationAuthority: "none",
                        syncRevision: invalidRevision
                    )
                )
            )
            XCTAssertThrowsError(
                try decodeDashboardContext(
                    dashboardContextObject(
                        rootId: rootA,
                        syncRevision: invalidRevision
                    )
                )
            )
        }

        let maximumRevision = String(repeating: "a", count: 128)
        XCTAssertEqual(
            try decodeAgentStatus(
                agentStatusObject(
                    rootId: rootA,
                    sourceMode: "read_only",
                    mutationAuthority: "none",
                    syncRevision: maximumRevision
                )
            ).syncRevision,
            maximumRevision
        )
    }

    func testDashboardContextRejectsUnknownFieldsAndAuthority() throws {
        let valid = try decodeDashboardContext(
            dashboardContextObject(rootId: rootA, syncRevision: "sync-1")
        )
        XCTAssertEqual(valid.rootId, rootA)
        XCTAssertEqual(valid.mutationAuthority, .dashboard)

        var extra = dashboardContextObject(
            rootId: rootA,
            syncRevision: "sync-1"
        )
        extra["dataRootPath"] = "/private/root"
        XCTAssertThrowsError(try decodeDashboardContext(extra))

        var missing = dashboardContextObject(
            rootId: rootA,
            syncRevision: "sync-1"
        )
        missing.removeValue(forKey: "syncRevision")
        XCTAssertThrowsError(try decodeDashboardContext(missing))

        var invalidAuthority = dashboardContextObject(
            rootId: rootA,
            syncRevision: "sync-1"
        )
        invalidAuthority["mutationAuthority"] = "none"
        XCTAssertThrowsError(try decodeDashboardContext(invalidAuthority))
    }

    func testNavigationRequiresMatchingRootAndRevision() throws {
        let matchingAgent = try decodeAgentStatus(
            agentStatusObject(
                rootId: rootA,
                sourceMode: "read_only",
                mutationAuthority: "none",
                syncRevision: "sync-1"
            )
        )
        let matchingDashboard = try decodeDashboardContext(
            dashboardContextObject(rootId: rootA, syncRevision: "sync-1")
        )
        XCTAssertEqual(
            LauncherSourceNavigationPolicy.evaluate(
                agentStatus: matchingAgent,
                dashboardContext: matchingDashboard
            ),
            .allowed
        )

        let otherRoot = try decodeDashboardContext(
            dashboardContextObject(rootId: rootB, syncRevision: "sync-1")
        )
        XCTAssertEqual(
            LauncherSourceNavigationPolicy.evaluate(
                agentStatus: matchingAgent,
                dashboardContext: otherRoot
            ),
            .blocked(.rootMismatch)
        )

        let otherRevision = try decodeDashboardContext(
            dashboardContextObject(rootId: rootA, syncRevision: "sync-2")
        )
        XCTAssertEqual(
            LauncherSourceNavigationPolicy.evaluate(
                agentStatus: matchingAgent,
                dashboardContext: otherRevision
            ),
            .blocked(.syncRevisionMismatch)
        )

        let nilRevisionAgent = try decodeAgentStatus(
            agentStatusObject(
                rootId: rootA,
                sourceMode: "read_only",
                mutationAuthority: "none",
                syncRevision: nil
            )
        )
        let nilRevisionDashboard = try decodeDashboardContext(
            dashboardContextObject(rootId: rootA, syncRevision: nil)
        )
        XCTAssertTrue(
            LauncherSourceNavigationPolicy.allowsSourceNavigation(
                agentStatus: nilRevisionAgent,
                dashboardContext: nilRevisionDashboard
            )
        )
    }

    func testManagedHandshakeShortCircuitsWithoutDashboardCall() async throws {
        let managed = try decodeAgentStatus(
            agentStatusObject(
                rootId: rootA,
                sourceMode: "managed",
                mutationAuthority: "launcher_agent",
                syncRevision: "sync-1"
            )
        )
        let dashboard = try decodeDashboardContext(
            dashboardContextObject(rootId: rootA, syncRevision: "sync-1")
        )
        var dashboardCalls = 0

        let decision = try await LauncherSourceNavigationHandshake.evaluate(
            getAgentStatus: { managed },
            getDashboardContext: {
                dashboardCalls += 1
                return dashboard
            }
        )

        XCTAssertEqual(decision, .blocked(.readOnlyRootRequired))
        XCTAssertEqual(dashboardCalls, 0)
    }

    func testFirstUseReadOnlyHandshakePublishesThenRereadsStatus() async throws {
        let initial = try decodeAgentStatus(
            agentStatusObject(
                rootId: nil,
                sourceMode: "read_only",
                mutationAuthority: "none",
                syncRevision: "sync-1"
            )
        )
        let refreshed = try decodeAgentStatus(
            agentStatusObject(
                rootId: rootA,
                sourceMode: "read_only",
                mutationAuthority: "none",
                syncRevision: "sync-1"
            )
        )
        let dashboard = try decodeDashboardContext(
            dashboardContextObject(rootId: rootA, syncRevision: "sync-1")
        )
        var events: [String] = []
        var statuses = [initial, refreshed]

        let decision = try await LauncherSourceNavigationHandshake.evaluate(
            getAgentStatus: {
                events.append("agent")
                return statuses.removeFirst()
            },
            getDashboardContext: {
                events.append("dashboard")
                return dashboard
            }
        )

        XCTAssertEqual(events, ["agent", "dashboard", "agent"])
        XCTAssertTrue(statuses.isEmpty)
        XCTAssertEqual(decision, .allowed)
    }

    func testBuildsOnlyFixedSourceDestinations() throws {
        let baseURL = try XCTUnwrap(URL(string: "http://localhost:3102"))
        let destinations: [(AttentionSource, String)] = [
            (
                .github,
                "http://localhost:3102/sources?source=github&entry=launcher#source-github"
            ),
            (
                .codex,
                "http://localhost:3102/sources?source=codex&entry=launcher#source-codex"
            ),
            (
                .notion,
                "http://localhost:3102/sources?source=notion&entry=launcher#source-notion"
            ),
            (
                .googleCalendar,
                "http://localhost:3102/sources?source=google-calendar&entry=launcher#source-google-calendar"
            )
        ]

        for (source, expected) in destinations {
            let url = try XCTUnwrap(
                SafeURLPolicy.sourceConnectionURL(
                    for: source,
                    baseURL: baseURL
                )
            )
            XCTAssertEqual(url.absoluteString, expected)
            XCTAssertFalse(url.absoluteString.contains("root_"))
            XCTAssertFalse(url.absoluteString.contains("returnTo"))
        }
        XCTAssertEqual(
            SafeURLPolicy.dashboardRootContextURL(baseURL: baseURL)?
                .absoluteString,
            "http://localhost:3102/api/system/root-context"
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardURL(
                path: "/sources?returnTo=/private",
                baseURL: baseURL
            )
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardURL(
                path: "/sources#arbitrary",
                baseURL: baseURL
            )
        )
        XCTAssertNil(
            SafeURLPolicy.sourceConnectionURL(
                for: .github,
                baseURL: URL(string: "https://evil.example")!
            )
        )
    }

    func testDashboardClientUsesFixedRootContextEndpoint() async throws {
        let baseURL = try XCTUnwrap(URL(string: "http://localhost:3102"))
        let endpoint = try XCTUnwrap(
            SafeURLPolicy.dashboardRootContextURL(baseURL: baseURL)
        )
        let data = try jsonData(
            dashboardContextObject(rootId: rootA, syncRevision: "sync-1")
        )
        var capturedRequest: URLRequest?
        let client = DashboardRootContextClient { request in
            capturedRequest = request
            return (
                data,
                try XCTUnwrap(
                    HTTPURLResponse(
                        url: endpoint,
                        statusCode: 200,
                        httpVersion: nil,
                        headerFields: ["Content-Type": "application/json"]
                    )
                )
            )
        }

        let context = try await client.getRootContext(baseURL: baseURL)

        XCTAssertEqual(context.rootId, rootA)
        XCTAssertEqual(capturedRequest?.url, endpoint)
        XCTAssertEqual(capturedRequest?.httpMethod, "GET")
        XCTAssertNil(capturedRequest?.httpBody)
        XCTAssertEqual(
            capturedRequest?.value(forHTTPHeaderField: "Accept"),
            "application/json"
        )
    }

    func testDashboardClientRejectsRedirectNonSuccessAndOversize() async throws {
        let baseURL = try XCTUnwrap(URL(string: "http://localhost:3102"))
        let endpoint = try XCTUnwrap(
            SafeURLPolicy.dashboardRootContextURL(baseURL: baseURL)
        )
        let validData = try jsonData(
            dashboardContextObject(rootId: rootA, syncRevision: "sync-1")
        )

        let redirected = DashboardRootContextClient { _ in
            (
                validData,
                try XCTUnwrap(
                    HTTPURLResponse(
                        url: URL(string: "http://localhost:3102/login")!,
                        statusCode: 200,
                        httpVersion: nil,
                        headerFields: nil
                    )
                )
            )
        }
        await assertClientError(
            .invalidResponse,
            client: redirected,
            baseURL: baseURL
        )

        let nonSuccess = DashboardRootContextClient { _ in
            (
                validData,
                try XCTUnwrap(
                    HTTPURLResponse(
                        url: endpoint,
                        statusCode: 503,
                        httpVersion: nil,
                        headerFields: nil
                    )
                )
            )
        }
        await assertClientError(
            .invalidResponse,
            client: nonSuccess,
            baseURL: baseURL
        )

        let oversize = DashboardRootContextClient { _ in
            (
                Data(repeating: 0x20, count: 16 * 1_024 + 1),
                try XCTUnwrap(
                    HTTPURLResponse(
                        url: endpoint,
                        statusCode: 200,
                        httpVersion: nil,
                        headerFields: nil
                    )
                )
            )
        }
        await assertClientError(
            .responseTooLarge,
            client: oversize,
            baseURL: baseURL
        )
    }

    func testConfigurationChangeCancelsSourceNavigationBeforeOpeningURL() async throws {
        let status = try decodeAgentStatus(
            agentStatusObject(
                rootId: rootA,
                sourceMode: "read_only",
                mutationAuthority: "none",
                syncRevision: "sync-1"
            )
        )
        let dashboardClient = DashboardRootContextClient { _ in
            try await Task.sleep(nanoseconds: 10_000_000_000)
            throw CancellationError()
        }
        var openedURLs: [URL] = []
        let viewModel = LauncherViewModel(
            dashboardRootContextClient: dashboardClient,
            agentStatusProvider: { status },
            sourceURLOpener: { url in
                openedURLs.append(url)
                return true
            },
            dashboardBaseURLProvider: {
                URL(string: "http://localhost:3102")
            },
            sourceModeProvider: { .readOnly }
        )

        viewModel.openSourceConnections(.github)
        for _ in 0..<10 where !viewModel.isResolvingSourceNavigation {
            await Task.yield()
        }
        XCTAssertTrue(viewModel.isResolvingSourceNavigation)

        try await viewModel.stopForConfigurationChange()
        await Task.yield()

        XCTAssertFalse(viewModel.isResolvingSourceNavigation)
        XCTAssertTrue(openedURLs.isEmpty)
    }

    private func assertClientError(
        _ expected: DashboardRootContextClientError,
        client: DashboardRootContextClient,
        baseURL: URL
    ) async {
        do {
            _ = try await client.getRootContext(baseURL: baseURL)
            XCTFail("Expected dashboard root-context client error.")
        } catch {
            XCTAssertEqual(error as? DashboardRootContextClientError, expected)
        }
    }

    private func decodeAgentStatus(
        _ object: [String: Any]
    ) throws -> LauncherAgentStatus {
        try JSONDecoder().decode(
            LauncherAgentStatus.self,
            from: jsonData(object)
        )
    }

    private func decodeDashboardContext(
        _ object: [String: Any]
    ) throws -> DashboardRootContext {
        try JSONDecoder().decode(
            DashboardRootContext.self,
            from: jsonData(object)
        )
    }

    private func jsonData(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: object,
            options: [.sortedKeys]
        )
    }

    private func agentStatusObject(
        rootId: String?,
        sourceMode: String,
        mutationAuthority: String,
        syncRevision: String?
    ) -> [String: Any] {
        [
            "contract": LauncherAgentStatus.contract,
            "rootId": rootId.map { $0 as Any } ?? NSNull(),
            "sourceMode": sourceMode,
            "mutationAuthority": mutationAuthority,
            "syncRevision": syncRevision.map { $0 as Any } ?? NSNull()
        ]
    }

    private func dashboardContextObject(
        rootId: String,
        syncRevision: String?
    ) -> [String: Any] {
        [
            "contract": DashboardRootContext.contract,
            "rootId": rootId,
            "mutationAuthority": "dashboard",
            "syncRevision": syncRevision.map { $0 as Any } ?? NSNull()
        ]
    }
}
