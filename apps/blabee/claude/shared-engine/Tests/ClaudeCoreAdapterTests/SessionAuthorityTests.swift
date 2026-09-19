import ClaudeCoreAdapter
import CoordinatorSwift
import Dispatch
import Foundation
import Testing

private typealias Authority = ClaudeSessionAuthority
private let minute: UInt64 = 60_000_000_000

private enum AuthorityTestError: Error { case callbackFailed, synchronizationFailed }

/// Tests control scheduling through barriers, not sleep or a wall-clock lease.
/// The bounded waits below only stop a broken concurrency test from hanging.
private final class AuthorityGate: @unchecked Sendable {
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var didTimeOut = false
    var timedOut: Bool { lock.withLock { didTimeOut } }
    func hold() {
        entered.signal()
        if release.wait(timeout: .now() + 5) != .success { lock.withLock { didTimeOut = true } }
    }
}

private final class AuthorityClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64
    private var nextGate: AuthorityGate?
    init(_ value: UInt64 = 0) { self.value = value }
    func set(_ value: UInt64) { lock.withLock { self.value = value } }
    func pauseNextSample(_ gate: AuthorityGate) { lock.withLock { nextGate = gate } }
    func nowNanoseconds() -> UInt64 {
        let sample = lock.withLock { () -> (UInt64, AuthorityGate?) in
            defer { nextGate = nil }
            return (value, nextGate)
        }
        sample.1?.hold()
        return sample.0
    }
}

private final class AuthorityResults: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [String] = []
    private var errors: [Authority.AuthorityError] = []
    private var receipts: [Authority.Lease] = []
    func event(_ value: String) { lock.withLock { events.append(value) } }
    func error(_ value: Error) {
        lock.withLock {
            if let value = value as? Authority.AuthorityError { errors.append(value) }
            else { events.append("unexpected-error") }
        }
    }
    func receipt(_ value: Authority.Lease) { lock.withLock { receipts.append(value) } }
    func snapshot() -> (events: [String], errors: [Authority.AuthorityError], receipts: [Authority.Lease]) {
        lock.withLock { (events, errors, receipts) }
    }
}

private func identity() -> Authority.Identity {
    Authority.Identity(scopeID: UUID(), nativeSessionID: UUID(), sessionIncarnation: UUID(),
                       serviceIncarnation: UUID(), ownerConnectionID: UUID(), authorityEpoch: UUID())
}

private enum IdentityField: CaseIterable, Sendable {
    case scope, nativeSession, sessionIncarnation, serviceIncarnation, ownerConnection, authorityEpoch
}

private func changing(_ field: IdentityField, in value: Authority.Identity) -> Authority.Identity {
    Authority.Identity(scopeID: field == .scope ? UUID() : value.scopeID,
        nativeSessionID: field == .nativeSession ? UUID() : value.nativeSessionID,
        sessionIncarnation: field == .sessionIncarnation ? UUID() : value.sessionIncarnation,
        serviceIncarnation: field == .serviceIncarnation ? UUID() : value.serviceIncarnation,
        ownerConnectionID: field == .ownerConnection ? UUID() : value.ownerConnectionID,
        authorityEpoch: field == .authorityEpoch ? UUID() : value.authorityEpoch)
}

private func rejects<Result>(_ expected: Authority.AuthorityError, _ body: () throws -> Result) {
    do { _ = try body(); Issue.record("Authority unexpectedly accepted a rejected operation") }
    catch let error as Authority.AuthorityError { #expect(error == expected) }
    catch { Issue.record("Authority returned an unexpected error type") }
}

private func waitFor(_ signal: DispatchSemaphore) throws {
    guard signal.wait(timeout: .now() + 5) == .success else { throw AuthorityTestError.synchronizationFailed }
}

private func worker(_ group: DispatchGroup, _ body: @escaping @Sendable () -> Void) {
    group.enter()
    DispatchQueue.global().async { defer { group.leave() }; body() }
}

private func finish(_ group: DispatchGroup) throws {
    guard group.wait(timeout: .now() + 5) == .success else { throw AuthorityTestError.synchronizationFailed }
}

@Suite("Claude session authority")
private struct SessionAuthorityTests {
    @Test("Owner renewal keeps one epoch and earlier tickets valid across twenty-four hours")
    func longSession() throws {
        let start: UInt64 = 42
        let clock = AuthorityClock(start)
        let value = identity()
        let authority = try Authority(identity: value, clock: clock)
        let ticket = try authority.authorize(identity: value)
        #expect(Authority.leaseDurationNanoseconds == 60 * minute)
        #expect(Authority.recommendedRenewalIntervalNanoseconds == 5 * minute)
        for sequence in UInt64(1)...288 {
            let now = start + sequence * 5 * minute
            clock.set(now)
            let renewed = try authority.renew(owner: authority.ownerHandle, sequence: sequence)
            #expect(renewed.deadlineNanoseconds == now + 60 * minute)
            #expect(renewed.renewalSequence == sequence)
            #expect(renewed.authorityEpoch == value.authorityEpoch)
            #expect(authority.snapshot() == .active(renewed))
            // The initial ticket's admission deadline passed long ago. The
            // current live lease and stable epoch, not an old ticket timestamp,
            // determine whether this independently fenced commit may enter.
            #expect(try authority.withMutationFence(ticket) { sequence } == sequence)
        }
    }

    @Test("Expiry is exact at the continuous-clock deadline", arguments: [-1, 0, 1])
    func exactExpiry(offset: Int) throws {
        let clock = AuthorityClock()
        let value = identity()
        let authority = try Authority(identity: value, clock: clock)
        let ticket = try authority.authorize(identity: value)
        let deadline = Authority.leaseDurationNanoseconds
        clock.set(offset < 0 ? deadline - 1 : deadline + UInt64(offset))
        if offset < 0 {
            #expect(try authority.withMutationFence(ticket) { true })
            let renewed = try authority.renew(owner: authority.ownerHandle, sequence: 1)
            #expect(renewed.deadlineNanoseconds == 2 * deadline - 1)
        } else {
            rejects(.terminated(.expired)) { try authority.authorize(identity: value) }
            rejects(.terminated(.expired)) { try authority.withMutationFence(ticket) { Issue.record("Expired commit entered") } }
            rejects(.terminated(.expired)) { try authority.renew(owner: authority.ownerHandle, sequence: 1) }
            #expect(authority.snapshot() == .terminated(.expired))
            clock.set(0)
            #expect(authority.snapshot() == .terminated(.expired), "Expiry cannot be undone by changing the clock")
        }
    }

    @Test("Only the next renewal or an exact latest duplicate is accepted without extra deadline growth")
    func renewalSequence() throws {
        let clock = AuthorityClock()
        let authority = try Authority(identity: identity(), clock: clock)
        let initial = authority.snapshot()
        for sequence in [UInt64(0), 2, .max] {
            rejects(.invalidRenewalSequence) { try authority.renew(owner: authority.ownerHandle, sequence: sequence) }
            #expect(authority.snapshot() == initial)
        }
        clock.set(5 * minute)
        let first = try authority.renew(owner: authority.ownerHandle, sequence: 1)
        #expect(first.deadlineNanoseconds == 65 * minute)
        clock.set(10 * minute)
        #expect(try authority.renew(owner: authority.ownerHandle, sequence: 1) == first)
        rejects(.invalidRenewalSequence) { try authority.renew(owner: authority.ownerHandle, sequence: 3) }
        #expect(authority.snapshot() == .active(first))
        clock.set(15 * minute)
        let second = try authority.renew(owner: authority.ownerHandle, sequence: 2)
        #expect(second.deadlineNanoseconds == 75 * minute)
        rejects(.invalidRenewalSequence) { try authority.renew(owner: authority.ownerHandle, sequence: 1) }
        clock.set(20 * minute)
        #expect(try authority.renew(owner: authority.ownerHandle, sequence: 2) == second)
        clock.set(second.deadlineNanoseconds)
        rejects(.terminated(.expired)) { try authority.renew(owner: authority.ownerHandle, sequence: 2) }
    }

    @Test("Concurrent copies of one renewal return the first receipt without a second extension")
    func concurrentDuplicateRenewal() throws {
        let clock = AuthorityClock()
        let authority = try Authority(identity: identity(), clock: clock)
        clock.set(5 * minute)
        let gate = AuthorityGate()
        clock.pauseNextSample(gate)
        let attempted = DispatchSemaphore(value: 0)
        let group = DispatchGroup()
        let results = AuthorityResults()
        let renew: @Sendable () -> Void = {
            do { results.receipt(try authority.renew(owner: authority.ownerHandle, sequence: 1)) }
            catch { results.error(error) }
        }
        defer { gate.release.signal() }
        worker(group, renew)
        try waitFor(gate.entered)
        // The first request already sampled minute five under the scope lock.
        // Its concurrent duplicate observes minute ten but gets that receipt.
        clock.set(10 * minute)
        worker(group) { attempted.signal(); renew() }
        try waitFor(attempted)
        gate.release.signal()
        try finish(group)
        #expect(!gate.timedOut)
        let result = results.snapshot()
        #expect(result.errors.isEmpty)
        #expect(result.events.isEmpty)
        #expect(result.receipts.count == 2)
        let first = try #require(result.receipts.first)
        #expect(result.receipts.allSatisfy { $0 == first })
        #expect(first.deadlineNanoseconds == 65 * minute)
        #expect(authority.snapshot() == .active(first))
    }

    @Test("Every enrollment identity component is exact", arguments: IdentityField.allCases)
    func foreignIdentity(field: IdentityField) throws {
        let clock = AuthorityClock()
        let value = identity()
        let authority = try Authority(identity: value, clock: clock)
        let wrong = changing(field, in: value)
        let foreign = try Authority(identity: wrong, clock: clock)
        let before = authority.snapshot()
        rejects(.identityMismatch) { try authority.authorize(identity: wrong) }
        rejects(.ownerMismatch) { try authority.renew(owner: foreign.ownerHandle, sequence: 1) }
        let foreignTicket = try foreign.authorize(identity: wrong)
        rejects(.staleTicket) { try authority.withMutationFence(foreignTicket) { Issue.record("Foreign commit entered") } }
        #expect(authority.snapshot() == before)
        let own = try authority.authorize(identity: value)
        #expect(try authority.withMutationFence(own) { true })
    }

    @Test("A new instance never accepts old owner handles or tickets even with identical public IDs")
    func instanceBoundary() throws {
        let clock = AuthorityClock()
        let value = identity()
        let previous = try Authority(identity: value, clock: clock)
        let owner = previous.ownerHandle
        let ticket = try previous.authorize(identity: value)
        previous.revoke(reason: .serviceReplaced)
        let replacement = try Authority(identity: value, clock: clock)
        #expect(replacement.ownerHandle != owner)
        rejects(.ownerMismatch) { try replacement.renew(owner: owner, sequence: 1) }
        rejects(.staleTicket) { try replacement.withMutationFence(ticket) { Issue.record("Old instance commit entered") } }
        #expect(try replacement.renew(owner: replacement.ownerHandle, sequence: 1).renewalSequence == 1)
        #expect(previous.snapshot() == .terminated(.revoked(.serviceReplaced)))
    }

    @Test("All lifecycle revocations are terminal and preserve their first cause", arguments: Authority.RevocationReason.allCases)
    func terminalReasons(reason: Authority.RevocationReason) throws {
        let clock = AuthorityClock()
        let value = identity()
        let authority = try Authority(identity: value, clock: clock)
        let ticket = try authority.authorize(identity: value)
        _ = try authority.renew(owner: authority.ownerHandle, sequence: 1)
        let terminal = Authority.Status.terminated(.revoked(reason))
        #expect(authority.revoke(reason: reason) == terminal)
        clock.set(UInt64.max)
        #expect(authority.revoke(reason: .userDisconnected) == terminal)
        #expect(authority.snapshot() == terminal)
        rejects(.terminated(.revoked(reason))) { try authority.renew(owner: authority.ownerHandle, sequence: 1) }
        rejects(.terminated(.revoked(reason))) { try authority.renew(owner: authority.ownerHandle, sequence: 2) }
        rejects(.terminated(.revoked(reason))) { try authority.authorize(identity: value) }
        rejects(.terminated(.revoked(reason))) {
            try authority.withMutationFence(ticket) { Issue.record("Revoked commit entered") }
        }
    }

    @Test("Clock regression is terminal even if time later catches up")
    func clockRegression() throws {
        let clock = AuthorityClock(100)
        let value = identity()
        let authority = try Authority(identity: value, clock: clock)
        clock.set(200)
        let ticket = try authority.authorize(identity: value)
        clock.set(199)
        rejects(.terminated(.clockRegression)) { try authority.withMutationFence(ticket) {} }
        clock.set(300)
        rejects(.terminated(.clockRegression)) { try authority.renew(owner: authority.ownerHandle, sequence: 1) }
        #expect(authority.snapshot() == .terminated(.clockRegression))
    }

    @Test("Clock saturation and deadline overflow fail closed without integer traps")
    func clockOverflow() throws {
        for instant in [UInt64.max, UInt64.max - Authority.leaseDurationNanoseconds + 1] {
            rejects(.terminated(.clockOverflow)) { try Authority(identity: identity(), clock: AuthorityClock(instant)) }
        }
        let first = UInt64.max - Authority.leaseDurationNanoseconds
        let clock = AuthorityClock(first)
        let value = identity()
        let authority = try Authority(identity: value, clock: clock)
        let ticket = try authority.authorize(identity: value)
        clock.set(first + 1)
        rejects(.terminated(.clockOverflow)) { try authority.renew(owner: authority.ownerHandle, sequence: 1) }
        clock.set(first)
        rejects(.terminated(.clockOverflow)) { try authority.withMutationFence(ticket) {} }
        let saturatedClock = AuthorityClock()
        let saturated = try Authority(identity: value, clock: saturatedClock)
        saturatedClock.set(.max)
        #expect(saturated.snapshot() == .terminated(.clockOverflow))
    }

    @Test("Wake uses the remaining lease, not whether sleep lasted less than one hour", arguments: [false, true])
    func sleepBudget(exceedsRemaining: Bool) throws {
        let clock = AuthorityClock()
        let authority = try Authority(identity: identity(), clock: clock)
        clock.set(5 * minute)
        let renewed = try authority.renew(owner: authority.ownerHandle, sequence: 1)
        clock.set(9 * minute) // Four minutes already passed since renewal.
        _ = authority.snapshot()
        clock.set((exceedsRemaining ? 67 : 64) * minute) // 58 or 55 minutes of simulated sleep.
        if exceedsRemaining {
            rejects(.terminated(.expired)) { try authority.renew(owner: authority.ownerHandle, sequence: 2) }
        } else {
            let result = try authority.renew(owner: authority.ownerHandle, sequence: 2)
            #expect(result.deadlineNanoseconds == 124 * minute)
            #expect(result.authorityEpoch == renewed.authorityEpoch)
        }
    }

    @Test("An admitted commit completes before a concurrent revoke; a prior revoke blocks entry")
    func commitRevokeOrder() throws {
        let value = identity()
        let authority = try Authority(identity: value, clock: AuthorityClock())
        let ticket = try authority.authorize(identity: value)
        let gate = AuthorityGate()
        let attempted = DispatchSemaphore(value: 0)
        let group = DispatchGroup()
        let results = AuthorityResults()
        defer { gate.release.signal() }
        worker(group) {
            do {
                try authority.withMutationFence(ticket) {
                    gate.hold() // Test-only barrier while the commit owns the scope lock.
                    results.event("commit")
                }
            } catch { results.error(error) }
        }
        try waitFor(gate.entered)
        worker(group) {
            attempted.signal()
            authority.revoke(reason: .userDisconnected)
            results.event("revoke")
        }
        try waitFor(attempted)
        gate.release.signal()
        try finish(group)
        #expect(!gate.timedOut)
        #expect(results.snapshot().events == ["commit", "revoke"])
        #expect(results.snapshot().errors.isEmpty)
        rejects(.terminated(.revoked(.userDisconnected))) {
            try authority.withMutationFence(ticket) { Issue.record("Commit entered after revoke") }
        }
    }

    @Test("Renewal and revocation have one deterministic ordering", arguments: [false, true])
    func renewalRevokeOrder(revokeFirst: Bool) throws {
        let clock = AuthorityClock()
        let authority = try Authority(identity: identity(), clock: clock)
        clock.set(5 * minute)
        let gate = AuthorityGate()
        clock.pauseNextSample(gate)
        let attempted = DispatchSemaphore(value: 0)
        let group = DispatchGroup()
        let results = AuthorityResults()
        let renew: @Sendable () -> Void = {
            do { results.receipt(try authority.renew(owner: authority.ownerHandle, sequence: 1)) }
            catch { results.error(error) }
        }
        let revoke: @Sendable () -> Void = { authority.revoke(reason: .ownerDisconnected); results.event("revoke") }
        defer { gate.release.signal() }
        worker(group, revokeFirst ? revoke : renew)
        try waitFor(gate.entered) // The first operation already owns the authority lock.
        worker(group) {
            attempted.signal()
            if revokeFirst { renew() } else { revoke() }
        }
        try waitFor(attempted)
        gate.release.signal()
        try finish(group)
        #expect(!gate.timedOut)
        let result = results.snapshot()
        #expect(result.events == ["revoke"])
        if revokeFirst {
            #expect(result.receipts.isEmpty)
            #expect(result.errors == [.terminated(.revoked(.ownerDisconnected))])
        } else {
            #expect(result.errors.isEmpty)
            #expect(result.receipts.count == 1)
            #expect(result.receipts.first?.deadlineNanoseconds == 65 * minute)
        }
        #expect(authority.snapshot() == .terminated(.revoked(.ownerDisconnected)))
        rejects(.terminated(.revoked(.ownerDisconnected))) {
            try authority.renew(owner: authority.ownerHandle, sequence: 1)
        }
    }

    @Test("Callback errors release the fence lock and commit entry does not freeze time")
    func callbackLifetime() throws {
        let clock = AuthorityClock()
        let value = identity()
        let authority = try Authority(identity: value, clock: clock)
        let ticket = try authority.authorize(identity: value)
        do {
            try authority.withMutationFence(ticket) { throw AuthorityTestError.callbackFailed }
            Issue.record("Expected the callback error")
        } catch AuthorityTestError.callbackFailed { /* The original error is preserved. */ }
        #expect(try authority.renew(owner: authority.ownerHandle, sequence: 1).renewalSequence == 1)
        // A short commit admitted before the deadline owns the lock until its
        // return. Expiry is checked at entry, not used to pretend a committed
        // mutation can be undone after time has moved forward inside it.
        #expect(try authority.withMutationFence(ticket) {
            clock.set(Authority.leaseDurationNanoseconds)
            return true
        })
        rejects(.terminated(.expired)) { try authority.withMutationFence(ticket) {} }
    }

    @Test("Revocation and clock failure in one scope leave independent authorities usable")
    func isolatedScopes() throws {
        let oneClock = AuthorityClock()
        let one = try Authority(identity: identity(), clock: oneClock)
        let twoClock = AuthorityClock()
        let two = try Authority(identity: identity(), clock: twoClock)
        let twoTicket = try two.authorize(identity: two.identity)
        let before = two.snapshot()
        one.revoke(reason: .childExited)
        oneClock.set(.max)
        #expect(one.snapshot() == .terminated(.revoked(.childExited)))
        #expect(two.snapshot() == before)
        #expect(try two.withMutationFence(twoTicket) { true })
        twoClock.set(5 * minute)
        #expect(try two.renew(owner: two.ownerHandle, sequence: 1).deadlineNanoseconds == 65 * minute)
    }
}
