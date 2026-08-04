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

enum LauncherPresentation {
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
