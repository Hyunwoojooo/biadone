import AppKit
import SwiftUI

@MainActor
struct PetAutomaticAppUpdateView: View {
    @ObservedObject var controller: AppUpdateTransactionController
    let release: PetAppUpdateRelease?
    @State private var actionError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let release {
                if release.installerAssets != nil {
                    Button("업데이트") {
                        actionError = nil
                        Task { await controller.prepare(release) }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(controller.isBusy || controller.preparedReview != nil)
                    .accessibilityIdentifier("prepare-app-update")
                } else {
                    Text(release.installerUnavailableReason ?? "이 릴리스에는 자동 설치 파일이 없습니다. 릴리스 페이지를 확인해 주세요.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            if controller.phase != .idle {
                HStack(alignment: .top, spacing: 8) {
                    if controller.isBusy { ProgressView().controlSize(.small) }
                    VStack(alignment: .leading, spacing: 5) {
                        Text(phaseTitle).font(.callout.weight(.semibold))
                        Text(controller.detail).font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("automatic-update-status")
            }

            if let review = controller.preparedReview {
                GroupBox("종료·복원할 작업 확인") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(review.currentVersion.displayLabel) → \(review.release.version.displayLabel)")
                            .font(.caption.weight(.semibold))
                        Text("Blabee와 관리 중인 Codex \(review.sessions.count)개를 종료한 뒤 업데이트하고 복원합니다. 진행 중인 작업과 승인 요청은 먼저 마쳐 주세요.")
                        Text("저장된 대화와 작업 폴더를 복원합니다. 전송하지 않은 입력 초안은 유지되지 않으므로 먼저 따로 저장해 주세요.")
                            .foregroundStyle(.secondary)
                        ForEach(review.sessions) { session in
                            Text("• \(URL(fileURLWithPath: session.cwd).lastPathComponent)")
                        }
                        ForEach(review.blockers, id: \.self) { blocker in
                            Label(blocker, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        }
                        HStack(spacing: 10) {
                            Button("종료하고 업데이트") {
                                actionError = nil
                                Task {
                                    do {
                                        if try await controller.beginInstallation() {
                                            // Existing delegate waits for its owned service to
                                            // shut down. The copied helper waits for this PID.
                                            NSApplication.shared.terminate(nil)
                                        }
                                    } catch { actionError = error.localizedDescription }
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!controller.canBeginInstallation)
                            .accessibilityIdentifier("confirm-automatic-update")
                            Button("취소") { Task { await controller.cancel() } }
                                .disabled(controller.isBusy)
                        }
                    }
                    .font(.caption)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(4)
                }
            }

            if let actionError {
                Text(actionError).font(.caption).foregroundStyle(.orange)
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

    private var phaseTitle: String {
        switch controller.phase {
        case .idle: "업데이트 대기"
        case .preparing: "설치 파일 확인 중"
        case .review: "업데이트 준비됨"
        case .startingHelper: "업데이트 도우미 준비 중"
        case .updating: "업데이트 진행 중"
        case .succeeded: "업데이트와 세션 복원 완료"
        case .failed: "업데이트를 완료하지 못했습니다"
        case .partialRestore: "일부 세션의 복원을 확인해 주세요"
        case .recoveryRequired: "업데이트 복구 확인 필요"
        }
    }
}

@MainActor
private struct PetUpdateManagedSessionsView: View {
    let disabled: Bool
    @State private var expanded = false
    @State private var sessions: [UpdateManagedSession] = []
    @State private var message: String?
    @State private var busy = false
    @State private var resumeID = ""
    private let manager = UpdateManagedCodexSessions.live()

    var body: some View {
        DisclosureGroup("Codex 자동 복원 설정", isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Blabee에서 연 관리 세션은 업데이트 후 원래 터미널에서 이어집니다. 원래 터미널을 사용할 수 없으면 Terminal의 새 창에 복원합니다.")
                Text("기존 대화를 이어가려면 Codex의 /status에서 세션 ID를 확인하고 정상 종료한 뒤 아래에 입력하세요. 새 대화는 비워 두세요.")
                    .foregroundStyle(.secondary)
                TextField("기존 세션 ID (선택)", text: $resumeID)
                    .textFieldStyle(.roundedBorder)
                    .disabled(disabled || busy)
                    .accessibilityIdentifier("update-managed-resume-id")
                HStack(spacing: 10) {
                    Button("프로젝트를 선택해 관리 세션 열기", action: openManagedSession)
                        .disabled(disabled || busy)
                        .accessibilityIdentifier("open-update-managed-session")
                    Button("목록 새로 고침") { Task { await refresh() } }
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
            .font(.caption)
            .padding(.top, 8)
        }
        .font(.callout)
    }

    private func openManagedSession() {
        let input = resumeID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard input.isEmpty || UUID(uuidString: input) != nil else {
            message = "기존 대화의 세션 ID를 정확히 입력해 주세요. 새 대화는 비워 두면 됩니다."
            return
        }
        let chooser = NSOpenPanel()
        chooser.canChooseDirectories = true
        chooser.canChooseFiles = false
        chooser.allowsMultipleSelection = false
        chooser.prompt = "관리 세션 열기"
        chooser.message = input.isEmpty ? "Codex에서 작업할 프로젝트 폴더를 선택하세요."
            : "기존 Codex 대화에서 사용하던 프로젝트 폴더를 선택하세요."
        guard chooser.runModal() == .OK, let project = chooser.url else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await manager.openSession(cwd: project, resumeThreadID: input.isEmpty ? nil : input)
                message = input.isEmpty ? "Terminal에서 새 Codex 관리 세션이 시작됩니다."
                    : "Terminal에서 지정한 Codex 대화를 이어갑니다."
                sessions = try await manager.sessions()
            } catch { message = error.localizedDescription }
        }
    }

    private func refresh() async {
        busy = true
        defer { busy = false }
        do {
            sessions = try await manager.sessions()
            message = sessions.isEmpty ? "현재 Blabee가 관리하는 Codex 세션이 없습니다." : nil
        } catch { message = error.localizedDescription }
    }

    private func stateTitle(_ session: UpdateManagedSession) -> String {
        switch session.state {
        case .starting: "시작 중"
        case .pausing: "대화 저장 중"
        case .resuming: "복원 중"
        case .running: "연결됨"
        case .busy: "작업 중"
        case .paused: "업데이트 복원 대기"
        case .failed: "확인 필요"
        }
    }
}
