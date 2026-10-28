import AppKit
import Foundation
import Testing
@testable import BlabeeCoordinator

@Suite("Update termination defers AppKit entry until the update Task returns")
@MainActor
struct PetAppUpdateTerminationTests {
    @Test("Termination is deferred beyond the update Task and stays on the main thread")
    func terminationFromUpdateTask() async {
        var events: [String] = []
        let attempt = Task { @MainActor in
            PetAppUpdateTermination.request {
                // Real AppKit termination is checked in a separate process; the
                // test runner must never be terminated by this scheduling test.
                #expect(Thread.isMainThread)
                events.append("terminate")
            }
            events.append("update-task-returned")
        }
        await attempt.value
        let deadline = ContinuousClock.now.advanced(by: .seconds(2))
        while events.count < 2, ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(5))
        }
        #expect(events == ["update-task-returned", "terminate"])
    }
}
