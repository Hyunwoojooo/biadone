import { describe, expect, it } from "vitest";

import {
  createGitHubArtifactId,
  managedCodexArtifactRelationProjectionSchema,
  pruneWorkArtifactAttributionStore,
  resolveManagedCodexArtifactRelations,
  WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS
} from "../src/artifacts";
import {
  ARTIFACT_RELATION_CONFIG_SHA256,
  ARTIFACT_RELATION_DATASET_SHA256,
  PHASE3A_WORK_RELATION_DATASET_SHA256,
  artifactRelationEvaluationDataset,
  loadArtifactRelationEvaluationDataset,
  materializeArtifactRelationEvaluationDataset,
  normalizedArtifactRelationSemantics,
  runArtifactRelationEvaluation
} from "../src/evaluation/artifactRelationResolverEvaluation";
import { WORK_RELATION_DATASET_SHA256 } from "../src/evaluation/workRelationResolverEvaluation";

const FIXED_START = new Date("2026-08-01T09:00:00.000Z");
const FIXED_END = new Date("2026-08-01T09:00:00.050Z");

describe("managed Codex artifact relation targeted evaluation", () => {
  it("loads a separate mutable 32-case synthetic Dev Candidate", () => {
    expect(artifactRelationEvaluationDataset).toMatchObject({
      datasetVersion: "suggestion-artifact-relation-dev-v0.1",
      datasetRevision: 1,
      datasetClass: "dev_candidate",
      inputBoundary: "explicit_artifact_attribution_inputs",
      dataOrigin: "synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      },
      expectedInvariants: {
        relationType: "produces",
        authority: "user_configured",
        decisionSource: "explicit_user",
        rawUrlPersisted: false,
        metadataStorage: "local_only",
        metadataRetentionDays: 30,
        attentionDisposition: "not_connected",
        forbiddenAsAttentionCandidate: true
      }
    });
    expect(artifactRelationEvaluationDataset.cases).toHaveLength(32);
    expect(
      new Set(
        artifactRelationEvaluationDataset.cases.map(
          (item) => item.caseId
        )
      ).size
    ).toBe(32);
    expect(ARTIFACT_RELATION_CONFIG_SHA256).toBe(
      "04427b788d092601159be4991ed33981940078d1a66ca8e0fe4bd30487897006"
    );
    expect(ARTIFACT_RELATION_DATASET_SHA256).toBe(
      "fdc9112a5164c63619489304ec8af398cae498597631303ffe6e3cda51f8a2c8"
    );
  });

  it("preserves the committed Phase 3A dataset hash", () => {
    expect(WORK_RELATION_DATASET_SHA256).toBe(
      PHASE3A_WORK_RELATION_DATASET_SHA256
    );
    expect(WORK_RELATION_DATASET_SHA256).toBe(
      "b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002"
    );
  });

  it("keeps PR display number out of the stable native artifact ID", () => {
    const base = {
      kind: "github_pull_request" as const,
      repositoryId: 101,
      objectId: 201
    };
    expect(createGitHubArtifactId({ ...base, number: 22 })).toBe(
      createGitHubArtifactId({ ...base, number: 23 })
    );
    expect(createGitHubArtifactId({ ...base, number: 22 })).not.toBe(
      createGitHubArtifactId({
        ...base,
        repositoryId: 102,
        number: 22
      })
    );
  });

  it("materializes integrity-checked projections without raw private data or Attention eligibility", () => {
    const materialized = materializeArtifactRelationEvaluationDataset();
    expect(materialized).toHaveLength(32);
    for (const item of materialized) {
      if (item.evaluationCase.scenario === "tampered_store_integrity") {
        expect(() =>
          resolveManagedCodexArtifactRelations(item.input)
        ).toThrow();
        continue;
      }
      const projection = resolveManagedCodexArtifactRelations(item.input);
      expect(
        managedCodexArtifactRelationProjectionSchema.parse(projection)
      ).toEqual(projection);
      expect(projection.attentionDisposition).toBe("not_connected");
      expect(projection.forbiddenAsAttentionCandidate).toBe(true);
      expect(
        projection.relations.every(
          (relation) =>
            relation.type === "produces" &&
            relation.authority === "user_configured" &&
            relation.attributionEvidence.decisionSource ===
              "explicit_user" &&
            relation.attentionDisposition === "not_connected" &&
            relation.forbiddenAsAttentionCandidate
        )
      ).toBe(true);
      const persisted = JSON.stringify(item.input.attributionStore);
      const serialized = JSON.stringify(projection);
      expect(persisted).not.toMatch(/https:\/\/github\.com\//u);
      for (const sentinel of [
        "PRIVATE_ARTIFACT_RAW_URL_SENTINEL",
        "PRIVATE_ARTIFACT_REPOSITORY_SENTINEL",
        "PRIVATE_ARTIFACT_TITLE_SENTINEL"
      ]) {
        expect(persisted).not.toContain(sentinel);
        expect(serialized).not.toContain(sentinel);
      }
      for (const privateField of [
        "artifactUrl",
        "prompt",
        "answer",
        "filePath"
      ]) {
        expect(persisted).not.toContain(privateField);
      }
    }
  });

  it("passes exact relations and every Phase 3B release gate", () => {
    const record = runArtifactRelationEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END
    });

    expect(record.status).toBe("passed");
    expect(record.metrics).toEqual({
      caseCount: 32,
      exactCasePassCount: 32,
      exactCasePassRate: 1,
      expectedRelationCount: 23,
      observedRelationCount: 23,
      relationTruePositiveCount: 23,
      relationFalsePositiveCount: 0,
      relationFalseNegativeCount: 0,
      relationPrecision: 1,
      relationRecall: 1,
      hardNegativeLeakageCount: 0,
      invalidIdentityLeakageCount: 0,
      runIdentityLeakageCount: 0,
      sourceLimitationCurrentLeakageCount: 0,
      unsupportedAuthorityEmissionCount: 0,
      attentionLeakageCount: 0,
      privacySentinelLeakageCount: 0,
      storedRawUrlLeakageCount: 0,
      permutationDeterminismFailureCount: 0,
      tamperedStoreAcceptanceCount: 0,
      phase3aDatasetHashMismatchCount: 0
    });
    expect(record.cases.every((item) => item.passed)).toBe(true);
    expect(record.errors).toEqual([]);
    expect(record.dataset.materializedInputSha256).toBe(
      "9c67f337ddbc379e66e4295ddd6cfd1468dd7a78ec61b36db54cfe7852432bf5"
    );
    expect(record.deterministicOutputSha256).toBe(
      "c93da98c113dfe8d9187ba363b43f6c3027c6150396d039480079cab8b3c7d04"
    );
    expect(record.inference).toEqual({
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      tokenUsage: "not_applicable"
    });
  });

  it("uses unique run IDs while preserving deterministic evaluated output", () => {
    const input = {
      startedAt: FIXED_START,
      completedAt: FIXED_END
    };
    const first = runArtifactRelationEvaluation(input);
    const second = runArtifactRelationEvaluation(input);

    expect(first.runId).toMatch(
      /^artifact_relation_run_[a-f0-9]{32}$/
    );
    expect(second.runId).toMatch(
      /^artifact_relation_run_[a-f0-9]{32}$/
    );
    expect(first.runId).not.toBe(second.runId);
    expect(first.deterministicOutputSha256).toBe(
      second.deterministicOutputSha256
    );
    expect(first.dataset.materializedInputSha256).toBe(
      second.dataset.materializedInputSha256
    );
    expect(first.cases).toEqual(second.cases);
  });

  it("keeps independent artifact semantics stable under reversed decision order", () => {
    const materialized = materializeArtifactRelationEvaluationDataset();
    const canonical = materialized.find(
      (item) =>
        item.evaluationCase.scenario === "one_run_multiple_artifacts"
    );
    const reversed = materialized.find(
      (item) =>
        item.evaluationCase.scenario === "reversed_decision_order"
    );
    expect(canonical).toBeDefined();
    expect(reversed).toBeDefined();

    expect(
      normalizedArtifactRelationSemantics(
        resolveManagedCodexArtifactRelations(canonical!.input)
      )
    ).toEqual(
      normalizedArtifactRelationSemantics(
        resolveManagedCodexArtifactRelations(reversed!.input)
      )
    );
  });

  it("rejects dataset/config tampering and keeps the 30-day local retention boundary", () => {
    const badConfig = structuredClone(artifactRelationEvaluationDataset);
    badConfig.resolverConfig.sha256 = "0".repeat(64);
    expect(() =>
      loadArtifactRelationEvaluationDataset(badConfig)
    ).toThrow(/config integrity check failed/);

    const productionData = structuredClone(
      artifactRelationEvaluationDataset
    ) as unknown as Record<string, unknown>;
    productionData.containsProductionData = true;
    expect(() =>
      loadArtifactRelationEvaluationDataset(productionData)
    ).toThrow();

    const materialized = materializeArtifactRelationEvaluationDataset();
    const attached = materialized.find(
      (item) => item.evaluationCase.scenario === "explicit_commit_40"
    );
    expect(attached).toBeDefined();
    expect(WORK_ARTIFACT_ATTRIBUTION_RETENTION_DAYS).toBe(30);
    const pruned = pruneWorkArtifactAttributionStore(
      attached!.input.attributionStore,
      new Date("2026-09-01T06:10:00.001Z")
    );
    expect(pruned.changed).toBe(true);
    expect(pruned.store.decisions).toEqual([]);
    expect(pruned.store.prunedDecisionCount).toBe(1);
  });
});
