import Foundation

/// Qualification of the calling Codex runtime, not of an arbitrary installation
/// found on PATH. This non-secret marker is supplied only by the Hook adapter
/// after checking its live ancestry against the qualified signed code identity.
/// It grants no action by itself: the exact pending request still needs a Pet
/// selection, a live consumer, current session binding and one-shot delivery.
public enum HookPermissionPolicy {
    public static let qualificationKey = "blabee_allow_once_qualification"
    public static let maximumCommandScalars = 16_384

    /// The Pet renders the complete command in a bounded scroll view. Preserve
    /// shell newlines and tabs verbatim; reject invisible/spoofing control text.
    public static func isValidCommand(_ command: String) -> Bool {
        !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && command.unicodeScalars.count <= maximumCommandScalars
            && IdentifierNormalization.isNFC(command)
            && command.unicodeScalars.allSatisfy { scalar in
                if scalar.value == 0x09 || scalar.value == 0x0A { return true }
                let category = scalar.properties.generalCategory
                return !scalar.properties.isDefaultIgnorableCodePoint
                    && category != .control && category != .format
                    && category != .lineSeparator && category != .paragraphSeparator
            }
    }

    /// Validate the displayed authority without rewriting macOS path aliases.
    /// Project/session lookup may normalize a separate copy of this value.
    public static func isValidCWD(_ path: String) -> Bool {
        path.hasPrefix("/")
            && path.unicodeScalars.count <= 4_096
            && !path.utf8.contains(0)
    }

    public struct RuntimeProfile: Sendable {
        public let version: String
        public let cdHash: String

        public var qualification: String { "codex-\(version)-arm64-\(cdHash)" }
    }

    // Each entry pins a reviewed signed runtime, not a version range. The
    // PermissionRequest Allow -> Approved (not ApprovedForSession) path was
    // checked at OpenAI's rust-v0.154.0 commit 6b9826e3aa83b1a5947db50f4332cb9c65f1b340.
    public static let qualifiedProfiles: [RuntimeProfile] = [
        .init(version: "0.153.4", cdHash: "9227334847123dd04d3369b05b27769de1987426"),
        .init(version: "0.154.0", cdHash: "506770a222b6e1e63c332cbfe40dc399876c1d2a"),
    ]

    // Retain the original marker for existing fixtures and older callers.
    public static let qualifiedVersion = "0.153.4"
    public static let qualifiedCDHash = "9227334847123dd04d3369b05b27769de1987426"
    public static let qualifiedRuntime =
        "codex-0.153.4-arm64-9227334847123dd04d3369b05b27769de1987426"

    public static func allowsOnce(qualification: String?) -> Bool {
        guard let qualification else { return false }
        return qualifiedProfiles.contains {
            qualification.utf8.elementsEqual($0.qualification.utf8)
        }
    }

    public static func qualification(forCDHash cdHash: String) -> String? {
        qualifiedProfiles.first { cdHash.utf8.elementsEqual($0.cdHash.utf8) }?.qualification
    }
}
