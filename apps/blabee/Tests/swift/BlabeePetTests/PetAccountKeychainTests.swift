import Foundation
import LocalAuthentication
import Security
import Testing
@testable import BlabeeCoordinator

@Suite("Isolated native account Keychain storage")
@MainActor
struct PetAccountKeychainTests {
    @Test("Writes and reads only a non-synchronizing project account item")
    func roundTrip() throws {
        let fake = MemoryAccountKeychain()
        let store = PetKeychainAccountSessionStore(projectHost: "test-project.supabase.co", keychain: fake)
        #expect(try store.load() == nil)
        try store.save(session())
        #expect(try store.load() == session())
        #expect(fake.addCalls == 1)
        #expect(store.service == "com.biadone.blabee.account.v1.test-project.supabase.co")
        for query in fake.queries {
            #expect(query[kSecAttrService] as? String == store.service)
            #expect(query[kSecAttrAccount] as? String == "session")
            #expect(query[kSecClass] as? String == kSecClassGenericPassword as String)
            #expect(query[kSecAttrSynchronizable] as? Bool == false)
            #expect((query[kSecUseAuthenticationContext] as? LAContext)?.interactionNotAllowed == true)
            #expect(!(query[kSecAttrService] as? String ?? "").contains("coordinator.freshness"))
        }
        #expect(fake.lastAttributes[kSecAttrAccessible] == nil)
        #expect(fake.lastAttributes[kSecUseDataProtectionKeychain] == nil)
    }

    @Test("Saving rotation updates the one item and never deletes existing credentials first")
    func rotates() throws {
        let fake = MemoryAccountKeychain()
        let store = PetKeychainAccountSessionStore(keychain: fake)
        try store.save(session())
        let renewed = session(refresh: "replacement-refresh")
        try store.save(renewed)
        #expect(try store.load() == renewed)
        #expect(fake.addCalls == 1)
        #expect(fake.deleteCalls == 0)
    }

    @Test("Logout deletes only the project session and is idempotent")
    func clears() throws {
        let fake = MemoryAccountKeychain()
        let store = PetKeychainAccountSessionStore(keychain: fake)
        try store.save(session())
        try store.clear()
        try store.clear()
        #expect(try store.load() == nil)
        #expect(fake.deleteCalls == 2)
    }

    @Test("Expired access tokens remain available for refresh")
    func expiredSession() throws {
        let fake = MemoryAccountKeychain()
        let store = PetKeychainAccountSessionStore(keychain: fake)
        let expired = session(expiry: Date(timeIntervalSince1970: 1_000))
        try store.save(expired)
        #expect(try store.load() == expired)
    }

    @Test("Locked or corrupt Keychain data is a typed failure without deletion", arguments: ["locked", "corrupt", "malformed"])
    func loadFailure(_ kind: String) throws {
        let fake = MemoryAccountKeychain()
        let store = PetKeychainAccountSessionStore(keychain: fake)
        if kind == "locked" { fake.failure = errSecInteractionNotAllowed }
        else if kind == "corrupt" { fake.data = Data("not json".utf8) }
        else { fake.data = try JSONEncoder().encode(session(userID: "not-uuid")) }
        #expect(throws: PetAccountAuthError.storageUnavailable) { try store.load() }
        #expect(fake.deleteCalls == 0)
    }

    @Test("Failed update never falls back to deleting or adding credentials")
    func updateFailure() throws {
        let fake = MemoryAccountKeychain()
        let store = PetKeychainAccountSessionStore(keychain: fake)
        try store.save(session())
        fake.failure = errSecInteractionNotAllowed
        #expect(throws: PetAccountAuthError.storageUnavailable) { try store.save(session(refresh: "new")) }
        #expect(fake.addCalls == 1)
        #expect(fake.deleteCalls == 0)
        fake.failure = nil
        #expect(try store.load() == session())
    }

    @Test("A concurrent insert is retried with an exact-item update")
    func duplicateInsert() throws {
        let fake = MemoryAccountKeychain()
        fake.simulateConcurrentInsert = true
        let store = PetKeychainAccountSessionStore(keychain: fake)
        try store.save(session())
        #expect(try store.load() == session())
        #expect(fake.updateCalls == 2)
        #expect(fake.deleteCalls == 0)
    }

    @Test("Invalid namespace or session makes no Security calls")
    func rejectsInvalidInput() {
        let fake = MemoryAccountKeychain()
        let store = PetKeychainAccountSessionStore(projectHost: "evil/path", keychain: fake)
        #expect(throws: PetAccountAuthError.storageUnavailable) { try store.load() }
        #expect(throws: PetAccountAuthError.storageUnavailable) { try store.save(session()) }
        #expect(throws: PetAccountAuthError.storageUnavailable) { try store.clear() }
        let validStore = PetKeychainAccountSessionStore(keychain: fake)
        #expect(throws: PetAccountAuthError.storageUnavailable) { try validStore.save(session(refresh: "")) }
        #expect(fake.queries.isEmpty)
    }

    private func session(refresh: String = "refresh-fixture", expiry: Date = Date(timeIntervalSince1970: 1_800_003_600), userID: String = "12345678-1234-4234-8234-123456789012") -> PetAccountSession {
        PetAccountSession(accessToken: "access-fixture", refreshToken: refresh, expiresAt: expiry,
                          user: PetAccountUser(id: userID, email: "user@example.com"))
    }
}

@MainActor
private final class MemoryAccountKeychain: PetAccountKeychainAccess {
    var data: Data?
    var failure: OSStatus?
    var simulateConcurrentInsert = false
    var queries: [[CFString: Any]] = []
    var lastAttributes: [CFString: Any] = [:]
    var addCalls = 0
    var updateCalls = 0
    var deleteCalls = 0

    func copyMatching(_ query: [CFString: Any]) -> (OSStatus, Data?) {
        queries.append(query)
        if let failure { return (failure, nil) }
        return (data == nil ? errSecItemNotFound : errSecSuccess, data)
    }

    func add(_ attributes: [CFString: Any]) -> OSStatus {
        queries.append(attributes)
        addCalls += 1
        if let failure { return failure }
        if simulateConcurrentInsert {
            simulateConcurrentInsert = false
            data = Data("concurrent data".utf8)
            return errSecDuplicateItem
        }
        guard data == nil else { return errSecDuplicateItem }
        data = attributes[kSecValueData] as? Data
        lastAttributes = attributes
        return errSecSuccess
    }

    func update(_ query: [CFString: Any], attributes: [CFString: Any]) -> OSStatus {
        queries.append(query)
        updateCalls += 1
        if let failure { return failure }
        guard data != nil else { return errSecItemNotFound }
        data = attributes[kSecValueData] as? Data
        lastAttributes = attributes
        return errSecSuccess
    }

    func delete(_ query: [CFString: Any]) -> OSStatus {
        queries.append(query)
        deleteCalls += 1
        if let failure { return failure }
        guard data != nil else { return errSecItemNotFound }
        data = nil
        return errSecSuccess
    }
}
