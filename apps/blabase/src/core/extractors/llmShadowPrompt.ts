import type { CanonicalMessage } from "../types/conversation";
import type { LlmShadowSegment } from "./llmShadowSegmentation";

export const LLM_SHADOW_EXTRACTOR_VERSION = "5A-2.0";

export function buildLlmShadowPrompt(
  conversationId: string,
  segment: LlmShadowSegment,
  segmentCount: number
): string {
  const contextMessages = segment.contextMessages.map((message) =>
    promptMessage(message, true)
  );
  const messages = segment.messages.map((message) =>
    promptMessage(message, false)
  );
  const allowedMessageIndexes = [...contextMessages, ...messages].map(
    (message) => message.messageIndex
  );

  return [
    "You are the blabase semantic extraction shadow model.",
    "Analyze one clean-conversation segment and return every evidence-backed semantic candidate. This is exhaustive extraction, not a summary or top-N list.",
    "Inspect every category independently. Return zero items for a category when there is no evidence; never invent coverage.",
    "Semantic checklist:",
    "- intent: explicit user goals, desired outcomes, or core questions.",
    "- topic: concrete discussion subjects and meaningful topic transitions.",
    "- decision: split clauses and classify user-backed choices as confirmed, deferred, excluded, or candidate.",
    "- open_question: unresolved user questions; mark answered, resolved, or superseded only when later visible evidence supports it.",
    "- action: requested work or accepted next steps. Keep assistant-only suggestions as low-confidence suggestions, never confirmed user actions.",
    "- preference: desired response tone, length, language, format, or depth.",
    "- content_constraint: facts or subjects that the requested output must include or exclude. Do not confuse this with response format.",
    "- problem_signal: user pain points, blockers, errors, risks, or dissatisfaction with the situation.",
    "- satisfaction: pair an assistant final answer only with the next user reaction. Distinguish satisfied, partially_satisfied, dissatisfied, correction_requested, and clarification_requested.",
    "- change_event: explicit scope, condition, format, perspective, or implementation-phase changes.",
    "- entity and relation: include only named objects and explicit relationships useful for understanding the conversation.",
    "Evidence rules:",
    "- Prefer explicit user evidence for intent, preference, decision, action, and satisfaction.",
    "- Split multiple meanings in one message into separate items.",
    "- Do not extract examples, quoted templates, code, tool operations, or assistant-only proposals as user facts.",
    "- Every item must cite one or more allowed messageIndex values and include a short direct triggerPhrase copied from cited text when possible.",
    "- contextOnly messages exist only to interpret the first main user reaction or accepted assistant proposal. Do not create standalone items solely from contextOnly text.",
    "- Use null for status, category, or triggerPhrase when not applicable.",
    "- Confidence must reflect both semantic certainty and evidence strength. All output remains review-only.",
    JSON.stringify({
      conversationId,
      segment: {
        id: segment.id,
        order: segment.order,
        totalSegments: segmentCount,
        label: segment.label,
        topicIds: segment.topicIds,
        allowedMessageIndexes,
        contextMessages,
        messages
      }
    })
  ].join("\n\n");
}

function promptMessage(message: CanonicalMessage, contextOnly: boolean) {
  return {
    messageIndex: message.index,
    messageId: message.id,
    role: message.role,
    createdAt: message.createdAt,
    contextOnly,
    text: message.text
  };
}
