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

@Test("BlabeePet resizing preserves the lower-trailing anchor and round-trips")
@MainActor
func blabeePetLowerTrailingResizeRoundTrip() {
    let visibleFrame = CGRect(x: 0, y: 24, width: 1_920, height: 1_056)
    let initial = PetFrameClamp.lowerTrailingFrame(
        size: PetPanelController.collapsedSize,
        in: visibleFrame
    )
    let expanded = PetFrameClamp.resizedLowerTrailingFrame(
        from: initial,
        to: PetPanelController.expandedSize,
        in: visibleFrame
    )
    let collapsed = PetFrameClamp.resizedLowerTrailingFrame(
        from: expanded,
        to: PetPanelController.collapsedSize,
        in: visibleFrame
    )

    #expect(expanded.maxX == initial.maxX)
    #expect(expanded.minY == initial.minY)
    #expect(collapsed == initial)

    let moved = CGRect(x: 1_200, y: 200, width: 92, height: 92)
    let movedExpanded = PetFrameClamp.resizedLowerTrailingFrame(
        from: moved,
        to: PetPanelController.expandedSize,
        in: visibleFrame
    )
    #expect(movedExpanded.maxX == moved.maxX)
    #expect(movedExpanded.minY == moved.minY)
}

@Test("BlabeePet lower-trailing resizing supports negative and tiny displays")
@MainActor
func blabeePetLowerTrailingResizeDisplaySafety() {
    let negativeVisibleFrame = CGRect(x: -1_920, y: 24, width: 1_920, height: 1_056)
    let negativeInitial = PetFrameClamp.lowerTrailingFrame(
        size: PetPanelController.collapsedSize,
        in: negativeVisibleFrame
    )
    let negativeExpanded = PetFrameClamp.resizedLowerTrailingFrame(
        from: negativeInitial,
        to: PetPanelController.expandedSize,
        in: negativeVisibleFrame
    )
    let negativeCollapsed = PetFrameClamp.resizedLowerTrailingFrame(
        from: negativeExpanded,
        to: PetPanelController.collapsedSize,
        in: negativeVisibleFrame
    )
    #expect(negativeExpanded.maxX == negativeInitial.maxX)
    #expect(negativeExpanded.minY == negativeInitial.minY)
    #expect(negativeCollapsed == negativeInitial)

    let tinyVisibleFrame = CGRect(x: 2_560, y: 100, width: 300, height: 200)
    let oversized = PetFrameClamp.resizedLowerTrailingFrame(
        from: CGRect(x: 2_748, y: 120, width: 92, height: 92),
        to: PetPanelController.expandedSize,
        in: tinyVisibleFrame
    )
    #expect(oversized == tinyVisibleFrame)
    #expect(tinyVisibleFrame.contains(oversized))

    let restoredVisibleFrame = CGRect(x: 0, y: 24, width: 3_420, height: 1_396)
    let restored = PetFrameClamp.resizedLowerTrailingFrame(
        from: oversized,
        to: PetPanelController.expandedSize,
        in: restoredVisibleFrame
    )
    #expect(restored.size == PetPanelController.expandedSize)
    #expect(restored.maxX == oversized.maxX)
    #expect(restored.minY == oversized.minY)
    #expect(restoredVisibleFrame.contains(restored))
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

@Test("BlabeePet shortcut catalog requires Option and rejects unsafe or duplicate drafts")
func blabeePetShortcutCatalogSafety() {
    #expect(PetShortcutCatalog.modifierPresets.allSatisfy {
        $0.modifiers & UInt32(optionKey) != 0
    })
    #expect(PetShortcutCatalog.keys.contains {
        $0.keyCode == UInt32(kVK_Space) && $0.displayLabel == "Space"
    })
    #expect(PetShortcutCatalog.keys.contains {
        $0.keyCode == UInt32(kVK_ANSI_Z) && $0.displayLabel == "Z"
    })
    #expect(PetShortcutCatalog.displayLabel(
        for: PetShortcutConfiguration.defaults.toggle
    ) == "⌥Space")
    #expect(PetShortcutCatalog.displayLabel(for: PetShortcut(
        keyCode: UInt32(kVK_ANSI_K),
        modifiers: UInt32(optionKey) | UInt32(cmdKey)
    )) == "⌥⌘K")

    var unsafe = PetShortcutConfiguration.defaults
    unsafe.setShortcut(
        PetShortcut(keyCode: UInt32(kVK_ANSI_A), modifiers: UInt32(controlKey)),
        for: .slot1
    )
    #expect(unsafe.validationIssue() == .unsupported(.slot1))

    var optionOnlyLetter = PetShortcutConfiguration.defaults
    optionOnlyLetter.setShortcut(
        PetShortcut(keyCode: UInt32(kVK_ANSI_A), modifiers: UInt32(optionKey)),
        for: .slot1
    )
    #expect(optionOnlyLetter.validationIssue() == .unsupported(.slot1))

    var duplicate = PetShortcutConfiguration.defaults
    duplicate.setShortcut(duplicate.toggle, for: .slot1)
    #expect(duplicate.validationIssue() == .duplicate(owner: .toggle, duplicate: .slot1))
}

@Test("BlabeePet user defaults store rejects invalid loads and invalid overwrites")
func blabeePetShortcutStoreValidation() throws {
    let suiteName = "com.biadone.blabee.tests.shortcuts.\(UUID().uuidString)"
    let key = "shortcuts"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let store = PetUserDefaultsShortcutStore(defaults: defaults, key: key)

    store.save(.defaults)
    #expect(store.load() == .defaults)

    var invalid = PetShortcutConfiguration.defaults
    invalid.setShortcut(invalid.toggle, for: .slot1)
    store.save(invalid)
    #expect(store.load() == .defaults)

    defaults.set(try JSONEncoder().encode(invalid), forKey: key)
    #expect(store.load() == nil)
}

@Test("BlabeePet shortcut settings use draft cancel defaults and validated persistence")
@MainActor
func blabeePetShortcutSettingsDraftLifecycle() throws {
    let store = PetFakeShortcutStore()
    let backend = PetFakeHotKeyBackend()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: .defaults,
        store: store
    ) { _ in }
    let viewModel = PetViewModel(
        transport: PetFakeTransport(),
        externalApplicationOpener: PetFakeApplicationOpener()
    )
    viewModel.attachHotKeyRegistry(registry)
    registry.reconcile(eligibleSlots: [1])
    guard case .registered(let originalSlotOneID) = registry.statuses[.slot1] else {
        Issue.record("slot 1 must be registered before settings are applied")
        return
    }

    #expect(viewModel.shortcutLabel(for: .slot1) == "⌥1")
    viewModel.beginShortcutSettings()
    viewModel.updateShortcutDraft(
        intent: .slot1,
        keyCode: UInt32(kVK_Space),
        modifiers: UInt32(optionKey)
    )
    #expect(!viewModel.canSaveShortcutSettings)
    #expect(viewModel.shortcutSettingsError != nil)
    viewModel.saveShortcutSettings()
    #expect(viewModel.isEditingShortcuts)
    #expect(registry.configuration == .defaults)
    #expect(store.load() == nil)

    viewModel.cancelShortcutSettings()
    #expect(!viewModel.isEditingShortcuts)
    #expect(viewModel.shortcutDraft == .defaults)
    #expect(store.load() == nil)

    viewModel.beginShortcutSettings()
    viewModel.updateShortcutDraft(
        intent: .slot1,
        keyCode: UInt32(kVK_ANSI_K),
        modifiers: UInt32(optionKey) | UInt32(cmdKey)
    )
    #expect(viewModel.canSaveShortcutSettings)
    #expect(viewModel.shortcutDraftStatusDescription(for: .slot1) == "저장 전")
    viewModel.saveShortcutSettings()
    let custom = registry.configuration
    #expect(custom.slot1 == PetShortcut(
        keyCode: UInt32(kVK_ANSI_K),
        modifiers: UInt32(optionKey) | UInt32(cmdKey)
    ))
    #expect(store.load() == custom)
    #expect(viewModel.shortcutLabel(for: .slot1) == "⌥⌘K")
    #expect(!viewModel.isEditingShortcuts)
    guard case .registered(let updatedSlotOneID) = registry.statuses[.slot1] else {
        Issue.record("saved shortcut must be re-registered")
        return
    }
    #expect(updatedSlotOneID != originalSlotOneID)
    #expect(backend.retiredEventIDs.contains(originalSlotOneID))
    #expect(backend.registrations[updatedSlotOneID]?.shortcut == custom.slot1)

    viewModel.beginShortcutSettings()
    viewModel.restoreDefaultShortcutDraft()
    #expect(viewModel.shortcutDraft == .defaults)
    viewModel.cancelShortcutSettings()
    #expect(viewModel.shortcutConfiguration == custom)
    #expect(store.load() == custom)

    viewModel.beginShortcutSettings()
    viewModel.restoreDefaultShortcutDraft()
    viewModel.saveShortcutSettings()
    #expect(viewModel.shortcutConfiguration == .defaults)
    #expect(store.load() == .defaults)

    viewModel.beginShortcutSettings()
    viewModel.updateShortcutDraft(
        intent: .slot2,
        keyCode: UInt32(kVK_ANSI_L),
        modifiers: UInt32(optionKey) | UInt32(shiftKey)
    )
    viewModel.setExpanded(false)
    #expect(!viewModel.isEditingShortcuts)
    #expect(viewModel.shortcutDraft == .defaults)
}

@Test("BlabeePet keeps shortcut editor open and restores bindings when registration fails")
@MainActor
func blabeePetShortcutSettingsRegistrationFailureRollback() throws {
    let defaults = PetShortcutConfiguration.defaults
    let candidateShortcut = PetShortcut(
        keyCode: UInt32(kVK_ANSI_K),
        modifiers: UInt32(optionKey) | UInt32(cmdKey)
    )
    let store = PetFakeShortcutStore(defaults)
    let backend = PetFakeHotKeyBackend()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: defaults,
        store: store
    ) { _ in }
    let viewModel = PetViewModel(
        transport: PetFakeTransport(),
        externalApplicationOpener: PetFakeApplicationOpener()
    )
    viewModel.attachHotKeyRegistry(registry)
    registry.reconcile(eligibleSlots: [1])
    guard case .registered(let originalEventID) = registry.statuses[.slot1] else {
        Issue.record("slot 1 must be registered before a transactional update")
        return
    }

    backend.failingShortcuts = [candidateShortcut]
    viewModel.beginShortcutSettings()
    viewModel.updateShortcutDraft(
        intent: .slot1,
        keyCode: candidateShortcut.keyCode,
        modifiers: candidateShortcut.modifiers
    )
    viewModel.saveShortcutSettings()

    #expect(viewModel.isEditingShortcuts)
    #expect(viewModel.shortcutDraft.slot1 == candidateShortcut)
    #expect(viewModel.shortcutConfiguration == defaults)
    #expect(viewModel.shortcutSettingsError?.contains("기존 설정으로 복원") == true)
    #expect(registry.configuration == defaults)
    #expect(store.load() == defaults)
    #expect(backend.retiredEventIDs.contains(originalEventID))
    #expect(backend.registrations.values.contains { $0.shortcut == defaults.slot1 })
    if case .registered = registry.statuses[.slot1] {
        // The old chord was re-registered after the rejected candidate.
    } else {
        Issue.record("slot 1 must be restored after a system collision")
    }
}

@Test("BlabeePet restores configuration for generic registration errors")
@MainActor
func blabeePetShortcutGenericRegistrationFailureRollback() throws {
    let defaults = PetShortcutConfiguration.defaults
    let candidateShortcut = PetShortcut(
        keyCode: UInt32(kVK_ANSI_J),
        modifiers: UInt32(optionKey) | UInt32(shiftKey)
    )
    var candidate = defaults
    candidate.setShortcut(candidateShortcut, for: .slot1)
    let store = PetFakeShortcutStore(defaults)
    let backend = PetFakeHotKeyBackend()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: defaults,
        store: store
    ) { _ in }
    registry.reconcile(eligibleSlots: [1])
    backend.registrationErrors[candidateShortcut] = OSStatus(paramErr)

    let result = registry.updateConfiguration(candidate)
    guard case .registrationRejected(let failures) = result else {
        Issue.record("paramErr must reject the candidate configuration")
        return
    }
    #expect(failures == [PetShortcutApplyFailure(
        intent: .slot1,
        status: .registrationFailure(status: OSStatus(paramErr))
    )])
    #expect(registry.configuration == defaults)
    #expect(store.load() == defaults)
    #expect(backend.registrations.values.contains { $0.shortcut == defaults.slot1 })
}

@Test("BlabeePet reports when both candidate registration and binding restoration fail")
@MainActor
func blabeePetShortcutRollbackFailureStatus() throws {
    let defaults = PetShortcutConfiguration.defaults
    let candidateShortcut = PetShortcut(
        keyCode: UInt32(kVK_ANSI_K),
        modifiers: UInt32(optionKey) | UInt32(shiftKey)
    )
    var candidate = defaults
    candidate.setShortcut(candidateShortcut, for: .slot1)
    let store = PetFakeShortcutStore(defaults)
    let backend = PetFakeHotKeyBackend()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: defaults,
        store: store
    ) { _ in }
    registry.reconcile(eligibleSlots: [1])
    backend.registrationErrors[candidateShortcut] = OSStatus(paramErr)
    backend.failingShortcuts = [defaults.slot1]

    let result = registry.updateConfiguration(candidate)
    guard case .rollbackFailed(let candidateFailures, let rollbackFailures) = result else {
        Issue.record("a failed restoration must be reported separately")
        return
    }
    #expect(candidateFailures == [PetShortcutApplyFailure(
        intent: .slot1,
        status: .registrationFailure(status: OSStatus(paramErr))
    )])
    #expect(rollbackFailures == [PetShortcutApplyFailure(
        intent: .slot1,
        status: .systemCollision
    )])
    #expect(result.errorMessage?.contains("완전히 복원하지 못했습니다") == true)
    #expect(registry.configuration == defaults)
    #expect(store.load() == defaults)
    #expect(registry.statuses[.slot1] == .systemCollision)
}

@Test("BlabeePet rolls back a partially registered multi-shortcut update")
@MainActor
func blabeePetShortcutPartialSwapRollbackAndRetiredCandidateID() async throws {
    let defaults = PetShortcutConfiguration.defaults
    let candidateSlotOne = PetShortcut(
        keyCode: UInt32(kVK_ANSI_5),
        modifiers: UInt32(optionKey)
    )
    let candidateSlotThree = PetShortcut(
        keyCode: UInt32(kVK_ANSI_6),
        modifiers: UInt32(optionKey)
    )
    var candidate = defaults
    candidate.setShortcut(candidateSlotOne, for: .slot1)
    candidate.setShortcut(candidateSlotThree, for: .slot3)
    let store = PetFakeShortcutStore(defaults)
    let backend = PetFakeHotKeyBackend()
    let recorder = PetIntentRecorder()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: defaults,
        store: store
    ) { recorder.intents.append($0) }
    registry.reconcile(eligibleSlots: [1, 3])
    backend.failingShortcuts = [candidateSlotThree]

    let result = registry.updateConfiguration(candidate)
    guard case .registrationRejected(let failures) = result else {
        Issue.record("a partial registration must reject the whole candidate")
        return
    }
    #expect(failures == [PetShortcutApplyFailure(intent: .slot3, status: .systemCollision)])
    let candidateEventID = try #require(
        backend.registrationHistory.last(where: { $0.shortcut == candidateSlotOne })?.event.id
    )
    #expect(backend.retiredEventIDs.contains(candidateEventID))
    #expect(registry.configuration == defaults)
    #expect(store.load() == defaults)
    #expect(backend.registrations.values.contains { $0.shortcut == defaults.slot1 })
    #expect(backend.registrations.values.contains { $0.shortcut == defaults.slot3 })

    backend.emit(PetHotKeyEvent(signature: PetHotKeyRegistry.signature, id: candidateEventID))
    await Task.yield()
    #expect(recorder.intents.isEmpty)
}

@Test("BlabeePet action labels reflect availability risk and actual registration")
@MainActor
func blabeePetActionShortcutPresentation() throws {
    let backend = PetFakeHotKeyBackend()
    let registry = try PetHotKeyRegistry(
        backend: backend,
        configuration: .defaults
    ) { _ in }
    let viewModel = PetViewModel(
        transport: PetFakeTransport(),
        externalApplicationOpener: PetFakeApplicationOpener()
    )
    viewModel.attachHotKeyRegistry(registry)

    let lowSnapshot = try PetSnapshot.parse(petTestSnapshotData(cards: [PetTestCard(
        suffix: "labels_low",
        alternativeEnabled: false
    )]))
    let lowInteraction = try #require(lowSnapshot.interactions.first)
    registry.reconcile(eligibleSlots: [1])
    #expect(viewModel.actionShortcutLabel(
        interaction: lowInteraction,
        choice: try #require(lowInteraction.choice(slot: 1))
    ) == "⌥1")
    #expect(viewModel.actionShortcutLabel(
        interaction: lowInteraction,
        choice: try #require(lowInteraction.choice(slot: 2))
    ) == "사용 불가")

    let expiredSnapshot = try PetSnapshot.parse(petTestSnapshotData(cards: [PetTestCard(
        suffix: "labels_expired",
        millisecondsUntilExpiry: 0
    )]))
    let expiredInteraction = try #require(expiredSnapshot.interactions.first)
    #expect(viewModel.actionShortcutLabel(
        interaction: expiredInteraction,
        choice: try #require(expiredInteraction.choice(slot: 1))
    ) == "사용 불가")

    let highSnapshot = try PetSnapshot.parse(petTestSnapshotData(cards: [PetTestCard(
        suffix: "labels_high",
        risk: "high"
    )]))
    let highInteraction = try #require(highSnapshot.interactions.first)
    registry.reconcile(eligibleSlots: [3])
    #expect(viewModel.actionShortcutLabel(
        interaction: highInteraction,
        choice: try #require(highInteraction.choice(slot: 1))
    ) == "Pet 확인")
    #expect(viewModel.actionShortcutLabel(
        interaction: highInteraction,
        choice: try #require(highInteraction.choice(slot: 2))
    ) == "Pet 확인")
    #expect(viewModel.actionShortcutLabel(
        interaction: highInteraction,
        choice: try #require(highInteraction.choice(slot: 3))
    ) == "⌥3")

    let collisionBackend = PetFakeHotKeyBackend()
    collisionBackend.failingShortcuts = [PetShortcutConfiguration.defaults.slot1]
    let collisionRegistry = try PetHotKeyRegistry(
        backend: collisionBackend,
        configuration: .defaults
    ) { _ in }
    viewModel.attachHotKeyRegistry(collisionRegistry)
    collisionRegistry.reconcile(eligibleSlots: [1])
    #expect(viewModel.actionShortcutLabel(
        interaction: lowInteraction,
        choice: try #require(lowInteraction.choice(slot: 1))
    ) == "충돌")

    let failureBackend = PetFakeHotKeyBackend()
    failureBackend.registrationErrors[PetShortcutConfiguration.defaults.slot1] = OSStatus(paramErr)
    let failureRegistry = try PetHotKeyRegistry(
        backend: failureBackend,
        configuration: .defaults
    ) { _ in }
    viewModel.attachHotKeyRegistry(failureRegistry)
    failureRegistry.reconcile(eligibleSlots: [1])
    #expect(viewModel.actionShortcutLabel(
        interaction: lowInteraction,
        choice: try #require(lowInteraction.choice(slot: 1))
    ) == "등록 실패")
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

    let deferredShortcut = PetShortcut(
        keyCode: UInt32(kVK_ANSI_5),
        modifiers: UInt32(optionKey)
    )
    var deferredConfiguration = defaults
    deferredConfiguration.setShortcut(deferredShortcut, for: .slot4)
    let deferredStore = PetFakeShortcutStore(defaults)
    let deferredBackend = PetFakeHotKeyBackend()
    deferredBackend.failingShortcuts = [deferredShortcut]
    let deferredRegistry = try PetHotKeyRegistry(
        backend: deferredBackend,
        configuration: defaults,
        store: deferredStore
    ) { _ in }
    #expect(deferredRegistry.updateConfiguration(deferredConfiguration) == .applied)
    #expect(deferredStore.load() == deferredConfiguration)
    #expect(deferredRegistry.statuses[.slot4] == .inactive)
    deferredRegistry.reconcile(eligibleSlots: [4])
    #expect(deferredRegistry.statuses[.slot4] == .systemCollision)

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
