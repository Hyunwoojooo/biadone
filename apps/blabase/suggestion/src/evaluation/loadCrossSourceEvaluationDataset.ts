import {
  crossSourceEvaluationDatasetSchema,
  type CrossSourceEvaluationDataset
} from "./crossSourceDatasetSchema";
import {
  assertCrossSourceEvaluationDatasetIntegrity,
  type CrossSourceIntegrityOptions
} from "./crossSourceIntegrity";

/**
 * Parses an already captured evaluation artifact without changing its
 * ordering, timestamps, labels, hashes, or lifecycle state.
 */
export function loadCrossSourceEvaluationDataset(
  input: unknown
): CrossSourceEvaluationDataset {
  return crossSourceEvaluationDatasetSchema.parse(input);
}

/**
 * Use this entrypoint for evaluation runs. It refuses schema-valid artifacts
 * whose snapshots, detector config, or frozen dataset digest cannot be
 * reproduced.
 */
export function loadVerifiedCrossSourceEvaluationDataset(
  input: unknown,
  integrityOptions: CrossSourceIntegrityOptions = {}
): CrossSourceEvaluationDataset {
  const dataset = loadCrossSourceEvaluationDataset(input);
  assertCrossSourceEvaluationDatasetIntegrity(dataset, integrityOptions);
  return dataset;
}
