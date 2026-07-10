import type { CanonicalConversation } from "../types/conversation";
import {
  llmSemanticOutputSchema,
  type SemanticItem,
  type ShadowLlmResult
} from "../types/semantic";
import {
  getLlmProvider,
  type LlmProviderId
} from "./providers";

const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  openai: "gpt-4o-mini",
  qwen: "qwen3.7-plus"
};

export type LlmShadowExtractorOptions = {
  enabled?: boolean;
  provider?: LlmProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export async function extractLlmShadow(
  conversation: CanonicalConversation,
  options: LlmShadowExtractorOptions = {}
): Promise<ShadowLlmResult> {
  const enabled = options.enabled ?? process.env.TIV_LLM_SHADOW_ENABLED === "true";
  const providerId = options.provider ?? resolveProviderId(process.env.TIV_LLM_PROVIDER);
  const apiKey = options.apiKey ?? apiKeyFor(providerId);
  const model = options.model ?? modelFor(providerId);
  const baseUrl = options.baseUrl ?? baseUrlFor(providerId);

  if (!enabled || !apiKey) {
    return {
      status: "disabled",
      provider: enabled ? providerId : null,
      model: enabled ? model : null,
      items: [],
      error: {
        code: "SHADOW_DISABLED",
        message: !enabled
          ? "TIV_LLM_SHADOW_ENABLED is not true."
          : `${apiKeyEnvironmentName(providerId)} is not configured.`
      }
    };
  }

  try {
    const outputText = await getLlmProvider(providerId).generateJson({
      apiKey,
      model,
      prompt: buildShadowPrompt(conversation),
      baseUrl,
      fetchImpl: options.fetchImpl ?? fetch
    });

    let decoded: unknown;
    try {
      decoded = JSON.parse(outputText);
    } catch {
      return failedResult(providerId, model, "LLM_INVALID_OUTPUT", "Output text was not valid JSON.");
    }
    const parsed = llmSemanticOutputSchema.safeParse(decoded);
    if (!parsed.success) {
      return failedResult(
        providerId,
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

    return { status: "completed", provider: providerId, model, items };
  } catch (error) {
    return failedResult(
      providerId,
      model,
      "LLM_REQUEST_FAILED",
      error instanceof Error ? error.message : "Unknown LLM request failure."
    );
  }
}

function resolveProviderId(value: string | undefined): LlmProviderId {
  return value === "qwen" ? "qwen" : "openai";
}

function apiKeyFor(provider: LlmProviderId): string | undefined {
  return provider === "qwen" ? process.env.DASHSCOPE_API_KEY : process.env.OPENAI_API_KEY;
}

function modelFor(provider: LlmProviderId): string {
  const configured =
    provider === "qwen" ? process.env.QWEN_MODEL : process.env.OPENAI_MODEL;
  return configured ?? DEFAULT_MODELS[provider];
}

function baseUrlFor(provider: LlmProviderId): string | undefined {
  return provider === "qwen" ? process.env.QWEN_BASE_URL : process.env.OPENAI_BASE_URL;
}

function apiKeyEnvironmentName(provider: LlmProviderId): string {
  return provider === "qwen" ? "DASHSCOPE_API_KEY" : "OPENAI_API_KEY";
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

function failedResult(
  provider: LlmProviderId,
  model: string,
  code: "LLM_REQUEST_FAILED" | "LLM_INVALID_OUTPUT",
  message: string
): ShadowLlmResult {
  return { status: "failed", provider, model, items: [], error: { code, message } };
}
