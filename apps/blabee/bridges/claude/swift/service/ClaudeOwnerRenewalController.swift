import ClaudeCoreAdapter
import CoordinatorSwift
import Dispatch
import Foundation

/// Owner-side scheduling, independent of Terminal/Claude launch and credential
/// provisioning. The caller supplies an already enrolled private connection.
/// Public identity fields do not authenticate that connection. CP-05 owns the
/// actual supervisor, bounded exchange, child observation and wake integration.
final class ClaudeOwnerRenewalController: @unchecked Sendable {
    typealias Exchange = @Sendable (Data) throws -> Data
    enum StopReason: Sendable, Equatable {
        case stopped, ended, endUnconfirmed, expired, revoked, rejected
        case clockInvalid, sequenceExhausted, responseInvalid, transportFailed
    }
    struct Snapshot: Sendable {
        let deadlineNanoseconds: UInt64
        let renewalSequence: UInt64
        let nextRenewalNanoseconds: UInt64
        let terminalReason: StopReason?
        let ending: Bool
    }

    private enum ExchangeFailure: Error { case transport, response }
    private enum Step { case wait, renew(UInt64), terminate(StopReason) }
    private let identity: ClaudeSessionAuthority.Identity
    private let clock: any CoordinatorContinuousClock
    private let codec: ClaudeProductWireCodec
    private let exchange: Exchange
    private let disconnected: @Sendable (StopReason) -> Void
    private let lock = NSLock()
    private let exchangeLock = NSLock()
    private let timerQueue = DispatchQueue(label: "com.biadone.blabee.claude-owner-renewal")
    private var timer: (any DispatchSourceTimer)?
    private var started = false
    private var ending = false
    private var terminalReason: StopReason?
    private var deadlineNanoseconds: UInt64
    private var renewalSequence: UInt64
    private var nextRenewalNanoseconds: UInt64
    private var lastObservedNanoseconds: UInt64

    /// `exchange` must bound its I/O. `disconnected` must shut down that owned
    /// connection and unblock pending I/O, not merely publish a UI notification.
    /// Neither callback may silently reconnect or replay a request.
    init(identity: ClaudeSessionAuthority.Identity, initialDeadlineNanoseconds: UInt64,
         initialRenewalSequence: UInt64 = 0,
         clock: any CoordinatorContinuousClock = SystemCoordinatorContinuousClock(),
         secretCorpus: RuntimeSecretCorpus, exchange: @escaping Exchange,
         disconnected: @escaping @Sendable (StopReason) -> Void) throws {
        let now = clock.nowNanoseconds()
        let (latest, overflow) = now.addingReportingOverflow(ClaudeSessionAuthority.leaseDurationNanoseconds)
        guard now != UInt64.max, !overflow, initialDeadlineNanoseconds > now,
              initialDeadlineNanoseconds <= latest else {
            throw CoordinatorError("claude_owner_renewal_configuration_invalid")
        }
        self.identity = identity
        self.clock = clock
        self.codec = ClaudeProductWireCodec(credentialCorpus: secretCorpus)
        self.exchange = exchange
        self.disconnected = disconnected
        deadlineNanoseconds = initialDeadlineNanoseconds
        renewalSequence = initialRenewalSequence
        nextRenewalNanoseconds = Self.nextDue(deadline: initialDeadlineNanoseconds)
        lastObservedNanoseconds = now
    }

    deinit { stop() }

    /// Polling the continuous clock briefly also notices sleep elapsed time on
    /// the first timer tick after wake. It does not send a request every second:
    /// renewal is due every five minutes of the server's lease timeline.
    func start() throws {
        try lock.withLock {
            guard !started, !ending, terminalReason == nil else {
                throw CoordinatorError("claude_owner_renewal_unavailable")
            }
            let source = DispatchSource.makeTimerSource(queue: timerQueue)
            source.setEventHandler { [weak self] in self?.tick() }
            source.schedule(deadline: .now(), repeating: .seconds(1), leeway: .milliseconds(100))
            timer = source
            started = true
            source.resume()
        }
    }

    /// Also used by a supervisor's explicit wake observation and fake clocks.
    /// Concurrent ticks coalesce; there is never a queued or replayed renewal.
    func tick() {
        guard exchangeLock.try() else { return }
        defer { exchangeLock.unlock() }
        let step: Step = lock.withLock {
            guard terminalReason == nil, !ending else { return .wait }
            let now = clock.nowNanoseconds()
            if let reason = observeClock(now) { return .terminate(reason) }
            guard now >= nextRenewalNanoseconds else { return .wait }
            let (sequence, overflow) = renewalSequence.addingReportingOverflow(1)
            return overflow ? .terminate(.sequenceExhausted) : .renew(sequence)
        }
        switch step {
        case .wait: return
        case .terminate(let reason): terminate(reason); return
        case .renew(let sequence):
            do {
                let request = try makeRequest(operation: "renew", payload: ["renewal_sequence": String(sequence)])
                let response = try performExchange(request)
                if let reason = Self.rejection(in: response) { terminate(reason); return }
                guard let result = response["result"] as? [String: Any],
                      let lease = result["lease"] as? [String: String],
                      let deadline = lease["deadline_nanoseconds"].flatMap(UInt64.init),
                      lease["renewal_sequence"] == String(sequence) else {
                    terminate(.responseInvalid); return
                }
                let failure: StopReason? = lock.withLock {
                    guard terminalReason == nil, !ending else { return nil }
                    let now = clock.nowNanoseconds()
                    // The server may have renewed just before the old deadline
                    // and replied just after it. Validate the new receipt's
                    // deadline, rather than treating the superseded one as final.
                    if let reason = observeClock(now, enforceDeadline: false) { return reason }
                    let (latest, overflow) = now.addingReportingOverflow(ClaudeSessionAuthority.leaseDurationNanoseconds)
                    guard !overflow, deadline > now, deadline > deadlineNanoseconds, deadline <= latest else {
                        return .responseInvalid
                    }
                    deadlineNanoseconds = deadline
                    renewalSequence = sequence
                    nextRenewalNanoseconds = Self.nextDue(deadline: deadline)
                    return nil
                }
                if let failure { terminate(failure) }
            } catch ExchangeFailure.transport { terminate(.transportFailed) }
            catch { terminate(.responseInvalid) }
        }
    }

    /// The supervisor, not a model or timer, supplies observed child/user end.
    /// If a request is already in flight, close that uncertain connection rather
    /// than overlap frames. EOF still revokes its authority; no end ACK is claimed.
    func end(reason: ClaudeSessionAuthority.RevocationReason) {
        guard exchangeLock.try() else { terminate(.endUnconfirmed); return }
        defer { exchangeLock.unlock() }
        let admission: StopReason? = lock.withLock {
            guard terminalReason == nil, !ending else { return .stopped }
            if let failure = observeClock(clock.nowNanoseconds()) { return failure }
            ending = true
            timer?.cancel()
            timer = nil
            return nil
        }
        if let admission { terminate(admission); return }
        do {
            let request = try makeRequest(operation: "end", payload: ["reason": Self.wireReason(reason)])
            let response = try performExchange(request)
            if let failure = Self.rejection(in: response) { terminate(failure); return }
            guard (response["result"] as? [String: Any])?["ended"] as? Bool == true else {
                terminate(.responseInvalid); return
            }
            terminate(.ended)
        } catch ExchangeFailure.transport { terminate(.transportFailed) }
        catch { terminate(.responseInvalid) }
    }

    /// Closes the caller-owned transport through one callback, even if a late
    /// exchange later succeeds. A stopped controller cannot be restarted.
    func stop() { terminate(.stopped) }

    func snapshot() -> Snapshot {
        lock.withLock {
            Snapshot(deadlineNanoseconds: deadlineNanoseconds, renewalSequence: renewalSequence,
                nextRenewalNanoseconds: nextRenewalNanoseconds, terminalReason: terminalReason, ending: ending)
        }
    }

    private func terminate(_ reason: StopReason) {
        let shouldClose = lock.withLock {
            guard terminalReason == nil else { return false }
            terminalReason = reason
            ending = false
            timer?.cancel()
            timer = nil
            return true
        }
        if shouldClose { disconnected(reason) }
    }

    /// Called only under state lock. Expiry is checked before any next request,
    /// so sleeping through the remaining lease never initiates a rescue renew.
    private func observeClock(_ now: UInt64, enforceDeadline: Bool = true) -> StopReason? {
        guard now != UInt64.max, now >= lastObservedNanoseconds else { return .clockInvalid }
        lastObservedNanoseconds = now
        return enforceDeadline && now >= deadlineNanoseconds ? .expired : nil
    }

    private func makeRequest(operation: String, payload: [String: String]) throws -> ClaudeProductWireCodec.Envelope {
        try codec.decodeRequest(StrictJSONTransport.data(forJSONObject: [
            "schema_version": "blabee.claude-owner.v1", "kind": "request", "provider": "claude",
            "request_id": UUID().uuidString.lowercased(), "role": "owner", "operation": operation,
            "authority": [
                "scope_id": identity.scopeID.uuidString.lowercased(),
                "native_session_id": identity.nativeSessionID.uuidString.lowercased(),
                "session_incarnation": identity.sessionIncarnation.uuidString.lowercased(),
                "service_incarnation": identity.serviceIncarnation.uuidString.lowercased(),
                "owner_connection_id": identity.ownerConnectionID.uuidString.lowercased(),
                "authority_epoch": identity.authorityEpoch.uuidString.lowercased(),
            ], "payload": payload,
        ]))
    }

    private func performExchange(_ request: ClaudeProductWireCodec.Envelope) throws -> [String: Any] {
        let data: Data
        do { data = try exchange(request.canonicalJSON) }
        catch { throw ExchangeFailure.transport }
        do {
            let response = try codec.decodeResponse(data, matching: request,
                connection: .init(serviceIncarnation: identity.serviceIncarnation,
                                  ownerConnectionID: identity.ownerConnectionID))
            return try StrictJSONTransport.object(from: response.canonicalJSON)
        } catch { throw ExchangeFailure.response }
    }

    private static func rejection(in response: [String: Any]) -> StopReason? {
        guard response["ok"] as? Bool != true else { return nil }
        switch (response["error"] as? [String: String])?["code"] {
        case "expired": return .expired
        case "revoked": return .revoked
        default: return .rejected
        }
    }

    private static func nextDue(deadline: UInt64) -> UInt64 {
        let margin = ClaudeSessionAuthority.leaseDurationNanoseconds
            - ClaudeSessionAuthority.recommendedRenewalIntervalNanoseconds
        return deadline >= margin ? deadline - margin : 0
    }

    private static func wireReason(_ reason: ClaudeSessionAuthority.RevocationReason) -> String {
        switch reason {
        case .ownerDisconnected: "owner_disconnected"
        case .childExited: "child_exited"
        case .sessionEnded: "session_ended"
        case .userDisconnected: "user_disconnected"
        case .serviceReplaced: "service_replaced"
        }
    }
}
