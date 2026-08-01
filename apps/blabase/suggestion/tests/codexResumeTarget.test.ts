import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  CodexResumeTargetError,
  resolveCodexResumeTarget
} from "../src/connectors/codex/resumeTarget";
import type { StoredCodexConfig } from "../src/connectors/codex/types";

const INSTALLATION_SECRET = "a".repeat(64);
const SELECTED_SCOPE_ID = "b".repeat(24);
const OTHER_SCOPE_ID = "c".repeat(24);
const PROJECT_PATH = "/Users/example/work/blabase";
const NATIVE_THREAD_ID = "019c1234-abcd-7000-8000-123456789abc";

describe("Codex resume target resolution", () => {
  it("lists only the selected scope and resolves the current HMAC in memory", async () => {
    const queryThreads = vi.fn(async () => ({
      codexVersion: "codex-cli 0.145.0",
      result: {
        data: [
          thread({
            id: NATIVE_THREAD_ID,
            cwd: PROJECT_PATH,
            updatedAt: "2026-07-30T04:00:00.000Z"
          })
        ],
        nextCursor: null
      }
    }));

    await expect(
      resolveCodexResumeTarget(
        {
          executionId: executionReferenceFor(NATIVE_THREAD_ID),
          scopeId: SELECTED_SCOPE_ID
        },
        {
          cwd: "/private/blabase",
          now: new Date("2026-07-30T05:00:00.000Z"),
          readConfig: async () => config(),
          queryThreads
        }
      )
    ).resolves.toEqual({
      nativeThreadId: NATIVE_THREAD_ID,
      cwd: PROJECT_PATH
    });

    expect(queryThreads).toHaveBeenCalledExactlyOnceWith({
      cursor: null,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "appServer", "exec"],
      useStateDbOnly: true,
      cwd: [PROJECT_PATH]
    });
  });

  it("does not resolve a native session returned outside its selected scope", async () => {
    await expect(
      resolveCodexResumeTarget(
        {
          executionId: executionReferenceFor(NATIVE_THREAD_ID),
          scopeId: SELECTED_SCOPE_ID
        },
        {
          now: new Date("2026-07-30T05:00:00.000Z"),
          readConfig: async () => config(),
          queryThreads: async () => ({
            codexVersion: "codex-cli 0.145.0",
            result: {
              data: [
                thread({
                  id: NATIVE_THREAD_ID,
                  cwd: "/Users/example/work/other",
                  updatedAt: "2026-07-30T04:00:00.000Z"
                })
              ]
            }
          })
        }
      )
    ).rejects.toMatchObject({
      code: "CODEX_EXECUTION_NOT_FOUND"
    });
  });

  it("fails closed when the command points to a scope no longer selected", async () => {
    const queryThreads = vi.fn();

    await expect(
      resolveCodexResumeTarget(
        {
          executionId: executionReferenceFor(NATIVE_THREAD_ID),
          scopeId: OTHER_SCOPE_ID
        },
        {
          readConfig: async () => config(),
          queryThreads
        }
      )
    ).rejects.toMatchObject({
      code: "CODEX_SCOPE_NOT_SELECTED"
    });
    expect(queryThreads).not.toHaveBeenCalled();
  });

  it("reports a matching session older than the connector lookback as stale", async () => {
    await expect(
      resolveCodexResumeTarget(
        {
          executionId: executionReferenceFor(NATIVE_THREAD_ID),
          scopeId: SELECTED_SCOPE_ID
        },
        {
          now: new Date("2026-07-30T05:00:00.000Z"),
          readConfig: async () => config(),
          queryThreads: async () => ({
            codexVersion: "codex-cli 0.145.0",
            result: {
              data: [
                thread({
                  id: NATIVE_THREAD_ID,
                  cwd: PROJECT_PATH,
                  updatedAt: "2026-06-01T04:00:00.000Z"
                })
              ]
            }
          })
        }
      )
    ).rejects.toMatchObject({
      code: "CODEX_EXECUTION_STALE"
    });
  });

  it("uses the current installation secret rather than accepting an old opaque id", async () => {
    const oldExecutionId = createHmac(
      "sha256",
      "d".repeat(64)
    )
      .update(`thread:${NATIVE_THREAD_ID}`)
      .digest("hex")
      .slice(0, 24);

    await expect(
      resolveCodexResumeTarget(
        {
          executionId: `codex:execution:${oldExecutionId}`,
          scopeId: SELECTED_SCOPE_ID
        },
        {
          now: new Date("2026-07-30T05:00:00.000Z"),
          readConfig: async () => config(),
          queryThreads: async () => ({
            codexVersion: "codex-cli 0.145.0",
            result: {
              data: [
                thread({
                  id: NATIVE_THREAD_ID,
                  cwd: PROJECT_PATH,
                  updatedAt: "2026-07-30T04:00:00.000Z"
                })
              ]
            }
          })
        }
      )
    ).rejects.toBeInstanceOf(CodexResumeTargetError);
  });

  it("rejects a matching native id that cannot be passed to the fixed CLI action", async () => {
    const unsafeNativeId = "thread id\nwith control";

    await expect(
      resolveCodexResumeTarget(
        {
          executionId: executionReferenceFor(unsafeNativeId),
          scopeId: SELECTED_SCOPE_ID
        },
        {
          now: new Date("2026-07-30T05:00:00.000Z"),
          readConfig: async () => config(),
          queryThreads: async () => ({
            codexVersion: "codex-cli 0.145.0",
            result: {
              data: [
                thread({
                  id: unsafeNativeId,
                  cwd: PROJECT_PATH,
                  updatedAt: "2026-07-30T04:00:00.000Z"
                })
              ]
            }
          })
        }
      )
    ).rejects.toMatchObject({
      code: "CODEX_RESUME_TARGET_INVALID"
    });
  });
});

function config(): StoredCodexConfig {
  return {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: INSTALLATION_SECRET,
    selectedScopeIds: [SELECTED_SCOPE_ID],
    scopes: [
      {
        id: SELECTED_SCOPE_ID,
        queryPath: PROJECT_PATH,
        label: "blabase",
        sessionCount: 1,
        lastActivityAt: "2026-07-30T04:00:00.000Z"
      }
    ],
    contentMode: "metadata_only",
    contentConsentAt: null,
    conversationConsentContract: null,
    conversationConsentAt: null,
    conversationRetentionDays: null,
    discoveredAt: "2026-07-30T04:00:00.000Z"
  };
}

function executionReferenceFor(nativeThreadId: string): string {
  const opaqueId = createHmac("sha256", INSTALLATION_SECRET)
    .update(`thread:${nativeThreadId}`)
    .digest("hex")
    .slice(0, 24);
  return `codex:execution:${opaqueId}`;
}

function thread(input: {
  id: string;
  cwd: string;
  updatedAt: string;
}): Record<string, unknown> {
  const updatedAt = Date.parse(input.updatedAt) / 1_000;
  return {
    id: input.id,
    cwd: input.cwd,
    createdAt: updatedAt - 60,
    updatedAt
  };
}
