import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issue: vi.fn(),
  open: vi.fn()
}));

vi.mock("../src/continuation/actions/gateway", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/continuation/actions/gateway")
  >();
  return {
    ...actual,
    issueLiveContinuationSetupOffer: mocks.issue,
    openLiveContinuationSetupOffer: mocks.open
  };
});

import { POST as issuePost } from "../app/api/continuation/offers/route";
import { POST as openPost } from "../app/api/continuation/open/route";
import { PreserveCaptureError } from "../src/attention/preserveCapture";
import {
  CONTINUATION_SETUP_ACTION_API_CONTRACT,
  ContinuationSetupActionGatewayError,
  ContinuationSetupActionStoreError
} from "../src/continuation/actions";

const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const OFFER_ID = `continuation_setup_offer_${"b".repeat(64)}`;
const EXPIRES_AT = "2026-08-13T12:00:30.000Z";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Continuation Setup action POST routes", () => {
  it("checks local, exact origin, flag, and configured Basic auth before body or capture", async () => {
    enableRoute();

    const remote = await issuePost(
      request("offers", issueBody(), {
        url: "https://preview.example/api/continuation/offers",
        origin: "https://preview.example"
      })
    );
    expect(remote.status).toBe(404);
    await expectCode(remote, "SETUP_ACTION_LOCAL_ONLY");

    const crossOrigin = await issuePost(
      request("offers", issueBody(), {
        origin: "https://attacker.example"
      })
    );
    expect(crossOrigin.status).toBe(403);
    await expectCode(crossOrigin, "INVALID_ORIGIN");

    vi.stubEnv("BLABASE_CONTINUATION_SETUP_ACTION_ENABLED", "false");
    const disabled = await issuePost(request("offers", issueBody()));
    expect(disabled.status).toBe(404);
    await expectCode(disabled, "DISABLED");

    vi.stubEnv("BLABASE_CONTINUATION_SETUP_ACTION_ENABLED", "true");
    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "");
    const authUnavailable = await issuePost(
      request("offers", issueBody())
    );
    expect(authUnavailable.status).toBe(503);
    await expectCode(authUnavailable, "AUTH_UNAVAILABLE");

    vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
    const unauthorized = await issuePost(
      request("offers", issueBody(), { authorization: null })
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      'Basic realm="blabase suggestion"'
    );
    await expectCode(unauthorized, "UNAUTHORIZED");
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("requires bounded declared JSON and strict explicit issue input", async () => {
    enableRoute();
    const missingType = await issuePost(
      request("offers", issueBody(), { contentType: null })
    );
    expect(missingType.status).toBe(415);
    await expectCode(missingType, "INVALID_CONTENT_TYPE");

    const missingLength = await issuePost(
      request("offers", issueBody(), { contentLength: null })
    );
    expect(missingLength.status).toBe(411);
    await expectCode(missingLength, "INVALID_CONTENT_LENGTH");

    const tooLarge = await issuePost(
      request("offers", issueBody(), { contentLength: "513" })
    );
    expect(tooLarge.status).toBe(413);
    await expectCode(tooLarge, "INVALID_CONTENT_LENGTH");

    const mismatch = await issuePost(
      request("offers", issueBody(), { contentLength: "1" })
    );
    expect(mismatch.status).toBe(400);
    await expectCode(mismatch, "INVALID_CONTENT_LENGTH");

    for (const body of [
      { itemRef: ITEM_REF, explicitUserAction: false },
      { itemRef: ITEM_REF, explicitUserAction: true, privateTarget: "/tmp/x" },
      { itemRef: "/Users/private", explicitUserAction: true }
    ]) {
      const invalid = await issuePost(request("offers", body));
      expect(invalid.status).toBe(400);
      await expectCode(invalid, "INVALID_REQUEST");
    }
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it("issues one strict memory-only handle and opens only the fixed destination", async () => {
    enableRoute();
    mocks.issue.mockResolvedValue({
      contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
      status: "issued",
      offerId: OFFER_ID,
      expiresAt: EXPIRES_AT
    });
    mocks.open.mockResolvedValue({
      contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
      status: "opened",
      destination: "project_mappings",
      navigateTo: "/projects"
    });

    const issued = await issuePost(request("offers", issueBody()));
    expect(issued.status).toBe(201);
    expectSecurityHeaders(issued);
    await expect(issued.json()).resolves.toEqual({
      contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
      status: "issued",
      offerId: OFFER_ID,
      expiresAt: EXPIRES_AT
    });
    expect(mocks.issue).toHaveBeenCalledOnce();
    expect(mocks.issue).toHaveBeenCalledWith({ itemRef: ITEM_REF });

    const opened = await openPost(request("open", openBody()));
    expect(opened.status).toBe(200);
    expectSecurityHeaders(opened);
    await expect(opened.json()).resolves.toEqual({
      contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
      status: "opened",
      destination: "project_mappings",
      navigateTo: "/projects"
    });
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledWith({ offerId: OFFER_ID });
  });

  it("sanitizes currentness, capture, store, and generic failures", async () => {
    enableRoute();
    const cases: Array<[unknown, number, string]> = [
      [
        new ContinuationSetupActionGatewayError("OFFER_NOT_CURRENT"),
        409,
        "OFFER_NOT_CURRENT"
      ],
      [
        new ContinuationSetupActionStoreError("OFFER_NOT_CURRENT"),
        409,
        "OFFER_NOT_CURRENT"
      ],
      [
        new PreserveCaptureError("PRESERVE_CAPTURE_UNSTABLE"),
        503,
        "CAPTURE_UNAVAILABLE"
      ],
      [new Error("/Users/private token=secret"), 500, "FAILED"]
    ];
    for (const [error, status, code] of cases) {
      mocks.open.mockRejectedValueOnce(error);
      const response = await openPost(request("open", openBody()));
      const serialized = JSON.stringify(await response.json());
      expect(response.status).toBe(status);
      expect(serialized).toContain(code);
      expect(serialized).not.toMatch(/Users|token=secret|private_target_/u);
      expectSecurityHeaders(response);
    }
  });

  it("rejects invalid open input without consuming or exposing an offer", async () => {
    enableRoute();
    const invalid = await openPost(
      request("open", {
        offerId: OFFER_ID,
        explicitUserAction: false
      })
    );
    const serialized = JSON.stringify(await invalid.json());
    expect(invalid.status).toBe(400);
    expect(serialized).not.toContain(OFFER_ID);
    expect(mocks.open).not.toHaveBeenCalled();
  });
});

function enableRoute() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLABASE_CONTINUATION_SETUP_ACTION_ENABLED", "true");
  vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
}

function issueBody() {
  return { itemRef: ITEM_REF, explicitUserAction: true };
}

function openBody() {
  return { offerId: OFFER_ID, explicitUserAction: true };
}

function request(
  route: "offers" | "open",
  body: Record<string, unknown>,
  overrides: {
    authorization?: string | null;
    contentLength?: string | null;
    contentType?: string | null;
    origin?: string;
    url?: string;
  } = {}
) {
  const serialized = JSON.stringify(body);
  const url =
    overrides.url ?? `http://localhost:3102/api/continuation/${route}`;
  const authorization =
    overrides.authorization === undefined
      ? `Basic ${btoa("blabase:test-password")}`
      : overrides.authorization;
  const contentType =
    overrides.contentType === undefined
      ? "application/json"
      : overrides.contentType;
  const contentLength =
    overrides.contentLength === undefined
      ? String(new TextEncoder().encode(serialized).byteLength)
      : overrides.contentLength;
  return new Request(url, {
    method: "POST",
    headers: {
      origin: overrides.origin ?? new URL(url).origin,
      ...(authorization === null ? {} : { authorization }),
      ...(contentType === null ? {} : { "content-type": contentType }),
      ...(contentLength === null ? {} : { "content-length": contentLength })
    },
    body: serialized
  });
}

async function expectCode(response: Response, code: string) {
  await expect(response.json()).resolves.toEqual({
    contract: CONTINUATION_SETUP_ACTION_API_CONTRACT,
    status: "error",
    code
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
