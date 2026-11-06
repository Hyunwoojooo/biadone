import Carbon
import CoreGraphics
import Foundation

enum PetEventNavigationDirection: CaseIterable, Sendable, Hashable {
    case previous
    case next

    var shortcut: PetShortcut {
        PetShortcut(
            keyCode: UInt32(self == .previous ? kVK_LeftArrow : kVK_RightArrow),
            modifiers: UInt32(optionKey)
        )
    }

    var label: String { self == .previous ? "⌥←" : "⌥→" }
}

struct PetEventNavigationActivation: Sendable, Equatable {
    let contextID: String
    let direction: PetEventNavigationDirection
    let eventID: UInt32
}

/// Captures the visible event before an asynchronous MainActor handoff. Held
/// arrows survive a rebind, so autorepeat cannot navigate a newly shown event.
final class PetEventNavigationHotKeyEventGate: @unchecked Sendable {
    private let lock = NSLock()
    private var bindings: [UInt32: PetEventNavigationActivation] = [:]
    private var heldKeys: Set<UInt32> = []

    func replaceBindings(_ bindings: [UInt32: PetEventNavigationActivation], held: Set<UInt32>) {
        lock.lock()
        defer { lock.unlock() }
        self.bindings = bindings
        heldKeys.formUnion(held)
    }

    func capture(_ event: PetHotKeyEvent, modifiers: UInt32) -> PetEventNavigationActivation? {
        guard event.signature == PetEventNavigationHotKeys.signature,
              event.phase == .pressed, modifiers == UInt32(optionKey) else { return nil }
        lock.lock()
        defer { lock.unlock() }
        guard let binding = bindings[event.id] else { return nil }
        let wasBlocked = !heldKeys.isEmpty
        heldKeys.insert(binding.direction.shortcut.keyCode)
        return wasBlocked ? nil : binding
    }

    var keysAwaitingRelease: Set<UInt32> {
        lock.lock()
        defer { lock.unlock() }
        return heldKeys
    }

    func release(_ keys: Set<UInt32>) {
        lock.lock()
        defer { lock.unlock() }
        heldKeys.subtract(keys)
    }
}

/// Both arrows are reserved only while the caller supplies an eligible visible
/// event context. A collision releases the whole pair and leaves clicks usable.
@MainActor
final class PetEventNavigationHotKeys {
    nonisolated static let signature: UInt32 = 0x426E_6176 // "Bnav"

    nonisolated static func currentModifiers() -> UInt32 {
        let flags = CGEventSource.flagsState(.combinedSessionState)
        var modifiers: UInt32 = 0
        if flags.contains(.maskAlternate) { modifiers |= UInt32(optionKey) }
        if flags.contains(.maskCommand) { modifiers |= UInt32(cmdKey) }
        if flags.contains(.maskControl) { modifiers |= UInt32(controlKey) }
        if flags.contains(.maskShift) { modifiers |= UInt32(shiftKey) }
        return modifiers
    }

    private struct Binding: Sendable {
        let activation: PetEventNavigationActivation
        let reference: any PetHotKeyReference
    }

    let eventGate = PetEventNavigationHotKeyEventGate()
    private let backend: any PetHotKeyBackend
    private let keyIsPressed: @MainActor (UInt32) -> Bool
    private var contextID: String?
    private var active: [PetEventNavigationDirection: Binding] = [:]
    private var nextEventID: UInt32 = 0x6000_0000
    private var releaseTask: Task<Void, Never>?
    private(set) var statuses: [PetEventNavigationDirection: PetShortcutBindingStatus] = [:]

    init(
        backend: any PetHotKeyBackend,
        keyIsPressed: @escaping @MainActor (UInt32) -> Bool = {
            CGEventSource.keyState(.combinedSessionState, key: CGKeyCode($0))
        }
    ) {
        self.backend = backend
        self.keyIsPressed = keyIsPressed
    }

    func reconcile(contextID: String?) {
        guard self.contextID != contextID else { return }
        eventGate.replaceBindings([:], held: [])
        unregisterBindings()
        self.contextID = contextID
        statuses = Dictionary(uniqueKeysWithValues: PetEventNavigationDirection.allCases.map { ($0, .inactive) })
        if let contextID {
            for direction in PetEventNavigationDirection.allCases {
                nextEventID &+= 1
                let event = PetHotKeyEvent(signature: Self.signature, id: nextEventID)
                do {
                    let reference = try backend.register(event: event, shortcut: direction.shortcut, exclusive: true)
                    active[direction] = Binding(
                        activation: PetEventNavigationActivation(
                            contextID: contextID, direction: direction, eventID: event.id
                        ),
                        reference: reference
                    )
                    statuses[direction] = .registered(eventID: event.id)
                } catch let PetHotKeyBackendError.registration(status) where status == OSStatus(eventHotKeyExistsErr) {
                    statuses[direction] = .systemCollision
                } catch let PetHotKeyBackendError.registration(status) {
                    statuses[direction] = .registrationFailure(status: status)
                } catch {
                    statuses[direction] = .registrationFailure(status: nil)
                }
            }
            if active.count != PetEventNavigationDirection.allCases.count {
                for direction in active.keys { statuses[direction] = .inactive }
                unregisterBindings()
            }
        }
        let held = Set(PetEventNavigationDirection.allCases.map(\.shortcut.keyCode).filter(keyIsPressed))
        eventGate.replaceBindings(
            Dictionary(uniqueKeysWithValues: active.values.map { ($0.activation.eventID, $0.activation) }),
            held: held
        )
        pollRelease()
        startReleaseMonitorIfNeeded()
    }

    func receive(_ activation: PetEventNavigationActivation?) -> PetEventNavigationActivation? {
        pollRelease()
        startReleaseMonitorIfNeeded()
        guard let activation, isCurrent(activation) else { return nil }
        return activation
    }

    func isCurrent(_ activation: PetEventNavigationActivation) -> Bool {
        contextID == activation.contextID && active[activation.direction]?.activation == activation
    }

    func label(for direction: PetEventNavigationDirection) -> String? {
        active[direction] == nil ? nil : direction.label
    }

    var diagnostic: String? {
        let unavailable = PetEventNavigationDirection.allCases.filter {
            switch statuses[$0] {
            case .systemCollision?, .registrationFailure?: true
            default: false
            }
        }
        guard !unavailable.isEmpty else { return nil }
        return PetL10n.text("Unable to register event navigation shortcuts: ", korean: "이벤트 이동 단축키를 등록하지 못했습니다: ") + unavailable.map(\.label).joined(separator: ", ")
            + PetL10n.text(". Click the Previous or Next button.", korean: ". 이전·다음 버튼을 클릭해 주세요.")
    }

    private func unregisterBindings() {
        for binding in active.values { backend.unregister(binding.reference) }
        active.removeAll()
    }

    func pollRelease() {
        // A Carbon release may mean only Option went up. Wait for the physical
        // arrow to be up before accepting a new press, including after hiding.
        eventGate.release(eventGate.keysAwaitingRelease.filter { !keyIsPressed($0) })
        if eventGate.keysAwaitingRelease.isEmpty {
            releaseTask?.cancel()
            releaseTask = nil
        }
    }

    private func startReleaseMonitorIfNeeded() {
        guard releaseTask == nil, !eventGate.keysAwaitingRelease.isEmpty else { return }
        releaseTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .milliseconds(33)) } catch { return }
                guard let self, !Task.isCancelled else { return }
                self.pollRelease()
                if self.eventGate.keysAwaitingRelease.isEmpty { return }
            }
        }
    }

    deinit {
        releaseTask?.cancel()
        for binding in active.values { backend.unregister(binding.reference) }
    }
}
