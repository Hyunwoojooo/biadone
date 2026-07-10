import type { CanonicalConversation } from "../types/conversation";
import {
  llmSemanticOutputSchema,
  type SemanticItem,
  type ShadowLlmResult
} from "../types/semantic";

const DEFAULT_MODEL = "gpt-4o-mini";
const RESPONSES_API_URL = "https://api.openai.com/v1/responses";

export type LlmShadowExtractorOptions = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
};

export async function extractLlmShadow(
  conversation: CanonicalConversation,
  options: LlmShadowExtractorOptions = {}
): Promise<ShadowLlmResult> {
  const enabled = options.enabled ?? process.env.TIV_LLM_SHADOW_ENABLED === "true";
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;

  if (!enabled || !apiKey) {
    return {
      status: "disabled",
      model: enabled ? model : null,
      items: [],
      error: {
        code: "SHADOW_DISABLED",
        message: !enabled
          ? "TIV_LLM_SHADOW_ENABLED is not true."
          : "OPENAI_API_KEY is not configured."
      }
    };
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(RESPONSES_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        store: false,
        input: buildShadowPrompt(conversation),
        text: {
          format: {
            type: "json_schema",
            name: "tiv_semantic_items",
            strict: true,
            schema: LLM_SEMANTIC_JSON_SCHEMA
          }
        }
      })
    });

    if (!response.ok) {
      return failedResult(
        model,
        "LLM_REQUEST_FAILED",
        `OpenAI Responses API returned HTTP ${response.status}.`
      );
    }

    const payload = (await response.json()) as unknown;
    const outputText = readResponseOutputText(payload);
    if (!outputText) {
      return failedResult(model, "LLM_INVALID_OUTPUT", "Response had no output text.");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(outputText);
    } catch {
      return failedResult(model, "LLM_INVALID_OUTPUT", "Output text was not valid JSON.");
    }
    const parsed = llmSemanticOutputSchema.safeParse(decoded);
    if (!parsed.success) {
      return failedResult(
        model,
        "LLM_INVALID_OUTPUT",
        "Structured output did not match the SemanticItem schema."
      );
    }

    const items: SemanticItem[] = parsed.data.items.map((item, index) => ({
      ...item,
      id: `llm_${item.type}_${String(index + 1).padStart(3, "0")}`,
      source: "llm",
      sourceItemId: null,
      reviewRequired: true
    }));

    return { status: "completed", model, items };
  } catch (error) {
    return failedResult(
      model,
      "LLM_REQUEST_FAILED",
      error instanceof Error ? error.message : "Unknown LLM request failure."
    );
  }
}

function buildShadowPrompt(conversation: CanonicalConversation): string {
  const messages = conversation.messages
    .filter(
      (message) =>
        message.metadata.messageCategory === "clean_conversation" &&
        message.metadata.semanticAnalyzable !== false
    )
    .map((message) => ({
      messageIndex: message.index,
      messageId: message.id,
      role: message.role,
      text: message.text
    }));

  return [
    "You are the TIV semantic extraction shadow model.",
    "Extract conservative semantic candidates from only the clean conversation JSON below.",
    "Do not treat examples, code, tool operations, or assistant-only suggestions as confirmed user decisions.",
    "Every item must cite one or more messageIndex values present in the input.",
    "Use null for status, category, or triggerPhrase when not applicable.",
    "All LLM items are review candidates; do not decide Main Board eligibility.",
    JSON.stringify({ conversationId: conversation.id, messages })
  ].join("\n\n");
}

function readResponseOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  if (!Array.isArray(record.output)) {
    return null;
  }
  for (const output of record.output) {
    if (!output || typeof output !== "object") continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function failedResult(
  model: string,
  code: "LLM_REQUEST_FAILED" | "LLM_INVALID_OUTPUT",
  message: string
): ShadowLlmResult {
  return { status: "failed", model, items: [], error: { code, message } };
}

const nullableString = { type: ["string", "null"] } as const;

const LLM_SEMANTIC_JSON_SCHEMA = {
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
            enum: [
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
            ]
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
