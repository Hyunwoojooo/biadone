import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SyncInvalidationBus,
  type SyncInvalidationEvent
} from "../app/sync/invalidationBus";
import { PollController } from "../app/sync/pollController";
import {
  fetchSourceSyncStatus,
  requestSourceSync,
  requestSourceSyncStart
} from "../app/sync/sourceSyncClient";
import {
  changedSourceRevisions,
  createSourceSyncPollTask,
  statusInvalidationSources
} from "../app/sync/useSourceSync";

afterEach(() => {
  vi.useRealTimers();
});

describe("UI poll controller", () => {
  it("polls immediately, then waits for the configured interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
    const execute = vi.fn().mockResolvedValue("ready");
    const onResult = vi.fn();
    const controller = new PollController({
      execute,
      onResult,
      intervalMs: 1_000,
      maxBackoffMs: 8_000
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("ready");

    await vi.advanceTimersByTimeAsync(999);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("keeps polling with bounded exponential backoff and recovers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValue("recovered");
    const controller = new PollController({
      execute,
      onResult: vi.fn(),
      intervalMs: 1_000,
      maxBackoffMs: 8_000
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getState()).toMatchObject({
      status: "backoff",
      consecutiveFailures: 1
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(controller.getState()).toMatchObject({
      status: "backoff",
      consecutiveFailures: 2
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(execute).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(controller.getState()).toMatchObject({
      status: "idle",
      consecutiveFailures: 0
    });

    controller.stop();
  });

  it("pauses while hidden and resumes immediately when visible", async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockResolvedValue("ready");
    const controller = new PollController({
      execute,
      onResult: vi.fn(),
      intervalMs: 1_000,
      maxBackoffMs: 8_000,
      initiallyVisible: false
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).not.toHaveBeenCalled();

    controller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);

    controller.setVisible(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).toHaveBeenCalledTimes(1);

    controller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("coalesces wake requests without overlapping in-flight work", async () => {
    vi.useFakeTimers();
    let finishFirst!: (value: string) => void;
    const first = new Promise<string>((resolve) => {
      finishFirst = resolve;
    });
    const execute = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue("second");
    const controller = new PollController({
      execute,
      onResult: vi.fn(),
      intervalMs: 1_000,
      maxBackoffMs: 8_000
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    controller.wake();
    controller.wake();
    expect(execute).toHaveBeenCalledTimes(1);

    finishFirst("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(2);

    controller.stop();
  });

  it("continues after stop and restart while the old request is still in flight", async () => {
    vi.useFakeTimers();
    let finishOldRequest!: (value: string) => void;
    const oldRequest = new Promise<string>((resolve) => {
      finishOldRequest = resolve;
    });
    const execute = vi
      .fn()
      .mockImplementationOnce(() => oldRequest)
      .mockResolvedValue("fresh");
    const onResult = vi.fn();
    const controller = new PollController({
      execute,
      onResult,
      intervalMs: 1_000,
      maxBackoffMs: 8_000
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);

    controller.stop();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);

    finishOldRequest("stale");
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("fresh");

    controller.stop();
  });
});

describe("UI invalidation bus", () => {
  it("notifies only interested consumers and deduplicates targets", () => {
    const bus = new SyncInvalidationBus();
    const attentionEvents: SyncInvalidationEvent[] = [];
    const notionEvents: SyncInvalidationEvent[] = [];
    bus.subscribe(["attention"], (event) =>
      attentionEvents.push(event)
    );
    bus.subscribe(["notion"], (event) => notionEvents.push(event));

    const first = bus.invalidate({
      reason: "manual_refresh",
      targets: ["github", "attention", "attention"],
      emittedAt: "2026-07-27T00:00:00.000Z"
    });
    const second = bus.invalidate({
      reason: "disconnect",
      targets: ["notion", "timeline"],
      emittedAt: "2026-07-27T00:01:00.000Z"
    });

    expect(first.targets).toEqual(["github", "attention"]);
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(attentionEvents).toEqual([first]);
    expect(notionEvents).toEqual([second]);
  });

  it("stops notifications after unsubscribe", () => {
    const bus = new SyncInvalidationBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(["timeline"], listener);

    unsubscribe();
    bus.invalidate({
      reason: "snapshot_revision_changed",
      targets: ["timeline"],
      revision: "rev-2"
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("source sync status adapter", () => {
  it("retries explicit scheduler start and periodically reconfirms it", async () => {
    let currentTime = 0;
    const response = {
      status: "ready" as const,
      revision: "pipeline:ready",
      generatedAt: "2026-07-27T00:00:00.000Z",
      sources: [],
      adapterMode: "coordinator" as const
    };
    const requestStart = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary start failure"))
      .mockResolvedValue(response);
    const readStatus = vi.fn().mockResolvedValue(response);
    const task = createSourceSyncPollTask({
      requestStart,
      readStatus,
      now: () => currentTime,
      reconfirmAfterMs: 1_000
    });

    await expect(task.execute()).rejects.toThrow(
      "temporary start failure"
    );
    await expect(task.execute()).resolves.toEqual(response);
    expect(requestStart).toHaveBeenCalledTimes(2);

    currentTime = 999;
    await task.execute();
    expect(readStatus).toHaveBeenCalledOnce();

    currentTime = 1_000;
    await task.execute();
    expect(requestStart).toHaveBeenCalledTimes(3);

    task.requireStart();
    await task.execute();
    expect(requestStart).toHaveBeenCalledTimes(4);
  });

  it("parses the coordinator contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        status: "ready",
        revision: "revision-2",
        generatedAt: "2026-07-27T00:00:00.000Z",
        sources: [
          {
            source: "github",
            status: "backoff",
            lastAttemptAt: "2026-07-27T00:00:00.000Z",
            lastSuccessAt: "2026-07-26T23:59:00.000Z",
            lastFailureAt: "2026-07-27T00:00:00.000Z",
            nextRetryAt: "2026-07-27T00:01:00.000Z",
            retryCount: 2,
            lastErrorCode: "RATE_LIMITED",
            snapshotRevision: "github-revision-1",
            snapshotHash: "a".repeat(64)
          }
        ]
      })
    );

    await expect(fetchSourceSyncStatus(fetchImpl)).resolves.toEqual({
      status: "ready",
      revision: "revision-2",
      generatedAt: "2026-07-27T00:00:00.000Z",
      sources: [
        {
          source: "github",
          status: "backoff",
          lastAttemptAt: "2026-07-27T00:00:00.000Z",
          lastSuccessAt: "2026-07-26T23:59:00.000Z",
          lastFailureAt: "2026-07-27T00:00:00.000Z",
          nextRetryAt: "2026-07-27T00:01:00.000Z",
          retryCount: 2,
          lastErrorCode: "RATE_LIMITED",
          snapshotRevision: "github-revision-1",
          snapshotHash: "a".repeat(64)
        }
      ],
      adapterMode: "coordinator"
    });
  });

  it("falls back to stored timeline revisions when status is absent", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        Response.json({
          status: "ready",
          schemaVersion: "connector-timeline-v2",
          timezone: "Asia/Seoul",
          generatedAt: "2026-07-27T00:00:00.000Z",
          itemCount: 0,
          truncated: false,
          sources: [
            {
              source: "codex",
              state: "available",
              itemCount: 0,
              skippedItemCount: 0,
              snapshotFetchedAt: "2026-07-26T23:50:00.000Z",
              truncated: false
            },
            {
              source: "notion",
              state: "missing",
              itemCount: 0,
              skippedItemCount: 0,
              snapshotFetchedAt: null,
              truncated: false
            }
          ],
          items: []
        })
      );

    const result = await fetchSourceSyncStatus(fetchImpl);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/connectors/timeline",
      { cache: "no-store" }
    );
    expect(result.adapterMode).toBe("timeline_fallback");
    expect(result.sources).toMatchObject([
      {
        source: "codex",
        status: "idle",
        lastSuccessAt: "2026-07-26T23:50:00.000Z"
      },
      {
        source: "notion",
        status: "disconnected",
        snapshotRevision: null
      }
    ]);
  });

  it("requests explicit source synchronization through one mutation endpoint", async () => {
    const payload = {
      status: "ready",
      revision: "revision-3",
      generatedAt: "2026-07-27T00:02:00.000Z",
      sources: []
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(payload));

    await expect(
      requestSourceSync(["github", "github", "codex"], fetchImpl)
    ).resolves.toMatchObject({
      revision: "revision-3",
      adapterMode: "coordinator"
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sources: ["github", "codex"] })
    });
  });

  it("starts the server scheduler through an explicit mutation endpoint", async () => {
    const payload = {
      status: "ready",
      revision: "revision-started",
      generatedAt: "2026-07-27T00:02:00.000Z",
      sources: []
    };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(payload));

    await expect(
      requestSourceSyncStart(fetchImpl)
    ).resolves.toMatchObject({
      revision: "revision-started",
      adapterMode: "coordinator"
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/sync/start", {
      method: "POST"
    });
  });

  it("invalidates Attention on the first status when stored revisions already exist", () => {
    expect(
      statusInvalidationSources(null, {
        status: "ready",
        revision: "pipeline:first",
        generatedAt: "2026-07-27T00:02:00.000Z",
        adapterMode: "coordinator",
        sources: [
          {
            source: "github",
            status: "idle",
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastFailureAt: null,
            nextRetryAt: null,
            retryCount: 0,
            lastErrorCode: null,
            snapshotRevision: "github:first",
            snapshotHash: "b".repeat(64)
          },
          {
            source: "codex",
            status: "disconnected",
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastFailureAt: null,
            nextRetryAt: null,
            retryCount: 0,
            lastErrorCode: null,
            snapshotRevision: null,
            snapshotHash: null
          }
        ]
      })
    ).toEqual(["github"]);
  });

  it("invalidates when content changes under the same adapter revision", () => {
    const base = {
      source: "github" as const,
      status: "idle" as const,
      lastAttemptAt: null,
      lastSuccessAt: "2026-07-27T00:00:00.000Z",
      lastFailureAt: null,
      nextRetryAt: null,
      retryCount: 0,
      lastErrorCode: null,
      snapshotRevision: "github:same-millisecond"
    };

    expect(
      changedSourceRevisions(
        [{ ...base, snapshotHash: "a".repeat(64) }],
        [{ ...base, snapshotHash: "b".repeat(64) }]
      )
    ).toEqual(["github"]);
  });
});
