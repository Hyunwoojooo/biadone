import Carbon
import Foundation
import Testing
@testable import BlabeeCoordinator

private final class PetPreviewShortcutTestStore: PetShortcutConfigurationStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var configuration: PetShortcutConfiguration

    init(_ configuration: PetShortcutConfiguration = .defaults) {
        self.configuration = configuration
    }

    func load() -> PetShortcutConfiguration? {
        lock.lock()
        defer { lock.unlock() }
        return configuration
    }

    func save(_ configuration: PetShortcutConfiguration) {
        lock.lock()
        self.configuration = configuration
        lock.unlock()
    }
}

@Suite("Pet preview shortcut configuration and atomic registration")
@MainActor
struct PetPreviewShortcutConfigurationTests {
    @Test("Legacy v1 data keeps every selection binding even when a preview default overlaps")
    func migratesLegacySelectionConfiguration() throws {
        var legacy = PetShortcutConfiguration.defaults
        legacy.toggle = PetShortcut(keyCode: UInt32(kVK_ANSI_K), modifiers: UInt32(optionKey | cmdKey))
        legacy.slot1 = try #require(PetChoicePreviewShortcutPreset.controlOption.shortcut(for: 1))
        legacy.slot2 = PetShortcut(keyCode: UInt32(kVK_ANSI_2), modifiers: UInt32(optionKey | shiftKey))
        legacy.slot3 = PetShortcut(keyCode: UInt32(kVK_ANSI_5), modifiers: UInt32(optionKey))
        legacy.slot4 = PetShortcut(
            keyCode: UInt32(kVK_ANSI_4), modifiers: UInt32(optionKey | controlKey | cmdKey)
        )
        var object = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(legacy)) as? [String: Any]
        )
        object.removeValue(forKey: "previewPreset")
        let data = try JSONSerialization.data(withJSONObject: object)
        let migrated = try JSONDecoder().decode(PetShortcutConfiguration.self, from: data)
        #expect(migrated == legacy)
        #expect(migrated.previewPreset == .controlOption)
        #expect(migrated.validationIssue() == nil)
        #expect(migrated.previewValidationIssue() == .previewCollision(owner: .slot1, slot: 1))

        let suite = "com.biadone.blabee.tests.preview-migration.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let key = "com.biadone.blabee.pet.shortcuts.v1"
        defaults.set(data, forKey: key)
        let store = PetUserDefaultsShortcutStore(defaults: defaults)
        #expect(store.load() == legacy)
        #expect(defaults.data(forKey: key) == data)
    }

    @Test("Every preview preset persists under the existing settings key", arguments: PetChoicePreviewShortcutPreset.allCases)
    func persistsPreviewPreset(_ preset: PetChoicePreviewShortcutPreset) throws {
        var candidate = PetShortcutConfiguration.defaults
        candidate.previewPreset = preset
        let suite = "com.biadone.blabee.tests.preview-preset.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PetUserDefaultsShortcutStore(defaults: defaults)
        store.save(candidate)
        #expect(store.load() == candidate)
        let encoded = try #require(defaults.data(forKey: "com.biadone.blabee.pet.shortcuts.v1"))
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        #expect(object["previewPreset"] as? String == preset.rawValue)
    }

    @Test("Preview overlap rejects apply and persistence before touching active bindings")
    func rejectsConflictingPreviewDraft() throws {
        let suite = "com.biadone.blabee.tests.preview-conflict.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = PetUserDefaultsShortcutStore(defaults: defaults)
        store.save(.defaults)
        let backend = PetFakeHotKeyBackend()
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults, store: store) { _ in }
        registry.reconcile(eligibleSlots: [1])
        registry.reconcilePreviews(eligibleSlots: [1])
        let originalBindings = backend.registrations
        var candidate = PetShortcutConfiguration.defaults
        candidate.slot4 = try #require(candidate.previewPreset.shortcut(for: 2))
        #expect(candidate.validationIssue() == nil)
        let expected = PetShortcutConfigurationIssue.previewCollision(owner: .slot4, slot: 2)
        #expect(candidate.previewValidationIssue() == expected)
        #expect(registry.updateConfiguration(candidate) == .invalidConfiguration(expected))
        #expect(backend.registrations == originalBindings)
        #expect(registry.configuration == .defaults)
        store.save(candidate)
        #expect(store.load() == .defaults)
    }

    @Test("Disabled preview resolves legacy overlap and leaves selection bindings usable")
    func disablesPreviewWithoutReservingChords() throws {
        var legacy = PetShortcutConfiguration.defaults
        legacy.slot1 = try #require(legacy.previewPreset.shortcut(for: 1))
        let backend = PetFakeHotKeyBackend()
        let registry = try PetHotKeyRegistry(backend: backend, configuration: legacy) { _ in }
        registry.reconcile(eligibleSlots: [1])
        registry.reconcilePreviews(eligibleSlots: [1, 2])
        #expect(registry.previewShortcutDiagnostic?.contains("⌃⌥1") == true)
        #expect(backend.registrations.values.contains { $0.shortcut == legacy.slot1 })
        #expect(previewRegistrations(backend).count == 1)

        var candidate = legacy
        candidate.previewPreset = .disabled
        #expect(candidate.previewValidationIssue() == nil)
        #expect(registry.updateConfiguration(candidate) == .applied)
        #expect(registry.previewShortcutDiagnostic == nil)
        #expect(previewRegistrations(backend).isEmpty)
        #expect(backend.registrations.values.contains { $0.shortcut == legacy.slot1 })
        #expect(backend.registrations.count == 2)
    }

    @Test("Preset changes retire old events, preserve actual eligibility and permit chord swaps", arguments: [PetChoicePreviewShortcutPreset.control, .optionCommand])
    func appliesPreviewPresetAndIgnoresRetiredEvents(preset: PetChoicePreviewShortcutPreset) async throws {
        let backend = PetFakeHotKeyBackend()
        let store = PetPreviewShortcutTestStore()
        var selections: [PetShortcutIntent] = []
        var previews: [Int] = []
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults, store: store) {
            selections.append($0)
        }
        registry.onPreviewRequested = { previews.append($0) }
        registry.reconcile(eligibleSlots: [1])
        registry.reconcilePreviews(eligibleSlots: [1, 3])
        let oldEvents = previewRegistrations(backend).map(\.event)
        var candidate = PetShortcutConfiguration.defaults
        candidate.previewPreset = preset
        candidate.slot1 = try #require(PetChoicePreviewShortcutPreset.controlOption.shortcut(for: 1))

        #expect(registry.updateConfiguration(candidate) == .applied)
        #expect(registry.configuration == candidate)
        #expect(store.load() == candidate)
        let expectedChords = Set([1, 3].compactMap { candidate.previewPreset.shortcut(for: $0) })
        #expect(Set(previewRegistrations(backend).map(\.shortcut)) == expectedChords)
        #expect(backend.registrations.values.contains { $0.shortcut == candidate.slot1 })
        #expect(oldEvents.allSatisfy { backend.retiredEventIDs.contains($0.id) })
        let testedThenRetired = backend.registrationHistory.filter {
            $0.event.signature == PetChoicePreviewHotKeys.signature
                && !backend.registrations.keys.contains($0.event.id)
        }
        for event in oldEvents + testedThenRetired.map(\.event) { backend.emit(event) }
        for _ in 0..<20 { await Task.yield() }
        #expect(previews.isEmpty)
        #expect(selections.isEmpty)

        let current = try #require(previewRegistrations(backend).first {
            $0.shortcut == candidate.previewPreset.shortcut(for: 3)
        })
        backend.emit(current.event)
        for _ in 0..<20 { await Task.yield() }
        #expect(previews == [3])
        #expect(selections.isEmpty)
    }

    @Test("Settings test all preview chords while idle and reject a collision without idle grabs", arguments: [PetChoicePreviewShortcutPreset.control, .optionCommand])
    func rejectsIdlePreviewRegistrationFailure(preset: PetChoicePreviewShortcutPreset) throws {
        let backend = PetFakeHotKeyBackend()
        let store = PetPreviewShortcutTestStore()
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults, store: store) { _ in }
        var candidate = PetShortcutConfiguration.defaults
        candidate.previewPreset = preset
        backend.failingShortcuts = [try #require(candidate.previewPreset.shortcut(for: 4))]

        let result = registry.updateConfiguration(candidate)
        #expect(result == .registrationRejected([
            PetShortcutApplyFailure(intent: .slot4, status: .systemCollision, isPreview: true),
        ]))
        #expect(result.errorMessage?.contains("4번 미리보기") == true)
        #expect(registry.configuration == .defaults)
        #expect(store.load() == .defaults)
        #expect(previewRegistrations(backend).isEmpty)
        #expect(backend.registrations.count == 1)
        #expect(backend.registrations.values.first?.shortcut == PetShortcutConfiguration.defaults.toggle)
        #expect(Set(backend.registrationHistory.filter {
            $0.event.signature == PetChoicePreviewHotKeys.signature
        }.map(\.shortcut)) == Set([1, 2, 3].compactMap { candidate.previewPreset.shortcut(for: $0) }))

        backend.failingShortcuts.removeAll()
        #expect(registry.updateConfiguration(candidate) == .applied)
        #expect(store.load() == candidate)
        #expect(previewRegistrations(backend).isEmpty)
        #expect(backend.registrations.count == 1)
    }

    @Test("Failed candidate previews restore the old preset and previously active choices")
    func restoresActivePreviewsAfterFailure() throws {
        let backend = PetFakeHotKeyBackend()
        let store = PetPreviewShortcutTestStore()
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults, store: store) { _ in }
        registry.reconcile(eligibleSlots: [1, 2])
        registry.reconcilePreviews(eligibleSlots: [1, 2])
        let oldChords = Set(backend.registrations.values.map(\.shortcut))
        var candidate = PetShortcutConfiguration.defaults
        candidate.previewPreset = .controlCommand
        candidate.slot1 = PetShortcut(keyCode: UInt32(kVK_ANSI_5), modifiers: UInt32(optionKey))
        let failedChord = try #require(candidate.previewPreset.shortcut(for: 3))
        backend.registrationErrors[failedChord] = OSStatus(paramErr)

        #expect(registry.updateConfiguration(candidate) == .registrationRejected([
            PetShortcutApplyFailure(
                intent: .slot3, status: .registrationFailure(status: OSStatus(paramErr)), isPreview: true
            ),
        ]))
        #expect(registry.configuration == .defaults)
        #expect(store.load() == .defaults)
        #expect(Set(backend.registrations.values.map(\.shortcut)) == oldChords)
        #expect(registry.previewShortcutDiagnostic == nil)
    }

    @Test("Losing a previously active preview during rollback is reported separately")
    func reportsPreviewRollbackFailure() throws {
        let backend = PetFakeHotKeyBackend()
        let store = PetPreviewShortcutTestStore()
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults, store: store) { _ in }
        registry.reconcilePreviews(eligibleSlots: [1, 2])
        var candidate = PetShortcutConfiguration.defaults
        candidate.previewPreset = .optionCommand
        backend.failingShortcuts = [
            try #require(candidate.previewPreset.shortcut(for: 4)),
            try #require(PetChoicePreviewShortcutPreset.controlOption.shortcut(for: 1)),
        ]

        #expect(registry.updateConfiguration(candidate) == .rollbackFailed(
            candidateFailures: [
                PetShortcutApplyFailure(intent: .slot4, status: .systemCollision, isPreview: true),
            ],
            rollbackFailures: [
                PetShortcutApplyFailure(intent: .slot1, status: .systemCollision, isPreview: true),
            ]
        ))
        #expect(registry.configuration == .defaults)
        #expect(store.load() == .defaults)
        #expect(previewRegistrations(backend).count == 1)
        #expect(registry.previewShortcutDiagnostic?.contains("⌃⌥1") == true)
    }

    @Test("Retrying an unchanged unavailable preview does not claim that a working binding was lost")
    func reportsSamePresetRetryFailure() throws {
        let backend = PetFakeHotKeyBackend()
        let store = PetPreviewShortcutTestStore()
        let registry = try PetHotKeyRegistry(backend: backend, configuration: .defaults, store: store) { _ in }
        backend.failingShortcuts = [try #require(PetChoicePreviewShortcutPreset.controlOption.shortcut(for: 2))]
        registry.reconcilePreviews(eligibleSlots: [1, 2])
        #expect(registry.updateConfiguration(.defaults) == .registrationRejected([
            PetShortcutApplyFailure(intent: .slot2, status: .systemCollision, isRetryAttempt: true, isPreview: true),
        ]))
        #expect(previewRegistrations(backend).count == 1)
        #expect(registry.configuration == .defaults)
    }

    private func previewRegistrations(_ backend: PetFakeHotKeyBackend) -> [PetFakeHotKeyBackend.Registration] {
        backend.registrations.values.filter { $0.event.signature == PetChoicePreviewHotKeys.signature }
    }
}
