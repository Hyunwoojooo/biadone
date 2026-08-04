import { randomBytes } from "node:crypto";

import { z } from "zod";

import configArtifact from "../../eval/synthetic/activeAttentionDecisionConfig.v0.2.json";
import datasetArtifact from "../../eval/synthetic/activeAttentionDecisionCases.v0.1.json";
import expectationRevisionArtifact from "../../eval/synthetic/activeAttentionExpectations.v0.2.json";
import {
  ACTIVE_ATTENTION_EVALUATION_SCENARIOS,
  buildActiveAttentionEvaluationFixture
} from "../../eval/synthetic/activeAttentionCaseBuilder";
import {
  resolveActiveAttention,
  verifyActiveAttentionResultIntegrity,
  type ActiveAttentionResult
} from "../attentionDecision";
import {
  ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
  ACTIVE_ATTENTION_ID_POLICY_VERSION,
  ACTIVE_ATTENTION_INPUT_CONTRACT,
  ACTIVE_ATTENTION_LANE_POLICY_VERSION,
  ACTIVE_ATTENTION_POLICY_VERSION,
  ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT
} from "../crossSource/versions";
import { sha256Canonical } from "./crossSourceIntegrity";

export const ACTIVE_ATTENTION_EVALUATION_DATASET_CONTRACT =
  "active-attention-decision-evaluation-dataset-v0.1" as const;
export const ACTIVE_ATTENTION_EVALUATION_CASE_SCHEMA_VERSION =
  "active-attention-decision-evaluation-case-v0.1" as const;
export const ACTIVE_ATTENTION_EVALUATION_RUN_RECORD_CONTRACT =
  "active-attention-decision-evaluation-run-v0.1" as const;

const CASE_COUNT = 44;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const scenarioSchema = z.enum(ACTIVE_ATTENTION_EVALUATION_SCENARIOS);
const errorSchema = z
  .enum([
    "INPUT_INTEGRITY_REJECTED",
    "EXACT_EVIDENCE_GRAPH_REJECTED",
    "CASE_EXECUTION_FAILED"
  ])
  .nullable();
const decisionStatusSchema = z
  .enum([
    "suggested",
    "needs_clarification",
    "no_action",
    "insufficient_evidence"
  ])
  .nullable();
const candidateKeySchema = z
  .string()
  .regex(
    /^(?:github|codex_managed):(?:github_work_item|managed_failure|configured_follow_through):(?:must_now|unblock|close_loop|focus):(?:do|inspect|close_loop):(?:none|review_changes|commit_changes|create_pull_request|request_review)$/
  );
const assessmentOutcomeSchema = z
  .string()
  .regex(
    /^(?:github|codex_managed):(?:github_work_item|managed_failure|configured_follow_through):(?:eligible|review_required|ineligible):(?:none|user_review|refresh_sources):[A-Z0-9_]+$/
  );

export const activeAttentionEvaluationConfigSchema = z
  .object({
    version: z.literal("active-attention-decision-config-v0.2"),
    purpose: z.literal(
      "targeted_synthetic_phase4b_active_decision_evaluation_only"
    ),
    inputBoundary: z.literal(
      "exact_phase4b_replayable_evidence_envelope"
    ),
    candidateUniverse: z.literal("github_and_managed_codex"),
    routing: z
      .object({
        eligibleCandidateWins: z.literal(true),
        refreshBeforeUserReview: z.literal(true),
        userReviewBeforeScopedNoAction: z.literal(true),
        scopedNoActionRequiresCompleteNegativeCoverage: z.literal(true),
        incompleteCoverageCannotClaimNoAction: z.literal(true),
        inactiveOrConflictingLinkCannotBecomeCandidate: z.literal(true)
      })
      .strict(),
    ranking: z
      .object({
        laneOrder: z.tuple([
          z.literal("must_now"),
          z.literal("unblock"),
          z.literal("close_loop"),
          z.literal("focus")
        ]),
        nativeDeadlineMayPromoteToMustNow: z.literal(true),
        preservesCompletePhase2GitHubRankContext: z.literal(true),
        weeklyOutcomeFocusReasonPreserved: z.literal(true),
        managedFocusMatchMayOutrankNewerNonMatchWithinLane:
          z.literal(true),
        deterministicTieBreakRequired: z.literal(true)
      })
      .strict(),
    deduplication: z
      .object({
        sameTargetSpecificityOrder: z.tuple([
          z.literal("managed_failure"),
          z.literal("configured_follow_through"),
          z.literal("github_work_item")
        ]),
        duplicateOpenLoopMayNotRemainEligible: z.literal(true)
      })
      .strict(),
    managedFailure: z
      .object({
        latestDirectFailureOnly: z.literal(true),
        continuousMonotonicHistoryRequired: z.literal(true),
        exactActiveGitHubRelationRequired: z.literal(true),
        recoveredFailureExcluded: z.literal(true),
        gapOrPrunedHistoryRoutesToRefresh: z.literal(true)
      })
      .strict(),
    workflow: z
      .object({
        explicitProjectWorkflowRequired: z.literal(true),
        archivedProjectExcluded: z.literal(true),
        nonRetroactive: z.literal(true),
        gracePeriodMs: z.literal(120_000),
        actionTargetCompatibilityRequired: z.literal(true),
        createPullRequestRequiresIssueTarget: z.literal(true),
        requestReviewRequiresAuthoredPullRequestTarget: z.literal(true),
        explicitClosureSuppressesCandidate: z.literal(true),
        matchingCommitOrPullRequestArtifactSuppressesCandidate:
          z.literal(true)
      })
      .strict(),
    integrity: z
      .object({
        sealedInputRequired: z.literal(true),
        exactEvidenceGraphRequired: z.literal(true),
        exactResultHashRequired: z.literal(true),
        canonicalOrderingRequired: z.literal(true),
        deterministicReplayRequired: z.literal(true)
      })
      .strict(),
    privacy: z
      .object({
        containsProductionData: z.literal(false),
        syntheticFixturesOnly: z.literal(true),
        rawCodexPromptAnswerCommandOutputPathOrThreadIdAllowed:
          z.literal(false),
        sanitizedSyntheticGitHubRoutingMetadataAllowed: z.literal(true),
        evaluationRecordStoresRawCandidatePayload: z.literal(false),
        privacySentinelMustExistAtResolverInput: z.literal(true)
      })
      .strict(),
    recordkeeping: z
      .object({
        canonicalPayloadHashRequired: z.literal(true),
        artifactPathRequired: z.literal(true),
        automaticAndHumanReviewStatusSeparated: z.literal(true),
        limitationsRecorded: z.literal(true)
      })
      .strict()
  })
  .strict();

const topCandidateSchema = z
  .object({
    triggerSource: z.enum(["github", "codex_managed"]),
    triggerKind: z.enum([
      "github_work_item",
      "managed_failure",
      "configured_follow_through"
    ]),
    lane: z.enum(["must_now", "unblock", "close_loop", "focus"]),
    intervention: z.enum(["do", "inspect", "close_loop"]),
    workflowActionKind: z
      .enum([
        "review_changes",
        "commit_changes",
        "create_pull_request",
        "request_review"
      ])
      .nullable()
  })
  .strict();

const expectedSummarySchema = z
  .object({
    error: errorSchema,
    decisionStatus: decisionStatusSchema,
    decisionReasonCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(3),
    topCandidate: topCandidateSchema.nullable(),
    rankedCandidateOrder: z.array(candidateKeySchema).max(20),
    assessmentOutcomes: z.array(assessmentOutcomeSchema).max(40)
  })
  .strict()
  .superRefine((summary, context) => {
    const failed = summary.error !== null;
    if (
      (failed &&
        (summary.decisionStatus !== null ||
          summary.topCandidate !== null ||
          summary.decisionReasonCodes.length > 0 ||
          summary.rankedCandidateOrder.length > 0 ||
          summary.assessmentOutcomes.length > 0)) ||
      (!failed && summary.decisionStatus === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected active-decision error and decision fields disagree."
      });
    }
    if (
      (summary.decisionStatus === "suggested") !==
      (summary.topCandidate !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topCandidate"],
        message: "Only suggested decisions may declare a top candidate."
      });
    }
    if (
      summary.decisionStatus === "suggested" &&
      (summary.rankedCandidateOrder.length === 0 ||
        (summary.topCandidate !== null &&
          topCandidateKey(summary.topCandidate) !==
            summary.rankedCandidateOrder[0]))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rankedCandidateOrder"],
        message: "The top expectation must lead the exact rank order."
      });
    }
    if (
      summary.decisionStatus !== "suggested" &&
      summary.rankedCandidateOrder.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rankedCandidateOrder"],
        message: "Non-suggested decisions cannot rank candidates."
      });
    }
    if (!failed && summary.decisionReasonCodes.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionReasonCodes"],
        message: "Successful cases require an exact decision reason."
      });
    }
  });

export const activeAttentionEvaluationDatasetSchema = z
  .object({
    contract: z.literal(ACTIVE_ATTENTION_EVALUATION_DATASET_CONTRACT),
    schemaVersion: z.literal(
      ACTIVE_ATTENTION_EVALUATION_CASE_SCHEMA_VERSION
    ),
    datasetVersion: z.literal("suggestion-active-attention-dev-v0.2"),
    datasetRevision: z.literal(3),
    datasetClass: z.literal("dev_candidate"),
    inputBoundary: z.literal(
      "exact_phase4b_replayable_evidence_envelope"
    ),
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
    resolverConfig: z
      .object({
        immutableRef: z.literal(
          "eval/synthetic/activeAttentionDecisionConfig.v0.2.json"
        ),
        version: z.literal("active-attention-decision-config-v0.2"),
        sha256: sha256Schema
      })
      .strict(),
    expectedInvariants: z
      .object({
        recommendationMode: z.literal("aggressive_evidence_bound"),
        readOnly: z.literal(true),
        upstreamObjectsRemainForbidden: z.literal(true),
        containsRawCodexValues: z.literal(false),
        deterministicReplay: z.literal(true)
      })
      .strict(),
    expectedResultSha256ByCase: z.record(
      z.string().regex(/^ACTIVE-DEV-[0-9]{3}$/),
      sha256Schema.nullable()
    ),
    cases: z
      .array(
        z
          .object({
            caseId: z.string().regex(/^ACTIVE-DEV-[0-9]{3}$/),
            title: z.string().min(1).max(180),
            scenario: scenarioSchema,
            expected: expectedSummarySchema,
            labels: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1)
          })
          .strict()
      )
      .length(CASE_COUNT)
  })
  .strict()
  .superRefine((dataset, context) => {
    const caseIds = dataset.cases.map((item) => item.caseId);
    const scenarios = dataset.cases.map((item) => item.scenario);
    if (
      new Set(caseIds).size !== dataset.cases.length ||
      new Set(scenarios).size !== dataset.cases.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases"],
        message: "Active-decision cases and scenarios must be unique."
      });
    }
    const expectedIds = Object.keys(dataset.expectedResultSha256ByCase);
    if (
      expectedIds.length !== dataset.cases.length ||
      expectedIds.some((caseId) => !caseIds.includes(caseId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedResultSha256ByCase"],
        message: "Every active-decision case requires one result expectation."
      });
    }
    for (const evaluationCase of dataset.cases) {
      const resultHash =
        dataset.expectedResultSha256ByCase[evaluationCase.caseId];
      if ((evaluationCase.expected.error !== null) !== (resultHash === null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expectedResultSha256ByCase", evaluationCase.caseId],
          message: "Only fail-closed cases may omit an active result hash."
        });
      }
    }
  });

export type ActiveAttentionEvaluationConfig = z.infer<
  typeof activeAttentionEvaluationConfigSchema
>;
export type ActiveAttentionEvaluationDataset = z.infer<
  typeof activeAttentionEvaluationDatasetSchema
>;
export type ActiveAttentionEvaluationCase =
  ActiveAttentionEvaluationDataset["cases"][number];
type ExpectedSummary = z.infer<typeof expectedSummarySchema>;

export type ActiveAttentionCaseResult = {
  caseId: string;
  scenario: ActiveAttentionEvaluationCase["scenario"];
  labels: string[];
  passed: boolean;
  materializedInputSha256: string;
  expectedSummarySha256: string;
  actualSummarySha256: string;
  expectedResultSha256: string | null;
  resultSha256: string | null;
  expected: ExpectedSummary;
  actual: ExpectedSummary;
};

export type ActiveAttentionDecisionEvaluationMetrics = {
  caseCount: number;
  exactCasePassCount: number;
  exactCasePassRate: number;
  expectedAssessmentCount: number;
  observedAssessmentCount: number;
  assessmentPrecision: number;
  assessmentRecall: number;
  resultSchemaPassRate: number;
  resultSchemaErrorCount: number;
  resultHashMismatchCount: number;
  wrongDecisionStatusCount: number;
  wrongReviewRouteCount: number;
  wrongLaneOrRankCount: number;
  phase2FourPlusRankTruncationCount: number;
  weeklyFocusReasonLossCount: number;
  managedFocusPriorityFailureCount: number;
  unsafeCandidateLeakageCount: number;
  recoveredFailureLeakageCount: number;
  unhealthyHistoryCandidateLeakageCount: number;
  workflowlessFollowThroughLeakageCount: number;
  archivedProjectWorkflowLeakageCount: number;
  workflowActionTargetCompatibilityLeakageCount: number;
  retroactiveWorkflowLeakageCount: number;
  gracePeriodLeakageCount: number;
  closedWorkflowLeakageCount: number;
  artifactDuplicateLeakageCount: number;
  duplicateOpenLoopLeakageCount: number;
  refreshBeforeUserReviewFailureCount: number;
  standaloneUserReviewFailureCount: number;
  eligibleBeforeUserReviewFailureCount: number;
  unavailableCoverageNoActionLeakageCount: number;
  inactiveLinkCandidateLeakageCount: number;
  scopedNoActionFailureCount: number;
  inputIntegrityFailOpenCount: number;
  evidenceGraphFailOpenCount: number;
  upstreamBoundaryLeakageCount: number;
  privacyInputBoundaryAbsenceCount: number;
  privacySentinelLeakageCount: number;
  rawCodexFieldLeakageCount: number;
  canonicalOrderingFailureCount: number;
  determinismFailureCount: number;
  configIntegrityFailureCount: number;
};

export type ActiveAttentionDecisionEvaluationRecord = {
  contract: typeof ACTIVE_ATTENTION_EVALUATION_RUN_RECORD_CONTRACT;
  runId: string;
  comparisonRunId: null;
  comparisonReason: "TARGETED_PHASE4B_DEV_CANDIDATE_BASELINE";
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  dataset: {
    version: "suggestion-active-attention-dev-v0.2";
    revision: 3;
    class: "dev_candidate";
    split: "development";
    lifecycle: "mutable";
    inputBoundary: "exact_phase4b_replayable_evidence_envelope";
    dataOrigin: "bounded_synthetic";
    containsProductionData: false;
    canonicalSha256: string;
    materializedInputSha256: string;
    includedCaseCount: number;
    excludedCaseCount: 0;
  };
  scope: {
    task: "active_attention_decision";
    contextMode: "exact_phase4b_replayable_evidence_envelope";
    caseIds: string[];
    fieldScope: readonly [
      "decision_status",
      "decision_route",
      "candidate_lane",
      "candidate_rank",
      "deduplication",
      "fail_closed_integrity"
    ];
    includedCaseCount: number;
    excludedCaseCount: 0;
  };
  versions: ReturnType<typeof activeAttentionVersions>;
  resolverConfig: ActiveAttentionEvaluationDataset["resolverConfig"];
  code: {
    commitSha: string | null;
    state:
      | "clean_commit"
      | "declared_commit"
      | "dirty_worktree"
      | "unavailable";
    fingerprintSha256: string | null;
  };
  inference: {
    provider: "not_applicable";
    model: "not_applicable";
    promptVersion: "not_applicable";
    judgeProvider: "not_applicable";
    judgeModel: "not_applicable";
    judgePromptVersion: "not_applicable";
    candidateJudgeSameModelFamily: "not_applicable";
    guardrailVersion: "active-attention-deterministic-gates-v0.1";
    tokenUsage: "not_applicable";
  };
  runtimeConfig: {
    contextLimit: "not_applicable";
    segmentation: "not_applicable";
    concurrency: 1;
    retryCount: 0;
  };
  metrics: ActiveAttentionDecisionEvaluationMetrics;
  breakdowns: {
    byTask: {
      active_attention_decision: {
        caseCount: number;
        exactCasePassCount: number;
        exactCasePassRate: number;
      };
    };
    byContextMode: {
      exact_phase4b_replayable_evidence_envelope: {
        caseCount: number;
        exactCasePassCount: number;
        exactCasePassRate: number;
      };
    };
  };
  review: {
    automaticReviewStatus: "passed" | "failed";
    humanReviewStatus: "not_reviewed";
    qualityClaim: "development_contract_only";
  };
  cases: ActiveAttentionCaseResult[];
  deterministicOutputSha256: string;
  errors: Array<{
    caseId: string;
    code: "ACTIVE_ATTENTION_EXACT_MISMATCH";
  }>;
  privacy: {
    classification: "synthetic_sanitized_metadata";
    productionDataUsed: false;
    rawCandidatePayloadStored: false;
    promptAnswerCommandOutputPathOrThreadStored: false;
    retention: "local_evaluation_record_only";
  };
  limitations: readonly [
    "mutable_dev_candidate_not_human_gold",
    "synthetic_cases_do_not_estimate_production_generalization",
    "no_locked_holdout_evaluated"
  ];
  warnings: [];
  acceptedExceptions: [];
  artifact: {
    relativePath: string;
    hashAlgorithm: "sha256";
    hashScope: "canonical_record_payload_excluding_artifact_descriptor";
    canonicalPayloadSha256: string;
  };
};

type ExecutedCase = {
  result: ActiveAttentionCaseResult;
  activeResult: ActiveAttentionResult | null;
  repeatResultSha256: string | null;
  repeatError: ExpectedSummary["error"];
  privacySentinels: readonly string[];
  inputSerialized: string;
  resultSerialized: string;
};

export function loadActiveAttentionEvaluationDataset(
  input: unknown,
  configInput: unknown = configArtifact
): ActiveAttentionEvaluationDataset {
  const config = activeAttentionEvaluationConfigSchema.parse(configInput);
  const dataset = activeAttentionEvaluationDatasetSchema.parse(input);
  if (dataset.resolverConfig.sha256 !== sha256Canonical(config)) {
    throw new TypeError(
      "Active Attention resolver config integrity check failed."
    );
  }
  return dataset;
}

export const activeAttentionEvaluationConfig =
  activeAttentionEvaluationConfigSchema.parse(configArtifact);
export const ACTIVE_ATTENTION_CONFIG_SHA256 = sha256Canonical(
  activeAttentionEvaluationConfig
);
export const activeAttentionEvaluationDataset =
  loadActiveAttentionEvaluationDataset(
    applyActiveAttentionExpectationRevision(
      datasetArtifact,
      expectationRevisionArtifact
    )
  );
export const ACTIVE_ATTENTION_DATASET_SHA256 = sha256Canonical(
  activeAttentionEvaluationDataset
);

function applyActiveAttentionExpectationRevision(
  baseInput: unknown,
  revisionInput: unknown
): unknown {
  const base = z
    .object({
      datasetVersion: z.literal(
        "suggestion-active-attention-dev-v0.1"
      ),
      datasetRevision: z.literal(2)
    })
    .passthrough()
    .parse(baseInput);
  const revision = z
    .object({
      contract: z.literal(
        "active-attention-expectation-revision-v0.1"
      ),
      baseDatasetVersion: z.literal(base.datasetVersion),
      baseDatasetRevision: z.literal(base.datasetRevision),
      baseDatasetSha256: sha256Schema,
      datasetVersion: z.literal(
        "suggestion-active-attention-dev-v0.2"
      ),
      datasetRevision: z.literal(3),
      reason: z.literal(
        "active-attention-v0.5-versioned-output-rebaseline"
      ),
      expectedResultSha256ByCase: z.record(
        z.string().regex(/^ACTIVE-DEV-[0-9]{3}$/),
        sha256Schema.nullable()
      )
    })
    .strict()
    .parse(revisionInput);
  if (sha256Canonical(baseInput) !== revision.baseDatasetSha256) {
    throw new TypeError(
      "Active Attention expectation revision base dataset hash mismatch."
    );
  }
  return {
    ...base,
    datasetVersion: revision.datasetVersion,
    datasetRevision: revision.datasetRevision,
    expectedResultSha256ByCase:
      revision.expectedResultSha256ByCase
  };
}

export function runActiveAttentionDecisionEvaluation(input?: {
  startedAt?: Date;
  completedAt?: Date;
  code?: ActiveAttentionDecisionEvaluationRecord["code"];
  dataset?: ActiveAttentionEvaluationDataset;
}): ActiveAttentionDecisionEvaluationRecord {
  const startedAt = input?.startedAt ?? new Date();
  const dataset = input?.dataset ?? activeAttentionEvaluationDataset;
  const configIntegrityFailureCount =
    dataset.resolverConfig.sha256 === ACTIVE_ATTENTION_CONFIG_SHA256
      ? 0
      : 1;
  const executed = dataset.cases.map((evaluationCase) =>
    executeCase(
      evaluationCase,
      dataset.expectedResultSha256ByCase[evaluationCase.caseId] ?? null
    )
  );
  const cases = executed.map((item) => item.result);
  const metrics = computeMetrics(
    executed,
    dataset,
    configIntegrityFailureCount
  );
  const errors = cases
    .filter((item) => !item.passed)
    .map((item) => ({
      caseId: item.caseId,
      code: "ACTIVE_ATTENTION_EXACT_MISMATCH" as const
    }));
  const materializedInputSha256 = sha256Canonical(
    cases.map((item) => ({
      caseId: item.caseId,
      materializedInputSha256: item.materializedInputSha256
    }))
  );
  const deterministicOutputSha256 = sha256Canonical({
    datasetSha256: sha256Canonical(dataset),
    materializedInputSha256,
    versions: activeAttentionVersions(),
    metrics,
    cases
  });
  const completedAt = input?.completedAt ?? new Date();
  const runId = `active_attention_eval_run_${randomBytes(16).toString("hex")}`;
  const status =
    errors.length === 0 && activeAttentionReleaseGatesPass(metrics)
      ? ("passed" as const)
      : ("failed" as const);
  const aggregateBreakdown = {
    caseCount: metrics.caseCount,
    exactCasePassCount: metrics.exactCasePassCount,
    exactCasePassRate: metrics.exactCasePassRate
  };
  const recordPayload = {
    contract: ACTIVE_ATTENTION_EVALUATION_RUN_RECORD_CONTRACT,
    runId,
    comparisonRunId: null,
    comparisonReason:
      "TARGETED_PHASE4B_DEV_CANDIDATE_BASELINE",
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    latencyMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    dataset: {
      version: dataset.datasetVersion,
      revision: dataset.datasetRevision,
      class: dataset.datasetClass,
      split: "development" as const,
      lifecycle: dataset.lifecycle.state,
      inputBoundary: dataset.inputBoundary,
      dataOrigin: dataset.dataOrigin,
      containsProductionData: dataset.containsProductionData,
      canonicalSha256: sha256Canonical(dataset),
      materializedInputSha256,
      includedCaseCount: dataset.cases.length,
      excludedCaseCount: 0
    },
    scope: {
      task: "active_attention_decision" as const,
      contextMode:
        "exact_phase4b_replayable_evidence_envelope" as const,
      caseIds: dataset.cases.map((item) => item.caseId),
      fieldScope: [
        "decision_status",
        "decision_route",
        "candidate_lane",
        "candidate_rank",
        "deduplication",
        "fail_closed_integrity"
      ] as const,
      includedCaseCount: dataset.cases.length,
      excludedCaseCount: 0 as const
    },
    versions: activeAttentionVersions(),
    resolverConfig: dataset.resolverConfig,
    code: input?.code ?? {
      commitSha: null,
      state: "unavailable",
      fingerprintSha256: null
    },
    inference: {
      provider: "not_applicable",
      model: "not_applicable",
      promptVersion: "not_applicable",
      judgeProvider: "not_applicable",
      judgeModel: "not_applicable",
      judgePromptVersion: "not_applicable",
      candidateJudgeSameModelFamily: "not_applicable",
      guardrailVersion: "active-attention-deterministic-gates-v0.1",
      tokenUsage: "not_applicable"
    },
    runtimeConfig: {
      contextLimit: "not_applicable" as const,
      segmentation: "not_applicable" as const,
      concurrency: 1 as const,
      retryCount: 0 as const
    },
    metrics,
    breakdowns: {
      byTask: {
        active_attention_decision: aggregateBreakdown
      },
      byContextMode: {
        exact_phase4b_replayable_evidence_envelope:
          aggregateBreakdown
      }
    },
    review: {
      automaticReviewStatus: status,
      humanReviewStatus: "not_reviewed" as const,
      qualityClaim: "development_contract_only" as const
    },
    cases,
    deterministicOutputSha256,
    errors,
    privacy: {
      classification: "synthetic_sanitized_metadata",
      productionDataUsed: false,
      rawCandidatePayloadStored: false,
      promptAnswerCommandOutputPathOrThreadStored: false,
      retention: "local_evaluation_record_only"
    },
    limitations: [
      "mutable_dev_candidate_not_human_gold",
      "synthetic_cases_do_not_estimate_production_generalization",
      "no_locked_holdout_evaluated"
    ] as const,
    warnings: [] as [],
    acceptedExceptions: [] as []
  } satisfies Omit<ActiveAttentionDecisionEvaluationRecord, "artifact">;
  return {
    ...recordPayload,
    artifact: {
      relativePath: `.local/evaluations/active-attention/${runId}.json`,
      hashAlgorithm: "sha256",
      hashScope:
        "canonical_record_payload_excluding_artifact_descriptor",
      canonicalPayloadSha256: sha256Canonical(recordPayload)
    }
  };
}

export function activeAttentionReleaseGatesPass(
  metrics: ActiveAttentionDecisionEvaluationMetrics
): boolean {
  const zeroGuardrails = [
    metrics.resultHashMismatchCount,
    metrics.resultSchemaErrorCount,
    metrics.wrongDecisionStatusCount,
    metrics.wrongReviewRouteCount,
    metrics.wrongLaneOrRankCount,
    metrics.phase2FourPlusRankTruncationCount,
    metrics.weeklyFocusReasonLossCount,
    metrics.managedFocusPriorityFailureCount,
    metrics.unsafeCandidateLeakageCount,
    metrics.recoveredFailureLeakageCount,
    metrics.unhealthyHistoryCandidateLeakageCount,
    metrics.workflowlessFollowThroughLeakageCount,
    metrics.archivedProjectWorkflowLeakageCount,
    metrics.workflowActionTargetCompatibilityLeakageCount,
    metrics.retroactiveWorkflowLeakageCount,
    metrics.gracePeriodLeakageCount,
    metrics.closedWorkflowLeakageCount,
    metrics.artifactDuplicateLeakageCount,
    metrics.duplicateOpenLoopLeakageCount,
    metrics.refreshBeforeUserReviewFailureCount,
    metrics.standaloneUserReviewFailureCount,
    metrics.eligibleBeforeUserReviewFailureCount,
    metrics.unavailableCoverageNoActionLeakageCount,
    metrics.inactiveLinkCandidateLeakageCount,
    metrics.scopedNoActionFailureCount,
    metrics.inputIntegrityFailOpenCount,
    metrics.evidenceGraphFailOpenCount,
    metrics.upstreamBoundaryLeakageCount,
    metrics.privacyInputBoundaryAbsenceCount,
    metrics.privacySentinelLeakageCount,
    metrics.rawCodexFieldLeakageCount,
    metrics.canonicalOrderingFailureCount,
    metrics.determinismFailureCount,
    metrics.configIntegrityFailureCount
  ];
  return (
    metrics.caseCount === CASE_COUNT &&
    metrics.exactCasePassCount === metrics.caseCount &&
    metrics.assessmentPrecision === 1 &&
    metrics.assessmentRecall === 1 &&
    zeroGuardrails.every((value) => value === 0)
  );
}

function executeCase(
  evaluationCase: ActiveAttentionEvaluationCase,
  expectedResultSha256: string | null
): ExecutedCase {
  const fixture = buildActiveAttentionEvaluationFixture(
    evaluationCase.scenario
  );
  const inputSerialized = JSON.stringify(fixture.input);
  const materializedInputSha256 = sha256Canonical(fixture.input);
  let activeResult: ActiveAttentionResult | null = null;
  let error: ExpectedSummary["error"] = null;
  let repeatResultSha256: string | null = null;
  let repeatError: ExpectedSummary["error"] = null;
  try {
    activeResult = resolveActiveAttention(fixture.input);
  } catch (caught) {
    error = classifyError(caught);
  }
  try {
    const repeatedFixture = buildActiveAttentionEvaluationFixture(
      evaluationCase.scenario
    );
    repeatResultSha256 = resolveActiveAttention(
      repeatedFixture.input
    ).resultSha256;
  } catch (caught) {
    repeatError = classifyError(caught);
  }

  const expected = canonicalSummary(evaluationCase.expected);
  const actual = summarizeActiveResult(activeResult, error);
  const expectedSummarySha256 = sha256Canonical(expected);
  const actualSummarySha256 = sha256Canonical(actual);
  const resultSha256 = activeResult?.resultSha256 ?? null;
  return {
    result: {
      caseId: evaluationCase.caseId,
      scenario: evaluationCase.scenario,
      labels: [...evaluationCase.labels].sort(),
      passed:
        expectedSummarySha256 === actualSummarySha256 &&
        expectedResultSha256 === resultSha256,
      materializedInputSha256,
      expectedSummarySha256,
      actualSummarySha256,
      expectedResultSha256,
      resultSha256,
      expected,
      actual
    },
    activeResult,
    repeatResultSha256,
    repeatError,
    privacySentinels: fixture.privateSentinels,
    inputSerialized,
    resultSerialized: JSON.stringify(activeResult)
  };
}

function summarizeActiveResult(
  result: ActiveAttentionResult | null,
  error: ExpectedSummary["error"]
): ExpectedSummary {
  if (!result) {
    return canonicalSummary({
      error,
      decisionStatus: null,
      decisionReasonCodes: [],
      topCandidate: null,
      rankedCandidateOrder: [],
      assessmentOutcomes: []
    });
  }
  const top = result.decision.topSuggestion;
  return canonicalSummary({
    error,
    decisionStatus: result.decision.status,
    decisionReasonCodes: [...result.decision.reasonCodes],
    topCandidate: top
      ? {
          triggerSource: top.triggerSource,
          triggerKind: top.triggerKind,
          lane: top.lane,
          intervention: top.intervention,
          workflowActionKind: top.workflowActionKind
        }
      : null,
    rankedCandidateOrder: result.rankedCandidates.map(candidateKey),
    assessmentOutcomes: result.assessments.map(assessmentOutcome)
  });
}

function canonicalSummary(input: ExpectedSummary): ExpectedSummary {
  return {
    ...input,
    decisionReasonCodes: [...input.decisionReasonCodes].sort(),
    rankedCandidateOrder: [...input.rankedCandidateOrder],
    assessmentOutcomes: [...input.assessmentOutcomes].sort()
  };
}

function candidateKey(
  candidate: ActiveAttentionResult["rankedCandidates"][number]
): string {
  return [
    candidate.triggerSource,
    candidate.triggerKind,
    candidate.lane,
    candidate.intervention,
    candidate.workflowActionKind ?? "none"
  ].join(":");
}

function topCandidateKey(
  candidate: z.infer<typeof topCandidateSchema>
): string {
  return [
    candidate.triggerSource,
    candidate.triggerKind,
    candidate.lane,
    candidate.intervention,
    candidate.workflowActionKind ?? "none"
  ].join(":");
}

function assessmentOutcome(
  assessment: ActiveAttentionResult["assessments"][number]
): string {
  return [
    assessment.triggerSource,
    assessment.triggerKind,
    assessment.status,
    assessment.reviewRoute,
    ...assessment.reasonCodes
  ].join(":");
}

function classifyError(caught: unknown): ExpectedSummary["error"] {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/input hash does not match/iu.test(message)) {
    return "INPUT_INTEGRITY_REJECTED";
  }
  if (/exact replayable evidence graph/iu.test(message)) {
    return "EXACT_EVIDENCE_GRAPH_REJECTED";
  }
  return "CASE_EXECUTION_FAILED";
}

function computeMetrics(
  executed: ExecutedCase[],
  dataset: ActiveAttentionEvaluationDataset,
  configIntegrityFailureCount: number
): ActiveAttentionDecisionEvaluationMetrics {
  const expectedAssessmentKeys = executed.flatMap((item) =>
    item.result.expected.assessmentOutcomes.map(
      (outcome) => `${item.result.caseId}:${outcome}`
    )
  );
  const observedAssessmentKeys = executed.flatMap((item) =>
    item.result.actual.assessmentOutcomes.map(
      (outcome) => `${item.result.caseId}:${outcome}`
    )
  );
  const truePositives = multisetMatches(
    expectedAssessmentKeys,
    observedAssessmentKeys
  );
  const successfulResults = executed.filter(
    (item) => item.activeResult !== null
  );
  const resultSchemaPassCount = successfulResults.filter((item) =>
    verifyActiveAttentionResultIntegrity(item.activeResult)
  ).length;
  return {
    caseCount: executed.length,
    exactCasePassCount: executed.filter((item) => item.result.passed).length,
    exactCasePassRate: ratio(
      executed.filter((item) => item.result.passed).length,
      executed.length
    ),
    expectedAssessmentCount: expectedAssessmentKeys.length,
    observedAssessmentCount: observedAssessmentKeys.length,
    assessmentPrecision: ratio(truePositives, observedAssessmentKeys.length),
    assessmentRecall: ratio(truePositives, expectedAssessmentKeys.length),
    resultSchemaPassRate: ratio(
      resultSchemaPassCount,
      successfulResults.length
    ),
    resultSchemaErrorCount:
      successfulResults.length - resultSchemaPassCount,
    resultHashMismatchCount: executed.filter(
      (item) =>
        item.result.expectedResultSha256 !== item.result.resultSha256
    ).length,
    wrongDecisionStatusCount: executed.filter(
      (item) =>
        item.result.expected.decisionStatus !==
        item.result.actual.decisionStatus
    ).length,
    wrongReviewRouteCount: executed.reduce(
      (count, item) =>
        count +
        multisetDifference(
          item.result.expected.assessmentOutcomes.map(routeKey),
          item.result.actual.assessmentOutcomes.map(routeKey)
        ),
      0
    ),
    wrongLaneOrRankCount: executed.filter(
      (item) =>
        item.result.expected.rankedCandidateOrder.join("|") !==
        item.result.actual.rankedCandidateOrder.join("|")
    ).length,
    phase2FourPlusRankTruncationCount: countCases(
      executed,
      "phase2_four_plus_rank_guard",
      (item) => item.result.actual.rankedCandidateOrder.length < 5
    ),
    weeklyFocusReasonLossCount: countCases(
      executed,
      "weekly_focus_reason_guard",
      (item) =>
        !item.activeResult?.decision.topSuggestion?.whyNowReasonCodes.includes(
          "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
        )
    ),
    managedFocusPriorityFailureCount: countCases(
      executed,
      "managed_focus_priority_guard",
      (item) => {
        const top = item.activeResult?.decision.topSuggestion;
        return (
          top?.triggerKind !== "managed_failure" ||
          !top.whyNowReasonCodes.includes(
            "WHY_NOW_PRIMARY_OUTCOME_TEXT_MATCH"
          ) ||
          item.result.actual.rankedCandidateOrder.filter((candidate) =>
            candidate.startsWith("codex_managed:managed_failure:")
          ).length < 2
        );
      }
    ),
    unsafeCandidateLeakageCount: countCases(
      executed,
      "hard_negative",
      (item) =>
        item.result.expected.decisionStatus !== "suggested" &&
        item.result.actual.decisionStatus === "suggested"
    ),
    recoveredFailureLeakageCount: countCases(
      executed,
      "recovery_guard",
      hasManagedCandidate
    ),
    unhealthyHistoryCandidateLeakageCount: countCases(
      executed,
      "refresh_route",
      (item) => item.result.actual.rankedCandidateOrder.length > 0
    ),
    workflowlessFollowThroughLeakageCount: countCases(
      executed,
      "workflow_absence_guard",
      hasFollowThroughCandidate
    ),
    archivedProjectWorkflowLeakageCount: countCases(
      executed,
      "archived_project_guard",
      (item) =>
        hasFollowThroughCandidate(item) ||
        !item.result.actual.assessmentOutcomes.some((outcome) =>
          outcome.includes("INELIGIBLE_FOLLOW_THROUGH_NOT_CONFIGURED")
        )
    ),
    workflowActionTargetCompatibilityLeakageCount: countCases(
      executed,
      "workflow_target_guard",
      (item) =>
        hasFollowThroughCandidate(item) ||
        !item.result.actual.assessmentOutcomes.some((outcome) =>
          outcome.includes(
            "INELIGIBLE_WORKFLOW_ACTION_TARGET_INCOMPATIBLE"
          )
        )
    ),
    retroactiveWorkflowLeakageCount: countCases(
      executed,
      "nonretroactive_guard",
      hasFollowThroughCandidate
    ),
    gracePeriodLeakageCount: countCases(
      executed,
      "grace_guard",
      hasFollowThroughCandidate
    ),
    closedWorkflowLeakageCount: countCases(
      executed,
      "closure_guard",
      hasFollowThroughCandidate
    ),
    artifactDuplicateLeakageCount: countCases(
      executed,
      "artifact_guard",
      hasFollowThroughCandidate
    ),
    duplicateOpenLoopLeakageCount: countCases(
      executed,
      "dedupe_guard",
      (item) =>
        item.result.actual.rankedCandidateOrder.length !==
          item.result.expected.rankedCandidateOrder.length ||
        !item.result.actual.assessmentOutcomes.some((outcome) =>
          outcome.includes("INELIGIBLE_DUPLICATE_OPEN_LOOP")
        )
    ),
    refreshBeforeUserReviewFailureCount: countCases(
      executed,
      "refresh_before_user_review",
      (item) =>
        item.result.actual.decisionStatus !== "insufficient_evidence" ||
        !item.result.actual.decisionReasonCodes.includes(
          "DECISION_REFRESH_REQUIRED"
        )
    ),
    standaloneUserReviewFailureCount: countCases(
      executed,
      "standalone_user_review",
      (item) =>
        item.result.actual.decisionStatus !== "needs_clarification" ||
        !item.result.actual.decisionReasonCodes.includes(
          "DECISION_USER_CLARIFICATION_REQUIRED"
        )
    ),
    eligibleBeforeUserReviewFailureCount: countCases(
      executed,
      "eligible_before_user_review",
      (item) => item.result.actual.decisionStatus !== "suggested"
    ),
    unavailableCoverageNoActionLeakageCount: countCases(
      executed,
      "unavailable_source",
      (item) => item.result.actual.decisionStatus === "no_action"
    ),
    inactiveLinkCandidateLeakageCount: countCases(
      executed,
      "link_guard",
      (item) =>
        item.result.actual.rankedCandidateOrder.some((candidate) =>
          candidate.startsWith("codex_managed:")
        )
    ),
    scopedNoActionFailureCount: dataset.cases
      .filter((item) => item.labels.includes("no_action"))
      .filter((evaluationCase) => {
        const item = executed.find(
          (candidate) => candidate.result.caseId === evaluationCase.caseId
        );
        return (
          !item?.activeResult ||
          item.activeResult.decision.status !== "no_action" ||
          item.activeResult.decision.certainty !== "scoped" ||
          !item.activeResult.coverage.negativeCandidateCoverageComplete
        );
      }).length,
    inputIntegrityFailOpenCount: countCases(
      executed,
      "input_hash_guard",
      (item) => item.result.actual.error !== "INPUT_INTEGRITY_REJECTED"
    ),
    evidenceGraphFailOpenCount: countCases(
      executed,
      "evidence_graph_guard",
      (item) =>
        item.result.actual.error !== "EXACT_EVIDENCE_GRAPH_REJECTED"
    ),
    upstreamBoundaryLeakageCount: executed.filter((item) => {
      const result = item.activeResult;
      return (
        result !== null &&
        (!result.upstreamGuards.eligibility.forbiddenAsAttentionCandidate ||
          !result.upstreamGuards.managedPublic
            .everyRunForbiddenAsAttentionCandidate ||
          !result.upstreamGuards.managedSemantic
            .everyRunForbiddenAsAttentionCandidate ||
          !result.upstreamGuards.workRelations
            .forbiddenAsAttentionCandidate ||
          !result.upstreamGuards.artifacts.forbiddenAsAttentionCandidate ||
          !result.upstreamGuards.claims.forbiddenAsAttentionCandidate ||
          result.rankedCandidates.some(
            (candidate) =>
              !candidate.upstreamObjectsRemainForbidden ||
              candidate.attentionDisposition !== "active_candidate"
          ))
      );
    }).length,
    privacyInputBoundaryAbsenceCount: countCases(
      executed,
      "privacy_guard",
      (item) =>
        item.privacySentinels.length === 0 ||
        item.privacySentinels.some(
          (sentinel) => !item.inputSerialized.includes(sentinel)
        )
    ),
    privacySentinelLeakageCount: executed.filter((item) =>
      item.privacySentinels.some((sentinel) =>
        item.resultSerialized.includes(sentinel)
      )
    ).length,
    rawCodexFieldLeakageCount: executed.filter((item) =>
      RAW_CODEX_FIELD_PATTERNS.some((pattern) =>
        pattern.test(item.resultSerialized)
      )
    ).length,
    canonicalOrderingFailureCount: executed.filter((item) => {
      const ids =
        item.activeResult?.assessments.map(
          (assessment) => assessment.assessmentId
        ) ?? [];
      return ids.join("|") !== [...ids].sort().join("|");
    }).length,
    determinismFailureCount: executed.filter(
      (item) =>
        item.repeatResultSha256 !== item.result.resultSha256 ||
        item.repeatError !== item.result.actual.error ||
        (item.activeResult !== null &&
          !verifyActiveAttentionResultIntegrity(item.activeResult))
    ).length,
    configIntegrityFailureCount
  };
}

const RAW_CODEX_FIELD_PATTERNS = [
  /"(?:prompt|answer|command|output|filePath|reasoning|threadId)"\s*:/u
] as const;

function routeKey(outcome: string): string {
  const [source, kind, _status, route] = outcome.split(":");
  return `${source}:${kind}:${route}`;
}

function hasManagedCandidate(item: ExecutedCase): boolean {
  return item.result.actual.rankedCandidateOrder.some((candidate) =>
    candidate.startsWith("codex_managed:managed_failure:")
  );
}

function hasFollowThroughCandidate(item: ExecutedCase): boolean {
  return item.result.actual.rankedCandidateOrder.some((candidate) =>
    candidate.startsWith("codex_managed:configured_follow_through:")
  );
}

function countCases(
  executed: ExecutedCase[],
  label: string,
  predicate: (item: ExecutedCase) => boolean
): number {
  return executed.filter(
    (item) => item.result.labels.includes(label) && predicate(item)
  ).length;
}

function multisetMatches(left: string[], right: string[]): number {
  const remaining = [...right];
  let matches = 0;
  for (const value of left) {
    const index = remaining.indexOf(value);
    if (index === -1) continue;
    matches += 1;
    remaining.splice(index, 1);
  }
  return matches;
}

function multisetDifference(expected: string[], actual: string[]): number {
  return Math.max(expected.length, actual.length) -
    multisetMatches(expected, actual);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function activeAttentionVersions() {
  return {
    datasetSchemaVersion: ACTIVE_ATTENTION_EVALUATION_CASE_SCHEMA_VERSION,
    inputContract: ACTIVE_ATTENTION_INPUT_CONTRACT,
    resultContract: ACTIVE_ATTENTION_RESULT_CONTRACT,
    policyVersion: ACTIVE_ATTENTION_POLICY_VERSION,
    candidateRuleVersion: ACTIVE_ATTENTION_CANDIDATE_RULE_VERSION,
    lanePolicyVersion: ACTIVE_ATTENTION_LANE_POLICY_VERSION,
    rankingPolicyVersion: ACTIVE_ATTENTION_RANKING_POLICY_VERSION,
    resolverVersion: ACTIVE_ATTENTION_RESOLVER_VERSION,
    idPolicyVersion: ACTIVE_ATTENTION_ID_POLICY_VERSION,
    guardrailVersion: "active-attention-deterministic-gates-v0.1" as const
  };
}
