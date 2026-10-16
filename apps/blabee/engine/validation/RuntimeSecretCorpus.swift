import Foundation

/// An in-memory, process-lifetime set of secret values the coordinator has
/// actually observed or issued. It deliberately does not claim to discover
/// arbitrary secrets that have never crossed a typed secret boundary.
public final class RuntimeSecretCorpus: @unchecked Sendable {
    private static let minimumSecretLength = 8

    private let lock = NSLock()
    private var secrets: [Data] = []

    public init() {}

    public func register(_ secret: String) {
        register(Data(secret.utf8))
    }

    public func register(_ secret: Data) {
        guard secret.count >= Self.minimumSecretLength else { return }
        lock.lock()
        defer { lock.unlock() }
        if !secrets.contains(secret) { secrets.append(secret) }
    }

    public func registerKnownSecrets(inJSONObject value: Any) {
        walkKnownSecretFields(value) { key, candidate in
            guard Self.knownSecretKeys.contains(key) else { return }
            register(candidate)
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

    private func snapshot() -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        return secrets
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
