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

@MainActor
struct PetAutomaticAppUpdateView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var controller: AppUpdateTransactionController
    let release: PetAppUpdateRelease?
    @State private var actionError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let release {
                if release.installerAssets != nil {
                    Button(PetL10n.text("Update", korean: "업데이트")) {
                        actionError = nil
                        Task {
                            await controller.prepare(release)
                            if controller.canBeginInstallation { await installPreparedUpdate() }
                        }
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
                        Text(phaseTitle).font(.blabee(.callout, weight: .semibold))
                        Text(controller.detail).font(.blabee(.caption))
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("automatic-update-status")
            }

            if let review = controller.preparedReview {
                GroupBox(PetL10n.text("Keep Conversations Open", korean: "대화를 유지하며 업데이트")) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(review.currentVersion.displayLabel) → \(review.release.version.displayLabel)")
                            .font(.blabee(.caption, weight: .semibold))
                        Text(PetL10n.text("Only Blabee restarts. Codex and Claude conversations will not be closed or replayed automatically.", korean: "Blabee만 재시작합니다. Codex·Claude 대화를 자동으로 종료하거나 다시 실행하지 않습니다."))
                        Text(PetL10n.text("If a pending approval or an incompatible connection prevents a safe restart, the update will wait briefly and show the action needed.", korean: "승인 대기나 호환되지 않는 연결이 있으면 잠시 기다린 뒤 필요한 조치를 안내합니다."))
                            .foregroundStyle(.secondary)
                        ForEach(review.blockers, id: \.self) { blocker in
                            Label(blocker, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        }
                        HStack(spacing: 10) {
                            Button(PetL10n.text("Retry Update", korean: "업데이트 다시 시도")) {
                                actionError = nil
                                Task { await installPreparedUpdate() }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!controller.canBeginInstallation)
                            .accessibilityIdentifier("confirm-automatic-update")
                            Button(PetL10n.text("Later", korean: "나중에")) { Task { await controller.cancel() } }
                                .disabled(!controller.canCancel)
                        }
                    }
                    .font(.blabee(.caption))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(4)
                }
            }

            if let actionError {
                Text(actionError).font(.blabee(.caption)).foregroundStyle(.orange)
            }
            if controller.phase == .preparing {
                Button(PetL10n.text("Cancel", korean: "취소")) { Task { await controller.cancel() } }
                    .disabled(!controller.canCancel)
            }
            if [.failed, .recoveryRequired].contains(controller.phase) {
                Button(PetL10n.text("Check Update Status", korean: "업데이트 상태 다시 확인")) {
                    controller.loadLastResult()
                }
            }
            Divider()
            PetUpdateManagedSessionsView(disabled: controller.isBusy)
        }
        .fixedSize(horizontal: false, vertical: true)
        .task(id: controller.phase == .updating) {
            controller.loadLastResult()
            while controller.phase == .updating, !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) }
                catch { return }
                controller.loadLastResult()
            }
        }
    }

    private func installPreparedUpdate() async {
        do {
            if try await controller.beginInstallation() {
                // The helper fenced new work before readiness. The existing
                // delegate closes the owned service; no conversation is stopped.
                PetAppUpdateTermination.request()
            }
        } catch { actionError = error.localizedDescription }
    }

    private var phaseTitle: String {
        switch controller.phase {
        case .idle: PetL10n.text("Waiting to update", korean: "업데이트 대기")
        case .preparing: PetL10n.text("Checking installation files", korean: "설치 파일 확인 중")
        case .review: PetL10n.text("Ready to update", korean: "업데이트 준비됨")
        case .waitingForSafePoint: PetL10n.text("Waiting for a safe restart", korean: "안전한 재시작 대기")
        case .deferred: PetL10n.text("Update waiting for your next action", korean: "업데이트 적용 보류")
        case .startingHelper: PetL10n.text("Preparing update helper", korean: "업데이트 도우미 준비 중")
        case .updating: PetL10n.text("Updating", korean: "업데이트 진행 중")
        case .succeeded: PetL10n.text("Update complete", korean: "업데이트 완료")
        case .failed: PetL10n.text("Unable to complete the update", korean: "업데이트를 완료하지 못했습니다")
        case .partialRestore: PetL10n.text("Check the restoration of some sessions", korean: "일부 세션의 복원을 확인해 주세요")
        case .recoveryRequired: PetL10n.text("Update recovery needs attention", korean: "업데이트 복구 확인 필요")
        }
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
                Text(PetL10n.text("This list contains only sessions opened through this setting, not every running Codex session. Updates keep these sessions running as well.", korean: "이 목록은 여기에서 연 관리 세션만 표시하며 실행 중인 모든 Codex 세션 수가 아닙니다. 업데이트 시 이 세션들도 종료하지 않습니다."))
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
