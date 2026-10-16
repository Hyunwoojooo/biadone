import AppKit
import SwiftUI
import Testing
@testable import BlabeeCoordinator

@Suite("Pet account view", .petLanguage(.korean))
struct PetAccountViewTests {
    init() throws { try PetTypographyTestResources.register() }

    @Test("Account states render at normal and narrow widths in both appearances")
    @MainActor
    func rendersAccountStates() throws {
        let user = PetAccountUser(id: "11111111-1111-4111-8111-111111111111", email: "account@example.test")
        let missingEmail = PetAccountUser(id: user.id, email: nil)
        let longEmail = PetAccountUser(
            id: user.id,
            email: String(repeating: "very.long.account.name.", count: 6) + "@example.test"
        )
        let longError = String(
            repeating: "계정에 연결하지 못했습니다. 인터넷 연결과 macOS 키체인 접근을 확인하고 다시 시도해주세요. ",
            count: 8
        )
        let states: [(String, PetAccountPhase, String)] = [
            ("signed-out", .signedOut, ""),
            ("checking", .checking, ""),
            ("google", .authorizing(.google), ""),
            ("github", .authorizing(.github), ""),
            ("signed-in", .signedIn(user), ""),
            ("missing-email", .signedIn(missingEmail), ""),
            ("long-email", .signedIn(longEmail), ""),
            ("signing-out", .signingOut, ""),
            ("unavailable", .unavailable, longError),
            ("cancelled", .signedOut, "로그인을 취소했습니다."),
        ]

        for width in [384.0, 260.0] {
            for dark in [false, true] {
                let compact = hosting(.unavailable, message: "", width: width, dark: dark)
                let expanded = hosting(.unavailable, message: longError, width: width, dark: dark)
                #expect(expanded.fittingSize.height > compact.fittingSize.height + 100)

                let shortEmail = hosting(.signedIn(user), message: "", width: width, dark: dark)
                let wrappedEmail = hosting(.signedIn(longEmail), message: "", width: width, dark: dark)
                #expect(wrappedEmail.fittingSize.height > shortEmail.fittingSize.height + 10)

                for (name, phase, message) in states {
                    let host = hosting(phase, message: message, width: width, dark: dark)
                    let size = host.fittingSize
                    #expect(abs(size.width - width) < 0.01)
                    #expect(size.height > 0 && size.height.isFinite)
                    host.frame = NSRect(origin: .zero, size: size)
                    host.layoutSubtreeIfNeeded()
                    let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                    host.effectiveAppearance.performAsCurrentDrawingAppearance {
                        host.cacheDisplay(in: host.bounds, to: bitmap)
                    }
                    #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
                    if let directory = ProcessInfo.processInfo.environment["BLABEE_ACCOUNT_RENDER_DIRECTORY"] {
                        let data = try #require(bitmap.representation(using: .png, properties: [:]))
                        try data.write(to: URL(fileURLWithPath: directory, isDirectory: true)
                            .appendingPathComponent("account-\(name)-\(Int(width))-\(dark ? "dark" : "light").png"))
                    }
                }
            }
        }
    }

    @MainActor
    private func hosting(
        _ phase: PetAccountPhase,
        message: String,
        width: CGFloat,
        dark: Bool
    ) -> NSHostingView<some View> {
        let view = PetAccountStatusView(
            phase: phase, message: message,
            signIn: { _ in }, cancel: {}, signOut: {}, retry: {}
        )
        .padding(16)
        .frame(width: width, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .environment(\.colorScheme, dark ? .dark : .light)
        .background(dark ? Color.black : Color.white)
        let host = NSHostingView(rootView: view)
        host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        return host
    }
}
