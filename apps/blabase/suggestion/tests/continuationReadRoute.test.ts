import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/suggestionBoard/liveShadow", () => ({
  evaluateLiveContinuationRead: vi.fn()
}));

import { GET } from "../app/api/continuation/route";
import { PreserveCaptureError } from "../src/attention/preserveCapture";
import { CONTINUATION_READ_API_CONTRACT } from "../src/continuation/readApi";
import { evaluateLiveContinuationRead } from "../src/suggestionBoard/liveShadow";

const AS_OF = "2026-08-13T12:00:00.000Z";
const available = {
  contract: CONTINUATION_READ_API_CONTRACT,
  generatedAt: AS_OF,
  status: "offers_available",
  coverageCode: "COMPLETE",
  items: [
    {
      title: "통합 작업 이어가기",
      summary: "통합 작업 이어가기",
      caveats: [],
      capability: "display",
      action: null
    }
  ]
} as const;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/continuation", () => {
  it("checks locality, safe origin, flag, and configured auth before evaluation", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const remote = await GET(
      new Request("https://preview.example/api/continuation")
    );
    expect(remote.status).toBe(404);
    await expect(remote.json()).resolves.toMatchObject({
      code: "CONTINUATION_READ_LOCAL_ONLY"
    });

    vi.stubEnv("BLABASE_CONTINUATION_READ_ENABLED", "true");
    const unsafeOrigin = await GET(
      new Request("http://localhost:3102/api/continuation", {
        headers: { origin: "https://attacker.example" }
      })
    );
    expect(unsafeOrigin.status).toBe(403);
    await expect(unsafeOrigin.json()).resolves.toMatchObject({
      code: "CONTINUATION_READ_INVALID_ORIGIN"
    });

    vi.stubEnv("BLABASE_CONTINUATION_READ_ENABLED", "false");
    const disabled = await GET(localRequest());
    expect(disabled.status).toBe(404);
    await expect(disabled.json()).resolves.toMatchObject({
      code: "CONTINUATION_READ_DISABLED"
    });

    vi.stubEnv("BLABASE_CONTINUATION_READ_ENABLED", "true");
    const authUnavailable = await GET(localRequest());
    expect(authUnavailable.status).toBe(503);
    await expect(authUnavailable.json()).resolves.toMatchObject({
      code: "CONTINUATION_READ_AUTH_UNAVAILABLE"
    });

    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    const unauthorized = await GET(localRequest());
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      'Basic realm="blabase suggestion"'
    );
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: "CONTINUATION_READ_UNAUTHORIZED"
    });
    expect(evaluateLiveContinuationRead).not.toHaveBeenCalled();
  });

  it.each([
    available,
    {
      contract: CONTINUATION_READ_API_CONTRACT,
      generatedAt: AS_OF,
      status: "setup_required",
      coverageCode: "SOURCE_LOCAL_PARTIAL",
      items: [
        {
          title: "작업공간 연결하기",
          summary: "작업공간 연결하기",
          caveats: ["EXPLICIT_MAPPING_CONFIRMATION_REQUIRED"],
          capability: "display",
          action: null
        }
      ]
    },
    {
      contract: CONTINUATION_READ_API_CONTRACT,
      generatedAt: AS_OF,
      status: "no_recent_context",
      coverageCode: "COMPLETE",
      items: []
    },
    {
      contract: CONTINUATION_READ_API_CONTRACT,
      generatedAt: AS_OF,
      status: "insufficient_evidence",
      coverageCode: "INSUFFICIENT",
      items: []
    },
    {
      contract: CONTINUATION_READ_API_CONTRACT,
      generatedAt: AS_OF,
      status: "unavailable",
      coverageCode: "UNAVAILABLE",
      items: []
    }
  ])("returns one strict public projection for $status", async (projection) => {
    enableRoute();
    vi.mocked(evaluateLiveContinuationRead).mockResolvedValue(
      projection as never
    );

    const response = await GET(localRequest(true));

    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    await expect(response.json()).resolves.toEqual(projection);
    expect(evaluateLiveContinuationRead).toHaveBeenCalledOnce();
  });

  it("rejects a hostile projection at the route schema boundary", async () => {
    enableRoute();
    vi.mocked(evaluateLiveContinuationRead).mockResolvedValue({
      ...available,
      privateActionTarget: `private_target_${"a".repeat(32)}`
    } as never);

    const response = await GET(localRequest(true));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      status: "error",
      code: "CONTINUATION_READ_FAILED"
    });
    expect(JSON.stringify(body)).not.toContain("private_target_");
  });

  it("separates typed preserve failure from generic failure without leaking detail", async () => {
    enableRoute();
    vi.mocked(evaluateLiveContinuationRead).mockRejectedValueOnce(
      new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE")
    );
    const unavailable = await GET(localRequest(true));
    expect(unavailable.status).toBe(503);
    expectSecurityHeaders(unavailable);

    vi.mocked(evaluateLiveContinuationRead).mockRejectedValueOnce(
      new Error("private path /Users/example token=secret")
    );
    const failed = await GET(localRequest(true));
    const body = await failed.json();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/Users|token=secret/u);
  });
});

function enableRoute() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLABASE_CONTINUATION_READ_ENABLED", "true");
  vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
}

function localRequest(authenticated = false): Request {
  return new Request("http://localhost:3102/api/continuation", {
    headers: {
      origin: "http://localhost:3102",
      ...(authenticated
        ? { authorization: `Basic ${btoa("blabase:test-password")}` }
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
