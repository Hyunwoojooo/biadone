import { describe, expect, it } from "vitest";

import {
  loadSharedLocalEnv,
  parseSharedEnvText
} from "../src/localEnv";

describe("shared local env parser", () => {
  it("parses exported, quoted, and plain values without exposing comments", () => {
    expect(
      parseSharedEnvText(`
        # private settings
        GEMINI_API_KEY=plain-key
        export GEMINI_MODEL="gemini-test"
        CHATGPT_SHARE_FETCHER_SECRET='secret with spaces'
      `)
    ).toEqual({
      GEMINI_API_KEY: "plain-key",
      GEMINI_MODEL: "gemini-test",
      CHATGPT_SHARE_FETCHER_SECRET: "secret with spaces"
    });
  });

  it("does not fail when a local-only env pointer is unavailable at runtime", () => {
    expect(() =>
      loadSharedLocalEnv({
        NODE_ENV: "production",
        BLABASE_SHARED_ENV_PATH:
          "/path-that-does-not-exist/blabase-suggestion.env",
        GEMINI_API_KEY: "runtime-secret"
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });
});
