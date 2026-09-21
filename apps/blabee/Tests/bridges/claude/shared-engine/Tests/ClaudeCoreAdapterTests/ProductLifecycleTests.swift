@testable import ClaudeCoreAdapter
import CoordinatorSwift
import Foundation
import Testing

private func lifecycleHook(_ f: ProductAuthorityFixture, _ event: String,
                           _ fields: [String: Any] = [:]) throws -> ClaudeProductWireCodec.Envelope {
    var payload: [String: Any] = ["event": event,
        "native_session_id": f.configuration.identity.nativeSessionID.uuidString.lowercased(), "cwd": f.directory.path]
    payload.merge(fields) { _, value in value }
    return try f.envelope("hook", payload: payload, role: "hook")
}

private func lifecycleCard(_ f: ProductAuthorityFixture) throws -> [String: Any] {
    let snapshot = try f.snapshot()
    return try #require((snapshot["cards"] as? [[String: Any]])?.first)
}

private func lifecycleStop(_ f: ProductAuthorityFixture, background: [String]? = []) throws {
    var fields: [String: Any] = ["prompt_id": f.promptID!]
    if let background { fields["background_task_ids"] = background }
    try f.hook("Stop", fields)
}

private func lifecycleRenew(_ f: ProductAuthorityFixture, sequence: inout UInt64, next: inout UInt64) throws {
    if f.clock.nowNanoseconds() >= next {
        sequence += 1
        _ = try f.authority.renew(owner: f.authority.ownerHandle, sequence: sequence)
        next = f.clock.nowNanoseconds() + 300_000_000_000
    }
}

@Suite("Product native lifecycle")
struct ProductLifecycleTests {
    @Test("Proposal replay keys preserve the existing nonblank text grammar", arguments: ["proposal A", " proposal A ", "proposal\tA", "proposal\nA"])
    func proposalWhitespaceRemainsLiteral(_ identifier: String) throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.prompt(); try f.open()
        var proposal = productProposal()
        var value = try #require(proposal["value"] as? [String: Any])
        value["proposal_id"] = identifier
        proposal["value"] = value
        try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": f.boundaryID!, "proposal": proposal])
        #expect((try f.snapshot()["cards"] as? [[String: Any]])?.count == 1)
        let count = try f.rawEventCount()
        productWireRejected("binding_mismatch") {
            try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": f.boundaryID!, "proposal": proposal])
        }
        #expect(try f.rawEventCount() == count)
    }

    @Test("Compact creates a new boundary in the same episode and cannot replay an old Stop or compact")
    func compactReboundsOnlyCurrentPrompt() throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.prompt(); try f.open(); try f.ready(); try f.emit()
        let stop = try lifecycleHook(f, "Stop", ["prompt_id": f.promptID!, "background_task_ids": [String]()])
        try f.call(stop)
        let old = try lifecycleCard(f)
        let oldBinding = try #require(old["binding"] as? [String: Any])
        let compact = try lifecycleHook(f, "SessionStart", ["source": "compact", "prompt_id": f.promptID!])
        let reply = try f.call(compact)
        f.boundaryID = try #require(reply["boundary_id"] as? String)
        #expect(f.boundaryID != oldBinding["decision_boundary_id"] as? String)
        #expect(try f.snapshot()["ready"] as? Bool == false)
        try f.emit()
        let current = try lifecycleCard(f)
        let binding = try #require(current["binding"] as? [String: Any])
        #expect(binding["source_prompt_id"] as? String == f.promptID)
        #expect(binding["episode_id"] as? String == oldBinding["episode_id"] as? String)
        #expect(binding["episode_root_prompt_id"] as? String == oldBinding["episode_root_prompt_id"] as? String)
        let count = try f.rawEventCount()
        productWireRejected("binding_mismatch") { try f.call(compact) }
        productWireRejected("binding_mismatch") { try f.call(stop) }
        #expect(try f.rawEventCount() == count)
        try f.ready()
        productRejected("claude_session_stop_required") { try f.select() }
        try lifecycleStop(f)
        try f.select()
    }

    @Test("Compact without an exact current native prompt requires new input and preserves old reports", arguments: ["missing", "mismatch", "claimed_missing", "claimed_mismatch"])
    func compactNeedsExactObservation(_ variant: String) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let previous = f.boundaryID!
        var selection: String?
        if variant.hasPrefix("claimed") {
            let event = try f.selectedEvent(); try f.claim(event)
            selection = event["selection_id"] as? String
        }
        let authority = f.authority.snapshot()
        var fields: [String: Any] = ["source": "compact"]
        if variant.hasSuffix("mismatch") { fields["prompt_id"] = productID() }
        let reply = try f.hook("SessionStart", fields)
        #expect(reply["observation_status"] as? String == "new_prompt_required")
        #expect(reply["boundary_id"] is NSNull)
        #expect(f.authority.snapshot() == authority)
        productWireRejected("binding_mismatch") {
            try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": previous, "proposal": productProposal()])
        }
        if let selection { try f.complete(selection) }
        try f.prompt(); try f.emit()
        #expect((try f.snapshot()["cards"] as? [[String: Any]])?.count == 1)
    }

    @Test("Missing background observation differs from empty and active background tasks")
    func backgroundObservationIsNotInferred() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        for (tasks, state, count) in [(Optional<[String]>.none, "unknown", Optional<Int>.none),
                                     (Optional(["fixture-task"]), "active", Optional(1)),
                                     (Optional([String]()), "idle", Optional(0))] {
            try lifecycleStop(f, background: tasks)
            let snapshot = try f.snapshot()
            let observed = try #require(snapshot["native_observation"] as? [String: Any])
            #expect(observed["background_state"] as? String == state)
            if let count { #expect(observed["background_task_count"] as? Int == count) }
            else { #expect(observed["background_task_count"] is NSNull) }
            #expect(snapshot["selection_enabled"] as? Bool == (state == "idle"))
            #expect((snapshot["cards"] as? [[String: Any]])?.count == 1)
            #expect((snapshot["outcomes"] as? [[String: Any]])?.isEmpty == true)
        }
    }

    @Test("StopFailure preserves its reason without declaring work complete or cancelled", arguments: ["api_error", "interrupted", "unknown"])
    func failuresRequireFreshInput(_ reason: String) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let event = try f.selectedEvent(); try f.claim(event)
        try f.prompt(); try f.emit(); try lifecycleStop(f)
        let failure = try lifecycleHook(f, "StopFailure", ["failure_code": reason, "prompt_id": f.promptID!])
        let result = try f.call(failure)
        #expect(result["observation_status"] as? String == "new_prompt_required")
        let snapshot = try f.snapshot()
        let observed = try #require(snapshot["native_observation"] as? [String: Any])
        #expect(observed["failure_code"] as? String == reason)
        #expect(snapshot["selection_enabled"] as? Bool == false)
        #expect((snapshot["outcomes"] as? [[String: Any]])?.isEmpty == true)
        productWireRejected("binding_mismatch") { try f.call(failure) }
        try f.complete(event["selection_id"] as! String)
    }

    @Test("One thousand prompt observations retain only the current prompt and reject old IDs")
    func thousandPrompts() throws {
        let f = try ProductAuthorityFixture()
        try f.startup()
        let firstID = productID()
        let first = try lifecycleHook(f, "UserPromptSubmit", ["prompt_id": firstID, "prompt_sha256": productDigest("First")])
        try f.call(first)
        for _ in 1..<1_000 { try f.prompt() }
        let retained = f.native.productRetainedStateCounts()
        #expect(retained.prompts == 1 && retained.selections == 0 && retained.references == 0 && retained.claims == 0)
        #expect(f.replay.count == 1_000)
        productWireRejected("binding_mismatch") { try f.call(first) }
        let repackaged = try lifecycleHook(f, "UserPromptSubmit", ["prompt_id": firstID, "prompt_sha256": productDigest("First")])
        productWireRejected("binding_mismatch") { try f.call(repackaged) }
        let currentID = f.promptID!
        let replayCount = f.replay.count
        try f.hook("UserPromptSubmit", ["prompt_id": currentID, "prompt_sha256": productDigest("Prepare fixture choices.")])
        #expect(f.replay.count == replayCount)
    }

    @Test("A conflicting current prompt digest retires unclaimed work and preserves claimed reports", arguments: [false, true])
    func conflictingCurrentPromptRetiresObservation(_ hasClaimedReport: Bool) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        var selectionID: String?
        if hasClaimedReport {
            let event = try f.selectedEvent(); try f.claim(event)
            selectionID = try #require(event["selection_id"] as? String)
            try f.prompt(); try f.emit(); try lifecycleStop(f)
        }
        let card = try lifecycleCard(f)
        let replayCount = f.replay.count
        let authority = f.authority.snapshot()
        let promptID = f.promptID!
        try f.hook("UserPromptSubmit", ["prompt_id": promptID,
            "prompt_sha256": productDigest("Prepare fixture choices.")])
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        productWireRejected("binding_mismatch") {
            try f.hook("UserPromptSubmit", ["prompt_id": promptID,
                "prompt_sha256": productDigest("Different current input.")])
        }
        let snapshot = try f.snapshot()
        #expect(snapshot["boundary_id"] is NSNull)
        #expect(snapshot["ready"] as? Bool == false)
        #expect(snapshot["selection_enabled"] as? Bool == false)
        #expect((snapshot["cards"] as? [[String: Any]])?.isEmpty == true)
        #expect(snapshot["pending_report_count"] as? Int == (hasClaimedReport ? 1 : 0))
        #expect(f.replay.count == replayCount)
        #expect(f.authority.snapshot() == authority)
        productRejected("claude_session_boundary_mismatch") { try f.select(card: card) }
        if let selectionID { try f.complete(selectionID) }
        try f.prompt(); try f.emit(); try lifecycleStop(f); try f.ready(); try f.select()
    }

    @Test("Five hundred cycles through a volatile journal retain real core outcomes and ordered Channel events")
    func fiveHundredCycles() throws {
        try completedCycles(500, storage: .lifecycleMemory)
    }

    @Test("Three volatile-journal cycles smoke-test the long lifecycle fixture and its assertions")
    func threeMemoryCycles() throws {
        try completedCycles(3, storage: .lifecycleMemory)
    }

    @Test("Three complete cycles preserve the same lifecycle and replay behavior through actual SQLite")
    func threeSQLiteCycles() throws {
        try completedCycles(3, storage: .sqlite)
    }

    private func completedCycles(_ cycles: Int, storage: ProductAuthorityFixture.Storage) throws {
        let f = try ProductAuthorityFixture(storage: storage)
        #expect((f.journal is SQLiteJournal) == (storage == .sqlite))
        let progressURL = f.directory.appendingPathComponent("lifecycle-progress.txt")
        if cycles >= 100 { try "0\n".write(to: progressURL, atomically: true, encoding: .utf8) }
        try f.startup(); try f.open()
        var renewal: UInt64 = 0, nextRenewal: UInt64 = 300_000_000_000, delivery: UInt64 = 0
        var firstProposal: String?, firstSelection: String?
        var originalSelections: Set<String> = []
        for index in 0..<cycles {
            // Foundation JSON temporaries belong to one test iteration. The
            // journal, native state and original IDs retain their real owners.
            try autoreleasepool {
                if index > 0 { f.clock.advance(5); _ = try f.poll() }
                try lifecycleRenew(f, sequence: &renewal, next: &nextRenewal)
                try f.prompt()
                try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
                let probeValue = try f.poll()
                let probe = try #require(probeValue)
                delivery += 1
                #expect(probe["delivery_sequence"] as? String == String(delivery))
                try f.call("readiness.ack", ["bridge_id": f.bridgeID!, "probe_id": probe["probe_id"]!, "nonce": probe["nonce"]!])
                let proposal = productProposal()
                if index == 0 { firstProposal = (proposal["value"] as? [String: Any])?["proposal_id"] as? String }
                try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": f.boundaryID!, "proposal": proposal])
                try lifecycleStop(f)
                let event = try f.selectedEvent()
                delivery += 1
                #expect(event["delivery_sequence"] as? String == String(delivery))
                if index == 0 { firstSelection = event["selection_id"] as? String }
                originalSelections.insert(try #require(event["selection_id"] as? String))
                #expect(try f.poll() == nil)
                try f.claim(event); try f.complete(event["selection_id"] as! String)
            }
            if cycles >= 100 && (index + 1) % 10 == 0 {
                try "\(index + 1)\n".write(to: progressURL, atomically: true, encoding: .utf8)
            }
            if cycles >= 100 && (index + 1) % 100 == 0 {
                FileHandle.standardError.write(Data("ProductLifecycleTests completed cycles: \(index + 1)\n".utf8))
            }
        }
        let snapshot = try f.snapshot()
        #expect((snapshot["history"] as? [String: Any])?["total_outcomes"] as? Int == cycles)
        #expect(delivery == UInt64(cycles * 2))
        let state = try CoordinatorSemanticReplay.replay(f.journal.load())
        let completed = state.continuations.values.filter { $0.workOutcome?.status == "succeeded" }
        #expect(completed.count == cycles)
        let recordedSelections = Set(completed.compactMap { state.boundary(for: $0.binding)?.selection?.selectionID })
        #expect(recordedSelections == originalSelections)
        #expect(completed.allSatisfy {
            $0.workOutcome?.summary == ClaudeCoreAdapter.modelReportPrefix + "The model reports that the fixture was read."
        })
        let retained = f.native.productRetainedStateCounts()
        #expect(retained.prompts == 1 && retained.selections == 0 && retained.references <= 1 && retained.claims == 0)
        try f.prompt()
        var proposal = productProposal(), value = productProposal()["value"] as! [String: Any]
        value["proposal_id"] = firstProposal!
        proposal["value"] = value
        productWireRejected("binding_mismatch") {
            try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": f.boundaryID!, "proposal": proposal])
        }
        try f.emit(); try lifecycleStop(f)
        let card = try lifecycleCard(f)
        let bindingObject = try #require(card["binding"] as? [String: Any])
        let binding = try CoordinatorBinding(jsonObject: bindingObject)
        let packet = try #require(card["packet"] as? [String: Any])
        let options = try #require(packet["choices"] as? [[String: Any]])
        productRejected("claude_metadata_replay") {
            _ = try f.native.productSelect(identity: f.configuration.identity, credential: f.configuration.selectorToken,
                binding: binding, packetID: packet["packet_id"] as! String,
                revision: ExactJSONInteger.int64(packet["revision"])!, optionID: options[0]["option_id"] as! String,
                selectionID: UUID(uuidString: firstSelection!)!)
        }
    }

    @Test("One hundred thousand normal polls and cached snapshots perform no core or replay writes")
    func hundredThousandPollsAreReadOnly() throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.open()
        let request = try f.envelope("bridge.poll", payload: ["bridge_id": f.bridgeID!])
        let calls = f.meter.count, replays = f.replay.count
        let events = try f.rawEventCount()
        var renewal: UInt64 = 0, nextRenewal: UInt64 = 300_000_000_000
        for index in 0..<100_000 {
            let hasNoEvent = try autoreleasepool {
                if index > 0 && index % 7 == 0 { f.clock.advance(1) }
                try lifecycleRenew(f, sequence: &renewal, next: &nextRenewal)
                let result = try f.call(request)
                return result["event"] is NSNull
            }
            guard hasNoEvent else { Issue.record("Unexpected Channel event"); return }
        }
        for _ in 0..<1_000 { try autoreleasepool { _ = try f.snapshot() } }
        #expect(f.meter.count == calls && f.replay.count == replays)
        #expect(try f.rawEventCount() == events)
        let retained = f.native.productRetainedStateCounts()
        #expect(retained.prompts == 0 && retained.selections == 0 && retained.references == 0 && retained.claims == 0)
    }

    @Test("Poll and Pet reads defer durable retirement and cannot erase a heartbeat gap", arguments: ["card", "probe", "selection"])
    func expiredPollRemainsReadOnly(_ pending: String) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let oldCard = try lifecycleCard(f)
        if pending == "probe" { try f.call("readiness.begin", ["bridge_id": f.bridgeID!]) }
        if pending == "selection" { try f.select() }
        let calls = f.meter.count, replays = f.replay.count
        let events = try f.rawEventCount()
        f.clock.advance(pending == "probe" ? 300 : 7)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == false)
        #expect(try f.poll() == nil)
        #expect(try f.poll() == nil)
        let snapshot = try f.snapshot()
        #expect(snapshot["boundary_id"] is NSNull)
        #expect(snapshot["ready"] as? Bool == false)
        #expect((snapshot["cards"] as? [[String: Any]])?.isEmpty == true)
        #expect(f.meter.count == calls && f.replay.count == replays)
        #expect(try f.rawEventCount() == events)
        #expect(try f.native.nextProductWakeNanoseconds(identity: f.configuration.identity,
            credential: f.configuration.selectorToken) == f.clock.nowNanoseconds())
        // The next mutation drains the same debt, then a new probe may prove
        // delivery. It still cannot revive the old task boundary.
        try f.ready()
        #expect(f.meter.count > calls)
        #expect(try f.snapshot()["boundary_id"] is NSNull)
        productRejected("claude_session_boundary_mismatch") { try f.select(card: oldCard) }
    }

    @Test("Rate windows recover with time and do not expire the owner lease")
    func rateLimitsRecover() throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.open()
        for _ in 0..<8 { _ = try f.poll() }
        productWireRejected("capacity") { _ = try f.poll() }
        f.clock.advance(1); _ = try f.poll()
        for _ in 0..<12 { try f.call("readiness.begin", ["bridge_id": f.bridgeID!]) }
        productWireRejected("capacity") { try f.call("readiness.begin", ["bridge_id": f.bridgeID!]) }
        f.clock.advance(60); _ = try f.poll()
        try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        #expect(f.native.productRetainedStateCounts().references == 1)
        guard case .active = f.authority.snapshot() else { Issue.record("Rate limit terminated authority"); return }
    }

    @Test("Thirty-two active reports apply backpressure and a completed report releases one slot")
    func claimBackpressureIsActiveOnly() throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.open()
        var first: String?
        for index in 0..<32 {
            if index > 0 { f.clock.advance(5); _ = try f.poll() }
            try f.prompt(); try f.ready(); try f.emit(); try lifecycleStop(f)
            let event = try f.selectedEvent(); try f.claim(event)
            if first == nil { first = event["selection_id"] as? String }
        }
        try f.prompt(); try f.emit(); try lifecycleStop(f)
        productRejected("claude_session_capacity") { try f.select() }
        let full = f.native.productRetainedStateCounts()
        #expect(full.claims == 32 && full.references <= 33)
        try f.complete(first!)
        #expect(f.native.productRetainedStateCounts().claims == 31)
        let event = try f.selectedEvent(); try f.claim(event)
        #expect(f.native.productRetainedStateCounts().claims == 32)
    }

    @Test("Replay storage failure revokes only the affected authority before new native state advances")
    func replayStorageFailureIsTerminal() throws {
        let f = try ProductAuthorityFixture(), other = try ProductAuthorityFixture()
        try f.prepare(); try other.prepare()
        let count = try f.rawEventCount()
        f.replay.failNextConsume()
        productWireRejected("revoked") { try f.prompt() }
        #expect(try f.rawEventCount() == count)
        #expect(f.authority.snapshot() == .terminated(.revoked(.serviceReplaced)))
        #expect(try other.snapshot()["selection_enabled"] as? Bool == true)
    }
}
