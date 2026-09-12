import AppKit
import Carbon
import CoreGraphics
import Foundation

enum PetChoicePreviewShortcutPreset: String, Codable, Sendable, CaseIterable, Identifiable {
    case control
    case controlOption
    case optionCommand
    case controlCommand
    case disabled

    var id: String { rawValue }

    var labelPrefix: String {
        switch self {
        case .control: "⌃"
        case .controlOption: "⌃⌥"
        case .optionCommand: "⌥⌘"
        case .controlCommand: "⌃⌘"
        case .disabled: ""
        }
    }

    var displayLabel: String { self == .disabled ? "사용 안 함" : labelPrefix + " + 1~4" }
    var holdKeyName: String { self == .optionCommand ? "Option" : "Control" }
    var holdModifier: NSEvent.ModifierFlags { self == .optionCommand ? .option : .control }

    private var modifiers: UInt32 {
        switch self {
        case .control: UInt32(controlKey)
        case .controlOption: UInt32(controlKey | optionKey)
        case .optionCommand: UInt32(optionKey | cmdKey)
        case .controlCommand: UInt32(controlKey | cmdKey)
        case .disabled: 0
        }
    }

    func shortcut(for slot: Int) -> PetShortcut? {
        let keyCodes = [kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4]
        guard self != .disabled, (1...4).contains(slot) else { return nil }
        return PetShortcut(keyCode: UInt32(keyCodes[slot - 1]), modifiers: modifiers)
    }
}

/// A read-only copy of one choice, bound to the card that supplied it.
struct PetChoicePreview: Sendable, Equatable {
    let identity: PetInteractionIdentity
    let choice: PetChoice
    var shortcutPreset: PetChoicePreviewShortcutPreset = .controlOption
}

/// Uses the existing Carbon event handler, with a separate event namespace.
/// Preview registration never changes macOS shortcuts or persisted selection keys.
@MainActor
final class PetChoicePreviewHotKeys {
    static let signature: UInt32 = 0x4270_7276 // "Bprv"
    private struct Binding: Sendable {
        let eventID: UInt32
        let shortcut: PetShortcut
        let reference: any PetHotKeyReference
    }
    private struct Plan: Equatable {
        let slots: Set<Int>
        let reserved: Set<PetShortcut>
        let preset: PetChoicePreviewShortcutPreset
    }
    private let backend: any PetHotKeyBackend
    private var active: [Int: Binding] = [:]
    private var lastPlan: Plan?
    private var nextEventID: UInt32 = 0x8000_0000
    private(set) var eligibleSlots: Set<Int> = []
    private(set) var statuses: [Int: PetShortcutBindingStatus] = [:]
    private(set) var preset: PetChoicePreviewShortcutPreset = .controlOption

    init(backend: any PetHotKeyBackend) { self.backend = backend }

    func reconcile(
        eligibleSlots: Set<Int>,
        reserved: Set<PetShortcut>,
        preset: PetChoicePreviewShortcutPreset = .controlOption
    ) {
        let slots = preset == .disabled ? [] : eligibleSlots.intersection(Set(1...4))
        let plan = Plan(slots: slots, reserved: reserved, preset: preset)
        guard plan != lastPlan else { return }
        lastPlan = plan
        self.preset = preset
        self.eligibleSlots = slots
        for slot in Array(active.keys) {
            let shortcut = preset.shortcut(for: slot)
            guard !slots.contains(slot) || shortcut.map(reserved.contains) == true
                || active[slot]?.shortcut != shortcut else { continue }
            if let binding = active.removeValue(forKey: slot) { backend.unregister(binding.reference) }
        }
        for slot in 1...4 {
            guard slots.contains(slot), let shortcut = preset.shortcut(for: slot) else {
                statuses[slot] = .inactive
                continue
            }
            guard !reserved.contains(shortcut) else {
                statuses[slot] = .internalCollision
                continue
            }
            if let binding = active[slot] {
                statuses[slot] = .registered(eventID: binding.eventID)
                continue
            }
            nextEventID &+= 1
            let event = PetHotKeyEvent(signature: Self.signature, id: nextEventID)
            do {
                let reference = try backend.register(event: event, shortcut: shortcut, exclusive: true)
                active[slot] = Binding(eventID: event.id, shortcut: shortcut, reference: reference)
                statuses[slot] = .registered(eventID: event.id)
            } catch let PetHotKeyBackendError.registration(status) where status == OSStatus(eventHotKeyExistsErr) {
                statuses[slot] = .systemCollision
            } catch let PetHotKeyBackendError.registration(status) {
                statuses[slot] = .registrationFailure(status: status)
            } catch {
                statuses[slot] = .registrationFailure(status: nil)
            }
        }
    }

    func slot(for event: PetHotKeyEvent) -> Int? {
        guard event.signature == Self.signature else { return nil }
        return active.first(where: { $0.value.eventID == event.id })?.key
    }

    var diagnostic: String? {
        let unavailable = statuses.keys.sorted().filter { slot in
            switch statuses[slot] {
            case .internalCollision?, .systemCollision?, .registrationFailure?: true
            default: false
            }
        }
        guard !unavailable.isEmpty else { return nil }
        return "상세 미리보기 단축키를 등록하지 못했습니다: "
            + unavailable.map { preset.labelPrefix + String($0) }.joined(separator: ", ")
            + ". 다른 단축키와의 충돌을 확인해 주세요."
    }

    deinit {
        for binding in active.values { backend.unregister(binding.reference) }
    }
}

/// Reads only the chosen hold modifier and the digits used by an active preview.
/// There is no keyboard event stream, permission prompt, or idle poller.
@MainActor
final class PetChoicePreviewHoldMonitor {
    private let modifierIsPressed: @MainActor (PetChoicePreviewShortcutPreset) -> Bool
    private let keyIsPressed: @MainActor (UInt32) -> Bool
    private var pollingTask: Task<Void, Never>?
    private var heldKeyCodes: Set<UInt32> = []
    private var activePreset: PetChoicePreviewShortcutPreset?
    private var onModifierReleased: (@MainActor () -> Void)?
    private(set) var isPreviewing = false
    var isMonitoring: Bool { pollingTask != nil }

    init(
        modifierIsPressed: @escaping @MainActor (PetChoicePreviewShortcutPreset) -> Bool = {
            NSEvent.modifierFlags.contains($0.holdModifier)
        },
        keyIsPressed: @escaping @MainActor (UInt32) -> Bool = {
            CGEventSource.keyState(.combinedSessionState, key: CGKeyCode($0))
        }
    ) {
        self.modifierIsPressed = modifierIsPressed
        self.keyIsPressed = keyIsPressed
    }

    var suppressesSelection: Bool {
        isPreviewing || heldKeyCodes.contains(where: keyIsPressed)
    }

    @discardableResult
    func begin(
        keyCode: UInt32,
        preset: PetChoicePreviewShortcutPreset = .controlOption,
        onModifierReleased: @escaping @MainActor () -> Void
    ) -> Bool {
        // Carbon delivery may be queued after a very quick modifier release.
        guard preset != .disabled else { return false }
        guard modifierIsPressed(preset) else {
            // A delayed preview chord can arrive after Control is up while
            // Option + the digit is still down. Never let that become a choice.
            if keyIsPressed(keyCode) {
                heldKeyCodes.insert(keyCode)
                startMonitoringIfNeeded()
            }
            return false
        }
        heldKeyCodes.insert(keyCode)
        isPreviewing = true
        activePreset = preset
        self.onModifierReleased = onModifierReleased
        startMonitoringIfNeeded()
        return true
    }

    private func startMonitoringIfNeeded() {
        if pollingTask == nil {
            pollingTask = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .milliseconds(33)) }
                    catch { return }
                    guard let self, !Task.isCancelled else { return }
                    self.poll()
                }
            }
        }
    }

    func poll() {
        heldKeyCodes = heldKeyCodes.filter(keyIsPressed)
        if isPreviewing, let activePreset, !modifierIsPressed(activePreset) {
            isPreviewing = false
            self.activePreset = nil
            let callback = onModifierReleased
            onModifierReleased = nil
            callback?()
        }
        if !isPreviewing, heldKeyCodes.isEmpty { stop() }
    }

    func cancelPreview() {
        isPreviewing = false
        activePreset = nil
        onModifierReleased = nil
        // Releasing Control with the preview digit still down must not fall
        // through to a selection chord. Retain only that release guard.
        poll()
    }

    func stop() {
        pollingTask?.cancel()
        pollingTask = nil
        isPreviewing = false
        heldKeyCodes.removeAll()
        activePreset = nil
        onModifierReleased = nil
    }

    deinit { pollingTask?.cancel() }
}
