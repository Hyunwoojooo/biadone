import Carbon
import CoreGraphics
import Foundation

enum PetApprovalShortcutIntent: Int, CaseIterable, Sendable, Hashable {
    case allowOnce = 1
    case deny = 2
    case deferToCodex = 3

    var label: String { "⌘\(rawValue)" }
    var shortcut: PetShortcut {
        let keys = [kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3]
        return PetShortcut(keyCode: UInt32(keys[rawValue - 1]), modifiers: UInt32(cmdKey))
    }

    func isAvailable(for head: PetApprovalHead) -> Bool {
        switch head {
        case .permission(let request):
            return !request.deliveryPending && (self != .allowOnce || request.allowOnceAvailable)
        case .managed(let request):
            guard !request.deliveryPending else { return false }
            switch self {
            case .allowOnce: return request.allowOnceAvailable
            case .deny: return request.declineAvailable
            case .deferToCodex: return true
            }
        }
    }
}

struct PetApprovalShortcutActivation: Sendable, Equatable {
    let head: PetApprovalHead
    let intent: PetApprovalShortcutIntent
    let eventID: UInt32
}

/// Carbon callbacks capture the displayed request before hopping to MainActor.
/// The lock also makes repeated presses inert before the first Task can run.
final class PetApprovalHotKeyEventGate: @unchecked Sendable {
    private let lock = NSLock()
    private var bindings: [UInt32: PetApprovalShortcutActivation] = [:]
    private var heldKeys: Set<UInt32> = []

    func replaceBindings(_ bindings: [UInt32: PetApprovalShortcutActivation], held: Set<UInt32>) {
        lock.lock()
        defer { lock.unlock() }
        self.bindings = bindings
        heldKeys.formUnion(held)
    }

    func capture(_ event: PetHotKeyEvent) -> PetApprovalShortcutActivation? {
        guard event.signature == PetApprovalHotKeys.signature else { return nil }
        lock.lock()
        defer { lock.unlock() }
        if event.phase == .released {
            // A Carbon chord release can mean only Command went up. The
            // physical digit must be up before another request can be chosen.
            return nil
        }
        guard let binding = bindings[event.id] else { return nil }
        let wasBlocked = !heldKeys.isEmpty
        let key = binding.intent.shortcut.keyCode
        // An overlapping press remains ineligible after the earlier digit is
        // released; it needs its own physical release before it can be reused.
        heldKeys.insert(key)
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

/// Approval chords exist only for the visible, actionable approval head. They
/// are independent of persisted selection/preview shortcuts and never remap.
@MainActor
final class PetApprovalHotKeys {
    nonisolated static let signature: UInt32 = 0x4261_7072 // "Bapr"
    private struct Binding: Sendable {
        let activation: PetApprovalShortcutActivation
        let reference: any PetHotKeyReference
    }
    let eventGate = PetApprovalHotKeyEventGate()
    private let backend: any PetHotKeyBackend
    private let keyIsPressed: @MainActor (UInt32) -> Bool
    private var head: PetApprovalHead?
    private var active: [PetApprovalShortcutIntent: Binding] = [:]
    private var nextEventID: UInt32 = 0x4000_0000
    private var releaseTask: Task<Void, Never>?
    private(set) var statuses: [PetApprovalShortcutIntent: PetShortcutBindingStatus] = [:]
    var onAvailabilityChanged: (@MainActor () -> Void)?

    init(
        backend: any PetHotKeyBackend,
        keyIsPressed: @escaping @MainActor (UInt32) -> Bool = {
            CGEventSource.keyState(.combinedSessionState, key: CGKeyCode($0))
        }
    ) {
        self.backend = backend
        self.keyIsPressed = keyIsPressed
    }

    func reconcile(head: PetApprovalHead?) {
        guard head != self.head else { return }
        eventGate.replaceBindings([:], held: [])
        for binding in active.values { backend.unregister(binding.reference) }
        active.removeAll()
        self.head = head
        for intent in PetApprovalShortcutIntent.allCases {
            guard let head, intent.isAvailable(for: head) else {
                statuses[intent] = .inactive
                continue
            }
            nextEventID &+= 1
            let event = PetHotKeyEvent(signature: Self.signature, id: nextEventID)
            do {
                let reference = try backend.register(event: event, shortcut: intent.shortcut, exclusive: true)
                active[intent] = Binding(
                    activation: PetApprovalShortcutActivation(head: head, intent: intent, eventID: event.id),
                    reference: reference
                )
                statuses[intent] = .registered(eventID: event.id)
            } catch let PetHotKeyBackendError.registration(status) where status == OSStatus(eventHotKeyExistsErr) {
                statuses[intent] = .systemCollision
            } catch let PetHotKeyBackendError.registration(status) {
                statuses[intent] = .registrationFailure(status: status)
            } catch {
                statuses[intent] = .registrationFailure(status: nil)
            }
        }
        let held = head == nil ? [] : Set(PetApprovalShortcutIntent.allCases.map(\.shortcut.keyCode).filter(keyIsPressed))
        eventGate.replaceBindings(
            Dictionary(uniqueKeysWithValues: active.values.map { ($0.activation.eventID, $0.activation) }),
            held: held
        )
        startReleaseMonitorIfNeeded()
    }

    func receive(_ activation: PetApprovalShortcutActivation?) -> PetApprovalShortcutActivation? {
        pollRelease()
        startReleaseMonitorIfNeeded()
        onAvailabilityChanged?()
        guard let activation, isCurrent(activation) else { return nil }
        return activation
    }

    func isCurrent(_ activation: PetApprovalShortcutActivation) -> Bool {
        head == activation.head && active[activation.intent]?.activation == activation
    }

    func label(for intent: PetApprovalShortcutIntent, head: PetApprovalHead) -> String? {
        guard self.head == head, active[intent] != nil,
              eventGate.keysAwaitingRelease.isEmpty else { return nil }
        return intent.label
    }

    var diagnostic: String? {
        let unavailable = PetApprovalShortcutIntent.allCases.filter {
            switch statuses[$0] {
            case .systemCollision?, .registrationFailure?: true
            default: false
            }
        }
        guard !unavailable.isEmpty else { return nil }
        return "승인 단축키를 등록하지 못했습니다: " + unavailable.map(\.label).joined(separator: ", ")
            + ". 해당 버튼을 클릭해 주세요."
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

    func pollRelease() {
        // Unregistering the consumed request can suppress Carbon's release
        // event. Read only these held digits until they are physically up.
        let released = eventGate.keysAwaitingRelease.filter { !keyIsPressed($0) }
        eventGate.release(released)
        if eventGate.keysAwaitingRelease.isEmpty {
            releaseTask?.cancel()
            releaseTask = nil
        }
        if !released.isEmpty { onAvailabilityChanged?() }
    }

    deinit {
        releaseTask?.cancel()
        for binding in active.values { backend.unregister(binding.reference) }
    }
}
