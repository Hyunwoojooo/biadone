import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSharedLocalEnvSnapshot,
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

  it("builds a data-root-bound allowlisted snapshot with non-empty ambient precedence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blabase-env-root-"));
    const dataRoot = join(directory, "selected-data-root");
    const filePath = join(directory, "shared.env");
    await writeFile(
      filePath,
      [
        "GITHUB_APP_CLIENT_ID=file-client-id",
        "GITHUB_APP_CLIENT_SECRET=file-client-secret",
        "GITHUB_APP_SLUG=file-slug",
        "BLABASE_LAUNCHER_WORK_BOARD_ENABLED=false",
        "BLABASE_CODE_COMMIT_SHA=file-code-sha",
        "UNRELATED_PRIVATE_VALUE=must-not-load"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(dataRoot, ".env.local"),
      `BLABASE_SHARED_ENV_PATH=${filePath}\n`,
      { encoding: "utf8", flag: "wx" }
    ).catch(async (error: unknown) => {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        (error as { code?: unknown }).code !== "ENOENT"
      ) {
        throw error;
      }
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dataRoot, { recursive: true });
      await writeFile(
        join(dataRoot, ".env.local"),
        `BLABASE_SHARED_ENV_PATH=${filePath}\n`,
        "utf8"
      );
    });
    const ambient = {
      NODE_ENV: "test",
      GITHUB_APP_CLIENT_ID: "ambient-client-id",
      GITHUB_APP_SLUG: "",
      BLABASE_LAUNCHER_WORK_BOARD_ENABLED: "true"
    } as NodeJS.ProcessEnv;

    try {
      const snapshot = createSharedLocalEnvSnapshot(ambient, {
        cwd: dataRoot,
        mode: "maintain"
      });

      expect(snapshot.GITHUB_APP_CLIENT_ID).toBe(
        "ambient-client-id"
      );
      expect(snapshot.GITHUB_APP_CLIENT_SECRET).toBe(
        "file-client-secret"
      );
      expect(snapshot.GITHUB_APP_SLUG).toBe("file-slug");
      expect(snapshot.BLABASE_LAUNCHER_WORK_BOARD_ENABLED).toBe(
        "true"
      );
      expect(snapshot.BLABASE_CODE_COMMIT_SHA).toBeUndefined();
      expect(snapshot.UNRELATED_PRIVATE_VALUE).toBeUndefined();
      expect(ambient.GITHUB_APP_CLIENT_SECRET).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not supplement a resolved snapshot from a different working-root pointer", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "blabase-env-isolation-")
    );
    const selectedRoot = join(directory, "selected-root");
    const workingRoot = join(directory, "working-root");
    const selectedEnvPath = join(directory, "selected.env");
    const conflictingEnvPath = join(directory, "conflicting.env");
    const originalCwd = process.cwd();

    try {
      await Promise.all([
        mkdir(selectedRoot, { recursive: true }),
        mkdir(workingRoot, { recursive: true })
      ]);
      await Promise.all([
        writeFile(
          selectedEnvPath,
          "GITHUB_APP_CLIENT_SECRET=selected-secret\n",
          "utf8"
        ),
        writeFile(
          conflictingEnvPath,
          "GITHUB_APP_SLUG=conflicting-slug\n",
          "utf8"
        ),
        writeFile(
          join(selectedRoot, ".env.local"),
          `BLABASE_SHARED_ENV_PATH=${selectedEnvPath}\n`,
          "utf8"
        ),
        writeFile(
          join(workingRoot, ".env.local"),
          `BLABASE_SHARED_ENV_PATH=${conflictingEnvPath}\n`,
          "utf8"
        )
      ]);

      const snapshot = createSharedLocalEnvSnapshot(
        { NODE_ENV: "test" } as NodeJS.ProcessEnv,
        { cwd: selectedRoot, mode: "maintain" }
      );
      process.chdir(workingRoot);
      loadSharedLocalEnv(snapshot);

      expect(snapshot.GITHUB_APP_CLIENT_SECRET).toBe(
        "selected-secret"
      );
      expect(snapshot.GITHUB_APP_SLUG).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      await rm(directory, { recursive: true, force: true });
    }
  });
});
