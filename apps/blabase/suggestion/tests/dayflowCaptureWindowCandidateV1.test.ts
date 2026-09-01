import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Canonical } from "../src/evaluation/crossSourceIntegrity";
import {
  DAYFLOW_CAPTURE_WINDOW_CANDIDATE_IDENTITY_V1,
  DAYFLOW_CAPTURE_WINDOW_DURATION_SECONDS_V1,
  DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATION_TEXT_BYTES_V1,
  DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATIONS_V1,
  DAYFLOW_CAPTURE_WINDOW_MAX_SCREENSHOTS_V1,
  DAYFLOW_CAPTURE_WINDOW_MAX_SQLITE_STDOUT_BYTES_V1,
  DAYFLOW_CAPTURE_WINDOW_REVIEW_STATUS_V1,
  DAYFLOW_CAPTURE_WINDOW_SELECTED_ROWS_HASH_DOMAIN_V1,
  type DayflowCaptureWindowCandidateIssueCodeV1,
  type DayflowSqliteExecutionRequestV1,
  type DayflowSqliteExecutorV1,
  readDayflowCaptureWindowCandidateV1,
} from "../src/evaluation/screenEvidenceAblation/readDayflowCaptureWindowCandidateV1";

const WINDOW_START = 1_000;
const WINDOW_END = 1_599;

type SqliteRow = Readonly<{
  row_kind: "screenshot" | "observation";
  id: number;
  captured_at: number | null;
  file_size: number | null;
  idle_seconds: number | null;
  start_ts: number | null;
  end_ts: number | null;
  text: string | null;
}>;

function screenshotRow(
  id: number,
  capturedAt: number,
  overrides: Partial<SqliteRow> = {},
): SqliteRow {
  return {
    row_kind: "screenshot",
    id,
    captured_at: capturedAt,
    file_size: 1_024,
    idle_seconds: 0,
    start_ts: null,
    end_ts: null,
    text: null,
    ...overrides,
  };
}

function observationRow(
  id: number,
  start: number,
  end: number,
  text: string,
  overrides: Partial<SqliteRow> = {},
): SqliteRow {
  return {
    row_kind: "observation",
    id,
    captured_at: null,
    file_size: null,
    idle_seconds: null,
    start_ts: start,
    end_ts: end,
    text,
    ...overrides,
  };
}

function executorFor(
  rows: readonly unknown[],
  requests: DayflowSqliteExecutionRequestV1[] = [],
): DayflowSqliteExecutorV1 {
  return async (request) => {
    requests.push(request);
    return JSON.stringify(rows);
  };
}

async function expectIssue(
  promise: Promise<unknown>,
  issueCode: DayflowCaptureWindowCandidateIssueCodeV1,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "DayflowCaptureWindowCandidateErrorV1",
    issueCode,
  });
}

describe("Dayflow capture window candidate v1", () => {
  let temporaryDirectory: string;
  let databasePath: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), "blabase-dayflow-window-v1-"),
    );
    databasePath = join(temporaryDirectory, "dayflow.sqlite");
    await writeFile(databasePath, "");
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it("uses an exact inclusive 600-second window and canonical deterministic ordering", async () => {
    const rows = [
      observationRow(8, WINDOW_END, WINDOW_END + 20, "last boundary"),
      screenshotRow(2, WINDOW_END),
      observationRow(7, WINDOW_START - 20, WINDOW_START, "first boundary"),
      screenshotRow(1, WINDOW_START),
      screenshotRow(3, WINDOW_START),
    ];
    const first = await readDayflowCaptureWindowCandidateV1({
      databasePath,
      windowStartEpochSecond: WINDOW_START,
      windowEndEpochSecond: WINDOW_END,
      executeSqlite: executorFor(rows),
    });
    const second = await readDayflowCaptureWindowCandidateV1({
      databasePath,
      windowStartEpochSecond: WINDOW_START,
      windowEndEpochSecond: WINDOW_END,
      executeSqlite: executorFor([...rows].reverse()),
    });

    expect(first.identity).toBe(DAYFLOW_CAPTURE_WINDOW_CANDIDATE_IDENTITY_V1);
    expect(first.window).toEqual({
      startEpochSecond: WINDOW_START,
      endEpochSecond: WINDOW_END,
      inclusiveDurationSeconds: DAYFLOW_CAPTURE_WINDOW_DURATION_SECONDS_V1,
    });
    expect(first.screenshots.map((row) => row.screenshotId)).toEqual([1, 3, 2]);
    expect(first.observations.map((row) => row.observationId)).toEqual([7, 8]);
    expect(first.counts).toEqual({
      screenshotCount: 3,
      observationCount: 2,
      selectedRowCount: 5,
    });
    expect(first.selectedRowsSha256).toBe(second.selectedRowsSha256);
    expect(first.selectedRowsSha256).toBe(
      sha256Canonical({
        hashDomain: DAYFLOW_CAPTURE_WINDOW_SELECTED_ROWS_HASH_DOMAIN_V1,
        window: first.window,
        screenshots: first.screenshots,
        observations: first.observations,
      }),
    );
  });

  it("queries one read transaction with only approved source projections", async () => {
    const requests: DayflowSqliteExecutionRequestV1[] = [];
    const candidate = await readDayflowCaptureWindowCandidateV1({
      databasePath,
      windowStartEpochSecond: WINDOW_START,
      windowEndEpochSecond: WINDOW_END,
      executeSqlite: executorFor([], requests),
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.executable).toBe("sqlite3");
    expect(request.argv.slice(0, 4)).toEqual([
      "-batch",
      "-readonly",
      "-json",
      databasePath,
    ]);
    expect(request.maxStdoutBytes).toBe(
      DAYFLOW_CAPTURE_WINDOW_MAX_SQLITE_STDOUT_BYTES_V1,
    );
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.argv)).toBe(true);

    const sql = request.argv.at(-1)!;
    expect(sql.match(/BEGIN DEFERRED TRANSACTION;/gu)).toHaveLength(1);
    expect(sql.match(/COMMIT;/gu)).toHaveLength(1);
    expect(sql).toContain(
      "SELECT id, captured_at, file_size, idle_seconds_at_capture",
    );
    expect(sql).toContain("SELECT id, start_ts, end_ts, observation");
    expect(sql).toContain("FROM screenshots");
    expect(sql).toContain("FROM observations");
    expect(sql).toContain("COALESCE(is_deleted, 0) = 0");
    expect(sql).toContain(`captured_at >= ${WINDOW_START}`);
    expect(sql).toContain(`captured_at <= ${WINDOW_END}`);
    expect(sql).toContain(`start_ts <= ${WINDOW_END}`);
    expect(sql).toContain(`end_ts >= ${WINDOW_START}`);
    expect(sql).not.toMatch(/file_path|image|png|jpeg|llm_calls?|llm_model|chat/iu);

    expect(candidate.reviewStatus).toBe(
      DAYFLOW_CAPTURE_WINDOW_REVIEW_STATUS_V1,
    );
    const serialized = JSON.stringify(candidate);
    expect(serialized).not.toContain(databasePath);
    expect(serialized).not.toMatch(
      /file_path|image|exportEligibility|privacyReviewReceipt/iu,
    );
  });

  it("rejects non-exact windows and unsafe database paths before execution", async () => {
    const executeSqlite = vi.fn<DayflowSqliteExecutorV1>(async () => "[]");
    await expectIssue(
      readDayflowCaptureWindowCandidateV1({
        databasePath,
        windowStartEpochSecond: WINDOW_START,
        windowEndEpochSecond: WINDOW_END + 1,
        executeSqlite,
      }),
      "INPUT_INVALID",
    );
    await expectIssue(
      readDayflowCaptureWindowCandidateV1({
        databasePath: "relative.sqlite",
        windowStartEpochSecond: WINDOW_START,
        windowEndEpochSecond: WINDOW_END,
        executeSqlite,
      }),
      "INPUT_INVALID",
    );

    const linkPath = join(temporaryDirectory, "linked.sqlite");
    await symlink(databasePath, linkPath);
    await expectIssue(
      readDayflowCaptureWindowCandidateV1({
        databasePath: linkPath,
        windowStartEpochSecond: WINDOW_START,
        windowEndEpochSecond: WINDOW_END,
        executeSqlite,
      }),
      "DATABASE_UNSAFE",
    );
    expect(executeSqlite).not.toHaveBeenCalled();
  });

  it("rejects hostile rows, invalid values, and duplicate identities", async () => {
    const cases: readonly unknown[][] = [
      [
        {
          ...screenshotRow(1, WINDOW_START),
          file_path: "/private/should-not-escape.png",
        },
      ],
      [screenshotRow(0, WINDOW_START)],
      [screenshotRow(1, WINDOW_END + 1)],
      [observationRow(1, WINDOW_START + 1, WINDOW_START, "invalid range")],
      [screenshotRow(1, WINDOW_START), screenshotRow(1, WINDOW_START + 1)],
      [observationRow(1, WINDOW_START, WINDOW_END, "a\u0000b")],
    ];

    for (const rows of cases) {
      await expectIssue(
        readDayflowCaptureWindowCandidateV1({
          databasePath,
          windowStartEpochSecond: WINDOW_START,
          windowEndEpochSecond: WINDOW_END,
          executeSqlite: executorFor(rows),
        }),
        "SQLITE_OUTPUT_INVALID",
      );
    }
  });

  it("enforces row, observation text, aggregate text, and stdout caps", async () => {
    await expectIssue(
      readDayflowCaptureWindowCandidateV1({
        databasePath,
        windowStartEpochSecond: WINDOW_START,
        windowEndEpochSecond: WINDOW_END,
        executeSqlite: executorFor([
          observationRow(
            1,
            WINDOW_START,
            WINDOW_END,
            "x".repeat(
              DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATION_TEXT_BYTES_V1 + 1,
            ),
          ),
        ]),
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    const tooManyScreenshots = Array.from(
      { length: DAYFLOW_CAPTURE_WINDOW_MAX_SCREENSHOTS_V1 + 1 },
      (_, index) => screenshotRow(index + 1, WINDOW_START),
    );
    await expectIssue(
      readDayflowCaptureWindowCandidateV1({
        databasePath,
        windowStartEpochSecond: WINDOW_START,
        windowEndEpochSecond: WINDOW_END,
        executeSqlite: executorFor(tooManyScreenshots),
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    const aggregateText = "x".repeat(
      Math.floor(
        DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATION_TEXT_BYTES_V1 / 2,
      ),
    );
    const aggregateRows = Array.from(
      { length: DAYFLOW_CAPTURE_WINDOW_MAX_OBSERVATIONS_V1 },
      (_, index) =>
        observationRow(
          index + 1,
          WINDOW_START,
          WINDOW_END,
          aggregateText,
        ),
    );
    await expectIssue(
      readDayflowCaptureWindowCandidateV1({
        databasePath,
        windowStartEpochSecond: WINDOW_START,
        windowEndEpochSecond: WINDOW_END,
        executeSqlite: executorFor(aggregateRows),
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );

    await expectIssue(
      readDayflowCaptureWindowCandidateV1({
        databasePath,
        windowStartEpochSecond: WINDOW_START,
        windowEndEpochSecond: WINDOW_END,
        executeSqlite: async () =>
          "x".repeat(DAYFLOW_CAPTURE_WINDOW_MAX_SQLITE_STDOUT_BYTES_V1 + 1),
      }),
      "RESOURCE_LIMIT_EXCEEDED",
    );
  });

  it("sanitizes subprocess and malformed-output failures", async () => {
    const secret = "private observation stdout and database detail";
    const failed = readDayflowCaptureWindowCandidateV1({
      databasePath,
      windowStartEpochSecond: WINDOW_START,
      windowEndEpochSecond: WINDOW_END,
      executeSqlite: async () => {
        throw new Error(secret);
      },
    });
    await expectIssue(failed, "SQLITE_EXECUTION_FAILED");
    await expect(failed).rejects.not.toHaveProperty("message", expect.stringContaining(secret));

    const malformed = readDayflowCaptureWindowCandidateV1({
      databasePath,
      windowStartEpochSecond: WINDOW_START,
      windowEndEpochSecond: WINDOW_END,
      executeSqlite: async () => `${secret}: not json`,
    });
    await expectIssue(malformed, "SQLITE_OUTPUT_INVALID");
    await expect(malformed).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining(secret),
    );
  });

  it("returns fresh owned and deeply frozen candidates", async () => {
    const rows = [
      screenshotRow(1, WINDOW_START),
      observationRow(1, WINDOW_START, WINDOW_END, "private text"),
    ];
    const input = {
      databasePath,
      windowStartEpochSecond: WINDOW_START,
      windowEndEpochSecond: WINDOW_END,
      executeSqlite: executorFor(rows),
    };
    const first = await readDayflowCaptureWindowCandidateV1(input);
    const second = await readDayflowCaptureWindowCandidateV1(input);

    expect(first).not.toBe(second);
    expect(first.window).not.toBe(second.window);
    expect(first.screenshots).not.toBe(second.screenshots);
    expect(first.screenshots[0]).not.toBe(second.screenshots[0]);
    expect(first.observations).not.toBe(second.observations);
    expect(first.observations[0]).not.toBe(second.observations[0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.window)).toBe(true);
    expect(Object.isFrozen(first.screenshots)).toBe(true);
    expect(Object.isFrozen(first.screenshots[0])).toBe(true);
    expect(Object.isFrozen(first.observations)).toBe(true);
    expect(Object.isFrozen(first.observations[0])).toBe(true);
    expect(Object.isFrozen(first.counts)).toBe(true);

    expect(() => {
      (first.observations[0] as { text: string }).text = "mutated";
    }).toThrow();
    expect(second.observations[0]!.text).toBe("private text");
  });
});
