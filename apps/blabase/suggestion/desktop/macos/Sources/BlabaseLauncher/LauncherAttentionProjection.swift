import Foundation

enum AttentionDecisionStatus: String, Codable, Sendable, CaseIterable {
    case suggested
    case needsClarification = "needs_clarification"
    case noAction = "no_action"
    case insufficientEvidence = "insufficient_evidence"
}

enum AttentionDecisionReasonCode: String, Codable, Sendable, CaseIterable,
    Hashable {
    case bestEligibleCandidate = "DECISION_BEST_ELIGIBLE_CANDIDATE"
    case refreshRequired = "DECISION_REFRESH_REQUIRED"
    case userClarificationRequired =
        "DECISION_USER_CLARIFICATION_REQUIRED"
    case scopedNoAction = "DECISION_SCOPED_NO_ACTION"
    case relevantCoverageInsufficient =
        "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
}

enum AttentionSource: String, Codable, Sendable, CaseIterable, Hashable {
    case github
    case codex
    case notion
    case googleCalendar = "google_calendar"

    var displayName: String {
        switch self {
        case .github: "GitHub"
        case .codex: "Codex"
        case .notion: "Notion"
        case .googleCalendar: "Google Calendar"
        }
    }
}

enum AttentionSourceDiagnosticState: String, Codable, Sendable {
    case available
    case stale
    case invalid
    case missing
    case rejected
    case disconnected
    case collectionFailed = "collection_failed"
    case unevaluated

    var isUsable: Bool { self == .available }
}

enum AttentionSourceDiagnosticReasonCode: String, Codable, Sendable {
    case snapshotMissing = "SNAPSHOT_MISSING"
    case snapshotParseFailed = "SNAPSHOT_PARSE_FAILED"
    case snapshotSchemaUnsupported = "SNAPSHOT_SCHEMA_UNSUPPORTED"
    case connectorDisconnected = "CONNECTOR_DISCONNECTED"
    case collectionFailed = "COLLECTION_FAILED"
}

struct AttentionCandidateCounts: Codable, Equatable, Sendable {
    static let maximumCount = 1_000_000_000

    let eligible: Int
    let reviewRequired: Int
    let ineligible: Int

    var isValid: Bool {
        [eligible, reviewRequired, ineligible].allSatisfy {
            (0...Self.maximumCount).contains($0)
        }
    }
}

struct AttentionSourceDiagnostic: Codable, Equatable, Sendable {
    static let maximumSignalCount = 1_000_000_000

    let source: AttentionSource
    let state: AttentionSourceDiagnosticState
    let signalCount: Int
    let candidateSetComplete: Bool?
    let reasonCode: AttentionSourceDiagnosticReasonCode?

    var isValid: Bool {
        (0...Self.maximumSignalCount).contains(signalCount) &&
            candidateCompletenessMatchesSource &&
            reasonMatchesState
    }

    private var candidateCompletenessMatchesSource: Bool {
        switch source {
        case .github, .codex:
            candidateSetComplete != nil
        case .notion, .googleCalendar:
            candidateSetComplete == nil
        }
    }

    private var reasonMatchesState: Bool {
        switch state {
        case .available, .stale, .invalid, .unevaluated:
            reasonCode == nil
        case .missing:
            reasonCode == .snapshotMissing
        case .rejected:
            reasonCode == .snapshotParseFailed ||
                reasonCode == .snapshotSchemaUnsupported
        case .disconnected:
            reasonCode == .connectorDisconnected
        case .collectionFailed:
            reasonCode == .collectionFailed
        }
    }
}

enum AttentionCertainty: String, Codable, Sendable {
    case confirmed
    case provisional

    var displayName: String {
        switch self {
        case .confirmed: "확인됨"
        case .provisional: "잠정"
        }
    }
}

enum AttentionPrimaryAction: Equatable, Sendable {
    case focusOrResume(enabled: Bool)
    case openGitHub(url: String)
}

extension AttentionPrimaryAction: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind
        case enabled
        case url
    }

    private enum Kind: String, Codable {
        case focusOrResume = "focus_or_resume"
        case openGitHub = "open_github"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .focusOrResume:
            guard !container.contains(.url) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .url,
                    in: container,
                    debugDescription: "Unexpected URL for focus action."
                )
            }
            self = .focusOrResume(
                enabled: try container.decode(Bool.self, forKey: .enabled)
            )
        case .openGitHub:
            guard !container.contains(.enabled) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .enabled,
                    in: container,
                    debugDescription: "Unexpected enabled flag for URL action."
                )
            }
            self = .openGitHub(
                url: try container.decode(String.self, forKey: .url)
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .focusOrResume(let enabled):
            try container.encode(Kind.focusOrResume, forKey: .kind)
            try container.encode(enabled, forKey: .enabled)
        case .openGitHub(let url):
            try container.encode(Kind.openGitHub, forKey: .kind)
            try container.encode(url, forKey: .url)
        }
    }
}

struct AttentionCard: Codable, Equatable, Sendable {
    let candidateId: String
    let title: String
    let contextLabel: String
    let laneLabel: String
    let certainty: AttentionCertainty
    let whyNowText: [String]
    let explanation: String
    let firstStep: String
    let dueAt: String?
    let primaryAction: AttentionPrimaryAction
}

struct LauncherAttentionProjection: Equatable, Sendable {
    static let contract = "blabase-launcher-attention-v2"

    let resultId: String
    let asOf: String
    let decisionStatus: AttentionDecisionStatus
    let decisionReasonCodes: [AttentionDecisionReasonCode]
    let candidateCounts: AttentionCandidateCounts
    let sourceDiagnostics: [AttentionSourceDiagnostic]
    let card: AttentionCard?
    let clarificationQuestion: String?
    let scopeStatement: String
    let unavailableSources: [AttentionSource]
    let dashboardPath: String
}

extension LauncherAttentionProjection: Codable {
    private enum CodingKeys: String, CodingKey {
        case contract
        case resultId
        case asOf
        case decisionStatus
        case decisionReasonCodes
        case candidateCounts
        case sourceDiagnostics
        case card
        case clarificationQuestion
        case scopeStatement
        case unavailableSources
        case dashboardPath
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedContract = try container.decode(String.self, forKey: .contract)
        guard decodedContract == Self.contract else {
            throw DecodingError.dataCorruptedError(
                forKey: .contract,
                in: container,
                debugDescription: "Unsupported attention projection contract."
            )
        }
        resultId = try container.decode(String.self, forKey: .resultId)
        asOf = try container.decode(String.self, forKey: .asOf)
        decisionStatus = try container.decode(
            AttentionDecisionStatus.self,
            forKey: .decisionStatus
        )
        decisionReasonCodes = try container.decode(
            [AttentionDecisionReasonCode].self,
            forKey: .decisionReasonCodes
        )
        candidateCounts = try container.decode(
            AttentionCandidateCounts.self,
            forKey: .candidateCounts
        )
        sourceDiagnostics = try container.decode(
            [AttentionSourceDiagnostic].self,
            forKey: .sourceDiagnostics
        )
        card = try container.decodeIfPresent(AttentionCard.self, forKey: .card)
        clarificationQuestion = try container.decodeIfPresent(
            String.self,
            forKey: .clarificationQuestion
        )
        scopeStatement = try container.decode(String.self, forKey: .scopeStatement)
        unavailableSources = try container.decode(
            [AttentionSource].self,
            forKey: .unavailableSources
        )
        dashboardPath = try container.decode(String.self, forKey: .dashboardPath)
        guard resultId.matches(#"^attention_result_[a-f0-9]{32}$"#) else {
            throw DecodingError.dataCorruptedError(
                forKey: .resultId,
                in: container,
                debugDescription: "Invalid attention result identity."
            )
        }
        if let card {
            guard card.candidateId.matches(#"^attention_[a-f0-9]{32}$"#) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .card,
                    in: container,
                    debugDescription: "Invalid attention candidate identity."
                )
            }
        }
        guard (decisionStatus == .suggested) == (card != nil) else {
            throw DecodingError.dataCorruptedError(
                forKey: .card,
                in: container,
                debugDescription: "Suggestion/card invariant failed."
            )
        }
        guard
            !decisionReasonCodes.isEmpty,
            decisionReasonCodes.count <= 3,
            Set(decisionReasonCodes).count == decisionReasonCodes.count,
            Self.reasonCodesMatchDecision(
                decisionReasonCodes,
                decisionStatus: decisionStatus
            ),
            candidateCounts.isValid,
            (decisionStatus == .suggested) ==
                (candidateCounts.eligible > 0)
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .decisionReasonCodes,
                in: container,
                debugDescription: "Launcher decision diagnostics are inconsistent."
            )
        }
        guard
            sourceDiagnostics.map(\.source) == AttentionSource.allCases,
            sourceDiagnostics.allSatisfy(\.isValid)
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .sourceDiagnostics,
                in: container,
                debugDescription:
                    "Launcher source diagnostics must contain four canonical valid entries."
            )
        }
        guard
            (decisionStatus == .needsClarification) ==
                (clarificationQuestion != nil)
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .clarificationQuestion,
                in: container,
                debugDescription: "Clarification invariant failed."
            )
        }
        guard
            Set(unavailableSources).count == unavailableSources.count,
            dashboardPath == "/"
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .dashboardPath,
                in: container,
                debugDescription: "Launcher scope invariant failed."
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.contract, forKey: .contract)
        try container.encode(resultId, forKey: .resultId)
        try container.encode(asOf, forKey: .asOf)
        try container.encode(decisionStatus, forKey: .decisionStatus)
        try container.encode(
            decisionReasonCodes,
            forKey: .decisionReasonCodes
        )
        try container.encode(candidateCounts, forKey: .candidateCounts)
        try container.encode(sourceDiagnostics, forKey: .sourceDiagnostics)
        try container.encodeIfPresent(card, forKey: .card)
        try container.encodeIfPresent(
            clarificationQuestion,
            forKey: .clarificationQuestion
        )
        try container.encode(scopeStatement, forKey: .scopeStatement)
        try container.encode(unavailableSources, forKey: .unavailableSources)
        try container.encode(dashboardPath, forKey: .dashboardPath)
    }

    private static func reasonCodesMatchDecision(
        _ reasonCodes: [AttentionDecisionReasonCode],
        decisionStatus: AttentionDecisionStatus
    ) -> Bool {
        let allowed: Set<AttentionDecisionReasonCode>
        switch decisionStatus {
        case .suggested:
            allowed = [.bestEligibleCandidate]
        case .needsClarification:
            allowed = [.userClarificationRequired]
        case .noAction:
            allowed = [.scopedNoAction]
        case .insufficientEvidence:
            allowed = [.refreshRequired, .relevantCoverageInsufficient]
        }
        return !allowed.isDisjoint(with: reasonCodes) &&
            reasonCodes.allSatisfy(allowed.contains)
    }
}

enum LauncherExecutionStatus: String, Codable, Equatable, Sendable {
    case pending
    case claimed
    case completed
    case failed
    case expired

    var isTerminal: Bool {
        switch self {
        case .pending, .claimed: false
        case .completed, .failed, .expired: true
        }
    }
}

struct LauncherExecutionProjection: Equatable, Sendable {
    static let contract = "blabase-launcher-execution-v1"

    let kind: String
    let commandId: String
    let status: LauncherExecutionStatus
}

extension LauncherExecutionProjection: Codable {
    private enum CodingKeys: String, CodingKey {
        case contract
        case kind
        case commandId
        case status
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedContract = try container.decode(String.self, forKey: .contract)
        guard decodedContract == Self.contract else {
            throw DecodingError.dataCorruptedError(
                forKey: .contract,
                in: container,
                debugDescription: "Unsupported execution projection contract."
            )
        }
        let decodedKind = try container.decode(String.self, forKey: .kind)
        guard decodedKind == "focus_or_resume" else {
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: container,
                debugDescription: "Unsupported execution kind."
            )
        }
        kind = decodedKind
        commandId = try container.decode(String.self, forKey: .commandId)
        status = try container.decode(LauncherExecutionStatus.self, forKey: .status)
        guard commandId.matches(#"^command_[a-f0-9]{32}$"#) else {
            throw DecodingError.dataCorruptedError(
                forKey: .commandId,
                in: container,
                debugDescription: "Invalid launcher command identity."
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.contract, forKey: .contract)
        try container.encode(kind, forKey: .kind)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(status, forKey: .status)
    }
}

private extension String {
    func matches(_ pattern: String) -> Bool {
        range(of: pattern, options: .regularExpression) != nil
    }
}
