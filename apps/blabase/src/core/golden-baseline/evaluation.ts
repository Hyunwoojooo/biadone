import { createHash } from "node:crypto";

import type {
  BaselineScore,
  FieldEvaluation,
  GoldenBaselineInput,
  GoldenBaselineSheetRow,
  PromptPrediction,
  SessionPrediction
} from "./schema";
import {
  JUDGE_ERROR_TYPES,
  PROMPT_FIELDS,
  SUMMARY_FIELDS
} from "./schema";

export function canonicalGoldSnapshot(input: GoldenBaselineInput) {
  return {
    datasetVersion: input.datasetVersion,
    prompts: [...input.prompts]
      .sort(compareTarget)
      .map((row) => ({
        sessionId: row.sessionId,
        promptId: row.promptId,
        inputIntent: row.inputIntent,
        requestedTask: row.requestedTask,
        desiredResult: row.desiredResult,
        evaluationPoints: row.evaluationPoints
      })),
    summaries: [...input.summaries]
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
      .map((row) => ({
        sessionId: row.sessionId,
        purpose: row.purpose,
        currentState: row.currentState,
        flow: row.flow,
        decisions: row.decisions,
        changes: row.changes,
        openQuestions: row.openQuestions,
        deliverables: row.deliverables,
        sessionJudgment: row.sessionJudgment
      }))
  };
}

export function hashGoldenSnapshot(input: GoldenBaselineInput): string {
  return createHash("sha256")
    .update(stableStringify(canonicalGoldSnapshot(input)))
    .digest("hex");
}

export function normalizeFieldEvaluations(
  fields: readonly string[],
  evaluations: FieldEvaluation[] | undefined
): FieldEvaluation[] {
  const byField = new Map(
    (evaluations ?? []).map((evaluation) => [evaluation.field, evaluation])
  );
  return fields.map((field) => {
    const source = byField.get(field);
    return {
      field,
      semanticScore: normalizeScore(source?.semanticScore),
      completenessScore: normalizeScore(source?.completenessScore),
      groundingScore: normalizeScore(source?.groundingScore),
      errorType: JUDGE_ERROR_TYPES.includes(
        source?.errorType as (typeof JUDGE_ERROR_TYPES)[number]
      )
        ? (source?.errorType as (typeof JUDGE_ERROR_TYPES)[number])
        : "기타",
      rationale: string(source?.rationale)
    };
  });
}

export function enforceEvaluationGuardrails(
  fields: readonly string[],
  evaluations: FieldEvaluation[],
  gold: Record<string, unknown>,
  candidate: Record<string, unknown>
): FieldEvaluation[] {
  const normalized = normalizeFieldEvaluations(fields, evaluations);
  return normalized.map((evaluation) => {
    const expected = string(gold[evaluation.field]);
    const actual = string(candidate[evaluation.field]);
    if (!expected && !actual) {
      return {
        ...evaluation,
        semanticScore: "N/A",
        completenessScore: "N/A",
        groundingScore: "N/A",
        errorType: "없음",
        rationale: "결정적 가드레일: Gold와 후보가 모두 비어 있어 적용되지 않음"
      };
    }
    if (!expected && actual) {
      return {
        ...evaluation,
        semanticScore: 0,
        completenessScore: 0,
        groundingScore: 0,
        errorType: "근거 없는 생성",
        rationale: "결정적 가드레일: 빈 Gold에 후보가 내용을 생성함"
      };
    }
    if (expected && !actual) {
      return {
        ...evaluation,
        semanticScore: 0,
        completenessScore: 0,
        groundingScore: 0,
        errorType: "기타",
        rationale: "결정적 가드레일: Gold 값이 있으나 후보가 비어 있음"
      };
    }
    if (evaluation.field === "sessionJudgment") {
      const score = sessionJudgmentScore(expected, actual);
      return {
        ...evaluation,
        semanticScore: score,
        completenessScore: score,
        groundingScore: score,
        errorType: score === 2 ? "없음" : "최종 결정·상태 누락",
        rationale:
          score === 2
            ? "결정적 가드레일: 세션 판정이 Gold와 정확히 일치"
            : `결정적 가드레일: 세션 판정 불일치 (Gold=${expected}, 후보=${actual})`
      };
    }
    return evaluation;
  });
}

export function promptSheetRows(input: {
  sessionId: string;
  promptId: string;
  gold: PromptPrediction;
  promptOnly: PromptPrediction;
  withContext: PromptPrediction;
  promptOnlySchemaCheck: GoldenBaselineSheetRow["schemaCheck"];
  withContextSchemaCheck: GoldenBaselineSheetRow["schemaCheck"];
  promptOnlyEvaluation: FieldEvaluation[];
  withContextEvaluation: FieldEvaluation[];
  datasetVersion: string;
  runId: string;
  modelId: string;
  promptVersion: string;
  runAt: string;
}): GoldenBaselineSheetRow[] {
  return [
    ...conditionRows({
      ...input,
      candidate: input.promptOnly,
      contextMode: "현재 프롬프트만",
      schemaCheck: input.promptOnlySchemaCheck,
      evaluations: input.promptOnlyEvaluation,
      fields: PROMPT_FIELDS,
      taskType: "02_프롬프트판정"
    }),
    ...conditionRows({
      ...input,
      candidate: input.withContext,
      contextMode: "이전 맥락 포함",
      schemaCheck: input.withContextSchemaCheck,
      evaluations: input.withContextEvaluation,
      fields: PROMPT_FIELDS,
      taskType: "02_프롬프트판정"
    })
  ];
}

export function summarySheetRows(input: {
  sessionId: string;
  gold: SessionPrediction;
  candidate: SessionPrediction;
  schemaCheck: GoldenBaselineSheetRow["schemaCheck"];
  evaluations: FieldEvaluation[];
  datasetVersion: string;
  runId: string;
  modelId: string;
  promptVersion: string;
  runAt: string;
}): GoldenBaselineSheetRow[] {
  return conditionRows({
    ...input,
    promptId: input.sessionId,
    candidate: input.candidate,
    contextMode: "전체 세션",
    schemaCheck: input.schemaCheck,
    evaluations: input.evaluations,
    fields: SUMMARY_FIELDS,
    taskType: "03_세션요약"
  });
}

export function scoreRows(
  rows: GoldenBaselineSheetRow[],
  predicate: (row: GoldenBaselineSheetRow) => boolean
): number | null {
  const sessionFields = new Map<string, number[]>();
  for (const row of rows.filter(predicate)) {
    const key = `${row.sessionId}:${row.fieldName}`;
    const values = sessionFields.get(key) ?? [];
    values.push(
      ...[
        numericScore(row.semanticScore),
        numericScore(row.completenessScore),
        numericScore(row.groundingScore)
      ].filter((value): value is number => value !== null)
    );
    sessionFields.set(key, values);
  }
  const groupScores = [...sessionFields.values()]
    .filter((values) => values.length > 0)
    .map(
      (values) =>
        values.reduce((sum, value) => sum + value, 0) / values.length
    );
  if (groupScores.length === 0) return null;
  return (
    (groupScores.reduce((sum, value) => sum + value, 0) /
      groupScores.length /
      2) *
    100
  );
}

export function schemaPassRate(rows: GoldenBaselineSheetRow[]): number | null {
  if (rows.length === 0) return null;
  const units = new Map<string, boolean>();
  for (const row of rows) {
    const key = `${row.taskType}:${row.contextMode}:${row.targetId}`;
    units.set(key, (units.get(key) ?? true) && row.schemaCheck === "통과");
  }
  const passed = [...units.values()].filter(Boolean).length;
  return (passed / units.size) * 100;
}

export function compareBaselineRows(
  left: GoldenBaselineSheetRow,
  right: GoldenBaselineSheetRow
) {
  const contextOrder: Record<GoldenBaselineSheetRow["contextMode"], number> = {
    "현재 프롬프트만": 0,
    "이전 맥락 포함": 1,
    "전체 세션": 2
  };
  const fields =
    left.taskType === "02_프롬프트판정" ? PROMPT_FIELDS : SUMMARY_FIELDS;
  return (
    left.sessionId.localeCompare(right.sessionId) ||
    left.taskType.localeCompare(right.taskType) ||
    left.targetId.localeCompare(right.targetId) ||
    contextOrder[left.contextMode] - contextOrder[right.contextMode] ||
    fields.indexOf(left.fieldName as never) -
      fields.indexOf(right.fieldName as never) ||
    left.evalId.localeCompare(right.evalId)
  );
}

export function sheetRowsToValues(rows: GoldenBaselineSheetRow[]) {
  return rows.map((row, index) => [
    row.evalId,
    row.sessionId,
    row.targetId,
    row.taskType,
    row.fieldName,
    row.contextMode,
    row.datasetVersion,
    row.runId,
    row.goldValue,
    row.baselineValue,
    row.schemaCheck,
    row.semanticScore,
    row.completenessScore,
    row.groundingScore,
    `=IFERROR(AVERAGE(FILTER(L${index + 6}:N${index + 6},ISNUMBER(L${index + 6}:N${index + 6})))/2,"")`,
    row.errorType,
    row.rationale,
    row.reviewResult,
    row.reviewNote,
    row.modelId,
    row.promptVersion,
    row.runAt
  ]);
}

function conditionRows(input: {
  sessionId: string;
  promptId: string;
  gold: Record<string, unknown>;
  candidate: Record<string, unknown>;
  contextMode: GoldenBaselineSheetRow["contextMode"];
  schemaCheck: GoldenBaselineSheetRow["schemaCheck"];
  evaluations: FieldEvaluation[];
  fields: readonly string[];
  taskType: GoldenBaselineSheetRow["taskType"];
  datasetVersion: string;
  runId: string;
  modelId: string;
  promptVersion: string;
  runAt: string;
}): GoldenBaselineSheetRow[] {
  const normalized = normalizeFieldEvaluations(input.fields, input.evaluations);
  return input.fields.map((field, fieldIndex) => {
    const evaluation = normalized[fieldIndex];
    const conditionCode =
      input.contextMode === "현재 프롬프트만"
        ? "B1"
        : input.contextMode === "이전 맥락 포함"
          ? "B2"
          : "S1";
    return {
      evalId: `${input.runId}-${conditionCode}-${input.promptId}-${field}`,
      sessionId: input.sessionId,
      targetId: input.promptId,
      taskType: input.taskType,
      fieldName: field,
      contextMode: input.contextMode,
      datasetVersion: input.datasetVersion,
      runId: input.runId,
      goldValue: string(input.gold[field]),
      baselineValue: string(input.candidate[field]),
      schemaCheck: input.schemaCheck,
      semanticScore: evaluation.semanticScore,
      completenessScore: evaluation.completenessScore,
      groundingScore: evaluation.groundingScore,
      errorType: evaluation.errorType,
      rationale: evaluation.rationale,
      reviewResult: "미검수",
      reviewNote: "",
      modelId: input.modelId,
      promptVersion: input.promptVersion,
      runAt: input.runAt
    };
  });
}

function compareTarget(
  left: { sessionId: string; promptId: string },
  right: { sessionId: string; promptId: string }
) {
  return (
    left.sessionId.localeCompare(right.sessionId) ||
    left.promptId.localeCompare(right.promptId)
  );
}

function normalizeScore(value: unknown): BaselineScore {
  return value === 0 || value === 1 || value === 2 || value === "N/A"
    ? value
    : 0;
}

function numericScore(value: BaselineScore): number | null {
  return typeof value === "number" ? value : null;
}

function sessionJudgmentScore(expected: string, actual: string): 0 | 1 | 2 {
  if (expected === actual) return 2;
  const ordered = ["해결됨", "부분 해결·구현 진행 중", "진행 중"];
  const expectedIndex = ordered.indexOf(expected);
  const actualIndex = ordered.indexOf(actual);
  return expectedIndex >= 0 && actualIndex >= 0 && Math.abs(expectedIndex - actualIndex) === 1
    ? 1
    : 0;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}
