import SwiftUI

/// Recovery is deliberately separate from Plugin migration and native rechecks.
struct LegacyCodexShellCleanupView: View {
    @ObservedObject var viewModel: PetViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("구형 셸 연결 정리", systemImage: "terminal")
                    .font(.body.weight(.semibold))
                Spacer()
                if viewModel.isLegacyShellCleanupOperationInFlight {
                    ProgressView().controlSize(.small)
                        .accessibilityLabel("구형 셸 연결 확인 중")
                }
            }
            Text("예전 Blabee가 codex 명령을 감싸던 설정만 확인합니다. Codex 설치·대화 기록·Plugin 연결은 변경하지 않습니다.")
                .font(.caption).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let inspection = viewModel.legacyShellCleanupInspection {
                Text(inspection.title).font(.callout.weight(.medium))
                Text(inspection.detail)
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let path = inspection.wrapperPath { pathRow("구형 래퍼", path: path) }
                if let path = inspection.startupPath { pathRow("셸 설정 (변경 안 함)", path: path) }
                if let path = inspection.backupPath { pathRow("보존된 백업", path: path) }
            }

            if let confirmation = viewModel.legacyShellCleanupConfirmation {
                VStack(alignment: .leading, spacing: 10) {
                    Text("이 래퍼만 백업하고 비활성화할까요?")
                        .font(.callout.weight(.semibold))
                    Text(confirmation.detail)
                        .font(.caption).fixedSize(horizontal: false, vertical: true)
                    Text(".zshrc는 그대로 둡니다. 정리 후 같은 셸 설정을 사용하는 새 터미널에서 Codex를 확인하세요. 이미 열린 세션은 종료하지 않습니다.")
                        .font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button("백업 후 비활성화") {
                            Task { await viewModel.confirmLegacyShellCleanup() }
                        }
                        .buttonStyle(.borderedProminent)
                        Button("취소") { viewModel.cancelLegacyShellCleanup() }
                            .buttonStyle(.bordered)
                    }
                }
                .padding(12)
                .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            } else {
                HStack {
                    Button("구형 연결 검사") {
                        Task { await viewModel.inspectLegacyShellCleanup() }
                    }
                    .buttonStyle(.bordered)
                    if viewModel.legacyShellCleanupInspection?.canPrepare == true {
                        Button("정리 내용 확인") {
                            Task { await viewModel.prepareLegacyShellCleanup() }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        }
        .disabled(viewModel.isLegacyShellCleanupOperationInFlight)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 20))
    }

    private func pathRow(_ label: String, path: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(path).font(.caption2.monospaced()).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
