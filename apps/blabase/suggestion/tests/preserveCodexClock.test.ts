import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CODEX_CONVERSATION_COLLECTOR_VERSION,
  CODEX_CONVERSATION_CONSENT_CONTRACT,
  CODEX_CONVERSATION_RETENTION_DAYS,
  CODEX_CONVERSATION_STORE_CONTRACT,
  codexConversationStoreSchema,
  conversationStoreSha256
} from "../src/connectors/codex/conversationContract";
import {
  codexLocalDirectory,
  readStoredCodexConversationStore,
  readStoredCodexSnapshot
} from "../src/connectors/codex/localStore";

const COLLECTED_AT = "2026-08-13T12:00:00.000Z";
const EXPIRES_AT = "2026-08-13T12:10:00.000Z";
const SCOPE_ID = "0123456789abcdef01234567";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Codex preserve read clock", () => {
  it("uses one explicit asOf for direct and nested conversation expiry", async () => {
    const { cwd, store, snapshot } = await writeConversationFixture();
    const currentAsOf = new Date("2026-08-13T12:09:59.999Z");
    const expirationAsOf = new Date(EXPIRES_AT);
    const ambientClock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2099-01-01T00:00:00.000Z"));

    await expect(
      readStoredCodexConversationStore(cwd, "preserve", currentAsOf)
    ).resolves.toEqual(store);
    await expect(
      readStoredCodexSnapshot(cwd, "preserve", currentAsOf)
    ).resolves.toEqual(snapshot);
    await expect(
      readStoredCodexConversationStore(cwd, "preserve", expirationAsOf)
    ).resolves.toBeNull();
    await expect(
      readStoredCodexSnapshot(cwd, "preserve", expirationAsOf)
    ).resolves.toBeNull();

    expect(ambientClock).not.toHaveBeenCalled();
  });

  it("fails closed without a valid explicit preserve asOf", async () => {
    const { cwd } = await writeConversationFixture();
    const ambientClock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-08-13T12:01:00.000Z"));

    await expect(
      readStoredCodexConversationStore(cwd, "preserve")
    ).resolves.toBeNull();
    await expect(
      readStoredCodexSnapshot(cwd, "preserve", new Date(Number.NaN))
    ).resolves.toBeNull();

    expect(ambientClock).not.toHaveBeenCalled();
  });

  it("keeps maintain mode on its ambient clock and deletion path", async () => {
    const { cwd, historyPath } = await writeConversationFixture();
    const ambientClock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse(EXPIRES_AT));

    await expect(
      readStoredCodexConversationStore(
        cwd,
        "maintain",
        new Date("2026-08-13T12:01:00.000Z")
      )
    ).resolves.toBeNull();

    expect(ambientClock).toHaveBeenCalled();
    await expect(stat(historyPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

async function writeConversationFixture(): Promise<{
  cwd: string;
  historyPath: string;
  store: ReturnType<typeof codexConversationStoreSchema.parse>;
  snapshot: Record<string, unknown>;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "blabase-preserve-codex-clock-"));
  temporaryDirectories.push(cwd);
  const directory = codexLocalDirectory(cwd);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(join(cwd, ".local"), 0o700);
  await chmod(join(cwd, ".local", "connectors"), 0o700);
  await chmod(directory, 0o700);

  const store = codexConversationStoreSchema.parse({
    contract: CODEX_CONVERSATION_STORE_CONTRACT,
    collectorVersion: CODEX_CONVERSATION_COLLECTOR_VERSION,
    consentContract: CODEX_CONVERSATION_CONSENT_CONTRACT,
    collectedAt: COLLECTED_AT,
    expiresAt: EXPIRES_AT,
    retentionDays: CODEX_CONVERSATION_RETENTION_DAYS,
    scopeIds: [SCOPE_ID],
    truncated: false,
    sessions: []
  });
  const snapshot = {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion:
      "codex-app-server-conversation-and-execution-v1",
    contentMode: "conversation_and_execution",
    codexVersion: "synthetic-test",
    fetchedAt: COLLECTED_AT,
    lookbackStart: "2026-08-06T12:00:00.000Z",
    truncated: false,
    conversationStoreSha256: conversationStoreSha256(store),
    conversationRetentionDays: CODEX_CONVERSATION_RETENTION_DAYS,
    scopeIds: [SCOPE_ID],
    sessions: []
  };
  const historyPath = join(directory, "conversation-history.json");
  const snapshotPath = join(directory, "snapshot.json");
  await writeFile(historyPath, `${JSON.stringify(store)}\n`, {
    mode: 0o600
  });
  await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, {
    mode: 0o600
  });

  return { cwd, historyPath, store, snapshot };
}
