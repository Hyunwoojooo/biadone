import SwiftUI

struct LauncherSettingsView: View {
    @ObservedObject var viewModel: LauncherSettingsViewModel
    @ObservedObject var launcherViewModel: LauncherViewModel

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    heading
                    dataRootSection
                    dashboardSection
                    sourceSection
                    feedback
                }
                .padding(28)
            }
            Divider()
            actions
            .padding(.horizontal, 28)
            .frame(height: 64)
        }
        .frame(width: 650, height: 700)
        .background(LauncherVisualTokens.surfaceFloating(colorScheme))
        .foregroundStyle(LauncherVisualTokens.textPrimary(colorScheme))
        .tint(LauncherVisualTokens.actionPrimary(colorScheme))
        .onChange(of: viewModel.dataRootChoice) { _ in
            launcherViewModel.cancelSourceNavigationForDraftChange()
        }
        .onChange(of: viewModel.dashboardBaseURLText) { _ in
            launcherViewModel.cancelSourceNavigationForDraftChange()
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(
                        LauncherVisualTokens.actionPrimary(colorScheme)
                    )
                Text(
                    viewModel.isSetupRequired
                        ? "Blabase 시작 설정"
                        : "Blabase 설정"
                )
                .font(.title2.weight(.semibold))
            }
            Text("연결할 작업 데이터와 별도 웹 대시보드 주소를 정합니다.")
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
            Text("기존 폴더를 연결해도 credential과 snapshot을 자동 복사·이동하지 않습니다.")
                .font(.caption)
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
        }
    }

    private var dataRootSection: some View {
        settingsCard(title: "작업 데이터", icon: "externaldrive") {
            VStack(alignment: .leading, spacing: 13) {
                HStack(alignment: .top, spacing: 12) {
                    Image(
                        systemName: viewModel.sourceMode == .managed
                            ? "internaldrive"
                            : "link"
                    )
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                    VStack(alignment: .leading, spacing: 4) {
                        Text(
                            viewModel.sourceMode == .managed
                                ? "Blabase 전용 저장소"
                                : "기존 데이터 연결"
                        )
                        .font(.headline)
                        Text(viewModel.selectedDataRootPath)
                            .font(.caption.monospaced())
                            .foregroundStyle(
                                LauncherVisualTokens.textSecondary(colorScheme)
                            )
                            .textSelection(.enabled)
                            .lineLimit(2)
                    }
                    Spacer()
                    modeBadge
                }
                Text(
                    viewModel.sourceMode == .managed
                        ? "개발 베타에서 이 저장소는 Local Agent 평가용이며 Source 연결 화면을 제공하지 않습니다."
                        : "연결한 source snapshot은 읽기 전용으로 평가합니다. Codex 작업 이어가기에 필요한 queue 상태는 갱신될 수 있습니다."
                )
                .font(.caption)
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
                if viewModel.sourceMode == .managed {
                    Text("Source를 연결하려면 실행 중인 로컬 Work Cockpit이 소유한 기존 데이터 폴더를 선택하세요.")
                        .font(.caption)
                        .foregroundStyle(
                            LauncherVisualTokens.statusWarning(colorScheme)
                        )
                } else {
                    Text("기존 데이터를 선택하면 기본 웹 주소도 이 폴더를 소유한 로컬 Work Cockpit으로 맞춥니다.")
                        .font(.caption)
                        .foregroundStyle(
                            LauncherVisualTokens.textSecondary(colorScheme)
                        )
                }
                HStack {
                    Button("기존 데이터 연결…") {
                        viewModel.chooseExistingDataRoot()
                    }
                    Button("전용 저장소 사용") {
                        viewModel.useManagedDefault()
                    }
                }
                .disabled(viewModel.isApplying)
            }
        }
    }

    private var dashboardSection: some View {
        settingsCard(title: "웹 대시보드", icon: "rectangle.3.group") {
            VStack(alignment: .leading, spacing: 10) {
                TextField(
                    "https://app.blabase.com",
                    text: $viewModel.dashboardBaseURLText
                )
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("웹 대시보드 주소")
                .disabled(viewModel.isApplying)
                HStack {
                    Button("Blabase Cloud") {
                        viewModel.useCloudDashboard()
                    }
                    Button("로컬 Work Cockpit") {
                        viewModel.useLocalDashboard()
                    }
                    Spacer()
                }
                .buttonStyle(.link)
                .disabled(viewModel.isApplying)
                Text("Blabase Cloud HTTPS 또는 이 Mac의 localhost 주소만 허용합니다.")
                    .font(.caption)
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                Text("이 주소는 화면을 여는 위치입니다. 로컬 Work Cockpit은 위 데이터 폴더를 소유한 프로세스로 실행해야 합니다.")
                    .font(.caption)
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
            }
        }
    }

    private var sourceSection: some View {
        settingsCard(title: "현재 평가 범위", icon: "checklist") {
            VStack(alignment: .leading, spacing: 9) {
                ForEach(AttentionSource.allCases, id: \.self) { source in
                    if viewModel.sourceMode == .readOnly {
                        Button {
                            launcherViewModel.openSourceConnections(source)
                        } label: {
                            sourceRow(source, showsNavigation: true)
                        }
                        .buttonStyle(.plain)
                        .disabled(
                            viewModel.isSourceNavigationDraftDirty
                                || launcherViewModel
                                    .isResolvingSourceNavigation
                        )
                        .accessibilityHint(
                            "같은 작업 저장소를 사용하는 대시보드에서 \(source.displayName) 연결 설정을 엽니다."
                        )
                    } else {
                        Button {
                            viewModel.chooseExistingDataRoot()
                        } label: {
                            sourceRow(source, showsNavigation: true)
                        }
                        .buttonStyle(.plain)
                        .disabled(viewModel.isApplying)
                        .accessibilityHint(
                            "\(source.displayName) 연결을 위해 로컬 Work Cockpit 데이터 폴더 선택기를 엽니다. 폴더를 선택한 뒤 설정을 적용하세요."
                        )
                    }
                }
                Text(
                    viewModel.isDataRootDraftDirty
                        ? "새 데이터 폴더를 저장한 뒤 평가 범위를 확인합니다."
                        : "현재 적용된 데이터 기준이며, 미평가 source는 추천 화면에도 그대로 표시됩니다."
                )
                    .font(.caption)
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                    .padding(.top, 2)
                if let detail = sourceStateDetail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(
                            isSourceStateError
                                ? LauncherVisualTokens.statusSignal(colorScheme)
                                : LauncherVisualTokens.textSecondary(colorScheme)
                        )
                }
                if viewModel.sourceMode == .managed {
                    Text("각 Source 행을 눌러 로컬 Work Cockpit이 소유한 기존 데이터 폴더를 선택한 뒤, 아래의 설정 적용 버튼을 눌러야 연결 화면으로 이동할 수 있습니다.")
                        .font(.caption)
                        .foregroundStyle(
                            LauncherVisualTokens.textSecondary(colorScheme)
                        )
                } else {
                    Button("Source 연결 관리") {
                        launcherViewModel.openSourceConnections()
                    }
                    .buttonStyle(.link)
                    .disabled(
                        viewModel.isSourceNavigationDraftDirty
                            || launcherViewModel.isResolvingSourceNavigation
                    )
                }
                if let message =
                    launcherViewModel.sourceNavigationRecoveryMessage {
                    VStack(alignment: .leading, spacing: 5) {
                        Label(
                            message,
                            systemImage: "exclamationmark.triangle.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(
                            LauncherVisualTokens.statusWarning(colorScheme)
                        )
                        Button("다시 확인") {
                            launcherViewModel.retrySourceConnections()
                        }
                        .buttonStyle(.link)
                        .disabled(
                            viewModel.isSourceNavigationDraftDirty
                                || launcherViewModel
                                    .isResolvingSourceNavigation
                        )
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var feedback: some View {
        if let error = viewModel.errorMessage {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(
                    LauncherVisualTokens.statusSignal(colorScheme)
                )
        } else if let status = viewModel.statusMessage {
            Label(status, systemImage: "info.circle")
                .font(.callout)
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
        }
    }

    private var actions: some View {
        HStack {
            Spacer()
            Button(
                viewModel.isSetupRequired ? "설정 저장 및 시작" : "변경사항 적용"
            ) {
                viewModel.apply()
            }
            .keyboardShortcut(.defaultAction)
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isApplying)
            if viewModel.isApplying {
                ProgressView().controlSize(.small)
            }
        }
    }

    private var modeBadge: some View {
        Text(
            viewModel.sourceMode == .managed
                ? "갱신 관리"
                : "소스 읽기 전용"
        )
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(
            (
                viewModel.sourceMode == .managed
                    ? LauncherVisualTokens.statusSuccess(colorScheme)
                    : LauncherVisualTokens.statusWarning(colorScheme)
            )
                .opacity(0.13)
        )
        .clipShape(Capsule())
    }

    private func settingsCard<Content: View>(
        title: String,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            Label(title, systemImage: icon)
                .font(.headline)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(
                    LauncherVisualTokens.borderDefault(colorScheme),
                    lineWidth: 1
                )
        }
    }

    private func sourceStatus(_ source: AttentionSource) -> String {
        if viewModel.isDataRootDraftDirty {
            return "저장 후 확인"
        }
        switch launcherViewModel.state {
        case .setupRequired:
            return "설정 필요"
        case .loading:
            return "확인 중"
        case .error:
            return "확인 실패"
        case .projection(let projection, _):
            guard let diagnostic = projection.sourceDiagnostics.first(
                where: { $0.source == source }
            ) else { return "확인 실패" }
            let display = LauncherPresentation.sourceDiagnosticDisplay(
                diagnostic
            )
            return "\(display.stateLabel) · 신호 \(diagnostic.signalCount)"
        }
    }

    private func sourceTierLabel(_ source: AttentionSource) -> String {
        switch source {
        case .github, .codex:
            "핵심"
        case .notion, .googleCalendar:
            "선택"
        }
    }

    private func sourceRow(
        _ source: AttentionSource,
        showsNavigation: Bool
    ) -> some View {
        HStack {
            Circle()
                .fill(sourceColor(source))
                .frame(width: 8, height: 8)
            Text(source.displayName)
            Text(sourceTierLabel(source))
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    LauncherVisualTokens.surfaceFloating(colorScheme)
                )
                .clipShape(Capsule())
            Spacer()
            Text(sourceStatus(source))
                .font(.caption)
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
            if showsNavigation {
                Image(systemName: "arrow.up.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(
                        LauncherVisualTokens.textTertiary(colorScheme)
                    )
            }
        }
    }

    private func sourceColor(_ source: AttentionSource) -> Color {
        if viewModel.isDataRootDraftDirty {
            return LauncherVisualTokens.textTertiary(colorScheme)
        }
        switch launcherViewModel.state {
        case .setupRequired:
            return LauncherVisualTokens.textTertiary(colorScheme)
        case .loading:
            return LauncherVisualTokens.actionPrimary(colorScheme)
        case .error:
            return LauncherVisualTokens.statusSignal(colorScheme)
        case .projection(let projection, _):
            guard let diagnostic = projection.sourceDiagnostics.first(
                where: { $0.source == source }
            ) else {
                return LauncherVisualTokens.statusSignal(colorScheme)
            }
            switch LauncherPresentation.sourceDiagnosticDisplay(
                diagnostic
            ).tone {
            case .positive:
                return LauncherVisualTokens.statusSuccess(colorScheme)
            case .warning:
                return LauncherVisualTokens.statusWarning(colorScheme)
            case .critical:
                return LauncherVisualTokens.statusSignal(colorScheme)
            case .neutral:
                return LauncherVisualTokens.textTertiary(colorScheme)
            }
        }
    }

    private var sourceStateDetail: String? {
        guard !viewModel.isDataRootDraftDirty else { return nil }
        switch launcherViewModel.state {
        case .setupRequired:
            return "데이터 설정을 저장한 뒤 source 상태를 확인합니다."
        case .loading:
            return "Local Agent가 현재 snapshot을 확인하고 있습니다."
        case .error(let message):
            return "Local Agent: \(message)"
        case .projection(let projection, _):
            return LauncherPresentation.decisionReasonSummary(
                projection.decisionReasonCodes
            )
        }
    }

    private var isSourceStateError: Bool {
        guard !viewModel.isDataRootDraftDirty else { return false }
        if case .error = launcherViewModel.state { return true }
        return false
    }
}
