import { z } from "zod";

import {
  CODEX_WORK_SIGNAL_NORMALIZER_VERSION,
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
  "CODEX_OVERVIEW_ONLY"
]);

export const normalizationIssueCodeSchema = z.enum([
  "SNAPSHOT_FROM_FUTURE",
  "SNAPSHOT_STALE",
  "SNAPSHOT_TRUNCATED",
  "GITHUB_ACTIVITIES_PARTIAL",
  "GITHUB_ACTIVITIES_UNAVAILABLE",
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
      "updated_at"
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
      "content_mode"
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
  projectId: z.null(),
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
    draftState: z.enum(["unknown", "not_applicable"]),
    repositoryFullName: z.string().min(1).max(240),
    number: z.number().int().positive(),
    title: z.string().min(1).max(240),
    destinationUrl: z.string().url().nullable()
  })
  .strict()
  .superRefine((facts, context) => {
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
          : {
              objectType: "pull_request",
              relationship: "authored_by_user",
              semanticRole: "context_only",
              eligibilityLimit: "not_actionable_by_source_kind",
              draftState: "unknown"
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
  })
  .strict();

const codexExecutionObservationFactsSchema = z
  .object({
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
          "Current Codex v2 cannot infer running, failure, or completion."
      });
    }
  });

export const githubWorkItemSignalSchema = z
  .object({
    ...workSignalBase,
    source: z.literal("github"),
    normalizerVersion: z.literal(
      GITHUB_WORK_SIGNAL_NORMALIZER_VERSION
    ),
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
    normalizerVersion: z.literal(
      GITHUB_WORK_SIGNAL_NORMALIZER_VERSION
    ),
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
    normalizerVersion: z.literal(
      GITHUB_WORK_SIGNAL_NORMALIZER_VERSION
    ),
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
        message: "Current Codex v2 is overview-only."
      });
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
        ? GITHUB_WORK_SIGNAL_NORMALIZER_VERSION
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
