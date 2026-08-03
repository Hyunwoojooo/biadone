import { randomBytes } from "node:crypto";

import { z } from "zod";

import resolverConfigArtifact from "../../eval/synthetic/claimAuthorityResolverConfig.v0.1.json";
import datasetArtifact from "../../eval/synthetic/claimAuthorityResolverCases.v0.1.json";
import { crossSourceDevDataset } from "../../eval/synthetic/crossSourceDevDataset";
import {
  canonicalClaimCoverage,
  createClaimEvidenceRef,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  opaqueProjectValue,
  resolveClaimAuthority,
  type BoundedClaimValue,
  type ClaimAuthorityProjection,
  type ClaimField,
  type ClaimOrigin,
  type ClaimSource,
  type ClaimSourceCoverage,
  type ClaimTargetKind,
  type NormalizedWorkClaim
} from "../claims";
import {
  CLAIM_AUTHORITY_PROJECTION_CONTRACT,
  CLAIM_CONFLICT_SCHEMA_VERSION,
  CLAIM_EVIDENCE_POLICY_VERSION,
  CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
  FIELD_CLAIM_AUTHORITY_POLICY_VERSION,
  WORK_CLAIM_SCHEMA_VERSION
} from "../crossSource/versions";
import { ARTIFACT_RELATION_DATASET_SHA256 } from "./artifactRelationResolverEvaluation";
import {
  computeCrossSourceDatasetSha256,
  sha256Canonical
} from "./crossSourceIntegrity";
import { WORK_RELATION_DATASET_SHA256 } from "./workRelationResolverEvaluation";

export const CLAIM_AUTHORITY_EVALUATION_DATASET_CONTRACT =
  "claim-authority-resolver-evaluation-dataset-v0.1" as const;
export const CLAIM_AUTHORITY_EVALUATION_CASE_SCHEMA_VERSION =
  "claim-authority-resolver-evaluation-case-v0.1" as const;
export const CLAIM_AUTHORITY_EVALUATION_RUN_RECORD_CONTRACT =
  "claim-authority-resolver-evaluation-run-v0.1" as const;

const AS_OF = "2026-08-02T03:00:00.000Z";
const T0 = "2026-08-02T02:00:00.000Z";
const T1 = "2026-08-02T02:10:00.000Z";
const T2 = "2026-08-02T02:20:00.000Z";
const FUTURE = "2026-08-02T04:00:00.000Z";
const PRIVACY_SENTINELS = [
  "PRIVATE_CLAIM_REPOSITORY_SENTINEL",
  "PRIVATE_CLAIM_URL_SENTINEL",
  "PRIVATE_CLAIM_PROMPT_SENTINEL",
  "PRIVATE_CLAIM_PATH_SENTINEL"
] as const;
const PRIVATE_FIELD_PATTERNS = [
  /"(?:prompt|answer|command|filePath|repositoryFullName|destinationUrl|title|email)"\s*:/u,
  /https?:\/\//u,
  /\/(?:Users|home|private)\//u
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime();
export const claimAuthorityResolverConfigSchema = z
  .object({
    version: z.literal("claim-authority-resolver-config-v0.1"),
    purpose: z.literal(
      "targeted_synthetic_claim_authority_evaluation_only"
    ),
    inputBoundary: z.literal("normalized_claim_resolution_inputs"),
    orderingAuthority: z
      .object({
        claims: z.literal("canonical_claim_id"),
        lineage: z.literal(
          "source_updated_at_within_exact_lineage_only"
        ),
        resolutions: z.literal("canonical_resolution_id"),
        conflicts: z.literal("canonical_conflict_id")
      })
      .strict(),
    authority: z
      .object({
        githubNativeFields: z.literal("github_exact_object_fields"),
        managedCodexExecution: z.literal(
          "blabase_owned_direct_event_stream"
        ),
        codexInventory: z.literal("context_only"),
        projectAlignment: z.literal(
          "two_explicit_user_scope_mappings"
        ),
        notionTaskFields: z.literal(
          "future_configured_task_database_only"
        ),
        calendarFields: z.literal("future_native_event_only"),
        unsupportedSourceFieldRejected: z.literal(true)
      })
      .strict(),
    identity: z
      .object({
        exactOpaqueTargetAndSemanticField: z.literal(true),
        sameProjectCreatesFieldEquivalence: z.literal(false),
        titleSimilarityAllowed: z.literal(false),
        timeSimilarityAllowed: z.literal(false),
        genericStateFieldAllowed: z.literal(false)
      })
      .strict(),
    resolution: z
      .object({
        sameLineageStrictlyNewerMaySupersede: z.literal(true),
        crossLineageTimestampOverride: z.literal(false),
        equalAuthorityDisagreement: z.literal("review_required"),
        staleAuthorityCanWin: z.literal(false),
        contextOnlyCanWin: z.literal(false),
        absenceCreatesCompletion: z.literal(false),
        activityCreatesCurrentState: z.literal(false)
      })
      .strict(),
    runtimeCoverage: z
      .object({
        githubCurrentStateValues: z.tuple([z.literal("open")]),
        managedCodexDirectExecution: z.literal(true),
        notionTaskProperties: z.literal(false),
        calendarWorkEquivalence: z.literal(false)
      })
      .strict(),
    attention: z
      .object({
        disposition: z.literal("not_connected"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    privacy: z
      .object({
        publicRawTitles: z.literal(false),
        publicRepositoryNames: z.literal(false),
        publicRawUrls: z.literal(false),
        publicNativeObjectIds: z.literal(false),
        publicPromptAnswerCommandOrPath: z.literal(false),
        boundedValuesOnly: z.literal(true)
      })
      .strict()
  })
  .strict();
const scenarioSchema = z.enum([
  "github_open",
  "github_relationship",
  "github_milestone",
  "managed_running",
  "managed_completed",
  "notion_state",
  "notion_priority",
  "calendar_state",
  "calendar_time",
  "user_disposition",
  "no_claims",
  "stale_github",
  "inventory_only",
  "managed_over_inventory",
  "consistent_managed_lineages",
  "newer_same_lineage",
  "equal_time_same_lineage",
  "aligned_project",
  "conflicting_project",
  "single_project_mapping",
  "codex_completed_github_open",
  "notion_open_github_completed",
  "calendar_time_github_milestone",
  "same_field_different_targets",
  "duplicate_claim",
  "stale_managed_with_inventory",
  "notion_priority_user_conflict",
  "partial_current_github",
  "three_consistent_projects",
  "reversed_project_conflict",
  "activity_only_no_claim",
  "absence_no_claim",
  "future_evidence_rejected",
  "unsupported_authority_rejected",
  "equal_time_cross_lineage",
  "newer_cross_lineage_no_override",
  "privacy_sentinel",
  "user_disposition_with_github_state",
  "current_and_stale_same_value",
  "mixed_independent_claims"
]);

const expectedSchema = z
  .object({
    error: z
      .enum([
        "FUTURE_EVIDENCE",
        "UNSUPPORTED_AUTHORITY",
        "CASE_EXECUTION_FAILED"
      ])
      .nullable(),
    deduplicatedClaimCount: z.number().int().nonnegative(),
    resolutionFields: z.array(z.string().min(1)),
    resolutionStatuses: z.array(
      z.enum(["resolved", "review_required", "insufficient_evidence"])
    ),
    winnerSources: z.array(z.string().min(1)),
    conflictFields: z.array(z.string().min(1)),
    conflictStatuses: z.array(
      z.enum([
        "resolved_by_authority",
        "resolved_by_freshness",
        "review_required"
      ])
    ),
    conflictReasons: z.array(z.string().regex(/^[A-Z0-9_]+$/))
  })
  .strict()
  .superRefine((expected, context) => {
    if (
      expected.resolutionFields.length !==
      expected.resolutionStatuses.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolutionStatuses"],
        message: "Resolution fields and statuses must have equal lengths."
      });
    }
    if (
      expected.conflictFields.length !== expected.conflictStatuses.length ||
      expected.conflictFields.length !== expected.conflictReasons.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conflictStatuses"],
        message: "Conflict fields, statuses, and reasons must have equal lengths."
      });
    }
  });

const evaluationCaseSchema = z
  .object({
    caseId: z.string().regex(/^CLAIM-DEV-[0-9]{3}$/),
    title: z.string().min(1).max(180),
    surface: z.enum(["current_runtime", "future_contract", "integrity"]),
    scenario: scenarioSchema,
    expected: expectedSchema,
    labels: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1)
  })
  .strict();

export const claimAuthorityEvaluationDatasetSchema = z
  .object({
    contract: z.literal(CLAIM_AUTHORITY_EVALUATION_DATASET_CONTRACT),
    schemaVersion: z.literal(
      CLAIM_AUTHORITY_EVALUATION_CASE_SCHEMA_VERSION
    ),
    datasetVersion: z.literal("suggestion-claim-authority-dev-v0.1"),
    datasetRevision: z.literal(2),
    datasetClass: z.literal("dev_candidate"),
    inputBoundary: z.literal("normalized_claim_resolution_inputs"),
    dataOrigin: z.literal("synthetic"),
    containsProductionData: z.literal(false),
    createdAt: timestampSchema,
    lifecycle: z
      .object({
        state: z.literal("mutable"),
        datasetSha256: z.null(),
        immutableRef: z.null(),
        frozenAt: z.null()
      })
      .strict(),
    resolverConfig: z
      .object({
        immutableRef: z.literal(
          "eval/synthetic/claimAuthorityResolverConfig.v0.1.json"
        ),
        version: z.literal("claim-authority-resolver-config-v0.1"),
        sha256: sha256Schema
      })
      .strict(),
    dependencyDatasets: z
      .object({
        phase3aWorkRelationSha256: sha256Schema,
        phase3bArtifactRelationSha256: sha256Schema,
        crossSourceDevSha256: sha256Schema
      })
      .strict(),
    expectedInvariants: z
      .object({
        attentionDisposition: z.literal("not_connected"),
        forbiddenAsAttentionCandidate: z.literal(true),
        containsRawPrivateValues: z.literal(false)
      })
      .strict(),
    expectedProjectionSha256ByCase: z.record(
      z.string().regex(/^CLAIM-DEV-[0-9]{3}$/),
      sha256Schema.nullable()
    ),
    cases: z.array(evaluationCaseSchema).length(40)
  })
  .strict()
  .superRefine((dataset, context) => {
    const ids = new Set<string>();
    const scenarios = new Set<string>();
    dataset.cases.forEach((item, index) => {
      if (ids.has(item.caseId) || scenarios.has(item.scenario)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index],
          message: "Claim evaluation case IDs and scenarios must be unique."
        });
      }
      ids.add(item.caseId);
      scenarios.add(item.scenario);
    });
    const expectedProjectionCaseIds = Object.keys(
      dataset.expectedProjectionSha256ByCase
    ).sort();
    const caseIds = [...ids].sort();
    if (
      expectedProjectionCaseIds.length !== caseIds.length ||
      expectedProjectionCaseIds.some(
        (caseId, index) => caseId !== caseIds[index]
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedProjectionSha256ByCase"],
        message: "Every case requires one exact expected projection hash."
      });
    }
  });

export type ClaimAuthorityEvaluationDataset = z.infer<
  typeof claimAuthorityEvaluationDatasetSchema
>;
export type ClaimAuthorityEvaluationCase =
  ClaimAuthorityEvaluationDataset["cases"][number];

type ExpectedSummary = z.infer<typeof expectedSchema>;

export type ClaimAuthorityCaseResult = {
  caseId: string;
  surface: ClaimAuthorityEvaluationCase["surface"];
  passed: boolean;
  expectedSha256: string;
  actualSha256: string;
  expectedProjectionSha256: string | null;
  projectionSha256: string | null;
  expected: ExpectedSummary;
  actual: ExpectedSummary;
};

export type ClaimAuthorityEvaluationMetrics = {
  caseCount: number;
  exactCasePassCount: number;
  exactCasePassRate: number;
  expectedResolutionCount: number;
  observedResolutionCount: number;
  expectedConflictCount: number;
  observedConflictCount: number;
  resolutionPrecision: number;
  resolutionRecall: number;
  conflictPrecision: number;
  conflictRecall: number;
  semanticProjectionMismatchCount: number;
  wrongAuthorityWinnerCount: number;
  contextOnlyWinnerCount: number;
  staleWinnerCount: number;
  crossDomainConflationCount: number;
  falseConflictCount: number;
  missedCriticalConflictCount: number;
  criticalConflictAutoResolutionCount: number;
  currentStateFromActivityLeakageCount: number;
  absenceAsCompletionCount: number;
  timestampOnlyOverrideCount: number;
  unsupportedAuthorityAcceptanceCount: number;
  futureEvidenceAcceptanceCount: number;
  originalClaimLossCount: number;
  attentionLeakageCount: number;
  privacySentinelLeakageCount: number;
  rawPrivateFieldLeakageCount: number;
  permutationDeterminismFailureCount: number;
  phase3aDatasetHashMismatchCount: number;
  phase3bDatasetHashMismatchCount: number;
  crossSourceDatasetHashMismatchCount: number;
};

export type ClaimAuthorityEvaluationRecord = {
  contract: typeof CLAIM_AUTHORITY_EVALUATION_RUN_RECORD_CONTRACT;
  runId: string;
  comparisonRunId: null;
  comparisonReason: "INITIAL_TARGETED_PHASE3C_DEV_CANDIDATE_BASELINE";
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  dataset: {
    version: "suggestion-claim-authority-dev-v0.1";
    revision: 2;
    class: "dev_candidate";
    lifecycle: "mutable";
    inputBoundary: "normalized_claim_resolution_inputs";
    canonicalSha256: string;
    materializedInputSha256: string;
    caseCount: number;
  };
  versions: {
    datasetSchemaVersion: typeof CLAIM_AUTHORITY_EVALUATION_CASE_SCHEMA_VERSION;
    projectionContract: typeof CLAIM_AUTHORITY_PROJECTION_CONTRACT;
    claimSchemaVersion: typeof WORK_CLAIM_SCHEMA_VERSION;
    conflictSchemaVersion: typeof CLAIM_CONFLICT_SCHEMA_VERSION;
    resolverVersion: typeof CROSS_SOURCE_CLAIM_RESOLVER_VERSION;
    authorityPolicyVersion: typeof FIELD_CLAIM_AUTHORITY_POLICY_VERSION;
    evidencePolicyVersion: typeof CLAIM_EVIDENCE_POLICY_VERSION;
  };
  resolverConfig: ClaimAuthorityEvaluationDataset["resolverConfig"];
  dependencyDatasets: ClaimAuthorityEvaluationDataset["dependencyDatasets"];
  code: {
    commitSha: string | null;
    state:
      | "clean_commit"
      | "declared_commit"
      | "dirty_worktree"
      | "unavailable";
    fingerprintSha256: string | null;
  };
  inference: {
    provider: "not_applicable";
    model: "not_applicable";
    promptVersion: "not_applicable";
    tokenUsage: "not_applicable";
  };
  metrics: ClaimAuthorityEvaluationMetrics;
  cases: ClaimAuthorityCaseResult[];
  deterministicOutputSha256: string;
  errors: Array<{
    caseId: string;
    code: "CLAIM_AUTHORITY_EXACT_MISMATCH";
  }>;
  attentionDisposition: "not_connected";
  privacyClass: "synthetic_sanitized_metadata";
};

type ExecutedCase = {
  result: ClaimAuthorityCaseResult;
  projection: ClaimAuthorityProjection | null;
  inputClaims: NormalizedWorkClaim[];
  sourceCoverage: ClaimSourceCoverage[];
  dependencies: ReturnType<typeof evaluationDependencies>;
  materializedInput: unknown;
};

export function loadClaimAuthorityEvaluationDataset(
  input: unknown,
  resolverConfigInput: unknown = resolverConfigArtifact
): ClaimAuthorityEvaluationDataset {
  const dataset = claimAuthorityEvaluationDatasetSchema.parse(input);
  const resolverConfig = claimAuthorityResolverConfigSchema.parse(
    resolverConfigInput
  );
  if (
    dataset.resolverConfig.sha256 !==
      sha256Canonical(resolverConfig) ||
    dataset.resolverConfig.version !== resolverConfig.version
  ) {
    throw new Error(
      "Claim authority resolver evaluation config integrity check failed."
    );
  }
  return dataset;
}

export const claimAuthorityResolverConfig =
  claimAuthorityResolverConfigSchema.parse(resolverConfigArtifact);

export const CLAIM_AUTHORITY_CONFIG_SHA256 = sha256Canonical(
  claimAuthorityResolverConfig
);

export const claimAuthorityEvaluationDataset =
  loadClaimAuthorityEvaluationDataset(datasetArtifact);

export const CLAIM_AUTHORITY_DATASET_SHA256 = sha256Canonical(
  claimAuthorityEvaluationDataset
);

export function runClaimAuthorityEvaluation(input?: {
  startedAt?: Date;
  completedAt?: Date;
  code?: ClaimAuthorityEvaluationRecord["code"];
  dataset?: ClaimAuthorityEvaluationDataset;
}): ClaimAuthorityEvaluationRecord {
  const startedAt = input?.startedAt ?? new Date();
  const dataset = input?.dataset ?? claimAuthorityEvaluationDataset;
  const executed = dataset.cases.map((evaluationCase) =>
    executeCase(
      evaluationCase,
      dataset.expectedProjectionSha256ByCase[evaluationCase.caseId] ?? null
    )
  );
  const cases = executed.map((item) => item.result);
  const metrics = computeMetrics(executed, dataset);
  const errors = cases
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: "CLAIM_AUTHORITY_EXACT_MISMATCH" as const
    }));
  const materializedInputSha256 = sha256Canonical(
    executed.map((item) => item.materializedInput)
  );
  const deterministicOutputSha256 = sha256Canonical({
    datasetSha256: sha256Canonical(dataset),
    materializedInputSha256,
    versions: {
      projection: CLAIM_AUTHORITY_PROJECTION_CONTRACT,
      claim: WORK_CLAIM_SCHEMA_VERSION,
      conflict: CLAIM_CONFLICT_SCHEMA_VERSION,
      resolver: CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
      authority: FIELD_CLAIM_AUTHORITY_POLICY_VERSION,
      evidence: CLAIM_EVIDENCE_POLICY_VERSION
    },
    metrics,
    cases
  });
  const completedAt = input?.completedAt ?? new Date();
  return {
    contract: CLAIM_AUTHORITY_EVALUATION_RUN_RECORD_CONTRACT,
    runId: `claim_authority_run_${randomBytes(16).toString("hex")}`,
    comparisonRunId: null,
    comparisonReason:
      "INITIAL_TARGETED_PHASE3C_DEV_CANDIDATE_BASELINE",
    status:
      errors.length === 0 && claimAuthorityReleaseGatesPass(metrics)
        ? "passed"
        : "failed",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    latencyMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    dataset: {
      version: dataset.datasetVersion,
      revision: dataset.datasetRevision,
      class: dataset.datasetClass,
      lifecycle: dataset.lifecycle.state,
      inputBoundary: dataset.inputBoundary,
      canonicalSha256: sha256Canonical(dataset),
      materializedInputSha256,
      caseCount: dataset.cases.length
    },
    versions: {
      datasetSchemaVersion:
        CLAIM_AUTHORITY_EVALUATION_CASE_SCHEMA_VERSION,
      projectionContract: CLAIM_AUTHORITY_PROJECTION_CONTRACT,
      claimSchemaVersion: WORK_CLAIM_SCHEMA_VERSION,
      conflictSchemaVersion: CLAIM_CONFLICT_SCHEMA_VERSION,
      resolverVersion: CROSS_SOURCE_CLAIM_RESOLVER_VERSION,
      authorityPolicyVersion: FIELD_CLAIM_AUTHORITY_POLICY_VERSION,
      evidencePolicyVersion: CLAIM_EVIDENCE_POLICY_VERSION
    },
    resolverConfig: dataset.resolverConfig,
    dependencyDatasets: dataset.dependencyDatasets,
    code: input?.code ?? {
      commitSha: null,
      state: "unavailable",
      fingerprintSha256: null
    },
    inference: {
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      tokenUsage: "not_applicable"
    },
    metrics,
    cases,
    deterministicOutputSha256,
    errors,
    attentionDisposition: "not_connected",
    privacyClass: "synthetic_sanitized_metadata"
  };
}

export function claimAuthorityReleaseGatesPass(
  metrics: ClaimAuthorityEvaluationMetrics
): boolean {
  const zeroGuardrails = [
    metrics.wrongAuthorityWinnerCount,
    metrics.semanticProjectionMismatchCount,
    metrics.contextOnlyWinnerCount,
    metrics.staleWinnerCount,
    metrics.crossDomainConflationCount,
    metrics.falseConflictCount,
    metrics.missedCriticalConflictCount,
    metrics.criticalConflictAutoResolutionCount,
    metrics.currentStateFromActivityLeakageCount,
    metrics.absenceAsCompletionCount,
    metrics.timestampOnlyOverrideCount,
    metrics.unsupportedAuthorityAcceptanceCount,
    metrics.futureEvidenceAcceptanceCount,
    metrics.originalClaimLossCount,
    metrics.attentionLeakageCount,
    metrics.privacySentinelLeakageCount,
    metrics.rawPrivateFieldLeakageCount,
    metrics.permutationDeterminismFailureCount,
    metrics.phase3aDatasetHashMismatchCount,
    metrics.phase3bDatasetHashMismatchCount,
    metrics.crossSourceDatasetHashMismatchCount
  ];
  return (
    metrics.caseCount === 40 &&
    metrics.exactCasePassCount === metrics.caseCount &&
    metrics.resolutionPrecision === 1 &&
    metrics.resolutionRecall === 1 &&
    metrics.conflictPrecision === 1 &&
    metrics.conflictRecall === 1 &&
    zeroGuardrails.every((value) => value === 0)
  );
}

function executeCase(
  evaluationCase: ClaimAuthorityEvaluationCase,
  expectedProjectionSha256: string | null
): ExecutedCase {
  let projection: ClaimAuthorityProjection | null = null;
  let inputClaims: NormalizedWorkClaim[] = [];
  let error: ExpectedSummary["error"] = null;
  const dependencies = evaluationDependencies();
  const sourceCoverage = evaluationSourceCoverage(
    evaluationCase.scenario
  );
  try {
    inputClaims = buildScenarioClaims(evaluationCase.scenario);
    projection = resolveClaimAuthority({
      asOf: AS_OF,
      dependencies,
      sourceCoverage,
      claims: inputClaims
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    error = message.includes("newer than asOf")
      ? "FUTURE_EVIDENCE"
      : message.includes("Unsupported source")
        ? "UNSUPPORTED_AUTHORITY"
        : "CASE_EXECUTION_FAILED";
  }

  const actual = summarizeProjection(projection, error);
  const expected = canonicalExpected(evaluationCase.expected);
  const expectedSha256 = sha256Canonical(expected);
  const actualSha256 = sha256Canonical(actual);
  return {
    result: {
      caseId: evaluationCase.caseId,
      surface: evaluationCase.surface,
      passed:
        expectedSha256 === actualSha256 &&
        expectedProjectionSha256 ===
          (projection?.projectionSha256 ?? null),
      expectedSha256,
      actualSha256,
      expectedProjectionSha256,
      projectionSha256: projection?.projectionSha256 ?? null,
      expected,
      actual
    },
    projection,
    inputClaims,
    sourceCoverage,
    dependencies,
    materializedInput: {
      caseId: evaluationCase.caseId,
      scenario: evaluationCase.scenario,
      surface: evaluationCase.surface,
      asOf: AS_OF,
      dependencies,
      sourceCoverage,
      attemptedOperation: scenarioOperationDescriptor(
        evaluationCase.scenario
      ),
      normalizedClaims: inputClaims
    }
  };
}

function summarizeProjection(
  projection: ClaimAuthorityProjection | null,
  error: ExpectedSummary["error"]
): ExpectedSummary {
  if (!projection) {
    return canonicalExpected({
      error,
      deduplicatedClaimCount: 0,
      resolutionFields: [],
      resolutionStatuses: [],
      winnerSources: [],
      conflictFields: [],
      conflictStatuses: [],
      conflictReasons: []
    });
  }
  const claimsById = new Map(
    projection.claims.map((claim) => [claim.claimId, claim])
  );
  return canonicalExpected({
    error,
    deduplicatedClaimCount: projection.deduplicatedClaimCount,
    resolutionFields: projection.fieldResolutions.map(
      (resolution) => resolution.field
    ),
    resolutionStatuses: projection.fieldResolutions.map(
      (resolution) => resolution.status
    ),
    winnerSources: projection.fieldResolutions.flatMap((resolution) => {
      if (!resolution.winningClaimId) return [];
      const winner = claimsById.get(resolution.winningClaimId);
      return winner ? [winner.source] : [];
    }),
    conflictFields: projection.conflicts.map((conflict) => conflict.field),
    conflictStatuses: projection.conflicts.map(
      (conflict) => conflict.status
    ),
    conflictReasons: projection.conflicts.map(
      (conflict) => conflict.reasonCode
    )
  });
}

function canonicalExpected(expected: ExpectedSummary): ExpectedSummary {
  const resolutions = expected.resolutionFields
    .map((field, index) => ({
      field,
      status: expected.resolutionStatuses[index]
    }))
    .sort((left, right) =>
      `${left.field}\u0000${left.status}`.localeCompare(
        `${right.field}\u0000${right.status}`
      )
    );
  const conflicts = expected.conflictFields
    .map((field, index) => ({
      field,
      status: expected.conflictStatuses[index],
      reason: expected.conflictReasons[index]
    }))
    .sort((left, right) =>
      `${left.field}\u0000${left.status}\u0000${left.reason}`.localeCompare(
        `${right.field}\u0000${right.status}\u0000${right.reason}`
      )
    );
  return {
    ...expected,
    resolutionFields: resolutions.map((item) => item.field),
    resolutionStatuses: resolutions.map((item) => item.status),
    winnerSources: [...expected.winnerSources].sort(),
    conflictFields: conflicts.map((item) => item.field),
    conflictStatuses: conflicts.map((item) => item.status),
    conflictReasons: conflicts.map((item) => item.reason)
  };
}

function computeMetrics(
  executed: ExecutedCase[],
  dataset: ClaimAuthorityEvaluationDataset
): ClaimAuthorityEvaluationMetrics {
  const expectedResolutionCount = sum(
    executed.map((item) => item.result.expected.resolutionFields.length)
  );
  const observedResolutionCount = sum(
    executed.map((item) => item.result.actual.resolutionFields.length)
  );
  const expectedConflictCount = sum(
    executed.map((item) => item.result.expected.conflictFields.length)
  );
  const observedConflictCount = sum(
    executed.map((item) => item.result.actual.conflictFields.length)
  );
  const resolutionTruePositives = multisetMatches(
    executed.flatMap((item) =>
      item.result.expected.resolutionFields.map(
        (field, index) =>
          `${item.result.caseId}:${field}:${item.result.expected.resolutionStatuses[index] ?? "missing"}`
      )
    ),
    executed.flatMap((item) =>
      item.result.actual.resolutionFields.map(
        (field, index) =>
          `${item.result.caseId}:${field}:${item.result.actual.resolutionStatuses[index] ?? "missing"}`
      )
    )
  );
  const conflictTruePositives = multisetMatches(
    executed.flatMap((item) =>
      item.result.expected.conflictFields.map(
        (field, index) =>
          `${item.result.caseId}:${field}:${item.result.expected.conflictStatuses[index] ?? "missing"}`
      )
    ),
    executed.flatMap((item) =>
      item.result.actual.conflictFields.map(
        (field, index) =>
          `${item.result.caseId}:${field}:${item.result.actual.conflictStatuses[index] ?? "missing"}`
      )
    )
  );

  return {
    caseCount: executed.length,
    exactCasePassCount: executed.filter((item) => item.result.passed).length,
    exactCasePassRate: ratio(
      executed.filter((item) => item.result.passed).length,
      executed.length
    ),
    expectedResolutionCount,
    observedResolutionCount,
    expectedConflictCount,
    observedConflictCount,
    resolutionPrecision: ratio(
      resolutionTruePositives,
      observedResolutionCount
    ),
    resolutionRecall: ratio(
      resolutionTruePositives,
      expectedResolutionCount
    ),
    conflictPrecision: ratio(conflictTruePositives, observedConflictCount),
    conflictRecall: ratio(conflictTruePositives, expectedConflictCount),
    semanticProjectionMismatchCount: executed.filter(
      (item) =>
        item.result.expectedProjectionSha256 !==
        item.result.projectionSha256
    ).length,
    wrongAuthorityWinnerCount: executed.filter(
      (item) =>
        sha256Canonical(item.result.expected.winnerSources) !==
        sha256Canonical(item.result.actual.winnerSources)
    ).length,
    contextOnlyWinnerCount: sum(
      executed.map((item) => countInvalidWinners(item.projection, "context"))
    ),
    staleWinnerCount: sum(
      executed.map((item) => countInvalidWinners(item.projection, "stale"))
    ),
    crossDomainConflationCount: countLabeledUnexpectedConflicts(
      executed,
      dataset,
      "cross_domain_guard"
    ),
    falseConflictCount: sum(
      executed.map((item) =>
        Math.max(
          0,
          item.result.actual.conflictFields.length -
            item.result.expected.conflictFields.length
        )
      )
    ),
    missedCriticalConflictCount: sum(
      executed.map((item) =>
        Math.max(
          0,
          item.result.expected.conflictFields.length -
            item.result.actual.conflictFields.length
        )
      )
    ),
    criticalConflictAutoResolutionCount: executed.filter((item) => {
      const expectedReview = item.result.expected.conflictStatuses.includes(
        "review_required"
      );
      return (
        expectedReview &&
        !item.result.actual.conflictStatuses.includes("review_required")
      );
    }).length,
    currentStateFromActivityLeakageCount: countLabeledOutput(
      executed,
      dataset,
      "activity_state_guard"
    ),
    absenceAsCompletionCount: countLabeledOutput(
      executed,
      dataset,
      "absence_as_completion_guard"
    ),
    timestampOnlyOverrideCount: countLabeledResolved(
      executed,
      dataset,
      "timestamp_only_override_guard"
    ),
    unsupportedAuthorityAcceptanceCount: countExpectedErrorAccepted(
      executed,
      "UNSUPPORTED_AUTHORITY"
    ),
    futureEvidenceAcceptanceCount: countExpectedErrorAccepted(
      executed,
      "FUTURE_EVIDENCE"
    ),
    originalClaimLossCount: executed.filter(hasOriginalClaimLoss).length,
    attentionLeakageCount: sum(
      executed.map((item) => attentionLeakage(item.projection))
    ),
    privacySentinelLeakageCount: executed.filter((item) => {
      const serialized = JSON.stringify(item.projection ?? item.result);
      return PRIVACY_SENTINELS.some((sentinel) => serialized.includes(sentinel));
    }).length,
    rawPrivateFieldLeakageCount: executed.filter((item) => {
      const serialized = JSON.stringify({
        projection: item.projection,
        result: item.result,
        materializedInput: item.materializedInput
      });
      return PRIVATE_FIELD_PATTERNS.some((pattern) => pattern.test(serialized));
    }).length,
    permutationDeterminismFailureCount: executed.filter((item) =>
      permutationChanged(item)
    ).length,
    phase3aDatasetHashMismatchCount:
      dataset.dependencyDatasets.phase3aWorkRelationSha256 ===
      WORK_RELATION_DATASET_SHA256
        ? 0
        : 1,
    phase3bDatasetHashMismatchCount:
      dataset.dependencyDatasets.phase3bArtifactRelationSha256 ===
      ARTIFACT_RELATION_DATASET_SHA256
        ? 0
        : 1,
    crossSourceDatasetHashMismatchCount:
      dataset.dependencyDatasets.crossSourceDevSha256 ===
      computeCrossSourceDatasetSha256(crossSourceDevDataset)
        ? 0
        : 1
  };
}

function evaluationSourceCoverage(
  scenario: z.infer<typeof scenarioSchema>
): ClaimSourceCoverage[] {
  const github =
    scenario === "stale_github"
      ? "stale"
      : scenario === "partial_current_github"
        ? "partial"
        : "evaluated";
  const coverage = canonicalClaimCoverage({ github });
  const replace = (
    source: ClaimSourceCoverage["source"],
    item: ClaimSourceCoverage
  ) => {
    const index = coverage.findIndex(
      (candidate) => candidate.source === source
    );
    if (index < 0) throw new TypeError("Evaluation coverage source missing.");
    coverage[index] = item;
  };
  if (
    [
      "notion_state",
      "notion_priority",
      "notion_open_github_completed",
      "notion_priority_user_conflict"
    ].includes(scenario)
  ) {
    replace("notion", {
      source: "notion",
      status: "evaluated",
      claimFields: ["notion_internal_priority", "notion_task_state"],
      reasonCodes: ["NOTION_CONFIGURED_TASK_FIELDS_EVALUATED"]
    });
  }
  if (
    [
      "calendar_state",
      "calendar_time",
      "calendar_time_github_milestone"
    ].includes(scenario)
  ) {
    replace("google_calendar", {
      source: "google_calendar",
      status: "evaluated",
      claimFields: ["calendar_event_state", "calendar_event_time"],
      reasonCodes: ["CALENDAR_NATIVE_EVENT_FIELDS_EVALUATED"]
    });
  }
  if (
    [
      "user_disposition",
      "user_disposition_with_github_state",
      "notion_priority_user_conflict",
      "mixed_independent_claims"
    ].includes(scenario)
  ) {
    replace("explicit_user", {
      source: "explicit_user",
      status: "evaluated",
      claimFields: [
        "notion_internal_priority",
        "project_alignment_identity",
        "user_disposition"
      ],
      reasonCodes: [
        "EXPLICIT_PROJECT_MAPPING_EVALUATED",
        "EXPLICIT_USER_FEEDBACK_EVALUATED"
      ]
    });
  }
  return [...coverage].sort((left, right) =>
    left.source.localeCompare(right.source)
  );
}

function scenarioOperationDescriptor(
  scenario: z.infer<typeof scenarioSchema>
): Record<string, string> {
  if (scenario === "unsupported_authority_rejected") {
    return {
      operation: "create_normalized_claim",
      source: "notion",
      targetKind: "github_work_item",
      field: "github_work_item_state",
      expectedBoundary: "unsupported_source_field"
    };
  }
  return {
    operation: "resolve_normalized_claims",
    scenario
  };
}

function buildScenarioClaims(
  scenario: z.infer<typeof scenarioSchema>
): NormalizedWorkClaim[] {
  switch (scenario) {
    case "github_open":
      return [githubState("open")];
    case "github_relationship":
      return [
        claim({
          targetKind: "github_work_item",
          targetSeed: "github-a",
          lineageSeed: "github-a",
          field: "github_user_relationship",
          value: { type: "enum", value: "assigned_to_user" },
          source: "github",
          origin: "github_normalized_snapshot"
        })
      ];
    case "github_milestone":
      return [githubMilestone()];
    case "managed_running":
      return [managedState("running")];
    case "managed_completed":
      return [managedState("completed")];
    case "notion_state":
      return [notionState("in_progress")];
    case "notion_priority":
      return [notionPriority("high")];
    case "calendar_state":
      return [calendarState("confirmed")];
    case "calendar_time":
      return [calendarTime()];
    case "user_disposition":
      return [userDisposition("not_now")];
    case "no_claims":
    case "activity_only_no_claim":
    case "absence_no_claim":
      return [];
    case "stale_github":
      return [githubState("open", { freshness: "stale" })];
    case "inventory_only":
      return [inventoryState("completed")];
    case "managed_over_inventory":
      return [managedState("running"), inventoryState("completed")];
    case "consistent_managed_lineages":
      return [
        managedState("running", { lineageSeed: "run-a" }),
        managedState("running", { lineageSeed: "run-b" })
      ];
    case "newer_same_lineage":
      return [
        managedState("running", {
          lineageSeed: "run-a",
          sourceUpdatedAt: T0
        }),
        managedState("completed", {
          lineageSeed: "run-a",
          sourceUpdatedAt: T2
        })
      ];
    case "equal_time_same_lineage":
      return [
        managedState("running", { sourceUpdatedAt: T1 }),
        managedState("failed", { sourceUpdatedAt: T1 })
      ];
    case "aligned_project":
      return [project("project-a", "codex"), project("project-a", "github")];
    case "conflicting_project":
      return [project("project-a", "codex", T0), project("project-b", "github", T2)];
    case "single_project_mapping":
      return [project("project-a", "codex")];
    case "codex_completed_github_open":
      return [managedState("completed"), githubState("open")];
    case "notion_open_github_completed":
      return [notionState("open"), githubState("completed")];
    case "calendar_time_github_milestone":
      return [calendarTime(), githubMilestone()];
    case "same_field_different_targets":
      return [
        githubState("open", { targetSeed: "github-a" }),
        githubState("completed", { targetSeed: "github-b" })
      ];
    case "duplicate_claim": {
      const duplicate = githubState("open");
      return [duplicate, duplicate];
    }
    case "stale_managed_with_inventory":
      return [
        managedState("running", { freshness: "stale" }),
        inventoryState("completed")
      ];
    case "notion_priority_user_conflict":
      return [
        notionPriority("high"),
        claim({
          targetKind: "notion_task",
          targetSeed: "notion-a",
          lineageSeed: "user-priority",
          field: "notion_internal_priority",
          value: { type: "enum", value: "urgent" },
          source: "explicit_user",
          origin: "explicit_user_feedback"
        })
      ];
    case "partial_current_github":
      return [githubState("open", { completeness: "partial" })];
    case "three_consistent_projects":
      return [
        project("project-a", "codex"),
        project("project-a", "github"),
        project("project-a", "notion")
      ];
    case "reversed_project_conflict":
      return [project("project-b", "github"), project("project-a", "codex")];
    case "future_evidence_rejected":
      return [
        githubState("open", {
          observedAt: FUTURE,
          sourceUpdatedAt: FUTURE
        })
      ];
    case "unsupported_authority_rejected":
      return [
        claim({
          targetKind: "github_work_item",
          targetSeed: "github-a",
          lineageSeed: "notion-a",
          field: "github_work_item_state",
          value: { type: "enum", value: "open" },
          source: "notion",
          origin: "notion_task_database"
        })
      ];
    case "equal_time_cross_lineage":
      return [
        managedState("running", { lineageSeed: "run-a", sourceUpdatedAt: T1 }),
        managedState("failed", { lineageSeed: "run-b", sourceUpdatedAt: T1 })
      ];
    case "newer_cross_lineage_no_override":
      return [
        managedState("running", { lineageSeed: "run-a", sourceUpdatedAt: T0 }),
        managedState("failed", { lineageSeed: "run-b", sourceUpdatedAt: T2 })
      ];
    case "privacy_sentinel":
      return [
        githubState("open", {
          targetSeed: PRIVACY_SENTINELS.join(":")
        })
      ];
    case "user_disposition_with_github_state":
      return [userDisposition("completed"), githubState("open")];
    case "current_and_stale_same_value":
      return [
        githubState("open", { freshness: "stale", sourceUpdatedAt: T0 }),
        githubState("open", { freshness: "current", sourceUpdatedAt: T2 })
      ];
    case "mixed_independent_claims":
      return [userDisposition("active"), githubState("open"), managedState("running")];
  }
}

function claim(input: {
  targetKind: ClaimTargetKind;
  targetSeed: string;
  lineageSeed: string;
  field: ClaimField;
  value: BoundedClaimValue;
  source: ClaimSource;
  origin: ClaimOrigin;
  freshness?: "current" | "stale";
  completeness?: "complete" | "partial" | "unknown";
  directness?: "explicit" | "derived";
  observedAt?: string;
  sourceUpdatedAt?: string;
}): NormalizedWorkClaim {
  const observedAt = input.observedAt ?? T2;
  return createNormalizedWorkClaim({
    target: {
      kind: input.targetKind,
      ref: createClaimTargetRef({
        kind: input.targetKind,
        identity: { seed: input.targetSeed }
      })
    },
    lineageRef: createClaimLineageRef({ seed: input.lineageSeed }),
    field: input.field,
    value: input.value,
    source: input.source,
    origin: input.origin,
    freshness: input.freshness ?? "current",
    completeness: input.completeness ?? "complete",
    directness: input.directness ?? "explicit",
    observedAt,
    sourceUpdatedAt: input.sourceUpdatedAt ?? observedAt,
    evidenceRefs: [
      createClaimEvidenceRef({
        seed: input.lineageSeed,
        sourceUpdatedAt: input.sourceUpdatedAt ?? observedAt,
        value: input.value
      })
    ]
  });
}

function githubState(
  value: "open" | "completed" | "cancelled",
  options: {
    freshness?: "current" | "stale";
    completeness?: "complete" | "partial" | "unknown";
    targetSeed?: string;
    observedAt?: string;
    sourceUpdatedAt?: string;
  } = {}
): NormalizedWorkClaim {
  const targetSeed = options.targetSeed ?? "github-a";
  return claim({
    targetKind: "github_work_item",
    targetSeed,
    lineageSeed: targetSeed,
    field: "github_work_item_state",
    value: { type: "enum", value },
    source: "github",
    origin: "github_normalized_snapshot",
    ...options
  });
}

function githubMilestone(): NormalizedWorkClaim {
  return claim({
    targetKind: "github_work_item",
    targetSeed: "github-a",
    lineageSeed: "github-a",
    field: "github_milestone_due_at",
    value: { type: "timestamp", value: "2026-08-04T09:00:00.000Z" },
    source: "github",
    origin: "github_normalized_snapshot"
  });
}

function managedState(
  value: "running" | "idle" | "completed" | "failed" | "interrupted",
  options: {
    lineageSeed?: string;
    freshness?: "current" | "stale";
    sourceUpdatedAt?: string;
  } = {}
): NormalizedWorkClaim {
  return claim({
    targetKind: "codex_execution",
    targetSeed: "execution-a",
    lineageSeed: options.lineageSeed ?? "run-a",
    field: "managed_codex_execution_state",
    value: { type: "enum", value },
    source: "codex_managed",
    origin: "managed_codex_event_stream",
    ...options
  });
}

function inventoryState(
  value: "running" | "idle" | "completed" | "failed" | "interrupted"
): NormalizedWorkClaim {
  return claim({
    targetKind: "codex_execution",
    targetSeed: "execution-a",
    lineageSeed: "inventory-a",
    field: "managed_codex_execution_state",
    value: { type: "enum", value },
    source: "codex_inventory",
    origin: "codex_inventory_snapshot",
    directness: "derived"
  });
}

function project(
  projectSeed: string,
  lineageSeed: string,
  sourceUpdatedAt = T1
): NormalizedWorkClaim {
  return claim({
    targetKind: "project_relation",
    targetSeed: "relation-a",
    lineageSeed,
    field: "project_alignment_identity",
    value: opaqueProjectValue(
      `project_${sha256Canonical(projectSeed).slice(0, 32)}`
    ),
    source: "explicit_user",
    origin: "explicit_user_mapping",
    sourceUpdatedAt
  });
}

function notionState(
  value: "open" | "in_progress" | "completed" | "cancelled"
): NormalizedWorkClaim {
  return claim({
    targetKind: "notion_task",
    targetSeed: "notion-a",
    lineageSeed: "notion-a",
    field: "notion_task_state",
    value: { type: "enum", value },
    source: "notion",
    origin: "notion_task_database"
  });
}

function notionPriority(
  value: "low" | "medium" | "high" | "urgent"
): NormalizedWorkClaim {
  return claim({
    targetKind: "notion_task",
    targetSeed: "notion-a",
    lineageSeed: "notion-a",
    field: "notion_internal_priority",
    value: { type: "enum", value },
    source: "notion",
    origin: "notion_task_database"
  });
}

function calendarState(
  value: "confirmed" | "tentative" | "cancelled"
): NormalizedWorkClaim {
  return claim({
    targetKind: "calendar_event",
    targetSeed: "calendar-a",
    lineageSeed: "calendar-a",
    field: "calendar_event_state",
    value: { type: "enum", value },
    source: "google_calendar",
    origin: "google_calendar_snapshot"
  });
}

function calendarTime(): NormalizedWorkClaim {
  return claim({
    targetKind: "calendar_event",
    targetSeed: "calendar-a",
    lineageSeed: "calendar-a",
    field: "calendar_event_time",
    value: { type: "timestamp", value: "2026-08-04T10:00:00.000Z" },
    source: "google_calendar",
    origin: "google_calendar_snapshot"
  });
}

function userDisposition(
  value: "active" | "completed" | "incorrect" | "not_now"
): NormalizedWorkClaim {
  return claim({
    targetKind: "user_work_item",
    targetSeed: "user-work-a",
    lineageSeed: "user-feedback-a",
    field: "user_disposition",
    value: { type: "enum", value },
    source: "explicit_user",
    origin: "explicit_user_feedback"
  });
}

function evaluationDependencies() {
  return {
    workRelationProjectionSha256: "1".repeat(64),
    artifactRelationProjectionSha256: "2".repeat(64),
    githubBatchSha256: "3".repeat(64),
    githubSourceSnapshotSha256: "4".repeat(64),
    managedSourceRevision: 1,
    managedGeneratedAt: T2,
    managedSemanticProjectionSha256: "6".repeat(64),
    contextRegistrySha256: "5".repeat(64)
  };
}

function countInvalidWinners(
  projection: ClaimAuthorityProjection | null,
  kind: "context" | "stale"
): number {
  if (!projection) return 0;
  const claims = new Map(
    projection.claims.map((claim) => [claim.claimId, claim])
  );
  return projection.fieldResolutions.filter((resolution) => {
    const winner = resolution.winningClaimId
      ? claims.get(resolution.winningClaimId)
      : null;
    return kind === "context"
      ? winner?.authority === "context_only"
      : winner?.freshness === "stale";
  }).length;
}

function countLabeledUnexpectedConflicts(
  executed: ExecutedCase[],
  dataset: ClaimAuthorityEvaluationDataset,
  label: string
): number {
  return sum(
    executed.map((item) => {
      const definition = dataset.cases.find(
        (candidate) => candidate.caseId === item.result.caseId
      );
      if (!definition?.labels.includes(label)) return 0;
      return Math.max(
        0,
        item.result.actual.conflictFields.length -
          item.result.expected.conflictFields.length
      );
    })
  );
}

function countLabeledOutput(
  executed: ExecutedCase[],
  dataset: ClaimAuthorityEvaluationDataset,
  label: string
): number {
  return sum(
    executed.map((item) => {
      const definition = dataset.cases.find(
        (candidate) => candidate.caseId === item.result.caseId
      );
      return definition?.labels.includes(label)
        ? item.result.actual.resolutionFields.length +
            item.result.actual.conflictFields.length
        : 0;
    })
  );
}

function countLabeledResolved(
  executed: ExecutedCase[],
  dataset: ClaimAuthorityEvaluationDataset,
  label: string
): number {
  return sum(
    executed.map((item) => {
      const definition = dataset.cases.find(
        (candidate) => candidate.caseId === item.result.caseId
      );
      return definition?.labels.includes(label)
        ? item.result.actual.resolutionStatuses.filter(
            (status) => status === "resolved"
          ).length
        : 0;
    })
  );
}

function countExpectedErrorAccepted(
  executed: ExecutedCase[],
  expectedError: NonNullable<ExpectedSummary["error"]>
): number {
  return executed.filter(
    (item) =>
      item.result.expected.error === expectedError &&
      item.result.actual.error === null
  ).length;
}

function attentionLeakage(
  projection: ClaimAuthorityProjection | null
): number {
  if (!projection) return 0;
  return [
    projection,
    ...projection.fieldResolutions,
    ...projection.conflicts
  ].filter(
    (item) =>
      item.attentionDisposition !== "not_connected" ||
      item.forbiddenAsAttentionCandidate !== true
  ).length;
}

function hasOriginalClaimLoss(item: ExecutedCase): boolean {
  if (!item.projection) return false;
  const expectedClaimIds = [...new Set(
    item.inputClaims.map((claim) => claim.claimId)
  )].sort();
  const projectedClaimIds = item.projection.claims
    .map((claim) => claim.claimId)
    .sort();
  const resolvedClaimIds = item.projection.fieldResolutions
    .flatMap((resolution) => resolution.claimIds)
    .sort();
  return (
    sha256Canonical(expectedClaimIds) !==
      sha256Canonical(projectedClaimIds) ||
    sha256Canonical(projectedClaimIds) !==
      sha256Canonical(resolvedClaimIds)
  );
}

function permutationChanged(item: ExecutedCase): boolean {
  if (!item.projection || item.inputClaims.length < 2) return false;
  const reversed = resolveClaimAuthority({
    asOf: AS_OF,
    dependencies: item.dependencies,
    sourceCoverage: [...item.sourceCoverage].reverse(),
    claims: [...item.inputClaims].reverse()
  });
  return reversed.projectionSha256 !== item.projection.projectionSha256;
}

function multisetMatches(expected: string[], actual: string[]): number {
  const counts = new Map<string, number>();
  for (const value of actual) counts.set(value, (counts.get(value) ?? 0) + 1);
  let matches = 0;
  for (const value of expected) {
    const available = counts.get(value) ?? 0;
    if (available <= 0) continue;
    matches += 1;
    counts.set(value, available - 1);
  }
  return matches;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
