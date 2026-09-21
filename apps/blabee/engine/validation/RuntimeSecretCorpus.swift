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
        walk(value) { key, candidate in
            guard Self.knownSecretKeys.contains(key) else { return }
            register(candidate)
        }
    }

    public func containsKnownSecret(in data: Data) -> Bool {
        snapshot().contains { data.range(of: $0) != nil }
    }

    public func containsKnownSecret(inJSONObject value: Any) -> Bool {
        let current = snapshot()
        var found = false
        walk(value) { _, candidate in
            let data = Data(candidate.utf8)
            if current.contains(where: { data.range(of: $0) != nil }) { found = true }
        }
        return found
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

    private func walk(_ value: Any, visit: (_ key: String, _ string: String) -> Void) {
        if let object = value as? [String: Any] {
            for (key, child) in object {
                if let string = child as? String { visit(key, string) }
                walk(child, visit: visit)
            }
        } else if let array = value as? [Any] {
            for child in array { walk(child, visit: visit) }
        }
    }

    private static let knownSecretKeys: Set<String> = [
        "continuation_token",
        "correlation_token",
        "raw_continuation_token",
    ]
}
