import Carbon
import Foundation
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class NavigationInput {
    var keys: Set<UInt32> = []
}

@MainActor
private final class NavigationRecorder {
    var activations: [PetEventNavigationActivation] = []
    var choices: [PetShortcutIntent] = []
    var previews: [Int] = []
}

@MainActor
private final class NavigationFixture {
    let input = NavigationInput()
    let backend = PetFakeHotKeyBackend()
    let recorder = NavigationRecorder()
    let registry: PetHotKeyRegistry

    init() throws {
        let input = input
        let recorder = recorder
        registry = try PetHotKeyRegistry(
            backend: backend, configuration: .defaults,
            eventNavigationKeyIsPressed: { input.keys.contains($0) },
            eventNavigationModifiers: { UInt32(optionKey) }
        ) { recorder.choices.append($0) }
        registry.onEventNavigationRequested = { recorder.activations.append($0) }
        registry.onPreviewRequested = { recorder.previews.append($0) }
    }

    var navigationBindings: [PetFakeHotKeyBackend.Registration] {
        backend.registrations.values.filter { $0.event.signature == PetEventNavigationHotKeys.signature }
    }

    func event(_ direction: PetEventNavigationDirection) throws -> PetHotKeyEvent {
        try #require(navigationBindings.first { $0.shortcut == direction.shortcut }?.event)
    }

    func press(_ direction: PetEventNavigationDirection) throws {
        input.keys.insert(direction.shortcut.keyCode)
        backend.emit(try event(direction))
    }

    func release() {
        input.keys.removeAll()
        registry.pollEventNavigationKeyRelease()
    }
}

@MainActor
private func drainNavigationEvents() async {
    for _ in 0..<20 { await Task.yield() }
}

@Suite("Event navigation hotkeys reserve Option arrows only for an eligible visible context")
struct PetEventNavigationHotKeyTests {
    @Test("Disabled contexts leave arrow navigation to other applications")
    @MainActor
    func enableDisablePreservesExistingBindings() throws {
        let f = try NavigationFixture()
        f.registry.reconcile(eligibleSlots: [1, 2])
        f.registry.reconcilePreviews(eligibleSlots: [1, 2])
        let originalBindings = f.backend.registrations
        #expect(f.navigationBindings.isEmpty)
        f.registry.reconcileEventNavigation(contextID: "visible-event-1")
        #expect(f.navigationBindings.count == 2)
        #expect(f.navigationBindings.allSatisfy { $0.exclusive && $0.shortcut.modifiers == UInt32(optionKey) })
        #expect(f.registry.eventNavigationShortcutLabel(for: .previous) == "⌥←")
        #expect(f.registry.eventNavigationShortcutLabel(for: .next) == "⌥→")
        let eventCount = f.backend.registrationHistory.count
        f.registry.reconcileEventNavigation(contextID: "visible-event-1")
        #expect(f.backend.registrationHistory.count == eventCount)
        f.registry.reconcileEventNavigation(contextID: nil)
        #expect(f.navigationBindings.isEmpty)
        #expect(f.backend.registrations == originalBindings)
        #expect(f.registry.configuration == .defaults)
        #expect(f.registry.eventNavigationShortcutLabel(for: .next) == nil)
        #expect(f.registry.eventNavigationShortcutDiagnostic == nil)
        #expect(f.backend.installCount == 1)
    }

    @Test("Press activates once without reaching selection or preview handlers", arguments: PetEventNavigationDirection.allCases)
    @MainActor
    func singlePress(direction: PetEventNavigationDirection) async throws {
        let f = try NavigationFixture()
        f.registry.reconcileEventNavigation(contextID: "queue-a")
        try f.press(direction)
        try f.press(direction)
        try f.press(direction)
        await drainNavigationEvents()
        #expect(f.recorder.activations.count == 1)
        #expect(f.recorder.activations.first?.direction == direction)
        #expect(f.recorder.activations.first?.contextID == "queue-a")
        #expect(f.recorder.choices.isEmpty)
        #expect(f.recorder.previews.isEmpty)
        f.release()
    }

    @Test("Queued callbacks cannot navigate a replaced, hidden or reopened context", arguments: ["replace", "hide", "reopen"])
    @MainActor
    func staleCallbacks(change: String) async throws {
        let f = try NavigationFixture()
        f.registry.reconcileEventNavigation(contextID: "first")
        let staleEvent = try f.event(.next)
        try f.press(.next)
        switch change {
        case "replace": f.registry.reconcileEventNavigation(contextID: "second")
        case "hide": f.registry.reconcileEventNavigation(contextID: nil)
        default:
            f.registry.reconcileEventNavigation(contextID: nil)
            f.registry.reconcileEventNavigation(contextID: "first")
        }
        f.backend.emit(staleEvent)
        await drainNavigationEvents()
        #expect(f.recorder.activations.isEmpty)
        f.release()
        if change != "hide" {
            try f.press(.next)
            await drainNavigationEvents()
            #expect(f.recorder.activations.count == 1)
        }
        f.release()
    }

    @Test("A held arrow remains blocked across a context change and Option release")
    @MainActor
    func physicalReleaseRequired() async throws {
        let f = try NavigationFixture()
        f.registry.reconcileEventNavigation(contextID: "first")
        try f.press(.next)
        await drainNavigationEvents()
        let first = try #require(f.recorder.activations.first)
        f.registry.reconcileEventNavigation(contextID: "second")
        #expect(!f.registry.isCurrentEventNavigationActivation(first))
        let next = try f.event(.next)
        f.backend.emit(PetHotKeyEvent(signature: next.signature, id: next.id, phase: .released))
        try f.press(.next)
        await drainNavigationEvents()
        #expect(f.recorder.activations.count == 1)
        f.release()
        try f.press(.next)
        await drainNavigationEvents()
        #expect(f.recorder.activations.map(\.contextID) == ["first", "second"])
        f.release()
    }

    @Test("An arrow already held when the panel becomes eligible needs a new press")
    @MainActor
    func heldDuringRegistration() async throws {
        let f = try NavigationFixture()
        f.input.keys.insert(PetEventNavigationDirection.previous.shortcut.keyCode)
        f.registry.reconcileEventNavigation(contextID: "shown")
        try f.press(.previous)
        await drainNavigationEvents()
        #expect(f.recorder.activations.isEmpty)
        f.release()
        try f.press(.previous)
        await drainNavigationEvents()
        #expect(f.recorder.activations.count == 1)
        f.release()
    }

    @Test("Wrong modifiers, signatures and release events cannot capture navigation")
    func exactChordOnly() {
        let gate = PetEventNavigationHotKeyEventGate()
        let activation = PetEventNavigationActivation(contextID: "exact", direction: .next, eventID: 12)
        let event = PetHotKeyEvent(signature: PetEventNavigationHotKeys.signature, id: 12)
        gate.replaceBindings([12: activation], held: [])
        for modifiers in [UInt32(0), UInt32(cmdKey), UInt32(optionKey | shiftKey), UInt32(optionKey | controlKey), UInt32(optionKey | cmdKey)] {
            #expect(gate.capture(event, modifiers: modifiers) == nil)
        }
        #expect(gate.capture(PetHotKeyEvent(signature: 0, id: 12), modifiers: UInt32(optionKey)) == nil)
        #expect(gate.capture(PetHotKeyEvent(signature: event.signature, id: 99), modifiers: UInt32(optionKey)) == nil)
        #expect(gate.capture(PetHotKeyEvent(signature: event.signature, id: 12, phase: .released), modifiers: UInt32(optionKey)) == nil)
        #expect(gate.capture(event, modifiers: UInt32(optionKey)) == activation)
        #expect(gate.capture(event, modifiers: UInt32(optionKey)) == nil)
    }

    @Test("A registration failure rolls back both arrows and preserves every existing key", arguments: PetEventNavigationDirection.allCases, [OSStatus(eventHotKeyExistsErr), OSStatus(-50)])
    @MainActor
    func collisionRollback(direction: PetEventNavigationDirection, status: OSStatus) throws {
        let f = try NavigationFixture()
        f.registry.reconcile(eligibleSlots: [1, 2, 3, 4])
        f.registry.reconcilePreviews(eligibleSlots: [1, 2, 3, 4])
        let originalBindings = f.backend.registrations
        f.backend.registrationErrors[direction.shortcut] = status
        f.registry.reconcileEventNavigation(contextID: "conflicting")
        #expect(f.navigationBindings.isEmpty)
        #expect(f.backend.registrations == originalBindings)
        #expect(f.registry.configuration == .defaults)
        #expect(f.registry.eventNavigationShortcutLabel(for: .previous) == nil)
        #expect(f.registry.eventNavigationShortcutLabel(for: .next) == nil)
        #expect(f.registry.eventNavigationShortcutDiagnostic?.contains(direction.label) == true)
        #expect(f.registry.eventNavigationShortcutDiagnostic?.contains("버튼") == true)
        f.backend.registrationErrors.removeAll()
        f.registry.reconcileEventNavigation(contextID: nil)
        f.registry.reconcileEventNavigation(contextID: "retry")
        #expect(f.navigationBindings.count == 2)
        #expect(f.registry.eventNavigationShortcutDiagnostic == nil)
    }
}
