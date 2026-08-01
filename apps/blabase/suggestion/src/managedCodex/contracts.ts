import { z } from "zod";

import {
  codexExecutionObservationSchema,
  type CodexExecutionObservation
} from "../connectors/codex/observationContract";
import {
  runtimeSha256,
  runtimeStableId
} from "../crossSource/canonicalHash";

export const CODEX_MANAGED_RUN_REGISTRY_CONTRACT =
  "codex-managed-run-registry-v1" as const;
export const CODEX_MANAGED_EVENT_CONTRACT =
  "codex-managed-event-v1" as const;
export const CODEX_MANAGED_EVENT_HISTORY_CONTRACT =
  "codex-managed-event-history-v1" as const;
export const CODEX_MANAGED_LATEST_STORE_CONTRACT =
  "codex-managed-latest-projection-store-v1" as const;
export const CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT =
  "codex-managed-public-projection-v1" as const;
export const CODEX_MANAGED_SETTLEMENT_CONTRACT =
  "codex-managed-settlement-v1" as const;
export const CODEX_MANAGED_RETENTION_POLICY_VERSION =
  "codex-managed-retention-v1" as const;

export const CODEX_MANAGED_RETENTION_DAYS = 30;
export const CODEX_MANAGED_EVENT_HARD_LIMIT = 10_000;

const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const managedCodexRunIdSchema = z
  .string()
  .regex(/^managed_run_[a-f0-9]{32}$/);
const managedCodexEventIdSchema = z
  .string()
  .regex(/^managed_event_[a-f0-9]{32}$/);
const managedCodexSettlementIdSchema = z
  .string()
  .regex(/^managed_settlement_[a-f0-9]{32}$/);
const bindingIdSchema = z.string().regex(/^binding_[a-f0-9]{32}$/);
const executionIdSchema = z
  .string()
  .regex(/^codex:execution:[a-f0-9]{24}$/);
const scopeIdSchema = z.string().regex(/^[a-f0-9]{24}$/);
const ownerInstanceIdSchema = z
  .string()
  .regex(/^instance_[a-f0-9]{32}$/);
const connectionGenerationSchema = z
  .string()
  .regex(/^connection_[a-f0-9]{32}$/);
const streamGenerationSchema = z
  .string()
  .regex(/^stream_[a-f0-9]{32}$/);

export const managedCodexExecutionStateSchema = z.enum([
  "unknown",
  "running",
  "idle",
  "completed",
  "failed",
  "interrupted"
]);
export const managedCodexWaitingStateSchema = z
  .enum(["waiting_on_approval", "waiting_on_user_input"])
  .nullable();
export const managedCodexLifecycleSchema = z.enum([
  "starting",
  "active",
  "terminal"
]);
export const managedCodexStreamStateSchema = z.enum([
  "connecting",
  "connected",
  "disconnected",
  "failed",
  "closed"
]);
export const managedCodexContinuitySchema = z.enum([
  "unverified",
  "continuous",
  "gap_detected"
]);
export const managedCodexNativeSourceEventSchema = z.enum([
  "thread_status_changed",
  "turn_started",
  "turn_completed",
  "item_started",
  "item_completed"
]);
export const managedCodexPublicSourceEventSchema = z.enum([
  "run_started",
  "stream_connected",
  "stream_reconnected",
  "stream_disconnected",
  "run_failed",
  "run_closed",
  ...managedCodexNativeSourceEventSchema.options
]);
export const managedCodexStreamEventKindSchema = z.enum([
  "stream_connected",
  "stream_reconnected",
  "stream_disconnected",
  "run_failed",
  "run_closed"
]);

export const managedCodexItemTypeSchema = z
  .enum([
    "user_message",
    "agent_message",
    "reasoning",
    "command_execution",
    "file_change",
    "tool_call",
    "collaboration",
    "web_search",
    "context_compaction",
    "other"
  ])
  .nullable();

export const beginManagedCodexRunInputSchema = z
  .object({
    bindingId: bindingIdSchema,
    executionId: executionIdSchema,
    scopeId: scopeIdSchema,
    connectionGeneration: connectionGenerationSchema,
    ownerInstanceId: ownerInstanceIdSchema,
    streamGeneration: streamGenerationSchema,
    startedAt: timestampSchema,
    startedBy: z.literal("explicit_user"),
    ownership: z.literal("blabase_app_server")
  })
  .strict();

export type BeginManagedCodexRunInput = z.infer<
  typeof beginManagedCodexRunInputSchema
>;

export const managedCodexOwnershipIdentitySchema =
  beginManagedCodexRunInputSchema
    .pick({
      bindingId: true,
      executionId: true,
      scopeId: true,
      connectionGeneration: true
    })
    .strict();

export type ManagedCodexOwnershipIdentity = z.infer<
  typeof managedCodexOwnershipIdentitySchema
>;

export const managedCodexPrivateRunSchema = z
  .object({
    managedRunId: managedCodexRunIdSchema,
    bindingId: bindingIdSchema,
    executionId: executionIdSchema,
    scopeId: scopeIdSchema,
    connectionGeneration: connectionGenerationSchema,
    ownerInstanceId: ownerInstanceIdSchema,
    initialStreamGeneration: streamGenerationSchema,
    startedAt: timestampSchema,
    startedBy: z.literal("explicit_user"),
    ownership: z.literal("blabase_app_server"),
    retentionPolicyVersion: z.literal(
      CODEX_MANAGED_RETENTION_POLICY_VERSION
    ),
    retentionDays: z.literal(CODEX_MANAGED_RETENTION_DAYS)
  })
  .strict();

export type ManagedCodexPrivateRun = z.infer<
  typeof managedCodexPrivateRunSchema
>;

const managedCodexRunRegistryContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_RUN_REGISTRY_CONTRACT),
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    runs: z.array(managedCodexPrivateRunSchema).max(10_000)
  })
  .strict();

export const managedCodexRunRegistrySchema =
  managedCodexRunRegistryContentSchema
    .extend({ storeSha256: sha256Schema })
    .strict()
    .superRefine((store, context) => {
      refineUniqueRunIds(store.runs, context, ["runs"]);
      if (store.storeSha256 !== registryStoreSha256(store)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Managed Codex registry hash does not match content."
        });
      }
    });

export type ManagedCodexRunRegistry = z.infer<
  typeof managedCodexRunRegistrySchema
>;

const managedCodexEventPayloadSchema = z
  .object({
    managedRunId: managedCodexRunIdSchema,
    sequence: z.number().int().nonnegative(),
    ownerInstanceId: ownerInstanceIdSchema,
    streamGeneration: streamGenerationSchema,
    observedAt: timestampSchema,
    retentionAt: timestampSchema,
    kind: z.enum(["native_notification", "stream_lifecycle"]),
    streamKind: managedCodexStreamEventKindSchema.nullable(),
    observation: codexExecutionObservationSchema.nullable(),
    itemType: managedCodexItemTypeSchema,
    previousEventSha256: sha256Schema.nullable()
  })
  .strict();

type ManagedCodexEventPayload = z.infer<
  typeof managedCodexEventPayloadSchema
>;

export const managedCodexEventSchema = managedCodexEventPayloadSchema
  .extend({
    contract: z.literal(CODEX_MANAGED_EVENT_CONTRACT),
    eventId: managedCodexEventIdSchema,
    eventSha256: sha256Schema
  })
  .strict()
  .superRefine((event, context) => {
    const native = event.kind === "native_notification";
    if (
      native !== (event.observation !== null) ||
      native === (event.streamKind !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Managed Codex event kind must match exactly one normalized payload."
      });
    }
    if (
      event.observation &&
      (event.observation.observationMode !==
        "managed_event_stream" ||
        event.observation.sequence !== event.sequence ||
        event.observation.observedAt !== event.observedAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observation"],
        message:
          "Managed notification envelope must match its normalized observation."
      });
    }
    const itemEvent =
      event.observation?.sourceEvent === "item_started" ||
      event.observation?.sourceEvent === "item_completed";
    if (itemEvent !== (event.itemType !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemType"],
        message: "Only item events may contain a sanitized item type."
      });
    }
    if (event.eventId !== managedEventId(eventCore(event))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventId"],
        message: "Managed Codex event ID does not match content."
      });
    }
    if (event.eventSha256 !== managedEventSha256(event)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eventSha256"],
        message: "Managed Codex event hash does not match content."
      });
    }
  });

export type ManagedCodexEvent = z.infer<
  typeof managedCodexEventSchema
>;

export const managedCodexHistoryAnchorSchema = z
  .object({
    prunedThroughSequence: z.number().int().nonnegative(),
    prunedThroughEventSha256: sha256Schema,
    anchoredAt: timestampSchema
  })
  .strict();

const managedCodexHistoryContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_EVENT_HISTORY_CONTRACT),
    managedRunId: managedCodexRunIdSchema,
    updatedAt: timestampSchema,
    anchor: managedCodexHistoryAnchorSchema.nullable(),
    events: z
      .array(managedCodexEventSchema)
      .max(CODEX_MANAGED_EVENT_HARD_LIMIT)
  })
  .strict();

export const managedCodexEventHistorySchema =
  managedCodexHistoryContentSchema
    .extend({ storeSha256: sha256Schema })
    .strict()
    .superRefine((history, context) => {
      let expectedSequence =
        (history.anchor?.prunedThroughSequence ?? -1) + 1;
      let previousHash =
        history.anchor?.prunedThroughEventSha256 ?? null;
      let previousRetentionAt = Number.NEGATIVE_INFINITY;
      const eventIds = new Set<string>();
      history.events.forEach((event, index) => {
        if (
          event.managedRunId !== history.managedRunId ||
          event.sequence !== expectedSequence ||
          event.previousEventSha256 !== previousHash ||
          Date.parse(event.retentionAt) < previousRetentionAt ||
          eventIds.has(event.eventId)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["events", index],
            message:
              "Managed Codex history sequence or hash chain is invalid."
          });
        }
        eventIds.add(event.eventId);
        expectedSequence += 1;
        previousHash = event.eventSha256;
        previousRetentionAt = Date.parse(event.retentionAt);
      });
      if (history.storeSha256 !== historyStoreSha256(history)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Managed Codex history hash does not match content."
        });
      }
    });

export type ManagedCodexEventHistory = z.infer<
  typeof managedCodexEventHistorySchema
>;

export const managedCodexPrivateProjectionSchema = z
  .object({
    managedRunId: managedCodexRunIdSchema,
    bindingId: bindingIdSchema,
    executionId: executionIdSchema,
    scopeId: scopeIdSchema,
    connectionGeneration: connectionGenerationSchema,
    ownerInstanceId: ownerInstanceIdSchema,
    currentStreamGeneration: streamGenerationSchema,
    startedAt: timestampSchema,
    lifecycle: managedCodexLifecycleSchema,
    streamState: managedCodexStreamStateSchema,
    continuity: managedCodexContinuitySchema,
    lastVerifiedExecutionState: managedCodexExecutionStateSchema,
    waitingState: managedCodexWaitingStateSchema,
    sourceEvent: managedCodexPublicSourceEventSchema,
    itemType: managedCodexItemTypeSchema,
    lastObservedAt: timestampSchema,
    lastEventSequence: z.number().int().min(-1),
    headEventSha256: sha256Schema.nullable(),
    endedAt: timestampSchema.nullable()
  })
  .strict()
  .superRefine((projection, context) => {
    if (
      (projection.lastEventSequence === -1) !==
      (projection.headEventSha256 === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["headEventSha256"],
        message: "Projection head must match its event sequence."
      });
    }
    if (
      (projection.lifecycle === "terminal") !==
      (projection.endedAt !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "Only terminal runs may have an end time."
      });
    }
    const itemEvent =
      projection.sourceEvent === "item_started" ||
      projection.sourceEvent === "item_completed";
    if (itemEvent !== (projection.itemType !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itemType"],
        message: "Only an item source event may retain an item type."
      });
    }
    if (
      projection.waitingState !== null &&
      projection.lastVerifiedExecutionState !== "running"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["waitingState"],
        message: "A waiting state requires a verified running state."
      });
    }
  });

export type ManagedCodexPrivateProjection = z.infer<
  typeof managedCodexPrivateProjectionSchema
>;

const managedCodexLatestContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_LATEST_STORE_CONTRACT),
    revision: z.number().int().nonnegative(),
    updatedAt: timestampSchema,
    runs: z.array(managedCodexPrivateProjectionSchema).max(10_000)
  })
  .strict();

export const managedCodexLatestStoreSchema =
  managedCodexLatestContentSchema
    .extend({ storeSha256: sha256Schema })
    .strict()
    .superRefine((store, context) => {
      refineUniqueRunIds(store.runs, context, ["runs"]);
      if (store.storeSha256 !== latestStoreSha256(store)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Managed Codex latest hash does not match content."
        });
      }
    });

export type ManagedCodexLatestStore = z.infer<
  typeof managedCodexLatestStoreSchema
>;

export const managedCodexPublicLifecycleSchema = z.enum([
  "starting",
  "observing",
  "ended",
  "failed"
]);

export const managedCodexPublicStreamStateSchema = z.enum([
  "connecting",
  "connected",
  "disconnected",
  "closed"
]);

export const managedCodexPublicRunProjectionSchema = z
  .object({
    managedRunId: managedCodexRunIdSchema,
    bindingId: bindingIdSchema,
    executionId: executionIdSchema,
    lifecycle: managedCodexPublicLifecycleSchema,
    streamState: managedCodexPublicStreamStateSchema,
    continuity: managedCodexContinuitySchema,
    effectiveExecutionState: managedCodexExecutionStateSchema,
    lastVerifiedExecutionState: managedCodexExecutionStateSchema,
    waitingState: managedCodexWaitingStateSchema,
    sourceEvent: managedCodexPublicSourceEventSchema,
    itemType: managedCodexItemTypeSchema,
    lastObservedAt: timestampSchema,
    liveObservationAvailable: z.boolean(),
    forbiddenAsAttentionCandidate: z.literal(true)
  })
  .strict();

export type ManagedCodexPublicRunProjection = z.infer<
  typeof managedCodexPublicRunProjectionSchema
>;

export const managedCodexPublicProjectionSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT),
    revision: z.number().int().nonnegative(),
    generatedAt: timestampSchema,
    runs: z.array(managedCodexPublicRunProjectionSchema)
  })
  .strict();

export type ManagedCodexPublicProjection = z.infer<
  typeof managedCodexPublicProjectionSchema
>;

const managedCodexSettlementContentSchema = z
  .object({
    contract: z.literal(CODEX_MANAGED_SETTLEMENT_CONTRACT),
    settlementId: managedCodexSettlementIdSchema,
    managedRunId: managedCodexRunIdSchema,
    createdAt: timestampSchema,
    registry: managedCodexRunRegistrySchema,
    latest: managedCodexLatestStoreSchema,
    history: managedCodexEventHistorySchema.nullable()
  })
  .strict();

export const managedCodexSettlementSchema =
  managedCodexSettlementContentSchema
    .extend({ storeSha256: sha256Schema })
    .strict()
    .superRefine((settlement, context) => {
      const registryRun = settlement.registry.runs.find(
        (run) => run.managedRunId === settlement.managedRunId
      );
      const latestRun = settlement.latest.runs.find(
        (run) => run.managedRunId === settlement.managedRunId
      );
      if (settlement.history === null) {
        if (registryRun || latestRun) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["history"],
            message:
              "A removed history requires the run to be absent from both projections."
          });
        }
      } else if (
        !registryRun ||
        !latestRun ||
        settlement.history.managedRunId !== settlement.managedRunId ||
        !projectionHeadMatchesHistory(latestRun, settlement.history)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["history"],
          message:
            "Settlement registry, history, and latest projection are incoherent."
        });
      }
      if (
        settlement.settlementId !==
        managedSettlementId(settlementCore(settlement))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["settlementId"],
          message: "Managed Codex settlement ID does not match content."
        });
      }
      if (
        settlement.storeSha256 !== settlementStoreSha256(settlement)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["storeSha256"],
          message: "Managed Codex settlement hash does not match content."
        });
      }
    });

export type ManagedCodexSettlement = z.infer<
  typeof managedCodexSettlementSchema
>;

export function createEmptyManagedCodexRegistry(
  updatedAt: string
): ManagedCodexRunRegistry {
  return sealManagedCodexRegistry({
    contract: CODEX_MANAGED_RUN_REGISTRY_CONTRACT,
    revision: 0,
    updatedAt,
    runs: []
  });
}

export function createEmptyManagedCodexLatest(
  updatedAt: string
): ManagedCodexLatestStore {
  return sealManagedCodexLatest({
    contract: CODEX_MANAGED_LATEST_STORE_CONTRACT,
    revision: 0,
    updatedAt,
    runs: []
  });
}

export function createEmptyManagedCodexHistory(input: {
  managedRunId: string;
  updatedAt: string;
}): ManagedCodexEventHistory {
  return sealManagedCodexHistory({
    contract: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
    managedRunId: managedCodexRunIdSchema.parse(input.managedRunId),
    updatedAt: timestampSchema.parse(input.updatedAt),
    anchor: null,
    events: []
  });
}

export function createManagedCodexEvent(
  payloadInput: ManagedCodexEventPayload
): ManagedCodexEvent {
  const payload = managedCodexEventPayloadSchema.parse(payloadInput);
  const eventId = managedEventId(payload);
  const withoutHash = {
    contract: CODEX_MANAGED_EVENT_CONTRACT,
    eventId,
    ...payload
  };
  return managedCodexEventSchema.parse({
    ...withoutHash,
    eventSha256: runtimeSha256({
      domain: CODEX_MANAGED_EVENT_CONTRACT,
      event: withoutHash
    })
  });
}

export function sealManagedCodexRegistry(
  contentInput: z.input<typeof managedCodexRunRegistryContentSchema>
): ManagedCodexRunRegistry {
  const content = managedCodexRunRegistryContentSchema.parse(
    contentInput
  );
  return managedCodexRunRegistrySchema.parse({
    ...content,
    storeSha256: runtimeSha256({
      domain: CODEX_MANAGED_RUN_REGISTRY_CONTRACT,
      store: content
    })
  });
}

export function sealManagedCodexLatest(
  contentInput: z.input<typeof managedCodexLatestContentSchema>
): ManagedCodexLatestStore {
  const content = managedCodexLatestContentSchema.parse(contentInput);
  return managedCodexLatestStoreSchema.parse({
    ...content,
    storeSha256: runtimeSha256({
      domain: CODEX_MANAGED_LATEST_STORE_CONTRACT,
      store: content
    })
  });
}

export function sealManagedCodexHistory(
  contentInput: z.input<typeof managedCodexHistoryContentSchema>
): ManagedCodexEventHistory {
  const content = managedCodexHistoryContentSchema.parse(contentInput);
  return managedCodexEventHistorySchema.parse({
    ...content,
    storeSha256: runtimeSha256({
      domain: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
      history: content
    })
  });
}

export function createManagedCodexSettlement(input: {
  managedRunId: string;
  createdAt: string;
  registry: ManagedCodexRunRegistry;
  latest: ManagedCodexLatestStore;
  history: ManagedCodexEventHistory | null;
}): ManagedCodexSettlement {
  const coreWithoutId = {
    contract: CODEX_MANAGED_SETTLEMENT_CONTRACT,
    managedRunId: managedCodexRunIdSchema.parse(input.managedRunId),
    createdAt: timestampSchema.parse(input.createdAt),
    registry: managedCodexRunRegistrySchema.parse(input.registry),
    latest: managedCodexLatestStoreSchema.parse(input.latest),
    history:
      input.history === null
        ? null
        : managedCodexEventHistorySchema.parse(input.history)
  };
  const settlementId = managedSettlementId(coreWithoutId);
  const content = managedCodexSettlementContentSchema.parse({
    ...coreWithoutId,
    settlementId
  });
  return managedCodexSettlementSchema.parse({
    ...content,
    storeSha256: runtimeSha256({
      domain: CODEX_MANAGED_SETTLEMENT_CONTRACT,
      settlement: content
    })
  });
}

export function projectionHeadMatchesHistory(
  projection: ManagedCodexPrivateProjection,
  history: ManagedCodexEventHistory
): boolean {
  const lastEvent = history.events.at(-1);
  const sequence =
    lastEvent?.sequence ??
    history.anchor?.prunedThroughSequence ??
    -1;
  const hash =
    lastEvent?.eventSha256 ??
    history.anchor?.prunedThroughEventSha256 ??
    null;
  return (
    projection.managedRunId === history.managedRunId &&
    projection.lastEventSequence === sequence &&
    projection.headEventSha256 === hash
  );
}

export function publicProjectionFromPrivate(input: {
  projection: ManagedCodexPrivateProjection;
  activeOwnerInstanceId: string | null;
  ownershipCurrent: boolean;
}): ManagedCodexPublicRunProjection {
  const projection = managedCodexPrivateProjectionSchema.parse(
    input.projection
  );
  const ownerActive =
    input.ownershipCurrent &&
    input.activeOwnerInstanceId === projection.ownerInstanceId;
  const liveObservationAvailable =
    ownerActive &&
    projection.lifecycle !== "terminal" &&
    projection.streamState === "connected";
  const verifiedTerminal = isTerminalExecutionState(
    projection.lastVerifiedExecutionState
  );
  const nonterminalStateVerifiedAfterReconnect = !(
    projection.continuity === "gap_detected" &&
    projection.sourceEvent === "stream_reconnected"
  );
  return managedCodexPublicRunProjectionSchema.parse({
    managedRunId: projection.managedRunId,
    bindingId: projection.bindingId,
    executionId: projection.executionId,
    lifecycle:
      projection.lifecycle === "starting"
        ? "starting"
        : projection.lifecycle === "active"
          ? "observing"
          : projection.streamState === "failed"
            ? "failed"
            : "ended",
    streamState:
      projection.streamState === "failed" ||
      projection.streamState === "closed"
        ? "closed"
        : !ownerActive
          ? "disconnected"
          : projection.streamState,
    continuity: projection.continuity,
    effectiveExecutionState: verifiedTerminal
      ? projection.lastVerifiedExecutionState
      : liveObservationAvailable &&
          nonterminalStateVerifiedAfterReconnect
        ? projection.lastVerifiedExecutionState
        : "unknown",
    lastVerifiedExecutionState:
      projection.lastVerifiedExecutionState,
    waitingState: liveObservationAvailable
      ? projection.waitingState
      : null,
    sourceEvent: projection.sourceEvent,
    itemType: projection.itemType,
    lastObservedAt: projection.lastObservedAt,
    liveObservationAvailable,
    forbiddenAsAttentionCandidate: true
  });
}

export function isTerminalExecutionState(
  state: z.infer<typeof managedCodexExecutionStateSchema>
): state is "completed" | "failed" | "interrupted" {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "interrupted"
  );
}

function refineUniqueRunIds(
  runs: Array<{ managedRunId: string }>,
  context: z.RefinementCtx,
  path: Array<string | number>
): void {
  const seen = new Set<string>();
  runs.forEach((run, index) => {
    if (seen.has(run.managedRunId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, "managedRunId"],
        message: "Managed run IDs must be unique."
      });
    }
    seen.add(run.managedRunId);
  });
}

function managedEventId(payload: ManagedCodexEventPayload): string {
  return runtimeStableId(
    "managed_event",
    CODEX_MANAGED_EVENT_CONTRACT,
    payload
  );
}

function managedEventSha256(event: ManagedCodexEvent): string {
  const { eventSha256: _hash, ...withoutHash } = event;
  return runtimeSha256({
    domain: CODEX_MANAGED_EVENT_CONTRACT,
    event: withoutHash
  });
}

function eventCore(event: ManagedCodexEvent): ManagedCodexEventPayload {
  const {
    contract: _contract,
    eventId: _eventId,
    eventSha256: _eventSha256,
    ...payload
  } = event;
  return payload;
}

function registryStoreSha256(store: ManagedCodexRunRegistry): string {
  const { storeSha256: _hash, ...content } = store;
  return runtimeSha256({
    domain: CODEX_MANAGED_RUN_REGISTRY_CONTRACT,
    store: content
  });
}

function latestStoreSha256(store: ManagedCodexLatestStore): string {
  const { storeSha256: _hash, ...content } = store;
  return runtimeSha256({
    domain: CODEX_MANAGED_LATEST_STORE_CONTRACT,
    store: content
  });
}

function historyStoreSha256(
  history: ManagedCodexEventHistory
): string {
  const { storeSha256: _hash, ...content } = history;
  return runtimeSha256({
    domain: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
    history: content
  });
}

function managedSettlementId(
  content: Omit<
    z.infer<typeof managedCodexSettlementContentSchema>,
    "settlementId"
  >
): string {
  return runtimeStableId(
    "managed_settlement",
    CODEX_MANAGED_SETTLEMENT_CONTRACT,
    content
  );
}

function settlementCore(
  settlement: ManagedCodexSettlement
): Omit<
  z.infer<typeof managedCodexSettlementContentSchema>,
  "settlementId"
> {
  const {
    settlementId: _id,
    storeSha256: _hash,
    ...content
  } = settlement;
  return content;
}

function settlementStoreSha256(
  settlement: ManagedCodexSettlement
): string {
  const { storeSha256: _hash, ...content } = settlement;
  return runtimeSha256({
    domain: CODEX_MANAGED_SETTLEMENT_CONTRACT,
    settlement: content
  });
}

export function opaqueExecutionId(
  executionId: string
): CodexExecutionObservation["executionId"] {
  return executionIdSchema
    .parse(executionId)
    .slice("codex:execution:".length);
}
