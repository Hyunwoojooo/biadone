import {
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_MANAGED_EVENT_HARD_LIMIT,
  appendManagedCodexNotification,
  appendManagedCodexEventToHistory,
  appendManagedCodexStreamEvent,
  beginManagedCodexRun,
  clearManagedCodexState,
  createEmptyManagedCodexHistory,
  createManagedCodexEvent,
  createManagedCodexSettlement,
  managedCodexEventHistorySchema,
  managedCodexLatestStoreSchema,
  managedCodexLocalDirectory,
  managedCodexPublicProjectionSchema,
  managedCodexRunRegistrySchema,
  managedCodexSemanticProjectionSchema,
  readManagedCodexObservability,
  readManagedCodexPublicProjection,
  sealManagedCodexHistory,
  type ManagedCodexPublicRunProjection
} from "../src/managedCodex";

const tempDirectories: string[] = [];
const T0 = new Date("2026-08-01T00:00:00.000Z");
const BINDING_ID = `binding_${"a".repeat(32)}`;
const EXECUTION_ID = `codex:execution:${"b".repeat(24)}`;
const SCOPE_ID = "c".repeat(24);
const CONNECTION_GENERATION = `connection_${"d".repeat(32)}`;
const OWNER_ID = `instance_${"e".repeat(32)}`;
const OTHER_OWNER_ID = `instance_${"1".repeat(32)}`;
const STREAM_1 = `stream_${"f".repeat(32)}`;
const STREAM_2 = `stream_${"2".repeat(32)}`;
const ACTIVE_OWNERSHIP = {
  bindingId: BINDING_ID,
  executionId: EXECUTION_ID,
  scopeId: SCOPE_ID,
  connectionGeneration: CONNECTION_GENERATION
};
const NATIVE_THREAD_SENTINEL = "NATIVE_THREAD_PRIVATE_SENTINEL";
const RAW_SENTINEL = "RAW_PROMPT_OUTPUT_PRIVATE_SENTINEL";

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("managed Codex private store", () => {
  it("creates the exact public run projection without private identity", async () => {
    const cwd = await temporaryDirectory();
    const run = await begin(cwd);

    expect(run).toEqual({
      managedRunId: expect.stringMatching(/^managed_run_[a-f0-9]{32}$/),
      bindingId: BINDING_ID,
      executionId: EXECUTION_ID,
      lifecycle: "starting",
      streamState: "connecting",
      continuity: "unverified",
      effectiveExecutionState: "unknown",
      lastVerifiedExecutionState: "unknown",
      waitingState: null,
      sourceEvent: "run_started",
      itemType: null,
      lastObservedAt: T0.toISOString(),
      liveObservationAvailable: false,
      forbiddenAsAttentionCandidate: true
    });
    expect(run).not.toHaveProperty("scopeId");
    expect(run).not.toHaveProperty("ownerInstanceId");
    expect(run).not.toHaveProperty("connectionGeneration");

    const publicProjection = await readManagedCodexPublicProjection(
      {
        activeOwnerInstanceId: OWNER_ID,
        activeOwnerships: [ACTIVE_OWNERSHIP],
        now: T0
      },
      cwd
    );
    expect(
      managedCodexPublicProjectionSchema.parse(publicProjection)
    ).toEqual(publicProjection);
    expect(Object.keys(publicProjection).sort()).toEqual([
      "contract",
      "generatedAt",
      "revision",
      "runs"
    ]);
    const observability = await readManagedCodexObservability(
      {
        activeOwnerInstanceId: OWNER_ID,
        activeOwnerships: [ACTIVE_OWNERSHIP],
        now: T0
      },
      cwd
    );
    expect(
      managedCodexSemanticProjectionSchema.parse(observability.semantics)
    ).toEqual(observability.semantics);
    expect(observability.projection.revision).toBe(
      observability.semantics.sourceRevision
    );
    expect(observability.semantics.generatedAt).toBe(
      observability.projection.generatedAt
    );
    expect(
      observability.semantics.runs[run.managedRunId]
    ).toMatchObject({
      managedRunId: run.managedRunId,
      detector: {
        assessment: "observation_unavailable",
        meaningfulProgress: "unknown",
        stall: "not_evaluable",
        attentionDisposition: "not_connected",
        forbiddenAsAttentionCandidate: true
      }
    });
    expect(JSON.stringify(observability.semantics)).not.toContain(SCOPE_ID);
    expect(JSON.stringify(observability.semantics)).not.toContain(OWNER_ID);
    const ownerMissing = await readManagedCodexPublicProjection(
      {
        activeOwnerInstanceId: null,
        activeOwnerships: [ACTIVE_OWNERSHIP],
        now: T0
      },
      cwd
    );
    expect(ownerMissing.runs[0]?.streamState).toBe("disconnected");
  });

  it("persists only normalized metadata and keeps private permissions", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    const item = await appendManagedCodexNotification(
      {
        managedRunId: run.managedRunId,
        ownerInstanceId: OWNER_ID,
        expectedThreadId: NATIVE_THREAD_SENTINEL,
        observedAt: plusMs(T0, 2_000).toISOString(),
        notification: {
          method: "item/started",
          params: {
            threadId: NATIVE_THREAD_SENTINEL,
            turnId: "native-turn-private",
            item: {
              id: "native-item-private",
              type: "commandExecution",
              command: RAW_SENTINEL,
              output: RAW_SENTINEL
            },
            prompt: RAW_SENTINEL,
            answer: RAW_SENTINEL
          },
          rawPayload: RAW_SENTINEL
        }
      },
      cwd
    );

    expect(item.itemType).toBe("command_execution");
    const directory = managedCodexLocalDirectory(cwd);
    const historyPath = join(
      directory,
      "events",
      `${run.managedRunId}.json`
    );
    const persisted = (
      await Promise.all(
        [
          join(directory, "registry.json"),
          join(directory, "latest.json"),
          historyPath
        ].map((path) => readFile(path, "utf8"))
      )
    ).join("\n");
    expect(persisted).not.toContain(NATIVE_THREAD_SENTINEL);
    expect(persisted).not.toContain("native-turn-private");
    expect(persisted).not.toContain("native-item-private");
    expect(persisted).not.toContain(RAW_SENTINEL);
    expect(persisted).not.toContain("prompt");
    expect(persisted).not.toContain("output");

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, "events"))).mode & 0o777).toBe(
      0o700
    );
    for (const path of [
      join(directory, "registry.json"),
      join(directory, "latest.json"),
      historyPath
    ]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it("keeps observing after a completed turn and accepts the next turn", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    await appendTurnStarted(run, cwd, plusMs(T0, 2_000));
    const completed = await appendManagedCodexNotification(
      {
        managedRunId: run.managedRunId,
        ownerInstanceId: OWNER_ID,
        expectedThreadId: NATIVE_THREAD_SENTINEL,
        observedAt: plusMs(T0, 3_000).toISOString(),
        notification: {
          method: "turn/completed",
          params: {
            threadId: NATIVE_THREAD_SENTINEL,
            turn: { id: "turn-one", status: "completed" }
          }
        }
      },
      cwd
    );

    expect(completed).toMatchObject({
      lifecycle: "observing",
      streamState: "connected",
      effectiveExecutionState: "completed",
      lastVerifiedExecutionState: "completed",
      sourceEvent: "turn_completed",
      liveObservationAvailable: true
    });

    const nextTurn = await appendTurnStarted(
      run,
      cwd,
      plusMs(T0, 4_000),
      "turn-two"
    );
    expect(nextTurn).toMatchObject({
      lifecycle: "observing",
      effectiveExecutionState: "running",
      lastVerifiedExecutionState: "running",
      sourceEvent: "turn_started",
      liveObservationAvailable: true
    });
  });

  it("downgrades a stale owner without changing last verified evidence", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    await appendTurnStarted(run, cwd, plusMs(T0, 2_000));

    const stale = await readManagedCodexPublicProjection(
      {
        activeOwnerInstanceId: OTHER_OWNER_ID,
        activeOwnerships: [ACTIVE_OWNERSHIP],
        now: plusMs(T0, 3_000)
      },
      cwd
    );
    expect(stale.runs[0]).toMatchObject({
      lifecycle: "observing",
      streamState: "disconnected",
      effectiveExecutionState: "unknown",
      lastVerifiedExecutionState: "running",
      waitingState: null,
      sourceEvent: "turn_started",
      liveObservationAvailable: false
    });

    const unbound = await readManagedCodexPublicProjection(
      {
        activeOwnerInstanceId: OWNER_ID,
        activeOwnerships: [],
        now: plusMs(T0, 4_000)
      },
      cwd
    );
    expect(unbound.runs[0]).toMatchObject({
      streamState: "disconnected",
      effectiveExecutionState: "unknown",
      lastVerifiedExecutionState: "running",
      liveObservationAvailable: false
    });
  });

  it("marks reconnect continuity as a gap and assigns strict local sequence", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    await appendTurnStarted(run, cwd, plusMs(T0, 2_000));
    await appendManagedCodexStreamEvent(
      {
        managedRunId: run.managedRunId,
        ownerInstanceId: OWNER_ID,
        streamGeneration: STREAM_1,
        kind: "stream_disconnected",
        observedAt: plusMs(T0, 3_000).toISOString()
      },
      cwd
    );
    const reconnected = await appendManagedCodexStreamEvent(
      {
        managedRunId: run.managedRunId,
        ownerInstanceId: OWNER_ID,
        streamGeneration: STREAM_2,
        kind: "stream_reconnected",
        observedAt: plusMs(T0, 4_000).toISOString()
      },
      cwd
    );

    expect(reconnected).toMatchObject({
      streamState: "connected",
      continuity: "gap_detected",
      effectiveExecutionState: "unknown",
      lastVerifiedExecutionState: "running",
      sourceEvent: "stream_reconnected",
      liveObservationAvailable: true
    });
    const history = await readHistory(cwd, run.managedRunId);
    expect(history.events.map((event) => event.sequence)).toEqual([
      0, 1, 2, 3
    ]);
    expect(history.events[0]?.previousEventSha256).toBeNull();
    expect(history.events[1]?.previousEventSha256).toBe(
      history.events[0]?.eventSha256
    );
    expect(history.events[2]?.previousEventSha256).toBe(
      history.events[1]?.eventSha256
    );
    expect(history.events[3]?.previousEventSha256).toBe(
      history.events[2]?.eventSha256
    );

    const observedAfterGap = await appendTurnStarted(
      reconnected,
      cwd,
      plusMs(T0, 5_000),
      "turn-after-gap"
    );
    expect(observedAfterGap).toMatchObject({
      continuity: "gap_detected",
      effectiveExecutionState: "running",
      lastVerifiedExecutionState: "running",
      sourceEvent: "turn_started"
    });
  });

  it("uses sequence as authority when the observation clock regresses", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    await appendTurnStarted(run, cwd, plusMs(T0, -5_000));

    const history = await readHistory(cwd, run.managedRunId);
    expect(history.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(Date.parse(history.events[1]!.observedAt)).toBeLessThan(
      Date.parse(history.events[0]!.observedAt)
    );
    expect(history.events[1]!.retentionAt).toBe(
      history.events[0]!.retentionAt
    );
  });

  it("compacts the 10,001st event behind a verifiable hash anchor", () => {
    const managedRunId = `managed_run_${"3".repeat(32)}`;
    const events: ReturnType<typeof createManagedCodexEvent>[] = [];
    let previousEventSha256: string | null = null;
    for (
      let sequence = 0;
      sequence < CODEX_MANAGED_EVENT_HARD_LIMIT;
      sequence += 1
    ) {
      const event = createManagedCodexEvent({
        managedRunId,
        sequence,
        ownerInstanceId: OWNER_ID,
        streamGeneration: STREAM_1,
        observedAt: T0.toISOString(),
        retentionAt: T0.toISOString(),
        kind: "stream_lifecycle",
        streamKind: "stream_connected",
        observation: null,
        itemType: null,
        previousEventSha256
      });
      events.push(event);
      previousEventSha256 = event.eventSha256;
    }
    const empty = createEmptyManagedCodexHistory({
      managedRunId,
      updatedAt: T0.toISOString()
    });
    const { storeSha256: _storeSha256, ...emptyContent } = empty;
    const history = sealManagedCodexHistory({
      ...emptyContent,
      events
    });
    const overflow = createManagedCodexEvent({
      managedRunId,
      sequence: CODEX_MANAGED_EVENT_HARD_LIMIT,
      ownerInstanceId: OWNER_ID,
      streamGeneration: STREAM_1,
      observedAt: plusMs(T0, 1).toISOString(),
      retentionAt: plusMs(T0, 1).toISOString(),
      kind: "stream_lifecycle",
      streamKind: "stream_connected",
      observation: null,
      itemType: null,
      previousEventSha256
    });

    const compacted = appendManagedCodexEventToHistory(
      history,
      overflow,
      plusMs(T0, 1).toISOString()
    );
    expect(compacted.events).toHaveLength(
      CODEX_MANAGED_EVENT_HARD_LIMIT
    );
    expect(compacted.anchor?.prunedThroughSequence).toBe(0);
    expect(compacted.events[0]?.sequence).toBe(1);
    expect(compacted.events.at(-1)?.sequence).toBe(
      CODEX_MANAGED_EVENT_HARD_LIMIT
    );
    expect(
      managedCodexEventHistorySchema.parse(compacted)
    ).toEqual(compacted);
  });

  it("fails closed when a persisted event breaks the hash chain", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    await appendTurnStarted(run, cwd, plusMs(T0, 2_000));
    const path = join(
      managedCodexLocalDirectory(cwd),
      "events",
      `${run.managedRunId}.json`
    );
    const tampered = JSON.parse(await readFile(path, "utf8"));
    tampered.events[1].observation.executionState = "idle";
    await writeFile(path, `${JSON.stringify(tampered)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    await expect(
      readManagedCodexPublicProjection(
        {
          activeOwnerInstanceId: OWNER_ID,
          activeOwnerships: [ACTIVE_OWNERSHIP],
          now: plusMs(T0, 3_000)
        },
        cwd
      )
    ).rejects.toMatchObject({ code: "STORE_INVALID" });
  });

  it("recovers an exact history-to-latest partial settlement", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    const directory = managedCodexLocalDirectory(cwd);
    const latestPath = join(directory, "latest.json");
    const latestBefore = await readFile(latestPath, "utf8");

    await appendTurnStarted(run, cwd, plusMs(T0, 2_000));
    const [registry, latestAfter, historyAfter] = await Promise.all([
      readJson(join(directory, "registry.json")),
      readJson(latestPath),
      readJson(
        join(directory, "events", `${run.managedRunId}.json`)
      )
    ]);
    await writeFile(latestPath, latestBefore, {
      encoding: "utf8",
      mode: 0o600
    });
    const settlement = createManagedCodexSettlement({
      managedRunId: run.managedRunId,
      createdAt: plusMs(T0, 2_000).toISOString(),
      registry: managedCodexRunRegistrySchema.parse(registry),
      latest: managedCodexLatestStoreSchema.parse(latestAfter),
      history: managedCodexEventHistorySchema.parse(historyAfter)
    });
    const settlementPath = join(directory, "settlement.json");
    await writeFile(
      settlementPath,
      `${JSON.stringify(settlement, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );

    const recovered = await readManagedCodexPublicProjection(
      {
        activeOwnerInstanceId: OWNER_ID,
        activeOwnerships: [ACTIVE_OWNERSHIP],
        now: plusMs(T0, 3_000)
      },
      cwd
    );
    expect(recovered.runs[0]).toMatchObject({
      effectiveExecutionState: "running",
      sourceEvent: "turn_started"
    });
    await expect(stat(settlementPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("removes ended metadata after the fixed 30-day retention", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    await appendManagedCodexStreamEvent(
      {
        managedRunId: run.managedRunId,
        ownerInstanceId: OWNER_ID,
        streamGeneration: STREAM_1,
        kind: "run_closed",
        observedAt: plusMs(T0, 2_000).toISOString()
      },
      cwd
    );

    const expired = await readManagedCodexPublicProjection(
      {
        activeOwnerInstanceId: null,
        activeOwnerships: [],
        now: plusMs(T0, 31 * 24 * 60 * 60 * 1_000)
      },
      cwd
    );
    expect(expired.runs).toEqual([]);
    await expect(
      stat(
        join(
          managedCodexLocalDirectory(cwd),
          "events",
          `${run.managedRunId}.json`
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears every managed artifact while retaining the active lock directory", async () => {
    const cwd = await temporaryDirectory();
    const run = await beginAndConnect(cwd);
    await clearManagedCodexState(cwd);
    const projection = await readManagedCodexPublicProjection(
      {
        activeOwnerInstanceId: null,
        activeOwnerships: [],
        now: plusMs(T0, 2_000)
      },
      cwd
    );
    expect(projection.runs).toEqual([]);
    await expect(
      stat(
        join(
          managedCodexLocalDirectory(cwd),
          "events",
          `${run.managedRunId}.json`
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-managed-codex-")
  );
  tempDirectories.push(directory);
  return directory;
}

async function begin(cwd: string) {
  return beginManagedCodexRun(
    {
      bindingId: BINDING_ID,
      executionId: EXECUTION_ID,
      scopeId: SCOPE_ID,
      connectionGeneration: CONNECTION_GENERATION,
      ownerInstanceId: OWNER_ID,
      streamGeneration: STREAM_1,
      startedAt: T0.toISOString(),
      startedBy: "explicit_user",
      ownership: "blabase_app_server"
    },
    cwd
  );
}

async function beginAndConnect(
  cwd: string
): Promise<ManagedCodexPublicRunProjection> {
  const run = await begin(cwd);
  return appendManagedCodexStreamEvent(
    {
      managedRunId: run.managedRunId,
      ownerInstanceId: OWNER_ID,
      streamGeneration: STREAM_1,
      kind: "stream_connected",
      observedAt: plusMs(T0, 1_000).toISOString()
    },
    cwd
  );
}

async function appendTurnStarted(
  run: ManagedCodexPublicRunProjection,
  cwd: string,
  observedAt: Date,
  turnId = "turn-one"
) {
  return appendManagedCodexNotification(
    {
      managedRunId: run.managedRunId,
      ownerInstanceId: OWNER_ID,
      expectedThreadId: NATIVE_THREAD_SENTINEL,
      observedAt: observedAt.toISOString(),
      notification: {
        method: "turn/started",
        params: {
          threadId: NATIVE_THREAD_SENTINEL,
          turn: { id: turnId, status: "inProgress" }
        }
      }
    },
    cwd
  );
}

async function readHistory(cwd: string, managedRunId: string) {
  return managedCodexEventHistorySchema.parse(
    await readJson(
      join(
        managedCodexLocalDirectory(cwd),
        "events",
        `${managedRunId}.json`
      )
    )
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function plusMs(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}
