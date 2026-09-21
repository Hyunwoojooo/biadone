import SwiftUI

/// The example cannot reach any production transport or selection callback.
struct PetFirstRunTutorialExampleState: Equatable {
    private(set) var selected: Int?
    private(set) var delivered = false

    mutating func select(_ index: Int) {
        guard !delivered, (0..<2).contains(index) else { return }
        selected = index
    }

    mutating func deliver() {
        guard selected != nil, !delivered else { return }
        delivered = true
    }
}

@MainActor
struct PetFirstRunView: View {
    @ObservedObject var controller: PetFirstRunController
    @ObservedObject var viewModel: PetViewModel
    @ObservedObject var preferences: PetFirstRunPreferences
    let onFinish: (_ connectionDeferred: Bool) -> Void
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var example = PetFirstRunTutorialExampleState()
    @State private var document: FirstRunDocument?
    @State private var shortcutSaved = false

    private var secondary: Color { PetAirPalette.secondary(for: colorScheme) }
    private var busy: Bool { viewModel.isOnboardingOperationInFlight }
    private var setupReady: Bool {
        viewModel.isConnectionSetupReady
    }

    var body: some View {
        VStack(spacing: 0) {
            chrome
            stepIndicator.padding(.horizontal, 24)
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        stage.id("first-run-top")
                    }
                    .padding(26)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: controller.step) { _ in scroll.scrollTo("first-run-top", anchor: .top) }
                .onChange(of: controller.tutorialIndex) { _ in
                    example = PetFirstRunTutorialExampleState()
                    scroll.scrollTo("first-run-top", anchor: .top)
                }
            }
            footer
        }
        .foregroundStyle(PetAirPalette.ink(for: colorScheme))
        .modifier(PetPanelSurfaceModifier())
        .clipShape(RoundedRectangle(cornerRadius: PetPanelVisualStyle.cornerRadius, style: .continuous))
        .sheet(item: $document) { document in
            FirstRunDocumentView(document: document)
        }
        .accessibilityIdentifier("first-run-window")
        .task(id: controller.step) {
            if controller.step == .setup {
                viewModel.beginShortcutSettings()
                preferences.reloadLaunchAtLoginStatus()
                await viewModel.refreshFirstRunSetup()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(2)) } catch { return }
                    guard !Task.isCancelled else { return }
                    await viewModel.refreshFirstRunSetup(inspectSettings: false)
                }
            }
        }
    }

    private var chrome: some View {
        HStack(spacing: 9) {
            PetAirBeeMark().frame(width: 26, height: 26).accessibilityHidden(true)
            Text("Blabee").font(.system(size: 18, weight: .semibold))
            Spacer()
            Button(action: onClose) { Image(systemName: "xmark").frame(width: 18, height: 18) }
                .buttonStyle(PetAirButtonStyle())
                .accessibilityLabel("초기 설정 닫기")
                .accessibilityHint("완료한 단계는 저장되며 다음 실행 때 이어갑니다.")
                .accessibilityIdentifier("first-run-close")
        }
        .padding(.horizontal, 26)
        .padding(.top, 24)
        .padding(.bottom, 18)
    }

    private var stepIndicator: some View {
        HStack(spacing: 2) {
            ForEach(Array(["사용법", "로그인", "약관", "설정"].enumerated()), id: \.offset) { index, title in
                HStack(spacing: 6) {
                    Text(index < stepNumber ? "✓" : "\(index + 1)")
                        .font(.system(size: 11, weight: .medium))
                        .frame(width: 20, height: 20)
                        .overlay(Circle().strokeBorder(secondary.opacity(0.4)))
                    Text(title).font(.system(size: 13, weight: index == stepNumber ? .semibold : .regular))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background {
                    if index == stepNumber {
                        Capsule().fill(PetAirPalette.reading(for: colorScheme, emphasized: true))
                            .overlay(Capsule().strokeBorder(PetAirPalette.edge(for: colorScheme)))
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(index + 1)단계 \(title)")
                .accessibilityValue(index == stepNumber ? "현재 단계" : index < stepNumber ? "완료" : "다음 단계")
            }
        }
        .padding(4)
        .petInsetSurface(cornerRadius: 999)
        .accessibilityIdentifier("first-run-steps")
    }

    private var stepNumber: Int {
        switch controller.step {
        case .tutorial: 0
        case .signIn: 1
        case .terms: 2
        case .setup: 3
        }
    }

    @ViewBuilder private var stage: some View {
        switch controller.step {
        case .tutorial: tutorial
        case .signIn: login
        case .terms: terms
        case .setup: setup
        }
    }

    private var tutorial: some View {
        VStack(spacing: 18) {
            let index = controller.tutorialIndex
            heading(
                ["Codex의 다음 질문을,\nBlabee에서.", "카드를 고르고,\n선택을 전달하세요.", "원래 대화에서\n계속 이어집니다."][index],
                ["작업 중 도착한 선택지를 확인하고\n고른 답을 원래 대화로 전달하세요.",
                 "내용을 확인한 뒤 원하는 카드를 고르세요.\n실제 선택지는 클릭이나 설정한 단축키로 전달합니다.",
                 "선택한 답이 같은 Codex 대화로 돌아가요.\n이제 Blabee를 사용할 준비를 해볼까요?"][index], centered: true
            )
            PetFirstRunTutorialCard(scene: index, example: $example)
            HStack(spacing: 6) {
                ForEach(0..<3) { number in
                    Capsule().fill(secondary.opacity(number == index ? 0.9 : 0.3))
                        .frame(width: number == index ? 20 : 6, height: 6)
                }
            }.accessibilityLabel("사용법 장면 \(index + 1) / 3")
            Text("체험 예시입니다. 실제 작업이나 Codex 명령은 실행하지 않습니다.")
                .font(.caption).foregroundStyle(secondary)
                .multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity)
    }

    private var login: some View {
        VStack(spacing: 22) {
            heading("Blabee에 로그인하세요", "사용할 계정을 선택하세요.", centered: true)
            PetAirBeeMark().frame(width: 46, height: 46).padding(22)
                .petInsetSurface(emphasized: true, cornerRadius: 28)
                .accessibilityHidden(true)
            if let account = viewModel.account {
                PetFirstRunAccountView(controller: account)
            } else {
                Text("계정 서비스를 준비하지 못했습니다. 앱을 다시 실행해 주세요.")
                    .foregroundStyle(.red)
            }
            Text("로그인만으로 사용 통계나 오류 진단에 동의하지 않습니다.")
                .font(.caption).foregroundStyle(secondary).multilineTextAlignment(.center)
            legalLinks
        }.frame(maxWidth: .infinity)
    }

    private var terms: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("이용 전에 확인해 주세요", "선택 항목에 동의하지 않아도 Blabee를 사용할 수 있어요.")
            HStack(spacing: 10) {
                Image(systemName: "person.crop.circle").font(.title2)
                Text(controller.accountEmail ?? "로그인된 계정")
                    .font(.callout).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button("계정 변경") {
                    if let account = viewModel.account { Task { await account.signOut() } }
                }.buttonStyle(PetAirButtonStyle())
                    .accessibilityIdentifier("first-run-change-account")
            }.padding(14).petInsetSurface()
            if controller.legalDocuments?.isPlaceholder == true {
                Label("임시 약관 · 추후 교체 예정", systemImage: "doc.text")
                    .font(.caption).foregroundStyle(secondary)
            }
            VStack(alignment: .leading, spacing: 12) {
                Toggle("[필수] 서비스 이용약관에 동의합니다", isOn: $controller.acceptsTerms)
                    .toggleStyle(.checkbox)
                    .accessibilityIdentifier("first-run-terms-consent")
                legalLinks
            }.padding(18).petInsetSurface()
            Text("더 나은 사용 경험을 위한 선택").font(.caption).foregroundStyle(secondary)
            VStack(alignment: .leading, spacing: 16) {
                consentToggle("사용 통계 보내기", detail: "사용 횟수, 기능 반응, 앱 버전 등. 질문·답변 원문은 포함하지 않습니다.",
                              value: $controller.usageStatisticsEnabled, identifier: "first-run-usage-consent")
                Divider()
                consentToggle("오류 진단 보내기", detail: "오류 종류와 발생 시각, 버전. 전체 로그나 대화 원문을 자동 첨부하지 않습니다.",
                              value: $controller.errorDiagnosticsEnabled, identifier: "first-run-diagnostics-consent")
            }.padding(18).petInsetSurface()
            Text("두 항목은 각각 선택할 수 있으며 기본값은 꺼짐입니다. 설정에서 언제든 변경할 수 있어요.")
                .font(.caption).foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true)
            if controller.legalDocuments == nil {
                Text("약관 문서를 준비하지 못했습니다. 앱의 약관 구성을 확인해 주세요.")
                    .font(.caption).foregroundStyle(.red)
            }
        }
    }

    private var legalLinks: some View {
        HStack(spacing: 14) {
            Button("서비스 이용약관") { showLegal(privacy: false) }
                .accessibilityIdentifier("first-run-open-terms")
            Button("개인정보 안내") { showLegal(privacy: true) }
                .accessibilityIdentifier("first-run-open-privacy")
        }
        .buttonStyle(.link)
        .font(.caption)
        .disabled(controller.legalDocuments == nil)
    }

    private func showLegal(privacy: Bool) {
        guard let legal = controller.legalDocuments else { return }
        document = FirstRunDocument(
            title: privacy ? "개인정보 안내" : "서비스 이용약관",
            text: privacy ? legal.privacyText : legal.termsText,
            url: privacy ? legal.privacyURL : legal.termsURL,
            isPlaceholder: legal.isPlaceholder
        )
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading("Blabee를 사용할 준비", "연결을 확인하고 편한 방식으로 설정하세요.")
            connectionSetup
            VStack(alignment: .leading, spacing: 8) {
                Label("Claude Code 연결", systemImage: "link").font(.headline)
                Text("Claude만 사용한다면 Codex Plugin과 프로젝트 등록 없이 ‘연결은 나중에’로 계속할 수 있습니다. 설정의 연결 탭에서 앱 실행형 서비스와 Claude 터미널 자동 연결을 켜세요. 새 터미널에서 claude 또는 claude --resume으로 연결할 수 있습니다.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                Text("Codex와 Claude를 함께 사용할 때도 Blabee 앱 하나에서 세션을 선택합니다.")
                    .font(.caption).foregroundStyle(secondary)
            }.padding(18).petInsetSurface()
            shortcutSetup
            VStack(alignment: .leading, spacing: 16) {
                Picker("화면 모드", selection: Binding(get: { preferences.theme }, set: preferences.setTheme)) {
                    ForEach(PetFirstRunTheme.allCases) { Text($0.title).tag($0) }
                }.accessibilityIdentifier("first-run-theme")
                Divider()
                Toggle("Mac 로그인 시 실행", isOn: Binding(
                    get: { preferences.launchAtLoginEnabled }, set: preferences.setLaunchAtLogin
                )).toggleStyle(.switch).accessibilityIdentifier("first-run-launch-at-login")
                Text(preferences.launchAtLoginStatus.title).font(.caption).foregroundStyle(secondary)
                if preferences.launchAtLoginStatus == .requiresApproval {
                    Button("시스템 설정에서 허용", action: preferences.openLoginItemsSettings)
                        .buttonStyle(PetAirButtonStyle())
                }
                if let error = preferences.launchAtLoginError {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }.padding(18).petInsetSurface().disabled(busy)
            Label("메뉴바의 벌 아이콘 또는 \(viewModel.shortcutLabel(for: .toggle))로 패널을 여세요.", systemImage: "menubar.arrow.up.rectangle")
                .font(.caption).foregroundStyle(secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var connectionSetup: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Codex 연결", systemImage: "link").font(.headline)
            Text(viewModel.connectionReadiness.title).font(.callout.bold())
            ForEach(viewModel.connectionReadiness.checks) { check in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: check.state == .confirmed ? "checkmark.circle" : "circle")
                        .foregroundStyle(check.state == .confirmed ? .green : secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(check.title).font(.callout)
                        Text(check.detail).font(.caption).foregroundStyle(secondary)
                    }
                }.fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                if viewModel.isAppOwnedServiceAvailable {
                    Button(viewModel.isAppOwnedServiceEnabled ? "서비스 다시 시작" : "서비스 시작") {
                        Task {
                            if viewModel.isAppOwnedServiceEnabled { await viewModel.restartAppOwnedService() }
                            else { await viewModel.enableAppOwnedService() }
                        }
                    }.disabled(!viewModel.canChangeAppOwnedService)
                } else {
                    Button("서비스 등록") { Task { await viewModel.registerOnboardingService() } }
                        .disabled(!viewModel.canRegisterOnboardingService)
                }
                Button("상태 다시 확인") { Task { await viewModel.refreshFirstRunSetup() } }
                    .accessibilityIdentifier("first-run-refresh-connection")
            }
            HStack {
                Button("Codex Plugin 연결") { Task { await viewModel.connectCodexPlugin() } }
                    .disabled(!viewModel.canConnectCodexPlugin)
                    .accessibilityIdentifier("first-run-connect-plugin")
                Button("프로젝트 추가") { Task { await viewModel.chooseAndEnableProject() } }
                    .disabled(!viewModel.canMutateOnboardingProjects)
                    .accessibilityIdentifier("first-run-add-project")
            }
            if viewModel.canOpenOnboardingSystemSettings {
                Button("시스템 설정에서 서비스 허용") { Task { await viewModel.openOnboardingSystemSettings() } }
            }
            if case .installedNeedsHookReview = viewModel.codexPluginSetupState {
                PetHookReadinessView(viewModel: viewModel)
            }
            if viewModel.isAppOwnedServiceAvailable {
                DisclosureGroup("저장소 복구") {
                    PetStorageRecoveryView(viewModel: viewModel).padding(.top, 8)
                }
            }
            Text("Codex에서 /hooks를 확인한 뒤 등록한 프로젝트에서 새 요청을 보내세요. 설치 완료만으로 실제 전달을 확인한 것은 아닙니다.")
                .font(.caption).foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true)
            if let error = viewModel.onboardingError {
                Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
            }
        }
        .buttonStyle(PetAirButtonStyle())
        .padding(18).petInsetSurface()
        .disabled(busy)
        .accessibilityIdentifier("first-run-connection")
    }

    private var shortcutSetup: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("패널 열기 단축키").font(.callout.bold())
                Spacer()
                Text(viewModel.shortcutLabel(for: .toggle)).font(.callout.monospaced())
            }
            HStack {
                Picker("보조키", selection: Binding(
                    get: { viewModel.shortcutDraft.shortcut(for: .toggle).modifiers },
                    set: { viewModel.updateShortcutDraft(intent: .toggle, modifiers: $0); shortcutSaved = false }
                )) {
                    ForEach(PetShortcutCatalog.modifierPresets) { Text($0.displayLabel).tag($0.modifiers) }
                }
                Picker("키", selection: Binding(
                    get: { viewModel.shortcutDraft.shortcut(for: .toggle).keyCode },
                    set: { viewModel.updateShortcutDraft(intent: .toggle, keyCode: $0); shortcutSaved = false }
                )) {
                    ForEach(PetShortcutCatalog.keys) { Text($0.displayLabel).tag($0.keyCode) }
                }
            }.accessibilityIdentifier("first-run-shortcut-draft")
            HStack {
                Button("기본값") {
                    let shortcut = PetShortcutConfiguration.defaults.shortcut(for: .toggle)
                    viewModel.updateShortcutDraft(intent: .toggle, keyCode: shortcut.keyCode, modifiers: shortcut.modifiers)
                    shortcutSaved = false
                }
                Button("단축키 저장") {
                    viewModel.saveShortcutSettings()
                    shortcutSaved = viewModel.shortcutSettingsError == nil
                }.accessibilityIdentifier("first-run-save-shortcut")
                if shortcutSaved { Text("저장됨").font(.caption).foregroundStyle(secondary) }
            }.buttonStyle(PetAirButtonStyle())
            if let error = viewModel.shortcutSettingsError {
                Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(18).petInsetSurface().disabled(busy)
    }

    private var footer: some View {
        VStack(spacing: 10) {
            Divider()
            HStack(spacing: 18) {
                if controller.step != .tutorial || controller.tutorialIndex > 0 {
                    Button { controller.back() } label: { Label("이전", systemImage: "chevron.left") }
                        .buttonStyle(.plain).disabled(busy || !controller.isStorageLoaded)
                        .accessibilityIdentifier("first-run-back")
                }
                Button(action: advance) {
                    HStack {
                        Image(systemName: "return")
                        Spacer()
                        Text(continueTitle).fontWeight(.semibold)
                        Spacer()
                        Image(systemName: "arrow.right")
                    }.padding(.vertical, 5)
                }
                .buttonStyle(PetAirButtonStyle(emphasized: true))
                .disabled(!canContinue || busy)
                .accessibilityIdentifier("first-run-continue")
            }
            if controller.step == .tutorial {
                Button("소개 건너뛰기", action: controller.skipTutorial)
                    .buttonStyle(.link).font(.caption).disabled(!controller.isStorageLoaded)
                    .accessibilityIdentifier("first-run-skip-tutorial")
            } else if controller.step == .setup {
                Button("연결은 나중에") { onFinish(true) }
                    .buttonStyle(.link).font(.caption)
                    .disabled(!canDeferConnection)
                    .accessibilityIdentifier("first-run-defer-connection")
            }
            if (controller.step == .setup || controller.step == .terms), controller.accountID == nil {
                ProgressView("로그인 상태 확인 중…").controlSize(.small)
                    .accessibilityIdentifier("first-run-verifying-account")
            }
            if !controller.errorMessage.isEmpty {
                Text(controller.errorMessage).font(.caption).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("first-run-error")
            }
            if controller.canRetryLoading {
                Button("다시 시도", action: controller.retryLoading)
                    .buttonStyle(PetAirButtonStyle())
                    .accessibilityIdentifier("first-run-retry-loading")
            }
        }.padding(.horizontal, 24).padding(.bottom, 21)
    }

    var canDeferConnection: Bool {
        controller.step == .setup && !busy && controller.accountID != nil && controller.isStorageLoaded
    }

    var canContinue: Bool {
        switch controller.step {
        case .tutorial: controller.isStorageLoaded
        case .signIn: controller.canContinueAfterSignIn
        case .terms: controller.canAcceptTerms
        case .setup: setupReady && controller.accountID != nil && controller.isStorageLoaded
        }
    }

    private var continueTitle: String {
        switch controller.step {
        case .tutorial: controller.tutorialIndex == 2 ? "로그인으로 계속" : "다음"
        case .signIn: "약관 확인하기"
        case .terms: "동의하고 계속"
        case .setup: "Blabee 시작하기"
        }
    }

    private func advance() {
        switch controller.step {
        case .tutorial: controller.advanceTutorial()
        case .signIn: _ = controller.continueAfterSignIn()
        case .terms: _ = controller.acceptTerms()
        case .setup: onFinish(false)
        }
    }

    private func heading(_ title: String, _ subtitle: String, centered: Bool = false) -> some View {
        VStack(alignment: centered ? .center : .leading, spacing: 8) {
            Text(title).font(.system(size: 24, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
            Text(subtitle).font(.system(size: 14)).foregroundStyle(secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .multilineTextAlignment(centered ? .center : .leading)
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }

    private func consentToggle(_ title: String, detail: String, value: Binding<Bool>, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle("[선택] \(title)", isOn: value).toggleStyle(.checkbox).accessibilityIdentifier(identifier)
            Text(detail).font(.caption).foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct PetFirstRunTutorialCard: View {
    let scene: Int
    @Binding var example: PetFirstRunTutorialExampleState
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack {
                PetAirBeeMark().frame(width: 22, height: 22)
                Text("Blabee").font(.callout.bold())
                Spacer()
                Text("체험 예시").font(.caption).foregroundStyle(.secondary)
            }
            Text(scene == 2 || example.delivered ? "선택을 받았어요" : "다음으로 무엇을 할까요?")
                .font(.headline)
            if scene == 2 || example.delivered {
                VStack(spacing: 14) {
                    Image(systemName: "checkmark.circle").font(.system(size: 48, weight: .ultraLight))
                    Text("예시 대화에 선택이 전달됐어요.").font(.callout)
                }.frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                HStack(spacing: 12) {
                    ForEach(0..<2) { index in
                        Button { example.select(index) } label: {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(index == 0 ? "선택지를 더 살펴볼게요" : "이제 시작할게요")
                                    .font(.system(size: 15, weight: .semibold))
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                HStack {
                                    Spacer()
                                    Image(systemName: example.selected == index ? "checkmark.circle.fill" : "circle")
                                }
                            }.padding(15).frame(maxWidth: .infinity, minHeight: 100)
                                .petInsetSurface(emphasized: example.selected == index)
                        }.buttonStyle(.plain).disabled(scene == 0)
                            .accessibilityIdentifier("first-run-example-choice-\(index + 1)")
                            .accessibilityValue(example.selected == index ? "선택됨" : "선택 안 됨")
                    }
                }
                Button("예시 선택 전달하기") { example.deliver() }
                    .buttonStyle(PetAirButtonStyle())
                    .disabled(example.selected == nil || scene == 0)
                    .accessibilityIdentifier("first-run-example-send")
            }
        }.padding(18).petInsetSurface()
    }
}

@MainActor
private struct PetFirstRunAccountView: View {
    @ObservedObject var controller: PetAccountController

    var body: some View {
        PetAccountStatusView(
            phase: controller.phase, message: controller.message,
            signIn: { provider in Task { await controller.signIn(provider) } },
            cancel: controller.cancelSignIn,
            signOut: { Task { await controller.signOut() } },
            retry: { Task { await controller.refresh() } }
        ).padding(18).petInsetSurface()
    }
}

private struct FirstRunDocument: Identifiable {
    let id = UUID()
    let title: String
    let text: String
    let url: URL?
    let isPlaceholder: Bool
}

private struct FirstRunDocumentView: View {
    let document: FirstRunDocument
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(document.title).font(.title2.bold())
            if document.isPlaceholder {
                Text("임시 약관 · 추후 교체 예정").font(.caption).foregroundStyle(.secondary)
            }
            ScrollView {
                Text(document.text).frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            if let url = document.url { Link("정식 문서 열기", destination: url) }
            HStack { Spacer(); Button("닫기") { dismiss() }.keyboardShortcut(.cancelAction) }
        }.padding(24).frame(width: 450, height: 460)
    }
}
