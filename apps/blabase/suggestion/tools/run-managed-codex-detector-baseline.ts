import { resolveAttentionCodeProvenance } from "../src/attention/codeProvenance";
import { runManagedCodexDetectorEvaluation } from "../src/evaluation/managedCodexDetectorEvaluation";

const startedAt = new Date();
const provenance = await resolveAttentionCodeProvenance(
  process.cwd(),
  process.env
);
const record = runManagedCodexDetectorEvaluation({
  startedAt,
  code: {
    commitSha: provenance.codeCommitSha,
    state: provenance.codeState,
    fingerprintSha256: provenance.codeFingerprintSha256
  }
});

console.log(JSON.stringify(record, null, 2));
if (record.status !== "passed") {
  process.exitCode = 1;
}
