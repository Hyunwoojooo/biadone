import { describe, expect, it } from "vitest";

import {
  normalizeChatGptShareUrl,
  normalizeSuggestionRequest,
  SuggestionRequestError
} from "../src/requestSchema";
import { suggestionRequestSchema } from "../src/schema";

describe("suggestion request validation", () => {
  it("requires at least three URLs and same-user confirmation", () => {
    expect(
      suggestionRequestSchema.safeParse({
        shareUrls: [
          "https://chatgpt.com/share/a",
          "https://chatgpt.com/share/b"
        ],
        sameUserConfirmed: true
      }).success
    ).toBe(false);
    expect(
      suggestionRequestSchema.safeParse({
        shareUrls: [
          "https://chatgpt.com/share/a",
          "https://chatgpt.com/share/b",
          "https://chatgpt.com/share/c"
        ],
        sameUserConfirmed: false
      }).success
    ).toBe(false);
  });

  it("normalizes query strings and detects duplicates", () => {
    const parsed = suggestionRequestSchema.parse({
      shareUrls: [
        "https://www.chatgpt.com/share/a?utm_source=test",
        "https://chatgpt.com/share/a#fragment",
        "https://chatgpt.com/share/b"
      ],
      sameUserConfirmed: true
    });

    expect(() => normalizeSuggestionRequest(parsed)).toThrowError(
      SuggestionRequestError
    );
    expect(
      normalizeChatGptShareUrl(
        "https://www.chatgpt.com/share/a?utm_source=test"
      )
    ).toBe("https://chatgpt.com/share/a");
  });

  it("rejects non-share URLs and non-ChatGPT domains", () => {
    expect(() =>
      normalizeChatGptShareUrl("https://chatgpt.com/")
    ).toThrowError(SuggestionRequestError);
    expect(() =>
      normalizeChatGptShareUrl("https://example.com/share/a")
    ).toThrowError(SuggestionRequestError);
  });
});
