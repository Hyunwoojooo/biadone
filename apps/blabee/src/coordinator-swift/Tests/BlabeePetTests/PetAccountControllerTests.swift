import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Pet account controller")
@MainActor
struct PetAccountControllerTests {
    @Test("Both providers exchange, verify the user, and persist the verified identity", arguments: PetAccountProvider.allCases)
    func signsInWithProvider(_ provider: PetAccountProvider) async throws {
        let fixture = AccountControllerFixture()
        let gate = AccountControllerGate()
        fixture.service.userGate = gate
        let verified = PetAccountUser(id: AccountControllerValues.user.id, email: "verified@example.test")
        fixture.service.userResults = [.success(verified)]
        var completions = 0
        fixture.controller.onSignInCompleted = { completions += 1 }

        let login = Task { await fixture.controller.signIn(provider) }
        await gate.waitUntilEntered()
        #expect(fixture.controller.phase == .authorizing(provider))
        #expect(fixture.store.value == AccountControllerValues.fresh)
        #expect(completions == 0)
        gate.release()
        await login.value

        #expect(fixture.controller.phase == .signedIn(verified))
        #expect(fixture.controller.message.isEmpty)
        #expect(fixture.store.value?.user == verified)
        #expect(fixture.store.value?.refreshToken == AccountControllerValues.fresh.refreshToken)
        #expect(fixture.service.exchangeInputs.map(\.code) == ["test-auth-code"])
        #expect(fixture.service.exchangeInputs.map(\.verifier) == [AccountControllerValues.verifier])
        #expect(fixture.service.userInputs == [AccountControllerValues.fresh.accessToken])
        #expect(fixture.events.values == ["browser", "exchange", "save", "user", "save"])
        #expect(completions == 1)

        let request = try #require(fixture.browser.requests.first)
        let parts = try #require(URLComponents(url: request.url, resolvingAgainstBaseURL: false))
        #expect(parts.queryItems?.first(where: { $0.name == "provider" })?.value == provider.rawValue)
        #expect(request.callbackScheme == "com.biadone.blabee")
    }

    @Test("Fresh sessions are verified without refresh and startup restoration happens only once")
    func restoresFreshSessionOnce() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.fresh)

        await fixture.controller.restoreIfNeeded()
        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.store.loadCount == 1)
        #expect(fixture.service.refreshInputs.isEmpty)
        #expect(fixture.service.userInputs == [AccountControllerValues.fresh.accessToken])
        #expect(fixture.store.saved.count == 1)
        #expect(fixture.browser.requests.isEmpty)
    }

    @Test("Expired sessions save rotated refresh tokens before checking the user")
    func restoresExpiredSession() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.expired)

        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.service.refreshInputs == [AccountControllerValues.expired])
        #expect(fixture.service.userInputs == [AccountControllerValues.rotated.accessToken])
        #expect(fixture.store.value == AccountControllerValues.rotated)
        #expect(fixture.events.values == ["load", "refresh", "save", "user", "save"])
    }

    @Test("A rejected fresh access token gets one refresh attempt")
    func refreshesRejectedAccessTokenOnce() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.fresh)
        fixture.service.userResults = [.failure(PetAccountAuthError.unauthorized), .success(AccountControllerValues.user)]

        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.service.refreshInputs == [AccountControllerValues.fresh])
        #expect(fixture.service.userInputs == [AccountControllerValues.fresh.accessToken, AccountControllerValues.rotated.accessToken])
        #expect(fixture.store.value == AccountControllerValues.rotated)
        #expect(fixture.store.clearCount == 0)
    }

    @Test("A rejected refreshed token clears the session instead of refreshing forever")
    func invalidRefreshedSessionClearsLocalState() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.fresh)
        fixture.service.userResults = [.failure(PetAccountAuthError.unauthorized), .failure(PetAccountAuthError.unauthorized)]

        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.store.clearCount == 1)
        #expect(fixture.service.refreshInputs.count == 1)
        #expect(fixture.service.userInputs.count == 2)
        #expect(!fixture.controller.message.isEmpty)
    }

    @Test("Invalid refresh sessions clear local state")
    func invalidRefreshSessionClearsLocalState() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.expired)
        fixture.service.refreshResults = [.failure(PetAccountAuthError.unauthorized)]

        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.store.clearCount == 1)
        #expect(fixture.service.userInputs.isEmpty)
    }

    @Test("Network, rate limit, and unknown refresh failures retain the stored session", arguments: AccountControllerFailure.allCases)
    func recoverableRefreshFailureRetainsSession(_ failure: AccountControllerFailure) async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.expired)
        fixture.service.refreshResults = [.failure(failure.error)]

        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .unavailable)
        #expect(fixture.store.value == AccountControllerValues.expired)
        #expect(fixture.store.clearCount == 0)
        #expect(fixture.service.userInputs.isEmpty)
        #expect(!fixture.controller.message.isEmpty)

        await fixture.controller.refresh()
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.service.refreshInputs == [AccountControllerValues.expired, AccountControllerValues.expired])
        #expect(fixture.store.value == AccountControllerValues.rotated)
    }

    @Test("A user lookup failure retains the new rotated token and can be retried", arguments: AccountControllerFailure.allCases)
    func verificationFailureRetainsRotatedToken(_ failure: AccountControllerFailure) async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.expired)
        fixture.service.userResults = [.failure(failure.error)]

        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .unavailable)
        #expect(fixture.store.value == AccountControllerValues.rotated)
        #expect(fixture.store.saved == [AccountControllerValues.rotated])
        #expect(fixture.store.clearCount == 0)

        await fixture.controller.refresh()
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.service.refreshInputs.count == 1)
        #expect(fixture.service.userInputs == [AccountControllerValues.rotated.accessToken, AccountControllerValues.rotated.accessToken])
    }

    @Test("An exchanged session survives transient verification failure without another browser login")
    func verificationFailureRetainsExchangedToken() async {
        let fixture = AccountControllerFixture()
        fixture.service.userResults = [.failure(URLError(.notConnectedToInternet))]

        await fixture.controller.signIn(.google)
        #expect(fixture.controller.phase == .unavailable)
        #expect(fixture.store.value == AccountControllerValues.fresh)

        await fixture.controller.refresh()
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.browser.requests.count == 1)
        #expect(fixture.service.exchangeInputs.count == 1)
        #expect(fixture.service.refreshInputs.isEmpty)
    }

    @Test("A different user returned by verification is never signed in")
    func rejectsVerifiedIdentityMismatch() async {
        let fixture = AccountControllerFixture()
        fixture.service.userResults = [.success(AccountControllerValues.otherUser)]
        var completions = 0
        fixture.controller.onSignInCompleted = { completions += 1 }

        await fixture.controller.signIn(.github)

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.store.clearCount == 1)
        #expect(fixture.store.saved.allSatisfy { $0.user.id == AccountControllerValues.user.id })
        #expect(completions == 0)
    }

    @Test("A different identity returned by refresh cannot replace the stored identity")
    func rejectsRefreshIdentityMismatch() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.expired)
        fixture.service.refreshResults = [.success(AccountControllerValues.session(user: AccountControllerValues.otherUser))]

        await fixture.controller.restoreIfNeeded()

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.store.saved.isEmpty)
        #expect(fixture.service.userInputs.isEmpty)
    }

    @Test("An in-progress login ignores duplicate provider clicks")
    func ignoresDuplicateSignIn() async {
        let fixture = AccountControllerFixture()
        let gate = AccountControllerGate()
        fixture.browser.gate = gate
        let login = Task { await fixture.controller.signIn(.google) }
        await gate.waitUntilEntered()

        await fixture.controller.signIn(.github)
        #expect(fixture.controller.phase == .authorizing(.google))
        #expect(fixture.browser.requests.count == 1)
        gate.release()
        await login.value

        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.service.exchangeInputs.count == 1)
    }

    @Test("Browser cancellation returns to signed out and permits another attempt")
    func browserCancellationAllowsRetry() async {
        let fixture = AccountControllerFixture()
        fixture.browser.results = [.failure(PetAccountAuthError.cancelled)]

        await fixture.controller.signIn(.google)
        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.service.exchangeInputs.isEmpty)
        #expect(!fixture.controller.message.isEmpty)

        await fixture.controller.signIn(.github)
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.browser.requests.count == 2)
    }

    @Test("An invalid callback never reaches code exchange")
    func rejectsInvalidCallback() async {
        let fixture = AccountControllerFixture()
        fixture.browser.results = [.success(URL(string: "com.biadone.blabee://untrusted/callback?code=test-auth-code")!)]

        await fixture.controller.signIn(.google)

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.service.exchangeInputs.isEmpty)
        #expect(fixture.store.saved.isEmpty)
        #expect(!fixture.controller.message.isEmpty)
    }

    @Test("A cancelled browser callback cannot overwrite a later successful login")
    func ignoresLateBrowserCallbackAfterCancellation() async {
        let fixture = AccountControllerFixture()
        let gate = AccountControllerGate()
        fixture.browser.gate = gate
        var completions = 0
        fixture.controller.onSignInCompleted = { completions += 1 }
        let oldLogin = Task { await fixture.controller.signIn(.google) }
        await gate.waitUntilEntered()

        fixture.controller.cancelSignIn()
        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.browser.cancelCount == 1)
        fixture.browser.gate = nil
        await fixture.controller.signIn(.github)
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))

        gate.release()
        await oldLogin.value
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.store.value == AccountControllerValues.fresh)
        #expect(fixture.service.exchangeInputs.count == 1)
        #expect(completions == 1)
    }

    @Test("Cancelling during verification removes the already persisted candidate")
    func cancelsPendingUserVerification() async {
        let fixture = AccountControllerFixture()
        let gate = AccountControllerGate()
        fixture.service.userGate = gate
        let login = Task { await fixture.controller.signIn(.google) }
        await gate.waitUntilEntered()
        #expect(fixture.store.value == AccountControllerValues.fresh)

        fixture.controller.cancelSignIn()
        #expect(fixture.store.value == nil)
        gate.release()
        await login.value

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.store.saved.count == 1)
    }

    @Test("Logout fences pending browser, exchange, user, and refresh responses", arguments: AccountControllerPendingStage.allCases)
    func logoutFencesPendingResponse(_ stage: AccountControllerPendingStage) async {
        let fixture = AccountControllerFixture(stored: stage == .refresh ? AccountControllerValues.expired : nil)
        let gate = AccountControllerGate()
        fixture.pause(stage, at: gate)
        var completions = 0
        fixture.controller.onSignInCompleted = { completions += 1 }
        let pending = Task { await fixture.run(stage) }
        await gate.waitUntilEntered()
        let savesBeforeLogout = fixture.store.saved.count

        await fixture.controller.signOut()
        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        gate.release()
        await pending.value

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.store.saved.count == savesBeforeLogout)
        #expect(fixture.store.clearCount == 1)
        #expect(completions == 0)
        if stage == .user {
            #expect(fixture.service.signOutInputs == [AccountControllerValues.fresh.accessToken])
        } else if stage == .refresh {
            #expect(fixture.service.signOutInputs == [AccountControllerValues.expired.accessToken])
        } else {
            #expect(fixture.service.signOutInputs.isEmpty)
        }
    }

    @Test("Restoration user lookup cannot undo a simultaneous local logout")
    func logoutFencesRestorationLookup() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.fresh)
        let gate = AccountControllerGate()
        fixture.service.userGate = gate
        let restoration = Task { await fixture.controller.restoreIfNeeded() }
        await gate.waitUntilEntered()

        await fixture.controller.signOut()
        gate.release()
        await restoration.value

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.store.saved.isEmpty)
    }

    @Test("A Keychain deletion failure never falsely reports signed out")
    func failedDeletionRetainsSessionAndCanRetry() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.fresh)
        await fixture.controller.restoreIfNeeded()
        fixture.store.clearError = PetAccountAuthError.storageUnavailable

        await fixture.controller.signOut()

        #expect(fixture.controller.phase == .unavailable)
        #expect(fixture.store.value == AccountControllerValues.fresh)
        #expect(fixture.service.signOutInputs.isEmpty)
        #expect(fixture.controller.message.contains("키체인"))

        fixture.store.clearError = nil
        await fixture.controller.signOut()
        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.service.signOutInputs == [AccountControllerValues.fresh.accessToken])
    }

    @Test("Offline logout clears the local session even when remote revocation fails")
    func offlineLogoutClearsSession() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.fresh)
        await fixture.controller.restoreIfNeeded()
        fixture.service.signOutResults = [.failure(URLError(.notConnectedToInternet))]

        await fixture.controller.signOut()

        #expect(fixture.controller.phase == .signedOut)
        #expect(fixture.store.value == nil)
        #expect(fixture.service.signOutInputs == [AccountControllerValues.fresh.accessToken])
        #expect(fixture.controller.message.contains("이 기기에서 로그아웃"))
        #expect(fixture.controller.message.contains("확인하지 못했습니다"))
    }

    @Test("A failed Keychain save can retry using the newest rotated refresh token")
    func retriesSavingRotatedSession() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.expired)
        fixture.store.failedSavesRemaining = 1

        await fixture.controller.restoreIfNeeded()
        #expect(fixture.controller.phase == .unavailable)
        #expect(fixture.store.value == AccountControllerValues.expired)
        #expect(fixture.service.userInputs.isEmpty)
        #expect(fixture.store.saveAttempts == [AccountControllerValues.rotated])

        await fixture.controller.refresh()
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.store.value == AccountControllerValues.rotated)
        #expect(fixture.service.refreshInputs == [AccountControllerValues.expired])
        #expect(fixture.service.userInputs == [AccountControllerValues.rotated.accessToken])
        #expect(fixture.store.saveAttempts == [AccountControllerValues.rotated, AccountControllerValues.rotated])
    }

    @Test("A failed initial Keychain save can retry without exchanging the one-use code again")
    func retriesSavingExchangedSession() async {
        let fixture = AccountControllerFixture()
        fixture.store.failedSavesRemaining = 1

        await fixture.controller.signIn(.google)
        #expect(fixture.controller.phase == .unavailable)
        #expect(fixture.store.value == nil)
        #expect(fixture.service.userInputs.isEmpty)

        await fixture.controller.refresh()
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.store.value == AccountControllerValues.fresh)
        #expect(fixture.service.exchangeInputs.count == 1)
        #expect(fixture.service.refreshInputs.isEmpty)
        #expect(fixture.service.userInputs == [AccountControllerValues.fresh.accessToken])
    }

    @Test("A locked Keychain remains unavailable until the stored session can be read")
    func retriesUnavailableStorageRead() async {
        let fixture = AccountControllerFixture(stored: AccountControllerValues.fresh)
        fixture.store.loadError = PetAccountAuthError.storageUnavailable

        await fixture.controller.restoreIfNeeded()
        #expect(fixture.controller.phase == .unavailable)
        #expect(fixture.service.userInputs.isEmpty)
        #expect(fixture.store.value == AccountControllerValues.fresh)

        fixture.store.loadError = nil
        await fixture.controller.refresh()
        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.store.loadCount == 2)
    }

    @Test("A fired refresh timer does not cancel its own refresh request")
    func firedRefreshTimerRemainsUncancelled() async {
        let firstSleep = AccountControllerGate()
        let nextSleep = AccountControllerGate()
        let refresh = AccountControllerGate()
        var currentTime = AccountControllerValues.now
        var delays: [TimeInterval] = []
        let fixture = AccountControllerFixture(
            stored: AccountControllerValues.fresh,
            automaticRefresh: true,
            now: { currentTime },
            sleep: { delay in
                delays.append(delay)
                if delays.count == 1 { await firstSleep.suspend() }
                else { await nextSleep.suspend() }
            }
        )
        let renewed = AccountControllerValues.session(
            access: "timer-access", refresh: "timer-refresh", expiresIn: 7_200
        )
        fixture.service.refreshResults = [.success(renewed)]
        fixture.service.refreshGate = refresh

        await fixture.controller.restoreIfNeeded()
        await firstSleep.waitUntilEntered()
        #expect(delays == [3_540])
        currentTime = AccountControllerValues.fresh.expiresAt.addingTimeInterval(-60)
        firstSleep.release()
        await refresh.waitUntilEntered()
        #expect(fixture.service.refreshCancellationFlags == [false])
        refresh.release()
        await nextSleep.waitUntilEntered()

        #expect(fixture.controller.phase == .signedIn(AccountControllerValues.user))
        #expect(fixture.store.value == renewed)
        #expect(fixture.service.userInputs == [AccountControllerValues.fresh.accessToken, renewed.accessToken])
        #expect(delays == [3_540, 3_600])
        fixture.controller.stop()
        nextSleep.release()
    }

    @Test("Stopping the controller fences every pending response", arguments: AccountControllerPendingStage.allCases)
    func stopFencesPendingResponse(_ stage: AccountControllerPendingStage) async {
        let fixture = AccountControllerFixture(stored: stage == .refresh ? AccountControllerValues.expired : nil)
        let gate = AccountControllerGate()
        fixture.pause(stage, at: gate)
        var completions = 0
        fixture.controller.onSignInCompleted = { completions += 1 }
        let pending = Task { await fixture.run(stage) }
        await gate.waitUntilEntered()
        let previousPhase = fixture.controller.phase
        let previousValue = fixture.store.value
        let previousSaveCount = fixture.store.saved.count

        fixture.controller.stop()
        gate.release()
        await pending.value
        #expect(fixture.controller.phase == previousPhase)
        #expect(fixture.store.value == previousValue)
        #expect(fixture.store.saved.count == previousSaveCount)
        #expect(fixture.browser.cancelCount == 1)
        #expect(completions == 0)

        let eventCount = fixture.events.values.count
        await fixture.controller.refresh()
        await fixture.controller.signIn(.github)
        await fixture.controller.signOut()
        #expect(fixture.events.values.count == eventCount)
    }
}

private enum AccountControllerValues {
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static let verifier = String(repeating: "a", count: 64)
    static let user = PetAccountUser(id: "11111111-1111-4111-8111-111111111111", email: "account@example.test")
    static let otherUser = PetAccountUser(id: "22222222-2222-4222-8222-222222222222", email: "other@example.test")
    static let fresh = session()
    static let expired = session(access: "expired-access", refresh: "old-refresh", expiresIn: -10)
    static let rotated = session(access: "rotated-access", refresh: "rotated-refresh")
    static let callback = URL(string: "com.biadone.blabee://auth/callback?code=test-auth-code")!

    static func session(
        access: String = "fresh-access", refresh: String = "fresh-refresh",
        expiresIn: TimeInterval = 3_600, user: PetAccountUser = AccountControllerValues.user
    ) -> PetAccountSession {
        PetAccountSession(accessToken: access, refreshToken: refresh,
                          expiresAt: now.addingTimeInterval(expiresIn), user: user)
    }
}

enum AccountControllerFailure: CaseIterable, Sendable {
    case network, rateLimit, invalidResponse, unexpected

    var error: any Error {
        switch self {
        case .network: URLError(.notConnectedToInternet)
        case .rateLimit: PetAccountAuthError.rateLimited
        case .invalidResponse: PetAccountAuthError.invalidResponse
        case .unexpected: AccountControllerUnexpectedError.failed
        }
    }
}

private enum AccountControllerUnexpectedError: Error { case failed }
enum AccountControllerPendingStage: CaseIterable, Sendable { case browser, exchange, user, refresh }

@MainActor
private final class AccountControllerEvents {
    var values: [String] = []
}

/// A one-use rendezvous: no sleeps, clock assumptions, or polling loops.
@MainActor
private final class AccountControllerGate {
    private var entered = false
    private var continuation: CheckedContinuation<Void, Never>?
    private var observers: [CheckedContinuation<Void, Never>] = []

    func suspend() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            entered = true
            let observers = observers
            self.observers.removeAll()
            observers.forEach { $0.resume() }
        }
    }

    func waitUntilEntered() async {
        guard !entered else { return }
        await withCheckedContinuation { observers.append($0) }
    }

    func release() {
        let continuation = continuation
        self.continuation = nil
        continuation?.resume()
    }
}

@MainActor
private final class AccountControllerFixture {
    let events = AccountControllerEvents()
    let service: AccountControllerService
    let store: AccountControllerStore
    let browser: AccountControllerBrowser
    let controller: PetAccountController

    init(
        stored: PetAccountSession? = nil,
        automaticRefresh: Bool = false,
        now: @escaping () -> Date = { AccountControllerValues.now },
        sleep: @escaping @MainActor (TimeInterval) async throws -> Void = { _ in }
    ) {
        service = AccountControllerService(events: events)
        store = AccountControllerStore(events: events, value: stored)
        browser = AccountControllerBrowser(events: events)
        controller = PetAccountController(
            service: service, store: store, browser: browser,
            configuration: PetAccountConfiguration(
                supabaseURL: URL(string: "https://example.supabase.co")!, publishableKey: "test-public-key"
            ),
            now: now, automaticRefresh: automaticRefresh, sleep: sleep,
            makeVerifier: { AccountControllerValues.verifier }
        )
    }

    func pause(_ stage: AccountControllerPendingStage, at gate: AccountControllerGate) {
        switch stage {
        case .browser: browser.gate = gate
        case .exchange: service.exchangeGate = gate
        case .user: service.userGate = gate
        case .refresh: service.refreshGate = gate
        }
    }

    func run(_ stage: AccountControllerPendingStage) async {
        if stage == .refresh { await controller.restoreIfNeeded() }
        else { await controller.signIn(.google) }
    }
}

@MainActor
private final class AccountControllerService: PetAccountServicing {
    struct ExchangeInput { let code: String; let verifier: String }
    let events: AccountControllerEvents
    var exchangeGate: AccountControllerGate?
    var refreshGate: AccountControllerGate?
    var userGate: AccountControllerGate?
    var exchangeResults: [Result<PetAccountSession, any Error>] = []
    var refreshResults: [Result<PetAccountSession, any Error>] = []
    var userResults: [Result<PetAccountUser, any Error>] = []
    var signOutResults: [Result<Void, any Error>] = []
    var exchangeInputs: [ExchangeInput] = []
    var refreshInputs: [PetAccountSession] = []
    var refreshCancellationFlags: [Bool] = []
    var userInputs: [String] = []
    var signOutInputs: [String] = []

    init(events: AccountControllerEvents) { self.events = events }

    func exchange(code: String, verifier: String) async throws -> PetAccountSession {
        events.values.append("exchange")
        exchangeInputs.append(.init(code: code, verifier: verifier))
        let result = exchangeResults.isEmpty ? .success(AccountControllerValues.fresh) : exchangeResults.removeFirst()
        if let exchangeGate { await exchangeGate.suspend() }
        return try result.get()
    }

    func refresh(_ session: PetAccountSession) async throws -> PetAccountSession {
        events.values.append("refresh")
        refreshInputs.append(session)
        refreshCancellationFlags.append(Task.isCancelled)
        let result = refreshResults.isEmpty ? .success(AccountControllerValues.rotated) : refreshResults.removeFirst()
        if let refreshGate { await refreshGate.suspend() }
        return try result.get()
    }

    func user(accessToken: String) async throws -> PetAccountUser {
        events.values.append("user")
        userInputs.append(accessToken)
        let result = userResults.isEmpty ? .success(AccountControllerValues.user) : userResults.removeFirst()
        if let userGate { await userGate.suspend() }
        return try result.get()
    }

    func signOut(accessToken: String) async throws {
        events.values.append("signOut")
        signOutInputs.append(accessToken)
        if !signOutResults.isEmpty { try signOutResults.removeFirst().get() }
    }
}

@MainActor
private final class AccountControllerStore: PetAccountSessionStoring {
    let events: AccountControllerEvents
    var value: PetAccountSession?
    var loadError: (any Error)?
    var clearError: (any Error)?
    var failedSavesRemaining = 0
    var loadCount = 0
    var clearCount = 0
    var saveAttempts: [PetAccountSession] = []
    var saved: [PetAccountSession] = []

    init(events: AccountControllerEvents, value: PetAccountSession?) {
        self.events = events
        self.value = value
    }

    func load() throws -> PetAccountSession? {
        events.values.append("load")
        loadCount += 1
        if let loadError { throw loadError }
        return value
    }

    func save(_ session: PetAccountSession) throws {
        events.values.append("save")
        saveAttempts.append(session)
        if failedSavesRemaining > 0 {
            failedSavesRemaining -= 1
            throw PetAccountAuthError.storageUnavailable
        }
        saved.append(session)
        value = session
    }

    func clear() throws {
        events.values.append("clear")
        clearCount += 1
        if let clearError { throw clearError }
        value = nil
    }
}

@MainActor
private final class AccountControllerBrowser: PetAccountBrowsing {
    struct Request { let url: URL; let callbackScheme: String }
    let events: AccountControllerEvents
    var gate: AccountControllerGate?
    var results: [Result<URL, any Error>] = []
    var requests: [Request] = []
    var cancelCount = 0

    init(events: AccountControllerEvents) { self.events = events }

    func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        events.values.append("browser")
        requests.append(.init(url: url, callbackScheme: callbackScheme))
        let result = results.isEmpty ? .success(AccountControllerValues.callback) : results.removeFirst()
        if let gate { await gate.suspend() }
        return try result.get()
    }

    func cancel() {
        events.values.append("cancelBrowser")
        cancelCount += 1
        // Deliberately leave pending callbacks alive to model late OS delivery.
    }
}
