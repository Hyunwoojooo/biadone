import { z } from "zod";

import { runtimeWorkSignalBatchSchema } from "./schema";
import {
  PHASE2_ATTENTION_INPUT_CONTRACT,
  PHASE2_ATTENTION_POLICY_VERSION,
  PHASE2_ATTENTION_RESULT_CONTRACT,
  PHASE2_CODEX_METADATA_RETENTION_POLICY_VERSION,
  PHASE2_CODEX_OVERVIEW_RULE_VERSION,
  PHASE2_GITHUB_CANDIDATE_RULE_VERSION
} from "./versions";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const stableIdSchema = z.string().regex(/^[a-z]+_[a-f0-9]{32}$/);
const timestampSchema = z.string().datetime();

export const phase2UnavailableReasonSchema = z.enum([
  "CONNECTOR_DISCONNECTED",
  "COLLECTION_FAILED",
  "SNAPSHOT_MISSING",
  "SNAPSHOT_PARSE_FAILED",
  "SNAPSHOT_SCHEMA_UNSUPPORTED"
]);

const availableSourceSchema = z
  .object({
    status: z.literal("available"),
    batch: runtimeWorkSignalBatchSchema
  })
  .strict();

const unavailableSourceSchema = z
  .object({
    status: z.literal("unavailable"),
    reason: phase2UnavailableReasonSchema
  })
  .strict();

export const phase2SourceInputSchema = z.discriminatedUnion("status", [
  availableSourceSchema,
  unavailableSourceSchema
]);

export const phase2UserFocusSchema = z
  .object({
    primaryOutcome: z.string().trim().min(1).max(240).nullable(),
    capturedAt: timestampSchema.nullable(),
    validUntil: timestampSchema.nullable()
  })
  .strict()
  .superRefine((focus, context) => {
    const allNull =
      focus.primaryOutcome === null &&
      focus.capturedAt === null &&
      focus.validUntil === null;
    const allPresent =
      focus.primaryOutcome !== null &&
      focus.capturedAt !== null &&
      focus.validUntil !== null;
    if (!allNull && !allPresent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Primary outcome, capturedAt, and validUntil must be present together."
      });
    }
    if (
      allPresent &&
      Date.parse(focus.capturedAt as string) >=
        Date.parse(focus.validUntil as string)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "Focus validUntil must be later than capturedAt."
      });
    }
  });

export const phase2AttentionPolicySchema = z
  .object({
    version: z.literal(PHASE2_ATTENTION_POLICY_VERSION),
    recommendationMode: z.literal("aggressive_evidence_bound"),
    laneOrder: z.tuple([
      z.literal("must_now"),
      z.literal("unblock"),
      z.literal("close_loop"),
      z.literal("focus")
    ]),
    dueSoonWindowMs: z.number().int().positive(),
    maxAlternatives: z.number().int().min(0).max(2),
    weeklyOutcomeCadenceDays: z.literal(7),
    readOnly: z.literal(true),
    codexMetadataRetentionDays: z.literal(30),
    codexRawContentRetention: z.literal("none"),
    codexMetadataRetentionPolicyVersion: z.literal(
      PHASE2_CODEX_METADATA_RETENTION_POLICY_VERSION
    )
  })
  .strict();

export const DEFAULT_PHASE2_ATTENTION_POLICY = {
  version: PHASE2_ATTENTION_POLICY_VERSION,
  recommendationMode: "aggressive_evidence_bound",
  laneOrder: [
    "must_now",
    "unblock",
    "close_loop",
    "focus"
  ],
  dueSoonWindowMs: 48 * 60 * 60 * 1_000,
  maxAlternatives: 2,
  weeklyOutcomeCadenceDays: 7,
  readOnly: true,
  codexMetadataRetentionDays: 30,
  codexRawContentRetention: "none",
  codexMetadataRetentionPolicyVersion:
    PHASE2_CODEX_METADATA_RETENTION_POLICY_VERSION
} as const;

export const phase2AttentionInputSchema = z
  .object({
    contract: z.literal(PHASE2_ATTENTION_INPUT_CONTRACT),
    asOf: timestampSchema,
    focus: phase2UserFocusSchema,
    policy: phase2AttentionPolicySchema,
    sources: z
      .object({
        github: phase2SourceInputSchema,
        codex: phase2SourceInputSchema
      })
      .strict()
  })
  .strict()
  .superRefine((input, context) => {
    for (const [slot, source] of Object.entries(input.sources)) {
      if (
        source.status === "available" &&
        (source.batch.source !== slot ||
          source.batch.assessment.asOf !== input.asOf)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sources", slot],
          message:
            "Available source batches must match their slot and the decision asOf."
        });
      }
    }
  });

export const phase2CandidateReasonSchema = z.enum([
  "CANDIDATE_GITHUB_ASSIGNED_ISSUE",
  "CANDIDATE_GITHUB_REVIEW_STATUS_CHECK"
]);

export const phase2WhyNowReasonSchema = z.enum([
  "WHY_NOW_MILESTONE_OVERDUE",
  "WHY_NOW_MILESTONE_DUE_SOON",
  "WHY_NOW_REVIEW_REQUEST_OBSERVED",
  "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH",
  "WHY_NOW_OPEN_ASSIGNED_WORK"
]);

export const phase2CaveatCodeSchema = z.enum([
  "CAVEAT_REVIEW_DRAFT_UNKNOWN",
  "CAVEAT_CANDIDATE_SET_INCOMPLETE",
  "CAVEAT_DEFAULT_TIE_BREAK_USED",
  "CAVEAT_CODEX_EXCEPTION_CONTRACT_UNAVAILABLE",
  "CAVEAT_NOTION_UNEVALUATED",
  "CAVEAT_GOOGLE_CALENDAR_UNEVALUATED",
  "CAVEAT_PRIMARY_OUTCOME_RELATION_UNRESOLVED"
]);

export const phase2GateReasonSchema = z.enum([
  "GATE_SOURCE_NOT_CURRENT",
  "GATE_CONTEXT_ONLY",
  "GATE_NATIVE_DESTINATION_MISSING",
  "GATE_NOT_CANDIDATE_INPUT"
]);

export const phase2DecisionReasonSchema = z.enum([
  "DECISION_BEST_OBSERVED_CANDIDATE",
  "DECISION_SCOPED_NO_ACTION",
  "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
]);

export const phase2CoverageReasonSchema = z.enum([
  "SOURCE_GITHUB_FRESH_COMPLETE",
  "SOURCE_GITHUB_FRESH_PARTIAL",
  "SOURCE_GITHUB_STALE_OR_INVALID",
  "SOURCE_GITHUB_UNAVAILABLE",
  "SOURCE_CODEX_OVERVIEW_ONLY",
  "SOURCE_CODEX_STALE_OVERVIEW",
  "SOURCE_CODEX_STALE_OR_INVALID",
  "SOURCE_CODEX_UNAVAILABLE",
  "SOURCE_NOTION_UNEVALUATED",
  "SOURCE_GOOGLE_CALENDAR_UNEVALUATED"
]);

export const phase2CandidateSchema = z
  .object({
    candidateId: stableIdSchema,
    source: z.literal("github"),
    subjectId: z.string().min(1).max(240),
    sourceSignalIds: z.array(stableIdSchema).min(1).max(4),
    taskKind: z.enum([
      "assigned_issue",
      "review_requested_pull_request"
    ]),
    title: z.string().min(1).max(240),
    repositoryFullName: z.string().min(1).max(240),
    number: z.number().int().positive(),
    intervention: z.enum(["do", "inspect"]),
    lane: z.enum(["must_now", "unblock", "focus"]),
    state: z.literal("unclear"),
    dueAt: timestampSchema.nullable(),
    destinationUrl: z.string().url(),
    certainty: z.enum(["confirmed", "provisional"]),
    reasonCodes: z.array(phase2CandidateReasonSchema).min(1).max(2),
    whyNowReasonCodes: z.array(phase2WhyNowReasonSchema).min(1).max(3),
    caveatCodes: z.array(phase2CaveatCodeSchema).max(4),
    sourceUpdatedAt: timestampSchema.nullable(),
    firstStep: z.string().min(1).max(300),
    explanation: z.string().min(1).max(500)
  })
  .strict()
  .superRefine((candidate, context) => {
    if (
      candidate.taskKind === "assigned_issue" &&
      (candidate.intervention !== "do" ||
        candidate.caveatCodes.includes(
          "CAVEAT_REVIEW_DRAFT_UNKNOWN"
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Assigned issues must use the direct do intervention."
      });
    }
    if (
      candidate.taskKind === "review_requested_pull_request" &&
      (candidate.intervention !== "inspect" ||
        candidate.certainty !== "provisional" ||
        !candidate.caveatCodes.includes(
          "CAVEAT_REVIEW_DRAFT_UNKNOWN"
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Current review requests must remain provisional draft-status inspections."
      });
    }
    if (
      candidate.lane === "must_now" &&
      candidate.dueAt === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueAt"],
        message: "must_now requires a native deadline."
      });
    }
  });

export const phase2CandidateAssessmentSchema = z
  .object({
    assessmentId: stableIdSchema,
    subjectId: z.string().min(1).max(240),
    signalId: stableIdSchema,
    taskKind: z.enum([
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ]),
    disposition: z.enum([
      "eligible",
      "provisional",
      "ineligible"
    ]),
    candidateId: stableIdSchema.nullable(),
    gateReasonCodes: z.array(phase2GateReasonSchema).max(4)
  })
  .strict();

export const phase2CodexOverviewItemSchema = z
  .object({
    executionId: z.string().min(1).max(240),
    signalId: stableIdSchema,
    observationId: stableIdSchema,
    nativeActivityState: z.enum([
      "active",
      "idle",
      "not_loaded",
      "system_error",
      "unknown"
    ]),
    semanticState: z.enum(["idle", "not_loaded", "unknown"]),
    nativeAttentionState: z
      .enum(["waiting_on_approval", "waiting_on_user_input"])
      .nullable(),
    attentionSemanticRole: z.literal("overview_badge_only"),
    projectLabel: z.string().min(1).max(120),
    taskSummary: z.string().min(1).max(200).nullable(),
    taskSummarySemanticRole: z.literal("display_only_unknown"),
    observedAt: timestampSchema,
    sourceUpdatedAt: timestampSchema,
    freshness: z.enum(["fresh", "stale"]),
    reasonCode: z.enum([
      "OVERVIEW_CODEX_ACTIVITY_OBSERVED",
      "OVERVIEW_CODEX_EXECUTION_IDLE",
      "OVERVIEW_CODEX_EXECUTION_NOT_LOADED",
      "OVERVIEW_CODEX_SYSTEM_ERROR_STATUS",
      "OVERVIEW_CODEX_STATE_UNKNOWN"
    ]),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const phase2CoverageSchema = z
  .object({
    disposition: z.enum([
      "scoped_complete",
      "limited_but_sufficient",
      "insufficient"
    ]),
    githubCandidateCoverage: z.enum([
      "complete",
      "partial",
      "unavailable"
    ]),
    negativeCandidateCoverageComplete: z.boolean(),
    evaluatedCandidateSources: z.array(z.literal("github")).max(1),
    overviewOnlySources: z.array(z.literal("codex")).max(1),
    unevaluatedSources: z.tuple([
      z.literal("google_calendar"),
      z.literal("notion")
    ]),
    reasonCodes: z.array(phase2CoverageReasonSchema).min(3).max(5)
  })
  .strict();

const phase2DecisionSchema = z
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
    topSuggestion: phase2CandidateSchema.nullable(),
    alternatives: z.array(phase2CandidateSchema).max(2),
    reasonCodes: z.array(phase2DecisionReasonSchema).min(1).max(2),
    caveatCodes: z.array(phase2CaveatCodeSchema).max(8),
    scopeStatement: z.string().min(1).max(500)
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      decision.status === "suggested" &&
      (decision.topSuggestion === null ||
        decision.certainty === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Suggested decisions require a top suggestion and certainty."
      });
    }
    if (
      decision.status !== "suggested" &&
      (decision.topSuggestion !== null ||
        decision.alternatives.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Only suggested decisions can contain ranked candidates."
      });
    }
    if (
      decision.status === "no_action" &&
      decision.certainty !== "scoped"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "no_action is always scoped in Phase 2."
      });
    }
    if (
      decision.status === "insufficient_evidence" &&
      decision.certainty !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Insufficient-evidence decisions cannot claim certainty."
      });
    }
  });

export const phase2AttentionResultSchema = z
  .object({
    contract: z.literal(PHASE2_ATTENTION_RESULT_CONTRACT),
    resultId: stableIdSchema,
    inputSha256: sha256Schema,
    resultSha256: sha256Schema,
    asOf: timestampSchema,
    policyVersion: z.literal(PHASE2_ATTENTION_POLICY_VERSION),
    githubCandidateRuleVersion: z.literal(
      PHASE2_GITHUB_CANDIDATE_RULE_VERSION
    ),
    codexOverviewRuleVersion: z.literal(
      PHASE2_CODEX_OVERVIEW_RULE_VERSION
    ),
    recommendationMode: z.literal("aggressive_evidence_bound"),
    readOnly: z.literal(true),
    focusContext: z
      .object({
        present: z.boolean(),
        active: z.boolean(),
        appliedToRanking: z.boolean(),
        relationStatus: z.enum([
          "not_provided",
          "not_yet_active",
          "expired",
          "text_match_only",
          "unresolved"
        ])
      })
      .strict(),
    coverage: phase2CoverageSchema,
    candidateAssessments: z
      .array(phase2CandidateAssessmentSchema)
      .max(300),
    workCockpit: z
      .object({
        codexExecutions: z
          .array(phase2CodexOverviewItemSchema)
          .max(300)
      })
      .strict(),
    decision: phase2DecisionSchema
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.decision.status === "no_action" &&
      !result.coverage.negativeCandidateCoverageComplete
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage"],
        message:
          "Scoped no_action requires complete GitHub negative coverage."
      });
    }
    if (
      result.decision.status === "suggested" &&
      result.candidateAssessments.every(
        (assessment) =>
          assessment.disposition === "ineligible"
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateAssessments"],
        message: "A suggested result requires an actionable assessment."
      });
    }
  });

export type Phase2SourceInput = z.infer<
  typeof phase2SourceInputSchema
>;
export type Phase2UserFocus = z.infer<
  typeof phase2UserFocusSchema
>;
export type Phase2AttentionPolicy = z.infer<
  typeof phase2AttentionPolicySchema
>;
export type Phase2AttentionInput = z.infer<
  typeof phase2AttentionInputSchema
>;
export type Phase2Candidate = z.infer<
  typeof phase2CandidateSchema
>;
export type Phase2CaveatCode = z.infer<
  typeof phase2CaveatCodeSchema
>;
export type Phase2CandidateAssessment = z.infer<
  typeof phase2CandidateAssessmentSchema
>;
export type Phase2CodexOverviewItem = z.infer<
  typeof phase2CodexOverviewItemSchema
>;
export type Phase2Coverage = z.infer<typeof phase2CoverageSchema>;
export type Phase2AttentionResult = z.infer<
  typeof phase2AttentionResultSchema
>;
