import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Consented card and connection insights")
@MainActor
struct PetInsightMetricsTests {
    @Test("Version-two consent and provenance are not inherited by expanded automatic collection")
    func freshVersionThreeConsent() throws {
        let suite = "blabee-insight-consent-test-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let oldConsentID = UUID()
        defaults.set(true, forKey: "blabee.usageAnalytics.enabled.v2")
        defaults.set(oldConsentID.uuidString, forKey: "blabee.usageAnalytics.consentID.v2")
        defaults.set(try JSONEncoder().encode(PetProductIdentity(userID: InsightValues.user, consentID: oldConsentID)),
                     forKey: "blabee.usageAnalytics.identity.v2")
        let recorder = PetUsageAnalytics.live(defaults: defaults) {
            .init(userID: InsightValues.user, accessToken: "test-token", expiresAt: Date().addingTimeInterval(3_600))
        }
        defer { recorder.stop() }
        #expect(!recorder.isEnabled && recorder.productIdentity == nil)
        recorder.setEnabled(true)
        let identity = try #require(recorder.productIdentity)
        #expect(identity.consentID != oldConsentID)
        #expect(defaults.bool(forKey: "blabee.usageAnalytics.enabled.v3"))
        #expect(defaults.string(forKey: "blabee.usageAnalytics.consentID.v3") == identity.consentID.uuidString)
        recorder.stop()
        let restarted = PetUsageAnalytics.live(defaults: defaults) {
            .init(userID: InsightValues.user, accessToken: "test-token", expiresAt: Date().addingTimeInterval(3_600))
        }
        defer { restarted.stop() }
        #expect(restarted.isEnabled && restarted.productIdentity == identity)
    }

    @Test("Unseen cards and cards shown without consent cannot acquire fabricated exposure")
    func onlyExplicitConsentedPresentation() {
        let fixture = InsightFixture(enabled: false)
        defer { fixture.analytics.stop() }
        #expect(fixture.tracker.captureResponse(key: "unseen", response: .selected) == nil)
        fixture.tracker.present(key: "visible", kind: .suggestion)
        #expect(fixture.store.events.isEmpty)
        fixture.analytics.setEnabled(true)
        #expect(fixture.tracker.captureResponse(key: "visible", response: .selected) == nil)
        fixture.tracker.present(key: "visible", kind: .suggestion)
        #expect(fixture.tracker.captureResponse(key: "visible", response: .selected) != nil)
        #expect(fixture.insights.map(\.kind) == [.cardPresented])
    }

    @Test("Rerenders reuse a random analytics card ID without retaining the local key in the queue")
    func presentationDedupAndNoRawKey() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        let localKey = "session:/Users/person/private-project:original-card-id"
        for _ in 0..<100 { fixture.tracker.present(key: localKey, kind: .suggestion) }
        #expect(fixture.insights.count == 1)
        #expect(fixture.insights.first?.cardID != nil)
        let json = String(decoding: try JSONEncoder().encode(fixture.store.events), as: UTF8.self)
        for forbidden in [localKey, "private-project", "original-card-id", "localKey", "session", "private-token"] {
            #expect(!json.contains(forbidden))
        }
    }

    @Test("Response timing freezes at user action, preserving the original date and environment")
    func timingCapturedBeforeAcknowledgment() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "card", kind: .approval)
        fixture.state.uptime += 6
        let token = try #require(fixture.tracker.captureResponse(key: "card", response: .approved))
        fixture.state.advanceDate(86_400)
        fixture.state.uptime += 120
        fixture.tracker.recordResponse(token)
        let shown = try #require(fixture.insights.first)
        let response = try #require(fixture.insights.last)
        #expect(fixture.insights.map(\.kind) == [.cardPresented, .cardResponded])
        #expect(response.reactionBucket == .fiveTo30s)
        #expect(response.cardID == shown.cardID && response.occurredAt == shown.occurredAt)
        #expect(response.environment == shown.environment)
        #expect(response.response == .approved)
        #expect(fixture.store.events.allSatisfy { $0.kind == .insightMetric })
    }

    @Test("Unaccepted responses do not count and a later accepted response uses first-show time")
    func failedActionCanBeRetried() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "card", kind: .suggestion)
        fixture.state.uptime += 1
        #expect(fixture.tracker.captureResponse(key: "card", response: .selected) != nil)
        #expect(fixture.insights.count == 1)
        fixture.tracker.present(key: "card", kind: .suggestion)
        fixture.state.uptime += 40
        let retry = try #require(fixture.tracker.captureResponse(key: "card", response: .dismissed))
        fixture.tracker.recordResponse(retry)
        #expect(fixture.insights.count == 2)
        #expect(fixture.insights.last?.response == .dismissed)
        #expect(fixture.insights.last?.reactionBucket == .over30s)
    }

    @Test("Only the first accepted response counts even with multiple in-flight response tokens")
    func acceptedResponseDedup() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "card", kind: .suggestion)
        let first = try #require(fixture.tracker.captureResponse(key: "card", response: .selected))
        let second = try #require(fixture.tracker.captureResponse(key: "card", response: .dismissed))
        fixture.tracker.recordResponse(second)
        fixture.tracker.recordResponse(first)
        fixture.tracker.recordResponse(second)
        #expect(fixture.insights.map(\.response) == [.none, .dismissed])
        #expect(fixture.tracker.captureResponse(key: "card", response: .selected) == nil)
    }

    @Test("Response kinds cannot cross suggestion and approval cards", arguments: [PetInsightCardKind.suggestion, .approval],
          [PetInsightResponse.none, .selected, .dismissed, .approved, .denied])
    func responseKindValidation(_ kind: PetInsightCardKind, _ response: PetInsightResponse) {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "card", kind: kind)
        let allowed = kind == .suggestion ? [.selected, .dismissed].contains(response) : [.approved, .denied].contains(response)
        #expect((fixture.tracker.captureResponse(key: "card", response: response) != nil) == allowed)
    }

    @Test("Reaction buckets use the monotonic clock and handle boundaries or invalid time", arguments: [
        InsightLatencyCase(seconds: 0, expected: .under5s),
        InsightLatencyCase(seconds: 4.999, expected: .under5s),
        InsightLatencyCase(seconds: 5, expected: .fiveTo30s),
        InsightLatencyCase(seconds: 30, expected: .fiveTo30s),
        InsightLatencyCase(seconds: 30.001, expected: .over30s),
        InsightLatencyCase(seconds: -1, expected: .unknown),
        InsightLatencyCase(seconds: .nan, expected: .unknown),
        InsightLatencyCase(seconds: .infinity, expected: .unknown),
    ])
    func reactionBuckets(_ example: InsightLatencyCase) throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "card", kind: .suggestion)
        fixture.state.uptime += example.seconds
        fixture.tracker.recordResponse(try #require(fixture.tracker.captureResponse(key: "card", response: .selected)))
        #expect(fixture.insights.last?.reactionBucket == example.expected)
    }

    @Test("Pending responses cannot cross consent, account, explicit-reset, or stop boundaries", arguments: InsightBoundary.allCases)
    func responseFences(_ boundary: InsightBoundary) throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "card", kind: .suggestion)
        let old = try #require(fixture.tracker.captureResponse(key: "card", response: .selected))
        switch boundary {
        case .optOut:
            fixture.analytics.setEnabled(false)
            fixture.analytics.setEnabled(true)
        case .logout:
            fixture.state.auth = nil
            fixture.analytics.clearIdentity()
            fixture.state.auth = InsightValues.authorization()
            fixture.analytics.accountStateChanged()
        case .otherAccount:
            fixture.state.auth = InsightValues.authorization(user: InsightValues.otherUser)
            fixture.analytics.accountStateChanged()
        case .reset:
            fixture.tracker.reset()
        case .stop:
            fixture.analytics.stop()
        }
        #expect(fixture.tracker.captureResponse(key: "card", response: .selected) == nil)
        fixture.tracker.present(key: "card", kind: .suggestion)
        fixture.tracker.recordResponse(old)
        #expect(!fixture.insights.contains { $0.kind == .cardResponded })
        if boundary != .stop {
            let fresh = try #require(fixture.tracker.captureResponse(key: "card", response: .dismissed))
            fixture.tracker.recordResponse(fresh)
            #expect(fixture.insights.last?.response == .dismissed)
        }
    }

    @Test("Temporary same-account verification pauses and resumes without changing presentation provenance")
    func temporaryVerification() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "card", kind: .approval)
        let token = try #require(fixture.tracker.captureResponse(key: "card", response: .denied))
        fixture.state.auth = nil
        fixture.analytics.accountStateChanged()
        fixture.tracker.recordResponse(token)
        #expect(fixture.insights.count == 1)
        fixture.state.auth = InsightValues.authorization(token: "new-secret")
        fixture.analytics.accountStateChanged()
        fixture.tracker.present(key: "card", kind: .approval)
        fixture.tracker.recordResponse(token)
        #expect(fixture.insights.map(\.kind) == [.cardPresented, .cardResponded])
    }

    @Test("A response token belongs only to the tracker that captured the visible card")
    func trackerIdentity() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        let other = PetInsightCardTracker(analytics: fixture.analytics, now: { InsightValues.date })
        fixture.tracker.present(key: "card", kind: .suggestion)
        other.present(key: "card", kind: .suggestion)
        let token = try #require(fixture.tracker.captureResponse(key: "card", response: .selected))
        other.recordResponse(token)
        #expect(fixture.insights.count == 2)
        fixture.tracker.recordResponse(token)
        #expect(fixture.insights.count == 3)
    }

    @Test("The tracker bounds retained cards and ignores late responses after eviction")
    func boundedCards() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "first", kind: .suggestion)
        let token = try #require(fixture.tracker.captureResponse(key: "first", response: .selected))
        for number in 0..<PetInsightCardTracker.maximumTrackedCards {
            fixture.tracker.present(key: "card-\(number)", kind: .suggestion)
        }
        #expect(fixture.tracker.captureResponse(key: "first", response: .selected) == nil)
        let count = fixture.insights.count
        fixture.tracker.present(key: "card-255", kind: .suggestion)
        fixture.tracker.recordResponse(token)
        #expect(fixture.insights.count == count)
        #expect(fixture.tracker.captureResponse(key: "card-255", response: .selected) != nil)
        #expect(fixture.store.events.count <= PetUsageAnalytics.maximumEventCount)
    }

    @Test("Empty, oversized, or non-card local keys never create exposure")
    func localKeyLimits() {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.tracker.present(key: "", kind: .suggestion)
        fixture.tracker.present(key: String(repeating: "x", count: 1_025), kind: .suggestion)
        fixture.tracker.present(key: "card", kind: .none)
        #expect(fixture.store.events.isEmpty)
    }

    @Test("Connection observations deduplicate by UTC date and normalized observed environment")
    func connectionObservation() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        let context = try #require(fixture.analytics.captureContext())
        for _ in 0..<3 {
            fixture.analytics.observeConnection(codexVersion: "0.154.0", mode: .plugin, compatibility: .qualified, context: context)
        }
        fixture.analytics.observeConnection(codexVersion: "0.154.0", mode: .managed, compatibility: .unknown, context: context)
        fixture.analytics.observeConnection(context: context)
        fixture.analytics.observeConnection(codexVersion: "codex-cli 0.154.0 /Users/person/private", context: context)
        #expect(fixture.insights.count == 3)
        #expect(fixture.insights.last?.codexVersion == "unknown")
        #expect(fixture.insights.last?.connectionMode == .unknown && fixture.insights.last?.compatibility == .unknown)
        fixture.state.advanceDate(86_400)
        fixture.analytics.observeConnection(codexVersion: "0.154.0", mode: .plugin, compatibility: .qualified, context: context)
        #expect(fixture.insights.count == 4)
        #expect(fixture.insights.allSatisfy { $0.kind == .connectionObserved && $0.cardID == nil })
        fixture.analytics.setEnabled(false)
        fixture.analytics.setEnabled(true)
        fixture.analytics.observeConnection(codexVersion: "0.154.0", context: context)
        #expect(fixture.store.events.isEmpty)
    }

    @Test("Malformed kinds, mismatched card responses, stale timestamps, and generic record calls are rejected")
    func invalidInsights() throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        let context = try #require(fixture.analytics.captureContext())
        let invalid: [PetInsightMetricPayload] = [
            .init(kind: .cardPresented, occurredAt: InsightValues.date, environment: InsightValues.environment),
            .init(kind: .cardPresented, occurredAt: InsightValues.date, cardID: UUID(), cardKind: .suggestion,
                  environment: InsightValues.environment, codexVersion: "0.154.0"),
            .init(kind: .cardResponded, occurredAt: InsightValues.date, cardID: UUID(), cardKind: .suggestion,
                  response: .approved, reactionBucket: .under5s, environment: InsightValues.environment),
            .init(kind: .connectionObserved, occurredAt: InsightValues.date, environment: InsightValues.environment),
            .init(kind: .connectionObserved, occurredAt: InsightValues.date.addingTimeInterval(-8 * 86_400),
                  environment: InsightValues.environment, connectionMode: .unknown, compatibility: .unknown),
            .init(kind: .connectionObserved, occurredAt: InsightValues.date.addingTimeInterval(301),
                  environment: InsightValues.environment, connectionMode: .unknown, compatibility: .unknown),
        ]
        for payload in invalid { #expect(!fixture.analytics.recordInsight(payload, context: context)) }
        fixture.analytics.record(.insightMetric, context: context)
        fixture.analytics.observeConnection(mode: .none, context: context)
        fixture.analytics.observeConnection(compatibility: .none, context: context)
        #expect(fixture.store.events.isEmpty)
    }

    @Test("Insight retry reuses the exact event and analytics-card IDs")
    func retryIDs() async throws {
        let fixture = InsightFixture()
        defer { fixture.analytics.stop() }
        fixture.sender.results = [.retry, .accepted]
        fixture.tracker.present(key: "card", kind: .approval)
        await insightSettle { fixture.sender.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.sender.calls[0] == fixture.sender.calls[1])
        #expect(fixture.state.delays == [30])
    }
}

@Suite("Fixed insight transport and restoration")
@MainActor
struct PetInsightTransportTests {
    @Test("Insight RPC contains exactly fourteen fixed fields and never local identities", arguments: [
        PetInsightMetricKind.cardPresented, .cardResponded, .connectionObserved,
    ], [true, false])
    func rpcContract(_ kind: PetInsightMetricKind, _ responseValue: Bool) async throws {
        var captured: URLRequest?
        let payload = InsightValues.payload(kind)
        let event = InsightValues.event(payload)
        let sender = PetSupabaseUsageService(configuration: InsightValues.configuration, transport: { request in
            captured = request
            return (Data(String(responseValue).utf8), InsightValues.response(request))
        }, now: { InsightValues.date })
        #expect(try await sender.send(event, authorization: InsightValues.authorization()) == .accepted)
        let request = try #require(captured)
        #expect(request.url?.path == "/rest/v1/rpc/record_blabee_insight_event")
        #expect(!request.httpShouldHandleCookies)
        let data = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(body.keys) == ["p_event_id", "p_occurred_at", "p_metric_kind", "p_card_id", "p_card_kind",
            "p_response", "p_reaction_bucket", "p_app_version", "p_app_build", "p_os_major", "p_ui_language",
            "p_codex_version", "p_connection_mode", "p_compatibility"])
        #expect(body["p_metric_kind"] as? String == kind.rawValue)
        if kind == .connectionObserved {
            #expect(body["p_card_id"] is NSNull)
            #expect(body["p_codex_version"] as? String == "0.154.0")
        } else {
            #expect(body["p_card_id"] as? String == payload.cardID?.uuidString.lowercased())
            #expect(body["p_codex_version"] as? String == "unknown")
        }
        let text = String(decoding: data, as: UTF8.self)
        for forbidden in [InsightValues.user, "private-token", "userID", "consentID", "localKey", "session", "question", "answer", "path"] {
            #expect(!text.contains(forbidden))
        }
    }

    @Test("Mixed event kinds and payloads never reach the transport")
    func malformedEventRouting() async throws {
        var requests = 0
        let sender = PetSupabaseUsageService(configuration: InsightValues.configuration, transport: { request in
            requests += 1
            return (Data("true".utf8), InsightValues.response(request))
        }, now: { InsightValues.date })
        let insight = InsightValues.payload(.cardPresented)
        let product = PetProductMetricPayload(kind: .accountReady, occurredAt: InsightValues.date, environment: InsightValues.environment)
        let rows: [PetUsageEvent] = [
            .init(userID: InsightValues.user, eventID: UUID(), kind: .insightMetric, occurredAt: InsightValues.date),
            .init(userID: InsightValues.user, eventID: UUID(), kind: .choiceAccepted, occurredAt: InsightValues.date, insight: insight),
            .init(userID: InsightValues.user, eventID: UUID(), kind: .productMetric, occurredAt: InsightValues.date, product: product, insight: insight),
            .init(userID: InsightValues.user, eventID: UUID(), kind: .insightMetric, occurredAt: InsightValues.date, product: product, insight: insight),
            .init(userID: InsightValues.user, eventID: UUID(), kind: .insightMetric, occurredAt: InsightValues.date.addingTimeInterval(1), insight: insight),
        ]
        for row in rows { #expect(try await sender.send(row, authorization: InsightValues.authorization()) == .discard) }
        #expect(requests == 0)
    }

    @Test("Persisted Codex versions are normalized and arbitrary enum contents are rejected")
    func strictDecoding() throws {
        let payload = InsightValues.payload(.connectionObserved)
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])
        object["codexVersion"] = "codex-cli /Users/person/project token-secret"
        let normalized = try JSONDecoder().decode(PetInsightMetricPayload.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(normalized.codexVersion == "unknown" && normalized.isValid)
        let encoded = String(decoding: try JSONEncoder().encode(normalized), as: UTF8.self)
        #expect(!encoded.contains("person") && !encoded.contains("token-secret"))
        for field in ["kind", "cardKind", "response", "reactionBucket", "connectionMode", "compatibility"] {
            var malformed = object
            malformed[field] = "arbitrary private content"
            let data = try JSONSerialization.data(withJSONObject: malformed)
            #expect(throws: (any Error).self) { try JSONDecoder().decode(PetInsightMetricPayload.self, from: data) }
        }
    }

    @Test("Mixed usage, product, and insight outboxes survive restore and keep duplicate IDs stable")
    func mixedOutbox() async throws {
        let insight = InsightValues.event(InsightValues.payload(.cardPresented))
        let product = PetUsageEvent(userID: InsightValues.user, eventID: UUID(), kind: .productMetric,
            occurredAt: InsightValues.date, product: .init(kind: .accountReady, occurredAt: InsightValues.date, environment: InsightValues.environment))
        let usage = PetUsageEvent(userID: InsightValues.user, eventID: UUID(), kind: .choiceAccepted, occurredAt: InsightValues.date)
        let directory = URL(fileURLWithPath: "/private/tmp/blabee-insight-outbox-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PetUsageFileStore(directory: directory)
        try store.save([usage, product, insight])
        #expect(try store.load() == [usage, product, insight])
        let fixture = InsightFixture(stored: [usage, product, insight, insight])
        defer { fixture.analytics.stop() }
        await insightSettle { fixture.sender.calls.count == 3 && fixture.store.events.isEmpty }
        #expect(fixture.sender.calls == [usage, product, insight])
    }
}

struct InsightLatencyCase: Sendable {
    let seconds: TimeInterval
    let expected: PetInsightReactionBucket
}

enum InsightBoundary: CaseIterable, Sendable { case optOut, logout, otherAccount, reset, stop }

private enum InsightValues {
    static let date = Date(timeIntervalSince1970: 1_800_000_000)
    static let user = "11111111-1111-4111-8111-111111111111"
    static let otherUser = "22222222-2222-4222-8222-222222222222"
    static let environment = PetProductEnvironment(appVersion: "1.2.3", appBuild: "55", osMajor: "26", uiLanguage: .ko)
    static let configuration = PetAccountConfiguration(supabaseURL: URL(string: "https://insights.example.test")!, publishableKey: "publishable")
    static func authorization(user: String = user, at date: Date = date, token: String = "private-token") -> PetUsageAuthorization {
        .init(userID: user, accessToken: token, expiresAt: date.addingTimeInterval(3_600))
    }
    static func payload(_ kind: PetInsightMetricKind) -> PetInsightMetricPayload {
        if kind == .connectionObserved {
            return .init(kind: kind, occurredAt: date, environment: environment, codexVersion: "0.154.0",
                         connectionMode: .plugin, compatibility: .qualified)
        }
        return .init(kind: kind, occurredAt: date, cardID: UUID(), cardKind: .suggestion,
                     response: kind == .cardResponded ? .selected : .none,
                     reactionBucket: kind == .cardResponded ? .fiveTo30s : .none, environment: environment)
    }
    static func event(_ payload: PetInsightMetricPayload) -> PetUsageEvent {
        .init(userID: user, eventID: UUID(), kind: .insightMetric, occurredAt: payload.occurredAt, insight: payload)
    }
    static func response(_ request: URLRequest) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    }
}

@MainActor
private final class InsightFixture {
    let state = InsightState()
    let store = InsightStore()
    let sender = InsightSender()
    let analytics: PetUsageAnalytics
    let tracker: PetInsightCardTracker
    var insights: [PetInsightMetricPayload] { store.events.compactMap(\.insight) }

    init(enabled: Bool = true, stored: [PetUsageEvent] = []) {
        store.events = stored
        analytics = PetUsageAnalytics(isEnabled: enabled, authorization: { [state] in state.auth }, store: store, service: sender,
            now: { [state] in state.date }, sleep: { [state] in state.delays.append($0) },
            productEnvironment: InsightValues.environment, monotonicNow: { [state] in state.uptime })
        tracker = PetInsightCardTracker(analytics: analytics, now: { [state] in state.date }, monotonicNow: { [state] in state.uptime })
    }
}

@MainActor
private final class InsightState {
    var date = InsightValues.date
    var uptime: TimeInterval = 100
    var auth: PetUsageAuthorization? = InsightValues.authorization()
    var delays: [TimeInterval] = []
    func advanceDate(_ seconds: TimeInterval) {
        date = date.addingTimeInterval(seconds)
        if let auth { self.auth = InsightValues.authorization(user: auth.userID, at: date, token: auth.accessToken) }
    }
}

@MainActor
private final class InsightStore: PetUsageEventStoring {
    var events: [PetUsageEvent] = []
    func load() throws -> [PetUsageEvent] { events }
    func save(_ events: [PetUsageEvent]) throws { self.events = events }
    func clear() throws { events = [] }
}

@MainActor
private final class InsightSender: PetUsageSending {
    var calls: [PetUsageEvent] = []
    var results: [PetUsageDelivery] = []
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        calls.append(event)
        return results.isEmpty ? .accepted : results.removeFirst()
    }
}

@MainActor
private func insightSettle(_ condition: () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
    for _ in 0..<1_000 {
        if condition() { return }
        await Task.yield()
    }
    #expect(condition(), sourceLocation: sourceLocation)
}
