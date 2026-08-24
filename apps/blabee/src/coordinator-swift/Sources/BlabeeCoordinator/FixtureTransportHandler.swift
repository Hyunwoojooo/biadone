#if BLABEE_JOURNAL_TEST_HARNESS
import CoordinatorSwift
import Foundation

/// A compile-time-only transport fixture. It keeps UDS ownership, allowlist,
/// and concurrency tests away from the product Keychain and SQLite runtime.
actor FixtureTransportHandler: CoordinatorOperationalHandling {
    private var schedulerAttempts = 0
    private var schedulerPasses = 0
    private var schedulerFailures = 0
    private var schedulerDeadlineMilliseconds: Int32? = 25
    private var schedulerFailuresRemaining = 0
    private var schedulerFailsPersistently = false
    private var schedulerIdlesAfterSuccess = false

    func handle(type: String, payload: Data) async throws -> Data {
        let object = try StrictJSONTransport.object(
            from: payload,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        if object["fixture_scheduler_idle"] as? Bool == true {
            schedulerDeadlineMilliseconds = nil
        }
        if let deadline = object["fixture_scheduler_deadline_ms"] as? Int,
           deadline >= 0,
           deadline <= Int(Int32.max)
        {
            schedulerDeadlineMilliseconds = Int32(deadline)
        }
        if let failures = object["fixture_scheduler_failures_remaining"] as? Int,
           failures >= 0
        {
            schedulerFailuresRemaining = failures
        }
        if let failsPersistently = object["fixture_scheduler_fail_always"] as? Bool {
            schedulerFailsPersistently = failsPersistently
        }
        if let idlesAfterSuccess = object["fixture_scheduler_idle_after_success"] as? Bool {
            schedulerIdlesAfterSuccess = idlesAfterSuccess
        }
        if let delay = object["fixture_delay_ms"] as? Int, delay > 0 {
            try await Task.sleep(for: .milliseconds(Int64(min(delay, 2_000))))
        }
        return try StrictJSONTransport.data(forJSONObject: [
            "fixture": "ok",
            "handled_type": type,
            "scheduler_attempts": schedulerAttempts,
            "scheduler_failures": schedulerFailures,
            "scheduler_passes": schedulerPasses,
        ])
    }

    func doctorStatus(payload: Data) async throws -> Data {
        let object = try StrictJSONTransport.object(
            from: payload,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        guard object.isEmpty else { throw CoordinatorError("doctor_status_payload_invalid") }
        return try StrictJSONTransport.data(forJSONObject: [
            "schema_version": "1.0",
            "kind": "blabee_doctor_status",
            "projects": [],
        ])
    }

    func processTime() async throws -> [Data] {
        schedulerAttempts += 1
        if schedulerFailsPersistently || schedulerFailuresRemaining > 0 {
            schedulerFailuresRemaining = max(0, schedulerFailuresRemaining - 1)
            schedulerFailures += 1
            throw CoordinatorError("fixture_scheduler_failure")
        }
        schedulerPasses += 1
        if schedulerIdlesAfterSuccess {
            schedulerDeadlineMilliseconds = nil
        }
        return []
    }

    func millisecondsUntilNextDeadline() async -> Int32? {
        schedulerDeadlineMilliseconds
    }
}
#endif
