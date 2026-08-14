import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { readStoredCodexConfig } from "../src/connectors/codex/localStore";
import {
  readWorkBoardMonitoringState,
  readWorkBoardMonitoringStore,
  replayWorkBoardMonitoringStore,
  workBoardMonitoringQualitySchema,
  workBoardMonitoringReplaySchema
} from "../src/suggestionBoard/monitoring";

const WORK_BOARD_MONITORING_CLI_CONTRACT =
  "work-board-monitoring-cli-v0.1" as const;
const QUALITY_AGGREGATE_SCOPE =
  "stored_quality_aggregate_only" as const;
const MAX_STDOUT_BYTES = 64 * 1024;

const commandSchema = z.enum(["aggregate", "replay"]);
const unavailableCodeSchema = z.enum([
  "CONFIG_UNAVAILABLE",
  "STORE_MISSING",
  "STORE_INVALID",
  "READ_FAILED",
  "OUTPUT_LIMIT_EXCEEDED"
]);
const aggregateOutputSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_CLI_CONTRACT),
    command: z.literal("aggregate"),
    scope: z.literal(QUALITY_AGGREGATE_SCOPE),
    status: z.literal("ready"),
    aggregate: workBoardMonitoringQualitySchema
  })
  .strict();
const replayOutputSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_CLI_CONTRACT),
    command: z.literal("replay"),
    scope: z.literal(QUALITY_AGGREGATE_SCOPE),
    status: z.enum(["matched", "mismatch"]),
    replay: workBoardMonitoringReplaySchema
  })
  .strict();
const unavailableOutputSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_CLI_CONTRACT),
    command: commandSchema,
    scope: z.literal(QUALITY_AGGREGATE_SCOPE),
    status: z.literal("unavailable"),
    code: unavailableCodeSchema
  })
  .strict();
const invalidArgumentsOutputSchema = z
  .object({
    contract: z.literal(WORK_BOARD_MONITORING_CLI_CONTRACT),
    command: z.null(),
    status: z.literal("error"),
    code: z.literal("INVALID_ARGUMENTS")
  })
  .strict();
const outputSchema = z.union([
  aggregateOutputSchema,
  replayOutputSchema,
  unavailableOutputSchema,
  invalidArgumentsOutputSchema
]);

type Command = z.infer<typeof commandSchema>;
type CliOutput = z.infer<typeof outputSchema>;

export type WorkBoardMonitoringCliResult = {
  exitCode: 0 | 1 | 2;
  stdout: string;
};

/**
 * Reads only the authenticated local monitoring namespace. The replay command
 * recomputes its bounded quality aggregate; it never runs the production engine.
 */
export async function runWorkBoardMonitoringCli(
  argv: readonly string[],
  options: { cwd?: string; now?: Date } = {}
): Promise<WorkBoardMonitoringCliResult> {
  const command = parseCommand(argv);
  if (command === null) {
    return serializeOutput(
      {
        contract: WORK_BOARD_MONITORING_CLI_CONTRACT,
        command: null,
        status: "error",
        code: "INVALID_ARGUMENTS"
      },
      2
    );
  }

  try {
    const cwd = resolve(options.cwd ?? process.cwd());
    const config = await readStoredCodexConfig(cwd, "preserve");
    if (config === null) {
      return unavailable(command, "CONFIG_UNAVAILABLE");
    }

    if (command === "aggregate") {
      const state = await readWorkBoardMonitoringState({
        cwd,
        installationSecret: config.installationSecret,
        now: options.now
      });
      return serializeOutput(
        {
          contract: WORK_BOARD_MONITORING_CLI_CONTRACT,
          command,
          scope: QUALITY_AGGREGATE_SCOPE,
          status: "ready",
          aggregate: state.aggregate
        },
        0
      );
    }

    const store = await readWorkBoardMonitoringStore({
      cwd,
      installationSecret: config.installationSecret
    });
    if (store.status === "missing") {
      return unavailable(command, "STORE_MISSING");
    }
    if (store.status === "invalid") {
      return unavailable(command, "STORE_INVALID");
    }
    const replay = replayWorkBoardMonitoringStore(store.value);
    return serializeOutput(
      {
        contract: WORK_BOARD_MONITORING_CLI_CONTRACT,
        command,
        scope: QUALITY_AGGREGATE_SCOPE,
        status: replay.status,
        replay
      },
      replay.status === "matched" ? 0 : 1
    );
  } catch {
    return unavailable(command, "READ_FAILED");
  }
}

function parseCommand(argv: readonly string[]): Command | null {
  if (argv.length !== 1) return null;
  const parsed = commandSchema.safeParse(argv[0]);
  return parsed.success ? parsed.data : null;
}

function unavailable(
  command: Command,
  code: z.infer<typeof unavailableCodeSchema>
): WorkBoardMonitoringCliResult {
  return serializeOutput(
    {
      contract: WORK_BOARD_MONITORING_CLI_CONTRACT,
      command,
      scope: QUALITY_AGGREGATE_SCOPE,
      status: "unavailable",
      code
    },
    2
  );
}

function serializeOutput(
  output: CliOutput,
  exitCode: 0 | 1 | 2
): WorkBoardMonitoringCliResult {
  const serialized = `${JSON.stringify(outputSchema.parse(output))}\n`;
  if (Buffer.byteLength(serialized, "utf8") <= MAX_STDOUT_BYTES) {
    return { exitCode, stdout: serialized };
  }
  const command = output.command;
  if (command === null) {
    return {
      exitCode: 2,
      stdout: `${JSON.stringify({
        contract: WORK_BOARD_MONITORING_CLI_CONTRACT,
        command: null,
        status: "error",
        code: "INVALID_ARGUMENTS"
      })}\n`
    };
  }
  return {
    exitCode: 2,
    stdout: `${JSON.stringify({
      contract: WORK_BOARD_MONITORING_CLI_CONTRACT,
      command,
      scope: QUALITY_AGGREGATE_SCOPE,
      status: "unavailable",
      code: "OUTPUT_LIMIT_EXCEEDED"
    })}\n`
  };
}

function isDirectInvocation(): boolean {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isDirectInvocation()) {
  const result = await runWorkBoardMonitoringCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}
