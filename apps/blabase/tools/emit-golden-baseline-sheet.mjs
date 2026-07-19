import { readFile } from "node:fs/promises";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, "true");
  }
}

const file = args.get("--file") ?? ".local/golden-v01-results.json";
const from = Number.parseInt(args.get("--from") ?? "0", 10);
const to = Number.parseInt(args.get("--to") ?? String(from + 50), 10);
const output = JSON.parse(await readFile(file, "utf8"));
const allowPartial = args.has("--allow-partial");

if (!allowPartial) {
  if (output.run?.status !== "completed") {
    throw new Error(`Refusing to emit a ${output.run?.status ?? "unknown"} run`);
  }
  if (output.manifest?.sessionScope !== "S-001~S-020") {
    throw new Error("Refusing to emit a single-session/smoke run");
  }
  if (output.rows?.length !== 2024) {
    throw new Error(`Expected 2,024 rows, received ${output.rows?.length ?? 0}`);
  }
  const evalIds = new Set(output.rows.map((row) => row.evalId));
  if (evalIds.size !== output.rows.length) {
    throw new Error("Duplicate eval_id values detected");
  }
  const promptRows = output.rows.filter(
    (row) => row.taskType === "02_프롬프트판정"
  ).length;
  const summaryRows = output.rows.filter(
    (row) => row.taskType === "03_세션요약"
  ).length;
  if (promptRows !== 1864 || summaryRows !== 160) {
    throw new Error(
      `Unexpected task counts: prompts=${promptRows}, summaries=${summaryRows}`
    );
  }
}

const selected = output.rows.slice(from, to);
const values = selected.map((row, offset) => {
  const sheetRow = from + offset + 6;
  return [
    row.evalId,
    row.sessionId,
    row.targetId,
    row.taskType,
    row.fieldName,
    row.contextMode,
    row.datasetVersion,
    row.runId,
    row.goldValue,
    row.baselineValue,
    row.schemaCheck,
    row.semanticScore,
    row.completenessScore,
    row.groundingScore,
    `=IFERROR(AVERAGE(FILTER(L${sheetRow}:N${sheetRow},ISNUMBER(L${sheetRow}:N${sheetRow})))/2,"")`,
    row.errorType,
    row.rationale,
    row.reviewResult,
    row.reviewNote,
    row.modelId,
    row.promptVersion,
    row.runAt
  ];
});

process.stdout.write(
  JSON.stringify({
    from,
    to: from + values.length,
    total: output.rows.length,
    manifest: from === 0 ? output.manifest : undefined,
    run: from === 0 ? output.run : undefined,
    values
  })
);
