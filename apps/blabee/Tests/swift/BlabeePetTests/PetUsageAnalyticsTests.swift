import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Optional usage analytics")
@MainActor
struct PetUsageAnalyticsTests {
    @Test("Collection defaults off and requires explicit opt-in plus a verified unexpired account")
    func defaultOffAndAuthentication() async {
        let fixture = UsageFixture(enabled: false)
        defer { fixture.recorder.stop() }
        fixture.recorder.record(.choiceAccepted)
        #expect(!fixture.recorder.isEnabled)
        #expect(fixture.store.events.isEmpty)
        #expect(fixture.service.calls.isEmpty)

        fixture.state.auth = nil
        fixture.recorder.setEnabled(true)
        fixture.recorder.record(.choiceAccepted)
        fixture.state.auth = UsageValues.authorization(expiresAt: UsageValues.now)
        fixture.recorder.record(.approvalResolved)
        #expect(fixture.store.events.isEmpty)
        #expect(fixture.state.preferences == [true])
        fixture.state.auth = UsageValues.authorization()
        let gate = UsageGate()
        fixture.service.gates = [gate]
        fixture.recorder.record(.suggestionDismissed)
        await gate.waitUntilEntered()
        #expect(fixture.store.events.map(\.kind) == [.suggestionDismissed])
        gate.release()
        await settle { fixture.store.events.isEmpty }
    }

    @Test("Retries reuse the event ID, serialize sends, and cap the backoff")
    func retryIdentityAndBackoff() async {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        fixture.service.results = Array(repeating: .retry, count: 6) + [.accepted]
        fixture.recorder.record(.choiceAccepted)
        await settle { fixture.service.calls.count == 7 && fixture.store.events.isEmpty }
        #expect(fixture.state.delays == [30, 60, 120, 240, 300, 300])
        #expect(Set(fixture.service.calls.map { $0.event.eventID }).count == 1)
        #expect(fixture.service.maximumConcurrentCalls == 1)
        #expect(fixture.recorder.isEnabled)
    }

    @Test("The next attempt obtains the current token without persisting it")
    func retryUsesRenewedAuthorization() async {
        let pause = UsageGate()
        let fixture = UsageFixture(sleepGate: pause)
        defer { fixture.recorder.stop() }
        fixture.service.results = [.retry, .accepted]
        fixture.recorder.record(.choiceAccepted)
        await pause.waitUntilEntered()
        let originalID = fixture.store.events.first?.eventID
        fixture.state.auth = UsageValues.authorization(token: "renewed-private-token")
        fixture.recorder.accountStateChanged()
        pause.release()
        await settle { fixture.service.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls.map(\.authorization.accessToken) == ["private-token", "renewed-private-token"])
        #expect(fixture.service.calls.allSatisfy { $0.event.eventID == originalID })
        let json = String(decoding: (try? JSONEncoder().encode(fixture.store.saved)) ?? Data(), as: UTF8.self)
        #expect(!json.contains("private-token"))
        #expect(!json.contains("accessToken"))
    }

    @Test("Authorization rejection waits for account recovery instead of retrying on new actions")
    func rejectedAuthorizationWaitsForRecovery() async {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        fixture.service.results = [.waitForAuthorization, .accepted, .accepted]
        fixture.recorder.record(.choiceAccepted)
        await settle { fixture.service.calls.count == 1 }
        await drainTasks()
        fixture.recorder.record(.approvalResolved)
        await drainTasks()
        #expect(fixture.service.calls.count == 1)
        #expect(fixture.state.delays.isEmpty)
        #expect(fixture.store.events.count == 2)
        fixture.state.auth = UsageValues.authorization(token: "reverified-token")
        fixture.recorder.accountStateChanged()
        await settle { fixture.service.calls.count == 3 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls[1].authorization.accessToken == "reverified-token")
    }

    @Test("Changing users fences an old completion and never overlaps the old network attempt")
    func changingUserFencesInFlightAttempt() async {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        let first = UsageGate()
        fixture.service.gates = [first, nil]
        fixture.recorder.record(.choiceAccepted)
        await first.waitUntilEntered()

        fixture.state.auth = UsageValues.authorization(user: UsageValues.otherUser, token: "other-token")
        fixture.recorder.accountStateChanged()
        fixture.recorder.record(.approvalResolved)
        await drainTasks()
        #expect(fixture.service.calls.count == 1)
        #expect(fixture.store.events.map(\.userID) == [UsageValues.otherUser])

        first.release()
        await settle { fixture.service.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls.map(\.event.userID) == [UsageValues.user, UsageValues.otherUser])
        #expect(fixture.service.calls.map(\.authorization.userID) == [UsageValues.user, UsageValues.otherUser])
        #expect(fixture.service.maximumConcurrentCalls == 1)
    }

    @Test("Disable and logout clear pending events and fence late responses", arguments: [true, false])
    func clearFencesInFlightAttempt(disable: Bool) async {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        let gate = UsageGate()
        fixture.service.gates = [gate]
        fixture.recorder.record(.choiceAccepted)
        await gate.waitUntilEntered()
        if disable { fixture.recorder.setEnabled(false) }
        else {
            fixture.state.auth = nil
            fixture.recorder.clearIdentity()
        }
        #expect(fixture.store.events.isEmpty)
        fixture.recorder.record(.approvalResolved)
        gate.release()
        await drainTasks()
        #expect(fixture.store.events.isEmpty)
        #expect(fixture.service.calls.count == 1)
        #expect(fixture.state.delays.isEmpty)
    }

    @Test("Temporary verification pauses delivery but preserves an event for the same recovered account")
    func temporaryUnavailabilityPreservesPendingEvent() async {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        let gate = UsageGate()
        fixture.service.gates = [gate, nil]
        fixture.recorder.record(.choiceAccepted)
        await gate.waitUntilEntered()
        fixture.state.auth = nil
        fixture.recorder.accountStateChanged()
        gate.release()
        await drainTasks()
        #expect(fixture.store.events.count == 1)
        #expect(fixture.service.calls.count == 1)
        fixture.state.auth = UsageValues.authorization()
        fixture.recorder.accountStateChanged()
        await settle { fixture.service.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls[0].event == fixture.service.calls[1].event)
    }

    @Test("Stop fences late delivery and preserves the bounded outbox for the next launch")
    func stoppingRetainsPendingEvents() async {
        let fixture = UsageFixture()
        let gate = UsageGate()
        fixture.service.gates = [gate]
        fixture.recorder.record(.choiceAccepted)
        await gate.waitUntilEntered()
        fixture.recorder.stop()
        gate.release()
        await drainTasks()
        fixture.recorder.record(.approvalResolved)
        #expect(fixture.store.events.count == 1)
        #expect(fixture.service.calls.count == 1)
    }

    @Test("The queue retains at most 256 recent events and expires them after seven days")
    func boundedQueueAndExpiry() async {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        for _ in 0..<300 { fixture.recorder.record(.choiceAccepted) }
        #expect(fixture.store.events.count == 256)
        fixture.state.auth = nil
        fixture.state.now = UsageValues.now.addingTimeInterval(PetUsageAnalytics.maximumEventAge + 1)
        fixture.recorder.accountStateChanged()
        #expect(fixture.store.events.isEmpty)
        await drainTasks()
        #expect(fixture.service.calls.isEmpty)
    }

    @Test("Restored pending events are deduplicated and never assigned to a different account")
    func restorationDropsForeignOldAndDuplicateEvents() async {
        let fresh = UsageValues.event()
        let fixture = UsageFixture(stored: [
            fresh, fresh,
            UsageValues.event(user: UsageValues.otherUser),
            UsageValues.event(date: UsageValues.now.addingTimeInterval(-8 * 24 * 60 * 60)),
            UsageValues.event(user: "invalid"),
        ])
        defer { fixture.recorder.stop() }
        await settle { fixture.service.calls.count == 1 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls[0].event == fresh)
    }

    @Test("Broken analytics storage or transport never escapes the recorder API")
    func errorsRemainBestEffort() async {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        fixture.store.failWrites = true
        fixture.service.failuresRemaining = 1
        fixture.recorder.record(.approvalResolved)
        await settle { fixture.service.calls.count == 2 }
        #expect(fixture.state.delays == [30])
        #expect(fixture.recorder.isEnabled)
        fixture.recorder.setEnabled(false)
        #expect(!fixture.recorder.isEnabled)
    }

    @Test("Pending product actions cannot survive consent or same-user logout boundaries", arguments: [true, false])
    func contextFencesConsentAndRelogin(disable: Bool) async throws {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        if disable {
            fixture.recorder.setEnabled(false)
            #expect(fixture.recorder.captureContext() == nil)
            fixture.recorder.setEnabled(true)
        } else {
            fixture.state.auth = nil
            fixture.recorder.clearIdentity()
            #expect(fixture.recorder.captureContext() == nil)
            fixture.state.auth = UsageValues.authorization()
            fixture.recorder.accountStateChanged()
        }
        #expect(fixture.recorder.captureContext() != context)
        fixture.recorder.record(.choiceAccepted, context: context)
        await drainTasks()
        #expect(fixture.service.calls.isEmpty)
        #expect(fixture.store.events.isEmpty)
    }

    @Test("A product action context survives a same-user token refresh")
    func contextSurvivesRefresh() async throws {
        let fixture = UsageFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        fixture.state.auth = nil
        fixture.recorder.accountStateChanged()
        fixture.state.auth = UsageValues.authorization(token: "refreshed")
        fixture.recorder.accountStateChanged()
        #expect(fixture.recorder.captureContext() == context)
        fixture.recorder.record(.choiceAccepted, context: context)
        await settle { fixture.service.calls.count == 1 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls.first?.authorization.accessToken == "refreshed")
    }

    @Test("Failed deletion cannot replay pre-logout or pre-opt-out events after restart", arguments: [true, false])
    func failedClearCannotReviveEvents(disable: Bool) async throws {
        let generations = UsageGenerations()
        let originalGeneration = generations.current
        let oldStore = generations.store(originalGeneration)
        let service = UsageService()
        let recorder = PetUsageAnalytics(isEnabled: true, authorization: { UsageValues.authorization() },
            store: generations.wrapper(), service: service, now: { UsageValues.now })
        recorder.record(.choiceAccepted)
        #expect(oldStore.events.count == 1)
        oldStore.failWrites = true
        if disable {
            recorder.setEnabled(false)
            recorder.setEnabled(true)
        } else { recorder.clearIdentity() }
        recorder.stop()

        let restarted = PetUsageAnalytics(isEnabled: true, authorization: { UsageValues.authorization() },
            store: generations.wrapper(), service: service, now: { UsageValues.now })
        defer { restarted.stop() }
        await drainTasks()
        #expect(generations.current != originalGeneration)
        #expect(oldStore.events.count == 1)
        #expect(try generations.wrapper().load().isEmpty)
        #expect(service.calls.isEmpty)
    }
}

@Suite("Usage RPC transport")
@MainActor
struct PetUsageTransportTests {
    @Test("RPC contains only the event ID, fixed kind, and UTC occurrence timestamp", arguments: [true, false])
    func allowlistedPayloadAndDuplicateAcknowledgment(_ responseValue: Bool) async throws {
        var captured: URLRequest?
        let event = UsageValues.event(date: Date(timeIntervalSince1970: 0.125))
        let service = PetSupabaseUsageService(configuration: UsageValues.configuration, transport: { request in
            captured = request
            return (Data(String(responseValue).utf8), UsageValues.response(request))
        }, now: { UsageValues.now })
        #expect(try await service.send(event, authorization: UsageValues.authorization()) == .accepted)
        let request = try #require(captured)
        #expect(request.url?.absoluteString == "https://usage.example.test/rest/v1/rpc/record_blabee_usage")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer private-token")
        #expect(request.value(forHTTPHeaderField: "apikey") == "test-publishable-key")
        #expect(!request.httpShouldHandleCookies)
        #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
        let body = try #require(request.httpBody)
        let payload = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(Set(payload.keys) == ["p_event_id", "p_event_kind", "p_occurred_at"])
        #expect(payload["p_event_id"] == event.eventID.uuidString.lowercased())
        #expect(payload["p_event_kind"] == "choice_accepted")
        #expect(payload["p_occurred_at"] == "1970-01-01T00:00:00.125Z")
    }

    @Test("HTTP outcomes distinguish rejected authentication, retryable failures, and invalid events", arguments: [
        400, 401, 403, 404, 408, 425, 429, 500, 503, 302,
    ])
    func statusPolicy(_ status: Int) async throws {
        let service = PetSupabaseUsageService(configuration: UsageValues.configuration, transport: { request in
            (Data("arbitrary body must not be logged".utf8), UsageValues.response(request, status: status))
        }, now: { UsageValues.now })
        let result = try await service.send(UsageValues.event(), authorization: UsageValues.authorization())
        if [401, 403].contains(status) { #expect(result == .waitForAuthorization) }
        else if [408, 425, 429, 500, 503].contains(status) { #expect(result == .retry) }
        else { #expect(result == .discard) }
    }

    @Test("Invalid origins cannot receive credentials", arguments: [
        "http://usage.example.test", "https://user@usage.example.test", "https://usage.example.test:443",
        "https://usage.example.test/path", "https://usage.example.test?q=a", "https://usage.example.test#fragment",
    ])
    func invalidOrigins(_ value: String) async throws {
        var sends = 0
        let service = PetSupabaseUsageService(configuration: .init(supabaseURL: URL(string: value)!, publishableKey: "public"),
                                              transport: { request in
            sends += 1
            return (Data("true".utf8), UsageValues.response(request))
        }, now: { UsageValues.now })
        #expect(try await service.send(UsageValues.event(), authorization: UsageValues.authorization()) == .discard)
        #expect(sends == 0)
    }

    @Test("Redirects are refused and an unexpected response origin is never acknowledged")
    func redirectsAreRejected() async throws {
        let session = URLSession(configuration: PetAccountHTTPClient.configuration())
        defer { session.invalidateAndCancel() }
        let original = URLRequest(url: URL(string: "https://usage.example.test")!)
        let other = URLRequest(url: URL(string: "https://other.example.test")!)
        await withCheckedContinuation { continuation in
            PetAccountRedirectRejector().urlSession(session, task: session.dataTask(with: original),
                willPerformHTTPRedirection: UsageValues.response(original, status: 302), newRequest: other) { redirected in
                #expect(redirected == nil)
                continuation.resume()
            }
        }
        let service = PetSupabaseUsageService(configuration: UsageValues.configuration, transport: { _ in
            (Data("true".utf8), UsageValues.response(other))
        }, now: { UsageValues.now })
        #expect(try await service.send(UsageValues.event(), authorization: UsageValues.authorization()) == .discard)
        let configuration = PetAccountHTTPClient.configuration()
        #expect(configuration.urlCache == nil)
        #expect(configuration.httpCookieStorage == nil)
        #expect(configuration.urlCredentialStorage == nil)
    }

    @Test("Cross-user and expired authorization are rejected before sending")
    func rejectsMismatchedIdentityAndExpiredToken() async throws {
        var sends = 0
        let service = PetSupabaseUsageService(configuration: UsageValues.configuration, transport: { request in
            sends += 1
            return (Data("true".utf8), UsageValues.response(request))
        }, now: { UsageValues.now })
        #expect(try await service.send(UsageValues.event(user: UsageValues.otherUser), authorization: UsageValues.authorization()) == .discard)
        #expect(try await service.send(UsageValues.event(), authorization: UsageValues.authorization(expiresAt: UsageValues.now)) == .waitForAuthorization)
        #expect(sends == 0)
    }
}

@Suite("Private usage outbox")
@MainActor
struct PetUsageFileStoreTests {
    @Test("Only bounded event fields persist in a private file and directory")
    func privateRoundTrip() throws {
        let root = try UsageTemporaryDirectory()
        defer { root.remove() }
        let directory = root.url.appendingPathComponent("outbox")
        let store = PetUsageFileStore(directory: directory)
        let event = UsageValues.event()
        try store.save([event])
        #expect(try store.load() == [event])
        let url = directory.appendingPathComponent(PetUsageFileStore.fileName)
        let data = try Data(contentsOf: url)
        let rows = try #require(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let row = try #require(rows.first)
        #expect(Set(row.keys) == ["userID", "eventID", "kind", "occurredAt"])
        #expect(!String(decoding: data, as: UTF8.self).contains("token"))
        #expect(try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int == 0o600)
        #expect(try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? Int == 0o700)
        try store.clear()
        #expect(try store.load().isEmpty)
    }

    @Test("Symlink files and directory components cannot redirect reads or writes")
    func refusesSymlinks() throws {
        let root = try UsageTemporaryDirectory()
        defer { root.remove() }
        let directory = root.url.appendingPathComponent("outbox")
        let store = PetUsageFileStore(directory: directory)
        try store.save([UsageValues.event()])
        let file = directory.appendingPathComponent(PetUsageFileStore.fileName)
        let target = root.url.appendingPathComponent("unrelated.txt")
        let marker = Data("unrelated-file".utf8)
        try marker.write(to: target)
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: target)
        #expect(throws: (any Error).self) { try store.load() }
        #expect(throws: (any Error).self) { try store.save([UsageValues.event()]) }
        try store.clear()
        #expect(try Data(contentsOf: target) == marker)
        let linkedDirectory = root.url.appendingPathComponent("linked")
        try FileManager.default.createSymbolicLink(at: linkedDirectory, withDestinationURL: directory)
        let linkedStore = PetUsageFileStore(directory: linkedDirectory)
        #expect(throws: (any Error).self) { try linkedStore.save([UsageValues.event()]) }
        #expect(throws: (any Error).self) { try linkedStore.load() }
    }

    @Test("Oversized, hard-linked, and publicly readable files are refused")
    func refusesUnsafeFiles() throws {
        let root = try UsageTemporaryDirectory()
        defer { root.remove() }
        let directory = root.url.appendingPathComponent("outbox")
        let store = PetUsageFileStore(directory: directory)
        try store.save([UsageValues.event()])
        let file = directory.appendingPathComponent(PetUsageFileStore.fileName)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
        #expect(throws: (any Error).self) { try store.load() }
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        let linked = root.url.appendingPathComponent("hard-link")
        try FileManager.default.linkItem(at: file, to: linked)
        #expect(throws: (any Error).self) { try store.load() }
        try FileManager.default.removeItem(at: linked)
        try Data(repeating: 32, count: PetUsageFileStore.maximumBytes + 1).write(to: file)
        #expect(throws: (any Error).self) { try store.load() }
        #expect(throws: (any Error).self) { try store.save(Array(repeating: UsageValues.event(), count: 257)) }
    }

    @Test("A read-only outbox directory cannot undo independently persisted invalidation")
    func readOnlyDirectoryDoesNotReviveOldGeneration() throws {
        let root = try UsageTemporaryDirectory()
        defer { root.remove() }
        let directory = root.url.appendingPathComponent("outbox")
        var generation = UUID()
        let original = generation
        let store = PetUsageGenerationStore(generation: generation, saveGeneration: { generation = $0 },
            makeStore: { PetUsageFileStore(directory: directory, generation: $0) })
        try store.save([UsageValues.event()])
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        #expect(throws: (any Error).self) { try store.invalidate() }
        #expect(generation != original)
        let restarted = PetUsageGenerationStore(generation: generation, saveGeneration: { generation = $0 },
            makeStore: { PetUsageFileStore(directory: directory, generation: $0) })
        #expect(try restarted.load().isEmpty)
        #expect(try PetUsageFileStore(directory: directory, generation: original).load().count == 1)
    }
}

private enum UsageValues {
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static let user = "11111111-1111-4111-8111-111111111111"
    static let otherUser = "22222222-2222-4222-8222-222222222222"
    static let configuration = PetAccountConfiguration(supabaseURL: URL(string: "https://usage.example.test")!, publishableKey: "test-publishable-key")
    static func authorization(user: String = user, token: String = "private-token", expiresAt: Date = now.addingTimeInterval(3_600)) -> PetUsageAuthorization {
        .init(userID: user, accessToken: token, expiresAt: expiresAt)
    }
    static func event(user: String = user, date: Date = now) -> PetUsageEvent {
        .init(userID: user, eventID: UUID(), kind: .choiceAccepted, occurredAt: date)
    }
    static func response(_ request: URLRequest, status: Int = 200) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    }
}

@MainActor
private final class UsageFixture {
    let state = UsageState()
    let store = UsageStore()
    let service = UsageService()
    var recorder: PetUsageAnalytics!

    init(enabled: Bool = true, stored: [PetUsageEvent] = [], sleepGate: UsageGate? = nil) {
        store.events = stored
        recorder = PetUsageAnalytics(isEnabled: enabled, authorization: { [state] in state.auth }, store: store, service: service,
            savePreference: { [state] in state.preferences.append($0) }, now: { [state] in state.now }, sleep: { [state] delay in
                state.delays.append(delay)
                if let sleepGate { await sleepGate.suspend() }
            })
    }
}

@MainActor
private final class UsageState {
    var now = UsageValues.now
    var auth: PetUsageAuthorization? = UsageValues.authorization()
    var preferences: [Bool] = []
    var delays: [TimeInterval] = []
}

@MainActor
private final class UsageStore: PetUsageEventStoring {
    var events: [PetUsageEvent] = []
    var saved: [[PetUsageEvent]] = []
    var failWrites = false
    func load() throws -> [PetUsageEvent] { events }
    func save(_ events: [PetUsageEvent]) throws {
        if failWrites { throw URLError(.cannotWriteToFile) }
        self.events = events
        saved.append(events)
    }
    func clear() throws {
        if failWrites { throw URLError(.cannotWriteToFile) }
        events = []
    }
}

@MainActor
private final class UsageGenerations {
    var current = UUID()
    private var stores: [UUID: UsageStore] = [:]
    func store(_ generation: UUID) -> UsageStore {
        if let store = stores[generation] { return store }
        let store = UsageStore()
        stores[generation] = store
        return store
    }
    func wrapper() -> PetUsageGenerationStore {
        PetUsageGenerationStore(generation: current, saveGeneration: { [self] in current = $0 },
                                makeStore: { [self] in store($0) })
    }
}

@MainActor
private final class UsageService: PetUsageSending {
    struct Call { let event: PetUsageEvent; let authorization: PetUsageAuthorization }
    var calls: [Call] = []
    var results: [PetUsageDelivery] = []
    var gates: [UsageGate?] = []
    var failuresRemaining = 0
    private var concurrentCalls = 0
    var maximumConcurrentCalls = 0
    func send(_ event: PetUsageEvent, authorization: PetUsageAuthorization) async throws -> PetUsageDelivery {
        calls.append(.init(event: event, authorization: authorization))
        concurrentCalls += 1
        maximumConcurrentCalls = max(maximumConcurrentCalls, concurrentCalls)
        defer { concurrentCalls -= 1 }
        if !gates.isEmpty, let gate = gates.removeFirst() { await gate.suspend() }
        if failuresRemaining > 0 { failuresRemaining -= 1; throw URLError(.notConnectedToInternet) }
        return results.isEmpty ? .accepted : results.removeFirst()
    }
}

@MainActor
private final class UsageGate {
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
        let waiting = continuation
        continuation = nil
        waiting?.resume()
    }
}

@MainActor
private func settle(_ condition: @MainActor () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
    for _ in 0..<1_000 {
        if condition() { return }
        await Task.yield()
    }
    #expect(condition(), sourceLocation: sourceLocation)
}

@MainActor
private func drainTasks() async {
    for _ in 0..<30 { await Task.yield() }
}

private struct UsageTemporaryDirectory {
    let url: URL
    init() throws {
        // Foundation canonicalizes /private/var back to the /var symlink on this
        // macOS version; use a literal link-free path for the no-follow store.
        url = URL(fileURLWithPath: "/private/tmp", isDirectory: true).appendingPathComponent("blabee-usage-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }
    func remove() { try? FileManager.default.removeItem(at: url) }
}
