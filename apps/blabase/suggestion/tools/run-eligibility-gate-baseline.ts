import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { resolveAttentionCodeProvenance } from "../src/attention/codeProvenance";
import { runAttentionEligibilityEvaluation } from "../src/evaluation/eligibilityGateEvaluation";

const startedAt = new Date();
const provenance = await resolveAttentionCodeProvenance(
  process.cwd(),
  process.env
);
const record = runAttentionEligibilityEvaluation({
  startedAt,
  code: {
    commitSha: provenance.codeCommitSha,
    state: provenance.codeState,
    fingerprintSha256: provenance.codeFingerprintSha256
  }
});
const serializedRecord = `${JSON.stringify(record, null, 2)}\n`;
const outputDirectory = join(
  process.cwd(),
  ".local",
  "evaluations",
  "attention-eligibility"
);
const recordPath = join(outputDirectory, `${record.runId}.json`);
const recordSha256 = createHash("sha256")
  .update(serializedRecord)
  .digest("hex");

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
await chmod(outputDirectory, 0o700);
await writeFile(recordPath, serializedRecord, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600
});

console.log(
  JSON.stringify(
    {
      record,
      artifact: {
        path: relative(process.cwd(), recordPath),
        sha256: recordSha256
      }
    },
    null,
    2
  )
);
if (record.status !== "passed") {
  process.exitCode = 1;
}
