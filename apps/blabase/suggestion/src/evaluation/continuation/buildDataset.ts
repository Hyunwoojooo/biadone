import configArtifact from "../../../eval/synthetic/continuationEvaluationConfig.v0.3.json";
import datasetArtifact from "../../../eval/synthetic/continuationEvaluationCases.v0.3.json";
import { sha256Canonical } from "../crossSourceIntegrity";
import {
  CONTINUATION_EVALUATION_CONFIG_VERSION,
  continuationEvaluationConfigSchema,
  continuationEvaluationDatasetSchema,
  type ContinuationEvaluationConfig,
  type ContinuationEvaluationDataset
} from "./contracts";

export function loadContinuationEvaluationDataset(
  input: unknown,
  configInput: unknown = configArtifact
): ContinuationEvaluationDataset {
  const parsedConfig = continuationEvaluationConfigSchema.parse(configInput);
  const parsedDataset = continuationEvaluationDatasetSchema.parse(input);
  if (
    parsedDataset.evaluatorConfig.version !== parsedConfig.version ||
    parsedDataset.evaluatorConfig.candidateRef !==
      "eval/synthetic/continuationEvaluationConfig.v0.3.json"
  ) {
    throw new TypeError("Continuation dataset does not pin the E-001 evaluator config candidate.");
  }
  return parsedDataset;
}

export const continuationEvaluationConfig: ContinuationEvaluationConfig =
  continuationEvaluationConfigSchema.parse(configArtifact);

export const continuationEvaluationDataset: ContinuationEvaluationDataset =
  loadContinuationEvaluationDataset(datasetArtifact, continuationEvaluationConfig);

export const CONTINUATION_EVALUATION_CONFIG_CANDIDATE_SHA256 =
  sha256Canonical(continuationEvaluationConfig);

export const CONTINUATION_EVALUATION_DATASET_CANDIDATE_SHA256 =
  sha256Canonical(continuationEvaluationDataset);

export function continuationEvaluationDatasetCandidateSha256(
  dataset: ContinuationEvaluationDataset
): string {
  return sha256Canonical(dataset);
}

export function continuationEvaluationConfigCandidateSha256(
  config: ContinuationEvaluationConfig
): string {
  if (config.version !== CONTINUATION_EVALUATION_CONFIG_VERSION) {
    throw new TypeError("Unsupported Continuation evaluation config candidate.");
  }
  return sha256Canonical(config);
}
