import CoordinatorSwift
import Foundation

/// Process-local lease state for one enrolled Claude session. This type does
/// not authenticate credentials, attest a process, enroll a session, or schedule
/// renewal. The future registry must authenticate the role/capability and owner
/// connection before constructing the identity or owner handle used here.
/// Nothing in this API is an IPC credential or a persistable recovery grant.
public final class ClaudeSessionAuthority: @unchecked Sendable {
    public static let leaseDurationNanoseconds: UInt64 = 3_600_000_000_000
    public static let recommendedRenewalIntervalNanoseconds: UInt64 = 300_000_000_000

    public struct Identity: Sendable, Equatable {
        public let scopeID: UUID
        public let nativeSessionID: UUID
        public let sessionIncarnation: UUID
        public let serviceIncarnation: UUID
        public let ownerConnectionID: UUID
        public let authorityEpoch: UUID

        public init(scopeID: UUID, nativeSessionID: UUID, sessionIncarnation: UUID,
                    serviceIncarnation: UUID, ownerConnectionID: UUID, authorityEpoch: UUID) {
            self.scopeID = scopeID
            self.nativeSessionID = nativeSessionID
            self.sessionIncarnation = sessionIncarnation
            self.serviceIncarnation = serviceIncarnation
            self.ownerConnectionID = ownerConnectionID
            self.authorityEpoch = authorityEpoch
        }
    }

    /// A typed binding cached only after the registry authenticates its owner.
    /// This process-local value is not evidence of a valid IPC credential.
    public struct OwnerHandle: Sendable, Equatable {
        public let identity: Identity
        fileprivate let instanceID: UUID
        fileprivate init(identity: Identity, instanceID: UUID) {
            self.identity = identity
            self.instanceID = instanceID
        }
    }

    /// Only this authority can issue a ticket. Renewal preserves its epoch;
    /// every later use still checks the current lease and terminal state.
    /// A new authority instance cannot accept a ticket from an earlier instance,
    /// even if a caller accidentally supplies identical enrollment identifiers.
    public struct Ticket: Sendable, Equatable {
        public let identity: Identity
        fileprivate let instanceID: UUID
        fileprivate init(identity: Identity, instanceID: UUID) {
            self.identity = identity
            self.instanceID = instanceID
        }
    }

    public struct Lease: Sendable, Equatable {
        public let deadlineNanoseconds: UInt64
        public let renewalSequence: UInt64
        public let authorityEpoch: UUID
    }

    public enum RevocationReason: Sendable, Equatable, CaseIterable {
        case ownerDisconnected
        case childExited
        case sessionEnded
        case userDisconnected
        case serviceReplaced
    }

    public enum TerminationReason: Sendable, Equatable {
        case expired
        case clockRegression
        case clockOverflow
        case revoked(RevocationReason)
    }

    public enum Status: Sendable, Equatable {
        case active(Lease)
        case terminated(TerminationReason)
    }

    public enum AuthorityError: Error, Sendable, Equatable {
        case identityMismatch
        case ownerMismatch
        case staleTicket
        case invalidRenewalSequence
        case terminated(TerminationReason)
    }

    public let identity: Identity
    /// Enrollment code may retain this handle after verifying the actual owner.
    /// A different authority instance rejects it even for identical public IDs.
    public var ownerHandle: OwnerHandle { OwnerHandle(identity: identity, instanceID: instanceID) }
    private let instanceID = UUID()
    private let clock: any CoordinatorContinuousClock
    private let lock = NSLock()
    private var lastObservedNanoseconds: UInt64
    private var deadlineNanoseconds: UInt64
    private var lastRenewal: Lease?
    private var termination: TerminationReason?

    public init(identity: Identity,
                clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock()) throws {
        let now = clock.nowNanoseconds()
        let (deadline, overflow) = now.addingReportingOverflow(Self.leaseDurationNanoseconds)
        guard now != UInt64.max, !overflow else {
            throw AuthorityError.terminated(.clockOverflow)
        }
        self.identity = identity
        self.clock = clock
        lastObservedNanoseconds = now
        deadlineNanoseconds = deadline
    }

    /// Observes expiry or a broken clock without extending the lease. The first
    /// terminal state is retained permanently, including after a clock rollback.
    public func snapshot() -> Status {
        lock.withLock {
            _ = observeClock()
            return status()
        }
    }

    /// Only the exact authenticated owner may renew a still-live registration.
    /// The next sequence must be exactly one greater. Repeating the most recent
    /// accepted sequence returns its original receipt, never another extension.
    /// Expiry/revocation is checked before that idempotent response is considered.
    public func renew(owner: OwnerHandle, sequence: UInt64) throws -> Lease {
        try lock.withLock {
            guard owner.identity == identity, owner.instanceID == instanceID else { throw AuthorityError.ownerMismatch }
            let now = try requireActive()
            if let previous = lastRenewal, sequence == previous.renewalSequence { return previous }
            let (expected, sequenceOverflow) = (lastRenewal?.renewalSequence ?? 0).addingReportingOverflow(1)
            guard !sequenceOverflow, sequence == expected else { throw AuthorityError.invalidRenewalSequence }
            let (deadline, overflow) = now.addingReportingOverflow(Self.leaseDurationNanoseconds)
            guard !overflow else {
                termination = .clockOverflow
                throw AuthorityError.terminated(.clockOverflow)
            }
            deadlineNanoseconds = deadline
            let renewed = Lease(deadlineNanoseconds: deadline, renewalSequence: sequence,
                                authorityEpoch: identity.authorityEpoch)
            lastRenewal = renewed
            return renewed
        }
    }

    /// Checks admission and returns a session-bound ticket. Preparation may then
    /// happen outside the lock; a later mutation still requires withMutationFence.
    /// A ticket alone is not evidence that authority remains live at commit time.
    public func authorize(identity requestedIdentity: Identity) throws -> Ticket {
        try lock.withLock {
            guard requestedIdentity == identity else { throw AuthorityError.identityMismatch }
            _ = try requireActive()
            return Ticket(identity: identity, instanceID: instanceID)
        }
    }

    /// Rechecks the ticket, clock and terminal state immediately before entering
    /// the commit closure, while holding the same lock as renewal/revocation.
    /// Either a commit enters first, or revocation wins and the closure is never
    /// called. This is not an asynchronous transaction or a frozen-time promise.
    /// Callbacks must not reenter this authority, await, schedule an unfenced
    /// mutation, or perform blocking preparation. Time continues during the
    /// closure; authorization is linearized at its checked entry.
    public func withMutationFence<Result>(_ ticket: Ticket,
                                          _ body: () throws -> Result) throws -> Result {
        try lock.withLock {
            guard ticket.instanceID == instanceID, ticket.identity == identity else {
                throw AuthorityError.staleTicket
            }
            _ = try requireActive()
            return try body()
        }
    }

    /// Trusted registry/lifecycle callers revoke this object only. This is not
    /// a wire-accessible operation and does not cancel an already running model
    /// task. Concurrent operations are ordered by the scope lock; a previously
    /// observed terminal cause is never overwritten by a later cause.
    @discardableResult
    public func revoke(reason: RevocationReason) -> Status {
        lock.withLock {
            _ = observeClock()
            if termination == nil { termination = .revoked(reason) }
            return status()
        }
    }

    // All private state helpers below run with `lock` held.
    private func currentLease() -> Lease {
        Lease(deadlineNanoseconds: deadlineNanoseconds, renewalSequence: lastRenewal?.renewalSequence ?? 0,
              authorityEpoch: identity.authorityEpoch)
    }

    private func status() -> Status {
        if let termination { return .terminated(termination) }
        return .active(currentLease())
    }

    private func requireActive() throws -> UInt64 {
        guard let now = observeClock() else {
            // observeClock always installs a terminal cause before returning nil.
            throw AuthorityError.terminated(termination!)
        }
        return now
    }

    private func observeClock() -> UInt64? {
        guard termination == nil else { return nil }
        let now = clock.nowNanoseconds()
        if now == UInt64.max {
            termination = .clockOverflow
        } else if now < lastObservedNanoseconds {
            termination = .clockRegression
        } else {
            lastObservedNanoseconds = now
            if now >= deadlineNanoseconds { termination = .expired }
        }
        return termination == nil ? now : nil
    }
}
