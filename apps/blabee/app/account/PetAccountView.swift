import SwiftUI

struct PetAccountView: View {
    @ObservedObject private var localization = PetLocalization.shared
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
    @ObservedObject private var localization = PetLocalization.shared
    let phase: PetAccountPhase
    let message: String
    let signIn: (PetAccountProvider) -> Void
    let cancel: () -> Void
    let signOut: () -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(PetL10n.text("Blabee Account", korean: "Blabee 계정"), systemImage: "person.crop.circle")
                .font(.blabee(.headline))
            switch phase {
            case .signedOut:
                Text(PetL10n.text("Sign in with an account you already use.", korean: "사용 중인 계정으로 로그인하세요."))
                    .font(.blabee(.callout))
                    .foregroundStyle(.secondary)
                VStack(spacing: 8) {
                    providerButton(.google)
                    providerButton(.github)
                }
            case .checking:
                ProgressView(PetL10n.text("Checking sign-in status…", korean: "로그인 상태 확인 중…"))
                    .controlSize(.small)
                Button(PetL10n.text("Sign Out on This Device", korean: "이 기기에서 로그아웃"), action: signOut)
                    .accessibilityIdentifier("account-sign-out")
            case .authorizing(let provider):
                ProgressView(PetL10n.text("Waiting for \(provider.displayName) sign-in…", korean: "\(provider.displayName) 로그인 기다리는 중…"))
                    .controlSize(.small)
                Text(PetL10n.text("Complete sign-in in your browser to return to the app.", korean: "브라우저에서 로그인을 완료하면 앱으로 돌아옵니다."))
                    .font(.blabee(.caption))
                    .foregroundStyle(.secondary)
                Button(PetL10n.text("Cancel Sign-In", korean: "로그인 취소"), action: cancel)
                    .accessibilityIdentifier("account-cancel")
            case .signedIn(let user):
                Text(PetL10n.text("Signed-in email", korean: "로그인한 이메일"))
                    .font(.blabee(.caption))
                    .foregroundStyle(.secondary)
                Text(user.email ?? PetL10n.text("No email available", korean: "이메일 정보 없음"))
                    .font(.blabee(.callout))
                    .textSelection(.enabled)
                    .accessibilityIdentifier("account-email")
                Button(PetL10n.text("Sign Out on This Device", korean: "이 기기에서 로그아웃"), action: signOut)
                    .accessibilityIdentifier("account-sign-out")
            case .signingOut:
                ProgressView(PetL10n.text("Signing out…", korean: "로그아웃하는 중…"))
                    .controlSize(.small)
            case .unavailable:
                Button(PetL10n.text("Check Again", korean: "다시 확인"), action: retry)
                    .accessibilityIdentifier("account-retry")
                Button(PetL10n.text("Sign Out on This Device", korean: "이 기기에서 로그아웃"), action: signOut)
                    .accessibilityIdentifier("account-sign-out")
            }
            if !message.isEmpty {
                Text(message)
                    .font(.blabee(.caption))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("account-message")
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func providerButton(_ provider: PetAccountProvider) -> some View {
        Button { signIn(provider) } label: {
            Text(PetL10n.text("Continue with \(provider.displayName)", korean: "\(provider.displayName)로 계속하기"))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 3)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("account-sign-in-\(provider.rawValue)")
    }
}
