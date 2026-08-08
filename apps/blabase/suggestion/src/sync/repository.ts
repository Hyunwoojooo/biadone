import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  DEFAULT_SOURCE_SYNC_HISTORY_LIMIT,
  SOURCE_SYNC_HISTORY_HARD_LIMIT,
  SOURCE_SYNC_HISTORY_STORE_CONTRACT,
  SOURCE_SYNC_SETTLEMENT_CONTRACT,
  SOURCE_SYNC_SETTLEMENT_STORE_CONTRACT,
  SOURCE_SYNC_TRANSITION_STORE_CONTRACT,
  compareSyncAttempts,
  sourceSyncAttemptSchema,
  sourceSyncHistoryStoreSchema,
  sourceSyncLatestStoreSchema,
  sourceSyncSettlementSchema,
  sourceSyncSettlementStoreSchema,
  sourceSyncTransitionSchema,
  sourceSyncTransitionStoreSchema,
  type SourceSyncAttempt,
  type SourceSyncHistoryStore,
  type SourceSyncLatestStore,
  type SourceSyncSettlement,
  type SourceSyncSettlementStore,
  type SourceSyncTransition,
  type SourceSyncTransitionStore
} from "./schema";
import { safePrettyJson } from "./serialization";

export type SourceSyncStoreReadFailure =
  | "invalid_json"
  | "schema_mismatch"
  | "read_failed";

export type SourceSyncStoreReadResult<T> =
  | { status: "ready"; value: T }
  | { status: "missing" }
  | {
      status: "invalid";
      reason: SourceSyncStoreReadFailure;
    };

export type SourceSyncRepositorySnapshot = {
  latest: SourceSyncStoreReadResult<SourceSyncLatestStore>;
  history: SourceSyncStoreReadResult<SourceSyncHistoryStore>;
  transitions: SourceSyncStoreReadResult<SourceSyncTransitionStore>;
  settlements: SourceSyncStoreReadResult<SourceSyncSettlementStore>;
};

export interface SourceSyncRepository {
  read(): Promise<SourceSyncRepositorySnapshot>;
  recoverPendingSettlement(): Promise<SourceSyncLatestStore | null>;
  commit(
    latest: SourceSyncLatestStore,
    attempt: SourceSyncAttempt
  ): Promise<SourceSyncLatestStore>;
  beginTransition(
    transition: SourceSyncTransition
  ): Promise<SourceSyncLatestStore | null>;
  updateTransition(
    transition: SourceSyncTransition
  ): Promise<SourceSyncLatestStore | null>;
  completeTransition(
    latest: SourceSyncLatestStore,
    transition: SourceSyncTransition
  ): Promise<SourceSyncLatestStore>;
}

export class SourceSyncRepositoryError extends Error {
  constructor(
    public readonly code:
      | "INVALID_HISTORY_LIMIT"
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
  ) {
    super(code);
    this.name = "SourceSyncRepositoryError";
  }
}

export function sourceSyncLocalDirectory(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "sync");
}

export type SourceSyncRepositoryFaultPoint =
  | "commit_after_history"
  | "transition_clear_after_rename";

export type FileSystemSourceSyncRepositoryOptions = {
  maxHistory?: number;
  /**
   * Deterministic fault-injection seam for filesystem regression tests.
   * Production callers must leave this unset.
   */
  faultInjector?: (
    point: SourceSyncRepositoryFaultPoint
  ) => void | Promise<void>;
};

const SOURCE_SYNC_MUTATION_QUEUES = Symbol.for(
  "blabase.source-sync.mutation-queues"
);

type SourceSyncMutationQueues = Map<string, Promise<unknown>>;

function sourceSyncMutationQueues(): SourceSyncMutationQueues {
  const sharedGlobal = globalThis as typeof globalThis &
    Record<symbol, unknown>;
  const existing = sharedGlobal[SOURCE_SYNC_MUTATION_QUEUES];
  if (existing instanceof Map) {
    return existing as SourceSyncMutationQueues;
  }
  const queues: SourceSyncMutationQueues = new Map();
  sharedGlobal[SOURCE_SYNC_MUTATION_QUEUES] = queues;
  return queues;
}

export class FileSystemSourceSyncRepository
  implements SourceSyncRepository
{
  private get mutationTail(): Promise<unknown> {
    return (
      sourceSyncMutationQueues().get(resolve(this.directory)) ??
      Promise.resolve()
    );
  }

  private set mutationTail(value: Promise<unknown>) {
    const queues = sourceSyncMutationQueues();
    const directory = resolve(this.directory);
    queues.set(directory, value);
    const clear = () => {
      if (queues.get(directory) === value) queues.delete(directory);
    };
    void value.then(clear, clear);
  }
  private readonly maxHistory: number;
  private readonly faultInjector:
    | FileSystemSourceSyncRepositoryOptions["faultInjector"];

  constructor(
    private readonly directory: string,
    options: FileSystemSourceSyncRepositoryOptions = {}
  ) {
    this.maxHistory = parseHistoryLimit(options.maxHistory);
    this.faultInjector = options.faultInjector;
  }

  static fromCwd(
    cwd = process.cwd(),
    options: FileSystemSourceSyncRepositoryOptions = {}
  ): FileSystemSourceSyncRepository {
    return new FileSystemSourceSyncRepository(
      sourceSyncLocalDirectory(cwd),
      options
    );
  }

  async read(): Promise<SourceSyncRepositorySnapshot> {
    return this.withMutation(async () => {
      const settlements = await this.reconcilePendingSettlement();
      const [latest, history, transitions] = await Promise.all([
        readValidatedJson(
          join(this.directory, "latest.json"),
          sourceSyncLatestStoreSchema
        ),
        readValidatedJson(
          join(this.directory, "history.json"),
          sourceSyncHistoryStoreSchema
        ),
        readValidatedJson(
          join(this.directory, "transitions.json"),
          sourceSyncTransitionStoreSchema
        )
      ]);
      return { latest, history, transitions, settlements };
    });
  }

  async recoverPendingSettlement(): Promise<SourceSyncLatestStore | null> {
    return this.withMutation(async () => {
      const recovered =
        await this.requirePendingSettlementReconciled();
      if (!recovered) return null;
      const latest = await readValidatedJson(
        join(this.directory, "latest.json"),
        sourceSyncLatestStoreSchema
      );
      if (latest.status !== "ready") {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      return latest.value;
    });
  }

  async commit(
    latestInput: SourceSyncLatestStore,
    attemptInput: SourceSyncAttempt
  ): Promise<SourceSyncLatestStore> {
    const latest = sourceSyncLatestStoreSchema.parse(latestInput);
    const attempt = sourceSyncAttemptSchema.parse(attemptInput);

    return this.withMutation(async () => {
      const recoveredPendingSettlement =
        await this.requirePendingSettlementReconciled();
      const [existingLatest, existingHistory, pendingTransitions] =
        await Promise.all([
          readValidatedJson(
            join(this.directory, "latest.json"),
            sourceSyncLatestStoreSchema
          ),
          readValidatedJson(
            join(this.directory, "history.json"),
            sourceSyncHistoryStoreSchema
          ),
          readValidatedJson(
            join(this.directory, "transitions.json"),
            sourceSyncTransitionStoreSchema
          )
        ]);
      if (
        existingLatest.status === "invalid" ||
        existingHistory.status === "invalid" ||
        pendingTransitions.status === "invalid"
      ) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      if (
        recoveredPendingSettlement &&
        existingLatest.status !== "ready"
      ) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const pending =
        pendingTransitions.status === "ready"
          ? pendingTransitions.value.transitions
          : [];
      if (
        pending.some(
          (transition) => transition.source === attempt.source
        )
      ) {
        throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
      }
      if (
        existingLatest.status === "missing" &&
        existingHistory.status === "ready" &&
        existingHistory.value.attempts.some(
          (item) =>
            !pending.some(
              (transition) => transition.source === item.source
            )
        )
      ) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const authoritativeBase =
        existingLatest.status === "ready"
          ? existingLatest.value
          : latest;
      const sourceMergedLatest =
        sourceSyncLatestStoreSchema.parse({
          ...authoritativeBase,
          updatedAt: latest.updatedAt,
          sources: {
            ...authoritativeBase.sources,
            [attempt.source]: latest.sources[attempt.source]
          }
        });
      const protectedLatest = sourceSyncLatestStoreSchema.parse({
        ...sourceMergedLatest,
        sources: pending.reduce(
          (sources, transition) => ({
            ...sources,
            [transition.source]: transition.targetState
          }),
          sourceMergedLatest.sources
        )
      });

      const attempts = mergeAttemptIntoHistory(
        existingHistory.status === "ready"
          ? existingHistory.value.attempts
          : [],
        attempt,
        this.maxHistory
      );
      const history = sourceSyncHistoryStoreSchema.parse({
        contract: SOURCE_SYNC_HISTORY_STORE_CONTRACT,
        updatedAt: protectedLatest.updatedAt,
        attempts
      });
      assertLatestHistoryCoherent(
        protectedLatest,
        history,
        new Set(pending.map((transition) => transition.source))
      );
      const settlement = sourceSyncSettlementSchema.parse({
        contract: SOURCE_SYNC_SETTLEMENT_CONTRACT,
        settlementId: `settlement_${attempt.attemptId.slice(
          "sync_".length
        )}`,
        source: attempt.source,
        createdAt: attempt.completedAt,
        attempt,
        latest: protectedLatest,
        history
      });
      const pendingSettlement =
        sourceSyncSettlementStoreSchema.parse({
          contract: SOURCE_SYNC_SETTLEMENT_STORE_CONTRACT,
          updatedAt: settlement.createdAt,
          settlement
        });

      await ensurePrivateDirectory(this.directory);
      let settlementPrepared = false;
      try {
        // The exact latest/history target is durable before either separated
        // projection changes. A restart replays this intent verbatim.
        await writePrivateJson(
          join(this.directory, "settlements.json"),
          pendingSettlement
        );
        settlementPrepared = true;
        await this.applySettlement(settlement);
      } catch (error) {
        if (
          settlementPrepared &&
          (await this.tryConfirmSettlement(settlement))
        ) {
          return settlement.latest;
        }
        if (error instanceof SourceSyncRepositoryError) throw error;
        throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
      }
      return settlement.latest;
    });
  }

  async beginTransition(
    transitionInput: SourceSyncTransition
  ): Promise<SourceSyncLatestStore | null> {
    const transition =
      sourceSyncTransitionSchema.parse(transitionInput);
    return this.withMutation(async () => {
      const recoveredPendingSettlement =
        await this.requirePendingSettlementReconciled();
      const [existing, recoveredLatest] = await Promise.all([
        readValidatedJson(
          join(this.directory, "transitions.json"),
          sourceSyncTransitionStoreSchema
        ),
        recoveredPendingSettlement
          ? readValidatedJson(
              join(this.directory, "latest.json"),
              sourceSyncLatestStoreSchema
            )
          : Promise.resolve({ status: "missing" } as const)
      ]);
      if (existing.status === "invalid") {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      if (recoveredLatest.status === "invalid") {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      if (
        recoveredPendingSettlement &&
        recoveredLatest.status !== "ready"
      ) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      if (
        existing.status === "ready" &&
        existing.value.transitions.some(
          (item) => item.source === transition.source
        )
      ) {
        throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
      }
      const transitions = sourceSyncTransitionStoreSchema.parse({
        contract: SOURCE_SYNC_TRANSITION_STORE_CONTRACT,
        updatedAt: transition.createdAt,
        transitions: [
          ...(existing.status === "ready"
            ? existing.value.transitions.filter(
                (item) => item.source !== transition.source
              )
            : []),
          transition
        ].sort((left, right) =>
          left.source.localeCompare(right.source)
        )
      });
      await ensurePrivateDirectory(this.directory);
      await writePrivateJson(
        join(this.directory, "transitions.json"),
        transitions
      );
      return recoveredLatest.status === "ready"
        ? recoveredLatest.value
        : null;
    });
  }

  async completeTransition(
    latestInput: SourceSyncLatestStore,
    transitionInput: SourceSyncTransition
  ): Promise<SourceSyncLatestStore> {
    const latest = sourceSyncLatestStoreSchema.parse(latestInput);
    const transition =
      sourceSyncTransitionSchema.parse(transitionInput);

    return this.withMutation(async () => {
      const recoveredPendingSettlement =
        await this.requirePendingSettlementReconciled();
      const [
        existingLatest,
        existingHistory,
        existingTransitions
      ] =
        await Promise.all([
          readValidatedJson(
            join(this.directory, "latest.json"),
            sourceSyncLatestStoreSchema
          ),
          readValidatedJson(
            join(this.directory, "history.json"),
            sourceSyncHistoryStoreSchema
          ),
          readValidatedJson(
            join(this.directory, "transitions.json"),
            sourceSyncTransitionStoreSchema
          )
        ]);
      if (
        existingLatest.status === "invalid" ||
        existingHistory.status === "invalid" ||
        existingTransitions.status === "invalid"
      ) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      if (
        recoveredPendingSettlement &&
        existingLatest.status !== "ready"
      ) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const pending =
        existingTransitions.status === "ready"
          ? existingTransitions.value.transitions.find(
              (item) =>
                item.source === transition.source &&
                item.transitionId === transition.transitionId
            )
          : undefined;
      if (!pending) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const authoritativeBase =
        existingLatest.status === "ready"
          ? existingLatest.value
          : latest;
      const sourceMergedLatest =
        sourceSyncLatestStoreSchema.parse({
          ...authoritativeBase,
          updatedAt: latest.updatedAt,
          sources: {
            ...authoritativeBase.sources,
            [transition.source]: latest.sources[transition.source]
          }
        });
      const protectedLatest = sourceSyncLatestStoreSchema.parse({
        ...sourceMergedLatest,
        sources:
          existingTransitions.status === "ready"
            ? existingTransitions.value.transitions.reduce(
                (sources, item) => ({
                  ...sources,
                  [item.source]: item.targetState
                }),
                sourceMergedLatest.sources
              )
            : sourceMergedLatest.sources
      });

      const existingAttempts =
        existingHistory.status === "ready"
          ? existingHistory.value.attempts
          : [];
      const attempts =
        transition.kind === "reset_lineage"
          ? existingAttempts.filter(
              (attempt) => attempt.source !== transition.source
            )
          : mergeAttemptIntoHistory(
              existingAttempts,
              transition.attempt!,
              this.maxHistory
            );
      const history = sourceSyncHistoryStoreSchema.parse({
        contract: SOURCE_SYNC_HISTORY_STORE_CONTRACT,
        updatedAt: protectedLatest.updatedAt,
        attempts
      });
      const transitions = sourceSyncTransitionStoreSchema.parse({
        contract: SOURCE_SYNC_TRANSITION_STORE_CONTRACT,
        updatedAt: protectedLatest.updatedAt,
        transitions:
          existingTransitions.status === "ready"
            ? existingTransitions.value.transitions.filter(
                (item) =>
                  item.transitionId !== transition.transitionId
              )
            : []
      });

      await ensurePrivateDirectory(this.directory);
      try {
        // The intent is cleared last. A crash or partial write therefore
        // leaves a durable, idempotently replayable transition.
        await writePrivateJson(
          join(this.directory, "history.json"),
          history
        );
        await writePrivateJson(
          join(this.directory, "latest.json"),
          protectedLatest
        );
        await writePrivateJson(
          join(this.directory, "transitions.json"),
          transitions,
          {
            afterRename: () =>
              this.injectFault("transition_clear_after_rename")
          }
        );
      } catch (error) {
        if (error instanceof SourceSyncRepositoryError) throw error;
        throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
      }
      return protectedLatest;
    });
  }

  async updateTransition(
    transitionInput: SourceSyncTransition
  ): Promise<SourceSyncLatestStore | null> {
    const transition =
      sourceSyncTransitionSchema.parse(transitionInput);
    return this.withMutation(async () => {
      const recoveredPendingSettlement =
        await this.requirePendingSettlementReconciled();
      const [existing, recoveredLatest] = await Promise.all([
        readValidatedJson(
          join(this.directory, "transitions.json"),
          sourceSyncTransitionStoreSchema
        ),
        recoveredPendingSettlement
          ? readValidatedJson(
              join(this.directory, "latest.json"),
              sourceSyncLatestStoreSchema
            )
          : Promise.resolve({ status: "missing" } as const)
      ]);
      if (existing.status !== "ready") {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      if (recoveredLatest.status === "invalid") {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      if (
        recoveredPendingSettlement &&
        recoveredLatest.status !== "ready"
      ) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const hasTransition = existing.value.transitions.some(
        (item) =>
          item.source === transition.source &&
          item.transitionId === transition.transitionId
      );
      if (!hasTransition) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const next = sourceSyncTransitionStoreSchema.parse({
        ...existing.value,
        updatedAt: transition.retryAt,
        transitions: existing.value.transitions.map((item) =>
          item.transitionId === transition.transitionId
            ? transition
            : item
        )
      });
      await ensurePrivateDirectory(this.directory);
      await writePrivateJson(
        join(this.directory, "transitions.json"),
        next
      );
      return recoveredLatest.status === "ready"
        ? recoveredLatest.value
        : null;
    });
  }

  private async reconcilePendingSettlement(): Promise<
    SourceSyncStoreReadResult<SourceSyncSettlementStore>
  > {
    const stored = await readValidatedJson(
      join(this.directory, "settlements.json"),
      sourceSyncSettlementStoreSchema
    );
    if (
      stored.status !== "ready" ||
      stored.value.settlement === null
    ) {
      return stored;
    }
    try {
      await ensurePrivateDirectory(this.directory);
      await this.applySettlement(stored.value.settlement);
    } catch {
      return { status: "invalid", reason: "read_failed" };
    }
    const reconciled = await readValidatedJson(
      join(this.directory, "settlements.json"),
      sourceSyncSettlementStoreSchema
    );
    if (
      reconciled.status !== "ready" ||
      reconciled.value.settlement !== null
    ) {
      return { status: "invalid", reason: "read_failed" };
    }
    return reconciled;
  }

  private async requirePendingSettlementReconciled(): Promise<boolean> {
    const before = await readValidatedJson(
      join(this.directory, "settlements.json"),
      sourceSyncSettlementStoreSchema
    );
    if (before.status === "invalid") {
      throw new SourceSyncRepositoryError("STORE_READ_FAILED");
    }
    const recovered =
      before.status === "ready" &&
      before.value.settlement !== null;
    const settlement = await this.reconcilePendingSettlement();
    if (settlement.status === "invalid") {
      throw new SourceSyncRepositoryError("STORE_READ_FAILED");
    }
    return recovered;
  }

  private async tryConfirmSettlement(
    settlement: SourceSyncSettlement
  ): Promise<boolean> {
    const reconciled = await this.reconcilePendingSettlement();
    if (
      reconciled.status !== "ready" ||
      reconciled.value.settlement !== null
    ) {
      return false;
    }
    const [latest, history] = await Promise.all([
      readValidatedJson(
        join(this.directory, "latest.json"),
        sourceSyncLatestStoreSchema
      ),
      readValidatedJson(
        join(this.directory, "history.json"),
        sourceSyncHistoryStoreSchema
      )
    ]);
    return (
      latest.status === "ready" &&
      history.status === "ready" &&
      sameValue(latest.value, settlement.latest) &&
      sameValue(history.value, settlement.history)
    );
  }

  private async applySettlement(
    settlementInput: SourceSyncSettlement
  ): Promise<void> {
    const settlement =
      sourceSyncSettlementSchema.parse(settlementInput);
    const transitions = await readValidatedJson(
      join(this.directory, "transitions.json"),
      sourceSyncTransitionStoreSchema
    );
    if (transitions.status === "invalid") {
      throw new SourceSyncRepositoryError("STORE_READ_FAILED");
    }
    if (
      transitions.status === "ready" &&
      transitions.value.transitions.some(
        (transition) =>
          !sameValue(
            settlement.latest.sources[transition.source],
            transition.targetState
          )
      )
    ) {
      // A normal attempt may settle alongside another source's pending
      // transition only when its exact protected target was journaled.
      throw new SourceSyncRepositoryError("STORE_READ_FAILED");
    }
    assertLatestHistoryCoherent(
      settlement.latest,
      settlement.history,
      new Set(
        transitions.status === "ready"
          ? transitions.value.transitions.map(
              (transition) => transition.source
            )
          : []
      )
    );

    await writePrivateJson(
      join(this.directory, "history.json"),
      settlement.history
    );
    await this.injectFault("commit_after_history");
    await writePrivateJson(
      join(this.directory, "latest.json"),
      settlement.latest
    );
    await writePrivateJson(
      join(this.directory, "settlements.json"),
      sourceSyncSettlementStoreSchema.parse({
        contract: SOURCE_SYNC_SETTLEMENT_STORE_CONTRACT,
        updatedAt: settlement.latest.updatedAt,
        settlement: null
      })
    );
  }

  private async injectFault(
    point: SourceSyncRepositoryFaultPoint
  ): Promise<void> {
    await this.faultInjector?.(point);
  }

  private withMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(mutation, mutation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

export class MemorySourceSyncRepository
  implements SourceSyncRepository
{
  private latest:
    | SourceSyncStoreReadResult<SourceSyncLatestStore>
    | undefined;
  private history:
    | SourceSyncStoreReadResult<SourceSyncHistoryStore>
    | undefined;
  private transitions:
    | SourceSyncStoreReadResult<SourceSyncTransitionStore>
    | undefined;
  private settlements:
    | SourceSyncStoreReadResult<SourceSyncSettlementStore>
    | undefined;
  private mutationTail: Promise<unknown> = Promise.resolve();
  private readonly maxHistory: number;

  constructor(options: {
    latest?: SourceSyncStoreReadResult<SourceSyncLatestStore>;
    history?: SourceSyncStoreReadResult<SourceSyncHistoryStore>;
    transitions?: SourceSyncStoreReadResult<SourceSyncTransitionStore>;
    settlements?: SourceSyncStoreReadResult<SourceSyncSettlementStore>;
    maxHistory?: number;
  } = {}) {
    this.latest = options.latest;
    this.history = options.history;
    this.transitions = options.transitions;
    this.settlements = options.settlements;
    this.maxHistory = parseHistoryLimit(options.maxHistory);
  }

  async read(): Promise<SourceSyncRepositorySnapshot> {
    return {
      latest: cloneReadResult(this.latest ?? { status: "missing" }),
      history: cloneReadResult(this.history ?? { status: "missing" }),
      transitions: cloneReadResult(
        this.transitions ?? { status: "missing" }
      ),
      settlements: cloneReadResult(
        this.settlements ?? { status: "missing" }
      )
    };
  }

  async recoverPendingSettlement(): Promise<SourceSyncLatestStore | null> {
    return null;
  }

  async commit(
    latestInput: SourceSyncLatestStore,
    attemptInput: SourceSyncAttempt
  ): Promise<SourceSyncLatestStore> {
    const latest = sourceSyncLatestStoreSchema.parse(latestInput);
    const attempt = sourceSyncAttemptSchema.parse(attemptInput);
    return this.withMutation(async () => {
      const pending =
        this.transitions?.status === "ready"
          ? this.transitions.value.transitions
          : [];
      if (
        pending.some(
          (transition) => transition.source === attempt.source
        )
      ) {
        throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
      }
      const protectedLatest = sourceSyncLatestStoreSchema.parse({
        ...latest,
        sources: pending.reduce(
          (sources, transition) => ({
            ...sources,
            [transition.source]: transition.targetState
          }),
          latest.sources
        )
      });
      const existing =
        this.history?.status === "ready"
          ? this.history.value.attempts
          : [];
      const history = sourceSyncHistoryStoreSchema.parse({
        contract: SOURCE_SYNC_HISTORY_STORE_CONTRACT,
        updatedAt: protectedLatest.updatedAt,
        attempts: mergeAttemptIntoHistory(
          existing,
          attempt,
          this.maxHistory
        )
      });
      this.history = {
        status: "ready",
        value: history
      };
      this.latest = {
        status: "ready",
        value: protectedLatest
      };
      return protectedLatest;
    });
  }

  async beginTransition(
    transitionInput: SourceSyncTransition
  ): Promise<SourceSyncLatestStore | null> {
    const transition =
      sourceSyncTransitionSchema.parse(transitionInput);
    return this.withMutation(async () => {
      const existing =
        this.transitions?.status === "ready"
          ? this.transitions.value.transitions
          : [];
      if (
        existing.some(
          (item) => item.source === transition.source
        )
      ) {
        throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
      }
      this.transitions = {
        status: "ready",
        value: sourceSyncTransitionStoreSchema.parse({
          contract: SOURCE_SYNC_TRANSITION_STORE_CONTRACT,
          updatedAt: transition.createdAt,
          transitions: [
            ...existing.filter(
              (item) => item.source !== transition.source
            ),
            transition
          ].sort((left, right) =>
            left.source.localeCompare(right.source)
          )
        })
      };
      return null;
    });
  }

  async completeTransition(
    latestInput: SourceSyncLatestStore,
    transitionInput: SourceSyncTransition
  ): Promise<SourceSyncLatestStore> {
    const latest = sourceSyncLatestStoreSchema.parse(latestInput);
    const transition =
      sourceSyncTransitionSchema.parse(transitionInput);
    return this.withMutation(async () => {
      const pending =
        this.transitions?.status === "ready"
          ? this.transitions.value.transitions.find(
              (item) =>
                item.source === transition.source &&
                item.transitionId === transition.transitionId
            )
          : undefined;
      if (!pending) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const protectedLatest = sourceSyncLatestStoreSchema.parse({
        ...latest,
        sources:
          this.transitions?.status === "ready"
            ? this.transitions.value.transitions.reduce(
                (sources, item) => ({
                  ...sources,
                  [item.source]: item.targetState
                }),
                latest.sources
              )
            : latest.sources
      });
      const existing =
        this.history?.status === "ready"
          ? this.history.value.attempts
          : [];
      const attempts =
        transition.kind === "reset_lineage"
          ? existing.filter(
              (attempt) => attempt.source !== transition.source
            )
          : mergeAttemptIntoHistory(
              existing,
              transition.attempt!,
              this.maxHistory
            );
      this.history = {
        status: "ready",
        value: sourceSyncHistoryStoreSchema.parse({
          contract: SOURCE_SYNC_HISTORY_STORE_CONTRACT,
          updatedAt: protectedLatest.updatedAt,
          attempts
        })
      };
      this.latest = {
        status: "ready",
        value: protectedLatest
      };
      this.transitions = {
        status: "ready",
        value: sourceSyncTransitionStoreSchema.parse({
          contract: SOURCE_SYNC_TRANSITION_STORE_CONTRACT,
          updatedAt: protectedLatest.updatedAt,
          transitions:
            this.transitions?.status === "ready"
              ? this.transitions.value.transitions.filter(
                  (item) =>
                    item.transitionId !== transition.transitionId
                )
              : []
        })
      };
      return protectedLatest;
    });
  }

  async updateTransition(
    transitionInput: SourceSyncTransition
  ): Promise<SourceSyncLatestStore | null> {
    const transition =
      sourceSyncTransitionSchema.parse(transitionInput);
    return this.withMutation(async () => {
      if (this.transitions?.status !== "ready") {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      const hasTransition = this.transitions.value.transitions.some(
        (item) =>
          item.source === transition.source &&
          item.transitionId === transition.transitionId
      );
      if (!hasTransition) {
        throw new SourceSyncRepositoryError("STORE_READ_FAILED");
      }
      this.transitions = {
        status: "ready",
        value: sourceSyncTransitionStoreSchema.parse({
          ...this.transitions.value,
          updatedAt: transition.retryAt,
          transitions: this.transitions.value.transitions.map((item) =>
            item.transitionId === transition.transitionId
              ? transition
              : item
          )
        })
      };
      return null;
    });
  }

  private withMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(mutation, mutation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function parseHistoryLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_SOURCE_SYNC_HISTORY_LIMIT;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SOURCE_SYNC_HISTORY_HARD_LIMIT
  ) {
    throw new SourceSyncRepositoryError("INVALID_HISTORY_LIMIT");
  }
  return limit;
}

function mergeAttemptIntoHistory(
  existing: readonly SourceSyncAttempt[],
  attempt: SourceSyncAttempt,
  maxHistory: number
): SourceSyncAttempt[] {
  const ordered = [
    attempt,
    ...existing.filter((item) => item.attemptId !== attempt.attemptId)
  ].sort(compareSyncAttempts);
  if (ordered.length <= maxHistory) return ordered;

  const bounded = ordered.slice(0, maxHistory);
  if (bounded.some((item) => item.attemptId === attempt.attemptId)) {
    return bounded;
  }
  // A clock regression must not make the attempt being settled disappear
  // from its own audit entry. Keep it and deterministically drop the oldest
  // retained predecessor instead.
  return [...bounded.slice(0, maxHistory - 1), attempt].sort(
    compareSyncAttempts
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertLatestHistoryCoherent(
  latest: SourceSyncLatestStore,
  history: SourceSyncHistoryStore,
  protectedSources: ReadonlySet<SourceSyncAttempt["source"]>
): void {
  for (const source of Object.keys(
    latest.sources
  ) as SourceSyncAttempt["source"][]) {
    if (protectedSources.has(source)) continue;
    const stateAttempt = latest.sources[source].lastAttempt;
    const sourceAttempts = history.attempts.filter(
      (attempt) => attempt.source === source
    );
    if (stateAttempt === null && sourceAttempts.length > 0) {
      throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
    }
    if (stateAttempt === null) continue;
    const matchingAttempt = sourceAttempts.find(
      (attempt) => attempt.attemptId === stateAttempt.attemptId
    );
    if (
      matchingAttempt &&
      !sameValue(matchingAttempt, stateAttempt)
    ) {
      throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
    }
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  } catch {
    throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
  }
}

async function writePrivateJson(
  target: string,
  value: unknown,
  options: { afterRename?: () => void | Promise<void> } = {}
): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = safePrettyJson(value);
  let renamed = false;
  try {
    await writeFile(temporary, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    renamed = true;
    await options.afterRename?.();
    await chmod(target, 0o600);
  } catch {
    if (
      renamed &&
      (await isExactPrivateFile(target, serialized))
    ) {
      // rename() is the commit point. A post-rename chmod or injected fault
      // is an ambiguous acknowledgement, not a failed write, when read-back
      // proves the exact 0600 target is already durable.
      return;
    }
    try {
      await unlink(temporary);
    } catch {
      // Rename may already have moved the temporary file.
    }
    throw new SourceSyncRepositoryError("STORE_WRITE_FAILED");
  }
}

async function isExactPrivateFile(
  target: string,
  expected: string
): Promise<boolean> {
  try {
    const [actual, metadata] = await Promise.all([
      readFile(target, "utf8"),
      stat(target)
    ]);
    return (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      (metadata.mode & 0o777) === 0o600 &&
      actual === expected
    );
  } catch {
    return false;
  }
}

async function readValidatedJson<T>(
  path: string,
  schema: {
    safeParse(value: unknown):
      | { success: true; data: T }
      | { success: false };
  }
): Promise<SourceSyncStoreReadResult<T>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { status: "missing" };
    }
    return { status: "invalid", reason: "read_failed" };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { status: "invalid", reason: "invalid_json" };
  }
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { status: "ready", value: parsed.data }
    : { status: "invalid", reason: "schema_mismatch" };
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function cloneReadResult<T>(
  result: SourceSyncStoreReadResult<T>
): SourceSyncStoreReadResult<T> {
  if (result.status !== "ready") return { ...result };
  return {
    status: "ready",
    value: structuredClone(result.value)
  };
}
