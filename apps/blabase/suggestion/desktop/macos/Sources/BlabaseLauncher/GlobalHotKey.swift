import Carbon
import Foundation

enum LauncherShortcut {
    static let displayName = "⇧ Space"
    static let keyCode = UInt32(kVK_Space)
    static let modifierMask = UInt32(shiftKey)
}

@MainActor
final class GlobalHotKey: @unchecked Sendable {
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private let action: @MainActor () -> Void
    private(set) var isRegistered = false

    init(action: @escaping @MainActor () -> Void) {
        self.action = action
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            globalHotKeyHandler,
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandlerRef
        )
        guard status == noErr else { return }
        let identifier = EventHotKeyID(
            signature: OSType(0x424C4142),
            id: 1
        )
        let registrationStatus = RegisterEventHotKey(
            LauncherShortcut.keyCode,
            LauncherShortcut.modifierMask,
            identifier,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
        guard registrationStatus == noErr else {
            if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
            eventHandlerRef = nil
            hotKeyRef = nil
            return
        }
        isRegistered = true
    }

    func invalidate() {
        if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
        if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
        hotKeyRef = nil
        eventHandlerRef = nil
        isRegistered = false
    }

    fileprivate func perform() {
        action()
    }
}

private let globalHotKeyHandler: EventHandlerUPP = {
    _, _, userData -> OSStatus in
    guard let userData else { return OSStatus(eventNotHandledErr) }
    let hotKey = Unmanaged<GlobalHotKey>
        .fromOpaque(userData)
        .takeUnretainedValue()
    Task { @MainActor in
        hotKey.perform()
    }
    return noErr
}
