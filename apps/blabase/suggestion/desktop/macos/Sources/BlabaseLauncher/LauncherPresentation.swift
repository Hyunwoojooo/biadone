import Foundation

enum LauncherRoute: Equatable, Sendable {
    case home
    case evidence
}

enum LauncherCancelDisposition: Equatable, Sendable {
    case handledInLauncher
    case closePanel
}

struct LauncherCancelResult: Equatable, Sendable {
    let route: LauncherRoute
    let disposition: LauncherCancelDisposition
}

enum LauncherNavigationReducer {
    static func cancel(from route: LauncherRoute) -> LauncherCancelResult {
        switch route {
        case .home:
            LauncherCancelResult(route: .home, disposition: .closePanel)
        case .evidence:
            LauncherCancelResult(
                route: .home,
                disposition: .handledInLauncher
            )
        }
    }
}

struct LauncherSourceCoverage: Equatable, Sendable {
    let availableSources: [AttentionSource]
    let unavailableSources: [AttentionSource]

    static func make(
        unavailableSources: [AttentionSource]
    ) -> LauncherSourceCoverage {
        let unavailable = Set(unavailableSources)
        return LauncherSourceCoverage(
            availableSources: AttentionSource.allCases.filter {
                !unavailable.contains($0)
            },
            unavailableSources: AttentionSource.allCases.filter {
                unavailable.contains($0)
            }
        )
    }

    var compactSummary: String {
        if unavailableSources.isEmpty {
            return "평가 범위 4/4"
        }
        return "평가 범위 \(availableSources.count)/4"
    }
}

enum LauncherSourceDiagnosticTone: Equatable, Sendable {
    case positive
    case warning
    case critical
    case neutral
}

struct LauncherSourceDiagnosticDisplay: Equatable, Sendable {
    let stateLabel: String
    let detail: String
    let tone: LauncherSourceDiagnosticTone
}

struct LauncherDecisionDisplay: Equatable, Sendable {
    let icon: String
    let title: String
    let currentFocusLabel: String?
}

struct LauncherRecentWorkDisplay: Equatable, Sendable {
    let title: String
    let trackingText: String
    let pushedAtText: String
}

enum LauncherPresentation {
    static func decisionDisplay(
        decisionStatus: AttentionDecisionStatus,
        decisionReasonCodes: [AttentionDecisionReasonCode],
        candidateCounts: AttentionCandidateCounts,
        currentFocusSummary: AttentionCurrentFocusSummary?
    ) -> LauncherDecisionDisplay {
        let focusLabel = currentFocusSummary?.status == .selected
            ? currentFocusSummary?.displayLabel
            : nil
        let icon: String
        let title: String
        switch decisionStatus {
        case .suggested:
            icon = "sparkles"
            title = "현재 제안을 표시할 수 없습니다."
        case .needsClarification:
            icon = "questionmark.bubble"
            title = "한 가지 확인이 필요합니다."
        case .noAction:
            icon = "checkmark.circle"
            if focusLabel != nil {
                title = "현재 작업 흐름은 확인했지만, 평가한 범위에서는 별도 개입 후보가 없습니다."
            } else if candidateCounts.reviewRequired > 0 ||
                candidateCounts.ineligible > 0 {
                title = "확인된 항목은 지금 개입 조건에 해당하지 않습니다."
            } else {
                title = "평가한 범위에는 지금 개입할 항목이 없습니다."
            }
        case .insufficientEvidence:
            icon = "scope"
            if focusLabel != nil {
                title = "현재 작업 흐름은 확인됐지만, 새 개입 제안의 근거는 부족합니다."
            } else if decisionReasonCodes.contains(
                .relevantCoverageInsufficient
            ) {
                title = candidateCounts.reviewRequired > 0 ||
                    candidateCounts.ineligible > 0
                    ? "확인된 항목은 추천 조건에 맞지 않고, 평가 범위도 충분하지 않습니다."
                    : "GitHub·Codex 평가 범위가 충분하지 않습니다."
            } else {
                title = "최신 source 증거를 다시 수집해야 합니다."
            }
        }
        return LauncherDecisionDisplay(
            icon: icon,
            title: title,
            currentFocusLabel: focusLabel
        )
    }

    static func recentWorkDisplay(
        _ summary: AttentionRecentWorkSummary
    ) -> LauncherRecentWorkDisplay? {
        guard summary.isValid else {
            return nil
        }
        let trackingText: String
        switch summary.trackingState {
        case .inSync:
            trackingText = "로컬 추적 상태와 일치합니다."
        case .ahead:
            trackingText =
                "로컬 작업이 \(summary.aheadCount ?? 0)개 앞서 있습니다."
        case .behind:
            trackingText =
                "로컬 작업이 \(summary.behindCount ?? 0)개 뒤처져 있습니다."
        case .diverged:
            trackingText =
                "로컬 작업이 \(summary.aheadCount ?? 0)개 앞서고 " +
                "\(summary.behindCount ?? 0)개 뒤처져 있습니다."
        case .notConfigured:
            trackingText = "로컬 추적 기준이 설정되지 않았습니다."
        }
        return LauncherRecentWorkDisplay(
            title: summary.displayLabel,
            trackingText: trackingText,
            pushedAtText: "GitHub push · \(summary.pushOccurredAt)"
        )
    }

    static func sourceDiagnosticDisplay(
        _ diagnostic: AttentionSourceDiagnostic
    ) -> LauncherSourceDiagnosticDisplay {
        let stateLabel: String
        let tone: LauncherSourceDiagnosticTone
        switch diagnostic.state {
        case .available:
            stateLabel = "사용 가능"
            tone = .positive
        case .stale:
            stateLabel = "오래된 데이터"
            tone = .warning
        case .invalid:
            stateLabel = "유효하지 않음"
            tone = .critical
        case .missing:
            stateLabel = "데이터 없음"
            tone = .warning
        case .rejected:
            stateLabel = "데이터 거부됨"
            tone = .critical
        case .disconnected:
            stateLabel = "연결 안 됨"
            tone = .warning
        case .collectionFailed:
            stateLabel = "수집 실패"
            tone = .critical
        case .unevaluated:
            stateLabel = "평가하지 않음"
            tone = .neutral
        }

        var details = ["신호 \(diagnostic.signalCount)개"]
        if let complete = diagnostic.candidateSetComplete {
            details.append(complete ? "후보 범위 확인됨" : "후보 범위 일부")
        }
        if let reasonCode = diagnostic.reasonCode {
            details.append(reasonCode.rawValue)
        }
        return LauncherSourceDiagnosticDisplay(
            stateLabel: stateLabel,
            detail: details.joined(separator: " · "),
            tone: tone
        )
    }

    static func candidateCountSummary(
        _ counts: AttentionCandidateCounts
    ) -> String {
        "추천 가능 \(counts.eligible) · 확인 필요 \(counts.reviewRequired) · 제외 \(counts.ineligible)"
    }

    static func decisionReasonSummary(
        _ codes: [AttentionDecisionReasonCode]
    ) -> String {
        codes.map { code in
            switch code {
            case .bestEligibleCandidate:
                "검증된 후보 중 가장 우선할 작업을 선택했습니다."
            case .refreshRequired:
                "최신 source 증거를 다시 수집해야 합니다."
            case .userClarificationRequired:
                "사용자가 확인해야 하는 후보가 있습니다."
            case .scopedNoAction:
                "평가한 범위에는 지금 개입할 후보가 없습니다."
            case .relevantCoverageInsufficient:
                "GitHub·Codex의 현재 작업 근거가 충분하지 않습니다."
            }
        }.joined(separator: " ")
    }

    static func shouldOfferDataConnectionCheck(
        sourceDiagnostics: [AttentionSourceDiagnostic]
    ) -> Bool {
        let primaryStates = Dictionary(
            uniqueKeysWithValues: sourceDiagnostics.compactMap { diagnostic in
                switch diagnostic.source {
                case .github, .codex:
                    (diagnostic.source, diagnostic.state)
                case .notion, .googleCalendar:
                    nil
                }
            }
        )
        return [AttentionSource.github, .codex].contains {
            primaryStates[$0]?.isUsable == false
        }
    }

    static func primaryActionTitle(_ action: AttentionPrimaryAction) -> String {
        switch action {
        case .focusOrResume: "Codex에서 이어가기"
        case .openGitHub: "GitHub에서 열기"
        }
    }

    static func primaryActionSource(_ action: AttentionPrimaryAction) -> String {
        switch action {
        case .focusOrResume: "Codex"
        case .openGitHub: "GitHub"
        }
    }

    static func primaryActionEnabled(_ action: AttentionPrimaryAction) -> Bool {
        switch action {
        case .focusOrResume(let enabled): enabled
        case .openGitHub: true
        }
    }

    static func executionStatusText(_ status: LauncherExecutionStatus) -> String {
        switch status {
        case .pending: "요청 대기 중"
        case .claimed: "Terminal 준비 중"
        case .completed: "열림"
        case .failed: "열기 실패"
        case .expired: "요청 만료"
        }
    }
}
