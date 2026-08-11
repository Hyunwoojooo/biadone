import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { resolveAttentionCodeProvenance } from "../src/attention/codeProvenance";
import { sha256Canonical } from "../src/evaluation/crossSourceIntegrity";
import { runCurrentFocusEvaluation } from "../src/evaluation/currentFocusEvaluation";

const startedAt = new Date();
const provenance = await resolveAttentionCodeProvenance(
  process.cwd(),
  process.env
);
const record = runCurrentFocusEvaluation({
  startedAt,
  code: {
    commitSha: provenance.codeCommitSha,
    state: provenance.codeState,
    fingerprintSha256: provenance.codeFingerprintSha256
  }
});
const { artifact: artifactDescriptor, ...canonicalRecordPayload } = record;
if (
  artifactDescriptor.canonicalPayloadSha256 !==
  sha256Canonical(canonicalRecordPayload)
) {
  throw new TypeError("Current Focus evaluation artifact hash is incoherent.");
}
const outputDirectory = join(
  process.cwd(),
  ".local",
  "evaluations",
  "current-focus"
);
const recordPath = join(outputDirectory, `${record.runId}.json`);
if (relative(process.cwd(), recordPath) !== artifactDescriptor.relativePath) {
  throw new TypeError("Current Focus evaluation artifact path is incoherent.");
}
const serializedRecord = `${JSON.stringify(record, null, 2)}\n`;
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
if (record.status !== "passed") process.exitCode = 1;
