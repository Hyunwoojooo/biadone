import { LLM_SEMANTIC_JSON_SCHEMA } from "../../types/semantic";
import {
  LlmProviderError,
  type LlmProviderRequest,
  type LlmShadowProvider
} from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1";

export const geminiProvider: LlmShadowProvider = {
  id: "gemini",
  async generateJson(request: LlmProviderRequest): Promise<string> {
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
            "Return only structured TIV semantic candidates that match the provided JSON schema.",
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
    return outputText;
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
