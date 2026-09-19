import AppKit
import Foundation
import SwiftUI
import Testing
@testable import BlabeeCoordinator

private func navigationReference(_ kind: PetEventReference.Kind, _ suffix: String) -> PetEventReference {
    let prefix: String = switch kind {
    case .decision: "interaction_"
    case .permission: "permission_"
    case .managed: "managed_request_"
    }
    return PetEventReference(kind: kind, eventID: prefix + suffix)
}

private func navigationSnapshot(
    cards: [PetTestCard],
    permissions: [PetTestPermissionRequest] = [],
    managed: [PetTestManagedCommandApproval] = [],
    order: [PetEventReference]? = nil,
    focused: PetEventReference?,
    foreground: String? = nil,
    revision: Int64 = 1
) throws -> Data {
    var object = petTestSnapshotObject(
        cards: cards, foregroundSuffix: foreground,
        permissionRequests: permissions, managedCommandApprovals: managed
    )
    let references = order ?? cards.filter { $0.state == "waiting" }.map {
        navigationReference(.decision, $0.suffix)
    } + permissions.map { navigationReference(.permission, $0.suffix) }
        + managed.map { navigationReference(.managed, $0.suffix) }
    object["event_navigation"] = [
        "events": references.map(\.jsonObject),
        "focused": focused?.jsonObject as Any? ?? NSNull(),
        "revision": revision,
        "delivery_pending": permissions.contains(where: \.deliveryPending)
            || managed.contains(where: \.deliveryPending),
    ]
    return try petTestData(object)
}

private actor NavigationBlockingTransport: PetCoordinatorTransport {
    let backend: PetFakeTransport
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var started = false

    init(_ backend: PetFakeTransport) { self.backend = backend }

    func request(type: String, payload: Data) async throws -> Data {
        if type == "focus_event" {
            started = true
            await withCheckedContinuation { continuation = $0 }
        }
        return try await backend.request(type: type, payload: payload)
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

@Suite("Pet event navigation")
struct PetEventNavigationTests {
    @Test("Option-left wraps to the third project and only its exact decision is selected")
    @MainActor
    func thirdProjectBeforeFirst() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let cards = ["blabee", "blabase", "biadone"].map { PetTestCard(suffix: $0, rankedActionCount: 2) }
        let first = navigationReference(.decision, "blabee")
        let third = navigationReference(.decision, "biadone")
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(cards: cards, focused: first))
        await transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: cards, focused: third, foreground: "biadone", revision: 2
        ))

        await vm.navigateToPreviousEvent()

        #expect(vm.displayedEventQueuePosition == 3)
        #expect(vm.eventQueueCount == 3)
        #expect(vm.focusedInteraction?.identity.binding.projectID == "project_biadone")
        #expect(vm.canActOnDisplayedEvent)
        #expect(vm.snapshotInteractions.map(\.identity.interactionID) == cards.map { "interaction_" + $0.suffix })
        let focusPayload = try #require(await transport.requestPayloads(type: "focus_event").first)
        let focus = try petTestObject(focusPayload)
        #expect(focus["event_kind"] as? String == "decision")
        let target = try #require(focus["target"] as? [String: Any])
        let expected = PetFocusRequest(identity: try #require(vm.displayInteraction?.identity)).jsonObject
        #expect(try petTestData(target) == petTestData(expected))
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 0)
        #expect(await transport.requestCount(type: "dismiss_interaction") == 0)

        await transport.enqueue(type: "select", response: try petTestSelectionResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: Array(cards.prefix(2)), focused: nil, revision: 3
        ))
        await vm.handleGlobalSlot(1)

        let selected = try petTestObject(try #require(await transport.requestPayloads(type: "select").first))
        #expect(selected["interaction_id"] as? String == "interaction_biadone")
        #expect(selected["project_id"] as? String == "project_biadone")
        #expect(selected["session_id"] as? String == "session_biadone")
        #expect(vm.snapshotInteractions.map(\.identity.interactionID) == ["interaction_blabee", "interaction_blabase"])
        #expect(vm.displayedEventQueuePosition == 1)
        #expect(!vm.canActOnDisplayedEvent)
        await vm.handleGlobalSlot(1)
        #expect(await transport.requestCount(type: "select") == 1)
    }

    @Test("An ordinary non-head decision remains previewable and skippable while approvals wait")
    @MainActor
    func mixedNavigationKeepsDecisionControls() async throws {
        let transport = PetFakeTransport()
        let monitor = PetChoicePreviewHoldMonitor(modifierIsPressed: { _ in true }, keyIsPressed: { _ in false })
        let vm = PetViewModel(
            transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            choicePreviewHoldMonitor: monitor
        )
        defer { vm.stopPolling() }
        let cards = [PetTestCard(suffix: "earlier", rankedActionCount: 2), PetTestCard(suffix: "later", rankedActionCount: 4)]
        let permissions = [PetTestPermissionRequest(suffix: "approval")]
        let managed = [PetTestManagedCommandApproval(suffix: "managed")]
        let approval = navigationReference(.permission, "approval")
        let later = navigationReference(.decision, "later")
        let order = [navigationReference(.decision, "earlier"), later, approval, navigationReference(.managed, "managed")]
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(
            cards: cards, permissions: permissions, managed: managed, order: order, focused: approval
        ))
        #expect(vm.pendingPermissionRequest?.requestID == "permission_approval")
        await transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: cards, permissions: permissions, managed: managed, order: order,
            focused: later, foreground: "later", revision: 2
        ))
        await vm.navigateToPreviousEvent()
        #expect(vm.approvalHead == nil)
        #expect(vm.approvalQueueCount == 2)
        #expect(vm.displayedEventQueuePosition == 2)
        let identity = try #require(vm.displayInteraction?.identity)
        #expect(vm.canSkipDecision(identity))
        vm.beginChoicePreview(slot: 4)
        #expect(vm.choicePreview?.identity == identity)
        #expect(!vm.canNavigateEvents)
        vm.endChoicePreview()
        monitor.poll()
        let response: [String: Any] = [
            "dismissed": true, "interaction_id": identity.interactionID,
            "packet_id": identity.packetID, "revision": identity.revision,
        ]
        await transport.enqueue(type: "dismiss_interaction", response: try petTestData(response))
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: Array(cards.prefix(1)), permissions: permissions, managed: managed,
            focused: nil, revision: 3
        ))
        await vm.skipDecision(for: identity)
        let skipped = try petTestObject(try #require(await transport.requestPayloads(type: "dismiss_interaction").first))
        #expect(skipped["interaction_id"] as? String == "interaction_later")
        #expect(vm.snapshotInteractions.map(\.identity.interactionID) == ["interaction_earlier"])
        #expect(vm.approvalQueueCount == 2)
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(await transport.requestCount(type: "resolve_managed_command_approval") == 0)
    }

    @Test("Managed approval navigation resolves only the displayed immutable request")
    @MainActor
    func resolvesSelectedApproval() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(
            transport: transport, externalApplicationOpener: PetFakeApplicationOpener(),
            managedApprovalResponseIDGenerator: { "managed_approval_response_test" }
        )
        let cards = [PetTestCard(suffix: "middle", rankedActionCount: 2)]
        let permissions = [PetTestPermissionRequest(suffix: "first")]
        let managed = [PetTestManagedCommandApproval(suffix: "third")]
        let first = navigationReference(.permission, "first")
        let third = navigationReference(.managed, "third")
        let order = [first, navigationReference(.decision, "middle"), third]
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(
            cards: cards, permissions: permissions, managed: managed, order: order, focused: first
        ))
        let staleFirst = try #require(vm.pendingPermissionRequest)
        await transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: cards, permissions: permissions, managed: managed, order: order, focused: third, revision: 2
        ))
        await vm.navigateToPreviousEvent()
        let request = try #require(vm.pendingManagedCommandApproval)
        #expect(vm.displayedEventQueuePosition == 3)
        await vm.resolvePermissionRequest(.deny, for: staleFirst)
        #expect(await transport.requestCount(type: "resolve_permission_request") == 0)
        await transport.enqueue(type: "resolve_managed_command_approval", response: try petTestManagedCommandApprovalResolutionResponse(
            .acceptOnce, managedRequestID: request.managedRequestID
        ))
        var delivering = managed[0]
        delivering.deliveryPending = true
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: cards, permissions: permissions, managed: [delivering], order: order, focused: third, revision: 3
        ))
        await vm.resolveManagedCommandApproval(.acceptOnce, for: request)
        let sent = try #require(await transport.requestPayloads(type: "resolve_managed_command_approval").first)
        let expected = try PetManagedCommandApprovalResolutionRequest(
            request: request, responseID: "managed_approval_response_test", decision: .acceptOnce
        ).data()
        #expect(sent == expected)
        #expect(vm.pendingManagedCommandApproval?.deliveryPending == true)
        #expect(!vm.canNavigateEvents)
        #expect(!vm.canActOnDisplayedEvent)
        await vm.navigateToNextEvent()
        #expect(await transport.requestCount(type: "focus_event") == 1)
        #expect(vm.permissionRequestQueueCount == 1)
    }

    @Test("A focused event stays selected across arrivals and expiry requires fresh authority")
    @MainActor
    func preservesIdentityAndReauthorizesAfterRemoval() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let cards = ["first", "second", "third"].map { PetTestCard(suffix: $0, rankedActionCount: 2) }
        let first = navigationReference(.decision, "first")
        let second = navigationReference(.decision, "second")
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(cards: cards, focused: first))
        await transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: cards, focused: second, foreground: "second", revision: 2
        ))
        await vm.navigateToNextEvent()
        let permissions = [PetTestPermissionRequest(suffix: "new_approval")]
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(
            cards: cards, permissions: permissions, focused: second, foreground: "second", revision: 3
        ))
        #expect(vm.displayInteraction?.identity.interactionID == "interaction_second")
        #expect(vm.focusedInteraction?.identity.interactionID == "interaction_second")
        #expect(vm.pendingPermissionRequest == nil)
        #expect(vm.eventQueueCount == 4)
        let remaining = [cards[0], cards[2]]
        let removedSnapshot = try navigationSnapshot(cards: remaining, permissions: permissions, focused: nil, revision: 4)
        try vm.receiveSnapshotDataForTesting(removedSnapshot)
        #expect(vm.displayInteraction?.identity.interactionID == "interaction_third")
        #expect(!vm.canActOnDisplayedEvent)
        #expect(vm.focusedInteraction == nil)
        await vm.handleGlobalSlot(1)
        #expect(await transport.requestCount(type: "select") == 0)
        await transport.enqueue(type: "get_state", response: removedSnapshot)
        await transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: remaining, permissions: permissions, focused: navigationReference(.decision, "third"),
            foreground: "third", revision: 5
        ))
        await vm.refresh()
        #expect(vm.canActOnDisplayedEvent)
        #expect(vm.focusedInteraction?.identity.interactionID == "interaction_third")
        #expect(await transport.requestCount(type: "focus_event") == 2)
    }

    @Test("Rapid navigation and stale actions are blocked until focus acknowledgment and snapshot agree")
    @MainActor
    func serializesNavigationAndActions() async throws {
        let backend = PetFakeTransport()
        let transport = NavigationBlockingTransport(backend)
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let cards = [PetTestCard(suffix: "old", rankedActionCount: 2), PetTestCard(suffix: "target", rankedActionCount: 2)]
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(cards: cards, focused: navigationReference(.decision, "old")))
        let oldIdentity = try #require(vm.displayInteraction?.identity)
        await backend.enqueue(type: "focus_event", response: try petTestFocusResponse())
        await backend.enqueue(type: "get_state", response: try navigationSnapshot(
            cards: cards, focused: navigationReference(.decision, "target"), foreground: "target", revision: 2
        ))
        let navigating = Task { await vm.navigateToNextEvent() }
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(2))
        while await !transport.started, clock.now < deadline { try await Task.sleep(for: .milliseconds(5)) }
        let started = await transport.started
        #expect(started)
        guard started else { await transport.release(); await navigating.value; return }
        #expect(vm.pendingEventFocus != nil)
        #expect(!vm.canNavigateEvents)
        #expect(!vm.canSkipDecision(oldIdentity))
        #expect(!vm.canRequestPanelSelection(oldIdentity))
        await vm.navigateToNextEvent()
        await vm.navigateToPreviousEvent()
        await vm.handleGlobalSlot(1)
        await vm.focusAndRequestPanelSelection(1, interaction: oldIdentity)
        await vm.skipDecision(for: oldIdentity)
        await transport.release()
        await navigating.value
        #expect(await backend.requestCount(type: "focus_event") == 1)
        #expect(await backend.requestCount(type: "select") == 0)
        #expect(await backend.requestCount(type: "dismiss_interaction") == 0)
        #expect(vm.displayInteraction?.identity.interactionID == "interaction_target")
        await vm.focusAndRequestPanelSelection(1, interaction: oldIdentity)
        #expect(await backend.requestCount(type: "select") == 0)
    }

    @Test("A rejected or mismatched focus reply never grants authority or changes to the requested card")
    @MainActor
    func rejectsAmbiguousFocus() async throws {
        for rejected in [true, false] {
            let transport = PetFakeTransport()
            let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
            let cards = [PetTestCard(suffix: "kept", rankedActionCount: 2), PetTestCard(suffix: "wanted", rankedActionCount: 2)]
            let initial = try navigationSnapshot(cards: cards, focused: navigationReference(.decision, "kept"))
            try vm.receiveSnapshotDataForTesting(initial)
            if rejected {
                await transport.enqueueFailure(type: "focus_event", code: "stale_event")
            } else {
                await transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
                await transport.enqueue(type: "get_state", response: initial)
            }
            await transport.enqueue(type: "get_state", response: initial)
            await vm.navigateToNextEvent()
            #expect(vm.displayInteraction?.identity.interactionID == "interaction_kept")
            #expect(vm.focusedInteraction == nil)
            #expect(!vm.canActOnDisplayedEvent)
            #expect(vm.pendingEventFocus == nil)
            #expect(vm.lastError != nil)
            await vm.handleGlobalSlot(1)
            #expect(await transport.requestCount(type: "select") == 0)
            #expect(await transport.requestCount(type: "focus_event") == 1)
        }
    }

    @Test("A revised decision cannot reuse a previous navigation acknowledgment")
    @MainActor
    func rejectsChangedBinding() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let first = PetTestCard(suffix: "first", rankedActionCount: 2)
        var second = PetTestCard(suffix: "second", rankedActionCount: 2)
        let focused = navigationReference(.decision, "second")
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(cards: [first, second], focused: navigationReference(.decision, "first")))
        await transport.enqueue(type: "focus_event", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(cards: [first, second], focused: focused, foreground: "second", revision: 2))
        await vm.navigateToNextEvent()
        let old = try #require(vm.displayInteraction?.identity)
        second.revision = 2
        second.packetID = "packet_second_revised"
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(cards: [first, second], focused: focused, foreground: "second", revision: 3))
        #expect(!vm.canActOnDisplayedEvent)
        #expect(!vm.canSkipDecision(old))
        await vm.handleGlobalSlot(1)
        await vm.focusAndRequestPanelSelection(1, interaction: old)
        #expect(await transport.requestCount(type: "select") == 0)
    }

    @Test("Event navigation snapshot rejects duplicate, missing and unknown references or invalid authority")
    func rejectsMalformedNavigationProjection() throws {
        let card = PetTestCard(suffix: "one", rankedActionCount: 2)
        let good = try petTestObject(navigationSnapshot(cards: [card], focused: navigationReference(.decision, "one")))
        let reference = navigationReference(.decision, "one").jsonObject
        let mutations: [(String, Any)] = [
            ("events", [reference, reference]), ("events", []),
            ("events", [navigationReference(.decision, "other").jsonObject]),
            ("focused", navigationReference(.permission, "missing").jsonObject),
            ("revision", true), ("revision", -1), ("delivery_pending", 1),
            ("delivery_pending", true), ("unexpected", "field"),
        ]
        for (field, value) in mutations {
            var invalid = good
            var navigation = try #require(invalid["event_navigation"] as? [String: Any])
            navigation[field] = value
            invalid["event_navigation"] = navigation
            #expect(throws: PetModelError.self) { try PetSnapshot.parse(petTestData(invalid)) }
        }
    }

    @Test("An ordinary selection key captured before a synchronous card change cannot act on its replacement")
    @MainActor
    func dropsSelectionShortcutAfterCardChangesBeforeTaskHop() async throws {
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener())
        let first = PetTestCard(suffix: "key_old", rankedActionCount: 2)
        let replacement = PetTestCard(suffix: "key_new", rankedActionCount: 2)
        let firstReference = navigationReference(.decision, "key_old")
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(cards: [first], focused: firstReference))
        await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try navigationSnapshot(cards: [first], focused: firstReference, foreground: "key_old"))
        await vm.refresh()
        #expect(vm.focusedInteraction?.identity.interactionID == "interaction_key_old")

        // No suspension between enqueueing the shortcut Task and replacing the
        // snapshot: the callback must retain the original immutable identity.
        vm.handleShortcut(.slot1)
        try vm.receiveSnapshotDataForTesting(navigationSnapshot(
            cards: [replacement], focused: navigationReference(.decision, "key_new"), foreground: "key_new", revision: 2
        ))
        await Task.yield()
        #expect(await transport.requestCount(type: "select") == 0)
        #expect(vm.displayInteraction?.identity.interactionID == "interaction_key_new")
        #expect(vm.selectionSubmission == nil)
    }

    @Test("Distinct decision bindings sharing one event ID are rejected without constructing a duplicate-key dictionary")
    func rejectsAmbiguousDecisionEventID() throws {
        let first = PetTestCard(suffix: "first", rankedActionCount: 2)
        let second = PetTestCard(suffix: "second", rankedActionCount: 2)
        var object = try petTestObject(navigationSnapshot(
            cards: [first, second], focused: navigationReference(.decision, "first")
        ))
        var interactions = try #require(object["interactions"] as? [[String: Any]])
        interactions[1]["interaction_id"] = "interaction_first"
        object["interactions"] = interactions
        var routing = try #require(object["routing"] as? [String: Any])
        var pending = try #require(routing["pending"] as? [[String: Any]])
        pending[1]["interaction_id"] = "interaction_first"
        routing["pending"] = pending
        object["routing"] = routing
        var navigation = try #require(object["event_navigation"] as? [String: Any])
        navigation["events"] = [navigationReference(.decision, "first").jsonObject]
        object["event_navigation"] = navigation
        #expect(throws: PetModelError.self) { try PetSnapshot.parse(petTestData(object)) }
    }

    @Test("Navigation toolbar fits two-choice, four-choice and mixed approval panels at 460 points")
    @MainActor
    func rendersNavigationWithoutWidening() throws {
        let vm = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener())
        defer { vm.stopPolling() }
        for actionCount in [2, 4, 0] {
            let cards = [PetTestCard(suffix: "blabee", rankedActionCount: max(2, actionCount)), PetTestCard(suffix: "blabase", rankedActionCount: 2)]
            let permissions = actionCount == 0 ? [PetTestPermissionRequest(suffix: "biadone")] : []
            try vm.receiveSnapshotDataForTesting(navigationSnapshot(
                cards: cards, permissions: permissions,
                focused: navigationReference(actionCount == 0 ? .permission : .decision, actionCount == 0 ? "biadone" : "blabee")
            ))
            let size = PetPanelSizePolicy.preferredSize(for: PetPanelLayoutState(
                isExpanded: false, isEditingShortcuts: false, isShowingOnboarding: false,
                actionCount: actionCount == 0 ? nil : actionCount, fifoQueueCount: vm.eventQueueCount,
                hasPermissionNotice: actionCount == 0, hasStatusMessage: false
            ))
            let root = PetRootView(viewModel: vm, usesSystemGlassSurface: false)
                .environment(\.colorScheme, .light)
                .frame(width: size.width, height: size.height).background(Color.white)
            let host = NSHostingView(rootView: root)
            host.appearance = NSAppearance(named: .aqua)
            host.frame = NSRect(origin: .zero, size: size)
            host.layoutSubtreeIfNeeded()
            #expect(host.fittingSize.width == 460)
            #expect(host.fittingSize.height == size.height)
            let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
            host.effectiveAppearance.performAsCurrentDrawingAppearance { host.cacheDisplay(in: host.bounds, to: bitmap) }
            #expect(bitmap.pixelsWide > 0 && bitmap.pixelsHigh > 0)
            if let directory = ProcessInfo.processInfo.environment["BLABEE_EVENT_NAVIGATION_RENDER_DIRECTORY"] {
                try FileManager.default.createDirectory(
                    at: URL(fileURLWithPath: directory, isDirectory: true), withIntermediateDirectories: true
                )
                let png = try #require(bitmap.representation(using: .png, properties: [:]))
                let name = actionCount == 0 ? "event-navigation-mixed-approval.png" : "event-navigation-decision-\(actionCount).png"
                try png.write(to: URL(fileURLWithPath: directory, isDirectory: true).appendingPathComponent(name))
            }
        }
    }
}
