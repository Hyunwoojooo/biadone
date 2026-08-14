import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn(),
  readState: vi.fn(),
  recordMutation: vi.fn()
}));

vi.mock("../src/connectors/codex/localStore", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/connectors/codex/localStore")
  >()),
  readStoredCodexConfig: mocks.readConfig
}));
vi.mock("../src/suggestionBoard/monitoring", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/suggestionBoard/monitoring")
  >()),
  readWorkBoardMonitoringState: mocks.readState,
  recordWorkBoardMonitoringMutation: mocks.recordMutation
}));

import {
  GET,
  POST
} from "../app/api/work-board/monitoring/route";
import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_QUALITY_CONTRACT,
  WORK_BOARD_MONITORING_SCHEMA_VERSION
} from "../src/suggestionBoard/monitoring";

const SECRET = "a".repeat(64);
const aggregate = {
  contract: WORK_BOARD_MONITORING_QUALITY_CONTRACT,
  schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
  asOf: "2026-08-13T09:00:00.000Z",
  eventCount: 0,
  eligibleDistinct: 0,
  ratedDistinct: 0,
  usefulDistinct: 0,
  coverage: { numerator: 0, denominator: 0, value: null },
  usefulShare: { numerator: 0, denominator: 0, value: null },
  strata: [],
  reviewState: "candidate",
  appliedToRanking: false,
  goldEligible: false,
  releaseGateEligible: false
} as const;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLABASE_WORK_BOARD_MONITORING_ENABLED", "true");
  vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
  mocks.readConfig.mockResolvedValue({ installationSecret: SECRET });
  mocks.readState.mockResolvedValue({
    contract: WORK_BOARD_MONITORING_API_CONTRACT,
    status: "ready",
    consent: false,
    aggregate,
    history: []
  });
  mocks.recordMutation.mockResolvedValue({
    contract: WORK_BOARD_MONITORING_API_CONTRACT,
    status: "recorded",
    operation: "consent",
    consent: true,
    aggregate
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("/api/work-board/monitoring", () => {
  it("gates local, exact POST origin, flag and Basic auth before body/store", async () => {
    const cases: Array<{
      request: Request;
      setup?: () => void;
      status: number;
      code: string;
    }> = [
      {
        request: postRequest({ origin: "https://preview.example" }),
        status: 404,
        code: "LOCAL_ONLY"
      },
      {
        request: postRequest({ origin: "https://attacker.example" }),
        status: 403,
        code: "INVALID_ORIGIN"
      },
      {
        request: postRequest(),
        setup: () => vi.stubEnv("BLABASE_WORK_BOARD_MONITORING_ENABLED", "false"),
        status: 404,
        code: "DISABLED"
      },
      {
        request: postRequest(),
        setup: () => vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", ""),
        status: 503,
        code: "AUTH_UNAVAILABLE"
      },
      {
        request: postRequest({ authenticated: false }),
        status: 401,
        code: "UNAUTHORIZED"
      }
    ];
    for (const testCase of cases) {
      testCase.setup?.();
      const response = await POST(testCase.request);
      expect(response.status).toBe(testCase.status);
      await expect(response.json()).resolves.toMatchObject({
        status: "error",
        code: testCase.code
      });
      expect(mocks.readConfig).not.toHaveBeenCalled();
      expect(mocks.recordMutation).not.toHaveBeenCalled();
      vi.clearAllMocks();
      vi.stubEnv("BLABASE_WORK_BOARD_MONITORING_ENABLED", "true");
      vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    }
  });

  it("rejects content type, declared size and strict unknown keys before store reads", async () => {
    const invalidType = await POST(
      postRequest({ contentType: "text/plain" })
    );
    expect(invalidType.status).toBe(415);
    const oversized = await POST(
      postRequest({ declaredLength: "9000" })
    );
    expect(oversized.status).toBe(413);
    const invalidSchema = await POST(
      postRequest({ body: { operation: "purge", explicitUserAction: true, extra: true } })
    );
    expect(invalidSchema.status).toBe(400);
    expect(mocks.readConfig).not.toHaveBeenCalled();
    expect(mocks.recordMutation).not.toHaveBeenCalled();
  });

  it("returns pure redacted state and records a strict explicit mutation", async () => {
    const getResponse = await GET(getRequest());
    expect(getResponse.status).toBe(200);
    expectSecurityHeaders(getResponse);
    await expect(getResponse.json()).resolves.toMatchObject({
      status: "ready",
      consent: false,
      history: []
    });
    expect(mocks.readState).toHaveBeenCalledWith({
      installationSecret: SECRET
    });

    const mutation = {
      operation: "consent" as const,
      consent: true,
      explicitUserAction: true as const
    };
    const postResponse = await POST(postRequest({ body: mutation }));
    expect(postResponse.status).toBe(200);
    expectSecurityHeaders(postResponse);
    expect(mocks.recordMutation).toHaveBeenCalledWith({
      installationSecret: SECRET,
      mutation
    });
  });

  it("accepts a safe GET without Origin but rejects a cross-origin GET", async () => {
    expect((await GET(getRequest({ origin: null }))).status).toBe(200);
    const rejected = await GET(
      getRequest({ origin: "https://attacker.example" })
    );
    expect(rejected.status).toBe(403);
    expect(mocks.readConfig).toHaveBeenCalledTimes(1);
  });
});

function postRequest(
  options: {
    origin?: string;
    authenticated?: boolean;
    contentType?: string;
    declaredLength?: string;
    body?: unknown;
  } = {}
): Request {
  const body = JSON.stringify(
    options.body ?? {
      operation: "purge",
      explicitUserAction: true
    }
  );
  const url =
    options.origin === "https://preview.example"
      ? "https://preview.example/api/work-board/monitoring"
      : "http://localhost:3102/api/work-board/monitoring";
  return new Request(url, {
    method: "POST",
    headers: {
      origin: options.origin ?? "http://localhost:3102",
      authorization:
        options.authenticated === false
          ? ""
          : `Basic ${btoa("blabase:test-password")}`,
      "content-type": options.contentType ?? "application/json",
      "content-length":
        options.declaredLength ?? String(Buffer.byteLength(body))
    },
    body
  });
}

function getRequest(options: { origin?: string | null } = {}): Request {
  return new Request("http://localhost:3102/api/work-board/monitoring", {
    headers: {
      ...(options.origin === null
        ? {}
        : { origin: options.origin ?? "http://localhost:3102" }),
      authorization: `Basic ${btoa("blabase:test-password")}`
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
