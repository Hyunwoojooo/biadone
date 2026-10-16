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
    @Test("Automatic and Pet probes expose the same nonce only through the authenticated MCP check")
    func automaticProbeIsRetrievedDirectly() throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.open()
        let automaticData = try #require(try f.native.beginInitialProductReadiness(identity: f.configuration.identity,
            credential: f.configuration.selectorToken))
        let automatic = try StrictJSONTransport.object(from: automaticData)
        #expect(automatic["nonce"] == nil)
        #expect(try f.poll() == nil)
        let checked = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        #expect(checked["probe_id"] as? String == automatic["probe_id"] as? String)
        #expect(checked["expires_at_nanoseconds"] as? String == automatic["expires_at_nanoseconds"] as? String)
        let nonce = try #require(checked["nonce"] as? String)
        let pet = try StrictJSONTransport.object(from: f.native.beginProductReadiness(identity: f.configuration.identity,
            credential: f.configuration.selectorToken))
        #expect(pet["nonce"] == nil)
        #expect(pet["probe_id"] as? String == checked["probe_id"] as? String)
        #expect(!String(decoding: automaticData, as: UTF8.self).contains(nonce))
        #expect(try f.snapshot()["ready"] as? Bool == false)
        let ack = try f.call("readiness.ack", ["bridge_id": f.bridgeID!, "probe_id": checked["probe_id"]!, "nonce": nonce])
        #expect(ack["acknowledged"] as? Bool == true)
        productWireRejected("unavailable") {
            try f.call("readiness.ack", ["bridge_id": f.bridgeID!, "probe_id": checked["probe_id"]!, "nonce": nonce])
        }
    }

    @Test("A Pet recheck preserves the existing verified connection and its original expiry")
    func petRecheckDoesNotStrandAnIdleCard() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let pending = try StrictJSONTransport.object(from: f.native.beginProductReadiness(identity: f.configuration.identity,
            credential: f.configuration.selectorToken))
        #expect(pending["nonce"] == nil)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        let check = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        #expect(check["probe_id"] as? String == pending["probe_id"] as? String)
        #expect(check["nonce"] is String)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        for _ in 0..<75 { f.clock.advance(4); _ = try f.poll(); _ = try f.waiterRequest("hook.poll") }
        #expect(try f.snapshot()["ready"] as? Bool == false)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == false)
    }

    @Test("Hook polling delivers once without core writes and claim requires the exact native continuation prompt")
    func hookWaiterDeliversExactlyOnce() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let waiter = try #require(f.waiter)
        let generation = try #require(waiter["generation"] as? String)
        #expect(waiter["prompt_id"] as? String == f.promptID)
        #expect(waiter["boundary_id"] as? String == f.boundaryID)
        #expect(waiter["expires_at_nanoseconds"] as? String == "600000000000")
        let snapshot = try StrictJSONTransport.data(forJSONObject: f.snapshot())
        #expect(!String(decoding: snapshot, as: UTF8.self).contains(generation))
        let before = (f.meter.count, f.replay.count, try f.rawEventCount())
        #expect(try f.waiterRequest("hook.poll")["status"] as? String == "waiting")
        #expect(try f.poll() == nil)
        #expect(f.meter.count == before.0 && f.replay.count == before.1)
        #expect(try f.rawEventCount() == before.2)
        try f.select()
        let selected = (f.meter.count, f.replay.count, try f.rawEventCount())
        #expect(try f.poll() == nil)
        let delivered = try f.waiterRequest("hook.poll")
        let event = try #require(delivered["event"] as? [String: Any])
        #expect(delivered["status"] as? String == "delivered")
        #expect(event["delivery_sequence"] as? String == "1")
        #expect(event["expires_at_nanoseconds"] as? String == "120000000000")
        #expect(event["channel_source"] == nil && event["waiter_generation"] == nil)
        #expect(try f.waiterRequest("hook.poll")["status"] as? String == "closed")
        #expect(f.meter.count == selected.0 && f.replay.count == selected.1)
        #expect(try f.rawEventCount() == selected.2)
        productWireRejected("binding_mismatch") { try f.claim(event) }
        try f.observeSelection(event)
        #expect(f.boundaryID == waiter["boundary_id"] as? String)
        #expect(f.promptID != waiter["prompt_id"] as? String)
        let claim = try f.claim(event)
        #expect(claim["prompt_id"] as? String == f.promptID)
        #expect(claim["boundary_id"] as? String != waiter["boundary_id"] as? String)
        productWireRejected("binding_mismatch") { try f.claim(event) }
        try f.complete(event["selection_id"] as! String)
    }

    @Test("Old waiter generations and wrong native identities cannot poll or cancel the current Stop")
    func staleWaiterCannotAffectCurrentGeneration() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let old = try #require(f.waiter)
        try lifecycleStop(f)
        let current = try #require(f.waiter)
        #expect(old["generation"] as? String != current["generation"] as? String)
        #expect(try f.waiterRequest("hook.poll", waiter: old)["status"] as? String == "closed")
        #expect(try f.waiterRequest("hook.cancel", waiter: old)["cancelled"] as? Bool == false)
        #expect(try f.waiterRequest("hook.poll")["status"] as? String == "waiting")
        for field in ["native_session_id", "cwd", "prompt_id"] {
            var payload: [String: Any] = ["native_session_id": f.configuration.identity.nativeSessionID.uuidString.lowercased(),
                "cwd": f.directory.path, "prompt_id": current["prompt_id"]!, "waiter_generation": current["generation"]!]
            payload[field] = field == "cwd" ? "/foreign-project" : productID()
            if field == "prompt_id" {
                #expect(try f.call("hook.poll", payload, role: "hook")["status"] as? String == "closed")
            } else {
                productWireRejected("binding_mismatch") { try f.call("hook.poll", payload, role: "hook") }
            }
        }
        let request = try f.envelope("hook.poll", payload: [
            "native_session_id": f.configuration.identity.nativeSessionID.uuidString.lowercased(), "cwd": f.directory.path,
            "prompt_id": current["prompt_id"]!, "waiter_generation": current["generation"]!], role: "hook")
        productRejected("claude_session_forbidden") {
            _ = try f.native.handleProduct(request: request, credential: f.configuration.bridgeToken)
        }
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
    }

    @Test("Stop descriptors require a first poll and a lost Hook process cannot leave the card selectable",
          arguments: [false, true])
    func waiterNeedsItsOwnLivePoll(_ armBeforeLoss: Bool) throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.prompt(); try f.open(); try f.ready(); try f.emit()
        let stop = try lifecycleHook(f, "Stop", ["prompt_id": f.promptID!, "background_task_ids": [String]()])
        try f.call(stop)
        let waiter = try #require(f.waiter)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == false)
        productRejected("claude_session_stop_required") { try f.select() }
        if armBeforeLoss {
            #expect(try f.waiterRequest("hook.poll")["status"] as? String == "waiting")
            #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
        }
        let firstDeadline = try f.native.nextProductWakeNanoseconds(identity: f.configuration.identity,
            credential: f.configuration.selectorToken)
        #expect(firstDeadline == 5_000_000_000)
        f.clock.advance(4); _ = try f.poll()
        f.clock.advance(1)
        #expect(try f.snapshot()["bridge_connected"] as? Bool == true)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == false)
        let before = (f.meter.count, f.replay.count, try f.rawEventCount())
        #expect(try f.waiterRequest("hook.poll", waiter: waiter)["status"] as? String == "closed")
        #expect(try f.waiterRequest("hook.poll", waiter: waiter)["status"] as? String == "closed")
        #expect(f.meter.count == before.0 && f.replay.count == before.1)
        #expect(try f.rawEventCount() == before.2)
        try lifecycleStop(f)
        #expect(f.waiter?["generation"] as? String != waiter["generation"] as? String)
        #expect(try f.snapshot()["selection_enabled"] as? Bool == true)
    }

    @Test("A delivered Hook may exit while the original MCP claim remains live")
    func deliveredHookDoesNotNeedFurtherPolls() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let event = try f.selectedEvent()
        for _ in 0..<3 { f.clock.advance(4); _ = try f.poll() }
        let claim = try f.claim(event)
        #expect(claim["selection_id"] as? String == event["selection_id"] as? String)
        try f.complete(event["selection_id"] as! String)
    }

    @Test("Cancellation retires only the matching generation without polling storage")
    func cancellationDoesNotWriteFromPollingPath() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let event = try f.selectedEvent()
        let before = (f.meter.count, f.replay.count, try f.rawEventCount())
        #expect(try f.waiterRequest("hook.cancel")["cancelled"] as? Bool == true)
        #expect(try f.waiterRequest("hook.cancel")["cancelled"] as? Bool == false)
        #expect(try f.waiterRequest("hook.poll")["status"] as? String == "closed")
        #expect(f.meter.count == before.0 && f.replay.count == before.1)
        #expect(try f.rawEventCount() == before.2)
        productWireRejected("binding_mismatch") { try f.claim(event) }
        #expect((try f.snapshot()["outcomes"] as? [[String: Any]])?.isEmpty == true)
    }

    @Test("New observations cancel unclaimed Hook delivery and preserve already claimed reports",
          arguments: ["new_input", "new_stop", "compact", "failure", "heartbeat", "cancel"], [false, true])
    func waiterInvalidationPreservesClaimedReports(_ eventName: String, _ claimed: Bool) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let waiter = try #require(f.waiter)
        let event = try f.selectedEvent()
        if claimed { try f.claim(event) }
        switch eventName {
        case "new_input": try f.prompt()
        case "new_stop": try lifecycleStop(f)
        case "compact": try f.hook("SessionStart", ["source": "compact", "prompt_id": f.promptID!])
        case "failure": try f.hook("StopFailure", ["failure_code": "interrupted", "prompt_id": f.promptID!])
        case "heartbeat": f.clock.advance(5); _ = try f.poll()
        default: _ = try f.waiterRequest("hook.cancel", waiter: waiter)
        }
        #expect(try f.waiterRequest("hook.poll", waiter: waiter)["status"] as? String == "closed")
        productWireRejected("binding_mismatch") { try f.claim(event) }
        #expect(try f.snapshot()["pending_report_count"] as? Int == (claimed ? 1 : 0))
        if claimed { try f.complete(event["selection_id"] as! String) }
        #expect((try f.snapshot()["outcomes"] as? [[String: Any]])?.count == (claimed ? 1 : 0))
    }

    @Test("Waiters and selection delivery keep the original card, continuation and lease deadlines")
    func waiterDeadlinesAreNotExtended() throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let waiter = try #require(f.waiter)
        let event = try f.selectedEvent()
        for _ in 0..<30 { f.clock.advance(4); _ = try f.poll() }
        let before = (f.meter.count, f.replay.count, try f.rawEventCount())
        #expect(try f.waiterRequest("hook.poll", waiter: waiter)["status"] as? String == "closed")
        #expect(f.meter.count == before.0 && f.replay.count == before.1)
        #expect(try f.rawEventCount() == before.2)
        productWireRejected("binding_mismatch") { try f.claim(event) }
        let nearLease = try ProductAuthorityFixture()
        nearLease.clock.advance(3599)
        try nearLease.prepare()
        #expect(nearLease.waiter?["expires_at_nanoseconds"] as? String == "3600000000000")
        _ = try nearLease.authority.renew(owner: nearLease.authority.ownerHandle, sequence: 1)
        nearLease.clock.advance(1)
        #expect(try nearLease.waiterRequest("hook.poll")["status"] as? String == "closed")
        #expect(try nearLease.snapshot()["selection_enabled"] as? Bool == false)
    }

    @Test("A claim consumed after its shorter waiter deadline never releases the executable action")
    func slowClaimCannotOutliveWaiter() throws {
        let f = try ProductAuthorityFixture(checkRejectedMutationSequence: true)
        f.clock.advance(3598)
        try f.prepare()
        let event = try f.selectedEvent()
        #expect(event["expires_at_nanoseconds"] as? String == "3600000000000")
        _ = try f.authority.renew(owner: f.authority.ownerHandle, sequence: 1)
        f.readProbe?.delayNextBoundMutationLoad { [clock = f.clock] in clock.advance(2) }
        productWireRejected("binding_mismatch") { try f.claim(event) }
        #expect(try f.snapshot()["pending_report_count"] as? Int == 1)
        productWireRejected("binding_mismatch") { try f.claim(event) }
        try f.complete(event["selection_id"] as! String)
    }

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

    @Test("A late Stop for a retired prompt preserves only the new connection probe", arguments: [false, true])
    func lateStopPreservesNewProbeAfterPromptConflict(_ pollBeforeStop: Bool) throws {
        let f = try ProductAuthorityFixture()
        try f.startup(); try f.open()
        let initial = try f.native.beginInitialProductReadiness(identity: f.configuration.identity,
            credential: f.configuration.selectorToken)
        #expect(initial != nil)
        let initialProbe = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        let retiredPromptID = productID()
        let initialHook = try f.hook("UserPromptSubmit", ["prompt_id": retiredPromptID,
            "prompt_sha256": productDigest("Initial native input.")])
        #expect(initialHook["boundary_id"] is String)
        // Claude can absorb busy input under the current native prompt ID.
        // The conflicting text still invalidates that observation and probe.
        productWireRejected("binding_mismatch") {
            try f.hook("UserPromptSubmit", ["prompt_id": retiredPromptID,
                "prompt_sha256": productDigest("Check the Blabee connection.")])
        }
        productWireRejected("unavailable") {
            try f.call("readiness.ack", ["bridge_id": f.bridgeID!,
                "probe_id": initialProbe["probe_id"]!, "nonce": initialProbe["nonce"]!])
        }
        let fresh = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        if pollBeforeStop { #expect(try f.poll() == nil) }
        productWireRejected("binding_mismatch") {
            try f.hook("Stop", ["prompt_id": retiredPromptID, "background_task_ids": [String]()])
        }
        let retired = try f.snapshot()
        #expect(retired["boundary_id"] is NSNull)
        #expect(retired["ready"] as? Bool == false)
        #expect(retired["selection_enabled"] as? Bool == false)
        #expect((retired["native_observation"] as? [String: Any])?["status"] as? String == "new_prompt_required")
        #expect(f.native.productRetainedStateCounts().prompts == 0)
        #expect(f.native.productRetainedStateCounts().references == 1)
        if !pollBeforeStop { #expect(try f.poll() == nil) }
        let probe = fresh
        #expect(probe["probe_id"] as? String == fresh["probe_id"] as? String)
        let nonce = try #require(probe["nonce"] as? String)
        // Never accidentally use the fixture's all-1 Hook credential when
        // the random nonce starts with 0; that tests secret reflection instead.
        let wrongNonce = String(repeating: nonce.hasPrefix("f") ? "e" : "f", count: 64)
        productWireRejected("unavailable") {
            try f.call("readiness.ack", ["bridge_id": f.bridgeID!, "probe_id": probe["probe_id"]!, "nonce": wrongNonce])
        }
        let ack = try f.call("readiness.ack", ["bridge_id": f.bridgeID!,
            "probe_id": probe["probe_id"]!, "nonce": nonce])
        #expect(ack["acknowledged"] as? Bool == true)
        let connected = try f.snapshot()
        #expect(connected["ready"] as? Bool == true)
        #expect(connected["boundary_id"] is NSNull)
        #expect(connected["selection_enabled"] as? Bool == false)
        #expect((connected["cards"] as? [[String: Any]])?.isEmpty == true)
        productWireRejected("unavailable") {
            try f.call("readiness.ack", ["bridge_id": f.bridgeID!, "probe_id": probe["probe_id"]!, "nonce": nonce])
        }
        // Only a fresh ordinary native prompt can create a new task boundary.
        try f.prompt(); try f.emit(); try lifecycleStop(f); try f.select()
    }

    @Test("Preserving a fresh probe cannot revive retired work or erase claimed reports", arguments: [false, true])
    func lateStopProbePreservesOnlyConnectionAndClaimedReports(_ claimed: Bool) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        var oldCard = try lifecycleCard(f)
        let event = try f.selectedEvent()
        if claimed {
            try f.claim(event)
            try f.prompt(); try f.emit(); try lifecycleStop(f)
            oldCard = try lifecycleCard(f)
        }
        let oldBoundaryID = try #require(f.boundaryID)
        let retiredPromptID = try #require(f.promptID)
        let authority = f.authority.snapshot()
        productWireRejected("binding_mismatch") {
            try f.hook("UserPromptSubmit", ["prompt_id": retiredPromptID,
                "prompt_sha256": productDigest("Changed current input.")])
        }
        let probe = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        productWireRejected("binding_mismatch") {
            try f.hook("Stop", ["prompt_id": retiredPromptID, "background_task_ids": [String]()])
        }
        let ack = try f.call("readiness.ack", ["bridge_id": f.bridgeID!,
            "probe_id": probe["probe_id"]!, "nonce": probe["nonce"]!])
        #expect(ack["acknowledged"] as? Bool == true)
        productWireRejected("binding_mismatch") {
            try f.call("proposal.emit", ["bridge_id": f.bridgeID!, "boundary_id": oldBoundaryID,
                "proposal": productProposal()])
        }
        productRejected("claude_session_boundary_mismatch") { try f.select(card: oldCard) }
        productWireRejected("binding_mismatch") { try f.claim(event) }
        let snapshot = try f.snapshot()
        #expect(snapshot["selection_enabled"] as? Bool == false)
        #expect(snapshot["boundary_id"] is NSNull)
        #expect(snapshot["pending_report_count"] as? Int == (claimed ? 1 : 0))
        #expect((snapshot["outcomes"] as? [[String: Any]])?.isEmpty == true)
        #expect(f.authority.snapshot() == authority)
        if claimed { try f.complete(event["selection_id"] as! String) }
        #expect((try f.snapshot()["outcomes"] as? [[String: Any]])?.count == (claimed ? 1 : 0))
    }

    @Test("Mismatched Stop still invalidates probes with expired or current native observations",
          arguments: ["heartbeat", "probe_expiry", "retirement_pending", "current_task", "bound_probe"])
    func lateStopCannotPreserveAnUnsafeProbe(_ variant: String) throws {
        let f = try ProductAuthorityFixture()
        try f.prepare()
        let promptID = try #require(f.promptID)
        if variant != "current_task" {
            productWireRejected("binding_mismatch") {
                try f.hook("UserPromptSubmit", ["prompt_id": promptID,
                    "prompt_sha256": productDigest("Conflicting native input.")])
            }
        }
        let probe = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
        switch variant {
        case "heartbeat": f.clock.advance(5)
        case "probe_expiry":
            for _ in 0..<74 { f.clock.advance(4); _ = try f.poll() }
            f.clock.advance(4)
        case "retirement_pending":
            f.clock.advance(5)
            #expect(try f.poll() == nil)
        case "bound_probe":
            let observation = try f.hook("UserPromptSubmit", ["prompt_id": productID(),
                "prompt_sha256": productDigest("A real native input.")])
            #expect(observation["boundary_id"] is String)
            #expect(f.native.productRetainedStateCounts().prompts == 1)
        default: break
        }
        productWireRejected("binding_mismatch") {
            try f.hook("Stop", ["prompt_id": variant == "current_task" ? productID() : promptID,
                "background_task_ids": [String]()])
        }
        productWireRejected("unavailable") {
            try f.call("readiness.ack", ["bridge_id": f.bridgeID!,
                "probe_id": probe["probe_id"]!, "nonce": probe["nonce"]!])
        }
        let snapshot = try f.snapshot()
        #expect(snapshot["ready"] as? Bool == false)
        #expect(snapshot["boundary_id"] is NSNull)
        #expect(snapshot["selection_enabled"] as? Bool == false)
        #expect(f.native.productRetainedStateCounts().references == 0)
    }

    @Test("Five hundred cycles through a volatile journal retain real core outcomes and ordered Hook events")
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
                let probe = try f.call("readiness.begin", ["bridge_id": f.bridgeID!])
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
        #expect(delivery == UInt64(cycles))
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
            guard hasNoEvent else { Issue.record("Unexpected heartbeat event"); return }
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
