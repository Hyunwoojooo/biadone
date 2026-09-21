import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Error diagnostics follow real failures and their original consent")
@MainActor
struct PetErrorIntegrationTests {
    @Test("Failed actions emit fixed codes without copying transport details",
          arguments: ErrorIntegrationAction.allCases, [false, true])
    func failedActionRecordsCode(_ action: ErrorIntegrationAction, invalidAcknowledgement: Bool) async throws {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        try await f.prepare(action)
        if invalidAcknowledgement {
            await f.backend.enqueue(type: action.requestType, response: try f.acknowledgement(action, matches: false))
        } else {
            await f.transport.fail(type: action.requestType, error: PetTestError.injected(ErrorIntegrationFixture.privateDetail))
        }
        try await f.enqueueEmptySnapshot()

        await f.perform(action)

        #expect(await f.waitForDelivery(count: 1))
        #expect(f.delivery.events.map(\.code) == [action.errorCode])
        #expect(await f.transport.requestCount(type: action.requestType) == 1)
        let data = try JSONEncoder().encode(f.delivery.events)
        let encoded = String(decoding: data, as: UTF8.self)
        #expect(!encoded.contains(ErrorIntegrationFixture.privateDetail))
        #expect(!encoded.contains("/tmp/blabee-pet"))
        #expect(!encoded.contains("example.test"))
        #expect(!encoded.contains("accessToken"))
    }

    @Test("Accepted actions emit no error diagnostic", arguments: ErrorIntegrationAction.allCases)
    func successfulActionDoesNotRecord(_ action: ErrorIntegrationAction) async throws {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        try await f.prepare(action)
        await f.backend.enqueue(type: action.requestType, response: try f.acknowledgement(action))
        try await f.enqueueEmptySnapshot()

        await f.perform(action)

        await f.expectNoDiagnostic()
        #expect(await f.transport.requestCount(type: action.requestType) == 1)
    }

    @Test("Disabled collection or no verified login prevents all action diagnostics",
          arguments: ErrorIntegrationAction.allCases, [false, true])
    func consentAndLoginAreRequired(_ action: ErrorIntegrationAction, signedIn: Bool) async throws {
        let f = ErrorIntegrationFixture(enabled: !signedIn, signedIn: signedIn)
        defer { f.stop() }
        await f.start()
        try await f.prepare(action)
        await f.transport.fail(type: action.requestType, error: URLError(.notConnectedToInternet))
        try await f.enqueueEmptySnapshot()

        await f.perform(action)

        await f.expectNoDiagnostic()
        #expect(await f.transport.requestCount(type: action.requestType) == 1)
    }

    @Test("An in-flight failure cannot inherit later consent or another login",
          arguments: ErrorIntegrationAction.allCases, ErrorIntegrationContextChange.allCases)
    func originalContextFencesFailure(_ action: ErrorIntegrationAction, change: ErrorIntegrationContextChange) async throws {
        let f = ErrorIntegrationFixture(enabled: change != .enableAfterStart, blockedType: action.requestType)
        defer { f.stop() }
        await f.start()
        try await f.prepare(action)
        await f.transport.fail(type: action.requestType, error: URLError(.networkConnectionLost))
        try await f.enqueueEmptySnapshot()
        let pending = Task { await f.perform(action) }
        let entered = await f.waitForBlockedRequest()

        if entered {
            #expect(f.events.saved.flatMap { $0 }.isEmpty)
            await f.changeContext(change)
        }
        await f.transport.release()
        await pending.value

        #expect(entered)
        #expect(await f.transport.requestCount(type: action.requestType) == 1)
        if change == .ordinaryRefresh {
            #expect(await f.waitForDelivery(count: 1))
            #expect(f.delivery.events.map(\.code) == [action.errorCode])
        } else {
            await f.expectNoDiagnostic()
        }
    }

    @Test("Cancelled actions are not failures", arguments: ErrorIntegrationAction.allCases,
          ErrorIntegrationTransportCancellation.allCases)
    func cancellationDoesNotRecord(_ action: ErrorIntegrationAction, cancellation: ErrorIntegrationTransportCancellation) async throws {
        let f = ErrorIntegrationFixture(blockedType: action.requestType)
        defer { f.stop() }
        await f.start()
        try await f.prepare(action)
        await f.transport.fail(type: action.requestType, error: cancellation.error)
        try await f.enqueueEmptySnapshot()
        let pending = Task { await f.perform(action) }
        let entered = await f.waitForBlockedRequest()
        if cancellation == .cancelledTask { pending.cancel() }
        await f.transport.release()
        await pending.value

        #expect(entered)
        #expect(await f.transport.requestCount(type: action.requestType) == 1)
        await f.expectNoDiagnostic()
    }

    @Test("Polling emits one diagnostic per outage even after the sampling window",
          arguments: [false, true])
    func pollingOutageEpisodes(invalidResponse: Bool) async throws {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        let expected: PetErrorCode = invalidResponse ? .coordinatorResponseInvalid : .coordinatorConnectionFailed

        for index in 0..<3 {
            if invalidResponse {
                await f.backend.enqueue(type: "get_state", response: Data("{}".utf8))
            } else {
                await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
            }
            await f.vm.refresh()
            if index == 0 { #expect(await f.waitForDelivery(count: 1)) }
            f.clock.date.addTimeInterval(PetErrorDiagnostics.duplicateWindow + 1)
        }
        #expect(f.delivery.events.map(\.code) == [expected])
        try await f.enqueueEmptySnapshot()
        await f.vm.refresh()
        #expect(f.vm.coordinatorTransportError == nil)

        if invalidResponse {
            await f.backend.enqueue(type: "get_state", response: Data("{}".utf8))
        } else {
            await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        }
        await f.vm.refresh()

        #expect(await f.waitForDelivery(count: 2))
        #expect(f.delivery.events.map(\.code) == [expected, expected])
    }

    @Test("A new polling failure becomes eligible after opt-in or verified login",
          arguments: [false, true])
    func pollingStartsRecordingOnlyNewEligibleFailures(initiallySignedIn: Bool) async throws {
        let f = ErrorIntegrationFixture(enabled: !initiallySignedIn, signedIn: initiallySignedIn)
        defer { f.stop() }
        await f.start()
        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()
        await f.expectNoDiagnostic()
        f.clock.date.addTimeInterval(PetErrorDiagnostics.duplicateWindow + 1)

        if initiallySignedIn { f.diagnostics.setEnabled(true) }
        else { await f.account.signIn(.google) }
        await f.expectNoDiagnostic()
        let newFailureTime = f.clock.date
        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()

        #expect(await f.waitForDelivery(count: 1))
        #expect(f.delivery.events.map(\.code) == [.coordinatorConnectionFailed])
        #expect(f.delivery.events.map(\.occurredAt) == [newFailureTime])
        f.clock.date.addTimeInterval(PetErrorDiagnostics.duplicateWindow + 1)
        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()
        for _ in 0..<20 { await Task.yield() }
        #expect(f.delivery.events.count == 1)
        #expect(await f.transport.requestCount(type: "get_state") == 3)
    }

    @Test("A new consent or login epoch permits one new polling failure before recovery",
          arguments: [ErrorIntegrationContextChange.disableAndEnable, .sameAccountLogin, .otherAccountLogin, .ordinaryRefresh])
    func pollingDeduplicationBelongsToCurrentContext(_ change: ErrorIntegrationContextChange) async throws {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()
        #expect(await f.waitForDelivery(count: 1))
        f.clock.date.addTimeInterval(PetErrorDiagnostics.duplicateWindow + 1)
        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()
        #expect(f.delivery.events.count == 1)

        await f.changeContext(change)
        f.clock.date.addTimeInterval(PetErrorDiagnostics.duplicateWindow + 1)
        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()

        let expectedCount = change == .ordinaryRefresh ? 1 : 2
        #expect(await f.waitForDelivery(count: expectedCount))
        let expectedOwners = change == .otherAccountLogin
            ? [ErrorIntegrationFixture.firstUser.id, ErrorIntegrationFixture.otherUser.id]
            : Array(repeating: ErrorIntegrationFixture.firstUser.id, count: expectedCount)
        #expect(f.delivery.events.map(\.userID) == expectedOwners)
        #expect(Set(f.delivery.events.map(\.eventID)).count == expectedCount)
        f.clock.date.addTimeInterval(PetErrorDiagnostics.duplicateWindow + 1)
        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()
        for _ in 0..<20 { await Task.yield() }
        #expect(f.delivery.events.count == expectedCount)
    }

    @Test("A cancelled poll does not suppress the next actual failure",
          arguments: ErrorIntegrationTransportCancellation.allCases)
    func cancelledPollDoesNotConsumeDiagnosticContext(_ cancellation: ErrorIntegrationTransportCancellation) async throws {
        let f = ErrorIntegrationFixture(blockedType: "get_state")
        defer { f.stop() }
        await f.start()
        await f.transport.fail(type: "get_state", error: cancellation.error)
        let pending = Task { await f.vm.refresh() }
        let entered = await f.waitForBlockedRequest()
        if cancellation == .cancelledTask { pending.cancel() }
        await f.transport.release()
        await pending.value
        #expect(entered)
        await f.expectNoDiagnostic()

        await f.transport.fail(type: "get_state", error: URLError(.cannotConnectToHost))
        await f.vm.refresh()

        #expect(await f.waitForDelivery(count: 1))
        #expect(f.delivery.events.map(\.code) == [.coordinatorConnectionFailed])
        #expect(await f.transport.requestCount(type: "get_state") == 2)
    }

    @Test("Account refresh failures wait for verified recovery of the same account",
          arguments: ErrorIntegrationAccountFailure.allCases)
    func accountRefreshRetainsDiagnosticUntilRecovery(_ failure: ErrorIntegrationAccountFailure) async throws {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        f.accountService.userError = failure.error

        await f.account.refresh()

        #expect(f.account.phase == .unavailable)
        #expect(f.account.usageAuthorization() == nil)
        #expect(f.events.events.map(\.code) == [failure.code])
        #expect(f.delivery.events.isEmpty)
        let queuedID = try #require(f.events.events.first?.eventID)
        f.accountService.userError = nil
        await f.account.refresh()

        #expect(await f.waitForDelivery(count: 1))
        #expect(f.delivery.events.map(\.code) == [failure.code])
        #expect(f.delivery.events.map(\.eventID) == [queuedID])
        #expect(f.account.usageAuthorization()?.userID == ErrorIntegrationFixture.firstUser.id)
    }

    @Test("Cancelled and revoked account refreshes are not diagnostic errors",
          arguments: ErrorIntegrationAccountExclusion.allCases)
    func expectedAccountOutcomesDoNotRecord(_ exclusion: ErrorIntegrationAccountExclusion) async {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        f.accountService.userError = exclusion.error
        let gate = ErrorIntegrationAccountGate()
        if exclusion == .cancelledTask { f.accountService.userGate = gate }
        let pending = Task { await f.account.refresh() }
        if exclusion == .cancelledTask {
            await gate.waitUntilEntered()
            pending.cancel()
            gate.release()
        }
        await pending.value

        await f.expectNoDiagnostic()
    }

    @Test("An initial OAuth failure is never replayed after a later successful login")
    func initialLoginFailureIsNotRetroactivelyUploaded() async {
        let f = ErrorIntegrationFixture(signedIn: false)
        defer { f.stop() }
        await f.start()
        f.accountService.exchangeError = PetAccountAuthError.serviceUnavailable

        await f.account.signIn(.google)

        #expect(f.account.phase == .signedOut)
        await f.expectNoDiagnostic()
        f.accountService.exchangeError = nil
        await f.account.signIn(.github)

        #expect(f.account.usageAuthorization()?.userID == ErrorIntegrationFixture.firstUser.id)
        await f.expectNoDiagnostic()
    }

    @Test("A late account failure cannot revive diagnostics after logout or opt-out",
          arguments: ErrorIntegrationContextChange.allCases.filter { $0 != .ordinaryRefresh })
    func accountRefreshFencesChangedContext(_ change: ErrorIntegrationContextChange) async throws {
        let f = ErrorIntegrationFixture(enabled: change != .enableAfterStart)
        defer { f.stop() }
        await f.start()
        f.accountService.userError = PetAccountAuthError.serviceUnavailable
        let gate = ErrorIntegrationAccountGate()
        f.accountService.userGate = gate
        let pending = Task { await f.account.refresh() }
        await gate.waitUntilEntered()
        f.accountService.userGate = nil
        f.accountService.userError = nil
        await f.changeContext(change)
        gate.release()
        await pending.value

        await f.expectNoDiagnostic()
    }

    @Test("Owned-service failures report fixed codes while shutdown and registration conflicts do not",
          arguments: ErrorIntegrationServiceOutcome.allCases)
    func ownedServiceDiagnostics(_ outcome: ErrorIntegrationServiceOutcome) async throws {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        let launcher = ErrorIntegrationServiceLauncher()
        if outcome == .launchFailure {
            launcher.error = CoordinatorError("private_service_failure", ErrorIntegrationFixture.privateDetail)
        }
        let service = PetAppServiceController(launcher: launcher,
            preference: ErrorIntegrationServicePreference(),
            registration: { outcome == .registrationConflict ? .enabled : .notRegistered },
            readinessTimeoutNanoseconds: 5_000_000_000,
            startupTimeoutNanoseconds: outcome == .timeout ? 20_000_000 : 5_000_000_000,
            errorDiagnostics: f.diagnostics)
        service.enable()
        switch outcome {
        case .unexpectedExit:
            let child = try #require(launcher.children.first)
            child.isRunning = false
            child.terminationSummary = "private_service_exit"
            service.checkChildBeforePolling()
            for _ in 0..<3 {
                f.clock.date.addTimeInterval(PetErrorDiagnostics.duplicateWindow + 1)
                service.checkChildBeforePolling()
            }
        case .timeout:
            #expect(await errorIntegrationWait { service.state == .failed("app_service_connection_timeout") })
            #expect(launcher.children.first?.stopCount == 1)
        case .normalShutdown: await service.shutdown()
        case .launchFailure, .registrationConflict: break
        }

        if let code = outcome.code {
            #expect(await f.waitForDelivery(count: 1))
            #expect(f.delivery.events.map(\.code) == [code])
            let encoded = String(decoding: try JSONEncoder().encode(f.delivery.events), as: UTF8.self)
            #expect(!encoded.contains("private_service"))
            #expect(!encoded.contains(ErrorIntegrationFixture.privateDetail))
        } else {
            await f.expectNoDiagnostic()
        }
        await service.shutdown()
    }

    @Test("A service deadline keeps the consent and account captured when it was armed",
          arguments: [ErrorIntegrationContextChange.enableAfterStart, .disableAndEnable, .sameAccountLogin, .otherAccountLogin])
    func serviceTimeoutFencesChangedContext(_ change: ErrorIntegrationContextChange) async throws {
        let f = ErrorIntegrationFixture(enabled: change != .enableAfterStart)
        defer { f.stop() }
        await f.start()
        let launcher = ErrorIntegrationServiceLauncher()
        let service = PetAppServiceController(launcher: launcher,
            preference: ErrorIntegrationServicePreference(), registration: { .notRegistered },
            readinessTimeoutNanoseconds: 5_000_000_000, startupTimeoutNanoseconds: 200_000_000,
            errorDiagnostics: f.diagnostics)
        service.enable()

        await f.changeContext(change)

        #expect(await errorIntegrationWait { service.state == .failed("app_service_connection_timeout") })
        #expect(launcher.children.first?.stopCount == 1)
        await f.expectNoDiagnostic()
        await service.shutdown()
    }

    @Test("Ready and shutdown transitions cancel old service timeout diagnostics",
          arguments: [false, true])
    func cancelledServiceDeadlineDoesNotRecord(ready: Bool) async throws {
        let f = ErrorIntegrationFixture()
        defer { f.stop() }
        await f.start()
        let launcher = ErrorIntegrationServiceLauncher()
        let service = PetAppServiceController(launcher: launcher,
            preference: ErrorIntegrationServicePreference(), registration: { .notRegistered },
            readinessTimeoutNanoseconds: 5_000_000_000, startupTimeoutNanoseconds: 20_000_000,
            errorDiagnostics: f.diagnostics)
        service.enable()
        let child = try #require(launcher.children.first)
        if ready {
            child.hasPublishedService = true
            service.receivedVerifiedSnapshot(generation: service.generation)
        } else {
            await service.shutdown()
        }

        try await Task.sleep(for: .milliseconds(80))

        #expect(service.state == (ready ? .ready : .stopped))
        #expect(child.stopCount == (ready ? 0 : 1))
        await f.expectNoDiagnostic()
        await service.shutdown()
    }
}

enum ErrorIntegrationAction: CaseIterable, Sendable {
    case panelChoice, globalChoice, nativeApproval, managedApproval, dismissal
    var requestType: String {
        switch self {
        case .panelChoice, .globalChoice: "select"
        case .nativeApproval: "resolve_permission_request"
        case .managedApproval: "resolve_managed_command_approval"
        case .dismissal: "dismiss_interaction"
        }
    }
    var errorCode: PetErrorCode {
        switch self {
        case .panelChoice, .globalChoice: .choiceSubmitFailed
        case .nativeApproval, .managedApproval: .approvalSubmitFailed
        case .dismissal: .suggestionDismissFailed
        }
    }
}

enum ErrorIntegrationContextChange: CaseIterable, Sendable {
    case enableAfterStart, disableAndEnable, logout, sameAccountLogin, otherAccountLogin, ordinaryRefresh
}

enum ErrorIntegrationTransportCancellation: CaseIterable, Sendable {
    case swiftCancellation, urlCancellation, cancelledTask
    var error: any Error {
        switch self {
        case .swiftCancellation: CancellationError()
        case .urlCancellation: URLError(.cancelled)
        case .cancelledTask: URLError(.networkConnectionLost)
        }
    }
}

enum ErrorIntegrationAccountFailure: CaseIterable, Sendable {
    case serviceUnavailable, invalidResponse, rateLimited, storageUnavailable, network, unknown
    var error: any Error {
        switch self {
        case .serviceUnavailable: PetAccountAuthError.serviceUnavailable
        case .invalidResponse: PetAccountAuthError.invalidResponse
        case .rateLimited: PetAccountAuthError.rateLimited
        case .storageUnavailable: PetAccountAuthError.storageUnavailable
        case .network: URLError(.notConnectedToInternet)
        case .unknown: PetTestError.injected("private-account-failure")
        }
    }
    var code: PetErrorCode {
        switch self {
        case .serviceUnavailable: .accountServiceUnavailable
        case .invalidResponse: .accountInvalidResponse
        case .rateLimited: .accountRateLimited
        case .storageUnavailable: .accountStorageUnavailable
        case .network, .unknown: .accountRefreshFailed
        }
    }
}

enum ErrorIntegrationAccountExclusion: CaseIterable, Sendable {
    case userCancellation, revokedSession, swiftCancellation, urlCancellation, cancelledTask
    var error: any Error {
        switch self {
        case .userCancellation: PetAccountAuthError.cancelled
        case .revokedSession: PetAccountAuthError.unauthorized
        case .swiftCancellation: CancellationError()
        case .urlCancellation: URLError(.cancelled)
        case .cancelledTask: URLError(.networkConnectionLost)
        }
    }
}

enum ErrorIntegrationServiceOutcome: CaseIterable, Sendable {
    case launchFailure, unexpectedExit, timeout, normalShutdown, registrationConflict
    var code: PetErrorCode? {
        switch self {
        case .launchFailure: .appServiceFailed
        case .unexpectedExit: .appServiceExited
        case .timeout: .appServiceTimeout
        case .normalShutdown, .registrationConflict: nil
        }
    }
}

@MainActor
private final class ErrorIntegrationFixture {
    static let firstUser = PetAccountUser(id: "11111111-1111-4111-8111-111111111111", email: "first@example.test")
    static let otherUser = PetAccountUser(id: "22222222-2222-4222-8222-222222222222", email: "other@example.test")
    static let privateDetail = "private-prompt /Users/private/project secret-token"
    let clock = ErrorIntegrationClock()
    let accountService: ErrorIntegrationAccountService
    let account: PetAccountController
    let events = ErrorIntegrationEventStore()
    let delivery = ErrorIntegrationDeliveryService()
    let diagnostics: PetErrorDiagnostics
    let backend = PetFakeTransport()
    let transport: ErrorIntegrationTransport
    let vm: PetViewModel
    let card = PetTestCard(suffix: "error_integration", rankedActionCount: 2)
    private var identity: PetInteractionIdentity?
    private var permission: PetPermissionRequest?
    private var managed: PetManagedCommandApproval?

    init(enabled: Bool = true, signedIn: Bool = true, blockedType: String? = nil) {
        let candidate = PetAccountSession(accessToken: "error-test-access", refreshToken: "error-test-refresh",
            expiresAt: clock.date.addingTimeInterval(3_600), user: Self.firstUser)
        accountService = ErrorIntegrationAccountService(candidate: candidate)
        account = PetAccountController(service: accountService,
            store: ErrorIntegrationAccountStore(value: signedIn ? candidate : nil),
            browser: ErrorIntegrationAccountBrowser(),
            configuration: PetAccountConfiguration(supabaseURL: URL(string: "https://example.supabase.co")!,
                publishableKey: "test-public-key"), now: { [clock] in clock.date }, automaticRefresh: false,
            makeVerifier: { String(repeating: "a", count: 64) })
        diagnostics = PetErrorDiagnostics(isEnabled: enabled,
            authorization: { [weak account] in account?.usageAuthorization() }, store: events, service: delivery,
            now: { [clock] in clock.date }, environment: PetErrorEnvironment(appVersion: "0.1.0", appBuild: "46", osVersion: "15.0"))
        account.errorDiagnostics = diagnostics
        transport = ErrorIntegrationTransport(backend: backend, blockedType: blockedType)
        vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            account: account, errorDiagnostics: diagnostics, selectionIDGenerator: { "selection_error" },
            permissionResponseIDGenerator: { "permission_response_test" },
            managedApprovalResponseIDGenerator: { "managed_approval_response_test" })
    }

    func start() async { await account.restoreIfNeeded() }
    func stop() {
        vm.stopPolling()
        account.stop()
        diagnostics.stop()
    }

    func prepare(_ action: ErrorIntegrationAction) async throws {
        switch action {
        case .panelChoice, .globalChoice, .dismissal:
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
            let displayed = try #require(vm.displayInteraction?.identity)
            identity = displayed
            if action != .dismissal {
                await backend.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
                await backend.enqueue(type: "get_state", response:
                    try petTestSnapshotData(cards: [card], foregroundSuffix: card.suffix))
                await vm.focus(displayed)
                #expect(vm.focusedInteraction?.identity == identity)
            }
        case .nativeApproval:
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [], permissionRequests: [
                PetTestPermissionRequest(suffix: card.suffix, allowOnceAvailable: true),
            ]))
            let request = try #require(vm.pendingPermissionRequest)
            permission = request
        case .managedApproval:
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [], managedCommandApprovals: [
                PetTestManagedCommandApproval(suffix: card.suffix),
            ]))
            let request = try #require(vm.pendingManagedCommandApproval)
            managed = request
        }
    }

    func perform(_ action: ErrorIntegrationAction) async {
        switch action {
        case .panelChoice:
            if let identity { await vm.focusAndRequestPanelSelection(1, interaction: identity) }
        case .globalChoice: await vm.handleGlobalSlot(1)
        case .nativeApproval:
            if let permission { await vm.resolvePermissionRequest(.allowOnce, for: permission) }
        case .managedApproval:
            if let managed { await vm.resolveManagedCommandApproval(.acceptOnce, for: managed) }
        case .dismissal:
            if let identity { await vm.skipDecision(for: identity) }
        }
    }

    func acknowledgement(_ action: ErrorIntegrationAction, matches: Bool = true) throws -> Data {
        switch action {
        case .panelChoice, .globalChoice:
            if matches { return try petTestSelectionResponse() }
            return try petTestData(["accepted": false, "outcome": ["kind": "pause"]])
        case .nativeApproval:
            return try petTestPermissionResolutionResponse(.allowOnce,
                requestID: matches ? "permission_\(card.suffix)" : "permission_stale")
        case .managedApproval:
            return try petTestManagedCommandApprovalResolutionResponse(.acceptOnce,
                managedRequestID: matches ? "managed_request_\(card.suffix)" : "managed_request_stale")
        case .dismissal:
            let identity = try #require(identity)
            return try petTestData(["dismissed": true, "interaction_id": identity.interactionID,
                "packet_id": identity.packetID, "revision": matches ? identity.revision : identity.revision + 1])
        }
    }

    func enqueueEmptySnapshot() async throws {
        await backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    }

    func changeContext(_ change: ErrorIntegrationContextChange) async {
        switch change {
        case .enableAfterStart: diagnostics.setEnabled(true)
        case .disableAndEnable:
            diagnostics.setEnabled(false)
            diagnostics.setEnabled(true)
        case .logout: await account.signOut()
        case .sameAccountLogin:
            await account.signOut()
            await account.signIn(.google)
        case .otherAccountLogin:
            await account.signOut()
            accountService.candidate = PetAccountSession(accessToken: "other-test-access", refreshToken: "other-test-refresh",
                expiresAt: clock.date.addingTimeInterval(3_600), user: Self.otherUser)
            await account.signIn(.github)
        case .ordinaryRefresh: await account.refresh()
        }
    }

    func expectNoDiagnostic() async {
        for _ in 0..<20 { await Task.yield() }
        #expect(delivery.events.isEmpty)
        #expect(events.events.isEmpty)
        #expect(events.saved.flatMap { $0 }.isEmpty)
    }

    func waitForDelivery(count: Int) async -> Bool {
        await errorIntegrationWait { self.delivery.events.count == count && self.events.events.isEmpty }
    }

    func waitForBlockedRequest() async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while ContinuousClock.now < deadline {
            if await transport.isSuspended { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return await transport.isSuspended
    }
}

@MainActor
private func errorIntegrationWait(_ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
}

private actor ErrorIntegrationTransport: PetCoordinatorTransport {
    let backend: PetFakeTransport
    private var blockedType: String?
    private var continuation: CheckedContinuation<Void, Never>?
    private var counts: [String: Int] = [:]
    private var failures: [String: any Error] = [:]
    var isSuspended: Bool { continuation != nil }
    init(backend: PetFakeTransport, blockedType: String?) {
        self.backend = backend
        self.blockedType = blockedType
    }
    func fail(type: String, error: any Error) { failures[type] = error }
    func request(type: String, payload: Data) async throws -> Data {
        counts[type, default: 0] += 1
        if type == blockedType {
            blockedType = nil
            await withCheckedContinuation { continuation = $0 }
        }
        if let error = failures.removeValue(forKey: type) { throw error }
        return try await backend.request(type: type, payload: payload)
    }
    func requestCount(type: String) -> Int { counts[type, default: 0] }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class ErrorIntegrationClock {
    var date = Date(timeIntervalSince1970: 1_800_000_000)
}

@MainActor
private final class ErrorIntegrationEventStore: PetErrorEventStoring {
    var events: [PetErrorEvent] = []
    var saved: [[PetErrorEvent]] = []
    func load() throws -> [PetErrorEvent] { events }
    func save(_ events: [PetErrorEvent]) throws {
        self.events = events
        saved.append(events)
    }
    func clear() throws { events.removeAll() }
}

@MainActor
private final class ErrorIntegrationDeliveryService: PetErrorSending {
    var events: [PetErrorEvent] = []
    func send(_ event: PetErrorEvent, authorization: PetUsageAuthorization) async throws -> PetErrorDelivery {
        #expect(event.userID == authorization.userID)
        events.append(event)
        return .accepted
    }
}

@MainActor
private final class ErrorIntegrationAccountService: PetAccountServicing {
    var candidate: PetAccountSession
    var exchangeError: (any Error)?
    var userError: (any Error)?
    var userGate: ErrorIntegrationAccountGate?
    init(candidate: PetAccountSession) { self.candidate = candidate }
    func exchange(code: String, verifier: String) async throws -> PetAccountSession {
        if let exchangeError { throw exchangeError }
        return candidate
    }
    func refresh(_ session: PetAccountSession) async throws -> PetAccountSession { candidate }
    func user(accessToken: String) async throws -> PetAccountUser {
        let user = candidate.user
        let error = userError
        if let userGate { await userGate.suspend() }
        if let error { throw error }
        return user
    }
    func signOut(accessToken: String) async throws {}
}

@MainActor
private final class ErrorIntegrationAccountStore: PetAccountSessionStoring {
    var value: PetAccountSession?
    init(value: PetAccountSession?) { self.value = value }
    func load() throws -> PetAccountSession? { value }
    func save(_ session: PetAccountSession) throws { value = session }
    func clear() throws { value = nil }
}

@MainActor
private final class ErrorIntegrationAccountBrowser: PetAccountBrowsing {
    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        URL(string: "com.biadone.blabee://auth/callback?code=error-test-code")!
    }
    func cancel() {}
}

@MainActor
private final class ErrorIntegrationAccountGate {
    private var entered = false
    private var continuation: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []
    func suspend() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            entered = true
            let waiting = observers
            observers.removeAll()
            waiting.forEach { $0.resume() }
        }
    }
    func waitUntilEntered() async {
        guard !entered else { return }
        await withCheckedContinuation { observers.append($0) }
    }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@MainActor
private final class ErrorIntegrationServicePreference: PetAppServicePreferenceStoring {
    var enabled = false
}

@MainActor
private final class ErrorIntegrationServiceLauncher: AppOwnedServiceLaunching {
    var children: [ErrorIntegrationServiceChild] = []
    var error: (any Error)?
    func launch() throws -> any AppOwnedServiceChild {
        if let error { throw error }
        let child = ErrorIntegrationServiceChild()
        children.append(child)
        return child
    }
}

@MainActor
private final class ErrorIntegrationServiceChild: AppOwnedServiceChild {
    var isRunning = true
    var hasPublishedService = false
    var terminationSummary: String?
    var stopCount = 0
    func stop() async {
        stopCount += 1
        isRunning = false
    }
}
