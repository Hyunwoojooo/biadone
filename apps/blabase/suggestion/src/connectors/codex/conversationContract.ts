import { createHash } from "node:crypto";

import { z } from "zod";

import { runtimeSha256 } from "../../crossSource/canonicalHash";
import type {
  CodexConversationReasonCode,
  CodexHistoricalTurnStatus,
  CodexSessionContentManifest
} from "./types";

export const CODEX_CONVERSATION_STORE_CONTRACT =
  "codex-conversation-and-execution-store-v1" as const;
export const CODEX_CONVERSATION_SESSION_CONTRACT =
  "codex-conversation-and-execution-session-v1" as const;
export const CODEX_CONVERSATION_COLLECTOR_VERSION =
  "codex-app-server-thread-read-v1" as const;
export const CODEX_CONVERSATION_LIMITS_VERSION =
  "codex-conversation-content-limits-v1" as const;
export const CODEX_CONVERSATION_CONSENT_CONTRACT =
  "codex-conversation-content-consent-v1" as const;

export const CODEX_CONVERSATION_RETENTION_DAYS = 7 as const;
export const CODEX_CONVERSATION_THREAD_READ_LIMIT = 25;
export const CODEX_CONVERSATION_TURN_LIMIT = 100;
export const CODEX_CONVERSATION_ITEM_LIMIT = 1_000;
export const CODEX_CONVERSATION_FIELD_BYTE_LIMIT =
  1024 * 1024;
export const CODEX_CONVERSATION_THREAD_BYTE_LIMIT =
  16 * 1024 * 1024;

const opaqueIdSchema = z.string().regex(/^[a-f0-9]{24}$/);
const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const codexSessionContentManifestSchema = z
  .object({
    state: z.enum([
      "not_collected",
      "complete",
      "partial",
      "stale",
      "failed",
      "expired"
    ]),
    contentSha256: sha256Schema.nullable(),
    contentSourceUpdatedAt: timestampSchema.nullable(),
    collectedAt: timestampSchema.nullable(),
    expiresAt: timestampSchema.nullable(),
    historicalTurnStatus: z.enum([
      "completed",
      "failed",
      "interrupted",
      "in_progress",
      "unknown"
    ]),
    latestTurnCompletedAt: timestampSchema.nullable(),
    turnCount: z.number().int().nonnegative(),
    userPromptCount: z.number().int().nonnegative(),
    agentResponseCount: z.number().int().nonnegative(),
    commandExecutionCount: z.number().int().nonnegative(),
    failedCommandCount: z.number().int().nonnegative(),
    fileChangeCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    omittedReasoningItemCount: z.number().int().nonnegative(),
    omittedUnsupportedItemCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    reasonCodes: z.array(
      z.enum([
        "CONTENT_MODE_DISABLED",
        "OUTSIDE_RAW_RETENTION_WINDOW",
        "THREAD_READ_LIMIT",
        "THREAD_READ_FAILED",
        "THREAD_RESPONSE_INVALID",
        "THREAD_CHANGED_DURING_READ",
        "TURN_LIMIT",
        "ITEM_LIMIT",
        "FIELD_BYTE_LIMIT",
        "THREAD_BYTE_LIMIT",
        "UNSUPPORTED_ITEM",
        "REASONING_EXCLUDED_BY_POLICY"
      ])
    ),
    latestUserPromptExcerpt: z.string().max(300).nullable(),
    latestAgentResponseExcerpt: z.string().max(300).nullable(),
    latestExecutionSummary: z.string().max(300).nullable()
  })
  .strict()
  .superRefine((manifest, context) => {
    const hasContent = manifest.contentSha256 !== null;
    const contentMetadataPresent = [
      manifest.contentSourceUpdatedAt,
      manifest.collectedAt,
      manifest.expiresAt
    ].every((value) => value !== null);
    if (hasContent !== contentMetadataPresent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conversation content hash and timestamps must be present together."
      });
    }
    if (
      !hasContent &&
      (manifest.turnCount > 0 ||
        manifest.userPromptCount > 0 ||
        manifest.agentResponseCount > 0 ||
        manifest.commandExecutionCount > 0 ||
        manifest.failedCommandCount > 0 ||
        manifest.fileChangeCount > 0 ||
        manifest.toolCallCount > 0 ||
        manifest.omittedReasoningItemCount > 0 ||
        manifest.omittedUnsupportedItemCount > 0 ||
        manifest.truncated ||
        manifest.historicalTurnStatus !== "unknown" ||
        manifest.latestTurnCompletedAt !== null ||
        manifest.latestUserPromptExcerpt !== null ||
        manifest.latestAgentResponseExcerpt !== null ||
        manifest.latestExecutionSummary !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conversation counts require a persisted content artifact."
      });
    }
    const stateRequiresContent =
      manifest.state === "complete" ||
      manifest.state === "partial" ||
      manifest.state === "stale";
    if (stateRequiresContent !== hasContent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message:
          "Conversation collection state does not match persisted content availability."
      });
    }
    if (
      manifest.failedCommandCount >
      manifest.commandExecutionCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failedCommandCount"],
        message:
          "Failed command count cannot exceed command count."
      });
    }
  });

export const codexCapturedTextSchema = z
  .object({
    value: z.string(),
    originalByteCount: z.number().int().nonnegative(),
    storedByteCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    sha256: sha256Schema
  })
  .strict()
  .superRefine((text, context) => {
    if (
      text.storedByteCount !== Buffer.byteLength(text.value, "utf8") ||
      text.storedByteCount > text.originalByteCount ||
      text.truncated ===
        (text.storedByteCount === text.originalByteCount)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Captured text byte metadata is inconsistent."
      });
    }
  });

const capturedReferenceSchema = z
  .object({
    type: z.enum([
      "image_url",
      "local_image",
      "skill",
      "mention"
    ]),
    name: codexCapturedTextSchema.nullable(),
    reference: codexCapturedTextSchema
  })
  .strict();

const userPromptItemSchema = z
  .object({
    type: z.literal("user_prompt"),
    itemId: opaqueIdSchema,
    textParts: z.array(codexCapturedTextSchema),
    references: z.array(capturedReferenceSchema)
  })
  .strict();

const agentResponseItemSchema = z
  .object({
    type: z.literal("agent_response"),
    itemId: opaqueIdSchema,
    phase: z.enum(["commentary", "final_answer"]).nullable(),
    text: codexCapturedTextSchema
  })
  .strict();

const planItemSchema = z
  .object({
    type: z.literal("plan"),
    itemId: opaqueIdSchema,
    text: codexCapturedTextSchema
  })
  .strict();

const commandExecutionItemSchema = z
  .object({
    type: z.literal("command_execution"),
    itemId: opaqueIdSchema,
    command: codexCapturedTextSchema,
    cwd: codexCapturedTextSchema,
    status: z.enum([
      "in_progress",
      "completed",
      "failed",
      "declined",
      "unknown"
    ]),
    commandActionsJson: codexCapturedTextSchema,
    output: codexCapturedTextSchema.nullable(),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative().nullable()
  })
  .strict();

const fileChangeItemSchema = z
  .object({
    type: z.literal("file_change"),
    itemId: opaqueIdSchema,
    status: z.enum([
      "in_progress",
      "completed",
      "failed",
      "declined",
      "unknown"
    ]),
    changes: z.array(
      z
        .object({
          path: codexCapturedTextSchema,
          kindJson: codexCapturedTextSchema,
          diff: codexCapturedTextSchema
        })
        .strict()
    )
  })
  .strict();

const toolCallItemSchema = z
  .object({
    type: z.enum(["mcp_tool_call", "dynamic_tool_call"]),
    itemId: opaqueIdSchema,
    namespace: codexCapturedTextSchema.nullable(),
    tool: codexCapturedTextSchema,
    status: z.enum([
      "in_progress",
      "completed",
      "failed",
      "unknown"
    ]),
    argumentsJson: codexCapturedTextSchema,
    resultJson: codexCapturedTextSchema.nullable(),
    error: codexCapturedTextSchema.nullable(),
    success: z.boolean().nullable(),
    durationMs: z.number().int().nonnegative().nullable()
  })
  .strict();

const processEventItemSchema = z
  .object({
    type: z.literal("process_event"),
    itemId: opaqueIdSchema,
    nativeType: z.string().min(1).max(120),
    payloadJson: codexCapturedTextSchema
  })
  .strict();

export const codexConversationItemSchema = z.discriminatedUnion(
  "type",
  [
    userPromptItemSchema,
    agentResponseItemSchema,
    planItemSchema,
    commandExecutionItemSchema,
    fileChangeItemSchema,
    toolCallItemSchema,
    processEventItemSchema
  ]
);

export const codexConversationTurnSchema = z
  .object({
    turnId: opaqueIdSchema,
    sourceOrder: z.number().int().nonnegative(),
    status: z.enum([
      "completed",
      "failed",
      "interrupted",
      "in_progress",
      "unknown"
    ]),
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    errorMessage: codexCapturedTextSchema.nullable(),
    errorCodeJson: codexCapturedTextSchema.nullable(),
    errorAdditionalDetails: codexCapturedTextSchema.nullable(),
    items: z.array(codexConversationItemSchema)
  })
  .strict();

const conversationSessionWithoutHashBaseSchema = z
  .object({
    contract: z.literal(CODEX_CONVERSATION_SESSION_CONTRACT),
    sessionId: opaqueIdSchema,
    scopeId: opaqueIdSchema,
    sourceUpdatedAt: timestampSchema,
    contentSourceUpdatedAt: timestampSchema,
    fetchedAt: timestampSchema,
    expiresAt: timestampSchema,
    acquisition: z
      .object({
        strategy: z.literal("thread_read"),
        state: z.enum(["complete", "partial"]),
        reasonCodes: z.array(
          z.enum([
            "TURN_LIMIT",
            "ITEM_LIMIT",
            "FIELD_BYTE_LIMIT",
            "THREAD_BYTE_LIMIT",
            "UNSUPPORTED_ITEM",
            "REASONING_EXCLUDED_BY_POLICY"
          ])
        ),
        limitsVersion: z.literal(CODEX_CONVERSATION_LIMITS_VERSION),
        sourceTurnCount: z.number().int().nonnegative(),
        storedTurnCount: z.number().int().nonnegative(),
        sourceItemCount: z.number().int().nonnegative(),
        storedItemCount: z.number().int().nonnegative(),
        storedByteCount: z.number().int().nonnegative(),
        omittedReasoningItemCount: z.number().int().nonnegative(),
        omittedUnsupportedItemCount: z.number().int().nonnegative()
      })
      .strict(),
    turns: z.array(codexConversationTurnSchema)
  })
  .strict();

function validateConversationSessionEnvelope(
  session: z.infer<
    typeof conversationSessionWithoutHashBaseSchema
  >,
  context: z.RefinementCtx
): void {
  if (
    session.sourceUpdatedAt !== session.contentSourceUpdatedAt
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentSourceUpdatedAt"],
      message:
        "Conversation content must describe the exact listed thread revision."
    });
  }
  if (
    Date.parse(session.expiresAt) <= Date.parse(session.fetchedAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message:
        "Conversation session expiry must follow collection."
    });
  }
  const storedItemCount = session.turns.reduce(
    (total, turn) => total + turn.items.length,
    0
  );
  if (
    session.acquisition.storedTurnCount !==
      session.turns.length ||
    session.acquisition.storedItemCount !== storedItemCount ||
    session.acquisition.sourceTurnCount <
      session.acquisition.storedTurnCount ||
    session.acquisition.sourceItemCount <
      session.acquisition.storedItemCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acquisition"],
      message:
        "Conversation acquisition counts do not match stored turns and items."
    });
  }
  if (
    session.acquisition.state === "complete" &&
    session.acquisition.reasonCodes.some(
      (reason) => reason !== "REASONING_EXCLUDED_BY_POLICY"
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["acquisition", "state"],
      message:
        "Incomplete acquisition reasons require partial state."
    });
  }
}

const conversationSessionWithoutHashSchema =
  conversationSessionWithoutHashBaseSchema.superRefine(
    validateConversationSessionEnvelope
  );

export const codexConversationSessionSchema =
  conversationSessionWithoutHashBaseSchema
    .extend({ contentSha256: sha256Schema })
    .strict()
    .superRefine((session, context) => {
      validateConversationSessionEnvelope(session, context);
      const { contentSha256, ...withoutHash } = session;
      if (
        contentSha256 !==
        runtimeSha256({
          domain: "codex-conversation-session-v1",
          session: withoutHash
        })
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contentSha256"],
          message: "Conversation session hash does not match content."
        });
      }
    });

export const codexConversationStoreSchema = z
  .object({
    contract: z.literal(CODEX_CONVERSATION_STORE_CONTRACT),
    collectorVersion: z.literal(CODEX_CONVERSATION_COLLECTOR_VERSION),
    consentContract: z.literal(CODEX_CONVERSATION_CONSENT_CONTRACT),
    collectedAt: timestampSchema,
    expiresAt: timestampSchema,
    retentionDays: z.literal(CODEX_CONVERSATION_RETENTION_DAYS),
    scopeIds: z.array(opaqueIdSchema).min(1),
    truncated: z.boolean(),
    sessions: z.array(codexConversationSessionSchema)
  })
  .strict()
  .superRefine((store, context) => {
    if (Date.parse(store.expiresAt) <= Date.parse(store.collectedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "Conversation store expiry must follow collection."
      });
    }
    const ids = store.sessions.map((session) => session.sessionId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sessions"],
        message: "Conversation store session IDs must be unique."
      });
    }
    if (new Set(store.scopeIds).size !== store.scopeIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopeIds"],
        message: "Conversation store scope IDs must be unique."
      });
    }
    store.sessions.forEach((session, index) => {
      if (!store.scopeIds.includes(session.scopeId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index, "scopeId"],
          message:
            "Conversation session scope must belong to the store."
        });
      }
      if (
        Date.parse(session.fetchedAt) >
          Date.parse(store.collectedAt) ||
        Date.parse(session.expiresAt) >
          Date.parse(store.expiresAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sessions", index],
          message:
            "Conversation session timestamps exceed the store retention envelope."
        });
      }
    });
  });

export type CodexConversationStore = z.infer<
  typeof codexConversationStoreSchema
>;
export type CodexConversationSession = z.infer<
  typeof codexConversationSessionSchema
>;
export type CodexConversationTurn = z.infer<
  typeof codexConversationTurnSchema
>;
export type CodexConversationItem = z.infer<
  typeof codexConversationItemSchema
>;

type CaptureContext = {
  storedBytes: number;
  fieldTruncated: boolean;
  threadTruncated: boolean;
  reasonCodes: Set<CodexConversationReasonCode>;
};

const rawThreadReadSchema = z
  .object({
    thread: z
      .object({
        id: z.string().min(1),
        updatedAt: z.number().finite(),
        turns: z.array(z.unknown())
      })
      .strip()
  })
  .strip();

const rawTurnSchema = z
  .object({
    id: z.string().min(1),
    items: z.array(z.unknown()),
    itemsView: z.enum(["notLoaded", "summary", "full"]).optional(),
    status: z.string(),
    error: z.unknown().nullable().optional(),
    startedAt: z.number().finite().nullable().optional(),
    completedAt: z.number().finite().nullable().optional(),
    durationMs: z.number().int().nonnegative().nullable().optional()
  })
  .strip();

export function normalizeCodexThreadRead(input: {
  result: unknown;
  expectedNativeThreadId: string;
  sessionId: string;
  scopeId: string;
  sourceUpdatedAt: string;
  fetchedAt: string;
  expiresAt: string;
  opaqueId: (
    kind: "turn" | "item",
    nativeId: string
  ) => string;
}): CodexConversationSession {
  const parsed = rawThreadReadSchema.parse(input.result);
  if (parsed.thread.id !== input.expectedNativeThreadId) {
    throw new TypeError("Codex thread/read returned a different thread.");
  }
  const responseUpdatedAt = epochSecondsToIso(parsed.thread.updatedAt);
  if (responseUpdatedAt !== input.sourceUpdatedAt) {
    throw new TypeError("Codex thread changed while history was read.");
  }

  const capture: CaptureContext = {
    storedBytes: 0,
    fieldTruncated: false,
    threadTruncated: false,
    reasonCodes: new Set()
  };
  const sourceTurnCount = parsed.thread.turns.length;
  const turnsInput = parsed.thread.turns.slice(
    0,
    CODEX_CONVERSATION_TURN_LIMIT
  );
  if (turnsInput.length < sourceTurnCount) {
    capture.reasonCodes.add("TURN_LIMIT");
  }

  let sourceItemCount = 0;
  let storedItemCount = 0;
  let omittedReasoningItemCount = 0;
  let omittedUnsupportedItemCount = 0;
  let remainingItems = CODEX_CONVERSATION_ITEM_LIMIT;
  const turns: CodexConversationTurn[] = [];

  for (const [sourceOrder, turnInput] of turnsInput.entries()) {
    const turn = rawTurnSchema.parse(turnInput);
    sourceItemCount += turn.items.length;
    if (turn.itemsView && turn.itemsView !== "full") {
      capture.reasonCodes.add("UNSUPPORTED_ITEM");
    }
    const selectedItems = turn.items.slice(
      0,
      Math.max(0, remainingItems)
    );
    if (selectedItems.length < turn.items.length) {
      capture.reasonCodes.add("ITEM_LIMIT");
    }
    remainingItems -= selectedItems.length;
    const items: CodexConversationItem[] = [];

    for (const itemInput of selectedItems) {
      const normalized = normalizeItem(
        itemInput,
        input.opaqueId,
        capture
      );
      if (normalized.kind === "reasoning_omitted") {
        omittedReasoningItemCount += 1;
        continue;
      }
      if (normalized.kind === "unsupported") {
        omittedUnsupportedItemCount += 1;
        continue;
      }
      items.push(normalized.item);
      storedItemCount += 1;
    }

    const error = normalizeTurnError(turn.error, capture);
    turns.push(
      codexConversationTurnSchema.parse({
        turnId: input.opaqueId("turn", turn.id),
        sourceOrder,
        status: normalizeTurnStatus(turn.status),
        startedAt: nullableEpochSecondsToIso(turn.startedAt),
        completedAt: nullableEpochSecondsToIso(turn.completedAt),
        durationMs: turn.durationMs ?? null,
        errorMessage: error.message,
        errorCodeJson: error.code,
        errorAdditionalDetails: error.additionalDetails,
        items
      })
    );
  }

  if (remainingItems === 0 && sourceItemCount > storedItemCount) {
    capture.reasonCodes.add("ITEM_LIMIT");
  }
  if (omittedReasoningItemCount > 0) {
    capture.reasonCodes.add("REASONING_EXCLUDED_BY_POLICY");
  }
  if (omittedUnsupportedItemCount > 0) {
    capture.reasonCodes.add("UNSUPPORTED_ITEM");
  }
  if (capture.fieldTruncated) {
    capture.reasonCodes.add("FIELD_BYTE_LIMIT");
  }
  if (capture.threadTruncated) {
    capture.reasonCodes.add("THREAD_BYTE_LIMIT");
  }

  const reasonCodes = [...capture.reasonCodes]
    .filter(
      (
        code
      ): code is Extract<
        CodexConversationReasonCode,
        | "TURN_LIMIT"
        | "ITEM_LIMIT"
        | "FIELD_BYTE_LIMIT"
        | "THREAD_BYTE_LIMIT"
        | "UNSUPPORTED_ITEM"
        | "REASONING_EXCLUDED_BY_POLICY"
      > =>
        code === "TURN_LIMIT" ||
        code === "ITEM_LIMIT" ||
        code === "FIELD_BYTE_LIMIT" ||
        code === "THREAD_BYTE_LIMIT" ||
        code === "UNSUPPORTED_ITEM" ||
        code === "REASONING_EXCLUDED_BY_POLICY"
    )
    .sort();
  const withoutHash = conversationSessionWithoutHashSchema.parse({
    contract: CODEX_CONVERSATION_SESSION_CONTRACT,
    sessionId: input.sessionId,
    scopeId: input.scopeId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    contentSourceUpdatedAt: responseUpdatedAt,
    fetchedAt: input.fetchedAt,
    expiresAt: input.expiresAt,
    acquisition: {
      strategy: "thread_read",
      state: reasonCodes.some(
        (code) => code !== "REASONING_EXCLUDED_BY_POLICY"
      )
        ? "partial"
        : "complete",
      reasonCodes,
      limitsVersion: CODEX_CONVERSATION_LIMITS_VERSION,
      sourceTurnCount,
      storedTurnCount: turns.length,
      sourceItemCount,
      storedItemCount,
      storedByteCount: capture.storedBytes,
      omittedReasoningItemCount,
      omittedUnsupportedItemCount
    },
    turns
  });
  return codexConversationSessionSchema.parse({
    ...withoutHash,
    contentSha256: runtimeSha256({
      domain: "codex-conversation-session-v1",
      session: withoutHash
    })
  });
}

export function conversationStoreSha256(
  store: CodexConversationStore
): string {
  return runtimeSha256({
    domain: "codex-conversation-store-v1",
    store: codexConversationStoreSchema.parse(store)
  });
}

export function emptyCodexContentManifest(
  reasonCode: CodexConversationReasonCode = "CONTENT_MODE_DISABLED"
): CodexSessionContentManifest {
  return {
    state:
      reasonCode === "OUTSIDE_RAW_RETENTION_WINDOW"
        ? "expired"
        : "not_collected",
    contentSha256: null,
    contentSourceUpdatedAt: null,
    collectedAt: null,
    expiresAt: null,
    historicalTurnStatus: "unknown",
    latestTurnCompletedAt: null,
    turnCount: 0,
    userPromptCount: 0,
    agentResponseCount: 0,
    commandExecutionCount: 0,
    failedCommandCount: 0,
    fileChangeCount: 0,
    toolCallCount: 0,
    omittedReasoningItemCount: 0,
    omittedUnsupportedItemCount: 0,
    truncated: false,
    reasonCodes: [reasonCode],
    latestUserPromptExcerpt: null,
    latestAgentResponseExcerpt: null,
    latestExecutionSummary: null
  };
}

export function failedCodexContentManifest(input: {
  reasonCode:
    | "THREAD_READ_LIMIT"
    | "THREAD_READ_FAILED"
    | "THREAD_RESPONSE_INVALID"
    | "THREAD_CHANGED_DURING_READ";
  previous?: CodexConversationSession;
}): CodexSessionContentManifest {
  if (input.previous) {
    return {
      ...manifestFromConversationSession(input.previous),
      state: "stale",
      reasonCodes: [
        ...new Set([
          ...input.previous.acquisition.reasonCodes,
          input.reasonCode
        ])
      ].sort() as CodexConversationReasonCode[]
    };
  }
  return {
    ...emptyCodexContentManifest(input.reasonCode),
    state: "failed"
  };
}

export function manifestFromConversationSession(
  session: CodexConversationSession
): CodexSessionContentManifest {
  const turns = [...session.turns].sort(
    (left, right) => left.sourceOrder - right.sourceOrder
  );
  const latestTurn = turns.at(-1);
  const allItems = turns.flatMap((turn) => turn.items);
  const prompts = allItems.filter(
    (
      item
    ): item is Extract<
      CodexConversationItem,
      { type: "user_prompt" }
    > => item.type === "user_prompt"
  );
  const responses = allItems.filter(
    (
      item
    ): item is Extract<
      CodexConversationItem,
      { type: "agent_response" }
    > => item.type === "agent_response"
  );
  const commands = allItems.filter(
    (
      item
    ): item is Extract<
      CodexConversationItem,
      { type: "command_execution" }
    > => item.type === "command_execution"
  );
  const fileChanges = allItems.filter(
    (item) => item.type === "file_change"
  );
  const toolCalls = allItems.filter(
    (item) =>
      item.type === "mcp_tool_call" ||
      item.type === "dynamic_tool_call"
  );
  const latestPrompt = prompts.at(-1);
  const latestResponse =
    [...responses]
      .reverse()
      .find((response) => response.phase === "final_answer") ??
    responses.at(-1);
  const lastCommand = commands.at(-1);
  const commandSummary = lastCommand
    ? [
        lastCommand.status,
        lastCommand.exitCode === null
          ? null
          : `exit ${lastCommand.exitCode}`,
        firstLine(lastCommand.command.value)
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return {
    state:
      session.acquisition.state === "complete"
        ? "complete"
        : "partial",
    contentSha256: session.contentSha256,
    contentSourceUpdatedAt: session.contentSourceUpdatedAt,
    collectedAt: session.fetchedAt,
    expiresAt: session.expiresAt,
    historicalTurnStatus: latestTurn?.status ?? "unknown",
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    turnCount: turns.length,
    userPromptCount: prompts.length,
    agentResponseCount: responses.length,
    commandExecutionCount: commands.length,
    failedCommandCount: commands.filter(
      (command) =>
        command.status === "failed" ||
        (command.exitCode !== null && command.exitCode !== 0)
    ).length,
    fileChangeCount: fileChanges.length,
    toolCallCount: toolCalls.length,
    omittedReasoningItemCount:
      session.acquisition.omittedReasoningItemCount,
    omittedUnsupportedItemCount:
      session.acquisition.omittedUnsupportedItemCount,
    truncated: session.acquisition.state === "partial",
    reasonCodes: session.acquisition.reasonCodes,
    latestUserPromptExcerpt: latestPrompt
      ? excerpt(
          latestPrompt.textParts.map((part) => part.value).join("\n")
        )
      : null,
    latestAgentResponseExcerpt: latestResponse
      ? excerpt(latestResponse.text.value)
      : null,
    latestExecutionSummary: commandSummary
      ? excerpt(commandSummary)
      : null
  };
}

function normalizeItem(
  input: unknown,
  opaqueId: (
    kind: "turn" | "item",
    nativeId: string
  ) => string,
  capture: CaptureContext
):
  | { kind: "stored"; item: CodexConversationItem }
  | { kind: "reasoning_omitted" }
  | { kind: "unsupported" } {
  if (!input || typeof input !== "object") {
    capture.reasonCodes.add("UNSUPPORTED_ITEM");
    return { kind: "unsupported" };
  }
  const item = input as Record<string, unknown>;
  if (typeof item.type !== "string" || typeof item.id !== "string") {
    capture.reasonCodes.add("UNSUPPORTED_ITEM");
    return { kind: "unsupported" };
  }
  const itemId = opaqueId("item", item.id);

  switch (item.type) {
    case "reasoning":
      return { kind: "reasoning_omitted" };
    case "userMessage": {
      const content = Array.isArray(item.content) ? item.content : [];
      const textParts: z.infer<typeof codexCapturedTextSchema>[] = [];
      const references: z.infer<typeof capturedReferenceSchema>[] = [];
      for (const partInput of content) {
        if (!partInput || typeof partInput !== "object") {
          capture.reasonCodes.add("UNSUPPORTED_ITEM");
          continue;
        }
        const part = partInput as Record<string, unknown>;
        if (part.type === "text" && typeof part.text === "string") {
          textParts.push(captureText(part.text, capture));
        } else if (
          (part.type === "image" && typeof part.url === "string") ||
          (part.type === "localImage" &&
            typeof part.path === "string") ||
          ((part.type === "skill" || part.type === "mention") &&
            typeof part.path === "string")
        ) {
          references.push(
            capturedReferenceSchema.parse({
              type:
                part.type === "image"
                  ? "image_url"
                  : part.type === "localImage"
                    ? "local_image"
                    : part.type,
              name:
                typeof part.name === "string"
                  ? captureText(part.name, capture)
                  : null,
              reference: captureText(
                part.type === "image"
                  ? (part.url as string)
                  : (part.path as string),
                capture
              )
            })
          );
        } else {
          capture.reasonCodes.add("UNSUPPORTED_ITEM");
        }
      }
      return {
        kind: "stored",
        item: userPromptItemSchema.parse({
          type: "user_prompt",
          itemId,
          textParts,
          references
        })
      };
    }
    case "agentMessage":
      if (typeof item.text !== "string") {
        return unsupported(capture);
      }
      return {
        kind: "stored",
        item: agentResponseItemSchema.parse({
          type: "agent_response",
          itemId,
          phase:
            item.phase === "commentary" ||
            item.phase === "final_answer"
              ? item.phase
              : null,
          text: captureText(item.text, capture)
        })
      };
    case "plan":
      if (typeof item.text !== "string") {
        return unsupported(capture);
      }
      return {
        kind: "stored",
        item: planItemSchema.parse({
          type: "plan",
          itemId,
          text: captureText(item.text, capture)
        })
      };
    case "commandExecution":
      if (
        typeof item.command !== "string" ||
        typeof item.cwd !== "string"
      ) {
        return unsupported(capture);
      }
      return {
        kind: "stored",
        item: commandExecutionItemSchema.parse({
          type: "command_execution",
          itemId,
          command: captureText(item.command, capture),
          cwd: captureText(item.cwd, capture),
          status: normalizeItemStatus(item.status),
          commandActionsJson: captureJson(
            item.commandActions ?? [],
            capture
          ),
          output:
            typeof item.aggregatedOutput === "string"
              ? captureText(item.aggregatedOutput, capture)
              : null,
          exitCode:
            typeof item.exitCode === "number" &&
            Number.isInteger(item.exitCode)
              ? item.exitCode
              : null,
          durationMs: nonnegativeIntegerOrNull(item.durationMs)
        })
      };
    case "fileChange": {
      if (!Array.isArray(item.changes)) {
        return unsupported(capture);
      }
      const changes = item.changes.flatMap((changeInput) => {
        if (!changeInput || typeof changeInput !== "object") {
          capture.reasonCodes.add("UNSUPPORTED_ITEM");
          return [];
        }
        const change = changeInput as Record<string, unknown>;
        if (
          typeof change.path !== "string" ||
          typeof change.diff !== "string"
        ) {
          capture.reasonCodes.add("UNSUPPORTED_ITEM");
          return [];
        }
        return [
          {
            path: captureText(change.path, capture),
            kindJson: captureJson(change.kind ?? null, capture),
            diff: captureText(change.diff, capture)
          }
        ];
      });
      return {
        kind: "stored",
        item: fileChangeItemSchema.parse({
          type: "file_change",
          itemId,
          status: normalizeItemStatus(item.status),
          changes
        })
      };
    }
    case "mcpToolCall":
      if (
        typeof item.server !== "string" ||
        typeof item.tool !== "string"
      ) {
        return unsupported(capture);
      }
      return {
        kind: "stored",
        item: toolCallItemSchema.parse({
          type: "mcp_tool_call",
          itemId,
          namespace: captureText(item.server, capture),
          tool: captureText(item.tool, capture),
          status: normalizeToolStatus(item.status),
          argumentsJson: captureJson(item.arguments ?? null, capture),
          resultJson:
            item.result === null || item.result === undefined
              ? null
              : captureJson(item.result, capture),
          error:
            item.error &&
            typeof item.error === "object" &&
            typeof (item.error as Record<string, unknown>).message ===
              "string"
              ? captureText(
                  (item.error as { message: string }).message,
                  capture
                )
              : null,
          success: null,
          durationMs: nonnegativeIntegerOrNull(item.durationMs)
        })
      };
    case "dynamicToolCall":
      if (typeof item.tool !== "string") {
        return unsupported(capture);
      }
      return {
        kind: "stored",
        item: toolCallItemSchema.parse({
          type: "dynamic_tool_call",
          itemId,
          namespace:
            typeof item.namespace === "string"
              ? captureText(item.namespace, capture)
              : null,
          tool: captureText(item.tool, capture),
          status: normalizeToolStatus(item.status),
          argumentsJson: captureJson(item.arguments ?? null, capture),
          resultJson:
            item.contentItems === null ||
            item.contentItems === undefined
              ? null
              : captureJson(item.contentItems, capture),
          error: null,
          success:
            typeof item.success === "boolean" ? item.success : null,
          durationMs: nonnegativeIntegerOrNull(item.durationMs)
        })
      };
    case "collabAgentToolCall":
    case "subAgentActivity":
    case "webSearch":
    case "imageView":
    case "sleep":
    case "imageGeneration":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
      return {
        kind: "stored",
        item: processEventItemSchema.parse({
          type: "process_event",
          itemId,
          nativeType: item.type,
          payloadJson: captureJson(
            Object.fromEntries(
              Object.entries(item).filter(([key]) => key !== "id")
            ),
            capture
          )
        })
      };
    default:
      return unsupported(capture);
  }
}

function unsupported(
  capture: CaptureContext
): { kind: "unsupported" } {
  capture.reasonCodes.add("UNSUPPORTED_ITEM");
  return { kind: "unsupported" };
}

function normalizeTurnError(
  input: unknown,
  capture: CaptureContext
): {
  message: z.infer<typeof codexCapturedTextSchema> | null;
  code: z.infer<typeof codexCapturedTextSchema> | null;
  additionalDetails: z.infer<typeof codexCapturedTextSchema> | null;
} {
  if (!input || typeof input !== "object") {
    return { message: null, code: null, additionalDetails: null };
  }
  const error = input as Record<string, unknown>;
  return {
    message:
      typeof error.message === "string"
        ? captureText(error.message, capture)
        : null,
    code:
      error.codexErrorInfo === null ||
      error.codexErrorInfo === undefined
        ? null
        : captureJson(error.codexErrorInfo, capture),
    additionalDetails:
      typeof error.additionalDetails === "string"
        ? captureText(error.additionalDetails, capture)
        : null
  };
}

function captureJson(
  value: unknown,
  capture: CaptureContext
): z.infer<typeof codexCapturedTextSchema> {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = "null";
    capture.reasonCodes.add("UNSUPPORTED_ITEM");
  }
  return captureText(serialized ?? "null", capture);
}

function captureText(
  value: string,
  capture: CaptureContext
): z.infer<typeof codexCapturedTextSchema> {
  const originalByteCount = Buffer.byteLength(value, "utf8");
  const remainingThreadBytes = Math.max(
    0,
    CODEX_CONVERSATION_THREAD_BYTE_LIMIT - capture.storedBytes
  );
  const byteLimit = Math.min(
    CODEX_CONVERSATION_FIELD_BYTE_LIMIT,
    remainingThreadBytes
  );
  const storedValue = truncateUtf8(value, byteLimit);
  const storedByteCount = Buffer.byteLength(storedValue, "utf8");
  capture.storedBytes += storedByteCount;
  if (storedByteCount < originalByteCount) {
    if (
      byteLimit === remainingThreadBytes &&
      remainingThreadBytes <
        CODEX_CONVERSATION_FIELD_BYTE_LIMIT
    ) {
      capture.threadTruncated = true;
    } else {
      capture.fieldTruncated = true;
    }
  }
  return codexCapturedTextSchema.parse({
    value: storedValue,
    originalByteCount,
    storedByteCount,
    truncated: storedByteCount < originalByteCount,
    sha256: createHash("sha256").update(value).digest("hex")
  });
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  let usedBytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (usedBytes + characterBytes > maximumBytes) break;
    result += character;
    usedBytes += characterBytes;
  }
  return result;
}

function normalizeTurnStatus(
  value: string
): CodexHistoricalTurnStatus {
  switch (value) {
    case "completed":
    case "failed":
    case "interrupted":
      return value;
    case "inProgress":
      return "in_progress";
    default:
      return "unknown";
  }
}

function normalizeItemStatus(
  value: unknown
):
  | "in_progress"
  | "completed"
  | "failed"
  | "declined"
  | "unknown" {
  switch (value) {
    case "inProgress":
      return "in_progress";
    case "completed":
    case "failed":
    case "declined":
      return value;
    default:
      return "unknown";
  }
}

function normalizeToolStatus(
  value: unknown
): "in_progress" | "completed" | "failed" | "unknown" {
  switch (value) {
    case "inProgress":
      return "in_progress";
    case "completed":
    case "failed":
      return value;
    default:
      return "unknown";
  }
}

function nullableEpochSecondsToIso(
  value: number | null | undefined
): string | null {
  return value === null || value === undefined
    ? null
    : epochSecondsToIso(value);
}

function epochSecondsToIso(value: number): string {
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("Invalid Codex epoch timestamp.");
  }
  return date.toISOString();
}

function nonnegativeIntegerOrNull(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function excerpt(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return [...normalized].slice(0, 300).join("");
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? value;
}
