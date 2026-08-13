import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  codexConversationStoreSchema,
  conversationStoreSha256
} from "../src/connectors/codex/conversationContract";
import {
  codexLocalDirectory,
  readStoredCodexConfig,
  readStoredCodexConversationStore,
  readStoredCodexSnapshot
} from "../src/connectors/codex/localStore";
import {
  githubLocalDirectory,
  readStoredGitHubTokens
} from "../src/connectors/github/localStore";
import {
  googleCalendarLocalDirectory,
  readStoredTokens as readStoredGoogleCalendarTokens
} from "../src/connectors/googleCalendar/localStore";
import {
  notionLocalDirectory,
  readStoredNotionTokens
} from "../src/connectors/notion/localStore";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("local connector preserve reads", () => {
  it.each([
    {
      name: "GitHub",
      directoryFor: githubLocalDirectory,
      basename: "tokens.json",
      value: {
        appClientId: "client",
        appSlug: "app",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: "2026-08-14T00:00:00.000Z",
        refreshTokenExpiresAt: "2026-08-15T00:00:00.000Z",
        tokenType: "bearer",
        scope: "repo"
      },
      read: readStoredGitHubTokens
    },
    {
      name: "Google Calendar",
      directoryFor: googleCalendarLocalDirectory,
      basename: "tokens.json",
      value: {
        connectionScopeId: `calendar_scope_${"a".repeat(32)}`,
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: "2026-08-14T00:00:00.000Z",
        scope: "calendar",
        tokenType: "Bearer"
      },
      read: readStoredGoogleCalendarTokens
    },
    {
      name: "Notion",
      directoryFor: notionLocalDirectory,
      basename: "tokens.json",
      value: {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "bearer",
        botId: "bot",
        workspaceId: "workspace",
        workspaceName: "Workspace"
      },
      read: readStoredNotionTokens
    }
  ] as const)(
    "keeps the $name tree content, mode, mtime, ctime, inode, and listing identical",
    async ({ directoryFor, basename, value, read }) => {
      const cwd = await temporaryCwd();
      const directory = directoryFor(cwd);
      const canonicalPath = join(directory, basename);
      const staleTemp = `${canonicalPath}.73001.0123456789abcdef.tmp`;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(canonicalPath, `${JSON.stringify(value)}\n`, {
        mode: 0o600
      });
      await writeFile(staleTemp, "abandoned", { mode: 0o600 });
      const old = new Date("2026-08-01T00:00:00.000Z");
      await utimes(staleTemp, old, old);
      const before = await treeState(directory);

      await expect(read(cwd, "preserve")).resolves.toMatchObject(value);

      expect(await treeState(directory)).toEqual(before);
    }
  );

  it("fails closed for symlinked and non-private files without changing them", async () => {
    const cwd = await temporaryCwd();
    const directory = githubLocalDirectory(cwd);
    const target = join(cwd, "external-tokens.json");
    const path = join(directory, "tokens.json");
    const value = {
      appClientId: "client",
      appSlug: "app",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: "2026-08-14T00:00:00.000Z",
      refreshTokenExpiresAt: "2026-08-15T00:00:00.000Z",
      tokenType: "bearer",
      scope: "repo"
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(target, JSON.stringify(value), { mode: 0o600 });
    await symlink(target, path);
    const symlinkBefore = await lstat(path);
    await expect(readStoredGitHubTokens(cwd, "preserve")).resolves.toBeNull();
    expect((await lstat(path)).ino).toBe(symlinkBefore.ino);
    expect(await readFile(target, "utf8")).toBe(JSON.stringify(value));

    await rm(path);
    await writeFile(path, JSON.stringify(value), { mode: 0o644 });
    const worldReadableBefore = await treeState(directory);
    await expect(readStoredGitHubTokens(cwd, "preserve")).resolves.toBeNull();
    expect(await treeState(directory)).toEqual(worldReadableBefore);
  });

  it("rejects existing and dangling symlinked .local ancestors", async () => {
    const sourceCwd = await temporaryCwd();
    const victimCwd = await temporaryCwd();
    const sourceDirectory = githubLocalDirectory(sourceCwd);
    const victimLocal = join(victimCwd, ".local");
    const value = {
      appClientId: "client",
      appSlug: "app",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: "2026-08-14T00:00:00.000Z",
      refreshTokenExpiresAt: "2026-08-15T00:00:00.000Z",
      tokenType: "bearer",
      scope: "repo"
    };
    await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
    for (const directory of [
      join(sourceCwd, ".local"),
      join(sourceCwd, ".local", "connectors"),
      sourceDirectory
    ]) {
      await chmod(directory, 0o700);
    }
    await writeFile(
      join(sourceDirectory, "tokens.json"),
      JSON.stringify(value),
      { mode: 0o600 }
    );
    const sourceBefore = await treeState(sourceDirectory);

    await symlink(join(sourceCwd, ".local"), victimLocal);
    await expect(
      readStoredGitHubTokens(victimCwd, "preserve")
    ).resolves.toBeNull();
    expect((await lstat(victimLocal)).isSymbolicLink()).toBe(true);
    expect(await treeState(sourceDirectory)).toEqual(sourceBefore);

    await rm(victimLocal);
    await symlink(join(sourceCwd, "missing-local"), victimLocal);
    await expect(
      readStoredGitHubTokens(victimCwd, "preserve")
    ).resolves.toBeNull();
    expect((await lstat(victimLocal)).isSymbolicLink()).toBe(true);
  });

  it("migrates legacy Codex config in memory and never purges raw history", async () => {
    const cwd = await temporaryCwd();
    const directory = codexLocalDirectory(cwd);
    const scopeId = "a".repeat(24);
    const legacy = {
      schemaVersion: "codex-connector-config-v1",
      installationSecret: "f".repeat(64),
      selectedScopeIds: [scopeId],
      scopes: [
        {
          id: scopeId,
          queryPath: "/private/project",
          label: "project",
          sessionCount: 1,
          lastActivityAt: "2026-08-12T00:00:00.000Z"
        }
      ],
      discoveredAt: "2026-08-12T00:00:00.000Z"
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, "config.json"), `${JSON.stringify(legacy)}\n`, {
      mode: 0o600
    });
    await writeFile(join(directory, "conversation-history.json"), "corrupt", {
      mode: 0o600
    });
    const before = await treeState(directory);

    await expect(readStoredCodexConfig(cwd, "preserve")).resolves.toMatchObject({
      schemaVersion: "codex-connector-config-v3",
      contentMode: "metadata_only"
    });
    expect(await treeState(directory)).toEqual(before);

    await writeFile(join(directory, "config.json"), "{corrupt", { mode: 0o600 });
    const corruptBefore = await treeState(directory);
    await expect(readStoredCodexConfig(cwd, "preserve")).resolves.toBeNull();
    expect(await treeState(directory)).toEqual(corruptBefore);
  });

  it("leaves expired/corrupt conversation history untouched through direct and nested reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
    const cwd = await temporaryCwd();
    const directory = codexLocalDirectory(cwd);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const historyPath = join(directory, "conversation-history.json");
    const store = codexConversationStoreSchema.parse({
      contract: "codex-conversation-and-execution-store-v1",
      collectorVersion: "codex-app-server-thread-read-v1",
      consentContract: "codex-conversation-content-consent-v1",
      collectedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-08T00:00:00.000Z",
      retentionDays: 7,
      scopeIds: ["a".repeat(24)],
      truncated: false,
      sessions: []
    });
    await writeFile(
      historyPath,
      JSON.stringify(store),
      { mode: 0o600 }
    );
    await writeFile(
      join(directory, "snapshot.json"),
      JSON.stringify({
        schemaVersion: "codex-snapshot-v3",
        collectorVersion:
          "codex-app-server-conversation-and-execution-v1",
        contentMode: "conversation_and_execution",
        codexVersion: "codex-cli 0.1.0",
        fetchedAt: "2026-08-01T00:00:00.000Z",
        lookbackStart: "2026-07-01T00:00:00.000Z",
        truncated: false,
        conversationStoreSha256: conversationStoreSha256(store),
        conversationRetentionDays: 7,
        scopeIds: store.scopeIds,
        sessions: []
      }),
      { mode: 0o600 }
    );
    const before = await treeState(directory);
    await expect(
      readStoredCodexConversationStore(cwd, "preserve")
    ).resolves.toBeNull();
    await expect(readStoredCodexSnapshot(cwd, "preserve")).resolves.toBeNull();
    expect(await treeState(directory)).toEqual(before);

    await writeFile(historyPath, "{corrupt", { mode: 0o600 });
    const corruptBefore = await treeState(directory);
    await expect(
      readStoredCodexConversationStore(cwd, "preserve")
    ).resolves.toBeNull();
    await expect(readStoredCodexSnapshot(cwd, "preserve")).resolves.toBeNull();
    expect(await treeState(directory)).toEqual(corruptBefore);
  });

  it("keeps maintain-mode stale-temp cleanup unchanged", async () => {
    const cwd = await temporaryCwd();
    const directory = notionLocalDirectory(cwd);
    const temp = join(
      directory,
      "tokens.json.73001.0123456789abcdef.tmp"
    );
    await mkdir(directory, { recursive: true });
    await writeFile(temp, "abandoned", { mode: 0o600 });
    const stale = new Date(Date.now() - 10 * 60 * 1_000);
    await utimes(temp, stale, stale);

    await readStoredNotionTokens(cwd);

    await expect(lstat(temp)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function temporaryCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "blabase-preserve-read-"));
  temporaryDirectories.push(cwd);
  return cwd;
}

async function treeState(directory: string) {
  // atime is deliberately outside the preserve invariant: the OS may update
  // access accounting for read/readdir even though this code performs no write.
  const names = await readdir(directory);
  return Promise.all(
    names.sort().map(async (name) => {
      const path = join(directory, name);
      const stats = await lstat(path);
      return {
        name,
        bytes: stats.isFile() ? await readFile(path, "hex") : null,
        mode: stats.mode,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        ino: stats.ino
      };
    })
  );
}
