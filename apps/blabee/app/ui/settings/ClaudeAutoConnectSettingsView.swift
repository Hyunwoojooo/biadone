import SwiftUI

/// One explicit opt-in controls only future shell invocations. The ordinary
/// service controls remain in the parent view and retain their own lifecycle.
struct ClaudeAutoConnectSettingsView: View {
    let serviceReady: Bool
    private let setup: ClaudeAutoConnectSetup
    @State private var inspection: ClaudeAutoConnectSetup.Inspection?
    @State private var busy = false

    init(serviceReady: Bool, setup: ClaudeAutoConnectSetup = .live()) {
        self.serviceReady = serviceReady
        self.setup = setup
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Claude 터미널 자동 연결").font(.body.weight(.semibold))
            Text("한 번 켜면 새 터미널에서 claude 또는 claude --resume을 실행할 때 Blabee가 연결됩니다.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text("zsh 시작 설정(.zshrc)에 Blabee 경로를 추가합니다. 이미 열린 터미널에는 새 창을 열어 적용하세요.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let inspection {
                Text(inspection.detail).font(.caption).fixedSize(horizontal: false, vertical: true)
            }
            if !serviceReady, inspection?.isEnabled != true {
                Text("먼저 앱 실행형 서비스를 연결해 주세요.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                if inspection?.isEnabled == true {
                    Button("자동 연결 끄기") { change(enable: false) }
                        .disabled(busy || inspection?.canDisable != true)
                } else {
                    Button("자동 연결 켜기") { change(enable: true) }
                        .disabled(busy || !serviceReady || inspection?.canEnable != true)
                }
                Button("다시 확인") { refresh() }.disabled(busy)
                if busy { ProgressView().controlSize(.small) }
            }
            .buttonStyle(.bordered).petCapsuleButtonBorder()
        }
        .task { inspection = await setup.inspect() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("claude-auto-connect-settings")
    }

    private func change(enable: Bool) {
        guard !busy else { return }
        busy = true
        Task {
            inspection = enable ? await setup.enable() : await setup.disable()
            busy = false
        }
    }

    private func refresh() {
        guard !busy else { return }
        busy = true
        Task { inspection = await setup.inspect(); busy = false }
    }
}
