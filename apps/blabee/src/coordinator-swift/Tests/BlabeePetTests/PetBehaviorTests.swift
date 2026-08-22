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
        selectionIDGenerator: selectionIDGenerator
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

@Test("BlabeePet does nothing without an explicit local foreground")
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
    await viewModel.requestPanelSelection(1)

    let identityB = try #require(viewModel.snapshotInteractions.first?.identity)
    await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
    await transport.enqueue(
        type: "get_state",
        response: try petTestSnapshotData(cards: [cardB], foregroundSuffix: "fresh_b")
    )
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

@Test("BlabeePet gates high-risk action slots but leaves pause globally available")
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
    if case .registered = hotKeyRegistry.statuses[.slot3] {
        // Pause remains available because packet risk applies to action slots.
    } else {
        Issue.record("high-risk packet must not consume or disable pause")
    }

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
    await pauseViewModel.handleGlobalSlot(3)
    #expect(await pauseTransport.requestCount(type: "select") == 1)
    #expect(pauseViewModel.riskConfirmation == nil)
    #expect(pauseViewModel.presentationState == .paused)
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
        cards: [cardA, cardB],
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
            cards: [cardA, cardB],
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

@Test("BlabeePet permission notice remains Codex-owned and ignores initial baseline")
@MainActor
func blabeePetPermissionNotificationOwnership() async throws {
    let transport = PetFakeTransport()
    let opener = PetFakeApplicationOpener()
    let viewModel = blabeePetViewModel(transport: transport, opener: opener)
    #expect(opener.captureCalls == 1)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionNoticeCount: 7
    ))
    #expect(viewModel.hasNewPermissionNotice == false)
    #expect(opener.captureCalls == 1)

    try viewModel.receiveSnapshotDataForTesting(petTestSnapshotData(
        cards: [],
        permissionNoticeCount: 8
    ))
    #expect(viewModel.hasNewPermissionNotice)
    #expect(opener.captureCalls == 2)
    viewModel.openPermissionRequestHost()
    #expect(opener.opened.count == 1)
    #expect(await transport.requestCount(type: "select") == 0)
    #expect(await transport.requestCount(type: "permission_request") == 0)
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
        permissionNoticeCount: 1
    ))
    viewModel.openPermissionRequestHost()

    await transport.enqueue(type: "select", response: try petTestSelectionResponse())
    await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
    await viewModel.requestPanelSelection(1)
    #expect(opener.opened.map(\.processIdentifier) == [402, 401])
}
