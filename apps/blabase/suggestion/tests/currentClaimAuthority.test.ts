import { describe, expect, it } from "vitest";

import {
  resolveCurrentClaimAuthority
} from "../src/claims";
import {
  sealManagedCodexArtifactRelationProjection
} from "../src/artifacts";
import {
  finalizeRuntimeWorkSignal,
  finalizeRuntimeWorkSignalBatch
} from "../src/crossSource/workSignalIntegrity";
import {
  ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
  ARTIFACT_RELATION_SCHEMA_VERSION,
  GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
  GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
  MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
  RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
  RUNTIME_WORK_SIGNAL_CONTRACT,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../src/crossSource/versions";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";
import {
  buildManagedCodexSemanticProjection,
  CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT,
  CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
  createManagedCodexEvent,
  sealManagedCodexHistory,
  type ManagedCodexPublicProjection
} from "../src/managedCodex";
import { observeCodexManagedNotification } from "../src/connectors/codex/observationContract";
import {
  sealManagedCodexWorkRelationProjection
} from "../src/relations";
import { activeAttentionFixture } from "./fixtures/activeAttentionFixture";

const AS_OF = "2026-08-02T03:00:00.000Z";
const OBSERVED_AT = "2026-08-02T02:50:00.000Z";

describe("current claim authority projection", () => {
  it("collapses compatible multi-role PR observations to the action-driving relationship", () => {
    const projection = activeAttentionFixture({
      githubKind: "authored_pull_request",
      managedScenario: "none",
      additionalGitHubTasks: [
        {
          id: 501,
          kind: "review_requested_pull_request",
          number: 42,
          title: "Synthetic linked task"
        }
      ]
    }).claims;
    const relationships = projection.claims.filter(
      (claim) => claim.field === "github_user_relationship"
    );

    expect(relationships).toHaveLength(1);
    expect(relationships[0]?.value).toEqual({
      type: "enum",
      value: "review_requested_from_user"
    });
    expect(
      projection.conflicts.filter(
        (conflict) => conflict.field === "github_user_relationship"
      )
    ).toEqual([]);
  });

  it("derives only direct GitHub and managed Codex fields and reports unsupported source coverage", () => {
    const batch = githubBatch({ includeWorkItem: true });
    const managed = managedProjection();
    const workRelations = emptyWorkRelations(batch);
    const artifacts = emptyArtifacts(workRelations);
    const projection = resolveCurrentClaimAuthority({
      asOf: AS_OF,
      managedProjection: managed,
      managedSemantics: managedSemantics(managed),
      workRelationProjection: workRelations,
      artifactRelationProjection: artifacts,
      githubBatch: batch,
      contextRegistry: null
    });

    expect(projection.claims.map((claim) => claim.field).sort()).toEqual([
      "github_user_relationship",
      "github_work_item_state",
      "managed_codex_execution_state"
    ]);
    expect(projection.conflicts).toEqual([]);
    expect(projection.sourceCoverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "notion",
          status: "context_only",
          claimFields: []
        }),
        expect.objectContaining({
          source: "google_calendar",
          status: "context_only",
          claimFields: []
        }),
        expect.objectContaining({
          source: "codex_inventory",
          status: "context_only",
          claimFields: []
        })
      ])
    );
    expect(projection.attentionDisposition).toBe("not_connected");
    expect(projection.forbiddenAsAttentionCandidate).toBe(true);

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("PRIVATE_REPOSITORY_NAME");
    expect(serialized).not.toContain("PRIVATE_GITHUB_TITLE");
    expect(serialized).not.toContain("https://github.com");
  });

  it("does not derive a current completed claim from merge activity or snapshot absence", () => {
    const batch = githubBatch({
      includeWorkItem: false,
      includeMergedActivity: true
    });
    const managed = { ...managedProjection(), runs: [] };
    const workRelations = emptyWorkRelations(batch);
    const projection = resolveCurrentClaimAuthority({
      asOf: AS_OF,
      managedProjection: managed,
      managedSemantics: managedSemantics(managed),
      workRelationProjection: workRelations,
      artifactRelationProjection: emptyArtifacts(workRelations),
      githubBatch: batch,
      contextRegistry: null
    });

    expect(projection.claims).toEqual([]);
    expect(JSON.stringify(projection)).not.toContain("completed");
  });

  it("preserves stale GitHub claims without selecting them as current winners", () => {
    const batch = githubBatch({
      includeWorkItem: true,
      freshness: "stale"
    });
    const managed = { ...managedProjection(), runs: [] };
    const workRelations = emptyWorkRelations(batch);
    const projection = resolveCurrentClaimAuthority({
      asOf: AS_OF,
      managedProjection: managed,
      managedSemantics: managedSemantics(managed),
      workRelationProjection: workRelations,
      artifactRelationProjection: emptyArtifacts(workRelations),
      githubBatch: batch,
      contextRegistry: null
    });

    expect(projection.claims.every((claim) => claim.freshness === "stale")).toBe(true);
    expect(
      projection.fieldResolutions.every(
        (resolution) => resolution.status === "insufficient_evidence"
      )
    ).toBe(true);
    expect(
      projection.sourceCoverage.find(
        (coverage) => coverage.source === "github"
      )
    ).toMatchObject({ status: "stale" });
  });

  it("fails closed when Phase 3B does not reference the exact Phase 3A projection", () => {
    const workRelations = emptyWorkRelations();
    const artifacts = emptyArtifacts(workRelations, "9".repeat(64));
    const managed = managedProjection();

    expect(() =>
      resolveCurrentClaimAuthority({
        asOf: AS_OF,
        managedProjection: managed,
        managedSemantics: managedSemantics(managed),
        workRelationProjection: workRelations,
        artifactRelationProjection: artifacts,
        githubBatch: null,
        contextRegistry: null
      })
    ).toThrow(/exact relation projection/);
  });

  it("fails closed when relation projections reference different source inputs", () => {
    const batch = githubBatch({ includeWorkItem: true });
    const incoherentWorkRelations = emptyWorkRelations();
    const managed = managedProjection();

    expect(() =>
      resolveCurrentClaimAuthority({
        asOf: AS_OF,
        managedProjection: managed,
        managedSemantics: managedSemantics(managed),
        workRelationProjection: incoherentWorkRelations,
        artifactRelationProjection: emptyArtifacts(
          incoherentWorkRelations
        ),
        githubBatch: batch,
        contextRegistry: null
      })
    ).toThrow(/exact source dependencies/);
  });

  it("keeps separate managed runs on one execution as separate claim targets", () => {
    const managed = managedProjection();
    const firstRun = managed.runs[0]!;
    const secondRun = {
      ...firstRun,
      managedRunId: `managed_run_${"4".repeat(32)}` as const,
      effectiveExecutionState: "completed" as const,
      lastVerifiedExecutionState: "completed" as const,
      sourceEvent: "turn_completed" as const
    };
    const managedWithRetainedRun = {
      ...managed,
      revision: 2,
      runs: [firstRun, secondRun]
    };
    const workRelations = emptyWorkRelations(null, {
      managedSourceRevision: 2,
      totalManagedRunCount: 2,
      omittedManagedRunCount: 2
    });
    const projection = resolveCurrentClaimAuthority({
      asOf: AS_OF,
      managedProjection: managedWithRetainedRun,
      managedSemantics: managedSemantics(managedWithRetainedRun),
      workRelationProjection: workRelations,
      artifactRelationProjection: emptyArtifacts(workRelations),
      githubBatch: null,
      contextRegistry: null
    });

    const managedClaims = projection.claims.filter(
      (claim) => claim.source === "codex_managed"
    );
    expect(managedClaims).toHaveLength(2);
    expect(new Set(managedClaims.map((claim) => claim.target.ref)).size).toBe(2);
    expect(projection.conflicts).toEqual([]);
  });
});

function emptyWorkRelations(
  batch: ReturnType<typeof githubBatch> | null = null,
  override: Partial<{
    managedSourceRevision: number;
    totalManagedRunCount: number;
    omittedManagedRunCount: number;
  }> = {}
) {
  return sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf: AS_OF,
    managedSourceRevision: override.managedSourceRevision ?? 1,
    managedGeneratedAt: OBSERVED_AT,
    bindingStoreRevision: 0,
    bindingStoreSha256: "1".repeat(64),
    contextRegistrySha256: null,
    githubBatchSha256: batch?.batchSha256 ?? null,
    githubSourceSnapshotSha256:
      batch?.sourceSnapshotSha256 ?? null,
    totalManagedRunCount: override.totalManagedRunCount ?? 0,
    omittedManagedRunCount: override.omittedManagedRunCount ?? 0,
    relations: [],
    runResolutions: [],
    inputSha256: "2".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function emptyArtifacts(
  workRelations: ReturnType<typeof emptyWorkRelations>,
  workRelationProjectionSha256 = workRelations.projectionSha256
) {
  return sealManagedCodexArtifactRelationProjection({
    contract: MANAGED_CODEX_ARTIFACT_RELATION_PROJECTION_CONTRACT,
    schemaVersion: ARTIFACT_RELATION_SCHEMA_VERSION,
    resolverVersion: MANAGED_CODEX_ARTIFACT_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: ARTIFACT_RELATION_EVIDENCE_POLICY_VERSION,
    identityPolicyVersion: GITHUB_ARTIFACT_IDENTITY_POLICY_VERSION,
    asOf: AS_OF,
    workRelationProjectionSha256,
    attributionStoreRevision: 0,
    attributionStoreSha256: "3".repeat(64),
    githubBatchSha256: workRelations.githubBatchSha256,
    githubSourceSnapshotSha256:
      workRelations.githubSourceSnapshotSha256,
    totalAttachDecisionCount: 0,
    unresolvedAttributionCount: 0,
    relations: [],
    inputSha256: "4".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function managedProjection(): ManagedCodexPublicProjection {
  return {
    contract: CODEX_MANAGED_PUBLIC_PROJECTION_CONTRACT,
    revision: 1,
    generatedAt: OBSERVED_AT,
    runs: [
      {
        managedRunId: `managed_run_${"1".repeat(32)}`,
        bindingId: `binding_${"2".repeat(32)}`,
        executionId: `codex:execution:${"3".repeat(24)}`,
        lifecycle: "observing",
        streamState: "connected",
        continuity: "continuous",
        effectiveExecutionState: "running",
        lastVerifiedExecutionState: "running",
        waitingState: null,
        sourceEvent: "turn_started",
        itemType: null,
        lastObservedAt: OBSERVED_AT,
        liveObservationAvailable: true,
        forbiddenAsAttentionCandidate: true
      }
    ]
  };
}

function managedSemantics(projection: ManagedCodexPublicProjection) {
  return buildManagedCodexSemanticProjection({
    sourceRevision: projection.revision,
    generatedAt: projection.generatedAt,
    runs: projection.runs.map((run) => {
      const completed = run.effectiveExecutionState === "completed";
      const observation = observeCodexManagedNotification({
        notification: completed
          ? {
              method: "turn/completed",
              params: {
                threadId: "synthetic-thread",
                turn: { id: "synthetic-turn", status: "completed" }
              }
            }
          : {
              method: "turn/started",
              params: {
                threadId: "synthetic-thread",
                turn: { id: "synthetic-turn", status: "inProgress" }
              }
            },
        executionId: run.executionId.slice("codex:execution:".length),
        expectedThreadId: "synthetic-thread",
        observedAt: run.lastObservedAt,
        sequence: 0
      });
      const event = createManagedCodexEvent({
        managedRunId: run.managedRunId,
        sequence: 0,
        ownerInstanceId: `instance_${"a".repeat(32)}`,
        streamGeneration: `stream_${"b".repeat(32)}`,
        observedAt: run.lastObservedAt,
        retentionAt: run.lastObservedAt,
        kind: "native_notification",
        streamKind: null,
        observation,
        itemType: null,
        previousEventSha256: null
      });
      return {
        run,
        history: sealManagedCodexHistory({
          contract: CODEX_MANAGED_EVENT_HISTORY_CONTRACT,
          managedRunId: run.managedRunId,
          updatedAt: run.lastObservedAt,
          anchor: null,
          events: [event]
        })
      };
    })
  });
}

function githubBatch(input: {
  includeWorkItem: boolean;
  includeMergedActivity?: boolean;
  freshness?: "fresh" | "stale";
}) {
  const snapshotSha256 = "5".repeat(64);
  const signals = [];
  if (input.includeWorkItem) {
    const facts = {
      objectType: "issue" as const,
      taskKind: "assigned_issue" as const,
      state: "open" as const,
      relationship: "assigned_to_user" as const,
      semanticRole: "direct_work_item" as const,
      eligibilityLimit: "none" as const,
      draftState: "not_applicable" as const,
      repositoryFullName: "PRIVATE_REPOSITORY_NAME/project",
      number: 17,
      title: "PRIVATE_GITHUB_TITLE",
      destinationUrl: "https://github.com/private/project/issues/17"
    };
    signals.push(
      finalizeRuntimeWorkSignal({
        contract: RUNTIME_WORK_SIGNAL_CONTRACT,
        sourceSnapshotSha256: snapshotSha256,
        normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
        source: "github",
        subjectId: "github:object:201",
        subjectType: "work_item",
        sourceScopeId: "repository:101",
        projectId: null,
        kind: "work_item_observation",
        facts,
        observedAt: OBSERVED_AT,
        sourceUpdatedAt: OBSERVED_AT,
        validUntil: null,
        directness: "explicit",
        completeness: "complete",
        attentionCapability: "candidate_input",
        evidence: [
          {
            type: "github_query_membership",
            source: "github",
            queryKind: "assigned_open_issue",
            objectId: "201",
            snapshotSha256,
            subjectId: "github:object:201",
            observedAt: OBSERVED_AT,
            sourceUpdatedAt: OBSERVED_AT
          },
          {
            type: "github_object_field",
            source: "github",
            objectId: "201",
            field: "state",
            valueSha256: runtimeSha256({ field: "state", value: "open" }),
            snapshotSha256,
            subjectId: "github:object:201",
            observedAt: OBSERVED_AT,
            sourceUpdatedAt: OBSERVED_AT
          }
        ]
      })
    );
  }
  if (input.includeMergedActivity) {
    const facts = {
      activityKind: "pull_request_merged" as const,
      repositoryFullName: "PRIVATE_REPOSITORY_NAME/project",
      subjectType: "pull_request" as const,
      subjectNumber: 17,
      subjectTitle: "PRIVATE_GITHUB_TITLE",
      refName: null,
      reviewState: null,
      semanticRole: "activity_only" as const
    };
    signals.push(
      finalizeRuntimeWorkSignal({
        contract: RUNTIME_WORK_SIGNAL_CONTRACT,
        sourceSnapshotSha256: snapshotSha256,
        normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
        source: "github",
        subjectId: "github:activity:merged-17",
        subjectType: "source_activity",
        sourceScopeId: "repository:101",
        projectId: null,
        kind: "activity_observation",
        facts,
        observedAt: OBSERVED_AT,
        sourceUpdatedAt: OBSERVED_AT,
        validUntil: null,
        directness: "explicit",
        completeness: "complete",
        attentionCapability: "overview_only",
        evidence: [
          {
            type: "github_activity_record",
            source: "github",
            activityId: "merged-17",
            activityKind: "pull_request_merged",
            valueSha256: runtimeSha256(facts),
            snapshotSha256,
            subjectId: "github:activity:merged-17",
            observedAt: OBSERVED_AT,
            sourceUpdatedAt: OBSERVED_AT
          }
        ]
      })
    );
  }
  const freshness = input.freshness ?? "fresh";
  return finalizeRuntimeWorkSignalBatch({
    contract: RUNTIME_WORK_SIGNAL_BATCH_CONTRACT,
    source: "github",
    sourceSchemaVersion: "github-snapshot-v2",
    collectorVersion: "github-collector-v0.2",
    normalizerVersion: GITHUB_WORK_SIGNAL_NORMALIZER_VERSION,
    workSignalContract: RUNTIME_WORK_SIGNAL_CONTRACT,
    sourceSnapshotSha256: snapshotSha256,
    normalizationInputSha256: "6".repeat(64),
    assessment: {
      contract: RUNTIME_SNAPSHOT_ASSESSMENT_CONTRACT,
      source: "github",
      asOf: AS_OF,
      fetchedAt: OBSERVED_AT,
      freshnessPolicyVersion: "test-freshness-v1",
      freshness,
      completeness: "complete",
      truncated: false,
      candidateSetComplete: true,
      usableForOverview: true,
      usableForCurrentCandidates: freshness === "fresh",
      reasonCodes: [
        freshness === "fresh" ? "SNAPSHOT_FRESH" : "SNAPSHOT_STALE"
      ]
    },
    skippedRecordCount: 0,
    issues: [],
    signals
  });
}
