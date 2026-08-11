import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
  RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT,
  RECENT_MEANINGFUL_EVENT_RULE_VERSION,
  RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION
} from "../crossSource/versions";

export const MAX_RECENT_MEANINGFUL_EVENTS = 1_000;
export const MAX_RECENT_EVENT_DIAGNOSTICS = 2_000;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const projectIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/);
const eventIdSchema = z.string().regex(/^recent_event_[a-f0-9]{32}$/);
const eventSubjectRefSchema = z
  .string()
  .regex(/^focus_subject_[a-f0-9]{32}$/);
const eventEvidenceRefSchema = z
  .string()
  .regex(/^focus_evidence_[a-f0-9]{32}$/);
export const focusIdentityRefSchema = z
  .string()
  .regex(/^focus_identity_[a-f0-9]{32}$/);
const claimTargetRefSchema = z
  .string()
  .regex(/^claim_subject_[a-f0-9]{32}$/);
const relationRefSchema = z.union([
  z.string().regex(/^relation_[a-f0-9]{32}$/),
  z.string().regex(/^artifact_relation_[a-f0-9]{32}$/)
]);

export const recentMeaningfulEventSourceSchema = z.enum([
  "github",
  "codex_managed",
  "codex_inventory"
]);

export const recentMeaningfulEventKindSchema = z.enum([
  "github_push",
  "github_issue_opened",
  "github_issue_closed",
  "github_issue_reopened",
  "github_pull_request_opened",
  "github_pull_request_closed",
  "github_pull_request_reopened",
  "github_pull_request_merged",
  "github_review_submitted",
  "github_changes_requested",
  "github_ci_failed",
  "github_merge_conflict",
  "codex_run_started",
  "codex_turn_started",
  "codex_turn_completed",
  "codex_turn_failed",
  "codex_turn_interrupted",
  "codex_run_failed",
  "codex_run_closed",
  "codex_waiting_approval",
  "codex_waiting_user_input",
  "codex_project_activity"
]);

export const recentEventSemanticRoleSchema = z.enum([
  "current_state",
  "meaningful_progress",
  "blocker",
  "completion",
  "historical_context"
]);

export const recentEventExclusionReasonSchema = z.enum([
  "INCLUDED_MEANINGFUL_DIRECT_EVENT",
  "CONTEXT_ONLY_CODEX_INVENTORY",
  "EXCLUDED_HEARTBEAT_OR_STREAM_NOISE",
  "EXCLUDED_POLL_OR_LIST_LOAD",
  "EXCLUDED_GENERIC_UPDATED_AT",
  "EXCLUDED_UNSUPPORTED_ACTIVITY_KIND",
  "EXCLUDED_DUPLICATE_EVENT",
  "EXCLUDED_REPEATED_ERROR_OBSERVATION",
  "EXCLUDED_UNSUPPORTED_TRANSITION_TIMESTAMP",
  "EXCLUDED_MANAGED_ITEM_OUTCOME_UNKNOWN",
  "EXCLUDED_IDENTITY_INCOMPLETE",
  "EXCLUDED_FUTURE_EVENT_TIME",
  "EXCLUDED_OUTSIDE_RETENTION_WINDOW"
]);

const recentMeaningfulEventContentSchema = z
  .object({
    contract: z.literal(RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION),
    ruleVersion: z.literal(RECENT_MEANINGFUL_EVENT_RULE_VERSION),
    idPolicyVersion: z.literal(
      RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION
    ),
    eventId: eventIdSchema,
    source: recentMeaningfulEventSourceSchema,
    nativeSubjectRef: eventSubjectRefSchema,
    projectId: projectIdSchema.nullable(),
    identityScope: z.enum(["exact_task", "project"]),
    identityRefs: z.array(focusIdentityRefSchema).min(1).max(20),
    claimTargetRefs: z.array(claimTargetRefSchema).max(20),
    relationRefs: z.array(relationRefSchema).max(20),
    kind: recentMeaningfulEventKindSchema,
    occurredAt: timestampSchema,
    observedAt: timestampSchema,
    sourceUpdatedAt: timestampSchema.nullable(),
    timeBasis: z.enum([
      "source_occurred_at",
      "source_updated_state_observation",
      "collector_observed_at",
      "inventory_updated_at"
    ]),
    freshness: z.enum(["current", "stale", "unknown"]),
    completeness: z.enum(["complete", "partial", "unknown"]),
    currentness: z.enum([
      "current",
      "stale",
      "partial",
      "historical_only",
      "unknown"
    ]),
    semanticRole: recentEventSemanticRoleSchema,
    attentionCapability: z.enum([
      "focus_selector",
      "historical_context_only"
    ]),
    displayLabel: z.string().min(1).max(240),
    evidenceRef: eventEvidenceRefSchema,
    sourceSnapshotSha256: sha256Schema,
    sourceBatchSha256: sha256Schema.nullable(),
    normalizerVersion: z.string().min(1).max(120),
    reasonCodes: z
      .array(recentEventExclusionReasonSchema)
      .min(1)
      .max(8)
  })
  .strict();

export const recentMeaningfulEventSchema =
  recentMeaningfulEventContentSchema
    .extend({ eventSha256: sha256Schema })
    .strict()
    .superRefine((event, context) => {
      if (event.eventSha256 !== recentMeaningfulEventSha256(event)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["eventSha256"],
          message: "Recent event hash does not match canonical content."
        });
      }
      if (
        !isCanonicalUnique(event.identityRefs) ||
        !isCanonicalUnique(event.claimTargetRefs) ||
        !isCanonicalUnique(event.relationRefs) ||
        !isCanonicalUnique(event.reasonCodes)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recent event references must be canonical and unique."
        });
      }
      if (
        event.source === "codex_inventory" &&
        (event.semanticRole !== "historical_context" ||
          event.attentionCapability !== "historical_context_only" ||
          event.currentness !== "historical_only")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Codex inventory is historical context only."
        });
      }
      if (
        event.timeBasis === "collector_observed_at" &&
        (event.occurredAt !== event.observedAt ||
          event.sourceUpdatedAt !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timeBasis"],
          message:
            "Collector-observed events cannot claim a native update time."
        });
      }
    });

export const recentEventDiagnosticSchema = z
  .object({
    diagnosticId: z
      .string()
      .regex(/^event_diagnostic_[a-f0-9]{32}$/),
    source: recentMeaningfulEventSourceSchema,
    observationRef: eventSubjectRefSchema,
    eventId: eventIdSchema.nullable(),
    disposition: z.enum(["included", "excluded", "context_only"]),
    reasonCode: recentEventExclusionReasonSchema
  })
  .strict();

export const recentEventDependenciesSchema = z
  .object({
    githubBatchSha256: sha256Schema.nullable(),
    githubSourceSnapshotSha256: sha256Schema.nullable(),
    codexInventoryBatchSha256: sha256Schema.nullable(),
    codexInventorySourceSnapshotSha256: sha256Schema.nullable(),
    managedPublicProjectionSha256: sha256Schema,
    managedRunStartedAtByIdSha256: sha256Schema,
    managedSourceRevision: z.number().int().nonnegative(),
    managedGeneratedAt: timestampSchema,
    managedSemanticProjectionSha256: sha256Schema,
    workRelationProjectionSha256: sha256Schema,
    artifactRelationProjectionSha256: sha256Schema,
    claimAuthorityProjectionSha256: sha256Schema,
    contextRegistrySha256: sha256Schema.nullable()
  })
  .strict();

const recentMeaningfulEventProjectionContentSchema = z
  .object({
    contract: z.literal(RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT),
    schemaVersion: z.literal(RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION),
    ruleVersion: z.literal(RECENT_MEANINGFUL_EVENT_RULE_VERSION),
    idPolicyVersion: z.literal(
      RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION
    ),
    asOf: timestampSchema,
    dependencies: recentEventDependenciesSchema,
    inputSha256: sha256Schema,
    coverage: z
      .object({
        github: z.enum(["complete", "partial", "stale", "unavailable"]),
        codexManaged: z.enum([
          "complete",
          "partial",
          "unavailable"
        ]),
        codexInventory: z.enum([
          "historical_complete",
          "historical_partial",
          "unavailable"
        ])
      })
      .strict(),
    events: z
      .array(recentMeaningfulEventSchema)
      .max(MAX_RECENT_MEANINGFUL_EVENTS),
    diagnostics: z
      .array(recentEventDiagnosticSchema)
      .max(MAX_RECENT_EVENT_DIAGNOSTICS),
    counts: z
      .object({
        included: z.number().int().nonnegative(),
        contextOnly: z.number().int().nonnegative(),
        excluded: z.number().int().nonnegative(),
        duplicate: z.number().int().nonnegative(),
        omittedMeaningfulEventCount: z.number().int().nonnegative(),
        omittedDiagnosticCount: z.number().int().nonnegative()
      })
      .strict(),
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const recentMeaningfulEventProjectionSchema =
  recentMeaningfulEventProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.projectionSha256 !==
        recentMeaningfulEventProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Recent event projection hash is invalid."
        });
      }
      if (
        (projection.counts.omittedMeaningfulEventCount > 0 &&
          projection.events.length !== MAX_RECENT_MEANINGFUL_EVENTS) ||
        (projection.counts.omittedDiagnosticCount > 0 &&
          projection.diagnostics.length !== MAX_RECENT_EVENT_DIAGNOSTICS)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counts"],
          message: "Recent event projection retention counts are incoherent."
        });
      }
      if (
        projection.counts.included !==
          projection.events.filter(
            (event) => event.attentionCapability === "focus_selector"
          ).length ||
        projection.counts.contextOnly !==
          projection.events.filter(
            (event) =>
              event.attentionCapability === "historical_context_only"
          ).length ||
        projection.counts.excluded !==
          projection.diagnostics.filter(
            (diagnostic) => diagnostic.disposition === "excluded"
          ).length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counts"],
          message: "Recent event projection counts are incoherent."
        });
      }
      if (
        new Set(projection.events.map((event) => event.eventId)).size !==
          projection.events.length ||
        projection.events.some(
          (event, index) =>
            index > 0 &&
            compareRecentMeaningfulEvents(
              projection.events[index - 1]!,
              event
            ) > 0
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events"],
          message: "Recent events must be unique and canonically ordered."
        });
      }
    });

export type RecentMeaningfulEvent = z.infer<
  typeof recentMeaningfulEventSchema
>;
export type RecentMeaningfulEventContent = z.infer<
  typeof recentMeaningfulEventContentSchema
>;
export type RecentEventDiagnostic = z.infer<
  typeof recentEventDiagnosticSchema
>;
export type RecentEventDependencies = z.infer<
  typeof recentEventDependenciesSchema
>;
export type RecentMeaningfulEventProjection = z.infer<
  typeof recentMeaningfulEventProjectionSchema
>;
export type RecentMeaningfulEventProjectionContent = z.infer<
  typeof recentMeaningfulEventProjectionContentSchema
>;

export function createFocusIdentityRef(input: unknown): string {
  return runtimeStableId(
    "focus_identity",
    RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    input
  );
}

export function createFocusSubjectRef(input: unknown): string {
  return runtimeStableId(
    "focus_subject",
    RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    input
  );
}

export function createFocusEvidenceRef(input: unknown): string {
  return runtimeStableId(
    "focus_evidence",
    RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    input
  );
}

export function createRecentMeaningfulEventId(input: unknown): string {
  return runtimeStableId(
    "recent_event",
    RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    input
  );
}

export function createRecentEventDiagnosticId(input: unknown): string {
  return runtimeStableId(
    "event_diagnostic",
    RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    input
  );
}

export function sealRecentMeaningfulEvent(
  content: RecentMeaningfulEventContent
): RecentMeaningfulEvent {
  return recentMeaningfulEventSchema.parse({
    ...content,
    eventSha256: runtimeSha256({
      domain: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
      event: content
    })
  });
}

export function recentMeaningfulEventSha256(
  event: RecentMeaningfulEvent
): string {
  const { eventSha256: _eventSha256, ...content } = event;
  return runtimeSha256({
    domain: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    event: content
  });
}

export function sealRecentMeaningfulEventProjection(
  content: RecentMeaningfulEventProjectionContent
): RecentMeaningfulEventProjection {
  return recentMeaningfulEventProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function recentMeaningfulEventProjectionSha256(
  projection: RecentMeaningfulEventProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT,
    projection: content
  });
}

export function compareRecentMeaningfulEvents(
  left: Pick<RecentMeaningfulEvent, "occurredAt" | "source" | "kind" | "eventId">,
  right: Pick<RecentMeaningfulEvent, "occurredAt" | "source" | "kind" | "eventId">
): number {
  return (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    compareRuntimeStrings(left.source, right.source) ||
    compareRuntimeStrings(left.kind, right.kind) ||
    compareRuntimeStrings(left.eventId, right.eventId)
  );
}

function isCanonicalUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.join("|") === [...values].sort(compareRuntimeStrings).join("|")
  );
}
