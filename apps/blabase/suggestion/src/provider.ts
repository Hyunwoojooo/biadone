import { TASK_CANDIDATE_JSON_SCHEMA } from "./schema";
import type {
  ProviderResponse,
  ProviderUsage,
  SuggestionProviderId
} from "./types";

export type SuggestionProviderConfig = {
  id: SuggestionProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export class SuggestionProviderError extends Error {
  constructor(
    public readonly code:
      | "PROVIDER_NOT_CONFIGURED"
      | "PROVIDER_REQUEST_FAILED"
      | "PROVIDER_INVALID_RESPONSE",
    message: string
  ) {
    super(message);
    this.name = "SuggestionProviderError";
  }
}

export function readSuggestionProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): SuggestionProviderConfig {
  const id = (env.BLABASE_SUGGESTION_PROVIDER ??
    env.BLABASE_LLM_PROVIDER ??
    "gemini") as SuggestionProviderId;

  if (!["gemini", "openai", "qwen"].includes(id)) {
    throw new SuggestionProviderError(
      "PROVIDER_NOT_CONFIGURED",
      `지원하지 않는 suggestion provider입니다: ${id}`
    );
  }

  const configByProvider = {
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      model:
        env.BLABASE_SUGGESTION_MODEL ??
        env.GEMINI_MODEL ??
        "gemini-3.1-flash-lite",
      baseUrl: env.GEMINI_BASE_URL
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      model:
        env.BLABASE_SUGGESTION_MODEL ?? env.OPENAI_MODEL ?? "gpt-5-mini",
      baseUrl: env.OPENAI_BASE_URL
    },
    qwen: {
      apiKey: env.DASHSCOPE_API_KEY,
      model:
        env.BLABASE_SUGGESTION_MODEL ?? env.QWEN_MODEL ?? "qwen3.5-flash",
      baseUrl: env.QWEN_BASE_URL
    }
  } satisfies Record<
    SuggestionProviderId,
    { apiKey: string | undefined; model: string; baseUrl: string | undefined }
  >;
  const selected = configByProvider[id];

  if (!selected.apiKey) {
    throw new SuggestionProviderError(
      "PROVIDER_NOT_CONFIGURED",
      `${id} API key가 설정되지 않았습니다.`
    );
  }

  return {
    id,
    apiKey: selected.apiKey,
    model: selected.model,
    baseUrl: selected.baseUrl
  };
}

export async function generateTaskCandidates(
  config: SuggestionProviderConfig,
  prompt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderResponse> {
  switch (config.id) {
    case "gemini":
      return generateGemini(config, prompt, fetchImpl);
    case "openai":
      return generateOpenAi(config, prompt, fetchImpl);
    case "qwen":
      return generateQwen(config, prompt, fetchImpl);
  }
}

const PROVIDER_TIMEOUT_MS = 45_000;

async function generateGemini(
  config: SuggestionProviderConfig,
  prompt: string,
  fetchImpl: typeof fetch
): Promise<ProviderResponse> {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${trimSlash(config.baseUrl ?? "https://generativelanguage.googleapis.com/v1")}/interactions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": config.apiKey
      },
      body: JSON.stringify({
        model: config.model,
        input: prompt,
        system_instruction:
          "Return only JSON matching the supplied task candidate schema.",
        store: false,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: TASK_CANDIDATE_JSON_SCHEMA
        },
        generation_config: {
          thinking_level: "minimal",
          thinking_summaries: "none"
        }
      })
    }
  );
  const payload = await readPayload(response, "Gemini");
  const outputText =
    readString(payload.output_text) ?? readGeminiStepText(payload.steps);
  if (!outputText) invalidResponse("Gemini");
  const usage = readRecord(payload.usage);

  return {
    outputText,
    requestId: readString(payload.id),
    responseModel: readString(payload.model),
    usage: {
      inputTokens: readNumber(usage?.total_input_tokens),
      outputTokens: readNumber(usage?.total_output_tokens),
      totalTokens: readNumber(usage?.total_tokens)
    }
  };
}

async function generateOpenAi(
  config: SuggestionProviderConfig,
  prompt: string,
  fetchImpl: typeof fetch
): Promise<ProviderResponse> {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${trimSlash(config.baseUrl ?? "https://api.openai.com/v1")}/responses`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        store: false,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "blabase_task_candidates",
            strict: true,
            schema: TASK_CANDIDATE_JSON_SCHEMA
          }
        }
      })
    }
  );
  const payload = await readPayload(response, "OpenAI");
  const outputText =
    readString(payload.output_text) ?? readOpenAiOutputText(payload.output);
  if (!outputText) invalidResponse("OpenAI");
  const usage = readRecord(payload.usage);

  return {
    outputText,
    requestId: readString(payload.id),
    responseModel: readString(payload.model),
    usage: {
      inputTokens: readNumber(usage?.input_tokens),
      outputTokens: readNumber(usage?.output_tokens),
      totalTokens: readNumber(usage?.total_tokens)
    }
  };
}

async function generateQwen(
  config: SuggestionProviderConfig,
  prompt: string,
  fetchImpl: typeof fetch
): Promise<ProviderResponse> {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${trimSlash(config.baseUrl ?? "https://dashscope.aliyuncs.com/compatible-mode/v1")}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "system",
            content:
              "Return only a JSON object matching the requested task candidate schema."
          },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        enable_thinking: false
      })
    }
  );
  const payload = await readPayload(response, "Qwen");
  const outputText = readQwenOutputText(payload.choices);
  if (!outputText) invalidResponse("Qwen");
  const usage = readRecord(payload.usage);

  return {
    outputText,
    requestId: readString(payload.id) ?? readString(payload.request_id),
    responseModel: readString(payload.model),
    usage: {
      inputTokens: readNumber(usage?.prompt_tokens),
      outputTokens: readNumber(usage?.completion_tokens),
      totalTokens: readNumber(usage?.total_tokens)
    }
  };
}

async function readPayload(
  response: Response,
  providerName: string
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const detail = await readProviderErrorDetail(response);
    throw new SuggestionProviderError(
      "PROVIDER_REQUEST_FAILED",
      `${providerName} API 요청이 실패했습니다. (HTTP ${response.status})${detail ? ` ${detail}` : ""}`
    );
  }
  const payload = (await response.json()) as unknown;
  const record = readRecord(payload);
  if (!record) invalidResponse(providerName);
  return record;
}

async function readProviderErrorDetail(
  response: Response
): Promise<string | null> {
  try {
    const text = await response.text();
    const payload = readRecord(JSON.parse(text));
    const error = readRecord(payload?.error);
    const message =
      readString(error?.message) ??
      readString(payload?.message) ??
      readString(error?.status);
    if (!message) return null;
    return message.replace(/\s+/g, " ").trim().slice(0, 600);
  } catch {
    return null;
  }
}

function invalidResponse(providerName: string): never {
  throw new SuggestionProviderError(
    "PROVIDER_INVALID_RESPONSE",
    `${providerName} 응답에서 구조화된 결과를 찾지 못했습니다.`
  );
}

function readGeminiStepText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const step = readRecord(value[index]);
    if (!step || !Array.isArray(step.content)) continue;
    const text = step.content
      .map(readRecord)
      .filter((part): part is Record<string, unknown> => Boolean(part))
      .filter((part) => part.type === "text")
      .map((part) => readString(part.text) ?? "")
      .join("");
    if (text) return text;
  }
  return null;
}

function readOpenAiOutputText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const record = readRecord(item);
    if (!record || !Array.isArray(record.content)) continue;
    for (const part of record.content) {
      const text = readString(readRecord(part)?.text);
      if (text) return text;
    }
  }
  return null;
}

function readQwenOutputText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const first = readRecord(value[0]);
  return readString(readRecord(first?.message)?.content);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new SuggestionProviderError(
        "PROVIDER_REQUEST_FAILED",
        "LLM API 요청 시간이 초과되었습니다."
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

export function addUsage(
  total: ProviderUsage,
  value: ProviderUsage
): ProviderUsage {
  return {
    inputTokens: addNullable(total.inputTokens, value.inputTokens),
    outputTokens: addNullable(total.outputTokens, value.outputTokens),
    totalTokens: addNullable(total.totalTokens, value.totalTokens)
  };
}

function addNullable(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}
