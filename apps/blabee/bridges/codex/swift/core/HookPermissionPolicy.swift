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
    // checked at rust-v0.154.0 commit 6b9826e3aa83b1a5947db50f4332cb9c65f1b340
    // and unchanged in 0.155.0 (f0a1b8f0849d90960bc406b848f32e5a129b0457)
    // and 0.155.1 (be2951ea34f0d295ed0becf97079f92fa5f6950e).
    // The same one-shot contract was rechecked for 0.156.0/0.156.1 and
    // 0.157.0/0.157.1, 0.158.0, 0.159.0/0.159.1/0.159.2/0.159.3
    // and 0.160.0; see docs/features/CODEX_0160_QUALIFICATION.md.
    // Rechecked for 0.160.1/0.161.0/0.162.0/0.162.1; see
    // docs/features/CODEX_0162_QUALIFICATION.md. Managed runtime and update
    // lifecycle qualification remain separate gates from these Hook identities.
    // The unchanged one-shot path was also reviewed for 0.163.0 and 0.164.0;
    // see docs/features/CODEX_0164_QUALIFICATION.md. Plugin content trust
    // migration is separate from this live-caller one-shot approval identity.
    // Rechecked for 0.166.0; local Plugin Hooks are still spawned by codex,
    // not the newly packaged codex-exec-server. See CODEX_0166_QUALIFICATION.md.
    /// From bridges/codex/qualification/*.json (HookPermissionProfiles.generated.swift).
    public static let qualifiedProfiles: [RuntimeProfile] = generatedQualifiedProfiles

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
