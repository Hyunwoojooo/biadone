import AppKit
import Carbon
import Foundation
import Testing
@testable import BlabeeCoordinator

@Test("BlabeePet clamps frames purely across negative and oversized displays")
func blabeePetMultiDisplayFrameClamp() {
    let leftVisible = CGRect(x: -1_920, y: 24, width: 1_920, height: 1_056)
    let offscreen = CGRect(x: -2_400, y: -300, width: 440, height: 620)
    let clamped = PetFrameClamp.clamp(offscreen, to: leftVisible)
    #expect(clamped.minX == leftVisible.minX)
    #expect(clamped.minY == leftVisible.minY)
    #expect(leftVisible.contains(clamped))

    let tinyVisible = CGRect(x: 2_560, y: 100, width: 300, height: 200)
    let oversized = PetFrameClamp.clamp(
        CGRect(x: 3_000, y: 500, width: 900, height: 800),
        to: tinyVisible
    )
    #expect(oversized == tinyVisible)

    let displays = [
        PetDisplayGeometry(id: 1, frame: leftVisible, visibleFrame: leftVisible),
        PetDisplayGeometry(
            id: 2,
            frame: CGRect(x: 0, y: 0, width: 2_560, height: 1_440),
            visibleFrame: CGRect(x: 0, y: 24, width: 2_560, height: 1_416)
        ),
    ]
    #expect(PetDisplaySelection.preferred(
        displays: displays,
        mouseLocation: CGPoint(x: -500, y: 500),
        activeDisplayID: 2,
        stableDisplayID: nil
    )?.id == 1)
    #expect(PetDisplaySelection.preferred(
        displays: displays,
        mouseLocation: CGPoint(x: -500, y: 500),
        activeDisplayID: 2,
        stableDisplayID: 2
    )?.id == 2)
}

@Test("BlabeePet panel policy is accessory-safe and never requests activation")
func blabeePetNonactivatingPanelPolicy() {
    #expect(PetPanelPolicy.styleMask.contains(.borderless))
    #expect(PetPanelPolicy.styleMask.contains(.nonactivatingPanel))
    #expect(PetPanelPolicy.collectionBehavior.contains(.canJoinAllSpaces))
    #expect(PetPanelPolicy.collectionBehavior.contains(.fullScreenAuxiliary))
    #expect(PetPanelPolicy.collectionBehavior.contains(.ignoresCycle))
    #expect(!PetPanelPolicy.collectionBehavior.contains(.transient))
    #expect(!PetPanelPolicy.collectionBehavior.contains(.moveToActiveSpace))
    #expect(PetPanelPolicy.level == .floating)
    #expect(PetPanelPolicy.hidesOnDeactivate == false)
    #expect(PetPanelPolicy.activatesApplication == false)
    #expect(PetPanelPolicy.canBecomeKey == false)
    #expect(PetPanelPolicy.canBecomeMain == false)
}

@Test("BlabeePet startup failure stops the run loop and propagates to the CLI error path")
@MainActor
func blabeePetStartupFailurePropagation() throws {
    var stopped = false
    let delegate = PetApplicationDelegate(
        arguments: try PetArguments(["--socket", "/tmp/blabee-pet-startup.sock"]),
        startupOverride: {
            throw PetTestError.injected("startup_failed")
        },
        stopApplicationAfterStartupFailure: {
            stopped = true
        }
    )
    delegate.applicationDidFinishLaunching(Notification(
        name: NSApplication.didFinishLaunchingNotification
    ))
    #expect(stopped)
    #expect(delegate.startupError != nil)

    var propagated = false
    do {
        try delegate.rethrowStartupError()
    } catch PetTestError.injected(let code) {
        propagated = code == "startup_failed"
    } catch {
        propagated = false
    }
    #expect(propagated)
}

private final class PetFakeShortcutStore: PetShortcutConfigurationStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: PetShortcutConfiguration?

    init(_ stored: PetShortcutConfiguration? = nil) { self.stored = stored }

    func load() -> PetShortcutConfiguration? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    func save(_ configuration: PetShortcutConfiguration) {
        lock.lock()
        stored = configuration
        lock.unlock()
    }
}

@MainActor
private final class PetIntentRecorder {
    var intents: [PetShortcutIntent] = []
}

@Test("BlabeePet shortcut defaults persist and registry is one-handler dynamic exclusive")
@MainActor
func blabeePetShortcutDefaultConfigAndRetiredIDs() async throws {
    let defaults = PetShortcutConfiguration.defaults
    #expect(defaults.toggle == PetShortcut(
        keyCode: UInt32(kVK_Space),
        modifiers: UInt32(optionKey)
    ))
    #expect(defaults.slot1.keyCode == UInt32(kVK_ANSI_1))
    #expect(defaults.slot2.keyCode == UInt32(kVK_ANSI_2))
    #expect(defaults.slot3.keyCode == UInt32(kVK_ANSI_3))
    #expect(defaults.slot4.keyCode == UInt32(kVK_ANSI_4))

    let store = PetFakeShortcutStore()
    let backend = PetFakeHotKeyBackend()
    let recorder = PetIntentRecorder()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: defaults,
        store: store
    ) { intent in
        recorder.intents.append(intent)
    }
    let initialRegistrationsExclusive = backend.registrations.values.allSatisfy {
        $0.exclusive
    }
    #expect(backend.installCount == 1)
    #expect(backend.registrations.count == 1)
    #expect(initialRegistrationsExclusive)
    #expect(registry.statuses[.slot1] == .inactive)

    registry.reconcile(eligibleSlots: [1, 3])
    let dynamicRegistrationsExclusive = backend.registrations.values.allSatisfy {
        $0.exclusive
    }
    #expect(backend.registrations.count == 3)
    #expect(dynamicRegistrationsExclusive)
    guard case .registered(let slotOneID) = registry.statuses[.slot1] else {
        Issue.record("slot 1 was not registered")
        return
    }
    registry.reconcile(eligibleSlots: [3])
    #expect(backend.retiredEventIDs.contains(slotOneID))
    backend.emit(PetHotKeyEvent(signature: PetHotKeyRegistry.signature, id: slotOneID))
    await Task.yield()
    #expect(recorder.intents.isEmpty)

    let updated = PetShortcutConfiguration(
        toggle: defaults.toggle,
        slot1: PetShortcut(keyCode: UInt32(kVK_ANSI_5), modifiers: UInt32(optionKey)),
        slot2: defaults.slot2,
        slot3: defaults.slot3,
        slot4: defaults.slot4
    )
    registry.updateConfiguration(updated)
    #expect(store.load() == updated)
    #expect(backend.installCount == 1)
}

@Test("BlabeePet gives toggle priority for internal collisions and reports system collision")
@MainActor
func blabeePetShortcutCollisionPolicy() throws {
    let defaults = PetShortcutConfiguration.defaults
    let internallyColliding = PetShortcutConfiguration(
        toggle: defaults.toggle,
        slot1: defaults.toggle,
        slot2: defaults.slot2,
        slot3: defaults.slot3,
        slot4: defaults.slot4
    )
    let backend = PetFakeHotKeyBackend()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: internallyColliding
    ) { _ in }
    registry.reconcile(eligibleSlots: [1])
    #expect(registry.statuses[.slot1] == .internalCollision)
    if case .registered = registry.statuses[.toggle] {
        // Toggle owns the chord continuously.
    } else {
        Issue.record("toggle must win an internal collision")
    }

    let failingBackend = PetFakeHotKeyBackend()
    failingBackend.failingShortcuts = [defaults.toggle]
    let failingRegistry = try PetHotKeyRegistry(
        backend: failingBackend,
        configuration: defaults
    ) { _ in }
    #expect(failingRegistry.statuses[.toggle] == .systemCollision)

    let invalidBackend = PetFakeHotKeyBackend()
    invalidBackend.registrationErrors[defaults.toggle] = OSStatus(paramErr)
    let invalidRegistry = try PetHotKeyRegistry(
        backend: invalidBackend,
        configuration: defaults
    ) { _ in }
    #expect(invalidRegistry.statuses[.toggle] == .registrationFailure(status: OSStatus(paramErr)))
}

@Test("BlabeePet ignores inactive sibling collisions and swaps active chords in two phases")
@MainActor
func blabeePetShortcutActiveCollisionAndSwapPolicy() throws {
    let defaults = PetShortcutConfiguration.defaults
    let inactiveSiblingCollision = PetShortcutConfiguration(
        toggle: defaults.toggle,
        slot1: defaults.slot2,
        slot2: defaults.slot2,
        slot3: defaults.slot3,
        slot4: defaults.slot4
    )
    let inactiveBackend = PetFakeHotKeyBackend()
    let inactiveRegistry = try PetHotKeyRegistry(
        backend: inactiveBackend,
        configuration: inactiveSiblingCollision
    ) { _ in }
    inactiveRegistry.reconcile(eligibleSlots: [2])
    if case .registered = inactiveRegistry.statuses[.slot2] {
        // An inactive slot must not reserve or own its configured chord.
    } else {
        Issue.record("inactive sibling disabled an eligible shortcut")
    }
    #expect(inactiveRegistry.statuses[.slot1] == .inactive)

    let swapBackend = PetFakeHotKeyBackend()
    let swapRegistry = try PetHotKeyRegistry(
        backend: swapBackend,
        configuration: defaults
    ) { _ in }
    swapRegistry.reconcile(eligibleSlots: [1, 3])
    let swapped = PetShortcutConfiguration(
        toggle: defaults.toggle,
        slot1: defaults.slot3,
        slot2: defaults.slot2,
        slot3: defaults.slot1,
        slot4: defaults.slot4
    )
    swapRegistry.updateConfiguration(swapped)
    if case .registered = swapRegistry.statuses[.slot1] {
        // Both old registrations were retired before either new one was installed.
    } else {
        Issue.record("slot 1 chord swap produced a false system collision")
    }
    if case .registered = swapRegistry.statuses[.slot3] {
        // Covered above.
    } else {
        Issue.record("slot 3 chord swap produced a false system collision")
    }
}
