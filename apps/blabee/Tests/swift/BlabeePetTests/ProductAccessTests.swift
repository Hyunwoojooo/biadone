import Foundation
import Testing
@testable import BlabeeCoordinator
@testable import CoordinatorSwift

private let accessUser = "11111111-1111-4111-8111-111111111111"
private let accessOtherUser = "22222222-2222-4222-8222-222222222222"
private let accessSession = "33333333-3333-4333-8333-333333333333"

private final class AccessClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 1_000_000_000
    func nowNanoseconds() -> UInt64 { lock.withLock { value } }
    func set(_ seconds: UInt64) { lock.withLock { value = seconds * 1_000_000_000 } }
}

private actor AccessChecker: ProductAccessChecking {
    private var requests: [CheckedContinuation<ProductAccessGrant, any Error>] = []
    func check(accessToken: String, userID: String) async throws -> ProductAccessGrant {
        try await withCheckedThrowingContinuation { requests.append($0) }
    }
    var count: Int { requests.count }
    func answer(_ result: Result<ProductAccessGrant, any Error>) { requests.removeFirst().resume(with: result) }
}

private func accessGrant(_ state: ProductAccessState = .active, user: String = accessUser,
                         duration: Double = 300) -> ProductAccessGrant {
    .init(userID: user, sessionID: accessSession, state: state,
          validForSeconds: state == .active ? duration : 0)
}

private func accessEventually(_ check: () async -> Bool) async throws {
    for _ in 0..<2_000 {
        if await check() { return }
        try await Task.sleep(for: .milliseconds(1))
    }
    Issue.record("Access fixture did not settle")
    throw CoordinatorError("access_test_timeout")
}

@Suite("Product access service authority")
struct ProductAccessTests {
    @Test("No login denies; verified grant expires after continuous time including sleep")
    func grantExpiry() async throws {
        let checker = AccessChecker(), clock = AccessClock()
        let access = ProductAccessController(checker: checker, clock: clock, automaticRefresh: false)
        defer { access.stop() }
        #expect(throws: (any Error).self) { try access.requireAccess() }
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-A", revision: 1)
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.success(accessGrant()))
        try await accessEventually { access.snapshot().state == .active }
        let epoch = try access.authorize()
        clock.set(300)
        #expect(access.snapshot().remainingSeconds == 1)
        #expect(try access.authorize() == epoch)
        clock.set(301)
        #expect(access.snapshot().state == .expired)
        #expect(throws: (any Error).self) { try access.requireAccess() }
    }

    @Test("Late success after logout or another user never restores access")
    func staleReply() async throws {
        let checker = AccessChecker()
        let access = ProductAccessController(checker: checker, automaticRefresh: false)
        defer { access.stop() }
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-A", revision: 1)
        try await accessEventually { await checker.count == 1 }
        _ = try access.clear(revision: 2)
        await checker.answer(.success(accessGrant()))
        #expect(access.snapshot().state == .signedOut)
        _ = try access.update(userID: accessOtherUser, accessToken: "fixture-token-B", revision: 3)
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.success(accessGrant(user: accessOtherUser)))
        try await accessEventually { access.snapshot().state == .active }
        #expect(access.snapshot().userID == accessOtherUser)
        #expect(throws: (any Error).self) {
            try access.update(userID: accessUser, accessToken: "fixture-token-A", revision: 1)
        }
        #expect(access.snapshot().userID == accessOtherUser)
    }

    @Test("Duplicate updates and concurrent retries cannot renew permission or multiply requests")
    func coalescedRequests() async throws {
        let checker = AccessChecker(), clock = AccessClock()
        let access = ProductAccessController(checker: checker, clock: clock, automaticRefresh: false)
        defer { access.stop() }
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-A", revision: 1)
        for _ in 0..<100 { access.refresh() }
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.success(accessGrant()))
        try await accessEventually { access.snapshot().state == .active }
        clock.set(290)
        for index in 2...100 {
            _ = try access.update(userID: accessUser, accessToken: "fixture-token-A", revision: Int64(index))
        }
        #expect(access.snapshot().remainingSeconds == 11)
        #expect(await checker.count == 0)
        clock.set(301)
        #expect(access.snapshot().state == .expired)
    }

    @Test("Temporary failure does not extend permission; explicit deny survives refresh failure")
    func offlineAndDeny() async throws {
        let checker = AccessChecker(), clock = AccessClock()
        let access = ProductAccessController(checker: checker, clock: clock, automaticRefresh: false)
        defer { access.stop() }
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-A", revision: 1)
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.success(accessGrant()))
        try await accessEventually { access.snapshot().state == .active }
        let firstEpoch = try access.authorize()
        clock.set(61); access.refresh()
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.failure(ProductAccessCheckError.unavailable))
        clock.set(301)
        #expect(access.snapshot().state == .expired)
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-B", revision: 2)
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.success(accessGrant(.suspended)))
        try await accessEventually { access.snapshot().state == .suspended }
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-C", revision: 3)
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.failure(ProductAccessCheckError.unavailable))
        #expect(access.snapshot().state == .suspended)
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-D", revision: 4)
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.success(accessGrant()))
        try await accessEventually { access.snapshot().state == .active }
        #expect(try access.authorize() != firstEpoch)
    }

    @Test("Late renewal after unseen expiry changes action authority; regressed clock closes it")
    func renewalAfterExpiry() async throws {
        let checker = AccessChecker(), clock = AccessClock()
        let access = ProductAccessController(checker: checker, clock: clock, automaticRefresh: false)
        defer { access.stop() }
        _ = try access.update(userID: accessUser, accessToken: "fixture-token-A", revision: 1)
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.success(accessGrant()))
        try await accessEventually { access.snapshot().state == .active }
        let epoch = try access.authorize()
        clock.set(299); access.refresh()
        try await accessEventually { await checker.count == 1 }
        clock.set(302)
        await checker.answer(.success(accessGrant()))
        try await accessEventually { access.snapshot().remainingSeconds > 290 }
        #expect(try access.authorize() != epoch)
        clock.set(1)
        #expect(access.snapshot().state == .expired)
    }

    @Test("Only owner capability can update; response and error corpus do not leak credentials")
    func ownedIPC() async throws {
        let checker = AccessChecker()
        let access = ProductAccessController(checker: checker, automaticRefresh: false)
        defer { access.stop() }
        let owner = String(repeating: "a", count: 64)
        let service = try ProductAccessService(credential: owner, controller: access)
        var request: [String: Any] = ["schema_version": 1, "request_id": UUID().uuidString.lowercased(),
            "auth_token": String(repeating: "b", count: 64), "operation": "update", "revision": 1,
            "payload": ["user_id": accessUser, "access_token": "fixture-secret-token"]]
        #expect(throws: (any Error).self) { try service.handle(JSONSerialization.data(withJSONObject: request)) }
        #expect(access.snapshot().state == .signedOut)
        request["auth_token"] = owner
        let result = try service.handle(JSONSerialization.data(withJSONObject: request))
        #expect(!String(decoding: result, as: UTF8.self).contains("fixture-secret-token"))
        #expect(!String(decoding: result, as: UTF8.self).contains(owner))
        let corpus = RuntimeSecretCorpus()
        corpus.registerKnownSecrets(inJSONObject: request)
        #expect(throws: (any Error).self) { try corpus.assertNoKnownSecret(in: Data("fixture-secret-token".utf8)) }
        try await accessEventually { await checker.count == 1 }
        await checker.answer(.failure(ProductAccessCheckError.rejected))
        try await accessEventually { access.snapshot().state == .signedOut }
    }

    @Test("RPC binds user and nonce, caps lease, and treats HTTP 403 as definitive denial",
          arguments: ["ok", "nonce", "user", "lease", "403", "503"])
    func rpcValidation(_ variant: String) async throws {
        let checker = SupabaseProductAccessChecker(transport: { request in
            let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: String]
            #expect(request.url?.path == "/rest/v1/rpc/get_blabee_access")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token")
            let response: [String: Any] = ["schema_version": 1,
                "request_nonce": variant == "nonce" ? UUID().uuidString.lowercased() : body["p_nonce"]!,
                "user_id": variant == "user" ? accessOtherUser : accessUser, "session_id": accessSession,
                "status": "active", "server_now": "2026-09-27T00:00:00Z",
                "access_expires_at": variant == "lease" ? "2026-09-27T00:05:01Z" : "2026-09-27T00:05:00Z",
                "refresh_after_seconds": 60]
            return (try JSONSerialization.data(withJSONObject: response),
                    HTTPURLResponse(url: request.url!, statusCode: Int(variant) ?? 200,
                                    httpVersion: nil, headerFields: nil)!)
        })
        do {
            let grant = try await checker.check(accessToken: "fixture-token", userID: accessUser)
            #expect(variant == "ok")
            #expect(grant.validForSeconds == 300)
        } catch let error as ProductAccessCheckError {
            switch (variant, error) {
            case ("403", .rejected), ("503", .unavailable),
                 ("nonce", .invalidResponse), ("user", .invalidResponse), ("lease", .invalidResponse): break
            default: Issue.record("Unexpected RPC error")
            }
        }
    }
}
