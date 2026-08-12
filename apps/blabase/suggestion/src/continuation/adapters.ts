import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  continuationObservationSchema,
  continuationSourceIdentitySchema,
  createContinuationObservationId,
  sealContinuationObservation,
  type ContinuationObservation,
  type ContinuationObservationContent,
  type ContinuationSourceIdentity
} from "./contracts";
import {
  sourceScopeRefSchema,
  type SourceScopeRef
} from "../context/contracts";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_OBSERVATION_CONTRACT,
  CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
  CONTINUATION_OBSERVATION_SCHEMA_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
} from "../crossSource/versions";
import {
  validateCodexSnapshot,
  validateGitHubSnapshot
} from "../crossSource/validateSnapshots";

export const CONTINUATION_IDENTITY_BINDING_PROOF_CONTRACT =
  "continuation-identity-binding-proof-v0.1" as const;
export const CONTINUATION_IDENTITY_BINDING_PROOF_SCHEMA_VERSION =
  "continuation-identity-binding-proof-schema-v0.1" as const;

const ADAPTER_BATCH_CONTRACT = "continuation-source-adapter-batch-v0.4" as const;
const ADAPTER_BATCH_SCHEMA_VERSION =
  "continuation-source-adapter-batch-schema-v0.4" as const;
const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_GITHUB_ACTIVITIES = 10_000;
const MAX_GITHUB_REPOSITORIES = 5_000;
const MAX_GITHUB_TASKS = 10_000;
const MAX_GITHUB_INSTALLATIONS = 1_000;
const MAX_CODEX_SESSIONS = 10_000;
const MAX_CODEX_SCOPE_IDS = 1_000;

const exclusionReasonSchema = z.enum([
  "ACTIVITIES_UNAVAILABLE",
  "ACTIVITY_AFTER_SNAPSHOT",
  "ACTIVITY_FROM_FUTURE",
  "DUPLICATE_COLLAPSED",
  "DUPLICATE_CONFLICT",
  "INPUT_LIMIT_EXCEEDED",
  "NON_PUSH_ACTIVITY",
  "OUTSIDE_ACTIVITY_WINDOW",
  "SNAPSHOT_FROM_FUTURE",
  "SNAPSHOT_MISSING",
  "SOURCE_REJECTED",
  "UNSUPPORTED_SOURCE_VERSION"
]);

const exclusionCountSchema = z
  .object({
    reasonCode: exclusionReasonSchema,
    count: z.number().int().positive().max(100_000)
  })
  .strict();

const bindableSourceIdentitySchema = z.union([
  continuationSourceIdentitySchema.and(
    z.object({ source: z.literal("github") }).passthrough()
  ),
  continuationSourceIdentitySchema.and(
    z.object({ source: z.literal("codex") }).passthrough()
  )
]);

const identityBindingProofShape = {
  contract: z.literal(CONTINUATION_IDENTITY_BINDING_PROOF_CONTRACT),
  schemaVersion: z.literal(
    CONTINUATION_IDENTITY_BINDING_PROOF_SCHEMA_VERSION
  ),
  sourceIdentity: bindableSourceIdentitySchema,
  scopeBindingRef: z.string().regex(/^scope_binding_ref_[a-f0-9]{32}$/u),
  sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  adapterVersion: z.union([
    z.literal(CONTINUATION_GITHUB_ADAPTER_VERSION),
    z.literal(CONTINUATION_CODEX_ADAPTER_VERSION)
  ]),
  keyId: z.string().regex(/^installation_key_[a-f0-9]{32}$/u)
} as const;

const identityBindingProofContentSchema = z
  .object(identityBindingProofShape)
  .strict();

export const continuationIdentityBindingProofSchema = z
  .object({
    ...identityBindingProofShape,
    proofSha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
  .superRefine((proof, context) => {
    const expectedAdapterVersion =
      proof.sourceIdentity.source === "github"
        ? CONTINUATION_GITHUB_ADAPTER_VERSION
        : CONTINUATION_CODEX_ADAPTER_VERSION;
    if (proof.adapterVersion !== expectedAdapterVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adapterVersion"],
        message: "Identity binding proof adapter provenance mismatch"
      });
    }
  });

export type ContinuationIdentityBindingProof = z.infer<
  typeof continuationIdentityBindingProofSchema
>;

const identitySecretOptionsSchema = z
  .object({ installationSecret: z.string().min(1).max(1_024) })
  .strict();

export function createContinuationScopeBindingRef(
  sourceScopeInput: unknown,
  optionsInput: { installationSecret: string }
): string {
  const sourceScope = sourceScopeRefSchema.parse(sourceScopeInput);
  const options = identitySecretOptionsSchema.parse(optionsInput);
  return `scope_binding_ref_${keyedDigest(
    options.installationSecret,
    "continuation-scope-binding-ref-v0.1",
    sourceScope
  ).slice(0, 32)}`;
}

export function createContinuationIdentityBindingProof(
  input: {
    sourceIdentity: ContinuationSourceIdentity;
    sourceScope: SourceScopeRef;
    sourceSnapshotSha256: string;
    adapterVersion:
      | typeof CONTINUATION_GITHUB_ADAPTER_VERSION
      | typeof CONTINUATION_CODEX_ADAPTER_VERSION;
  },
  optionsInput: { installationSecret: string }
): ContinuationIdentityBindingProof {
  const options = identitySecretOptionsSchema.parse(optionsInput);
  const sourceIdentity = bindableSourceIdentitySchema.parse(input.sourceIdentity);
  const sourceScope = sourceScopeRefSchema.parse(input.sourceScope);
  if (sourceIdentity.source !== sourceScope.source) {
    throw new Error("Identity binding source mismatch");
  }
  const content = identityBindingProofContentSchema.parse({
    contract: CONTINUATION_IDENTITY_BINDING_PROOF_CONTRACT,
    schemaVersion: CONTINUATION_IDENTITY_BINDING_PROOF_SCHEMA_VERSION,
    sourceIdentity,
    scopeBindingRef: createContinuationScopeBindingRef(sourceScope, options),
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    adapterVersion: input.adapterVersion,
    keyId: `installation_key_${keyedDigest(
      options.installationSecret,
      "continuation-installation-key-id-v0.1",
      "continuation-identity-binding"
    ).slice(0, 32)}`
  });
  return continuationIdentityBindingProofSchema.parse({
    ...content,
    proofSha256: keyedDigest(
      options.installationSecret,
      "continuation-identity-binding-proof-v0.1",
      content
    )
  });
}

export function verifyContinuationIdentityBindingProof(
  proofInput: unknown,
  optionsInput: { installationSecret: string }
): proofInput is ContinuationIdentityBindingProof {
  try {
    const proof = continuationIdentityBindingProofSchema.safeParse(proofInput);
    const options = identitySecretOptionsSchema.safeParse(optionsInput);
    if (!proof.success || !options.success) return false;
    const { proofSha256, ...content } = proof.data;
    const expectedKeyId = `installation_key_${keyedDigest(
      options.data.installationSecret,
      "continuation-installation-key-id-v0.1",
      "continuation-identity-binding"
    ).slice(0, 32)}`;
    return secureEqual(proof.data.keyId, expectedKeyId) && secureEqual(
      proofSha256,
      keyedDigest(
        options.data.installationSecret,
        "continuation-identity-binding-proof-v0.1",
        content
      )
    );
  } catch {
    return false;
  }
}

const commonBatchShape = {
  contract: z.literal(ADAPTER_BATCH_CONTRACT),
  schemaVersion: z.literal(ADAPTER_BATCH_SCHEMA_VERSION),
  status: z.enum(["available", "unavailable"]),
  sourceSnapshotSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  evaluatedAsOf: z.string().datetime(),
  snapshotFreshnessCutoff: z.string().datetime().nullable(),
  sourceAssessment: z
    .object({
      coverage: z.enum(["complete", "partial", "unknown"]),
      freshness: z.enum(["fresh", "stale", "invalid", "unknown"])
    })
    .strict()
    .nullable(),
  observations: z.array(continuationObservationSchema).max(10_000),
  identityBindings: z
    .array(continuationIdentityBindingProofSchema)
    .max(10_000),
  excludedCount: z.number().int().nonnegative().max(100_000),
  exclusions: z.array(exclusionCountSchema).max(16),
  batchSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  batchProofKeyId: z.string().regex(/^installation_key_[a-f0-9]{32}$/u),
  batchProofHmac: z.string().regex(/^[a-f0-9]{64}$/u)
};

const githubBatchSchema = z
  .object({
    ...commonBatchShape,
    source: z.literal("github"),
    sourceSchemaVersion: z.literal(CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION),
    adapterVersion: z.literal(CONTINUATION_GITHUB_ADAPTER_VERSION)
  })
  .strict();

const codexBatchSchema = z
  .object({
    ...commonBatchShape,
    source: z.literal("codex"),
    sourceSchemaVersion: z.literal(CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION),
    adapterVersion: z.literal(CONTINUATION_CODEX_ADAPTER_VERSION)
  })
  .strict();

export const continuationSourceAdapterBatchSchema = z
  .union([githubBatchSchema, codexBatchSchema])
  .superRefine((batch, context) => {
    if (
      (batch.status === "available") !==
      (batch.sourceSnapshotSha256 !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceSnapshotSha256"],
        message: "Available adapter batches require an exact source snapshot hash"
      });
    }
    if (
      (batch.status === "available") !==
        (batch.snapshotFreshnessCutoff !== null) ||
      (batch.status === "available") !==
        (batch.sourceAssessment !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluatedAsOf"],
        message: "Adapter batch availability must match freshness provenance"
      });
    }
    if (
      batch.snapshotFreshnessCutoff !== null &&
      Date.parse(batch.snapshotFreshnessCutoff) >
        Date.parse(batch.evaluatedAsOf)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshotFreshnessCutoff"],
        message: "Freshness cutoff cannot follow its evaluation time"
      });
    }
    if (batch.status === "unavailable" && batch.observations.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations"],
        message: "Unavailable adapter batches cannot carry observations"
      });
    }
    if (batch.status === "unavailable" && batch.identityBindings.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityBindings"],
        message: "Unavailable adapter batches cannot carry identity bindings"
      });
    }
    if (
      batch.excludedCount !==
      batch.exclusions.reduce((total, item) => total + item.count, 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["excludedCount"],
        message: "Excluded count must equal the bounded reason counts"
      });
    }
    if (!isCanonical(batch.observations, (item) => item.observationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations"],
        message: "Observations must be canonical and unique"
      });
    }
    if (
      !isCanonical(batch.identityBindings, (item) =>
        runtimeCanonicalJson(item)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityBindings"],
        message: "Identity bindings must be canonical and unique"
      });
    }
    if (!isCanonical(batch.exclusions, (item) => item.reasonCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exclusions"],
        message: "Exclusions must be canonical and unique"
      });
    }
    const {
      batchSha256: _storedHash,
      batchProofHmac: _batchProofHmac,
      ...content
    } = batch;
    if (batch.batchSha256 !== adapterBatchSha256(content)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["batchSha256"],
        message: "Adapter batch hash mismatch"
      });
    }
    for (const observation of batch.observations) {
      if (
        observation.sourceIdentity.source !== batch.source ||
        observation.sourceSchemaVersion !== batch.sourceSchemaVersion ||
        observation.adapterVersion !== batch.adapterVersion ||
        observation.sourceSnapshotSha256 !== batch.sourceSnapshotSha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["observations"],
          message: "Observation provenance does not match its adapter batch"
        });
        break;
      }
    }
    for (const proof of batch.identityBindings) {
      if (
        proof.sourceIdentity.source !== batch.source ||
        proof.adapterVersion !== batch.adapterVersion ||
        proof.sourceSnapshotSha256 !== batch.sourceSnapshotSha256
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["identityBindings"],
          message: "Identity binding provenance does not match its adapter batch"
        });
        break;
      }
    }
    const observationIdentities = new Set(
      batch.observations.map((item) => identityKey(item.sourceIdentity))
    );
    const proofIdentities = new Set(
      batch.identityBindings.map((item) => identityKey(item.sourceIdentity))
    );
    if (
      observationIdentities.size !== proofIdentities.size ||
      [...observationIdentities].some((identity) => !proofIdentities.has(identity))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identityBindings"],
        message: "Identity bindings must cover the exact observation identity set"
      });
    }
  });

export type ContinuationSourceAdapterBatch = z.infer<
  typeof continuationSourceAdapterBatchSchema
>;

export type ContinuationSourceAdapterOptions = {
  installationSecret: string;
  asOf: string;
  snapshotFreshnessCutoff: string;
};

export function verifyContinuationSourceAdapterBatchProof(
  batchInput: unknown,
  optionsInput: { installationSecret: string }
): boolean {
  try {
    const batch = continuationSourceAdapterBatchSchema.safeParse(batchInput);
    const options = identitySecretOptionsSchema.safeParse(optionsInput);
    if (!batch.success || !options.success) return false;
    const {
      batchSha256: _batchSha256,
      batchProofHmac,
      ...content
    } = batch.data;
    return secureEqual(
      batch.data.batchProofKeyId,
      batchProofKeyIdFor(options.data.installationSecret)
    ) && secureEqual(
      batchProofHmac,
      batchProofHmacFor(options.data.installationSecret, content)
    );
  } catch {
    return false;
  }
}

const optionsSchema = z
  .object({
    installationSecret: z.string().min(1).max(1_024),
    asOf: z.string().datetime(),
    snapshotFreshnessCutoff: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.snapshotFreshnessCutoff) > Date.parse(value.asOf)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshotFreshnessCutoff"],
        message: "Freshness cutoff cannot follow asOf"
      });
    }
  });

export function adaptGitHubContinuationObservations(
  input: unknown,
  optionsInput: ContinuationSourceAdapterOptions
): ContinuationSourceAdapterBatch {
  try {
    return adaptGitHubContinuationObservationsUnchecked(input, optionsInput);
  } catch {
    return unavailableBatch("github", "SOURCE_REJECTED", optionsInput);
  }
}

function adaptGitHubContinuationObservationsUnchecked(
  input: unknown,
  optionsInput: ContinuationSourceAdapterOptions
): ContinuationSourceAdapterBatch {
  const options = optionsSchema.safeParse(optionsInput);
  if (!options.success) {
    return unavailableBatch("github", "SOURCE_REJECTED", optionsInput);
  }
  const rawVersion = schemaVersionOf(input);
  if (input === null || input === undefined) {
    return unavailableBatch("github", "SNAPSHOT_MISSING", options.data);
  }
  if (rawVersion !== CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION) {
    return unavailableBatch("github", "UNSUPPORTED_SOURCE_VERSION", options.data);
  }
  if (
    arrayLength(input, "activities") > MAX_GITHUB_ACTIVITIES ||
    arrayLength(input, "repositories") > MAX_GITHUB_REPOSITORIES ||
    arrayLength(input, "tasks") > MAX_GITHUB_TASKS ||
    arrayLength(input, "installations") > MAX_GITHUB_INSTALLATIONS
  ) {
    return unavailableBatch("github", "INPUT_LIMIT_EXCEEDED", options.data);
  }
  const validated = validateGitHubSnapshot(input);
  if (validated.status !== "ok") {
    return unavailableBatch("github", "SOURCE_REJECTED", options.data);
  }
  const { artifact } = validated;
  const asOfMs = Date.parse(options.data.asOf);
  const snapshotMs = Date.parse(artifact.fetchedAt);
  if (snapshotMs > asOfMs) {
    return unavailableBatch("github", "SNAPSHOT_FROM_FUTURE", options.data);
  }
  const exclusions = new Map<ExclusionReason, number>();
  if (artifact.payload.activitiesState === "unavailable") {
    addExclusion(exclusions, "ACTIVITIES_UNAVAILABLE");
    return availableBatch(
      "github",
      artifact.sourceSnapshotSha256,
      [],
      [],
      exclusions,
      options.data,
      sourceAssessment(
        true,
        snapshotMs,
        options.data.snapshotFreshnessCutoff
      )
    );
  }

  const repositories = new Set(
    artifact.payload.repositories.map((repository) => repository.id)
  );
  const eligible = artifact.payload.activities.filter((activity) => {
    if (activity.activityKind !== "push") {
      addExclusion(exclusions, "NON_PUSH_ACTIVITY");
      return false;
    }
    const occurredAtMs = Date.parse(activity.occurredAt);
    if (occurredAtMs > asOfMs) {
      addExclusion(exclusions, "ACTIVITY_FROM_FUTURE");
      return false;
    }
    if (occurredAtMs > snapshotMs) {
      addExclusion(exclusions, "ACTIVITY_AFTER_SNAPSHOT");
      return false;
    }
    if (occurredAtMs <= asOfMs - ACTIVITY_WINDOW_MS) {
      addExclusion(exclusions, "OUTSIDE_ACTIVITY_WINDOW");
      return false;
    }
    if (!repositories.has(activity.repositoryId)) {
      addExclusion(exclusions, "SOURCE_REJECTED");
      return false;
    }
    return true;
  });
  const retained = dedupeRecords(
    eligible,
    (activity) =>
      opaqueRef(
        "source_record_ref",
        options.data.installationSecret,
        "github-push-record-v0.1",
        activity.id
      ),
    exclusions
  );
  const observations = retained.map((activity) => {
    const sourceIdentity = {
      source: "github" as const,
      opaqueId: opaqueRef(
        "source_ref",
        options.data.installationSecret,
        "github-repository-v0.1",
        activity.repositoryId
      )
    };
    const sourceRecordRef = opaqueRef(
      "source_record_ref",
      options.data.installationSecret,
      "github-push-record-v0.1",
      activity.id
    );
    return sealObservation({
      sourceIdentity,
      sourceRecordRef,
      sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION,
      sourceSnapshotSha256: artifact.sourceSnapshotSha256,
      payload: {
        kind: "github_push",
        pushOccurredAt: activity.occurredAt
      },
      observedAt: activity.occurredAt,
      snapshotCapturedAt: artifact.fetchedAt,
      sourceCoverage:
        artifact.payload.truncated ||
        artifact.payload.activitiesTruncated ||
        artifact.payload.activitiesState === "partial" ||
        Date.parse(artifact.payload.activityWindowStart) >
          asOfMs - ACTIVITY_WINDOW_MS
          ? "partial"
          : "complete",
      snapshotFreshness:
        snapshotMs < Date.parse(options.data.snapshotFreshnessCutoff)
          ? "stale"
          : "fresh",
      evidenceRefs: [
        opaqueRef(
          "evidence",
          options.data.installationSecret,
          "github-push-evidence-v0.1",
          { id: activity.id, artifactId: activity.artifactId }
        )
      ]
    });
  });
  const identityBindings = retained.map((activity) =>
    createContinuationIdentityBindingProof(
      {
        sourceIdentity: {
          source: "github",
          opaqueId: opaqueRef(
            "source_ref",
            options.data.installationSecret,
            "github-repository-v0.1",
            activity.repositoryId
          )
        },
        sourceScope: {
          source: "github",
          resourceType: "repository",
          opaqueId: String(activity.repositoryId)
        },
        sourceSnapshotSha256: artifact.sourceSnapshotSha256,
        adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION
      },
      { installationSecret: options.data.installationSecret }
    )
  );
  return availableBatch(
    "github",
    artifact.sourceSnapshotSha256,
    observations,
    identityBindings,
    exclusions,
    options.data,
    sourceAssessment(
      artifact.payload.truncated ||
        artifact.payload.activitiesTruncated ||
        artifact.payload.activitiesState !== "available" ||
        Date.parse(artifact.payload.activityWindowStart) >
          asOfMs - ACTIVITY_WINDOW_MS,
      snapshotMs,
      options.data.snapshotFreshnessCutoff
    )
  );
}

export function adaptCodexContinuationObservations(
  input: unknown,
  optionsInput: ContinuationSourceAdapterOptions
): ContinuationSourceAdapterBatch {
  try {
    return adaptCodexContinuationObservationsUnchecked(input, optionsInput);
  } catch {
    return unavailableBatch("codex", "SOURCE_REJECTED", optionsInput);
  }
}

function adaptCodexContinuationObservationsUnchecked(
  input: unknown,
  optionsInput: ContinuationSourceAdapterOptions
): ContinuationSourceAdapterBatch {
  const options = optionsSchema.safeParse(optionsInput);
  if (!options.success) {
    return unavailableBatch("codex", "SOURCE_REJECTED", optionsInput);
  }
  const rawVersion = schemaVersionOf(input);
  if (input === null || input === undefined) {
    return unavailableBatch("codex", "SNAPSHOT_MISSING", options.data);
  }
  if (rawVersion !== CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION) {
    return unavailableBatch("codex", "UNSUPPORTED_SOURCE_VERSION", options.data);
  }
  if (
    arrayLength(input, "sessions") > MAX_CODEX_SESSIONS ||
    arrayLength(input, "scopeIds") > MAX_CODEX_SCOPE_IDS
  ) {
    return unavailableBatch("codex", "INPUT_LIMIT_EXCEEDED", options.data);
  }
  const validated = validateCodexSnapshot(input);
  if (validated.status !== "ok") {
    return unavailableBatch("codex", "SOURCE_REJECTED", options.data);
  }
  const { artifact } = validated;
  const asOfMs = Date.parse(options.data.asOf);
  const snapshotMs = Date.parse(artifact.fetchedAt);
  if (snapshotMs > asOfMs) {
    return unavailableBatch("codex", "SNAPSHOT_FROM_FUTURE", options.data);
  }
  const exclusions = new Map<ExclusionReason, number>();
  const eligible = artifact.payload.sessions.filter((session) => {
    const updatedAtMs = Date.parse(session.updatedAt);
    if (updatedAtMs > asOfMs) {
      addExclusion(exclusions, "ACTIVITY_FROM_FUTURE");
      return false;
    }
    if (updatedAtMs > snapshotMs) {
      addExclusion(exclusions, "ACTIVITY_AFTER_SNAPSHOT");
      return false;
    }
    if (updatedAtMs <= asOfMs - ACTIVITY_WINDOW_MS) {
      addExclusion(exclusions, "OUTSIDE_ACTIVITY_WINDOW");
      return false;
    }
    return true;
  });
  const retained = dedupeRecords(
    eligible,
    (session) =>
      opaqueRef(
        "source_record_ref",
        options.data.installationSecret,
        "codex-session-record-v0.1",
        session.id
      ),
    exclusions
  );
  const observations = retained.map((session) => {
    const sourceIdentity = {
      source: "codex" as const,
      opaqueId: opaqueRef(
        "source_ref",
        options.data.installationSecret,
        "codex-session-v0.1",
        session.id
      )
    };
    const sourceRecordRef = opaqueRef(
      "source_record_ref",
      options.data.installationSecret,
      "codex-session-record-v0.1",
      session.id
    );
    const partial =
      artifact.payload.truncated ||
      Date.parse(artifact.payload.lookbackStart) > asOfMs - ACTIVITY_WINDOW_MS ||
      session.content.truncated ||
      ["partial", "stale", "failed", "expired"].includes(
        session.content.state
      );
    return sealObservation({
      sourceIdentity,
      sourceRecordRef,
      sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
      adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION,
      sourceSnapshotSha256: artifact.sourceSnapshotSha256,
      payload: {
        kind: "codex_session_activity",
        sessionUpdatedAt: session.updatedAt,
        boundedActivityCount: Math.min(10_000, session.content.turnCount),
        boundedSummaryAvailable: session.taskSummary !== null
      },
      observedAt: session.updatedAt,
      snapshotCapturedAt: artifact.fetchedAt,
      sourceCoverage: partial ? "partial" : "complete",
      snapshotFreshness:
        snapshotMs < Date.parse(options.data.snapshotFreshnessCutoff)
          ? "stale"
          : "fresh",
      evidenceRefs: [
        opaqueRef(
          "evidence",
          options.data.installationSecret,
          "codex-session-evidence-v0.1",
          session.id
        )
      ]
    });
  });
  const identityBindings = retained.map((session) =>
    createContinuationIdentityBindingProof(
      {
        sourceIdentity: {
          source: "codex",
          opaqueId: opaqueRef(
            "source_ref",
            options.data.installationSecret,
            "codex-session-v0.1",
            session.id
          )
        },
        sourceScope: {
          source: "codex",
          resourceType: "scope",
          opaqueId: session.scopeId
        },
        sourceSnapshotSha256: artifact.sourceSnapshotSha256,
        adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION
      },
      { installationSecret: options.data.installationSecret }
    )
  );
  return availableBatch(
    "codex",
    artifact.sourceSnapshotSha256,
    observations,
    identityBindings,
    exclusions,
    options.data,
    sourceAssessment(
      artifact.payload.truncated ||
        Date.parse(artifact.payload.lookbackStart) >
          asOfMs - ACTIVITY_WINDOW_MS ||
        artifact.payload.sessions.some((session) =>
          session.content.truncated ||
          ["partial", "stale", "failed", "expired"].includes(
            session.content.state
          )
        ),
      snapshotMs,
      options.data.snapshotFreshnessCutoff
    )
  );
}

type AdapterSource = "github" | "codex";
type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

function sealObservation(input: {
  sourceIdentity: ContinuationObservationContent["sourceIdentity"];
  sourceRecordRef: string;
  sourceSchemaVersion: ContinuationObservationContent["sourceSchemaVersion"];
  adapterVersion: ContinuationObservationContent["adapterVersion"];
  sourceSnapshotSha256: string;
  payload: ContinuationObservationContent["payload"];
  observedAt: string;
  snapshotCapturedAt: string;
  sourceCoverage: ContinuationObservationContent["sourceCoverage"];
  snapshotFreshness: ContinuationObservationContent["snapshotFreshness"];
  evidenceRefs: string[];
}): ContinuationObservation {
  const expiresAt = new Date(
    Date.parse(input.observedAt) + ACTIVITY_WINDOW_MS
  ).toISOString();
  return sealContinuationObservation({
    contract: CONTINUATION_OBSERVATION_CONTRACT,
    schemaVersion: CONTINUATION_OBSERVATION_SCHEMA_VERSION,
    observationId: createContinuationObservationId(input),
    observationIdPolicyVersion: CONTINUATION_OBSERVATION_ID_POLICY_VERSION,
    sourceIdentity: input.sourceIdentity,
    sourceRecordRef: input.sourceRecordRef,
    sourceSchemaVersion: input.sourceSchemaVersion,
    adapterVersion: input.adapterVersion,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    workContextId: null,
    payload: input.payload,
    observedAt: input.observedAt,
    snapshotCapturedAt: input.snapshotCapturedAt,
    expiresAt,
    activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
    snapshotFreshnessPolicyVersion:
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
    sourceCoverage: input.sourceCoverage,
    snapshotFreshness: input.snapshotFreshness,
    terminalState: "unknown",
    evidenceRefs: [...input.evidenceRefs].sort(compareRuntimeStrings),
    conflictCodes: [],
    errorCodes: []
  });
}

function availableBatch(
  source: AdapterSource,
  sourceSnapshotSha256: string,
  observationsInput: ContinuationObservation[],
  identityBindingsInput: ContinuationIdentityBindingProof[],
  exclusionMap: Map<ExclusionReason, number>,
  evaluation: ContinuationSourceAdapterOptions,
  assessment: {
    coverage: "complete" | "partial";
    freshness: "fresh" | "stale";
  }
): ContinuationSourceAdapterBatch {
  return sealBatch({
    source,
    status: "available",
    sourceSnapshotSha256,
    evaluatedAsOf: evaluation.asOf,
    snapshotFreshnessCutoff: evaluation.snapshotFreshnessCutoff,
    sourceAssessment: assessment,
    observations: [...observationsInput].sort((left, right) =>
      compareRuntimeStrings(left.observationId, right.observationId)
    ),
    identityBindings: dedupeCanonical(identityBindingsInput),
    exclusions: exclusionCounts(exclusionMap)
  }, evaluation.installationSecret);
}

function unavailableBatch(
  source: AdapterSource,
  reasonCode: ExclusionReason,
  optionsInput: unknown
): ContinuationSourceAdapterBatch {
  const options = optionsSchema.safeParse(optionsInput);
  const installationSecret = options.success
    ? options.data.installationSecret
    : signingSecretForRejectedOptions(optionsInput);
  return sealBatch({
    source,
    status: "unavailable",
    sourceSnapshotSha256: null,
    evaluatedAsOf: options.success
      ? options.data.asOf
      : rejectedEvaluationAsOf(optionsInput),
    snapshotFreshnessCutoff: null,
    sourceAssessment: null,
    observations: [],
    identityBindings: [],
    exclusions: [{ reasonCode, count: 1 }]
  }, installationSecret);
}

function sealBatch(input: {
  source: AdapterSource;
  status: "available" | "unavailable";
  sourceSnapshotSha256: string | null;
  evaluatedAsOf: string;
  snapshotFreshnessCutoff: string | null;
  sourceAssessment: {
    coverage: "complete" | "partial" | "unknown";
    freshness: "fresh" | "stale" | "invalid" | "unknown";
  } | null;
  observations: ContinuationObservation[];
  identityBindings: ContinuationIdentityBindingProof[];
  exclusions: Array<{ reasonCode: ExclusionReason; count: number }>;
}, installationSecret: string): ContinuationSourceAdapterBatch {
  const versions =
    input.source === "github"
      ? {
          sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
          adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION
        }
      : {
          sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
          adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION
        };
  const content = {
    contract: ADAPTER_BATCH_CONTRACT,
    schemaVersion: ADAPTER_BATCH_SCHEMA_VERSION,
    source: input.source,
    ...versions,
    status: input.status,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    evaluatedAsOf: input.evaluatedAsOf,
    snapshotFreshnessCutoff: input.snapshotFreshnessCutoff,
    sourceAssessment: input.sourceAssessment,
    observations: input.observations,
    identityBindings: input.identityBindings,
    excludedCount: input.exclusions.reduce(
      (total, exclusion) => total + exclusion.count,
      0
    ),
    exclusions: input.exclusions,
    batchProofKeyId: batchProofKeyIdFor(installationSecret)
  };
  return continuationSourceAdapterBatchSchema.parse({
    ...content,
    batchSha256: adapterBatchSha256(content),
    batchProofHmac: batchProofHmacFor(installationSecret, content)
  });
}

function adapterBatchSha256(value: unknown): string {
  return runtimeSha256({
    domain: "continuation-source-adapter-batch-hash-v0.4",
    batch: value
  });
}

function batchProofKeyIdFor(installationSecret: string): string {
  return `installation_key_${keyedDigest(
    installationSecret,
    "continuation-adapter-batch-key-id-v0.1",
    "continuation-source-adapter-batch"
  ).slice(0, 32)}`;
}

function batchProofHmacFor(
  installationSecret: string,
  content: unknown
): string {
  return keyedDigest(
    installationSecret,
    "continuation-source-adapter-batch-proof-v0.4",
    content
  );
}

function sourceAssessment(
  partial: boolean,
  snapshotMs: number,
  snapshotFreshnessCutoff: string
): { coverage: "complete" | "partial"; freshness: "fresh" | "stale" } {
  return {
    coverage: partial ? "partial" : "complete",
    freshness:
      snapshotMs < Date.parse(snapshotFreshnessCutoff) ? "stale" : "fresh"
  };
}

function signingSecretForRejectedOptions(value: unknown): string {
  try {
    if (typeof value !== "object" || value === null) {
      return "invalid-continuation-adapter-options";
    }
    const candidate = Reflect.get(value, "installationSecret");
    return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 1_024
      ? candidate
      : "invalid-continuation-adapter-options";
  } catch {
    return "invalid-continuation-adapter-options";
  }
}

function rejectedEvaluationAsOf(value: unknown): string {
  try {
    if (typeof value !== "object" || value === null) {
      return "1970-01-01T00:00:00.000Z";
    }
    const candidate = Reflect.get(value, "asOf");
    return typeof candidate === "string" &&
      Number.isInteger(Date.parse(candidate))
      ? new Date(Date.parse(candidate)).toISOString()
      : "1970-01-01T00:00:00.000Z";
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function keyedDigest(
  installationSecret: string,
  domain: string,
  value: unknown
): string {
  return createHmac("sha256", installationSecret)
    .update(domain)
    .update("\0")
    .update(runtimeCanonicalJson(value))
    .digest("hex");
}

function identityKey(identity: ContinuationSourceIdentity): string {
  return runtimeCanonicalJson(identity);
}

function dedupeCanonical<T>(values: T[]): T[] {
  return [...new Map(
    values.map((value) => [runtimeCanonicalJson(value), value] as const)
  ).entries()]
    .sort(([left], [right]) => compareRuntimeStrings(left, right))
    .map(([, value]) => value);
}

function opaqueRef(
  prefix: "source_ref" | "source_record_ref" | "evidence",
  installationSecret: string,
  domain: string,
  value: unknown
): string {
  const digest = createHmac("sha256", installationSecret)
    .update(runtimeCanonicalJson({ domain, value }))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

function dedupeRecords<T>(
  records: T[],
  identity: (record: T) => string,
  exclusions: Map<ExclusionReason, number>
): T[] {
  const groups = new Map<string, { values: Map<string, T>; total: number }>();
  for (const record of records) {
    const recordIdentity = identity(record);
    const group = groups.get(recordIdentity) ?? {
      values: new Map<string, T>(),
      total: 0
    };
    group.values.set(runtimeCanonicalJson(record), record);
    group.total += 1;
    groups.set(recordIdentity, group);
  }
  const retained: T[] = [];
  for (const group of groups.values()) {
    if (group.values.size > 1) {
      addExclusion(exclusions, "DUPLICATE_CONFLICT", group.total);
      continue;
    }
    const record = group.values.values().next().value as T;
    if (group.total > 1) {
      addExclusion(exclusions, "DUPLICATE_COLLAPSED", group.total - 1);
    }
    retained.push(record);
  }
  return retained.sort((left, right) =>
    compareRuntimeStrings(runtimeCanonicalJson(left), runtimeCanonicalJson(right))
  );
}

function addExclusion(
  map: Map<ExclusionReason, number>,
  reason: ExclusionReason,
  count = 1
): void {
  map.set(reason, Math.min(100_000, (map.get(reason) ?? 0) + count));
}

function exclusionCounts(
  map: Map<ExclusionReason, number>
): Array<{ reasonCode: ExclusionReason; count: number }> {
  return [...map.entries()]
    .sort(([left], [right]) => compareRuntimeStrings(left, right))
    .map(([reasonCode, count]) => ({ reasonCode, count }));
}

function schemaVersionOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>).schemaVersion;
  return typeof value === "string" ? value : null;
}

function arrayLength(input: unknown, key: string): number {
  if (typeof input !== "object" || input === null) return 0;
  const value = (input as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : 0;
}

function isCanonical<T>(values: T[], key: (value: T) => string): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compareRuntimeStrings(key(values[index - 1]!), key(values[index]!)) >= 0) {
      return false;
    }
  }
  return true;
}
