#if BLABEE_JOURNAL_TEST_HARNESS
import CoordinatorSwift
import Foundation

/// Process-local freshness state for the operational round-trip fixture.
/// This type is not present in product builds and never calls Security APIs.
final class RoundTripHarnessFreshnessAnchorStore: FreshnessAnchorStore, @unchecked Sendable {
    let storageSlot = "test-t011-operational-roundtrip"

    private let lock = NSLock()
    private var stored: FreshnessStoredRecord?

    func load() throws -> FreshnessStoredRecord? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard stored == nil else {
            throw CoordinatorError("freshness_anchor_conflict")
        }
        guard record.storageSlot == storageSlot else {
            throw CoordinatorError("freshness_anchor_corrupt")
        }
        let created = try FreshnessStoredRecord(
            record: record,
            revision: record.revision
        )
        stored = created
        return created
    }

    func compareAndSwap(
        expectedRevision: Data,
        replacement: FreshnessRecord
    ) throws -> FreshnessStoredRecord {
        lock.lock()
        defer { lock.unlock() }
        guard let current = stored, current.revision == expectedRevision else {
            throw CoordinatorError("freshness_anchor_conflict")
        }
        guard replacement.storageSlot == storageSlot else {
            throw CoordinatorError("freshness_anchor_corrupt")
        }
        let updated = try FreshnessStoredRecord(
            record: replacement,
            revision: replacement.revision
        )
        stored = updated
        return updated
    }
}

/// Records CSPRNG token material only in memory, then audits SQLite artifacts
/// after the UDS server stops. No raw value is printed or written by the test.
final class RoundTripHarnessTokenRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [String] = []

    func generate() throws -> ContinuationTokenMaterial {
        let material = try ContinuationTokenMaterial.generate()
        lock.lock()
        tokens.append(material.token)
        lock.unlock()
        return material
    }

    func assertNoRawToken(inDatabaseAt databaseURL: URL) throws {
        lock.lock()
        let observed = tokens
        lock.unlock()
        guard observed.count == 2 else {
            throw CoordinatorError("operational_test_token_missing")
        }
        let artifactURLs = [
            databaseURL,
            URL(fileURLWithPath: databaseURL.path + "-wal"),
            URL(fileURLWithPath: databaseURL.path + "-shm"),
        ]
        for artifactURL in artifactURLs where FileManager.default.fileExists(atPath: artifactURL.path) {
            let bytes = try Data(contentsOf: artifactURL)
            for token in observed where bytes.range(of: Data(token.utf8)) != nil {
                throw CoordinatorError("operational_test_secret_persisted")
            }
        }
    }
}
#endif
