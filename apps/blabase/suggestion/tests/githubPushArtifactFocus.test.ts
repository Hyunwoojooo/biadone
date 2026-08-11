import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachWorkArtifactAttribution,
  createEmptyWorkArtifactAttributionStore,
  createGitHubArtifactId,
  resolveManagedCodexArtifactRelations
} from "../src/artifacts";
import { resolveCurrentClaimAuthority } from "../src/claims";
import type { GitHubConfig } from "../src/connectors/github/config";
import { fetchAndStoreGitHubSnapshot } from "../src/connectors/github/githubApi";
import { writeStoredGitHubTokens } from "../src/connectors/github/localStore";
import { normalizeGitHubSnapshotToWorkSignals } from "../src/connectors/github/toWorkSignals";
import type {
  GitHubSnapshot,
  GitHubTaskSignal,
  GitHubUserActivitySignal
} from "../src/connectors/github/types";
import { runtimeSha256 } from "../src/crossSource/canonicalHash";
import type { RuntimeWorkSignalBatch } from "../src/crossSource/schema";
import {
  finalizeRuntimeWorkSignal,
  finalizeRuntimeWorkSignalBatch
} from "../src/crossSource/workSignalIntegrity";
import { SNAPSHOT_VALIDITY_POLICY_VERSION } from "../src/crossSource/versions";
import {
  createConfirmedCurrentFocusInput,
  resolveCurrentFocus,
  resolveCurrentFocusFromEvidence
} from "../src/currentFocus";
import {
  createFocusIdentityRef,
  type RecentMeaningfulEvent
} from "../src/recentEvents";
import {
  resolveManagedCodexWorkRelations,
  sealManagedCodexWorkRelationProjection
} from "../src/relations";
import {
  ACTIVE_FIXTURE_AS_OF,
  ACTIVE_FIXTURE_PROJECT_ID,
  activeAttentionFixture
} from "./fixtures/activeAttentionFixture";

const AS_OF = ACTIVE_FIXTURE_AS_OF;
const FETCHED_AT = "2026-08-02T02:59:00.000Z";
const PRIMARY_OID = "a".repeat(40);
const SECONDARY_OID = "b".repeat(40);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.restoreAllMocks();
});

describe("GitHub push artifact Current Focus production path", () => {
  it("upgrades an exact opaque push through verified artifact and work relations", () => {
    const privateTitle = "PRIVATE_PUSH_TASK_TITLE_SENTINEL";
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      artifactKind: "github_commit",
      githubPushOccurredAt: "2026-08-02T02:58:30.000Z",
      githubTitle: privateTitle
    });
    const result = resolveCurrentFocusFromEvidence({
      asOf: AS_OF,
      githubBatch: fixture.githubBatch,
      codexInventoryBatch: null,
      managedPublicProjection: fixture.managedPublicProjection,
      managedSemanticProjection: fixture.managedSemanticProjection,
      managedRunStartedAtById:
        fixture.input.managedRunStartedAtById,
      workRelationProjection: fixture.workRelations,
      artifactRelationProjection: fixture.artifacts,
      claimAuthorityProjection: fixture.claims,
      contextRegistrySha256:
        fixture.workRelations.contextRegistrySha256
    });
    const push = result.recentMeaningfulEvents.events.find(
      (event) => event.kind === "github_push"
    );

    expect(fixture.githubBatch).toMatchObject({
      sourceSchemaVersion: "github-snapshot-v4"
    });
    expect(fixture.artifacts.relations[0]?.githubObservation).toMatchObject({
      status: "not_observed",
      signalIds: []
    });
    expect(push).toMatchObject({
      identityScope: "exact_task",
      displayLabel: "GitHub issue #42",
      relationRefs: expect.arrayContaining([
        expect.stringMatching(/^relation_/u),
        expect.stringMatching(/^artifact_relation_/u)
      ])
    });
    expect(push?.identityRefs).not.toContain(
      createFocusIdentityRef({
        source: "github",
        sourceScopeId: "repository:101",
        subjectType: "branch",
        subjectNumber: null,
        refName: "main"
      })
    );
    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      level: "exact_task",
      projectId: ACTIVE_FIXTURE_PROJECT_ID,
      reasonCodes: expect.arrayContaining([
        "WORKSTREAM_EXPLICIT_WORK_RELATION",
        "WORKSTREAM_VERIFIED_ARTIFACT_RELATION"
      ])
    });
    expect(result.currentFocus).toMatchObject({
      status: "selected",
      selectedFocus: {
        level: "exact_task",
        projectId: ACTIVE_FIXTURE_PROJECT_ID
      }
    });
    expect(JSON.stringify(result)).not.toContain(PRIMARY_OID);
    expect(JSON.stringify(result)).not.toContain(privateTitle);
    expect(JSON.stringify(result)).not.toContain(
      fixture.privateCodexThreadSentinel
    );
  });

  it("excludes a rehashed exact push when its native source timestamp is missing", () => {
    const fixture = activeAttentionFixture({
      managedScenario: "running",
      artifactKind: "github_commit",
      githubPushOccurredAt: "2026-08-02T02:58:30.000Z"
    });
    const sourceBatch = fixture.githubBatch;
    if (sourceBatch === null) {
      throw new TypeError("Expected GitHub batch fixture.");
    }
    const githubBatch = withoutPushSourceTimestamp(
      sourceBatch
    );
    const graph = resolveLifecycleGraph(fixture, githubBatch);
    const result = resolveCurrentFocusFromEvidence(graph.input);

    expect(githubBatch.batchSha256).not.toBe(
      sourceBatch.batchSha256
    );
    expect(
      result.recentMeaningfulEvents.events.some(
        (event) => event.kind === "github_push"
      )
    ).toBe(false);
    expect(
      result.recentMeaningfulEvents.diagnostics.filter(
        (diagnostic) =>
          diagnostic.reasonCode ===
          "EXCLUDED_UNSUPPORTED_TRANSITION_TIMESTAMP"
      )
    ).toEqual([
      expect.objectContaining({
        source: "github",
        eventId: null,
        disposition: "excluded"
      })
    ]);
  });

  it("does not merge distinct attributed commits pushed to the same branch", () => {
    const graph = twoCommitGraph();
    const result = resolveCurrentFocusFromEvidence(graph.input);
    const pushes = result.recentMeaningfulEvents.events
      .filter(
        (event): event is RecentMeaningfulEvent =>
          event.kind === "github_push"
      )
      .sort((left, right) => left.displayLabel.localeCompare(right.displayLabel));

    expect(pushes).toHaveLength(2);
    expect(pushes.map((event) => event.displayLabel)).toEqual([
      "GitHub issue #42",
      "GitHub issue #43"
    ]);
    expect(pushes.every((event) => event.identityScope === "exact_task")).toBe(
      true
    );
    expect(
      pushes[0]!.identityRefs.filter((identityRef) =>
        pushes[1]!.identityRefs.includes(identityRef)
      )
    ).toEqual([]);
    expect(result.currentWorkstreams.workstreams).toHaveLength(2);
    expect(
      result.currentWorkstreams.workstreams.every(
        (workstream) =>
          workstream.level === "exact_task" &&
          workstream.reasonCodes.includes(
            "WORKSTREAM_VERIFIED_ARTIFACT_RELATION"
          )
      )
    ).toBe(true);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PRIMARY_OID);
    expect(serialized).not.toContain(SECONDARY_OID);
    expect(serialized).not.toContain("PRIVATE_SHARED_BRANCH_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_PRIMARY_TITLE_SENTINEL");
    expect(serialized).not.toContain("PRIVATE_SECONDARY_TITLE_SENTINEL");
  });

  it.each([
    {
      taskKind: "assigned_issue" as const,
      terminalKind: "issue_closed" as const,
      subjectType: "issue" as const,
      expectedCompletion: "cancelled" as const
    },
    {
      taskKind: "authored_pull_request" as const,
      terminalKind: "pull_request_merged" as const,
      subjectType: "pull_request" as const,
      expectedCompletion: "completed" as const
    }
  ])(
    "keeps an attributed push in the exact WorkStream after $terminalKind removes the open task",
    ({
      taskKind,
      terminalKind,
      subjectType,
      expectedCompletion
    }) => {
      const fixture = activeAttentionFixture({
        githubKind: taskKind,
        managedScenario: "running",
        artifactKind: "github_commit"
      });
      const openBatch = normalizeLifecycleBatch({
        tasks: [githubTask(501, 42, "PRIVATE_LIFECYCLE_TITLE", taskKind)],
        activities: [
          githubPushV5("push-42", PRIMARY_OID, "2026-08-02T02:58:30.000Z")
        ]
      });
      const openGraph = resolveLifecycleGraph(fixture, openBatch);
      const openResult = resolveCurrentFocusFromEvidence(openGraph.input);
      const openWorkstream = openResult.currentWorkstreams.workstreams[0];

      expect(openResult.currentWorkstreams.workstreams).toHaveLength(1);
      expect(openWorkstream).toBeDefined();

      const terminalBatch = normalizeLifecycleBatch({
        tasks: [],
        activities: [
          githubPushV5("push-42", PRIMARY_OID, "2026-08-02T02:58:30.000Z"),
          githubLifecycleActivity({
            id: "terminal-42",
            activityKind: terminalKind,
            subjectType,
            occurredAt: "2026-08-02T02:59:00.000Z"
          })
        ]
      });
      expect(terminalBatch).toMatchObject({
        sourceSchemaVersion: "github-snapshot-v6",
        signals: expect.arrayContaining([
          expect.objectContaining({
            kind: "activity_observation",
            facts: expect.objectContaining({
              nativeSubjectId: "github:object:501"
            })
          })
        ])
      });
      const terminalGraph = resolveLifecycleGraph(fixture, terminalBatch);
      const terminalResult = resolveCurrentFocusFromEvidence(
        terminalGraph.input
      );
      const terminalWorkstream =
        terminalResult.currentWorkstreams.workstreams[0];

      expect(terminalResult.currentWorkstreams.workstreams).toHaveLength(1);
      expect(terminalWorkstream).toMatchObject({
        workstreamId: openWorkstream!.workstreamId,
        completionState: expectedCompletion,
        latestMeaningfulEvent: {
          kind:
            terminalKind === "issue_closed"
              ? "github_issue_closed"
              : "github_pull_request_merged"
        },
        reasonCodes: expect.arrayContaining([
          "WORKSTREAM_EXPLICIT_WORK_RELATION",
          "WORKSTREAM_VERIFIED_ARTIFACT_RELATION",
          "WORKSTREAM_TERMINAL_STATE_PRESERVED"
        ])
      });
      expect(
        terminalWorkstream?.historicalEventRefs.some((eventId) =>
          terminalResult.recentMeaningfulEvents.events.some(
            (event) =>
              event.eventId === eventId && event.kind === "github_push"
          )
        )
      ).toBe(true);

      const explicit = resolveCurrentFocus({
        asOf: AS_OF,
        recentEventProjection: terminalResult.recentMeaningfulEvents,
        workstreamProjection: terminalResult.currentWorkstreams,
        workRelationProjection: terminalGraph.workRelations,
        artifactRelationProjection: terminalGraph.artifacts,
        claimAuthorityProjection: terminalGraph.claims,
        explicitFocus: createConfirmedCurrentFocusInput({
          workstreamId: openWorkstream!.workstreamId,
          confirmedAt: "2026-08-02T02:58:45.000Z",
          validUntil: "2026-08-03T02:58:45.000Z"
        })
      });
      expect(explicit).toMatchObject({
        status: "selected",
        explicitFocusApplied: true,
        selectedFocus: {
          workstreamId: openWorkstream!.workstreamId,
          completionState: expectedCompletion
        }
      });

      const serialized = JSON.stringify(terminalResult);
      expect(serialized).not.toContain(PRIMARY_OID);
      expect(serialized).not.toContain("PRIVATE_LIFECYCLE_TITLE");
      expect(serialized).not.toContain("github:object:501");
      expect(serialized).not.toContain(fixture.privateCodexThreadSentinel);
    }
  );

  it("canonicalizes a distinct PullRequestEvent ID through the Issues API before WorkStream reconstruction", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "blabase-pr-identity-"));
    temporaryDirectories.push(cwd);
    const config = githubTestConfig();
    await writeStoredGitHubTokens(
      {
        appClientId: config.clientId,
        appSlug: config.appSlug,
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: "2026-08-03T03:00:00.000Z",
        refreshTokenExpiresAt: "2027-02-03T03:00:00.000Z",
        tokenType: "bearer",
        scope: ""
      },
      cwd
    );
    const rawPullRequestId = 9_501;
    const issueObjectId = 501;
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.pathname === "/user") {
        return jsonResponse({ id: 7, login: "synthetic" });
      }
      if (url.pathname === "/user/installations") {
        return jsonResponse({
          total_count: 1,
          installations: [
            {
              id: 10,
              account: { login: "synthetic", type: "User" },
              repository_selection: "selected",
              suspended_at: null
            }
          ]
        });
      }
      if (url.pathname === "/user/installations/10/repositories") {
        return jsonResponse({
          total_count: 1,
          repositories: [
            {
              id: 101,
              full_name: "synthetic/private",
              private: true,
              archived: false,
              updated_at: FETCHED_AT
            }
          ]
        });
      }
      if (url.pathname === "/issues") return jsonResponse([]);
      if (url.pathname === "/search/issues") {
        return jsonResponse({
          total_count: 0,
          incomplete_results: false,
          items: []
        });
      }
      if (url.pathname === "/users/synthetic/events") {
        return jsonResponse([
          githubApiEvent("push-42", "PushEvent", "2026-08-02T02:58:30.000Z", {
            ref: "refs/heads/private-raw-branch",
            head: PRIMARY_OID
          }),
          githubApiEvent(
            "merge-42",
            "PullRequestEvent",
            "2026-08-02T02:59:00.000Z",
            {
              action: "closed",
              pull_request: {
                id: rawPullRequestId,
                number: 42,
                title: "PRIVATE_RAW_PR_TITLE",
                merged: true
              }
            }
          )
        ]);
      }
      if (url.pathname === "/repos/synthetic/private/issues/42") {
        return jsonResponse({
          id: issueObjectId,
          number: 42,
          pull_request: { url: "PRIVATE_RAW_ISSUE_LINK" }
        });
      }
      throw new Error(`Unexpected GitHub test URL: ${url.pathname}`);
    }) as unknown as typeof fetch;

    const snapshot = await fetchAndStoreGitHubSnapshot(config, {
      now: new Date(FETCHED_AT),
      fetchImpl,
      cwd
    });
    expect(snapshot.tasks).toEqual([]);
    expect(
      snapshot.activities.find((activity) => activity.id === "merge-42")
    ).toMatchObject({
      subjectType: "pull_request",
      subjectNumber: 42,
      subjectObjectId: issueObjectId
    });
    const normalized = normalizeGitHubSnapshotToWorkSignals(snapshot, {
      asOf: AS_OF,
      freshnessPolicy: {
        version: SNAPSHOT_VALIDITY_POLICY_VERSION,
        maxAgeMsBySource: {
          github: 10 * 60 * 1_000,
          codex: 10 * 60 * 1_000
        },
        maxFutureClockSkewMs: 60_000
      },
      contextRegistrySha256: null,
      resolveProjectId: () => ACTIVE_FIXTURE_PROJECT_ID
    });
    if (normalized.status !== "normalized") {
      throw new TypeError("Expected fetched GitHub v5 snapshot to normalize.");
    }
    const fixture = activeAttentionFixture({
      githubKind: "authored_pull_request",
      managedScenario: "running",
      artifactKind: "github_commit"
    });
    const graph = resolveLifecycleGraph(fixture, normalized.batch);
    const result = resolveCurrentFocusFromEvidence(graph.input);

    expect(result.currentWorkstreams.workstreams).toHaveLength(1);
    expect(result.currentWorkstreams.workstreams[0]).toMatchObject({
      completionState: "completed",
      latestMeaningfulEvent: { kind: "github_pull_request_merged" },
      reasonCodes: expect.arrayContaining([
        "WORKSTREAM_EXPLICIT_WORK_RELATION",
        "WORKSTREAM_VERIFIED_ARTIFACT_RELATION",
        "WORKSTREAM_TERMINAL_STATE_PRESERVED"
      ])
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(`github:object:${rawPullRequestId}`);
    expect(serialized).not.toContain(`github:object:${issueObjectId}`);
    expect(serialized).not.toContain("PRIVATE_RAW_PR_TITLE");
    expect(serialized).not.toContain("PRIVATE_RAW_ISSUE_LINK");
    expect(serialized).not.toContain(PRIMARY_OID);
  });
});

function githubTestConfig(): GitHubConfig {
  return {
    clientId: "Iv1.current-focus-test",
    clientSecret: "test-client-secret",
    appSlug: "current-focus-test",
    redirectUri: "http://127.0.0.1:3000/api/connectors/github/callback",
    installationEndpoint: "https://github.com/apps",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    apiBaseUrl: "https://api.github.com",
    apiVersion: "2022-11-28"
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function githubApiEvent(
  id: string,
  type: "PushEvent" | "PullRequestEvent",
  createdAt: string,
  payload: unknown
) {
  return {
    id,
    type,
    actor: { login: "synthetic" },
    repo: { id: 101, name: "synthetic/private" },
    payload,
    created_at: createdAt
  };
}

function resolveLifecycleGraph(
  fixture: ReturnType<typeof activeAttentionFixture>,
  githubBatch: RuntimeWorkSignalBatch
) {
  const workRelations = resolveManagedCodexWorkRelations({
    asOf: AS_OF,
    managedProjection: fixture.managedPublicProjection,
    bindingStore: fixture.bindingStore,
    githubBatch,
    contextRegistry: fixture.contextRegistry
  });
  const artifacts = resolveManagedCodexArtifactRelations({
    asOf: AS_OF,
    workRelationProjection: workRelations,
    attributionStore: fixture.artifactStore,
    githubBatch
  });
  const claims = resolveCurrentClaimAuthority({
    asOf: AS_OF,
    managedProjection: fixture.managedPublicProjection,
    managedSemantics: fixture.managedSemanticProjection,
    workRelationProjection: workRelations,
    artifactRelationProjection: artifacts,
    githubBatch,
    contextRegistry: fixture.contextRegistry
  });
  return {
    workRelations,
    artifacts,
    claims,
    input: {
      asOf: AS_OF,
      githubBatch,
      codexInventoryBatch: null,
      managedPublicProjection: fixture.managedPublicProjection,
      managedSemanticProjection: fixture.managedSemanticProjection,
      managedRunStartedAtById: fixture.input.managedRunStartedAtById,
      workRelationProjection: workRelations,
      artifactRelationProjection: artifacts,
      claimAuthorityProjection: claims,
      contextRegistrySha256: fixture.contextRegistry.registrySha256
    }
  };
}

function twoCommitGraph() {
  const fixture = activeAttentionFixture({
    managedScenario: "running",
    secondManagedFailure: true,
    additionalGitHubTasks: [
      {
        id: 502,
        kind: "assigned_issue",
        number: 43,
        title: "Fixture second task"
      }
    ]
  });
  const githubBatch = normalizePushBatch();
  const workRelationProjection = rebuildWorkRelations(
    fixture.workRelations,
    githubBatch
  );
  let attributionStore = createEmptyWorkArtifactAttributionStore(
    "2026-08-02T02:40:00.000Z"
  );
  const attachments = [
    {
      subjectId: "github:object:501",
      oid: PRIMARY_OID,
      attachedAt: "2026-08-02T02:57:00.000Z"
    },
    {
      subjectId: "github:object:502",
      oid: SECONDARY_OID,
      attachedAt: "2026-08-02T02:57:01.000Z"
    }
  ];
  for (const attachment of attachments) {
    const relation = workRelationProjection.relations.find(
      (candidate) => candidate.to.subjectId === attachment.subjectId
    );
    if (!relation) throw new TypeError("Expected exact work relation.");
    attributionStore = attachWorkArtifactAttribution(
      attributionStore,
      {
        managedRunId: relation.managedRunIds[0]!,
        bindingId: relation.bindingId,
        executionId: relation.from.subjectId,
        executesRelationId: relation.relationId,
        artifact: {
          kind: "github_commit",
          repositoryId: 101,
          oid: attachment.oid
        },
        attachedAt: attachment.attachedAt,
        explicitUserConfirmation: true
      }
    ).store;
  }
  const artifactRelationProjection =
    resolveManagedCodexArtifactRelations({
      asOf: AS_OF,
      workRelationProjection,
      attributionStore,
      githubBatch
    });
  const claimAuthorityProjection = resolveCurrentClaimAuthority({
    asOf: AS_OF,
    managedProjection: fixture.managedPublicProjection,
    managedSemantics: fixture.managedSemanticProjection,
    workRelationProjection,
    artifactRelationProjection,
    githubBatch,
    contextRegistry: null
  });

  return {
    input: {
      asOf: AS_OF,
      githubBatch,
      codexInventoryBatch: null,
      managedPublicProjection: fixture.managedPublicProjection,
      managedSemanticProjection: fixture.managedSemanticProjection,
      managedRunStartedAtById:
        fixture.input.managedRunStartedAtById,
      workRelationProjection,
      artifactRelationProjection,
      claimAuthorityProjection,
      contextRegistrySha256: null
    }
  };
}

function rebuildWorkRelations(
  source: ReturnType<typeof activeAttentionFixture>["workRelations"],
  githubBatch: RuntimeWorkSignalBatch
) {
  const workSignals = new Map(
    githubBatch.signals
      .filter((signal) => signal.kind === "work_item_observation")
      .map((signal) => [signal.subjectId, signal])
  );
  const relations = source.relations.map((relation) => {
    const signal = workSignals.get(relation.to.subjectId);
    if (!signal) throw new TypeError("Expected exact GitHub work signal.");
    return {
      ...relation,
      githubObservation: {
        status: "current" as const,
        sourceSnapshotSha256: githubBatch.sourceSnapshotSha256,
        signalIds: [signal.signalId],
        objectType: signal.facts.objectType,
        taskKind: signal.facts.taskKind,
        number: signal.facts.number,
        destinationUrl: null,
        sourceUpdatedAt: signal.sourceUpdatedAt,
        completeness: "complete" as const
      },
      projectAlignment: {
        status: "aligned" as const,
        projectId: ACTIVE_FIXTURE_PROJECT_ID,
        codexMappingDecisionId: null,
        githubMappingDecisionId: null
      }
    };
  });
  const { projectionSha256: _projectionSha256, ...content } = source;
  return sealManagedCodexWorkRelationProjection({
    ...content,
    contextRegistrySha256: null,
    githubBatchSha256: githubBatch.batchSha256,
    githubSourceSnapshotSha256: githubBatch.sourceSnapshotSha256,
    relations,
    inputSha256: runtimeSha256({
      domain: "github-push-artifact-work-relation-test-v0.1",
      githubBatchSha256: githubBatch.batchSha256,
      relationIds: relations.map((relation) => relation.relationId)
    })
  });
}

function normalizePushBatch(): RuntimeWorkSignalBatch {
  const snapshot: GitHubSnapshot = {
    schemaVersion: "github-snapshot-v4",
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: FETCHED_AT,
    user: { id: 1, login: "synthetic" },
    truncated: false,
    activityWindowStart: "2026-07-25T00:00:00.000Z",
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
        id: 1,
        accountLogin: "synthetic",
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
        installationId: 1,
        fullName: "synthetic/private",
        private: true,
        archived: false,
        updatedAt: FETCHED_AT
      }
    ],
    tasks: [
      githubTask(501, 42, "PRIVATE_PRIMARY_TITLE_SENTINEL"),
      githubTask(502, 43, "PRIVATE_SECONDARY_TITLE_SENTINEL")
    ],
    activities: [
      githubPush("primary-push", PRIMARY_OID, "2026-08-02T02:58:00.000Z"),
      githubPush(
        "secondary-push",
        SECONDARY_OID,
        "2026-08-02T02:58:30.000Z"
      )
    ]
  };
  const normalized = normalizeGitHubSnapshotToWorkSignals(snapshot, {
    asOf: AS_OF,
    freshnessPolicy: {
      version: SNAPSHOT_VALIDITY_POLICY_VERSION,
      maxAgeMsBySource: {
        github: 10 * 60 * 1_000,
        codex: 10 * 60 * 1_000
      },
      maxFutureClockSkewMs: 60_000
    },
    contextRegistrySha256: null,
    resolveProjectId: () => ACTIVE_FIXTURE_PROJECT_ID
  });
  if (normalized.status !== "normalized") {
    throw new TypeError("Expected a normalized GitHub v4 push batch.");
  }
  return normalized.batch;
}

function normalizeLifecycleBatch(input: {
  tasks: GitHubTaskSignal[];
  activities: GitHubUserActivitySignal[];
}): RuntimeWorkSignalBatch {
  const authoredPullRequestCount = input.tasks.filter(
    (task) => task.kind === "authored_pull_request"
  ).length;
  const snapshot: GitHubSnapshot = {
    schemaVersion: "github-snapshot-v6",
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: FETCHED_AT,
    user: { id: 1, login: "synthetic" },
    truncated: false,
    activityWindowStart: "2026-07-25T00:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    actionabilityCoverage: {
      state:
        authoredPullRequestCount === 0 ? "complete" : "unavailable",
      authoredPullRequestCount,
      attemptedCount: authoredPullRequestCount,
      collectedCount: 0,
      truncated: false
    },
    installations: [
      {
        id: 1,
        accountLogin: "synthetic",
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
        installationId: 1,
        fullName: "synthetic/private",
        private: true,
        archived: false,
        updatedAt: FETCHED_AT
      }
    ],
    tasks: input.tasks,
    activities: input.activities
  };
  const normalized = normalizeGitHubSnapshotToWorkSignals(snapshot, {
    asOf: AS_OF,
    freshnessPolicy: {
      version: SNAPSHOT_VALIDITY_POLICY_VERSION,
      maxAgeMsBySource: {
        github: 10 * 60 * 1_000,
        codex: 10 * 60 * 1_000
      },
      maxFutureClockSkewMs: 60_000
    },
    contextRegistrySha256: null,
    resolveProjectId: () => ACTIVE_FIXTURE_PROJECT_ID
  });
  if (normalized.status !== "normalized") {
    throw new TypeError("Expected a normalized GitHub v5 lifecycle batch.");
  }
  return normalized.batch;
}

function githubTask(
  id: number,
  number: number,
  title: string,
  kind: GitHubTaskSignal["kind"] = "assigned_issue"
): GitHubTaskSignal {
  return {
    id,
    source: "github",
    kind,
    repositoryId: 101,
    repositoryFullName: "synthetic/private",
    number,
    title,
    htmlUrl:
      kind === "assigned_issue"
        ? `https://github.com/synthetic/private/issues/${number}`
        : `https://github.com/synthetic/private/pull/${number}`,
    labelNames: [],
    milestoneDueAt: null,
    state: "open",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: FETCHED_AT
  };
}

function githubPushV5(
  id: string,
  oid: string,
  occurredAt: string
): GitHubUserActivitySignal {
  return {
    ...githubPush(id, oid, occurredAt),
    subjectObjectId: null
  };
}

function githubLifecycleActivity(input: {
  id: string;
  activityKind:
    | "issue_opened"
    | "issue_closed"
    | "pull_request_opened"
    | "pull_request_merged";
  subjectType: "issue" | "pull_request";
  occurredAt: string;
}): GitHubUserActivitySignal {
  return {
    id: input.id,
    source: "github",
    kind: "user_activity",
    activityKind: input.activityKind,
    repositoryId: 101,
    repositoryFullName: "synthetic/private",
    occurredAt: input.occurredAt,
    subjectType: input.subjectType,
    subjectNumber: 42,
    subjectObjectId: 501,
    subjectTitle: "PRIVATE_LIFECYCLE_TITLE",
    refName: null,
    reviewState: null,
    artifactId: null
  };
}

function withoutPushSourceTimestamp(
  batch: RuntimeWorkSignalBatch
): RuntimeWorkSignalBatch {
  const target = batch.signals.find(
    (signal) =>
      signal.kind === "activity_observation" &&
      signal.facts.activityKind === "push"
  );
  if (!target || target.kind !== "activity_observation") {
    throw new TypeError("Expected GitHub push activity signal.");
  }
  const {
    signalId: _signalId,
    observationId: _observationId,
    signalHash: _signalHash,
    ...signalDraft
  } = target;
  const resealed = finalizeRuntimeWorkSignal({
    ...signalDraft,
    sourceUpdatedAt: null
  });
  const {
    batchSha256: _batchSha256,
    signalCount: _signalCount,
    ...batchDraft
  } = batch;
  return finalizeRuntimeWorkSignalBatch({
    ...batchDraft,
    signals: batch.signals.map((signal) =>
      signal.signalId === target.signalId ? resealed : signal
    )
  });
}

function githubPush(
  id: string,
  oid: string,
  occurredAt: string
): GitHubUserActivitySignal {
  return {
    id,
    source: "github",
    kind: "user_activity",
    activityKind: "push",
    repositoryId: 101,
    repositoryFullName: "synthetic/private",
    occurredAt,
    subjectType: "branch",
    subjectNumber: null,
    subjectTitle: null,
    refName: "PRIVATE_SHARED_BRANCH_SENTINEL",
    reviewState: null,
    artifactId: createGitHubArtifactId({
      kind: "github_commit",
      repositoryId: 101,
      oid
    })
  };
}
