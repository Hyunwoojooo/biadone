import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContinuationSetupActionRequestError,
  requestContinuationSetupAction
} from "../app/continuationSetupActionClient";

const ITEM_REF = `item_ref_${"a".repeat(32)}`;
const OFFER_ID = `continuation_setup_offer_${"b".repeat(64)}`;
const CONTRACT = "continuation-setup-action-api-v0.1";
const ISSUED = {
  contract: CONTRACT,
  status: "issued",
  offerId: OFFER_ID,
  expiresAt: "2026-08-13T09:00:30.000Z"
};
const OPENED = {
  contract: CONTRACT,
  status: "opened",
  destination: "project_mappings",
  navigateTo: "/projects"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("continuation setup action client", () => {
  it("issues then consumes one memory-only offer with exact explicit inputs", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined)
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ISSUED, 201))
      .mockResolvedValueOnce(jsonResponse(OPENED, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestContinuationSetupAction({
      itemRef: ITEM_REF,
      explicitUserAction: true
    });
    expect(result).toEqual(OPENED);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/continuation/offers",
      strictPost({ itemRef: ITEM_REF, explicitUserAction: true })
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/continuation/open",
      strictPost({ offerId: OFFER_ID, explicitUserAction: true })
    ]);
    expect(
      fetchMock.mock.calls.every(
        ([url]) => typeof url === "string" && !url.includes(OFFER_ID)
      )
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(OFFER_ID);
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });

  it("never opens or retries when issue fails, is non-JSON, or has extra keys", async () => {
    for (const issue of [
      new Response("auth", {
        status: 401,
        headers: { "content-type": "text/plain" }
      }),
      jsonResponse({ ...ISSUED, privateTarget: "/Users/private" }, 201),
      jsonResponse(ISSUED, 200)
    ]) {
      const fetchMock = vi.fn().mockResolvedValue(issue);
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        requestContinuationSetupAction({
          itemRef: ITEM_REF,
          explicitUserAction: true
        })
      ).rejects.toBeInstanceOf(ContinuationSetupActionRequestError);
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  });

  it("does not retry issue or open after a transport failure", async () => {
    const issueFailure = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", issueFailure);
    await expect(
      requestContinuationSetupAction({
        itemRef: ITEM_REF,
        explicitUserAction: true
      })
    ).rejects.toBeInstanceOf(ContinuationSetupActionRequestError);
    expect(issueFailure).toHaveBeenCalledOnce();

    const openFailure = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ISSUED, 201))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", openFailure);
    await expect(
      requestContinuationSetupAction({
        itemRef: ITEM_REF,
        explicitUserAction: true
      })
    ).rejects.toBeInstanceOf(ContinuationSetupActionRequestError);
    expect(openFailure).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...OPENED, navigateTo: "https://hostile.example" },
    { ...OPENED, navigateTo: "/projects?offerId=private" },
    { ...OPENED, destination: "native_app" },
    { ...OPENED, offerId: OFFER_ID },
    { ...OPENED, contract: "continuation-setup-action-api-v0.2" }
  ])("rejects a hostile or non-exact open response %#", async (opened) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ISSUED, 201))
      .mockResolvedValueOnce(jsonResponse(opened, 200));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestContinuationSetupAction({
        itemRef: ITEM_REF,
        explicitUserAction: true
      })
    ).rejects.toBeInstanceOf(ContinuationSetupActionRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "text/plain" }
    }),
    jsonResponse(OPENED, 201),
    jsonResponse({ ...OPENED, extra: true }, 200)
  ])("rejects a non-exact open transport without retry %#", async (opened) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ISSUED, 201))
      .mockResolvedValueOnce(opened);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestContinuationSetupAction({
        itemRef: ITEM_REF,
        explicitUserAction: true
      })
    ).rejects.toBeInstanceOf(ContinuationSetupActionRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized responses before accepting or opening an offer", async () => {
    const oversized = jsonResponse(
      { ...ISSUED, padding: "x".repeat(5_000) },
      201
    );
    const fetchMock = vi.fn().mockResolvedValue(oversized);
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestContinuationSetupAction({
        itemRef: ITEM_REF,
        explicitUserAction: true
      })
    ).rejects.toBeInstanceOf(ContinuationSetupActionRequestError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid public refs without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      requestContinuationSetupAction({
        itemRef: "/Users/private",
        explicitUserAction: true
      })
    ).rejects.toBeInstanceOf(ContinuationSetupActionRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function strictPost(body: Record<string, unknown>) {
  return {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
