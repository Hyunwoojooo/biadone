import { z } from "zod";

export const semanticItemTypeSchema = z.enum([
  "intent",
  "topic",
  "decision",
  "open_question",
  "action",
  "preference",
  "content_constraint",
  "problem_signal",
  "satisfaction",
  "change_event",
  "entity",
  "relation"
]);

export type SemanticItemType = z.infer<typeof semanticItemTypeSchema>;
export type SemanticItemSource = "rule" | "llm";

export const semanticItemSchema = z.object({
  id: z.string().min(1),
  type: semanticItemTypeSchema,
  source: z.enum(["rule", "llm"]),
  sourceItemId: z.string().nullable(),
  label: z.string().min(1),
  description: z.string(),
  status: z.string().nullable(),
  category: z.string().nullable(),
  triggerPhrase: z.string().nullable(),
  evidenceMessageIndexes: z.array(z.number().int().positive()),
  confidence: z.number().min(0).max(1),
  reviewRequired: z.boolean()
});

export type SemanticItem = z.infer<typeof semanticItemSchema>;

export const llmSemanticOutputSchema = z.object({
  items: z.array(
    semanticItemSchema.omit({
      id: true,
      source: true,
      sourceItemId: true,
      reviewRequired: true
    })
  )
});

export type LlmSemanticOutput = z.infer<typeof llmSemanticOutputSchema>;

export type ShadowLlmResult = {
  status: "disabled" | "completed" | "failed";
  provider: "openai" | "qwen" | "gemini" | null;
  model: string | null;
  items: SemanticItem[];
  error?: {
    code: "SHADOW_DISABLED" | "LLM_REQUEST_FAILED" | "LLM_INVALID_OUTPUT";
    message: string;
  };
};

export type HybridExtractionResult = {
  mode: "shadow";
  createdAt: string;
  ruleResult: {
    extractorVersion: string;
    items: SemanticItem[];
  };
  llmResult: ShadowLlmResult;
};

const nullableString = { type: ["string", "null"] } as const;

export const LLM_SEMANTIC_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "label",
          "description",
          "status",
          "category",
          "triggerPhrase",
          "evidenceMessageIndexes",
          "confidence"
        ],
        properties: {
          type: {
            type: "string",
            enum: semanticItemTypeSchema.options
          },
          label: { type: "string", minLength: 1 },
          description: { type: "string" },
          status: nullableString,
          category: nullableString,
          triggerPhrase: nullableString,
          evidenceMessageIndexes: {
            type: "array",
            items: { type: "integer", minimum: 1 }
          },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  }
} as const;
