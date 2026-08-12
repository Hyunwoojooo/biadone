import { z } from "zod";

import {
  compareRuntimeStrings,
  runtimeCanonicalJson,
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CANDIDATE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_RESULT_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
  CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  CONTINUATION_RULE_VERSION,
  CONTINUATION_SETUP_TARGET_POLICY_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
} from "../crossSource/versions";
import {
  continuationCandidateSchema,
  createContinuationCandidateId,
  sealContinuationCandidate,
  type ContinuationCandidate,
  type ContinuationCandidateContent,
  type ContinuationObservation
} from "./contracts";
import {
  CONTINUATION_IDENTITY_RESULT_CONTRACT,
  CONTINUATION_IDENTITY_SCHEMA_VERSION,
  continuationIdentityResultSchema,
  type ContinuationIdentityResult
} from "./resolveIdentity";

const MAX_DERIVATION_ITEMS = 10_000;
const MAX_REASON_BUCKETS = 16;
const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const NON_CANONICAL_DERIVATION_BOUNDARY_VALUE = Object.freeze({
  nonCanonicalContinuationDerivationBoundaryValue: true
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const timestampSchema = z.string().datetime();

const exclusionReasonSchema = z.enum([
  "OBSERVATION_CONFLICT_REPORTED",
  "OBSERVATION_ERROR_REPORTED",
  "OBSERVATION_EXPIRED",
  "OBSERVATION_FROM_FUTURE",
  "OBSERVATION_TERMINAL",
  "SNAPSHOT_FRESHNESS_INVALID",
  "SNAPSHOT_FRESHNESS_UNKNOWN",
  "SNAPSHOT_STALE",
  "SUPERSEDED_BY_NEWER_OBSERVATION",
  "UNSUPPORTED_CONTINUATION_SOURCE"
]);

const setupReasonSchema = z.enum([
  "IDENTITY_BINDING_CONFLICT",
  "IDENTITY_MAPPING_NOT_CONFIRMED"
]);

const derivationConfigObjectSchema = z
  .object({
    ruleVersion: z.literal(CONTINUATION_RULE_VERSION),
    candidateContract: z.literal(CONTINUATION_CANDIDATE_CONTRACT),
    candidateSchemaVersion: z.literal(CONTINUATION_CANDIDATE_SCHEMA_VERSION),
    activityWindowPolicyVersion: z.literal(
      CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION
    ),
    snapshotFreshnessPolicyVersion: z.literal(
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
    ),
    setupTargetPolicyVersion: z.literal(
      CONTINUATION_SETUP_TARGET_POLICY_VERSION
    ),
    maxCandidateCount: z.literal(MAX_DERIVATION_ITEMS),
    maxReasonBucketCount: z.literal(MAX_REASON_BUCKETS)
  })
  .strict();

export const CONTINUATION_CANDIDATE_DERIVATION_CONFIG = Object.freeze({
  ruleVersion: CONTINUATION_RULE_VERSION,
  candidateContract: CONTINUATION_CANDIDATE_CONTRACT,
  candidateSchemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  snapshotFreshnessPolicyVersion:
    CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
  setupTargetPolicyVersion: CONTINUATION_SETUP_TARGET_POLICY_VERSION,
  maxCandidateCount: MAX_DERIVATION_ITEMS,
  maxReasonBucketCount: MAX_REASON_BUCKETS
} satisfies z.input<typeof derivationConfigObjectSchema>);

export const continuationCandidateDerivationEnvelopeSchema =
  failClosedCanonicalBoundary(
    z
      .object({
        contract: z.literal(
          CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT
        ),
        schemaVersion: z.literal(
          CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION
        ),
        asOf: timestampSchema,
        config: derivationConfigObjectSchema
      })
      .strict()
  );

const exclusionCountSchema = z
  .object({
    reasonCode: exclusionReasonSchema,
    count: z.number().int().min(1).max(MAX_DERIVATION_ITEMS)
  })
  .strict();

const setupReasonCountSchema = z
  .object({
    reasonCode: setupReasonSchema,
    count: z.number().int().min(1).max(MAX_DERIVATION_ITEMS)
  })
  .strict();

const derivationResultContentObjectSchema = z
  .object({
    contract: z.literal(
      CONTINUATION_CANDIDATE_DERIVATION_RESULT_CONTRACT
    ),
    schemaVersion: z.literal(
      CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION
    ),
    ruleVersion: z.literal(CONTINUATION_RULE_VERSION),
    identityResultContract: z.literal(CONTINUATION_IDENTITY_RESULT_CONTRACT),
    identitySchemaVersion: z.literal(CONTINUATION_IDENTITY_SCHEMA_VERSION),
    identityResultSha256: sha256Schema,
    asOf: timestampSchema,
    configSha256: sha256Schema,
    resolutionCount: z.number().int().nonnegative().max(MAX_DERIVATION_ITEMS),
    admittedObservationCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_DERIVATION_ITEMS),
    candidateCount: z.number().int().nonnegative().max(MAX_DERIVATION_ITEMS),
    setupCandidateCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_DERIVATION_ITEMS),
    excludedCount: z.number().int().nonnegative().max(MAX_DERIVATION_ITEMS),
    candidates: z.array(continuationCandidateSchema).max(MAX_DERIVATION_ITEMS),
    exclusions: z.array(exclusionCountSchema).max(MAX_REASON_BUCKETS),
    setupReasons: z.array(setupReasonCountSchema).max(MAX_REASON_BUCKETS)
  })
  .strict();

export const continuationCandidateDerivationResultContentSchema =
  failClosedCanonicalBoundary(
    derivationResultContentObjectSchema.superRefine(refineDerivationResult)
  );

const derivationResultSealedObjectSchema = derivationResultContentObjectSchema
  .extend({ resultSha256: sha256Schema })
  .strict();

/** Verifies artifact structure and hashes; use the input-bound verifier below
 * when derivation authenticity against a particular R-001 result is required.
 */
export const continuationCandidateDerivationResultSchema =
  failClosedCanonicalBoundary(
    derivationResultSealedObjectSchema.superRefine((value, context) => {
      refineDerivationResult(value, context);
      if (
        value.resultSha256 !==
        continuationCandidateDerivationResultSha256(value)
      ) {
        addIssue(
          context,
          ["resultSha256"],
          "Candidate derivation result hash mismatch"
        );
      }
    })
  );

export type ContinuationCandidateDerivationEnvelope = z.infer<
  typeof continuationCandidateDerivationEnvelopeSchema
>;
export type ContinuationCandidateDerivationResultContent = z.infer<
  typeof continuationCandidateDerivationResultContentSchema
>;
export type ContinuationCandidateDerivationResult = z.infer<
  typeof continuationCandidateDerivationResultSchema
>;
export type ContinuationCandidateDerivationBoundaryResult =
  | { ok: true; result: ContinuationCandidateDerivationResult }
  | { ok: false; code: "CANDIDATE_DERIVATION_INPUT_REJECTED" };

type IdentityResolution = ContinuationIdentityResult["resolutions"][number];
type ExclusionReason = z.infer<typeof exclusionReasonSchema>;
type SetupReason = z.infer<typeof setupReasonSchema>;

/**
 * Pure R-002 boundary. It accepts only a sealed R-001 result plus an explicit,
 * exact-version envelope. It never reads a clock, store, target registry, or
 * runtime authority.
 */
export function deriveContinuationCandidates(
  identityResultInput: unknown,
  envelopeInput: unknown
): ContinuationCandidateDerivationBoundaryResult {
  try {
    const identityResult = continuationIdentityResultSchema.safeParse(
      identityResultInput
    );
    const envelope = continuationCandidateDerivationEnvelopeSchema.safeParse(
      envelopeInput
    );
    if (
      !identityResult.success ||
      !envelope.success ||
      !hasExactIdentitySemantics(identityResult.data) ||
      !hasExactFreshnessProvenance(identityResult.data, envelope.data)
    ) {
      return { ok: false, code: "CANDIDATE_DERIVATION_INPUT_REJECTED" };
    }

    return {
      ok: true,
      result: deriveCandidatesUnchecked(identityResult.data, envelope.data)
    };
  } catch {
    return { ok: false, code: "CANDIDATE_DERIVATION_INPUT_REJECTED" };
  }
}

export function sealContinuationCandidateDerivationResult(
  contentInput: ContinuationCandidateDerivationResultContent
): ContinuationCandidateDerivationResult {
  const content = continuationCandidateDerivationResultContentSchema.parse(
    contentInput
  );
  return continuationCandidateDerivationResultSchema.parse({
    ...content,
    resultSha256: continuationCandidateDerivationResultSha256(content)
  });
}

export function continuationCandidateDerivationResultSha256(
  value:
    | ContinuationCandidateDerivationResult
    | ContinuationCandidateDerivationResultContent
): string {
  const { resultSha256: _resultSha256, ...content } =
    value as ContinuationCandidateDerivationResult;
  return runtimeSha256({
    domain: "continuation-candidate-derivation-result-hash-v0.2",
    result: content
  });
}

export function verifyContinuationCandidateDerivationResultIntegrity(
  input: unknown
): boolean {
  try {
    return continuationCandidateDerivationResultSchema.safeParse(input).success;
  } catch {
    return false;
  }
}

/**
 * Artifact integrity alone cannot prove that a structurally valid result was
 * derived from a particular sealed R-001 input. This boundary re-runs the pure
 * derivation and requires byte-identical canonical output.
 */
export function verifyContinuationCandidateDerivationResultAgainstInput(
  identityResultInput: unknown,
  envelopeInput: unknown,
  resultInput: unknown
): boolean {
  try {
    const identityResult = continuationIdentityResultSchema.safeParse(
      identityResultInput
    );
    const envelope = continuationCandidateDerivationEnvelopeSchema.safeParse(
      envelopeInput
    );
    const result = continuationCandidateDerivationResultSchema.safeParse(
      resultInput
    );
    if (
      !identityResult.success ||
      !envelope.success ||
      !result.success ||
      !hasExactIdentitySemantics(identityResult.data) ||
      !hasExactFreshnessProvenance(identityResult.data, envelope.data)
    ) {
      return false;
    }
    const expected = deriveCandidatesUnchecked(
      identityResult.data,
      envelope.data
    );
    return runtimeCanonicalJson(expected) === runtimeCanonicalJson(result.data);
  } catch {
    return false;
  }
}

function deriveCandidatesUnchecked(
  identityResult: ContinuationIdentityResult,
  envelope: ContinuationCandidateDerivationEnvelope
): ContinuationCandidateDerivationResult {
  const asOfMs = Date.parse(envelope.asOf);
  const exclusionCounts = new Map<ExclusionReason, number>();
  const mappedNewest = new Map<string, IdentityResolution>();
  const setupNewest = new Map<string, IdentityResolution>();

  for (const resolution of identityResult.resolutions) {
    const exclusion = exclusionFor(resolution.observation, asOfMs);
    if (exclusion !== null) {
      increment(exclusionCounts, exclusion);
      continue;
    }

    if (resolution.status === "mapped") {
      retainNewest(
        mappedNewest,
        `${resolution.workContextId}:${resolution.observation.sourceIdentity.source}`,
        resolution,
        exclusionCounts
      );
      continue;
    }

    retainNewest(
      setupNewest,
      runtimeCanonicalJson({
        status: resolution.status,
        sourceIdentity: resolution.observation.sourceIdentity
      }),
      resolution,
      exclusionCounts
    );
  }

  const candidates: ContinuationCandidate[] = [];
  const mappedByContext = new Map<
    string,
    Partial<Record<"github" | "codex", IdentityResolution>>
  >();
  for (const resolution of mappedNewest.values()) {
    const workContextId = resolution.workContextId!;
    const source = resolution.observation.sourceIdentity.source;
    if (source !== "github" && source !== "codex") {
      increment(exclusionCounts, "UNSUPPORTED_CONTINUATION_SOURCE");
      continue;
    }
    const group = mappedByContext.get(workContextId) ?? {};
    group[source] = resolution;
    mappedByContext.set(workContextId, group);
  }

  for (const [workContextId, group] of mappedByContext) {
    if (group.github !== undefined && group.codex !== undefined) {
      candidates.push(
        linkedCandidate(workContextId, group.github, group.codex)
      );
    } else {
      const resolution = group.github ?? group.codex;
      if (resolution !== undefined) {
        candidates.push(singleSourceCandidate(resolution));
      }
    }
  }

  const setupReasonCounts = new Map<SetupReason, number>();
  for (const resolution of setupNewest.values()) {
    candidates.push(setupCandidate(identityResult.resultSha256, resolution));
    const reason =
      resolution.status === "conflict"
        ? "IDENTITY_BINDING_CONFLICT"
        : "IDENTITY_MAPPING_NOT_CONFIRMED";
    increment(setupReasonCounts, reason);
  }

  candidates.sort((left, right) =>
    compareRuntimeStrings(left.candidateId, right.candidateId)
  );
  const exclusions = countEntries(exclusionCounts);
  const setupReasons = countEntries(setupReasonCounts);
  const admittedObservationIds = new Set(
    candidates.flatMap((candidate) => candidate.sourceObservationIds)
  );
  const setupCandidateCount = candidates.filter(
    (candidate) => candidate.candidateKind === "workspace_mapping"
  ).length;
  const content = continuationCandidateDerivationResultContentSchema.parse({
    contract: CONTINUATION_CANDIDATE_DERIVATION_RESULT_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
    ruleVersion: CONTINUATION_RULE_VERSION,
    identityResultContract: CONTINUATION_IDENTITY_RESULT_CONTRACT,
    identitySchemaVersion: CONTINUATION_IDENTITY_SCHEMA_VERSION,
    identityResultSha256: identityResult.resultSha256,
    asOf: envelope.asOf,
    configSha256: derivationConfigSha256(),
    resolutionCount: identityResult.resolutions.length,
    admittedObservationCount: admittedObservationIds.size,
    candidateCount: candidates.length,
    setupCandidateCount,
    excludedCount: sumCounts(exclusions),
    candidates,
    exclusions,
    setupReasons
  });
  return sealContinuationCandidateDerivationResult(content);
}

function exclusionFor(
  observation: ContinuationObservation,
  asOfMs: number
): ExclusionReason | null {
  if (
    observation.sourceIdentity.source !== "github" &&
    observation.sourceIdentity.source !== "codex"
  ) {
    return "UNSUPPORTED_CONTINUATION_SOURCE";
  }
  if (
    Date.parse(observation.observedAt) > asOfMs ||
    Date.parse(observation.snapshotCapturedAt) > asOfMs
  ) {
    return "OBSERVATION_FROM_FUTURE";
  }
  if (Date.parse(observation.expiresAt) <= asOfMs) {
    return "OBSERVATION_EXPIRED";
  }
  if (observation.snapshotFreshness === "stale") {
    return "SNAPSHOT_STALE";
  }
  if (observation.snapshotFreshness === "invalid") {
    return "SNAPSHOT_FRESHNESS_INVALID";
  }
  if (observation.snapshotFreshness === "unknown") {
    return "SNAPSHOT_FRESHNESS_UNKNOWN";
  }
  if (observation.terminalState === "terminal") {
    return "OBSERVATION_TERMINAL";
  }
  if (observation.conflictCodes.length > 0) {
    return "OBSERVATION_CONFLICT_REPORTED";
  }
  if (observation.errorCodes.length > 0) {
    return "OBSERVATION_ERROR_REPORTED";
  }
  return null;
}

function retainNewest(
  index: Map<string, IdentityResolution>,
  key: string,
  candidate: IdentityResolution,
  exclusions: Map<ExclusionReason, number>
): void {
  const current = index.get(key);
  if (current === undefined) {
    index.set(key, candidate);
    return;
  }
  if (compareResolutionRecency(candidate, current) < 0) {
    index.set(key, candidate);
  }
  increment(exclusions, "SUPERSEDED_BY_NEWER_OBSERVATION");
}

function compareResolutionRecency(
  left: IdentityResolution,
  right: IdentityResolution
): number {
  const observedDifference =
    Date.parse(right.observation.observedAt) -
    Date.parse(left.observation.observedAt);
  if (observedDifference !== 0) return observedDifference;
  const capturedDifference =
    Date.parse(right.observation.snapshotCapturedAt) -
    Date.parse(left.observation.snapshotCapturedAt);
  if (capturedDifference !== 0) return capturedDifference;
  return compareRuntimeStrings(left.observationId, right.observationId);
}

function singleSourceCandidate(
  resolution: IdentityResolution
): ContinuationCandidate {
  const observation = resolution.observation;
  const github = observation.sourceIdentity.source === "github";
  const base = {
    candidateKind: github
      ? ("recent_github_push" as const)
      : ("recent_codex_session" as const),
    workContextId: resolution.workContextId,
    sourceObservationIds: [observation.observationId],
    observedAt: observation.observedAt
  };
  return sealContinuationCandidate({
    contract: CONTINUATION_CANDIDATE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
    candidateId: createContinuationCandidateId(base),
    ...base,
    localDisplayLabel: github ? "Recent GitHub activity" : "Recent Codex activity",
    expiresAt: activityExpiresAt(observation.observedAt),
    evidenceBand: "single_source",
    capability: "display",
    availability: "ready",
    continuityScore: 0,
    scoreBreakdown: zeroScoreBreakdown(),
    reasonCodes: canonicalStrings([
      "EXPLICIT_MAPPING_CONFIRMED",
      github ? "RECENT_GITHUB_ACTIVITY" : "RECENT_CODEX_ACTIVITY"
    ]),
    caveatCodes: observationCaveats(observation),
    privateActionTarget: null
  });
}

function linkedCandidate(
  workContextId: string,
  github: IdentityResolution,
  codex: IdentityResolution
): ContinuationCandidate {
  const observations = [github.observation, codex.observation].sort(
    (left, right) => compareRuntimeStrings(left.observationId, right.observationId)
  );
  const sourceObservationIds = observations.map(
    (observation) => observation.observationId
  );
  const observedAt = latestTimestamp(
    observations.map((observation) => observation.observedAt)
  );
  const base = {
    candidateKind: "linked_workstream" as const,
    workContextId,
    sourceObservationIds,
    observedAt
  };
  return sealContinuationCandidate({
    contract: CONTINUATION_CANDIDATE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
    candidateId: createContinuationCandidateId(base),
    ...base,
    localDisplayLabel: "Recent linked activity",
    expiresAt: earliestTimestamp(
      observations.map((observation) =>
        activityExpiresAt(observation.observedAt)
      )
    ),
    evidenceBand: "corroborated",
    capability: "display",
    availability: "ready",
    continuityScore: 0,
    scoreBreakdown: zeroScoreBreakdown(),
    reasonCodes: canonicalStrings([
      "EXPLICIT_MAPPING_CONFIRMED",
      "RECENT_CROSS_SOURCE_ACTIVITY"
    ]),
    caveatCodes: canonicalStrings(observations.flatMap(observationCaveats)),
    privateActionTarget: null
  });
}

function setupCandidate(
  identityResultSha256: string,
  resolution: IdentityResolution
): ContinuationCandidate {
  const observation = resolution.observation;
  const conflict = resolution.status === "conflict";
  const sourceObservationIds = [observation.observationId];
  const setupReason: SetupReason = conflict
    ? "IDENTITY_BINDING_CONFLICT"
    : "IDENTITY_MAPPING_NOT_CONFIRMED";
  const base = {
    candidateKind: "workspace_mapping" as const,
    workContextId: null,
    sourceObservationIds,
    observedAt: observation.observedAt
  };
  const targetRef = createSetupTargetRef(
    identityResultSha256,
    sourceObservationIds,
    setupReason
  );
  return sealContinuationCandidate({
    contract: CONTINUATION_CANDIDATE_CONTRACT,
    schemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
    candidateId: createContinuationCandidateId(base),
    ...base,
    localDisplayLabel: conflict
      ? "Review recent work connection"
      : "Connect recent work",
    expiresAt: activityExpiresAt(observation.observedAt),
    evidenceBand: "setup",
    capability: "open_setup_surface",
    availability: "setup_required",
    continuityScore: 0,
    scoreBreakdown: zeroScoreBreakdown(),
    reasonCodes: [setupReason],
    caveatCodes: canonicalStrings([
      ...observationCaveats(observation),
      conflict
        ? "IDENTITY_CLARIFICATION_REQUIRED"
        : "EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"
    ]),
    // This is only a deterministic private descriptor. A later action store
    // must bind and revalidate it before it can confer any navigation authority.
    privateActionTarget: {
      capability: "open_setup_surface",
      targetRef
    }
  });
}

function observationCaveats(observation: ContinuationObservation): string[] {
  const caveats: string[] = [];
  if (observation.sourceCoverage === "partial") {
    caveats.push("SOURCE_COVERAGE_PARTIAL");
  } else if (observation.sourceCoverage === "unknown") {
    caveats.push("SOURCE_COVERAGE_UNKNOWN");
  }
  if (observation.terminalState === "unknown") {
    caveats.push("TERMINAL_STATE_UNKNOWN");
  }
  if (
    observation.payload.kind === "codex_session_activity" &&
    observation.payload.boundedActivityCount === 0 &&
    !observation.payload.boundedSummaryAvailable
  ) {
    caveats.push("SOURCE_METADATA_ONLY");
  }
  return canonicalStrings(caveats);
}

function hasExactIdentitySemantics(
  result: ContinuationIdentityResult
): boolean {
  const semanticsBySourceIdentity = new Map<string, string>();
  for (const resolution of result.resolutions) {
    if (
      resolution.observation.expiresAt !==
      activityExpiresAt(resolution.observation.observedAt)
    ) {
      return false;
    }
    const expected =
      resolution.status === "mapped"
        ? "EXPLICIT_MAPPING_CONFIRMED"
        : resolution.status === "setup_needed"
          ? "IDENTITY_MAPPING_NOT_CONFIRMED"
          : "IDENTITY_BINDING_CONFLICT";
    if (
      resolution.reasonCodes.length !== 1 ||
      resolution.reasonCodes[0] !== expected
    ) {
      return false;
    }
    const identityKey = runtimeCanonicalJson(
      resolution.observation.sourceIdentity
    );
    const semanticKey = runtimeCanonicalJson({
      status: resolution.status,
      workContextId: resolution.workContextId,
      reasonCodes: resolution.reasonCodes
    });
    const existing = semanticsBySourceIdentity.get(identityKey);
    if (existing !== undefined && existing !== semanticKey) return false;
    semanticsBySourceIdentity.set(identityKey, semanticKey);
  }
  return true;
}

function hasExactFreshnessProvenance(
  result: ContinuationIdentityResult,
  envelope: ContinuationCandidateDerivationEnvelope
): boolean {
  const evaluations = new Map(
    result.sourceFreshnessEvaluations.map((evaluation) => [
      evaluation.source,
      evaluation
    ])
  );
  if (
    result.sourceFreshnessEvaluations.some(
      (evaluation) => evaluation.evaluatedAsOf !== envelope.asOf
    )
  ) {
    return false;
  }
  for (const resolution of result.resolutions) {
    const source = resolution.observation.sourceIdentity.source;
    if (source !== "github" && source !== "codex") return false;
    const evaluation = evaluations.get(source);
    if (evaluation === undefined) return false;
    if (
      Date.parse(resolution.observation.snapshotCapturedAt) >
      Date.parse(evaluation.evaluatedAsOf)
    ) {
      return false;
    }
    const expectedFreshness =
      Date.parse(resolution.observation.snapshotCapturedAt) <
      Date.parse(evaluation.snapshotFreshnessCutoff)
        ? "stale"
        : "fresh";
    if (resolution.observation.snapshotFreshness !== expectedFreshness) {
      return false;
    }
  }
  return true;
}

function refineDerivationResult(
  value: z.infer<typeof derivationResultContentObjectSchema>,
  context: z.RefinementCtx
): void {
  if (value.configSha256 !== derivationConfigSha256()) {
    addIssue(
      context,
      ["configSha256"],
      "Candidate derivation config hash must bind the exact supported config"
    );
  }
  refineCanonical(
    value.candidates.map((candidate) => candidate.candidateId),
    context,
    ["candidates"]
  );
  refineCanonical(
    value.exclusions.map((item) => item.reasonCode),
    context,
    ["exclusions"]
  );
  refineCanonical(
    value.setupReasons.map((item) => item.reasonCode),
    context,
    ["setupReasons"]
  );
  if (value.candidateCount !== value.candidates.length) {
    addIssue(context, ["candidateCount"], "Candidate count must be derived");
  }
  const setupCandidates = value.candidates.filter(
    (candidate) => candidate.candidateKind === "workspace_mapping"
  );
  if (value.setupCandidateCount !== setupCandidates.length) {
    addIssue(context, ["setupCandidateCount"], "Setup candidate count must be derived");
  }
  if (value.setupCandidateCount !== sumCounts(value.setupReasons)) {
    addIssue(context, ["setupReasons"], "Setup reason counts must cover setup candidates");
  }
  const expectedSetupReasonCounts = new Map<SetupReason, number>();
  for (const candidate of setupCandidates) {
    const setupReason = setupReasonFromCandidate(candidate);
    if (setupReason !== null) increment(expectedSetupReasonCounts, setupReason);
  }
  if (
    runtimeCanonicalJson(value.setupReasons) !==
    runtimeCanonicalJson(countEntries(expectedSetupReasonCounts))
  ) {
    addIssue(
      context,
      ["setupReasons"],
      "Setup reason histogram must be derived from setup candidate reasons"
    );
  }
  if (value.excludedCount !== sumCounts(value.exclusions)) {
    addIssue(context, ["excludedCount"], "Excluded count must equal reason counts");
  }
  const observationIds = value.candidates.flatMap(
    (candidate) => candidate.sourceObservationIds
  );
  if (new Set(observationIds).size !== observationIds.length) {
    addIssue(context, ["candidates"], "An observation may support only one derived candidate");
  }
  if (value.admittedObservationCount !== observationIds.length) {
    addIssue(context, ["admittedObservationCount"], "Admitted observation count must be derived");
  }
  if (
    value.resolutionCount !==
    value.admittedObservationCount + value.excludedCount
  ) {
    addIssue(context, ["resolutionCount"], "Every identity resolution must be accounted for");
  }
  for (const [index, candidate] of value.candidates.entries()) {
    refineR002Candidate(candidate, value, context, ["candidates", index]);
  }
}

function refineR002Candidate(
  candidate: ContinuationCandidate,
  result: z.infer<typeof derivationResultContentObjectSchema>,
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  if (
    candidate.continuityScore !== 0 ||
    Object.values(candidate.scoreBreakdown).some((score) => score !== 0)
  ) {
    addIssue(context, path, "R-002 must not assign R-003 scores");
  }
  const asOfMs = Date.parse(result.asOf);
  if (
    Date.parse(candidate.observedAt) > asOfMs ||
    Date.parse(candidate.expiresAt) <= asOfMs
  ) {
    addIssue(
      context,
      path,
      "Derived candidate must be observed and unexpired at result asOf"
    );
  }

  if (candidate.candidateKind === "recent_github_push") {
    refineMappedCandidateShape(candidate, {
      sourceObservationCount: 1,
      evidenceBand: "single_source",
      localDisplayLabel: "Recent GitHub activity",
      reasonCodes: ["EXPLICIT_MAPPING_CONFIRMED", "RECENT_GITHUB_ACTIVITY"]
    }, context, path);
    return;
  }
  if (candidate.candidateKind === "recent_codex_session") {
    refineMappedCandidateShape(candidate, {
      sourceObservationCount: 1,
      evidenceBand: "single_source",
      localDisplayLabel: "Recent Codex activity",
      reasonCodes: ["EXPLICIT_MAPPING_CONFIRMED", "RECENT_CODEX_ACTIVITY"]
    }, context, path);
    return;
  }
  if (candidate.candidateKind === "linked_workstream") {
    refineMappedCandidateShape(candidate, {
      sourceObservationCount: 2,
      evidenceBand: "corroborated",
      localDisplayLabel: "Recent linked activity",
      reasonCodes: [
        "EXPLICIT_MAPPING_CONFIRMED",
        "RECENT_CROSS_SOURCE_ACTIVITY"
      ]
    }, context, path);
    return;
  }
  if (candidate.candidateKind === "workspace_mapping") {
    const setupReason = setupReasonFromCandidate(candidate);
    const expectedLabel =
      setupReason === "IDENTITY_BINDING_CONFLICT"
        ? "Review recent work connection"
        : "Connect recent work";
    if (
      setupReason === null ||
      candidate.sourceObservationIds.length !== 1 ||
      candidate.workContextId !== null ||
      candidate.localDisplayLabel !== expectedLabel ||
      candidate.evidenceBand !== "setup" ||
      candidate.capability !== "open_setup_surface" ||
      candidate.availability !== "setup_required" ||
      candidate.privateActionTarget?.capability !== "open_setup_surface" ||
      candidate.privateActionTarget?.targetRef !==
        createSetupTargetRef(
          result.identityResultSha256,
          candidate.sourceObservationIds,
          setupReason
        ) ||
      candidate.expiresAt !== activityExpiresAt(candidate.observedAt)
    ) {
      addIssue(
        context,
        path,
        "Workspace mapping candidate must be an exactly derivable bounded setup descriptor"
      );
    }
    return;
  }
  addIssue(context, path, "R-002 does not derive local worktree candidates");
}

function refineMappedCandidateShape(
  candidate: ContinuationCandidate,
  expected: {
    sourceObservationCount: 1 | 2;
    evidenceBand: "single_source" | "corroborated";
    localDisplayLabel: string;
    reasonCodes: string[];
  },
  context: z.RefinementCtx,
  path: (string | number)[]
): void {
  if (
    candidate.sourceObservationIds.length !== expected.sourceObservationCount ||
    candidate.workContextId === null ||
    candidate.localDisplayLabel !== expected.localDisplayLabel ||
    candidate.evidenceBand !== expected.evidenceBand ||
    candidate.capability !== "display" ||
    candidate.availability !== "ready" ||
    candidate.privateActionTarget !== null ||
    runtimeCanonicalJson(candidate.reasonCodes) !==
      runtimeCanonicalJson(expected.reasonCodes) ||
    (expected.sourceObservationCount === 1
      ? candidate.expiresAt !== activityExpiresAt(candidate.observedAt)
      : Date.parse(candidate.expiresAt) >
        Date.parse(activityExpiresAt(candidate.observedAt)))
  ) {
    addIssue(context, path, "Mapped R-002 candidate has a non-derivable shape");
  }
}

function setupReasonFromCandidate(
  candidate: ContinuationCandidate
): SetupReason | null {
  if (candidate.reasonCodes.length !== 1) return null;
  const parsed = setupReasonSchema.safeParse(candidate.reasonCodes[0]);
  return parsed.success ? parsed.data : null;
}

function createSetupTargetRef(
  identityResultSha256: string,
  sourceObservationIds: string[],
  setupReason: SetupReason
): string {
  const domain =
    setupReason === "IDENTITY_BINDING_CONFLICT"
      ? `${CONTINUATION_SETUP_TARGET_POLICY_VERSION}:identity-binding-conflict`
      : `${CONTINUATION_SETUP_TARGET_POLICY_VERSION}:identity-mapping-not-confirmed`;
  return runtimeStableId("private_target", domain, {
    identityResultSha256,
    sourceObservationIds
  });
}

function derivationConfigSha256(): string {
  return runtimeSha256({
    domain: "continuation-candidate-derivation-config-hash-v0.2",
    config: CONTINUATION_CANDIDATE_DERIVATION_CONFIG
  });
}

function activityExpiresAt(observedAt: string): string {
  const expiresAt = new Date(Date.parse(observedAt) + ACTIVITY_WINDOW_MS);
  return Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : "";
}

function zeroScoreBreakdown(): ContinuationCandidateContent["scoreBreakdown"] {
  return {
    recency: 0,
    exactCorroboration: 0,
    resumability: 0,
    localContinuity: 0,
    explicitPreference: 0
  };
}

function canonicalStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}

function latestTimestamp(values: string[]): string {
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest
  );
}

function earliestTimestamp(values: string[]): string {
  return values.reduce((earliest, value) =>
    Date.parse(value) < Date.parse(earliest) ? value : earliest
  );
}

function increment<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function countEntries<K extends string>(
  counts: Map<K, number>
): Array<{ reasonCode: K; count: number }> {
  return [...counts.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((left, right) =>
      compareRuntimeStrings(left.reasonCode, right.reasonCode)
    );
}

function sumCounts(values: Array<{ count: number }>): number {
  return values.reduce((total, item) => total + item.count, 0);
}

function refineCanonical(
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
      return JSON.parse(runtimeCanonicalJson(value)) as unknown;
    } catch {
      return NON_CANONICAL_DERIVATION_BOUNDARY_VALUE;
    }
  }, schema);
}
