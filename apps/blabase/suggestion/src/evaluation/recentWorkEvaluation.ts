import { randomBytes } from "node:crypto";

import { z } from "zod";

import configArtifact from "../../eval/synthetic/recentWorkProjectionConfig.v0.1.json";
import datasetArtifact from "../../eval/synthetic/recentWorkProjectionCases.v0.1.json";
import {
  buildRecentWorkEvaluationFixture,
  recentWorkEvaluationConfigSchema,
  recentWorkEvaluationDatasetSchema,
  type RecentWorkEvaluationCaseDefinition,
  type RecentWorkEvaluationVariantFixture
} from "../../eval/synthetic/recentWorkCaseBuilder";
import { createGitHubArtifactId } from "../artifacts";
import { evaluateAttentionSnapshots } from "../attention/liveAttention";
import {
  CODEX_LOCAL_GIT_COLLECTOR_VERSION,
  CODEX_LOCAL_GIT_SNAPSHOT_SCHEMA_VERSION,
  CODEX_LOCAL_GIT_UPSTREAM_BASIS,
  createCodexLocalGitGitHubRepositoryKey,
  sealCodexLocalGitSnapshot
} from "../connectors/codex/localGitContracts";
import {
  type CodexSnapshot,
  type StoredCodexConfig
} from "../connectors/codex/types";
import { emptyCodexContentManifest } from "../connectors/codex/conversationContract";
import type {
  GitHubSnapshot,
  GitHubTaskSignal,
  GitHubUserActivitySignal
} from "../connectors/github/types";
import {
  confirmProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity
} from "../context";
import {
  WORK_CONTEXT_REGISTRY_CONTRACT,
  WORK_CONTEXT_REGISTRY_SCHEMA_VERSION
} from "../context/contracts";
import {
  ACTIVE_ATTENTION_INPUT_CONTRACT,
  ACTIVE_ATTENTION_RESOLVER_VERSION,
  ACTIVE_ATTENTION_RESULT_CONTRACT,
  RECENT_MEANINGFUL_EVENT_RULE_VERSION
} from "../crossSource/versions";
import { LAUNCHER_ATTENTION_CONTRACT } from "../launcher/contracts";
import { projectAttentionForLauncher } from "../launcher/projection";
import {
  RECENT_WORK_FOCUS_MAX_AGE_MS,
  RECENT_WORK_LOCAL_GIT_MAX_AGE_MS,
  RECENT_WORK_MAX_FUTURE_SKEW_MS,
  RECENT_WORK_PROJECTION_CONTRACT,
  RECENT_WORK_RESOLVER_VERSION,
  RECENT_WORK_SCHEMA_VERSION,
  projectRecentWorkPublicSummary,
  resolveRecentWork,
  resolveRecentWorkPresentationMode
} from "../recentWork";
import { sha256Canonical } from "./crossSourceIntegrity";

export const RECENT_WORK_EVALUATION_RUN_RECORD_CONTRACT =
  "recent-work-projection-evaluation-run-v0.2" as const;
export const RECENT_WORK_EVALUATION_POLICY_VERSION =
  "recent-work-projection-evaluation-policy-v0.2" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const runIdSchema = z.string().regex(/^recent_work_run_[a-f0-9]{32}$/u);
const trackingStateSchema = z.enum([
  "in_sync",
  "ahead",
  "behind",
  "diverged",
  "not_configured"
]);
const measurementStatusSchema = z.enum([
  "measured",
  "not_measured",
  "error"
]);
const variantMeasurementReasonSchema = z
  .enum(["CASE_EXECUTION_FAILED", "CASE_NOT_MEASURED"])
  .nullable();
const integrationMeasurementReasonSchema = z
  .enum([
    "PROBE_FIXTURE_MATERIALIZATION_FAILED",
    "PROBE_EXECUTION_FAILED",
    "PROBE_NOT_MEASURED"
  ])
  .nullable();
const nullableBooleanSchema = z.boolean().nullable();
const nullableCountSchema = z.number().int().nonnegative().nullable();

const recentWorkVariantResultSchema = z
  .object({
    variantId: z.string().regex(/^[a-z0-9-]{1,80}$/u),
    status: z.enum(["passed", "failed"]),
    measurementStatus: measurementStatusSchema,
    errorReason: variantMeasurementReasonSchema,
    inputSha256: sha256Schema,
    projectionStatus: z.enum(["matched", "unavailable", "error"]),
    reasonCode: z.string().min(1).max(160).nullable(),
    presentationMode: z.enum(["shadow", "present"]),
    summaryProjected: z.boolean(),
    publicPushOccurredAt: z.string().datetime({ precision: 3 }).nullable(),
    trackingState: trackingStateSchema.nullable(),
    aheadCount: z.number().int().min(0).max(100_000).nullable(),
    behindCount: z.number().int().min(0).max(100_000).nullable(),
    projectionSha256: sha256Schema.nullable(),
    publicSummarySha256: sha256Schema.nullable(),
    deterministic: nullableBooleanSchema,
    privacyLeakageCount: nullableCountSchema,
    recentWorkEffectViolation: nullableBooleanSchema,
    assertionFailures: z.array(z.string().min(1).max(120)).max(20)
  })
  .strict()
  .superRefine((variant, context) => {
    const measured = variant.measurementStatus === "measured";
    const measurements = [
      variant.deterministic,
      variant.privacyLeakageCount,
      variant.recentWorkEffectViolation
    ];
    if (measured) {
      if (!measurements.every((value) => value !== null)) {
        addIssue(context, ["measurementStatus"], "Measured variant fields must all be present.");
      }
      if (variant.errorReason !== null) {
        addIssue(context, ["errorReason"], "A measured variant cannot carry an error reason.");
      }
      if (variant.projectionStatus === "error") {
        addIssue(context, ["projectionStatus"], "A measured variant requires a resolver result.");
      }
      if (variant.reasonCode === null) {
        addIssue(context, ["reasonCode"], "A measured projection requires its bounded reason code.");
      }
      if (variant.projectionSha256 === null) {
        addIssue(context, ["projectionSha256"], "A measured projection requires its canonical hash.");
      }
      if (variant.projectionStatus === "unavailable") {
        if (variant.summaryProjected) {
          addIssue(context, ["summaryProjected"], "An unavailable projection cannot publish a summary.");
        }
        for (const [path, value] of [
          ["publicPushOccurredAt", variant.publicPushOccurredAt],
          ["trackingState", variant.trackingState],
          ["aheadCount", variant.aheadCount],
          ["behindCount", variant.behindCount],
          ["publicSummarySha256", variant.publicSummarySha256]
        ] as const) {
          if (value !== null) {
            addIssue(context, [path], "Unavailable projection-derived fields must be null.");
          }
        }
      }
      if (variant.projectionStatus === "matched") {
        if (variant.trackingState === null) {
          addIssue(context, ["trackingState"], "A matched projection requires a tracking state.");
        }
        const expectsTrackingCounts =
          variant.trackingState !== null &&
          variant.trackingState !== "not_configured";
        if (expectsTrackingCounts) {
          if (variant.aheadCount === null) {
            addIssue(context, ["aheadCount"], "A tracked match requires aheadCount.");
          }
          if (variant.behindCount === null) {
            addIssue(context, ["behindCount"], "A tracked match requires behindCount.");
          }
        } else if (variant.aheadCount !== null || variant.behindCount !== null) {
          addIssue(context, ["aheadCount"], "An unconfigured match cannot claim tracking counts.");
        }
        const shouldProjectSummary = variant.presentationMode === "present";
        if (variant.summaryProjected !== shouldProjectSummary) {
          addIssue(context, ["summaryProjected"], "Matched summary disposition contradicts presentation mode.");
        }
        if (shouldProjectSummary) {
          if (variant.publicPushOccurredAt === null) {
            addIssue(context, ["publicPushOccurredAt"], "A presented match requires its public timestamp.");
          }
          if (variant.publicSummarySha256 === null) {
            addIssue(context, ["publicSummarySha256"], "A presented match requires its public summary hash.");
          }
        } else {
          if (variant.publicPushOccurredAt !== null) {
            addIssue(context, ["publicPushOccurredAt"], "A shadow match cannot publish its timestamp.");
          }
          if (variant.publicSummarySha256 !== null) {
            addIssue(context, ["publicSummarySha256"], "A shadow match cannot publish a summary hash.");
          }
        }
      }
    } else {
      if (!measurements.every((value) => value === null)) {
        addIssue(context, ["measurementStatus"], "Unmeasured variant fields must all be null.");
      }
      const expectedReason =
        variant.measurementStatus === "error"
          ? "CASE_EXECUTION_FAILED"
          : "CASE_NOT_MEASURED";
      if (variant.errorReason !== expectedReason) {
        addIssue(context, ["errorReason"], "Variant measurement reason is missing or contradictory.");
      }
      if (variant.projectionStatus !== "error") {
        addIssue(context, ["projectionStatus"], "An unmeasured variant must use the error projection state.");
      }
      if (variant.summaryProjected) {
        addIssue(context, ["summaryProjected"], "An unmeasured variant cannot claim a projected summary.");
      }
      for (const [path, value] of [
        ["reasonCode", variant.reasonCode],
        ["publicPushOccurredAt", variant.publicPushOccurredAt],
        ["trackingState", variant.trackingState],
        ["aheadCount", variant.aheadCount],
        ["behindCount", variant.behindCount],
        ["projectionSha256", variant.projectionSha256],
        ["publicSummarySha256", variant.publicSummarySha256]
      ] as const) {
        if (value !== null) {
          addIssue(context, [path], "Unmeasured projection-derived fields must be null.");
        }
      }
    }
    const expectedStatus =
      measured && variant.assertionFailures.length === 0 ? "passed" : "failed";
    if (variant.status !== expectedStatus) {
      addIssue(context, ["status"], "Variant status does not match assertions.");
    }
    if (variant.summaryProjected !== (variant.publicSummarySha256 !== null)) {
      addIssue(context, ["publicSummarySha256"], "Summary hash presence is contradictory.");
    }
  });

const recentWorkCaseResultSchema = z
  .object({
    caseId: z.string().regex(/^RW-PROJ-DEV-[0-9]{3}$/u),
    scenario: z.string().min(1).max(120),
    labels: z.array(z.string().min(1).max(80)).max(20),
    evaluationKind: z.enum([
      "runtime",
      "boundary_matrix",
      "upstream_filtered_runtime",
      "state_matrix",
      "invariant"
    ]),
    upstreamMappingState: z.enum([
      "not_applicable",
      "removed",
      "archived"
    ]),
    status: z.enum(["passed", "failed"]),
    measurementStatus: measurementStatusSchema,
    inputSha256: sha256Schema,
    variantCount: z.number().int().min(1).max(4),
    deterministic: nullableBooleanSchema,
    privacyLeakageCount: nullableCountSchema,
    recentWorkEffectViolation: nullableBooleanSchema,
    variants: z.array(recentWorkVariantResultSchema).min(1).max(4)
  })
  .strict()
  .superRefine((record, context) => {
    const complete = record.variants.every(
      (variant) => variant.measurementStatus === "measured"
    );
    const expectedMeasurementStatus = complete
      ? "measured"
      : record.variants.some((variant) => variant.measurementStatus === "error")
        ? "error"
        : "not_measured";
    if (record.measurementStatus !== expectedMeasurementStatus) {
      addIssue(context, ["measurementStatus"], "Case measurement status is contradictory.");
    }
    if (record.variantCount !== record.variants.length) {
      addIssue(context, ["variantCount"], "Case variant count is contradictory.");
    }
    const expectedStatus =
      complete && record.variants.every((variant) => variant.status === "passed")
        ? "passed"
        : "failed";
    if (record.status !== expectedStatus) {
      addIssue(context, ["status"], "Case status is contradictory.");
    }
    const expectedDeterministic = complete
      ? record.variants.every((variant) => variant.deterministic === true)
      : null;
    const expectedPrivacy = complete
      ? record.variants.reduce(
          (sum, variant) => sum + (variant.privacyLeakageCount ?? 0),
          0
        )
      : null;
    const expectedEffect = complete
      ? record.variants.some(
          (variant) => variant.recentWorkEffectViolation === true
        )
      : null;
    if (
      record.deterministic !== expectedDeterministic ||
      record.privacyLeakageCount !== expectedPrivacy ||
      record.recentWorkEffectViolation !== expectedEffect
    ) {
      addIssue(context, ["measurementStatus"], "Case aggregate measurements are contradictory.");
    }
  });

const activeIntegrationSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    measurementStatus: measurementStatusSchema,
    errorReason: integrationMeasurementReasonSchema,
    inputSha256: sha256Schema.nullable(),
    materializedUpstreamFields: z.array(z.string().min(1).max(160)).length(7),
    sourceBoundaryDerivedFields: z.array(z.string().min(1).max(160)).length(1),
    unrepresentableDirectResolverFields: z
      .array(z.string().min(1).max(160))
      .length(3),
    publicSurfaceNames: z.array(z.string().min(1).max(120)).length(6),
    publicSurfaceSha256: sha256Schema.nullable(),
    activeCandidateCount: nullableCountSchema,
    assessmentCount: nullableCountSchema,
    shadowRecentWorkMatched: nullableBooleanSchema,
    presentRecentWorkMatched: nullableBooleanSchema,
    recentWorkEqual: nullableBooleanSchema,
    shadowPublicSummaryNull: nullableBooleanSchema,
    presentPublicSummaryPresent: nullableBooleanSchema,
    replayInputEqual: nullableBooleanSchema,
    replayInputSha256Equal: nullableBooleanSchema,
    replayInputHashesInternallyValid: nullableBooleanSchema,
    fullResultEqual: nullableBooleanSchema,
    rankedCandidatesEqual: nullableBooleanSchema,
    eligibilityProjectionEqual: nullableBooleanSchema,
    assessmentsEqual: nullableBooleanSchema,
    decisionEqual: nullableBooleanSchema,
    resultSha256Equal: nullableBooleanSchema,
    recentWorkEffectsNone: nullableBooleanSchema,
    publicPrivacyLeakageCount: nullableCountSchema,
    replayInputDiffCount: nullableCountSchema,
    candidateUniverseDiffCount: nullableCountSchema,
    eligibilityProjectionDiffCount: nullableCountSchema,
    assessmentDiffCount: nullableCountSchema,
    activeSelectionDiffCount: nullableCountSchema,
    activeResultDiffCount: nullableCountSchema,
    activeResultHashDiffCount: nullableCountSchema,
    assertionFailures: z.array(z.string().min(1).max(120)).max(24)
  })
  .strict()
  .superRefine((probe, context) => {
    const measuredFields = activeIntegrationMeasurementFields(probe);
    const measured = probe.measurementStatus === "measured";
    if (measured) {
      if (!measuredFields.every((value) => value !== null)) {
        addIssue(context, ["measurementStatus"], "Measured integration fields must all be present.");
      }
      if (probe.errorReason !== null || probe.inputSha256 === null) {
        addIssue(context, ["errorReason"], "A measured integration probe requires input provenance and no error reason.");
      }
      const expectedDiffs = integrationDiffCounts(probe);
      for (const [key, value] of Object.entries(expectedDiffs)) {
        if (probe[key as keyof typeof probe] !== value) {
          addIssue(context, [key], "Integration diff count is contradictory.");
        }
      }
      const expectedStatus =
        probe.assertionFailures.length === 0 ? "passed" : "failed";
      if (probe.status !== expectedStatus) {
        addIssue(context, ["status"], "Integration status does not match assertions.");
      }
    } else {
      if (!measuredFields.every((value) => value === null)) {
        addIssue(context, ["measurementStatus"], "Unmeasured integration fields must all be null.");
      }
      const reasonIsAppropriate =
        (probe.measurementStatus === "error" &&
          (probe.errorReason === "PROBE_FIXTURE_MATERIALIZATION_FAILED" ||
            probe.errorReason === "PROBE_EXECUTION_FAILED")) ||
        (probe.measurementStatus === "not_measured" &&
          probe.errorReason === "PROBE_NOT_MEASURED");
      if (!reasonIsAppropriate) {
        addIssue(context, ["errorReason"], "Integration measurement reason is missing or contradictory.");
      }
      if (
        probe.errorReason === "PROBE_FIXTURE_MATERIALIZATION_FAILED" &&
        probe.inputSha256 !== null
      ) {
        addIssue(context, ["inputSha256"], "A failed fixture cannot claim a materialized input hash.");
      }
      if (
        probe.errorReason === "PROBE_EXECUTION_FAILED" &&
        probe.inputSha256 === null
      ) {
        addIssue(context, ["inputSha256"], "An execution failure must retain its materialized input hash.");
      }
      if (probe.measurementStatus === "not_measured" && probe.inputSha256 !== null) {
        addIssue(context, ["inputSha256"], "A probe that was not measured cannot claim an input hash.");
      }
      if (probe.status !== "failed") {
        addIssue(context, ["status"], "An unmeasured integration probe cannot pass.");
      }
    }
  });

const recentWorkEvaluationRunRecordBaseSchema = z
  .object({
    contract: z.literal(RECENT_WORK_EVALUATION_RUN_RECORD_CONTRACT),
    evaluationPolicyVersion: z.literal(
      RECENT_WORK_EVALUATION_POLICY_VERSION
    ),
    runId: runIdSchema,
    status: z.enum(["passed", "failed"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    dataset: z
      .object({
        contract: z.literal("recent-work-projection-evaluation-dataset-v0.1"),
        version: z.literal("suggestion-recent-work-projection-dev-v0.1"),
        revision: z.literal(1),
        datasetClass: z.literal("regression_dev_candidate"),
        lifecycleState: z.literal("mutable"),
        datasetSha256: z.null(),
        immutableRef: z.null(),
        frozenAt: z.null(),
        candidatePayloadSha256: sha256Schema,
        materializedInputSha256: sha256Schema.nullable(),
        caseCount: z.literal(23),
        containsProductionData: z.literal(false)
      })
      .strict(),
    config: z
      .object({
        version: z.literal("recent-work-projection-config-v0.1"),
        lifecycleState: z.literal("mutable"),
        configSha256: z.null(),
        immutableRef: z.null(),
        candidatePayloadSha256: sha256Schema
      })
      .strict(),
    versions: z.record(z.string(), z.string().min(1).max(180)),
    code: z
      .object({
        commitSha: z.string().regex(/^[a-f0-9]{40}$/u).nullable(),
        state: z.enum([
          "clean_commit",
          "declared_commit",
          "dirty_worktree",
          "unavailable"
        ]),
        fingerprintSha256: sha256Schema.nullable()
      })
      .strict(),
    counts: z
      .object({
        totalCases: z.number().int().nonnegative(),
        passedCases: z.number().int().nonnegative(),
        failedCases: z.number().int().nonnegative(),
        runtimeVariants: z.number().int().nonnegative(),
        measuredVariants: z.number().int().nonnegative(),
        errorVariants: z.number().int().nonnegative(),
        notMeasuredVariants: z.number().int().nonnegative(),
        matchedVariants: z.number().int().nonnegative(),
        unavailableVariants: z.number().int().nonnegative(),
        presentedSummaries: z.number().int().nonnegative(),
        shadowedMatches: z.number().int().nonnegative(),
        actualSelectionChanges: nullableCountSchema
      })
      .strict(),
    metrics: z
      .object({
        variantMeasurementFailureCount: z.number().int().nonnegative(),
        integrationMeasurementFailureCount: z.number().int().nonnegative(),
        statusOrReasonMismatchCount: z.number().int().nonnegative(),
        boundaryFailureCount: z.number().int().nonnegative(),
        mappingFailureCount: z.number().int().nonnegative(),
        rolloutFailureCount: z.number().int().nonnegative(),
        canonicalizationFailureCount: z.number().int().nonnegative(),
        deterministicHashFailureCount: nullableCountSchema,
        privacyLeakageCount: nullableCountSchema,
        replayInputDiffCount: nullableCountSchema,
        candidateUniverseDiffCount: nullableCountSchema,
        eligibilityProjectionDiffCount: nullableCountSchema,
        assessmentDiffCount: nullableCountSchema,
        activeSelectionDiffCount: nullableCountSchema,
        activeResultDiffCount: nullableCountSchema,
        activeResultHashDiffCount: nullableCountSchema,
        recentWorkEffectViolationCount: nullableCountSchema
      })
      .strict(),
    coverage: z
      .object({
        publicTrackingStates: z.array(trackingStateSchema).max(5),
        presentMatched: z.boolean(),
        shadowMatched: z.boolean(),
        upstreamFilteredMappingCases: z.number().int().nonnegative(),
        projectLevelDisplayOnlyCovered: z.boolean()
      })
      .strict(),
    gates: z
      .object({
        measurementsComplete: z.boolean(),
        allCasesPassed: z.boolean(),
        allFivePublicTrackingStatesCovered: z.boolean(),
        presentAndShadowCovered: z.boolean(),
        productionShadowAndPresentMatched: z.boolean(),
        deterministicAndPrivacyClean: z.boolean(),
        activeInputCandidateEligibilitySelectionAndHashUnchanged: z.boolean(),
        allRecentWorkEffectsNone: z.boolean()
      })
      .strict(),
    activeIntegration: activeIntegrationSchema,
    cases: z.array(recentWorkCaseResultSchema).length(23),
    privacy: z
      .object({
        classification: z.literal("bounded_synthetic_non_private"),
        retention: z.literal("private_local_evaluation_artifact"),
        rawProductionConversationUsed: z.literal(false),
        remoteTelemetryAdded: z.literal(false)
      })
      .strict(),
    comparison: z
      .object({
        baselineRunId: z.null(),
        comparisonRunId: z.null(),
        baselineInputSha256: z.null(),
        comparisonInputSha256: z.null(),
        sameFrozenInputComparison: z.null(),
        outcome: z.null(),
        improvementClaimed: z.literal(false)
      })
      .strict(),
    automaticReviewStatus: z.enum(["passed", "failed"]),
    humanReviewStatus: z.literal("not_started"),
    release: z
      .object({
        decision: z.literal("deferred"),
        frozenDatasetEligible: z.literal(false),
        presentRolloutEligible: z.literal(false),
        activeEffectEligible: z.literal(false),
        humanReviewRequired: z.literal(true)
      })
      .strict(),
    limitations: z.array(z.string().min(1).max(600)).min(1).max(12),
    artifact: z
      .object({
        relativePath: z.string().min(1).max(500),
        canonicalPayloadSha256: sha256Schema
      })
      .strict()
  })
  .strict();

type RecentWorkEvaluationRunRecordShape = z.infer<
  typeof recentWorkEvaluationRunRecordBaseSchema
>;

export const recentWorkEvaluationRunRecordSchema =
  recentWorkEvaluationRunRecordBaseSchema.superRefine((record, context) => {
    const facts = deriveEvaluationFacts(record.cases, record.activeIntegration);
    compareDerivedFields(record.counts, facts.counts, "counts", context);
    compareDerivedFields(record.metrics, facts.metrics, "metrics", context);
    compareDerivedFields(record.coverage, facts.coverage, "coverage", context);
    compareDerivedFields(record.gates, facts.gates, "gates", context);
    if (record.status !== facts.status) {
      addIssue(context, ["status"], "Run status is contradictory.");
    }
    if (record.automaticReviewStatus !== facts.status) {
      addIssue(context, ["automaticReviewStatus"], "Automatic review status is contradictory.");
    }
    const expectedMaterializedInputSha256 = materializedInputSha256(
      record.cases,
      record.activeIntegration.inputSha256
    );
    if (record.dataset.materializedInputSha256 !== expectedMaterializedInputSha256) {
      addIssue(context, ["dataset", "materializedInputSha256"], "Materialized input hash is contradictory.");
    }
    if (
      record.dataset.candidatePayloadSha256 !== sha256Canonical(dataset) ||
      record.config.candidatePayloadSha256 !== sha256Canonical(config)
    ) {
      addIssue(context, ["dataset"], "Candidate payload hash is contradictory.");
    }
    if (!canonicalEqual(record.versions, currentVersions())) {
      addIssue(context, ["versions"], "Version record is contradictory.");
    }
    const { artifact, ...content } = record;
    if (
      artifact.relativePath !==
        `.local/evaluations/recent-work-projection/${record.runId}.json` ||
      artifact.canonicalPayloadSha256 !== sha256Canonical(content)
    ) {
      addIssue(context, ["artifact"], "Artifact descriptor is contradictory.");
    }
  });

export type RecentWorkEvaluationVariantResult = z.infer<
  typeof recentWorkVariantResultSchema
>;
export type RecentWorkEvaluationCaseResult = z.infer<
  typeof recentWorkCaseResultSchema
>;
export type RecentWorkActiveIntegrationResult = z.infer<
  typeof activeIntegrationSchema
>;
export type RecentWorkEvaluationRunRecord = z.infer<
  typeof recentWorkEvaluationRunRecordSchema
>;
type CodeProvenance = RecentWorkEvaluationRunRecord["code"];

export function resealRecentWorkEvaluationArtifact<
  T extends {
    artifact: { relativePath: string; canonicalPayloadSha256: string };
  }
>(record: T): T {
  const { artifact, ...content } = record;
  return {
    ...record,
    artifact: {
      ...artifact,
      canonicalPayloadSha256: sha256Canonical(content)
    }
  };
}

const dataset = recentWorkEvaluationDatasetSchema.parse(datasetArtifact);
const config = recentWorkEvaluationConfigSchema.parse(configArtifact);
const EXPECTED_TRACKING_STATES = [
  "in_sync",
  "ahead",
  "behind",
  "diverged",
  "not_configured"
] as const;
const PROBE_AS_OF = "2026-08-10T12:00:00.000Z";
const PROBE_FETCHED_AT = "2026-08-10T11:59:00.000Z";
const PROBE_PUSH_AT = "2026-08-10T11:50:00.000Z";
const PROBE_PROJECT_ID = `project_${"1".repeat(32)}`;
const PROBE_CODEX_SCOPE_ID = "2".repeat(24);
const PROBE_INSTALLATION_SECRET = "3".repeat(64);
const PROBE_REPOSITORY =
  "rw-private-login-sentinel/rw-private-repository-sentinel";
const PROBE_RAW_COMMIT_OID = "4".repeat(40);
const MATERIALIZED_UPSTREAM_FIELDS = [
  "StoredCodexConfig.installationSecret",
  "StoredCodexConfig.scopes[].queryPath",
  "StoredCodexConfig.scopes[].label",
  "GitHubSnapshot.user.login",
  "GitHubSnapshot.repositories[].fullName",
  "GitHubSnapshot.activities[].refName",
  "CodexSnapshot.sessions[].taskSummary"
] as const;
const SOURCE_BOUNDARY_DERIVED_FIELDS = [
  "GitHub raw commit OID converted to opaque artifactId before evaluation"
] as const;
const UNREPRESENTABLE_DIRECT_RESOLVER_FIELDS = [
  "raw prompt body",
  "raw command text",
  "raw conversation body"
] as const;
const PUBLIC_SURFACE_NAMES = [
  "shadow.recentWorkPublicSummary",
  "present.recentWorkPublicSummary",
  "shadow.launcher.recentWorkSummary",
  "present.launcher.recentWorkSummary",
  "shadow.launcher.currentFocusSummary",
  "present.launcher.currentFocusSummary"
] as const;

export function runRecentWorkEvaluation(
  input: {
    startedAt?: Date;
    completedAt?: Date;
    code: CodeProvenance;
  },
  dependencies: {
    integrationProbe?: () => RecentWorkActiveIntegrationResult;
  } = {}
): RecentWorkEvaluationRunRecord {
  assertPinnedEvaluationInputs();
  const startedAt = (input.startedAt ?? new Date()).toISOString();
  const completedAt = (input.completedAt ?? new Date()).toISOString();
  const cases = dataset.cases.map((definition) =>
    evaluateRecentWorkCase(definition)
  );
  const activeIntegration =
    dependencies.integrationProbe?.() ??
    runRecentWorkProductionIntegrationProbe();
  const facts = deriveEvaluationFacts(cases, activeIntegration);
  const runId = `recent_work_run_${randomBytes(16).toString("hex")}`;
  const content = {
    contract: RECENT_WORK_EVALUATION_RUN_RECORD_CONTRACT,
    evaluationPolicyVersion: RECENT_WORK_EVALUATION_POLICY_VERSION,
    runId,
    status: facts.status,
    startedAt,
    completedAt,
    dataset: {
      contract: dataset.contract,
      version: dataset.datasetVersion,
      revision: dataset.datasetRevision,
      datasetClass: dataset.datasetClass,
      lifecycleState: dataset.lifecycle.state,
      datasetSha256: null,
      immutableRef: null,
      frozenAt: null,
      candidatePayloadSha256: sha256Canonical(dataset),
      materializedInputSha256: materializedInputSha256(
        cases,
        activeIntegration.inputSha256
      ),
      caseCount: dataset.cases.length,
      containsProductionData: false as const
    },
    config: {
      version: config.version,
      lifecycleState: config.lifecycle.state,
      configSha256: null,
      immutableRef: null,
      candidatePayloadSha256: sha256Canonical(config)
    },
    versions: currentVersions(),
    code: input.code,
    counts: facts.counts,
    metrics: facts.metrics,
    coverage: facts.coverage,
    gates: facts.gates,
    activeIntegration,
    cases,
    privacy: {
      classification: "bounded_synthetic_non_private" as const,
      retention: "private_local_evaluation_artifact" as const,
      rawProductionConversationUsed: false as const,
      remoteTelemetryAdded: false as const
    },
    comparison: {
      baselineRunId: null,
      comparisonRunId: null,
      baselineInputSha256: null,
      comparisonInputSha256: null,
      sameFrozenInputComparison: null,
      outcome: null,
      improvementClaimed: false as const
    },
    automaticReviewStatus: facts.status,
    humanReviewStatus: "not_started" as const,
    release: {
      decision: "deferred" as const,
      frozenDatasetEligible: false as const,
      presentRolloutEligible: false as const,
      activeEffectEligible: false as const,
      humanReviewRequired: true as const
    },
    limitations: [
      "Mutable synthetic Dev Candidate only; datasetSha256, immutableRef, frozenAt, baseline/comparison run IDs, and human review remain absent.",
      "The paired production integration probe is a same-run shadow/present invariant check, not a formal baseline comparison or release result.",
      "This evaluates repository-scope-only display projection v0.1, not actor/origin provenance, exact commit equality, continuation observation/context/offer contracts, heartbeat validation, or resume actions.",
      "Removed and archived mapping cases enter at the confirmed-link boundary as explicit upstream-filtered absence; this evaluator does not pretend the Recent Work resolver reads registry history.",
      "The only rollout parser is shadow or present with invalid values defaulting to shadow; four-mode continuation rollout, applied selection, monitor v0.7, and replay v4 do not exist here."
    ]
  };
  return recentWorkEvaluationRunRecordSchema.parse(
    resealRecentWorkEvaluationArtifact({
      ...content,
      artifact: {
        relativePath: `.local/evaluations/recent-work-projection/${runId}.json`,
        canonicalPayloadSha256: "0".repeat(64)
      }
    })
  );
}

export function evaluateRecentWorkCase(
  definition: RecentWorkEvaluationCaseDefinition,
  dependencies: { resolve?: typeof resolveRecentWork } = {}
): RecentWorkEvaluationCaseResult {
  const fixture = buildRecentWorkEvaluationFixture(definition, config);
  const variants = fixture.variants.map((variant) =>
    evaluateVariant(variant, dependencies.resolve ?? resolveRecentWork)
  );
  const complete = variants.every(
    (variant) => variant.measurementStatus === "measured"
  );
  const measurementStatus = complete
    ? ("measured" as const)
    : variants.some((variant) => variant.measurementStatus === "error")
      ? ("error" as const)
      : ("not_measured" as const);
  return recentWorkCaseResultSchema.parse({
    caseId: definition.caseId,
    scenario: definition.scenario,
    labels: definition.labels,
    evaluationKind: definition.evaluationKind,
    upstreamMappingState: definition.upstreamMappingState,
    status:
      complete && variants.every((variant) => variant.status === "passed")
        ? "passed"
        : "failed",
    measurementStatus,
    inputSha256: sha256Canonical({
      definition,
      variants: variants.map((variant) => variant.inputSha256)
    }),
    variantCount: variants.length,
    deterministic: complete
      ? variants.every((variant) => variant.deterministic === true)
      : null,
    privacyLeakageCount: complete
      ? variants.reduce(
          (sum, variant) => sum + (variant.privacyLeakageCount ?? 0),
          0
        )
      : null,
    recentWorkEffectViolation: complete
      ? variants.some((variant) => variant.recentWorkEffectViolation === true)
      : null,
    variants
  });
}

export function runRecentWorkProductionIntegrationProbe(hooks: {
  beforeFixtureMaterialization?: () => void;
} = {}): RecentWorkActiveIntegrationResult {
  let fixture: ReturnType<typeof buildProductionIntegrationFixture>;
  let inputSha256: string;
  try {
    hooks.beforeFixtureMaterialization?.();
    fixture = buildProductionIntegrationFixture();
    inputSha256 = sha256Canonical({
      snapshotsAndPrivateContext: fixture.commonInput,
      privacyBoundary: fixture.privacyBoundary
    });
  } catch {
    return failedActiveIntegration(
      null,
      "PROBE_FIXTURE_MATERIALIZATION_FAILED"
    );
  }
  try {
    const shadow = evaluateAttentionSnapshots({
      ...fixture.commonInput,
      recentWorkPresentationMode: "shadow"
    });
    const present = evaluateAttentionSnapshots({
      ...fixture.commonInput,
      recentWorkPresentationMode: "present"
    });
    const shadowLauncher = projectAttentionForLauncher({
      result: shadow.result,
      baseResult: shadow.baseResult,
      run: shadow.run,
      resumption: { companion: { state: "offline", lastSeenAt: null }, bindings: [] },
      currentFocus: shadow.currentFocus,
      recentWorkSummary: shadow.recentWorkPublicSummary
    });
    const presentLauncher = projectAttentionForLauncher({
      result: present.result,
      baseResult: present.baseResult,
      run: present.run,
      resumption: { companion: { state: "offline", lastSeenAt: null }, bindings: [] },
      currentFocus: present.currentFocus,
      recentWorkSummary: present.recentWorkPublicSummary
    });
    const publicSurfaces = {
      shadowRecentWork: shadow.recentWorkPublicSummary,
      presentRecentWork: present.recentWorkPublicSummary,
      shadowLauncherRecentWork: shadowLauncher.recentWorkSummary,
      presentLauncherRecentWork: presentLauncher.recentWorkSummary,
      shadowLauncherCurrentFocus: shadowLauncher.currentFocusSummary,
      presentLauncherCurrentFocus: presentLauncher.currentFocusSummary
    };
    const shadowRecentWorkMatched = shadow.recentWork.status === "matched";
    const presentRecentWorkMatched = present.recentWork.status === "matched";
    const recentWorkEqual = canonicalEqual(shadow.recentWork, present.recentWork);
    const shadowPublicSummaryNull = shadow.recentWorkPublicSummary === null;
    const presentPublicSummaryPresent = present.recentWorkPublicSummary !== null;
    const replayInputEqual = canonicalEqual(
      shadow.replayArtifact.input,
      present.replayArtifact.input
    );
    const replayInputSha256Equal =
      shadow.replayArtifact.inputSha256 === present.replayArtifact.inputSha256;
    const replayInputHashesInternallyValid =
      shadow.replayArtifact.inputSha256 === shadow.result.inputSha256 &&
      present.replayArtifact.inputSha256 === present.result.inputSha256;
    const fullResultEqual = canonicalEqual(shadow.result, present.result);
    const rankedCandidatesEqual = canonicalEqual(
      shadow.result.rankedCandidates,
      present.result.rankedCandidates
    );
    const eligibilityProjectionEqual = canonicalEqual(
      shadow.eligibilityProjection,
      present.eligibilityProjection
    );
    const assessmentsEqual = canonicalEqual(
      shadow.result.assessments,
      present.result.assessments
    );
    const decisionEqual = canonicalEqual(
      shadow.result.decision,
      present.result.decision
    );
    const resultSha256Equal =
      shadow.result.resultSha256 === present.result.resultSha256;
    const recentWorkEffectsNone = [shadow.recentWork, present.recentWork].every(
      (projection) =>
        projection.attentionSelectionEffect === "none" &&
        projection.candidateEligibilityEffect === "none" &&
        projection.rankingEffect === "none" &&
        projection.executionEffect === "none"
    );
    const publicPrivacyLeakageCount = exactValueLeakageCount(
      publicSurfaces,
      fixture.checkedPrivateValues
    );
    const assertions = [
      assertion(shadowRecentWorkMatched, "SHADOW_RECENT_WORK_NOT_MATCHED"),
      assertion(presentRecentWorkMatched, "PRESENT_RECENT_WORK_NOT_MATCHED"),
      assertion(recentWorkEqual, "RECENT_WORK_SHADOW_PRESENT_DIFF"),
      assertion(shadowPublicSummaryNull, "SHADOW_PUBLIC_SUMMARY_EXPOSED"),
      assertion(presentPublicSummaryPresent, "PRESENT_PUBLIC_SUMMARY_MISSING"),
      assertion(replayInputEqual, "ACTIVE_REPLAY_INPUT_CHANGED"),
      assertion(replayInputSha256Equal, "ACTIVE_INPUT_SHA_CHANGED"),
      assertion(replayInputHashesInternallyValid, "ACTIVE_INPUT_SHA_INCOHERENT"),
      assertion(fullResultEqual, "ACTIVE_RESULT_CHANGED"),
      assertion(rankedCandidatesEqual, "ACTIVE_CANDIDATE_ORDER_OR_CONTENT_CHANGED"),
      assertion(eligibilityProjectionEqual, "ELIGIBILITY_PROJECTION_CHANGED"),
      assertion(assessmentsEqual, "ELIGIBILITY_ASSESSMENTS_CHANGED"),
      assertion(decisionEqual, "ACTIVE_DECISION_CHANGED"),
      assertion(resultSha256Equal, "ACTIVE_RESULT_SHA_CHANGED"),
      assertion(shadow.result.rankedCandidates.length > 0, "ACTIVE_CANDIDATE_NOT_MATERIALIZED"),
      assertion(shadow.result.assessments.length > 0, "ACTIVE_ASSESSMENT_NOT_MATERIALIZED"),
      assertion(recentWorkEffectsNone, "RECENT_WORK_EFFECT_CHANGED"),
      assertion(publicPrivacyLeakageCount === 0, "MATERIALIZED_PUBLIC_PRIVACY_LEAKAGE")
    ].filter((failure): failure is string => failure !== null);
    const measured = {
      status: assertions.length === 0 ? ("passed" as const) : ("failed" as const),
      measurementStatus: "measured" as const,
      errorReason: null,
      inputSha256,
      materializedUpstreamFields: [...MATERIALIZED_UPSTREAM_FIELDS],
      sourceBoundaryDerivedFields: [...SOURCE_BOUNDARY_DERIVED_FIELDS],
      unrepresentableDirectResolverFields: [...UNREPRESENTABLE_DIRECT_RESOLVER_FIELDS],
      publicSurfaceNames: [...PUBLIC_SURFACE_NAMES],
      publicSurfaceSha256: sha256Canonical(publicSurfaces),
      activeCandidateCount: shadow.result.rankedCandidates.length,
      assessmentCount: shadow.result.assessments.length,
      shadowRecentWorkMatched,
      presentRecentWorkMatched,
      recentWorkEqual,
      shadowPublicSummaryNull,
      presentPublicSummaryPresent,
      replayInputEqual,
      replayInputSha256Equal,
      replayInputHashesInternallyValid,
      fullResultEqual,
      rankedCandidatesEqual,
      eligibilityProjectionEqual,
      assessmentsEqual,
      decisionEqual,
      resultSha256Equal,
      recentWorkEffectsNone,
      publicPrivacyLeakageCount,
      replayInputDiffCount: replayInputEqual ? 0 : 1,
      candidateUniverseDiffCount: rankedCandidatesEqual ? 0 : 1,
      eligibilityProjectionDiffCount: eligibilityProjectionEqual ? 0 : 1,
      assessmentDiffCount: assessmentsEqual ? 0 : 1,
      activeSelectionDiffCount: decisionEqual ? 0 : 1,
      activeResultDiffCount: fullResultEqual ? 0 : 1,
      activeResultHashDiffCount: resultSha256Equal ? 0 : 1,
      assertionFailures: assertions
    };
    return activeIntegrationSchema.parse(measured);
  } catch {
    return failedActiveIntegration(inputSha256, "PROBE_EXECUTION_FAILED");
  }
}

function evaluateVariant(
  fixture: RecentWorkEvaluationVariantFixture,
  resolve: typeof resolveRecentWork
): RecentWorkEvaluationVariantResult {
  const inputSha256 = sha256Canonical({
    input: fixture.input,
    presentationInput: fixture.presentationInput,
    expected: fixture.expected
  });
  try {
    const first = resolve(fixture.input);
    const second = resolve(fixture.input);
    const presentationMode = resolveRecentWorkPresentationMode({
      BLABASE_RECENT_WORK_PRESENTATION_MODE:
        fixture.presentationInput === "invalid"
          ? "invalid"
          : fixture.presentationInput
    });
    const firstSummary = projectRecentWorkPublicSummary(first, presentationMode);
    const secondSummary = projectRecentWorkPublicSummary(second, presentationMode);
    const deterministic =
      first.projectionSha256 === second.projectionSha256 &&
      canonicalEqual(firstSummary, secondSummary);
    const recentWorkEffectViolation =
      first.attentionSelectionEffect !== "none" ||
      first.candidateEligibilityEffect !== "none" ||
      first.rankingEffect !== "none" ||
      first.executionEffect !== "none";
    const privacyLeakageCount = publicPrivacyLeakageCount(
      firstSummary,
      fixture.forbiddenPublicValues,
      first.match
        ? [
            first.match.linkId,
            first.match.projectId,
            first.match.currentFocusProjectionSha256,
            first.match.focusEventSha256,
            first.match.registrySha256,
            first.match.localGitSnapshotSha256
          ]
        : []
    );
    const actualReasonCode = first.reasonCodes[0] ?? null;
    const assertionFailures = [
      assertion(first.status === fixture.expected.projectionStatus, "PROJECTION_STATUS_MISMATCH"),
      assertion(actualReasonCode === fixture.expected.reasonCode, "REASON_CODE_MISMATCH"),
      assertion(presentationMode === fixture.expected.presentationMode, "PRESENTATION_MODE_MISMATCH"),
      assertion(
        (firstSummary !== null) === (fixture.expected.summaryDisposition === "present"),
        "SUMMARY_DISPOSITION_MISMATCH"
      ),
      assertion(
        (first.match?.trackingState ?? null) === fixture.expected.trackingState &&
          (first.match?.aheadCount ?? null) === fixture.expected.aheadCount &&
          (first.match?.behindCount ?? null) === fixture.expected.behindCount,
        "TRACKING_MATRIX_MISMATCH"
      ),
      assertion(
        (firstSummary?.pushOccurredAt ?? null) === fixture.expected.publicPushOccurredAt,
        "PUBLIC_TIMESTAMP_MISMATCH"
      ),
      assertion(deterministic, "DETERMINISTIC_HASH_MISMATCH"),
      assertion(privacyLeakageCount === 0, "PUBLIC_PRIVACY_LEAKAGE"),
      assertion(!recentWorkEffectViolation, "RECENT_WORK_EFFECT_CHANGED")
    ].filter((failure): failure is string => failure !== null);
    return recentWorkVariantResultSchema.parse({
      variantId: fixture.variantId,
      status: assertionFailures.length === 0 ? "passed" : "failed",
      measurementStatus: "measured",
      errorReason: null,
      inputSha256,
      projectionStatus: first.status,
      reasonCode: actualReasonCode,
      presentationMode,
      summaryProjected: firstSummary !== null,
      publicPushOccurredAt: firstSummary?.pushOccurredAt ?? null,
      trackingState: first.match?.trackingState ?? null,
      aheadCount: first.match?.aheadCount ?? null,
      behindCount: first.match?.behindCount ?? null,
      projectionSha256: first.projectionSha256,
      publicSummarySha256:
        firstSummary === null ? null : sha256Canonical(firstSummary),
      deterministic,
      privacyLeakageCount,
      recentWorkEffectViolation,
      assertionFailures
    });
  } catch {
    return recentWorkVariantResultSchema.parse({
      variantId: fixture.variantId,
      status: "failed",
      measurementStatus: "error",
      errorReason: "CASE_EXECUTION_FAILED",
      inputSha256,
      projectionStatus: "error",
      reasonCode: null,
      presentationMode:
        fixture.presentationInput === "present" ? "present" : "shadow",
      summaryProjected: false,
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
  }
}

function buildProductionIntegrationFixture() {
  const githubScope = {
    source: "github" as const,
    resourceType: "repository" as const,
    opaqueId: "101"
  };
  const codexScope = {
    source: "codex" as const,
    resourceType: "scope" as const,
    opaqueId: PROBE_CODEX_SCOPE_ID
  };
  let registry = createEmptyWorkContextRegistry(PROBE_AS_OF);
  registry = createProjectIdentity(registry, {
    projectId: PROBE_PROJECT_ID,
    createdAt: PROBE_AS_OF
  }).registry;
  registry = confirmProjectMapping(registry, {
    scope: githubScope,
    projectId: PROBE_PROJECT_ID,
    confirmedAt: PROBE_AS_OF,
    explicitUserConfirmation: true
  }).registry;
  registry = confirmProjectMapping(registry, {
    scope: codexScope,
    projectId: PROBE_PROJECT_ID,
    confirmedAt: PROBE_AS_OF,
    explicitUserConfirmation: true
  }).registry;
  const task: GitHubTaskSignal = {
    id: 501,
    source: "github",
    kind: "assigned_issue",
    repositoryId: 101,
    repositoryFullName: PROBE_REPOSITORY,
    number: 17,
    title: "Synthetic assigned issue",
    htmlUrl: `https://github.com/${PROBE_REPOSITORY}/issues/17`,
    labelNames: [],
    milestoneDueAt: null,
    state: "open",
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-10T08:00:00.000Z"
  };
  const push: GitHubUserActivitySignal = {
    id: "synthetic-push-event",
    source: "github",
    kind: "user_activity",
    activityKind: "push",
    repositoryId: 101,
    repositoryFullName: PROBE_REPOSITORY,
    occurredAt: PROBE_PUSH_AT,
    subjectType: "branch",
    subjectNumber: null,
    subjectObjectId: null,
    subjectTitle: null,
    refName: "refs/heads/rw-private-ref-sentinel",
    reviewState: null,
    artifactId: createGitHubArtifactId({
      kind: "github_commit",
      repositoryId: 101,
      oid: PROBE_RAW_COMMIT_OID
    })
  };
  const githubSnapshot: GitHubSnapshot = {
    schemaVersion: "github-snapshot-v6",
    appClientId: "synthetic-app-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: PROBE_FETCHED_AT,
    user: { id: 42, login: "rw-private-login-sentinel" },
    truncated: false,
    activityWindowStart: "2026-08-03T12:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    actionabilityCoverage: {
      state: "complete",
      authoredPullRequestCount: 0,
      attemptedCount: 0,
      collectedCount: 0,
      truncated: false
    },
    installations: [
      {
        id: 11,
        accountLogin: "synthetic-account",
        accountType: "User",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 11,
        fullName: PROBE_REPOSITORY,
        private: true,
        archived: false,
        updatedAt: PROBE_PUSH_AT
      }
    ],
    tasks: [task],
    activities: [push]
  };
  const codexSnapshot: CodexSnapshot = {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-activity-summary-v1",
    contentMode: "activity_summary",
    codexVersion: "codex-cli synthetic",
    fetchedAt: PROBE_FETCHED_AT,
    lookbackStart: "2026-08-03T12:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: [PROBE_CODEX_SCOPE_ID],
    sessions: [
      {
        id: "5".repeat(24),
        source: "codex",
        kind: "coding_session",
        scopeId: PROBE_CODEX_SCOPE_ID,
        projectLabel: "rw-private-codex-label-sentinel",
        taskSummary: "rw-private-codex-summary-sentinel",
        taskSummarySource: "thread_name",
        createdAt: "2026-08-09T07:00:00.000Z",
        updatedAt: "2026-08-10T07:00:00.000Z",
        activityState: "active",
        attentionState: null,
        content: emptyCodexContentManifest()
      }
    ]
  };
  const codexConfig: StoredCodexConfig = {
    schemaVersion: "codex-connector-config-v3",
    installationSecret: PROBE_INSTALLATION_SECRET,
    selectedScopeIds: [PROBE_CODEX_SCOPE_ID],
    scopes: [
      {
        id: PROBE_CODEX_SCOPE_ID,
        queryPath: "/synthetic/private/rw-path-sentinel",
        label: "rw-private-config-label-sentinel",
        sessionCount: 1,
        lastActivityAt: "2026-08-10T07:00:00.000Z"
      }
    ],
    contentMode: "metadata_only",
    contentConsentAt: null,
    conversationConsentContract: null,
    conversationConsentAt: null,
    conversationRetentionDays: null,
    discoveredAt: "2026-08-09T07:00:00.000Z"
  };
  const githubRepositoryKey = createCodexLocalGitGitHubRepositoryKey(
    PROBE_INSTALLATION_SECRET,
    PROBE_REPOSITORY
  );
  if (githubRepositoryKey === null) {
    throw new TypeError("Synthetic GitHub repository key must be valid.");
  }
  const localGitSnapshot = sealCodexLocalGitSnapshot({
    schemaVersion: CODEX_LOCAL_GIT_SNAPSHOT_SCHEMA_VERSION,
    collectorVersion: CODEX_LOCAL_GIT_COLLECTOR_VERSION,
    upstreamBasis: CODEX_LOCAL_GIT_UPSTREAM_BASIS,
    fetchedAt: PROBE_FETCHED_AT,
    scopeIds: [PROBE_CODEX_SCOPE_ID],
    repositories: [
      {
        scopeId: PROBE_CODEX_SCOPE_ID,
        repositoryId: `local_repo_${"6".repeat(64)}`,
        headCommitId: `local_commit_${"7".repeat(64)}`,
        githubRepositoryKey,
        mappingEligibility: "exact",
        trackingState: "in_sync",
        aheadCount: 0,
        behindCount: 0,
        headCommittedAt: PROBE_PUSH_AT,
        unavailableReason: null
      }
    ],
    truncated: false
  });
  const commonInput: Omit<
    Parameters<typeof evaluateAttentionSnapshots>[0],
    "recentWorkPresentationMode"
  > = {
    github: { status: "available", snapshot: githubSnapshot },
    codex: { status: "available", snapshot: codexSnapshot },
    registry,
    codexConfig,
    localGitSnapshot,
    asOf: PROBE_AS_OF,
    startedAt: PROBE_AS_OF,
    completedAt: PROBE_AS_OF,
    latencyMs: 0,
    codeCommitSha: null,
    codeState: "dirty_worktree",
    codeFingerprintSha256: "8".repeat(64),
    executionIds: {
      runId: `run_${"9".repeat(32)}`,
      analysisId: `analysis_${"a".repeat(32)}`,
      sessionId: `session_${"b".repeat(32)}`
    }
  };
  return {
    commonInput,
    checkedPrivateValues: [
      PROBE_INSTALLATION_SECRET,
      "/synthetic/private/rw-path-sentinel",
      "rw-private-config-label-sentinel",
      "rw-private-login-sentinel",
      PROBE_REPOSITORY,
      "refs/heads/rw-private-ref-sentinel",
      "rw-private-codex-summary-sentinel",
      PROBE_RAW_COMMIT_OID
    ],
    privacyBoundary: {
      materializedUpstreamFields: MATERIALIZED_UPSTREAM_FIELDS,
      sourceBoundaryDerivedFields: SOURCE_BOUNDARY_DERIVED_FIELDS,
      unrepresentableDirectResolverFields: UNREPRESENTABLE_DIRECT_RESOLVER_FIELDS
    }
  };
}

function deriveEvaluationFacts(
  cases: RecentWorkEvaluationCaseResult[],
  activeIntegration: RecentWorkActiveIntegrationResult
) {
  const variants = cases.flatMap((record) => record.variants);
  const measuredVariants = variants.filter(
    (variant) => variant.measurementStatus === "measured"
  );
  const errorVariants = variants.filter(
    (variant) => variant.measurementStatus === "error"
  );
  const notMeasuredVariants = variants.filter(
    (variant) => variant.measurementStatus === "not_measured"
  );
  const variantsComplete = measuredVariants.length === variants.length;
  const integrationComplete = activeIntegration.measurementStatus === "measured";
  const measurementsComplete = variantsComplete && integrationComplete;
  const publicTrackingStates = EXPECTED_TRACKING_STATES.filter((state) =>
    measuredVariants.some((variant) => variant.trackingState === state)
  );
  const metrics = {
    variantMeasurementFailureCount: variants.length - measuredVariants.length,
    integrationMeasurementFailureCount: integrationComplete ? 0 : 1,
    statusOrReasonMismatchCount: failedAssertionCount(variants, [
      "PROJECTION_STATUS_MISMATCH",
      "REASON_CODE_MISMATCH"
    ]),
    boundaryFailureCount: countFailedVariants(cases, "boundary_matrix"),
    mappingFailureCount: cases
      .filter((record) => record.labels.includes("mapping"))
      .flatMap((record) => record.variants)
      .filter((variant) => variant.status === "failed").length,
    rolloutFailureCount: failedAssertionCount(variants, ["PRESENTATION_MODE_MISMATCH"]),
    canonicalizationFailureCount: failedAssertionCount(variants, ["PUBLIC_TIMESTAMP_MISMATCH"]),
    deterministicHashFailureCount: variantsComplete
      ? variants.filter((variant) => variant.deterministic !== true).length
      : null,
    privacyLeakageCount: measurementsComplete
      ? variants.reduce(
          (sum, variant) => sum + (variant.privacyLeakageCount ?? 0),
          0
        ) + (activeIntegration.publicPrivacyLeakageCount ?? 0)
      : null,
    replayInputDiffCount: activeIntegration.replayInputDiffCount,
    candidateUniverseDiffCount: activeIntegration.candidateUniverseDiffCount,
    eligibilityProjectionDiffCount: activeIntegration.eligibilityProjectionDiffCount,
    assessmentDiffCount: activeIntegration.assessmentDiffCount,
    activeSelectionDiffCount: activeIntegration.activeSelectionDiffCount,
    activeResultDiffCount: activeIntegration.activeResultDiffCount,
    activeResultHashDiffCount: activeIntegration.activeResultHashDiffCount,
    recentWorkEffectViolationCount: measurementsComplete
      ? variants.filter((variant) => variant.recentWorkEffectViolation === true).length +
        (activeIntegration.recentWorkEffectsNone ? 0 : 1)
      : null
  };
  const coverage = {
    publicTrackingStates,
    presentMatched: measuredVariants.some(
      (variant) =>
        variant.projectionStatus === "matched" &&
        variant.presentationMode === "present"
    ),
    shadowMatched: measuredVariants.some(
      (variant) =>
        variant.projectionStatus === "matched" &&
        variant.presentationMode === "shadow"
    ),
    upstreamFilteredMappingCases: cases.filter(
      (record) => record.evaluationKind === "upstream_filtered_runtime"
    ).length,
    projectLevelDisplayOnlyCovered:
      cases.find((record) => record.caseId === "RW-PROJ-DEV-013")?.status ===
      "passed"
  };
  const activeDiffsClean = [
    metrics.replayInputDiffCount,
    metrics.candidateUniverseDiffCount,
    metrics.eligibilityProjectionDiffCount,
    metrics.assessmentDiffCount,
    metrics.activeSelectionDiffCount,
    metrics.activeResultDiffCount,
    metrics.activeResultHashDiffCount
  ].every((value) => value === 0);
  const gates = {
    measurementsComplete,
    allCasesPassed:
      measurementsComplete && cases.every((record) => record.status === "passed"),
    allFivePublicTrackingStatesCovered:
      measurementsComplete &&
      publicTrackingStates.length === EXPECTED_TRACKING_STATES.length,
    presentAndShadowCovered:
      measurementsComplete && coverage.presentMatched && coverage.shadowMatched,
    productionShadowAndPresentMatched:
      measurementsComplete &&
      activeIntegration.shadowRecentWorkMatched === true &&
      activeIntegration.presentRecentWorkMatched === true &&
      activeIntegration.recentWorkEqual === true &&
      activeIntegration.shadowPublicSummaryNull === true &&
      activeIntegration.presentPublicSummaryPresent === true,
    deterministicAndPrivacyClean:
      measurementsComplete &&
      metrics.deterministicHashFailureCount === 0 &&
      metrics.privacyLeakageCount === 0,
    activeInputCandidateEligibilitySelectionAndHashUnchanged:
      measurementsComplete &&
      activeDiffsClean &&
      activeIntegration.replayInputSha256Equal === true &&
      activeIntegration.replayInputHashesInternallyValid === true &&
      (activeIntegration.activeCandidateCount ?? 0) > 0 &&
      (activeIntegration.assessmentCount ?? 0) > 0,
    allRecentWorkEffectsNone:
      measurementsComplete && metrics.recentWorkEffectViolationCount === 0
  };
  const failedCases = cases.filter((record) => record.status === "failed").length;
  const counts = {
    totalCases: cases.length,
    passedCases: cases.length - failedCases,
    failedCases,
    runtimeVariants: variants.length,
    measuredVariants: measuredVariants.length,
    errorVariants: errorVariants.length,
    notMeasuredVariants: notMeasuredVariants.length,
    matchedVariants: measuredVariants.filter(
      (variant) => variant.projectionStatus === "matched"
    ).length,
    unavailableVariants: measuredVariants.filter(
      (variant) => variant.projectionStatus === "unavailable"
    ).length,
    presentedSummaries: measuredVariants.filter(
      (variant) => variant.summaryProjected
    ).length,
    shadowedMatches: measuredVariants.filter(
      (variant) =>
        variant.projectionStatus === "matched" &&
        variant.presentationMode === "shadow"
    ).length,
    actualSelectionChanges: activeIntegration.activeSelectionDiffCount
  };
  const allMetricsResolvedAndClean = Object.values(metrics).every(
    (value) => value === 0
  );
  return {
    counts,
    metrics,
    coverage,
    gates,
    status:
      Object.values(gates).every(Boolean) && allMetricsResolvedAndClean
        ? ("passed" as const)
        : ("failed" as const)
  };
}

function activeIntegrationMeasurementFields(
  probe: RecentWorkEvaluationRunRecordShape["activeIntegration"]
) {
  return [
    probe.publicSurfaceSha256,
    probe.activeCandidateCount,
    probe.assessmentCount,
    probe.shadowRecentWorkMatched,
    probe.presentRecentWorkMatched,
    probe.recentWorkEqual,
    probe.shadowPublicSummaryNull,
    probe.presentPublicSummaryPresent,
    probe.replayInputEqual,
    probe.replayInputSha256Equal,
    probe.replayInputHashesInternallyValid,
    probe.fullResultEqual,
    probe.rankedCandidatesEqual,
    probe.eligibilityProjectionEqual,
    probe.assessmentsEqual,
    probe.decisionEqual,
    probe.resultSha256Equal,
    probe.recentWorkEffectsNone,
    probe.publicPrivacyLeakageCount,
    probe.replayInputDiffCount,
    probe.candidateUniverseDiffCount,
    probe.eligibilityProjectionDiffCount,
    probe.assessmentDiffCount,
    probe.activeSelectionDiffCount,
    probe.activeResultDiffCount,
    probe.activeResultHashDiffCount
  ];
}

function integrationDiffCounts(
  probe: RecentWorkEvaluationRunRecordShape["activeIntegration"]
) {
  return {
    replayInputDiffCount: probe.replayInputEqual ? 0 : 1,
    candidateUniverseDiffCount: probe.rankedCandidatesEqual ? 0 : 1,
    eligibilityProjectionDiffCount: probe.eligibilityProjectionEqual ? 0 : 1,
    assessmentDiffCount: probe.assessmentsEqual ? 0 : 1,
    activeSelectionDiffCount: probe.decisionEqual ? 0 : 1,
    activeResultDiffCount: probe.fullResultEqual ? 0 : 1,
    activeResultHashDiffCount: probe.resultSha256Equal ? 0 : 1
  };
}

function materializedInputSha256(
  cases: RecentWorkEvaluationCaseResult[],
  productionIntegrationProbeInputSha256: string | null
): string | null {
  if (productionIntegrationProbeInputSha256 === null) return null;
  return sha256Canonical({
    cases: cases.map((record) => ({
      caseId: record.caseId,
      inputSha256: record.inputSha256
    })),
    productionIntegrationProbeInputSha256
  });
}

function failedActiveIntegration(
  inputSha256: string | null,
  errorReason:
    | "PROBE_FIXTURE_MATERIALIZATION_FAILED"
    | "PROBE_EXECUTION_FAILED"
): RecentWorkActiveIntegrationResult {
  return activeIntegrationSchema.parse({
    status: "failed",
    measurementStatus: "error",
    errorReason,
    inputSha256,
    materializedUpstreamFields: [...MATERIALIZED_UPSTREAM_FIELDS],
    sourceBoundaryDerivedFields: [...SOURCE_BOUNDARY_DERIVED_FIELDS],
    unrepresentableDirectResolverFields: [...UNREPRESENTABLE_DIRECT_RESOLVER_FIELDS],
    publicSurfaceNames: [...PUBLIC_SURFACE_NAMES],
    publicSurfaceSha256: null,
    activeCandidateCount: null,
    assessmentCount: null,
    shadowRecentWorkMatched: null,
    presentRecentWorkMatched: null,
    recentWorkEqual: null,
    shadowPublicSummaryNull: null,
    presentPublicSummaryPresent: null,
    replayInputEqual: null,
    replayInputSha256Equal: null,
    replayInputHashesInternallyValid: null,
    fullResultEqual: null,
    rankedCandidatesEqual: null,
    eligibilityProjectionEqual: null,
    assessmentsEqual: null,
    decisionEqual: null,
    resultSha256Equal: null,
    recentWorkEffectsNone: null,
    publicPrivacyLeakageCount: null,
    replayInputDiffCount: null,
    candidateUniverseDiffCount: null,
    eligibilityProjectionDiffCount: null,
    assessmentDiffCount: null,
    activeSelectionDiffCount: null,
    activeResultDiffCount: null,
    activeResultHashDiffCount: null,
    assertionFailures: [errorReason]
  });
}

function assertPinnedEvaluationInputs(): void {
  if (
    dataset.config.version !== config.version ||
    dataset.config.ref !== "eval/synthetic/recentWorkProjectionConfig.v0.1.json" ||
    config.recency.focusMaxAgeMs !== RECENT_WORK_FOCUS_MAX_AGE_MS ||
    config.recency.localGitMaxAgeMs !== RECENT_WORK_LOCAL_GIT_MAX_AGE_MS ||
    config.recency.maxFutureSkewMs !== RECENT_WORK_MAX_FUTURE_SKEW_MS
  ) {
    throw new TypeError(
      "Recent Work Dev Candidate must pin its exact mutable config and runtime recency constants."
    );
  }
}

function publicPrivacyLeakageCount(
  summary: unknown,
  forbiddenValues: string[],
  internalValues: string[]
): number {
  const serialized = JSON.stringify(summary);
  const valueLeaks = [...new Set([...forbiddenValues, ...internalValues])].filter(
    (value) => serialized.includes(value)
  ).length;
  const structuralPatterns = [
    /\/Users\//u,
    /refs\/heads\//u,
    /(?:local_repo_|local_commit_|github_repo_|repository_scope_link_)/u,
    /"(?:token|prompt|command|conversation|threadId|branch|commitSha)"\s*:/u,
    /\b[a-f0-9]{40,64}\b/u
  ];
  return valueLeaks + structuralPatterns.filter((pattern) => pattern.test(serialized)).length;
}

function exactValueLeakageCount(surface: unknown, values: string[]): number {
  const serialized = JSON.stringify(surface);
  return [...new Set(values)].filter((value) => serialized.includes(value)).length;
}

function assertion(condition: boolean, code: string): string | null {
  return condition ? null : code;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return sha256Canonical(left) === sha256Canonical(right);
}

function compareDerivedFields(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  prefix: string,
  context: z.RefinementCtx
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (!canonicalEqual(actual[key], value)) {
      addIssue(context, [prefix, key], `Derived ${prefix} field is contradictory.`);
    }
  }
}

function currentVersions(): Record<string, string> {
  return {
    recentMeaningfulEventRule: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    localGitSnapshotSchema: CODEX_LOCAL_GIT_SNAPSHOT_SCHEMA_VERSION,
    localGitCollector: CODEX_LOCAL_GIT_COLLECTOR_VERSION,
    localGitUpstreamBasis: CODEX_LOCAL_GIT_UPSTREAM_BASIS,
    contextRegistryContract: WORK_CONTEXT_REGISTRY_CONTRACT,
    contextRegistrySchema: WORK_CONTEXT_REGISTRY_SCHEMA_VERSION,
    recentWorkProjection: RECENT_WORK_PROJECTION_CONTRACT,
    recentWorkSchema: RECENT_WORK_SCHEMA_VERSION,
    recentWorkResolver: RECENT_WORK_RESOLVER_VERSION,
    recentWorkEvaluationDataset: dataset.contract,
    recentWorkEvaluationConfig: config.version,
    recentWorkEvaluationRun: RECENT_WORK_EVALUATION_RUN_RECORD_CONTRACT,
    recentWorkEvaluationPolicy: RECENT_WORK_EVALUATION_POLICY_VERSION,
    launcherAttention: LAUNCHER_ATTENTION_CONTRACT,
    activeAttentionInput: ACTIVE_ATTENTION_INPUT_CONTRACT,
    activeAttentionResult: ACTIVE_ATTENTION_RESULT_CONTRACT,
    activeAttentionResolver: ACTIVE_ATTENTION_RESOLVER_VERSION
  };
}

function countFailedVariants(
  cases: RecentWorkEvaluationCaseResult[],
  kind: RecentWorkEvaluationCaseResult["evaluationKind"]
): number {
  return cases
    .filter((record) => record.evaluationKind === kind)
    .flatMap((record) => record.variants)
    .filter((variant) => variant.status === "failed").length;
}

function failedAssertionCount(
  variants: RecentWorkEvaluationVariantResult[],
  codes: string[]
): number {
  return variants.filter((variant) =>
    variant.assertionFailures.some((failure) => codes.includes(failure))
  ).length;
}

function addIssue(
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}
