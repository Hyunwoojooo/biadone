import CoordinatorSwift
import Foundation

enum ProductAccessState: String, Sendable, CaseIterable {
    case signedOut = "signed_out", checking, active, suspended
    case servicePaused = "service_paused", socialLoginRequired = "social_login_required"
    case unavailable, expired
}

struct ProductAccessSnapshot: Equatable, Sendable {
    let revision: Int64
    let serviceGeneration: String
    let state: ProductAccessState
    let userID: String?
    let remainingSeconds: Int
}

struct ProductAccessGrant: Sendable {
    let userID: String
    let sessionID: String
    let state: ProductAccessState
    /// Server time difference, never a deadline interpreted using the Mac's wall clock.
    let validForSeconds: TimeInterval
}

enum ProductAccessCheckError: Error, Sendable {
    case rejected, unavailable, invalidResponse
}

protocol ProductAccessChecking: Sendable {
    func check(accessToken: String, userID: String) async throws -> ProductAccessGrant
}

/// Process-memory authority owned by the service. No UI-provided allow bit,
/// persistent license file, refresh token, Keychain access, or journal writes.
/// Network work never runs on the operational actor or under a registry lock.
final class ProductAccessController: @unchecked Sendable {
    private struct Credential: Equatable {
        let userID: String
        let token: String
    }
    private let lock = NSLock()
    private let checker: any ProductAccessChecking
    private let clock: any CoordinatorContinuousClock
    private let automaticRefresh: Bool
    private let onVerifiedToken: @Sendable (String) -> Void
    private let sleep: @Sendable (TimeInterval) async throws -> Void
    private let serviceGeneration = UUID().uuidString.lowercased()
    private var revision: Int64 = 0
    private var epoch: UInt64 = 0
    private var authorizationGeneration: UInt64 = 0
    private var credential: Credential?
    private var state: ProductAccessState = .signedOut
    private var deadline: UInt64?
    private var acceptedAt: UInt64?
    private var lastAttemptAt: UInt64?
    private var task: Task<Void, Never>?
    private var timer: Task<Void, Never>?
    private var stopped = false

    init(checker: any ProductAccessChecking = SupabaseProductAccessChecker(),
         clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
         automaticRefresh: Bool = true,
         onVerifiedToken: @escaping @Sendable (String) -> Void = { _ in },
         sleep: @escaping @Sendable (TimeInterval) async throws -> Void = {
             try await Task.sleep(for: .seconds($0))
         }) {
        self.checker = checker; self.clock = clock
        self.automaticRefresh = automaticRefresh; self.sleep = sleep
        self.onVerifiedToken = onVerifiedToken
    }

    deinit { task?.cancel(); timer?.cancel() }

    func snapshot() -> ProductAccessSnapshot { lock.withLock { snapshotLocked() } }

    func requireAccess() throws {
        _ = try authorize()
    }

    /// A prepared action may not cross logout, suspension, expiry or an account switch.
    func authorize() throws -> UInt64 {
        try lock.withLock {
            let current = snapshotLocked()
            guard !stopped, current.state == .active else {
                throw CoordinatorError("product_access_" + current.state.rawValue)
            }
            return authorizationGeneration
        }
    }

    func update(userID: String, accessToken: String, revision next: Int64) throws -> ProductAccessSnapshot {
        guard UUID(uuidString: userID)?.uuidString.lowercased() == userID,
              (8...16_384).contains(accessToken.utf8.count),
              accessToken.utf8.allSatisfy({ (33...126).contains($0) }), next > 0 else {
            throw CoordinatorError("product_access_request_invalid")
        }
        return try lock.withLock {
            guard !stopped else { throw CoordinatorError("product_access_unavailable") }
            let proposed = Credential(userID: userID, token: accessToken)
            guard next > revision || (next == revision && credential == proposed) else {
                throw CoordinatorError("product_access_stale_request")
            }
            revision = next
            // Repeated delivery of the same token is not a new authorization.
            guard credential != proposed else { return snapshotLocked() }
            let sameUser = credential?.userID == userID
            credential = proposed
            epoch &+= 1
            task?.cancel(); task = nil; timer?.cancel(); timer = nil
            if !sameUser || snapshotLocked().state != .active {
                authorizationGeneration &+= 1
                deadline = nil; acceptedAt = nil
                if !sameUser || ![.suspended, .servicePaused, .socialLoginRequired, .signedOut].contains(state) {
                    state = .checking
                }
            }
            startCheckLocked()
            return snapshotLocked()
        }
    }

    func clear(revision next: Int64) throws -> ProductAccessSnapshot {
        try lock.withLock {
            guard next > 0, next > revision || (next == revision && credential == nil) else {
                throw CoordinatorError("product_access_stale_request")
            }
            revision = next; epoch &+= 1
            authorizationGeneration &+= 1
            credential = nil; deadline = nil; acceptedAt = nil; state = .signedOut
            task?.cancel(); task = nil; timer?.cancel(); timer = nil
            return snapshotLocked()
        }
    }

    /// Explicit retry is bounded too; many Pet polls cannot multiply RPC work.
    @discardableResult
    func refresh() -> ProductAccessSnapshot {
        lock.withLock {
            guard !stopped, credential != nil, task == nil else { return snapshotLocked() }
            let now = clock.nowNanoseconds()
            if let lastAttemptAt, now >= lastAttemptAt, now - lastAttemptAt < 5_000_000_000 {
                return snapshotLocked()
            }
            timer?.cancel(); timer = nil
            startCheckLocked()
            return snapshotLocked()
        }
    }

    func stop() {
        lock.withLock {
            stopped = true; epoch &+= 1; credential = nil
            authorizationGeneration &+= 1
            deadline = nil; acceptedAt = nil; state = .unavailable
            task?.cancel(); task = nil; timer?.cancel(); timer = nil
        }
    }

    private func snapshotLocked() -> ProductAccessSnapshot {
        let now = clock.nowNanoseconds()
        if state == .active {
            guard let deadline, let acceptedAt, now >= acceptedAt, now < deadline else {
                self.deadline = nil; self.acceptedAt = nil; state = .expired
                authorizationGeneration &+= 1
                return snapshotLocked()
            }
            return .init(revision: revision, serviceGeneration: serviceGeneration, state: .active,
                         userID: credential?.userID, remainingSeconds: Int((deadline - now + 999_999_999) / 1_000_000_000))
        }
        return .init(revision: revision, serviceGeneration: serviceGeneration, state: state,
                     userID: credential?.userID, remainingSeconds: 0)
    }

    private func startCheckLocked() {
        guard let credential, !stopped, task == nil else { return }
        let requestEpoch = epoch, startedAt = clock.nowNanoseconds(), checker = checker
        lastAttemptAt = startedAt
        if ![.active, .suspended, .servicePaused, .socialLoginRequired, .signedOut].contains(snapshotLocked().state) {
            state = .checking
        }
        task = Task.detached { [weak self] in
            let result: Result<ProductAccessGrant, any Error>
            do { result = .success(try await checker.check(accessToken: credential.token, userID: credential.userID)) }
            catch { result = .failure(error) }
            self?.finish(result, credential: credential, epoch: requestEpoch, startedAt: startedAt)
        }
    }

    private func finish(_ result: Result<ProductAccessGrant, any Error>, credential requested: Credential,
                        epoch requestedEpoch: UInt64, startedAt: UInt64) {
        lock.withLock {
            guard !stopped, epoch == requestedEpoch, credential == requested else { return }
            task = nil
            // Expiry is an authority boundary even when no consumer polled
            // during a long sleep/network outage before this response.
            _ = snapshotLocked()
            let now = clock.nowNanoseconds()
            switch result {
            case .success(let grant):
                guard grant.userID == requested.userID, UUID(uuidString: grant.sessionID) != nil,
                      [.active, .suspended, .servicePaused, .socialLoginRequired].contains(grant.state),
                      grant.validForSeconds.isFinite, grant.validForSeconds >= 0,
                      grant.validForSeconds <= 300, now >= startedAt else {
                    denyLocked(.unavailable); scheduleLocked(); return
                }
                if grant.state == .active {
                    let duration = UInt64(grant.validForSeconds * 1_000_000_000)
                    let (end, overflow) = startedAt.addingReportingOverflow(duration)
                    // Counting from request start is conservative: a slow reply
                    // cannot create an additional five-minute allowance.
                    if !overflow, now < end {
                        state = .active; acceptedAt = startedAt; deadline = end
                    } else { denyLocked(.expired) }
                } else { denyLocked(grant.state) }
                onVerifiedToken(requested.token)
            case .failure(let error):
                switch error as? ProductAccessCheckError {
                case .rejected: denyLocked(.signedOut)
                case .invalidResponse: denyLocked(.unavailable)
                default:
                    // Connectivity cannot renew a grant or undo a known denial.
                    if snapshotLocked().state != .active,
                       ![.suspended, .servicePaused, .socialLoginRequired, .signedOut].contains(state) {
                        state = .unavailable
                    }
                }
            }
            scheduleLocked()
        }
    }

    private func denyLocked(_ denied: ProductAccessState) {
        if deadline != nil { authorizationGeneration &+= 1 }
        deadline = nil; acceptedAt = nil; state = denied
    }

    private func scheduleLocked() {
        guard automaticRefresh, !stopped, credential != nil else { return }
        let sleep = sleep, epoch = epoch, now = clock.nowNanoseconds()
        let elapsed = lastAttemptAt.map { now >= $0 ? Double(now - $0) / 1_000_000_000 : 0 } ?? 0
        let delay = max(1, 60 - elapsed)
        timer?.cancel()
        timer = Task { [weak self] in
            do { try await sleep(delay) } catch { return }
            guard !Task.isCancelled else { return }
            self?.lock.withLock {
                guard let self, self.epoch == epoch, !self.stopped else { return }
                self.timer = nil; self.startCheckLocked()
            }
        }
    }
}

/// Uses the same public project configuration as social login. The service
/// performs HTTPS itself; a caller cannot inject a server result or endpoint.
struct SupabaseProductAccessChecker: ProductAccessChecking {
    typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
    private let configuration: PetAccountConfiguration
    private let transport: Transport

    init(configuration: PetAccountConfiguration = .current, transport: Transport? = nil) {
        self.configuration = configuration
        let client = ProductAccessHTTPClient()
        self.transport = transport ?? { try await client.send($0) }
    }

    func check(accessToken: String, userID: String) async throws -> ProductAccessGrant {
        let nonce = UUID().uuidString.lowercased()
        guard var parts = URLComponents(url: configuration.supabaseURL, resolvingAgainstBaseURL: false),
              parts.scheme == "https", parts.host != nil, parts.user == nil, parts.password == nil,
              parts.port == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { throw ProductAccessCheckError.invalidResponse }
        parts.path = "/rest/v1/rpc/get_blabee_access"
        guard let url = parts.url else { throw ProductAccessCheckError.invalidResponse }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
        request.httpMethod = "POST"; request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["p_nonce": nonce])
        let data: Data, response: HTTPURLResponse
        do { (data, response) = try await transport(request) }
        catch let error as ProductAccessCheckError { throw error }
        catch { throw ProductAccessCheckError.unavailable }
        if [401, 403].contains(response.statusCode) { throw ProductAccessCheckError.rejected }
        if response.statusCode == 429 || (500...599).contains(response.statusCode) {
            throw ProductAccessCheckError.unavailable
        }
        guard response.statusCode == 200, data.count <= 16_384 else { throw ProductAccessCheckError.invalidResponse }
        do {
            let value = try StrictJSONTransport.object(from: data, limits: .init(maximumBytes: 16_384, maximumDepth: 4))
            guard Set(value.keys) == ["schema_version", "request_nonce", "user_id", "session_id", "status",
                                     "server_now", "access_expires_at", "refresh_after_seconds"],
                  ExactJSONInteger.int64(value["schema_version"], minimum: 1) == 1,
                  value["request_nonce"] as? String == nonce,
                  let subject = value["user_id"] as? String, subject == userID,
                  let session = value["session_id"] as? String, UUID(uuidString: session) != nil,
                  let text = value["status"] as? String, let state = ProductAccessState(rawValue: text),
                  [.active, .suspended, .servicePaused, .socialLoginRequired].contains(state),
                  ExactJSONInteger.int64(value["refresh_after_seconds"], minimum: 1) == 60,
                  let nowText = value["server_now"] as? String, let now = Self.date(nowText) else {
                throw ProductAccessCheckError.invalidResponse
            }
            let lifetime: TimeInterval
            if state == .active {
                guard let expiryText = value["access_expires_at"] as? String, let expiry = Self.date(expiryText),
                      expiry > now, expiry.timeIntervalSince(now) <= 300 else {
                    throw ProductAccessCheckError.invalidResponse
                }
                lifetime = expiry.timeIntervalSince(now)
            } else {
                guard value["access_expires_at"] is NSNull else { throw ProductAccessCheckError.invalidResponse }
                lifetime = 0
            }
            return .init(userID: subject, sessionID: session, state: state, validForSeconds: lifetime)
        } catch { throw ProductAccessCheckError.invalidResponse }
    }

    private static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}

private final class ProductAccessHTTPClient: @unchecked Sendable {
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil; configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 5; configuration.timeoutIntervalForResource = 6
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration, delegate: PetAccountRedirectRejector(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw ProductAccessCheckError.invalidResponse }
        // A received denial is definitive even if its optional error body is truncated.
        if [401, 403].contains(response.statusCode) { throw ProductAccessCheckError.rejected }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 16_384 else { throw ProductAccessCheckError.invalidResponse }
            data.append(byte)
        }
        return (data, response)
    }
}
