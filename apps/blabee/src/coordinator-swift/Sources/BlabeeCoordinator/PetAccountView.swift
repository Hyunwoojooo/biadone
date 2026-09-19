import SwiftUI

struct PetAccountView: View {
    @ObservedObject var controller: PetAccountController

    var body: some View {
        PetAccountStatusView(
            phase: controller.phase, message: controller.message,
            signIn: { provider in Task { await controller.signIn(provider) } },
            cancel: controller.cancelSignIn,
            signOut: { Task { await controller.signOut() } },
            retry: { Task { await controller.refresh() } }
        )
    }
}

struct PetAccountStatusView: View {
    let phase: PetAccountPhase
    let message: String
    let signIn: (PetAccountProvider) -> Void
    let cancel: () -> Void
    let signOut: () -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Blabee 계정", systemImage: "person.crop.circle")
                .font(.headline)
            switch phase {
            case .signedOut:
                Text("사용 중인 계정으로 로그인하세요.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                VStack(spacing: 8) {
                    providerButton(.google)
                    providerButton(.github)
                }
            case .checking:
                ProgressView("로그인 상태 확인 중…")
                    .controlSize(.small)
                Button("이 기기에서 로그아웃", action: signOut)
                    .accessibilityIdentifier("account-sign-out")
            case .authorizing(let provider):
                ProgressView("\(provider.displayName) 로그인 기다리는 중…")
                    .controlSize(.small)
                Text("브라우저에서 로그인을 완료하면 앱으로 돌아옵니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("로그인 취소", action: cancel)
                    .accessibilityIdentifier("account-cancel")
            case .signedIn(let user):
                Text("로그인한 이메일")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(user.email ?? "이메일 정보 없음")
                    .font(.callout)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("account-email")
                Button("이 기기에서 로그아웃", action: signOut)
                    .accessibilityIdentifier("account-sign-out")
            case .signingOut:
                ProgressView("로그아웃하는 중…")
                    .controlSize(.small)
            case .unavailable:
                Button("다시 확인", action: retry)
                    .accessibilityIdentifier("account-retry")
                Button("이 기기에서 로그아웃", action: signOut)
                    .accessibilityIdentifier("account-sign-out")
            }
            if !message.isEmpty {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("account-message")
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func providerButton(_ provider: PetAccountProvider) -> some View {
        Button { signIn(provider) } label: {
            Text("\(provider.displayName)로 계속하기")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 3)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("account-sign-in-\(provider.rawValue)")
    }
}
