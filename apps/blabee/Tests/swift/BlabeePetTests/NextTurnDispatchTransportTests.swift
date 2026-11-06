@testable import CoordinatorSwift
import Darwin
import Foundation
import Testing
@testable import BlabeeCoordinator

private actor DispatchFailureWireApplication: CoordinatorOperationalHandling {
    let failure: CoordinatorError
    init(failure: CoordinatorError) { self.failure = failure }
    func handle(type: String, payload: Data) async throws -> Data { throw failure }
    func doctorStatus(payload: Data) async throws -> Data { throw failure }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
}

@Test("Queue failure evidence survives the real UDS error envelope, with legacy errors still accepted",
      arguments: [false, true])
func nextTurnDispatchFailureWireRoundTrip(withEvidence: Bool) async throws {
    let root = URL(fileURLWithPath: "/tmp").appendingPathComponent("bdw-\(UUID().uuidString.prefix(8))")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    #expect(chmod(root.path, 0o700) == 0)
    let detail = CoordinatorNextTurnDispatchFailure(code: "codex_native_probe_timeout", stage: .qualification,
        commandInvocationAttempted: false, elapsedMilliseconds: 2, cachedFailure: true,
        codexVersion: "0.157.1", executableIdentity: String(repeating: "a", count: 64))
    let expected = CoordinatorError(detail.code, "raw stderr must never be exposed",
        dispatchFailure: withEvidence ? detail : nil)
    let server = try UnixDomainSocketServer(socketPath: root.appendingPathComponent("daemon.sock").path)
    try server.activate()
    defer { server.stop() }
    let application = DispatchFailureWireApplication(failure: expected)
    let task = Task {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            DispatchQueue.global().async {
                continuation.resume(with: Result {
                    try server.run(application: application, secretCorpus: RuntimeSecretCorpus())
                })
            }
        }
    }
    do {
        let client = try PetUnixDomainSocketTransport(socketPath: root.appendingPathComponent("daemon.sock").path)
        do {
            _ = try await client.request(type: "select", payload: StrictJSONTransport.data(forJSONObject: [:]))
            Issue.record("An error response must remain an error")
        } catch {
            #expect(error.coordinatorError.code == detail.code)
            #expect(error.coordinatorError.dispatchFailure == (withEvidence ? detail : nil))
            #expect(!String(describing: error).contains("raw stderr"))
        }
        server.stop()
        try await task.value
    } catch {
        server.stop()
        _ = try? await task.value
        throw error
    }
}

@Test("Dispatch diagnostics reject unknown fields, unsafe codes, false certainty, and malformed numbers")
func nextTurnDispatchDiagnosticValidation() throws {
    let diagnostic = CoordinatorNextTurnDispatchFailure(code: "codex_queue_process_timeout", stage: .command,
        commandInvocationAttempted: true, elapsedMilliseconds: 10_000)
    #expect(try CoordinatorNextTurnDispatchFailure(jsonObject: diagnostic.jsonObject) == diagnostic)
    let corruptions: [(String, Any)] = [
        ("command", "do not store commands"), ("code", "secret_token_value"),
        ("delivery_state", "not_submitted"), ("command_invocation_attempted", 1),
        ("cached_failure", 0), ("elapsed_ms", true), ("elapsed_ms", -1),
        ("elapsed_ms", 86_400_001), ("exit_code", Int64.max), ("termination_signal", "9"),
        ("codex_version", "/private/user/codex"), ("codex_version", 157),
        ("executable_identity", String(repeating: "A", count: 64)), ("executable_identity", 1),
    ]
    for (key, value) in corruptions {
        var object = diagnostic.jsonObject
        object[key] = value
        #expect(throws: CoordinatorError.self) { try CoordinatorNextTurnDispatchFailure(jsonObject: object) }
    }
    let redacted = CoordinatorNextTurnDispatchFailure(code: "secret_token_value", stage: .unknown,
        commandInvocationAttempted: true, elapsedMilliseconds: -1)
    #expect(redacted.code == "next_turn_dispatch_failed")
    #expect(redacted.elapsedMilliseconds == 0)
}

private final class OperationalServiceDiagnosticProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var instant: UInt64 = 0
    private var diagnostics: [OperationalServiceDiagnostic] = []
    private var writes = 0

    func now() -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        return instant
    }

    func setTime(_ value: UInt64) {
        lock.lock(); defer { lock.unlock() }
        instant = value
    }

    func record(_ diagnostic: OperationalServiceDiagnostic) {
        lock.lock(); defer { lock.unlock() }
        diagnostics.append(diagnostic)
    }

    func recordWrite() {
        lock.lock(); defer { lock.unlock() }
        writes += 1
    }

    func result() -> (diagnostics: [OperationalServiceDiagnostic], writes: Int) {
        lock.lock(); defer { lock.unlock() }
        return (diagnostics, writes)
    }
}

@Test("Operational logs suppress fast polling and independently bound request and response evidence")
func operationalServiceDiagnosticsAreTargetedAndBounded() {
    let probe = OperationalServiceDiagnosticProbe()
    probe.setTime(1)
    let diagnostics = OperationalServiceDiagnostics(clock: probe.now, sink: probe.record)
    let fastPolling = CoordinatorOperationalRequestTiming(operation: .getState,
        actorQueueWaitNanoseconds: 1, actorHandlerElapsedNanoseconds: 2, succeeded: true)
    for _ in 0..<200 { diagnostics.recordRequestTiming(fastPolling) }
    #expect(probe.result().diagnostics.isEmpty)

    let slowPolling = CoordinatorOperationalRequestTiming(operation: .getState,
        actorQueueWaitNanoseconds: OperationalServiceDiagnostics.slowRequestNanoseconds,
        actorHandlerElapsedNanoseconds: 2, succeeded: true)
    for _ in 0...OperationalServiceDiagnostics.maximumEventsPerWindow {
        diagnostics.recordRequestTiming(slowPolling)
    }
    #expect(probe.result().diagnostics.count == OperationalServiceDiagnostics.maximumEventsPerWindow)
    let selection = CoordinatorOperationalRequestTiming(operation: .select,
        actorQueueWaitNanoseconds: 3, actorHandlerElapsedNanoseconds: 4, succeeded: true)
    for _ in 0...OperationalServiceDiagnostics.maximumEventsPerWindow {
        diagnostics.recordRequestTiming(selection)
    }
    #expect(probe.result().diagnostics.count == 2 * OperationalServiceDiagnostics.maximumEventsPerWindow)
    #expect(probe.result().diagnostics.first == .requestTiming(slowPolling))
    #expect(probe.result().diagnostics.last == .requestTiming(selection))

    let response = OperationalResponseWriteTiming(response: .result, outcome: .succeeded,
        elapsedNanoseconds: 5)
    for _ in 0...OperationalServiceDiagnostics.maximumEventsPerWindow {
        diagnostics.recordResponseWrite(response)
    }
    #expect(probe.result().diagnostics.count == 3 * OperationalServiceDiagnostics.maximumEventsPerWindow)
    #expect(probe.result().diagnostics.last == .responseWrite(response))

    // Clock samples taken before lock acquisition can arrive out of order.
    probe.setTime(0)
    diagnostics.recordRequestTiming(selection)
    diagnostics.recordResponseWrite(response)
    #expect(probe.result().diagnostics.count == 3 * OperationalServiceDiagnostics.maximumEventsPerWindow)

    probe.setTime(OperationalServiceDiagnostics.windowNanoseconds + 1)
    let failed = CoordinatorOperationalRequestTiming(operation: .other,
        actorQueueWaitNanoseconds: 0, actorHandlerElapsedNanoseconds: 0, succeeded: false)
    diagnostics.recordRequestTiming(failed)
    diagnostics.recordResponseWrite(response)
    #expect(probe.result().diagnostics.count == 3 * OperationalServiceDiagnostics.maximumEventsPerWindow + 2)
    #expect(Array(probe.result().diagnostics.suffix(2)) == [.requestTiming(failed), .responseWrite(response)])
}

@Test("Response diagnostics observe exactly one write attempt without carrying frames or error text",
      arguments: [true, false], [true, false])
func operationalResponseWriteIsDiagnosticOnly(responseSucceeded: Bool, writeSucceeded: Bool) async {
    let probe = OperationalServiceDiagnosticProbe()
    let frame = Data("private prompt and request identifier".utf8)
    let writer = OperationalResponseWriter(writer: { data, descriptor, deadline in
        #expect(data == frame)
        #expect(descriptor == 123)
        #expect(deadline == 5_000_000_000)
        probe.recordWrite()
        probe.setTime(125_000_000)
        if !writeSucceeded { throw CoordinatorError("private_error_value", "private error text") }
    }, clock: probe.now, observer: { probe.record(.responseWrite($0)) })
    await writer.write(frame, descriptor: 123, deadline: 5_000_000_000,
        response: responseSucceeded ? .result : .error, observeUserPromptSubmit: true)
    #expect(probe.result().writes == 1)
    #expect(probe.result().diagnostics == [.responseWrite(OperationalResponseWriteTiming(
        response: responseSucceeded ? .result : .error,
        outcome: writeSucceeded ? .succeeded : .failed, elapsedNanoseconds: 125_000_000))])
    #expect(!String(describing: probe.result().diagnostics).contains("private"))

    await writer.write(frame, descriptor: 123, deadline: 5_000_000_000,
        response: .result, observeUserPromptSubmit: false)
    #expect(probe.result().writes == 2)
    #expect(probe.result().diagnostics.count == 1)
}

@Test("Response write outcomes preserve fixed timeout and cancellation codes, with no raw errors")
func operationalResponseWriteOutcomeCodesAreFixed() {
    #expect(OperationalResponseWriteTiming.Outcome(error: CancellationError()) == .cancelled)
    #expect(OperationalResponseWriteTiming.Outcome(error:
        CoordinatorError("operational_response_timeout")) == .timedOut)
    #expect(OperationalResponseWriteTiming.Outcome(error:
        CoordinatorError("operational_transport_closed")) == .closed)
    #expect(OperationalResponseWriteTiming.Outcome(error:
        CoordinatorError("arbitrary_sensitive_code")) == .failed)
    #expect(OperationalResponseWriteTiming.Outcome(error: PrivateResponseWriteError()) == .failed)
}

private struct PrivateResponseWriteError: Error, CustomStringConvertible {
    var description: String {
        Issue.record("Diagnostic classification must not evaluate arbitrary error descriptions")
        return "private error description"
    }
}

private actor ResponseWriteWireApplication: CoordinatorOperationalHandling {
    let fail: Bool
    init(fail: Bool) { self.fail = fail }
    func handle(type: String, payload: Data) async throws -> Data {
        if fail { throw CoordinatorError("queued_action_expired", "private error text") }
        return try StrictJSONTransport.data(forJSONObject: ["observed": true])
    }
    func doctorStatus(payload: Data) async throws -> Data { try await handle(type: "doctor_status", payload: payload) }
    func processTime() async throws -> [Data] { [] }
    func millisecondsUntilNextDeadline() async -> Int32? { nil }
}

@Test("Real UDS user prompt result and error frames each report their final write",
      arguments: [true, false])
func operationalUserPromptResponseWriteWireEvidence(applicationFails: Bool) async throws {
    let root = URL(fileURLWithPath: "/tmp").appendingPathComponent("bdr-\(UUID().uuidString.prefix(8))")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    #expect(chmod(root.path, 0o700) == 0)
    let probe = OperationalServiceDiagnosticProbe()
    let server = try UnixDomainSocketServer(socketPath: root.appendingPathComponent("daemon.sock").path,
        responseWriter: OperationalResponseWriter(observer: { probe.record(.responseWrite($0)) }))
    try server.activate()
    defer { server.stop() }
    let application = ResponseWriteWireApplication(fail: applicationFails)
    let task = Task {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            DispatchQueue.global().async {
                continuation.resume(with: Result {
                    try server.run(application: application, secretCorpus: RuntimeSecretCorpus())
                })
            }
        }
    }
    do {
        let client = try PetUnixDomainSocketTransport(socketPath: root.appendingPathComponent("daemon.sock").path)
        do {
            _ = try await client.request(type: "user_prompt_submit", payload: StrictJSONTransport.data(forJSONObject: [:]))
            #expect(!applicationFails)
        } catch {
            #expect(applicationFails)
            #expect(error.coordinatorError.code == "queued_action_expired")
        }
        // The client can consume a frame before the server records its write.
        let deadline = ContinuousClock.now.advanced(by: .seconds(1))
        while probe.result().diagnostics.isEmpty, ContinuousClock.now < deadline {
            await Task.yield()
        }
        let events = probe.result().diagnostics
        #expect(events.count == 1)
        if let first = events.first, case .responseWrite(let timing) = first {
            #expect(timing.response == (applicationFails ? .error : .result))
            #expect(timing.outcome == .succeeded)
        } else { Issue.record("Expected final response-write evidence") }
        server.stop()
        try await task.value
    } catch {
        server.stop()
        _ = try? await task.value
        throw error
    }
}
