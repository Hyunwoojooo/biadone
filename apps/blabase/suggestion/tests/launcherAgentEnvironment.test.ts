import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const snapshot = Object.assign(Object.create(null), {
    BLABASE_LAUNCHER_SOURCE_MODE: "managed",
    GITHUB_APP_CLIENT_ID: "shared-client-id"
  }) as NodeJS.ProcessEnv;
  const coordinator = {
    start: vi.fn(async () => undefined),
    stop: vi.fn()
  };
  return {
    dataRoot: { value: "" },
    snapshot,
    coordinator,
    serviceArguments: [] as Array<{
      dataRoot: string;
      env: NodeJS.ProcessEnv;
    }>,
    createSnapshot: vi.fn(() => snapshot),
    parseArgs: vi.fn(() => ({ dataRoot: "" })),
    resolveSourceMode: vi.fn(
      (_env: NodeJS.ProcessEnv): "managed" | "read_only" =>
        "managed"
    ),
    getCoordinator: vi.fn(() => coordinator),
    runSession: vi.fn(async () => undefined),
    runCompanion: vi.fn(
      async (input: {
        resolveBinary: () => Promise<unknown>;
      }) => {
        await input.resolveBinary();
      }
    ),
    resolveBinary: vi.fn(async () => ({
      ok: false as const,
      reason: "missing" as const
    })),
    closeManager: vi.fn(async () => undefined)
  };
});

vi.mock("../src/localEnv", () => ({
  createSharedLocalEnvSnapshot: harness.createSnapshot
}));

vi.mock("../src/launcher", () => ({
  LauncherService: class MockLauncherService {
    constructor(dataRoot: string, env: NodeJS.ProcessEnv) {
      harness.serviceArguments.push({ dataRoot, env });
    }
  },
  parseLauncherAgentArgs: harness.parseArgs,
  resolveLauncherSourceMode: harness.resolveSourceMode,
  runLauncherJsonlSession: harness.runSession
}));

vi.mock("../src/sync/runtime", () => ({
  getRuntimeSourceSyncCoordinator: harness.getCoordinator
}));

vi.mock("../src/connectors/codex/config", () => ({
  resolveCodexBinary: harness.resolveBinary
}));

vi.mock("../src/connectors/codex/resumeTarget", () => ({
  resolveCodexResumeTarget: vi.fn()
}));

vi.mock("../src/managedCodex/runtime", () => ({
  ManagedCodexResumeLauncher: class MockManagedCodexResumeLauncher {
    constructor(..._arguments: unknown[]) {}
  },
  ManagedCodexRunManager: class MockManagedCodexRunManager {
    constructor(..._arguments: unknown[]) {}

    async close(): Promise<void> {
      await harness.closeManager();
    }
  }
}));

vi.mock("../src/resumption/companion/localQueueAdapter", () => ({
  createLocalWorkResumptionQueueAdapter: vi.fn(() => ({}))
}));

vi.mock("../src/resumption/companion/runtime", () => ({
  runCompanionDaemon: harness.runCompanion
}));

vi.mock("../src/resumption/companion/terminal", () => ({
  MacOsTerminalResumeLauncher: class MockMacOsTerminalResumeLauncher {}
}));

describe("launcher agent environment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    harness.serviceArguments.length = 0;
    harness.resolveSourceMode.mockReturnValue("managed");
  });

  it("uses one data-root-bound snapshot for every startup component", async () => {
    const dataRoot = await mkdtemp(
      join(tmpdir(), "blabase-launcher-agent-env-")
    );
    harness.dataRoot.value = dataRoot;
    harness.parseArgs.mockReturnValue({ dataRoot });
    const platform = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("darwin");

    try {
      await import("../tools/launcher-agent");

      expect(harness.createSnapshot).toHaveBeenCalledTimes(1);
      expect(harness.createSnapshot).toHaveBeenCalledWith(
        process.env,
        { cwd: dataRoot, mode: "maintain" }
      );
      expect(harness.resolveSourceMode).toHaveBeenCalledWith(
        harness.snapshot
      );
      expect(harness.getCoordinator).toHaveBeenCalledWith(
        dataRoot,
        harness.snapshot
      );
      expect(harness.serviceArguments).toEqual([
        { dataRoot, env: harness.snapshot }
      ]);
      expect(harness.resolveBinary).toHaveBeenCalledWith(
        harness.snapshot
      );
      expect(harness.coordinator.start).toHaveBeenCalledTimes(1);
      expect(harness.coordinator.stop).toHaveBeenCalledTimes(1);
    } finally {
      platform.mockRestore();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it("does not create a coordinator in read-only mode", async () => {
    const dataRoot = await mkdtemp(
      join(tmpdir(), "blabase-launcher-agent-read-only-")
    );
    harness.dataRoot.value = dataRoot;
    harness.parseArgs.mockReturnValue({ dataRoot });
    harness.resolveSourceMode.mockReturnValue("read_only");
    const platform = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("darwin");

    try {
      await import("../tools/launcher-agent");

      expect(harness.createSnapshot).toHaveBeenCalledTimes(1);
      expect(harness.getCoordinator).not.toHaveBeenCalled();
      expect(harness.coordinator.start).not.toHaveBeenCalled();
      expect(harness.coordinator.stop).not.toHaveBeenCalled();
      expect(harness.serviceArguments).toEqual([
        { dataRoot, env: harness.snapshot }
      ]);
      expect(harness.resolveBinary).toHaveBeenCalledWith(
        harness.snapshot
      );
    } finally {
      platform.mockRestore();
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
