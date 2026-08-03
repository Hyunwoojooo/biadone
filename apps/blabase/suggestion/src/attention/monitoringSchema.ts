import { z } from "zod";

import {
  phase2AttentionInputSchema,
  phase2CandidateAssessmentSchema,
  type Phase2AttentionResult
} from "../crossSource/attentionSchema";
import {
  activeAttentionAssessmentStatusSchema,
  activeAttentionInputSchema,
  activeAttentionInputSha256,
  activeAttentionReasonCodeSchema,
  activeAttentionReviewRouteSchema,
  activeAttentionTriggerKindSchema,
  activeAttentionTriggerSourceSchema,
  MAX_ACTIVE_ATTENTION_ASSESSMENTS,
  type ActiveAttentionResult
} from "../attentionDecision/contracts";
import type { AttentionEligibilityShadowProjection } from "../eligibility/contracts";
import { runtimeSha256 } from "../crossSource/canonicalHash";
import {
  ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
  ACTIVE_ATTENTION_ID_POLICY_VERSION,
  ACTIVE_ATTENTION_INPUT_CONTRACT,
  ACTIVE_ATTENTION_LANE_POLICY_VERSION,
  ACTIVE_ATTENTION_POLICY_VERSION,
  ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT,
  PHASE2_ATTENTION_INPUT_CONTRACT,
  PHASE2_ATTENTION_POLICY_VERSION,
  PHASE2_ATTENTION_RESULT_CONTRACT,
  PHASE2_CODEX_OVERVIEW_RULE_VERSION,
  PHASE2_GITHUB_CANDIDATE_RULE_VERSION
} from "../crossSource/versions";
import { RESOLVED_WORK_CONTEXT_CONTRACT } from "../context/contracts";
import {
  ATTENTION_FEEDBACK_CONTRACT,
  ATTENTION_LIVE_FRESHNESS_POLICY_VERSION,
  ATTENTION_LIVE_ORCHESTRATOR_LEGACY_VERSION,
  ATTENTION_LIVE_ORCHESTRATOR_PREVIOUS_VERSION,
  ATTENTION_LIVE_ORCHESTRATOR_VERSION,
  ATTENTION_MONITOR_FAILURE_CONTRACT,
  ATTENTION_MONITOR_FAILURE_LEGACY_CONTRACT,
  ATTENTION_MONITOR_FAILURE_PREVIOUS_CONTRACT,
  ATTENTION_MONITOR_RETENTION_DAYS,
  ATTENTION_MONITOR_PREVIEW_CONTRACT,
  ATTENTION_MONITOR_RUN_CONTRACT,
  ATTENTION_MONITOR_RUN_LEGACY_CONTRACT,
  ATTENTION_MONITOR_RUN_PREVIOUS_CONTRACT,
  ATTENTION_MONITOR_RUN_V02_CONTRACT,
  ATTENTION_REPLAY_INPUT_CONTRACT,
  ATTENTION_REPLAY_INPUT_PREVIOUS_CONTRACT,
  ATTENTION_MONITOR_STORE_CONTRACT
} from "./versions";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const stableIdSchema = z.string().regex(/^[a-z]+_[a-f0-9]{32}$/);
const activeResultIdSchema = z
  .string()
  .regex(/^attention_result_[a-f0-9]{32}$/);
const activeAssessmentIdSchema = z
  .string()
  .regex(/^attention_assessment_[a-f0-9]{32}$/);
const activeCandidateIdSchema = z
  .string()
  .regex(/^attention_[a-f0-9]{32}$/);
const timestampSchema = z.string().datetime();

export const attentionSourceMonitorSchema = z
  .object({
    source: z.enum(["github", "codex"]),
    inputState: z.enum([
      "available",
      "missing",
      "rejected",
      "disconnected",
      "collection_failed"
    ]),
    unavailableReason: z
      .enum([
        "SNAPSHOT_MISSING",
        "SNAPSHOT_PARSE_FAILED",
        "SNAPSHOT_SCHEMA_UNSUPPORTED",
        "CONNECTOR_DISCONNECTED",
        "COLLECTION_FAILED"
      ])
      .nullable(),
    freshness: z.enum(["fresh", "stale", "invalid"]).nullable(),
    completeness: z.enum(["complete", "partial"]).nullable(),
    snapshotFetchedAt: timestampSchema.nullable(),
    sourceSnapshotSha256: sha256Schema.nullable(),
    batchSha256: sha256Schema.nullable(),
    normalizerVersion: z.string().min(1).max(120).nullable(),
    candidateSetComplete: z.boolean(),
    signalCount: z.number().int().nonnegative(),
    skippedRecordCount: z.number().int().nonnegative(),
    issueCodes: z.array(z.string().min(1).max(120)).max(20)
  })
  .strict()
  .superRefine((source, context) => {
    const available = source.inputState === "available";
    if (
      available &&
      (source.unavailableReason !== null ||
        source.freshness === null ||
        source.completeness === null ||
        source.snapshotFetchedAt === null ||
        source.sourceSnapshotSha256 === null ||
        source.batchSha256 === null ||
        source.normalizerVersion === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Available source monitoring fields must be present together."
      });
    }
    if (
      !available &&
      (source.unavailableReason === null ||
        source.freshness !== null ||
        source.completeness !== null ||
        source.snapshotFetchedAt !== null ||
        source.sourceSnapshotSha256 !== null ||
        source.batchSha256 !== null ||
        source.normalizerVersion !== null ||
        source.signalCount !== 0 ||
        source.skippedRecordCount !== 0 ||
        source.candidateSetComplete)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Unavailable source monitoring cannot claim signals or completeness."
      });
    }
  });

export const attentionSupportingSourceMonitorSchema = z
  .object({
    source: z.enum(["google_calendar", "notion"]),
    inputState: z.enum(["available", "unavailable"]),
    unavailableReason: z
      .enum([
        "SNAPSHOT_MISSING",
        "SNAPSHOT_PARSE_FAILED",
        "SNAPSHOT_SCHEMA_UNSUPPORTED",
        "CONNECTOR_DISCONNECTED",
        "COLLECTION_FAILED"
      ])
      .nullable(),
    freshness: z.enum(["fresh", "stale"]).nullable(),
    snapshotFetchedAt: timestampSchema.nullable(),
    sourceSnapshotSha256: sha256Schema.nullable(),
    adapterVersion: z.string().min(1).max(120).nullable(),
    itemCount: z.number().int().nonnegative(),
    mappedItemCount: z.number().int().nonnegative(),
    truncated: z.boolean().nullable()
  })
  .strict()
  .superRefine((source, context) => {
    if (
      source.inputState === "available" &&
      (source.unavailableReason !== null ||
        source.freshness === null ||
        source.snapshotFetchedAt === null ||
        source.sourceSnapshotSha256 === null ||
        source.adapterVersion === null ||
        source.truncated === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Available supporting source provenance must be complete."
      });
    }
    if (
      source.inputState === "unavailable" &&
      (source.unavailableReason === null ||
        source.freshness !== null ||
        source.snapshotFetchedAt !== null ||
        source.sourceSnapshotSha256 !== null ||
        source.adapterVersion !== null ||
        source.itemCount !== 0 ||
        source.mappedItemCount !== 0 ||
        source.truncated !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Unavailable supporting source provenance cannot claim observed items."
      });
    }
    if (source.mappedItemCount > source.itemCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mappedItemCount"],
        message: "Mapped item count cannot exceed item count."
      });
    }
  });

const attentionWorkContextMonitorSchema = z
  .object({
    contract: z.literal(RESOLVED_WORK_CONTEXT_CONTRACT),
    registrySha256: sha256Schema.nullable(),
    resolutionSha256: sha256Schema.nullable(),
    weeklyOutcomeStoreSha256: sha256Schema.nullable(),
    weeklyOutcomeStatus: z.enum([
      "active",
      "expired",
      "missing",
      "invalid",
      "not_resolved"
    ]),
    projectResolution: z.enum([
      "resolved",
      "unmapped",
      "conflict",
      "registry_missing",
      "registry_invalid",
      "not_resolved"
    ]),
    focusState: z.enum(["active", "none"])
  })
  .strict();

const legacySupportingSourceMonitors: [
  z.input<typeof attentionSupportingSourceMonitorSchema>,
  z.input<typeof attentionSupportingSourceMonitorSchema>
] = [
  {
    source: "google_calendar" as const,
    inputState: "unavailable" as const,
    unavailableReason: "SNAPSHOT_MISSING" as const,
    freshness: null,
    snapshotFetchedAt: null,
    sourceSnapshotSha256: null,
    adapterVersion: null,
    itemCount: 0,
    mappedItemCount: 0,
    truncated: null
  },
  {
    source: "notion" as const,
    inputState: "unavailable" as const,
    unavailableReason: "SNAPSHOT_MISSING" as const,
    freshness: null,
    snapshotFetchedAt: null,
    sourceSnapshotSha256: null,
    adapterVersion: null,
    itemCount: 0,
    mappedItemCount: 0,
    truncated: null
  }
];

const unresolvedWorkContextMonitor = {
  contract: RESOLVED_WORK_CONTEXT_CONTRACT,
  registrySha256: null,
  resolutionSha256: null,
  weeklyOutcomeStoreSha256: null,
  weeklyOutcomeStatus: "not_resolved" as const,
  projectResolution: "not_resolved" as const,
  focusState: "none" as const
};

const legacyCandidateCountsSchema = z
  .object({
    eligible: z.number().int().nonnegative(),
    provisional: z.number().int().nonnegative(),
    ineligible: z.number().int().nonnegative()
  })
  .strict();

const activeCandidateCountsSchema = z
  .object({
    eligible: z.number().int().nonnegative(),
    reviewRequired: z.number().int().nonnegative(),
    ineligible: z.number().int().nonnegative()
  })
  .strict();

const candidateCountsSchema = z.union([
  legacyCandidateCountsSchema,
  activeCandidateCountsSchema
]);

export const attentionCandidateAssessmentMonitorSchema =
  phase2CandidateAssessmentSchema.pick({
    assessmentId: true,
    taskKind: true,
    disposition: true,
    candidateId: true,
    gateReasonCodes: true
  });

export const activeAttentionCandidateAssessmentMonitorSchema = z
  .object({
    assessmentId: activeAssessmentIdSchema,
    candidateId: activeCandidateIdSchema.nullable(),
    triggerSource: activeAttentionTriggerSourceSchema,
    triggerKind: activeAttentionTriggerKindSchema,
    status: activeAttentionAssessmentStatusSchema,
    reviewRoute: activeAttentionReviewRouteSchema,
    reasonCodes: z.array(activeAttentionReasonCodeSchema).min(1).max(16)
  })
  .strict();

const candidateAssessmentMonitorSchema = z.union([
  attentionCandidateAssessmentMonitorSchema,
  activeAttentionCandidateAssessmentMonitorSchema
]);

function normalizeLegacyRunProvenance(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if (
    input.contract !== ATTENTION_MONITOR_RUN_LEGACY_CONTRACT &&
    input.contract !== ATTENTION_MONITOR_RUN_V02_CONTRACT
  ) {
    return input;
  }
  if (
    !isOptionalNullableMatch(input.analysisId, isStableId) ||
    !isOptionalNullableMatch(input.sessionId, isStableId) ||
    !isOptionalNullableMatch(
      input.replayArtifactSha256,
      isSha256
    ) ||
    !isOptionalNullableMatch(input.codeCommitSha, isCommitSha) ||
    !isOptionalNullableMatch(
      input.codeFingerprintSha256,
      isSha256
    ) ||
    (input.replayArtifactState !== undefined &&
      input.replayArtifactState !== "available" &&
      input.replayArtifactState !== "not_recorded") ||
    (input.codeState !== undefined &&
      input.codeState !== "clean_commit" &&
      input.codeState !== "declared_commit" &&
      input.codeState !== "dirty_worktree" &&
      input.codeState !== "unavailable" &&
      input.codeState !== "legacy_unknown")
  ) {
    return input;
  }
  return {
    ...input,
    analysisId: null,
    sessionId: null,
    replayArtifactState: "not_recorded",
    replayArtifactSha256: null,
    codeCommitSha: null,
    codeState: "legacy_unknown",
    codeFingerprintSha256: null
  };
}

function normalizeLegacyFailureProvenance(input: unknown): unknown {
  if (
    !isRecord(input) ||
    input.contract !== ATTENTION_MONITOR_FAILURE_LEGACY_CONTRACT
  ) {
    return input;
  }
  if (
    !isOptionalNullableMatch(input.codeCommitSha, isCommitSha) ||
    !isOptionalNullableMatch(
      input.codeFingerprintSha256,
      isSha256
    ) ||
    (input.codeState !== undefined &&
      input.codeState !== "clean_commit" &&
      input.codeState !== "declared_commit" &&
      input.codeState !== "dirty_worktree" &&
      input.codeState !== "unavailable" &&
      input.codeState !== "legacy_unknown")
  ) {
    return input;
  }
  return {
    ...input,
    codeCommitSha: null,
    codeState: "legacy_unknown",
    codeFingerprintSha256: null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function isOptionalNullableMatch(
  value: unknown,
  predicate: (candidate: unknown) => boolean
): boolean {
  return (
    value === undefined ||
    value === null ||
    predicate(value)
  );
}

function isStableId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[a-z]+_[a-f0-9]{32}$/.test(value)
  );
}

function isSha256(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(value)
  );
}

function isCommitSha(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{40}$/.test(value)
  );
}

const attentionMonitorRunStrictSchema = z
  .object({
    contract: z.enum([
      ATTENTION_MONITOR_PREVIEW_CONTRACT,
      ATTENTION_MONITOR_RUN_LEGACY_CONTRACT,
      ATTENTION_MONITOR_RUN_V02_CONTRACT,
      ATTENTION_MONITOR_RUN_PREVIOUS_CONTRACT,
      ATTENTION_MONITOR_RUN_CONTRACT
    ]),
    runId: stableIdSchema,
    analysisId: stableIdSchema.nullable().default(null),
    sessionId: stableIdSchema.nullable().default(null),
    resultId: z.union([stableIdSchema, activeResultIdSchema]),
    status: z.literal("completed"),
    asOf: timestampSchema,
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    codeCommitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    codeState: z
      .enum([
        "clean_commit",
        "declared_commit",
        "dirty_worktree",
        "unavailable",
        "legacy_unknown"
      ])
      .default("legacy_unknown"),
    codeFingerprintSha256: sha256Schema.nullable().default(null),
    inputSha256: sha256Schema,
    resultSha256: sha256Schema,
    replayArtifactState: z
      .enum(["available", "not_recorded"])
      .default("not_recorded"),
    replayArtifactSha256: sha256Schema.nullable().default(null),
    orchestratorVersion: z.enum([
      ATTENTION_LIVE_ORCHESTRATOR_LEGACY_VERSION,
      ATTENTION_LIVE_ORCHESTRATOR_PREVIOUS_VERSION,
      ATTENTION_LIVE_ORCHESTRATOR_VERSION
    ]),
    freshnessPolicyVersion: z.literal(
      ATTENTION_LIVE_FRESHNESS_POLICY_VERSION
    ),
    freshnessPolicy: z
      .object({
        githubMaxAgeMs: z.number().int().positive(),
        codexMaxAgeMs: z.number().int().positive(),
        maxFutureClockSkewMs: z.number().int().nonnegative()
      })
      .strict(),
    resultContract: z.string().min(1).max(120),
    policyVersion: z.string().min(1).max(120),
    githubCandidateRuleVersion: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    codexOverviewRuleVersion: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    candidateRuleVersion: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    lanePolicyVersion: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    rankingPolicyVersion: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    resolverVersion: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    idPolicyVersion: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    decisionStatus: z.enum([
      "suggested",
      "needs_clarification",
      "no_action",
      "insufficient_evidence"
    ]),
    certainty: z
      .enum(["confirmed", "provisional", "scoped"])
      .nullable(),
    topCandidateId: stableIdSchema.nullable(),
    alternativeCount: z.number().int().nonnegative().max(2),
    candidateCounts: candidateCountsSchema,
    candidateAssessmentDetailState: z
      .enum(["available", "not_recorded"])
      .default("not_recorded"),
    candidateAssessments: z
      .array(candidateAssessmentMonitorSchema)
      .max(MAX_ACTIVE_ATTENTION_ASSESSMENTS)
      .default([]),
    codexExecutionCount: z.number().int().nonnegative(),
    coverageDisposition: z.enum([
      "scoped_complete",
      "limited_but_sufficient",
      "insufficient"
    ]),
    decisionReasonCodes: z.array(z.string().min(1).max(120)).max(10),
    caveatCodes: z.array(z.string().min(1).max(120)).max(20),
    sources: z.tuple([
      attentionSourceMonitorSchema,
      attentionSourceMonitorSchema
    ]),
    supportingSources: z
      .tuple([
        attentionSupportingSourceMonitorSchema,
        attentionSupportingSourceMonitorSchema
      ])
      .default(legacySupportingSourceMonitors),
    workContext: attentionWorkContextMonitorSchema.default(
      unresolvedWorkContextMonitor
    ),
    latencyMs: z.number().int().nonnegative(),
    errors: z
      .array(
        z
          .object({
            source: z.enum(["github", "codex", "engine"]),
            code: z.string().min(1).max(120)
          })
          .strict()
      )
      .max(20)
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.contract === ATTENTION_MONITOR_RUN_CONTRACT ||
      run.contract === ATTENTION_MONITOR_PREVIEW_CONTRACT
    ) {
      const elapsed =
        Date.parse(run.completedAt) - Date.parse(run.startedAt);
      if (elapsed < 0 || run.latencyMs !== elapsed) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["latencyMs"],
          message:
            "Current run latency must equal the non-negative execution interval."
        });
      }
    }
    if (run.contract === ATTENTION_MONITOR_PREVIEW_CONTRACT) {
      if (
        run.analysisId !== null ||
        run.sessionId !== null ||
        run.replayArtifactState !== "not_recorded" ||
        run.replayArtifactSha256 !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Ephemeral previews cannot claim persisted replay lineage."
        });
      }
    }
    if (
      run.contract === ATTENTION_MONITOR_RUN_CONTRACT ||
      run.contract === ATTENTION_MONITOR_RUN_PREVIOUS_CONTRACT
    ) {
      if (
        run.analysisId === null ||
        run.sessionId === null ||
        run.replayArtifactState !== "available" ||
        run.replayArtifactSha256 === null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Replay-backed runs require analysis/session IDs and an immutable replay artifact."
        });
      }
      const cleanCode =
        run.codeState === "clean_commit" ||
        run.codeState === "declared_commit";
      if (
        (cleanCode &&
          (run.codeCommitSha === null ||
            run.codeFingerprintSha256 !== null)) ||
        (run.codeState === "dirty_worktree" &&
          (run.codeCommitSha !== null ||
            run.codeFingerprintSha256 === null)) ||
        (run.codeState === "unavailable" &&
          (run.codeCommitSha !== null ||
            run.codeFingerprintSha256 !== null)) ||
        run.codeState === "legacy_unknown"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeState"],
          message:
            "Replay-backed run code provenance fields are inconsistent."
        });
      }
    }
    if (
      run.contract === ATTENTION_MONITOR_RUN_LEGACY_CONTRACT ||
      run.contract === ATTENTION_MONITOR_RUN_V02_CONTRACT
    ) {
      if (
        run.analysisId !== null ||
        run.sessionId !== null ||
        run.replayArtifactState !== "not_recorded" ||
        run.replayArtifactSha256 !== null ||
        run.codeCommitSha !== null ||
        run.codeState !== "legacy_unknown" ||
        run.codeFingerprintSha256 !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Legacy runs cannot claim replay, execution, or code provenance that their contracts did not record."
        });
      }
    }
    if (
      run.sources[0].source !== "github" ||
      run.sources[1].source !== "codex"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "Run sources must use the GitHub, Codex order."
      });
    }
    if (
      run.supportingSources[0].source !== "google_calendar" ||
      run.supportingSources[1].source !== "notion"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportingSources"],
        message:
          "Supporting sources must use the Google Calendar, Notion order."
      });
    }
    if (
      (run.decisionStatus === "suggested") !==
      (run.topCandidateId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topCandidateId"],
        message:
          "Only suggested runs can retain a top candidate identifier."
      });
    }
    const activeRun =
      run.contract === ATTENTION_MONITOR_RUN_CONTRACT ||
      run.contract === ATTENTION_MONITOR_PREVIEW_CONTRACT;
    if (
      (activeRun &&
        run.orchestratorVersion !==
          ATTENTION_LIVE_ORCHESTRATOR_VERSION) ||
      (!activeRun &&
        run.orchestratorVersion === ATTENTION_LIVE_ORCHESTRATOR_VERSION)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["orchestratorVersion"],
        message:
          "Monitor orchestrator version must match its contract generation."
      });
    }
    const activeVersionsMatch =
      run.policyVersion === ACTIVE_ATTENTION_POLICY_VERSION &&
      run.candidateRuleVersion ===
        ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION &&
      run.lanePolicyVersion === ACTIVE_ATTENTION_LANE_POLICY_VERSION &&
      run.rankingPolicyVersion ===
        ACTIVE_ATTENTION_RANKING_POLICY_VERSION &&
      run.resolverVersion === ACTIVE_ATTENTION_RESOLVER_VERSION &&
      run.idPolicyVersion === ACTIVE_ATTENTION_ID_POLICY_VERSION;
    const legacyVersionsMatch =
      run.githubCandidateRuleVersion !== null &&
      run.codexOverviewRuleVersion !== null &&
      run.candidateRuleVersion === null &&
      run.lanePolicyVersion === null &&
      run.rankingPolicyVersion === null &&
      run.resolverVersion === null &&
      run.idPolicyVersion === null;
    if (
      (activeRun &&
        (!activeVersionsMatch ||
          run.githubCandidateRuleVersion !== null ||
          run.codexOverviewRuleVersion !== null)) ||
      (!activeRun && !legacyVersionsMatch)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateRuleVersion"],
        message:
          "Monitor semantic versions must match their contract generation."
      });
    }
    if (
      (activeRun &&
        (run.resultContract !== ACTIVE_ATTENTION_RESULT_CONTRACT ||
          !activeResultIdSchema.safeParse(run.resultId).success)) ||
      (!activeRun &&
        !stableIdSchema.safeParse(run.resultId).success)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resultContract"],
        message:
          "Monitor result identity must match its contract generation."
      });
    }
    const activeCounts = activeCandidateCountsSchema.safeParse(
      run.candidateCounts
    );
    const legacyCounts = legacyCandidateCountsSchema.safeParse(
      run.candidateCounts
    );
    const activeAssessments = run.candidateAssessments.flatMap(
      (assessment) => {
        const parsed =
          activeAttentionCandidateAssessmentMonitorSchema.safeParse(
            assessment
          );
        return parsed.success ? [parsed.data] : [];
      }
    );
    if (
      activeRun &&
      run.topCandidateId !== null &&
      !activeCandidateIdSchema.safeParse(run.topCandidateId).success
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topCandidateId"],
        message:
          "An active run top candidate must use the active candidate identity contract."
      });
    }
    const legacyAssessments = run.candidateAssessments.flatMap(
      (assessment) => {
        const parsed =
          attentionCandidateAssessmentMonitorSchema.safeParse(
            assessment
          );
        return parsed.success ? [parsed.data] : [];
      }
    );
    if (
      (activeRun &&
        (!activeCounts.success ||
          activeAssessments.length !== run.candidateAssessments.length)) ||
      (!activeRun &&
        (!legacyCounts.success ||
          legacyAssessments.length !== run.candidateAssessments.length))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateAssessments"],
        message:
          "Candidate assessment metadata must match its monitor contract generation."
      });
    }
    if (
      run.candidateAssessmentDetailState === "available" &&
      activeRun &&
      activeCounts.success
    ) {
      const counted = {
        eligible: 0,
        reviewRequired: 0,
        ineligible: 0
      };
      for (const assessment of activeAssessments) {
        counted[
          assessment.status === "review_required"
            ? "reviewRequired"
            : assessment.status
        ] += 1;
      }
      if (
        counted.eligible !== activeCounts.data.eligible ||
        counted.reviewRequired !== activeCounts.data.reviewRequired ||
        counted.ineligible !== activeCounts.data.ineligible
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidateAssessments"],
          message:
            "Active candidate assessment metadata must match the run counts."
        });
      }
      if (run.topCandidateId !== null) {
        const matchingEligible = activeAssessments.filter(
          (assessment) =>
            assessment.status === "eligible" &&
            assessment.candidateId === run.topCandidateId
        );
        if (matchingEligible.length !== 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["topCandidateId"],
            message:
              "An active top candidate must map to exactly one eligible assessment."
          });
        }
      }
    }
    if (
      run.candidateAssessmentDetailState === "available" &&
      !activeRun &&
      legacyCounts.success
    ) {
      const counted = {
        eligible: 0,
        provisional: 0,
        ineligible: 0
      };
      for (const assessment of legacyAssessments) {
        counted[assessment.disposition] += 1;
      }
      if (
        counted.eligible !== legacyCounts.data.eligible ||
        counted.provisional !== legacyCounts.data.provisional ||
        counted.ineligible !== legacyCounts.data.ineligible
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["candidateAssessments"],
          message:
            "Legacy candidate assessment metadata must match the run counts."
        });
      }
    }
    if (
      run.candidateAssessmentDetailState === "not_recorded" &&
      run.candidateAssessments.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateAssessments"],
        message:
          "Legacy runs without assessment detail cannot contain assessments."
      });
    }
  });

export const attentionMonitorRunSchema = z.preprocess(
  normalizeLegacyRunProvenance,
  attentionMonitorRunStrictSchema
);

const attentionReplayEnvelopeShape = {
  runId: stableIdSchema,
  analysisId: stableIdSchema,
  sessionId: stableIdSchema,
  capturedAt: timestampSchema,
  inputSha256: sha256Schema,
  privacyClass: z.literal("private_local_engine_input"),
  retentionDays: z.literal(ATTENTION_MONITOR_RETENTION_DAYS)
};

export const currentAttentionReplayInputArtifactSchema = z
  .object({
    ...attentionReplayEnvelopeShape,
    contract: z.literal(ATTENTION_REPLAY_INPUT_CONTRACT),
    input: activeAttentionInputSchema
  })
  .strict()
  .superRefine((artifact, context) => {
    const calculated = activeAttentionInputSha256(artifact.input);
    if (
      artifact.input.contract !== ACTIVE_ATTENTION_INPUT_CONTRACT ||
      artifact.inputSha256 !== artifact.input.inputSha256 ||
      artifact.inputSha256 !== calculated
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputSha256"],
        message:
          "Replay v2 must contain the exact canonical Active Attention input."
      });
    }
  });

const previousAttentionReplayInputArtifactSchema = z
  .object({
    ...attentionReplayEnvelopeShape,
    contract: z.literal(ATTENTION_REPLAY_INPUT_PREVIOUS_CONTRACT),
    input: phase2AttentionInputSchema
  })
  .strict()
  .superRefine((artifact, context) => {
    const calculated = runtimeSha256({
      domain: "blabase-cross-source-attention-input-v0.3",
      input: artifact.input
    });
    if (artifact.inputSha256 !== calculated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputSha256"],
        message:
          "Previous replay artifact hash must match its canonical v0.3 input."
      });
    }
  });

const legacyAttentionReplayInputArtifactSchema = z
  .object({
    ...attentionReplayEnvelopeShape,
    contract: z.literal(ATTENTION_REPLAY_INPUT_PREVIOUS_CONTRACT),
    input: z.record(z.unknown())
  })
  .strict()
  .superRefine((artifact, context) => {
    if (
      artifact.input.contract !==
      "cross-source-attention-input-v0.2"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["input", "contract"],
        message:
          "Legacy replay artifacts require the v0.2 Attention input contract."
      });
      return;
    }
    const calculated = runtimeSha256({
      domain: "blabase-cross-source-attention-input-v0.2",
      input: artifact.input
    });
    if (artifact.inputSha256 !== calculated) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputSha256"],
        message:
          "Legacy replay artifact hash must match its canonical v0.2 input."
      });
    }
  });

export const attentionReplayInputArtifactSchema = z.union([
  currentAttentionReplayInputArtifactSchema,
  previousAttentionReplayInputArtifactSchema,
  legacyAttentionReplayInputArtifactSchema
]);

export const attentionFeedbackTypeSchema = z.enum([
  "helpful",
  "wrong_priority",
  "already_done",
  "not_mine",
  "insufficient_context"
]);

export const attentionFeedbackRequestSchema = z
  .object({
    runId: stableIdSchema,
    feedbackType: attentionFeedbackTypeSchema
  })
  .strict();

export const attentionFeedbackRecordSchema = z
  .object({
    contract: z.literal(ATTENTION_FEEDBACK_CONTRACT),
    feedbackId: z.string().uuid(),
    createdAt: timestampSchema,
    runId: stableIdSchema,
    candidateId: stableIdSchema.nullable(),
    feedbackType: attentionFeedbackTypeSchema,
    supersedesFeedbackId: z.string().uuid().nullable().default(null),
    signalSource: z.literal("explicit_rating"),
    explicit: z.literal(true),
    reviewState: z.literal("candidate"),
    privacyClass: z.literal("private_local_metadata"),
    retentionDays: z.literal(ATTENTION_MONITOR_RETENTION_DAYS)
  })
  .strict();

const attentionMonitorFailureCommonShape = {
    runId: stableIdSchema,
    analysisId: stableIdSchema,
    sessionId: stableIdSchema,
    status: z.literal("failed"),
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    stage: z.enum(["source_sync", "attention_resolution"]),
    errorCode: z.enum([
      "SOURCE_SYNC_FAILED",
      "ATTENTION_RESOLUTION_FAILED"
    ]),
    retryCount: z.number().int().nonnegative().max(10),
    latencyMs: z.number().int().nonnegative(),
    freshnessPolicyVersion: z.literal(
      ATTENTION_LIVE_FRESHNESS_POLICY_VERSION
    ),
    codeCommitSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    codeState: z.enum([
      "clean_commit",
      "declared_commit",
      "dirty_worktree",
      "unavailable",
      "legacy_unknown"
    ]),
    codeFingerprintSha256: sha256Schema.nullable(),
    privacyClass: z.literal("private_local_metadata"),
    retentionDays: z.literal(ATTENTION_MONITOR_RETENTION_DAYS)
};

const currentAttentionMonitorFailureRecordSchema = z
  .object({
    ...attentionMonitorFailureCommonShape,
    contract: z.literal(ATTENTION_MONITOR_FAILURE_CONTRACT),
    engineVersion: z.literal(ATTENTION_LIVE_ORCHESTRATOR_VERSION),
    inputSchemaVersion: z.literal(ACTIVE_ATTENTION_INPUT_CONTRACT),
    resultSchemaVersion: z.literal(ACTIVE_ATTENTION_RESULT_CONTRACT),
    policyVersion: z.literal(ACTIVE_ATTENTION_POLICY_VERSION),
    candidateRuleVersion: z.literal(
      ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION
    ),
    lanePolicyVersion: z.literal(ACTIVE_ATTENTION_LANE_POLICY_VERSION),
    rankingPolicyVersion: z.literal(
      ACTIVE_ATTENTION_RANKING_POLICY_VERSION
    ),
    resolverVersion: z.literal(ACTIVE_ATTENTION_RESOLVER_VERSION),
    idPolicyVersion: z.literal(ACTIVE_ATTENTION_ID_POLICY_VERSION)
  })
  .strict();

const legacyAttentionMonitorFailureRecordSchema = z
  .object({
    ...attentionMonitorFailureCommonShape,
    contract: z.literal(ATTENTION_MONITOR_FAILURE_LEGACY_CONTRACT),
    engineVersion: z.literal(
      ATTENTION_LIVE_ORCHESTRATOR_PREVIOUS_VERSION
    ),
    inputSchemaVersion: z.literal(PHASE2_ATTENTION_INPUT_CONTRACT),
    resultSchemaVersion: z.literal(PHASE2_ATTENTION_RESULT_CONTRACT),
    policyVersion: z.literal(PHASE2_ATTENTION_POLICY_VERSION),
    githubCandidateRuleVersion: z.literal(
      PHASE2_GITHUB_CANDIDATE_RULE_VERSION
    ),
    codexOverviewRuleVersion: z.literal(
      PHASE2_CODEX_OVERVIEW_RULE_VERSION
    )
  })
  .strict();

const previousAttentionMonitorFailureRecordSchema = z
  .object({
    ...attentionMonitorFailureCommonShape,
    contract: z.literal(ATTENTION_MONITOR_FAILURE_PREVIOUS_CONTRACT),
    engineVersion: z.literal(
      ATTENTION_LIVE_ORCHESTRATOR_PREVIOUS_VERSION
    ),
    inputSchemaVersion: z.literal(PHASE2_ATTENTION_INPUT_CONTRACT),
    resultSchemaVersion: z.literal(PHASE2_ATTENTION_RESULT_CONTRACT),
    policyVersion: z.literal(PHASE2_ATTENTION_POLICY_VERSION),
    githubCandidateRuleVersion: z.literal(
      PHASE2_GITHUB_CANDIDATE_RULE_VERSION
    ),
    codexOverviewRuleVersion: z.literal(
      PHASE2_CODEX_OVERVIEW_RULE_VERSION
    )
  })
  .strict();

const attentionMonitorFailureRecordStrictSchema = z
  .discriminatedUnion("contract", [
    currentAttentionMonitorFailureRecordSchema,
    previousAttentionMonitorFailureRecordSchema,
    legacyAttentionMonitorFailureRecordSchema
  ])
  .superRefine((failure, context) => {
    if (
      failure.contract ===
      ATTENTION_MONITOR_FAILURE_LEGACY_CONTRACT
    ) {
      if (
        failure.codeCommitSha !== null ||
        failure.codeState !== "legacy_unknown" ||
        failure.codeFingerprintSha256 !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeState"],
          message:
            "Legacy failure records cannot claim code provenance."
        });
      }
    } else {
      const cleanCode =
        failure.codeState === "clean_commit" ||
        failure.codeState === "declared_commit";
      if (
        (cleanCode &&
          (failure.codeCommitSha === null ||
            failure.codeFingerprintSha256 !== null)) ||
        (failure.codeState === "dirty_worktree" &&
          (failure.codeCommitSha !== null ||
            failure.codeFingerprintSha256 === null)) ||
        (failure.codeState === "unavailable" &&
          (failure.codeCommitSha !== null ||
            failure.codeFingerprintSha256 !== null)) ||
        failure.codeState === "legacy_unknown"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["codeState"],
          message:
            "Current failure code provenance fields are inconsistent."
        });
      }
    }
    const expectedErrorCode =
      failure.stage === "source_sync"
        ? "SOURCE_SYNC_FAILED"
        : "ATTENTION_RESOLUTION_FAILED";
    if (failure.errorCode !== expectedErrorCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "Failure error code must match its sanitized stage."
      });
    }
    const elapsed =
      Date.parse(failure.completedAt) - Date.parse(failure.startedAt);
    if (elapsed < 0 || failure.latencyMs !== elapsed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latencyMs"],
        message:
          "Failure latency must equal the non-negative execution interval."
      });
    }
  });

export const attentionMonitorFailureRecordSchema = z.preprocess(
  normalizeLegacyFailureProvenance,
  attentionMonitorFailureRecordStrictSchema
);

export const attentionMonitorStoreSchema = z
  .object({
    contract: z.literal(ATTENTION_MONITOR_STORE_CONTRACT),
    updatedAt: timestampSchema,
    runs: z.array(attentionMonitorRunSchema),
    feedback: z.array(attentionFeedbackRecordSchema),
    failures: z.array(attentionMonitorFailureRecordSchema).default([])
  })
  .strict()
  .superRefine((store, context) => {
    for (const [index, run] of store.runs.entries()) {
      if (run.contract === ATTENTION_MONITOR_PREVIEW_CONTRACT) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runs", index, "contract"],
          message:
            "Ephemeral previews cannot be persisted as monitor runs."
        });
      }
    }
  });

export type AttentionSourceMonitor = z.infer<
  typeof attentionSourceMonitorSchema
>;
export type AttentionSupportingSourceMonitor = z.infer<
  typeof attentionSupportingSourceMonitorSchema
>;
export type AttentionWorkContextMonitor = z.infer<
  typeof attentionWorkContextMonitorSchema
>;
export type AttentionMonitorRun = z.infer<
  typeof attentionMonitorRunSchema
>;
export type ActiveAttentionCandidateAssessmentMonitor = z.infer<
  typeof activeAttentionCandidateAssessmentMonitorSchema
>;
export type ActiveAttentionMonitorRun = Omit<
  AttentionMonitorRun,
  "contract" | "candidateCounts" | "candidateAssessments"
> & {
  contract:
    | typeof ATTENTION_MONITOR_RUN_CONTRACT
    | typeof ATTENTION_MONITOR_PREVIEW_CONTRACT;
  candidateCounts: z.infer<typeof activeCandidateCountsSchema>;
  candidateAssessments: ActiveAttentionCandidateAssessmentMonitor[];
};

export function isActiveAttentionMonitorRun(
  run: AttentionMonitorRun
): run is ActiveAttentionMonitorRun {
  return (
    run.contract === ATTENTION_MONITOR_RUN_CONTRACT ||
    run.contract === ATTENTION_MONITOR_PREVIEW_CONTRACT
  );
}
export type AttentionReplayInputArtifact = z.infer<
  typeof currentAttentionReplayInputArtifactSchema
>;
export type StoredAttentionReplayInputArtifact = z.infer<
  typeof attentionReplayInputArtifactSchema
>;
export type AttentionFeedbackType = z.infer<
  typeof attentionFeedbackTypeSchema
>;
export type AttentionFeedbackRequest = z.infer<
  typeof attentionFeedbackRequestSchema
>;
export type AttentionFeedbackRecord = z.infer<
  typeof attentionFeedbackRecordSchema
>;
export type AttentionMonitorFailureRecord = z.infer<
  typeof attentionMonitorFailureRecordSchema
>;
export type AttentionMonitorStore = z.infer<
  typeof attentionMonitorStoreSchema
>;

export type AttentionReadyResponse = {
  status: "ready";
  result: ActiveAttentionResult;
  baseResult: Phase2AttentionResult;
  eligibilityProjection: AttentionEligibilityShadowProjection;
  run: AttentionMonitorRun;
  monitoring: {
    state: "preview" | "recorded" | "degraded";
    warningCode: "RUN_HISTORY_WRITE_FAILED" | null;
  };
};

export type AttentionUnavailableResponse = {
  status: "unavailable";
  message: string;
  localUrl: string;
};

export type AttentionErrorResponse = {
  status: "error";
  code: string;
  message: string;
};

export type AttentionApiResponse =
  | AttentionReadyResponse
  | AttentionUnavailableResponse
  | AttentionErrorResponse;

export type AttentionHistoryEntry = AttentionMonitorRun & {
  feedback: AttentionFeedbackRecord[];
};

export type AttentionHistoryResponse =
  | {
      status: "ready";
      generatedAt: string;
      retentionDays: number;
      runCount: number;
      failureCount: number;
      feedbackCount: number;
      feedbackEventCount: number;
      decisionCounts: Record<
        AttentionMonitorRun["decisionStatus"],
        number
      >;
      feedbackCounts: Record<AttentionFeedbackType, number>;
      failures: AttentionMonitorFailureRecord[];
      entries: AttentionHistoryEntry[];
    }
  | AttentionUnavailableResponse
  | AttentionErrorResponse;
