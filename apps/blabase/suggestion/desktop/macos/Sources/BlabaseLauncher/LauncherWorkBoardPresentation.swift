import Foundation

enum LauncherWorkBoardPresentation {
    static let emptyLaneText = "표시할 제안 없음"
    static let degradedAttentionText =
        "Work Board를 불러오지 못해 기존 Attention을 표시합니다"

    static func laneTitle(_ lane: LauncherWorkBoardLane) -> String {
        switch lane {
        case .attention: "지금 처리할 일"
        case .continuation: "이어서 할 일"
        case .setup: "연결할 일"
        }
    }

    static func evidenceText(_ evidence: LauncherWorkBoardEvidenceBand) -> String {
        switch evidence {
        case .verifiedAttention: "검증된 Attention"
        case .exact: "정확한 작업 연결"
        case .corroborated: "여러 소스가 일치함"
        case .singleSource: "단일 소스 근거"
        case .setup: "연결 필요"
        }
    }

    static func caveatText(_ caveat: LauncherWorkBoardCaveatCode) -> String {
        switch caveat {
        case .candidateSetIncomplete: "후보 범위 일부"
        case .defaultTieBreakUsed: "동률 기준 적용"
        case .githubPRActionabilityPartial: "GitHub 처리 가능성 일부"
        case .managedFailureInspectionOnly: "실패 상태 확인 전용"
        case .reviewDraftUnknown: "초안 상태 확인 필요"
        case .upstreamObjectsRemainNonCandidates: "상위 객체는 후보에서 제외됨"
        case .explicitMappingConfirmationRequired: "연결 확인 필요"
        case .identityClarificationRequired: "작업 연결 확인 필요"
        case .sourceCoveragePartial: "소스 범위 일부"
        case .sourceCoverageUnknown: "소스 범위 확인 불가"
        case .sourceMetadataOnly: "메타데이터만 확인됨"
        case .terminalStateUnknown: "종료 상태 확인 불가"
        }
    }
}
