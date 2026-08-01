import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
  mkdir
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/connectors/codex/localStore", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/codex/localStore")
    >();
  return {
    ...actual,
    readStoredCodexConfig: vi.fn(),
    readStoredCodexSnapshot: vi.fn()
  };
});

import {
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../src/connectors/codex/localStore";
import {
  bindWorkSessionDecision,
  clearCompanionHeartbeat,
  clearWorkResumptionState,
  clearWorkResumptionStateForCodexDisconnect,
  claimNextPendingCommand,
  completeClaimedCommand,
  createEmptyWorkSessionBindingStore,
  createPendingWorkResumptionCommand,
  currentWorkSessionBindings,
  isClaimedCommandCurrent,
  openWorkSession,
  publicCommandStatus,
  readWorkResumptionCommandStatus,
  readWorkResumptionStatus,
  readWorkSessionBindingStore,
  runClaimedCommandWithLaunchLease,
  unbindWorkSession,
  unbindWorkSessionDecision,
  workResumptionCommandSchema,
  workResumptionLocalDirectory,
  workSessionBindingStoreSchema,
  workResumptionCodexConnectionGeneration,
  writeCompanionHeartbeat,
  bindWorkSession,
  type WorkResumptionTaskRef
} from "../src/resumption";

const tempDirectories: string[] = [];
const T0 = new Date("2026-07-30T00:00:00.000Z");
const EXECUTION_1 = `codex:execution:${"1".repeat(24)}`;
const EXECUTION_2 = `codex:execution:${"2".repeat(24)}`;
const SCOPE_1 = "a".repeat(24);
const SCOPE_2 = "b".repeat(24);
const INSTANCE_1 = `instance_${"8".repeat(32)}`;
const INSTANCE_2 = `instance_${"9".repeat(32)}`;
const CONNECTION_CONFIG = {
  installationSecret: "c".repeat(64),
  discoveredAt: "2026-07-29T00:00:00.000Z"
};
const CONNECTION_GENERATION =
  workResumptionCodexConnectionGeneration(CONNECTION_CONFIG);
const TITLE_SENTINEL = "PRIVATE_TITLE_SENTINEL";
const taskRef: WorkResumptionTaskRef = {
  kind: "attention_subject",
  source: "github",
  subjectId: "github:issue:101:42",
  displayTitle: TITLE_SENTINEL
};

beforeEach(() => {
  vi.mocked(readStoredCodexConfig).mockResolvedValue(
    CONNECTION_CONFIG as never
  );
  vi.mocked(readStoredCodexSnapshot).mockResolvedValue({
    sessions: [
      { id: "1".repeat(24), scopeId: SCOPE_1 },
      { id: "2".repeat(24), scopeId: SCOPE_2 }
    ]
  } as never);
});

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("work resumption contracts", () => {
  it("preserves an append-only explicit binding and unbind chain", () => {
    const empty = createEmptyWorkSessionBindingStore(
      T0.toISOString()
    );
    const first = bindWorkSessionDecision(empty, {
      taskRef,
      executionId: EXECUTION_1,
      scopeId: SCOPE_1,
      boundAt: T0.toISOString(),
      explicitUserConfirmation: true
    });
    const rebound = bindWorkSessionDecision(first.store, {
      taskRef: {
        ...taskRef,
        displayTitle: "Renamed display title"
      },
      executionId: EXECUTION_2,
      scopeId: SCOPE_2,
      boundAt: plusMs(T0, 1_000).toISOString(),
      explicitUserConfirmation: true
    });
    const removed = unbindWorkSessionDecision(rebound.store, {
      taskRef,
      unboundAt: plusMs(T0, 2_000).toISOString(),
      explicitUserConfirmation: true
    });

    expect(removed.store.revision).toBe(3);
    expect(removed.store.decisions).toHaveLength(3);
    expect(removed.store.decisions[1]?.supersedesBindingId).toBe(
      first.decision.bindingId
    );
    expect(removed.decision?.supersedesBindingId).toBe(
      rebound.decision.bindingId
    );
    expect(currentWorkSessionBindings(removed.store)).toEqual([]);
    expect(
      workSessionBindingStoreSchema.parse(removed.store)
    ).toEqual(removed.store);
  });

  it("derives deterministic IDs and rejects native or executable fields", () => {
    const empty = createEmptyWorkSessionBindingStore(
      T0.toISOString()
    );
    const first = bindWorkSessionDecision(empty, {
      taskRef,
      executionId: EXECUTION_1,
      scopeId: SCOPE_1,
      boundAt: T0.toISOString(),
      explicitUserConfirmation: true
    });
    const repeated = bindWorkSessionDecision(empty, {
      taskRef,
      executionId: EXECUTION_1,
      scopeId: SCOPE_1,
      boundAt: T0.toISOString(),
      explicitUserConfirmation: true
    });
    const command = createPendingWorkResumptionCommand({
      binding: first.binding,
      connectionGeneration: CONNECTION_GENERATION,
      createdAt: T0.toISOString()
    });

    expect(first.decision.bindingId).toBe(
      repeated.decision.bindingId
    );
    expect(JSON.stringify(first.store)).not.toContain(
      TITLE_SENTINEL
    );
    expect(first.binding.taskRef).not.toHaveProperty(
      "displayTitle"
    );
    expect(currentWorkSessionBindings(first.store)[0]).not.toHaveProperty(
      "scopeId"
    );
    expect(
      workResumptionCommandSchema.safeParse({
        ...command,
        nativeThreadId: "native-thread",
        cwd: "/private/project",
        shellCommand: "codex resume native-thread",
        prompt: "continue"
      }).success
    ).toBe(false);
    expect(
      workResumptionCommandSchema.safeParse({
        ...command,
        claimedAt: plusMs(T0, 1_000).toISOString()
      }).success
    ).toBe(false);
    expect(
      workResumptionCommandSchema.safeParse({
        ...command,
        statusUpdatedAt: plusMs(T0, -1).toISOString()
      }).success
    ).toBe(false);
    expect(publicCommandStatus(command)).not.toHaveProperty(
      "executionId"
    );
  });
});

describe("private work resumption store", () => {
  it("allows one heartbeat owner, compare-clears, and permits stale takeover", async () => {
    const cwd = await testDirectory();
    const starts = await Promise.allSettled([
      writeCompanionHeartbeat(cwd, T0, INSTANCE_1),
      writeCompanionHeartbeat(cwd, T0, INSTANCE_2)
    ]);
    expect(
      starts.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      starts.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    const owner =
      starts[0]?.status === "fulfilled"
        ? INSTANCE_1
        : INSTANCE_2;
    const rejected =
      owner === INSTANCE_1 ? INSTANCE_2 : INSTANCE_1;
    expect(
      starts.find((result) => result.status === "rejected")
    ).toMatchObject({
      reason: { code: "COMPANION_ALREADY_RUNNING" }
    });
    await expect(
      clearCompanionHeartbeat(cwd, rejected)
    ).resolves.toBe(false);
    expect(
      (await readWorkResumptionStatus(cwd, plusMs(T0, 1_000)))
        .companion.state
    ).toBe("online");

    await writeCompanionHeartbeat(
      cwd,
      plusMs(T0, 16_000),
      rejected
    );
    await expect(
      clearCompanionHeartbeat(cwd, owner)
    ).resolves.toBe(false);
    await expect(
      clearCompanionHeartbeat(cwd, rejected)
    ).resolves.toBe(true);
    expect(
      (await readWorkResumptionStatus(cwd, plusMs(T0, 16_000)))
        .companion.state
    ).toBe("offline");
  });

  it("does not queue while offline and writes private files atomically", async () => {
    const cwd = await testDirectory();
    await bindFixture(cwd);
    const persistedBindings = await readFile(
      join(workResumptionLocalDirectory(cwd), "bindings.json"),
      "utf8"
    );
    expect(persistedBindings).not.toContain(TITLE_SENTINEL);
    const publicStatus = await readWorkResumptionStatus(cwd, T0);
    expect(JSON.stringify(publicStatus.bindings)).not.toContain(
      TITLE_SENTINEL
    );
    expect(publicStatus.bindings[0]).not.toHaveProperty("scopeId");

    await expect(
      openWorkSession(
        { taskRef, explicitUserAction: true },
        cwd,
        T0
      )
    ).rejects.toMatchObject({
      code: "COMPANION_OFFLINE"
    });
    const beforeHeartbeat = await readWorkResumptionStatus(cwd, T0);
    expect(beforeHeartbeat.companion.state).toBe("offline");
    await expect(
      readdir(
        join(
          workResumptionLocalDirectory(cwd),
          "commands"
        )
      )
    ).rejects.toMatchObject({ code: "ENOENT" });

    await writeCompanionHeartbeat(cwd, T0, INSTANCE_1);
    const command = await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      T0
    );
    const directory = workResumptionLocalDirectory(cwd);
    const commandFile = join(
      directory,
      "commands",
      `${command.commandId}.json`
    );

    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(directory, "bindings.json"))).mode & 0o777
    ).toBe(0o600);
    expect((await stat(commandFile)).mode & 0o777).toBe(0o600);
  });

  it("returns one idempotent nonterminal command and records completion", async () => {
    const cwd = await testDirectory();
    await bindFixture(cwd);
    await writeCompanionHeartbeat(cwd, T0, INSTANCE_1);
    const first = await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      T0
    );
    const repeated = await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      plusMs(T0, 1_000)
    );
    expect(repeated.commandId).toBe(first.commandId);

    const claimed = await claimNextPendingCommand(
      cwd,
      plusMs(T0, 2_000)
    );
    expect(claimed?.status).toBe("claimed");
    expect(
      await isClaimedCommandCurrent(
        {
          commandId: claimed?.commandId ?? "",
          bindingId: claimed?.bindingId ?? "",
          claimToken: claimed?.claimToken ?? ""
        },
        cwd
      )
    ).toBe(true);

    const launchResult =
      await runClaimedCommandWithLaunchLease(
        {
          commandId: claimed?.commandId ?? "",
          bindingId: claimed?.bindingId ?? "",
          claimToken: claimed?.claimToken ?? "",
          launchStartedAt: plusMs(T0, 3_000).toISOString()
        },
        async () => ({
          commandId: claimed?.commandId ?? "",
          claimToken: claimed?.claimToken ?? "",
          outcome: "completed",
          resultCode: "RESUMED_IN_TERMINAL",
          completedAt: plusMs(T0, 4_000).toISOString()
        }),
        cwd
      );
    expect(launchResult.state).toBe("completed");
    const completed =
      launchResult.state === "completed"
        ? launchResult.command
        : null;
    expect(completed?.status).toBe("completed");
    /*
     * A success can only be written from inside the launch lease; direct
     * completion without launchStartedAt is rejected by the schema.
     */
    await expect(
      completeClaimedCommand(
      {
        commandId: claimed?.commandId ?? "",
        claimToken: claimed?.claimToken ?? "",
        outcome: "completed",
        resultCode: "RESUMED_IN_TERMINAL",
        completedAt: plusMs(T0, 3_000).toISOString()
      },
      cwd
      )
    ).rejects.toMatchObject({
      code: "COMMAND_CLAIM_MISMATCH"
    });
    await expect(
      readWorkResumptionCommandStatus(
        first.commandId,
        cwd,
        plusMs(T0, 4_000)
      )
    ).resolves.toMatchObject({
      status: "completed",
      resultCode: "RESUMED_IN_TERMINAL"
    });
  });

  it("expires pending and claimed commands without launching them", async () => {
    const pendingCwd = await testDirectory();
    await bindFixture(pendingCwd);
    await writeCompanionHeartbeat(
      pendingCwd,
      T0,
      INSTANCE_1
    );
    const pending = await openWorkSession(
      { taskRef, explicitUserAction: true },
      pendingCwd,
      T0
    );
    await expect(
      readWorkResumptionCommandStatus(
        pending.commandId,
        pendingCwd,
        plusMs(T0, 30_000)
      )
    ).resolves.toMatchObject({
      status: "expired",
      resultCode: "COMMAND_EXPIRED"
    });

    const claimedCwd = await testDirectory();
    await bindFixture(claimedCwd);
    await writeCompanionHeartbeat(
      claimedCwd,
      T0,
      INSTANCE_1
    );
    await openWorkSession(
      { taskRef, explicitUserAction: true },
      claimedCwd,
      T0
    );
    const claimed = await claimNextPendingCommand(
      claimedCwd,
      plusMs(T0, 29_000)
    );
    const expired = await completeClaimedCommand(
      {
        commandId: claimed?.commandId ?? "",
        claimToken: claimed?.claimToken ?? "",
        outcome: "expired",
        resultCode: "COMMAND_EXPIRED",
        completedAt: plusMs(T0, 31_000).toISOString()
      },
      claimedCwd
    );
    expect(expired.status).toBe("expired");
  });

  it("expires an abandoned claim so a later explicit open can recover", async () => {
    const cwd = await testDirectory();
    await bindFixture(cwd);
    await writeCompanionHeartbeat(cwd, T0, INSTANCE_1);
    const first = await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      T0
    );
    const claimed = await claimNextPendingCommand(
      cwd,
      plusMs(T0, 1_000)
    );
    expect(claimed?.status).toBe("claimed");

    const retryAt = plusMs(T0, 31_000);
    await writeCompanionHeartbeat(
      cwd,
      retryAt,
      INSTANCE_1
    );
    const retried = await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      retryAt
    );

    expect(retried.commandId).not.toBe(first.commandId);
    await expect(
      readWorkResumptionCommandStatus(
        first.commandId,
        cwd,
        retryAt
      )
    ).resolves.toMatchObject({
      status: "expired",
      resultCode: "COMMAND_EXPIRED"
    });
  });

  it("holds the state lease from final validation through launch completion", async () => {
    const cwd = await testDirectory();
    const claimed = await claimedFixture(cwd);
    let releaseLaunch!: () => void;
    let markLaunchStarted!: () => void;
    const launchStarted = new Promise<void>((resolve) => {
      markLaunchStarted = resolve;
    });
    const launchRelease = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const launch = runClaimedCommandWithLaunchLease(
      {
        commandId: claimed.commandId,
        bindingId: claimed.bindingId,
        claimToken: claimed.claimToken as string,
        launchStartedAt: plusMs(T0, 2_000).toISOString()
      },
      async () => {
        markLaunchStarted();
        await launchRelease;
        return {
          commandId: claimed.commandId,
          claimToken: claimed.claimToken as string,
          outcome: "completed",
          resultCode: "RESUMED_IN_TERMINAL",
          completedAt: plusMs(T0, 3_000).toISOString()
        };
      },
      cwd
    );
    await launchStarted;

    let clearFinished = false;
    const clear = clearWorkResumptionState(cwd).then(() => {
      clearFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(clearFinished).toBe(false);

    releaseLaunch();
    await expect(launch).resolves.toMatchObject({
      state: "completed"
    });
    await clear;
    expect(clearFinished).toBe(true);
  });

  it("does not launch when disconnect clear linearizes first", async () => {
    const cwd = await testDirectory();
    const claimed = await claimedFixture(cwd);
    await clearWorkResumptionState(cwd);
    const launcher = vi.fn();

    await expect(
      runClaimedCommandWithLaunchLease(
        {
          commandId: claimed.commandId,
          bindingId: claimed.bindingId,
          claimToken: claimed.claimToken as string,
          launchStartedAt: plusMs(T0, 2_000).toISOString()
        },
        launcher,
        cwd
      )
    ).resolves.toEqual({ state: "not_current" });
    expect(launcher).not.toHaveBeenCalled();
  });

  it("keeps connector deletion atomic with a waiting bind", async () => {
    const cwd = await testDirectory();
    await bindFixture(cwd);
    let releaseDisconnect!: () => void;
    let markDisconnectStarted!: () => void;
    const disconnectStarted = new Promise<void>((resolve) => {
      markDisconnectStarted = resolve;
    });
    const disconnectRelease = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });

    const disconnect =
      clearWorkResumptionStateForCodexDisconnect(
        async () => {
          vi.mocked(readStoredCodexConfig).mockResolvedValue(null);
          markDisconnectStarted();
          await disconnectRelease;
        },
        cwd
      );
    await disconnectStarted;

    let bindSettled = false;
    const rebinding = bindWorkSession(
      {
        taskRef,
        executionId: EXECUTION_2,
        explicitUserConfirmation: true
      },
      cwd,
      plusMs(T0, 1_000)
    )
      .then(() => ({ state: "bound" as const }))
      .catch((error: unknown) => ({
        state: "rejected" as const,
        error
      }))
      .finally(() => {
        bindSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bindSettled).toBe(false);

    releaseDisconnect();
    await disconnect;
    await expect(rebinding).resolves.toMatchObject({
      state: "rejected",
      error: {
        code: "CODEX_CONNECTION_UNAVAILABLE"
      }
    });
    await expect(readWorkResumptionStatus(cwd, T0)).resolves.toMatchObject({
      bindings: []
    });
  });

  it("revalidates the Codex connection generation after target resolution", async () => {
    const cwd = await testDirectory();
    const claimed = await claimedFixture(cwd);
    vi.mocked(readStoredCodexConfig).mockResolvedValueOnce(null);
    const launcher = vi.fn();

    await expect(
      runClaimedCommandWithLaunchLease(
        {
          commandId: claimed.commandId,
          bindingId: claimed.bindingId,
          claimToken: claimed.claimToken as string,
          launchStartedAt: plusMs(T0, 2_000).toISOString()
        },
        launcher,
        cwd
      )
    ).resolves.toEqual({ state: "not_current" });
    expect(launcher).not.toHaveBeenCalled();
  });

  it("serializes competing companions and polling across the launch lease", async () => {
    const cwd = await testDirectory();
    const claimed = await claimedFixture(cwd);
    let releaseLaunch!: () => void;
    let markLaunchStarted!: () => void;
    const launchStarted = new Promise<void>((resolve) => {
      markLaunchStarted = resolve;
    });
    const launchRelease = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const firstCallback = vi.fn(async () => {
      markLaunchStarted();
      await launchRelease;
      return {
        commandId: claimed.commandId,
        claimToken: claimed.claimToken as string,
        outcome: "completed" as const,
        resultCode: "FOCUSED_EXISTING" as const,
        completedAt: plusMs(T0, 3_000).toISOString()
      };
    });
    const first = runClaimedCommandWithLaunchLease(
      {
        commandId: claimed.commandId,
        bindingId: claimed.bindingId,
        claimToken: claimed.claimToken as string,
        launchStartedAt: plusMs(T0, 2_000).toISOString()
      },
      firstCallback,
      cwd
    );
    await launchStarted;
    const duplicateCallback = vi.fn();
    const duplicate = runClaimedCommandWithLaunchLease(
      {
        commandId: claimed.commandId,
        bindingId: claimed.bindingId,
        claimToken: claimed.claimToken as string,
        launchStartedAt: plusMs(T0, 2_100).toISOString()
      },
      duplicateCallback,
      cwd
    );
    const polled = readWorkResumptionCommandStatus(
      claimed.commandId,
      cwd,
      plusMs(T0, 31_000)
    );
    releaseLaunch();

    await expect(first).resolves.toMatchObject({
      state: "completed"
    });
    await expect(duplicate).resolves.toEqual({
      state: "not_current"
    });
    await expect(polled).resolves.toMatchObject({
      status: "completed",
      resultCode: "FOCUSED_EXISTING"
    });
    expect(firstCallback).toHaveBeenCalledOnce();
    expect(duplicateCallback).not.toHaveBeenCalled();
  });

  it("terminalizes an unknown launch outcome without retrying after a crash", async () => {
    const cwd = await testDirectory();
    const claimed = await claimedFixture(cwd);
    const launcher = vi.fn(async () => {
      throw new Error("simulated process crash");
    });

    await expect(
      runClaimedCommandWithLaunchLease(
        {
          commandId: claimed.commandId,
          bindingId: claimed.bindingId,
          claimToken: claimed.claimToken as string,
          launchStartedAt: plusMs(T0, 2_000).toISOString()
        },
        launcher,
        cwd
      )
    ).rejects.toThrow("simulated process crash");
    await expect(
      readWorkResumptionCommandStatus(
        claimed.commandId,
        cwd,
        plusMs(T0, 31_000)
      )
    ).resolves.toMatchObject({
      status: "failed",
      resultCode: "LAUNCH_OUTCOME_UNKNOWN"
    });
    expect(launcher).toHaveBeenCalledOnce();
  });

  it("takes over a crashed stale state lock after the bounded grace period", async () => {
    const cwd = await testDirectory();
    const locks = join(
      workResumptionLocalDirectory(cwd),
      "locks"
    );
    await mkdir(locks, { recursive: true, mode: 0o700 });
    const lock = join(locks, "state.lock");
    await writeFile(lock, `${"f".repeat(32)}\n`, {
      mode: 0o600
    });
    const staleAt = new Date(Date.now() - 31_000);
    await utimes(lock, staleAt, staleAt);

    await expect(
      readWorkResumptionStatus(cwd, T0)
    ).resolves.toMatchObject({
      bindings: []
    });
  });

  it("cancels a claim on unbind and clears all resumable state on disconnect", async () => {
    const cwd = await testDirectory();
    await bindFixture(cwd);
    await writeCompanionHeartbeat(cwd, T0, INSTANCE_1);
    await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      T0
    );
    const claimed = await claimNextPendingCommand(
      cwd,
      plusMs(T0, 1_000)
    );

    await unbindWorkSession(
      {
        taskRef,
        explicitUserConfirmation: true
      },
      cwd,
      plusMs(T0, 2_000)
    );
    expect(
      await isClaimedCommandCurrent(
        {
          commandId: claimed?.commandId ?? "",
          bindingId: claimed?.bindingId ?? "",
          claimToken: claimed?.claimToken ?? ""
        },
        cwd
      )
    ).toBe(false);
    await expect(
      readWorkResumptionCommandStatus(
        claimed?.commandId ?? "",
        cwd,
        plusMs(T0, 2_000)
      )
    ).resolves.toBeNull();

    await bindFixture(cwd, plusMs(T0, 3_000));
    await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      plusMs(T0, 3_000)
    );
    await clearWorkResumptionState(cwd);
    const afterClear = await readWorkResumptionStatus(
      cwd,
      plusMs(T0, 3_000)
    );
    expect(afterClear.bindings).toEqual([]);
    expect(afterClear.companion.state).toBe("online");
    await expect(
      readdir(join(workResumptionLocalDirectory(cwd), "commands"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("prunes terminal command metadata after seven days", async () => {
    const cwd = await testDirectory();
    await bindFixture(cwd);
    await writeCompanionHeartbeat(cwd, T0, INSTANCE_1);
    const opened = await openWorkSession(
      { taskRef, explicitUserAction: true },
      cwd,
      T0
    );
    const claimed = await claimNextPendingCommand(
      cwd,
      plusMs(T0, 1_000)
    );
    await completeClaimedCommand(
      {
        commandId: claimed?.commandId ?? "",
        claimToken: claimed?.claimToken ?? "",
        outcome: "failed",
        resultCode: "LAUNCH_FAILED",
        completedAt: plusMs(T0, 2_000).toISOString()
      },
      cwd
    );

    await readWorkResumptionStatus(
      cwd,
      plusMs(T0, 8 * 24 * 60 * 60 * 1_000)
    );
    await expect(
      readWorkResumptionCommandStatus(
        opened.commandId,
        cwd,
        plusMs(T0, 8 * 24 * 60 * 60 * 1_000)
      )
    ).resolves.toBeNull();
  });

  it("serializes concurrent binding mutations", async () => {
    const cwd = await testDirectory();
    await Promise.all([
      bindWorkSession(
        {
          taskRef,
          executionId: EXECUTION_1,
          explicitUserConfirmation: true,
          boundAt: T0.toISOString()
        },
        cwd,
        T0
      ),
      bindWorkSession(
        {
          taskRef,
          executionId: EXECUTION_2,
          explicitUserConfirmation: true,
          boundAt: plusMs(T0, 1_000).toISOString()
        },
        cwd,
        plusMs(T0, 1_000)
      )
    ]);

    const store = await readWorkSessionBindingStore(cwd);
    expect(store.revision).toBe(2);
    expect(currentWorkSessionBindings(store)[0]).toMatchObject({
      executionId: EXECUTION_2
    });
    expect(currentWorkSessionBindings(store)[0]).not.toHaveProperty(
      "scopeId"
    );
  });
});

async function bindFixture(
  cwd: string,
  now = T0
): Promise<void> {
  await bindWorkSession(
    {
      taskRef,
      executionId: EXECUTION_1,
      explicitUserConfirmation: true
    },
    cwd,
    now
  );
}

async function claimedFixture(cwd: string) {
  await bindFixture(cwd);
  await writeCompanionHeartbeat(cwd, T0, INSTANCE_1);
  await openWorkSession(
    { taskRef, explicitUserAction: true },
    cwd,
    T0
  );
  const claimed = await claimNextPendingCommand(
    cwd,
    plusMs(T0, 1_000)
  );
  if (!claimed || !claimed.claimToken) {
    throw new Error("Expected a claimed command fixture.");
  }
  return claimed;
}

async function testDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-work-resumption-")
  );
  tempDirectories.push(directory);
  return directory;
}

function plusMs(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}
