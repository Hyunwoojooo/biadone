import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { fetchSourceSyncStatus } from "../app/sync/sourceSyncClient";
import { SyncInvalidationBus } from "../app/sync/invalidationBus";
import { changedSourceRevisions } from "../app/sync/useSourceSync";
import {
  FileSystemSourceSyncRepository,
  SourceSyncAdapterError,
  SourceSyncCoordinator,
  sourceSyncLocalDirectory,
  type SourceSyncClock
} from "../src/sync";
import { runtimeStatusResponse } from "../src/sync/runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

class PipelineClock implements SourceSyncClock {
  private milliseconds = Date.parse("2026-07-27T00:00:00.000Z");

  now(): Date {
    return new Date(this.milliseconds);
  }

  advance(milliseconds = 1): void {
    this.milliseconds += milliseconds;
  }
}

describe("Phase 2A.1 data pipeline E2E", () => {
  it("propagates polling, failure recovery, revision changes, and disconnects to UI consumers", async () => {
    const clock = new PipelineClock();
    const cwd = await mkdtemp(
      join(tmpdir(), "blabase-pipeline-e2e-")
    );
    temporaryDirectories.push(cwd);
    const repository =
      FileSystemSourceSyncRepository.fromCwd(cwd);
    let mode:
      | "initial"
      | "failure"
      | "recovery"
      | "disconnected" = "initial";
    let attemptSequence = 0;
    const coordinator = new SourceSyncCoordinator({
      adapters: {
        github: {
          source: "github",
          async sync() {
            clock.advance();
            if (mode === "failure") {
              throw new SourceSyncAdapterError("RATE_LIMITED");
            }
            if (mode === "disconnected") {
              throw new SourceSyncAdapterError(
                "CONNECTOR_DISCONNECTED"
              );
            }
            return {
              revision:
                mode === "recovery" ? "github-rev-2" : "github-rev-1",
              hash:
                mode === "recovery"
                  ? "b".repeat(64)
                  : "a".repeat(64),
              itemCount: mode === "recovery" ? 2 : 1
            };
          }
        }
      },
      repository,
      clock,
      attemptIdFactory: () => {
        attemptSequence += 1;
        return `sync_${attemptSequence
          .toString(16)
          .padStart(32, "0")}`;
      }
    });
    const bus = new SyncInvalidationBus();
    const invalidations: string[][] = [];
    bus.subscribe(["github", "attention"], (event) => {
      invalidations.push([...event.targets]);
    });

    await coordinator.sync("github");
    const initial = await pollCoordinator(coordinator);
    expect(
      initial.sources.find((source) => source.source === "github")
    ).toMatchObject({
      status: "idle",
      retryCount: 0,
      snapshotRevision: "github-rev-1"
    });

    mode = "failure";
    await coordinator.sync("github");
    const failed = await pollCoordinator(coordinator);
    expect(
      failed.sources.find((source) => source.source === "github")
    ).toMatchObject({
      status: "backoff",
      retryCount: 1,
      lastErrorCode: "RATE_LIMITED",
      snapshotRevision: "github-rev-1"
    });
    expect(
      changedSourceRevisions(initial.sources, failed.sources)
    ).toEqual([]);

    mode = "recovery";
    await coordinator.sync("github");
    const recovered = await pollCoordinator(coordinator);
    const recoveredChanges = changedSourceRevisions(
      failed.sources,
      recovered.sources
    );
    expect(recoveredChanges).toEqual(["github"]);
    bus.invalidate({
      reason: "snapshot_revision_changed",
      targets: [...recoveredChanges, "attention", "timeline"],
      revision: recovered.revision
    });
    expect(
      recovered.sources.find((source) => source.source === "github")
    ).toMatchObject({
      status: "idle",
      retryCount: 0,
      lastErrorCode: null,
      snapshotRevision: "github-rev-2"
    });

    mode = "disconnected";
    await coordinator.sync("github");
    const disconnected = await pollCoordinator(coordinator);
    const disconnectChanges = changedSourceRevisions(
      recovered.sources,
      disconnected.sources
    );
    expect(disconnectChanges).toEqual(["github"]);
    bus.invalidate({
      reason: "disconnect",
      targets: [...disconnectChanges, "attention", "timeline"],
      revision: disconnected.revision
    });
    expect(
      disconnected.sources.find(
        (source) => source.source === "github"
      )
    ).toMatchObject({
      status: "disconnected",
      lastErrorCode: "CONNECTOR_DISCONNECTED"
    });
    expect(invalidations).toEqual([
      ["github", "attention", "timeline"],
      ["github", "attention", "timeline"]
    ]);

    const stored = await repository.read();
    expect(stored.history.status).toBe("ready");
    if (stored.history.status === "ready") {
      expect(
        stored.history.value.attempts.map((attempt) => ({
          outcome: attempt.outcome,
          errorCode: attempt.errorCode,
          snapshotRevision: attempt.snapshotRevision
        }))
      ).toEqual([
        {
          outcome: "failure",
          errorCode: "CONNECTOR_DISCONNECTED",
          snapshotRevision: null
        },
        {
          outcome: "success",
          errorCode: null,
          snapshotRevision: "github-rev-2"
        },
        {
          outcome: "failure",
          errorCode: "RATE_LIMITED",
          snapshotRevision: null
        },
        {
          outcome: "success",
          errorCode: null,
          snapshotRevision: "github-rev-1"
        }
      ]);
    }

    const localDirectory = sourceSyncLocalDirectory(cwd);
    const latestPath = join(localDirectory, "latest.json");
    const historyPath = join(localDirectory, "history.json");
    expect((await stat(localDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(latestPath)).mode & 0o777).toBe(0o600);
    expect((await stat(historyPath)).mode & 0o777).toBe(0o600);
    const persistedLatest = JSON.parse(
      await readFile(latestPath, "utf8")
    ) as { sources: { github: { latestSnapshot: unknown } } };
    const persistedHistory = JSON.parse(
      await readFile(historyPath, "utf8")
    ) as { attempts: unknown[] };
    expect(
      persistedLatest.sources.github.latestSnapshot
    ).not.toBeNull();
    expect(persistedHistory.attempts).toHaveLength(4);
  });
});

async function pollCoordinator(
  coordinator: SourceSyncCoordinator
) {
  const payload = runtimeStatusResponse(
    await coordinator.getLatestStore()
  );
  return fetchSourceSyncStatus(async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
}
