import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  CODEX_CONVERSATION_COLLECTOR_VERSION,
  CODEX_CONVERSATION_CONSENT_CONTRACT,
  CODEX_CONVERSATION_RETENTION_DAYS,
  CODEX_CONVERSATION_STORE_CONTRACT,
  codexConversationStoreSchema,
  conversationStoreSha256,
  manifestFromConversationSession,
  normalizeCodexThreadRead
} from "../src/connectors/codex/conversationContract";
import {
  codexLocalDirectory,
  deleteStoredCodexConnection,
  readStoredCodexConfig,
  readStoredCodexConversationStore,
  readStoredCodexSnapshot,
  transitionStoredCodexConfig,
  writeStoredCodexConfig,
  writeStoredCodexSnapshot
} from "../src/connectors/codex/localStore";
import type {
  CodexSnapshot,
  StoredCodexConfig
} from "../src/connectors/codex/types";

const SESSION_ID = "0123456789abcdef01234567";
const SCOPE_ID = "89abcdef0123456701234567";
const SOURCE_UPDATED_AT = "2026-07-29T03:00:00.000Z";
const FETCHED_AT = "2026-07-29T03:01:00.000Z";
const EXPIRES_AT = "2026-08-05T03:01:00.000Z";
const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FETCHED_AT));
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.useRealTimers();
});

describe("Codex raw conversation privacy lifecycle", () => {
  it("stores opted-in raw history privately and purges it when the user opts out", async () => {
    const cwd = await temporaryCwd();
    const { config, snapshot, store } = conversationFixture();

    await writeStoredCodexConfig(config, cwd);
    await writeStoredCodexSnapshot(
      snapshot,
      config,
      cwd,
      undefined,
      store
    );

    expect(await readStoredCodexConversationStore(cwd)).toEqual(
      store
    );
    const connectorDirectory = await stat(codexLocalDirectory(cwd));
    const rawFile = await stat(
      join(
        codexLocalDirectory(cwd),
        "conversation-history.json"
      )
    );
    expect(connectorDirectory.mode & 0o777).toBe(0o700);
    expect(rawFile.mode & 0o777).toBe(0o600);

    const optedOut: StoredCodexConfig = {
      ...config,
      contentMode: "activity_summary",
      conversationConsentContract: null,
      conversationConsentAt: null,
      conversationRetentionDays: null
    };
    await transitionStoredCodexConfig(
      config,
      optedOut,
      cwd
    );

    expect(await readStoredCodexConversationStore(cwd)).toBeNull();
    expect(await readStoredCodexSnapshot(cwd)).toBeNull();
    expect(await readStoredCodexConfig(cwd)).toEqual(optedOut);
  });

  it("purges raw history, snapshot, and consent config on disconnect", async () => {
    const cwd = await temporaryCwd();
    const { config, snapshot, store } = conversationFixture();

    await writeStoredCodexConfig(config, cwd);
    await writeStoredCodexSnapshot(
      snapshot,
      config,
      cwd,
      undefined,
      store
    );
    await deleteStoredCodexConnection(cwd);

    expect(await readStoredCodexConversationStore(cwd)).toBeNull();
    expect(await readStoredCodexSnapshot(cwd)).toBeNull();
    expect(await readStoredCodexConfig(cwd)).toBeNull();
  });

  it("deletes an expired raw store and refuses its detached snapshot", async () => {
    const cwd = await temporaryCwd();
    const { config, snapshot, store } = conversationFixture();

    await writeStoredCodexConfig(config, cwd);
    await writeStoredCodexSnapshot(
      snapshot,
      config,
      cwd,
      undefined,
      store
    );
    vi.setSystemTime(new Date("2026-08-05T03:01:01.000Z"));

    expect(await readStoredCodexConversationStore(cwd)).toBeNull();
    expect(await readStoredCodexSnapshot(cwd)).toBeNull();
  });

  it("does not reuse a full-content consent whose contract version is missing", async () => {
    const cwd = await temporaryCwd();
    const { config, snapshot, store } = conversationFixture();
    await writeStoredCodexConfig(config, cwd);
    await writeStoredCodexSnapshot(
      snapshot,
      config,
      cwd,
      undefined,
      store
    );
    const configPath = join(codexLocalDirectory(cwd), "config.json");
    const persisted = JSON.parse(
      await readFile(configPath, "utf8")
    ) as Record<string, unknown>;
    delete persisted.conversationConsentContract;
    await writeFile(
      configPath,
      `${JSON.stringify(persisted)}\n`,
      "utf8"
    );

    await expect(readStoredCodexConfig(cwd)).resolves.toMatchObject({
      contentMode: "activity_summary",
      conversationConsentContract: null,
      conversationConsentAt: null,
      conversationRetentionDays: null
    });
    await expect(
      readStoredCodexConversationStore(cwd)
    ).resolves.toBeNull();
  });
});

async function temporaryCwd(): Promise<string> {
  const cwd = await mkdtemp(
    join(tmpdir(), "blabase-codex-conversation-privacy-")
  );
  temporaryDirectories.push(cwd);
  return cwd;
}

function conversationFixture(): {
  config: StoredCodexConfig;
  snapshot: CodexSnapshot;
  store: ReturnType<typeof codexConversationStoreSchema.parse>;
} {
  const session = normalizeCodexThreadRead({
    result: {
      thread: {
        id: "native-thread-1",
        updatedAt: Date.parse(SOURCE_UPDATED_AT) / 1_000,
        turns: [
          {
            id: "turn-1",
            status: "completed",
            completedAt:
              Date.parse(SOURCE_UPDATED_AT) / 1_000,
            itemsView: "full",
            items: [
              {
                id: "prompt-1",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: `${"private prompt ".repeat(
                      30
                    )}RAW_PRIVATE_PROMPT_SENTINEL`
                  }
                ]
              },
              {
                id: "answer-1",
                type: "agentMessage",
                phase: "final_answer",
                text: `${"private answer ".repeat(
                  30
                )}RAW_PRIVATE_ANSWER_SENTINEL`
              }
            ]
          }
        ]
      }
    },
    expectedNativeThreadId: "native-thread-1",
    sessionId: SESSION_ID,
    scopeId: SCOPE_ID,
    sourceUpdatedAt: SOURCE_UPDATED_AT,
    fetchedAt: FETCHED_AT,
    expiresAt: EXPIRES_AT,
    opaqueId: (kind, nativeId) =>
      createHash("sha256")
        .update(`${kind}:${nativeId}`)
        .digest("hex")
        .slice(0, 24)
  });
  const store = codexConversationStoreSchema.parse({
    contract: CODEX_CONVERSATION_STORE_CONTRACT,
    collectorVersion: CODEX_CONVERSATION_COLLECTOR_VERSION,
    consentContract: CODEX_CONVERSATION_CONSENT_CONTRACT,
    collectedAt: FETCHED_AT,
    expiresAt: EXPIRES_AT,
    retentionDays: CODEX_CONVERSATION_RETENTION_DAYS,
    scopeIds: [SCOPE_ID],
    truncated: false,
    sessions: [session]
  });
  const config: StoredCodexConfig = {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: "a".repeat(64),
    selectedScopeIds: [SCOPE_ID],
    scopes: [
      {
        id: SCOPE_ID,
        queryPath: "/private/project",
        label: "Synthetic project",
        sessionCount: 1,
        lastActivityAt: SOURCE_UPDATED_AT
      }
    ],
    contentMode: "conversation_and_execution",
    contentConsentAt: FETCHED_AT,
    conversationConsentContract:
      CODEX_CONVERSATION_CONSENT_CONTRACT,
    conversationConsentAt: FETCHED_AT,
    conversationRetentionDays:
      CODEX_CONVERSATION_RETENTION_DAYS,
    discoveredAt: FETCHED_AT
  };
  const snapshot: CodexSnapshot = {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion:
      "codex-app-server-conversation-and-execution-v1",
    contentMode: "conversation_and_execution",
    codexVersion: "synthetic-test",
    fetchedAt: FETCHED_AT,
    lookbackStart: "2026-07-22T03:01:00.000Z",
    truncated: false,
    conversationStoreSha256: conversationStoreSha256(store),
    conversationRetentionDays:
      CODEX_CONVERSATION_RETENTION_DAYS,
    scopeIds: [SCOPE_ID],
    sessions: [
      {
        id: SESSION_ID,
        source: "codex",
        kind: "coding_session",
        scopeId: SCOPE_ID,
        projectLabel: "Synthetic project",
        taskSummary: "Synthetic task",
        taskSummarySource: "thread_name",
        createdAt: "2026-07-29T02:55:00.000Z",
        updatedAt: SOURCE_UPDATED_AT,
        activityState: "idle",
        attentionState: null,
        content: manifestFromConversationSession(session)
      }
    ]
  };
  return { config, snapshot, store };
}
