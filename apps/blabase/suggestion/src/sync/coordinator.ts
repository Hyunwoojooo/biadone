import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  SOURCE_SYNC_ATTEMPT_CONTRACT,
  SOURCE_SYNC_LATEST_STORE_CONTRACT,
  SOURCE_SYNC_SNAPSHOT_EVENT_CONTRACT,
  SOURCE_SYNC_STATE_CONTRACT,
  SOURCE_SYNC_TRANSITION_CONTRACT,
  SYNC_SOURCES,
  sanitizedSyncErrorCodeSchema,
  sourceSnapshotReceiptSchema,
  sourceSyncAttemptSchema,
  sourceSyncDuePolicySchema,
  sourceSyncLatestStoreSchema,
  sourceSyncSnapshotEventSchema,
  sourceSyncStateSchema,
  sourceSyncTransitionSchema,
  syncSourceSchema,
  syncTriggerSchema,
  type LatestSnapshotMetadata,
  type SourceSnapshotReceipt,
  type SourceSyncAttempt,
  type SourceSyncDuePolicy,
  type SourceSyncLatestStore,
  type SourceSyncSnapshotEvent,
  type SourceSyncState,
  type SourceSyncTransition,
  type SyncSource,
  type SyncTrigger
} from "./schema";
import type {
  SourceSyncRepository,
  SourceSyncRepositorySnapshot
} from "./repository";
import { safeSha256 } from "./serialization";

export type SourceSyncAdapterContext = {
  source: SyncSource;
  trigger: SyncTrigger;
  startedAt: string;
  retryCount: number;
  previousSnapshot: LatestSnapshotMetadata | null;
};

export interface SourceSyncAdapter {
  readonly source: SyncSource;
  sync(
    context: SourceSyncAdapterContext
  ): Promise<SourceSnapshotReceipt>;
}

export interface SourceSyncClock {
  now(): Date;
}

export interface SourceSyncTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type SourceSyncSnapshotListener = (
  event: SourceSyncSnapshotEvent
) => void | Promise<void>;

export type SourceSyncExecutionResult =
  | {
      status: "completed";
      source: SyncSource;
      attempt: SourceSyncAttempt;
      state: SourceSyncState;
      snapshotChanged: boolean;
    }
  | {
      status: "skipped";
      source: SyncSource;
      reason:
        | "not_due"
        | "adapter_not_registered"
        | "transition_in_progress"
        | "superseded";
      state: SourceSyncState;
    };

export type SourceSyncCoordinatorOptions = {
  adapters: Partial<Record<SyncSource, SourceSyncAdapter>>;
  repository: SourceSyncRepository;
  policies?: Partial<Record<SyncSource, SourceSyncDuePolicy>>;
  clock?: SourceSyncClock;
  timer?: SourceSyncTimer;
  attemptIdFactory?: () => string;
  transitionIdFactory?: () => string;
};

export class SourceSyncAdapterError extends Error {
  readonly code: string;

  constructor(code: string) {
    const parsed = sanitizedSyncErrorCodeSchema.safeParse(code);
    super(parsed.success ? parsed.data : "SYNC_FAILED");
    this.name = "SourceSyncAdapterError";
    this.code = parsed.success ? parsed.data : "SYNC_FAILED";
  }
}

export class SourceSyncCoordinatorError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_INCONSISTENT"
      | "STORE_WRITE_FAILED"
      | "INVALID_CLOCK"
  ) {
    super(code);
    this.name = "SourceSyncCoordinatorError";
  }
}

const systemClock: SourceSyncClock = {
  now: () => new Date()
};

const systemTimer: SourceSyncTimer = {
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export const DEFAULT_SOURCE_SYNC_DUE_POLICIES: Readonly<
  Record<SyncSource, SourceSyncDuePolicy>
> = Object.freeze({
  github: Object.freeze({
    successIntervalMs: 5 * 60_000,
    failureBackoffBaseMs: 5_000,
    failureBackoffMaxMs: 5 * 60_000
  }),
  codex: Object.freeze({
    successIntervalMs: 30_000,
    failureBackoffBaseMs: 2_000,
    failureBackoffMaxMs: 60_000
  }),
  notion: Object.freeze({
    successIntervalMs: 5 * 60_000,
    failureBackoffBaseMs: 5_000,
    failureBackoffMaxMs: 5 * 60_000
  }),
  google_calendar: Object.freeze({
    successIntervalMs: 60_000,
    failureBackoffBaseMs: 3_000,
    failureBackoffMaxMs: 2 * 60_000
  })
});

export class SourceSyncCoordinator {
  private readonly adapters: Partial<
    Record<SyncSource, SourceSyncAdapter>
  >;
  private readonly repository: SourceSyncRepository;
  private readonly policies: Record<SyncSource, SourceSyncDuePolicy>;
  private readonly clock: SourceSyncClock;
  private readonly timer: SourceSyncTimer;
  private readonly attemptIdFactory: () => string;
  private readonly transitionIdFactory: () => string;
  private readonly inFlight = new Map<
    SyncSource,
    Promise<SourceSyncExecutionResult>
  >();
  private readonly sourceGenerations = new Map<SyncSource, number>();
  private readonly pendingTransitions = new Map<
    SyncSource,
    SourceSyncTransition
  >();
  private readonly pendingTransitionRetryAtMs = new Map<
    SyncSource,
    number
  >();
  private readonly transitioningSources = new Set<SyncSource>();
  private readonly transitionTails = new Map<
    SyncSource,
    Promise<unknown>
  >();
  private readonly snapshotListeners =
    new Set<SourceSyncSnapshotListener>();
  private settlementTail: Promise<unknown> = Promise.resolve();
  private latest: SourceSyncLatestStore | null = null;
  private initializationPromise: Promise<void> | null = null;
  private reconciliationPromise: Promise<boolean> | null = null;
  private startPromise: Promise<void> | null = null;
  private timerHandle: unknown = null;
  private running = false;

  constructor(options: SourceSyncCoordinatorOptions) {
    this.repository = options.repository;
    this.adapters = validateAdapters(options.adapters);
    this.policies = mergePolicies(options.policies);
    this.clock = options.clock ?? systemClock;
    this.timer = options.timer ?? systemTimer;
    this.attemptIdFactory =
      options.attemptIdFactory ??
      (() => `sync_${randomUUID().replaceAll("-", "")}`);
    this.transitionIdFactory =
      options.transitionIdFactory ??
      (() => `transition_${randomUUID().replaceAll("-", "")}`);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (this.startPromise) return this.startPromise;

    const starting = (async () => {
      await this.ensureInitialized();
      await this.reconcileLatestFromRepository();
      this.running = true;
      this.scheduleNextTick("startup");
    })();
    this.startPromise = starting;
    try {
      await starting;
    } finally {
      if (this.startPromise === starting) {
        this.startPromise = null;
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.timerHandle !== null) {
      this.timer.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  async tick(
    triggerInput: Exclude<SyncTrigger, "manual"> = "scheduled"
  ): Promise<SourceSyncExecutionResult[]> {
    const trigger = syncTriggerSchema
      .exclude(["manual"])
      .parse(triggerInput);
    await this.ensureInitialized();
    await this.reconcileLatestFromRepository();
    const results = await Promise.all(
      SYNC_SOURCES.map((source) => this.sync(source, trigger))
    );
    if (this.running) this.scheduleNextTick();
    return results;
  }

  async sync(
    sourceInput: SyncSource,
    triggerInput: SyncTrigger = "manual"
  ): Promise<SourceSyncExecutionResult> {
    const source = syncSourceSchema.parse(sourceInput);
    const trigger = syncTriggerSchema.parse(triggerInput);
    await this.ensureInitialized();
    await this.reconcileLatestFromRepository();

    if (this.transitioningSources.has(source)) {
      return {
        status: "skipped",
        source,
        reason: "transition_in_progress",
        state: cloneState(this.requireLatest().sources[source])
      };
    }

    if (this.pendingTransitions.has(source)) {
      const retryAt =
        this.pendingTransitionRetryAtMs.get(source) ?? 0;
      if (trigger !== "manual" && retryAt > this.now().getTime()) {
        return {
          status: "skipped",
          source,
          reason: "not_due",
          state: cloneState(this.requireLatest().sources[source])
        };
      }
      try {
        await this.persistPendingTransition(source);
      } catch (error) {
        this.pendingTransitionRetryAtMs.set(
          source,
          this.now().getTime() +
            this.policies[source].failureBackoffBaseMs
        );
        if (this.running) this.scheduleNextTick();
        throw error;
      }
    }

    const existing = this.inFlight.get(source);
    if (existing) return existing;

    const adapter = this.adapters[source];
    if (!adapter) {
      return {
        status: "skipped",
        source,
        reason: "adapter_not_registered",
        state: cloneState(this.requireLatest().sources[source])
      };
    }

    await this.recoverPendingSettlementBeforeMutation();
    const current = this.requireLatest().sources[source];
    if (!isSourceSyncDue(current, this.now(), trigger)) {
      return {
        status: "skipped",
        source,
        reason: "not_due",
        state: cloneState(current)
      };
    }

    const execution = this.executeSource(source, trigger, adapter);
    this.inFlight.set(source, execution);
    try {
      return await execution;
    } finally {
      if (this.inFlight.get(source) === execution) {
        this.inFlight.delete(source);
      }
      if (this.running) this.scheduleNextTick();
    }
  }

  async getState(sourceInput: SyncSource): Promise<SourceSyncState> {
    const source = syncSourceSchema.parse(sourceInput);
    await this.ensureInitialized();
    await this.reconcileLatestFromRepository();
    return cloneState(this.requireLatest().sources[source]);
  }

  async getLatestStore(): Promise<SourceSyncLatestStore> {
    await this.ensureInitialized();
    await this.reconcileLatestFromRepository();
    return sourceSyncLatestStoreSchema.parse(this.requireLatest());
  }

  async beginConnectionGeneration(
    sourceInput: SyncSource
  ): Promise<SourceSyncState> {
    const source = syncSourceSchema.parse(sourceInput);
    await this.ensureInitialized();
    await this.reconcileLatestFromRepository();
    return this.withSourceTransition(source, async () => {
      await this.recoverPendingSettlementBeforeMutation();
      // Supersede the old adapter execution before waiting for persistence.
      // Its eventual settlement observes the generation mismatch and cannot
      // restore metadata from the previous connector lineage.
      this.sourceGenerations.set(
        source,
        this.sourceGeneration(source) + 1
      );
      this.inFlight.delete(source);

      const resetAt = this.now().toISOString();
      const cleanState = sourceSyncStateSchema.parse({
        contract: SOURCE_SYNC_STATE_CONTRACT,
        source,
        status: "never_synced",
        updatedAt: resetAt,
        retryCount: 0,
        nextDueAt: resetAt,
        lastAttempt: null,
        lastSuccess: null,
        lastFailure: null,
        latestSnapshot: null
      });
      const transition = sourceSyncTransitionSchema.parse({
        contract: SOURCE_SYNC_TRANSITION_CONTRACT,
        transitionId: this.transitionIdFactory(),
        source,
        kind: "reset_lineage",
        createdAt: resetAt,
        retryAt: resetAt,
        failureCount: 0,
        lastErrorCode: null,
        targetState: cleanState,
        attempt: null
      });

      await this.withSettlement(async () => {
        const currentStore = this.requireLatest();
        let authoritativeBase = currentStore;
        try {
          authoritativeBase =
            (await this.repository.beginTransition(transition)) ??
            currentStore;
        } catch {
          throw new SourceSyncCoordinatorError("STORE_WRITE_FAILED");
        }
        const nextStore = sourceSyncLatestStoreSchema.parse({
          ...authoritativeBase,
          updatedAt: resetAt,
          sources: {
            ...authoritativeBase.sources,
            [source]: cleanState
          }
        });
        this.pendingTransitions.set(source, transition);
        this.pendingTransitionRetryAtMs.set(
          source,
          Date.parse(transition.retryAt)
        );
        this.latest = nextStore;
        try {
          this.latest = sourceSyncLatestStoreSchema.parse(
            await this.repository.completeTransition(
              nextStore,
              transition
            )
          );
        } catch {
          await this.deferPendingTransition(transition);
          throw new SourceSyncCoordinatorError("STORE_WRITE_FAILED");
        }
        this.clearPendingTransition(transition);
      });
      return cloneState(cleanState);
    });
  }

  async markDisconnected(
    sourceInput: SyncSource
  ): Promise<SourceSyncState> {
    const source = syncSourceSchema.parse(sourceInput);
    await this.ensureInitialized();
    await this.reconcileLatestFromRepository();
    return this.withSourceTransition(source, async () => {
      await this.recoverPendingSettlementBeforeMutation();
      this.sourceGenerations.set(
        source,
        this.sourceGeneration(source) + 1
      );
      this.inFlight.delete(source);

      const beforeStore = this.requireLatest();
      const previous = beforeStore.sources[source];
      const disconnectedAt = this.now().toISOString();
      const retryCount = previous.retryCount + 1;
      const attempt = sourceSyncAttemptSchema.parse({
        contract: SOURCE_SYNC_ATTEMPT_CONTRACT,
        attemptId: this.attemptIdFactory(),
        source,
        trigger: "manual",
        startedAt: disconnectedAt,
        completedAt: disconnectedAt,
        outcome: "failure",
        retryCount,
        latencyMs: 0,
        snapshotRevision: null,
        snapshotHash: null,
        itemCount: null,
        errorCode: "CONNECTOR_DISCONNECTED"
      });
      const nextState = sourceSyncStateSchema.parse({
        contract: SOURCE_SYNC_STATE_CONTRACT,
        source,
        status: "disabled",
        updatedAt: disconnectedAt,
        retryCount,
        nextDueAt: null,
        lastAttempt: attempt,
        lastSuccess: previous.lastSuccess,
        lastFailure: attempt,
        latestSnapshot: null
      });
      const transition = sourceSyncTransitionSchema.parse({
        contract: SOURCE_SYNC_TRANSITION_CONTRACT,
        transitionId: this.transitionIdFactory(),
        source,
        kind: "disconnect",
        createdAt: disconnectedAt,
        retryAt: disconnectedAt,
        failureCount: 0,
        lastErrorCode: null,
        targetState: nextState,
        attempt
      });

      await this.withSettlement(async () => {
        const currentStore = this.requireLatest();
        let authoritativeBase = currentStore;
        try {
          authoritativeBase =
            (await this.repository.beginTransition(transition)) ??
            currentStore;
        } catch {
          throw new SourceSyncCoordinatorError("STORE_WRITE_FAILED");
        }
        const nextStore = sourceSyncLatestStoreSchema.parse({
          ...authoritativeBase,
          updatedAt: disconnectedAt,
          sources: {
            ...authoritativeBase.sources,
            [source]: nextState
          }
        });
        this.pendingTransitions.set(source, transition);
        this.pendingTransitionRetryAtMs.set(
          source,
          Date.parse(transition.retryAt)
        );
        // The transition intent is durable before the disabled state becomes
        // visible. If completion fails or the process restarts, it can be
        // replayed without restoring a stale ready snapshot.
        this.latest = nextStore;
        try {
          this.latest = sourceSyncLatestStoreSchema.parse(
            await this.repository.completeTransition(
              nextStore,
              transition
            )
          );
        } catch {
          await this.deferPendingTransition(transition);
          throw new SourceSyncCoordinatorError("STORE_WRITE_FAILED");
        }
        this.clearPendingTransition(transition);
      });
      return cloneState(nextState);
    });
  }

  onSnapshotRevisionChange(
    listener: SourceSyncSnapshotListener
  ): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.latest) return;
    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }
    try {
      await this.initializationPromise;
    } finally {
      if (!this.latest) this.initializationPromise = null;
    }
  }

  private async initialize(): Promise<void> {
    const persisted = await this.repository.read();
    validateRepositorySnapshot(persisted);
    const now = this.now().toISOString();
    const latest =
      persisted.latest.status === "ready"
        ? persisted.latest.value
        : createInitialSourceSyncStore(
            now,
            new Set(Object.keys(this.adapters) as SyncSource[])
          );
    let normalized = normalizeRegisteredAdapters(
      latest,
      this.adapters,
      now
    );
    if (persisted.transitions.status === "ready") {
      for (const transition of persisted.transitions.value.transitions) {
        this.pendingTransitions.set(transition.source, transition);
        this.pendingTransitionRetryAtMs.set(
          transition.source,
          Date.parse(transition.retryAt)
        );
        this.sourceGenerations.set(
          transition.source,
          this.sourceGeneration(transition.source) + 1
        );
        normalized = sourceSyncLatestStoreSchema.parse({
          ...normalized,
          sources: {
            ...normalized.sources,
            [transition.source]: transition.targetState
          }
        });
      }
    }
    this.latest = normalized;
  }

  /**
   * Route bundles can retain a coordinator after another runtime view has
   * durably advanced the same sync store. Adopt that projection only while
   * this coordinator has no local mutation to protect. The durable timestamp
   * prevents an older filesystem view from replacing newer local state.
   */
  private async reconcileLatestFromRepository(): Promise<void> {
    if (
      this.inFlight.size > 0 ||
      this.transitioningSources.size > 0 ||
      this.pendingTransitions.size > 0
    ) {
      return;
    }

    if (!this.reconciliationPromise) {
      const reconciliation = this.withSettlement(async () => {
        if (
          this.inFlight.size > 0 ||
          this.transitioningSources.size > 0 ||
          this.pendingTransitions.size > 0
        ) {
          return false;
        }

        const persisted = await this.repository.read();
        validateRepositorySnapshot(persisted);
        if (persisted.latest.status !== "ready") return false;
        if (
          persisted.transitions.status === "ready" &&
          persisted.transitions.value.transitions.length > 0
        ) {
          return false;
        }

        const current = this.requireLatest();
        const durable = persisted.latest.value;
        const normalized = normalizeRegisteredAdapters(
          durable,
          this.adapters,
          this.now().toISOString()
        );
        if (safeSha256(normalized) === safeSha256(current)) {
          return false;
        }
        this.latest = normalized;
        return true;
      });
      this.reconciliationPromise = reconciliation;
    }

    const reconciliation = this.reconciliationPromise;
    try {
      const changed = await reconciliation;
      if (changed && this.running) this.scheduleNextTick();
    } finally {
      if (this.reconciliationPromise === reconciliation) {
        this.reconciliationPromise = null;
      }
    }
  }

  private async executeSource(
    source: SyncSource,
    trigger: SyncTrigger,
    adapter: SourceSyncAdapter
  ): Promise<SourceSyncExecutionResult> {
    const executionGeneration = this.sourceGeneration(source);
    const beforeStore = this.requireLatest();
    const previous = beforeStore.sources[source];
    const started = this.now();
    const startedAt = started.toISOString();
    this.latest = sourceSyncLatestStoreSchema.parse({
      ...beforeStore,
      updatedAt: startedAt,
      sources: {
        ...beforeStore.sources,
        [source]: {
          ...previous,
          status: "syncing",
          updatedAt: startedAt
        }
      }
    });

    let attempt: SourceSyncAttempt;
    let nextState: SourceSyncState;
    let snapshotChanged = false;
    let event: SourceSyncSnapshotEvent | null = null;

    try {
      const rawReceipt = await adapter.sync({
        source,
        trigger,
        startedAt,
        retryCount: previous.retryCount,
        previousSnapshot: previous.latestSnapshot
          ? { ...previous.latestSnapshot }
          : null
      });
      const receipt = sourceSnapshotReceiptSchema.safeParse(rawReceipt);
      if (!receipt.success) {
        throw new SourceSyncAdapterError("INVALID_SYNC_RESULT");
      }
      const completed = this.now();
      const completedAt = completed.toISOString();
      attempt = sourceSyncAttemptSchema.parse({
        contract: SOURCE_SYNC_ATTEMPT_CONTRACT,
        attemptId: this.attemptIdFactory(),
        source,
        trigger,
        startedAt,
        completedAt,
        outcome: "success",
        retryCount: 0,
        latencyMs: elapsedMilliseconds(started, completed),
        snapshotRevision: receipt.data.revision,
        snapshotHash: receipt.data.hash,
        itemCount: receipt.data.itemCount,
        errorCode: null
      });
      const latestSnapshot: LatestSnapshotMetadata = {
        revision: receipt.data.revision,
        hash: receipt.data.hash,
        itemCount: receipt.data.itemCount,
        syncedAt: completedAt,
        attemptId: attempt.attemptId
      };
      nextState = sourceSyncStateSchema.parse({
        contract: SOURCE_SYNC_STATE_CONTRACT,
        source,
        status: "ready",
        updatedAt: completedAt,
        retryCount: 0,
        nextDueAt: new Date(
          completed.getTime() +
            this.policies[source].successIntervalMs
        ).toISOString(),
        lastAttempt: attempt,
        lastSuccess: attempt,
        lastFailure: previous.lastFailure,
        latestSnapshot
      });
      snapshotChanged =
        previous.latestSnapshot === null ||
        previous.latestSnapshot.revision !== receipt.data.revision ||
        previous.latestSnapshot.hash !== receipt.data.hash;
      if (snapshotChanged) {
        event = sourceSyncSnapshotEventSchema.parse({
          contract: SOURCE_SYNC_SNAPSHOT_EVENT_CONTRACT,
          source,
          observedAt: completedAt,
          previousRevision:
            previous.latestSnapshot?.revision ?? null,
          previousHash: previous.latestSnapshot?.hash ?? null,
          revision: receipt.data.revision,
          hash: receipt.data.hash,
          itemCount: receipt.data.itemCount
        });
      }
    } catch (error) {
      const completed = this.now();
      const completedAt = completed.toISOString();
      const retryCount = previous.retryCount + 1;
      const errorCode = sanitizeSyncErrorCode(error);
      const terminal = isTerminalSourceSyncError(errorCode);
      attempt = sourceSyncAttemptSchema.parse({
        contract: SOURCE_SYNC_ATTEMPT_CONTRACT,
        attemptId: this.attemptIdFactory(),
        source,
        trigger,
        startedAt,
        completedAt,
        outcome: "failure",
        retryCount,
        latencyMs: elapsedMilliseconds(started, completed),
        snapshotRevision: null,
        snapshotHash: null,
        itemCount: null,
        errorCode
      });
      nextState = sourceSyncStateSchema.parse({
        contract: SOURCE_SYNC_STATE_CONTRACT,
        source,
        status: terminal ? "disabled" : "retry_wait",
        updatedAt: completedAt,
        retryCount,
        nextDueAt: terminal
          ? null
          : new Date(
              completed.getTime() +
                exponentialBackoffMs(
                  this.policies[source],
                  retryCount
                )
            ).toISOString(),
        lastAttempt: attempt,
        lastSuccess: previous.lastSuccess,
        lastFailure: attempt,
        latestSnapshot: previous.latestSnapshot
      });
    }

    let superseded = false;
    await this.withSettlement(async () => {
      if (this.sourceGeneration(source) !== executionGeneration) {
        superseded = true;
        return;
      }
      const currentStore = this.requireLatest();
      const nextStore = sourceSyncLatestStoreSchema.parse({
        ...currentStore,
        updatedAt: attempt.completedAt,
        sources: {
          ...currentStore.sources,
          [source]: nextState
        }
      });
      try {
        this.latest = sourceSyncLatestStoreSchema.parse(
          await this.repository.commit(nextStore, attempt)
        );
      } catch {
        this.latest = sourceSyncLatestStoreSchema.parse({
          ...this.requireLatest(),
          updatedAt: this.now().toISOString(),
          sources: {
            ...this.requireLatest().sources,
            [source]: beforeStore.sources[source]
          }
        });
        throw new SourceSyncCoordinatorError("STORE_WRITE_FAILED");
      }
    });
    if (superseded) {
      return {
        status: "skipped",
        source,
        reason: "superseded",
        state: cloneState(this.requireLatest().sources[source])
      };
    }
    if (event) this.publishSnapshotEvent(event);

    return {
      status: "completed",
      source,
      attempt,
      state: cloneState(nextState),
      snapshotChanged
    };
  }

  private publishSnapshotEvent(
    eventInput: SourceSyncSnapshotEvent
  ): void {
    const event = sourceSyncSnapshotEventSchema.parse(eventInput);
    for (const listener of this.snapshotListeners) {
      try {
        const result = listener({ ...event });
        if (result && typeof result.then === "function") {
          void result.catch(() => {
            // Listener failures never alter the persisted sync result.
          });
        }
      } catch {
        // Listener failures never alter the persisted sync result.
      }
    }
  }

  private withSettlement<T>(
    settlement: () => Promise<T>
  ): Promise<T> {
    const result = this.settlementTail.then(
      settlement,
      settlement
    );
    this.settlementTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async recoverPendingSettlementBeforeMutation(): Promise<void> {
    await this.withSettlement(async () => {
      let recovered: SourceSyncLatestStore | null;
      try {
        recovered =
          await this.repository.recoverPendingSettlement();
      } catch {
        throw new SourceSyncCoordinatorError("STORE_WRITE_FAILED");
      }
      if (recovered) {
        this.latest =
          this.overlayPendingTransitionTargets(recovered);
      }
    });
  }

  private withSourceTransition<T>(
    source: SyncSource,
    transition: () => Promise<T>
  ): Promise<T> {
    this.transitioningSources.add(source);
    const previous =
      this.transitionTails.get(source) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        if (this.pendingTransitions.has(source)) {
          await this.persistPendingTransition(source);
        }
        return transition();
      });
    this.transitionTails.set(source, operation);
    return operation.finally(() => {
      if (this.transitionTails.get(source) === operation) {
        this.transitionTails.delete(source);
        this.transitioningSources.delete(source);
        if (this.running) this.scheduleNextTick();
      }
    });
  }

  private async persistPendingTransition(
    source: SyncSource
  ): Promise<void> {
    const pending = this.pendingTransitions.get(source);
    if (!pending) return;
    await this.withSettlement(async () => {
      const current = this.pendingTransitions.get(source);
      if (!current || current.transitionId !== pending.transitionId) {
        return;
      }
      const currentStore = this.requireLatest();
      const latest = sourceSyncLatestStoreSchema.parse({
        ...currentStore,
        sources: {
          ...currentStore.sources,
          [source]: current.targetState
        }
      });
      this.latest = latest;
      try {
        this.latest = sourceSyncLatestStoreSchema.parse(
          await this.repository.completeTransition(latest, current)
        );
      } catch {
        await this.deferPendingTransition(current);
        throw new SourceSyncCoordinatorError("STORE_WRITE_FAILED");
      }
      this.clearPendingTransition(current);
    });
  }

  private clearPendingTransition(
    transition: SourceSyncTransition
  ): void {
    if (
      this.pendingTransitions.get(transition.source)?.transitionId !==
      transition.transitionId
    ) {
      return;
    }
    this.pendingTransitions.delete(transition.source);
    this.pendingTransitionRetryAtMs.delete(transition.source);
  }

  private async deferPendingTransition(
    transition: SourceSyncTransition
  ): Promise<void> {
    const retryAt = new Date(
      this.now().getTime() +
        this.policies[transition.source].failureBackoffBaseMs
    ).toISOString();
    const deferred = sourceSyncTransitionSchema.parse({
      ...transition,
      retryAt,
      failureCount: transition.failureCount + 1,
      lastErrorCode: "STORE_WRITE_FAILED"
    });
    this.pendingTransitions.set(transition.source, deferred);
    this.pendingTransitionRetryAtMs.set(
      transition.source,
      Date.parse(retryAt)
    );
    try {
      const recovered =
        await this.repository.updateTransition(deferred);
      if (recovered) {
        this.latest = this.overlayPendingTransitionTargets(recovered);
      }
    } catch {
      // The original durable intent remains recoverable even if persisting
      // the retry schedule itself fails.
    }
  }

  private overlayPendingTransitionTargets(
    latestInput: SourceSyncLatestStore
  ): SourceSyncLatestStore {
    const latest = sourceSyncLatestStoreSchema.parse(latestInput);
    return sourceSyncLatestStoreSchema.parse({
      ...latest,
      sources: [...this.pendingTransitions.values()].reduce(
        (sources, transition) => ({
          ...sources,
          [transition.source]: transition.targetState
        }),
        latest.sources
      )
    });
  }

  private scheduleNextTick(
    trigger: Exclude<SyncTrigger, "manual"> = "scheduled"
  ): void {
    if (!this.running) return;
    if (this.timerHandle !== null) {
      this.timer.clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    const latest = this.requireLatest();
    const now = this.now().getTime();
    const dueTimes = SYNC_SOURCES.flatMap((source) => {
      if (
        !this.adapters[source] ||
        this.inFlight.has(source) ||
        this.transitioningSources.has(source)
      ) {
        return [];
      }
      if (this.pendingTransitions.has(source)) {
        return [
          this.pendingTransitionRetryAtMs.get(source) ?? now
        ];
      }
      const state = latest.sources[source];
      if (state.status === "disabled") return [];
      if (
        state.status === "never_synced" ||
        state.nextDueAt === null
      ) {
        return [now];
      }
      return [Date.parse(state.nextDueAt)];
    });
    if (dueTimes.length === 0) return;

    const delayMs = Math.min(
      2_147_483_647,
      Math.max(0, Math.min(...dueTimes) - now)
    );
    this.scheduleTick(delayMs, trigger);
  }

  private scheduleTick(
    delayMs: number,
    trigger: Exclude<SyncTrigger, "manual">
  ): void {
    if (!this.running) return;
    if (this.timerHandle !== null) {
      this.timer.clearTimeout(this.timerHandle);
    }
    this.timerHandle = this.timer.setTimeout(() => {
      this.timerHandle = null;
      void this.tick(trigger).catch(() => {
        if (this.running) this.scheduleNextTick();
      });
    }, delayMs);
  }

  private sourceGeneration(source: SyncSource): number {
    return this.sourceGenerations.get(source) ?? 0;
  }

  private now(): Date {
    const date = this.clock.now();
    if (
      !(date instanceof Date) ||
      !Number.isFinite(date.getTime())
    ) {
      throw new SourceSyncCoordinatorError("INVALID_CLOCK");
    }
    return new Date(date.getTime());
  }

  private requireLatest(): SourceSyncLatestStore {
    if (!this.latest) {
      throw new SourceSyncCoordinatorError("STORE_INVALID");
    }
    return this.latest;
  }
}

export function exponentialBackoffMs(
  policyInput: SourceSyncDuePolicy,
  retryCount: number
): number {
  const policy = sourceSyncDuePolicySchema.parse(policyInput);
  const parsedRetryCount = z.number().int().positive().parse(retryCount);
  const exponent = Math.min(parsedRetryCount - 1, 30);
  return Math.min(
    policy.failureBackoffMaxMs,
    policy.failureBackoffBaseMs * 2 ** exponent
  );
}

export function isSourceSyncDue(
  stateInput: SourceSyncState,
  nowInput: Date,
  triggerInput: SyncTrigger
): boolean {
  const state = sourceSyncStateSchema.parse(stateInput);
  const trigger = syncTriggerSchema.parse(triggerInput);
  const now = new Date(nowInput.getTime());
  if (!Number.isFinite(now.getTime())) {
    throw new SourceSyncCoordinatorError("INVALID_CLOCK");
  }
  if (state.status === "syncing") {
    return false;
  }
  if (trigger === "manual") return true;
  if (state.status === "disabled") return false;
  if (state.status === "never_synced" || state.nextDueAt === null) {
    return true;
  }
  return Date.parse(state.nextDueAt) <= now.getTime();
}

export function sanitizeSyncErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const parsed = sanitizedSyncErrorCodeSchema.safeParse(error.code);
    if (parsed.success) return parsed.data;
  }
  return "SYNC_FAILED";
}

export function isTerminalSourceSyncError(errorCode: string): boolean {
  return (
    errorCode === "CONNECTOR_DISCONNECTED" ||
    errorCode === "NOT_CONNECTED" ||
    errorCode === "REAUTHORIZATION_REQUIRED" ||
    errorCode === "REFRESH_TOKEN_EXPIRED" ||
    errorCode === "REFRESH_TOKEN_MISSING"
  );
}

export function createSourceSnapshotReceipt(
  revisionInput: string,
  itemCountInput: number,
  snapshotValue: unknown
): SourceSnapshotReceipt {
  return sourceSnapshotReceiptSchema.parse({
    revision: revisionInput,
    hash: safeSha256(snapshotValue),
    itemCount: itemCountInput
  });
}

export function createInitialSourceSyncStore(
  nowInput: string,
  enabledSources: ReadonlySet<SyncSource> = new Set(SYNC_SOURCES)
): SourceSyncLatestStore {
  const now = z.string().datetime().parse(nowInput);
  const sourceState = (source: SyncSource): SourceSyncState =>
    sourceSyncStateSchema.parse({
      contract: SOURCE_SYNC_STATE_CONTRACT,
      source,
      status: enabledSources.has(source)
        ? "never_synced"
        : "disabled",
      updatedAt: now,
      retryCount: 0,
      nextDueAt: enabledSources.has(source) ? now : null,
      lastAttempt: null,
      lastSuccess: null,
      lastFailure: null,
      latestSnapshot: null
    });

  return sourceSyncLatestStoreSchema.parse({
    contract: SOURCE_SYNC_LATEST_STORE_CONTRACT,
    updatedAt: now,
    sources: {
      github: sourceState("github"),
      codex: sourceState("codex"),
      notion: sourceState("notion"),
      google_calendar: sourceState("google_calendar")
    }
  });
}

function validateAdapters(
  input: Partial<Record<SyncSource, SourceSyncAdapter>>
): Partial<Record<SyncSource, SourceSyncAdapter>> {
  const adapters: Partial<Record<SyncSource, SourceSyncAdapter>> = {};
  for (const source of SYNC_SOURCES) {
    const adapter = input[source];
    if (!adapter) continue;
    if (adapter.source !== source || typeof adapter.sync !== "function") {
      throw new TypeError(`invalid sync adapter for ${source}`);
    }
    adapters[source] = adapter;
  }
  return adapters;
}

function mergePolicies(
  input:
    | Partial<Record<SyncSource, SourceSyncDuePolicy>>
    | undefined
): Record<SyncSource, SourceSyncDuePolicy> {
  return {
    github: sourceSyncDuePolicySchema.parse(
      input?.github ?? DEFAULT_SOURCE_SYNC_DUE_POLICIES.github
    ),
    codex: sourceSyncDuePolicySchema.parse(
      input?.codex ?? DEFAULT_SOURCE_SYNC_DUE_POLICIES.codex
    ),
    notion: sourceSyncDuePolicySchema.parse(
      input?.notion ?? DEFAULT_SOURCE_SYNC_DUE_POLICIES.notion
    ),
    google_calendar: sourceSyncDuePolicySchema.parse(
      input?.google_calendar ??
        DEFAULT_SOURCE_SYNC_DUE_POLICIES.google_calendar
    )
  };
}

function validateRepositorySnapshot(
  snapshot: SourceSyncRepositorySnapshot
): void {
  if (
    snapshot.latest.status === "invalid" ||
    snapshot.history.status === "invalid" ||
    snapshot.transitions.status === "invalid" ||
    snapshot.settlements.status === "invalid"
  ) {
    throw new SourceSyncCoordinatorError("STORE_INVALID");
  }
  const pendingSources = new Set(
    snapshot.transitions.status === "ready"
      ? snapshot.transitions.value.transitions.map(
          (transition) => transition.source
        )
      : []
  );

  if (
    snapshot.latest.status === "missing" &&
    snapshot.history.status === "ready" &&
    snapshot.history.value.attempts.some(
      (attempt) => !pendingSources.has(attempt.source)
    )
  ) {
    throw new SourceSyncCoordinatorError("STORE_INCONSISTENT");
  }
  if (
    snapshot.latest.status === "ready" &&
    snapshot.history.status === "missing" &&
    SYNC_SOURCES.some(
      (source) =>
        snapshot.latest.status === "ready" &&
        snapshot.latest.value.sources[source].lastAttempt !== null &&
        !pendingSources.has(source)
    )
  ) {
    throw new SourceSyncCoordinatorError("STORE_INCONSISTENT");
  }
}

function normalizeRegisteredAdapters(
  latestInput: SourceSyncLatestStore,
  adapters: Partial<Record<SyncSource, SourceSyncAdapter>>,
  now: string
): SourceSyncLatestStore {
  const latest = sourceSyncLatestStoreSchema.parse(latestInput);
  const sources = { ...latest.sources };
  for (const source of SYNC_SOURCES) {
    const state = latest.sources[source];
    if (!adapters[source] && state.status !== "disabled") {
      sources[source] = sourceSyncStateSchema.parse({
        ...state,
        status: "disabled",
        updatedAt: now,
        nextDueAt: null
      });
    } else if (state.status === "syncing") {
      sources[source] = sourceSyncStateSchema.parse({
        ...state,
        status:
          state.lastAttempt?.outcome === "failure"
            ? "retry_wait"
            : state.latestSnapshot
              ? "ready"
              : "never_synced",
        updatedAt: now,
        nextDueAt: adapters[source] ? now : null
      });
    }
  }
  return sourceSyncLatestStoreSchema.parse({
    ...latest,
    updatedAt: now,
    sources
  });
}

function elapsedMilliseconds(started: Date, completed: Date): number {
  return Math.max(0, completed.getTime() - started.getTime());
}

function cloneState(state: SourceSyncState): SourceSyncState {
  return sourceSyncStateSchema.parse(state);
}
