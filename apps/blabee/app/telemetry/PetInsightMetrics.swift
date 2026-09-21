import Foundation

enum PetInsightMetricKind: String, Codable, Sendable {
    case cardPresented = "card_presented"
    case cardResponded = "card_responded"
    case connectionObserved = "connection_observed"
}

enum PetInsightCardKind: String, Codable, Sendable { case none, suggestion, approval }
enum PetInsightResponse: String, Codable, Sendable {
    case none, selected, dismissed, approved, denied

    func isValid(for card: PetInsightCardKind) -> Bool {
        switch card {
        case .none: false
        case .suggestion: self == .selected || self == .dismissed
        case .approval: self == .approved || self == .denied
        }
    }
}

enum PetInsightReactionBucket: String, Codable, Sendable {
    case none
    case under5s = "under_5s"
    case fiveTo30s = "5_to_30s"
    case over30s = "over_30s"
    case unknown

    static func elapsed(_ seconds: TimeInterval) -> Self {
        guard seconds.isFinite, seconds >= 0 else { return .unknown }
        if seconds < 5 { return .under5s }
        if seconds <= 30 { return .fiveTo30s }
        return .over30s
    }
}

enum PetInsightConnectionMode: String, Codable, Sendable { case none, plugin, managed, unknown }
enum PetInsightCompatibility: String, Codable, Sendable { case none, qualified, unqualified, unknown }

/// Automatic insight events have no text-content, path, project, session, or
/// original card-ID field. The analytics card UUID is newly generated locally.
struct PetInsightMetricPayload: Codable, Equatable, Sendable {
    let kind: PetInsightMetricKind
    let occurredAt: Date
    let cardID: UUID?
    let cardKind: PetInsightCardKind
    let response: PetInsightResponse
    let reactionBucket: PetInsightReactionBucket
    let environment: PetProductEnvironment
    let codexVersion: String
    let connectionMode: PetInsightConnectionMode
    let compatibility: PetInsightCompatibility

    init(kind: PetInsightMetricKind, occurredAt: Date, cardID: UUID? = nil,
         cardKind: PetInsightCardKind = .none, response: PetInsightResponse = .none,
         reactionBucket: PetInsightReactionBucket = .none, environment: PetProductEnvironment,
         codexVersion: String = "unknown", connectionMode: PetInsightConnectionMode = .none,
         compatibility: PetInsightCompatibility = .none) {
        self.kind = kind
        self.occurredAt = occurredAt
        self.cardID = cardID
        self.cardKind = cardKind
        self.response = response
        self.reactionBucket = reactionBucket
        self.environment = environment
        self.codexVersion = PetProductEnvironment.normalizedVersion(codexVersion)
        self.connectionMode = connectionMode
        self.compatibility = compatibility
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self.init(kind: try values.decode(PetInsightMetricKind.self, forKey: .kind),
                  occurredAt: try values.decode(Date.self, forKey: .occurredAt),
                  cardID: try values.decodeIfPresent(UUID.self, forKey: .cardID),
                  cardKind: try values.decode(PetInsightCardKind.self, forKey: .cardKind),
                  response: try values.decode(PetInsightResponse.self, forKey: .response),
                  reactionBucket: try values.decode(PetInsightReactionBucket.self, forKey: .reactionBucket),
                  environment: try values.decode(PetProductEnvironment.self, forKey: .environment),
                  codexVersion: try values.decode(String.self, forKey: .codexVersion),
                  connectionMode: try values.decode(PetInsightConnectionMode.self, forKey: .connectionMode),
                  compatibility: try values.decode(PetInsightCompatibility.self, forKey: .compatibility))
    }

    var isValid: Bool {
        guard occurredAt.timeIntervalSince1970.isFinite,
              (0...253_402_300_799).contains(occurredAt.timeIntervalSince1970) else { return false }
        switch kind {
        case .connectionObserved:
            return cardID == nil && cardKind == .none && response == .none && reactionBucket == .none
                && connectionMode != .none && compatibility != .none
        case .cardPresented, .cardResponded:
            guard cardID != nil, cardKind != .none, codexVersion == "unknown",
                  connectionMode == .none, compatibility == .none else { return false }
            if kind == .cardPresented { return response == .none && reactionBucket == .none }
            return response.isValid(for: cardKind) && reactionBucket != .none
        }
    }
}

/// Not Codable. A response is captured at the user's action, then passed through
/// the product request. Only an accepted request can enqueue this fixed payload.
struct PetInsightResponseToken: Sendable {
    fileprivate let trackerID: UUID
    fileprivate let epoch: UUID
    fileprivate let identity: PetProductIdentity
    fileprivate let context: PetUsageContext
    fileprivate let payload: PetInsightMetricPayload
}

@MainActor
final class PetInsightCardTracker {
    static let maximumTrackedCards = 256
    static let maximumLocalKeyBytes = 1_024

    private struct Card {
        let localKey: String
        let analyticsID: UUID
        let kind: PetInsightCardKind
        let occurredAt: Date
        let shownUptime: TimeInterval
        let environment: PetProductEnvironment
        let context: PetUsageContext
        let identity: PetProductIdentity
        let order: UInt64
        var responded = false
    }

    private let analytics: PetUsageAnalytics
    private let now: @MainActor () -> Date
    private let monotonicNow: @MainActor () -> TimeInterval
    private let makeCardID: @MainActor () -> UUID
    private let trackerID = UUID()
    private var epoch = UUID()
    private var identity: PetProductIdentity?
    private var cards: [UUID: Card] = [:]
    private var keys: [String: UUID] = [:]
    private var nextOrder: UInt64 = 0

    init(analytics: PetUsageAnalytics,
         now: @escaping @MainActor () -> Date = Date.init,
         monotonicNow: @escaping @MainActor () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
         makeCardID: @escaping @MainActor () -> UUID = UUID.init) {
        self.analytics = analytics
        self.now = now
        self.monotonicNow = monotonicNow
        self.makeCardID = makeCardID
        analytics.registerInsightTracker(self)
    }

    /// The caller must have rendered this card in the visible interaction panel.
    /// Merely receiving a snapshot, a hidden panel, or a preview is not exposure.
    func present(key: String, kind: PetInsightCardKind) {
        guard kind != .none, !key.isEmpty, key.utf8.count <= Self.maximumLocalKeyBytes,
              let identity = synchronizeIdentity(), let context = analytics.captureContext() else { return }
        if let id = keys[key], cards[id] != nil { return }
        let cardID = makeCardID()
        guard cards[cardID] == nil else { return }
        let date = now()
        let shownUptime = monotonicNow()
        let payload = PetInsightMetricPayload(kind: .cardPresented, occurredAt: date, cardID: cardID,
            cardKind: kind, environment: analytics.productEnvironment)
        guard analytics.recordInsight(payload, context: context) else { return }
        if cards.count >= Self.maximumTrackedCards, let oldest = cards.values.min(by: { $0.order < $1.order }) {
            cards.removeValue(forKey: oldest.analyticsID)
            keys.removeValue(forKey: oldest.localKey)
        }
        nextOrder &+= 1
        cards[cardID] = Card(localKey: key, analyticsID: cardID, kind: kind, occurredAt: date,
            shownUptime: shownUptime, environment: analytics.productEnvironment,
            context: context, identity: identity, order: nextOrder)
        keys[key] = cardID
    }

    /// Never fabricates a presentation. Hidden-panel shortcuts may respond only
    /// if this exact local card was previously shown during the current consent.
    func captureResponse(key: String, response: PetInsightResponse) -> PetInsightResponseToken? {
        guard let identity = synchronizeIdentity(), let id = keys[key], let card = cards[id],
              !card.responded, card.identity == identity, response.isValid(for: card.kind) else { return nil }
        let payload = PetInsightMetricPayload(kind: .cardResponded, occurredAt: card.occurredAt, cardID: card.analyticsID,
            cardKind: card.kind, response: response,
            reactionBucket: .elapsed(monotonicNow() - card.shownUptime), environment: card.environment)
        return PetInsightResponseToken(trackerID: trackerID, epoch: epoch, identity: identity,
                                       context: card.context, payload: payload)
    }

    func recordResponse(_ token: PetInsightResponseToken?) {
        guard let token, token.trackerID == trackerID, token.epoch == epoch,
              let currentIdentity = synchronizeIdentity(), currentIdentity == token.identity,
              token.epoch == epoch, let id = token.payload.cardID, var card = cards[id],
              !card.responded, card.identity == currentIdentity,
              analytics.recordInsight(token.payload, context: token.context) else { return }
        card.responded = true
        cards[id] = card
    }

    func reset() {
        epoch = UUID()
        identity = nil
        cards.removeAll()
        keys.removeAll()
        nextOrder = 0
    }

    private func synchronizeIdentity() -> PetProductIdentity? {
        // Temporary token verification can pause observations without replaying
        // prior cards. Explicit invalidation also calls reset() via analytics.
        guard let current = analytics.productIdentity else { return nil }
        if identity != current {
            reset()
            identity = current
        }
        return current
    }
}

@MainActor
final class PetInsightWeakCardTracker {
    weak var value: PetInsightCardTracker?
    init(_ value: PetInsightCardTracker) { self.value = value }
}
