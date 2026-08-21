import CryptoKit
import Darwin
import Foundation
import Security

public struct StorageKey: Sendable {
    let bytes: Data

    init(bytes: Data) throws {
        try require(bytes.count == 32, "storage_key_invalid", "storage key must contain exactly 32 bytes")
        self.bytes = bytes
    }
}

public enum ExternalStorageKeyStore {
    public static func loadOrCreate(at keyURL: URL, allowCreate: Bool) throws -> StorageKey {
        let parent = try openSecureParent(keyURL.deletingLastPathComponent())
        defer { close(parent) }
        let name = keyURL.lastPathComponent
        try require(
            !name.isEmpty && name != "." && name != ".." && !name.contains("/"),
            "storage_key_invalid",
            "storage key filename is invalid"
        )
        if entryExists(parent: parent, name: name) {
            return try load(parent: parent, name: name)
        }
        try require(allowCreate, "storage_key_invalid", "storage key is missing for an existing database")
        try createAtomically(parent: parent, name: name)
        return try load(parent: parent, name: name)
    }

    private static func openSecureParent(_ parent: URL) throws -> Int32 {
        let path = normalizedSystemAlias(parent.standardizedFileURL.path)
        try require(path.hasPrefix("/"), "storage_key_invalid", "key parent must be absolute")
        let components = path.split(separator: "/").map(String.init)
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else { throw CoordinatorError("storage_key_invalid", "cannot open filesystem root") }

        do {
            for component in components {
                var next = openat(
                    descriptor,
                    component,
                    O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                )
                if next < 0 && errno == ENOENT {
                    guard mkdirat(descriptor, component, mode_t(0o700)) == 0 || errno == EEXIST else {
                        throw CoordinatorError("storage_key_invalid", "cannot create key parent")
                    }
                    next = openat(
                        descriptor,
                        component,
                        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
                    )
                }
                guard next >= 0 else {
                    throw CoordinatorError("storage_key_invalid", "key path contains an unsafe component")
                }
                close(descriptor)
                descriptor = next
            }
        } catch {
            close(descriptor)
            throw error
        }

        var info = stat()
        guard fstat(descriptor, &info) == 0 else {
            close(descriptor)
            throw CoordinatorError("storage_key_invalid", "cannot inspect key parent")
        }
        let type = info.st_mode & mode_t(S_IFMT)
        let permissions = info.st_mode & 0o777
        do {
            try require(type == mode_t(S_IFDIR), "storage_key_invalid", "key parent must be a real directory")
            try require(permissions == 0o700, "storage_key_invalid", "key parent permissions must be 0700")
            try require(info.st_uid == geteuid(), "storage_key_invalid", "key parent owner mismatch")
        } catch {
            close(descriptor)
            throw error
        }
        return descriptor
    }

    private static func load(parent: Int32, name: String) throws -> StorageKey {
        let descriptor = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw CoordinatorError("storage_key_invalid", "cannot open storage key") }
        defer { close(descriptor) }
        var info = stat()
        guard fstat(descriptor, &info) == 0 else { throw CoordinatorError("storage_key_invalid", "cannot inspect storage key") }
        let type = info.st_mode & mode_t(S_IFMT)
        let permissions = info.st_mode & 0o777
        try require(type == mode_t(S_IFREG), "storage_key_invalid", "storage key must be a regular non-symlink file")
        try require(permissions == 0o600, "storage_key_invalid", "storage key permissions must be 0600")
        try require(info.st_uid == geteuid(), "storage_key_invalid", "storage key owner mismatch")
        try require(info.st_size == 32, "storage_key_invalid", "storage key size is invalid")

        var bytes = [UInt8](repeating: 0, count: 32)
        var offset = 0
        while offset < bytes.count {
            let remaining = bytes.count - offset
            let count = bytes.withUnsafeMutableBytes { pointer in
                read(descriptor, pointer.baseAddress!.advanced(by: offset), remaining)
            }
            guard count > 0 else { throw CoordinatorError("storage_key_invalid", "cannot read complete storage key") }
            offset += count
        }
        var extra: UInt8 = 0
        try require(read(descriptor, &extra, 1) == 0, "storage_key_invalid", "storage key contains extra bytes")
        return try StorageKey(bytes: Data(bytes))
    }

    private static func createAtomically(parent: Int32, name: String) throws {
        let temporaryName = ".\(name).\(UUID().uuidString).tmp"
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
            throw CoordinatorError("storage_key_invalid", "secure random generation failed")
        }

        let descriptor = openat(
            parent,
            temporaryName,
            O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
            mode_t(0o600)
        )
        guard descriptor >= 0 else { throw CoordinatorError("storage_key_invalid", "cannot create storage key") }
        var descriptorOpen = true
        defer {
            if descriptorOpen { close(descriptor) }
            _ = unlinkat(parent, temporaryName, 0)
            _ = random.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) }
        }

        var offset = 0
        while offset < random.count {
            let count = random.withUnsafeBytes { pointer in
                write(descriptor, pointer.baseAddress!.advanced(by: offset), random.count - offset)
            }
            guard count > 0 else { throw CoordinatorError("storage_key_invalid", "cannot write storage key") }
            offset += count
        }
        guard fsync(descriptor) == 0 else { throw CoordinatorError("storage_key_invalid", "cannot fsync storage key") }
        guard close(descriptor) == 0 else { throw CoordinatorError("storage_key_invalid", "cannot close storage key") }
        descriptorOpen = false

        if linkat(parent, temporaryName, parent, name, 0) != 0 && errno != EEXIST {
            throw CoordinatorError("storage_key_invalid", "cannot publish storage key")
        }
        _ = unlinkat(parent, temporaryName, 0)
        guard fsync(parent) == 0 else { throw CoordinatorError("storage_key_invalid", "cannot fsync key parent") }
    }

    private static func entryExists(parent: Int32, name: String) -> Bool {
        var info = stat()
        return fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) == 0
    }

    private static func normalizedSystemAlias(_ path: String) -> String {
        if path == "/var" { return "/private/var" }
        if path.hasPrefix("/var/") { return "/private" + path }
        if path == "/tmp" { return "/private/tmp" }
        if path.hasPrefix("/tmp/") { return "/private" + path }
        return path
    }
}

struct SidecarAuthenticator: Sendable {
    static let eventDomain = "blabee.runtime-event.v1"
    static let eventAnchorDomain = "blabee.runtime-event-anchor.v1"
    static let packetDomain = "blabee.packet-document.v1"
    static let verificationDomain = "blabee.verification-record.v1"
    static let keyVerifierDomain = "blabee.storage-key-verifier.v1"

    private let key: SymmetricKey

    init(storageKey: StorageKey) {
        key = SymmetricKey(data: storageKey.bytes)
    }

    func authenticationCode(domain: String, identity: String, canonicalJSON: Data) -> Data {
        let message = authenticatedMessage(domain: domain, identity: identity, payload: canonicalJSON)
        return Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
    }

    func verify(
        _ code: Data,
        domain: String,
        identity: String,
        canonicalJSON: Data
    ) -> Bool {
        let message = authenticatedMessage(domain: domain, identity: identity, payload: canonicalJSON)
        return HMAC<SHA256>.isValidAuthenticationCode(code, authenticating: message, using: key)
    }

    private func authenticatedMessage(domain: String, identity: String, payload: Data) -> Data {
        var data = Data()
        append(Data(domain.utf8), to: &data)
        append(Data(identity.utf8), to: &data)
        append(payload, to: &data)
        return data
    }

    private func append(_ field: Data, to output: inout Data) {
        var length = UInt64(field.count).bigEndian
        withUnsafeBytes(of: &length) { output.append(contentsOf: $0) }
        output.append(field)
    }
}
