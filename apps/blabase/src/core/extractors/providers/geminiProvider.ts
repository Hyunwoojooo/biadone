import { LLM_SEMANTIC_JSON_SCHEMA } from "../../types/semantic";
import {
  LlmProviderError,
  type LlmProviderRequest,
  type LlmProviderResponse,
  type LlmShadowProvider
} from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1";

export const geminiProvider: LlmShadowProvider = {
  id: "gemini",
  async generateJson(
    request: LlmProviderRequest
  ): Promise<LlmProviderResponse> {
    const response = await request.fetchImpl(
      `${trimTrailingSlash(request.baseUrl ?? DEFAULT_BASE_URL)}/interactions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": request.apiKey
        },
        body: JSON.stringify({
          model: request.model,
          input: request.prompt,
          system_instruction:
            "Return only structured blabase semantic candidates that match the provided JSON schema.",
          store: false,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: LLM_SEMANTIC_JSON_SCHEMA
          },
          generation_config: {
            thinking_level: "minimal",
            thinking_summaries: "none"
          }
        })
      }
    );

    if (!response.ok) {
      throw new LlmProviderError(
        "gemini",
        response.status,
        `Gemini Interactions API returned HTTP ${response.status}.`
      );
    }

    const payload = (await response.json()) as unknown;
    const outputText = readGeminiOutputText(payload);
    if (!outputText) {
      throw new LlmProviderError(
        "gemini",
        null,
        "Gemini response had no output text."
      );
    }
    const record = payload as Record<string, unknown>;
    const usage = readRecord(record.usage);
    return {
      outputText,
      requestId: readString(record.id),
      responseModel: readString(record.model),
      usage: {
        inputTokens: readNumber(usage?.total_input_tokens),
        outputTokens: readNumber(usage?.total_output_tokens),
        totalTokens: readNumber(usage?.total_tokens),
        cachedInputTokens: readNumber(usage?.total_cached_tokens),
        thoughtTokens: readNumber(usage?.total_thought_tokens)
      }
    };
  }
};

function readGeminiOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.steps)) return null;

  for (let index = record.steps.length - 1; index >= 0; index -= 1) {
    const step = record.steps[index];
    if (!step || typeof step !== "object") continue;
    const stepRecord = step as Record<string, unknown>;
    if (
      stepRecord.type !== "model_output" ||
      !Array.isArray(stepRecord.content)
    )
      continue;

    const text = stepRecord.content
      .filter((part): part is Record<string, unknown> =>
        Boolean(part && typeof part === "object")
      )
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");
    if (text) return text;
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
