import CoreFoundation
import Dispatch
import Foundation

/// Exact prompt transport requested after a Pet action is selected.
///
/// A receipt proves only that the transport accepted the prompt. It does not
/// prove that Codex ran the requested action or that the action succeeded.
public struct CoordinatorNextTurnDispatchRequest: Sendable, Equatable {
    public let sessionID: String
    public let message: String
    public let continuationID: String

    public init(
        sessionID: String,
        message: String,
        continuationID: String
    ) {
        self.sessionID = sessionID
        self.message = message
        self.continuationID = continuationID
    }
}

public struct CoordinatorNextTurnDispatchReceipt: Sendable, Equatable {
    public let queuedSubmissionID: String

    public init(queuedSubmissionID: String) {
        self.queuedSubmissionID = queuedSubmissionID
    }
}

public typealias CoordinatorNextTurnDispatcher = @Sendable (
    CoordinatorNextTurnDispatchRequest
) async throws -> CoordinatorNextTurnDispatchReceipt

/// Observations only: these fields never authorize a claim, retry, or execution.
/// Invocation is marked before calling the queue runner, so a launch error is
/// conservatively unknown. It is deliberately not called `process_spawned`.
public struct CoordinatorNextTurnDispatchFailure: Codable, Sendable, Equatable {
    public enum Stage: String, Codable, Sendable {
        case access, qualification, revalidation, notarization, command
        case queueExit = "queue_exit"
        case receipt, unknown
    }

    public enum DeliveryState: String, Codable, Sendable {
        case notSubmitted = "not_submitted"
        case unknown
    }

    public let code: String
    public let stage: Stage
    public let commandInvocationAttempted: Bool
    public let elapsedMilliseconds: Int64
    public let exitCode: Int32?
    public let terminationSignal: Int32?
    public let cachedFailure: Bool
    public let codexVersion: String?
    public let executableIdentity: String?

    public var deliveryState: DeliveryState { commandInvocationAttempted ? .unknown : .notSubmitted }

    public init(code: String, stage: Stage, commandInvocationAttempted: Bool,
                elapsedMilliseconds: Int64, exitCode: Int32? = nil,
                terminationSignal: Int32? = nil, cachedFailure: Bool = false,
                codexVersion: String? = nil, executableIdentity: String? = nil) {
        self.code = Self.allowedCodes.contains(code) ? code : "next_turn_dispatch_failed"
        self.stage = stage
        self.commandInvocationAttempted = commandInvocationAttempted
        self.elapsedMilliseconds = max(0, min(elapsedMilliseconds, 86_400_000))
        self.exitCode = exitCode
        self.terminationSignal = terminationSignal
        self.cachedFailure = cachedFailure
        self.codexVersion = Self.validVersion(codexVersion) ? codexVersion : nil
        self.executableIdentity = Self.validIdentity(executableIdentity) ? executableIdentity : nil
    }

    public var jsonObject: [String: Any] {
        ["schema_version": "1.0", "code": code, "stage": stage.rawValue,
         "delivery_state": deliveryState.rawValue,
         "command_invocation_attempted": commandInvocationAttempted,
         "elapsed_ms": elapsedMilliseconds,
         "exit_code": exitCode.map { $0 as Any } ?? NSNull(),
         "termination_signal": terminationSignal.map { $0 as Any } ?? NSNull(),
         "cached_failure": cachedFailure,
         "codex_version": codexVersion as Any? ?? NSNull(),
         "executable_identity": executableIdentity as Any? ?? NSNull()]
    }

    public init(jsonObject value: [String: Any]) throws {
        let keys: Set<String> = ["schema_version", "code", "stage", "delivery_state",
            "command_invocation_attempted", "elapsed_ms", "exit_code", "termination_signal", "cached_failure",
            "codex_version", "executable_identity"]
        guard Set(value.keys) == keys, value["schema_version"] as? String == "1.0",
              let code = value["code"] as? String, Self.allowedCodes.contains(code),
              let stageValue = value["stage"] as? String, let stage = Stage(rawValue: stageValue),
              let attemptedNumber = value["command_invocation_attempted"] as? NSNumber,
              CFGetTypeID(attemptedNumber) == CFBooleanGetTypeID(),
              let cachedNumber = value["cached_failure"] as? NSNumber,
              CFGetTypeID(cachedNumber) == CFBooleanGetTypeID(),
              let elapsed = ExactJSONInteger.int64(value["elapsed_ms"], minimum: 0), elapsed <= 86_400_000,
              value["delivery_state"] as? String == (attemptedNumber.boolValue ? "unknown" : "not_submitted")
        else { throw CoordinatorError("operational_response_invalid") }
        func optionalInt(_ key: String) throws -> Int32? {
            if value[key] is NSNull { return nil }
            guard let number = ExactJSONInteger.int64(value[key]), let result = Int32(exactly: number)
            else { throw CoordinatorError("operational_response_invalid") }
            return result
        }
        let version = value["codex_version"] as? String
        let identity = value["executable_identity"] as? String
        guard (value["codex_version"] is NSNull || Self.validVersion(version)),
              (value["executable_identity"] is NSNull || Self.validIdentity(identity))
        else { throw CoordinatorError("operational_response_invalid") }
        self.init(code: code, stage: stage, commandInvocationAttempted: attemptedNumber.boolValue,
                  elapsedMilliseconds: elapsed, exitCode: try optionalInt("exit_code"),
                  terminationSignal: try optionalInt("termination_signal"), cachedFailure: cachedNumber.boolValue,
                  codexVersion: version, executableIdentity: identity)
    }

    private static func validVersion(_ value: String?) -> Bool {
        guard let value, value.utf8.count <= 31 else { return false }
        return value.range(of: "^[0-9]{1,6}(\\.[0-9]{1,6}){1,3}$", options: .regularExpression) != nil
    }

    private static func validIdentity(_ value: String?) -> Bool {
        guard let value, value.utf8.count == 64 else { return false }
        return value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private static let allowedCodes: Set<String> = [
        "next_turn_dispatch_failed", "next_turn_dispatcher_unavailable", "queued_submission_id_invalid",
        "codex_native_not_installed", "codex_native_version_unqualified", "codex_native_signature_invalid",
        "codex_native_path_unsafe", "codex_native_notarization_unavailable", "codex_native_execution_terminated",
        "codex_native_launch_unavailable", "codex_native_probe_timeout", "codex_native_probe_output_invalid",
        "codex_native_binary_changed", "codex_native_guard_unavailable", "codex_native_execution_uncertain",
        "codex_native_execution_in_progress", "codex_queue_executable_unavailable", "codex_queue_process_unavailable",
        "codex_queue_process_failed", "codex_queue_process_timeout", "codex_queue_output_invalid",
        "codex_queue_process_output_invalid", "codex_queue_process_output_too_large",
        "codex_queue_session_mismatch", "codex_queue_submission_id_invalid", "codex_queue_output_too_large",
        "product_access_changed", "product_access_required", "product_access_denied", "product_access_unavailable",
        "product_access_signed_out", "product_access_checking", "product_access_suspended",
        "product_access_service_paused", "product_access_social_login_required", "product_access_expired",
    ]
}

/// Local diagnostic history, separate from the authenticated authority journal.
/// It records transport observations, never work completion or replay permission.
public struct CoordinatorNextTurnDispatchRecord: Codable, Sendable, Equatable {
    public enum Outcome: String, Codable, Sendable { case started, accepted, failed }
    public let schemaVersion: Int
    public let continuationID: String
    public let sessionID: String
    public let occurredAt: String
    public let outcome: Outcome
    public let failure: CoordinatorNextTurnDispatchFailure?
    public let queuedSubmissionID: String?

    public init(continuationID: String, sessionID: String, occurredAt: String, outcome: Outcome,
                failure: CoordinatorNextTurnDispatchFailure? = nil, queuedSubmissionID: String? = nil) {
        self.schemaVersion = 1
        self.continuationID = continuationID
        self.sessionID = sessionID
        self.occurredAt = occurredAt
        self.outcome = outcome
        self.failure = failure
        self.queuedSubmissionID = queuedSubmissionID
    }
}

public typealias CoordinatorNextTurnDispatchRecording = @Sendable (CoordinatorNextTurnDispatchRecord) throws -> Void

/// Best-effort observations cannot delay the actor that handles Hook claims.
/// A single worker performs storage I/O; admission holds only a short memory
/// lock. Both the running record and queued records count against the limit.
/// Pending observations can be lost on process exit and never grant authority.
final class CoordinatorDispatchDiagnosticBuffer: @unchecked Sendable {
    static let maximumOutstandingRecords = 128
    static let maximumRecordBytes = 4_096

    private let lock = NSLock()
    private let worker = DispatchQueue(label: "com.biadone.blabee.dispatch-diagnostics", qos: .utility)
    private let recorder: CoordinatorNextTurnDispatchRecording
    private let onFailure: @Sendable () -> Void
    private let capacity: Int
    private var pending: [CoordinatorNextTurnDispatchRecord] = []
    private var outstanding = 0
    private var draining = false

    init(capacity: Int = maximumOutstandingRecords,
         recorder: @escaping CoordinatorNextTurnDispatchRecording,
         onFailure: @escaping @Sendable () -> Void) {
        self.capacity = min(max(1, capacity), Self.maximumOutstandingRecords)
        self.recorder = recorder
        self.onFailure = onFailure
    }

    func enqueue(_ record: CoordinatorNextTurnDispatchRecord) throws {
        guard try JSONEncoder().encode(record).count <= Self.maximumRecordBytes else {
            throw CoordinatorError("dispatch_diagnostic_record_too_large")
        }
        let startWorker = try lock.withLock {
            guard outstanding < capacity else { throw CoordinatorError("dispatch_diagnostic_queue_full") }
            pending.append(record)
            outstanding += 1
            if draining { return false }
            draining = true
            return true
        }
        if startWorker { worker.async { self.drain() } }
    }

    private func takeNext() -> CoordinatorNextTurnDispatchRecord? {
        lock.withLock {
            guard !pending.isEmpty else { draining = false; return nil }
            return pending.removeFirst()
        }
    }

    private func drain() {
        while let record = takeNext() {
            do { try recorder(record) }
            catch { onFailure() }
            lock.withLock { outstanding -= 1 }
        }
    }
}
