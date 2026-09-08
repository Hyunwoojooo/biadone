import CoordinatorSwift
import Darwin
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
    let serverTask = Task.detached {
        try server.run(application: application, secretCorpus: corpus)
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
