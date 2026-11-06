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
        case refresh, service, installPlugin, pluginDetails, projects, restartService, verifyInCodex, checkHooks
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
        receivedCardProjectPaths: Set<String>,
        hookReadiness: PetHookReadinessState = .unchecked,
        hookProjectPath: String? = nil
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
            id: "service", title: PetL10n.text("Blabee service", korean: "Blabee 서비스"),
            detail: hasServiceIssue ? issue! : serviceIsTransitioning
                ? PetL10n.text("Checking service connection status.", korean: "서비스 연결 상태를 확인하고 있습니다.")
                : serviceConnected ? PetL10n.text("Connected · The app and service are communicating.", korean: "연결됨 · 앱과 서비스가 통신하고 있습니다.")
                    : PetL10n.text("Connection needed · Start the Blabee service first.", korean: "연결 필요 · Blabee 서비스를 먼저 시작하세요."),
            state: hasServiceIssue ? (serviceIssueRequiresAction ? .attention : .failed)
                : serviceIsTransitioning ? .checking
                : serviceConnected ? .confirmed : .attention
        )
        let pluginCheck = Self.pluginCheck(pluginState)
        let projectCheck: Check
        if projectMismatch {
            projectCheck = Check(
                id: "projects", title: PetL10n.text("Watched projects", korean: "관찰 프로젝트"),
                detail: PetL10n.text("Saved project settings differ from the current service. Added or removed folders apply after a service restart.", korean: "저장된 프로젝트 설정과 현재 서비스가 다릅니다. 서비스 재시작 후 추가·제외한 폴더가 적용됩니다."),
                state: .attention
            )
        } else if let configured, configured.isEmpty {
            projectCheck = Check(
                id: "projects", title: PetL10n.text("Watched projects", korean: "관찰 프로젝트"),
                detail: PetL10n.text("No projects registered. Add a folder to work in with Codex.", korean: "등록된 프로젝트가 없습니다. Codex에서 작업할 폴더를 추가하세요."),
                state: .attention
            )
        } else if let configured, activeProjectPaths != nil, hasCurrentService {
            projectCheck = Check(
                id: "projects", title: PetL10n.text("Watched projects", korean: "관찰 프로젝트"),
                detail: PetL10n.text("\(configured.count) registered projects are applied to the service. Only registered folders and their subfolders are included.", korean: "등록된 \(configured.count)개 프로젝트가 서비스에 적용되었습니다. 등록한 폴더와 하위 폴더에서만 동작합니다."),
                state: .confirmed
            )
        } else {
            projectCheck = Check(
                id: "projects", title: PetL10n.text("Watched projects", korean: "관찰 프로젝트"),
                detail: configured == nil ? PetL10n.text("Project settings have not been checked yet.", korean: "프로젝트 설정을 아직 확인하지 못했습니다.")
                    : PetL10n.text("\(configured!.count) projects are saved. Application to the current service has not been checked yet.", korean: "프로젝트 \(configured!.count)개가 저장되어 있습니다. 현재 서비스 적용 여부는 확인 전입니다."),
                state: .pending
            )
        }

        let receivedDescription = Self.receivedDescription(received)
        let cardCheck = Check(
            id: "card", title: PetL10n.text("Actual choice cards", korean: "실제 선택 카드"),
            detail: received.isEmpty
                ? PetL10n.text("This app has no verified card-receipt record. Try a new request in a registered project. Delivery of the choice back to Codex is not determined automatically.", korean: "이 앱에서 확인한 카드 수신 기록이 없습니다. 등록한 프로젝트에서 새 요청으로 확인하세요. 선택 결과의 Codex 반환은 자동 판정하지 않습니다.")
                : PetL10n.text("\(receivedDescription) Overall Hook status and delivery of the choice back to Codex are not determined automatically.", korean: "\(receivedDescription) Hook 전체 상태와 선택 결과의 Codex 반환은 자동 판정하지 않습니다."),
            state: received.isEmpty ? .pending : .confirmed
        )
        let hookState: CheckState = switch hookReadiness {
        case .trusted: .confirmed
        case .checking: .checking
        case .unchecked: .pending
        case .reviewRequired, .unavailable: .attention
        }
        let hookScope = hookProjectPath.map { PetL10n.text("Check target: \($0). ", korean: "확인 대상: \($0). ") } ?? ""
        let hookCheck = Check(id: "hooks", title: PetL10n.text("Hook trust · \(hookReadiness.title)", korean: "Hook 신뢰 · \(hookReadiness.title)"),
                              detail: hookScope + hookReadiness.detail, state: hookState)
        checks = [serviceCheck, pluginCheck, projectCheck, cardCheck, hookCheck]

        // Resolve one next action without hiding the independent evidence in the checklist.
        let recommendation: Recommendation
        if hasServiceIssue {
            recommendation = Recommendation(
                status: .needsAttention, title: PetL10n.text("Check the service connection", korean: "서비스 연결을 확인해 주세요"), detail: issue!,
                nextStep: .service, nextStepTitle: PetL10n.text("Check Service Status", korean: "서비스 상태 확인")
            )
        } else if serviceIsTransitioning {
            recommendation = Recommendation(
                status: .checking, title: PetL10n.text("Connecting to Blabee service", korean: "Blabee 서비스 연결 중"),
                detail: PetL10n.text("After the service connects, Codex and project status will be checked.", korean: "서비스 연결이 확인되면 Codex와 프로젝트 상태를 이어서 확인합니다."),
                nextStep: .service, nextStepTitle: PetL10n.text("View Service Status", korean: "서비스 상태 보기")
            )
        } else if !serviceConnected {
            recommendation = Recommendation(
                status: .needsSetup, title: PetL10n.text("Blabee service connection required", korean: "Blabee 서비스 연결 필요"),
                detail: PetL10n.text("The Blabee service must be running to receive requests from Codex.", korean: "Codex의 요청을 받으려면 Blabee 서비스가 실행되어 있어야 합니다."),
                nextStep: .service, nextStepTitle: PetL10n.text("Connect Service", korean: "서비스 연결하기")
            )
        } else if let pluginRecommendation = Self.pluginRecommendation(pluginState) {
            recommendation = pluginRecommendation
        } else if projectMismatch {
            recommendation = Recommendation(
                status: .needsRestart, title: PetL10n.text("Apply project settings", korean: "프로젝트 설정 적용 필요"),
                detail: PetL10n.text("Projects are saved but have not been applied to the current service. Restart the service.", korean: "프로젝트는 저장되었지만 현재 서비스에는 아직 반영되지 않았습니다. 서비스를 다시 시작해 주세요."),
                nextStep: .restartService, nextStepTitle: PetL10n.text("Restart Service", korean: "서비스 다시 시작")
            )
        } else if configured?.isEmpty == true {
            recommendation = Recommendation(
                status: .needsSetup, title: PetL10n.text("Add a project to use", korean: "사용할 프로젝트를 추가하세요"),
                detail: PetL10n.text("Register the folder you work in with Codex to receive its choices.", korean: "Codex에서 작업하는 폴더를 등록해야 해당 프로젝트의 선택지를 받을 수 있습니다."),
                nextStep: .projects, nextStepTitle: PetL10n.text("Add Project", korean: "프로젝트 추가하기")
            )
        } else if configured == nil || activeProjectPaths == nil {
            recommendation = Recommendation(
                status: .checking, title: PetL10n.text("Check project application status", korean: "프로젝트 적용 상태 확인 필요"),
                detail: PetL10n.text("Saved projects have not yet been compared with the current service's watched folders.", korean: "저장된 프로젝트와 현재 서비스의 관찰 범위를 아직 비교하지 못했습니다."),
                nextStep: .refresh, nextStepTitle: PetL10n.text("Recheck Status", korean: "상태 다시 확인")
            )
        } else if hookReadiness != .trusted {
            recommendation = Recommendation(
                status: hookReadiness == .checking ? .checking
                    : hookReadiness == .unchecked ? .awaitingVerification : .needsAttention,
                title: PetL10n.text("Hook trust · \(hookReadiness.title)", korean: "Hook 신뢰 · \(hookReadiness.title)"), detail: hookReadiness.detail,
                nextStep: .checkHooks, nextStepTitle: PetL10n.text("Check Hook Status", korean: "Hook 상태 확인")
            )
        } else if received.isEmpty {
            recommendation = Recommendation(
                status: .awaitingVerification, title: PetL10n.text("Setup ready · Verify operation", korean: "설정 준비됨 · 동작 확인 필요"),
                detail: PetL10n.text("This app has no verified card-receipt record. Check /hooks in Codex, then send a new request in a registered project.", korean: "이 앱에서 확인한 카드 수신 기록이 없습니다. Codex에서 /hooks 상태를 확인하고 등록한 프로젝트에서 새 요청을 보내세요."),
                nextStep: .verifyInCodex, nextStepTitle: PetL10n.text("Verify in Codex", korean: "Codex에서 동작 확인")
            )
        } else {
            recommendation = Recommendation(
                status: .receiving, title: PetL10n.text("Choice card received", korean: "선택 카드 수신 확인"),
                detail: PetL10n.text("\(receivedDescription) Other projects have not been verified. Delivery of the choice back to Codex is not determined automatically.", korean: "\(receivedDescription) 다른 프로젝트까지 검증된 것은 아니며, 선택 결과의 Codex 반환은 자동 판정하지 않습니다."),
                nextStep: .verifyInCodex, nextStepTitle: PetL10n.text("How to Verify Selection Delivery", korean: "선택 반환 확인 방법")
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
            detail = PetL10n.text("Installed · Plugin \(version). This is separate from verifying Hooks in the current session.", korean: "설치됨 · Plugin \(version). 현재 세션의 Hook 동작 확인과는 별개입니다.")
            checkState = .confirmed
        case .unchecked:
            detail = PetL10n.text("Codex Plugin installation has not been checked yet.", korean: "Codex Plugin 설치 상태를 아직 확인하지 않았습니다.")
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
                status: .checking, title: PetL10n.text("Check Codex installation", korean: "Codex 설치 상태 확인 필요"), detail: state.detail,
                nextStep: .refresh, nextStepTitle: PetL10n.text("Recheck Status", korean: "상태 다시 확인")
            )
        case .notInstalled, .marketplaceInstalledNeedsPlugin:
            return Recommendation(
                status: .needsSetup, title: PetL10n.text("Set up Codex connection", korean: "Codex 연결 설정 필요"), detail: state.detail,
                nextStep: .installPlugin, nextStepTitle: PetL10n.text("Connect Codex", korean: "Codex 연결하기")
            )
        case .updateAvailable:
            return Recommendation(
                status: .needsSetup, title: state.title, detail: state.detail,
                nextStep: .installPlugin, nextStepTitle: PetL10n.text("Update Plugin", korean: "Plugin 업데이트")
            )
        case .unavailable, .legacyInstallationDetected, .conflict, .error:
            return Recommendation(
                status: .needsAttention, title: state.title, detail: state.detail,
                nextStep: .pluginDetails, nextStepTitle: PetL10n.text("Check Codex connection issue", korean: "Codex 연결 문제 확인")
            )
        }
    }

    private static func receivedDescription(_ paths: Set<String>) -> String {
        guard let first = paths.sorted().first else { return "" }
        let project = URL(fileURLWithPath: first).lastPathComponent
        let scope = paths.count == 1 ? PetL10n.text("\(project) project", korean: "\(project) 프로젝트") : PetL10n.text("\(project) and \(paths.count - 1) other projects", korean: "\(project) 외 \(paths.count - 1)개 프로젝트")
        return PetL10n.text("This app received a choice card from \(scope).", korean: "이 앱에서 \(scope)의 선택 카드 수신을 확인했습니다.")
    }
}
