import { z } from "zod";

import { hashGoldenSnapshot } from "./evaluation";
import {
  GOLDEN_BASELINE_DATASET_VERSION,
  PROMPT_FIELDS,
  SESSION_JUDGMENTS,
  SUMMARY_FIELDS,
  type GoldenBaselineInput
} from "./schema";

export const GOLDEN_DATA_QUALITY_VERSION = "golden-quality-v1";

export type GoldenDataQualitySeverity = "error" | "warning" | "info";
export type GoldenDataQualityStatus = "pass" | "warning" | "error";
export type GoldenDataQualityEntity =
  "dataset" | "session" | "prompt" | "summary";

export type GoldenDataQualityIssue = {
  severity: GoldenDataQualitySeverity;
  code: string;
  entityType: GoldenDataQualityEntity;
  sessionId?: string;
  targetId?: string;
  field?: string;
  message: string;
};

export type GoldenDatasetQualityProfile = {
  name: string;
  datasetVersion: string;
  sessionStart: string;
  sessionEnd: string;
  sessionCount: number;
  promptCount: number;
  summaryCount: number;
};

export type GoldenDatasetQualityReport = {
  reportVersion: string;
  generatedAt: string;
  datasetVersion: string | null;
  goldSnapshotSha256: string | null;
  profile: string | null;
  status: GoldenDataQualityStatus;
  counts: {
    sessions: number;
    prompts: number;
    summaries: number;
    approvedPrompts: number;
    approvedSummaries: number;
    affectedRecords: number;
  };
  issueCounts: {
    error: number;
    warning: number;
    info: number;
    byCode: Record<string, number>;
  };
  issues: GoldenDataQualityIssue[];
};

type InspectOptions = {
  generatedAt?: string;
  profile?: GoldenDatasetQualityProfile | null;
};

const sessionSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  shareUrl: z.string()
});

const promptSchema = z.object({
  sessionId: z.string(),
  promptId: z.string(),
  promptOrder: z.union([z.string(), z.number()]),
  userMessageId: z.string(),
  previousAssistantMessageId: z.string(),
  promptRole: z.string(),
  inputIntent: z.string(),
  requestedTask: z.string(),
  desiredResult: z.string(),
  evaluationPoints: z.string(),
  reviewResult: z.string()
});

const summarySchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  purpose: z.string(),
  currentState: z.string(),
  flow: z.string(),
  decisions: z.string(),
  changes: z.string(),
  openQuestions: z.string(),
  deliverables: z.string(),
  sessionJudgment: z.string(),
  authorJudgment: z.string(),
  reviewResult: z.string()
});

const goldenBaselineInputSchema = z.object({
  datasetVersion: z.string(),
  sourceSpreadsheetId: z.string(),
  scope: z.object({
    sessionStart: z.string(),
    sessionEnd: z.string(),
    includedPromptFields: z.array(z.string()),
    includedSummaryFields: z.array(z.string()),
    excluded: z.array(z.string())
  }),
  sessions: z.array(sessionSchema),
  prompts: z.array(promptSchema),
  summaries: z.array(summarySchema)
});

const SESSION_ID_PATTERN = /^S-\d{3}$/;
const PROMPT_ID_PATTERN = /^S-\d{3}-P\d{3}$/;
const MESSAGE_ID_PATTERN = /^S-\d{3}-M\d{3}$/;
const CANCELLATION_PATTERN =
  /(?:취소|cancelled?|canceled?|esc\b.*(?:잘\s*못|실수)|잘\s*못\s*눌)/iu;
const PENDING_SUMMARY_JUDGMENTS = new Set(["검토 필요", "판정 보류"]);

export const GOLD_CORE_V01_QUALITY_PROFILE: GoldenDatasetQualityProfile = {
  name: "gold-core-v0.1-profile",
  datasetVersion: GOLDEN_BASELINE_DATASET_VERSION,
  sessionStart: "S-001",
  sessionEnd: "S-020",
  sessionCount: 20,
  promptCount: 233,
  summaryCount: 20
};

export function profileForGoldenDataset(
  datasetVersion: string
): GoldenDatasetQualityProfile | null {
  return datasetVersion === GOLD_CORE_V01_QUALITY_PROFILE.datasetVersion
    ? GOLD_CORE_V01_QUALITY_PROFILE
    : null;
}

export function inspectGoldenDataset(
  value: unknown,
  options: InspectOptions = {}
): GoldenDatasetQualityReport {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const parsed = goldenBaselineInputSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map<GoldenDataQualityIssue>((issue) => ({
        severity: "error",
        code: "INPUT_SCHEMA_INVALID",
        entityType: "dataset",
        field: issue.path.join("."),
        message: "Golden Dataset 입력 구조가 필수 계약과 일치하지 않습니다."
      }))
      .sort(compareIssues);
    return buildReport({
      generatedAt,
      datasetVersion: looseDatasetVersion(value),
      goldSnapshotSha256: null,
      profile: options.profile?.name ?? null,
      input: null,
      issues
    });
  }

  const input = parsed.data as GoldenBaselineInput;
  const profile =
    options.profile === undefined
      ? profileForGoldenDataset(input.datasetVersion)
      : options.profile;
  const issues: GoldenDataQualityIssue[] = [];
  const add = (issue: GoldenDataQualityIssue) => issues.push(issue);

  inspectDatasetContract(input, profile, add);
  inspectSessions(input, add);
  inspectPrompts(input, add);
  inspectSummaries(input, add);
  inspectRelationships(input, add);

  issues.sort(compareIssues);
  return buildReport({
    generatedAt,
    datasetVersion: input.datasetVersion,
    goldSnapshotSha256: hashGoldenSnapshot(input),
    profile: profile?.name ?? null,
    input,
    issues
  });
}

function inspectDatasetContract(
  input: GoldenBaselineInput,
  profile: GoldenDatasetQualityProfile | null,
  add: (issue: GoldenDataQualityIssue) => void
) {
  if (!input.sourceSpreadsheetId.trim()) {
    add({
      severity: "error",
      code: "SOURCE_ID_MISSING",
      entityType: "dataset",
      field: "sourceSpreadsheetId",
      message: "원본 Spreadsheet 식별자가 비어 있습니다."
    });
  }
  if (!sameMembers(input.scope.includedPromptFields, PROMPT_FIELDS)) {
    add({
      severity: "error",
      code: "PROMPT_SCOPE_FIELDS_MISMATCH",
      entityType: "dataset",
      field: "scope.includedPromptFields",
      message: "프롬프트 Gold 범위가 현재 필드 계약과 일치하지 않습니다."
    });
  }
  if (!sameMembers(input.scope.includedSummaryFields, SUMMARY_FIELDS)) {
    add({
      severity: "error",
      code: "SUMMARY_SCOPE_FIELDS_MISMATCH",
      entityType: "dataset",
      field: "scope.includedSummaryFields",
      message: "세션 요약 Gold 범위가 현재 필드 계약과 일치하지 않습니다."
    });
  }
  if (!profile) return;

  if (input.datasetVersion !== profile.datasetVersion) {
    add({
      severity: "error",
      code: "DATASET_VERSION_MISMATCH",
      entityType: "dataset",
      field: "datasetVersion",
      message: "Dataset 버전이 선택된 품질 프로필과 일치하지 않습니다."
    });
  }
  if (
    input.scope.sessionStart !== profile.sessionStart ||
    input.scope.sessionEnd !== profile.sessionEnd
  ) {
    add({
      severity: "error",
      code: "SESSION_SCOPE_MISMATCH",
      entityType: "dataset",
      field: "scope",
      message: "세션 범위가 동결된 품질 프로필과 일치하지 않습니다."
    });
  }
  compareCount(
    "SESSION_COUNT_MISMATCH",
    input.sessions.length,
    profile.sessionCount
  );
  compareCount(
    "PROMPT_COUNT_MISMATCH",
    input.prompts.length,
    profile.promptCount
  );
  compareCount(
    "SUMMARY_COUNT_MISMATCH",
    input.summaries.length,
    profile.summaryCount
  );

  function compareCount(code: string, actual: number, expected: number) {
    if (actual === expected) return;
    add({
      severity: "error",
      code,
      entityType: "dataset",
      message: `레코드 수가 동결된 품질 프로필과 일치하지 않습니다 (expected=${expected}, actual=${actual}).`
    });
  }
}

function inspectSessions(
  input: GoldenBaselineInput,
  add: (issue: GoldenDataQualityIssue) => void
) {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (const session of input.sessions) {
    if (!SESSION_ID_PATTERN.test(session.sessionId)) {
      add({
        severity: "error",
        code: "SESSION_ID_INVALID",
        entityType: "session",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        field: "sessionId",
        message: "세션 ID가 S-000 형식과 일치하지 않습니다."
      });
    }
    if (seenIds.has(session.sessionId)) {
      add({
        severity: "error",
        code: "SESSION_ID_DUPLICATE",
        entityType: "session",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        message: "동일한 세션 ID가 두 번 이상 존재합니다."
      });
    }
    seenIds.add(session.sessionId);

    if (!session.title.trim()) {
      add({
        severity: "warning",
        code: "SESSION_TITLE_EMPTY",
        entityType: "session",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        field: "title",
        message: "세션 제목이 비어 있어 사람이 확인해야 합니다."
      });
    }
    const normalizedUrl = normalizeUrl(session.shareUrl);
    if (!normalizedUrl) {
      add({
        severity: "error",
        code: "SESSION_SHARE_URL_INVALID",
        entityType: "session",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        field: "shareUrl",
        message: "공유 링크가 유효한 HTTP(S) URL이 아닙니다."
      });
    } else if (seenUrls.has(normalizedUrl)) {
      add({
        severity: "error",
        code: "SESSION_SHARE_URL_DUPLICATE",
        entityType: "session",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        field: "shareUrl",
        message: "동일한 공유 링크가 여러 세션에 연결되어 있습니다."
      });
    } else {
      seenUrls.add(normalizedUrl);
    }
  }
}

function inspectPrompts(
  input: GoldenBaselineInput,
  add: (issue: GoldenDataQualityIssue) => void
) {
  const seenPromptIds = new Set<string>();
  const seenUserMessageIds = new Set<string>();
  const ordersBySession = new Map<string, Set<number>>();
  for (const prompt of input.prompts) {
    const reference = {
      entityType: "prompt" as const,
      sessionId: prompt.sessionId,
      targetId: prompt.promptId
    };
    if (!PROMPT_ID_PATTERN.test(prompt.promptId)) {
      add({
        ...reference,
        severity: "error",
        code: "PROMPT_ID_INVALID",
        field: "promptId",
        message: "프롬프트 ID가 S-000-P000 형식과 일치하지 않습니다."
      });
    }
    if (!prompt.promptId.startsWith(`${prompt.sessionId}-P`)) {
      add({
        ...reference,
        severity: "error",
        code: "PROMPT_SESSION_ID_MISMATCH",
        field: "promptId",
        message: "프롬프트 ID와 소속 세션 ID가 일치하지 않습니다."
      });
    }
    if (seenPromptIds.has(prompt.promptId)) {
      add({
        ...reference,
        severity: "error",
        code: "PROMPT_ID_DUPLICATE",
        message: "동일한 프롬프트 ID가 두 번 이상 존재합니다."
      });
    }
    seenPromptIds.add(prompt.promptId);

    inspectMessageId(
      prompt.userMessageId,
      prompt.sessionId,
      "userMessageId",
      reference,
      add
    );
    if (seenUserMessageIds.has(prompt.userMessageId)) {
      add({
        ...reference,
        severity: "error",
        code: "USER_MESSAGE_ID_DUPLICATE",
        field: "userMessageId",
        message: "동일한 사용자 메시지 ID가 여러 프롬프트에 연결되어 있습니다."
      });
    }
    seenUserMessageIds.add(prompt.userMessageId);
    if (prompt.previousAssistantMessageId.trim()) {
      inspectMessageId(
        prompt.previousAssistantMessageId,
        prompt.sessionId,
        "previousAssistantMessageId",
        reference,
        add
      );
    }

    const order = Number(prompt.promptOrder);
    if (!Number.isInteger(order) || order <= 0) {
      add({
        ...reference,
        severity: "error",
        code: "PROMPT_ORDER_INVALID",
        field: "promptOrder",
        message: "프롬프트 순서가 양의 정수가 아닙니다."
      });
    } else {
      const seenOrders =
        ordersBySession.get(prompt.sessionId) ?? new Set<number>();
      if (seenOrders.has(order)) {
        add({
          ...reference,
          severity: "error",
          code: "PROMPT_ORDER_DUPLICATE",
          field: "promptOrder",
          message: "동일 세션에 같은 프롬프트 순서가 두 번 이상 존재합니다."
        });
      }
      seenOrders.add(order);
      ordersBySession.set(prompt.sessionId, seenOrders);
    }

    if (prompt.reviewResult !== "승인") {
      add({
        ...reference,
        severity: "error",
        code: "PROMPT_NOT_APPROVED",
        field: "reviewResult",
        message: "동결 입력에는 승인되지 않은 프롬프트가 포함될 수 없습니다."
      });
    }

    const values = PROMPT_FIELDS.map((field) => prompt[field].trim());
    PROMPT_FIELDS.forEach((field, index) => {
      if (!values[index]) {
        add({
          ...reference,
          severity: "warning",
          code: "PROMPT_GOLD_EMPTY",
          field,
          message: "프롬프트 Gold 필드가 비어 있어 사람이 확인해야 합니다."
        });
      }
    });
    const allIdentical = values.every(
      (value) => value.length > 0 && value === values[0]
    );
    if (allIdentical && CANCELLATION_PATTERN.test(values[0])) {
      add({
        ...reference,
        severity: "warning",
        code: "PROMPT_CANCELLED_INPUT",
        message:
          "취소 또는 오입력 표시가 모든 프롬프트 Gold 필드에 반복되어 있습니다."
      });
    } else if (allIdentical) {
      add({
        ...reference,
        severity: "warning",
        code: "PROMPT_GOLD_FIELDS_IDENTICAL",
        message: "네 프롬프트 Gold 필드가 동일해 사람이 확인해야 합니다."
      });
    }
  }
}

function inspectSummaries(
  input: GoldenBaselineInput,
  add: (issue: GoldenDataQualityIssue) => void
) {
  const seenSessionIds = new Set<string>();
  for (const summary of input.summaries) {
    const reference = {
      entityType: "summary" as const,
      sessionId: summary.sessionId,
      targetId: summary.sessionId
    };
    if (seenSessionIds.has(summary.sessionId)) {
      add({
        ...reference,
        severity: "error",
        code: "SUMMARY_SESSION_DUPLICATE",
        message: "동일 세션의 요약이 두 번 이상 존재합니다."
      });
    }
    seenSessionIds.add(summary.sessionId);

    if (summary.reviewResult !== "승인") {
      add({
        ...reference,
        severity: "error",
        code: "SUMMARY_NOT_APPROVED",
        field: "reviewResult",
        message: "동결 입력에는 승인되지 않은 세션 요약이 포함될 수 없습니다."
      });
    }
    if (PENDING_SUMMARY_JUDGMENTS.has(summary.authorJudgment.trim())) {
      add({
        ...reference,
        severity: "warning",
        code: "SUMMARY_AUTHOR_REVIEW_PENDING",
        field: "authorJudgment",
        message: "작성자 판정이 보류 또는 검토 필요 상태입니다."
      });
    }
    if (
      !SESSION_JUDGMENTS.includes(
        summary.sessionJudgment as (typeof SESSION_JUDGMENTS)[number]
      )
    ) {
      add({
        ...reference,
        severity: "error",
        code: "SESSION_JUDGMENT_INVALID",
        field: "sessionJudgment",
        message: "세션 판정이 허용된 상태 계약과 일치하지 않습니다."
      });
    }
    SUMMARY_FIELDS.forEach((field) => {
      if (!summary[field].trim()) {
        add({
          ...reference,
          severity: "warning",
          code: "SUMMARY_GOLD_EMPTY",
          field,
          message: "세션 요약 Gold 필드가 비어 있어 사람이 확인해야 합니다."
        });
      }
    });
  }
}

function inspectRelationships(
  input: GoldenBaselineInput,
  add: (issue: GoldenDataQualityIssue) => void
) {
  const sessionIds = new Set(
    input.sessions.map((session) => session.sessionId)
  );
  const promptSessionIds = new Set(
    input.prompts.map((prompt) => prompt.sessionId)
  );
  const summariesBySession = new Map(
    input.summaries.map((summary) => [summary.sessionId, summary])
  );

  for (const prompt of input.prompts) {
    if (!sessionIds.has(prompt.sessionId)) {
      add({
        severity: "error",
        code: "PROMPT_SESSION_ORPHAN",
        entityType: "prompt",
        sessionId: prompt.sessionId,
        targetId: prompt.promptId,
        message: "프롬프트가 세션 목록에 없는 세션을 참조합니다."
      });
    }
  }
  for (const summary of input.summaries) {
    if (!sessionIds.has(summary.sessionId)) {
      add({
        severity: "error",
        code: "SUMMARY_SESSION_ORPHAN",
        entityType: "summary",
        sessionId: summary.sessionId,
        targetId: summary.sessionId,
        message: "세션 요약이 세션 목록에 없는 세션을 참조합니다."
      });
    }
  }
  for (const session of input.sessions) {
    if (!promptSessionIds.has(session.sessionId)) {
      add({
        severity: "error",
        code: "SESSION_PROMPTS_MISSING",
        entityType: "session",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        message: "세션에 연결된 프롬프트 Gold가 없습니다."
      });
    }
    const summary = summariesBySession.get(session.sessionId);
    if (!summary) {
      add({
        severity: "error",
        code: "SESSION_SUMMARY_MISSING",
        entityType: "session",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        message: "세션에 연결된 세션 요약 Gold가 없습니다."
      });
    } else if (session.title.trim() !== summary.title.trim()) {
      add({
        severity: "warning",
        code: "SESSION_SUMMARY_TITLE_MISMATCH",
        entityType: "summary",
        sessionId: session.sessionId,
        targetId: session.sessionId,
        field: "title",
        message: "세션 목록과 세션 요약의 제목이 일치하지 않습니다."
      });
    }
  }
  if (!sessionIds.has(input.scope.sessionStart)) {
    add({
      severity: "error",
      code: "SCOPE_START_SESSION_MISSING",
      entityType: "dataset",
      field: "scope.sessionStart",
      message: "범위 시작 세션이 세션 목록에 없습니다."
    });
  }
  if (!sessionIds.has(input.scope.sessionEnd)) {
    add({
      severity: "error",
      code: "SCOPE_END_SESSION_MISSING",
      entityType: "dataset",
      field: "scope.sessionEnd",
      message: "범위 종료 세션이 세션 목록에 없습니다."
    });
  }
}

function inspectMessageId(
  messageId: string,
  sessionId: string,
  field: string,
  reference: Pick<
    GoldenDataQualityIssue,
    "entityType" | "sessionId" | "targetId"
  >,
  add: (issue: GoldenDataQualityIssue) => void
) {
  if (!MESSAGE_ID_PATTERN.test(messageId)) {
    add({
      ...reference,
      severity: "error",
      code: "MESSAGE_ID_INVALID",
      field,
      message: "메시지 ID가 S-000-M000 형식과 일치하지 않습니다."
    });
  } else if (!messageId.startsWith(`${sessionId}-M`)) {
    add({
      ...reference,
      severity: "error",
      code: "MESSAGE_SESSION_ID_MISMATCH",
      field,
      message: "메시지 ID와 소속 세션 ID가 일치하지 않습니다."
    });
  }
}

function buildReport(inputValue: {
  generatedAt: string;
  datasetVersion: string | null;
  goldSnapshotSha256: string | null;
  profile: string | null;
  input: GoldenBaselineInput | null;
  issues: GoldenDataQualityIssue[];
}): GoldenDatasetQualityReport {
  const error = inputValue.issues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const warning = inputValue.issues.filter(
    (issue) => issue.severity === "warning"
  ).length;
  const info = inputValue.issues.filter(
    (issue) => issue.severity === "info"
  ).length;
  const byCode: Record<string, number> = {};
  const affectedRecords = new Set<string>();
  for (const issue of inputValue.issues) {
    byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
    affectedRecords.add(
      `${issue.entityType}:${issue.targetId ?? issue.field ?? "dataset"}`
    );
  }
  return {
    reportVersion: GOLDEN_DATA_QUALITY_VERSION,
    generatedAt: inputValue.generatedAt,
    datasetVersion: inputValue.datasetVersion,
    goldSnapshotSha256: inputValue.goldSnapshotSha256,
    profile: inputValue.profile,
    status: error > 0 ? "error" : warning > 0 ? "warning" : "pass",
    counts: {
      sessions: inputValue.input?.sessions.length ?? 0,
      prompts: inputValue.input?.prompts.length ?? 0,
      summaries: inputValue.input?.summaries.length ?? 0,
      approvedPrompts:
        inputValue.input?.prompts.filter((row) => row.reviewResult === "승인")
          .length ?? 0,
      approvedSummaries:
        inputValue.input?.summaries.filter((row) => row.reviewResult === "승인")
          .length ?? 0,
      affectedRecords: affectedRecords.size
    },
    issueCounts: {
      error,
      warning,
      info,
      byCode
    },
    issues: inputValue.issues
  };
}

function compareIssues(
  left: GoldenDataQualityIssue,
  right: GoldenDataQualityIssue
) {
  const severityOrder: Record<GoldenDataQualitySeverity, number> = {
    error: 0,
    warning: 1,
    info: 2
  };
  return (
    severityOrder[left.severity] - severityOrder[right.severity] ||
    (left.sessionId ?? "").localeCompare(right.sessionId ?? "") ||
    (left.targetId ?? "").localeCompare(right.targetId ?? "") ||
    left.code.localeCompare(right.code) ||
    (left.field ?? "").localeCompare(right.field ?? "")
  );
}

function sameMembers(actual: string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === expected.length &&
    expected.every((field) => actual.includes(field))
  );
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    if (url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

function looseDatasetVersion(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const datasetVersion = (value as { datasetVersion?: unknown }).datasetVersion;
  return typeof datasetVersion === "string" ? datasetVersion : null;
}
