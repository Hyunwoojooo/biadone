#if BLABEE_JOURNAL_TEST_HARNESS
import CoordinatorSwift
import Foundation

/// A compile-time-only transport fixture. It keeps UDS ownership, allowlist,
/// and concurrency tests away from the product Keychain and SQLite runtime.
actor FixtureTransportHandler: CoordinatorOperationalHandling {
    private var schedulerPasses = 0

    func handle(type: String, payload: Data) async throws -> Data {
        let object = try StrictJSONTransport.object(
            from: payload,
            limits: StrictJSONLimits(maximumBytes: 1_048_576, maximumDepth: 72)
        )
        if let delay = object["fixture_delay_ms"] as? Int, delay > 0 {
            try await Task.sleep(for: .milliseconds(Int64(min(delay, 2_000))))
        }
        return try StrictJSONTransport.data(forJSONObject: [
            "fixture": "ok",
            "handled_type": type,
            "scheduler_passes": schedulerPasses,
        ])
    }

    func processTime() async throws -> [Data] {
        schedulerPasses += 1
        return []
    }

    func millisecondsUntilNextDeadline() async -> Int32? {
        25
    }
}
#endif
