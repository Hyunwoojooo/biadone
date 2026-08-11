import Foundation
import XCTest
@testable import BlabaseLauncher

@MainActor
final class LauncherModelsTests: XCTestCase {
    func testUsesShiftSpaceAsTheGlobalShortcut() throws {
        XCTAssertEqual(LauncherShortcut.displayName, "⇧ Space")
    }

    func testBuildsAgentCompatibleRequestID() throws {
        let requestID = LauncherIPC.requestID(
            uuid: UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        )

        XCTAssertEqual(
            requestID,
            "request-11111111-2222-3333-4444-555555555555"
        )
        XCTAssertNotNil(
            requestID.range(
                of: #"^[A-Za-z0-9._:-]+$"#,
                options: .regularExpression
            )
        )
    }

    func testRemovesRuntimeInjectionVariablesFromChildEnvironment() throws {
        let environment = LauncherRuntimeConfiguration.sanitizedChildEnvironment([
            "PATH": "/usr/bin",
            "GITHUB_APP_CLIENT_ID": "expected-connector-config",
            "NODE_OPTIONS": "--require=/tmp/untrusted.js",
            "NODE_PATH": "/tmp/untrusted-modules",
            "DYLD_INSERT_LIBRARIES": "/tmp/untrusted.dylib",
            "LD_PRELOAD": "/tmp/untrusted.dylib",
            "BLABASE_LAUNCHER_AGENT_EXECUTABLE": "/tmp/untrusted",
            "BLABASE_LAUNCHER_DATA_ROOT": "/tmp/private-root",
            "BLABASE_DASHBOARD_URL": "http://localhost:3102",
            "BLABASE_SHOW_ON_LAUNCH": "1",
            "BLABASE_LAUNCHER_SOURCE_MODE": "managed",
            "BLABASE_CODE_COMMIT_SHA": String(repeating: "a", count: 40),
            "BLABASE_CODE_FINGERPRINT_SHA256": String(repeating: "b", count: 64),
            "CF_PAGES_COMMIT_SHA": String(repeating: "c", count: 40),
            "VERCEL_GIT_COMMIT_SHA": String(repeating: "d", count: 40),
            "GITHUB_SHA": String(repeating: "e", count: 40)
        ])

        XCTAssertEqual(environment["PATH"], "/usr/bin")
        XCTAssertEqual(
            environment["GITHUB_APP_CLIENT_ID"],
            "expected-connector-config"
        )
        XCTAssertNil(environment["NODE_OPTIONS"])
        XCTAssertNil(environment["NODE_PATH"])
        XCTAssertNil(environment["DYLD_INSERT_LIBRARIES"])
        XCTAssertNil(environment["LD_PRELOAD"])
        XCTAssertNil(environment["BLABASE_LAUNCHER_AGENT_EXECUTABLE"])
        XCTAssertNil(environment["BLABASE_LAUNCHER_DATA_ROOT"])
        XCTAssertNil(environment["BLABASE_DASHBOARD_URL"])
        XCTAssertNil(environment["BLABASE_SHOW_ON_LAUNCH"])
        XCTAssertNil(environment["BLABASE_LAUNCHER_SOURCE_MODE"])
        XCTAssertNil(environment["BLABASE_CODE_COMMIT_SHA"])
        XCTAssertNil(environment["BLABASE_CODE_FINGERPRINT_SHA256"])
        XCTAssertNil(environment["CF_PAGES_COMMIT_SHA"])
        XCTAssertNil(environment["VERCEL_GIT_COMMIT_SHA"])
        XCTAssertNil(environment["GITHUB_SHA"])
    }

    func testMarksAnOverriddenDataRootReadOnly() throws {
        let fileManager = FileManager.default
        let dataRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "blabase-launcher-read-only-\(UUID().uuidString)",
            isDirectory: true
        )
        defer { try? fileManager.removeItem(at: dataRoot) }

        let configuration = try LauncherRuntimeConfiguration.resolve(
            environment: [
                "BLABASE_LAUNCHER_DATA_ROOT": dataRoot.path,
                "BLABASE_LAUNCHER_AGENT_EXECUTABLE": "/usr/bin/true",
                "BLABASE_LAUNCHER_SOURCE_MODE": "managed"
            ],
            fileManager: fileManager
        )

        XCTAssertEqual(
            configuration.environment["BLABASE_LAUNCHER_SOURCE_MODE"],
            "read_only"
        )
    }

    func testValidatesRuntimeCommitProvenance() throws {
        let manifest = Data(
            """
            {
              "contract":"blabase-launcher-runtime-manifest-v1",
              "codeState":"clean_commit",
              "codeCommitSha":"\(String(repeating: "a", count: 40))",
              "agentSha256":"\(String(repeating: "b", count: 64))"
            }
            """.utf8
        )

        XCTAssertEqual(
            try LauncherRuntimeConfiguration.validatedRuntimeEnvironment(
                manifestData: manifest
            ),
            ["BLABASE_CODE_COMMIT_SHA": String(repeating: "a", count: 40)]
        )
    }

    func testRejectsUnavailableRuntimeProvenance() throws {
        let manifest = Data(
            """
            {
              "contract":"blabase-launcher-runtime-manifest-v1",
              "codeState":"unavailable",
              "agentSha256":"\(String(repeating: "b", count: 64))"
            }
            """.utf8
        )

        XCTAssertThrowsError(
            try LauncherRuntimeConfiguration.validatedRuntimeEnvironment(
                manifestData: manifest
            )
        )
    }

    func testRejectsDataRootSymlinkThatResolvesToHome() throws {
        let fileManager = FileManager.default
        let temporaryRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "blabase-launcher-test-\(UUID().uuidString)",
            isDirectory: true
        )
        try fileManager.createDirectory(
            at: temporaryRoot,
            withIntermediateDirectories: true
        )
        defer { try? fileManager.removeItem(at: temporaryRoot) }
        let dataRoot = temporaryRoot.appendingPathComponent(
            "data-root",
            isDirectory: true
        )
        try fileManager.createSymbolicLink(
            at: dataRoot,
            withDestinationURL: fileManager.homeDirectoryForCurrentUser
        )

        XCTAssertThrowsError(
            try LauncherRuntimeConfiguration.resolve(
                environment: [
                    "BLABASE_LAUNCHER_DATA_ROOT": dataRoot.path,
                    "BLABASE_LAUNCHER_AGENT_EXECUTABLE": "/usr/bin/true"
                ],
                fileManager: fileManager
            )
        )
    }

    func testExplicitStoredChoiceWinsOverLegacyEnvironmentOverride() throws {
        let fileManager = FileManager.default
        let temporaryRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "blabase-launcher-choice-\(UUID().uuidString)",
            isDirectory: true
        )
        let selectedRoot = temporaryRoot.appendingPathComponent(
            "selected",
            isDirectory: true
        )
        let legacyRoot = temporaryRoot.appendingPathComponent(
            "legacy",
            isDirectory: true
        )
        let marker = selectedRoot.appendingPathComponent(
            ".local/sync/latest.json"
        )
        try fileManager.createDirectory(
            at: marker.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        XCTAssertTrue(fileManager.createFile(atPath: marker.path, contents: Data()))
        defer { try? fileManager.removeItem(at: temporaryRoot) }

        let configuration = try LauncherRuntimeConfiguration.resolve(
            dataRootChoice: .existingReadOnly(path: selectedRoot.path),
            environment: [
                "BLABASE_LAUNCHER_DATA_ROOT": legacyRoot.path,
                "BLABASE_LAUNCHER_AGENT_EXECUTABLE": "/usr/bin/true"
            ],
            fileManager: fileManager
        )

        XCTAssertEqual(
            configuration.dataRootURL,
            selectedRoot.resolvingSymlinksInPath().standardizedFileURL
        )
        XCTAssertFalse(fileManager.fileExists(atPath: legacyRoot.path))
        XCTAssertEqual(
            configuration.environment["BLABASE_LAUNCHER_SOURCE_MODE"],
            "read_only"
        )
    }

    func testRecognizesExistingStoreAndRejectsLocalFolderItself() throws {
        let fileManager = FileManager.default
        let dataRoot = fileManager.temporaryDirectory.appendingPathComponent(
            "blabase-launcher-store-\(UUID().uuidString)",
            isDirectory: true
        )
        let marker = dataRoot.appendingPathComponent(
            ".local/connectors/codex/snapshot.json"
        )
        try fileManager.createDirectory(
            at: marker.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        XCTAssertTrue(fileManager.createFile(atPath: marker.path, contents: Data()))
        defer { try? fileManager.removeItem(at: dataRoot) }

        XCTAssertEqual(
            try LauncherDataRootPolicy.validateExistingRoot(
                path: dataRoot.path,
                fileManager: fileManager
            ),
            dataRoot.resolvingSymlinksInPath().standardizedFileURL
        )
        XCTAssertThrowsError(
            try LauncherDataRootPolicy.validateExistingRoot(
                path: dataRoot.appendingPathComponent(".local").path,
                fileManager: fileManager
            )
        )
    }

    func testDecodesSuggestedAttentionProjection() throws {
        let json = #"""
        {
          "contract":"blabase-launcher-attention-v2",
          "resultId":"attention_result_11111111111111111111111111111111",
          "asOf":"2026-08-03T00:00:00.000Z",
          "decisionStatus":"suggested",
          "decisionReasonCodes":["DECISION_BEST_ELIGIBLE_CANDIDATE"],
          "candidateCounts":{"eligible":1,"reviewRequired":0,"ineligible":2},
          "sourceDiagnostics":[
            {"source":"github","state":"available","signalCount":3,"candidateSetComplete":true,"reasonCode":null},
            {"source":"codex","state":"available","signalCount":1,"candidateSetComplete":true,"reasonCode":null},
            {"source":"notion","state":"disconnected","signalCount":0,"candidateSetComplete":null,"reasonCode":"CONNECTOR_DISCONNECTED"},
            {"source":"google_calendar","state":"available","signalCount":2,"candidateSetComplete":null,"reasonCode":null}
          ],
          "card":{
            "candidateId":"attention_22222222222222222222222222222222",
            "title":"Phase 4C launcher 만들기",
            "contextLabel":"biadone/blabase #42",
            "laneLabel":"집중",
            "certainty":"confirmed",
            "whyNowText":["열린 할당 작업이 확인됨"],
            "explanation":"현재 작업 흐름과 직접 연결됩니다.",
            "firstStep":"런처 빌드를 실행합니다.",
            "dueAt":null,
            "primaryAction":{"kind":"open_github","url":"https://github.com/biadone/blabase/issues/42"}
          },
          "clarificationQuestion":null,
          "scopeStatement":"연결되고 갱신된 source만 평가했습니다.",
          "unavailableSources":["notion"],
          "dashboardPath":"/"
        }
        """#.data(using: .utf8)!

        let projection = try JSONDecoder().decode(
            LauncherAttentionProjection.self,
            from: json
        )

        XCTAssertEqual(projection.decisionStatus, .suggested)
        XCTAssertNil(projection.currentFocusSummary)
        XCTAssertEqual(projection.card?.title, "Phase 4C launcher 만들기")
        XCTAssertEqual(
            projection.card?.primaryAction,
            .openGitHub(
                url: "https://github.com/biadone/blabase/issues/42"
            )
        )
    }

    func testDecodesBoundedCurrentFocusSummaryWithoutAttentionEffect() throws {
        let json = #"""
        {
          "contract":"blabase-launcher-attention-v2",
          "resultId":"attention_result_11111111111111111111111111111111",
          "asOf":"2026-08-03T00:00:00.000Z",
          "decisionStatus":"no_action",
          "decisionReasonCodes":["DECISION_SCOPED_NO_ACTION"],
          "candidateCounts":{"eligible":0,"reviewRequired":0,"ineligible":1},
          "sourceDiagnostics":[
            {"source":"github","state":"available","signalCount":1,"candidateSetComplete":true,"reasonCode":null},
            {"source":"codex","state":"available","signalCount":1,"candidateSetComplete":true,"reasonCode":null},
            {"source":"notion","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null},
            {"source":"google_calendar","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null}
          ],
          "currentFocusSummary":{
            "status":"selected",
            "displayLabel":"Launcher contract repair",
            "reasonCodes":["FOCUS_LATEST_DIRECT_COMPLETE_EVENT"],
            "attentionSelectionEffect":"none"
          },
          "card":null,
          "clarificationQuestion":null,
          "scopeStatement":"연결되고 갱신된 source만 평가했습니다.",
          "unavailableSources":[],
          "dashboardPath":"/"
        }
        """#.data(using: .utf8)!

        let projection = try JSONDecoder().decode(
            LauncherAttentionProjection.self,
            from: json
        )

        XCTAssertEqual(projection.currentFocusSummary?.status, .selected)
        XCTAssertEqual(
            projection.currentFocusSummary?.displayLabel,
            "Launcher contract repair"
        )
        let summary = try XCTUnwrap(projection.currentFocusSummary)
        XCTAssertEqual(
            summary.attentionSelectionEffect,
            AttentionSelectionEffect.none
        )
        XCTAssertNil(projection.card)
    }

    func testCurrentFocusSummaryRequiresLabelOnlyWhenSelected() throws {
        XCTAssertTrue(
            AttentionCurrentFocusSummary(
                status: .selected,
                displayLabel: "Launcher contract repair",
                reasonCodes: [.latestDirectCompleteEvent],
                attentionSelectionEffect: .none
            ).isValid
        )
        XCTAssertFalse(
            AttentionCurrentFocusSummary(
                status: .unresolved,
                displayLabel: "must not leak",
                reasonCodes: [.sourcePartial],
                attentionSelectionEffect: .none
            ).isValid
        )
    }

    func testRejectsUnknownProjectionContract() throws {
        let json = #"{"contract":"unknown"}"#.data(using: .utf8)!
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: json
            )
        )
    }

    func testRejectsProjectionInvariantMismatch() throws {
        let json = #"""
        {
          "contract":"blabase-launcher-attention-v2",
          "resultId":"attention_result_11111111111111111111111111111111",
          "asOf":"2026-08-03T00:00:00.000Z",
          "decisionStatus":"suggested",
          "decisionReasonCodes":["DECISION_BEST_ELIGIBLE_CANDIDATE"],
          "candidateCounts":{"eligible":1,"reviewRequired":0,"ineligible":0},
          "sourceDiagnostics":[
            {"source":"github","state":"available","signalCount":1,"candidateSetComplete":true,"reasonCode":null},
            {"source":"codex","state":"available","signalCount":1,"candidateSetComplete":true,"reasonCode":null},
            {"source":"notion","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null},
            {"source":"google_calendar","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null}
          ],
          "card":null,
          "clarificationQuestion":null,
          "scopeStatement":"연결되고 갱신된 source만 평가했습니다.",
          "unavailableSources":[],
          "dashboardPath":"/private"
        }
        """#.data(using: .utf8)!

        XCTAssertThrowsError(
            try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: json
            )
        )
    }

    func testRejectsNonCanonicalOrIncompleteSourceDiagnostics() throws {
        let json = #"""
        {
          "contract":"blabase-launcher-attention-v2",
          "resultId":"attention_result_11111111111111111111111111111111",
          "asOf":"2026-08-03T00:00:00.000Z",
          "decisionStatus":"insufficient_evidence",
          "decisionReasonCodes":["DECISION_RELEVANT_COVERAGE_INSUFFICIENT"],
          "candidateCounts":{"eligible":0,"reviewRequired":0,"ineligible":0},
          "sourceDiagnostics":[
            {"source":"codex","state":"disconnected","signalCount":0,"candidateSetComplete":false,"reasonCode":"CONNECTOR_DISCONNECTED"},
            {"source":"github","state":"missing","signalCount":0,"candidateSetComplete":false,"reasonCode":"SNAPSHOT_MISSING"},
            {"source":"notion","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null},
            {"source":"google_calendar","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null}
          ],
          "card":null,
          "clarificationQuestion":null,
          "scopeStatement":"현재 평가 범위가 부족합니다.",
          "unavailableSources":["github","codex"],
          "dashboardPath":"/"
        }
        """#.data(using: .utf8)!

        XCTAssertThrowsError(
            try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: json
            )
        )
    }

    func testAllowsOnlyExpectedExternalURLs() throws {
        XCTAssertNotNil(
            SafeURLPolicy.githubURL(
                from: "https://github.com/biadone/blabase/issues/42"
            )
        )
        XCTAssertNil(SafeURLPolicy.githubURL(from: "file:///tmp/private"))
        XCTAssertNil(SafeURLPolicy.githubURL(from: "https://evil.example/task"))
        XCTAssertNil(
            SafeURLPolicy.githubURL(
                from: "https://github.com/biadone/blabase/issues/42?diff=private"
            )
        )
        XCTAssertNil(
            SafeURLPolicy.githubURL(
                from: "https://github.com/biadone/blabase/settings"
            )
        )
        XCTAssertEqual(
            SafeURLPolicy.dashboardURL(
                path: "/",
                baseURL: URL(string: "https://app.blabase.com")!
            )?.absoluteString,
            "https://app.blabase.com/"
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardURL(
                path: "/",
                baseURL: URL(string: "https://evil.example")!
            )
        )
        XCTAssertEqual(
            SafeURLPolicy.dashboardURL(
                path: "/attention-lab",
                baseURL: URL(string: "http://localhost:3102")!
            )?.absoluteString,
            "http://localhost:3102/attention-lab"
        )
        XCTAssertEqual(
            SafeURLPolicy.dashboardURL(
                path: "/sources",
                baseURL: URL(string: "http://localhost:3102")!
            )?.absoluteString,
            "http://localhost:3102/sources"
        )
        XCTAssertEqual(
            SafeURLPolicy.dashboardBaseURL(
                from: "http://127.0.0.1:3102/"
            )?.absoluteString,
            "http://127.0.0.1:3102"
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://app.blabase.com/private"
            )
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://app.blabase.com?token=private"
            )
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardBaseURL(
                from: "http://app.blabase.com"
            )
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://user:password@app.blabase.com"
            )
        )
        XCTAssertNil(
            SafeURLPolicy.dashboardBaseURL(
                from: "https://app.blabase.com#private"
            )
        )
    }

    func testDecodesStrictOptionalRecentWorkSummary() throws {
        let summary = #"{"displayLabel":"Launcher recent work","pushOccurredAt":"2026-08-03T00:00:00.000Z","trackingState":"ahead","aheadCount":2,"behindCount":0,"correlation":"repository_scope_only","presentation":"display_only","attentionSelectionEffect":"none","executionEffect":"none"}"#
        let projectionJSON = #"{"contract":"blabase-launcher-attention-v2","resultId":"attention_result_11111111111111111111111111111111","asOf":"2026-08-03T00:00:00.000Z","decisionStatus":"no_action","decisionReasonCodes":["DECISION_SCOPED_NO_ACTION"],"candidateCounts":{"eligible":0,"reviewRequired":0,"ineligible":1},"sourceDiagnostics":[{"source":"github","state":"available","signalCount":1,"candidateSetComplete":true,"reasonCode":null},{"source":"codex","state":"available","signalCount":1,"candidateSetComplete":true,"reasonCode":null},{"source":"notion","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null},{"source":"google_calendar","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null}],"currentFocusSummary":null,"recentWorkSummary":\#(summary),"card":null,"clarificationQuestion":null,"scopeStatement":"연결되고 갱신된 source만 평가했습니다.","unavailableSources":[],"dashboardPath":"/"}"#

        let decoded = try JSONDecoder().decode(
            LauncherAttentionProjection.self,
            from: Data(projectionJSON.utf8)
        )
        XCTAssertEqual(
            decoded.recentWorkSummary?.displayLabel,
            "Launcher recent work"
        )
        XCTAssertEqual(decoded.recentWorkSummary?.trackingState, .ahead)
        XCTAssertEqual(decoded.recentWorkSummary?.aheadCount, 2)
        let encoded = try JSONEncoder().encode(decoded)
        XCTAssertEqual(
            try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: encoded
            ),
            decoded
        )

        let nullJSON = projectionJSON.replacingOccurrences(
            of: #""recentWorkSummary":\#(summary)"#,
            with: #""recentWorkSummary":null"#
        )
        XCTAssertNil(
            try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: Data(nullJSON.utf8)
            ).recentWorkSummary
        )
        let omittedJSON = projectionJSON.replacingOccurrences(
            of: #""recentWorkSummary":\#(summary),"#,
            with: ""
        )
        XCTAssertNil(
            try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: Data(omittedJSON.utf8)
            ).recentWorkSummary
        )

        let unknownSummary = summary.replacingOccurrences(
            of: #""executionEffect":"none""#,
            with: #""executionEffect":"none","candidateId":"attention_11111111111111111111111111111111""#
        )
        let unknownJSON = projectionJSON.replacingOccurrences(
            of: summary,
            with: unknownSummary
        )
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                LauncherAttentionProjection.self,
                from: Data(unknownJSON.utf8)
            )
        )

        let invalidTrackingSummaries = [
            #"{"displayLabel":"x","pushOccurredAt":"2026-08-03T00:00:00.000Z","trackingState":"in_sync","aheadCount":1,"behindCount":0,"correlation":"repository_scope_only","presentation":"display_only","attentionSelectionEffect":"none","executionEffect":"none"}"#,
            #"{"displayLabel":"x","pushOccurredAt":"2026-08-03T00:00:00.000Z","trackingState":"ahead","aheadCount":0,"behindCount":0,"correlation":"repository_scope_only","presentation":"display_only","attentionSelectionEffect":"none","executionEffect":"none"}"#,
            #"{"displayLabel":"x","pushOccurredAt":"2026-08-03T00:00:00.000Z","trackingState":"behind","aheadCount":0,"behindCount":0,"correlation":"repository_scope_only","presentation":"display_only","attentionSelectionEffect":"none","executionEffect":"none"}"#,
            #"{"displayLabel":"x","pushOccurredAt":"2026-08-03T00:00:00.000Z","trackingState":"diverged","aheadCount":1,"behindCount":0,"correlation":"repository_scope_only","presentation":"display_only","attentionSelectionEffect":"none","executionEffect":"none"}"#,
            #"{"displayLabel":"x","pushOccurredAt":"2026-08-03T00:00:00.000Z","trackingState":"not_configured","aheadCount":0,"behindCount":0,"correlation":"repository_scope_only","presentation":"display_only","attentionSelectionEffect":"none","executionEffect":"none"}"#
        ]
        for invalidSummary in invalidTrackingSummaries {
            XCTAssertThrowsError(
                try JSONDecoder().decode(
                    AttentionRecentWorkSummary.self,
                    from: Data(invalidSummary.utf8)
                )
            )
        }

        for invalidTimestamp in [
            "2026-08-03T00:00Z",
            "2026-08-03T00:00:00Z",
            "2026-08-03T00:00:00.0Z",
            "2026-08-03T00:00:00.0000Z",
            "2026-08-03T00:00:00.000+00:00"
        ] {
            let invalidTimestampSummary = summary.replacingOccurrences(
                of: "2026-08-03T00:00:00.000Z",
                with: invalidTimestamp
            )
            XCTAssertThrowsError(
                try JSONDecoder().decode(
                    AttentionRecentWorkSummary.self,
                    from: Data(invalidTimestampSummary.utf8)
                )
            )
        }

        let utf16Boundary = AttentionRecentWorkSummary(
            displayLabel: String(repeating: "😀", count: 120),
            pushOccurredAt: "2026-08-03T00:00:00.000Z",
            trackingState: .inSync,
            aheadCount: 0,
            behindCount: 0,
            correlation: .repositoryScopeOnly,
            presentation: .displayOnly,
            attentionSelectionEffect: .none,
            executionEffect: .none
        )
        XCTAssertEqual(utf16Boundary.displayLabel.utf16.count, 240)
        XCTAssertTrue(utf16Boundary.isValid)
        let overUtf16Boundary = AttentionRecentWorkSummary(
            displayLabel: utf16Boundary.displayLabel + "x",
            pushOccurredAt: utf16Boundary.pushOccurredAt,
            trackingState: utf16Boundary.trackingState,
            aheadCount: utf16Boundary.aheadCount,
            behindCount: utf16Boundary.behindCount,
            correlation: utf16Boundary.correlation,
            presentation: utf16Boundary.presentation,
            attentionSelectionEffect:
                utf16Boundary.attentionSelectionEffect,
            executionEffect: utf16Boundary.executionEffect
        )
        XCTAssertEqual(overUtf16Boundary.displayLabel.utf16.count, 241)
        XCTAssertFalse(overUtf16Boundary.isValid)
        XCTAssertThrowsError(try JSONEncoder().encode(overUtf16Boundary))
    }

    func testBoundsSupervisorRestarts() throws {
        var policy = SupervisorRestartPolicy(
            maximumRestarts: 2,
            window: 60,
            delaysNanoseconds: [1, 2]
        )
        let now = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(
            policy.recordUnexpectedExit(at: now),
            .restart(afterNanoseconds: 1)
        )
        XCTAssertEqual(
            policy.recordUnexpectedExit(at: now.addingTimeInterval(1)),
            .restart(afterNanoseconds: 2)
        )
        XCTAssertEqual(
            policy.recordUnexpectedExit(at: now.addingTimeInterval(2)),
            .stop
        )
    }
}
