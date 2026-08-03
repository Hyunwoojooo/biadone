import { randomBytes } from "node:crypto";

import { z } from "zod";

import configArtifact from "../../eval/synthetic/eligibilityGateConfig.v0.1.json";
import datasetArtifact from "../../eval/synthetic/eligibilityGateCases.v0.1.json";
import {
  sealManagedCodexArtifactRelationProjection,
  type ManagedCodexArtifactRelationProjection
} from "../artifacts";
import {
  canonicalClaimCoverage,
  createClaimLineageRef,
  createClaimTargetRef,
  createNormalizedWorkClaim,
  deriveGitHubClaims,
  resolveClaimAuthority,
  type ClaimAuthorityProjection,
  type NormalizedWorkClaim
} from "../claims";
import { runtimeSha256 } from "../crossSource/canonicalHash";
import {
  runtimeWorkSignalBatchSchema,
  type RuntimeWorkSignal,
  type RuntimeWorkSignalBatch
} from "../crossSource/schema";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION,
  ATTENTION_ELIGIBILITY_EVIDENCE_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_ID_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_POLICY_VERSION,
  ATTENTION_ELIGIBILITY_RESOLVER_VERSION,
  ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../crossSource/versions";
import {
  finalizeRuntimeWorkSignal,
  finalizeRuntimeWorkSignalBatch
} from "../crossSource/workSignalIntegrity";
import {
  resolveAttentionEligibilityShadow,
  type AttentionEligibilityShadowProjection
} from "../eligibility";
import {
  sealManagedCodexWorkRelationProjection,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import { sha256Canonical } from "./crossSourceIntegrity";

export const ATTENTION_ELIGIBILITY_EVALUATION_DATASET_CONTRACT =
  "attention-eligibility-gate-evaluation-dataset-v0.1" as const;
export const ATTENTION_ELIGIBILITY_EVALUATION_CASE_SCHEMA_VERSION =
  "attention-eligibility-gate-evaluation-case-v0.1" as const;
export const ATTENTION_ELIGIBILITY_EVALUATION_RUN_RECORD_CONTRACT =
  "attention-eligibility-gate-evaluation-run-v0.1" as const;

const AS_OF = "2026-08-02T03:00:00.000Z";
const OBSERVED_AT = "2026-08-02T02:50:00.000Z";
const EARLIER_AT = "2026-08-02T02:20:00.000Z";
const MANAGED_SEMANTIC_PROJECTION_SHA256 = "7".repeat(64);
const PRIVACY_SENTINELS = [
  "PRIVATE_ELIGIBILITY_REPOSITORY_SENTINEL",
  "PRIVATE_ELIGIBILITY_TITLE_SENTINEL",
  "PRIVATE_ELIGIBILITY_URL_SENTINEL",
  "PRIVATE_ELIGIBILITY_PROMPT_SENTINEL",
  "/Users/private/eligibility-sentinel"
] as const;
const PRIVATE_FIELD_PATTERNS = [
  /"(?:prompt|answer|command|filePath|repositoryFullName|destinationUrl|title|email)"\s*:/u,
  /https?:\/\//u,
  /\/(?:Users|home|private)\//u
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const scenarioSchema = z.enum([
  "direct_assigned_issue",
  "review_request_inspection",
  "context_only_authored",
  "destination_missing",
  "overview_only_direct",
  "stale_batch",
  "truncated_signal",
  "missing_state_claim",
  "missing_relationship_claim",
  "stale_state_claim",
  "partial_relationship_claim",
  "closed_state",
  "relationship_mismatch",
  "user_conflict_state",
  "user_conflict_relationship",
  "refresh_conflict_state",
  "resolved_state_conflict",
  "partial_batch_eligible",
  "unrelated_user_conflict",
  "two_safe_candidates",
  "safe_plus_user_conflict",
  "no_batch",
  "empty_batch",
  "exact_dependency_mismatch",
  "tampered_batch_integrity",
  "privacy_sentinel"
]);

export const attentionEligibilityEvaluationConfigSchema = z
  .object({
    version: z.literal("attention-eligibility-gate-config-v0.1"),
    purpose: z.literal(
      "targeted_synthetic_phase4a_shadow_evaluation_only"
    ),
    inputBoundary: z.literal("exact_phase3_evidence_graph"),
    candidateUniverse: z.literal("github_work_items_only"),
    routing: z
      .object({
        criticalUserConflict: z.literal("user_review"),
        staleOrRefreshableEvidence: z.literal("refresh_sources"),
        unrelatedConflictBlocksCandidate: z.literal(false),
        missingMaterialClaimFailsClosed: z.literal(true)
      })
      .strict(),
    attention: z
      .object({
        mode: z.literal("shadow"),
        selectionEffect: z.literal("none"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    integrity: z
      .object({
        exactEvidenceGraphRequired: z.literal(true),
        verifiedGitHubBatchRequired: z.literal(true),
        canonicalAssessmentOrderingRequired: z.literal(true),
        exactProjectionHashRequired: z.literal(true)
      })
      .strict(),
    privacy: z
      .object({
        containsProductionData: z.literal(false),
        publicRawTitles: z.literal(false),
        publicRepositoryNames: z.literal(false),
        publicRawUrls: z.literal(false),
        publicPromptAnswerCommandOrPath: z.literal(false)
      })
      .strict()
  })
  .strict();

const expectedAssessmentSchema = z
  .object({
    taskKind: z.enum([
      "assigned_issue",
      "review_requested_pull_request",
      "authored_pull_request"
    ]),
    status: z.enum(["eligible", "review_required", "ineligible"]),
    reviewRoute: z.enum(["none", "user_review", "refresh_sources"]),
    reasonCodes: z
      .array(
        z.enum([
          "ELIGIBLE_DIRECT_ASSIGNED_ISSUE",
          "ELIGIBLE_REVIEW_STATUS_INSPECTION",
          "ELIGIBLE_RELEVANT_CONFLICT_RESOLVED",
          "ELIGIBLE_WITH_LIMITED_SOURCE_COVERAGE",
          "REVIEW_RELEVANT_CRITICAL_CONFLICT_USER",
          "REVIEW_RELEVANT_CRITICAL_CONFLICT_REFRESH",
          "REVIEW_SOURCE_STALE",
          "REVIEW_MATERIAL_CLAIM_MISSING",
          "REVIEW_MATERIAL_CLAIM_UNRESOLVED",
          "REVIEW_MATERIAL_EVIDENCE_PARTIAL",
          "INELIGIBLE_CONTEXT_ONLY",
          "INELIGIBLE_UNSUPPORTED_TASK_KIND",
          "INELIGIBLE_NATIVE_DESTINATION_MISSING",
          "INELIGIBLE_NOT_CANDIDATE_INPUT",
          "INELIGIBLE_CURRENT_STATE_NOT_OPEN",
          "INELIGIBLE_USER_RELATIONSHIP_MISMATCH"
        ])
      )
      .min(1)
  })
  .strict();

const expectedSummarySchema = z
  .object({
    error: z
      .enum([
        "EXACT_DEPENDENCY_MISMATCH",
        "BATCH_INTEGRITY_REJECTED",
        "CASE_EXECUTION_FAILED"
      ])
      .nullable(),
    githubCandidateCoverage: z
      .enum(["complete", "partial", "stale", "unavailable"])
      .nullable(),
    unrelatedConflictCount: z.number().int().nonnegative().nullable(),
    assessments: z.array(expectedAssessmentSchema)
  })
  .strict();

export const attentionEligibilityEvaluationDatasetSchema = z
  .object({
    contract: z.literal(ATTENTION_ELIGIBILITY_EVALUATION_DATASET_CONTRACT),
    schemaVersion: z.literal(
      ATTENTION_ELIGIBILITY_EVALUATION_CASE_SCHEMA_VERSION
    ),
    datasetVersion: z.literal(
      "suggestion-attention-eligibility-dev-v0.1"
    ),
    datasetRevision: z.literal(2),
    datasetClass: z.literal("dev_candidate"),
    inputBoundary: z.literal("exact_phase3_evidence_graph"),
    dataOrigin: z.literal("synthetic"),
    containsProductionData: z.literal(false),
    createdAt: z.string().datetime(),
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
          "eval/synthetic/eligibilityGateConfig.v0.1.json"
        ),
        version: z.literal("attention-eligibility-gate-config-v0.1"),
        sha256: sha256Schema
      })
      .strict(),
    expectedInvariants: z
      .object({
        mode: z.literal("shadow"),
        attentionSelectionEffect: z.literal("none"),
        attentionDisposition: z.literal("shadow_only"),
        forbiddenAsAttentionCandidate: z.literal(true),
        containsRawPrivateValues: z.literal(false)
      })
      .strict(),
    expectedProjectionSha256ByCase: z.record(
      z.string().regex(/^ELIG-DEV-[0-9]{3}$/),
      sha256Schema.nullable()
    ),
    cases: z
      .array(
        z
          .object({
            caseId: z.string().regex(/^ELIG-DEV-[0-9]{3}$/),
            title: z.string().min(1).max(180),
            scenario: scenarioSchema,
            expected: expectedSummarySchema,
            labels: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1)
          })
          .strict()
      )
      .length(26)
  })
  .strict()
  .superRefine((dataset, context) => {
    if (
      new Set(dataset.cases.map((item) => item.caseId)).size !==
        dataset.cases.length ||
      new Set(dataset.cases.map((item) => item.scenario)).size !==
        dataset.cases.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases"],
        message: "Eligibility evaluation cases and scenarios must be unique."
      });
    }
    const caseIds = new Set(dataset.cases.map((item) => item.caseId));
    const expectedHashIds = Object.keys(
      dataset.expectedProjectionSha256ByCase
    );
    if (
      expectedHashIds.length !== dataset.cases.length ||
      expectedHashIds.some((caseId) => !caseIds.has(caseId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedProjectionSha256ByCase"],
        message: "Every eligibility case requires one exact projection expectation."
      });
    }
    for (const evaluationCase of dataset.cases) {
      const expectedHash =
        dataset.expectedProjectionSha256ByCase[evaluationCase.caseId];
      if ((evaluationCase.expected.error !== null) !== (expectedHash === null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expectedProjectionSha256ByCase", evaluationCase.caseId],
          message: "Only expected fail-closed cases may use a null projection hash."
        });
      }
    }
  });

export type AttentionEligibilityEvaluationConfig = z.infer<
  typeof attentionEligibilityEvaluationConfigSchema
>;
export type AttentionEligibilityEvaluationDataset = z.infer<
  typeof attentionEligibilityEvaluationDatasetSchema
>;
export type AttentionEligibilityEvaluationCase =
  AttentionEligibilityEvaluationDataset["cases"][number];
type ExpectedSummary = z.infer<typeof expectedSummarySchema>;
type ExpectedAssessment = z.infer<typeof expectedAssessmentSchema>;

export type AttentionEligibilityCaseResult = {
  caseId: string;
  scenario: AttentionEligibilityEvaluationCase["scenario"];
  labels: string[];
  passed: boolean;
  expectedSha256: string;
  actualSha256: string;
  expectedProjectionSha256: string | null;
  projectionSha256: string | null;
  expected: ExpectedSummary;
  actual: ExpectedSummary;
};

export type AttentionEligibilityEvaluationMetrics = {
  caseCount: number;
  exactCasePassCount: number;
  exactCasePassRate: number;
  expectedAssessmentCount: number;
  observedAssessmentCount: number;
  assessmentPrecision: number;
  assessmentRecall: number;
  projectionHashMismatchCount: number;
  unsafeEligibleCount: number;
  wrongReviewRouteCount: number;
  userConflictAutoEligibilityCount: number;
  refreshConflictUserMisrouteCount: number;
  unrelatedConflictBlockingCount: number;
  absenceCandidateLeakageCount: number;
  dependencyFailOpenCount: number;
  batchIntegrityFailOpenCount: number;
  attentionSelectionLeakageCount: number;
  attentionCandidateLeakageCount: number;
  privacySentinelLeakageCount: number;
  rawPrivateFieldLeakageCount: number;
  canonicalOrderingFailureCount: number;
  determinismFailureCount: number;
  configIntegrityFailureCount: number;
};

export type AttentionEligibilityEvaluationRecord = {
  contract: typeof ATTENTION_ELIGIBILITY_EVALUATION_RUN_RECORD_CONTRACT;
  runId: string;
  comparisonRunId: null;
  comparisonReason: "INITIAL_TARGETED_PHASE4A_DEV_CANDIDATE_BASELINE";
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  dataset: {
    version: "suggestion-attention-eligibility-dev-v0.1";
    revision: 2;
    class: "dev_candidate";
    lifecycle: "mutable";
    inputBoundary: "exact_phase3_evidence_graph";
    canonicalSha256: string;
    materializedInputSha256: string;
    caseCount: number;
  };
  versions: {
    datasetSchemaVersion: typeof ATTENTION_ELIGIBILITY_EVALUATION_CASE_SCHEMA_VERSION;
    projectionContract: typeof ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT;
    candidateSeedSchemaVersion: typeof ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION;
    policyVersion: typeof ATTENTION_ELIGIBILITY_POLICY_VERSION;
    evidencePolicyVersion: typeof ATTENTION_ELIGIBILITY_EVIDENCE_POLICY_VERSION;
    resolverVersion: typeof ATTENTION_ELIGIBILITY_RESOLVER_VERSION;
    idPolicyVersion: typeof ATTENTION_ELIGIBILITY_ID_POLICY_VERSION;
  };
  resolverConfig: AttentionEligibilityEvaluationDataset["resolverConfig"];
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
  metrics: AttentionEligibilityEvaluationMetrics;
  cases: AttentionEligibilityCaseResult[];
  deterministicOutputSha256: string;
  errors: Array<{
    caseId: string;
    code: "ATTENTION_ELIGIBILITY_EXACT_MISMATCH";
  }>;
  attentionDisposition: "shadow_only";
  privacyClass: "synthetic_sanitized_metadata";
};

type EvaluationGraph = {
  asOf: string;
  githubBatch: RuntimeWorkSignalBatch | null;
  workRelations: ManagedCodexWorkRelationProjection;
  artifacts: ManagedCodexArtifactRelationProjection;
  claims: ClaimAuthorityProjection;
};

type ExecutedCase = {
  result: AttentionEligibilityCaseResult;
  projection: AttentionEligibilityShadowProjection | null;
  materializedInputSha256: string;
  repeatProjectionSha256: string | null;
};

export function loadAttentionEligibilityEvaluationDataset(
  input: unknown,
  configInput: unknown = configArtifact
): AttentionEligibilityEvaluationDataset {
  const config = attentionEligibilityEvaluationConfigSchema.parse(configInput);
  const dataset = attentionEligibilityEvaluationDatasetSchema.parse(input);
  const configSha256 = sha256Canonical(config);
  if (dataset.resolverConfig.sha256 !== configSha256) {
    throw new TypeError("Eligibility resolver config integrity check failed.");
  }
  return dataset;
}

export const attentionEligibilityEvaluationConfig =
  attentionEligibilityEvaluationConfigSchema.parse(configArtifact);
export const ATTENTION_ELIGIBILITY_CONFIG_SHA256 = sha256Canonical(
  attentionEligibilityEvaluationConfig
);
export const attentionEligibilityEvaluationDataset =
  loadAttentionEligibilityEvaluationDataset(datasetArtifact);
export const ATTENTION_ELIGIBILITY_DATASET_SHA256 = sha256Canonical(
  attentionEligibilityEvaluationDataset
);

export function runAttentionEligibilityEvaluation(input?: {
  startedAt?: Date;
  completedAt?: Date;
  code?: AttentionEligibilityEvaluationRecord["code"];
  dataset?: AttentionEligibilityEvaluationDataset;
}): AttentionEligibilityEvaluationRecord {
  const startedAt = input?.startedAt ?? new Date();
  const dataset = input?.dataset ?? attentionEligibilityEvaluationDataset;
  const configIntegrityFailureCount =
    dataset.resolverConfig.sha256 === ATTENTION_ELIGIBILITY_CONFIG_SHA256
      ? 0
      : 1;
  const executed = dataset.cases.map((evaluationCase) =>
    executeCase(
      evaluationCase,
      dataset.expectedProjectionSha256ByCase[evaluationCase.caseId] ?? null
    )
  );
  const cases = executed.map((item) => item.result);
  const metrics = computeMetrics(
    executed,
    dataset,
    configIntegrityFailureCount
  );
  const errors = cases
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: "ATTENTION_ELIGIBILITY_EXACT_MISMATCH" as const
    }));
  const materializedInputSha256 = sha256Canonical(
    executed.map((item) => ({
      caseId: item.result.caseId,
      inputSha256: item.materializedInputSha256
    }))
  );
  const deterministicOutputSha256 = sha256Canonical({
    datasetSha256: sha256Canonical(dataset),
    materializedInputSha256,
    versions: eligibilityVersions(),
    metrics,
    cases
  });
  const completedAt = input?.completedAt ?? new Date();
  return {
    contract: ATTENTION_ELIGIBILITY_EVALUATION_RUN_RECORD_CONTRACT,
    runId: `attention_eligibility_run_${randomBytes(16).toString("hex")}`,
    comparisonRunId: null,
    comparisonReason:
      "INITIAL_TARGETED_PHASE4A_DEV_CANDIDATE_BASELINE",
    status:
      errors.length === 0 && attentionEligibilityReleaseGatesPass(metrics)
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
    versions: eligibilityVersions(),
    resolverConfig: dataset.resolverConfig,
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
    attentionDisposition: "shadow_only",
    privacyClass: "synthetic_sanitized_metadata"
  };
}

export function attentionEligibilityReleaseGatesPass(
  metrics: AttentionEligibilityEvaluationMetrics
): boolean {
  const zeroGuardrails = [
    metrics.projectionHashMismatchCount,
    metrics.unsafeEligibleCount,
    metrics.wrongReviewRouteCount,
    metrics.userConflictAutoEligibilityCount,
    metrics.refreshConflictUserMisrouteCount,
    metrics.unrelatedConflictBlockingCount,
    metrics.absenceCandidateLeakageCount,
    metrics.dependencyFailOpenCount,
    metrics.batchIntegrityFailOpenCount,
    metrics.attentionSelectionLeakageCount,
    metrics.attentionCandidateLeakageCount,
    metrics.privacySentinelLeakageCount,
    metrics.rawPrivateFieldLeakageCount,
    metrics.canonicalOrderingFailureCount,
    metrics.determinismFailureCount,
    metrics.configIntegrityFailureCount
  ];
  return (
    metrics.caseCount === 26 &&
    metrics.exactCasePassCount === metrics.caseCount &&
    metrics.assessmentPrecision === 1 &&
    metrics.assessmentRecall === 1 &&
    zeroGuardrails.every((value) => value === 0)
  );
}

function executeCase(
  evaluationCase: AttentionEligibilityEvaluationCase,
  expectedProjectionSha256: string | null
): ExecutedCase {
  let projection: AttentionEligibilityShadowProjection | null = null;
  let repeatProjectionSha256: string | null = null;
  let error: ExpectedSummary["error"] = null;
  let materializedInputSha256 = sha256Canonical({
    caseId: evaluationCase.caseId,
    scenario: evaluationCase.scenario
  });
  try {
    const graph = buildEvaluationGraph(evaluationCase.scenario);
    materializedInputSha256 = sha256Canonical({
      caseId: evaluationCase.caseId,
      scenario: evaluationCase.scenario,
      asOf: graph.asOf,
      githubBatchSha256: graph.githubBatch?.batchSha256 ?? null,
      workRelationProjectionSha256: graph.workRelations.projectionSha256,
      artifactRelationProjectionSha256: graph.artifacts.projectionSha256,
      claimAuthorityProjectionSha256: graph.claims.projectionSha256
    });
    projection = resolveAttentionEligibilityShadow({
      asOf: graph.asOf,
      githubBatch: graph.githubBatch,
      workRelationProjection: graph.workRelations,
      artifactRelationProjection: graph.artifacts,
      claimAuthorityProjection: graph.claims
    });
    const repeatedGraph = buildEvaluationGraph(evaluationCase.scenario);
    repeatProjectionSha256 = resolveAttentionEligibilityShadow({
      asOf: repeatedGraph.asOf,
      githubBatch: repeatedGraph.githubBatch,
      workRelationProjection: repeatedGraph.workRelations,
      artifactRelationProjection: repeatedGraph.artifacts,
      claimAuthorityProjection: repeatedGraph.claims
    }).projectionSha256;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    error = message.includes("exact evidence graph")
      ? "EXACT_DEPENDENCY_MISMATCH"
      : message.includes("integrity-verified GitHub batch")
        ? "BATCH_INTEGRITY_REJECTED"
        : "CASE_EXECUTION_FAILED";
  }

  const actual = summarizeProjection(projection, error);
  const expected = canonicalSummary(evaluationCase.expected);
  const expectedSha256 = sha256Canonical(expected);
  const actualSha256 = sha256Canonical(actual);
  return {
    result: {
      caseId: evaluationCase.caseId,
      scenario: evaluationCase.scenario,
      labels: [...evaluationCase.labels].sort(),
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
    materializedInputSha256,
    repeatProjectionSha256
  };
}

function summarizeProjection(
  projection: AttentionEligibilityShadowProjection | null,
  error: ExpectedSummary["error"]
): ExpectedSummary {
  if (!projection) {
    return canonicalSummary({
      error,
      githubCandidateCoverage: null,
      unrelatedConflictCount: null,
      assessments: []
    });
  }
  return canonicalSummary({
    error,
    githubCandidateCoverage:
      projection.coverage.githubCandidateCoverage,
    unrelatedConflictCount:
      projection.coverage.unrelatedUnresolvedCriticalConflictCount,
    assessments: projection.assessments.map((assessment) => ({
      taskKind: assessment.taskKind,
      status: assessment.status,
      reviewRoute: assessment.reviewRoute,
      reasonCodes: [...assessment.reasonCodes]
    }))
  });
}

function canonicalSummary(input: ExpectedSummary): ExpectedSummary {
  return {
    ...input,
    assessments: input.assessments
      .map((assessment) => ({
        ...assessment,
        reasonCodes: [...assessment.reasonCodes].sort()
      }))
      .sort((left, right) =>
        assessmentKey(left).localeCompare(assessmentKey(right))
      )
  };
}

function assessmentKey(assessment: ExpectedAssessment): string {
  return [
    assessment.taskKind,
    assessment.status,
    assessment.reviewRoute,
    ...assessment.reasonCodes
  ].join("\u0000");
}

function computeMetrics(
  executed: ExecutedCase[],
  dataset: AttentionEligibilityEvaluationDataset,
  configIntegrityFailureCount: number
): AttentionEligibilityEvaluationMetrics {
  const expectedAssessmentKeys = executed.flatMap((item) =>
    item.result.expected.assessments.map(
      (assessment) => `${item.result.caseId}:${assessmentKey(assessment)}`
    )
  );
  const observedAssessmentKeys = executed.flatMap((item) =>
    item.result.actual.assessments.map(
      (assessment) => `${item.result.caseId}:${assessmentKey(assessment)}`
    )
  );
  const truePositives = multisetMatches(
    expectedAssessmentKeys,
    observedAssessmentKeys
  );
  const hardNegativeCaseIds = new Set(
    dataset.cases
      .filter((item) => item.labels.includes("hard_negative"))
      .map((item) => item.caseId)
  );
  return {
    caseCount: executed.length,
    exactCasePassCount: executed.filter((item) => item.result.passed).length,
    exactCasePassRate: ratio(
      executed.filter((item) => item.result.passed).length,
      executed.length
    ),
    expectedAssessmentCount: expectedAssessmentKeys.length,
    observedAssessmentCount: observedAssessmentKeys.length,
    assessmentPrecision: ratio(truePositives, observedAssessmentKeys.length),
    assessmentRecall: ratio(truePositives, expectedAssessmentKeys.length),
    projectionHashMismatchCount: executed.filter(
      (item) =>
        item.result.expectedProjectionSha256 !==
        item.result.projectionSha256
    ).length,
    unsafeEligibleCount: executed
      .filter((item) => hardNegativeCaseIds.has(item.result.caseId))
      .flatMap((item) => item.result.actual.assessments)
      .filter((assessment) => assessment.status === "eligible").length,
    wrongReviewRouteCount: executed.reduce(
      (count, item) =>
        count +
        routeMultisetDifference(
          item.result.expected.assessments,
          item.result.actual.assessments
        ),
      0
    ),
    userConflictAutoEligibilityCount: countCases(
      executed,
      "user_review_route",
      (item) =>
        item.result.actual.assessments.some(
          (assessment) => assessment.status === "eligible"
        ) &&
        !item.result.expected.assessments.some(
          (assessment) => assessment.status === "eligible"
        )
    ),
    refreshConflictUserMisrouteCount: countCases(
      executed,
      "refresh_route",
      (item) =>
        item.result.actual.assessments.some(
          (assessment) => assessment.reviewRoute === "user_review"
        )
    ),
    unrelatedConflictBlockingCount: countCases(
      executed,
      "unrelated_conflict_guard",
      (item) =>
        !item.result.actual.assessments.some(
          (assessment) => assessment.status === "eligible"
        )
    ),
    absenceCandidateLeakageCount: countCases(
      executed,
      "absence_guard",
      (item) => item.result.actual.assessments.length > 0
    ),
    dependencyFailOpenCount: countCases(
      executed,
      "dependency_guard",
      (item) => item.result.actual.error !== "EXACT_DEPENDENCY_MISMATCH"
    ),
    batchIntegrityFailOpenCount: countCases(
      executed,
      "batch_integrity_guard",
      (item) => item.result.actual.error !== "BATCH_INTEGRITY_REJECTED"
    ),
    attentionSelectionLeakageCount: executed.filter(
      (item) =>
        item.projection !== null &&
        item.projection.attentionSelectionEffect !== "none"
    ).length,
    attentionCandidateLeakageCount: executed.reduce(
      (count, item) =>
        count +
        (item.projection?.assessments.filter(
          (assessment) => !assessment.forbiddenAsAttentionCandidate
        ).length ?? 0),
      0
    ),
    privacySentinelLeakageCount: executed.filter((item) => {
      const serialized = JSON.stringify(item.projection);
      return PRIVACY_SENTINELS.some((sentinel) =>
        serialized.includes(sentinel)
      );
    }).length,
    rawPrivateFieldLeakageCount: executed.filter((item) => {
      const serialized = JSON.stringify(item.projection);
      return PRIVATE_FIELD_PATTERNS.some((pattern) => pattern.test(serialized));
    }).length,
    canonicalOrderingFailureCount: executed.filter((item) => {
      const assessmentIds =
        item.projection?.assessments.map(
          (assessment) => assessment.assessmentId
        ) ?? [];
      return assessmentIds.join("|") !== [...assessmentIds].sort().join("|");
    }).length,
    determinismFailureCount: executed.filter(
      (item) =>
        item.projection !== null &&
        item.projection.projectionSha256 !== item.repeatProjectionSha256
    ).length,
    configIntegrityFailureCount
  };
}

function buildEvaluationGraph(
  scenario: AttentionEligibilityEvaluationCase["scenario"]
): EvaluationGraph {
  const githubBatch = buildScenarioBatch(scenario);
  const workRelations = emptyWorkRelations(githubBatch);
  const artifacts = emptyArtifacts(workRelations);
  let normalizedClaims = deriveGitHubClaims({
    batch: githubBatch,
    workRelations
  });
  normalizedClaims = mutateClaimsForScenario(
    scenario,
    normalizedClaims,
    githubBatch
  );
  const claims = resolveClaimAuthority({
    asOf: AS_OF,
    dependencies: {
      workRelationProjectionSha256: workRelations.projectionSha256,
      artifactRelationProjectionSha256: artifacts.projectionSha256,
      githubBatchSha256: githubBatch?.batchSha256 ?? null,
      githubSourceSnapshotSha256:
        githubBatch?.sourceSnapshotSha256 ?? null,
      managedSourceRevision: workRelations.managedSourceRevision,
      managedGeneratedAt: workRelations.managedGeneratedAt,
      managedSemanticProjectionSha256:
        MANAGED_SEMANTIC_PROJECTION_SHA256,
      contextRegistrySha256: workRelations.contextRegistrySha256
    },
    sourceCoverage: canonicalClaimCoverage({
      github: claimCoverageForBatch(githubBatch)
    }),
    claims: normalizedClaims
  });

  if (scenario === "exact_dependency_mismatch") {
    return {
      asOf: AS_OF,
      githubBatch,
      workRelations,
      artifacts: emptyArtifacts(workRelations, "9".repeat(64)),
      claims
    };
  }
  if (scenario === "tampered_batch_integrity" && githubBatch !== null) {
    return {
      asOf: AS_OF,
      githubBatch: runtimeWorkSignalBatchSchema.parse({
        ...githubBatch,
        batchSha256: "f".repeat(64)
      }),
      workRelations,
      artifacts,
      claims
    };
  }
  return {
    asOf: AS_OF,
    githubBatch,
    workRelations,
    artifacts,
    claims
  };
}

type SignalSpec = {
  id: number;
  taskKind:
    | "assigned_issue"
    | "review_requested_pull_request"
    | "authored_pull_request";
  destination: "present" | "missing";
  completeness: "complete" | "truncated";
  attentionCapability: "candidate_input" | "overview_only";
  privacySentinel?: boolean;
};

function buildScenarioBatch(
  scenario: AttentionEligibilityEvaluationCase["scenario"]
): RuntimeWorkSignalBatch | null {
  if (scenario === "no_batch") return null;
  let specs: SignalSpec[] = [assignedSpec(201)];
  let freshness: "fresh" | "stale" = "fresh";
  let batchCompleteness: "complete" | "partial" = "complete";
  if (scenario === "empty_batch") specs = [];
  if (scenario === "review_request_inspection") {
    specs = [reviewSpec(202)];
  }
  if (scenario === "context_only_authored") {
    specs = [authoredSpec(203)];
  }
  if (scenario === "destination_missing") {
    specs = [{ ...assignedSpec(204), destination: "missing" }];
  }
  if (scenario === "overview_only_direct") {
    specs = [
      { ...assignedSpec(205), attentionCapability: "overview_only" }
    ];
  }
  if (scenario === "stale_batch") freshness = "stale";
  if (scenario === "truncated_signal") {
    specs = [{ ...assignedSpec(207), completeness: "truncated" }];
  }
  if (scenario === "partial_batch_eligible") {
    batchCompleteness = "partial";
  }
  if (scenario === "two_safe_candidates") {
    specs = [assignedSpec(220), reviewSpec(221)];
  }
  if (scenario === "safe_plus_user_conflict") {
    specs = [assignedSpec(222), assignedSpec(223)];
  }
  if (scenario === "tampered_batch_integrity") {
    specs = [assignedSpec(224)];
  }
  if (scenario === "privacy_sentinel") {
    specs = [{ ...assignedSpec(226), privacySentinel: true }];
  }
  return githubBatch({
    specs,
    freshness,
    batchCompleteness
  });
}

function assignedSpec(id: number): SignalSpec {
  return {
    id,
    taskKind: "assigned_issue",
    destination: "present",
    completeness: "complete",
    attentionCapability: "candidate_input"
  };
}

function reviewSpec(id: number): SignalSpec {
  return {
    ...assignedSpec(id),
    taskKind: "review_requested_pull_request"
  };
}

function authoredSpec(id: number): SignalSpec {
  return {
    ...assignedSpec(id),
    taskKind: "authored_pull_request",
    attentionCapability: "overview_only"
  };
}

function githubBatch(input: {
  specs: SignalSpec[];
  freshness: "fresh" | "stale";
  batchCompleteness: "complete" | "partial";
}): RuntimeWorkSignalBatch {
  const snapshotSha256 = runtimeSha256({
    domain: "eligibility-evaluation-github-snapshot-v0.1",
    specs: input.specs,
    freshness: input.freshness,
    completeness: input.batchCompleteness
  });
  const signals = input.specs.map((spec) =>
    githubWorkItemSignal(spec, snapshotSha256)
  );
  const truncated = input.batchCompleteness === "partial";
  return finalizeRuntimeWorkSignalBatch({
    contract: RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
    source: "github",
    sourceSchemaVersion: "github-snapshot-v2",
    collectorVersion: "eligibility-evaluation-collector-v0.1",
    normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
    workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizationInputSha256: runtimeSha256({
      domain: "eligibility-evaluation-normalization-input-v0.1",
      snapshotSha256
    }),
    assessment: {
      contract: RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
      source: "github",
      asOf: AS_OF,
      fetchedAt: OBSERVED_AT,
      freshnessPolicyVersion: "eligibility-evaluation-freshness-v0.1",
      freshness: input.freshness,
      completeness: input.batchCompleteness,
      truncated,
      candidateSetComplete: !truncated,
      usableForOverview: true,
      usableForCurrentCandidates: input.freshness === "fresh",
      reasonCodes: [
        input.freshness === "fresh" ? "SNAPSHOT_FRESH" : "SNAPSHOT_STALE",
        ...(truncated ? (["SNAPSHOT_TRUNCATED"] as const) : [])
      ]
    },
    skippedRecordCount: 0,
    issues: [],
    signals
  });
}

function githubWorkItemSignal(
  spec: SignalSpec,
  snapshotSha256: string
): Extract<RuntimeWorkSignal, { kind: "work_item_observation" }> {
  const subjectId = `github:object:${spec.id}`;
  const objectId = String(spec.id);
  const isIssue = spec.taskKind === "assigned_issue";
  const repositoryFullName = spec.privacySentinel
    ? "PRIVATE_ELIGIBILITY_REPOSITORY_SENTINEL/project"
    : `synthetic-owner/project-${spec.id}`;
  const title = spec.privacySentinel
    ? "PRIVATE_ELIGIBILITY_TITLE_SENTINEL PRIVATE_ELIGIBILITY_PROMPT_SENTINEL /Users/private/eligibility-sentinel"
    : `Synthetic work item ${spec.id}`;
  const destinationUrl =
    spec.destination === "missing"
      ? null
      : spec.privacySentinel
        ? "https://example.invalid/PRIVATE_ELIGIBILITY_URL_SENTINEL"
        : `https://example.invalid/work/${spec.id}`;
  const relationship =
    spec.taskKind === "assigned_issue"
      ? ("assigned_to_user" as const)
      : spec.taskKind === "review_requested_pull_request"
        ? ("review_requested_from_user" as const)
        : ("authored_by_user" as const);
  const queryKind =
    spec.taskKind === "assigned_issue"
      ? ("assigned_open_issue" as const)
      : spec.taskKind === "review_requested_pull_request"
        ? ("review_requested_open_pr" as const)
        : ("authored_open_pr" as const);
  const facts = {
    objectType: isIssue ? ("issue" as const) : ("pull_request" as const),
    taskKind: spec.taskKind,
    state: "open" as const,
    relationship,
    semanticRole:
      spec.taskKind === "authored_pull_request"
        ? ("context_only" as const)
        : ("direct_work_item" as const),
    eligibilityLimit:
      spec.taskKind === "assigned_issue"
        ? ("none" as const)
        : spec.taskKind === "review_requested_pull_request"
          ? ("draft_state_unknown" as const)
          : ("not_actionable_by_source_kind" as const),
    draftState:
      spec.taskKind === "assigned_issue"
        ? ("not_applicable" as const)
        : ("unknown" as const),
    repositoryFullName,
    number: spec.id,
    title,
    destinationUrl
  };
  const signal = finalizeRuntimeWorkSignal({
    contract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
    source: "github",
    subjectId,
    subjectType: "work_item",
    sourceScopeId: `repository:${1000 + spec.id}`,
    projectId: null,
    kind: "work_item_observation",
    facts,
    observedAt: OBSERVED_AT,
    sourceUpdatedAt: OBSERVED_AT,
    validUntil: null,
    directness: "explicit",
    completeness: spec.completeness,
    attentionCapability: spec.attentionCapability,
    evidence: [
      {
        type: "github_query_membership",
        source: "github",
        queryKind,
        objectId,
        snapshotSha256,
        subjectId,
        observedAt: OBSERVED_AT,
        sourceUpdatedAt: OBSERVED_AT
      },
      {
        type: "github_object_field",
        source: "github",
        objectId,
        field: "state",
        valueSha256: runtimeSha256({ field: "state", value: "open" }),
        snapshotSha256,
        subjectId,
        observedAt: OBSERVED_AT,
        sourceUpdatedAt: OBSERVED_AT
      }
    ]
  });
  if (signal.kind !== "work_item_observation") {
    throw new TypeError("Synthetic GitHub signal kind is incoherent.");
  }
  return signal;
}

function mutateClaimsForScenario(
  scenario: AttentionEligibilityEvaluationCase["scenario"],
  inputClaims: NormalizedWorkClaim[],
  batch: RuntimeWorkSignalBatch | null
): NormalizedWorkClaim[] {
  let claims = [...inputClaims];
  const firstSubject = batch?.signals.find(
    (signal) => signal.kind === "work_item_observation"
  )?.subjectId;
  const secondSubject = batch?.signals.filter(
    (signal) => signal.kind === "work_item_observation"
  )[1]?.subjectId;
  if (!firstSubject) return claims;

  if (scenario === "missing_state_claim") {
    claims = withoutField(claims, firstSubject, "github_work_item_state");
  }
  if (scenario === "missing_relationship_claim") {
    claims = withoutField(
      claims,
      firstSubject,
      "github_user_relationship"
    );
  }
  if (scenario === "stale_state_claim") {
    claims = replaceClaim(claims, firstSubject, "github_work_item_state", {
      freshness: "stale"
    });
  }
  if (scenario === "partial_relationship_claim") {
    claims = replaceClaim(
      claims,
      firstSubject,
      "github_user_relationship",
      { completeness: "partial" }
    );
  }
  if (scenario === "closed_state") {
    claims = replaceClaim(claims, firstSubject, "github_work_item_state", {
      value: { type: "enum", value: "completed" }
    });
  }
  if (scenario === "relationship_mismatch") {
    claims = replaceClaim(
      claims,
      firstSubject,
      "github_user_relationship",
      { value: { type: "enum", value: "authored_by_user" } }
    );
  }
  if (scenario === "user_conflict_state") {
    claims = addConflictingClaim(
      claims,
      firstSubject,
      "github_work_item_state",
      { type: "enum", value: "completed" },
      "current"
    );
  }
  if (scenario === "user_conflict_relationship") {
    claims = addConflictingClaim(
      claims,
      firstSubject,
      "github_user_relationship",
      { type: "enum", value: "authored_by_user" },
      "current"
    );
  }
  if (scenario === "refresh_conflict_state") {
    claims = replaceClaim(claims, firstSubject, "github_work_item_state", {
      freshness: "stale"
    });
    claims = addConflictingClaim(
      claims,
      firstSubject,
      "github_work_item_state",
      { type: "enum", value: "completed" },
      "stale"
    );
  }
  if (scenario === "resolved_state_conflict") {
    claims = addConflictingClaim(
      claims,
      firstSubject,
      "github_work_item_state",
      { type: "enum", value: "completed" },
      "stale"
    );
  }
  if (scenario === "unrelated_user_conflict") {
    claims.push(...unrelatedConflictClaims(claims));
  }
  if (scenario === "safe_plus_user_conflict" && secondSubject) {
    claims = addConflictingClaim(
      claims,
      secondSubject,
      "github_work_item_state",
      { type: "enum", value: "completed" },
      "current"
    );
  }
  return claims;
}

function withoutField(
  claims: NormalizedWorkClaim[],
  subjectId: string,
  field: NormalizedWorkClaim["field"]
): NormalizedWorkClaim[] {
  const targetRef = targetRefForSubject(subjectId);
  return claims.filter(
    (claim) => !(claim.target.ref === targetRef && claim.field === field)
  );
}

function replaceClaim(
  claims: NormalizedWorkClaim[],
  subjectId: string,
  field: NormalizedWorkClaim["field"],
  override: Partial<
    Pick<NormalizedWorkClaim, "freshness" | "completeness" | "value">
  >
): NormalizedWorkClaim[] {
  const targetRef = targetRefForSubject(subjectId);
  return claims.map((claim) =>
    claim.target.ref === targetRef && claim.field === field
      ? cloneClaim(claim, override)
      : claim
  );
}

function addConflictingClaim(
  claims: NormalizedWorkClaim[],
  subjectId: string,
  field: NormalizedWorkClaim["field"],
  value: NormalizedWorkClaim["value"],
  freshness: "current" | "stale"
): NormalizedWorkClaim[] {
  const targetRef = targetRefForSubject(subjectId);
  const original = claims.find(
    (claim) => claim.target.ref === targetRef && claim.field === field
  );
  if (!original) throw new TypeError("Synthetic conflict base claim missing.");
  return [
    ...claims,
    cloneClaim(original, {
      value,
      freshness,
      lineageRef: createClaimLineageRef({
        source: "github",
        sourceScopeId: `synthetic-conflict:${subjectId}`,
        subjectId
      }),
      sourceUpdatedAt: freshness === "stale" ? EARLIER_AT : OBSERVED_AT
    })
  ];
}

function unrelatedConflictClaims(
  claims: NormalizedWorkClaim[]
): NormalizedWorkClaim[] {
  const original = claims.find(
    (claim) => claim.field === "github_work_item_state"
  );
  if (!original) throw new TypeError("Synthetic unrelated claim base missing.");
  const target = {
    kind: "github_work_item" as const,
    ref: createClaimTargetRef({
      kind: "github_work_item",
      identity: {
        sourceScopeId: "repository:unrelated",
        subjectId: "github:object:999999"
      }
    })
  };
  return [
    cloneClaim(original, {
      target,
      value: { type: "enum", value: "open" },
      lineageRef: createClaimLineageRef({
        source: "github",
        sourceScopeId: "repository:unrelated-a",
        subjectId: "github:object:999999"
      })
    }),
    cloneClaim(original, {
      target,
      value: { type: "enum", value: "completed" },
      lineageRef: createClaimLineageRef({
        source: "github",
        sourceScopeId: "repository:unrelated-b",
        subjectId: "github:object:999999"
      })
    })
  ];
}

function cloneClaim(
  claim: NormalizedWorkClaim,
  override: Partial<{
    target: NormalizedWorkClaim["target"];
    lineageRef: string;
    value: NormalizedWorkClaim["value"];
    freshness: NormalizedWorkClaim["freshness"];
    completeness: NormalizedWorkClaim["completeness"];
    sourceUpdatedAt: string | null;
  }>
): NormalizedWorkClaim {
  return createNormalizedWorkClaim({
    target: override.target ?? claim.target,
    lineageRef: override.lineageRef ?? claim.lineageRef,
    field: claim.field,
    value: override.value ?? claim.value,
    source: claim.source,
    origin: claim.origin,
    freshness: override.freshness ?? claim.freshness,
    completeness: override.completeness ?? claim.completeness,
    directness: claim.directness,
    observedAt: claim.observedAt,
    sourceUpdatedAt:
      override.sourceUpdatedAt === undefined
        ? claim.sourceUpdatedAt
        : override.sourceUpdatedAt,
    evidenceRefs: claim.evidenceRefs,
    relationRefs: claim.relationRefs
  });
}

function targetRefForSubject(subjectId: string): string {
  const nativeId = Number(subjectId.slice("github:object:".length));
  return createClaimTargetRef({
    kind: "github_work_item",
    identity: {
      sourceScopeId: `repository:${1000 + nativeId}`,
      subjectId
    }
  });
}

function emptyWorkRelations(
  batch: RuntimeWorkSignalBatch | null
): ManagedCodexWorkRelationProjection {
  return sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf: AS_OF,
    managedSourceRevision: 1,
    managedGeneratedAt: OBSERVED_AT,
    bindingStoreRevision: 0,
    bindingStoreSha256: "1".repeat(64),
    contextRegistrySha256: null,
    githubBatchSha256: batch?.batchSha256 ?? null,
    githubSourceSnapshotSha256: batch?.sourceSnapshotSha256 ?? null,
    totalManagedRunCount: 0,
    omittedManagedRunCount: 0,
    relations: [],
    runResolutions: [],
    inputSha256: "2".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function emptyArtifacts(
  workRelations: ManagedCodexWorkRelationProjection,
  workRelationProjectionSha256 = workRelations.projectionSha256
): ManagedCodexArtifactRelationProjection {
  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf: AS_OF,
    workRelationProjectionSha256,
    attributionStoreRevision: 0,
    attributionStoreSha256: "3".repeat(64),
    githubBatchSha256: workRelations.githubBatchSha256,
    githubSourceSnapshotSha256:
      workRelations.githubSourceSnapshotSha256,
    totalAttachDecisionCount: 0,
    unresolvedAttributionCount: 0,
    relations: [],
    inputSha256: "4".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function claimCoverageForBatch(
  batch: RuntimeWorkSignalBatch | null
): "evaluated" | "stale" | "partial" | "unavailable" {
  if (batch === null || batch.assessment.freshness === "invalid") {
    return "unavailable";
  }
  if (batch.assessment.freshness === "stale") return "stale";
  if (batch.assessment.completeness === "partial") return "partial";
  return "evaluated";
}

function eligibilityVersions(): AttentionEligibilityEvaluationRecord["versions"] {
  return {
    datasetSchemaVersion:
      ATTENTION_ELIGIBILITY_EVALUATION_CASE_SCHEMA_VERSION,
    projectionContract: ATTENTION_ELIGIBILITY_SHADOW_PROJECTION_CONTRACT,
    candidateSeedSchemaVersion: ATTENTION_CANDIDATE_SEED_SCHEMA_VERSION,
    policyVersion: ATTENTION_ELIGIBILITY_POLICY_VERSION,
    evidencePolicyVersion: ATTENTION_ELIGIBILITY_EVIDENCE_POLICY_VERSION,
    resolverVersion: ATTENTION_ELIGIBILITY_RESOLVER_VERSION,
    idPolicyVersion: ATTENTION_ELIGIBILITY_ID_POLICY_VERSION
  };
}

function multisetMatches(expected: string[], actual: string[]): number {
  const available = new Map<string, number>();
  for (const value of actual) {
    available.set(value, (available.get(value) ?? 0) + 1);
  }
  let matches = 0;
  for (const value of expected) {
    const count = available.get(value) ?? 0;
    if (count <= 0) continue;
    matches += 1;
    available.set(value, count - 1);
  }
  return matches;
}

function routeMultisetDifference(
  expected: ExpectedAssessment[],
  actual: ExpectedAssessment[]
): number {
  const expectedRoutes = expected.map(
    (item) => `${item.taskKind}:${item.status}:${item.reviewRoute}`
  );
  const actualRoutes = actual.map(
    (item) => `${item.taskKind}:${item.status}:${item.reviewRoute}`
  );
  return Math.max(
    expectedRoutes.length,
    actualRoutes.length
  ) - multisetMatches(expectedRoutes, actualRoutes);
}

function countCases(
  executed: ExecutedCase[],
  label: string,
  predicate: (item: ExecutedCase) => boolean
): number {
  return executed.filter(
    (item) => item.result.labels.includes(label) && predicate(item)
  ).length;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return Number((numerator / denominator).toFixed(6));
}
