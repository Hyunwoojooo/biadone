import Foundation

/// Presentation only: installation, service connectivity, and card reception are separate evidence.
/// Projects come from the current connected snapshot. Card paths are observations retained during
/// this app's uninterrupted verified service connection, not necessarily cards still awaiting a choice.
/// The caller clears those observations on connection loss or service generation changes; saved
/// sessions are not card evidence, and neither installation nor reception proves selection return.
struct PetConnectionReadiness: Equatable, Sendable {
    enum Status: Equatable, Sendable {
        case checking, needsSetup, needsRestart, needsAttention, awaitingVerification, receiving
    }

    enum NextStep: Equatable, Sendable {
        case refresh, service, installPlugin, pluginDetails, projects, restartService, verifyInCodex
    }

    enum CheckState: Equatable, Sendable {
        case confirmed, pending, attention, checking, failed
    }

    struct Check: Identifiable, Equatable, Sendable {
        let id: String
        let title: String
        let detail: String
        let state: CheckState
    }

    let status: Status
    let title: String
    let detail: String
    let nextStep: NextStep
    let nextStepTitle: String
    let checks: [Check]

    init(
        pluginState: CodexPluginSetupState,
        serviceConnected: Bool,
        serviceIsTransitioning: Bool,
        serviceIssue: String?,
        serviceIssueRequiresAction: Bool = false,
        configuredProjectPaths: [String]?,
        activeProjectPaths: Set<String>?,
        receivedCardProjectPaths: Set<String>
    ) {
        let issue = serviceIssue?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasServiceIssue = issue?.isEmpty == false
        let hasCurrentService = serviceConnected && !serviceIsTransitioning && !hasServiceIssue
        let configured = configuredProjectPaths.map(Set.init)
        let projectMismatch = hasCurrentService && configured != nil && activeProjectPaths != nil
            && configured != activeProjectPaths
        let received = hasCurrentService
            ? receivedCardProjectPaths.intersection(activeProjectPaths ?? []) : []

        let serviceCheck = Check(
            id: "service", title: "Blabee 서비스",
            detail: hasServiceIssue ? issue! : serviceIsTransitioning
                ? "서비스 연결 상태를 확인하고 있습니다."
                : serviceConnected ? "연결됨 · 앱과 서비스가 통신하고 있습니다."
                    : "연결 필요 · Blabee 서비스를 먼저 시작하세요.",
            state: hasServiceIssue ? (serviceIssueRequiresAction ? .attention : .failed)
                : serviceIsTransitioning ? .checking
                : serviceConnected ? .confirmed : .attention
        )
        let pluginCheck = Self.pluginCheck(pluginState)
        let projectCheck: Check
        if projectMismatch {
            projectCheck = Check(
                id: "projects", title: "관찰 프로젝트",
                detail: "저장된 프로젝트 설정과 현재 서비스가 다릅니다. 서비스 재시작 후 추가·제외한 폴더가 적용됩니다.",
                state: .attention
            )
        } else if let configured, configured.isEmpty {
            projectCheck = Check(
                id: "projects", title: "관찰 프로젝트",
                detail: "등록된 프로젝트가 없습니다. Codex에서 작업할 폴더를 추가하세요.",
                state: .attention
            )
        } else if let configured, activeProjectPaths != nil, hasCurrentService {
            projectCheck = Check(
                id: "projects", title: "관찰 프로젝트",
                detail: "등록된 \(configured.count)개 프로젝트가 서비스에 적용되었습니다. 등록한 폴더와 하위 폴더에서만 동작합니다.",
                state: .confirmed
            )
        } else {
            projectCheck = Check(
                id: "projects", title: "관찰 프로젝트",
                detail: configured == nil ? "프로젝트 설정을 아직 확인하지 못했습니다."
                    : "프로젝트 \(configured!.count)개가 저장되어 있습니다. 현재 서비스 적용 여부는 확인 전입니다.",
                state: .pending
            )
        }

        let receivedDescription = Self.receivedDescription(received)
        let cardCheck = Check(
            id: "card", title: "실제 선택 카드",
            detail: received.isEmpty
                ? "이 앱에서 확인한 카드 수신 기록이 없습니다. 등록한 프로젝트에서 새 요청으로 확인하세요. 선택 결과의 Codex 반환은 자동 판정하지 않습니다."
                : "\(receivedDescription) Hook 전체 상태와 선택 결과의 Codex 반환은 자동 판정하지 않습니다.",
            state: received.isEmpty ? .pending : .confirmed
        )
        checks = [serviceCheck, pluginCheck, projectCheck, cardCheck]

        // Resolve one next action without hiding the independent evidence in the checklist.
        let recommendation: Recommendation
        if hasServiceIssue {
            recommendation = Recommendation(
                status: .needsAttention, title: "서비스 연결을 확인해 주세요", detail: issue!,
                nextStep: .service, nextStepTitle: "서비스 상태 확인"
            )
        } else if serviceIsTransitioning {
            recommendation = Recommendation(
                status: .checking, title: "Blabee 서비스 연결 중",
                detail: "서비스 연결이 확인되면 Codex와 프로젝트 상태를 이어서 확인합니다.",
                nextStep: .service, nextStepTitle: "서비스 상태 보기"
            )
        } else if !serviceConnected {
            recommendation = Recommendation(
                status: .needsSetup, title: "Blabee 서비스 연결 필요",
                detail: "Codex의 요청을 받으려면 Blabee 서비스가 실행되어 있어야 합니다.",
                nextStep: .service, nextStepTitle: "서비스 연결하기"
            )
        } else if let pluginRecommendation = Self.pluginRecommendation(pluginState) {
            recommendation = pluginRecommendation
        } else if projectMismatch {
            recommendation = Recommendation(
                status: .needsRestart, title: "프로젝트 설정 적용 필요",
                detail: "프로젝트는 저장되었지만 현재 서비스에는 아직 반영되지 않았습니다. 서비스를 다시 시작해 주세요.",
                nextStep: .restartService, nextStepTitle: "서비스 다시 시작"
            )
        } else if configured?.isEmpty == true {
            recommendation = Recommendation(
                status: .needsSetup, title: "사용할 프로젝트를 추가하세요",
                detail: "Codex에서 작업하는 폴더를 등록해야 해당 프로젝트의 선택지를 받을 수 있습니다.",
                nextStep: .projects, nextStepTitle: "프로젝트 추가하기"
            )
        } else if configured == nil || activeProjectPaths == nil {
            recommendation = Recommendation(
                status: .checking, title: "프로젝트 적용 상태 확인 필요",
                detail: "저장된 프로젝트와 현재 서비스의 관찰 범위를 아직 비교하지 못했습니다.",
                nextStep: .refresh, nextStepTitle: "상태 다시 확인"
            )
        } else if received.isEmpty {
            recommendation = Recommendation(
                status: .awaitingVerification, title: "설정 준비됨 · 동작 확인 필요",
                detail: "이 앱에서 확인한 카드 수신 기록이 없습니다. Codex에서 /hooks 상태를 확인하고 등록한 프로젝트에서 새 요청을 보내세요.",
                nextStep: .verifyInCodex, nextStepTitle: "Codex에서 동작 확인"
            )
        } else {
            recommendation = Recommendation(
                status: .receiving, title: "선택 카드 수신 확인",
                detail: "\(receivedDescription) 다른 프로젝트까지 검증된 것은 아니며, 선택 결과의 Codex 반환은 자동 판정하지 않습니다.",
                nextStep: .verifyInCodex, nextStepTitle: "선택 반환 확인 방법"
            )
        }
        status = recommendation.status
        title = recommendation.title
        detail = recommendation.detail
        nextStep = recommendation.nextStep
        nextStepTitle = recommendation.nextStepTitle
    }

    private struct Recommendation {
        let status: Status
        let title: String
        let detail: String
        let nextStep: NextStep
        let nextStepTitle: String
    }

    private static func pluginCheck(_ state: CodexPluginSetupState) -> Check {
        let detail: String
        let checkState: CheckState
        switch state {
        case let .installedNeedsHookReview(version):
            detail = "설치됨 · Plugin \(version). 현재 세션의 Hook 동작 확인과는 별개입니다."
            checkState = .confirmed
        case .unchecked:
            detail = "Codex Plugin 설치 상태를 아직 확인하지 않았습니다."
            checkState = .pending
        case .notInstalled, .marketplaceInstalledNeedsPlugin, .updateAvailable,
             .unavailable, .legacyInstallationDetected:
            detail = state.title
            checkState = .attention
        case .conflict, .error:
            detail = state.title
            checkState = .failed
        }
        return Check(id: "plugin", title: "Codex Plugin", detail: detail, state: checkState)
    }

    private static func pluginRecommendation(_ state: CodexPluginSetupState) -> Recommendation? {
        switch state {
        case .installedNeedsHookReview:
            return nil
        case .unchecked:
            return Recommendation(
                status: .checking, title: "Codex 설치 상태 확인 필요", detail: state.detail,
                nextStep: .refresh, nextStepTitle: "상태 다시 확인"
            )
        case .notInstalled, .marketplaceInstalledNeedsPlugin:
            return Recommendation(
                status: .needsSetup, title: "Codex 연결 설정 필요", detail: state.detail,
                nextStep: .installPlugin, nextStepTitle: "Codex 연결하기"
            )
        case .updateAvailable:
            return Recommendation(
                status: .needsSetup, title: state.title, detail: state.detail,
                nextStep: .installPlugin, nextStepTitle: "Plugin 업데이트"
            )
        case .unavailable, .legacyInstallationDetected, .conflict, .error:
            return Recommendation(
                status: .needsAttention, title: state.title, detail: state.detail,
                nextStep: .pluginDetails, nextStepTitle: "Codex 연결 문제 확인"
            )
        }
    }

    private static func receivedDescription(_ paths: Set<String>) -> String {
        guard let first = paths.sorted().first else { return "" }
        let project = URL(fileURLWithPath: first).lastPathComponent
        let scope = paths.count == 1 ? "\(project) 프로젝트" : "\(project) 외 \(paths.count - 1)개 프로젝트"
        return "이 앱에서 \(scope)의 선택 카드 수신을 확인했습니다."
    }
}
