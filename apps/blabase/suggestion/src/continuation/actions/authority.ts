import { createHmac } from "node:crypto";

import { z } from "zod";

import type { AttentionCodeProvenance } from "../../attention/codeProvenance";
import {
  WORK_CONTEXT_REGISTRY_CONTRACT,
  WORK_CONTEXT_REGISTRY_SCHEMA_VERSION,
  sourceScopeRefSchema,
  workContextRegistrySchema,
  type MappingDecision,
  type WorkContextRegistry
} from "../../context/contracts";
import {
  runtimeCanonicalJson,
  runtimeSha256
} from "../../crossSource/canonicalHash";
import {
  createContinuationScopeBindingRef,
  continuationSourceAdapterBatchSchema
} from "../adapters";
import {
  continuationCandidateSchema,
  type ContinuationCandidate
} from "../contracts";
import {
  continuationCandidateDerivationResultSchema,
  type ContinuationCandidateDerivationResult
} from "../deriveCandidates";
import {
  continuationIdentityInputSchema,
  continuationIdentityResultSchema,
  type ContinuationIdentityInput,
  type ContinuationIdentityResult
} from "../resolveIdentity";
import {
  CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT,
  CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION,
  CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION,
  CONTINUATION_SETUP_ACTION_CAPABILITY,
  CONTINUATION_SETUP_ACTION_DESTINATION,
  CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION,
  CONTINUATION_SETUP_ACTION_NAVIGATE_TO
} from "./versions";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const installationSecretSchema = sha256Schema;
const timestampSchema = z.string().datetime().refine(isCanonicalTimestamp, {
  message: "Timestamp must use canonical UTC ISO form"
});
const itemRefSchema = z
  .string()
  .regex(/^item_ref_[A-Za-z0-9_-]{22,128}$/u);
const candidateIdSchema = z
  .string()
  .regex(/^continuation_candidate_[a-f0-9]{32}$/u);
const codeCommitShaSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);

export const continuationSetupActionAuthKeyIdSchema = z
  .string()
  .regex(/^continuation_setup_action_key_[a-f0-9]{32}$/u);

export const continuationSetupActionStableTargetRefSchema = z
  .string()
  .regex(/^continuation_setup_target_[a-f0-9]{64}$/u);

const setupReasonSchema = z.enum([
  "IDENTITY_MAPPING_NOT_CONFIRMED",
  "IDENTITY_BINDING_CONFLICT"
]);

const authorityContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT),
    schemaVersion: z.literal(
      CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION
    ),
    policyVersion: z.literal(
      CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION
    ),
    namespaceVersion: z.literal(CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION),
    authKeyId: continuationSetupActionAuthKeyIdSchema,
    capability: z.literal(CONTINUATION_SETUP_ACTION_CAPABILITY),
    destination: z.literal(CONTINUATION_SETUP_ACTION_DESTINATION),
    navigateTo: z.literal(CONTINUATION_SETUP_ACTION_NAVIGATE_TO),
    itemRef: itemRefSchema,
    candidateKind: z.literal("workspace_mapping"),
    candidateId: candidateIdSchema,
    workContextSha256: sha256Schema.nullable(),
    sourceObservationSetSha256: sha256Schema,
    observedAt: timestampSchema,
    candidateExpiresAt: timestampSchema,
    setupReason: setupReasonSchema,
    stableTargetRef: continuationSetupActionStableTargetRefSchema,
    source: z.enum(["github", "codex"]),
    registryContract: z.literal(WORK_CONTEXT_REGISTRY_CONTRACT),
    registrySchemaVersion: z.literal(WORK_CONTEXT_REGISTRY_SCHEMA_VERSION),
    identityContract: z.string().min(1).max(120),
    identitySchemaVersion: z.string().min(1).max(120),
    identityPolicyVersion: z.string().min(1).max(120),
    derivationContract: z.string().min(1).max(120),
    derivationSchemaVersion: z.string().min(1).max(120),
    derivationRuleVersion: z.string().min(1).max(120),
    derivationConfigSha256: sha256Schema,
    sourceIdentitySha256: sha256Schema,
    identityResolutionSha256: sha256Schema,
    identityBindingSetSha256: sha256Schema,
    mappingStateSha256: sha256Schema,
    codeCommitSha: codeCommitShaSchema,
    codeState: z.enum(["clean_commit", "declared_commit"]),
    codeFingerprintSha256: z.null()
  })
  .strict();

export const continuationSetupActionAuthoritySchema =
  authorityContentObjectSchema
    .extend({ authoritySha256: sha256Schema })
    .strict()
    .superRefine((value, context) => {
      if (
        value.workContextSha256 !== null ||
        Date.parse(value.observedAt) >= Date.parse(value.candidateExpiresAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Setup action authority must remain an unexpired mapping obligation"
        });
      }
      const { authoritySha256: _authoritySha256, ...content } = value;
      if (
        value.authoritySha256 !==
        continuationSetupActionAuthoritySha256(content)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authoritySha256"],
          message: "Setup action authority hash mismatch"
        });
      }
    });

export type ContinuationSetupActionAuthority = z.infer<
  typeof continuationSetupActionAuthoritySchema
>;
export type ContinuationSetupActionAuthorityContent = z.infer<
  typeof authorityContentObjectSchema
>;

export function continuationSetupActionAuthKeyId(
  installationSecretInput: string
): string {
  const installationSecret = installationSecretSchema.parse(
    installationSecretInput
  );
  return `continuation_setup_action_key_${keyedDigest(
    installationSecret,
    "continuation-setup-action-key-id-v0.1",
    CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION
  ).slice(0, 32)}`;
}

export function continuationSetupActionStableTargetRef(input: {
  installationSecret: string;
  itemRef: string;
  candidateId: string;
  setupReason: z.infer<typeof setupReasonSchema>;
}): string {
  const installationSecret = installationSecretSchema.parse(
    input.installationSecret
  );
  const itemRef = itemRefSchema.parse(input.itemRef);
  const candidateId = candidateIdSchema.parse(input.candidateId);
  const setupReason = setupReasonSchema.parse(input.setupReason);
  return `continuation_setup_target_${keyedDigest(
    installationSecret,
    "continuation-setup-action-stable-target-v0.1",
    {
      itemRef,
      candidateId,
      setupReason,
      capability: CONTINUATION_SETUP_ACTION_CAPABILITY,
      destination: CONTINUATION_SETUP_ACTION_DESTINATION,
      navigateTo: CONTINUATION_SETUP_ACTION_NAVIGATE_TO
    }
  )}`;
}

export function verifyContinuationSetupActionAuthorityForSecret(
  authorityInput: unknown,
  installationSecretInput: string
): authorityInput is ContinuationSetupActionAuthority {
  const authority = continuationSetupActionAuthoritySchema.safeParse(
    authorityInput
  );
  const installationSecret = installationSecretSchema.safeParse(
    installationSecretInput
  );
  if (!authority.success || !installationSecret.success) return false;
  return (
    authority.data.authKeyId ===
      continuationSetupActionAuthKeyId(installationSecret.data) &&
    authority.data.stableTargetRef ===
      continuationSetupActionStableTargetRef({
        installationSecret: installationSecret.data,
        itemRef: authority.data.itemRef,
        candidateId: authority.data.candidateId,
        setupReason: authority.data.setupReason
      })
  );
}

export function createContinuationSetupActionAuthority(input: {
  installationSecret: string;
  itemRef: string;
  candidate: ContinuationCandidate;
  identityInput: ContinuationIdentityInput;
  identityResult: ContinuationIdentityResult;
  derivationResult: ContinuationCandidateDerivationResult;
  codeProvenance: AttentionCodeProvenance;
}): ContinuationSetupActionAuthority {
  const installationSecret = installationSecretSchema.parse(
    input.installationSecret
  );
  const itemRef = itemRefSchema.parse(input.itemRef);
  const candidate = continuationCandidateSchema.parse(input.candidate);
  const identityInput = continuationIdentityInputSchema.parse(
    input.identityInput
  );
  const identityResult = continuationIdentityResultSchema.parse(
    input.identityResult
  );
  const derivationResult = continuationCandidateDerivationResultSchema.parse(
    input.derivationResult
  );
  const codeCommitSha = codeCommitShaSchema.parse(
    input.codeProvenance.codeCommitSha
  );
  if (
    candidate.candidateKind !== "workspace_mapping" ||
    candidate.workContextId !== null ||
    candidate.sourceObservationIds.length !== 1 ||
    candidate.evidenceBand !== "setup" ||
    candidate.capability !== CONTINUATION_SETUP_ACTION_CAPABILITY ||
    candidate.availability !== "setup_required" ||
    input.codeProvenance.codeFingerprintSha256 !== null ||
    (input.codeProvenance.codeState !== "clean_commit" &&
      input.codeProvenance.codeState !== "declared_commit") ||
    identityInput.registry.registrySha256 !== identityResult.registrySha256
  ) {
    throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
  }
  const derivationCandidate = derivationResult.candidates.find(
    (value) => value.candidateId === candidate.candidateId
  );
  if (
    derivationResult.identityResultSha256 !== identityResult.resultSha256 ||
    derivationCandidate === undefined ||
    runtimeCanonicalJson(derivationCandidate) !== runtimeCanonicalJson(candidate)
  ) {
    throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
  }
  const setupReason = setupReasonSchema.parse(
    candidate.reasonCodes.find((reason) => setupReasonSchema.safeParse(reason).success)
  );
  const resolution = identityResult.resolutions.find(
    (value) => value.observationId === candidate.sourceObservationIds[0]
  );
  if (
    resolution === undefined ||
    resolution.workContextId !== null ||
    (resolution.status !== "setup_needed" && resolution.status !== "conflict") ||
    resolution.reasonCodes.length !== 1 ||
    resolution.reasonCodes[0] !== setupReason ||
    resolution.observation.observedAt !== candidate.observedAt ||
    resolution.observation.expiresAt !== candidate.expiresAt
  ) {
    throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
  }
  const identityKey = runtimeCanonicalJson(
    resolution.observation.sourceIdentity
  );
  const bindingRefs = identityInput.adapterBatches
    .flatMap((batch) =>
      continuationSourceAdapterBatchSchema.parse(batch).identityBindings
    )
    .filter(
      (proof) => runtimeCanonicalJson(proof.sourceIdentity) === identityKey
    )
    .map((proof) => proof.scopeBindingRef)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  if (bindingRefs.length === 0) {
    throw new TypeError("SETUP_ACTION_AUTHORITY_REJECTED");
  }
  const mappingStates = currentMappingStates(
    identityInput.registry,
    bindingRefs,
    installationSecret
  );
  const authKeyId = continuationSetupActionAuthKeyId(installationSecret);
  const stableTargetRef = continuationSetupActionStableTargetRef({
    installationSecret,
    itemRef,
    candidateId: candidate.candidateId,
    setupReason
  });
  const content = authorityContentObjectSchema.parse({
    contract: CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT,
    schemaVersion: CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION,
    policyVersion: CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION,
    namespaceVersion: CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION,
    authKeyId,
    capability: CONTINUATION_SETUP_ACTION_CAPABILITY,
    destination: CONTINUATION_SETUP_ACTION_DESTINATION,
    navigateTo: CONTINUATION_SETUP_ACTION_NAVIGATE_TO,
    itemRef,
    candidateKind: "workspace_mapping",
    candidateId: candidate.candidateId,
    workContextSha256: null,
    sourceObservationSetSha256: keyedDigest(
      installationSecret,
      "continuation-setup-action-observation-set-v0.1",
      [...candidate.sourceObservationIds].sort()
    ),
    observedAt: candidate.observedAt,
    candidateExpiresAt: candidate.expiresAt,
    setupReason,
    stableTargetRef,
    source: resolution.observation.sourceIdentity.source,
    registryContract: identityResult.registryContract,
    registrySchemaVersion: identityInput.registry.schemaVersion,
    identityContract: identityResult.contract,
    identitySchemaVersion: identityResult.schemaVersion,
    identityPolicyVersion: identityResult.identityPolicyVersion,
    derivationContract: derivationResult.contract,
    derivationSchemaVersion: derivationResult.schemaVersion,
    derivationRuleVersion: derivationResult.ruleVersion,
    derivationConfigSha256: derivationResult.configSha256,
    sourceIdentitySha256: keyedDigest(
      installationSecret,
      "continuation-setup-action-source-identity-v0.1",
      resolution.observation.sourceIdentity
    ),
    identityResolutionSha256: keyedDigest(
      installationSecret,
      "continuation-setup-action-identity-resolution-v0.1",
      {
        observationId: resolution.observationId,
        source: resolution.observation.sourceIdentity.source,
        sourceSchemaVersion: resolution.observation.sourceSchemaVersion,
        adapterVersion: resolution.observation.adapterVersion,
        observationIdPolicyVersion:
          resolution.observation.observationIdPolicyVersion,
        status: resolution.status,
        workContextId: resolution.workContextId,
        reasonCodes: resolution.reasonCodes,
        observedAt: resolution.observation.observedAt,
        expiresAt: resolution.observation.expiresAt
      }
    ),
    identityBindingSetSha256: keyedDigest(
      installationSecret,
      "continuation-setup-action-identity-binding-set-v0.1",
      bindingRefs
    ),
    mappingStateSha256: keyedDigest(
      installationSecret,
      "continuation-setup-action-mapping-state-v0.1",
      mappingStates
    ),
    codeCommitSha,
    codeState: input.codeProvenance.codeState,
    codeFingerprintSha256: null
  });
  return continuationSetupActionAuthoritySchema.parse({
    ...content,
    authoritySha256: continuationSetupActionAuthoritySha256(content)
  });
}

export function continuationSetupActionAuthoritySha256(
  input:
    | ContinuationSetupActionAuthority
    | ContinuationSetupActionAuthorityContent
): string {
  const { authoritySha256: _authoritySha256, ...content } =
    input as ContinuationSetupActionAuthority;
  return runtimeSha256({
    domain: "continuation-setup-action-authority-hash-v0.1",
    authority: authorityContentObjectSchema.parse(content)
  });
}

function currentMappingStates(
  registryInput: WorkContextRegistry,
  bindingRefs: string[],
  installationSecret: string
): Array<{
  scopeBindingRef: string;
  currentDecision: null | {
    decisionId: string;
    action: MappingDecision["action"];
    projectId: string | null;
    projectArchivedAt: string | null;
  };
}> {
  const registry = workContextRegistrySchema.parse(registryInput);
  return bindingRefs.map((scopeBindingRef) => {
    const decisions = registry.mappingDecisions.filter((decision) => {
      const scope = sourceScopeRefSchema.parse(decision.scope);
      return (
        createContinuationScopeBindingRef(scope, { installationSecret }) ===
        scopeBindingRef
      );
    });
    const superseded = new Set(
      decisions.flatMap((decision) =>
        decision.supersedesDecisionId === null
          ? []
          : [decision.supersedesDecisionId]
      )
    );
    const current =
      decisions.find((decision) => !superseded.has(decision.decisionId)) ??
      null;
    const project =
      current?.projectId === null || current === null
        ? null
        : registry.projects.find(
            (candidate) => candidate.projectId === current.projectId
          ) ?? null;
    return {
      scopeBindingRef,
      currentDecision:
        current === null
          ? null
          : {
              decisionId: current.decisionId,
              action: current.action,
              projectId: current.projectId,
              projectArchivedAt: project?.archivedAt ?? null
            }
    };
  });
}

function keyedDigest(
  installationSecret: string,
  domain: string,
  value: unknown
): string {
  return createHmac(
    "sha256",
    Buffer.from(installationSecretSchema.parse(installationSecret), "hex")
  )
    .update(domain)
    .update("\0")
    .update(runtimeCanonicalJson(value))
    .digest("hex");
}

function isCanonicalTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}
