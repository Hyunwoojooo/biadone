import { z } from "zod";

import {
  runtimeCanonicalJson,
  runtimeSha256
} from "../crossSource/canonicalHash";
import {
  CONTINUATION_ACTION_POLICY_VERSION,
  CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_COVERAGE_POLICY_VERSION,
  CONTINUATION_DECISION_CONTRACT,
  CONTINUATION_DECISION_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_ID_POLICY_VERSION,
  CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
  CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
  CONTINUATION_RESOLUTION_SCHEMA_VERSION,
  CONTINUATION_RESOLVED_DECISION_CONTRACT,
  CONTINUATION_RESOLVED_DECISION_SCHEMA_VERSION,
  CONTINUATION_RESOLVER_VERSION,
  CONTINUATION_RULE_VERSION,
  CONTINUATION_SCORING_POLICY_VERSION,
  CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION
} from "../crossSource/versions";
import {
  continuationDecisionSchema,
  sealContinuationDecision,
  type ContinuationCandidate,
  type ContinuationDecision,
  type ContinuationDecisionContent,
  type ContinuationDependencies
} from "./contracts";
import type { ContinuationSourceAdapterBatch } from "./adapters";
import {
  continuationCandidateDerivationEnvelopeSchema,
  continuationCandidateDerivationResultSchema,
  verifyContinuationCandidateDerivationResultAgainstInput,
  type ContinuationCandidateDerivationEnvelope,
  type ContinuationCandidateDerivationResult
} from "./deriveCandidates";
import {
  continuationIdentityInputSchema,
  continuationIdentityResultSchema,
  resolveContinuationIdentity,
  type ContinuationIdentityInput,
  type ContinuationIdentityResult
} from "./resolveIdentity";
import {
  CONTINUATION_SCORING_CONFIG,
  continuationScoringConfigSchema,
  scoreContinuationCandidates,
  type ContinuationScoringResult
} from "./scoreContinuity";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const codeCommitSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const timestampSchema = z.string().datetime();
const NON_CANONICAL_RESOLUTION_BOUNDARY_VALUE = Object.freeze({
  nonCanonicalContinuationResolutionBoundaryValue: true
});

const resolutionConfigObjectSchema = z
  .object({
    resolverVersion: z.literal(CONTINUATION_RESOLVER_VERSION),
    coveragePolicyVersion: z.literal(CONTINUATION_COVERAGE_POLICY_VERSION),
    scoringConfig: continuationScoringConfigSchema,
    readyPoolPrecedesSetup: z.literal(true),
    maxSelectedCandidateCount: z.literal(3),
    maxCandidatesPerWorkContext: z.literal(1),
    selectionOrder: z.tuple([
      z.literal("continuity_score_desc"),
      z.literal("candidate_id_asc")
    ])
  })
  .strict();

export const continuationResolutionConfigSchema = failClosedCanonicalBoundary(
  resolutionConfigObjectSchema
);

export const CONTINUATION_RESOLUTION_CONFIG = Object.freeze({
  resolverVersion: CONTINUATION_RESOLVER_VERSION,
  coveragePolicyVersion: CONTINUATION_COVERAGE_POLICY_VERSION,
  scoringConfig: CONTINUATION_SCORING_CONFIG,
  readyPoolPrecedesSetup: true as const,
  maxSelectedCandidateCount: 3 as const,
  maxCandidatesPerWorkContext: 1 as const,
  selectionOrder: Object.freeze([
    "continuity_score_desc" as const,
    "candidate_id_asc" as const
  ])
});

const runEnvelopeSchema = z
  .object({
    runId: z.string().regex(/^continuation_run_[a-f0-9]{32}$/u),
    analysisId: z.string().regex(/^analysis_[a-f0-9]{32}$/u),
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    codeCommitSha: codeCommitSchema,
    datasetVersion: z.string().trim().min(1).max(120).nullable(),
    datasetSha256: sha256Schema.nullable()
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
  });

const resolutionEnvelopeObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_RESOLUTION_SCHEMA_VERSION),
    asOf: timestampSchema,
    config: resolutionConfigObjectSchema,
    run: runEnvelopeSchema
  })
  .strict();

export const continuationResolutionEnvelopeSchema =
  failClosedCanonicalBoundary(resolutionEnvelopeObjectSchema);

const continuationResolvedDecisionBodySchema = failClosedCanonicalBoundary(
  continuationDecisionSchema.superRefine(refineResolvedDecision)
);

const sourceAssessmentProofSchema = z.discriminatedUnion("status", [
  z
    .object({
      source: z.enum(["github", "codex"]),
      batchSha256: sha256Schema,
      status: z.literal("available"),
      coverage: z.enum(["complete", "partial", "unknown"]),
      freshness: z.enum(["fresh", "stale", "invalid", "unknown"])
    })
    .strict(),
  z
    .object({
      source: z.enum(["github", "codex"]),
      batchSha256: sha256Schema,
      status: z.literal("unavailable"),
      coverage: z.literal("unavailable"),
      freshness: z.literal("unavailable")
    })
    .strict()
]);

const resolvedDecisionArtifactContentObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_RESOLVED_DECISION_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_RESOLVED_DECISION_SCHEMA_VERSION),
    resolverVersion: z.literal(CONTINUATION_RESOLVER_VERSION),
    scoringPolicyVersion: z.literal(CONTINUATION_SCORING_POLICY_VERSION),
    identityResultSha256: sha256Schema,
    derivationResultSha256: sha256Schema,
    scoringResultSha256: sha256Schema,
    configSha256: sha256Schema,
    sourceAssessments: z.tuple([
      sourceAssessmentProofSchema.and(z.object({ source: z.literal("codex") })),
      sourceAssessmentProofSchema.and(z.object({ source: z.literal("github") }))
    ]),
    decision: continuationResolvedDecisionBodySchema
  })
  .strict();

const resolvedDecisionArtifactObjectSchema = resolvedDecisionArtifactContentObjectSchema
  .extend({ resultSha256: sha256Schema })
  .strict();

/**
 * A distinct R-003 artifact. A base Decision v0.2 value is deliberately not
 * accepted as an authentic resolver output; consumers must also call the
 * input-bound verifier below before projection or Board composition.
 */
export const continuationResolvedDecisionSchema = failClosedCanonicalBoundary(
  resolvedDecisionArtifactObjectSchema.superRefine((value, context) => {
    if (
      value.sourceAssessments[0].batchSha256 ===
      value.sourceAssessments[1].batchSha256
    ) {
      addIssue(
        context,
        ["sourceAssessments"],
        "R-003 source assessments must bind distinct source batches"
      );
    }
    if (value.configSha256 !== continuationResolutionConfigSha256()) {
      addIssue(context, ["configSha256"], "R-003 config hash mismatch");
    }
    if (
      value.resultSha256 !== continuationResolvedDecisionSha256(value)
    ) {
      addIssue(context, ["resultSha256"], "R-003 artifact hash mismatch");
    }
    if (value.decision.coverageCode === "COMPLETE") {
      if (
        value.sourceAssessments.some(
          (assessment) =>
            assessment.status !== "available" ||
            assessment.coverage !== "complete" ||
            assessment.freshness !== "fresh"
        )
      ) {
        addIssue(
          context,
          ["sourceAssessments"],
          "Complete coverage requires explicit complete/fresh two-source proof"
        );
      }
    }
    if (
      value.decision.status === "no_recent_context" &&
      value.decision.coverageCode !== "COMPLETE"
    ) {
      addIssue(
        context,
        ["decision", "coverageCode"],
        "No-recent requires complete global source coverage"
      );
    }
    if (
      value.decision.status === "no_recent_context" &&
      value.sourceAssessments.some(
        (assessment) =>
          assessment.status !== "available" ||
          assessment.coverage !== "complete" ||
          assessment.freshness !== "fresh"
      )
    ) {
      addIssue(
        context,
        ["sourceAssessments"],
        "No-recent requires explicit complete/fresh two-source assessment"
      );
    }
    const bothSourcesUnavailable = value.sourceAssessments.every(
      (assessment) => assessment.status === "unavailable"
    );
    if (
      (value.decision.status === "unavailable") !== bothSourcesUnavailable
    ) {
      addIssue(
        context,
        ["sourceAssessments"],
        "Unavailable status must exactly match two unavailable sources"
      );
    }
  })
);

const resolutionOptionsSchema = z
  .object({
    installationSecret: z.string().min(1).max(1_024),
    expectedRegistrySha256: sha256Schema,
    expectedCodeCommitSha: codeCommitSchema,
    expectedDatasetVersion: z.string().trim().min(1).max(120).nullable(),
    expectedDatasetSha256: sha256Schema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.expectedDatasetVersion === null) !==
      (value.expectedDatasetSha256 === null)
    ) {
      addIssue(
        context,
        ["expectedDatasetSha256"],
        "Expected dataset version and hash must form an exact pair"
      );
    }
  });

export type ContinuationResolutionConfig = z.infer<
  typeof continuationResolutionConfigSchema
>;
export type ContinuationResolutionEnvelope = z.infer<
  typeof continuationResolutionEnvelopeSchema
>;
export type ContinuationResolutionOptions = z.infer<
  typeof resolutionOptionsSchema
>;
export type ContinuationResolvedDecision = z.infer<
  typeof continuationResolvedDecisionSchema
>;
export type ContinuationResolutionBoundaryResult =
  | { ok: true; result: ContinuationResolvedDecision }
  | { ok: false; code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" };

/**
 * Mandatory R-003 producer boundary. The installation secret is supplied
 * separately and is never copied into a serialized artifact or hash input.
 */
export function resolveContinuation(
  identityInputValue: unknown,
  claimedIdentityResultValue: unknown,
  derivationEnvelopeValue: unknown,
  claimedDerivationResultValue: unknown,
  resolutionEnvelopeValue: unknown,
  optionsValue: unknown
): ContinuationResolutionBoundaryResult {
  try {
    const inputs = parseAndVerifyInputs(
      identityInputValue,
      claimedIdentityResultValue,
      derivationEnvelopeValue,
      claimedDerivationResultValue,
      resolutionEnvelopeValue,
      optionsValue
    );
    if (inputs === null) {
      return { ok: false, code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" };
    }
    const scored = scoreContinuationCandidates(
      inputs.identityResult,
      inputs.derivationEnvelope,
      inputs.derivationResult,
      inputs.resolutionEnvelope.config.scoringConfig
    );
    if (!scored.ok) {
      return { ok: false, code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" };
    }
    const decision = resolveUnchecked(
        inputs.identityInput,
        inputs.identityResult,
        inputs.derivationEnvelope,
        inputs.derivationResult,
        inputs.resolutionEnvelope,
        scored.result
      );
    return {
      ok: true,
      result: sealResolvedDecisionArtifact(
        inputs.identityInput,
        inputs.identityResult,
        inputs.derivationResult,
        inputs.resolutionEnvelope,
        scored.result,
        decision
      )
    };
  } catch {
    return { ok: false, code: "CONTINUATION_RESOLUTION_INPUT_REJECTED" };
  }
}

export function verifyContinuationDecisionAgainstInput(
  identityInputValue: unknown,
  claimedIdentityResultValue: unknown,
  derivationEnvelopeValue: unknown,
  claimedDerivationResultValue: unknown,
  resolutionEnvelopeValue: unknown,
  optionsValue: unknown,
  decisionValue: unknown
): boolean {
  try {
    const actual = continuationResolvedDecisionSchema.safeParse(decisionValue);
    const expected = resolveContinuation(
      identityInputValue,
      claimedIdentityResultValue,
      derivationEnvelopeValue,
      claimedDerivationResultValue,
      resolutionEnvelopeValue,
      optionsValue
    );
    return (
      actual.success &&
      expected.ok &&
      runtimeCanonicalJson(actual.data) ===
        runtimeCanonicalJson(expected.result)
    );
  } catch {
    return false;
  }
}

export function continuationResolutionConfigSha256(): string {
  return runtimeSha256({
    domain: "continuation-resolution-config-hash-v0.1",
    config: CONTINUATION_RESOLUTION_CONFIG
  });
}

type VerifiedInputs = {
  identityInput: ContinuationIdentityInput;
  identityResult: ContinuationIdentityResult;
  derivationEnvelope: ContinuationCandidateDerivationEnvelope;
  derivationResult: ContinuationCandidateDerivationResult;
  resolutionEnvelope: ContinuationResolutionEnvelope;
};

function parseAndVerifyInputs(
  identityInputValue: unknown,
  claimedIdentityResultValue: unknown,
  derivationEnvelopeValue: unknown,
  claimedDerivationResultValue: unknown,
  resolutionEnvelopeValue: unknown,
  optionsValue: unknown
): VerifiedInputs | null {
  const identityInput = continuationIdentityInputSchema.safeParse(
    identityInputValue
  );
  const claimedIdentityResult = continuationIdentityResultSchema.safeParse(
    claimedIdentityResultValue
  );
  const derivationEnvelope =
    continuationCandidateDerivationEnvelopeSchema.safeParse(
      derivationEnvelopeValue
    );
  const claimedDerivationResult =
    continuationCandidateDerivationResultSchema.safeParse(
      claimedDerivationResultValue
    );
  const resolutionEnvelope = continuationResolutionEnvelopeSchema.safeParse(
    resolutionEnvelopeValue
  );
  const options = resolutionOptionsSchema.safeParse(optionsValue);
  if (
    !identityInput.success ||
    !claimedIdentityResult.success ||
    !derivationEnvelope.success ||
    !claimedDerivationResult.success ||
    !resolutionEnvelope.success ||
    !options.success ||
    runtimeCanonicalJson(
      identityInput.data.adapterBatches.map((batch) => batch.source)
    ) !== runtimeCanonicalJson(["codex", "github"]) ||
    resolutionEnvelope.data.run.codeCommitSha !==
      options.data.expectedCodeCommitSha ||
    resolutionEnvelope.data.run.datasetVersion !==
      options.data.expectedDatasetVersion ||
    resolutionEnvelope.data.run.datasetSha256 !==
      options.data.expectedDatasetSha256 ||
    identityInput.data.registry.registrySha256 !==
      options.data.expectedRegistrySha256 ||
    resolutionEnvelope.data.asOf !== derivationEnvelope.data.asOf ||
    claimedDerivationResult.data.asOf !== derivationEnvelope.data.asOf ||
    identityInput.data.adapterBatches.some(
      (batch) => batch.evaluatedAsOf !== derivationEnvelope.data.asOf
    )
  ) {
    return null;
  }
  const recomputedIdentity = resolveContinuationIdentity(identityInput.data, {
    installationSecret: options.data.installationSecret,
    expectedRegistrySha256: options.data.expectedRegistrySha256
  });
  if (
    !recomputedIdentity.ok ||
    runtimeCanonicalJson(recomputedIdentity.result) !==
      runtimeCanonicalJson(claimedIdentityResult.data) ||
    !verifyContinuationCandidateDerivationResultAgainstInput(
      claimedIdentityResult.data,
      derivationEnvelope.data,
      claimedDerivationResult.data
    )
  ) {
    return null;
  }
  return {
    identityInput: identityInput.data,
    identityResult: claimedIdentityResult.data,
    derivationEnvelope: derivationEnvelope.data,
    derivationResult: claimedDerivationResult.data,
    resolutionEnvelope: resolutionEnvelope.data
  };
}

function resolveUnchecked(
  identityInput: ContinuationIdentityInput,
  identityResult: ContinuationIdentityResult,
  derivationEnvelope: ContinuationCandidateDerivationEnvelope,
  derivationResult: ContinuationCandidateDerivationResult,
  resolutionEnvelope: ContinuationResolutionEnvelope,
  scoringResult: ContinuationScoringResult
): ContinuationDecision {
  const ready = scoringResult.candidates.filter(
    (candidate) => candidate.availability === "ready"
  );
  const setup = scoringResult.candidates.filter(
    (candidate) => candidate.availability === "setup_required"
  );
  const selected = selectCandidates(ready.length > 0 ? ready : setup);
  const classification = classifyDecision(
    identityInput.adapterBatches,
    derivationResult,
    selected
  );
  const primary = selected[0] ?? null;
  const alternatives = selected.slice(1);
  const dependencies = buildDependencies(
    identityInput,
    resolutionEnvelope.config
  );
  const inputSha256 = resolutionInputSha256(
    identityInput,
    identityResult,
    derivationEnvelope,
    derivationResult,
    resolutionEnvelope
  );
  const run = {
    ...resolutionEnvelope.run,
    status: classification.runStatus,
    inputSha256,
    dependencies,
    observationCount: derivationResult.resolutionCount,
    admittedCandidateCount: derivationResult.candidateCount,
    excludedCandidateCount: derivationResult.excludedCount,
    errors: classification.errors,
    latencyMs:
      Date.parse(resolutionEnvelope.run.completedAt) -
      Date.parse(resolutionEnvelope.run.startedAt),
    tokenUsage: null
  };
  const content: ContinuationDecisionContent = {
    contract: CONTINUATION_DECISION_CONTRACT,
    schemaVersion: CONTINUATION_DECISION_SCHEMA_VERSION,
    asOf: resolutionEnvelope.asOf,
    status: classification.status,
    primary,
    alternatives,
    coverageCode: classification.coverageCode,
    reasonCodes: classification.reasonCodes,
    run
  };
  return continuationResolvedDecisionBodySchema.parse(
    sealContinuationDecision(content)
  );
}

export function continuationResolvedDecisionSha256(
  value: ContinuationResolvedDecision | Omit<ContinuationResolvedDecision, "resultSha256">
): string {
  const { resultSha256: _resultSha256, ...content } =
    value as ContinuationResolvedDecision;
  return runtimeSha256({
    domain: "continuation-resolved-decision-hash-v0.1",
    result: content
  });
}

function sealResolvedDecisionArtifact(
  identityInput: ContinuationIdentityInput,
  identityResult: ContinuationIdentityResult,
  derivationResult: ContinuationCandidateDerivationResult,
  resolutionEnvelope: ContinuationResolutionEnvelope,
  scoringResult: ContinuationScoringResult,
  decision: ContinuationDecision
): ContinuationResolvedDecision {
  const content = resolvedDecisionArtifactContentObjectSchema.parse({
    contract: CONTINUATION_RESOLVED_DECISION_CONTRACT,
    schemaVersion: CONTINUATION_RESOLVED_DECISION_SCHEMA_VERSION,
    resolverVersion: CONTINUATION_RESOLVER_VERSION,
    scoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
    identityResultSha256: identityResult.resultSha256,
    derivationResultSha256: derivationResult.resultSha256,
    scoringResultSha256: scoringResult.resultSha256,
    configSha256: resolutionConfigSha256(resolutionEnvelope.config),
    sourceAssessments: (["codex", "github"] as const).map((source) => {
      const batch = identityInput.adapterBatches.find(
        (candidate) => candidate.source === source
      );
      if (batch === undefined) {
        throw new TypeError("R-003 requires explicit GitHub and Codex source batches");
      }
      return batch.status === "available" && batch.sourceAssessment !== null
        ? {
            source,
            batchSha256: batch.batchSha256,
            status: "available" as const,
            coverage: batch.sourceAssessment.coverage,
            freshness: batch.sourceAssessment.freshness
          }
        : {
            source,
            batchSha256: batch.batchSha256,
            status: "unavailable" as const,
            coverage: "unavailable" as const,
            freshness: "unavailable" as const
          };
    }),
    decision
  });
  return continuationResolvedDecisionSchema.parse({
    ...content,
    resultSha256: continuationResolvedDecisionSha256(content)
  });
}

function selectCandidates(
  candidatesInput: ContinuationCandidate[]
): ContinuationCandidate[] {
  const ranked = [...candidatesInput].sort(compareRankedCandidates);
  const selected: ContinuationCandidate[] = [];
  const workContexts = new Set<string>();
  for (const candidate of ranked) {
    if (
      candidate.workContextId !== null &&
      workContexts.has(candidate.workContextId)
    ) {
      continue;
    }
    selected.push(candidate);
    if (candidate.workContextId !== null) {
      workContexts.add(candidate.workContextId);
    }
    if (selected.length === 3) break;
  }
  return selected;
}

function compareRankedCandidates(
  left: ContinuationCandidate,
  right: ContinuationCandidate
): number {
  if (left.continuityScore !== right.continuityScore) {
    return right.continuityScore - left.continuityScore;
  }
  return left.candidateId < right.candidateId
    ? -1
    : left.candidateId > right.candidateId
      ? 1
      : 0;
}

type DecisionClassification = {
  status: ContinuationDecision["status"];
  coverageCode: ContinuationDecision["coverageCode"];
  reasonCodes: string[];
  runStatus: ContinuationDecision["run"]["status"];
  errors: ContinuationDecision["run"]["errors"];
};

function classifyDecision(
  batches: ContinuationSourceAdapterBatch[],
  derivationResult: ContinuationCandidateDerivationResult,
  selected: ContinuationCandidate[]
): DecisionClassification {
  const primary = selected[0] ?? null;
  const coverageCode =
    hasExplicitCompleteFreshCoverage(batches) &&
    !hasQualityExclusion(batches, derivationResult)
      ? "COMPLETE" as const
      : "SOURCE_LOCAL_PARTIAL" as const;
  if (primary?.availability === "ready") {
    return {
      status: "offers_available",
      coverageCode,
      reasonCodes: ["CONTINUATION_AVAILABLE"],
      runStatus: "completed",
      errors: []
    };
  }
  if (primary?.availability === "setup_required") {
    return {
      status: "setup_required",
      coverageCode: "SOURCE_LOCAL_PARTIAL",
      reasonCodes: ["CONTINUATION_SETUP_REQUIRED"],
      runStatus: "completed",
      errors: []
    };
  }
  if (bothSourcesUnavailable(batches)) {
    return {
      status: "unavailable",
      coverageCode: "UNAVAILABLE",
      reasonCodes: ["CONTINUATION_SOURCES_UNAVAILABLE"],
      runStatus: "failed",
      errors: [{
        code: "CONTINUATION_SOURCES_UNAVAILABLE",
        stage: "resolve",
        sanitizedDetail: null
      }]
    };
  }
  if (
    hasQualityExclusion(batches, derivationResult) ||
    !hasExplicitCompleteFreshCoverage(batches)
  ) {
    return {
      status: "insufficient_evidence",
      coverageCode: "INSUFFICIENT",
      reasonCodes: ["INSUFFICIENT_CONTINUATION_EVIDENCE"],
      runStatus: "partial",
      errors: [{
        code: "CONTINUATION_SOURCE_QUALITY_INSUFFICIENT",
        stage: "candidate",
        sanitizedDetail: null
      }]
    };
  }
  return {
    status: "no_recent_context",
    coverageCode,
    reasonCodes: ["NO_RECENT_CONTEXT"],
    runStatus: "completed",
    errors: []
  };
}

function hasExplicitCompleteFreshCoverage(
  batches: ContinuationSourceAdapterBatch[]
): boolean {
  return (["github", "codex"] as const).every((source) => {
    const batch = batches.find((item) => item.source === source);
    return (
      batch?.status === "available" &&
      batch.sourceAssessment?.coverage === "complete" &&
      batch.sourceAssessment.freshness === "fresh"
    );
  });
}

const ADAPTER_QUALITY_EXCLUSIONS = new Set([
  "ACTIVITIES_UNAVAILABLE",
  "ACTIVITY_AFTER_SNAPSHOT",
  "ACTIVITY_FROM_FUTURE",
  "DUPLICATE_CONFLICT",
  "INPUT_LIMIT_EXCEEDED",
  "SNAPSHOT_FROM_FUTURE",
  "SOURCE_REJECTED",
  "UNSUPPORTED_SOURCE_VERSION"
]);

const DERIVATION_QUALITY_EXCLUSIONS = new Set([
  "OBSERVATION_CONFLICT_REPORTED",
  "OBSERVATION_ERROR_REPORTED",
  "OBSERVATION_FROM_FUTURE",
  "SNAPSHOT_FRESHNESS_INVALID",
  "SNAPSHOT_FRESHNESS_UNKNOWN",
  "SNAPSHOT_STALE",
  "UNSUPPORTED_CONTINUATION_SOURCE"
]);

function hasQualityExclusion(
  batches: ContinuationSourceAdapterBatch[],
  derivationResult: ContinuationCandidateDerivationResult
): boolean {
  return (
    batches.some((batch) =>
      batch.exclusions.some((item) =>
        ADAPTER_QUALITY_EXCLUSIONS.has(item.reasonCode)
      )
    ) ||
    derivationResult.exclusions.some((item) =>
      DERIVATION_QUALITY_EXCLUSIONS.has(item.reasonCode)
    )
  );
}

function bothSourcesUnavailable(
  batches: ContinuationSourceAdapterBatch[]
): boolean {
  return (["github", "codex"] as const).every((source) => {
    const batch = batches.find((item) => item.source === source);
    return batch === undefined || batch.status === "unavailable";
  });
}

function buildDependencies(
  identityInput: ContinuationIdentityInput,
  config: ContinuationResolutionConfig
): ContinuationDependencies {
  return {
    identityPolicyVersion: CONTINUATION_ID_POLICY_VERSION,
    activityWindowPolicyVersion: CONTINUATION_ACTIVITY_WINDOW_POLICY_VERSION,
    snapshotFreshnessPolicyVersion:
      CONTINUATION_SNAPSHOT_FRESHNESS_POLICY_VERSION,
    ruleVersion: CONTINUATION_RULE_VERSION,
    scoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
    resolverVersion: CONTINUATION_RESOLVER_VERSION,
    actionPolicyVersion: CONTINUATION_ACTION_POLICY_VERSION,
    publicProjectionPolicyVersion:
      CONTINUATION_PUBLIC_PROJECTION_POLICY_VERSION,
    workContextRegistryContract: "work-context-registry-v1",
    workContextRegistrySha256: identityInput.registry.registrySha256,
    github: sourceDependency(identityInput.adapterBatches, "github"),
    codex: sourceDependency(identityInput.adapterBatches, "codex"),
    configSha256: resolutionConfigSha256(config)
  };
}

function sourceDependency(
  batches: ContinuationSourceAdapterBatch[],
  source: "github"
): ContinuationDependencies["github"];
function sourceDependency(
  batches: ContinuationSourceAdapterBatch[],
  source: "codex"
): ContinuationDependencies["codex"];
function sourceDependency(
  batches: ContinuationSourceAdapterBatch[],
  source: "github" | "codex"
): ContinuationDependencies["github"] | ContinuationDependencies["codex"] {
  const batch = batches.find((item) => item.source === source);
  if (
    batch?.status === "available" &&
    batch.sourceSnapshotSha256 !== null
  ) {
    return source === "github"
      ? {
          state: "available",
          source,
          sourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
          adapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION,
          snapshotSha256: batch.sourceSnapshotSha256
        }
      : {
          state: "available",
          source,
          sourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
          adapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION,
          snapshotSha256: batch.sourceSnapshotSha256
        };
  }
  const reasonCodes = new Set(
    batch?.exclusions.map((item) => item.reasonCode) ?? []
  );
  const reasonCode = reasonCodes.has("UNSUPPORTED_SOURCE_VERSION")
    ? "UNSUPPORTED_SOURCE_VERSION"
    : batch === undefined || reasonCodes.has("SNAPSHOT_MISSING")
      ? "SOURCE_MISSING"
      : "SOURCE_REJECTED";
  return { state: "unavailable", source, reasonCode };
}

function resolutionInputSha256(
  identityInput: ContinuationIdentityInput,
  identityResult: ContinuationIdentityResult,
  derivationEnvelope: ContinuationCandidateDerivationEnvelope,
  derivationResult: ContinuationCandidateDerivationResult,
  resolutionEnvelope: ContinuationResolutionEnvelope
): string {
  return runtimeSha256({
    domain: "continuation-resolution-input-hash-v0.1",
    input: {
      identityInput,
      identityResult,
      derivationEnvelope,
      derivationResult,
      resolution: {
        contract: resolutionEnvelope.contract,
        schemaVersion: resolutionEnvelope.schemaVersion,
        asOf: resolutionEnvelope.asOf,
        config: resolutionEnvelope.config
      }
    }
  });
}

function resolutionConfigSha256(config: ContinuationResolutionConfig): string {
  return runtimeSha256({
    domain: "continuation-resolution-config-hash-v0.1",
    config
  });
}

function refineResolvedDecision(
  value: ContinuationDecision,
  context: z.RefinementCtx
): void {
  const matrix = {
    offers_available: {
      coverage: ["COMPLETE", "SOURCE_LOCAL_PARTIAL"],
      reasonCodes: ["CONTINUATION_AVAILABLE"],
      runStatus: "completed",
      errors: []
    },
    setup_required: {
      coverage: ["SOURCE_LOCAL_PARTIAL"],
      reasonCodes: ["CONTINUATION_SETUP_REQUIRED"],
      runStatus: "completed",
      errors: []
    },
    no_recent_context: {
      coverage: ["COMPLETE"],
      reasonCodes: ["NO_RECENT_CONTEXT"],
      runStatus: "completed",
      errors: []
    },
    insufficient_evidence: {
      coverage: ["INSUFFICIENT"],
      reasonCodes: ["INSUFFICIENT_CONTINUATION_EVIDENCE"],
      runStatus: "partial",
      errors: [{
        code: "CONTINUATION_SOURCE_QUALITY_INSUFFICIENT",
        stage: "candidate",
        sanitizedDetail: null
      }]
    },
    unavailable: {
      coverage: ["UNAVAILABLE"],
      reasonCodes: ["CONTINUATION_SOURCES_UNAVAILABLE"],
      runStatus: "failed",
      errors: [{
        code: "CONTINUATION_SOURCES_UNAVAILABLE",
        stage: "resolve",
        sanitizedDetail: null
      }]
    }
  } as const;
  const expected = matrix[value.status];
  if (
    value.run.dependencies.configSha256 !==
    continuationResolutionConfigSha256()
  ) {
    addIssue(
      context,
      ["run", "dependencies", "configSha256"],
      "R-003 decision config hash mismatch"
    );
  }
  if (!(expected.coverage as readonly string[]).includes(value.coverageCode)) {
    addIssue(context, ["coverageCode"], "R-003 status/coverage mismatch");
  }
  if (
    runtimeCanonicalJson(value.reasonCodes) !==
    runtimeCanonicalJson(expected.reasonCodes)
  ) {
    addIssue(context, ["reasonCodes"], "R-003 status reason mismatch");
  }
  if (value.run.status !== expected.runStatus) {
    addIssue(context, ["run", "status"], "R-003 status/run mismatch");
  }
  if (
    runtimeCanonicalJson(value.run.errors) !==
    runtimeCanonicalJson(expected.errors)
  ) {
    addIssue(context, ["run", "errors"], "R-003 run errors are not allowlisted");
  }
  const expectedLatency =
    Date.parse(value.run.completedAt) - Date.parse(value.run.startedAt);
  if (value.run.latencyMs !== expectedLatency) {
    addIssue(context, ["run", "latencyMs"], "R-003 latency must be derived");
  }
  const selectedCount =
    (value.primary === null ? 0 : 1) + value.alternatives.length;
  const selected = [
    ...(value.primary === null ? [] : [value.primary]),
    ...value.alternatives
  ];
  for (const [index, candidate] of selected.entries()) {
    const expectedRecency = exactRecencyScore(
      candidate.observedAt,
      value.asOf
    );
    const expectedCorroboration =
      candidate.candidateKind === "linked_workstream" &&
      candidate.evidenceBand === "corroborated" &&
      candidate.sourceObservationIds.length === 2
        ? 25
        : 0;
    if (
      expectedRecency === null ||
      candidate.scoreBreakdown.recency !== expectedRecency ||
      candidate.scoreBreakdown.exactCorroboration !== expectedCorroboration ||
      candidate.scoreBreakdown.resumability !== 0 ||
      candidate.scoreBreakdown.localContinuity !== 0 ||
      candidate.scoreBreakdown.explicitPreference !== 0
    ) {
      addIssue(
        context,
        index === 0 ? ["primary", "scoreBreakdown"] : ["alternatives", index - 1, "scoreBreakdown"],
        "Candidate score is outside the exact R-003 policy"
      );
    }
  }
  if (
    (["offers_available", "setup_required"] as const).includes(
      value.status as "offers_available" | "setup_required"
    )
      ? selectedCount === 0 || value.run.admittedCandidateCount < selectedCount
      : selectedCount !== 0 || value.run.admittedCandidateCount !== 0
  ) {
    addIssue(context, ["run", "admittedCandidateCount"], "R-003 candidate accounting mismatch");
  }
}

function exactRecencyScore(observedAt: string, asOf: string): number | null {
  const observedAtMs = Date.parse(observedAt);
  const asOfMs = Date.parse(asOf);
  if (!Number.isInteger(observedAtMs) || !Number.isInteger(asOfMs)) return null;
  const ageMs = asOfMs - observedAtMs;
  if (!Number.isInteger(ageMs) || ageMs < 0) return null;
  return CONTINUATION_SCORING_CONFIG.recencyBuckets.find(
    (bucket) =>
      ageMs >= bucket.minAgeMs && ageMs < bucket.maxAgeExclusiveMs
  )?.score ?? null;
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
      return NON_CANONICAL_RESOLUTION_BOUNDARY_VALUE;
    }
  }, schema);
}
