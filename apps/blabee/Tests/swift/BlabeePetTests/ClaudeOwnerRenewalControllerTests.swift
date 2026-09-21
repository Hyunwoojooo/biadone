import ClaudeCoreAdapter
import CoordinatorSwift
import Dispatch
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Claude owner renewal controller", .serialized)
struct ClaudeOwnerRenewalControllerTests {
    @Test("five-minute owner renewal preserves the same authority for 24 hours without model calls")
    func twentyFourHours() throws {
        let fixture = try OwnerRenewalFixture()
        defer { fixture.controller.stop() }
        let epoch = fixture.authority.identity.authorityEpoch
        for minute in 1...1440 {
            fixture.clock.advance(60)
            fixture.controller.tick()
            #expect(fixture.controller.snapshot().renewalSequence == UInt64(minute / 5))
            #expect(fixture.controller.snapshot().terminalReason == nil)
            guard case .active(let lease) = fixture.authority.snapshot() else {
                Issue.record("Owner lease expired during continuous renewal"); return
            }
            #expect(lease.authorityEpoch == epoch)
        }
        #expect(fixture.record.requests.count == 288)
        for data in fixture.record.requests {
            let request = try StrictJSONTransport.object(from: data)
            #expect(request["operation"] as? String == "renew")
            #expect(request["role"] as? String == "owner")
        }
        #expect(fixture.record.closures.isEmpty)
    }

    @Test("continuous sleep time is judged against the remaining lease", arguments: [55, 56, 58])
    func sleepUsesRemainingLease(minutes: Int) throws {
        let fixture = try OwnerRenewalFixture()
        defer { fixture.controller.stop() }
        fixture.clock.advance(4 * 60)
        fixture.controller.tick()
        #expect(fixture.record.requests.isEmpty)
        fixture.clock.advance(UInt64(minutes * 60))
        fixture.controller.tick()
        if minutes == 55 {
            #expect(fixture.controller.snapshot().renewalSequence == 1)
            #expect(fixture.controller.snapshot().terminalReason == nil)
        } else {
            #expect(fixture.record.requests.isEmpty)
            #expect(fixture.controller.snapshot().terminalReason == .expired)
            #expect(fixture.record.closures == [.expired])
        }
    }

    @Test("a renewal accepted before expiry can return after the superseded deadline")
    func responseCrossesOldDeadline() throws {
        let fixture = try OwnerRenewalFixture(behavior: .delayedResponse)
        defer { fixture.controller.stop() }
        fixture.clock.advance(3599)
        fixture.controller.tick()
        #expect(fixture.controller.snapshot().terminalReason == nil)
        #expect(fixture.controller.snapshot().renewalSequence == 1)
        #expect(fixture.controller.snapshot().deadlineNanoseconds > fixture.clock.nowNanoseconds())
    }

    @Test("the real timer invokes a due exchange and cannot restart after stop")
    func automaticTimer() throws {
        let fixture = try OwnerRenewalFixture()
        fixture.clock.advance(300)
        try fixture.controller.start()
        #expect(fixture.record.entered.wait(timeout: .now() + 3) == .success)
        fixture.controller.stop()
        #expect(fixture.record.closures == [.stopped])
        #expect(throws: CoordinatorError.self) { try fixture.controller.start() }
        fixture.controller.tick()
        #expect(fixture.record.requests.count == 1)
    }

    @Test("all observed end reasons are sent once and terminate the controller",
           arguments: ClaudeSessionAuthority.RevocationReason.allCases)
    func explicitEnd(reason: ClaudeSessionAuthority.RevocationReason) throws {
        let fixture = try OwnerRenewalFixture()
        fixture.controller.end(reason: reason)
        #expect(fixture.record.requests.count == 1)
        #expect(fixture.record.closures == [.ended])
        #expect(fixture.controller.snapshot().terminalReason == .ended)
        #expect(fixture.authority.snapshot() == .terminated(.revoked(reason)))
        fixture.controller.end(reason: reason)
        fixture.controller.stop()
        fixture.clock.advance(300)
        fixture.controller.tick()
        #expect(fixture.record.requests.count == 1)
        #expect(fixture.record.closures.count == 1)
        #expect(throws: CoordinatorError.self) { try fixture.controller.start() }
    }

    @Test("transport failure never retries, advances sequence, or re-enrolls")
    func responseLossIsTerminal() throws {
        let fixture = try OwnerRenewalFixture(behavior: .lostResponse)
        fixture.clock.advance(300)
        fixture.controller.tick()
        #expect(fixture.controller.snapshot().terminalReason == .transportFailed)
        #expect(fixture.controller.snapshot().renewalSequence == 0)
        #expect(fixture.record.closures == [.transportFailed])
        for _ in 0..<10 { fixture.clock.advance(300); fixture.controller.tick() }
        #expect(fixture.record.requests.count == 1)
    }

    @Test("response correlation, sequence, deadline, secrets and authority cannot be substituted",
           arguments: [OwnerRenewalBehavior.requestID, .owner, .epoch, .sequence, .deadline, .secret])
    func malformedResponseRejected(behavior: OwnerRenewalBehavior) throws {
        let fixture = try OwnerRenewalFixture(behavior: behavior)
        fixture.clock.advance(300)
        fixture.controller.tick()
        #expect(fixture.controller.snapshot().terminalReason == .responseInvalid)
        #expect(fixture.controller.snapshot().renewalSequence == 0)
        #expect(fixture.record.closures == [.responseInvalid])
        fixture.controller.tick()
        #expect(fixture.record.requests.count == 1)
    }

    @Test("expired and revoked server responses close the private owner transport", arguments: ["expired", "revoked"])
    func authorityErrorsAreTerminal(code: String) throws {
        let fixture = try OwnerRenewalFixture(rejection: code)
        fixture.clock.advance(300)
        fixture.controller.tick()
        let expected: ClaudeOwnerRenewalController.StopReason = code == "expired" ? .expired : .revoked
        #expect(fixture.record.closures == [expected])
        #expect(fixture.controller.snapshot().terminalReason == expected)
        #expect(fixture.controller.snapshot().renewalSequence == 0)
    }

    @Test("clock regression, sentinel overflow and sequence exhaustion fail closed", arguments: ["backward", "sentinel", "sequence"])
    func arithmeticBoundaries(kind: String) throws {
        let fixture = try OwnerRenewalFixture(initialSequence: kind == "sequence" ? UInt64.max : 0)
        if kind == "backward" { fixture.clock.set(0) }
        else if kind == "sentinel" { fixture.clock.set(UInt64.max) }
        else { fixture.clock.advance(300) }
        fixture.controller.tick()
        let expected: ClaudeOwnerRenewalController.StopReason = kind == "sequence" ? .sequenceExhausted : .clockInvalid
        #expect(fixture.record.requests.isEmpty)
        #expect(fixture.record.closures == [expected])
        fixture.clock.set(1_000_000_000)
        fixture.controller.tick()
        #expect(fixture.record.requests.isEmpty)
    }

    @Test("concurrent ticks coalesce and stop defeats a late successful response")
    func stopDuringExchange() throws {
        let fixture = try OwnerRenewalFixture(behavior: .pause)
        fixture.clock.advance(300)
        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { fixture.controller.tick(); finished.signal() }
        #expect(fixture.record.entered.wait(timeout: .now() + 3) == .success)
        fixture.controller.tick()
        #expect(fixture.record.requests.count == 1)
        fixture.controller.stop()
        fixture.record.resume.signal()
        #expect(finished.wait(timeout: .now() + 3) == .success)
        #expect(fixture.record.closures == [.stopped])
        #expect(fixture.controller.snapshot().renewalSequence == 0)
        #expect(fixture.controller.snapshot().terminalReason == .stopped)
    }

    @Test("end during an uncertain exchange closes without overlapping another frame")
    func endDuringExchange() throws {
        let fixture = try OwnerRenewalFixture(behavior: .pause)
        fixture.clock.advance(300)
        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { fixture.controller.tick(); finished.signal() }
        #expect(fixture.record.entered.wait(timeout: .now() + 3) == .success)
        fixture.controller.end(reason: .childExited)
        fixture.record.resume.signal()
        #expect(finished.wait(timeout: .now() + 3) == .success)
        #expect(fixture.record.requests.count == 1)
        #expect(fixture.record.closures == [.endUnconfirmed])
        #expect(fixture.controller.snapshot().renewalSequence == 0)
    }
}

enum OwnerRenewalBehavior: Sendable {
    case normal, lostResponse, requestID, owner, epoch, sequence, deadline, secret, pause, delayedResponse
}

private final class OwnerRenewalClock: CoordinatorContinuousClock, @unchecked Sendable {
    private let lock = NSLock()
    private var now: UInt64 = 1_000_000_000
    func nowNanoseconds() -> UInt64 { lock.withLock { now } }
    func advance(_ seconds: UInt64) { lock.withLock { now += seconds * 1_000_000_000 } }
    func set(_ value: UInt64) { lock.withLock { now = value } }
}

private final class OwnerRenewalRecord: @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [Data] = []
    private var closed: [ClaudeOwnerRenewalController.StopReason] = []
    let entered = DispatchSemaphore(value: 0)
    let resume = DispatchSemaphore(value: 0)
    var requests: [Data] { lock.withLock { sent } }
    var closures: [ClaudeOwnerRenewalController.StopReason] { lock.withLock { closed } }
    func received(_ data: Data) { lock.withLock { sent.append(data) }; entered.signal() }
    func close(_ reason: ClaudeOwnerRenewalController.StopReason) { lock.withLock { closed.append(reason) } }
}

private final class OwnerRenewalFixture: @unchecked Sendable {
    let clock = OwnerRenewalClock()
    let record = OwnerRenewalRecord()
    let authority: ClaudeSessionAuthority
    let controller: ClaudeOwnerRenewalController
    init(behavior: OwnerRenewalBehavior = .normal, rejection: String? = nil, initialSequence: UInt64 = 0) throws {
        let identity = ClaudeSessionAuthority.Identity(scopeID: UUID(), nativeSessionID: UUID(), sessionIncarnation: UUID(),
            serviceIncarnation: UUID(), ownerConnectionID: UUID(), authorityEpoch: UUID())
        authority = try ClaudeSessionAuthority(identity: identity, clock: clock)
        guard case .active(let lease) = authority.snapshot() else { throw CoordinatorError("owner_fixture_invalid") }
        let corpus = RuntimeSecretCorpus()
        let secret = String(repeating: "c", count: 64)
        corpus.register(secret)
        let record = self.record
        let authority = self.authority
        let clock = self.clock
        controller = try ClaudeOwnerRenewalController(identity: identity,
            initialDeadlineNanoseconds: lease.deadlineNanoseconds, initialRenewalSequence: initialSequence,
            clock: clock, secretCorpus: corpus, exchange: { data in
                record.received(data)
                if behavior == .pause {
                    guard record.resume.wait(timeout: .now() + 5) == .success else { throw CoordinatorError("owner_fixture_timeout") }
                }
                let codec = ClaudeProductWireCodec(credentialCorpus: corpus)
                let request = try codec.decodeRequest(data)
                var response = try StrictJSONTransport.object(from: request.canonicalJSON)
                let payload = response.removeValue(forKey: "payload") as! [String: String]
                response["kind"] = "response"
                if let rejection {
                    response["ok"] = false
                    response["error"] = ["code": rejection]
                } else if request.operation == "renew" {
                    let lease = try authority.renew(owner: authority.ownerHandle, sequence: UInt64(payload["renewal_sequence"]!)!)
                    response["ok"] = true
                    response["result"] = ["lease": ["deadline_nanoseconds": String(lease.deadlineNanoseconds),
                                                   "renewal_sequence": String(lease.renewalSequence)]]
                } else {
                    let reason: ClaudeSessionAuthority.RevocationReason
                    switch payload["reason"] {
                    case "child_exited": reason = .childExited
                    case "session_ended": reason = .sessionEnded
                    case "user_disconnected": reason = .userDisconnected
                    case "service_replaced": reason = .serviceReplaced
                    default: reason = .ownerDisconnected
                    }
                    authority.revoke(reason: reason)
                    response["ok"] = true
                    response["result"] = ["ended": true]
                }
                if behavior == .lostResponse { throw CoordinatorError("owner_fixture_response_lost") }
                if behavior == .delayedResponse { clock.advance(2) }
                if behavior == .requestID { response["request_id"] = UUID().uuidString.lowercased() }
                if behavior == .owner || behavior == .epoch {
                    var fields = response["authority"] as! [String: String]
                    fields[behavior == .owner ? "owner_connection_id" : "authority_epoch"] = UUID().uuidString.lowercased()
                    response["authority"] = fields
                }
                if behavior == .sequence || behavior == .deadline {
                    response["result"] = ["lease": [
                        "deadline_nanoseconds": behavior == .deadline ? String(UInt64.max) : String(lease.deadlineNanoseconds),
                        "renewal_sequence": behavior == .sequence ? "99" : "1",
                    ]]
                }
                if behavior == .secret { response["result"] = ["lease": ["deadline_nanoseconds": secret, "renewal_sequence": "1"]] }
                return try StrictJSONTransport.data(forJSONObject: response)
            }, disconnected: { record.close($0) })
    }
}
