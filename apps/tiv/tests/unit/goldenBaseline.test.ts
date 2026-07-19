import { describe, expect, it } from "vitest";

import {
  canonicalGoldSnapshot,
  enforceEvaluationGuardrails,
  hashGoldenSnapshot,
  normalizeFieldEvaluations,
  promptSheetRows,
  schemaPassRate,
  scoreRows
} from "../../src/core/golden-baseline/evaluation";
import {
  buildPromptPredictionPrompt,
  buildSessionSegmentPrompt
} from "../../src/core/golden-baseline/prompts";
import type {
  GoldenBaselineInput,
  PromptPrediction
} from "../../src/core/golden-baseline/schema";

describe("Golden Core v0.1 baseline", () => {
  it("hashes only the frozen 02 H:K and 03 C:J core in stable order", () => {
    const left = fixture();
    const right = fixture();
    right.prompts.reverse();
    right.prompts[0].promptRole = "수정 요청";
    right.prompts[0].reviewResult = "미검수";
    right.summaries[0].authorJudgment = "changed";

    expect(canonicalGoldSnapshot(left)).toEqual(canonicalGoldSnapshot(right));
    expect(hashGoldenSnapshot(left)).toBe(hashGoldenSnapshot(right));

    right.prompts[0].inputIntent = "다른 의도를 확인하려는 의도";
    expect(hashGoldenSnapshot(left)).not.toBe(hashGoldenSnapshot(right));
  });

  it("keeps candidate prompts blind to Gold labels and satisfaction", () => {
    const prompt = buildPromptPredictionPrompt({
      sessionId: "S-001",
      promptId: "S-001-P001",
      currentPrompt: "구조를 바꿔봐",
      priorMessages: []
    });
    const summary = buildSessionSegmentPrompt({
      sessionId: "S-001",
      segmentId: "S-001-SEG-01",
      messages: [
        { messageId: "S-001-M001", role: "사용자", text: "구조를 바꿔봐" }
      ]
    });

    expect(prompt).not.toContain("Gold");
    expect(prompt).not.toContain("previousAnswerEvaluation");
    expect(prompt).toContain("사용자 만족도는 판정하지 않는다");
    expect(summary).not.toContain("Gold");
  });

  it("normalizes missing judge fields and computes row scores", () => {
    const gold: PromptPrediction = {
      inputIntent: "구조를 개선하려는 의도",
      requestedTask: "구조를 바꿔달라고 요청",
      desiredResult: "확장 가능한 구조",
      evaluationPoints: "여러 세션 처리 가능"
    };
    const evaluations = normalizeFieldEvaluations(
      ["inputIntent", "requestedTask", "desiredResult", "evaluationPoints"],
      [
        {
          field: "inputIntent",
          semanticScore: 2,
          completenessScore: 2,
          groundingScore: 2,
          errorType: "없음",
          rationale: "일치"
        }
      ]
    );
    const rows = promptSheetRows({
      sessionId: "S-001",
      promptId: "S-001-P001",
      gold,
      promptOnly: gold,
      withContext: gold,
      promptOnlySchemaCheck: "통과",
      withContextSchemaCheck: "통과",
      promptOnlyEvaluation: evaluations,
      withContextEvaluation: evaluations,
      datasetVersion: "gold-core-v0.1",
      runId: "run-test",
      modelId: "candidate",
      promptVersion: "prompt-core-v1",
      runAt: "2026-07-19T00:00:00.000Z"
    });

    expect(rows).toHaveLength(8);
    expect(rows[0].semanticScore).toBe(2);
    expect(rows[1].semanticScore).toBe(0);
    expect(scoreRows(rows, () => true)).toBe(25);
    expect(schemaPassRate(rows)).toBe(100);
  });

  it("overrides judge errors for empty values and session status", () => {
    const judged = [
      {
        field: "openQuestions",
        semanticScore: 2 as const,
        completenessScore: 2 as const,
        groundingScore: 2 as const,
        errorType: "없음" as const,
        rationale: "모델 판정"
      },
      {
        field: "sessionJudgment",
        semanticScore: 2 as const,
        completenessScore: 2 as const,
        groundingScore: 2 as const,
        errorType: "없음" as const,
        rationale: "모델 판정"
      }
    ];

    const guarded = enforceEvaluationGuardrails(
      ["openQuestions", "sessionJudgment"],
      judged,
      { openQuestions: "", sessionJudgment: "진행 중" },
      { openQuestions: "새 질문", sessionJudgment: "해결됨" }
    );

    expect(guarded[0]).toMatchObject({
      semanticScore: 0,
      completenessScore: 0,
      groundingScore: 0,
      errorType: "근거 없는 생성"
    });
    expect(guarded[1]).toMatchObject({
      semanticScore: 0,
      completenessScore: 0,
      groundingScore: 0,
      errorType: "최종 결정·상태 누락"
    });
  });
});

function fixture(): GoldenBaselineInput {
  return {
    datasetVersion: "gold-core-v0.1",
    sourceSpreadsheetId: "sheet",
    scope: {
      sessionStart: "S-001",
      sessionEnd: "S-001",
      includedPromptFields: ["inputIntent"],
      includedSummaryFields: ["purpose"],
      excluded: ["satisfaction"]
    },
    sessions: [
      { sessionId: "S-001", title: "테스트", shareUrl: "https://example.com" }
    ],
    prompts: [
      {
        sessionId: "S-001",
        promptId: "S-001-P002",
        promptOrder: 2,
        userMessageId: "S-001-M002",
        previousAssistantMessageId: "S-001-M001",
        promptRole: "새 요청",
        inputIntent: "두 번째 의도를 확인하려는 의도",
        requestedTask: "두 번째 작업",
        desiredResult: "두 번째 결과",
        evaluationPoints: "두 번째 기준",
        reviewResult: "승인"
      },
      {
        sessionId: "S-001",
        promptId: "S-001-P001",
        promptOrder: 1,
        userMessageId: "S-001-M001",
        previousAssistantMessageId: "",
        promptRole: "질문·탐색",
        inputIntent: "첫 번째 의도를 확인하려는 의도",
        requestedTask: "첫 번째 작업",
        desiredResult: "첫 번째 결과",
        evaluationPoints: "첫 번째 기준",
        reviewResult: "승인"
      }
    ],
    summaries: [
      {
        sessionId: "S-001",
        title: "테스트",
        purpose: "목적",
        currentState: "상태",
        flow: "흐름",
        decisions: "결정",
        changes: "변경",
        openQuestions: "열린 질문",
        deliverables: "산출물",
        sessionJudgment: "해결됨",
        authorJudgment: "확정",
        reviewResult: "승인"
      }
    ]
  };
}
