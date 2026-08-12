import { z } from "zod";

import { WORK_CONTEXT_REGISTRY_CONTRACT } from "../context/contracts";
import {
  compareRuntimeStrings,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  CONTINUATION_ACTION_OFFER_SCHEMA_VERSION,
  CONTINUATION_ACTION_POLICY_VERSION,
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CANDIDATE_CONTRACT,
  CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_CONTEXT_LINK_PROJECTION_CONTRACT,
  CONTINUATION_CONTEXT_LINK_SCHEMA_VERSION,
  CONTINUATION_DECISION_CONTRACT,
  CONTINUATION_DECISION_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_ID_POLICY_VERSION,
  CONTINUATION_INPUT_CONTRACT,
  CONTINUATION_INPUT_SCHEMA_VERSION,
  CONTINUATION_LOCAL_GIT_ADAPTER_VERSION,
  CONTINUATION_LOCAL_GIT_SOURCE_SCHEMA_VERSION,
  CONTINUATION_OBSERVATION_CONTRACT,
  CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
  CONTINUATION_OBSERVATION_SCHEMA_VERSION,
  CONTINUATION_PRIVATE_ACTION_OFFER_CONTRACT,
  CONTINUATION_PUBLIC_ACTION_REF_CONTRACT,
  CONTINUATION_PUBLIC_DECISION_CONTRACT,
  CONTINUATION_PUBLIC_DECISION_SCHEMA_VERSION,
  CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
  CONTINUATION_RESOLVER_VERSION,
  CONTINUATION_RULE_VERSION,
  CONTINUATION_SCORING_POLICY_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
} from "../crossSource/versions";

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const codeCommitSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const workContextIdSchema = z.string().regex(/^project_[a-f0-9]{32}$/u);
const sourceRefSchema = z.string().regex(/^source_ref_[a-f0-9]{32}$/u);
const sourceRecordRefSchema = z
  .string()
  .regex(/^source_record_ref_[a-f0-9]{32}$/u);
const evidenceRefSchema = z.string().regex(/^evidence_[a-f0-9]{32}$/u);
const observationIdSchema = z
  .string()
  .regex(/^continuation_observation_[a-f0-9]{32}$/u);
const candidateIdSchema = z
  .string()
  .regex(/^continuation_candidate_[a-f0-9]{32}$/u);
const contextLinkIdSchema = z
  .string()
  .regex(/^continuation_context_link_[a-f0-9]{32}$/u);
const offerIdSchema = z
  .string()
  .regex(/^continuation_offer_[a-f0-9]{32}$/u);
const publicItemRefSchema = z
  .string()
  .regex(/^item_ref_[A-Za-z0-9_-]{22,128}$/u);
const publicWorkContextRefSchema = z
  .string()
  .regex(/^context_ref_[A-Za-z0-9_-]{22,128}$/u);
const publicActionRefSchema = z
  .string()
  .regex(/^action_ref_[A-Za-z0-9_-]{22,128}$/u);
const privateTargetRefSchema = z
  .string()
  .regex(/^private_target_[a-f0-9]{32}$/u);
const reasonCodeSchema = z.string().regex(/^[A-Z0-9_]{1,80}$/u);
const publicSafeTextForbiddenPatterns = [
  /[\u0000-\u001f\u007f-\u009f]/u,
  /https?:\/\/\S+/iu,
  /file:\/\/\S+/iu,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/u,
  /(?:^|[^\p{L}\p{N}_])(?:\/{1,2}(?!\s)\S+|\\\\\S+|[A-Za-z]:[\\/]\S+)/u,
  /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+/u,
  /(?:^|[^A-Fa-f0-9])(?:[A-Fa-f0-9]{64}|[A-Fa-f0-9]{40})(?=$|[^A-Fa-f0-9])/u,
  /(?:session_|run_|analysis_|evidence_|source_ref_|continuation_observation_|continuation_candidate_)[A-Za-z0-9_-]*/u
] as const;
const publicTitleSchema = publicSafeTextSchema(120);
const publicSummarySchema = publicSafeTextSchema(240);

const OBSERVATION_HASH_DOMAIN = "continuation-observation-hash-v0.2";
const INPUT_HASH_DOMAIN = "continuation-input-hash-v0.2";
const CANDIDATE_HASH_DOMAIN = "continuation-candidate-hash-v0.1";
const DECISION_HASH_DOMAIN = "continuation-decision-hash-v0.2";
const DECISION_SEMANTIC_HASH_DOMAIN =
  "continuation-decision-semantic-hash-v0.2";
const ACTION_OFFER_HASH_DOMAIN = "continuation-action-offer-hash-v0.1";
const NON_CANONICAL_BOUNDARY_VALUE = Object.freeze({
  nonCanonicalContinuationBoundaryValue: true
});

export const continuationSourceIdentitySchema = z.discriminatedUnion(
  "source",
  [
    z.object({ source: z.literal("github"), opaqueId: sourceRefSchema }).strict(),
    z.object({ source: z.literal("codex"), opaqueId: sourceRefSchema }).strict(),
    z
      .object({ source: z.literal("local_git"), opaqueId: sourceRefSchema })
      .strict()
  ]
);

export const continuationInternalCapabilitySchema = z.enum([
  "display",
  "open_source",
  "open_setup_surface",
  "map_or_select",
  "resume_exact_session",
  "prefill_prompt_draft",
  "external_mutation"
]);

export const continuationMvpPublicCapabilitySchema = z.enum([
  "display",
  "open_source",
  "open_setup_surface"
]);

export const continuationDecisionStatusSchema = z.enum([
  "offers_available",
  "setup_required",
  "no_recent_context",
  "insufficient_evidence",
  "unavailable"
]);

const contextLinkBaseSchema = z
  .object({
    contract: z.literal(CONTINUATION_CONTEXT_LINK_PROJECTION_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_CONTEXT_LINK_SCHEMA_VERSION),
    contextLinkId: contextLinkIdSchema,
    workContextId: workContextIdSchema,
    sourceIdentity: continuationSourceIdentitySchema,
    proposalBasis: z.enum(["explicit_user", "exact_remote"]),
    status: z.enum(["proposed", "confirmed", "conflict", "deleted"]),
    proposedAt: timestampSchema,
    confirmedAt: timestampSchema.nullable(),
    deletedAt: timestampSchema.nullable(),
    confirmationSource: z.literal("explicit_user").nullable(),
    supersedesContextLinkId: contextLinkIdSchema.nullable()
  })
  .strict();

export const continuationContextLinkProjectionSchema =
  failClosedCanonicalBoundary(
    contextLinkBaseSchema.superRefine(refineContextLink)
  );

const githubPushPayloadSchema = z
  .object({
    kind: z.literal("github_push"),
    pushOccurredAt: timestampSchema
  })
  .strict();

const codexSessionPayloadSchema = z
  .object({
    kind: z.literal("codex_session_activity"),
    sessionUpdatedAt: timestampSchema,
    boundedActivityCount: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .describe(
        "Zero means the source preserved metadata-only session presence; it does not prove inactivity."
      ),
    boundedSummaryAvailable: z.boolean()
  })
  .strict();

const localGitPayloadSchema = z
  .object({
    kind: z.literal("local_git_state"),
    lastCommitAt: timestampSchema.nullable(),
    trackingState: z.enum([
      "in_sync",
      "ahead",
      "behind",
      "diverged",
      "not_configured"
    ]),
    dirtyCount: z.number().int().min(0).max(100_000)
  })
  .strict();

export const continuationObservationPayloadSchema = z.discriminatedUnion(
  "kind",
  [githubPushPayloadSchema, codexSessionPayloadSchema, localGitPayloadSchema]
);

const observationContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_OBSERVATION_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_OBSERVATION_SCHEMA_VERSION),
    observationId: observationIdSchema,
    observationIdPolicyVersion: z.literal(
      CONTINUATION_OBSERVATION_ID_POLICY_VERSION
    ),
    sourceIdentity: continuationSourceIdentitySchema,
    sourceRecordRef: sourceRecordRefSchema,
    sourceSchemaVersion: z.union([
      z.literal(CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION),
      z.literal(CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION),
      z.literal(CONTINUATION_LOCAL_GIT_SOURCE_SCHEMA_VERSION)
    ]),
    adapterVersion: z.union([
      z.literal(CONTINUATION_GITHUB_ADAPTER_VERSION),
      z.literal(CONTINUATION_CODEX_ADAPTER_VERSION),
      z.literal(CONTINUATION_LOCAL_GIT_ADAPTER_VERSION)
    ]),
    sourceSnapshotSha256: sha256Schema,
    workContextId: workContextIdSchema.nullable(),
    payload: continuationObservationPayloadSchema,
    observedAt: timestampSchema,
    snapshotCapturedAt: timestampSchema,
    expiresAt: timestampSchema,
    activityWindowPolicyVersion: z.literal(
      CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION
    ),
    snapshotFreshnessPolicyVersion: z.literal(
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
    ),
    sourceCoverage: z.enum(["complete", "partial", "unknown"]),
    snapshotFreshness: z.enum(["fresh", "stale", "invalid", "unknown"]),
    terminalState: z.enum(["active", "terminal", "unknown"]),
    evidenceRefs: z.array(evidenceRefSchema).min(1).max(16),
    conflictCodes: z.array(reasonCodeSchema).max(8),
    errorCodes: z.array(reasonCodeSchema).max(8)
  })
  .strict();

export const continuationObservationContentSchema =
  failClosedCanonicalBoundary(
    observationContentObjectSchema.superRefine(refineObservationContent)
  );

const observationSealedObjectSchema = observationContentObjectSchema
  .extend({ observationSha256: sha256Schema })
  .strict();

export const continuationObservationSchema = failClosedCanonicalBoundary(
  observationSealedObjectSchema.superRefine((value, context) => {
    refineObservationContent(value, context);
    refineComputedStringIntegrity(
      value.observationSha256,
      () => continuationObservationSha256(value),
      context,
      ["observationSha256"],
      "Observation hash mismatch"
    );
  })
);

const availableGitHubDependencySchema = z
  .object({
    state: z.literal("available"),
    source: z.literal("github"),
    sourceSchemaVersion: z.literal(
      CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION
    ),
    adapterVersion: z.literal(CONTINUATION_GITHUB_ADAPTER_VERSION),
    snapshotSha256: sha256Schema
  })
  .strict();

const unavailableGitHubDependencySchema = z
  .object({
    state: z.literal("unavailable"),
    source: z.literal("github"),
    reasonCode: z.enum([
      "SOURCE_MISSING",
      "SOURCE_STALE",
      "SOURCE_REJECTED",
      "UNSUPPORTED_SOURCE_VERSION"
    ])
  })
  .strict();

const availableCodexDependencySchema = z
  .object({
    state: z.literal("available"),
    source: z.literal("codex"),
    sourceSchemaVersion: z.literal(CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION),
    adapterVersion: z.literal(CONTINUATION_CODEX_ADAPTER_VERSION),
    snapshotSha256: sha256Schema
  })
  .strict();

const unavailableCodexDependencySchema = z
  .object({
    state: z.literal("unavailable"),
    source: z.literal("codex"),
    reasonCode: z.enum([
      "SOURCE_MISSING",
      "SOURCE_STALE",
      "SOURCE_REJECTED",
      "UNSUPPORTED_SOURCE_VERSION"
    ])
  })
  .strict();

export const continuationDependenciesSchema = z
  .object({
    identityPolicyVersion: z.literal(CONTINUATION_ID_POLICY_VERSION),
    activityWindowPolicyVersion: z.literal(
      CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION
    ),
    snapshotFreshnessPolicyVersion: z.literal(
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
    ),
    ruleVersion: z.literal(CONTINUATION_RULE_VERSION),
    scoringPolicyVersion: z.literal(CONTINUATION_SCORING_POLICY_VERSION),
    resolverVersion: z.literal(CONTINUATION_RESOLVER_VERSION),
    actionPolicyVersion: z.literal(CONTINUATION_ACTION_POLICY_VERSION),
    publicProjectionPolicyVersion: z.literal(
      CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION
    ),
    workContextRegistryContract: z.literal(WORK_CONTEXT_REGISTRY_CONTRACT),
    workContextRegistrySha256: sha256Schema,
    github: z.union([
      availableGitHubDependencySchema,
      unavailableGitHubDependencySchema
    ]),
    codex: z.union([
      availableCodexDependencySchema,
      unavailableCodexDependencySchema
    ]),
    configSha256: sha256Schema
  })
  .strict();

const inputContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_INPUT_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_INPUT_SCHEMA_VERSION),
    asOf: timestampSchema,
    dependencies: continuationDependenciesSchema,
    contextLinks: z.array(continuationContextLinkProjectionSchema).max(10_000),
    observations: z.array(continuationObservationSchema).max(10_000)
  })
  .strict();

export const continuationInputContentSchema = failClosedCanonicalBoundary(
  inputContentObjectSchema.superRefine(refineInputContent)
);

const inputSealedObjectSchema = inputContentObjectSchema
  .extend({ inputSha256: sha256Schema })
  .strict();

export const continuationInputSchema = failClosedCanonicalBoundary(
  inputSealedObjectSchema.superRefine((value, context) => {
    refineInputContent(value, context);
    refineComputedStringIntegrity(
      value.inputSha256,
      () => continuationInputSha256(value),
      context,
      ["inputSha256"],
      "Input hash mismatch"
    );
  })
);

export const continuationScoreBreakdownSchema = z
  .object({
    recency: z.number().int().min(0).max(35),
    exactCorroboration: z.number().int().min(0).max(25),
    resumability: z.number().int().min(0).max(20),
    localContinuity: z.number().int().min(0).max(10),
    explicitPreference: z.number().int().min(0).max(10)
  })
  .strict();

export const continuationPrivateActionTargetSchema = z.discriminatedUnion(
  "capability",
  [
    z
      .object({
        capability: z.literal("open_source"),
        targetRef: privateTargetRefSchema
      })
      .strict(),
    z
      .object({
        capability: z.literal("open_setup_surface"),
        targetRef: privateTargetRefSchema
      })
      .strict(),
    z
      .object({
        capability: z.literal("map_or_select"),
        targetRef: privateTargetRefSchema
      })
      .strict(),
    z
      .object({
        capability: z.literal("resume_exact_session"),
        targetRef: privateTargetRefSchema
      })
      .strict(),
    z
      .object({
        capability: z.literal("prefill_prompt_draft"),
        targetRef: privateTargetRefSchema
      })
      .strict()
  ]
);

const candidateContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_CANDIDATE_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_CANDIDATE_SCHEMA_VERSION),
    candidateId: candidateIdSchema,
    candidateKind: z.enum([
      "recent_github_push",
      "recent_codex_session",
      "local_worktree",
      "linked_workstream",
      "workspace_mapping"
    ]),
    workContextId: workContextIdSchema.nullable(),
    sourceObservationIds: z.array(observationIdSchema).min(1).max(8),
    localDisplayLabel: z.string().trim().min(1).max(120),
    observedAt: timestampSchema,
    expiresAt: timestampSchema,
    evidenceBand: z.enum([
      "exact",
      "corroborated",
      "single_source",
      "setup"
    ]),
    capability: continuationInternalCapabilitySchema,
    availability: z.enum([
      "ready",
      "setup_required",
      "future_capability_blocked"
    ]),
    continuityScore: z.number().int().min(0).max(100),
    scoreBreakdown: continuationScoreBreakdownSchema,
    reasonCodes: z.array(reasonCodeSchema).min(1).max(8),
    caveatCodes: z.array(reasonCodeSchema).max(8),
    privateActionTarget: continuationPrivateActionTargetSchema.nullable()
  })
  .strict();

export const continuationCandidateContentSchema = failClosedCanonicalBoundary(
  candidateContentObjectSchema.superRefine(refineCandidateContent)
);

const candidateSealedObjectSchema = candidateContentObjectSchema
  .extend({ candidateSha256: sha256Schema })
  .strict();

export const continuationCandidateSchema = failClosedCanonicalBoundary(
  candidateSealedObjectSchema.superRefine((value, context) => {
    refineCandidateContent(value, context);
    refineComputedStringIntegrity(
      value.candidateSha256,
      () => continuationCandidateSha256(value),
      context,
      ["candidateSha256"],
      "Candidate hash mismatch"
    );
  })
);

const engineErrorSchema = z
  .object({
    code: reasonCodeSchema,
    stage: z.enum([
      "parse",
      "compatibility",
      "identity",
      "candidate",
      "resolve",
      "project"
    ]),
    sanitizedDetail: z.string().max(240).nullable()
  })
  .strict();

export const continuationRunMetadataSchema = z
  .object({
    runId: z.string().regex(/^continuation_run_[a-f0-9]{32}$/u),
    analysisId: z.string().regex(/^analysis_[a-f0-9]{32}$/u),
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    status: z.enum(["completed", "partial", "rejected", "failed"]),
    codeCommitSha: codeCommitSchema,
    inputSha256: sha256Schema,
    dependencies: continuationDependenciesSchema,
    datasetVersion: z.string().trim().min(1).max(120).nullable(),
    datasetSha256: sha256Schema.nullable(),
    observationCount: z.number().int().nonnegative(),
    admittedCandidateCount: z.number().int().nonnegative(),
    excludedCandidateCount: z.number().int().nonnegative(),
    errors: z.array(engineErrorSchema).max(32),
    latencyMs: z.number().int().nonnegative(),
    tokenUsage: z.null()
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
      addIssue(context, ["completedAt"], "Run completion precedes start");
    }
    if ((value.datasetVersion === null) !== (value.datasetSha256 === null)) {
      addIssue(
        context,
        ["datasetSha256"],
        "Dataset version and hash must both be present or both be null"
      );
    }
    refineCanonicalObjectArray(
      value.errors,
      (error) => `${error.stage}\u0000${error.code}\u0000${error.sanitizedDetail ?? ""}`,
      context,
      ["errors"]
    );
  });

const decisionContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_DECISION_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_DECISION_SCHEMA_VERSION),
    asOf: timestampSchema,
    status: continuationDecisionStatusSchema,
    primary: continuationCandidateSchema.nullable(),
    alternatives: z.array(continuationCandidateSchema).max(2),
    coverageCode: z.enum([
      "COMPLETE",
      "SOURCE_LOCAL_PARTIAL",
      "INSUFFICIENT",
      "UNAVAILABLE"
    ]),
    reasonCodes: z.array(reasonCodeSchema).min(1).max(8),
    run: continuationRunMetadataSchema
  })
  .strict();

export const continuationDecisionContentSchema = failClosedCanonicalBoundary(
  decisionContentObjectSchema.superRefine(refineDecisionContent)
);

const decisionSealedObjectSchema = decisionContentObjectSchema
  .extend({
    semanticResultSha256: sha256Schema,
    resultSha256: sha256Schema
  })
  .strict();

export const continuationDecisionSchema = failClosedCanonicalBoundary(
  decisionSealedObjectSchema.superRefine((value, context) => {
    refineDecisionContent(value, context);
    refineComputedStringIntegrity(
      value.semanticResultSha256,
      () => digestContinuationDecisionSemanticUnchecked(value),
      context,
      ["semanticResultSha256"],
      "Decision semantic hash mismatch"
    );
    refineComputedStringIntegrity(
      value.resultSha256,
      () => continuationDecisionSha256(value),
      context,
      ["resultSha256"],
      "Decision hash mismatch"
    );
  })
);

const privateActionOfferContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_PRIVATE_ACTION_OFFER_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_ACTION_OFFER_SCHEMA_VERSION),
    offerId: offerIdSchema,
    actionRef: publicActionRefSchema,
    candidateId: candidateIdSchema,
    capability: z.enum(["open_source", "open_setup_surface"]),
    privateActionTarget: continuationPrivateActionTargetSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    explicitUserActionRequired: z.literal(true),
    automaticExecutionAllowed: z.literal(false),
    externalMutationAllowed: z.literal(false),
    oneTimeUse: z.literal(true)
  })
  .strict();

export const privateContinuationActionOfferContentSchema =
  failClosedCanonicalBoundary(
    privateActionOfferContentObjectSchema.superRefine(refinePrivateActionOffer)
  );

const privateActionOfferSealedObjectSchema =
  privateActionOfferContentObjectSchema
    .extend({ offerSha256: sha256Schema })
    .strict();

export const privateContinuationActionOfferSchema = failClosedCanonicalBoundary(
  privateActionOfferSealedObjectSchema.superRefine((value, context) => {
    refinePrivateActionOffer(value, context);
    refineComputedStringIntegrity(
      value.offerSha256,
      () => privateContinuationActionOfferSha256(value),
      context,
      ["offerSha256"],
      "Action offer hash mismatch"
    );
  })
);

export const continuationPublicActionRefSchema = z
  .object({
    contract: z.literal(CONTINUATION_PUBLIC_ACTION_REF_CONTRACT),
    actionRef: publicActionRefSchema,
    capability: z.enum(["open_source", "open_setup_surface"]),
    expiresAt: timestampSchema,
    explicitUserActionRequired: z.literal(true)
  })
  .strict();

const continuationPublicItemObjectSchema = z
  .object({
    itemRef: publicItemRefSchema,
    workContextRef: publicWorkContextRefSchema.nullable(),
    kind: z.enum([
      "recent_github_push",
      "recent_codex_session",
      "local_worktree",
      "linked_workstream",
      "workspace_mapping"
    ]),
    title: publicTitleSchema,
    summary: publicSummarySchema,
    observedAt: timestampSchema,
    expiresAt: timestampSchema,
    evidenceBand: z.enum([
      "exact",
      "corroborated",
      "single_source",
      "setup"
    ]),
    capability: continuationMvpPublicCapabilitySchema,
    action: continuationPublicActionRefSchema.nullable(),
    caveatCodes: z.array(reasonCodeSchema).max(8)
  })
  .strict();

export const continuationPublicItemSchema =
  continuationPublicItemObjectSchema.superRefine((value, context) => {
    refineCanonicalStringArray(value.caveatCodes, context, ["caveatCodes"]);
    if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) {
      addIssue(context, ["expiresAt"], "Public item expiry must follow activity");
    }
    if (value.capability === "display" && value.action !== null) {
      addIssue(context, ["action"], "Display-only item cannot carry an action");
    }
    if (value.capability !== "display") {
      if (value.action === null || value.action.capability !== value.capability) {
        addIssue(context, ["action"], "Public action must match capability");
      }
    }
  });

export const continuationPublicDecisionSchema = z
  .object({
    contract: z.literal(CONTINUATION_PUBLIC_DECISION_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_PUBLIC_DECISION_SCHEMA_VERSION),
    generatedAt: timestampSchema,
    status: continuationDecisionStatusSchema,
    primary: continuationPublicItemSchema.nullable(),
    alternatives: z.array(continuationPublicItemSchema).max(2),
    coverageCode: z.enum([
      "COMPLETE",
      "SOURCE_LOCAL_PARTIAL",
      "INSUFFICIENT",
      "UNAVAILABLE"
    ])
  })
  .strict()
  .superRefine((value, context) => {
    const items = [
      ...(value.primary === null ? [] : [value.primary]),
      ...value.alternatives
    ];
    const itemRefs = [
      ...(value.primary === null ? [] : [value.primary.itemRef]),
      ...value.alternatives.map((item) => item.itemRef)
    ];
    if (new Set(itemRefs).size !== itemRefs.length) {
      addIssue(context, ["alternatives"], "Public items must be unique");
    }
    for (const [index, item] of items.entries()) {
      const path =
        value.primary !== null && index === 0
          ? ["primary"]
          : ["alternatives", value.primary === null ? index : index - 1];
      if (Date.parse(item.observedAt) > Date.parse(value.generatedAt)) {
        addIssue(
          context,
          [...path, "observedAt"],
          "Public item activity cannot be in the future"
        );
      }
      if (Date.parse(item.expiresAt) <= Date.parse(value.generatedAt)) {
        addIssue(
          context,
          [...path, "expiresAt"],
          "Public item must be active when generated"
        );
      }
      if (item.action !== null) {
        if (
          Date.parse(item.action.expiresAt) <= Date.parse(value.generatedAt) ||
          Date.parse(item.action.expiresAt) > Date.parse(item.expiresAt)
        ) {
          addIssue(
            context,
            [...path, "action", "expiresAt"],
            "Public action must expire after generation and no later than its item"
          );
        }
      }
    }
    refinePublicDecisionStatus(value, context);
  });

export type ContinuationSourceIdentity = z.infer<
  typeof continuationSourceIdentitySchema
>;
export type ContinuationInternalCapability = z.infer<
  typeof continuationInternalCapabilitySchema
>;
export type ContinuationMvpPublicCapability = z.infer<
  typeof continuationMvpPublicCapabilitySchema
>;
export type ContinuationDecisionStatus = z.infer<
  typeof continuationDecisionStatusSchema
>;
export type ContinuationContextLinkProjection = z.infer<
  typeof continuationContextLinkProjectionSchema
>;
export type ContinuationObservationPayload = z.infer<
  typeof continuationObservationPayloadSchema
>;
export type ContinuationObservationContent = z.infer<
  typeof continuationObservationContentSchema
>;
export type ContinuationObservation = z.infer<
  typeof continuationObservationSchema
>;
export type ContinuationDependencies = z.infer<
  typeof continuationDependenciesSchema
>;
export type ContinuationInputContent = z.infer<
  typeof continuationInputContentSchema
>;
export type ContinuationInput = z.infer<typeof continuationInputSchema>;
export type ContinuationScoreBreakdown = z.infer<
  typeof continuationScoreBreakdownSchema
>;
export type ContinuationPrivateActionTarget = z.infer<
  typeof continuationPrivateActionTargetSchema
>;
export type ContinuationCandidateContent = z.infer<
  typeof continuationCandidateContentSchema
>;
export type ContinuationCandidate = z.infer<
  typeof continuationCandidateSchema
>;
export type ContinuationRunMetadata = z.infer<
  typeof continuationRunMetadataSchema
>;
export type ContinuationDecisionContent = z.infer<
  typeof continuationDecisionContentSchema
>;
export type ContinuationDecision = z.infer<
  typeof continuationDecisionSchema
>;
type ContinuationDecisionArtifactContent = ContinuationDecisionContent & {
  semanticResultSha256: string;
};
export type PrivateContinuationActionOfferContent = z.infer<
  typeof privateContinuationActionOfferContentSchema
>;
export type PrivateContinuationActionOffer = z.infer<
  typeof privateContinuationActionOfferSchema
>;
export type ContinuationPublicActionRef = z.infer<
  typeof continuationPublicActionRefSchema
>;
export type ContinuationPublicItem = z.infer<
  typeof continuationPublicItemSchema
>;
export type ContinuationPublicDecision = z.infer<
  typeof continuationPublicDecisionSchema
>;

export function createContinuationContextLinkId(input: {
  workContextId: string;
  sourceIdentity: ContinuationSourceIdentity;
  proposedAt: string;
}): string {
  return runtimeStableId(
    "continuation_context_link",
    CONTINUATION_ID_POLICY_VERSION,
    {
      workContextId: input.workContextId,
      sourceIdentity: input.sourceIdentity,
      proposedAt: input.proposedAt
    }
  );
}

export function createContinuationObservationId(input: {
  sourceIdentity: ContinuationSourceIdentity;
  sourceRecordRef: string;
  observedAt: string;
}): string {
  const canonicalObservedAt = new Date(input.observedAt).toISOString();
  return runtimeStableId(
    "continuation_observation",
    CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
    {
      sourceIdentity: input.sourceIdentity,
      sourceRecordRef: input.sourceRecordRef,
      observedAt: canonicalObservedAt
    }
  );
}

export function createContinuationCandidateId(input: {
  candidateKind: ContinuationCandidateContent["candidateKind"];
  workContextId: string | null;
  sourceObservationIds: string[];
  observedAt: string;
}): string {
  return runtimeStableId(
    "continuation_candidate",
    CONTINUATION_ID_POLICY_VERSION,
    {
      candidateKind: input.candidateKind,
      workContextId: input.workContextId,
      sourceObservationIds: input.sourceObservationIds,
      observedAt: input.observedAt
    }
  );
}

export function createPrivateContinuationActionOfferId(input: {
  actionRef: string;
  candidateId: string;
  capability: "open_source" | "open_setup_surface";
  issuedAt: string;
}): string {
  return runtimeStableId(
    "continuation_offer",
    CONTINUATION_ID_POLICY_VERSION,
    {
      actionRef: input.actionRef,
      candidateId: input.candidateId,
      capability: input.capability,
      issuedAt: input.issuedAt
    }
  );
}

export function sealContinuationObservation(
  contentInput: ContinuationObservationContent
): ContinuationObservation {
  const content = continuationObservationContentSchema.parse(contentInput);
  return continuationObservationSchema.parse({
    ...content,
    observationSha256: continuationObservationSha256(content)
  });
}

export function continuationObservationSha256(
  value: ContinuationObservation | ContinuationObservationContent
): string {
  const content = withoutObservationHash(value);
  return runtimeSha256({
    domain: OBSERVATION_HASH_DOMAIN,
    observation: content
  });
}

export function verifyContinuationObservationIntegrity(input: unknown): boolean {
  try {
    return continuationObservationSchema.safeParse(input).success;
  } catch {
    return false;
  }
}

export function sealContinuationInput(
  contentInput: ContinuationInputContent
): ContinuationInput {
  const content = continuationInputContentSchema.parse(contentInput);
  return continuationInputSchema.parse({
    ...content,
    inputSha256: continuationInputSha256(content)
  });
}

export function continuationInputSha256(
  value: ContinuationInput | ContinuationInputContent
): string {
  const content = withoutInputHash(value);
  return runtimeSha256({ domain: INPUT_HASH_DOMAIN, input: content });
}

export function verifyContinuationInputIntegrity(input: unknown): boolean {
  try {
    return continuationInputSchema.safeParse(input).success;
  } catch {
    return false;
  }
}

export function sealContinuationCandidate(
  contentInput: ContinuationCandidateContent
): ContinuationCandidate {
  const content = continuationCandidateContentSchema.parse(contentInput);
  return continuationCandidateSchema.parse({
    ...content,
    candidateSha256: continuationCandidateSha256(content)
  });
}

export function continuationCandidateSha256(
  value: ContinuationCandidate | ContinuationCandidateContent
): string {
  const content = withoutCandidateHash(value);
  return runtimeSha256({ domain: CANDIDATE_HASH_DOMAIN, candidate: content });
}

export function verifyContinuationCandidateIntegrity(input: unknown): boolean {
  try {
    return continuationCandidateSchema.safeParse(input).success;
  } catch {
    return false;
  }
}

export function sealContinuationDecision(
  contentInput: ContinuationDecisionContent
): ContinuationDecision {
  const content = continuationDecisionContentSchema.parse(contentInput);
  const artifactContent: ContinuationDecisionArtifactContent = {
    ...content,
    semanticResultSha256:
      digestContinuationDecisionSemanticUnchecked(content)
  };
  return continuationDecisionSchema.parse({
    ...artifactContent,
    resultSha256: digestContinuationDecisionArtifactUnchecked(artifactContent)
  });
}

export function continuationDecisionSemanticSha256(
  value: ContinuationDecision | ContinuationDecisionContent
): string {
  return digestContinuationDecisionSemanticUnchecked(value);
}

export function continuationDecisionSha256(
  value: ContinuationDecision | ContinuationDecisionContent
): string {
  const artifact = withoutDecisionResultHash(value);
  const artifactContent: ContinuationDecisionArtifactContent = {
    ...withoutDecisionHashes(value),
    semanticResultSha256:
      artifact.semanticResultSha256 ??
      digestContinuationDecisionSemanticUnchecked(value)
  };
  return digestContinuationDecisionArtifactUnchecked(artifactContent);
}

export function verifyContinuationDecisionIntegrity(input: unknown): boolean {
  try {
    return continuationDecisionSchema.safeParse(input).success;
  } catch {
    return false;
  }
}

export function sealPrivateContinuationActionOffer(
  contentInput: PrivateContinuationActionOfferContent
): PrivateContinuationActionOffer {
  const content = privateContinuationActionOfferContentSchema.parse(contentInput);
  return privateContinuationActionOfferSchema.parse({
    ...content,
    offerSha256: privateContinuationActionOfferSha256(content)
  });
}

export function privateContinuationActionOfferSha256(
  value:
    | PrivateContinuationActionOffer
    | PrivateContinuationActionOfferContent
): string {
  const content = withoutActionOfferHash(value);
  return runtimeSha256({ domain: ACTION_OFFER_HASH_DOMAIN, offer: content });
}

export function verifyPrivateContinuationActionOfferIntegrity(
  input: unknown
): boolean {
  try {
    return privateContinuationActionOfferSchema.safeParse(input).success;
  } catch {
    return false;
  }
}

function refineContextLink(
  value: z.infer<typeof contextLinkBaseSchema>,
  context: z.RefinementCtx
): void {
  refineComputedStringIntegrity(
    value.contextLinkId,
    () => createContinuationContextLinkId(value),
    context,
    ["contextLinkId"],
    "Context link ID integrity mismatch"
  );
  if (value.status === "proposed") {
    if (
      value.confirmedAt !== null ||
      value.deletedAt !== null ||
      value.confirmationSource !== null
    ) {
      addIssue(context, ["status"], "Proposed link cannot be confirmed or deleted");
    }
  }
  if (value.status === "confirmed") {
    if (
      value.confirmedAt === null ||
      value.confirmationSource !== "explicit_user" ||
      value.deletedAt !== null
    ) {
      addIssue(context, ["status"], "Confirmed link requires explicit user confirmation");
    }
  }
  if (value.status === "deleted" && value.deletedAt === null) {
    addIssue(context, ["deletedAt"], "Deleted link requires deletion time");
  }
  if (value.status !== "deleted" && value.deletedAt !== null) {
    addIssue(context, ["deletedAt"], "Only deleted links carry deletion time");
  }
}

function refineObservationContent(
  value: z.infer<typeof observationContentObjectSchema>,
  context: z.RefinementCtx
): void {
  refineComputedStringIntegrity(
    value.observationId,
    () => createContinuationObservationId(value),
    context,
    ["observationId"],
    "Observation ID integrity mismatch"
  );
  const expectedSource =
    value.payload.kind === "github_push"
      ? "github"
      : value.payload.kind === "codex_session_activity"
        ? "codex"
        : "local_git";
  if (value.sourceIdentity.source !== expectedSource) {
    addIssue(context, ["sourceIdentity"], "Payload and source identity disagree");
  }
  const expectedProvenance =
    expectedSource === "github"
      ? {
          sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
          adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION
        }
      : expectedSource === "codex"
        ? {
            sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
            adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION
          }
        : {
            sourceSchemaVersion: CONTINUATION_LOCAL_GIT_SOURCE_SCHEMA_VERSION,
            adapterVersion: CONTINUATION_LOCAL_GIT_ADAPTER_VERSION
          };
  if (
    value.sourceSchemaVersion !== expectedProvenance.sourceSchemaVersion ||
    value.adapterVersion !== expectedProvenance.adapterVersion
  ) {
    addIssue(
      context,
      ["sourceSchemaVersion"],
      "Observation source, schema, and adapter versions must be an exact supported tuple"
    );
  }
  const sourceTime =
    value.payload.kind === "github_push"
      ? value.payload.pushOccurredAt
      : value.payload.kind === "codex_session_activity"
        ? value.payload.sessionUpdatedAt
        : null;
  if (sourceTime !== null && sourceTime !== value.observedAt) {
    addIssue(context, ["observedAt"], "Observation time must preserve source time");
  }
  if (Date.parse(value.snapshotCapturedAt) < Date.parse(value.observedAt)) {
    addIssue(context, ["snapshotCapturedAt"], "Snapshot precedes source activity");
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) {
    addIssue(context, ["expiresAt"], "Observation expiry must follow activity");
  }
  refineCanonicalStringArray(value.evidenceRefs, context, ["evidenceRefs"]);
  refineCanonicalStringArray(value.conflictCodes, context, ["conflictCodes"]);
  refineCanonicalStringArray(value.errorCodes, context, ["errorCodes"]);
}

function refineInputContent(
  value: z.infer<typeof inputContentObjectSchema>,
  context: z.RefinementCtx
): void {
  refineCanonicalObjectArray(
    value.contextLinks,
    (link) => link.contextLinkId,
    context,
    ["contextLinks"]
  );
  refineCanonicalObjectArray(
    value.observations,
    (observation) => observation.observationId,
    context,
    ["observations"]
  );
  for (const [index, observation] of value.observations.entries()) {
    if (
      Date.parse(observation.observedAt) > Date.parse(value.asOf) ||
      Date.parse(observation.snapshotCapturedAt) > Date.parse(value.asOf)
    ) {
      addIssue(
        context,
        ["observations", index],
        "Continuation input rejects future observations"
      );
    }
    if (observation.sourceIdentity.source !== "local_git") {
      const dependency = value.dependencies[observation.sourceIdentity.source];
      if (
        dependency.state !== "available" ||
        dependency.sourceSchemaVersion !== observation.sourceSchemaVersion ||
        dependency.adapterVersion !== observation.adapterVersion ||
        dependency.snapshotSha256 !== observation.sourceSnapshotSha256
      ) {
        addIssue(
          context,
          ["observations", index],
          "Observation provenance must match its available source dependency"
        );
      }
    }
  }
}

function refineCandidateContent(
  value: z.infer<typeof candidateContentObjectSchema>,
  context: z.RefinementCtx
): void {
  refineComputedStringIntegrity(
    value.candidateId,
    () => createContinuationCandidateId(value),
    context,
    ["candidateId"],
    "Candidate ID integrity mismatch"
  );
  refineCanonicalStringArray(
    value.sourceObservationIds,
    context,
    ["sourceObservationIds"]
  );
  refineCanonicalStringArray(value.reasonCodes, context, ["reasonCodes"]);
  refineCanonicalStringArray(value.caveatCodes, context, ["caveatCodes"]);
  const score =
    value.scoreBreakdown.recency +
    value.scoreBreakdown.exactCorroboration +
    value.scoreBreakdown.resumability +
    value.scoreBreakdown.localContinuity +
    value.scoreBreakdown.explicitPreference;
  if (value.continuityScore !== score) {
    addIssue(context, ["continuityScore"], "Continuity score must equal breakdown sum");
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.observedAt)) {
    addIssue(context, ["expiresAt"], "Candidate expiry must follow activity");
  }
  if (value.capability === "display") {
    if (value.availability !== "ready" || value.privateActionTarget !== null) {
      addIssue(context, ["capability"], "Display candidate must be ready and actionless");
    }
    return;
  }
  if (value.capability === "open_source") {
    if (
      value.availability !== "ready" ||
      value.privateActionTarget?.capability !== "open_source"
    ) {
      addIssue(context, ["capability"], "Open-source candidate requires matching ready target");
    }
    return;
  }
  if (value.capability === "open_setup_surface") {
    if (
      value.availability !== "setup_required" ||
      value.evidenceBand !== "setup" ||
      value.privateActionTarget?.capability !== "open_setup_surface"
    ) {
      addIssue(context, ["capability"], "Setup candidate requires bounded setup target");
    }
    return;
  }
  if (
    value.availability !== "future_capability_blocked" ||
    value.privateActionTarget !== null
  ) {
    addIssue(context, ["capability"], "Future capability must remain blocked and actionless");
  }
}

function refineDecisionContent(
  value: z.infer<typeof decisionContentObjectSchema>,
  context: z.RefinementCtx
): void {
  refineCanonicalStringArray(value.reasonCodes, context, ["reasonCodes"]);
  const candidates = [
    ...(value.primary === null ? [] : [value.primary]),
    ...value.alternatives
  ];
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    addIssue(context, ["alternatives"], "Decision candidates must be unique");
  }
  const workContextIds = candidates
    .map((candidate) => candidate.workContextId)
    .filter((id): id is string => id !== null);
  if (new Set(workContextIds).size !== workContextIds.length) {
    addIssue(context, ["alternatives"], "Decision must diversify WorkContexts");
  }
  for (let index = 1; index < candidates.length; index += 1) {
    if (compareContinuationCandidates(candidates[index - 1]!, candidates[index]!) > 0) {
      addIssue(context, ["alternatives"], "Decision candidates are not canonically ranked");
      break;
    }
  }
  for (const [index, candidate] of candidates.entries()) {
    const path =
      value.primary !== null && index === 0
        ? ["primary"]
        : ["alternatives", value.primary === null ? index : index - 1];
    if (Date.parse(candidate.observedAt) > Date.parse(value.asOf)) {
      addIssue(
        context,
        [...path, "observedAt"],
        "Candidate activity cannot be after decision time"
      );
    }
    if (Date.parse(candidate.expiresAt) <= Date.parse(value.asOf)) {
      addIssue(
        context,
        [...path, "expiresAt"],
        "Candidate must be active at decision time"
      );
    }
  }

  const allowedRunStatuses =
    value.status === "unavailable"
      ? ["rejected", "failed"]
      : value.status === "insufficient_evidence"
        ? ["completed", "partial", "rejected"]
        : ["completed", "partial"];
  if (!allowedRunStatuses.includes(value.run.status)) {
    addIssue(
      context,
      ["run", "status"],
      "Run status does not match decision status"
    );
  }

  if (value.status === "offers_available") {
    if (
      value.primary === null ||
      value.primary.availability !== "ready" ||
      !["display", "open_source"].includes(value.primary.capability)
    ) {
      addIssue(
        context,
        ["primary"],
        "Available decision requires display or open-source ready primary"
      );
    }
    if (
      candidates.some(
        (candidate) =>
          candidate.availability !== "ready" ||
          !["display", "open_source"].includes(candidate.capability)
      )
    ) {
      addIssue(
        context,
        ["alternatives"],
        "Available decision candidates must use available capabilities"
      );
    }
  } else if (value.status === "setup_required") {
    if (
      value.primary === null ||
      value.primary.availability !== "setup_required" ||
      value.primary.capability !== "open_setup_surface"
    ) {
      addIssue(
        context,
        ["primary"],
        "Setup decision requires open-setup-surface primary"
      );
    }
    if (
      candidates.some(
        (candidate) =>
          candidate.availability !== "setup_required" ||
          candidate.capability !== "open_setup_surface"
      )
    ) {
      addIssue(
        context,
        ["alternatives"],
        "Setup decision alternatives must remain setup-only"
      );
    }
  } else if (value.primary !== null || value.alternatives.length !== 0) {
    addIssue(context, ["primary"], "Empty decision status cannot carry candidates");
  }
  if (value.status === "unavailable" && value.coverageCode !== "UNAVAILABLE") {
    addIssue(
      context,
      ["coverageCode"],
      "Unavailable decision requires unavailable coverage"
    );
  }
  if (value.status !== "unavailable" && value.coverageCode === "UNAVAILABLE") {
    addIssue(context, ["coverageCode"], "Unavailable coverage requires unavailable status");
  }
}

function refinePrivateActionOffer(
  value: z.infer<typeof privateActionOfferContentObjectSchema>,
  context: z.RefinementCtx
): void {
  refineComputedStringIntegrity(
    value.offerId,
    () => createPrivateContinuationActionOfferId(value),
    context,
    ["offerId"],
    "Action offer ID integrity mismatch"
  );
  if (value.privateActionTarget.capability !== value.capability) {
    addIssue(context, ["privateActionTarget"], "Private target must match offer capability");
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    addIssue(context, ["expiresAt"], "Action offer expiry must follow issue time");
  }
}

function refinePublicDecisionStatus(
  value: {
    status: ContinuationDecisionStatus;
    primary: ContinuationPublicItem | null;
    alternatives: ContinuationPublicItem[];
    coverageCode:
      | "COMPLETE"
      | "SOURCE_LOCAL_PARTIAL"
      | "INSUFFICIENT"
      | "UNAVAILABLE";
  },
  context: z.RefinementCtx
): void {
  const items = [
    ...(value.primary === null ? [] : [value.primary]),
    ...value.alternatives
  ];
  if (value.status === "offers_available") {
    if (
      value.primary === null ||
      !["display", "open_source"].includes(value.primary.capability) ||
      value.primary.evidenceBand === "setup"
    ) {
      addIssue(
        context,
        ["primary"],
        "Public available decision requires a non-setup display or open-source primary"
      );
    }
    if (
      items.some(
        (item) =>
          !["display", "open_source"].includes(item.capability) ||
          item.evidenceBand === "setup"
      )
    ) {
      addIssue(
        context,
        ["alternatives"],
        "Public available alternatives must remain non-setup"
      );
    }
  } else if (value.status === "setup_required") {
    if (
      value.primary === null ||
      value.primary.capability !== "open_setup_surface" ||
      value.primary.evidenceBand !== "setup"
    ) {
      addIssue(
        context,
        ["primary"],
        "Public setup decision requires an open-setup-surface primary"
      );
    }
    if (
      items.some(
        (item) =>
          item.capability !== "open_setup_surface" ||
          item.evidenceBand !== "setup"
      )
    ) {
      addIssue(
        context,
        ["alternatives"],
        "Public setup alternatives must remain setup-only"
      );
    }
  } else if (value.primary !== null || value.alternatives.length !== 0) {
    addIssue(context, ["primary"], "Public empty status cannot carry items");
  }
  if (value.status === "unavailable" && value.coverageCode !== "UNAVAILABLE") {
    addIssue(context, ["coverageCode"], "Unavailable public decision requires unavailable coverage");
  }
  if (value.status !== "unavailable" && value.coverageCode === "UNAVAILABLE") {
    addIssue(
      context,
      ["coverageCode"],
      "Unavailable public coverage requires unavailable status"
    );
  }
}

function publicSafeTextSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .superRefine((value, context) => {
      if (
        publicSafeTextForbiddenPatterns.some((pattern) => pattern.test(value))
      ) {
        addIssue(
          context,
          [],
          "Public text contains a private identifier, location, URL, SHA, or control character"
        );
      }
    });
}

function compareContinuationCandidates(
  left: ContinuationCandidate,
  right: ContinuationCandidate
): number {
  if (left.continuityScore !== right.continuityScore) {
    return right.continuityScore - left.continuityScore;
  }
  return compareRuntimeStrings(left.candidateId, right.candidateId);
}

function refineCanonicalStringArray(
  values: string[],
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareRuntimeStrings(values[index - 1]!, values[index]!) >= 0) {
      addIssue(context, path, "Array must be canonical and unique");
      return;
    }
  }
}

function refineCanonicalObjectArray<T>(
  values: T[],
  key: (value: T) => string,
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  refineCanonicalStringArray(values.map(key), context, path);
}

function addIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function failClosedCanonicalBoundary<T extends z.ZodTypeAny>(
  schema: T
): z.ZodEffects<T, z.output<T>, unknown> {
  return z.preprocess((value) => {
    try {
      runtimeSha256(value);
      return value;
    } catch {
      return NON_CANONICAL_BOUNDARY_VALUE;
    }
  }, schema);
}

function refineComputedStringIntegrity(
  actual: string,
  computeExpected: () => string,
  context: z.RefinementCtx,
  path: (string | number)[],
  mismatchMessage: string
): void {
  let expected: string;
  try {
    expected = computeExpected();
  } catch {
    addIssue(
      context,
      path,
      "Integrity value cannot be computed from non-canonical content"
    );
    return;
  }
  if (actual !== expected) {
    addIssue(context, path, mismatchMessage);
  }
}

function withoutObservationHash(
  value: ContinuationObservation | ContinuationObservationContent
): ContinuationObservationContent {
  const { observationSha256: _observationSha256, ...content } =
    value as ContinuationObservation;
  return content as ContinuationObservationContent;
}

function withoutInputHash(
  value: ContinuationInput | ContinuationInputContent
): ContinuationInputContent {
  const { inputSha256: _inputSha256, ...content } = value as ContinuationInput;
  return content as ContinuationInputContent;
}

function withoutCandidateHash(
  value: ContinuationCandidate | ContinuationCandidateContent
): ContinuationCandidateContent {
  const { candidateSha256: _candidateSha256, ...content } =
    value as ContinuationCandidate;
  return content as ContinuationCandidateContent;
}

function withoutDecisionHashes(
  value: ContinuationDecision | ContinuationDecisionContent
): ContinuationDecisionContent {
  const {
    semanticResultSha256: _semanticResultSha256,
    resultSha256: _resultSha256,
    ...content
  } =
    value as ContinuationDecision;
  return content as ContinuationDecisionContent;
}

function withoutDecisionResultHash(
  value: ContinuationDecision | ContinuationDecisionContent
): ContinuationDecisionContent & { semanticResultSha256?: string } {
  const { resultSha256: _resultSha256, ...artifact } =
    value as ContinuationDecision;
  return artifact;
}

function digestContinuationDecisionSemanticUnchecked(
  value: ContinuationDecision | ContinuationDecisionContent
): string {
  const decision = withoutDecisionHashes(value);
  return runtimeSha256({
    domain: DECISION_SEMANTIC_HASH_DOMAIN,
    decision: {
      contract: decision.contract,
      schemaVersion: decision.schemaVersion,
      asOf: decision.asOf,
      status: decision.status,
      primary:
        decision.primary === null
          ? null
          : continuationCandidateSemanticProjection(decision.primary),
      alternatives: decision.alternatives.map(
        continuationCandidateSemanticProjection
      ),
      coverageCode: decision.coverageCode,
      reasonCodes: decision.reasonCodes
    }
  });
}

function continuationCandidateSemanticProjection(
  candidate: ContinuationCandidate
): Record<string, unknown> {
  return {
    contract: candidate.contract,
    schemaVersion: candidate.schemaVersion,
    candidateKind: candidate.candidateKind,
    workContextId: candidate.workContextId,
    localDisplayLabel: candidate.localDisplayLabel,
    observedAt: candidate.observedAt,
    expiresAt: candidate.expiresAt,
    evidenceBand: candidate.evidenceBand,
    capability: candidate.capability,
    availability: candidate.availability,
    continuityScore: candidate.continuityScore,
    scoreBreakdown: candidate.scoreBreakdown,
    reasonCodes: candidate.reasonCodes,
    caveatCodes: candidate.caveatCodes,
    targetCapability: candidate.privateActionTarget?.capability ?? null
  };
}

function digestContinuationDecisionArtifactUnchecked(
  value: ContinuationDecisionArtifactContent
): string {
  return runtimeSha256({ domain: DECISION_HASH_DOMAIN, decision: value });
}

function withoutActionOfferHash(
  value:
    | PrivateContinuationActionOffer
    | PrivateContinuationActionOfferContent
): PrivateContinuationActionOfferContent {
  const { offerSha256: _offerSha256, ...content } =
    value as PrivateContinuationActionOffer;
  return content as PrivateContinuationActionOfferContent;
}
