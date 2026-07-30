import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CODEX_CONVERSATION_COLLECTOR_VERSION,
  CODEX_CONVERSATION_CONSENT_CONTRACT,
  CODEX_CONVERSATION_FIELD_BYTE_LIMIT,
  CODEX_CONVERSATION_RETENTION_DAYS,
  CODEX_CONVERSATION_STORE_CONTRACT,
  codexConversationStoreSchema,
  conversationStoreSha256,
  manifestFromConversationSession,
  normalizeCodexThreadRead
} from "../src/connectors/codex/conversationContract";

const THREAD_ID = "native-thread-1";
const SESSION_ID = "0123456789abcdef01234567";
const SCOPE_ID = "89abcdef0123456701234567";
const SOURCE_UPDATED_AT = "2026-07-29T03:00:00.000Z";
const FETCHED_AT = "2026-07-29T03:01:00.000Z";
const EXPIRES_AT = "2026-08-05T03:01:00.000Z";

const RAW_SENTINELS = {
  prompt: "RAW_PROMPT_SENTINEL",
  response: "RAW_RESPONSE_SENTINEL",
  plan: "RAW_PLAN_SENTINEL",
  command: "RAW_COMMAND_SENTINEL",
  output: "RAW_STDOUT_STDERR_SENTINEL",
  diff: "RAW_DIFF_SENTINEL",
  tool: "RAW_TOOL_RESULT_SENTINEL"
} as const;

describe("Codex conversation and execution capture contract", () => {
  it("captures prompts, responses, plans, command results, diffs, and tool results while omitting reasoning", () => {
    const session = normalize(fullThreadResponse());
    const items = session.turns.flatMap((turn) => turn.items);

    expect(items.map((item) => item.type)).toEqual([
      "user_prompt",
      "agent_response",
      "plan",
      "command_execution",
      "file_change",
      "mcp_tool_call",
      "dynamic_tool_call"
    ]);
    expect(JSON.stringify(session)).not.toContain(
      "PRIVATE_REASONING_SENTINEL"
    );
    expect(session.acquisition).toMatchObject({
      state: "complete",
      sourceTurnCount: 1,
      storedTurnCount: 1,
      sourceItemCount: 8,
      storedItemCount: 7,
      omittedReasoningItemCount: 1,
      omittedUnsupportedItemCount: 0
    });
    expect(session.acquisition.reasonCodes).toEqual([
      "REASONING_EXCLUDED_BY_POLICY"
    ]);

    const prompt = items.find(
      (item) => item.type === "user_prompt"
    );
    const response = items.find(
      (item) => item.type === "agent_response"
    );
    const plan = items.find((item) => item.type === "plan");
    const command = items.find(
      (item) => item.type === "command_execution"
    );
    const fileChange = items.find(
      (item) => item.type === "file_change"
    );
    const mcpCall = items.find(
      (item) => item.type === "mcp_tool_call"
    );
    const dynamicCall = items.find(
      (item) => item.type === "dynamic_tool_call"
    );

    expect(prompt).toBeDefined();
    expect(
      prompt?.type === "user_prompt"
        ? prompt.textParts[0]?.value
        : null
    ).toContain(RAW_SENTINELS.prompt);
    expect(
      response?.type === "agent_response"
        ? response.text.value
        : null
    ).toContain(RAW_SENTINELS.response);
    expect(
      plan?.type === "plan" ? plan.text.value : null
    ).toContain(RAW_SENTINELS.plan);
    expect(
      command?.type === "command_execution"
        ? command.command.value
        : null
    ).toContain(RAW_SENTINELS.command);
    expect(
      command?.type === "command_execution"
        ? command.output?.value
        : null
    ).toContain(RAW_SENTINELS.output);
    expect(
      command?.type === "command_execution"
        ? command.exitCode
        : null
    ).toBe(1);
    expect(
      fileChange?.type === "file_change"
        ? fileChange.changes[0]?.diff.value
        : null
    ).toContain(RAW_SENTINELS.diff);
    expect(
      mcpCall?.type === "mcp_tool_call"
        ? mcpCall.resultJson?.value
        : null
    ).toContain(RAW_SENTINELS.tool);
    expect(
      dynamicCall?.type === "dynamic_tool_call"
        ? dynamicCall.resultJson?.value
        : null
    ).toContain("dynamic result");
  });

  it("marks unknown items as partial instead of inventing a known execution event", () => {
    const session = normalize(
      threadResponse([
        {
          id: "unknown-1",
          type: "futureNativeItem",
          payload: "UNKNOWN_ITEM_SENTINEL"
        }
      ])
    );

    expect(session.turns[0]?.items).toEqual([]);
    expect(session.acquisition).toMatchObject({
      state: "partial",
      sourceItemCount: 1,
      storedItemCount: 0,
      omittedUnsupportedItemCount: 1
    });
    expect(session.acquisition.reasonCodes).toContain(
      "UNSUPPORTED_ITEM"
    );
    expect(JSON.stringify(session)).not.toContain(
      "UNKNOWN_ITEM_SENTINEL"
    );
  });

  it("rejects malformed thread and turn envelopes", () => {
    expect(() =>
      normalize({
        thread: {
          id: THREAD_ID,
          updatedAt: Date.parse(SOURCE_UPDATED_AT) / 1_000,
          turns: [{ status: "completed", items: [] }]
        }
      })
    ).toThrow();
    expect(() =>
      normalize({
        thread: {
          id: "different-thread",
          updatedAt: Date.parse(SOURCE_UPDATED_AT) / 1_000,
          turns: []
        }
      })
    ).toThrow("different thread");
  });

  it("stores a bounded UTF-8 prefix and records field truncation as partial", () => {
    const oversized =
      "가".repeat(
        Math.ceil(CODEX_CONVERSATION_FIELD_BYTE_LIMIT / 3) + 8
      ) + "MUST_NOT_SURVIVE_TRUNCATION";
    const session = normalize(
      threadResponse([
        {
          id: "large-prompt",
          type: "userMessage",
          content: [{ type: "text", text: oversized }]
        }
      ])
    );
    const item = session.turns[0]?.items[0];

    expect(session.acquisition.state).toBe("partial");
    expect(session.acquisition.reasonCodes).toContain(
      "FIELD_BYTE_LIMIT"
    );
    expect(item?.type).toBe("user_prompt");
    if (item?.type !== "user_prompt") {
      throw new TypeError("Expected a normalized user prompt.");
    }
    expect(item.textParts[0]).toMatchObject({
      originalByteCount: Buffer.byteLength(oversized, "utf8"),
      truncated: true,
      sha256: createHash("sha256")
        .update(oversized)
        .digest("hex")
    });
    expect(item.textParts[0]?.storedByteCount).toBeLessThanOrEqual(
      CODEX_CONVERSATION_FIELD_BYTE_LIMIT
    );
    expect(item.textParts[0]?.storedByteCount).toBeGreaterThan(
      CODEX_CONVERSATION_FIELD_BYTE_LIMIT - 4
    );
    expect(item.textParts[0]?.value).not.toContain(
      "MUST_NOT_SURVIVE_TRUNCATION"
    );
  });

  it("hashes the strict raw store deterministically and changes the hash when store metadata changes", () => {
    const session = normalize(fullThreadResponse());
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
    const copy = structuredClone(store);
    const changed = codexConversationStoreSchema.parse({
      ...structuredClone(store),
      truncated: true
    });

    expect(conversationStoreSha256(store)).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(conversationStoreSha256(copy)).toBe(
      conversationStoreSha256(store)
    );
    expect(conversationStoreSha256(changed)).not.toBe(
      conversationStoreSha256(store)
    );
  });

  it("keeps full raw sentinels out of the bounded metadata manifest", () => {
    const session = normalize(fullThreadResponse());
    const manifest = manifestFromConversationSession(session);
    const serializedManifest = JSON.stringify(manifest);

    expect(manifest).toMatchObject({
      historicalTurnStatus: "completed",
      userPromptCount: 1,
      agentResponseCount: 1,
      commandExecutionCount: 1,
      failedCommandCount: 1,
      fileChangeCount: 1,
      toolCallCount: 2,
      omittedReasoningItemCount: 1
    });
    for (const sentinel of Object.values(RAW_SENTINELS)) {
      expect(serializedManifest).not.toContain(sentinel);
    }
    expect(serializedManifest).not.toContain(
      "PRIVATE_REASONING_SENTINEL"
    );
  });
});

function normalize(result: unknown) {
  return normalizeCodexThreadRead({
    result,
    expectedNativeThreadId: THREAD_ID,
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
}

function fullThreadResponse(): unknown {
  return threadResponse([
    {
      id: "prompt-1",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: `${"요청 ".repeat(140)}${RAW_SENTINELS.prompt}`
        }
      ]
    },
    {
      id: "response-1",
      type: "agentMessage",
      phase: "final_answer",
      text: `${"응답 ".repeat(140)}${RAW_SENTINELS.response}`
    },
    {
      id: "plan-1",
      type: "plan",
      text: `Inspect then verify ${RAW_SENTINELS.plan}`
    },
    {
      id: "command-1",
      type: "commandExecution",
      command: `npm test\n# ${RAW_SENTINELS.command}`,
      cwd: "/private/project",
      status: "failed",
      commandActions: [{ type: "read", path: "package.json" }],
      aggregatedOutput:
        `stdout line\nstderr line\n${RAW_SENTINELS.output}`,
      exitCode: 1,
      durationMs: 420
    },
    {
      id: "change-1",
      type: "fileChange",
      status: "completed",
      changes: [
        {
          path: "src/example.ts",
          kind: { type: "update" },
          diff: `@@ -1 +1 @@\n-old\n+new ${RAW_SENTINELS.diff}`
        }
      ]
    },
    {
      id: "mcp-1",
      type: "mcpToolCall",
      server: "github",
      tool: "get_issue",
      status: "completed",
      arguments: { issue: 7 },
      result: { text: RAW_SENTINELS.tool },
      error: null,
      durationMs: 25
    },
    {
      id: "dynamic-1",
      type: "dynamicToolCall",
      namespace: "workspace",
      tool: "inspect",
      status: "completed",
      arguments: { target: "src" },
      contentItems: [{ type: "text", text: "dynamic result" }],
      success: true,
      durationMs: 15
    },
    {
      id: "reasoning-1",
      type: "reasoning",
      summary: ["PRIVATE_REASONING_SENTINEL"],
      content: ["PRIVATE_REASONING_SENTINEL"]
    }
  ]);
}

function threadResponse(items: unknown[]): unknown {
  return {
    thread: {
      id: THREAD_ID,
      updatedAt: Date.parse(SOURCE_UPDATED_AT) / 1_000,
      turns: [
        {
          id: "turn-1",
          status: "completed",
          startedAt:
            Date.parse("2026-07-29T02:59:30.000Z") / 1_000,
          completedAt:
            Date.parse("2026-07-29T03:00:00.000Z") / 1_000,
          durationMs: 30_000,
          error: null,
          itemsView: "full",
          items
        }
      ]
    }
  };
}
