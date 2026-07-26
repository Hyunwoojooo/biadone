import { z } from "zod";

export const CROSS_SOURCE_EVALUATION_SCHEMA_VERSION =
  "cross-source-evaluation-case-v0.1";
export const CROSS_SOURCE_REASON_CODE_VERSION =
  "cross-source-reason-codes-v0.1";
export const CROSS_SOURCE_ATTENTION_DEFINITION_VERSION =
  "cross-source-attention-definition-v0.2";

export const CONNECTED_SOURCES = [
  "conversation",
  "notion",
  "google_calendar",
  "github",
  "codex"
] as const;

export const ATTENTION_CAPABILITIES = [
  "candidate_capable",
  "overview_only",
  "unsupported"
] as const;

export const ATTENTION_INTERVENTIONS = [
  "do",
  "review",
  "approve",
  "decide",
  "inspect",
  "resume",
  "close_loop",
  "prepare",
  "follow_up",
  "clarify",
  "wait",
  "none"
] as const;

export const RANKABLE_ATTENTION_LANES = [
  "must_now",
  "unblock",
  "close_loop",
  "focus"
] as const;

export const CODEX_EXECUTION_STATES = [
  "queued",
  "running",
  "waiting",
  "stalled",
  "failed",
  "completed",
  "cancelled",
  "idle",
  "not_loaded",
  "unknown"
] as const;

export const OVERVIEW_REASON_CODES = [
  "OVERVIEW_CODEX_EXECUTION_HEALTHY",
  "OVERVIEW_CODEX_ACTIVITY_OBSERVED",
  "OVERVIEW_CODEX_EXECUTION_RECENT_PROGRESS",
  "OVERVIEW_CODEX_EXECUTION_IDLE",
  "OVERVIEW_CODEX_EXECUTION_NOT_LOADED",
  "OVERVIEW_CODEX_SYSTEM_ERROR_STATUS",
  "OVERVIEW_CODEX_STATE_UNKNOWN",
  "OVERVIEW_CODEX_EXECUTION_COMPLETED",
  "OVERVIEW_CODEX_FAILURE_RECOVERED",
  "OVERVIEW_CODEX_FAILURE_ACTIVE",
  "OVERVIEW_CODEX_EXECUTION_STALLED",
  "OVERVIEW_CODEX_STALL_NO_MATERIAL_LINK",
  "OVERVIEW_CODEX_REQUEST_BELOW_THRESHOLD",
  "OVERVIEW_CODEX_REQUEST_STATUS_ONLY",
  "OVERVIEW_CALENDAR_CONSTRAINT",
  "OVERVIEW_SOURCE_CONTEXT_ONLY"
] as const;

export const CANDIDATE_REASON_CODES = [
  "CANDIDATE_USER_INTERVENTION_EXPLICIT",
  "CANDIDATE_SHARED_INTERVENTION_EXPLICIT",
  "CANDIDATE_GITHUB_ISSUE_ASSIGNED",
  "CANDIDATE_GITHUB_REVIEW_REQUESTED",
  "CANDIDATE_NOTION_MAPPED_TASK_OPEN",
  "CANDIDATE_CALENDAR_LINKED_PREPARATION",
  "CANDIDATE_CONVERSATION_USER_COMMITMENT",
  "CANDIDATE_CODEX_STALL_VERIFIED",
  "CANDIDATE_CODEX_FAILURE_ACTIVE",
  "CANDIDATE_CODEX_FOLLOW_THROUGH_OPEN",
  "CANDIDATE_CODEX_SCOPE_DRIFT_VERIFIED",
  "CANDIDATE_CODEX_REQUEST_ESCALATED"
] as const;

export const WHY_NOW_REASON_CODES = [
  "WHY_NOW_VERIFIED_DEADLINE",
  "WHY_NOW_EXPLICIT_BLOCKER",
  "WHY_NOW_PERSON_WAITING",
  "WHY_NOW_PRIMARY_OUTCOME_ALIGNED",
  "WHY_NOW_CONFIGURED_LOOP_OPEN",
  "WHY_NOW_LINKED_COMMITMENT_IMMINENT"
] as const;

export const GATE_REASON_CODES = [
  "GATE_FINAL_STATE",
  "GATE_NO_USER_INTERVENTION",
  "GATE_OWNER_NOT_USER_OR_SHARED",
  "GATE_HEALTHY_CODEX_EXECUTION",
  "GATE_CODEX_EXCEPTION_UNVERIFIED",
  "GATE_FAILURE_RECOVERED",
  "GATE_TRANSIENT_REQUEST_NOT_ESCALATED",
  "GATE_TRANSIENT_REQUEST_ID_MISSING",
  "GATE_TRANSIENT_REQUEST_RESOLVED",
  "GATE_TRANSIENT_REQUEST_EXPIRED",
  "GATE_FOLLOW_THROUGH_NOT_CONFIGURED",
  "GATE_DIRECT_EVIDENCE_MISSING",
  "GATE_NATIVE_DESTINATION_MISSING",
  "GATE_WAIT_ONLY",
  "GATE_UNSUPPORTED_DEADLINE",
  "GATE_UNSUPPORTED_CONSEQUENCE"
] as const;

export const REVIEW_REASON_CODES = [
  "REVIEW_SOURCE_STALE",
  "REVIEW_SOURCE_PARTIAL",
  "REVIEW_SOURCE_TRUNCATED",
  "REVIEW_CODEX_HISTORY_INSUFFICIENT",
  "REVIEW_FAILURE_LIFECYCLE_UNKNOWN",
  "REVIEW_SCOPE_BASELINE_MISSING",
  "REVIEW_IDENTITY_UNRESOLVED",
  "REVIEW_STATE_CONFLICT",
  "REVIEW_OWNER_CONFLICT",
  "REVIEW_DEADLINE_CONFLICT",
  "REVIEW_CRITICAL_CONFLICT_UNRESOLVED"
] as const;

export const DECISION_REASON_CODES = [
  "DECISION_TOP_ITEM_SELECTED",
  "DECISION_TOP_CANDIDATES_EQUIVALENT",
  "DECISION_USER_PRIORITY_REQUIRED",
  "DECISION_NO_ELIGIBLE_INTERVENTION",
  "DECISION_ALL_OBSERVED_WORK_HEALTHY",
  "DECISION_RELEVANT_COVERAGE_INSUFFICIENT",
  "DECISION_SOURCE_REFRESH_REQUIRED"
] as const;

export const CROSS_SOURCE_ERROR_TAXONOMY = [
  "missing_candidate",
  "false_candidate",
  "wrong_identity_merge",
  "missed_identity_merge",
  "wrong_state",
  "wrong_owner",
  "false_deadline",
  "false_urgency",
  "wrong_dependency",
  "wrong_execution_state",
  "missing_execution_overview_item",
  "false_stall",
  "missed_stall",
  "false_failure",
  "missed_failure",
  "false_follow_through",
  "missed_follow_through",
  "false_scope_drift",
  "missed_scope_drift",
  "transient_request_escalated_too_early",
  "stale_ephemeral_attention",
  "healthy_execution_recommended",
  "unsupported_progress_summary",
  "wrong_lane",
  "wrong_ranking",
  "missed_clarification",
  "unnecessary_clarification",
  "missed_no_action",
  "false_no_action",
  "unsafe_first_step",
  "stale_source_used",
  "privacy_scope_violation"
] as const;

const connectedSourceSchema = z.enum(CONNECTED_SOURCES);
const attentionCapabilitySchema = z.enum(ATTENTION_CAPABILITIES);
const attentionInterventionSchema = z.enum(ATTENTION_INTERVENTIONS);
const rankableAttentionLaneSchema = z.enum(RANKABLE_ATTENTION_LANES);
const codexExecutionStateSchema = z.enum(CODEX_EXECUTION_STATES);
const overviewReasonCodeSchema = z.enum(OVERVIEW_REASON_CODES);
const candidateReasonCodeSchema = z.enum(CANDIDATE_REASON_CODES);
const whyNowReasonCodeSchema = z.enum(WHY_NOW_REASON_CODES);
const gateReasonCodeSchema = z.enum(GATE_REASON_CODES);
const reviewReasonCodeSchema = z.enum(REVIEW_REASON_CODES);
const decisionReasonCodeSchema = z.enum(DECISION_REASON_CODES);
const crossSourceErrorSchema = z.enum(CROSS_SOURCE_ERROR_TAXONOMY);

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const isoDateTimeSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

function instant(value: string): number {
  return Date.parse(value);
}

const factScalarSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null()
]);
const factValueSchema = z.union([
  factScalarSchema,
  z.array(factScalarSchema).max(50)
]);
const safeDestinationRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(
    /^(github|notion|gcal|codex|conversation|synthetic):\/\/[A-Za-z0-9][A-Za-z0-9._~:/-]*$/
  );

const pendingTransientRequestFactsSchema = z
  .object({
    requestId: identifierSchema,
    requestKind: z.enum(["approval", "user_input"]),
    lifecycle: z.literal("pending"),
    requestedAt: isoDateTimeSchema,
    resolvedAt: z.null(),
    expiredAt: z.null(),
    validUntil: isoDateTimeSchema.nullable(),
    thresholdExceeded: z.boolean(),
    blocksExecution: z.boolean()
  })
  .strict();

const resolvedTransientRequestFactsSchema = z
  .object({
    requestId: identifierSchema,
    requestKind: z.enum(["approval", "user_input"]),
    lifecycle: z.literal("resolved"),
    requestedAt: isoDateTimeSchema,
    resolvedAt: isoDateTimeSchema,
    expiredAt: z.null(),
    validUntil: isoDateTimeSchema.nullable(),
    thresholdExceeded: z.boolean(),
    blocksExecution: z.literal(false)
  })
  .strict();

const expiredTransientRequestFactsSchema = z
  .object({
    requestId: identifierSchema,
    requestKind: z.enum(["approval", "user_input"]),
    lifecycle: z.literal("expired"),
    requestedAt: isoDateTimeSchema,
    resolvedAt: z.null(),
    expiredAt: isoDateTimeSchema,
    validUntil: isoDateTimeSchema.nullable(),
    thresholdExceeded: z.boolean(),
    blocksExecution: z.literal(false)
  })
  .strict();

const transientRequestFactsSchema = z.discriminatedUnion("lifecycle", [
  pendingTransientRequestFactsSchema,
  resolvedTransientRequestFactsSchema,
  expiredTransientRequestFactsSchema
]);

const mutableLifecycleSchema = z
  .object({
    state: z.literal("mutable"),
    datasetSha256: z.null(),
    immutableRef: z.null(),
    frozenAt: z.null()
  })
  .strict();

const frozenLifecycleSchema = z
  .object({
    state: z.literal("frozen"),
    datasetSha256: sha256Schema,
    immutableRef: z.string().trim().min(1).max(300),
    frozenAt: isoDateTimeSchema
  })
  .strict();

const datasetLifecycleSchema = z.discriminatedUnion("state", [
  mutableLifecycleSchema,
  frozenLifecycleSchema
]);

const userFocusContextSchema = z
  .object({
    primaryOutcome: z.string().trim().min(1).max(240).nullable(),
    capturedAt: isoDateTimeSchema.nullable(),
    validUntil: isoDateTimeSchema.nullable(),
    activeProjectIds: z.array(identifierSchema).max(20)
  })
  .strict()
  .superRefine((focus, context) => {
    if (
      focus.primaryOutcome === null &&
      (focus.capturedAt !== null || focus.validUntil !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "capturedAt and validUntil must be null when primaryOutcome is null"
      });
    }
    if (
      focus.primaryOutcome !== null &&
      (focus.capturedAt === null || focus.validUntil === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "an active primaryOutcome requires capturedAt and validUntil"
      });
    }

    if (
      focus.capturedAt !== null &&
      focus.validUntil !== null &&
      instant(focus.capturedAt) >= instant(focus.validUntil)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "focus validUntil must be later than capturedAt"
      });
    }

    if (new Set(focus.activeProjectIds).size !== focus.activeProjectIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "focus activeProjectIds must be unique"
      });
    }
  });

const snapshotReferenceSchema = z
  .object({
    snapshotId: identifierSchema,
    snapshotSha256: sha256Schema,
    fetchedAt: isoDateTimeSchema,
    schemaVersion: z.string().trim().min(1).max(120),
    normalizerVersion: z.string().trim().min(1).max(120),
    fixtureRef: z.string().trim().min(1).max(300)
  })
  .strict();

const sourceSnapshotWindowSchema = z
  .object({
    source: connectedSourceSchema,
    status: z.enum([
      "fresh",
      "stale",
      "partial",
      "failed",
      "disconnected"
    ]),
    attentionCapability: attentionCapabilitySchema,
    materialToDecision: z.boolean(),
    candidateSetComplete: z.boolean(),
    observationStartedAt: isoDateTimeSchema,
    observationEndedAt: isoDateTimeSchema,
    truncated: z.boolean(),
    orderedSnapshotRefs: z.array(snapshotReferenceSchema).max(50)
  })
  .strict()
  .superRefine((window, context) => {
    if (
      instant(window.observationStartedAt) >
      instant(window.observationEndedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "observationStartedAt must not be after observationEndedAt"
      });
    }

    const unavailable =
      window.status === "failed" || window.status === "disconnected";
    if (unavailable && window.orderedSnapshotRefs.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "failed or disconnected windows cannot contain snapshots"
      });
    }
    if (!unavailable && window.orderedSnapshotRefs.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "available windows require at least one snapshot"
      });
    }
    if (unavailable && window.attentionCapability !== "unsupported") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "failed or disconnected windows must declare unsupported capability"
      });
    }
    if (
      window.candidateSetComplete &&
      (window.status !== "fresh" ||
        window.truncated ||
        window.attentionCapability !== "candidate_capable")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a complete candidate set requires a fresh, non-truncated, candidate-capable window"
      });
    }

    let previousFetchedAt: number | null = null;
    for (const snapshot of window.orderedSnapshotRefs) {
      if (
        instant(snapshot.fetchedAt) < instant(window.observationStartedAt) ||
        instant(snapshot.fetchedAt) > instant(window.observationEndedAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `snapshot ${snapshot.snapshotId} is outside its observation window`
        });
      }
      if (
        previousFetchedAt !== null &&
        instant(snapshot.fetchedAt) <= previousFetchedAt
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "orderedSnapshotRefs must be strictly chronological"
        });
      }
      previousFetchedAt = instant(snapshot.fetchedAt);
    }
  });

const workSignalSchema = z
  .object({
    signalId: identifierSchema,
    source: connectedSourceSchema,
    nativeId: identifierSchema,
    subjectId: identifierSchema,
    subjectType: z.enum([
      "work_item",
      "execution",
      "request",
      "event",
      "project",
      "page",
      "repository"
    ]),
    projectId: identifierSchema.nullable(),
    kind: z.enum([
      "task_exists",
      "task_state",
      "ownership",
      "deadline",
      "review_requested",
      "scheduled_commitment",
      "activity",
      "execution_state",
      "execution_phase",
      "execution_progress",
      "execution_exception",
      "execution_completion",
      "execution_output",
      "handoff_state",
      "scope_observation",
      "transient_attention_lifecycle",
      "user_correction"
    ]),
    observedAt: isoDateTimeSchema,
    sourceUpdatedAt: isoDateTimeSchema.nullable(),
    validUntil: isoDateTimeSchema.nullable(),
    evidenceLevel: z.enum([
      "explicit",
      "accepted_context",
      "derived",
      "inferred",
      "unsupported"
    ]),
    completeness: z.enum(["complete", "partial", "unknown"]),
    facts: z.record(z.string().trim().min(1).max(80), factValueSchema),
    evidenceRefs: z.array(identifierSchema).min(1).max(20),
    destinationRef: safeDestinationRefSchema.nullable()
  })
  .strict();

/**
 * Evaluation-only signal contract. Runtime connector normalizers must use the
 * strict runtime WorkSignal schema and cross this boundary through an explicit
 * adapter.
 */
export const syntheticNormalizedSignalSchema = workSignalSchema;

const relationSchema = z
  .object({
    relationId: identifierSchema,
    fromSubjectId: identifierSchema,
    toSubjectId: identifierSchema,
    type: z.enum([
      "same_work_item",
      "executes",
      "produces",
      "blocks",
      "blocked_by",
      "related_to",
      "prepares_for",
      "requires_follow_through",
      "implements_goal"
    ]),
    authority: z.enum([
      "explicit_native",
      "user_configured",
      "deterministic_policy"
    ]),
    evidenceSignalIds: z.array(identifierSchema).min(1).max(20)
  })
  .strict();

const attentionDispositionSchema = z
  .object({
    overview: z.enum(["include", "exclude"]),
    candidate: z.enum([
      "eligible_signal",
      "review_required",
      "excluded"
    ])
  })
  .strict();

const reasonCodeBucketsSchema = z
  .object({
    overview: z.array(overviewReasonCodeSchema).max(20),
    candidate: z.array(candidateReasonCodeSchema).max(20),
    whyNow: z.array(whyNowReasonCodeSchema).max(10),
    gate: z.array(gateReasonCodeSchema).max(20),
    review: z.array(reviewReasonCodeSchema).max(20)
  })
  .strict();

const firstStepExpectationSchema = z
  .object({
    required: z.boolean(),
    destinationRequired: z.boolean(),
    acceptableInterventions: z.array(attentionInterventionSchema).max(10),
    evidenceSignalIds: z.array(identifierSchema).max(20)
  })
  .strict();

const attentionAnnotationSchema = z
  .object({
    itemId: identifierSchema,
    sourceSubjectIds: z.array(identifierSchema).min(1).max(20),
    disposition: attentionDispositionSchema,
    acceptableOverviewStates: z.array(codexExecutionStateSchema).max(10),
    eligibility: z.enum(["eligible", "review_required", "ineligible"]),
    interventions: z
      .object({
        required: z.array(attentionInterventionSchema).max(1),
        acceptable: z.array(attentionInterventionSchema).max(10),
        forbidden: z.array(attentionInterventionSchema).max(12)
      })
      .strict(),
    acceptableLanes: z.array(rankableAttentionLaneSchema).max(4),
    forbiddenAsRankableCandidateAtDecision: z.boolean(),
    reasonCodes: reasonCodeBucketsSchema,
    firstStep: firstStepExpectationSchema,
    notes: z.string().trim().max(600)
  })
  .strict()
  .superRefine((annotation, context) => {
    const expectedEligibility = {
      eligible_signal: "eligible",
      review_required: "review_required",
      excluded: "ineligible"
    }[annotation.disposition.candidate];

    if (annotation.eligibility !== expectedEligibility) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "candidate disposition and eligibility must agree"
      });
    }

    const interventionGroups = [
      annotation.interventions.required,
      annotation.interventions.acceptable,
      annotation.interventions.forbidden
    ];
    for (const group of interventionGroups) {
      if (new Set(group).size !== group.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "intervention lists cannot contain duplicates"
        });
      }
    }
    const requiredOrAcceptable = new Set([
      ...annotation.interventions.required,
      ...annotation.interventions.acceptable
    ]);
    if (
      annotation.interventions.forbidden.some((value) =>
        requiredOrAcceptable.has(value)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "an intervention cannot be both allowed and forbidden"
      });
    }

    for (const values of Object.values(annotation.reasonCodes)) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "reason-code buckets cannot contain duplicates"
        });
      }
    }

    if (
      annotation.disposition.overview === "include" &&
      annotation.reasonCodes.overview.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "overview inclusion requires an overview reason code"
      });
    }
    if (
      annotation.disposition.overview === "exclude" &&
      (annotation.reasonCodes.overview.length > 0 ||
        annotation.acceptableOverviewStates.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "overview-excluded annotations cannot declare overview states or reason codes"
      });
    }

    if (annotation.eligibility === "eligible") {
      if (
        annotation.reasonCodes.candidate.length === 0 ||
        annotation.acceptableLanes.length === 0 ||
        annotation.interventions.required.length !== 1 ||
        annotation.forbiddenAsRankableCandidateAtDecision ||
        !annotation.firstStep.required ||
        !annotation.firstStep.destinationRequired
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "eligible annotations require candidate reasons, a lane, one primary intervention, and a destination-backed first step"
        });
      }
      if (
        [...requiredOrAcceptable].some((intervention) =>
          ["clarify", "wait", "none"].includes(intervention)
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "eligible rankable annotations require an actionable intervention"
        });
      }
    } else if (annotation.acceptableLanes.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only eligible annotations can have a rankable lane"
      });
    }

    if (
      annotation.eligibility === "review_required" &&
      annotation.reasonCodes.review.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "review-required annotations require a review reason code"
      });
    }
    if (
      annotation.eligibility === "review_required" &&
      !annotation.forbiddenAsRankableCandidateAtDecision
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "review-required annotations cannot be ranked at the current decision"
      });
    }

    if (annotation.eligibility === "ineligible") {
      if (
        annotation.reasonCodes.gate.length === 0 ||
        !annotation.forbiddenAsRankableCandidateAtDecision ||
        annotation.firstStep.required
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "ineligible annotations require a gate reason and must be forbidden as candidates"
        });
      }
    }

    if (
      annotation.firstStep.required &&
      annotation.firstStep.evidenceSignalIds.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a required first step must cite at least one signal"
      });
    }
    if (
      !annotation.firstStep.required &&
      (annotation.firstStep.destinationRequired ||
        annotation.firstStep.acceptableInterventions.length > 0 ||
        annotation.firstStep.evidenceSignalIds.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a non-required first step cannot carry action requirements"
      });
    }
    if (
      annotation.firstStep.acceptableInterventions.some(
        (intervention) => !requiredOrAcceptable.has(intervention)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "first-step interventions must be allowed by the annotation intervention contract"
      });
    }
  });

const codexExecutionExpectationSchema = z
  .object({
    executionId: identifierSchema,
    acceptableStates: z.array(codexExecutionStateSchema).max(10),
    mustAppearInOverview: z.boolean(),
    executionForbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict()
  .superRefine((expectation, context) => {
    if (
      expectation.mustAppearInOverview &&
      expectation.acceptableStates.length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "visible Codex executions require an acceptable state"
      });
    }
    if (
      !expectation.mustAppearInOverview &&
      expectation.acceptableStates.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "hidden Codex executions cannot declare an overview state"
      });
    }
  });

const coverageExpectationSchema = z
  .object({
    disposition: z.enum([
      "complete",
      "limited_but_sufficient",
      "insufficient"
    ]),
    negativeCandidateCoverageComplete: z.boolean(),
    limitedSources: z.array(connectedSourceSchema).max(CONNECTED_SOURCES.length),
    materialUncertaintySources: z
      .array(connectedSourceSchema)
      .max(CONNECTED_SOURCES.length),
    uncertaintyBasis: z
      .array(
        z.enum([
          "source_coverage",
          "history_gap",
          "contract_gap",
          "critical_conflict"
        ])
      )
      .max(4),
    positiveCandidateIndependentOfUnknowns: z.boolean()
  })
  .strict();

const decisionExpectationSchema = z
  .object({
    status: z.enum([
      "suggested",
      "needs_clarification",
      "no_action",
      "insufficient_evidence"
    ]),
    acceptableTopItemIds: z.array(identifierSchema).max(20),
    forbiddenItemIds: z.array(identifierSchema).max(100),
    reasonCodes: z.array(decisionReasonCodeSchema).min(1).max(10),
    clarification: z
      .object({
        questionIntent: z.string().trim().min(1).max(300),
        answerChanges: z.enum(["top_item", "eligibility"])
      })
      .strict()
      .nullable()
  })
  .strict();

const pairwisePreferenceSchema = z
  .object({
    preferredItemId: identifierSchema,
    overItemId: identifierSchema,
    reasonCode: whyNowReasonCodeSchema
  })
  .strict();

const detectorConfigReferenceSchema = z
  .object({
    version: z.string().trim().min(1).max(120),
    immutableRef: z.string().trim().min(1).max(300),
    sha256: sha256Schema
  })
  .strict();

const reviewRecordSchema = z
  .object({
    status: z.enum(["draft", "reviewed", "adjudicated", "frozen"]),
    authorId: identifierSchema,
    reviewerIds: z.array(identifierSchema).max(10),
    adjudicationRef: z.string().trim().min(1).max(300).nullable(),
    notes: z.string().trim().max(1000)
  })
  .strict()
  .superRefine((review, context) => {
    if (
      review.status === "draft" &&
      (review.reviewerIds.length > 0 || review.adjudicationRef !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "draft cases cannot claim review or adjudication"
      });
    }
    if (review.status === "reviewed" && review.reviewerIds.length < 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewed cases require at least one reviewer"
      });
    }
    if (
      (review.status === "adjudicated" || review.status === "frozen") &&
      (review.reviewerIds.length < 2 || review.adjudicationRef === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "adjudicated or frozen cases require two reviewers and an adjudication reference"
      });
    }
    if (new Set(review.reviewerIds).size !== review.reviewerIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewerIds must be unique"
      });
    }
    if (review.reviewerIds.includes(review.authorId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "the author cannot count as an independent reviewer"
      });
    }
  });

export const crossSourceEvaluationCaseSchema = z
  .object({
    caseId: identifierSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(800),
    tags: z.array(identifierSchema).min(1).max(20),
    decisionAt: isoDateTimeSchema,
    timezone: z.string().trim().min(1).max(80),
    focus: userFocusContextSchema,
    sourceSnapshotWindows: z.array(sourceSnapshotWindowSchema).min(1).max(10),
    workSignals: z.array(workSignalSchema).max(100),
    relations: z.array(relationSchema).max(100),
    codexDetectorConfig: detectorConfigReferenceSchema.nullable(),
    annotations: z.array(attentionAnnotationSchema).min(1).max(100),
    expectedCodexExecutions: z
      .array(codexExecutionExpectationSchema)
      .max(100),
    expectedCoverage: coverageExpectationSchema,
    expectedDecision: decisionExpectationSchema,
    pairwisePreferences: z.array(pairwisePreferenceSchema).max(100),
    hardFailureRisks: z.array(crossSourceErrorSchema).min(1).max(20),
    review: reviewRecordSchema
  })
  .strict()
  .superRefine((evaluationCase, context) => {
    const ensureUnique = (values: string[], label: string) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be unique`
        });
      }
    };

    ensureUnique(evaluationCase.tags, "tags");
    ensureUnique(
      evaluationCase.sourceSnapshotWindows.map((window) => window.source),
      "source windows"
    );
    ensureUnique(
      evaluationCase.sourceSnapshotWindows.flatMap((window) =>
        window.orderedSnapshotRefs.map((snapshot) => snapshot.snapshotId)
      ),
      "snapshot IDs"
    );
    ensureUnique(
      evaluationCase.workSignals.map((signal) => signal.signalId),
      "signal IDs"
    );
    ensureUnique(
      evaluationCase.relations.map((relation) => relation.relationId),
      "relation IDs"
    );
    ensureUnique(
      evaluationCase.annotations.map((annotation) => annotation.itemId),
      "annotation item IDs"
    );
    ensureUnique(
      evaluationCase.expectedCodexExecutions.map(
        (expectation) => expectation.executionId
      ),
      "Codex execution IDs"
    );
    ensureUnique(
      evaluationCase.expectedCoverage.limitedSources,
      "limitedSources"
    );
    ensureUnique(
      evaluationCase.expectedCoverage.materialUncertaintySources,
      "materialUncertaintySources"
    );
    ensureUnique(
      evaluationCase.expectedCoverage.uncertaintyBasis,
      "uncertaintyBasis"
    );
    ensureUnique(
      evaluationCase.expectedDecision.acceptableTopItemIds,
      "acceptableTopItemIds"
    );
    ensureUnique(
      evaluationCase.expectedDecision.forbiddenItemIds,
      "forbiddenItemIds"
    );

    const sourceWindows = new Map(
      evaluationCase.sourceSnapshotWindows.map((window) => [
        window.source,
        window
      ])
    );
    const snapshots = new Map(
      evaluationCase.sourceSnapshotWindows.flatMap((window) =>
        window.orderedSnapshotRefs.map(
          (snapshot) =>
            [
              snapshot.snapshotId,
              {
                source: window.source,
                fetchedAt: snapshot.fetchedAt
              }
            ] as const
        )
      )
    );
    const signalIds = new Set(
      evaluationCase.workSignals.map((signal) => signal.signalId)
    );
    const subjectIds = new Set(
      evaluationCase.workSignals.map((signal) => signal.subjectId)
    );
    const subjectTypes = new Map<string, Set<string>>();
    for (const signal of evaluationCase.workSignals) {
      const types = subjectTypes.get(signal.subjectId) ?? new Set<string>();
      types.add(signal.subjectType);
      subjectTypes.set(signal.subjectId, types);
    }
    for (const [subjectId, types] of subjectTypes) {
      if (types.size > 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `subject ${subjectId} cannot merge different subject types`
        });
      }
    }
    const annotations = new Map(
      evaluationCase.annotations.map((annotation) => [
        annotation.itemId,
        annotation
      ])
    );
    const signals = new Map(
      evaluationCase.workSignals.map((signal) => [signal.signalId, signal])
    );
    const expectedCodexExecutionIds = new Set(
      evaluationCase.expectedCodexExecutions.map(
        (expectation) => expectation.executionId
      )
    );
    const transientRequestHistory = new Map<
      string,
      Array<{
        signal: (typeof evaluationCase.workSignals)[number];
        facts: z.infer<typeof transientRequestFactsSchema>;
      }>
    >();

    if (
      evaluationCase.focus.capturedAt !== null &&
      instant(evaluationCase.focus.capturedAt) >
        instant(evaluationCase.decisionAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "focus cannot be captured after decisionAt"
      });
    }
    if (
      evaluationCase.focus.validUntil !== null &&
      instant(evaluationCase.focus.validUntil) <=
        instant(evaluationCase.decisionAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "focus must still be active at decisionAt"
      });
    }

    for (const window of evaluationCase.sourceSnapshotWindows) {
      if (
        instant(window.observationEndedAt) >
        instant(evaluationCase.decisionAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `source window ${window.source} extends past decisionAt`
        });
      }
    }

    for (const signal of evaluationCase.workSignals) {
      const window = sourceWindows.get(signal.source);
      const isCodexTransientRequest =
        signal.source === "codex" &&
        signal.kind === "transient_attention_lifecycle";
      if (
        signal.source === "codex" &&
        signal.subjectType !==
          (isCodexTransientRequest ? "request" : "execution")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Codex signal ${signal.signalId} has an invalid subjectType`
        });
      }
      if (
        signal.source !== "codex" &&
        (signal.subjectType === "execution" ||
          signal.subjectType === "request")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `non-Codex signal ${signal.signalId} cannot use a Codex subjectType`
        });
      }
      if (
        signal.subjectType === "request" &&
        signal.kind !== "transient_attention_lifecycle"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `request subject ${signal.subjectId} requires lifecycle evidence`
        });
      }
      if (
        window === undefined ||
        window.status === "failed" ||
        window.status === "disconnected"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `signal ${signal.signalId} has no usable source window`
        });
      }
      if (
        instant(signal.observedAt) > instant(evaluationCase.decisionAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `signal ${signal.signalId} is later than decisionAt`
        });
      }
      if (
        signal.sourceUpdatedAt !== null &&
        instant(signal.sourceUpdatedAt) > instant(evaluationCase.decisionAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `signal ${signal.signalId} sourceUpdatedAt is later than decisionAt`
        });
      }
      if (
        window !== undefined &&
        (instant(signal.observedAt) <
          instant(window.observationStartedAt) ||
          instant(signal.observedAt) > instant(window.observationEndedAt))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `signal ${signal.signalId} is outside its source observation window`
        });
      }
      if (
        signal.sourceUpdatedAt !== null &&
        instant(signal.sourceUpdatedAt) > instant(signal.observedAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `signal ${signal.signalId} sourceUpdatedAt is later than observedAt`
        });
      }
      for (const evidenceRef of signal.evidenceRefs) {
        const snapshot = snapshots.get(evidenceRef);
        if (snapshot?.source !== signal.source) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `signal ${signal.signalId} references an unknown or cross-source snapshot`
          });
        } else if (
          instant(signal.observedAt) > instant(snapshot.fetchedAt)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `signal ${signal.signalId} was observed after its evidence snapshot`
          });
        }
      }

      if (signal.kind === "transient_attention_lifecycle") {
        const lifecycle = transientRequestFactsSchema.safeParse(signal.facts);
        if (!lifecycle.success) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `signal ${signal.signalId} has an invalid transient request lifecycle`
          });
        } else {
          const facts = lifecycle.data;
          if (signal.subjectType !== "request") {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `transient request ${facts.requestId} must use request subjectType`
            });
          }
          if (facts.requestId !== signal.subjectId) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `transient request ${facts.requestId} must use its requestId as subjectId`
            });
          }
          const history = transientRequestHistory.get(facts.requestId) ?? [];
          history.push({ signal, facts });
          transientRequestHistory.set(facts.requestId, history);
          if (
            instant(facts.requestedAt) > instant(signal.observedAt) ||
            ("resolvedAt" in facts &&
              facts.resolvedAt !== null &&
              (instant(facts.resolvedAt) < instant(facts.requestedAt) ||
                instant(facts.resolvedAt) > instant(signal.observedAt))) ||
            ("expiredAt" in facts &&
              facts.expiredAt !== null &&
              (instant(facts.expiredAt) < instant(facts.requestedAt) ||
                instant(facts.expiredAt) > instant(signal.observedAt)))
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `signal ${signal.signalId} has inconsistent request timestamps`
            });
          }
          if (
            facts.lifecycle === "pending" &&
            facts.validUntil !== null &&
            instant(facts.validUntil) <= instant(evaluationCase.decisionAt)
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `pending request ${facts.requestId} is expired at decisionAt`
            });
          }
          if (
            facts.lifecycle === "pending" &&
            facts.validUntil !== signal.validUntil
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `pending request ${facts.requestId} validUntil must match its signal validity`
            });
          }
        }
      }
    }

    for (const [requestId, history] of transientRequestHistory) {
      history.sort(
        (left, right) =>
          Date.parse(left.signal.observedAt) -
          Date.parse(right.signal.observedAt)
      );
      const requestKinds = new Set(history.map((entry) => entry.facts.requestKind));
      const requestedTimes = new Set(
        history.map((entry) => entry.facts.requestedAt)
      );
      if (requestKinds.size !== 1 || requestedTimes.size !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `request ${requestId} must preserve stable kind and requestedAt across snapshots`
        });
      }

      const firstTerminalIndex = history.findIndex(
        (entry) => entry.facts.lifecycle !== "pending"
      );
      if (
        firstTerminalIndex >= 0 &&
        history
          .slice(firstTerminalIndex + 1)
          .some(
            (entry) =>
              entry.facts.lifecycle !==
              history[firstTerminalIndex].facts.lifecycle
          )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `request ${requestId} cannot regress or change after a terminal lifecycle`
        });
      }

      const latest = history.at(-1);
      if (latest === undefined) {
        continue;
      }
      const relatedAnnotations = evaluationCase.annotations.filter(
        (annotation) => annotation.sourceSubjectIds.includes(requestId)
      );
      const hasEligibleAnnotation = relatedAnnotations.some(
        (annotation) => annotation.eligibility === "eligible"
      );

      if (latest.facts.lifecycle !== "pending") {
        if (
          relatedAnnotations.some(
            (annotation) =>
              annotation.eligibility !== "ineligible" ||
              annotation.disposition.overview !== "exclude"
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `resolved or expired request ${requestId} must leave overview and candidate sets`
          });
        }
        continue;
      }

      if (
        (!latest.facts.thresholdExceeded ||
          !latest.facts.blocksExecution) &&
        hasEligibleAnnotation
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `request ${requestId} cannot be eligible before both threshold and blocking checks pass`
        });
      }

      if (latest.facts.thresholdExceeded) {
        const latestSnapshotInstants = latest.signal.evidenceRefs
          .map((reference) => snapshots.get(reference)?.fetchedAt)
          .filter((value): value is string => value !== undefined)
          .map(instant);
        const earliestLatestSnapshot = Math.min(...latestSnapshotInstants);
        const hasEarlierPendingObservation = history
          .slice(0, -1)
          .some(
            (entry) =>
              entry.facts.lifecycle === "pending" &&
              instant(entry.signal.observedAt) <
                instant(latest.signal.observedAt) &&
              entry.signal.evidenceRefs.some((reference) => {
                const fetchedAt = snapshots.get(reference)?.fetchedAt;
                return (
                  fetchedAt !== undefined &&
                  instant(fetchedAt) < earliestLatestSnapshot
                );
              })
          );
        if (!hasEarlierPendingObservation) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `threshold-exceeded request ${requestId} requires ordered stable history`
          });
        }
      }

      if (latest.facts.blocksExecution) {
        const hasBlockingExecutionRelation = evaluationCase.relations.some(
          (relation) =>
            relation.fromSubjectId === requestId &&
            relation.type === "blocks" &&
            evaluationCase.workSignals.some(
              (signal) =>
                signal.subjectId === relation.toSubjectId &&
                signal.subjectType === "execution"
            )
        );
        if (!hasBlockingExecutionRelation) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `blocking request ${requestId} requires a relation to an execution`
          });
        }
      }
    }

    for (const signal of evaluationCase.workSignals) {
      if (
        signal.source === "codex" &&
        signal.subjectType === "execution" &&
        !expectedCodexExecutionIds.has(signal.subjectId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Codex subject ${signal.subjectId} has no execution expectation`
        });
      }
    }

    for (const relation of evaluationCase.relations) {
      if (
        !subjectIds.has(relation.fromSubjectId) ||
        !subjectIds.has(relation.toSubjectId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `relation ${relation.relationId} has an unknown endpoint`
        });
      }
      for (const evidenceSignalId of relation.evidenceSignalIds) {
        if (!signalIds.has(evidenceSignalId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `relation ${relation.relationId} references an unknown signal`
          });
        }
      }
    }

    for (const annotation of evaluationCase.annotations) {
      for (const subjectId of annotation.sourceSubjectIds) {
        if (!subjectIds.has(subjectId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `annotation ${annotation.itemId} references an unknown subject`
          });
        }
      }
      const hasDirectRequestSubject = annotation.sourceSubjectIds.some(
        (subjectId) =>
          evaluationCase.workSignals.some(
            (signal) =>
              signal.subjectId === subjectId &&
              signal.subjectType === "request"
          )
      );
      const usesEscalatedRequestCandidate =
        annotation.reasonCodes.candidate.includes(
          "CANDIDATE_CODEX_REQUEST_ESCALATED"
        );
      const usesIdentifiedRequestReason =
        usesEscalatedRequestCandidate ||
        annotation.reasonCodes.overview.includes(
          "OVERVIEW_CODEX_REQUEST_BELOW_THRESHOLD"
        ) ||
        annotation.reasonCodes.gate.some((reason) =>
          [
            "GATE_TRANSIENT_REQUEST_NOT_ESCALATED",
            "GATE_TRANSIENT_REQUEST_RESOLVED",
            "GATE_TRANSIENT_REQUEST_EXPIRED"
          ].includes(reason)
        );
      if (usesIdentifiedRequestReason && !hasDirectRequestSubject) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `annotation ${annotation.itemId} uses an identified request reason without a request subject`
        });
      }
      if (
        annotation.reasonCodes.overview.includes(
          "OVERVIEW_CODEX_REQUEST_STATUS_ONLY"
        ) &&
        !hasDirectRequestSubject &&
        (!annotation.reasonCodes.gate.includes(
          "GATE_TRANSIENT_REQUEST_ID_MISSING"
        ) ||
          annotation.eligibility !== "ineligible")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `annotation ${annotation.itemId} can use an unidentified request badge only as gated overview`
        });
      }
      if (
        usesEscalatedRequestCandidate &&
        !annotation.firstStep.evidenceSignalIds.some((signalId) => {
          const evidenceSignal = signals.get(signalId);
          return (
            evidenceSignal?.subjectType === "request" &&
            annotation.sourceSubjectIds.includes(evidenceSignal.subjectId)
          );
        })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `request candidate ${annotation.itemId} requires direct request lifecycle evidence`
        });
      }
      for (const evidenceSignalId of annotation.firstStep.evidenceSignalIds) {
        const evidenceSignal = signals.get(evidenceSignalId);
        if (evidenceSignal === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `annotation ${annotation.itemId} first step references an unknown signal`
          });
          continue;
        }
        if (
          evidenceSignal.completeness !== "complete" ||
          evidenceSignal.evidenceLevel === "inferred" ||
          evidenceSignal.evidenceLevel === "unsupported"
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `annotation ${annotation.itemId} first step relies on incomplete or unsupported evidence`
          });
        }
        const directlyOwnedEvidence = annotation.sourceSubjectIds.includes(
          evidenceSignal.subjectId
        );
        const relationBackedEvidence = evaluationCase.relations.some(
          (relation) =>
            (annotation.sourceSubjectIds.includes(relation.fromSubjectId) &&
              relation.toSubjectId === evidenceSignal.subjectId) ||
            (annotation.sourceSubjectIds.includes(relation.toSubjectId) &&
              relation.fromSubjectId === evidenceSignal.subjectId)
        );
        if (!directlyOwnedEvidence && !relationBackedEvidence) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `annotation ${annotation.itemId} first step uses evidence from an unrelated subject`
          });
        }
        if (
          evidenceSignal.validUntil !== null &&
          instant(evidenceSignal.validUntil) <=
            instant(evaluationCase.decisionAt)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `annotation ${annotation.itemId} first step uses expired evidence`
          });
        }
      }
      if (
        annotation.firstStep.destinationRequired &&
        !annotation.firstStep.evidenceSignalIds.some(
          (signalId) => signals.get(signalId)?.destinationRef !== null
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `annotation ${annotation.itemId} requires a source-native destination`
        });
      }
    }

    for (const expectation of evaluationCase.expectedCodexExecutions) {
      if (
        !evaluationCase.workSignals.some(
          (signal) =>
            signal.subjectId === expectation.executionId &&
            signal.source === "codex" &&
            signal.subjectType === "execution"
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Codex execution ${expectation.executionId} has no execution subject`
        });
      }
      const relatedAnnotations = evaluationCase.annotations.filter(
        (annotation) =>
          annotation.sourceSubjectIds.includes(expectation.executionId)
      );
      if (relatedAnnotations.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Codex execution ${expectation.executionId} has no annotation`
        });
      }
      const overviewStates = new Set(
        relatedAnnotations.flatMap(
          (annotation) => annotation.acceptableOverviewStates
        )
      );
      if (
        expectation.acceptableStates.some(
          (state) => !overviewStates.has(state)
        ) ||
        [...overviewStates].some(
          (state) => !expectation.acceptableStates.includes(state)
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Codex execution ${expectation.executionId} states disagree with its annotations`
        });
      }
      const mustAppearFromAnnotations = relatedAnnotations.some(
        (annotation) => annotation.disposition.overview === "include"
      );
      if (expectation.mustAppearInOverview !== mustAppearFromAnnotations) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Codex execution ${expectation.executionId} overview visibility disagrees with its annotations`
        });
      }
    }

    const topIds = new Set(
      evaluationCase.expectedDecision.acceptableTopItemIds
    );
    const forbiddenIds = new Set(
      evaluationCase.expectedDecision.forbiddenItemIds
    );
    for (const itemId of [...topIds, ...forbiddenIds]) {
      if (!annotations.has(itemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `decision references unknown item ${itemId}`
        });
      }
    }
    for (const itemId of topIds) {
      if (forbiddenIds.has(itemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `item ${itemId} cannot be both acceptable and forbidden`
        });
      }
    }
    for (const annotation of evaluationCase.annotations) {
      if (
        annotation.forbiddenAsRankableCandidateAtDecision &&
        !forbiddenIds.has(annotation.itemId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `forbidden annotation ${annotation.itemId} must appear in forbiddenItemIds`
        });
      }
    }

    const decision = evaluationCase.expectedDecision;
    if (decision.status === "suggested") {
      if (topIds.size === 0 || decision.clarification !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "suggested decisions require an acceptable top item and no clarification"
        });
      }
      for (const itemId of topIds) {
        const annotation = annotations.get(itemId);
        if (annotation?.eligibility !== "eligible") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `suggested top item ${itemId} must be eligible`
          });
        }
        if (
          annotation !== undefined &&
          (annotation.reasonCodes.whyNow.length < 1 ||
            annotation.reasonCodes.whyNow.length > 2)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `suggested top item ${itemId} requires one or two why-now reasons`
          });
        }
      }
    }
    if (decision.status === "needs_clarification") {
      if (topIds.size === 0 || decision.clarification === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "needs_clarification requires possible top items and one question intent"
        });
      }
      for (const itemId of topIds) {
        const eligibility = annotations.get(itemId)?.eligibility;
        if (eligibility !== "eligible" && eligibility !== "review_required") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `clarification item ${itemId} must be eligible or review-required`
          });
        }
      }
    }

    const decisionReasons = new Set(decision.reasonCodes);
    const allowedDecisionReasons = {
      suggested: new Set(["DECISION_TOP_ITEM_SELECTED"]),
      needs_clarification: new Set([
        "DECISION_TOP_CANDIDATES_EQUIVALENT",
        "DECISION_USER_PRIORITY_REQUIRED"
      ]),
      no_action: new Set([
        "DECISION_NO_ELIGIBLE_INTERVENTION",
        "DECISION_ALL_OBSERVED_WORK_HEALTHY"
      ]),
      insufficient_evidence: new Set([
        "DECISION_RELEVANT_COVERAGE_INSUFFICIENT",
        "DECISION_SOURCE_REFRESH_REQUIRED"
      ])
    }[decision.status];
    if (
      [...decisionReasons].some(
        (reason) => !allowedDecisionReasons.has(reason)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `decision reason codes do not match status ${decision.status}`
      });
    }
    const requiredDecisionReason = (
      {
        suggested: "DECISION_TOP_ITEM_SELECTED",
        needs_clarification: "DECISION_USER_PRIORITY_REQUIRED",
        no_action: null,
        insufficient_evidence: "DECISION_RELEVANT_COVERAGE_INSUFFICIENT"
      } as const
    )[decision.status];
    if (
      requiredDecisionReason !== null &&
      !decisionReasons.has(requiredDecisionReason)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `decision status ${decision.status} is missing its required reason`
      });
    }
    if (
      decision.status === "no_action" ||
      decision.status === "insufficient_evidence"
    ) {
      if (topIds.size > 0 || decision.clarification !== null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "no_action and insufficient_evidence cannot return a top item or clarification"
        });
      }
    }

    const coverage = evaluationCase.expectedCoverage;
    const limitedSources = new Set(coverage.limitedSources);
    if (coverage.uncertaintyBasis.includes("critical_conflict")) {
      const conflictReviewReasons = new Set([
        "REVIEW_IDENTITY_UNRESOLVED",
        "REVIEW_STATE_CONFLICT",
        "REVIEW_OWNER_CONFLICT",
        "REVIEW_DEADLINE_CONFLICT",
        "REVIEW_CRITICAL_CONFLICT_UNRESOLVED"
      ]);
      const materialSources = new Set(
        coverage.materialUncertaintySources
      );
      const hasConflictAnnotation = evaluationCase.annotations.some(
        (annotation) => {
          if (
            annotation.eligibility !== "review_required" ||
            !annotation.reasonCodes.review.some((reason) =>
              conflictReviewReasons.has(reason)
            )
          ) {
            return false;
          }
          const referencedMaterialSources = new Set(
            evaluationCase.workSignals
              .filter(
                (signal) =>
                  annotation.sourceSubjectIds.includes(signal.subjectId) &&
                  materialSources.has(signal.source)
              )
              .map((signal) => signal.source)
          );
          return referencedMaterialSources.size >= 2;
        }
      );
      if (
        coverage.materialUncertaintySources.length < 2 ||
        !hasConflictAnnotation
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "critical-conflict coverage requires at least two material sources and a conflict review annotation"
        });
      }
    }
    for (const source of coverage.materialUncertaintySources) {
      if (!sourceWindows.has(source)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "material uncertainty sources must exist in the input"
        });
      }
    }
    for (const source of limitedSources) {
      const window = sourceWindows.get(source);
      if (
        window === undefined ||
        (window.status === "fresh" &&
          window.candidateSetComplete &&
          window.attentionCapability === "candidate_capable")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `limited source ${source} is not limited in its input window`
        });
      }
    }
    for (const window of evaluationCase.sourceSnapshotWindows) {
      const sourceIsLimited =
        window.status !== "fresh" ||
        window.attentionCapability !== "candidate_capable" ||
        !window.candidateSetComplete;
      if (sourceIsLimited !== limitedSources.has(window.source)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `source ${window.source} coverage does not match limitedSources`
        });
      }
      const listedAsMaterialUncertainty =
        coverage.materialUncertaintySources.includes(window.source);
      if (
        sourceIsLimited &&
        window.materialToDecision !== listedAsMaterialUncertainty
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `source ${window.source} materiality does not match materialUncertaintySources`
        });
      }
      if (
        !sourceIsLimited &&
        listedAsMaterialUncertainty &&
        !coverage.uncertaintyBasis.includes("critical_conflict")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `complete source ${window.source} can be uncertain only through a critical conflict`
        });
      }
    }

    if (coverage.disposition === "complete") {
      if (
        !coverage.negativeCandidateCoverageComplete ||
        coverage.limitedSources.length > 0 ||
        coverage.materialUncertaintySources.length > 0 ||
        coverage.uncertaintyBasis.length > 0 ||
        coverage.positiveCandidateIndependentOfUnknowns
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "complete coverage cannot contain limited or unknown scope"
        });
      }
    }
    if (coverage.disposition === "limited_but_sufficient") {
      const validPositiveSuggestion =
        decision.status === "suggested" &&
        !coverage.negativeCandidateCoverageComplete &&
        coverage.positiveCandidateIndependentOfUnknowns;
      const validScopedNoAction =
        decision.status === "no_action" &&
        coverage.negativeCandidateCoverageComplete &&
        !coverage.positiveCandidateIndependentOfUnknowns;
      if (
        coverage.limitedSources.length === 0 ||
        coverage.materialUncertaintySources.length > 0 ||
        coverage.uncertaintyBasis.length === 0 ||
        (!validPositiveSuggestion && !validScopedNoAction)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "limited-but-sufficient coverage requires an independent positive suggestion or an explicitly scoped no-action"
        });
      }
    }
    if (
      coverage.disposition === "insufficient" &&
      (coverage.negativeCandidateCoverageComplete ||
        coverage.materialUncertaintySources.length === 0 ||
        coverage.uncertaintyBasis.length === 0 ||
        coverage.positiveCandidateIndependentOfUnknowns ||
        decision.status !== "insufficient_evidence" ||
        (coverage.limitedSources.length === 0 &&
          !coverage.uncertaintyBasis.includes("critical_conflict")))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "insufficient coverage requires a material unknown and an insufficient-evidence decision"
      });
    }

    if (decision.status === "no_action") {
      const hasCompleteCandidateCapableWindow =
        evaluationCase.sourceSnapshotWindows.some(
          (window) =>
            window.status === "fresh" &&
            window.attentionCapability === "candidate_capable" &&
            window.candidateSetComplete
        );
      const hasActionableOrReviewableItem = evaluationCase.annotations.some(
        (annotation) => annotation.eligibility !== "ineligible"
      );
      if (
        (coverage.disposition !== "complete" &&
          coverage.disposition !== "limited_but_sufficient") ||
        !coverage.negativeCandidateCoverageComplete ||
        !hasCompleteCandidateCapableWindow ||
        coverage.materialUncertaintySources.length > 0 ||
        hasActionableOrReviewableItem
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "no_action requires complete negative candidate-capable coverage and no eligible or review-required item"
        });
      }
    }

    for (const preference of evaluationCase.pairwisePreferences) {
      if (preference.preferredItemId === preference.overItemId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pairwise preference cannot compare an item with itself"
        });
      }
      if (
        annotations.get(preference.preferredItemId)?.eligibility !==
          "eligible" ||
        annotations.get(preference.overItemId)?.eligibility !== "eligible"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "pairwise preferences require two eligible items"
        });
      }
    }

    const preferenceGraph = new Map<string, string[]>();
    for (const preference of evaluationCase.pairwisePreferences) {
      const edges = preferenceGraph.get(preference.preferredItemId) ?? [];
      edges.push(preference.overItemId);
      preferenceGraph.set(preference.preferredItemId, edges);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (itemId: string): boolean => {
      if (visiting.has(itemId)) {
        return true;
      }
      if (visited.has(itemId)) {
        return false;
      }
      visiting.add(itemId);
      for (const nextItemId of preferenceGraph.get(itemId) ?? []) {
        if (hasCycle(nextItemId)) {
          return true;
        }
      }
      visiting.delete(itemId);
      visited.add(itemId);
      return false;
    };
    if ([...preferenceGraph.keys()].some((itemId) => hasCycle(itemId))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pairwise preferences cannot contain a cycle"
      });
    }

    const requiresCodexDetectorConfig = evaluationCase.workSignals.some(
      (signal) =>
        signal.source === "codex" && signal.evidenceLevel === "derived"
    );
    if (
      requiresCodexDetectorConfig &&
      evaluationCase.codexDetectorConfig === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "derived Codex signals require an immutable detector config"
      });
    }
  });

export const crossSourceEvaluationDatasetSchema = z
  .object({
    datasetFamily: z.literal("suggestion-cross-source"),
    datasetVersion: z
      .string()
      .regex(
        /^suggestion-cross-source-(dev|gold|regression|rolling|holdout)-v\d+\.\d+$/
      ),
    datasetRevision: z.number().int().positive(),
    schemaVersion: z.literal(CROSS_SOURCE_EVALUATION_SCHEMA_VERSION),
    reasonCodeVersion: z.literal(CROSS_SOURCE_REASON_CODE_VERSION),
    definitionVersion: z.literal(
      CROSS_SOURCE_ATTENTION_DEFINITION_VERSION
    ),
    datasetClass: z.enum([
      "dev_candidate",
      "golden",
      "regression",
      "rolling",
      "locked_holdout"
    ]),
    lifecycle: datasetLifecycleSchema,
    dataOrigin: z.literal("synthetic"),
    containsProductionData: z.literal(false),
    inputBoundary: z.literal("normalized_work_signals_and_relations"),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    cases: z.array(crossSourceEvaluationCaseSchema).min(1).max(500)
  })
  .strict()
  .superRefine((dataset, context) => {
    if (
      new Set(dataset.cases.map((item) => item.caseId)).size !==
      dataset.cases.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "case IDs must be unique"
      });
    }
    const versionSegment = {
      dev_candidate: "dev",
      golden: "gold",
      regression: "regression",
      rolling: "rolling",
      locked_holdout: "holdout"
    }[dataset.datasetClass];
    if (
      !dataset.datasetVersion.startsWith(
        `suggestion-cross-source-${versionSegment}-`
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "datasetVersion does not match datasetClass"
      });
    }
    if (instant(dataset.createdAt) > instant(dataset.updatedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "updatedAt must not be earlier than createdAt"
      });
    }
    if (
      dataset.datasetClass === "dev_candidate" &&
      dataset.lifecycle.state !== "mutable"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dev Candidate datasets must remain mutable"
      });
    }
    if (
      dataset.datasetClass === "dev_candidate" &&
      dataset.cases.some((item) => item.review.status === "frozen")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dev Candidate cases cannot claim frozen review status"
      });
    }
    if (
      (dataset.datasetClass === "golden" ||
        dataset.datasetClass === "locked_holdout") &&
      dataset.lifecycle.state !== "frozen"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Golden and locked holdout datasets must be frozen"
      });
    }
    if (
      dataset.lifecycle.state === "frozen" &&
      dataset.cases.some((item) => item.review.status !== "frozen")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "all cases in a frozen dataset must have frozen review status"
      });
    }
    if (
      dataset.lifecycle.state === "frozen" &&
      instant(dataset.lifecycle.frozenAt) < instant(dataset.updatedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "frozenAt must not be earlier than updatedAt"
      });
    }
  });

export type ConnectedSource = z.infer<typeof connectedSourceSchema>;
export type AttentionCapability = z.infer<typeof attentionCapabilitySchema>;
export type AttentionIntervention = z.infer<
  typeof attentionInterventionSchema
>;
export type RankableAttentionLane = z.infer<
  typeof rankableAttentionLaneSchema
>;
export type CodexExecutionState = z.infer<
  typeof codexExecutionStateSchema
>;
export type CrossSourceEvaluationCase = z.infer<
  typeof crossSourceEvaluationCaseSchema
>;
export type CrossSourceEvaluationDataset = z.infer<
  typeof crossSourceEvaluationDatasetSchema
>;
