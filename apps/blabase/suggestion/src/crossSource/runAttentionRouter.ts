import {
  DEFAULT_PHASE2_ATTENTION_POLICY,
  phase2AttentionInputSchema,
  phase2AttentionResultSchema,
  type Phase2AttentionInput,
  type Phase2AttentionResult,
  type Phase2Candidate,
  type Phase2CandidateAssessment,
  type Phase2CaveatCode,
  type Phase2CodexOverviewItem,
  type Phase2Coverage
} from "./attentionSchema";
import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "./canonicalHash";
import type {
  RuntimeWorkSignal,
  RuntimeWorkSignalBatch
} from "./schema";
import {
  PHASE2_ATTENTION_INPUT_CONTRACT,
  PHASE2_ATTENTION_POLICY_VERSION,
  PHASE2_ATTENTION_RESULT_CONTRACT,
  PHASE2_ATTENTION_RESULT_ID_POLICY_VERSION,
  PHASE2_CODEX_OVERVIEW_RULE_VERSION,
  PHASE2_GITHUB_CANDIDATE_RULE_VERSION
} from "./versions";
import { verifyRuntimeWorkSignalBatchIntegrity } from "./workSignalIntegrity";

export const EMPTY_PHASE2_FOCUS = {
  primaryOutcome: null,
  capturedAt: null,
  validUntil: null
} as const;

export function phase2AvailableSource(
  batch: RuntimeWorkSignalBatch
): Phase2AttentionInput["sources"]["github"] {
  return { status: "available", batch };
}

export function phase2UnavailableSource(
  reason:
    | "CONNECTOR_DISCONNECTED"
    | "COLLECTION_FAILED"
    | "SNAPSHOT_MISSING"
    | "SNAPSHOT_PARSE_FAILED"
    | "SNAPSHOT_SCHEMA_UNSUPPORTED"
): Phase2AttentionInput["sources"]["github"] {
  return { status: "unavailable", reason };
}

export function phase2AttentionInput(input: {
  asOf: string;
  github: Phase2AttentionInput["sources"]["github"];
  codex: Phase2AttentionInput["sources"]["codex"];
  focus?: Phase2AttentionInput["focus"];
}): Phase2AttentionInput {
  return phase2AttentionInputSchema.parse({
    contract: PHASE2_ATTENTION_INPUT_CONTRACT,
    asOf: input.asOf,
    focus: input.focus ?? EMPTY_PHASE2_FOCUS,
    policy: DEFAULT_PHASE2_ATTENTION_POLICY,
    sources: {
      github: input.github,
      codex: input.codex
    }
  });
}

type RankedCandidate = {
  candidate: Phase2Candidate;
  ranking: {
    laneRank: number;
    deadlineBucket: number;
    goalMatchRank: number;
    kindRank: number;
    sourceUpdatedAtMs: number;
  };
};

type GitHubDerivation = {
  rankedCandidates: RankedCandidate[];
  assessments: Phase2CandidateAssessment[];
  candidateCoverage: Phase2Coverage["githubCandidateCoverage"];
  negativeCandidateCoverageComplete: boolean;
  hasProvisionalContractGap: boolean;
};

export function runPhase2AttentionRouter(
  input: unknown
): Phase2AttentionResult {
  const parsed = phase2AttentionInputSchema.parse(input);
  assertSourceBatchIntegrity(parsed);

  const inputSha256 = runtimeSha256({
    domain: "blabase-github-codex-attention-input-v0.1",
    input: parsed
  });
  const github = deriveGitHubCandidates(parsed);
  const rankedCandidates = [...github.rankedCandidates].sort(
    compareRankedCandidates
  );
  const focusContext = deriveFocusContext(
    parsed,
    rankedCandidates
  );
  const codexExecutions = deriveCodexOverview(parsed);
  const coverage = deriveCoverage(
    parsed,
    github,
    rankedCandidates.length > 0
  );
  const decision = deriveDecision(
    parsed,
    rankedCandidates,
    coverage,
    focusContext
  );
  const resultId = runtimeStableId(
    "res",
    PHASE2_ATTENTION_RESULT_ID_POLICY_VERSION,
    {
      inputSha256,
      policyVersion: parsed.policy.version
    }
  );
  const withoutHash = {
    contract: PHASE2_ATTENTION_RESULT_CONTRACT,
    resultId,
    inputSha256,
    asOf: parsed.asOf,
    policyVersion: PHASE2_ATTENTION_POLICY_VERSION,
    githubCandidateRuleVersion:
      PHASE2_GITHUB_CANDIDATE_RULE_VERSION,
    codexOverviewRuleVersion: PHASE2_CODEX_OVERVIEW_RULE_VERSION,
    recommendationMode: "aggressive_evidence_bound" as const,
    readOnly: true as const,
    focusContext,
    coverage,
    candidateAssessments: github.assessments,
    workCockpit: {
      codexExecutions
    },
    decision
  };
  return phase2AttentionResultSchema.parse({
    ...withoutHash,
    resultSha256: computePhase2AttentionResultSha256(withoutHash)
  });
}

export function computePhase2AttentionResultSha256(
  result: Omit<Phase2AttentionResult, "resultSha256">
): string {
  return runtimeSha256({
    domain: "blabase-github-codex-attention-result-v0.1",
    result
  });
}

export function verifyPhase2AttentionResultIntegrity(
  input: unknown
): boolean {
  const parsed = phase2AttentionResultSchema.safeParse(input);
  if (!parsed.success) return false;
  const result = parsed.data;
  const {
    resultSha256: storedHash,
    ...resultWithoutHash
  } = result;
  const expectedId = runtimeStableId(
    "res",
    PHASE2_ATTENTION_RESULT_ID_POLICY_VERSION,
    {
      inputSha256: result.inputSha256,
      policyVersion: result.policyVersion
    }
  );
  return (
    result.resultId === expectedId &&
    storedHash ===
      computePhase2AttentionResultSha256(resultWithoutHash)
  );
}

function assertSourceBatchIntegrity(
  input: Phase2AttentionInput
): void {
  for (const source of Object.values(input.sources)) {
    if (
      source.status === "available" &&
      !verifyRuntimeWorkSignalBatchIntegrity(source.batch).ok
    ) {
      throw new TypeError(
        "Phase 2 attention input requires integrity-verified source batches."
      );
    }
  }
}

function deriveGitHubCandidates(
  input: Phase2AttentionInput
): GitHubDerivation {
  const source = input.sources.github;
  if (source.status === "unavailable") {
    return {
      rankedCandidates: [],
      assessments: [],
      candidateCoverage: "unavailable",
      negativeCandidateCoverageComplete: false,
      hasProvisionalContractGap: false
    };
  }

  const batch = source.batch;
  const current = batch.assessment.usableForCurrentCandidates;
  const directWorkSignals = batch.signals.filter(
    (signal) =>
      signal.kind === "work_item_observation" &&
      signal.facts.semanticRole === "direct_work_item"
  );
  const directSubjectIds = new Set(
    directWorkSignals.map((signal) => signal.subjectId)
  );
  const materialIssue = batch.issues.some(
    (issue) =>
      (issue.code === "CONFLICTING_DUPLICATE_RECORD" ||
        issue.code === "RECORD_INVALID" ||
        issue.code === "UNSAFE_DESTINATION") &&
      (issue.subjectId === null ||
        directSubjectIds.has(issue.subjectId))
  );
  const candidateCoverage =
    current &&
    batch.assessment.candidateSetComplete &&
    !materialIssue
      ? ("complete" as const)
      : current
        ? ("partial" as const)
        : ("unavailable" as const);
  const deadlines = batch.signals.filter(
    (
      signal
    ): signal is Extract<
      RuntimeWorkSignal,
      { kind: "deadline_observation" }
    > => signal.kind === "deadline_observation"
  );
  const rankedCandidates: RankedCandidate[] = [];
  const assessments: Phase2CandidateAssessment[] = [];
  let hasProvisionalContractGap = false;

  for (const signal of batch.signals
    .filter(
      (
        item
      ): item is Extract<
        RuntimeWorkSignal,
        { kind: "work_item_observation" }
      > => item.kind === "work_item_observation"
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.signalId, right.signalId)
    )) {
    const assessmentId = runtimeStableId(
      "asm",
      PHASE2_GITHUB_CANDIDATE_RULE_VERSION,
      {
        signalId: signal.signalId,
        policyVersion: input.policy.version
      }
    );
    const gateReasonCodes: Phase2CandidateAssessment["gateReasonCodes"] =
      [];

    if (!current) {
      gateReasonCodes.push("GATE_SOURCE_NOT_CURRENT");
    } else if (
      signal.facts.semanticRole === "context_only" ||
      signal.facts.taskKind === "authored_pull_request"
    ) {
      gateReasonCodes.push("GATE_CONTEXT_ONLY");
    } else if (signal.facts.destinationUrl === null) {
      gateReasonCodes.push("GATE_NATIVE_DESTINATION_MISSING");
    } else if (signal.attentionCapability !== "candidate_input") {
      gateReasonCodes.push("GATE_NOT_CANDIDATE_INPUT");
    }

    if (gateReasonCodes.length > 0) {
      assessments.push({
        assessmentId,
        subjectId: signal.subjectId,
        signalId: signal.signalId,
        taskKind: signal.facts.taskKind,
        disposition: "ineligible",
        candidateId: null,
        gateReasonCodes
      });
      continue;
    }

    const matchingDeadline = deadlines
      .filter(
        (deadline) =>
          deadline.subjectId === signal.subjectId &&
          deadline.facts.taskKind === signal.facts.taskKind &&
          deadline.attentionCapability === "candidate_input"
      )
      .sort(
        (left, right) =>
          Date.parse(left.facts.deadlineAt) -
            Date.parse(right.facts.deadlineAt) ||
          compareRuntimeStrings(left.signalId, right.signalId)
      )[0];
    const candidate = buildGitHubCandidate(
      signal,
      matchingDeadline,
      input,
      candidateCoverage
    );
    if (candidate.candidate.certainty === "provisional") {
      hasProvisionalContractGap = true;
    }
    rankedCandidates.push(candidate);
    assessments.push({
      assessmentId,
      subjectId: signal.subjectId,
      signalId: signal.signalId,
      taskKind: signal.facts.taskKind,
      disposition:
        candidate.candidate.certainty === "provisional"
          ? "provisional"
          : "eligible",
      candidateId: candidate.candidate.candidateId,
      gateReasonCodes: []
    });
  }

  return {
    rankedCandidates,
    assessments: assessments.sort((left, right) =>
      compareRuntimeStrings(
        left.assessmentId,
        right.assessmentId
      )
    ),
    candidateCoverage,
    negativeCandidateCoverageComplete:
      candidateCoverage === "complete",
    hasProvisionalContractGap
  };
}

function buildGitHubCandidate(
  signal: Extract<
    RuntimeWorkSignal,
    { kind: "work_item_observation" }
  >,
  deadline:
    | Extract<
        RuntimeWorkSignal,
        { kind: "deadline_observation" }
      >
    | undefined,
  input: Phase2AttentionInput,
  candidateCoverage: Phase2Coverage["githubCandidateCoverage"]
): RankedCandidate {
  if (
    signal.facts.taskKind === "authored_pull_request" ||
    signal.facts.destinationUrl === null
  ) {
    throw new TypeError(
      "Only destination-backed direct GitHub work can become a candidate."
    );
  }
  const dueAt = deadline?.facts.deadlineAt ?? null;
  const dueAtMs = dueAt === null ? null : Date.parse(dueAt);
  const asOfMs = Date.parse(input.asOf);
  const isOverdue = dueAtMs !== null && dueAtMs < asOfMs;
  const isDueSoon =
    dueAtMs !== null &&
    dueAtMs >= asOfMs &&
    dueAtMs <= asOfMs + input.policy.dueSoonWindowMs;
  const isReview =
    signal.facts.taskKind === "review_requested_pull_request";
  const lane =
    isOverdue || isDueSoon
      ? ("must_now" as const)
      : isReview
        ? ("unblock" as const)
        : ("focus" as const);
  const focusMatch = matchesActiveFocus(
    input,
    [
      signal.facts.title,
      signal.facts.repositoryFullName
    ].join(" ")
  );
  const caveatCodes: Phase2Candidate["caveatCodes"] = [];
  if (isReview) {
    caveatCodes.push("CAVEAT_REVIEW_DRAFT_UNKNOWN");
  }
  if (candidateCoverage !== "complete") {
    caveatCodes.push("CAVEAT_CANDIDATE_SET_INCOMPLETE");
  }
  const whyNowReasonCodes: Phase2Candidate["whyNowReasonCodes"] =
    [];
  if (isOverdue) {
    whyNowReasonCodes.push("WHY_NOW_MILESTONE_OVERDUE");
  } else if (isDueSoon) {
    whyNowReasonCodes.push("WHY_NOW_MILESTONE_DUE_SOON");
  } else if (isReview) {
    whyNowReasonCodes.push(
      "WHY_NOW_REVIEW_REQUEST_OBSERVED"
    );
  } else {
    whyNowReasonCodes.push("WHY_NOW_OPEN_ASSIGNED_WORK");
  }
  if (focusMatch) {
    whyNowReasonCodes.push(
      "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
    );
  }
  const candidateId = runtimeStableId(
    "att",
    PHASE2_GITHUB_CANDIDATE_RULE_VERSION,
    {
      subjectId: signal.subjectId,
      taskKind: signal.facts.taskKind
    }
  );
  const candidate = {
    candidateId,
    source: "github" as const,
    subjectId: signal.subjectId,
    sourceSignalIds: [
      signal.signalId,
      ...(deadline ? [deadline.signalId] : [])
    ].sort(compareRuntimeStrings),
    taskKind: signal.facts.taskKind,
    title: signal.facts.title,
    repositoryFullName: signal.facts.repositoryFullName,
    number: signal.facts.number,
    intervention: isReview ? ("inspect" as const) : ("do" as const),
    lane,
    state: "unclear" as const,
    dueAt,
    destinationUrl: signal.facts.destinationUrl,
    certainty:
      isReview || candidateCoverage !== "complete"
        ? ("provisional" as const)
        : ("confirmed" as const),
    reasonCodes: [
      isReview
        ? ("CANDIDATE_GITHUB_REVIEW_STATUS_CHECK" as const)
        : ("CANDIDATE_GITHUB_ASSIGNED_ISSUE" as const)
    ],
    whyNowReasonCodes,
    caveatCodes,
    sourceUpdatedAt: signal.sourceUpdatedAt,
    firstStep: isReview
      ? `GitHub PR #${signal.facts.number}을 열어 draft 여부와 리뷰 가능 상태를 확인합니다.`
      : `GitHub issue #${signal.facts.number}을 열어 다음 행동을 확인합니다.`,
    explanation: isReview
      ? "현재 사용자에게 열린 PR 리뷰가 요청됐지만 draft 여부는 아직 확인되지 않았습니다."
      : dueAt === null
        ? "현재 사용자에게 할당된 열린 GitHub issue입니다."
        : "현재 사용자에게 할당된 열린 GitHub issue에 native milestone 시각이 연결돼 있습니다."
  };
  return {
    candidate,
    ranking: {
      laneRank: input.policy.laneOrder.indexOf(lane),
      deadlineBucket: isOverdue ? 0 : isDueSoon ? 1 : 2,
      goalMatchRank: focusMatch ? 0 : 1,
      kindRank: isReview ? 0 : 1,
      sourceUpdatedAtMs:
        signal.sourceUpdatedAt === null
          ? Number.NEGATIVE_INFINITY
          : Date.parse(signal.sourceUpdatedAt)
    }
  };
}

function deriveCodexOverview(
  input: Phase2AttentionInput
): Phase2CodexOverviewItem[] {
  const source = input.sources.codex;
  if (
    source.status === "unavailable" ||
    !source.batch.assessment.usableForOverview
  ) {
    return [];
  }
  const freshness =
    source.batch.assessment.freshness === "fresh"
      ? ("fresh" as const)
      : ("stale" as const);
  return source.batch.signals
    .filter(
      (
        signal
      ): signal is Extract<
        RuntimeWorkSignal,
        { kind: "execution_observation" }
      > => signal.kind === "execution_observation"
    )
    .map((signal) => ({
      executionId: signal.subjectId,
      signalId: signal.signalId,
      observationId: signal.observationId,
      nativeActivityState: signal.facts.nativeActivityState,
      semanticState: signal.facts.semanticState,
      nativeAttentionState: signal.facts.nativeAttentionState,
      attentionSemanticRole:
        signal.facts.attentionSemanticRole,
      projectLabel: signal.facts.projectLabel,
      taskSummary: signal.facts.taskSummary,
      taskSummarySemanticRole:
        signal.facts.taskSummarySemanticRole,
      observedAt: signal.observedAt,
      sourceUpdatedAt:
        signal.sourceUpdatedAt ?? signal.observedAt,
      freshness,
      reasonCode: codexOverviewReason(
        signal.facts.nativeActivityState
      ),
      forbiddenAsAttentionCandidate: true as const
    }))
    .sort(
      (left, right) =>
        Date.parse(right.sourceUpdatedAt) -
          Date.parse(left.sourceUpdatedAt) ||
        compareRuntimeStrings(
          left.executionId,
          right.executionId
        )
    );
}

function deriveCoverage(
  input: Phase2AttentionInput,
  github: GitHubDerivation,
  hasCandidate: boolean
): Phase2Coverage {
  const githubSource = input.sources.github;
  const codexSource = input.sources.codex;
  const githubReason =
    githubSource.status === "unavailable"
      ? ("SOURCE_GITHUB_UNAVAILABLE" as const)
      : github.candidateCoverage === "complete"
        ? ("SOURCE_GITHUB_FRESH_COMPLETE" as const)
        : github.candidateCoverage === "partial"
          ? ("SOURCE_GITHUB_FRESH_PARTIAL" as const)
          : ("SOURCE_GITHUB_STALE_OR_INVALID" as const);
  const codexReason =
    codexSource.status === "unavailable"
      ? ("SOURCE_CODEX_UNAVAILABLE" as const)
      : !codexSource.batch.assessment.usableForOverview
        ? ("SOURCE_CODEX_STALE_OR_INVALID" as const)
        : codexSource.batch.assessment.freshness === "fresh"
        ? ("SOURCE_CODEX_OVERVIEW_ONLY" as const)
        : ("SOURCE_CODEX_STALE_OVERVIEW" as const);
  const disposition =
    github.candidateCoverage === "complete"
      ? github.hasProvisionalContractGap
        ? ("limited_but_sufficient" as const)
        : ("scoped_complete" as const)
      : github.candidateCoverage === "partial" && hasCandidate
        ? ("limited_but_sufficient" as const)
        : ("insufficient" as const);
  return {
    disposition,
    githubCandidateCoverage: github.candidateCoverage,
    negativeCandidateCoverageComplete:
      github.negativeCandidateCoverageComplete,
    evaluatedCandidateSources:
      github.candidateCoverage === "unavailable"
        ? []
        : ["github"],
    overviewOnlySources:
      codexSource.status === "available" &&
      codexSource.batch.assessment.usableForOverview
        ? ["codex"]
        : [],
    unevaluatedSources: ["google_calendar", "notion"],
    reasonCodes: [
      githubReason,
      codexReason,
      "SOURCE_GOOGLE_CALENDAR_UNEVALUATED",
      "SOURCE_NOTION_UNEVALUATED"
    ]
  };
}

function deriveFocusContext(
  input: Phase2AttentionInput,
  candidates: RankedCandidate[]
): Phase2AttentionResult["focusContext"] {
  if (input.focus.primaryOutcome === null) {
    return {
      present: false,
      active: false,
      appliedToRanking: false,
      relationStatus: "not_provided"
    };
  }
  if (
    Date.parse(input.focus.capturedAt as string) >
    Date.parse(input.asOf)
  ) {
    return {
      present: true,
      active: false,
      appliedToRanking: false,
      relationStatus: "not_yet_active"
    };
  }
  const active =
    Date.parse(input.focus.validUntil as string) >
      Date.parse(input.asOf);
  if (!active) {
    return {
      present: true,
      active: false,
      appliedToRanking: false,
      relationStatus: "expired"
    };
  }
  const applied = candidates.some((candidate) =>
    candidate.candidate.whyNowReasonCodes.includes(
      "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
    )
  );
  return {
    present: true,
    active: true,
    appliedToRanking: applied,
    relationStatus: applied ? "text_match_only" : "unresolved"
  };
}

function deriveDecision(
  input: Phase2AttentionInput,
  candidates: RankedCandidate[],
  coverage: Phase2Coverage,
  focusContext: Phase2AttentionResult["focusContext"]
): Phase2AttentionResult["decision"] {
  const commonCaveats: Phase2CaveatCode[] = [
    "CAVEAT_CODEX_EXCEPTION_CONTRACT_UNAVAILABLE",
    "CAVEAT_GOOGLE_CALENDAR_UNEVALUATED",
    "CAVEAT_NOTION_UNEVALUATED"
  ];
  if (
    focusContext.present &&
    focusContext.active &&
    !focusContext.appliedToRanking
  ) {
    commonCaveats.push(
      "CAVEAT_PRIMARY_OUTCOME_RELATION_UNRESOLVED"
    );
  }

  const top = candidates[0];
  if (top) {
    const alternatives = candidates
      .slice(1, 1 + input.policy.maxAlternatives)
      .map((item) => item.candidate);
    const topCaveats = [...top.candidate.caveatCodes];
    const next = candidates[1];
    if (next && sameSemanticRank(top, next)) {
      topCaveats.push("CAVEAT_DEFAULT_TIE_BREAK_USED");
    }
    const caveatCodes = uniqueSorted([
      ...commonCaveats,
      ...topCaveats
    ]);
    const provisional =
      top.candidate.certainty === "provisional" ||
      coverage.disposition !== "scoped_complete";
    return {
      status: "suggested",
      certainty: provisional ? "provisional" : "confirmed",
      topSuggestion: top.candidate,
      alternatives,
      reasonCodes: ["DECISION_BEST_OBSERVED_CANDIDATE"],
      caveatCodes,
      scopeStatement:
        coverage.disposition === "scoped_complete"
          ? "현재 평가 가능한 GitHub 작업 범위에서 한 가지를 제안합니다. Codex는 실행 현황만 평가했고 Notion과 Google Calendar는 이번 판단에서 평가하지 않았습니다."
          : "현재 확인된 GitHub 작업 중 한 가지를 임시 제안합니다. 일부 후보 또는 source capability는 아직 평가하지 못했습니다."
    };
  }

  if (coverage.negativeCandidateCoverageComplete) {
    return {
      status: "no_action",
      certainty: "scoped",
      topSuggestion: null,
      alternatives: [],
      reasonCodes: ["DECISION_SCOPED_NO_ACTION"],
      caveatCodes: uniqueSorted(commonCaveats),
      scopeStatement:
        "현재 평가 가능한 GitHub 작업 범위에서는 사용자가 직접 개입할 항목이 없습니다. Codex는 실행 현황만 평가했고 Notion과 Google Calendar는 이번 판단에서 평가하지 않았습니다."
    };
  }

  return {
    status: "insufficient_evidence",
    certainty: null,
    topSuggestion: null,
    alternatives: [],
    reasonCodes: [
      "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
    ],
    caveatCodes: uniqueSorted(commonCaveats),
    scopeStatement:
      "현재 GitHub 후보 범위가 오래됐거나 불완전하여 개입할 한 가지를 안전하게 판단할 수 없습니다."
  };
}

function compareRankedCandidates(
  left: RankedCandidate,
  right: RankedCandidate
): number {
  return (
    left.ranking.laneRank - right.ranking.laneRank ||
    left.ranking.deadlineBucket - right.ranking.deadlineBucket ||
    left.ranking.goalMatchRank - right.ranking.goalMatchRank ||
    left.ranking.kindRank - right.ranking.kindRank ||
    right.ranking.sourceUpdatedAtMs -
      left.ranking.sourceUpdatedAtMs ||
    compareRuntimeStrings(
      left.candidate.candidateId,
      right.candidate.candidateId
    )
  );
}

function sameSemanticRank(
  left: RankedCandidate,
  right: RankedCandidate
): boolean {
  return (
    left.ranking.laneRank === right.ranking.laneRank &&
    left.ranking.deadlineBucket ===
      right.ranking.deadlineBucket &&
    left.ranking.goalMatchRank ===
      right.ranking.goalMatchRank &&
    left.ranking.kindRank === right.ranking.kindRank
  );
}

function matchesActiveFocus(
  input: Phase2AttentionInput,
  candidateText: string
): boolean {
  if (
    input.focus.primaryOutcome === null ||
    Date.parse(input.focus.capturedAt as string) >
      Date.parse(input.asOf) ||
    Date.parse(input.focus.validUntil as string) <=
      Date.parse(input.asOf)
  ) {
    return false;
  }
  const focusTokens = tokenizeForWeakMatch(
    input.focus.primaryOutcome
  );
  const candidateTokens = tokenizeForWeakMatch(candidateText);
  const shared = [...focusTokens].filter((token) =>
    candidateTokens.has(token)
  );
  return (
    shared.some((token) => token.length >= 6) ||
    shared.filter((token) => token.length >= 2).length >= 2
  );
}

function tokenizeForWeakMatch(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length >= 2) ?? []
  );
}

function codexOverviewReason(
  state:
    | "active"
    | "idle"
    | "not_loaded"
    | "system_error"
    | "unknown"
): Phase2CodexOverviewItem["reasonCode"] {
  switch (state) {
    case "active":
      return "OVERVIEW_CODEX_ACTIVITY_OBSERVED";
    case "idle":
      return "OVERVIEW_CODEX_EXECUTION_IDLE";
    case "not_loaded":
      return "OVERVIEW_CODEX_EXECUTION_NOT_LOADED";
    case "system_error":
      return "OVERVIEW_CODEX_SYSTEM_ERROR_STATUS";
    case "unknown":
      return "OVERVIEW_CODEX_STATE_UNKNOWN";
  }
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}
