import { describe, expect, it } from "vitest";

import {
  adaptCodexContinuationObservations,
  adaptGitHubContinuationObservations,
  continuationSourceAdapterBatchSchema
} from "../src/continuation/adapters";

const AS_OF = "2026-08-12T12:00:00.000Z";
const OPTIONS = {
  installationSecret: "synthetic-installation-secret-a",
  asOf: AS_OF,
  snapshotFreshnessCutoff: "2026-08-12T10:00:00.000Z"
};

describe("Continuation source adapters", () => {
  it("projects only a recent GitHub v6 push into a sealed private observation", () => {
    const result = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);

    expect(continuationSourceAdapterBatchSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe("available");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      workContextId: null,
      payload: { kind: "github_push" },
      snapshotFreshness: "fresh",
      terminalState: "unknown"
    });
    expect(JSON.stringify(result)).not.toMatch(
      /octo|repo-name|refs\/heads|synthetic-installation-secret|artifact_[a-f0-9]/u
    );
  });

  it("projects Codex v3 metadata with zero activity and no summary text", () => {
    const result = adaptCodexContinuationObservations(codexSnapshot(), OPTIONS);

    expect(result.status).toBe("available");
    expect(result.observations[0]?.payload).toEqual({
      kind: "codex_session_activity",
      sessionUpdatedAt: "2026-08-12T11:30:00.000Z",
      boundedActivityCount: 0,
      boundedSummaryAvailable: false
    });
    expect(JSON.stringify(result)).not.toMatch(
      /project-label|aaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbb/u
    );
  });

  it("fails closed for unknown and legacy source versions", () => {
    expect(
      adaptGitHubContinuationObservations(
        { ...githubSnapshot(), schemaVersion: "github-snapshot-v5" },
        OPTIONS
      )
    ).toMatchObject({ status: "unavailable", observations: [] });
    expect(adaptCodexContinuationObservations({}, OPTIONS)).toMatchObject({
      status: "unavailable",
      observations: []
    });
  });

  it("scopes opaque identities to the installation secret and remains deterministic", () => {
    const first = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const replay = adaptGitHubContinuationObservations(githubSnapshot(), OPTIONS);
    const otherInstallation = adaptGitHubContinuationObservations(githubSnapshot(), {
      ...OPTIONS,
      installationSecret: "synthetic-installation-secret-b"
    });

    expect(replay).toEqual(first);
    expect(otherInstallation.observations[0]?.sourceIdentity.opaqueId).not.toBe(
      first.observations[0]?.sourceIdentity.opaqueId
    );
  });

  it("uses an open-left seven-day window, excludes future rows, and keeps stale coverage", () => {
    const snapshot = githubSnapshot();
    snapshot.activities = [
      snapshot.activities[0]!,
      { ...snapshot.activities[0]!, id: "boundary", occurredAt: "2026-08-05T12:00:00.000Z" },
      { ...snapshot.activities[0]!, id: "future", occurredAt: "2026-08-12T12:00:01.000Z" }
    ];
    const result = adaptGitHubContinuationObservations(snapshot, {
      ...OPTIONS,
      snapshotFreshnessCutoff: "2026-08-12T11:45:00.000Z"
    });

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.snapshotFreshness).toBe("stale");
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        { reasonCode: "ACTIVITY_FROM_FUTURE", count: 1 },
        { reasonCode: "OUTSIDE_ACTIVITY_WINDOW", count: 1 }
      ])
    );
  });

  it("preserves GitHub partial activity coverage without claiming completeness", () => {
    const snapshot = {
      ...githubSnapshot(),
      activitiesState: "partial" as const
    };

    const result = adaptGitHubContinuationObservations(snapshot, OPTIONS);

    expect(result.observations[0]?.sourceCoverage).toBe("partial");
  });

  it("marks a short GitHub collection window partial but accepts the exact seven-day boundary", () => {
    const shortWindow = adaptGitHubContinuationObservations(
      {
        ...githubSnapshot(),
        activityWindowStart: "2026-08-05T12:00:01.000Z"
      },
      OPTIONS
    );
    const exactWindow = adaptGitHubContinuationObservations(
      {
        ...githubSnapshot(),
        activityWindowStart: "2026-08-05T12:00:00.000Z"
      },
      OPTIONS
    );

    expect(shortWindow.observations[0]?.sourceCoverage).toBe("partial");
    expect(exactWindow.observations[0]?.sourceCoverage).toBe("complete");
  });

  it("marks a short Codex lookback partial but accepts the exact seven-day boundary", () => {
    const shortWindow = adaptCodexContinuationObservations(
      { ...codexSnapshot(), lookbackStart: "2026-08-05T12:00:01.000Z" },
      OPTIONS
    );
    const exactWindow = adaptCodexContinuationObservations(
      { ...codexSnapshot(), lookbackStart: "2026-08-05T12:00:00.000Z" },
      OPTIONS
    );

    expect(shortWindow.observations[0]?.sourceCoverage).toBe("partial");
    expect(exactWindow.observations[0]?.sourceCoverage).toBe("complete");
  });

  it("rejects oversized top-level source arrays before deep validation", () => {
    const oversizedGitHub = {
      schemaVersion: "github-snapshot-v6",
      tasks: new Array(10_001)
    };
    const oversizedCodex = {
      schemaVersion: "codex-snapshot-v3",
      scopeIds: new Array(1_001)
    };

    expect(
      adaptGitHubContinuationObservations(oversizedGitHub, OPTIONS)
    ).toMatchObject({
      status: "unavailable",
      exclusions: [{ reasonCode: "INPUT_LIMIT_EXCEEDED", count: 1 }]
    });
    expect(
      adaptCodexContinuationObservations(oversizedCodex, OPTIONS)
    ).toMatchObject({
      status: "unavailable",
      exclusions: [{ reasonCode: "INPUT_LIMIT_EXCEEDED", count: 1 }]
    });
  });

  it("fails closed for invalid options, future snapshots, and unavailable GitHub activities", () => {
    expect(
      adaptGitHubContinuationObservations(githubSnapshot(), {
        ...OPTIONS,
        snapshotFreshnessCutoff: "2026-08-12T12:00:01.000Z"
      })
    ).toMatchObject({ status: "unavailable", observations: [] });
    expect(
      adaptGitHubContinuationObservations(
        { ...githubSnapshot(), fetchedAt: "2026-08-12T12:00:01.000Z" },
        OPTIONS
      )
    ).toMatchObject({ status: "unavailable", observations: [] });
    expect(
      adaptGitHubContinuationObservations(
        {
          ...githubSnapshot(),
          activitiesState: "unavailable" as const,
          activities: []
        },
        OPTIONS
      )
    ).toMatchObject({
      status: "available",
      observations: [],
      exclusions: [{ reasonCode: "ACTIVITIES_UNAVAILABLE", count: 1 }]
    });
  });

  it("excludes an entire conflicting GitHub duplicate identity group", () => {
    const snapshot = githubSnapshot();
    snapshot.activities = [
      snapshot.activities[0]!,
      { ...snapshot.activities[0]!, refName: "refs/heads/other" }
    ];

    const result = adaptGitHubContinuationObservations(snapshot, OPTIONS);

    expect(result.observations).toEqual([]);
    expect(result.exclusions).toContainEqual({
      reasonCode: "DUPLICATE_CONFLICT",
      count: 2
    });
  });

  it("is permutation-stable for Codex sessions and excludes conflicting duplicates", () => {
    const first = codexSnapshot();
    const secondSession = {
      ...first.sessions[0]!,
      id: "c".repeat(24),
      updatedAt: "2026-08-12T11:20:00.000Z"
    };
    first.sessions.push(secondSession);
    const permuted = { ...first, sessions: [...first.sessions].reverse() };

    expect(adaptCodexContinuationObservations(permuted, OPTIONS)).toEqual(
      adaptCodexContinuationObservations(first, OPTIONS)
    );

    const conflict = codexSnapshot();
    conflict.sessions.push({
      ...conflict.sessions[0]!,
      projectLabel: "different-private-label"
    });
    const conflictResult = adaptCodexContinuationObservations(conflict, OPTIONS);
    expect(conflictResult.observations).toEqual([]);
    expect(conflictResult.exclusions).toContainEqual({
      reasonCode: "DUPLICATE_CONFLICT",
      count: 2
    });
  });
});

function githubSnapshot() {
  return {
    schemaVersion: "github-snapshot-v6" as const,
    appClientId: "client-id",
    appSlug: "app-slug",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-08-12T11:40:00.000Z",
    user: { id: 1, login: "octo" },
    truncated: false,
    activityWindowStart: "2026-08-05T11:40:00.000Z",
    activitiesState: "available" as const,
    activitiesTruncated: false,
    actionabilityCoverage: {
      state: "complete" as const,
      authoredPullRequestCount: 0,
      attemptedCount: 0,
      collectedCount: 0,
      truncated: false
    },
    installations: [
      {
        id: 1,
        accountLogin: "octo",
        accountType: "User" as const,
        repositorySelection: "selected" as const,
        suspended: false
      }
    ],
    repositories: [
      {
        id: 10,
        source: "github" as const,
        kind: "repository" as const,
        installationId: 1,
        fullName: "octo/repo-name",
        private: true,
        archived: false,
        updatedAt: "2026-08-12T11:30:00.000Z"
      }
    ],
    tasks: [],
    activities: [
      {
        id: "push-event-1",
        source: "github" as const,
        kind: "user_activity" as const,
        activityKind: "push" as const,
        repositoryId: 10,
        repositoryFullName: "octo/repo-name",
        occurredAt: "2026-08-12T11:30:00.000Z",
        subjectType: "repository" as const,
        subjectNumber: null,
        subjectObjectId: null,
        subjectTitle: null,
        refName: "refs/heads/main",
        reviewState: null,
        artifactId: `artifact_${"1".repeat(32)}`
      }
    ]
  };
}

function codexSnapshot() {
  return {
    schemaVersion: "codex-snapshot-v3" as const,
    collectorVersion: "codex-app-server-metadata-v1" as const,
    contentMode: "metadata_only" as const,
    codexVersion: "1.0.0",
    fetchedAt: "2026-08-12T11:40:00.000Z",
    lookbackStart: "2026-08-05T11:40:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: ["a".repeat(24)],
    sessions: [
      {
        id: "b".repeat(24),
        source: "codex" as const,
        kind: "coding_session" as const,
        scopeId: "a".repeat(24),
        projectLabel: "project-label",
        taskSummary: null,
        taskSummarySource: null,
        createdAt: "2026-08-12T11:00:00.000Z",
        updatedAt: "2026-08-12T11:30:00.000Z",
        activityState: "idle" as const,
        attentionState: null,
        content: {
          state: "not_collected" as const,
          contentSha256: null,
          contentSourceUpdatedAt: null,
          collectedAt: null,
          expiresAt: null,
          historicalTurnStatus: "unknown" as const,
          latestTurnCompletedAt: null,
          turnCount: 0,
          userPromptCount: 0,
          agentResponseCount: 0,
          commandExecutionCount: 0,
          failedCommandCount: 0,
          fileChangeCount: 0,
          toolCallCount: 0,
          omittedReasoningItemCount: 0,
          omittedUnsupportedItemCount: 0,
          truncated: false,
          reasonCodes: ["CONTENT_MODE_DISABLED" as const],
          latestUserPromptExcerpt: null,
          latestAgentResponseExcerpt: null,
          latestExecutionSummary: null
        }
      }
    ]
  };
}
