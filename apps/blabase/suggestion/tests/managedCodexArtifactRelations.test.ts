import { describe, expect, it } from "vitest";

import { LIVE_ATTENTION_FRESHNESS_POLICY } from "../src/attention/liveAttention";
import {
  attachWorkArtifactAttribution,
  createGitHubArtifactId,
  createEmptyWorkArtifactAttributionStore,
  detachWorkArtifactAttribution,
  managedCodexArtifactRelationProjectionSchema,
  resolveManagedCodexArtifactRelations
} from "../src/artifacts";
import type { GitHubSnapshot } from "../src/connectors/github/types";
import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import {
  MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
  MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
  WORK_RELATION_EVIDENCE_POLICY_VERSION,
  WORK_RELATION_SCHEMA_VERSION
} from "../src/crossSource/versions";
import {
  sealManagedCodexWorkRelationProjection,
  type ManagedCodexWorkRelationProjection
} from "../src/relations";

const AS_OF = "2026-08-01T00:00:00.000Z";
const RUN = `managed_run_${"1".repeat(32)}`;
const BINDING = `binding_${"2".repeat(32)}`;
const EXECUTION = `codex:execution:${"3".repeat(24)}`;
const EXECUTES_RELATION = `relation_${"4".repeat(32)}`;

describe("managed Codex artifact relation resolver", () => {
  it("creates a hard produces relation only from an explicit exact attribution", () => {
    const store = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(AS_OF),
      {
        ...producer(),
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: "a".repeat(40)
        },
        attachedAt: AS_OF,
        explicitUserConfirmation: true
      }
    ).store;
    const result = resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection: workProjection(),
      attributionStore: store,
      githubBatch: null
    });

    expect(
      managedCodexArtifactRelationProjectionSchema.parse(result)
    ).toEqual(result);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]).toMatchObject({
      managedRunId: RUN,
      bindingId: BINDING,
      executionId: EXECUTION,
      executesRelationId: EXECUTES_RELATION,
      type: "produces",
      authority: "user_configured",
      artifact: {
        kind: "github_commit",
        repositoryId: 101,
        oid: "a".repeat(40)
      },
      attributionLifecycle: {
        state: "active",
        supersededByAttributionId: null
      },
      githubObservation: { status: "unavailable" },
      attentionDisposition: "not_connected",
      forbiddenAsAttentionCandidate: true
    });
  });

  it("corroborates an exact PR native object without using its title", () => {
    const store = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(AS_OF),
      {
        ...producer(),
        artifact: {
          kind: "github_pull_request",
          repositoryId: 101,
          objectId: 9001,
          number: 42
        },
        attachedAt: AS_OF,
        explicitUserConfirmation: true
      }
    ).store;
    const githubBatch = normalizedGitHubBatch();
    const result = resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection: workProjection(),
      attributionStore: store,
      githubBatch
    });

    expect(result.relations[0]?.githubObservation).toMatchObject({
      status: "current",
      sourceSnapshotSha256: githubBatch.sourceSnapshotSha256,
      destinationUrl: null
    });
    expect(JSON.stringify(result)).not.toContain(
      "PRIVATE_PR_TITLE_SENTINEL"
    );
    expect(JSON.stringify(result)).not.toContain("biadone/blabase");
  });

  it("keeps opaque v4 push verification outside the v0.1 artifact projection", () => {
    const oid = "a".repeat(40);
    const store = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(AS_OF),
      {
        ...producer(),
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid
        },
        attachedAt: AS_OF,
        explicitUserConfirmation: true
      }
    ).store;
    const githubBatch = normalizedGitHubBatch(githubPushSnapshot(oid));
    const push = githubBatch.signals.find(
      (signal) => signal.kind === "activity_observation"
    );
    const result = resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection: workProjection(),
      attributionStore: store,
      githubBatch
    });

    expect(push).toMatchObject({
      kind: "activity_observation",
      sourceScopeId: "repository:101",
      facts: {
        activityKind: "push",
        artifactId: createGitHubArtifactId({
          kind: "github_commit",
          repositoryId: 101,
          oid
        })
      }
    });
    expect(result.relations[0]?.githubObservation).toEqual({
      status: "not_observed",
      sourceSnapshotSha256: githubBatch.sourceSnapshotSha256,
      signalIds: [],
      destinationUrl: null,
      sourceUpdatedAt: null,
      completeness: "complete"
    });
    expect(JSON.stringify(githubBatch)).not.toContain(oid);
  });

  it("keeps a legacy push project-level and does not infer a commit observation", () => {
    const oid = "a".repeat(40);
    const store = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(AS_OF),
      {
        ...producer(),
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid
        },
        attachedAt: AS_OF,
        explicitUserConfirmation: true
      }
    ).store;
    const githubBatch = normalizedGitHubBatch(legacyPushSnapshot());
    const result = resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection: workProjection(),
      attributionStore: store,
      githubBatch
    });

    expect(
      githubBatch.signals.find(
        (signal) => signal.kind === "activity_observation"
      )
    ).not.toHaveProperty("facts.artifactId");
    expect(result.relations[0]?.githubObservation).toMatchObject({
      status: "not_observed",
      sourceSnapshotSha256: githubBatch.sourceSnapshotSha256,
      signalIds: []
    });
  });

  it("preserves detached lineage but exposes no active attribution", () => {
    const attached = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(AS_OF),
      {
        ...producer(),
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: "b".repeat(40)
        },
        attachedAt: AS_OF,
        explicitUserConfirmation: true
      }
    );
    const later = "2026-08-01T00:00:01.000Z";
    const detached = detachWorkArtifactAttribution(attached.store, {
      attributionId: attached.decision.attributionId,
      detachedAt: later,
      explicitUserConfirmation: true
    });
    const result = resolveManagedCodexArtifactRelations({
      asOf: later,
      workRelationProjection: workProjection(later),
      attributionStore: detached.store,
      githubBatch: normalizedGitHubBatch(
        githubPushSnapshot("b".repeat(40), later),
        later
      )
    });

    expect(result.relations).toHaveLength(1);
    expect(result.relations[0]?.attributionLifecycle).toEqual({
      state: "superseded_by_detach",
      supersededByAttributionId:
        detached.decision.attributionId
    });
    expect(
      result.relations.filter(
        (relation) => relation.attributionLifecycle.state === "active"
      )
    ).toEqual([]);
    expect(result.relations[0]?.githubObservation.status).toBe(
      "not_observed"
    );
  });

  it("does not infer produces from executes, lifecycle, project, or title alone", () => {
    const result = resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection: workProjection(),
      attributionStore: createEmptyWorkArtifactAttributionStore(AS_OF),
      githubBatch: normalizedGitHubBatch()
    });

    expect(result).toMatchObject({
      totalAttachDecisionCount: 0,
      unresolvedAttributionCount: 0,
      relations: [],
      attentionDisposition: "not_connected",
      forbiddenAsAttentionCandidate: true
    });
  });

  it("fails closed when run, binding, or execution identity is not exact", () => {
    const store = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(AS_OF),
      {
        ...producer(),
        bindingId: `binding_${"9".repeat(32)}`,
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: "c".repeat(40)
        },
        attachedAt: AS_OF,
        explicitUserConfirmation: true
      }
    ).store;
    const result = resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection: workProjection(),
      attributionStore: store,
      githubBatch: null
    });

    expect(result.relations).toEqual([]);
    expect(result.unresolvedAttributionCount).toBe(1);
  });

  it("rejects future evidence and a tampered projection hash", () => {
    const futureStore = attachWorkArtifactAttribution(
      createEmptyWorkArtifactAttributionStore(AS_OF),
      {
        ...producer(),
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: "d".repeat(40)
        },
        attachedAt: "2026-08-01T00:00:01.000Z",
        explicitUserConfirmation: true
      }
    ).store;
    expect(() =>
      resolveManagedCodexArtifactRelations({
        asOf: AS_OF,
        workRelationProjection: workProjection(),
        attributionStore: futureStore,
        githubBatch: null
      })
    ).toThrow(/newer than the projection/);

    const valid = resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection: workProjection(),
      attributionStore: createEmptyWorkArtifactAttributionStore(AS_OF),
      githubBatch: null
    });
    expect(
      managedCodexArtifactRelationProjectionSchema.safeParse({
        ...valid,
        inputSha256: "f".repeat(64)
      }).success
    ).toBe(false);
  });
});

function producer() {
  return {
    managedRunId: RUN,
    bindingId: BINDING,
    executionId: EXECUTION,
    executesRelationId: EXECUTES_RELATION
  };
}

function workProjection(
  asOf = AS_OF
): ManagedCodexWorkRelationProjection {
  return sealManagedCodexWorkRelationProjection({
    contract: MANAGED_CODEX_WORK_RELATION_PROJECTION_CONTRACT,
    schemaVersion: WORK_RELATION_SCHEMA_VERSION,
    resolverVersion:
      MANAGED_CODEX_WORK_RELATION_RESOLVER_VERSION,
    evidencePolicyVersion: WORK_RELATION_EVIDENCE_POLICY_VERSION,
    asOf,
    managedSourceRevision: 1,
    managedGeneratedAt: asOf,
    bindingStoreRevision: 1,
    bindingStoreSha256: "1".repeat(64),
    contextRegistrySha256: null,
    githubBatchSha256: null,
    githubSourceSnapshotSha256: null,
    totalManagedRunCount: 1,
    omittedManagedRunCount: 0,
    relations: [
      {
        relationId: EXECUTES_RELATION,
        managedRunIds: [RUN],
        bindingId: BINDING,
        type: "executes",
        authority: "user_configured",
        from: {
          kind: "execution",
          source: "codex",
          subjectId: EXECUTION
        },
        to: {
          kind: "work_item",
          source: "github",
          subjectId: "github:object:8001"
        },
        bindingEvidence: {
          bindingId: BINDING,
          boundAt: asOf,
          decisionSource: "explicit_user",
          bindingState: "active",
          supersededByBindingId: null
        },
        githubObservation: {
          status: "unavailable",
          sourceSnapshotSha256: null,
          signalIds: [],
          objectType: null,
          taskKind: null,
          number: null,
          destinationUrl: null,
          sourceUpdatedAt: null,
          completeness: null
        },
        projectAlignment: {
          status: "unavailable",
          projectId: null,
          codexMappingDecisionId: null,
          githubMappingDecisionId: null
        },
        identityStatus: "resolved",
        conflictCodes: [],
        attentionDisposition: "not_connected",
        forbiddenAsAttentionCandidate: true
      }
    ],
    runResolutions: [
      {
        managedRunId: RUN,
        bindingId: BINDING,
        executionId: EXECUTION,
        status: "resolved",
        relationId: EXECUTES_RELATION
      }
    ],
    inputSha256: "2".repeat(64),
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function normalizedGitHubBatch(
  snapshot: GitHubSnapshot = githubSnapshot(),
  asOf = AS_OF
) {
  const result = normalizeGitHubSnapshotToWorkSignals(
    snapshot,
    {
      asOf,
      freshnessPolicy: LIVE_ATTENTION_FRESHNESS_POLICY,
      contextRegistrySha256: null
    }
  );
  if (result.status !== "normalized") {
    throw new Error("Expected a normalized GitHub fixture.");
  }
  return result.batch;
}

function githubPushSnapshot(
  oid: string,
  fetchedAt = AS_OF
): GitHubSnapshot {
  const artifactId = createGitHubArtifactId({
    kind: "github_commit",
    repositoryId: 101,
    oid
  });
  return {
    ...githubSnapshot(),
    schemaVersion: "github-snapshot-v4",
    fetchedAt,
    actionabilityCoverage: {
      state: "complete",
      authoredPullRequestCount: 0,
      attemptedCount: 0,
      collectedCount: 0,
      truncated: false
    },
    tasks: [],
    activities: [
      {
        id: `push-${artifactId}`,
        source: "github",
        kind: "user_activity",
        activityKind: "push",
        repositoryId: 101,
        repositoryFullName: "biadone/blabase",
        occurredAt: "2026-07-31T23:59:00.000Z",
        subjectType: "branch",
        subjectNumber: null,
        subjectTitle: null,
        refName: "PRIVATE_BRANCH_SENTINEL",
        reviewState: null,
        artifactId
      }
    ]
  };
}

function legacyPushSnapshot(): GitHubSnapshot {
  return {
    ...githubSnapshot(),
    tasks: [],
    activities: [
      {
        id: "legacy-push",
        source: "github",
        kind: "user_activity",
        activityKind: "push",
        repositoryId: 101,
        repositoryFullName: "biadone/blabase",
        occurredAt: "2026-07-31T23:59:00.000Z",
        subjectType: "branch",
        subjectNumber: null,
        subjectTitle: null,
        refName: "PRIVATE_BRANCH_SENTINEL",
        reviewState: null
      }
    ]
  };
}

function githubSnapshot(): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "client",
    appSlug: "test-app",
    apiVersion: "2026-03-10",
    fetchedAt: AS_OF,
    user: { id: 1, login: "maker" },
    truncated: false,
    activityWindowStart: "2026-07-25T00:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [
      {
        id: 10,
        accountLogin: "biadone",
        accountType: "Organization",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 10,
        fullName: "biadone/blabase",
        private: true,
        archived: false,
        updatedAt: AS_OF
      }
    ],
    tasks: [
      {
        id: 9001,
        source: "github",
        kind: "authored_pull_request",
        repositoryId: 101,
        repositoryFullName: "biadone/blabase",
        number: 42,
        title: "PRIVATE_PR_TITLE_SENTINEL",
        htmlUrl: "https://github.com/biadone/blabase/pull/42",
        labelNames: [],
        milestoneDueAt: null,
        state: "open",
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: AS_OF
      }
    ],
    activities: []
  };
}
