import type {
  CanonicalConversation,
  CanonicalMessage
} from "../types/conversation";
import {
  llmSemanticOutputSchema,
  type ShadowLlmResult,
  type ShadowLlmSegmentResult
} from "../types/semantic";
import type { TopicFlowItem } from "../types/structures";
import {
  createLlmShadowSegments,
  type LlmShadowSegment,
  type LlmShadowSegmentationOptions
} from "./llmShadowSegmentation";
import {
  buildShadowCoverage,
  buildShadowMetrics,
  emptyShadowMetrics,
  emptyTokenUsage,
  materializeLlmItems,
  resolveShadowStatus,
  type LlmCandidate
} from "./llmShadowResult";
import {
  buildLlmShadowPrompt,
  LLM_SHADOW_EXTRACTOR_VERSION
} from "./llmShadowPrompt";
import {
  getLlmProvider,
  type LlmProviderId,
  type LlmProviderResponse
} from "./providers";

const DEFAULT_MODELS: Record<LlmProviderId, string> = {
  gemini: "gemini-3.1-flash-lite",
  openai: "gpt-4o-mini",
  qwen: "qwen3.7-plus"
};

const DEFAULT_SEGMENT_CONCURRENCY = 3;

export type LlmShadowExtractorOptions = {
  enabled?: boolean;
  provider?: LlmProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  topicFlow?: TopicFlowItem[];
  segmentation?: Partial<LlmShadowSegmentationOptions>;
  segmentConcurrency?: number;
};

type SegmentExecution = {
  segment: LlmShadowSegment;
  candidates: LlmCandidate[];
  result: ShadowLlmSegmentResult;
};

export async function extractLlmShadow(
  conversation: CanonicalConversation,
  options: LlmShadowExtractorOptions = {}
): Promise<ShadowLlmResult> {
  const enabled =
    options.enabled ?? process.env.BLABASE_LLM_SHADOW_ENABLED === "true";
  const providerId =
    options.provider ?? resolveProviderId(process.env.BLABASE_LLM_PROVIDER);
  const apiKey = options.apiKey ?? apiKeyFor(providerId);
  const model = options.model ?? modelFor(providerId);
  const baseUrl = options.baseUrl ?? baseUrlFor(providerId);
  const cleanMessages = cleanConversationMessages(conversation);
  const segments = createLlmShadowSegments(
    conversation,
    options.topicFlow,
    resolveSegmentationOptions(options.segmentation)
  );

  if (!enabled || !apiKey) {
    return disabledResult(
      enabled ? providerId : null,
      enabled ? model : null,
      cleanMessages,
      !enabled
        ? "BLABASE_LLM_SHADOW_ENABLED is not true."
        : `${apiKeyEnvironmentName(providerId)} is not configured.`
    );
  }

  if (segments.length === 0) {
    return {
      extractorVersion: LLM_SHADOW_EXTRACTOR_VERSION,
      status: "completed",
      provider: providerId,
      model,
      items: [],
      segments: [],
      metrics: emptyShadowMetrics(),
      coverage: buildShadowCoverage(cleanMessages, [], [])
    };
  }

  const startedAt = Date.now();
  const provider = getLlmProvider(providerId);
  const fetchImpl = options.fetchImpl ?? fetch;
  const executions = await mapWithConcurrency(
    segments,
    resolveSegmentConcurrency(options.segmentConcurrency),
    (segment) =>
      executeSegment({
        segment,
        segmentCount: segments.length,
        conversationId: conversation.id,
        model,
        apiKey,
        baseUrl,
        fetchImpl,
        generateJson: provider.generateJson.bind(provider)
      })
  );

  const candidates = executions.flatMap((execution) => execution.candidates);
  const items = materializeLlmItems(candidates);
  const segmentResults = executions.map((execution) => execution.result);
  const completedCount = segmentResults.filter(
    (result) => result.status === "completed"
  ).length;
  const failedCount = segmentResults.length - completedCount;
  const status = resolveShadowStatus(completedCount, failedCount);
  const firstError = segmentResults.find((result) => result.error)?.error;

  return {
    extractorVersion: LLM_SHADOW_EXTRACTOR_VERSION,
    status,
    provider: providerId,
    model,
    items,
    segments: segmentResults,
    metrics: buildShadowMetrics(segmentResults, Date.now() - startedAt),
    coverage: buildShadowCoverage(cleanMessages, items, segmentResults),
    ...(status === "failed" && firstError ? { error: firstError } : {})
  };
}

async function executeSegment(input: {
  segment: LlmShadowSegment;
  segmentCount: number;
  conversationId: string;
  model: string;
  apiKey: string;
  baseUrl: string | undefined;
  fetchImpl: typeof fetch;
  generateJson: ReturnType<typeof getLlmProvider>["generateJson"];
}): Promise<SegmentExecution> {
  const startedAt = Date.now();
  let providerResponse: LlmProviderResponse | null = null;

  try {
    providerResponse = await input.generateJson({
      apiKey: input.apiKey,
      model: input.model,
      prompt: buildLlmShadowPrompt(
        input.conversationId,
        input.segment,
        input.segmentCount
      ),
      baseUrl: input.baseUrl,
      fetchImpl: input.fetchImpl
    });

    let decoded: unknown;
    try {
      decoded = JSON.parse(providerResponse.outputText);
    } catch {
      return failedSegment(
        input.segment,
        Date.now() - startedAt,
        "LLM_INVALID_OUTPUT",
        "Output text was not valid JSON.",
        providerResponse
      );
    }

    const parsed = llmSemanticOutputSchema.safeParse(decoded);
    if (!parsed.success) {
      return failedSegment(
        input.segment,
        Date.now() - startedAt,
        "LLM_INVALID_OUTPUT",
        "Structured output did not match the SemanticItem schema.",
        providerResponse
      );
    }

    return {
      segment: input.segment,
      candidates: parsed.data.items,
      result: segmentResult(input.segment, {
        status: "completed",
        itemCount: parsed.data.items.length,
        durationMs: Date.now() - startedAt,
        requestId: providerResponse.requestId,
        responseModel: providerResponse.responseModel,
        usage: providerResponse.usage
      })
    };
  } catch (error) {
    return failedSegment(
      input.segment,
      Date.now() - startedAt,
      "LLM_REQUEST_FAILED",
      error instanceof Error ? error.message : "Unknown LLM request failure.",
      providerResponse
    );
  }
}

function failedSegment(
  segment: LlmShadowSegment,
  durationMs: number,
  code: "LLM_REQUEST_FAILED" | "LLM_INVALID_OUTPUT",
  message: string,
  response: LlmProviderResponse | null
): SegmentExecution {
  return {
    segment,
    candidates: [],
    result: segmentResult(segment, {
      status: "failed",
      itemCount: 0,
      durationMs,
      requestId: response?.requestId ?? null,
      responseModel: response?.responseModel ?? null,
      usage: response?.usage ?? emptyTokenUsage(),
      error: { code, message }
    })
  };
}

function segmentResult(
  segment: LlmShadowSegment,
  result: Omit<
    ShadowLlmSegmentResult,
    | "id"
    | "order"
    | "label"
    | "topicIds"
    | "startMessageIndex"
    | "endMessageIndex"
    | "messageIndexes"
    | "contextMessageIndexes"
    | "inputChars"
  >
): ShadowLlmSegmentResult {
  const messageIndexes = segment.messages.map((message) => message.index);
  return {
    id: segment.id,
    order: segment.order,
    label: segment.label,
    topicIds: segment.topicIds,
    startMessageIndex: messageIndexes[0] ?? 0,
    endMessageIndex: messageIndexes.at(-1) ?? 0,
    messageIndexes,
    contextMessageIndexes: segment.contextMessages.map(
      (message) => message.index
    ),
    inputChars: segment.inputChars,
    ...result
  };
}

function disabledResult(
  provider: LlmProviderId | null,
  model: string | null,
  cleanMessages: CanonicalMessage[],
  message: string
): ShadowLlmResult {
  return {
    extractorVersion: LLM_SHADOW_EXTRACTOR_VERSION,
    status: "disabled",
    provider,
    model,
    items: [],
    segments: [],
    metrics: emptyShadowMetrics(),
    coverage: buildShadowCoverage(cleanMessages, [], []),
    error: { code: "SHADOW_DISABLED", message }
  };
}

function cleanConversationMessages(
  conversation: CanonicalConversation
): CanonicalMessage[] {
  return conversation.messages.filter(
    (message) =>
      message.metadata.messageCategory === "clean_conversation" &&
      message.metadata.semanticAnalyzable !== false
  );
}

function resolveProviderId(value: string | undefined): LlmProviderId {
  if (value === "gemini" || value === "qwen") return value;
  return "openai";
}

function apiKeyFor(provider: LlmProviderId): string | undefined {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "qwen":
      return process.env.DASHSCOPE_API_KEY;
    default:
      return process.env.OPENAI_API_KEY;
  }
}

function modelFor(provider: LlmProviderId): string {
  const configured = {
    gemini: process.env.GEMINI_MODEL,
    openai: process.env.OPENAI_MODEL,
    qwen: process.env.QWEN_MODEL
  }[provider];
  return configured ?? DEFAULT_MODELS[provider];
}

function baseUrlFor(provider: LlmProviderId): string | undefined {
  return {
    gemini: process.env.GEMINI_BASE_URL,
    openai: process.env.OPENAI_BASE_URL,
    qwen: process.env.QWEN_BASE_URL
  }[provider];
}

function apiKeyEnvironmentName(provider: LlmProviderId): string {
  return {
    gemini: "GEMINI_API_KEY",
    openai: "OPENAI_API_KEY",
    qwen: "DASHSCOPE_API_KEY"
  }[provider];
}

function resolveSegmentationOptions(
  overrides: Partial<LlmShadowSegmentationOptions> | undefined
): Partial<LlmShadowSegmentationOptions> {
  return {
    maxCharsPerSegment:
      overrides?.maxCharsPerSegment ??
      positiveIntegerFromEnvironment("BLABASE_LLM_SEGMENT_MAX_CHARS"),
    maxMessagesPerSegment:
      overrides?.maxMessagesPerSegment ??
      positiveIntegerFromEnvironment("BLABASE_LLM_SEGMENT_MAX_MESSAGES"),
    maxSegments:
      overrides?.maxSegments ??
      positiveIntegerFromEnvironment("BLABASE_LLM_SEGMENT_MAX_COUNT")
  };
}

function resolveSegmentConcurrency(value: number | undefined): number {
  return clamp(
    value ??
      positiveIntegerFromEnvironment("BLABASE_LLM_SEGMENT_CONCURRENCY") ??
      DEFAULT_SEGMENT_CONCURRENCY,
    1,
    4
  );
}

function positiveIntegerFromEnvironment(name: string): number | undefined {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.floor(value), minimum), maximum);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const value = values[currentIndex];
      if (value !== undefined) results[currentIndex] = await mapper(value);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}
