import XCTest
@testable import BlabaseLauncher

final class LauncherPresentationTests: XCTestCase {
    func testCancelReturnsFromEvidenceBeforeClosingPanel() {
        XCTAssertEqual(
            LauncherNavigationReducer.cancel(from: .evidence),
            LauncherCancelResult(
                route: .home,
                disposition: .handledInLauncher
            )
        )
        XCTAssertEqual(
            LauncherNavigationReducer.cancel(from: .home),
            LauncherCancelResult(
                route: .home,
                disposition: .closePanel
            )
        )
    }

    func testCoveragePreservesCanonicalSourceOrder() {
        let coverage = LauncherSourceCoverage.make(
            unavailableSources: [.googleCalendar, .notion]
        )

        XCTAssertEqual(coverage.availableSources, [.github, .codex])
        XCTAssertEqual(
            coverage.unavailableSources,
            [.notion, .googleCalendar]
        )
        XCTAssertEqual(coverage.compactSummary, "평가 범위 2/4")
    }

    func testCoverageReportsCompleteEvaluationScope() {
        let coverage = LauncherSourceCoverage.make(
            unavailableSources: []
        )

        XCTAssertEqual(coverage.availableSources, AttentionSource.allCases)
        XCTAssertTrue(coverage.unavailableSources.isEmpty)
        XCTAssertEqual(coverage.compactSummary, "평가 범위 4/4")
    }

    func testPrimaryActionPresentationDoesNotChangeActionSemantics() {
        XCTAssertEqual(
            LauncherPresentation.primaryActionSource(
                .focusOrResume(enabled: true)
            ),
            "Codex"
        )
        XCTAssertTrue(
            LauncherPresentation.primaryActionEnabled(
                .openGitHub(url: "https://github.com/biadone/blabase/issues/42")
            )
        )
        XCTAssertFalse(
            LauncherPresentation.primaryActionEnabled(
                .focusOrResume(enabled: false)
            )
        )
    }

    func testSourceDiagnosticPresentationKeepsStateAndReasonVisible() {
        let display = LauncherPresentation.sourceDiagnosticDisplay(
            AttentionSourceDiagnostic(
                source: .github,
                state: .disconnected,
                signalCount: 0,
                candidateSetComplete: false,
                reasonCode: .connectorDisconnected
            )
        )

        XCTAssertEqual(display.stateLabel, "연결 안 됨")
        XCTAssertEqual(
            display.detail,
            "신호 0개 · 후보 범위 일부 · CONNECTOR_DISCONNECTED"
        )
        XCTAssertEqual(display.tone, .warning)
    }

    func testConnectionCheckAppearsWhenEitherPrimarySourceIsUnusable() {
        let unavailable = sourceDiagnostics(
            github: .stale,
            codex: .collectionFailed
        )
        XCTAssertTrue(
            LauncherPresentation.shouldOfferDataConnectionCheck(
                sourceDiagnostics: unavailable
            )
        )

        let githubAvailable = sourceDiagnostics(
            github: .available,
            codex: .disconnected
        )
        XCTAssertFalse(
            LauncherPresentation.shouldOfferDataConnectionCheck(
                sourceDiagnostics: sourceDiagnostics(
                    github: .available,
                    codex: .available
                )
            )
        )
        XCTAssertTrue(
            LauncherPresentation.shouldOfferDataConnectionCheck(
                sourceDiagnostics: githubAvailable
            )
        )
    }

    func testCandidateAndDecisionSummariesUseDiagnosticsOnly() {
        XCTAssertEqual(
            LauncherPresentation.candidateCountSummary(
                AttentionCandidateCounts(
                    eligible: 0,
                    reviewRequired: 1,
                    ineligible: 2
                )
            ),
            "추천 가능 0 · 확인 필요 1 · 제외 2"
        )
        XCTAssertEqual(
            LauncherPresentation.decisionReasonSummary([
                .relevantCoverageInsufficient
            ]),
            "GitHub·Codex의 현재 작업 근거가 충분하지 않습니다."
        )
    }

    private func sourceDiagnostics(
        github: AttentionSourceDiagnosticState,
        codex: AttentionSourceDiagnosticState
    ) -> [AttentionSourceDiagnostic] {
        [
            AttentionSourceDiagnostic(
                source: .github,
                state: github,
                signalCount: 0,
                candidateSetComplete: false,
                reasonCode: nil
            ),
            AttentionSourceDiagnostic(
                source: .codex,
                state: codex,
                signalCount: 0,
                candidateSetComplete: false,
                reasonCode: nil
            ),
            AttentionSourceDiagnostic(
                source: .notion,
                state: .unevaluated,
                signalCount: 0,
                candidateSetComplete: nil,
                reasonCode: nil
            ),
            AttentionSourceDiagnostic(
                source: .googleCalendar,
                state: .unevaluated,
                signalCount: 0,
                candidateSetComplete: nil,
                reasonCode: nil
            )
        ]
    }
}
