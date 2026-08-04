import type { ManagedCodexArtifactRelationProjection } from "../artifacts";
import {
  createClaimKey,
  createClaimTargetRef,
  type ClaimAuthorityProjection,
  type ClaimConflict,
  type ClaimField,
  type NormalizedWorkClaim
} from "../claims";
import {
  phase2GithubSignalMatchesActiveFocus,
  rankAllPhase2GitHubCandidates,
  runPhase2AttentionRouter
} from "../crossSource/runAttentionRouter";
import type { Phase2Candidate } from "../crossSource/attentionSchema";
import {
  compareRuntimeStrings,
  runtimeStableId
} from "../crossSource/canonicalHash";
import type {
  RuntimeWorkSignal,
  RuntimeWorkSignalBatch
} from "../crossSource/schema";
import {
  ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
  ACTIVE_ATTENTION_ID_POLICY_VERSION,
  ACTIVE_ATTENTION_INPUT_CONTRACT,
  ACTIVE_ATTENTION_LANE_POLICY_VERSION,
  ACTIVE_ATTENTION_POLICY_VERSION,
  ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT
} from "../crossSource/versions";
import type {
  AttentionEligibilityAssessment,
  AttentionEligibilityShadowProjection
} from "../eligibility";
import type {
  ManagedCodexPublicProjection,
  ManagedCodexPublicRunProjection,
  ManagedCodexSemanticProjection,
  ManagedCodexSemanticRunResult
} from "../managedCodex";
import type {
  ManagedCodexWorkRelation,
  ManagedCodexWorkRelationProjection
} from "../relations";
import {
  projectWorkflowGraceElapsed,
  type ActiveProjectWorkflow,
  type ProjectWorkflowActionKind,
  type ProjectWorkflowProjection
} from "../workflows/contracts";
import {
  activeAttentionInputSchema,
  createActiveAttentionResultId,
  managedCodexPublicProjectionDependencySha256,
  managedCodexRunStartTimesSha256,
  sealActiveAttentionResult,
  type ActiveAttentionAssessment,
  type ActiveAttentionCandidate,
  type ActiveAttentionCaveatCode,
  type ActiveAttentionInput,
  type ActiveAttentionReasonCode,
  type ActiveAttentionResult
} from "./contracts";

type GitHubWorkItemSignal = Extract<
  RuntimeWorkSignal,
  { kind: "work_item_observation" }
>;
type GitHubDeadlineSignal = Extract<
  RuntimeWorkSignal,
  { kind: "deadline_observation" }
>;

type RankedCandidate = {
  candidate: ActiveAttentionCandidate;
  ranking: {
    laneRank: number;
    deadlineBucket: number;
    specificityRank: number;
    baseRank: number;
    sourceUpdatedAtMs: number;
  };
};

type DerivedAssessment = {
  assessment: ActiveAttentionAssessment;
  rankedCandidate: RankedCandidate | null;
};

type Phase2RankContext = {
  baseRank: number;
  focusMatched: boolean;
};

type ReviewResult = {
  status: "review_required";
  route: "user_review" | "refresh_sources";
  reason: ActiveAttentionReasonCode;
  conflictIds: string[];
};

type MaterialClaimResult =
  | { status: "resolved"; claim: NormalizedWorkClaim }
  | ReviewResult;

const LANE_ORDER = ["must_now", "unblock", "close_loop", "focus"] as const;

/**
 * Produces the Phase 4B active result from one sealed, replayable evidence
 * envelope. All upstream projections remain non-candidates; only candidates
 * re-derived through this resolver may enter active ranking.
 */
export function resolveActiveAttention(
  input: unknown
): ActiveAttentionResult {
  const parsed = activeAttentionInputSchema.parse(input);
  const baseResult = runPhase2AttentionRouter(parsed.baseAttentionInput);
  assertExactDependencies(parsed);
  const phase2RankByGithubKey = new Map<string, Phase2RankContext>();
  rankAllPhase2GitHubCandidates(parsed.baseAttentionInput).forEach(
    (candidate, index) => {
      phase2RankByGithubKey.set(
        githubCandidateKey(candidate.subjectId, candidate.taskKind),
        {
          baseRank: index,
          focusMatched: phase2CandidateFocusMatched(candidate)
        }
      );
    }
  );

  const derived = [
    ...deriveGitHubAssessments(parsed, phase2RankByGithubKey),
    ...deriveManagedAssessments(parsed, phase2RankByGithubKey)
  ];
  const deduplicated = suppressDuplicateOpenLoops(derived);
  const assessments = deduplicated
    .map((item) => item.assessment)
    .sort((left, right) =>
      compareRuntimeStrings(left.assessmentId, right.assessmentId)
    );
  const ranked = deduplicated
    .map((item) => item.rankedCandidate)
    .filter((item): item is RankedCandidate => item !== null)
    .sort(compareRankedCandidates);
  const rankedCandidates = ranked.map((item) => item.candidate);
  const coverage = deriveCoverage(parsed);
  const decision = deriveDecision(
    assessments,
    rankedCandidates,
    coverage,
    usedStableIdTieBreak(ranked)
  );
  const resultId = createActiveAttentionResultId({
    inputSha256: parsed.inputSha256,
    policyVersion: ACTIVE_ATTENTION_POLICY_VERSION
  });

  return sealActiveAttentionResult({
    contract: ACTIVE_ATTENTION_RESULT_CONTRACT,
    resultId,
    inputSha256: parsed.inputSha256,
    asOf: parsed.asOf,
    policyVersion: ACTIVE_ATTENTION_POLICY_VERSION,
    candidateRuleVersion: ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
    lanePolicyVersion: ACTIVE_ATTENTION_LANE_POLICY_VERSION,
    rankingPolicyVersion: ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
    resolverVersion: ACTIVE_ATTENTION_RESOLVER_VERSION,
    idPolicyVersion: ACTIVE_ATTENTION_ID_POLICY_VERSION,
    recommendationMode: "aggressive_evidence_bound",
    readOnly: true,
    dependencies: {
      baseAttentionInputSha256: baseResult.inputSha256,
      baseAttentionResultContract: baseResult.contract,
      baseAttentionResultId: baseResult.resultId,
      baseAttentionResultSha256: baseResult.resultSha256,
      githubBatchSha256: parsed.githubBatch?.batchSha256 ?? null,
      githubSourceSnapshotSha256:
        parsed.githubBatch?.sourceSnapshotSha256 ?? null,
      eligibilityProjectionSha256:
        parsed.eligibilityProjection.projectionSha256,
      managedPublicProjectionSha256:
        managedCodexPublicProjectionDependencySha256(
          parsed.managedPublicProjection
        ),
      managedRunStartedAtByIdSha256:
        managedCodexRunStartTimesSha256(
          parsed.managedRunStartedAtById
        ),
      managedSourceRevision: parsed.managedPublicProjection.revision,
      managedGeneratedAt: parsed.managedPublicProjection.generatedAt,
      managedSemanticProjectionSha256:
        parsed.managedSemanticProjection.projectionSha256,
      workRelationProjectionSha256:
        parsed.workRelationProjection.projectionSha256,
      artifactRelationProjectionSha256:
        parsed.artifactRelationProjection.projectionSha256,
      claimAuthorityProjectionSha256:
        parsed.claimAuthorityProjection.projectionSha256,
      workflowProjectionSha256:
        parsed.workflowProjection.projectionSha256,
      workflowStoreSha256: parsed.workflowProjection.storeSha256,
      workflowRevision: parsed.workflowProjection.revision
    },
    upstreamGuards: {
      eligibility: {
        attentionSelectionEffect:
          parsed.eligibilityProjection.attentionSelectionEffect,
        attentionDisposition:
          parsed.eligibilityProjection.attentionDisposition,
        forbiddenAsAttentionCandidate:
          parsed.eligibilityProjection.forbiddenAsAttentionCandidate
      },
      managedPublic: {
        runCount: parsed.managedPublicProjection.runs.length,
        everyRunForbiddenAsAttentionCandidate: true
      },
      managedSemantic: {
        runCount: Object.keys(parsed.managedSemanticProjection.runs).length,
        everyRunForbiddenAsAttentionCandidate: true
      },
      workRelations: {
        attentionDisposition:
          parsed.workRelationProjection.attentionDisposition,
        forbiddenAsAttentionCandidate:
          parsed.workRelationProjection.forbiddenAsAttentionCandidate
      },
      artifacts: {
        attentionDisposition:
          parsed.artifactRelationProjection.attentionDisposition,
        forbiddenAsAttentionCandidate:
          parsed.artifactRelationProjection.forbiddenAsAttentionCandidate
      },
      claims: {
        attentionDisposition:
          parsed.claimAuthorityProjection.attentionDisposition,
        forbiddenAsAttentionCandidate:
          parsed.claimAuthorityProjection.forbiddenAsAttentionCandidate
      }
    },
    coverage,
    counts: {
      eligible: assessments.filter(
        (assessment) => assessment.status === "eligible"
      ).length,
      reviewRequired: assessments.filter(
        (assessment) => assessment.status === "review_required"
      ).length,
      ineligible: assessments.filter(
        (assessment) => assessment.status === "ineligible"
      ).length
    },
    assessments,
    rankedCandidates,
    decision
  });
}

export const runActiveAttentionResolver = resolveActiveAttention;

function deriveGitHubAssessments(
  input: ActiveAttentionInput,
  phase2RankByGithubKey: ReadonlyMap<string, Phase2RankContext>
): DerivedAssessment[] {
  const batch = input.githubBatch;

  return input.eligibilityProjection.assessments.map((upstream) => {
    const signal = batch?.signals.find(
      (candidate): candidate is GitHubWorkItemSignal =>
        candidate.kind === "work_item_observation" &&
        candidate.signalId === upstream.sourceSignalId
    );
    const base = activeAssessmentBase({
      candidateSeedId: upstream.candidateSeedId,
      triggerSource: "github",
      triggerKind: "github_work_item",
      sourceSignalId: upstream.sourceSignalId,
      managedRunId: null,
      targetRef: upstream.targetRef,
      githubSubjectId: signal?.subjectId ?? null,
      relationRefs: upstream.relationRefs,
      conflictIds: upstream.relatedConflictIds
    });

    if (upstream.status !== "eligible" || !signal) {
      const review = upstream.status === "review_required";
      return {
        assessment: completeAssessment(base, {
          actionKind: upstream.actionKind,
          status: review ? "review_required" : "ineligible",
          reviewRoute: review ? upstream.reviewRoute : "none",
          reasonCodes: [mapUpstreamEligibilityReason(upstream)],
          candidateId: null
        }),
        rankedCandidate: null
      };
    }

    const deadline = matchingDeadline(batch, signal);
    const rankContext = phase2RankContextForSignal(
      input,
      signal,
      phase2RankByGithubKey
    );
    const rankedCandidate = buildGitHubCandidate({
      input,
      upstream,
      signal,
      deadline,
      ...rankContext
    });
    return {
      assessment: completeAssessment(base, {
        actionKind: upstream.actionKind,
        status: "eligible",
        reviewRoute: "none",
        reasonCodes: ["ELIGIBLE_GITHUB_DIRECT_WORK"],
        candidateId: rankedCandidate.candidate.candidateId
      }),
      rankedCandidate
    };
  });
}

function deriveManagedAssessments(
  input: ActiveAttentionInput,
  phase2RankByGithubKey: ReadonlyMap<string, Phase2RankContext>
): DerivedAssessment[] {
  return [...input.managedPublicProjection.runs]
    .sort((left, right) =>
      compareRuntimeStrings(left.managedRunId, right.managedRunId)
    )
    .map((run) =>
      assessManagedRun(input, run, phase2RankByGithubKey)
    );
}

function assessManagedRun(
  input: ActiveAttentionInput,
  run: ManagedCodexPublicRunProjection,
  phase2RankByGithubKey: ReadonlyMap<string, Phase2RankContext>
): DerivedAssessment {
  const semantic = input.managedSemanticProjection.runs[run.managedRunId];
  const isCompletion = isLatestDirectCompletion(run, semantic);
  const triggerKind = isCompletion
    ? ("configured_follow_through" as const)
    : ("managed_failure" as const);
  const codexTargetRef = managedTargetRef(run);
  const seedId = runtimeStableId(
    "seed",
    ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
    {
      triggerSource: "codex_managed",
      triggerKind,
      managedRunId: run.managedRunId,
      bindingId: run.bindingId,
      executionId: run.executionId
    }
  );
  const initialBase = activeAssessmentBase({
    candidateSeedId: seedId,
    triggerSource: "codex_managed",
    triggerKind,
    sourceSignalId: null,
    managedRunId: run.managedRunId,
    targetRef: codexTargetRef,
    githubSubjectId: null,
    relationRefs: [],
    conflictIds: []
  });

  const semanticReview = reviewSemanticWindow(run, semantic);
  if (semanticReview) {
    return reviewed(initialBase, semanticReview);
  }
  if (!semantic) {
    return reviewed(initialBase, {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MANAGED_SEMANTICS_MISSING",
      conflictIds: []
    });
  }

  const isFailure = isLatestDirectFailure(run, semantic);
  if (!isFailure && !isCompletion) {
    const reason: ActiveAttentionReasonCode =
      semantic.detector.failureLifecycle === "superseded_by_newer_turn"
        ? "INELIGIBLE_FAILURE_RECOVERED"
        : run.effectiveExecutionState === "running" ||
            run.effectiveExecutionState === "idle" ||
            run.effectiveExecutionState === "completed"
          ? "INELIGIBLE_MANAGED_RUN_HEALTHY"
          : "INELIGIBLE_MANAGED_STATE_NOT_CURRENT";
    return ineligible(initialBase, reason);
  }

  const managedRunLifecycleFailure =
    semantic.detector.failureLifecycle ===
    "latest_direct_managed_run_failure";
  if (!managedRunLifecycleFailure) {
    const expectedState = isFailure ? "failed" : "completed";
    const state = resolveMaterialClaim(
      codexTargetRef,
      "managed_codex_execution_state",
      input.claimAuthorityProjection
    );
    if (state.status === "review_required") {
      return reviewed(initialBase, {
        ...state,
        reason:
          state.reason === "REVIEW_SOURCE_STALE"
            ? state.reason
            : state.reason === "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER" ||
                state.reason ===
                  "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH"
              ? state.reason
              : "REVIEW_MANAGED_STATE_CLAIM_UNRESOLVED"
      });
    }
    if (
      state.claim.value.type !== "enum" ||
      state.claim.value.value !== expectedState
    ) {
      return ineligible(initialBase, "INELIGIBLE_MANAGED_STATE_NOT_CURRENT");
    }
  }

  const link = resolveActiveLink(input, run);
  if (link.status === "review_required") {
    return reviewed(initialBase, link);
  }
  if (link.status === "ineligible") {
    return ineligible(initialBase, link.reason);
  }
  const linkedBase = activeAssessmentBase({
    candidateSeedId: seedId,
    triggerSource: "codex_managed",
    triggerKind,
    sourceSignalId: null,
    managedRunId: run.managedRunId,
    targetRef: link.githubTargetRef,
    githubSubjectId: link.signal.subjectId,
    relationRefs: [link.relation.relationId],
    conflictIds: relevantConflicts(
      {
        targetRefs: [codexTargetRef, link.githubTargetRef],
        relationRefs: [link.relation.relationId]
      },
      input.claimAuthorityProjection
    ).map((conflict) => conflict.conflictId)
  });
  if (
    hasNewerManagedAttemptForSameTarget(
      input,
      run,
      link.relation
    )
  ) {
    return ineligible(
      linkedBase,
      "INELIGIBLE_MANAGED_ATTEMPT_SUPERSEDED"
    );
  }

  const targetState = resolveMaterialClaim(
    link.githubTargetRef,
    "github_work_item_state",
    input.claimAuthorityProjection
  );
  if (targetState.status === "review_required") {
    return reviewed(linkedBase, {
      ...targetState,
      reason:
        targetState.reason === "REVIEW_SOURCE_STALE"
          ? targetState.reason
          : targetState.reason ===
                  "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER" ||
              targetState.reason ===
                "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH"
            ? targetState.reason
            : "REVIEW_GITHUB_STATE_CLAIM_UNRESOLVED"
    });
  }
  if (
    targetState.claim.value.type !== "enum" ||
    targetState.claim.value.value !== "open"
  ) {
    return ineligible(linkedBase, "INELIGIBLE_GITHUB_TARGET_CLOSED");
  }

  const conflictReview = unresolvedRelevantConflict(
    {
      targetRefs: [codexTargetRef, link.githubTargetRef],
      relationRefs: [link.relation.relationId]
    },
    input.claimAuthorityProjection
  );
  if (conflictReview) return reviewed(linkedBase, conflictReview);
  const rankContext = phase2RankContextForSignal(
    input,
    link.signal,
    phase2RankByGithubKey
  );

  if (isFailure) {
    const rankedCandidate = buildManagedFailureCandidate({
      input,
      run,
      semantic,
      relation: link.relation,
      signal: link.signal,
      targetRef: link.githubTargetRef,
      ...rankContext
    });
    return {
      assessment: completeAssessment(linkedBase, {
        actionKind: "inspect",
        status: "eligible",
        reviewRoute: "none",
        reasonCodes: ["ELIGIBLE_MANAGED_LATEST_DIRECT_FAILURE"],
        candidateId: rankedCandidate.candidate.candidateId
      }),
      rankedCandidate
    };
  }

  return assessFollowThrough({
    input,
    run,
    semantic,
    relation: link.relation,
    signal: link.signal,
    targetRef: link.githubTargetRef,
    base: linkedBase,
    rankContext
  });
}

function hasNewerManagedAttemptForSameTarget(
  input: ActiveAttentionInput,
  run: ManagedCodexPublicRunProjection,
  relation: ManagedCodexWorkRelation
): boolean {
  const currentStartedAt =
    input.managedRunStartedAtById[run.managedRunId];
  if (!currentStartedAt) return false;
  const currentStartedAtMs = Date.parse(currentStartedAt);
  return input.managedPublicProjection.runs.some((candidate) => {
    if (candidate.managedRunId === run.managedRunId) return false;
    const candidateStartedAt =
      input.managedRunStartedAtById[candidate.managedRunId];
    if (
      !candidateStartedAt ||
      Date.parse(candidateStartedAt) <= currentStartedAtMs
    ) {
      return false;
    }
    const resolution =
      input.workRelationProjection.runResolutions.find(
        (item) => item.managedRunId === candidate.managedRunId
      );
    if (
      !resolution ||
      resolution.status !== "resolved" ||
      resolution.bindingId !== candidate.bindingId ||
      resolution.executionId !== candidate.executionId ||
      resolution.relationId === null
    ) {
      return false;
    }
    const candidateRelation =
      input.workRelationProjection.relations.find(
        (item) => item.relationId === resolution.relationId
      );
    return (
      candidateRelation?.to.source === "github" &&
      candidateRelation.to.subjectId === relation.to.subjectId &&
      candidateRelation.bindingId === candidate.bindingId &&
      candidateRelation.from.subjectId === candidate.executionId &&
      candidateRelation.managedRunIds.includes(candidate.managedRunId)
    );
  });
}

function assessFollowThrough(input: {
  input: ActiveAttentionInput;
  run: ManagedCodexPublicRunProjection;
  semantic: ManagedCodexSemanticRunResult;
  relation: ManagedCodexWorkRelation;
  signal: GitHubWorkItemSignal;
  targetRef: string;
  rankContext: Phase2RankContext;
  base: Omit<
    ActiveAttentionAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes" | "candidateId"
  >;
}): DerivedAssessment {
  const projectId = input.relation.projectAlignment.projectId;
  const workflow = input.input.workflowProjection.activeWorkflows.find(
    (candidate) => candidate.projectId === projectId
  );
  // A preserved mapping can still name a project after that project is
  // archived. The normalized current GitHub signal intentionally drops
  // archived project membership, so require both views to agree before a
  // historical workflow decision can create a current follow-through.
  if (
    !workflow ||
    projectId === null ||
    input.signal.projectId !== projectId
  ) {
    return ineligible(
      input.base,
      "INELIGIBLE_FOLLOW_THROUGH_NOT_CONFIGURED"
    );
  }
  if (!workflowActionTargetCompatible(workflow.actionKind, input.signal)) {
    return ineligible(
      input.base,
      "INELIGIBLE_WORKFLOW_ACTION_TARGET_INCOMPATIBLE"
    );
  }
  const completion = input.semantic.detector.latestTurnEvidence;
  if (!completion) {
    return reviewed(input.base, {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MANAGED_SEMANTICS_MISSING",
      conflictIds: []
    });
  }
  const startedAt =
    input.input.managedRunStartedAtById[input.run.managedRunId];
  if (!startedAt) {
    return reviewed(input.base, {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MANAGED_SEMANTICS_MISSING",
      conflictIds: []
    });
  }
  if (Date.parse(workflow.configuredAt) > Date.parse(completion.observedAt)) {
    return ineligible(
      input.base,
      "INELIGIBLE_WORKFLOW_NOT_APPLICABLE_TO_RUN"
    );
  }
  if (
    !projectWorkflowGraceElapsed({
      workflow,
      managedRunStartedAt: startedAt,
      completedAt: completion.observedAt,
      asOf: input.input.asOf
    })
  ) {
    const applicable =
      Date.parse(workflow.configuredAt) <= Date.parse(startedAt);
    return ineligible(
      input.base,
      applicable
        ? "INELIGIBLE_FOLLOW_THROUGH_GRACE_ACTIVE"
        : "INELIGIBLE_WORKFLOW_NOT_APPLICABLE_TO_RUN"
    );
  }
  if (hasWorkflowClosure(input.input.workflowProjection, input.run, workflow)) {
    return ineligible(input.base, "INELIGIBLE_FOLLOW_THROUGH_CLOSED");
  }
  if (
    artifactClosesWorkflow(
      input.input.artifactRelationProjection,
      input.run,
      input.relation,
      workflow.actionKind
    )
  ) {
    return ineligible(
      input.base,
      "INELIGIBLE_FOLLOW_THROUGH_ARTIFACT_EXISTS"
    );
  }

  const rankedCandidate = buildFollowThroughCandidate({
    input: input.input,
    run: input.run,
    semantic: input.semantic,
    relation: input.relation,
    signal: input.signal,
    targetRef: input.targetRef,
    workflow,
    ...input.rankContext
  });
  return {
    assessment: completeAssessment(input.base, {
      actionKind: "close_loop",
      status: "eligible",
      reviewRoute: "none",
      reasonCodes: ["ELIGIBLE_CONFIGURED_FOLLOW_THROUGH"],
      candidateId: rankedCandidate.candidate.candidateId
    }),
    rankedCandidate
  };
}

function buildGitHubCandidate(input: {
  input: ActiveAttentionInput;
  upstream: AttentionEligibilityAssessment;
  signal: GitHubWorkItemSignal;
  deadline: GitHubDeadlineSignal | undefined;
  baseRank: number;
  focusMatched: boolean;
}): RankedCandidate {
  const due = dueClassification(
    input.input.asOf,
    input.input.baseAttentionInput.policy.dueSoonWindowMs,
    input.deadline?.facts.deadlineAt ?? null
  );
  const isReview =
    input.signal.facts.taskKind === "review_requested_pull_request";
  const isActionableAuthored =
    input.signal.facts.taskKind === "authored_pull_request" &&
    input.signal.facts.actionability?.actionRequired === true;
  const lane =
    due.urgent || isReview || isActionableAuthored
      ? due.urgent
        ? "must_now"
        : "unblock"
      : "focus";
  const candidateId = runtimeStableId(
    "attention",
    ACTIVE_ATTENTION_ID_POLICY_VERSION,
    {
      candidateSeedId: input.upstream.candidateSeedId,
      triggerKind: "github_work_item"
    }
  );
  const caveats: ActiveAttentionCaveatCode[] = [
    "CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES"
  ];
  if (isReview) caveats.push("CAVEAT_REVIEW_DRAFT_UNKNOWN");
  if (
    isActionableAuthored &&
    input.signal.facts.actionability?.collectionState === "partial"
  ) {
    caveats.push("CAVEAT_GITHUB_PR_ACTIONABILITY_PARTIAL");
  }
  if (
    input.input.eligibilityProjection.coverage.githubCandidateCoverage !==
    "complete"
  ) {
    caveats.push("CAVEAT_CANDIDATE_SET_INCOMPLETE");
  }
  return {
    candidate: {
      candidateId,
      candidateSeedId: input.upstream.candidateSeedId,
      triggerSource: "github",
      triggerKind: "github_work_item",
      targetRef: input.upstream.targetRef,
      githubSubjectId: input.signal.subjectId,
      projectId: input.signal.projectId,
      relationRef: null,
      managedRunId: null,
      bindingId: null,
      executionId: null,
      workflowDecisionId: null,
      workflowActionKind: null,
      taskKind: input.signal.facts.taskKind,
      title: input.signal.facts.title,
      repositoryFullName: input.signal.facts.repositoryFullName,
      number: input.signal.facts.number,
      intervention: isReview ? "inspect" : "do",
      lane,
      state: "open",
      dueAt: due.dueAt,
      destinationUrl: input.signal.facts.destinationUrl as string,
      certainty:
        isReview ||
        input.signal.facts.actionability?.collectionState === "partial" ||
        input.input.eligibilityProjection.coverage.githubCandidateCoverage !==
          "complete"
          ? "provisional"
          : "confirmed",
      reasonCodes: canonical(
        githubCandidateReasonCodes(input.signal)
      ),
      whyNowReasonCodes: canonical([
        ...(due.overdue
          ? (["WHY_NOW_NATIVE_DEADLINE_OVERDUE"] as const)
          : due.dueSoon
            ? (["WHY_NOW_NATIVE_DEADLINE_DUE_SOON"] as const)
            : []),
        ...(isReview
          ? (["WHY_NOW_REVIEW_REQUEST_OPEN"] as const)
          : isActionableAuthored
            ? githubAuthoredWhyNowReasonCodes(input.signal)
            : !due.urgent
              ? (["WHY_NOW_ASSIGNED_WORK_OPEN"] as const)
              : []),
        ...(input.focusMatched
          ? (["WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"] as const)
          : [])
      ]),
      caveatCodes: canonical(caveats),
      sourceEvidenceRefs: canonical([
        input.signal.signalId,
        input.upstream.assessmentId,
        ...(input.deadline ? [input.deadline.signalId] : [])
      ]),
      sourceUpdatedAt: input.signal.sourceUpdatedAt,
      firstStep: isReview
        ? `GitHub PR #${input.signal.facts.number}을 열어 draft 여부와 리뷰 가능 상태를 확인합니다.`
        : isActionableAuthored
          ? authoredPullRequestFirstStep(input.signal)
          : `GitHub issue #${input.signal.facts.number}을 열어 다음 행동을 확인합니다.`,
      explanation: `${
        isReview
          ? "현재 사용자에게 열린 PR 리뷰가 요청됐으며, 먼저 현재 리뷰 가능 상태를 확인해야 합니다."
          : isActionableAuthored
            ? authoredPullRequestExplanation(input.signal)
            : "현재 사용자에게 할당된 열린 GitHub 작업입니다."
      }${
        input.focusMatched
          ? " 사용자가 입력한 이번 주 결과와 텍스트가 직접 겹칩니다."
          : ""
      }`,
      upstreamObjectsRemainForbidden: true,
      attentionDisposition: "active_candidate"
    },
    ranking: ranking({
      lane,
      due,
      specificityRank: 2,
      baseRank: input.baseRank,
      sourceUpdatedAt: input.signal.sourceUpdatedAt
    })
  };
}

function githubCandidateReasonCodes(
  signal: GitHubWorkItemSignal
): ActiveAttentionCandidate["reasonCodes"] {
  if (signal.facts.taskKind === "assigned_issue") {
    return ["CANDIDATE_GITHUB_ASSIGNED_ISSUE"];
  }
  if (signal.facts.taskKind === "review_requested_pull_request") {
    return ["CANDIDATE_GITHUB_REVIEW_STATUS_CHECK"];
  }
  const reasons = signal.facts.actionability?.actionRequiredReasons ?? [];
  return reasons.map((reason) => {
    switch (reason) {
      case "checks_failed":
        return "CANDIDATE_GITHUB_AUTHORED_PR_CHECKS_FAILED" as const;
      case "changes_requested":
        return "CANDIDATE_GITHUB_AUTHORED_PR_CHANGES_REQUESTED" as const;
      case "merge_conflict":
        return "CANDIDATE_GITHUB_AUTHORED_PR_MERGE_CONFLICT" as const;
    }
  });
}

function githubAuthoredWhyNowReasonCodes(
  signal: GitHubWorkItemSignal
): ActiveAttentionCandidate["whyNowReasonCodes"] {
  return (signal.facts.actionability?.actionRequiredReasons ?? []).map(
    (reason) => {
      switch (reason) {
        case "checks_failed":
          return "WHY_NOW_AUTHORED_PR_CHECKS_FAILED" as const;
        case "changes_requested":
          return "WHY_NOW_AUTHORED_PR_CHANGES_REQUESTED" as const;
        case "merge_conflict":
          return "WHY_NOW_AUTHORED_PR_MERGE_CONFLICT" as const;
      }
    }
  );
}

function authoredPullRequestFirstStep(
  signal: GitHubWorkItemSignal
): string {
  const reasons = new Set(
    signal.facts.actionability?.actionRequiredReasons ?? []
  );
  if (reasons.has("merge_conflict")) {
    return `GitHub PR #${signal.facts.number}을 열어 충돌 파일과 base branch 변경을 확인합니다.`;
  }
  if (reasons.has("changes_requested")) {
    return `GitHub PR #${signal.facts.number}을 열어 요청된 변경 사항을 확인합니다.`;
  }
  return `GitHub PR #${signal.facts.number}을 열어 실패한 check를 확인합니다.`;
}

function authoredPullRequestExplanation(
  signal: GitHubWorkItemSignal
): string {
  const reasons = signal.facts.actionability?.actionRequiredReasons ?? [];
  const labels = reasons.map((reason) => {
    switch (reason) {
      case "checks_failed":
        return "실패한 check";
      case "changes_requested":
        return "변경 요청";
      case "merge_conflict":
        return "merge conflict";
    }
  });
  return `사용자가 작성한 열린 PR에서 ${labels.join(
    ", "
  )} 상태가 GitHub 현재 데이터로 확인됐습니다.`;
}

function buildManagedFailureCandidate(input: {
  input: ActiveAttentionInput;
  run: ManagedCodexPublicRunProjection;
  semantic: ManagedCodexSemanticRunResult;
  relation: ManagedCodexWorkRelation;
  signal: GitHubWorkItemSignal;
  targetRef: string;
  baseRank: number;
  focusMatched: boolean;
}): RankedCandidate {
  const deadline = matchingDeadline(input.input.githubBatch, input.signal);
  const due = dueClassification(
    input.input.asOf,
    input.input.baseAttentionInput.policy.dueSoonWindowMs,
    deadline?.facts.deadlineAt ?? null
  );
  const lane = due.urgent ? "must_now" : "unblock";
  const seedId = runtimeStableId(
    "seed",
    ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
    {
      triggerSource: "codex_managed",
      triggerKind: "managed_failure",
      managedRunId: input.run.managedRunId,
      bindingId: input.run.bindingId,
      executionId: input.run.executionId
    }
  );
  const candidateId = runtimeStableId(
    "attention",
    ACTIVE_ATTENTION_ID_POLICY_VERSION,
    { candidateSeedId: seedId, targetRef: input.targetRef }
  );
  const failureEvidence = input.semantic.detector.failureEvidence;
  return {
    candidate: {
      candidateId,
      candidateSeedId: seedId,
      triggerSource: "codex_managed",
      triggerKind: "managed_failure",
      targetRef: input.targetRef,
      githubSubjectId: input.signal.subjectId,
      projectId:
        input.relation.projectAlignment.projectId ?? input.signal.projectId,
      relationRef: input.relation.relationId,
      managedRunId: input.run.managedRunId,
      bindingId: input.run.bindingId,
      executionId: input.run.executionId,
      workflowDecisionId: null,
      workflowActionKind: null,
      taskKind: input.signal.facts.taskKind,
      title: input.signal.facts.title,
      repositoryFullName: input.signal.facts.repositoryFullName,
      number: input.signal.facts.number,
      intervention: "inspect",
      lane,
      state: "failed",
      dueAt: due.dueAt,
      destinationUrl: input.relation.githubObservation.destinationUrl as string,
      certainty: "confirmed",
      reasonCodes: ["CANDIDATE_CODEX_LATEST_DIRECT_FAILURE"],
      whyNowReasonCodes: canonical([
        "WHY_NOW_MANAGED_FAILURE_CURRENT",
        ...(due.overdue
          ? (["WHY_NOW_NATIVE_DEADLINE_OVERDUE"] as const)
          : due.dueSoon
            ? (["WHY_NOW_NATIVE_DEADLINE_DUE_SOON"] as const)
            : []),
        ...(input.focusMatched
          ? (["WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"] as const)
          : [])
      ]),
      caveatCodes: canonical([
        "CAVEAT_MANAGED_FAILURE_INSPECTION_ONLY",
        "CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES"
      ]),
      sourceEvidenceRefs: canonical([
        input.relation.relationId,
        input.semantic.detector.detectorSha256,
        ...(failureEvidence ? [failureEvidence.evidenceId] : []),
        input.signal.signalId,
        ...(deadline ? [deadline.signalId] : [])
      ]),
      sourceUpdatedAt: failureEvidence?.observedAt ?? input.run.lastObservedAt,
      firstStep: `연결된 GitHub 작업 #${input.signal.facts.number}을 열어 Codex 실행 실패의 현재 원인을 확인합니다.`,
      explanation: `동일한 managed Codex run의 최신 직접 실패가 연속된 이벤트와 현재 상태 claim으로 확인됐습니다.${
        input.focusMatched
          ? " 연결된 작업은 사용자가 입력한 이번 주 결과와 텍스트가 직접 겹칩니다."
          : ""
      }`,
      upstreamObjectsRemainForbidden: true,
      attentionDisposition: "active_candidate"
    },
    ranking: ranking({
      lane,
      due,
      specificityRank: 0,
      baseRank: input.baseRank,
      sourceUpdatedAt:
        failureEvidence?.observedAt ?? input.run.lastObservedAt
    })
  };
}

function buildFollowThroughCandidate(input: {
  input: ActiveAttentionInput;
  run: ManagedCodexPublicRunProjection;
  semantic: ManagedCodexSemanticRunResult;
  relation: ManagedCodexWorkRelation;
  signal: GitHubWorkItemSignal;
  targetRef: string;
  workflow: ActiveProjectWorkflow;
  baseRank: number;
  focusMatched: boolean;
}): RankedCandidate {
  const deadline = matchingDeadline(input.input.githubBatch, input.signal);
  const due = dueClassification(
    input.input.asOf,
    input.input.baseAttentionInput.policy.dueSoonWindowMs,
    deadline?.facts.deadlineAt ?? null
  );
  const lane = due.urgent ? "must_now" : "close_loop";
  const seedId = runtimeStableId(
    "seed",
    ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
    {
      triggerSource: "codex_managed",
      triggerKind: "configured_follow_through",
      managedRunId: input.run.managedRunId,
      bindingId: input.run.bindingId,
      executionId: input.run.executionId
    }
  );
  const candidateId = runtimeStableId(
    "attention",
    ACTIVE_ATTENTION_ID_POLICY_VERSION,
    {
      candidateSeedId: seedId,
      workflowDecisionId: input.workflow.workflowDecisionId,
      targetRef: input.targetRef
    }
  );
  const completion = input.semantic.detector.latestTurnEvidence;
  return {
    candidate: {
      candidateId,
      candidateSeedId: seedId,
      triggerSource: "codex_managed",
      triggerKind: "configured_follow_through",
      targetRef: input.targetRef,
      githubSubjectId: input.signal.subjectId,
      projectId: input.workflow.projectId,
      relationRef: input.relation.relationId,
      managedRunId: input.run.managedRunId,
      bindingId: input.run.bindingId,
      executionId: input.run.executionId,
      workflowDecisionId: input.workflow.workflowDecisionId,
      workflowActionKind: input.workflow.actionKind,
      taskKind: input.signal.facts.taskKind,
      title: input.signal.facts.title,
      repositoryFullName: input.signal.facts.repositoryFullName,
      number: input.signal.facts.number,
      intervention: "close_loop",
      lane,
      state: "not_started",
      dueAt: due.dueAt,
      destinationUrl: input.relation.githubObservation.destinationUrl as string,
      certainty: "confirmed",
      reasonCodes: [workflowCandidateReason(input.workflow.actionKind)],
      whyNowReasonCodes: canonical([
        "WHY_NOW_CONFIGURED_HANDOFF_OPEN",
        ...(due.overdue
          ? (["WHY_NOW_NATIVE_DEADLINE_OVERDUE"] as const)
          : due.dueSoon
            ? (["WHY_NOW_NATIVE_DEADLINE_DUE_SOON"] as const)
            : []),
        ...(input.focusMatched
          ? (["WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"] as const)
          : [])
      ]),
      caveatCodes: ["CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES"],
      sourceEvidenceRefs: canonical([
        input.relation.relationId,
        input.workflow.workflowDecisionId,
        input.semantic.detector.detectorSha256,
        ...(completion ? [completion.evidenceId] : []),
        input.signal.signalId,
        ...(deadline ? [deadline.signalId] : [])
      ]),
      sourceUpdatedAt: completion?.observedAt ?? input.run.lastObservedAt,
      firstStep: workflowFirstStep(
        input.workflow.actionKind,
        input.signal
      ),
      explanation: `Codex 실행 완료 뒤, 실행 시작 전에 사용자가 설정한 프로젝트 후속 작업이 아직 닫히지 않았습니다.${
        input.focusMatched
          ? " 연결된 작업은 사용자가 입력한 이번 주 결과와 텍스트가 직접 겹칩니다."
          : ""
      }`,
      upstreamObjectsRemainForbidden: true,
      attentionDisposition: "active_candidate"
    },
    ranking: ranking({
      lane,
      due,
      specificityRank: 1,
      baseRank: input.baseRank,
      sourceUpdatedAt: completion?.observedAt ?? input.run.lastObservedAt
    })
  };
}

function resolveActiveLink(
  input: ActiveAttentionInput,
  run: ManagedCodexPublicRunProjection
):
  | {
      status: "resolved";
      relation: ManagedCodexWorkRelation;
      signal: GitHubWorkItemSignal;
      githubTargetRef: string;
    }
  | ReviewResult
  | { status: "ineligible"; reason: ActiveAttentionReasonCode } {
  const resolution = input.workRelationProjection.runResolutions.find(
    (candidate) => candidate.managedRunId === run.managedRunId
  );
  if (!resolution || resolution.status !== "resolved" || !resolution.relationId) {
    return { status: "ineligible", reason: "INELIGIBLE_LINK_NOT_ACTIVE" };
  }
  const relation = input.workRelationProjection.relations.find(
    (candidate) => candidate.relationId === resolution.relationId
  );
  if (!relation) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_LINK_TARGET_NOT_CURRENT",
      conflictIds: []
    };
  }
  if (relation.identityStatus === "conflict") {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_LINK_IDENTITY_CONFLICT",
      conflictIds: []
    };
  }
  if (relation.projectAlignment.status === "conflict") {
    return {
      status: "review_required",
      route: "user_review",
      reason: "REVIEW_LINK_PROJECT_MISMATCH",
      conflictIds: []
    };
  }
  if (
    relation.bindingId !== run.bindingId ||
    relation.from.subjectId !== run.executionId ||
    !relation.managedRunIds.includes(run.managedRunId) ||
    relation.bindingEvidence.bindingState !== "active"
  ) {
    return { status: "ineligible", reason: "INELIGIBLE_LINK_NOT_ACTIVE" };
  }
  if (
    relation.githubObservation.status !== "current" ||
    relation.githubObservation.completeness !== "complete" ||
    relation.githubObservation.destinationUrl === null
  ) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_LINK_TARGET_NOT_CURRENT",
      conflictIds: []
    };
  }
  const signal = input.githubBatch?.signals.find(
    (candidate): candidate is GitHubWorkItemSignal =>
      candidate.kind === "work_item_observation" &&
      candidate.subjectId === relation.to.subjectId &&
      candidate.facts.taskKind ===
        relation.githubObservation.taskKind &&
      relation.githubObservation.signalIds.includes(candidate.signalId)
  );
  if (
    !signal ||
    signal.completeness !== "complete" ||
    signal.facts.destinationUrl === null ||
    signal.facts.destinationUrl !== relation.githubObservation.destinationUrl
  ) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_LINK_TARGET_NOT_CURRENT",
      conflictIds: []
    };
  }
  return {
    status: "resolved",
    relation,
    signal,
    githubTargetRef: createClaimTargetRef({
      kind: "github_work_item",
      identity: {
        sourceScopeId: signal.sourceScopeId,
        subjectId: signal.subjectId
      }
    })
  };
}

function reviewSemanticWindow(
  run: ManagedCodexPublicRunProjection,
  semantic: ManagedCodexSemanticRunResult | undefined
): ReviewResult | null {
  if (
    !semantic ||
    semantic.bindingId !== run.bindingId ||
    semantic.executionId !== run.executionId
  ) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MANAGED_SEMANTICS_MISSING",
      conflictIds: []
    };
  }
  if (semantic.window.historyCompleteness !== "complete") {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_SOURCE_HISTORY_PRUNED",
      conflictIds: []
    };
  }
  if (
    semantic.window.continuity !== "continuous" ||
    run.continuity !== "continuous"
  ) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_SOURCE_GAP",
      conflictIds: []
    };
  }
  if (semantic.window.clockQuality !== "monotonic") {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_SOURCE_CLOCK_REGRESSED",
      conflictIds: []
    };
  }
  if (
    !managedRunHasVerifiedTerminalEvidence(run, semantic) &&
    (!run.liveObservationAvailable ||
      run.effectiveExecutionState === "unknown")
  ) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_MANAGED_LIVE_OBSERVATION_UNAVAILABLE",
      conflictIds: []
    };
  }
  return null;
}

function managedRunHasVerifiedTerminalEvidence(
  run: ManagedCodexPublicRunProjection,
  semantic: ManagedCodexSemanticRunResult
): boolean {
  if (run.lifecycle !== "ended" && run.lifecycle !== "failed") {
    return false;
  }
  const failureEvidence = semantic.detector.failureEvidence;
  if (
    run.lifecycle === "failed" &&
    semantic.detector.failureLifecycle ===
      "latest_direct_managed_run_failure" &&
    failureEvidence?.sourceEvent === "run_failed"
  ) {
    return true;
  }
  const state = run.effectiveExecutionState;
  const turnEvidence = semantic.detector.latestTurnEvidence;
  return (
    (state === "completed" ||
      state === "failed" ||
      state === "interrupted") &&
    turnEvidence?.sourceEvent === "turn_completed" &&
    turnEvidence.executionState === state
  );
}

function isLatestDirectFailure(
  run: ManagedCodexPublicRunProjection,
  semantic: ManagedCodexSemanticRunResult | undefined
): boolean {
  if (!semantic) return false;
  const lifecycle = semantic.detector.failureLifecycle;
  const evidence = semantic.detector.failureEvidence;
  if (lifecycle === "latest_direct_turn_failure") {
    return (
      run.effectiveExecutionState === "failed" &&
      evidence?.sourceEvent === "turn_completed" &&
      evidence.executionState === "failed"
    );
  }
  return (
    lifecycle === "latest_direct_managed_run_failure" &&
    run.lifecycle === "failed" &&
    evidence?.sourceEvent === "run_failed"
  );
}

function isLatestDirectCompletion(
  run: ManagedCodexPublicRunProjection,
  semantic: ManagedCodexSemanticRunResult | undefined
): boolean {
  const evidence = semantic?.detector.latestTurnEvidence;
  return (
    run.effectiveExecutionState === "completed" &&
    semantic?.detector.latestTurnState === "completed" &&
    evidence?.sourceEvent === "turn_completed" &&
    evidence.executionState === "completed"
  );
}

function resolveMaterialClaim(
  targetRef: string,
  field: ClaimField,
  projection: ClaimAuthorityProjection
): MaterialClaimResult {
  const claimKey = createClaimKey({ targetRef, field });
  const resolution = projection.fieldResolutions.find(
    (candidate) => candidate.claimKey === claimKey
  );
  const conflict = projection.conflicts.find(
    (candidate) => candidate.claimKey === claimKey
  );
  if (!resolution) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason:
        field === "managed_codex_execution_state"
          ? "REVIEW_MANAGED_STATE_CLAIM_MISSING"
          : "REVIEW_GITHUB_STATE_CLAIM_MISSING",
      conflictIds: []
    };
  }
  if (resolution.status !== "resolved" || !resolution.winningClaimId) {
    const userReview = conflict?.nextAction === "user_review";
    return {
      status: "review_required",
      route: userReview ? "user_review" : "refresh_sources",
      reason: userReview
        ? "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER"
        : conflict?.nextAction === "refresh_sources"
          ? "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH"
          : field === "managed_codex_execution_state"
            ? "REVIEW_MANAGED_STATE_CLAIM_UNRESOLVED"
            : "REVIEW_GITHUB_STATE_CLAIM_UNRESOLVED",
      conflictIds: conflict ? [conflict.conflictId] : []
    };
  }
  const claim = projection.claims.find(
    (candidate) => candidate.claimId === resolution.winningClaimId
  );
  if (!claim) {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason:
        field === "managed_codex_execution_state"
          ? "REVIEW_MANAGED_STATE_CLAIM_MISSING"
          : "REVIEW_GITHUB_STATE_CLAIM_MISSING",
      conflictIds: []
    };
  }
  if (claim.freshness !== "current" || claim.completeness !== "complete") {
    return {
      status: "review_required",
      route: "refresh_sources",
      reason: "REVIEW_SOURCE_STALE",
      conflictIds: []
    };
  }
  return { status: "resolved", claim };
}

function unresolvedRelevantConflict(
  refs: { targetRefs: string[]; relationRefs: string[] },
  projection: ClaimAuthorityProjection
): ReviewResult | null {
  const unresolved = relevantConflicts(refs, projection).filter(
    (conflict) => conflict.status === "review_required"
  );
  if (unresolved.length === 0) return null;
  const userReview = unresolved.some(
    (conflict) => conflict.nextAction === "user_review"
  );
  return {
    status: "review_required",
    route: userReview ? "user_review" : "refresh_sources",
    reason: userReview
      ? "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER"
      : "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH",
    conflictIds: unresolved
      .map((conflict) => conflict.conflictId)
      .sort(compareRuntimeStrings)
  };
}

function relevantConflicts(
  refs: { targetRefs: string[]; relationRefs: string[] },
  projection: ClaimAuthorityProjection
): ClaimConflict[] {
  const targets = new Set(refs.targetRefs);
  const relations = new Set(refs.relationRefs);
  return projection.conflicts
    .filter(
      (conflict) =>
        targets.has(conflict.target.ref) ||
        conflict.relationRefs.some((relation) => relations.has(relation))
    )
    .sort((left, right) =>
      compareRuntimeStrings(left.conflictId, right.conflictId)
    );
}

function hasWorkflowClosure(
  workflows: ProjectWorkflowProjection,
  run: ManagedCodexPublicRunProjection,
  workflow: ActiveProjectWorkflow
): boolean {
  return workflows.closures.some(
    (closure) =>
      closure.managedRunId === run.managedRunId &&
      closure.bindingId === run.bindingId &&
      closure.executionId === run.executionId &&
      closure.workflowDecisionId === workflow.workflowDecisionId &&
      closure.actionKind === workflow.actionKind &&
      (closure.outcome === "completed" || closure.outcome === "skipped")
  );
}

function artifactClosesWorkflow(
  artifacts: ManagedCodexArtifactRelationProjection,
  run: ManagedCodexPublicRunProjection,
  relation: ManagedCodexWorkRelation,
  actionKind: ProjectWorkflowActionKind
): boolean {
  const closingKind =
    actionKind === "commit_changes"
      ? "github_commit"
      : actionKind === "create_pull_request"
        ? "github_pull_request"
        : null;
  if (closingKind === null) return false;
  return artifacts.relations.some(
    (artifact) =>
      artifact.managedRunId === run.managedRunId &&
      artifact.bindingId === run.bindingId &&
      artifact.executionId === run.executionId &&
      artifact.executesRelationId === relation.relationId &&
      artifact.attributionLifecycle.state === "active" &&
      artifact.artifact.kind === closingKind
  );
}

function suppressDuplicateOpenLoops(
  assessments: DerivedAssessment[]
): DerivedAssessment[] {
  const byTarget = new Map<string, DerivedAssessment[]>();
  for (const item of assessments) {
    if (!item.rankedCandidate) continue;
    const target = item.rankedCandidate.candidate.targetRef;
    byTarget.set(target, [...(byTarget.get(target) ?? []), item]);
  }
  const suppressedIds = new Set<string>();
  for (const group of byTarget.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(
      (left, right) =>
        specificityFor(left.rankedCandidate!.candidate.triggerKind) -
          specificityFor(right.rankedCandidate!.candidate.triggerKind) ||
        compareRuntimeStrings(
          left.rankedCandidate!.candidate.candidateId,
          right.rankedCandidate!.candidate.candidateId
        )
    );
    ordered.slice(1).forEach((item) =>
      suppressedIds.add(item.assessment.assessmentId)
    );
  }
  return assessments.map((item) => {
    if (!suppressedIds.has(item.assessment.assessmentId)) return item;
    return {
      assessment: completeAssessment(
        assessmentCore(item.assessment),
        {
          actionKind: null,
          status: "ineligible",
          reviewRoute: "none",
          reasonCodes: ["INELIGIBLE_DUPLICATE_OPEN_LOOP"],
          candidateId: null
        }
      ),
      rankedCandidate: null
    };
  });
}

function deriveCoverage(input: ActiveAttentionInput): {
  candidateUniverse: "github_and_managed_codex";
  githubCandidateCoverage:
    | "complete"
    | "partial"
    | "stale"
    | "unavailable";
  managedCodexCoverage: "complete" | "partial" | "unavailable";
  workflowCoverage: "evaluated";
  negativeCandidateCoverageComplete: boolean;
} {
  const github = input.eligibilityProjection.coverage.githubCandidateCoverage;
  const publicRunIds = input.managedPublicProjection.runs.map(
    (run) => run.managedRunId
  );
  const semanticRunIds = Object.keys(input.managedSemanticProjection.runs);
  const resolutionRunIds = input.workRelationProjection.runResolutions.map(
    (resolution) => resolution.managedRunId
  );
  const managedComplete =
    input.workRelationProjection.omittedManagedRunCount === 0 &&
    sameCanonicalSet(publicRunIds, semanticRunIds) &&
    sameCanonicalSet(publicRunIds, resolutionRunIds) &&
    input.managedPublicProjection.runs.every((run) => {
      const semantic =
        input.managedSemanticProjection.runs[run.managedRunId];
      return reviewSemanticWindow(run, semantic) === null;
    });
  const managedCodexCoverage = managedComplete
    ? ("complete" as const)
    : input.managedPublicProjection.runs.length === 0
      ? ("unavailable" as const)
      : ("partial" as const);
  return {
    candidateUniverse: "github_and_managed_codex",
    githubCandidateCoverage: github,
    managedCodexCoverage,
    workflowCoverage: "evaluated",
    negativeCandidateCoverageComplete:
      github === "complete" && managedCodexCoverage === "complete"
  };
}

function deriveDecision(
  assessments: ActiveAttentionAssessment[],
  candidates: ActiveAttentionCandidate[],
  coverage: ReturnType<typeof deriveCoverage>,
  stableIdTieBreakUsed: boolean
): ActiveAttentionResult["decision"] {
  if (candidates.length > 0) {
    const top = candidates[0]!;
    const caveats: ActiveAttentionCaveatCode[] = [];
    if (stableIdTieBreakUsed) {
      caveats.push("CAVEAT_DEFAULT_TIE_BREAK_USED");
    }
    if (
      !coverage.negativeCandidateCoverageComplete ||
      assessments.some(
        (assessment) => assessment.status === "review_required"
      )
    ) {
      caveats.push("CAVEAT_CANDIDATE_SET_INCOMPLETE");
    }
    const provisional =
      top.certainty === "provisional" ||
      caveats.includes("CAVEAT_CANDIDATE_SET_INCOMPLETE");
    return {
      status: "suggested",
      certainty: provisional ? "provisional" : "confirmed",
      topSuggestion: top,
      alternatives: candidates.slice(1, 3),
      clarification: null,
      reasonCodes: ["DECISION_BEST_ELIGIBLE_CANDIDATE"],
      caveatCodes: canonical(caveats),
      scopeStatement:
        "현재 GitHub 작업과 Blabase가 관리하는 Codex 실행 중 검증된 후보에서 한 가지를 선택했습니다."
    };
  }
  const refresh = assessments.find(
    (assessment) =>
      assessment.status === "review_required" &&
      assessment.reviewRoute === "refresh_sources"
  );
  if (refresh) {
    return {
      status: "insufficient_evidence",
      certainty: null,
      topSuggestion: null,
      alternatives: [],
      clarification: null,
      reasonCodes: ["DECISION_REFRESH_REQUIRED"],
      caveatCodes: [],
      scopeStatement:
        "현재 평가 범위의 source 증거를 먼저 갱신해야 안전하게 한 가지를 고를 수 있습니다."
    };
  }
  const userReview = assessments.find(
    (assessment) =>
      assessment.status === "review_required" &&
      assessment.reviewRoute === "user_review"
  );
  if (userReview) {
    return {
      status: "needs_clarification",
      certainty: null,
      topSuggestion: null,
      alternatives: [],
      clarification: {
        clarificationId: runtimeStableId(
          "attention_clarification",
          ACTIVE_ATTENTION_ID_POLICY_VERSION,
          {
            candidateSeedId: userReview.candidateSeedId,
            conflictIds: userReview.relatedConflictIds,
            relationRefs: userReview.relationRefs
          }
        ),
        candidateSeedId: userReview.candidateSeedId,
        triggerSource: userReview.triggerSource,
        targetRef: userReview.targetRef,
        question:
          "연결된 source의 충돌 또는 사용자 확인 연결 중 어느 상태가 현재 사실인지 확인해주세요.",
        relationRefs: userReview.relationRefs,
        conflictIds: userReview.relatedConflictIds
      },
      reasonCodes: ["DECISION_USER_CLARIFICATION_REQUIRED"],
      caveatCodes: [],
      scopeStatement:
        "현재 평가 범위에 사용자가 확인해야 하는 관련 source 충돌이 있습니다."
    };
  }
  if (coverage.negativeCandidateCoverageComplete) {
    return {
      status: "no_action",
      certainty: "scoped",
      topSuggestion: null,
      alternatives: [],
      clarification: null,
      reasonCodes: ["DECISION_SCOPED_NO_ACTION"],
      caveatCodes: [],
      scopeStatement:
        "현재 평가 가능한 GitHub 작업과 managed Codex 실행 범위에는 개입할 일이 없습니다."
    };
  }
  return {
    status: "insufficient_evidence",
    certainty: null,
    topSuggestion: null,
    alternatives: [],
    clarification: null,
    reasonCodes: ["DECISION_RELEVANT_COVERAGE_INSUFFICIENT"],
    caveatCodes: [],
    scopeStatement:
      "현재 평가하지 못한 source 또는 누락된 실행 증거가 있어 한 가지를 고르지 않습니다."
  };
}

function assertExactDependencies(
  input: ActiveAttentionInput
): void {
  const githubBatchSha = input.githubBatch?.batchSha256 ?? null;
  const githubSnapshotSha =
    input.githubBatch?.sourceSnapshotSha256 ?? null;
  const eligibility = input.eligibilityProjection.dependencies;
  const work = input.workRelationProjection;
  const artifacts = input.artifactRelationProjection;
  const claims = input.claimAuthorityProjection;
  const managed = input.managedPublicProjection;
  const semantics = input.managedSemanticProjection;
  const publicRunIds = managed.runs
    .map((run) => run.managedRunId)
    .sort(compareRuntimeStrings);
  const startedRunIds = Object.keys(input.managedRunStartedAtById).sort(
    compareRuntimeStrings
  );
  const asOfMs = Date.parse(input.asOf);
  const futureManagedEvidence =
    Object.values(input.managedRunStartedAtById).some(
      (startedAt) => Date.parse(startedAt) > asOfMs
    ) ||
    managed.runs.some((run) => Date.parse(run.lastObservedAt) > asOfMs) ||
    Object.values(semantics.runs).some((run) =>
      run.window.evidence.some(
        (evidence) => Date.parse(evidence.observedAt) > asOfMs
      )
    );

  if (
    input.contract !== ACTIVE_ATTENTION_INPUT_CONTRACT ||
    eligibility.githubBatchSha256 !== githubBatchSha ||
    eligibility.githubSourceSnapshotSha256 !== githubSnapshotSha ||
    eligibility.workRelationProjectionSha256 !== work.projectionSha256 ||
    eligibility.artifactRelationProjectionSha256 !==
      artifacts.projectionSha256 ||
    eligibility.claimAuthorityProjectionSha256 !== claims.projectionSha256 ||
    eligibility.managedSemanticProjectionSha256 !==
      semantics.projectionSha256 ||
    eligibility.managedSourceRevision !== managed.revision ||
    eligibility.managedGeneratedAt !== managed.generatedAt ||
    managed.generatedAt !== input.asOf ||
    work.managedSourceRevision !== managed.revision ||
    work.managedGeneratedAt !== managed.generatedAt ||
    semantics.sourceRevision !== managed.revision ||
    semantics.generatedAt !== managed.generatedAt ||
    work.githubBatchSha256 !== githubBatchSha ||
    artifacts.githubBatchSha256 !== githubBatchSha ||
    claims.inputs.githubBatchSha256 !== githubBatchSha ||
    work.githubSourceSnapshotSha256 !== githubSnapshotSha ||
    artifacts.githubSourceSnapshotSha256 !== githubSnapshotSha ||
    claims.inputs.githubSourceSnapshotSha256 !== githubSnapshotSha ||
    artifacts.workRelationProjectionSha256 !== work.projectionSha256 ||
    claims.inputs.workRelationProjectionSha256 !== work.projectionSha256 ||
    claims.inputs.artifactRelationProjectionSha256 !==
      artifacts.projectionSha256 ||
    claims.inputs.managedSemanticProjectionSha256 !==
      semantics.projectionSha256 ||
    claims.inputs.managedSourceRevision !== managed.revision ||
    claims.inputs.managedGeneratedAt !== managed.generatedAt ||
    eligibility.contextRegistrySha256 !== work.contextRegistrySha256 ||
    claims.inputs.contextRegistrySha256 !== work.contextRegistrySha256 ||
    publicRunIds.join("|") !== startedRunIds.join("|") ||
    futureManagedEvidence
  ) {
    throw new TypeError(
      "Active Attention inputs must share one exact replayable evidence graph."
    );
  }
}

function activeAssessmentBase(input: {
  candidateSeedId: string;
  triggerSource: "github" | "codex_managed";
  triggerKind:
    | "github_work_item"
    | "managed_failure"
    | "configured_follow_through";
  sourceSignalId: string | null;
  managedRunId: string | null;
  targetRef: string;
  githubSubjectId: string | null;
  relationRefs: string[];
  conflictIds: string[];
}): Omit<
  ActiveAttentionAssessment,
  "actionKind" | "status" | "reviewRoute" | "reasonCodes" | "candidateId"
> {
  return {
    assessmentId: runtimeStableId(
      "attention_assessment",
      ACTIVE_ATTENTION_ID_POLICY_VERSION,
      {
        candidateSeedId: input.candidateSeedId,
        triggerKind: input.triggerKind
      }
    ),
    candidateSeedId: input.candidateSeedId,
    triggerSource: input.triggerSource,
    triggerKind: input.triggerKind,
    sourceSignalId: input.sourceSignalId,
    managedRunId: input.managedRunId,
    targetRef: input.targetRef,
    githubSubjectId: input.githubSubjectId,
    relationRefs: canonical(input.relationRefs),
    relatedConflictIds: canonical(input.conflictIds),
    upstreamObjectsRemainForbidden: true,
    attentionDisposition: "active_gate_assessment"
  };
}

function assessmentCore(
  assessment: ActiveAttentionAssessment
): Omit<
  ActiveAttentionAssessment,
  "actionKind" | "status" | "reviewRoute" | "reasonCodes" | "candidateId"
> {
  const {
    actionKind: _actionKind,
    status: _status,
    reviewRoute: _reviewRoute,
    reasonCodes: _reasonCodes,
    candidateId: _candidateId,
    ...core
  } = assessment;
  return core;
}

function completeAssessment(
  base: Omit<
    ActiveAttentionAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes" | "candidateId"
  >,
  result: Pick<
    ActiveAttentionAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes" | "candidateId"
  >
): ActiveAttentionAssessment {
  return {
    ...base,
    ...result,
    reasonCodes: canonical(result.reasonCodes)
  };
}

function reviewed(
  base: Omit<
    ActiveAttentionAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes" | "candidateId"
  >,
  review: ReviewResult
): DerivedAssessment {
  return {
    assessment: completeAssessment(
      {
        ...base,
        relatedConflictIds: canonical([
          ...base.relatedConflictIds,
          ...review.conflictIds
        ])
      },
      {
        actionKind:
          base.triggerKind === "configured_follow_through"
            ? "close_loop"
            : "inspect",
        status: "review_required",
        reviewRoute: review.route,
        reasonCodes: [review.reason],
        candidateId: null
      }
    ),
    rankedCandidate: null
  };
}

function ineligible(
  base: Omit<
    ActiveAttentionAssessment,
    "actionKind" | "status" | "reviewRoute" | "reasonCodes" | "candidateId"
  >,
  reason: ActiveAttentionReasonCode
): DerivedAssessment {
  return {
    assessment: completeAssessment(base, {
      actionKind: null,
      status: "ineligible",
      reviewRoute: "none",
      reasonCodes: [reason],
      candidateId: null
    }),
    rankedCandidate: null
  };
}

function mapUpstreamEligibilityReason(
  assessment: AttentionEligibilityAssessment
): ActiveAttentionReasonCode {
  if (assessment.status === "ineligible") {
    return "INELIGIBLE_UPSTREAM_GATE";
  }
  if (assessment.reviewRoute === "user_review") {
    return "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER";
  }
  if (
    assessment.reasonCodes.includes("REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH")
  ) {
    return "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH";
  }
  if (assessment.reasonCodes.includes("REVIEW_SOURCE_STALE")) {
    return "REVIEW_SOURCE_STALE";
  }
  return "REVIEW_GITHUB_STATE_CLAIM_UNRESOLVED";
}

function matchingDeadline(
  batch: RuntimeWorkSignalBatch | null,
  signal: GitHubWorkItemSignal
): GitHubDeadlineSignal | undefined {
  return batch?.signals
    .filter(
      (candidate): candidate is GitHubDeadlineSignal =>
        candidate.kind === "deadline_observation" &&
        candidate.subjectId === signal.subjectId &&
        candidate.facts.taskKind === signal.facts.taskKind &&
        candidate.attentionCapability === "candidate_input" &&
        candidate.completeness === "complete"
    )
    .sort(
      (left, right) =>
        Date.parse(left.facts.deadlineAt) -
          Date.parse(right.facts.deadlineAt) ||
        compareRuntimeStrings(left.signalId, right.signalId)
    )[0];
}

function dueClassification(
  asOf: string,
  dueSoonWindowMs: number,
  dueAt: string | null
): {
  dueAt: string | null;
  overdue: boolean;
  dueSoon: boolean;
  urgent: boolean;
  bucket: number;
} {
  const now = Date.parse(asOf);
  const due = dueAt === null ? null : Date.parse(dueAt);
  const overdue = due !== null && due < now;
  const dueSoon =
    due !== null && due >= now && due <= now + dueSoonWindowMs;
  return {
    dueAt,
    overdue,
    dueSoon,
    urgent: overdue || dueSoon,
    bucket: overdue ? 0 : dueSoon ? 1 : 2
  };
}

function ranking(input: {
  lane: ActiveAttentionCandidate["lane"];
  due: ReturnType<typeof dueClassification>;
  specificityRank: number;
  baseRank: number;
  sourceUpdatedAt: string | null;
}): RankedCandidate["ranking"] {
  return {
    laneRank: LANE_ORDER.indexOf(input.lane),
    deadlineBucket: input.due.bucket,
    specificityRank: input.specificityRank,
    baseRank: input.baseRank,
    sourceUpdatedAtMs:
      input.sourceUpdatedAt === null
        ? Number.NEGATIVE_INFINITY
        : Date.parse(input.sourceUpdatedAt)
  };
}

function compareRankedCandidates(
  left: RankedCandidate,
  right: RankedCandidate
): number {
  return (
    left.ranking.laneRank - right.ranking.laneRank ||
    left.ranking.deadlineBucket - right.ranking.deadlineBucket ||
    left.ranking.specificityRank - right.ranking.specificityRank ||
    left.ranking.baseRank - right.ranking.baseRank ||
    right.ranking.sourceUpdatedAtMs - left.ranking.sourceUpdatedAtMs ||
    compareRuntimeStrings(
      left.candidate.candidateId,
      right.candidate.candidateId
    )
  );
}

function usedStableIdTieBreak(candidates: RankedCandidate[]): boolean {
  if (candidates.length < 2) return false;
  const left = candidates[0]!.ranking;
  const right = candidates[1]!.ranking;
  return (
    left.laneRank === right.laneRank &&
    left.deadlineBucket === right.deadlineBucket &&
    left.specificityRank === right.specificityRank &&
    left.baseRank === right.baseRank &&
    left.sourceUpdatedAtMs === right.sourceUpdatedAtMs
  );
}

function specificityFor(
  triggerKind: ActiveAttentionCandidate["triggerKind"]
): number {
  return triggerKind === "managed_failure"
    ? 0
    : triggerKind === "configured_follow_through"
      ? 1
      : 2;
}

function workflowCandidateReason(
  action: ProjectWorkflowActionKind
): ActiveAttentionCandidate["reasonCodes"][number] {
  switch (action) {
    case "review_changes":
      return "CANDIDATE_CODEX_CONFIGURED_REVIEW_CHANGES";
    case "commit_changes":
      return "CANDIDATE_CODEX_CONFIGURED_COMMIT_CHANGES";
    case "create_pull_request":
      return "CANDIDATE_CODEX_CONFIGURED_CREATE_PULL_REQUEST";
    case "request_review":
      return "CANDIDATE_CODEX_CONFIGURED_REQUEST_REVIEW";
  }
}

function workflowFirstStep(
  action: ProjectWorkflowActionKind,
  signal: GitHubWorkItemSignal
): string {
  const number = signal.facts.number;
  switch (action) {
    case "review_changes":
      return `GitHub 작업 #${number}을 열어 완료된 변경을 검토합니다.`;
    case "commit_changes":
      return `GitHub 작업 #${number}을 열어 완료된 변경의 commit 상태를 확인합니다.`;
    case "create_pull_request":
      return `GitHub issue #${number}을 열어 완료된 변경으로 PR을 만들 준비를 합니다.`;
    case "request_review":
      return `GitHub PR #${number}을 열어 review 요청 상태를 확인합니다.`;
  }
}

function workflowActionTargetCompatible(
  action: ProjectWorkflowActionKind,
  signal: GitHubWorkItemSignal
): boolean {
  if (action === "create_pull_request") {
    return signal.facts.objectType === "issue";
  }
  if (action === "request_review") {
    return signal.facts.taskKind === "authored_pull_request";
  }
  return true;
}

function githubCandidateKey(subjectId: string, taskKind: string): string {
  return `${subjectId}:${taskKind}`;
}

function phase2CandidateFocusMatched(
  candidate: Phase2Candidate
): boolean {
  return candidate.whyNowReasonCodes.includes(
    "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
  );
}

function phase2RankContextForSignal(
  input: ActiveAttentionInput,
  signal: GitHubWorkItemSignal,
  phase2RankByGithubKey: ReadonlyMap<string, Phase2RankContext>
): Phase2RankContext {
  const ranked = phase2RankByGithubKey.get(
    githubCandidateKey(signal.subjectId, signal.facts.taskKind)
  );
  if (ranked) return ranked;
  const focusMatched = phase2GithubSignalMatchesActiveFocus(
    input.baseAttentionInput,
    signal
  );
  return {
    baseRank: focusMatched
      ? Number.MAX_SAFE_INTEGER - 1
      : Number.MAX_SAFE_INTEGER,
    focusMatched
  };
}

function managedTargetRef(run: ManagedCodexPublicRunProjection): string {
  return createClaimTargetRef({
    kind: "codex_execution",
    identity: {
      managedRunId: run.managedRunId,
      bindingId: run.bindingId,
      executionId: run.executionId
    }
  });
}

function sameCanonicalSet(left: string[], right: string[]): boolean {
  return (
    [...new Set(left)].sort(compareRuntimeStrings).join("|") ===
    [...new Set(right)].sort(compareRuntimeStrings).join("|")
  );
}

function canonical<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}
