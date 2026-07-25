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
  const extractionResults = await mapWithConcurrency(
    input.restored,
    EXTRACTION_CONCURRENCY,
    async (restored) => {
      try {
        const prompt = buildTaskCandidatePrompt(restored.conversation, now);
        const response = await generateTaskCandidates(
          providerConfig,
          prompt.prompt,
          input.fetchImpl
        );
        const parsedJson = parseJsonObject(response.outputText);
        const parsed = rawTaskOutputSchema.safeParse(parsedJson);
        if (!parsed.success) {
          return {
            status: "failed" as const,
            inputIndex: restored.inputIndex,
            failureCode: "LLM_SCHEMA_INVALID",
            candidates: [] as VerifiedTaskCandidate[],
            usage: response.usage
          };
        }
        return {
          status: "completed" as const,
          inputIndex: restored.inputIndex,
          failureCode: null,
          candidates: verifyTaskCandidates(
            restored.conversation,
            parsed.data.candidates
          ),
          usage: response.usage
        };
      } catch (error) {
        return {
          status: "failed" as const,
          inputIndex: restored.inputIndex,
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
    scorePriority(candidate, now)
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
  const completedAt = input.now?.() ?? new Date().toISOString();
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
      provider: providerConfig.id,
      model: providerConfig.model,
      startedAt,
      completedAt,
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
