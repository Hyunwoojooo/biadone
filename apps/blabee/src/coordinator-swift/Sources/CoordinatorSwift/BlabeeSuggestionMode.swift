import Foundation

/// Controls which completed Codex responses may surface follow-up suggestions.
///
/// This is a generation policy only. Every accepted suggestion still uses the
/// frozen v1 `blabee_decision` proposal and packet contracts.
public enum BlabeeSuggestionMode: String, CaseIterable, Sendable {
    case smart
    case always
    case actionOnly = "action_only"
}

/// Server-authored instructions shared by SessionStart and UserPromptSubmit.
/// Keeping this policy here prevents the two Hook entry points from drifting.
public enum BlabeeSuggestionContext {
    public static func instructions(for mode: BlabeeSuggestionMode) -> String {
        let common = "Blabee suggestion_mode=\(mode.rawValue). Use the current Hook context only. Never convert native permission prompts or internal subagent output into a Blabee suggestion, never invent choices just to satisfy the 2-4 action contract, and do not call blabee.emit_decision when the exact current Hook identifiers are missing. Explicit user instructions that prohibit tool calls or side effects override this suggestion policy. Treat an exact-output, exact-once, or no-additional-work request as an explicit prohibition on an extra suggestion tool call."

        switch mode {
        case .actionOnly:
            return common + " For an action-type request, every completed, partial, blocked, or failed result must call blabee.emit_decision exactly once before finalizing, even when the result is short or text-only. Do not call it for explanations, structure descriptions, status checks, general questions, acknowledgements, or casual chat."
        case .smart:
            return common + " For an action-type request, every completed, partial, blocked, or failed result must call blabee.emit_decision exactly once before finalizing, even when the result is short or text-only. Separately, for a substantive explanation, analysis, or general question, call it only when there are at least two distinct and genuinely useful follow-up questions or actions. The two-follow-up eligibility gate applies only to these informational responses, not to the existing mandatory action-type rule. Do not call it for simple status checks, acknowledgements, casual chat, or informational responses with fewer than two useful follow-ups."
        case .always:
            return common + " Every eligible main-agent user-facing final response must call blabee.emit_decision exactly once before finalizing and offer 2-4 distinct, genuinely useful follow-up questions or actions. Simple status checks, acknowledgements, and general questions are eligible in this mode. If fewer than two real follow-ups exist, do not fabricate them and do not call the tool."
        }
    }
}
