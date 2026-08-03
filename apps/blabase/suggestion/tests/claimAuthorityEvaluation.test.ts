import { describe, expect, it } from "vitest";

import {
  CLAIM_AUTHORITY_CONFIG_SHA256,
  CLAIM_AUTHORITY_DATASET_SHA256,
  claimAuthorityEvaluationDataset,
  claimAuthorityReleaseGatesPass,
  claimAuthorityResolverConfig,
  loadClaimAuthorityEvaluationDataset,
  runClaimAuthorityEvaluation
} from "../src/evaluation/claimAuthorityResolverEvaluation";

const FIXED_START = new Date("2026-08-02T03:00:00.000Z");
const FIXED_END = new Date("2026-08-02T03:00:00.050Z");

describe("claim authority targeted evaluation", () => {
  it("loads a separate mutable 40-case synthetic Dev Candidate", () => {
    expect(claimAuthorityEvaluationDataset).toMatchObject({
      datasetVersion: "suggestion-claim-authority-dev-v0.1",
      datasetRevision: 2,
      datasetClass: "dev_candidate",
      inputBoundary: "normalized_claim_resolution_inputs",
      dataOrigin: "synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      },
      expectedInvariants: {
        attentionDisposition: "not_connected",
        forbiddenAsAttentionCandidate: true,
        containsRawPrivateValues: false
      }
    });
    expect(claimAuthorityEvaluationDataset.cases).toHaveLength(40);
    expect(
      new Set(
        claimAuthorityEvaluationDataset.cases.map((item) => item.caseId)
      ).size
    ).toBe(40);
    expect(
      new Set(
        claimAuthorityEvaluationDataset.cases.map((item) => item.scenario)
      ).size
    ).toBe(40);
    expect(CLAIM_AUTHORITY_CONFIG_SHA256).toBe(
      "98ddd2fd399286a89f23737ab7a3fa76cd16e2317150ca78800edcd2bfe63db0"
    );
    expect(CLAIM_AUTHORITY_DATASET_SHA256).toBe(
      "809e459b2e27e26791ce20ba4599450818425b48603ba76cb2a8cad45544fe4d"
    );
  });

  it("preserves the Phase 3A, Phase 3B, and cross-source dataset hashes", () => {
    expect(claimAuthorityEvaluationDataset.dependencyDatasets).toEqual({
      phase3aWorkRelationSha256:
        "b12660720c657123fe6e94b0e4ba6dcf29704f72b90cd5b630ecd8331091b002",
      phase3bArtifactRelationSha256:
        "fdc9112a5164c63619489304ec8af398cae498597631303ffe6e3cda51f8a2c8",
      crossSourceDevSha256:
        "d02a0ca30eb3697b735af34c071c05422e39e97d06c786c5393bde360e53b3df"
    });
  });

  it("passes all exact cases and every release guardrail", () => {
    const record = runClaimAuthorityEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END
    });

    expect(record.status).toBe("passed");
    expect(record.metrics).toEqual({
      caseCount: 40,
      exactCasePassCount: 40,
      exactCasePassRate: 1,
      expectedResolutionCount: 42,
      observedResolutionCount: 42,
      expectedConflictCount: 9,
      observedConflictCount: 9,
      resolutionPrecision: 1,
      resolutionRecall: 1,
      conflictPrecision: 1,
      conflictRecall: 1,
      semanticProjectionMismatchCount: 0,
      wrongAuthorityWinnerCount: 0,
      contextOnlyWinnerCount: 0,
      staleWinnerCount: 0,
      crossDomainConflationCount: 0,
      falseConflictCount: 0,
      missedCriticalConflictCount: 0,
      criticalConflictAutoResolutionCount: 0,
      currentStateFromActivityLeakageCount: 0,
      absenceAsCompletionCount: 0,
      timestampOnlyOverrideCount: 0,
      unsupportedAuthorityAcceptanceCount: 0,
      futureEvidenceAcceptanceCount: 0,
      originalClaimLossCount: 0,
      attentionLeakageCount: 0,
      privacySentinelLeakageCount: 0,
      rawPrivateFieldLeakageCount: 0,
      permutationDeterminismFailureCount: 0,
      phase3aDatasetHashMismatchCount: 0,
      phase3bDatasetHashMismatchCount: 0,
      crossSourceDatasetHashMismatchCount: 0
    });
    expect(claimAuthorityReleaseGatesPass(record.metrics)).toBe(true);
    expect(record.cases.every((item) => item.passed)).toBe(true);
    expect(record.errors).toEqual([]);
    expect(record.dataset.materializedInputSha256).toBe(
      "12f1eb24d6522170e828bfbf406b324d8d2d600b7a9013016d6c6adf95d5f8f1"
    );
    expect(record.deterministicOutputSha256).toBe(
      "34e560c4894f1b84c66348779a804fb014fdd01f28d70088c49a9163ce0a654a"
    );
    expect(record.attentionDisposition).toBe("not_connected");
    expect(record.inference).toEqual({
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      tokenUsage: "not_applicable"
    });
  });

  it("uses unique run IDs while preserving deterministic output", () => {
    const input = {
      startedAt: FIXED_START,
      completedAt: FIXED_END
    };
    const first = runClaimAuthorityEvaluation(input);
    const second = runClaimAuthorityEvaluation(input);

    expect(first.runId).toMatch(/^claim_authority_run_[a-f0-9]{32}$/);
    expect(second.runId).toMatch(/^claim_authority_run_[a-f0-9]{32}$/);
    expect(first.runId).not.toBe(second.runId);
    expect(first.deterministicOutputSha256).toBe(
      second.deterministicOutputSha256
    );
    expect(first.dataset.materializedInputSha256).toBe(
      second.dataset.materializedInputSha256
    );
    expect(first.cases).toEqual(second.cases);
  });

  it("rejects resolver config hash and content tampering", () => {
    const datasetWithWrongConfigHash = structuredClone(
      claimAuthorityEvaluationDataset
    );
    datasetWithWrongConfigHash.resolverConfig.sha256 = "0".repeat(64);
    expect(() =>
      loadClaimAuthorityEvaluationDataset(datasetWithWrongConfigHash)
    ).toThrow(/config integrity/u);

    const tamperedConfig = {
      ...structuredClone(claimAuthorityResolverConfig),
      resolution: {
        ...claimAuthorityResolverConfig.resolution,
        absenceCreatesCompletion: true
      }
    };
    expect(() =>
      loadClaimAuthorityEvaluationDataset(
        claimAuthorityEvaluationDataset,
        tamperedConfig
      )
    ).toThrow();
  });

  it("rejects semantic dataset drift under the same version", () => {
    const tampered = structuredClone(claimAuthorityEvaluationDataset);
    tampered.cases[0].expected.winnerSources = [];
    const loaded = loadClaimAuthorityEvaluationDataset(tampered);
    const record = runClaimAuthorityEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END,
      dataset: loaded
    });

    expect(record.dataset.canonicalSha256).not.toBe(
      CLAIM_AUTHORITY_DATASET_SHA256
    );
    expect(record.status).toBe("failed");
    expect(record.errors).toContainEqual({
      caseId: "CLAIM-DEV-001",
      code: "CLAIM_AUTHORITY_EXACT_MISMATCH"
    });
  });
});
