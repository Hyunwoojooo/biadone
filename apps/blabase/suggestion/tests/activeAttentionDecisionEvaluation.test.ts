import { describe, expect, it } from "vitest";

import {
  ACTIVE_ATTENTION_CONFIG_SHA256,
  ACTIVE_ATTENTION_DATASET_SHA256,
  activeAttentionEvaluationConfig,
  activeAttentionEvaluationDataset,
  activeAttentionReleaseGatesPass,
  loadActiveAttentionEvaluationDataset,
  runActiveAttentionDecisionEvaluation
} from "../src/evaluation/activeAttentionDecisionEvaluation";
import { sha256Canonical } from "../src/evaluation/crossSourceIntegrity";

const FIXED_START = new Date("2026-08-02T03:00:00.000Z");
const FIXED_END = new Date("2026-08-02T03:00:00.150Z");

describe("Phase 4B active Attention targeted evaluation", () => {
  it("loads a separate mutable 44-case bounded synthetic Dev Candidate", () => {
    expect(activeAttentionEvaluationDataset).toMatchObject({
      datasetVersion: "suggestion-active-attention-dev-v0.2",
      datasetRevision: 3,
      datasetClass: "dev_candidate",
      inputBoundary: "exact_phase4b_replayable_evidence_envelope",
      dataOrigin: "bounded_synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      },
      expectedInvariants: {
        recommendationMode: "aggressive_evidence_bound",
        readOnly: true,
        upstreamObjectsRemainForbidden: true,
        containsRawCodexValues: false,
        deterministicReplay: true
      }
    });
    expect(activeAttentionEvaluationDataset.cases).toHaveLength(44);
    expect(
      new Set(
        activeAttentionEvaluationDataset.cases.map((item) => item.caseId)
      ).size
    ).toBe(44);
    expect(
      new Set(
        activeAttentionEvaluationDataset.cases.map(
          (item) => item.scenario
        )
      ).size
    ).toBe(44);
    expect(
      Object.keys(
        activeAttentionEvaluationDataset.expectedResultSha256ByCase
      )
    ).toHaveLength(44);
    expect(ACTIVE_ATTENTION_CONFIG_SHA256).toBe(
      "f8da1f5c0b8f55aaa6acffbd6885bdf4a1a759ca0c0f3cf61d84dcb35b6df30b"
    );
    expect(ACTIVE_ATTENTION_DATASET_SHA256).toBe(
      "fc8be53b229f4c685591e34b005a4e99fbf49eb7722cc86cd4aeab97f04c8a26"
    );
  });

  it("passes exact decisions and every Phase 4B hard-negative guardrail", () => {
    const record = runActiveAttentionDecisionEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END
    });

    expect(record.status).toBe("passed");
    expect(record.metrics.caseCount).toBe(44);
    expect(record.metrics.exactCasePassCount).toBe(44);
    expect(record.metrics.exactCasePassRate).toBe(1);
    expect(record.metrics.expectedAssessmentCount).toBe(80);
    expect(record.metrics.observedAssessmentCount).toBe(80);
    expect(record.metrics.assessmentPrecision).toBe(1);
    expect(record.metrics.assessmentRecall).toBe(1);
    expect(
      Object.entries(record.metrics)
        .filter(([key]) => key.endsWith("FailureCount"))
        .every(([, value]) => value === 0)
    ).toBe(true);
    expect(
      Object.entries(record.metrics)
        .filter(([key]) => key.endsWith("LeakageCount"))
        .every(([, value]) => value === 0)
    ).toBe(true);
    expect(record.metrics.resultHashMismatchCount).toBe(0);
    expect(record.metrics.wrongDecisionStatusCount).toBe(0);
    expect(record.metrics.wrongReviewRouteCount).toBe(0);
    expect(record.metrics.wrongLaneOrRankCount).toBe(0);
    expect(record.metrics.phase2FourPlusRankTruncationCount).toBe(0);
    expect(record.metrics.weeklyFocusReasonLossCount).toBe(0);
    expect(record.metrics.managedFocusPriorityFailureCount).toBe(0);
    expect(
      record.metrics.workflowActionTargetCompatibilityLeakageCount
    ).toBe(0);
    expect(record.metrics.archivedProjectWorkflowLeakageCount).toBe(0);
    expect(record.metrics.inputIntegrityFailOpenCount).toBe(0);
    expect(record.metrics.evidenceGraphFailOpenCount).toBe(0);
    expect(record.metrics.configIntegrityFailureCount).toBe(0);
    expect(record.metrics.resultSchemaErrorCount).toBe(0);
    expect(record.metrics.privacyInputBoundaryAbsenceCount).toBe(0);
    expect(activeAttentionReleaseGatesPass(record.metrics)).toBe(true);
    expect(record.cases.every((item) => item.passed)).toBe(true);
    expect(record.errors).toEqual([]);
    expect(record.versions).toMatchObject({
      rankingPolicyVersion: "active-attention-ranking-policy-v0.3",
      resolverVersion: "active-attention-decision-resolver-v0.4"
    });
    expect(record.dataset.materializedInputSha256).toBe(
      "baa7a6ec69173b4207e4409b900519c3148ad06995726aad78f9e2d6ef79f940"
    );
    expect(record.deterministicOutputSha256).toBe(
      "6ce881d595ab1476e95f33710c5ee7c6cd9be412d492b2b79daa26faf71c0d55"
    );
    expect(record.privacy).toEqual({
      classification: "synthetic_sanitized_metadata",
      productionDataUsed: false,
      rawCandidatePayloadStored: false,
      promptAnswerCommandOutputPathOrThreadStored: false,
      retention: "local_evaluation_record_only"
    });
    expect(JSON.stringify(record)).not.toContain(
      "PRIVATE_ACTIVE_CODEX_PROMPT_SENTINEL"
    );
    expect(record.scope).toMatchObject({
      task: "active_attention_decision",
      includedCaseCount: 44,
      excludedCaseCount: 0
    });
    expect(record.review).toEqual({
      automaticReviewStatus: "passed",
      humanReviewStatus: "not_reviewed",
      qualityClaim: "development_contract_only"
    });
    const { artifact, ...canonicalPayload } = record;
    expect(artifact.canonicalPayloadSha256).toBe(
      sha256Canonical(canonicalPayload)
    );
  });

  it(
    "uses unique run IDs while preserving deterministic artifacts",
    () => {
      const input = { startedAt: FIXED_START, completedAt: FIXED_END };
      const first = runActiveAttentionDecisionEvaluation(input);
      const second = runActiveAttentionDecisionEvaluation(input);

      expect(first.runId).toMatch(
        /^active_attention_eval_run_[a-f0-9]{32}$/
      );
      expect(second.runId).toMatch(
        /^active_attention_eval_run_[a-f0-9]{32}$/
      );
      expect(first.runId).not.toBe(second.runId);
      expect(first.deterministicOutputSha256).toBe(
        second.deterministicOutputSha256
      );
      expect(first.dataset.materializedInputSha256).toBe(
        second.dataset.materializedInputSha256
      );
      expect(first.cases).toEqual(second.cases);
    },
    15_000
  );

  it("rejects config hash and semantic config tampering", () => {
    const wrongHash = structuredClone(activeAttentionEvaluationDataset);
    wrongHash.resolverConfig.sha256 = "0".repeat(64);
    expect(() => loadActiveAttentionEvaluationDataset(wrongHash)).toThrow(
      /config integrity/u
    );

    const tamperedConfig = {
      ...structuredClone(activeAttentionEvaluationConfig),
      routing: {
        ...activeAttentionEvaluationConfig.routing,
        refreshBeforeUserReview: false
      }
    };
    expect(() =>
      loadActiveAttentionEvaluationDataset(
        activeAttentionEvaluationDataset,
        tamperedConfig
      )
    ).toThrow();
  });

  it("detects semantic dataset drift while keeping the Dev Candidate mutable", () => {
    const tampered = structuredClone(activeAttentionEvaluationDataset);
    tampered.cases[0].expected.topCandidate!.lane = "must_now";
    tampered.cases[0].expected.rankedCandidateOrder = [
      "github:github_work_item:must_now:do:none"
    ];
    const loaded = loadActiveAttentionEvaluationDataset(tampered);
    const record = runActiveAttentionDecisionEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END,
      dataset: loaded
    });

    expect(record.dataset.canonicalSha256).not.toBe(
      ACTIVE_ATTENTION_DATASET_SHA256
    );
    expect(record.status).toBe("failed");
    expect(record.errors).toContainEqual({
      caseId: "ACTIVE-DEV-001",
      code: "ACTIVE_ATTENTION_EXACT_MISMATCH"
    });
  });
});
