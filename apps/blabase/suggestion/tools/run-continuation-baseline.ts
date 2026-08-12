import { runAndStoreContinuationEvaluation } from "../src/evaluation/continuation";

const dataRoot = process.cwd();
const { record, storedArtifact } =
  await runAndStoreContinuationEvaluation({
    cwd: dataRoot,
    dataRoot,
    env: process.env
  });

console.log(
  JSON.stringify(
    {
      status: record.status,
      runId: record.runId,
      path: storedArtifact.relativePath,
      hashes: {
        datasetCandidatePayloadSha256:
          record.dataset.candidatePayloadSha256,
        materializedInputSha256: record.dataset.materializedInputSha256,
        configCandidatePayloadSha256: record.config.candidatePayloadSha256,
        deterministicOutputSha256: record.deterministicOutputSha256,
        canonicalArtifactPayloadSha256:
          record.artifact.canonicalPayloadSha256,
        storedArtifactSha256: storedArtifact.sha256
      },
      counts: record.counts
    },
    null,
    2
  )
);

if (record.status !== "passed") {
  process.exitCode = 1;
}
