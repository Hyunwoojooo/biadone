import CoordinatorSwift
import SwiftUI

struct PetRootView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var viewModel: PetViewModel
    // Offscreen view tests omit compositor-only glass; the installed panel uses
    // the default surface. Content and controls follow the same view hierarchy.
    var usesSystemGlassSurface = true
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Group {
            if usesSystemGlassSurface {
                panelBody.modifier(PetPanelSurfaceModifier())
            } else {
                panelBody
            }
        }
            .font(.blabee(.body))
            .foregroundStyle(PetAirPalette.ink(for: colorScheme))
            .padding(1)
            .environment(\.locale, localization.language.locale)
    }

    private var panelBody: some View {
        VStack(spacing: 14) {
            header
            if !viewModel.isProductAccessBlocked, viewModel.eventQueueCount > 1, viewModel.choicePreview == nil,
               viewModel.hasNewPermissionNotice || (!viewModel.isEditingShortcuts && !viewModel.isShowingOnboarding) {
                eventNavigationControls
            }
            if viewModel.isProductAccessBlocked, let productAccess = viewModel.productAccess {
                if viewModel.isShowingSettings {
                    PetSettingsView(viewModel: viewModel)
                } else {
                    PetAccessView(controller: productAccess, account: viewModel.account,
                        settings: { viewModel.showAccessSettings() },
                        diagnostics: { viewModel.showAccessSettings(diagnostics: true) })
                }
            } else if let managedApproval = viewModel.pendingManagedCommandApproval {
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
            } else if viewModel.isShowingOnboarding || viewModel.isEditingShortcuts {
                PetSettingsView(viewModel: viewModel)
            } else if let preview = viewModel.choicePreview {
                contentViewport(for: .choicePreview) {
                    PetChoicePreviewView(preview: preview)
                }
                .id(preview.choice.slot)
            } else {
                contentViewport(for: screenMode) {
                    decisionContent
                }
                .frame(maxHeight: .infinity, alignment: .top)
                if let interaction = viewModel.displayInteraction {
                    secondaryControls(interaction: interaction)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if viewModel.hasVisibleStatusMessage {
                    compactStatusMessages
                }
            }
        }
        .padding(PetPanelVisualStyle.contentPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var compactStatusMessages: some View {
        let hasTwoMessages = viewModel.lastError != nil
            && viewModel.visibleShortcutDiagnostic != nil
        return VStack(alignment: .leading, spacing: 2) {
            if let notice = viewModel.selectionDeliveryNotice {
                selectionDeliveryMessage(notice)
            }
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
            if let diagnostic = viewModel.providerDiagnostic, diagnostic != viewModel.lastError {
                Text(diagnostic)
                    .foregroundStyle(.orange)
                    .lineLimit(PetPanelContentPolicy.statusMessageLineLimit)
                    .help(diagnostic)
                    .accessibilityIdentifier("provider-diagnostic")
            }
        }
        .font(.blabee(.caption))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func selectionDeliveryMessage(_ notice: PetSelectionDeliveryNotice) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(PetL10n.text("Previous selection delivery", korean: "이전 선택 전달"))
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            Text(notice.title)
                .font(.blabee(.caption, weight: .semibold))
            Text(notice.detail)
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                .lineLimit(3)
                .help(notice.detail)
            HStack(spacing: 8) {
                if notice.requiresCodexRecheck && !notice.nativeRecheckSucceeded {
                    Button(viewModel.isCodexPluginOperationInFlight ? PetL10n.text("Checking…", korean: "검사 중…") : PetL10n.text("Check Codex Again", korean: "Codex 다시 검사")) {
                        Task { await viewModel.recheckSelectionDeliveryCodex(noticeID: notice.id) }
                    }
                    .disabled(viewModel.isCodexPluginOperationInFlight || viewModel.isCodexHookCheckInFlight)
                    .accessibilityIdentifier("selection-delivery-recheck")
                }
                Button(PetL10n.text("Close", korean: "닫기")) { viewModel.dismissSelectionDeliveryNotice(noticeID: notice.id) }
                    .accessibilityIdentifier("selection-delivery-dismiss")
            }
            .buttonStyle(PetAirButtonStyle())
            .controlSize(.small)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("selection-delivery-notice")
    }

    private var screenMode: PetPanelScreenMode {
        if viewModel.isProductAccessBlocked { return .projectSettings }
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
            if let status = viewModel.snapshot?.providerStatus,
               viewModel.displayInteraction != nil, !status.selectionEnabled {
                Text(viewModel.presentationTitle)
                    .font(.blabee(.caption))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            }
            if let interaction = viewModel.displayInteraction {
                decisionCard(interaction)
                if viewModel.isExpanded {
                    interactionDetails(interaction)
                }
            } else if viewModel.snapshotInteractions.isEmpty {
                emptyState
            }
            if let resultPhase = viewModel.providerPendingResultDescription {
                Text(resultPhase)
                    .font(.blabee(.caption))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .accessibilityIdentifier("provider-pending-result")
            }
            if let outcome = viewModel.snapshot?.providerStatus?.latestOutcome {
                VStack(alignment: .leading, spacing: 4) {
                    Text(PetL10n.text("Latest selection result · Reported by Claude · \(outcome.selectionID.prefix(8))", korean: "최근 선택 결과 · Claude 보고 · \(outcome.selectionID.prefix(8))"))
                        .font(.blabee(.caption, weight: .bold))
                    Text("\(outcome.status == "succeeded" ? PetL10n.text("Completion report", korean: "완료 보고") : PetL10n.text("Failure report", korean: "실패 보고")): \(outcome.summary)")
                        .font(.blabee(.caption))
                        .lineLimit(4)
                        .help(outcome.summary)
                        .textSelection(.enabled)
                }
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                .accessibilityIdentifier("provider-reported-outcome")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: 10) {
            PetAirBeeMark()
                .frame(width: 20, height: 26)
                .accessibilityHidden(true)
            Text("blabee")
                .font(.blabee(size: 18, weight: .semibold))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            if !viewModel.isProductAccessBlocked, let source = displayedProvider {
                PetProviderMark(provider: source)
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            }
            Spacer(minLength: 8)
            HStack(spacing: 8) {
                Circle()
                    .fill(viewModel.isProductAccessBlocked ? Color.secondary : viewModel.isShowingOnboarding && !viewModel.hasNewPermissionNotice
                          ? PetSettingsStatusTone.commonService(viewModel.connectionReadiness).color : statusColor)
                    .frame(width: 5, height: 5)
                Text((viewModel.isShowingOnboarding || viewModel.isEditingShortcuts) && !viewModel.hasNewPermissionNotice
                     ? PetL10n.text("Settings", korean: "설정") : viewModel.presentationTitle)
                    .font(.blabee(size: 11, weight: .medium))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .lineLimit(1)
                    .help(viewModel.presentationTitle)
                if viewModel.isRecoveryCapable {
                    Text(PetPresentationState.recoveryCapable.displayTitle)
                        .font(.blabee(.caption2, weight: .bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.16), in: Capsule())
                }
            }
            .accessibilityElement(children: .combine)
            if viewModel.feedback != nil {
                Button(action: viewModel.requestFeedback) {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .frame(width: 16, height: 20)
                }
                .buttonStyle(PetAirButtonStyle())
                .controlSize(.small)
                .help(PetL10n.text("Rate suggestions · Share use cases", korean: "제안 평가 · 사용 사례 공유"))
                .accessibilityLabel(PetL10n.text("Send Blabee Feedback", korean: "Blabee 의견 보내기"))
                .accessibilityIdentifier("feedback-open")
            }
            if viewModel.supportsProductSettings {
                Button {
                    if viewModel.isEditingShortcuts {
                        viewModel.cancelShortcutSettings()
                    } else {
                        Task { await viewModel.toggleOnboarding() }
                    }
                } label: {
                    Image(systemName: "slider.horizontal.3")
                        .frame(width: 16, height: 20)
                }
                .buttonStyle(PetAirButtonStyle())
                .controlSize(.small)
                .accessibilityLabel(
                    viewModel.isShowingOnboarding || viewModel.isEditingShortcuts
                        ? PetL10n.text("Close Blabee Settings", korean: "Blabee 설정 닫기") : PetL10n.text("Open Blabee Settings", korean: "Blabee 설정 열기")
                )
            }
            Button(action: viewModel.requestPanelToggle) {
                Image(systemName: "xmark")
                    .frame(width: 16, height: 20)
            }
            .buttonStyle(PetAirButtonStyle())
            .controlSize(.small)
            .accessibilityLabel(PetL10n.text("Close Blabee Panel", korean: "Blabee 패널 닫기"))
        }
    }

    /// The glyph describes the currently displayed card, never a destination
    /// selected independently from it. Settings and the empty inbox have no
    /// provider selection affordance.
    private var displayedProvider: PetProvider? {
        if viewModel.hasNewPermissionNotice { return .codex }
        guard !viewModel.isShowingOnboarding, !viewModel.isEditingShortcuts,
              viewModel.displayInteraction != nil || viewModel.choicePreview != nil else { return nil }
        return viewModel.provider
    }

    private func performProviderAction(
        _ context: PetViewModel.ProviderActionContext,
        operation: @escaping @MainActor () async -> Void
    ) {
        Task {
            guard viewModel.acceptsProviderAction(context) else { return }
            await operation()
        }
    }

    private func permissionRequestCard(_ request: PetPermissionRequest) -> some View {
        let isResolving = request.deliveryPending
            || viewModel.inFlightPermissionRequestID != nil
            || viewModel.inFlightManagedCommandApprovalID != nil
            || !viewModel.canActOnDisplayedEvent
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.orange)
                    .frame(width: 40, height: 40)
                    .background(Color.orange.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 7) {
                        Text(PetL10n.text("Codex permission request", korean: "Codex 권한 요청"))
                            .font(.blabee(.title2, weight: .semibold))
                    }
                    Text(projectName(for: request))
                        .font(.caption.monospaced())
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(request.cwd)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text(PetL10n.text("Standard Codex Hook", korean: "일반 Codex Hook"))
                    .font(.callout.monospaced().bold())
                Label(
                    PetL10n.text("Session: \(shortSessionID(request.sessionID))", korean: "세션: \(shortSessionID(request.sessionID))"),
                    systemImage: "link"
                )
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .help(request.sessionID)
                Text(request.toolName)
                    .font(.caption.monospaced().bold())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                Text(request.displaySummary)
                    .font(.blabee(.callout))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .lineLimit(3)
                    .truncationMode(.tail)
                    .help(request.displaySummary)
                Label(PetL10n.text("Session location: \(request.cwd)", korean: "세션 위치: \(request.cwd)"), systemImage: "folder")
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .help(PetL10n.text("The Hook provided this session location. The command's actual working directory and environment are unavailable.", korean: "Hook이 제공한 세션 위치입니다. 명령의 실제 실행 폴더·환경은 제공되지 않습니다."))
                PetApprovalCommandPreview(command: request.commandPreview)
            }

            if request.deliveryPending {
                Label(PetL10n.text("Confirming delivery to Codex", korean: "Codex에 전달 확인 중"), systemImage: "hourglass")
                    .font(.blabee(.callout, weight: .semibold))
                    .foregroundStyle(.orange)
            } else if let waitMessage = request.approvalWaitMessage {
                Text(waitMessage)
                    .font(.blabee(.caption))
                    .monospacedDigit()
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 9) {
                ForEach(request.displayedDecisions, id: \.rawValue) { decision in
                    permissionChoiceRow(
                        number: decision.choiceNumber,
                        shortcutLabel: viewModel.approvalShortcutLabel(number: decision.choiceNumber, for: .permission(request)),
                        title: decision.displayTitle,
                        detail: decision == .allowOnce && !request.allowOnceAvailable
                            ? PetL10n.text("One-time approval has not been verified for this connection. Choose option 3 to open the Codex approval screen.", korean: "이 연결의 일회성 승인이 아직 검증되지 않았습니다. 3번에서 Codex 승인 화면으로 이동하세요.")
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

            Text(PetL10n.text("This response applies only to this request. It does not save an approval policy for future commands.", korean: "이번 요청에만 응답합니다. 이후 명령에 대한 허용 정책은 저장하지 않습니다."))
                .font(.blabee(.caption2))
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func managedCommandApprovalCard(
        _ request: PetManagedCommandApproval
    ) -> some View {
        let isResolving = request.deliveryPending
            || viewModel.inFlightManagedCommandApprovalID != nil
            || viewModel.inFlightPermissionRequestID != nil
            || !viewModel.canActOnDisplayedEvent
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.blue)
                    .frame(width: 40, height: 40)
                    .background(Color.blue.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 7) {
                        Text(PetL10n.text("Blabee managed permission request", korean: "Blabee 관리형 권한 요청"))
                            .font(.blabee(.title2, weight: .semibold))
                    }
                    Text(projectName(forManagedCWD: request.cwd))
                        .font(.caption.monospaced())
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(request.cwd)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text(PetL10n.text("Managed Codex App Server", korean: "관리형 Codex App Server"))
                    .font(.callout.monospaced().bold())
                Label(request.cwd, systemImage: "folder")
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .help(request.cwd)
                Label(
                    PetL10n.text("Environment: \(request.environmentID ?? "Default environment")", korean: "환경: \(request.environmentID ?? "기본 환경")"),
                    systemImage: "desktopcomputer"
                )
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(request.environmentID ?? PetL10n.text("Default environment", korean: "기본 환경"))
                Label(
                    PetL10n.text("Session: \(shortSessionID(request.threadID))", korean: "세션: \(shortSessionID(request.threadID))"),
                    systemImage: "link"
                )
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(request.threadID)
                PetApprovalCommandPreview(command: request.commandPreview)
            }

            if request.deliveryPending {
                Label(PetL10n.text("Confirming delivery to Codex", korean: "Codex에 전달 확인 중"), systemImage: "hourglass")
                    .font(.blabee(.callout, weight: .semibold))
                    .foregroundStyle(.orange)
            }

            VStack(spacing: 9) {
                permissionChoiceRow(
                    number: 1,
                    shortcutLabel: viewModel.approvalShortcutLabel(number: 1, for: .managed(request)),
                    title: PetManagedCommandApprovalDecision.acceptOnce.displayTitle,
                    detail: request.allowOnceAvailable ? nil
                        : PetL10n.text("This request cannot be approved in the Pet. Choose option 3 to open the Codex approval screen.", korean: "이 요청은 Pet에서 일회성 승인할 수 없습니다. 3번에서 Codex 승인 화면으로 이동하세요."),
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

            Text(PetL10n.text("Session-wide approval is unavailable. Without a response, approval returns to Codex.", korean: "세션 동안 허용은 제공하지 않습니다. 응답하지 않으면 Codex의 기존 승인 화면으로 돌아갑니다."))
                .font(.blabee(.caption2))
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
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
        let context = viewModel.captureProviderActionContext()
        let displayedShortcut = shortcutLabel
            ?? PetApprovalShortcutIntent(rawValue: number)?.label
            ?? "\(number)"
        let shortcutHint = PetL10n.text("Shortcut \(displayedShortcut)", korean: "단축키 \(displayedShortcut)")
            + (shortcutLabel == nil ? PetL10n.text(", currently unavailable", korean: ", 현재 사용 불가") : "")
        return Button {
            performProviderAction(context, operation: action)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 34, height: 34)
                    .background(tint.opacity(0.13), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.blabee(.body, weight: .semibold))
                    if let detail {
                        Text(detail)
                            .font(.blabee(.caption2))
                            .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Text(displayedShortcut)
                    .font(.caption.monospaced().bold())
                    .opacity(shortcutLabel == nil ? 0.55 : 1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(
                        Color.primary.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 8)
                    )
                    .help(shortcutHint)
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
        .accessibilityHint([detail, shortcutHint].compactMap { $0 }.joined(separator: " "))
    }

    @ViewBuilder
    private var approvalShortcutDiagnostic: some View {
        if let diagnostic = [viewModel.approvalShortcutDiagnostic, viewModel.eventNavigationShortcutDiagnostic]
            .compactMap({ $0 }).first {
            Text(diagnostic)
                .font(.blabee(.caption2))
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var eventNavigationControls: some View {
        let context = viewModel.captureProviderActionContext()
        return HStack(spacing: 8) {
            Text(PetL10n.text("Pending tasks", korean: "대기 작업"))
                .font(.blabee(.caption, weight: .semibold))
            Text("\(viewModel.displayedEventQueuePosition ?? 0) / \(viewModel.eventQueueCount)")
                .font(.blabee(.caption, weight: .bold).monospacedDigit())
                .accessibilityLabel(PetL10n.text("Task \(viewModel.displayedEventQueuePosition ?? 0) of \(viewModel.eventQueueCount)", korean: "전체 \(viewModel.eventQueueCount)개 중 \(viewModel.displayedEventQueuePosition ?? 0)번째 작업"))
            Spacer(minLength: 0)
            if viewModel.pendingEventFocus != nil {
                ProgressView().controlSize(.small)
                    .accessibilityLabel(PetL10n.text("Confirming task switch", korean: "작업 전환 확인 중"))
            }
            Text("⌥ ← / →")
                .font(.caption.monospaced())
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                .accessibilityHidden(true)
            Button {
                performProviderAction(context) { await viewModel.navigateToPreviousEvent() }
            } label: { Image(systemName: "chevron.left") }
                .accessibilityIdentifier("previous-event")
                .accessibilityLabel(PetL10n.text("Previous task", korean: "이전 작업"))
                .help(PetL10n.text("Previous task · Option + Left Arrow", korean: "이전 작업 · Option + 왼쪽 방향키"))
            Button {
                performProviderAction(context) { await viewModel.navigateToNextEvent() }
            } label: { Image(systemName: "chevron.right") }
                .accessibilityIdentifier("next-event")
                .accessibilityLabel(PetL10n.text("Next task", korean: "다음 작업"))
                .help(PetL10n.text("Next task · Option + Right Arrow", korean: "다음 작업 · Option + 오른쪽 방향키"))
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(!viewModel.canNavigateEvents)
        .padding(.horizontal, 9)
        .frame(height: 26)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("event-navigation")
    }

    private func decisionCard(_ interaction: PetInteraction) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 10) {
                Text(interaction.suggestionKindLabel)
                    .font(.blabee(size: 12, weight: .medium))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .lineLimit(1)
                    .accessibilityIdentifier("suggestion-kind")
                Spacer(minLength: 8)
                Button(action: viewModel.toggleExpanded) {
                    Label(viewModel.isExpanded ? PetL10n.text("Hide Details", korean: "상세 닫기") : PetL10n.text("Show Details", korean: "상세 보기"),
                          systemImage: viewModel.isExpanded ? "chevron.up" : "arrow.up.right")
                }
                .font(.blabee(size: 12, weight: .medium))
                .buttonStyle(PetAirButtonStyle())
            }
            Text(interaction.summary)
                .font(.blabee(size: 17, weight: .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 12) {
                ForEach(0 ..< (interaction.actionChoices.count + 1) / 2, id: \.self) { row in
                    GridRow {
                        choiceRow(interaction: interaction, choice: interaction.actionChoices[row * 2])
                        if row * 2 + 1 < interaction.actionChoices.count {
                            choiceRow(interaction: interaction, choice: interaction.actionChoices[row * 2 + 1])
                        } else {
                            Color.clear
                                .gridCellUnsizedAxes([.horizontal, .vertical])
                                .accessibilityHidden(true)
                        }
                    }
                }
            }
            .accessibilityIdentifier("air-choice-grid")
        }
    }

    private func choiceRow(interaction: PetInteraction, choice: PetChoice) -> some View {
        let context = viewModel.captureProviderActionContext()
        let accessory = viewModel.actionAccessoryPresentation(interaction: interaction, choice: choice)
        let submissionInProgress = viewModel.selectionSubmission != nil
            || viewModel.inFlightDismissalIdentity != nil
        let ownsProgress = accessory == .progress
        let enabled = choice.enabled && interaction.isSelectionReady && !submissionInProgress
            && viewModel.canRequestPanelSelection(interaction.identity)
        let previewHint = viewModel.previewShortcutHint(for: choice.slot)
        return Button {
            performProviderAction(context) {
                await viewModel.focusAndRequestPanelSelection(choice.slot, interaction: interaction.identity)
            }
        } label: {
            VStack(alignment: .leading, spacing: 16) {
                Text(choice.displayTitle)
                    .font(.blabee(size: 16, weight: .semibold))
                    .lineLimit(PetPanelContentPolicy.actionTitleLineLimit)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                if choice.slot == 1 {
                    Text(PetL10n.text("Recommended", korean: "권장"))
                        .font(.blabee(size: 12, weight: .medium))
                        .foregroundStyle(PetAirPalette.accent(for: colorScheme))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.12), lineWidth: 1))
                }
                if let reason = choice.disabledReason {
                    Text(reason)
                        .font(.blabee(size: 12))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    switch accessory {
                    case .shortcut(let label):
                        Text(label)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(Color.primary.opacity(0.055), in: Capsule())
                    case .progress:
                        ProgressView().controlSize(.small)
                            .accessibilityLabel(PetL10n.text("In progress", korean: "진행 중"))
                    case .suppressed:
                        EmptyView()
                    }
                }
                .frame(height: 26)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 150, maxHeight: .infinity, alignment: .topLeading)
            .petInsetSurface(emphasized: choice.slot == 1 && (enabled || ownsProgress))
            .contentShape(RoundedRectangle(cornerRadius: PetPanelVisualStyle.rowRadius))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled || ownsProgress ? 1 : submissionInProgress ? 0.72 : 0.52)
        .help(previewHint.isEmpty ? choice.displayTitle : "\(choice.displayTitle)\n\(previewHint)")
        .accessibilityIdentifier("air-choice-\(choice.slot)")
        .accessibilityLabel(choice.displayTitle)
        .accessibilityValue(ownsProgress ? PetL10n.text("In progress", korean: "진행 중") : "")
        .accessibilityHint(previewHint)
    }

    private func secondaryControls(interaction: PetInteraction) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { secondaryButtons(interaction: interaction) }
                .fixedSize(horizontal: true, vertical: false)
            VStack(alignment: .leading, spacing: 8) { secondaryButtons(interaction: interaction) }
        }
        .buttonStyle(PetAirButtonStyle())
        .font(.blabee(size: 11))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func secondaryButtons(interaction: PetInteraction) -> some View {
            let context = viewModel.captureProviderActionContext()
            if interaction.usesRankedNextActions {
                Button(action: viewModel.requestPanelToggle) {
                    Label(PetL10n.text("Later", korean: "나중에"), systemImage: "clock")
                }

                if viewModel.supportsDecisionDismissal {
                    Button {
                        performProviderAction(context) { await viewModel.skipDecision(for: interaction.identity) }
                    } label: {
                        Label(PetL10n.text("Skip Choices", korean: "선택 건너뛰기"), systemImage: "forward.end")
                    }
                    .disabled(!viewModel.canSkipDecision(interaction.identity))
                    .help(PetL10n.text("Dismiss these choices without running a task or sending a prompt to the conversation.", korean: "이 선택지를 닫습니다. 작업을 실행하거나 대화에 프롬프트를 보내지 않습니다."))
                    .accessibilityIdentifier("skip-current-decision")
                }
            } else if interaction.legacyPauseChoice?.enabled == true {
                Button {
                    performProviderAction(context) { await viewModel.requestLegacyPause() }
                } label: {
                    Label(PetL10n.text("Defer", korean: "보류"), systemImage: "pause.circle")
                }
            }

            if viewModel.provider == .codex {
                Button(action: {}) {
                    Label(PetL10n.text("Previous Prompt", korean: "이전 프롬프트"), systemImage: "arrow.uturn.backward")
                }
                .disabled(true)
                .help(
                    interaction.legacyRollbackChoice?.disabledReason
                        ?? PetL10n.text("Available once a safe rollback verification process is ready.", korean: "안전한 롤백 확인 절차가 준비된 뒤 사용할 수 있습니다.")
                )
            }
    }

    @ViewBuilder
    private func interactionDetails(_ interaction: PetInteraction) -> some View {
        let context = viewModel.captureProviderActionContext()
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(interaction.summary)
                    .font(.blabee(.title3, weight: .bold))
                if let outcome = interaction.outcome {
                    Text("\(outcome.status) · \(outcome.summary)")
                        .font(.blabee(.caption))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                }
                Text(PetL10n.text("Project  \(interaction.identity.binding.projectID)", korean: "프로젝트  \(interaction.identity.binding.projectID)"))
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                Text(PetL10n.text("Session  \(interaction.identity.binding.sessionID)", korean: "세션  \(interaction.identity.binding.sessionID)"))
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                Text(PetL10n.text("Path  \(interaction.cwd)", korean: "경로  \(interaction.cwd)"))
                    .font(.caption.monospaced())
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            }

            detailSection(title: PetL10n.text("Risk", korean: "위험")) {
                Text(interaction.risk.level.rawValue)
                    .font(.blabee(.callout, weight: .bold))
                if interaction.risk.reasons.isEmpty {
                    Text(PetL10n.text("No risk reason reported", korean: "보고된 위험 사유 없음"))
                        .font(.blabee(.caption))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                } else {
                    ForEach(interaction.risk.reasons, id: \.self) { reason in
                        Text("• \(reason)").font(.blabee(.caption))
                    }
                }
            }

            detailSection(title: PetL10n.text("Evidence · Checkpoints", korean: "증거 · 체크포인트")) {
                Text("\(interaction.checkpoint.coverage) · \(interaction.checkpoint.id)")
                    .font(.caption.monospaced())
                if interaction.evidence.isEmpty {
                    Text(PetL10n.text("No evidence to display.", korean: "표시할 증거가 없습니다."))
                        .font(.blabee(.caption))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                } else {
                    ForEach(interaction.evidence) { evidence in
                        Text("\(evidence.status) · \(evidence.summary)")
                            .font(.blabee(.caption))
                    }
                }
            }

            if !interaction.reportedSideEffects.isEmpty {
                detailSection(title: PetL10n.text("Reported side effects", korean: "보고된 부수 효과")) {
                    ForEach(interaction.reportedSideEffects) { effect in
                        Text("\(effect.reversibility) · \(effect.summary)")
                            .font(.blabee(.caption))
                    }
                }
            }

            if let confirmation = viewModel.riskConfirmation,
               confirmation.identity == interaction.identity
            {
                VStack(alignment: .leading, spacing: 9) {
                    Text(PetL10n.text("Review the risk", korean: "위험 확인 필요"))
                        .font(.blabee(.callout, weight: .bold))
                    Text(PetL10n.text("This confirmation only sends the next task instruction. It does not replace native permission approval in \(viewModel.provider.displayName).", korean: "이 확인은 다음 작업 지시만 보냅니다. \(viewModel.provider.displayName)의 네이티브 권한 승인을 대신하지 않습니다."))
                        .font(.blabee(.caption))
                        .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    HStack {
                        Button(PetL10n.text("Cancel", korean: "취소"), action: viewModel.cancelRiskConfirmation)
                        Button(PetL10n.text("Acknowledge Risk and Run", korean: "위험을 확인하고 실행")) {
                            performProviderAction(context) { await viewModel.confirmRiskSelection() }
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

    private var emptyState: some View {
        VStack(spacing: 24) {
            if viewModel.presentationState == .ready {
                PetAirWaitingArtwork()
                Text("Waiting")
                    .font(.blabee(size: 22, weight: .medium))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .accessibilityIdentifier("air-waiting-label")
            } else {
                if viewModel.isAppOwnedServiceEnabled,
                   viewModel.appOwnedServiceState == .starting
                    || viewModel.appOwnedServiceState == .reconnecting {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: viewModel.appOwnedServiceState == .unresponsive
                          ? "clock.arrow.circlepath" : viewModel.presentationState == .disconnected
                          ? "link" : viewModel.presentationState == .working ? "ellipsis" : "exclamationmark.circle")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(statusColor)
                        .accessibilityHidden(true)
                }
                Text(viewModel.presentationTitle)
                    .font(.blabee(size: 22, weight: .semibold))
                Text(viewModel.emptyStateDescription)
                    .font(.blabee(size: 14))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, 28)
    }

    private func detailSection<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.blabee(.caption, weight: .bold))
                .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusColor: Color {
        if viewModel.appOwnedServiceState == .unresponsive { return .orange }
        return switch viewModel.presentationState {
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
    @ObservedObject private var localization = PetLocalization.shared
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
