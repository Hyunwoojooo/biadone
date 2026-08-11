import { resolve } from "node:path";

import { fetchAndStoreCodexSnapshot } from "../connectors/codex/appServer";
import { collectCodexLocalGitSnapshot } from "../connectors/codex/localGitCollector";
import {
  codexStoreGeneration,
  readStoredCodexConfig,
  writeStoredCodexLocalGitSnapshot
} from "../connectors/codex/localStore";
import { fetchAndStoreCalendarSnapshot } from "../connectors/googleCalendar/calendarApi";
import { loadGoogleCalendarConfig } from "../connectors/googleCalendar/config";
import { readStoredTokens as readStoredCalendarTokens } from "../connectors/googleCalendar/localStore";
import { loadGitHubConfig } from "../connectors/github/config";
import { fetchAndStoreGitHubSnapshot } from "../connectors/github/githubApi";
import { readStoredGitHubTokens } from "../connectors/github/localStore";
import { loadNotionConfig } from "../connectors/notion/config";
import { readStoredNotionTokens } from "../connectors/notion/localStore";
import { fetchAndStoreNotionSnapshot } from "../connectors/notion/notionApi";
import { loadSharedLocalEnv } from "../localEnv";
import {
  SourceSyncAdapterError,
  SourceSyncCoordinator,
  createSourceSnapshotReceipt,
  type SourceSyncAdapter
} from "./coordinator";
import { FileSystemSourceSyncRepository } from "./repository";
import {
  SYNC_SOURCES,
  type SourceSyncLatestStore,
  type SourceSyncState,
  type SyncSource
} from "./schema";
import { safeSha256 } from "./serialization";

export type RuntimeSourceSyncStatus = {
  source: SyncSource;
  status:
    | "idle"
    | "syncing"
    | "backoff"
    | "disconnected"
    | "error";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
  retryCount: number;
  lastErrorCode: string | null;
  snapshotRevision: string | null;
  snapshotHash: string | null;
};

export type RuntimeSourceSyncStatusResponse = {
  status: "ready";
  revision: string;
  generatedAt: string;
  sources: RuntimeSourceSyncStatus[];
  adapterMode: "coordinator";
};

export const SOURCE_SYNC_HTTP_REQUEST_TIMEOUT_MS = 15_000;

type RuntimeEntry = {
  coordinator: SourceSyncCoordinator;
  startRequested: boolean;
};

const RUNTIME_ENTRIES_KEY = Symbol.for(
  "blabase.source-sync.runtime-entries.v1"
);

function sharedRuntimeEntries(): Map<string, RuntimeEntry> {
  const existing = Reflect.get(globalThis, RUNTIME_ENTRIES_KEY);
  if (existing instanceof Map) {
    return existing as Map<string, RuntimeEntry>;
  }
  const created = new Map<string, RuntimeEntry>();
  Reflect.set(globalThis, RUNTIME_ENTRIES_KEY, created);
  return created;
}

const runtimeEntries = sharedRuntimeEntries();

function runtimeEntryKey(cwd: string): string {
  return resolve(cwd);
}

export function getRuntimeSourceSyncCoordinator(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): SourceSyncCoordinator {
  const key = runtimeEntryKey(cwd);
  const existing = runtimeEntries.get(key);
  if (existing) return existing.coordinator;
  loadSharedLocalEnv(env);
  const coordinator = new SourceSyncCoordinator({
    adapters: createRuntimeSourceSyncAdapters(cwd, env),
    repository: FileSystemSourceSyncRepository.fromCwd(cwd)
  });
  runtimeEntries.set(key, {
    coordinator,
    startRequested: false
  });
  return coordinator;
}

export function ensureRuntimeSourceSyncStarted(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): void {
  const coordinator = getRuntimeSourceSyncCoordinator(cwd, env);
  const entry = runtimeEntries.get(runtimeEntryKey(cwd));
  if (!entry || entry.startRequested) return;
  entry.startRequested = true;
  void coordinator.start().catch(() => {
    entry.startRequested = false;
  });
}

export async function startRuntimeSourceSync(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): Promise<RuntimeSourceSyncStatusResponse> {
  const coordinator = getRuntimeSourceSyncCoordinator(cwd, env);
  const entry = runtimeEntries.get(runtimeEntryKey(cwd));
  if (entry) entry.startRequested = true;
  try {
    await coordinator.start();
  } catch (error) {
    if (entry) entry.startRequested = false;
    throw error;
  }
  return runtimeStatusResponse(await coordinator.getLatestStore());
}

export async function syncRuntimeSources(input: {
  sources?: SyncSource[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<RuntimeSourceSyncStatusResponse> {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const coordinator = getRuntimeSourceSyncCoordinator(cwd, env);
  const sources = input.sources ?? [...SYNC_SOURCES];
  await Promise.all(
    [...new Set(sources)].map((source) =>
      coordinator.sync(source, "manual")
    )
  );
  ensureRuntimeSourceSyncStarted(cwd, env);
  return readRuntimeSourceSyncStatus({ cwd, env });
}

export async function readRuntimeSourceSyncStatus(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  startScheduler?: boolean;
} = {}): Promise<RuntimeSourceSyncStatusResponse> {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const coordinator = getRuntimeSourceSyncCoordinator(cwd, env);
  if (input.startScheduler === true) {
    ensureRuntimeSourceSyncStarted(cwd, env);
  }
  const latest = await coordinator.getLatestStore();
  return runtimeStatusResponse(latest);
}

export async function noteRuntimeSourceDisconnected(
  source: SyncSource,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const coordinator = getRuntimeSourceSyncCoordinator(cwd, env);
  await coordinator.markDisconnected(source);
}

/**
 * Invalidates an older logical connector generation before a replacement
 * connection is collected. The transition clears both latest metadata and
 * the previous source lineage without recording a synthetic failure. A caller
 * should follow it with an explicit manual sync for the replacement.
 */
export async function supersedeRuntimeSourceConnection(
  source: SyncSource,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const coordinator = getRuntimeSourceSyncCoordinator(cwd, env);
  await coordinator.beginConnectionGeneration(source);
}

export function createRuntimeSourceSyncAdapters(
  cwd: string,
  env: NodeJS.ProcessEnv
): Record<SyncSource, SourceSyncAdapter> {
  return {
    github: {
      source: "github",
      async sync(context) {
        loadSharedLocalEnv(env);
        const config = loadGitHubConfig(env);
        const tokens = await readStoredGitHubTokens(cwd);
        if (
          !config.ok ||
          !tokens ||
          tokens.appClientId !== config.config.clientId ||
          tokens.appSlug !== config.config.appSlug ||
          Date.parse(tokens.refreshTokenExpiresAt) <=
            Date.parse(context.startedAt)
        ) {
          throw new SourceSyncAdapterError(
            "CONNECTOR_DISCONNECTED"
          );
        }
        try {
          const fetchImpl = createBoundedSourceSyncFetch();
          const snapshot = await fetchAndStoreGitHubSnapshot(
            config.config,
            {
              cwd,
              now: new Date(context.startedAt),
              fetchImpl
            }
          );
          return createSourceSnapshotReceipt(
            `github:${snapshot.fetchedAt}`,
            snapshot.tasks.length + snapshot.activities.length,
            snapshot
          );
        } catch (error) {
          throw adapterError(error);
        }
      }
    },
    codex: {
      source: "codex",
      async sync(context) {
        const expectedGeneration = codexStoreGeneration(cwd);
        const config = await readStoredCodexConfig(cwd);
        if (
          !config ||
          config.selectedScopeIds.length === 0 ||
          !config.selectedScopeIds.some((scopeId) =>
            config.scopes.some((scope) => scope.id === scopeId)
          )
        ) {
          throw new SourceSyncAdapterError(
            "CONNECTOR_DISCONNECTED"
          );
        }
        try {
          const snapshot = await fetchAndStoreCodexSnapshot(config, {
            cwd,
            now: new Date(context.startedAt)
          });
          try {
            const selectedScopeIds = new Set(
              config.selectedScopeIds
            );
            const localGitSnapshot =
              await collectCodexLocalGitSnapshot({
                installationSecret: config.installationSecret,
                scopes: config.scopes.filter((scope) =>
                  selectedScopeIds.has(scope.id)
                ),
                observedAt: context.startedAt
              });
            await writeStoredCodexLocalGitSnapshot(
              localGitSnapshot,
              config,
              cwd,
              expectedGeneration
            );
          } catch {
            // Local Git is private, best-effort enrichment. Codex inventory
            // remains authoritative for connector sync settlement.
          }
          return createSourceSnapshotReceipt(
            `codex:${snapshot.fetchedAt}`,
            snapshot.sessions.length,
            snapshot
          );
        } catch (error) {
          throw adapterError(error);
        }
      }
    },
    notion: {
      source: "notion",
      async sync(context) {
        loadSharedLocalEnv(env);
        const config = loadNotionConfig(env);
        const tokens = await readStoredNotionTokens(cwd);
        if (!config.ok || !tokens) {
          throw new SourceSyncAdapterError(
            "CONNECTOR_DISCONNECTED"
          );
        }
        try {
          const fetchImpl = createBoundedSourceSyncFetch();
          const snapshot = await fetchAndStoreNotionSnapshot(
            config.config,
            {
              cwd,
              now: new Date(context.startedAt),
              fetchImpl
            }
          );
          return createSourceSnapshotReceipt(
            `notion:${snapshot.fetchedAt}`,
            snapshot.resources.length,
            snapshot
          );
        } catch (error) {
          throw adapterError(error);
        }
      }
    },
    google_calendar: {
      source: "google_calendar",
      async sync(context) {
        loadSharedLocalEnv(env);
        const config = loadGoogleCalendarConfig(env, cwd);
        const tokens = await readStoredCalendarTokens(cwd);
        if (!config.ok || !tokens) {
          throw new SourceSyncAdapterError(
            "CONNECTOR_DISCONNECTED"
          );
        }
        try {
          const fetchImpl = createBoundedSourceSyncFetch();
          const snapshot = await fetchAndStoreCalendarSnapshot(
            config.config,
            {
              cwd,
              now: new Date(context.startedAt),
              fetchImpl
            }
          );
          return createSourceSnapshotReceipt(
            `calendar:${snapshot.fetchedAt}`,
            snapshot.events.length,
            snapshot
          );
        } catch (error) {
          throw adapterError(error);
        }
      }
    }
  };
}

export function createBoundedSourceSyncFetch(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = SOURCE_SYNC_HTTP_REQUEST_TIMEOUT_MS
): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Source sync HTTP timeout must be positive.");
  }

  return (async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const abortFromUpstream = () =>
      controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal?.addEventListener(
        "abort",
        abortFromUpstream,
        { once: true }
      );
    }

    let timeoutHandle:
      | ReturnType<typeof globalThis.setTimeout>
      | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = globalThis.setTimeout(() => {
        controller.abort();
        reject(
          new SourceSyncAdapterError("SOURCE_REQUEST_TIMEOUT")
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        fetchImpl(input, {
          ...init,
          signal: controller.signal
        }),
        timeout
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        globalThis.clearTimeout(timeoutHandle);
      }
      upstreamSignal?.removeEventListener(
        "abort",
        abortFromUpstream
      );
    }
  }) as typeof fetch;
}

export function runtimeStatusResponse(
  latest: SourceSyncLatestStore
): RuntimeSourceSyncStatusResponse {
  return {
    status: "ready",
    revision: `pipeline:${safeSha256({
      updatedAt: latest.updatedAt,
      sources: SYNC_SOURCES.map((source) => {
        const state = latest.sources[source];
        return {
          source,
          status: state.status,
          lastAttemptId: state.lastAttempt?.attemptId ?? null,
          snapshotRevision:
            state.latestSnapshot?.revision ?? null,
          snapshotHash: state.latestSnapshot?.hash ?? null,
          errorCode:
            state.lastAttempt?.outcome === "failure"
              ? state.lastAttempt.errorCode
              : null
        };
      })
    }).slice(0, 32)}`,
    generatedAt: new Date().toISOString(),
    sources: SYNC_SOURCES.map((source) =>
      runtimeSourceStatus(latest.sources[source])
    ),
    adapterMode: "coordinator"
  };
}

function runtimeSourceStatus(
  state: SourceSyncState
): RuntimeSourceSyncStatus {
  const currentError =
    state.lastAttempt?.outcome === "failure"
      ? state.lastAttempt.errorCode
      : null;
  return {
    source: state.source,
    status:
      state.status === "syncing"
        ? "syncing"
        : state.status === "disabled" ||
            currentError === "CONNECTOR_DISCONNECTED"
          ? "disconnected"
          : state.status === "retry_wait"
            ? "backoff"
            : state.status === "never_synced" ||
                state.status === "ready"
              ? "idle"
              : "error",
    lastAttemptAt: state.lastAttempt?.startedAt ?? null,
    lastSuccessAt: state.lastSuccess?.completedAt ?? null,
    lastFailureAt: state.lastFailure?.completedAt ?? null,
    nextRetryAt:
      state.status === "retry_wait" ? state.nextDueAt : null,
    retryCount: state.retryCount,
    lastErrorCode: currentError,
    snapshotRevision: state.latestSnapshot?.revision ?? null,
    snapshotHash: state.latestSnapshot?.hash ?? null
  };
}

function adapterError(error: unknown): SourceSyncAdapterError {
  return new SourceSyncAdapterError(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
      ? error.code
      : "SYNC_FAILED"
  );
}

export function resetRuntimeSourceSyncForTests(): void {
  for (const entry of runtimeEntries.values()) {
    entry.coordinator.stop();
  }
  runtimeEntries.clear();
}
