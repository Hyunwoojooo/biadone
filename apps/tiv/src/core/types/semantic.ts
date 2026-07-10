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

const llmSemanticItemSchema = semanticItemSchema
  .omit({
    id: true,
    source: true,
    sourceItemId: true,
    reviewRequired: true
  })
  .extend({
    evidenceMessageIndexes: z.array(z.number().int().positive()).min(1)
  });

export const llmSemanticOutputSchema = z.object({
  items: z.array(llmSemanticItemSchema)
});

export type LlmSemanticOutput = z.infer<typeof llmSemanticOutputSchema>;

export type LlmTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  thoughtTokens: number | null;
};

export type ShadowLlmSegmentResult = {
  id: string;
  order: number;
  label: string;
  topicIds: string[];
  startMessageIndex: number;
  endMessageIndex: number;
  messageIndexes: number[];
  contextMessageIndexes: number[];
  inputChars: number;
  status: "completed" | "failed";
  itemCount: number;
  durationMs: number;
  requestId: string | null;
  responseModel: string | null;
  usage: LlmTokenUsage;
  error?: {
    code: "LLM_REQUEST_FAILED" | "LLM_INVALID_OUTPUT";
    message: string;
  };
};

export type ShadowLlmMetrics = {
  requestCount: number;
  completedRequestCount: number;
  failedRequestCount: number;
  totalDurationMs: number;
  providerDurationMs: number;
  usage: {
    reportedRequestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    thoughtTokens: number;
  };
};

export type ShadowLlmCoverage = {
  cleanMessageCount: number;
  analyzedMessageCount: number;
  segmentCount: number;
  semanticTypeCounts: Partial<Record<SemanticItemType, number>>;
  representedMessageIndexes: number[];
  evidenceMessageCoverageRatio: number;
  unrepresentedSemanticTypes: SemanticItemType[];
  invalidEvidenceItemIds: string[];
};

export type ShadowLlmResult = {
  extractorVersion: string;
  status: "disabled" | "completed" | "partial" | "failed";
  provider: "openai" | "qwen" | "gemini" | null;
  model: string | null;
  items: SemanticItem[];
  segments: ShadowLlmSegmentResult[];
  metrics: ShadowLlmMetrics;
  coverage: ShadowLlmCoverage;
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
            enum: semanticItemTypeSchema.options,
            description: "Semantic category of this evidence-backed item."
          },
          label: {
            type: "string",
            minLength: 1,
            description:
              "Short, specific Korean label that identifies the extracted meaning."
          },
          description: {
            type: "string",
            description:
              "Conservative explanation supported by the cited messages."
          },
          status: {
            ...nullableString,
            description:
              "Type-appropriate state such as confirmed, deferred, open, or satisfied."
          },
          category: {
            ...nullableString,
            description:
              "Optional subtype such as tone, format, product, or architecture."
          },
          triggerPhrase: {
            ...nullableString,
            description:
              "Short direct phrase copied from a cited message, never a paraphrase."
          },
          evidenceMessageIndexes: {
            type: "array",
            minItems: 1,
            items: { type: "integer", minimum: 1 },
            description:
              "One or more messageIndex values from the supplied clean messages."
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
              "Confidence in semantic correctness and evidence support."
          }
        }
      }
    }
  }
} as const;
