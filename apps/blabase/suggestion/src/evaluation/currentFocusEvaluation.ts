import { randomBytes } from "node:crypto";

import { z } from "zod";

import configArtifact from "../../eval/synthetic/currentFocusConfig.v0.3.json";
import datasetArtifact from "../../eval/synthetic/currentFocusCases.v0.2.json";
import {
  CURRENT_FOCUS_EVALUATION_SCENARIOS,
  buildCurrentFocusEvaluationFixture,
  type CurrentFocusEvaluationFixture,
  type CurrentFocusEvaluationScenario
} from "../../eval/synthetic/currentFocusCaseBuilder";
import { resolveActiveAttention } from "../attentionDecision";
import {
  reconstructCurrentWorkStreams,
  resolveCurrentFocus,
  resolveFocusAwareAttentionShadow,
  type CurrentFocusProjection,
  type CurrentWorkstreamProjection,
  type FocusAwareAttentionShadowProjection
} from "../currentFocus";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  CURRENT_FOCUS_ID_POLICY_VERSION,
  CURRENT_FOCUS_SCHEMA_VERSION,
  CURRENT_FOCUS_SELECTION_POLICY_VERSION,
  CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION,
  CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION,
  CURRENT_WORKSTREAM_ID_POLICY_VERSION,
  CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION,
  CURRENT_WORKSTREAM_SCHEMA_VERSION,
  FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION,
  FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION,
  FOCUS_AWARE_ATTENTION_SHADOW_SCHEMA_VERSION,
  GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION,
  GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
  RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
  RECENT_MEANINGFUL_EVENT_RULE_VERSION,
  RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION
} from "../crossSource/versions";
import {
  sealRecentMeaningfulEventProjection,
  type RecentMeaningfulEventProjection
} from "../recentEvents";
import { sha256Canonical } from "./crossSourceIntegrity";

export const CURRENT_FOCUS_EVALUATION_RUN_RECORD_CONTRACT =
  "current-focus-evaluation-run-v0.1" as const;
export const CURRENT_FOCUS_EVALUATION_POLICY_VERSION =
  "current-focus-evaluation-policy-v0.1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const runIdSchema = z.string().regex(/^current_focus_run_[a-f0-9]{32}$/);
const scenarioSchema = z.enum(CURRENT_FOCUS_EVALUATION_SCENARIOS);

const currentFocusCaseResultSchema = z
  .object({
    caseId: z.string().regex(/^FOCUS-DEV-[0-9]{3}$/),
    scenario: scenarioSchema,
    status: z.enum(["passed", "failed"]),
    inputSha256: sha256Schema,
    focusStatus: z.enum(["selected", "unresolved", "unavailable", "rejected"]),
    workstreamCount: z.number().int().nonnegative(),
    latestEventKind: z.string().min(1).max(120).nullable(),
    completionState: z
      .enum(["active", "completed", "cancelled", "execution_completed", "unknown"])
      .nullable(),
    activeBlocker: z.string().min(1).max(120).nullable(),
    relatedSources: z.array(z.string().min(1).max(120)).max(3),
    historicalEventKinds: z.array(z.string().min(1).max(120)).max(12),
    existingTopCandidateId: z.string().nullable(),
    counterfactualTopCandidateId: z.string().nullable(),
    wouldSwitch: z.boolean(),
    activeResultUnchanged: z.boolean(),
    candidateUniverseChanged: z.boolean(),
    eligibilityDiffCount: z.number().int().nonnegative(),
    deterministic: z.boolean(),
    contextOnlyLeakageCount: z.number().int().nonnegative(),
    staleCurrentnessViolationCount: z.number().int().nonnegative(),
    privacySentinelLeakageCount: z.number().int().nonnegative(),
    dependencyTamperAcceptedCount: z.number().int().nonnegative(),
    reasonCodes: z.array(z.string().min(1).max(160)).max(30)
  })
  .strict();

export const currentFocusEvaluationRunRecordSchema = z
  .object({
    contract: z.literal(CURRENT_FOCUS_EVALUATION_RUN_RECORD_CONTRACT),
    evaluationPolicyVersion: z.literal(CURRENT_FOCUS_EVALUATION_POLICY_VERSION),
    runId: runIdSchema,
    status: z.enum(["passed", "failed"]),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    dataset: z
      .object({
        contract: z.literal("current-focus-evaluation-dataset-v0.1"),
        version: z.literal("suggestion-current-focus-dev-v0.2"),
        revision: z.literal(1),
        datasetClass: z.literal("dev_candidate"),
        lifecycleState: z.literal("mutable"),
        sha256: sha256Schema,
        caseCount: z.literal(13),
        containsProductionData: z.literal(false)
      })
      .strict(),
    config: z
      .object({
        version: z.literal("current-focus-config-v0.3"),
        sha256: sha256Schema
      })
      .strict(),
    versions: z.record(z.string(), z.string().min(1).max(160)),
    code: z
      .object({
        commitSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
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
        total: z.literal(13),
        passed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        selected: z.number().int().nonnegative(),
        abstainedOrRejected: z.number().int().nonnegative(),
        counterfactualTopSwitches: z.number().int().nonnegative(),
        actualSelectionChanges: z.literal(0)
      })
      .strict(),
    metrics: z
      .object({
        currentFocusPrecision: z.number().min(0).max(1),
        abstentionAccuracy: z.number().min(0).max(1),
        topSwitchPrecision: z.number().min(0).max(1),
        contextOnlyLeakageCount: z.number().int().nonnegative(),
        eligibilityDiffCount: z.number().int().nonnegative(),
        staleCurrentnessViolationCount: z.number().int().nonnegative(),
        deterministicHashFailureCount: z.number().int().nonnegative(),
        privacySentinelLeakageCount: z.number().int().nonnegative(),
        dependencyTamperAcceptedCount: z.number().int().nonnegative()
      })
      .strict(),
    cases: z.array(currentFocusCaseResultSchema).length(13),
    privacy: z
      .object({
        classification: z.literal("bounded_synthetic_metadata_only"),
        retention: z.literal("private_local_evaluation_artifact"),
        rawProductionConversationUsed: z.literal(false),
        remoteTelemetryAdded: z.literal(false)
      })
      .strict(),
    comparison: z
      .object({
        activeAttentionCandidateUniverseChanged: z.literal(false),
        activeAttentionEligibilityChanged: z.literal(false),
        activeAttentionSelectionChanged: z.literal(false),
        attentionSelectionEffect: z.literal("none")
      })
      .strict(),
    automaticReviewStatus: z.enum(["passed", "failed"]),
    humanReviewStatus: z.literal("required_before_phase2_activation"),
    limitations: z.array(z.string().min(1).max(500)).min(1).max(12),
    artifact: z
      .object({
        relativePath: z.string().min(1).max(500),
        canonicalPayloadSha256: sha256Schema
      })
      .strict()
  })
  .strict();

export type CurrentFocusEvaluationCaseResult = z.infer<
  typeof currentFocusCaseResultSchema
>;
export type CurrentFocusEvaluationRunRecord = z.infer<
  typeof currentFocusEvaluationRunRecordSchema
>;

type CodeProvenance = CurrentFocusEvaluationRunRecord["code"];

export function runCurrentFocusEvaluation(input: {
  startedAt?: Date;
  completedAt?: Date;
  code: CodeProvenance;
}): CurrentFocusEvaluationRunRecord {
  if (
    datasetArtifact.resolverConfig.version !== configArtifact.version ||
    datasetArtifact.resolverConfig.immutableRef !==
      "eval/synthetic/currentFocusConfig.v0.3.json"
  ) {
    throw new TypeError(
      "Current Focus dataset must pin the exact evaluation config."
    );
  }
  const startedAt = (input.startedAt ?? new Date()).toISOString();
  const completedAt = (input.completedAt ?? new Date()).toISOString();
  const caseRecords = CURRENT_FOCUS_EVALUATION_SCENARIOS.map(
    (scenario, index) =>
      evaluateCurrentFocusCase(
        `FOCUS-DEV-${String(index + 1).padStart(3, "0")}`,
        buildCurrentFocusEvaluationFixture(scenario)
      )
  );
  const selectedExpected = caseRecords.filter((record, index) =>
    datasetArtifact.cases[index]?.expectedFocus.startsWith("selected") ||
    datasetArtifact.cases[index]?.expectedFocus === "not_terminal_pr" ||
    datasetArtifact.cases[index]?.expectedFocus === "privacy_safe"
  );
  const abstentionExpected = caseRecords.filter(
    (_record, index) =>
      ["unresolved", "unavailable", "rejected"].includes(
        datasetArtifact.cases[index]?.expectedFocus ?? ""
      )
  );
  const actualSwitches = caseRecords.filter((record) => record.wouldSwitch);
  const correctSwitches = actualSwitches.filter((record, index) => {
    const datasetCase = datasetArtifact.cases.find(
      (item) => item.caseId === record.caseId
    );
    return datasetCase?.expectedShadow.includes("switch") ||
      datasetCase?.scenario === "same_title_distinct_identity";
  });
  const metrics = {
    currentFocusPrecision: ratio(
      selectedExpected.filter(
        (record) => record.focusStatus === "selected" && record.status === "passed"
      ).length,
      selectedExpected.length
    ),
    abstentionAccuracy: ratio(
      abstentionExpected.filter(
        (record) => record.focusStatus !== "selected" && record.status === "passed"
      ).length,
      abstentionExpected.length
    ),
    topSwitchPrecision: ratio(correctSwitches.length, actualSwitches.length),
    contextOnlyLeakageCount: sum(caseRecords, "contextOnlyLeakageCount"),
    eligibilityDiffCount: sum(caseRecords, "eligibilityDiffCount"),
    staleCurrentnessViolationCount: sum(
      caseRecords,
      "staleCurrentnessViolationCount"
    ),
    deterministicHashFailureCount: caseRecords.filter(
      (record) => !record.deterministic
    ).length,
    privacySentinelLeakageCount: sum(
      caseRecords,
      "privacySentinelLeakageCount"
    ),
    dependencyTamperAcceptedCount: sum(
      caseRecords,
      "dependencyTamperAcceptedCount"
    )
  };
  const failed = caseRecords.filter((record) => record.status === "failed").length;
  const status =
    failed === 0 &&
    metrics.currentFocusPrecision === 1 &&
    metrics.abstentionAccuracy === 1 &&
    metrics.topSwitchPrecision === 1 &&
    metrics.contextOnlyLeakageCount === 0 &&
    metrics.eligibilityDiffCount === 0 &&
    metrics.staleCurrentnessViolationCount === 0 &&
    metrics.deterministicHashFailureCount === 0 &&
    metrics.privacySentinelLeakageCount === 0 &&
    metrics.dependencyTamperAcceptedCount === 0
      ? ("passed" as const)
      : ("failed" as const);
  const runId = `current_focus_run_${randomBytes(16).toString("hex")}`;
  const content = {
    contract: CURRENT_FOCUS_EVALUATION_RUN_RECORD_CONTRACT,
    evaluationPolicyVersion: CURRENT_FOCUS_EVALUATION_POLICY_VERSION,
    runId,
    status,
    startedAt,
    completedAt,
    dataset: {
      contract: datasetArtifact.contract,
      version: datasetArtifact.datasetVersion,
      revision: datasetArtifact.datasetRevision,
      datasetClass: datasetArtifact.datasetClass,
      lifecycleState: datasetArtifact.lifecycle.state,
      sha256: sha256Canonical(datasetArtifact),
      caseCount: 13 as const,
      containsProductionData: false as const
    },
    config: {
      version: configArtifact.version,
      sha256: sha256Canonical(configArtifact)
    },
    versions: currentFocusVersions(),
    code: input.code,
    counts: {
      total: 13 as const,
      passed: caseRecords.length - failed,
      failed,
      selected: caseRecords.filter((record) => record.focusStatus === "selected").length,
      abstainedOrRejected: caseRecords.filter(
        (record) => record.focusStatus !== "selected"
      ).length,
      counterfactualTopSwitches: actualSwitches.length,
      actualSelectionChanges: 0 as const
    },
    metrics,
    cases: caseRecords,
    privacy: {
      classification: "bounded_synthetic_metadata_only" as const,
      retention: "private_local_evaluation_artifact" as const,
      rawProductionConversationUsed: false as const,
      remoteTelemetryAdded: false as const
    },
    comparison: {
      activeAttentionCandidateUniverseChanged: false as const,
      activeAttentionEligibilityChanged: false as const,
      activeAttentionSelectionChanged: false as const,
      attentionSelectionEffect: "none" as const
    },
    automaticReviewStatus: status,
    humanReviewStatus: "required_before_phase2_activation" as const,
    limitations: [
      "Mutable synthetic Dev Candidate only; no Current Focus Golden Dataset was frozen.",
      "GitHub review-request, CI recovery, merge-conflict recovery, and command/test transition timestamps remain unsupported.",
      "Phase 1 records a counterfactual top but never changes the Active Attention selection."
    ]
  };
  const artifact = {
    relativePath: `.local/evaluations/current-focus/${runId}.json`,
    canonicalPayloadSha256: sha256Canonical(content)
  };
  return currentFocusEvaluationRunRecordSchema.parse({ ...content, artifact });
}

export function evaluateCurrentFocusCase(
  caseId: string,
  fixture: CurrentFocusEvaluationFixture
): CurrentFocusEvaluationCaseResult {
  const expected = fixture.expectation;
  const inputSha256 = sha256Canonical({
    scenario: fixture.scenario,
    recentEventProjectionSha256:
      fixture.input.recentEventProjection.projectionSha256,
    activeAttentionInputSha256: fixture.input.activeAttentionInput.inputSha256,
    expectation: expected
  });
  if (expected.requiresDependencyRejection) {
    const rejected = rejectsTamperedDependency(fixture);
    return currentFocusCaseResultSchema.parse({
      caseId,
      scenario: fixture.scenario,
      status: rejected ? "passed" : "failed",
      inputSha256,
      focusStatus: rejected ? "rejected" : "selected",
      workstreamCount: 0,
      latestEventKind: null,
      completionState: null,
      activeBlocker: null,
      relatedSources: [],
      historicalEventKinds: [],
      existingTopCandidateId:
        fixture.input.activeAttentionResult.decision.topSuggestion?.candidateId ?? null,
      counterfactualTopCandidateId: null,
      wouldSwitch: false,
      activeResultUnchanged: true,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0,
      deterministic: rejected && rejectsTamperedDependency(fixture),
      contextOnlyLeakageCount: 0,
      staleCurrentnessViolationCount: 0,
      privacySentinelLeakageCount: 0,
      dependencyTamperAcceptedCount: rejected ? 0 : 1,
      reasonCodes: [
        rejected ? "DEPENDENCY_TAMPER_REJECTED" : "DEPENDENCY_TAMPER_ACCEPTED"
      ]
    });
  }

  try {
    const first = resolveFixture(fixture.input.recentEventProjection, fixture);
    const second = resolveFixture(fixture.input.recentEventProjection, fixture);
    const selected = first.currentFocus.selectedFocus;
    const workstream = selected
      ? first.currentWorkstreams.workstreams.find(
          (item) => item.workstreamId === selected.workstreamId
        ) ?? null
      : null;
    const historicalEventKinds = (workstream?.historicalEventRefs ?? []).flatMap(
      (eventId) => {
        const event = fixture.input.recentEventProjection.events.find(
          (item) => item.eventId === eventId
        );
        return event ? [event.kind] : [];
      }
    );
    const activeResultSha256 = fixture.input.activeAttentionResult.resultSha256;
    const replayedActive = resolveActiveAttention(
      fixture.input.activeAttentionInput
    );
    const activeResultUnchanged =
      replayedActive.resultSha256 === activeResultSha256 &&
      first.focusAwareAttentionShadow.attentionSelectionEffect === "none";
    const deterministic =
      first.currentWorkstreams.projectionSha256 ===
        second.currentWorkstreams.projectionSha256 &&
      first.currentFocus.projectionSha256 === second.currentFocus.projectionSha256 &&
      first.focusAwareAttentionShadow.projectionSha256 ===
        second.focusAwareAttentionShadow.projectionSha256 &&
      permutationMatches(fixture, first);
    const privacySentinelLeakageCount = privacyLeakageCount(fixture, first);
    const contextOnlyLeakageCount =
      expected.requiresContextOnlyIsolation &&
      (first.currentFocus.status === "selected" ||
        first.focusAwareAttentionShadow.wouldSwitch)
        ? 1
        : 0;
    const staleCurrentnessViolationCount =
      expected.requiresCurrentnessAbstention &&
      first.currentFocus.status === "selected"
        ? 1
        : selected &&
            (selected.currentness !== "current" || selected.completeness !== "complete")
          ? 1
          : 0;
    const focusMatches =
      (expected.focusDisposition === "selected") ===
        (first.currentFocus.status === "selected") &&
      (expected.selectedIdentityRef === null ||
        selected?.identityRefs.includes(expected.selectedIdentityRef) === true) &&
      (expected.latestEventId === null ||
        selected?.latestMeaningfulEvent.eventId === expected.latestEventId) &&
      (expected.latestEventKind === null ||
        selected?.latestMeaningfulEvent.kind === expected.latestEventKind);
    const invariantsMatch =
      focusMatches &&
      (expected.workstreamCount === null ||
        first.currentWorkstreams.workstreams.length === expected.workstreamCount) &&
      (expected.completionState === null ||
        selected?.completionState === expected.completionState) &&
      first.focusAwareAttentionShadow.wouldSwitch === expected.wouldSwitch &&
      (expected.activeCandidateCount === null ||
        fixture.input.activeAttentionResult.rankedCandidates.length ===
          expected.activeCandidateCount) &&
      (expected.duplicateCount === null ||
        fixture.input.recentEventProjection.counts.duplicate ===
          expected.duplicateCount) &&
      (!expected.requiresHeartbeatExclusion ||
        fixture.input.recentEventProjection.diagnostics.some(
          (item) => item.reasonCode === "EXCLUDED_HEARTBEAT_OR_STREAM_NOISE"
        )) &&
      (!expected.requiresDistinctIdentityStreams ||
        first.currentWorkstreams.workstreams.length === 2) &&
      activeResultUnchanged &&
      !first.focusAwareAttentionShadow.candidateUniverseChanged &&
      first.focusAwareAttentionShadow.eligibilityDiffCount === 0 &&
      deterministic &&
      privacySentinelLeakageCount === 0 &&
      contextOnlyLeakageCount === 0 &&
      staleCurrentnessViolationCount === 0;
    return currentFocusCaseResultSchema.parse({
      caseId,
      scenario: fixture.scenario,
      status: invariantsMatch ? "passed" : "failed",
      inputSha256,
      focusStatus: first.currentFocus.status,
      workstreamCount: first.currentWorkstreams.workstreams.length,
      latestEventKind: selected?.latestMeaningfulEvent.kind ?? null,
      completionState: selected?.completionState ?? null,
      activeBlocker: selected?.activeBlocker ?? null,
      relatedSources: workstream?.relatedSources ?? [],
      historicalEventKinds,
      existingTopCandidateId:
        first.focusAwareAttentionShadow.existingTopCandidateId,
      counterfactualTopCandidateId:
        first.focusAwareAttentionShadow.counterfactualTopCandidateId,
      wouldSwitch: first.focusAwareAttentionShadow.wouldSwitch,
      activeResultUnchanged,
      candidateUniverseChanged:
        first.focusAwareAttentionShadow.candidateUniverseChanged,
      eligibilityDiffCount: first.focusAwareAttentionShadow.eligibilityDiffCount,
      deterministic,
      contextOnlyLeakageCount,
      staleCurrentnessViolationCount,
      privacySentinelLeakageCount,
      dependencyTamperAcceptedCount: 0,
      reasonCodes: [
        ...first.currentFocus.reasonCodes,
        ...first.focusAwareAttentionShadow.reasonCodes
      ]
    });
  } catch {
    return currentFocusCaseResultSchema.parse({
      caseId,
      scenario: fixture.scenario,
      status: "failed",
      inputSha256,
      focusStatus: "rejected",
      workstreamCount: 0,
      latestEventKind: null,
      completionState: null,
      activeBlocker: null,
      relatedSources: [],
      historicalEventKinds: [],
      existingTopCandidateId: null,
      counterfactualTopCandidateId: null,
      wouldSwitch: false,
      activeResultUnchanged: true,
      candidateUniverseChanged: false,
      eligibilityDiffCount: 0,
      deterministic: false,
      contextOnlyLeakageCount: 0,
      staleCurrentnessViolationCount: 0,
      privacySentinelLeakageCount: 0,
      dependencyTamperAcceptedCount: 0,
      reasonCodes: ["CASE_EXECUTION_FAILED"]
    });
  }
}

function resolveFixture(
  recentEventProjection: RecentMeaningfulEventProjection,
  fixture: CurrentFocusEvaluationFixture
): {
  currentWorkstreams: CurrentWorkstreamProjection;
  currentFocus: CurrentFocusProjection;
  focusAwareAttentionShadow: FocusAwareAttentionShadowProjection;
} {
  const currentWorkstreams = reconstructCurrentWorkStreams({
    asOf: fixture.input.asOf,
    recentEventProjection,
    workRelationProjection: fixture.input.workRelationProjection,
    artifactRelationProjection: fixture.input.artifactRelationProjection,
    claimAuthorityProjection: fixture.input.claimAuthorityProjection
  });
  const currentFocus = resolveCurrentFocus({
    asOf: fixture.input.asOf,
    recentEventProjection,
    workstreamProjection: currentWorkstreams,
    workRelationProjection: fixture.input.workRelationProjection,
    artifactRelationProjection: fixture.input.artifactRelationProjection,
    claimAuthorityProjection: fixture.input.claimAuthorityProjection
  });
  const focusAwareAttentionShadow = resolveFocusAwareAttentionShadow({
    asOf: fixture.input.asOf,
    currentFocus,
    activeAttentionResult: fixture.input.activeAttentionResult,
    eligibilityProjectionSha256: fixture.input.eligibilityProjectionSha256,
    workRelationProjectionSha256:
      fixture.input.workRelationProjection.projectionSha256,
    claimAuthorityProjectionSha256:
      fixture.input.claimAuthorityProjection.projectionSha256
  });
  return { currentWorkstreams, currentFocus, focusAwareAttentionShadow };
}

function rejectsTamperedDependency(
  fixture: CurrentFocusEvaluationFixture
): boolean {
  const tamperedHash = fixture.tamperedWorkRelationProjectionSha256;
  if (tamperedHash === null) return false;
  const { projectionSha256: _projectionSha256, ...content } =
    fixture.input.recentEventProjection;
  const tamperedProjection = sealRecentMeaningfulEventProjection({
    ...content,
    dependencies: {
      ...content.dependencies,
      workRelationProjectionSha256: tamperedHash
    }
  });
  try {
    reconstructCurrentWorkStreams({
      asOf: fixture.input.asOf,
      recentEventProjection: tamperedProjection,
      workRelationProjection: fixture.input.workRelationProjection,
      artifactRelationProjection: fixture.input.artifactRelationProjection,
      claimAuthorityProjection: fixture.input.claimAuthorityProjection
    });
    return false;
  } catch {
    return true;
  }
}

function permutationMatches(
  fixture: CurrentFocusEvaluationFixture,
  baseline: ReturnType<typeof resolveFixture>
): boolean {
  if (fixture.permutedRecentEventProjection === null) return true;
  const permuted = resolveFixture(fixture.permutedRecentEventProjection, fixture);
  return (
    permuted.currentWorkstreams.projectionSha256 ===
      baseline.currentWorkstreams.projectionSha256 &&
    permuted.currentFocus.projectionSha256 === baseline.currentFocus.projectionSha256 &&
    permuted.focusAwareAttentionShadow.projectionSha256 ===
      baseline.focusAwareAttentionShadow.projectionSha256
  );
}

function privacyLeakageCount(
  fixture: CurrentFocusEvaluationFixture,
  output: ReturnType<typeof resolveFixture>
): number {
  if (!fixture.expectation.requiresPrivacyIsolation) return 0;
  const serialized = JSON.stringify(output);
  const sentinelCount = fixture.privateSentinels.filter((sentinel) =>
    serialized.includes(sentinel)
  ).length;
  const structuralPatterns = [
    /\/Users\//u,
    /"(?:token|command|prompt|conversation|rawThreadId)"\s*:/u,
    /\b[a-f0-9]{40}\b/u
  ];
  return (
    sentinelCount +
    structuralPatterns.filter((pattern) => pattern.test(serialized)).length
  );
}

function currentFocusVersions(): Record<string, string> {
  return {
    githubSnapshotSchema: "github-snapshot-v6",
    githubPushNormalizer:
      GITHUB_PUSH_ARTIFACT_WORK_SIGNAL_NORMALIZER_VERSION,
    githubNativeActivityNormalizer:
      GITHUB_NATIVE_ACTIVITY_WORK_SIGNAL_NORMALIZER_VERSION,
    artifactRelationSchema: ARTIFACT_RELATION_SCHEMA_VERSION,
    artifactRelationResolver:
      MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    artifactRelationEvidence:
      ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    recentEventSchema: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    recentEventRule: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    recentEventId: RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    workstreamSchema: CURRENT_WORKSTREAM_SCHEMA_VERSION,
    workstreamReconstruction: CURRENT_WORKSTREAM_RECONSTRUCTION_RULE_VERSION,
    workstreamCurrentness: CURRENT_WORKSTREAM_CURRENTNESS_POLICY_VERSION,
    workstreamId: CURRENT_WORKSTREAM_ID_POLICY_VERSION,
    currentFocusSchema: CURRENT_FOCUS_SCHEMA_VERSION,
    currentFocusSelection: CURRENT_FOCUS_SELECTION_POLICY_VERSION,
    currentFocusId: CURRENT_FOCUS_ID_POLICY_VERSION,
    shadowSchema: FOCUS_AWARE_ATTENTION_SHADOW_SCHEMA_VERSION,
    shadowRanking: FOCUS_AWARE_ATTENTION_RANKING_POLICY_VERSION,
    shadowResolver: FOCUS_AWARE_ATTENTION_SHADOW_RESOLVER_VERSION,
    rollout: CURRENT_FOCUS_SHADOW_ROLLOUT_VERSION
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function sum<K extends keyof CurrentFocusEvaluationCaseResult>(
  records: CurrentFocusEvaluationCaseResult[],
  key: K
): number {
  return records.reduce((total, record) => {
    const value = record[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}
