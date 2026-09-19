import Foundation
import Testing
@testable import BlabeeCoordinator

private enum ProductUpdateValues {
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static let userID = "00000000-0000-0000-0000-000000000001"
    static let otherUserID = "00000000-0000-0000-0000-000000000002"
    static let jobID = "00000000-0000-0000-0000-000000000003"
    static let target = PetAppUpdateVersion(version: "0.1.0", build: "55")!
    static let sourceEnvironment = PetProductEnvironment(appVersion: "0.1.0", appBuild: "54", osMajor: "15", uiLanguage: .ko)
    static let targetEnvironment = PetProductEnvironment(appVersion: "0.1.0", appBuild: "55", osMajor: "15", uiLanguage: .ko)

    static func observation(_ result: PetProductUpdateObservation.Result,
                            jobID: String = jobID, version: String = "0.1.0", build: String = "55") -> PetProductUpdateObservation {
        .init(journalJobID: jobID, targetVersion: version, targetBuild: build, result: result)
    }
}

@MainActor
private final class ProductUpdateMetricsState {
    var now = ProductUpdateValues.now
    var auth: PetUsageAuthorization? = .init(userID: ProductUpdateValues.userID, accessToken: "test-only-token",
                                            expiresAt: ProductUpdateValues.now.addingTimeInterval(365 * 86_400))
    var consentID = UUID()
    var identity: PetProductIdentity?
}

@MainActor
private final class ProductUpdateMarkerStore: PetProductUpdateMarkerStoring {
    var data: Data?
    func load() -> Data? { data }
    func save(_ data: Data) { self.data = data }
    func clear() { data = nil }
}

@MainActor
private final class ProductUpdateEventStore: PetUsageEventStoring {
    var events: [PetUsageEvent] = []
    func load() throws -> [PetUsageEvent] { events }
    func save(_ events: [PetUsageEvent]) throws { self.events = events }
    func clear() throws { events = [] }
}

@MainActor
private struct ProductUpdateSender: PetUsageSending {
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        // Retain the outbox for assertions without network access or retry loops.
        .waitForAuthorization
    }
}

@MainActor
private final class ProductUpdateMetricsFixture {
    let state: ProductUpdateMetricsState
    let markerStore: ProductUpdateMarkerStore
    let eventStore = ProductUpdateEventStore()
    let analytics: PetUsageAnalytics
    let metrics: PetProductUpdateMetrics

    init(enabled: Bool = true, state: ProductUpdateMetricsState = .init(),
         markerStore: ProductUpdateMarkerStore = .init(),
         environment: PetProductEnvironment = ProductUpdateValues.sourceEnvironment) {
        self.state = state
        self.markerStore = markerStore
        analytics = PetUsageAnalytics(isEnabled: enabled, authorization: { state.auth }, store: eventStore,
            service: ProductUpdateSender(), now: { state.now }, productEnvironment: environment,
            consentID: state.consentID, persistedProductIdentity: state.identity,
            saveConsentID: { state.consentID = $0 }, saveProductIdentity: { state.identity = $0 })
        metrics = PetProductUpdateMetrics(analytics: analytics, store: markerStore, now: { state.now })
    }

    var products: [PetProductMetricPayload] { eventStore.events.compactMap(\.product) }
    var kinds: [PetProductMetricKind] { products.map(\.kind) }

    @discardableResult
    func beginAttached() throws -> UUID {
        let operation = try #require(metrics.start(target: ProductUpdateValues.target))
        metrics.attachJournal(ProductUpdateValues.jobID, operationID: operation)
        return operation
    }
}

@Suite("Product update metrics") @MainActor
struct PetProductUpdateMetricsTests {
    @Test("disabled or unverified users do not create update attempts", arguments: [false, true])
    func collectionRequiresConsentAndAuthentication(unverified: Bool) {
        let state = ProductUpdateMetricsState()
        if unverified { state.auth = nil }
        let fixture = ProductUpdateMetricsFixture(enabled: unverified, state: state)
        defer { fixture.analytics.stop() }
        #expect(fixture.metrics.start(target: ProductUpdateValues.target) == nil)
        #expect(fixture.products.isEmpty)
        #expect(fixture.markerStore.data == nil)
    }

    @Test("one attempt preserves source time and environment and has a separate operation UUID")
    func startPayload() throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let operation = try fixture.beginAttached()
        let payload = try #require(fixture.products.first)
        #expect(payload.kind == .updateStarted)
        #expect(payload.operationID == operation)
        #expect(operation.uuidString.lowercased() != ProductUpdateValues.jobID)
        #expect(payload.occurredAt == ProductUpdateValues.now)
        #expect(payload.environment == ProductUpdateValues.sourceEnvironment)
        #expect(payload.feature == .appUpdate)
        #expect(payload.inputMethod == .none && payload.latencyBucket == .none)
        #expect(payload.targetVersion == "0.1.0" && payload.targetBuild == "55")
        let encoded = String(decoding: try JSONEncoder().encode(payload), as: UTF8.self)
        #expect(!encoded.contains(ProductUpdateValues.jobID))
        #expect(!encoded.contains("journal") && !encoded.contains("test-only-token"))
    }

    @Test("explicit failure and cancellation finish once with the original operation", arguments: [false, true])
    func terminalPayload(cancelled: Bool) throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let operation = try fixture.beginAttached()
        fixture.state.now = fixture.state.now.addingTimeInterval(120)
        fixture.metrics.finish(cancelled ? .cancelled : .failed, operationID: operation)
        fixture.metrics.finish(.failed, operationID: operation)
        #expect(fixture.kinds == [.updateStarted, cancelled ? .updateCancelled : .updateFailed])
        #expect(fixture.products.last?.operationID == operation)
        #expect(fixture.products.last?.occurredAt == ProductUpdateValues.now)
        #expect(fixture.markerStore.data == nil)
    }

    @Test("source process cannot mark helper readiness as success")
    func sourceSuccessIsIgnored() throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let operation = try fixture.beginAttached()
        fixture.metrics.finish(.succeeded, operationID: operation)
        fixture.metrics.recover { _ in ProductUpdateValues.observation(.pending) }
        #expect(fixture.kinds == [.updateStarted])
        #expect(fixture.markerStore.data != nil)
    }

    @Test("a replaced preparation cancels its own attempt and ignores stale completion")
    func replacementFencesStaleOperation() throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let first = try fixture.beginAttached()
        let second = try #require(fixture.metrics.start(target: ProductUpdateValues.target))
        fixture.metrics.finish(.failed, operationID: first)
        fixture.metrics.attachJournal(ProductUpdateValues.jobID, operationID: first)
        let marker = try JSONDecoder().decode(PetProductUpdateMarker.self, from: #require(fixture.markerStore.data))
        #expect(marker.operationID == second && marker.journalJobID == nil)
        #expect(fixture.kinds == [.updateStarted, .updateCancelled, .updateStarted])
    }

    @Test("an invalid journal ID cannot enter the local marker")
    func invalidJournalRejected() throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let operation = try #require(fixture.metrics.start(target: ProductUpdateValues.target))
        fixture.metrics.attachJournal("/private/project/session.json", operationID: operation)
        let marker = try JSONDecoder().decode(PetProductUpdateMarker.self, from: #require(fixture.markerStore.data))
        #expect(marker.journalJobID == nil)
        #expect(!String(decoding: try #require(fixture.markerStore.data), as: UTF8.self).contains("/private"))
    }

    @Test("recovery requires exact local job and target matching", arguments: ["job", "version", "build"])
    func mismatchedObservationIsIgnored(mismatch: String) throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        try fixture.beginAttached()
        fixture.metrics.recover { _ in
            ProductUpdateValues.observation(.targetRunning,
                jobID: mismatch == "job" ? UUID().uuidString.lowercased() : ProductUpdateValues.jobID,
                version: mismatch == "version" ? "0.2.0" : "0.1.0", build: mismatch == "build" ? "56" : "55")
        }
        #expect(fixture.kinds == [.updateStarted])
        #expect(fixture.markerStore.data != nil)
    }

    @Test("restart uses the original operation and environment and consumes the marker once", arguments: [false, true])
    func restartOutcome(failed: Bool) throws {
        let source = ProductUpdateMetricsFixture()
        let operation = try source.beginAttached()
        source.analytics.stop()
        source.state.now = source.state.now.addingTimeInterval(300)
        let target = ProductUpdateMetricsFixture(state: source.state, markerStore: source.markerStore,
                                                environment: ProductUpdateValues.targetEnvironment)
        defer { target.analytics.stop() }
        var observations = 0
        for _ in 0..<2 {
            target.metrics.recover { jobID in
                observations += 1
                #expect(jobID == ProductUpdateValues.jobID)
                return ProductUpdateValues.observation(failed ? .failed : .targetRunning)
            }
        }
        #expect(observations == 1)
        #expect(target.kinds == [failed ? .updateFailed : .updateSucceeded])
        #expect(target.products.first?.operationID == operation)
        #expect(target.products.first?.occurredAt == ProductUpdateValues.now)
        #expect(target.products.first?.environment == ProductUpdateValues.sourceEnvironment)
        #expect(target.markerStore.data == nil)
    }

    @Test("consent or account changes prevent late recovery", arguments: ["opt_out_in", "logout_in", "other_account"])
    func changedIdentityDropsMarker(change: String) throws {
        let source = ProductUpdateMetricsFixture()
        try source.beginAttached()
        switch change {
        case "opt_out_in": source.analytics.setEnabled(false); source.analytics.setEnabled(true)
        case "logout_in": source.analytics.clearIdentity(); source.analytics.accountStateChanged()
        default:
            source.state.auth = .init(userID: ProductUpdateValues.otherUserID, accessToken: "test-only-token",
                                      expiresAt: source.state.now.addingTimeInterval(3_600))
            source.analytics.accountStateChanged()
        }
        source.analytics.stop()
        let restarted = ProductUpdateMetricsFixture(state: source.state, markerStore: source.markerStore)
        defer { restarted.analytics.stop() }
        var observed = false
        restarted.metrics.recover { _ in observed = true; return ProductUpdateValues.observation(.targetRunning) }
        #expect(!observed)
        #expect(restarted.products.isEmpty)
        #expect(restarted.markerStore.data == nil)
    }

    @Test("explicit same-process identity changes also fence an in-flight completion", arguments: [false, true])
    func lateSourceOutcomeIsDropped(optOut: Bool) throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let operation = try fixture.beginAttached()
        if optOut { fixture.analytics.setEnabled(false); fixture.analytics.setEnabled(true) }
        else { fixture.analytics.clearIdentity(); fixture.analytics.accountStateChanged() }
        fixture.metrics.finish(.failed, operationID: operation)
        #expect(fixture.products.isEmpty)
        #expect(fixture.markerStore.data == nil)
    }

    @Test("temporarily unverified authentication defers recovery until the same account is verified")
    func unverifiedRecoveryIsDeferred() throws {
        let source = ProductUpdateMetricsFixture()
        try source.beginAttached()
        let savedAuth = source.state.auth
        source.analytics.stop()
        source.state.auth = nil
        let restarted = ProductUpdateMetricsFixture(state: source.state, markerStore: source.markerStore)
        defer { restarted.analytics.stop() }
        var observations = 0
        restarted.metrics.recover { _ in observations += 1; return ProductUpdateValues.observation(.targetRunning) }
        #expect(observations == 0 && restarted.markerStore.data != nil)
        restarted.state.auth = savedAuth
        restarted.analytics.accountStateChanged()
        restarted.metrics.recover { _ in observations += 1; return ProductUpdateValues.observation(.targetRunning) }
        #expect(observations == 1)
        #expect(restarted.kinds == [.updateSucceeded])
    }

    @Test("explicit logout clears update provenance immediately")
    func explicitLogoutClearsMarker() throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let operation = try fixture.beginAttached()
        fixture.metrics.clearIdentity()
        fixture.metrics.finish(.failed, operationID: operation)
        #expect(fixture.markerStore.data == nil)
        #expect(fixture.kinds == [.updateStarted])
    }

    @Test("enabling consent cannot adopt an update that began while disabled")
    func noHistoricalAdoption() {
        let fixture = ProductUpdateMetricsFixture(enabled: false)
        defer { fixture.analytics.stop() }
        let operation = fixture.metrics.start(target: ProductUpdateValues.target)
        fixture.analytics.setEnabled(true)
        fixture.metrics.attachJournal(ProductUpdateValues.jobID, operationID: operation)
        fixture.metrics.recover { _ in Issue.record("No marker should request an old journal"); return nil }
        #expect(fixture.products.isEmpty)
    }

    @Test("markers older than seven days are cleared without manufacturing failure", arguments: [false, true])
    func boundedRetention(expired: Bool) throws {
        let source = ProductUpdateMetricsFixture()
        try source.beginAttached()
        source.analytics.stop()
        source.state.now = source.state.now.addingTimeInterval(PetUsageAnalytics.maximumEventAge + (expired ? 1 : 0))
        let restarted = ProductUpdateMetricsFixture(state: source.state, markerStore: source.markerStore)
        defer { restarted.analytics.stop() }
        restarted.metrics.recover { _ in ProductUpdateValues.observation(.targetRunning) }
        #expect(restarted.kinds == (expired ? [] : [.updateSucceeded]))
        #expect(restarted.markerStore.data == nil)
    }

    @Test("malformed and oversized local markers are discarded", arguments: [false, true])
    func invalidStorage(oversized: Bool) {
        let store = ProductUpdateMarkerStore()
        store.data = oversized ? Data(repeating: 32, count: PetProductUpdateMetrics.maximumMarkerBytes + 1) : Data("{}".utf8)
        let fixture = ProductUpdateMetricsFixture(markerStore: store)
        defer { fixture.analytics.stop() }
        fixture.metrics.recover { _ in Issue.record("Invalid marker must not read a journal"); return nil }
        #expect(store.data == nil && fixture.products.isEmpty)
    }

    @Test("restart during preparation is left unconfirmed rather than recorded as failure")
    func interruptedPreparationIsUnknown() throws {
        let source = ProductUpdateMetricsFixture()
        _ = try #require(source.metrics.start(target: ProductUpdateValues.target))
        source.analytics.stop()
        let restarted = ProductUpdateMetricsFixture(state: source.state, markerStore: source.markerStore)
        defer { restarted.analytics.stop() }
        restarted.metrics.recover { _ in Issue.record("Preparation has no installer job"); return nil }
        #expect(restarted.products.isEmpty && restarted.markerStore.data == nil)
    }

    @Test("the marker persists only fixed local provenance fields")
    func markerPrivacyBoundary() throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        try fixture.beginAttached()
        let bytes = try #require(fixture.markerStore.data)
        let object = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        #expect(Set(object.keys) == ["schema", "identity", "operationID", "occurredAt", "environment",
                                    "targetVersion", "targetBuild", "journalJobID"])
        let identity = try #require(object["identity"] as? [String: Any])
        #expect(Set(identity.keys) == ["userID", "consentID"])
        #expect(bytes.count < PetProductUpdateMetrics.maximumMarkerBytes)
        #expect(!String(decoding: bytes, as: UTF8.self).contains("test-only-token"))
    }

    @Test("controller preparation failure records the observed attempt without touching an installation")
    func controllerPreparationHook() async throws {
        let fixture = ProductUpdateMetricsFixture()
        defer { fixture.analytics.stop() }
        let unusedRoot = URL(fileURLWithPath: "/private/tmp/blabee-product-update-test-" + UUID().uuidString)
        let controller = AppUpdateTransactionController(store: .init(rootURL: unusedRoot))
        controller.productMetrics = fixture.metrics
        let release = PetAppUpdateRelease(version: ProductUpdateValues.target,
            releaseURL: URL(string: "https://github.com/test/Blabee/releases/tag/blabee-v0.1.0+build.55")!)
        // The test executable is not /Applications/Blabee.app. The existing
        // current-installation guard rejects preparation before any download.
        await controller.prepare(release)
        #expect(controller.phase == .failed)
        #expect(fixture.kinds == [.updateStarted, .updateFailed])
        await controller.cancel()
        #expect(fixture.kinds == [.updateStarted, .updateFailed])
        #expect(!FileManager.default.fileExists(atPath: unusedRoot.path))
    }
}
