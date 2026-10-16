import Foundation

/// The intentionally small user-visible envelope used to deliver a queued
/// Blabee action through Codex's `UserPromptSubmit` Hook.
///
/// Keep parsing here so the producer, Hook adapter, and coordinator all agree
/// on the exact marker, canonical Unicode form, and bounded reference syntax.
public enum QueuedPromptEnvelope: Sendable {
    public static let prefix =
        "Blabee 선택 작업을 불러옵니다. Hook 세부 조건이 없으면 실행하지 마세요. ref="
    public static let referenceByteCount = 16

    /// Safe fail-closed context for a ref whose response may have been lost.
    /// It deliberately contains no ref, action payload, binding, identifier,
    /// or transport error detail.
    public static let unavailableAdditionalContext =
        "Blabee could not complete internal Hook verification of the selected action. "
        + "This verification failure does not show that the user's selection deadline expired. "
        + "Do not execute this request or infer or replay an action from its ref. "
        + "Explain the internal verification failure and ask the user to select a fresh Blabee action."

    public enum Classification: Equatable, Sendable {
        // Compatibility name for a prompt without the Blabee envelope. This
        // does not attest that a person authored it or identify a host task.
        case human
        case exact(reference: String)
        case malformed
    }

    public static func message(reference: String) -> String? {
        guard isValidReference(reference) else { return nil }
        return prefix + reference
    }

    /// Classifies after NFC normalization because `codex queue` may
    /// canonically decompose non-ASCII command-line text before the Hook sees
    /// it. Apart from that canonical normalization, the envelope must be an
    /// exact prefix plus one lowercase hexadecimal reference and no suffix.
    public static func classify(_ prompt: String) -> Classification {
        let normalized = prompt.precomposedStringWithCanonicalMapping
        guard normalized.hasPrefix(prefix) else { return .human }
        let reference = String(normalized.dropFirst(prefix.count))
        guard let expected = message(reference: reference),
              normalized.utf8.elementsEqual(expected.utf8)
        else { return .malformed }
        return .exact(reference: reference)
    }

    public static func isValidReference(_ value: String) -> Bool {
        value.utf8.count == referenceByteCount * 2
            && value.utf8.allSatisfy { byte in
                (0x30...0x39).contains(byte) || (0x61...0x66).contains(byte)
            }
    }
}
