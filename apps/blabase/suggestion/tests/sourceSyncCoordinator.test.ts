import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FileSystemSourceSyncRepository,
  MemorySourceSyncRepository,
  SourceSyncAdapterError,
  SourceSyncCoordinator,
  SourceSyncCoordinatorError,
  createInitialSourceSyncStore,
  createSourceSnapshotReceipt,
  exponentialBackoffMs,
  safeCanonicalJson,
  safePrettyJson,
  sanitizeSyncErrorCode,
  sourceSnapshotReceiptSchema,
  sourceSyncAttemptSchema,
  type SourceSnapshotReceipt,
  type SourceSyncAdapter,
  type SourceSyncClock,
  type SourceSyncTimer,
  type SyncSource
} from "../src/sync";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

class FakeClock implements SourceSyncClock {
  constructor(private currentMs = Date.parse("2026-07-27T00:00:00.000Z")) {}

  now(): Date {
    return new Date(this.currentMs);
  }

  advance(milliseconds: number): void {
    this.currentMs += milliseconds;
  }
}

class FakeTimer implements SourceSyncTimer {
  private nextId = 1;
  private tasks = new Map<
    number,
    { callback: () => void; delayMs: number }
  >();

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { callback, delayMs });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  delays(): number[] {
    return [...this.tasks.values()].map((task) => task.delayMs);
  }

  pendingCount(): number {
    return this.tasks.size;
  }
}

class FailureInjectingRepository extends MemorySourceSyncRepository {
  failNextCommit = false;
  failNextLineageReplacement = false;
  commitBarrier:
    | { started: () => void; gate: Promise<void> }
    | null = null;
  lineageReplacementBarrier:
    | { started: () => void; gate: Promise<void> }
    | null = null;

  override async commit(
    ...args: Parameters<MemorySourceSyncRepository["commit"]>
  ): ReturnType<MemorySourceSyncRepository["commit"]> {
    if (this.commitBarrier) {
      const barrier = this.commitBarrier;
      this.commitBarrier = null;
      barrier.started();
      await barrier.gate;
    }
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("injected commit failure");
    }
    return super.commit(...args);
  }

  override async completeTransition(
    ...args: Parameters<
      MemorySourceSyncRepository["completeTransition"]
    >
  ): ReturnType<MemorySourceSyncRepository["completeTransition"]> {
    const transition = args[1];
    const barrier =
      transition.kind === "reset_lineage"
        ? this.lineageReplacementBarrier
        : this.commitBarrier;
    if (barrier) {
      if (transition.kind === "reset_lineage") {
        this.lineageReplacementBarrier = null;
      } else {
        this.commitBarrier = null;
      }
      barrier.started();
      await barrier.gate;
    }
    if (
      transition.kind === "reset_lineage" &&
      this.failNextLineageReplacement
    ) {
      this.failNextLineageReplacement = false;
      throw new Error("injected lineage replacement failure");
    }
    if (transition.kind === "disconnect" && this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("injected commit failure");
    }
    return super.completeTransition(...args);
  }

}

class TransitionBarrierFileSystemRepository extends FileSystemSourceSyncRepository {
  transitionBarrier:
    | {
        source: SyncSource;
        started: () => void;
        gate: Promise<void>;
      }
    | null = null;

  override async completeTransition(
    ...args: Parameters<
      FileSystemSourceSyncRepository["completeTransition"]
    >
  ): ReturnType<FileSystemSourceSyncRepository["completeTransition"]> {
    const transition = args[1];
    const barrier = this.transitionBarrier;
    if (barrier && barrier.source === transition.source) {
      this.transitionBarrier = null;
      barrier.started();
      await barrier.gate;
    }
    return super.completeTransition(...args);
  }
}

function receipt(
  revision: string,
  fill = "a",
  itemCount = 1
): SourceSnapshotReceipt {
  return {
    revision,
    hash: fill.repeat(64),
    itemCount
  };
}

function idFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `sync_${sequence.toString(16).padStart(32, "0")}`;
  };
}

function adapter(
  source: SyncSource,
  sync: SourceSyncAdapter["sync"]
): SourceSyncAdapter {
  return { source, sync };
}

describe("SourceSyncCoordinator contracts", () => {
  it("uses strict schemas and persists no raw error detail", async () => {
    expect(
      sourceSnapshotReceiptSchema.safeParse({
        ...receipt("rev-1"),
        accessToken: "secret"
      }).success
    ).toBe(false);

    const invalidAttempt = sourceSyncAttemptSchema.safeParse({
      contract: "source-sync-attempt-v1",
      attemptId: `sync_${"1".repeat(32)}`,
      source: "github",
      trigger: "manual",
      startedAt: "2026-07-27T00:00:00.000Z",
      completedAt: "2026-07-27T00:00:00.001Z",
      outcome: "failure",
      retryCount: 1,
      latencyMs: 1,
      snapshotRevision: null,
      snapshotHash: null,
      itemCount: null,
      errorCode: "RATE_LIMITED",
      message: "Bearer must-not-be-persisted"
    });
    expect(invalidAttempt.success).toBe(false);
    expect(
      sanitizeSyncErrorCode({
        code: "Authorization: Bearer secret"
      })
    ).toBe("SYNC_FAILED");
    expect(
      sanitizeSyncErrorCode(
        new SourceSyncAdapterError("RATE_LIMITED")
      )
    ).toBe("RATE_LIMITED");
  });

  it("serializes deterministically and rejects unsafe values", () => {
    expect(
      safeCanonicalJson({
        z: 1,
        a: { d: 4, b: 2 }
      })
    ).toBe('{"a":{"b":2,"d":4},"z":1}');
    expect(() => safeCanonicalJson({ value: undefined })).toThrow(
      "rejects undefined"
    );
    expect(() => safeCanonicalJson(new Date())).toThrow(
      "plain objects only"
    );
    expect(
      createSourceSnapshotReceipt("revision-1", 2, {
        second: true,
        first: 1
      })
    ).toEqual(
      createSourceSnapshotReceipt("revision-1", 2, {
        first: 1,
        second: true
      })
    );
  });

  it("represents all sources and disables unregistered adapters", async () => {
    const clock = new FakeClock();
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => receipt("gh-1"))
      },
      repository: new MemorySourceSyncRepository(),
      clock,
      attemptIdFactory: idFactory()
    });

    expect((await coordinator.getState("github")).status).toBe(
      "never_synced"
    );
    expect((await coordinator.getState("codex")).status).toBe(
      "disabled"
    );
    expect((await coordinator.getState("notion")).status).toBe(
      "disabled"
    );
    expect(
      (await coordinator.getState("google_calendar")).status
    ).toBe("disabled");
  });

  it("records success metadata, latency, latest state, and history", async () => {
    const clock = new FakeClock();
    const repository = new MemorySourceSyncRepository();
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          clock.advance(25);
          return receipt("gh-1", "a", 7);
        })
      },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      attemptIdFactory: idFactory()
    });

    const result = await coordinator.sync("github");
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.attempt).toMatchObject({
      outcome: "success",
      retryCount: 0,
      latencyMs: 25,
      snapshotRevision: "gh-1",
      snapshotHash: "a".repeat(64),
      itemCount: 7,
      errorCode: null
    });
    expect(result.state).toMatchObject({
      status: "ready",
      retryCount: 0,
      nextDueAt: "2026-07-27T00:00:01.025Z"
    });

    const stored = await repository.read();
    expect(stored.latest.status).toBe("ready");
    expect(stored.history.status).toBe("ready");
    if (
      stored.latest.status !== "ready" ||
      stored.history.status !== "ready"
    ) {
      return;
    }
    expect(
      stored.latest.value.sources.github.latestSnapshot
    ).toMatchObject({
      revision: "gh-1",
      hash: "a".repeat(64),
      itemCount: 7
    });
    expect(stored.history.value.attempts).toHaveLength(1);
    expect(stored.history.value.attempts[0]).toEqual(
      result.attempt
    );
  });

  it("deduplicates concurrent requests for one source", async () => {
    let adapterCalls = 0;
    let resolveStarted: (() => void) | undefined;
    let resolveReceipt:
      | ((value: SourceSnapshotReceipt) => void)
      | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const pendingReceipt = new Promise<SourceSnapshotReceipt>(
      (resolve) => {
        resolveReceipt = resolve;
      }
    );
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        codex: adapter("codex", async () => {
          adapterCalls += 1;
          resolveStarted?.();
          return pendingReceipt;
        })
      },
      repository: new MemorySourceSyncRepository(),
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    const first = coordinator.sync("codex", "manual");
    await started;
    const second = coordinator.sync("codex", "visibility");
    resolveReceipt?.(receipt("codex-1"));
    const [firstResult, secondResult] = await Promise.all([
      first,
      second
    ]);

    expect(adapterCalls).toBe(1);
    expect(firstResult.status).toBe("completed");
    expect(secondResult.status).toBe("completed");
    if (
      firstResult.status === "completed" &&
      secondResult.status === "completed"
    ) {
      expect(firstResult.attempt.attemptId).toBe(
        secondResult.attempt.attemptId
      );
    }
  });

  it("applies deterministic capped backoff and resets it after success", async () => {
    const clock = new FakeClock();
    const repository = new MemorySourceSyncRepository();
    let call = 0;
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          call += 1;
          if (call <= 2) {
            throw {
              code: "RATE_LIMITED",
              message: "super-secret upstream detail"
            };
          }
          return receipt("gh-recovered", "b", 3);
        })
      },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 250
        }
      },
      clock,
      attemptIdFactory: idFactory()
    });

    const first = await coordinator.sync("github");
    expect(first.status).toBe("completed");
    if (first.status !== "completed") return;
    expect(first.attempt).toMatchObject({
      outcome: "failure",
      retryCount: 1,
      errorCode: "RATE_LIMITED"
    });
    expect(first.state.nextDueAt).toBe(
      "2026-07-27T00:00:00.100Z"
    );

    const early = await coordinator.sync("github", "scheduled");
    expect(early).toMatchObject({
      status: "skipped",
      reason: "not_due"
    });

    clock.advance(100);
    const second = await coordinator.sync("github", "scheduled");
    expect(second.status).toBe("completed");
    if (second.status !== "completed") return;
    expect(second.attempt.retryCount).toBe(2);
    expect(second.state.nextDueAt).toBe(
      "2026-07-27T00:00:00.300Z"
    );

    clock.advance(200);
    const recovered = await coordinator.sync(
      "github",
      "scheduled"
    );
    expect(recovered.status).toBe("completed");
    if (recovered.status !== "completed") return;
    expect(recovered.attempt.outcome).toBe("success");
    expect(recovered.state.retryCount).toBe(0);
    expect(recovered.state.lastFailure?.attemptId).toBe(
      second.attempt.attemptId
    );
    expect(JSON.stringify(await repository.read())).not.toContain(
      "super-secret"
    );

    expect(
      exponentialBackoffMs(
        {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 250
        },
        10
      )
    ).toBe(250);
  });

  it("emits only persisted snapshot changes and supports unsubscribe", async () => {
    const snapshots = [
      receipt("revision-1", "a"),
      receipt("revision-1", "a"),
      receipt("revision-1", "b"),
      receipt("revision-2", "c")
    ];
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        notion: adapter("notion", async () => {
          const next = snapshots.shift();
          if (!next) throw new Error("fixture exhausted");
          return next;
        })
      },
      repository: new MemorySourceSyncRepository(),
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });
    const events: Array<{
      previousRevision: string | null;
      revision: string;
      hash: string;
    }> = [];
    const unsubscribe = coordinator.onSnapshotRevisionChange(
      (event) => {
        events.push(event);
      }
    );

    await coordinator.sync("notion");
    await coordinator.sync("notion");
    await coordinator.sync("notion");
    expect(events).toEqual([
      {
        contract: "source-sync-snapshot-event-v1",
        source: "notion",
        observedAt: "2026-07-27T00:00:00.000Z",
        previousRevision: null,
        previousHash: null,
        revision: "revision-1",
        hash: "a".repeat(64),
        itemCount: 1
      },
      {
        contract: "source-sync-snapshot-event-v1",
        source: "notion",
        observedAt: "2026-07-27T00:00:00.000Z",
        previousRevision: "revision-1",
        previousHash: "a".repeat(64),
        revision: "revision-1",
        hash: "b".repeat(64),
        itemCount: 1
      }
    ]);

    unsubscribe();
    await coordinator.sync("notion");
    expect(events).toHaveLength(2);
  });

  it("starts with startup collection, schedules the nearest due time, and stops cleanly", async () => {
    const clock = new FakeClock();
    const timer = new FakeTimer();
    let calls = 0;
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        google_calendar: adapter(
          "google_calendar",
          async () => {
            calls += 1;
            return receipt("calendar-1");
          }
        )
      },
      repository: new MemorySourceSyncRepository(),
      policies: {
        google_calendar: {
          successIntervalMs: 750,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      timer,
      attemptIdFactory: idFactory()
    });

    await coordinator.start();
    expect(coordinator.isRunning()).toBe(true);
    expect(calls).toBe(0);
    expect(timer.delays()).toEqual([0]);

    await coordinator.tick("startup");
    expect(calls).toBe(1);
    expect(timer.delays()).toEqual([750]);

    await coordinator.start();
    expect(calls).toBe(1);
    expect(timer.pendingCount()).toBe(1);

    coordinator.stop();
    expect(coordinator.isRunning()).toBe(false);
    expect(timer.pendingCount()).toBe(0);
  });

  it("disables disconnected sources without retry scheduling and lets a manual sync re-enable them", async () => {
    const clock = new FakeClock();
    const timer = new FakeTimer();
    const repository = new MemorySourceSyncRepository();
    let connected = false;
    let calls = 0;
    const githubAdapter = adapter("github", async () => {
      calls += 1;
      if (!connected) {
        throw new SourceSyncAdapterError(
          "CONNECTOR_DISCONNECTED"
        );
      }
      return receipt("github-reconnected");
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: githubAdapter
      },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      timer,
      attemptIdFactory: idFactory()
    });

    await coordinator.start();
    await coordinator.tick("startup");
    expect(calls).toBe(1);
    expect(await coordinator.getState("github")).toMatchObject({
      status: "disabled",
      nextDueAt: null,
      retryCount: 1
    });
    expect(timer.pendingCount()).toBe(0);

    await coordinator.tick("scheduled");
    expect(calls).toBe(1);
    expect(timer.pendingCount()).toBe(0);

    coordinator.stop();
    const restartedTimer = new FakeTimer();
    const restarted = new SourceSyncCoordinator({
      adapters: { github: githubAdapter },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      timer: restartedTimer,
      attemptIdFactory: idFactory()
    });
    await restarted.start();
    expect(await restarted.getState("github")).toMatchObject({
      status: "disabled",
      nextDueAt: null
    });
    expect(calls).toBe(1);
    expect(restartedTimer.pendingCount()).toBe(0);

    connected = true;
    const reconnected = await restarted.sync("github", "manual");
    expect(reconnected.status).toBe("completed");
    if (reconnected.status !== "completed") return;
    expect(reconnected.state).toMatchObject({
      status: "ready",
      retryCount: 0,
      nextDueAt: "2026-07-27T00:00:01.000Z"
    });
    expect(calls).toBe(2);
    expect(restartedTimer.delays()).toEqual([1_000]);

    restarted.stop();
  });

  it.each([
    "REAUTHORIZATION_REQUIRED",
    "REFRESH_TOKEN_EXPIRED",
    "REFRESH_TOKEN_MISSING",
    "NOT_CONNECTED"
  ])(
    "disables terminal credential failure %s until a manual reconnect",
    async (errorCode) => {
      const timer = new FakeTimer();
      let authorized = false;
      let calls = 0;
      const coordinator = new SourceSyncCoordinator({
        adapters: {
          notion: adapter("notion", async () => {
            calls += 1;
            if (!authorized) {
              throw new SourceSyncAdapterError(errorCode);
            }
            return receipt("notion-reconnected");
          })
        },
        repository: new MemorySourceSyncRepository(),
        clock: new FakeClock(),
        timer,
        attemptIdFactory: idFactory()
      });

      await coordinator.start();
      await coordinator.tick("startup");
      expect(await coordinator.getState("notion")).toMatchObject({
        status: "disabled",
        nextDueAt: null,
        lastFailure: { errorCode }
      });
      expect(timer.pendingCount()).toBe(0);

      await coordinator.tick("scheduled");
      expect(calls).toBe(1);

      authorized = true;
      const recovered = await coordinator.sync("notion", "manual");
      expect(recovered.status).toBe("completed");
      if (recovered.status !== "completed") return;
      expect(recovered.state).toMatchObject({
        status: "ready",
        retryCount: 0
      });
      expect(calls).toBe(2);
      coordinator.stop();
    }
  );

  it("marks disconnect immediately and ignores a stale in-flight settlement", async () => {
    const repository = new MemorySourceSyncRepository();
    let calls = 0;
    let releaseStale!: () => void;
    let markStaleStarted!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    const staleStarted = new Promise<void>((resolve) => {
      markStaleStarted = resolve;
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          calls += 1;
          if (calls === 1) return receipt("github-current");
          markStaleStarted();
          await staleGate;
          return receipt("github-stale", "b");
        })
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await coordinator.sync("github", "manual");
    const staleSync = coordinator.sync("github", "manual");
    await staleStarted;

    await expect(
      coordinator.markDisconnected("github")
    ).resolves.toMatchObject({
      status: "disabled",
      nextDueAt: null,
      latestSnapshot: null,
      lastFailure: {
        errorCode: "CONNECTOR_DISCONNECTED"
      }
    });

    releaseStale();
    await expect(staleSync).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
      state: {
        status: "disabled",
        latestSnapshot: null
      }
    });
    const stored = await repository.read();
    expect(stored.history).toMatchObject({
      status: "ready",
      value: {
        attempts: [
          { outcome: "success" },
          {
            outcome: "failure",
            errorCode: "CONNECTOR_DISCONNECTED"
          }
        ]
      }
    });
  });

  it("starts a clean connection generation without mixing the previous account lineage", async () => {
    const repository = new MemorySourceSyncRepository();
    let phase:
      | "account_a_initial"
      | "account_a_stale"
      | "account_b_failure" = "account_a_initial";
    let releaseStale!: () => void;
    let markStaleStarted!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    const staleStarted = new Promise<void>((resolve) => {
      markStaleStarted = resolve;
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        google_calendar: adapter(
          "google_calendar",
          async () => {
            if (phase === "account_a_initial") {
              return receipt("account-a-snapshot");
            }
            if (phase === "account_a_stale") {
              markStaleStarted();
              await staleGate;
              return receipt("account-a-stale", "b");
            }
            throw new SourceSyncAdapterError(
              "ACCOUNT_B_SYNC_FAILED"
            );
          }
        )
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await coordinator.sync("google_calendar", "manual");
    phase = "account_a_stale";
    const staleSync = coordinator.sync(
      "google_calendar",
      "manual"
    );
    await staleStarted;

    await expect(
      coordinator.beginConnectionGeneration("google_calendar")
    ).resolves.toEqual({
      contract: "source-sync-state-v1",
      source: "google_calendar",
      status: "never_synced",
      updatedAt: "2026-07-27T00:00:00.000Z",
      retryCount: 0,
      nextDueAt: "2026-07-27T00:00:00.000Z",
      lastAttempt: null,
      lastSuccess: null,
      lastFailure: null,
      latestSnapshot: null
    });
    const resetStore = await repository.read();
    expect(resetStore.history).toMatchObject({
      status: "ready",
      value: { attempts: [] }
    });

    phase = "account_b_failure";
    const failed = await coordinator.sync(
      "google_calendar",
      "manual"
    );
    expect(failed).toMatchObject({
      status: "completed",
      state: {
        status: "retry_wait",
        lastAttempt: {
          errorCode: "ACCOUNT_B_SYNC_FAILED"
        },
        lastSuccess: null,
        lastFailure: {
          errorCode: "ACCOUNT_B_SYNC_FAILED"
        },
        latestSnapshot: null
      }
    });

    releaseStale();
    await expect(staleSync).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
      state: {
        lastSuccess: null,
        lastFailure: {
          errorCode: "ACCOUNT_B_SYNC_FAILED"
        },
        latestSnapshot: null
      }
    });
    const stored = await repository.read();
    expect(stored.history).toMatchObject({
      status: "ready",
      value: {
        attempts: [
          {
            source: "google_calendar",
            outcome: "failure",
            errorCode: "ACCOUNT_B_SYNC_FAILED",
            snapshotRevision: null
          }
        ]
      }
    });
  });

  it("keeps a failed connection-generation write recoverable and purges lineage before the next adapter call", async () => {
    const repository = new FailureInjectingRepository();
    const clock = new FakeClock();
    const timer = new FakeTimer();
    let phase: "initial" | "stale" | "replacement" = "initial";
    let releaseStale!: () => void;
    let markStaleStarted!: () => void;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    const staleStarted = new Promise<void>((resolve) => {
      markStaleStarted = resolve;
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          if (phase === "initial") return receipt("account-a");
          if (phase === "stale") {
            markStaleStarted();
            await staleGate;
            return receipt("account-a-stale", "b");
          }
          return receipt("account-b", "c");
        })
      },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      timer,
      attemptIdFactory: idFactory()
    });

    await coordinator.sync("github", "manual");
    await coordinator.start();
    phase = "stale";
    const stale = coordinator.sync("github", "manual");
    await staleStarted;
    repository.failNextLineageReplacement = true;

    await expect(
      coordinator.beginConnectionGeneration("github")
    ).rejects.toMatchObject({
      code: "STORE_WRITE_FAILED"
    });
    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "never_synced",
      lastAttempt: null,
      lastSuccess: null,
      lastFailure: null,
      latestSnapshot: null
    });
    expect(timer.delays()).toEqual([100]);

    releaseStale();
    await expect(stale).resolves.toMatchObject({
      status: "skipped",
      reason: "superseded",
      state: { status: "never_synced" }
    });

    phase = "replacement";
    await coordinator.tick("scheduled");
    expect(timer.delays()).toEqual([100]);
    clock.advance(100);
    await coordinator.tick("scheduled");
    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "ready",
      latestSnapshot: { revision: "account-b" }
    });
    const stored = await repository.read();
    expect(stored.history).toMatchObject({
      status: "ready",
      value: {
        attempts: [
          {
            source: "github",
            snapshotRevision: "account-b"
          }
        ]
      }
    });
    coordinator.stop();
  });

  it("blocks adapter execution until a connection-generation barrier is durably stored", async () => {
    const repository = new FailureInjectingRepository();
    const timer = new FakeTimer();
    let releaseLineage!: () => void;
    let markLineageStarted!: () => void;
    const lineageGate = new Promise<void>((resolve) => {
      releaseLineage = resolve;
    });
    const lineageStarted = new Promise<void>((resolve) => {
      markLineageStarted = resolve;
    });
    repository.lineageReplacementBarrier = {
      started: markLineageStarted,
      gate: lineageGate
    };
    let adapterCalls = 0;
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          adapterCalls += 1;
          return receipt("new-generation");
        })
      },
      repository,
      clock: new FakeClock(),
      timer,
      attemptIdFactory: idFactory()
    });

    await coordinator.start();
    const transition =
      coordinator.beginConnectionGeneration("github");
    await lineageStarted;
    await expect(
      coordinator.sync("github", "manual")
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "transition_in_progress"
    });
    expect(adapterCalls).toBe(0);
    await coordinator.tick("scheduled");
    expect(timer.pendingCount()).toBe(0);

    releaseLineage();
    await transition;
    expect(timer.delays()).toEqual([0]);
    await coordinator.sync("github", "manual");
    expect(adapterCalls).toBe(1);
    coordinator.stop();
  });

  it("keeps a disconnect disabled in memory when its audit write fails", async () => {
    const repository = new FailureInjectingRepository();
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => receipt("connected"))
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });
    await coordinator.sync("github", "manual");
    repository.failNextCommit = true;

    await expect(
      coordinator.markDisconnected("github")
    ).rejects.toMatchObject({
      code: "STORE_WRITE_FAILED"
    });
    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "disabled",
      nextDueAt: null,
      latestSnapshot: null,
      lastFailure: {
        errorCode: "CONNECTOR_DISCONNECTED"
      }
    });
    await expect(
      coordinator.sync("github", "scheduled")
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "not_due",
      state: { status: "disabled" }
    });
  });

  it("blocks manual adapter execution while disconnect persistence is in flight", async () => {
    const repository = new FailureInjectingRepository();
    let adapterCalls = 0;
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          adapterCalls += 1;
          return receipt("connected");
        })
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });
    await coordinator.sync("github", "manual");

    let releaseCommit!: () => void;
    let markCommitStarted!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    repository.commitBarrier = {
      started: markCommitStarted,
      gate: commitGate
    };

    const disconnect = coordinator.markDisconnected("github");
    await commitStarted;
    await expect(
      coordinator.sync("github", "manual")
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "transition_in_progress"
    });
    expect(adapterCalls).toBe(1);

    releaseCommit();
    await disconnect;
    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "disabled",
      latestSnapshot: null
    });
  });

  it("recovers a failed disconnect finalization from its durable intent after restart", async () => {
    const repository = new FailureInjectingRepository();
    const clock = new FakeClock();
    const first = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => receipt("connected"))
      },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      attemptIdFactory: idFactory()
    });
    await first.sync("github", "manual");
    repository.failNextCommit = true;

    await expect(first.markDisconnected("github")).rejects.toMatchObject({
      code: "STORE_WRITE_FAILED"
    });
    const interrupted = await repository.read();
    expect(interrupted.transitions).toMatchObject({
      status: "ready",
      value: {
        transitions: [
          {
            source: "github",
            kind: "disconnect",
            failureCount: 1,
            retryAt: "2026-07-27T00:00:00.100Z"
          }
        ]
      }
    });

    let restartedAdapterCalls = 0;
    const restarted = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          restartedAdapterCalls += 1;
          return receipt("must-not-run");
        })
      },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      attemptIdFactory: idFactory()
    });
    await expect(restarted.getState("github")).resolves.toMatchObject({
      status: "disabled",
      latestSnapshot: null
    });
    clock.advance(100);
    await restarted.tick("scheduled");

    expect(restartedAdapterCalls).toBe(0);
    const recovered = await repository.read();
    expect(recovered.transitions).toMatchObject({
      status: "ready",
      value: { transitions: [] }
    });
    if (recovered.history.status === "ready") {
      expect(
        recovered.history.value.attempts.filter(
          (attempt) =>
            attempt.errorCode === "CONNECTOR_DISCONNECTED"
        )
      ).toHaveLength(1);
    }
    expect(recovered.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: { status: "disabled", latestSnapshot: null }
        }
      }
    });
  });

  it("preserves a pending lineage intent across another source commit and purges it before restart collection", async () => {
    const repository = new FailureInjectingRepository();
    const clock = new FakeClock();
    let githubRevision = "account-a";
    const first = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () =>
          receipt(githubRevision)
        ),
        codex: adapter("codex", async () =>
          receipt("codex-current", "b")
        )
      },
      repository,
      policies: {
        github: {
          successIntervalMs: 1_000,
          failureBackoffBaseMs: 100,
          failureBackoffMaxMs: 1_000
        }
      },
      clock,
      attemptIdFactory: idFactory()
    });
    await first.sync("github", "manual");
    await first.sync("codex", "manual");
    repository.failNextLineageReplacement = true;

    await expect(
      first.beginConnectionGeneration("github")
    ).rejects.toMatchObject({ code: "STORE_WRITE_FAILED" });
    await first.sync("codex", "manual");
    const afterOtherCommit = await repository.read();
    expect(afterOtherCommit.transitions).toMatchObject({
      status: "ready",
      value: {
        transitions: [
          { source: "github", kind: "reset_lineage" }
        ]
      }
    });
    expect(afterOtherCommit.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "never_synced",
            lastSuccess: null,
            latestSnapshot: null
          },
          codex: { status: "ready" }
        }
      }
    });

    githubRevision = "account-b";
    let lineageWasPurgedBeforeAdapter = false;
    const restarted = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          const observed = await repository.read();
          lineageWasPurgedBeforeAdapter =
            observed.transitions.status === "ready" &&
            observed.transitions.value.transitions.length === 0 &&
            observed.history.status === "ready" &&
            observed.history.value.attempts.every(
              (attempt) => attempt.source !== "github"
            );
          return receipt(githubRevision, "c");
        }),
        codex: adapter("codex", async () =>
          receipt("codex-current", "b")
        )
      },
      repository,
      clock,
      attemptIdFactory: idFactory()
    });
    await restarted.sync("github", "manual");

    expect(lineageWasPurgedBeforeAdapter).toBe(true);
    const recovered = await repository.read();
    expect(recovered.transitions).toMatchObject({
      status: "ready",
      value: { transitions: [] }
    });
    if (recovered.history.status === "ready") {
      const githubAttempts = recovered.history.value.attempts.filter(
        (attempt) => attempt.source === "github"
      );
      expect(githubAttempts).toHaveLength(1);
      expect(githubAttempts[0]?.snapshotRevision).toBe("account-b");
      expect(
        recovered.history.value.attempts.some(
          (attempt) => attempt.source === "codex"
        )
      ).toBe(true);
    }
  });

  it("serializes reset then disconnect for one source", async () => {
    const repository = new FailureInjectingRepository();
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => receipt("account-a"))
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });
    await coordinator.sync("github", "manual");

    let releaseReset!: () => void;
    let markResetStarted!: () => void;
    const resetGate = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });
    const resetStarted = new Promise<void>((resolve) => {
      markResetStarted = resolve;
    });
    repository.lineageReplacementBarrier = {
      started: markResetStarted,
      gate: resetGate
    };

    const reset = coordinator.beginConnectionGeneration("github");
    await resetStarted;
    const disconnect = coordinator.markDisconnected("github");
    releaseReset();
    await Promise.all([reset, disconnect]);

    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "disabled",
      lastSuccess: null,
      latestSnapshot: null,
      lastFailure: { errorCode: "CONNECTOR_DISCONNECTED" }
    });
    const stored = await repository.read();
    if (stored.history.status === "ready") {
      expect(stored.history.value.attempts).toHaveLength(1);
      expect(stored.history.value.attempts[0]).toMatchObject({
        source: "github",
        errorCode: "CONNECTOR_DISCONNECTED"
      });
    }
  });

  it("serializes disconnect then reset and leaves no prior source history", async () => {
    const repository = new FailureInjectingRepository();
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => receipt("account-a"))
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });
    await coordinator.sync("github", "manual");

    let releaseDisconnect!: () => void;
    let markDisconnectStarted!: () => void;
    const disconnectGate = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    const disconnectStarted = new Promise<void>((resolve) => {
      markDisconnectStarted = resolve;
    });
    repository.commitBarrier = {
      started: markDisconnectStarted,
      gate: disconnectGate
    };

    const disconnect = coordinator.markDisconnected("github");
    await disconnectStarted;
    const reset = coordinator.beginConnectionGeneration("github");
    releaseDisconnect();
    await Promise.all([disconnect, reset]);

    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "never_synced",
      lastAttempt: null,
      lastSuccess: null,
      lastFailure: null,
      latestSnapshot: null
    });
    const stored = await repository.read();
    expect(stored.history).toMatchObject({
      status: "ready",
      value: { attempts: [] }
    });
    expect(stored.transitions).toMatchObject({
      status: "ready",
      value: { transitions: [] }
    });
  });

  it("merges concurrent completions from different sources", async () => {
    const repository = new MemorySourceSyncRepository();
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => receipt("github-1")),
        codex: adapter("codex", async () => receipt("codex-1"))
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await Promise.all([
      coordinator.sync("github"),
      coordinator.sync("codex")
    ]);
    expect((await coordinator.getState("github")).status).toBe(
      "ready"
    );
    expect((await coordinator.getState("codex")).status).toBe(
      "ready"
    );
    const stored = await repository.read();
    expect(stored.history.status).toBe("ready");
    if (stored.history.status === "ready") {
      expect(stored.history.value.attempts).toHaveLength(2);
    }
  });
});

describe("SourceSyncRepository", () => {
  it("distinguishes missing, malformed JSON, and schema mismatch", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    const repository = new FileSystemSourceSyncRepository(directory);

    expect(await repository.read()).toEqual({
      latest: { status: "missing" },
      history: { status: "missing" },
      transitions: { status: "missing" },
      settlements: { status: "missing" }
    });

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "latest.json"), "{not-json", "utf8");
    let result = await repository.read();
    expect(result.latest).toEqual({
      status: "invalid",
      reason: "invalid_json"
    });
    expect(result.history).toEqual({ status: "missing" });

    await writeFile(
      join(directory, "latest.json"),
      JSON.stringify({ contract: "wrong-contract" }),
      "utf8"
    );
    result = await repository.read();
    expect(result.latest).toEqual({
      status: "invalid",
      reason: "schema_mismatch"
    });
  });

  it("writes latest and bounded ordered history atomically with private modes", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    const repository = new FileSystemSourceSyncRepository(directory, {
      maxHistory: 2
    });
    const clock = new FakeClock();
    let revision = 0;
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          revision += 1;
          clock.advance(10);
          return receipt(`revision-${revision}`, "c", revision);
        })
      },
      repository,
      clock,
      attemptIdFactory: idFactory()
    });

    await coordinator.sync("github");
    await coordinator.sync("github");
    await coordinator.sync("github");

    const stored = await repository.read();
    expect(stored.latest.status).toBe("ready");
    expect(stored.history.status).toBe("ready");
    if (stored.history.status !== "ready") return;
    expect(stored.history.value.attempts).toHaveLength(2);
    expect(
      stored.history.value.attempts.map(
        (attempt) => attempt.snapshotRevision
      )
    ).toEqual(["revision-3", "revision-2"]);

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(directory, "latest.json"))).mode & 0o777
    ).toBe(0o600);
    expect(
      (await stat(join(directory, "history.json"))).mode & 0o777
    ).toBe(0o600);
    expect(
      (await stat(join(directory, "settlements.json"))).mode & 0o777
    ).toBe(0o600);
    const latestText = await readFile(
      join(directory, "latest.json"),
      "utf8"
    );
    expect(latestText).toBe(
      safePrettyJson(JSON.parse(latestText) as unknown)
    );
    const filenames = await import("node:fs/promises").then((fs) =>
      fs.readdir(directory)
    );
    expect(filenames.sort()).toEqual([
      "history.json",
      "latest.json",
      "settlements.json"
    ]);
  });

  it("recovers an exact disabled-to-manual-success settlement after a history-first crash", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    const clock = new FakeClock();
    let adapterCalls = 0;
    let allowSuccess = false;
    let failuresAfterHistory = 0;
    const syncAdapter = adapter("github", async () => {
      adapterCalls += 1;
      if (!allowSuccess) {
        throw new SourceSyncAdapterError(
          "REAUTHORIZATION_REQUIRED"
        );
      }
      return receipt("github-reconnected", "d", 3);
    });
    const interruptedRepository =
      new FileSystemSourceSyncRepository(directory, {
        faultInjector: (point) => {
          if (
            point === "commit_after_history" &&
            failuresAfterHistory > 0
          ) {
            failuresAfterHistory -= 1;
            throw new Error("injected history-first crash");
          }
        }
      });
    const interruptedCoordinator = new SourceSyncCoordinator({
      adapters: { github: syncAdapter },
      repository: interruptedRepository,
      clock,
      attemptIdFactory: idFactory()
    });

    const disabled = await interruptedCoordinator.sync(
      "github",
      "manual"
    );
    expect(disabled).toMatchObject({
      status: "completed",
      state: {
        status: "disabled",
        lastFailure: {
          errorCode: "REAUTHORIZATION_REQUIRED"
        }
      }
    });

    clock.advance(10);
    allowSuccess = true;
    // Fail both the initial projection and the same-process confirmation to
    // emulate a process that cannot finish recovery before restart.
    failuresAfterHistory = 2;
    await expect(
      interruptedCoordinator.sync("github", "manual")
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncCoordinatorError>>({
        code: "STORE_WRITE_FAILED"
      })
    );

    const partialLatest = JSON.parse(
      await readFile(join(directory, "latest.json"), "utf8")
    ) as {
      sources: {
        github: {
          status: string;
          lastAttempt: { attemptId: string };
        };
      };
    };
    const partialHistory = JSON.parse(
      await readFile(join(directory, "history.json"), "utf8")
    ) as {
      attempts: Array<{
        attemptId: string;
        outcome: string;
        snapshotRevision: string | null;
      }>;
    };
    const pendingSettlement = JSON.parse(
      await readFile(join(directory, "settlements.json"), "utf8")
    ) as {
      settlement: {
        attempt: { attemptId: string };
        latest: {
          sources: { github: { status: string } };
        };
      } | null;
    };
    expect(partialLatest.sources.github.status).toBe("disabled");
    expect(partialHistory.attempts[0]).toMatchObject({
      outcome: "success",
      snapshotRevision: "github-reconnected"
    });
    expect(pendingSettlement.settlement).toMatchObject({
      attempt: {
        attemptId: partialHistory.attempts[0].attemptId
      },
      latest: {
        sources: { github: { status: "ready" } }
      }
    });

    const restartedRepository =
      new FileSystemSourceSyncRepository(directory);
    const restartedCoordinator = new SourceSyncCoordinator({
      adapters: { github: syncAdapter },
      repository: restartedRepository,
      clock,
      attemptIdFactory: idFactory()
    });
    const recovered = await restartedCoordinator.getState("github");
    expect(recovered).toMatchObject({
      status: "ready",
      retryCount: 0,
      lastAttempt: {
        attemptId: partialHistory.attempts[0].attemptId,
        outcome: "success"
      },
      lastSuccess: {
        attemptId: partialHistory.attempts[0].attemptId
      },
      latestSnapshot: {
        attemptId: partialHistory.attempts[0].attemptId,
        revision: "github-reconnected"
      }
    });
    expect(adapterCalls).toBe(2);

    const stored = await restartedRepository.read();
    expect(stored.settlements).toMatchObject({
      status: "ready",
      value: { settlement: null }
    });
    expect(stored.history).toMatchObject({
      status: "ready",
      value: {
        attempts: [
          {
            attemptId: partialHistory.attempts[0].attemptId,
            outcome: "success"
          },
          {
            attemptId: partialLatest.sources.github.lastAttempt.attemptId,
            outcome: "failure"
          }
        ]
      }
    });
  });

  it("confirms a one-shot partial settlement in the same process without leaving a disabled source stalled", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    const clock = new FakeClock();
    let allowSuccess = false;
    let injectOnce = false;
    let adapterCalls = 0;
    const repository = new FileSystemSourceSyncRepository(directory, {
      faultInjector: (point) => {
        if (point === "commit_after_history" && injectOnce) {
          injectOnce = false;
          throw new Error("injected one-shot projection failure");
        }
      }
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          adapterCalls += 1;
          if (!allowSuccess) {
            throw new SourceSyncAdapterError(
              "REAUTHORIZATION_REQUIRED"
            );
          }
          return receipt("github-same-process-recovery", "f");
        })
      },
      repository,
      clock,
      attemptIdFactory: idFactory()
    });

    await expect(
      coordinator.sync("github", "manual")
    ).resolves.toMatchObject({
      status: "completed",
      state: { status: "disabled" }
    });
    clock.advance(10);
    allowSuccess = true;
    injectOnce = true;
    await expect(
      coordinator.sync("github", "manual")
    ).resolves.toMatchObject({
      status: "completed",
      state: {
        status: "ready",
        latestSnapshot: {
          revision: "github-same-process-recovery"
        }
      }
    });
    expect(adapterCalls).toBe(2);
    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "ready",
      retryCount: 0
    });
    const stored = await repository.read();
    expect(stored.settlements).toMatchObject({
      status: "ready",
      value: { settlement: null }
    });
  });

  it("preserves a recovered source when another source commits in the same process", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    let githubAdapterCalls = 0;
    let failuresAfterGithubHistory = 2;
    const repository = new FileSystemSourceSyncRepository(directory, {
      faultInjector: (point) => {
        if (
          point === "commit_after_history" &&
          failuresAfterGithubHistory > 0
        ) {
          failuresAfterGithubHistory -= 1;
          throw new Error("injected durable GitHub settlement");
        }
      }
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          githubAdapterCalls += 1;
          return receipt("github-recovered-before-codex", "7");
        }),
        codex: adapter("codex", async () =>
          receipt("codex-follow-up", "8")
        )
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await expect(
      coordinator.sync("github", "manual")
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncCoordinatorError>>({
        code: "STORE_WRITE_FAILED"
      })
    );
    expect(githubAdapterCalls).toBe(1);
    expect(
      JSON.parse(
        await readFile(join(directory, "settlements.json"), "utf8")
      )
    ).toMatchObject({
      settlement: {
        source: "github",
        latest: {
          sources: {
            github: {
              status: "ready",
              latestSnapshot: {
                revision: "github-recovered-before-codex"
              }
            }
          }
        }
      }
    });

    await expect(
      coordinator.sync("codex", "manual")
    ).resolves.toMatchObject({
      status: "completed",
      state: {
        status: "ready",
        latestSnapshot: { revision: "codex-follow-up" }
      }
    });
    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "ready",
      latestSnapshot: {
        revision: "github-recovered-before-codex"
      }
    });
    expect(githubAdapterCalls).toBe(1);

    const stored = await repository.read();
    expect(stored.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "ready",
            latestSnapshot: {
              revision: "github-recovered-before-codex"
            }
          },
          codex: {
            status: "ready",
            latestSnapshot: { revision: "codex-follow-up" }
          }
        }
      }
    });
    expect(stored.history.status).toBe("ready");
    if (stored.history.status === "ready") {
      expect(stored.history.value.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "github",
            snapshotRevision: "github-recovered-before-codex"
          }),
          expect.objectContaining({
            source: "codex",
            snapshotRevision: "codex-follow-up"
          })
        ])
      );
      expect(stored.history.value.attempts).toHaveLength(2);
    }
    expect(stored.settlements).toMatchObject({
      status: "ready",
      value: { settlement: null }
    });
  });

  it("preserves persisted snapshots when a stale coordinator commits another source", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    const ids = idFactory();
    let releaseGithubCommit!: () => void;
    let markGithubCommitPaused!: () => void;
    let pauseGithubCommit = true;
    const githubCommitGate = new Promise<void>((resolve) => {
      releaseGithubCommit = resolve;
    });
    const githubCommitPaused = new Promise<void>((resolve) => {
      markGithubCommitPaused = resolve;
    });
    const githubRepository =
      new FileSystemSourceSyncRepository(directory, {
        faultInjector: async (point) => {
          if (
            point === "commit_after_history" &&
            pauseGithubCommit
          ) {
            pauseGithubCommit = false;
            markGithubCommitPaused();
            await githubCommitGate;
          }
        }
      });
    const codexRepository =
      new FileSystemSourceSyncRepository(directory);
    const githubCoordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () =>
          receipt("github-cross-route", "1", 11)
        )
      },
      repository: githubRepository,
      clock: new FakeClock(),
      attemptIdFactory: ids
    });
    const codexCoordinator = new SourceSyncCoordinator({
      adapters: {
        codex: adapter("codex", async () =>
          receipt("codex-cross-route", "2", 22)
        )
      },
      repository: codexRepository,
      clock: new FakeClock(),
      attemptIdFactory: ids
    });

    await Promise.all([
      githubCoordinator.getLatestStore(),
      codexCoordinator.getLatestStore()
    ]);
    const githubSync = githubCoordinator.sync("github", "manual");
    await githubCommitPaused;
    const codexSync = codexCoordinator.sync("codex", "manual");
    releaseGithubCommit();
    await Promise.all([githubSync, codexSync]);

    const stored = await codexRepository.read();
    expect(stored.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "ready",
            latestSnapshot: {
              revision: "github-cross-route",
              hash: "1".repeat(64),
              itemCount: 11
            }
          },
          codex: {
            status: "ready",
            latestSnapshot: {
              revision: "codex-cross-route",
              hash: "2".repeat(64),
              itemCount: 22
            }
          }
        }
      }
    });
    expect(stored.history).toMatchObject({
      status: "ready",
      value: {
        attempts: expect.arrayContaining([
          expect.objectContaining({
            source: "github",
            snapshotRevision: "github-cross-route"
          }),
          expect.objectContaining({
            source: "codex",
            snapshotRevision: "codex-cross-route"
          })
        ])
      }
    });
    expect(stored.latest.status).toBe("ready");
    expect(stored.history.status).toBe("ready");
    expect(stored.settlements.status).toBe("ready");
    if (
      stored.latest.status === "ready" &&
      stored.history.status === "ready" &&
      stored.settlements.status === "ready"
    ) {
      const githubAttempt = stored.history.value.attempts.find(
        (attempt) => attempt.source === "github"
      );
      const codexAttempt = stored.history.value.attempts.find(
        (attempt) => attempt.source === "codex"
      );
      expect(stored.history.value.attempts).toHaveLength(2);
      expect(githubAttempt).toBeDefined();
      expect(codexAttempt).toBeDefined();
      expect(
        stored.latest.value.sources.github.lastSuccess?.attemptId
      ).toBe(githubAttempt?.attemptId);
      expect(
        stored.latest.value.sources.codex.lastSuccess?.attemptId
      ).toBe(codexAttempt?.attemptId);
      expect(
        stored.latest.value.sources.github.latestSnapshot?.hash
      ).toBe(githubAttempt?.snapshotHash);
      expect(
        stored.latest.value.sources.codex.latestSnapshot?.hash
      ).toBe(codexAttempt?.snapshotHash);
      expect(stored.history.value.updatedAt).toBe(
        stored.latest.value.updatedAt
      );
      expect(stored.settlements.value.updatedAt).toBe(
        stored.latest.value.updatedAt
      );
      expect(stored.settlements.value.settlement).toBeNull();
    }
  });

  it("preserves a recovered source when another source disconnects in the same process", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    let githubAdapterCalls = 0;
    let failuresAfterGithubHistory = 2;
    const repository = new FileSystemSourceSyncRepository(directory, {
      faultInjector: (point) => {
        if (
          point === "commit_after_history" &&
          failuresAfterGithubHistory > 0
        ) {
          failuresAfterGithubHistory -= 1;
          throw new Error("injected durable GitHub settlement");
        }
      }
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          githubAdapterCalls += 1;
          return receipt(
            "github-recovered-before-codex-disconnect",
            "c"
          );
        }),
        codex: adapter("codex", async () =>
          receipt("unused-codex-adapter", "d")
        )
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await expect(
      coordinator.sync("github", "manual")
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncCoordinatorError>>({
        code: "STORE_WRITE_FAILED"
      })
    );
    await expect(
      coordinator.markDisconnected("codex")
    ).resolves.toMatchObject({
      status: "disabled",
      lastFailure: {
        errorCode: "CONNECTOR_DISCONNECTED"
      }
    });

    await expect(coordinator.getState("github")).resolves.toMatchObject({
      status: "ready",
      latestSnapshot: {
        revision: "github-recovered-before-codex-disconnect"
      }
    });
    expect(githubAdapterCalls).toBe(1);
    const stored = await repository.read();
    expect(stored.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "ready",
            latestSnapshot: {
              revision: "github-recovered-before-codex-disconnect"
            }
          },
          codex: {
            status: "disabled",
            lastFailure: {
              errorCode: "CONNECTOR_DISCONNECTED"
            }
          }
        }
      }
    });
    expect(stored.history.status).toBe("ready");
    if (stored.history.status === "ready") {
      expect(stored.history.value.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "github",
            outcome: "success",
            snapshotRevision:
              "github-recovered-before-codex-disconnect"
          }),
          expect.objectContaining({
            source: "codex",
            outcome: "failure",
            errorCode: "CONNECTOR_DISCONNECTED"
          })
        ])
      );
      expect(stored.history.value.attempts).toHaveLength(2);
    }
    expect(stored.transitions).toMatchObject({
      status: "ready",
      value: { transitions: [] }
    });
    expect(stored.settlements).toMatchObject({
      status: "ready",
      value: { settlement: null }
    });
  });

  it("builds a same-source disconnect from its recovered settlement state", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    let githubAdapterCalls = 0;
    let failuresAfterGithubHistory = 2;
    const repository = new FileSystemSourceSyncRepository(directory, {
      faultInjector: (point) => {
        if (
          point === "commit_after_history" &&
          failuresAfterGithubHistory > 0
        ) {
          failuresAfterGithubHistory -= 1;
          throw new Error("injected durable GitHub settlement");
        }
      }
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () => {
          githubAdapterCalls += 1;
          return receipt(
            "github-recovered-before-own-disconnect",
            "e"
          );
        })
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await expect(
      coordinator.sync("github", "manual")
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncCoordinatorError>>({
        code: "STORE_WRITE_FAILED"
      })
    );
    await expect(
      coordinator.markDisconnected("github")
    ).resolves.toMatchObject({
      status: "disabled",
      retryCount: 1,
      lastSuccess: {
        outcome: "success",
        snapshotRevision:
          "github-recovered-before-own-disconnect"
      },
      lastFailure: {
        outcome: "failure",
        retryCount: 1,
        errorCode: "CONNECTOR_DISCONNECTED"
      },
      latestSnapshot: null
    });
    expect(githubAdapterCalls).toBe(1);

    const stored = await repository.read();
    expect(stored.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "disabled",
            retryCount: 1,
            lastSuccess: {
              snapshotRevision:
                "github-recovered-before-own-disconnect"
            },
            lastFailure: {
              retryCount: 1,
              errorCode: "CONNECTOR_DISCONNECTED"
            },
            latestSnapshot: null
          }
        }
      }
    });
    expect(stored.history.status).toBe("ready");
    if (stored.history.status === "ready") {
      expect(stored.history.value.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "github",
            outcome: "success",
            retryCount: 0,
            snapshotRevision:
              "github-recovered-before-own-disconnect"
          }),
          expect.objectContaining({
            source: "github",
            outcome: "failure",
            retryCount: 1,
            errorCode: "CONNECTOR_DISCONNECTED"
          })
        ])
      );
      expect(stored.history.value.attempts).toHaveLength(2);
    }
  });

  it("waits for an unrelated transition queue before a registered adapter uses recovered previous state", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    let failuresAfterGithubHistory = 2;
    let githubAdapterCalls = 0;
    const observedPreviousRevisions: Array<string | null> = [];
    const repository =
      new TransitionBarrierFileSystemRepository(directory, {
        faultInjector: (point) => {
          if (
            point === "commit_after_history" &&
            failuresAfterGithubHistory > 0
          ) {
            failuresAfterGithubHistory -= 1;
            throw new Error("injected durable GitHub settlement");
          }
        }
      });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async (context) => {
          githubAdapterCalls += 1;
          observedPreviousRevisions.push(
            context.previousSnapshot?.revision ?? null
          );
          return receipt(
            githubAdapterCalls === 1
              ? "github-before-unrelated-transition"
              : "github-after-unrelated-transition",
            "f"
          );
        }),
        codex: adapter("codex", async () =>
          receipt("unused-codex-adapter", "0")
        )
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await expect(
      coordinator.sync("github", "manual")
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncCoordinatorError>>({
        code: "STORE_WRITE_FAILED"
      })
    );

    let releaseTransition!: () => void;
    let markTransitionStarted!: () => void;
    const transitionGate = new Promise<void>((resolve) => {
      releaseTransition = resolve;
    });
    const transitionStarted = new Promise<void>((resolve) => {
      markTransitionStarted = resolve;
    });
    repository.transitionBarrier = {
      source: "codex",
      started: markTransitionStarted,
      gate: transitionGate
    };
    const transition =
      coordinator.beginConnectionGeneration("codex");
    await transitionStarted;

    let githubSyncSettled = false;
    const githubSync = coordinator
      .sync("github", "manual")
      .finally(() => {
        githubSyncSettled = true;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(githubAdapterCalls).toBe(1);
    expect(githubSyncSettled).toBe(false);

    releaseTransition();
    await transition;
    await expect(githubSync).resolves.toMatchObject({
      status: "completed",
      state: {
        status: "ready",
        latestSnapshot: {
          revision: "github-after-unrelated-transition"
        }
      }
    });
    expect(githubAdapterCalls).toBe(2);
    expect(observedPreviousRevisions).toEqual([
      null,
      "github-before-unrelated-transition"
    ]);

    const stored = await repository.read();
    expect(stored.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "ready",
            latestSnapshot: {
              revision: "github-after-unrelated-transition"
            }
          },
          codex: {
            status: "never_synced",
            latestSnapshot: null
          }
        }
      }
    });
    expect(stored.history.status).toBe("ready");
    if (stored.history.status === "ready") {
      expect(
        stored.history.value.attempts.filter(
          (attempt) => attempt.source === "github"
        )
      ).toHaveLength(2);
    }
  });

  it("does not persist another source's caller normalization during commit", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    const ids = idFactory();
    let githubRevision = "github-before-registration-change";
    const initialRepository =
      new FileSystemSourceSyncRepository(directory);
    const initialCoordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () =>
          receipt(githubRevision, "9")
        ),
        codex: adapter("codex", async () =>
          receipt("codex-before-unregister", "a")
        )
      },
      repository: initialRepository,
      clock: new FakeClock(),
      attemptIdFactory: ids
    });
    await initialCoordinator.sync("github", "manual");
    await initialCoordinator.sync("codex", "manual");

    githubRevision = "github-after-registration-change";
    const restartedRepository =
      new FileSystemSourceSyncRepository(directory);
    const restartedCoordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () =>
          receipt(githubRevision, "b")
        )
      },
      repository: restartedRepository,
      clock: new FakeClock(),
      attemptIdFactory: ids
    });
    await expect(
      restartedCoordinator.getState("codex")
    ).resolves.toMatchObject({ status: "disabled" });
    await restartedCoordinator.sync("github", "manual");

    const stored = await restartedRepository.read();
    expect(stored.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "ready",
            latestSnapshot: {
              revision: "github-after-registration-change"
            }
          },
          codex: {
            status: "ready",
            latestSnapshot: {
              revision: "codex-before-unregister"
            }
          }
        }
      }
    });
  });

  it("accepts a transition clear whose rename succeeded before a chmod fault", async () => {
    const root = await createTempDirectory();
    const directory = join(root, "sync");
    let injectTransitionClearFault = true;
    let injectedFaults = 0;
    const repository = new FileSystemSourceSyncRepository(directory, {
      faultInjector: (point) => {
        if (
          point === "transition_clear_after_rename" &&
          injectTransitionClearFault
        ) {
          injectTransitionClearFault = false;
          injectedFaults += 1;
          throw new Error("injected post-rename chmod failure");
        }
      }
    });
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () =>
          receipt("github-after-disconnect", "e")
        )
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await expect(
      coordinator.markDisconnected("github")
    ).resolves.toMatchObject({
      status: "disabled",
      lastFailure: { errorCode: "CONNECTOR_DISCONNECTED" }
    });
    expect(injectedFaults).toBe(1);
    await expect(
      coordinator.sync("github", "manual")
    ).resolves.toMatchObject({
      status: "completed",
      state: { status: "ready" }
    });

    const stored = await repository.read();
    expect(stored.transitions).toMatchObject({
      status: "ready",
      value: { transitions: [] }
    });
    expect(stored.history.status).toBe("ready");
    if (stored.history.status === "ready") {
      expect(stored.history.value.attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ outcome: "success" }),
          expect.objectContaining({
            outcome: "failure",
            errorCode: "CONNECTOR_DISCONNECTED"
          })
        ])
      );
      expect(stored.history.value.attempts).toHaveLength(2);
    }
    expect(
      (await stat(join(directory, "transitions.json"))).mode & 0o777
    ).toBe(0o600);
  });

  it("replaces one source lineage on disk while preserving other source history", async () => {
    const root = await createTempDirectory();
    const repository = new FileSystemSourceSyncRepository(
      join(root, "sync")
    );
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: adapter("github", async () =>
          receipt("github-account-a")
        ),
        codex: adapter("codex", async () =>
          receipt("codex-current", "b")
        )
      },
      repository,
      clock: new FakeClock(),
      attemptIdFactory: idFactory()
    });

    await coordinator.sync("github", "manual");
    await coordinator.sync("codex", "manual");
    await coordinator.beginConnectionGeneration("github");

    const stored = await repository.read();
    expect(stored.latest).toMatchObject({
      status: "ready",
      value: {
        sources: {
          github: {
            status: "never_synced",
            lastAttempt: null,
            lastSuccess: null,
            lastFailure: null,
            latestSnapshot: null
          },
          codex: {
            status: "ready",
            latestSnapshot: {
              revision: "codex-current"
            }
          }
        }
      }
    });
    expect(stored.history).toMatchObject({
      status: "ready",
      value: {
        attempts: [
          {
            source: "codex",
            snapshotRevision: "codex-current"
          }
        ]
      }
    });
  });

  it("fails closed when persisted state is invalid or inconsistent", async () => {
    const invalidRepository = new MemorySourceSyncRepository({
      latest: {
        status: "invalid",
        reason: "schema_mismatch"
      }
    });
    const invalidCoordinator = new SourceSyncCoordinator({
      adapters: {},
      repository: invalidRepository,
      clock: new FakeClock()
    });
    await expect(invalidCoordinator.getState("github")).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncCoordinatorError>>({
        code: "STORE_INVALID"
      })
    );

    const now = "2026-07-27T00:00:00.000Z";
    const state = createInitialSourceSyncStore(
      now,
      new Set(["github"])
    );
    const attempt = sourceSyncAttemptSchema.parse({
      contract: "source-sync-attempt-v1",
      attemptId: `sync_${"1".repeat(32)}`,
      source: "github",
      trigger: "manual",
      startedAt: now,
      completedAt: now,
      outcome: "success",
      retryCount: 0,
      latencyMs: 0,
      snapshotRevision: "gh-1",
      snapshotHash: "a".repeat(64),
      itemCount: 1,
      errorCode: null
    });
    const inconsistentRepository = new MemorySourceSyncRepository({
      history: {
        status: "ready",
        value: {
          contract: "source-sync-history-store-v1",
          updatedAt: now,
          attempts: [attempt]
        }
      }
    });
    const inconsistentCoordinator = new SourceSyncCoordinator({
      adapters: {},
      repository: inconsistentRepository,
      clock: new FakeClock()
    });
    await expect(
      inconsistentCoordinator.getLatestStore()
    ).rejects.toEqual(
      expect.objectContaining<Partial<SourceSyncCoordinatorError>>({
        code: "STORE_INCONSISTENT"
      })
    );
    expect(state.sources.github.status).toBe("never_synced");
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-source-sync-")
  );
  tempDirectories.push(directory);
  return directory;
}
