import Dispatch
import Foundation
import Testing
@testable import CoordinatorSwift

private final class DiagnosticBufferProbe: @unchecked Sendable {
    private let lock = NSLock()
    private let gate = DispatchSemaphore(value: 0)
    private let blockFirst: Bool
    private let throwFirst: Bool
    private var entered: [String] = []
    private var completed: [String] = []
    private var active = 0
    private var maximumActive = 0
    private var failures = 0

    init(blockFirst: Bool = false, throwFirst: Bool = false) {
        self.blockFirst = blockFirst
        self.throwFirst = throwFirst
    }

    func record(_ record: CoordinatorNextTurnDispatchRecord) throws {
        let first = lock.withLock {
            entered.append(record.continuationID)
            active += 1
            maximumActive = max(maximumActive, active)
            return entered.count == 1
        }
        defer {
            lock.withLock {
                active -= 1
                completed.append(record.continuationID)
            }
        }
        if first && blockFirst {
            guard gate.wait(timeout: .now() + 5) == .success else {
                throw CoordinatorError("test_diagnostic_gate_timeout")
            }
        }
        if first && throwFirst { throw CoordinatorError("test_diagnostic_disk_failure") }
    }

    func release() { gate.signal() }
    func failed() { lock.withLock { failures += 1 } }
    func snapshot() -> (entered: [String], completed: [String], maximumActive: Int, failures: Int) {
        lock.withLock { (entered, completed, maximumActive, failures) }
    }
}

private func diagnosticBufferRecord(_ id: String) -> CoordinatorNextTurnDispatchRecord {
    CoordinatorNextTurnDispatchRecord(continuationID: id, sessionID: "session_diagnostic_buffer",
        occurredAt: "2026-09-29T00:00:00Z", outcome: .started)
}

private func waitForDiagnosticBuffer(_ predicate: () -> Bool) async throws -> Bool {
    // A scheduling safety bound, not a production latency benchmark.
    for _ in 0..<200 {
        if predicate() { return true }
        try await Task.sleep(for: .milliseconds(5))
    }
    return predicate()
}

@Test("Blocked diagnostic storage bounds queued and running records without blocking admission")
func dispatchDiagnosticBufferBoundsOutstandingRecords() async throws {
    let probe = DiagnosticBufferProbe(blockFirst: true)
    let buffer = CoordinatorDispatchDiagnosticBuffer(capacity: 2,
        recorder: probe.record, onFailure: probe.failed)
    defer { probe.release() }
    try buffer.enqueue(diagnosticBufferRecord("first"))
    #expect(try await waitForDiagnosticBuffer { probe.snapshot().entered == ["first"] })
    // The first sink call remains blocked. Only one more record may be retained.
    try buffer.enqueue(diagnosticBufferRecord("second"))
    #expect(throws: CoordinatorError("dispatch_diagnostic_queue_full")) {
        try buffer.enqueue(diagnosticBufferRecord("overflow"))
    }
    #expect(probe.snapshot().completed.isEmpty)
    #expect(probe.snapshot().entered == ["first"])
    probe.release()
    #expect(try await waitForDiagnosticBuffer { probe.snapshot().completed == ["first", "second"] })
    // Admission may race the worker's final bookkeeping, so retry only admission.
    var readmitted = false
    for _ in 0..<200 {
        do {
            try buffer.enqueue(diagnosticBufferRecord("third"))
            readmitted = true
            break
        } catch {
            #expect(error.coordinatorError.code == "dispatch_diagnostic_queue_full")
            try await Task.sleep(for: .milliseconds(5))
        }
    }
    #expect(readmitted)
    #expect(try await waitForDiagnosticBuffer { probe.snapshot().completed.count == 3 })
    #expect(probe.snapshot().entered == ["first", "second", "third"])
    #expect(probe.snapshot().maximumActive == 1)
    #expect(probe.snapshot().failures == 0)
}

@Test("Diagnostic sink failure is observed once and does not stall later records or retry")
func dispatchDiagnosticBufferContinuesAfterSinkFailure() async throws {
    let probe = DiagnosticBufferProbe(throwFirst: true)
    let buffer = CoordinatorDispatchDiagnosticBuffer(recorder: probe.record, onFailure: probe.failed)
    try buffer.enqueue(diagnosticBufferRecord("first"))
    try buffer.enqueue(diagnosticBufferRecord("second"))
    #expect(try await waitForDiagnosticBuffer {
        probe.snapshot().completed.count == 2 && probe.snapshot().failures == 1
    })
    #expect(probe.snapshot().entered == ["first", "second"])
    #expect(probe.snapshot().maximumActive == 1)
}

@Test("Diagnostic buffer rejects oversized observations before reaching the sink")
func dispatchDiagnosticBufferRejectsOversizedRecord() async throws {
    let probe = DiagnosticBufferProbe()
    let buffer = CoordinatorDispatchDiagnosticBuffer(recorder: probe.record, onFailure: probe.failed)
    #expect(throws: CoordinatorError("dispatch_diagnostic_record_too_large")) {
        try buffer.enqueue(diagnosticBufferRecord(String(repeating: "x",
            count: CoordinatorDispatchDiagnosticBuffer.maximumRecordBytes)))
    }
    try buffer.enqueue(diagnosticBufferRecord("valid"))
    #expect(try await waitForDiagnosticBuffer { probe.snapshot().completed == ["valid"] })
    #expect(probe.snapshot().entered == ["valid"])
    #expect(probe.snapshot().failures == 0)
}
