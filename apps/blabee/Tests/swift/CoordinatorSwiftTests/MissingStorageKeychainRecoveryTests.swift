import Darwin
import Foundation
import LocalAuthentication
import Security
import Testing
@testable import CoordinatorSwift

private final class KeychainRecoveryTestAuthority: StorageRecoveryAuthority {}

private struct RecoveryKeychainItem {
    let value: Data
    let revision: Data
    let accountMatches: Bool
    let serviceMatches: Bool
}

private func requireRecoveryTestAccount(_ account: String) throws {
    let prefix = "test-recovery-"
    guard account.hasPrefix(prefix), account != "primary",
          let identifier = UUID(uuidString: String(account.dropFirst(prefix.count))),
          account == prefix + identifier.uuidString
    else { throw CoordinatorError("test_recovery_keychain_unsafe_namespace") }
}

private func recoveryTestKeychainQuery(account: String, service: String) throws -> [CFString: Any] {
    try requireRecoveryTestAccount(account)
    let base = KeychainFreshnessAnchorStore.defaultService
    let archivePrefix = base + ".archived-"
    let isArchive = service.hasPrefix(archivePrefix)
        && UUID(uuidString: String(service.dropFirst(archivePrefix.count))) != nil
    guard service == base || isArchive else {
        throw CoordinatorError("test_recovery_keychain_unsafe_namespace")
    }
    let context = LAContext()
    context.interactionNotAllowed = true
    return [
        kSecClass: kSecClassGenericPassword,
        kSecAttrAccount: account,
        kSecAttrService: service,
        kSecAttrSynchronizable: kCFBooleanFalse as Any,
        kSecUseAuthenticationContext: context,
    ]
}

private func recoveryTestKeychainItem(account: String, service: String) throws -> RecoveryKeychainItem? {
    var query = try recoveryTestKeychainQuery(account: account, service: service)
    query[kSecMatchLimit] = kSecMatchLimitOne
    query[kSecReturnAttributes] = kCFBooleanTrue
    query[kSecReturnData] = kCFBooleanTrue
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let item = result as? NSDictionary,
          let value = item[kSecValueData] as? Data,
          let revision = item[kSecAttrGeneric] as? Data
    else { throw CoordinatorError("test_recovery_keychain_read_failed") }
    return RecoveryKeychainItem(
        value: value,
        revision: revision,
        accountMatches: item[kSecAttrAccount] as? String == account,
        serviceMatches: item[kSecAttrService] as? String == service
    )
}

private func cleanupRecoveryTestKeychainItem(account: String, service: String) {
    do {
        // This guard is deliberately adjacent to SecItemDelete. Even a test
        // failure may only remove this invocation's unique test account.
        try requireRecoveryTestAccount(account)
        let query = try recoveryTestKeychainQuery(account: account, service: service)
        let status = SecItemDelete(query as CFDictionary)
        let removed = status == errSecSuccess || status == errSecItemNotFound
        #expect(removed)
    } catch {
        Issue.record("Unique recovery test Keychain item cleanup was refused or failed")
    }
}

private func bootstrapRecoveryKeychainStorage(database: URL, key: URL, store: KeychainFreshnessAnchorStore) throws {
    let journal = try SQLiteJournal(databaseURL: database, keyURL: key, freshnessStore: store)
    let empty = try journal.load().journalSequence == 0
    #expect(empty)
    // No journal escapes the function, so its SQLite handle closes before the
    // caller removes only this test's database and key files.
}

private func recoveryKeychainTestStep<T>(
    _ phase: String,
    storage: URL,
    operation: () throws -> T
) throws -> T {
    do { return try operation() }
    catch let error as CoordinatorError {
        // Only known fixture entry names and filesystem metadata are included.
        // Never inspect/log the key, SQLite content, or any Keychain bytes.
        let entries: [(String, URL)] = [("storage", storage)] +
            ["coordinator.sqlite3", "coordinator.key", "coordinator.sqlite3-wal", "coordinator.sqlite3-shm", "coordinator.sqlite3-journal"]
                .map { ($0, storage.appendingPathComponent($0)) }
        let metadata = entries.map { label, path in
            var info = stat()
            guard lstat(path.path, &info) == 0 else { return "\(label)=absent" }
            let mode = String(info.st_mode & 0o777, radix: 8)
            let kind = String(info.st_mode & mode_t(S_IFMT), radix: 8)
            return "\(label)=type:\(kind),mode:\(mode),links:\(info.st_nlink),owned:\(info.st_uid == geteuid())"
        }.joined(separator: ";")
        throw CoordinatorError(error.code, "\(phase): \(error.message); \(metadata)")
    }
}

@Test(
    "Opt-in real Keychain recovery archives only a unique test item in place",
    .enabled(if: ProcessInfo.processInfo.environment["BLABEE_TEST_RECOVERY_KEYCHAIN"] == "1")
)
func missingStorageKeychainRecoveryArchivesUniqueTestItem() throws {
    guard ProcessInfo.processInfo.environment["BLABEE_TEST_RECOVERY_KEYCHAIN"] == "1" else { return }
    let account = "test-recovery-" + UUID().uuidString
    try requireRecoveryTestAccount(account)
    let primaryService = KeychainFreshnessAnchorStore.defaultService
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("blabee-keychain-recovery-test-" + UUID().uuidString)
        .resolvingSymlinksInPath()
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    defer {
        do { try FileManager.default.removeItem(at: root) }
        catch { Issue.record("Unique recovery test directory cleanup failed") }
    }
    var archivedServices: [String] = []
    defer {
        cleanupRecoveryTestKeychainItem(account: account, service: primaryService)
        for service in archivedServices {
            cleanupRecoveryTestKeychainItem(account: account, service: service)
        }
    }
    let store = try KeychainFreshnessAnchorStore(account: account, allowsTestDeletion: true)
    let storage = root.appendingPathComponent("storage")
    let database = storage.appendingPathComponent("coordinator.sqlite3")
    let key = storage.appendingPathComponent("coordinator.key")
    try bootstrapRecoveryKeychainStorage(database: database, key: key, store: store)
    guard let original = try recoveryTestKeychainItem(account: account, service: primaryService) else {
        throw CoordinatorError("test_recovery_keychain_read_failed")
    }
    let originalAttributesMatch = original.accountMatches && original.serviceMatches
    #expect(originalAttributesMatch)

    let wrongRecoveryID = UUID()
    let wrongService = KeychainFreshnessAnchorStore.archivedService(recoveryID: wrongRecoveryID)
    archivedServices.append(wrongService)
    var wrongRevision = original.revision
    guard !wrongRevision.isEmpty else { throw CoordinatorError("test_recovery_keychain_read_failed") }
    wrongRevision[wrongRevision.startIndex] ^= 0xff
    do {
        try store.archive(expectedRevision: wrongRevision, recoveryID: wrongRecoveryID)
        Issue.record("A mismatched recovery revision unexpectedly archived the test item")
    } catch let error as CoordinatorError {
        let rejectedRevision = error.code == "freshness_transition_mismatch"
        #expect(rejectedRevision)
    }
    let wrongArchiveAbsent = try recoveryTestKeychainItem(account: account, service: wrongService) == nil
    let originalStillPresent = try recoveryTestKeychainItem(account: account, service: primaryService) != nil
    #expect(wrongArchiveAbsent)
    #expect(originalStillPresent)

    try FileManager.default.removeItem(at: database)
    try FileManager.default.removeItem(at: key)
    let engine = MissingStorageRecovery(
        databaseURL: database,
        keyURL: key,
        backupRootURL: root.appendingPathComponent("recovery"),
        freshnessStore: store,
        acquireAuthority: { KeychainRecoveryTestAuthority() }
    )
    let plan = try recoveryKeychainTestStep("prepare", storage: storage) { try engine.prepare() }
    archivedServices.append(plan.archivedAnchorService)
    let receipt = try recoveryKeychainTestStep("execute", storage: storage) { try engine.execute(plan) }
    let primaryAbsent = try recoveryTestKeychainItem(account: account, service: primaryService) == nil
    #expect(primaryAbsent)
    guard let archived = try recoveryTestKeychainItem(account: account, service: receipt.archivedAnchorService) else {
        throw CoordinatorError("test_recovery_keychain_read_failed")
    }
    // Compare privately computed booleans, so a failed assertion never prints
    // Keychain value bytes or revision bytes.
    let archivedAttributesMatch = archived.accountMatches && archived.serviceMatches
    let sameValue = archived.value == original.value
    let sameRevision = archived.revision == original.revision
    #expect(archivedAttributesMatch)
    #expect(sameValue)
    #expect(sameRevision)
    #expect(receipt.completionRecordWritten)

    try bootstrapRecoveryKeychainStorage(database: database, key: key, store: store)
    guard let freshPrimary = try recoveryTestKeychainItem(account: account, service: primaryService),
          let retainedArchive = try recoveryTestKeychainItem(account: account, service: receipt.archivedAnchorService)
    else { throw CoordinatorError("test_recovery_keychain_read_failed") }
    let newPrimaryMatchesAccount = freshPrimary.accountMatches && freshPrimary.serviceMatches
    let newPrimaryHasDistinctRecord = freshPrimary.value != original.value
    let originalArchivePreserved = retainedArchive.value == original.value
        && retainedArchive.revision == original.revision
        && retainedArchive.accountMatches
        && retainedArchive.serviceMatches
    #expect(newPrimaryMatchesAccount)
    #expect(newPrimaryHasDistinctRecord)
    #expect(originalArchivePreserved)
}
