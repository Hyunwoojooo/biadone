import type {
  MergedTaskCandidate,
  PriorityAssessment,
  PrioritySuggestionResult
} from "./types";

export const MINIMUM_SUGGESTION_SCORE = 0;

export type SelectionResult = Pick<
  PrioritySuggestionResult,
  "status" | "topSuggestion" | "alternatives" | "clarificationQuestion"
>;

export function selectSuggestion(
  candidates: MergedTaskCandidate[],
  assessments: PriorityAssessment[]
): SelectionResult {
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.id, candidate])
  );
  const ranked = assessments
    .filter((assessment) => assessment.eligibility === "eligible")
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidateId.localeCompare(right.candidateId)
    );
  const top = ranked[0];

  if (!top) {
    return {
      status: "insufficient_evidence",
      topSuggestion: null,
      alternatives: [],
      clarificationQuestion: null
    };
  }

  const candidate = candidateById.get(top.candidateId);
  if (
    !candidate ||
    (candidate.owner !== "user" && candidate.owner !== "shared")
  ) {
    return {
      status: "insufficient_evidence",
      topSuggestion: null,
      alternatives: [],
      clarificationQuestion: null
    };
  }

  return {
    status: "suggested",
    topSuggestion: {
      candidateId: candidate.id,
      title: candidate.title,
      whyNow: buildWhyNow(candidate, top),
      firstStep: safeFirstStep(candidate),
      owner: candidate.owner,
      executionMode: candidate.executionMode,
      confidence: candidate.confidence,
      score: top.score,
      recurrenceCount: candidate.recurrenceCount,
      sourceConversationCount: candidate.sourceConversationIds.length,
      evidence: candidate.evidence
    },
    alternatives: ranked.slice(1, 4).map((assessment) => ({
      candidateId: assessment.candidateId,
      title: candidateById.get(assessment.candidateId)?.title ?? "후보 task",
      score: assessment.score
    })),
    clarificationQuestion: null
  };
}

function buildWhyNow(
  candidate: MergedTaskCandidate,
  assessment: PriorityAssessment
): string {
  if (assessment.reasonCodes.includes("DEADLINE_SOON")) {
    return "대화에서 직접 확인된 마감이 가까운 미완료 작업입니다.";
  }
  if (assessment.reasonCodes.includes("UNBLOCKS_OTHER_WORK")) {
    return "이 일을 먼저 처리해야 다음 작업을 진행할 수 있다는 근거가 있습니다.";
  }
  if (
    assessment.reasonCodes.includes("REPEATED_ACROSS_CONVERSATIONS") &&
    assessment.reasonCodes.includes("EXPLICIT_USER_COMMITMENT")
  ) {
    return `${candidate.recurrenceCount}개 대화에서 반복됐고, 사용자가 직접 처리 의사를 밝힌 미완료 작업입니다.`;
  }
  if (assessment.reasonCodes.includes("REPEATED_ACROSS_CONVERSATIONS")) {
    return `${candidate.recurrenceCount}개 대화에서 반복해서 나타난 미완료 작업입니다.`;
  }
  return "사용자가 직접 요청하거나 처리 의사를 밝힌 미완료 작업입니다.";
}

function safeFirstStep(candidate: MergedTaskCandidate): string {
  const riskyClaim = /오늘|당장|즉시|내일|마감|\d{4}[-./]\d{1,2}/;
  const evidenceText = candidate.evidence
    .map((evidence) => evidence.quote)
    .join(" ");
  if (
    riskyClaim.test(candidate.firstStep) &&
    !riskyClaim.test(evidenceText)
  ) {
    return `‘${candidate.title}’의 현재 상태를 확인하고, 다음 한 단계를 10분 동안 정리하세요.`;
  }
  return candidate.firstStep;
}
