import SwiftUI

struct LauncherView: View {
    @ObservedObject var viewModel: LauncherViewModel
    let openSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.45)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider().opacity(0.45)
            footer
        }
        .frame(width: 680, height: 430)
        .background(.ultraThickMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.white.opacity(0.14), lineWidth: 1)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles.square.filled")
                .font(.system(size: 23, weight: .semibold))
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 2) {
                Text("지금 개입할 한 가지")
                    .font(.headline)
                Text(
                    viewModel.sourceMode == .managed
                        ? "Work Cockpit · 연결되고 갱신된 범위"
                        : "Work Cockpit · 저장된 snapshot 평가 범위"
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                viewModel.load(refresh: true)
            } label: {
                if viewModel.isRefreshing {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .buttonStyle(.plain)
            .help(
                viewModel.sourceMode == .managed
                    ? "연결된 source를 새로고침한 뒤 다시 평가"
                    : "저장된 source snapshot을 다시 평가"
            )
            .disabled(viewModel.isRefreshing)
        }
        .padding(.horizontal, 22)
        .frame(height: 68)
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .setupRequired(let message):
            stateMessage(
                icon: "externaldrive.badge.plus",
                title: "작업 데이터를 먼저 연결해주세요.",
                detail: message
                    ?? "Blabase 전용 저장소를 사용하거나 기존 데이터를 소스 읽기 전용으로 연결할 수 있습니다.",
                buttonTitle: "시작 설정 열기",
                action: openSettings
            )
        case .loading:
            VStack(spacing: 12) {
                ProgressView()
                Text("현재 작업 근거를 확인하고 있습니다.")
                    .foregroundStyle(.secondary)
            }
        case .error(let message):
            stateMessage(
                icon: "exclamationmark.triangle",
                title: "작업 제안을 불러오지 못했습니다.",
                detail: message,
                buttonTitle: "다시 확인"
            ) {
                viewModel.load(refresh: false)
            }
        case .projection(let projection, let execution):
            if let card = projection.card {
                suggestionCard(
                    projection: projection,
                    card: card,
                    execution: execution
                )
            } else {
                emptyDecision(projection)
            }
        }
    }

    private func suggestionCard(
        projection: LauncherAttentionProjection,
        card: AttentionCard,
        execution: LauncherExecutionProjection?
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                Text(card.laneLabel)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Color.accentColor.opacity(0.14))
                    .clipShape(Capsule())
                Text(card.certainty.displayName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(card.contextLabel)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Text(card.title)
                .font(.system(size: 24, weight: .semibold))
                .lineLimit(2)
            Text(card.whyNowText.joined(separator: " · "))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.tint)
                .lineLimit(2)
            Text(card.explanation)
                .font(.body)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "arrow.turn.down.right")
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text("첫 단계")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(card.firstStep)
                        .font(.callout)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
            HStack {
                Button(primaryActionTitle(card.primaryAction)) {
                    viewModel.performPrimaryAction()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(
                    !primaryActionEnabled(card.primaryAction)
                        || viewModel.isPerformingAction
                )
                if let execution {
                    Text(executionStatusText(execution.status))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                sourceCoverage(projection.unavailableSources)
            }
            if let message = viewModel.actionMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(22)
    }

    private func emptyDecision(
        _ projection: LauncherAttentionProjection
    ) -> some View {
        let display = decisionDisplay(projection)
        return VStack(spacing: 14) {
            Image(systemName: display.icon)
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(.secondary)
            Text(display.title)
                .font(.title3.weight(.semibold))
            if let question = projection.clarificationQuestion {
                Text(question)
                    .font(.body.weight(.medium))
                    .multilineTextAlignment(.center)
            }
            Text(projection.scopeStatement)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(3)
            sourceCoverage(projection.unavailableSources)
        }
        .padding(30)
    }

    private func stateMessage(
        icon: String,
        title: String,
        detail: String,
        buttonTitle: String,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(buttonTitle, action: action)
                .buttonStyle(.borderedProminent)
        }
        .padding(30)
    }

    private var footer: some View {
        HStack(spacing: 14) {
            Button("대시보드 열기") {
                viewModel.openDashboard()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            Button("설정") {
                openSettings()
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            Spacer()
            Text(
                viewModel.isHotKeyRegistered
                    ? LauncherShortcut.displayName
                    : "단축키 충돌"
            )
            Text("Esc 닫기")
        }
        .font(.caption)
        .foregroundStyle(.tertiary)
        .padding(.horizontal, 22)
        .frame(height: 44)
    }

    private func sourceCoverage(_ sources: [AttentionSource]) -> some View {
        Group {
            if sources.isEmpty {
                Text("4개 source 평가 가능")
            } else {
                Text("미평가: \(sources.map(\.displayName).joined(separator: ", "))")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }

    private func decisionDisplay(
        _ projection: LauncherAttentionProjection
    ) -> (icon: String, title: String) {
        switch projection.decisionStatus {
        case .suggested:
            ("sparkles", "현재 제안을 표시할 수 없습니다.")
        case .needsClarification:
            ("questionmark.bubble", "한 가지 확인이 필요합니다.")
        case .noAction:
            ("checkmark.circle", "지금 직접 개입할 항목이 없습니다.")
        case .insufficientEvidence:
            ("scope", "안전하게 한 가지를 고르기 어렵습니다.")
        }
    }

    private func primaryActionTitle(_ action: AttentionPrimaryAction) -> String {
        switch action {
        case .focusOrResume: "Codex에서 이어가기"
        case .openGitHub: "GitHub에서 열기"
        }
    }

    private func primaryActionEnabled(_ action: AttentionPrimaryAction) -> Bool {
        switch action {
        case .focusOrResume(let enabled): enabled
        case .openGitHub: true
        }
    }

    private func executionStatusText(_ status: LauncherExecutionStatus) -> String {
        switch status {
        case .pending: "요청 대기 중"
        case .claimed: "Terminal 준비 중"
        case .completed: "열림"
        case .failed: "열기 실패"
        case .expired: "요청 만료"
        }
    }
}
