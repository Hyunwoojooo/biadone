import { describe, expect, it } from "vitest";

import {
  GoldenQualityReportReadError,
  sanitizeGoldenQualityReport
} from "../../src/core/golden-baseline/qualityReportStore";

describe("Golden quality report store", () => {
  it("returns only the allowlisted quality summary fields", () => {
    const report = sanitizeGoldenQualityReport(persistedReport());

    expect(report).toEqual({
      datasetVersion: "gold-core-v0.1",
      goldSnapshotSha256:
        "f02a650d2e78bb605ae8b068d224d454aa5808aff61f72073eb5f2f3266ae672",
      qualityReportVersion: "golden-quality-v1",
      generatedAt: "2026-07-20T01:00:00.000Z",
      issueCounts: {
        error: 1,
        warning: 2
      },
      warnings: [
        { code: "PROMPT_CANCELLED_INPUT", targetId: "S-001-P031" },
        { code: "SUMMARY_GOLD_EMPTY", targetId: "S-005" }
      ]
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("민감한 Golden 원문");
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("field");
    expect(serialized).not.toContain("sessionId");
  });

  it("rejects a report whose issue counts do not match its issue rows", () => {
    const value = persistedReport();
    value.issueCounts.warning = 99;

    expect(() => sanitizeGoldenQualityReport(value)).toThrowError(
      expect.objectContaining<Partial<GoldenQualityReportReadError>>({
        code: "GOLDEN_QUALITY_REPORT_INVALID"
      })
    );
  });

  it("rejects unsafe target IDs instead of returning their contents", () => {
    const value = persistedReport();
    value.issues[0].targetId = "https://private.example/share/secret";

    expect(() => sanitizeGoldenQualityReport(value)).toThrowError(
      expect.objectContaining<Partial<GoldenQualityReportReadError>>({
        code: "GOLDEN_QUALITY_REPORT_INVALID"
      })
    );
  });
});

function persistedReport() {
  return {
    reportVersion: "golden-quality-v1",
    generatedAt: "2026-07-20T01:00:00.000Z",
    datasetVersion: "gold-core-v0.1",
    goldSnapshotSha256:
      "f02a650d2e78bb605ae8b068d224d454aa5808aff61f72073eb5f2f3266ae672",
    profile: "gold-core-v0.1-profile",
    status: "error",
    issueCounts: {
      error: 1,
      warning: 2,
      info: 0,
      byCode: {
        PROMPT_CANCELLED_INPUT: 1,
        SUMMARY_GOLD_EMPTY: 1,
        SESSION_ID_DUPLICATE: 1
      }
    },
    issues: [
      {
        severity: "warning",
        code: "PROMPT_CANCELLED_INPUT",
        entityType: "prompt",
        sessionId: "S-001",
        targetId: "S-001-P031",
        field: "inputIntent",
        message: "민감한 Golden 원문",
        shareUrl: "https://private.example/share/secret"
      },
      {
        severity: "warning",
        code: "SUMMARY_GOLD_EMPTY",
        entityType: "summary",
        sessionId: "S-005",
        targetId: "S-005",
        field: "openQuestions",
        message: "검수 필요"
      },
      {
        severity: "error",
        code: "SESSION_ID_DUPLICATE",
        entityType: "session",
        sessionId: "S-003",
        targetId: "S-003",
        message: "중복"
      }
    ],
    sourceSpreadsheetId: "private-sheet-id",
    rawGold: "민감한 Golden 원문"
  };
}
