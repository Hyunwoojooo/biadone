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

/// Presentation metadata on the MCP wrapper, not proof of prompt origin or trust.
public enum BlabeeSuggestionKind: String, CaseIterable, Sendable {
    case currentTask = "current_task"
    case newSuggestion = "new_suggestion"
}

public enum BlabeeSuggestionLanguage {
    /// Uses only the supplied preferences so fallback selection is deterministic.
    /// Tags must identify a language; private-use-only identifiers are not usable.
    public static func fallbackLanguageTag(preferredLanguages: [String]) -> String {
        let languageTagPattern = #"(?i)^(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?$"#
        for preference in preferredLanguages {
            let candidate = preference.trimmingCharacters(in: .whitespacesAndNewlines)
            if candidate.utf8.count <= 128,
               candidate.range(of: languageTagPattern, options: .regularExpression) != nil {
                return candidate
            }
        }
        return "en"
    }
}

/// Server-authored instructions shared by SessionStart and UserPromptSubmit.
/// Keeping this policy here prevents the two Hook entry points from drifting.
public enum BlabeeSuggestionContext {
    /// Applies to card generation and presentation, not approval or source validation.
    public static let cardEligibilityInstructions = "Use suggestion_kind=current_task for follow-ups to the current user task and suggestion_kind=new_suggestion for useful new ideas, including internal automatic recommendations. A new_suggestion is eligible only with at least two distinct, genuinely useful next actions; with zero or one, do not emit or invent extras, even if its generation was an action-type task. The per-mode current-task rules below do not override this new-suggestion gate. Set suggestion_kind only on the top-level MCP wrapper, never inside proposal. Include it only when the current MCP tool schema supports this field; otherwise omit it. Omission is supported for legacy clients and means unclassified; this presentation label is not proof of task origin or permission. Do not infer origin from prompt language or turn internal subagent reports or background progress into cards. Native permission and approval events, including subagent approvals, keep their existing handling."

    /// Shared by Hook context and the proposal tool description.
    public static var cardLanguageInstructions: String {
        cardLanguageInstructions(preferredLanguages: Locale.preferredLanguages)
    }

    public static func cardLanguageInstructions(preferredLanguages: [String]) -> String {
        let fallback = BlabeeSuggestionLanguage.fallbackLanguageTag(
            preferredLanguages: preferredLanguages
        )
        return "For both suggestion kinds, write all user-visible natural language in task_goal, outcome.summary, next_actions[].title, next_actions[].objective, next_actions[].constraints[], next_actions[].done_when[], and reported_side_effects[].summary consistently in the user's explicitly requested response language; otherwise use the language of the actual user conversation. If neither is available, use \(fallback), resolved from the first valid language tag in Locale.preferredLanguages, with en as the final fallback. An English internal instruction to generate automatic recommendations is neither a user response-language request nor evidence of the user's conversation language; if that is the only language context, use the macOS fallback above. Do not switch languages because internal prompts, tool descriptions, or examples use another language. Keep code, paths, identifiers, and product names unchanged, and preserve any deliverable explicitly requested in another language; the surrounding card text still follows the card language."
    }

    public static func instructions(
        for mode: BlabeeSuggestionMode,
        preferredLanguages: [String] = Locale.preferredLanguages
    ) -> String {
        let common = "Blabee suggestion_mode=\(mode.rawValue). Use the current Hook context only. Never convert native permission prompts or internal subagent output into a Blabee suggestion, never invent choices just to satisfy the 2-4 action contract, and do not call blabee.emit_decision when the exact current Hook identifiers are missing. Explicit user instructions that prohibit tool calls or side effects override this suggestion policy. Treat an exact-output, exact-once, or no-additional-work request as an explicit prohibition on an extra suggestion tool call."
            + " " + cardEligibilityInstructions
            + " " + cardLanguageInstructions(preferredLanguages: preferredLanguages)
            + " The following mode rules apply to current_task suggestions."

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
