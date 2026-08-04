import SwiftUI

struct LauncherSettingsView: View {
    @ObservedObject var viewModel: LauncherSettingsViewModel
    @ObservedObject var launcherViewModel: LauncherViewModel

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
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles.square.filled")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.tint)
                Text(
                    viewModel.isSetupRequired
                        ? "Blabase 시작 설정"
                        : "Blabase 설정"
                )
                .font(.title2.weight(.semibold))
            }
            Text("연결할 작업 데이터와 별도 웹 대시보드 주소를 정합니다.")
                .foregroundStyle(.secondary)
            Text("기존 폴더를 연결해도 credential과 snapshot을 자동 복사·이동하지 않습니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
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
                    .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(
                            viewModel.sourceMode == .managed
                                ? "Blabase 전용 저장소"
                                : "기존 데이터 연결"
                        )
                        .font(.headline)
                        Text(viewModel.selectedDataRootPath)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(2)
                    }
                    Spacer()
                    modeBadge
                }
                Text(
                    viewModel.sourceMode == .managed
                        ? "이 저장소에서는 Blabase가 source 동기화와 평가 기록을 관리합니다."
                        : "연결한 source snapshot은 읽기 전용으로 평가합니다. Codex 작업 이어가기에 필요한 queue 상태는 갱신될 수 있습니다."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
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
                    .foregroundStyle(.secondary)
                Text("이 주소는 화면을 여는 위치입니다. 로컬 Work Cockpit은 위 데이터 폴더를 소유한 프로세스로 실행해야 합니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var sourceSection: some View {
        settingsCard(title: "현재 평가 범위", icon: "checklist") {
            VStack(alignment: .leading, spacing: 9) {
                ForEach(AttentionSource.allCases, id: \.self) { source in
                    HStack {
                        Circle()
                            .fill(sourceColor(source))
                            .frame(width: 8, height: 8)
                        Text(source.displayName)
                        Spacer()
                        Text(sourceStatus(source))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(
                    viewModel.isDataRootDraftDirty
                        ? "새 데이터 폴더를 저장한 뒤 평가 범위를 확인합니다."
                        : "현재 적용된 데이터 기준이며, 미평가 source는 추천 화면에도 그대로 표시됩니다."
                )
                    .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
                if let detail = sourceStateDetail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(
                            isSourceStateError ? Color.red : Color.secondary
                        )
                }
            }
        }
    }

    @ViewBuilder
    private var feedback: some View {
        if let error = viewModel.errorMessage {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.red)
        } else if let status = viewModel.statusMessage {
            Label(status, systemImage: "info.circle")
                .font(.callout)
                .foregroundStyle(.secondary)
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
            (viewModel.sourceMode == .managed ? Color.green : Color.orange)
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
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.primary.opacity(0.07), lineWidth: 1)
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
            return projection.unavailableSources.contains(source)
                ? "현재 미평가"
                : "평가 가능"
        }
    }

    private func sourceColor(_ source: AttentionSource) -> Color {
        if viewModel.isDataRootDraftDirty {
            return .secondary
        }
        switch launcherViewModel.state {
        case .setupRequired:
            return .secondary
        case .loading:
            return .accentColor
        case .error:
            return .red
        case .projection(let projection, _):
            return projection.unavailableSources.contains(source)
                ? .orange
                : .green
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
        case .projection:
            return nil
        }
    }

    private var isSourceStateError: Bool {
        guard !viewModel.isDataRootDraftDirty else { return false }
        if case .error = launcherViewModel.state { return true }
        return false
    }
}
