import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private func blabeePetViewModel(
    transport: PetFakeTransport,
    opener: PetFakeApplicationOpener,
    selectionIDGenerator: @escaping @Sendable () -> String = { "selection_test" }
) -> PetViewModel {
    PetViewModel(
        transport: transport,
        externalApplicationOpener: opener,
        processIdentifier: 999,
        selectionIDGenerator: selectionIDGenerator,
        permissionResponseIDGenerator: { "permission_response_test" },
        managedApprovalResponseIDGenerator: { "managed_approval_response_test" }
    )
}

@MainActor
private func blabeePetFocus(
    _ suffix: String,
    card: PetTestCard,
    viewModel: PetViewModel,
    transport: PetFakeTransport
) async throws -> PetInteractionIdentity {
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
    let identity = try #require(viewModel.snapshotInteractions.first?.identity)
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [card], foregroundSuffix: suffix)
    )
    await viewModel.focus(identity)
    return identity
}

@MainActor
private func blabeePetWaitForRequestCount(
    _ expectedCount: Int,
    type: String,
    transport: PetFakeTransport,
    timeout: Duration = .seconds(2)
) async -> Bool {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
        if await transport.requestCount(type: type) >= expectedCount {
            return true
        }
        try? await Task.sleep(nanoseconds: 5_000_000)
    }
    return await transport.requestCount(type: type) >= expectedCount
}

@Test("BlabeePet snapshot polling carries a bounded consumer heartbeat")
@MainActor
func blabeePetSnapshotPollingCarriesConsumerHeartbeat() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))

    await viewModel.refresh()

    let payload = try #require(await transport.requestPayloads(type: "get_state").first)
    let object = try petTestObject(payload)
    #expect(Set(object.keys) == ["schema_version", "kind", "consumer_heartbeat"])
    #expect(object["schema_version"] as? String == "1.0")
    #expect(object["kind"] as? String == "blabee_pet_snapshot_request")
    #expect(object["consumer_heartbeat"] as? Bool == true)
}

@Test("BlabeePet distinguishes ready from an actual in-flight continuation")
@MainActor
func blabeePetReadyAndWorkingPresentation() throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: []))
    #expect(viewModel.presentationState == .ready)
    #expect(viewModel.presentationState.displayTitle == "준비됨")

    var inFlight = petTestSnapshotObject(cards: [])
    var routing = try #require(inFlight["routing"] as? [String: Any])
    routing["in_flight_count"] = 1
    inFlight["routing"] = routing
    try viewModel.receiveSnapshotDataForTesting(petTestData(inFlight))
    #expect(viewModel.presentationState == .working)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: []))
    #expect(viewModel.presentationState == .ready)
}

@Test("BlabeePet does nothing without exact local foreground authority")
@MainActor
func blabeePetNoForegroundNoOp() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [PetTestCard(suffix: "no_focus")]
    ))

    await viewModel.handleGlobalSlot(1)
    await viewModel.requestPanelSelection(3)
    #expect(await transport.requestCount(type: "select") == 0)
    #expect(viewModel.localForegroundIdentity == nil)
}

@Test("BlabeePet auto-focuses one unambiguous waiting decision")
@MainActor
func blabeePetAutoFocusesSingleWaitingDecision() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let hotKeyBackend = PetFakeHotKeyBackend()
    let hotKeyRegistry = try PetHotKeyRegistry(
        backend: hotKeyBackend,
        configuration: .defaults
    ) { _ in }
    viewModel.attachHotKeyRegistry(hotKeyRegistry)
    let card = PetTestCard(suffix: "auto_focus")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [card])
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [card], foregroundSuffix: "auto_focus")
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(viewModel.localForegroundIdentity?.interactionID == "interaction_auto_focus")
    #expect(viewModel.focusedInteraction?.identity == viewModel.localForegroundIdentity)
    if case .registered = hotKeyRegistry.statuses[.slot1] {
        // The first choice is immediately available through its registered shortcut.
    } else {
        Issue.record("slot 1 shortcut should be active after automatic focus")
    }
}

@Test("BlabeePet retries the same FIFO head on the next poll after transient focus failure")
@MainActor
func blabeePetRetriesAutoFocusAfterTransientFailure() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let head = PetTestCard(suffix: "retry_head")
    let follower = PetTestCard(suffix: "retry_follower")

    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [head, follower])
    )
    await transport.enqueueFailure(type: "focus_interaction", code: "socket_unavailable")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [head, follower])
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(viewModel.localForegroundIdentity == nil)
    #expect(viewModel.displayInteraction?.identity.interactionID == "interaction_retry_head")

    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [head, follower])
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [head, follower],
            foregroundSuffix: "retry_head"
        )
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 2)
    #expect(viewModel.localForegroundIdentity?.interactionID == "interaction_retry_head")
    let focusPayloads = await transport.requestPayloads(type: "focus_interaction")
    let focusedInteractionIDs = try focusPayloads.map { payload in
        try #require(petTestObject(payload)["interaction_id"] as? String)
    }
    #expect(focusedInteractionIDs == ["interaction_retry_head", "interaction_retry_head"])
}

@Test("BlabeePet refocuses the exact authoritative FIFO head after a lost focus response")
@MainActor
func blabeePetRetriesExactAuthoritativeHeadAfterLostFocusResponse() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let head = PetTestCard(suffix: "retry_authoritative_head")

    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [head])
    )
    await transport.enqueueFailure(type: "focus_interaction", code: "lost_response")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [head],
            foregroundSuffix: "retry_authoritative_head"
        )
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(viewModel.snapshot?.routing.foreground?.interactionID
        == "interaction_retry_authoritative_head")
    #expect(viewModel.localForegroundIdentity == nil)

    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [head],
            foregroundSuffix: "retry_authoritative_head"
        )
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [head],
            foregroundSuffix: "retry_authoritative_head"
        )
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 2)
    #expect(viewModel.localForegroundIdentity?.interactionID
        == "interaction_retry_authoritative_head")
    let focusPayloads = await transport.requestPayloads(type: "focus_interaction")
    let focusedInteractionIDs = try focusPayloads.map { payload in
        try #require(petTestObject(payload)["interaction_id"] as? String)
    }
    #expect(focusedInteractionIDs == [
        "interaction_retry_authoritative_head",
        "interaction_retry_authoritative_head",
    ])
}

@Test("BlabeePet never auto-focuses over a different authoritative foreground")
@MainActor
func blabeePetDoesNotStealDifferentAuthoritativeForeground() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let head = PetTestCard(suffix: "no_steal_head")
    let authoritativeFollower = PetTestCard(suffix: "no_steal_foreground")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [head, authoritativeFollower],
            foregroundSuffix: "no_steal_foreground"
        )
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 0)
    #expect(viewModel.snapshot?.routing.foreground?.interactionID
        == "interaction_no_steal_foreground")
    #expect(viewModel.displayInteraction?.identity.interactionID == "interaction_no_steal_head")
    #expect(viewModel.localForegroundIdentity == nil)
}

@Test("BlabeePet clears an accepted next-turn card without presenting work success")
@MainActor
func blabeePetClearsAcceptedNextTurnCard() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "auto_focus_choice")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [card])
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [card],
            foregroundSuffix: "auto_focus_choice"
        )
    )
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await transport.setFocusBlocked(true)

    let refresh = Task { @MainActor in
        await viewModel.refresh()
    }
    try #require(await blabeePetWaitForRequestCount(
        1,
        type: "focus_interaction",
        transport: transport
    ), "timed out waiting for the blocked automatic focus request")
    let identity = try #require(viewModel.displayInteraction?.identity)
    #expect(viewModel.pendingFocusIdentity == identity)

    let selection = Task { @MainActor in
        await viewModel.focusAndRequestPanelSelection(1, interaction: identity)
    }
    await Task.yield()
    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(await transport.requestCount(type: "select") == 0)

    await transport.setFocusBlocked(false)
    await refresh.value
    await selection.value

    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(await transport.requestCount(type: "select") == 1)
    #expect(viewModel.displayInteraction == nil)
    #expect(viewModel.lastTerminalPresentation == nil)
    #expect(viewModel.presentationState == .ready)
}

@Test("BlabeePet auto-focuses the first FIFO decision from multiple sessions")
@MainActor
func blabeePetAutoFocusesFIFOHeadFromMultipleSessions() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let cardA = PetTestCard(suffix: "fifo_a")
    let cardB = PetTestCard(suffix: "fifo_b")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardA, cardB])
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardA, cardB], foregroundSuffix: "fifo_a")
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(viewModel.localForegroundIdentity?.interactionID == "interaction_fifo_a")
    #expect(viewModel.displayInteraction?.identity.interactionID == "interaction_fifo_a")
    #expect(viewModel.displayInteractionQueuePosition == 1)
    #expect(viewModel.fifoQueueCount == 2)
}

@Test("BlabeePet advances to the next FIFO session after selection")
@MainActor
func blabeePetAdvancesFIFOAfterSelection() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let cardA = PetTestCard(suffix: "fifo_advance_a")
    let cardB = PetTestCard(suffix: "fifo_advance_b")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardA, cardB])
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [cardA, cardB],
            foregroundSuffix: "fifo_advance_a"
        )
    )
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardB])
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [cardB],
            foregroundSuffix: "fifo_advance_b"
        )
    )

    await viewModel.refresh()
    await viewModel.requestPanelSelection(1)

    #expect(await transport.requestCount(type: "select") == 1)
    #expect(await transport.requestCount(type: "focus_interaction") == 2)
    #expect(viewModel.localForegroundIdentity?.interactionID == "interaction_fifo_advance_b")
    #expect(viewModel.displayInteraction?.identity.interactionID == "interaction_fifo_advance_b")
    #expect(viewModel.displayInteractionQueuePosition == 1)
    #expect(viewModel.fifoQueueCount == 1)
}

@Test("BlabeePet never lets a ready later session overtake a blocked FIFO head")
@MainActor
func blabeePetDoesNotOvertakeBlockedFIFOHead() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    var attentionEvents = 0
    viewModel.onAttentionEvent = { attentionEvents += 1 }
    var blockedHead = PetTestCard(suffix: "fifo_blocked")
    blockedHead.state = "sealed"
    let readyFollower = PetTestCard(suffix: "fifo_ready_follower")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [blockedHead, readyFollower])
    )

    await viewModel.refresh()

    #expect(await transport.requestCount(type: "focus_interaction") == 0)
    #expect(viewModel.localForegroundIdentity == nil)
    #expect(viewModel.displayInteraction?.identity.interactionID == "interaction_fifo_blocked")
    #expect(viewModel.hasAttention == false)
    #expect(attentionEvents == 0)
}

@Test("BlabeePet rejects direct focus and selection for a FIFO follower")
@MainActor
func blabeePetRejectsDirectFIFOBypass() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let head = PetTestCard(suffix: "fifo_direct_head")
    let follower = PetTestCard(suffix: "fifo_direct_follower")
    try viewModel.receiveSnapshotDataForTesting(
        petTestSnapshotData(cards: [head, follower])
    )
    let followerIdentity = try #require(
        viewModel.snapshotInteractions.first(where: {
            $0.identity.interactionID == "interaction_fifo_direct_follower"
        })?.identity
    )

    await viewModel.focus(followerIdentity)
    await viewModel.focusAndRequestPanelSelection(1, interaction: followerIdentity)

    #expect(await transport.requestCount(type: "focus_interaction") == 0)
    #expect(await transport.requestCount(type: "select") == 0)
    #expect(viewModel.localForegroundIdentity == nil)
    #expect(viewModel.displayInteraction?.identity.interactionID == "interaction_fifo_direct_head")
    #expect(viewModel.displayInteractionQueuePosition == 1)
}

@Test("BlabeePet emits attention once per new decision and toggle requests panel visibility")
@MainActor
func blabeePetAttentionAndPanelToggleCallbacks() throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    var attentionEvents = 0
    var attentionStates: [Bool] = []
    var panelToggles = 0
    viewModel.onAttentionEvent = { attentionEvents += 1 }
    viewModel.onAttentionChanged = { attentionStates.append($0) }
    viewModel.onPanelToggleRequested = { panelToggles += 1 }

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: []))
    let card = PetTestCard(suffix: "attention")
    var sealedCard = card
    sealedCard.state = "sealed"
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [sealedCard]))
    #expect(attentionEvents == 0)
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
    var reminderCard = card
    reminderCard.reminderDue = true
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [reminderCard]))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [reminderCard]))
    viewModel.handleShortcut(.toggle)

    #expect(attentionEvents == 2)
    #expect(attentionStates == [false, false, true, true, true, true])
    #expect(panelToggles == 1)
    #expect(viewModel.isExpanded == false)
    #expect(viewModel.displayInteraction?.identity.interactionID == "interaction_attention")
}

@Test("BlabeePet focuses explicitly and a new second session never steals local foreground")
@MainActor
func blabeePetExplicitFocusAndNoSteal() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let cardA = PetTestCard(suffix: "focus_a")
    let cardB = PetTestCard(suffix: "focus_b")
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [cardA]))
    let identityA = try #require(viewModel.snapshotInteractions.first?.identity)
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardA], foregroundSuffix: "focus_a")
    )
    await viewModel.focus(identityA)
    #expect(viewModel.localForegroundIdentity == identityA)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [cardA, cardB],
        foregroundSuffix: "focus_a"
    ))
    #expect(viewModel.localForegroundIdentity == identityA)

    let externallyFocused = try PetSnapshot.parse(petTestSnapshotData(
        cards: [cardA, cardB],
        foregroundSuffix: "focus_b"
    ))
    viewModel.applySnapshotForTesting(externallyFocused)
    #expect(viewModel.localForegroundIdentity == nil)
    #expect(viewModel.focusedInteraction == nil)
}

@Test("BlabeePet treats refocusing the exact authoritative card as a no-op")
@MainActor
func blabeePetExactRefocusNoOp() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "refocus")
    let identity = try await blabeePetFocus(
        "refocus",
        card: card,
        viewModel: viewModel,
        transport: transport
    )

    await viewModel.focus(identity)
    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(viewModel.localForegroundIdentity == identity)
    #expect(viewModel.pendingFocusIdentity == nil)
}

@Test("BlabeePet clears stale revision and rejects expired input")
@MainActor
func blabeePetStaleRevisionAndExpiry() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let revisionOne = PetTestCard(
        suffix: "stale",
        revision: 1,
        packetID: "packet_stable"
    )
    let identity = try await blabeePetFocus(
        "stale",
        card: revisionOne,
        viewModel: viewModel,
        transport: transport
    )
    #expect(viewModel.localForegroundIdentity == identity)

    let revisionTwo = PetTestCard(
        suffix: "stale",
        revision: 2,
        packetID: "packet_stable"
    )
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [revisionTwo],
        foregroundSuffix: "stale"
    ))
    #expect(viewModel.localForegroundIdentity == nil)
    #expect(viewModel.presentationState == .expired)
    await viewModel.handleGlobalSlot(1)
    #expect(await transport.requestCount(type: "select") == 0)

    let expiredTransport = PetFakeTransport()
    let expiredOpener = PetFakeApplicationOpener()
    let expiredViewModel = blabeePetViewModel(
        transport: expiredTransport,
        opener: expiredOpener
    )
    let expiring = PetTestCard(suffix: "expires")
    _ = try await blabeePetFocus(
        "expires",
        card: expiring,
        viewModel: expiredViewModel,
        transport: expiredTransport
    )
    var expired = expiring
    expired.millisecondsUntilExpiry = 0
    try expiredViewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [expired],
        foregroundSuffix: "expires"
    ))
    #expect(expiredViewModel.presentationState == .expired)
    await expiredViewModel.requestPanelSelection(1)
    #expect(await expiredTransport.requestCount(type: "select") == 0)
}

@Test("BlabeePet keeps one selection in flight across different slots")
@MainActor
func blabeePetDuplicateSubmitSingleFlight() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "dedupe")
    _ = try await blabeePetFocus(
        "dedupe",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await transport.setSelectionBlocked(true)

    let first = Task { @MainActor in
        await viewModel.requestPanelSelection(1)
    }
    for _ in 0..<100 where await transport.requestCount(type: "select") == 0 {
        await Task.yield()
    }
    let second = Task { @MainActor in
        await viewModel.requestPanelSelection(2)
    }
    await Task.yield()
    #expect(await transport.requestCount(type: "select") == 1)
    await transport.setSelectionBlocked(false)
    await first.value
    await second.value
    #expect(await transport.requestCount(type: "select") == 1)
    #expect(opener.opened.count == 1)
}

@Test("BlabeePet global slot submission owns progress until selection resolves")
@MainActor
func blabeePetGlobalSlotSelectionProgress() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "global_selection_progress")
    _ = try await blabeePetFocus(
        "global_selection_progress",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    let interaction = try #require(viewModel.displayInteraction)
    let selectedChoice = try #require(interaction.choice(slot: 1))
    let siblingChoice = try #require(interaction.choice(slot: 2))
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await transport.setSelectionBlocked(true)

    let selection = Task { @MainActor in
        await viewModel.handleGlobalSlot(1)
    }
    try #require(await blabeePetWaitForRequestCount(
        1,
        type: "select",
        transport: transport
    ), "timed out waiting for the blocked global selection request")
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: selectedChoice
    ) == .progress)
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: siblingChoice
    ) == .suppressed)

    await transport.setSelectionBlocked(false)
    await selection.value

    #expect(viewModel.selectionSubmission == nil)
    #expect(await transport.requestCount(type: "select") == 1)
}

@Test("BlabeePet gives progress to the clicked row and clears it after submission")
@MainActor
func blabeePetPanelSelectionProgressOwnershipAndClearing() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "selection_progress")
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
    let interaction = try #require(viewModel.displayInteraction)
    let identity = interaction.identity
    let selectedChoice = try #require(interaction.choice(slot: 1))
    let siblingChoice = try #require(interaction.choice(slot: 2))

    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [card],
            foregroundSuffix: "selection_progress"
        )
    )
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await transport.setFocusBlocked(true)
    await transport.setSelectionBlocked(true)

    let selection = Task { @MainActor in
        await viewModel.focusAndRequestPanelSelection(1, interaction: identity)
    }
    try #require(await blabeePetWaitForRequestCount(
        1,
        type: "focus_interaction",
        transport: transport
    ), "timed out waiting for the blocked focus request")

    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: selectedChoice
    ) == .progress)
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: siblingChoice
    ) == .suppressed)

    await viewModel.focusAndRequestPanelSelection(2, interaction: identity)
    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(await transport.requestCount(type: "select") == 0)
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: selectedChoice
    ) == .progress)
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: siblingChoice
    ) == .suppressed)

    await transport.setFocusBlocked(false)
    try #require(await blabeePetWaitForRequestCount(
        1,
        type: "select",
        transport: transport
    ), "timed out waiting for the blocked selection request")
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: selectedChoice
    ) == .progress)
    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(await transport.requestCount(type: "select") == 1)

    let follower = PetTestCard(suffix: "selection_progress_follower")
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [follower],
        foregroundSuffix: "selection_progress_follower"
    ))
    let followerInteraction = try #require(viewModel.displayInteraction)
    let followerChoice = try #require(followerInteraction.choice(slot: 1))
    #expect(viewModel.actionAccessoryPresentation(
        interaction: followerInteraction,
        choice: followerChoice
    ) == .suppressed)
    await viewModel.focusAndRequestPanelSelection(
        1,
        interaction: followerInteraction.identity
    )
    #expect(await transport.requestCount(type: "select") == 1)

    await transport.setSelectionBlocked(false)
    await selection.value

    #expect(viewModel.selectionSubmission == nil)
    #expect(viewModel.displayInteraction == nil)
    #expect(await transport.requestCount(type: "select") == 1)
}

@Test("BlabeePet clears panel selection progress after an ambiguous failure")
@MainActor
func blabeePetPanelSelectionProgressClearsAfterFailure() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "selection_progress_failure")
    let identity = try await blabeePetFocus(
        "selection_progress_failure",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    let interaction = try #require(viewModel.displayInteraction)
    let choice = try #require(interaction.choice(slot: 1))
    await transport.enqueueFailure(type: "select", code: "lost_response")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [card],
            foregroundSuffix: "selection_progress_failure"
        )
    )
    await transport.setSelectionBlocked(true)

    let selection = Task { @MainActor in
        await viewModel.focusAndRequestPanelSelection(1, interaction: identity)
    }
    try #require(await blabeePetWaitForRequestCount(
        1,
        type: "select",
        transport: transport
    ), "timed out waiting for the blocked selection request")
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: choice
    ) == .progress)

    await transport.setSelectionBlocked(false)
    await selection.value

    #expect(viewModel.selectionSubmission == nil)
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: choice
    ) == .shortcut("사용 불가"))
    #expect(await transport.requestCount(type: "select") == 1)
}

@Test("BlabeePet high-risk confirmation never leaves panel selection progress behind")
@MainActor
func blabeePetHighRiskConfirmationClearsPanelSelectionProgress() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "selection_progress_risk", risk: "high")
    let identity = try await blabeePetFocus(
        "selection_progress_risk",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    let interaction = try #require(viewModel.displayInteraction)
    let choice = try #require(interaction.choice(slot: 1))

    await viewModel.focusAndRequestPanelSelection(1, interaction: identity)

    #expect(viewModel.riskConfirmation?.slot == 1)
    #expect(viewModel.selectionSubmission == nil)
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: choice
    ) == .shortcut("Pet 확인"))
    #expect(await transport.requestCount(type: "select") == 0)

    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await transport.setSelectionBlocked(true)
    let selection = Task { @MainActor in
        await viewModel.confirmRiskSelection()
    }
    try #require(await blabeePetWaitForRequestCount(
        1,
        type: "select",
        transport: transport
    ), "timed out waiting for the blocked confirmed selection request")
    #expect(viewModel.riskConfirmation == nil)
    #expect(viewModel.actionAccessoryPresentation(
        interaction: interaction,
        choice: choice
    ) == .progress)

    await transport.setSelectionBlocked(false)
    await selection.value

    #expect(viewModel.selectionSubmission == nil)
    #expect(await transport.requestCount(type: "select") == 1)
}

@Test("BlabeePet generates a fresh selection id for each newly focused card")
@MainActor
func blabeePetFreshSelectionIDPerCard() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let ids = PetTestSelectionIDSequence()
    let viewModel = blabeePetViewModel(
        transport: transport,
        opener: opener,
        selectionIDGenerator: ids.next
    )
    let cardA = PetTestCard(suffix: "fresh_a")
    let cardB = PetTestCard(suffix: "fresh_b")
    _ = try await blabeePetFocus(
        "fresh_a",
        card: cardA,
        viewModel: viewModel,
        transport: transport
    )
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardB])
    )
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardB], foregroundSuffix: "fresh_b")
    )
    await viewModel.requestPanelSelection(1)

    let identityB = try #require(viewModel.snapshotInteractions.first?.identity)
    await viewModel.focus(identityB)
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await viewModel.requestPanelSelection(1)
    #expect(viewModel.presentationState == .ready)

    let payloads = await transport.requestPayloads(type: "select")
    #expect(payloads.count == 2)
    let selectionIDs = try payloads.map { data in
        try #require(petTestObject(data)["selection_id"] as? String)
    }
    #expect(selectionIDs == ["selection_fresh_1", "selection_fresh_2"])
}

@Test("BlabeePet gates high-risk actions and preserves legacy pause as a secondary control")
@MainActor
func blabeePetHighRiskGateAndExplicitConfirmation() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let hotKeyBackend = PetFakeHotKeyBackend()
    let hotKeyRegistry = try PetHotKeyRegistry(
        backend: hotKeyBackend,
        configuration: .defaults
    ) { intent in
        viewModel.handleShortcut(intent)
    }
    viewModel.attachHotKeyRegistry(hotKeyRegistry)
    let card = PetTestCard(suffix: "risk_gate", risk: "high")
    _ = try await blabeePetFocus(
        "risk_gate",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    #expect(hotKeyRegistry.statuses[.slot1] == .inactive)
    #expect(hotKeyRegistry.statuses[.slot2] == .inactive)
    #expect(hotKeyRegistry.statuses[.slot3] == .inactive)

    await viewModel.handleGlobalSlot(1)
    #expect(await transport.requestCount(type: "select") == 0)
    #expect(viewModel.isExpanded)
    #expect(viewModel.riskConfirmation?.slot == 1)

    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await viewModel.confirmRiskSelection()
    #expect(await transport.requestCount(type: "select") == 1)
    #expect(opener.opened.last?.processIdentifier == opener.captured.processIdentifier)

    let pauseTransport = PetFakeTransport()
    let pauseOpener = PetFakeApplicationOpener()
    let pauseViewModel = blabeePetViewModel(
        transport: pauseTransport,
        opener: pauseOpener
    )
    _ = try await blabeePetFocus(
        "risk_pause",
        card: PetTestCard(suffix: "risk_pause", risk: "critical"),
        viewModel: pauseViewModel,
        transport: pauseTransport
    )
    await pauseTransport.enqueue(type: "select", response: try petTestSelectionResponse(kind: "pause"))
    await pauseTransport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await pauseViewModel.requestLegacyPause()
    #expect(await pauseTransport.requestCount(type: "select") == 1)
    #expect(pauseViewModel.riskConfirmation == nil)
    #expect(pauseViewModel.presentationState == .paused)
}

@Test("BlabeePet treats ranked slots three and four as executable next actions")
@MainActor
func blabeePetRankedTrailingActions() async throws {
    let transport = PetFakeTransport()
    let viewModel = blabeePetViewModel(
        transport: transport,
        opener: PetFakeApplicationOpener()
    )
    let card = PetTestCard(suffix: "ranked_four", rankedActionCount: 4)
    _ = try await blabeePetFocus(
        "ranked_four",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    let interaction = try #require(viewModel.focusedInteraction)
    #expect(interaction.usesRankedNextActions)
    #expect(interaction.actionChoices.map(\.slot) == [1, 2, 3, 4])
    #expect(interaction.legacyPauseChoice == nil)

    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await viewModel.handleGlobalSlot(4)

    let payload = try #require(await transport.requestPayloads(type: "select").first)
    let selection = try petTestObject(payload)
    #expect(selection["option_id"] as? String == "option_rank_4_ranked_four")
    #expect(viewModel.riskConfirmation == nil)
    #expect(viewModel.presentationState == .ready)
}

@Test("BlabeePet treats ambiguous selection failure as stale until refocused")
@MainActor
func blabeePetAmbiguousSelectionFailureClearsAuthority() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "ambiguous")
    _ = try await blabeePetFocus(
        "ambiguous",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    await transport.enqueueFailure(type: "select", code: "lost_response")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [card], foregroundSuffix: "ambiguous")
    )
    await viewModel.requestPanelSelection(1)
    #expect(viewModel.localForegroundIdentity == nil)
    await viewModel.requestPanelSelection(1)
    #expect(await transport.requestCount(type: "select") == 1)
}

@Test("BlabeePet drops prior authority after an ambiguous focus response")
@MainActor
func blabeePetAmbiguousFocusFailureClearsAuthority() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let cardA = PetTestCard(suffix: "focus_lost_a")
    let cardB = PetTestCard(suffix: "focus_lost_b")
    _ = try await blabeePetFocus(
        "focus_lost_a",
        card: cardA,
        viewModel: viewModel,
        transport: transport
    )
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [cardB, cardA],
        foregroundSuffix: "focus_lost_a"
    ))
    let identityB = try #require(
        viewModel.snapshotInteractions.first(where: {
            $0.identity.interactionID == "interaction_focus_lost_b"
        })?.identity
    )
    await transport.enqueueFailure(type: "focus_interaction", code: "lost_response")
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [cardB, cardA],
            foregroundSuffix: "focus_lost_b"
        )
    )

    await viewModel.focus(identityB)
    #expect(viewModel.localForegroundIdentity == nil)
    await viewModel.handleGlobalSlot(1)
    #expect(await transport.requestCount(type: "select") == 0)
}

@Test("BlabeePet keeps selection single-flight across interaction identities")
@MainActor
func blabeePetGlobalSelectionSingleFlight() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let cardA = PetTestCard(suffix: "global_a")
    let cardB = PetTestCard(suffix: "global_b")
    _ = try await blabeePetFocus(
        "global_a",
        card: cardA,
        viewModel: viewModel,
        transport: transport
    )
    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await transport.setSelectionBlocked(true)
    let first = Task { @MainActor in
        await viewModel.requestPanelSelection(1)
    }
    for _ in 0..<100 where await transport.requestCount(type: "select") == 0 {
        await Task.yield()
    }

    let externalB = try PetSnapshot.parse(petTestSnapshotData(
        cards: [cardA, cardB],
        foregroundSuffix: "global_b"
    ))
    viewModel.applySnapshotForTesting(externalB)
    let identityB = try #require(
        viewModel.snapshotInteractions.first(where: {
            $0.identity.interactionID == "interaction_global_b"
        })?.identity
    )
    await viewModel.focus(identityB)
    await viewModel.requestPanelSelection(1)
    #expect(await transport.requestCount(type: "focus_interaction") == 1)
    #expect(await transport.requestCount(type: "select") == 1)

    await transport.setSelectionBlocked(false)
    await first.value
    #expect(await transport.requestCount(type: "select") == 1)
}

@Test("BlabeePet resolves an authoritative permission request exactly once")
@MainActor
func blabeePetPermissionNotificationOwnership() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    #expect(opener.captureCalls == 1)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [PetTestPermissionRequest(suffix: "permission")],
        permissionNoticeCount: 1
    ))
    #expect(viewModel.hasNewPermissionNotice)
    #expect(opener.captureCalls == 2)
    #expect(viewModel.permissionRequestQueueCount == 1)

    await transport.enqueue(
        type: "resolve_permission_request",
        response: try petTestPermissionResolutionResponse(
            .deny,
            requestID: "permission_permission"
        )
    )
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [], permissionNoticeCount: 1)
    )
    let displayedRequest = try #require(viewModel.pendingPermissionRequest)
    await viewModel.resolvePermissionRequest(.deny, for: displayedRequest)

    #expect(opener.opened.count == 1)
    #expect(viewModel.hasNewPermissionNotice == false)
    #expect(await transport.requestCount(type: "select") == 0)
    #expect(await transport.requestCount(type: "resolve_permission_request") == 1)
    let payload = try #require(
        await transport.requestPayloads(type: "resolve_permission_request").first
    )
    let payloadObject = try petTestObject(payload)
    #expect(Set(payloadObject.keys) == [
        "schema_version", "kind", "request_id", "project_id", "session_id",
        "turn_id", "response_id", "decision",
    ])
    #expect(payloadObject["schema_version"] as? String == "1.0")
    #expect(payloadObject["kind"] as? String == "blabee_permission_resolution_request")
    #expect(payloadObject["request_id"] as? String == "permission_permission")
    #expect(payloadObject["response_id"] as? String == "permission_response_test")
    #expect(payloadObject["project_id"] as? String == "project_permission")
    #expect(payloadObject["session_id"] as? String == "session_permission")
    #expect(payloadObject["turn_id"] as? String == "turn_permission")
    #expect(payloadObject["decision"] as? String == "deny")
}

@Test("BlabeePet ignores a Hook decision after its visible FIFO head changes")
@MainActor
func blabeePetPermissionDecisionRequiresExactVisibleHead() async throws {
    let transport = PetFakeTransport()
    let viewModel = blabeePetViewModel(
        transport: transport,
        opener: PetFakeApplicationOpener()
    )
    let previous = PetTestPermissionRequest(
        suffix: "previous_head",
        arrivalSequence: 51
    )
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [previous]
    ))
    let previouslyDisplayed = try #require(viewModel.pendingPermissionRequest)

    let replacement = PetTestPermissionRequest(
        suffix: "replacement_head",
        arrivalSequence: 52
    )
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [replacement]
    ))
    await viewModel.resolvePermissionRequest(.deny, for: previouslyDisplayed)
    #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
    #expect(viewModel.pendingPermissionRequest?.requestID
        == "permission_replacement_head")
}

@Test("BlabeePet preserves approval delivery errors after snapshot recovery")
@MainActor
func blabeePetApprovalResolutionErrorSurvivesRefresh() async throws {
    let hookTransport = PetFakeTransport()
    let hookViewModel = blabeePetViewModel(
        transport: hookTransport,
        opener: PetFakeApplicationOpener()
    )
    let hookRequest = PetTestPermissionRequest(suffix: "hook_delivery_error")
    let hookSnapshot = try petTestSnapshotData(
        cards: [],
        permissionRequests: [hookRequest],
        permissionNoticeCount: 1
    )
    var hookFailureEvents = 0
    hookViewModel.onApprovalResolutionFailed = { hookFailureEvents += 1 }
    try hookViewModel.receiveSnapshotDataForTesting(hookSnapshot)
    let displayedHook = try #require(hookViewModel.pendingPermissionRequest)
    await hookTransport.enqueueFailure(
        type: "resolve_permission_request",
        code: "hook_delivery_failed"
    )
    await hookTransport.enqueue(type: "get_state", response: hookSnapshot)

    await hookViewModel.resolvePermissionRequest(.deny, for: displayedHook)

    #expect(hookViewModel.lastError?.contains("hook_delivery_failed") == true)
    #expect(hookViewModel.hasPersistentApprovalResolutionError)
    #expect(hookViewModel.hasAttention)
    #expect(hookViewModel.pendingPermissionRequest == displayedHook)
    #expect(hookFailureEvents == 1)
    let readyDecision = PetTestCard(suffix: "after_delivery_error")
    await hookTransport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [readyDecision],
            permissionNoticeCount: 1
        )
    )
    await hookTransport.enqueue(
        type: "focus_interaction",
        response: try petTestFocusResponse()
    )
    await hookTransport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [readyDecision],
            foregroundSuffix: readyDecision.suffix,
            permissionNoticeCount: 1
        )
    )
    await hookViewModel.refresh()
    #expect(await hookTransport.requestCount(type: "focus_interaction") == 1)
    #expect(hookViewModel.localForegroundIdentity?.interactionID
        == "interaction_after_delivery_error")
    #expect(hookViewModel.pendingPermissionRequest == nil)
    #expect(hookViewModel.lastError?.contains("hook_delivery_failed") == true)
    #expect(hookViewModel.hasPersistentApprovalResolutionError)
    #expect(hookFailureEvents == 1)
    await hookTransport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [readyDecision],
            foregroundSuffix: readyDecision.suffix,
            permissionNoticeCount: 1
        )
    )
    await hookViewModel.refresh()
    #expect(hookViewModel.lastError?.contains("hook_delivery_failed") == true)
    #expect(hookViewModel.hasPersistentApprovalResolutionError)
    #expect(hookFailureEvents == 1)
    await hookTransport.enqueue(
        type: "select",
        response: try petTestSelectionResponse()
    )
    await hookTransport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [], permissionNoticeCount: 1)
    )
    await hookViewModel.requestPanelSelection(1)
    #expect(await hookTransport.requestCount(type: "select") == 1)
    #expect(hookViewModel.lastError?.contains("hook_delivery_failed") == true)
    #expect(hookViewModel.hasPersistentApprovalResolutionError)
    #expect(hookViewModel.hasAttention)
    hookViewModel.acknowledgeApprovalResolutionError()
    #expect(hookViewModel.lastError == nil)
    #expect(!hookViewModel.hasPersistentApprovalResolutionError)
    #expect(!hookViewModel.hasAttention)

    let managedTransport = PetFakeTransport()
    let managedViewModel = blabeePetViewModel(
        transport: managedTransport,
        opener: PetFakeApplicationOpener()
    )
    let managedRequest = PetTestManagedCommandApproval(
        suffix: "managed_delivery_error"
    )
    let managedSnapshot = try petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [managedRequest],
        managedCommandApprovalNoticeCount: 1
    )
    var managedFailureEvents = 0
    managedViewModel.onApprovalResolutionFailed = {
        managedFailureEvents += 1
    }
    try managedViewModel.receiveSnapshotDataForTesting(managedSnapshot)
    let displayedManaged = try #require(
        managedViewModel.pendingManagedCommandApproval
    )
    await managedTransport.enqueueFailure(
        type: "resolve_managed_command_approval",
        code: "managed_delivery_failed"
    )
    await managedTransport.enqueue(type: "get_state", response: managedSnapshot)

    await managedViewModel.resolveManagedCommandApproval(
        .acceptOnce,
        for: displayedManaged
    )

    #expect(managedViewModel.lastError?.contains("managed_delivery_failed") == true)
    #expect(managedViewModel.hasPersistentApprovalResolutionError)
    #expect(managedViewModel.pendingManagedCommandApproval == displayedManaged)
    #expect(managedFailureEvents == 1)
}

@Test("BlabeePet blocks every approval choice while Codex delivery is pending")
@MainActor
func blabeePetApprovalDeliveryPendingBlocksDuplicateChoices() async throws {
    let hookTransport = PetFakeTransport()
    let hookViewModel = blabeePetViewModel(
        transport: hookTransport,
        opener: PetFakeApplicationOpener()
    )
    try hookViewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [PetTestPermissionRequest(
            suffix: "hook_delivery_pending",
            deliveryPending: true
        )]
    ))
    let hookRequest = try #require(hookViewModel.pendingPermissionRequest)
    for decision in PetPermissionDecision.allCases {
        await hookViewModel.resolvePermissionRequest(decision, for: hookRequest)
    }
    #expect(await hookTransport.requestCount(
        type: "resolve_permission_request"
    ) == 0)
    #expect(hookViewModel.pendingPermissionRequest == hookRequest)

    let managedTransport = PetFakeTransport()
    let managedViewModel = blabeePetViewModel(
        transport: managedTransport,
        opener: PetFakeApplicationOpener()
    )
    try managedViewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [PetTestManagedCommandApproval(
            suffix: "managed_delivery_pending",
            deliveryPending: true
        )]
    ))
    let managedRequest = try #require(
        managedViewModel.pendingManagedCommandApproval
    )
    for decision in PetManagedCommandApprovalDecision.allCases {
        await managedViewModel.resolveManagedCommandApproval(
            decision,
            for: managedRequest
        )
    }
    #expect(await managedTransport.requestCount(
        type: "resolve_managed_command_approval"
    ) == 0)
    #expect(managedViewModel.pendingManagedCommandApproval == managedRequest)
}

@Test("BlabeePet emits a dedicated presentation event for each permission FIFO head")
@MainActor
func blabeePetPermissionPresentationCallbacks() throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    var approvalHeads: [PetApprovalHeadIdentity?] = []
    viewModel.onApprovalHeadChanged = { identity in
        approvalHeads.append(identity)
    }

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: []))
    let first = PetTestPermissionRequest(suffix: "present_first")
    let second = PetTestPermissionRequest(suffix: "present_second")
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [first, second],
        permissionNoticeCount: 2
    ))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [first, second],
        permissionNoticeCount: 2
    ))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [second],
        permissionNoticeCount: 2
    ))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionNoticeCount: 2
    ))

    #expect(approvalHeads == [
        .permission(requestID: "permission_present_first"),
        .permission(requestID: "permission_present_second"),
        nil,
    ])
}

@Test("BlabeePet displays and resolves the globally oldest approval")
@MainActor
func blabeePetManagedCommandApprovalOwnership() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let hotKeyRegistry = try PetHotKeyRegistry(
        backend: PetFakeHotKeyBackend(),
        configuration: .defaults
    ) { _ in }
    viewModel.attachHotKeyRegistry(hotKeyRegistry)
    var approvalHeads: [PetApprovalHeadIdentity?] = []
    viewModel.onApprovalHeadChanged = { approvalHeads.append($0) }
    let card = PetTestCard(suffix: "managed_priority")
    let managed = PetTestManagedCommandApproval(
        suffix: "managed_priority",
        arrivalSequence: 1,
        jsonRPCRequestID: .integer(Int64.max)
    )
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [card],
        foregroundSuffix: "managed_priority",
        permissionRequests: [PetTestPermissionRequest(
            suffix: "managed_priority",
            arrivalSequence: 2
        )],
        permissionNoticeCount: 1,
        managedCommandApprovals: [managed],
        managedCommandApprovalNoticeCount: 1
    ))

    #expect(viewModel.pendingManagedCommandApproval?.managedRequestID
        == "managed_request_managed_priority")
    #expect(viewModel.pendingPermissionRequest == nil)
    #expect(viewModel.presentationState == .permission)
    #expect(viewModel.hasAttention)
    #expect(approvalHeads == [
        .managed(managedRequestID: "managed_request_managed_priority"),
    ])
    #expect(hotKeyRegistry.statuses[.slot1] == .inactive)
    await viewModel.handleGlobalSlot(1)
    #expect(await transport.requestCount(type: "select") == 0)

    await transport.enqueue(
        type: "resolve_managed_command_approval",
        response: try petTestManagedCommandApprovalResolutionResponse(
            .acceptOnce,
            managedRequestID: "managed_request_managed_priority"
        )
    )
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [],
            permissionRequests: [PetTestPermissionRequest(
                suffix: "managed_priority",
                arrivalSequence: 2
            )],
            permissionNoticeCount: 1,
            managedCommandApprovalNoticeCount: 1
        )
    )
    let displayedRequest = try #require(viewModel.pendingManagedCommandApproval)
    await viewModel.resolveManagedCommandApproval(
        .acceptOnce,
        for: displayedRequest
    )

    #expect(viewModel.pendingManagedCommandApproval == nil)
    #expect(viewModel.pendingPermissionRequest != nil)
    #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 1)
    let payload = try #require(
        await transport.requestPayloads(type: "resolve_managed_command_approval").first
    )
    let object = try petTestObject(payload)
    #expect(Set(object.keys) == [
        "schema_version", "kind", "managed_request_id", "response_id",
        "broker_epoch", "connection_id", "jsonrpc_request_id", "thread_id",
        "turn_id", "item_id", "approval_id", "environment_id", "cwd", "command_preview",
        "allow_once_available", "decline_available", "decision",
    ])
    #expect(object["kind"] as? String
        == "blabee_managed_command_approval_resolution_request")
    #expect(object["managed_request_id"] as? String
        == "managed_request_managed_priority")
    #expect(object["decision"] as? String == "accept_once")
    let requestID = try #require(object["jsonrpc_request_id"] as? [String: Any])
    #expect(requestID["type"] as? String == "integer")
    #expect((requestID["value"] as? NSNumber)?.int64Value == Int64.max)
    #expect(String(describing: object).contains("acceptForSession") == false)
}

@Test("BlabeePet ignores a stale managed approval click after the FIFO head changes")
@MainActor
func blabeePetManagedCommandApprovalRejectsStaleDisplayedRequest() async throws {
    let transport = PetFakeTransport()
    let viewModel = blabeePetViewModel(
        transport: transport,
        opener: PetFakeApplicationOpener()
    )
    let first = PetTestManagedCommandApproval(suffix: "managed_stale_first")
    let second = PetTestManagedCommandApproval(suffix: "managed_stale_second")

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [first, second],
        managedCommandApprovalNoticeCount: 2
    ))
    let staleDisplayedRequest = try #require(
        viewModel.pendingManagedCommandApproval
    )
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [second],
        managedCommandApprovalNoticeCount: 2
    ))

    await viewModel.resolveManagedCommandApproval(
        .acceptOnce,
        for: staleDisplayedRequest
    )

    #expect(await transport.requestCount(
        type: "resolve_managed_command_approval"
    ) == 0)
    #expect(viewModel.pendingManagedCommandApproval?.managedRequestID
        == "managed_request_managed_stale_second")

    let currentDisplayedRequest = try #require(
        viewModel.pendingManagedCommandApproval
    )
    await transport.enqueue(
        type: "resolve_managed_command_approval",
        response: try petTestManagedCommandApprovalResolutionResponse(
            .decline,
            managedRequestID: currentDisplayedRequest.managedRequestID
        )
    )
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [],
            managedCommandApprovalNoticeCount: 2
        )
    )
    await viewModel.resolveManagedCommandApproval(
        .decline,
        for: currentDisplayedRequest
    )

    #expect(await transport.requestCount(
        type: "resolve_managed_command_approval"
    ) == 1)
    let payload = try #require(
        await transport.requestPayloads(
            type: "resolve_managed_command_approval"
        ).first
    )
    #expect(try petTestObject(payload)["decision"] as? String == "decline")
}

@Test("BlabeePet reports every exact global approval head change")
@MainActor
func blabeePetManagedCommandApprovalPresentationCallbacks() throws {
    let viewModel = blabeePetViewModel(
        transport: PetFakeTransport(),
        opener: PetFakeApplicationOpener()
    )
    var approvalHeads: [PetApprovalHeadIdentity?] = []
    viewModel.onApprovalHeadChanged = { approvalHeads.append($0) }
    let first = PetTestManagedCommandApproval(suffix: "managed_present_first")
    let second = PetTestManagedCommandApproval(suffix: "managed_present_second")

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(cards: []))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [first, second],
        managedCommandApprovalNoticeCount: 2
    ))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [second],
        managedCommandApprovalNoticeCount: 2
    ))
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovalNoticeCount: 2
    ))
    #expect(approvalHeads == [
        .managed(managedRequestID: "managed_request_managed_present_first"),
        .managed(managedRequestID: "managed_request_managed_present_second"),
        nil,
    ])
}

@Test("BlabeePet keeps shortcut collisions out of permission cards")
@MainActor
func blabeePetPermissionCardSuppressesShortcutDiagnostic() throws {
    let viewModel = blabeePetViewModel(
        transport: PetFakeTransport(),
        opener: PetFakeApplicationOpener()
    )
    let backend = PetFakeHotKeyBackend()
    backend.failingShortcuts = [PetShortcutConfiguration.defaults.toggle]
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: .defaults
    ) { _ in }
    viewModel.attachHotKeyRegistry(registry)

    #expect(viewModel.shortcutDiagnostic
        == "macOS 단축키 등록 충돌: Pet 열기/닫기")
    #expect(viewModel.visibleShortcutDiagnostic == viewModel.shortcutDiagnostic)
    #expect(viewModel.hasVisibleStatusMessage)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [
            PetTestManagedCommandApproval(suffix: "managed_hides_shortcut")
        ],
        managedCommandApprovalNoticeCount: 1
    ))
    #expect(viewModel.pendingManagedCommandApproval != nil)
    #expect(viewModel.visibleShortcutDiagnostic == nil)
    #expect(!viewModel.hasVisibleStatusMessage)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionRequests: [PetTestPermissionRequest(suffix: "hook_hides_shortcut")],
        permissionNoticeCount: 1,
        managedCommandApprovalNoticeCount: 1
    ))
    #expect(viewModel.pendingManagedCommandApproval == nil)
    #expect(viewModel.pendingPermissionRequest != nil)
    #expect(viewModel.visibleShortcutDiagnostic == nil)
    #expect(!viewModel.hasVisibleStatusMessage)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionNoticeCount: 1,
        managedCommandApprovalNoticeCount: 1
    ))
    #expect(viewModel.pendingManagedCommandApproval == nil)
    #expect(viewModel.visibleShortcutDiagnostic == viewModel.shortcutDiagnostic)
    #expect(viewModel.hasVisibleStatusMessage)
}

@Test("BlabeePet sends one managed approval resolution while a click is in flight")
@MainActor
func blabeePetManagedApprovalResolutionIsSingleFlight() async throws {
    let transport = PetFakeTransport()
    let viewModel = blabeePetViewModel(
        transport: transport,
        opener: PetFakeApplicationOpener()
    )
    let managed = PetTestManagedCommandApproval(suffix: "managed_single_flight")
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        managedCommandApprovals: [managed],
        managedCommandApprovalNoticeCount: 1
    ))
    let displayed = try #require(viewModel.pendingManagedCommandApproval)
    await transport.enqueue(
        type: "resolve_managed_command_approval",
        response: try petTestManagedCommandApprovalResolutionResponse(
            .acceptOnce,
            managedRequestID: displayed.managedRequestID
        )
    )
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [],
            managedCommandApprovalNoticeCount: 1
        )
    )
    await transport.setNextManagedApprovalResolutionBlocked(true)

    let first = Task { @MainActor in
        await viewModel.resolveManagedCommandApproval(.acceptOnce, for: displayed)
    }
    var firstRequestStarted = false
    for _ in 0..<200 {
        if await transport.requestCount(type: "resolve_managed_command_approval") == 1 {
            firstRequestStarted = true
            break
        }
        try await Task.sleep(nanoseconds: 5_000_000)
    }
    if !firstRequestStarted {
        await transport.setNextManagedApprovalResolutionBlocked(false)
        await first.value
        Issue.record("managed approval resolution never entered the transport")
        return
    }
    let second = Task { @MainActor in
        await viewModel.resolveManagedCommandApproval(.acceptOnce, for: displayed)
    }
    await second.value
    #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 1)

    await transport.setNextManagedApprovalResolutionBlocked(false)
    await first.value
    #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 1)
    #expect(viewModel.pendingManagedCommandApproval == nil)
}

@Test("BlabeePet permission head blocks hidden decision actions and shortcuts")
@MainActor
func blabeePetPermissionBlocksDecisionActions() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let hotKeyRegistry = try PetHotKeyRegistry(
        backend: PetFakeHotKeyBackend(),
        configuration: .defaults
    ) { _ in }
    viewModel.attachHotKeyRegistry(hotKeyRegistry)
    let card = PetTestCard(suffix: "permission_blocks")
    _ = try await blabeePetFocus(
        "permission_blocks",
        card: card,
        viewModel: viewModel,
        transport: transport
    )

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [card],
        foregroundSuffix: "permission_blocks",
        permissionRequests: [PetTestPermissionRequest(suffix: "permission_blocks")],
        permissionNoticeCount: 1
    ))

    #expect(viewModel.presentationState == .permission)
    #expect(hotKeyRegistry.statuses[.slot1] == .inactive)
    #expect(hotKeyRegistry.statuses[.slot2] == .inactive)
    #expect(hotKeyRegistry.statuses[.slot3] == .inactive)
    await viewModel.handleGlobalSlot(1)
    await viewModel.requestPanelSelection(1)
    #expect(await transport.requestCount(type: "select") == 0)
}

@Test("BlabeePet keeps permission and successful-selection return targets separate")
@MainActor
func blabeePetReturnTargetOwnership() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    let card = PetTestCard(suffix: "return_targets")

    opener.captured = PetExternalApplicationReference(
        processIdentifier: 401,
        localizedName: "Selection Host"
    )
    _ = try await blabeePetFocus(
        "return_targets",
        card: card,
        viewModel: viewModel,
        transport: transport
    )
    opener.captured = PetExternalApplicationReference(
        processIdentifier: 402,
        localizedName: "Permission Host"
    )
    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [card],
        foregroundSuffix: "return_targets",
        permissionRequests: [PetTestPermissionRequest(suffix: "return_targets")],
        permissionNoticeCount: 1
    ))
    await transport.enqueue(
        type: "resolve_permission_request",
        response: try petTestPermissionResolutionResponse(
            .deferToCodex,
            requestID: "permission_return_targets"
        )
    )
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(
            cards: [card],
            foregroundSuffix: "return_targets",
            permissionNoticeCount: 1
        )
    )
    let displayedPermission = try #require(viewModel.pendingPermissionRequest)
    await viewModel.resolvePermissionRequest(
        .deferToCodex,
        for: displayedPermission
    )

    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await viewModel.requestPanelSelection(1)
    #expect(opener.opened.map(\.processIdentifier) == [402, 401])
}
