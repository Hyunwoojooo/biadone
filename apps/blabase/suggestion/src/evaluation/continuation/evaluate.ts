import { buildContinuationEvaluationFixture } from "../../../eval/synthetic/continuationCaseBuilder";
import { sha256Canonical } from "../crossSourceIntegrity";
import {
  continuationEvaluationCriticalErrorCounts,
  continuationEvaluationMaterializedInputSha256,
  continuationEvaluationSummarySha256,
  continuationContractOracleSummarySchema,
  continuationEvaluationCaseResultSchema,
  continuationEvaluationMetricsSchema,
  type ContinuationContractOracleSummary,
  type ContinuationDeferredEvaluationCase,
  type ContinuationEvaluationCase,
  type ContinuationEvaluationCaseResult,
  type ContinuationEvaluationDataset,
  type ContinuationEvaluationMetrics,
  type ContinuationExecutableEvaluationCase
} from "./contracts";

export type ContinuationDatasetEvaluation = {
  cases: ContinuationEvaluationCaseResult[];
  counts: {
    totalCaseCount: 22;
    executableCaseCount: 12;
    exactOraclePassCount: number;
    exactOracleFailureCount: number;
    deferredCaseCount: 10;
    notEvaluatedCaseCount: 10;
    passCount: number;
  };
  metrics: ContinuationEvaluationMetrics;
  materializedInputSha256: string;
};

export type ContinuationEvaluationDependencies = {
  buildFixture?: typeof buildContinuationEvaluationFixture;
};

export function evaluateContinuationDataset(
  dataset: ContinuationEvaluationDataset,
  dependencies: ContinuationEvaluationDependencies = {}
): ContinuationDatasetEvaluation {
  const cases = dataset.cases.map((item) =>
    evaluateContinuationCase(item, dependencies)
  );
  const measured = cases.filter(
    (item): item is Extract<ContinuationEvaluationCaseResult, { measurementStatus: "measured" }> =>
      item.measurementStatus === "measured"
  );
  const deferred = cases.filter((item) => item.measurementStatus === "not_evaluated");
  const exactOraclePassCount = measured.filter((item) => item.passed).length;
  const criticalErrors = continuationEvaluationCriticalErrorCounts(cases);
  const counts = {
    totalCaseCount: 22 as const,
    executableCaseCount: 12 as const,
    exactOraclePassCount,
    exactOracleFailureCount: 12 - exactOraclePassCount,
    deferredCaseCount: 10 as const,
    notEvaluatedCaseCount: 10 as const,
    passCount: exactOraclePassCount
  };
  const metrics = continuationEvaluationMetricsSchema.parse({
    exactOraclePassRate: exactOraclePassCount / 12,
    acceptableAt1: null,
    acceptableAt3: null,
    setupRouteAccuracy: null,
    setupRuntimeQuality: null,
    releaseGateApplicable: false,
    criticalErrors
  });
  return {
    cases,
    counts,
    metrics,
    materializedInputSha256:
      continuationEvaluationMaterializedInputSha256(cases)
  };
}

export function evaluateContinuationCase(
  evaluationCase: ContinuationEvaluationCase,
  dependencies: ContinuationEvaluationDependencies = {}
): ContinuationEvaluationCaseResult {
  return evaluationCase.task === "contract_oracle"
    ? evaluateExecutableCase(evaluationCase, dependencies)
    : evaluateDeferredCase(evaluationCase);
}

function evaluateExecutableCase(
  evaluationCase: ContinuationExecutableEvaluationCase,
  dependencies: ContinuationEvaluationDependencies
): ContinuationEvaluationCaseResult {
  const buildFixture = dependencies.buildFixture ?? buildContinuationEvaluationFixture;
  let materializedInputSha256: string | null = null;
  let actual = failedOracleSummary();
  let replay = failedOracleSummary();
  let deterministicReplayMatched = false;
  let errorCode:
    | "CASE_FIXTURE_MATERIALIZATION_FAILED"
    | "CASE_EXECUTION_FAILED"
    | null = null;
  let stage: "materialize" | "execute" = "materialize";
  try {
    const first = buildFixture(evaluationCase.scenario);
    const second = buildFixture(evaluationCase.scenario);
    if (
      first.scenario !== evaluationCase.scenario ||
      second.scenario !== evaluationCase.scenario
    ) {
      throw new TypeError("Synthetic fixture scenario does not match its evaluation case.");
    }
    const firstInputSha256 = sha256Canonical(first.materializedInput);
    const secondInputSha256 = sha256Canonical(second.materializedInput);
    materializedInputSha256 = firstInputSha256;
    stage = "execute";
    actual = continuationContractOracleSummarySchema.parse(first.execute());
    replay = continuationContractOracleSummarySchema.parse(second.execute());
    deterministicReplayMatched =
      firstInputSha256 === secondInputSha256 &&
      sha256Canonical(actual) === sha256Canonical(replay);
  } catch {
    errorCode =
      stage === "materialize"
        ? "CASE_FIXTURE_MATERIALIZATION_FAILED"
        : "CASE_EXECUTION_FAILED";
    if (stage === "materialize") materializedInputSha256 = null;
    actual = failedOracleSummary();
    replay = failedOracleSummary();
  }
  if (errorCode === null && !deterministicReplayMatched) {
    actual = continuationContractOracleSummarySchema.parse({
      ...actual,
      oracleCode: "CONTRACT_ORACLE_FAILED",
      criticalErrorCodes: [
        ...new Set([
          ...actual.criticalErrorCodes,
          "DETERMINISTIC_REPLAY_MISMATCH" as const
        ])
      ].sort()
    });
  }
  const expectedSummarySha256 = continuationEvaluationSummarySha256(
    evaluationCase.expected
  );
  const actualSummarySha256 = continuationEvaluationSummarySha256(actual);
  const passed =
    errorCode === null &&
    deterministicReplayMatched &&
    expectedSummarySha256 === actualSummarySha256 &&
    actual.criticalErrorCodes.length === 0;
  const parsedResult = continuationEvaluationCaseResultSchema.safeParse({
    caseId: evaluationCase.caseId,
    task: evaluationCase.task,
    evaluationStage: evaluationCase.evaluationStage,
    scenario: evaluationCase.scenario,
    labels: [...evaluationCase.labels],
    measurementStatus: "measured",
    outcome: passed ? "measured_pass" : "measured_fail",
    passed,
    blockedByTask: null,
    forbiddenInvariants: [],
    materializedInputSha256,
    expectedSummarySha256,
    actualSummarySha256,
    deterministicReplayMatched,
    expected: evaluationCase.expected,
    actual,
    errorCode
  });
  if (parsedResult.success) return parsedResult.data;

  const isolatedFailure = failedOracleSummary();
  const isolatedFailureResult: ContinuationEvaluationCaseResult = {
    caseId: evaluationCase.caseId,
    task: evaluationCase.task,
    evaluationStage: evaluationCase.evaluationStage,
    scenario: evaluationCase.scenario,
    labels: [...evaluationCase.labels],
    measurementStatus: "measured",
    outcome: "measured_fail",
    passed: false,
    blockedByTask: null,
    forbiddenInvariants: [],
    materializedInputSha256,
    expectedSummarySha256,
    actualSummarySha256: continuationEvaluationSummarySha256(isolatedFailure),
    deterministicReplayMatched: false,
    expected: evaluationCase.expected,
    actual: isolatedFailure,
    errorCode:
      materializedInputSha256 === null
        ? "CASE_FIXTURE_MATERIALIZATION_FAILED"
        : "CASE_EXECUTION_FAILED"
  };
  const parsedIsolatedFailure =
    continuationEvaluationCaseResultSchema.safeParse(isolatedFailureResult);
  return parsedIsolatedFailure.success
    ? parsedIsolatedFailure.data
    : isolatedFailureResult;
}

function evaluateDeferredCase(
  evaluationCase: ContinuationDeferredEvaluationCase
): ContinuationEvaluationCaseResult {
  const expectedSummary = {
    measurementStatus: evaluationCase.expected.measurementStatus,
    oracleCode: evaluationCase.expected.oracleCode,
    blockedByTask: evaluationCase.expected.blockedByTask,
    forbiddenInvariants: evaluationCase.expected.forbiddenInvariants
  };
  return continuationEvaluationCaseResultSchema.parse({
    caseId: evaluationCase.caseId,
    task: evaluationCase.task,
    evaluationStage: evaluationCase.evaluationStage,
    scenario: evaluationCase.scenario,
    labels: [...evaluationCase.labels],
    measurementStatus: "not_evaluated",
    outcome: "not_evaluated",
    passed: null,
    blockedByTask: evaluationCase.expected.blockedByTask,
    forbiddenInvariants: [...evaluationCase.expected.forbiddenInvariants],
    materializedInputSha256: null,
    expectedSummarySha256:
      continuationEvaluationSummarySha256(expectedSummary),
    actualSummarySha256: null,
    deterministicReplayMatched: null,
    expectedOracleCode: evaluationCase.expected.oracleCode,
    actualOracleCode: null,
    errorCode: null
  });
}

function failedOracleSummary(): ContinuationContractOracleSummary {
  return continuationContractOracleSummarySchema.parse({
    oracleCode: "CONTRACT_ORACLE_FAILED",
    contractOutcome: "rejected",
    decisionStatus: null,
    prominentLane: null,
    invariantCodes: [],
    criticalErrorCodes: ["CONTRACT_INTEGRITY_FAILURE"]
  });
}
