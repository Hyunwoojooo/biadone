import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Optional error diagnostics")
@MainActor
struct PetErrorDiagnosticsTests {
    @Test("Diagnostics are independently off by default and require a verified owner")
    func defaultOffAndVerifiedIdentity() async {
        let fixture = ErrorFixture(enabled: false)
        defer { fixture.recorder.stop() }
        #expect(!fixture.recorder.isEnabled)
        #expect(PetErrorDiagnostics.enabledPreferenceKey != PetUsageAnalytics.enabledPreferenceKey)
        #expect(PetErrorDiagnostics.outboxGenerationPreferenceKey != PetUsageAnalytics.outboxGenerationPreferenceKey)
        #expect(fixture.recorder.captureContext() == nil)
        fixture.recorder.record(code: .accountInvalidResponse)
        #expect(fixture.store.events.isEmpty)

        fixture.state.auth = nil
        fixture.recorder.setEnabled(true)
        #expect(fixture.recorder.captureContext() == nil)
        fixture.recorder.record(code: .accountServiceUnavailable)
        fixture.state.auth = ErrorValues.authorization(expiresAt: ErrorValues.now)
        fixture.recorder.record(code: .accountRateLimited)
        #expect(fixture.store.events.isEmpty)
        fixture.state.auth = ErrorValues.authorization()
        fixture.recorder.accountStateChanged()
        await drainErrorTasks()
        #expect(fixture.service.calls.isEmpty)
        #expect(fixture.state.preferences == [true])
    }

    @Test("A captured refresh failure remains with its owner while auth is temporarily unavailable")
    func capturedErrorPausesUntilRecovery() async throws {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        fixture.state.auth = nil
        fixture.recorder.accountStateChanged()
        fixture.recorder.record(code: .accountRefreshFailed, context: context)
        fixture.recorder.record(code: .accountInvalidResponse)
        await drainErrorTasks()
        #expect(fixture.store.events.map(\.code) == [.accountRefreshFailed])
        #expect(fixture.store.events.first?.userID == ErrorValues.user)
        #expect(fixture.service.calls.isEmpty)

        fixture.state.auth = ErrorValues.authorization(token: "renewed-token")
        fixture.recorder.accountStateChanged()
        await settleErrorTasks { fixture.service.calls.count == 1 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls.first?.authorization.accessToken == "renewed-token")
    }

    @Test("Opt-out, logout, and user changes invalidate pending contexts", arguments: ErrorPrivacyBoundary.allCases)
    func staleContextIsNeverAttributedToLaterLogin(_ boundary: ErrorPrivacyBoundary) async throws {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        switch boundary {
        case .consent:
            fixture.recorder.setEnabled(false)
            fixture.recorder.setEnabled(true)
        case .logout:
            fixture.state.auth = nil
            fixture.recorder.clearIdentity()
            fixture.state.auth = ErrorValues.authorization()
            fixture.recorder.accountStateChanged()
        case .differentUser:
            fixture.state.auth = ErrorValues.authorization(user: ErrorValues.otherUser)
            fixture.recorder.accountStateChanged()
        case .stop:
            fixture.recorder.stop()
        }
        fixture.recorder.record(code: .accountRefreshFailed, context: context)
        await drainErrorTasks()
        #expect(fixture.store.events.isEmpty)
        #expect(fixture.service.calls.isEmpty)
    }

    @Test("A recovered different account drops already queued failures from the prior owner")
    func queuedFailuresDoNotSwitchUsers() async throws {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        fixture.state.auth = nil
        fixture.recorder.accountStateChanged()
        fixture.recorder.record(code: .accountRefreshFailed, context: context)
        #expect(fixture.store.events.count == 1)
        fixture.state.auth = ErrorValues.authorization(user: ErrorValues.otherUser)
        fixture.recorder.accountStateChanged()
        await drainErrorTasks()
        #expect(fixture.store.events.isEmpty)
        #expect(fixture.service.calls.isEmpty)
    }

    @Test("The same code is sampled once per 60 seconds while distinct codes remain separate")
    func suppressesRepeatedCodes() async throws {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        fixture.state.auth = nil
        fixture.recorder.accountStateChanged()
        fixture.recorder.record(code: .appServiceTimeout, context: context)
        fixture.recorder.record(code: .appServiceTimeout, context: context)
        fixture.recorder.record(code: .appServiceExited, context: context)
        fixture.state.now = ErrorValues.now.addingTimeInterval(59)
        fixture.recorder.record(code: .appServiceTimeout, context: context)
        #expect(fixture.store.events.map(\.code) == [.appServiceTimeout, .appServiceExited])
        fixture.state.now = ErrorValues.now.addingTimeInterval(60)
        fixture.recorder.record(code: .appServiceTimeout, context: context)
        #expect(fixture.store.events.count == 3)
        #expect(Set(fixture.store.events.map(\.eventID)).count == 3)
    }

    @Test("A rolling-hour limit admits only 50 new events and resets with the identity")
    func limitsNewEventsPerHour() async throws {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        let context = try #require(fixture.recorder.captureContext())
        fixture.state.auth = nil
        fixture.recorder.accountStateChanged()
        for index in 0..<65 {
            fixture.state.now = ErrorValues.now.addingTimeInterval(Double(index / PetErrorCode.allCases.count) * 61)
            fixture.recorder.record(code: PetErrorCode.allCases[index % PetErrorCode.allCases.count], context: context)
        }
        #expect(fixture.store.events.count == 50)
        fixture.state.now = ErrorValues.now.addingTimeInterval(3_661)
        fixture.recorder.record(code: .appServiceTimeout, context: context)
        #expect(fixture.store.events.count == 51)

        fixture.recorder.clearIdentity()
        fixture.state.auth = ErrorValues.authorization(user: ErrorValues.otherUser,
                                                       expiresAt: fixture.state.now.addingTimeInterval(3_600))
        fixture.recorder.accountStateChanged()
        fixture.recorder.record(code: .appServiceTimeout)
        #expect(fixture.store.events.map(\.userID) == [ErrorValues.otherUser])
    }

    @Test("Suppression is per process, while pending event IDs survive restart")
    func restartSemantics() async throws {
        let fixture = ErrorFixture()
        let gate = ErrorGate()
        fixture.service.gates = [gate]
        fixture.recorder.record(code: .accountRefreshFailed)
        await gate.waitUntilEntered()
        let oldID = try #require(fixture.store.events.first?.eventID)
        fixture.recorder.stop()
        gate.release()
        await drainErrorTasks()

        let restarted = PetErrorDiagnostics(isEnabled: true, authorization: { ErrorValues.authorization() },
            store: fixture.store, service: fixture.service, now: { ErrorValues.now }, environment: ErrorValues.environment)
        defer { restarted.stop() }
        restarted.record(code: .accountRefreshFailed)
        await settleErrorTasks { fixture.service.calls.count == 3 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls[1].event.eventID == oldID)
        #expect(fixture.service.calls[2].event.eventID != oldID)
    }

    @Test("Retries preserve IDs and environment with bounded backoff")
    func retriesRemainStable() async {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        fixture.service.results = Array(repeating: .retry, count: 6) + [.accepted]
        fixture.recorder.record(code: .coordinatorConnectionFailed)
        await settleErrorTasks { fixture.service.calls.count == 7 && fixture.store.events.isEmpty }
        #expect(fixture.state.delays == [30, 60, 120, 240, 300, 300])
        #expect(Set(fixture.service.calls.map(\.event.eventID)).count == 1)
        #expect(fixture.service.calls.allSatisfy { $0.event.environment == ErrorValues.environment })
        #expect(fixture.service.maximumConcurrentCalls == 1)
    }

    @Test("Rejected auth pauses instead of flooding retries and resumes after recovery")
    func authorizationRecovery() async {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        fixture.service.results = [.waitForAuthorization, .accepted]
        fixture.recorder.record(code: .accountInvalidResponse)
        await settleErrorTasks { fixture.service.calls.count == 1 }
        await drainErrorTasks()
        #expect(fixture.state.delays.isEmpty)
        #expect(fixture.store.events.count == 1)
        fixture.state.auth = ErrorValues.authorization(token: "refreshed")
        fixture.recorder.accountStateChanged()
        await settleErrorTasks { fixture.service.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.service.calls.last?.authorization.accessToken == "refreshed")
    }

    @Test("A cancelled in-flight request cannot acknowledge another user's new event")
    func cancellationFencesInFlightSend() async {
        let fixture = ErrorFixture()
        defer { fixture.recorder.stop() }
        let gate = ErrorGate()
        fixture.service.gates = [gate, nil]
        fixture.recorder.record(code: .appServiceFailed)
        await gate.waitUntilEntered()
        fixture.state.auth = nil
        fixture.recorder.clearIdentity()
        fixture.state.auth = ErrorValues.authorization(user: ErrorValues.otherUser)
        fixture.recorder.accountStateChanged()
        fixture.recorder.record(code: .appServiceFailed)
        await drainErrorTasks()
        #expect(fixture.service.calls.count == 1)
        #expect(fixture.store.events.map(\.userID) == [ErrorValues.otherUser])
        gate.release()
        await settleErrorTasks { fixture.service.calls.count == 2 && fixture.store.events.isEmpty }
        #expect(fixture.service.maximumConcurrentCalls == 1)
    }

    @Test("Restoration bounds, ages, and deduplicates the separate outbox")
    func boundedRestoration() async {
        let events = (0..<300).map { _ in ErrorValues.event() }
        let fixture = ErrorFixture(auth: nil, stored: events + [events[0], ErrorValues.event(user: "invalid")])
        defer { fixture.recorder.stop() }
        #expect(fixture.store.events.count == 256)
        fixture.state.now = ErrorValues.now.addingTimeInterval(PetErrorDiagnostics.maximumEventAge + 1)
        fixture.recorder.accountStateChanged()
        #expect(fixture.store.events.isEmpty)
        await drainErrorTasks()
        #expect(fixture.service.calls.isEmpty)
    }

    @Test("Failed deletion cannot revive invalidated diagnostics after restart", arguments: [true, false])
    func failedRemovalAndRestart(disable: Bool) async {
        let generations = ErrorGenerations()
        let oldGeneration = generations.current
        let oldStore = generations.store(oldGeneration)
        let service = ErrorService()
        let recorder = PetErrorDiagnostics(isEnabled: true, authorization: { ErrorValues.authorization() },
            store: generations.wrapper(), service: service, now: { ErrorValues.now }, environment: ErrorValues.environment)
        recorder.record(code: .accountRefreshFailed)
        oldStore.failWrites = true
        if disable { recorder.setEnabled(false); recorder.setEnabled(true) }
        else { recorder.clearIdentity() }
        recorder.stop()
        let restarted = PetErrorDiagnostics(isEnabled: true, authorization: { ErrorValues.authorization() },
            store: generations.wrapper(), service: service, now: { ErrorValues.now }, environment: ErrorValues.environment)
        defer { restarted.stop() }
        await drainErrorTasks()
        #expect(generations.current != oldGeneration)
        #expect(oldStore.events.count == 1)
        #expect(service.calls.isEmpty)
    }
}

@Suite("Error diagnostic privacy and RPC")
@MainActor
struct PetErrorDiagnosticsTransportTests {
    @Test("Only fixed fields and UTC time enter the RPC", arguments: [true, false])
    func payloadAllowlist(_ acknowledgment: Bool) async throws {
        var request: URLRequest?
        let service = PetSupabaseErrorService(configuration: ErrorValues.configuration, transport: { input in
            request = input
            return (Data(String(acknowledgment).utf8), ErrorValues.response(input))
        }, now: { ErrorValues.now })
        let event = ErrorValues.event(date: Date(timeIntervalSince1970: 0.125))
        #expect(try await service.send(event, authorization: ErrorValues.authorization()) == .accepted)
        let sent = try #require(request)
        #expect(sent.url?.absoluteString == "https://errors.example.test/rest/v1/rpc/record_blabee_error")
        #expect(sent.httpMethod == "POST")
        #expect(sent.value(forHTTPHeaderField: "Authorization") == "Bearer private-token")
        #expect(sent.value(forHTTPHeaderField: "apikey") == "test-public-key")
        #expect(!sent.httpShouldHandleCookies)
        #expect(sent.cachePolicy == .reloadIgnoringLocalCacheData)
        let data = try #require(sent.httpBody)
        let payload = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(Set(payload.keys) == ["p_event_id", "p_error_code", "p_occurred_at", "p_app_version", "p_app_build", "p_os_version"])
        #expect(payload["p_error_code"] == "account_refresh_failed")
        #expect(payload["p_occurred_at"] == "1970-01-01T00:00:00.125Z")
        #expect(payload["p_app_version"] == "0.1.0")
        #expect(payload["p_app_build"] == "46")
        #expect(payload["p_os_version"] == "15.2.1")
        #expect(!String(decoding: data, as: UTF8.self).contains("private-token"))
        #expect(!String(decoding: data, as: UTF8.self).contains(ErrorValues.user))
    }

    @Test("Invalid version strings are replaced before storage or transport", arguments: [
        "", "1..2", ".1", "1.", "1.2.3.4.5", "1234567", "v1.2", "1-rc1",
        "1 2", "1\n2", "１３", "/Users/someone/project", "secret-token",
    ])
    func invalidVersionsAreUnknown(_ value: String) throws {
        let environment = PetErrorEnvironment(appVersion: value, appBuild: value, osVersion: value)
        #expect(environment == PetErrorEnvironment(appVersion: "unknown", appBuild: "unknown", osVersion: "unknown"))
        let raw = try JSONSerialization.data(withJSONObject: ["appVersion": value, "appBuild": value, "osVersion": value])
        #expect(try JSONDecoder().decode(PetErrorEnvironment.self, from: raw) == environment)
    }

    @Test("Version fields accept only the documented numeric dotted form", arguments: ["1", "0.1.0", "999999.999999.999999.999999", "unknown"])
    func acceptsValidVersions(_ value: String) {
        let environment = PetErrorEnvironment(appVersion: value, appBuild: value, osVersion: value)
        #expect(environment.appVersion == value)
        #expect(environment.appBuild == value)
        #expect(environment.osVersion == value)
        #expect(PetErrorCode.allCases.count == 13)
    }

    @Test("HTTP status policy acknowledges false and only retries transient responses", arguments: [400, 401, 403, 408, 429, 500, 503, 302])
    func statusPolicy(_ status: Int) async throws {
        let service = PetSupabaseErrorService(configuration: ErrorValues.configuration, transport: { request in
            (Data("body not logged".utf8), ErrorValues.response(request, status: status))
        }, now: { ErrorValues.now })
        let result = try await service.send(ErrorValues.event(), authorization: ErrorValues.authorization())
        if [401, 403].contains(status) { #expect(result == .waitForAuthorization) }
        else if [408, 429, 500, 503].contains(status) { #expect(result == .retry) }
        else { #expect(result == .discard) }
    }

    @Test("Unsafe origins never receive authorization", arguments: [
        "http://errors.example.test", "https://user@errors.example.test", "https://errors.example.test:443",
        "https://errors.example.test/path", "https://errors.example.test?q=a", "https://errors.example.test#fragment",
    ])
    func invalidOrigin(_ value: String) async throws {
        var sends = 0
        let service = PetSupabaseErrorService(configuration: .init(supabaseURL: URL(string: value)!, publishableKey: "public"), transport: { request in
            sends += 1
            return (Data("true".utf8), ErrorValues.response(request))
        }, now: { ErrorValues.now })
        #expect(try await service.send(ErrorValues.event(), authorization: ErrorValues.authorization()) == .discard)
        #expect(sends == 0)
    }

    @Test("Cross-user, expired, and redirected responses cannot acknowledge an event")
    func authAndRedirectBoundaries() async throws {
        var sends = 0
        let service = PetSupabaseErrorService(configuration: ErrorValues.configuration, transport: { _ in
            sends += 1
            return (Data("true".utf8), HTTPURLResponse(url: URL(string: "https://different.example.test")!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }, now: { ErrorValues.now })
        #expect(try await service.send(ErrorValues.event(user: ErrorValues.otherUser), authorization: ErrorValues.authorization()) == .discard)
        #expect(try await service.send(ErrorValues.event(), authorization: ErrorValues.authorization(expiresAt: ErrorValues.now)) == .waitForAuthorization)
        #expect(sends == 0)
        #expect(try await service.send(ErrorValues.event(), authorization: ErrorValues.authorization()) == .discard)
        #expect(sends == 1)
    }
}

@Suite("Private error diagnostic outbox")
@MainActor
struct PetErrorDiagnosticsStoreTests {
    @Test("Private bounded JSON contains only account ID and allowlisted event fields")
    func privateJSON() throws {
        let root = try ErrorTemporaryDirectory()
        defer { root.remove() }
        let directory = root.url.appendingPathComponent("diagnostics")
        let store = PetErrorFileStore(directory: directory)
        let event = ErrorValues.event()
        try store.save([event])
        #expect(try store.load() == [event])
        let url = directory.appendingPathComponent(PetErrorFileStore.fileName)
        let data = try Data(contentsOf: url)
        let rows = try #require(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        let row = try #require(rows.first)
        #expect(Set(row.keys) == ["userID", "eventID", "code", "occurredAt", "environment"])
        let environment = try #require(row["environment"] as? [String: String])
        #expect(Set(environment.keys) == ["appVersion", "appBuild", "osVersion"])
        #expect(!String(decoding: data, as: UTF8.self).contains("token"))
        #expect(try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int == 0o600)
        #expect(try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? Int == 0o700)
        #expect(throws: (any Error).self) { try store.save(Array(repeating: event, count: 257)) }
        try Data(repeating: 32, count: PetErrorFileStore.maximumBytes + 1).write(to: url)
        #expect(throws: (any Error).self) { try store.load() }
    }

    @Test("Symlinks cannot redirect the diagnostics store")
    func refusesLinks() throws {
        let root = try ErrorTemporaryDirectory()
        defer { root.remove() }
        let directory = root.url.appendingPathComponent("diagnostics")
        let store = PetErrorFileStore(directory: directory)
        try store.save([ErrorValues.event()])
        let url = directory.appendingPathComponent(PetErrorFileStore.fileName)
        let target = root.url.appendingPathComponent("unrelated")
        let original = Data("unrelated".utf8)
        try original.write(to: target)
        try FileManager.default.removeItem(at: url)
        try FileManager.default.createSymbolicLink(at: url, withDestinationURL: target)
        #expect(throws: (any Error).self) { try store.load() }
        #expect(throws: (any Error).self) { try store.save([ErrorValues.event()]) }
        try store.clear()
        #expect(try Data(contentsOf: target) == original)
    }

    @Test("Failed file deletion cannot reverse generation invalidation")
    func readOnlyDirectoryAndRestart() throws {
        let root = try ErrorTemporaryDirectory()
        defer { root.remove() }
        let directory = root.url.appendingPathComponent("diagnostics")
        var generation = UUID()
        let old = generation
        let store = PetErrorGenerationStore(generation: generation, saveGeneration: { generation = $0 },
            makeStore: { PetErrorFileStore(directory: directory, generation: $0) })
        try store.save([ErrorValues.event()])
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
        #expect(throws: (any Error).self) { try store.invalidate() }
        #expect(generation != old)
        let restarted = PetErrorGenerationStore(generation: generation, saveGeneration: { generation = $0 },
            makeStore: { PetErrorFileStore(directory: directory, generation: $0) })
        #expect(try restarted.load().isEmpty)
        #expect(try PetErrorFileStore(directory: directory, generation: old).load().count == 1)
    }
}

private enum ErrorValues {
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static let user = "11111111-1111-4111-8111-111111111111"
    static let otherUser = "22222222-2222-4222-8222-222222222222"
    static let configuration = PetAccountConfiguration(supabaseURL: URL(string: "https://errors.example.test")!, publishableKey: "test-public-key")
    static let environment = PetErrorEnvironment(appVersion: "0.1.0", appBuild: "46", osVersion: "15.2.1")
    static func authorization(user: String = user, token: String = "private-token", expiresAt: Date = now.addingTimeInterval(3_600)) -> PetUsageAuthorization {
        .init(userID: user, accessToken: token, expiresAt: expiresAt)
    }
    static func event(user: String = user, date: Date = now) -> PetErrorEvent {
        .init(userID: user, eventID: UUID(), code: .accountRefreshFailed, occurredAt: date, environment: environment)
    }
    static func response(_ request: URLRequest, status: Int = 200) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    }
}

enum ErrorPrivacyBoundary: CaseIterable, Sendable { case consent, logout, differentUser, stop }

@MainActor
private final class ErrorFixture {
    let state = ErrorState()
    let store = ErrorStore()
    let service = ErrorService()
    var recorder: PetErrorDiagnostics!
    init(enabled: Bool = true, auth: PetUsageAuthorization? = ErrorValues.authorization(), stored: [PetErrorEvent] = []) {
        state.auth = auth
        store.events = stored
        recorder = PetErrorDiagnostics(isEnabled: enabled, authorization: { [state] in state.auth }, store: store, service: service,
            savePreference: { [state] in state.preferences.append($0) }, now: { [state] in state.now },
            sleep: { [state] in state.delays.append($0) }, environment: ErrorValues.environment)
    }
}

@MainActor
private final class ErrorState {
    var now = ErrorValues.now
    var auth: PetUsageAuthorization? = ErrorValues.authorization()
    var preferences: [Bool] = []
    var delays: [TimeInterval] = []
}

@MainActor
private final class ErrorStore: PetErrorEventStoring {
    var events: [PetErrorEvent] = []
    var failWrites = false
    func load() throws -> [PetErrorEvent] { events }
    func save(_ events: [PetErrorEvent]) throws {
        if failWrites { throw URLError(.cannotWriteToFile) }
        self.events = events
    }
    func clear() throws {
        if failWrites { throw URLError(.cannotWriteToFile) }
        events = []
    }
}

@MainActor
private final class ErrorGenerations {
    var current = UUID()
    private var stores: [UUID: ErrorStore] = [:]
    func store(_ generation: UUID) -> ErrorStore {
        if let store = stores[generation] { return store }
        let store = ErrorStore()
        stores[generation] = store
        return store
    }
    func wrapper() -> PetErrorGenerationStore {
        PetErrorGenerationStore(generation: current, saveGeneration: { [self] in current = $0 }, makeStore: { [self] in store($0) })
    }
}

@MainActor
private final class ErrorService: PetErrorSending {
    struct Call { let event: PetErrorEvent; let authorization: PetUsageAuthorization }
    var calls: [Call] = []
    var results: [PetErrorDelivery] = []
    var gates: [ErrorGate?] = []
    private var concurrentCalls = 0
    var maximumConcurrentCalls = 0
    func send(_ event: PetErrorEvent, authorization: PetUsageAuthorization) async throws -> PetErrorDelivery {
        calls.append(.init(event: event, authorization: authorization))
        concurrentCalls += 1
        maximumConcurrentCalls = max(maximumConcurrentCalls, concurrentCalls)
        defer { concurrentCalls -= 1 }
        if !gates.isEmpty, let gate = gates.removeFirst() { await gate.suspend() }
        return results.isEmpty ? .accepted : results.removeFirst()
    }
}

@MainActor
private final class ErrorGate {
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
private func settleErrorTasks(_ condition: @MainActor () -> Bool, sourceLocation: SourceLocation = #_sourceLocation) async {
    for _ in 0..<1_000 {
        if condition() { return }
        await Task.yield()
    }
    #expect(condition(), sourceLocation: sourceLocation)
}

@MainActor
private func drainErrorTasks() async {
    for _ in 0..<30 { await Task.yield() }
}

private struct ErrorTemporaryDirectory {
    let url: URL
    init() throws {
        url = URL(fileURLWithPath: "/private/tmp", isDirectory: true).appendingPathComponent("blabee-errors-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }
    func remove() { try? FileManager.default.removeItem(at: url) }
}
