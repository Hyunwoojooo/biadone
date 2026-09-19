import SwiftUI

struct PetHookReadinessView: View {
    @ObservedObject var viewModel: PetViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Hook 신뢰 · \(viewModel.codexHookReadiness.title)", systemImage: "checkmark.shield")
                .font(.caption.weight(.semibold))
                .accessibilityIdentifier("hook-readiness-status")
            if viewModel.hookReadinessProjectPaths.count > 1 {
                Picker("확인할 프로젝트", selection: Binding(
                    get: { viewModel.hookReadinessProjectPath ?? "" },
                    set: { viewModel.selectHookProject($0) }
                )) {
                    ForEach(viewModel.hookReadinessProjectPaths, id: \.self) { path in
                        Text(path).tag(path)
                    }
                }.font(.caption)
            } else if let path = viewModel.hookReadinessProjectPath {
                Text(path).font(.caption2).foregroundStyle(.secondary)
                    .lineLimit(2).truncationMode(.middle).help(path)
            }
            Text(viewModel.codexHookReadiness.detail)
                .font(.caption).foregroundStyle(.secondary)
            if viewModel.hookReadinessProjectPath == nil {
                Text("먼저 Codex에서 작업할 프로젝트를 추가하세요.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button("Hook 상태 확인") { Task { await viewModel.checkCodexHooks() } }
                    .disabled(!viewModel.canCheckCodexHooks)
                    .accessibilityIdentifier("check-hook-readiness")
                if viewModel.isCodexHookCheckInFlight { ProgressView().controlSize(.small) }
            }
            Text("Codex에서 /hooks를 열어 Blabee의 SessionStart · UserPromptSubmit · Stop · PermissionRequest를 검토한 뒤 다시 확인하세요.")
                .font(.caption2).foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text("이미 열려 있던 Codex는 새 세션이나 codex resume으로 다시 연 뒤 확인하세요. 이 검사는 선택한 프로젝트의 현재 설정만 확인합니다.")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}

struct PetStorageRecoveryView: View {
    @ObservedObject var viewModel: PetViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("저장소 복구").font(.callout.bold())
            Text("저장 파일을 삭제한 뒤 서비스가 시작되지 않을 때 사용합니다. DB와 인증 키가 모두 없는 경우만 새로 시작할 수 있습니다.")
                .font(.caption).foregroundStyle(.secondary)
            if let receipt = viewModel.storageRecoveryReceipt {
                Text("이전 검증 기록을 보관했습니다. 서비스 연결과 Codex 설정을 이어서 확인하세요.")
                    .font(.caption)
                Text(receipt.backupDirectoryURL.path)
                    .font(.caption2).textSelection(.enabled)
                Text("현재 서비스: \(viewModel.appOwnedServiceState.title)")
                    .font(.caption).foregroundStyle(.secondary)
            } else if let confirmation = viewModel.storageRecoveryConfirmation {
                Text("삭제된 작업 이력은 돌아오지 않습니다. 남은 저장 파일과 이전 Keychain 검증 기록을 보관하고, 빈 저장소로 서비스를 다시 시작합니다. 남아 있는 프로젝트 설정과 로그인 정보는 유지합니다.")
                    .font(.caption)
                    .accessibilityIdentifier("storage-recovery-confirmation")
                Text("보관 위치: \(confirmation.backupDirectoryURL.path)")
                    .font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
                HStack {
                    Button("취소", action: viewModel.cancelStorageRecovery)
                    Button("보관하고 새로 시작") { Task { await viewModel.confirmStorageRecovery() } }
                        .disabled(!viewModel.canPrepareStorageRecovery)
                        .accessibilityIdentifier("confirm-storage-recovery")
                }
            } else {
                Button("복구 가능 여부 확인") { Task { await viewModel.prepareStorageRecovery() } }
                    .disabled(!viewModel.canPrepareStorageRecovery)
                    .accessibilityIdentifier("prepare-storage-recovery")
                if !viewModel.canPrepareStorageRecovery && !viewModel.isStorageRecoveryOperationInFlight {
                    Text("서비스가 완전히 중지되고 자동 시작 등록이 해제된 상태에서 확인할 수 있습니다.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            if viewModel.isStorageRecoveryOperationInFlight {
                ProgressView("저장소 확인 중").controlSize(.small)
            }
            if let error = viewModel.storageRecoveryError {
                Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .contain)
    }
}
