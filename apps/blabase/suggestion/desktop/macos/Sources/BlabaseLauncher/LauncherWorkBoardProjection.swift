import Foundation

enum LauncherWorkBoardMode: String, Codable, Equatable, Sendable {
    case full
    case activeOnlyFallback = "active_only_fallback"
}

enum LauncherWorkBoardLane: String, Codable, CaseIterable, Equatable, Sendable {
    case attention
    case continuation
    case setup

    var rank: Int {
        switch self {
        case .attention: 0
        case .continuation: 1
        case .setup: 2
        }
    }
}

enum LauncherWorkBoardProminentLane: String, Codable, Equatable, Sendable {
    case attention
    case continuation
    case setup
    case none
}

enum LauncherWorkBoardContinuationStatus: String, Codable, Equatable, Sendable {
    case available
    case empty
    case unavailable
}

enum LauncherWorkBoardEvidenceBand: String, Codable, Equatable, Sendable {
    case verifiedAttention = "verified_attention"
    case exact
    case corroborated
    case singleSource = "single_source"
    case setup
}

enum LauncherWorkBoardCaveatCode: String, Codable, CaseIterable, Equatable,
    Hashable, Sendable {
    case candidateSetIncomplete = "CAVEAT_CANDIDATE_SET_INCOMPLETE"
    case defaultTieBreakUsed = "CAVEAT_DEFAULT_TIE_BREAK_USED"
    case githubPRActionabilityPartial =
        "CAVEAT_GITHUB_PR_ACTIONABILITY_PARTIAL"
    case managedFailureInspectionOnly =
        "CAVEAT_MANAGED_FAILURE_INSPECTION_ONLY"
    case reviewDraftUnknown = "CAVEAT_REVIEW_DRAFT_UNKNOWN"
    case upstreamObjectsRemainNonCandidates =
        "CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES"
    case explicitMappingConfirmationRequired =
        "EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"
    case identityClarificationRequired = "IDENTITY_CLARIFICATION_REQUIRED"
    case sourceCoveragePartial = "SOURCE_COVERAGE_PARTIAL"
    case sourceCoverageUnknown = "SOURCE_COVERAGE_UNKNOWN"
    case sourceMetadataOnly = "SOURCE_METADATA_ONLY"
    case terminalStateUnknown = "TERMINAL_STATE_UNKNOWN"
}

struct LauncherWorkBoardItem: Equatable, Sendable, Decodable {
    let lane: LauncherWorkBoardLane
    let title: String
    let evidenceBand: LauncherWorkBoardEvidenceBand
    let caveatCodes: [LauncherWorkBoardCaveatCode]
    let expiresAt: String?
    let capability: String

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case lane
        case title
        case evidenceBand
        case caveatCodes
        case expiresAt
        case capability
        case action
    }

    init(from decoder: Decoder) throws {
        try requireExactWorkBoardKeys(decoder, CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        lane = try container.decode(LauncherWorkBoardLane.self, forKey: .lane)
        title = try container.decode(String.self, forKey: .title)
        evidenceBand = try container.decode(
            LauncherWorkBoardEvidenceBand.self,
            forKey: .evidenceBand
        )
        caveatCodes = try container.decode(
            [LauncherWorkBoardCaveatCode].self,
            forKey: .caveatCodes
        )
        expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        capability = try container.decode(String.self, forKey: .capability)
        guard container.contains(.action), try container.decodeNil(forKey: .action)
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .action,
                in: container,
                debugDescription: "Launcher Work Board actions are forbidden."
            )
        }
        guard
            capability == "display",
            (1...120).contains(title.utf16.count),
            isLauncherWorkBoardPublicTextSafe(title),
            caveatCodes.count <= 8,
            Set(caveatCodes).count == caveatCodes.count,
            caveatCodes.map(\.rawValue) == caveatCodes.map(\.rawValue).sorted(),
            expiresAt.map(isCanonicalLauncherWorkBoardTimestamp) ?? true,
            (lane == .attention) == (expiresAt == nil),
            evidenceMatchesLane
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .capability,
                in: container,
                debugDescription: "Launcher Work Board item is inconsistent."
            )
        }
    }

    private var evidenceMatchesLane: Bool {
        switch lane {
        case .attention:
            evidenceBand == .verifiedAttention
        case .continuation:
            evidenceBand == .exact || evidenceBand == .corroborated ||
                evidenceBand == .singleSource
        case .setup:
            evidenceBand == .setup
        }
    }
}

struct LauncherWorkBoardProjection: Equatable, Sendable, Decodable {
    static let contract = "blabase-launcher-work-board-v1"

    let generatedAt: String
    let mode: LauncherWorkBoardMode
    let prominentLane: LauncherWorkBoardProminentLane
    let continuationStatus: LauncherWorkBoardContinuationStatus
    let items: [LauncherWorkBoardItem]

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case contract
        case generatedAt
        case mode
        case prominentLane
        case continuationStatus
        case items
    }

    init(from decoder: Decoder) throws {
        try requireExactWorkBoardKeys(decoder, CodingKeys.self)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedContract = try container.decode(String.self, forKey: .contract)
        guard decodedContract == Self.contract else {
            throw DecodingError.dataCorruptedError(
                forKey: .contract,
                in: container,
                debugDescription: "Unsupported Launcher Work Board contract."
            )
        }
        generatedAt = try container.decode(String.self, forKey: .generatedAt)
        mode = try container.decode(LauncherWorkBoardMode.self, forKey: .mode)
        prominentLane = try container.decode(
            LauncherWorkBoardProminentLane.self,
            forKey: .prominentLane
        )
        continuationStatus = try container.decode(
            LauncherWorkBoardContinuationStatus.self,
            forKey: .continuationStatus
        )
        items = try container.decode([LauncherWorkBoardItem].self, forKey: .items)
        guard
            isCanonicalLauncherWorkBoardTimestamp(generatedAt),
            items.count <= 3,
            prominentLaneMatchesItems,
            lanesAreCanonical,
            continuationStatusMatchesItems,
            expiriesFollowGeneration,
            activeFallbackIsAttentionOnly
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .items,
                in: container,
                debugDescription: "Launcher Work Board projection is inconsistent."
            )
        }
    }

    private var prominentLaneMatchesItems: Bool {
        switch prominentLane {
        case .none:
            items.isEmpty
        case .attention:
            items.first?.lane == .attention
        case .continuation:
            items.first?.lane == .continuation
        case .setup:
            items.first?.lane == .setup
        }
    }

    private var lanesAreCanonical: Bool {
        zip(items, items.dropFirst()).allSatisfy { previous, current in
            previous.lane.rank <= current.lane.rank
        }
    }

    private var continuationStatusMatchesItems: Bool {
        let hasContinuation = items.contains {
            $0.lane == .continuation || $0.lane == .setup
        }
        if hasContinuation { return continuationStatus == .available }
        if items.isEmpty { return continuationStatus != .available }
        return true
    }

    private var expiriesFollowGeneration: Bool {
        guard let generated = launcherWorkBoardDate(generatedAt) else {
            return false
        }
        return items.allSatisfy { item in
            guard let expiresAt = item.expiresAt else { return true }
            guard let expiry = launcherWorkBoardDate(expiresAt) else {
                return false
            }
            return expiry > generated
        }
    }

    private var activeFallbackIsAttentionOnly: Bool {
        guard mode == .activeOnlyFallback else { return true }
        return continuationStatus == .unavailable &&
            items.allSatisfy { $0.lane == .attention }
    }
}

private struct LauncherWorkBoardDynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private func requireExactWorkBoardKeys<Key: CodingKey & CaseIterable>(
    _ decoder: Decoder,
    _ keyType: Key.Type
) throws where Key.AllCases: Collection {
    let actual = try decoder.container(
        keyedBy: LauncherWorkBoardDynamicCodingKey.self
    ).allKeys.map(\.stringValue)
    let expected = keyType.allCases.map(\.stringValue)
    guard Set(actual) == Set(expected) else {
        throw DecodingError.dataCorrupted(
            DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "Launcher Work Board fields do not match v1."
            )
        )
    }
}

private func isCanonicalLauncherWorkBoardTimestamp(_ value: String) -> Bool {
    guard value.range(
        of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#,
        options: .regularExpression
    ) == value.startIndex..<value.endIndex else {
        return false
    }
    return launcherWorkBoardDate(value) != nil
}

private func launcherWorkBoardDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
}

func launcherWorkBoardTimestampDate(_ value: String) -> Date? {
    launcherWorkBoardDate(value)
}

func isLauncherWorkBoardPublicTextSafe(_ value: String) -> Bool {
    let patterns = [
        #"[\u0000-\u001f\u007f-\u009f]"#,
        #"https?://\S+"#,
        #"file://\S+"#,
        #"[A-Za-z][A-Za-z0-9+.-]*://\S*"#,
        #"(?:^|[^\p{L}\p{N}_])(?:/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)"#,
        #"\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+"#,
        #"(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])"#,
        #"(?:action_ref|analysis|artifact|attention|binding|board_item|board_source|candidate|claim|command|connection|context_ref|continuation_candidate|continuation_context_link|continuation_observation|continuation_offer|continuation_run|evidence|execution|focus|github_repo|input_sha|instance|item_ref|managed_event|managed_run|mapping|observation_sha|private_target|project|proof|repository|result|result_sha|root|run|scope|session|settlement|source_ref|source_record_ref|stream|sync|thread|user|work_board|work_context|work_item|workstream)_[A-Za-z0-9_-]+"#,
        #"\b(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b"#,
        #"\bsk-[A-Za-z0-9_-]{8,}\b"#,
        #"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b"#,
        #"\b(?:token|api[ _-]?key|access[ _-]?(?:key|token)|password|secret)\s*[:=]\s*[\"']?[^\s,;\"']+"#
    ]
    return patterns.allSatisfy { pattern in
        value.range(
            of: pattern,
            options: [.regularExpression, .caseInsensitive]
        ) == nil
    }
}
