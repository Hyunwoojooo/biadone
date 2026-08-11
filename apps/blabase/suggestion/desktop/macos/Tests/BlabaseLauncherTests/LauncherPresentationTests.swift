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

    func testDecisionCopySeparatesCurrentFocusFromAttentionSelection() {
        let selectedFocus = AttentionCurrentFocusSummary(
            status: .selected,
            displayLabel: "Launcher contract repair",
            reasonCodes: [.latestDirectCompleteEvent],
            attentionSelectionEffect: .none
        )
        let counts = AttentionCandidateCounts(
            eligible: 0,
            reviewRequired: 0,
            ineligible: 1
        )

        XCTAssertEqual(
            LauncherPresentation.decisionDisplay(
                decisionStatus: .noAction,
                decisionReasonCodes: [.scopedNoAction],
                candidateCounts: counts,
                currentFocusSummary: selectedFocus
            ),
            LauncherDecisionDisplay(
                icon: "checkmark.circle",
                title: "현재 작업 흐름은 확인했지만, 평가한 범위에서는 별도 개입 후보가 없습니다.",
                currentFocusLabel: "Launcher contract repair"
            )
        )
        XCTAssertEqual(
            LauncherPresentation.decisionDisplay(
                decisionStatus: .insufficientEvidence,
                decisionReasonCodes: [.relevantCoverageInsufficient],
                candidateCounts: counts,
                currentFocusSummary: selectedFocus
            ).title,
            "현재 작업 흐름은 확인됐지만, 새 개입 제안의 근거는 부족합니다."
        )
    }

    func testInsufficientCopyExplainsZeroEligibleAndPartialCoverage() {
        let display = LauncherPresentation.decisionDisplay(
            decisionStatus: .insufficientEvidence,
            decisionReasonCodes: [.relevantCoverageInsufficient],
            candidateCounts: AttentionCandidateCounts(
                eligible: 0,
                reviewRequired: 0,
                ineligible: 1
            ),
            currentFocusSummary: nil
        )

        XCTAssertEqual(
            display.title,
            "확인된 항목은 추천 조건에 맞지 않고, 평가 범위도 충분하지 않습니다."
        )
        XCTAssertNil(display.currentFocusLabel)
    }

    func testRecentWorkDisplayDoesNotChangeActiveDecisionCopy() {
        let counts = AttentionCandidateCounts(
            eligible: 0,
            reviewRequired: 0,
            ineligible: 1
        )
        let decisionBefore = LauncherPresentation.decisionDisplay(
            decisionStatus: .noAction,
            decisionReasonCodes: [.scopedNoAction],
            candidateCounts: counts,
            currentFocusSummary: nil
        )
        let summary = AttentionRecentWorkSummary(
            displayLabel: "Launcher recent work",
            pushOccurredAt: "2026-08-03T00:00:00.000Z",
            trackingState: .ahead,
            aheadCount: 2,
            behindCount: 0,
            correlation: .repositoryScopeOnly,
            presentation: .displayOnly,
            attentionSelectionEffect: .none,
            executionEffect: .none
        )

        XCTAssertEqual(
            LauncherPresentation.recentWorkDisplay(summary),
            LauncherRecentWorkDisplay(
                title: "Launcher recent work",
                trackingText: "로컬 작업이 2개 앞서 있습니다.",
                pushedAtText:
                    "GitHub push · 2026-08-03T00:00:00.000Z"
            )
        )
        XCTAssertEqual(
            LauncherPresentation.decisionDisplay(
                decisionStatus: .noAction,
                decisionReasonCodes: [.scopedNoAction],
                candidateCounts: counts,
                currentFocusSummary: nil
            ),
            decisionBefore
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
