import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchShareHtml } from "../../src/core/adapters/chatgpt-share";

describe("fetchShareHtml", () => {
  const originalFetcherUrl = process.env.CHATGPT_SHARE_FETCHER_URL;
  const originalFetcherSecret = process.env.CHATGPT_SHARE_FETCHER_SECRET;

  afterEach(() => {
    process.env.CHATGPT_SHARE_FETCHER_URL = originalFetcherUrl;
    process.env.CHATGPT_SHARE_FETCHER_SECRET = originalFetcherSecret;
    vi.unstubAllGlobals();
  });

  it("uses configured fetcher server instead of direct ChatGPT fetch", async () => {
    process.env.CHATGPT_SHARE_FETCHER_URL =
      "https://chatgpt-fetcher.biadone.com/fetch-chatgpt-share";
    process.env.CHATGPT_SHARE_FETCHER_SECRET = "test-secret";

    const fetchMock = vi.fn(async () => {
      return Response.json({
        ok: true,
        status: 200,
        finalUrl: "https://chatgpt.com/share/test",
        contentType: "text/html; charset=utf-8",
        html: "<html>streamController.enqueue linear_conversation</html>"
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchShareHtml({
      url: "https://chatgpt.com/share/test"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt-fetcher.biadone.com/fetch-chatgpt-share",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-secret"
        }),
        body: JSON.stringify({ url: "https://chatgpt.com/share/test" })
      })
    );
    expect(result.statusCode).toBe(200);
    expect(result.html).toContain("linear_conversation");
  });
});
