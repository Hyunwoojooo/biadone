import { z } from "zod";

import type {
  CodexActivityState,
  CodexSessionSignal
} from "./types";

export const CODEX_EXECUTION_OBSERVATION_CONTRACT =
  "codex-execution-observation-v2" as const;

export const CODEX_APP_SERVER_EVENT_SCHEMA_VERSION =
  "codex-app-server-v2-generated-2026-07-27" as const;

export const CODEX_OBSERVATION_HISTORY_CONTRACT =
  "codex-observation-history-v2" as const;

const LEGACY_CODEX_EXECUTION_OBSERVATION_CONTRACT =
  "codex-execution-observation-v1" as const;

const LEGACY_CODEX_OBSERVATION_HISTORY_CONTRACT =
  "codex-observation-history-v1" as const;

const timestampSchema = z.string().datetime();
const opaqueExecutionIdSchema = z.string().regex(/^[a-f0-9]{24}$/);

const completedTurnStatusSchema = z.enum([
  "completed",
  "interrupted",
  "failed"
]);

const threadStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notLoaded") }).strip(),
  z.object({ type: z.literal("idle") }).strip(),
  z.object({ type: z.literal("systemError") }).strip(),
  z
    .object({
      type: z.literal("active"),
      activeFlags: z
        .array(
          z.enum(["waitingOnApproval", "waitingOnUserInput"])
        )
        .default([])
    })
    .strip()
]);

const turnStartedNotificationSchema = z
  .object({
    method: z.literal("turn/started"),
    params: z
      .object({
        threadId: z.string().min(1),
        turn: z
          .object({
            id: z.string().min(1),
            status: z.literal("inProgress")
          })
          .strip()
      })
      .strip()
  })
  .strip();

const turnCompletedNotificationSchema = z
  .object({
    method: z.literal("turn/completed"),
    params: z
      .object({
        threadId: z.string().min(1),
        turn: z
          .object({
            id: z.string().min(1),
            status: completedTurnStatusSchema
          })
          .strip()
      })
      .strip()
  })
  .strip();

const managedNotificationSchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("thread/status/changed"),
      params: z
        .object({
          threadId: z.string().min(1),
          status: threadStatusSchema
        })
        .strip()
    })
    .strip(),
  turnStartedNotificationSchema,
  turnCompletedNotificationSchema,
  z
    .object({
      method: z.enum(["item/started", "item/completed"]),
      params: z
        .object({
          threadId: z.string().min(1),
          turnId: z.string().min(1),
          item: z
            .object({
              id: z.string().min(1),
              type: z.string().min(1)
            })
            .strip()
        })
        .strip()
    })
    .strip()
]);

const codexExecutionObservationPayloadSchema = z
  .object({
    schemaVersion: z.literal(CODEX_APP_SERVER_EVENT_SCHEMA_VERSION),
    executionId: opaqueExecutionIdSchema,
    observedAt: timestampSchema,
    sequence: z.number().int().nonnegative(),
    observationMode: z.enum([
      "inventory_only",
      "managed_event_stream"
    ]),
    liveObservationAvailable: z.boolean(),
    executionState: z.enum([
      "unknown",
      "running",
      "idle",
      "completed",
      "failed",
      "interrupted"
    ]),
    inventoryActivityState: z
      .enum([
        "active",
        "idle",
        "not_loaded",
        "system_error",
        "unknown"
      ])
      .nullable(),
    waitingState: z
      .enum(["waiting_on_approval", "waiting_on_user_input"])
      .nullable(),
    sourceEvent: z.enum([
      "thread_inventory",
      "thread_status_changed",
      "turn_started",
      "turn_completed",
      "item_started",
      "item_completed"
    ]),
    sourceUpdatedAt: timestampSchema.nullable(),
    reasonCode: z.enum([
      "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE",
      "CODEX_MANAGED_THREAD_ACTIVE",
      "CODEX_MANAGED_THREAD_IDLE",
      "CODEX_MANAGED_THREAD_NOT_LOADED",
      "CODEX_MANAGED_THREAD_SYSTEM_ERROR",
      "CODEX_MANAGED_TURN_STARTED",
      "CODEX_MANAGED_TURN_COMPLETED",
      "CODEX_MANAGED_TURN_FAILED",
      "CODEX_MANAGED_TURN_INTERRUPTED",
      "CODEX_MANAGED_ITEM_ACTIVITY"
    ])
  })
  .strict();

type CodexExecutionObservationPayload = z.infer<
  typeof codexExecutionObservationPayloadSchema
>;

function executionObservationSchema<
  Contract extends string
>(contract: Contract) {
  return codexExecutionObservationPayloadSchema
    .extend({ contract: z.literal(contract) })
    .strict()
    .superRefine(refineExactObservationSemantics);
}

export const codexExecutionObservationSchema =
  executionObservationSchema(
    CODEX_EXECUTION_OBSERVATION_CONTRACT
  );

const legacyCodexExecutionObservationSchema =
  executionObservationSchema(
    LEGACY_CODEX_EXECUTION_OBSERVATION_CONTRACT
  );

export type CodexExecutionObservation = z.infer<
  typeof codexExecutionObservationSchema
>;

export const codexObservationHistorySchema = z
  .object({
    contract: z.literal(CODEX_OBSERVATION_HISTORY_CONTRACT),
    updatedAt: timestampSchema,
    observations: z.array(codexExecutionObservationSchema)
  })
  .strict()
  .superRefine(refineObservationOrder);

const legacyCodexObservationHistorySchema = z
  .object({
    contract: z.literal(LEGACY_CODEX_OBSERVATION_HISTORY_CONTRACT),
    updatedAt: timestampSchema,
    observations: z.array(
      legacyCodexExecutionObservationSchema
    )
  })
  .strict()
  .superRefine(refineObservationOrder);

export type CodexObservationHistory = z.infer<
  typeof codexObservationHistorySchema
>;

export type CodexManagedNotification = z.infer<
  typeof managedNotificationSchema
>;

export function parseCodexObservationHistory(
  input: unknown
): CodexObservationHistory {
  const current = codexObservationHistorySchema.safeParse(input);
  if (current.success) return current.data;

  const legacy = legacyCodexObservationHistorySchema.parse(input);
  return codexObservationHistorySchema.parse({
    contract: CODEX_OBSERVATION_HISTORY_CONTRACT,
    updatedAt: legacy.updatedAt,
    observations: legacy.observations.map((observation) => ({
      ...observation,
      contract: CODEX_EXECUTION_OBSERVATION_CONTRACT
    }))
  });
}

function refineExactObservationSemantics(
  observation: CodexExecutionObservationPayload,
  context: z.RefinementCtx
): void {
  if (
    observation.observationMode === "inventory_only" &&
    (observation.liveObservationAvailable ||
      observation.executionState !== "unknown" ||
      observation.inventoryActivityState === null ||
      observation.waitingState !== null ||
      observation.sourceEvent !== "thread_inventory" ||
      observation.sourceUpdatedAt === null ||
      observation.reasonCode !==
        "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Inventory observations must use the exact non-live inventory semantics."
    });
  }
  if (
    observation.observationMode === "managed_event_stream" &&
    (!observation.liveObservationAvailable ||
      observation.inventoryActivityState !== null ||
      observation.sourceUpdatedAt !== null ||
      !hasExactManagedEventSemantics(observation))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Managed observations must use an exact owned-event semantic combination."
    });
  }
}

function hasExactManagedEventSemantics(
  observation: CodexExecutionObservationPayload
): boolean {
  switch (observation.sourceEvent) {
    case "thread_inventory":
      return false;
    case "thread_status_changed":
      switch (observation.reasonCode) {
        case "CODEX_MANAGED_THREAD_ACTIVE":
          return observation.executionState === "running";
        case "CODEX_MANAGED_THREAD_IDLE":
          return (
            observation.executionState === "idle" &&
            observation.waitingState === null
          );
        case "CODEX_MANAGED_THREAD_NOT_LOADED":
        case "CODEX_MANAGED_THREAD_SYSTEM_ERROR":
          return (
            observation.executionState === "unknown" &&
            observation.waitingState === null
          );
        default:
          return false;
      }
    case "turn_started":
      return (
        observation.executionState === "running" &&
        observation.waitingState === null &&
        observation.reasonCode === "CODEX_MANAGED_TURN_STARTED"
      );
    case "turn_completed":
      return (
        observation.waitingState === null &&
        ((observation.executionState === "completed" &&
          observation.reasonCode ===
            "CODEX_MANAGED_TURN_COMPLETED") ||
          (observation.executionState === "failed" &&
            observation.reasonCode ===
              "CODEX_MANAGED_TURN_FAILED") ||
          (observation.executionState === "interrupted" &&
            observation.reasonCode ===
              "CODEX_MANAGED_TURN_INTERRUPTED"))
      );
    case "item_started":
    case "item_completed":
      return (
        observation.executionState === "running" &&
        observation.waitingState === null &&
        observation.reasonCode === "CODEX_MANAGED_ITEM_ACTIVITY"
      );
  }
}

function refineObservationOrder(
  history: {
    observations: Array<{
      observedAt: string;
      sequence: number;
    }>;
  },
  context: z.RefinementCtx
): void {
  for (let index = 1; index < history.observations.length; index += 1) {
    const previous = history.observations[index - 1];
    const current = history.observations[index];
    if (
      !previous ||
      !current ||
      current.sequence <= previous.sequence ||
      Date.parse(current.observedAt) <
        Date.parse(previous.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observations", index],
        message:
          "Codex observations must be stored in strict sequence order."
      });
    }
  }
}

export function observeCodexInventorySession(input: {
  session: CodexSessionSignal;
  observedAt: string;
  sequence: number;
}): CodexExecutionObservation {
  return codexExecutionObservationSchema.parse({
    contract: CODEX_EXECUTION_OBSERVATION_CONTRACT,
    schemaVersion: CODEX_APP_SERVER_EVENT_SCHEMA_VERSION,
    executionId: input.session.id,
    observedAt: input.observedAt,
    sequence: input.sequence,
    observationMode: "inventory_only",
    liveObservationAvailable: false,
    executionState: "unknown",
    inventoryActivityState: input.session.activityState,
    waitingState: null,
    sourceEvent: "thread_inventory",
    sourceUpdatedAt: input.session.updatedAt,
    reasonCode: "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE"
  });
}

export function observeCodexManagedNotification(input: {
  notification: unknown;
  executionId: string;
  expectedThreadId: string;
  observedAt: string;
  sequence: number;
}): CodexExecutionObservation {
  const notification = managedNotificationSchema.parse(
    input.notification
  );
  if (notification.params.threadId !== input.expectedThreadId) {
    throw new TypeError(
      "Codex notification does not belong to the expected thread."
    );
  }

  const state = stateFromManagedNotification(notification);
  return codexExecutionObservationSchema.parse({
    contract: CODEX_EXECUTION_OBSERVATION_CONTRACT,
    schemaVersion: CODEX_APP_SERVER_EVENT_SCHEMA_VERSION,
    executionId: input.executionId,
    observedAt: input.observedAt,
    sequence: input.sequence,
    observationMode: "managed_event_stream",
    liveObservationAvailable: true,
    inventoryActivityState: null,
    sourceUpdatedAt: null,
    ...state
  });
}

function stateFromManagedNotification(
  notification: CodexManagedNotification
): Pick<
  CodexExecutionObservation,
  "executionState" | "waitingState" | "sourceEvent" | "reasonCode"
> {
  if (notification.method === "thread/status/changed") {
    const status = notification.params.status;
    if (status.type === "active") {
      return {
        executionState: "running",
        waitingState: waitingStateFromFlags(status.activeFlags),
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_ACTIVE"
      };
    }
    if (status.type === "idle") {
      return {
        executionState: "idle",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_IDLE"
      };
    }
    if (status.type === "systemError") {
      return {
        executionState: "unknown",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_SYSTEM_ERROR"
      };
    }
    return {
      executionState: "unknown",
      waitingState: null,
      sourceEvent: "thread_status_changed",
      reasonCode: "CODEX_MANAGED_THREAD_NOT_LOADED"
    };
  }

  if (notification.method === "turn/started") {
    return {
      executionState: "running",
      waitingState: null,
      sourceEvent: "turn_started",
      reasonCode: "CODEX_MANAGED_TURN_STARTED"
    };
  }

  if (notification.method === "turn/completed") {
    switch (notification.params.turn.status) {
      case "completed":
        return {
          executionState: "completed",
          waitingState: null,
          sourceEvent: "turn_completed",
          reasonCode: "CODEX_MANAGED_TURN_COMPLETED"
        };
      case "failed":
        return {
          executionState: "failed",
          waitingState: null,
          sourceEvent: "turn_completed",
          reasonCode: "CODEX_MANAGED_TURN_FAILED"
        };
      case "interrupted":
        return {
          executionState: "interrupted",
          waitingState: null,
          sourceEvent: "turn_completed",
          reasonCode: "CODEX_MANAGED_TURN_INTERRUPTED"
        };
    }
  }

  return {
    executionState: "running",
    waitingState: null,
    sourceEvent:
      notification.method === "item/started"
        ? "item_started"
        : "item_completed",
    reasonCode: "CODEX_MANAGED_ITEM_ACTIVITY"
  };
}

function waitingStateFromFlags(
  flags: Array<"waitingOnApproval" | "waitingOnUserInput">
): CodexExecutionObservation["waitingState"] {
  if (flags.includes("waitingOnUserInput")) {
    return "waiting_on_user_input";
  }
  return flags.includes("waitingOnApproval")
    ? "waiting_on_approval"
    : null;
}

export function inventoryActivityLabel(
  state: CodexActivityState
): string {
  switch (state) {
    case "active":
      return "목록 조회 시 active로 기록됨";
    case "idle":
      return "목록 조회 시 idle로 기록됨";
    case "not_loaded":
      return "실행 관찰 불가";
    case "system_error":
      return "목록 조회 시 system error로 기록됨";
    default:
      return "실행 상태 미확인";
  }
}
