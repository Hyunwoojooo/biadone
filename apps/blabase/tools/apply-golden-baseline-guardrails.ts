import { readFile, rename, writeFile } from "node:fs/promises";

import {
  compareBaselineRows,
  enforceEvaluationGuardrails,
  schemaPassRate,
  scoreRows
} from "../src/core/golden-baseline/evaluation";
import {
  GOLDEN_BASELINE_GUARDRAIL_VERSION,
  type FieldEvaluation,
  type GoldenBaselineRunOutput
} from "../src/core/golden-baseline/schema";

const path = process.argv[2] ?? ".local/golden-v01-results.json";
const output = JSON.parse(await readFile(path, "utf8")) as GoldenBaselineRunOutput;
let changedRows = 0;

for (const row of output.rows) {
  const source: FieldEvaluation = {
    field: row.fieldName,
    semanticScore: row.semanticScore,
    completenessScore: row.completenessScore,
    groundingScore: row.groundingScore,
    errorType: row.errorType,
    rationale: row.rationale
  };
  const [guarded] = enforceEvaluationGuardrails(
    [row.fieldName],
    [source],
    { [row.fieldName]: row.goldValue },
    { [row.fieldName]: row.baselineValue }
  );
  const before = JSON.stringify(source);
  const after = JSON.stringify(guarded);
  if (before !== after) changedRows += 1;
  row.semanticScore = guarded.semanticScore;
  row.completenessScore = guarded.completenessScore;
  row.groundingScore = guarded.groundingScore;
  row.errorType = guarded.errorType;
  row.rationale = guarded.rationale;
}

output.run.guardrailVersion = GOLDEN_BASELINE_GUARDRAIL_VERSION;
output.run.promptOnlyScore = round(
  scoreRows(output.rows, (row) => row.contextMode === "현재 프롬프트만")
);
output.run.withContextScore = round(
  scoreRows(output.rows, (row) => row.contextMode === "이전 맥락 포함")
);
output.run.contextUplift =
  output.run.promptOnlyScore === null || output.run.withContextScore === null
    ? null
    : round(output.run.withContextScore - output.run.promptOnlyScore);
output.run.sessionScore = round(
  scoreRows(output.rows, (row) => row.contextMode === "전체 세션")
);
output.run.schemaPassRate = round(schemaPassRate(output.rows));
output.rows.sort(compareBaselineRows);
if (!output.manifest.note.includes(GOLDEN_BASELINE_GUARDRAIL_VERSION)) {
  output.manifest.note += ` · ${GOLDEN_BASELINE_GUARDRAIL_VERSION}`;
}

const temporaryPath = `${path}.guardrail.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await rename(temporaryPath, path);
process.stdout.write(
  `${JSON.stringify({
    changedRows,
    promptOnlyScore: output.run.promptOnlyScore,
    withContextScore: output.run.withContextScore,
    contextUplift: output.run.contextUplift,
    sessionScore: output.run.sessionScore,
    schemaPassRate: output.run.schemaPassRate
  })}\n`
);

function round(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}
