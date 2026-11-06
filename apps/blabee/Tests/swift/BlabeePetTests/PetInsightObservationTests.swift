import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Insight observations use actual inspected and displayed state")
@MainActor
struct PetInsightObservationTests {
    @Test("Passive settings inspection never requests execution rechecks or emits connection observations")
    func passiveInspection() async {
        let fixture = InsightObservationFixture()
        defer { fixture.stop() }
        await fixture.vm.beginOnboarding()
        await fixture.vm.refreshAllOnboardingSettings()
        await fixture.vm.refreshCodexPluginSetup()
        let counts = await fixture.manager.counts()
        #expect(counts.inspect == 2)
        #expect(counts.report == 0 && counts.legacy == 0)
        #expect(fixture.vm.codexNativeRecheckReport == nil)
        #expect(fixture.insights.isEmpty)
    }

    @Test("Explicit checks report observed CLI qualification separately from installation and Hook trust", arguments: [
        InsightObservedConnection(state: .notInstalled, version: "0.154.0", mode: .unknown, compatibility: .qualified),
        InsightObservedConnection(state: .marketplaceInstalledNeedsPlugin, version: "0.154.0", mode: .unknown, compatibility: .qualified),
        InsightObservedConnection(state: .installedNeedsHookReview(version: "0.1.0"), version: "0.154.0", mode: .plugin, compatibility: .qualified),
        InsightObservedConnection(state: .updateAvailable(installedVersion: "0.1.0", bundledVersion: "0.1.1"), version: "0.154.0", mode: .plugin, compatibility: .qualified),
        InsightObservedConnection(state: .installedNeedsHookReview(version: "0.1.0"), version: "0.149.1", mode: .plugin, compatibility: .unqualified),
        InsightObservedConnection(state: .error(code: "codex_native_probe_timeout"), version: nil, mode: .unknown, compatibility: .unknown),
    ])
    func explicitConnection(_ example: InsightObservedConnection) async throws {
        let fixture = InsightObservationFixture(result: example.result)
        defer { fixture.stop() }
        await fixture.vm.recheckCodexNativeExecutable()
        let event = try #require(fixture.insights.first)
        #expect(fixture.insights.count == 1)
        #expect(event.kind == .connectionObserved)
        #expect(event.codexVersion == (example.version ?? "unknown"))
        #expect(event.connectionMode == example.mode && event.compatibility == example.compatibility)
        #expect(event.cardID == nil && event.cardKind == .none)
        #expect(fixture.vm.codexPluginSetupState == example.state)
        let counts = await fixture.manager.counts()
        #expect(counts.report == 1 && counts.legacy == 0 && counts.inspect == 0)
        // A deliberate second check really runs, but does not create a second
        // same-day aggregate observation of the same connection environment.
        await fixture.vm.recheckCodexNativeExecutable()
        #expect((await fixture.manager.counts()).report == 2)
        #expect(fixture.insights.count == 1)
    }

    @Test("Native recheck paths and free-form version output cannot enter automatic telemetry", arguments: [
        "codex-cli 0.154.0", "/Users/private-person/private-project/bin/codex", "0.154.0\nsecret", "1234567.0.0",
    ])
    func malformedVersion(_ version: String) async throws {
        let result = CodexPluginCheckResult(state: .installedNeedsHookReview(version: "0.1.0"), evidence: .init(
            stage: .installationValidation, sourcePath: "/Users/private-person/private-project/source",
            canonicalPath: "/Users/private-person/private-project/canonical", codexVersion: version
        ))
        let fixture = InsightObservationFixture(result: result)
        defer { fixture.stop() }
        await fixture.vm.recheckCodexNativeExecutable()
        let event = try #require(fixture.insights.first)
        #expect(event.codexVersion == "unknown" && event.compatibility == .unknown)
        #expect(event.connectionMode == .plugin)
        let text = String(decoding: try JSONEncoder().encode(fixture.events), as: UTF8.self)
        for forbidden in ["private-person", "private-project", "secret", "sourcePath", "canonicalPath", "codex-cli"] {
            #expect(!text.contains(forbidden))
        }
        #expect(fixture.vm.codexNativeRecheckReport?.result?.evidence.sourcePath == result.evidence.sourcePath)
    }

    @Test("A delayed explicit check retains the consent and account that began it", arguments: InsightObservationBoundary.allCases)
    func recheckBoundary(_ boundary: InsightObservationBoundary) async {
        let fixture = InsightObservationFixture(enabled: boundary != .enableAfterStart, blocks: true)
        defer { fixture.stop() }
        let pending = Task { await fixture.vm.recheckCodexNativeExecutable() }
        await fixture.manager.waitUntilPaused()
        #expect(fixture.insights.isEmpty)
        switch boundary {
        case .unchanged: break
        case .enableAfterStart: fixture.analytics.setEnabled(true)
        case .disableAndEnable:
            fixture.analytics.setEnabled(false)
            fixture.analytics.setEnabled(true)
        case .otherAccount:
            fixture.state.userID = InsightObservationValues.otherUser
            fixture.analytics.accountStateChanged()
        case .sameAccountRelogin:
            fixture.analytics.clearIdentity()
            fixture.analytics.accountStateChanged()
        }
        await fixture.manager.resume()
        await pending.value
        #expect((await fixture.manager.counts()).report == 1)
        #expect(fixture.vm.codexNativeRecheckReport?.isChecking == false)
        #expect(fixture.insights.count == (boundary == .unchanged ? 1 : 0))
    }

    @Test("A held choice preview is not counted as a displayed suggestion")
    func heldPreviewIsExcluded() throws {
        let fixture = InsightObservationFixture()
        defer { fixture.stop() }
        let data = try petTestSnapshotData(cards: [PetTestCard(suffix: "held_preview", rankedActionCount: 4)])
        try fixture.vm.receiveSnapshotDataForTesting(data)
        fixture.vm.beginChoicePreview(slot: 1)
        #expect(fixture.vm.choicePreview != nil)
        fixture.vm.setPanelVisible(true)
        try fixture.vm.receiveSnapshotDataForTesting(data)
        #expect(fixture.vm.choicePreview != nil)
        #expect(fixture.insights.isEmpty)
        fixture.vm.endChoicePreview()
        #expect(fixture.insights.map(\.kind) == [.cardPresented])
        #expect(fixture.insights.first?.cardKind == .suggestion)
        fixture.vm.setPanelVisible(false)
        fixture.vm.setPanelVisible(true)
        #expect(fixture.insights.count == 1)
    }

    @Test("Navigation counts the displayed non-head decision while other queued cards remain unseen")
    func displayedNonHeadCard() async throws {
        let fixture = InsightObservationFixture()
        defer { fixture.stop() }
        let cards = [PetTestCard(suffix: "earlier", rankedActionCount: 2), PetTestCard(suffix: "later", rankedActionCount: 4)]
        let permission = PetTestPermissionRequest(suffix: "approval")
        let approval = PetEventReference(kind: .permission, eventID: "permission_approval")
        let later = PetEventReference(kind: .decision, eventID: "interaction_later")
        try fixture.vm.receiveSnapshotDataForTesting(insightNavigationSnapshot(cards: cards, permission: permission, focused: approval))
        fixture.vm.setPanelVisible(true)
        #expect(fixture.insights.map(\.cardKind) == [.approval])
        await fixture.transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
        let afterNavigation = try insightNavigationSnapshot(cards: cards, permission: permission, focused: later,
                                                           foreground: "later", revision: 2)
        await fixture.transport.enqueue(type: "get_state", response: afterNavigation)
        await fixture.vm.navigateToPreviousEvent()
        #expect(fixture.vm.displayedEventQueuePosition == 3)
        #expect(fixture.vm.displayInteraction?.identity.interactionID == "interaction_later")
        #expect(fixture.vm.approvalQueueCount == 1 && fixture.vm.approvalHead == nil)
        #expect(fixture.insights.map(\.cardKind) == [.approval, .suggestion])
        #expect(Set(fixture.insights.compactMap(\.cardID)).count == 2)
        for _ in 0..<3 { try fixture.vm.receiveSnapshotDataForTesting(afterNavigation) }
        #expect(fixture.insights.count == 2)
        #expect(await fixture.transport.requestCount(type: "select") == 0)
        #expect(await fixture.transport.requestCount(type: "resolve_permission_request") == 0)
    }
}

struct InsightObservedConnection: Sendable {
    let state: CodexPluginSetupState
    let version: String?
    let mode: PetInsightConnectionMode
    let compatibility: PetInsightCompatibility
    var result: CodexPluginCheckResult {
        .init(state: state, evidence: .init(stage: .installationValidation, codexVersion: version))
    }
}

enum InsightObservationBoundary: CaseIterable, Sendable {
    case unchanged, enableAfterStart, disableAndEnable, otherAccount, sameAccountRelogin
}

private actor InsightObservationManager: CodexPluginSetupManaging {
    private let result: CodexPluginCheckResult
    private let blocks: Bool
    private var inspectCalls = 0
    private var reportCalls = 0
    private var legacyCalls = 0
    private var pause: CheckedContinuation<Void, Never>?
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(result: CodexPluginCheckResult, blocks: Bool) {
        self.result = result
        self.blocks = blocks
    }
    func inspect() async -> CodexPluginSetupState {
        inspectCalls += 1
        return result.state
    }
    func recheckNativeExecutable() async -> CodexPluginSetupState {
        legacyCalls += 1
        return result.state
    }
    func recheckNativeExecutableWithReport() async -> CodexPluginCheckResult {
        reportCalls += 1
        if blocks {
            await withCheckedContinuation { continuation in
                pause = continuation
                let observers = waiters
                waiters.removeAll()
                observers.forEach { $0.resume() }
            }
        }
        return result
    }
    func connect() async -> CodexPluginSetupState { .notInstalled }
    func disconnect() async -> CodexPluginSetupState { .notInstalled }
    func migrateLegacyInstallation(confirmation: CodexPluginSetupLegacyMigrationConfirmation) async -> CodexPluginSetupState { .notInstalled }
    func counts() -> (inspect: Int, report: Int, legacy: Int) { (inspectCalls, reportCalls, legacyCalls) }
    func waitUntilPaused() async {
        guard pause == nil else { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func resume() { let continuation = pause; pause = nil; continuation?.resume() }
}

private struct InsightObservationModeStore: BlabeeSuggestionModeStoring {
    func load() -> BlabeeSuggestionModeLoadResult { .init(mode: .smart, diagnostic: nil) }
    func save(_: BlabeeSuggestionMode) {}
}

private enum InsightObservationValues {
    static let date = Date(timeIntervalSince1970: 1_800_000_000)
    static let user = "11111111-1111-4111-8111-111111111111"
    static let otherUser = "22222222-2222-4222-8222-222222222222"
    static let environment = PetProductEnvironment(appVersion: "1.0", appBuild: "57", osMajor: "26", uiLanguage: .ko)
}

@MainActor
private final class InsightObservationFixture {
    let manager: InsightObservationManager
    let state = InsightObservationState()
    let store = InsightObservationStore()
    let sender = InsightObservationSender()
    let transport = PetFakeTransport()
    let analytics: PetUsageAnalytics
    let vm: PetViewModel
    var events: [PetUsageEvent] {
        var seen = Set<UUID>()
        return (sender.events + store.events).filter { seen.insert($0.eventID).inserted }
    }
    var insights: [PetInsightMetricPayload] { events.compactMap(\.insight) }

    init(result: CodexPluginCheckResult = .init(state: .installedNeedsHookReview(version: "0.1.0"),
                                               evidence: .init(codexVersion: "0.154.0")),
         enabled: Bool = true, blocks: Bool = false) {
        manager = InsightObservationManager(result: result, blocks: blocks)
        analytics = PetUsageAnalytics(isEnabled: enabled, authorization: { [state] in
            .init(userID: state.userID, accessToken: "test-token", expiresAt: InsightObservationValues.date.addingTimeInterval(3_600))
        }, store: store, service: sender, now: { InsightObservationValues.date }, productEnvironment: InsightObservationValues.environment)
        let tracker = PetInsightCardTracker(analytics: analytics, now: { InsightObservationValues.date }, monotonicNow: { 100 })
        let monitor = PetChoicePreviewHoldMonitor(modifierIsPressed: { _ in true }, keyIsPressed: { _ in false })
        vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            codexPluginSetupManager: manager, suggestionModeStore: InsightObservationModeStore(),
            usageAnalytics: analytics, insightCards: tracker, processIdentifier: 999, choicePreviewHoldMonitor: monitor)
    }
    func stop() { vm.stopPolling(); analytics.stop() }
}

@MainActor
private final class InsightObservationState { var userID = InsightObservationValues.user }

@MainActor
private final class InsightObservationStore: PetUsageEventStoring {
    var events: [PetUsageEvent] = []
    func load() throws -> [PetUsageEvent] { events }
    func save(_ events: [PetUsageEvent]) throws { self.events = events }
    func clear() throws { events = [] }
}

@MainActor
private final class InsightObservationSender: PetUsageSending {
    var events: [PetUsageEvent] = []
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        events.append(event)
        return .accepted
    }
}

private func insightNavigationSnapshot(cards: [PetTestCard], permission: PetTestPermissionRequest,
                                       focused: PetEventReference, foreground: String? = nil, revision: Int64 = 1) throws -> Data {
    var object = petTestSnapshotObject(cards: cards, foregroundSuffix: foreground, permissionRequests: [permission])
    let references = [PetEventReference(kind: .permission, eventID: "permission_" + permission.suffix)]
        + cards.map { PetEventReference(kind: .decision, eventID: "interaction_" + $0.suffix) }
    object["event_navigation"] = [
        "events": references.map(\.jsonObject), "focused": focused.jsonObject,
        "revision": revision, "delivery_pending": false,
    ]
    return try petTestData(object)
}
