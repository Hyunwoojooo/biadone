import ClaudeCoreAdapter
import CoordinatorSwift
import CryptoKit
import Darwin
import Foundation

/// The existing Codex application remains the owner of its public operations.
/// Claude receives a separate, explicitly enabled capability boundary and store.
final class ClaudeBridgeCoordinator: CoordinatorOperationalHandling, @unchecked Sendable {
    static let requestType = "claude_bridge_v1"

    private let codex: any CoordinatorOperationalHandling
    private let ingress: ClaudeBridgeIngress?
    private let leases: [CoordinatorAuthorityLease]
    private let bootstrapUnavailable: Bool

    init(
        codex: any CoordinatorOperationalHandling,
        configurationURL: URL?,
        configurationRequired: Bool,
        secretCorpus: RuntimeSecretCorpus,
        freshnessFactory: (String) throws -> any FreshnessAnchorStore = {
            try KeychainFreshnessAnchorStore(account: $0)
        }
    ) throws {
        self.codex = codex
        do {
            let runtime = try Self.prepare(
                configurationURL: configurationURL,
                configurationRequired: configurationRequired,
                secretCorpus: secretCorpus,
                freshnessFactory: freshnessFactory
            )
            ingress = runtime?.ingress
            leases = runtime?.leases ?? []
            bootstrapUnavailable = false
        } catch {
            // A stale optional Claude enrollment must not take the Codex app
            // offline. Explicit CLI opt-in remains strict for troubleshooting.
            if configurationRequired { throw error }
            ingress = nil
            leases = []
            bootstrapUnavailable = true
        }
    }

    private static func prepare(
        configurationURL: URL?, configurationRequired: Bool,
        secretCorpus: RuntimeSecretCorpus,
        freshnessFactory: (String) throws -> any FreshnessAnchorStore
    ) throws -> (ingress: ClaudeBridgeIngress, leases: [CoordinatorAuthorityLease])? {
        guard let configurationURL,
              let configuration = try ClaudeBridgeConfiguration.load(
                at: configurationURL, required: configurationRequired
              )
        else {
            return nil
        }
        // Validate all identities/credentials before creating any Claude store.
        try ClaudeBridgeIngress.validateScopes(configuration.scopes)
        for scope in configuration.scopes {
            secretCorpus.register(scope.bridgeToken)
            secretCorpus.register(scope.selectionToken)
        }
        let storageRoot = try ClaudeBridgeConfiguration.privateChild(
            of: configuration.directory, name: "claude-stores"
        )
        let authorityRoot = try ClaudeBridgeConfiguration.privateChild(
            of: configuration.directory, name: "claude-authority"
        )
        var adapters: [String: ClaudeCoreAdapter] = [:]
        var ownedLeases: [CoordinatorAuthorityLease] = []
        for scope in configuration.scopes {
            let store = try ClaudeBridgeConfiguration.privateChild(
                of: storageRoot, name: scope.scopeID
            )
            let database = store.appendingPathComponent("coordinator.sqlite3")
            // The slot is tied to this canonical store, never the Codex primary
            // slot or a caller-supplied key/account/path in a UDS request.
            let digest = SHA256.hash(data: Data(database.path.utf8))
                .map { String(format: "%02x", $0) }.joined()
            let lease = try CoordinatorAuthorityLease(
                databaseURL: database, authorityRootURL: authorityRoot,
                includesPrimaryNamespace: false
            )
            let journal = try SQLiteJournal(
                databaseURL: database,
                keyURL: store.appendingPathComponent("coordinator.key"),
                freshnessStore: freshnessFactory("claude-v1-" + digest)
            )
            // All configured capabilities are forbidden in every Claude journal,
            // including a capability belonging to a different authenticated scope.
            for configured in configuration.scopes {
                journal.secretCorpus.register(configured.bridgeToken)
                journal.secretCorpus.register(configured.selectionToken)
            }
            adapters[scope.scopeID] = try ClaudeCoreAdapter(journal: journal)
            ownedLeases.append(lease)
        }
        let ingress = try ClaudeBridgeIngress(
            scopes: configuration.scopes, adapters: adapters, secretCorpus: secretCorpus
        )
        return (ingress, ownedLeases)
    }

    func handle(type: String, payload: Data) async throws -> Data {
        if type == Self.requestType {
            guard let ingress else {
                throw CoordinatorError(bootstrapUnavailable ? "claude_bridge_unavailable" : "claude_bridge_disabled")
            }
            return try ingress.handle(payload: payload)
        }
        return try await codex.handle(type: type, payload: payload)
    }

    func doctorStatus(payload: Data) async throws -> Data {
        try await codex.doctorStatus(payload: payload)
    }

    func processTime() async throws -> [Data] { try await codex.processTime() }

    func millisecondsUntilNextDeadline() async -> Int32? {
        await codex.millisecondsUntilNextDeadline()
    }
}

/// Trusted local provisioning input, not an unauthenticated registration API.
/// This reader never writes credentials, returns them over UDS, or reads an
/// inherited environment token. A launcher/enrollment flow is a separate step.
struct ClaudeBridgeConfiguration {
    let directory: URL
    let scopes: [ClaudeBridgeScope]
    private static let maximumBytes = 32 * 1024

    static func load(at url: URL, required: Bool) throws -> Self? {
        let canonical = try normalizedURL(url)
        guard let directoryFD = try openDirectory(
            canonical.deletingLastPathComponent(), allowMissing: !required
        ) else { return nil }
        defer { close(directoryFD) }
        let descriptor = openat(
            directoryFD, canonical.lastPathComponent,
            O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else {
            if errno == ENOENT && !required { return nil }
            throw CoordinatorError("claude_bridge_config_unsafe")
        }
        defer { close(descriptor) }
        var initial = stat()
        guard fstat(descriptor, &initial) == 0,
              initial.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              initial.st_mode & 0o7777 == 0o600,
              initial.st_uid == geteuid(), initial.st_nlink == 1,
              initial.st_size > 0, initial.st_size <= maximumBytes
        else { throw CoordinatorError("claude_bridge_config_unsafe") }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = buffer.withUnsafeMutableBytes {
                Darwin.read(descriptor, $0.baseAddress, $0.count)
            }
            if count < 0 {
                if errno == EINTR { continue }
                throw CoordinatorError("claude_bridge_config_unsafe")
            }
            if count == 0 { break }
            guard data.count + count <= maximumBytes else {
                throw CoordinatorError("claude_bridge_config_unsafe")
            }
            data.append(contentsOf: buffer.prefix(count))
        }
        var final = stat()
        var named = stat()
        guard fstat(descriptor, &final) == 0,
              fstatat(directoryFD, canonical.lastPathComponent, &named, AT_SYMLINK_NOFOLLOW) == 0,
              final.st_dev == initial.st_dev, final.st_ino == initial.st_ino,
              named.st_dev == initial.st_dev, named.st_ino == initial.st_ino,
              final.st_mode == initial.st_mode, final.st_uid == initial.st_uid,
              final.st_nlink == 1, final.st_size == initial.st_size,
              final.st_mtimespec.tv_sec == initial.st_mtimespec.tv_sec,
              final.st_mtimespec.tv_nsec == initial.st_mtimespec.tv_nsec,
              data.count == Int(initial.st_size)
        else { throw CoordinatorError("claude_bridge_config_unsafe") }
        let object: [String: Any]
        do {
            object = try StrictJSONTransport.object(
                from: data, limits: StrictJSONLimits(maximumBytes: maximumBytes, maximumDepth: 8)
            )
        } catch { throw CoordinatorError("claude_bridge_config_invalid") }
        guard Set(object.keys) == ["schema_version", "scopes"],
              object["schema_version"] as? String == "blabee.claude-bridge.config.v1",
              let entries = object["scopes"] as? [[String: Any]], entries.count <= 16
        else { throw CoordinatorError("claude_bridge_config_invalid") }
        let dateParser = ISO8601DateFormatter()
        let fractionalDateParser = ISO8601DateFormatter()
        fractionalDateParser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let scopes = try entries.map { item -> ClaudeBridgeScope in
            guard Set(item.keys) == ["scope_id", "project_id", "session_id", "bridge_token",
                                     "selection_token", "expires_at"],
                  let scope = item["scope_id"] as? String,
                  let project = item["project_id"] as? String,
                  let session = item["session_id"] as? String,
                  let bridge = item["bridge_token"] as? String,
                  let selection = item["selection_token"] as? String,
                  let expiry = item["expires_at"] as? String,
                  let expiresAt = fractionalDateParser.date(from: expiry) ?? dateParser.date(from: expiry)
            else { throw CoordinatorError("claude_bridge_config_invalid") }
            return try ClaudeBridgeScope(
                scopeID: scope, projectID: project, sessionID: session,
                bridgeToken: bridge, selectionToken: selection, expiresAt: expiresAt
            )
        }
        try ClaudeBridgeIngress.validateScopes(scopes)
        return Self(directory: canonical.deletingLastPathComponent(), scopes: scopes)
    }

    static func privateChild(of parent: URL, name: String) throws -> URL {
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains("\0"),
              let parentFD = try openDirectory(parent, allowMissing: false)
        else { throw CoordinatorError("claude_bridge_config_unsafe") }
        defer { close(parentFD) }
        guard mkdirat(parentFD, name, mode_t(0o700)) == 0 || errno == EEXIST else {
            throw CoordinatorError("claude_bridge_config_unsafe")
        }
        let child = parent.appendingPathComponent(name, isDirectory: true)
        guard let descriptor = try openDirectory(child, allowMissing: false) else {
            throw CoordinatorError("claude_bridge_config_unsafe")
        }
        close(descriptor)
        return child
    }

    static func normalizedURL(_ url: URL) throws -> URL {
        guard url.isFileURL, url.path.hasPrefix("/"), !url.path.contains("\0") else {
            throw CoordinatorError("claude_bridge_config_unsafe")
        }
        var path = url.standardizedFileURL.path
        if path == "/tmp" || path.hasPrefix("/tmp/") || path == "/var" || path.hasPrefix("/var/") {
            path = "/private" + path
        }
        guard path != "/" else { throw CoordinatorError("claude_bridge_config_unsafe") }
        return URL(fileURLWithPath: path)
    }

    private static func openDirectory(_ url: URL, allowMissing: Bool) throws -> Int32? {
        let path = try normalizedURL(url).path
        var descriptor = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard descriptor >= 0 else { throw CoordinatorError("claude_bridge_config_unsafe") }
        do {
            for component in path.split(separator: "/").map(String.init) {
                let next = openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                if next < 0, errno == ENOENT, allowMissing {
                    close(descriptor)
                    return nil
                }
                guard next >= 0 else { throw CoordinatorError("claude_bridge_config_unsafe") }
                close(descriptor)
                descriptor = next
            }
            var info = stat()
            guard fstat(descriptor, &info) == 0,
                  info.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
                  info.st_mode & 0o7777 == 0o700, info.st_uid == geteuid()
            else { throw CoordinatorError("claude_bridge_config_unsafe") }
            return descriptor
        } catch {
            close(descriptor)
            throw error
        }
    }
}
