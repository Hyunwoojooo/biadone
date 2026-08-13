import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateBase: vi.fn(),
  confirm: vi.fn()
}));

vi.mock("../src/suggestionBoard/liveShadow", () => ({
  evaluateLiveWorkSuggestionBoardBase: mocks.evaluateBase
}));

vi.mock("../src/semanticContinuation", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/semanticContinuation")
  >();
  return {
    ...actual,
    confirmStoredSemanticContinuationIntent: mocks.confirm
  };
});

import { POST } from "../app/api/work-board/intent/route";
import { PreserveCaptureError } from "../src/attention/preserveCapture";

const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const REGISTRY_SHA = "f".repeat(64);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/work-board/intent", () => {
  it("requires local same-origin authenticated confirmation before evaluation", async () => {
    enableRoute();

    const remote = await POST(request({
      url: "https://example.test/api/work-board/intent",
      origin: "https://example.test"
    }));
    expect(remote.status).toBe(404);

    const crossOrigin = await POST(request({
      origin: "http://malicious.test"
    }));
    expect(crossOrigin.status).toBe(403);

    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "");
    const authUnavailable = await POST(request());
    expect(authUnavailable.status).toBe(503);
    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");

    const response = await POST(request({ authorization: null }));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Basic realm="blabase suggestion"'
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "WORK_BOARD_INTENT_UNAUTHORIZED"
    });
    expect(mocks.evaluateBase).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("re-evaluates the generic Board and persists only a server-bound target", async () => {
    enableRoute();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:01:00.000Z"));
    mocks.evaluateBase.mockResolvedValue({
      response: readyResponse(),
      registrySha256: REGISTRY_SHA
    });
    mocks.confirm.mockResolvedValue({
      store: {},
      decision: {
        intent: "QA_RUN",
        subjectLabel: "blabase",
        expiresAt: "2026-08-14T10:00:00.000Z"
      }
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "confirmed",
      intent: "QA_RUN",
      title: "blabase QA 진행하기",
      expiresAt: "2026-08-14T10:00:00.000Z"
    });
    expect(mocks.evaluateBase).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledWith({
      confirmation: {
        intent: "QA_RUN",
        subjectLabel: "blabase",
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        explicitUserConfirmation: true
      },
      target: {
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        observedAt: "2026-08-13T10:00:00.000Z",
        candidateExpiresAt: "2026-08-14T10:00:00.000Z"
      },
      registrySha256: REGISTRY_SHA,
      confirmedAt: "2026-08-13T12:01:00.000Z"
    });
    expect(JSON.stringify(body)).not.toContain(REGISTRY_SHA);
    expect(JSON.stringify(body)).not.toContain("semantic_intent_");
  });

  it("returns a conflict when refs no longer identify a ready display item", async () => {
    enableRoute();
    mocks.evaluateBase.mockResolvedValue({
      response: readyResponse(),
      registrySha256: REGISTRY_SHA
    });

    const response = await POST(
      request({ itemRef: `item_ref_${"c".repeat(43)}` })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "WORK_BOARD_INTENT_STALE"
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("rejects unsafe labels without evaluating private sources", async () => {
    enableRoute();

    const response = await POST(
      request({ subjectLabel: "/Users/private/project" })
    );

    expect(response.status).toBe(400);
    expect(mocks.evaluateBase).not.toHaveBeenCalled();
  });

  it("returns a sanitized 503 when preserve capture cannot stabilize", async () => {
    enableRoute();
    const failure = new PreserveCaptureError(
      "PRESERVE_CAPTURE_UNSTABLE"
    );
    mocks.evaluateBase.mockRejectedValue(failure);

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      code: "WORK_BOARD_INTENT_FAILED"
    });
  });
});

function enableRoute(): void {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLABASE_WORK_BOARD_SHADOW_READ_ENABLED", "true");
  vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
}

function request(overrides: {
  authorization?: string | null;
  itemRef?: string;
  origin?: string;
  subjectLabel?: string;
  url?: string;
} = {}): Request {
  const authorization = overrides.authorization === undefined
    ? `Basic ${btoa("blabase:test-password")}`
    : overrides.authorization;
  const url = overrides.url ??
    "http://localhost:3102/api/work-board/intent";
  return new Request(url, {
    method: "POST",
    headers: {
      origin: overrides.origin ?? new URL(url).origin,
      "content-type": "application/json",
      ...(authorization === null ? {} : { authorization })
    },
    body: JSON.stringify({
      intent: "QA_RUN",
      subjectLabel: overrides.subjectLabel ?? "blabase",
      itemRef: overrides.itemRef ?? ITEM_REF,
      workContextRef: CONTEXT_REF,
      explicitUserConfirmation: true
    })
  });
}

function readyResponse() {
  return {
    status: "ready",
    mode: "full",
    reasonCode: null,
    board: {
      contract: "work-suggestion-board-public-v0.1",
      schemaVersion: "work-suggestion-board-schema-v0.1",
      generatedAt: "2026-08-13T12:00:00.000Z",
      prominentLane: "continuation",
      primary: {
        lane: "continuation",
        item: {
          itemRef: ITEM_REF,
          workContextRef: CONTEXT_REF,
          kind: "recent_github_push",
          title: "Recent GitHub activity",
          summary: "Recent GitHub activity",
          observedAt: "2026-08-13T10:00:00.000Z",
          expiresAt: "2026-08-14T10:00:00.000Z",
          evidenceBand: "single_source",
          capability: "display",
          action: null,
          caveatCodes: []
        }
      },
      alternatives: [],
      continuationStatus: "available",
      executionPolicy: {
        automaticExecutionAllowed: false,
        explicitUserActionRequired: true,
        externalMutationAllowed: false
      }
    }
  } as const;
}
