import { describe, expect, it } from "vitest";

import {
  buildGoldenWarningGroups,
  buildGoldenWarningTargetRows,
  goldenQualityState,
  goldenTargetKind,
  isGoldenQualityReport,
  type GoldenQualityReport
} from "../../src/components/golden-quality/goldenQualityModel";

describe("Golden quality dashboard model", () => {
  it("groups warning codes and counts unique targets", () => {
    const groups = buildGoldenWarningGroups([
      { code: "SUMMARY_GOLD_EMPTY", targetId: "S-005" },
      { code: "PROMPT_CANCELLED_INPUT", targetId: "S-001-P031" },
      { code: "SUMMARY_GOLD_EMPTY", targetId: "S-005" }
    ]);

    expect(groups).toEqual([
      expect.objectContaining({
        code: "SUMMARY_GOLD_EMPTY",
        label: "비어 있는 세션 요약",
        count: 2,
        targetCount: 1
      }),
      expect.objectContaining({
        code: "PROMPT_CANCELLED_INPUT",
        label: "취소·오입력 프롬프트",
        count: 1,
        targetCount: 1
      })
    ]);
  });

  it("deduplicates target rows while preserving occurrence counts", () => {
    const rows = buildGoldenWarningTargetRows([
      { code: "SUMMARY_GOLD_EMPTY", targetId: "S-005" },
      { code: "SUMMARY_GOLD_EMPTY", targetId: "S-005" },
      { code: "PROMPT_CANCELLED_INPUT", targetId: "S-001-P031" }
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        targetId: "S-001-P031",
        targetKind: "prompt",
        occurrences: 1
      }),
      expect.objectContaining({
        targetId: "S-005",
        targetKind: "session",
        occurrences: 2
      })
    ]);
  });

  it("derives quality state from error and warning counts", () => {
    expect(goldenQualityState(report({ error: 1, warning: 4 }))).toMatchObject({
      label: "ERROR",
      tone: "error"
    });
    expect(goldenQualityState(report({ error: 0, warning: 4 }))).toMatchObject({
      label: "REVIEW",
      tone: "warning"
    });
    expect(goldenQualityState(report({ error: 0, warning: 0 }))).toMatchObject({
      label: "PASS",
      tone: "pass"
    });
  });

  it("classifies targets and validates the API response shape", () => {
    expect(goldenTargetKind("S-001-P031")).toBe("prompt");
    expect(goldenTargetKind("S-001")).toBe("session");
    expect(goldenTargetKind(null)).toBe("dataset");
    expect(isGoldenQualityReport(report({ error: 0, warning: 0 }))).toBe(true);
    expect(isGoldenQualityReport({ issueCounts: {} })).toBe(false);
  });
});

function report(issueCounts: {
  error: number;
  warning: number;
}): GoldenQualityReport {
  return {
    datasetVersion: "gold-core-v0.1",
    goldSnapshotSha256:
      "f02a650d2e78bb605ae8b068d224d454aa5808aff61f72073eb5f2f3266ae672",
    qualityReportVersion: "golden-quality-v1",
    generatedAt: "2026-07-20T00:00:00.000Z",
    issueCounts,
    warnings: []
  };
}
