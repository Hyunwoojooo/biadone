import { JWT } from "google-auth-library";

import type { CanonicalConversation } from "../types/conversation";
import {
  buildGoldenSheetBundle,
  type GoldenSheetBundle
} from "./goldenSheetMapper";

const DEFAULT_GOLDEN_SHEET_ID = "1_xJUjB3zy68CKZ0zdBt15vDaqWPwFmoIzANRhnOzGBQ";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

const TAB = {
  sessions: "00_세션목록",
  messages: "01_전체메시지",
  prompts: "02_프롬프트판정",
  summaries: "03_세션요약"
} as const;

type FetchLike = typeof fetch;

export type GoldenSheetConfig = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
};

export type GoldenSheetSyncResult = {
  status: "created" | "duplicate";
  sessionId: string;
  sessionRow: number;
  messageCount: number;
  promptCount: number;
  spreadsheetUrl: string;
};

type GoldenSheetSyncDependencies = {
  config?: GoldenSheetConfig;
  fetchImpl?: FetchLike;
  getAccessToken?: () => Promise<string>;
};

type BatchGetResponse = {
  valueRanges?: Array<{
    range?: string;
    values?: unknown[][];
  }>;
};

type ValueRange = {
  range: string;
  majorDimension: "ROWS";
  values: Array<Array<string | number>>;
};

export class GoldenSheetConfigError extends Error {
  readonly code = "GOLDEN_SHEET_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "GoldenSheetConfigError";
  }
}

export class GoldenSheetApiError extends Error {
  readonly code = "GOLDEN_SHEET_API_ERROR";
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoldenSheetApiError";
    this.status = status;
  }
}

export class GoldenSheetCapacityError extends Error {
  readonly code = "GOLDEN_SHEET_CAPACITY_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "GoldenSheetCapacityError";
  }
}

export async function syncAnalysisToGoldenSheet(
  input: {
    analysisId: string;
    shareUrl: string;
    conversation: CanonicalConversation;
  },
  dependencies: GoldenSheetSyncDependencies = {}
): Promise<GoldenSheetSyncResult> {
  const config = dependencies.config ?? readGoldenSheetConfig();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const accessToken = dependencies.getAccessToken
    ? await dependencies.getAccessToken()
    : await authorize(config);
  const existing = await readExistingSheetState(config, accessToken, fetchImpl);
  const normalizedUrl = input.conversation.source.normalizedUrl;
  const duplicateIndex = existing.sessions.findIndex((row) => {
    const savedUrl = cellString(row[2]);
    return savedUrl === input.shareUrl || savedUrl === normalizedUrl;
  });

  if (duplicateIndex >= 0) {
    const sessionId = cellString(existing.sessions[duplicateIndex]?.[0]);
    const sessionRow = duplicateIndex + 2;
    return {
      status: "duplicate",
      sessionId,
      sessionRow,
      messageCount: 0,
      promptCount: 0,
      spreadsheetUrl: sheetRowUrl(config.spreadsheetId, 2000, sessionRow)
    };
  }

  const sessionId = nextSessionId(existing.sessions);
  const sessionRow = nextRow(existing.sessions, 2);
  const messageStartRow = nextRow(existing.messageSessionIds, 2);
  const promptStartRow = nextRow(existing.promptSessionIds, 2);
  const bundle = buildGoldenSheetBundle({
    analysisId: input.analysisId,
    sessionId,
    shareUrl: input.shareUrl,
    conversation: input.conversation
  });

  assertCapacity({
    sessionRow,
    messageStartRow,
    messageCount: bundle.messages.length,
    promptStartRow,
    promptCount: bundle.prompts.length
  });

  const data = buildValueRanges({
    bundle,
    sessionRow,
    messageStartRow,
    promptStartRow
  });
  await batchUpdateValues(config, accessToken, data, fetchImpl);

  return {
    status: "created",
    sessionId,
    sessionRow,
    messageCount: bundle.messages.length,
    promptCount: bundle.prompts.length,
    spreadsheetUrl: sheetRowUrl(config.spreadsheetId, 2000, sessionRow)
  };
}

export function readGoldenSheetConfig(
  environment: Record<string, string | undefined> = process.env
): GoldenSheetConfig {
  const spreadsheetId =
    environment.BLABASE_GOLDEN_SHEET_ID?.trim() || DEFAULT_GOLDEN_SHEET_ID;
  const clientEmail = environment.BLABASE_GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey =
    environment.BLABASE_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replaceAll(
      "\\n",
      "\n"
    ).trim();

  if (!clientEmail || !privateKey) {
    throw new GoldenSheetConfigError(
      "Google Sheets 연동 환경변수가 없습니다. 서비스 계정 이메일과 비공개 키를 설정해주세요."
    );
  }

  return { spreadsheetId, clientEmail, privateKey };
}

export function nextSessionId(sessionRows: unknown[][]): string {
  const largest = sessionRows.reduce((max, row) => {
    const match = /^S-(\d+)$/.exec(cellString(row[0]));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `S-${String(largest + 1).padStart(3, "0")}`;
}

function buildValueRanges(input: {
  bundle: GoldenSheetBundle;
  sessionRow: number;
  messageStartRow: number;
  promptStartRow: number;
}): ValueRange[] {
  const { bundle, sessionRow, messageStartRow, promptStartRow } = input;
  const session = bundle.session;
  const ranges: ValueRange[] = [
    valueRange(`'${TAB.sessions}'!A${sessionRow}:E${sessionRow}`, [
      [
        session.sessionId,
        session.title,
        session.shareUrl,
        session.sourceType,
        session.importedDate
      ]
    ]),
    valueRange(`'${TAB.sessions}'!H${sessionRow}`, [[session.labelingStatus]]),
    valueRange(`'${TAB.sessions}'!K${sessionRow}:L${sessionRow}`, [
      [session.datasetSplit, session.memo]
    ]),
    valueRange(`'${TAB.sessions}'!M${sessionRow}:O${sessionRow}`, [
      [
        toGoogleSheetsDateTime(session.startedAt),
        toGoogleSheetsDateTime(session.endedAt),
        session.durationSeconds ?? ""
      ]
    ]),
    valueRange(`'${TAB.summaries}'!A${sessionRow}:B${sessionRow}`, [
      [bundle.sessionSummary.sessionId, bundle.sessionSummary.title]
    ])
  ];

  if (bundle.messages.length > 0) {
    const messageEndRow = messageStartRow + bundle.messages.length - 1;
    ranges.push(
      valueRange(
        `'${TAB.messages}'!A${messageStartRow}:B${messageEndRow}`,
        bundle.messages.map((row) => [row.sessionId, row.messageId])
      ),
      valueRange(
        `'${TAB.messages}'!C${messageStartRow}:I${messageEndRow}`,
        bundle.messages.map((row) => [
          row.conversationOrder,
          row.originalMessageNumber,
          row.speaker,
          row.originalText,
          row.messageClassification,
          row.analysisTarget,
          row.note
        ])
      ),
      valueRange(
        `'${TAB.messages}'!J${messageStartRow}:K${messageEndRow}`,
        bundle.messages.map((row) => [
          toGoogleSheetsDateTime(row.createdAt),
          toGoogleSheetsDateTime(row.updatedAt)
        ])
      )
    );
  }

  if (bundle.prompts.length > 0) {
    const promptEndRow = promptStartRow + bundle.prompts.length - 1;
    ranges.push(
      valueRange(
        `'${TAB.prompts}'!A${promptStartRow}:B${promptEndRow}`,
        bundle.prompts.map((row) => [row.originalPrompt, row.sessionId])
      ),
      valueRange(
        `'${TAB.prompts}'!D${promptStartRow}:G${promptEndRow}`,
        bundle.prompts.map((row) => [
          row.promptOrder,
          row.userMessageId,
          row.previousAssistantMessageId,
          row.promptRole
        ])
      ),
      valueRange(
        `'${TAB.prompts}'!Q${promptStartRow}:Q${promptEndRow}`,
        bundle.prompts.map((row) => [row.previousAnswerEvaluation])
      ),
      valueRange(
        `'${TAB.prompts}'!T${promptStartRow}:U${promptEndRow}`,
        bundle.prompts.map((row) => [row.authorJudgment, row.reviewResult])
      ),
      valueRange(
        `'${TAB.prompts}'!W${promptStartRow}:Y${promptEndRow}`,
        bundle.prompts.map((row) => [
          toGoogleSheetsDateTime(row.promptCreatedAt),
          toGoogleSheetsDateTime(row.answerCompletedAt),
          row.responseDurationSeconds ?? ""
        ])
      )
    );
  }

  return ranges;
}

function toGoogleSheetsDateTime(value: string | null): string | number {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  // Google Sheets의 숫자형 날짜는 timezone 정보가 없으므로 KST wall time으로 기록한다.
  return timestamp / 86_400_000 + 25_569 + 9 / 24;
}

async function authorize(config: GoldenSheetConfig): Promise<string> {
  try {
    const client = new JWT({
      email: config.clientEmail,
      key: config.privateKey,
      scopes: [SHEETS_SCOPE]
    });
    const credentials = await client.authorize();
    if (!credentials.access_token) {
      throw new Error("Google OAuth access token was empty.");
    }
    return credentials.access_token;
  } catch (error) {
    throw new GoldenSheetConfigError(
      error instanceof Error
        ? `Google 서비스 계정 인증에 실패했습니다: ${error.message}`
        : "Google 서비스 계정 인증에 실패했습니다."
    );
  }
}

async function readExistingSheetState(
  config: GoldenSheetConfig,
  accessToken: string,
  fetchImpl: FetchLike
): Promise<{
  sessions: unknown[][];
  messageSessionIds: unknown[][];
  promptSessionIds: unknown[][];
}> {
  const url = new URL(
    `${SHEETS_API_BASE}/${encodeURIComponent(config.spreadsheetId)}/values:batchGet`
  );
  [
    `'${TAB.sessions}'!A2:C101`,
    `'${TAB.messages}'!A2:A10000`,
    `'${TAB.prompts}'!B2:B3000`
  ].forEach((range) => url.searchParams.append("ranges", range));
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");

  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const payload = await parseJson<BatchGetResponse>(response);
  if (!response.ok) {
    throw sheetsApiError(response.status, payload);
  }
  const ranges = payload.valueRanges ?? [];

  return {
    sessions: ranges[0]?.values ?? [],
    messageSessionIds: ranges[1]?.values ?? [],
    promptSessionIds: ranges[2]?.values ?? []
  };
}

async function batchUpdateValues(
  config: GoldenSheetConfig,
  accessToken: string,
  data: ValueRange[],
  fetchImpl: FetchLike
): Promise<void> {
  const response = await fetchImpl(
    `${SHEETS_API_BASE}/${encodeURIComponent(config.spreadsheetId)}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        // 공유 대화 원문이 수식으로 해석되지 않도록 모든 값은 literal로 기록한다.
        valueInputOption: "RAW",
        includeValuesInResponse: false,
        data
      })
    }
  );
  const payload = await parseJson<unknown>(response);
  if (!response.ok) {
    throw sheetsApiError(response.status, payload);
  }
}

function assertCapacity(input: {
  sessionRow: number;
  messageStartRow: number;
  messageCount: number;
  promptStartRow: number;
  promptCount: number;
}) {
  const messageEndRow = input.messageStartRow + input.messageCount - 1;
  const promptEndRow = input.promptStartRow + input.promptCount - 1;
  if (input.sessionRow > 101) {
    throw new GoldenSheetCapacityError(
      "00_세션목록의 100개 세션 한도를 초과했습니다."
    );
  }
  if (input.messageCount > 0 && messageEndRow > 10000) {
    throw new GoldenSheetCapacityError(
      "01_전체메시지의 9,999개 데이터 행 한도를 초과했습니다."
    );
  }
  if (input.promptCount > 0 && promptEndRow > 3000) {
    throw new GoldenSheetCapacityError(
      "02_프롬프트판정의 2,999개 데이터 행 한도를 초과했습니다."
    );
  }
}

function nextRow(rows: unknown[][], firstDataRow: number): number {
  let lastNonEmptyIndex = -1;
  rows.forEach((row, index) => {
    if (row.some((cell) => cellString(cell) !== "")) {
      lastNonEmptyIndex = index;
    }
  });
  return firstDataRow + lastNonEmptyIndex + 1;
}

function valueRange(
  range: string,
  values: Array<Array<string | number>>
): ValueRange {
  return { range, majorDimension: "ROWS", values };
}

function sheetRowUrl(
  spreadsheetId: string,
  sheetId: number,
  row: number
): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit#gid=${sheetId}&range=A${row}`;
}

function cellString(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as T;
  }
}

function sheetsApiError(status: number, payload: unknown): GoldenSheetApiError {
  const message = extractApiMessage(payload);
  return new GoldenSheetApiError(
    message
      ? `Google Sheets API 요청에 실패했습니다: ${message}`
      : "Google Sheets API 요청에 실패했습니다.",
    status
  );
}

function extractApiMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}
