import {
  LlmProviderError,
  type LlmProviderRequest,
  type LlmProviderResponse,
  type LlmShadowProvider
} from "./types";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const qwenProvider: LlmShadowProvider = {
  id: "qwen",
  async generateJson(
    request: LlmProviderRequest
  ): Promise<LlmProviderResponse> {
    const response = await request.fetchImpl(
      `${trimTrailingSlash(request.baseUrl ?? DEFAULT_BASE_URL)}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            {
              role: "system",
              content:
                "Return only a valid JSON object matching the requested TIV semantic item shape."
            },
            { role: "user", content: request.prompt }
          ],
          response_format: { type: "json_object" },
          enable_thinking: false
        })
      }
    );

    if (!response.ok) {
      throw new LlmProviderError(
        "qwen",
        response.status,
        `Qwen API returned HTTP ${response.status}.`
      );
    }

    const payload = (await response.json()) as unknown;
    const content = readQwenContent(payload);
    if (!content) {
      throw new LlmProviderError(
        "qwen",
        null,
        "Qwen response had no message content."
      );
    }
    const record = payload as Record<string, unknown>;
    const usage = readRecord(record.usage);
    return {
      outputText: content,
      requestId: readString(record.id) ?? readString(record.request_id),
      responseModel: readString(record.model),
      usage: {
        inputTokens: readNumber(usage?.prompt_tokens),
        outputTokens: readNumber(usage?.completion_tokens),
        totalTokens: readNumber(usage?.total_tokens),
        cachedInputTokens: readNumber(usage?.prompt_cache_hit_tokens),
        thoughtTokens: null
      }
    };
  }
};

function readQwenContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
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
