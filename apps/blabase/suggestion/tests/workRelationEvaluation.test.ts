import { describe, expect, it } from "vitest";

import {
  WORK_RELATION_DATASET_SHA256,
  loadWorkRelationEvaluationDataset,
  materializeWorkRelationEvaluationDataset,
  normalizedSemantics,
  runWorkRelationEvaluation,
  workRelationEvaluationDataset
} from "../src/evaluation/workRelationResolverEvaluation";
import {
  managedCodexWorkRelationProjectionSchema,
  resolveManagedCodexWorkRelations
} from "../src/relations";

const FIXED_START = new Date("2026-08-01T07:00:00.000Z");
const FIXED_END = new Date("2026-08-01T07:00:00.025Z");

describe("managed Codex work relation targeted evaluation", () => {
  it("loads a separate mutable synthetic resolver dataset", () => {
    expect(workRelationEvaluationDataset).toMatchObject({
      datasetVersion: "suggestion-work-relation-dev-v0.1",
      datasetRevision: 1,
      datasetClass: "dev_candidate",
      inputBoundary: "work_relation_resolution_inputs",
      dataOrigin: "synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      }
    });
    expect(workRelationEvaluationDataset.cases).toHaveLength(28);
    expect(
      new Set(
        workRelationEvaluationDataset.cases.map((item) => item.caseId)
      ).size
    ).toBe(28);
    expect(WORK_RELATION_DATASET_SHA256).toBe(
      "b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002"
    );
  });

  it("materializes strict, integrity-checked resolver inputs and projections", () => {
    const materialized = materializeWorkRelationEvaluationDataset();
    expect(materialized).toHaveLength(28);
    for (const item of materialized) {
      const projection = resolveManagedCodexWorkRelations(item.input);
      expect(
        managedCodexWorkRelationProjectionSchema.parse(projection)
      ).toEqual(projection);
      expect(projection.attentionDisposition).toBe("not_connected");
      expect(projection.forbiddenAsAttentionCandidate).toBe(true);
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain("PRIVATE_RELATION_TITLE_SENTINEL");
      expect(serialized).not.toContain(
        "PRIVATE_RELATION_REPOSITORY_SENTINEL"
      );
      expect(serialized).not.toContain("prompt");
      expect(serialized).not.toContain("answer");
      expect(serialized).not.toContain("filePath");
    }
  });

  it("passes exact semantics and every hard-negative metric gate", () => {
    const record = runWorkRelationEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END
    });

    expect(record.status).toBe("passed");
    expect(record.metrics).toEqual({
      caseCount: 28,
      exactCasePassCount: 28,
      exactCasePassRate: 1,
      expectedRelationCount: 24,
      observedRelationCount: 24,
      relationTruePositiveCount: 24,
      relationFalsePositiveCount: 0,
      relationFalseNegativeCount: 0,
      relationPrecision: 1,
      relationRecall: 1,
      falseIdentityMergeCount: 0,
      unsupportedRelationEmissionCount: 0,
      unsupportedAuthorityEmissionCount: 0,
      titleOnlyObservationLeakageCount: 0,
      projectOnlyObservationLeakageCount: 0,
      supersededAsCurrentLeakageCount: 0,
      conflictAttentionLeakageCount: 0,
      lifecycleOnlyProducesLeakageCount: 0,
      unsupportedRunResolvedCount: 0,
      permutationDeterminismFailureCount: 0,
      privacySentinelLeakageCount: 0
    });
    expect(record.cases.every((item) => item.passed)).toBe(true);
    expect(record.errors).toEqual([]);
    expect(record.dataset.materializedInputSha256).toBe(
      "7d43dd080f3730cf45557448ba57728632def4fabf30683c8729caf314d8424f"
    );
    expect(record.deterministicOutputSha256).toBe(
      "bbf9d6a97090b44a464d362fee24cceb97b89b7a265baa2d8be30c454b1776a4"
    );
    expect(record.inference).toEqual({
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      tokenUsage: "not_applicable"
    });
  });

  it("uses unique run IDs while keeping evaluated output deterministic", () => {
    const input = {
      startedAt: FIXED_START,
      completedAt: FIXED_END
    };
    const first = runWorkRelationEvaluation(input);
    const second = runWorkRelationEvaluation(input);

    expect(first.runId).toMatch(/^relation_run_[a-f0-9]{32}$/);
    expect(second.runId).toMatch(/^relation_run_[a-f0-9]{32}$/);
    expect(first.runId).not.toBe(second.runId);
    expect(first.deterministicOutputSha256).toBe(
      second.deterministicOutputSha256
    );
    expect(first.dataset.materializedInputSha256).toBe(
      second.dataset.materializedInputSha256
    );
    expect(first.cases).toEqual(second.cases);
  });

  it("keeps reversed managed input semantically deterministic", () => {
    const materialized = materializeWorkRelationEvaluationDataset();
    const ordered = materialized.find(
      (item) => item.evaluationCase.scenario === "two_independent_runs"
    );
    const reversed = materialized.find(
      (item) =>
        item.evaluationCase.scenario === "reversed_managed_run_input"
    );
    expect(ordered).toBeDefined();
    expect(reversed).toBeDefined();
    expect(
      normalizedSemantics(
        resolveManagedCodexWorkRelations(ordered!.input)
      )
    ).toEqual(
      normalizedSemantics(
        resolveManagedCodexWorkRelations(reversed!.input)
      )
    );
  });

  it("rejects a resolver config reference whose hash changed", () => {
    const tampered = structuredClone(workRelationEvaluationDataset);
    tampered.resolverConfig.sha256 = "0".repeat(64);
    expect(() => loadWorkRelationEvaluationDataset(tampered)).toThrow(
      /config integrity check failed/
    );
  });
});
