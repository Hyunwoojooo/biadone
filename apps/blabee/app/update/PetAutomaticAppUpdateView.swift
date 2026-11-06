import AppKit
import SwiftUI

@MainActor
enum PetAppUpdateTermination {
    /// AppKit's terminateLater spins a nested modal loop. Calling terminate from
    /// the update Task holds the main queue inside that loop, so the delegate's
    /// asynchronous service shutdown cannot start. Enter through the run loop
    /// after the Task returns; DispatchQueue.main.async would hold the same queue.
    static func request(
        terminate: @escaping @MainActor @Sendable () -> Void = { NSApplication.shared.terminate(nil) }
    ) {
        RunLoop.main.perform(inModes: [.common]) {
            MainActor.assumeIsolated { terminate() }
        }
    }
}

/// Settings only opens the application-owned window. No install Task is tied
/// to the floating panel's view lifetime.
@MainActor
struct PetAutomaticAppUpdateView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var controller: AppUpdateTransactionController
    let release: PetAppUpdateRelease?
    let openUpdateWindow: (PetAppUpdateRelease?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let release {
                if release.installerAssets != nil {
                    Button(PetL10n.text("Update", korean: "업데이트")) {
                        openUpdateWindow(release)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!controller.canPrepare)
                    .accessibilityIdentifier("prepare-app-update")
                } else {
                    Text(release.installerUnavailableReason ?? PetL10n.text("This release has no automatic installation files. Check the release page.", korean: "이 릴리스에는 자동 설치 파일이 없습니다. 릴리스 페이지를 확인해 주세요."))
                        .font(.blabee(.caption)).foregroundStyle(.secondary)
                }
            }

            if controller.phase != .idle {
                HStack(alignment: .top, spacing: 8) {
                    if controller.isBusy { ProgressView().controlSize(.small) }
                    VStack(alignment: .leading, spacing: 5) {
                        Text(PetAppUpdatePresentation.title(for: controller.phase))
                            .font(.blabee(.callout, weight: .semibold))
                        Text(controller.detail).font(.blabee(.caption))
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("automatic-update-status")
                Button(PetL10n.text("Open Update Window", korean: "업데이트 창 열기")) {
                    openUpdateWindow(nil)
                }
                .accessibilityIdentifier("open-app-update-window")
            }
            Divider()
            PetUpdateManagedSessionsView(disabled: controller.isBusy)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

@MainActor
enum PetAppUpdatePresentation {
    static func title(for phase: AppUpdateTransactionController.Phase) -> String {
        switch phase {
        case .idle: PetL10n.text("Waiting to update", korean: "업데이트 대기")
        case .preparing: PetL10n.text("Downloading and verifying the update", korean: "업데이트 다운로드 및 검증 중")
        case .review: PetL10n.text("Close connected Codex and Claude sessions", korean: "연결된 Codex·Claude 세션을 종료해 주세요")
        case .waitingForSessionExit: PetL10n.text("Checking remaining connections and requests", korean: "남은 연결과 요청 확인 중")
        case .waitingForSafePoint: PetL10n.text("Checking before restarting Blabee", korean: "Blabee 재시작 전 확인 중")
        case .deferred: PetL10n.text("Your action is needed before updating", korean: "업데이트 전에 확인이 필요합니다")
        case .preparingConnectionRecovery: PetL10n.text("Preparing Claude connection recovery", korean: "Claude 연결 복구 준비 중")
        case .connectionRestartRequired: PetL10n.text("Restart your Mac to finish connection recovery", korean: "연결 복구를 위해 Mac을 재시동해 주세요")
        case .startingHelper: PetL10n.text("Preparing the installer", korean: "설치 도우미 준비 중")
        case .updating: PetL10n.text("Updating and restarting Blabee", korean: "Blabee 업데이트 및 재시작 중")
        case .succeeded: PetL10n.text("Update complete", korean: "업데이트 완료")
        case .failed: PetL10n.text("Unable to complete the update", korean: "업데이트를 완료하지 못했습니다")
        case .partialRestore: PetL10n.text("Check the restoration of some sessions", korean: "일부 세션의 복원을 확인해 주세요")
        case .recoveryRequired: PetL10n.text("Update recovery needs attention", korean: "업데이트 복구 확인 필요")
        }
    }

    static var confirmationTitle: String {
        PetL10n.text("Sessions Closed — Update", korean: "세션 종료 완료 · 업데이트")
    }

    static var sessionClosureSteps: [String] {
        [
            PetL10n.text("Save your work in every Codex and Claude session connected to Blabee.", korean: "Blabee에 연결된 모든 Codex·Claude 세션에서 작업을 저장하세요."),
            PetL10n.text("Close those sessions normally in their terminal or app. Hiding or minimizing a window does not end a session.", korean: "터미널이나 앱에서 해당 세션을 정상 종료하세요. 창을 숨기거나 최소화하는 것만으로는 세션이 종료되지 않습니다."),
            PetL10n.text("Return to this window and choose Sessions Closed — Update.", korean: "이 창으로 돌아와 ‘세션 종료 완료 · 업데이트’를 누르세요.")
        ]
    }

    static var restartExplanation: String {
        PetL10n.text("After the checks pass, Blabee closes normally, installs the verified update, and opens again. Codex and Claude sessions are not automatically closed or resumed.", korean: "확인을 마치면 Blabee가 정상 종료되고, 검증한 업데이트를 설치한 뒤 다시 실행됩니다. Codex·Claude 세션은 자동으로 종료하거나 복원하지 않습니다.")
    }

    static var returnExplanation: String {
        PetL10n.text("If a choice or approval is still pending in Blabee, cancel the update, return to that item, and resolve it or use Skip Choices where available. Then retry the update.", korean: "Blabee에 선택이나 승인 요청이 남아 있다면 업데이트를 취소하고 해당 요청으로 돌아가 처리하세요. 선택 카드에는 ‘선택 건너뛰기’를 사용할 수 있습니다. 그다음 업데이트를 다시 시작하세요.")
    }

    static var connectionRecoveryTitle: String {
        PetL10n.text("Claude is closed, but installation still waits", korean: "Claude를 종료해도 설치가 계속 대기하나요?")
    }

    static var connectionRecoveryExplanation: String {
        PetL10n.text("An interrupted Claude connection may have left a record. Prepare recovery, save your work, then restart your Mac. Reopen Blabee or this installer and retry. Preparation stays saved even if you close this window. Nothing is installed or restarted automatically.", korean: "중단된 Claude 연결의 기록이 남아 있을 수 있습니다. 복구를 준비한 뒤 작업을 저장하고 Mac을 재시동하세요. 이후 Blabee 또는 이 설치 창을 다시 열고 재시도하세요. 이 창을 닫아도 복구 준비는 저장되어 있으며, 설치나 재시동을 자동으로 실행하지 않습니다.")
    }

    static var connectionRecoveryButtonTitle: String {
        PetL10n.text("Prepare Connection Recovery", korean: "연결 복구 준비")
    }

    static var connectionRecoveryPreparing: String {
        PetL10n.text("Saving the connection recovery preparation. Existing connection records stay protected until after a Mac restart.", korean: "연결 복구 준비를 저장하고 있습니다. 기존 연결 기록은 Mac 재시동 이후까지 보존됩니다.")
    }

    static var connectionRecoveryClear: String {
        PetL10n.text("No Claude connection records need recovery. You can retry after normally closing connected sessions. Installation has not started.", korean: "복구가 필요한 Claude 연결 기록이 없습니다. 연결된 세션을 정상 종료한 뒤 다시 시도할 수 있습니다. 설치는 시작하지 않았습니다.")
    }

    static var connectionRecoveryRestartInstructions: String {
        PetL10n.text("Recovery preparation is saved. Save your work and restart your Mac, then reopen Blabee or this installer and retry. Closing this window does not undo the preparation. Blabee will not restart your Mac or install automatically.", korean: "복구 준비를 저장했습니다. 작업을 저장하고 Mac을 재시동한 뒤 Blabee 또는 이 설치 창을 다시 열어 재시도하세요. 창을 닫아도 준비는 취소되지 않습니다. Mac 재시동이나 설치를 자동으로 실행하지 않습니다.")
    }
}

/// Shared by the installed updater and the new DMG installer so an older
/// installed version without this action still has a supported recovery path.
@MainActor
struct PetAppUpdateConnectionRecoveryInstructionsView: View {
    @ObservedObject private var localization = PetLocalization.shared
    let canPrepare: Bool
    let prepare: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(PetAppUpdatePresentation.connectionRecoveryExplanation)
                .font(.blabee(.callout)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(PetAppUpdatePresentation.connectionRecoveryButtonTitle, action: prepare)
                .disabled(!canPrepare)
                .accessibilityIdentifier("prepare-claude-connection-recovery")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
        .accessibilityIdentifier("claude-connection-recovery-instructions")
    }
}

@MainActor
struct PetAppUpdateSessionInstructionsView: View {
    @ObservedObject private var localization = PetLocalization.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(PetAppUpdatePresentation.sessionClosureSteps.enumerated()), id: \.offset) { step in
                HStack(alignment: .top, spacing: 10) {
                    Text(String(step.offset + 1))
                        .font(.blabee(.callout, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 24, height: 24)
                        .background(Color.accentColor.opacity(0.10), in: Circle())
                        .accessibilityHidden(true)
                    Text(step.element)
                        .font(.blabee(.body))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Text(PetAppUpdatePresentation.restartExplanation)
                .font(.blabee(.callout))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("app-update-session-instructions")
    }
}

@MainActor
private struct PetUpdateManagedSessionsView: View {
    @ObservedObject private var localization = PetLocalization.shared
    let disabled: Bool
    @State private var expanded = false
    @State private var sessions: [UpdateManagedSession] = []
    @State private var message: String?
    @State private var busy = false
    @State private var resumeID = ""
    private let manager = UpdateManagedCodexSessions.live()

    var body: some View {
        DisclosureGroup(PetL10n.text("Managed Codex Sessions", korean: "Codex 관리 세션"), isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 10) {
                Text(PetL10n.text("This list contains only sessions opened through this setting, not every running Codex session. Save your work and close these sessions normally before updating.", korean: "이 목록은 여기에서 연 관리 세션만 표시하며 실행 중인 모든 Codex 세션 수가 아닙니다. 업데이트 전에 작업을 저장하고 이 세션들도 정상 종료하세요."))
                Text(PetL10n.text("To resume a conversation, find its session ID with /status in Codex, exit normally, and enter it below. Leave blank for a new conversation.", korean: "기존 대화를 이어가려면 Codex의 /status에서 세션 ID를 확인하고 정상 종료한 뒤 아래에 입력하세요. 새 대화는 비워 두세요."))
                    .foregroundStyle(.secondary)
                TextField(PetL10n.text("Existing session ID (optional)", korean: "기존 세션 ID (선택)"), text: $resumeID)
                    .textFieldStyle(.roundedBorder)
                    .disabled(disabled || busy)
                    .accessibilityIdentifier("update-managed-resume-id")
                HStack(spacing: 10) {
                    Button(PetL10n.text("Choose Project and Open Managed Session", korean: "프로젝트를 선택해 관리 세션 열기"), action: openManagedSession)
                        .disabled(disabled || busy)
                        .accessibilityIdentifier("open-update-managed-session")
                    Button(PetL10n.text("Refresh List", korean: "목록 새로 고침")) { Task { await refresh() } }
                        .disabled(disabled || busy)
                }
                ForEach(sessions) { session in
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(URL(fileURLWithPath: session.cwd).lastPathComponent) · \(stateTitle(session))")
                        if let detail = session.detail { Text(detail).foregroundStyle(.secondary) }
                    }
                }
                if let message { Text(message).foregroundStyle(.secondary) }
            }
            .font(.blabee(.caption))
            .padding(.top, 8)
        }
        .font(.blabee(.callout))
    }

    private func openManagedSession() {
        let input = resumeID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard input.isEmpty || UUID(uuidString: input) != nil else {
            message = PetL10n.text("Enter the exact session ID of the existing conversation, or leave blank for a new conversation.", korean: "기존 대화의 세션 ID를 정확히 입력해 주세요. 새 대화는 비워 두면 됩니다.")
            return
        }
        let chooser = NSOpenPanel()
        chooser.canChooseDirectories = true
        chooser.canChooseFiles = false
        chooser.allowsMultipleSelection = false
        chooser.prompt = PetL10n.text("Open Managed Session", korean: "관리 세션 열기")
        chooser.message = input.isEmpty ? PetL10n.text("Choose the project folder to work in with Codex.", korean: "Codex에서 작업할 프로젝트 폴더를 선택하세요.")
            : PetL10n.text("Choose the project folder used by the existing Codex conversation.", korean: "기존 Codex 대화에서 사용하던 프로젝트 폴더를 선택하세요.")
        guard chooser.runModal() == .OK, let project = chooser.url else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await manager.openSession(cwd: project, resumeThreadID: input.isEmpty ? nil : input)
                message = input.isEmpty ? PetL10n.text("A new managed Codex session will start in Terminal.", korean: "Terminal에서 새 Codex 관리 세션이 시작됩니다.")
                    : PetL10n.text("The specified Codex conversation will resume in Terminal.", korean: "Terminal에서 지정한 Codex 대화를 이어갑니다.")
                sessions = try await manager.sessions()
            } catch { message = error.localizedDescription }
        }
    }

    private func refresh() async {
        busy = true
        defer { busy = false }
        do {
            sessions = try await manager.sessions()
            message = sessions.isEmpty ? PetL10n.text("Blabee is not currently managing any Codex sessions.", korean: "현재 Blabee가 관리하는 Codex 세션이 없습니다.") : nil
        } catch { message = error.localizedDescription }
    }

    private func stateTitle(_ session: UpdateManagedSession) -> String {
        switch session.state {
        case .starting: PetL10n.text("Starting", korean: "시작 중")
        case .pausing: PetL10n.text("Saving conversation", korean: "대화 저장 중")
        case .resuming: PetL10n.text("Restoring", korean: "복원 중")
        case .running: PetL10n.text("Connected", korean: "연결됨")
        case .busy: PetL10n.text("Working", korean: "작업 중")
        case .paused: PetL10n.text("Waiting for update restore", korean: "업데이트 복원 대기")
        case .failed: PetL10n.text("Needs attention", korean: "확인 필요")
        }
    }
}
