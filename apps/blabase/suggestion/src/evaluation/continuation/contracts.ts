import { z } from "zod";

import {
  ACTIVE_ATTENTION_POLICY_VERSION,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT,
  CONTINUATION_CANDIDATE_CONTRACT,
  CONTINUATION_CANDIDATE_SCHEMA_VERSION,
  CONTINUATION_DECISION_CONTRACT,
  CONTINUATION_DECISION_SCHEMA_VERSION,
  CONTINUATION_RESOLVER_VERSION,
  WORK_SUGGESTION_BOARD_COMPOSER_VERSION,
  WORK_SUGGESTION_BOARD_INPUT_CONTRACT,
  WORK_SUGGESTION_BOARD_RESULT_CONTRACT,
  WORK_SUGGESTION_BOARD_SCHEMA_VERSION
} from "../../crossSource/versions";
import { sha256Canonical } from "../crossSourceIntegrity";

export const CONTINUATION_EVALUATION_DATASET_CONTRACT =
  "continuation-evaluation-dataset-v0.1" as const;
export const CONTINUATION_EVALUATION_CASE_SCHEMA_VERSION =
  "continuation-evaluation-case-v0.1" as const;
export const CONTINUATION_EVALUATION_CONFIG_VERSION =
  "continuation-evaluation-config-v0.1" as const;
export const CONTINUATION_EVALUATION_RUN_RECORD_CONTRACT =
  "continuation-evaluation-run-v0.1" as const;
export const CONTINUATION_EVALUATION_POLICY_VERSION =
  "continuation-contract-scaffold-evaluation-v0.1" as const;

export const CONTINUATION_EXECUTABLE_CASE_IDS = [
  "E1-CT-001",
  "E1-CT-002",
  "E1-CT-003",
  "E1-CT-004",
  "E1-CT-005",
  "E1-CT-006",
  "E1-BD-001",
  "E1-BD-002",
  "E1-BD-003",
  "E1-BD-004",
  "E1-BD-005",
  "E1-HS-001"
] as const;

export const CONTINUATION_DEFERRED_CASE_IDS = [
  "E1-RV-GH-001",
  "E1-RV-GH-002",
  "E1-RV-CX-001",
  "E1-RV-CX-002",
  "E1-RV-FR-001",
  "E1-RV-FR-002",
  "E1-RV-PC-001",
  "E1-RV-ID-001",
  "E1-RV-TM-001",
  "E1-RV-DT-001"
] as const;

export const CONTINUATION_EVALUATION_CASE_IDS = [
  ...CONTINUATION_EXECUTABLE_CASE_IDS,
  ...CONTINUATION_DEFERRED_CASE_IDS
] as const;

export const CONTINUATION_EXECUTABLE_SCENARIOS = [
  "continuation_ready",
  "continuation_setup",
  "continuation_empty",
  "continuation_tamper",
  "future_capability_block",
  "public_privacy_rejection",
  "board_attention_precedence",
  "board_continuation_fallback",
  "board_setup_fallback",
  "board_empty",
  "board_mixed_version",
  "semantic_hash_runtime_metadata"
] as const;

export const CONTINUATION_DEFERRED_SCENARIOS = [
  "resolver_github_recent",
  "resolver_github_stale",
  "resolver_codex_metadata",
  "resolver_codex_terminal",
  "resolver_future_activity",
  "resolver_partial_coverage",
  "resolver_privacy_boundary",
  "resolver_identity_conflict",
  "resolver_tie_determinism",
  "resolver_cross_lane_dedupe"
] as const;

export const CONTINUATION_EVALUATION_STAGES = [
  "contract_scaffold",
  "resolver_behavior"
] as const;

export const CONTINUATION_EVALUATION_CASE_BINDINGS = {
  "E1-CT-001": { task: "contract_oracle", scenario: "continuation_ready", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-CT-002": { task: "contract_oracle", scenario: "continuation_setup", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-CT-003": { task: "contract_oracle", scenario: "continuation_empty", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-CT-004": { task: "contract_oracle", scenario: "continuation_tamper", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-CT-005": { task: "contract_oracle", scenario: "future_capability_block", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-CT-006": { task: "contract_oracle", scenario: "public_privacy_rejection", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-BD-001": { task: "contract_oracle", scenario: "board_attention_precedence", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-BD-002": { task: "contract_oracle", scenario: "board_continuation_fallback", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-BD-003": { task: "contract_oracle", scenario: "board_setup_fallback", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-BD-004": { task: "contract_oracle", scenario: "board_empty", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-BD-005": { task: "contract_oracle", scenario: "board_mixed_version", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-HS-001": { task: "contract_oracle", scenario: "semantic_hash_runtime_metadata", evaluationStage: "contract_scaffold", blockedByTask: null },
  "E1-RV-GH-001": { task: "resolver_behavior", scenario: "resolver_github_recent", evaluationStage: "resolver_behavior", blockedByTask: "R-002" },
  "E1-RV-GH-002": { task: "resolver_behavior", scenario: "resolver_github_stale", evaluationStage: "resolver_behavior", blockedByTask: "S-001" },
  "E1-RV-CX-001": { task: "resolver_behavior", scenario: "resolver_codex_metadata", evaluationStage: "resolver_behavior", blockedByTask: "R-002" },
  "E1-RV-CX-002": { task: "resolver_behavior", scenario: "resolver_codex_terminal", evaluationStage: "resolver_behavior", blockedByTask: "R-002" },
  "E1-RV-FR-001": { task: "resolver_behavior", scenario: "resolver_future_activity", evaluationStage: "resolver_behavior", blockedByTask: "S-001" },
  "E1-RV-FR-002": { task: "resolver_behavior", scenario: "resolver_partial_coverage", evaluationStage: "resolver_behavior", blockedByTask: "R-003" },
  "E1-RV-PC-001": { task: "resolver_behavior", scenario: "resolver_privacy_boundary", evaluationStage: "resolver_behavior", blockedByTask: "R-003" },
  "E1-RV-ID-001": { task: "resolver_behavior", scenario: "resolver_identity_conflict", evaluationStage: "resolver_behavior", blockedByTask: "R-001" },
  "E1-RV-TM-001": { task: "resolver_behavior", scenario: "resolver_tie_determinism", evaluationStage: "resolver_behavior", blockedByTask: "R-003" },
  "E1-RV-DT-001": { task: "resolver_behavior", scenario: "resolver_cross_lane_dedupe", evaluationStage: "resolver_behavior", blockedByTask: "B-001" }
} as const;

export const CONTINUATION_CONTRACT_ORACLE_CODES = [
  "CONTINUATION_READY_ACCEPTED",
  "CONTINUATION_SETUP_ACCEPTED",
  "CONTINUATION_EMPTY_ACCEPTED",
  "CONTINUATION_TAMPER_REJECTED",
  "CONTINUATION_FUTURE_CAPABILITY_REJECTED",
  "CONTINUATION_PRIVATE_IDENTIFIER_REJECTED",
  "BOARD_ATTENTION_PRECEDENCE_CONTRACT_ENFORCED",
  "BOARD_CONTINUATION_PRECEDENCE_CONTRACT_ENFORCED",
  "BOARD_SETUP_PRECEDENCE_CONTRACT_ENFORCED",
  "BOARD_EMPTY_PRECEDENCE_CONTRACT_ENFORCED",
  "BOARD_MIXED_VERSION_REJECTED",
  "SEMANTIC_HASH_VOLATILE_METADATA_ISOLATED"
] as const;

export const CONTINUATION_DEFERRED_ORACLE_CODES = [
  "RECENT_GITHUB_ACTIVITY_BOUNDED",
  "STALE_GITHUB_ACTIVITY_EXCLUDED",
  "CODEX_METADATA_ONLY_BOUNDED",
  "TERMINAL_CODEX_ACTIVITY_EXCLUDED",
  "FUTURE_ACTIVITY_REJECTED",
  "PARTIAL_COVERAGE_CAVEATED",
  "PRIVATE_VALUES_REMAIN_LOCAL",
  "IDENTITY_CONFLICT_EXCLUDED",
  "DETERMINISTIC_TIEBREAK_PRESERVED",
  "CROSS_LANE_DEDUPE_PRESERVES_ATTENTION"
] as const;

export const CONTINUATION_ORACLE_INVARIANT_CODES = [
  "ACTIVE_OBJECT_UNCHANGED",
  "ACTIVE_RESULT_HASH_UNCHANGED",
  "ARTIFACT_HASH_CHANGED",
  "ATTENTION_PRIMARY",
  "BOARD_SEMANTIC_HASH_STABLE",
  "CONTINUATION_INTEGRITY_VERIFIED",
  "CONTINUATION_PRIMARY",
  "CONTINUATION_SCHEMA_ACCEPTED",
  "CONTINUATION_SEMANTIC_HASH_STABLE",
  "EMPTY_BOARD",
  "EMPTY_DECISION_ACTIONLESS",
  "EXECUTION_POLICY_READ_ONLY",
  "FUTURE_CAPABILITY_BLOCKED",
  "HASH_HELPER_MATCHED",
  "MIXED_VERSION_REJECTED",
  "PRIVATE_IDENTIFIER_REJECTED",
  "SETUP_CAPABILITY_BOUNDED",
  "SETUP_PRIMARY",
  "TAMPER_REJECTED",
  "WRONG_LANE_MUTATION_REJECTED"
] as const;

export const CONTINUATION_CRITICAL_ERROR_CODES = [
  "ACTIVE_RESULT_DIFF",
  "ACTIVE_RESULT_HASH_DIFF",
  "AUTOMATIC_EXECUTION_OR_MUTATION",
  "CONTRACT_INTEGRITY_FAILURE",
  "DETERMINISTIC_REPLAY_MISMATCH",
  "PRIVACY_LEAK",
  "STALE_CURRENT_CLAIM",
  "UNSAFE_ACTION_TARGET",
  "WRONG_IDENTITY"
] as const;

export const CONTINUATION_FORBIDDEN_INVARIANTS = [
  "MUST_NOT_ADMIT_STALE_ACTIVITY",
  "MUST_NOT_ADMIT_TERMINAL_ACTIVITY",
  "MUST_NOT_AUTO_CONFIRM_IDENTITY",
  "MUST_NOT_AUTO_EXECUTE",
  "MUST_NOT_CHANGE_ACTIVE_ATTENTION",
  "MUST_NOT_CLAIM_COMPLETION",
  "MUST_NOT_CLAIM_URGENCY",
  "MUST_NOT_DEDUPE_CONFLICT_AS_MATCH",
  "MUST_NOT_EXPOSE_PRIVATE_IDENTIFIERS",
  "MUST_NOT_USE_UNSTABLE_TIEBREAK"
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const labelSchema = z.string().regex(/^[a-z0-9_]+$/u);
const executableScenarioSchema = z.enum(CONTINUATION_EXECUTABLE_SCENARIOS);
const deferredScenarioSchema = z.enum(CONTINUATION_DEFERRED_SCENARIOS);
const contractOracleCodeSchema = z.enum(CONTINUATION_CONTRACT_ORACLE_CODES);
const deferredOracleCodeSchema = z.enum(CONTINUATION_DEFERRED_ORACLE_CODES);
const observedOracleCodeSchema = z.enum([
  ...CONTINUATION_CONTRACT_ORACLE_CODES,
  "CONTRACT_ORACLE_FAILED"
]);
const invariantCodeSchema = z.enum(CONTINUATION_ORACLE_INVARIANT_CODES);
const criticalErrorCodeSchema = z.enum(CONTINUATION_CRITICAL_ERROR_CODES);
const forbiddenInvariantSchema = z.enum(CONTINUATION_FORBIDDEN_INVARIANTS);
const blockedByTaskSchema = z.enum([
  "S-001",
  "R-001",
  "R-002",
  "R-003",
  "B-001",
  "X-001"
]);
const decisionStatusSchema = z
  .enum([
    "offers_available",
    "setup_required",
    "no_recent_context",
    "insufficient_evidence",
    "unavailable"
  ])
  .nullable();
const prominentLaneSchema = z
  .enum(["attention", "continuation", "setup", "none"])
  .nullable();

export const continuationContractOracleSummarySchema = z
  .object({
    oracleCode: observedOracleCodeSchema,
    contractOutcome: z.enum(["accepted", "rejected"]),
    decisionStatus: decisionStatusSchema,
    prominentLane: prominentLaneSchema,
    invariantCodes: z.array(invariantCodeSchema).max(24),
    criticalErrorCodes: z.array(criticalErrorCodeSchema).max(12)
  })
  .strict()
  .superRefine((value, context) => {
    refineCanonical(value.invariantCodes, context, ["invariantCodes"]);
    refineCanonical(value.criticalErrorCodes, context, ["criticalErrorCodes"]);
  });

const executableCaseSchema = z
  .object({
    caseId: z.enum(CONTINUATION_EXECUTABLE_CASE_IDS),
    task: z.literal("contract_oracle"),
    evaluationStage: z.literal("contract_scaffold"),
    title: z.string().trim().min(1).max(180),
    scenario: executableScenarioSchema,
    expected: continuationContractOracleSummarySchema,
    labels: z.array(labelSchema).min(1).max(12)
  })
  .strict();

const deferredCaseSchema = z
  .object({
    caseId: z.enum(CONTINUATION_DEFERRED_CASE_IDS),
    task: z.literal("resolver_behavior"),
    evaluationStage: z.literal("resolver_behavior"),
    title: z.string().trim().min(1).max(180),
    scenario: deferredScenarioSchema,
    expected: z
      .object({
        measurementStatus: z.literal("not_evaluated"),
        oracleCode: deferredOracleCodeSchema,
        blockedByTask: blockedByTaskSchema,
        forbiddenInvariants: z.array(forbiddenInvariantSchema).min(1).max(10)
      })
      .strict(),
    labels: z.array(labelSchema).min(1).max(12)
  })
  .strict();

export const continuationEvaluationConfigSchema = z
  .object({
    version: z.literal(CONTINUATION_EVALUATION_CONFIG_VERSION),
    purpose: z.literal("contract_scaffold_validation"),
    taskBoundary: z.literal("contract_scaffold_validation"),
    lifecycle: z
      .object({
        state: z.literal("mutable"),
        configSha256: z.null(),
        immutableRef: z.null(),
        frozenAt: z.null()
      })
      .strict(),
    matrix: z
      .object({
        executableContractOracleCaseCount: z.literal(12),
        deferredResolverBehaviorCaseCount: z.literal(10),
        deferredRowsPassCounted: z.literal(false)
      })
      .strict(),
    oracle: z
      .object({
        exactSummaryMatchRequired: z.literal(true),
        deterministicReplayRequired: z.literal(true),
        semanticHashRuntimeMetadataIndependent: z.literal(true),
        activeAttentionExactPreservationRequired: z.literal(true)
      })
      .strict(),
    quality: z
      .object({
        acceptableAt1: z.null(),
        acceptableAt3: z.null(),
        setupRouteAccuracy: z.null(),
        setupRuntimeQuality: z.null()
      })
      .strict(),
    release: z
      .object({
        releaseGateApplicable: z.literal(false),
        decision: z.literal("deferred"),
        humanReviewStatus: z.literal("not_started")
      })
      .strict(),
    privacy: z
      .object({
        containsProductionData: z.literal(false),
        syntheticFixturesOnly: z.literal(true),
        storeRawFixturePayloads: z.literal(false),
        storeRawPrivacySentinels: z.literal(false),
        remoteTelemetryAllowed: z.literal(false)
      })
      .strict(),
    recordkeeping: z
      .object({
        candidatePayloadHashRequired: z.literal(true),
        materializedInputHashRequired: z.literal(true),
        configCandidateHashRequired: z.literal(true),
        codeProvenanceRequired: z.literal(true),
        privateArtifactRequired: z.literal(true)
      })
      .strict()
  })
  .strict();

export const continuationEvaluationDatasetSchema = z
  .object({
    contract: z.literal(CONTINUATION_EVALUATION_DATASET_CONTRACT),
    schemaVersion: z.literal(CONTINUATION_EVALUATION_CASE_SCHEMA_VERSION),
    datasetVersion: z.literal("suggestion-continuation-dev-v0.1"),
    datasetRevision: z.literal(1),
    datasetClass: z.literal("dev_candidate"),
    split: z.literal("development"),
    taskBoundary: z.literal("contract_scaffold_validation"),
    dataOrigin: z.literal("bounded_synthetic"),
    containsProductionData: z.literal(false),
    createdAt: z.string().datetime(),
    lifecycle: z
      .object({
        state: z.literal("mutable"),
        datasetSha256: z.null(),
        immutableRef: z.null(),
        frozenAt: z.null()
      })
      .strict(),
    evaluatorConfig: z
      .object({
        candidateRef: z.literal(
          "eval/synthetic/continuationEvaluationConfig.v0.1.json"
        ),
        version: z.literal(CONTINUATION_EVALUATION_CONFIG_VERSION)
      })
      .strict(),
    cases: z
      .array(z.discriminatedUnion("task", [executableCaseSchema, deferredCaseSchema]))
      .length(22)
  })
  .strict()
  .superRefine((dataset, context) => {
    const ids = dataset.cases.map((item) => item.caseId);
    const scenarios = dataset.cases.map((item) => item.scenario);
    if (ids.join("|") !== CONTINUATION_EVALUATION_CASE_IDS.join("|")) {
      addIssue(context, ["cases"], "Continuation cases must preserve canonical E-001 order.");
    }
    if (new Set(ids).size !== ids.length || new Set(scenarios).size !== scenarios.length) {
      addIssue(context, ["cases"], "Continuation case IDs and scenarios must be unique.");
    }
    refineSafely(context, ["cases"], () => {
      for (const [index, item] of dataset.cases.entries()) {
        refineCanonical(item.labels, context, ["cases", index, "labels"]);
        refineCaseBinding(
          item,
          item.task === "contract_oracle" ? null : item.expected.blockedByTask,
          context,
          ["cases", index]
        );
        if (item.task === "contract_oracle") {
          if (
            item.expected.oracleCode === "CONTRACT_ORACLE_FAILED" ||
            item.expected.criticalErrorCodes.length !== 0
          ) {
            addIssue(context, ["cases", index, "expected"], "Executable oracle labels must expect zero critical errors.");
          }
        } else {
          refineCanonical(
            item.expected.forbiddenInvariants,
            context,
            ["cases", index, "expected", "forbiddenInvariants"]
          );
        }
      }
    });
  });

const measuredCaseResultObjectSchema = z
  .object({
    caseId: z.enum(CONTINUATION_EXECUTABLE_CASE_IDS),
    task: z.literal("contract_oracle"),
    evaluationStage: z.literal("contract_scaffold"),
    scenario: executableScenarioSchema,
    labels: z.array(labelSchema).min(1).max(12),
    measurementStatus: z.literal("measured"),
    outcome: z.enum(["measured_pass", "measured_fail"]),
    passed: z.boolean(),
    blockedByTask: z.null(),
    forbiddenInvariants: z.array(z.never()).length(0),
    materializedInputSha256: sha256Schema.nullable(),
    expectedSummarySha256: sha256Schema,
    actualSummarySha256: sha256Schema,
    deterministicReplayMatched: z.boolean(),
    expected: continuationContractOracleSummarySchema,
    actual: continuationContractOracleSummarySchema,
    errorCode: z
      .enum([
        "CASE_FIXTURE_MATERIALIZATION_FAILED",
        "CASE_EXECUTION_FAILED"
      ])
      .nullable()
  })
  .strict();

const measuredCaseResultSchema = measuredCaseResultObjectSchema.superRefine(
  (result, context) => {
    refineSafely(context, [], () => {
      refineCanonical(result.labels, context, ["labels"]);
      refineCaseBinding(result, null, context, []);
      const expectedSummarySha256 = continuationEvaluationSummarySha256(
        result.expected
      );
      const actualSummarySha256 = continuationEvaluationSummarySha256(
        result.actual
      );
      if (result.expectedSummarySha256 !== expectedSummarySha256) {
        addIssue(context, ["expectedSummarySha256"], "Expected summary hash is contradictory.");
      }
      if (result.actualSummarySha256 !== actualSummarySha256) {
        addIssue(context, ["actualSummarySha256"], "Actual summary hash is contradictory.");
      }
      const passFacts =
        result.deterministicReplayMatched &&
        result.errorCode === null &&
        result.expectedSummarySha256 === result.actualSummarySha256 &&
        result.actual.criticalErrorCodes.length === 0;
      if (
        result.passed !== passFacts ||
        (result.outcome === "measured_pass") !== passFacts
      ) {
        addIssue(context, ["passed"], "Measured outcome, replay, error, hash, and critical-error facts contradict each other.");
      }
      if (result.errorCode === null && result.materializedInputSha256 === null) {
        addIssue(context, ["materializedInputSha256"], "A completed measurement requires a materialized input hash.");
      }
      if (
        result.errorCode === "CASE_FIXTURE_MATERIALIZATION_FAILED" &&
        result.materializedInputSha256 !== null
      ) {
        addIssue(context, ["materializedInputSha256"], "A failed fixture cannot claim a materialized input hash.");
      }
      if (
        result.errorCode === "CASE_EXECUTION_FAILED" &&
        result.materializedInputSha256 === null
      ) {
        addIssue(context, ["materializedInputSha256"], "An execution failure must retain its materialized input hash.");
      }
    });
  }
);

const deferredCaseResultObjectSchema = z
  .object({
    caseId: z.enum(CONTINUATION_DEFERRED_CASE_IDS),
    task: z.literal("resolver_behavior"),
    evaluationStage: z.literal("resolver_behavior"),
    scenario: deferredScenarioSchema,
    labels: z.array(labelSchema).min(1).max(12),
    measurementStatus: z.literal("not_evaluated"),
    outcome: z.literal("not_evaluated"),
    passed: z.null(),
    blockedByTask: blockedByTaskSchema,
    forbiddenInvariants: z.array(forbiddenInvariantSchema).min(1).max(10),
    materializedInputSha256: z.null(),
    expectedSummarySha256: sha256Schema,
    actualSummarySha256: z.null(),
    deterministicReplayMatched: z.null(),
    expectedOracleCode: deferredOracleCodeSchema,
    actualOracleCode: z.null(),
    errorCode: z.null()
  })
  .strict();

const deferredCaseResultSchema = deferredCaseResultObjectSchema.superRefine(
  (result, context) => {
    refineSafely(context, [], () => {
      refineCanonical(result.labels, context, ["labels"]);
      refineCanonical(result.forbiddenInvariants, context, ["forbiddenInvariants"]);
      refineCaseBinding(result, result.blockedByTask, context, []);
      const expectedSummarySha256 = continuationEvaluationSummarySha256({
        measurementStatus: result.measurementStatus,
        oracleCode: result.expectedOracleCode,
        blockedByTask: result.blockedByTask,
        forbiddenInvariants: result.forbiddenInvariants
      });
      if (result.expectedSummarySha256 !== expectedSummarySha256) {
        addIssue(context, ["expectedSummarySha256"], "Deferred expected summary hash is contradictory.");
      }
    });
  }
);

export const continuationEvaluationCaseResultSchema = z.union(
  [measuredCaseResultSchema, deferredCaseResultSchema]
);

export const continuationEvaluationMetricsSchema = z
  .object({
    exactOraclePassRate: z.number().min(0).max(1),
    acceptableAt1: z.null(),
    acceptableAt3: z.null(),
    setupRouteAccuracy: z.null(),
    setupRuntimeQuality: z.null(),
    releaseGateApplicable: z.literal(false),
    criticalErrors: z
      .object({
        wrongIdentityCount: z.number().int().nonnegative(),
        staleCurrentClaimCount: z.number().int().nonnegative(),
        unsafeActionTargetCount: z.number().int().nonnegative(),
        automaticExecutionOrMutationCount: z.number().int().nonnegative(),
        privacyLeakCount: z.number().int().nonnegative(),
        activeResultDiffCount: z.number().int().nonnegative(),
        activeResultHashDiffCount: z.number().int().nonnegative(),
        deterministicReplayMismatchCount: z.number().int().nonnegative(),
        contractIntegrityFailureCount: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict();

const continuationEvaluationRunRecordObjectSchema = z
  .object({
    contract: z.literal(CONTINUATION_EVALUATION_RUN_RECORD_CONTRACT),
    evaluationPolicyVersion: z.literal(CONTINUATION_EVALUATION_POLICY_VERSION),
    runId: z.string().regex(/^continuation_eval_run_[a-f0-9]{32}$/u),
    status: z.enum(["passed", "failed"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    latencyMs: z.number().int().nonnegative(),
    dataset: z
      .object({
        contract: z.literal(CONTINUATION_EVALUATION_DATASET_CONTRACT),
        version: z.literal("suggestion-continuation-dev-v0.1"),
        revision: z.literal(1),
        datasetClass: z.literal("dev_candidate"),
        split: z.literal("development"),
        lifecycleState: z.literal("mutable"),
        datasetSha256: z.null(),
        immutableRef: z.null(),
        frozenAt: z.null(),
        candidatePayloadSha256: sha256Schema,
        materializedInputSha256: sha256Schema,
        containsProductionData: z.literal(false)
      })
      .strict(),
    config: z
      .object({
        version: z.literal(CONTINUATION_EVALUATION_CONFIG_VERSION),
        lifecycleState: z.literal("mutable"),
        configSha256: z.null(),
        immutableRef: z.null(),
        candidatePayloadSha256: sha256Schema
      })
      .strict(),
    versions: z
      .object({
        evaluationRunContract: z.literal(CONTINUATION_EVALUATION_RUN_RECORD_CONTRACT),
        evaluationPolicyVersion: z.literal(CONTINUATION_EVALUATION_POLICY_VERSION),
        datasetContract: z.literal(CONTINUATION_EVALUATION_DATASET_CONTRACT),
        datasetSchemaVersion: z.literal(CONTINUATION_EVALUATION_CASE_SCHEMA_VERSION),
        configVersion: z.literal(CONTINUATION_EVALUATION_CONFIG_VERSION),
        continuationCandidateContract: z.literal(CONTINUATION_CANDIDATE_CONTRACT),
        continuationCandidateSchemaVersion: z.literal(CONTINUATION_CANDIDATE_SCHEMA_VERSION),
        continuationDecisionContract: z.literal(CONTINUATION_DECISION_CONTRACT),
        continuationDecisionSchemaVersion: z.literal(CONTINUATION_DECISION_SCHEMA_VERSION),
        continuationResolverVersion: z.literal(CONTINUATION_RESOLVER_VERSION),
        workSuggestionBoardInputContract: z.literal(WORK_SUGGESTION_BOARD_INPUT_CONTRACT),
        workSuggestionBoardResultContract: z.literal(WORK_SUGGESTION_BOARD_RESULT_CONTRACT),
        workSuggestionBoardSchemaVersion: z.literal(WORK_SUGGESTION_BOARD_SCHEMA_VERSION),
        workSuggestionBoardComposerVersion: z.literal(WORK_SUGGESTION_BOARD_COMPOSER_VERSION),
        activeAttentionResultContract: z.literal(ACTIVE_ATTENTION_RESULT_CONTRACT),
        activeAttentionPolicyVersion: z.literal(ACTIVE_ATTENTION_POLICY_VERSION),
        activeAttentionResolverVersion: z.literal(ACTIVE_ATTENTION_RESOLVER_VERSION),
        continuationSemanticHashApi: z.literal("continuationDecisionSemanticSha256"),
        boardSemanticHashApi: z.literal("workSuggestionBoardResultSemanticSha256")
      })
      .strict(),
    code: z
      .object({
        codeCommitSha: z.string().regex(/^[a-f0-9]{40}$/u).nullable(),
        codeState: z.enum([
          "clean_commit",
          "declared_commit",
          "dirty_worktree",
          "unavailable"
        ]),
        codeFingerprintSha256: sha256Schema.nullable()
      })
      .strict(),
    counts: z
      .object({
        totalCaseCount: z.literal(22),
        executableCaseCount: z.literal(12),
        exactOraclePassCount: z.number().int().min(0).max(12),
        exactOracleFailureCount: z.number().int().min(0).max(12),
        deferredCaseCount: z.literal(10),
        notEvaluatedCaseCount: z.literal(10),
        passCount: z.number().int().min(0).max(12)
      })
      .strict(),
    metrics: continuationEvaluationMetricsSchema,
    runtime: z
      .object({
        provider: z.literal("not_applicable"),
        model: z.literal("not_applicable"),
        promptVersion: z.literal("not_applicable"),
        judgeProvider: z.literal("not_applicable"),
        judgeModel: z.literal("not_applicable"),
        judgePromptVersion: z.literal("not_applicable"),
        tokenUsage: z.null(),
        concurrency: z.literal(1),
        retryCount: z.literal(0)
      })
      .strict(),
    cases: z.array(continuationEvaluationCaseResultSchema).length(22),
    deterministicOutputSha256: sha256Schema,
    errors: z
      .array(
        z
          .object({
            caseId: z.enum(CONTINUATION_EXECUTABLE_CASE_IDS),
            code: z.literal("CONTINUATION_EXACT_ORACLE_MISMATCH")
          })
          .strict()
      )
      .max(12),
    comparison: z
      .object({
        baselineRunId: z.null(),
        comparisonRunId: z.null(),
        sameFrozenInputComparison: z.null(),
        improvementClaimed: z.literal(false)
      })
      .strict(),
    review: z
      .object({
        automaticReviewStatus: z.enum(["passed", "failed"]),
        humanReviewStatus: z.literal("not_started"),
        qualityClaim: z.literal("contract_scaffold_validation_only")
      })
      .strict(),
    release: z
      .object({
        releaseGateApplicable: z.literal(false),
        decision: z.literal("deferred"),
        frozenDatasetEligible: z.literal(false),
        resolverReleaseEligible: z.literal(false),
        humanReviewRequired: z.literal(true)
      })
      .strict(),
    privacy: z
      .object({
        classification: z.literal("bounded_synthetic"),
        productionDataUsed: z.literal(false),
        rawFixturePayloadStored: z.literal(false),
        rawPrivacySentinelStored: z.literal(false),
        remoteTelemetryAdded: z.literal(false),
        retention: z.literal("private_local_evaluation_artifact")
      })
      .strict(),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
    artifact: z
      .object({
        relativePath: z.string().regex(/^\.local\/evaluations\/continuation\/continuation_eval_run_[a-f0-9]{32}\.json$/u),
        hashAlgorithm: z.literal("sha256"),
        hashScope: z.literal("canonical_record_payload_excluding_artifact_descriptor"),
        canonicalPayloadSha256: sha256Schema
      })
      .strict()
  })
  .strict();

export const continuationEvaluationRunRecordSchema =
  continuationEvaluationRunRecordObjectSchema.superRefine((record, context) => {
    refineSafely(context, [], () => refineEvaluationRunRecord(record, context));
  });

export type ContinuationEvaluationConfig = z.infer<
  typeof continuationEvaluationConfigSchema
>;
export type ContinuationEvaluationDataset = z.infer<
  typeof continuationEvaluationDatasetSchema
>;
export type ContinuationEvaluationCase =
  ContinuationEvaluationDataset["cases"][number];
export type ContinuationExecutableEvaluationCase = Extract<
  ContinuationEvaluationCase,
  { task: "contract_oracle" }
>;
export type ContinuationDeferredEvaluationCase = Extract<
  ContinuationEvaluationCase,
  { task: "resolver_behavior" }
>;
export type ContinuationExecutableScenario =
  (typeof CONTINUATION_EXECUTABLE_SCENARIOS)[number];
export type ContinuationContractOracleCode =
  (typeof CONTINUATION_CONTRACT_ORACLE_CODES)[number];
export type ContinuationOracleInvariantCode =
  (typeof CONTINUATION_ORACLE_INVARIANT_CODES)[number];
export type ContinuationCriticalErrorCode =
  (typeof CONTINUATION_CRITICAL_ERROR_CODES)[number];
export type ContinuationContractOracleSummary = z.infer<
  typeof continuationContractOracleSummarySchema
>;
export type ContinuationEvaluationCaseResult = z.infer<
  typeof continuationEvaluationCaseResultSchema
>;
export type ContinuationEvaluationMetrics = z.infer<
  typeof continuationEvaluationMetricsSchema
>;
export type ContinuationEvaluationRunRecord = z.infer<
  typeof continuationEvaluationRunRecordSchema
>;

export function continuationEvaluationSummarySha256(value: unknown): string {
  return sha256Canonical({
    domain: "continuation-evaluation-oracle-summary-v0.1",
    value
  });
}

export function continuationEvaluationMaterializedInputSha256(
  cases: readonly ContinuationEvaluationCaseResult[]
): string {
  return sha256Canonical({
    domain: "continuation-evaluation-materialized-input-v0.1",
    cases: cases.map((item) => ({
      caseId: item.caseId,
      evaluationStage: item.evaluationStage,
      measurementStatus: item.measurementStatus,
      materializedInputSha256: item.materializedInputSha256
    }))
  });
}

export function continuationEvaluationDeterministicOutputSha256(input: {
  datasetCandidatePayloadSha256: string;
  configCandidatePayloadSha256: string;
  materializedInputSha256: string;
  versions: unknown;
  counts: unknown;
  metrics: unknown;
  cases: readonly ContinuationEvaluationCaseResult[];
}): string {
  return sha256Canonical({
    domain: "continuation-evaluation-deterministic-output-v0.1",
    datasetCandidatePayloadSha256: input.datasetCandidatePayloadSha256,
    configCandidatePayloadSha256: input.configCandidatePayloadSha256,
    materializedInputSha256: input.materializedInputSha256,
    versions: input.versions,
    counts: input.counts,
    metrics: input.metrics,
    cases: input.cases
  });
}

export function continuationEvaluationArtifactPayloadSha256(
  content: unknown
): string {
  return sha256Canonical(content);
}

export function continuationEvaluationCriticalErrorCounts(
  cases: readonly ContinuationEvaluationCaseResult[]
) {
  const codes = cases.flatMap((item) =>
    item.measurementStatus === "measured"
      ? item.actual.criticalErrorCodes
      : []
  );
  const count = (code: ContinuationCriticalErrorCode) =>
    codes.filter((value) => value === code).length;
  return {
    wrongIdentityCount: count("WRONG_IDENTITY"),
    staleCurrentClaimCount: count("STALE_CURRENT_CLAIM"),
    unsafeActionTargetCount: count("UNSAFE_ACTION_TARGET"),
    automaticExecutionOrMutationCount: count("AUTOMATIC_EXECUTION_OR_MUTATION"),
    privacyLeakCount: count("PRIVACY_LEAK"),
    activeResultDiffCount: count("ACTIVE_RESULT_DIFF"),
    activeResultHashDiffCount: count("ACTIVE_RESULT_HASH_DIFF"),
    deterministicReplayMismatchCount: count("DETERMINISTIC_REPLAY_MISMATCH"),
    contractIntegrityFailureCount: count("CONTRACT_INTEGRITY_FAILURE")
  };
}

function refineEvaluationRunRecord(
  record: z.infer<typeof continuationEvaluationRunRecordObjectSchema>,
  context: z.RefinementCtx
): void {
  const startedAt = Date.parse(record.startedAt);
  const completedAt = Date.parse(record.completedAt);
  if (completedAt < startedAt) {
    addIssue(context, ["completedAt"], "Evaluation completion precedes start.");
  }
  if (record.latencyMs !== Math.max(0, completedAt - startedAt)) {
    addIssue(context, ["latencyMs"], "Evaluation latency contradicts timestamps.");
  }

  const ids = record.cases.map((item) => item.caseId);
  if (ids.join("|") !== CONTINUATION_EVALUATION_CASE_IDS.join("|")) {
    addIssue(context, ["cases"], "Run rows must contain every canonical E-001 case exactly once and in order.");
  }
  for (const [index, item] of record.cases.entries()) {
    refineCaseBinding(item, item.blockedByTask, context, ["cases", index]);
  }

  const measured = record.cases.filter((item) => item.measurementStatus === "measured");
  const deferred = record.cases.filter((item) => item.measurementStatus === "not_evaluated");
  const passes = measured.filter((item) => item.passed).length;
  const expectedCounts = {
    totalCaseCount: 22,
    executableCaseCount: 12,
    exactOraclePassCount: passes,
    exactOracleFailureCount: 12 - passes,
    deferredCaseCount: 10,
    notEvaluatedCaseCount: deferred.length,
    passCount: passes
  };
  if (!canonicalEqual(record.counts, expectedCounts) || measured.length !== 12 || deferred.length !== 10) {
    addIssue(context, ["counts"], "Evaluation counts contradict canonical measured and deferred rows.");
  }

  const exactOraclePassRate = passes / 12;
  if (record.metrics.exactOraclePassRate !== exactOraclePassRate) {
    addIssue(context, ["metrics", "exactOraclePassRate"], "Exact oracle pass rate is contradictory.");
  }
  const criticalErrors = continuationEvaluationCriticalErrorCounts(record.cases);
  if (!canonicalEqual(record.metrics.criticalErrors, criticalErrors)) {
    addIssue(context, ["metrics", "criticalErrors"], "Critical-error aggregates are contradictory.");
  }

  const expectedErrors = measured
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: "CONTINUATION_EXACT_ORACLE_MISMATCH" as const
    }));
  if (!canonicalEqual(record.errors, expectedErrors)) {
    addIssue(context, ["errors"], "Top-level errors contradict failed measured rows.");
  }

  const materializedInputSha256 =
    continuationEvaluationMaterializedInputSha256(record.cases);
  if (record.dataset.materializedInputSha256 !== materializedInputSha256) {
    addIssue(context, ["dataset", "materializedInputSha256"], "Materialized aggregate hash is contradictory.");
  }
  const deterministicOutputSha256 =
    continuationEvaluationDeterministicOutputSha256({
      datasetCandidatePayloadSha256: record.dataset.candidatePayloadSha256,
      configCandidatePayloadSha256: record.config.candidatePayloadSha256,
      materializedInputSha256,
      versions: record.versions,
      counts: record.counts,
      metrics: record.metrics,
      cases: record.cases
    });
  if (record.deterministicOutputSha256 !== deterministicOutputSha256) {
    addIssue(context, ["deterministicOutputSha256"], "Deterministic output hash is contradictory.");
  }

  const expectedStatus =
    passes === 12 && Object.values(criticalErrors).every((count) => count === 0)
      ? "passed"
      : "failed";
  if (
    record.status !== expectedStatus ||
    record.review.automaticReviewStatus !== expectedStatus
  ) {
    addIssue(context, ["status"], "Run and automatic review status contradict evaluation facts.");
  }

  const { artifact, ...content } = record;
  if (
    artifact.relativePath !==
      `.local/evaluations/continuation/${record.runId}.json` ||
    artifact.canonicalPayloadSha256 !==
      continuationEvaluationArtifactPayloadSha256(content)
  ) {
    addIssue(context, ["artifact"], "Artifact descriptor or canonical payload hash is contradictory.");
  }
}

function refineCaseBinding(
  value: {
    caseId: (typeof CONTINUATION_EVALUATION_CASE_IDS)[number];
    task: "contract_oracle" | "resolver_behavior";
    scenario: string;
    evaluationStage: (typeof CONTINUATION_EVALUATION_STAGES)[number];
  },
  blockedByTask: string | null,
  context: z.RefinementCtx,
  path: Array<string | number>
): void {
  const binding = CONTINUATION_EVALUATION_CASE_BINDINGS[value.caseId];
  if (
    value.task !== binding.task ||
    value.scenario !== binding.scenario ||
    value.evaluationStage !== binding.evaluationStage ||
    blockedByTask !== binding.blockedByTask
  ) {
    addIssue(context, path, "Case ID, task, scenario, evaluation stage, and blocker must match the canonical E-001 binding.");
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return sha256Canonical(left) === sha256Canonical(right);
}

function refineSafely(
  context: z.RefinementCtx,
  path: Array<string | number>,
  action: () => void
): void {
  try {
    action();
  } catch {
    addIssue(context, path, "Evaluation integrity refinement failed closed.");
  }
}

function refineCanonical(
  values: readonly string[],
  context: z.RefinementCtx,
  path: Array<string | number>
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      addIssue(context, path, "Values must be canonical and unique.");
      return;
    }
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}
