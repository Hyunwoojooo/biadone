import AppKit
import SwiftUI

private enum PetPalette {
    static let text = Color(red: 244 / 255, green: 247 / 255, blue: 252 / 255)
    static let secondaryText = Color(red: 149 / 255, green: 158 / 255, blue: 174 / 255)
    static let blue = Color(red: 142 / 255, green: 162 / 255, blue: 255 / 255)
    static let blueDeep = Color(red: 70 / 255, green: 85 / 255, blue: 214 / 255)
    static let coral = Color(red: 226 / 255, green: 103 / 255, blue: 69 / 255)
    static let panel = Color(red: 5 / 255, green: 8 / 255, blue: 15 / 255)
    static let list = Color(red: 29 / 255, green: 38 / 255, blue: 73 / 255)
}

struct PetSVGImage: View {
    let asset: PetAsset
    let catalog: PetAssetCatalog

    var body: some View {
        Group {
            if let image = catalog.image(for: asset) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
            } else {
                Color.clear
            }
        }
        .accessibilityHidden(true)
    }
}

struct PetStatusItemView: View {
    @ObservedObject var viewModel: PetViewModel
    let assets: PetAssetCatalog

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            PetSVGImage(asset: .bee, catalog: assets)
                .frame(width: 27.711, height: 24)
                .offset(x: 2, y: 4)
            if needsInput {
                PetSVGImage(asset: .needsInput, catalog: assets)
                    .frame(width: 7, height: 7)
                    .offset(x: 23, y: 4)
            } else if viewModel.presentationState == .working {
                PetSVGImage(asset: .working, catalog: assets)
                    .frame(width: 7, height: 7)
                    .offset(x: 23, y: 4)
            }
        }
        .frame(width: 32, height: 32)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Blabee, \(viewModel.presentationState.displayTitle)")
    }

    private var needsInput: Bool {
        viewModel.snapshotInteractions.contains(where: \.isSelectionReady)
            || viewModel.riskConfirmation != nil
    }
}

private struct PetGlassEffectView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

private struct PetPanelShape: Shape {
    func path(in rect: CGRect) -> Path {
        let topRadius: CGFloat = 0
        let bottomRadius: CGFloat = 18
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY + topRadius))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + topRadius, y: rect.minY),
            control: CGPoint(x: rect.minX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX - topRadius, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY + topRadius),
            control: CGPoint(x: rect.maxX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomRadius))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - bottomRadius, y: rect.maxY),
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.minX + bottomRadius, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - bottomRadius),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        path.closeSubpath()
        return path
    }
}

struct PetRootView: View {
    @ObservedObject var viewModel: PetViewModel
    let assets: PetAssetCatalog

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        ZStack {
            if !reduceTransparency {
                PetGlassEffectView()
            }
            PetPalette.panel.opacity(reduceTransparency ? 1 : 0.60)
            LinearGradient(
                colors: [
                    Color.white.opacity(reduceTransparency ? 0 : 0.078),
                    PetPalette.blueDeep.opacity(reduceTransparency ? 0 : 0.024),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            VStack(spacing: 0) {
                header
                    .frame(height: 48)
                panelContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if !usesReferenceDecisionLayout {
                    utilityBar
                        .frame(height: 28)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
        }
        .frame(width: 420, height: 346)
        .foregroundStyle(PetPalette.text)
        .clipShape(PetPanelShape())
        .overlay(
            PetPanelShape()
                .stroke(Color.white.opacity(0.34), lineWidth: 1)
        )
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(0.20))
                .frame(height: 1)
                .padding(.horizontal, 2)
        }
        .shadow(color: .black.opacity(0.62), radius: 27, y: 10)
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Blabee 결정 패널")
    }

    private var header: some View {
        HStack(spacing: 10) {
            if usesReferenceDecisionLayout {
                Text(headerTitle)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .lineLimit(1)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    Text(headerTitle)
                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                        .lineLimit(1)
                    Text(viewModel.presentationState.displayTitle)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(PetPalette.secondaryText)
                }
            }
            Spacer(minLength: 8)
            if viewModel.focusedInteraction != nil,
               !viewModel.isShowingOnboarding,
               !viewModel.isEditingShortcuts
            {
                Button(
                    viewModel.isShowingDecisionDetails ? "Back  ←" : "View details  →",
                    action: viewModel.toggleDecisionDetails
                )
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PetPalette.blue)
                .accessibilityLabel(
                    viewModel.isShowingDecisionDetails ? "결정 상세 닫기" : "결정 상세 보기"
                )
            }
        }
        .padding(.horizontal, 6)
    }

    @ViewBuilder
    private var panelContent: some View {
        if viewModel.isShowingOnboarding {
            onboardingSettings
        } else if viewModel.isEditingShortcuts {
            shortcutSettings
        } else if let confirmation = viewModel.riskConfirmation,
                  let interaction = viewModel.focusedInteraction,
                  confirmation.identity == interaction.identity
        {
            riskConfirmation(interaction: interaction, confirmation: confirmation)
        } else if viewModel.isShowingDecisionDetails,
                  let interaction = viewModel.focusedInteraction
        {
            decisionDetails(interaction)
        } else if let interaction = viewModel.focusedInteraction {
            choiceList(interaction)
        } else if !viewModel.snapshotInteractions.isEmpty {
            interactionList
        } else {
            emptyState
        }
    }

    private var headerTitle: String {
        if viewModel.isShowingOnboarding { return "Project setup" }
        if viewModel.isEditingShortcuts { return "Keyboard shortcuts" }
        if let interaction = viewModel.focusedInteraction ?? viewModel.snapshotInteractions.first {
            let name = URL(fileURLWithPath: interaction.cwd, isDirectory: true).lastPathComponent
            return name.isEmpty ? interaction.identity.binding.projectID : name
        }
        return "Blabee"
    }

    private var usesReferenceDecisionLayout: Bool {
        viewModel.focusedInteraction != nil
            && !viewModel.isShowingOnboarding
            && !viewModel.isEditingShortcuts
            && !viewModel.isShowingDecisionDetails
            && viewModel.riskConfirmation == nil
    }

    private func choiceList(_ interaction: PetInteraction) -> some View {
        VStack(spacing: 5) {
            ForEach(interaction.choices) { choice in
                choiceRow(interaction: interaction, choice: choice)
            }
        }
        .background(PetPalette.list.opacity(0.62))
        .overlay(
            Rectangle()
                .stroke(PetPalette.blue.opacity(0.42), lineWidth: 1)
        )
        .frame(maxHeight: .infinity, alignment: .top)
    }

    private func choiceRow(interaction: PetInteraction, choice: PetChoice) -> some View {
        Button {
            Task { await viewModel.requestPanelSelection(choice.slot) }
        } label: {
            HStack(spacing: 10) {
                PetSVGImage(asset: .action(slot: choice.slot), catalog: assets)
                    .frame(width: 28, height: 28)
                Text(choice.displayTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if choice.slot == 1 {
                    Text("Recommended")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 7)
                        .frame(height: 22)
                        .background(PetPalette.blueDeep.opacity(0.72))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                shortcutChip(
                    viewModel.actionShortcutLabel(interaction: interaction, choice: choice)
                )
            }
            .padding(.horizontal, 10)
            .frame(height: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(PetActionButtonStyle(recommended: choice.slot == 1))
        .disabled(!choice.enabled || interaction.isExpired)
        .opacity(choice.enabled && !interaction.isExpired ? 1 : 0.55)
        .accessibilityLabel(choice.displayTitle)
        .accessibilityValue(
            choice.enabled ? viewModel.actionShortcutLabel(interaction: interaction, choice: choice)
                : (choice.disabledReason ?? "사용 불가")
        )
    }

    private func shortcutChip(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundStyle(PetPalette.text.opacity(0.74))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(minWidth: 28)
            .frame(height: 22)
            .background(Color.black.opacity(0.58))
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(PetPalette.text.opacity(0.14), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private var interactionList: some View {
        ScrollView {
            LazyVStack(spacing: 5) {
                ForEach(viewModel.snapshotInteractions) { interaction in
                    Button {
                        Task { await viewModel.focus(interaction.identity) }
                    } label: {
                        HStack(spacing: 10) {
                            PetSVGImage(asset: .bee, catalog: assets)
                                .frame(width: 28, height: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(interaction.summary)
                                    .font(.system(size: 13, weight: .semibold))
                                    .lineLimit(1)
                                Text(URL(fileURLWithPath: interaction.cwd).lastPathComponent)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(PetPalette.secondaryText)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Text(interaction.reminderDue ? "Reminder" : "Focus")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(
                                    interaction.reminderDue ? PetPalette.coral : PetPalette.blue
                                )
                        }
                        .padding(.horizontal, 10)
                        .frame(height: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PetActionButtonStyle(recommended: false))
                    .disabled(!interaction.isSelectionReady)
                    .opacity(interaction.isSelectionReady ? 1 : 0.55)
                    .accessibilityLabel("\(interaction.summary) 세션에 포커스")
                }
            }
            .padding(1)
        }
        .background(PetPalette.list.opacity(0.62))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(PetPalette.blue.opacity(0.42), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func riskConfirmation(
        interaction: PetInteraction,
        confirmation: PetRiskConfirmation
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                PetSVGImage(asset: .action(slot: confirmation.slot), catalog: assets)
                    .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text("위험 확인 필요")
                        .font(.system(size: 14, weight: .bold))
                    Text(interaction.choice(slot: confirmation.slot)?.displayTitle ?? "선택")
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                }
            }
            Text("이 확인은 다음 작업 지시만 보냅니다. Codex의 네이티브 권한 승인을 대신하지 않습니다.")
                .font(.system(size: 11))
                .foregroundStyle(PetPalette.secondaryText)
            if !interaction.risk.reasons.isEmpty {
                Text(interaction.risk.reasons.joined(separator: " · "))
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(PetPalette.coral)
                    .lineLimit(2)
            }
            Spacer()
            HStack {
                Button("취소", action: viewModel.cancelRiskConfirmation)
                Spacer()
                Button("위험을 확인하고 실행") {
                    Task { await viewModel.confirmRiskSelection() }
                }
                .buttonStyle(.borderedProminent)
                .tint(PetPalette.blueDeep)
            }
        }
        .padding(14)
        .background(Color.red.opacity(0.10))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(PetPalette.coral.opacity(0.42), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func decisionDetails(_ interaction: PetInteraction) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 11) {
                detailSection("Outcome") {
                    Text(interaction.outcome.map { "\($0.status) · \($0.summary)" }
                         ?? interaction.summary)
                }
                detailSection("Risk") {
                    Text(interaction.risk.level.rawValue.uppercased())
                    if !interaction.risk.reasons.isEmpty {
                        Text(interaction.risk.reasons.joined(separator: " · "))
                    }
                }
                detailSection("Evidence · checkpoint") {
                    Text("\(interaction.checkpoint.coverage) · \(interaction.checkpoint.id)")
                    ForEach(interaction.evidence) { evidence in
                        Text("\(evidence.status) · \(evidence.summary)")
                    }
                }
                if !interaction.reportedSideEffects.isEmpty {
                    detailSection("Reported side effects") {
                        ForEach(interaction.reportedSideEffects) { effect in
                            Text("\(effect.reversibility) · \(effect.summary)")
                        }
                    }
                }
                detailSection("Same-session binding") {
                    Text("project  \(interaction.identity.binding.projectID)")
                    Text("session  \(interaction.identity.binding.sessionID)")
                    Text("path  \(interaction.cwd)")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
        }
        .background(Color.white.opacity(0.045))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func detailSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(PetPalette.blue)
            content()
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(PetPalette.secondaryText)
                .textSelection(.enabled)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            PetSVGImage(asset: .bee, catalog: assets)
                .frame(width: 28, height: 24)
            Text(viewModel.presentationState.displayTitle)
                .font(.system(size: 14, weight: .semibold))
            Text(viewModel.lastError ?? "새 결정이 도착하면 자동으로 열립니다.")
                .font(.system(size: 11))
                .foregroundStyle(viewModel.lastError == nil ? PetPalette.secondaryText : PetPalette.coral)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var utilityBar: some View {
        HStack(spacing: 12) {
            if viewModel.hasNewPermissionNotice {
                Button("Permission", action: viewModel.openPermissionRequestHost)
                    .foregroundStyle(PetPalette.coral)
            }
            if viewModel.shortcutDiagnostic != nil {
                Text("Shortcut issue")
                    .foregroundStyle(PetPalette.coral)
                    .accessibilityLabel(viewModel.shortcutDiagnostic ?? "")
            }
            Spacer(minLength: 4)
            Button(viewModel.isShowingOnboarding ? "Back" : "Projects") {
                Task { await viewModel.toggleOnboarding() }
            }
            Button(viewModel.isEditingShortcuts ? "Back" : "Shortcuts") {
                viewModel.toggleShortcutSettings()
            }
            Button("Close") { viewModel.setExpanded(false) }
        }
        .buttonStyle(.plain)
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(PetPalette.blue)
        .padding(.horizontal, 4)
    }

    private var shortcutSettings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 9) {
                Text("Option을 포함한 조합만 사용하며, Option 단독은 숫자와 Space에만 쓸 수 있습니다.")
                    .font(.system(size: 10))
                    .foregroundStyle(PetPalette.secondaryText)
                ForEach(PetShortcutIntent.allCases, id: \.self) { intent in
                    shortcutSettingRow(intent)
                }
                if let error = viewModel.shortcutSettingsError {
                    Text(error)
                        .font(.system(size: 10))
                        .foregroundStyle(PetPalette.coral)
                }
                HStack {
                    Button("기본값", action: viewModel.restoreDefaultShortcutDraft)
                    Spacer()
                    Button("취소", action: viewModel.cancelShortcutSettings)
                    Button("저장", action: viewModel.saveShortcutSettings)
                        .buttonStyle(.borderedProminent)
                        .tint(PetPalette.blueDeep)
                        .disabled(!viewModel.canSaveShortcutSettings)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func shortcutSettingRow(_ intent: PetShortcutIntent) -> some View {
        let draft = viewModel.shortcutDraft.shortcut(for: intent)
        return HStack(spacing: 8) {
            Text(intent.displayName)
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 92, alignment: .leading)
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
            Spacer(minLength: 3)
            Text(PetShortcutCatalog.displayLabel(for: draft))
                .font(.system(size: 10, weight: .bold, design: .monospaced))
        }
        .padding(.vertical, 2)
    }

    private var onboardingSettings: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Background service")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(PetPalette.blue)
                    Text(viewModel.onboardingServiceState.displayTitle)
                        .font(.system(size: 12, weight: .semibold))
                    Text(viewModel.onboardingServiceState.displayDescription)
                        .font(.system(size: 10))
                        .foregroundStyle(PetPalette.secondaryText)
                    onboardingServiceActions
                }
                .padding(10)
                .background(Color.white.opacity(0.045))
                .clipShape(RoundedRectangle(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 7) {
                    HStack {
                        Text("Observed projects")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(PetPalette.blue)
                        Spacer()
                        Button("폴더 추가") {
                            Task { await viewModel.chooseAndEnableProject() }
                        }
                        .disabled(!viewModel.canMutateOnboardingProjects)
                    }
                    if !viewModel.configuredProjectPathsAreAuthoritative {
                        Text("프로젝트 설정을 확인할 수 없습니다.")
                    } else if viewModel.configuredProjectPaths.isEmpty {
                        Text("설정된 프로젝트가 없습니다.")
                    } else {
                        ForEach(viewModel.configuredProjectPaths, id: \.self) { path in
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(path)
                                        .font(.system(size: 9, design: .monospaced))
                                        .textSelection(.enabled)
                                    Text(viewModel.activeProjectPaths.contains(path)
                                         ? "현재 서비스 스냅샷에서 활성"
                                         : "설정됨 · 재시작 후 적용")
                                        .font(.system(size: 9))
                                        .foregroundStyle(PetPalette.secondaryText)
                                }
                                Spacer()
                                Button("제거") {
                                    Task { await viewModel.disableConfiguredProject(path) }
                                }
                                .disabled(!viewModel.canMutateOnboardingProjects)
                            }
                        }
                    }
                    ForEach(viewModel.activeOnlyProjectPaths, id: \.self) { path in
                        Text("\(path) · 현재 서비스에서만 활성")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(PetPalette.coral)
                    }
                }
                .font(.system(size: 10))
                .padding(10)
                .background(Color.white.opacity(0.045))
                .clipShape(RoundedRectangle(cornerRadius: 10))

                if let error = viewModel.onboardingError {
                    Text(error)
                        .font(.system(size: 9))
                        .foregroundStyle(PetPalette.coral)
                        .textSelection(.enabled)
                }
            }
            .padding(.horizontal, 4)
        }
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
                .tint(PetPalette.blueDeep)
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
                .tint(PetPalette.blueDeep)
                .disabled(!viewModel.canOpenOnboardingSystemSettings)
                Button("등록 해제") {
                    Task { await viewModel.unregisterOnboardingService() }
                }
                .disabled(!viewModel.canUnregisterOnboardingService)
            case .notFound, .unknown:
                Text("이 상태에서는 등록 정보를 변경할 수 없습니다.")
                    .font(.system(size: 9))
                    .foregroundStyle(PetPalette.secondaryText)
            }
            Spacer()
            if viewModel.isOnboardingOperationInFlight {
                ProgressView().controlSize(.small)
            } else {
                Button("새로고침") {
                    Task { await viewModel.refreshOnboarding() }
                }
            }
        }
    }
}

private struct PetActionButtonStyle: ButtonStyle {
    let recommended: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                configuration.isPressed
                    ? PetPalette.blueDeep.opacity(0.30)
                    : (recommended
                        ? PetPalette.blueDeep.opacity(0.14)
                        : Color.white.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(
                        recommended
                            ? PetPalette.blue.opacity(0.38)
                            : Color.white.opacity(0.15),
                        lineWidth: 1
                    )
            )
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.white.opacity(recommended ? 0.24 : 0.13))
                    .frame(height: 1)
                    .padding(.horizontal, 2)
            }
            .clipShape(RoundedRectangle(cornerRadius: 9))
    }
}

extension PetViewModel {
    var snapshotInteractions: [PetInteraction] { snapshot?.interactions ?? [] }
}
