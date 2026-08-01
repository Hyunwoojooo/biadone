import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ZodType } from "zod";

import { observeCodexManagedNotification } from "../connectors/codex/observationContract";
import {
  CODEX_MANAGED_EVENT_HARD_LIMIT,
  CODEX_MANAGED_LATEST_STORE_CONTRACT,
  CODEX_MANAGED_RETENTION_DAYS,
  CODEX_MANAGED_RETENTION_POLICY_VERSION,
  CODEX_MANAGED_RUN_REGISTRY_CONTRACT,
  beginManagedCodexRunInputSchema,
  createEmptyManagedCodexHistory,
  createEmptyManagedCodexLatest,
  createEmptyManagedCodexRegistry,
  createManagedCodexEvent,
  createManagedCodexSettlement,
  managedCodexEventHistorySchema,
  managedCodexLatestStoreSchema,
  managedCodexOwnershipIdentitySchema,
  managedCodexPrivateProjectionSchema,
  managedCodexPrivateRunSchema,
  managedCodexPublicProjectionSchema,
  managedCodexRunIdSchema,
  managedCodexRunRegistrySchema,
  managedCodexSettlementSchema,
  managedCodexStreamEventKindSchema,
  opaqueExecutionId,
  projectionHeadMatchesHistory,
  publicProjectionFromPrivate,
  sealManagedCodexHistory,
  sealManagedCodexLatest,
  sealManagedCodexRegistry,
  type BeginManagedCodexRunInput,
  type ManagedCodexEventHistory,
  type ManagedCodexLatestStore,
  type ManagedCodexOwnershipIdentity,
  type ManagedCodexPrivateProjection,
  type ManagedCodexPublicProjection,
  type ManagedCodexPublicRunProjection,
  type ManagedCodexRunRegistry,
  type ManagedCodexSettlement
} from "./contracts";
import {
  buildManagedCodexSemanticProjection,
  type ManagedCodexSemanticProjection
} from "./semanticTimeline";

const REGISTRY_FILENAME = "registry.json";
const LATEST_FILENAME = "latest.json";
const SETTLEMENT_FILENAME = "settlement.json";
const EVENTS_DIRECTORY = "events";
const LOCKS_DIRECTORY = "locks";
const STATE_LOCK_NAME = "state";
const FILESYSTEM_LOCK_STALE_MS = 30_000;
const FILESYSTEM_LOCK_WAIT_MS = 35_000;
const FILESYSTEM_LOCK_RETRY_MS = 20;

const mutationQueues = new Map<string, Promise<unknown>>();

type PrivateReadResult<T> =
  | { status: "available"; value: T }
  | { status: "missing" }
  | { status: "invalid" };

export class ManagedCodexStoreError extends Error {
  constructor(
    public readonly code:
      | "STORE_INVALID"
      | "STORE_READ_FAILED"
      | "STORE_WRITE_FAILED"
      | "RUN_NOT_FOUND"
      | "RUN_ALREADY_ACTIVE"
      | "OWNER_MISMATCH"
      | "STREAM_GENERATION_MISMATCH"
      | "STREAM_NOT_CONNECTED"
      | "INVALID_STREAM_TRANSITION"
      | "RUN_TERMINAL"
      | "NOTIFICATION_INVALID"
      | "LOCK_ACQUISITION_FAILED"
  ) {
    super(code);
    this.name = "ManagedCodexStoreError";
  }
}

export type AppendManagedCodexNotificationInput = {
  managedRunId: string;
  ownerInstanceId: string;
  expectedThreadId: string;
  notification: unknown;
  observedAt: string;
};

export type AppendManagedCodexStreamEventInput = {
  managedRunId: string;
  ownerInstanceId: string;
  streamGeneration: string;
  kind:
    | "stream_connected"
    | "stream_reconnected"
    | "stream_disconnected"
    | "run_failed"
    | "run_closed";
  observedAt: string;
};

export function managedCodexLocalDirectory(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "connectors", "codex", "managed");
}

export async function beginManagedCodexRun(
  inputRaw: BeginManagedCodexRunInput,
  cwd = process.cwd()
): Promise<ManagedCodexPublicRunProjection> {
  const input = beginManagedCodexRunInputSchema.parse(inputRaw);
  return withManagedCodexMutation(cwd, async () => {
    await recoverPendingSettlement(cwd);
    const current = await readStores(cwd, input.startedAt);
    assertRegistryLatestCoherent(current.registry, current.latest);
    if (
      current.latest.runs.some(
        (run) =>
          run.lifecycle !== "terminal" &&
          (run.bindingId === input.bindingId ||
            run.executionId === input.executionId)
      )
    ) {
      throw new ManagedCodexStoreError("RUN_ALREADY_ACTIVE");
    }

    const managedRunId = `managed_run_${randomBytes(16).toString(
      "hex"
    )}`;
    const privateRun = managedCodexPrivateRunSchema.parse({
      managedRunId,
      bindingId: input.bindingId,
      executionId: input.executionId,
      scopeId: input.scopeId,
      connectionGeneration: input.connectionGeneration,
      ownerInstanceId: input.ownerInstanceId,
      initialStreamGeneration: input.streamGeneration,
      startedAt: input.startedAt,
      startedBy: input.startedBy,
      ownership: input.ownership,
      retentionPolicyVersion:
        CODEX_MANAGED_RETENTION_POLICY_VERSION,
      retentionDays: CODEX_MANAGED_RETENTION_DAYS
    });
    const projection = managedCodexPrivateProjectionSchema.parse({
      managedRunId,
      bindingId: input.bindingId,
      executionId: input.executionId,
      scopeId: input.scopeId,
      connectionGeneration: input.connectionGeneration,
      ownerInstanceId: input.ownerInstanceId,
      currentStreamGeneration: input.streamGeneration,
      startedAt: input.startedAt,
      lifecycle: "starting",
      streamState: "connecting",
      continuity: "unverified",
      lastVerifiedExecutionState: "unknown",
      waitingState: null,
      sourceEvent: "run_started",
      itemType: null,
      lastObservedAt: input.startedAt,
      lastEventSequence: -1,
      headEventSha256: null,
      endedAt: null
    });
    const registry = sealManagedCodexRegistry({
      contract: CODEX_MANAGED_RUN_REGISTRY_CONTRACT,
      revision: current.registry.revision + 1,
      updatedAt: input.startedAt,
      runs: [...current.registry.runs, privateRun]
    });
    const latest = sealManagedCodexLatest({
      contract: CODEX_MANAGED_LATEST_STORE_CONTRACT,
      revision: current.latest.revision + 1,
      updatedAt: input.startedAt,
      runs: [...current.latest.runs, projection]
    });
    const history = createEmptyManagedCodexHistory({
      managedRunId,
      updatedAt: input.startedAt
    });
    await commitSettlement(
      createManagedCodexSettlement({
        managedRunId,
        createdAt: input.startedAt,
        registry,
        latest,
        history
      }),
      cwd
    );
    return publicProjectionFromPrivate({
      projection,
      activeOwnerInstanceId: input.ownerInstanceId,
      ownershipCurrent: true
    });
  });
}

export async function appendManagedCodexNotification(
  input: AppendManagedCodexNotificationInput,
  cwd = process.cwd()
): Promise<ManagedCodexPublicRunProjection> {
  const managedRunId = managedCodexRunIdSchema.parse(
    input.managedRunId
  );
  const observedAt = parseTimestamp(input.observedAt);
  return withManagedCodexMutation(cwd, async () => {
    await recoverPendingSettlement(cwd);
    const stores = await readStores(cwd, observedAt);
    const run = requireRun(stores.registry, managedRunId);
    const projection = requireProjection(stores.latest, managedRunId);
    assertRunProjectionIdentity(run, projection);
    assertOwner(projection, input.ownerInstanceId);
    if (projection.lifecycle === "terminal") {
      throw new ManagedCodexStoreError("RUN_TERMINAL");
    }
    if (projection.streamState !== "connected") {
      throw new ManagedCodexStoreError("STREAM_NOT_CONNECTED");
    }
    const history = await readHistory(managedRunId, cwd);
    assertProjectionHistoryCoherent(projection, history);
    const sequence = nextHistorySequence(history);

    let observation;
    try {
      observation = observeCodexManagedNotification({
        notification: input.notification,
        executionId: opaqueExecutionId(run.executionId),
        expectedThreadId: input.expectedThreadId,
        observedAt,
        sequence
      });
    } catch {
      throw new ManagedCodexStoreError("NOTIFICATION_INVALID");
    }
    const event = createManagedCodexEvent({
      managedRunId,
      sequence,
      ownerInstanceId: projection.ownerInstanceId,
      streamGeneration: projection.currentStreamGeneration,
      observedAt,
      retentionAt: nextRetentionAt(history, observedAt),
      kind: "native_notification",
      streamKind: null,
      observation,
      itemType: normalizedItemType(input.notification),
      previousEventSha256: historyHeadHash(history)
    });
    const nextHistory = appendManagedCodexEventToHistory(
      history,
      event,
      observedAt
    );
    const nextProjection = managedCodexPrivateProjectionSchema.parse({
      ...projection,
      lifecycle: "active",
      lastVerifiedExecutionState: observation.executionState,
      waitingState: observation.waitingState,
      sourceEvent: observation.sourceEvent,
      itemType: event.itemType,
      lastObservedAt: observedAt,
      lastEventSequence: event.sequence,
      headEventSha256: event.eventSha256,
      endedAt: null
    });
    const latest = replaceProjection(
      stores.latest,
      nextProjection,
      observedAt
    );
    await commitSettlement(
      createManagedCodexSettlement({
        managedRunId,
        createdAt: observedAt,
        registry: stores.registry,
        latest,
        history: nextHistory
      }),
      cwd
    );
    return publicProjectionFromPrivate({
      projection: nextProjection,
      activeOwnerInstanceId: input.ownerInstanceId,
      ownershipCurrent: true
    });
  });
}

export async function appendManagedCodexStreamEvent(
  inputRaw: AppendManagedCodexStreamEventInput,
  cwd = process.cwd()
): Promise<ManagedCodexPublicRunProjection> {
  const input = {
    managedRunId: managedCodexRunIdSchema.parse(
      inputRaw.managedRunId
    ),
    ownerInstanceId: parseOwnerInstanceId(inputRaw.ownerInstanceId),
    streamGeneration: parseStreamGeneration(
      inputRaw.streamGeneration
    ),
    kind: managedCodexStreamEventKindSchema.parse(inputRaw.kind),
    observedAt: parseTimestamp(inputRaw.observedAt)
  };
  return withManagedCodexMutation(cwd, async () => {
    await recoverPendingSettlement(cwd);
    const stores = await readStores(cwd, input.observedAt);
    const run = requireRun(stores.registry, input.managedRunId);
    const projection = requireProjection(
      stores.latest,
      input.managedRunId
    );
    assertRunProjectionIdentity(run, projection);
    assertOwner(projection, input.ownerInstanceId);
    assertStreamTransition(projection, input);
    const history = await readHistory(input.managedRunId, cwd);
    assertProjectionHistoryCoherent(projection, history);
    const sequence = nextHistorySequence(history);
    const event = createManagedCodexEvent({
      managedRunId: input.managedRunId,
      sequence,
      ownerInstanceId: input.ownerInstanceId,
      streamGeneration: input.streamGeneration,
      observedAt: input.observedAt,
      retentionAt: nextRetentionAt(history, input.observedAt),
      kind: "stream_lifecycle",
      streamKind: input.kind,
      observation: null,
      itemType: null,
      previousEventSha256: historyHeadHash(history)
    });
    const nextHistory = appendManagedCodexEventToHistory(
      history,
      event,
      input.observedAt
    );
    const nextProjection = projectionAfterStreamEvent(
      projection,
      event.sequence,
      event.eventSha256,
      input
    );
    const latest = replaceProjection(
      stores.latest,
      nextProjection,
      input.observedAt
    );
    await commitSettlement(
      createManagedCodexSettlement({
        managedRunId: input.managedRunId,
        createdAt: input.observedAt,
        registry: stores.registry,
        latest,
        history: nextHistory
      }),
      cwd
    );
    return publicProjectionFromPrivate({
      projection: nextProjection,
      activeOwnerInstanceId: input.ownerInstanceId,
      ownershipCurrent: true
    });
  });
}

export async function readManagedCodexPublicProjection(
  input: {
    activeOwnerInstanceId: string | null;
    activeOwnerships: ManagedCodexOwnershipIdentity[];
    now: Date;
  },
  cwd = process.cwd()
): Promise<ManagedCodexPublicProjection> {
  const read = await readManagedCodexContext(input, cwd);
  return read.projection;
}

export type ManagedCodexObservability = {
  projection: ManagedCodexPublicProjection;
  semantics: ManagedCodexSemanticProjection;
};

export async function readManagedCodexObservability(
  input: {
    activeOwnerInstanceId: string | null;
    activeOwnerships: ManagedCodexOwnershipIdentity[];
    now: Date;
  },
  cwd = process.cwd()
): Promise<ManagedCodexObservability> {
  const read = await readManagedCodexContext(input, cwd);
  return {
    projection: read.projection,
    semantics: read.semantics
  };
}

type ManagedCodexReadContext = {
  projection: ManagedCodexPublicProjection;
  histories: ManagedCodexEventHistory[];
  semantics: ManagedCodexSemanticProjection;
};

async function readManagedCodexContext(
  input: {
    activeOwnerInstanceId: string | null;
    activeOwnerships: ManagedCodexOwnershipIdentity[];
    now: Date;
  },
  cwd: string
): Promise<ManagedCodexReadContext> {
  const generatedAt = input.now.toISOString();
  const activeOwnerInstanceId =
    input.activeOwnerInstanceId === null
      ? null
      : parseOwnerInstanceId(input.activeOwnerInstanceId);
  const activeOwnerships = input.activeOwnerships.map((identity) =>
    managedCodexOwnershipIdentitySchema.parse(identity)
  );
  return withManagedCodexMutation(cwd, async () => {
    await recoverPendingSettlement(cwd);
    let stores = await readStores(cwd, generatedAt);
    assertRegistryLatestCoherent(stores.registry, stores.latest);

    for (const projection of [...stores.latest.runs]) {
      const run = requireRun(stores.registry, projection.managedRunId);
      const history = await readHistory(projection.managedRunId, cwd);
      assertProjectionHistoryCoherent(projection, history);
      const cutoff = retentionCutoff(input.now);
      const latestEvent = history.events.at(-1);
      const retentionReference =
        latestEvent?.retentionAt ?? run.startedAt;
      const terminalExpired =
        projection.lifecycle === "terminal" &&
        projection.endedAt !== null &&
        Date.parse(projection.endedAt) < cutoff;
      const nonterminalExpired =
        projection.lifecycle !== "terminal" &&
        Date.parse(retentionReference) < cutoff;

      if (terminalExpired || nonterminalExpired) {
        const registry = sealManagedCodexRegistry({
          contract: CODEX_MANAGED_RUN_REGISTRY_CONTRACT,
          revision: stores.registry.revision + 1,
          updatedAt: generatedAt,
          runs: stores.registry.runs.filter(
            (item) => item.managedRunId !== projection.managedRunId
          )
        });
        const latest = sealManagedCodexLatest({
          contract: CODEX_MANAGED_LATEST_STORE_CONTRACT,
          revision: stores.latest.revision + 1,
          updatedAt: generatedAt,
          runs: stores.latest.runs.filter(
            (item) => item.managedRunId !== projection.managedRunId
          )
        });
        await commitSettlement(
          createManagedCodexSettlement({
            managedRunId: projection.managedRunId,
            createdAt: generatedAt,
            registry,
            latest,
            history: null
          }),
          cwd
        );
        stores = { registry, latest };
        continue;
      }

      const prunedHistory = pruneHistory(
        history,
        input.now,
        generatedAt
      );
      const nextProjection = projection;
      if (
        JSON.stringify(prunedHistory) !== JSON.stringify(history) ||
        nextProjection !== projection
      ) {
        const latest = replaceProjection(
          stores.latest,
          nextProjection,
          generatedAt
        );
        await commitSettlement(
          createManagedCodexSettlement({
            managedRunId: projection.managedRunId,
            createdAt: generatedAt,
            registry: stores.registry,
            latest,
            history: prunedHistory
          }),
          cwd
        );
        stores = { registry: stores.registry, latest };
      }
    }

    const registry = stores.registry;
    const latest = stores.latest;
    assertRegistryLatestCoherent(registry, latest);
    const projection = managedCodexPublicProjectionSchema.parse({
      contract: "codex-managed-public-projection-v1",
      revision: latest.revision,
      generatedAt,
      runs: [...latest.runs]
        .sort(
          (left, right) =>
            Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
            left.managedRunId.localeCompare(right.managedRunId)
        )
        .map((projection) =>
          publicProjectionFromPrivate({
            projection,
            activeOwnerInstanceId,
            ownershipCurrent: activeOwnerships.some((identity) =>
              managedOwnershipMatchesProjection(identity, projection)
            )
          })
        )
    });
    const histories = await Promise.all(
      projection.runs.map((run) =>
        readHistory(run.managedRunId, cwd)
      )
    );
    histories.forEach((history, index) => {
      const run = projection.runs[index];
      const privateProjection = run
        ? latest.runs.find(
            (item) => item.managedRunId === run.managedRunId
          )
        : null;
      if (!privateProjection) {
        throw new ManagedCodexStoreError("STORE_INVALID");
      }
      assertProjectionHistoryCoherent(privateProjection, history);
    });
    const semantics = buildManagedCodexSemanticProjection({
      sourceRevision: projection.revision,
      generatedAt: projection.generatedAt,
      runs: projection.runs.map((run, index) => {
        const history = histories[index];
        if (!history) {
          throw new ManagedCodexStoreError("STORE_INVALID");
        }
        return { run, history };
      })
    });
    return { projection, histories, semantics };
  });
}

export async function clearManagedCodexState(
  cwd = process.cwd()
): Promise<void> {
  await withManagedCodexMutation(cwd, async () => {
    const directory = managedCodexLocalDirectory(cwd);
    await Promise.all([
      unlink(join(directory, REGISTRY_FILENAME)).catch(ignoreMissing),
      unlink(join(directory, LATEST_FILENAME)).catch(ignoreMissing),
      unlink(join(directory, SETTLEMENT_FILENAME)).catch(ignoreMissing),
      rm(join(directory, EVENTS_DIRECTORY), {
        recursive: true,
        force: true
      })
    ]);
  });
}

function projectionAfterStreamEvent(
  projection: ManagedCodexPrivateProjection,
  sequence: number,
  eventSha256: string,
  input: {
    kind: AppendManagedCodexStreamEventInput["kind"];
    streamGeneration: string;
    observedAt: string;
  }
): ManagedCodexPrivateProjection {
  const next = {
    ...projection,
    currentStreamGeneration: input.streamGeneration,
    lastEventSequence: sequence,
    headEventSha256: eventSha256
  };
  switch (input.kind) {
    case "stream_connected":
      return managedCodexPrivateProjectionSchema.parse({
        ...next,
        lifecycle: "active",
        streamState: "connected",
        continuity: "continuous",
        waitingState: null,
        sourceEvent: input.kind,
        itemType: null,
        lastObservedAt: input.observedAt
      });
    case "stream_reconnected":
      return managedCodexPrivateProjectionSchema.parse({
        ...next,
        lifecycle: "active",
        streamState: "connected",
        continuity: "gap_detected",
        waitingState: null,
        sourceEvent: input.kind,
        itemType: null,
        lastObservedAt: input.observedAt
      });
    case "stream_disconnected":
      return managedCodexPrivateProjectionSchema.parse({
        ...next,
        lifecycle: "active",
        streamState: "disconnected",
        continuity: "unverified",
        waitingState: null,
        sourceEvent: input.kind,
        itemType: null,
        lastObservedAt: input.observedAt
      });
    case "run_failed":
      return managedCodexPrivateProjectionSchema.parse({
        ...next,
        lifecycle: "terminal",
        streamState: "failed",
        waitingState: null,
        sourceEvent: input.kind,
        itemType: null,
        lastObservedAt: input.observedAt,
        endedAt: projection.endedAt ?? input.observedAt
      });
    case "run_closed":
      return managedCodexPrivateProjectionSchema.parse({
        ...next,
        lifecycle: "terminal",
        streamState: "closed",
        waitingState: null,
        sourceEvent: input.kind,
        itemType: null,
        lastObservedAt: input.observedAt,
        endedAt: projection.endedAt ?? input.observedAt
      });
  }
}

function assertStreamTransition(
  projection: ManagedCodexPrivateProjection,
  input: {
    kind: AppendManagedCodexStreamEventInput["kind"];
    streamGeneration: string;
  }
): void {
  if (input.kind === "stream_reconnected") {
    if (
      projection.lifecycle === "terminal" ||
      projection.streamState !== "disconnected" ||
      projection.currentStreamGeneration === input.streamGeneration
    ) {
      throw new ManagedCodexStoreError(
        "INVALID_STREAM_TRANSITION"
      );
    }
    return;
  }
  if (
    projection.currentStreamGeneration !== input.streamGeneration
  ) {
    throw new ManagedCodexStoreError(
      "STREAM_GENERATION_MISMATCH"
    );
  }
  if (input.kind === "stream_connected") {
    if (
      projection.lifecycle !== "starting" ||
      projection.streamState !== "connecting"
    ) {
      throw new ManagedCodexStoreError(
        "INVALID_STREAM_TRANSITION"
      );
    }
    return;
  }
  if (input.kind === "stream_disconnected") {
    if (
      projection.lifecycle !== "active" ||
      projection.streamState !== "connected"
    ) {
      throw new ManagedCodexStoreError(
        "INVALID_STREAM_TRANSITION"
      );
    }
    return;
  }
  if (input.kind === "run_closed") {
    if (projection.streamState === "closed") {
      throw new ManagedCodexStoreError(
        "INVALID_STREAM_TRANSITION"
      );
    }
    return;
  }
  if (projection.lifecycle === "terminal") {
    throw new ManagedCodexStoreError("RUN_TERMINAL");
  }
}

export function appendManagedCodexEventToHistory(
  history: ManagedCodexEventHistory,
  event: ReturnType<typeof createManagedCodexEvent>,
  nowIso: string
): ManagedCodexEventHistory {
  const events = [...history.events, event];
  const cutoff = retentionCutoff(new Date(nowIso));
  let timePrefix = 0;
  while (
    timePrefix < events.length &&
    Date.parse(events[timePrefix]!.retentionAt) < cutoff
  ) {
    timePrefix += 1;
  }
  const hardLimitPrefix = Math.max(
    0,
    events.length - CODEX_MANAGED_EVENT_HARD_LIMIT
  );
  const removeCount = Math.max(timePrefix, hardLimitPrefix);
  const lastRemoved =
    removeCount > 0 ? events[removeCount - 1]! : null;
  return sealManagedCodexHistory({
    contract: history.contract,
    managedRunId: history.managedRunId,
    updatedAt: event.retentionAt,
    anchor: lastRemoved
      ? {
          prunedThroughSequence: lastRemoved.sequence,
          prunedThroughEventSha256: lastRemoved.eventSha256,
          anchoredAt: nowIso
        }
      : history.anchor,
    events: events.slice(removeCount)
  });
}

function pruneHistory(
  history: ManagedCodexEventHistory,
  now: Date,
  anchoredAt: string
): ManagedCodexEventHistory {
  const cutoff = retentionCutoff(now);
  let timePrefix = 0;
  while (
    timePrefix < history.events.length &&
    Date.parse(history.events[timePrefix]!.retentionAt) < cutoff
  ) {
    timePrefix += 1;
  }
  const hardLimitPrefix = Math.max(
    0,
    history.events.length - CODEX_MANAGED_EVENT_HARD_LIMIT
  );
  const removeCount = Math.max(timePrefix, hardLimitPrefix);
  if (removeCount === 0) return history;
  const lastRemoved = history.events[removeCount - 1]!;
  return sealManagedCodexHistory({
    contract: history.contract,
    managedRunId: history.managedRunId,
    updatedAt: anchoredAt,
    anchor: {
      prunedThroughSequence: lastRemoved.sequence,
      prunedThroughEventSha256: lastRemoved.eventSha256,
      anchoredAt
    },
    events: history.events.slice(removeCount)
  });
}

function normalizedItemType(notification: unknown) {
  if (
    !notification ||
    typeof notification !== "object" ||
    !("method" in notification) ||
    ((notification as { method?: unknown }).method !== "item/started" &&
      (notification as { method?: unknown }).method !==
        "item/completed")
  ) {
    return null;
  }
  const params = (notification as { params?: unknown }).params;
  const item =
    params && typeof params === "object" && "item" in params
      ? (params as { item?: unknown }).item
      : null;
  const type =
    item && typeof item === "object" && "type" in item
      ? (item as { type?: unknown }).type
      : null;
  switch (type) {
    case "userMessage":
      return "user_message" as const;
    case "agentMessage":
      return "agent_message" as const;
    case "reasoning":
      return "reasoning" as const;
    case "commandExecution":
      return "command_execution" as const;
    case "fileChange":
      return "file_change" as const;
    case "mcpToolCall":
    case "dynamicToolCall":
      return "tool_call" as const;
    case "webSearch":
      return "web_search" as const;
    case "imageGeneration":
      return "other" as const;
    case "collabToolCall":
      return "collaboration" as const;
    case "contextCompaction":
      return "context_compaction" as const;
    case "plan":
    default:
      return "other" as const;
  }
}

function managedOwnershipMatchesProjection(
  identity: ManagedCodexOwnershipIdentity,
  projection: ManagedCodexPrivateProjection
): boolean {
  return (
    identity.bindingId === projection.bindingId &&
    identity.executionId === projection.executionId &&
    identity.scopeId === projection.scopeId &&
    identity.connectionGeneration === projection.connectionGeneration
  );
}

function nextRetentionAt(
  history: ManagedCodexEventHistory,
  observedAt: string
): string {
  const previous = history.events.at(-1)?.retentionAt;
  if (!previous || Date.parse(observedAt) >= Date.parse(previous)) {
    return observedAt;
  }
  return previous;
}

function nextHistorySequence(
  history: ManagedCodexEventHistory
): number {
  return (
    history.events.at(-1)?.sequence ??
    history.anchor?.prunedThroughSequence ??
    -1
  ) + 1;
}

function historyHeadHash(
  history: ManagedCodexEventHistory
): string | null {
  return (
    history.events.at(-1)?.eventSha256 ??
    history.anchor?.prunedThroughEventSha256 ??
    null
  );
}

function replaceProjection(
  latest: ManagedCodexLatestStore,
  projection: ManagedCodexPrivateProjection,
  updatedAt: string
): ManagedCodexLatestStore {
  return sealManagedCodexLatest({
    contract: CODEX_MANAGED_LATEST_STORE_CONTRACT,
    revision: latest.revision + 1,
    updatedAt,
    runs: latest.runs.map((run) =>
      run.managedRunId === projection.managedRunId
        ? projection
        : run
    )
  });
}

async function readStores(
  cwd: string,
  emptyTimestamp: string
): Promise<{
  registry: ManagedCodexRunRegistry;
  latest: ManagedCodexLatestStore;
}> {
  const directory = managedCodexLocalDirectory(cwd);
  const [registryRead, latestRead] = await Promise.all([
    readPrivateJson(
      join(directory, REGISTRY_FILENAME),
      managedCodexRunRegistrySchema
    ),
    readPrivateJson(
      join(directory, LATEST_FILENAME),
      managedCodexLatestStoreSchema
    )
  ]);
  if (
    registryRead.status === "missing" &&
    latestRead.status === "missing"
  ) {
    return {
      registry: createEmptyManagedCodexRegistry(emptyTimestamp),
      latest: createEmptyManagedCodexLatest(emptyTimestamp)
    };
  }
  if (
    registryRead.status !== "available" ||
    latestRead.status !== "available"
  ) {
    throw new ManagedCodexStoreError("STORE_INVALID");
  }
  assertRegistryLatestCoherent(
    registryRead.value,
    latestRead.value
  );
  return {
    registry: registryRead.value,
    latest: latestRead.value
  };
}

async function readHistory(
  managedRunId: string,
  cwd: string
): Promise<ManagedCodexEventHistory> {
  const read = await readPrivateJson(
    historyPath(managedRunId, cwd),
    managedCodexEventHistorySchema
  );
  if (read.status !== "available") {
    throw new ManagedCodexStoreError("STORE_INVALID");
  }
  return read.value;
}

function assertRegistryLatestCoherent(
  registry: ManagedCodexRunRegistry,
  latest: ManagedCodexLatestStore
): void {
  if (registry.runs.length !== latest.runs.length) {
    throw new ManagedCodexStoreError("STORE_INVALID");
  }
  for (const run of registry.runs) {
    const projection = latest.runs.find(
      (item) => item.managedRunId === run.managedRunId
    );
    if (!projection) {
      throw new ManagedCodexStoreError("STORE_INVALID");
    }
    assertRunProjectionIdentity(run, projection);
  }
}

function assertRunProjectionIdentity(
  run: ReturnType<typeof requireRun>,
  projection: ManagedCodexPrivateProjection
): void {
  if (
    run.bindingId !== projection.bindingId ||
    run.executionId !== projection.executionId ||
    run.scopeId !== projection.scopeId ||
    run.connectionGeneration !== projection.connectionGeneration ||
    run.ownerInstanceId !== projection.ownerInstanceId ||
    run.startedAt !== projection.startedAt
  ) {
    throw new ManagedCodexStoreError("STORE_INVALID");
  }
}

function assertProjectionHistoryCoherent(
  projection: ManagedCodexPrivateProjection,
  history: ManagedCodexEventHistory
): void {
  if (!projectionHeadMatchesHistory(projection, history)) {
    throw new ManagedCodexStoreError("STORE_INVALID");
  }
  for (const event of history.events) {
    if (
      event.ownerInstanceId !== projection.ownerInstanceId ||
      (event.observation &&
        event.observation.executionId !==
          opaqueExecutionId(projection.executionId))
    ) {
      throw new ManagedCodexStoreError("STORE_INVALID");
    }
  }
}

function requireRun(
  registry: ManagedCodexRunRegistry,
  managedRunId: string
) {
  const run = registry.runs.find(
    (item) => item.managedRunId === managedRunId
  );
  if (!run) throw new ManagedCodexStoreError("RUN_NOT_FOUND");
  return run;
}

function requireProjection(
  latest: ManagedCodexLatestStore,
  managedRunId: string
): ManagedCodexPrivateProjection {
  const projection = latest.runs.find(
    (item) => item.managedRunId === managedRunId
  );
  if (!projection) {
    throw new ManagedCodexStoreError("RUN_NOT_FOUND");
  }
  return projection;
}

function assertOwner(
  projection: ManagedCodexPrivateProjection,
  ownerInstanceId: string
): void {
  if (projection.ownerInstanceId !== parseOwnerInstanceId(ownerInstanceId)) {
    throw new ManagedCodexStoreError("OWNER_MISMATCH");
  }
}

async function commitSettlement(
  settlement: ManagedCodexSettlement,
  cwd: string
): Promise<void> {
  const directory = managedCodexLocalDirectory(cwd);
  await writePrivateJson(
    join(directory, SETTLEMENT_FILENAME),
    managedCodexSettlementSchema.parse(settlement)
  );
  await applySettlement(settlement, cwd);
}

async function recoverPendingSettlement(cwd: string): Promise<void> {
  const read = await readPrivateJson(
    join(managedCodexLocalDirectory(cwd), SETTLEMENT_FILENAME),
    managedCodexSettlementSchema
  );
  if (read.status === "missing") return;
  if (read.status === "invalid") {
    throw new ManagedCodexStoreError("STORE_INVALID");
  }
  await applySettlement(read.value, cwd);
}

async function applySettlement(
  settlementInput: ManagedCodexSettlement,
  cwd: string
): Promise<void> {
  const settlement = managedCodexSettlementSchema.parse(
    settlementInput
  );
  const directory = managedCodexLocalDirectory(cwd);
  try {
    await writePrivateJson(
      join(directory, REGISTRY_FILENAME),
      settlement.registry
    );
    if (settlement.history) {
      await writePrivateJson(
        historyPath(settlement.managedRunId, cwd),
        settlement.history
      );
    } else {
      await unlink(
        historyPath(settlement.managedRunId, cwd)
      ).catch(ignoreMissing);
    }
    await writePrivateJson(
      join(directory, LATEST_FILENAME),
      settlement.latest
    );
    await unlink(join(directory, SETTLEMENT_FILENAME)).catch(
      ignoreMissing
    );
  } catch (error) {
    if (error instanceof ManagedCodexStoreError) throw error;
    throw new ManagedCodexStoreError("STORE_WRITE_FAILED");
  }
}

function historyPath(managedRunId: string, cwd: string): string {
  return join(
    managedCodexLocalDirectory(cwd),
    EVENTS_DIRECTORY,
    `${managedCodexRunIdSchema.parse(managedRunId)}.json`
  );
}

async function readPrivateJson<T>(
  path: string,
  schema: ZodType<T>
): Promise<PrivateReadResult<T>> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o600
    ) {
      return { status: "invalid" };
    }
    const parsed = schema.safeParse(
      JSON.parse(await readFile(path, "utf8"))
    );
    return parsed.success
      ? { status: "available", value: parsed.data }
      : { status: "invalid" };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { status: "missing" };
    if (error instanceof SyntaxError) return { status: "invalid" };
    throw new ManagedCodexStoreError("STORE_READ_FAILED");
  }
}

async function writePrivateJson(
  target: string,
  value: unknown
): Promise<void> {
  const directory = dirname(target);
  let temporary: string | null = null;
  try {
    await ensurePrivateDirectory(directory);
    temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
  } catch {
    if (temporary) await unlink(temporary).catch(() => undefined);
    throw new ManagedCodexStoreError("STORE_WRITE_FAILED");
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  } catch {
    throw new ManagedCodexStoreError("STORE_WRITE_FAILED");
  }
}

function withManagedCodexMutation<T>(
  cwd: string,
  mutation: () => Promise<T>
): Promise<T> {
  const key = managedCodexLocalDirectory(cwd);
  const previous = mutationQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const lease = await acquireFilesystemLock(cwd);
      try {
        await cleanupManagedCodexTempFiles(cwd);
        return await mutation();
      } finally {
        await releaseFilesystemLock(lease);
      }
    });
  mutationQueues.set(key, next);
  return next.finally(() => {
    if (mutationQueues.get(key) === next) mutationQueues.delete(key);
  });
}

async function cleanupManagedCodexTempFiles(cwd: string): Promise<void> {
  const root = managedCodexLocalDirectory(cwd);
  await cleanupRecognizedTempFiles(root, [
    REGISTRY_FILENAME,
    LATEST_FILENAME,
    SETTLEMENT_FILENAME
  ]);
  const eventsDirectory = join(root, EVENTS_DIRECTORY);
  let eventFiles: string[];
  try {
    eventFiles = await readdir(eventsDirectory);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new ManagedCodexStoreError("STORE_READ_FAILED");
  }
  for (const file of eventFiles) {
    if (
      /^managed_run_[a-f0-9]{32}\.json\.\d+\.[a-f0-9-]{36}\.tmp$/.test(
        file
      )
    ) {
      await unlink(join(eventsDirectory, file)).catch(ignoreMissing);
    }
  }
}

async function cleanupRecognizedTempFiles(
  directory: string,
  basenames: readonly string[]
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw new ManagedCodexStoreError("STORE_READ_FAILED");
  }
  for (const file of files) {
    if (
      basenames.some((basename) =>
        new RegExp(
          `^${basename.replace(".", "\\.")}\\.\\d+\\.[a-f0-9-]{36}\\.tmp$`
        ).test(file)
      )
    ) {
      await unlink(join(directory, file)).catch(ignoreMissing);
    }
  }
}

type FilesystemLease = { path: string; token: string };

async function acquireFilesystemLock(
  cwd: string
): Promise<FilesystemLease> {
  await ensurePrivateDirectory(managedCodexLocalDirectory(cwd));
  const directory = join(
    managedCodexLocalDirectory(cwd),
    LOCKS_DIRECTORY
  );
  await ensurePrivateDirectory(directory);
  const path = join(directory, `${STATE_LOCK_NAME}.lock`);
  const deadline = Date.now() + FILESYSTEM_LOCK_WAIT_MS;
  while (Date.now() <= deadline) {
    const token = randomBytes(16).toString("hex");
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${token}\n`, "utf8");
      await handle.close();
      await chmod(path, 0o600);
      return { path, token };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (!isNodeError(error, "EEXIST")) {
        throw new ManagedCodexStoreError(
          "LOCK_ACQUISITION_FAILED"
        );
      }
      await removeStaleLock(path);
      await waitForLock();
    }
  }
  throw new ManagedCodexStoreError("LOCK_ACQUISITION_FAILED");
}

async function removeStaleLock(path: string): Promise<void> {
  try {
    const metadata = await stat(path);
    if (Date.now() - metadata.mtimeMs > FILESYSTEM_LOCK_STALE_MS) {
      await unlink(path);
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      throw new ManagedCodexStoreError(
        "LOCK_ACQUISITION_FAILED"
      );
    }
  }
}

async function releaseFilesystemLock(
  lease: FilesystemLease
): Promise<void> {
  try {
    if ((await readFile(lease.path, "utf8")).trim() === lease.token) {
      await unlink(lease.path);
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) {
      throw new ManagedCodexStoreError(
        "LOCK_ACQUISITION_FAILED"
      );
    }
  }
}

function waitForLock(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, FILESYSTEM_LOCK_RETRY_MS);
  });
}

function parseTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError("Invalid managed Codex timestamp.");
  }
  return timestamp.toISOString();
}

function parseOwnerInstanceId(value: string): string {
  if (!/^instance_[a-f0-9]{32}$/.test(value)) {
    throw new TypeError("Invalid managed Codex owner instance ID.");
  }
  return value;
}

function parseStreamGeneration(value: string): string {
  if (!/^stream_[a-f0-9]{32}$/.test(value)) {
    throw new TypeError("Invalid managed Codex stream generation.");
  }
  return value;
}

function retentionCutoff(now: Date): number {
  return (
    now.getTime() -
    CODEX_MANAGED_RETENTION_DAYS * 24 * 60 * 60 * 1_000
  );
}

function ignoreMissing(error: unknown): void {
  if (!isNodeError(error, "ENOENT")) throw error;
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
