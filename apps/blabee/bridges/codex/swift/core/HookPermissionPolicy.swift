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
    // The unchanged one-shot path was also reviewed for 0.163.0; see
    // docs/features/CODEX_0163_QUALIFICATION.md.
    public static let qualifiedProfiles: [RuntimeProfile] = [
        .init(version: "0.153.4", cdHash: "9227334847123dd04d3369b05b27769de1987426"),
        .init(version: "0.154.0", cdHash: "506770a222b6e1e63c332cbfe40dc399876c1d2a"),
        .init(version: "0.155.0", cdHash: "0a319829ccc6ff89160ceee151f1c2e78030f296"),
        .init(version: "0.155.1", cdHash: "0fc5f92c54ae7e1d576cd1d7d8ce979daec5bee2"),
        .init(version: "0.156.0", cdHash: "8001723826658db94fdb3d5f9be0785d4bdfb5b6"),
        .init(version: "0.156.1", cdHash: "8ac97cbe355e9fee8dd2f993358f0fde83a7a090"),
        .init(version: "0.157.0", cdHash: "cc8940cad4795103c7f31977fc2cabb7ebc17418"),
        .init(version: "0.157.1", cdHash: "344b1e8a3cfa9dc90b5488fa7dfed06fb5bb7e9c"),
        .init(version: "0.158.0", cdHash: "7c6ad5b6e049dbb4f6599fd32fea9181bac6cb86"),
        .init(version: "0.159.0", cdHash: "1479dac62b926f92b397043512f50ef17509a114"),
        .init(version: "0.159.1", cdHash: "5dee39e9a5f61fd86c84a3edac863120ca2f09c6"),
        .init(version: "0.159.2", cdHash: "baf27fc34f7af7acd514bfaa7c7b7313d723da0b"),
        .init(version: "0.159.3", cdHash: "dcfc226a89d9cf1c997395978f9bc26308038ca5"),
        .init(version: "0.160.0", cdHash: "4684feae17bed05191fd828bb819c61cb70db4f9"),
        .init(version: "0.160.1", cdHash: "f69ce2618e3876c26d787ae6fab77376dcc9c6fc"),
        .init(version: "0.161.0", cdHash: "59d668365cea9562058b3e42e3e2d4326db43b59"),
        .init(version: "0.162.0", cdHash: "5f410845b5189c21ca0aa20c2ef91293e3145b13"),
        .init(version: "0.162.1", cdHash: "9ddc61acceef79aa2aad437ba1fe94239f2e0423"),
        .init(version: "0.163.0", cdHash: "5a4eec85679683d4b137579cb2555fe0b42a02dd"),
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
