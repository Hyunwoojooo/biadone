import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/suggestionBoard/liveShadow", () => ({
  evaluateLiveSemanticWorkSuggestionBoard: vi.fn(),
  evaluateLiveSemanticWorkSuggestionBoardWithMonitoringAuthority: vi.fn()
}));

import { GET } from "../app/api/work-board/route";
import { PreserveCaptureError } from "../src/attention/preserveCapture";
import { semanticContinuationWorkBoardResponseSchema } from "../src/semanticContinuation";
import {
  evaluateLiveSemanticWorkSuggestionBoard,
  evaluateLiveSemanticWorkSuggestionBoardWithMonitoringAuthority
} from "../src/suggestionBoard/liveShadow";
import {
  WORK_BOARD_MONITORING_RECEIPT_HEADER,
  verifyWorkBoardMonitoringReceipt
} from "../src/suggestionBoard/monitoring";
import {
  MONITORING_NOW,
  MONITORING_SECRET,
  monitoringAuthority
} from "./fixtures/workBoardMonitoringFixture";

const readyResponse = {
  status: "ready",
  mode: "full",
  reasonCode: null,
  board: {
    contract: "work-suggestion-board-public-v0.1",
    schemaVersion: "work-suggestion-board-schema-v0.1",
    generatedAt: "2026-08-13T12:00:00.000Z",
    prominentLane: "none",
    primary: null,
    alternatives: [],
    continuationStatus: "empty",
    executionPolicy: {
      automaticExecutionAllowed: false,
      explicitUserActionRequired: true,
      externalMutationAllowed: false
    }
  }
} as const;
const semanticReadyResponse = {
  contract: "semantic-continuation-work-board-response-v0.2",
  schemaVersion: "semantic-continuation-presentation-schema-v0.2",
  base: readyResponse,
  semanticPresentation: null
} as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/work-board", () => {
  it("is default-off", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await GET(
      new Request("http://localhost:3102/api/work-board")
    );

    expect(response.status).toBe(404);
    expectSecurityHeaders(response);
    await expect(response.json()).resolves.toMatchObject({
      semanticPresentation: null,
      base: {
        status: "unavailable",
        code: "WORK_BOARD_SHADOW_DISABLED"
      }
    });
    expect(evaluateLiveSemanticWorkSuggestionBoard).not.toHaveBeenCalled();
  });

  it("rejects non-local requests before evaluating the shadow", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");

    const response = await GET(
      new Request("https://preview.example/api/work-board")
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      semanticPresentation: null,
      base: {
        status: "unavailable",
        code: "WORK_BOARD_LOCAL_ONLY",
        message:
          "Work Board preview는 로컬 개발 환경에서만 확인할 수 있습니다."
      }
    });
    expect(evaluateLiveSemanticWorkSuggestionBoard).not.toHaveBeenCalled();
  });

  it("rejects unsafe origins", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");

    const response = await GET(
      new Request("http://localhost:3102/api/work-board", {
        headers: { origin: "https://attacker.example" }
      })
    );

    expect(response.status).toBe(403);
    expect(evaluateLiveSemanticWorkSuggestionBoard).not.toHaveBeenCalled();
  });

  it("requires configured Basic auth before reading semantic state", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");

    const unavailable = await GET(localRequest());
    expect(unavailable.status).toBe(503);

    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    const unauthorized = await GET(localRequest());
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      'Basic realm="blabase suggestion"'
    );
    expect(evaluateLiveSemanticWorkSuggestionBoard).not.toHaveBeenCalled();
  });

  it("returns the parsed public wrapper when the local shadow is enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    vi.mocked(evaluateLiveSemanticWorkSuggestionBoard).mockResolvedValue(
      semanticReadyResponse as never
    );

    const response = await GET(localRequest(true));

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    const body = await response.json();
    expect(body).toEqual(semanticReadyResponse);
    expect(JSON.stringify(body.base)).toBe(JSON.stringify(readyResponse));
    expect(evaluateLiveSemanticWorkSuggestionBoard).toHaveBeenCalledOnce();
    expect(
      evaluateLiveSemanticWorkSuggestionBoardWithMonitoringAuthority
    ).not.toHaveBeenCalled();
    expect(
      response.headers.get(WORK_BOARD_MONITORING_RECEIPT_HEADER)
    ).toBeNull();
  });

  it("adds only a bounded receipt header while preserving exact JSON bytes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
    vi.stubEnv("BLABASE_WORK_BOARD_MONITORING_ENABLED", "true");
    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    const authority = monitoringAuthority();
    vi.mocked(
      evaluateLiveSemanticWorkSuggestionBoardWithMonitoringAuthority
    ).mockResolvedValue({
      response: authority.response,
      monitoringAuthority: authority
    });
    vi.useFakeTimers();
    vi.setSystemTime(MONITORING_NOW);

    const response = await GET(localRequest(true));
    const expectedBytes = JSON.stringify(
      semanticContinuationWorkBoardResponseSchema.parse(authority.response)
    );
    const receipt = response.headers.get(
      WORK_BOARD_MONITORING_RECEIPT_HEADER
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(expectedBytes);
    expect(receipt).not.toBeNull();
    expect(
      verifyWorkBoardMonitoringReceipt({
        receipt: receipt!,
        installationSecret: MONITORING_SECRET,
        now: MONITORING_NOW
      })
    ).not.toBeNull();
    expect(evaluateLiveSemanticWorkSuggestionBoard).not.toHaveBeenCalled();
    expect(
      evaluateLiveSemanticWorkSuggestionBoardWithMonitoringAuthority
    ).toHaveBeenCalledOnce();
  });

  it("keeps the GET bytes actionless when the separate Setup action flag is enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
    vi.stubEnv("BLABASE_CONTINUATION_SETUP_ACTION_ENABLED", "true");
    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    vi.mocked(evaluateLiveSemanticWorkSuggestionBoard).mockResolvedValue(
      semanticReadyResponse as never
    );

    const response = await GET(localRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(semanticReadyResponse);
    expect(JSON.stringify(body)).not.toMatch(/offerId|open_setup_surface/u);
    expect(evaluateLiveSemanticWorkSuggestionBoard).toHaveBeenCalledOnce();
  });

  it("sanitizes evaluator failures and keeps security headers", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    vi.mocked(evaluateLiveSemanticWorkSuggestionBoard).mockRejectedValue(
      new Error("private path /Users/example and token=secret")
    );

    const response = await GET(localRequest(true));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
    expect(payload).toMatchObject({
      semanticPresentation: null,
      base: {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED",
        message: "Work Board preview를 만들지 못했습니다."
      }
    });
    expect(JSON.stringify(payload)).not.toContain("/Users/example");
    expect(JSON.stringify(payload)).not.toContain("token=secret");
  });

  it("returns a sanitized 503 only for a failed preserve capture", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    const failure = new PreserveCaptureError(
      "PRESERVE_CAPTURE_UNSTABLE"
    );
    vi.mocked(evaluateLiveSemanticWorkSuggestionBoard).mockRejectedValue(
      failure
    );

    const response = await GET(localRequest(true));
    const payload = await response.json();

    expect(response.status).toBe(503);
    expectSecurityHeaders(response);
    expect(payload).toMatchObject({
      semanticPresentation: null,
      base: {
        status: "error",
        code: "WORK_BOARD_PREVIEW_FAILED"
      }
    });
    expect(JSON.stringify(payload)).not.toContain("private unstable path");
  });
});

function localRequest(authenticated = false): Request {
  return new Request("http://localhost:3102/api/work-board", {
    headers: {
      origin: "http://localhost:3102",
      ...(authenticated
        ? {
            authorization: `Basic ${btoa("blabase:test-password")}`
          }
        : {})
    }
  });
}

function expectSecurityHeaders(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; frame-ancestors 'none'"
  );
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
}
