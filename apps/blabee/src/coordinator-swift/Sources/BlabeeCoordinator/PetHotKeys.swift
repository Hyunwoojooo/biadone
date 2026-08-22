import Carbon
import Foundation

enum PetShortcutIntent: String, Codable, Sendable, CaseIterable, Hashable {
    case toggle
    case slot1
    case slot2
    case slot3
    case slot4

    var slot: Int? {
        switch self {
        case .toggle: nil
        case .slot1: 1
        case .slot2: 2
        case .slot3: 3
        case .slot4: 4
        }
    }

    static func slot(_ value: Int) -> PetShortcutIntent? {
        switch value {
        case 1: .slot1
        case 2: .slot2
        case 3: .slot3
        case 4: .slot4
        default: nil
        }
    }

    var displayName: String {
        switch self {
        case .toggle: "Pet 열기/닫기"
        case .slot1: "1번 선택"
        case .slot2: "2번 선택"
        case .slot3: "3번 보류"
        case .slot4: "4번 롤백"
        }
    }
}

struct PetShortcut: Codable, Sendable, Equatable, Hashable {
    let keyCode: UInt32
    let modifiers: UInt32

    init(keyCode: UInt32, modifiers: UInt32) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }
}

enum PetShortcutModifierPreset: String, CaseIterable, Identifiable, Sendable {
    case option
    case optionShift
    case optionControl
    case optionCommand
    case optionControlShift
    case optionCommandShift
    case optionControlCommand

    var id: String { rawValue }

    var modifiers: UInt32 {
        let option = UInt32(optionKey)
        return switch self {
        case .option: option
        case .optionShift: option | UInt32(shiftKey)
        case .optionControl: option | UInt32(controlKey)
        case .optionCommand: option | UInt32(cmdKey)
        case .optionControlShift: option | UInt32(controlKey) | UInt32(shiftKey)
        case .optionCommandShift: option | UInt32(cmdKey) | UInt32(shiftKey)
        case .optionControlCommand: option | UInt32(controlKey) | UInt32(cmdKey)
        }
    }

    var displayLabel: String {
        switch self {
        case .option: "⌥"
        case .optionShift: "⌥⇧"
        case .optionControl: "⌃⌥"
        case .optionCommand: "⌥⌘"
        case .optionControlShift: "⌃⌥⇧"
        case .optionCommandShift: "⌥⇧⌘"
        case .optionControlCommand: "⌃⌥⌘"
        }
    }

    init?(modifiers: UInt32) {
        guard let value = Self.allCases.first(where: { $0.modifiers == modifiers }) else {
            return nil
        }
        self = value
    }
}

struct PetShortcutKeyChoice: Identifiable, Sendable, Equatable, Hashable {
    let keyCode: UInt32
    let displayLabel: String

    var id: UInt32 { keyCode }
}

enum PetShortcutConfigurationIssue: Sendable, Equatable {
    case unsupported(PetShortcutIntent)
    case duplicate(owner: PetShortcutIntent, duplicate: PetShortcutIntent)

    var message: String {
        switch self {
        case .unsupported(let intent):
            "\(intent.displayName)에 지원하지 않는 키 조합이 있습니다."
        case .duplicate(let owner, let duplicate):
            "\(owner.displayName)와 \(duplicate.displayName)에 같은 단축키를 사용할 수 없습니다."
        }
    }
}

enum PetShortcutCatalog {
    static let modifierPresets = PetShortcutModifierPreset.allCases

    private static let optionOnlyKeyCodes: Set<UInt32> = [
        UInt32(kVK_Space),
        UInt32(kVK_ANSI_0),
        UInt32(kVK_ANSI_1),
        UInt32(kVK_ANSI_2),
        UInt32(kVK_ANSI_3),
        UInt32(kVK_ANSI_4),
        UInt32(kVK_ANSI_5),
        UInt32(kVK_ANSI_6),
        UInt32(kVK_ANSI_7),
        UInt32(kVK_ANSI_8),
        UInt32(kVK_ANSI_9),
    ]

    static let keys: [PetShortcutKeyChoice] = [
        PetShortcutKeyChoice(keyCode: UInt32(kVK_Space), displayLabel: "Space"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_1), displayLabel: "1"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_2), displayLabel: "2"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_3), displayLabel: "3"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_4), displayLabel: "4"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_5), displayLabel: "5"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_6), displayLabel: "6"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_7), displayLabel: "7"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_8), displayLabel: "8"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_9), displayLabel: "9"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_0), displayLabel: "0"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_A), displayLabel: "A"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_B), displayLabel: "B"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_C), displayLabel: "C"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_D), displayLabel: "D"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_E), displayLabel: "E"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_F), displayLabel: "F"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_G), displayLabel: "G"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_H), displayLabel: "H"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_I), displayLabel: "I"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_J), displayLabel: "J"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_K), displayLabel: "K"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_L), displayLabel: "L"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_M), displayLabel: "M"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_N), displayLabel: "N"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_O), displayLabel: "O"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_P), displayLabel: "P"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_Q), displayLabel: "Q"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_R), displayLabel: "R"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_S), displayLabel: "S"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_T), displayLabel: "T"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_U), displayLabel: "U"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_V), displayLabel: "V"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_W), displayLabel: "W"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_X), displayLabel: "X"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_Y), displayLabel: "Y"),
        PetShortcutKeyChoice(keyCode: UInt32(kVK_ANSI_Z), displayLabel: "Z"),
    ]

    static func contains(_ shortcut: PetShortcut) -> Bool {
        guard let modifier = PetShortcutModifierPreset(modifiers: shortcut.modifiers),
              keys.contains(where: { $0.keyCode == shortcut.keyCode })
        else { return false }
        return modifier != .option || optionOnlyKeyCodes.contains(shortcut.keyCode)
    }

    static func displayLabel(for shortcut: PetShortcut) -> String {
        guard let modifier = PetShortcutModifierPreset(modifiers: shortcut.modifiers),
              let key = keys.first(where: { $0.keyCode == shortcut.keyCode })
        else { return "지원되지 않음" }
        return modifier.displayLabel + key.displayLabel
    }
}

struct PetShortcutConfiguration: Codable, Sendable, Equatable {
    var toggle: PetShortcut
    var slot1: PetShortcut
    var slot2: PetShortcut
    var slot3: PetShortcut
    var slot4: PetShortcut

    static let defaults = PetShortcutConfiguration(
        toggle: PetShortcut(keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey)),
        slot1: PetShortcut(keyCode: UInt32(kVK_ANSI_1), modifiers: UInt32(optionKey)),
        slot2: PetShortcut(keyCode: UInt32(kVK_ANSI_2), modifiers: UInt32(optionKey)),
        slot3: PetShortcut(keyCode: UInt32(kVK_ANSI_3), modifiers: UInt32(optionKey)),
        slot4: PetShortcut(keyCode: UInt32(kVK_ANSI_4), modifiers: UInt32(optionKey))
    )

    func shortcut(for intent: PetShortcutIntent) -> PetShortcut {
        switch intent {
        case .toggle: toggle
        case .slot1: slot1
        case .slot2: slot2
        case .slot3: slot3
        case .slot4: slot4
        }
    }

    mutating func setShortcut(_ shortcut: PetShortcut, for intent: PetShortcutIntent) {
        switch intent {
        case .toggle: toggle = shortcut
        case .slot1: slot1 = shortcut
        case .slot2: slot2 = shortcut
        case .slot3: slot3 = shortcut
        case .slot4: slot4 = shortcut
        }
    }

    func validationIssue() -> PetShortcutConfigurationIssue? {
        var owners: [PetShortcut: PetShortcutIntent] = [:]
        for intent in PetShortcutIntent.allCases {
            let shortcut = shortcut(for: intent)
            guard PetShortcutCatalog.contains(shortcut) else {
                return .unsupported(intent)
            }
            if let owner = owners[shortcut] {
                return .duplicate(owner: owner, duplicate: intent)
            }
            owners[shortcut] = intent
        }
        return nil
    }

}

protocol PetShortcutConfigurationStoring: Sendable {
    func load() -> PetShortcutConfiguration?
    func save(_ configuration: PetShortcutConfiguration)
}

final class PetUserDefaultsShortcutStore: PetShortcutConfigurationStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    init(
        defaults: UserDefaults = .standard,
        key: String = "com.biadone.blabee.pet.shortcuts.v1"
    ) {
        self.defaults = defaults
        self.key = key
    }

    func load() -> PetShortcutConfiguration? {
        guard let data = defaults.data(forKey: key) else { return nil }
        guard let configuration = try? JSONDecoder().decode(
            PetShortcutConfiguration.self,
            from: data
        ), configuration.validationIssue() == nil
        else { return nil }
        return configuration
    }

    func save(_ configuration: PetShortcutConfiguration) {
        guard configuration.validationIssue() == nil,
              let data = try? JSONEncoder().encode(configuration)
        else { return }
        defaults.set(data, forKey: key)
    }
}

struct PetHotKeyEvent: Sendable, Equatable {
    let signature: UInt32
    let id: UInt32
}

protocol PetHotKeyReference: AnyObject, Sendable {}

protocol PetHotKeyBackend: AnyObject, Sendable {
    func installHandler(_ handler: @escaping @Sendable (PetHotKeyEvent) -> Void) throws
    func register(
        event: PetHotKeyEvent,
        shortcut: PetShortcut,
        exclusive: Bool
    ) throws -> PetHotKeyReference
    func unregister(_ reference: PetHotKeyReference)
}

enum PetHotKeyBackendError: Error, Equatable {
    case handler(OSStatus)
    case registration(OSStatus)
}

private final class CarbonPetHotKeyReference: PetHotKeyReference, @unchecked Sendable {
    let value: EventHotKeyRef

    init(_ value: EventHotKeyRef) {
        self.value = value
    }
}

private func petCarbonHotKeyCallback(
    _ nextHandler: EventHandlerCallRef?,
    _ event: EventRef?,
    _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let event, let userData else { return OSStatus(eventNotHandledErr) }
    var identifier = EventHotKeyID()
    let status = GetEventParameter(
        event,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &identifier
    )
    guard status == noErr else { return status }
    let backend = Unmanaged<CarbonPetHotKeyBackend>.fromOpaque(userData).takeUnretainedValue()
    backend.deliver(PetHotKeyEvent(signature: identifier.signature, id: identifier.id))
    return noErr
}

final class CarbonPetHotKeyBackend: PetHotKeyBackend, @unchecked Sendable {
    private let lock = NSLock()
    private var callback: (@Sendable (PetHotKeyEvent) -> Void)?
    private var eventHandler: EventHandlerRef?

    func installHandler(_ handler: @escaping @Sendable (PetHotKeyEvent) -> Void) throws {
        lock.lock()
        let alreadyInstalled = callback != nil
        lock.unlock()
        guard !alreadyInstalled else { return }

        var specification = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        var installed: EventHandlerRef?
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            petCarbonHotKeyCallback,
            1,
            &specification,
            Unmanaged.passUnretained(self).toOpaque(),
            &installed
        )
        guard status == noErr, let installed else {
            throw PetHotKeyBackendError.handler(status)
        }
        lock.lock()
        callback = handler
        eventHandler = installed
        lock.unlock()
    }

    func register(
        event: PetHotKeyEvent,
        shortcut: PetShortcut,
        exclusive: Bool
    ) throws -> PetHotKeyReference {
        var reference: EventHotKeyRef?
        let identifier = EventHotKeyID(signature: event.signature, id: event.id)
        let options = exclusive ? OptionBits(kEventHotKeyExclusive) : OptionBits(0)
        let status = RegisterEventHotKey(
            shortcut.keyCode,
            shortcut.modifiers,
            identifier,
            GetApplicationEventTarget(),
            options,
            &reference
        )
        guard status == noErr, let reference else {
            throw PetHotKeyBackendError.registration(status)
        }
        return CarbonPetHotKeyReference(reference)
    }

    func unregister(_ reference: PetHotKeyReference) {
        guard let reference = reference as? CarbonPetHotKeyReference else { return }
        _ = UnregisterEventHotKey(reference.value)
    }

    fileprivate func deliver(_ event: PetHotKeyEvent) {
        lock.lock()
        let callback = callback
        lock.unlock()
        callback?(event)
    }

    deinit {
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }
}

enum PetShortcutBindingStatus: Sendable, Equatable {
    case registered(eventID: UInt32)
    case inactive
    case internalCollision
    case systemCollision
    case registrationFailure(status: OSStatus?)
}

struct PetShortcutApplyFailure: Sendable, Equatable {
    let intent: PetShortcutIntent
    let status: PetShortcutBindingStatus

    var message: String {
        let reason = switch status {
        case .registered: "알 수 없는 등록 상태"
        case .inactive: "등록되지 않음"
        case .internalCollision: "설정 내부 충돌"
        case .systemCollision: "macOS 단축키 충돌"
        case .registrationFailure(let status):
            if let status { "등록 실패 (\(status))" } else { "등록 실패" }
        }
        return "\(intent.displayName): \(reason)"
    }
}

enum PetShortcutApplyResult: Sendable, Equatable {
    case applied
    case invalidConfiguration(PetShortcutConfigurationIssue)
    case registrationRejected([PetShortcutApplyFailure])
    case rollbackFailed(
        candidateFailures: [PetShortcutApplyFailure],
        rollbackFailures: [PetShortcutApplyFailure]
    )

    var errorMessage: String? {
        switch self {
        case .applied:
            nil
        case .invalidConfiguration(let issue):
            issue.message
        case .registrationRejected(let failures):
            "새 단축키를 등록하지 못해 기존 설정으로 복원했습니다. "
                + failures.map(\.message).joined(separator: ", ")
        case .rollbackFailed(let candidateFailures, let rollbackFailures):
            "새 단축키를 등록하지 못했고 기존 단축키도 완전히 복원하지 못했습니다. "
                + "새 설정: " + candidateFailures.map(\.message).joined(separator: ", ")
                + " / 복원: " + rollbackFailures.map(\.message).joined(separator: ", ")
        }
    }
}

@MainActor
final class PetHotKeyRegistry {
    static let signature: UInt32 = 0x426C_6162 // "Blab"

    private struct ActiveBinding: Sendable {
        let shortcut: PetShortcut
        let eventID: UInt32
        let reference: PetHotKeyReference
    }

    private let backend: PetHotKeyBackend
    private let store: (any PetShortcutConfigurationStoring)?
    private let onIntent: @MainActor (PetShortcutIntent) -> Void
    private(set) var configuration: PetShortcutConfiguration
    private var active: [PetShortcutIntent: ActiveBinding] = [:]
    private var intentByEventID: [UInt32: PetShortcutIntent] = [:]
    private var eligibleSlots: Set<Int> = []
    private var generation: UInt32 = 0

    private(set) var statuses: [PetShortcutIntent: PetShortcutBindingStatus] = [:]

    init(
        backend: PetHotKeyBackend,
        configuration: PetShortcutConfiguration,
        store: (any PetShortcutConfigurationStoring)? = nil,
        onIntent: @escaping @MainActor (PetShortcutIntent) -> Void
    ) throws {
        self.backend = backend
        self.configuration = configuration
        self.store = store
        self.onIntent = onIntent
        try backend.installHandler { [weak self] event in
            Task { @MainActor in
                self?.receive(event)
            }
        }
        reconcile(eligibleSlots: [])
    }

    @discardableResult
    func updateConfiguration(_ configuration: PetShortcutConfiguration) -> PetShortcutApplyResult {
        if let issue = configuration.validationIssue() {
            return .invalidConfiguration(issue)
        }

        let previousConfiguration = self.configuration
        self.configuration = configuration
        reconcile(eligibleSlots: eligibleSlots)

        let candidateFailures = activeRegistrationFailures()
        guard !candidateFailures.isEmpty else {
            store?.save(configuration)
            return .applied
        }

        self.configuration = previousConfiguration
        reconcile(eligibleSlots: eligibleSlots)
        let rollbackFailures = activeRegistrationFailures()
        if rollbackFailures.isEmpty {
            return .registrationRejected(candidateFailures)
        }
        return .rollbackFailed(
            candidateFailures: candidateFailures,
            rollbackFailures: rollbackFailures
        )
    }

    func reconcile(eligibleSlots: Set<Int>) {
        self.eligibleSlots = eligibleSlots.intersection(Set(1...4))
        var desired: [PetShortcutIntent: PetShortcut] = [
            .toggle: configuration.toggle,
        ]
        for slot in self.eligibleSlots {
            if let intent = PetShortcutIntent.slot(slot) {
                desired[intent] = configuration.shortcut(for: intent)
            }
        }
        var shortcutOwners: [PetShortcut: PetShortcutIntent] = [:]
        var collisions: Set<PetShortcutIntent> = []
        for intent in PetShortcutIntent.allCases {
            guard let shortcut = desired[intent] else { continue }
            if shortcutOwners[shortcut] != nil {
                collisions.insert(intent)
            } else {
                shortcutOwners[shortcut] = intent
            }
        }

        let bindingsToRetire = PetShortcutIntent.allCases.filter { intent in
            guard let current = active[intent] else { return false }
            guard !collisions.contains(intent), let shortcut = desired[intent] else { return true }
            return current.shortcut != shortcut
        }
        for intent in bindingsToRetire { retire(intent) }

        let needsNewRegistration = PetShortcutIntent.allCases.contains { intent in
            !collisions.contains(intent) && desired[intent] != nil && active[intent] == nil
        }
        if needsNewRegistration {
            generation &+= 1
            if generation == 0 { generation = 1 }
        }

        for intent in PetShortcutIntent.allCases {
            if collisions.contains(intent) {
                statuses[intent] = .internalCollision
                continue
            }
            guard let shortcut = desired[intent] else {
                statuses[intent] = .inactive
                continue
            }
            if let current = active[intent], current.shortcut == shortcut {
                statuses[intent] = .registered(eventID: current.eventID)
                continue
            }
            let ordinal = UInt32(PetShortcutIntent.allCases.firstIndex(of: intent)! + 1)
            let eventID = (generation << 8) | ordinal
            let event = PetHotKeyEvent(signature: Self.signature, id: eventID)
            do {
                let reference = try backend.register(
                    event: event,
                    shortcut: shortcut,
                    exclusive: true
                )
                active[intent] = ActiveBinding(
                    shortcut: shortcut,
                    eventID: eventID,
                    reference: reference
                )
                intentByEventID[eventID] = intent
                statuses[intent] = .registered(eventID: eventID)
            } catch let PetHotKeyBackendError.registration(status)
                where status == OSStatus(eventHotKeyExistsErr)
            {
                statuses[intent] = .systemCollision
            } catch let PetHotKeyBackendError.registration(status) {
                statuses[intent] = .registrationFailure(status: status)
            } catch {
                statuses[intent] = .registrationFailure(status: nil)
            }
        }
    }

    private func retire(_ intent: PetShortcutIntent) {
        guard let current = active.removeValue(forKey: intent) else { return }
        intentByEventID.removeValue(forKey: current.eventID)
        backend.unregister(current.reference)
    }

    private func activeRegistrationFailures() -> [PetShortcutApplyFailure] {
        var intents: [PetShortcutIntent] = [.toggle]
        intents.append(contentsOf: eligibleSlots.sorted().compactMap(PetShortcutIntent.slot))
        return intents.compactMap { intent in
            let status = statuses[intent] ?? .registrationFailure(status: nil)
            guard case .registered = status else {
                return PetShortcutApplyFailure(intent: intent, status: status)
            }
            return nil
        }
    }

    private func receive(_ event: PetHotKeyEvent) {
        guard event.signature == Self.signature,
              let intent = intentByEventID[event.id],
              active[intent]?.eventID == event.id
        else { return }
        onIntent(intent)
    }

    deinit {
        for binding in active.values {
            backend.unregister(binding.reference)
        }
    }
}
