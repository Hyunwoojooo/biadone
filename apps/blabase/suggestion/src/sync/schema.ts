import { z } from "zod";

export const SOURCE_SYNC_ATTEMPT_CONTRACT =
  "source-sync-attempt-v1" as const;
export const SOURCE_SYNC_STATE_CONTRACT =
  "source-sync-state-v1" as const;
export const SOURCE_SYNC_LATEST_STORE_CONTRACT =
  "source-sync-latest-store-v1" as const;
export const SOURCE_SYNC_HISTORY_STORE_CONTRACT =
  "source-sync-history-store-v1" as const;
export const SOURCE_SYNC_SNAPSHOT_EVENT_CONTRACT =
  "source-sync-snapshot-event-v1" as const;
export const SOURCE_SYNC_TRANSITION_CONTRACT =
  "source-sync-transition-v1" as const;
export const SOURCE_SYNC_TRANSITION_STORE_CONTRACT =
  "source-sync-transition-store-v1" as const;
export const SOURCE_SYNC_SETTLEMENT_CONTRACT =
  "source-sync-settlement-v1" as const;
export const SOURCE_SYNC_SETTLEMENT_STORE_CONTRACT =
  "source-sync-settlement-store-v1" as const;

export const SOURCE_SYNC_HISTORY_HARD_LIMIT = 1_000;
export const DEFAULT_SOURCE_SYNC_HISTORY_LIMIT = 256;

export const syncSourceSchema = z.enum([
  "github",
  "codex",
  "notion",
  "google_calendar"
]);

export type SyncSource = z.infer<typeof syncSourceSchema>;

export const SYNC_SOURCES = syncSourceSchema.options;

export const syncTriggerSchema = z.enum([
  "manual",
  "scheduled",
  "visibility",
  "startup"
]);

export type SyncTrigger = z.infer<typeof syncTriggerSchema>;

export const sanitizedSyncErrorCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/);

export const snapshotRevisionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const sourceSnapshotReceiptSchema = z
  .object({
    revision: snapshotRevisionSchema,
    hash: sha256Schema,
    itemCount: z.number().int().nonnegative()
  })
  .strict();

export type SourceSnapshotReceipt = z.infer<
  typeof sourceSnapshotReceiptSchema
>;

export const sourceSyncAttemptSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_ATTEMPT_CONTRACT),
    attemptId: z.string().regex(/^sync_[a-f0-9]{32}$/),
    source: syncSourceSchema,
    trigger: syncTriggerSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    outcome: z.enum(["success", "failure"]),
    retryCount: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    snapshotRevision: snapshotRevisionSchema.nullable(),
    snapshotHash: sha256Schema.nullable(),
    itemCount: z.number().int().nonnegative().nullable(),
    errorCode: sanitizedSyncErrorCodeSchema.nullable()
  })
  .strict()
  .superRefine((attempt, context) => {
    if (Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "completedAt must not precede startedAt"
      });
    }

    const hasSnapshot =
      attempt.snapshotRevision !== null &&
      attempt.snapshotHash !== null &&
      attempt.itemCount !== null;
    const hasPartialSnapshot =
      [
        attempt.snapshotRevision,
        attempt.snapshotHash,
        attempt.itemCount
      ].some((value) => value !== null) && !hasSnapshot;

    if (hasPartialSnapshot) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshotRevision"],
        message: "snapshot metadata must be complete or absent"
      });
    }

    if (
      attempt.outcome === "success" &&
      (!hasSnapshot ||
        attempt.errorCode !== null ||
        attempt.retryCount !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome"],
        message:
          "successful attempts require snapshot metadata and retryCount 0"
      });
    }

    if (
      attempt.outcome === "failure" &&
      (hasSnapshot || attempt.errorCode === null || attempt.retryCount < 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome"],
        message:
          "failed attempts require a sanitized error and positive retryCount"
      });
    }
  });

export type SourceSyncAttempt = z.infer<
  typeof sourceSyncAttemptSchema
>;

export const latestSnapshotMetadataSchema = z
  .object({
    revision: snapshotRevisionSchema,
    hash: sha256Schema,
    itemCount: z.number().int().nonnegative(),
    syncedAt: z.string().datetime(),
    attemptId: z.string().regex(/^sync_[a-f0-9]{32}$/)
  })
  .strict();

export type LatestSnapshotMetadata = z.infer<
  typeof latestSnapshotMetadataSchema
>;

export const sourceSyncStatusSchema = z.enum([
  "disabled",
  "never_synced",
  "syncing",
  "ready",
  "retry_wait"
]);

export type SourceSyncStatus = z.infer<
  typeof sourceSyncStatusSchema
>;

export const sourceSyncStateSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_STATE_CONTRACT),
    source: syncSourceSchema,
    status: sourceSyncStatusSchema,
    updatedAt: z.string().datetime(),
    retryCount: z.number().int().nonnegative(),
    nextDueAt: z.string().datetime().nullable(),
    lastAttempt: sourceSyncAttemptSchema.nullable(),
    lastSuccess: sourceSyncAttemptSchema.nullable(),
    lastFailure: sourceSyncAttemptSchema.nullable(),
    latestSnapshot: latestSnapshotMetadataSchema.nullable()
  })
  .strict()
  .superRefine((state, context) => {
    for (const [field, attempt] of [
      ["lastAttempt", state.lastAttempt],
      ["lastSuccess", state.lastSuccess],
      ["lastFailure", state.lastFailure]
    ] as const) {
      if (attempt !== null && attempt.source !== state.source) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} source must match state source`
        });
      }
    }

    if (
      state.lastSuccess !== null &&
      state.lastSuccess.outcome !== "success"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastSuccess"],
        message: "lastSuccess must be a successful attempt"
      });
    }
    if (
      state.lastFailure !== null &&
      state.lastFailure.outcome !== "failure"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastFailure"],
        message: "lastFailure must be a failed attempt"
      });
    }

    if (state.status === "disabled" && state.nextDueAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextDueAt"],
        message: "disabled sources cannot be scheduled"
      });
    }
    if (
      (state.status === "ready" || state.status === "retry_wait") &&
      state.nextDueAt === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nextDueAt"],
        message: "enabled settled sources require nextDueAt"
      });
    }
    if (
      state.status === "ready" &&
      (state.latestSnapshot === null ||
        state.lastSuccess === null ||
        state.retryCount !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "ready sources require a latest snapshot, success, and retryCount 0"
      });
    }
    if (
      state.status === "retry_wait" &&
      (state.lastFailure === null || state.retryCount < 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message:
          "retry_wait sources require a failure and positive retryCount"
      });
    }
    if (
      state.status === "never_synced" &&
      (state.latestSnapshot !== null ||
        state.lastSuccess !== null ||
        state.retryCount !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "never_synced sources cannot have a prior success"
      });
    }
    if (
      state.latestSnapshot !== null &&
      state.lastSuccess !== null &&
      (state.latestSnapshot.attemptId !==
        state.lastSuccess.attemptId ||
        state.latestSnapshot.revision !==
          state.lastSuccess.snapshotRevision ||
        state.latestSnapshot.hash !== state.lastSuccess.snapshotHash ||
        state.latestSnapshot.itemCount !== state.lastSuccess.itemCount)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latestSnapshot"],
        message: "latest snapshot must match lastSuccess"
      });
    }
  });

export type SourceSyncState = z.infer<
  typeof sourceSyncStateSchema
>;

export const sourceSyncTransitionSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_TRANSITION_CONTRACT),
    transitionId: z
      .string()
      .regex(/^transition_[a-f0-9]{32}$/),
    source: syncSourceSchema,
    kind: z.enum(["reset_lineage", "disconnect"]),
    createdAt: z.string().datetime(),
    retryAt: z.string().datetime(),
    failureCount: z.number().int().nonnegative(),
    lastErrorCode: z.literal("STORE_WRITE_FAILED").nullable(),
    targetState: sourceSyncStateSchema,
    attempt: sourceSyncAttemptSchema.nullable()
  })
  .strict()
  .superRefine((transition, context) => {
    if (transition.targetState.source !== transition.source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetState", "source"],
        message: "transition target source must match"
      });
    }
    if (Date.parse(transition.retryAt) < Date.parse(transition.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retryAt"],
        message: "transition retryAt cannot precede createdAt"
      });
    }
    if (
      (transition.failureCount === 0) !==
      (transition.lastErrorCode === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastErrorCode"],
        message:
          "transition failures require a sanitized store error code"
      });
    }
    if (
      transition.kind === "reset_lineage" &&
      (transition.attempt !== null ||
        transition.targetState.status !== "never_synced" ||
        transition.targetState.lastAttempt !== null ||
        transition.targetState.lastSuccess !== null ||
        transition.targetState.lastFailure !== null ||
        transition.targetState.latestSnapshot !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message:
          "lineage reset transitions require a clean never-synced target"
      });
    }
    if (
      transition.kind === "disconnect" &&
      (transition.attempt === null ||
        transition.attempt.source !== transition.source ||
        transition.attempt.outcome !== "failure" ||
        transition.attempt.errorCode !== "CONNECTOR_DISCONNECTED" ||
        transition.targetState.status !== "disabled" ||
        transition.targetState.latestSnapshot !== null ||
        transition.targetState.lastAttempt?.attemptId !==
          transition.attempt.attemptId ||
        transition.targetState.lastFailure?.attemptId !==
          transition.attempt.attemptId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message:
          "disconnect transitions require a matching disabled target and audit attempt"
      });
    }
  });

export type SourceSyncTransition = z.infer<
  typeof sourceSyncTransitionSchema
>;

export const sourceSyncTransitionStoreSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_TRANSITION_STORE_CONTRACT),
    updatedAt: z.string().datetime(),
    transitions: z.array(sourceSyncTransitionSchema).max(
      SYNC_SOURCES.length
    )
  })
  .strict()
  .superRefine((store, context) => {
    const transitionIds = new Set<string>();
    const sources = new Set<SyncSource>();
    store.transitions.forEach((transition, index) => {
      if (transitionIds.has(transition.transitionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transitions", index, "transitionId"],
          message: "transitionId must be unique"
        });
      }
      if (sources.has(transition.source)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transitions", index, "source"],
          message: "only one pending transition is allowed per source"
        });
      }
      transitionIds.add(transition.transitionId);
      sources.add(transition.source);
    });
  });

export type SourceSyncTransitionStore = z.infer<
  typeof sourceSyncTransitionStoreSchema
>;

const sourceStateMapSchema = z
  .object({
    github: sourceSyncStateSchema,
    codex: sourceSyncStateSchema,
    notion: sourceSyncStateSchema,
    google_calendar: sourceSyncStateSchema
  })
  .strict()
  .superRefine((states, context) => {
    for (const source of SYNC_SOURCES) {
      if (states[source].source !== source) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [source, "source"],
          message: "state key and source must match"
        });
      }
    }
  });

export const sourceSyncLatestStoreSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_LATEST_STORE_CONTRACT),
    updatedAt: z.string().datetime(),
    sources: sourceStateMapSchema
  })
  .strict();

export type SourceSyncLatestStore = z.infer<
  typeof sourceSyncLatestStoreSchema
>;

export function compareSyncAttempts(
  left: SourceSyncAttempt,
  right: SourceSyncAttempt
): number {
  return (
    Date.parse(right.completedAt) - Date.parse(left.completedAt) ||
    Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
    left.source.localeCompare(right.source) ||
    left.attemptId.localeCompare(right.attemptId)
  );
}

export const sourceSyncHistoryStoreSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_HISTORY_STORE_CONTRACT),
    updatedAt: z.string().datetime(),
    attempts: z
      .array(sourceSyncAttemptSchema)
      .max(SOURCE_SYNC_HISTORY_HARD_LIMIT)
  })
  .strict()
  .superRefine((history, context) => {
    const seen = new Set<string>();
    history.attempts.forEach((attempt, index) => {
      if (seen.has(attempt.attemptId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attempts", index, "attemptId"],
          message: "attemptId must be unique"
        });
      }
      seen.add(attempt.attemptId);
      if (
        index > 0 &&
        compareSyncAttempts(history.attempts[index - 1], attempt) > 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["attempts", index],
          message: "attempt history must use deterministic newest-first order"
        });
      }
    });
  });

export type SourceSyncHistoryStore = z.infer<
  typeof sourceSyncHistoryStoreSchema
>;

export const sourceSyncSettlementSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_SETTLEMENT_CONTRACT),
    settlementId: z
      .string()
      .regex(/^settlement_[a-f0-9]{32}$/),
    source: syncSourceSchema,
    createdAt: z.string().datetime(),
    attempt: sourceSyncAttemptSchema,
    latest: sourceSyncLatestStoreSchema,
    history: sourceSyncHistoryStoreSchema
  })
  .strict()
  .superRefine((settlement, context) => {
    const expectedSettlementId = `settlement_${settlement.attempt.attemptId.slice(
      "sync_".length
    )}`;
    if (settlement.settlementId !== expectedSettlementId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["settlementId"],
        message: "settlementId must be derived from its attemptId"
      });
    }
    if (settlement.attempt.source !== settlement.source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attempt", "source"],
        message: "settlement attempt source must match"
      });
    }
    if (settlement.createdAt !== settlement.attempt.completedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["createdAt"],
        message: "settlement creation must match attempt completion"
      });
    }
    if (
      settlement.latest.updatedAt !== settlement.attempt.completedAt ||
      settlement.history.updatedAt !== settlement.latest.updatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latest", "updatedAt"],
        message:
          "settlement latest and history must share the attempt completion time"
      });
    }
    if (
      settlement.latest.sources[settlement.source].lastAttempt?.attemptId !==
      settlement.attempt.attemptId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["latest", "sources", settlement.source, "lastAttempt"],
        message: "settlement latest must point to its attempt"
      });
    }
    const historyAttempt = settlement.history.attempts.find(
      (attempt) => attempt.attemptId === settlement.attempt.attemptId
    );
    if (
      !historyAttempt ||
      JSON.stringify(historyAttempt) !== JSON.stringify(settlement.attempt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["history", "attempts"],
        message: "settlement history must contain its exact attempt"
      });
    }
  });

export type SourceSyncSettlement = z.infer<
  typeof sourceSyncSettlementSchema
>;

export const sourceSyncSettlementStoreSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_SETTLEMENT_STORE_CONTRACT),
    updatedAt: z.string().datetime(),
    settlement: sourceSyncSettlementSchema.nullable()
  })
  .strict();

export type SourceSyncSettlementStore = z.infer<
  typeof sourceSyncSettlementStoreSchema
>;

export const sourceSyncSnapshotEventSchema = z
  .object({
    contract: z.literal(SOURCE_SYNC_SNAPSHOT_EVENT_CONTRACT),
    source: syncSourceSchema,
    observedAt: z.string().datetime(),
    previousRevision: snapshotRevisionSchema.nullable(),
    previousHash: sha256Schema.nullable(),
    revision: snapshotRevisionSchema,
    hash: sha256Schema,
    itemCount: z.number().int().nonnegative()
  })
  .strict();

export type SourceSyncSnapshotEvent = z.infer<
  typeof sourceSyncSnapshotEventSchema
>;

export const sourceSyncDuePolicySchema = z
  .object({
    successIntervalMs: z.number().int().positive().max(86_400_000),
    failureBackoffBaseMs: z
      .number()
      .int()
      .positive()
      .max(86_400_000),
    failureBackoffMaxMs: z
      .number()
      .int()
      .positive()
      .max(86_400_000)
  })
  .strict()
  .refine(
    (policy) =>
      policy.failureBackoffMaxMs >= policy.failureBackoffBaseMs,
    {
      message:
        "failureBackoffMaxMs must be at least failureBackoffBaseMs",
      path: ["failureBackoffMaxMs"]
    }
  );

export type SourceSyncDuePolicy = z.infer<
  typeof sourceSyncDuePolicySchema
>;
