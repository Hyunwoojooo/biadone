import CoordinatorSwift
import SwiftUI

private enum PetPanelVisualStyle {
    static let cornerRadius: CGFloat = 30
    static let rimWidth: CGFloat = 0.75
    static let contentPadding: CGFloat = 22
    static let sectionRadius: CGFloat = 20
    static let rowRadius: CGFloat = 18
}

private struct PetInsetSurfaceModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    let emphasized: Bool
    let cornerRadius: CGFloat

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    private var fill: Color {
        if colorScheme == .dark {
            return Color.white.opacity(emphasized ? 0.10 : 0.065)
        }
        return Color.white.opacity(emphasized ? 0.58 : 0.38)
    }

    private var rim: Color {
        colorScheme == .dark
            ? Color.white.opacity(0.13)
            : Color.white.opacity(0.70)
    }

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(Color(nsColor: .controlBackgroundColor), in: shape)
                .overlay(
                    shape.strokeBorder(
                        Color(nsColor: .separatorColor),
                        lineWidth: 1
                    )
                )
        } else {
            content
                .background(fill, in: shape)
                .overlay(shape.strokeBorder(rim, lineWidth: 0.75))
        }
    }
}

private extension View {
    func petInsetSurface(
        emphasized: Bool = false,
        cornerRadius: CGFloat = PetPanelVisualStyle.sectionRadius
    ) -> some View {
        modifier(PetInsetSurfaceModifier(
            emphasized: emphasized,
            cornerRadius: cornerRadius
        ))
    }

    @ViewBuilder
    func petCapsuleButtonBorder() -> some View {
        if #available(macOS 14.0, *) {
            buttonBorderShape(.capsule)
        } else {
            self
        }
    }

    @ViewBuilder
    func petCircleButtonBorder() -> some View {
        if #available(macOS 14.0, *) {
            buttonBorderShape(.circle)
        } else {
            self
        }
    }
}

private struct PetPanelSurfaceModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    private var shape: RoundedRectangle {
        RoundedRectangle(
            cornerRadius: PetPanelVisualStyle.cornerRadius,
            style: .continuous
        )
    }

    private var rimGradient: LinearGradient {
        let colors: [Color]
        if colorScheme == .dark {
            colors = [
                .white.opacity(0.24),
                .white.opacity(0.08),
                .black.opacity(0.34),
            ]
        } else {
            colors = [
                .white.opacity(0.62),
                .white.opacity(0.16),
                .black.opacity(0.10),
            ]
        }
        return LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom)
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(
                    Color(nsColor: .windowBackgroundColor),
                    in: shape
                )
                .overlay(
                    shape.strokeBorder(
                        Color(nsColor: .separatorColor),
                        lineWidth: 1
                    )
                )
        } else {
            glassOrFallback(content)
        }
    }

    @ViewBuilder
    private func glassOrFallback<Surface: View>(_ content: Surface) -> some View {
        #if compiler(>=6.2)
        if #available(macOS 26.0, *) {
            content
                .glassEffect(.regular, in: shape)
                .overlay(
                    shape.strokeBorder(
                        rimGradient,
                        lineWidth: PetPanelVisualStyle.rimWidth
                    )
                )
        } else {
            fallbackSurface(content)
        }
        #else
        fallbackSurface(content)
        #endif
    }

    private func fallbackSurface<Surface: View>(_ content: Surface) -> some View {
        content
            .background {
                shape
                    .fill(.regularMaterial)
                    .overlay(
                        shape.fill(
                            (colorScheme == .dark ? Color.black : Color.white)
                                .opacity(colorScheme == .dark ? 0.08 : 0.05)
                        )
                    )
            }
            .overlay(
                shape.strokeBorder(
                    rimGradient,
                    lineWidth: PetPanelVisualStyle.rimWidth
                )
            )
    }
}

struct PetRootView: View {
    @ObservedObject var viewModel: PetViewModel

    var body: some View {
        panelBody
            .modifier(PetPanelSurfaceModifier())
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
    }

    private var panelBody: some View {
        VStack(spacing: 18) {
            header
            if let managedApproval = viewModel.pendingManagedCommandApproval {
                contentViewport(for: .permission) {
                    managedCommandApprovalCard(managedApproval)
                }
                if viewModel.hasVisibleStatusMessage {
                    compactStatusMessages
                }
            } else if let permissionRequest = viewModel.pendingPermissionRequest {
                contentViewport(for: .permission) {
                    permissionRequestCard(permissionRequest)
                }
                if viewModel.hasVisibleStatusMessage {
                    compactStatusMessages
                }
            } else if viewModel.isShowingOnboarding {
                contentViewport(for: .projectSettings) {
                    onboardingSettings
                }
            } else if viewModel.isEditingShortcuts {
                contentViewport(for: .shortcutSettings) {
                    shortcutSettings
                }
            } else {
                contentViewport(for: screenMode) {
                    decisionContent
                }
                if viewModel.hasVisibleStatusMessage {
                    compactStatusMessages
                }
            }
        }
        .padding(PetPanelVisualStyle.contentPadding)
    }

    private var compactStatusMessages: some View {
        let hasTwoMessages = viewModel.lastError != nil
            && viewModel.visibleShortcutDiagnostic != nil
        return VStack(alignment: .leading, spacing: 2) {
            if let error = viewModel.lastError {
                Text(error)
                    .foregroundStyle(.red)
                    .lineLimit(hasTwoMessages ? 1 : PetPanelContentPolicy.statusMessageLineLimit)
                    .truncationMode(.tail)
                    .help(error)
            }
            if let diagnostic = viewModel.visibleShortcutDiagnostic {
                Text(diagnostic)
                    .foregroundStyle(.orange)
                    .lineLimit(hasTwoMessages ? 1 : PetPanelContentPolicy.statusMessageLineLimit)
                    .truncationMode(.tail)
                    .help(diagnostic)
            }
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var screenMode: PetPanelScreenMode {
        if viewModel.isShowingOnboarding {
            return .projectSettings
        }
        if viewModel.isEditingShortcuts {
            return .shortcutSettings
        }
        if viewModel.pendingManagedCommandApproval != nil
            || viewModel.pendingPermissionRequest != nil
        {
            return .permission
        }
        if viewModel.isExpanded, viewModel.displayInteraction != nil {
            return .details
        }
        if let actionCount = viewModel.displayInteraction?.actionChoices.count {
            return .decision(actionCount: actionCount)
        }
        return .ready
    }

    @ViewBuilder
    private func contentViewport<Content: View>(
        for mode: PetPanelScreenMode,
        @ViewBuilder content: () -> Content
    ) -> some View {
        if PetPanelContentPolicy.allowsScrolling(in: mode) {
            ScrollView {
                content()
            }
        } else {
            content()
        }
    }

    private var decisionContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if viewModel.snapshotInteractions.count > 1 {
                fifoQueueStatus
            }
            if let interaction = viewModel.displayInteraction {
                decisionCard(interaction)
                if viewModel.isExpanded {
                    interactionDetails(interaction)
                }
            } else if viewModel.snapshotInteractions.isEmpty {
                emptyState
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(viewModel.presentationState.displayTitle)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.secondary)
                if viewModel.isRecoveryCapable {
                    Text(PetPresentationState.recoveryCapable.displayTitle)
                        .font(.caption2.bold())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.16), in: Capsule())
                }
            }
            .accessibilityElement(children: .combine)
            Spacer()
            Button {
                Task { await viewModel.toggleOnboarding() }
            } label: {
                Image(systemName: viewModel.isShowingOnboarding ? "shippingbox.fill" : "shippingbox")
            }
            .buttonStyle(.bordered)
            .petCircleButtonBorder()
            .controlSize(.small)
            .accessibilityLabel(
                viewModel.isShowingOnboarding ? "Blabee 설정 닫기" : "Blabee 설정 열기"
            )
            Button(action: viewModel.toggleShortcutSettings) {
                Image(systemName: viewModel.isEditingShortcuts ? "gearshape.fill" : "gearshape")
            }
            .buttonStyle(.bordered)
            .petCircleButtonBorder()
            .controlSize(.small)
            .accessibilityLabel(
                viewModel.isEditingShortcuts ? "단축키 설정 닫기" : "단축키 설정 열기"
            )
            Button(action: viewModel.requestPanelToggle) {
                Image(systemName: "xmark")
            }
            .buttonStyle(.bordered)
            .petCircleButtonBorder()
            .controlSize(.small)
            .accessibilityLabel("Blabee 패널 닫기")
        }
    }

    private func permissionRequestCard(_ request: PetPermissionRequest) -> some View {
        let isResolving = request.deliveryPending
            || viewModel.inFlightPermissionRequestID == request.requestID
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.orange)
                    .frame(width: 40, height: 40)
                    .background(Color.orange.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 7) {
                        Text("Codex 권한 요청")
                            .font(.title2.weight(.semibold))
                        if viewModel.approvalQueueCount > 1 {
                            Text("1 / \(viewModel.approvalQueueCount)")
                                .font(.caption2.monospaced().bold())
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(projectName(for: request))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(request.cwd)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("일반 Codex Hook")
                    .font(.callout.monospaced().bold())
                Label(
                    "세션: \(shortSessionID(request.sessionID))",
                    systemImage: "link"
                )
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .help(request.sessionID)
                Text(request.toolName)
                    .font(.caption.monospaced().bold())
                    .foregroundStyle(.secondary)
                Text(request.displaySummary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .truncationMode(.tail)
                    .help(request.displaySummary)
                Label(request.cwd, systemImage: "folder")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .help(request.cwd)
                Text(request.commandPreview)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .help(request.commandPreview)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Color.primary.opacity(0.05),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
            }

            if request.deliveryPending {
                Label("Codex에 전달 확인 중", systemImage: "hourglass")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.orange)
            }

            VStack(spacing: 9) {
                permissionChoiceRow(
                    number: 1,
                    title: PetPermissionDecision.deny.displayTitle,
                    icon: "xmark",
                    tint: .red,
                    emphasized: false,
                    disabled: isResolving
                ) {
                    await viewModel.resolvePermissionRequest(.deny, for: request)
                }
                permissionChoiceRow(
                    number: 2,
                    title: PetPermissionDecision.deferToCodex.displayTitle,
                    icon: "arrow.up.forward.app",
                    tint: .teal,
                    emphasized: false,
                    disabled: isResolving
                ) {
                    await viewModel.resolvePermissionRequest(.deferToCodex, for: request)
                }
            }

            Text("Hook 권한은 Pet에서 허용하지 않습니다. 거절하거나 Codex에서 직접 결정하세요.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func managedCommandApprovalCard(
        _ request: PetManagedCommandApproval
    ) -> some View {
        let isResolving = request.deliveryPending
            || viewModel.inFlightManagedCommandApprovalID != nil
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.blue)
                    .frame(width: 40, height: 40)
                    .background(Color.blue.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 7) {
                        Text("Blabee 관리형 권한 요청")
                            .font(.title2.weight(.semibold))
                        if viewModel.approvalQueueCount > 1 {
                            Text("1 / \(viewModel.approvalQueueCount)")
                                .font(.caption2.monospaced().bold())
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(projectName(forManagedCWD: request.cwd))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(request.cwd)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("관리형 Codex App Server")
                    .font(.callout.monospaced().bold())
                Label(request.cwd, systemImage: "folder")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .help(request.cwd)
                Label(
                    "환경: \(request.environmentID ?? "기본 환경")",
                    systemImage: "desktopcomputer"
                )
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(request.environmentID ?? "기본 환경")
                Label(
                    "세션: \(shortSessionID(request.threadID))",
                    systemImage: "link"
                )
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(request.threadID)
                Text(request.commandPreview)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .help(request.commandPreview)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Color.primary.opacity(0.05),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
            }

            if request.deliveryPending {
                Label("Codex에 전달 확인 중", systemImage: "hourglass")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.orange)
            }

            VStack(spacing: 9) {
                permissionChoiceRow(
                    number: 1,
                    title: PetManagedCommandApprovalDecision.acceptOnce.displayTitle,
                    icon: "checkmark",
                    tint: .blue,
                    emphasized: request.allowOnceAvailable,
                    disabled: isResolving || !request.allowOnceAvailable
                ) {
                    await viewModel.resolveManagedCommandApproval(
                        .acceptOnce,
                        for: request
                    )
                }
                permissionChoiceRow(
                    number: 2,
                    title: PetManagedCommandApprovalDecision.decline.displayTitle,
                    icon: "xmark",
                    tint: .red,
                    emphasized: false,
                    disabled: isResolving || !request.declineAvailable
                ) {
                    await viewModel.resolveManagedCommandApproval(
                        .decline,
                        for: request
                    )
                }
                permissionChoiceRow(
                    number: 3,
                    title: PetManagedCommandApprovalDecision.decideInCodex.displayTitle,
                    icon: "arrow.up.forward.app",
                    tint: .teal,
                    emphasized: false,
                    disabled: isResolving
                ) {
                    await viewModel.resolveManagedCommandApproval(
                        .decideInCodex,
                        for: request
                    )
                }
            }

            Text("세션 동안 허용은 제공하지 않습니다. 응답하지 않으면 Codex의 기존 승인 화면으로 돌아갑니다.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .id(request.managedRequestID)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func permissionChoiceRow(
        number: Int,
        title: String,
        icon: String,
        tint: Color,
        emphasized: Bool,
        disabled: Bool,
        action: @escaping @MainActor () async -> Void
    ) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 34, height: 34)
                    .background(tint.opacity(0.13), in: Circle())
                Text(title)
                    .font(.body.weight(.semibold))
                Spacer(minLength: 8)
                Text("\(number)")
                    .font(.caption.monospaced().bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(
                        Color.primary.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 8)
                    )
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .petInsetSurface(
                emphasized: emphasized && !disabled,
                cornerRadius: PetPanelVisualStyle.rowRadius
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.55 : 1)
    }

    private var fifoQueueStatus: some View {
        HStack(spacing: 8) {
            Label("FIFO 대기열", systemImage: "list.number")
                .font(.caption.bold())
            Spacer(minLength: 8)
            if let position = viewModel.displayInteractionQueuePosition {
                Text("현재 \(position) / \(viewModel.fifoQueueCount)")
                    .font(.caption.monospaced().bold())
            }
            Text("다음 \(max(viewModel.fifoQueueCount - 1, 0))개")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
    }

    private func decisionCard(_ interaction: PetInteraction) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(projectName(for: interaction))
                        .font(.title2.weight(.semibold))
                        .lineLimit(PetPanelContentPolicy.projectNameLineLimit)
                        .truncationMode(.tail)
                        .help(projectName(for: interaction))
                    Text(interaction.summary)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(PetPanelContentPolicy.summaryLineLimit)
                        .truncationMode(.tail)
                        .help(interaction.summary)
                }
                Spacer(minLength: 8)
                Button {
                    viewModel.toggleExpanded()
                } label: {
                    HStack(spacing: 5) {
                        Text(viewModel.isExpanded ? "상세 닫기" : "상세 보기")
                        Image(systemName: viewModel.isExpanded ? "chevron.up" : "arrow.right")
                    }
                    .font(.callout.bold())
                }
                .buttonStyle(.bordered)
                .petCapsuleButtonBorder()
                .controlSize(.small)
            }

            VStack(spacing: 10) {
                ForEach(interaction.actionChoices) { choice in
                    choiceRow(interaction: interaction, choice: choice)
                }
            }

            secondaryControls(interaction: interaction)
        }
    }

    private func choiceRow(interaction: PetInteraction, choice: PetChoice) -> some View {
        let accessory = viewModel.actionAccessoryPresentation(
            interaction: interaction,
            choice: choice
        )
        let submissionInProgress = viewModel.selectionSubmission != nil
        let ownsProgress = accessory == .progress
        let enabled = choice.enabled && interaction.isSelectionReady && !submissionInProgress
        let tint = choiceTint(slot: choice.slot)
        return Button {
            Task {
                await viewModel.focusAndRequestPanelSelection(
                    choice.slot,
                    interaction: interaction.identity
                )
            }
        } label: {
            HStack(spacing: 13) {
                Image(systemName: choiceIcon(slot: choice.slot))
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 38, height: 38)
                    .background(tint.opacity(0.13), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 7) {
                        Text(choice.displayTitle)
                            .font(.body.weight(.semibold))
                            .lineLimit(PetPanelContentPolicy.actionTitleLineLimit)
                            .truncationMode(.tail)
                            .help(choice.displayTitle)
                        if choice.slot == 1 {
                            Text("권장")
                                .font(.caption2.bold())
                                .foregroundStyle(.white)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(Color.accentColor, in: Capsule())
                        } else {
                            Text("\(choice.slot)순위")
                                .font(.caption2.bold())
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let disabledReason = choice.disabledReason {
                        Text(disabledReason)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(PetPanelContentPolicy.disabledReasonLineLimit)
                            .truncationMode(.tail)
                            .help(disabledReason)
                    }
                }
                Spacer(minLength: 8)
                switch accessory {
                case .shortcut(let label):
                    Text(label)
                        .font(.caption.monospaced().bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(
                            Color.primary.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                case .progress:
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                            .accessibilityHidden(true)
                        Text("진행 중")
                            .font(.caption.bold())
                    }
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                case .suppressed:
                    Text("사용 불가")
                        .font(.caption.monospaced().bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(
                            Color.primary.opacity(0.08),
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                        .hidden()
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .petInsetSurface(
                emphasized: choice.slot == 1 && (enabled || ownsProgress),
                cornerRadius: PetPanelVisualStyle.rowRadius
            )
            .overlay(
                RoundedRectangle(
                    cornerRadius: PetPanelVisualStyle.rowRadius,
                    style: .continuous
                )
                .stroke(
                        choice.slot == 1 && (enabled || ownsProgress)
                            ? tint.opacity(0.32)
                            : Color.clear,
                        lineWidth: 1
                    )
            )
            .accessibilityValue(ownsProgress ? "진행 중" : "")
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled || ownsProgress ? 1 : submissionInProgress ? 0.72 : 0.52)
    }

    private func secondaryControls(interaction: PetInteraction) -> some View {
        HStack(spacing: 8) {
            if interaction.usesRankedNextActions {
                Button(action: viewModel.requestPanelToggle) {
                    Label("나중에 결정", systemImage: "clock")
                }
                .buttonStyle(.bordered)
                .petCapsuleButtonBorder()
            } else if interaction.legacyPauseChoice?.enabled == true {
                Button {
                    Task { await viewModel.requestLegacyPause() }
                } label: {
                    Label("보류", systemImage: "pause.circle")
                }
                .buttonStyle(.bordered)
                .petCapsuleButtonBorder()
            }

            Button(action: {}) {
                Label("이전 프롬프트", systemImage: "arrow.uturn.backward")
            }
            .buttonStyle(.bordered)
            .petCapsuleButtonBorder()
            .disabled(true)
            .help(
                interaction.legacyRollbackChoice?.disabledReason
                    ?? "안전한 롤백 확인 절차가 준비된 뒤 사용할 수 있습니다."
            )

            Spacer(minLength: 0)
        }
        .font(.caption)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func interactionDetails(_ interaction: PetInteraction) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(interaction.summary)
                    .font(.title3.bold())
                if let outcome = interaction.outcome {
                    Text("\(outcome.status) · \(outcome.summary)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text("프로젝트  \(interaction.identity.binding.projectID)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Text("세션  \(interaction.identity.binding.sessionID)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                Text("경로  \(interaction.cwd)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }

            detailSection(title: "위험") {
                Text(interaction.risk.level.rawValue)
                    .font(.callout.bold())
                if interaction.risk.reasons.isEmpty {
                    Text("보고된 위험 사유 없음")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(interaction.risk.reasons, id: \.self) { reason in
                        Text("• \(reason)").font(.caption)
                    }
                }
            }

            detailSection(title: "증거 · 체크포인트") {
                Text("\(interaction.checkpoint.coverage) · \(interaction.checkpoint.id)")
                    .font(.caption.monospaced())
                if interaction.evidence.isEmpty {
                    Text("표시할 증거가 없습니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(interaction.evidence) { evidence in
                        Text("\(evidence.status) · \(evidence.summary)")
                            .font(.caption)
                    }
                }
            }

            if !interaction.reportedSideEffects.isEmpty {
                detailSection(title: "보고된 부수 효과") {
                    ForEach(interaction.reportedSideEffects) { effect in
                        Text("\(effect.reversibility) · \(effect.summary)")
                            .font(.caption)
                    }
                }
            }

            if let confirmation = viewModel.riskConfirmation,
               confirmation.identity == interaction.identity
            {
                VStack(alignment: .leading, spacing: 9) {
                    Text("위험 확인 필요")
                        .font(.callout.bold())
                    Text("이 확인은 다음 작업 지시만 보냅니다. Codex의 네이티브 권한 승인을 대신하지 않습니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("취소", action: viewModel.cancelRiskConfirmation)
                        Button("위험을 확인하고 실행") {
                            Task { await viewModel.confirmRiskSelection() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
                .padding(12)
                .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func projectName(for interaction: PetInteraction) -> String {
        let name = URL(fileURLWithPath: interaction.cwd, isDirectory: true).lastPathComponent
        return name.isEmpty ? interaction.identity.binding.projectID : name
    }

    private func projectName(for request: PetPermissionRequest) -> String {
        let name = URL(fileURLWithPath: request.cwd, isDirectory: true).lastPathComponent
        return name.isEmpty ? request.projectID : name
    }

    private func projectName(forManagedCWD cwd: String) -> String {
        let name = URL(fileURLWithPath: cwd, isDirectory: true).lastPathComponent
        return name.isEmpty ? "Codex" : name
    }

    private func shortSessionID(_ sessionID: String) -> String {
        guard sessionID.count > 18 else { return sessionID }
        return "\(sessionID.prefix(8))…\(sessionID.suffix(6))"
    }

    private func choiceIcon(slot: Int) -> String {
        switch slot {
        case 1: "hand.thumbsup.fill"
        case 2: "arrow.triangle.branch"
        case 3: "checkmark.shield.fill"
        case 4: "safari.fill"
        default: "circle"
        }
    }

    private func choiceTint(slot: Int) -> Color {
        switch slot {
        case 1: .indigo
        case 2: .purple
        case 3: .blue
        case 4: .teal
        default: .gray
        }
    }

    private var shortcutSettings: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("단축키 설정")
                    .font(.headline)
                Text("보조키 없는 입력을 가로채지 않도록 Option을 포함해야 하며, Option 단독은 숫자와 Space에만 사용할 수 있습니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(PetShortcutIntent.allCases, id: \.self) { intent in
                shortcutSettingRow(intent)
            }

            if let error = viewModel.shortcutSettingsError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Button("기본값 불러오기", action: viewModel.restoreDefaultShortcutDraft)
                Spacer()
                Button("취소", action: viewModel.cancelShortcutSettings)
                Button("저장", action: viewModel.saveShortcutSettings)
                    .buttonStyle(.borderedProminent)
                    .disabled(!viewModel.canSaveShortcutSettings)
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 12))
    }

    private var onboardingSettings: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Blabee 설정")
                        .font(.title2.weight(.semibold))
                    Text("후속 제안, 프로젝트 관찰 범위와 백그라운드 서비스를 관리합니다.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if viewModel.isOnboardingOperationInFlight {
                    ProgressView()
                        .controlSize(.regular)
                        .accessibilityLabel("Blabee 설정 처리 중")
                }
            }

            VStack(alignment: .leading, spacing: 13) {
                HStack(spacing: 12) {
                    Image(systemName: onboardingServiceSymbol)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(onboardingServiceColor)
                        .frame(width: 38, height: 38)
                        .background(onboardingServiceColor.opacity(0.13), in: Circle())
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("백그라운드 서비스")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(viewModel.onboardingServiceState.displayTitle)
                            .font(.body.weight(.semibold))
                    }
                    Spacer(minLength: 8)
                    Text(viewModel.onboardingServiceState.displayTitle)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(onboardingServiceColor)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(onboardingServiceColor.opacity(0.12), in: Capsule())
                }
                Text(viewModel.onboardingServiceState.displayDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                onboardingServiceActions
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .petInsetSurface(emphasized: true)

            suggestionModeCard

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("관찰할 프로젝트")
                            .font(.body.weight(.semibold))
                        Text("등록한 폴더와 그 하위 경로에서 Blabee가 연결됩니다.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        Task { await viewModel.chooseAndEnableProject() }
                    } label: {
                        Label("폴더 추가", systemImage: "plus")
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

                Label(
                    "프로젝트 설정 변경은 서비스를 재시작한 후 적용됩니다.",
                    systemImage: "arrow.clockwise.circle"
                )
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .petInsetSurface()

            if let error = viewModel.onboardingError {
                Label {
                    Text(error)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                }
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

    @ViewBuilder
    private var onboardingServiceActions: some View {
        HStack(spacing: 8) {
            switch viewModel.onboardingServiceState {
            case .notRegistered:
                Button {
                    Task { await viewModel.registerOnboardingService() }
                } label: {
                    Label("서비스 등록", systemImage: "play.fill")
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
            case .notFound, .unknown:
                Text("이 상태에서는 등록 정보를 변경할 수 없습니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await viewModel.refreshOnboarding() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .petCircleButtonBorder()
            .accessibilityLabel("Blabee 설정 새로고침")
            .disabled(viewModel.isOnboardingOperationInFlight)
        }
    }

    private func configuredProjectRow(_ path: String) -> some View {
        let isActive = viewModel.activeProjectPaths.contains(path)
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
                     ? "현재 서비스에서 활성"
                     : "설정됨 · 서비스 재시작 후 활성")
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

    private var onboardingServiceColor: Color {
        switch viewModel.onboardingServiceState {
        case .enabled: .green
        case .requiresApproval: .orange
        case .notRegistered: .secondary
        case .notFound, .unknown: .secondary
        }
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

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text(viewModel.presentationState.displayTitle)
                .font(.title2.weight(.semibold))
            Text("유효한 결정 카드가 생기면 여기에 표시됩니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
    }

    private func detailSection<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusColor: Color {
        switch viewModel.presentationState {
        case .malformed, .expired: .red
        case .reminder, .permission: .orange
        case .waiting: .blue
        case .paused: .yellow
        case .recoveryCapable: .green
        case .ready: .green
        case .disconnected, .working: .secondary
        }
    }
}

extension PetViewModel {
    var snapshotInteractions: [PetInteraction] { snapshot?.interactions ?? [] }
}
