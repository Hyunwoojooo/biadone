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

    /// Returns whether to advance the tutorial. Sending updates only this
    /// example and leaves its result visible until the next explicit click.
    mutating func activatePrimaryAction(scene: Int) -> Bool {
        if PetFirstRunTutorialAction.current(scene: scene, example: self) == .send {
            deliver()
            return false
        }
        return true
    }
}

/// Presentation follows the local example only; it cannot approve real work.
enum PetFirstRunTutorialAction: Equatable {
    case preview, choose, send, next, resultPreview

    static func current(scene: Int, example: PetFirstRunTutorialExampleState) -> Self {
        if scene == 0 { return .preview }
        if scene == 2 { return .resultPreview }
        if example.delivered { return .next }
        return example.selected == nil ? .choose : .send
    }

    var title: String {
        switch self {
        case .preview: PetL10n.text("First, see how a question arrives", korean: "먼저, 질문이 도착한 모습을 보세요")
        case .choose: PetL10n.text("1. Click either card below", korean: "1. 아래 카드 중 하나를 클릭하세요")
        case .send: PetL10n.text("2. Send your example choice", korean: "2. 고른 예시를 전달해 보세요")
        case .next: PetL10n.text("Done! Continue when you're ready", korean: "체험 완료! 다음으로 넘어가세요")
        case .resultPreview: PetL10n.text("3. Continue in your original conversation", korean: "3. 원래 대화에서 이어집니다")
        }
    }

    var detail: String {
        switch self {
        case .preview: PetL10n.text("This is a preview. Choose Try Choosing a Card below to practice.", korean: "지금은 미리보기예요. 아래 ‘카드 선택해 보기’를 누르면 직접 체험할 수 있어요.")
        case .choose: PetL10n.text("Either choice works for this practice. Your selection gets a checkmark.", korean: "어느 카드를 골라도 괜찮아요. 선택한 카드에 체크 표시가 생겨요.")
        case .send: PetL10n.text("Choose Send Example Choice at the bottom. No real task will run.", korean: "하단의 ‘예시 선택 전달하기’를 누르세요. 실제 작업은 실행되지 않아요.")
        case .next: PetL10n.text("In real use, Blabee returns your choice to the original conversation.", korean: "실제 사용에서는 고른 답이 원래 대화로 돌아가요.")
        case .resultPreview: PetL10n.text("This previews the result of sending a choice. Choose Continue to Sign In below to set up Blabee.", korean: "선택 전달 후의 결과 예시예요. 아래 ‘로그인으로 계속’을 눌러 Blabee를 준비하세요.")
        }
    }
}

@MainActor
struct PetFirstRunView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var controller: PetFirstRunController
    @ObservedObject var viewModel: PetViewModel
    @ObservedObject var preferences: PetFirstRunPreferences
    @ObservedObject private var connectionSetup: PetConnectionSetupController
    let onFinish: (_ connectionDeferred: Bool) -> Void
    let onClose: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var example = PetFirstRunTutorialExampleState()
    @State private var document: FirstRunDocument?
    @State private var shortcutSaved = false

    init(controller: PetFirstRunController, viewModel: PetViewModel, preferences: PetFirstRunPreferences,
         tutorialExample: PetFirstRunTutorialExampleState = .init(),
         onFinish: @escaping (_ connectionDeferred: Bool) -> Void, onClose: @escaping () -> Void) {
        self.controller = controller
        self.viewModel = viewModel
        self.preferences = preferences
        _connectionSetup = ObservedObject(wrappedValue: viewModel.connectionSetup)
        self.onFinish = onFinish
        self.onClose = onClose
        _example = State(initialValue: tutorialExample)
    }

    private var secondary: Color { PetAirPalette.secondary(for: colorScheme) }
    private var busy: Bool { viewModel.isOnboardingOperationInFlight || connectionSetup.isWorking }
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
                    .padding(.horizontal, 24).padding(.vertical, 18)
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
        .font(.blabee(.body))
        .foregroundStyle(PetAirPalette.ink(for: colorScheme))
        .modifier(PetPanelSurfaceModifier())
        .clipShape(RoundedRectangle(cornerRadius: PetPanelVisualStyle.cornerRadius, style: .continuous))
        .sheet(item: $document) { document in
            FirstRunDocumentView(document: document)
        }
        .accessibilityIdentifier("first-run-window")
        .environment(\.locale, localization.language.locale)
        .task(id: controller.step) {
            if controller.step == .setup {
                viewModel.beginShortcutSettings()
                preferences.reloadLaunchAtLoginStatus()
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
            Text("Blabee").font(.blabee(size: 18, weight: .semibold))
            Spacer()
            PetLanguagePicker(localization: localization, compact: true)
            Button(action: onClose) { Image(systemName: "xmark").frame(width: 18, height: 18) }
                .buttonStyle(PetAirButtonStyle())
                .accessibilityLabel(PetL10n.text("Close Initial Setup", korean: "초기 설정 닫기"))
                .accessibilityHint(PetL10n.text("Completed steps are saved. Setup resumes next time you open the app.", korean: "완료한 단계는 저장되며 다음 실행 때 이어갑니다."))
                .accessibilityIdentifier("first-run-close")
        }
        .padding(.horizontal, 26)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }

    private var stepIndicator: some View {
        HStack(spacing: 2) {
            ForEach(Array([PetL10n.text("Tutorial", korean: "사용법"), PetL10n.text("Sign In", korean: "로그인"), thirdStepTitle, PetL10n.text("Settings", korean: "설정")].enumerated()), id: \.offset) { index, title in
                HStack(spacing: 6) {
                    Text(index < stepNumber ? "✓" : "\(index + 1)")
                        .font(.blabee(size: 11, weight: .medium))
                        .frame(width: 20, height: 20)
                        .foregroundStyle(index == stepNumber ? PetAirPalette.panel(for: colorScheme) : secondary)
                        .background(Circle().fill(index == stepNumber ? PetAirPalette.accent(for: colorScheme) : .clear))
                        .overlay(Circle().strokeBorder(index == stepNumber ? PetAirPalette.accent(for: colorScheme) : secondary.opacity(0.4)))
                    Text(title).font(.blabee(size: 13, weight: index == stepNumber ? .semibold : .regular))
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
                .accessibilityLabel(PetL10n.text("Step \(index + 1): \(title)", korean: "\(index + 1)단계 \(title)"))
                .accessibilityValue(index == stepNumber ? PetL10n.text("Current step", korean: "현재 단계") : index < stepNumber ? PetL10n.text("Complete", korean: "완료") : PetL10n.text("Next step", korean: "다음 단계"))
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
        VStack(spacing: 14) {
            let index = controller.tutorialIndex
            heading(
                [PetL10n.text("Your questions, in one place", korean: "질문을 한곳에서 확인하세요"), PetL10n.text("Try choosing a card", korean: "카드 선택을 연습해 보세요"), PetL10n.text("Continue your conversation", korean: "원래 대화로 이어집니다")][index],
                [PetL10n.text("Review choices from Codex and Claude in Blabee.", korean: "Codex와 Claude에서 온 선택지를 Blabee에서 확인해요."),
                 PetL10n.text("Pick either card, then use the button below.", korean: "아무 카드나 고르고, 아래 버튼으로 전달하세요."),
                 PetL10n.text("In real use, send a choice with a click or your shortcut.", korean: "실제 선택지는 클릭이나 설정한 단축키로 전달해요.")][index], centered: true
            )
            PetFirstRunTutorialCard(scene: index, example: $example)
            HStack(spacing: 6) {
                ForEach(0..<3) { number in
                    Capsule().fill(secondary.opacity(number == index ? 0.9 : 0.3))
                        .frame(width: number == index ? 20 : 6, height: 6)
                }
            }.accessibilityLabel(PetL10n.text("Tutorial scene \(index + 1) of 3", korean: "사용법 장면 \(index + 1) / 3"))
            Text(PetL10n.text("Practice only · No real tasks or commands will run", korean: "연습용 화면 · 실제 작업이나 명령은 실행하지 않습니다"))
                .font(.blabee(.caption)).foregroundStyle(secondary)
                .multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity)
    }

    private var login: some View {
        VStack(spacing: 22) {
            heading(PetL10n.text("Sign In to Blabee", korean: "Blabee에 로그인하세요"), PetL10n.text("Choose the account you want to use.", korean: "사용할 계정을 선택하세요."), centered: true)
            if let account = viewModel.account {
                PetFirstRunAccountView(controller: account)
            } else {
                Text(PetL10n.text("The account service is not ready. Restart the app.", korean: "계정 서비스를 준비하지 못했습니다. 앱을 다시 실행해 주세요."))
                    .foregroundStyle(.red)
            }
            Text(PetL10n.text("Signing in does not opt you into usage statistics or error diagnostics.", korean: "로그인만으로 사용 통계나 오류 진단에 동의하지 않습니다."))
                .font(.blabee(.caption)).foregroundStyle(secondary).multilineTextAlignment(.center)
            legalLinks
        }.frame(maxWidth: .infinity)
    }

    private var terms: some View {
        VStack(alignment: .leading, spacing: 18) {
            heading(controller.legalDocumentsDeferred ? PetL10n.text("Choose What to Share", korean: "데이터 공유를 선택하세요") : PetL10n.text("Review Before You Continue", korean: "이용 전에 확인해 주세요"),
                    PetL10n.text("You can use Blabee without enabling optional sharing.", korean: "선택 항목에 동의하지 않아도 Blabee를 사용할 수 있어요."))
            HStack(spacing: 10) {
                Image(systemName: "person.crop.circle").font(.title2)
                Text(controller.accountEmail ?? PetL10n.text("Signed-in account", korean: "로그인된 계정"))
                    .font(.blabee(.callout)).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button(PetL10n.text("Change Account", korean: "계정 변경")) {
                    if let account = viewModel.account { Task { await account.signOut() } }
                }.buttonStyle(PetAirButtonStyle())
                    .accessibilityIdentifier("first-run-change-account")
            }.padding(14).petInsetSurface()
            if showsLegalAgreement {
                if controller.legalDocuments?.isPlaceholder == true {
                    Label(PetL10n.text("Placeholder terms · To be replaced", korean: "임시 약관 · 추후 교체 예정"), systemImage: "doc.text")
                        .font(.blabee(.caption)).foregroundStyle(secondary)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Toggle(PetL10n.text("[Required] I agree to the Terms of Service", korean: "[필수] 서비스 이용약관에 동의합니다"), isOn: $controller.acceptsTerms)
                        .toggleStyle(.checkbox)
                        .accessibilityIdentifier("first-run-terms-consent")
                    legalLinks
                }.padding(18).petInsetSurface()
                    .overlay(RoundedRectangle(cornerRadius: PetPanelVisualStyle.sectionRadius)
                        .strokeBorder(PetAirPalette.accent(for: colorScheme), lineWidth: controller.acceptsTerms ? 1 : 2)
                        .allowsHitTesting(false))
                if !controller.acceptsTerms {
                    Label(PetL10n.text("Read the terms above, then check the required agreement to continue.", korean: "위 약관을 확인한 뒤 필수 동의 항목을 체크하면 계속할 수 있어요."), systemImage: "arrow.up")
                        .font(.blabee(.caption)).foregroundStyle(secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Text(PetL10n.text("Optional Ways to Improve Your Experience", korean: "더 나은 사용 경험을 위한 선택")).font(.blabee(.caption)).foregroundStyle(secondary)
            VStack(alignment: .leading, spacing: 16) {
                consentToggle(PetL10n.text("Send Usage Statistics", korean: "사용 통계 보내기"), detail: PetL10n.text("Usage counts, feature responses, and app version. Original questions and answers are not included.", korean: "사용 횟수, 기능 반응, 앱 버전 등. 질문·답변 원문은 포함하지 않습니다."),
                              value: $controller.usageStatisticsEnabled, identifier: "first-run-usage-consent")
                Divider()
                consentToggle(PetL10n.text("Send Error Diagnostics", korean: "오류 진단 보내기"), detail: PetL10n.text("Error type, time, version, and Codex or Claude connection failure stage. Applies from initial setup after consent. Raw logs and conversations are not sent.", korean: "오류 종류·시각·버전과 Codex·Claude 연결 실패 단계. 동의 후 첫 설정부터 적용하며 로그·대화 원문은 보내지 않습니다."),
                              value: $controller.errorDiagnosticsEnabled, identifier: "first-run-diagnostics-consent")
            }.padding(18).petInsetSurface()
            Text(PetL10n.text("Both options are independent and off by default. You can change them anytime in Settings.", korean: "두 항목은 각각 선택할 수 있으며 기본값은 꺼짐입니다. 설정에서 언제든 변경할 수 있어요."))
                .font(.blabee(.caption)).foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true)
            if controller.legalDocuments == nil {
                Text(PetL10n.text("Unable to prepare the legal documents. Check the app's legal configuration.", korean: "약관 문서를 준비하지 못했습니다. 앱의 약관 구성을 확인해 주세요."))
                    .font(.blabee(.caption)).foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder private var legalLinks: some View {
        if showsLegalAgreement {
            HStack(spacing: 14) {
                Button(PetL10n.text("Terms of Service", korean: "서비스 이용약관")) { showLegal(privacy: false) }
                    .accessibilityIdentifier("first-run-open-terms")
                Button(PetL10n.text("Privacy Notice", korean: "개인정보 안내")) { showLegal(privacy: true) }
                    .accessibilityIdentifier("first-run-open-privacy")
            }
            .buttonStyle(.link)
            .font(.blabee(.caption))
            .disabled(controller.legalDocuments == nil)
        }
    }

    private func showLegal(privacy: Bool) {
        guard let legal = controller.legalDocuments, !legal.isDeferred else { return }
        let displayedLegal = legal.isPlaceholder ? PetFirstRunLegalDocuments.placeholder : legal
        document = FirstRunDocument(
            title: privacy ? PetL10n.text("Privacy Notice", korean: "개인정보 안내") : PetL10n.text("Terms of Service", korean: "서비스 이용약관"),
            text: privacy ? displayedLegal.privacyText : displayedLegal.termsText,
            url: privacy ? legal.privacyURL : legal.termsURL,
            isPlaceholder: legal.isPlaceholder
        )
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 18) {
            PetConnectionSetupView(viewModel: viewModel)
            DisclosureGroup(PetL10n.text("Advanced Connection Options", korean: "연결 고급 옵션")) {
                advancedConnectionSetup.padding(.top, 10)
            }
            .font(.blabee(.caption))
            .disabled(busy)
            Label(PetL10n.text("Optional preferences · You can change these later", korean: "선택 설정 · 나중에 변경할 수 있어요"), systemImage: "slider.horizontal.3")
                .font(.blabee(.caption, weight: .semibold)).foregroundStyle(secondary)
            shortcutSetup
            VStack(alignment: .leading, spacing: 16) {
                Picker(PetL10n.text("Appearance", korean: "화면 모드"), selection: Binding(get: { preferences.theme }, set: preferences.setTheme)) {
                    ForEach(PetFirstRunTheme.allCases) { Text($0.title).tag($0) }
                }.accessibilityIdentifier("first-run-theme")
                Divider()
                Toggle(PetL10n.text("Launch at Login", korean: "Mac 로그인 시 실행"), isOn: Binding(
                    get: { preferences.launchAtLoginEnabled }, set: preferences.setLaunchAtLogin
                )).toggleStyle(.switch).accessibilityIdentifier("first-run-launch-at-login")
                Text(preferences.launchAtLoginStatus.title).font(.blabee(.caption)).foregroundStyle(secondary)
                if preferences.launchAtLoginStatus == .requiresApproval {
                    Button(PetL10n.text("Allow in System Settings", korean: "시스템 설정에서 허용"), action: preferences.openLoginItemsSettings)
                        .buttonStyle(PetAirButtonStyle())
                }
                if let error = preferences.launchAtLoginError {
                    Text(error).font(.blabee(.caption)).foregroundStyle(.red)
                }
            }.padding(18).petInsetSurface().disabled(busy)
            Label(PetL10n.text("Open the panel using the bee icon in the menu bar or \(viewModel.shortcutLabel(for: .toggle)).", korean: "메뉴바의 벌 아이콘 또는 \(viewModel.shortcutLabel(for: .toggle))로 패널을 여세요."), systemImage: "menubar.arrow.up.rectangle")
                .font(.blabee(.caption)).foregroundStyle(secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var advancedConnectionSetup: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(PetL10n.text("Codex Connection", korean: "Codex 연결"), systemImage: "link").font(.blabee(.headline))
            Text(viewModel.connectionReadiness.title).font(.blabee(.callout, weight: .bold))
            ForEach(viewModel.connectionReadiness.checks) { check in
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: check.state == .confirmed ? "checkmark.circle" : "circle")
                        .foregroundStyle(check.state == .confirmed ? .green : secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(check.title).font(.blabee(.callout))
                        Text(check.detail).font(.blabee(.caption)).foregroundStyle(secondary)
                    }
                }.fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                if viewModel.isAppOwnedServiceAvailable {
                    Button(viewModel.isAppOwnedServiceEnabled ? PetL10n.text("Restart Service", korean: "서비스 다시 시작") : PetL10n.text("Start Service", korean: "서비스 시작")) {
                        Task {
                            if viewModel.isAppOwnedServiceEnabled { await viewModel.restartAppOwnedService() }
                            else { await viewModel.enableAppOwnedService() }
                        }
                    }.disabled(!viewModel.canChangeAppOwnedService)
                } else {
                    Text(PetL10n.text("Prepare the service using Blabee in Applications.", korean: "응용 프로그램 폴더의 Blabee에서 서비스를 준비해 주세요."))
                        .font(.blabee(.caption)).foregroundStyle(secondary)
                }
                Button(PetL10n.text("Recheck Status", korean: "상태 다시 확인")) { Task { await viewModel.refreshConnectionSetup() } }
                    .accessibilityIdentifier("first-run-refresh-connection")
            }
            HStack {
                Button(PetL10n.text("Connect Codex Plugin", korean: "Codex Plugin 연결")) { Task { await viewModel.connectCodexPlugin() } }
                    .disabled(!viewModel.canConnectCodexPlugin)
                    .accessibilityIdentifier("first-run-connect-plugin")
                Button(PetL10n.text("Add Project", korean: "프로젝트 추가")) { Task { await viewModel.chooseAndEnableProject() } }
                    .disabled(!viewModel.canMutateOnboardingProjects)
                    .accessibilityIdentifier("first-run-add-project")
            }
            if case .installedNeedsHookReview = viewModel.codexPluginSetupState {
                PetHookReadinessView(viewModel: viewModel)
            }
            if viewModel.isAppOwnedServiceAvailable {
                DisclosureGroup(PetL10n.text("Storage Recovery", korean: "저장소 복구")) {
                    PetStorageRecoveryView(viewModel: viewModel).padding(.top, 8)
                }
            }
            Text(PetL10n.text("Check /hooks in Codex, then send a new request in a registered project. Installation alone does not verify actual delivery.", korean: "Codex에서 /hooks를 확인한 뒤 등록한 프로젝트에서 새 요청을 보내세요. 설치 완료만으로 실제 전달을 확인한 것은 아닙니다."))
                .font(.blabee(.caption)).foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true)
            if let error = viewModel.onboardingError {
                Text(error).font(.blabee(.caption)).foregroundStyle(.red).textSelection(.enabled)
            }
        }
        .buttonStyle(PetAirButtonStyle())
        .padding(18).petInsetSurface()
        .disabled(busy)
        .accessibilityIdentifier("first-run-connection-advanced")
    }

    private var shortcutSetup: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(PetL10n.text("Panel shortcut", korean: "패널 열기 단축키")).font(.blabee(.callout, weight: .bold))
                Spacer()
                Text(viewModel.shortcutLabel(for: .toggle)).font(.callout.monospaced())
            }
            HStack {
                Picker(PetL10n.text("Modifiers", korean: "보조키"), selection: Binding(
                    get: { viewModel.shortcutDraft.shortcut(for: .toggle).modifiers },
                    set: { viewModel.updateShortcutDraft(intent: .toggle, modifiers: $0); shortcutSaved = false }
                )) {
                    ForEach(PetShortcutCatalog.modifierPresets) { Text($0.displayLabel).tag($0.modifiers) }
                }
                Picker(PetL10n.text("Key", korean: "키"), selection: Binding(
                    get: { viewModel.shortcutDraft.shortcut(for: .toggle).keyCode },
                    set: { viewModel.updateShortcutDraft(intent: .toggle, keyCode: $0); shortcutSaved = false }
                )) {
                    ForEach(PetShortcutCatalog.keys) { Text($0.displayLabel).tag($0.keyCode) }
                }
            }.accessibilityIdentifier("first-run-shortcut-draft")
            HStack {
                Button(PetL10n.text("Defaults", korean: "기본값")) {
                    let shortcut = PetShortcutConfiguration.defaults.shortcut(for: .toggle)
                    viewModel.updateShortcutDraft(intent: .toggle, keyCode: shortcut.keyCode, modifiers: shortcut.modifiers)
                    shortcutSaved = false
                }
                Button(PetL10n.text("Save Shortcut", korean: "단축키 저장")) {
                    viewModel.saveShortcutSettings()
                    shortcutSaved = viewModel.shortcutSettingsError == nil
                }.accessibilityIdentifier("first-run-save-shortcut")
                if shortcutSaved { Text(PetL10n.text("Saved", korean: "저장됨")).font(.blabee(.caption)).foregroundStyle(secondary) }
            }.buttonStyle(PetAirButtonStyle())
            if let error = viewModel.shortcutSettingsError {
                Text(error).font(.blabee(.caption)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(18).petInsetSurface().disabled(busy)
    }

    private var footer: some View {
        VStack(spacing: 10) {
            Divider()
            if let hint = navigationHint {
                Text(hint).font(.blabee(.caption)).foregroundStyle(secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("first-run-next-action-hint")
            }
            HStack(spacing: 18) {
                if controller.step != .tutorial || controller.tutorialIndex > 0 {
                    Button { controller.back() } label: { Label(PetL10n.text("Back", korean: "이전"), systemImage: "chevron.left") }
                        .buttonStyle(.plain).disabled(busy || !controller.isStorageLoaded)
                        .accessibilityIdentifier("first-run-back")
                }
                Button(action: advance) {
                    HStack {
                        Spacer()
                        Text(continueTitle).font(.blabee(.body, weight: .semibold))
                        Spacer()
                        Image(systemName: "arrow.right")
                    }.padding(.vertical, 5)
                }
                .buttonStyle(PetOnboardingActionButtonStyle(emphasized: controller.step != .tutorial || tutorialAction != .choose))
                .disabled(!canContinue || busy)
                .accessibilityIdentifier(controller.step == .tutorial && tutorialAction == .send ? "first-run-example-send" : "first-run-continue")
            }
            if controller.step == .tutorial {
                Button(PetL10n.text("Skip Introduction", korean: "소개 건너뛰기"), action: controller.skipTutorial)
                    .buttonStyle(.link).font(.blabee(.caption)).disabled(!controller.isStorageLoaded)
                    .accessibilityIdentifier("first-run-skip-tutorial")
            } else if controller.step == .setup {
                Button(PetL10n.text("Connect Later", korean: "연결은 나중에")) { onFinish(true) }
                    .buttonStyle(.link).font(.blabee(.caption))
                    .disabled(!canDeferConnection)
                    .accessibilityIdentifier("first-run-defer-connection")
            }
            if (controller.step == .setup || controller.step == .terms), controller.accountID == nil {
                ProgressView(PetL10n.text("Checking sign-in status…", korean: "로그인 상태 확인 중…")).controlSize(.small)
                    .accessibilityIdentifier("first-run-verifying-account")
            }
            if !controller.errorMessage.isEmpty {
                Text(controller.errorMessage).font(.blabee(.caption)).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("first-run-error")
            }
            if controller.canRetryLoading {
                Button(PetL10n.text("Try Again", korean: "다시 시도"), action: controller.retryLoading)
                    .buttonStyle(PetAirButtonStyle())
                    .accessibilityIdentifier("first-run-retry-loading")
            }
        }.padding(.horizontal, 24).padding(.bottom, 21)
    }

    var canDeferConnection: Bool {
        controller.step == .setup && !busy && controller.canFinishSetup
    }

    var canContinue: Bool {
        guard !busy else { return false }
        return switch controller.step {
        case .tutorial: controller.isStorageLoaded
        case .signIn: controller.canContinueAfterSignIn
        case .terms: controller.legalDocumentsDeferred
            ? controller.canSaveDataSharingPreferences : controller.canAcceptTerms
        case .setup: setupReady && controller.canFinishSetup
        }
    }

    var showsLegalAgreement: Bool { !controller.legalDocumentsDeferred }
    var thirdStepTitle: String { controller.legalDocumentsDeferred ? PetL10n.text("Data Sharing", korean: "데이터 공유") : PetL10n.text("Terms", korean: "약관") }
    var tutorialAction: PetFirstRunTutorialAction {
        .current(scene: controller.tutorialIndex, example: example)
    }

    var navigationHint: String? {
        if !controller.isStorageLoaded || busy { return nil }
        if (controller.step == .setup || controller.step == .terms), controller.accountID == nil { return nil }
        switch controller.step {
        case .tutorial: return nil
        case .signIn:
            return controller.canContinueAfterSignIn
                ? PetL10n.text("You're signed in. Continue with the button below.", korean: "로그인됐어요. 아래 버튼으로 계속하세요.")
                : PetL10n.text("Complete sign-in above to unlock the next step.", korean: "위에서 로그인을 마치면 다음 단계로 갈 수 있어요.")
        case .terms:
            return controller.legalDocumentsDeferred && controller.canSaveDataSharingPreferences
                ? PetL10n.text("Optional sharing can stay off. Save your choices below.", korean: "선택 항목은 꺼 두어도 괜찮아요. 아래 버튼으로 설정을 저장하세요.")
                : nil
        case .setup:
            if canContinue {
                return PetL10n.text("Your settings are ready. Open Blabee below.", korean: "설정이 준비됐어요. 아래에서 Blabee를 시작하세요.")
            }
            if viewModel.appOwnedServiceState == .failed("freshness_storage_missing") {
                return PetL10n.text("Check Storage Recovery above to continue setup.", korean: "위의 저장소 복구를 확인하면 설정을 이어갈 수 있어요.")
            }
            if connectionSetup.serviceIssue != nil {
                return PetL10n.text("Resolve the Blabee service issue shown above to continue.", korean: "위에 표시된 Blabee 서비스 문제를 먼저 확인해 주세요.")
            }
            return canDeferConnection
                ? PetL10n.text("Connect your tools above, or choose Connect Later below.", korean: "위에서 도구를 연결하거나, 아래 ‘연결은 나중에’를 선택하세요.")
                : nil
        }
    }

    var continueTitle: String {
        switch controller.step {
        case .tutorial:
            switch tutorialAction {
            case .preview: PetL10n.text("Try Choosing a Card", korean: "카드 선택해 보기")
            case .choose: PetL10n.text("Skip Practice and Continue", korean: "체험 건너뛰고 다음")
            case .send: PetL10n.text("Send Example Choice", korean: "예시 선택 전달하기")
            case .next: PetL10n.text("Next", korean: "다음")
            case .resultPreview: PetL10n.text("Continue to Sign In", korean: "로그인으로 계속")
            }
        case .signIn: controller.legalDocumentsDeferred ? PetL10n.text("Continue", korean: "계속") : PetL10n.text("Review Terms", korean: "약관 확인하기")
        case .terms: controller.legalDocumentsDeferred ? PetL10n.text("Save Settings and Continue", korean: "설정 저장하고 계속") : PetL10n.text("Agree and Continue", korean: "동의하고 계속")
        case .setup: PetL10n.text("Get Started with Blabee", korean: "Blabee 시작하기")
        }
    }

    private func advance() {
        guard canContinue, !busy else { return }
        switch controller.step {
        case .tutorial:
            if example.activatePrimaryAction(scene: controller.tutorialIndex) { controller.advanceTutorial() }
        case .signIn: _ = controller.continueAfterSignIn()
        case .terms:
            if controller.legalDocumentsDeferred { _ = controller.saveDataSharingPreferences() }
            else { _ = controller.acceptTerms() }
        case .setup: onFinish(false)
        }
    }

    private func heading(_ title: String, _ subtitle: String, centered: Bool = false) -> some View {
        VStack(alignment: centered ? .center : .leading, spacing: 8) {
            Text(title).font(.blabee(size: 24, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
            Text(subtitle).font(.blabee(size: 14)).foregroundStyle(secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .multilineTextAlignment(centered ? .center : .leading)
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }

    private func consentToggle(_ title: String, detail: String, value: Binding<Bool>, identifier: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(PetL10n.text("[Optional] \(title)", korean: "[선택] \(title)"), isOn: value).toggleStyle(.checkbox).accessibilityIdentifier(identifier)
            Text(detail).font(.blabee(.caption)).foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct PetFirstRunTutorialCard: View {
    @ObservedObject private var localization = PetLocalization.shared
    let scene: Int
    @Binding var example: PetFirstRunTutorialExampleState
    @Environment(\.colorScheme) private var colorScheme
    private var action: PetFirstRunTutorialAction { .current(scene: scene, example: example) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                PetAirBeeMark().frame(width: 22, height: 22)
                Text("Blabee").font(.blabee(.callout, weight: .bold))
                Spacer()
                Text(scene == 0 || scene == 2 ? PetL10n.text("Preview", korean: "미리보기") : PetL10n.text("Practice", korean: "연습"))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            PetOnboardingGuidance(title: action.title, detail: action.detail,
                                  symbol: action == .next || action == .resultPreview ? "checkmark.circle.fill" : action == .send ? "arrow.down" : "hand.point.up.left.fill")
                .accessibilityIdentifier("first-run-tutorial-guidance")
            if scene == 2 || example.delivered {
                VStack(spacing: 14) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 40, weight: .light))
                        .foregroundStyle(PetAirPalette.accent(for: colorScheme))
                    Text(scene == 2
                         ? PetL10n.text("Your original conversation continues with your choice.", korean: "원래 대화가 선택한 답으로 이어져요.")
                         : PetL10n.text("Your choice was sent to the example conversation.", korean: "예시 대화에 선택이 전달됐어요."))
                        .font(.blabee(.callout))
                        .multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity).padding(.vertical, 16)
            } else {
                HStack(spacing: 12) {
                    ForEach(0..<2) { index in
                        Button { example.select(index) } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(index == 0 ? PetL10n.text("Explore More Choices", korean: "선택지를 더 살펴볼게요") : PetL10n.text("Get Started", korean: "이제 시작할게요"))
                                    .font(.blabee(size: 15, weight: .semibold))
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                Label(example.selected == index ? PetL10n.text("Selected", korean: "선택됨")
                                      : scene == 0 ? PetL10n.text("Example", korean: "예시") : PetL10n.text("Click to choose", korean: "클릭하여 선택"),
                                      systemImage: example.selected == index ? "checkmark.circle.fill" : "circle")
                                    .font(.blabee(.caption, weight: .medium))
                                    .foregroundStyle(PetAirPalette.accent(for: colorScheme))
                            }.padding(12).frame(maxWidth: .infinity, minHeight: 90)
                                .petInsetSurface(emphasized: example.selected == index)
                                .overlay(RoundedRectangle(cornerRadius: PetPanelVisualStyle.sectionRadius)
                                    .strokeBorder(PetAirPalette.accent(for: colorScheme)
                                        .opacity(action == .choose || example.selected == index ? 1 : 0), lineWidth: 2)
                                    .allowsHitTesting(false))
                                .contentShape(RoundedRectangle(cornerRadius: PetPanelVisualStyle.sectionRadius))
                        }.buttonStyle(.plain).disabled(scene == 0)
                            .accessibilityIdentifier("first-run-example-choice-\(index + 1)")
                            .accessibilityValue(example.selected == index ? PetL10n.text("Selected", korean: "선택됨") : PetL10n.text("Not selected", korean: "선택 안 됨"))
                            .accessibilityHint(PetL10n.text("Practice selection only. Use Send Example Choice at the bottom to continue.", korean: "연습용 선택입니다. 선택한 뒤 하단의 예시 선택 전달하기를 누르세요."))
                    }
                }
            }
        }.padding(18).petInsetSurface()
    }
}

/// A solid action stands apart from the glass surfaces used for secondary controls.
/// Scope this style to setup flows; it does not change permission/decision buttons.
struct PetOnboardingActionButtonStyle: ButtonStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.isEnabled) private var isEnabled
    var emphasized = true

    func makeBody(configuration: Configuration) -> some View {
        let filled = emphasized && isEnabled
        let accent = PetAirPalette.accent(for: colorScheme)
        configuration.label
            .font(.blabee(size: 14, weight: .semibold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16).padding(.vertical, 11)
            .foregroundStyle(filled ? PetAirPalette.panel(for: colorScheme) : PetAirPalette.ink(for: colorScheme))
            .background(filled ? accent : PetAirPalette.reading(for: colorScheme, emphasized: false),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(accent.opacity(filled ? 0 : 0.35), lineWidth: 1)
                .allowsHitTesting(false))
            .opacity(isEnabled ? (configuration.isPressed ? 0.78 : 1) : 0.48)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct PetOnboardingGuidance: View {
    let title: String
    let detail: String
    var symbol = "hand.point.up.left.fill"
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(PetAirPalette.accent(for: colorScheme))
                .frame(width: 22).padding(.top, 2).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.blabee(.callout, weight: .semibold))
                    .foregroundStyle(PetAirPalette.ink(for: colorScheme))
                Text(detail).font(.blabee(.caption))
                    .foregroundStyle(PetAirPalette.secondary(for: colorScheme))
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(PetAirPalette.reading(for: colorScheme, emphasized: true),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2).fill(PetAirPalette.accent(for: colorScheme))
                .frame(width: 3).padding(.vertical, 10).allowsHitTesting(false)
        }
        .accessibilityElement(children: .combine)
    }
}

@MainActor
private struct PetFirstRunAccountView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var controller: PetAccountController
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if controller.phase == .signedOut {
                PetOnboardingGuidance(
                    title: PetL10n.text("Choose Google or GitHub below", korean: "아래에서 Google 또는 GitHub를 선택하세요"),
                    detail: PetL10n.text("Use either account. Complete sign-in in the browser, then return here.", korean: "둘 중 하나만 선택하면 돼요. 브라우저에서 로그인한 뒤 이 화면으로 돌아오세요."))
            }
            PetAccountStatusView(
                phase: controller.phase, message: controller.message,
                signIn: { provider in Task { await controller.signIn(provider) } },
                cancel: controller.cancelSignIn,
                signOut: { Task { await controller.signOut() } },
                retry: { Task { await controller.refresh() } }
            )
        }.padding(18).petInsetSurface()
            .overlay(RoundedRectangle(cornerRadius: PetPanelVisualStyle.sectionRadius)
                .strokeBorder(PetAirPalette.accent(for: colorScheme).opacity(controller.phase == .signedOut ? 1 : 0), lineWidth: 2)
                .allowsHitTesting(false))
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
    @ObservedObject private var localization = PetLocalization.shared
    let document: FirstRunDocument
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(document.title).font(.blabee(.title2, weight: .bold))
            if document.isPlaceholder {
                Text(PetL10n.text("Placeholder terms · To be replaced", korean: "임시 약관 · 추후 교체 예정")).font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            ScrollView {
                Text(document.text).frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            if let url = document.url { Link(PetL10n.text("Open Official Document", korean: "정식 문서 열기"), destination: url) }
            HStack { Spacer(); Button(PetL10n.text("Close", korean: "닫기")) { dismiss() }.keyboardShortcut(.cancelAction) }
        }.font(.blabee(.body)).padding(24).frame(width: 450, height: 460)
    }
}
