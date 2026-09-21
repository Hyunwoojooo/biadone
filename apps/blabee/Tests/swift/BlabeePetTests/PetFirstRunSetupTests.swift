import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

private struct FirstRunSetupSuggestionStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_ mode: BlabeeSuggestionMode) {}
}

@MainActor
private final class FirstRunSetupAdapter: PetOnboardingAdapting {
    var readCalls = 0
    var mutationCalls = 0
    func serviceRegistrationState() -> PetServiceRegistrationState {
        readCalls += 1
        return .enabled
    }
    func configuredProjectPaths() throws -> [String] {
        readCalls += 1
        return ["/tmp/blabee-pet-setup"]
    }
    func registerService() throws { mutationCalls += 1 }
    func unregisterService() async throws { mutationCalls += 1 }
    func openSystemSettingsLoginItems() { mutationCalls += 1 }
    func enableProject(at path: String) throws { mutationCalls += 1 }
    func disableProject(at path: String) throws { mutationCalls += 1 }
}

@MainActor
private final class FirstRunSetupMetricStore: PetUsageEventStoring {
    private(set) var recorded: [PetUsageEvent] = []
    func load() throws -> [PetUsageEvent] { [] }
    func save(_ events: [PetUsageEvent]) throws { recorded.append(contentsOf: events) }
    func clear() throws {}
}

@MainActor
private final class FirstRunSetupMetricSender: PetUsageSending {
    private(set) var calls = 0
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        calls += 1
        return .accepted
    }
}

/// Reserve the fake response before blocking so a new setup generation can independently reply.
private actor FirstRunSetupGateTransport: PetCoordinatorTransport {
    let backend = PetFakeTransport()
    private var shouldHold = true
    private var started = false
    private var waiter: CheckedContinuation<Void, Never>?

    func release() {
        shouldHold = false
        waiter?.resume()
        waiter = nil
    }

    func request(type: String, payload: Data) async throws -> Data {
        let hold = type == "get_state" && shouldHold && !started
        if hold { started = true }
        let result: Result<Data, any Error>
        do { result = .success(try await backend.request(type: type, payload: payload)) }
        catch { result = .failure(error) }
        if hold && shouldHold { await withCheckedContinuation { waiter = $0 } }
        return try result.get()
    }
}

@MainActor
private func firstRunSetupModel(
    _ transport: any PetCoordinatorTransport,
    adapter: FirstRunSetupAdapter = FirstRunSetupAdapter(),
    analytics: PetUsageAnalytics? = nil
) -> PetViewModel {
    PetViewModel(
        transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
        onboardingAdapter: adapter, suggestionModeStore: FirstRunSetupSuggestionStore(),
        usageAnalytics: analytics, processIdentifier: 999
    )
}

private func firstRunSetupWaitForRequest(_ transport: FirstRunSetupGateTransport) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await transport.backend.requestCount(type: "get_state") > 0 { return true }
        await Task.yield()
    }
    return await transport.backend.requestCount(type: "get_state") > 0
}

@Suite("First-run setup only reads coordinator readiness")
@MainActor
struct PetFirstRunSetupTests {
    @Test("Readiness sees active projects without claiming cards, heartbeat or product metrics")
    func setupRefreshIsReadOnly() async throws {
        let transport = PetFakeTransport()
        let adapter = FirstRunSetupAdapter()
        let store = FirstRunSetupMetricStore()
        let sender = FirstRunSetupMetricSender()
        let instant = Date(timeIntervalSince1970: 1_800_000_000)
        let analytics = PetUsageAnalytics(
            isEnabled: true,
            authorization: { .init(userID: "11111111-1111-4111-8111-111111111111",
                                   accessToken: "test-only", expiresAt: instant.addingTimeInterval(3_600)) },
            store: store, service: sender, now: { instant }
        )
        defer { analytics.stop() }
        #expect(analytics.captureContext() != nil)
        let model = firstRunSetupModel(transport, adapter: adapter, analytics: analytics)
        var object = petTestSnapshotObject(
            cards: [PetTestCard(suffix: "setup")],
            permissionRequests: [PetTestPermissionRequest(suffix: "setup")]
        )
        var projects = try #require(object["projects"] as? [[String: Any]])
        projects.append(["project_id": "project_disabled", "cwd": "/tmp/disabled", "enabled": false])
        object["projects"] = projects
        await transport.enqueue(type: "get_state", response: try petTestData(object))

        model.beginFirstRunSetup()
        await model.refreshFirstRunSetup()

        #expect(await transport.requestPayloads(type: "get_state") == [Data("{}".utf8)])
        #expect(model.hasVerifiedServiceConnection)
        #expect(model.activeProjectPaths == ["/tmp/blabee-pet-setup"])
        #expect(model.connectionReadiness.checks.first(where: { $0.id == "service" })?.state == .confirmed)
        #expect(model.snapshot == nil)
        #expect(model.snapshotInteractions.isEmpty)
        #expect(model.displayInteraction == nil)
        #expect(model.localForegroundIdentity == nil)
        #expect(model.approvalHead == nil)
        #expect(model.connectionReceivedCardProjectPaths.isEmpty)
        #expect(await transport.requestCount(type: "focus_interaction") == 0)
        #expect(await transport.requestCount(type: "focus_event") == 0)
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(adapter.readCalls > 0)
        #expect(adapter.mutationCalls == 0)
        #expect(store.recorded.isEmpty)
        #expect(sender.calls == 0)

        model.endFirstRunSetup()
        #expect(!model.hasVerifiedServiceConnection)
        #expect(model.activeProjectPaths.isEmpty)
    }

    @Test("A subsequent connection failure withdraws previous setup readiness")
    func connectionFailureClearsReadiness() async throws {
        let transport = PetFakeTransport()
        let model = firstRunSetupModel(transport)
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [PetTestCard(suffix: "setup")]))
        model.beginFirstRunSetup()
        await model.refreshFirstRunSetup(inspectSettings: false)
        #expect(model.hasVerifiedServiceConnection)
        await transport.enqueueFailure(type: "get_state", code: "setup_disconnected")
        await model.refreshFirstRunSetup(inspectSettings: false)
        #expect(!model.hasVerifiedServiceConnection)
        #expect(model.activeProjectPaths.isEmpty)
        #expect(model.coordinatorTransportError != nil)
        #expect(model.snapshot == nil)
    }

    @Test("Malformed service responses cannot mark first-run setup connected")
    func malformedResponseDoesNotConnect() async throws {
        let transport = PetFakeTransport()
        let model = firstRunSetupModel(transport)
        await transport.enqueue(type: "get_state", response: Data("{}".utf8))
        model.beginFirstRunSetup()
        await model.refreshFirstRunSetup(inspectSettings: false)
        #expect(!model.hasVerifiedServiceConnection)
        #expect(model.activeProjectPaths.isEmpty)
        #expect(model.coordinatorTransportError != nil)
        #expect(model.snapshot == nil)
    }

    @Test("Setup refresh outside an active first-run session makes no coordinator request")
    func inactiveSetupDoesNotPoll() async {
        let transport = PetFakeTransport()
        let model = firstRunSetupModel(transport)
        await model.refreshFirstRunSetup(inspectSettings: false)
        model.beginFirstRunSetup()
        model.endFirstRunSetup()
        await model.refreshFirstRunSetup(inspectSettings: false)
        #expect(await transport.requestCount(type: "get_state") == 0)
    }

    @Test("Finishing setup ignores a response that arrives after normal startup")
    func lateResponseAfterEndingIsIgnored() async throws {
        let transport = FirstRunSetupGateTransport()
        let model = firstRunSetupModel(transport)
        await transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [PetTestCard(suffix: "old")]))
        model.beginFirstRunSetup()
        let refresh = Task { await model.refreshFirstRunSetup(inspectSettings: false) }
        #expect(await firstRunSetupWaitForRequest(transport))
        model.endFirstRunSetup()
        await transport.release()
        await refresh.value
        #expect(!model.hasVerifiedServiceConnection)
        #expect(model.activeProjectPaths.isEmpty)
        #expect(model.snapshot == nil)
        #expect(model.coordinatorTransportError == nil)
        #expect(await transport.backend.requestCount(type: "focus_interaction") == 0)
    }

    @Test("An old response cannot overwrite the next setup generation")
    func oldGenerationCannotReplaceReadiness() async throws {
        let transport = FirstRunSetupGateTransport()
        let model = firstRunSetupModel(transport)
        await transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [PetTestCard(suffix: "old")]))
        model.beginFirstRunSetup()
        let oldRefresh = Task { await model.refreshFirstRunSetup(inspectSettings: false) }
        #expect(await firstRunSetupWaitForRequest(transport))
        model.endFirstRunSetup()
        model.beginFirstRunSetup()
        await transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [PetTestCard(suffix: "new")]))
        await model.refreshFirstRunSetup(inspectSettings: false)
        #expect(model.activeProjectPaths == ["/tmp/blabee-pet-new"])
        await transport.release()
        await oldRefresh.value
        #expect(model.hasVerifiedServiceConnection)
        #expect(model.activeProjectPaths == ["/tmp/blabee-pet-new"])
        #expect(model.snapshot == nil)
    }

    @Test("Cancellation does not publish a late successful setup response")
    func cancelledResponseIsIgnored() async throws {
        let transport = FirstRunSetupGateTransport()
        let model = firstRunSetupModel(transport)
        await transport.backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [PetTestCard(suffix: "cancelled")]))
        model.beginFirstRunSetup()
        let refresh = Task { await model.refreshFirstRunSetup(inspectSettings: false) }
        #expect(await firstRunSetupWaitForRequest(transport))
        refresh.cancel()
        await transport.release()
        await refresh.value
        #expect(!model.hasVerifiedServiceConnection)
        #expect(model.activeProjectPaths.isEmpty)
        #expect(model.snapshot == nil)
        #expect(model.coordinatorTransportError == nil)
    }
}
