import { describe, expect, it } from "vitest";

import {
  GOLDEN_DATA_QUALITY_VERSION,
  inspectGoldenDataset
} from "../../src/core/golden-baseline/dataQuality";
import type { GoldenBaselineInput } from "../../src/core/golden-baseline/schema";

describe("Golden Dataset data quality", () => {
  it("passes a structurally valid dataset and produces a stable Gold hash", () => {
    const input = fixture();
    const report = inspectGoldenDataset(input, {
      generatedAt: "2026-07-20T00:00:00.000Z",
      profile: null
    });
    const reordered = fixture();
    reordered.prompts.reverse();
    const reorderedReport = inspectGoldenDataset(reordered, {
      generatedAt: "2026-07-20T00:00:00.000Z",
      profile: null
    });

    expect(report).toMatchObject({
      reportVersion: GOLDEN_DATA_QUALITY_VERSION,
      status: "pass",
      counts: {
        sessions: 1,
        prompts: 2,
        summaries: 1,
        approvedPrompts: 2,
        approvedSummaries: 1,
        affectedRecords: 0
      },
      issueCounts: { error: 0, warning: 0, info: 0, byCode: {} }
    });
    expect(report.goldSnapshotSha256).toBe(reorderedReport.goldSnapshotSha256);
  });

  it("flags review candidates without exposing Gold text or share URLs", () => {
    const input = fixture();
    const cancelled = "esc 잘 못 눌러서 취소됨";
    Object.assign(input.prompts[0], {
      inputIntent: cancelled,
      requestedTask: cancelled,
      desiredResult: cancelled,
      evaluationPoints: cancelled
    });
    input.summaries[0].openQuestions = "";
    input.summaries[0].authorJudgment = "검토 필요";

    const report = inspectGoldenDataset(input, {
      generatedAt: "2026-07-20T00:00:00.000Z",
      profile: null
    });

    expect(report.status).toBe("warning");
    expect(report.issueCounts).toMatchObject({
      error: 0,
      warning: 3,
      byCode: {
        PROMPT_CANCELLED_INPUT: 1,
        SUMMARY_AUTHOR_REVIEW_PENDING: 1,
        SUMMARY_GOLD_EMPTY: 1
      }
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(cancelled);
    expect(serialized).not.toContain("https://chatgpt.com/share/private-test");
  });

  it("reports structural errors for broken identity and approval contracts", () => {
    const input = fixture();
    input.sessions.push({ ...input.sessions[0] });
    input.prompts[0].sessionId = "S-999";
    input.prompts[0].reviewResult = "미검수";
    input.summaries[0].sessionJudgment = "완료";

    const report = inspectGoldenDataset(input, {
      generatedAt: "2026-07-20T00:00:00.000Z",
      profile: null
    });

    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "SESSION_ID_DUPLICATE",
        "SESSION_SHARE_URL_DUPLICATE",
        "PROMPT_SESSION_ID_MISMATCH",
        "MESSAGE_SESSION_ID_MISMATCH",
        "PROMPT_NOT_APPROVED",
        "PROMPT_SESSION_ORPHAN",
        "SESSION_JUDGMENT_INVALID"
      ])
    );
  });

  it("returns a report instead of throwing for malformed input", () => {
    const report = inspectGoldenDataset(
      { datasetVersion: "gold-core-v0.1", sessions: [] },
      {
        generatedAt: "2026-07-20T00:00:00.000Z",
        profile: null
      }
    );

    expect(report.status).toBe("error");
    expect(report.goldSnapshotSha256).toBeNull();
    expect(
      report.issues.every((issue) => issue.code === "INPUT_SCHEMA_INVALID")
    ).toBe(true);
  });

  it("enforces the known frozen profile by default", () => {
    const report = inspectGoldenDataset(fixture(), {
      generatedAt: "2026-07-20T00:00:00.000Z"
    });

    expect(report.status).toBe("error");
    expect(report.profile).toBe("gold-core-v0.1-profile");
    expect(report.issueCounts.byCode).toMatchObject({
      SESSION_SCOPE_MISMATCH: 1,
      SESSION_COUNT_MISMATCH: 1,
      PROMPT_COUNT_MISMATCH: 1,
      SUMMARY_COUNT_MISMATCH: 1
    });
  });
});

function fixture(): GoldenBaselineInput {
  return {
    datasetVersion: "gold-core-v0.1",
    sourceSpreadsheetId: "sheet-test",
    scope: {
      sessionStart: "S-001",
      sessionEnd: "S-001",
      includedPromptFields: [
        "inputIntent",
        "requestedTask",
        "desiredResult",
        "evaluationPoints"
      ],
      includedSummaryFields: [
        "purpose",
        "currentState",
        "flow",
        "decisions",
        "changes",
        "openQuestions",
        "deliverables",
        "sessionJudgment"
      ],
      excluded: ["satisfaction"]
    },
    sessions: [
      {
        sessionId: "S-001",
        title: "테스트 세션",
        shareUrl: "https://chatgpt.com/share/private-test"
      }
    ],
    prompts: [
      {
        sessionId: "S-001",
        promptId: "S-001-P001",
        promptOrder: 1,
        userMessageId: "S-001-M001",
        previousAssistantMessageId: "",
        promptRole: "질문·탐색",
        inputIntent: "구조를 확인하려는 의도",
        requestedTask: "구조 확인",
        desiredResult: "검증된 구조",
        evaluationPoints: "구조의 정확성",
        reviewResult: "승인"
      },
      {
        sessionId: "S-001",
        promptId: "S-001-P002",
        promptOrder: 2,
        userMessageId: "S-001-M003",
        previousAssistantMessageId: "S-001-M002",
        promptRole: "수정 요청",
        inputIntent: "구조를 수정하려는 의도",
        requestedTask: "구조 수정",
        desiredResult: "수정된 구조",
        evaluationPoints: "수정 사항 반영",
        reviewResult: "승인"
      }
    ],
    summaries: [
      {
        sessionId: "S-001",
        title: "테스트 세션",
        purpose: "구조 검증",
        currentState: "검증 완료",
        flow: "확인 후 수정",
        decisions: "구조 유지",
        changes: "표현 수정",
        openQuestions: "없음",
        deliverables: "검증 결과",
        sessionJudgment: "해결됨",
        authorJudgment: "확실함",
        reviewResult: "승인"
      }
    ]
  };
}
