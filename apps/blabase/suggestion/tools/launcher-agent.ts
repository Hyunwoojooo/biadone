import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { resolveCodexBinary } from "../src/connectors/codex/config";
import { resolveCodexResumeTarget } from "../src/connectors/codex/resumeTarget";
import {
  LauncherService,
  parseLauncherAgentArgs,
  resolveLauncherSourceMode,
  runLauncherJsonlSession
} from "../src/launcher";
import {
  ManagedCodexResumeLauncher,
  ManagedCodexRunManager
} from "../src/managedCodex/runtime";
import { createLocalWorkResumptionQueueAdapter } from "../src/resumption/companion/localQueueAdapter";
import { runCompanionDaemon } from "../src/resumption/companion/runtime";
import { MacOsTerminalResumeLauncher } from "../src/resumption/companion/terminal";
import { getRuntimeSourceSyncCoordinator } from "../src/sync/runtime";

await main().catch((error: unknown) => {
  process.stderr.write(
    `Launcher agent failed: ${safeStartupErrorCode(error)}\n`
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { dataRoot } = parseLauncherAgentArgs(
    process.argv.slice(2),
    process.env
  );
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let coordinator: ReturnType<
    typeof getRuntimeSourceSyncCoordinator
  > | null = null;
  if (resolveLauncherSourceMode(process.env) === "managed") {
    try {
      coordinator = getRuntimeSourceSyncCoordinator(
        dataRoot,
        process.env
      );
      await coordinator.start();
    } catch {
      process.stderr.write(
        "Launcher agent warning: SOURCE_SCHEDULER_UNAVAILABLE\n"
      );
    }
  }

  const service = new LauncherService(dataRoot, process.env, {
    warn: (code) => {
      process.stderr.write(`Launcher agent warning: ${code}\n`);
    }
  });
  const companion = startCompanion(
    dataRoot,
    abortController.signal
  );
  try {
    await runLauncherJsonlSession({
      readable: process.stdin,
      writable: process.stdout,
      service,
      signal: abortController.signal
    });
  } finally {
    abortController.abort();
    await companion;
    coordinator?.stop();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function startCompanion(
  dataRoot: string,
  signal: AbortSignal
): Promise<void> {
  if (process.platform !== "darwin") return;
  const instanceId = `instance_${randomBytes(16).toString("hex")}`;
  let manager: ManagedCodexRunManager | null = null;
  try {
    manager = new ManagedCodexRunManager({
      cwd: dataRoot,
      ownerInstanceId: instanceId
    });
    const terminalLauncher = new MacOsTerminalResumeLauncher();
    await runCompanionDaemon({
      queue: createLocalWorkResumptionQueueAdapter(dataRoot),
      launcher: new ManagedCodexResumeLauncher(
        manager,
        terminalLauncher,
        { callerHoldsOwnershipLease: true }
      ),
      resolveTarget: (input) =>
        resolveCodexResumeTarget(input, { cwd: dataRoot }),
      resolveBinary: () => resolveCodexBinary(process.env),
      signal,
      instanceId
    });
  } catch {
    if (!signal.aborted) {
      process.stderr.write(
        "Launcher agent warning: COMPANION_UNAVAILABLE\n"
      );
    }
  } finally {
    try {
      await manager?.close();
    } catch {
      process.stderr.write(
        "Launcher agent warning: MANAGED_CODEX_CLOSE_FAILED\n"
      );
    }
  }
}

function safeStartupErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^[A-Z0-9_]{1,120}$/.test(
      (error as { code: string }).code
    )
  ) {
    return (error as { code: string }).code;
  }
  return "STARTUP_FAILED";
}
