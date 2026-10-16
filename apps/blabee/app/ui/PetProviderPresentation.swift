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

    /// Familiar SF Symbols identify the source without bundling third-party
    /// brand assets or implying that these are the providers' official logos.
    var symbolName: String {
        switch self {
        case .codex: "terminal.fill"
        case .claude: "asterisk"
        }
    }
}

struct PetProviderMark: View {
    @ObservedObject private var localization = PetLocalization.shared
    let provider: PetProvider

    var body: some View {
        Image(systemName: provider.symbolName)
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 18, height: 20)
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
