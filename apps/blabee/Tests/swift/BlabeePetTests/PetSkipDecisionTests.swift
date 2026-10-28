import AppKit
import Foundation
import SwiftUI
import Testing
@testable import BlabeeCoordinator

private func petSkipResponse(_ card: PetTestCard) throws -> Data {
    let identity = petTestIdentityObject(card)
    return try petTestData([
        "dismissed": true,
        "interaction_id": identity["interaction_id"]!,
        "packet_id": identity["packet_id"]!,
        "revision": identity["revision"]!,
    ])
}

private actor PetSkipBlockingTransport: PetCoordinatorTransport {
    let backend: PetFakeTransport
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var dismissalStarted = false

    init(backend: PetFakeTransport) { self.backend = backend }

    func request(type: String, payload: Data) async throws -> Data {
        if type == "dismiss_interaction" {
            dismissalStarted = true
            await withCheckedContinuation { continuation = $0 }
        }
        return try await backend.request(type: type, payload: payload)
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@Suite("Pet skip decision")
struct PetSkipDecisionTests {
    @Test("Skip binds the displayed decision, sends no selection, and preserves the next card")
    @MainActor
    func skipsOnlyDisplayedDecision() async throws {
        let transport = PetFakeTransport()
        let opener = PetFakeApplicationOpener()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: opener)
        let first = PetTestCard(suffix: "skip_first", rankedActionCount: 4)
        let next = PetTestCard(suffix: "skip_next", rankedActionCount: 2)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [first, next]))
        let identity = try #require(vm.displayInteraction?.identity)
        #expect(vm.canSkipDecision(identity))
        await transport.enqueue(type: "dismiss_interaction", response: try petSkipResponse(first))
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [next]))

        await vm.skipDecision(for: identity)

        let payload = try #require(await transport.requestPayloads(type: "dismiss_interaction").first)
        let object = try petTestObject(payload)
        var expected = identity.jsonObject
        expected["schema_version"] = "1.0"
        expected["kind"] = "blabee_pet_dismiss_request"
        #expect(try petTestData(object) == petTestData(expected))
        #expect(await transport.requestCount(type: "dismiss_interaction") == 1)
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 0)
        #expect(await transport.requestCount(type: "focus_interaction") == 0)
        #expect(vm.snapshotInteractions.map(\.identity.interactionID) == ["interaction_skip_next"])
        #expect(vm.lastError == nil)
        #expect(vm.lastTerminalPresentation == nil)
        #expect(opener.opened.isEmpty)

        // Subsequent authoritative snapshots continue to omit the discarded card.
        // Backend durability is separately covered by the operational tests.
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [next]))
        #expect(vm.snapshotInteractions.map(\.identity.interactionID) == ["interaction_skip_next"])
        await vm.skipDecision(for: identity)
        #expect(await transport.requestCount(type: "dismiss_interaction") == 1)
    }

    @Test("A stale click cannot discard a revised card or another session's FIFO head")
    @MainActor
    func rejectsStaleDisplayedIdentity() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let first = PetTestCard(suffix: "skip_stale", rankedActionCount: 2)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [first]))
        let oldIdentity = try #require(vm.displayInteraction?.identity)
        var revised = first
        revised.revision = 2
        revised.packetID = "packet_revised"
        for replacement in [revised, PetTestCard(suffix: "another_session", rankedActionCount: 2)] {
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [replacement]))
            #expect(!vm.canSkipDecision(oldIdentity))
            await vm.skipDecision(for: oldIdentity)
        }
        #expect(await transport.requestCount(type: "dismiss_interaction") == 0)
        #expect(await transport.requestCount(type: "select") == 0)
    }

    @Test("Skip never resolves a native or managed approval and is unavailable for legacy pause")
    @MainActor
    func keepsApprovalSemanticsSeparate() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let card = PetTestCard(suffix: "skip_ordinary", rankedActionCount: 2)
        let snapshots = [
            try petTestSnapshotData(cards: [card], permissionRequests: [PetTestPermissionRequest(suffix: "native")]),
            try petTestSnapshotData(cards: [card], managedCommandApprovals: [PetTestManagedCommandApproval(suffix: "managed")]),
            try petTestSnapshotData(cards: [PetTestCard(suffix: "legacy")]),
        ]
        for snapshot in snapshots {
            try vm.receiveSnapshotDataForTesting(snapshot)
            let identity = try #require(vm.snapshotInteractions.first?.identity)
            #expect(!vm.canSkipDecision(identity))
            await vm.skipDecision(for: identity)
        }
        #expect(await transport.requestCount(type: "dismiss_interaction") == 0)
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 0)
    }

    @Test("An in-flight skip disables duplicate clicks, selection, focus, and previews")
    @MainActor
    func serializesDismissalWithSelection() async throws {
        let backend = PetFakeTransport()
        let transport = PetSkipBlockingTransport(backend: backend)
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let card = PetTestCard(suffix: "skip_in_flight", rankedActionCount: 2)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
        let identity = try #require(vm.displayInteraction?.identity)
        await backend.enqueue(type: "dismiss_interaction", response: try petSkipResponse(card))
        await backend.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        let pending = Task { await vm.skipDecision(for: identity) }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(2))
        while await !transport.dismissalStarted, clock.now < deadline {
            try await Task.sleep(for: .milliseconds(5))
        }
        let started = await transport.dismissalStarted
        #expect(started)
        guard started else { await transport.release(); await pending.value; return }

        #expect(vm.inFlightDismissalIdentity == identity)
        #expect(!vm.canSkipDecision(identity))
        await vm.skipDecision(for: identity)
        await vm.focus(identity)
        await vm.focusAndRequestPanelSelection(1, interaction: identity)
        await vm.handleGlobalSlot(1)
        let interaction = try #require(vm.displayInteraction)
        let choice = try #require(interaction.actionChoices.first)
        #expect(vm.actionAccessoryPresentation(interaction: interaction, choice: choice) == .suppressed)
        #expect(await backend.requestCount(type: "focus_interaction") == 0)
        #expect(await backend.requestCount(type: "select") == 0)
        await transport.release()
        await pending.value
        #expect(await backend.requestCount(type: "dismiss_interaction") == 1)
        #expect(vm.inFlightDismissalIdentity == nil)
        #expect(vm.snapshotInteractions.isEmpty)
        #expect(vm.presentationState == .ready)
    }

    @Test("A stale rejection retains the authoritative card and does not retry dismissal")
    @MainActor
    func reconcilesRejectedDismissal() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let card = PetTestCard(suffix: "skip_rejected", rankedActionCount: 2)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
        let identity = try #require(vm.displayInteraction?.identity)
        await transport.enqueueFailure(type: "dismiss_interaction", code: "stale_interaction")
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [card]))

        await vm.skipDecision(for: identity)

        #expect(await transport.requestCount(type: "dismiss_interaction") == 1)
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(vm.displayInteraction?.identity == identity)
        #expect(vm.lastError?.contains("stale_interaction") == true)
        #expect(vm.inFlightDismissalIdentity == nil)
    }

    @Test("Skip footer fits the existing two-choice and four-choice panel sizes")
    @MainActor
    func rendersWithoutIncreasingPanelWidth() throws {
        let vm = PetViewModel(
            transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener()
        )
        for actionCount in [2, 4] {
            try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [
                PetTestCard(suffix: "skip_render", rankedActionCount: actionCount),
            ]))
            let size = PetPanelSizePolicy.preferredSize(for: PetPanelLayoutState(
                isExpanded: false, isEditingShortcuts: false, isShowingOnboarding: false,
                actionCount: actionCount, fifoQueueCount: 1, hasPermissionNotice: false,
                hasStatusMessage: false
            ))
            let root = PetRootView(viewModel: vm, usesSystemGlassSurface: false)
                .environment(\.colorScheme, .light)
                .frame(width: size.width, height: size.height)
                .background(Color.white)
            let host = NSHostingView(rootView: root)
            host.appearance = NSAppearance(named: .aqua)
            host.frame = NSRect(origin: .zero, size: size)
            host.layoutSubtreeIfNeeded()
            #expect(host.fittingSize.width == PetPanelSizePolicy.width)
            let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.effectiveAppearance.performAsCurrentDrawingAppearance {
                host.cacheDisplay(in: host.bounds, to: bitmap)
            }
            #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
            if let directory = ProcessInfo.processInfo.environment["BLABEE_SKIP_RENDER_DIRECTORY"] {
                let png = try #require(bitmap.representation(using: .png, properties: [:]))
                try png.write(to: URL(fileURLWithPath: directory, isDirectory: true)
                    .appendingPathComponent("skip-decision-\(actionCount).png"))
            }
        }
    }

    @Test("Dismissal responses require exact identity and strict scalar types")
    func validatesDismissalResponse() throws {
        let card = PetTestCard(suffix: "skip_response", rankedActionCount: 2)
        let identity = try PetInteractionIdentity(jsonObject: petTestIdentityObject(card))
        let request = PetDismissRequest(identity: identity)
        let valid = try petTestObject(petSkipResponse(card))
        try request.requireDismissed(petTestData(valid))
        let mutations: [(String, Any)] = [
            ("dismissed", 1), ("dismissed", false), ("interaction_id", "other_interaction"),
            ("packet_id", "other_packet"), ("revision", 2), ("revision", true),
            ("revision", "1"), ("unexpected", "field"),
        ]
        for (key, value) in mutations {
            var malformed = valid
            malformed[key] = value
            #expect(throws: (any Error).self) {
                try request.requireDismissed(petTestData(malformed))
            }
        }
    }
}
