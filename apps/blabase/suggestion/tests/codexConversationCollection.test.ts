import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  discoverAndStoreCodexScopes,
  fetchAndStoreCodexSnapshot,
  selectStoredCodexScopes,
  type CodexThreadQuery
} from "../src/connectors/codex/appServer";
import {
  CODEX_CONVERSATION_CONSENT_CONTRACT,
  CODEX_CONVERSATION_RETENTION_DAYS
} from "../src/connectors/codex/conversationContract";
import { readStoredCodexConversationStore } from "../src/connectors/codex/localStore";
import { normalizeCodexSnapshotToWorkSignals } from "../src/connectors/codex/toWorkSignals";
import { SNAPSHOT_VALIDITY_POLICY_VERSION } from "../src/crossSource/versions";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const UPDATED_AT = "2026-07-29T10:00:00.000Z";
const PROJECT_PATH = "/Users/private/private-project";
const THREAD_ID = "native-thread-private";
const RAW_SENTINELS = {
  prompt: "RAW_FULL_PROMPT_SENTINEL",
  response: "RAW_FULL_RESPONSE_SENTINEL",
  output: "RAW_COMMAND_OUTPUT_SENTINEL",
  diff: "RAW_FILE_DIFF_SENTINEL",
  tool: "RAW_TOOL_RESULT_SENTINEL"
} as const;
const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  try {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true })
      )
    );
  } finally {
    vi.useRealTimers();
  }
});

describe("Codex conversation collection integration", () => {
  it("reads full historical turns into the private store and forwards only sanitized manifests", async () => {
    const cwd = await temporaryCwd();
    const discovery = await discoverAndStoreCodexScopes({
      cwd,
      now: NOW,
      queryThreads: async () => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [listedThread()],
          nextCursor: null
        }
      })
    });
    const scopeId = discovery.scopes[0]?.id;
    if (!scopeId) throw new Error("Expected a discovered scope.");
    const config = await selectStoredCodexScopes(
      [scopeId],
      cwd,
      "conversation_and_execution",
      NOW,
      {
        accepted: true,
        contract: CODEX_CONVERSATION_CONSENT_CONTRACT,
        retentionDays: CODEX_CONVERSATION_RETENTION_DAYS
      }
    );
    expect(config).toMatchObject({
      contentMode: "conversation_and_execution",
      conversationConsentContract:
        CODEX_CONVERSATION_CONSENT_CONTRACT,
      conversationRetentionDays: 7
    });
    const queryThreads: CodexThreadQuery = vi.fn(
      async (_params, _options) => ({
        codexVersion: "codex-cli 0.145.0",
        result: {
          data: [listedThread()],
          nextCursor: null
        },
        threadReads: [
          {
            threadId: THREAD_ID,
            status: "available" as const,
            result: fullThreadRead()
          }
        ],
        historyReadLimitReached: false
      })
    );

    const snapshot = await fetchAndStoreCodexSnapshot(config, {
      cwd,
      now: NOW,
      queryThreads
    });
    const queryMock = vi.mocked(queryThreads);
    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: [PROJECT_PATH] }),
      expect.objectContaining({
        includeTurns: true,
        maxThreadReads: 25
      })
    );
    expect(snapshot).toMatchObject({
      schemaVersion: "codex-snapshot-v3",
      collectorVersion:
        "codex-app-server-conversation-and-execution-v1",
      contentMode: "conversation_and_execution",
      conversationRetentionDays: 7,
      sessions: [
        {
          content: {
            state: "complete",
            historicalTurnStatus: "completed",
            userPromptCount: 1,
            agentResponseCount: 1,
            commandExecutionCount: 1,
            failedCommandCount: 1,
            fileChangeCount: 1,
            toolCallCount: 1
          }
        }
      ]
    });

    const rawStore = await readStoredCodexConversationStore(cwd);
    const serializedRawStore = JSON.stringify(rawStore);
    for (const sentinel of Object.values(RAW_SENTINELS)) {
      expect(serializedRawStore).toContain(sentinel);
    }
    expect(serializedRawStore).toContain(PROJECT_PATH);
    expect(serializedRawStore).toContain("sk-private123456");

    const serializedSnapshot = JSON.stringify(snapshot);
    for (const sentinel of Object.values(RAW_SENTINELS)) {
      expect(serializedSnapshot).not.toContain(sentinel);
    }
    expect(serializedSnapshot).not.toContain(PROJECT_PATH);
    expect(serializedSnapshot).not.toContain("sk-private123456");
    expect(serializedSnapshot).toContain("[로컬 경로]");
    expect(serializedSnapshot).toContain("[비밀값]");

    const normalized = normalizeCodexSnapshotToWorkSignals(
      snapshot,
      {
        asOf: "2026-07-29T12:01:00.000Z",
        freshnessPolicy: {
          version: SNAPSHOT_VALIDITY_POLICY_VERSION,
          maxAgeMsBySource: {
            github: 10 * 60 * 1_000,
            codex: 10 * 60 * 1_000
          },
          maxFutureClockSkewMs: 1_000
        }
      }
    );
    expect(normalized.status).toBe("normalized");
    const serializedSignals = JSON.stringify(normalized);
    for (const sentinel of Object.values(RAW_SENTINELS)) {
      expect(serializedSignals).not.toContain(sentinel);
    }
    expect(serializedSignals).not.toContain(PROJECT_PATH);
    expect(serializedSignals).not.toContain("sk-private123456");
  });
});

async function temporaryCwd(): Promise<string> {
  const cwd = await mkdtemp(
    join(tmpdir(), "blabase-codex-conversation-collection-")
  );
  temporaryDirectories.push(cwd);
  return cwd;
}

function listedThread() {
  return {
    id: THREAD_ID,
    cwd: PROJECT_PATH,
    name: "Private integration task",
    preview: "Private integration task",
    createdAt:
      Date.parse("2026-07-29T09:00:00.000Z") / 1_000,
    updatedAt: Date.parse(UPDATED_AT) / 1_000,
    status: { type: "idle" }
  };
}

function fullThreadRead(): unknown {
  return {
    thread: {
      id: THREAD_ID,
      updatedAt: Date.parse(UPDATED_AT) / 1_000,
      turns: [
        {
          id: "native-turn-1",
          itemsView: "full",
          status: "completed",
          startedAt:
            Date.parse("2026-07-29T09:55:00.000Z") / 1_000,
          completedAt: Date.parse(UPDATED_AT) / 1_000,
          durationMs: 300_000,
          error: null,
          items: [
            {
              id: "native-prompt-1",
              type: "userMessage",
              content: [
                {
                  type: "text",
                  text: `Fix ${PROJECT_PATH}/secret.ts with sk-private123456. ${"request context ".repeat(
                    40
                  )}${RAW_SENTINELS.prompt}`
                }
              ]
            },
            {
              id: "native-response-1",
              type: "agentMessage",
              phase: "final_answer",
              text: `Completed for owner@example.com. ${"response context ".repeat(
                40
              )}${RAW_SENTINELS.response}`
            },
            {
              id: "native-command-1",
              type: "commandExecution",
              command: `npm test ${PROJECT_PATH}`,
              cwd: PROJECT_PATH,
              status: "failed",
              commandActions: [],
              aggregatedOutput: RAW_SENTINELS.output,
              exitCode: 1,
              durationMs: 500
            },
            {
              id: "native-change-1",
              type: "fileChange",
              status: "completed",
              changes: [
                {
                  path: `${PROJECT_PATH}/secret.ts`,
                  kind: { type: "update" },
                  diff: RAW_SENTINELS.diff
                }
              ]
            },
            {
              id: "native-tool-1",
              type: "mcpToolCall",
              server: "github",
              tool: "get_issue",
              status: "completed",
              arguments: { issue: 1 },
              result: { content: RAW_SENTINELS.tool },
              error: null,
              durationMs: 25
            }
          ]
        }
      ]
    }
  };
}
