import {
  resolveCodexBinary,
  type CodexBinaryResolution
} from "../../connectors/codex/config";
import {
  CodexConnectorError
} from "../../connectors/codex/appServer";
import {
  CodexResumeTargetError,
  resolveCodexResumeTarget,
  type CodexResumeTarget
} from "../../connectors/codex/resumeTarget";
import type {
  CodexResumeLauncher,
  CompanionCommand,
  CompanionCommandCompletion,
  CompanionResultCode,
  WorkResumptionQueueAdapter
} from "./types";
import { WorkResumptionCompanionError } from "./types";

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 5_000;

export type CompanionCycleResult =
  | { kind: "idle" }
  | {
      kind: "handled";
      commandId: string;
      resultCode: CompanionResultCode;
    };

export type CompanionRuntimeDependencies = {
  queue: WorkResumptionQueueAdapter;
  launcher: CodexResumeLauncher;
  resolveTarget?: (input: {
    executionId: string;
    scopeId: string;
  }) => Promise<CodexResumeTarget>;
  resolveBinary?: () => Promise<CodexBinaryResolution>;
  now?: () => Date;
  instanceId?: string;
};

export async function runCompanionCycle(
  dependencies: CompanionRuntimeDependencies
): Promise<CompanionCycleResult> {
  const now = dependencies.now ?? (() => new Date());
  const claimedAt = now();
  const command = await dependencies.queue.claimNext({
    claimedAt: claimedAt.toISOString()
  });
  if (!command) return { kind: "idle" };

  if (isExpired(command, claimedAt)) {
    return completeCommand(
      dependencies.queue,
      command,
      now(),
      {
        status: "expired",
        resultCode: "COMMAND_EXPIRED"
      }
    );
  }

  const resolveTarget =
    dependencies.resolveTarget ??
    ((input) => resolveCodexResumeTarget(input));
  let target: CodexResumeTarget;
  try {
    target = await resolveTarget({
      executionId: command.executionId,
      scopeId: command.scopeId
    });
  } catch (error) {
    return completeCommand(
      dependencies.queue,
      command,
      now(),
      resolverFailure(error)
    );
  }

  const resolveBinary =
    dependencies.resolveBinary ?? (() => resolveCodexBinary());
  let binary: CodexBinaryResolution;
  try {
    binary = await resolveBinary();
  } catch {
    return completeCommand(
      dependencies.queue,
      command,
      now(),
      failed("CODEX_UNAVAILABLE")
    );
  }
  if (!binary.ok) {
    return completeCommand(
      dependencies.queue,
      command,
      now(),
      failed("CODEX_UNAVAILABLE")
    );
  }

  const beforeLaunch = now();
  if (isExpired(command, beforeLaunch)) {
    return completeCommand(
      dependencies.queue,
      command,
      beforeLaunch,
      {
        status: "expired",
        resultCode: "COMMAND_EXPIRED"
      }
    );
  }

  const launched = await dependencies.queue.launchIfCurrent(
    {
      commandId: command.commandId,
      bindingId: command.bindingId,
      claimToken: command.claimToken,
      launchStartedAt: beforeLaunch.toISOString()
    },
    async () => {
      let completion: CompanionCommandCompletion;
      try {
        const resultCode =
          await dependencies.launcher.focusOrResume({
            bindingId: command.bindingId,
            codexBinaryPath: binary.binaryPath,
            target
          });
        completion = {
          status: "succeeded",
          resultCode
        };
      } catch (error) {
        completion = launcherFailure(error);
      }
      return {
        completedAt: now().toISOString(),
        completion
      };
    }
  );
  if (launched.state === "not_current") {
    return { kind: "idle" };
  }
  return {
    kind: "handled",
    commandId: command.commandId,
    resultCode: launched.resultCode
  };
}

export async function runCompanionDaemon(
  dependencies: CompanionRuntimeDependencies & {
    signal: AbortSignal;
    once?: boolean;
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
  }
): Promise<CompanionCycleResult | null> {
  const runtime = dependencies;
  const pollIntervalMs = boundedInterval(
    dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  );
  const heartbeatIntervalMs = Math.max(
    1_000,
    dependencies.heartbeatIntervalMs ??
      DEFAULT_HEARTBEAT_INTERVAL_MS
  );
  const now = dependencies.now ?? (() => new Date());
  const instanceId =
    dependencies.instanceId ??
    `instance_${randomBytes(16).toString("hex")}`;

  if (dependencies.once) {
    return runCompanionCycle(runtime);
  }

  const internalAbort = new AbortController();
  const forwardAbort = () => internalAbort.abort();
  dependencies.signal.addEventListener("abort", forwardAbort, {
    once: true
  });
  if (dependencies.signal.aborted) internalAbort.abort();
  let ownsHeartbeat = false;
  let commandLoop: Promise<void> = Promise.resolve();
  let heartbeatLoop: Promise<void> = Promise.resolve();

  try {
    if (internalAbort.signal.aborted) return null;
    await writeHeartbeat(dependencies.queue, now(), instanceId);
    ownsHeartbeat = true;
    commandLoop = runCommandLoop(
      runtime,
      internalAbort.signal,
      pollIntervalMs
    );
    heartbeatLoop = runHeartbeatLoop(
      dependencies.queue,
      now,
      instanceId,
      internalAbort.signal,
      heartbeatIntervalMs
    );
    await Promise.race([commandLoop, heartbeatLoop]);
    if (!internalAbort.signal.aborted) {
      internalAbort.abort();
    }
    await Promise.all([commandLoop, heartbeatLoop]);
  } finally {
    dependencies.signal.removeEventListener(
      "abort",
      forwardAbort
    );
    internalAbort.abort();
    await Promise.allSettled([commandLoop, heartbeatLoop]);
    if (ownsHeartbeat) {
      await dependencies.queue.clearHeartbeat({ instanceId });
    }
  }
  return null;
}

async function runCommandLoop(
  dependencies: CompanionRuntimeDependencies,
  signal: AbortSignal,
  pollIntervalMs: number
): Promise<void> {
  while (!signal.aborted) {
    await runCompanionCycle(dependencies);
    await waitForNextCycle(pollIntervalMs, signal);
  }
}

async function runHeartbeatLoop(
  queue: WorkResumptionQueueAdapter,
  now: () => Date,
  instanceId: string,
  signal: AbortSignal,
  heartbeatIntervalMs: number
): Promise<void> {
  while (!signal.aborted) {
    await waitForNextCycle(heartbeatIntervalMs, signal);
    if (signal.aborted) return;
    await writeHeartbeat(
      queue,
      now(),
      instanceId
    );
  }
}

async function writeHeartbeat(
  queue: WorkResumptionQueueAdapter,
  now: Date,
  instanceId: string
): Promise<void> {
  await queue.writeHeartbeat({
    instanceId,
    observedAt: now.toISOString()
  });
}

async function completeCommand(
  queue: WorkResumptionQueueAdapter,
  command: CompanionCommand,
  completedAt: Date,
  completion: CompanionCommandCompletion
): Promise<CompanionCycleResult> {
  await queue.complete({
    commandId: command.commandId,
    claimToken: command.claimToken,
    completedAt: completedAt.toISOString(),
    completion
  });
  return {
    kind: "handled",
    commandId: command.commandId,
    resultCode: completion.resultCode
  };
}

function resolverFailure(
  error: unknown
): CompanionCommandCompletion {
  if (error instanceof CodexResumeTargetError) {
    switch (error.code) {
      case "CODEX_EXECUTION_NOT_FOUND":
        return failed("EXECUTION_NOT_FOUND");
      case "CODEX_EXECUTION_STALE":
        return failed("EXECUTION_STALE");
      case "CODEX_CONFIG_MISSING":
      case "CODEX_SCOPE_NOT_SELECTED":
      case "CODEX_RESUME_TARGET_INVALID":
        return failed("CODEX_UNAVAILABLE");
    }
  }
  if (error instanceof CodexConnectorError) {
    return failed("CODEX_UNAVAILABLE");
  }
  return failed("CODEX_UNAVAILABLE");
}

function launcherFailure(
  error: unknown
): CompanionCommandCompletion {
  if (error instanceof WorkResumptionCompanionError) {
    if (error.code === "UNSUPPORTED_PLATFORM") {
      return failed("UNSUPPORTED_PLATFORM");
    }
  }
  return failed("LAUNCH_FAILED");
}

function failed(
  resultCode: CompanionResultCode
): CompanionCommandCompletion {
  return { status: "failed", resultCode };
}

function isExpired(
  command: CompanionCommand,
  now: Date
): boolean {
  const expiresAt = Date.parse(command.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

function boundedInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(
    MAX_POLL_INTERVAL_MS,
    Math.max(MIN_POLL_INTERVAL_MS, Math.floor(value))
  );
}

function waitForNextCycle(
  durationMs: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, durationMs);
    signal.addEventListener("abort", finish, { once: true });

    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
import { randomBytes } from "node:crypto";
