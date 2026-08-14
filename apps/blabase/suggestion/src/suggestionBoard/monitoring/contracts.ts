import { z } from "zod";

import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_CONSENT_POLICY_VERSION,
  WORK_BOARD_MONITORING_EVENT_CONTRACT,
  WORK_BOARD_MONITORING_IDEMPOTENCY_POLICY_VERSION,
  WORK_BOARD_MONITORING_MAX_EVENTS,
  WORK_BOARD_MONITORING_MAX_HISTORY,
  WORK_BOARD_MONITORING_QUALITY_CONTRACT,
  WORK_BOARD_MONITORING_RECEIPT_CONTRACT,
  WORK_BOARD_MONITORING_RECEIPT_POLICY_VERSION,
  WORK_BOARD_MONITORING_REPLAY_CONTRACT,
  WORK_BOARD_MONITORING_RETENTION_POLICY_VERSION,
  WORK_BOARD_MONITORING_SCHEMA_VERSION,
  WORK_BOARD_MONITORING_STORE_CONTRACT,
  WORK_BOARD_MONITORING_SURFACE
} from "./versions";

export const monitoringSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u);
export const monitoringTimestampSchema = z
  .string()
  .datetime()
  .refine(isCanonicalTimestamp, {
    message: "Monitoring timestamps must use canonical UTC ISO form"
  });
export const workBoardMonitoringAuthKeyIdSchema = z
  .string()
  .regex(/^work_board_monitor_key_[a-f0-9]{32}$/u);
export const workBoardMonitoringCaptureIdSchema = z
  .string()
  .regex(/^work_board_capture_[a-f0-9]{32}$/u);
export const workBoardMonitoringDigestRefSchema = z
  .string()
  .regex(/^work_board_monitor_[a-f0-9]{64}$/u);

export const workBoardMonitoringLaneSchema = z.enum([
  "attention",
  "continuation",
  "setup"
]);
export const workBoardMonitoringPositionSchema = z.enum([
  "primary",
  "alternative_1",
  "alternative_2"
]);
export const workBoardMonitoringModeSchema = z.enum([
  "full",
  "active_only_fallback"
]);
export const workBoardMonitoringFallbackSchema = z
  .enum([
    "CONTINUATION_PREREQUISITES_UNAVAILABLE",
    "CONTINUATION_IDENTITY_REJECTED",
    "CONTINUATION_DERIVATION_REJECTED",
    "CONTINUATION_RESOLUTION_REJECTED",
    "BOARD_COMPOSITION_REJECTED",
    "BOARD_PUBLIC_PROJECTION_REJECTED"
  ])
  .nullable();
export const workBoardMonitoringKindSchema = z.enum([
  "active_attention",
  "attention_clarification",
  "recent_github_push",
  "recent_codex_session",
  "local_worktree",
  "linked_workstream",
  "workspace_mapping"
]);
export const workBoardMonitoringEvidenceSchema = z.enum([
  "verified_attention",
  "exact",
  "corroborated",
  "single_source",
  "setup"
]);
export const workBoardMonitoringCaveatSchema = z.enum([
  "CAVEAT_CANDIDATE_SET_INCOMPLETE",
  "CAVEAT_DEFAULT_TIE_BREAK_USED",
  "CAVEAT_GITHUB_PR_ACTIONABILITY_PARTIAL",
  "CAVEAT_MANAGED_FAILURE_INSPECTION_ONLY",
  "CAVEAT_REVIEW_DRAFT_UNKNOWN",
  "CAVEAT_UPSTREAM_OBJECTS_REMAIN_NON_CANDIDATES",
  "EXPLICIT_MAPPING_CONFIRMATION_REQUIRED",
  "IDENTITY_CLARIFICATION_REQUIRED",
  "SOURCE_COVERAGE_PARTIAL",
  "SOURCE_COVERAGE_UNKNOWN",
  "SOURCE_METADATA_ONLY",
  "TERMINAL_STATE_UNKNOWN"
]);

export const workBoardMonitoringSourceStateSchema = z
  .object({
    source: z.enum(["github", "codex"]),
    state: z.enum([
      "available",
      "missing",
      "rejected",
      "disconnected",
      "collection_failed"
    ]),
    reasonCode: z
      .enum([
        "SNAPSHOT_MISSING",
        "SNAPSHOT_PARSE_FAILED",
        "SNAPSHOT_SCHEMA_UNSUPPORTED",
        "CONNECTOR_DISCONNECTED",
        "COLLECTION_FAILED"
      ])
      .nullable(),
    version: z.string().min(1).max(120).nullable(),
    stateDigestHmac: workBoardMonitoringDigestRefSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.state === "available") !==
      (value.reasonCode === null && value.version !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Monitoring source availability fields must agree"
      });
    }
  });

const workBoardMonitoringReceiptItemObjectSchema = z
  .object({
    ordinal: z.number().int().min(0).max(2),
    ordinalHandleHmac: workBoardMonitoringDigestRefSchema,
    presentationTargetHmac: workBoardMonitoringDigestRefSchema,
    privateProvenanceHmac: workBoardMonitoringDigestRefSchema,
    lane: workBoardMonitoringLaneSchema,
    position: workBoardMonitoringPositionSchema,
    kind: workBoardMonitoringKindSchema,
    evidenceBand: workBoardMonitoringEvidenceSchema,
    caveatCodes: z.array(workBoardMonitoringCaveatSchema).max(8),
    copyDigestHmac: workBoardMonitoringDigestRefSchema,
    expiresAt: monitoringTimestampSchema.nullable()
  })
  .strict();

export const workBoardMonitoringReceiptItemSchema =
  workBoardMonitoringReceiptItemObjectSchema.superRefine((value, context) => {
    const expectedPosition =
      value.ordinal === 0
        ? "primary"
        : (`alternative_${value.ordinal}` as const);
    if (value.position !== expectedPosition) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["position"],
        message: "Receipt ordinal and Board position must agree"
      });
    }
    if (
      (value.lane === "attention" &&
        (value.evidenceBand !== "verified_attention" ||
          value.expiresAt !== null)) ||
      (value.lane === "setup" &&
        (value.evidenceBand !== "setup" || value.expiresAt === null)) ||
      (value.lane === "continuation" &&
        (!["exact", "corroborated", "single_source"].includes(
          value.evidenceBand
        ) ||
          value.expiresAt === null))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Receipt lane, evidence and visibility expiry must agree"
      });
    }
  });

export const workBoardMonitoringReceiptPayloadSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_RECEIPT_CONTRACT),
    schemaVersion: z.literal(WORK_BOARD_MONITORING_SCHEMA_VERSION),
    receiptPolicyVersion: z.literal(
      WORK_BOARD_MONITORING_RECEIPT_POLICY_VERSION
    ),
    surface: z.literal(WORK_BOARD_MONITORING_SURFACE),
    authKeyId: workBoardMonitoringAuthKeyIdSchema,
    captureId: workBoardMonitoringCaptureIdSchema,
    issuedAt: monitoringTimestampSchema,
    expiresAt: monitoringTimestampSchema,
    generatedAt: monitoringTimestampSchema,
    mode: workBoardMonitoringModeSchema,
    fallbackReasonCode: workBoardMonitoringFallbackSchema,
    continuationStatus: z.enum(["available", "empty", "unavailable"]),
    responseDigestHmac: workBoardMonitoringDigestRefSchema,
    privateProvenanceHmac: workBoardMonitoringDigestRefSchema,
    sources: z.tuple([
      workBoardMonitoringSourceStateSchema,
      workBoardMonitoringSourceStateSchema
    ]),
    items: z.array(workBoardMonitoringReceiptItemSchema).max(3)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.sources[0].source !== "github" ||
      value.sources[1].source !== "codex" ||
      Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) ||
      value.items.some((item, index) => item.ordinal !== index) ||
      (value.mode === "full") !== (value.fallbackReasonCode === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Receipt capture ordering, time or fallback fields are invalid"
      });
    }
  });

export const workBoardMonitoringFeedbackValueSchema = z.enum([
  "useful",
  "not_useful"
]);
export const workBoardMonitoringFeedbackReasonSchema = z.enum([
  "already_done",
  "wrong_context",
  "not_mine",
  "not_actionable",
  "insufficient_context",
  "not_now"
]);

const consentInputSchema = z
  .object({
    operation: z.literal("consent"),
    consent: z.boolean(),
    explicitUserAction: z.literal(true)
  })
  .strict();
const renderInputSchema = z
  .object({
    operation: z.literal("render_confirmed"),
    receipt: z.string().min(1).max(6_144)
  })
  .strict();
const feedbackInputSchema = z
  .object({
    operation: z.literal("feedback"),
    receipt: z.string().min(1).max(6_144),
    ordinal: z.number().int().min(0).max(2),
    feedback: workBoardMonitoringFeedbackValueSchema,
    reason: workBoardMonitoringFeedbackReasonSchema.nullable().optional(),
    explicitUserAction: z.literal(true)
  })
  .strict();
const resetInputSchema = z
  .object({
    operation: z.literal("reset"),
    receipt: z.string().min(1).max(6_144),
    ordinal: z.number().int().min(0).max(2),
    explicitUserAction: z.literal(true)
  })
  .strict();
const purgeInputSchema = z
  .object({
    operation: z.literal("purge"),
    explicitUserAction: z.literal(true)
  })
  .strict();

export const workBoardMonitoringMutationInputSchema = z.discriminatedUnion(
  "operation",
  [
    consentInputSchema,
    renderInputSchema,
    feedbackInputSchema,
    resetInputSchema,
    purgeInputSchema
  ]
);

export const workBoardMonitoringReviewFieldsSchema = z
  .object({
    reviewState: z.literal("candidate"),
    appliedToRanking: z.literal(false),
    goldEligible: z.literal(false),
    releaseGateEligible: z.literal(false)
  })
  .strict();

export const WORK_BOARD_MONITORING_REVIEW_FIELDS = {
  reviewState: "candidate",
  appliedToRanking: false,
  goldEligible: false,
  releaseGateEligible: false
} as const;

export const workBoardMonitoringStoredPresentationSchema =
  workBoardMonitoringReceiptItemObjectSchema.omit({
    ordinalHandleHmac: true,
    privateProvenanceHmac: true,
    copyDigestHmac: true,
    expiresAt: true
  }).extend({
    mode: workBoardMonitoringModeSchema,
    surface: z.literal(WORK_BOARD_MONITORING_SURFACE)
  }).strict();

const monitoringEventContentObjectSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_EVENT_CONTRACT),
    schemaVersion: z.literal(WORK_BOARD_MONITORING_SCHEMA_VERSION),
    authKeyId: workBoardMonitoringAuthKeyIdSchema,
    sequence: z.number().int().positive(),
    previousEventSha256: monitoringSha256Schema.nullable(),
    eventType: z.enum([
      "consent_granted",
      "consent_revoked",
      "render_confirmed",
      "feedback_recorded",
      "feedback_reset"
    ]),
    occurredAt: monitoringTimestampSchema,
    retainedUntil: monitoringTimestampSchema,
    receiptDigestHmac: workBoardMonitoringDigestRefSchema.nullable(),
    captureId: workBoardMonitoringCaptureIdSchema.nullable(),
    presentations: z
      .array(workBoardMonitoringStoredPresentationSchema)
      .max(3),
    target: workBoardMonitoringStoredPresentationSchema.nullable(),
    feedback: workBoardMonitoringFeedbackValueSchema.nullable(),
    reason: workBoardMonitoringFeedbackReasonSchema.nullable(),
    supersedesEventSha256: monitoringSha256Schema.nullable(),
    reviewState: z.literal("candidate"),
    appliedToRanking: z.literal(false),
    goldEligible: z.literal(false),
    releaseGateEligible: z.literal(false)
  })
  .strict();

export const workBoardMonitoringEventContentSchema =
  monitoringEventContentObjectSchema.superRefine(refineEventContent);
export const workBoardMonitoringEventSchema =
  monitoringEventContentObjectSchema
    .extend({
      eventSha256: monitoringSha256Schema,
      eventHmac: monitoringSha256Schema
    })
    .strict()
    .superRefine(refineEventContent);

export const workBoardMonitoringStoreContentSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_STORE_CONTRACT),
    schemaVersion: z.literal(WORK_BOARD_MONITORING_SCHEMA_VERSION),
    consentPolicyVersion: z.literal(
      WORK_BOARD_MONITORING_CONSENT_POLICY_VERSION
    ),
    retentionPolicyVersion: z.literal(
      WORK_BOARD_MONITORING_RETENTION_POLICY_VERSION
    ),
    idempotencyPolicyVersion: z.literal(
      WORK_BOARD_MONITORING_IDEMPOTENCY_POLICY_VERSION
    ),
    authKeyId: workBoardMonitoringAuthKeyIdSchema,
    createdAt: monitoringTimestampSchema,
    updatedAt: monitoringTimestampSchema,
    revision: z.number().int().nonnegative(),
    anchorSequence: z.number().int().nonnegative(),
    anchorEventSha256: monitoringSha256Schema.nullable(),
    events: z.array(workBoardMonitoringEventSchema).max(
      WORK_BOARD_MONITORING_MAX_EVENTS
    ),
    aggregateSha256: monitoringSha256Schema
  })
  .strict();
export const workBoardMonitoringStoreSchema =
  workBoardMonitoringStoreContentSchema
    .extend({ storeHmac: monitoringSha256Schema })
    .strict();

const ratioSchema = z
  .object({
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    value: z.number().min(0).max(1).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.denominator === 0
        ? null
        : value.numerator / value.denominator;
    if (
      value.numerator > value.denominator ||
      !Object.is(value.value, expected)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Monitoring ratio numerator, denominator and value must agree"
      });
    }
  });

export const workBoardMonitoringQualityStratumSchema = z
  .object({
    lane: z.enum(["continuation", "setup"]),
    position: workBoardMonitoringPositionSchema,
    mode: workBoardMonitoringModeSchema,
    evidenceBand: workBoardMonitoringEvidenceSchema,
    surface: z.literal(WORK_BOARD_MONITORING_SURFACE),
    eligibleDistinct: z.number().int().nonnegative(),
    ratedDistinct: z.number().int().nonnegative(),
    usefulDistinct: z.number().int().nonnegative(),
    coverage: ratioSchema,
    usefulShare: ratioSchema
  })
  .strict();

export const workBoardMonitoringQualitySchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_QUALITY_CONTRACT),
    schemaVersion: z.literal(WORK_BOARD_MONITORING_SCHEMA_VERSION),
    asOf: monitoringTimestampSchema,
    eventCount: z.number().int().nonnegative(),
    eligibleDistinct: z.number().int().nonnegative(),
    ratedDistinct: z.number().int().nonnegative(),
    usefulDistinct: z.number().int().nonnegative(),
    coverage: ratioSchema,
    usefulShare: ratioSchema,
    strata: z.array(workBoardMonitoringQualityStratumSchema).max(54),
    reviewState: z.literal("candidate"),
    appliedToRanking: z.literal(false),
    goldEligible: z.literal(false),
    releaseGateEligible: z.literal(false)
  })
  .strict();

export const workBoardMonitoringHistoryEntrySchema = z
  .object({
    occurredAt: monitoringTimestampSchema,
    eventType: z.enum([
      "consent_granted",
      "consent_revoked",
      "render_confirmed",
      "feedback_recorded",
      "feedback_reset"
    ]),
    lane: z.enum(["continuation", "setup"]).nullable(),
    position: workBoardMonitoringPositionSchema.nullable(),
    mode: workBoardMonitoringModeSchema.nullable(),
    evidenceBand: workBoardMonitoringEvidenceSchema.nullable(),
    feedback: workBoardMonitoringFeedbackValueSchema.nullable(),
    reason: workBoardMonitoringFeedbackReasonSchema.nullable(),
    reviewState: z.literal("candidate"),
    appliedToRanking: z.literal(false),
    goldEligible: z.literal(false),
    releaseGateEligible: z.literal(false)
  })
  .strict();

export const workBoardMonitoringStateResponseSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_API_CONTRACT),
    status: z.literal("ready"),
    consent: z.boolean(),
    aggregate: workBoardMonitoringQualitySchema,
    history: z
      .array(workBoardMonitoringHistoryEntrySchema)
      .max(WORK_BOARD_MONITORING_MAX_HISTORY)
  })
  .strict();

export const workBoardMonitoringMutationResponseSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_API_CONTRACT),
    status: z.literal("recorded"),
    operation: z.enum([
      "consent",
      "render_confirmed",
      "feedback",
      "reset",
      "purge"
    ]),
    consent: z.boolean(),
    aggregate: workBoardMonitoringQualitySchema
  })
  .strict();

export const workBoardMonitoringErrorCodeSchema = z.enum([
  "LOCAL_ONLY",
  "INVALID_ORIGIN",
  "DISABLED",
  "AUTH_UNAVAILABLE",
  "UNAUTHORIZED",
  "INVALID_CONTENT_TYPE",
  "INVALID_CONTENT_LENGTH",
  "INVALID_REQUEST",
  "CONSENT_REQUIRED",
  "RECEIPT_NOT_CURRENT",
  "STORE_UNAVAILABLE",
  "FAILED"
]);
export const workBoardMonitoringErrorResponseSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_API_CONTRACT),
    status: z.literal("error"),
    code: workBoardMonitoringErrorCodeSchema
  })
  .strict();

export const workBoardMonitoringReplaySchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_REPLAY_CONTRACT),
    schemaVersion: z.literal(WORK_BOARD_MONITORING_SCHEMA_VERSION),
    status: z.enum(["matched", "mismatch"]),
    inputEventCount: z.number().int().nonnegative(),
    aggregate: workBoardMonitoringQualitySchema,
    aggregateSha256: monitoringSha256Schema,
    expectedAggregateSha256: monitoringSha256Schema,
    mismatchCodes: z.array(z.literal("AGGREGATE_SHA_MISMATCH")).max(1)
  })
  .strict();

export type WorkBoardMonitoringReceiptPayload = z.infer<
  typeof workBoardMonitoringReceiptPayloadSchema
>;
export type WorkBoardMonitoringReceiptItem = z.infer<
  typeof workBoardMonitoringReceiptItemSchema
>;
export type WorkBoardMonitoringMutationInput = z.infer<
  typeof workBoardMonitoringMutationInputSchema
>;
export type WorkBoardMonitoringEvent = z.infer<
  typeof workBoardMonitoringEventSchema
>;
export type WorkBoardMonitoringEventContent = z.infer<
  typeof workBoardMonitoringEventContentSchema
>;
export type WorkBoardMonitoringStore = z.infer<
  typeof workBoardMonitoringStoreSchema
>;
export type WorkBoardMonitoringStoreContent = z.infer<
  typeof workBoardMonitoringStoreContentSchema
>;
export type WorkBoardMonitoringQuality = z.infer<
  typeof workBoardMonitoringQualitySchema
>;
export type WorkBoardMonitoringStateResponse = z.infer<
  typeof workBoardMonitoringStateResponseSchema
>;
export type WorkBoardMonitoringErrorCode = z.infer<
  typeof workBoardMonitoringErrorCodeSchema
>;

function refineEventContent(
  value: z.infer<typeof monitoringEventContentObjectSchema>,
  context: z.RefinementCtx
): void {
  const consent = value.eventType.startsWith("consent_");
  const render = value.eventType === "render_confirmed";
  const feedback = value.eventType === "feedback_recorded";
  const reset = value.eventType === "feedback_reset";
  if (
    Date.parse(value.retainedUntil) <= Date.parse(value.occurredAt) ||
    (consent &&
      (value.receiptDigestHmac !== null ||
        value.captureId !== null ||
        value.presentations.length !== 0 ||
        value.target !== null ||
        value.feedback !== null ||
        value.reason !== null ||
        value.supersedesEventSha256 !== null)) ||
    (render &&
      (value.receiptDigestHmac === null ||
        value.captureId === null ||
        value.target !== null ||
        value.feedback !== null ||
        value.reason !== null ||
        value.supersedesEventSha256 !== null)) ||
    ((feedback || reset) &&
      (value.receiptDigestHmac === null ||
        value.captureId === null ||
        value.presentations.length !== 0 ||
        value.target === null ||
        (feedback && value.feedback === null) ||
        (reset && (value.feedback !== null || value.reason !== null))))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Monitoring event payload does not match its event type"
    });
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
