import Foundation
import Security

public final class KeychainFreshnessAnchorStore: FreshnessAnchorStore, @unchecked Sendable {
    public static let defaultService = "com.biadone.blabee.coordinator.freshness.v1"

    public let storageSlot: String
    public let service: String

    private let allowsTestDeletion: Bool

    public init(
        service: String = KeychainFreshnessAnchorStore.defaultService,
        account: String = "primary",
        allowsTestDeletion: Bool = false
    ) throws {
        try require(
            service == Self.defaultService,
            "freshness_anchor_corrupt",
            "unsupported freshness service"
        )
        _ = try FreshnessRecord.initializing(storageSlot: account)
        self.service = service
        storageSlot = account
        self.allowsTestDeletion = allowsTestDeletion
    }

    public func load() throws -> FreshnessStoredRecord? {
        var query = baseQuery()
        query[kSecMatchLimit] = kSecMatchLimitOne
        query[kSecReturnAttributes] = kCFBooleanTrue
        query[kSecReturnData] = kCFBooleanTrue
        query[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw unavailable(status) }
        guard let attributes = result as? NSDictionary,
              let value = attributes[kSecValueData] as? Data,
              let revision = attributes[kSecAttrGeneric] as? Data
        else {
            throw CoordinatorError("freshness_anchor_corrupt", "Keychain freshness item shape is invalid")
        }
        let record = try FreshnessRecord.decode(value, expectedStorageSlot: storageSlot)
        return try FreshnessStoredRecord(record: record, revision: revision)
    }

    public func create(_ record: FreshnessRecord) throws -> FreshnessStoredRecord {
        try require(
            record.storageSlot == storageSlot,
            "freshness_anchor_corrupt",
            "freshness storage slot mismatch"
        )
        let value = try record.encoded()
        let revision = try record.revision
        var attributes = baseQuery()
        attributes[kSecValueData] = value
        attributes[kSecAttrGeneric] = revision
        attributes[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            throw CoordinatorError("freshness_transition_mismatch", "freshness anchor already exists")
        }
        guard status == errSecSuccess else { throw unavailable(status) }
        return try readBack(expectedRecord: record, expectedRevision: revision)
    }

    public func compareAndSwap(
        expectedRevision: Data,
        replacement: FreshnessRecord
    ) throws -> FreshnessStoredRecord {
        try require(
            expectedRevision.count == 32,
            "freshness_anchor_corrupt",
            "expected freshness revision is invalid"
        )
        try require(
            replacement.storageSlot == storageSlot,
            "freshness_anchor_corrupt",
            "freshness storage slot mismatch"
        )
        let value = try replacement.encoded()
        let revision = try replacement.revision
        var query = baseQuery()
        query[kSecAttrGeneric] = expectedRevision
        query[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail
        let updates: [CFString: Any] = [
            kSecValueData: value,
            kSecAttrGeneric: revision,
        ]
        let status = SecItemUpdate(query as CFDictionary, updates as CFDictionary)
        if status == errSecItemNotFound {
            throw CoordinatorError("freshness_transition_mismatch", "freshness compare-and-swap lost")
        }
        guard status == errSecSuccess else { throw unavailable(status) }
        return try readBack(expectedRecord: replacement, expectedRevision: revision)
    }

    public func deleteForTesting() throws {
        try require(
            allowsTestDeletion && storageSlot.hasPrefix("test-") && storageSlot != "primary",
            "invalid_arguments",
            "Keychain deletion is restricted to an explicit test namespace"
        )
        var query = baseQuery()
        query[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw unavailable(status) }
    }

    private func readBack(
        expectedRecord: FreshnessRecord,
        expectedRevision: Data
    ) throws -> FreshnessStoredRecord {
        guard let stored = try load() else {
            throw CoordinatorError("freshness_transition_mismatch", "freshness anchor disappeared after write")
        }
        try require(
            stored.record == expectedRecord && stored.revision == expectedRevision,
            "freshness_transition_mismatch",
            "freshness anchor changed during write verification"
        )
        return stored
    }

    private func baseQuery() -> [CFString: Any] {
        [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: storageSlot,
            kSecAttrSynchronizable: kCFBooleanFalse as Any,
        ]
    }

    private func unavailable(_ status: OSStatus) -> CoordinatorError {
        CoordinatorError(Self.classifyStatusForTesting(status), "Keychain freshness operation failed")
    }

    static func classifyStatusForTesting(_ status: OSStatus) -> String {
        switch status {
        case errSecDecode, errSecInvalidKeychain:
            "freshness_anchor_corrupt"
        default:
            "freshness_anchor_unavailable"
        }
    }
}
