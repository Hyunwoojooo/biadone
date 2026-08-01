import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  resolveCodexBinary
} from "../src/connectors/codex/config";
import {
  CodexConnectorError
} from "../src/connectors/codex/appServer";
import {
  CodexResumeTargetError,
  resolveCodexResumeTarget
} from "../src/connectors/codex/resumeTarget";
import {
  readCurrentCodexConnectionGeneration,
  resolveStoredCodexExecutionScopeId,
  WorkResumptionStoreError
} from "../src/resumption/store";
import {
  createLocalWorkResumptionQueueAdapter
} from "../src/resumption/companion/localQueueAdapter";
import {
  runCompanionDaemon
} from "../src/resumption/companion/runtime";
import {
  DryRunResumeValidator,
  MacOsTerminalResumeLauncher
} from "../src/resumption/companion/terminal";
import {
  ManagedCodexResumeLauncher,
  ManagedCodexRunManager,
  isManagedCodexRuntimeError
} from "../src/managedCodex/runtime";
import {
  WorkResumptionCompanionError
} from "../src/resumption/companion/types";

const SUGGESTION_ROOT = fileURLToPath(
  new URL("../", import.meta.url)
).replace(/\/+$/, "");
const DIAGNOSTIC_BINDING_ID = `binding_${"0".repeat(32)}`;

type CliMode =
  | { kind: "daemon" }
  | { kind: "once" }
  | { kind: "dry-run"; executionId: string }
  | { kind: "help" };

await main().catch((error: unknown) => {
  process.stderr.write(
    `Work Resumption Companion failed: ${safeErrorCode(error)}\n`
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const mode = parseArgs(process.argv.slice(2));
  if (mode.kind === "help") {
    process.stdout.write(helpText());
    return;
  }
  if (mode.kind === "dry-run") {
    await runStandaloneDryRun(mode.executionId);
    process.stdout.write(
      "Work Resumption diagnostic validation succeeded.\n"
    );
    return;
  }
  if (process.platform !== "darwin") {
    throw new WorkResumptionCompanionError(
      "UNSUPPORTED_PLATFORM",
      "macOS only"
    );
  }
  const preflightBinary = await resolveCodexBinary();
  if (!preflightBinary.ok) {
    throw new WorkResumptionCompanionError(
      "INVALID_RESUME_INVOCATION",
      "Codex binary unavailable"
    );
  }

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const instanceId = `instance_${randomBytes(16).toString("hex")}`;
  const managedRunManager =
    mode.kind === "daemon"
      ? new ManagedCodexRunManager({
          cwd: SUGGESTION_ROOT,
          ownerInstanceId: instanceId
        })
      : null;
  const terminalLauncher = new MacOsTerminalResumeLauncher();
  try {
    if (mode.kind === "daemon") {
      process.stdout.write(
        "Work Resumption Companion and managed Codex observation are running.\n"
      );
    }
    const result = await runCompanionDaemon({
      queue: createLocalWorkResumptionQueueAdapter(
        SUGGESTION_ROOT
      ),
      launcher: managedRunManager
        ? new ManagedCodexResumeLauncher(
            managedRunManager,
            terminalLauncher,
            { callerHoldsOwnershipLease: true }
          )
        : terminalLauncher,
      resolveTarget: (input) =>
        resolveCodexResumeTarget(input, {
          cwd: SUGGESTION_ROOT
        }),
      resolveBinary: () => resolveCodexBinary(),
      signal: abortController.signal,
      once: mode.kind === "once",
      instanceId
    });
    if (mode.kind === "once") {
      process.stdout.write(
        result?.kind === "handled"
          ? `Work Resumption command handled: ${result.resultCode}\n`
          : "No pending Work Resumption command.\n"
      );
    }
  } finally {
    await managedRunManager?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function runStandaloneDryRun(
  executionId: string
): Promise<void> {
  const [scopeId, connectionGeneration] = await Promise.all([
    resolveStoredCodexExecutionScopeId(
      executionId,
      SUGGESTION_ROOT
    ),
    readCurrentCodexConnectionGeneration(SUGGESTION_ROOT)
  ]);
  const [target, binary] = await Promise.all([
    resolveCodexResumeTarget(
      { executionId, scopeId },
      { cwd: SUGGESTION_ROOT }
    ),
    resolveCodexBinary()
  ]);
  if (!binary.ok) {
    throw new WorkResumptionCompanionError(
      "INVALID_RESUME_INVOCATION",
      "Codex binary unavailable"
    );
  }
  await new DryRunResumeValidator().validate({
    bindingId: DIAGNOSTIC_BINDING_ID,
    executionId,
    scopeId,
    connectionGeneration,
    codexBinaryPath: binary.binaryPath,
    target
  });
}

function parseArgs(argv: string[]): CliMode {
  if (argv.length === 0) return { kind: "daemon" };
  if (argv.length === 1 && argv[0] === "--once") {
    return { kind: "once" };
  }
  if (
    argv.length === 2 &&
    argv[0] === "--dry-run" &&
    argv[1].startsWith("codex:execution:")
  ) {
    return { kind: "dry-run", executionId: argv[1] };
  }
  if (
    argv.length === 1 &&
    (argv[0] === "--help" || argv[0] === "-h")
  ) {
    return { kind: "help" };
  }
  throw new Error("INVALID_ARGUMENTS");
}

function helpText(): string {
  return [
    "Work Resumption Companion",
    "",
    "Usage:",
    "  npm run companion:work-resumption",
    "  npm run companion:work-resumption -- --once",
    "  npm run companion:work-resumption -- --dry-run codex:execution:<opaque-id>",
    "",
    "The dry-run is standalone: it does not write a heartbeat, claim a",
    "product command, or open Terminal.",
    ""
  ].join("\n");
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof WorkResumptionCompanionError ||
    error instanceof CodexResumeTargetError ||
    error instanceof CodexConnectorError ||
    error instanceof WorkResumptionStoreError ||
    isManagedCodexRuntimeError(error)
  ) {
    return error.code;
  }
  return "UNEXPECTED_ERROR";
}
