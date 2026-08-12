import { describe, expect, it } from "vitest";

import { buildContinuationEvaluationFixture } from "../eval/synthetic/continuationCaseBuilder";
import {
  CONTINUATION_EVALUATION_CONFIG_CANDIDATE_SHA256,
  CONTINUATION_EVALUATION_DATASET_CANDIDATE_SHA256,
  CONTINUATION_EVALUATION_CASE_IDS,
  continuationEvaluationArtifactPayloadSha256,
  continuationEvaluationCaseResultSchema,
  continuationEvaluationConfig,
  continuationEvaluationDataset,
  continuationEvaluationDeterministicOutputSha256,
  continuationEvaluationRunRecordSchema,
  continuationEvaluationSummarySha256,
  evaluateContinuationDataset,
  loadContinuationEvaluationDataset,
  runAndStoreContinuationEvaluation,
  runContinuationEvaluation
} from "../src/evaluation/continuation";
import { sha256Canonical } from "../src/evaluation/crossSourceIntegrity";

const STARTED_AT = new Date("2026-08-12T03:00:00.000Z");
const COMPLETED_AT = new Date("2026-08-12T03:00:00.120Z");
const CODE = {
  codeCommitSha: null,
  codeState: "dirty_worktree" as const,
  codeFingerprintSha256: "a".repeat(64)
};

describe("E-001 Continuation contract-scaffold evaluation", () => {
  it("loads the exact mutable 12 executable plus 10 deferred matrix", () => {
    expect(continuationEvaluationDataset).toMatchObject({
      datasetVersion: "suggestion-continuation-dev-v0.1",
      datasetRevision: 1,
      datasetClass: "dev_candidate",
      dataOrigin: "bounded_synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      }
    });
    expect(continuationEvaluationDataset.cases.map((item) => item.caseId)).toEqual(
      CONTINUATION_EVALUATION_CASE_IDS
    );
    expect(
      continuationEvaluationDataset.cases.filter((item) => item.task === "contract_oracle")
    ).toHaveLength(12);
    expect(
      continuationEvaluationDataset.cases.filter((item) => item.task === "resolver_behavior")
    ).toHaveLength(10);
    expect(CONTINUATION_EVALUATION_DATASET_CANDIDATE_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(CONTINUATION_EVALUATION_CONFIG_CANDIDATE_SHA256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("passes all 12 exact contract oracles while never pass-counting deferred rows", () => {
    const record = evaluation();

    expect(continuationEvaluationRunRecordSchema.parse(record)).toEqual(record);
    expect(record.status).toBe("passed");
    expect(record.counts).toEqual({
      totalCaseCount: 22,
      executableCaseCount: 12,
      exactOraclePassCount: 12,
      exactOracleFailureCount: 0,
      deferredCaseCount: 10,
      notEvaluatedCaseCount: 10,
      passCount: 12
    });
    expect(record.metrics.exactOraclePassRate).toBe(1);
    expect(record.metrics.acceptableAt1).toBeNull();
    expect(record.metrics.acceptableAt3).toBeNull();
    expect(record.metrics.setupRouteAccuracy).toBeNull();
    expect(record.metrics.setupRuntimeQuality).toBeNull();
    expect(record.metrics.releaseGateApplicable).toBe(false);
    expect(Object.values(record.metrics.criticalErrors).every((count) => count === 0)).toBe(true);
    expect(
      record.cases
        .filter((item) => item.measurementStatus === "measured")
        .every(
          (item) =>
            item.outcome === "measured_pass" &&
            item.passed === true &&
            item.deterministicReplayMatched === true &&
            item.errorCode === null &&
            item.expectedSummarySha256 === item.actualSummarySha256 &&
            item.actual.criticalErrorCodes.length === 0
        )
    ).toBe(true);
    expect(record.review).toEqual({
      automaticReviewStatus: "passed",
      humanReviewStatus: "not_started",
      qualityClaim: "contract_scaffold_validation_only"
    });
    expect(record.release).toEqual({
      releaseGateApplicable: false,
      decision: "deferred",
      frozenDatasetEligible: false,
      resolverReleaseEligible: false,
      humanReviewRequired: true
    });
  });

  it("keeps every resolver row explicitly blocked and not evaluated", () => {
    const deferred = evaluation().cases.filter(
      (item) => item.measurementStatus === "not_evaluated"
    );

    expect(deferred).toHaveLength(10);
    expect(
      deferred.every(
        (item) =>
          item.task === "resolver_behavior" &&
          item.outcome === "not_evaluated" &&
          item.passed === null &&
          item.blockedByTask !== null &&
          item.forbiddenInvariants.length > 0 &&
          item.materializedInputSha256 === null &&
          item.actualSummarySha256 === null &&
          item.deterministicReplayMatched === null &&
          item.actualOracleCode === null &&
          item.errorCode === null
      )
    ).toBe(true);
  });

  it("limits Board claims to contract precedence and rejects wrong-lane mutations", () => {
    const boardCases = evaluation().cases.filter(
      (item) =>
        item.measurementStatus === "measured" &&
        ["E1-BD-001", "E1-BD-002", "E1-BD-003", "E1-BD-004"].includes(
          item.caseId
        )
    );

    expect(boardCases).toHaveLength(4);
    expect(
      boardCases.every(
        (item) =>
          item.measurementStatus === "measured" &&
          item.actual.oracleCode.includes("PRECEDENCE_CONTRACT_ENFORCED") &&
          item.actual.invariantCodes.includes("WRONG_LANE_MUTATION_REJECTED")
      )
    ).toBe(true);
  });

  it("proves volatile run metadata changes artifact hashes but not semantic hashes or Active", () => {
    const hashCase = evaluation().cases.find((item) => item.caseId === "E1-HS-001");
    expect(hashCase?.measurementStatus).toBe("measured");
    if (!hashCase || hashCase.measurementStatus !== "measured") {
      throw new TypeError("Missing semantic-hash contract oracle.");
    }
    expect(hashCase.passed).toBe(true);
    expect(hashCase.actual.invariantCodes).toEqual([
      "ACTIVE_OBJECT_UNCHANGED",
      "ACTIVE_RESULT_HASH_UNCHANGED",
      "ARTIFACT_HASH_CHANGED",
      "BOARD_SEMANTIC_HASH_STABLE",
      "CONTINUATION_SEMANTIC_HASH_STABLE",
      "HASH_HELPER_MATCHED"
    ]);
    expect(hashCase.actual.criticalErrorCodes).toEqual([]);
  });

  it("excludes run IDs, timestamps, latency, and code provenance from deterministic output", () => {
    const first = evaluation();
    const second = runContinuationEvaluation({
      startedAt: new Date("2026-08-13T05:00:00.000Z"),
      completedAt: new Date("2026-08-13T05:00:02.000Z"),
      code: {
        codeCommitSha: "b".repeat(40),
        codeState: "declared_commit",
        codeFingerprintSha256: null
      }
    });

    expect(first.runId).toMatch(/^continuation_eval_run_[a-f0-9]{32}$/u);
    expect(second.runId).not.toBe(first.runId);
    expect(second.deterministicOutputSha256).toBe(first.deterministicOutputSha256);
    expect(second.dataset.materializedInputSha256).toBe(
      first.dataset.materializedInputSha256
    );
    expect(second.cases).toEqual(first.cases);
    expect(second.startedAt).not.toBe(first.startedAt);
    expect(second.latencyMs).not.toBe(first.latencyMs);
    expect(second.code).not.toEqual(first.code);
    const { artifact, ...content } = first;
    expect(artifact.canonicalPayloadSha256).toBe(sha256Canonical(content));
  });

  it("detects validly-shaped mutable expectation drift without freezing the candidate", () => {
    const tampered = structuredClone(continuationEvaluationDataset);
    const first = tampered.cases[0];
    if (!first || first.task !== "contract_oracle") {
      throw new TypeError("Missing first executable Continuation case.");
    }
    first.expected.oracleCode = "CONTINUATION_SETUP_ACCEPTED";
    const loaded = loadContinuationEvaluationDataset(tampered);
    const record = runContinuationEvaluation({
      startedAt: STARTED_AT,
      completedAt: COMPLETED_AT,
      code: CODE,
      dataset: loaded
    });

    expect(record.status).toBe("failed");
    expect(record.counts.exactOraclePassCount).toBe(11);
    expect(record.errors).toContainEqual({
      caseId: "E1-CT-001",
      code: "CONTINUATION_EXACT_ORACLE_MISMATCH"
    });
    expect(record.dataset.datasetSha256).toBeNull();
  });

  it("rejects config lifecycle or semantic tampering", () => {
    expect(() =>
      loadContinuationEvaluationDataset(continuationEvaluationDataset, {
        ...continuationEvaluationConfig,
        purpose: "resolver_quality"
      })
    ).toThrow();
    expect(() =>
      loadContinuationEvaluationDataset({
        ...continuationEvaluationDataset,
        lifecycle: {
          ...continuationEvaluationDataset.lifecycle,
          state: "frozen"
        }
      })
    ).toThrow();
  });

  it("rejects duplicate or missing IDs, swapped scenarios, stages, and blockers", () => {
    const duplicateAndMissing = structuredClone(continuationEvaluationDataset);
    duplicateAndMissing.cases[21] = structuredClone(duplicateAndMissing.cases[0]!);
    expect(() => loadContinuationEvaluationDataset(duplicateAndMissing)).toThrow();

    const swappedScenarios = structuredClone(continuationEvaluationDataset);
    const first = swappedScenarios.cases[0]!;
    const second = swappedScenarios.cases[1]!;
    if (first.task !== "contract_oracle" || second.task !== "contract_oracle") {
      throw new TypeError("Missing executable cases for scenario swap.");
    }
    [first.scenario, second.scenario] = [second.scenario, first.scenario];
    expect(() => loadContinuationEvaluationDataset(swappedScenarios)).toThrow();

    const wrongStage = structuredClone(continuationEvaluationDataset);
    Object.assign(wrongStage.cases[0]!, { evaluationStage: "resolver_behavior" });
    expect(() => loadContinuationEvaluationDataset(wrongStage)).toThrow();

    const wrongBlocker = structuredClone(continuationEvaluationDataset);
    const deferred = wrongBlocker.cases[12]!;
    if (deferred.task !== "resolver_behavior") {
      throw new TypeError("Missing deferred case for blocker mutation.");
    }
    deferred.expected.blockedByTask = "R-003";
    expect(() => loadContinuationEvaluationDataset(wrongBlocker)).toThrow();
  });

  it("makes measured pass state an exact function of replay, errors, hashes, and critical errors", () => {
    const rowOutcome = structuredClone(evaluation());
    const measured = rowOutcome.cases[0]!;
    if (measured.measurementStatus !== "measured") {
      throw new TypeError("Missing measured case for contradiction mutation.");
    }
    measured.passed = false;

    const rowHash = structuredClone(evaluation());
    const hashed = rowHash.cases[0]!;
    if (hashed.measurementStatus !== "measured") {
      throw new TypeError("Missing measured case for hash mutation.");
    }
    hashed.actualSummarySha256 = "0".repeat(64);

    const replay = structuredClone(evaluation()).cases[0]!;
    const executionError = structuredClone(evaluation()).cases[0]!;
    const criticalError = structuredClone(evaluation()).cases[0]!;
    if (
      replay.measurementStatus !== "measured" ||
      executionError.measurementStatus !== "measured" ||
      criticalError.measurementStatus !== "measured"
    ) {
      throw new TypeError("Missing measured cases for pass-state mutations.");
    }
    replay.deterministicReplayMatched = false;
    executionError.errorCode = "CASE_EXECUTION_FAILED";
    criticalError.expected.criticalErrorCodes = ["PRIVACY_LEAK"];
    criticalError.actual.criticalErrorCodes = ["PRIVACY_LEAK"];
    criticalError.expectedSummarySha256 =
      continuationEvaluationSummarySha256(criticalError.expected);
    criticalError.actualSummarySha256 =
      continuationEvaluationSummarySha256(criticalError.actual);

    for (const invalidRow of [
      measured,
      hashed,
      replay,
      executionError,
      criticalError
    ]) {
      expect(() => continuationEvaluationCaseResultSchema.safeParse(invalidRow)).not.toThrow();
      expect(continuationEvaluationCaseResultSchema.safeParse(invalidRow).success).toBe(false);
    }
  });

  it("fails closed on aggregate, materialized, deterministic, and artifact tampering", () => {

    const counts = structuredClone(evaluation());
    counts.counts.passCount = 11;
    resealDeterministicAndArtifact(counts);
    const passRate = structuredClone(evaluation());
    passRate.metrics.exactOraclePassRate = 0.5;
    resealDeterministicAndArtifact(passRate);
    const criticalErrors = structuredClone(evaluation());
    criticalErrors.metrics.criticalErrors.privacyLeakCount = 1;
    resealDeterministicAndArtifact(criticalErrors);
    const topLevelErrors = structuredClone(evaluation());
    topLevelErrors.errors.push({
      caseId: "E1-CT-001",
      code: "CONTINUATION_EXACT_ORACLE_MISMATCH"
    });
    resealDeterministicAndArtifact(topLevelErrors);
    const materialized = structuredClone(evaluation());
    materialized.dataset.materializedInputSha256 = "1".repeat(64);
    resealDeterministicAndArtifact(materialized);
    const deterministic = structuredClone(evaluation());
    deterministic.deterministicOutputSha256 = "2".repeat(64);
    resealArtifact(deterministic);
    const artifact = structuredClone(evaluation());
    artifact.artifact.canonicalPayloadSha256 = "3".repeat(64);

    for (const invalid of [
      counts,
      passRate,
      criticalErrors,
      topLevelErrors,
      materialized,
      deterministic,
      artifact
    ]) {
      expect(() => continuationEvaluationRunRecordSchema.safeParse(invalid)).not.toThrow();
      expect(continuationEvaluationRunRecordSchema.safeParse(invalid).success).toBe(false);
    }
  });

it("turns fixture materialization failures into 12 failed measurements", () => {
  const result = evaluateContinuationDataset(continuationEvaluationDataset, {
      buildFixture: () => {
        throw new TypeError("synthetic fixture construction failure");
      }
    });
    const measured = result.cases.filter(
      (item) => item.measurementStatus === "measured"
    );

    expect(measured).toHaveLength(12);
    expect(
      measured.every(
        (item) =>
          item.outcome === "measured_fail" &&
          item.passed === false &&
          item.errorCode === "CASE_FIXTURE_MATERIALIZATION_FAILED" &&
          item.materializedInputSha256 === null
      )
    ).toBe(true);
    expect(result.counts.exactOracleFailureCount).toBe(12);
    expect(result.counts.notEvaluatedCaseCount).toBe(10);
  expect(result.metrics.criticalErrors.contractIntegrityFailureCount).toBe(12);
});

it("isolates a mismatched fixture scenario as one materialization failure", () => {
  const executableCases = continuationEvaluationDataset.cases.filter(
    (item) => item.task === "contract_oracle"
  );
  const targetCase = executableCases[0];
  const alternateCase = executableCases[1];
  if (!targetCase || !alternateCase) {
    throw new TypeError("Two executable continuation cases are required.");
  }

  const result = evaluateContinuationDataset(continuationEvaluationDataset, {
    buildFixture: (scenario) => {
      const built = buildContinuationEvaluationFixture(scenario);
      return scenario === targetCase.scenario
        ? { ...built, scenario: alternateCase.scenario }
        : built;
    }
  });
  const failed = result.cases.find((item) => item.caseId === targetCase.caseId);

  expect(failed).toMatchObject({
    outcome: "measured_fail",
    passed: false,
    errorCode: "CASE_FIXTURE_MATERIALIZATION_FAILED",
    materializedInputSha256: null
  });
  expect(
    result.cases.filter((item) => item.outcome === "measured_pass")
  ).toHaveLength(11);
  expect(result.counts.exactOracleFailureCount).toBe(1);
  expect(result.counts.notEvaluatedCaseCount).toBe(10);
});

it("isolates an invalid oracle summary as one execution failure", () => {
  const targetCase = continuationEvaluationDataset.cases.find(
    (item) => item.task === "contract_oracle"
  );
  if (!targetCase) {
    throw new TypeError("An executable continuation case is required.");
  }

  const result = evaluateContinuationDataset(continuationEvaluationDataset, {
    buildFixture: (scenario) => {
      const built = buildContinuationEvaluationFixture(scenario);
      return scenario === targetCase.scenario
        ? { ...built, execute: () => ({} as never) }
        : built;
    }
  });
  const failed = result.cases.find((item) => item.caseId === targetCase.caseId);

  expect(failed).toMatchObject({
    outcome: "measured_fail",
    passed: false,
    errorCode: "CASE_EXECUTION_FAILED",
    deterministicReplayMatched: false
  });
  expect(failed?.materializedInputSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    result.cases.filter((item) => item.outcome === "measured_pass")
  ).toHaveLength(11);
  expect(result.counts.exactOracleFailureCount).toBe(1);
  expect(result.counts.notEvaluatedCaseCount).toBe(10);
});

  it("stores only the bounded run record through the private artifact boundary", async () => {
    let writtenContents = "";
    const result = await runAndStoreContinuationEvaluation(
      {
        cwd: "/synthetic/workspace",
        dataRoot: "/synthetic/workspace",
        env: { NODE_ENV: "test" },
        startedAt: STARTED_AT,
        completedAt: COMPLETED_AT
      },
      {
        resolveCodeProvenance: async () => CODE,
        writeArtifact: async (input) => {
          writtenContents = String(input.contents);
          if (!input.expectedSha256) {
            throw new TypeError("Missing expected serialized artifact hash.");
          }
          return {
            relativePath: input.relativePath,
            sha256: input.expectedSha256,
            byteLength: Buffer.byteLength(writtenContents),
            mode: 0o600
          };
        }
      }
    );

    expect(result.record.status).toBe("passed");
    expect(result.storedArtifact.mode).toBe(0o600);
    expect(writtenContents).toContain("contract_scaffold_validation_only");
    expect(writtenContents).not.toMatch(/source_ref_|private_target_|continuation_observation_/u);
    expect(writtenContents).not.toContain("/private/evaluation/native-locator");
    expect(writtenContents).not.toContain('"payload"');
  });

  it("rejects a contradictory stored artifact receipt", async () => {
    await expect(
      runAndStoreContinuationEvaluation(
        {
          cwd: "/synthetic/workspace",
          dataRoot: "/synthetic/workspace",
          env: { NODE_ENV: "test" },
          startedAt: STARTED_AT,
          completedAt: COMPLETED_AT
        },
        {
          resolveCodeProvenance: async () => CODE,
          writeArtifact: async (input) => ({
            relativePath: input.relativePath,
            sha256: "f".repeat(64),
            byteLength: Buffer.byteLength(String(input.contents)),
            mode: 0o600
          })
        }
      )
    ).rejects.toThrow("receipt is contradictory");
  });
});

function evaluation() {
  return runContinuationEvaluation({
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    code: CODE
  });
}

function resealDeterministicAndArtifact(
  record: ReturnType<typeof evaluation>
): void {
  record.deterministicOutputSha256 =
    continuationEvaluationDeterministicOutputSha256({
      datasetCandidatePayloadSha256:
        record.dataset.candidatePayloadSha256,
      configCandidatePayloadSha256:
        record.config.candidatePayloadSha256,
      materializedInputSha256: record.dataset.materializedInputSha256,
      versions: record.versions,
      counts: record.counts,
      metrics: record.metrics,
      cases: record.cases
    });
  resealArtifact(record);
}

function resealArtifact(record: ReturnType<typeof evaluation>): void {
  const { artifact, ...content } = record;
  artifact.canonicalPayloadSha256 =
    continuationEvaluationArtifactPayloadSha256(content);
}
