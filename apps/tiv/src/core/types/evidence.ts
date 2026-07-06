import type { CanonicalMessage } from "./conversation";

export type EvidenceAnchor = {
  id: string;
  conversationId: string;
  messageId: string;
  messageIndex: number;
  role: CanonicalMessage["role"];
  textSpan: {
    startChar: number;
    endChar: number;
  } | null;
  quote: string;
  evidenceType: "direct_quote" | "paraphrase" | "inferred_from_context";
  confidence:
    | "explicit_user_statement"
    | "explicit_assistant_statement"
    | "agreed_conclusion"
    | "model_inference"
    | "weak_inference";
};
