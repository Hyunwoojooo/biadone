import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Consented product metrics")
@MainActor
struct PetProductMetricsTests {
    @Test("The former usage opt-in never enables expanded collection")
    func requiresFreshConsent() throws {
        let suite = "blabee-product-consent-test-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(true, forKey: "blabee.usageAnalytics.enabled")
        let recorder = PetUsageAnalytics.live(defaults: defaults, authorization: { nil })
        defer { recorder.stop() }
        #expect(!recorder.isEnabled)
        recorder.setEnabled(true)
        #expect(defaults.bool(forKey: PetUsageAnalytics.enabledPreferenceKey))
        recorder.stop()
        let restarted = PetUsageAnalytics.live(defaults: defaults, authorization: { nil })
        defer { restarted.stop() }
        #expect(restarted.isEnabled)
    }

    @Test("Consent notification observes finalized identity and pending queue")
    func consentCallback() throws {
        let fixture = ProductFixture(enabled: false)
        defer { fixture.recorder.stop() }
        var observations: [Bool] = []
        fixture.recorder.onConsentChanged = {
            observations.append(fixture.recorder.isEnabled)
            #expect((fixture.recorder.productIdentity != nil) == fixture.recorder.isEnabled)
            if !fixture.recorder.isEnabled { #expect(fixture.store.events.isEmpty) }
        }
        fixture.recorder.setEnabled(true)
        fixture.recorder.observeEnvironment()
        #expect(fixture.store.events.count == 1)
        fixture.recorder.setEnabled(true)
        fixture.recorder.setEnabled(false)
        #expect(observations == [true, false])
    }

    @Test("Disabled or unverified accounts collect no product observations")
    func authenticationAndConsent() {
        let fixture = ProductFixture(enabled: false)
        defer { fixture.recorder.stop() }
        fixture.recorder.observeEnvironment()
        fixture.recorder.observeMilestone(.accountReady)
        #expect(fixture.recorder.beginFeature(feature: .choice, inputMethod: .button) == nil)
        #expect(fixture.recorder.productIdentity == nil)
        fixture.state.auth = nil
        fixture.recorder.setEnabled(true)
        fixture.recorder.observeEnvironment()
        fixture.recorder.observeMilestone(.accountReady)
        #expect(fixture.recorder.beginFeature(feature: .choice, inputMethod: .button) == nil)
        #expect(fixture.store.events.isEmpty)
    }

    @Test("Environment is explicit and deduplicated by UTC day while stages are once per identity")
    func explicitObservations() throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        #expect(fixture.store.events.isEmpty)
        fixture.recorder.observeEnvironment()
        fixture.recorder.observeEnvironment()
        fixture.recorder.observeMilestone(.accountReady)
        fixture.recorder.observeMilestone(.accountReady)
        fixture.recorder.observeMilestone(.environmentObserved)
        fixture.recorder.observeMilestone(.serviceConnected)
        #expect(fixture.products.map(\.kind) == [.environmentObserved, .accountReady, .serviceConnected])
        fixture.state.advanceDate(86_400)
        fixture.recorder.observeEnvironment()
        fixture.recorder.observeMilestone(.accountReady)
        #expect(fixture.products.filter { $0.kind == .environmentObserved }.count == 2)
        #expect(fixture.products.filter { $0.kind == .accountReady }.count == 1)
        let prior = try #require(fixture.recorder.captureContext())
        fixture.state.auth = ProductValues.authorization(user: ProductValues.otherUser, at: fixture.state.date)
        fixture.recorder.accountStateChanged()
        fixture.recorder.observeMilestone(.cardReceived, context: prior)
        #expect(fixture.store.events.isEmpty)
        fixture.recorder.observeEnvironment()
        fixture.recorder.observeMilestone(.accountReady)
        #expect(fixture.products.map(\.kind) == [.environmentObserved, .accountReady])
    }

    @Test("Feature outcomes share original occurrence, environment and operation ID across a wall-clock jump")
    func operationUsesOriginalContext() throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        let operation = try #require(fixture.recorder.beginFeature(feature: .approval, inputMethod: .keyboard))
        fixture.state.advanceDate(86_500)
        fixture.state.uptime += 0.7
        fixture.recorder.finishFeature(operation, outcome: .succeeded)
        fixture.recorder.finishFeature(operation, outcome: .failed)
        let products = fixture.products
        #expect(products.map(\.kind) == [.featureStarted, .featureSucceeded])
        #expect(products.allSatisfy { $0.operationID == operation.operationID && $0.occurredAt == ProductValues.date
            && $0.environment == ProductValues.environment && $0.feature == .approval && $0.inputMethod == .keyboard })
        #expect(products.last?.latencyBucket == .under1s)
        #expect(fixture.store.events.allSatisfy { $0.kind == .productMetric })
    }

    @Test("Latency is a coarse monotonic bucket, including invalid clock results", arguments: [
        ProductLatencyCase(seconds: 0, expected: .under1s),
        ProductLatencyCase(seconds: 0.999, expected: .under1s),
        ProductLatencyCase(seconds: 1, expected: .oneTo3s),
        ProductLatencyCase(seconds: 3, expected: .oneTo3s),
        ProductLatencyCase(seconds: 3.001, expected: .over3s),
        ProductLatencyCase(seconds: -1, expected: .unknown),
        ProductLatencyCase(seconds: .infinity, expected: .unknown),
        ProductLatencyCase(seconds: .nan, expected: .unknown),
    ])
    func latencyBuckets(_ test: ProductLatencyCase) throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        let operation = try #require(fixture.recorder.beginFeature(feature: .dismiss, inputMethod: .button))
        fixture.state.uptime += test.seconds
        fixture.recorder.finishFeature(operation, outcome: .cancelled)
        #expect(fixture.products.last?.kind == .featureCancelled)
        #expect(fixture.products.last?.latencyBucket == test.expected)
    }

    @Test("A feature beginning with a nonfinite monotonic clock still has an unknown outcome bucket")
    func nonfiniteStartClock() throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        fixture.state.uptime = .nan
        let operation = try #require(fixture.recorder.beginFeature(feature: .choice, inputMethod: .button))
        fixture.state.uptime = 3
        fixture.recorder.finishFeature(operation, outcome: .failed)
        #expect(fixture.products.last?.kind == .featureFailed)
        #expect(fixture.products.last?.latencyBucket == .unknown)
    }

    @Test("In-flight operations and consent IDs are fenced across account and consent boundaries", arguments: ProductBoundary.allCases)
    func staleOperations(_ boundary: ProductBoundary) throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        let identity = try #require(fixture.recorder.productIdentity)
        let operation = try #require(fixture.recorder.beginFeature(feature: .choice, inputMethod: .button))
        switch boundary {
        case .optOut:
            fixture.recorder.setEnabled(false)
            fixture.recorder.setEnabled(true)
        case .logout:
            fixture.state.auth = nil
            fixture.recorder.clearIdentity()
            fixture.state.auth = ProductValues.authorization()
            fixture.recorder.accountStateChanged()
        case .otherUser:
            fixture.state.auth = ProductValues.authorization(user: ProductValues.otherUser)
            fixture.recorder.accountStateChanged()
        case .stop:
            fixture.recorder.stop()
        }
        fixture.recorder.finishFeature(operation, outcome: .succeeded)
        #expect(!fixture.products.contains { $0.kind == .featureSucceeded })
        #expect(fixture.recorder.productIdentity != identity)
        if boundary != .stop { #expect(fixture.recorder.productIdentity?.consentID != identity.consentID) }
    }

    @Test("Same-account verification and token refresh preserve consent and operation provenance")
    func sameUserRefresh() throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        let identity = try #require(fixture.recorder.productIdentity)
        let operation = try #require(fixture.recorder.beginFeature(feature: .choice, inputMethod: .keyboard))
        fixture.state.auth = nil
        fixture.recorder.accountStateChanged()
        #expect(fixture.recorder.productIdentity == nil)
        fixture.state.auth = ProductValues.authorization(token: "renewed-secret")
        fixture.recorder.accountStateChanged()
        fixture.recorder.finishFeature(operation, outcome: .succeeded)
        #expect(fixture.recorder.productIdentity == identity)
        #expect(fixture.products.map(\.kind) == [.featureStarted, .featureSucceeded])
    }

    @Test("Consent provenance survives restart and detects an account change after restart")
    func restoredIdentity() throws {
        let original = ProductFixture()
        let identity = try #require(original.recorder.productIdentity)
        original.recorder.stop()
        let same = ProductFixture(consentID: identity.consentID, identity: identity)
        defer { same.recorder.stop() }
        #expect(same.recorder.productIdentity == identity)
        let other = ProductFixture(user: ProductValues.otherUser, consentID: identity.consentID, identity: identity)
        defer { other.recorder.stop() }
        #expect(other.recorder.productIdentity?.userID == ProductValues.otherUser)
        #expect(other.recorder.productIdentity?.consentID != identity.consentID)
    }

    @Test("Update availability is deduplicated by day and normalized target with bounded memory")
    func updateAvailability() throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        fixture.recorder.observeUpdateAvailable(version: "1.2", build: "70", context: context)
        fixture.recorder.observeUpdateAvailable(version: "1.2", build: "70", context: context)
        #expect(fixture.products.count == 1)
        fixture.state.advanceDate(86_400)
        fixture.recorder.observeUpdateAvailable(version: "1.2", build: "70", context: context)
        #expect(fixture.products.count == 2)
        for build in 100..<500 {
            fixture.recorder.observeUpdateAvailable(version: "1.2", build: String(build), context: context)
        }
        #expect(fixture.products.count <= PetUsageAnalytics.maximumEventCount)
        #expect(!fixture.products.contains { $0.targetBuild == "499" })
        #expect(fixture.products.allSatisfy { $0.operationID == nil && $0.feature == .appUpdate })
    }

    @Test("Invalid metric shapes and stale/future timestamps never enter the outbox")
    func rejectedShapes() throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        let invalid = [
            PetProductMetricPayload(kind: .featureSucceeded, occurredAt: ProductValues.date, environment: ProductValues.environment),
            .init(kind: .updateStarted, occurredAt: ProductValues.date, feature: .appUpdate, environment: ProductValues.environment),
            .init(kind: .accountReady, occurredAt: ProductValues.date, operationID: UUID(), environment: ProductValues.environment),
            .init(kind: .environmentObserved, occurredAt: ProductValues.date.addingTimeInterval(-8 * 86_400), environment: ProductValues.environment),
            .init(kind: .environmentObserved, occurredAt: ProductValues.date.addingTimeInterval(301), environment: ProductValues.environment),
        ]
        for payload in invalid { fixture.recorder.recordProduct(payload, context: context) }
        fixture.recorder.record(.productMetric, context: context)
        #expect(fixture.recorder.beginFeature(feature: .appUpdate, inputMethod: .button) == nil)
        #expect(fixture.recorder.beginFeature(feature: .choice, inputMethod: .none) == nil)
        #expect(fixture.store.events.isEmpty)
    }

    @Test("Product retry preserves the event and operation IDs without serializing credentials")
    func retryIdentity() async throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        fixture.service.results = [.retry, .accepted]
        fixture.recorder.observeEnvironment()
        await productSettle { fixture.service.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls[0] == fixture.service.calls[1])
        #expect(fixture.state.delays == [30])
        let json = String(decoding: try JSONEncoder().encode(fixture.service.calls), as: UTF8.self)
        for forbidden in ["private-token", "accessToken", "consentID", "email", "uptime"] { #expect(!json.contains(forbidden)) }
    }

    @Test("Mixed restored events retain IDs and discard invalid product rows")
    func restoreMixedOutbox() async throws {
        let payload = PetProductMetricPayload(kind: .accountReady, occurredAt: ProductValues.date, environment: ProductValues.environment)
        let valid = PetUsageEvent(userID: ProductValues.user, eventID: UUID(), kind: .productMetric,
                                  occurredAt: ProductValues.date, product: payload)
        let legacy = PetUsageEvent(userID: ProductValues.user, eventID: UUID(), kind: .choiceAccepted, occurredAt: ProductValues.date)
        let malformed = PetUsageEvent(userID: ProductValues.user, eventID: UUID(), kind: .productMetric, occurredAt: ProductValues.date)
        let fixture = ProductFixture(stored: [valid, valid, legacy, malformed])
        defer { fixture.recorder.stop() }
        await productSettle { fixture.service.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls == [valid, legacy])
    }

    @Test("Larger product records respect both the event-count and file-byte budgets")
    func byteBudget() throws {
        let fixture = ProductFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        let longVersion = "123456.123456.123456.123456"
        let environment = PetProductEnvironment(appVersion: longVersion, appBuild: longVersion, osMajor: "123456", uiLanguage: .ko)
        for _ in 0..<300 {
            fixture.recorder.recordProduct(.init(kind: .updateStarted, occurredAt: ProductValues.date, operationID: UUID(),
                feature: .appUpdate, environment: environment, targetVersion: longVersion, targetBuild: longVersion), context: context)
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        let data = try encoder.encode(fixture.store.events)
        #expect(data.count <= PetUsageFileStore.maximumBytes)
        #expect(!fixture.store.events.isEmpty && fixture.store.events.count <= PetUsageAnalytics.maximumEventCount)
    }
}

@Suite("Fixed product metric transport and storage")
@MainActor
struct PetProductTransportTests {
    @Test("Product RPC sends exactly thirteen allowlisted fields and no account identity", arguments: [true, false])
    func rpcContract(_ accepted: Bool) async throws {
        var captured: URLRequest?
        let payload = PetProductMetricPayload(kind: .environmentObserved, occurredAt: ProductValues.date, environment: ProductValues.environment)
        let event = PetUsageEvent(userID: ProductValues.user, eventID: UUID(), kind: .productMetric, occurredAt: ProductValues.date, product: payload)
        let service = PetSupabaseUsageService(configuration: ProductValues.configuration, transport: { request in
            captured = request
            return (Data(String(accepted).utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, now: { ProductValues.date })
        #expect(try await service.send(event, authorization: ProductValues.authorization()) == .accepted)
        let request = try #require(captured)
        #expect(request.url?.path == "/rest/v1/rpc/record_blabee_product_event")
        #expect(!request.httpShouldHandleCookies)
        let data = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(body.keys) == ["p_event_id", "p_occurred_at", "p_metric_kind", "p_operation_id", "p_feature",
            "p_input_method", "p_latency_bucket", "p_app_version", "p_app_build", "p_os_major", "p_ui_language",
            "p_target_version", "p_target_build"])
        #expect(body["p_operation_id"] is NSNull)
        #expect(body["p_metric_kind"] as? String == "environment_observed")
        #expect(body["p_os_major"] as? String == "26")
        #expect(body["p_ui_language"] as? String == "ko")
        let text = String(decoding: data, as: UTF8.self)
        for forbidden in [ProductValues.user, "private-token", "consentID", "userID", "email", "26.1", "path"] {
            #expect(!text.contains(forbidden))
        }
    }

    @Test("Malformed mixed-kind events are rejected before any network call")
    func mixedKindRejected() async throws {
        var calls = 0
        let service = PetSupabaseUsageService(configuration: ProductValues.configuration, transport: { request in
            calls += 1
            return (Data("true".utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, now: { ProductValues.date })
        let payload = PetProductMetricPayload(kind: .accountReady, occurredAt: ProductValues.date, environment: ProductValues.environment)
        let rows = [
            PetUsageEvent(userID: ProductValues.user, eventID: UUID(), kind: .productMetric, occurredAt: ProductValues.date),
            .init(userID: ProductValues.user, eventID: UUID(), kind: .choiceAccepted, occurredAt: ProductValues.date, product: payload),
            .init(userID: ProductValues.user, eventID: UUID(), kind: .productMetric, occurredAt: ProductValues.date.addingTimeInterval(1), product: payload),
        ]
        for row in rows { #expect(try await service.send(row, authorization: ProductValues.authorization()) == .discard) }
        #expect(calls == 0)
    }

    @Test("Environment and targets strip free text during both construction and persisted decoding")
    func environmentSanitization() throws {
        let environment = PetProductEnvironment(appVersion: "secret-email@example.com", appBuild: "/Users/name/project",
                                               osMajor: "26.1", uiLanguage: .ko)
        #expect(environment.appVersion == "unknown" && environment.appBuild == "unknown" && environment.osMajor == "unknown")
        let payload = PetProductMetricPayload(kind: .updateAvailable, occurredAt: ProductValues.date, feature: .appUpdate,
            environment: environment, targetVersion: "https://private.example", targetBuild: "token with spaces")
        #expect(payload.targetVersion == "unknown" && payload.targetBuild == "unknown" && payload.isValid)
        let data = try JSONEncoder().encode(payload)
        #expect(try JSONDecoder().decode(PetProductMetricPayload.self, from: data) == payload)
        var row = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        row["targetVersion"] = "private raw path"
        var modified = try #require(row["environment"] as? [String: Any])
        modified["appVersion"] = "path leak"
        row["environment"] = modified
        let decoded = try JSONDecoder().decode(PetProductMetricPayload.self, from: JSONSerialization.data(withJSONObject: row))
        #expect(decoded.environment.appVersion == "unknown" && decoded.targetVersion == "unknown")
        for value in ["", "1..2", "1234567", "１", "1.2.3.4.5", "1\n"] {
            #expect(PetProductEnvironment.normalizedVersion(value) == "unknown")
        }
        #expect(PetProductEnvironment.current.uiLanguage == .ko)
    }

    @Test("Private file round-trip preserves product operation and legacy event schemas")
    func fileRoundTrip() throws {
        let directory = URL(fileURLWithPath: "/private/tmp/blabee-product-outbox-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PetUsageFileStore(directory: directory)
        let payload = PetProductMetricPayload(kind: .featureSucceeded, occurredAt: ProductValues.date, operationID: UUID(),
            feature: .choice, inputMethod: .keyboard, latencyBucket: .oneTo3s, environment: ProductValues.environment)
        let rows = [
            PetUsageEvent(userID: ProductValues.user, eventID: UUID(), kind: .productMetric, occurredAt: ProductValues.date, product: payload),
            .init(userID: ProductValues.user, eventID: UUID(), kind: .approvalResolved, occurredAt: ProductValues.date),
        ]
        try store.save(rows)
        #expect(try store.load() == rows)
        let data = try Data(contentsOf: directory.appendingPathComponent(PetUsageFileStore.fileName))
        let persisted = try #require(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        #expect(Set(persisted[1].keys) == ["userID", "eventID", "kind", "occurredAt"])
        #expect(!String(decoding: data, as: UTF8.self).contains("token"))
    }
}

struct ProductLatencyCase: Sendable {
    let seconds: Double
    let expected: PetProductLatencyBucket
}

enum ProductBoundary: CaseIterable, Sendable { case optOut, logout, otherUser, stop }

private enum ProductValues {
    static let date = Date(timeIntervalSince1970: 1_800_000_000)
    static let user = "11111111-1111-4111-8111-111111111111"
    static let otherUser = "22222222-2222-4222-8222-222222222222"
    static let environment = PetProductEnvironment(appVersion: "1.2.3", appBuild: "55", osMajor: "26", uiLanguage: .ko)
    static let configuration = PetAccountConfiguration(supabaseURL: URL(string: "https://metrics.example.test")!, publishableKey: "public-key")
    static func authorization(user: String = user, at: Date = date, token: String = "private-token") -> PetUsageAuthorization {
        .init(userID: user, accessToken: token, expiresAt: at.addingTimeInterval(3_600))
    }
}

@MainActor
private final class ProductFixture {
    let state = ProductState()
    let store = ProductStore()
    let service = ProductSender()
    let recorder: PetUsageAnalytics
    var products: [PetProductMetricPayload] { store.events.compactMap(\.product) }

    init(enabled: Bool = true, user: String = ProductValues.user, stored: [PetUsageEvent] = [],
         consentID: UUID = UUID(), identity: PetProductIdentity? = nil) {
        state.auth = ProductValues.authorization(user: user)
        store.events = stored
        recorder = PetUsageAnalytics(isEnabled: enabled, authorization: { [state] in state.auth }, store: store, service: service,
            now: { [state] in state.date }, sleep: { [state] in state.delays.append($0) },
            productEnvironment: ProductValues.environment, monotonicNow: { [state] in state.uptime },
            consentID: consentID, persistedProductIdentity: identity,
            saveConsentID: { [state] in state.savedConsent = $0 }, saveProductIdentity: { [state] in state.savedIdentity = $0 })
    }
}

@MainActor
private final class ProductState {
    var date = ProductValues.date
    var uptime: TimeInterval = 100
    var auth: PetUsageAuthorization? = ProductValues.authorization()
    var delays: [TimeInterval] = []
    var savedConsent: UUID?
    var savedIdentity: PetProductIdentity?
    func advanceDate(_ seconds: TimeInterval) {
        date = date.addingTimeInterval(seconds)
        if let auth { self.auth = ProductValues.authorization(user: auth.userID, at: date, token: auth.accessToken) }
    }
}

@MainActor
private final class ProductStore: PetUsageEventStoring {
    var events: [PetUsageEvent] = []
    func load() throws -> [PetUsageEvent] { events }
    func save(_ events: [PetUsageEvent]) throws { self.events = events }
    func clear() throws { events = [] }
}

@MainActor
private final class ProductSender: PetUsageSending {
    var calls: [PetUsageEvent] = []
    var results: [PetUsageDelivery] = []
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        calls.append(event)
        return results.isEmpty ? .accepted : results.removeFirst()
    }
}

@MainActor
private func productSettle(_ condition: () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
    for _ in 0..<1_000 {
        if condition() { return }
        await Task.yield()
    }
    #expect(condition(), sourceLocation: sourceLocation)
}
