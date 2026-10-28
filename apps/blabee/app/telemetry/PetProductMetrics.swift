import Foundation

enum PetProductMetricKind: String, CaseIterable, Codable, Sendable {
    case environmentObserved = "environment_observed"
    case accountReady = "account_ready"
    case serviceConnected = "service_connected"
    case cardReceived = "card_received"
    case firstAction = "first_action"
    case featureStarted = "feature_started"
    case featureSucceeded = "feature_succeeded"
    case featureFailed = "feature_failed"
    case featureCancelled = "feature_cancelled"
    case updateAvailable = "update_available"
    case updateStarted = "update_started"
    case updateSucceeded = "update_succeeded"
    case updateFailed = "update_failed"
    case updateCancelled = "update_cancelled"

    var isMilestone: Bool {
        [.accountReady, .serviceConnected, .cardReceived, .firstAction].contains(self)
    }
}

enum PetProductFeature: String, Codable, Sendable {
    case none, choice, approval, dismiss
    case appUpdate = "app_update"
}

enum PetProductInputMethod: String, Codable, Sendable { case none, button, keyboard }
enum PetProductUILanguage: String, Codable, Sendable { case ko, en, other, unknown }
enum PetProductOutcome: Equatable, Sendable { case succeeded, failed, cancelled }

enum PetProductLatencyBucket: String, Codable, Sendable {
    case none
    case under1s = "under_1s"
    case oneTo3s = "1_to_3s"
    case over3s = "over_3s"
    case unknown

    static func elapsed(_ seconds: TimeInterval) -> Self {
        guard seconds.isFinite, seconds >= 0 else { return .unknown }
        if seconds < 1 { return .under1s }
        if seconds <= 3 { return .oneTo3s }
        return .over3s
    }
}

/// This local consent identity is never included in a telemetry request. Update
/// recovery uses it to reject work from a previous account or consent period.
struct PetProductIdentity: Codable, Equatable, Sendable {
    let userID: String
    let consentID: UUID
}

struct PetProductEnvironment: Codable, Equatable, Hashable, Sendable {
    let appVersion: String
    let appBuild: String
    let osMajor: String
    let uiLanguage: PetProductUILanguage

    static var current: Self {
        Self(appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
             appBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown",
             osMajor: String(ProcessInfo.processInfo.operatingSystemVersion.majorVersion),
             // Report the app preference, independently of the system locale.
             uiLanguage: PetL10n.language == .korean ? .ko : .en)
    }

    init(appVersion: String, appBuild: String, osMajor: String, uiLanguage: PetProductUILanguage) {
        self.appVersion = Self.normalizedVersion(appVersion)
        self.appBuild = Self.normalizedVersion(appBuild)
        self.osMajor = Self.isASCIINumericGroup(osMajor) ? osMajor : "unknown"
        self.uiLanguage = uiLanguage
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(appVersion: try values.decode(String.self, forKey: .appVersion),
                  appBuild: try values.decode(String.self, forKey: .appBuild),
                  osMajor: try values.decode(String.self, forKey: .osMajor),
                  uiLanguage: try values.decode(PetProductUILanguage.self, forKey: .uiLanguage))
    }

    static func normalizedVersion(_ value: String) -> String {
        guard value != "unknown" else { return value }
        let groups = value.split(separator: ".", omittingEmptySubsequences: false)
        guard value.utf8.count <= 27, (1...4).contains(groups.count),
              groups.allSatisfy({ isASCIINumericGroup(String($0)) }) else { return "unknown" }
        return value
    }

    private static func isASCIINumericGroup(_ value: String) -> Bool {
        (1...6).contains(value.utf8.count) && value.utf8.allSatisfy { (48...57).contains($0) }
    }
}

/// Only fixed categories and sanitized numeric versions can enter the outbox.
/// Retaining the operation's start time and environment makes attempts/outcomes
/// aggregate into the same day and version, even across midnight or an update.
struct PetProductMetricPayload: Codable, Equatable, Sendable {
    let kind: PetProductMetricKind
    let occurredAt: Date
    let operationID: UUID?
    let feature: PetProductFeature
    let inputMethod: PetProductInputMethod
    let latencyBucket: PetProductLatencyBucket
    let environment: PetProductEnvironment
    let targetVersion: String
    let targetBuild: String

    init(kind: PetProductMetricKind, occurredAt: Date, operationID: UUID? = nil,
         feature: PetProductFeature = .none, inputMethod: PetProductInputMethod = .none,
         latencyBucket: PetProductLatencyBucket = .none, environment: PetProductEnvironment,
         targetVersion: String = "none", targetBuild: String = "none") {
        self.kind = kind
        self.occurredAt = occurredAt
        self.operationID = operationID
        self.feature = feature
        self.inputMethod = inputMethod
        self.latencyBucket = latencyBucket
        self.environment = environment
        self.targetVersion = targetVersion == "none" ? "none" : PetProductEnvironment.normalizedVersion(targetVersion)
        self.targetBuild = targetBuild == "none" ? "none" : PetProductEnvironment.normalizedVersion(targetBuild)
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(kind: try values.decode(PetProductMetricKind.self, forKey: .kind),
                  occurredAt: try values.decode(Date.self, forKey: .occurredAt),
                  operationID: try values.decodeIfPresent(UUID.self, forKey: .operationID),
                  feature: try values.decode(PetProductFeature.self, forKey: .feature),
                  inputMethod: try values.decode(PetProductInputMethod.self, forKey: .inputMethod),
                  latencyBucket: try values.decode(PetProductLatencyBucket.self, forKey: .latencyBucket),
                  environment: try values.decode(PetProductEnvironment.self, forKey: .environment),
                  targetVersion: try values.decode(String.self, forKey: .targetVersion),
                  targetBuild: try values.decode(String.self, forKey: .targetBuild))
    }

    var isValid: Bool {
        guard occurredAt.timeIntervalSince1970.isFinite,
              (0...253_402_300_799).contains(occurredAt.timeIntervalSince1970) else { return false }
        switch kind {
        case .environmentObserved, .accountReady, .serviceConnected, .cardReceived, .firstAction:
            return operationID == nil && feature == .none && inputMethod == .none && latencyBucket == .none
                && targetVersion == "none" && targetBuild == "none"
        case .featureStarted, .featureSucceeded, .featureFailed, .featureCancelled:
            return operationID != nil && [.choice, .approval, .dismiss].contains(feature)
                && [.button, .keyboard].contains(inputMethod) && targetVersion == "none" && targetBuild == "none"
                && (kind == .featureStarted ? latencyBucket == .none : latencyBucket != .none)
        case .updateAvailable, .updateStarted, .updateSucceeded, .updateFailed, .updateCancelled:
            return (kind == .updateAvailable ? operationID == nil : operationID != nil)
                && feature == .appUpdate && inputMethod == .none && latencyBucket == .none
                && targetVersion != "none" && targetBuild != "none"
        }
    }
}

/// In-memory only; no token, raw duration, prompt, or command is persisted.
struct PetProductOperation: Equatable, Sendable {
    let context: PetUsageContext
    let operationID: UUID
    let occurredAt: Date
    let startedAtUptime: TimeInterval
    let feature: PetProductFeature
    let inputMethod: PetProductInputMethod
    let environment: PetProductEnvironment
}
