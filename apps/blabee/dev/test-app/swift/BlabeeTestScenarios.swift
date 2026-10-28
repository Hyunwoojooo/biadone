#if BLABEE_TEST_APP
import Foundation

/// M1 fixtures and the explicitly selected M2 Engine mode never connect a live provider.
enum BlabeeTestScenario: String, Codable, CaseIterable, Sendable {
    case freshInstall
    case codexMissing
    case pluginPreparing
    case hookPending
    case connectionFailed
    case connected
    case delayedResponse
    case loginCancelled
    case loginFailed
    case engineIsolation

    var usesRealEngine: Bool { self == .engineIsolation }

    var displayName: String {
        switch self {
        case .freshInstall: "Fresh install"
        case .codexMissing: "Codex not installed"
        case .pluginPreparing: "Plugin preparing"
        case .hookPending: "Hook review pending"
        case .connectionFailed: "Connection failed"
        case .connected: "Connected (simulated)"
        case .delayedResponse: "Delayed response"
        case .loginCancelled: "Login cancelled"
        case .loginFailed: "Login failed"
        case .engineIsolation: "Isolated Engine (M2)"
        }
    }

    var summary: String {
        switch self {
        case .freshInstall: "Replay the tutorial, simulated login, terms, and connection setup."
        case .codexMissing: "Show installation guidance without inspecting or installing Codex."
        case .pluginPreparing: "Show preparation, cancellation, and duplicate-action protection."
        case .hookPending: "Show Hook review guidance and a simulated return check."
        case .connectionFailed: "Show a recoverable connection error and a simulated retry."
        case .connected: "Show a simulated connection and cards without starting the Engine."
        case .delayedResponse: "Exercise cancellation and responses arriving after a run changes."
        case .loginCancelled: "Return from simulated login without creating an account session."
        case .loginFailed: "Show a simulated login error and recovery action."
        case .engineIsolation: "Validate the real Engine with run-owned storage and authority, without a provider connection."
        }
    }
}
#endif
