import Foundation
import LocalAuthentication
import Security

// The adapter permits tests to inspect exact queries without accessing the user's Keychain.
@MainActor
protocol PetAccountKeychainAccess {
    func copyMatching(_ query: [CFString: Any]) -> (OSStatus, Data?)
    func add(_ attributes: [CFString: Any]) -> OSStatus
    func update(_ query: [CFString: Any], attributes: [CFString: Any]) -> OSStatus
    func delete(_ query: [CFString: Any]) -> OSStatus
}

@MainActor
final class PetKeychainAccountSessionStore: PetAccountSessionStoring {
    let service: String
    private let keychain: any PetAccountKeychainAccess
    private let isValidHost: Bool

    init(
        projectHost: String = PetAccountConfiguration.current.supabaseURL.host!,
        keychain: (any PetAccountKeychainAccess)? = nil
    ) {
        service = "com.biadone.blabee.account.v1.\(projectHost)"
        isValidHost = !projectHost.isEmpty && projectHost.utf8.count <= 253
            && projectHost.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 46 }
        self.keychain = keychain ?? PetSystemAccountKeychain()
    }

    func load() throws -> PetAccountSession? {
        var query = try baseQuery()
        query[kSecMatchLimit] = kSecMatchLimitOne
        query[kSecReturnData] = kCFBooleanTrue
        let (status, data) = keychain.copyMatching(query)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data, data.count <= 262_144,
              let session = try? JSONDecoder().decode(PetAccountSession.self, from: data), session.isValid
        else { throw PetAccountAuthError.storageUnavailable }
        return session
    }

    func save(_ session: PetAccountSession) throws {
        guard session.isValid else { throw PetAccountAuthError.storageUnavailable }
        let query = try baseQuery()
        guard let data = try? JSONEncoder().encode(session) else { throw PetAccountAuthError.storageUnavailable }
        let updates: [CFString: Any] = [kSecValueData: data]
        let updateStatus = keychain.update(query, attributes: updates)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else { throw PetAccountAuthError.storageUnavailable }
        var attributes = query
        updates.forEach { attributes[$0.key] = $0.value }
        let addStatus = keychain.add(attributes)
        if addStatus == errSecSuccess { return }
        // Another app instance may have created the same narrowly scoped item since update.
        if addStatus == errSecDuplicateItem, keychain.update(query, attributes: updates) == errSecSuccess { return }
        throw PetAccountAuthError.storageUnavailable
    }

    func clear() throws {
        let status = keychain.delete(try baseQuery())
        guard status == errSecSuccess || status == errSecItemNotFound else { throw PetAccountAuthError.storageUnavailable }
    }

    private func baseQuery() throws -> [CFString: Any] {
        guard isValidHost else { throw PetAccountAuthError.storageUnavailable }
        // Classic macOS login Keychain uses its code-signing ACL. With no data-
        // protection Keychain entitlement, iOS accessibility attributes do not apply.
        // Explicitly disable synchronization without claiming device-only semantics.
        let context = LAContext()
        context.interactionNotAllowed = true
        return [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: "session",
            kSecAttrSynchronizable: kCFBooleanFalse as Any,
            kSecUseAuthenticationContext: context,
        ]
    }
}

@MainActor
private final class PetSystemAccountKeychain: PetAccountKeychainAccess {
    func copyMatching(_ query: [CFString: Any]) -> (OSStatus, Data?) {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return (status, result as? Data)
    }

    func add(_ attributes: [CFString: Any]) -> OSStatus { SecItemAdd(attributes as CFDictionary, nil) }

    func update(_ query: [CFString: Any], attributes: [CFString: Any]) -> OSStatus {
        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    }

    func delete(_ query: [CFString: Any]) -> OSStatus { SecItemDelete(query as CFDictionary) }
}
