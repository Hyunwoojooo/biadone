import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private actor UpdateAdmissionWireApplication: CoordinatorOperationalHandling {
    private var calls: [String] = []
    func handle(type: String, payload: Data) async throws -> Data {
        calls.append(type)
        return try StrictJSONTransport.data(forJSONObject: ["response_kind": type])
    }
    func doctorStatus(payload: Data) async throws -> Data { try await handle(type: "doctor_status", payload: payload) }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
    func recordedCalls() -> [String] { calls }
}

@Test("Update admission fences new requests and remains held through a slow or failed prompt response",
      arguments: [true, false])
func appUpdateAdmissionProtectsWireResponse(writeSucceeds: Bool) async throws {
    let root = URL(fileURLWithPath: "/private/tmp/bua-\(UUID().uuidString.prefix(8))")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    let admissionDirectory = root.appendingPathComponent("admission")
    let writer = OperationalResponseWriter(writer: { data, descriptor, deadline in
        let object = try StrictJSONTransport.object(from: data)
        if (object["result"] as? [String: Any])?["response_kind"] as? String == "user_prompt_submit" {
            // The application has returned. Publication of its possibly committed
            // claim must still exclude an updater even while the writer suspends.
            #expect(throws: AppUpdateAdmissionError.busy) {
                try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: admissionDirectory)
            }
            try await Task.sleep(for: .milliseconds(20))
            #expect(throws: AppUpdateAdmissionError.busy) {
                try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: admissionDirectory)
            }
            if !writeSucceeds { throw CoordinatorError("operational_transport_closed") }
        }
        await OperationalResponseWriter().write(data, descriptor: descriptor, deadline: deadline,
            response: .result, observeUserPromptSubmit: false)
    })
    let socket = root.appendingPathComponent("daemon.sock").path
    let server = try UnixDomainSocketServer(socketPath: socket, responseWriter: writer,
        updateAdmission: { try AppUpdateAdmissionGate.acquireRequest(directoryURL: admissionDirectory) })
    try server.activate()
    defer { server.stop() }
    let application = UpdateAdmissionWireApplication()
    let serving = Task {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            DispatchQueue.global().async {
                continuation.resume(with: Result {
                    try server.run(application: application, secretCorpus: RuntimeSecretCorpus())
                })
            }
        }
    }
    do {
        let client = try PetUnixDomainSocketTransport(socketPath: socket)
        let payload = try StrictJSONTransport.data(forJSONObject: [:])
        let update = try AppUpdateAdmissionGate.acquireForUpdate(directoryURL: admissionDirectory)
        do {
            _ = try await client.request(type: "get_state", payload: payload)
            Issue.record("New requests must not enter while replacement is reserved")
        } catch { #expect(error.coordinatorError.code == "app_update_in_progress") }
        #expect(await application.recordedCalls().isEmpty)
        // The final read-only readiness check remains usable under the fence.
        _ = try await client.request(type: "update_status", payload: payload)
        #expect(await application.recordedCalls() == ["update_status"])
        update.release()
        do {
            _ = try await client.request(type: "user_prompt_submit", payload: payload)
            #expect(writeSucceeds)
        } catch { #expect(!writeSucceeds) }
        #expect(await application.recordedCalls() == ["update_status", "user_prompt_submit"])
        // A consumed response may precede the server's final defer by a few
        // instructions. Only observe release; never retry the original request.
        var released = false
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        repeat {
            if let next = try? AppUpdateAdmissionGate.acquireForUpdate(directoryURL: admissionDirectory) {
                next.release(); released = true
            } else { await Task.yield() }
        } while !released && ContinuousClock.now < deadline
        #expect(released)
        server.stop()
        try await serving.value
    } catch {
        server.stop()
        _ = try? await serving.value
        throw error
    }
}
