import { LLM_SEMANTIC_JSON_SCHEMA } from "../../types/semantic";
import {
  LlmProviderError,
  type LlmProviderRequest,
  type LlmProviderResponse,
  type LlmShadowProvider
} from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const openAiProvider: LlmShadowProvider = {
  id: "openai",
  async generateJson(
    request: LlmProviderRequest
  ): Promise<LlmProviderResponse> {
    const response = await request.fetchImpl(
      `${trimTrailingSlash(request.baseUrl ?? DEFAULT_BASE_URL)}/responses`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          store: false,
          input: request.prompt,
          text: {
            format: {
              type: "json_schema",
              name: "blabase_semantic_items",
              strict: true,
              schema: LLM_SEMANTIC_JSON_SCHEMA
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new LlmProviderError(
        "openai",
        response.status,
        `OpenAI Responses API returned HTTP ${response.status}.`
      );
    }

    const payload = (await response.json()) as unknown;
    const outputText = readResponseOutputText(payload);
    if (!outputText) {
      throw new LlmProviderError(
        "openai",
        null,
        "Response had no output text."
      );
    }
    const record = payload as Record<string, unknown>;
    return {
      outputText,
      requestId: readString(record.id),
      responseModel: readString(record.model),
      usage: readOpenAiUsage(record.usage)
    };
  }
};

function readOpenAiUsage(value: unknown) {
  const usage = readRecord(value);
  return {
    inputTokens: readNumber(usage?.input_tokens),
    outputTokens: readNumber(usage?.output_tokens),
    totalTokens: readNumber(usage?.total_tokens),
    cachedInputTokens: readNumber(
      readRecord(usage?.input_tokens_details)?.cached_tokens
    ),
    thoughtTokens: readNumber(
      readRecord(usage?.output_tokens_details)?.reasoning_tokens
    )
  };
}

function readResponseOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return null;
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
