import CoordinatorSwift
import SwiftUI

/// Air settings keeps the existing model operations and drafts; tabs only change presentation.
struct PetSettingsView: View {
    @ObservedObject var viewModel: PetViewModel
    @ObservedObject private var updateController: AppUpdateTransactionController
    private var selectedTab: PetSettingsTab { viewModel.selectedSettingsTab }
    @State private var showServiceSettings = false
    @State private var showPluginDetails = false
    @State private var showConnectionVerification = false
    @State private var showUpdateDetails = false

    init(viewModel: PetViewModel) {
        self.viewModel = viewModel
        _updateController = ObservedObject(wrappedValue: viewModel.automaticAppUpdate)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Blabee 설정")
                .font(.title2.weight(.semibold))
            tabBar
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        pane(scroll: scroll)
                        if let error = viewModel.onboardingError {
                            Label(error, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundStyle(.red)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 4)
                }
                .onChange(of: viewModel.appUpdateSettingsRequestID) { _ in
                    viewModel.selectSettingsTab(.general)
                    showUpdateDetails = needsUpdateAttention
                    scroll.scrollTo("settings-top", anchor: .top)
                }
            }
            settingsFooter
        }
        .onChange(of: viewModel.appUpdateState) { _ in
            if needsUpdateAttention { showUpdateDetails = true }
        }
        .onChange(of: updateController.phase) { phase in
            if phase != .idle { showUpdateDetails = true }
        }
        .task {
            updateController.loadLastResult()
            if needsUpdateAttention { showUpdateDetails = true }
        }
        .accessibilityIdentifier("air-settings")
    }

    private var tabBar: some View {
        HStack(spacing: 3) {
            ForEach(PetSettingsTab.allCases) { tab in
                Button {
                    viewModel.selectSettingsTab(tab)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.symbol).font(.system(size: 12))
                        Text(tab.title).font(.system(size: 13, weight: .medium))
                    }
                    .frame(maxWidth: .infinity, minHeight: 47)
                    .contentShape(Capsule())
                    .background {
                        if selectedTab == tab {
                            Capsule().fill(Color(nsColor: .controlBackgroundColor).opacity(0.75))
                                .overlay(Capsule().strokeBorder(.white.opacity(0.75), lineWidth: 1))
                        }
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(selectedTab == tab ? Color.primary : Color.secondary)
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
                .accessibilityIdentifier("settings-tab-\(tab.rawValue)")
            }
        }
        .padding(4)
        .frame(height: 57)
        .petInsetSurface(cornerRadius: 999)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("설정 분류")
    }

    @ViewBuilder
    private func pane(scroll: ScrollViewProxy) -> some View {
        switch selectedTab {
        case .general:
            generalSettings.id("settings-top")
        case .shortcuts:
            shortcutSettings.id("settings-top")
        case .projects:
            onboardingProjects.id("connection-projects")
        case .connection:
            connectionSettings(scroll: scroll).id("settings-top")
        }
    }

    private var generalSettings: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("연결 상태와 실제 동작을 나누어 확인해요.")
                .font(.caption).foregroundStyle(.secondary)
            VStack(spacing: 0) {
                summaryRow("Blabee 서비스", title: serviceSummary, tone: serviceTone)
                Divider()
                summaryRow("Codex Plugin", title: codexPluginSetupBadgeTitle,
                           tone: .codexPlugin(viewModel.codexPluginSetupState))
                Divider()
                summaryRow("Hook 신뢰", title: viewModel.codexHookReadiness.title,
                           tone: .hookTrust(viewModel.codexHookReadiness))
                Divider()
                summaryRow("관찰 프로젝트", title: viewModel.configuredProjectPathsAreAuthoritative
                           ? "\(viewModel.configuredProjectPaths.count)개" : "확인 전",
                           tone: projectTone)
                Divider()
                summaryRow("원래 대화로 선택 전달", title: "확인 필요", tone: .neutral)
            }
            .petInsetSurface()

            if let preferences = viewModel.firstRunPreferences {
                PetGeneralPreferencesView(preferences: preferences)
            }

            if let account = viewModel.account {
                DisclosureGroup("계정") {
                    PetAccountView(controller: account).padding(.top, 10)
                }
                .id("account")
            }
            if let usageAnalytics = viewModel.usageAnalytics {
                DisclosureGroup("사용 통계") {
                    PetUsageAnalyticsView(analytics: usageAnalytics).padding(.top, 10)
                }
            }
            if let errorDiagnostics = viewModel.errorDiagnostics {
                DisclosureGroup("오류 진단") {
                    PetErrorDiagnosticsView(diagnostics: errorDiagnostics).padding(.top, 10)
                }
            }
            if viewModel.feedback != nil {
                VStack(alignment: .leading, spacing: 8) {
                    Text("제품 개선에 참여하기").font(.headline)
                    Text("사용 목적과 의견을 보내거나, 직접 고른 대화를 공유할 수 있어요. 보낸 내역도 확인하고 삭제할 수 있습니다.")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("의견 보내기 · 내역 관리", action: viewModel.requestFeedback)
                        .accessibilityIdentifier("settings-feedback")
                }
                .padding(12)
                .petInsetSurface()
            }
            DisclosureGroup("후속 제안") {
                suggestionModeCard.padding(.top, 10)
            }
            if showUpdateDetails {
                PetAppUpdateView(viewModel: viewModel, showsCheckForUpdates: false)
                    .padding(16)
                    .petInsetSurface()
                    .id("app-update")
            }
        }
    }

    private func summaryRow(_ label: String, title: String, tone: PetSettingsStatusTone) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.system(size: 14, weight: .medium))
            Spacer(minLength: 8)
            HStack(spacing: 5) {
                Circle().fill(tone.color).frame(width: 5, height: 5)
                Text(title).font(.caption).foregroundStyle(tone.color)
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 57)
        .accessibilityElement(children: .combine)
    }

    private var serviceTone: PetSettingsStatusTone {
        viewModel.connectionReadiness.checks.first(where: { $0.id == "service" })
            .map { .check($0.state) } ?? .neutral
    }

    private var projectTone: PetSettingsStatusTone {
        viewModel.connectionReadiness.checks.first(where: { $0.id == "projects" })
            .map { .check($0.state) } ?? .neutral
    }

    private var serviceSummary: String {
        switch viewModel.connectionReadiness.checks.first(where: { $0.id == "service" })?.state {
        case .confirmed: "연결됨"
        case .checking: "확인 중"
        case .failed: "연결 오류"
        case .attention: "확인 필요"
        case .pending, nil: "확인 전"
        }
    }

    private var needsUpdateAttention: Bool {
        switch viewModel.appUpdateState {
        case .available, .unavailable, .noPublishedRelease: true
        default: updateController.phase != .idle
        }
    }

    @ViewBuilder
    private var settingsFooter: some View {
        VStack(spacing: 12) {
            Divider()
            if selectedTab == .shortcuts {
                HStack(spacing: 8) {
                    Button("기본값", action: viewModel.restoreDefaultShortcutDraft)
                        .help("단축키 기본값 불러오기")
                    Spacer(minLength: 0)
                    Button("취소", action: viewModel.cancelShortcutSettings)
                    Button("저장", action: viewModel.saveShortcutSettings)
                        .buttonStyle(.borderedProminent)
                        .petCapsuleButtonBorder()
                        .disabled(!viewModel.canSaveShortcutSettings)
                }
                .buttonStyle(.bordered)
                .petCapsuleButtonBorder()
            } else {
                HStack(spacing: 12) {
                    Button {
                        viewModel.selectSettingsTab(.general)
                        showUpdateDetails.toggle()
                    } label: {
                        HStack(spacing: 5) {
                            Text(viewModel.appVersionDisplay)
                            Image(systemName: "chevron.\(showUpdateDetails ? "up" : "down")")
                                .font(.system(size: 9, weight: .medium))
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("앱 업데이트와 Codex 자동 복원 설정")
                    .accessibilityLabel("업데이트 및 Codex 자동 복원 설정")
                    .accessibilityIdentifier("app-update-details")
                    Spacer(minLength: 0)
                    PetAppUpdateCheckButton(state: viewModel.appUpdateState) {
                        viewModel.selectSettingsTab(.general)
                        Task { await viewModel.checkForAppUpdates() }
                    }
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var shortcutSettings: some View {
        VStack(alignment: .leading, spacing: 16) {
            choicePreviewShortcutSettings
            Divider()
            VStack(alignment: .leading, spacing: 4) {
                Text("선택 실행 · 패널 열기").font(.callout.bold())
                Text("이 단축키는 Option을 포함해야 하며, Option 단독은 숫자와 Space에만 사용할 수 있습니다.")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(PetShortcutIntent.allCases, id: \.self) { intent in
                shortcutSettingRow(intent)
            }
            if let error = viewModel.shortcutSettingsError {
                Text(error).font(.caption).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .petInsetSurface()
    }

    private func connectionSettings(scroll: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            connectionReadinessCard(scroll: scroll)
            DisclosureGroup("Codex에서 동작 확인", isExpanded: $showConnectionVerification) {
                connectionVerificationSteps.padding(.top, 10)
            }
            .id("connection-verification")
            DisclosureGroup(isExpanded: $showPluginDetails) {
                codexPluginSetupCard.padding(.top, 10)
            } label: {
                HStack(spacing: 8) {
                    PetSettingsStatusDot(tone: .codexPlugin(viewModel.codexPluginSetupState))
                    Text("Codex 설치 · 진단 상세")
                    Text(codexPluginSetupBadgeTitle).font(.caption2).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(codexPluginInstallationTitle)
            }
            .id("connection-plugin")
            DisclosureGroup(isExpanded: $showServiceSettings) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("자동 시작 등록은 필수가 아닙니다. 앱 실행형 서비스가 연결되어 있으면 Blabee를 사용할 수 있습니다.")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if viewModel.isAppOwnedServiceAvailable { appOwnedServiceSettings }
                    if viewModel.projectSettingsNeedRestart, !viewModel.isAppOwnedServiceEnabled {
                        Text("자동 시작 서비스를 사용 중이라면 아래 ‘등록 해제’가 완료된 뒤 ‘서비스 등록’을 눌러 새 설정으로 시작하세요. 진행 중인 Blabee 선택·권한 요청을 먼저 마친 뒤 적용해 주세요. Codex 세션과 프로젝트 파일은 변경하지 않습니다.")
                            .font(.caption).foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    onboardingAutomaticServiceSettings
                }
                .padding(.top, 10)
            } label: {
                HStack(spacing: 8) {
                    PetSettingsStatusDot(tone: serviceTone)
                    Text("서비스 관리 · 자동 시작 (선택)")
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(viewModel.connectionReadiness.checks.first(where: { $0.id == "service" })?.detail ?? "서비스 상태 확인 전")
            }
            .id("connection-service")
            DisclosureGroup("이전 Codex 연결 정리") {
                LegacyCodexShellCleanupView(viewModel: viewModel).padding(.top, 10)
            }
        }
    }

    private var choicePreviewShortcutSettings: some View {
        let preset = viewModel.shortcutDraft.previewPreset
        return VStack(alignment: .leading, spacing: 8) {
            Text("상세 미리보기")
                .font(.callout.bold())
            Picker(
                "상세 미리보기 단축키",
                selection: Binding(
                    get: { viewModel.shortcutDraft.previewPreset },
                    set: { viewModel.updatePreviewShortcutDraft($0) }
                )
            ) {
                ForEach(PetChoicePreviewShortcutPreset.allCases) { preset in
                    Text(verbatim: preset.displayLabel).tag(preset)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .accessibilityIdentifier("choice-preview-shortcut-preset")

            if preset == .disabled {
                Text("상세 미리보기 단축키를 사용하지 않습니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("\(preset.displayLabel)을 누른 뒤 \(preset.holdKeyName) 키를 누르고 있으면 유지됩니다. \(preset.holdKeyName) 키를 떼면 닫힙니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if preset == .control {
                Text("macOS의 데스크탑 전환 단축키와 겹칠 수 있습니다. 겹치면 시스템 설정 → 키보드 → 키보드 단축키 → Mission Control에서 같은 단축키를 해제하거나 다른 조합을 선택하세요.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if preset == .controlOption {
                Text("VoiceOver의 Control+Option 단축키와 겹칠 수 있습니다. 필요하면 다른 조합을 선택하거나 미리보기를 꺼 주세요.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if preset == .controlCommand {
                Text("Safari의 단축키와 겹칠 수 있습니다. 필요하면 다른 조합을 선택하거나 미리보기를 꺼 주세요.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func connectionReadinessCard(scroll: ScrollViewProxy) -> some View {
        let readiness = viewModel.connectionReadiness
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                PetSettingsStatusDot(tone: .connection(readiness))
                    .padding(.top, 6)
                VStack(alignment: .leading, spacing: 6) {
                    Text(readiness.title)
                        .font(.title3.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(readiness.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("connection-readiness-summary")

            VStack(spacing: 10) {
                ForEach(readiness.checks) { check in
                    HStack(alignment: .top, spacing: 10) {
                        PetSettingsStatusDot(tone: .check(check.state))
                            .frame(width: 18)
                            .padding(.top, 3)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(check.title).font(.caption.weight(.semibold))
                            Text(check.detail)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("connection-check-\(check.id)")
                }
            }

            PetSettingsStatusLegend()

            HStack(spacing: 8) {
                Button(viewModel.connectionNextStepTitle) {
                    performConnectionNextStep(readiness.nextStep, scroll: scroll)
                }
                .buttonStyle(.borderedProminent)
                .petCapsuleButtonBorder()
                .disabled(viewModel.isOnboardingOperationInFlight)
                .accessibilityIdentifier("connection-next-step")
                Spacer(minLength: 0)
                if viewModel.isOnboardingOperationInFlight {
                    ProgressView().controlSize(.small)
                        .accessibilityLabel("연결 상태 확인 중")
                }
                Button {
                    Task { await viewModel.refreshAllOnboardingSettings() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .petCircleButtonBorder()
                .disabled(viewModel.isOnboardingOperationInFlight)
                .accessibilityLabel("연결 상태 새로고침")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface(emphasized: true)
    }

    private func performConnectionNextStep(
        _ step: PetConnectionReadiness.NextStep, scroll: ScrollViewProxy
    ) {
        let destination: String
        switch step {
        case .refresh:
            Task { await viewModel.refreshAllOnboardingSettings() }
            return
        case .installPlugin where viewModel.canConnectCodexPlugin:
            Task { await viewModel.connectCodexPlugin() }
            return
        case .restartService where viewModel.isAppOwnedServiceEnabled
            && viewModel.canChangeAppOwnedService:
            Task { await viewModel.restartAppOwnedService() }
            return
        case .service, .restartService:
            showServiceSettings = true
            destination = "connection-service"
        case .installPlugin, .pluginDetails:
            showPluginDetails = true
            destination = "connection-plugin"
        case .checkHooks:
            showPluginDetails = true
            destination = "connection-plugin"
            Task { await viewModel.checkCodexHooks() }
        case .projects:
            viewModel.selectSettingsTab(.projects)
            destination = "connection-projects"
        case .verifyInCodex:
            showConnectionVerification = true
            destination = "connection-verification"
        }
        // Allow an expanded disclosure to lay out before scrolling to it.
        Task { @MainActor in
            await Task.yield()
            scroll.scrollTo(destination, anchor: .top)
        }
    }

    private var connectionVerificationSteps: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("1. 현재 Codex 작업 폴더가 위 프로젝트 목록에 포함되는지 확인하세요. 다른 worktree는 별도 폴더입니다.")
            Text("2. Codex에서 /hooks를 열어 Blabee Hook의 활성·신뢰 상태를 확인하세요. 이미 신뢰했다면 시작할 때 승인 창이 다시 뜨지 않을 수 있습니다.")
            Text("SessionStart · UserPromptSubmit · Stop · PermissionRequest")
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text("3. 새 요청을 보내고 답변 뒤 선택 카드가 도착하는지 확인하세요. 카드를 선택한 뒤 원래 Codex 세션에서 다음 요청이 시작되는지까지 확인해야 왕복 검증이 완료됩니다.")
            Text("카드 수신은 Hook 전체의 신뢰나 선택 반환 성공을 보장하지 않습니다. 이 화면에서 Codex를 대신 승인하거나 테스트 요청을 자동 전송하지 않습니다.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .font(.caption)
        .fixedSize(horizontal: false, vertical: true)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface()
    }

    private var onboardingAutomaticServiceSettings: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 12) {
                Image(systemName: onboardingServiceSymbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(onboardingServiceColor)
                    .frame(width: 38, height: 38)
                    .background(onboardingServiceColor.opacity(0.13), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("macOS 자동 시작 서비스")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(viewModel.onboardingServiceState.displayTitle)
                        .font(.body.weight(.semibold))
                }
                Spacer(minLength: 8)
                PetSettingsStatusBadge(
                    tone: onboardingServiceTone,
                    title: onboardingServiceBadgeTitle
                )
                .accessibilityIdentifier("automatic-service-status")
            }
            Text(viewModel.onboardingServiceState.displayDescription)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if viewModel.onboardingServiceNeedsRuntimeAttention,
               let coordinatorError = viewModel.coordinatorTransportError
            {
                VStack(alignment: .leading, spacing: 5) {
                    Label(
                        "서비스는 등록되어 있지만 Coordinator에 연결하지 못했습니다.",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                        .font(.caption.weight(.semibold))
                    Text(coordinatorError)
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(onboardingServiceColor)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    onboardingServiceColor.opacity(0.10),
                    in: RoundedRectangle(cornerRadius: 12)
                )
            }
            onboardingServiceActions
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface(emphasized: true)
    }

    private var onboardingProjects: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        if let check = viewModel.connectionReadiness.checks.first(where: { $0.id == "projects" }) {
                            PetSettingsStatusDot(tone: .check(check.state))
                        }
                        Text("관찰할 프로젝트")
                            .font(.body.weight(.semibold))
                    }
                    Text("현재 Codex 작업 폴더가 이 목록에 포함되어야 합니다. 등록한 폴더와 그 하위 경로에만 적용됩니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button {
                    Task { await viewModel.chooseAndEnableProject() }
                } label: {
                    Label("폴더 추가", systemImage: "plus")
                        .fixedSize()
                }
                .buttonStyle(.borderedProminent)
                .petCapsuleButtonBorder()
                .controlSize(.small)
                .disabled(!viewModel.canMutateOnboardingProjects)
            }

            if !viewModel.configuredProjectPathsAreAuthoritative {
                projectMessageRow(
                    "프로젝트 설정을 확인할 수 없습니다.",
                    systemImage: "questionmark.folder"
                )
            } else if viewModel.configuredProjectPaths.isEmpty {
                projectMessageRow(
                    "설정된 프로젝트가 없습니다.",
                    systemImage: "folder.badge.plus"
                )
            } else {
                ForEach(viewModel.configuredProjectPaths, id: \.self) { path in
                    configuredProjectRow(path)
                }
            }

            ForEach(viewModel.activeOnlyProjectPaths, id: \.self) { path in
                activeOnlyProjectRow(path)
            }

            if viewModel.projectSettingsNeedRestart {
                Label(
                    "변경한 프로젝트가 아직 서비스에 적용되지 않았습니다.",
                    systemImage: "arrow.clockwise.circle"
                )
                .font(.caption)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
                if viewModel.isAppOwnedServiceEnabled {
                    Button("서비스 다시 시작하여 적용") {
                        Task { await viewModel.restartAppOwnedService() }
                    }
                    .buttonStyle(.borderedProminent)
                    .petCapsuleButtonBorder()
                    .disabled(!viewModel.canChangeAppOwnedService)
                } else {
                    Button("연결 탭에서 서비스 관리") {
                        viewModel.selectSettingsTab(.connection)
                        showServiceSettings = true
                    }
                    .buttonStyle(.bordered)
                    .petCapsuleButtonBorder()
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface()
    }

    private var codexPluginSetupCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 12) {
                Image(systemName: codexPluginSetupSymbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(codexPluginSetupColor)
                    .frame(width: 38, height: 38)
                    .background(codexPluginSetupColor.opacity(0.13), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Codex 연결")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(codexPluginInstallationTitle)
                        .font(.body.weight(.semibold))
                }
                Spacer(minLength: 8)
                PetSettingsStatusBadge(
                    tone: .codexPlugin(viewModel.codexPluginSetupState),
                    title: codexPluginSetupBadgeTitle
                )
                .accessibilityIdentifier("codex-plugin-installation-status")
            }

            Text(codexPluginInstallationDetail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let report = viewModel.codexNativeRecheckReport {
                CodexPluginRecheckReportView(report: report)
            }

            if case let .legacyInstallationDetected(marketplaceName, _) = viewModel.codexPluginSetupState {
                VStack(alignment: .leading, spacing: 8) {
                    Label("이전 Blabee 연결이 감지되었습니다", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                    Text("감지된 연결: \(marketplaceName)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                    Text("계속하면 이 이전 Blabee 연결만 정리한 뒤 현재 앱의 Blabee Plugin을 연결합니다. Codex 자체와 다른 Plugin은 변경하지 않습니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if viewModel.isConfirmingLegacyCodexPluginMigration {
                        Divider()
                        Text("정리 대상을 다시 확인했습니다. 아래 버튼을 누르면 이전 연결 정리와 새 연결을 시작합니다.")
                            .font(.caption.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
            }

            if case .installedNeedsHookReview = viewModel.codexPluginSetupState {
                PetHookReadinessView(viewModel: viewModel)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .petInsetSurface(cornerRadius: PetPanelVisualStyle.rowRadius)
            }

            codexPluginSetupActions
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface(emphasized: true)
    }

    private var codexPluginSetupActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { codexPluginSetupActionsButtons }
                .fixedSize(horizontal: true, vertical: false)
            VStack(alignment: .leading, spacing: 8) { codexPluginSetupActionsButtons }
        }
    }

    @ViewBuilder
    private var codexPluginSetupActionsButtons: some View {
        switch viewModel.codexPluginSetupState {
        case .unchecked, .notInstalled:
            Button {
                Task { await viewModel.connectCodexPlugin() }
            } label: {
                Label("Codex 연결하기", systemImage: "link")
            }
            .buttonStyle(.borderedProminent)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canConnectCodexPlugin)
        case .marketplaceInstalledNeedsPlugin:
            Button {
                Task { await viewModel.connectCodexPlugin() }
            } label: {
                Label("연결 마무리", systemImage: "link")
            }
            .buttonStyle(.borderedProminent)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canConnectCodexPlugin)
            Button("안전하게 정리") {
                Task { await viewModel.disconnectCodexPlugin() }
            }
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canDisconnectCodexPlugin)
        case .updateAvailable:
            Button {
                Task { await viewModel.connectCodexPlugin() }
            } label: {
                Label("Plugin 업데이트", systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(.borderedProminent)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canConnectCodexPlugin)
            Button("연결 해제") {
                Task { await viewModel.disconnectCodexPlugin() }
            }
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canDisconnectCodexPlugin)
        case .installedNeedsHookReview:
            Button("연결 해제") {
                Task { await viewModel.disconnectCodexPlugin() }
            }
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canDisconnectCodexPlugin)
        case .legacyInstallationDetected:
            if viewModel.isConfirmingLegacyCodexPluginMigration {
                Button("취소", action: viewModel.cancelLegacyCodexPluginMigrationConfirmation)
                    .buttonStyle(.bordered)
                    .petCapsuleButtonBorder()
                Button {
                    Task { await viewModel.migrateLegacyCodexPlugin() }
                } label: {
                    Label("정리하고 새로 연결", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
                .petCapsuleButtonBorder()
                .disabled(!viewModel.canMigrateLegacyCodexPlugin)
            } else {
                Button(action: viewModel.beginLegacyCodexPluginMigrationConfirmation) {
                    Label("이전 연결 정리 후 새로 연결", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(.borderedProminent)
                .tint(.orange)
                .petCapsuleButtonBorder()
                .disabled(!viewModel.canMigrateLegacyCodexPlugin)
            }
        case .unavailable, .conflict, .error:
            EmptyView()
        }
        Button {
            Task { await viewModel.recheckCodexNativeExecutable() }
        } label: {
            if viewModel.codexNativeRecheckReport?.isChecking == true {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Codex 실행 검사 중…")
                }
            } else {
                Label("Codex 실행 다시 검사", systemImage: "arrow.clockwise")
            }
        }
        .buttonStyle(.bordered)
        .petCapsuleButtonBorder()
        .help("이전에 차단된 Codex 파일도 이번 검사에서 다시 실행합니다.")
        .accessibilityLabel("Codex 실행 다시 검사")
        .disabled(viewModel.isCodexPluginOperationInFlight)
    }

    private var suggestionModeCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 12) {
                Image(systemName: "sparkles.rectangle.stack")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.indigo)
                    .frame(width: 38, height: 38)
                    .background(Color.indigo.opacity(0.13), in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text("후속 제안")
                        .font(.body.weight(.semibold))
                    Text("Codex 답변 뒤에 다음 대화를 제안하는 범위를 정합니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Picker(
                "후속 제안 모드",
                selection: Binding(
                    get: { viewModel.suggestionMode },
                    set: { viewModel.updateSuggestionMode($0) }
                )
            ) {
                ForEach(
                    [
                        BlabeeSuggestionMode.smart,
                        BlabeeSuggestionMode.always,
                        BlabeeSuggestionMode.actionOnly,
                    ],
                    id: \.rawValue
                ) { mode in
                    Text(mode.petDisplayTitle).tag(mode)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)
            .accessibilityLabel("후속 제안 모드")

            Text(viewModel.suggestionMode.petDisplayDescription)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Label(
                "스마트가 권장 기본값입니다. 변경 사항은 백그라운드 서비스를 재시작한 후 Hook에 적용됩니다.",
                systemImage: "arrow.clockwise.circle"
            )
                .font(.caption)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)

            Text("이 설정은 제안 빈도만 바꾸며 Codex 권한 승인에는 영향을 주지 않습니다.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let diagnostic = viewModel.suggestionModeDiagnostic {
                VStack(alignment: .leading, spacing: 8) {
                    Label(diagnostic, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("작업만으로 복구") {
                        viewModel.updateSuggestionMode(.actionOnly)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface()
    }

    private var onboardingServiceActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { onboardingServiceActionsButtons }
                .fixedSize(horizontal: true, vertical: false)
            VStack(alignment: .leading, spacing: 8) { onboardingServiceActionsButtons }
        }
    }

    @ViewBuilder
    private var onboardingServiceActionsButtons: some View {
        switch viewModel.onboardingServiceState {
        case .notRegistered, .notFound:
            Button {
                Task { await viewModel.registerOnboardingService() }
            } label: {
                Label(
                    viewModel.onboardingServiceState == .notFound
                        ? "서비스 등록 시도"
                        : "서비스 등록",
                    systemImage: "play.fill"
                )
            }
            .buttonStyle(.borderedProminent)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canRegisterOnboardingService)
        case .enabled:
            Button {
                Task { await viewModel.unregisterOnboardingService() }
            } label: {
                Label("등록 해제", systemImage: "xmark")
            }
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canUnregisterOnboardingService)
        case .requiresApproval:
            Button {
                Task { await viewModel.openOnboardingSystemSettings() }
            } label: {
                Label("시스템 설정 열기", systemImage: "gear")
            }
            .buttonStyle(.borderedProminent)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canOpenOnboardingSystemSettings)
            Button {
                Task { await viewModel.unregisterOnboardingService() }
            } label: {
                Text("등록 해제")
            }
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .disabled(!viewModel.canUnregisterOnboardingService)
        case .unknown:
            Text("이 상태에서는 등록 정보를 변경할 수 없습니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        Button {
            Task { await viewModel.refreshAllOnboardingSettings() }
        } label: {
            Image(systemName: "arrow.clockwise")
        }
        .buttonStyle(.bordered)
        .petCircleButtonBorder()
        .accessibilityLabel("모든 Blabee 설정 새로고침")
    }

    private var appOwnedServiceSettings: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("앱 실행형 서비스 · 내부 테스트")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(viewModel.appOwnedServiceState.title)
                        .font(.body.weight(.semibold))
                }
                Spacer()
                PetSettingsStatusBadge(
                    tone: .appService(viewModel.appOwnedServiceState),
                    title: appOwnedServiceBadgeTitle
                )
                .accessibilityIdentifier("app-service-status")
                if viewModel.appOwnedServiceState == .starting
                    || viewModel.appOwnedServiceState == .stopping
                    || viewModel.appOwnedServiceState == .reconnecting
                {
                    ProgressView().controlSize(.small)
                        .accessibilityLabel(viewModel.appOwnedServiceState.title)
                }
            }
            Text(viewModel.appOwnedServiceState.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("Codex와 Claude는 이 서비스를 함께 사용합니다. Claude는 아래 자동 연결을 켜거나 패널 메뉴의 ‘Claude 시작’으로 연결할 수 있습니다.")
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                if viewModel.isAppOwnedServiceEnabled {
                    Button {
                        Task { await viewModel.restartAppOwnedService() }
                    } label: {
                        Label("서비스 다시 시작", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderedProminent)
                    .petCapsuleButtonBorder()
                    Button("앱 실행형 끄기") {
                        Task { await viewModel.disableAppOwnedService() }
                    }
                    .buttonStyle(.bordered)
                    .petCapsuleButtonBorder()
                } else {
                    Button {
                        Task { await viewModel.enableAppOwnedService() }
                    } label: {
                        Label("앱 실행형 서비스 켜기", systemImage: "play.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .petCapsuleButtonBorder()
                }
            }
            .disabled(!viewModel.canChangeAppOwnedService)
            Divider()
            ClaudeAutoConnectSettingsView(serviceReady: viewModel.appOwnedServiceState == .ready)
            DisclosureGroup("저장소 복구") {
                PetStorageRecoveryView(viewModel: viewModel).padding(.top, 8)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .petInsetSurface(emphasized: true)
    }

    private func configuredProjectRow(_ path: String) -> some View {
        let isActive = viewModel.hasVerifiedServiceConnection
            && viewModel.activeProjectPaths.contains(path)
        let name = URL(fileURLWithPath: path, isDirectory: true).lastPathComponent
        return HStack(spacing: 12) {
            Image(systemName: isActive ? "folder.fill" : "folder")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(isActive ? Color.green : Color.secondary)
                .frame(width: 34, height: 34)
                .background(
                    (isActive ? Color.green : Color.secondary).opacity(0.12),
                    in: Circle()
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(name.isEmpty ? path : name)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                Text(path)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .help(path)
                Text(isActive
                     ? "현재 서비스에 적용됨"
                     : viewModel.hasVerifiedServiceConnection
                         ? "저장됨 · 서비스 재시작 필요"
                         : "저장됨 · 서비스 연결 후 적용 확인")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityValue(path)
            Spacer(minLength: 8)
            Button {
                Task { await viewModel.disableConfiguredProject(path) }
            } label: {
                Text("제거")
            }
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .controlSize(.small)
            .disabled(!viewModel.canMutateOnboardingProjects)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .petInsetSurface(cornerRadius: PetPanelVisualStyle.rowRadius)
    }

    private func activeOnlyProjectRow(_ path: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.orange)
                .frame(width: 34, height: 34)
                .background(Color.orange.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(path)
                    .font(.caption.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .help(path)
                Text("현재 서비스에서만 활성 · 재시작 후 비활성")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(Color.orange.opacity(0.18), lineWidth: 0.75)
        )
    }

    private func projectMessageRow(_ message: String, systemImage: String) -> some View {
        Label(message, systemImage: systemImage)
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .petInsetSurface(cornerRadius: PetPanelVisualStyle.rowRadius)
    }

    private var onboardingServiceSymbol: String {
        switch viewModel.onboardingServiceState {
        case .enabled: "checkmark.circle.fill"
        case .requiresApproval: "exclamationmark.circle.fill"
        case .notRegistered: "circle.dashed"
        case .notFound: "questionmark.circle"
        case .unknown: "ellipsis.circle"
        }
    }

    private var appOwnedServiceBadgeTitle: String {
        switch viewModel.appOwnedServiceState {
        case .ready: "연결됨"
        case .disabled: "사용 안 함"
        case .stopped: "시작 필요"
        case .starting, .reconnecting: "확인 중"
        case .unresponsive: "응답 지연"
        case .stopping: "종료 중"
        case .blocked: "조치 필요"
        case .failed: "오류"
        }
    }

    private var onboardingServiceTone: PetSettingsStatusTone {
        .automaticService(
            viewModel.onboardingServiceState,
            needsRuntimeAttention: viewModel.onboardingServiceNeedsRuntimeAttention
        )
    }

    private var onboardingServiceColor: Color {
        onboardingServiceTone.color
    }

    private var onboardingServiceBadgeTitle: String {
        if viewModel.onboardingServiceNeedsRuntimeAttention { return "연결 오류" }
        if viewModel.onboardingServiceState == .notRegistered { return "선택 사항 · 꺼짐" }
        return viewModel.onboardingServiceState.displayTitle
    }

    private var codexPluginSetupSymbol: String {
        switch viewModel.codexPluginSetupState {
        case .installedNeedsHookReview: "checkmark.circle.fill"
        case .marketplaceInstalledNeedsPlugin: "link.circle.fill"
        case .updateAvailable: "arrow.triangle.2.circlepath.circle.fill"
        case .legacyInstallationDetected: "exclamationmark.triangle.fill"
        case .conflict, .error: "exclamationmark.triangle.fill"
        case .notInstalled: "link.circle.fill"
        case .unchecked, .unavailable: "questionmark.circle"
        }
    }

    private var codexPluginSetupColor: Color {
        PetSettingsStatusTone.codexPlugin(viewModel.codexPluginSetupState).color
    }

    private var codexPluginSetupBadgeTitle: String {
        switch viewModel.codexPluginSetupState {
        case .unchecked: "확인 전"
        case .unavailable: "사용 불가"
        case .notInstalled: "미연결"
        case .marketplaceInstalledNeedsPlugin: "마무리 필요"
        case .installedNeedsHookReview: "설치 완료"
        case .updateAvailable: "업데이트"
        case .legacyInstallationDetected: "이전 연결 발견"
        case .conflict: "충돌"
        case .error: "오류"
        }
    }

    private var codexPluginInstallationTitle: String {
        if case .installedNeedsHookReview = viewModel.codexPluginSetupState {
            return "Blabee Plugin 설치됨"
        }
        return viewModel.codexPluginSetupState.title
    }

    private var codexPluginInstallationDetail: String {
        if case .installedNeedsHookReview = viewModel.codexPluginSetupState {
            return "Codex에서 Blabee Plugin의 설치·활성을 확인했습니다. 현재 세션의 Hook 신뢰와 실제 동작은 별도로 확인해야 합니다."
        }
        return viewModel.codexPluginSetupState.detail
    }

    private func shortcutSettingRow(_ intent: PetShortcutIntent) -> some View {
        let draft = viewModel.shortcutDraft.shortcut(for: intent)
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(intent.displayName)
                    .font(.callout.bold())
                Spacer()
                Text(PetShortcutCatalog.displayLabel(for: draft))
                    .font(.caption.monospaced().bold())
            }
            HStack(spacing: 8) {
                Picker(
                    "보조키",
                    selection: Binding(
                        get: { viewModel.shortcutDraft.shortcut(for: intent).modifiers },
                        set: { viewModel.updateShortcutDraft(intent: intent, modifiers: $0) }
                    )
                ) {
                    ForEach(PetShortcutCatalog.modifierPresets) { preset in
                        Text(preset.displayLabel).tag(preset.modifiers)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)

                Picker(
                    "키",
                    selection: Binding(
                        get: { viewModel.shortcutDraft.shortcut(for: intent).keyCode },
                        set: { viewModel.updateShortcutDraft(intent: intent, keyCode: $0) }
                    )
                ) {
                    ForEach(PetShortcutCatalog.keys) { key in
                        Text(key.displayLabel).tag(key.keyCode)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)

                Spacer()
                Text(viewModel.shortcutDraftStatusDescription(for: intent))
                    .font(.caption2)
                    .foregroundStyle(
                        viewModel.shortcutDraftStatusIsProblem(for: intent)
                            ? Color.orange
                            : Color.secondary
                    )
            }
        }
        .padding(.vertical, 3)
    }

}

private struct PetGeneralPreferencesView: View {
    @ObservedObject var preferences: PetFirstRunPreferences

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text("화면 모드").font(.system(size: 14, weight: .medium))
                Spacer(minLength: 8)
                Picker("화면 모드", selection: Binding(get: { preferences.theme }, set: preferences.setTheme)) {
                    ForEach(PetFirstRunTheme.allCases) { Text($0.title).tag($0) }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(width: 132)
                .accessibilityIdentifier("settings-theme")
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 57)
            Divider()
            Toggle("Mac 로그인 시 실행", isOn: Binding(
                get: { preferences.launchAtLoginEnabled }, set: preferences.setLaunchAtLogin
            ))
            .font(.system(size: 14, weight: .medium))
            .toggleStyle(.switch)
            .padding(.horizontal, 14)
            .frame(minHeight: 57)
            .accessibilityIdentifier("settings-launch-at-login")

            if preferences.launchAtLoginStatus == .requiresApproval {
                VStack(alignment: .leading, spacing: 8) {
                    Text(preferences.launchAtLoginStatus.title)
                        .font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Button("시스템 설정 열기", action: preferences.openLoginItemsSettings)
                        Button("등록 취소") { preferences.setLaunchAtLogin(false) }
                    }
                    .buttonStyle(PetAirButtonStyle())
                }
                .padding([.horizontal, .bottom], 14)
            } else if preferences.launchAtLoginStatus == .notFound || preferences.launchAtLoginStatus == .unavailable {
                Text(preferences.launchAtLoginStatus.title)
                    .font(.caption).foregroundStyle(.secondary)
                    .padding([.horizontal, .bottom], 14)
            }
            if let error = preferences.launchAtLoginError {
                Text(error)
                    .font(.caption).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding([.horizontal, .bottom], 14)
            }
        }
        .petInsetSurface()
        .onAppear(perform: preferences.reloadLaunchAtLoginStatus)
        .accessibilityIdentifier("settings-app-preferences")
    }
}

enum PetSettingsTab: String, CaseIterable, Identifiable {
    case general, shortcuts, projects, connection
    var id: String { rawValue }
    var title: String {
        switch self {
        case .general: "일반"
        case .shortcuts: "단축키"
        case .projects: "프로젝트"
        case .connection: "연결"
        }
    }
    var symbol: String {
        switch self {
        case .general: "slider.horizontal.3"
        case .shortcuts: "keyboard"
        case .projects: "folder"
        case .connection: "link"
        }
    }
}
