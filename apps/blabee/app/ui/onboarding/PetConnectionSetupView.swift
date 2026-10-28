import AppKit
import SwiftUI

/// Missing scope, an intentionally empty scope, and an unreadable scope have
/// different meanings. Presentation never fills in or expands saved folders.
enum PetCodexWorkingFolderScope: Equatable, Sendable {
    case unverified, homeDefault, empty, configured

    init(paths: [String], areAuthoritative: Bool, scopeExists: Bool) {
        if !areAuthoritative { self = .unverified }
        else if !scopeExists { self = .homeDefault }
        else { self = paths.isEmpty ? .empty : .configured }
    }

    var summary: String {
        switch self {
        case .unverified:
            PetL10n.text("Working folder settings have not been verified.", korean: "작업 폴더 설정을 아직 확인하지 못했어요.")
        case .homeDefault:
            PetL10n.text("Connect will use your home folder and its subfolders.", korean: "연결하면 홈 폴더와 그 하위 폴더에서 사용할 수 있어요.")
        case .empty:
            PetL10n.text("No working folders are selected.", korean: "선택한 작업 폴더가 없어요.")
        case .configured:
            PetL10n.text("Uses your saved working folders and their subfolders.", korean: "저장한 작업 폴더와 그 하위 폴더에서 사용합니다.")
        }
    }

    var advancedHint: String {
        self == .empty
            ? PetL10n.text("Add a working folder in Advanced Settings to connect Codex.", korean: "Codex를 연결하려면 고급 설정에서 작업 폴더를 추가하세요.")
            : PetL10n.text("You can change working folders in Advanced Settings.", korean: "작업 폴더는 고급 설정에서 변경할 수 있어요.")
    }
}

/// Shared by first run and settings. Configuration and live session evidence
/// stay separate, and only an explicit button starts a setup mutation.
@MainActor
struct PetConnectionSetupView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject private var viewModel: PetViewModel
    @ObservedObject private var controller: PetConnectionSetupController
    @Environment(\.colorScheme) private var colorScheme
    @State private var showsAdvancedSettings = false
    @State private var actionID: UUID?
    @State private var actionTask: Task<Void, Never>?

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        _controller = ObservedObject(wrappedValue: viewModel.connectionSetup)
    }

    private var secondary: Color { PetAirPalette.secondary(for: colorScheme) }
    private var accent: Color { PetAirPalette.accent(for: colorScheme) }
    private var busy: Bool {
        controller.isWorking || viewModel.isOnboardingOperationInFlight
            || viewModel.isContinuingCodexConnectionSetup
    }
    private var toolNeedingInstallation: PetConnectionSetupProvider? {
        PetConnectionSetupProvider.allCases.first {
            controller.selectedProviders.contains($0) && controller.state(for: $0).status == .needsInstall
        }
    }

    enum GuidanceStep: Equatable {
        case working, chooseTools, storageRecovery, serviceIssue, legacyService, restartService, ready, codexRecovery
        case installTools, hookReview, reviewRequirements, retry, checkSettings, connect, connectAvailable
    }

    var requiresStorageRecovery: Bool {
        viewModel.appOwnedServiceState == .failed("freshness_storage_missing")
    }

    private var availableToolNames: String {
        controller.availableProviders.map(\.title).joined(separator: ", ")
    }

    private var requiresLegacyServiceReview: Bool {
        viewModel.showsLegacyServiceSettings && (controller.serviceIssue != nil || requiresStorageRecovery)
    }

    var guidanceStep: GuidanceStep {
        if busy { return .working }
        if requiresLegacyServiceReview { return .legacyService }
        if requiresStorageRecovery { return .storageRecovery }
        if viewModel.needsAppOwnedServiceRestartAfterLegacyCleanup { return .restartService }
        if controller.serviceIssue != nil { return .serviceIssue }
        if controller.selectedProviders.isEmpty { return .chooseTools }
        if controller.canFinish { return .ready }
        let states = controller.selectedProviders.map { controller.state(for: $0).status }
        if states.contains(.needsInstall) { return .installTools }
        if controller.selectedProviders.contains(.codex), viewModel.codexConnectionRecovery != nil {
            return .codexRecovery
        }
        if controller.phase == .failed || controller.phase == .cancelled { return .retry }
        // A warning for one tool must not turn the available tool's explicit
        // Connect action into an endless read-only Check Again loop.
        if !controller.availableProviders.isEmpty, states.contains(.needsAction) { return .connectAvailable }
        if viewModel.isAwaitingCodexHookReview { return .hookReview }
        if states.contains(.needsAction) { return .reviewRequirements }
        if states.contains(.failed) { return .retry }
        if !controller.hasCurrentInspection { return .checkSettings }
        return .connect
    }

    var guidanceTitle: String {
        switch guidanceStep {
        case .working: PetL10n.text("Please wait", korean: "잠시 기다려 주세요")
        case .chooseTools: PetL10n.text("Next: choose your tools", korean: "지금 할 일 · 도구 선택")
        case .storageRecovery: PetL10n.text("Blabee storage needs recovery", korean: "Blabee 저장소 복구가 필요해요")
        case .serviceIssue: PetL10n.text("Blabee could not start", korean: "Blabee 서비스를 확인해 주세요")
        case .legacyService: PetL10n.text("Check the previous Blabee service", korean: "이전 Blabee 서비스 등록을 확인해 주세요")
        case .restartService: PetL10n.text("Next: restart the service", korean: "지금 할 일 · 서비스 다시 시작")
        case .ready: PetL10n.text("Your setup is ready", korean: "연결 설정이 준비됐어요")
        case .codexRecovery: viewModel.codexConnectionRecovery?.title ?? PetL10n.text("Reconnect Codex", korean: "Codex 다시 연결")
        case .installTools: PetL10n.text("Next: install the missing tool", korean: "지금 할 일 · 도구 설치")
        case .hookReview: PetL10n.text("Review Blabee in Codex", korean: "Codex에서 Blabee를 확인해 주세요")
        case .reviewRequirements: PetL10n.text("Next: review the tool instructions", korean: "지금 할 일 · 도구별 안내 확인")
        case .retry: PetL10n.text("Next: retry the remaining setup", korean: "지금 할 일 · 남은 연결 다시 시도")
        case .checkSettings: PetL10n.text("Connect your tools", korean: "도구를 연결해 볼까요?")
        case .connect: PetL10n.text("Next: press Connect", korean: "지금 할 일 · 연결하기")
        case .connectAvailable: PetL10n.text("Next: connect \(availableToolNames)", korean: "지금 할 일 · \(availableToolNames) 연결")
        }
    }

    var guidanceDetail: String {
        switch guidanceStep {
        case .working:
            PetL10n.text("A check or setup is in progress. Wait for the result before choosing the next action.", korean: "확인 또는 설정을 진행하고 있어요. 결과가 나오면 다음 행동을 안내할게요.")
        case .chooseTools:
            PetL10n.text("Select Codex, Claude, or both above, then choose Connect.", korean: "위에서 Codex, Claude 또는 둘 다 선택한 뒤 ‘연결하기’를 누르세요.")
        case .storageRecovery:
            PetL10n.text("Blabee's storage files are missing, so setup cannot finish. Check recovery eligibility below; nothing is reset until you confirm.", korean: "Blabee 저장 파일이 없어 설정을 완료할 수 없습니다. 아래에서 복구 가능 여부를 확인하세요. 확인 후 동의하기 전에는 초기화하지 않습니다.")
        case .serviceIssue:
            controller.serviceIssue ?? viewModel.appOwnedServiceDetail
        case .legacyService:
            viewModel.legacyServiceMigrationDetail
        case .restartService:
            PetL10n.text("Press Restart Service below to continue preparing the selected tools.", korean: "아래 ‘서비스 다시 시작’을 눌러 선택한 도구의 연결 준비를 이어가세요.")
        case .ready:
            PetL10n.text("No more setup is needed here. Start a new conversation in your tool to check the live connection.", korean: "이 화면에서 더 설정할 항목은 없어요. 도구에서 새 대화를 시작하면 실제 연결 상태를 확인할 수 있어요.")
        case .codexRecovery:
            viewModel.codexConnectionRecovery?.detail ?? ""
        case .installTools:
            PetL10n.text("Install \(toolNeedingInstallation?.title ?? "the tool") and sign in using the official guide. Return here to continue setup.", korean: "공식 안내에 따라 \(toolNeedingInstallation?.title ?? "도구")를 설치하고 로그인하세요. 돌아오면 연결을 이어갈 수 있어요.")
        case .hookReview:
            PetL10n.text("Open a new Codex conversation in your working folder and enter /hooks to review Blabee. Return here for an automatic check.", korean: "작업 폴더의 새 Codex 대화에서 /hooks로 Blabee를 검토하세요. 돌아오면 승인 여부를 자동 확인합니다.")
        case .reviewRequirements:
            PetL10n.text("Review the details below and complete the required step, then check again. You can also connect that tool later.", korean: "아래 안내에 따라 필요한 항목을 완료한 뒤 다시 확인하세요. 해당 도구를 나중에 연결할 수도 있어요.")
        case .retry:
            controller.phase == .failed || controller.phase == .cancelled ? summaryDetail
                : PetL10n.text("Retry to continue from the remaining steps. Completed settings are kept.", korean: "다시 시도하면 남은 단계부터 이어갑니다. 완료된 설정은 유지됩니다.")
        case .checkSettings:
            PetL10n.text("Choose Connect. Blabee will check your tools and prepare their connection settings.", korean: "‘연결하기’를 누르면 사용 환경 확인부터 연결 설정까지 이어서 진행합니다.")
        case .connect:
            PetL10n.text("Press Connect below to prepare the selected tools.", korean: "아래 ‘연결하기’를 눌러 선택한 도구를 준비하세요.")
        case .connectAvailable:
            PetL10n.text("Connect \(availableToolNames) first. The other selected tool still needs attention; review its instructions or choose to connect it later.", korean: "\(availableToolNames)부터 연결할 수 있어요. 다른 선택한 도구는 아래 안내를 확인하거나 나중에 연결하세요.")
        }
    }

    var primaryActionIsEmphasized: Bool {
        switch guidanceStep {
        case .connect, .connectAvailable, .checkSettings, .retry, .storageRecovery, .serviceIssue, .legacyService, .restartService, .codexRecovery, .installTools, .hookReview, .reviewRequirements: true
        default: false
        }
    }

    var primaryActionTitle: String {
        switch guidanceStep {
        case .working: return controller.isWorking ? controller.phase.title : PetL10n.text("Preparing connection", korean: "연결 준비 중")
        case .storageRecovery: return PetL10n.text("Check Recovery Eligibility", korean: "복구 가능 여부 확인")
        case .serviceIssue: return viewModel.canChangeAppOwnedService
            ? (viewModel.isAppOwnedServiceEnabled
                ? PetL10n.text("Retry Blabee Service", korean: "Blabee 서비스 다시 시도")
                : PetL10n.text("Enable Blabee Service", korean: "Blabee 서비스 켜기"))
            : PetL10n.text("Check Again", korean: "다시 확인")
        case .legacyService: return viewModel.canUnregisterOnboardingService
            ? PetL10n.text("Unregister Previous Service", korean: "이전 서비스 등록 해제")
            : PetL10n.text("Check Again", korean: "다시 확인")
        case .restartService: return PetL10n.text("Restart Service", korean: "서비스 다시 시작")
        case .ready: return PetL10n.text("Recheck Settings", korean: "설정 다시 확인")
        case .installTools: return PetL10n.text("Open \(toolNeedingInstallation?.title ?? "Tool") Guide", korean: "\(toolNeedingInstallation?.title ?? "도구") 설치 안내")
        case .codexRecovery:
            if viewModel.codexConnectionRecovery?.offersAppUpdate == true {
                return viewModel.appUpdateState.availableRelease == nil
                    ? PetL10n.text("Check Blabee Updates", korean: "Blabee 업데이트 확인")
                    : PetL10n.text("Open Blabee Download", korean: "Blabee 다운로드 열기")
            }
            return PetL10n.text("Recheck and Connect", korean: "재검사 후 연결")
        case .hookReview: return PetL10n.text("Check Codex Approval", korean: "Codex 승인 확인")
        case .reviewRequirements: return PetL10n.text("Check Again", korean: "다시 확인")
        case .retry: return PetL10n.text("Retry Remaining Connections", korean: "남은 연결 다시 시도")
        case .checkSettings, .chooseTools, .connect: return PetL10n.text("Connect", korean: "연결하기")
        case .connectAvailable: return PetL10n.text("Connect \(availableToolNames)", korean: "\(availableToolNames) 연결하기")
        }
    }

    var primaryActionEnabled: Bool {
        guard !busy else { return false }
        switch guidanceStep {
        case .storageRecovery: return viewModel.canPrepareStorageRecovery
        case .serviceIssue, .legacyService: return true
        case .restartService: return viewModel.canChangeAppOwnedService
        case .codexRecovery:
            return viewModel.codexConnectionRecovery?.offersAppUpdate == true
                ? !viewModel.isCheckingForAppUpdate : viewModel.canRetryCodexPluginConnection
        case .hookReview: return viewModel.canCheckCodexHooks
        default: return controller.canConnect
        }
    }

    var showsPrimaryAction: Bool {
        guidanceStep != .ready && (!requiresStorageRecovery || requiresLegacyServiceReview)
    }

    var summaryDetail: String {
        viewModel.needsAppOwnedServiceRestartAfterLegacyCleanup
            ? viewModel.appOwnedServiceDetail : controller.detail
    }

    var workingFolderScope: PetCodexWorkingFolderScope {
        .init(paths: viewModel.configuredProjectPaths,
              areAuthoritative: viewModel.configuredProjectPathsAreAuthoritative,
              scopeExists: viewModel.configuredProjectScopeExists)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(PetL10n.text("Connect Your Tools", korean: "사용할 도구 연결")).font(.blabee(.headline))
            }
            HStack(alignment: .top, spacing: 10) {
                ForEach(PetConnectionSetupProvider.allCases) { provider in
                    providerRow(provider)
                }
            }
            PetOnboardingGuidance(title: guidanceTitle, detail: guidanceDetail,
                                  symbol: guidanceStep == .ready ? "checkmark.circle.fill" : "hand.point.up.left.fill")
                .accessibilityIdentifier("connection-setup-guidance")
            if guidanceStep == .hookReview { codexApprovalSteps }
            if requiresStorageRecovery && !requiresLegacyServiceReview {
                PetStorageRecoveryView(viewModel: viewModel, showsIntroduction: false)
                    .accessibilityIdentifier("connection-setup-storage-recovery")
            }
            if guidanceStep == .reviewRequirements || guidanceStep == .retry || guidanceStep == .connectAvailable {
                ForEach(PetConnectionSetupProvider.allCases.filter {
                    controller.selectedProviders.contains($0)
                        && [.needsAction, .failed].contains(controller.state(for: $0).status)
                }) { provider in
                    Text("\(provider.title): \(controller.state(for: provider).detail)")
                        .font(.blabee(.caption)).foregroundStyle(secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if showsPrimaryAction { connectionActions }
            if controller.selectedProviders.contains(.codex) {
                Text(workingFolderScope.summary + " " + workingFolderScope.advancedHint)
                    .font(.blabee(.caption)).foregroundStyle(secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("connection-setup-scope-summary")
            }
            if !controller.canFinish && !busy && !deferrableProviders.isEmpty { deferredProviderActions }
            DisclosureGroup(PetL10n.text("Troubleshooting and Advanced Settings", korean: "문제 해결 · 고급 설정"),
                            isExpanded: $showsAdvancedSettings) {
                advancedSettings.padding(.top, 10)
            }
            .font(.blabee(.caption))
            .accessibilityIdentifier("connection-setup-advanced")
        }
        .font(.blabee(.body))
        .buttonStyle(PetAirButtonStyle())
        .fixedSize(horizontal: false, vertical: true)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connection-setup")
        .task { await viewModel.refreshConnectionSetup() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            startSetupAction { await viewModel.refreshConnectionSetupAfterReturningToApp() }
        }
        .onDisappear {
            // Cancel only work this surface started. A disappearing old view
            // must not cancel a newer surface's shared-controller inspection.
            actionID = nil
            actionTask?.cancel()
            actionTask = nil
        }
    }

    @ViewBuilder
    private var connectionActions: some View {
        Button {
            startSetupAction { await performPrimaryAction() }
        } label: {
            Text(primaryActionTitle).frame(maxWidth: .infinity)
        }
        .buttonStyle(PetOnboardingActionButtonStyle(emphasized: primaryActionIsEmphasized))
        .disabled(!primaryActionEnabled)
        .accessibilityIdentifier("connection-setup-connect")
        if busy {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Button(PetL10n.text("Stop", korean: "중단"), action: viewModel.cancelConnectionSetup)
                    .accessibilityIdentifier("connection-setup-cancel")
            }
        } else if guidanceStep == .installTools {
            Button(PetL10n.text("Installed? Continue Setup", korean: "설치했어요 · 연결 계속하기")) {
                startSetupAction {
                    if toolNeedingInstallation == .codex, viewModel.codexConnectionRecovery != nil {
                        await viewModel.recoverAndContinueCodexSetup()
                    } else { await viewModel.connectSelectedProviders() }
                }
            }
            .font(.blabee(.caption))
            .accessibilityIdentifier("connection-setup-continue-after-install")
        } else if guidanceStep == .codexRecovery {
            if viewModel.codexConnectionRecovery?.offersAppUpdate == true {
                Text(viewModel.appUpdateState.title).font(.blabee(.caption)).foregroundStyle(secondary)
                Button(PetL10n.text("Already Updated? Recheck and Connect", korean: "업데이트했어요 · 재검사 후 연결")) {
                    startSetupAction { await viewModel.recoverAndContinueCodexSetup() }
                }
                .font(.blabee(.caption))
                .disabled(!viewModel.canRetryCodexPluginConnection)
            } else if viewModel.codexConnectionRecovery?.offersInstallGuide == true {
                Button(PetL10n.text("Codex Installation Help", korean: "Codex 설치 도움말")) {
                    viewModel.openConnectionInstallGuide(for: .codex)
                }
                .font(.blabee(.caption))
            }
        }
    }

    private func startSetupAction(_ action: @escaping @MainActor () async -> Void) {
        guard actionTask == nil else { return }
        let id = UUID()
        actionID = id
        actionTask = Task {
            await action()
            guard actionID == id else { return }
            actionID = nil
            actionTask = nil
        }
    }

    func performPrimaryAction() async {
        guard primaryActionEnabled else { return }
        switch guidanceStep {
        case .storageRecovery: await viewModel.prepareStorageRecovery()
        case .serviceIssue:
            if viewModel.canChangeAppOwnedService {
                if viewModel.isAppOwnedServiceEnabled { await viewModel.restartAppOwnedService() }
                else { await viewModel.enableAppOwnedService() }
            }
            await viewModel.refreshConnectionSetup()
        case .legacyService:
            if viewModel.canUnregisterOnboardingService { await viewModel.unregisterOnboardingService() }
            await viewModel.refreshConnectionSetup()
        case .restartService: await viewModel.restartConnectionSetupService()
        case .installTools:
            if let provider = toolNeedingInstallation { viewModel.openConnectionInstallGuide(for: provider) }
        case .codexRecovery:
            if viewModel.codexConnectionRecovery?.offersAppUpdate == true {
                if viewModel.appUpdateState.availableRelease != nil { viewModel.openAppUpdateLocation() }
                else { await viewModel.checkForAppUpdates() }
            } else { await viewModel.recoverAndContinueCodexSetup() }
        case .hookReview: await viewModel.refreshConnectionSetupAfterReturningToApp()
        case .reviewRequirements, .ready: await viewModel.refreshConnectionSetup()
        case .working, .chooseTools: break
        case .retry, .checkSettings, .connect, .connectAvailable: await viewModel.connectSelectedProviders()
        }
    }

    private var codexApprovalSteps: some View {
        HStack(spacing: 6) {
            Text(verbatim: "/hooks").font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 5))
            Text(PetL10n.text("→ review and enable Blabee", korean: "→ Blabee 검토·활성화"))
        }
        .font(.blabee(.caption))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("connection-setup-codex-approval")
    }

    private var deferrableProviders: [PetConnectionSetupProvider] {
        PetConnectionSetupProvider.allCases.filter {
            controller.selectedProviders.contains($0)
                && [.needsInstall, .needsAction, .failed].contains(controller.state(for: $0).status)
        }
    }

    private var deferredProviderActions: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(deferrableProviders) { provider in
                Button(PetL10n.text("Connect \(provider.title) Later", korean: "\(provider.title)는 나중에 연결")) {
                    viewModel.setConnectionProviderSelected(provider, selected: false)
                }
                .buttonStyle(.link)
                .font(.blabee(.caption))
                .accessibilityIdentifier("connection-setup-defer-\(provider.rawValue)")
            }
        }
    }

    func providerStatusTitle(for provider: PetConnectionSetupProvider) -> String {
        let status = controller.state(for: provider).status
        if controller.serviceIssue != nil, [.available, .configured].contains(status) {
            return PetL10n.text("Waiting for Blabee", korean: "Blabee 준비 대기")
        }
        return status.title
    }

    private func providerRow(_ provider: PetConnectionSetupProvider) -> some View {
        let state = controller.state(for: provider)
        let selected = controller.selectedProviders.contains(provider)
        return VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(
                get: { controller.selectedProviders.contains(provider) },
                set: { viewModel.setConnectionProviderSelected(provider, selected: $0) }
            )) {
                HStack(spacing: 6) {
                    Text(provider.title).font(.blabee(.callout, weight: .semibold))
                    Spacer(minLength: 0)
                    Image(systemName: provider == .codex ? "terminal.fill" : "asterisk")
                        .foregroundStyle(selected ? accent : secondary).accessibilityHidden(true)
                }
            }
            .toggleStyle(.checkbox)
            .disabled(busy)
            .accessibilityIdentifier("connection-setup-select-\(provider.rawValue)")
            Text(providerStatusTitle(for: provider)).font(.blabee(.caption2, weight: .semibold))
                .foregroundStyle(state.status == .failed ? Color.red : secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .topLeading)
        .petInsetSurface(emphasized: selected, cornerRadius: PetPanelVisualStyle.rowRadius)
        .overlay {
            RoundedRectangle(cornerRadius: PetPanelVisualStyle.rowRadius, style: .continuous)
                .strokeBorder(selected ? accent.opacity(0.8) : secondary.opacity(0.25),
                              lineWidth: selected ? 2 : 1)
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
    }

    private var advancedSettings: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !summaryDetail.isEmpty {
                Text(summaryDetail).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("connection-setup-summary")
            }
            ForEach(PetConnectionSetupProvider.allCases.filter { controller.selectedProviders.contains($0) }) { provider in
                let state = controller.state(for: provider)
                VStack(alignment: .leading, spacing: 5) {
                    Text(provider.title).fontWeight(.semibold)
                    Text(state.detail).fixedSize(horizontal: false, vertical: true)
                    Label(state.sessionEvidence.title,
                          systemImage: state.sessionEvidence == .ready ? "checkmark.circle" : "clock")
                        .accessibilityIdentifier("connection-setup-session-\(provider.rawValue)")
                }
            }
            if controller.selectedProviders.contains(.codex) {
                projectScope
                if let report = viewModel.codexNativeRecheckReport {
                    CodexPluginRecheckReportView(report: report)
                }
            }
            if viewModel.showsLegacyServiceSettings {
                Text(viewModel.legacyServiceMigrationDetail).fixedSize(horizontal: false, vertical: true)
                if viewModel.canUnregisterOnboardingService {
                    Button(PetL10n.text("Unregister Previous Service", korean: "이전 서비스 등록 해제")) {
                        Task {
                            await viewModel.unregisterOnboardingService()
                            await viewModel.refreshConnectionSetup()
                        }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("connection-setup-remove-legacy-service")
                }
            }
            Button(PetL10n.text("Recheck Settings", korean: "설정 다시 확인")) {
                Task { await viewModel.refreshConnectionSetup() }
            }
            .disabled(busy)
            .accessibilityIdentifier("connection-setup-refresh")
            Text(PetL10n.text("Codex and Claude installation and account sign-in are separate. Blabee sets up its own connections and does not approve tool permissions for you.", korean: "Codex·Claude 설치와 계정 로그인은 별도입니다. Blabee는 연결 설정을 준비하며 도구의 권한을 대신 승인하지 않습니다."))
                .fixedSize(horizontal: false, vertical: true)
            if controller.selectedProviders.contains(.claude) {
                Text(PetL10n.text("Claude: run claude in a new zsh terminal and review sign-in, project trust, and MCP approval requests. Other shell options are in Settings → Connection → Claude.", korean: "Claude: 새 zsh 터미널에서 claude를 실행한 뒤 로그인·프로젝트 신뢰·MCP 요청을 확인하세요. 다른 셸의 연결 방법은 설정 → 연결 → Claude에서 확인할 수 있어요."))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(PetL10n.text("Setup completion is separate from receiving a card and successfully returning your selection to a conversation.", korean: "설정 완료, 카드 수신, 선택한 작업이 원래 대화로 전달되는지는 각각 따로 확인합니다."))
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.blabee(.caption)).foregroundStyle(secondary)
    }

    private var projectScope: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(PetL10n.text("Codex Working Folders", korean: "Codex 작업 폴더")).font(.blabee(.callout, weight: .semibold))
            Text(workingFolderScope.summary)
                .font(.blabee(.caption)).foregroundStyle(secondary)
            if workingFolderScope == .configured {
                ForEach(viewModel.configuredProjectPaths, id: \.self) { path in
                    Label(path, systemImage: "folder")
                        .font(.blabee(.caption)).lineLimit(2).truncationMode(.middle)
                        .help(path).textSelection(.enabled)
                }
            }
            Button(PetL10n.text("Add Working Folder", korean: "작업 폴더 추가")) {
                Task {
                    await viewModel.chooseAndEnableProject()
                    await viewModel.refreshConnectionSetup()
                }
            }
            .disabled(busy || !viewModel.canMutateOnboardingProjects)
            .accessibilityIdentifier("connection-setup-add-project")
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("connection-setup-project-scope")
    }
}
