import { execFile as nodeExecFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { sha256Canonical } from "../crossSourceIntegrity";

export const DAYFLOW_CAPTURE_WINDOW_CANDIDATE_IDENTITY_V1 =
  "blabase.dayflow-capture-window-candidate.v1" as const;
export const DAYFLOW_CAPTURE_WINDOW_SELECTED_ROWS_HASH_DOMAIN_V1 =
  "blabase.dayflow-capture-window-selected-rows.v1" as const;
export const DAYFLOW_CAPTURE_WINDOW_DURATION_SECONDS_V1 = 600 as const;
export const DAYFLOW_CAPTURE_WINDOW_REVIEW_STATUS_V1 =
  "pending_colin_review" as const;

export const DAYFLOW_CAPTURE_WINDOW_MAX_SCREENSHOTS_V1 = 4_096;
export const DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATIONS_V1 = 1_024;
export const DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATION_TEXT_BYTES_V1 = 65_536;
export const DAYFLOW_CAPTURE_WINDOW_MAX_TOTAL_OBSERVATION_TEXT_BYTES_V1 =
  1_048_576;
export const DAYFLOW_CAPTURE_WINDOW_MAX_SQLITE_STDOUT_BYTES_V1 = 2_097_152;

const MAX_DATABASE_PATH_BYTES = 4_096;
const MAX_SQLITE_EXECUTABLE_BYTES = 4_096;
const SQLITE_TIMEOUT_MS = 30_000;

export type DayflowCaptureWindowCandidateIssueCodeV1 =
  | "INPUT_INVALID"
  | "DATABASE_UNSAFE"
  | "DATABASE_CHANGED"
  | "SQLITE_EXECUTION_FAILED"
  | "SQLITE_OUTPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED";

const ISSUE_MESSAGES: Readonly<
  Record<DayflowCaptureWindowCandidateIssueCodeV1, string>
> = Object.freeze({
  INPUT_INVALID: "Dayflow capture window input is invalid.",
  DATABASE_UNSAFE: "Dayflow database file is unsafe.",
  DATABASE_CHANGED: "Dayflow database identity changed during the read.",
  SQLITE_EXECUTION_FAILED: "Dayflow database query failed.",
  SQLITE_OUTPUT_INVALID: "Dayflow database query returned invalid rows.",
  RESOURCE_LIMIT_EXCEEDED: "Dayflow capture window resource limit exceeded.",
});

export class DayflowCaptureWindowCandidateErrorV1 extends Error {
  override readonly name = "DayflowCaptureWindowCandidateErrorV1";
  readonly issueCode: DayflowCaptureWindowCandidateIssueCodeV1;

  constructor(issueCode: DayflowCaptureWindowCandidateIssueCodeV1) {
    super(ISSUE_MESSAGES[issueCode]);
    this.issueCode = issueCode;
    Object.freeze(this);
  }
}

export interface DayflowSqliteExecutionRequestV1 {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly maxStdoutBytes: number;
}

export type DayflowSqliteExecutorV1 = (
  request: DayflowSqliteExecutionRequestV1,
) => Promise<string>;

export interface ReadDayflowCaptureWindowCandidateV1Input {
  readonly databasePath: string;
  readonly windowStartEpochSecond: number;
  readonly windowEndEpochSecond: number;
  readonly sqliteExecutable?: string;
  readonly executeSqlite?: DayflowSqliteExecutorV1;
}

export interface DayflowCaptureWindowScreenshotV1 {
  readonly screenshotId: number;
  readonly capturedAtEpochSecond: number;
  readonly fileSizeBytes: number | null;
  readonly idleSecondsAtCapture: number | null;
}

export interface DayflowCaptureWindowObservationV1 {
  readonly observationId: number;
  readonly startEpochSecond: number;
  readonly endEpochSecond: number;
  readonly text: string;
}

export interface DayflowCaptureWindowCandidateV1 {
  readonly identity: typeof DAYFLOW_CAPTURE_WINDOW_CANDIDATE_IDENTITY_V1;
  readonly window: Readonly<{
    startEpochSecond: number;
    endEpochSecond: number;
    inclusiveDurationSeconds: typeof DAYFLOW_CAPTURE_WINDOW_DURATION_SECONDS_V1;
  }>;
  readonly screenshots: readonly DayflowCaptureWindowScreenshotV1[];
  readonly observations: readonly DayflowCaptureWindowObservationV1[];
  readonly counts: Readonly<{
    screenshotCount: number;
    observationCount: number;
    selectedRowCount: number;
  }>;
  readonly selectedRowsSha256: string;
  readonly reviewStatus: typeof DAYFLOW_CAPTURE_WINDOW_REVIEW_STATUS_V1;
}

interface CapturedInput {
  readonly databasePath: string;
  readonly windowStartEpochSecond: number;
  readonly windowEndEpochSecond: number;
  readonly sqliteExecutable: string;
  readonly executeSqlite: DayflowSqliteExecutorV1;
}

interface DatabaseIdentity {
  readonly device: number;
  readonly inode: number;
  readonly ownerUid: number;
}

const MISSING = Symbol("missing");

function fail(issueCode: DayflowCaptureWindowCandidateIssueCodeV1): never {
  throw new DayflowCaptureWindowCandidateErrorV1(issueCode);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
): unknown | typeof MISSING {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return MISSING;
  if (!("value" in descriptor)) fail("INPUT_INVALID");
  return descriptor.value;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isDayflowSqliteExecutorV1(
  value: unknown,
): value is DayflowSqliteExecutorV1 {
  return typeof value === "function";
}

function isBoundedString(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\u0000") &&
    Buffer.byteLength(value, "utf8") <= maximumBytes
  );
}

function captureInput(input: unknown): CapturedInput {
  if (!isPlainRecord(input)) fail("INPUT_INVALID");

  const allowedKeys = new Set([
    "databasePath",
    "windowStartEpochSecond",
    "windowEndEpochSecond",
    "sqliteExecutable",
    "executeSqlite",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) fail("INPUT_INVALID");
  }

  const databasePath = ownDataValue(input, "databasePath");
  const windowStartEpochSecond = ownDataValue(
    input,
    "windowStartEpochSecond",
  );
  const windowEndEpochSecond = ownDataValue(input, "windowEndEpochSecond");
  const suppliedExecutable = ownDataValue(input, "sqliteExecutable");
  const suppliedExecutor = ownDataValue(input, "executeSqlite");

  if (
    !isBoundedString(databasePath, MAX_DATABASE_PATH_BYTES) ||
    !isAbsolute(databasePath) ||
    resolve(databasePath) !== databasePath ||
    !isNonnegativeSafeInteger(windowStartEpochSecond) ||
    !isNonnegativeSafeInteger(windowEndEpochSecond) ||
    windowEndEpochSecond - windowStartEpochSecond + 1 !==
      DAYFLOW_CAPTURE_WINDOW_DURATION_SECONDS_V1
  ) {
    fail("INPUT_INVALID");
  }

  const sqliteExecutable =
    suppliedExecutable === MISSING ? "sqlite3" : suppliedExecutable;
  const executeSqlite =
    suppliedExecutor === MISSING ? defaultDayflowSqliteExecutorV1 : suppliedExecutor;
  if (
    !isBoundedString(sqliteExecutable, MAX_SQLITE_EXECUTABLE_BYTES) ||
    sqliteExecutable.length === 0 ||
    !isDayflowSqliteExecutorV1(executeSqlite)
  ) {
    fail("INPUT_INVALID");
  }

  return Object.freeze({
    databasePath,
    windowStartEpochSecond,
    windowEndEpochSecond,
    sqliteExecutable,
    executeSqlite,
  });
}

async function captureDatabaseIdentity(
  databasePath: string,
): Promise<DatabaseIdentity> {
  let stats;
  try {
    stats = await lstat(databasePath);
  } catch {
    fail("DATABASE_UNSAFE");
  }

  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    currentUid === undefined ||
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.uid !== currentUid
  ) {
    fail("DATABASE_UNSAFE");
  }

  return Object.freeze({
    device: stats.dev,
    inode: stats.ino,
    ownerUid: stats.uid,
  });
}

function sameDatabaseIdentity(
  before: DatabaseIdentity,
  after: DatabaseIdentity,
): boolean {
  return (
    before.device === after.device &&
    before.inode === after.inode &&
    before.ownerUid === after.ownerUid
  );
}

export async function defaultDayflowSqliteExecutorV1(
  request: DayflowSqliteExecutionRequestV1,
): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    nodeExecFile(
      request.executable,
      [...request.argv],
      {
        encoding: "utf8",
        maxBuffer: request.maxStdoutBytes + 1,
        shell: false,
        timeout: SQLITE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            rejectPromise(
              new DayflowCaptureWindowCandidateErrorV1(
                "RESOURCE_LIMIT_EXCEEDED",
              ),
            );
            return;
          }
          rejectPromise(
            new DayflowCaptureWindowCandidateErrorV1(
              "SQLITE_EXECUTION_FAILED",
            ),
          );
          return;
        }
        if (typeof stdout !== "string") {
          rejectPromise(
            new DayflowCaptureWindowCandidateErrorV1(
              "SQLITE_EXECUTION_FAILED",
            ),
          );
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

export function buildDayflowCaptureWindowSqlV1(
  windowStartEpochSecond: number,
  windowEndEpochSecond: number,
): string {
  if (
    !isNonnegativeSafeInteger(windowStartEpochSecond) ||
    !isNonnegativeSafeInteger(windowEndEpochSecond) ||
    windowEndEpochSecond - windowStartEpochSecond + 1 !==
      DAYFLOW_CAPTURE_WINDOW_DURATION_SECONDS_V1
  ) {
    fail("INPUT_INVALID");
  }

  return `BEGIN DEFERRED TRANSACTION;
WITH selected_screenshots AS (
  SELECT id, captured_at, file_size, idle_seconds_at_capture
  FROM screenshots
  WHERE COALESCE(is_deleted, 0) = 0
    AND captured_at >= ${windowStartEpochSecond}
    AND captured_at <= ${windowEndEpochSecond}
  ORDER BY captured_at ASC, id ASC
  LIMIT ${DAYFLOW_CAPTURE_WINDOW_MAX_SCREENSHOTS_V1 + 1}
), selected_observations AS (
  SELECT id, start_ts, end_ts, observation
  FROM observations
  WHERE start_ts <= ${windowEndEpochSecond}
    AND end_ts >= ${windowStartEpochSecond}
  ORDER BY start_ts ASC, id ASC
  LIMIT ${DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATIONS_V1 + 1}
)
SELECT row_kind, id, captured_at, file_size, idle_seconds, start_ts, end_ts, text
FROM (
  SELECT 0 AS sort_group, captured_at AS sort_time,
    'screenshot' AS row_kind, id, captured_at, file_size,
    idle_seconds_at_capture AS idle_seconds,
    NULL AS start_ts, NULL AS end_ts, NULL AS text
  FROM selected_screenshots
  UNION ALL
  SELECT 1 AS sort_group, start_ts AS sort_time,
    'observation' AS row_kind, id,
    NULL AS captured_at, NULL AS file_size, NULL AS idle_seconds,
    start_ts, end_ts, observation AS text
  FROM selected_observations
)
ORDER BY sort_group ASC, sort_time ASC, id ASC;
COMMIT;`;
}

const SQLITE_ROW_KEYS = Object.freeze([
  "captured_at",
  "end_ts",
  "file_size",
  "id",
  "idle_seconds",
  "row_kind",
  "start_ts",
  "text",
] as const);

function exactSqliteRow(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("SQLITE_OUTPUT_INVALID");
  const keys = Object.keys(value).sort();
  if (
    keys.length !== SQLITE_ROW_KEYS.length ||
    keys.some((key, index) => key !== SQLITE_ROW_KEYS[index])
  ) {
    fail("SQLITE_OUTPUT_INVALID");
  }
  for (const key of SQLITE_ROW_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      fail("SQLITE_OUTPUT_INVALID");
    }
  }
  return value;
}

function nullableNonnegativeSafeInteger(value: unknown): number | null {
  if (value === null) return null;
  if (!isNonnegativeSafeInteger(value)) fail("SQLITE_OUTPUT_INVALID");
  return value;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseSelectedRows(
  stdout: string,
  windowStartEpochSecond: number,
  windowEndEpochSecond: number,
): Readonly<{
  screenshots: readonly DayflowCaptureWindowScreenshotV1[];
  observations: readonly DayflowCaptureWindowObservationV1[];
}> {
  if (
    Buffer.byteLength(stdout, "utf8") >
    DAYFLOW_CAPTURE_WINDOW_MAX_SQLITE_STDOUT_BYTES_V1
  ) {
    fail("RESOURCE_LIMIT_EXCEEDED");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.length === 0 ? "[]" : stdout);
  } catch {
    fail("SQLITE_OUTPUT_INVALID");
  }
  if (!Array.isArray(parsed)) fail("SQLITE_OUTPUT_INVALID");
  if (
    parsed.length >
    DAYFLOW_CAPTURE_WINDOW_MAX_SCREENSHOTS_V1 +
      DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATIONS_V1 +
      2
  ) {
    fail("RESOURCE_LIMIT_EXCEEDED");
  }

  const screenshots: DayflowCaptureWindowScreenshotV1[] = [];
  const observations: DayflowCaptureWindowObservationV1[] = [];
  const screenshotIds = new Set<number>();
  const observationIds = new Set<number>();
  let totalObservationTextBytes = 0;

  for (const untrustedRow of parsed) {
    const row = exactSqliteRow(untrustedRow);
    const rowKind = row.row_kind;
    const id = row.id;
    if (!isPositiveSafeInteger(id)) fail("SQLITE_OUTPUT_INVALID");

    if (rowKind === "screenshot") {
      if (
        row.start_ts !== null ||
        row.end_ts !== null ||
        row.text !== null ||
        !isNonnegativeSafeInteger(row.captured_at) ||
        row.captured_at < windowStartEpochSecond ||
        row.captured_at > windowEndEpochSecond ||
        screenshotIds.has(id)
      ) {
        fail("SQLITE_OUTPUT_INVALID");
      }
      if (screenshots.length >= DAYFLOW_CAPTURE_WINDOW_MAX_SCREENSHOTS_V1) {
        fail("RESOURCE_LIMIT_EXCEEDED");
      }
      screenshotIds.add(id);
      screenshots.push(
        Object.freeze({
          screenshotId: id,
          capturedAtEpochSecond: row.captured_at,
          fileSizeBytes: nullableNonnegativeSafeInteger(row.file_size),
          idleSecondsAtCapture: nullableNonnegativeSafeInteger(
            row.idle_seconds,
          ),
        }),
      );
      continue;
    }

    if (rowKind !== "observation") fail("SQLITE_OUTPUT_INVALID");
    if (
      row.captured_at !== null ||
      row.file_size !== null ||
      row.idle_seconds !== null ||
      !isNonnegativeSafeInteger(row.start_ts) ||
      !isNonnegativeSafeInteger(row.end_ts) ||
      row.start_ts > row.end_ts ||
      row.start_ts > windowEndEpochSecond ||
      row.end_ts < windowStartEpochSecond ||
      typeof row.text !== "string" ||
      row.text.includes("\u0000") ||
      observationIds.has(id)
    ) {
      fail("SQLITE_OUTPUT_INVALID");
    }
    if (observations.length >= DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATIONS_V1) {
      fail("RESOURCE_LIMIT_EXCEEDED");
    }
    const textBytes = Buffer.byteLength(row.text, "utf8");
    if (textBytes > DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATION_TEXT_BYTES_V1) {
      fail("RESOURCE_LIMIT_EXCEEDED");
    }
    totalObservationTextBytes += textBytes;
    if (
      !Number.isSafeInteger(totalObservationTextBytes) ||
      totalObservationTextBytes >
        DAYFLOW_CAPTURE_WINDOW_MAX_TOTAL_OBSERVATION_TEXT_BYTES_V1
    ) {
      fail("RESOURCE_LIMIT_EXCEEDED");
    }
    observationIds.add(id);
    observations.push(
      Object.freeze({
        observationId: id,
        startEpochSecond: row.start_ts,
        endEpochSecond: row.end_ts,
        text: row.text,
      }),
    );
  }

  screenshots.sort(
    (left, right) =>
      compareNumbers(
        left.capturedAtEpochSecond,
        right.capturedAtEpochSecond,
      ) || compareNumbers(left.screenshotId, right.screenshotId),
  );
  observations.sort(
    (left, right) =>
      compareNumbers(left.startEpochSecond, right.startEpochSecond) ||
      compareNumbers(left.observationId, right.observationId),
  );

  return Object.freeze({
    screenshots: Object.freeze(screenshots),
    observations: Object.freeze(observations),
  });
}

function buildCandidate(
  windowStartEpochSecond: number,
  windowEndEpochSecond: number,
  selectedRows: Readonly<{
    screenshots: readonly DayflowCaptureWindowScreenshotV1[];
    observations: readonly DayflowCaptureWindowObservationV1[];
  }>,
): DayflowCaptureWindowCandidateV1 {
  const window = Object.freeze({
    startEpochSecond: windowStartEpochSecond,
    endEpochSecond: windowEndEpochSecond,
    inclusiveDurationSeconds: DAYFLOW_CAPTURE_WINDOW_DURATION_SECONDS_V1,
  });
  const selectedRowsSha256 = sha256Canonical({
    hashDomain: DAYFLOW_CAPTURE_WINDOW_SELECTED_ROWS_HASH_DOMAIN_V1,
    window,
    screenshots: selectedRows.screenshots,
    observations: selectedRows.observations,
  });
  return Object.freeze({
    identity: DAYFLOW_CAPTURE_WINDOW_CANDIDATE_IDENTITY_V1,
    window,
    screenshots: selectedRows.screenshots,
    observations: selectedRows.observations,
    counts: Object.freeze({
      screenshotCount: selectedRows.screenshots.length,
      observationCount: selectedRows.observations.length,
      selectedRowCount:
        selectedRows.screenshots.length + selectedRows.observations.length,
    }),
    selectedRowsSha256,
    reviewStatus: DAYFLOW_CAPTURE_WINDOW_REVIEW_STATUS_V1,
  });
}

export async function readDayflowCaptureWindowCandidateV1(
  input: ReadDayflowCaptureWindowCandidateV1Input,
): Promise<DayflowCaptureWindowCandidateV1> {
  let captured: CapturedInput;
  try {
    captured = captureInput(input);
  } catch (error) {
    if (error instanceof DayflowCaptureWindowCandidateErrorV1) throw error;
    fail("INPUT_INVALID");
  }

  const databaseIdentityBefore = await captureDatabaseIdentity(
    captured.databasePath,
  );
  const sql = buildDayflowCaptureWindowSqlV1(
    captured.windowStartEpochSecond,
    captured.windowEndEpochSecond,
  );
  const request = Object.freeze({
    executable: captured.sqliteExecutable,
    argv: Object.freeze([
      "-batch",
      "-readonly",
      "-json",
      captured.databasePath,
      sql,
    ]),
    maxStdoutBytes: DAYFLOW_CAPTURE_WINDOW_MAX_SQLITE_STDOUT_BYTES_V1,
  });

  let stdout: string;
  try {
    stdout = await captured.executeSqlite(request);
  } catch (error) {
    if (
      error instanceof DayflowCaptureWindowCandidateErrorV1 &&
      error.issueCode === "RESOURCE_LIMIT_EXCEEDED"
    ) {
      throw error;
    }
    fail("SQLITE_EXECUTION_FAILED");
  }
  if (typeof stdout !== "string") fail("SQLITE_OUTPUT_INVALID");

  let databaseIdentityAfter: DatabaseIdentity;
  try {
    databaseIdentityAfter = await captureDatabaseIdentity(captured.databasePath);
  } catch {
    fail("DATABASE_CHANGED");
  }
  if (!sameDatabaseIdentity(databaseIdentityBefore, databaseIdentityAfter)) {
    fail("DATABASE_CHANGED");
  }

  const selectedRows = parseSelectedRows(
    stdout,
    captured.windowStartEpochSecond,
    captured.windowEndEpochSecond,
  );
  return buildCandidate(
    captured.windowStartEpochSecond,
    captured.windowEndEpochSecond,
    selectedRows,
  );
}
