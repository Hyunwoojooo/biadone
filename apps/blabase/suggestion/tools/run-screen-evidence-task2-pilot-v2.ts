import path from "node:path";

import {
  runScreenEvidenceTask2SameEnginePilotV2,
  ScreenEvidenceTask2PilotErrorV1,
} from "../src/evaluation/screenEvidenceAblation/runScreenEvidenceTask2SameEnginePilotV2";

const FLAG_NAMES = Object.freeze([
  "--input-run-id",
  "--expected-input-identity",
  "--execution-id",
] as const);

function parseFlags(argv: readonly string[]): Readonly<{
  inputRunId: string;
  expectedInputIdentitySha256: string;
  executionId: string;
}> {
  if (argv.length !== FLAG_NAMES.length * 2) throw new TypeError("INPUT_INVALID");
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !FLAG_NAMES.includes(flag as (typeof FLAG_NAMES)[number]) ||
      values.has(flag) ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new TypeError("INPUT_INVALID");
    }
    values.set(flag, value);
  }
  if (FLAG_NAMES.some((flag) => !values.has(flag))) {
    throw new TypeError("INPUT_INVALID");
  }
  return Object.freeze({
    inputRunId: values.get("--input-run-id")!,
    expectedInputIdentitySha256: values.get("--expected-input-identity")!,
    executionId: values.get("--execution-id")!,
  });
}

async function main(): Promise<void> {
  try {
    const flags = parseFlags(process.argv.slice(2));
    const result = await runScreenEvidenceTask2SameEnginePilotV2({
      projectDirectory: path.resolve(process.cwd()),
      inputRunId: flags.inputRunId,
      expectedInputIdentitySha256: flags.expectedInputIdentitySha256,
      executionId: flags.executionId,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    const issueCode =
      error instanceof ScreenEvidenceTask2PilotErrorV1
        ? error.issueCode
        : "INPUT_INVALID";
    process.stderr.write(`${JSON.stringify({ ok: false, issueCode })}\n`);
    process.exitCode = 1;
  }
}

void main();
