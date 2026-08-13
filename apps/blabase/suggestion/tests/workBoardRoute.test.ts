import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/suggestionBoard/liveShadow", () => ({
  evaluateLiveWorkSuggestionBoard: vi.fn()
}));

import { GET } from "../app/api/work-board/route";
import { evaluateLiveWorkSuggestionBoard } from "../src/suggestionBoard/liveShadow";

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

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
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
      status: "unavailable",
      code: "WORK_BOARD_SHADOW_DISABLED"
    });
    expect(evaluateLiveWorkSuggestionBoard).not.toHaveBeenCalled();
  });

  it("rejects non-local requests before evaluating the shadow", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");

    const response = await GET(
      new Request("https://preview.example/api/work-board")
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      code: "WORK_BOARD_LOCAL_ONLY",
      message:
        "Work Board preview는 로컬 개발 환경에서만 확인할 수 있습니다."
    });
    expect(evaluateLiveWorkSuggestionBoard).not.toHaveBeenCalled();
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
    expect(evaluateLiveWorkSuggestionBoard).not.toHaveBeenCalled();
  });

  it("returns the parsed public wrapper when the local shadow is enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
    vi.mocked(evaluateLiveWorkSuggestionBoard).mockResolvedValue(
      readyResponse as never
    );

    const response = await GET(
      new Request("http://localhost:3102/api/work-board", {
        headers: { origin: "http://localhost:3102" }
      })
    );

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    await expect(response.json()).resolves.toEqual(readyResponse);
    expect(evaluateLiveWorkSuggestionBoard).toHaveBeenCalledOnce();
  });

  it("sanitizes evaluator failures and keeps security headers", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
    vi.mocked(evaluateLiveWorkSuggestionBoard).mockRejectedValue(
      new Error("private path /Users/example and token=secret")
    );

    const response = await GET(
      new Request("http://localhost:3102/api/work-board")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
    expect(payload).toEqual({
      status: "error",
      code: "WORK_BOARD_PREVIEW_FAILED",
      message: "Work Board preview를 만들지 못했습니다."
    });
    expect(JSON.stringify(payload)).not.toContain("/Users/example");
    expect(JSON.stringify(payload)).not.toContain("token=secret");
  });
});

function expectSecurityHeaders(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; frame-ancestors 'none'"
  );
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
}
