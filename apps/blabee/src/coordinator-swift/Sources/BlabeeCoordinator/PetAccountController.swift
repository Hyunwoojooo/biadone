import Combine
import Foundation

enum PetAccountPhase: Equatable {
    case signedOut
    case checking
    case authorizing(PetAccountProvider)
    case signedIn(PetAccountUser)
    case signingOut
    case unavailable
}

/// Account identity lives independently of the Coordinator journal and paid
/// entitlements. Every await is fenced so a late response cannot undo logout.
@MainActor
final class PetAccountController: ObservableObject {
    @Published private(set) var phase: PetAccountPhase = .signedOut {
        didSet {
            switch phase {
            case .signedOut, .signingOut: errorDiagnostics?.clearIdentity()
            default: errorDiagnostics?.accountStateChanged()
            }
            onPhaseChanged?(phase)
        }
    }
    @Published private(set) var message = ""
    var onSignInCompleted: (() -> Void)?
    var onPhaseChanged: ((PetAccountPhase) -> Void)?
    weak var errorDiagnostics: PetErrorDiagnostics?

    private let service: any PetAccountServicing
    private let store: any PetAccountSessionStoring
    private let browser: any PetAccountBrowsing
    private let configuration: PetAccountConfiguration
    private let now: () -> Date
    private let automaticRefresh: Bool
    private let sleep: @MainActor (TimeInterval) async throws -> Void
    private let makeVerifier: () throws -> String
    private var session: PetAccountSession?
    private var revision: UInt64 = 0
    private var started = false
    private var stopped = false
    private var refreshTask: Task<Void, Never>?
    private var retryDelay: TimeInterval = 30

    init(
        service: any PetAccountServicing,
        store: any PetAccountSessionStoring,
        browser: any PetAccountBrowsing,
        configuration: PetAccountConfiguration = .current,
        now: @escaping () -> Date = Date.init,
        automaticRefresh: Bool = true,
        sleep: @escaping @MainActor (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
        makeVerifier: @escaping () throws -> String = PetAccountPKCE.makeVerifier
    ) {
        self.service = service
        self.store = store
        self.browser = browser
        self.configuration = configuration
        self.now = now
        self.automaticRefresh = automaticRefresh
        self.sleep = sleep
        self.makeVerifier = makeVerifier
    }

    static func live() -> PetAccountController {
        PetAccountController(
            service: PetSupabaseAccountService(),
            store: PetKeychainAccountSessionStore(),
            browser: PetASWebAccountBrowser()
        )
    }

    /// Only the current verified identity can authorize a usage upload. The
    /// recorder receives no refresh token and never persists this authorization.
    func usageAuthorization() -> PetUsageAuthorization? {
        guard !stopped, case let .signedIn(user) = phase,
              let session, session.user.id == user.id, session.expiresAt > now()
        else { return nil }
        return PetUsageAuthorization(
            userID: user.id, accessToken: session.accessToken, expiresAt: session.expiresAt
        )
    }

    func restoreIfNeeded() async {
        guard !started else { return }
        started = true
        await refresh()
    }

    func refresh() async {
        guard !stopped else { return }
        switch phase {
        case .checking, .authorizing, .signingOut: return
        default: break
        }
        // Keep the verified account and consent from before checking temporarily
        // removes upload authorization. Never attribute initial OAuth failures.
        let errorContext = errorDiagnostics?.captureContext()
        let attempt = begin(.checking)
        do {
            guard var candidate = try session ?? store.load() else {
                phase = .signedOut
                return
            }
            session = candidate
            let expectedID = candidate.user.id
            var didRefresh = false
            if candidate.expiresAt <= now().addingTimeInterval(60) {
                candidate = try await service.refresh(candidate)
                guard isCurrent(attempt) else { return }
                try persist(candidate, expectedID: expectedID)
                didRefresh = true
            }
            do {
                try await verify(candidate, attempt: attempt)
            } catch PetAccountAuthError.unauthorized where !didRefresh {
                guard isCurrent(attempt) else { return }
                // A revoked/expired access token can still have a valid refresh
                // token. Retry exactly once, never an unbounded refresh loop.
                candidate = try await service.refresh(candidate)
                guard isCurrent(attempt) else { return }
                try persist(candidate, expectedID: expectedID)
                try await verify(candidate, attempt: attempt)
            }
        } catch {
            if isCurrent(attempt) {
                recordRefreshFailure(error, context: errorContext)
            }
            handle(error, attempt: attempt)
        }
    }

    func signIn(_ provider: PetAccountProvider) async {
        guard !stopped, phase == .signedOut else { return }
        started = true
        let attempt = begin(.authorizing(provider))
        do {
            let verifier = try makeVerifier()
            let url = try configuration.authorizationURL(provider: provider, verifier: verifier)
            let callback = try await browser.authenticate(
                url: url, callbackScheme: configuration.callbackURL.scheme!
            )
            guard isCurrent(attempt) else { return }
            let code = try configuration.authorizationCode(from: callback)
            let candidate = try await service.exchange(code: code, verifier: verifier)
            guard isCurrent(attempt) else { return }
            // Persist a newly issued/rotated token before the subsequent user
            // request, so a transient failure cannot lose the refresh token.
            try persist(candidate, expectedID: candidate.user.id)
            try await verify(candidate, attempt: attempt)
            guard isCurrent(attempt), case .signedIn = phase else { return }
            onSignInCompleted?()
        } catch {
            guard isCurrent(attempt) else { return }
            if session == nil {
                phase = .signedOut
                message = message(for: error)
            } else {
                handle(error, attempt: attempt)
            }
        }
    }

    func cancelSignIn() {
        guard case .authorizing = phase else { return }
        revision &+= 1
        browser.cancel()
        // A code exchange may already have produced a stored session while its
        // getUser call is in flight. Clearing it is part of cancelling sign-in.
        do {
            try store.clear()
            session = nil
            phase = .signedOut
            message = "로그인을 취소했습니다."
        } catch {
            phase = .unavailable
            message = message(for: PetAccountAuthError.storageUnavailable)
        }
    }

    func signOut() async {
        guard !stopped, phase != .signingOut else { return }
        let previous = session
        let attempt = begin(.signingOut)
        browser.cancel()
        do {
            try store.clear()
        } catch {
            phase = .unavailable
            message = "로그인 정보를 지우지 못했습니다. macOS 키체인 접근을 확인하고 다시 로그아웃해주세요."
            return
        }
        session = nil
        phase = .signedOut
        message = "이 기기에서 로그아웃했습니다."
        // Local deletion does not depend on connectivity. Only revoke the
        // captured session; a later login belongs to a different session.
        if let previous {
            do { try await service.signOut(accessToken: previous.accessToken) }
            catch {
                if isCurrent(attempt) {
                    message = "이 기기에서 로그아웃했습니다. 서버의 세션 종료는 확인하지 못했습니다."
                }
            }
        }
    }

    func stop() {
        stopped = true
        revision &+= 1
        refreshTask?.cancel()
        refreshTask = nil
        browser.cancel()
        onSignInCompleted = nil
        onPhaseChanged = nil
        errorDiagnostics = nil
    }

    private func begin(_ phase: PetAccountPhase) -> UInt64 {
        revision &+= 1
        refreshTask?.cancel()
        refreshTask = nil
        self.phase = phase
        message = ""
        return revision
    }

    private func isCurrent(_ attempt: UInt64) -> Bool { !stopped && revision == attempt }

    private func persist(_ candidate: PetAccountSession, expectedID: String) throws {
        guard candidate.user.id == expectedID else { throw PetAccountAuthError.unauthorized }
        // Keep the newest token in memory if Keychain is temporarily locked.
        session = candidate
        do { try store.save(candidate) }
        catch { throw PetAccountAuthError.storageUnavailable }
    }

    private func verify(_ candidate: PetAccountSession, attempt: UInt64) async throws {
        let user = try await service.user(accessToken: candidate.accessToken)
        guard isCurrent(attempt) else { return }
        guard user.id == candidate.user.id else { throw PetAccountAuthError.unauthorized }
        let verified = PetAccountSession(
            accessToken: candidate.accessToken, refreshToken: candidate.refreshToken,
            expiresAt: candidate.expiresAt, user: user
        )
        try persist(verified, expectedID: candidate.user.id)
        phase = .signedIn(user)
        message = ""
        retryDelay = 30
        scheduleRefresh(after: max(1, candidate.expiresAt.timeIntervalSince(now()) - 60))
    }

    private func handle(_ error: any Error, attempt: UInt64) {
        guard isCurrent(attempt) else { return }
        if error as? PetAccountAuthError == .unauthorized {
            do {
                try store.clear()
                session = nil
                phase = .signedOut
                message = "로그인이 만료되었습니다. 다시 로그인해주세요."
            } catch {
                phase = .unavailable
                message = message(for: PetAccountAuthError.storageUnavailable)
            }
        } else {
            phase = .unavailable
            message = message(for: error)
            if session != nil, error as? PetAccountAuthError != .storageUnavailable {
                scheduleRefresh(after: retryDelay)
                retryDelay = min(300, retryDelay * 2)
            }
        }
    }

    private func scheduleRefresh(after seconds: TimeInterval) {
        guard automaticRefresh else { return }
        refreshTask?.cancel()
        let sleep = sleep
        refreshTask = Task { [weak self] in
            do { try await sleep(seconds) } catch { return }
            guard !Task.isCancelled else { return }
            // begin() cancels a pending timer; detach this fired timer first
            // so refresh does not cancel its own network requests.
            self?.refreshTask = nil
            await self?.refresh()
        }
    }

    private func recordRefreshFailure(_ error: any Error, context: PetErrorContext?) {
        guard !Task.isCancelled, !(error is CancellationError),
              (error as? URLError)?.code != .cancelled, let context else { return }
        let code: PetErrorCode
        switch error as? PetAccountAuthError {
        case .cancelled, .unauthorized: return
        case .serviceUnavailable: code = .accountServiceUnavailable
        case .invalidResponse: code = .accountInvalidResponse
        case .rateLimited: code = .accountRateLimited
        case .storageUnavailable: code = .accountStorageUnavailable
        default: code = .accountRefreshFailed
        }
        errorDiagnostics?.record(code: code, context: context)
    }

    private func message(for error: any Error) -> String {
        switch error as? PetAccountAuthError {
        case .cancelled: "로그인이 취소되었거나 시간이 초과되었습니다. 다시 시도해주세요."
        case .invalidCallback: "앱으로 돌아온 로그인 정보를 확인하지 못했습니다. 앱에서 다시 로그인해주세요."
        case .unauthorized: "로그인이 만료되었습니다. 다시 로그인해주세요."
        case .rateLimited: "로그인 요청이 많습니다. 잠시 후 다시 시도해주세요."
        case .storageUnavailable: "로그인 정보를 저장하거나 읽지 못했습니다. macOS 키체인 접근을 확인하고 다시 시도해주세요."
        case .providerUnavailable: "선택한 로그인을 사용할 수 없습니다. 잠시 후 다시 시도해주세요."
        default: "계정에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요."
        }
    }
}
