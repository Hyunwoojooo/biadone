import { types as nodeUtilTypes } from "node:util";

import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeStableId,
} from "../../crossSource/canonicalHash";
import {
  domainSeparatedSha256,
  jcsCanonicalize,
} from "../../dayflowEvidence/contracts";

export const COMMON_SUGGESTION_EVIDENCE_RECORD_SET_SCHEMA_VERSION_V0_1 =
  "blabase-common-suggestion-evidence-record-set-v0.1" as const;
export const COMMON_SUGGESTION_EVIDENCE_RECORD_SET_HASH_DOMAIN_V0_1 =
  "blabase.common-suggestion-evidence-record-set.v0.1" as const;
export const COMMON_SUGGESTION_EVIDENCE_BUDGET_VERSION_V0_1 =
  "common-suggestion-evidence-budget-v0.1" as const;

const RECORD_ID_VERSION = "common-suggestion-evidence-record-id-v0.1";
const FACT_ID_VERSION = "common-suggestion-evidence-fact-id-v0.1";
const PRIVATE_RECORD_IDENTITY_HASH_DOMAIN =
  "blabase.common-suggestion-evidence.private-record-identity.v0.1";
const FACT_VALUE_HASH_DOMAIN =
  "blabase.common-suggestion-evidence.fact-value.v0.1";
const OMITTED_RECORD_IDS_HASH_DOMAIN =
  "blabase.common-suggestion-evidence.omitted-record-ids.v0.1";

const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectDefineProperty = Object.defineProperty;
const intrinsicObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const intrinsicObjectIs = Object.is;
const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicDateParse = Date.parse;
const intrinsicReflectApply = Reflect.apply;
const intrinsicReflectOwnKeys = Reflect.ownKeys;
const intrinsicArrayIsArray = Array.isArray;
const intrinsicArrayPush = Array.prototype.push;
const intrinsicArraySort = Array.prototype.sort;
const intrinsicMapGet = Map.prototype.get;
const intrinsicMapHas = Map.prototype.has;
const intrinsicMapSet = Map.prototype.set;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetDelete = WeakSet.prototype.delete;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const intrinsicStringNormalize = String.prototype.normalize;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicTextEncoderEncode = TextEncoder.prototype.encode;
const intrinsicIsProxy = nodeUtilTypes.isProxy;
const utf8Encoder = new TextEncoder();
const IntrinsicMap = Map;
const IntrinsicWeakSet = WeakSet;

const PRIVATE_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PRIVATE_RECORD_ID_PATTERN = /^evidence_record_[0-9a-f]{32}$/u;
const PRIVATE_UTC_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const privateSha256HexSchema = z.string().regex(PRIVATE_SHA256_PATTERN);
const privateUtcTimestampSchema = z
  .string()
  .regex(PRIVATE_UTC_TIMESTAMP_PATTERN)
  .refine((value) => {
    const epoch = intrinsicDateParse(value);
    return (
      intrinsicNumberIsFinite(epoch) &&
      new Date(epoch).toISOString() === value
    );
  });

export const COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1 =
  intrinsicObjectFreeze({
    structuredInputRecordCount: 2_048,
    dayflowInputRecordCount: 256,
    structuredUtf8Bytes: 49_152,
    dayflowUtf8Bytes: 65_536,
    promptEnvelopeReserveUtf8Bytes: 8_192,
    totalPromptUtf8Bytes: 122_880,
  });

const completenessSchema = z.enum(["complete", "truncated", "unknown"]);
const attentionCapabilitySchema = z.enum([
  "candidate_input",
  "overview_only",
]);
const taskKindSchema = z.enum([
  "assigned_issue",
  "review_requested_pull_request",
  "authored_pull_request",
]);
const semanticRoleSchema = z.enum(["direct_work_item", "context_only"]);
const eligibilityLimitSchema = z.enum([
  "none",
  "draft_state_unknown",
  "not_actionable_by_source_kind",
]);
const unsignedIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const positiveIntegerSchema = unsignedIntegerSchema.min(1);
const recordIdSchema = z.string().regex(PRIVATE_RECORD_ID_PATTERN);
const factIdSchema = z.string().min(1).max(256);
const nullableFactIdSchema = factIdSchema.nullable();
const boundedIdentityStringSchema = z.string().min(1).max(512);

function isSafePromptText(value: string): boolean {
  if (
    intrinsicReflectApply(intrinsicStringNormalize, value, ["NFC"]) !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = intrinsicReflectApply(intrinsicStringCharCodeAt, value, [
      index,
    ]) as number;
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return false;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = intrinsicReflectApply(intrinsicStringCharCodeAt, value, [
        index + 1,
      ]) as number;
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function promptTextSchema(maxLength: number) {
  return z.string().min(1).max(maxLength).refine(isSafePromptText);
}

const projectRefSchema = promptTextSchema(240).nullable();
const nativeTitleSchema = promptTextSchema(240);

const commonBuildRecordShape = {
  projectRef: projectRefSchema,
  observedAt: privateUtcTimestampSchema,
  sourceUpdatedAt: privateUtcTimestampSchema.nullable(),
  validUntil: privateUtcTimestampSchema.nullable(),
  completeness: completenessSchema,
};

const githubIdentitySchema = z
  .object({ signalHash: privateSha256HexSchema })
  .strict();
const codexIdentitySchema = githubIdentitySchema;
const calendarIdentitySchema = z
  .object({
    sourceBindingSha256: privateSha256HexSchema,
    eventId: boundedIdentityStringSchema,
  })
  .strict();
const notionIdentitySchema = z
  .object({
    sourceBindingSha256: privateSha256HexSchema,
    resourceId: boundedIdentityStringSchema,
  })
  .strict();
const dayflowIdentitySchema = z
  .object({
    dayflowPreprocessedEvidenceSha256: privateSha256HexSchema,
    frameOrdinal: unsignedIntegerSchema.max(255),
  })
  .strict();

const githubWorkItemFactsSchema = z
  .object({
    attentionCapability: attentionCapabilitySchema,
    nativeTitle: nativeTitleSchema,
    repositoryFullName: promptTextSchema(240),
    number: positiveIntegerSchema,
    objectType: z.enum(["issue", "pull_request"]),
    taskKind: taskKindSchema,
    state: z.literal("open"),
    relationship: z.enum([
      "assigned_to_user",
      "review_requested_from_user",
      "authored_by_user",
    ]),
    semanticRole: semanticRoleSchema,
    eligibilityLimit: eligibilityLimitSchema,
    draftState: z.enum(["unknown", "not_applicable", "draft", "ready"]),
  })
  .strict();

const githubDeadlineFactsSchema = z
  .object({
    attentionCapability: attentionCapabilitySchema,
    deadlineAt: privateUtcTimestampSchema,
    deadlineKind: z.literal("milestone_due_at"),
    taskKind: taskKindSchema,
    semanticRole: semanticRoleSchema,
    eligibilityLimit: eligibilityLimitSchema,
  })
  .strict();

const githubActivityFactsSchema = z
  .object({
    activityKind: z.enum([
      "push",
      "ref_created",
      "ref_deleted",
      "issue_opened",
      "issue_closed",
      "issue_reopened",
      "issue_commented",
      "pull_request_opened",
      "pull_request_closed",
      "pull_request_reopened",
      "pull_request_merged",
      "pull_request_reviewed",
      "pull_request_review_commented",
    ]),
    repositoryFullName: promptTextSchema(240),
    activityAt: privateUtcTimestampSchema.nullable(),
  })
  .strict();

const codexOverviewFactsSchema = z
  .object({
    nativeProjectLabel: promptTextSchema(120),
    taskSummary: promptTextSchema(200).nullable(),
    taskSummarySource: promptTextSchema(120).nullable(),
    nativeActivityState: z.enum([
      "active",
      "idle",
      "not_loaded",
      "system_error",
      "unknown",
    ]),
    semanticState: z.enum(["idle", "not_loaded", "unknown"]),
    nativeAttentionState: z
      .enum(["waiting_on_approval", "waiting_on_user_input"])
      .nullable(),
    contentMode: z.enum([
      "metadata_only",
      "activity_summary",
      "conversation_and_execution",
    ]),
    conversationCollectionState: z.enum([
      "not_collected",
      "complete",
      "partial",
      "stale",
      "failed",
      "expired",
    ]),
    historicalTurnStatus: z.enum([
      "completed",
      "failed",
      "interrupted",
      "in_progress",
      "unknown",
    ]),
    latestTurnCompletedAt: privateUtcTimestampSchema.nullable(),
    turnCount: unsignedIntegerSchema,
    commandExecutionCount: unsignedIntegerSchema,
    failedCommandCount: unsignedIntegerSchema,
    fileChangeCount: unsignedIntegerSchema,
    toolCallCount: unsignedIntegerSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.taskSummary === null) !== (value.taskSummarySource === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom });
    }
    const expectedSemanticState =
      value.nativeActivityState === "idle"
        ? "idle"
        : value.nativeActivityState === "not_loaded"
          ? "not_loaded"
          : "unknown";
    if (value.semanticState !== expectedSemanticState) {
      context.addIssue({ code: z.ZodIssueCode.custom });
    }
    if (value.failedCommandCount > value.commandExecutionCount) {
      context.addIssue({ code: z.ZodIssueCode.custom });
    }
  });

const calendarConstraintFactsSchema = z
  .object({
    nativeTitle: nativeTitleSchema,
    startAt: promptTextSchema(80),
    endAt: promptTextSchema(80),
    allDay: z.boolean(),
    tentative: z.boolean(),
  })
  .strict();

const notionResourceFactsSchema = z
  .object({
    nativeTitle: nativeTitleSchema,
    resourceKind: z.enum(["page", "data_source"]),
    lastEditedAt: privateUtcTimestampSchema,
  })
  .strict();

const redactionCategorySchema = z.enum([
  "credential",
  "email",
  "phone",
  "person",
  "account_id",
  "filesystem_path",
  "url",
  "other_sensitive",
]);

const sortedRedactionCategoriesSchema = z
  .array(redactionCategorySchema)
  .min(1)
  .max(8)
  .superRefine((categories, context) => {
    for (let index = 1; index < categories.length; index += 1) {
      if (
        compareRuntimeStrings(categories[index - 1]!, categories[index]!) >= 0
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom });
        return;
      }
    }
  });

const dayflowSpanSchema = z
  .object({
    spanOrdinal: unsignedIntegerSchema.max(31),
    textKind: z.literal("privacy_filtered_ocr"),
    text: promptTextSchema(2_048),
    confidence: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("reported"),
          basisPoints: unsignedIntegerSchema.max(10_000),
        })
        .strict(),
      z
        .object({
          status: z.literal("unavailable"),
          basisPoints: z.null(),
        })
        .strict(),
    ]),
    redaction: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("none_detected"),
          categories: z.tuple([]),
        })
        .strict(),
      z
        .object({
          status: z.literal("redacted"),
          categories: sortedRedactionCategoriesSchema,
        })
        .strict(),
    ]),
  })
  .strict();

const dayflowFrameFactsSchema = z
  .object({
    capturedAt: privateUtcTimestampSchema,
    processingStatus: z.enum([
      "text",
      "no_text",
      "privacy_omitted",
      "processing_failed",
    ]),
    spans: z.array(dayflowSpanSchema).max(32),
    omissionCode: z.literal("PRIVACY_POLICY_EXCLUDED").nullable(),
    errorCode: z
      .enum([
        "OCR_FAILED",
        "PRIVACY_FILTER_FAILED",
        "UNSUPPORTED_FRAME",
        "RESOURCE_LIMIT",
      ])
      .nullable(),
    retryability: z.enum(["retryable", "terminal"]).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 0; index < value.spans.length; index += 1) {
      if (value.spans[index]!.spanOrdinal !== index) {
        context.addIssue({ code: z.ZodIssueCode.custom });
        break;
      }
    }
    const valid =
      (value.processingStatus === "text" &&
        value.spans.length > 0 &&
        value.omissionCode === null &&
        value.errorCode === null &&
        value.retryability === null) ||
      (value.processingStatus === "no_text" &&
        value.spans.length === 0 &&
        value.omissionCode === null &&
        value.errorCode === null &&
        value.retryability === null) ||
      (value.processingStatus === "privacy_omitted" &&
        value.spans.length === 0 &&
        value.omissionCode === "PRIVACY_POLICY_EXCLUDED" &&
        value.errorCode === null &&
        value.retryability === null) ||
      (value.processingStatus === "processing_failed" &&
        value.spans.length === 0 &&
        value.omissionCode === null &&
        value.errorCode !== null &&
        value.retryability !== null);
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom });
  });

const githubWorkItemBuildRecordSchema = z
  .object({
    kind: z.literal("github_work_item"),
    identity: githubIdentitySchema,
    ...commonBuildRecordShape,
    facts: githubWorkItemFactsSchema,
  })
  .strict();
const githubDeadlineBuildRecordSchema = z
  .object({
    kind: z.literal("github_deadline"),
    identity: githubIdentitySchema,
    ...commonBuildRecordShape,
    facts: githubDeadlineFactsSchema,
  })
  .strict();
const githubActivityBuildRecordSchema = z
  .object({
    kind: z.literal("github_activity"),
    identity: githubIdentitySchema,
    ...commonBuildRecordShape,
    facts: githubActivityFactsSchema,
  })
  .strict();
const codexOverviewBuildRecordSchema = z
  .object({
    kind: z.literal("codex_overview"),
    identity: codexIdentitySchema,
    ...commonBuildRecordShape,
    facts: codexOverviewFactsSchema,
  })
  .strict();
const calendarConstraintBuildRecordSchema = z
  .object({
    kind: z.literal("calendar_constraint"),
    identity: calendarIdentitySchema,
    ...commonBuildRecordShape,
    facts: calendarConstraintFactsSchema,
  })
  .strict();
const notionResourceBuildRecordSchema = z
  .object({
    kind: z.literal("notion_resource"),
    identity: notionIdentitySchema,
    ...commonBuildRecordShape,
    facts: notionResourceFactsSchema,
  })
  .strict();
const dayflowFrameBuildRecordSchema = z
  .object({
    kind: z.literal("dayflow_frame"),
    identity: dayflowIdentitySchema,
    ...commonBuildRecordShape,
    facts: dayflowFrameFactsSchema,
  })
  .strict();

const structuredBuildRecordSchema = z.discriminatedUnion("kind", [
  githubWorkItemBuildRecordSchema,
  githubDeadlineBuildRecordSchema,
  githubActivityBuildRecordSchema,
  codexOverviewBuildRecordSchema,
  calendarConstraintBuildRecordSchema,
  notionResourceBuildRecordSchema,
]);
const buildRecordSchema = z.discriminatedUnion("kind", [
  githubWorkItemBuildRecordSchema,
  githubDeadlineBuildRecordSchema,
  githubActivityBuildRecordSchema,
  codexOverviewBuildRecordSchema,
  calendarConstraintBuildRecordSchema,
  notionResourceBuildRecordSchema,
  dayflowFrameBuildRecordSchema,
]);
const buildInputSchema = z
  .object({
    asOf: privateUtcTimestampSchema,
    availableRecords: z
      .object({
        structured: z.array(structuredBuildRecordSchema),
        dayflow: z.array(dayflowFrameBuildRecordSchema),
      })
      .strict(),
  })
  .strict();

export type CommonSuggestionEvidenceBuildRecordV0_1 = z.infer<
  typeof buildRecordSchema
>;
export type CommonSuggestionEvidenceBuildInputV0_1 = z.infer<
  typeof buildInputSchema
>;

const githubWorkItemFactIdsSchema = z
  .object({
    attentionCapability: factIdSchema,
    nativeTitle: factIdSchema,
    repositoryFullName: factIdSchema,
    number: factIdSchema,
    objectType: factIdSchema,
    taskKind: factIdSchema,
    state: factIdSchema,
    relationship: factIdSchema,
    semanticRole: factIdSchema,
    eligibilityLimit: factIdSchema,
    draftState: factIdSchema,
  })
  .strict();
const githubDeadlineFactIdsSchema = z
  .object({
    attentionCapability: factIdSchema,
    deadlineAt: factIdSchema,
    deadlineKind: factIdSchema,
    taskKind: factIdSchema,
    semanticRole: factIdSchema,
    eligibilityLimit: factIdSchema,
  })
  .strict();
const githubActivityFactIdsSchema = z
  .object({
    activityKind: factIdSchema,
    repositoryFullName: factIdSchema,
    activityAt: nullableFactIdSchema,
  })
  .strict();
const codexOverviewFactIdsSchema = z
  .object({
    nativeProjectLabel: factIdSchema,
    taskSummary: nullableFactIdSchema,
    taskSummarySource: nullableFactIdSchema,
    nativeActivityState: factIdSchema,
    semanticState: factIdSchema,
    nativeAttentionState: nullableFactIdSchema,
    contentMode: factIdSchema,
    conversationCollectionState: factIdSchema,
    historicalTurnStatus: factIdSchema,
    latestTurnCompletedAt: nullableFactIdSchema,
    turnCount: factIdSchema,
    commandExecutionCount: factIdSchema,
    failedCommandCount: factIdSchema,
    fileChangeCount: factIdSchema,
    toolCallCount: factIdSchema,
  })
  .strict();
const calendarConstraintFactIdsSchema = z
  .object({
    nativeTitle: factIdSchema,
    startAt: factIdSchema,
    endAt: factIdSchema,
    allDay: factIdSchema,
    tentative: factIdSchema,
  })
  .strict();
const notionResourceFactIdsSchema = z
  .object({
    nativeTitle: factIdSchema,
    resourceKind: factIdSchema,
    lastEditedAt: factIdSchema,
  })
  .strict();
const dayflowSpanFactIdsSchema = z
  .object({
    text: factIdSchema,
    confidenceStatus: factIdSchema,
    confidenceBasisPoints: nullableFactIdSchema,
    redactionStatus: factIdSchema,
    redactionCategories: factIdSchema,
  })
  .strict();
const dayflowFrameFactIdsSchema = z
  .object({
    capturedAt: factIdSchema,
    processingStatus: factIdSchema,
    spans: z.array(dayflowSpanFactIdsSchema).max(32),
    omissionCode: nullableFactIdSchema,
    errorCode: nullableFactIdSchema,
    retryability: nullableFactIdSchema,
  })
  .strict();

const commonSealedRecordShape = {
  recordId: recordIdSchema,
  projectRef: projectRefSchema,
  observedAt: privateUtcTimestampSchema,
  sourceUpdatedAt: privateUtcTimestampSchema.nullable(),
  validUntil: privateUtcTimestampSchema.nullable(),
  completeness: completenessSchema,
};
const primaryOrSupportingAuthoritySchema = z.enum([
  "primary_task_fact",
  "structured_supporting_context",
]);

const githubWorkItemRecordSchema = z
  .object({
    ...commonSealedRecordShape,
    kind: z.literal("github_work_item"),
    source: z.literal("github"),
    authority: primaryOrSupportingAuthoritySchema,
    facts: githubWorkItemFactsSchema,
    factIds: githubWorkItemFactIdsSchema,
  })
  .strict();
const githubDeadlineRecordSchema = z
  .object({
    ...commonSealedRecordShape,
    kind: z.literal("github_deadline"),
    source: z.literal("github"),
    authority: primaryOrSupportingAuthoritySchema,
    facts: githubDeadlineFactsSchema,
    factIds: githubDeadlineFactIdsSchema,
  })
  .strict();
const githubActivityRecordSchema = z
  .object({
    ...commonSealedRecordShape,
    kind: z.literal("github_activity"),
    source: z.literal("github"),
    authority: z.literal("structured_supporting_context"),
    facts: githubActivityFactsSchema,
    factIds: githubActivityFactIdsSchema,
  })
  .strict();
const codexOverviewRecordSchema = z
  .object({
    ...commonSealedRecordShape,
    kind: z.literal("codex_overview"),
    source: z.literal("codex"),
    authority: z.literal("structured_supporting_context"),
    facts: codexOverviewFactsSchema,
    factIds: codexOverviewFactIdsSchema,
  })
  .strict();
const calendarConstraintRecordSchema = z
  .object({
    ...commonSealedRecordShape,
    kind: z.literal("calendar_constraint"),
    source: z.literal("google_calendar"),
    authority: z.literal("structured_supporting_context"),
    facts: calendarConstraintFactsSchema,
    factIds: calendarConstraintFactIdsSchema,
  })
  .strict();
const notionResourceRecordSchema = z
  .object({
    ...commonSealedRecordShape,
    kind: z.literal("notion_resource"),
    source: z.literal("notion"),
    authority: z.literal("structured_supporting_context"),
    facts: notionResourceFactsSchema,
    factIds: notionResourceFactIdsSchema,
  })
  .strict();
const dayflowFrameRecordSchema = z
  .object({
    ...commonSealedRecordShape,
    kind: z.literal("dayflow_frame"),
    source: z.literal("dayflow"),
    authority: z.literal("screen_observation"),
    facts: dayflowFrameFactsSchema,
    factIds: dayflowFrameFactIdsSchema,
  })
  .strict();

const structuredRecordSchema = z.discriminatedUnion("kind", [
  githubWorkItemRecordSchema,
  githubDeadlineRecordSchema,
  githubActivityRecordSchema,
  codexOverviewRecordSchema,
  calendarConstraintRecordSchema,
  notionResourceRecordSchema,
]);
const commonSuggestionEvidenceRecordSchemaInternalV0_1 = z.discriminatedUnion(
  "kind",
  [
    githubWorkItemRecordSchema,
    githubDeadlineRecordSchema,
    githubActivityRecordSchema,
    codexOverviewRecordSchema,
    calendarConstraintRecordSchema,
    notionResourceRecordSchema,
    dayflowFrameRecordSchema,
  ],
);

const truncationPartitionSchema = z
  .object({
    limitUtf8Bytes: unsignedIntegerSchema,
    inputRecordCount: unsignedIntegerSchema,
    availableRecordCount: unsignedIntegerSchema,
    duplicateRecordCount: unsignedIntegerSchema,
    includedRecordCount: unsignedIntegerSchema,
    omittedRecordCount: unsignedIntegerSchema,
    availableUtf8Bytes: unsignedIntegerSchema,
    selectedUtf8Bytes: unsignedIntegerSchema,
    omittedRecordIdsSha256: privateSha256HexSchema.nullable(),
    reason: z.enum(["none", "byte_budget"]),
  })
  .strict();

const recordSetPreimageSchema = z
  .object({
    schemaVersion: z.literal(
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_SCHEMA_VERSION_V0_1,
    ),
    asOf: privateUtcTimestampSchema,
    records: z
      .object({
        structured: z
          .array(structuredRecordSchema)
          .max(
            COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredInputRecordCount,
          ),
        dayflow: z
          .array(dayflowFrameRecordSchema)
          .max(
            COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowInputRecordCount,
          ),
      })
      .strict(),
    truncation: z
      .object({
        budgetVersion: z.literal(
          COMMON_SUGGESTION_EVIDENCE_BUDGET_VERSION_V0_1,
        ),
        structured: truncationPartitionSchema,
        dayflow: truncationPartitionSchema,
        promptEnvelopeReserveUtf8Bytes: unsignedIntegerSchema,
        totalPromptUtf8BytesLimit: unsignedIntegerSchema,
      })
      .strict(),
  })
  .strict();

const commonSuggestionEvidenceRecordSetSchemaInternalV0_1 =
  recordSetPreimageSchema
    .extend({
      commonSuggestionEvidenceRecordSetSha256: privateSha256HexSchema,
    })
    .strict();

export type CommonSuggestionEvidenceRecordV0_1 = z.infer<
  typeof commonSuggestionEvidenceRecordSchemaInternalV0_1
>;
export type CommonSuggestionEvidenceRecordSetV0_1 = z.infer<
  typeof commonSuggestionEvidenceRecordSetSchemaInternalV0_1
>;

export type CommonSuggestionEvidenceRecordSetStructuralParseResultV0_1 =
  ReturnType<
    typeof commonSuggestionEvidenceRecordSetSchemaInternalV0_1.safeParse
  >;

export const commonSuggestionEvidenceRecordSetStructuralSchemaV0_1:
  Readonly<{
    safeParse(
      input: unknown,
    ): CommonSuggestionEvidenceRecordSetStructuralParseResultV0_1;
  }> = intrinsicObjectFreeze({
    safeParse(input: unknown) {
      let projected: unknown;
      try {
        projected = clonePlainData(
          input,
          new IntrinsicWeakSet<object>(),
          0,
        );
      } catch {
        return commonSuggestionEvidenceRecordSetSchemaInternalV0_1.safeParse(
          null,
        );
      }
      return commonSuggestionEvidenceRecordSetSchemaInternalV0_1.safeParse(
        projected,
      );
    },
  });

export type CommonSuggestionEvidenceRecordSetIssueCodeV0_1 =
  | "INPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "RECORD_ID_COLLISION"
  | "FACT_ID_COLLISION"
  | "BUDGET_INVARIANT_INVALID";

export type BuildCommonSuggestionEvidenceRecordSetResultV0_1 =
  | Readonly<{
      valid: true;
      recordSet: CommonSuggestionEvidenceRecordSetV0_1;
      issueCodes: readonly [];
    }>
  | Readonly<{
      valid: false;
      issueCodes: readonly [CommonSuggestionEvidenceRecordSetIssueCodeV0_1];
    }>;

export type VerifyCommonSuggestionEvidenceRecordSetResultV0_1 =
  | Readonly<{
      valid: true;
      recordSet: CommonSuggestionEvidenceRecordSetV0_1;
      issueCodes: readonly [];
    }>
  | Readonly<{
      valid: false;
      issueCodes: readonly ["INPUT_INVALID"];
    }>;

const EMPTY_ISSUE_CODES = intrinsicObjectFreeze([]) as readonly [];

function frozenFailure(
  issueCode: CommonSuggestionEvidenceRecordSetIssueCodeV0_1,
): BuildCommonSuggestionEvidenceRecordSetResultV0_1 {
  return intrinsicObjectFreeze({
    valid: false,
    issueCodes: intrinsicObjectFreeze([
      issueCode,
    ]) as readonly [CommonSuggestionEvidenceRecordSetIssueCodeV0_1],
  });
}

const INPUT_INVALID_FAILURE = frozenFailure("INPUT_INVALID");
const VERIFY_INPUT_INVALID_FAILURE = intrinsicObjectFreeze({
  valid: false,
  issueCodes: intrinsicObjectFreeze([
    "INPUT_INVALID",
  ]) as readonly ["INPUT_INVALID"],
}) satisfies VerifyCommonSuggestionEvidenceRecordSetResultV0_1;
const RESOURCE_LIMIT_FAILURE = frozenFailure("RESOURCE_LIMIT_EXCEEDED");
const RECORD_COLLISION_FAILURE = frozenFailure("RECORD_ID_COLLISION");
const FACT_COLLISION_FAILURE = frozenFailure("FACT_ID_COLLISION");
const BUDGET_INVARIANT_FAILURE = frozenFailure("BUDGET_INVARIANT_INVALID");

const ABORT_INPUT = intrinsicObjectFreeze({ code: "INPUT_INVALID" as const });
const ABORT_RESOURCE = intrinsicObjectFreeze({
  code: "RESOURCE_LIMIT_EXCEEDED" as const,
});
const ABORT_RECORD_COLLISION = intrinsicObjectFreeze({
  code: "RECORD_ID_COLLISION" as const,
});
const ABORT_FACT_COLLISION = intrinsicObjectFreeze({
  code: "FACT_ID_COLLISION" as const,
});
const ABORT_BUDGET = intrinsicObjectFreeze({
  code: "BUDGET_INVARIANT_INVALID" as const,
});

function abortInput(): never {
  throw ABORT_INPUT;
}

const intrinsicObjectNamespace = Object;
const intrinsicReflectNamespace = Reflect;
const intrinsicObjectPrototype = Object.prototype;
const intrinsicArrayPrototype = Array.prototype;

function applyIntrinsic<T>(
  target: (...args: never[]) => unknown,
  receiver: unknown,
  args: readonly unknown[],
): T {
  return intrinsicReflectApply(target, receiver, args) as T;
}

function arrayPush<T>(values: T[], value: T): void {
  applyIntrinsic<number>(intrinsicArrayPush, values, [value]);
}

function mapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return applyIntrinsic<V | undefined>(intrinsicMapGet, map, [key]);
}

function mapHas<K, V>(map: Map<K, V>, key: K): boolean {
  return applyIntrinsic<boolean>(intrinsicMapHas, map, [key]);
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  applyIntrinsic<Map<K, V>>(intrinsicMapSet, map, [key, value]);
}

function weakSetHas(value: WeakSet<object>, item: object): boolean {
  return applyIntrinsic<boolean>(intrinsicWeakSetHas, value, [item]);
}

function weakSetAdd(value: WeakSet<object>, item: object): void {
  applyIntrinsic<WeakSet<object>>(intrinsicWeakSetAdd, value, [item]);
}

function weakSetDelete(value: WeakSet<object>, item: object): void {
  applyIntrinsic<boolean>(intrinsicWeakSetDelete, value, [item]);
  // JSON has no shared-reference identity. Keep the item in the cumulative
  // seen set so a second occurrence fails closed instead of being cloned again.
  weakSetAdd(value, item);
}

function getOwnDataValue(value: object, key: PropertyKey): unknown {
  const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    intrinsicObjectNamespace,
    [value, key],
  );
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true
  ) {
    abortInput();
  }
  return descriptor.value;
}

function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== "object" || intrinsicIsProxy(value)) {
    return false;
  }
  return (
    applyIntrinsic<object | null>(
      intrinsicObjectGetPrototypeOf,
      intrinsicObjectNamespace,
      [value],
    ) === intrinsicObjectPrototype
  );
}

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = applyIntrinsic<readonly PropertyKey[]>(
    intrinsicReflectOwnKeys,
    intrinsicReflectNamespace,
    [value],
  );
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") return false;
    let found = false;
    for (
      let expectedIndex = 0;
      expectedIndex < expected.length;
      expectedIndex += 1
    ) {
      if (expected[expectedIndex] === key) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function requireOrdinaryArray(value: unknown): readonly unknown[] {
  if (
    value === null ||
    typeof value !== "object" ||
    intrinsicIsProxy(value) ||
    !intrinsicArrayIsArray(value) ||
    applyIntrinsic<object | null>(
      intrinsicObjectGetPrototypeOf,
      intrinsicObjectNamespace,
      [value],
    ) !== intrinsicArrayPrototype
  ) {
    abortInput();
  }
  return value;
}

function arrayIntrinsicLength(value: readonly unknown[]): number {
  const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    intrinsicObjectGetOwnPropertyDescriptor,
    intrinsicObjectNamespace,
    [value, "length"],
  );
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "number"
  ) {
    abortInput();
  }
  return descriptor.value;
}

function preflightBuildRoot(input: unknown): void {
  if (
    !isPlainObject(input) ||
    !hasExactOwnKeys(input, ["asOf", "availableRecords"])
  ) {
    abortInput();
  }
  if (typeof getOwnDataValue(input, "asOf") !== "string") abortInput();
  const availableRecords = getOwnDataValue(input, "availableRecords");
  if (
    !isPlainObject(availableRecords) ||
    !hasExactOwnKeys(availableRecords, ["structured", "dayflow"])
  ) {
    abortInput();
  }
  const structured = requireOrdinaryArray(
    getOwnDataValue(availableRecords, "structured"),
  );
  const dayflow = requireOrdinaryArray(
    getOwnDataValue(availableRecords, "dayflow"),
  );
  if (
    arrayIntrinsicLength(structured) >
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredInputRecordCount ||
    arrayIntrinsicLength(dayflow) >
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowInputRecordCount
  ) {
    throw ABORT_RESOURCE;
  }
}

function clonePlainData(
  value: unknown,
  active: WeakSet<object>,
  depth: number,
): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!intrinsicNumberIsFinite(value) || intrinsicObjectIs(value, -0)) {
      abortInput();
    }
    return value;
  }
  if (typeof value !== "object" || intrinsicIsProxy(value) || depth > 20) {
    abortInput();
  }
  if (weakSetHas(active, value)) abortInput();
  weakSetAdd(active, value);
  try {
    if (intrinsicArrayIsArray(value)) {
      if (
        applyIntrinsic<object | null>(
          intrinsicObjectGetPrototypeOf,
          intrinsicObjectNamespace,
          [value],
        ) !== intrinsicArrayPrototype
      ) {
        abortInput();
      }
      const length = arrayIntrinsicLength(value);
      if (length > 2_048) abortInput();
      const keys = applyIntrinsic<readonly PropertyKey[]>(
        intrinsicReflectOwnKeys,
        intrinsicReflectNamespace,
        [value],
      );
      if (keys.length !== length + 1) abortInput();
      const output: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = getOwnDataValue(value, `${index}`);
        intrinsicObjectDefineProperty(output, `${index}`, {
          value: clonePlainData(item, active, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    }
    if (!isPlainObject(value)) abortInput();
    const keys = applyIntrinsic<readonly PropertyKey[]>(
      intrinsicReflectOwnKeys,
      intrinsicReflectNamespace,
      [value],
    );
    if (keys.length > 64) abortInput();
    const output = intrinsicObjectCreate(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") abortInput();
      intrinsicObjectDefineProperty(output, key, {
        value: clonePlainData(
          getOwnDataValue(value, key),
          active,
          depth + 1,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } finally {
    weakSetDelete(active, value);
  }
}

function projectBuildInput(input: unknown): unknown {
  preflightBuildRoot(input);
  return clonePlainData(input, new IntrinsicWeakSet<object>(), 0);
}

function encodeUtf8(value: string): Uint8Array {
  return applyIntrinsic<Uint8Array>(intrinsicTextEncoderEncode, utf8Encoder, [
    value,
  ]);
}

function canonicalBytes(value: unknown): Uint8Array {
  return encodeUtf8(jcsCanonicalize(value));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const keys = applyIntrinsic<readonly PropertyKey[]>(
    intrinsicReflectOwnKeys,
    intrinsicReflectNamespace,
    [value],
  );
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
      intrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [value, keys[index]!],
    );
    if (descriptor !== undefined && "value" in descriptor) {
      deepFreeze(descriptor.value);
    }
  }
  intrinsicObjectFreeze(value);
  return value;
}

function sourceForKind(
  kind: CommonSuggestionEvidenceBuildRecordV0_1["kind"],
): CommonSuggestionEvidenceRecordV0_1["source"] {
  switch (kind) {
    case "github_work_item":
    case "github_deadline":
    case "github_activity":
      return "github";
    case "codex_overview":
      return "codex";
    case "calendar_constraint":
      return "google_calendar";
    case "notion_resource":
      return "notion";
    case "dayflow_frame":
      return "dayflow";
  }
}

function authorityForRecord(
  record: CommonSuggestionEvidenceBuildRecordV0_1,
): CommonSuggestionEvidenceRecordV0_1["authority"] {
  if (
    (record.kind === "github_work_item" ||
      record.kind === "github_deadline") &&
    record.facts.attentionCapability === "candidate_input" &&
    record.facts.semanticRole === "direct_work_item"
  ) {
    return "primary_task_fact";
  }
  return record.kind === "dayflow_frame"
    ? "screen_observation"
    : "structured_supporting_context";
}

function deriveRecordId(
  record: CommonSuggestionEvidenceBuildRecordV0_1,
): string {
  return runtimeStableId("evidence_record", RECORD_ID_VERSION, {
    kind: record.kind,
    identitySha256: domainSeparatedSha256(
      PRIVATE_RECORD_IDENTITY_HASH_DOMAIN,
      record.identity,
    ),
  });
}

function deriveFactId(recordId: string, factKey: string, value: unknown) {
  return runtimeStableId("evidence_fact", FACT_ID_VERSION, {
    recordId,
    factKey,
    valueSha256: domainSeparatedSha256(FACT_VALUE_HASH_DOMAIN, value),
  });
}

function deriveFlatFactIds(recordId: string, facts: object): object {
  const keys = applyIntrinsic<readonly PropertyKey[]>(
    intrinsicReflectOwnKeys,
    Reflect,
    [facts],
  );
  const factIds = intrinsicObjectCreate(null) as Record<string, string | null>;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") abortInput();
    const value = getOwnDataValue(facts, key);
    intrinsicObjectDefineProperty(factIds, key, {
      value: value === null ? null : deriveFactId(recordId, key, value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return factIds;
}

function deriveDayflowFactIds(
  recordId: string,
  facts: z.infer<typeof dayflowFrameFactsSchema>,
): object {
  const spans: object[] = [];
  for (let index = 0; index < facts.spans.length; index += 1) {
    const span = facts.spans[index]!;
    const prefix = `spans.${span.spanOrdinal}`;
    arrayPush(
      spans,
      {
        text: deriveFactId(recordId, `${prefix}.text`, span.text),
        confidenceStatus: deriveFactId(
          recordId,
          `${prefix}.confidence.status`,
          span.confidence.status,
        ),
        confidenceBasisPoints:
          span.confidence.basisPoints === null
            ? null
            : deriveFactId(
                recordId,
                `${prefix}.confidence.basisPoints`,
                span.confidence.basisPoints,
              ),
        redactionStatus: deriveFactId(
          recordId,
          `${prefix}.redaction.status`,
          span.redaction.status,
        ),
        redactionCategories: deriveFactId(
          recordId,
          `${prefix}.redaction.categories`,
          span.redaction.categories,
        ),
      },
    );
  }
  return {
    capturedAt: deriveFactId(recordId, "capturedAt", facts.capturedAt),
    processingStatus: deriveFactId(
      recordId,
      "processingStatus",
      facts.processingStatus,
    ),
    spans,
    omissionCode:
      facts.omissionCode === null
        ? null
        : deriveFactId(recordId, "omissionCode", facts.omissionCode),
    errorCode:
      facts.errorCode === null
        ? null
        : deriveFactId(recordId, "errorCode", facts.errorCode),
    retryability:
      facts.retryability === null
        ? null
        : deriveFactId(recordId, "retryability", facts.retryability),
  };
}

type DerivedRecord = Readonly<{
  record: CommonSuggestionEvidenceRecordV0_1;
  identityPreimageBytes: Uint8Array;
  recordBytes: Uint8Array;
}>;

function deriveRecord(
  input: CommonSuggestionEvidenceBuildRecordV0_1,
): DerivedRecord {
  const recordId = deriveRecordId(input);
  const factIds =
    input.kind === "dayflow_frame"
      ? deriveDayflowFactIds(recordId, input.facts)
      : deriveFlatFactIds(recordId, input.facts);
  const parsed = commonSuggestionEvidenceRecordSchemaInternalV0_1.safeParse({
    recordId,
    kind: input.kind,
    source: sourceForKind(input.kind),
    authority: authorityForRecord(input),
    projectRef: input.projectRef,
    observedAt: input.observedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
    validUntil: input.validUntil,
    completeness: input.completeness,
    facts: input.facts,
    factIds,
  });
  if (!parsed.success) abortInput();
  return {
    record: parsed.data,
    identityPreimageBytes: canonicalBytes({
      kind: input.kind,
      identity: input.identity,
    }),
    recordBytes: canonicalBytes(parsed.data),
  };
}

type DeduplicatedPartition = Readonly<{
  inputRecordCount: number;
  duplicateRecordCount: number;
  records: readonly DerivedRecord[];
}>;

function deduplicatePartition(
  inputs: readonly CommonSuggestionEvidenceBuildRecordV0_1[],
): DeduplicatedPartition {
  const byRecordId = new IntrinsicMap<string, DerivedRecord>();
  const records: DerivedRecord[] = [];
  let duplicateRecordCount = 0;
  for (let index = 0; index < inputs.length; index += 1) {
    const derived = deriveRecord(inputs[index]!);
    const existing = mapGet(byRecordId, derived.record.recordId);
    if (existing === undefined) {
      mapSet(byRecordId, derived.record.recordId, derived);
      arrayPush(records, derived);
      continue;
    }
    if (
      !bytesEqual(
        existing.identityPreimageBytes,
        derived.identityPreimageBytes,
      ) ||
      !bytesEqual(existing.recordBytes, derived.recordBytes)
    ) {
      throw ABORT_RECORD_COLLISION;
    }
    duplicateRecordCount += 1;
  }
  return { inputRecordCount: inputs.length, duplicateRecordCount, records };
}

function visitFactIds(value: unknown, visit: (factId: string) => void): void {
  if (value === null) return;
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (typeof value !== "object") abortInput();
  const keys = applyIntrinsic<readonly PropertyKey[]>(
    intrinsicReflectOwnKeys,
    Reflect,
    [value],
  );
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === "length") continue;
    const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
      intrinsicObjectGetOwnPropertyDescriptor,
      Object,
      [value, key],
    );
    if (descriptor === undefined || !("value" in descriptor)) abortInput();
    visitFactIds(descriptor.value, visit);
  }
}

function assertGlobalFactIdsUnique(
  partitions: readonly DeduplicatedPartition[],
): void {
  const factIds = new IntrinsicMap<string, true>();
  for (
    let partitionIndex = 0;
    partitionIndex < partitions.length;
    partitionIndex += 1
  ) {
    const records = partitions[partitionIndex]!.records;
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      visitFactIds(records[recordIndex]!.record.factIds, (factId) => {
        if (mapHas(factIds, factId)) throw ABORT_FACT_COLLISION;
        mapSet(factIds, factId, true);
      });
    }
  }
}

function assertGlobalRecordIdsUnique(
  partitions: readonly DeduplicatedPartition[],
): void {
  const recordIds = new IntrinsicMap<string, true>();
  for (
    let partitionIndex = 0;
    partitionIndex < partitions.length;
    partitionIndex += 1
  ) {
    const records = partitions[partitionIndex]!.records;
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const recordId = records[recordIndex]!.record.recordId;
      if (mapHas(recordIds, recordId)) throw ABORT_RECORD_COLLISION;
      mapSet(recordIds, recordId, true);
    }
  }
}

function authorityRank(
  authority: CommonSuggestionEvidenceRecordV0_1["authority"],
): number {
  switch (authority) {
    case "primary_task_fact":
      return 0;
    case "structured_supporting_context":
      return 1;
    case "screen_observation":
      return 2;
  }
}

function sourceRank(source: CommonSuggestionEvidenceRecordV0_1["source"]): number {
  switch (source) {
    case "github":
      return 0;
    case "codex":
      return 1;
    case "google_calendar":
      return 2;
    case "notion":
      return 3;
    case "dayflow":
      return 4;
  }
}

function kindRank(kind: CommonSuggestionEvidenceRecordV0_1["kind"]): number {
  switch (kind) {
    case "github_work_item":
      return 0;
    case "github_deadline":
      return 1;
    case "github_activity":
      return 2;
    case "codex_overview":
      return 3;
    case "calendar_constraint":
      return 4;
    case "notion_resource":
      return 5;
    case "dayflow_frame":
      return 6;
  }
}

function compareForSelection(left: DerivedRecord, right: DerivedRecord): number {
  const authority =
    authorityRank(left.record.authority) - authorityRank(right.record.authority);
  if (authority !== 0) return authority;
  const observedAt = compareRuntimeStrings(
    right.record.observedAt,
    left.record.observedAt,
  );
  if (observedAt !== 0) return observedAt;
  const source = sourceRank(left.record.source) - sourceRank(right.record.source);
  if (source !== 0) return source;
  const kind = kindRank(left.record.kind) - kindRank(right.record.kind);
  if (kind !== 0) return kind;
  return compareRuntimeStrings(left.record.recordId, right.record.recordId);
}

function compareForSerialization(
  left: CommonSuggestionEvidenceRecordV0_1,
  right: CommonSuggestionEvidenceRecordV0_1,
): number {
  const authority = authorityRank(left.authority) - authorityRank(right.authority);
  if (authority !== 0) return authority;
  const source = sourceRank(left.source) - sourceRank(right.source);
  if (source !== 0) return source;
  const observedAt = compareRuntimeStrings(left.observedAt, right.observedAt);
  if (observedAt !== 0) return observedAt;
  const kind = kindRank(left.kind) - kindRank(right.kind);
  if (kind !== 0) return kind;
  return compareRuntimeStrings(left.recordId, right.recordId);
}

function sortedCopy<T>(
  values: readonly T[],
  compare: (left: T, right: T) => number,
): T[] {
  const output: T[] = [];
  for (let index = 0; index < values.length; index += 1) {
    arrayPush(output, values[index]!);
  }
  applyIntrinsic<T[]>(intrinsicArraySort, output, [compare]);
  return output;
}

type PartitionName = "structured" | "dayflow";
type TruncationPartition = z.infer<typeof truncationPartitionSchema>;

function buildPartition(
  partition: PartitionName,
  deduplicated: DeduplicatedPartition,
  limitUtf8Bytes: number,
): Readonly<{
  selected: readonly CommonSuggestionEvidenceRecordV0_1[];
  truncation: TruncationPartition;
}> {
  const availableBySerialization = sortedCopy(
    deduplicated.records,
    (left, right) => compareForSerialization(left.record, right.record),
  );
  const availableRecords: CommonSuggestionEvidenceRecordV0_1[] = [];
  for (let index = 0; index < availableBySerialization.length; index += 1) {
    arrayPush(availableRecords, availableBySerialization[index]!.record);
  }
  const availableUtf8Bytes = canonicalBytes(availableRecords).byteLength;

  const selectionOrder = sortedCopy(
    deduplicated.records,
    compareForSelection,
  );
  const selected: DerivedRecord[] = [];
  const omittedRecordIds: string[] = [];
  let selectedRecordByteLengthSum = 0;
  for (let index = 0; index < selectionOrder.length; index += 1) {
    const candidate = selectionOrder[index]!;
    const proposedUtf8Bytes =
      1 +
      selectedRecordByteLengthSum +
      candidate.recordBytes.byteLength +
      selected.length +
      1;
    if (proposedUtf8Bytes <= limitUtf8Bytes) {
      arrayPush(selected, candidate);
      selectedRecordByteLengthSum += candidate.recordBytes.byteLength;
    } else {
      arrayPush(omittedRecordIds, candidate.record.recordId);
    }
  }

  const selectedBySerialization = sortedCopy(
    selected,
    (left, right) => compareForSerialization(left.record, right.record),
  );
  const selectedRecords: CommonSuggestionEvidenceRecordV0_1[] = [];
  for (let index = 0; index < selectedBySerialization.length; index += 1) {
    arrayPush(selectedRecords, selectedBySerialization[index]!.record);
  }
  const selectedUtf8Bytes = canonicalBytes(selectedRecords).byteLength;
  const sortedOmittedIds = sortedCopy(omittedRecordIds, compareRuntimeStrings);
  const omittedRecordIdsSha256 =
    sortedOmittedIds.length === 0
      ? null
      : domainSeparatedSha256(OMITTED_RECORD_IDS_HASH_DOMAIN, {
          schemaVersion:
            COMMON_SUGGESTION_EVIDENCE_RECORD_SET_SCHEMA_VERSION_V0_1,
          budgetVersion: COMMON_SUGGESTION_EVIDENCE_BUDGET_VERSION_V0_1,
          partition,
          limitUtf8Bytes,
          omittedRecordIds: sortedOmittedIds,
        });
  return {
    selected: selectedRecords,
    truncation: {
      limitUtf8Bytes,
      inputRecordCount: deduplicated.inputRecordCount,
      availableRecordCount: deduplicated.records.length,
      duplicateRecordCount: deduplicated.duplicateRecordCount,
      includedRecordCount: selectedRecords.length,
      omittedRecordCount: sortedOmittedIds.length,
      availableUtf8Bytes,
      selectedUtf8Bytes,
      omittedRecordIdsSha256,
      reason: sortedOmittedIds.length === 0 ? "none" : "byte_budget",
    },
  };
}

function expectedAuthority(
  record: CommonSuggestionEvidenceRecordV0_1,
): CommonSuggestionEvidenceRecordV0_1["authority"] {
  if (
    (record.kind === "github_work_item" ||
      record.kind === "github_deadline") &&
    record.facts.attentionCapability === "candidate_input" &&
    record.facts.semanticRole === "direct_work_item"
  ) {
    return "primary_task_fact";
  }
  return record.kind === "dayflow_frame"
    ? "screen_observation"
    : "structured_supporting_context";
}

function expectedFactIds(record: CommonSuggestionEvidenceRecordV0_1): object {
  return record.kind === "dayflow_frame"
    ? deriveDayflowFactIds(record.recordId, record.facts)
    : deriveFlatFactIds(record.recordId, record.facts);
}

function validatePartitionMetadata(
  metadata: TruncationPartition,
  records: readonly CommonSuggestionEvidenceRecordV0_1[],
  expectedLimit: number,
  expectedInputRecordLimit: number,
): boolean {
  if (
    metadata.limitUtf8Bytes !== expectedLimit ||
    metadata.inputRecordCount > expectedInputRecordLimit ||
    metadata.availableRecordCount !==
      metadata.includedRecordCount + metadata.omittedRecordCount ||
    metadata.inputRecordCount !==
      metadata.availableRecordCount + metadata.duplicateRecordCount ||
    metadata.includedRecordCount !== records.length ||
    metadata.selectedUtf8Bytes !== canonicalBytes(records).byteLength ||
    metadata.selectedUtf8Bytes > metadata.limitUtf8Bytes ||
    metadata.availableUtf8Bytes < metadata.selectedUtf8Bytes
  ) {
    return false;
  }
  if (metadata.omittedRecordCount === 0) {
    return (
      metadata.reason === "none" &&
      metadata.omittedRecordIdsSha256 === null &&
      metadata.availableUtf8Bytes === metadata.selectedUtf8Bytes
    );
  }
  return (
    metadata.reason === "byte_budget" &&
    metadata.omittedRecordIdsSha256 !== null &&
    metadata.availableUtf8Bytes > metadata.limitUtf8Bytes
  );
}

function isStrictlySerializationSorted(
  records: readonly CommonSuggestionEvidenceRecordV0_1[],
): boolean {
  for (let index = 1; index < records.length; index += 1) {
    if (compareForSerialization(records[index - 1]!, records[index]!) >= 0) {
      return false;
    }
  }
  return true;
}

function validateRecordSetDerivations(
  value: CommonSuggestionEvidenceRecordSetV0_1,
): boolean {
  if (
    value.truncation.promptEnvelopeReserveUtf8Bytes !==
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.promptEnvelopeReserveUtf8Bytes ||
    value.truncation.totalPromptUtf8BytesLimit !==
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.totalPromptUtf8Bytes ||
    !validatePartitionMetadata(
      value.truncation.structured,
      value.records.structured,
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredUtf8Bytes,
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredInputRecordCount,
    ) ||
    !validatePartitionMetadata(
      value.truncation.dayflow,
      value.records.dayflow,
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowUtf8Bytes,
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowInputRecordCount,
    ) ||
    value.truncation.structured.selectedUtf8Bytes +
      value.truncation.dayflow.selectedUtf8Bytes +
      value.truncation.promptEnvelopeReserveUtf8Bytes >
      value.truncation.totalPromptUtf8BytesLimit ||
    !isStrictlySerializationSorted(value.records.structured) ||
    !isStrictlySerializationSorted(value.records.dayflow)
  ) {
    return false;
  }

  const recordIds = new IntrinsicMap<string, true>();
  const factIds = new IntrinsicMap<string, true>();
  const partitions: readonly (readonly CommonSuggestionEvidenceRecordV0_1[])[] =
    [value.records.structured, value.records.dayflow];
  for (
    let partitionIndex = 0;
    partitionIndex < partitions.length;
    partitionIndex += 1
  ) {
    const records = partitions[partitionIndex]!;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      if (
        mapHas(recordIds, record.recordId) ||
        record.source !== sourceForKind(record.kind) ||
        record.authority !== expectedAuthority(record) ||
        jcsCanonicalize(record.factIds) !==
          jcsCanonicalize(expectedFactIds(record))
      ) {
        return false;
      }
      mapSet(recordIds, record.recordId, true);
      let duplicateFact = false;
      visitFactIds(record.factIds, (factId) => {
        if (mapHas(factIds, factId)) {
          duplicateFact = true;
        } else {
          mapSet(factIds, factId, true);
        }
      });
      if (duplicateFact) return false;
    }
  }

  const preimage = {
    schemaVersion: value.schemaVersion,
    asOf: value.asOf,
    records: value.records,
    truncation: value.truncation,
  };
  return (
    domainSeparatedSha256(
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_HASH_DOMAIN_V0_1,
      preimage,
    ) === value.commonSuggestionEvidenceRecordSetSha256
  );
}

function parseVerifiedCommonSuggestionEvidenceRecordSet(
  input: unknown,
): CommonSuggestionEvidenceRecordSetV0_1 | null {
  try {
    const projected = clonePlainData(
      input,
      new IntrinsicWeakSet<object>(),
      0,
    );
    const parsed =
      commonSuggestionEvidenceRecordSetSchemaInternalV0_1.safeParse(projected);
    if (!parsed.success || !validateRecordSetDerivations(parsed.data)) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function verifyCommonSuggestionEvidenceRecordSetV0_1(
  input: unknown,
): VerifyCommonSuggestionEvidenceRecordSetResultV0_1 {
  const recordSet = parseVerifiedCommonSuggestionEvidenceRecordSet(input);
  if (recordSet === null) return VERIFY_INPUT_INVALID_FAILURE;
  return intrinsicObjectFreeze({
    valid: true,
    recordSet: deepFreeze(recordSet),
    issueCodes: EMPTY_ISSUE_CODES,
  });
}

function failureForAbort(
  error: unknown,
): BuildCommonSuggestionEvidenceRecordSetResultV0_1 {
  if (error === ABORT_RESOURCE) return RESOURCE_LIMIT_FAILURE;
  if (error === ABORT_RECORD_COLLISION) return RECORD_COLLISION_FAILURE;
  if (error === ABORT_FACT_COLLISION) return FACT_COLLISION_FAILURE;
  if (error === ABORT_BUDGET) return BUDGET_INVARIANT_FAILURE;
  return INPUT_INVALID_FAILURE;
}

export function buildAndSealCommonSuggestionEvidenceRecordSetV0_1(
  input: unknown,
): BuildCommonSuggestionEvidenceRecordSetResultV0_1 {
  try {
    const projected = projectBuildInput(input);
    const parsed = buildInputSchema.safeParse(projected);
    if (!parsed.success) throw ABORT_INPUT;

    const structured = deduplicatePartition(
      parsed.data.availableRecords.structured,
    );
    const dayflow = deduplicatePartition(parsed.data.availableRecords.dayflow);
    const partitions = [structured, dayflow] as const;
    assertGlobalRecordIdsUnique(partitions);
    assertGlobalFactIdsUnique(partitions);

    const selectedStructured = buildPartition(
      "structured",
      structured,
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredUtf8Bytes,
    );
    const selectedDayflow = buildPartition(
      "dayflow",
      dayflow,
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowUtf8Bytes,
    );
    const preimage = {
      schemaVersion:
        COMMON_SUGGESTION_EVIDENCE_RECORD_SET_SCHEMA_VERSION_V0_1,
      asOf: parsed.data.asOf,
      records: {
        structured: selectedStructured.selected,
        dayflow: selectedDayflow.selected,
      },
      truncation: {
        budgetVersion: COMMON_SUGGESTION_EVIDENCE_BUDGET_VERSION_V0_1,
        structured: selectedStructured.truncation,
        dayflow: selectedDayflow.truncation,
        promptEnvelopeReserveUtf8Bytes:
          COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.promptEnvelopeReserveUtf8Bytes,
        totalPromptUtf8BytesLimit:
          COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.totalPromptUtf8Bytes,
      },
    };
    if (
      preimage.truncation.structured.selectedUtf8Bytes +
        preimage.truncation.dayflow.selectedUtf8Bytes +
        preimage.truncation.promptEnvelopeReserveUtf8Bytes >
      preimage.truncation.totalPromptUtf8BytesLimit
    ) {
      throw ABORT_BUDGET;
    }
    const sealed = parseVerifiedCommonSuggestionEvidenceRecordSet({
      ...preimage,
      commonSuggestionEvidenceRecordSetSha256: domainSeparatedSha256(
        COMMON_SUGGESTION_EVIDENCE_RECORD_SET_HASH_DOMAIN_V0_1,
        preimage,
      ),
    });
    if (sealed === null) throw ABORT_BUDGET;
    const recordSet = deepFreeze(sealed);
    return intrinsicObjectFreeze({
      valid: true,
      recordSet,
      issueCodes: EMPTY_ISSUE_CODES,
    });
  } catch (error) {
    return failureForAbort(error);
  }
}

export class CommonSuggestionEvidenceRecordSetError extends Error {
  readonly issueCode = "INPUT_INVALID" as const;

  constructor() {
    super("Invalid common suggestion evidence record set.");
    intrinsicObjectDefineProperty(this, "name", {
      value: "CommonSuggestionEvidenceRecordSetError",
      configurable: true,
      enumerable: false,
      writable: true,
    });
    intrinsicObjectFreeze(this);
  }
}

export function serializeCommonSuggestionEvidenceRecordSetV0_1(
  value: CommonSuggestionEvidenceRecordSetV0_1,
): Uint8Array {
  try {
    const recordSet = parseVerifiedCommonSuggestionEvidenceRecordSet(value);
    if (recordSet === null) throw ABORT_INPUT;
    return encodeUtf8(`${jcsCanonicalize(recordSet)}\n`);
  } catch {
    throw new CommonSuggestionEvidenceRecordSetError();
  }
}
