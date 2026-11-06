import Foundation

/// Presentation ordering only. These numbers never authorize a selection.
/// One instance is shared by the service's Codex and Claude ingress paths.
/// It deliberately contains neither credentials nor action bodies.
public final class PetEventArrivalLedger: @unchecked Sendable {
    public struct Key: Hashable, Sendable {
        public let scopeID: String
        public let kind: String
        public let eventID: String

        public init(scopeID: String, kind: String, eventID: String) {
            self.scopeID = scopeID; self.kind = kind; self.eventID = eventID
        }
    }

    private let lock = NSLock()
    private var next: UInt64 = 0
    private var arrivals: [Key: UInt64] = [:]

    public init() {}

    @discardableResult
    public func record(scopeID: String, kind: String, eventID: String) -> UInt64 {
        lock.lock(); defer { lock.unlock() }
        let key = Key(scopeID: scopeID, kind: kind, eventID: eventID)
        if let value = arrivals[key] { return value }
        // Exhaustion would require more admissions than any service lifetime.
        precondition(next < UInt64.max, "pet_arrival_sequence_exhausted")
        next += 1
        arrivals[key] = next
        return next
    }

    public func sequence(scopeID: String, kind: String, eventID: String) -> UInt64? {
        lock.lock(); defer { lock.unlock() }
        return arrivals[Key(scopeID: scopeID, kind: kind, eventID: eventID)]
    }

    public func retain(scopeID: String, eventKeys: Set<Key>) {
        lock.lock(); defer { lock.unlock() }
        arrivals = arrivals.filter { $0.key.scopeID != scopeID || eventKeys.contains($0.key) }
    }

    public func removeScope(_ scopeID: String) {
        retain(scopeID: scopeID, eventKeys: [])
    }
}
