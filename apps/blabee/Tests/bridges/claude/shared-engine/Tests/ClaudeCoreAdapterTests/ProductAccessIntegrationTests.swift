import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing

private final class ClaudeAccessGate: @unchecked Sendable {
    private let lock = NSLock()
    private var generation: UInt64 = 1
    private var allowed = true
    func check() throws -> UInt64 {
        try lock.withLock {
            guard allowed else { throw CoordinatorError("product_access_suspended") }
            return generation
        }
    }
    func suspend() { lock.withLock { allowed = false; generation += 1 } }
    func resume() { lock.withLock { allowed = true } }
}

@Suite("Claude product account access")
struct ClaudeProductAccessIntegrationTests {
    @Test("Old cards cannot be selected after account authority changes")
    func oldCard() throws {
        let access = ClaudeAccessGate()
        let fixture = try ProductAuthorityFixture(storage: .lifecycleMemory, productAccessCheck: access.check)
        try fixture.prepare()
        let card = try #require((fixture.snapshot()["cards"] as? [[String: Any]])?.first)
        access.suspend(); access.resume()
        #expect(throws: (any Error).self) { try fixture.select(card: card) }
        let poll = try fixture.waiterRequest("hook.poll")
        #expect(poll["status"] as? String == "closed")
    }

    @Test("Pending selection is not delivered after suspension and is never automatically resent")
    func pendingDelivery() throws {
        let access = ClaudeAccessGate()
        let fixture = try ProductAuthorityFixture(storage: .lifecycleMemory, productAccessCheck: access.check)
        try fixture.prepare()
        _ = try fixture.select()
        access.suspend()
        #expect(try fixture.waiterRequest("hook.poll")["status"] as? String == "closed")
        access.resume()
        #expect(try fixture.waiterRequest("hook.poll")["status"] as? String == "closed")
    }

    @Test("Delivered action claim is denied after suspension; an already claimed result can complete")
    func claimAndCompletion() throws {
        let access = ClaudeAccessGate()
        let fixture = try ProductAuthorityFixture(storage: .lifecycleMemory, productAccessCheck: access.check)
        try fixture.prepare()
        let event = try fixture.selectedEvent()
        access.suspend()
        #expect(throws: (any Error).self) { try fixture.claim(event) }

        let otherAccess = ClaudeAccessGate()
        let other = try ProductAuthorityFixture(storage: .lifecycleMemory, productAccessCheck: otherAccess.check)
        try other.prepare()
        let otherEvent = try other.selectedEvent()
        _ = try other.claim(otherEvent)
        otherAccess.suspend()
        try other.complete(#require(otherEvent["selection_id"] as? String))
    }
}
