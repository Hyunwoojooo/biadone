import Foundation
import Testing
@testable import CoordinatorSwift

@Suite("Shared provider arrival ordering")
struct PetEventArrivalLedgerTests {
    @Test("Interleaved providers retain first admission and clean up by exact scope")
    func interleavedArrivals() {
        let ledger = PetEventArrivalLedger()
        #expect(ledger.record(scopeID: "claude-a", kind: "decision", eventID: "same") == 1)
        #expect(ledger.record(scopeID: "codex-primary", kind: "permission", eventID: "same") == 2)
        #expect(ledger.record(scopeID: "claude-b", kind: "decision", eventID: "same") == 3)
        #expect(ledger.record(scopeID: "claude-a", kind: "decision", eventID: "same") == 1)
        ledger.removeScope("claude-a")
        #expect(ledger.sequence(scopeID: "claude-a", kind: "decision", eventID: "same") == nil)
        #expect(ledger.sequence(scopeID: "claude-b", kind: "decision", eventID: "same") == 3)
        #expect(ledger.sequence(scopeID: "unknown", kind: "decision", eventID: "same") == nil)
        #expect(ledger.record(scopeID: "claude-a", kind: "decision", eventID: "new") == 4)
    }

    @Test("Concurrent receipts receive unique process-local order without duplicating retries")
    func concurrentArrivals() async {
        let ledger = PetEventArrivalLedger()
        let numbers = await withTaskGroup(of: UInt64.self, returning: [UInt64].self) { group in
            for i in 0..<100 {
                group.addTask { ledger.record(scopeID: "scope-\(i % 4)", kind: "decision", eventID: "event-\(i)") }
            }
            var values: [UInt64] = []
            for await value in group { values.append(value) }
            return values
        }
        #expect(Set(numbers) == Set(1...UInt64(100)))
        for i in 0..<100 {
            #expect(ledger.record(scopeID: "scope-\(i % 4)", kind: "decision", eventID: "event-\(i)") <= 100)
        }
    }
}
