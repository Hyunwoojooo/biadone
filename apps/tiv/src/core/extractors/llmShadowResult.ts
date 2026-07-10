import type { CanonicalMessage } from "../types/conversation";
import {
  semanticItemTypeSchema,
  type LlmSemanticOutput,
  type LlmTokenUsage,
  type SemanticItem,
  type SemanticItemType,
  type ShadowLlmCoverage,
  type ShadowLlmMetrics,
  type ShadowLlmResult,
  type ShadowLlmSegmentResult
} from "../types/semantic";

export type LlmCandidate = LlmSemanticOutput["items"][number];

export function materializeLlmItems(
  candidates: LlmCandidate[]
): SemanticItem[] {
  const deduped = new Map<string, LlmCandidate>();

  for (const candidate of candidates) {
    const key = [
      candidate.type,
      normalizeKey(candidate.status),
      normalizeKey(candidate.triggerPhrase ?? candidate.label),
      [...candidate.evidenceMessageIndexes]
        .sort((left, right) => left - right)
        .join(",")
    ].join("|");
    const existing = deduped.get(key);
    if (!existing || candidate.confidence > existing.confidence)
      deduped.set(key, candidate);
  }

  return [...deduped.values()].map((item, index) => ({
    ...item,
    id: `llm_${item.type}_${String(index + 1).padStart(3, "0")}`,
    source: "llm",
    sourceItemId: null,
    reviewRequired: true
  }));
}

export function buildShadowMetrics(
  segments: ShadowLlmSegmentResult[],
  totalDurationMs: number
): ShadowLlmMetrics {
  const usage = segments.reduce(
    (total, segment) => {
      if (Object.values(segment.usage).some((value) => value !== null)) {
        total.reportedRequestCount += 1;
      }
      total.inputTokens += segment.usage.inputTokens ?? 0;
      total.outputTokens += segment.usage.outputTokens ?? 0;
      total.totalTokens += segment.usage.totalTokens ?? 0;
      total.cachedInputTokens += segment.usage.cachedInputTokens ?? 0;
      total.thoughtTokens += segment.usage.thoughtTokens ?? 0;
      return total;
    },
    {
      reportedRequestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      thoughtTokens: 0
    }
  );

  return {
    requestCount: segments.length,
    completedRequestCount: segments.filter(
      (segment) => segment.status === "completed"
    ).length,
    failedRequestCount: segments.filter(
      (segment) => segment.status === "failed"
    ).length,
    totalDurationMs,
    providerDurationMs: segments.reduce(
      (sum, segment) => sum + segment.durationMs,
      0
    ),
    usage
  };
}

export function emptyShadowMetrics(totalDurationMs = 0): ShadowLlmMetrics {
  return buildShadowMetrics([], totalDurationMs);
}

export function buildShadowCoverage(
  cleanMessages: CanonicalMessage[],
  items: SemanticItem[],
  segments: ShadowLlmSegmentResult[]
): ShadowLlmCoverage {
  const cleanIndexes = new Set(cleanMessages.map((message) => message.index));
  const representedMessageIndexes = [
    ...new Set(
      items
        .flatMap((item) => item.evidenceMessageIndexes)
        .filter((index) => cleanIndexes.has(index))
    )
  ].sort((left, right) => left - right);
  const invalidEvidenceItemIds = items
    .filter((item) =>
      item.evidenceMessageIndexes.some((index) => !cleanIndexes.has(index))
    )
    .map((item) => item.id);
  const semanticTypeCounts = items.reduce<
    Partial<Record<SemanticItemType, number>>
  >((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {});
  const analyzedMessageIndexes = new Set(
    segments.flatMap((segment) => segment.messageIndexes)
  );

  return {
    cleanMessageCount: cleanMessages.length,
    analyzedMessageCount: analyzedMessageIndexes.size,
    segmentCount: segments.length,
    semanticTypeCounts,
    representedMessageIndexes,
    evidenceMessageCoverageRatio:
      cleanMessages.length === 0
        ? 0
        : Number(
            (representedMessageIndexes.length / cleanMessages.length).toFixed(4)
          ),
    unrepresentedSemanticTypes: semanticItemTypeSchema.options.filter(
      (type) => !semanticTypeCounts[type]
    ),
    invalidEvidenceItemIds
  };
}

export function emptyTokenUsage(): LlmTokenUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    thoughtTokens: null
  };
}

export function resolveShadowStatus(
  completedCount: number,
  failedCount: number
): ShadowLlmResult["status"] {
  if (failedCount === 0) return "completed";
  if (completedCount === 0) return "failed";
  return "partial";
}

function normalizeKey(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
