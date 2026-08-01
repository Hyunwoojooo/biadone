import { resolveAttentionCodeProvenance } from "../src/attention/codeProvenance";
import { runArtifactRelationEvaluation } from "../src/evaluation/artifactRelationResolverEvaluation";

const startedAt = new Date();
const provenance = await resolveAttentionCodeProvenance(
  process.cwd(),
  process.env
);
const record = runArtifactRelationEvaluation({
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
