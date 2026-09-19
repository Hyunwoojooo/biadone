import CryptoKit
import Foundation
import Security

enum PetAccountProvider: String, CaseIterable, Sendable {
    case google, github

    var displayName: String {
        switch self {
        case .google: "Google"
        case .github: "GitHub"
        }
    }
}

struct PetAccountUser: Codable, Equatable, Sendable {
    let id: String
    let email: String?

    var isValid: Bool {
        UUID(uuidString: id) != nil && (email.map {
            !$0.isEmpty && $0.utf8.count <= 512 && !$0.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
        } ?? true)
    }
}

struct PetAccountSession: Codable, Equatable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let user: PetAccountUser

    // An expired access token is still a valid stored session: its refresh token can renew it.
    var isValid: Bool {
        PetAccountValidation.isToken(accessToken) && PetAccountValidation.isToken(refreshToken)
            && expiresAt.timeIntervalSince1970.isFinite
            && expiresAt.timeIntervalSince1970 > 0 && expiresAt.timeIntervalSince1970 <= 253_402_300_799
            && user.isValid
    }
}

enum PetAccountAuthError: Error, Equatable {
    case invalidCallback, invalidResponse, unauthorized, serviceUnavailable, rateLimited
    case storageUnavailable, cancelled, providerUnavailable
}

@MainActor
protocol PetAccountServicing {
    func exchange(code: String, verifier: String) async throws -> PetAccountSession
    func refresh(_ session: PetAccountSession) async throws -> PetAccountSession
    func user(accessToken: String) async throws -> PetAccountUser
    func signOut(accessToken: String) async throws
}

@MainActor
protocol PetAccountSessionStoring {
    func load() throws -> PetAccountSession?
    func save(_ session: PetAccountSession) throws
    func clear() throws
}

struct PetAccountConfiguration: Sendable {
    // The project URL and publishable key are public client configuration, not server credentials.
    static let current = PetAccountConfiguration(
        supabaseURL: URL(string: "https://vulnkqyqqbucvbhwjswr.supabase.co")!,
        publishableKey: "sb_publishable_SGbGiqBjnIx7ct3EW_RGow_mUpB_y-b"
    )

    let supabaseURL: URL
    let publishableKey: String
    let callbackURL = URL(string: "com.biadone.blabee://auth/callback")!

    func authorizationURL(provider: PetAccountProvider, verifier: String) throws -> URL {
        guard PetAccountValidation.isVerifier(verifier) else { throw PetAccountAuthError.invalidCallback }
        return try endpoint("authorize", query: [
            URLQueryItem(name: "provider", value: provider.rawValue),
            URLQueryItem(name: "redirect_to", value: callbackURL.absoluteString),
            URLQueryItem(name: "code_challenge", value: PetAccountPKCE.challenge(for: verifier)),
            URLQueryItem(name: "code_challenge_method", value: "s256"),
        ])
    }

    func authorizationCode(from url: URL) throws -> String {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == callbackURL.scheme, parts.percentEncodedHost == "auth",
              parts.percentEncodedPath == "/callback", parts.user == nil, parts.password == nil,
              parts.port == nil
        else { throw PetAccountAuthError.invalidCallback }

        // Supabase may return provider errors in a fragment. Tokens and successful
        // codes in a fragment are never accepted; mixed query/fragment callbacks fail.
        let items: [URLQueryItem]
        if let fragment = parts.percentEncodedFragment {
            guard parts.query == nil, !fragment.isEmpty else { throw PetAccountAuthError.invalidCallback }
            var errorParts = URLComponents()
            errorParts.percentEncodedQuery = fragment
            guard let errorItems = errorParts.queryItems,
                  errorItems.contains(where: { $0.name == "error" || $0.name == "error_code" })
            else { throw PetAccountAuthError.invalidCallback }
            items = errorItems
        } else {
            guard let queryItems = parts.queryItems else { throw PetAccountAuthError.invalidCallback }
            items = queryItems
        }
        guard !items.isEmpty,
              Set(items.map(\.name)).count == items.count
        else { throw PetAccountAuthError.invalidCallback }

        if items.contains(where: { $0.name == "error" || $0.name == "error_code" }) {
            guard items.allSatisfy({ ["error", "error_code", "error_description"].contains($0.name) }) else {
                throw PetAccountAuthError.invalidCallback
            }
            let errorCode = items.first(where: { $0.name == "error_code" })?.value
            if errorCode == "provider_disabled" || errorCode == "oauth_provider_not_supported" {
                throw PetAccountAuthError.providerUnavailable
            }
            if items.first(where: { $0.name == "error" })?.value == "access_denied" {
                throw PetAccountAuthError.cancelled
            }
            throw PetAccountAuthError.invalidCallback
        }

        guard items.count == 1, items[0].name == "code", let code = items[0].value,
              PetAccountValidation.isCode(code)
        else { throw PetAccountAuthError.invalidCallback }
        return code
    }

    fileprivate func endpoint(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard var parts = URLComponents(url: supabaseURL, resolvingAgainstBaseURL: false),
              parts.scheme == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              PetAccountValidation.isToken(publishableKey)
        else { throw PetAccountAuthError.invalidResponse }
        parts.path = "/auth/v1/\(path)"
        parts.queryItems = query.isEmpty ? nil : query
        guard let url = parts.url else { throw PetAccountAuthError.invalidResponse }
        return url
    }
}

enum PetAccountPKCE {
    static func makeVerifier() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw PetAccountAuthError.serviceUnavailable
        }
        return base64URL(Data(bytes))
    }

    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

private enum PetAccountValidation {
    static func isToken(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 65_536 && value.utf8.allSatisfy { (33...126).contains($0) }
    }

    static func isCode(_ value: String) -> Bool {
        (1...2_048).contains(value.utf8.count) && isUnreserved(value)
    }

    static func isVerifier(_ value: String) -> Bool {
        (43...128).contains(value.utf8.count) && isUnreserved(value)
    }

    private static func isUnreserved(_ value: String) -> Bool {
        value.utf8.allSatisfy { (65...90).contains($0) || (97...122).contains($0)
            || (48...57).contains($0) || [45, 46, 95, 126].contains($0) }
    }
}

typealias PetAccountHTTPTransport = @MainActor (URLRequest) async throws -> (Data, HTTPURLResponse)

@MainActor
final class PetSupabaseAccountService: PetAccountServicing {
    private let configuration: PetAccountConfiguration
    private let transport: PetAccountHTTPTransport
    private let now: @MainActor () -> Date

    init(
        configuration: PetAccountConfiguration = .current,
        transport: PetAccountHTTPTransport? = nil,
        now: @escaping @MainActor () -> Date = Date.init
    ) {
        self.configuration = configuration
        self.now = now
        if let transport {
            self.transport = transport
        } else {
            let client = PetAccountHTTPClient()
            self.transport = { try await client.send($0) }
        }
    }

    func exchange(code: String, verifier: String) async throws -> PetAccountSession {
        guard PetAccountValidation.isCode(code), PetAccountValidation.isVerifier(verifier) else {
            throw PetAccountAuthError.invalidCallback
        }
        let data = try await request("token", method: "POST", query: [URLQueryItem(name: "grant_type", value: "pkce")],
                                     body: ["auth_code": code, "code_verifier": verifier])
        return try session(from: data)
    }

    func refresh(_ session: PetAccountSession) async throws -> PetAccountSession {
        guard session.isValid else { throw PetAccountAuthError.invalidResponse }
        let data = try await request("token", method: "POST", query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
                                     body: ["refresh_token": session.refreshToken])
        let renewed = try self.session(from: data)
        guard renewed.user.id.caseInsensitiveCompare(session.user.id) == .orderedSame else {
            throw PetAccountAuthError.invalidResponse
        }
        return renewed
    }

    func user(accessToken: String) async throws -> PetAccountUser {
        let data = try await request("user", method: "GET", accessToken: accessToken)
        guard let user = try? JSONDecoder().decode(PetAccountUser.self, from: data), user.isValid else {
            throw PetAccountAuthError.invalidResponse
        }
        return user
    }

    func signOut(accessToken: String) async throws {
        _ = try await request("logout", method: "POST", query: [URLQueryItem(name: "scope", value: "local")],
                              accessToken: accessToken, acceptsMissingSession: true)
    }

    private func request(
        _ path: String, method: String, query: [URLQueryItem] = [], body: [String: String]? = nil,
        accessToken: String? = nil, acceptsMissingSession: Bool = false
    ) async throws -> Data {
        let url = try configuration.endpoint(path, query: query)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken {
            guard PetAccountValidation.isToken(accessToken) else { throw PetAccountAuthError.invalidResponse }
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if let body { request.httpBody = try JSONEncoder().encode(body) }

        let data: Data
        let response: HTTPURLResponse
        do {
            try Task.checkCancellation()
            (data, response) = try await transport(request)
            try Task.checkCancellation()
        } catch is CancellationError {
            throw PetAccountAuthError.cancelled
        } catch let error as URLError where error.code == .cancelled {
            throw PetAccountAuthError.cancelled
        } catch {
            throw PetAccountAuthError.serviceUnavailable
        }
        guard response.url == url, data.count <= 1_048_576 else { throw PetAccountAuthError.invalidResponse }
        if acceptsMissingSession && [401, 403, 404].contains(response.statusCode) { return Data() }
        guard (200..<300).contains(response.statusCode) else {
            throw Self.responseError(status: response.statusCode, data: data)
        }
        return data
    }

    private func session(from data: Data) throws -> PetAccountSession {
        guard let payload = try? JSONDecoder().decode(TokenResponse.self, from: data) else {
            throw PetAccountAuthError.invalidResponse
        }
        let currentTime = now().timeIntervalSince1970
        let maximumLifetime: TimeInterval = 31 * 24 * 60 * 60
        if let lifetime = payload.expiresIn {
            guard lifetime.isFinite, lifetime.rounded(.down) == lifetime,
                  lifetime > 0, lifetime <= maximumLifetime else { throw PetAccountAuthError.invalidResponse }
        }
        guard let expiry = payload.expiresAt ?? payload.expiresIn.map({ currentTime + $0 }),
              expiry.isFinite, expiry > currentTime, expiry <= currentTime + maximumLifetime,
              payload.tokenType?.lowercased() == "bearer"
        else { throw PetAccountAuthError.invalidResponse }
        if let absolute = payload.expiresAt, let relative = payload.expiresIn {
            guard abs(absolute - currentTime - relative) <= 300 else { throw PetAccountAuthError.invalidResponse }
        }
        let session = PetAccountSession(accessToken: payload.accessToken, refreshToken: payload.refreshToken,
                                        expiresAt: Date(timeIntervalSince1970: expiry), user: payload.user)
        guard session.isValid else { throw PetAccountAuthError.invalidResponse }
        return session
    }

    private static func responseError(status: Int, data: Data) -> PetAccountAuthError {
        if status == 429 { return .rateLimited }
        if status >= 500 || [408, 409, 425].contains(status) { return .serviceUnavailable }
        // Unknown API/proxy errors must never erase a refreshable local session.
        let code = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.errorCode
        switch code {
        case "refresh_token_not_found", "refresh_token_already_used", "session_expired", "session_not_found", "bad_jwt", "user_not_found", "user_banned":
            return .unauthorized
        case "provider_disabled", "oauth_provider_not_supported":
            return .providerUnavailable
        case "bad_code_verifier", "flow_state_expired", "flow_state_not_found":
            return .invalidCallback
        default:
            return .invalidResponse
        }
    }

    private struct TokenResponse: Decodable {
        let accessToken: String
        let refreshToken: String
        let expiresAt: TimeInterval?
        let expiresIn: TimeInterval?
        let tokenType: String?
        let user: PetAccountUser

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token", refreshToken = "refresh_token"
            case expiresAt = "expires_at", expiresIn = "expires_in", tokenType = "token_type", user
        }
    }

    private struct ErrorResponse: Decodable {
        let errorCode: String?

        enum CodingKeys: String, CodingKey { case code, error_code }

        init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            // Older REST responses also have a numeric HTTP `code`; it must not
            // prevent reading their structured `error_code` or be treated as one.
            errorCode = (try? values.decode(String.self, forKey: .error_code))
                ?? (try? values.decode(String.self, forKey: .code))
        }
    }
}

final class PetAccountRedirectRejector: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        // Neither bearer headers nor code/refresh-token POST bodies may follow a redirect.
        completionHandler(nil)
    }
}

@MainActor
final class PetAccountHTTPClient {
    private let session: URLSession

    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        configuration.waitsForConnectivity = false
        return configuration
    }

    init() {
        session = URLSession(configuration: Self.configuration(), delegate: PetAccountRedirectRejector(), delegateQueue: nil)
    }

    deinit { session.invalidateAndCancel() }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw PetAccountAuthError.invalidResponse }
        return (data, response)
    }
}
