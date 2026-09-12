import CoordinatorSwift
import SwiftUI

private enum PetPanelVisualStyle {
    // Fits the inner screen curve in Apple's 13-inch M5 Air bezel asset:
    // 35.19 native pixels * 1470 logical points / 2560 native pixels.
    static let cornerRadius: CGFloat = 20.2
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
    // Offscreen view tests omit compositor-only glass; the installed panel uses
    // the default surface. Content and controls follow the same view hierarchy.
    var usesSystemGlassSurface = true
    @State private var showServiceSettings = false
    @State private var showPluginDetails = false
    @State private var showConnectionVerification = false

    var body: some View {
        Group {
            if usesSystemGlassSurface {
                panelBody.modifier(PetPanelSurfaceModifier())
            } else {
                panelBody
            }
        }
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
                ScrollViewReader { scroll in
                    contentViewport(for: .projectSettings) {
                        onboardingSettings(scroll: scroll)
                    }
                    .onChange(of: viewModel.appUpdateSettingsRequestID) { _ in
                        scroll.scrollTo("app-update", anchor: .top)
                    }
                }
            } else if viewModel.isEditingShortcuts {
                contentViewport(for: .shortcutSettings) {
                    shortcutSettings
                }
            } else if let preview = viewModel.choicePreview {
                contentViewport(for: .choicePreview) {
                    PetChoicePreviewView(preview: preview)
                }
                .id(preview.choice.slot)
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
        if viewModel.choicePreview != nil {
            return .choicePreview
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
                    .fill(viewModel.isShowingOnboarding && !viewModel.hasNewPermissionNotice
                          ? PetSettingsStatusTone.connection(viewModel.connectionReadiness).color : statusColor)
                    .frame(width: 8, height: 8)
                Text(viewModel.isShowingOnboarding && !viewModel.hasNewPermissionNotice
                     ? "Blabee 설정" : viewModel.presentationTitle)
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
            || viewModel.inFlightPermissionRequestID != nil
            || viewModel.inFlightManagedCommandApprovalID != nil
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
                Label("세션 위치: \(request.cwd)", systemImage: "folder")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .help("Hook이 제공한 세션 위치입니다. 명령의 실제 실행 폴더·환경은 제공되지 않습니다.")
                PetApprovalCommandPreview(command: request.commandPreview)
            }

            if request.deliveryPending {
                Label("Codex에 전달 확인 중", systemImage: "hourglass")
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.orange)
            }

            VStack(spacing: 9) {
                ForEach(request.displayedDecisions, id: \.rawValue) { decision in
                    permissionChoiceRow(
                        number: decision.choiceNumber,
                        shortcutLabel: viewModel.approvalShortcutLabel(number: decision.choiceNumber, for: .permission(request)),
                        title: decision.displayTitle,
                        detail: decision == .allowOnce && !request.allowOnceAvailable
                            ? "이 연결의 일회성 승인이 아직 검증되지 않았습니다. 3번에서 Codex 승인 화면으로 이동하세요."
                            : nil,
                        icon: decision == .allowOnce ? "checkmark"
                            : decision == .deny ? "xmark" : "arrow.up.forward.app",
                        tint: decision == .allowOnce ? .blue : decision == .deny ? .red : .teal,
                        emphasized: decision == .allowOnce,
                        disabled: isResolving || !request.availableDecisions.contains(decision)
                    ) {
                        await viewModel.resolvePermissionRequest(decision, for: request)
                    }
                }
            }

            approvalShortcutDiagnostic

            Text("이번 요청에만 응답합니다. 이후 명령에 대한 허용 정책은 저장하지 않습니다.")
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
            || viewModel.inFlightPermissionRequestID != nil
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
                    shortcutLabel: viewModel.approvalShortcutLabel(number: 1, for: .managed(request)),
                    title: PetManagedCommandApprovalDecision.acceptOnce.displayTitle,
                    detail: request.allowOnceAvailable ? nil
                        : "이 요청은 Pet에서 일회성 승인할 수 없습니다. 3번에서 Codex 승인 화면으로 이동하세요.",
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
                    shortcutLabel: viewModel.approvalShortcutLabel(number: 2, for: .managed(request)),
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
                    shortcutLabel: viewModel.approvalShortcutLabel(number: 3, for: .managed(request)),
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

            approvalShortcutDiagnostic

            Text("세션 동안 허용은 제공하지 않습니다. 응답하지 않으면 Codex의 기존 승인 화면으로 돌아갑니다.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .id(request.managedRequestID)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func permissionChoiceRow(
        number: Int,
        shortcutLabel: String?,
        title: String,
        detail: String? = nil,
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
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.body.weight(.semibold))
                    if let detail {
                        Text(detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Text(shortcutLabel ?? "\(number)")
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
        .accessibilityIdentifier("permission-choice-\(number)")
        .accessibilityLabel("\(number) \(title)")
        .accessibilityHint([detail, shortcutLabel.map { "단축키 \($0)" }].compactMap { $0 }.joined(separator: " "))
    }

    @ViewBuilder
    private var approvalShortcutDiagnostic: some View {
        if let diagnostic = viewModel.approvalShortcutDiagnostic {
            Text(diagnostic)
                .font(.caption2)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
        }
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
        let previewHint = viewModel.previewShortcutHint(for: choice.slot)
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
        .help(previewHint.isEmpty ? choice.displayTitle : "\(choice.displayTitle)\n\(previewHint)")
        .accessibilityHint(previewHint)
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
                Text("자세히 보기와 선택 실행에 사용할 단축키를 정합니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            choicePreviewShortcutSettings

            Divider()

            VStack(alignment: .leading, spacing: 3) {
                Text("선택 실행 · 패널 열기")
                    .font(.callout.bold())
                Text("이 단축키는 Option을 포함해야 하며, Option 단독은 숫자와 Space에만 사용할 수 있습니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
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
        case .projects:
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

    private func onboardingSettings(scroll: ScrollViewProxy) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Blabee 설정")
                    .font(.title2.weight(.semibold))
                Text("앱 업데이트와 Codex 연결 상태를 확인하세요.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            PetAppUpdateView(viewModel: viewModel)
                .padding(16)
                .petInsetSurface()
                .id("app-update")

            connectionReadinessCard(scroll: scroll)

            onboardingProjects
                .id("connection-projects")

            DisclosureGroup("Codex에서 동작 확인", isExpanded: $showConnectionVerification) {
                connectionVerificationSteps
                    .padding(.top, 10)
            }
            .id("connection-verification")

            DisclosureGroup(isExpanded: $showPluginDetails) {
                codexPluginSetupCard.padding(.top, 10)
            } label: {
                HStack(spacing: 8) {
                    PetSettingsStatusDot(tone: .codexPlugin(viewModel.codexPluginSetupState))
                    Text("Codex 설치 · 진단 상세")
                    Text(codexPluginSetupBadgeTitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(codexPluginInstallationTitle)
            }
            .id("connection-plugin")

            suggestionModeCard

            DisclosureGroup(isExpanded: $showServiceSettings) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("자동 시작 등록은 필수가 아닙니다. 앱 실행형 서비스가 연결되어 있으면 Blabee를 사용할 수 있습니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if viewModel.isAppOwnedServiceAvailable {
                        appOwnedServiceSettings
                    }
                    if viewModel.projectSettingsNeedRestart,
                       !viewModel.isAppOwnedServiceEnabled {
                        Text("자동 시작 서비스를 사용 중이라면 아래 ‘등록 해제’가 완료된 뒤 ‘서비스 등록’을 눌러 새 설정으로 시작하세요. 진행 중인 Blabee 선택·권한 요청을 먼저 마친 뒤 적용해 주세요. Codex 세션과 프로젝트 파일은 변경하지 않습니다.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    onboardingAutomaticServiceSettings
                }
                .padding(.top, 10)
            } label: {
                HStack(spacing: 8) {
                    if let check = viewModel.connectionReadiness.checks.first(where: { $0.id == "service" }) {
                        PetSettingsStatusDot(tone: .check(check.state))
                    }
                    Text("서비스 관리 · 자동 시작 (선택)")
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(
                    viewModel.connectionReadiness.checks.first(where: { $0.id == "service" })?.detail
                        ?? "서비스 상태 확인 전"
                )
            }
            .id("connection-service")

            DisclosureGroup("이전 Codex 연결 정리") {
                LegacyCodexShellCleanupView(viewModel: viewModel).padding(.top, 10)
            }

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
                    Text("아래 서비스 관리에서 실행 방식을 확인한 뒤 서비스를 다시 시작하세요.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
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
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        PetSettingsStatusDot(tone: .neutral)
                        Text("Hook 신뢰 · Codex에서 확인")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                    Text("앱에서는 Hook 신뢰를 자동 판정하지 않습니다. 미확인이 오류를 뜻하지는 않습니다. /hooks와 실제 카드 수신·선택 반환으로 확인하세요.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("/hooks")
                        .font(.callout.monospaced().weight(.semibold))
                        .textSelection(.enabled)
                    Text("SessionStart · UserPromptSubmit · Stop · PermissionRequest")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("이미 열려 있던 세션은 설정을 캐시할 수 있습니다. 닫은 뒤 평소처럼 codex resume으로 다시 열거나 새 세션을 시작하세요.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
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

    @ViewBuilder
    private var codexPluginSetupActions: some View {
        HStack(spacing: 8) {
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
            Spacer()
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
            Spacer()
            Button {
                Task { await viewModel.refreshAllOnboardingSettings() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
            .petCircleButtonBorder()
            .accessibilityLabel("모든 Blabee 설정 새로고침")
        }
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

    private var emptyState: some View {
        VStack(spacing: 8) {
            if viewModel.isAppOwnedServiceEnabled,
               viewModel.appOwnedServiceState == .starting
                || viewModel.appOwnedServiceState == .reconnecting
            {
                ProgressView().controlSize(.small)
            }
            Text(viewModel.presentationTitle)
                .font(.title2.weight(.semibold))
            Text(viewModel.emptyStateDescription)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(3)
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

/// Keep the complete Hook command selectable while bounding its viewport so
/// long or multiline commands cannot push the approval actions arbitrarily far.
struct PetApprovalCommandPreview: View {
    let command: String

    var body: some View {
        ScrollView(.vertical) {
            Text(verbatim: command)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
        }
        .frame(height: 140)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityIdentifier("permission-command-preview")
    }
}

extension PetViewModel {
    var snapshotInteractions: [PetInteraction] { snapshot?.interactions ?? [] }
}
