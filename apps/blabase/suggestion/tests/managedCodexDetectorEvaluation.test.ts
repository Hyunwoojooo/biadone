import { describe, expect, it } from "vitest";

import {
  MANAGED_CODEX_DETECTOR_DATASET_SHA256,
  expectedDetectorSemantics,
  loadManagedCodexDetectorEvaluationDataset,
  managedCodexDetectorEvaluationDataset,
  materializeManagedCodexDetectorDataset,
  normalizedDetectorSemantics,
  runManagedCodexDetectorEvaluation
} from "../src/evaluation/managedCodexDetectorEvaluation";
import { managedCodexEventHistorySchema } from "../src/managedCodex/contracts";
import { buildManagedCodexSemanticRunResult } from "../src/managedCodex/semanticTimeline";

const FIXED_START = new Date("2026-08-01T03:00:00.000Z");
const FIXED_END = new Date("2026-08-01T03:00:00.025Z");

describe("managed Codex detector targeted evaluation", () => {
  it("loads a separate mutable synthetic revision at the event-history boundary", () => {
    expect(managedCodexDetectorEvaluationDataset).toMatchObject({
      datasetVersion: "suggestion-codex-detector-dev-v0.1",
      datasetRevision: 1,
      datasetClass: "dev_candidate",
      inputBoundary: "managed_codex_event_history",
      dataOrigin: "synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      }
    });
    expect(managedCodexDetectorEvaluationDataset.cases).toHaveLength(18);
    expect(
      new Set(
        managedCodexDetectorEvaluationDataset.cases.map(
          (item) => item.caseId
        )
      ).size
    ).toBe(18);
    expect(MANAGED_CODEX_DETECTOR_DATASET_SHA256).toBe(
      "5436c590c8768b8b2732d675e96b6bd0d837e882dccffbeec67602466e76c838"
    );
  });

  it("materializes only valid hash-chained sanitized managed histories", () => {
    const materialized = materializeManagedCodexDetectorDataset();
    expect(materialized).toHaveLength(18);
    for (const item of materialized) {
      expect(managedCodexEventHistorySchema.parse(item.history)).toEqual(
        item.history
      );
      expect(item.run.forbiddenAsAttentionCandidate).toBe(true);
    }

    const anchored = materialized.find(
      (item) => item.evaluationCase.caseId === "MCD-DEV-016"
    );
    expect(anchored?.history.anchor?.prunedThroughSequence).toBe(9);
    expect(anchored?.history.events[0]?.sequence).toBe(10);

    const serialized = JSON.stringify(materialized);
    for (const forbidden of [
      "prompt",
      "answer",
      "reasoningContent",
      "commandOutput",
      "nativeThreadId",
      "nativeTurnId",
      "nativeItemId",
      "filePath",
      "diff"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("passes all exact semantic cases and hard-negative metric gates", () => {
    for (const item of materializeManagedCodexDetectorDataset()) {
      const result = buildManagedCodexSemanticRunResult({
        sourceRevision:
          managedCodexDetectorEvaluationDataset.datasetRevision,
        generatedAt: item.evaluationCase.generatedAt,
        run: item.run,
        history: item.history
      });
      expect(
        normalizedDetectorSemantics(result),
        item.evaluationCase.caseId
      ).toEqual(
        expectedDetectorSemantics(item.evaluationCase)
      );
    }

    const record = runManagedCodexDetectorEvaluation({
      startedAt: FIXED_START,
      completedAt: FIXED_END
    });

    expect(record.status).toBe("passed");
    expect(record.metrics).toEqual({
      caseCount: 18,
      exactCasePassCount: 18,
      exactCasePassRate: 1,
      activeFailureExpectedCount: 2,
      activeFailureObservedCount: 2,
      activeFailureTruePositiveCount: 2,
      activeFailureFalsePositiveCount: 0,
      activeFailureFalseNegativeCount: 0,
      activeFailurePrecision: 1,
      activeFailureRecall: 1,
      supersededFailureLeakageCount: 0,
      gapStaleStateLeakageCount: 0,
      systemErrorFalseFailureCount: 0,
      unsupportedStallOrRequestEmissionCount: 0
    });
    expect(record.cases.every((item) => item.passed)).toBe(true);
    expect(record.errors).toEqual([]);
    expect(record.dataset.materializedInputSha256).toBe(
      "d161272fe5815e42a7ac9fe30caf2ad45e2189e6acee9cdd5c5d1a0aedcaa747"
    );
    expect(record.deterministicOutputSha256).toBe(
      "60292c648f169be965c2da239d4b21315004c730c02455b4042dfacd2f69fd81"
    );
    expect(record.inference).toEqual({
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      tokenUsage: "not_applicable"
    });
    expect(record.attentionDisposition).toBe("not_connected");
  });

  it("uses unique run IDs while keeping the evaluated output deterministic", () => {
    const input = {
      startedAt: FIXED_START,
      completedAt: FIXED_END
    };
    const first = runManagedCodexDetectorEvaluation(input);
    const second = runManagedCodexDetectorEvaluation(input);

    expect(first.runId).toMatch(/^detector_run_[a-f0-9]{32}$/);
    expect(second.runId).toMatch(/^detector_run_[a-f0-9]{32}$/);
    expect(first.runId).not.toBe(second.runId);
    expect(first.deterministicOutputSha256).toBe(
      second.deterministicOutputSha256
    );
    expect(first.dataset.materializedInputSha256).toBe(
      second.dataset.materializedInputSha256
    );
    expect(first.cases).toEqual(second.cases);
  });

  it("rejects a detector config reference whose canonical hash was changed", () => {
    const tampered = structuredClone(
      managedCodexDetectorEvaluationDataset
    );
    tampered.detectorConfig.sha256 = "0".repeat(64);

    expect(() =>
      loadManagedCodexDetectorEvaluationDataset(tampered)
    ).toThrow(/config integrity check failed/);
  });
});
