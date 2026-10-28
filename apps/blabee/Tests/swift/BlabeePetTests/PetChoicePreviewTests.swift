import AppKit
import Carbon
import Testing
@testable import BlabeeCoordinator

@MainActor
private final class PreviewInput {
    var flags: NSEvent.ModifierFlags = [.control, .option]
    var control: Bool {
        get { flags.contains(.control) }
        set {
            if newValue { flags.insert(.control) }
            else { flags.remove(.control) }
        }
    }
    var keys: Set<UInt32> = []

    func monitor() -> PetChoicePreviewHoldMonitor {
        PetChoicePreviewHoldMonitor(
            modifierIsPressed: { [self] preset in flags.contains(preset.holdModifier) },
            keyIsPressed: { [self] in keys.contains($0) }
        )
    }
}

@Suite("Pet choice preview input and lifecycle")
struct PetChoicePreviewTests {
    @Test("A legacy selection chord is never advertised as an unavailable preview shortcut")
    @MainActor
    func doesNotAdvertiseCollidingPreviewChord() throws {
        var legacy = PetShortcutConfiguration.defaults
        legacy.slot1 = try #require(legacy.previewPreset.shortcut(for: 1))
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: legacy) { _ in }
        let vm = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener())
        defer { vm.stopPolling() }
        vm.attachHotKeyRegistry(registry)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [PetTestCard(suffix: "legacy_preview_hint", rankedActionCount: 4)]))
        #expect(vm.shortcutConfiguration.slot1 == legacy.slot1)
        #expect(vm.previewShortcutHint(for: 1).isEmpty)
        #expect(!registry.isPreviewShortcutRegistered(for: 1))
        #expect(vm.previewShortcutHint(for: 2).contains("⌃⌥2"))
        vm.beginShortcutSettings()
        #expect(vm.previewShortcutHint(for: 2).isEmpty)
    }

    @Test("Each preview preset closes only when its own hold modifier is released", arguments: [PetChoicePreviewShortcutPreset.control, .controlOption, .optionCommand, .controlCommand])
    @MainActor
    func observesConfiguredHoldModifier(preset: PetChoicePreviewShortcutPreset) {
        let input = PreviewInput()
        let monitor = input.monitor()
        defer { monitor.stop() }
        input.flags = [.control, .option, .command, .shift]
        var releases = 0
        #expect(monitor.begin(keyCode: UInt32(kVK_ANSI_1), preset: preset) { releases += 1 })
        input.flags = preset.holdModifier
        monitor.poll()
        #expect(monitor.isPreviewing)
        #expect(releases == 0)
        input.flags = [.shift]
        monitor.poll()
        #expect(!monitor.isPreviewing)
        #expect(releases == 1)
        #expect(!monitor.isMonitoring)
        #expect(!monitor.begin(keyCode: UInt32(kVK_ANSI_1), preset: .disabled) {})
    }

    @Test("Preview settings support draft cancel, save, disable and restored defaults", arguments: [PetChoicePreviewShortcutPreset.control, .optionCommand])
    @MainActor
    func previewSettingsLifecycle(preset: PetChoicePreviewShortcutPreset) throws {
        let input = PreviewInput()
        let monitor = input.monitor()
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: .defaults) { _ in }
        let vm = PetViewModel(transport: PetFakeTransport(), externalApplicationOpener: PetFakeApplicationOpener(), choicePreviewHoldMonitor: monitor)
        defer { vm.stopPolling() }
        vm.attachHotKeyRegistry(registry)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [PetTestCard(suffix: "preview_settings", rankedActionCount: 4)]))
        vm.beginShortcutSettings()
        vm.updatePreviewShortcutDraft(preset)
        #expect(vm.previewShortcutLabel(for: 1) == "⌃⌥1")
        vm.cancelShortcutSettings()
        #expect(vm.shortcutDraft.previewPreset == .controlOption)
        vm.beginShortcutSettings()
        vm.updatePreviewShortcutDraft(preset)
        vm.saveShortcutSettings()
        #expect(!vm.isEditingShortcuts)
        #expect(vm.previewShortcutLabel(for: 1) == preset.labelPrefix + "1")
        #expect(vm.previewHoldKeyName == preset.holdKeyName)
        input.flags = preset.holdModifier
        vm.beginChoicePreview(slot: 1)
        #expect(vm.choicePreview?.shortcutPreset == preset)
        input.flags = []
        monitor.poll()
        #expect(vm.choicePreview == nil)
        vm.beginShortcutSettings()
        vm.updatePreviewShortcutDraft(.disabled)
        vm.saveShortcutSettings()
        #expect(!vm.isChoicePreviewEnabled)
        vm.beginChoicePreview(slot: 1)
        #expect(vm.choicePreview == nil)
        vm.beginShortcutSettings()
        vm.restoreDefaultShortcutDraft()
        vm.saveShortcutSettings()
        #expect(vm.shortcutConfiguration.previewPreset == .controlOption)
        #expect(vm.previewHoldKeyName == "Control")
    }

    @Test("Active monitoring observes Control release and stops without manual polling")
    @MainActor
    func observesReleaseAutomatically() async throws {
        let input = PreviewInput()
        let monitor = input.monitor()
        defer { monitor.stop() }
        var released = false
        #expect(monitor.begin(keyCode: UInt32(kVK_ANSI_1)) { released = true })
        input.control = false
        let deadline = ContinuousClock.now.advanced(by: .seconds(1))
        while !released, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(released)
        #expect(!monitor.isMonitoring)
    }

    @Test("Releasing the digit keeps preview until Control is released", arguments: [PetChoicePreviewShortcutPreset.control, .controlOption])
    @MainActor
    func holdsUntilControlRelease(preset: PetChoicePreviewShortcutPreset) {
        let input = PreviewInput()
        let monitor = input.monitor()
        let key = UInt32(kVK_ANSI_1)
        input.keys = [key]
        var releases = 0
        #expect(monitor.begin(keyCode: key, preset: preset) { releases += 1 })
        input.keys = []
        input.flags = [.control]
        monitor.poll()
        #expect(monitor.isPreviewing)
        #expect(monitor.suppressesSelection)
        #expect(releases == 0)
        input.control = false
        monitor.poll()
        monitor.poll()
        #expect(releases == 1)
        #expect(!monitor.isPreviewing)
        #expect(!monitor.isMonitoring)
    }

    @Test("Control release cannot fall through to selection while preview digits remain down", arguments: [PetChoicePreviewShortcutPreset.control, .controlOption])
    @MainActor
    func suppressesHeldDigitAfterDismissal(preset: PetChoicePreviewShortcutPreset) {
        let input = PreviewInput()
        let monitor = input.monitor()
        let first = UInt32(kVK_ANSI_1)
        let second = UInt32(kVK_ANSI_2)
        input.keys = [first, second]
        #expect(monitor.begin(keyCode: first, preset: preset) {})
        #expect(monitor.begin(keyCode: second, preset: preset) {})
        input.control = false
        monitor.poll()
        #expect(!monitor.isPreviewing)
        #expect(monitor.suppressesSelection)
        input.keys = [first]
        monitor.poll()
        #expect(monitor.suppressesSelection)
        input.keys = []
        monitor.poll()
        #expect(!monitor.suppressesSelection)
        #expect(!monitor.isMonitoring)
    }

    @Test("A queued preview press is ignored after Control has already been released")
    @MainActor
    func ignoresLatePressAndCancelsMonitoring() {
        let input = PreviewInput()
        let monitor = input.monitor()
        input.control = false
        #expect(!monitor.begin(keyCode: UInt32(kVK_ANSI_1)) { Issue.record("late release") })
        #expect(!monitor.isMonitoring)
        input.control = true
        #expect(monitor.begin(keyCode: UInt32(kVK_ANSI_1)) {})
        monitor.cancelPreview()
        #expect(!monitor.isMonitoring)
    }

    @Test("A delayed preview press still blocks Option plus a held digit after Control release", arguments: [PetChoicePreviewShortcutPreset.control, .controlOption])
    @MainActor
    func latePreviewRetainsDigitReleaseGuard(preset: PetChoicePreviewShortcutPreset) {
        let input = PreviewInput()
        let monitor = input.monitor()
        defer { monitor.stop() }
        let key = UInt32(kVK_ANSI_1)
        input.control = false
        input.keys = [key]
        #expect(!monitor.begin(keyCode: key, preset: preset) { Issue.record("No preview should open") })
        #expect(!monitor.isPreviewing)
        #expect(monitor.suppressesSelection)
        #expect(monitor.isMonitoring)
        input.keys = []
        monitor.poll()
        #expect(!monitor.suppressesSelection)
        #expect(!monitor.isMonitoring)
    }

    @Test("Preview registrations share one handler and cannot dispatch selection", arguments: [2, 3, 4], [PetChoicePreviewShortcutPreset.control, .controlOption])
    @MainActor
    func routesIndependentPreviewIntents(count: Int, preset: PetChoicePreviewShortcutPreset) async throws {
        let backend = PetFakeHotKeyBackend()
        var selections: [PetShortcutIntent] = []
        var previews: [Int] = []
        var configuration = PetShortcutConfiguration.defaults
        configuration.previewPreset = preset
        let registry = try PetHotKeyRegistry(backend: backend, configuration: configuration) { selections.append($0) }
        registry.onPreviewRequested = { previews.append($0) }
        registry.reconcile(eligibleSlots: Set(1...count))
        registry.reconcilePreviews(eligibleSlots: Set(1...count))
        let events = backend.registrationHistory.filter { $0.event.signature == PetChoicePreviewHotKeys.signature }
        #expect(events.count == count)
        let expectedModifiers = UInt32(preset == .control ? controlKey : controlKey | optionKey)
        let expectedShortcuts = [kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4].prefix(count).map {
            PetShortcut(keyCode: UInt32($0), modifiers: expectedModifiers)
        }
        #expect(Set(events.map(\.shortcut)) == Set(expectedShortcuts))
        #expect(backend.installCount == 1)
        #expect(events.allSatisfy { $0.exclusive })
        for registration in events { backend.emit(registration.event) }
        for _ in 0..<20 { await Task.yield() }
        #expect(previews.sorted() == Array(1...count))
        #expect(selections.isEmpty)

        registry.reconcilePreviews(eligibleSlots: [])
        registry.reconcilePreviews(eligibleSlots: Set(1...count))
        previews = []
        for registration in events { backend.emit(registration.event) }
        for _ in 0..<20 { await Task.yield() }
        #expect(previews.isEmpty)
        #expect(selections.isEmpty)
    }

    @Test("Preview shortcut collisions preserve selection and do not retry each poll")
    @MainActor
    func reportsCollisionsWithoutStealingKeys() throws {
        let backend = PetFakeHotKeyBackend()
        let colliding = try #require(PetChoicePreviewShortcutPreset.controlOption.shortcut(for: 3))
        backend.failingShortcuts = [colliding]
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults) { _ in }
        registry.reconcile(eligibleSlots: [1, 2, 3, 4])
        registry.reconcilePreviews(eligibleSlots: [1, 2, 3, 4])
        let historyCount = backend.registrationHistory.count
        for _ in 0..<10 { registry.reconcilePreviews(eligibleSlots: [1, 2, 3, 4]) }
        #expect(backend.registrationHistory.count == historyCount)
        #expect(registry.previewShortcutDiagnostic?.contains(PetChoicePreviewShortcutPreset.controlOption.labelPrefix + "3") == true)
        #expect(registry.statuses.values.filter {
            if case .registered = $0 { return true }; return false
        }.count == 5)
    }

    @Test("All four details come from the displayed card without focus or selection requests")
    @MainActor
    func previewsDisplayedChoicesReadOnly() async throws {
        let input = PreviewInput()
        let monitor = input.monitor()
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(), choicePreviewHoldMonitor: monitor)
        defer { vm.stopPolling() }
        let card = PetTestCard(suffix: "preview", rankedActionCount: 4)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
        vm.setExpanded(true)
        for slot in 1...4 {
            vm.beginChoicePreview(slot: slot)
            let preview = try #require(vm.choicePreview)
            #expect(preview.choice == vm.displayInteraction?.choice(slot: slot))
            #expect(preview.identity == vm.displayInteraction?.identity)
        }
        #expect(vm.isExpanded)
        #expect(vm.localForegroundIdentity == nil)
        #expect(await transport.requestCount(type: "focus_interaction") == 0)
        #expect(await transport.requestCount(type: "select") == 0)
        input.control = false
        monitor.poll()
        #expect(vm.choicePreview == nil)
        #expect(vm.isExpanded)
    }

    @Test("Replacement, expiry, permission requests, settings and shutdown clear previews")
    @MainActor
    func invalidatesPreviewWithItsContext() async throws {
        let input = PreviewInput()
        let monitor = input.monitor()
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(), choicePreviewHoldMonitor: monitor)
        let original = PetTestCard(suffix: "original", rankedActionCount: 4)
        let originalData = try petTestSnapshotData(cards: [original])
        try vm.receiveSnapshotDataForTesting(originalData)
        vm.beginChoicePreview(slot: 1)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [PetTestCard(suffix: "replacement", rankedActionCount: 4)]))
        #expect(vm.choicePreview == nil)
        #expect(!monitor.isMonitoring)

        for data in [
            try petTestSnapshotData(cards: []),
            try petTestSnapshotData(cards: [PetTestCard(suffix: "original", millisecondsUntilExpiry: 0, rankedActionCount: 4)]),
            try petTestSnapshotData(cards: [original], permissionRequests: [PetTestPermissionRequest(suffix: "permission")]),
            try petTestSnapshotData(cards: [original], managedCommandApprovals: [PetTestManagedCommandApproval(suffix: "approval")]),
        ] {
            try vm.receiveSnapshotDataForTesting(originalData)
            vm.beginChoicePreview(slot: 1)
            #expect(vm.choicePreview != nil)
            try vm.receiveSnapshotDataForTesting(data)
            #expect(vm.choicePreview == nil)
            vm.beginChoicePreview(slot: 1)
            #expect(vm.choicePreview == nil)
        }
        try vm.receiveSnapshotDataForTesting(originalData)
        vm.beginChoicePreview(slot: 1)
        vm.beginShortcutSettings()
        #expect(vm.choicePreview == nil)
        vm.beginChoicePreview(slot: 1)
        #expect(vm.choicePreview == nil)
        vm.cancelShortcutSettings()
        vm.beginChoicePreview(slot: 1)
        #expect(vm.choicePreview != nil)
        await vm.shutdownAppOwnedService()
        #expect(vm.choicePreview == nil)
        #expect(!monitor.isMonitoring)
    }

    @Test("Releasing Control cannot select a focused choice until the held digit is released", arguments: [PetChoicePreviewShortcutPreset.control, .controlOption])
    @MainActor
    func neverExecutesPreviewOrRelease(preset: PetChoicePreviewShortcutPreset) async throws {
        let input = PreviewInput()
        let monitor = input.monitor()
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(), choicePreviewHoldMonitor: monitor)
        defer { vm.stopPolling() }
        var configuration = PetShortcutConfiguration.defaults
        configuration.previewPreset = preset
        let registry = try PetHotKeyRegistry(backend: PetFakeHotKeyBackend(), configuration: configuration) { _ in }
        vm.attachHotKeyRegistry(registry)
        let card = PetTestCard(suffix: "focused_preview", rankedActionCount: 4)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
        await transport.enqueue(type: "focus_interaction", response: try petTestFocusResponse())
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: [card], foregroundSuffix: card.suffix))
        await vm.focus(try #require(vm.displayInteraction?.identity))
        #expect(vm.focusedInteraction != nil)
        input.flags = preset == .control ? [.control] : [.control, .option]
        input.keys = [UInt32(kVK_ANSI_1)]
        vm.beginChoicePreview(slot: 1)
        #expect(vm.choicePreview?.shortcutPreset == preset)
        await vm.handleGlobalSlot(1)
        await vm.requestPanelSelection(1)
        input.flags = [.option]
        monitor.poll()
        #expect(vm.choicePreview == nil)
        await vm.handleGlobalSlot(1)
        #expect(await transport.requestCount(type: "select") == 0)
        input.keys = []
        monitor.poll()
        await transport.enqueue(type: "select", response: try petTestSelectionResponse())
        await transport.enqueue(type: "get_state", response: try petTestSnapshotData(cards: []))
        await vm.handleGlobalSlot(1)
        #expect(await transport.requestCount(type: "select") == 1)
    }

    @Test("A queued card click cannot dismiss a Control-only preview and execute the choice")
    @MainActor
    func ignoresCardClickDuringControlOnlyPreview() async throws {
        let input = PreviewInput()
        let monitor = input.monitor()
        let transport = PetFakeTransport()
        let vm = PetViewModel(transport: transport, externalApplicationOpener: PetFakeApplicationOpener(), choicePreviewHoldMonitor: monitor)
        defer { vm.stopPolling() }
        let card = PetTestCard(suffix: "preview_card_click", rankedActionCount: 4)
        try vm.receiveSnapshotDataForTesting(petTestSnapshotData(cards: [card]))
        let identity = try #require(vm.displayInteraction?.identity)
        vm.beginChoicePreview(slot: 1)
        // The digit and Command are already up; only Control keeps details open.
        input.keys = []
        monitor.poll()
        await vm.focusAndRequestPanelSelection(1, interaction: identity)
        #expect(vm.choicePreview?.identity == identity)
        #expect(vm.selectionSubmission == nil)
        #expect(await transport.requestCount(type: "focus_interaction") == 0)
        #expect(await transport.requestCount(type: "select") == 0)
    }
}
