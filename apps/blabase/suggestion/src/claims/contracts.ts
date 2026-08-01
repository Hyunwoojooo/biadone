import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  CLAIM_AUTHORITY_PROJECTION_CONTRACT,
  CLAIM_CONFLICT_SCHEMA_VERSION,
  CLAIM_EVIDENCE_POLICY_VERSION,
  CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
  FIELD_CLAIM_AUTHORITY_POLICY_VERSION,
  WORK_CLAIM_SCHEMA_VERSION
} from "../crossSource/versions";

export const MAX_NORMALIZED_WORK_CLAIMS = 12_000;
export const MAX_CLAIM_RELATION_REFS = 100;
export const CLAIM_SOURCE_CLOCK_SKEW_MS = 60_000;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const projectIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/);
const claimIdSchema = z.string().regex(/^claim_[a-f0-9]{32}$/);
const claimKeySchema = z.string().regex(/^claim_key_[a-f0-9]{32}$/);
const claimTargetRefSchema = z
  .string()
  .regex(/^claim_subject_[a-f0-9]{32}$/);
const claimLineageRefSchema = z
  .string()
  .regex(/^claim_lineage_[a-f0-9]{32}$/);
const claimEvidenceRefSchema = z
  .string()
  .regex(/^claim_evidence_[a-f0-9]{32}$/);
const claimResolutionIdSchema = z
  .string()
  .regex(/^claim_resolution_[a-f0-9]{32}$/);
const claimConflictIdSchema = z
  .string()
  .regex(/^claim_conflict_[a-f0-9]{32}$/);
const relationRefSchema = z.union([
  z.string().regex(/^relation_[a-f0-9]{32}$/),
  z.string().regex(/^artifact_relation_[a-f0-9]{32}$/)
]);

export const claimSourceSchema = z.enum([
  "github",
  "codex_managed",
  "codex_inventory",
  "notion",
  "google_calendar",
  "explicit_user"
]);

export const CLAIM_COVERAGE_SOURCES = [
  "github",
  "codex_managed",
  "codex_inventory",
  "notion",
  "google_calendar",
  "explicit_user"
] as const satisfies readonly z.infer<typeof claimSourceSchema>[];

export const claimFieldSchema = z.enum([
  "github_native_identity",
  "github_work_item_state",
  "github_user_relationship",
  "github_milestone_due_at",
  "managed_codex_execution_state",
  "project_alignment_identity",
  "notion_task_state",
  "notion_internal_priority",
  "calendar_event_state",
  "calendar_event_time",
  "user_disposition"
]);

export const claimTargetKindSchema = z.enum([
  "github_work_item",
  "codex_execution",
  "project_relation",
  "notion_task",
  "calendar_event",
  "user_work_item"
]);

export const claimEnumValueSchema = z.enum([
  "open",
  "in_progress",
  "completed",
  "cancelled",
  "assigned_to_user",
  "review_requested_from_user",
  "authored_by_user",
  "running",
  "idle",
  "failed",
  "interrupted",
  "low",
  "medium",
  "high",
  "urgent",
  "confirmed",
  "tentative",
  "active",
  "incorrect",
  "not_now"
]);

export const boundedClaimValueSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("enum"),
      value: claimEnumValueSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("timestamp"),
      value: timestampSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("opaque_hash"),
      valueSha256: sha256Schema
    })
    .strict()
]);

export const claimOriginSchema = z.enum([
  "github_normalized_snapshot",
  "managed_codex_event_stream",
  "codex_inventory_snapshot",
  "notion_task_database",
  "google_calendar_snapshot",
  "explicit_user_mapping",
  "explicit_user_feedback"
]);

export const claimAuthorityTierSchema = z.enum([
  "authoritative",
  "supporting",
  "context_only"
]);

const normalizedClaimCoreSchema = z
  .object({
    claimKey: claimKeySchema,
    target: z
      .object({
        kind: claimTargetKindSchema,
        ref: claimTargetRefSchema
      })
      .strict(),
    lineageRef: claimLineageRefSchema,
    field: claimFieldSchema,
    value: boundedClaimValueSchema,
    valueSha256: sha256Schema,
    source: claimSourceSchema,
    origin: claimOriginSchema,
    authority: claimAuthorityTierSchema,
    freshness: z.enum(["current", "stale"]),
    completeness: z.enum(["complete", "partial", "unknown"]),
    directness: z.enum(["explicit", "derived"]),
    observedAt: timestampSchema,
    sourceUpdatedAt: timestampSchema.nullable(),
    evidenceRefs: z.array(claimEvidenceRefSchema).min(1).max(20),
    relationRefs: z.array(relationRefSchema).max(MAX_CLAIM_RELATION_REFS)
  })
  .strict();

export const normalizedWorkClaimSchema = normalizedClaimCoreSchema
  .extend({ claimId: claimIdSchema })
  .strict()
  .superRefine((claim, context) => {
    const expectedAuthority = authorityForClaim(
      claim.source,
      claim.field
    );
    if (expectedAuthority === null || claim.authority !== expectedAuthority) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authority"],
        message: "Claim source is not authoritative for this semantic field."
      });
    }
    if (!originMatchesClaim(claim.source, claim.origin, claim.field)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["origin"],
        message: "Claim origin does not match its source."
      });
    }
    if (!valueMatchesField(claim.field, claim.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Claim value is not valid for this semantic field."
      });
    }
    if (!targetMatchesField(claim.target.kind, claim.field)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target", "kind"],
        message: "Claim target kind does not match its semantic field."
      });
    }
    if (
      claim.claimKey !==
      createClaimKey({ targetRef: claim.target.ref, field: claim.field })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimKey"],
        message: "Claim key does not match its exact target and field."
      });
    }
    if (claim.valueSha256 !== hashBoundedClaimValue(claim.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valueSha256"],
        message: "Claim value hash is invalid."
      });
    }
    const { claimId: _claimId, ...core } = claim;
    if (claim.claimId !== createClaimId(core)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimId"],
        message: "Claim ID does not match canonical claim content."
      });
    }
    if (
      !isCanonicalUnique(claim.evidenceRefs) ||
      !isCanonicalUnique(claim.relationRefs)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claim references must be unique and canonically ordered."
      });
    }
    if (claim.authority === "authoritative" && claim.directness !== "explicit") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["directness"],
        message: "Authoritative v0.1 claims require direct evidence."
      });
    }
  });

export const claimCoverageReasonCodeSchema = z.enum([
  "GITHUB_DIRECT_FIELDS_EVALUATED",
  "GITHUB_SNAPSHOT_STALE",
  "GITHUB_SNAPSHOT_PARTIAL",
  "GITHUB_SNAPSHOT_UNAVAILABLE",
  "MANAGED_CODEX_DIRECT_EVENTS_EVALUATED",
  "CODEX_INVENTORY_NOT_LIVE",
  "NOTION_TASK_PROPERTIES_UNAVAILABLE",
  "NOTION_CONFIGURED_TASK_FIELDS_EVALUATED",
  "CALENDAR_WORK_EQUIVALENCE_UNAVAILABLE",
  "CALENDAR_NATIVE_EVENT_FIELDS_EVALUATED",
  "EXPLICIT_PROJECT_MAPPING_EVALUATED",
  "EXPLICIT_USER_FEEDBACK_EVALUATED"
]);

export const claimSourceCoverageSchema = z
  .object({
    source: claimSourceSchema,
    status: z.enum([
      "evaluated",
      "stale",
      "partial",
      "context_only",
      "unavailable",
      "unsupported"
    ]),
    claimFields: z.array(claimFieldSchema).max(20),
    reasonCodes: z.array(claimCoverageReasonCodeSchema).min(1).max(10)
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      !isCanonicalUnique(coverage.claimFields) ||
      !isCanonicalUnique(coverage.reasonCodes)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Coverage fields and reasons must be canonically ordered."
      });
    }
  });

export const claimResolutionReasonCodeSchema = z.enum([
  "AUTHORITATIVE_CLAIM_SELECTED",
  "CONSISTENT_AUTHORITATIVE_CLAIMS",
  "NEWER_SAME_LINEAGE_SELECTED",
  "LOWER_AUTHORITY_DISAGREEMENT",
  "EQUAL_AUTHORITY_CONFLICT",
  "AUTHORITATIVE_CLAIM_STALE",
  "AUTHORITATIVE_CLAIM_MISSING",
  "MINIMUM_CORROBORATION_MISSING",
  "PARTIAL_EVIDENCE",
  "CONTEXT_ONLY_EVIDENCE"
]);

export const claimFieldResolutionSchema = z
  .object({
    resolutionId: claimResolutionIdSchema,
    claimKey: claimKeySchema,
    target: z
      .object({
        kind: claimTargetKindSchema,
        ref: claimTargetRefSchema
      })
      .strict(),
    field: claimFieldSchema,
    status: z.enum([
      "resolved",
      "review_required",
      "insufficient_evidence"
    ]),
    winningClaimId: claimIdSchema.nullable(),
    claimIds: z.array(claimIdSchema).min(1).max(100),
    reasonCodes: z
      .array(claimResolutionReasonCodeSchema)
      .min(1)
      .max(20),
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict()
  .superRefine((resolution, context) => {
    if (
      (resolution.status === "resolved") !==
      (resolution.winningClaimId !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["winningClaimId"],
        message: "Only a resolved field may have a winning claim."
      });
    }
    if (
      resolution.winningClaimId !== null &&
      !resolution.claimIds.includes(resolution.winningClaimId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["winningClaimId"],
        message: "Winning claim must belong to the resolution."
      });
    }
    if (
      !isCanonicalUnique(resolution.claimIds) ||
      !isCanonicalUnique(resolution.reasonCodes)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resolution references must be canonically ordered."
      });
    }
  });

export const claimConflictReasonCodeSchema = z.enum([
  "LOWER_AUTHORITY_VALUE_DISAGREEMENT",
  "OLDER_LINEAGE_VALUE_DISAGREEMENT",
  "EQUAL_AUTHORITY_VALUE_DISAGREEMENT",
  "STALE_AUTHORITY_VALUE_DISAGREEMENT"
]);

export const claimConflictSchema = z
  .object({
    conflictId: claimConflictIdSchema,
    conflictSchemaVersion: z.literal(CLAIM_CONFLICT_SCHEMA_VERSION),
    claimKey: claimKeySchema,
    target: z
      .object({
        kind: claimTargetKindSchema,
        ref: claimTargetRefSchema
      })
      .strict(),
    field: claimFieldSchema,
    status: z.enum([
      "resolved_by_authority",
      "resolved_by_freshness",
      "review_required"
    ]),
    criticality: z.literal("critical"),
    reasonCode: claimConflictReasonCodeSchema,
    winningClaimId: claimIdSchema.nullable(),
    claimIds: z.array(claimIdSchema).min(2).max(100),
    relationRefs: z.array(relationRefSchema).max(MAX_CLAIM_RELATION_REFS),
    nextAction: z.enum(["none", "refresh_sources", "user_review"]),
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict()
  .superRefine((conflict, context) => {
    if (
      (conflict.status === "review_required") !==
      (conflict.winningClaimId === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["winningClaimId"],
        message: "Review-required conflicts cannot select a winner."
      });
    }
    if (
      conflict.winningClaimId !== null &&
      !conflict.claimIds.includes(conflict.winningClaimId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["winningClaimId"],
        message: "Conflict winner must be one of the competing claims."
      });
    }
    if (
      !isCanonicalUnique(conflict.claimIds) ||
      !isCanonicalUnique(conflict.relationRefs)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Conflict references must be canonically ordered."
      });
    }
  });

const claimProjectionContentSchema = z
  .object({
    contract: z.literal(CLAIM_AUTHORITY_PROJECTION_CONTRACT),
    schemaVersion: z.literal(WORK_CLAIM_SCHEMA_VERSION),
    conflictSchemaVersion: z.literal(CLAIM_CONFLICT_SCHEMA_VERSION),
    resolverVersion: z.literal(CROSS_SOURCE_CLAIM_RESOLVER_VERSION),
    authorityPolicyVersion: z.literal(
      FIELD_CLAIM_AUTHORITY_POLICY_VERSION
    ),
    evidencePolicyVersion: z.literal(CLAIM_EVIDENCE_POLICY_VERSION),
    asOf: timestampSchema,
    inputs: z
      .object({
        workRelationProjectionSha256: sha256Schema,
        artifactRelationProjectionSha256: sha256Schema,
        githubBatchSha256: sha256Schema.nullable(),
        githubSourceSnapshotSha256: sha256Schema.nullable(),
        managedSourceRevision: z.number().int().nonnegative(),
        managedGeneratedAt: timestampSchema,
        managedSemanticProjectionSha256: sha256Schema,
        contextRegistrySha256: sha256Schema.nullable()
      })
      .strict(),
    sourceCoverage: z.array(claimSourceCoverageSchema).length(
      CLAIM_COVERAGE_SOURCES.length
    ),
    totalInputClaimCount: z.number().int().nonnegative(),
    deduplicatedClaimCount: z.number().int().nonnegative(),
    claims: z.array(normalizedWorkClaimSchema).max(MAX_NORMALIZED_WORK_CLAIMS),
    fieldResolutions: z
      .array(claimFieldResolutionSchema)
      .max(MAX_NORMALIZED_WORK_CLAIMS),
    conflicts: z.array(claimConflictSchema).max(MAX_NORMALIZED_WORK_CLAIMS),
    unresolvedCriticalConflictCount: z.number().int().nonnegative(),
    inputSha256: sha256Schema,
    attentionDisposition: z.literal("not_connected"),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export const claimAuthorityProjectionSchema = claimProjectionContentSchema
  .extend({ projectionSha256: sha256Schema })
  .strict()
  .superRefine((projection, context) => {
    if (
      projection.projectionSha256 !==
      claimAuthorityProjectionSha256(projection)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectionSha256"],
        message: "Claim authority projection hash is invalid."
      });
    }
    if (
      projection.totalInputClaimCount < projection.claims.length ||
      projection.deduplicatedClaimCount !== projection.claims.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claim projection counts are incoherent."
      });
    }
    const coverageSources = projection.sourceCoverage.map(
      (coverage) => coverage.source
    );
    if (
      !isCanonicalUnique(coverageSources) ||
      coverageSources.join("|") !==
        [...CLAIM_COVERAGE_SOURCES].sort(compareRuntimeStrings).join("|")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceCoverage"],
        message: "Projection must report every source coverage exactly once."
      });
    }
    const claimById = new Map(
      projection.claims.map((claim) => [claim.claimId, claim])
    );
    const claimsByKey = new Map<string, NormalizedWorkClaim[]>();
    for (const claim of projection.claims) {
      claimsByKey.set(claim.claimKey, [
        ...(claimsByKey.get(claim.claimKey) ?? []),
        claim
      ]);
    }
    const claimKeys = new Set(projection.claims.map((claim) => claim.claimKey));
    const resolutionKeys = new Set(
      projection.fieldResolutions.map((resolution) => resolution.claimKey)
    );
    if (
      claimById.size !== projection.claims.length ||
      resolutionKeys.size !== projection.fieldResolutions.length ||
      claimKeys.size !== resolutionKeys.size ||
      [...claimKeys].some((key) => !resolutionKeys.has(key))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claims and field resolutions must form an exact partition."
      });
    }
    for (const resolution of projection.fieldResolutions) {
      const groupedClaims = claimsByKey.get(resolution.claimKey) ?? [];
      const expectedClaimIds = groupedClaims
        .map((claim) => claim.claimId)
        .sort(compareRuntimeStrings);
      const claims = resolution.claimIds
        .map((claimId) => claimById.get(claimId))
        .filter((claim): claim is NormalizedWorkClaim => claim !== undefined);
      if (
        claims.length !== resolution.claimIds.length ||
        claims.some(
          (claim) =>
            claim.claimKey !== resolution.claimKey ||
            claim.field !== resolution.field ||
            claim.target.ref !== resolution.target.ref ||
            claim.target.kind !== resolution.target.kind
        ) ||
        resolution.claimIds.join("|") !== expectedClaimIds.join("|") ||
        resolution.resolutionId !==
          createClaimResolutionId({
            claimKey: resolution.claimKey,
            claimIds: resolution.claimIds
          })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fieldResolutions"],
          message: "Resolution claim references are incoherent."
        });
      }
    }
    const conflictKeys = new Set<string>();
    for (const conflict of projection.conflicts) {
      if (conflictKeys.has(conflict.claimKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conflicts"],
          message: "A claim key may have at most one conflict."
        });
      }
      conflictKeys.add(conflict.claimKey);
      const claims = conflict.claimIds
        .map((claimId) => claimById.get(claimId))
        .filter((claim): claim is NormalizedWorkClaim => claim !== undefined);
      if (
        claims.length !== conflict.claimIds.length ||
        claims.some(
          (claim) =>
            claim.claimKey !== conflict.claimKey ||
            claim.field !== conflict.field ||
            claim.target.ref !== conflict.target.ref ||
            claim.target.kind !== conflict.target.kind
        ) ||
        new Set(claims.map((claim) => claim.valueSha256)).size < 2 ||
        conflict.conflictId !==
          createClaimConflictId({
            claimKey: conflict.claimKey,
            claimIds: conflict.claimIds
          }) ||
        conflict.relationRefs.join("|") !==
          [...new Set(claims.flatMap((claim) => claim.relationRefs))]
            .sort(compareRuntimeStrings)
            .join("|")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conflicts"],
          message: "Conflict must retain competing values from one claim key."
        });
      }
      const resolution = projection.fieldResolutions.find(
        (candidate) => candidate.claimKey === conflict.claimKey
      );
      if (
        !resolution ||
        resolution.winningClaimId !== conflict.winningClaimId ||
        (conflict.status === "review_required"
          ? resolution.status === "resolved" ||
            !["refresh_sources", "user_review"].includes(
              conflict.nextAction
            )
          : resolution.status !== "resolved" ||
            conflict.nextAction !== "none")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conflicts"],
          message: "Conflict and field resolution are incoherent."
        });
      }
    }
    for (const resolution of projection.fieldResolutions) {
      const group = claimsByKey.get(resolution.claimKey) ?? [];
      const hasDisagreement =
        new Set(group.map((claim) => claim.valueSha256)).size > 1;
      if (hasDisagreement !== conflictKeys.has(resolution.claimKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conflicts"],
          message: "Every value disagreement requires exactly one conflict."
        });
      }
    }
    if (
      !isCanonicalUnique(
        projection.fieldResolutions.map((item) => item.resolutionId)
      ) ||
      !isCanonicalUnique(
        projection.conflicts.map((item) => item.conflictId)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resolution and conflict IDs must be unique and canonical."
      });
    }
    const unresolved = projection.conflicts.filter(
      (conflict) =>
        conflict.criticality === "critical" &&
        conflict.status === "review_required"
    ).length;
    if (projection.unresolvedCriticalConflictCount !== unresolved) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unresolvedCriticalConflictCount"],
        message: "Unresolved critical conflict count is invalid."
      });
    }
    if (
      projection.claims.some(
        (claim) =>
          Date.parse(claim.observedAt) >
            Date.parse(projection.asOf) + CLAIM_SOURCE_CLOCK_SKEW_MS ||
          (claim.sourceUpdatedAt !== null &&
            Date.parse(claim.sourceUpdatedAt) >
              Date.parse(projection.asOf) + CLAIM_SOURCE_CLOCK_SKEW_MS)
      ) ||
      Date.parse(projection.inputs.managedGeneratedAt) >
        Date.parse(projection.asOf)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Projection cannot include future evidence."
      });
    }
  });

export type ClaimSource = z.infer<typeof claimSourceSchema>;
export type ClaimField = z.infer<typeof claimFieldSchema>;
export type ClaimTargetKind = z.infer<typeof claimTargetKindSchema>;
export type BoundedClaimValue = z.infer<typeof boundedClaimValueSchema>;
export type ClaimOrigin = z.infer<typeof claimOriginSchema>;
export type ClaimAuthorityTier = z.infer<typeof claimAuthorityTierSchema>;
export type NormalizedWorkClaim = z.infer<typeof normalizedWorkClaimSchema>;
export type ClaimSourceCoverage = z.infer<typeof claimSourceCoverageSchema>;
export type ClaimFieldResolution = z.infer<typeof claimFieldResolutionSchema>;
export type ClaimConflict = z.infer<typeof claimConflictSchema>;
export type ClaimAuthorityProjection = z.infer<
  typeof claimAuthorityProjectionSchema
>;
export type ClaimAuthorityProjectionContent = z.infer<
  typeof claimProjectionContentSchema
>;

export function createClaimTargetRef(input: {
  kind: ClaimTargetKind;
  identity: unknown;
}): string {
  return runtimeStableId("claim_subject", WORK_CLAIM_SCHEMA_VERSION, input);
}

export function createClaimLineageRef(input: unknown): string {
  return runtimeStableId("claim_lineage", WORK_CLAIM_SCHEMA_VERSION, input);
}

export function createClaimEvidenceRef(input: unknown): string {
  return runtimeStableId("claim_evidence", CLAIM_EVIDENCE_POLICY_VERSION, input);
}

export function createClaimKey(input: {
  targetRef: string;
  field: ClaimField;
}): string {
  return runtimeStableId("claim_key", WORK_CLAIM_SCHEMA_VERSION, input);
}

export function hashBoundedClaimValue(value: BoundedClaimValue): string {
  return runtimeSha256({
    domain: "bounded-work-claim-value-v0.1",
    value
  });
}

export function createClaimId(
  core: z.infer<typeof normalizedClaimCoreSchema>
): string {
  return runtimeStableId("claim", WORK_CLAIM_SCHEMA_VERSION, core);
}

export function createNormalizedWorkClaim(input: {
  target: { kind: ClaimTargetKind; ref: string };
  lineageRef: string;
  field: ClaimField;
  value: BoundedClaimValue;
  source: ClaimSource;
  origin: ClaimOrigin;
  freshness: "current" | "stale";
  completeness: "complete" | "partial" | "unknown";
  directness: "explicit" | "derived";
  observedAt: string;
  sourceUpdatedAt: string | null;
  evidenceRefs: string[];
  relationRefs?: string[];
}): NormalizedWorkClaim {
  const authority = authorityForClaim(input.source, input.field);
  if (authority === null) {
    throw new TypeError("Unsupported source and claim field combination.");
  }
  const valueSha256 = hashBoundedClaimValue(input.value);
  const core = normalizedClaimCoreSchema.parse({
    claimKey: createClaimKey({
      targetRef: input.target.ref,
      field: input.field
    }),
    target: input.target,
    lineageRef: input.lineageRef,
    field: input.field,
    value: input.value,
    valueSha256,
    source: input.source,
    origin: input.origin,
    authority,
    freshness: input.freshness,
    completeness: input.completeness,
    directness: input.directness,
    observedAt: new Date(input.observedAt).toISOString(),
    sourceUpdatedAt:
      input.sourceUpdatedAt === null
        ? null
        : new Date(input.sourceUpdatedAt).toISOString(),
    evidenceRefs: [...new Set(input.evidenceRefs)].sort(
      compareRuntimeStrings
    ),
    relationRefs: [...new Set(input.relationRefs ?? [])].sort(
      compareRuntimeStrings
    )
  });
  return normalizedWorkClaimSchema.parse({
    ...core,
    claimId: createClaimId(core)
  });
}

export function createClaimResolutionId(input: {
  claimKey: string;
  claimIds: string[];
}): string {
  return runtimeStableId(
    "claim_resolution",
    CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
    {
      claimKey: input.claimKey,
      claimIds: [...input.claimIds].sort(compareRuntimeStrings)
    }
  );
}

export function createClaimConflictId(input: {
  claimKey: string;
  claimIds: string[];
}): string {
  return runtimeStableId(
    "claim_conflict",
    CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
    {
      claimKey: input.claimKey,
      claimIds: [...input.claimIds].sort(compareRuntimeStrings)
    }
  );
}

export function sealClaimAuthorityProjection(
  content: ClaimAuthorityProjectionContent
): ClaimAuthorityProjection {
  return claimAuthorityProjectionSchema.parse({
    ...content,
    projectionSha256: runtimeSha256({
      domain: CLAIM_AUTHORITY_PROJECTION_CONTRACT,
      projection: content
    })
  });
}

export function claimAuthorityProjectionSha256(
  projection: ClaimAuthorityProjection
): string {
  const { projectionSha256: _projectionSha256, ...content } = projection;
  return runtimeSha256({
    domain: CLAIM_AUTHORITY_PROJECTION_CONTRACT,
    projection: content
  });
}

export function authorityForClaim(
  source: ClaimSource,
  field: ClaimField
): ClaimAuthorityTier | null {
  if (
    source === "github" &&
    [
      "github_native_identity",
      "github_work_item_state",
      "github_user_relationship",
      "github_milestone_due_at"
    ].includes(field)
  ) {
    return "authoritative";
  }
  if (source === "codex_managed" && field === "managed_codex_execution_state") {
    return "authoritative";
  }
  if (
    source === "codex_inventory" &&
    field === "managed_codex_execution_state"
  ) {
    return "context_only";
  }
  if (
    source === "notion" &&
    ["notion_task_state", "notion_internal_priority"].includes(field)
  ) {
    return "authoritative";
  }
  if (
    source === "google_calendar" &&
    ["calendar_event_state", "calendar_event_time"].includes(field)
  ) {
    return "authoritative";
  }
  if (
    source === "explicit_user" &&
    [
      "project_alignment_identity",
      "notion_internal_priority",
      "user_disposition"
    ].includes(field)
  ) {
    return "authoritative";
  }
  return null;
}

function originMatchesClaim(
  source: ClaimSource,
  origin: ClaimOrigin,
  field: ClaimField
): boolean {
  switch (source) {
    case "github":
      return origin === "github_normalized_snapshot";
    case "codex_managed":
      return origin === "managed_codex_event_stream";
    case "codex_inventory":
      return origin === "codex_inventory_snapshot";
    case "notion":
      return origin === "notion_task_database";
    case "google_calendar":
      return origin === "google_calendar_snapshot";
    case "explicit_user":
      return (
        (origin === "explicit_user_mapping" &&
          field === "project_alignment_identity") ||
        (origin === "explicit_user_feedback" &&
          ["notion_internal_priority", "user_disposition"].includes(
            field
          ))
      );
  }
}

function valueMatchesField(
  field: ClaimField,
  value: BoundedClaimValue
): boolean {
  if (
    field === "github_native_identity" ||
    field === "project_alignment_identity"
  ) {
    return value.type === "opaque_hash";
  }
  if (
    field === "github_milestone_due_at" ||
    field === "calendar_event_time"
  ) {
    return value.type === "timestamp";
  }
  if (value.type !== "enum") return false;
  const allowed: Record<
    Exclude<
      ClaimField,
      | "github_native_identity"
      | "project_alignment_identity"
      | "github_milestone_due_at"
      | "calendar_event_time"
    >,
    readonly z.infer<typeof claimEnumValueSchema>[]
  > = {
    github_work_item_state: ["open", "completed", "cancelled"],
    github_user_relationship: [
      "assigned_to_user",
      "review_requested_from_user",
      "authored_by_user"
    ],
    managed_codex_execution_state: [
      "running",
      "idle",
      "completed",
      "failed",
      "interrupted"
    ],
    notion_task_state: ["open", "in_progress", "completed", "cancelled"],
    notion_internal_priority: ["low", "medium", "high", "urgent"],
    calendar_event_state: ["confirmed", "tentative", "cancelled"],
    user_disposition: ["active", "completed", "incorrect", "not_now"]
  };
  return allowed[field].includes(value.value);
}

function targetMatchesField(
  targetKind: ClaimTargetKind,
  field: ClaimField
): boolean {
  const expectedTarget: Record<ClaimField, ClaimTargetKind> = {
    github_native_identity: "github_work_item",
    github_work_item_state: "github_work_item",
    github_user_relationship: "github_work_item",
    github_milestone_due_at: "github_work_item",
    managed_codex_execution_state: "codex_execution",
    project_alignment_identity: "project_relation",
    notion_task_state: "notion_task",
    notion_internal_priority: "notion_task",
    calendar_event_state: "calendar_event",
    calendar_event_time: "calendar_event",
    user_disposition: "user_work_item"
  };
  return targetKind === expectedTarget[field];
}

function isCanonicalUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every(
      (value, index) => index === 0 || compareRuntimeStrings(values[index - 1]!, value) <= 0
    )
  );
}

export function opaqueProjectValue(projectId: string): BoundedClaimValue {
  projectIdSchema.parse(projectId);
  return {
    type: "opaque_hash",
    valueSha256: runtimeSha256({
      domain: "claim-project-identity-v0.1",
      projectId
    })
  };
}
