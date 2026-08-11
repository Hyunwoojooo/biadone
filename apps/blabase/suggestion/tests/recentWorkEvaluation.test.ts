import { describe, expect, it } from "vitest";

import datasetArtifact from "../eval/synthetic/recentWorkProjectionCases.v0.1.json";
import { recentWorkEvaluationDatasetSchema } from "../eval/synthetic/recentWorkCaseBuilder";
import { sha256Canonical } from "../src/evaluation/crossSourceIntegrity";
import {
  evaluateRecentWorkCase,
  recentWorkEvaluationRunRecordSchema,
  resealRecentWorkEvaluationArtifact,
  runRecentWorkProductionIntegrationProbe,
  runRecentWorkEvaluation
} from "../src/evaluation/recentWorkEvaluation";

const STARTED_AT = new Date("2026-08-10T13:00:00.000Z");
const CODE = {
  commitSha: null,
  state: "dirty_worktree" as const,
  fingerprintSha256: "a".repeat(64)
};
const DATASET = recentWorkEvaluationDatasetSchema.parse(datasetArtifact);

describe("Recent Work projection synthetic Dev Candidate", () => {
  it("derives 23 case and 28 variant measurements without release claims", () => {
    const record = evaluation();

    expect(recentWorkEvaluationRunRecordSchema.parse(record)).toEqual(record);
    expect(record).toMatchObject({
      status: "passed",
      contract: "recent-work-projection-evaluation-run-v0.2",
      evaluationPolicyVersion: "recent-work-projection-evaluation-policy-v0.2",
      dataset: {
        version: "suggestion-recent-work-projection-dev-v0.1",
        lifecycleState: "mutable",
        datasetSha256: null,
        immutableRef: null,
        frozenAt: null,
        caseCount: 23,
        containsProductionData: false
      },
      counts: {
        totalCases: 23,
        passedCases: 23,
        failedCases: 0,
        runtimeVariants: 28,
        measuredVariants: 28,
        errorVariants: 0,
        notMeasuredVariants: 0,
        actualSelectionChanges: 0
      },
      metrics: {
        variantMeasurementFailureCount: 0,
        integrationMeasurementFailureCount: 0,
        deterministicHashFailureCount: 0,
        privacyLeakageCount: 0,
        replayInputDiffCount: 0,
        candidateUniverseDiffCount: 0,
        eligibilityProjectionDiffCount: 0,
        assessmentDiffCount: 0,
        activeSelectionDiffCount: 0,
        activeResultDiffCount: 0,
        activeResultHashDiffCount: 0,
        recentWorkEffectViolationCount: 0
      },
      comparison: {
        baselineRunId: null,
        comparisonRunId: null,
        baselineInputSha256: null,
        comparisonInputSha256: null,
        sameFrozenInputComparison: null,
        outcome: null,
        improvementClaimed: false
      },
      release: {
        decision: "deferred",
        frozenDatasetEligible: false,
        presentRolloutEligible: false,
        activeEffectEligible: false,
        humanReviewRequired: true
      }
    });
    expect(record.coverage.publicTrackingStates).toEqual([
      "in_sync",
      "ahead",
      "behind",
      "diverged",
      "not_configured"
    ]);
    expect(Object.values(record.gates).every(Boolean)).toBe(true);
  });

  it("uses one matched production shadow/present probe for exact Active invariants", () => {
    const record = evaluation();
    expect(record.activeIntegration).toMatchObject({
      status: "passed",
      measurementStatus: "measured",
      errorReason: null,
      shadowRecentWorkMatched: true,
      presentRecentWorkMatched: true,
      recentWorkEqual: true,
      shadowPublicSummaryNull: true,
      presentPublicSummaryPresent: true,
      replayInputEqual: true,
      replayInputSha256Equal: true,
      replayInputHashesInternallyValid: true,
      fullResultEqual: true,
      rankedCandidatesEqual: true,
      eligibilityProjectionEqual: true,
      assessmentsEqual: true,
      decisionEqual: true,
      resultSha256Equal: true,
      recentWorkEffectsNone: true,
      publicPrivacyLeakageCount: 0
    });
    expect(record.activeIntegration.activeCandidateCount).toBeGreaterThan(0);
    expect(record.activeIntegration.assessmentCount).toBeGreaterThan(0);
    expect(record.dataset.materializedInputSha256).toBe(
      sha256Canonical({
        cases: record.cases.map((item) => ({
          caseId: item.caseId,
          inputSha256: item.inputSha256
        })),
        productionIntegrationProbeInputSha256:
          record.activeIntegration.inputSha256
      })
    );
  });

  it("checks materialized upstream sentinels and names unrepresentable raw fields separately", () => {
    const probe = evaluation().activeIntegration;
    expect(probe.materializedUpstreamFields).toEqual([
      "StoredCodexConfig.installationSecret",
      "StoredCodexConfig.scopes[].queryPath",
      "StoredCodexConfig.scopes[].label",
      "GitHubSnapshot.user.login",
      "GitHubSnapshot.repositories[].fullName",
      "GitHubSnapshot.activities[].refName",
      "CodexSnapshot.sessions[].taskSummary"
    ]);
    expect(probe.sourceBoundaryDerivedFields).toEqual([
      "GitHub raw commit OID converted to opaque artifactId before evaluation"
    ]);
    expect(probe.unrepresentableDirectResolverFields).toEqual([
      "raw prompt body",
      "raw command text",
      "raw conversation body"
    ]);
    expect(probe.publicSurfaceNames).toHaveLength(6);
    expect(probe.publicPrivacyLeakageCount).toBe(0);
  });

  it("marks variant exception measurements as error and never clean", () => {
    const definition = DATASET.cases[0];
    const result = evaluateRecentWorkCase(definition, {
      resolve: () => {
        throw new Error("synthetic evaluator failure");
      }
    });
    expect(result).toMatchObject({
      status: "failed",
      measurementStatus: "error",
      deterministic: null,
      privacyLeakageCount: null,
      recentWorkEffectViolation: null
    });
    expect(result.variants[0]).toMatchObject({
      status: "failed",
      measurementStatus: "error",
      errorReason: "CASE_EXECUTION_FAILED",
      projectionStatus: "error",
      summaryProjected: false,
      reasonCode: null,
      publicPushOccurredAt: null,
      trackingState: null,
      aheadCount: null,
      behindCount: null,
      projectionSha256: null,
      publicSummarySha256: null,
      deterministic: null,
      privacyLeakageCount: null,
      recentWorkEffectViolation: null,
      assertionFailures: ["CASE_EXECUTION_FAILED"]
    });
  });

  it("fails closed when production fixture materialization cannot complete", () => {
    const probe = runRecentWorkProductionIntegrationProbe({
      beforeFixtureMaterialization: () => {
        throw new Error("synthetic fixture failure");
      }
    });
    expect(probe).toMatchObject({
      status: "failed",
      measurementStatus: "error",
      errorReason: "PROBE_FIXTURE_MATERIALIZATION_FAILED",
      inputSha256: null,
      publicSurfaceSha256: null,
      activeCandidateCount: null,
      assessmentCount: null,
      replayInputEqual: null,
      publicPrivacyLeakageCount: null,
      activeSelectionDiffCount: null
    });
    const record = evaluation({ integrationProbe: () => probe });
    expect(record.status).toBe("failed");
    expect(record.dataset.materializedInputSha256).toBeNull();
    expect(Object.values(record.gates).every((gate) => gate === false)).toBe(true);
    expect(recentWorkEvaluationRunRecordSchema.parse(record)).toEqual(record);
  });

  it("rejects partial measured and partial error records", () => {
    const partialMeasured = structuredClone(evaluation());
    partialMeasured.cases[0].variants[0].privacyLeakageCount = null;
    expectIssueAt(
      partialMeasured,
      ["cases", 0, "variants", 0, "measurementStatus"]
    );

    const probe = runRecentWorkProductionIntegrationProbe({
      beforeFixtureMaterialization: () => {
        throw new Error("synthetic fixture failure");
      }
    });
    const partialError = structuredClone(
      evaluation({ integrationProbe: () => probe })
    );
    partialError.activeIntegration.replayInputEqual = false;
    expectIssueAt(partialError, ["activeIntegration", "measurementStatus"]);

    const missingReason = structuredClone(
      evaluation({ integrationProbe: () => probe })
    );
    missingReason.activeIntegration.errorReason = null;
    expectIssueAt(missingReason, ["activeIntegration", "errorReason"]);
  });

  it("rejects fabricated projection fields on an error variant", () => {
    const failedCase = evaluateRecentWorkCase(DATASET.cases[0], {
      resolve: () => {
        throw new Error("synthetic evaluator failure");
      }
    });
    failedCase.variants[0].projectionSha256 = "c".repeat(64);
    const fabricated = structuredClone(evaluation());
    fabricated.cases[0] = failedCase;
    expectIssueAt(
      fabricated,
      ["cases", 0, "variants", 0, "projectionSha256"]
    );
  });

  it("rejects contradictory derived counts, metrics, gates, and status", () => {
    const record = evaluation();
    const wrongCount = structuredClone(record);
    wrongCount.counts.runtimeVariants += 1;
    expectIssueAt(wrongCount, ["counts", "runtimeVariants"]);

    const wrongMetric = structuredClone(record);
    wrongMetric.metrics.activeSelectionDiffCount = 1;
    expectIssueAt(wrongMetric, ["metrics", "activeSelectionDiffCount"]);

    const wrongGate = structuredClone(record);
    wrongGate.gates.measurementsComplete =
      !wrongGate.gates.measurementsComplete;
    expectIssueAt(wrongGate, ["gates", "measurementsComplete"]);

    const wrongStatus = structuredClone(record);
    wrongStatus.status =
      wrongStatus.status === "passed" ? "failed" : "passed";
    expectIssueAt(wrongStatus, ["status"]);
  });

  it("records exact recency boundaries and fail-closed neighbors", () => {
    const record = evaluation();
    expect(caseById(record, "RW-PROJ-DEV-006").variants).toMatchObject([
      {
        variantId: "focus-exact-24h",
        status: "passed",
        projectionStatus: "matched"
      },
      {
        variantId: "focus-over-24h-by-1ms",
        status: "passed",
        projectionStatus: "unavailable",
        reasonCode: "RECENT_WORK_FOCUS_STALE"
      }
    ]);
    expect(caseById(record, "RW-PROJ-DEV-009").variants).toMatchObject([
      { variantId: "local-git-future-exact-60s", status: "passed" },
      {
        variantId: "local-git-future-over-60s-by-1ms",
        status: "passed",
        reasonCode: "RECENT_WORK_LOCAL_GIT_STALE"
      }
    ]);
  });

  it("keeps mapping boundaries explicit and project Focus display-only", () => {
    const record = evaluation();
    expect(caseById(record, "RW-PROJ-DEV-013")).toMatchObject({
      status: "passed",
      upstreamMappingState: "not_applicable",
      recentWorkEffectViolation: false,
      variants: [{ projectionStatus: "matched", summaryProjected: true }]
    });
    expect(caseById(record, "RW-PROJ-DEV-016")).toMatchObject({
      evaluationKind: "upstream_filtered_runtime",
      upstreamMappingState: "removed",
      variants: [
        {
          projectionStatus: "unavailable",
          reasonCode: "RECENT_WORK_LINK_UNAVAILABLE"
        }
      ]
    });
    expect(caseById(record, "RW-PROJ-DEV-017")).toMatchObject({
      evaluationKind: "upstream_filtered_runtime",
      upstreamMappingState: "archived"
    });
  });

  it("defaults invalid rollout to shadow and canonicalizes only the public timestamp", () => {
    const record = evaluation();
    expect(caseById(record, "RW-PROJ-DEV-021").variants[0]).toMatchObject({
      status: "passed",
      projectionStatus: "matched",
      presentationMode: "shadow",
      summaryProjected: false
    });
    expect(caseById(record, "RW-PROJ-DEV-022").variants[0]).toMatchObject({
      status: "passed",
      publicPushOccurredAt: "2026-08-10T11:00:00.000Z",
      privacyLeakageCount: 0
    });
    expect(caseById(record, "RW-PROJ-DEV-023")).toMatchObject({
      measurementStatus: "measured",
      deterministic: true,
      recentWorkEffectViolation: false
    });
  });
});

function evaluation(
  dependencies: Parameters<typeof runRecentWorkEvaluation>[1] = {}
) {
  return runRecentWorkEvaluation({
    startedAt: STARTED_AT,
    completedAt: STARTED_AT,
    code: CODE
  }, dependencies);
}

function caseById(record: ReturnType<typeof evaluation>, caseId: string) {
  const result = record.cases.find((item) => item.caseId === caseId);
  if (!result) throw new TypeError(`Missing evaluation case ${caseId}.`);
  return result;
}

function expectIssueAt(
  record: ReturnType<typeof evaluation>,
  path: Array<string | number>
): void {
  const result = recentWorkEvaluationRunRecordSchema.safeParse(
    resealRecentWorkEvaluationArtifact(record)
  );
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.map((issue) => issue.path)).toContainEqual(path);
  expect(result.error.issues.map((issue) => issue.path)).not.toContainEqual([
    "artifact"
  ]);
}
