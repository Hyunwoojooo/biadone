import Foundation
import XCTest
@testable import BlabaseLauncher

final class LauncherWorkBoardModelTests: XCTestCase {
    func testIPCEnvelopeRequiresExactMutuallyExclusiveKeysAndCanonicalRequestID() throws {
        let requestId = LauncherIPC.requestID(
            uuid: UUID(uuidString: "11111111-2222-3333-4444-555555555555")!
        )
        let success = Data(
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(requestId)","ok":true,"result":{"contract":"blabase-launcher-work-board-v1"}}"#.utf8
        )
        guard case .success(let decodedRequestId, _) =
            try LauncherIPC.parseResponseLine(success)
        else {
            return XCTFail("Expected strict success envelope")
        }
        XCTAssertEqual(decodedRequestId, requestId)

        let hostile = [
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(requestId)","ok":true,"result":{},"extra":true}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(requestId)","ok":true,"result":{},"error":{"code":"FAILED","message":"bounded"}}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"not-canonical","ok":true,"result":{}}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(requestId)","ok":false,"error":{"code":"FAILED","message":"bounded","detail":"private"}}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(requestId)","ok":false,"error":{"code":"FAILED","message":"bounded"},"result":{}}"#,
            #"{"contract":"blabase-launcher-ipc-v1","requestId":"\#(requestId)","ok":false,"error":{"code":"lowercase","message":"bounded"}}"#
        ]
        for value in hostile {
            XCTAssertThrowsError(
                try LauncherIPC.parseResponseLine(Data(value.utf8))
            )
        }
        for unsafeMessage in [
            "private_target_secret",
            "/Users/private/work",
            "https://private.example.test/path",
            "token=private-token-value"
        ] {
            let compatibleUnsafeError = try JSONSerialization.data(
                withJSONObject: [
                    "contract": "blabase-launcher-ipc-v1",
                    "requestId": requestId,
                    "ok": false,
                    "error": [
                        "code": "INVALID_REQUEST",
                        "message": unsafeMessage
                    ]
                ]
            )
            guard case .failure(_, let parsedError) =
                try LauncherIPC.parseResponseLine(compatibleUnsafeError)
            else {
                return XCTFail("Expected compatible IPC error")
            }
            XCTAssertEqual(parsedError.code, "INVALID_REQUEST")
            XCTAssertEqual(
                LauncherIPC.displayErrorMessage(parsedError.message),
                "Local Agent 요청을 처리하지 못했습니다."
            )
        }
        for (code, message) in [
            (String(repeating: "A", count: 121), "bounded"),
            ("FAILED", String(repeating: "가", count: 501)),
            ("FAILED", "line\nbreak")
        ] {
            let hostileError = try JSONSerialization.data(
                withJSONObject: [
                    "contract": "blabase-launcher-ipc-v1",
                    "requestId": requestId,
                    "ok": false,
                    "error": ["code": code, "message": message]
                ]
            )
            XCTAssertThrowsError(
                try LauncherIPC.parseResponseLine(hostileError)
            )
        }
    }

    func testDecodesStrictOrderedDisplayOnlyProjection() throws {
        let projection = try decodeBoard(validBoardJSON())

        XCTAssertEqual(projection.mode, .full)
        XCTAssertEqual(projection.prominentLane, .attention)
        XCTAssertEqual(
            projection.items.map(\.lane),
            [.attention, .continuation, .setup]
        )
        XCTAssertTrue(projection.items.allSatisfy { $0.capability == "display" })
    }

    func testFullEmptyBoardIsValid() throws {
        let projection = try decodeBoard(
            #"{"contract":"blabase-launcher-work-board-v1","generatedAt":"2026-08-13T09:00:00.000Z","mode":"full","prominentLane":"none","continuationStatus":"empty","items":[]}"#
        )

        XCTAssertTrue(projection.items.isEmpty)
        XCTAssertEqual(projection.continuationStatus, .empty)
    }

    func testAttentionOnlyTopThreeCanRetainAvailableContinuationStatus() throws {
        let data = Data(validBoardJSON().utf8)
        var object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        let items = try XCTUnwrap(object["items"] as? [[String: Any]])
        object["items"] = [items[0], items[0], items[0]]
        let projection = try JSONDecoder().decode(
            LauncherWorkBoardProjection.self,
            from: JSONSerialization.data(withJSONObject: object)
        )

        XCTAssertEqual(projection.items.count, 3)
        XCTAssertEqual(projection.continuationStatus, .available)
    }

    func testRejectsPrivateActionfulOrStructurallyHostileProjection() throws {
        let mutations: [(inout [String: Any]) -> Void] = [
            { root in
                root["contract"] = "blabase-launcher-work-board-v2"
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items[0]["itemRef"] = "item_ref_private"
                root["items"] = items
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items[0]["capability"] = "open_source"
                items[0]["action"] = ["actionRef": "action_ref_private"]
                root["items"] = items
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items[0]["title"] = "/Users/private/work"
                root["items"] = items
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items[0]["title"] = "item_ref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                root["items"] = items
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items.reverse()
                root["items"] = items
                root["prominentLane"] = "setup"
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items[1]["expiresAt"] = NSNull()
                root["items"] = items
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items[0]["expiresAt"] = "2026-08-14T08:00:00.000Z"
                root["items"] = items
            },
            { root in
                var items = root["items"] as! [[String: Any]]
                items[1]["expiresAt"] = root["generatedAt"]
                root["items"] = items
            },
            { root in
                root["mode"] = "active_only_fallback"
                root["continuationStatus"] = "unavailable"
            }
        ]

        let data = Data(validBoardJSON().utf8)
        for mutate in mutations {
            var object = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: data) as? [String: Any]
            )
            mutate(&object)
            let hostile = try JSONSerialization.data(withJSONObject: object)
            XCTAssertThrowsError(
                try JSONDecoder().decode(
                    LauncherWorkBoardProjection.self,
                    from: hostile
                )
            )
        }
    }

    func testKoreanPresentationMatchesWebAllowlist() {
        XCTAssertEqual(
            LauncherWorkBoardLane.allCases.map(
                LauncherWorkBoardPresentation.laneTitle
            ),
            ["지금 처리할 일", "이어서 할 일", "연결할 일"]
        )
        XCTAssertEqual(
            LauncherWorkBoardPresentation.evidenceText(.verifiedAttention),
            "검증된 Attention"
        )
        XCTAssertEqual(
            LauncherWorkBoardPresentation.evidenceText(.corroborated),
            "여러 소스가 일치함"
        )
        XCTAssertEqual(
            LauncherWorkBoardPresentation.caveatText(.sourceMetadataOnly),
            "메타데이터만 확인됨"
        )
        XCTAssertEqual(
            LauncherWorkBoardPresentation.emptyLaneText,
            "표시할 제안 없음"
        )
    }

    func testPrivateNamespaceParityRejectsInternalRefsAndAllowsCICDCopy() throws {
        let data = Data(validBoardJSON().utf8)
        let privateTitles = [
            "session_private",
            "run_private",
            "evidence_private",
            "source_ref_private",
            "managed_run_private",
            "continuation_observation_private",
            "continuation_candidate_private",
            "result_private",
            "result_sha_private",
            "candidate_private"
        ]
        for title in privateTitles {
            var root = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: data) as? [String: Any]
            )
            var items = try XCTUnwrap(root["items"] as? [[String: Any]])
            items[0]["title"] = title
            root["items"] = items
            XCTAssertThrowsError(
                try JSONDecoder().decode(
                    LauncherWorkBoardProjection.self,
                    from: JSONSerialization.data(withJSONObject: root)
                )
            )
        }

        var allowed = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        var items = try XCTUnwrap(allowed["items"] as? [[String: Any]])
        items[0]["title"] = "CI/CD 결과 확인"
        allowed["items"] = items
        XCTAssertNoThrow(
            try JSONDecoder().decode(
                LauncherWorkBoardProjection.self,
                from: JSONSerialization.data(withJSONObject: allowed)
            )
        )
    }

    func testExpiryFilterPreservesOrderAndUsesSafeMinuteChunks() throws {
        let projection = try decodeBoard(expiringBoardJSON())
        let beforeExpiry = LauncherWorkBoardDisplayState(
            projection: projection,
            now: try XCTUnwrap(
                launcherWorkBoardTimestampDate("2026-08-13T09:01:59.999Z")
            )
        )
        let atExpiry = LauncherWorkBoardDisplayState(
            projection: projection,
            now: try XCTUnwrap(
                launcherWorkBoardTimestampDate("2026-08-13T09:02:00.000Z")
            )
        )

        XCTAssertEqual(
            beforeExpiry.items.map(\.lane),
            [.attention, .continuation, .setup]
        )
        XCTAssertEqual(atExpiry.items.map(\.lane), [.attention])
        XCTAssertEqual(
            launcherWorkBoardExpiryDelayNanoseconds(
                now: Date(timeIntervalSince1970: 0),
                nextExpiry: Date(timeIntervalSince1970: 30 * 24 * 60 * 60)
            ),
            launcherWorkBoardExpiryTimerChunkNanoseconds
        )
    }

    private func decodeBoard(_ json: String) throws -> LauncherWorkBoardProjection {
        try JSONDecoder().decode(
            LauncherWorkBoardProjection.self,
            from: Data(json.utf8)
        )
    }
}

@MainActor
final class LauncherPreferredProjectionLoaderTests: XCTestCase {
    func testFullBoardIsTerminalEvenWhenItHasZeroItems() async throws {
        let board = try JSONDecoder().decode(
            LauncherWorkBoardProjection.self,
            from: Data(
                #"{"contract":"blabase-launcher-work-board-v1","generatedAt":"2026-08-13T09:00:00.000Z","mode":"full","prominentLane":"none","continuationStatus":"empty","items":[]}"#.utf8
            )
        )
        var attentionCalls = 0
        let loaded = try await LauncherPreferredProjectionLoader.load(
            refresh: true,
            getWorkBoard: { _ in board },
            getAttention: { _ in
                attentionCalls += 1
                return try attentionProjection()
            }
        )

        XCTAssertEqual(loaded, .workBoard(board))
        XCTAssertEqual(attentionCalls, 0)
        XCTAssertEqual(
            LauncherScreenReducer.loaded(
                loaded,
                now: Date(timeIntervalSince1970: 0)
            ),
            .workBoard(
                LauncherWorkBoardDisplayState(
                    projection: board,
                    now: Date(timeIntervalSince1970: 0)
                )
            )
        )
    }

    func testActiveFallbackCallsLegacyAttentionExactlyOnceWithoutRefresh() async throws {
        let board = try activeFallbackBoard()
        var refreshes: [Bool] = []
        let attention = try attentionProjection()
        let loaded = try await LauncherPreferredProjectionLoader.load(
            refresh: true,
            getWorkBoard: { _ in board },
            getAttention: { refresh in
                refreshes.append(refresh)
                return attention
            }
        )

        XCTAssertEqual(loaded, .attention(attention))
        XCTAssertEqual(refreshes, [false])
    }

    func testActiveFallbackAttentionFailureIsNotReclassifiedOrRetried() async throws {
        let board = try activeFallbackBoard()
        var refreshes: [Bool] = []
        do {
            _ = try await LauncherPreferredProjectionLoader.load(
                refresh: true,
                getWorkBoard: { _ in board },
                getAttention: { refresh in
                    refreshes.append(refresh)
                    throw LauncherAgentError.agent(
                        code: "INVALID_REQUEST",
                        message: "legacy failure"
                    )
                }
            )
            XCTFail("Expected legacy Attention failure")
        } catch let error as LauncherAgentError {
            XCTAssertEqual(
                error,
                .agent(code: "INVALID_REQUEST", message: "legacy failure")
            )
        }
        XCTAssertEqual(refreshes, [false])
    }

    func testUnsupportedMethodUsesOriginalRefreshExactlyOnce() async throws {
        var refreshes: [Bool] = []
        let attention = try attentionProjection()
        let loaded = try await LauncherPreferredProjectionLoader.load(
            refresh: true,
            getWorkBoard: { _ in
                throw LauncherAgentError.agent(
                    code: "INVALID_REQUEST",
                    message: "unsupported"
                )
            },
            getAttention: { refresh in
                refreshes.append(refresh)
                return attention
            }
        )

        XCTAssertEqual(loaded, .attention(attention))
        XCTAssertEqual(refreshes, [true])
    }

    func testCompletedBoardFailureOrInvalidProjectionFallsBackWithoutDoubleRefresh() async throws {
        for error in [
            LauncherAgentError.agent(
                code: "WORK_BOARD_RUN_FAILED",
                message: "bounded"
            ) as Error,
            LauncherWorkBoardLoadError.invalidProjection as Error
        ] {
            var refreshes: [Bool] = []
            let loaded = try await LauncherPreferredProjectionLoader.load(
                refresh: true,
                getWorkBoard: { _ in throw error },
                getAttention: { refresh in
                    refreshes.append(refresh)
                    return try attentionProjection()
                }
            )
            XCTAssertEqual(refreshes, [false])
            guard case .degradedAttention = loaded else {
                return XCTFail("Expected degraded Attention fallback")
            }
        }
    }

    func testViewModelPublishesBoundedDegradedIndicatorWithoutRemovingAttention() async throws {
        let attention = try attentionProjection()
        let viewModel = LauncherViewModel(
            sourceModeProvider: { .readOnly },
            preferredProjectionProvider: { _ in
                .degradedAttention(attention)
            }
        )

        viewModel.load(refresh: true)
        await yieldUntil { viewModel.workBoardFallbackMessage != nil }

        XCTAssertEqual(
            viewModel.workBoardFallbackMessage,
            "Work Board를 불러오지 못해 기존 Attention을 표시합니다"
        )
        guard case .projection(let loaded, _) = viewModel.state else {
            return XCTFail("Expected legacy Attention state")
        }
        XCTAssertEqual(loaded, attention)
        try await viewModel.shutdown()
    }

    func testTimeoutAndDisconnectDoNotReuseTheSequentialConnection() async throws {
        for expectedError in [
            LauncherAgentError.requestTimedOut,
            LauncherAgentError.disconnected,
            LauncherAgentError.invalidResponse
        ] {
            var attentionCalls = 0
            do {
                _ = try await LauncherPreferredProjectionLoader.load(
                    refresh: true,
                    getWorkBoard: { _ in throw expectedError },
                    getAttention: { _ in
                        attentionCalls += 1
                        return try attentionProjection()
                    }
                )
                XCTFail("Expected transport failure")
            } catch let receivedError as LauncherAgentError {
                XCTAssertEqual(receivedError, expectedError)
            }
            XCTAssertEqual(attentionCalls, 0)
        }
    }

    func testViewModelExpiryTimerChunksAndRemovesOnlyActuallyExpiredRows() async throws {
        var now = try XCTUnwrap(
            launcherWorkBoardTimestampDate("2026-08-13T09:00:00.000Z")
        )
        var sleepers: [(
            UInt64,
            CheckedContinuation<Void, Error>
        )] = []
        let board = try JSONDecoder().decode(
            LauncherWorkBoardProjection.self,
            from: Data(expiringBoardJSON().utf8)
        )
        let viewModel = LauncherViewModel(
            sourceModeProvider: { .readOnly },
            preferredProjectionProvider: { _ in .workBoard(board) },
            nowProvider: { now },
            expirySleeper: { delay in
                try await withCheckedThrowingContinuation { continuation in
                    sleepers.append((delay, continuation))
                }
            }
        )

        viewModel.load(refresh: false)
        await yieldUntil { sleepers.count == 1 }
        XCTAssertEqual(sleepers[0].0, launcherWorkBoardExpiryTimerChunkNanoseconds)
        now = now.addingTimeInterval(60)
        sleepers.removeFirst().1.resume()
        await yieldUntil { sleepers.count == 1 }
        guard case .workBoard(let midDisplay) = viewModel.state else {
            return XCTFail("Expected Work Board state")
        }
        XCTAssertEqual(midDisplay.items.count, 3)

        now = now.addingTimeInterval(60)
        sleepers.removeFirst().1.resume()
        await yieldUntil {
            guard case .workBoard(let display) = viewModel.state else {
                return false
            }
            return display.items.count == 1
        }
        guard case .workBoard(let expiredDisplay) = viewModel.state else {
            return XCTFail("Expected filtered Work Board state")
        }
        XCTAssertEqual(expiredDisplay.items.map(\.lane), [.attention])
        try await viewModel.shutdown()
    }

    func testViewModelLoadGenerationPreventsOlderCompletionFromOverwritingNewer() async throws {
        var continuations: [
            CheckedContinuation<LauncherPreferredProjection, Error>
        ] = []
        let firstBoard = try boardWithAttentionTitle("오래된 제안")
        let secondBoard = try boardWithAttentionTitle("최신 제안")
        let viewModel = LauncherViewModel(
            sourceModeProvider: { .readOnly },
            preferredProjectionProvider: { _ in
                try await withCheckedThrowingContinuation { continuation in
                    continuations.append(continuation)
                }
            }
        )

        viewModel.load(refresh: false)
        await yieldUntil { continuations.count == 1 }
        viewModel.load(refresh: true)
        await yieldUntil { continuations.count == 2 }
        continuations[1].resume(returning: .workBoard(secondBoard))
        await yieldUntil {
            guard case .workBoard(let display) = viewModel.state else {
                return false
            }
            return display.items.first?.title == "최신 제안"
        }
        continuations[0].resume(returning: .workBoard(firstBoard))
        for _ in 0..<10 { await Task.yield() }

        guard case .workBoard(let display) = viewModel.state else {
            return XCTFail("Expected latest Work Board state")
        }
        XCTAssertEqual(display.items.first?.title, "최신 제안")
        XCTAssertFalse(viewModel.isRefreshing)
        try await viewModel.shutdown()
    }
}

private func validBoardJSON() -> String {
    #"{"contract":"blabase-launcher-work-board-v1","generatedAt":"2026-08-13T09:00:00.000Z","mode":"full","prominentLane":"attention","continuationStatus":"available","items":[{"lane":"attention","title":"현재 확인할 Attention","evidenceBand":"verified_attention","caveatCodes":[],"expiresAt":null,"capability":"display","action":null},{"lane":"continuation","title":"최근 작업 이어가기","evidenceBand":"corroborated","caveatCodes":["SOURCE_COVERAGE_PARTIAL"],"expiresAt":"2026-08-14T08:00:00.000Z","capability":"display","action":null},{"lane":"setup","title":"작업공간 연결하기","evidenceBand":"setup","caveatCodes":["EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"],"expiresAt":"2026-08-14T08:00:00.000Z","capability":"display","action":null}]}"#
}

private func expiringBoardJSON() -> String {
    validBoardJSON().replacingOccurrences(
        of: "2026-08-14T08:00:00.000Z",
        with: "2026-08-13T09:02:00.000Z"
    )
}

private func boardWithAttentionTitle(
    _ title: String
) throws -> LauncherWorkBoardProjection {
    let data = Data(validBoardJSON().utf8)
    var root = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    var items = root["items"] as! [[String: Any]]
    items[0]["title"] = title
    root["items"] = items
    return try JSONDecoder().decode(
        LauncherWorkBoardProjection.self,
        from: JSONSerialization.data(withJSONObject: root)
    )
}

@MainActor
private func yieldUntil(
    _ condition: () -> Bool
) async {
    for _ in 0..<100 where !condition() {
        await Task.yield()
    }
}

private func activeFallbackBoard() throws -> LauncherWorkBoardProjection {
    try JSONDecoder().decode(
        LauncherWorkBoardProjection.self,
        from: Data(
            #"{"contract":"blabase-launcher-work-board-v1","generatedAt":"2026-08-13T09:00:00.000Z","mode":"active_only_fallback","prominentLane":"attention","continuationStatus":"unavailable","items":[{"lane":"attention","title":"현재 확인할 Attention","evidenceBand":"verified_attention","caveatCodes":[],"expiresAt":null,"capability":"display","action":null}]}"#.utf8
        )
    )
}

@MainActor
private func attentionProjection() throws -> LauncherAttentionProjection {
    try JSONDecoder().decode(
        LauncherAttentionProjection.self,
        from: Data(
            #"{"contract":"blabase-launcher-attention-v2","resultId":"attention_result_11111111111111111111111111111111","asOf":"2026-08-13T09:00:00.000Z","decisionStatus":"no_action","decisionReasonCodes":["DECISION_SCOPED_NO_ACTION"],"candidateCounts":{"eligible":0,"reviewRequired":0,"ineligible":0},"sourceDiagnostics":[{"source":"github","state":"available","signalCount":0,"candidateSetComplete":true,"reasonCode":null},{"source":"codex","state":"available","signalCount":0,"candidateSetComplete":true,"reasonCode":null},{"source":"notion","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null},{"source":"google_calendar","state":"unevaluated","signalCount":0,"candidateSetComplete":null,"reasonCode":null}],"currentFocusSummary":null,"recentWorkSummary":null,"card":null,"clarificationQuestion":null,"scopeStatement":"평가한 범위에는 지금 개입할 항목이 없습니다.","unavailableSources":[],"dashboardPath":"/"}"#.utf8
        )
    )
}
