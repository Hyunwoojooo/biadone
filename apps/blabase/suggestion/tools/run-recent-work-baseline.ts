import { resolveAttentionCodeProvenance } from "../src/attention/codeProvenance";
import { sha256Canonical } from "../src/evaluation/crossSourceIntegrity";
import { writePrivateEvaluationArtifact } from "../src/evaluation/privateArtifactStore";
import { runRecentWorkEvaluation } from "../src/evaluation/recentWorkEvaluation";

const startedAt = new Date();
const dataRoot = process.cwd();
const provenance = await resolveAttentionCodeProvenance(dataRoot, process.env);
const record = runRecentWorkEvaluation({
  startedAt,
  code: {
    commitSha: provenance.codeCommitSha,
    state: provenance.codeState,
    fingerprintSha256: provenance.codeFingerprintSha256
  }
});
const { artifact: descriptor, ...canonicalPayload } = record;
if (descriptor.canonicalPayloadSha256 !== sha256Canonical(canonicalPayload)) {
  throw new TypeError("Recent Work evaluation artifact hash is incoherent.");
}
if (
  descriptor.relativePath !==
  `.local/evaluations/recent-work-projection/${record.runId}.json`
) {
  throw new TypeError("Recent Work evaluation artifact path is incoherent.");
}
const serialized = `${JSON.stringify(record, null, 2)}\n`;
const stored = await writePrivateEvaluationArtifact({
  dataRoot,
  relativePath: descriptor.relativePath,
  contents: serialized
});

console.log(
  JSON.stringify(
    {
      record,
      artifact: {
        path: stored.relativePath,
        sha256: stored.sha256,
        byteLength: stored.byteLength,
        mode: stored.mode
      }
    },
    null,
    2
  )
);
if (record.status !== "passed") process.exitCode = 1;
