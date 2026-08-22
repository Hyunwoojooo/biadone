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
}

struct PetShortcut: Codable, Sendable, Equatable, Hashable {
    let keyCode: UInt32
    let modifiers: UInt32

    init(keyCode: UInt32, modifiers: UInt32) {
        self.keyCode = keyCode
        self.modifiers = modifiers
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
        return try? JSONDecoder().decode(PetShortcutConfiguration.self, from: data)
    }

    func save(_ configuration: PetShortcutConfiguration) {
        guard let data = try? JSONEncoder().encode(configuration) else { return }
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
    private var configuration: PetShortcutConfiguration
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

    func updateConfiguration(_ configuration: PetShortcutConfiguration) {
        self.configuration = configuration
        store?.save(configuration)
        reconcile(eligibleSlots: eligibleSlots)
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
