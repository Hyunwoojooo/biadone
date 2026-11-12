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
    /// Expiry is decided on awake time so a Mac sleeping through the remaining
    /// lease does not end every Claude window. Published deadlines stay in the
    /// continuous domain (`clock`) and are translated from the awake remainder.
    private let awakeClock: any CoordinatorContinuousClock
    /// One injected clock serves both domains: sample it once per observation.
    private let sharesClock: Bool
    private let lock = NSLock()
    private var lastObservedNanoseconds: UInt64
    private var lastObservedAwakeNanoseconds: UInt64
    private var deadlineNanoseconds: UInt64
    private var awakeDeadlineNanoseconds: UInt64
    private var lastRenewal: Lease?
    private var termination: TerminationReason?

    /// `awakeClock` defaults to the system awake clock only with the system
    /// continuous clock; an injected test clock is used for both domains.
    public init(identity: Identity,
                clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
                awakeClock: (any CoordinatorContinuousClock)? = nil) throws {
        let awake = awakeClock ?? Self.defaultAwakeClock(for: clock)
        let shares = awakeClock == nil && !(clock is SystemCoordinatorContinuousClock)
        let now = clock.nowNanoseconds()
        let awakeNow = shares ? now : awake.nowNanoseconds()
        let (deadline, overflow) = now.addingReportingOverflow(Self.leaseDurationNanoseconds)
        let (awakeDeadline, awakeOverflow) = awakeNow.addingReportingOverflow(Self.leaseDurationNanoseconds)
        guard now != UInt64.max, awakeNow != UInt64.max, !overflow, !awakeOverflow else {
            throw AuthorityError.terminated(.clockOverflow)
        }
        self.identity = identity
        self.clock = clock
        self.awakeClock = awake
        sharesClock = shares
        lastObservedNanoseconds = now
        lastObservedAwakeNanoseconds = awakeNow
        deadlineNanoseconds = deadline
        awakeDeadlineNanoseconds = awakeDeadline
    }

    public static func defaultAwakeClock(for clock: any CoordinatorContinuousClock) -> any CoordinatorContinuousClock {
        clock is SystemCoordinatorContinuousClock ? SystemCoordinatorAwakeClock() : clock
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
            let (awakeDeadline, awakeOverflow) = lastObservedAwakeNanoseconds
                .addingReportingOverflow(Self.leaseDurationNanoseconds)
            guard !overflow, !awakeOverflow else {
                termination = .clockOverflow
                throw AuthorityError.terminated(.clockOverflow)
            }
            deadlineNanoseconds = deadline
            awakeDeadlineNanoseconds = awakeDeadline
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
        // Remaining awake time, expressed at the last observed continuous
        // instant. Sleep since the last renewal slides this forward.
        let remaining = awakeDeadlineNanoseconds > lastObservedAwakeNanoseconds
            ? awakeDeadlineNanoseconds - lastObservedAwakeNanoseconds : 0
        let (translated, overflow) = lastObservedNanoseconds.addingReportingOverflow(remaining)
        deadlineNanoseconds = overflow ? UInt64.max : max(deadlineNanoseconds, translated)
        return Lease(deadlineNanoseconds: deadlineNanoseconds, renewalSequence: lastRenewal?.renewalSequence ?? 0,
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
        let awakeNow = sharesClock ? now : awakeClock.nowNanoseconds()
        if now == UInt64.max || awakeNow == UInt64.max {
            termination = .clockOverflow
        } else if now < lastObservedNanoseconds || awakeNow < lastObservedAwakeNanoseconds {
            termination = .clockRegression
        } else {
            lastObservedNanoseconds = now
            lastObservedAwakeNanoseconds = awakeNow
            if awakeNow >= awakeDeadlineNanoseconds { termination = .expired }
        }
        return termination == nil ? now : nil
    }
}
