import Dispatch
import Foundation

/// An in-memory, process-lifetime set of secret values the coordinator has
/// actually observed or issued. It deliberately does not claim to discover
/// arbitrary secrets that have never crossed a typed secret boundary.
public final class RuntimeSecretCorpus: @unchecked Sendable {
    private static let minimumSecretLength = 8
    /// Item 13-A (ENG-3): per-proposal and per-delivery tokens leave the
    /// corpus this long after their latest registration. Cards live at most
    /// 10 minutes and a delivery is claimed by its next turn, so a token this
    /// old is spent; scanning for it forever made every scan grow with uptime.
    static let ephemeralLifetimeNanoseconds: UInt64 = 24 * 3_600 * 1_000_000_000
    /// Bounds a burst inside one lifetime; the oldest registration goes first.
    static let maximumEphemeralSecrets = 4_096

    private let lock = NSLock()
    /// Storage keys, account and bridge tokens: kept for the process lifetime.
    private var secrets: [Data] = []
    private var permanentSet: Set<Data> = []
    /// Registration order (oldest first) with the latest registration time.
    private var ephemeral: [(secret: Data, registeredAt: UInt64)] = []
    private var ephemeralSet: Set<Data> = []
    private let monotonicNanoseconds: @Sendable () -> UInt64

    public convenience init() {
        self.init(monotonicNanoseconds: { DispatchTime.now().uptimeNanoseconds })
    }

    init(monotonicNanoseconds: @escaping @Sendable () -> UInt64) {
        self.monotonicNanoseconds = monotonicNanoseconds
    }

    public func register(_ secret: String) {
        register(Data(secret.utf8))
    }

    public func register(_ secret: Data) {
        guard secret.count >= Self.minimumSecretLength else { return }
        lock.lock()
        defer { lock.unlock() }
        if permanentSet.insert(secret).inserted { secrets.append(secret) }
    }

    /// A one-time token (proposal correlation, continuation delivery).
    /// Registering it again refreshes its lifetime.
    public func registerEphemeral(_ secret: String) {
        registerEphemeral(Data(secret.utf8))
    }

    public func registerEphemeral(_ secret: Data) {
        guard secret.count >= Self.minimumSecretLength else { return }
        lock.lock()
        defer { lock.unlock() }
        let now = monotonicNanoseconds()
        if ephemeralSet.contains(secret) {
            ephemeral.removeAll { $0.secret == secret }
        } else {
            ephemeralSet.insert(secret)
        }
        ephemeral.append((secret, now))
        if ephemeral.count > Self.maximumEphemeralSecrets {
            ephemeralSet.remove(ephemeral.removeFirst().secret)
        }
    }

    public func registerKnownSecrets(inJSONObject value: Any) {
        walkKnownSecretFields(value) { key, candidate in
            guard Self.knownSecretKeys.contains(key) else { return }
            register(candidate)
        }
    }

    public func registerKnownEphemeralSecrets(inJSONObject value: Any) {
        walkKnownSecretFields(value) { key, candidate in
            guard Self.knownSecretKeys.contains(key) else { return }
            registerEphemeral(candidate)
        }
    }

    public func containsKnownSecret(in data: Data) -> Bool {
        snapshot().contains { data.range(of: $0) != nil }
    }

    public func containsKnownSecret(inJSONObject value: Any) -> Bool {
        let current = snapshot()
        guard !current.isEmpty else { return false }
        return containsKnownSecret(in: value, matching: current)
    }

    public func assertNoKnownSecret(in data: Data) throws {
        try require(
            !containsKnownSecret(in: data),
            "raw_continuation_token_forbidden",
            "durable or emitted data contains a known runtime secret"
        )
    }

    public func assertNoKnownSecret(inJSONObject value: Any) throws {
        try require(
            !containsKnownSecret(inJSONObject: value),
            "raw_continuation_token_forbidden",
            "durable or emitted data contains a known runtime secret"
        )
    }

    /// Permanent and still-live ephemeral secrets; expired ones are dropped.
    var count: Int { snapshot().count }

    private func snapshot() -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        let now = monotonicNanoseconds()
        let expired = ephemeral.prefix { entry in
            now >= entry.registeredAt && now - entry.registeredAt >= Self.ephemeralLifetimeNanoseconds
        }.count
        if expired > 0 {
            for entry in ephemeral.prefix(expired) { ephemeralSet.remove(entry.secret) }
            ephemeral.removeFirst(expired)
        }
        return secrets + ephemeral.lazy.map(\.secret).filter { !permanentSet.contains($0) }
    }

    // Registration stays limited to typed secret fields. Merely observing a
    // public string (including a root or array value) must not enroll it.
    private func walkKnownSecretFields(_ value: Any, visit: (_ key: String, _ string: String) -> Void) {
        if let object = value as? [String: Any] {
            for (key, child) in object {
                if let string = child as? String { visit(key, string) }
                walkKnownSecretFields(child, visit: visit)
            }
        } else if let array = value as? [Any] {
            for child in array { walkKnownSecretFields(child, visit: visit) }
        }
    }

    // Detection covers every decoded string. The canonical byte scan alone
    // cannot find a secret whose quotes, backslashes, or control bytes are
    // escaped in JSON, including when that secret appears in an object key.
    private func containsKnownSecret(in value: Any, matching current: [Data]) -> Bool {
        if let string = value as? String {
            let data = Data(string.utf8)
            return current.contains { data.range(of: $0) != nil }
        }
        if let object = value as? [String: Any] {
            for (key, child) in object {
                if containsKnownSecret(in: key, matching: current)
                    || containsKnownSecret(in: child, matching: current) {
                    return true
                }
            }
        } else if let array = value as? [Any] {
            for child in array where containsKnownSecret(in: child, matching: current) {
                return true
            }
        }
        return false
    }

    private static let knownSecretKeys: Set<String> = [
        "continuation_token",
        "correlation_token",
        "raw_continuation_token",
        "access_token",
        "refresh_token",
    ]
}
