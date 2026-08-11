import { z } from "zod";

import { githubPullRequestActionabilitySchema } from "../connectors/github/actionabilityContract";
import {
  CODEX_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
  RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT
} from "./versions";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const stableIdSchema = z.string().regex(/^[a-z]+_[a-f0-9]{32}$/);
const timestampSchema = z.string().datetime();

export const runtimeSourceSchema = z.enum(["github", "codex"]);

export const snapshotAssessmentReasonCodeSchema = z.enum([
  "SNAPSHOT_FRESH",
  "SNAPSHOT_STALE",
  "SNAPSHOT_FROM_FUTURE",
  "SNAPSHOT_TRUNCATED",
  "GITHUB_ACTIVITIES_PARTIAL",
  "GITHUB_ACTIVITIES_UNAVAILABLE",
  "GITHUB_ACTIONABILITY_PARTIAL",
  "GITHUB_ACTIONABILITY_UNAVAILABLE",
  "CODEX_OVERVIEW_ONLY"
]);

export const normalizationIssueCodeSchema = z.enum([
  "SNAPSHOT_FROM_FUTURE",
  "SNAPSHOT_STALE",
  "SNAPSHOT_TRUNCATED",
  "GITHUB_ACTIVITIES_PARTIAL",
  "GITHUB_ACTIVITIES_UNAVAILABLE",
  "GITHUB_ACTIONABILITY_PARTIAL",
  "GITHUB_ACTIONABILITY_UNAVAILABLE",
  "UNSAFE_DESTINATION",
  "CONFLICTING_DUPLICATE_RECORD",
  "RECORD_INVALID"
]);

export const freshnessPolicySchema = z
  .object({
    version: z.string().min(1).max(120),
    maxAgeMsBySource: z
      .object({
        github: z.number().int().positive(),
        codex: z.number().int().positive()
      })
      .strict(),
    maxFutureClockSkewMs: z.number().int().nonnegative()
  })
  .strict();

export const snapshotAssessmentSchema = z
  .object({
    contract: z.literal(RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT),
    source: runtimeSourceSchema,
    asOf: timestampSchema,
    fetchedAt: timestampSchema,
    freshnessPolicyVersion: z.string().min(1).max(120),
    freshness: z.enum(["fresh", "stale", "invalid"]),
    completeness: z.enum(["complete", "partial"]),
    truncated: z.boolean(),
    candidateSetComplete: z.boolean(),
    usableForOverview: z.boolean(),
    usableForCurrentCandidates: z.boolean(),
    reasonCodes: z.array(snapshotAssessmentReasonCodeSchema)
  })
  .strict()
  .superRefine((assessment, context) => {
    if (
      assessment.freshness !== "fresh" &&
      assessment.usableForCurrentCandidates
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["usableForCurrentCandidates"],
        message: "Only fresh snapshots can support current candidates."
      });
    }
    if (
      assessment.freshness === "invalid" &&
      assessment.usableForOverview
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["usableForOverview"],
        message: "Invalid snapshots cannot support the overview."
      });
    }
    if (assessment.truncated && assessment.candidateSetComplete) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidateSetComplete"],
        message:
          "Truncated snapshots cannot claim complete candidates."
      });
    }
  });

const evidenceBase = {
  snapshotSha256: sha256Schema,
  subjectId: z.string().min(1).max(240),
  observedAt: timestampSchema,
  sourceUpdatedAt: timestampSchema.nullable()
};

export const githubQueryMembershipEvidenceSchema = z
  .object({
    type: z.literal("github_query_membership"),
    source: z.literal("github"),
    queryKind: z.enum([
      "assigned_open_issue",
      "review_requested_open_pr",
      "authored_open_pr"
    ]),
    objectId: z.string().min(1).max(120),
    ...evidenceBase
  })
  .strict();

export const githubObjectFieldEvidenceSchema = z
  .object({
    type: z.literal("github_object_field"),
    source: z.literal("github"),
    objectId: z.string().min(1).max(120),
    field: z.enum([
      "state",
      "title",
      "repository_full_name",
      "number",
      "html_url",
      "milestone_due_at",
      "created_at",
      "updated_at",
      "collection_state",
      "draft",
      "review_decision",
      "checks_summary",
      "mergeable",
      "merge_conflict",
      "unresolved_change_request_count",
      "requested_reviewer_count",
      "action_required",
      "action_required_reasons"
    ]),
    valueSha256: sha256Schema,
    ...evidenceBase
  })
  .strict();

export const githubActivityEvidenceSchema = z
  .object({
    type: z.literal("github_activity_record"),
    source: z.literal("github"),
    activityId: z.string().min(1).max(200),
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
      "pull_request_review_commented"
    ]),
    valueSha256: sha256Schema,
    ...evidenceBase
  })
  .strict();

export const codexSessionFieldEvidenceSchema = z
  .object({
    type: z.literal("codex_session_field"),
    source: z.literal("codex"),
    sessionId: z.string().regex(/^[a-f0-9]{24}$/),
    field: z.enum([
      "scope_id",
      "project_label",
      "task_summary",
      "task_summary_source",
      "created_at",
      "updated_at",
      "activity_state",
      "attention_state",
      "content_mode",
      "content_state",
      "content_source_updated_at",
      "content_collected_at",
      "content_expires_at",
      "historical_turn_status",
      "latest_turn_completed_at",
      "turn_count",
      "user_prompt_count",
      "agent_response_count",
      "command_execution_count",
      "failed_command_count",
      "file_change_count",
      "tool_call_count",
      "omitted_reasoning_item_count",
      "omitted_unsupported_item_count",
      "content_truncated",
      "content_reason_codes",
      "latest_user_prompt_excerpt",
      "latest_agent_response_excerpt",
      "latest_execution_summary"
    ]),
    valueSha256: sha256Schema,
    ...evidenceBase
  })
  .strict();

export const runtimeSourceEvidenceSchema = z.discriminatedUnion("type", [
  githubQueryMembershipEvidenceSchema,
  githubObjectFieldEvidenceSchema,
  githubActivityEvidenceSchema,
  codexSessionFieldEvidenceSchema
]);

const workSignalBase = {
  contract: z.literal(RUNTIME_WORK_SIGNAL_CONTRACT),
  signalId: stableIdSchema,
  observationId: stableIdSchema,
  signalHash: sha256Schema,
  sourceSnapshotSha256: sha256Schema,
  normalizerVersion: z.string().min(1).max(120),
  subjectId: z.string().min(1).max(240),
  sourceScopeId: z.string().min(1).max(240),
  projectId: z
    .string()
    .regex(/^project_[a-f0-9]{32}$/)
    .nullable(),
  observedAt: timestampSchema,
  sourceUpdatedAt: timestampSchema.nullable(),
  validUntil: timestampSchema.nullable(),
  directness: z.enum(["explicit", "derived"]),
  completeness: z.enum(["complete", "truncated", "unknown"]),
  attentionCapability: z.enum(["candidate_input", "overview_only"])
};

const githubWorkItemFactsSchema = z
  .object({
    objectType: z.enum(["issue", "pull_request"]),
    taskKind: z.enum([
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ]),
    state: z.literal("open"),
    relationship: z.enum([
      "assigned_to_user",
      "review_requested_from_user",
      "authored_by_user"
    ]),
    semanticRole: z.enum(["direct_work_item", "context_only"]),
    eligibilityLimit: z.enum([
      "none",
      "draft_state_unknown",
      "not_actionable_by_source_kind"
    ]),
    draftState: z.enum(["unknown", "not_applicable", "draft", "ready"]),
    repositoryFullName: z.string().min(1).max(240),
    number: z.number().int().positive(),
    title: z.string().min(1).max(240),
    destinationUrl: z.string().url().nullable(),
    actionability: githubPullRequestActionabilitySchema.optional()
  })
  .strict()
  .superRefine((facts, context) => {
    const authoredActionRequired =
      facts.taskKind === "authored_pull_request" &&
      facts.actionability?.actionRequired === true;
    const expected =
      facts.taskKind === "assigned_issue"
        ? {
            objectType: "issue",
            relationship: "assigned_to_user",
            semanticRole: "direct_work_item",
            eligibilityLimit: "none",
            draftState: "not_applicable"
          }
        : facts.taskKind === "review_requested_pull_request"
          ? {
              objectType: "pull_request",
              relationship: "review_requested_from_user",
              semanticRole: "direct_work_item",
              eligibilityLimit: "draft_state_unknown",
              draftState: "unknown"
            }
          : authoredActionRequired
            ? {
                objectType: "pull_request",
                relationship: "authored_by_user",
                semanticRole: "direct_work_item",
                eligibilityLimit: "none",
                draftState: facts.actionability?.draft ? "draft" : "ready"
              }
            : {
              objectType: "pull_request",
              relationship: "authored_by_user",
              semanticRole: "context_only",
              eligibilityLimit: "not_actionable_by_source_kind",
              draftState:
                facts.actionability === undefined
                  ? "unknown"
                  : facts.actionability.draft
                    ? "draft"
                    : "ready"
            };

    if (
      (facts.taskKind === "assigned_issue" &&
        facts.actionability !== undefined) ||
      (facts.actionability !== undefined &&
        facts.taskKind !== "authored_pull_request")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actionability"],
        message: "Only authored pull requests may carry actionability facts."
      });
    }

    for (const [key, value] of Object.entries(expected)) {
      if (facts[key as keyof typeof facts] !== value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${facts.taskKind} requires ${key}=${value}.`
        });
      }
    }
  });

const githubDeadlineFactsSchema = z
  .object({
    deadlineAt: timestampSchema,
    deadlineKind: z.literal("milestone_due_at"),
    taskKind: z.enum([
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ]),
    semanticRole: z.enum(["direct_work_item", "context_only"]),
    eligibilityLimit: z.enum([
      "none",
      "draft_state_unknown",
      "not_actionable_by_source_kind"
    ])
  })
  .strict()
  .superRefine((facts, context) => {
    const expected =
      facts.taskKind === "assigned_issue"
        ? {
            semanticRole: "direct_work_item",
            eligibilityLimit: "none"
          }
        : facts.taskKind === "review_requested_pull_request"
          ? {
              semanticRole: "direct_work_item",
              eligibilityLimit: "draft_state_unknown"
            }
          : {
              semanticRole: "context_only",
              eligibilityLimit: "not_actionable_by_source_kind"
            };
    for (const [key, value] of Object.entries(expected)) {
      if (facts[key as keyof typeof facts] !== value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${facts.taskKind} requires ${key}=${value}.`
        });
      }
    }
  });

const githubActivityFactsShape = {
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
    "pull_request_review_commented"
  ]),
  repositoryFullName: z.string().min(1).max(240),
  subjectType: z.enum([
    "repository",
    "branch",
    "tag",
    "issue",
    "pull_request"
  ]),
  subjectNumber: z.number().int().positive().nullable(),
  subjectTitle: z.string().min(1).max(240).nullable(),
  refName: z.string().min(1).max(240).nullable(),
  reviewState: z
    .enum(["approved", "changes_requested", "commented"])
    .nullable(),
  semanticRole: z.literal("activity_only")
};

const legacyGitHubActivityFactsSchema = z
  .object({
    ...githubActivityFactsShape,
    artifactId: z.never().optional()
  })
  .strict();

const githubActivityV4FactsSchema = z
  .object({
    ...githubActivityFactsShape,
    artifactId: z.string().regex(/^artifact_[a-f0-9]{32}$/).nullable()
  })
  .strict()
  .superRefine((facts, context) => {
    if (
      (facts.activityKind === "push") !==
      (facts.artifactId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactId"],
        message:
          "GitHub v4 pushes require an opaque artifact ID and other activities require null."
      });
    }
  });

const githubActivityV5FactsSchema = z
  .object({
    ...githubActivityFactsShape,
    artifactId: z.string().regex(/^artifact_[a-f0-9]{32}$/).nullable(),
    nativeSubjectId: z
      .string()
      .regex(/^github:object:[1-9][0-9]*$/)
      .nullable()
  })
  .strict()
  .superRefine((facts, context) => {
    if (
      (facts.activityKind === "push") !==
      (facts.artifactId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactId"],
        message:
          "GitHub v5 pushes require an opaque artifact ID and other activities require null."
      });
    }
    const hasWorkItemSubject =
      facts.subjectType === "issue" ||
      facts.subjectType === "pull_request";
    if (hasWorkItemSubject !== (facts.nativeSubjectId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nativeSubjectId"],
        message:
          "GitHub v5 work-item activity requires an exact native subject identity."
      });
    }
  });

const githubActivityFactsSchema = z.union([
  githubActivityV5FactsSchema,
  githubActivityV4FactsSchema,
  legacyGitHubActivityFactsSchema
]);

const codexConversationReasonCodeSchema = z.enum([
  "CONTENT_MODE_DISABLED",
  "OUTSIDE_RAW_RETENTION_WINDOW",
  "THREAD_READ_LIMIT",
  "THREAD_READ_FAILED",
  "THREAD_RESPONSE_INVALID",
  "THREAD_CHANGED_DURING_READ",
  "TURN_LIMIT",
  "ITEM_LIMIT",
  "FIELD_BYTE_LIMIT",
  "THREAD_BYTE_LIMIT",
  "UNSUPPORTED_ITEM",
  "REASONING_EXCLUDED_BY_POLICY"
]);

const codexExecutionObservationFactsSchema = z
  .object({
    observationMode: z.literal("inventory_only"),
    liveObservationAvailable: z.literal(false),
    executionState: z.literal("unknown"),
    executionStateReason: z.literal(
      "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE"
    ),
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
    projectSemanticRole: z.literal("display_only_unresolved"),
    taskSummary: z.string().min(1).max(200).nullable(),
    taskSummarySource: z
      .enum(["thread_name", "first_user_request"])
      .nullable(),
    taskSummarySemanticRole: z.literal("display_only_unknown"),
    contentMode: z.enum([
      "metadata_only",
      "activity_summary",
      "conversation_and_execution"
    ]),
    conversationCollectionState: z.enum([
      "not_collected",
      "complete",
      "partial",
      "stale",
      "failed",
      "expired"
    ]),
    conversationContentAvailable: z.boolean(),
    historicalContextCompleteness: z.enum([
      "not_collected",
      "complete",
      "partial",
      "unavailable"
    ]),
    historicalTurnStatus: z.enum([
      "completed",
      "failed",
      "interrupted",
      "in_progress",
      "unknown"
    ]),
    historicalStatusSemanticRole: z.literal(
      "persisted_history_only"
    ),
    conversationSourceUpdatedAt: timestampSchema.nullable(),
    contentCollectedAt: timestampSchema.nullable(),
    contentExpiresAt: timestampSchema.nullable(),
    latestTurnCompletedAt: timestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
    userPromptCount: z.number().int().nonnegative(),
    agentResponseCount: z.number().int().nonnegative(),
    commandExecutionCount: z.number().int().nonnegative(),
    failedCommandCount: z.number().int().nonnegative(),
    fileChangeCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    omittedReasoningItemCount: z.number().int().nonnegative(),
    omittedUnsupportedItemCount: z.number().int().nonnegative(),
    contentTruncated: z.boolean(),
    contentReasonCodes: z.array(codexConversationReasonCodeSchema),
    latestUserPromptExcerpt: z.string().min(1).max(200).nullable(),
    latestAgentResponseExcerpt: z
      .string()
      .min(1)
      .max(200)
      .nullable(),
    latestExecutionSummary: z.string().min(1).max(200).nullable(),
    contentSemanticRole: z.literal("historical_context_only"),
    contentPrivacyBoundary: z.literal(
      "sanitized_manifest_only"
    ),
    destinationUrl: z.null()
  })
  .strict()
  .superRefine((facts, context) => {
    if (
      (facts.taskSummary === null) !==
      (facts.taskSummarySource === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["taskSummary"],
        message: "Codex summary and source must be present together."
      });
    }
    const expectedSemanticState =
      facts.nativeActivityState === "idle"
        ? "idle"
        : facts.nativeActivityState === "not_loaded"
          ? "not_loaded"
          : "unknown";
    if (facts.semanticState !== expectedSemanticState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semanticState"],
        message:
          "Historical Codex context cannot infer current running, failure, or completion state."
      });
    }
    const contentMetadataPresent = [
      facts.conversationSourceUpdatedAt,
      facts.contentCollectedAt,
      facts.contentExpiresAt
    ].every((value) => value !== null);
    if (
      facts.conversationContentAvailable !==
      contentMetadataPresent
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationContentAvailable"],
        message:
          "Historical content availability and collection timestamps must agree."
      });
    }
    if (
      facts.failedCommandCount > facts.commandExecutionCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failedCommandCount"],
        message:
          "Failed Codex command count cannot exceed command count."
      });
    }
    if (
      facts.contentMode !== "conversation_and_execution" &&
      (facts.conversationCollectionState !== "not_collected" ||
        facts.conversationContentAvailable ||
        facts.historicalContextCompleteness !==
          "not_collected" ||
        facts.historicalTurnStatus !== "unknown" ||
        facts.turnCount !== 0 ||
        facts.userPromptCount !== 0 ||
        facts.agentResponseCount !== 0 ||
        facts.commandExecutionCount !== 0 ||
        facts.failedCommandCount !== 0 ||
        facts.fileChangeCount !== 0 ||
        facts.toolCallCount !== 0 ||
        facts.latestUserPromptExcerpt !== null ||
        facts.latestAgentResponseExcerpt !== null ||
        facts.latestExecutionSummary !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentMode"],
        message:
          "Historical Codex context must remain absent unless explicitly enabled."
      });
    }
    if (
      !facts.conversationContentAvailable &&
      (facts.turnCount > 0 ||
        facts.userPromptCount > 0 ||
        facts.agentResponseCount > 0 ||
        facts.commandExecutionCount > 0 ||
        facts.failedCommandCount > 0 ||
        facts.fileChangeCount > 0 ||
        facts.toolCallCount > 0 ||
        facts.latestUserPromptExcerpt !== null ||
        facts.latestAgentResponseExcerpt !== null ||
        facts.latestExecutionSummary !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversationContentAvailable"],
        message:
          "Historical counts and sanitized excerpts require collected content."
      });
    }
    const expectedCompleteness =
      facts.conversationCollectionState === "not_collected"
        ? "not_collected"
        : facts.conversationCollectionState === "complete"
          ? facts.contentTruncated
            ? "partial"
            : "complete"
          : facts.conversationCollectionState === "partial" ||
              facts.conversationCollectionState === "stale"
            ? "partial"
            : "unavailable";
    if (
      facts.historicalContextCompleteness !==
      expectedCompleteness
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["historicalContextCompleteness"],
        message:
          "Historical context completeness must match the collection manifest."
      });
    }
  });

export const githubWorkItemSignalSchema = z
  .object({
    ...workSignalBase,
    source: z.literal("github"),
    normalizerVersion: z.enum([
      GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
    ]),
    subjectType: z.literal("work_item"),
    kind: z.literal("work_item_observation"),
    facts: githubWorkItemFactsSchema,
    evidence: z
      .array(
        z.union([
          githubQueryMembershipEvidenceSchema,
          githubObjectFieldEvidenceSchema
        ])
      )
      .min(1)
  })
  .strict();

export const githubDeadlineSignalSchema = z
  .object({
    ...workSignalBase,
    source: z.literal("github"),
    normalizerVersion: z.enum([
      GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
    ]),
    subjectType: z.literal("work_item"),
    kind: z.literal("deadline_observation"),
    facts: githubDeadlineFactsSchema,
    evidence: z
      .array(
        z.union([
          githubQueryMembershipEvidenceSchema,
          githubObjectFieldEvidenceSchema
        ])
      )
      .min(2)
  })
  .strict();

export const githubActivitySignalSchema = z
  .object({
    ...workSignalBase,
    source: z.literal("github"),
    normalizerVersion: z.enum([
      GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION,
      GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
    ]),
    subjectType: z.literal("source_activity"),
    kind: z.literal("activity_observation"),
    facts: githubActivityFactsSchema,
    evidence: z.array(githubActivityEvidenceSchema).length(1)
  })
  .strict();

export const codexExecutionObservationSignalSchema = z
  .object({
    ...workSignalBase,
    source: z.literal("codex"),
    normalizerVersion: z.literal(
      CODEX_WORK_SIGNAL_NORMALIZER_VERSION
    ),
    subjectType: z.literal("execution"),
    kind: z.literal("execution_observation"),
    facts: codexExecutionObservationFactsSchema,
    evidence: z.array(codexSessionFieldEvidenceSchema).min(1)
  })
  .strict();

export const runtimeWorkSignalSchema = z
  .discriminatedUnion("kind", [
    githubWorkItemSignalSchema,
    githubDeadlineSignalSchema,
    githubActivitySignalSchema,
    codexExecutionObservationSignalSchema
  ])
  .superRefine((signal, context) => {
    if (
      signal.validUntil !== null &&
      Date.parse(signal.validUntil) <= Date.parse(signal.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "validUntil must be later than observedAt."
      });
    }
    signal.evidence.forEach((evidence, index) => {
      if (
        evidence.source !== signal.source ||
        evidence.subjectId !== signal.subjectId ||
        evidence.snapshotSha256 !== signal.sourceSnapshotSha256 ||
        evidence.observedAt !== signal.observedAt
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index],
          message:
            "Evidence source, subject, snapshot, and observation must match the signal."
        });
      }
    });
    if (
      signal.source === "codex" &&
      signal.attentionCapability !== "overview_only"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attentionCapability"],
        message:
          "Codex inventory and historical context are overview-only."
      });
    }
    if (
      signal.kind === "work_item_observation" &&
      signal.normalizerVersion ===
        GITHUB_WORK_SIGNAL_NORMALIZER_VERSION &&
      signal.facts.actionability !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["facts", "actionability"],
        message: "Legacy GitHub signals cannot contain v3 actionability facts."
      });
    }
    if (signal.kind === "activity_observation") {
      const hasArtifactFact = "artifactId" in signal.facts;
      const usesPushArtifactNormalizer =
        signal.normalizerVersion ===
          GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION ||
        signal.normalizerVersion ===
          GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION ||
        signal.normalizerVersion ===
          GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION;
      if (hasArtifactFact !== usesPushArtifactNormalizer) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facts", "artifactId"],
          message:
            "GitHub activity artifact facts must match the snapshot normalizer version."
        });
      }
      const hasNativeSubjectFact = "nativeSubjectId" in signal.facts;
      const usesNativeSubjectNormalizer =
        signal.normalizerVersion ===
          GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION ||
        signal.normalizerVersion ===
        GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION;
      if (hasNativeSubjectFact !== usesNativeSubjectNormalizer) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["facts", "nativeSubjectId"],
          message:
            "GitHub activity native subject facts must match the snapshot normalizer version."
        });
      }
    }
    if (
      signal.kind === "work_item_observation" &&
      signal.facts.semanticRole === "context_only" &&
      signal.attentionCapability !== "overview_only"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attentionCapability"],
        message: "Context-only GitHub work cannot be candidate input."
      });
    }
    if (
      signal.kind === "work_item_observation" &&
      signal.facts.taskKind === "authored_pull_request" &&
      signal.facts.actionability?.actionRequired === true &&
      signal.attentionCapability !== "candidate_input"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attentionCapability"],
        message:
          "Verified actionable authored pull requests must be candidate input."
      });
    }
    if (
      signal.kind === "deadline_observation" &&
      signal.facts.semanticRole === "context_only" &&
      signal.attentionCapability !== "overview_only"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attentionCapability"],
        message:
          "A context-only GitHub deadline cannot be candidate input."
      });
    }

    const expectedNativeId =
      signal.source === "codex"
        ? signal.subjectId.match(
            /^codex:execution:([a-f0-9]{24})$/
          )?.[1] ?? null
        : signal.kind === "activity_observation"
          ? signal.subjectId.startsWith("github:activity:")
            ? signal.subjectId.slice("github:activity:".length)
            : null
          : signal.subjectId.match(
              /^github:object:([1-9][0-9]*)$/
            )?.[1] ?? null;
    if (expectedNativeId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subjectId"],
        message:
          "Runtime subjectId must use the source-specific opaque identity format."
      });
    }
    signal.evidence.forEach((evidence, index) => {
      const evidenceNativeId =
        evidence.type === "github_query_membership" ||
        evidence.type === "github_object_field"
          ? evidence.objectId
          : evidence.type === "github_activity_record"
            ? evidence.activityId
            : evidence.sessionId;
      if (
        expectedNativeId !== null &&
        evidenceNativeId !== expectedNativeId
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence", index],
          message:
            "Evidence native identity must match the signal subject."
        });
      }
    });
    if (
      signal.kind === "work_item_observation" &&
      !signal.evidence.some(
        (evidence) =>
          evidence.type === "github_query_membership"
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message:
          "GitHub work-item meaning requires query-membership evidence."
      });
    }
    if (signal.kind === "work_item_observation") {
      const expectedQueryKind = githubQueryKindForTaskKind(
        signal.facts.taskKind
      );
      if (
        !signal.evidence.some(
          (evidence) =>
            evidence.type === "github_query_membership" &&
            evidence.queryKind === expectedQueryKind
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message:
            "GitHub work-item facts require matching query membership."
        });
      }
      if (
        !signal.evidence.some(
          (evidence) =>
            evidence.type === "github_object_field" &&
            evidence.field === "state"
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message:
            "GitHub work-item state requires native state evidence."
        });
      }
      if (signal.facts.actionability !== undefined) {
        const evidenceFields = new Set(
          signal.evidence
            .filter(
              (evidence) => evidence.type === "github_object_field"
            )
            .map((evidence) => evidence.field)
        );
        for (const requiredField of [
          "collection_state",
          "draft",
          "review_decision",
          "checks_summary",
          "mergeable",
          "merge_conflict",
          "unresolved_change_request_count",
          "requested_reviewer_count",
          "action_required",
          "action_required_reasons"
        ] as const) {
          if (!evidenceFields.has(requiredField)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["evidence"],
              message: `GitHub PR actionability requires ${requiredField} evidence.`
            });
          }
        }
      }
    }
    if (signal.kind === "deadline_observation") {
      const expectedQueryKind = githubQueryKindForTaskKind(
        signal.facts.taskKind
      );
      const hasMatchingMembership = signal.evidence.some(
        (evidence) =>
          evidence.type === "github_query_membership" &&
          evidence.queryKind === expectedQueryKind
      );
      const hasMilestoneEvidence = signal.evidence.some(
        (evidence) =>
          evidence.type === "github_object_field" &&
          evidence.field === "milestone_due_at"
      );
      if (!hasMatchingMembership || !hasMilestoneEvidence) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message:
            "GitHub deadline facts require matching membership and milestone evidence."
        });
      }
    }
    if (signal.kind === "execution_observation") {
      const evidenceFields = new Set(
        signal.evidence.map((evidence) => evidence.field)
      );
      if (!evidenceFields.has("activity_state")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message:
            "Codex execution observation requires activity-state evidence."
        });
      }
      if (
        signal.facts.nativeAttentionState !== null &&
        !evidenceFields.has("attention_state")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message:
            "Codex attention badge requires attention-state evidence."
        });
      }
      if (
        signal.facts.taskSummary !== null &&
        (!evidenceFields.has("task_summary") ||
          !evidenceFields.has("task_summary_source"))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message:
            "Codex display summary requires summary and source evidence."
        });
      }
      for (const requiredField of [
        "content_mode",
        "content_state",
        "historical_turn_status",
        "turn_count",
        "user_prompt_count",
        "agent_response_count",
        "command_execution_count",
        "failed_command_count",
        "file_change_count",
        "tool_call_count",
        "content_truncated",
        "content_reason_codes"
      ] as const) {
        if (!evidenceFields.has(requiredField)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["evidence"],
            message: `Codex historical manifest requires ${requiredField} evidence.`
          });
        }
      }
      for (const [value, requiredField] of [
        [
          signal.facts.latestUserPromptExcerpt,
          "latest_user_prompt_excerpt"
        ],
        [
          signal.facts.latestAgentResponseExcerpt,
          "latest_agent_response_excerpt"
        ],
        [
          signal.facts.latestExecutionSummary,
          "latest_execution_summary"
        ]
      ] as const) {
        if (value !== null && !evidenceFields.has(requiredField)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["evidence"],
            message: `Sanitized Codex context requires ${requiredField} evidence.`
          });
        }
      }
    }
  });

export const normalizationIssueSchema = z
  .object({
    code: normalizationIssueCodeSchema,
    subjectId: z.string().min(1).max(240).nullable(),
    recordSha256: sha256Schema.nullable()
  })
  .strict();

export const runtimeWorkSignalBatchSchema = z
  .object({
    contract: z.literal(RUNTIME_WORK_SIGNAL_BATCH_CONTRACT),
    source: runtimeSourceSchema,
    sourceSchemaVersion: z.string().min(1).max(120),
    collectorVersion: z.string().min(1).max(120),
    normalizerVersion: z.string().min(1).max(120),
    workSignalContract: z.literal(RUNTIME_WORK_SIGNAL_CONTRACT),
    sourceSnapshotSha256: sha256Schema,
    normalizationInputSha256: sha256Schema,
    batchSha256: sha256Schema,
    assessment: snapshotAssessmentSchema,
    signalCount: z.number().int().nonnegative(),
    skippedRecordCount: z.number().int().nonnegative(),
    issues: z.array(normalizationIssueSchema),
    signals: z.array(runtimeWorkSignalSchema)
  })
  .strict()
  .superRefine((batch, context) => {
    if (batch.source !== batch.assessment.source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assessment", "source"],
        message: "Batch and assessment sources must match."
      });
    }
    const expectedNormalizerVersion =
      batch.source === "github"
        ? batch.sourceSchemaVersion === "github-snapshot-v6"
          ? GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION
          : batch.sourceSchemaVersion === "github-snapshot-v5"
            ? GITHUB_NATIVE_ACTIVITY_PREVIOUS_WORK_SIGNAL_NORMALIZER_VERSION
            : batch.sourceSchemaVersion === "github-snapshot-v4"
              ? GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION
              : batch.sourceSchemaVersion === "github-snapshot-v3"
                ? GITHUB_ACTIONABILITY_WORK_SIGNAL_NORMALIZER_VERSION
                : GITHUB_WORK_SIGNAL_NORMALIZER_VERSION
        : CODEX_WORK_SIGNAL_NORMALIZER_VERSION;
    if (batch.normalizerVersion !== expectedNormalizerVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["normalizerVersion"],
        message:
          "Batch source and current normalizer version must match."
      });
    }
    if (batch.signalCount !== batch.signals.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signalCount"],
        message: "signalCount must match signals.length."
      });
    }
    if (
      !batch.assessment.usableForOverview &&
      batch.signals.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signals"],
        message:
          "A snapshot unusable for overview cannot emit runtime signals."
      });
    }
    batch.signals.forEach((signal, index) => {
      if (
        signal.source !== batch.source ||
        signal.sourceSnapshotSha256 !==
          batch.sourceSnapshotSha256 ||
        signal.normalizerVersion !== batch.normalizerVersion ||
        signal.observedAt !== batch.assessment.fetchedAt
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["signals", index],
          message:
            "Signal source, snapshot, normalizer, and observation time must match the batch."
        });
      }
    });
  });

export type RuntimeSource = z.infer<typeof runtimeSourceSchema>;
export type FreshnessPolicy = z.infer<typeof freshnessPolicySchema>;
export type SnapshotAssessment = z.infer<
  typeof snapshotAssessmentSchema
>;
export type RuntimeSourceEvidence = z.infer<
  typeof runtimeSourceEvidenceSchema
>;
export type RuntimeWorkSignal = z.infer<
  typeof runtimeWorkSignalSchema
>;
export type RuntimeWorkSignalBatch = z.infer<
  typeof runtimeWorkSignalBatchSchema
>;
export type NormalizationIssue = z.infer<
  typeof normalizationIssueSchema
>;

function githubQueryKindForTaskKind(
  taskKind:
    | "assigned_issue"
    | "review_requested_pull_request"
    | "authored_pull_request"
):
  | "assigned_open_issue"
  | "review_requested_open_pr"
  | "authored_open_pr" {
  switch (taskKind) {
    case "assigned_issue":
      return "assigned_open_issue";
    case "review_requested_pull_request":
      return "review_requested_open_pr";
    case "authored_pull_request":
      return "authored_open_pr";
  }
}
