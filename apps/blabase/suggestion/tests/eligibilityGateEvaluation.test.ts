import { describe, expect, it } from "vitest";

import {
  ATTENTION_ELIGIBILITY_CONFIG_SHA256,
  ATTENTION_ELIGIBILITY_DATASET_SHA256,
  attentionEligibilityEvaluationConfig,
  attentionEligibilityEvaluationDataset,
  attentionEligibilityReleaseGatesPass,
  loadAttentionEligibilityEvaluationDataset,
  runAttentionEligibilityEvaluation
} from "../src/evaluation/eligibilityGateEvaluation";

const FIXED_START = new Date("2026-08-02T03:00:00.000Z");
const FIXED_END = new Date("2026-08-02T03:00:00.050Z");

describe("Phase 4A attention eligibility targeted evaluation", () => {
  it("loads a separate mutable 26-case synthetic Dev Candidate", () => {
    expect(attentionEligibilityEvaluationDataset).toMatchObject({
      datasetVersion: "suggestion-attention-eligibility-dev-v0.1",
      datasetRevision: 2,
      datasetClass: "dev_candidate",
      inputBoundary: "exact_phase3_evidence_graph",
      dataOrigin: "synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      },
      expectedInvariants: {
        mode: "shadow",
        attentionSelectionEffect: "none",
        attentionDisposition: "shadow_only",
        forbiddenAsAttentionCandidate: true,
        containsRawPrivateValues: false
      }
    });
    expect(attentionEligibilityEvaluationDataset.cases).toHaveLength(26);
    expect(
      new Set(
        attentionEligibilityEvaluationDataset.cases.map(
          (item) => item.caseId
        )
      ).size
    ).toBe(26);
    expect(
      new Set(
        attentionEligibilityEvaluationDataset.cases.map(
          (item) => item.scenario
        )
      ).size
    ).toBe(26);
    expect(
      Object.keys(
        attentionEligibilityEvaluationDataset
          .expectedProjectionSha256ByCase
      )
    ).toHaveLength(26);
    expect(ATTENTION_ELIGIBILITY_CONFIG_SHA256).toBe(
      "33c2719e45d6d3715053c44e87f5d5e36317f0457e3ee939ca76aa36c53a2e57"
    );
    expect(ATTENTION_ELIGIBILITY_DATASET_SHA256).toBe(
      "7e53abbdf7ccf64ec30152c3fdd0c08161db10f5e2b191286745cbe729bb0343"
    );
  });

  it("passes all exact cases and every hard-negative guardrail", () => {
    const record = runAttentionEligibilityEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END
    });

    expect(record.status).toBe("passed");
    expect(record.metrics).toEqual({
      caseCount: 26,
      exactCasePassCount: 26,
      exactCasePassRate: 1,
      expectedAssessmentCount: 24,
      observedAssessmentCount: 24,
      assessmentPrecision: 1,
      assessmentRecall: 1,
      projectionHashMismatchCount: 0,
      unsafeEligibleCount: 0,
      wrongReviewRouteCount: 0,
      userConflictAutoEligibilityCount: 0,
      refreshConflictUserMisrouteCount: 0,
      unrelatedConflictBlockingCount: 0,
      absenceCandidateLeakageCount: 0,
      dependencyFailOpenCount: 0,
      batchIntegrityFailOpenCount: 0,
      attentionSelectionLeakageCount: 0,
      attentionCandidateLeakageCount: 0,
      privacySentinelLeakageCount: 0,
      rawPrivateFieldLeakageCount: 0,
      canonicalOrderingFailureCount: 0,
      determinismFailureCount: 0,
      configIntegrityFailureCount: 0
    });
    expect(attentionEligibilityReleaseGatesPass(record.metrics)).toBe(true);
    expect(record.cases.every((item) => item.passed)).toBe(true);
    expect(record.errors).toEqual([]);
    expect(record.dataset.materializedInputSha256).toBe(
      "1d1a2ab3fd41cc53a2437e74b874b988fdeb5d7794fd105f2a401da75745f034"
    );
    expect(record.deterministicOutputSha256).toBe(
      "da6814647c9425fe088940cf8b6407af90a1ed310bd7291d58d84fc3c73fb5a3"
    );
    expect(record.attentionDisposition).toBe("shadow_only");
    expect(record.inference).toEqual({
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      tokenUsage: "not_applicable"
    });
  });

  it("uses unique run IDs while preserving deterministic outputs", () => {
    const input = {
      startedAt: FIXED_START,
      completedAt: FIXED_END
    };
    const first = runAttentionEligibilityEvaluation(input);
    const second = runAttentionEligibilityEvaluation(input);

    expect(first.runId).toMatch(
      /^attention_eligibility_run_[a-f0-9]{32}$/
    );
    expect(second.runId).toMatch(
      /^attention_eligibility_run_[a-f0-9]{32}$/
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

  it("rejects resolver config hash and semantic content tampering", () => {
    const datasetWithWrongConfigHash = structuredClone(
      attentionEligibilityEvaluationDataset
    );
    datasetWithWrongConfigHash.resolverConfig.sha256 = "0".repeat(64);
    expect(() =>
      loadAttentionEligibilityEvaluationDataset(
        datasetWithWrongConfigHash
      )
    ).toThrow(/config integrity/u);

    const tamperedConfig = {
      ...structuredClone(attentionEligibilityEvaluationConfig),
      routing: {
        ...attentionEligibilityEvaluationConfig.routing,
        unrelatedConflictBlocksCandidate: true
      }
    };
    expect(() =>
      loadAttentionEligibilityEvaluationDataset(
        attentionEligibilityEvaluationDataset,
        tamperedConfig
      )
    ).toThrow();
  });

  it("detects semantic dataset drift under the same version", () => {
    const tampered = structuredClone(
      attentionEligibilityEvaluationDataset
    );
    tampered.cases[0].expected.assessments[0]!.reasonCodes = [
      "ELIGIBLE_WITH_LIMITED_SOURCE_COVERAGE"
    ];
    const loaded = loadAttentionEligibilityEvaluationDataset(tampered);
    const record = runAttentionEligibilityEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END,
      dataset: loaded
    });

    expect(record.dataset.canonicalSha256).not.toBe(
      ATTENTION_ELIGIBILITY_DATASET_SHA256
    );
    expect(record.status).toBe("failed");
    expect(record.errors).toContainEqual({
      caseId: "ELIG-DEV-001",
      code: "ATTENTION_ELIGIBILITY_EXACT_MISMATCH"
    });
  });
});
