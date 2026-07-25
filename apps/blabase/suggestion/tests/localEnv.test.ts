import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("loads the optional Codex binary path but ignores unrelated values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blabase-env-"));
    const filePath = join(directory, "shared.env");
    await writeFile(
      filePath,
      [
        "BLABASE_CODEX_BINARY_PATH=/opt/local/bin/codex",
        "UNRELATED_PRIVATE_VALUE=must-not-load"
      ].join("\n"),
      "utf8"
    );
    const env = {
      NODE_ENV: "development",
      BLABASE_SHARED_ENV_PATH: filePath
    } as NodeJS.ProcessEnv;

    try {
      loadSharedLocalEnv(env);
      expect(env.BLABASE_CODEX_BINARY_PATH).toBe(
        "/opt/local/bin/codex"
      );
      expect(env.UNRELATED_PRIVATE_VALUE).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
