import AppKit
import Carbon
import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class ApprovalInput {
    var keys: Set<UInt32> = []
}

@MainActor
private final class ApprovalFixture {
    let input = ApprovalInput()
    let backend = PetFakeHotKeyBackend()
    let transport = PetFakeTransport()
    let vm: PetViewModel
    let registry: PetHotKeyRegistry

    init(previewMonitor: PetChoicePreviewHoldMonitor = PetChoicePreviewHoldMonitor()) throws {
        vm = PetViewModel(
            transport: transport,
            externalApplicationOpener: PetFakeApplicationOpener(),
            permissionResponseIDGenerator: { "permission_response_test" },
            managedApprovalResponseIDGenerator: { "managed_approval_response_test" },
            choicePreviewHoldMonitor: previewMonitor
        )
        let input = input
        let vm = vm
        registry = try PetHotKeyRegistry(
            backend: backend, configuration: .defaults,
            approvalKeyIsPressed: { input.keys.contains($0) }
        ) { [weak vm] in vm?.handleShortcut($0) }
        vm.attachHotKeyRegistry(registry)
    }

    func show(permission: [PetTestPermissionRequest] = [], managed: [PetTestManagedCommandApproval] = []) throws {
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(
            cards: [], permissionRequests: permission, managedCommandApprovals: managed
        ))
        vm.setPanelVisible(true)
    }

    func event(_ intent: PetApprovalShortcutIntent) throws -> PetHotKeyEvent {
        try #require(backend.registrations.values.first { $0.shortcut == intent.shortcut }?.event)
    }

    var approvalRegistrations: [PetFakeHotKeyBackend.Registration] {
        backend.registrations.values.filter { $0.event.signature == PetApprovalHotKeys.signature }
    }

    func press(_ intent: PetApprovalShortcutIntent) throws {
        input.keys.insert(intent.shortcut.keyCode)
        backend.emit(try event(intent))
    }
}

@MainActor
private func approvalWait(_ predicate: @MainActor () async -> Bool) async -> Bool {
    let deadline = ContinuousClock.now.advanced(by: .seconds(2))
    while ContinuousClock.now < deadline {
        if await predicate() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return await predicate()
}

@MainActor
private func drainApprovalEvents() async {
    for _ in 0..<15 { await Task.yield() }
}

@Suite("Approval shortcuts bind Command digits to the visible request")
struct PetApprovalHotKeyTests {
    @Test("Release events do not activate existing toggle, selection or preview handlers")
    @MainActor
    func preservesExistingPressHandlers() async throws {
        let backend = PetFakeHotKeyBackend()
        var choices: [PetShortcutIntent] = []
        var previews: [Int] = []
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults) { choices.append($0) }
        registry.onPreviewRequested = { previews.append($0) }
        registry.reconcile(eligibleSlots: [1])
        registry.reconcilePreviews(eligibleSlots: [1])
        let events = backend.registrations.values.map(\.event)
        for event in events {
            backend.emit(PetHotKeyEvent(signature: event.signature, id: event.id, phase: .released))
        }
        await drainApprovalEvents()
        #expect(choices.isEmpty)
        #expect(previews.isEmpty)
        for event in events { backend.emit(event) }
        #expect(await approvalWait { choices.count == 2 && previews == [1] })
        #expect(Set(choices) == [.toggle, .slot1])
        #expect(registry.configuration == .defaults)
    }

    @Test("Command digits resolve both approval kinds with fixed numbering", arguments: [false, true], PetApprovalShortcutIntent.allCases)
    @MainActor
    func resolvesExactDecision(managed: Bool, intent: PetApprovalShortcutIntent) async throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        let kind = managed ? "resolve_managed_command_approval" : "resolve_permission_request"
        let managedDecision: PetManagedCommandApprovalDecision = switch intent {
        case .allowOnce: .acceptOnce
        case .deny: .decline
        case .deferToCodex: .decideInCodex
        }
        let permissionDecision = try #require(PetPermissionDecision(choiceNumber: intent.rawValue))
        if managed {
            try f.show(managed: [PetTestManagedCommandApproval(suffix: "keys")])
            await f.transport.enqueue(type: kind, response: try petTestManagedCommandApprovalResolutionResponse(
                managedDecision, managedRequestID: "managed_request_keys"
            ))
        } else {
            try f.show(permission: [PetTestPermissionRequest(suffix: "keys", allowOnceAvailable: true)])
            await f.transport.enqueue(type: kind, response: try petTestPermissionResolutionResponse(
                permissionDecision, requestID: "permission_keys"
            ))
        }
        await f.transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        let head = try #require(f.vm.approvalHead)
        #expect(f.vm.approvalShortcutLabel(number: intent.rawValue, for: head) == intent.label)
        let event = try f.event(intent)
        #expect(event.signature == PetApprovalHotKeys.signature)
        #expect(intent.shortcut.modifiers == UInt32(cmdKey))
        try f.press(intent)
        f.backend.emit(event)
        #expect(await approvalWait {
            await f.transport.requestCount(type: kind) == 1 && f.vm.approvalHead == nil
        })
        let payload = try #require(await f.transport.requestPayloads(type: kind).first)
        let object = try petTestObject(payload)
        #expect(object["decision"] as? String == (managed ? managedDecision.rawValue : permissionDecision.rawValue))
        #expect(await f.transport.requestCount(type: kind) == 1)
        #expect(await f.transport.requestCount(type: "select") == 0)
        #expect(f.approvalRegistrations.isEmpty)
    }

    @Test("Hidden, closed and idle panels do not reserve Command digits")
    @MainActor
    func visibleOnly() throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        let defaults = f.registry.configuration
        try f.vm.receiveSnapshotDataForTesting(petTestSnapshotData(
            cards: [], permissionRequests: [PetTestPermissionRequest(suffix: "visibility", allowOnceAvailable: true)]
        ))
        #expect(f.approvalRegistrations.isEmpty)
        f.vm.setPanelVisible(true)
        #expect(f.approvalRegistrations.count == 3)
        f.vm.setPanelVisible(false)
        #expect(f.approvalRegistrations.isEmpty)
        #expect(f.vm.approvalShortcutLabels.isEmpty)
        f.vm.setPanelVisible(true)
        #expect(f.approvalRegistrations.count == 3)
        try f.vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: []))
        #expect(f.approvalRegistrations.isEmpty)
        #expect(f.registry.configuration == defaults)
        #expect(f.registry.statuses[.toggle] != .inactive)
    }

    @Test("An approval arriving over settings owns Command keys and preserves the underlying screen", arguments: [false, true], [false, true])
    @MainActor
    func approvalOverSettings(onboarding: Bool, managed: Bool) async throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        try f.show()
        if onboarding { await f.vm.beginOnboarding() }
        else {
            f.vm.beginShortcutSettings()
            f.vm.updatePreviewShortcutDraft(.controlCommand)
        }
        let draft = f.vm.shortcutDraft
        #expect(f.approvalRegistrations.isEmpty)
        #expect(f.vm.approvalShortcutLabels.isEmpty)

        let kind = managed ? "resolve_managed_command_approval" : "resolve_permission_request"
        if managed {
            try f.show(managed: [PetTestManagedCommandApproval(suffix: "settings")])
            await f.transport.enqueue(type: kind, response: try petTestManagedCommandApprovalResolutionResponse(
                .decline, managedRequestID: "managed_request_settings"
            ))
        } else {
            try f.show(permission: [PetTestPermissionRequest(suffix: "settings", allowOnceAvailable: true)])
            await f.transport.enqueue(type: kind, response: try petTestPermissionResolutionResponse(
                .deny, requestID: "permission_settings"
            ))
        }
        await f.transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        let head = try #require(f.vm.approvalHead)
        #expect(f.vm.approvalShortcutLabel(number: 2, for: head) == "⌘2")
        #expect(f.approvalRegistrations.count == 3)
        #expect(f.vm.isShowingOnboarding == onboarding)
        #expect(f.vm.isEditingShortcuts == !onboarding)
        #expect(f.vm.shortcutDraft == draft)
        try f.press(.deny)
        #expect(await approvalWait { await f.transport.requestCount(type: kind) == 1 && f.vm.approvalHead == nil })
        #expect(f.approvalRegistrations.isEmpty)
        #expect(f.vm.approvalShortcutLabels.isEmpty)
        #expect(f.vm.isShowingOnboarding == onboarding)
        #expect(f.vm.isEditingShortcuts == !onboarding)
        #expect(f.vm.shortcutDraft == draft)
        #expect(f.registry.configuration == .defaults)
    }

    @Test("Unavailable and failed chords are not advertised or remapped")
    @MainActor
    func unavailableAndCollision() throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        f.backend.failingShortcuts = [PetApprovalShortcutIntent.deny.shortcut]
        try f.show(permission: [PetTestPermissionRequest(suffix: "unqualified")])
        let head = try #require(f.vm.approvalHead)
        #expect(f.vm.approvalShortcutLabel(number: 1, for: head) == nil)
        #expect(f.vm.approvalShortcutLabel(number: 2, for: head) == nil)
        #expect(f.vm.approvalShortcutLabel(number: 3, for: head) == "⌘3")
        #expect(f.approvalRegistrations.map(\.shortcut) == [PetApprovalShortcutIntent.deferToCodex.shortcut])
        #expect(f.vm.approvalShortcutDiagnostic?.contains("⌘2") == true)
        try f.show(managed: [PetTestManagedCommandApproval(
            suffix: "unsupported", allowOnceAvailable: false, declineAvailable: false
        )])
        #expect(f.approvalRegistrations.map(\.shortcut) == [PetApprovalShortcutIntent.deferToCodex.shortcut])
        try f.show(permission: [PetTestPermissionRequest(suffix: "delivering", allowOnceAvailable: true, deliveryPending: true)])
        #expect(f.approvalRegistrations.isEmpty)
        #expect(f.vm.approvalShortcutLabels.isEmpty)
    }

    @Test("A queued key event cannot follow a replaced or changed approval head", arguments: ["next", "availability", "delivery", "reopen"])
    @MainActor
    func staleEventCannotResolveNewHead(change: String) async throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        try f.show(permission: [PetTestPermissionRequest(suffix: "first", allowOnceAvailable: true)])
        let oldEvent = try f.event(.allowOnce)
        try f.press(.allowOnce)
        switch change {
        case "availability":
            try f.show(permission: [PetTestPermissionRequest(suffix: "first", allowOnceAvailable: false)])
            try f.show(permission: [PetTestPermissionRequest(suffix: "first", allowOnceAvailable: true)])
        case "delivery":
            try f.show(permission: [PetTestPermissionRequest(suffix: "first", allowOnceAvailable: true, deliveryPending: true)])
        case "reopen":
            f.vm.setPanelVisible(false)
            f.vm.setPanelVisible(true)
        default:
            try f.show(managed: [PetTestManagedCommandApproval(suffix: "second")])
        }
        f.backend.emit(oldEvent)
        await drainApprovalEvents()
        #expect(await f.transport.requestCount(type: "resolve_permission_request") == 0)
        #expect(await f.transport.requestCount(type: "resolve_managed_command_approval") == 0)
    }

    @Test("A held digit and Command-only release cannot approve the next FIFO request")
    @MainActor
    func heldKeyCannotApproveNextRequest() async throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        let first = PetTestPermissionRequest(suffix: "first", allowOnceAvailable: true)
        let second = PetTestPermissionRequest(suffix: "second", allowOnceAvailable: true)
        try f.show(permission: [first, second])
        await f.transport.enqueue(type: "resolve_permission_request", response: try petTestPermissionResolutionResponse(.allowOnce, requestID: "permission_first"))
        await f.transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [], permissionRequests: [second]))
        let firstEvent = try f.event(.allowOnce)
        try f.press(.allowOnce)
        #expect(await approvalWait { f.vm.pendingPermissionRequest?.requestID == "permission_second" && f.vm.inFlightPermissionRequestID == nil })
        let nextEvent = try f.event(.allowOnce)
        #expect(nextEvent.id != firstEvent.id)
        f.backend.emit(nextEvent)
        f.backend.emit(PetHotKeyEvent(signature: firstEvent.signature, id: firstEvent.id, phase: .released))
        f.registry.pollApprovalKeyRelease()
        f.backend.emit(nextEvent)
        await drainApprovalEvents()
        #expect(await f.transport.requestCount(type: "resolve_permission_request") == 1)
        #expect(f.vm.approvalShortcutLabels.isEmpty)
        f.input.keys = []
        f.registry.pollApprovalKeyRelease()
        #expect(f.vm.approvalShortcutLabels[.allowOnce] == "⌘1")
        await f.transport.enqueue(type: "resolve_permission_request", response: try petTestPermissionResolutionResponse(.allowOnce, requestID: "permission_second"))
        await f.transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        try f.press(.allowOnce)
        #expect(await approvalWait { await f.transport.requestCount(type: "resolve_permission_request") == 2 && f.vm.approvalHead == nil })
    }

    @Test("An ignored overlapping digit stays blocked until that digit is physically released")
    @MainActor
    func gateTracksIgnoredOverlappingDigit() throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        try f.show(permission: [PetTestPermissionRequest(suffix: "overlap", allowOnceAvailable: true)])
        let head = try #require(f.vm.approvalHead)
        let gate = PetApprovalHotKeyEventGate()
        let deny = PetApprovalShortcutActivation(head: head, intent: .deny, eventID: 1)
        let allow = PetApprovalShortcutActivation(head: head, intent: .allowOnce, eventID: 2)
        let denyEvent = PetHotKeyEvent(signature: PetApprovalHotKeys.signature, id: deny.eventID)
        let allowEvent = PetHotKeyEvent(signature: PetApprovalHotKeys.signature, id: allow.eventID)
        gate.replaceBindings([deny.eventID: deny, allow.eventID: allow], held: [])

        #expect(gate.capture(denyEvent) == deny)
        #expect(gate.capture(allowEvent) == nil)
        #expect(gate.keysAwaitingRelease == [deny.intent.shortcut.keyCode, allow.intent.shortcut.keyCode])
        gate.release([deny.intent.shortcut.keyCode])
        #expect(gate.capture(allowEvent) == nil)
        gate.release([allow.intent.shortcut.keyCode])
        #expect(gate.capture(allowEvent) == allow)
    }

    @Test("Overlapping digits cannot turn a blocked press into an approval of the next FIFO request", arguments: [false, true])
    @MainActor
    func overlappingHeldDigitsCannotApproveNextRequest(managed: Bool) async throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        try f.show(permission: [PetTestPermissionRequest(suffix: "overlap_first", allowOnceAvailable: true)])
        await f.transport.enqueue(type: "resolve_permission_request", response: try petTestPermissionResolutionResponse(
            .deny, requestID: "permission_overlap_first"
        ))
        let nextSnapshot = managed
            ? try petTestSnapshotData(cards: [], managedCommandApprovals: [PetTestManagedCommandApproval(suffix: "overlap_second")])
            : try petTestSnapshotData(cards: [], permissionRequests: [PetTestPermissionRequest(suffix: "overlap_second", allowOnceAvailable: true)])
        await f.transport.enqueue(type: "get_state", response: nextSnapshot)
        try f.press(.deny)
        #expect(await approvalWait {
            let nextVisible = managed
                ? f.vm.pendingManagedCommandApproval?.managedRequestID == "managed_request_overlap_second"
                : f.vm.pendingPermissionRequest?.requestID == "permission_overlap_second"
            return nextVisible && f.vm.inFlightPermissionRequestID == nil
        })

        let nextHead = try #require(f.vm.approvalHead)
        let nextEvent = try f.event(.allowOnce)
        try f.press(.allowOnce)
        await drainApprovalEvents()
        #expect(f.vm.approvalShortcutLabels.isEmpty)
        f.input.keys.remove(PetApprovalShortcutIntent.deny.shortcut.keyCode)
        f.registry.pollApprovalKeyRelease()
        #expect(f.vm.approvalShortcutLabels.isEmpty)

        if managed {
            await f.transport.enqueue(type: "resolve_managed_command_approval", response: try petTestManagedCommandApprovalResolutionResponse(
                .acceptOnce, managedRequestID: "managed_request_overlap_second"
            ))
        } else {
            await f.transport.enqueue(type: "resolve_permission_request", response: try petTestPermissionResolutionResponse(
                .allowOnce, requestID: "permission_overlap_second"
            ))
        }
        await f.transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        // Releasing/repressing Command (or a repeated Carbon pressed event)
        // must not reuse the still-held 1 that was ignored while 2 was down.
        f.backend.emit(PetHotKeyEvent(signature: nextEvent.signature, id: nextEvent.id, phase: .released))
        f.backend.emit(nextEvent)
        await drainApprovalEvents()
        #expect(await f.transport.requestCount(type: "resolve_permission_request") == 1)
        #expect(await f.transport.requestCount(type: "resolve_managed_command_approval") == 0)
        try #require(f.vm.approvalHead == nextHead)

        f.input.keys = []
        f.registry.pollApprovalKeyRelease()
        #expect(f.vm.approvalShortcutLabels[.allowOnce] == "⌘1")
        try f.press(.allowOnce)
        #expect(await approvalWait { f.vm.approvalHead == nil })
        #expect(await f.transport.requestCount(type: "resolve_permission_request") == (managed ? 1 : 2))
        #expect(await f.transport.requestCount(type: "resolve_managed_command_approval") == (managed ? 1 : 0))
    }

    @Test("Either approval kind in flight blocks keys and clicks for the other kind", arguments: [false, true])
    @MainActor
    func crossKindSingleFlight(managedFirst: Bool) async throws {
        let f = try ApprovalFixture()
        defer { f.vm.stopPolling() }
        let permission = PetTestPermissionRequest(suffix: "cross", allowOnceAvailable: true)
        let managed = PetTestManagedCommandApproval(suffix: "cross")
        let firstKind = managedFirst ? "resolve_managed_command_approval" : "resolve_permission_request"
        let secondKind = managedFirst ? "resolve_permission_request" : "resolve_managed_command_approval"
        if managedFirst {
            try f.show(managed: [managed])
            await f.transport.setNextManagedApprovalResolutionBlocked(true)
            await f.transport.enqueue(type: firstKind, response: try petTestManagedCommandApprovalResolutionResponse(.acceptOnce, managedRequestID: "managed_request_cross"))
        } else {
            try f.show(permission: [permission])
            await f.transport.setNextPermissionResolutionBlocked(true)
            await f.transport.enqueue(type: firstKind, response: try petTestPermissionResolutionResponse(.allowOnce, requestID: "permission_cross"))
        }
        try f.press(.allowOnce)
        #expect(await approvalWait { await f.transport.requestCount(type: firstKind) == 1 })
        if managedFirst {
            try f.show(permission: [permission])
            let request = try #require(f.vm.pendingPermissionRequest)
            await f.vm.resolvePermissionRequest(.allowOnce, for: request)
        } else {
            try f.show(managed: [managed])
            let request = try #require(f.vm.pendingManagedCommandApproval)
            await f.vm.resolveManagedCommandApproval(.acceptOnce, for: request)
        }
        #expect(f.approvalRegistrations.isEmpty)
        #expect(await f.transport.requestCount(type: secondKind) == 0)
        await f.transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        if managedFirst { await f.transport.setNextManagedApprovalResolutionBlocked(false) }
        else { await f.transport.setNextPermissionResolutionBlocked(false) }
        #expect(await approvalWait { f.vm.inFlightPermissionRequestID == nil && f.vm.inFlightManagedCommandApprovalID == nil })
    }

    @Test("An active preview release guard suspends approval registration")
    @MainActor
    func previewReleaseGuard() throws {
        let input = ApprovalInput()
        var controlDown = true
        let monitor = PetChoicePreviewHoldMonitor(
            modifierIsPressed: { _ in controlDown }, keyIsPressed: { input.keys.contains($0) }
        )
        let f = try ApprovalFixture(previewMonitor: monitor)
        defer { f.vm.stopPolling() }
        try f.vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [PetTestCard(suffix: "preview", rankedActionCount: 4)]))
        input.keys = [UInt32(kVK_ANSI_1)]
        f.vm.beginChoicePreview(slot: 1)
        controlDown = false
        monitor.poll()
        #expect(monitor.suppressesSelection)
        try f.show(permission: [PetTestPermissionRequest(suffix: "preview", allowOnceAvailable: true)])
        #expect(f.approvalRegistrations.isEmpty)
        input.keys = []
        monitor.poll()
        try f.show(permission: [PetTestPermissionRequest(suffix: "preview", allowOnceAvailable: true)])
        #expect(f.approvalRegistrations.count == 3)
        #expect(f.registry.configuration == .defaults)
    }
}
