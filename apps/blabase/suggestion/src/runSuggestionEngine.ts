import { randomUUID } from "node:crypto";

import { rawTaskOutputSchema } from "./schema";
import { buildTaskCandidatePrompt } from "./prompt";
import {
  addUsage,
  generateTaskCandidates,
  readSuggestionProviderConfig,
  SuggestionProviderError,
  type SuggestionProviderConfig
} from "./provider";
import { mergeTaskLineage } from "./mergeTaskLineage";
import { scorePriority } from "./scorePriority";
import {
  MINIMUM_SUGGESTION_SCORE,
  selectSuggestion
} from "./selectSuggestion";
import type {
  PrioritySuggestionResult,
  ProviderUsage,
  RestoredConversation,
  SuggestionProviderId,
  SourceStatus,
  VerifiedTaskCandidate
} from "./types";
import { verifyTaskCandidates } from "./verifyCandidates";
import {
  PRIORITY_SCORING_VERSION,
  SUGGESTION_ENGINE_VERSION,
  SUGGESTION_SCHEMA_VERSION,
  TASK_CANDIDATE_PROMPT_VERSION,
  TASK_EVIDENCE_VERIFIER_VERSION
} from "./versions";

const EXTRACTION_CONCURRENCY = 3;

export class SuggestionEngineError extends Error {
  constructor(
    public readonly code:
      | "NOT_ENOUGH_RESTORED_CONVERSATIONS"
      | "NOT_ENOUGH_SUCCESSFUL_EXTRACTIONS"
      | "EXTRACTION_INPUT_MISMATCH"
      | "INVALID_LLM_OUTPUT",
    message: string,
    public readonly diagnostics: Array<{
      inputIndex: number;
      code: string;
    }> = []
  ) {
    super(message);
    this.name = "SuggestionEngineError";
  }
}

export type SuggestionCandidateExtraction = Readonly<{
  status: "completed" | "failed";
  inputIndex: number;
  conversationId: string;
  failureCode: string | null;
  candidates: VerifiedTaskCandidate[];
  usage: ProviderUsage;
}>;

export async function runSuggestionEngine(input: {
  restored: RestoredConversation[];
  sources: SourceStatus[];
  now?: () => string;
  providerConfig?: SuggestionProviderConfig;
  fetchImpl?: typeof fetch;
}): Promise<PrioritySuggestionResult> {
  if (input.restored.length < 3) {
    throw new SuggestionEngineError(
      "NOT_ENOUGH_RESTORED_CONVERSATIONS",
      "복원에 성공한 고유 대화가 3개 이상 필요합니다."
    );
  }

  const now = input.now?.() ?? new Date().toISOString();
  const providerConfig =
    input.providerConfig ?? readSuggestionProviderConfig();
  const startedAt = now;
  const extractionResults = await extractSuggestionCandidates({
    restored: input.restored,
    analysisTimestamp: now,
    providerConfig,
    fetchImpl: input.fetchImpl
  });
  const completedAt = input.now?.() ?? new Date().toISOString();

  return resolveSuggestionCandidates({
    restored: input.restored,
    sources: input.sources,
    extractionResults,
    provider: providerConfig.id,
    model: providerConfig.model,
    analysisTimestamp: now,
    startedAt,
    completedAt
  });
}

export async function extractSuggestionCandidates(input: {
  restored: RestoredConversation[];
  analysisTimestamp: string;
  providerConfig: SuggestionProviderConfig;
  fetchImpl?: typeof fetch;
}): Promise<SuggestionCandidateExtraction[]> {
  return mapWithConcurrency(
    input.restored,
    EXTRACTION_CONCURRENCY,
    async (restored) => {
      try {
        const prompt = buildTaskCandidatePrompt(
          restored.conversation,
          input.analysisTimestamp
        );
        const response = await generateTaskCandidates(
          input.providerConfig,
          prompt.prompt,
          input.fetchImpl
        );
        const parsedJson = parseJsonObject(response.outputText);
        const parsed = rawTaskOutputSchema.safeParse(parsedJson);
        if (!parsed.success) {
          return {
            status: "failed" as const,
            inputIndex: restored.inputIndex,
            conversationId: restored.conversation.id,
            failureCode: "LLM_SCHEMA_INVALID",
            candidates: [] as VerifiedTaskCandidate[],
            usage: response.usage
          };
        }
        return {
          status: "completed" as const,
          inputIndex: restored.inputIndex,
          conversationId: restored.conversation.id,
          failureCode: null,
          candidates: verifyTaskCandidates(
            restored.conversation,
            parsed.data.candidates,
            restored.sourceContext
          ),
          usage: response.usage
        };
      } catch (error) {
        return {
          status: "failed" as const,
          inputIndex: restored.inputIndex,
          conversationId: restored.conversation.id,
          failureCode:
            error instanceof SuggestionProviderError
              ? error.code
              : "LLM_EXTRACTION_FAILED",
          candidates: [] as VerifiedTaskCandidate[],
          usage: emptyUsage()
        };
      }
    }
  );
}

export function resolveSuggestionCandidates(input: {
  restored: RestoredConversation[];
  sources: SourceStatus[];
  extractionResults: readonly SuggestionCandidateExtraction[];
  provider: SuggestionProviderId;
  model: string;
  analysisTimestamp: string;
  startedAt: string;
  completedAt: string;
}): PrioritySuggestionResult {
  if (input.restored.length < 3) {
    throw new SuggestionEngineError(
      "NOT_ENOUGH_RESTORED_CONVERSATIONS",
      "복원에 성공한 고유 대화가 3개 이상 필요합니다."
    );
  }

  const extractionResults = orderExtractionResults(
    input.restored,
    input.extractionResults
  );
  const successfulExtractions = extractionResults.filter(
    (result) => result.status === "completed"
  );

  if (successfulExtractions.length < 3) {
    throw new SuggestionEngineError(
      "NOT_ENOUGH_SUCCESSFUL_EXTRACTIONS",
      "LLM 분석에 성공한 대화가 3개 미만이라 안전한 제안을 만들 수 없습니다.",
      extractionResults
        .filter((result) => result.status === "failed")
        .map((result) => ({
          inputIndex: result.inputIndex,
          code: result.failureCode ?? "LLM_EXTRACTION_FAILED"
        }))
    );
  }

  const verified = successfulExtractions.flatMap(
    (result) => result.candidates
  );
  const merged = mergeTaskLineage(verified);
  const assessments = merged.map((candidate) =>
    scorePriority(candidate, input.analysisTimestamp)
  );
  const selection = selectSuggestion(merged, assessments);
  const decisionDiagnostics = {
    mergedCandidateCount: merged.length,
    eligibleCount: assessments.filter(
      (assessment) => assessment.eligibility === "eligible"
    ).length,
    reviewRequiredCount: assessments.filter(
      (assessment) => assessment.eligibility === "review_required"
    ).length,
    ineligibleCount: assessments.filter(
      (assessment) => assessment.eligibility === "ineligible"
    ).length,
    highestEligibleScore:
      assessments
        .filter((assessment) => assessment.eligibility === "eligible")
        .sort((left, right) => right.score - left.score)[0]?.score ?? null,
    minimumSuggestionScore: MINIMUM_SUGGESTION_SCORE,
    reasonCounts: countValues(
      assessments.flatMap((assessment) => assessment.reasonCodes)
    ),
    verificationIssueCounts: countValues(
      merged.flatMap((candidate) => candidate.verificationIssues)
    )
  };
  const usage = extractionResults.reduce(
    (total, result) => addUsage(total, result.usage),
    emptyUsage()
  );

  return {
    ...selection,
    decisionDiagnostics,
    sources: input.sources,
    run: {
      runId: `sgr_${randomUUID()}`,
      engineVersion: SUGGESTION_ENGINE_VERSION,
      schemaVersion: SUGGESTION_SCHEMA_VERSION,
      promptVersion: TASK_CANDIDATE_PROMPT_VERSION,
      verifierVersion: TASK_EVIDENCE_VERIFIER_VERSION,
      scoringVersion: PRIORITY_SCORING_VERSION,
      provider: input.provider,
      model: input.model,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      sourceCount: input.restored.length,
      candidateCount: merged.length,
      eligibleCount: assessments.filter(
        (assessment) => assessment.eligibility === "eligible"
      ).length,
      requestCount: extractionResults.length,
      failedRequestCount: extractionResults.filter(
        (result) => result.status === "failed"
      ).length,
      usage
    }
  };
}

function orderExtractionResults(
  restored: RestoredConversation[],
  extractionResults: readonly SuggestionCandidateExtraction[]
): SuggestionCandidateExtraction[] {
  const bySource = new Map<string, SuggestionCandidateExtraction>();
  for (const result of extractionResults) {
    const key = `${result.inputIndex}|${result.conversationId}`;
    if (bySource.has(key)) {
      throw new SuggestionEngineError(
        "EXTRACTION_INPUT_MISMATCH",
        "동일한 복원 입력에 추출 결과가 중복 연결되었습니다.",
        [{ inputIndex: result.inputIndex, code: "DUPLICATE_EXTRACTION" }]
      );
    }
    bySource.set(key, result);
  }
  const ordered = restored.map((value) => {
    const key = `${value.inputIndex}|${value.conversation.id}`;
    const result = bySource.get(key);
    if (!result) {
      throw new SuggestionEngineError(
        "EXTRACTION_INPUT_MISMATCH",
        "복원 입력과 추출 결과를 정확히 연결할 수 없습니다.",
        [{ inputIndex: value.inputIndex, code: "MISSING_EXTRACTION" }]
      );
    }
    bySource.delete(key);
    return result;
  });
  if (bySource.size > 0 || ordered.length !== extractionResults.length) {
    throw new SuggestionEngineError(
      "EXTRACTION_INPUT_MISMATCH",
      "요청에 포함되지 않은 추출 결과가 전달되었습니다."
    );
  }
  return ordered;
}

function countValues(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fenced) return null;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return null;
    }
  }
}

function emptyUsage(): ProviderUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker()
    )
  );
  return output;
}
