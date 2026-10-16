import SwiftUI

/// Shared by first run and settings. Configuration and live session evidence
/// stay separate, and only an explicit button starts a setup mutation.
@MainActor
struct PetConnectionSetupView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject private var viewModel: PetViewModel
    @ObservedObject private var controller: PetConnectionSetupController
    @Environment(\.colorScheme) private var colorScheme

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        _controller = ObservedObject(wrappedValue: viewModel.connectionSetup)
    }

    private var secondary: Color { PetAirPalette.secondary(for: colorScheme) }
    private var busy: Bool { controller.isWorking || viewModel.isOnboardingOperationInFlight }

    var primaryActionTitle: String {
        if controller.isWorking { return PetL10n.text("Preparing connection", korean: "연결 준비 중") }
        if viewModel.needsAppOwnedServiceRestartAfterLegacyCleanup { return PetL10n.text("Restart Service", korean: "서비스 다시 시작") }
        if controller.canFinish { return PetL10n.text("Recheck Settings", korean: "설정 다시 확인") }
        if controller.selectedProviders.contains(where: { controller.state(for: $0).status == .failed }) {
            return PetL10n.text("Retry Remaining Connections", korean: "남은 연결 다시 시도")
        }
        return PetL10n.text("Connect", korean: "연결하기")
    }

    var primaryActionEnabled: Bool {
        !busy && (viewModel.needsAppOwnedServiceRestartAfterLegacyCleanup
            ? viewModel.canChangeAppOwnedService : controller.canConnect)
    }

    var summaryDetail: String {
        viewModel.needsAppOwnedServiceRestartAfterLegacyCleanup
            ? viewModel.appOwnedServiceDetail : controller.detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(PetL10n.text("Connect Your Tools", korean: "사용할 도구 연결")).font(.blabee(.headline))
                Text(PetL10n.text("Choose tools to prepare their connection settings together.", korean: "도구를 선택하면 필요한 연결 설정을 함께 준비합니다."))
                    .font(.blabee(.caption)).foregroundStyle(secondary)
            }
            VStack(spacing: 12) {
                ForEach(PetConnectionSetupProvider.allCases) { provider in
                    providerRow(provider)
                }
            }
            if controller.selectedProviders.contains(.codex) {
                projectScope
            }
            if !summaryDetail.isEmpty {
                Text(summaryDetail)
                    .font(.blabee(.callout))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("connection-setup-summary")
            }
            if controller.selectedProviders.contains(.codex),
               viewModel.codexHookReadiness != .trusted,
               case .installedNeedsHookReview = viewModel.codexPluginSetupState {
                VStack(alignment: .leading, spacing: 8) {
                    Text(PetL10n.text("Open /hooks in Codex, review Blabee, then check again.", korean: "Codex에서 /hooks를 열어 Blabee를 검토한 뒤 다시 확인해 주세요."))
                        .font(.blabee(.caption)).foregroundStyle(secondary)
                    Button(PetL10n.text("Recheck After Review", korean: "확인 후 다시 검사")) {
                        Task {
                            await viewModel.checkCodexHooks()
                            await viewModel.refreshConnectionSetup()
                        }
                    }
                    .disabled(busy || !viewModel.canCheckCodexHooks)
                    .accessibilityIdentifier("connection-setup-check-hooks")
                }
            }
            if viewModel.showsLegacyServiceSettings {
                Text(viewModel.legacyServiceMigrationDetail)
                    .font(.blabee(.caption)).foregroundStyle(secondary)
                    .fixedSize(horizontal: false, vertical: true)
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
            HStack(spacing: 10) {
                Button(primaryActionTitle) {
                    Task {
                        if viewModel.needsAppOwnedServiceRestartAfterLegacyCleanup {
                            await viewModel.restartConnectionSetupService()
                        } else if controller.canFinish { await viewModel.refreshConnectionSetup() }
                        else { await viewModel.connectSelectedProviders() }
                    }
                }
                .buttonStyle(PetAirButtonStyle(emphasized: true))
                .disabled(!primaryActionEnabled)
                .accessibilityIdentifier("connection-setup-connect")
                if controller.isWorking {
                    ProgressView().controlSize(.small)
                    Button(PetL10n.text("Stop", korean: "중단"), action: controller.cancel)
                        .accessibilityIdentifier("connection-setup-cancel")
                } else if !controller.canFinish {
                    Button(PetL10n.text("Check Again", korean: "다시 확인")) { Task { await viewModel.refreshConnectionSetup() } }
                        .disabled(busy)
                        .accessibilityIdentifier("connection-setup-refresh")
                }
            }
            if controller.selectedProviders.isEmpty {
                Text(PetL10n.text("Choose the tools to connect. You can prepare connections later in Settings.", korean: "연결할 도구를 선택하세요. 지금 연결하지 않아도 설정에서 다시 준비할 수 있어요."))
                    .font(.blabee(.caption)).foregroundStyle(secondary)
            } else {
                Text(PetL10n.text("Once ready, start as usual in a new terminal. Existing conversations stay open.", korean: "준비가 끝나면 새 터미널에서 평소처럼 시작하세요. 실행 중인 대화는 그대로 유지됩니다."))
                    .font(.blabee(.caption)).foregroundStyle(secondary)
            }
            DisclosureGroup(PetL10n.text("Connection Scope and Approvals", korean: "연결 범위와 승인 안내")) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(PetL10n.text("Tool installation and account sign-in are separate. This button does not install new tools or approve sign-in or permission requests for you.", korean: "도구 설치와 계정 로그인은 별도입니다. 이 버튼으로 새 도구를 설치하거나 로그인·권한 요청을 대신 승인하지 않습니다."))
                    if controller.selectedProviders.contains(.claude) {
                        Text(PetL10n.text("Claude connects through MCP and Hooks. Review sign-in, project trust, and MCP connection approval requests in the opened Claude window.", korean: "Claude는 MCP·Hook으로 연결됩니다. 로그인·프로젝트 신뢰·MCP 연결 승인 요청은 열린 Claude 창에서 확인해 주세요."))
                        Text(PetL10n.text("Auto-connect applies to supported new zsh terminals. For other shells, check support and connection options under Claude connection details in Settings.", korean: "자동 연결은 지원되는 새 zsh 터미널부터 적용됩니다. 다른 셸은 설정의 Claude 연결 상세에서 지원 여부와 새 연결 방법을 확인하세요."))
                    }
                    Text(PetL10n.text("Completed setup does not verify an actual session connection or selection delivery. Current connection status is shown separately for each tool.", korean: "설정 완료는 실제 세션의 연결이나 선택 전달이 확인됐다는 뜻은 아닙니다. 도구별 현재 연결 상태를 따로 표시합니다."))
                }
                .font(.blabee(.caption)).foregroundStyle(secondary)
                .padding(.top, 8)
            }
            .font(.blabee(.caption))
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
    }

    private func providerRow(_ provider: PetConnectionSetupProvider) -> some View {
        let state = controller.state(for: provider)
        let selected = controller.selectedProviders.contains(provider)
        return VStack(alignment: .leading, spacing: 9) {
            Toggle(isOn: Binding(
                get: { controller.selectedProviders.contains(provider) },
                set: { viewModel.setConnectionProviderSelected(provider, selected: $0) }
            )) {
                HStack(spacing: 8) {
                    Image(systemName: provider == .codex ? "terminal.fill" : "asterisk")
                        .frame(width: 18).accessibilityHidden(true)
                    Text(provider.title).font(.blabee(.callout, weight: .semibold))
                    Spacer(minLength: 0)
                    Text(state.status.title).font(.blabee(.caption))
                        .foregroundStyle(state.status == .failed ? Color.red : secondary)
                }
            }
            .toggleStyle(.checkbox)
            .disabled(busy)
            .accessibilityIdentifier("connection-setup-select-\(provider.rawValue)")
            Text(state.detail)
                .font(.blabee(.caption)).foregroundStyle(secondary)
                .fixedSize(horizontal: false, vertical: true)
            if state.status == .configured || state.sessionEvidence != .notObserved {
                Label(state.sessionEvidence.title,
                      systemImage: state.sessionEvidence == .ready ? "checkmark.circle" : "clock")
                    .font(.blabee(.caption))
                    .foregroundStyle(state.sessionEvidence == .ready ? Color.green : secondary)
                    .accessibilityIdentifier("connection-setup-session-\(provider.rawValue)")
            }
            if state.status == .needsInstall {
                Button(PetL10n.text("\(provider.title) Installation Guide", korean: "\(provider.title) 설치 안내")) {
                    viewModel.openConnectionInstallGuide(for: provider)
                }
                .disabled(busy)
                .accessibilityIdentifier("connection-setup-install-\(provider.rawValue)")
            }
            if selected && [.needsInstall, .needsAction, .failed].contains(state.status) {
                Button(PetL10n.text("Connect \(provider.title) Later", korean: "\(provider.title)는 나중에 연결")) {
                    viewModel.setConnectionProviderSelected(provider, selected: false)
                }
                .buttonStyle(.link)
                .font(.blabee(.caption))
                .disabled(busy)
                .accessibilityIdentifier("connection-setup-defer-\(provider.rawValue)")
            }
        }
        .padding(12)
        .petInsetSurface(emphasized: selected, cornerRadius: PetPanelVisualStyle.rowRadius)
        .accessibilityElement(children: .contain)
    }

    private var projectScope: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(PetL10n.text("Codex Working Folders", korean: "Codex 작업 폴더")).font(.blabee(.callout, weight: .semibold))
            if !viewModel.configuredProjectPathsAreAuthoritative {
                Text(PetL10n.text("Checking working folder settings.", korean: "작업 폴더 설정을 확인하고 있어요."))
                    .font(.blabee(.caption)).foregroundStyle(secondary)
            } else if viewModel.configuredProjectPaths.isEmpty {
                Text(PetL10n.text("Choose Connect to select a working folder.", korean: "‘연결하기’를 누르면 사용할 작업 폴더를 선택합니다."))
                    .font(.blabee(.caption)).foregroundStyle(secondary)
            } else {
                ForEach(viewModel.configuredProjectPaths, id: \.self) { path in
                    Label(path, systemImage: "folder")
                        .font(.blabee(.caption)).lineLimit(2).truncationMode(.middle)
                        .help(path).textSelection(.enabled)
                }
                Text(PetL10n.text("Applies only to registered folders and their subfolders.", korean: "등록한 폴더와 하위 폴더에만 적용됩니다."))
                    .font(.blabee(.caption)).foregroundStyle(secondary)
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
