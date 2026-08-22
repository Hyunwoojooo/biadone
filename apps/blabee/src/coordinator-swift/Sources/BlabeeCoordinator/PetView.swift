import SwiftUI

struct PetRootView: View {
    @ObservedObject var viewModel: PetViewModel

    var body: some View {
        Group {
            if viewModel.isExpanded {
                expandedBody
            } else {
                collapsedBody
            }
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .stroke(Color.white.opacity(0.24), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.24), radius: 18, y: 8)
        .padding(8)
    }

    private var collapsedBody: some View {
        Button(action: viewModel.toggleExpanded) {
            VStack(spacing: 4) {
                Text("🐝")
                    .font(.system(size: 34))
                if !viewModel.snapshotInteractions.isEmpty {
                    Text("\(viewModel.snapshotInteractions.count)")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                } else {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Blabee Pet 열기")
    }

    private var expandedBody: some View {
        VStack(spacing: 12) {
            header
            if viewModel.isShowingOnboarding {
                ScrollView {
                    onboardingSettings
                }
            } else if viewModel.isEditingShortcuts {
                ScrollView {
                    shortcutSettings
                }
            } else {
                if viewModel.hasNewPermissionNotice {
                    permissionNotice
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        interactionPicker
                        if let interaction = viewModel.focusedInteraction {
                            interactionDetail(interaction)
                        } else if viewModel.snapshotInteractions.isEmpty {
                            emptyState
                        } else {
                            Text("카드를 눌러 전면 결정을 명시적으로 선택하세요.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .padding(.vertical, 10)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let error = viewModel.lastError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let diagnostic = viewModel.shortcutDiagnostic {
                    Text(diagnostic)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(18)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("🐝")
                .font(.title2)
            VStack(alignment: .leading, spacing: 2) {
                Text("Blabee")
                    .font(.headline)
                HStack(spacing: 6) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 7, height: 7)
                    Text(viewModel.presentationState.displayTitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if viewModel.isRecoveryCapable {
                        Text(PetPresentationState.recoveryCapable.displayTitle)
                            .font(.caption2.bold())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.green.opacity(0.16), in: Capsule())
                    }
                }
            }
            Spacer()
            Button {
                Task { await viewModel.toggleOnboarding() }
            } label: {
                Image(systemName: viewModel.isShowingOnboarding ? "shippingbox.fill" : "shippingbox")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                viewModel.isShowingOnboarding ? "프로젝트 설정 닫기" : "프로젝트 설정 열기"
            )
            Button(action: viewModel.toggleShortcutSettings) {
                Image(systemName: viewModel.isEditingShortcuts ? "gearshape.fill" : "gearshape")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                viewModel.isEditingShortcuts ? "단축키 설정 닫기" : "단축키 설정 열기"
            )
            Button(action: viewModel.toggleExpanded) {
                Image(systemName: "chevron.down")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Blabee Pet 접기")
        }
    }

    private var permissionNotice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Codex 권한 요청이 기다리고 있습니다.", systemImage: "lock.shield")
                .font(.callout.bold())
            Text("Blabee는 허용하거나 거부하지 않습니다. 응답 소유권은 Codex에 있습니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("권한 요청 화면으로 돌아가기", action: viewModel.openPermissionRequestHost)
                .buttonStyle(.bordered)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }

    private var interactionPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !viewModel.snapshotInteractions.isEmpty {
                Text("대기 카드")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }
            ForEach(viewModel.snapshotInteractions) { interaction in
                interactionPickerRow(interaction)
            }
        }
    }

    private func interactionPickerRow(_ interaction: PetInteraction) -> some View {
        let isFocused = viewModel.localForegroundIdentity == interaction.identity
        let background = isFocused
            ? Color.accentColor.opacity(0.14)
            : Color.primary.opacity(0.05)
        return Button {
            Task { await viewModel.focus(interaction.identity) }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(interaction.summary)
                        .font(.callout.bold())
                        .lineLimit(2)
                    Text(interaction.cwd)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Color.secondary)
                        .lineLimit(1)
                    Text(interaction.identity.binding.sessionID)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Color.secondary.opacity(0.75))
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if interaction.reminderDue {
                    Image(systemName: "bell.badge.fill")
                        .foregroundStyle(Color.orange)
                }
                if isFocused {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color.accentColor)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(!interaction.isSelectionReady)
    }

    @ViewBuilder
    private func interactionDetail(_ interaction: PetInteraction) -> some View {
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

            VStack(spacing: 8) {
                ForEach(interaction.choices) { choice in
                    Button {
                        Task { await viewModel.requestPanelSelection(choice.slot) }
                    } label: {
                        HStack(spacing: 10) {
                            Text(viewModel.actionShortcutLabel(
                                interaction: interaction,
                                choice: choice
                            ))
                                .font(.caption.monospaced().bold())
                                .frame(minWidth: 28)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(choice.displayTitle)
                                    .font(.callout.bold())
                                if let disabledReason = choice.disabledReason {
                                    Text(disabledReason)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .background(Color.primary.opacity(choice.enabled ? 0.07 : 0.025), in: RoundedRectangle(cornerRadius: 10))
                    .disabled(!choice.enabled || interaction.isExpired)
                    .opacity(choice.enabled ? 1 : 0.55)
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
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("프로젝트 설정")
                        .font(.headline)
                    Text("Codex 프로젝트 관찰 범위와 백그라운드 서비스 등록을 관리합니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if viewModel.isOnboardingOperationInFlight {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("백그라운드 서비스")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
                Text(viewModel.onboardingServiceState.displayTitle)
                    .font(.callout.bold())
                Text(viewModel.onboardingServiceState.displayDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                onboardingServiceActions
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    Text("관찰할 프로젝트")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("폴더 추가") {
                        Task { await viewModel.chooseAndEnableProject() }
                    }
                    .disabled(!viewModel.canMutateOnboardingProjects)
                }

                if !viewModel.configuredProjectPathsAreAuthoritative {
                    Text("프로젝트 설정을 확인할 수 없습니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if viewModel.configuredProjectPaths.isEmpty {
                    Text("설정된 프로젝트가 없습니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(viewModel.configuredProjectPaths, id: \.self) { path in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(path)
                                        .font(.caption.monospaced())
                                        .textSelection(.enabled)
                                    Text(viewModel.activeProjectPaths.contains(path)
                                         ? "현재 서비스 스냅샷에서 활성"
                                         : "설정됨 · 현재 스냅샷에는 아직 없음")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                Button("제거") {
                                    Task { await viewModel.disableConfiguredProject(path) }
                                }
                                .disabled(!viewModel.canMutateOnboardingProjects)
                            }
                        }
                        .padding(9)
                        .background(
                            Color.primary.opacity(0.04),
                            in: RoundedRectangle(cornerRadius: 9)
                        )
                    }
                }

                ForEach(viewModel.activeOnlyProjectPaths, id: \.self) { path in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(path)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                        Text("현재 서비스에서만 활성 · 재시작 후 비활성")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                    .padding(9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Color.orange.opacity(0.08),
                        in: RoundedRectangle(cornerRadius: 9)
                    )
                }

                Text("프로젝트 설정 변경은 서비스를 재시작한 후 적용됩니다.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 12))

            if let error = viewModel.onboardingError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var onboardingServiceActions: some View {
        HStack(spacing: 8) {
            switch viewModel.onboardingServiceState {
            case .notRegistered:
                Button("서비스 등록") {
                    Task { await viewModel.registerOnboardingService() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.canRegisterOnboardingService)
            case .enabled:
                Button("서비스 등록 해제") {
                    Task { await viewModel.unregisterOnboardingService() }
                }
                .disabled(!viewModel.canUnregisterOnboardingService)
            case .requiresApproval:
                Button("시스템 설정 열기") {
                    Task { await viewModel.openOnboardingSystemSettings() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.canOpenOnboardingSystemSettings)
                Button("등록 해제") {
                    Task { await viewModel.unregisterOnboardingService() }
                }
                .disabled(!viewModel.canUnregisterOnboardingService)
            case .notFound, .unknown:
                Text("이 상태에서는 등록 정보를 변경할 수 없습니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("새로고침") {
                Task { await viewModel.refreshOnboarding() }
            }
            .disabled(viewModel.isOnboardingOperationInFlight)
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
            Image(systemName: "sparkles")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(viewModel.presentationState.displayTitle)
                .font(.headline)
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
        case .reminder: .orange
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
