import { randomBytes } from "node:crypto";

import { z } from "zod";

import resolverConfigArtifact from "../../eval/synthetic/workRelationResolverConfig.v0.1.json";
import datasetArtifact from "../../eval/synthetic/workRelationResolverCases.v0.1.json";
import {
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";
import {
  RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT,
  GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  SNAPSHOT_VALIDITY_POLICY_VERSION,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../crossSource/versions";
import {
  finalizeRuntimeWorkSignal,
  finalizeRuntimeWorkSignalBatch
} from "../crossSource/workSignalIntegrity";
import type { RuntimeWorkSignalBatch } from "../crossSource/schema";
import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  lookupProjectId,
  proposeProjectMapping,
  removeProjectMapping,
  type SourceScopeRef,
  type WorkContextRegistry
} from "../context/contracts";
import {
  CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT,
  managedCodexPublicProjectionSchema,
  type ManagedCodexPublicProjection
} from "../managedCodex/contracts";
import {
  bindWorkSessionDecision,
  createEmptyWorkSessionBindingStore,
  unbindWorkSessionDecision,
  type WorkSessionBindingDecision,
  type WorkSessionBindingStore
} from "../resumption/contracts";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations,
  type ManagedCodexWorkRelation,
  type ManagedCodexWorkRelationProjection
} from "../relations";
import { sha256Canonical } from "./crossSourceIntegrity";

export const WORK_RELATION_EVALUATION_DATASET_CONTRACT =
  "work-relation-resolver-evaluation-dataset-v0.1" as const;
export const WORK_RELATION_EVALUATION_CASE_SCHEMA_VERSION =
  "work-relation-resolver-evaluation-case-v0.1" as const;
export const WORK_RELATION_EVALUATION_RUN_RECORD_CONTRACT =
  "work-relation-resolver-evaluation-run-v0.1" as const;

const AS_OF = "2026-08-01T06:30:00.000Z";
const T0 = "2026-08-01T06:00:00.000Z";
const T1 = "2026-08-01T06:01:00.000Z";
const T2 = "2026-08-01T06:02:00.000Z";
const PROJECT_A = `project_${"a".repeat(32)}`;
const PROJECT_B = `project_${"b".repeat(32)}`;
const EXECUTION_1 = `codex:execution:${"1".repeat(24)}`;
const EXECUTION_2 = `codex:execution:${"2".repeat(24)}`;
const SCOPE_1 = "1".repeat(24);
const SCOPE_2 = "2".repeat(24);
const MANAGED_RUN_1 = `managed_run_${"1".repeat(32)}`;
const MANAGED_RUN_2 = `managed_run_${"2".repeat(32)}`;
const MISSING_BINDING = `binding_${"f".repeat(32)}`;
const GITHUB_SUBJECT_1 = "github:object:201";
const GITHUB_SUBJECT_2 = "github:object:202";
const REPOSITORY_1 = 101;
const REPOSITORY_2 = 102;
const PRIVATE_TITLE_SENTINEL = "PRIVATE_RELATION_TITLE_SENTINEL";
const PRIVATE_REPOSITORY_SENTINEL =
  "PRIVATE_RELATION_REPOSITORY_SENTINEL/project";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime();
const scenarioSchema = z.enum([
  "active_aligned_issue",
  "active_aligned_pull_request",
  "duplicate_exact_github_observation",
  "target_not_observed",
  "stale_github_observation",
  "truncated_github_observation",
  "superseded_by_rebind",
  "superseded_by_unbind",
  "binding_decision_missing",
  "execution_identity_mismatch",
  "unsupported_notion_task",
  "unsupported_manual_task",
  "malformed_github_subject",
  "title_only_other_native_id",
  "project_only_other_native_id",
  "codex_project_unmapped",
  "github_project_unmapped",
  "confirmed_project_conflict",
  "mapping_proposals_only",
  "removed_project_mappings",
  "completed_turn_no_produces",
  "file_change_no_produces",
  "two_independent_runs",
  "reversed_managed_run_input",
  "conflicting_github_identity",
  "github_batch_unavailable",
  "run_references_unbind_decision",
  "two_runs_share_one_binding"
]);

const expectedSchema = z
  .object({
    resolutionCount: z.number().int().nonnegative(),
    relationCount: z.number().int().nonnegative(),
    statuses: z.array(
      z.enum([
        "resolved",
        "binding_not_found",
        "binding_not_bind",
        "execution_mismatch",
        "unsupported_task_source",
        "invalid_github_subject"
      ])
    ),
    bindingStates: z.array(
      z.enum([
        "active",
        "superseded_by_unbind",
        "superseded_by_rebind"
      ])
    ),
    githubStatuses: z.array(
      z.enum([
        "current",
        "stale",
        "not_observed",
        "unavailable",
        "conflict"
      ])
    ),
    githubCompleteness: z.array(
      z.enum(["complete", "truncated", "unknown"]).nullable()
    ),
    projectAlignments: z.array(
      z.enum(["aligned", "unmapped", "conflict", "unavailable"])
    ),
    identityStatuses: z.array(z.enum(["resolved", "conflict"])),
    conflictCodes: z.array(
      z.array(z.enum(["GITHUB_IDENTITY_CONFLICT", "PROJECT_MISMATCH"]))
    )
  })
  .strict()
  .superRefine((expected, context) => {
    if (expected.statuses.length !== expected.resolutionCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statuses"],
        message: "Expected statuses must match resolutionCount."
      });
    }
    for (const [key, values] of Object.entries(expected)) {
      if (
        key !== "resolutionCount" &&
        key !== "relationCount" &&
        key !== "statuses" &&
        Array.isArray(values) &&
        values.length !== expected.relationCount
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must match relationCount.`
        });
      }
    }
  });

const evaluationCaseSchema = z
  .object({
    caseId: z.string().regex(/^WREL-DEV-[0-9]{3}$/),
    title: z.string().min(1).max(180),
    scenario: scenarioSchema,
    expected: expectedSchema,
    labels: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1)
  })
  .strict();

export const workRelationEvaluationDatasetSchema = z
  .object({
    contract: z.literal(WORK_RELATION_EVALUATION_DATASET_CONTRACT),
    schemaVersion: z.literal(
      WORK_RELATION_EVALUATION_CASE_SCHEMA_VERSION
    ),
    datasetVersion: z.literal("suggestion-work-relation-dev-v0.1"),
    datasetRevision: z.literal(1),
    datasetClass: z.literal("dev_candidate"),
    inputBoundary: z.literal("work_relation_resolution_inputs"),
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
          "eval/synthetic/workRelationResolverConfig.v0.1.json"
        ),
        version: z.literal(
          "managed-codex-work-relation-resolver-config-v0.1"
        ),
        sha256: sha256Schema
      })
      .strict(),
    expectedInvariants: z
      .object({
        relationType: z.literal("executes"),
        authority: z.literal("user_configured"),
        attentionDisposition: z.literal("not_connected"),
        forbiddenAsAttentionCandidate: z.literal(true)
      })
      .strict(),
    cases: z.array(evaluationCaseSchema).min(20).max(100)
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
          message: "Case IDs and scenarios must be unique."
        });
      }
      caseIds.add(item.caseId);
      scenarios.add(item.scenario);
    });
  });

export type WorkRelationEvaluationDataset = z.infer<
  typeof workRelationEvaluationDatasetSchema
>;
export type WorkRelationEvaluationCase =
  WorkRelationEvaluationDataset["cases"][number];

export type MaterializedWorkRelationCase = {
  evaluationCase: WorkRelationEvaluationCase;
  input: Parameters<typeof resolveManagedCodexWorkRelations>[0];
  expectedRelations: ExpectedRelationIdentity[];
};

type ExpectedRelationIdentity = {
  relationId: string;
  bindingId: string;
  managedRunIds: string[];
  fromSubjectId: string;
  toSubjectId: string;
  boundAt: string;
};

export type WorkRelationCaseResult = {
  caseId: string;
  passed: boolean;
  expectedSha256: string;
  actualSha256: string;
  projectionSha256: string;
  expectedRelationKeys: string[];
  actualRelationKeys: string[];
};

export type WorkRelationEvaluationMetrics = {
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
  falseIdentityMergeCount: number;
  unsupportedRelationEmissionCount: number;
  unsupportedAuthorityEmissionCount: number;
  titleOnlyObservationLeakageCount: number;
  projectOnlyObservationLeakageCount: number;
  supersededAsCurrentLeakageCount: number;
  conflictAttentionLeakageCount: number;
  lifecycleOnlyProducesLeakageCount: number;
  unsupportedRunResolvedCount: number;
  permutationDeterminismFailureCount: number;
  privacySentinelLeakageCount: number;
};

export type WorkRelationEvaluationRecord = {
  contract: typeof WORK_RELATION_EVALUATION_RUN_RECORD_CONTRACT;
  runId: string;
  comparisonRunId: null;
  comparisonReason: "INITIAL_TARGETED_DEV_CANDIDATE_BASELINE";
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  dataset: {
    version: "suggestion-work-relation-dev-v0.1";
    revision: 1;
    class: "dev_candidate";
    lifecycle: "mutable";
    inputBoundary: "work_relation_resolution_inputs";
    canonicalSha256: string;
    materializedInputSha256: string;
    caseCount: number;
  };
  versions: {
    datasetSchemaVersion: typeof WORK_RELATION_EVALUATION_CASE_SCHEMA_VERSION;
    projectionContract: typeof MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT;
    relationSchemaVersion: typeof WORK_RELATION_SCHEMA_VERSION;
    resolverVersion: typeof MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION;
    evidencePolicyVersion: typeof WORK_RELATION_EVIDENCE_POLICY_VERSION;
  };
  resolverConfig: WorkRelationEvaluationDataset["resolverConfig"];
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
  metrics: WorkRelationEvaluationMetrics;
  cases: WorkRelationCaseResult[];
  deterministicOutputSha256: string;
  errors: Array<{
    caseId: string;
    code: "WORK_RELATION_EXACT_MISMATCH";
  }>;
  attentionDisposition: "not_connected";
  privacyClass: "synthetic_sanitized_metadata";
};

export function loadWorkRelationEvaluationDataset(
  input: unknown
): WorkRelationEvaluationDataset {
  const dataset = workRelationEvaluationDatasetSchema.parse(input);
  const configSha256 = sha256Canonical(resolverConfigArtifact);
  const configVersion =
    typeof resolverConfigArtifact.version === "string"
      ? resolverConfigArtifact.version
      : null;
  if (
    dataset.resolverConfig.sha256 !== configSha256 ||
    dataset.resolverConfig.version !== configVersion
  ) {
    throw new Error(
      "Work relation resolver evaluation config integrity check failed."
    );
  }
  return dataset;
}

export const workRelationEvaluationDataset =
  loadWorkRelationEvaluationDataset(datasetArtifact);

export const WORK_RELATION_DATASET_SHA256 = sha256Canonical(
  workRelationEvaluationDataset
);

export function materializeWorkRelationEvaluationCase(
  evaluationCase: WorkRelationEvaluationCase
): MaterializedWorkRelationCase {
  const fixture = buildFixture(evaluationCase.scenario);
  return {
    evaluationCase,
    input: fixture.input,
    expectedRelations: fixture.expectedRelations
  };
}

export function materializeWorkRelationEvaluationDataset(
  dataset: WorkRelationEvaluationDataset =
    workRelationEvaluationDataset
): MaterializedWorkRelationCase[] {
  return dataset.cases.map(materializeWorkRelationEvaluationCase);
}

export function runWorkRelationEvaluation(input?: {
  startedAt?: Date;
  completedAt?: Date;
  code?: WorkRelationEvaluationRecord["code"];
  dataset?: WorkRelationEvaluationDataset;
}): WorkRelationEvaluationRecord {
  const startedAt = input?.startedAt ?? new Date();
  const dataset = input?.dataset ?? workRelationEvaluationDataset;
  const materialized = materializeWorkRelationEvaluationDataset(dataset);
  const materializedInputSha256 = sha256Canonical(
    materialized.map((item) => ({
      caseId: item.evaluationCase.caseId,
      sourceRevision: dataset.datasetRevision,
      scenario: item.evaluationCase.scenario,
      input: item.input
    }))
  );
  const evaluated = materialized.map(evaluateCase);
  const cases = evaluated.map(({ projection: _projection, ...item }) => item);
  const metrics = computeMetrics(evaluated, dataset);
  const errors = cases
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: "WORK_RELATION_EXACT_MISMATCH" as const
    }));
  const deterministicOutputSha256 = sha256Canonical({
    datasetSha256: sha256Canonical(dataset),
    materializedInputSha256,
    versions: {
      projection: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
      schema: WORK_RELATION_SCHEMA_VERSION,
      resolver: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
      evidence: WORK_RELATION_EVIDENCE_POLICY_VERSION
    },
    metrics,
    cases
  });
  const completedAt = input?.completedAt ?? new Date();
  const status =
    errors.length === 0 && workRelationReleaseGatesPass(metrics)
      ? "passed"
      : "failed";

  return {
    contract: WORK_RELATION_EVALUATION_RUN_RECORD_CONTRACT,
    runId: createWorkRelationEvaluationRunId(),
    comparisonRunId: null,
    comparisonReason: "INITIAL_TARGETED_DEV_CANDIDATE_BASELINE",
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    latencyMs: Math.max(
      0,
      completedAt.getTime() - startedAt.getTime()
    ),
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
      datasetSchemaVersion: WORK_RELATION_EVALUATION_CASE_SCHEMA_VERSION,
      projectionContract:
        MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
      relationSchemaVersion: WORK_RELATION_SCHEMA_VERSION,
      resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
      evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION
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

export function workRelationReleaseGatesPass(
  metrics: WorkRelationEvaluationMetrics
): boolean {
  return (
    metrics.exactCasePassCount === metrics.caseCount &&
    metrics.relationFalsePositiveCount === 0 &&
    metrics.relationFalseNegativeCount === 0 &&
    metrics.falseIdentityMergeCount === 0 &&
    metrics.unsupportedRelationEmissionCount === 0 &&
    metrics.unsupportedAuthorityEmissionCount === 0 &&
    metrics.titleOnlyObservationLeakageCount === 0 &&
    metrics.projectOnlyObservationLeakageCount === 0 &&
    metrics.supersededAsCurrentLeakageCount === 0 &&
    metrics.conflictAttentionLeakageCount === 0 &&
    metrics.lifecycleOnlyProducesLeakageCount === 0 &&
    metrics.unsupportedRunResolvedCount === 0 &&
    metrics.permutationDeterminismFailureCount === 0 &&
    metrics.privacySentinelLeakageCount === 0
  );
}

export function createWorkRelationEvaluationRunId(): string {
  return `relation_run_${randomBytes(16).toString("hex")}`;
}

function evaluateCase(
  item: MaterializedWorkRelationCase
): WorkRelationCaseResult & {
  projection: ManagedCodexWorkRelationProjection;
} {
  const projection = resolveManagedCodexWorkRelations(item.input);
  managedCodexWorkRelationProjectionSchema.parse(projection);
  const expected = expectedSemantics(item);
  const actual = normalizedSemantics(projection);
  const expectedSha256 = sha256Canonical(expected);
  const actualSha256 = sha256Canonical(actual);
  return {
    caseId: item.evaluationCase.caseId,
    passed: expectedSha256 === actualSha256,
    expectedSha256,
    actualSha256,
    projectionSha256: projection.projectionSha256,
    expectedRelationKeys: expected.relations.map(relationKey),
    actualRelationKeys: actual.relations.map(relationKey),
    projection
  };
}

function expectedSemantics(item: MaterializedWorkRelationCase) {
  const expected = item.evaluationCase.expected;
  return {
    invariants: workRelationEvaluationDataset.expectedInvariants,
    totalManagedRunCount: expected.resolutionCount,
    omittedManagedRunCount: 0,
    statuses: expected.statuses,
    relations: item.expectedRelations.map((identity, index) => ({
      ...identity,
      type: "executes" as const,
      authority: "user_configured" as const,
      bindingState: expected.bindingStates[index],
      githubStatus: expected.githubStatuses[index],
      githubCompleteness: expected.githubCompleteness[index],
      projectAlignment: expected.projectAlignments[index],
      identityStatus: expected.identityStatuses[index],
      conflictCodes: expected.conflictCodes[index]
    }))
  };
}

export function normalizedSemantics(
  projection: ManagedCodexWorkRelationProjection
) {
  return {
    invariants: {
      relationType: projection.relations.every(
        (relation) => relation.type === "executes"
      )
        ? ("executes" as const)
        : ("invalid" as const),
      authority: projection.relations.every(
        (relation) => relation.authority === "user_configured"
      )
        ? ("user_configured" as const)
        : ("invalid" as const),
      attentionDisposition: projection.attentionDisposition,
      forbiddenAsAttentionCandidate:
        projection.forbiddenAsAttentionCandidate
    },
    totalManagedRunCount: projection.totalManagedRunCount,
    omittedManagedRunCount: projection.omittedManagedRunCount,
    statuses: projection.runResolutions.map(
      (resolution) => resolution.status
    ),
    relations: projection.relations.map((relation) => ({
      relationId: relation.relationId,
      bindingId: relation.bindingId,
      managedRunIds: relation.managedRunIds,
      fromSubjectId: relation.from.subjectId,
      toSubjectId: relation.to.subjectId,
      boundAt: relation.bindingEvidence.boundAt,
      type: relation.type,
      authority: relation.authority,
      bindingState: relation.bindingEvidence.bindingState,
      githubStatus: relation.githubObservation.status,
      githubCompleteness: relation.githubObservation.completeness,
      projectAlignment: relation.projectAlignment.status,
      identityStatus: relation.identityStatus,
      conflictCodes: relation.conflictCodes
    }))
  };
}

function relationKey(relation: {
  relationId: string;
  bindingId: string;
  fromSubjectId: string;
  toSubjectId: string;
}): string {
  return [
    relation.relationId,
    relation.bindingId,
    relation.fromSubjectId,
    relation.toSubjectId
  ].join("|");
}

function computeMetrics(
  evaluated: Array<
    WorkRelationCaseResult & {
      projection: ManagedCodexWorkRelationProjection;
    }
  >,
  dataset: WorkRelationEvaluationDataset
): WorkRelationEvaluationMetrics {
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
  const outputByScenario = new Map(
    evaluated.map((item) => [
      caseById.get(item.caseId)?.scenario,
      normalizedSemantics(item.projection)
    ])
  );
  const canonicalMulti = outputByScenario.get("two_independent_runs");
  const reversedMulti = outputByScenario.get("reversed_managed_run_input");

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
    falseIdentityMergeCount: evaluated.reduce((count, item) => {
      const expected = new Set(item.expectedRelationKeys);
      return (
        count +
        item.actualRelationKeys.filter((key) => !expected.has(key)).length
      );
    }, 0),
    unsupportedRelationEmissionCount: evaluated.reduce(
      (count, item) =>
        count +
        item.projection.relations.filter(
          (relation) => relation.type !== "executes"
        ).length,
      0
    ),
    unsupportedAuthorityEmissionCount: evaluated.reduce(
      (count, item) =>
        count +
        item.projection.relations.filter(
          (relation) => relation.authority !== "user_configured"
        ).length,
      0
    ),
    titleOnlyObservationLeakageCount: observationLeakageCount(
      evaluated,
      caseById,
      "title_only_guard"
    ),
    projectOnlyObservationLeakageCount: observationLeakageCount(
      evaluated,
      caseById,
      "project_only_guard"
    ),
    supersededAsCurrentLeakageCount: evaluated.reduce((count, item) => {
      const fixture = caseById.get(item.caseId);
      if (!fixture?.labels.includes("superseded_binding")) return count;
      return (
        count +
        item.projection.relations.filter(
          (relation) => relation.bindingEvidence.bindingState === "active"
        ).length
      );
    }, 0),
    conflictAttentionLeakageCount: evaluated.reduce(
      (count, item) =>
        count +
        item.projection.relations.filter(
          (relation) =>
            relation.conflictCodes.length > 0 &&
            (relation.attentionDisposition !== "not_connected" ||
              !relation.forbiddenAsAttentionCandidate)
        ).length,
      0
    ),
    lifecycleOnlyProducesLeakageCount: evaluated.reduce((count, item) => {
      const fixture = caseById.get(item.caseId);
      if (!fixture?.labels.includes("lifecycle_only_produces_guard")) {
        return count;
      }
      return (
        count +
        item.projection.relations.filter(
          (relation) => relation.type !== "executes"
        ).length
      );
    }, 0),
    unsupportedRunResolvedCount: evaluated.reduce((count, item) => {
      const fixture = caseById.get(item.caseId);
      if (!fixture?.labels.includes("hard_negative")) return count;
      return (
        count +
        item.projection.runResolutions.filter(
          (resolution) => resolution.status === "resolved"
        ).length
      );
    }, 0),
    permutationDeterminismFailureCount:
      canonicalMulti &&
      reversedMulti &&
      sha256Canonical(canonicalMulti) === sha256Canonical(reversedMulti)
        ? 0
        : 1,
    privacySentinelLeakageCount: evaluated.reduce((count, item) => {
      const serialized = JSON.stringify(item.projection);
      return (
        count +
        [PRIVATE_TITLE_SENTINEL, PRIVATE_REPOSITORY_SENTINEL].filter(
          (sentinel) => serialized.includes(sentinel)
        ).length
      );
    }, 0)
  };
}

function observationLeakageCount(
  evaluated: Array<
    WorkRelationCaseResult & {
      projection: ManagedCodexWorkRelationProjection;
    }
  >,
  caseById: Map<string, WorkRelationEvaluationCase>,
  label: string
): number {
  return evaluated.reduce((count, item) => {
    const fixture = caseById.get(item.caseId);
    if (!fixture?.labels.includes(label)) return count;
    return (
      count +
      item.projection.relations.filter(
        (relation) =>
          relation.githubObservation.status !== "not_observed"
      ).length
    );
  }, 0);
}

type Scenario = z.infer<typeof scenarioSchema>;
type GitHubMode = "fresh" | "stale" | "truncated" | "unavailable";
type GitHubTaskSpec = {
  objectId: number;
  repositoryId: number;
  taskKind:
    | "assigned_issue"
    | "review_requested_pull_request"
    | "authored_pull_request";
  number: number;
  title: string;
  destinationPath: string;
};
type RunSpec = {
  managedRunId: string;
  decision: WorkSessionBindingDecision | null;
  bindingId: string;
  executionId: string;
  style: "running" | "completed" | "file_change";
  observedAt: string;
};

function buildFixture(scenario: Scenario): {
  input: Parameters<typeof resolveManagedCodexWorkRelations>[0];
  expectedRelations: ExpectedRelationIdentity[];
} {
  let taskSource: "github" | "notion" | "manual" = "github";
  let taskSubjectId = GITHUB_SUBJECT_1;
  let taskKind: GitHubTaskSpec["taskKind"] = "assigned_issue";
  let githubMode: GitHubMode = "fresh";
  let githubTasks: GitHubTaskSpec[] = [
    githubTaskSpec({ taskKind })
  ];
  let mappingMode:
    | "aligned"
    | "codex_unmapped"
    | "github_unmapped"
    | "conflict"
    | "proposals"
    | "removed" = "aligned";
  let bindingLifecycle: "active" | "rebind" | "unbind" = "active";
  let runStyle: RunSpec["style"] = "running";
  let missingBinding = false;
  let executionMismatch = false;
  let runUsesUnbindDecision = false;
  let twoIndependentRuns = false;
  let reverseRunInput = false;
  let twoRunsShareBinding = false;

  switch (scenario) {
    case "active_aligned_pull_request":
      taskKind = "review_requested_pull_request";
      githubTasks = [
        githubTaskSpec({
          taskKind,
          number: 22,
          destinationPath: "pull/22"
        })
      ];
      break;
    case "duplicate_exact_github_observation": {
      const duplicate = githubTaskSpec({ taskKind });
      githubTasks = [duplicate, { ...duplicate }];
      break;
    }
    case "target_not_observed":
      githubTasks = [];
      break;
    case "stale_github_observation":
      githubMode = "stale";
      break;
    case "truncated_github_observation":
      githubMode = "truncated";
      break;
    case "superseded_by_rebind":
      bindingLifecycle = "rebind";
      break;
    case "superseded_by_unbind":
      bindingLifecycle = "unbind";
      break;
    case "binding_decision_missing":
      missingBinding = true;
      break;
    case "execution_identity_mismatch":
      executionMismatch = true;
      break;
    case "unsupported_notion_task":
      taskSource = "notion";
      taskSubjectId = "notion:task:synthetic-201";
      githubTasks = [];
      break;
    case "unsupported_manual_task":
      taskSource = "manual";
      taskSubjectId = "manual:task:synthetic-201";
      githubTasks = [];
      break;
    case "malformed_github_subject":
      taskSubjectId = "github:issue:201";
      githubTasks = [];
      break;
    case "title_only_other_native_id":
      githubTasks = [
        githubTaskSpec({
          objectId: 202,
          title: PRIVATE_TITLE_SENTINEL
        })
      ];
      break;
    case "project_only_other_native_id":
      githubTasks = [githubTaskSpec({ objectId: 202 })];
      break;
    case "codex_project_unmapped":
      mappingMode = "codex_unmapped";
      break;
    case "github_project_unmapped":
      mappingMode = "github_unmapped";
      break;
    case "confirmed_project_conflict":
      mappingMode = "conflict";
      break;
    case "mapping_proposals_only":
      mappingMode = "proposals";
      break;
    case "removed_project_mappings":
      mappingMode = "removed";
      break;
    case "completed_turn_no_produces":
      runStyle = "completed";
      break;
    case "file_change_no_produces":
      runStyle = "file_change";
      break;
    case "two_independent_runs":
      twoIndependentRuns = true;
      break;
    case "reversed_managed_run_input":
      twoIndependentRuns = true;
      reverseRunInput = true;
      break;
    case "conflicting_github_identity":
      githubTasks = [
        githubTaskSpec({}),
        githubTaskSpec({
          taskKind: "review_requested_pull_request",
          number: 99,
          destinationPath: "pull/99"
        })
      ];
      break;
    case "github_batch_unavailable":
      githubMode = "unavailable";
      break;
    case "run_references_unbind_decision":
      bindingLifecycle = "unbind";
      runUsesUnbindDecision = true;
      break;
    case "two_runs_share_one_binding":
      twoRunsShareBinding = true;
      break;
    case "active_aligned_issue":
      break;
  }

  let bindingStore = createEmptyWorkSessionBindingStore(T0);
  const first = bindWorkSessionDecision(bindingStore, {
    taskRef: {
      kind: "attention_subject",
      source: taskSource,
      subjectId: taskSubjectId,
      displayTitle: PRIVATE_TITLE_SENTINEL
    },
    executionId: EXECUTION_1,
    scopeId: SCOPE_1,
    boundAt: T1,
    explicitUserConfirmation: true
  });
  bindingStore = first.store;
  let lifecycleSuccessor: WorkSessionBindingDecision | null = null;
  if (bindingLifecycle === "rebind") {
    const rebound = bindWorkSessionDecision(bindingStore, {
      taskRef: {
        kind: "attention_subject",
        source: taskSource,
        subjectId: taskSubjectId,
        displayTitle: PRIVATE_TITLE_SENTINEL
      },
      executionId: EXECUTION_2,
      scopeId: SCOPE_2,
      boundAt: T2,
      explicitUserConfirmation: true
    });
    bindingStore = rebound.store;
    lifecycleSuccessor = rebound.decision;
  } else if (bindingLifecycle === "unbind") {
    const unbound = unbindWorkSessionDecision(bindingStore, {
      taskRef: {
        kind: "attention_subject",
        source: taskSource,
        subjectId: taskSubjectId,
        displayTitle: PRIVATE_TITLE_SENTINEL
      },
      unboundAt: T2,
      explicitUserConfirmation: true
    });
    bindingStore = unbound.store;
    lifecycleSuccessor = unbound.decision;
  }

  const runDecision =
    runUsesUnbindDecision && lifecycleSuccessor
      ? lifecycleSuccessor
      : first.decision;
  let runSpecs: RunSpec[] = [
    {
      managedRunId: MANAGED_RUN_1,
      decision: missingBinding ? null : runDecision,
      bindingId: missingBinding
        ? MISSING_BINDING
        : runDecision.bindingId,
      executionId: executionMismatch
        ? EXECUTION_2
        : runDecision.executionId,
      style: runStyle,
      observedAt: AS_OF
    }
  ];

  if (twoIndependentRuns) {
    const second = bindWorkSessionDecision(bindingStore, {
      taskRef: {
        kind: "attention_subject",
        source: "github",
        subjectId: GITHUB_SUBJECT_2,
        displayTitle: PRIVATE_TITLE_SENTINEL
      },
      executionId: EXECUTION_2,
      scopeId: SCOPE_2,
      boundAt: T2,
      explicitUserConfirmation: true
    });
    bindingStore = second.store;
    githubTasks = [
      githubTaskSpec({}),
      githubTaskSpec({
        objectId: 202,
        repositoryId: REPOSITORY_2,
        number: 12,
        destinationPath: "issues/12"
      })
    ];
    runSpecs = [
      {
        managedRunId: MANAGED_RUN_1,
        decision: first.decision,
        bindingId: first.decision.bindingId,
        executionId: first.decision.executionId,
        style: "running",
        observedAt: AS_OF
      },
      {
        managedRunId: MANAGED_RUN_2,
        decision: second.decision,
        bindingId: second.decision.bindingId,
        executionId: second.decision.executionId,
        style: "running",
        observedAt: AS_OF
      }
    ];
    if (reverseRunInput) runSpecs.reverse();
  } else if (twoRunsShareBinding) {
    runSpecs.push({
      ...runSpecs[0]!,
      managedRunId: MANAGED_RUN_2
    });
  }

  const contextRegistry = buildContextRegistry({
    mode: mappingMode,
    bindingStore,
    githubTasks
  });
  const githubBatch = buildGitHubBatch({
    mode: githubMode,
    tasks: githubTasks,
    contextRegistry
  });
  const managedProjection = buildManagedProjection(runSpecs);
  const input = {
    asOf: AS_OF,
    managedProjection,
    bindingStore,
    githubBatch,
    contextRegistry
  };
  const expectedRelations = expectedRelationIdentities(runSpecs);

  return { input, expectedRelations };
}

function githubTaskSpec(
  overrides: Partial<GitHubTaskSpec>
): GitHubTaskSpec {
  return {
    objectId: 201,
    repositoryId: REPOSITORY_1,
    taskKind: "assigned_issue",
    number: 11,
    title: PRIVATE_TITLE_SENTINEL,
    destinationPath: "issues/11",
    ...overrides
  };
}

function buildContextRegistry(input: {
  mode:
    | "aligned"
    | "codex_unmapped"
    | "github_unmapped"
    | "conflict"
    | "proposals"
    | "removed";
  bindingStore: WorkSessionBindingStore;
  githubTasks: GitHubTaskSpec[];
}): WorkContextRegistry {
  let registry = createEmptyWorkContextRegistry(T0);
  registry = createProjectIdentity(registry, {
    createdAt: T0,
    projectId: PROJECT_A
  }).registry;
  registry = createProjectIdentity(registry, {
    createdAt: T0,
    projectId: PROJECT_B
  }).registry;
  const codexScopes = unique(
    input.bindingStore.decisions.map((decision) => decision.scopeId)
  ).map(
    (opaqueId): SourceScopeRef => ({
      source: "codex",
      resourceType: "scope",
      opaqueId
    })
  );
  const githubScopes = unique(
    input.githubTasks.map((task) => String(task.repositoryId))
  ).map(
    (opaqueId): SourceScopeRef => ({
      source: "github",
      resourceType: "repository",
      opaqueId
    })
  );

  if (input.mode === "proposals") {
    for (const scope of [...codexScopes, ...githubScopes]) {
      registry = proposeProjectMapping(registry, {
        scope,
        suggestedProjectId: PROJECT_A,
        proposedAt: T1,
        basis: "user_workflow_hint"
      }).registry;
    }
    return registry;
  }

  const confirmScopes = (
    scopes: SourceScopeRef[],
    projectId: string
  ) => {
    for (const scope of scopes) {
      registry = confirmProjectMapping(registry, {
        scope,
        projectId,
        confirmedAt: T1,
        explicitUserConfirmation: true
      }).registry;
    }
  };

  if (input.mode !== "codex_unmapped") {
    confirmScopes(codexScopes, PROJECT_A);
  }
  if (input.mode !== "github_unmapped") {
    confirmScopes(
      githubScopes,
      input.mode === "conflict" ? PROJECT_B : PROJECT_A
    );
  }
  if (input.mode === "removed") {
    for (const scope of [...codexScopes, ...githubScopes]) {
      registry = removeProjectMapping(registry, {
        scope,
        removedAt: T2,
        explicitUserConfirmation: true
      }).registry;
    }
  }
  return registry;
}

function buildGitHubBatch(input: {
  mode: GitHubMode;
  tasks: GitHubTaskSpec[];
  contextRegistry: WorkContextRegistry;
}): RuntimeWorkSignalBatch | null {
  if (input.mode === "unavailable") return null;
  const sourceSnapshotSha256 = runtimeSha256({
    domain: "work-relation-synthetic-github-snapshot-v0.1",
    mode: input.mode,
    tasks: input.tasks
  });
  const fetchedAt = T1;
  const completeness = input.mode === "truncated" ? "partial" : "complete";
  const signals = input.tasks.map((task) => {
    const subjectId = `github:object:${task.objectId}`;
    const sourceScopeId = `repository:${task.repositoryId}`;
    const scope: SourceScopeRef = {
      source: "github",
      resourceType: "repository",
      opaqueId: String(task.repositoryId)
    };
    const objectType =
      task.taskKind === "assigned_issue" ? "issue" : "pull_request";
    const semanticRole =
      task.taskKind === "authored_pull_request"
        ? "context_only"
        : "direct_work_item";
    const eligibilityLimit =
      task.taskKind === "assigned_issue"
        ? "none"
        : task.taskKind === "review_requested_pull_request"
          ? "draft_state_unknown"
          : "not_actionable_by_source_kind";
    const queryKind =
      task.taskKind === "assigned_issue"
        ? "assigned_open_issue"
        : task.taskKind === "review_requested_pull_request"
          ? "review_requested_open_pr"
          : "authored_open_pr";
    const relationship =
      task.taskKind === "assigned_issue"
        ? "assigned_to_user"
        : task.taskKind === "review_requested_pull_request"
          ? "review_requested_from_user"
          : "authored_by_user";
    return finalizeRuntimeWorkSignal({
      contract: RUNTIME_WORK_SIGNAL_CONTRACT,
      sourceSnapshotSha256,
      normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
      source: "github",
      subjectId,
      subjectType: "work_item",
      sourceScopeId,
      projectId: lookupProjectId(input.contextRegistry, scope),
      kind: "work_item_observation",
      facts: {
        objectType,
        taskKind: task.taskKind,
        state: "open",
        relationship,
        semanticRole,
        eligibilityLimit,
        draftState:
          task.taskKind === "assigned_issue"
            ? "not_applicable"
            : "unknown",
        repositoryFullName: PRIVATE_REPOSITORY_SENTINEL,
        number: task.number,
        title: task.title,
        destinationUrl: `https://github.com/synthetic/project/${task.destinationPath}`
      },
      observedAt: fetchedAt,
      sourceUpdatedAt: T1,
      validUntil: null,
      directness: "explicit",
      completeness:
        input.mode === "truncated" ? "truncated" : "complete",
      attentionCapability:
        semanticRole === "context_only"
          ? "overview_only"
          : "candidate_input",
      evidence: [
        {
          type: "github_query_membership",
          source: "github",
          queryKind,
          objectId: String(task.objectId),
          snapshotSha256: sourceSnapshotSha256,
          subjectId,
          observedAt: fetchedAt,
          sourceUpdatedAt: T1
        },
        {
          type: "github_object_field",
          source: "github",
          objectId: String(task.objectId),
          field: "state",
          valueSha256: runtimeSha256({ state: "open" }),
          snapshotSha256: sourceSnapshotSha256,
          subjectId,
          observedAt: fetchedAt,
          sourceUpdatedAt: T1
        }
      ]
    });
  });
  const freshness = input.mode === "stale" ? "stale" : "fresh";
  const reasonCodes = [
    ...(freshness === "fresh" ? ["SNAPSHOT_FRESH" as const] : []),
    ...(freshness === "stale" ? ["SNAPSHOT_STALE" as const] : []),
    ...(input.mode === "truncated"
      ? ["SNAPSHOT_TRUNCATED" as const]
      : [])
  ];
  return finalizeRuntimeWorkSignalBatch({
    contract: RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
    source: "github",
    sourceSchemaVersion: "github-snapshot-v2",
    collectorVersion: "github-app-api-v1",
    normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
    workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256,
    normalizationInputSha256: runtimeSha256({
      domain: "work-relation-synthetic-normalization-input-v0.1",
      sourceSnapshotSha256,
      mode: input.mode
    }),
    assessment: {
      contract: RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
      source: "github",
      asOf: AS_OF,
      fetchedAt,
      freshnessPolicyVersion: SNAPSHOT_VALIDITY_POLICY_VERSION,
      freshness,
      completeness,
      truncated: input.mode === "truncated",
      candidateSetComplete:
        freshness === "fresh" && input.mode !== "truncated",
      usableForOverview: true,
      usableForCurrentCandidates:
        freshness === "fresh" && input.mode !== "truncated",
      reasonCodes
    },
    skippedRecordCount: 0,
    issues: [],
    signals
  });
}

function buildManagedProjection(
  runs: RunSpec[]
): ManagedCodexPublicProjection {
  return managedCodexPublicProjectionSchema.parse({
    contract: CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT,
    revision: 1,
    generatedAt: AS_OF,
    runs: runs.map((run) => {
      const completed = run.style === "completed";
      return {
        managedRunId: run.managedRunId,
        bindingId: run.bindingId,
        executionId: run.executionId,
        lifecycle: completed ? "ended" : "observing",
        streamState: completed ? "closed" : "connected",
        continuity: "continuous",
        effectiveExecutionState: completed ? "completed" : "running",
        lastVerifiedExecutionState: completed ? "completed" : "running",
        waitingState: null,
        sourceEvent:
          run.style === "completed"
            ? "turn_completed"
            : run.style === "file_change"
              ? "item_completed"
              : "thread_status_changed",
        itemType: run.style === "file_change" ? "file_change" : null,
        lastObservedAt: run.observedAt,
        liveObservationAvailable: !completed,
        forbiddenAsAttentionCandidate: true
      };
    })
  });
}

function expectedRelationIdentities(
  runs: RunSpec[]
): ExpectedRelationIdentity[] {
  const byBinding = new Map<string, ExpectedRelationIdentity>();
  for (const run of runs) {
    const decision = run.decision;
    if (
      !decision ||
      decision.action !== "bind" ||
      decision.bindingId !== run.bindingId ||
      decision.executionId !== run.executionId ||
      decision.taskRef.source !== "github" ||
      !/^github:object:[1-9][0-9]*$/.test(decision.taskRef.subjectId)
    ) {
      continue;
    }
    const from = {
      kind: "execution" as const,
      source: "codex" as const,
      subjectId: decision.executionId
    };
    const to = {
      kind: "work_item" as const,
      source: "github" as const,
      subjectId: decision.taskRef.subjectId
    };
    const existing = byBinding.get(decision.bindingId);
    if (existing) {
      existing.managedRunIds = unique([
        ...existing.managedRunIds,
        run.managedRunId
      ]).sort();
      continue;
    }
    byBinding.set(decision.bindingId, {
      relationId: runtimeStableId(
        "relation",
        MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
        {
          bindingId: decision.bindingId,
          type: "executes",
          from,
          to
        }
      ),
      bindingId: decision.bindingId,
      managedRunIds: [run.managedRunId],
      fromSubjectId: decision.executionId,
      toSubjectId: decision.taskRef.subjectId,
      boundAt: decision.decidedAt
    });
  }
  return [...byBinding.values()].sort((left, right) =>
    left.relationId.localeCompare(right.relationId)
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
