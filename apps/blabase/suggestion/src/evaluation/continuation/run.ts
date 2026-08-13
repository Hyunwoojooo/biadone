import { createHash, randomBytes } from "node:crypto";

import {
  resolveAttentionCodeProvenance,
  unavailableCodeProvenance,
  type AttentionCodeProvenance
} from "../../attention/codeProvenance";
import {
  ACTIVE_ATTENTION_POLICY_VERSION,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT,
  CONTINUATION_CANDIDATE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_RESULT_CONTRACT,
  CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
  CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  CONTINUATION_CODEX_ADAPTER_VERSION,
  CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
  CONTINUATION_DECISION_CONTRACT,
  CONTINUATION_DECISION_SCHEMA_VERSION,
  CONTINUATION_GITHUB_ADAPTER_VERSION,
  CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
  CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
  CONTINUATION_RESOLUTION_SCHEMA_VERSION,
  CONTINUATION_RESOLVED_DECISION_CONTRACT,
  CONTINUATION_RESOLVED_DECISION_SCHEMA_VERSION,
  CONTINUATION_RESOLVER_VERSION,
  CONTINUATION_RULE_VERSION,
  CONTINUATION_SCORING_POLICY_VERSION,
  CONTINUATION_SCORING_RESULT_CONTRACT,
  CONTINUATION_SCORING_SCHEMA_VERSION,
  WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
  WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
  WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
  WORK_SUGGESTION_BOARD_SCHEMA_VERSION
} from "../../crossSource/versions";
import {
  CONTINUATION_IDENTITY_INPUT_CONTRACT,
  CONTINUATION_IDENTITY_RESULT_CONTRACT,
  CONTINUATION_IDENTITY_SCHEMA_VERSION
} from "../../continuation/resolveIdentity";
import { writePrivateEvaluationArtifact } from "../privateArtifactStore";
import {
  CONTINUATION_EVALUATION_CONFIG_CANDIDATE_SHA256,
  CONTINUATION_EVALUATION_DATASET_CANDIDATE_SHA256,
  continuationEvaluationConfig,
  continuationEvaluationDataset,
  continuationEvaluationDatasetCandidateSha256
} from "./buildDataset";
import {
  CONTINUATION_EVALUATION_CASE_SCHEMA_VERSION,
  CONTINUATION_EVALUATION_DATASET_CONTRACT,
  CONTINUATION_EVALUATION_POLICY_VERSION,
  CONTINUATION_EVALUATION_RUN_RECORD_CONTRACT,
  continuationEvaluationArtifactPayloadSha256,
  continuationEvaluationDeterministicOutputSha256,
  continuationEvaluationDatasetSchema,
  continuationEvaluationRunRecordSchema,
  type ContinuationEvaluationDataset,
  type ContinuationEvaluationRunRecord
} from "./contracts";
import { evaluateContinuationDataset } from "./evaluate";

export function runContinuationEvaluation(input: {
  startedAt?: Date;
  completedAt?: Date;
  code?: AttentionCodeProvenance;
  dataset?: ContinuationEvaluationDataset;
} = {}, dependencies: {
  now?: () => Date;
} = {}): ContinuationEvaluationRunRecord {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = input.startedAt ?? now();
  const dataset = continuationEvaluationDatasetSchema.parse(
    input.dataset ?? continuationEvaluationDataset
  );
  const code = input.code ?? unavailableCodeProvenance();
  const evaluation = evaluateContinuationDataset(dataset);
  const completedAt = input.completedAt ?? now();
  const versions = continuationEvaluationVersions();
  const deterministicOutputSha256 =
    continuationEvaluationDeterministicOutputSha256({
      datasetCandidatePayloadSha256:
        continuationEvaluationDatasetCandidateSha256(dataset),
      configCandidatePayloadSha256:
        CONTINUATION_EVALUATION_CONFIG_CANDIDATE_SHA256,
      materializedInputSha256: evaluation.materializedInputSha256,
      versions,
      counts: evaluation.counts,
      metrics: evaluation.metrics,
      cases: evaluation.cases
    });
  const status = contractScaffoldValidationPass(evaluation)
    ? ("passed" as const)
    : ("failed" as const);
  const runId = `continuation_eval_run_${randomBytes(16).toString("hex")}`;
  const errors = evaluation.cases
    .filter(
      (item): item is Extract<typeof item, { measurementStatus: "measured" }> =>
        item.measurementStatus === "measured"
    )
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: item.task === "contract_oracle"
        ? "CONTINUATION_EXACT_ORACLE_MISMATCH" as const
        : item.task === "resolver_behavior"
          ? "CONTINUATION_RESOLVER_BEHAVIOR_MISMATCH" as const
          : "CONTINUATION_BOARD_BEHAVIOR_MISMATCH" as const
    }));
  const content = {
    contract: CONTINUATION_EVALUATION_RUN_RECORD_CONTRACT,
    evaluationPolicyVersion: CONTINUATION_EVALUATION_POLICY_VERSION,
    runId,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    latencyMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    dataset: {
      contract: CONTINUATION_EVALUATION_DATASET_CONTRACT,
      version: dataset.datasetVersion,
      revision: dataset.datasetRevision,
      datasetClass: dataset.datasetClass,
      split: dataset.split,
      lifecycleState: dataset.lifecycle.state,
      datasetSha256: null,
      immutableRef: null,
      frozenAt: null,
      candidatePayloadSha256: continuationEvaluationDatasetCandidateSha256(dataset),
      materializedInputSha256: evaluation.materializedInputSha256,
      containsProductionData: false as const
    },
    config: {
      version: continuationEvaluationConfig.version,
      lifecycleState: continuationEvaluationConfig.lifecycle.state,
      configSha256: null,
      immutableRef: null,
      candidatePayloadSha256: CONTINUATION_EVALUATION_CONFIG_CANDIDATE_SHA256
    },
    versions,
    code,
    counts: evaluation.counts,
    metrics: evaluation.metrics,
    runtime: {
      provider: "not_applicable" as const,
      model: "not_applicable" as const,
      promptVersion: "not_applicable" as const,
      judgeProvider: "not_applicable" as const,
      judgeModel: "not_applicable" as const,
      judgePromptVersion: "not_applicable" as const,
      tokenUsage: null,
      concurrency: 1 as const,
      retryCount: 0 as const
    },
    cases: evaluation.cases,
    deterministicOutputSha256,
    errors,
    comparison: {
      baselineRunId: null,
      comparisonRunId: null,
      sameFrozenInputComparison: null,
      improvementClaimed: false as const
    },
    review: {
      automaticReviewStatus: status,
      humanReviewStatus: "not_started" as const,
      qualityClaim: "contract_and_resolver_regression_only" as const
    },
    release: {
      releaseGateApplicable: false as const,
      decision: "deferred" as const,
      frozenDatasetEligible: false as const,
      resolverReleaseEligible: false as const,
      humanReviewRequired: true as const
    },
    privacy: {
      classification: "bounded_synthetic" as const,
      productionDataUsed: false as const,
      rawFixturePayloadStored: false as const,
      rawPrivacySentinelStored: false as const,
      remoteTelemetryAdded: false as const,
      retention: "private_local_evaluation_artifact" as const
    },
    limitations: [
      "Mutable synthetic Dev Candidate only; datasetSha256, configSha256, immutable references, frozenAt, baseline comparison, and human review remain absent.",
      "Twelve contract-oracle, nine authenticated resolver-behavior, and one authenticated Board-behavior row execute; no row remains deferred.",
      "Acceptable@1, Acceptable@3, setup-route accuracy, runtime quality, release eligibility, and production generalization are not measured by this regression checkpoint."
    ]
  };
  const record = {
    ...content,
    artifact: {
      relativePath: `.local/evaluations/continuation/${runId}.json`,
      hashAlgorithm: "sha256" as const,
      hashScope: "canonical_record_payload_excluding_artifact_descriptor" as const,
      canonicalPayloadSha256:
        continuationEvaluationArtifactPayloadSha256(content)
    }
  };
  return continuationEvaluationRunRecordSchema.parse(record);
}

export async function runAndStoreContinuationEvaluation(
  input: {
    cwd: string;
    dataRoot: string;
    env?: NodeJS.ProcessEnv;
    startedAt?: Date;
    completedAt?: Date;
    dataset?: ContinuationEvaluationDataset;
  },
  dependencies: {
    resolveCodeProvenance?: typeof resolveAttentionCodeProvenance;
    writeArtifact?: typeof writePrivateEvaluationArtifact;
  } = {}
): Promise<{
  record: ContinuationEvaluationRunRecord;
  storedArtifact: Awaited<ReturnType<typeof writePrivateEvaluationArtifact>>;
}> {
  const resolveCode = dependencies.resolveCodeProvenance ?? resolveAttentionCodeProvenance;
  const writeArtifact = dependencies.writeArtifact ?? writePrivateEvaluationArtifact;
  const code = await resolveCode(input.cwd, input.env ?? process.env);
  const record = runContinuationEvaluation({
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    code,
    dataset: input.dataset
  });
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  const expectedSerializedSha256 = createHash("sha256")
    .update(contents)
    .digest("hex");
  const storedArtifact = await writeArtifact({
    dataRoot: input.dataRoot,
    relativePath: record.artifact.relativePath,
    contents,
    expectedSha256: expectedSerializedSha256
  });
  if (
    storedArtifact.relativePath !== record.artifact.relativePath ||
    storedArtifact.sha256 !== expectedSerializedSha256 ||
    storedArtifact.byteLength !== Buffer.byteLength(contents) ||
    storedArtifact.mode !== 0o600
  ) {
    throw new TypeError("Stored Continuation evaluation artifact receipt is contradictory.");
  }
  return { record, storedArtifact };
}

export function continuationEvaluationVersions() {
  return {
    evaluationRunContract: CONTINUATION_EVALUATION_RUN_RECORD_CONTRACT,
    evaluationPolicyVersion: CONTINUATION_EVALUATION_POLICY_VERSION,
    datasetContract: CONTINUATION_EVALUATION_DATASET_CONTRACT,
    datasetSchemaVersion: CONTINUATION_EVALUATION_CASE_SCHEMA_VERSION,
    configVersion: continuationEvaluationConfig.version,
    continuationCandidateContract: CONTINUATION_CANDIDATE_CONTRACT,
    continuationCandidateSchemaVersion: CONTINUATION_CANDIDATE_SCHEMA_VERSION,
    continuationGitHubSourceSchemaVersion: CONTINUATION_GITHUB_SOURCE_SCHEMA_VERSION,
    continuationCodexSourceSchemaVersion: CONTINUATION_CODEX_SOURCE_SCHEMA_VERSION,
    continuationGitHubAdapterVersion: CONTINUATION_GITHUB_ADAPTER_VERSION,
    continuationCodexAdapterVersion: CONTINUATION_CODEX_ADAPTER_VERSION,
    continuationSourceAdapterBatchContract: "continuation-source-adapter-batch-v0.4" as const,
    continuationSourceAdapterBatchSchemaVersion: "continuation-source-adapter-batch-schema-v0.4" as const,
    continuationIdentityInputContract: CONTINUATION_IDENTITY_INPUT_CONTRACT,
    continuationIdentityResultContract: CONTINUATION_IDENTITY_RESULT_CONTRACT,
    continuationIdentitySchemaVersion: CONTINUATION_IDENTITY_SCHEMA_VERSION,
    continuationCandidateDerivationEnvelopeContract: CONTINUATION_CANDIDATE_DERIVATION_ENVELOPE_CONTRACT,
    continuationCandidateDerivationResultContract: CONTINUATION_CANDIDATE_DERIVATION_RESULT_CONTRACT,
    continuationCandidateDerivationSchemaVersion: CONTINUATION_CANDIDATE_DERIVATION_SCHEMA_VERSION,
    continuationCandidateRuleVersion: CONTINUATION_RULE_VERSION,
    continuationCandidateDerivationConfigVersion: "continuation-candidate-derivation-config-v0.2" as const,
    continuationScoringResultContract: CONTINUATION_SCORING_RESULT_CONTRACT,
    continuationScoringSchemaVersion: CONTINUATION_SCORING_SCHEMA_VERSION,
    continuationScoringPolicyVersion: CONTINUATION_SCORING_POLICY_VERSION,
    continuationResolutionEnvelopeContract: CONTINUATION_RESOLUTION_ENVELOPE_CONTRACT,
    continuationResolutionSchemaVersion: CONTINUATION_RESOLUTION_SCHEMA_VERSION,
    continuationResolutionConfigVersion: "continuation-resolution-config-v0.1" as const,
    continuationResolvedDecisionContract: CONTINUATION_RESOLVED_DECISION_CONTRACT,
    continuationResolvedDecisionSchemaVersion: CONTINUATION_RESOLVED_DECISION_SCHEMA_VERSION,
    continuationBaseDecisionContract: CONTINUATION_DECISION_CONTRACT,
    continuationBaseDecisionSchemaVersion: CONTINUATION_DECISION_SCHEMA_VERSION,
    continuationBaseDecisionRole: "nested_not_authenticity_marker" as const,
    continuationResolverVersion: CONTINUATION_RESOLVER_VERSION,
    workSuggestionBoardInputContract: WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
    workSuggestionBoardResultContract: WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
    workSuggestionBoardSchemaVersion: WORK_SUGGESTION_BOARD_SCHEMA_VERSION,
    workSuggestionBoardComposerVersion: WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
    activeAttentionResultContract: ACTIVE_ATTENTION_RESULT_CONTRACT,
    activeAttentionPolicyVersion: ACTIVE_ATTENTION_POLICY_VERSION,
    activeAttentionResolverVersion: ACTIVE_ATTENTION_RESOLVER_VERSION,
    continuationSemanticHashApi: "continuationDecisionSemanticSha256" as const,
    boardSemanticHashApi: "workSuggestionBoardResultSemanticSha256" as const
  };
}

function contractScaffoldValidationPass(
  evaluation: ReturnType<typeof evaluateContinuationDataset>
): boolean {
  return (
    evaluation.counts.exactOraclePassCount === 12 &&
    evaluation.counts.exactOracleFailureCount === 0 &&
    evaluation.counts.resolverBehaviorPassCount === 9 &&
    evaluation.counts.resolverBehaviorFailureCount === 0 &&
    evaluation.counts.boardBehaviorCaseCount === 1 &&
    evaluation.counts.notEvaluatedCaseCount === 0 &&
    evaluation.counts.passCount === 22 &&
    Object.values(evaluation.metrics.criticalErrors).every((count) => count === 0)
  );
}

export const CONTINUATION_EVALUATION_DEFAULT_DATASET_CANDIDATE_SHA256 =
  CONTINUATION_EVALUATION_DATASET_CANDIDATE_SHA256;
