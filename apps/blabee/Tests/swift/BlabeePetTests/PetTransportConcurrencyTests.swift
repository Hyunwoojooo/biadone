import CoordinatorSwift
import Darwin
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

private actor PetTransportBlockingApplication: CoordinatorOperationalHandling {
    private var selectStarted = false
    private var selectContinuation: CheckedContinuation<Void, Never>?

    func handle(type: String, payload: Data) async throws -> Data {
        _ = try StrictJSONTransport.object(from: payload)
        switch type {
        case "select":
            selectStarted = true
            await withCheckedContinuation { continuation in
                selectContinuation = continuation
            }
            return try StrictJSONTransport.data(forJSONObject: ["selected": true])
        case "get_state":
            return try StrictJSONTransport.data(forJSONObject: ["heartbeat": true])
        default:
            throw CoordinatorError("pet_transport_test_request_invalid")
        }
    }

    func doctorStatus(payload: Data) async throws -> Data {
        throw CoordinatorError("pet_transport_test_doctor_forbidden")
    }

    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }

    func waitUntilSelectStarted() async {
        while !selectStarted { await Task.yield() }
    }

    func releaseSelect() {
        selectContinuation?.resume()
        selectContinuation = nil
    }
}

private enum PetTransportConcurrencyTestError: Error {
    case heartbeatStarved
}

@Test("Pet transport heartbeats are not starved by a blocked selection")
func petTransportHeartbeatRemainsConcurrentWithSelection() async throws {
    // LIBDISPATCH_COOPERATIVE_POOL_STRICT=1 makes worker starvation
    // deterministic; this test also covers ordinary actor concurrency.
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bpt-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    guard chmod(root.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    defer { try? FileManager.default.removeItem(at: root) }

    let socketPath = root.appendingPathComponent("daemon.sock").path
    let server = try UnixDomainSocketServer(socketPath: socketPath)
    let application = PetTransportBlockingApplication()
    let corpus = RuntimeSecretCorpus()
    try server.activate()
    let serverTask = Task {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            // The listener is intentionally synchronous; do not consume a
            // cooperative worker when testing client executor starvation.
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(with: Result {
                    try server.run(application: application, secretCorpus: corpus)
                })
            }
        }
    }
    let transport = try PetUnixDomainSocketTransport(
        socketPath: socketPath,
        connectTimeoutMilliseconds: 1_000,
        responseTimeoutMilliseconds: 1_000,
        userDecisionResponseTimeoutMilliseconds: 5_000,
        selectionResponseTimeoutMilliseconds: 5_000
    )
    let selection = Task {
        try await transport.request(
            type: "select",
            payload: StrictJSONTransport.data(forJSONObject: [:])
        )
    }
    await application.waitUntilSelectStarted()

    do {
        let heartbeat = try await withThrowingTaskGroup(of: Data.self) { group in
            group.addTask {
                try await transport.request(
                    type: "get_state",
                    payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat()
                )
            }
            group.addTask {
                try await Task.sleep(nanoseconds: 1_000_000_000)
                await application.releaseSelect()
                throw PetTransportConcurrencyTestError.heartbeatStarved
            }
            let first = try await group.next()
            group.cancelAll()
            return try #require(first)
        }
        let object = try StrictJSONTransport.object(from: heartbeat)
        #expect(object["heartbeat"] as? Bool == true)
    } catch {
        await application.releaseSelect()
        server.stop()
        _ = try? await selection.value
        _ = try? await serverTask.value
        throw error
    }

    await application.releaseSelect()
    _ = try await selection.value
    server.stop()
    try await serverTask.value
}

private actor PetTransportDelayedDismissalApplication: CoordinatorOperationalHandling {
    private var dismissals = 0

    func handle(type: String, payload: Data) async throws -> Data {
        _ = try StrictJSONTransport.object(from: payload)
        if type == "dismiss_interaction" { dismissals += 1 }
        try await Task.sleep(nanoseconds: 350_000_000)
        switch type {
        case "dismiss_interaction":
            return try StrictJSONTransport.data(forJSONObject: ["dismissed": true])
        case "get_state":
            return try StrictJSONTransport.data(forJSONObject: ["heartbeat": true])
        default:
            throw CoordinatorError("pet_transport_test_request_invalid")
        }
    }

    func doctorStatus(payload: Data) async throws -> Data {
        throw CoordinatorError("pet_transport_test_doctor_forbidden")
    }

    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
    func dismissalCount() -> Int { dismissals }
}

@Test("A delayed dismissal is sent once and does not extend snapshot deadlines")
func petTransportDelayedDismissalUsesItsOwnDeadline() async throws {
    let root = URL(fileURLWithPath: "/tmp", isDirectory: true)
        .appendingPathComponent("bpd-\(UUID().uuidString.prefix(8))", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    guard chmod(root.path, mode_t(0o700)) == 0 else {
        throw CoordinatorError("test_chmod_failed")
    }
    let socketPath = root.appendingPathComponent("daemon.sock").path
    let server = try UnixDomainSocketServer(socketPath: socketPath)
    let application = PetTransportDelayedDismissalApplication()
    let corpus = RuntimeSecretCorpus()
    try server.activate()
    defer { server.stop() }
    let serverTask = Task {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(with: Result {
                    try server.run(application: application, secretCorpus: corpus)
                })
            }
        }
    }
    do {
        let transport = try PetUnixDomainSocketTransport(
            socketPath: socketPath,
            connectTimeoutMilliseconds: 1_000,
            responseTimeoutMilliseconds: 100,
            dismissalResponseTimeoutMilliseconds: 2_000
        )
        do {
            _ = try await transport.request(
                type: "get_state", payload: PetTransportRequestPayload.snapshotWithConsumerHeartbeat()
            )
            Issue.record("A delayed snapshot must retain its short polling deadline")
        } catch {
            #expect((error as? CoordinatorError)?.code == "operational_response_timeout")
        }
        let response = try await transport.request(
            type: "dismiss_interaction", payload: StrictJSONTransport.data(forJSONObject: [:])
        )
        let object = try StrictJSONTransport.object(from: response)
        #expect(object["dismissed"] as? Bool == true)
        #expect(await application.dismissalCount() == 1)
    } catch {
        server.stop()
        _ = try? await serverTask.value
        throw error
    }
    server.stop()
    try await serverTask.value
}
