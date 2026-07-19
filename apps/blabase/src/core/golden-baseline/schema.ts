import { z } from "zod";

export const GOLDEN_BASELINE_DATASET_VERSION = "gold-core-v0.1";
export const GOLDEN_BASELINE_PROMPT_VERSION = "prompt-core-v1";
export const GOLDEN_BASELINE_SUMMARY_VERSION = "summary-core-v1";
export const GOLDEN_BASELINE_JUDGE_VERSION = "judge-3axis-v1";
export const GOLDEN_BASELINE_GUARDRAIL_VERSION = "deterministic-core-v1";

export const PROMPT_FIELDS = [
  "inputIntent",
  "requestedTask",
  "desiredResult",
  "evaluationPoints"
] as const;

export const SUMMARY_FIELDS = [
  "purpose",
  "currentState",
  "flow",
  "decisions",
  "changes",
  "openQuestions",
  "deliverables",
  "sessionJudgment"
] as const;

export const promptPredictionSchema = z.object({
  inputIntent: z.string(),
  requestedTask: z.string(),
  desiredResult: z.string(),
  evaluationPoints: z.string()
});

export const SESSION_JUDGMENTS = [
  "해결됨",
  "부분 해결·구현 진행 중",
  "진행 중",
  "보류",
  "불명확"
] as const;

export const sessionPredictionSchema = z.object({
  purpose: z.string(),
  currentState: z.string(),
  flow: z.string(),
  decisions: z.string(),
  changes: z.string(),
  openQuestions: z.string(),
  deliverables: z.string(),
  sessionJudgment: z.enum(SESSION_JUDGMENTS)
});

export const JUDGE_ERROR_TYPES = [
  "없음",
  "의도·요청 혼동",
  "숨은 동기 추측",
  "이전 맥락 누락",
  "원하는 결과 누락",
  "평가 포인트 누락",
  "최종 결정·상태 누락",
  "논의 흐름 누락",
  "열린 질문 누락",
  "산출물 누락",
  "근거 없는 생성",
  "과도한 일반화",
  "형식 오류",
  "기타"
] as const;

export const scoreSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal("N/A")
]);

export const fieldEvaluationSchema = z.object({
  field: z.string(),
  semanticScore: scoreSchema,
  completenessScore: scoreSchema,
  groundingScore: scoreSchema,
  errorType: z.enum(JUDGE_ERROR_TYPES),
  rationale: z.string()
});

const promptFieldEvaluationSchema = fieldEvaluationSchema.extend({
  field: z.enum(PROMPT_FIELDS)
});

const summaryFieldEvaluationSchema = fieldEvaluationSchema.extend({
  field: z.enum(SUMMARY_FIELDS)
});

export const promptEvaluationSchema = z.object({
  fields: z
    .array(promptFieldEvaluationSchema)
    .length(PROMPT_FIELDS.length)
    .superRefine(requireUniqueFields(PROMPT_FIELDS))
});

export const sessionEvaluationSchema = z.object({
  fields: z
    .array(summaryFieldEvaluationSchema)
    .length(SUMMARY_FIELDS.length)
    .superRefine(requireUniqueFields(SUMMARY_FIELDS))
});

export type PromptPrediction = z.infer<typeof promptPredictionSchema>;
export type SessionPrediction = z.infer<typeof sessionPredictionSchema>;
export type BaselineScore = z.infer<typeof scoreSchema>;
export type FieldEvaluation = z.infer<typeof fieldEvaluationSchema>;

export type GoldenBaselineInput = {
  datasetVersion: string;
  sourceSpreadsheetId: string;
  scope: {
    sessionStart: string;
    sessionEnd: string;
    includedPromptFields: string[];
    includedSummaryFields: string[];
    excluded: string[];
  };
  sessions: Array<{
    sessionId: string;
    title: string;
    shareUrl: string;
  }>;
  prompts: Array<{
    sessionId: string;
    promptId: string;
    promptOrder: string | number;
    userMessageId: string;
    previousAssistantMessageId: string;
    promptRole: string;
    inputIntent: string;
    requestedTask: string;
    desiredResult: string;
    evaluationPoints: string;
    reviewResult: string;
  }>;
  summaries: Array<{
    sessionId: string;
    title: string;
    purpose: string;
    currentState: string;
    flow: string;
    decisions: string;
    changes: string;
    openQuestions: string;
    deliverables: string;
    sessionJudgment: string;
    authorJudgment: string;
    reviewResult: string;
  }>;
};

export type BaselineCondition = "현재 프롬프트만" | "이전 맥락 포함" | "전체 세션";

export type GoldenBaselineSheetRow = {
  evalId: string;
  sessionId: string;
  targetId: string;
  taskType: "02_프롬프트판정" | "03_세션요약";
  fieldName: string;
  contextMode: BaselineCondition;
  datasetVersion: string;
  runId: string;
  goldValue: string;
  baselineValue: string;
  schemaCheck: "통과" | "빈값" | "파싱 실패" | "스키마 불일치";
  semanticScore: BaselineScore;
  completenessScore: BaselineScore;
  groundingScore: BaselineScore;
  errorType: (typeof JUDGE_ERROR_TYPES)[number];
  rationale: string;
  reviewResult: "미검수";
  reviewNote: string;
  modelId: string;
  promptVersion: string;
  runAt: string;
};

export type GoldenBaselineRunOutput = {
  manifest: {
    datasetVersion: string;
    freezeStatus: "동결";
    frozenAt: string;
    sessionScope: string;
    includedScope: string;
    excludedScope: string;
    recordCounts: string;
    datasetSplit: "dev";
    snapshotUrl: string;
    sha256: string;
    note: string;
  };
  run: {
    runId: string;
    status: "running" | "completed" | "partial";
    candidateModel: string;
    judgeProvider: "gemini";
    judgeModel: string;
    contextMaxChars: number;
    candidatePromptVersion: string;
    summaryPromptVersion: string;
    judgePromptVersion: string;
    guardrailVersion: string;
    promptOnlyScore: number | null;
    withContextScore: number | null;
    contextUplift: number | null;
    sessionScore: number | null;
    schemaPassRate: number | null;
    startedAt: string;
    completedAt: string | null;
    errors: string[];
  };
  rows: GoldenBaselineSheetRow[];
};

function requireUniqueFields<const T extends readonly string[]>(fields: T) {
  const expected = new Set<string>(fields);
  return (
    values: Array<{ field: string }>,
    context: z.RefinementCtx
  ) => {
    const actual = new Set(values.map((value) => value.field));
    if (
      actual.size !== expected.size ||
      [...expected].some((field) => !actual.has(field))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each expected field must appear exactly once"
      });
    }
  };
}
