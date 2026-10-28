import CoordinatorSwift
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Storage recovery primary authority")
struct StorageRecoveryAuthorityTests {
    @Test("Primary authority excludes a service at a different database path")
    func differentDatabasesCannotSharePrimary() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-recovery-authority-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let first = root.appendingPathComponent("one/db")
        let second = root.appendingPathComponent("two/db")
        let authority = CoordinatorAuthorityLease.authorityRootURL(homeDirectory: root)
        var lease: CoordinatorAuthorityLease? = try CoordinatorAuthorityLease(
            databaseURL: first, authorityRootURL: authority, includesPrimaryNamespace: true
        )
        #expect(authority.path == root.appendingPathComponent("Library/Application Support/Blabee/runtime/authority").path)
        #expect(FileManager.default.fileExists(atPath: authority.appendingPathComponent("freshness-primary.lock").path))
        #expect(throws: (any Error).self) {
            try CoordinatorAuthorityLease(databaseURL: second, authorityRootURL: authority,
                                          includesPrimaryNamespace: true)
        }
        withExtendedLifetime(lease) {}
        lease = nil
        let next = try CoordinatorAuthorityLease(databaseURL: second, authorityRootURL: authority,
                                                includesPrimaryNamespace: true)
        withExtendedLifetime(next) {}
        #expect(!FileManager.default.fileExists(atPath: first.path))
        #expect(!FileManager.default.fileExists(atPath: second.path))
    }

    @Test("Failure to take DB authority releases the newly taken primary lock")
    func failedSecondLockDoesNotLeakFirst() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("blabee-recovery-authority-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let first = root.appendingPathComponent("one/db")
        let second = root.appendingPathComponent("two/db")
        let authority = root.appendingPathComponent("authority")
        let legacy = try CoordinatorAuthorityLease(databaseURL: first, authorityRootURL: authority,
                                                  includesPrimaryNamespace: false)
        #expect(throws: (any Error).self) {
            try CoordinatorAuthorityLease(databaseURL: first, authorityRootURL: authority,
                                          includesPrimaryNamespace: true)
        }
        let separate = try CoordinatorAuthorityLease(databaseURL: second, authorityRootURL: authority,
                                                    includesPrimaryNamespace: true)
        withExtendedLifetime((legacy, separate)) {}
    }
}
