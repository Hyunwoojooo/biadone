import { LLM_SEMANTIC_JSON_SCHEMA } from "../../types/semantic";
import {
  LlmProviderError,
  type LlmProviderRequest,
  type LlmShadowProvider
} from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const openAiProvider: LlmShadowProvider = {
  id: "openai",
  async generateJson(request: LlmProviderRequest): Promise<string> {
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
              name: "tiv_semantic_items",
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
      throw new LlmProviderError("openai", null, "Response had no output text.");
    }
    return outputText;
  }
};

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
