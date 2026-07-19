import { describe, expect, it } from "vitest";

import { validateShareUrl } from "../../src/core/adapters/chatgpt-share";

describe("validateShareUrl", () => {
  it("accepts a valid chatgpt.com share URL and strips query params", () => {
    const result = validateShareUrl(
      "https://chatgpt.com/share/6a4a1f03-7a88-83ee-860e-4389fc6fea67?foo=bar"
    );

    expect(result).toEqual({
      valid: true,
      normalizedUrl:
        "https://chatgpt.com/share/6a4a1f03-7a88-83ee-860e-4389fc6fea67",
      shareId: "6a4a1f03-7a88-83ee-860e-4389fc6fea67"
    });
  });

  it("rejects private ChatGPT conversation URLs", () => {
    expect(validateShareUrl("https://chatgpt.com/c/abc").errorCode).toBe(
      "UNSUPPORTED_PATH"
    );
    expect(validateShareUrl("https://chat.openai.com/c/abc").errorCode).toBe(
      "UNSUPPORTED_DOMAIN"
    );
  });

  it("rejects malformed, non-https, and missing share id URLs", () => {
    expect(validateShareUrl("not a url").errorCode).toBe("INVALID_URL");
    expect(validateShareUrl("http://chatgpt.com/share/abc").errorCode).toBe(
      "INVALID_URL"
    );
    expect(validateShareUrl("https://chatgpt.com/share/").errorCode).toBe(
      "MISSING_SHARE_ID"
    );
  });
});
