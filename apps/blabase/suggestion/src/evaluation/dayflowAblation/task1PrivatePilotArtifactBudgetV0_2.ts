export const TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2 = Object.freeze({
  "authorization.json": 131_072,
  "authorization.sha256": 64,
  "structured-evidence.json": 786_432,
  "dayflow-source-payload.json": 4_194_304,
  "dayflow-source-manifest.json": 16_384,
  "dayflow-source-manifest.sha256": 64,
  "dayflow-source-COMPLETE": 64,
  "evaluation-input-manifest.json": 98_304,
  "evaluation-input-manifest.sha256": 64,
  COMPLETE: 64,
} as const);

export type Task1PrivatePilotArtifactBudgetFileV0_2 =
  keyof typeof TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2;

export const TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2 =
  5_226_816 as const;

const derivedTotalBytes = Object.values(
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2,
).reduce((total, maximumBytes) => total + maximumBytes, 0);

export const TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_INVARIANT_V0_2 =
  Object.freeze({
    fileCount: Object.keys(TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2).length,
    derivedTotalBytes,
    declaredTotalBytes: TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
    matchesDeclaredTotal:
      derivedTotalBytes ===
      TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_TOTAL_BYTES_V0_2,
  });

if (
  TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_INVARIANT_V0_2.fileCount !== 10 ||
  !TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_INVARIANT_V0_2.matchesDeclaredTotal
) {
  throw new Error("TASK1_PRIVATE_PILOT_ARTIFACT_BUDGET_V0_2_INVALID");
}
