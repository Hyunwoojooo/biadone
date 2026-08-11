import { z } from "zod";

import { managedCodexArtifactRelationProjectionSchema } from "../artifacts/contracts";
import { claimAuthorityProjectionSchema } from "../claims/contracts";
import { phase2AttentionInputSchema } from "../crossSource/attentionSchema";
import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import { runtimeWorkSignalBatchSchema } from "../crossSource/schema";
import {
  ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
  ACTIVE_ATTENTION_ID_POLICY_VERSION,
  ACTIVE_ATTENTION_INPUT_CONTRACT,
  ACTIVE_ATTENTION_LANE_POLICY_VERSION,
  ACTIVE_ATTENTION_POLICY_VERSION,
  ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT,
  PHASE2_ATTENTION_RESULT_CONTRACT
} from "../crossSource/versions";
import { attentionEligibilityShadowProjectionSchema } from "../eligibility/contracts";
import {
  managedCodexPublicProjectionSchema,
  managedCodexSemanticProjectionSchema
} from "../managedCodex";
import { managedCodexWorkRelationProjectionSchema } from "../relations";
import { projectWorkflowProjectionSchema } from "../workflows/contracts";

export const ACTIVE_ATTENTION_INPUT_HASH_DOMAIN =
  "blabase-active-attention-input-v0.4" as const;
export const ACTIVE_ATTENTION_RESULT_HASH_DOMAIN =
  "blabase-active-attention-result-v0.5" as const;
export const MANAGED_CODEX_PUBLIC_DEPENDENCY_HASH_DOMAIN =
  "blabase-managed-codex-public-dependency-v0.1" as const;
export const MANAGED_CODEX_START_TIMES_HASH_DOMAIN =
  "blabase-managed-codex-start-times-v0.1" as const;

export const MAX_ACTIVE_ATTENTION_ASSESSMENTS = 12_000;
export const MAX_ACTIVE_ATTENTION_CANDIDATES = 12_000;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const signalIdSchema = z.string().regex(/^sig_[a-f0-9]{32}$/);
const targetRefSchema = z.string().regex(/^claim_subject_[a-f0-9]{32}$/);
const relationRefSchema = z.string().regex(/^relation_[a-f0-9]{32}$/);
const conflictIdSchema = z.string().regex(/^claim_conflict_[a-f0-9]{32}$/);
const candidateSeedIdSchema = z.string().regex(/^seed_[a-f0-9]{32}$/);
const candidateIdSchema = z.string().regex(/^attention_[a-f0-9]{32}$/);
const assessmentIdSchema = z
  .string()
  .regex(/^attention_assessment_[a-f0-9]{32}$/);
const resultIdSchema = z
  .string()
  .regex(/^attention_result_[a-f0-9]{32}$/);
const clarificationIdSchema = z
  .string()
  .regex(/^attention_clarification_[a-f0-9]{32}$/);
const managedRunIdSchema = z
  .string()
  .regex(/^managed_run_[a-f0-9]{32}$/);
const bindingIdSchema = z.string().regex(/^binding_[a-f0-9]{32}$/);
const executionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
const workflowDecisionIdSchema = z
  .string()
  .regex(/^workflow_decision_[a-f0-9]{32}$/);

export const activeAttentionTriggerSourceSchema = z.enum([
  "github",
  "codex_managed"
]);

export const activeAttentionTriggerKindSchema = z.enum([
  "github_work_item",
  "managed_failure",
  "configured_follow_through"
]);

export const activeAttentionLaneSchema = z.enum([
  "must_now",
  "unblock",
  "close_loop",
  "focus"
]);

export const activeAttentionAssessmentStatusSchema = z.enum([
  "eligible",
  "review_required",
  "ineligible"
]);

export const activeAttentionReviewRouteSchema = z.enum([
  "none",
  "user_review",
  "refresh_sources"
]);

export const activeAttentionReasonCodeSchema = z.enum([
  "ELIGIBLE_GITHUB_DIRECT_WORK",
  "ELIGIBLE_MANAGED_LATEST_DIRECT_FAILURE",
  "ELIGIBLE_CONFIGURED_FOLLOW_THROUGH",
  "REVIEW_SOURCE_STALE",
  "REVIEW_SOURCE_GAP",
  "REVIEW_SOURCE_HISTORY_PRUNED",
  "REVIEW_SOURCE_CLOCK_REGRESSED",
  "REVIEW_MANAGED_SEMANTICS_MISSING",
  "REVIEW_MANAGED_LIVE_OBSERVATION_UNAVAILABLE",
  "REVIEW_MANAGED_STATE_CLAIM_MISSING",
  "REVIEW_MANAGED_STATE_CLAIM_UNRESOLVED",
  "REVIEW_GITHUB_STATE_CLAIM_MISSING",
  "REVIEW_GITHUB_STATE_CLAIM_UNRESOLVED",
  "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER",
  "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH",
  "REVIEW_LINK_IDENTITY_CONFLICT",
  "REVIEW_LINK_PROJECT_MISMATCH",
  "REVIEW_LINK_TARGET_NOT_CURRENT",
  "INELIGIBLE_UPSTREAM_GATE",
  "INELIGIBLE_MANAGED_RUN_HEALTHY",
  "INELIGIBLE_MANAGED_ATTEMPT_SUPERSEDED",
  "INELIGIBLE_FAILURE_RECOVERED",
  "INELIGIBLE_MANAGED_STATE_NOT_CURRENT",
  "INELIGIBLE_LINK_NOT_ACTIVE",
  "INELIGIBLE_GITHUB_TARGET_CLOSED",
  "INELIGIBLE_FOLLOW_THROUGH_NOT_CONFIGURED",
  "INELIGIBLE_WORKFLOW_NOT_APPLICABLE_TO_RUN",
  "INELIGIBLE_FOLLOW_THROUGH_GRACE_ACTIVE",
  "INELIGIBLE_FOLLOW_THROUGH_CLOSED",
  "INELIGIBLE_FOLLOW_THROUGH_ARTIFACT_EXISTS",
  "INELIGIBLE_WORKFLOW_ACTION_TARGET_INCOMPATIBLE",
  "INELIGIBLE_DUPLICATE_OPEN_LOOP"
]);

export const activeAttentionCandidateReasonCodeSchema = z.enum([
  "CANDIDATE_GITHUB_ASSIGNED_ISSUE",
  "CANDIDATE_GITHUB_REVIEW_STATUS_CHECK",
  "CANDIDATE_GITHUB_AUTHORED_PR_CHECKS_FAILED",
  "CANDIDATE_GITHUB_AUTHORED_PR_CHANGES_REQUESTED",
  "CANDIDATE_GITHUB_AUTHORED_PR_MERGE_CONFLICT",
  "CANDIDATE_CODEX_LATEST_DIRECT_FAILURE",
  "CANDIDATE_CODEX_CONFIGURED_REVIEW_CHANGES",
  "CANDIDATE_CODEX_CONFIGURED_COMMIT_CHANGES",
  "CANDIDATE_CODEX_CONFIGURED_CREATE_PULL_REQUEST",
  "CANDIDATE_CODEX_CONFIGURED_REQUEST_REVIEW"
]);

export const activeAttentionWhyNowReasonCodeSchema = z.enum([
  "WHY_NOW_NATIVE_DEADLINE_OVERDUE",
  "WHY_NOW_NATIVE_DEADLINE_DUE_SOON",
  "WHY_NOW_REVIEW_REQUEST_OPEN",
  "WHY_NOW_ASSIGNED_WORK_OPEN",
  "WHY_NOW_AUTHORED_PR_CHECKS_FAILED",
  "WHY_NOW_AUTHORED_PR_CHANGES_REQUESTED",
  "WHY_NOW_AUTHORED_PR_MERGE_CONFLICT",
  "WHY_NOW_MANAGED_FAILURE_CURRENT",
  "WHY_NOW_CONFIGURED_HANDOFF_OPEN",
  "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
]);

export const activeAttentionCaveatCodeSchema = z.enum([
  "CAVEAT_REVIEW_DRAFT_UNKNOWN",
  "CAVEAT_CANDIDATE_SET_INCOMPLETE",
  "CAVEAT_DEFAULT_TIE_BREAK_USED",
  "CAVEAT_MANAGED_FAILURE_INSPECTION_ONLY",
  "CAVEAT_GITHUB_PR_ACTIONABILITY_PARTIAL",
  "CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES"
]);

export const activeAttentionDecisionReasonCodeSchema = z.enum([
  "DECISION_BEST_ELIGIBLE_CANDIDATE",
  "DECISION_REFRESH_REQUIRED",
  "DECISION_USER_CLARIFICATION_REQUIRED",
  "DECISION_SCOPED_NO_ACTION",
  "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
]);

const activeAttentionInputContentSchema = z
  .object({
    contract: z.literal(ACTIVE_ATTENTION_INPUT_CONTRACT),
    asOf: timestampSchema,
    baseAttentionInput: phase2AttentionInputSchema,
    githubBatch: runtimeWorkSignalBatchSchema.nullable(),
    eligibilityProjection: attentionEligibilityShadowProjectionSchema,
    managedPublicProjection: managedCodexPublicProjectionSchema,
    managedSemanticProjection: managedCodexSemanticProjectionSchema,
    managedRunStartedAtById: z.record(
      managedRunIdSchema,
      timestampSchema
    ),
    workRelationProjection: managedCodexWorkRelationProjectionSchema,
    artifactRelationProjection: managedCodexArtifactRelationProjectionSchema,
    claimAuthorityProjection: claimAuthorityProjectionSchema,
    workflowProjection: projectWorkflowProjectionSchema
  })
  .strict();

export const activeAttentionInputSchema = activeAttentionInputContentSchema
  .extend({ inputSha256: sha256Schema })
  .strict()
  .superRefine((input, context) => {
    if (input.inputSha256 !== activeAttentionInputSha256(input)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputSha256"],
        message: "Active Attention input hash does not match content."
      });
    }
    if (
      input.baseAttentionInput.asOf !== input.asOf ||
      input.eligibilityProjection.asOf !== input.asOf ||
      input.workRelationProjection.asOf !== input.asOf ||
      input.artifactRelationProjection.asOf !== input.asOf ||
      input.claimAuthorityProjection.asOf !== input.asOf ||
      input.workflowProjection.asOf !== input.asOf
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["asOf"],
        message: "Active Attention inputs must share one exact as-of time."
      });
    }
    const baseGitHub = input.baseAttentionInput.sources.github;
    if (
      (baseGitHub.status === "unavailable") !==
        (input.githubBatch === null) ||
      (baseGitHub.status === "available" &&
        input.githubBatch !== null &&
        (baseGitHub.batch.batchSha256 !== input.githubBatch.batchSha256 ||
          baseGitHub.batch.sourceSnapshotSha256 !==
            input.githubBatch.sourceSnapshotSha256))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubBatch"],
        message:
          "Active Attention GitHub evidence must exactly match the Phase 2 input."
      });
    }
  });

export const activeAttentionAssessmentSchema = z
  .object({
    assessmentId: assessmentIdSchema,
    candidateSeedId: candidateSeedIdSchema,
    triggerSource: activeAttentionTriggerSourceSchema,
    triggerKind: activeAttentionTriggerKindSchema,
    sourceSignalId: signalIdSchema.nullable(),
    managedRunId: managedRunIdSchema.nullable(),
    targetRef: targetRefSchema,
    githubSubjectId: z.string().min(1).max(240).nullable(),
    actionKind: z.enum(["do", "inspect", "close_loop"]).nullable(),
    status: activeAttentionAssessmentStatusSchema,
    reviewRoute: activeAttentionReviewRouteSchema,
    reasonCodes: z.array(activeAttentionReasonCodeSchema).min(1).max(16),
    relationRefs: z.array(relationRefSchema).max(100),
    relatedConflictIds: z.array(conflictIdSchema).max(100),
    candidateId: candidateIdSchema.nullable(),
    upstreamObjectsRemainForbidden: z.literal(true),
    attentionDisposition: z.literal("active_gate_assessment")
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      (assessment.status === "review_required") !==
      (assessment.reviewRoute !== "none") ||
      (assessment.status === "eligible") !==
      (assessment.candidateId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active assessment status, route, and candidate must agree."
      });
    }
    if (
      (assessment.triggerSource === "codex_managed") !==
      (assessment.managedRunId !== null) ||
      (assessment.triggerSource === "github") !==
      (assessment.sourceSignalId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active assessment provenance is incoherent."
      });
    }
    if (
      !isCanonicalUnique(assessment.reasonCodes) ||
      !isCanonicalUnique(assessment.relationRefs) ||
      !isCanonicalUnique(assessment.relatedConflictIds)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active assessment references must be canonical and unique."
      });
    }
  });

export const activeAttentionCandidateSchema = z
  .object({
    candidateId: candidateIdSchema,
    candidateSeedId: candidateSeedIdSchema,
    triggerSource: activeAttentionTriggerSourceSchema,
    triggerKind: activeAttentionTriggerKindSchema,
    targetRef: targetRefSchema,
    githubSubjectId: z.string().min(1).max(240),
    projectId: z.string().regex(/^project_[a-f0-9]{32}$/).nullable(),
    relationRef: relationRefSchema.nullable(),
    managedRunId: managedRunIdSchema.nullable(),
    bindingId: bindingIdSchema.nullable(),
    executionId: executionIdSchema.nullable(),
    workflowDecisionId: workflowDecisionIdSchema.nullable(),
    workflowActionKind: z
      .enum([
        "review_changes",
        "commit_changes",
        "create_pull_request",
        "request_review"
      ])
      .nullable(),
    taskKind: z.enum([
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ]),
    title: z.string().min(1).max(240),
    repositoryFullName: z.string().min(1).max(240),
    number: z.number().int().positive(),
    intervention: z.enum(["do", "inspect", "close_loop"]),
    lane: activeAttentionLaneSchema,
    state: z.enum(["open", "failed", "not_started"]),
    dueAt: timestampSchema.nullable(),
    destinationUrl: z.string().url(),
    certainty: z.enum(["confirmed", "provisional"]),
    reasonCodes: z
      .array(activeAttentionCandidateReasonCodeSchema)
      .min(1)
      .max(4),
    whyNowReasonCodes: z
      .array(activeAttentionWhyNowReasonCodeSchema)
      .min(1)
      .max(4),
    caveatCodes: z.array(activeAttentionCaveatCodeSchema).max(8),
    sourceEvidenceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
    sourceUpdatedAt: timestampSchema.nullable(),
    firstStep: z.string().min(1).max(300),
    explanation: z.string().min(1).max(500),
    upstreamObjectsRemainForbidden: z.literal(true),
    attentionDisposition: z.literal("active_candidate")
  })
  .strict()
  .superRefine((candidate, context) => {
    const isManaged = candidate.triggerSource === "codex_managed";
    if (
      isManaged !== (candidate.managedRunId !== null) ||
      isManaged !== (candidate.bindingId !== null) ||
      isManaged !== (candidate.executionId !== null) ||
      isManaged !== (candidate.relationRef !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Managed candidate identity must be exact and complete."
      });
    }
    const isFollowThrough =
      candidate.triggerKind === "configured_follow_through";
    if (
      isFollowThrough !== (candidate.workflowDecisionId !== null) ||
      isFollowThrough !== (candidate.workflowActionKind !== null) ||
      (isFollowThrough && candidate.intervention !== "close_loop")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Follow-through candidates require one exact workflow."
      });
    }
    if (candidate.lane === "must_now" && candidate.dueAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueAt"],
        message: "must_now requires a native GitHub deadline."
      });
    }
    if (
      !isCanonicalUnique(candidate.reasonCodes) ||
      !isCanonicalUnique(candidate.whyNowReasonCodes) ||
      !isCanonicalUnique(candidate.caveatCodes) ||
      !isCanonicalUnique(candidate.sourceEvidenceRefs)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Candidate reasons and evidence refs must be canonical."
      });
    }
  });

export const activeAttentionClarificationSchema = z
  .object({
    clarificationId: clarificationIdSchema,
    candidateSeedId: candidateSeedIdSchema,
    triggerSource: activeAttentionTriggerSourceSchema,
    targetRef: targetRefSchema,
    question: z.string().min(1).max(300),
    relationRefs: z.array(relationRefSchema).max(100),
    conflictIds: z.array(conflictIdSchema).max(100)
  })
  .strict();

export const activeAttentionDependenciesSchema = z
  .object({
    baseAttentionInputSha256: sha256Schema,
    baseAttentionResultContract: z.literal(PHASE2_ATTENTION_RESULT_CONTRACT),
    baseAttentionResultId: z.string().regex(/^res_[a-f0-9]{32}$/),
    baseAttentionResultSha256: sha256Schema,
    githubBatchSha256: sha256Schema.nullable(),
    githubSourceSnapshotSha256: sha256Schema.nullable(),
    eligibilityProjectionSha256: sha256Schema,
    managedPublicProjectionSha256: sha256Schema,
    managedRunStartedAtByIdSha256: sha256Schema,
    managedSourceRevision: z.number().int().nonnegative(),
    managedGeneratedAt: timestampSchema,
    managedSemanticProjectionSha256: sha256Schema,
    workRelationProjectionSha256: sha256Schema,
    artifactRelationProjectionSha256: sha256Schema,
    claimAuthorityProjectionSha256: sha256Schema,
    workflowProjectionSha256: sha256Schema,
    workflowStoreSha256: sha256Schema,
    workflowRevision: z.number().int().nonnegative()
  })
  .strict();

export const activeAttentionUpstreamGuardsSchema = z
  .object({
    eligibility: z
      .object({
        attentionSelectionEffect: z.literal("none"),
        attentionDisposition: z.literal("shadow_only"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    managedPublic: z
      .object({
        runCount: z.number().int().nonnegative(),
        everyRunForbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    managedSemantic: z
      .object({
        runCount: z.number().int().nonnegative(),
        everyRunForbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    workRelations: z
      .object({
        attentionDisposition: z.literal("not_connected"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    artifacts: z
      .object({
        attentionDisposition: z.literal("not_connected"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    claims: z
      .object({
        attentionDisposition: z.literal("not_connected"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict()
  })
  .strict();

const activeAttentionResultContentSchema = z
  .object({
    contract: z.literal(ACTIVE_ATTENTION_RESULT_CONTRACT),
    resultId: resultIdSchema,
    inputSha256: sha256Schema,
    asOf: timestampSchema,
    policyVersion: z.literal(ACTIVE_ATTENTION_POLICY_VERSION),
    candidateRuleVersion: z.literal(
      ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION
    ),
    lanePolicyVersion: z.literal(ACTIVE_ATTENTION_LANE_POLICY_VERSION),
    rankingPolicyVersion: z.literal(
      ACTIVE_ATTENTION_RANKING_POLICY_VERSION
    ),
    resolverVersion: z.literal(ACTIVE_ATTENTION_RESOLVER_VERSION),
    idPolicyVersion: z.literal(ACTIVE_ATTENTION_ID_POLICY_VERSION),
    recommendationMode: z.literal("aggressive_evidence_bound"),
    readOnly: z.literal(true),
    dependencies: activeAttentionDependenciesSchema,
    upstreamGuards: activeAttentionUpstreamGuardsSchema,
    coverage: z
      .object({
        candidateUniverse: z.literal("github_and_managed_codex"),
        githubCandidateCoverage: z.enum([
          "complete",
          "partial",
          "stale",
          "unavailable"
        ]),
        managedCodexCoverage: z.enum([
          "complete",
          "partial",
          "unavailable"
        ]),
        workflowCoverage: z.literal("evaluated"),
        negativeCandidateCoverageComplete: z.boolean()
      })
      .strict(),
    counts: z
      .object({
        eligible: z.number().int().nonnegative(),
        reviewRequired: z.number().int().nonnegative(),
        ineligible: z.number().int().nonnegative()
      })
      .strict(),
    assessments: z
      .array(activeAttentionAssessmentSchema)
      .max(MAX_ACTIVE_ATTENTION_ASSESSMENTS),
    rankedCandidates: z
      .array(activeAttentionCandidateSchema)
      .max(MAX_ACTIVE_ATTENTION_CANDIDATES),
    decision: z
      .object({
        status: z.enum([
          "suggested",
          "needs_clarification",
          "no_action",
          "insufficient_evidence"
        ]),
        certainty: z
          .enum(["confirmed", "provisional", "scoped"])
          .nullable(),
        topSuggestion: activeAttentionCandidateSchema.nullable(),
        alternatives: z.array(activeAttentionCandidateSchema).max(2),
        clarification: activeAttentionClarificationSchema.nullable(),
        reasonCodes: z
          .array(activeAttentionDecisionReasonCodeSchema)
          .min(1)
          .max(3),
        caveatCodes: z.array(activeAttentionCaveatCodeSchema).max(8),
        scopeStatement: z.string().min(1).max(500)
      })
      .strict()
  })
  .strict();

export const activeAttentionResultSchema = activeAttentionResultContentSchema
  .extend({ resultSha256: sha256Schema })
  .strict()
  .superRefine((result, context) => {
    if (result.resultSha256 !== activeAttentionResultSha256(result)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultSha256"],
        message: "Active Attention result hash does not match content."
      });
    }
    if (
      result.resultId !==
      createActiveAttentionResultId({
        inputSha256: result.inputSha256,
        policyVersion: result.policyVersion
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultId"],
        message: "Active Attention result ID does not match lineage."
      });
    }
    const eligibleCount = result.assessments.filter(
      (assessment) => assessment.status === "eligible"
    ).length;
    const reviewCount = result.assessments.filter(
      (assessment) => assessment.status === "review_required"
    ).length;
    const ineligibleCount = result.assessments.filter(
      (assessment) => assessment.status === "ineligible"
    ).length;
    if (
      result.counts.eligible !== eligibleCount ||
      result.counts.reviewRequired !== reviewCount ||
      result.counts.ineligible !== ineligibleCount ||
      result.rankedCandidates.length !== eligibleCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active Attention result counts are incoherent."
      });
    }
    if (
      !isCanonicalUnique(
        result.assessments.map((assessment) => assessment.assessmentId)
      ) ||
      new Set(
        result.assessments.map((assessment) => assessment.candidateSeedId)
      ).size !== result.assessments.length ||
      new Set(
        result.rankedCandidates.map((candidate) => candidate.candidateId)
      ).size !== result.rankedCandidates.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Active Attention result identities must be canonical and unique."
      });
    }
    refineDecision(result, context);
  });

export type ActiveAttentionInputContent = z.infer<
  typeof activeAttentionInputContentSchema
>;
export type ActiveAttentionInput = z.infer<typeof activeAttentionInputSchema>;
export type ActiveAttentionAssessment = z.infer<
  typeof activeAttentionAssessmentSchema
>;
export type ActiveAttentionCandidate = z.infer<
  typeof activeAttentionCandidateSchema
>;
export type ActiveAttentionDependencies = z.infer<
  typeof activeAttentionDependenciesSchema
>;
export type ActiveAttentionResultContent = z.infer<
  typeof activeAttentionResultContentSchema
>;
export type ActiveAttentionResult = z.infer<
  typeof activeAttentionResultSchema
>;
export type ActiveAttentionReasonCode = z.infer<
  typeof activeAttentionReasonCodeSchema
>;
export type ActiveAttentionCaveatCode = z.infer<
  typeof activeAttentionCaveatCodeSchema
>;

export function sealActiveAttentionInput(
  contentInput: ActiveAttentionInputContent
): ActiveAttentionInput {
  const content = activeAttentionInputContentSchema.parse(contentInput);
  return activeAttentionInputSchema.parse({
    ...content,
    inputSha256: runtimeSha256({
      domain: ACTIVE_ATTENTION_INPUT_HASH_DOMAIN,
      input: content
    })
  });
}

export function activeAttentionInputSha256(
  input: ActiveAttentionInput | ActiveAttentionInputContent
): string {
  const { inputSha256: _inputSha256, ...content } = input as ActiveAttentionInput;
  return runtimeSha256({
    domain: ACTIVE_ATTENTION_INPUT_HASH_DOMAIN,
    input: content
  });
}

export function managedCodexPublicProjectionDependencySha256(
  projection: z.infer<typeof managedCodexPublicProjectionSchema>
): string {
  return runtimeSha256({
    domain: MANAGED_CODEX_PUBLIC_DEPENDENCY_HASH_DOMAIN,
    projection
  });
}

export function managedCodexRunStartTimesSha256(
  startedAtById: Record<string, string>
): string {
  return runtimeSha256({
    domain: MANAGED_CODEX_START_TIMES_HASH_DOMAIN,
    startedAtById
  });
}

export function createActiveAttentionResultId(input: {
  inputSha256: string;
  policyVersion: string;
}): string {
  return runtimeStableId("attention_result", ACTIVE_ATTENTION_ID_POLICY_VERSION, {
    inputSha256: input.inputSha256,
    policyVersion: input.policyVersion
  });
}

export function sealActiveAttentionResult(
  contentInput: ActiveAttentionResultContent
): ActiveAttentionResult {
  const content = activeAttentionResultContentSchema.parse(contentInput);
  return activeAttentionResultSchema.parse({
    ...content,
    resultSha256: runtimeSha256({
      domain: ACTIVE_ATTENTION_RESULT_HASH_DOMAIN,
      result: content
    })
  });
}

export function activeAttentionResultSha256(
  result: ActiveAttentionResult | ActiveAttentionResultContent
): string {
  const { resultSha256: _resultSha256, ...content } =
    result as ActiveAttentionResult;
  return runtimeSha256({
    domain: ACTIVE_ATTENTION_RESULT_HASH_DOMAIN,
    result: content
  });
}

export function verifyActiveAttentionInputIntegrity(input: unknown): boolean {
  return activeAttentionInputSchema.safeParse(input).success;
}

export function verifyActiveAttentionResultIntegrity(input: unknown): boolean {
  return activeAttentionResultSchema.safeParse(input).success;
}

function refineDecision(
  result: ActiveAttentionResult,
  context: z.RefinementCtx
): void {
  const decision = result.decision;
  const suggested = decision.status === "suggested";
  const clarification = decision.status === "needs_clarification";
  if (
    suggested !== (decision.topSuggestion !== null) ||
    (!suggested && decision.alternatives.length > 0) ||
    clarification !== (decision.clarification !== null) ||
    suggested !== (result.rankedCandidates.length > 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "Active Attention decision payload does not match its status."
    });
  }
  if (
    suggested &&
    (decision.topSuggestion?.candidateId !==
      result.rankedCandidates[0]?.candidateId ||
      decision.alternatives.length !==
        Math.min(2, Math.max(0, result.rankedCandidates.length - 1)) ||
      decision.alternatives.some(
        (candidate, index) =>
          candidate.candidateId !==
          result.rankedCandidates[index + 1]?.candidateId
      ))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "Decision candidates must preserve deterministic rank order."
    });
  }
  if (
    decision.status === "no_action" &&
    (!result.coverage.negativeCandidateCoverageComplete ||
      decision.certainty !== "scoped")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision"],
      message: "Scoped no-action requires complete negative coverage."
    });
  }
  if (
    (decision.status === "insufficient_evidence" || clarification) &&
    decision.certainty !== null
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision", "certainty"],
      message: "Review and insufficient decisions cannot claim certainty."
    });
  }
  const expectedReason =
    decision.status === "suggested"
      ? "DECISION_BEST_ELIGIBLE_CANDIDATE"
      : decision.status === "needs_clarification"
        ? "DECISION_USER_CLARIFICATION_REQUIRED"
        : decision.status === "no_action"
          ? "DECISION_SCOPED_NO_ACTION"
          : null;
  if (
    (expectedReason !== null &&
      !decision.reasonCodes.includes(expectedReason)) ||
    (decision.status === "insufficient_evidence" &&
      !decision.reasonCodes.some((reason) =>
        [
          "DECISION_REFRESH_REQUIRED",
          "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
        ].includes(reason)
      ))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["decision", "reasonCodes"],
      message: "Decision status and reason codes must agree."
    });
  }
}

function isCanonicalUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.join("|") === [...values].sort(compareRuntimeStrings).join("|")
  );
}
