import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Native account PKCE and Supabase transport")
@MainActor
struct PetAccountAuthTests {
    private let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    private let currentDate = Date(timeIntervalSince1970: 1_800_000_000)
    private let userID = "12345678-1234-4234-8234-123456789012"

    @Test("S256 follows the RFC 7636 challenge vector and generates fresh URL-safe verifiers")
    func pkce() throws {
        #expect(PetAccountPKCE.challenge(for: verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let values = try (0..<32).map { _ in try PetAccountPKCE.makeVerifier() }
        #expect(Set(values).count == values.count)
        for value in values {
            #expect(value.utf8.count == 43)
            #expect(value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
        }
    }

    @Test("Both providers use the fixed native callback and S256 without URL credentials", arguments: PetAccountProvider.allCases)
    func authorizationURL(_ provider: PetAccountProvider) throws {
        let config = PetAccountConfiguration.current
        let url = try config.authorizationURL(provider: provider, verifier: verifier)
        let parts = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(parts.scheme == "https")
        #expect(parts.host == config.supabaseURL.host)
        #expect(parts.path == "/auth/v1/authorize")
        #expect(parts.queryItems?.count == 4)
        #expect(parts.queryItems?.first { $0.name == "provider" }?.value == provider.rawValue)
        #expect(parts.queryItems?.first { $0.name == "redirect_to" }?.value == "com.biadone.blabee://auth/callback")
        #expect(parts.queryItems?.first { $0.name == "code_challenge_method" }?.value == "s256")
        #expect(!url.absoluteString.contains(verifier))
        #expect(!url.absoluteString.contains(config.publishableKey))
    }

    @Test("Invalid verifiers fail before opening a browser", arguments: ["", "short", String(repeating: "x", count: 129), String(repeating: " ", count: 43)])
    func invalidVerifier(_ value: String) {
        #expect(throws: PetAccountAuthError.invalidCallback) {
            try PetAccountConfiguration.current.authorizationURL(provider: .google, verifier: value)
        }
    }

    @Test("Only a code on the exact native callback is accepted")
    func acceptsCode() throws {
        let url = try #require(URL(string: "com.biadone.blabee://auth/callback?code=auth-code_123"))
        #expect(try PetAccountConfiguration.current.authorizationCode(from: url) == "auth-code_123")
    }

    @Test("Callback rejects alternate origins, paths, credentials, implicit tokens and ambiguous parameters", arguments: [
        "https://auth/callback?code=abc", "com.biadone.blabee://other/callback?code=abc",
        "com.biadone.blabee://auth.evil/callback?code=abc", "com.biadone.blabee://auth/callback/?code=abc",
        "com.biadone.blabee://user@auth/callback?code=abc", "com.biadone.blabee://auth:123/callback?code=abc",
        "com.biadone.blabee://auth/%63allback?code=abc", "com.biadone.blabee://auth/callback?code=abc#fragment",
        "com.biadone.blabee://auth/callback?code=abc&code=def", "com.biadone.blabee://auth/callback?code=",
        "com.biadone.blabee://auth/callback?code", "com.biadone.blabee://auth/callback",
        "com.biadone.blabee://auth/callback?code=a%20b", "com.biadone.blabee://auth/callback?code=a%0Ab",
        "com.biadone.blabee://auth/callback?code=abc&access_token=token", "com.biadone.blabee://auth/callback#access_token=token",
        "com.biadone.blabee://auth/callback?code=abc&refresh_token=token", "com.biadone.blabee://auth/callback?code=abc&error=access_denied",
        "com.biadone.blabee://auth/callback?code=abc&next=https://evil.example",
        "com.biadone.blabee://auth/callback#code=abc", "com.biadone.blabee://auth/callback#error=access_denied&access_token=token",
        "com.biadone.blabee://auth/callback?code=abc#error=access_denied", "com.biadone.blabee://auth/callback#error=access_denied&error=other",
    ])
    func rejectsCallback(_ value: String) throws {
        #expect(throws: PetAccountAuthError.invalidCallback) {
            try PetAccountConfiguration.current.authorizationCode(from: #require(URL(string: value)))
        }
    }

    @Test("Provider callback failures become typed errors without returning provider messages")
    func callbackErrors() throws {
        let config = PetAccountConfiguration.current
        #expect(throws: PetAccountAuthError.cancelled) {
            try config.authorizationCode(from: #require(URL(string: "com.biadone.blabee://auth/callback?error=access_denied&error_description=private-details")))
        }
        #expect(throws: PetAccountAuthError.providerUnavailable) {
            try config.authorizationCode(from: #require(URL(string: "com.biadone.blabee://auth/callback?error=access_denied&error_code=provider_disabled")))
        }
        #expect(throws: PetAccountAuthError.cancelled) {
            try config.authorizationCode(from: #require(URL(string: "com.biadone.blabee://auth/callback#error=access_denied&error_description=private-details")))
        }
        #expect(throws: PetAccountAuthError.providerUnavailable) {
            try config.authorizationCode(from: #require(URL(string: "com.biadone.blabee://auth/callback#error=server_error&error_code=provider_disabled")))
        }
    }

    @Test("Exchange sends the PKCE contract once and discards provider tokens")
    func exchange() async throws {
        var requests: [URLRequest] = []
        let service = PetSupabaseAccountService(transport: { request in
            requests.append(request)
            return try response(request, body: tokenPayload())
        }, now: { currentDate })
        let session = try await service.exchange(code: "auth-code", verifier: verifier)
        let request = try #require(requests.first)
        #expect(requests.count == 1)
        #expect(request.url?.path == "/auth/v1/token")
        #expect(request.url?.query == "grant_type=pkce")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "apikey") == PetAccountConfiguration.current.publishableKey)
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
        #expect(request.timeoutInterval == 20)
        #expect(!request.httpShouldHandleCookies)
        let body = try JSONDecoder().decode([String: String].self, from: #require(request.httpBody))
        #expect(body == ["auth_code": "auth-code", "code_verifier": verifier])
        #expect(session.user == PetAccountUser(id: userID, email: "user@example.com"))
        #expect(session.expiresAt == currentDate.addingTimeInterval(3_600))
        let encoded = String(decoding: try JSONEncoder().encode(session), as: UTF8.self)
        #expect(!encoded.contains("provider-token-should-not-persist"))
    }

    @Test("Refresh rotates both tokens and keeps the same user")
    func refresh() async throws {
        var requests: [URLRequest] = []
        let service = PetSupabaseAccountService(transport: { request in
            requests.append(request)
            var payload = tokenPayload()
            payload["access_token"] = "renewed-access"
            payload["refresh_token"] = "renewed-refresh"
            return try response(request, body: payload)
        }, now: { currentDate })
        let renewed = try await service.refresh(sessionFixture())
        let request = try #require(requests.first)
        let body = try JSONDecoder().decode([String: String].self, from: #require(request.httpBody))
        #expect(request.url?.query == "grant_type=refresh_token")
        #expect(body == ["refresh_token": "original-refresh"])
        #expect(renewed.accessToken == "renewed-access")
        #expect(renewed.refreshToken == "renewed-refresh")
    }

    @Test("Refresh never silently changes the signed-in user")
    func refreshUserMismatch() async {
        let service = PetSupabaseAccountService(transport: { request in
            var payload = tokenPayload()
            payload["user"] = ["id": "99999999-1234-4234-8234-123456789012"]
            return try response(request, body: payload)
        }, now: { currentDate })
        await #expect(throws: PetAccountAuthError.invalidResponse) { try await service.refresh(sessionFixture()) }
    }

    @Test("User verification uses the bearer token without putting it in the URL")
    func verifiesUser() async throws {
        let service = PetSupabaseAccountService(transport: { request in
            #expect(request.httpMethod == "GET")
            #expect(request.url?.path == "/auth/v1/user")
            #expect(request.url?.query == nil)
            #expect(request.httpBody == nil)
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer original-access")
            return try response(request, body: ["id": userID])
        })
        #expect(try await service.user(accessToken: "original-access") == PetAccountUser(id: userID, email: nil))
    }

    @Test("Local sign-out accepts an already absent session", arguments: [204, 401, 403, 404])
    func signOut(_ status: Int) async throws {
        let service = PetSupabaseAccountService(transport: { request in
            #expect(request.httpMethod == "POST")
            #expect(request.url?.path == "/auth/v1/logout")
            #expect(request.url?.query == "scope=local")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer original-access")
            return try response(request, status: status, body: [:])
        })
        try await service.signOut(accessToken: "original-access")
    }

    @Test("Malformed token responses fail closed", arguments: [
        "access-empty", "refresh-empty", "token-whitespace", "bad-user", "bad-email", "expiry-zero", "expiry-negative",
        "expiry-far-future", "expiry-missing", "expiry-inconsistent", "wrong-token-type",
    ])
    func invalidSession(_ mutation: String) async {
        let service = PetSupabaseAccountService(transport: { request in
            var payload = tokenPayload()
            switch mutation {
            case "access-empty": payload["access_token"] = ""
            case "refresh-empty": payload["refresh_token"] = ""
            case "token-whitespace": payload["access_token"] = "a\nb"
            case "bad-user": payload["user"] = ["id": "not-a-uuid"]
            case "bad-email": payload["user"] = ["id": userID, "email": "private\ntext"]
            case "expiry-zero": payload["expires_in"] = 0
            case "expiry-negative": payload["expires_in"] = -1
            case "expiry-far-future": payload["expires_in"] = 100_000_000
            case "expiry-missing": payload.removeValue(forKey: "expires_in")
            case "expiry-inconsistent": payload["expires_at"] = currentDate.timeIntervalSince1970 + 20
            default: payload["token_type"] = "unexpected"
            }
            return try response(request, body: payload)
        }, now: { currentDate })
        await #expect(throws: PetAccountAuthError.invalidResponse) {
            try await service.exchange(code: "auth-code", verifier: verifier)
        }
    }

    @Test("Only explicit invalid-session codes invalidate stored authentication", arguments: [
        AccountHTTPFailure(status: 400, code: "refresh_token_not_found", expected: .unauthorized),
        AccountHTTPFailure(status: 400, code: "refresh_token_already_used", expected: .unauthorized),
        AccountHTTPFailure(status: 401, code: "session_expired", expected: .unauthorized),
        AccountHTTPFailure(status: 403, code: "session_not_found", expected: .unauthorized),
        AccountHTTPFailure(status: 401, code: "bad_jwt", expected: .unauthorized),
        AccountHTTPFailure(status: 403, code: "user_banned", expected: .unauthorized),
        AccountHTTPFailure(status: 401, code: "invalid_api_key", expected: .invalidResponse),
        AccountHTTPFailure(status: 403, code: "insufficient_aal", expected: .invalidResponse),
        AccountHTTPFailure(status: 400, code: "flow_state_expired", expected: .invalidCallback),
        AccountHTTPFailure(status: 400, code: "provider_disabled", expected: .providerUnavailable),
        AccountHTTPFailure(status: 429, code: "session_not_found", expected: .rateLimited),
        AccountHTTPFailure(status: 503, code: "session_not_found", expected: .serviceUnavailable),
        AccountHTTPFailure(status: 307, code: "", expected: .invalidResponse),
    ])
    func responseErrors(_ failure: AccountHTTPFailure) async {
        let service = PetSupabaseAccountService(transport: { request in
            try response(request, status: failure.status, body: ["code": failure.status, "error_code": failure.code, "message": "private provider detail"])
        })
        await #expect(throws: failure.expected) { try await service.user(accessToken: "original-access") }
    }

    @Test("Network loss and cancellation are distinct and never leak arbitrary transport errors")
    func networkErrors() async {
        let unavailable = PetSupabaseAccountService(transport: { _ in throw URLError(.notConnectedToInternet) })
        await #expect(throws: PetAccountAuthError.serviceUnavailable) { try await unavailable.user(accessToken: "token") }
        let cancelled = PetSupabaseAccountService(transport: { _ in throw URLError(.cancelled) })
        await #expect(throws: PetAccountAuthError.cancelled) { try await cancelled.user(accessToken: "token") }
    }

    @Test("A transport response from a different endpoint is rejected")
    func rejectsRedirectedResponse() async {
        let service = PetSupabaseAccountService(transport: { _ in
            let url = URL(string: "https://other.example/auth/v1/user")!
            return (try JSONSerialization.data(withJSONObject: ["id": userID]), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        await #expect(throws: PetAccountAuthError.invalidResponse) { try await service.user(accessToken: "token") }
    }

    @Test("Production transport has no persistent caches, cookies or credentials and refuses redirects")
    func transportPolicy() async throws {
        let configuration = PetAccountHTTPClient.configuration()
        #expect(configuration.urlCache == nil)
        #expect(configuration.httpCookieStorage == nil)
        #expect(configuration.urlCredentialStorage == nil)
        #expect(!configuration.httpShouldSetCookies)
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let url = try #require(URL(string: "https://other.example/token"))
        let request = URLRequest(url: url)
        let task = session.dataTask(with: request) // Never resumed: this test does not access the network.
        let response = try #require(HTTPURLResponse(url: url, statusCode: 307, httpVersion: nil, headerFields: nil))
        let rejected = await withCheckedContinuation { continuation in
            PetAccountRedirectRejector().urlSession(session, task: task, willPerformHTTPRedirection: response, newRequest: request) {
                continuation.resume(returning: $0 == nil)
            }
        }
        #expect(rejected)
    }

    private func tokenPayload() -> [String: Any] {
        ["access_token": "original-access", "refresh_token": "original-refresh", "expires_in": 3_600,
         "token_type": "bearer", "user": ["id": userID, "email": "user@example.com"],
         "provider_token": "provider-token-should-not-persist", "provider_refresh_token": "provider-token-should-not-persist"]
    }

    private func response(_ request: URLRequest, status: Int = 200, body: [String: Any]) throws -> (Data, HTTPURLResponse) {
        let url = try #require(request.url)
        let response = try #require(HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil))
        return (try JSONSerialization.data(withJSONObject: body), response)
    }

    private func sessionFixture() -> PetAccountSession {
        PetAccountSession(accessToken: "original-access", refreshToken: "original-refresh", expiresAt: currentDate.addingTimeInterval(-60),
                          user: PetAccountUser(id: userID, email: "user@example.com"))
    }
}

struct AccountHTTPFailure: Sendable {
    let status: Int
    let code: String
    let expected: PetAccountAuthError
}
