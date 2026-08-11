import SwiftUI

struct LauncherView: View {
    @ObservedObject var viewModel: LauncherViewModel
    let openSettings: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Group {
            switch viewModel.route {
            case .home:
                home
            case .evidence:
                evidence
            }
        }
        .padding(.horizontal, LauncherVisualTokens.contentHorizontalPadding)
        .padding(.top, LauncherVisualTokens.contentTopPadding)
        .padding(.bottom, LauncherVisualTokens.contentBottomPadding)
        .frame(
            width: LauncherVisualTokens.panelWidth,
            height: LauncherVisualTokens.panelHeight
        )
        .background(LauncherVisualTokens.surfaceFloating(colorScheme))
        .clipShape(
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.panelCornerRadius,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.panelCornerRadius,
                style: .continuous
            )
            .stroke(
                LauncherVisualTokens.borderDefault(colorScheme),
                lineWidth: 1
            )
        }
        .foregroundStyle(LauncherVisualTokens.textPrimary(colorScheme))
    }

    private var home: some View {
        VStack(spacing: LauncherVisualTokens.sectionSpacing) {
            homeHeader
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            footer
        }
    }

    private var homeHeader: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(LauncherVisualTokens.statusSignal(colorScheme))
                .frame(width: 11, height: 11)
                .padding(.top, 5)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("중단한 지점부터 이어서 시작하세요")
                    .font(.system(size: 18, weight: .bold))
                Text("검증된 최신 문맥이 준비됐습니다. 확인하기 전에는 실행하지 않습니다.")
                    .font(.system(size: 12))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
            }
            Spacer(minLength: 12)
            Button {
                viewModel.load(refresh: true)
            } label: {
                Group {
                    if viewModel.isRefreshing {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .foregroundStyle(
                LauncherVisualTokens.textSecondary(colorScheme)
            )
            .help(
                viewModel.sourceMode == .managed
                    ? "연결된 source를 새로고침한 뒤 다시 평가"
                    : "저장된 source snapshot을 다시 평가"
            )
            .disabled(viewModel.isRefreshing)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 40, alignment: .top)
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
                    .font(.system(size: 13))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                suggestionHome(
                    projection: projection,
                    card: card,
                    execution: execution
                )
            } else {
                emptyDecision(projection)
            }
        }
    }

    private func suggestionHome(
        projection: LauncherAttentionProjection,
        card: AttentionCard,
        execution: LauncherExecutionProjection?
    ) -> some View {
        VStack(spacing: 12) {
            projectContext(card)
            suggestionRow(card, execution: execution)
            actionRow(card)
            scopeStrip(projection)
            recentWorkRow(projection.recentWorkSummary)
            Spacer(minLength: 0)
        }
    }

    private func projectContext(_ card: AttentionCard) -> some View {
        HStack(spacing: 12) {
            Text("◈")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(
                    LauncherVisualTokens.actionPrimary(colorScheme)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(card.contextLabel)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                Text("검증된 추천 문맥")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
            }
            Spacer()
            Text(
                viewModel.sourceMode == .managed
                    ? "갱신 관리"
                    : "snapshot 읽기"
            )
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(
                LauncherVisualTokens.textSecondary(colorScheme)
            )
        }
        .padding(.horizontal, 14)
        .frame(height: 56)
        .background(LauncherVisualTokens.surfaceFloating(colorScheme))
        .clipShape(
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.cardCornerRadius,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.cardCornerRadius,
                style: .continuous
            )
            .stroke(
                LauncherVisualTokens.borderDefault(colorScheme),
                lineWidth: 1
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("프로젝트 문맥, \(card.contextLabel)")
    }

    private func suggestionRow(
        _ card: AttentionCard,
        execution: LauncherExecutionProjection?
    ) -> some View {
        Button {
            viewModel.performPrimaryAction()
        } label: {
            HStack(spacing: 12) {
                Text("1")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(
                        LauncherVisualTokens.textTertiary(colorScheme)
                    )
                    .frame(width: 10)
                VStack(alignment: .leading, spacing: 5) {
                    Text(card.title)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(2)
                    Text(card.whyNowText.joined(separator: " · "))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(
                            LauncherVisualTokens.textSecondary(colorScheme)
                        )
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 7) {
                    sourceBadge(
                        LauncherPresentation.primaryActionSource(
                            card.primaryAction
                        ),
                        available: LauncherPresentation.primaryActionEnabled(
                            card.primaryAction
                        )
                    )
                    statusBadge(
                        execution.map {
                            LauncherPresentation.executionStatusText($0.status)
                        } ?? card.certainty.displayName,
                        positive: execution.map {
                            $0.status == .completed
                        } ?? (card.certainty == .confirmed)
                    )
                }
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 96)
            .contentShape(
                RoundedRectangle(
                    cornerRadius: LauncherVisualTokens.cardCornerRadius,
                    style: .continuous
                )
            )
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.defaultAction)
        .disabled(
            !LauncherPresentation.primaryActionEnabled(card.primaryAction)
                || viewModel.isPerformingAction
        )
        .background(LauncherVisualTokens.surfaceSelected(colorScheme))
        .clipShape(
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.cardCornerRadius,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: LauncherVisualTokens.cardCornerRadius,
                style: .continuous
            )
            .stroke(
                LauncherVisualTokens.borderFocus(colorScheme),
                lineWidth: 2
            )
        }
        .opacity(
            LauncherPresentation.primaryActionEnabled(card.primaryAction)
                ? 1
                : 0.72
        )
        .accessibilityLabel("추천 1, \(card.title)")
        .accessibilityHint(
            LauncherPresentation.primaryActionTitle(card.primaryAction)
        )
    }

    private func actionRow(_ card: AttentionCard) -> some View {
        HStack(spacing: 10) {
            secondaryButton(title: "추천 근거") {
                viewModel.showEvidence()
            }
            .keyboardShortcut("i", modifiers: .command)
            primaryButton(
                title: LauncherPresentation.primaryActionTitle(
                    card.primaryAction
                )
            ) {
                viewModel.performPrimaryAction()
            }
            .disabled(
                !LauncherPresentation.primaryActionEnabled(card.primaryAction)
                    || viewModel.isPerformingAction
            )
        }
        .frame(height: 42)
    }

    private func scopeStrip(
        _ projection: LauncherAttentionProjection
    ) -> some View {
        let coverage = LauncherSourceCoverage.make(
            unavailableSources: projection.unavailableSources
        )
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(viewModel.actionMessage ?? projection.scopeStatement)
                    .font(.system(size: 11))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                    .lineLimit(2)
                if let message = viewModel.actionMessage {
                    Text(projection.scopeStatement)
                        .font(.system(size: 10))
                        .foregroundStyle(
                            LauncherVisualTokens.textTertiary(colorScheme)
                        )
                        .lineLimit(1)
                        .accessibilityLabel(message)
                }
            }
            Spacer()
            statusBadge(
                coverage.compactSummary,
                positive: coverage.unavailableSources.isEmpty
            )
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 48)
        .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
        .clipShape(
            RoundedRectangle(
                cornerRadius: 10,
                style: .continuous
            )
        )
    }

    private var evidence: some View {
        VStack(spacing: LauncherVisualTokens.sectionSpacing) {
            evidenceHeader
            evidenceContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            evidenceActions
        }
    }

    private var evidenceHeader: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(LauncherVisualTokens.statusSignal(colorScheme))
                .frame(width: 11, height: 11)
                .padding(.top, 6)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text("이 작업이 다음인 이유")
                    .font(.system(size: 18, weight: .bold))
                Text("현재 평가 범위에서 확인된 근거만 표시합니다.")
                    .font(.system(size: 12))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 46, alignment: .top)
    }

    @ViewBuilder
    private var evidenceContent: some View {
        if case .projection(let projection, _) = viewModel.state,
           let card = projection.card {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 7) {
                    evidenceLabel("다음 작업")
                    Text(card.title)
                        .font(.system(size: 16, weight: .bold))
                        .lineLimit(2)
                    evidenceLabel("지금인 이유")
                    Text(card.whyNowText.joined(separator: " · "))
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .lineLimit(3)
                    evidenceLabel("설명")
                    Text(card.explanation)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(
                            LauncherVisualTokens.statusSuccess(colorScheme)
                        )
                        .lineLimit(4)
                    evidenceLabel("첫 단계")
                    Text(card.firstStep)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(3)
                    evidenceLabel("평가 범위")
                    sourceCoverageBadges(projection.unavailableSources)
                    Text(projection.scopeStatement)
                        .font(.system(size: 11))
                        .foregroundStyle(
                            LauncherVisualTokens.textSecondary(colorScheme)
                        )
                        .lineLimit(2)
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
            .clipShape(
                RoundedRectangle(
                    cornerRadius: LauncherVisualTokens.cardCornerRadius,
                    style: .continuous
                )
            )
            .overlay {
                RoundedRectangle(
                    cornerRadius: LauncherVisualTokens.cardCornerRadius,
                    style: .continuous
                )
                .stroke(
                    LauncherVisualTokens.borderDefault(colorScheme),
                    lineWidth: 1
                )
            }
        } else {
            Text("표시할 추천 근거가 없습니다.")
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
        }
    }

    private var evidenceActions: some View {
        HStack(spacing: 10) {
            secondaryButton(title: "뒤로") {
                viewModel.showHome()
            }
            .keyboardShortcut("[", modifiers: .command)
            if case .projection(_, _) = viewModel.state,
               let card = viewModel.currentProjection?.card {
                primaryButton(
                    title: LauncherPresentation.primaryActionTitle(
                        card.primaryAction
                    )
                ) {
                    viewModel.performPrimaryAction()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(
                    !LauncherPresentation.primaryActionEnabled(
                        card.primaryAction
                    ) || viewModel.isPerformingAction
                )
            }
        }
        .frame(height: 42)
    }

    private func evidenceLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .medium))
            .tracking(0.2)
            .foregroundStyle(
                LauncherVisualTokens.textSecondary(colorScheme)
            )
    }

    private func sourceCoverageBadges(
        _ unavailableSources: [AttentionSource]
    ) -> some View {
        let coverage = LauncherSourceCoverage.make(
            unavailableSources: unavailableSources
        )
        return HStack(spacing: 8) {
            ForEach(AttentionSource.allCases, id: \.self) { source in
                sourceBadge(
                    source.displayName,
                    available: coverage.availableSources.contains(source)
                )
            }
        }
    }

    private func sourceBadge(
        _ title: String,
        available: Bool
    ) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(
                    available
                        ? LauncherVisualTokens.actionPrimary(colorScheme)
                        : LauncherVisualTokens.statusWarning(colorScheme)
                )
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(
                    LauncherVisualTokens.borderDefault(colorScheme),
                    lineWidth: 1
                )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(title), \(available ? "평가 가능" : "현재 미평가")"
        )
    }

    private func statusBadge(
        _ title: String,
        positive: Bool
    ) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(
                    positive
                        ? LauncherVisualTokens.statusSuccess(colorScheme)
                        : LauncherVisualTokens.statusWarning(colorScheme)
                )
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .lineLimit(1)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .foregroundStyle(
            LauncherVisualTokens.textSecondary(colorScheme)
        )
        .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(
                    LauncherVisualTokens.borderDefault(colorScheme),
                    lineWidth: 1
                )
        }
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
                .font(.system(size: 28))
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
            Text(title)
                .font(.system(size: 16, weight: .semibold))
            Text(detail)
                .font(.system(size: 12))
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
                .multilineTextAlignment(.center)
                .lineLimit(3)
            primaryButton(title: buttonTitle, action: action)
                .frame(maxWidth: 260)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(30)
    }

    private func emptyDecision(
        _ projection: LauncherAttentionProjection
    ) -> some View {
        let display = LauncherPresentation.decisionDisplay(
            decisionStatus: projection.decisionStatus,
            decisionReasonCodes: projection.decisionReasonCodes,
            candidateCounts: projection.candidateCounts,
            currentFocusSummary: projection.currentFocusSummary
        )
        let reasonSummary = LauncherPresentation.decisionReasonSummary(
            projection.decisionReasonCodes
        )
        let offersConnectionCheck =
            LauncherPresentation.shouldOfferDataConnectionCheck(
                sourceDiagnostics: projection.sourceDiagnostics
            )
        let sourceConnectionTarget = sourceConnectionTarget(
            projection.sourceDiagnostics
        )
        return VStack(spacing: 9) {
            HStack(spacing: 12) {
                Image(systemName: display.icon)
                    .font(.system(size: 25, weight: .medium))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text(display.title)
                        .font(.system(size: 16, weight: .semibold))
                    Text(reasonSummary)
                        .font(.system(size: 11))
                        .foregroundStyle(
                            LauncherVisualTokens.textSecondary(colorScheme)
                        )
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let currentFocusLabel = display.currentFocusLabel {
                Text("현재 작업 흐름 · \(currentFocusLabel)")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(1)
            }
            if let question = projection.clarificationQuestion {
                Text(question)
                    .font(.system(size: 12, weight: .medium))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .lineLimit(2)
            }
            Text(projection.scopeStatement)
                .font(.system(size: 11))
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(2)
            HStack {
                Text("후보 판정")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                Spacer()
                Text(
                    LauncherPresentation.candidateCountSummary(
                        projection.candidateCounts
                    )
                )
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(
                    LauncherVisualTokens.textSecondary(colorScheme)
                )
            }
            sourceDiagnosticGrid(projection.sourceDiagnostics)
            recentWorkRow(projection.recentWorkSummary)
            if offersConnectionCheck {
                primaryButton(
                    title: viewModel.sourceMode == .readOnly
                        ? "\(sourceConnectionTarget?.displayName ?? "Source") 연결 관리"
                        : "데이터 경로 확인",
                    action: {
                        if viewModel.sourceMode == .readOnly,
                           let sourceConnectionTarget {
                            viewModel.openSourceConnections(
                                sourceConnectionTarget
                            )
                        } else {
                            openSettings()
                        }
                    }
                )
                    .frame(maxWidth: 260)
                    .accessibilityHint(
                        viewModel.sourceMode == .readOnly
                            ? "같은 작업 저장소로 확인된 대시보드에서 source 연결을 관리합니다."
                            : "GitHub와 Codex가 사용할 데이터 경로를 확인합니다."
                    )
            }
            if let recovery = viewModel.sourceNavigationRecoveryMessage {
                Text(recovery)
                    .font(.system(size: 10))
                    .foregroundStyle(
                        LauncherVisualTokens.statusWarning(colorScheme)
                    )
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                Button("설정 및 상태 확인") {
                    openSettings()
                }
                .buttonStyle(.link)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private func recentWorkRow(
        _ summary: AttentionRecentWorkSummary?
    ) -> some View {
        if let summary,
           let display = LauncherPresentation.recentWorkDisplay(summary) {
            VStack(alignment: .leading, spacing: 3) {
                Text("최근 작업")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                Text(display.title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                Text(display.trackingText)
                    .font(.system(size: 10))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                    .lineLimit(2)
                Text(display.pushedAtText)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(
                        LauncherVisualTokens.textSecondary(colorScheme)
                    )
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        }
    }

    private func sourceDiagnosticGrid(
        _ diagnostics: [AttentionSourceDiagnostic]
    ) -> some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: 8),
                GridItem(.flexible(), spacing: 8)
            ],
            spacing: 8
        ) {
            ForEach(diagnostics, id: \.source) { diagnostic in
                let display = LauncherPresentation.sourceDiagnosticDisplay(
                    diagnostic
                )
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(sourceDiagnosticColor(display.tone))
                            .frame(width: 7, height: 7)
                            .accessibilityHidden(true)
                        Text(diagnostic.source.displayName)
                            .font(.system(size: 11, weight: .semibold))
                        Spacer(minLength: 4)
                        Text(display.stateLabel)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(
                                sourceDiagnosticColor(display.tone)
                            )
                    }
                    Text(display.detail)
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(
                            LauncherVisualTokens.textSecondary(colorScheme)
                        )
                        .lineLimit(2)
                        .help(display.detail)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
                .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
                .clipShape(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(
                            LauncherVisualTokens.borderDefault(colorScheme),
                            lineWidth: 1
                        )
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(
                    "\(diagnostic.source.displayName), \(display.stateLabel), \(display.detail)"
                )
            }
        }
    }

    private func sourceConnectionTarget(
        _ diagnostics: [AttentionSourceDiagnostic]
    ) -> AttentionSource? {
        diagnostics.first { diagnostic in
            (diagnostic.source == .github || diagnostic.source == .codex)
                && !diagnostic.state.isUsable
        }?.source
    }

    private func sourceDiagnosticColor(
        _ tone: LauncherSourceDiagnosticTone
    ) -> Color {
        switch tone {
        case .positive:
            LauncherVisualTokens.statusSuccess(colorScheme)
        case .warning:
            LauncherVisualTokens.statusWarning(colorScheme)
        case .critical:
            LauncherVisualTokens.statusSignal(colorScheme)
        case .neutral:
            LauncherVisualTokens.textTertiary(colorScheme)
        }
    }

    private func primaryButton(
        title: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(
                    LauncherVisualTokens.surfaceFloating(.light)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, minHeight: 42, maxHeight: 42)
        .background(LauncherVisualTokens.actionPrimary(colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func secondaryButton(
        title: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(
                    LauncherVisualTokens.textPrimary(colorScheme)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(minWidth: 150, maxWidth: 150, minHeight: 42)
        .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var footer: some View {
        HStack(spacing: 9) {
            Button("대시보드") {
                viewModel.openDashboard()
            }
            .buttonStyle(.plain)
            Button("설정") {
                openSettings()
            }
            .buttonStyle(.plain)
            Spacer()
            if viewModel.currentProjection?.card != nil {
                keyboardHint(key: "⌘I", label: "근거")
                keyboardHint(key: "↵", label: "실행")
            }
            keyboardHint(key: "Esc", label: "닫기")
            if !viewModel.isHotKeyRegistered {
                keyboardHint(key: "!", label: "단축키 충돌")
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(
            LauncherVisualTokens.textSecondary(colorScheme)
        )
        .frame(height: 22)
    }

    private func keyboardHint(key: String, label: String) -> some View {
        HStack(spacing: 6) {
            Text(key)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(
                    LauncherVisualTokens.textPrimary(colorScheme)
                )
            Text(label)
                .font(.system(size: 10))
        }
        .padding(.horizontal, 6)
        .frame(height: 22)
        .background(LauncherVisualTokens.surfaceSubtle(colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(
                    LauncherVisualTokens.borderDefault(colorScheme),
                    lineWidth: 1
                )
        }
    }

}
