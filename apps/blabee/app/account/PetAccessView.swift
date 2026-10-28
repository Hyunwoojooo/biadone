import SwiftUI

extension PetAccessState {
    var title: String {
        switch self {
        case .signedOut: PetL10n.text("Sign-in required", korean: "로그인이 필요합니다")
        case .checking: PetL10n.text("Checking access", korean: "사용 권한 확인 중")
        case .active: PetL10n.text("Blabee is available", korean: "Blabee 사용 가능")
        case .suspended: PetL10n.text("Account access suspended", korean: "계정 사용이 중지되었습니다")
        case .servicePaused: PetL10n.text("Blabee service paused", korean: "Blabee 서비스가 일시 중지되었습니다")
        case .socialLoginRequired: PetL10n.text("Social sign-in required", korean: "소셜 로그인이 필요합니다")
        case .unavailable: PetL10n.text("Unable to verify access", korean: "사용 권한을 확인하지 못했습니다")
        case .expired: PetL10n.text("Verify access again", korean: "사용 권한을 다시 확인해 주세요")
        }
    }

    var detail: String {
        switch self {
        case .signedOut: PetL10n.text("Sign in with Google or GitHub to use Blabee.", korean: "Google 또는 GitHub로 로그인하면 Blabee를 사용할 수 있습니다.")
        case .checking: PetL10n.text("Checking access for the signed-in account.", korean: "로그인한 계정의 사용 권한을 확인하고 있습니다.")
        case .active: PetL10n.text("Access for the signed-in account is verified.", korean: "로그인한 계정의 사용 권한이 확인되었습니다.")
        case .suspended: PetL10n.text("An administrator suspended Blabee access for this account. Contact the administrator for help.", korean: "관리자가 이 계정의 Blabee 사용을 중지했습니다. 도움이 필요하면 관리자에게 문의해 주세요.")
        case .servicePaused: PetL10n.text("An administrator temporarily paused the service for everyone. Check again when the service resumes.", korean: "관리자가 전체 서비스 사용을 잠시 중지했습니다. 서비스가 다시 열리면 확인해 주세요.")
        case .socialLoginRequired: PetL10n.text("Sign out of this account, then sign in again with Google or GitHub.", korean: "현재 계정에서 로그아웃한 뒤 Google 또는 GitHub로 다시 로그인해 주세요.")
        case .unavailable: PetL10n.text("Check your internet and Blabee service connection, then try again.", korean: "인터넷과 Blabee 서비스 연결을 확인한 뒤 다시 시도해 주세요.")
        case .expired: PetL10n.text("Your verified access has expired. Verify it again to continue.", korean: "확인된 사용 권한의 유효 시간이 끝났습니다. 다시 확인한 뒤 사용할 수 있습니다.")
        }
    }
}

struct PetAccessStatusView: View {
    @ObservedObject private var localization = PetLocalization.shared
    let state: PetAccessState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(state.title, systemImage: state == .active ? "checkmark.shield" : "lock.shield")
                .font(.blabee(.headline))
            Text(state.detail)
                .font(.blabee(.callout))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if state == .checking { ProgressView().controlSize(.small) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("product-access-" + state.rawValue)
    }
}

/// A separate access screen; it never changes first-run completion or advances
/// the tutorial. Settings and diagnostics remain available while blocked.
struct PetAccessView: View {
    @ObservedObject private var localization = PetLocalization.shared
    @ObservedObject var controller: PetAccessController
    let account: PetAccountController?
    let settings: () -> Void
    let diagnostics: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                PetAccessStatusView(state: controller.effectiveState)
                if let account { PetAccountView(controller: account) }
                if controller.effectiveState != .signedOut && controller.effectiveState != .checking {
                    Button(PetL10n.text("Check Again", korean: "다시 확인")) {
                        Task {
                            await account?.refresh()
                            controller.refresh()
                        }
                    }
                    .accessibilityIdentifier("product-access-retry")
                }
                HStack(spacing: 16) {
                    Button(PetL10n.text("Settings", korean: "설정"), action: settings)
                        .accessibilityIdentifier("product-access-settings")
                    Button(PetL10n.text("Diagnostics", korean: "진단"), action: diagnostics)
                        .accessibilityIdentifier("product-access-diagnostics")
                }
            }
            .padding(.bottom, 4)
        }
        .accessibilityIdentifier("product-access-screen")
    }
}
