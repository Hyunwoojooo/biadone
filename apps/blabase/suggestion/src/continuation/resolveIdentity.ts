import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  WORK_CONTEXT_REGISTRY_CONTRACT,
  lookupProjectId,
  sourceScopeRefSchema,
  workContextRegistrySchema,
  type SourceScopeRef,
  type WorkContextRegistry
} from "../context/contracts";
import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256
} from "../crossSource/canonicalHash";
import { CONTINUATION_ID_POLICY_VERSION } from "../crossSource/versions";
import {
  continuationObservationSchema,
  sealContinuationObservation,
  type ContinuationObservation,
  type ContinuationSourceIdentity
} from "./contracts";
import {
  continuationSourceAdapterBatchSchema,
  createContinuationScopeBindingRef,
  verifyContinuationSourceAdapterBatchProof,
  verifyContinuationIdentityBindingProof,
  type ContinuationIdentityBindingProof,
  type ContinuationSourceAdapterBatch
} from "./adapters";

export const CONTINUATION_IDENTITY_INPUT_CONTRACT =
  "continuation-identity-input-v0.4" as const;
export const CONTINUATION_IDENTITY_RESULT_CONTRACT =
  "continuation-identity-result-v0.4" as const;
export const CONTINUATION_IDENTITY_SCHEMA_VERSION =
  "continuation-identity-schema-v0.4" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const observationIdSchema = z
  .string()
  .regex(/^continuation_observation_[a-f0-9]{32}$/u);
const resolverOptionsSchema = z
  .object({
    installationSecret: z.string().min(1).max(1_024),
    expectedRegistrySha256: sha256Schema
  })
  .strict();

const sourceFreshnessEvaluationSchema = z
  .object({
    source: z.enum(["github", "codex"]),
    batchSha256: sha256Schema,
    evaluatedAsOf: z.string().datetime(),
    snapshotFreshnessCutoff: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      Date.parse(value.snapshotFreshnessCutoff) > Date.parse(value.evaluatedAsOf)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshotFreshnessCutoff"],
        message: "Freshness cutoff cannot follow its evaluation time"
      });
    }
  });

export const continuationIdentityInputSchema = z
  .object({
    contract: z.literal(CONTINUATION_IDENTITY_INPUT_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_IDENTITY_SCHEMA_VERSION),
    registry: workContextRegistrySchema,
    registryAuthorityKeyId: z
      .string()
      .regex(/^installation_key_[a-f0-9]{32}$/u),
    registryAuthorityHmac: sha256Schema,
    adapterBatches: z.array(continuationSourceAdapterBatchSchema).max(2)
  })
  .strict()
  .superRefine((input, context) => {
    const sources = input.adapterBatches.map((batch) => batch.source);
    if (!isCanonical(sources)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adapterBatches"],
        message: "Identity adapter batches must be canonical and source-unique"
      });
    }
    const observationIds = input.adapterBatches.flatMap((batch) =>
      batch.observations.map((observation) => observation.observationId)
    );
    if (new Set(observationIds).size !== observationIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adapterBatches"],
        message: "Identity input observations must be globally unique"
      });
    }
    input.adapterBatches.forEach((batch, batchIndex) => {
      batch.observations.forEach((observation, observationIndex) => {
        if (observation.workContextId !== null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["adapterBatches", batchIndex, "observations", observationIndex, "workContextId"],
            message: "Identity resolution accepts only unmapped observations"
          });
        }
      });
    });
  });

const identityResolutionSchema = z
  .object({
    observationId: observationIdSchema,
    status: z.enum(["mapped", "setup_needed", "conflict"]),
    workContextId: z.string().regex(/^project_[a-f0-9]{32}$/u).nullable(),
    reasonCodes: z
      .array(z.enum([
        "EXPLICIT_MAPPING_CONFIRMED",
        "IDENTITY_BINDING_CONFLICT",
        "IDENTITY_MAPPING_NOT_CONFIRMED"
      ]))
      .min(1)
      .max(2),
    observation: continuationObservationSchema
  })
  .strict()
  .superRefine((resolution, context) => {
    if (resolution.observation.observationId !== resolution.observationId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["observation"], message: "Resolved observation identity must be preserved" });
    }
    const mapped = resolution.status === "mapped";
    if (mapped !== (resolution.workContextId !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["workContextId"], message: "Only mapped resolutions carry a WorkContext" });
    }
    if (resolution.observation.workContextId !== resolution.workContextId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["observation", "workContextId"], message: "Observation WorkContext must match the resolution" });
    }
  });

const identityResultContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_IDENTITY_RESULT_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_IDENTITY_SCHEMA_VERSION),
    identityPolicyVersion: z.literal(CONTINUATION_ID_POLICY_VERSION),
    registryContract: z.literal(WORK_CONTEXT_REGISTRY_CONTRACT),
    registrySha256: sha256Schema,
    sourceBatchSha256s: z.array(sha256Schema).max(2),
    sourceFreshnessEvaluations: z
      .array(sourceFreshnessEvaluationSchema)
      .max(2),
    mappedCount: z.number().int().nonnegative().max(10_000),
    setupNeededCount: z.number().int().nonnegative().max(10_000),
    conflictCount: z.number().int().nonnegative().max(10_000),
    resolutions: z.array(identityResolutionSchema).max(10_000)
  })
  .strict();
const identityResultContentSchema = identityResultContentObjectSchema.superRefine(refineIdentityResultContent);

export const continuationIdentityResultSchema = identityResultContentObjectSchema
  .extend({ resultSha256: sha256Schema })
  .strict()
  .superRefine((result, context) => {
    refineIdentityResultContent(result, context);
    const { resultSha256: _resultSha256, ...content } = result;
    if (result.resultSha256 !== identityResultSha256(content)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["resultSha256"], message: "Identity result hash mismatch" });
    }
  });

function refineIdentityResultContent(result: z.infer<typeof identityResultContentObjectSchema>, context: z.RefinementCtx): void {
  if (!isCanonical(result.sourceBatchSha256s)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceBatchSha256s"], message: "Source batch hashes must be canonical and unique" });
  }
  if (
    !isCanonical(
      result.sourceFreshnessEvaluations.map((evaluation) => evaluation.source)
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceFreshnessEvaluations"],
      message: "Source freshness evaluations must be canonical and source-unique"
    });
  }
  if (
    new Set(
      result.sourceFreshnessEvaluations.map(
        (evaluation) => evaluation.batchSha256
      )
    ).size !== result.sourceFreshnessEvaluations.length
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceFreshnessEvaluations"],
      message: "Each source freshness evaluation must bind a unique adapter batch"
    });
  }
  if (
    result.sourceFreshnessEvaluations.some(
      (evaluation) => !result.sourceBatchSha256s.includes(evaluation.batchSha256)
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceFreshnessEvaluations"],
      message: "Source freshness evaluation must bind a recorded adapter batch"
    });
  }
  const resolutionSources = [...new Set(
    result.resolutions.map((resolution) => resolution.observation.sourceIdentity.source)
  )].sort(compareRuntimeStrings);
  const evaluationSources = result.sourceFreshnessEvaluations.map(
    (evaluation) => evaluation.source
  );
  if (
    resolutionSources.some(
      (source) =>
        (source !== "github" && source !== "codex") ||
        !evaluationSources.includes(source)
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceFreshnessEvaluations"],
      message: "Resolved observation sources require freshness evaluations"
    });
  }
  if (!isCanonical(result.resolutions.map((item) => item.observationId))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolutions"], message: "Identity resolutions must be canonical and unique" });
  }
  const counts = countStatuses(result.resolutions);
  if (counts.mapped !== result.mappedCount || counts.setup_needed !== result.setupNeededCount || counts.conflict !== result.conflictCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mappedCount"], message: "Identity result counts must be derived from resolutions" });
  }
}

export type ContinuationIdentityInput = z.infer<typeof continuationIdentityInputSchema>;
export type ContinuationIdentityResult = z.infer<typeof continuationIdentityResultSchema>;
export type ContinuationIdentityResolverOptions = z.infer<
  typeof resolverOptionsSchema
>;
export type ContinuationIdentityBoundaryResult =
  | { ok: true; result: ContinuationIdentityResult }
  | { ok: false; code: "IDENTITY_INPUT_REJECTED" };

export function createContinuationIdentityInput(
  value: {
    registry: WorkContextRegistry;
    adapterBatches: ContinuationSourceAdapterBatch[];
  },
  optionsInput: ContinuationIdentityResolverOptions
): ContinuationIdentityInput {
  const options = resolverOptionsSchema.parse(optionsInput);
  const registry = workContextRegistrySchema.parse(value.registry);
  if (!secureEqual(registry.registrySha256, options.expectedRegistrySha256)) {
    throw new TypeError("WorkContext registry does not match trusted authority");
  }
  return continuationIdentityInputSchema.parse({
    contract: CONTINUATION_IDENTITY_INPUT_CONTRACT,
    schemaVersion: CONTINUATION_IDENTITY_SCHEMA_VERSION,
    registry,
    registryAuthorityKeyId: registryAuthorityKeyId(
      options.installationSecret
    ),
    registryAuthorityHmac: registryAuthorityHmac(
      registry,
      options.installationSecret
    ),
    adapterBatches: [...value.adapterBatches].sort((left, right) =>
      compareRuntimeStrings(left.source, right.source)
    )
  });
}

export function resolveContinuationIdentity(input: unknown, optionsInput: ContinuationIdentityResolverOptions): ContinuationIdentityBoundaryResult {
  try {
    const parsed = continuationIdentityInputSchema.safeParse(input);
    const options = resolverOptionsSchema.safeParse(optionsInput);
    if (!parsed.success || !options.success) return { ok: false, code: "IDENTITY_INPUT_REJECTED" };
    const batches = parsed.data.adapterBatches;
    if (
      !secureEqual(
        parsed.data.registryAuthorityKeyId,
        registryAuthorityKeyId(options.data.installationSecret)
      ) ||
      !secureEqual(
        parsed.data.registry.registrySha256,
        options.data.expectedRegistrySha256
      ) ||
      !secureEqual(
        parsed.data.registryAuthorityHmac,
        registryAuthorityHmac(
          parsed.data.registry,
          options.data.installationSecret
        )
      ) ||
      batches.some(
        (batch) => !verifyContinuationSourceAdapterBatchProof(batch, {
          installationSecret: options.data.installationSecret
        })
      )
    ) {
      return { ok: false, code: "IDENTITY_INPUT_REJECTED" };
    }
    const proofs = batches.flatMap((batch) => batch.identityBindings);
    if (proofs.some((proof) => !verifyContinuationIdentityBindingProof(proof, {
      installationSecret: options.data.installationSecret
    }))) {
      return { ok: false, code: "IDENTITY_INPUT_REJECTED" };
    }
    const proofGroups = groupProofs(proofs);
    const scopeIndex = indexRegistryScopes(parsed.data.registry, {
      installationSecret: options.data.installationSecret
    });
    const observations = batches.flatMap((batch) => batch.observations).sort((left, right) => compareRuntimeStrings(left.observationId, right.observationId));
    if (observations.some((observation) => (proofGroups.get(identityKey(observation.sourceIdentity)) ?? []).length === 0)) {
      return { ok: false, code: "IDENTITY_INPUT_REJECTED" };
    }
    const resolutions = observations.map((observation) => resolveObservation(parsed.data.registry, observation, proofGroups, scopeIndex));
    const counts = countStatuses(resolutions);
    const content = identityResultContentSchema.parse({
      contract: CONTINUATION_IDENTITY_RESULT_CONTRACT,
      schemaVersion: CONTINUATION_IDENTITY_SCHEMA_VERSION,
      identityPolicyVersion: CONTINUATION_ID_POLICY_VERSION,
      registryContract: WORK_CONTEXT_REGISTRY_CONTRACT,
      registrySha256: parsed.data.registry.registrySha256,
      sourceBatchSha256s: batches.map((batch) => batch.batchSha256).sort(compareRuntimeStrings),
      sourceFreshnessEvaluations: batches
        .filter((batch) => batch.status === "available")
        .map((batch) => ({
          source: batch.source,
          batchSha256: batch.batchSha256,
          evaluatedAsOf: batch.evaluatedAsOf,
          snapshotFreshnessCutoff: batch.snapshotFreshnessCutoff!
        }))
        .sort((left, right) => compareRuntimeStrings(left.source, right.source)),
      mappedCount: counts.mapped,
      setupNeededCount: counts.setup_needed,
      conflictCount: counts.conflict,
      resolutions
    });
    return { ok: true, result: continuationIdentityResultSchema.parse({ ...content, resultSha256: identityResultSha256(content) }) };
  } catch {
    return { ok: false, code: "IDENTITY_INPUT_REJECTED" };
  }
}

function resolveObservation(registry: WorkContextRegistry, observation: ContinuationObservation, proofGroups: Map<string, ContinuationIdentityBindingProof[]>, scopeIndex: Map<string, SourceScopeRef[]>): z.infer<typeof identityResolutionSchema> {
  const proofs = proofGroups.get(identityKey(observation.sourceIdentity)) ?? [];
  const bindingRefs = [...new Set(proofs.map((proof) => proof.scopeBindingRef))];
  if (bindingRefs.length !== 1) return resolution(observation, "conflict", null, ["IDENTITY_BINDING_CONFLICT"]);
  const scopes = scopeIndex.get(bindingRefs[0]!) ?? [];
  if (scopes.length === 0) return resolution(observation, "setup_needed", null, ["IDENTITY_MAPPING_NOT_CONFIRMED"]);
  const projectIds = [...new Set(scopes.map((scope) => lookupProjectId(registry, scope)).filter((projectId): projectId is string => projectId !== null))];
  if (projectIds.length === 0) return resolution(observation, "setup_needed", null, ["IDENTITY_MAPPING_NOT_CONFIRMED"]);
  if (scopes.length !== 1 || projectIds.length !== 1) return resolution(observation, "conflict", null, ["IDENTITY_BINDING_CONFLICT"]);
  return resolution(observation, "mapped", projectIds[0]!, ["EXPLICIT_MAPPING_CONFIRMED"]);
}

function indexRegistryScopes(registry: WorkContextRegistry, options: { installationSecret: string }): Map<string, SourceScopeRef[]> {
  const unique = new Map<string, SourceScopeRef>();
  for (const decision of registry.mappingDecisions) {
    const scope = sourceScopeRefSchema.parse(decision.scope);
    unique.set(runtimeCanonicalJson(scope), scope);
  }
  const index = new Map<string, SourceScopeRef[]>();
  for (const scope of unique.values()) {
    if (scope.source !== "github" && scope.source !== "codex") continue;
    const ref = createContinuationScopeBindingRef(scope, options);
    index.set(ref, [...(index.get(ref) ?? []), scope]);
  }
  return index;
}

function groupProofs(proofs: ContinuationIdentityBindingProof[]): Map<string, ContinuationIdentityBindingProof[]> {
  const grouped = new Map<string, ContinuationIdentityBindingProof[]>();
  for (const proof of proofs) {
    const key = identityKey(proof.sourceIdentity);
    grouped.set(key, [...(grouped.get(key) ?? []), proof]);
  }
  return grouped;
}

function resolution(observation: ContinuationObservation, status: "mapped" | "setup_needed" | "conflict", workContextId: string | null, reasonCodes: z.infer<typeof identityResolutionSchema>["reasonCodes"]): z.infer<typeof identityResolutionSchema> {
  const { observationSha256: _observationSha256, ...content } = observation;
  return identityResolutionSchema.parse({ observationId: observation.observationId, status, workContextId, reasonCodes, observation: sealContinuationObservation({ ...content, workContextId }) });
}

function identityKey(identity: ContinuationSourceIdentity): string { return runtimeCanonicalJson(identity); }
function identityResultSha256(value: unknown): string { return runtimeSha256({ domain: "continuation-identity-result-hash-v0.4", result: value }); }

function registryAuthorityKeyId(installationSecret: string): string {
  return `installation_key_${keyedDigest(
    installationSecret,
    "continuation-registry-authority-key-id-v0.1",
    "work-context-registry"
  ).slice(0, 32)}`;
}

function registryAuthorityHmac(
  registry: WorkContextRegistry,
  installationSecret: string
): string {
  return keyedDigest(
    installationSecret,
    "continuation-registry-authority-proof-v0.1",
    registry
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

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function countStatuses(resolutions: Array<{ status: "mapped" | "setup_needed" | "conflict" }>): Record<"mapped" | "setup_needed" | "conflict", number> {
  const counts = { mapped: 0, setup_needed: 0, conflict: 0 };
  for (const item of resolutions) counts[item.status] += 1;
  return counts;
}
function isCanonical(values: string[]): boolean {
  for (let index = 1; index < values.length; index += 1) if (compareRuntimeStrings(values[index - 1]!, values[index]!) >= 0) return false;
  return true;
}
