import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  CURRENT_FOCUS_ID_POLICY_VERSION,
  CURRENT_FOCUS_PROJECTION_CONTRACT,
  CURRENT_FOCUS_SCHEMA_VERSION,
  CURRENT_FOCUS_SELECTION_POLICY_VERSION,
  CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
  CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION,
  CURRENT_WORKSTREAM_ID_POLICY_VERSION,
  CURRENT_WORKSTREAM_PROJECTION_CONTRACT,
  CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION,
  CURRENT_WORKSTREAM_SCHEMA_VERSION,
  FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION,
  FOCUS_AWARE_ATTENTION_SHADOW_PROJECTION_CONTRACT,
  FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION,
  FOCUS_AWARE_ATTENTION_SHADOW_SCHEMA_VERSION
} from "../crossSource/versions";
import {
  focusIdentityRefSchema,
  recentMeaningfulEventSchema
} from "../recentEvents/contracts";

export const CURRENT_FOCUS_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_CURRENT_WORKSTREAMS = 1_000;
export const MAX_WORKSTREAM_HISTORY_REFS = 12;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const projectIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/);
const eventIdSchema = z.string().regex(/^recent_event_[a-f0-9]{32}$/);
const workstreamIdSchema = z
  .string()
  .regex(/^workstream_[a-f0-9]{32}$/);
const focusIdSchema = z.string().regex(/^focus_[a-f0-9]{32}$/);
const candidateIdSchema = z
  .string()
  .regex(/^attention_[a-f0-9]{32}$/);
const claimTargetRefSchema = z
  .string()
  .regex(/^claim_subject_[a-f0-9]{32}$/);
const relationRefSchema = z.union([
  z.string().regex(/^relation_[a-f0-9]{32}$/),
  z.string().regex(/^artifact_relation_[a-f0-9]{32}$/)
]);

export const currentWorkstreamReasonCodeSchema = z.enum([
  "WORKSTREAM_EXACT_NATIVE_IDENTITY",
  "WORKSTREAM_EXPLICIT_WORK_RELATION",
  "WORKSTREAM_VERIFIED_ARTIFACT_RELATION",
  "WORKSTREAM_PROJECT_LEVEL_ONLY",
  "WORKSTREAM_MANAGED_EXECUTION_IDENTITY",
  "WORKSTREAM_AUTHORITATIVE_STATE_RESOLVED",
  "WORKSTREAM_AUTHORITATIVE_STATE_CONFLICT",
  "WORKSTREAM_SOURCE_STALE",
  "WORKSTREAM_SOURCE_PARTIAL",
  "WORKSTREAM_HISTORICAL_CONTEXT_BOUNDED",
  "WORKSTREAM_TERMINAL_STATE_PRESERVED"
]);

export const currentWorkstreamAuthoritativeStateSchema = z.enum([
  "open",
  "running",
  "idle",
  "failed",
  "interrupted",
  "completed",
  "cancelled",
  "unknown",
  "conflict"
]);

export const currentWorkstreamBlockerSchema = z.enum([
  "none",
  "ci_failed",
  "changes_requested",
  "merge_conflict",
  "codex_failure",
  "waiting_on_approval",
  "waiting_on_user_input",
  "unknown"
]);

export const currentWorkstreamOwnerSchema = z.enum([
  "user",
  "not_user",
  "unknown",
  "conflict"
]);

export const currentWorkstreamCompletionStateSchema = z.enum([
  "active",
  "completed",
  "cancelled",
  "execution_completed",
  "unknown"
]);

export const currentWorkstreamCurrentnessSchema = z.enum([
  "current",
  "stale",
  "partial",
  "historical_only",
  "conflict",
  "unknown"
]);

export const currentWorkstreamCompletenessSchema = z.enum([
  "complete",
  "partial",
  "unknown"
]);

export const currentWorkstreamConfidenceSchema = z.enum([
  "high",
  "medium",
  "low"
]);

export const currentWorkstreamSchema = z
  .object({
    contract: z.literal(CURRENT_WORKSTREAM_SCHEMA_VERSION),
    reconstructionRuleVersion: z.literal(
      CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION
    ),
    currentnessPolicyVersion: z.literal(
      CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION
    ),
    idPolicyVersion: z.literal(CURRENT_WORKSTREAM_ID_POLICY_VERSION),
    workstreamId: workstreamIdSchema,
    projectId: projectIdSchema.nullable(),
    level: z.enum(["exact_task", "project"]),
    displayLabel: z.string().min(1).max(240),
    identityRefs: z.array(focusIdentityRefSchema).min(1).max(100),
    claimTargetRefs: z.array(claimTargetRefSchema).max(100),
    relationEvidenceRefs: z.array(relationRefSchema).max(100),
    relatedSources: z
      .array(z.enum(["github", "codex_managed", "codex_inventory"]))
      .min(1)
      .max(3),
    latestMeaningfulEvent: recentMeaningfulEventSchema,
    historicalEventRefs: z
      .array(eventIdSchema)
      .max(MAX_WORKSTREAM_HISTORY_REFS),
    totalEventCount: z.number().int().positive(),
    omittedHistoricalEventCount: z.number().int().nonnegative(),
    authoritativeState: currentWorkstreamAuthoritativeStateSchema,
    activeBlocker: currentWorkstreamBlockerSchema,
    owner: currentWorkstreamOwnerSchema,
    completionState: currentWorkstreamCompletionStateSchema,
    currentness: currentWorkstreamCurrentnessSchema,
    completeness: currentWorkstreamCompletenessSchema,
    reconstructionConfidence: currentWorkstreamConfidenceSchema,
    reasonCodes: z
      .array(currentWorkstreamReasonCodeSchema)
      .min(1)
      .max(16),
    workstreamSha256: sha256Schema
  })
  .strict()
  .superRefine((workstream, context) => {
    if (workstream.workstreamSha256 !== currentWorkstreamSha256(workstream)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workstreamSha256"],
        message: "WorkStream hash does not match canonical content."
      });
    }
    if (
      !isCanonicalUnique(workstream.identityRefs) ||
      !isCanonicalUnique(workstream.claimTargetRefs) ||
      !isCanonicalUnique(workstream.relationEvidenceRefs) ||
      !isCanonicalUnique(workstream.relatedSources) ||
      !isCanonicalUnique(workstream.reasonCodes) ||
      new Set(workstream.historicalEventRefs).size !==
        workstream.historicalEventRefs.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "WorkStream references must be canonical and unique."
      });
    }
    if (
      workstream.totalEventCount !==
      1 +
        workstream.historicalEventRefs.length +
        workstream.omittedHistoricalEventCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalEventCount"],
        message: "WorkStream history counts are incoherent."
      });
    }
  });

const currentWorkstreamProjectionContentSchema = z
  .object({
    contract: z.literal(CURRENT_WORKSTREAM_PROJECTION_CONTRACT),
    schemaVersion: z.literal(CURRENT_WORKSTREAM_SCHEMA_VERSION),
    reconstructionRuleVersion: z.literal(
      CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION
    ),
    currentnessPolicyVersion: z.literal(
      CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION
    ),
    idPolicyVersion: z.literal(CURRENT_WORKSTREAM_ID_POLICY_VERSION),
    asOf: timestampSchema,
    recentEventProjectionSha256: sha256Schema,
    workRelationProjectionSha256: sha256Schema,
    artifactRelationProjectionSha256: sha256Schema,
    claimAuthorityProjectionSha256: sha256Schema,
    inputSha256: sha256Schema,
    workstreams: z.array(currentWorkstreamSchema).max(MAX_CURRENT_WORKSTREAMS),
    counts: z
      .object({
        exactTask: z.number().int().nonnegative(),
        projectLevel: z.number().int().nonnegative(),
        current: z.number().int().nonnegative(),
        unresolved: z.number().int().nonnegative()
      })
      .strict(),
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const currentWorkstreamProjectionSchema =
  currentWorkstreamProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.projectionSha256 !==
        currentWorkstreamProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "WorkStream projection hash is invalid."
        });
      }
      if (
        projection.counts.exactTask !==
          projection.workstreams.filter(
            (workstream) => workstream.level === "exact_task"
          ).length ||
        projection.counts.projectLevel !==
          projection.workstreams.filter(
            (workstream) => workstream.level === "project"
          ).length ||
        projection.counts.current !==
          projection.workstreams.filter(
            (workstream) => workstream.currentness === "current"
          ).length ||
        projection.counts.unresolved !==
          projection.workstreams.filter((workstream) =>
            ["partial", "conflict", "unknown"].includes(
              workstream.currentness
            )
          ).length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["counts"],
          message: "WorkStream projection counts are incoherent."
        });
      }
      if (
        new Set(
          projection.workstreams.map(
            (workstream) => workstream.workstreamId
          )
        ).size !== projection.workstreams.length ||
        projection.workstreams.some(
          (workstream, index) =>
            index > 0 &&
            compareCurrentWorkstreams(
              projection.workstreams[index - 1]!,
              workstream
            ) > 0
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workstreams"],
          message: "WorkStreams must be unique and canonically ordered."
        });
      }
    });

export const currentFocusReasonCodeSchema = z.enum([
  "FOCUS_EXPLICIT_USER_CONFIRMATION",
  "FOCUS_LATEST_DIRECT_COMPLETE_EVENT",
  "FOCUS_PROJECT_LEVEL_ONLY",
  "FOCUS_NO_MEANINGFUL_EVENT",
  "FOCUS_EVENT_OUTSIDE_RECENT_WINDOW",
  "FOCUS_SOURCE_STALE",
  "FOCUS_SOURCE_PARTIAL",
  "FOCUS_IDENTITY_CONFLICT",
  "FOCUS_AUTHORITY_CONFLICT",
  "FOCUS_LATEST_EVENT_TIE",
  "FOCUS_INSUFFICIENT_IDENTITY",
  "FOCUS_DEPENDENCY_MISMATCH",
  "FOCUS_PROJECTION_UNAVAILABLE"
]);

export const confirmedCurrentFocusInputSchema = z
  .object({
    workstreamId: workstreamIdSchema,
    confirmedAt: timestampSchema,
    validUntil: timestampSchema,
    confirmationSha256: sha256Schema
  })
  .strict();

export const selectedCurrentFocusSchema = z
  .object({
    focusId: focusIdSchema,
    workstreamId: workstreamIdSchema,
    projectId: projectIdSchema.nullable(),
    level: z.enum(["exact_task", "project"]),
    displayLabel: z.string().min(1).max(240),
    identityRefs: z.array(focusIdentityRefSchema).min(1).max(100),
    latestMeaningfulEvent: recentMeaningfulEventSchema,
    authoritativeState: currentWorkstreamAuthoritativeStateSchema,
    activeBlocker: currentWorkstreamBlockerSchema,
    owner: currentWorkstreamOwnerSchema,
    completionState: currentWorkstreamCompletionStateSchema,
    currentness: currentWorkstreamCurrentnessSchema,
    completeness: currentWorkstreamCompletenessSchema,
    reconstructionConfidence: currentWorkstreamConfidenceSchema
  })
  .strict();

export const currentFocusDependenciesSchema = z
  .object({
    recentEventProjectionSha256: sha256Schema.nullable(),
    workstreamProjectionSha256: sha256Schema.nullable(),
    workRelationProjectionSha256: sha256Schema.nullable(),
    artifactRelationProjectionSha256: sha256Schema.nullable(),
    claimAuthorityProjectionSha256: sha256Schema.nullable()
  })
  .strict();

const currentFocusProjectionContentSchema = z
  .object({
    contract: z.literal(CURRENT_FOCUS_PROJECTION_CONTRACT),
    schemaVersion: z.literal(CURRENT_FOCUS_SCHEMA_VERSION),
    selectionPolicyVersion: z.literal(
      CURRENT_FOCUS_SELECTION_POLICY_VERSION
    ),
    idPolicyVersion: z.literal(CURRENT_FOCUS_ID_POLICY_VERSION),
    rolloutVersion: z.literal(CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION),
    asOf: timestampSchema,
    recentWindowMs: z.literal(CURRENT_FOCUS_RECENT_WINDOW_MS),
    dependencies: currentFocusDependenciesSchema,
    inputSha256: sha256Schema,
    status: z.enum(["selected", "unresolved", "unavailable"]),
    selectedFocus: selectedCurrentFocusSchema.nullable(),
    reasonCodes: z.array(currentFocusReasonCodeSchema).min(1).max(12),
    explicitFocusApplied: z.boolean(),
    attentionSelectionEffect: z.literal("none"),
    attentionDisposition: z.literal("shadow_only"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const currentFocusProjectionSchema =
  currentFocusProjectionContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.projectionSha256 !==
        currentFocusProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Current Focus projection hash is invalid."
        });
      }
      if (
        (projection.status === "selected") !==
        (projection.selectedFocus !== null)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selectedFocus"],
          message: "Only a selected projection may contain Current Focus."
        });
      }
      if (!isCanonicalUnique(projection.reasonCodes)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reasonCodes"],
          message: "Current Focus reasons must be canonical and unique."
        });
      }
    });

export const focusCandidateMatchSchema = z
  .object({
    candidateId: candidateIdSchema,
    existingRank: z.number().int().positive(),
    counterfactualRank: z.number().int().positive(),
    match: z.enum(["exact", "project", "none"])
  })
  .strict();

export const focusAwareAttentionShadowReasonCodeSchema = z.enum([
  "SHADOW_EXACT_FOCUS_MATCH",
  "SHADOW_PROJECT_FOCUS_MATCH",
  "SHADOW_NO_FOCUS_AVAILABLE",
  "SHADOW_FOCUS_UNRESOLVED",
  "SHADOW_EXISTING_TOP_PRESERVED",
  "SHADOW_COUNTERFACTUAL_TOP_CHANGED",
  "SHADOW_SAFETY_TIER_PRESERVED",
  "SHADOW_CANDIDATE_UNIVERSE_UNCHANGED",
  "SHADOW_DEPENDENCY_MISMATCH"
]);

const focusAwareAttentionShadowContentSchema = z
  .object({
    contract: z.literal(
      FOCUS_AWARE_ATTENTION_SHADOW_PROJECTION_CONTRACT
    ),
    schemaVersion: z.literal(
      FOCUS_AWARE_ATTENTION_SHADOW_SCHEMA_VERSION
    ),
    rankingPolicyVersion: z.literal(
      FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION
    ),
    resolverVersion: z.literal(
      FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION
    ),
    rolloutVersion: z.literal(CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION),
    asOf: timestampSchema,
    inputSha256: sha256Schema,
    dependencies: z
      .object({
        currentFocusProjectionSha256: sha256Schema,
        activeAttentionResultSha256: sha256Schema,
        eligibilityProjectionSha256: sha256Schema,
        workRelationProjectionSha256: sha256Schema,
        claimAuthorityProjectionSha256: sha256Schema
      })
      .strict(),
    status: z.enum(["evaluated", "not_applied", "unavailable"]),
    existingTopCandidateId: candidateIdSchema.nullable(),
    counterfactualTopCandidateId: candidateIdSchema.nullable(),
    wouldSwitch: z.boolean(),
    matches: z.array(focusCandidateMatchSchema).max(100),
    totalMatchCount: z.number().int().nonnegative(),
    omittedMatchCount: z.number().int().nonnegative(),
    reasonCodes: z
      .array(focusAwareAttentionShadowReasonCodeSchema)
      .min(1)
      .max(12),
    candidateUniverseChanged: z.literal(false),
    eligibilityDiffCount: z.literal(0),
    attentionSelectionEffect: z.literal("none")
  })
  .strict();

export const focusAwareAttentionShadowProjectionSchema =
  focusAwareAttentionShadowContentSchema
    .extend({ projectionSha256: sha256Schema })
    .strict()
    .superRefine((projection, context) => {
      if (
        projection.projectionSha256 !==
        focusAwareAttentionShadowProjectionSha256(projection)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectionSha256"],
          message: "Focus shadow projection hash is invalid."
        });
      }
      if (
        projection.totalMatchCount !==
          projection.matches.length + projection.omittedMatchCount
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["omittedMatchCount"],
          message: "Focus shadow match coverage is incoherent."
        });
      }
      if (
        projection.wouldSwitch !==
        (projection.existingTopCandidateId !==
          projection.counterfactualTopCandidateId)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["wouldSwitch"],
          message: "Focus shadow top comparison is incoherent."
        });
      }
      if (!isCanonicalUnique(projection.reasonCodes)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reasonCodes"],
          message: "Focus shadow reasons must be canonical and unique."
        });
      }
    });

export type CurrentWorkstream = z.infer<typeof currentWorkstreamSchema>;
export type CurrentWorkstreamProjection = z.infer<
  typeof currentWorkstreamProjectionSchema
>;
export type CurrentWorkstreamProjectionContent = z.infer<
  typeof currentWorkstreamProjectionContentSchema
>;
export type ConfirmedCurrentFocusInput = z.infer<
  typeof confirmedCurrentFocusInputSchema
>;
export type SelectedCurrentFocus = z.infer<
  typeof selectedCurrentFocusSchema
>;
export type CurrentFocusProjection = z.infer<
  typeof currentFocusProjectionSchema
>;
export type CurrentFocusProjectionContent = z.infer<
  typeof currentFocusProjectionContentSchema
>;
export type FocusAwareAttentionShadowProjection = z.infer<
  typeof focusAwareAttentionShadowProjectionSchema
>;
export type FocusAwareAttentionShadowContent = z.infer<
  typeof focusAwareAttentionShadowContentSchema
>;

export function createCurrentWorkstreamId(anchorRef: string): string {
  return runtimeStableId(
    "workstream",
    CURRENT_WORKSTREAM_ID_POLICY_VERSION,
    { anchorRef }
  );
}

export function createCurrentFocusId(input: {
  workstreamId: string;
  latestEventId: string;
}): string {
  return runtimeStableId("focus", CURRENT_FOCUS_ID_POLICY_VERSION, input);
}

export function sealCurrentWorkstream(
  content: Omit<CurrentWorkstream, "workstreamSha256">
): CurrentWorkstream {
  return currentWorkstreamSchema.parse({
    ...content,
    workstreamSha256: runtimeSha256({
      domain: CURRENT_WORKSTREAM_SCHEMA_VERSION,
      workstream: content
    })
  });
}

export function currentWorkstreamSha256(
  workstream: CurrentWorkstream
): string {
  const { workstreamSha256: _workstreamSha256, ...content } = workstream;
  return runtimeSha256({
    domain: CURRENT_WORKSTREAM_SCHEMA_VERSION,
    workstream: content
  });
}

export function sealCurrentWorkstreamProjection(
  content: CurrentWorkstreamProjectionContent
): CurrentWorkstreamProjection {
  return currentWorkstreamProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: CURRENT_WORKSTREAM_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function currentWorkstreamProjectionSha256(
  projection: CurrentWorkstreamProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: CURRENT_WORKSTREAM_PROJECTION_CONTRACT,
    projection: content
  });
}

export function sealCurrentFocusProjection(
  content: CurrentFocusProjectionContent
): CurrentFocusProjection {
  return currentFocusProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: CURRENT_FOCUS_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function currentFocusProjectionSha256(
  projection: CurrentFocusProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: CURRENT_FOCUS_PROJECTION_CONTRACT,
    projection: content
  });
}

export function sealFocusAwareAttentionShadowProjection(
  content: FocusAwareAttentionShadowContent
): FocusAwareAttentionShadowProjection {
  return focusAwareAttentionShadowProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: FOCUS_AWARE_ATTENTION_SHADOW_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function focusAwareAttentionShadowProjectionSha256(
  projection: FocusAwareAttentionShadowProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: FOCUS_AWARE_ATTENTION_SHADOW_PROJECTION_CONTRACT,
    projection: content
  });
}

export function createUnavailableCurrentFocusProjection(input: {
  asOf: string;
  reasonCode?: "FOCUS_DEPENDENCY_MISMATCH" | "FOCUS_PROJECTION_UNAVAILABLE";
}): CurrentFocusProjection {
  const asOf = new Date(input.asOf).toISOString();
  const dependencies = {
    recentEventProjectionSha256: null,
    workstreamProjectionSha256: null,
    workRelationProjectionSha256: null,
    artifactRelationProjectionSha256: null,
    claimAuthorityProjectionSha256: null
  };
  return sealCurrentFocusProjection({
    contract: CURRENT_FOCUS_PROJECTION_CONTRACT,
    schemaVersion: CURRENT_FOCUS_SCHEMA_VERSION,
    selectionPolicyVersion: CURRENT_FOCUS_SELECTION_POLICY_VERSION,
    idPolicyVersion: CURRENT_FOCUS_ID_POLICY_VERSION,
    rolloutVersion: CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
    asOf,
    recentWindowMs: CURRENT_FOCUS_RECENT_WINDOW_MS,
    dependencies,
    inputSha256: runtimeSha256({
      domain: "current-focus-unavailable-input-v0.1",
      asOf,
      dependencies,
      reasonCode: input.reasonCode ?? "FOCUS_PROJECTION_UNAVAILABLE"
    }),
    status: "unavailable",
    selectedFocus: null,
    reasonCodes: [
      input.reasonCode ?? "FOCUS_PROJECTION_UNAVAILABLE"
    ],
    explicitFocusApplied: false,
    attentionSelectionEffect: "none",
    attentionDisposition: "shadow_only",
    forbiddenAsAttentionCandidate: true
  });
}

export function compareCurrentWorkstreams(
  left: CurrentWorkstream,
  right: CurrentWorkstream
): number {
  return (
    Date.parse(right.latestMeaningfulEvent.occurredAt) -
      Date.parse(left.latestMeaningfulEvent.occurredAt) ||
    compareRuntimeStrings(left.workstreamId, right.workstreamId)
  );
}

function isCanonicalUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.join("|") === [...values].sort(compareRuntimeStrings).join("|")
  );
}
