import Foundation

enum PetProvider: Sendable, Equatable, Hashable {
    case codex
    case claude

    var displayName: String {
        switch self {
        case .codex: "Codex"
        case .claude: "Claude"
        }
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
