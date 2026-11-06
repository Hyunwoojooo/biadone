import Foundation
import SwiftUI

enum PetProvider: Sendable, Equatable, Hashable {
    case codex
    case claude

    var displayName: String {
        switch self {
        case .codex: "Codex"
        case .claude: "Claude"
        }
    }

    /// Tool-specific tint so the source is recognizable before the name is
    /// read. Product names only; no third-party brand assets are bundled.
    func badgeTint(for scheme: ColorScheme) -> PetProviderBadgeTint {
        switch (self, scheme) {
        case (.claude, .dark): PetProviderBadgeTint(text: Self.rgb(0xf0b39d), background: Self.rgb(0xe88c6a, opacity: 0.22))
        case (.claude, _): PetProviderBadgeTint(text: Self.rgb(0xa04b2f), background: Self.rgb(0xc96442, opacity: 0.16))
        case (.codex, .dark): PetProviderBadgeTint(text: Self.rgb(0x9fe6cf), background: Self.rgb(0x34c8a0, opacity: 0.22))
        case (.codex, _): PetProviderBadgeTint(text: Self.rgb(0x0d7a60), background: Self.rgb(0x10a37f, opacity: 0.16))
        }
    }

    private static func rgb(_ hex: UInt32, opacity: Double = 1) -> Color {
        Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
              blue: Double(hex & 0xff) / 255, opacity: opacity)
    }
}

struct PetProviderBadgeTint: Equatable {
    let text: Color
    let background: Color
}

struct PetProviderMark: View {
    @ObservedObject private var localization = PetLocalization.shared
    @Environment(\.colorScheme) private var colorScheme
    let provider: PetProvider
    /// The tinted dot keeps the colour signal when the header has no room for the name.
    var compact = false

    var body: some View {
        let tint = provider.badgeTint(for: colorScheme)
        Group {
            if compact {
                Circle()
                    .fill(tint.text)
                    .frame(width: 8, height: 8)
                    .padding(4)
                    .background(tint.background, in: Circle())
            } else {
                Text(provider.displayName)
                    .font(.blabee(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(tint.text)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(tint.background, in: Capsule())
            }
        }
            .accessibilityLabel(PetL10n.text("Card from \(provider.displayName)", korean: "\(provider.displayName)에서 온 카드"))
            .accessibilityIdentifier("provider-source-mark")
            .help(PetL10n.text("Card from \(provider.displayName)", korean: "\(provider.displayName)에서 온 카드"))
    }
}

struct PetProviderStatus: Sendable, Equatable {
    let provider: PetProvider
    let scopeID: String
    let sessionID: String
    let cwd: String
    let bridgeConnected: Bool
    let ready: Bool
    let selectionEnabled: Bool
    let latestOutcome: PetProviderOutcome?
    let pendingReportCount: Int64

    init(provider: PetProvider, scopeID: String, sessionID: String, cwd: String,
         bridgeConnected: Bool, ready: Bool, selectionEnabled: Bool,
         latestOutcome: PetProviderOutcome?, pendingReportCount: Int64 = 0) {
        self.provider = provider
        self.scopeID = scopeID
        self.sessionID = sessionID
        self.cwd = cwd
        self.bridgeConnected = bridgeConnected
        self.ready = ready
        self.selectionEnabled = selectionEnabled
        self.latestOutcome = latestOutcome
        self.pendingReportCount = pendingReportCount
    }
}

/// A historical model report belongs to its original selection and prompt;
/// displaying it never completes or alters a currently offered successor.
struct PetProviderOutcome: Sendable, Equatable {
    let selectionID: String
    let sourcePromptID: String
    let status: String
    let summary: String
}

enum PetSelectionOutcome: Sendable, Equatable {
    case pause
    case nextTurn
    case channelPending
}
