import SwiftUI

struct PetHookReadinessView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var viewModel: PetViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(PetL10n.text("Hook trust · \(viewModel.codexHookReadiness.title)", korean: "Hook 신뢰 · \(viewModel.codexHookReadiness.title)"), systemImage: "checkmark.shield")
                .font(.blabee(.caption, weight: .semibold))
                .accessibilityIdentifier("hook-readiness-status")
            if viewModel.hookReadinessProjectPaths.count > 1 {
                Picker(PetL10n.text("Project to check", korean: "확인할 프로젝트"), selection: Binding(
                    get: { viewModel.hookReadinessProjectPath ?? "" },
                    set: { viewModel.selectHookProject($0) }
                )) {
                    ForEach(viewModel.hookReadinessProjectPaths, id: \.self) { path in
                        Text(path).tag(path)
                    }
                }.font(.blabee(.caption))
            } else if let path = viewModel.hookReadinessProjectPath {
                Text(path).font(.blabee(.caption2)).foregroundStyle(.secondary)
                    .lineLimit(2).truncationMode(.middle).help(path)
            }
            Text(viewModel.codexHookReadiness.detail)
                .font(.blabee(.caption)).foregroundStyle(.secondary)
            if viewModel.hookReadinessProjectPath == nil {
                Text(PetL10n.text("First add the project you will use with Codex.", korean: "먼저 Codex에서 작업할 프로젝트를 추가하세요."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            HStack {
                Button(PetL10n.text("Check Hook Status", korean: "Hook 상태 확인")) { Task { await viewModel.checkCodexHooks() } }
                    .disabled(!viewModel.canCheckCodexHooks)
                    .accessibilityIdentifier("check-hook-readiness")
                if viewModel.isCodexHookCheckInFlight { ProgressView().controlSize(.small) }
            }
            Text(PetL10n.text("Open /hooks in Codex, review Blabee's SessionStart, UserPromptSubmit, Stop, and PermissionRequest Hooks, then check again.", korean: "Codex에서 /hooks를 열어 Blabee의 SessionStart · UserPromptSubmit · Stop · PermissionRequest를 검토한 뒤 다시 확인하세요."))
                .font(.blabee(.caption2)).foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text(PetL10n.text("For Codex windows that were already open, start a new session or reopen with codex resume before checking. This checks only the selected project's current settings.", korean: "이미 열려 있던 Codex는 새 세션이나 codex resume으로 다시 연 뒤 확인하세요. 이 검사는 선택한 프로젝트의 현재 설정만 확인합니다."))
                .font(.blabee(.caption2)).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}

struct PetStorageRecoveryView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var viewModel: PetViewModel
    var showsIntroduction = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if showsIntroduction {
                Text(PetL10n.text("Storage Recovery", korean: "저장소 복구")).font(.blabee(.callout, weight: .bold))
                Text(PetL10n.text("Use this when the service fails to start after storage files were deleted. A fresh start is available only when both the DB and authentication key are missing.", korean: "저장 파일을 삭제한 뒤 서비스가 시작되지 않을 때 사용합니다. DB와 인증 키가 모두 없는 경우만 새로 시작할 수 있습니다."))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            }
            if let receipt = viewModel.storageRecoveryReceipt {
                Text(PetL10n.text("Previous verification records were archived. Continue by checking the service connection and Codex settings.", korean: "이전 검증 기록을 보관했습니다. 서비스 연결과 Codex 설정을 이어서 확인하세요."))
                    .font(.blabee(.caption))
                Text(receipt.backupDirectoryURL.path)
                    .font(.blabee(.caption2)).textSelection(.enabled)
                Text(PetL10n.text("Current service: \(viewModel.appOwnedServiceState.title)", korean: "현재 서비스: \(viewModel.appOwnedServiceState.title)"))
                    .font(.blabee(.caption)).foregroundStyle(.secondary)
            } else if let confirmation = viewModel.storageRecoveryConfirmation {
                Text(PetL10n.text("Deleted task history cannot be restored. Remaining storage files and previous Keychain verification records will be archived, then the service will restart with empty storage. Existing project settings and sign-in information will be kept.", korean: "삭제된 작업 이력은 돌아오지 않습니다. 남은 저장 파일과 이전 Keychain 검증 기록을 보관하고, 빈 저장소로 서비스를 다시 시작합니다. 남아 있는 프로젝트 설정과 로그인 정보는 유지합니다."))
                    .font(.blabee(.caption))
                    .accessibilityIdentifier("storage-recovery-confirmation")
                Text(PetL10n.text("Archive location: \(confirmation.backupDirectoryURL.path)", korean: "보관 위치: \(confirmation.backupDirectoryURL.path)"))
                    .font(.blabee(.caption2)).foregroundStyle(.secondary).textSelection(.enabled)
                HStack {
                    Button(PetL10n.text("Cancel", korean: "취소"), action: viewModel.cancelStorageRecovery)
                    Button(PetL10n.text("Archive and Start Fresh", korean: "보관하고 새로 시작")) { Task { await viewModel.confirmStorageRecovery() } }
                        .disabled(!viewModel.canPrepareStorageRecovery)
                        .accessibilityIdentifier("confirm-storage-recovery")
                }
            } else {
                Button(PetL10n.text("Check Recovery Eligibility", korean: "복구 가능 여부 확인")) { Task { await viewModel.prepareStorageRecovery() } }
                    .buttonStyle(PetOnboardingActionButtonStyle(emphasized: !showsIntroduction))
                    .disabled(!viewModel.canPrepareStorageRecovery)
                    .accessibilityIdentifier("prepare-storage-recovery")
                if !viewModel.canPrepareStorageRecovery && !viewModel.isStorageRecoveryOperationInFlight {
                    Text(PetL10n.text("Check after the service has completely stopped and auto-start registration has been removed.", korean: "서비스가 완전히 중지되고 자동 시작 등록이 해제된 상태에서 확인할 수 있습니다."))
                        .font(.blabee(.caption2)).foregroundStyle(.secondary)
                }
            }
            if viewModel.isStorageRecoveryOperationInFlight {
                ProgressView(PetL10n.text("Checking storage", korean: "저장소 확인 중")).controlSize(.small)
            }
            if let error = viewModel.storageRecoveryError {
                Text(error).font(.blabee(.caption)).foregroundStyle(.red).textSelection(.enabled)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}
