import { randomBytes } from "node:crypto";

import { z } from "zod";

import resolverConfigArtifact from "../../eval/synthetic/artifactRelationResolverConfig.v0.1.json";
import datasetArtifact from "../../eval/synthetic/artifactRelationResolverCases.v0.1.json";
import {
  attachWorkArtifactAttribution,
  createEmptyWorkArtifactAttributionStore,
  createGitHubArtifactId,
  createManagedCodexArtifactRelationId,
  detachWorkArtifactAttribution,
  managedCodexArtifactRelationProjectionSchema,
  resolveManagedCodexArtifactRelations,
  validateGitHubArtifactTarget,
  type GitHubArtifactIdentity,
  type ManagedCodexArtifactRelationProjection,
  type WorkArtifactAttributionDecision,
  type WorkArtifactAttributionStore
} from "../artifacts";
import type { GitHubSnapshot } from "../connectors/github/types";
import { runtimeSha256 } from "../crossSource/canonicalHash";
import type { RuntimeWorkSignalBatch } from "../crossSource/schema";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION
} from "../crossSource/versions";
import { finalizeRuntimeWorkSignalBatch } from "../crossSource/workSignalIntegrity";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import {
  WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS,
  WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION,
  WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION,
  WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT
} from "../artifacts/contracts";
import {
  WORK_RELATION_DATASET_SHA256,
  materializeWorkRelationEvaluationDataset
} from "./workRelationResolverEvaluation";
import { sha256Canonical } from "./crossSourceIntegrity";

export const ARTIFACT_RELATION_EVALUATION_DATASET_CONTRACT =
  "artifact-relation-resolver-evaluation-dataset-v0.1" as const;
export const ARTIFACT_RELATION_EVALUATION_CASE_SCHEMA_VERSION =
  "artifact-relation-resolver-evaluation-case-v0.1" as const;
export const ARTIFACT_RELATION_EVALUATION_RUN_RECORD_CONTRACT =
  "artifact-relation-resolver-evaluation-run-v0.1" as const;

export const PHASE3A_WORK_RELATION_DATASET_SHA256 =
  "b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002" as const;

const AS_OF = "2026-08-01T06:30:00.000Z";
const T1 = "2026-08-01T06:10:00.000Z";
const T2 = "2026-08-01T06:11:00.000Z";
const T3 = "2026-08-01T06:12:00.000Z";
const REPOSITORY_1 = 101;
const REPOSITORY_2 = 102;
const PR_OBJECT_1 = 201;
const PR_OBJECT_2 = 202;
const PR_NUMBER = 22;
const COMMIT_40 = "1".repeat(40);
const COMMIT_64 = "2".repeat(64);
const FAKE_MANAGED_RUN = `managed_run_${"f".repeat(32)}`;
const FAKE_BINDING = `binding_${"e".repeat(32)}`;
const FAKE_EXECUTION = `codex:execution:${"d".repeat(24)}`;
const FAKE_EXECUTES_RELATION = `relation_${"c".repeat(32)}`;
const PRIVATE_RAW_URL_SENTINEL = "PRIVATE_ARTIFACT_RAW_URL_SENTINEL";
const PRIVATE_REPOSITORY_SENTINEL =
  "PRIVATE_ARTIFACT_REPOSITORY_SENTINEL";
const PRIVATE_TITLE_SENTINEL = "PRIVATE_ARTIFACT_TITLE_SENTINEL";
const PRIVATE_SENTINELS = [
  PRIVATE_RAW_URL_SENTINEL,
  PRIVATE_REPOSITORY_SENTINEL,
  PRIVATE_TITLE_SENTINEL
] as const;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const scenarioSchema = z.enum([
  "explicit_commit_40",
  "explicit_commit_64",
  "explicit_pull_request_native_id",
  "duplicate_exact_commit",
  "duplicate_exact_pull_request",
  "one_run_multiple_artifacts",
  "multiple_runs_independent_artifacts",
  "detach_commit_lineage",
  "reattach_commit_lineage",
  "detach_pull_request_lineage",
  "turn_completed_only",
  "file_change_only",
  "title_similarity_only",
  "branch_similarity_only",
  "project_alignment_only",
  "time_proximity_only",
  "short_commit_sha",
  "invalid_commit_oid",
  "missing_managed_run",
  "work_relation_not_resolved",
  "binding_id_mismatch",
  "execution_id_mismatch",
  "repository_identity_ambiguous",
  "same_pr_number_different_repositories",
  "same_pr_native_id_number_conflict",
  "pull_request_snapshot_unavailable",
  "pull_request_snapshot_stale",
  "pull_request_not_observed",
  "pull_request_native_id_conflict",
  "raw_url_privacy_boundary",
  "reversed_decision_order",
  "tampered_store_integrity"
]);
const operationSchema = z.enum([
  "accepted",
  "detached",
  "no_decision",
  "rejected",
  "integrity_rejected"
]);

const evaluationCaseSchema = z
  .object({
    caseId: z.string().regex(/^AREL-DEV-[0-9]{3}$/),
    title: z.string().min(1).max(180),
    scenario: scenarioSchema,
    expected: z
      .object({
        operation: operationSchema,
        relationCount: z.number().int().nonnegative()
      })
      .strict(),
    labels: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1)
  })
  .strict();

export const artifactRelationEvaluationDatasetSchema = z
  .object({
    contract: z.literal(ARTIFACT_RELATION_EVALUATION_DATASET_CONTRACT),
    schemaVersion: z.literal(
      ARTIFACT_RELATION_EVALUATION_CASE_SCHEMA_VERSION
    ),
    datasetVersion: z.literal(
      "suggestion-artifact-relation-dev-v0.1"
    ),
    datasetRevision: z.literal(1),
    datasetClass: z.literal("dev_candidate"),
    inputBoundary: z.literal("explicit_artifact_attribution_inputs"),
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
          "eval/synthetic/artifactRelationResolverConfig.v0.1.json"
        ),
        version: z.literal(
          "managed-codex-artifact-relation-resolver-config-v0.1"
        ),
        sha256: sha256Schema
      })
      .strict(),
    expectedInvariants: z
      .object({
        relationType: z.literal("produces"),
        authority: z.literal("user_configured"),
        decisionSource: z.literal("explicit_user"),
        rawUrlPersisted: z.literal(false),
        metadataStorage: z.literal("local_only"),
        metadataRetentionDays: z.literal(30),
        attentionDisposition: z.literal("not_connected"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    cases: z.array(evaluationCaseSchema).length(32)
  })
  .strict()
  .superRefine((dataset, context) => {
    const caseIds = new Set<string>();
    const scenarios = new Set<string>();
    dataset.cases.forEach((item, index) => {
      if (caseIds.has(item.caseId) || scenarios.has(item.scenario)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", index],
          message: "Artifact case IDs and scenarios must be unique."
        });
      }
      caseIds.add(item.caseId);
      scenarios.add(item.scenario);
    });
  });

export type ArtifactRelationEvaluationDataset = z.infer<
  typeof artifactRelationEvaluationDatasetSchema
>;
export type ArtifactRelationEvaluationCase =
  ArtifactRelationEvaluationDataset["cases"][number];
type Scenario = z.infer<typeof scenarioSchema>;
type Operation = z.infer<typeof operationSchema>;

type WorkTarget = {
  managedRunId: string;
  bindingId: string;
  executionId: string;
  executesRelationId: string;
};

type ExpectedArtifactRelation = {
  relationId: string;
  attributionId: string;
  managedRunId: string;
  bindingId: string;
  executionId: string;
  executesRelationId: string;
  artifactId: string;
  artifactKey: string;
  lifecycle: "active" | "superseded_by_detach" | "superseded_by_reattribution";
  observationStatus:
    | "current"
    | "stale"
    | "not_observed"
    | "unavailable"
    | "conflict";
  observationCompleteness: "complete" | "truncated" | null;
};

export type MaterializedArtifactRelationCase = {
  evaluationCase: ArtifactRelationEvaluationCase;
  invariants: ArtifactRelationEvaluationDataset["expectedInvariants"];
  operationBeforeResolution: Operation;
  input: Parameters<typeof resolveManagedCodexArtifactRelations>[0];
  expectedRelations: ExpectedArtifactRelation[];
  expectedTotalAttachDecisionCount: number;
};

export type ArtifactRelationCaseResult = {
  caseId: string;
  passed: boolean;
  expectedSha256: string;
  actualSha256: string;
  projectionSha256: string | null;
  expectedRelationKeys: string[];
  actualRelationKeys: string[];
};

export type ArtifactRelationEvaluationMetrics = {
  caseCount: number;
  exactCasePassCount: number;
  exactCasePassRate: number;
  expectedRelationCount: number;
  observedRelationCount: number;
  relationTruePositiveCount: number;
  relationFalsePositiveCount: number;
  relationFalseNegativeCount: number;
  relationPrecision: number;
  relationRecall: number;
  hardNegativeLeakageCount: number;
  invalidIdentityLeakageCount: number;
  runIdentityLeakageCount: number;
  sourceLimitationCurrentLeakageCount: number;
  unsupportedAuthorityEmissionCount: number;
  attentionLeakageCount: number;
  privacySentinelLeakageCount: number;
  storedRawUrlLeakageCount: number;
  permutationDeterminismFailureCount: number;
  tamperedStoreAcceptanceCount: number;
  phase3aDatasetHashMismatchCount: number;
};

export type ArtifactRelationEvaluationRecord = {
  contract: typeof ARTIFACT_RELATION_EVALUATION_RUN_RECORD_CONTRACT;
  runId: string;
  comparisonRunId: null;
  comparisonReason: "INITIAL_TARGETED_PHASE3B_DEV_CANDIDATE_BASELINE";
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  dataset: {
    version: "suggestion-artifact-relation-dev-v0.1";
    revision: 1;
    class: "dev_candidate";
    lifecycle: "mutable";
    inputBoundary: "explicit_artifact_attribution_inputs";
    canonicalSha256: string;
    materializedInputSha256: string;
    caseCount: number;
  };
  versions: {
    datasetSchemaVersion: typeof ARTIFACT_RELATION_EVALUATION_CASE_SCHEMA_VERSION;
    projectionContract: typeof MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT;
    relationSchemaVersion: typeof ARTIFACT_RELATION_SCHEMA_VERSION;
    resolverVersion: typeof MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION;
    evidencePolicyVersion: typeof ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION;
    identityPolicyVersion: typeof GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION;
    attributionStoreContract: typeof WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT;
    attributionSchemaVersion: typeof WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION;
    retentionPolicyVersion: typeof WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION;
  };
  resolverConfig: ArtifactRelationEvaluationDataset["resolverConfig"];
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
  metrics: ArtifactRelationEvaluationMetrics;
  cases: ArtifactRelationCaseResult[];
  deterministicOutputSha256: string;
  errors: Array<{
    caseId: string;
    code: "ARTIFACT_RELATION_EXACT_MISMATCH";
  }>;
  attentionDisposition: "not_connected";
  privacyClass: "synthetic_sanitized_metadata";
};

export function loadArtifactRelationEvaluationDataset(
  input: unknown
): ArtifactRelationEvaluationDataset {
  const dataset = artifactRelationEvaluationDatasetSchema.parse(input);
  const configSha256 = sha256Canonical(resolverConfigArtifact);
  if (
    dataset.resolverConfig.sha256 !== configSha256 ||
    dataset.resolverConfig.version !== resolverConfigArtifact.version
  ) {
    throw new Error(
      "Artifact relation resolver evaluation config integrity check failed."
    );
  }
  return dataset;
}

export const artifactRelationEvaluationDataset =
  loadArtifactRelationEvaluationDataset(datasetArtifact);

export const ARTIFACT_RELATION_CONFIG_SHA256 = sha256Canonical(
  resolverConfigArtifact
);
export const ARTIFACT_RELATION_DATASET_SHA256 = sha256Canonical(
  artifactRelationEvaluationDataset
);

export function materializeArtifactRelationEvaluationDataset(
  dataset: ArtifactRelationEvaluationDataset =
    artifactRelationEvaluationDataset
): MaterializedArtifactRelationCase[] {
  return dataset.cases.map((evaluationCase) =>
    materializeArtifactRelationEvaluationCase(
      evaluationCase,
      dataset.expectedInvariants
    )
  );
}

export function materializeArtifactRelationEvaluationCase(
  evaluationCase: ArtifactRelationEvaluationCase,
  invariants: ArtifactRelationEvaluationDataset["expectedInvariants"] =
    artifactRelationEvaluationDataset.expectedInvariants
): MaterializedArtifactRelationCase {
  const fixture = buildFixture(evaluationCase.scenario);
  const expectedRelations = expectedRelationsFor(fixture);
  if (expectedRelations.length !== evaluationCase.expected.relationCount) {
    throw new Error(
      `${evaluationCase.caseId} expected relation count does not match its materialized fixture.`
    );
  }
  return {
    evaluationCase,
    invariants,
    operationBeforeResolution: fixture.operation,
    input: fixture.input,
    expectedRelations,
    expectedTotalAttachDecisionCount: fixture.input.attributionStore.decisions.filter(
      (decision) => decision.action === "attach"
    ).length
  };
}

export function runArtifactRelationEvaluation(input?: {
  startedAt?: Date;
  completedAt?: Date;
  code?: ArtifactRelationEvaluationRecord["code"];
  dataset?: ArtifactRelationEvaluationDataset;
}): ArtifactRelationEvaluationRecord {
  const startedAt = input?.startedAt ?? new Date();
  const dataset = input?.dataset ?? artifactRelationEvaluationDataset;
  const materialized = materializeArtifactRelationEvaluationDataset(dataset);
  const materializedInputSha256 = sha256Canonical(
    materialized.map((item) => ({
      caseId: item.evaluationCase.caseId,
      scenario: item.evaluationCase.scenario,
      sourceRevision: dataset.datasetRevision,
      operationBeforeResolution: item.operationBeforeResolution,
      input: item.input
    }))
  );
  const evaluated = materialized.map(evaluateCase);
  const cases = evaluated.map(({ projection: _projection, store: _store, ...item }) =>
    item
  );
  const metrics = computeMetrics(evaluated, dataset);
  const errors = cases
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: "ARTIFACT_RELATION_EXACT_MISMATCH" as const
    }));
  const deterministicOutputSha256 = sha256Canonical({
    datasetSha256: sha256Canonical(dataset),
    materializedInputSha256,
    versions: {
      projection: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
      schema: ARTIFACT_RELATION_SCHEMA_VERSION,
      resolver: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
      evidence: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
      identity: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
      attribution: WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION
    },
    metrics,
    cases
  });
  const completedAt = input?.completedAt ?? new Date();
  return {
    contract: ARTIFACT_RELATION_EVALUATION_RUN_RECORD_CONTRACT,
    runId: createArtifactRelationEvaluationRunId(),
    comparisonRunId: null,
    comparisonReason:
      "INITIAL_TARGETED_PHASE3B_DEV_CANDIDATE_BASELINE",
    status:
      errors.length === 0 && artifactRelationReleaseGatesPass(metrics)
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
        ARTIFACT_RELATION_EVALUATION_CASE_SCHEMA_VERSION,
      projectionContract:
        MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
      relationSchemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
      resolverVersion:
        MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
      evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
      identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
      attributionStoreContract: WORK_ARTIFACT_ATTRIBUTION_STORE_CONTRACT,
      attributionSchemaVersion: WORK_ARTIFACT_ATTRIBUTION_SCHEMA_VERSION,
      retentionPolicyVersion:
        WORK_ARTIFACT_ATTRIBUTION_RETENTION_POLICY_VERSION
    },
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
    attentionDisposition: "not_connected",
    privacyClass: "synthetic_sanitized_metadata"
  };
}

export function artifactRelationReleaseGatesPass(
  metrics: ArtifactRelationEvaluationMetrics
): boolean {
  return (
    metrics.exactCasePassCount === metrics.caseCount &&
    metrics.relationFalsePositiveCount === 0 &&
    metrics.relationFalseNegativeCount === 0 &&
    metrics.hardNegativeLeakageCount === 0 &&
    metrics.invalidIdentityLeakageCount === 0 &&
    metrics.runIdentityLeakageCount === 0 &&
    metrics.sourceLimitationCurrentLeakageCount === 0 &&
    metrics.unsupportedAuthorityEmissionCount === 0 &&
    metrics.attentionLeakageCount === 0 &&
    metrics.privacySentinelLeakageCount === 0 &&
    metrics.storedRawUrlLeakageCount === 0 &&
    metrics.permutationDeterminismFailureCount === 0 &&
    metrics.tamperedStoreAcceptanceCount === 0 &&
    metrics.phase3aDatasetHashMismatchCount === 0
  );
}

export function createArtifactRelationEvaluationRunId(): string {
  return `artifact_relation_run_${randomBytes(16).toString("hex")}`;
}

function evaluateCase(item: MaterializedArtifactRelationCase):
  ArtifactRelationCaseResult & {
    projection: ManagedCodexArtifactRelationProjection | null;
    store: WorkArtifactAttributionStore;
    actualOperation: Operation;
  } {
  let projection: ManagedCodexArtifactRelationProjection | null = null;
  let actualOperation = item.operationBeforeResolution;
  try {
    projection = resolveManagedCodexArtifactRelations(item.input);
    managedCodexArtifactRelationProjectionSchema.parse(projection);
  } catch (error) {
    if (item.evaluationCase.scenario !== "tampered_store_integrity") {
      throw error;
    }
    actualOperation = "integrity_rejected";
  }

  const expected = expectedSemantics(item);
  const actual = projection
    ? normalizedArtifactRelationSemantics(projection, actualOperation)
    : {
        operation: actualOperation,
        invariants: item.invariants,
        totalAttachDecisionCount: 0,
        unresolvedAttributionCount: 0,
        activeRelationCount: 0,
        relations: []
      };
  const expectedSha256 = sha256Canonical(expected);
  const actualSha256 = sha256Canonical(actual);
  return {
    caseId: item.evaluationCase.caseId,
    passed: expectedSha256 === actualSha256,
    expectedSha256,
    actualSha256,
    projectionSha256: projection?.projectionSha256 ?? null,
    expectedRelationKeys: expected.relations.map(artifactRelationKey),
    actualRelationKeys: actual.relations.map(artifactRelationKey),
    projection,
    store: item.input.attributionStore,
    actualOperation
  };
}

function expectedSemantics(item: MaterializedArtifactRelationCase) {
  const tampered =
    item.evaluationCase.scenario === "tampered_store_integrity";
  return {
    operation: item.evaluationCase.expected.operation,
    invariants: item.invariants,
    totalAttachDecisionCount: tampered
      ? 0
      : item.expectedTotalAttachDecisionCount,
    unresolvedAttributionCount: tampered
      ? 0
      : item.expectedTotalAttachDecisionCount -
        item.expectedRelations.length,
    activeRelationCount: item.expectedRelations.filter(
      (relation) => relation.lifecycle === "active"
    ).length,
    relations: item.expectedRelations
  };
}

export function normalizedArtifactRelationSemantics(
  projection: ManagedCodexArtifactRelationProjection,
  operation: Operation = "accepted"
) {
  return {
    operation,
    invariants: {
      relationType: projection.relations.every(
        (relation) => relation.type === "produces"
      )
        ? ("produces" as const)
        : ("invalid" as const),
      authority: projection.relations.every(
        (relation) => relation.authority === "user_configured"
      )
        ? ("user_configured" as const)
        : ("invalid" as const),
      decisionSource: projection.relations.every(
        (relation) =>
          relation.attributionEvidence.decisionSource === "explicit_user"
      )
        ? ("explicit_user" as const)
        : ("invalid" as const),
      rawUrlPersisted: false as const,
      metadataStorage: "local_only" as const,
      metadataRetentionDays: WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS,
      attentionDisposition: projection.attentionDisposition,
      forbiddenAsAttentionCandidate:
        projection.forbiddenAsAttentionCandidate
    },
    totalAttachDecisionCount: projection.totalAttachDecisionCount,
    unresolvedAttributionCount: projection.unresolvedAttributionCount,
    activeRelationCount: projection.relations.filter(
      (relation) => relation.attributionLifecycle.state === "active"
    ).length,
    relations: projection.relations.map((relation) => ({
      relationId: relation.relationId,
      attributionId: relation.attributionId,
      managedRunId: relation.managedRunId,
      bindingId: relation.bindingId,
      executionId: relation.executionId,
      executesRelationId: relation.executesRelationId,
      artifactId: relation.artifactId,
      artifactKey: artifactKey(relation.artifact),
      lifecycle: relation.attributionLifecycle.state,
      observationStatus: relation.githubObservation.status,
      observationCompleteness: relation.githubObservation.completeness
    }))
  };
}

function artifactRelationKey(relation: {
  relationId: string;
  attributionId: string;
  managedRunId: string;
  artifactId: string;
}): string {
  return [
    relation.relationId,
    relation.attributionId,
    relation.managedRunId,
    relation.artifactId
  ].join("|");
}

function computeMetrics(
  evaluated: Array<
    ArtifactRelationCaseResult & {
      projection: ManagedCodexArtifactRelationProjection | null;
      store: WorkArtifactAttributionStore;
      actualOperation: Operation;
    }
  >,
  dataset: ArtifactRelationEvaluationDataset
): ArtifactRelationEvaluationMetrics {
  const caseById = new Map(
    dataset.cases.map((item) => [item.caseId, item])
  );
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const item of evaluated) {
    const expected = new Set(item.expectedRelationKeys);
    const actual = new Set(item.actualRelationKeys);
    truePositive += [...actual].filter((key) => expected.has(key)).length;
    falsePositive += [...actual].filter((key) => !expected.has(key)).length;
    falseNegative += [...expected].filter((key) => !actual.has(key)).length;
  }
  const expectedRelationCount = evaluated.reduce(
    (total, item) => total + item.expectedRelationKeys.length,
    0
  );
  const observedRelationCount = evaluated.reduce(
    (total, item) => total + item.actualRelationKeys.length,
    0
  );
  const evaluatedByScenario = new Map(
    evaluated.map((item) => [caseById.get(item.caseId)?.scenario, item])
  );
  const canonical = evaluatedByScenario.get(
    "one_run_multiple_artifacts"
  );
  const reversed = evaluatedByScenario.get("reversed_decision_order");

  return {
    caseCount: evaluated.length,
    exactCasePassCount: evaluated.filter((item) => item.passed).length,
    exactCasePassRate:
      evaluated.length === 0
        ? 0
        : evaluated.filter((item) => item.passed).length /
          evaluated.length,
    expectedRelationCount,
    observedRelationCount,
    relationTruePositiveCount: truePositive,
    relationFalsePositiveCount: falsePositive,
    relationFalseNegativeCount: falseNegative,
    relationPrecision:
      observedRelationCount === 0 ? 0 : truePositive / observedRelationCount,
    relationRecall:
      expectedRelationCount === 0 ? 0 : truePositive / expectedRelationCount,
    hardNegativeLeakageCount: labeledUnexpectedRelationCount(
      evaluated,
      caseById,
      "hard_negative"
    ),
    invalidIdentityLeakageCount: labeledUnexpectedRelationCount(
      evaluated,
      caseById,
      "invalid_identity"
    ),
    runIdentityLeakageCount: labeledUnexpectedRelationCount(
      evaluated,
      caseById,
      "run_integrity"
    ),
    sourceLimitationCurrentLeakageCount: evaluated.reduce((count, item) => {
      const fixture = caseById.get(item.caseId);
      if (!fixture?.labels.includes("observation_gate")) return count;
      return (
        count +
        (item.projection?.relations.filter(
          (relation) => relation.githubObservation.status === "current"
        ).length ?? 0)
      );
    }, 0),
    unsupportedAuthorityEmissionCount: evaluated.reduce(
      (count, item) =>
        count +
        (item.projection?.relations.filter(
          (relation) =>
            relation.authority !== "user_configured" ||
            relation.attributionEvidence.decisionSource !== "explicit_user"
        ).length ?? 0),
      0
    ),
    attentionLeakageCount: evaluated.reduce(
      (count, item) =>
        count +
        (item.projection
          ? Number(
              item.projection.attentionDisposition !== "not_connected" ||
                !item.projection.forbiddenAsAttentionCandidate
            ) +
            item.projection.relations.filter(
              (relation) =>
                relation.attentionDisposition !== "not_connected" ||
                !relation.forbiddenAsAttentionCandidate
            ).length
          : 0),
      0
    ),
    privacySentinelLeakageCount: evaluated.reduce((count, item) => {
      const serialized = JSON.stringify({
        store: item.store,
        projection: item.projection
      });
      return (
        count +
        PRIVATE_SENTINELS.filter((sentinel) =>
          serialized.includes(sentinel)
        ).length
      );
    }, 0),
    storedRawUrlLeakageCount: evaluated.reduce(
      (count, item) =>
        count + Number(/https:\/\/github\.com\//u.test(JSON.stringify(item.store))),
      0
    ),
    permutationDeterminismFailureCount:
      canonical?.projection &&
      reversed?.projection &&
      sha256Canonical(
        normalizedArtifactRelationSemantics(canonical.projection)
      ) ===
        sha256Canonical(
          normalizedArtifactRelationSemantics(reversed.projection)
        )
        ? 0
        : 1,
    tamperedStoreAcceptanceCount:
      evaluatedByScenario.get("tampered_store_integrity")?.projection === null
        ? 0
        : 1,
    phase3aDatasetHashMismatchCount:
      WORK_RELATION_DATASET_SHA256 ===
      PHASE3A_WORK_RELATION_DATASET_SHA256
        ? 0
        : 1
  };
}

function labeledUnexpectedRelationCount(
  evaluated: Array<{
    caseId: string;
    actualRelationKeys: string[];
  }>,
  caseById: Map<string, ArtifactRelationEvaluationCase>,
  label: string
): number {
  return evaluated.reduce((count, item) => {
    const fixture = caseById.get(item.caseId);
    if (
      !fixture?.labels.includes(label) ||
      fixture.expected.relationCount !== 0
    ) {
      return count;
    }
    return count + item.actualRelationKeys.length;
  }, 0);
}

type Fixture = {
  operation: Operation;
  input: Parameters<typeof resolveManagedCodexArtifactRelations>[0];
};

function buildFixture(scenario: Scenario): Fixture {
  const workScenario = workScenarioFor(scenario);
  const workInput = workInputFor(workScenario);
  const workRelationProjection = resolveManagedCodexWorkRelations(workInput);
  managedCodexWorkRelationProjectionSchema.parse(workRelationProjection);
  let githubBatch = githubBatchForScenario(scenario, workInput.githubBatch);
  let store = createEmptyWorkArtifactAttributionStore(T1);
  let operation: Operation = "accepted";
  const targets = workTargets(workRelationProjection);
  const primary = targets[0] ?? targetFromRunResolution(workRelationProjection);

  const attach = (
    artifact: GitHubArtifactIdentity,
    target: WorkTarget = primary,
    attachedAt = T1
  ): WorkArtifactAttributionDecision => {
    const result = attachWorkArtifactAttribution(store, {
      ...target,
      artifact,
      attachedAt,
      explicitUserConfirmation: true
    });
    store = result.store;
    return result.decision;
  };
  const detach = (
    attributionId: string,
    detachedAt = T2
  ): WorkArtifactAttributionDecision => {
    const result = detachWorkArtifactAttribution(store, {
      attributionId,
      detachedAt,
      explicitUserConfirmation: true
    });
    store = result.store;
    operation = "detached";
    return result.decision;
  };

  switch (scenario) {
    case "explicit_commit_40":
      attach(validatedCommit(COMMIT_40));
      break;
    case "explicit_commit_64":
      attach(validatedCommit(COMMIT_64));
      break;
    case "explicit_pull_request_native_id":
      attach(validatedPullRequest());
      break;
    case "duplicate_exact_commit": {
      const artifact = validatedCommit(COMMIT_40);
      attach(artifact);
      attach(artifact, primary, T2);
      break;
    }
    case "duplicate_exact_pull_request": {
      const artifact = validatedPullRequest();
      attach(artifact);
      attach(artifact, primary, T2);
      break;
    }
    case "one_run_multiple_artifacts":
      attach(validatedCommit(COMMIT_40), primary, T1);
      attach(validatedPullRequest(), primary, T1);
      break;
    case "multiple_runs_independent_artifacts":
      attach(
        { kind: "github_commit", repositoryId: REPOSITORY_1, oid: COMMIT_40 },
        targets[0]!
      );
      attach(
        { kind: "github_commit", repositoryId: REPOSITORY_2, oid: COMMIT_64 },
        targets[1]!,
        T2
      );
      break;
    case "detach_commit_lineage": {
      const decision = attach(validatedCommit(COMMIT_40));
      detach(decision.attributionId);
      break;
    }
    case "reattach_commit_lineage": {
      const artifact = validatedCommit(COMMIT_40);
      const decision = attach(artifact);
      detach(decision.attributionId);
      attach(artifact, primary, T3);
      operation = "accepted";
      break;
    }
    case "detach_pull_request_lineage": {
      const decision = attach(validatedPullRequest());
      detach(decision.attributionId);
      break;
    }
    case "turn_completed_only":
    case "file_change_only":
    case "title_similarity_only":
    case "branch_similarity_only":
    case "project_alignment_only":
    case "time_proximity_only":
      operation = "no_decision";
      break;
    case "short_commit_sha":
      operation = rejectedOperation(() =>
        validateGitHubArtifactTarget(
          "https://github.com/synthetic/project/commit/1234567",
          githubSnapshot()
        )
      );
      break;
    case "invalid_commit_oid":
      operation = rejectedOperation(() =>
        validateGitHubArtifactTarget(
          `https://github.com/synthetic/project/commit/${"z".repeat(40)}`,
          githubSnapshot()
        )
      );
      break;
    case "missing_managed_run":
      attach(validatedCommit(COMMIT_40), {
        ...primary,
        managedRunId: FAKE_MANAGED_RUN
      });
      break;
    case "work_relation_not_resolved":
      attach(validatedCommit(COMMIT_40), primary);
      break;
    case "binding_id_mismatch":
      attach(validatedCommit(COMMIT_40), {
        ...primary,
        bindingId: FAKE_BINDING
      });
      break;
    case "execution_id_mismatch":
      attach(validatedCommit(COMMIT_40), {
        ...primary,
        executionId: FAKE_EXECUTION
      });
      break;
    case "repository_identity_ambiguous":
      operation = rejectedOperation(() =>
        validateGitHubArtifactTarget(
          `https://github.com/synthetic/project/commit/${COMMIT_40}`,
          githubSnapshot({ ambiguousRepository: true })
        )
      );
      break;
    case "same_pr_number_different_repositories":
      attach(validatedPullRequest(), primary, T1);
      attach(
        {
          kind: "github_pull_request",
          repositoryId: REPOSITORY_2,
          objectId: PR_OBJECT_2,
          number: PR_NUMBER
        },
        primary,
        T2
      );
      break;
    case "same_pr_native_id_number_conflict": {
      attach(validatedPullRequest());
      operation = rejectedOperation(() =>
        attach(
          {
            kind: "github_pull_request",
            repositoryId: REPOSITORY_1,
            objectId: PR_OBJECT_1,
            number: PR_NUMBER + 1
          },
          primary,
          T2
        )
      );
      break;
    }
    case "pull_request_snapshot_unavailable":
    case "pull_request_snapshot_stale":
    case "pull_request_not_observed":
    case "pull_request_native_id_conflict":
      attach(validatedPullRequest());
      break;
    case "raw_url_privacy_boundary": {
      const privateRepository = `${PRIVATE_RAW_URL_SENTINEL}/${PRIVATE_REPOSITORY_SENTINEL}`;
      const artifact = validateGitHubArtifactTarget(
        `https://github.com/${privateRepository}/commit/${COMMIT_40}`,
        githubSnapshot({ repositoryFullName: privateRepository })
      );
      attach(artifact);
      break;
    }
    case "reversed_decision_order":
      attach(validatedPullRequest(), primary, T1);
      attach(validatedCommit(COMMIT_40), primary, T1);
      break;
    case "tampered_store_integrity":
      attach(validatedCommit(COMMIT_40));
      store = {
        ...store,
        storeSha256: "0".repeat(64)
      };
      break;
  }

  return {
    operation,
    input: {
      asOf: AS_OF,
      workRelationProjection,
      attributionStore: store,
      githubBatch
    }
  };
}

function workScenarioFor(
  scenario: Scenario
):
  | "active_aligned_issue"
  | "active_aligned_pull_request"
  | "two_independent_runs"
  | "binding_decision_missing" {
  if (scenario === "multiple_runs_independent_artifacts") {
    return "two_independent_runs";
  }
  if (scenario === "work_relation_not_resolved") {
    return "binding_decision_missing";
  }
  if (
    scenario === "explicit_pull_request_native_id" ||
    scenario === "duplicate_exact_pull_request" ||
    scenario === "one_run_multiple_artifacts" ||
    scenario === "detach_pull_request_lineage" ||
    scenario === "same_pr_number_different_repositories" ||
    scenario === "same_pr_native_id_number_conflict" ||
    scenario === "pull_request_snapshot_unavailable" ||
    scenario === "pull_request_snapshot_stale" ||
    scenario === "pull_request_not_observed" ||
    scenario === "pull_request_native_id_conflict" ||
    scenario === "reversed_decision_order"
  ) {
    return "active_aligned_pull_request";
  }
  return "active_aligned_issue";
}

function workInputFor(
  scenario:
    | "active_aligned_issue"
    | "active_aligned_pull_request"
    | "two_independent_runs"
    | "binding_decision_missing"
): Parameters<typeof resolveManagedCodexWorkRelations>[0] {
  const fixture = materializeWorkRelationEvaluationDataset().find(
    (item) => item.evaluationCase.scenario === scenario
  );
  if (!fixture) throw new Error(`Missing Phase 3A fixture: ${scenario}`);
  return fixture.input;
}

function githubBatchForScenario(
  scenario: Scenario,
  base: RuntimeWorkSignalBatch | null
): RuntimeWorkSignalBatch | null {
  if (scenario === "pull_request_snapshot_unavailable") return null;
  if (scenario === "pull_request_not_observed") {
    const fixture = materializeWorkRelationEvaluationDataset().find(
      (item) => item.evaluationCase.scenario === "target_not_observed"
    );
    if (!fixture) throw new Error("Missing Phase 3A absence fixture.");
    return fixture.input.githubBatch;
  }
  if (scenario === "pull_request_native_id_conflict") {
    const fixture = materializeWorkRelationEvaluationDataset().find(
      (item) =>
        item.evaluationCase.scenario === "conflicting_github_identity"
    );
    if (!fixture) throw new Error("Missing Phase 3A conflict fixture.");
    return fixture.input.githubBatch;
  }
  if (scenario !== "pull_request_snapshot_stale" || base === null) {
    return base;
  }
  const {
    batchSha256: _batchSha256,
    signalCount: _signalCount,
    ...draft
  } = base;
  return finalizeRuntimeWorkSignalBatch({
    ...draft,
    assessment: {
      ...draft.assessment,
      freshness: "stale",
      candidateSetComplete: false,
      usableForCurrentCandidates: false,
      reasonCodes: ["SNAPSHOT_STALE"]
    }
  });
}

function workTargets(
  projection: ManagedCodexWorkRelationProjection
): WorkTarget[] {
  return projection.relations
    .flatMap((relation) =>
      relation.managedRunIds.map((managedRunId) => ({
        managedRunId,
        bindingId: relation.bindingId,
        executionId: relation.from.subjectId,
        executesRelationId: relation.relationId
      }))
    )
    .sort((left, right) =>
      left.managedRunId.localeCompare(right.managedRunId)
    );
}

function targetFromRunResolution(
  projection: ManagedCodexWorkRelationProjection
): WorkTarget {
  const resolution = projection.runResolutions[0];
  if (!resolution) throw new Error("Synthetic work projection has no run.");
  return {
    managedRunId: resolution.managedRunId,
    bindingId: resolution.bindingId,
    executionId: resolution.executionId,
    executesRelationId: resolution.relationId ?? FAKE_EXECUTES_RELATION
  };
}

function expectedRelationsFor(
  fixture: Fixture
): ExpectedArtifactRelation[] {
  if (
    fixture.input.attributionStore.storeSha256 === "0".repeat(64)
  ) {
    return [];
  }
  const successors = new Map<string, WorkArtifactAttributionDecision>();
  for (const decision of fixture.input.attributionStore.decisions) {
    if (decision.supersedesAttributionId) {
      successors.set(decision.supersedesAttributionId, decision);
    }
  }
  return fixture.input.attributionStore.decisions
    .filter(
      (
        decision
      ): decision is WorkArtifactAttributionDecision & {
        action: "attach";
      } =>
        decision.action === "attach" &&
        exactExpectedWorkRelation(
          decision,
          fixture.input.workRelationProjection
        )
    )
    .map((decision) => {
      const artifactId = createGitHubArtifactId(decision.artifact);
      const successor = successors.get(decision.attributionId);
      return {
        relationId: createManagedCodexArtifactRelationId({
          attributionId: decision.attributionId,
          executionId: decision.executionId,
          artifactId
        }),
        attributionId: decision.attributionId,
        managedRunId: decision.managedRunId,
        bindingId: decision.bindingId,
        executionId: decision.executionId,
        executesRelationId: decision.executesRelationId,
        artifactId,
        artifactKey: artifactKey(decision.artifact),
        lifecycle: successor
          ? successor.action === "detach"
            ? ("superseded_by_detach" as const)
            : ("superseded_by_reattribution" as const)
          : ("active" as const),
        observationStatus: expectedObservationStatus(
          decision.artifact,
          fixture.input.githubBatch
        ),
        observationCompleteness:
          fixture.input.githubBatch === null
            ? null
            : fixture.input.githubBatch.assessment.completeness ===
                "complete"
              ? ("complete" as const)
              : ("truncated" as const)
      };
    })
    .sort((left, right) => left.relationId.localeCompare(right.relationId));
}

function exactExpectedWorkRelation(
  decision: WorkArtifactAttributionDecision,
  projection: ManagedCodexWorkRelationProjection
): boolean {
  const resolution = projection.runResolutions.find(
    (candidate) => candidate.managedRunId === decision.managedRunId
  );
  const relation = projection.relations.find(
    (candidate) => candidate.relationId === decision.executesRelationId
  );
  return Boolean(
    resolution?.status === "resolved" &&
      resolution.bindingId === decision.bindingId &&
      resolution.executionId === decision.executionId &&
      resolution.relationId === decision.executesRelationId &&
      relation?.bindingId === decision.bindingId &&
      relation.from.subjectId === decision.executionId &&
      relation.managedRunIds.includes(decision.managedRunId)
  );
}

function expectedObservationStatus(
  artifact: GitHubArtifactIdentity,
  batch: RuntimeWorkSignalBatch | null
): ExpectedArtifactRelation["observationStatus"] {
  if (batch === null || batch.assessment.freshness === "invalid") {
    return "unavailable";
  }
  if (artifact.kind === "github_commit") return "not_observed";
  const signals = batch.signals.filter(
    (signal) =>
      signal.kind === "work_item_observation" &&
      signal.subjectId === `github:object:${artifact.objectId}`
  );
  if (signals.length === 0) return "not_observed";
  if (
    signals.some(
      (signal) =>
        signal.kind !== "work_item_observation" ||
        signal.facts.objectType !== "pull_request" ||
        signal.facts.number !== artifact.number ||
        signal.sourceScopeId !== `repository:${artifact.repositoryId}`
    )
  ) {
    return "conflict";
  }
  return batch.assessment.freshness === "fresh" ? "current" : "stale";
}

function artifactKey(artifact: GitHubArtifactIdentity): string {
  return artifact.kind === "github_commit"
    ? `github:commit:${artifact.repositoryId}:${artifact.oid}`
    : `github:pull_request:${artifact.repositoryId}:${artifact.objectId}`;
}

function validatedCommit(oid: string): GitHubArtifactIdentity {
  return validateGitHubArtifactTarget(
    `https://github.com/synthetic/project/commit/${oid}`,
    githubSnapshot()
  );
}

function validatedPullRequest(): GitHubArtifactIdentity {
  return validateGitHubArtifactTarget(
    `https://github.com/synthetic/project/pull/${PR_NUMBER}`,
    githubSnapshot({ includePullRequest: true })
  );
}

function rejectedOperation(callback: () => unknown): Operation {
  try {
    callback();
    return "accepted";
  } catch {
    return "rejected";
  }
}

function githubSnapshot(input: {
  repositoryFullName?: string;
  includePullRequest?: boolean;
  ambiguousRepository?: boolean;
} = {}): GitHubSnapshot {
  const repositoryFullName =
    input.repositoryFullName ?? "synthetic/project";
  const repository = {
    id: REPOSITORY_1,
    source: "github" as const,
    kind: "repository" as const,
    installationId: 1,
    fullName: repositoryFullName,
    private: true,
    archived: false,
    updatedAt: T1
  };
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: T1,
    user: { id: 1, login: "synthetic-user" },
    truncated: false,
    activityWindowStart: "2026-07-25T06:10:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [
      {
        id: 1,
        accountLogin: "synthetic-user",
        accountType: "User",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      repository,
      ...(input.ambiguousRepository
        ? [{ ...repository, id: REPOSITORY_2 }]
        : [])
    ],
    tasks: input.includePullRequest
      ? [
          {
            id: PR_OBJECT_1,
            source: "github",
            kind: "review_requested_pull_request",
            repositoryId: REPOSITORY_1,
            repositoryFullName,
            number: PR_NUMBER,
            title: PRIVATE_TITLE_SENTINEL,
            htmlUrl: `https://github.com/${repositoryFullName}/pull/${PR_NUMBER}`,
            labelNames: [],
            milestoneDueAt: null,
            state: "open",
            createdAt: T1,
            updatedAt: T1
          }
        ]
      : [],
    activities: []
  };
}
