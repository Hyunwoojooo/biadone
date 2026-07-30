"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore
} from "react";

import {
  syncInvalidationBus,
  type SyncInvalidationEvent,
  type SyncInvalidationTarget
} from "./invalidationBus";
import {
  PollController,
  type PollControllerState
} from "./pollController";
import {
  fetchSourceSyncStatus,
  requestSourceSyncStart,
  type SourceSyncName,
  type SourceSyncStatus,
  type SourceSyncStatusResponse
} from "./sourceSyncClient";

type SourceSyncRuntimeSnapshot = {
  response: SourceSyncStatusResponse | null;
  polling: PollControllerState;
  lastClientErrorAt: string | null;
};

const STOPPED_POLL_STATE: PollControllerState = {
  status: "stopped",
  consecutiveFailures: 0,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  nextRetryAt: null
};

const SERVER_SNAPSHOT: SourceSyncRuntimeSnapshot = {
  response: null,
  polling: STOPPED_POLL_STATE,
  lastClientErrorAt: null
};

const SOURCE_SYNC_POLL_INTERVAL_MS =
  positivePublicInterval(
    process.env.NEXT_PUBLIC_SOURCE_SYNC_POLL_INTERVAL_MS
  ) ?? 15_000;

class SourceSyncRuntime {
  private readonly listeners = new Set<() => void>();
  private readonly controller: PollController<SourceSyncStatusResponse>;
  private readonly syncPollTask = createSourceSyncPollTask();
  private visibilityListener: (() => void) | null = null;
  private snapshot: SourceSyncRuntimeSnapshot = SERVER_SNAPSHOT;

  constructor() {
    this.controller = new PollController({
      execute: this.syncPollTask.execute,
      onResult: (response) => this.acceptResponse(response),
      onError: () => {
        this.syncPollTask.requireStart();
        this.snapshot = {
          ...this.snapshot,
          lastClientErrorAt: new Date().toISOString()
        };
        this.emit();
      },
      onStateChange: (polling) => {
        this.snapshot = { ...this.snapshot, polling };
        this.emit();
      },
      intervalMs: SOURCE_SYNC_POLL_INTERVAL_MS,
      maxBackoffMs: 120_000,
      initiallyVisible: true
    });
  }

  getSnapshot = (): SourceSyncRuntimeSnapshot => this.snapshot;

  getServerSnapshot = (): SourceSyncRuntimeSnapshot => SERVER_SNAPSHOT;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  };

  wake(): void {
    this.controller.wake();
  }

  private start(): void {
    const updateVisibility = () => {
      const visible = document.visibilityState === "visible";
      if (visible) this.syncPollTask.requireStart();
      this.controller.setVisible(visible);
    };
    this.visibilityListener = updateVisibility;
    this.syncPollTask.requireStart();
    this.controller.setVisible(
      document.visibilityState === "visible"
    );
    document.addEventListener("visibilitychange", updateVisibility);
    this.controller.start();
  }

  private stop(): void {
    this.controller.stop();
    if (this.visibilityListener) {
      document.removeEventListener(
        "visibilitychange",
        this.visibilityListener
      );
      this.visibilityListener = null;
    }
  }

  private acceptResponse(response: SourceSyncStatusResponse): void {
    const previous = this.snapshot.response;
    this.snapshot = {
      ...this.snapshot,
      response,
      lastClientErrorAt: null
    };
    this.emit();

    const changedSources = statusInvalidationSources(
      previous,
      response
    );
    if (changedSources.length === 0) return;
    const targets: SyncInvalidationTarget[] = [
      ...changedSources,
      "attention",
      "timeline"
    ];
    syncInvalidationBus.invalidate({
      reason: "snapshot_revision_changed",
      targets,
      revision: response.revision
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function positivePublicInterval(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const sourceSyncRuntime = new SourceSyncRuntime();

export function useSourceSyncRuntime(): SourceSyncRuntimeSnapshot {
  return useSyncExternalStore(
    sourceSyncRuntime.subscribe,
    sourceSyncRuntime.getSnapshot,
    sourceSyncRuntime.getServerSnapshot
  );
}

export function useSourceSyncStatus(
  source: SourceSyncName
): SourceSyncStatus | null {
  const runtime = useSourceSyncRuntime();
  return (
    runtime.response?.sources.find(
      (candidate) => candidate.source === source
    ) ?? null
  );
}

export function useSyncInvalidation(
  targets: readonly SyncInvalidationTarget[],
  handler: (event: SyncInvalidationEvent) => void
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const targetKey = targets.join("|");

  useEffect(
    () =>
      syncInvalidationBus.subscribe(targets, (event) => {
        handlerRef.current(event);
      }),
    // targetKey intentionally represents the immutable target list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey]
  );
}

export function useVisiblePolling(
  task: () => Promise<unknown>,
  options: {
    intervalMs: number;
    maxBackoffMs?: number;
    enabled?: boolean;
    runImmediately?: boolean;
  }
): void {
  const taskRef = useRef(task);
  taskRef.current = task;
  const enabled = options.enabled ?? true;
  const maxBackoffMs =
    options.maxBackoffMs ?? Math.max(options.intervalMs, 120_000);
  const runImmediately = options.runImmediately ?? true;

  useEffect(() => {
    if (!enabled) return;
    let firstExecution = true;
    const controller = new PollController({
      execute: async () => {
        if (firstExecution && !runImmediately) {
          firstExecution = false;
          return;
        }
        firstExecution = false;
        await taskRef.current();
      },
      onResult: () => undefined,
      intervalMs: options.intervalMs,
      maxBackoffMs,
      initiallyVisible: document.visibilityState === "visible"
    });
    const updateVisibility = () => {
      controller.setVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", updateVisibility);
    controller.start();
    return () => {
      controller.stop();
      document.removeEventListener(
        "visibilitychange",
        updateVisibility
      );
    };
  }, [
    enabled,
    maxBackoffMs,
    options.intervalMs,
    runImmediately
  ]);
}

export function wakeSourceSyncStatus(): void {
  sourceSyncRuntime.wake();
}

export function changedSourceRevisions(
  previous: SourceSyncStatus[],
  current: SourceSyncStatus[]
): SourceSyncName[] {
  const previousBySource = new Map(
    previous.map((source) => [source.source, source])
  );
  return current
    .filter((source) => {
      const before = previousBySource.get(source.source);
      return (
        !before ||
        before.snapshotRevision !== source.snapshotRevision ||
        before.snapshotHash !== source.snapshotHash ||
        (before.status === "disconnected") !==
          (source.status === "disconnected")
      );
    })
    .map((source) => source.source);
}

export function statusInvalidationSources(
  previous: SourceSyncStatusResponse | null,
  current: SourceSyncStatusResponse
): SourceSyncName[] {
  if (!previous) {
    return current.sources
      .filter((source) => source.snapshotRevision !== null)
      .map((source) => source.source);
  }
  if (previous.revision === current.revision) return [];
  return changedSourceRevisions(previous.sources, current.sources);
}

export function createSourceSyncPollTask(options: {
  requestStart?: () => Promise<SourceSyncStatusResponse>;
  readStatus?: () => Promise<SourceSyncStatusResponse>;
  now?: () => number;
  reconfirmAfterMs?: number;
} = {}): {
  execute: () => Promise<SourceSyncStatusResponse>;
  requireStart: () => void;
} {
  const requestStart =
    options.requestStart ?? (() => requestSourceSyncStart());
  const readStatus =
    options.readStatus ?? (() => fetchSourceSyncStatus());
  const now = options.now ?? (() => Date.now());
  const reconfirmAfterMs = options.reconfirmAfterMs ?? 60_000;
  if (!Number.isFinite(reconfirmAfterMs) || reconfirmAfterMs <= 0) {
    throw new Error("Sync start confirmation interval must be positive.");
  }
  let startConfirmedAt: number | null = null;

  return {
    async execute() {
      const currentTime = now();
      if (
        startConfirmedAt === null ||
        currentTime - startConfirmedAt >= reconfirmAfterMs
      ) {
        const response = await requestStart();
        startConfirmedAt = now();
        return response;
      }
      return readStatus();
    },
    requireStart() {
      startConfirmedAt = null;
    }
  };
}
