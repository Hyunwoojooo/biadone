import Foundation

/// Qualification of the calling Codex runtime, not of an arbitrary installation
/// found on PATH. This non-secret marker is supplied only by the Hook adapter
/// after checking its live ancestry against the qualified signed code identity.
/// It grants no action by itself: the exact pending request still needs a Pet
/// selection, a live consumer, current session binding and one-shot delivery.
public enum HookPermissionPolicy {
    public static let qualificationKey = "blabee_allow_once_qualification"
    public static let qualifiedVersion = "0.153.4"
    public static let qualifiedCDHash = "9227334847123dd04d3369b05b27769de1987426"
    public static let qualifiedRuntime =
        "codex-0.153.4-arm64-9227334847123dd04d3369b05b27769de1987426"

    public static func allowsOnce(qualification: String?) -> Bool {
        guard let qualification else { return false }
        return qualification.utf8.elementsEqual(qualifiedRuntime.utf8)
    }
}
