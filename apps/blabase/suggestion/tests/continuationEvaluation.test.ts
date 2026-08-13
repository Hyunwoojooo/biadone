import { describe, expect, it } from "vitest";

import { buildContinuationEvaluationFixture } from "../eval/synthetic/continuationCaseBuilder";
import {
  buildContinuationResolverEvaluationFixture,
  type ContinuationResolverEvaluationMaterializedInput
} from "../eval/synthetic/continuationResolverCaseBuilder";
import legacyDatasetArtifact from "../eval/synthetic/continuationEvaluationCases.v0.1.json";
import legacyConfigArtifact from "../eval/synthetic/continuationEvaluationConfig.v0.1.json";
import legacyV02DatasetArtifact from "../eval/synthetic/continuationEvaluationCases.v0.2.json";
import legacyV02ConfigArtifact from "../eval/synthetic/continuationEvaluationConfig.v0.2.json";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";
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

describe("E-001 Continuation contract and resolver regression evaluation", () => {
  it("loads the exact mutable 22 measured matrix", () => {
    expect(continuationEvaluationDataset).toMatchObject({
      contract: "continuation-evaluation-dataset-v0.3",
      schemaVersion: "continuation-evaluation-case-v0.3",
      datasetVersion: "suggestion-continuation-dev-v0.1",
      datasetRevision: 3,
      datasetClass: "dev_candidate",
      dataOrigin: "bounded_synthetic",
      containsProductionData: false,
      lifecycle: {
        state: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null
      },
      evaluatorConfig: {
        candidateRef: "eval/synthetic/continuationEvaluationConfig.v0.3.json",
        version: "continuation-evaluation-config-v0.3"
      }
    });
    expect(continuationEvaluationConfig).toMatchObject({
      version: "continuation-evaluation-config-v0.3",
      purpose: "contract_and_resolver_regression",
      taskBoundary: "continuation_regression_validation",
      matrix: {
        executableContractOracleCaseCount: 12,
        executableResolverBehaviorCaseCount: 9,
        executableBoardBehaviorCaseCount: 1,
        deferredCaseCount: 0
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
    ).toHaveLength(9);
    expect(continuationEvaluationDataset.cases.filter(
      (item) => item.task === "board_behavior"
    )).toHaveLength(1);
    expect(CONTINUATION_EVALUATION_DATASET_CANDIDATE_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(CONTINUATION_EVALUATION_CONFIG_CANDIDATE_SHA256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("preserves the v0.1 and v0.2 dataset and config artifacts byte-semantically", () => {
    expect(legacyDatasetArtifact).toMatchObject({
      contract: "continuation-evaluation-dataset-v0.1",
      schemaVersion: "continuation-evaluation-case-v0.1",
      datasetVersion: "suggestion-continuation-dev-v0.1",
      datasetRevision: 1
    });
    expect(legacyConfigArtifact).toMatchObject({
      version: "continuation-evaluation-config-v0.1",
      purpose: "contract_scaffold_validation",
      taskBoundary: "contract_scaffold_validation"
    });
    expect(sha256Canonical(legacyDatasetArtifact)).toBe(
      "c834c86ab9b37822b58debd9c6f08dab9a481cb87e9a1183cf8153a63ada7b98"
    );
    expect(sha256Canonical(legacyConfigArtifact)).toBe(
      "4624f4c404c995ddce6bc0c6bda94c2dcf00247fa26344477669a15631f99de9"
    );
    expect(runtimeSha256(legacyV02DatasetArtifact)).toBe(
      "bbb996404c9154d576fda3274ba3f815048405b22795237a1e53ee7f4461edd3"
    );
    expect(runtimeSha256(legacyV02ConfigArtifact)).toBe(
      "4df7bb61a62e901ebc5ff7be69adc7a9b955e2e0d23d01b53a76c31ab4e4e444"
    );
  });

  it("passes all 12 contract, 9 resolver, and 1 Board measurements", () => {
    const record = evaluation();

    expect(continuationEvaluationRunRecordSchema.parse(record)).toEqual(record);
    expect(record.status).toBe("passed");
    expect(record.counts).toEqual({
      totalCaseCount: 22,
      executableCaseCount: 22,
      contractOracleCaseCount: 12,
      resolverBehaviorCaseCount: 9,
      boardBehaviorCaseCount: 1,
      exactOraclePassCount: 12,
      exactOracleFailureCount: 0,
      resolverBehaviorPassCount: 9,
      resolverBehaviorFailureCount: 0,
      deferredCaseCount: 0,
      notEvaluatedCaseCount: 0,
      passCount: 22
    });
    expect(record.metrics.exactOraclePassRate).toBe(1);
    expect(record.metrics.resolverBehaviorPassRate).toBe(1);
    expect(record.metrics.acceptableAt1).toBeNull();
    expect(record.metrics.acceptableAt3).toBeNull();
    expect(record.metrics.setupRouteAccuracy).toBeNull();
    expect(record.metrics.setupRuntimeQuality).toBeNull();
    expect(record.metrics.releaseGateApplicable).toBe(false);
    expect(Object.values(record.metrics.criticalErrors).every((count) => count === 0)).toBe(true);
    expect(record.versions).toMatchObject({
      continuationGitHubSourceSchemaVersion: "github-snapshot-v6",
      continuationCodexSourceSchemaVersion: "codex-snapshot-v3",
      continuationSourceAdapterBatchContract: "continuation-source-adapter-batch-v0.4",
      continuationSourceAdapterBatchSchemaVersion:
        "continuation-source-adapter-batch-schema-v0.4",
      continuationIdentityInputContract: "continuation-identity-input-v0.4",
      continuationIdentityResultContract: "continuation-identity-result-v0.4",
      continuationIdentitySchemaVersion: "continuation-identity-schema-v0.4",
      continuationCandidateDerivationEnvelopeContract:
        "continuation-candidate-derivation-envelope-v0.3",
      continuationCandidateDerivationResultContract:
        "continuation-candidate-derivation-result-v0.3",
      continuationCandidateDerivationSchemaVersion:
        "continuation-candidate-derivation-schema-v0.3",
      continuationScoringResultContract: "continuation-scoring-result-v0.1",
      continuationScoringSchemaVersion: "continuation-scoring-schema-v0.1",
      continuationResolutionEnvelopeContract: "continuation-resolution-envelope-v0.1",
      continuationResolutionSchemaVersion: "continuation-resolution-schema-v0.1",
      continuationResolvedDecisionContract: "continuation-resolved-decision-v0.1",
      continuationResolvedDecisionSchemaVersion:
        "continuation-resolved-decision-schema-v0.1",
      continuationResolverVersion: "continuation-resolver-v0.1"
    });
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
      qualityClaim: "contract_and_resolver_regression_only"
    });
    expect(record.release).toEqual({
      releaseGateApplicable: false,
      decision: "deferred",
      frozenDatasetEligible: false,
      resolverReleaseEligible: false,
      humanReviewRequired: true
    });
  });

  it("measures all 9 resolver rows through accepted and input-bound R-003 artifacts", () => {
    const resolverRows = evaluation().cases.filter(
      (item): item is MeasuredEvaluationRow =>
        item.task === "resolver_behavior" &&
        item.measurementStatus === "measured"
    );

    expect(resolverRows).toHaveLength(9);
    expect(
      resolverRows.every(
        (item) =>
          item.outcome === "measured_pass" &&
          item.passed === true &&
          item.actual.invariantCodes.includes("R003_ARTIFACT_SCHEMA_ACCEPTED") &&
          item.actual.invariantCodes.includes("R003_INPUT_BOUND_VERIFIED")
      )
    ).toBe(true);

    expectResolverSummary(resolverRows, "E1-RV-GH-001", {
      decisionStatus: "offers_available",
      coverageCode: "COMPLETE"
    });
    expectResolverSummary(resolverRows, "E1-RV-GH-002", {
      decisionStatus: "insufficient_evidence",
      coverageCode: "INSUFFICIENT"
    });
    expectResolverSummary(resolverRows, "E1-RV-CX-002", {
      oracleCode: "CODEX_HISTORICAL_COMPLETION_BOUNDED",
      decisionStatus: "offers_available",
      coverageCode: "COMPLETE",
      invariantCodes: ["NO_FALSE_STATUS_CLAIM", "TERMINAL_STATE_UNKNOWN"]
    });
    expectResolverSummary(resolverRows, "E1-RV-FR-001", {
      decisionStatus: "offers_available",
      coverageCode: "SOURCE_LOCAL_PARTIAL"
    });
    expectResolverSummary(resolverRows, "E1-RV-ID-001", {
      oracleCode: "SAME_NAME_IDENTITIES_NOT_AUTO_MERGED",
      decisionStatus: "setup_required",
      coverageCode: "SOURCE_LOCAL_PARTIAL",
      invariantCodes: ["SAME_NAME_IDENTITIES_NOT_AUTO_MERGED"]
    });
    expectResolverSummary(resolverRows, "E1-RV-TM-001", {
      decisionStatus: "offers_available",
      coverageCode: "COMPLETE",
      invariantCodes: ["TOP_THREE_BOUNDED"]
    });
  });

  it("authenticates Board precedence and exact work-context dedupe", () => {
    const row = evaluation().cases.find((item) => item.caseId === "E1-RV-DT-001");
    expect(row).toMatchObject({
      task: "board_behavior",
      evaluationStage: "board_behavior",
      measurementStatus: "measured",
      outcome: "measured_pass",
      passed: true,
      blockedByTask: null
    });
    if (!row) return;
    expect(row.actual.prominentLane).toBe("attention");
    expect(row.actual.invariantCodes).toEqual(expect.arrayContaining([
      "ACTIVE_OBJECT_UNCHANGED",
      "ACTIVE_RESULT_HASH_UNCHANGED",
      "ATTENTION_PRIMARY",
      "BOARD_INPUT_BOUND_VERIFIED",
      "EXACT_WORK_CONTEXT_DEDUPED",
      "NULL_SETUP_NOT_AUTO_DEDUPED",
      "R003_ARTIFACT_SCHEMA_ACCEPTED",
      "R003_INPUT_BOUND_VERIFIED",
      "SAME_LABEL_DIFFERENT_CONTEXT_RETAINED"
    ]));
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

  it("captures default completion after evaluation through the injected clock", () => {
    const times = [
      new Date("2026-08-13T06:00:00.000Z"),
      new Date("2026-08-13T06:00:00.250Z")
    ];
    let callCount = 0;
    const record = runContinuationEvaluation(
      { code: CODE },
      {
        now: () => {
          const value = times[callCount];
          callCount += 1;
          if (!value) throw new TypeError("Unexpected evaluation clock read.");
          return value;
        }
      }
    );

    expect(callCount).toBe(2);
    expect(record.startedAt).toBe("2026-08-13T06:00:00.000Z");
    expect(record.completedAt).toBe("2026-08-13T06:00:00.250Z");
    expect(record.latencyMs).toBe(250);

    const injected = runContinuationEvaluation(
      { startedAt: STARTED_AT, completedAt: COMPLETED_AT, code: CODE },
      { now: () => { throw new TypeError("Injected timestamps must bypass the clock."); } }
    );
    expect(injected.startedAt).toBe(STARTED_AT.toISOString());
    expect(injected.completedAt).toBe(COMPLETED_AT.toISOString());
  });

  it("hashes resolver fixtures from pre-execution inputs, never oracle outputs", () => {
    const fixture = buildContinuationResolverEvaluationFixture(
      "resolver_github_recent"
    );
    const materialized = fixture.materializedInput as
      ContinuationResolverEvaluationMaterializedInput;
    const descriptor = materialized.primary;
    const inputSha256 = sha256Canonical(materialized);
    expect(JSON.stringify(materialized)).not.toContain(
      "synthetic-e001-installation-secret"
    );
    expect(materialized).not.toHaveProperty("identityResult");
    expect(materialized).not.toHaveProperty("derivationResult");
    expect(materialized).not.toHaveProperty("resolved");
    const baseline = evaluateContinuationDataset(continuationEvaluationDataset);
    const expectationChanged = structuredClone(continuationEvaluationDataset);
    const expected = expectationChanged.cases.find(
      (item) => item.caseId === "E1-RV-GH-001"
    );
    if (!expected || "measurementStatus" in expected.expected) {
      throw new TypeError("Missing measured resolver expectation.");
    }
    expected.expected.oracleCode = "STALE_GITHUB_ACTIVITY_EXCLUDED";
    const drifted = evaluateContinuationDataset(
      loadContinuationEvaluationDataset(expectationChanged)
    );

    expect(drifted.materializedInputSha256).toBe(
      baseline.materializedInputSha256
    );

    const rawChanged = structuredClone(materialized);
    rawChanged.primary.sourceSnapshots.github.fetchedAt =
      "2026-08-13T11:41:00.000Z";
    const registryChanged = structuredClone(materialized);
    registryChanged.primary.registrySha256 = "0".repeat(64);
    const envelopeChanged = structuredClone(materialized);
    envelopeChanged.primary.resolutionEnvelope.run.codeCommitSha = "e".repeat(40);

    expect(sha256Canonical(rawChanged)).not.toBe(inputSha256);
    expect(sha256Canonical(registryChanged)).not.toBe(inputSha256);
    expect(sha256Canonical(envelopeChanged)).not.toBe(inputSha256);

    descriptor.sourceSnapshots.github.fetchedAt =
      "2026-08-13T11:41:00.000Z";
    expect(fixture.execute).toThrow(
      "Synthetic resolver input descriptor integrity check failed."
    );
  });

  it("binds the tie permutation input into materialized fixture hashing", () => {
    const fixture = buildContinuationResolverEvaluationFixture(
      "resolver_tie_determinism"
    );
    const materialized = fixture.materializedInput as
      ContinuationResolverEvaluationMaterializedInput;
    if (materialized.permutation === null) {
      throw new TypeError("Tie fixture must bind its permutation input.");
    }
    const inputSha256 = sha256Canonical(materialized);

    const rawChanged = structuredClone(materialized);
    rawChanged.permutation!.sourceSnapshots.github.activities[0]!.occurredAt =
      "2026-08-13T11:29:00.000Z";
    const registryChanged = structuredClone(materialized);
    registryChanged.permutation!.registrySha256 = "1".repeat(64);
    const envelopeChanged = structuredClone(materialized);
    envelopeChanged.permutation!.derivationEnvelope.asOf =
      "2026-08-13T11:59:59.000Z";

    expect(sha256Canonical(rawChanged)).not.toBe(inputSha256);
    expect(sha256Canonical(registryChanged)).not.toBe(inputSha256);
    expect(sha256Canonical(envelopeChanged)).not.toBe(inputSha256);

    materialized.permutation.sourceSnapshots.github.fetchedAt =
      "2026-08-13T11:41:00.000Z";
    expect(fixture.execute).toThrow(
      "Synthetic resolver input descriptor integrity check failed."
    );
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
    expect(record.counts.resolverBehaviorPassCount).toBe(9);
    expect(record.counts.resolverBehaviorFailureCount).toBe(0);
    expect(record.counts.passCount).toBe(21);
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

  it("rejects duplicate or missing IDs, swapped scenarios, stages, and Board task drift", () => {
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

    const wrongBoardTask = structuredClone(continuationEvaluationDataset);
    Object.assign(wrongBoardTask.cases[21]!, { task: "resolver_behavior" });
    expect(() => loadContinuationEvaluationDataset(wrongBoardTask)).toThrow();
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

it("turns fixture materialization failures into 22 failed measurements", () => {
  const result = evaluateContinuationDataset(continuationEvaluationDataset, {
      buildFixture: () => {
        throw new TypeError("synthetic fixture construction failure");
      }
    });
    const measured = result.cases.filter(
      (item) => item.measurementStatus === "measured"
    );

    expect(measured).toHaveLength(22);
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
    expect(result.counts.resolverBehaviorFailureCount).toBe(9);
    expect(result.counts.notEvaluatedCaseCount).toBe(0);
  expect(result.metrics.criticalErrors.contractIntegrityFailureCount).toBe(22);
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
  ).toHaveLength(21);
  expect(result.counts.exactOracleFailureCount).toBe(1);
  expect(result.counts.resolverBehaviorFailureCount).toBe(0);
  expect(result.counts.notEvaluatedCaseCount).toBe(0);
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
  ).toHaveLength(21);
  expect(result.counts.exactOracleFailureCount).toBe(1);
  expect(result.counts.resolverBehaviorFailureCount).toBe(0);
  expect(result.counts.notEvaluatedCaseCount).toBe(0);
});

it("isolates an invalid resolver summary to one resolver measurement", () => {
  const targetCase = continuationEvaluationDataset.cases.find(
    (item) => item.caseId === "E1-RV-GH-001"
  );
  if (!targetCase) {
    throw new TypeError("The measured GitHub resolver case is required.");
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
    caseId: "E1-RV-GH-001",
    task: "resolver_behavior",
    outcome: "measured_fail",
    passed: false,
    errorCode: "CASE_EXECUTION_FAILED",
    deterministicReplayMatched: false
  });
  expect(result.counts).toMatchObject({
    exactOraclePassCount: 12,
    exactOracleFailureCount: 0,
    resolverBehaviorPassCount: 8,
    resolverBehaviorFailureCount: 1,
    notEvaluatedCaseCount: 0,
    passCount: 21
  });
  expect(result.cases.filter((item) => item.outcome === "measured_pass")).toHaveLength(21);

  const driftedDataset = structuredClone(continuationEvaluationDataset);
  const expectedResolver = driftedDataset.cases.find(
    (item) => item.caseId === "E1-RV-GH-001"
  );
  if (
    !expectedResolver ||
    "measurementStatus" in expectedResolver.expected
  ) {
    throw new TypeError("The measured GitHub resolver expectation is required.");
  }
  expectedResolver.expected.oracleCode = "STALE_GITHUB_ACTIVITY_EXCLUDED";
  const driftedRun = runContinuationEvaluation({
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    code: CODE,
    dataset: loadContinuationEvaluationDataset(driftedDataset)
  });
  expect(driftedRun.status).toBe("failed");
  expect(driftedRun.counts).toMatchObject({
    exactOraclePassCount: 12,
    exactOracleFailureCount: 0,
    resolverBehaviorPassCount: 8,
    resolverBehaviorFailureCount: 1,
    notEvaluatedCaseCount: 0,
    passCount: 21
  });
  expect(driftedRun.errors).toEqual([
    {
      caseId: "E1-RV-GH-001",
      code: "CONTINUATION_RESOLVER_BEHAVIOR_MISMATCH"
    }
  ]);
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
    expect(writtenContents).toContain("contract_and_resolver_regression_only");
    expect(writtenContents).not.toMatch(
      /synthetic-e001-installation-secret|private-sentinel|source_ref_|private_target_|continuation_observation_/u
    );
    expect(writtenContents).not.toContain("/Users/private");
    expect(writtenContents).not.toContain("https://private.example");
    expect(writtenContents).not.toContain("f".repeat(40));
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

type MeasuredEvaluationRow = Extract<
  ReturnType<typeof evaluation>["cases"][number],
  { measurementStatus: "measured" }
>;

function expectResolverSummary(
  rows: readonly MeasuredEvaluationRow[],
  caseId: string,
  expected: {
    oracleCode?: MeasuredEvaluationRow["actual"]["oracleCode"];
    decisionStatus: MeasuredEvaluationRow["actual"]["decisionStatus"];
    coverageCode: MeasuredEvaluationRow["actual"]["coverageCode"];
    invariantCodes?: readonly (
      MeasuredEvaluationRow["actual"]["invariantCodes"][number]
    )[];
  }
): void {
  const row = rows.find((item) => item.caseId === caseId);
  expect(row, `Missing measured resolver row ${caseId}.`).toBeDefined();
  if (!row) return;
  expect(row.actual).toMatchObject({
    ...(expected.oracleCode ? { oracleCode: expected.oracleCode } : {}),
    decisionStatus: expected.decisionStatus,
    coverageCode: expected.coverageCode
  });
  for (const invariantCode of expected.invariantCodes ?? []) {
    expect(row.actual.invariantCodes).toContain(invariantCode);
  }
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
