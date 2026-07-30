import { describe, expect, it } from "vitest";

import {
  assessSnapshot,
  validateCodexSnapshot,
  validateGitHubSnapshot
} from "../src/crossSource/validateSnapshots";
import {
  SNAPSHOT_VALIDITY_POLICY_VERSION
} from "../src/crossSource/versions";
import type { CodexSnapshot } from "../src/connectors/codex/types";
import type { GitHubSnapshot } from "../src/connectors/github/types";

const policy = {
  version: SNAPSHOT_VALIDITY_POLICY_VERSION,
  maxAgeMsBySource: {
    github: 5 * 60 * 1000,
    codex: 5 * 60 * 1000
  },
  maxFutureClockSkewMs: 1_000
};

describe("cross-source snapshot validity", () => {
  it("canonicalizes set-like connector arrays before hashing", () => {
    const github = githubSnapshot();
    const reordered: GitHubSnapshot = {
      ...github,
      repositories: [...github.repositories].reverse(),
      tasks: [...github.tasks]
        .reverse()
        .map((task) => ({
          ...task,
          labelNames: [...task.labelNames].reverse()
        })),
      activities: [...github.activities].reverse()
    };

    const first = validateGitHubSnapshot(github);
    const second = validateGitHubSnapshot(reordered);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;

    expect(first.artifact.sourceSnapshotSha256).toBe(
      second.artifact.sourceSnapshotSha256
    );
    expect(first.artifact.payload).toEqual(second.artifact.payload);
  });

  it("uses an injected TTL and preserves exact freshness boundaries", () => {
    const validated = validateGitHubSnapshot(githubSnapshot());
    expect(validated.status).toBe("ok");
    if (validated.status !== "ok") return;

    expect(
      assessSnapshot(
        validated.artifact,
        "2026-07-26T12:05:00.000Z",
        policy
      ).freshness
    ).toBe("fresh");
    expect(
      assessSnapshot(
        validated.artifact,
        "2026-07-26T12:05:00.001Z",
        policy
      )
    ).toMatchObject({
      freshness: "stale",
      usableForOverview: true,
      usableForCurrentCandidates: false,
      reasonCodes: expect.arrayContaining(["SNAPSHOT_STALE"])
    });
  });

  it("rejects future snapshots outside clock skew", () => {
    const validated = validateCodexSnapshot(
      codexSnapshot({
        fetchedAt: "2026-07-26T12:00:01.001Z"
      })
    );
    expect(validated.status).toBe("ok");
    if (validated.status !== "ok") return;

    expect(
      assessSnapshot(
        validated.artifact,
        "2026-07-26T12:00:00.000Z",
        policy
      )
    ).toMatchObject({
      freshness: "invalid",
      usableForOverview: false,
      usableForCurrentCandidates: false,
      reasonCodes: expect.arrayContaining([
        "SNAPSHOT_FROM_FUTURE",
        "CODEX_OVERVIEW_ONLY"
      ])
    });
  });

  it("keeps truncation, activity coverage, and capability separate", () => {
    const github = validateGitHubSnapshot(
      githubSnapshot({
        truncated: true,
        activitiesState: "unavailable",
        activitiesTruncated: true
      })
    );
    const codex = validateCodexSnapshot(codexSnapshot());
    expect(github.status).toBe("ok");
    expect(codex.status).toBe("ok");
    if (github.status !== "ok" || codex.status !== "ok") return;

    expect(
      assessSnapshot(
        github.artifact,
        "2026-07-26T12:01:00.000Z",
        policy
      )
    ).toMatchObject({
      freshness: "fresh",
      completeness: "partial",
      truncated: true,
      candidateSetComplete: false,
      usableForCurrentCandidates: true,
      reasonCodes: expect.arrayContaining([
        "SNAPSHOT_TRUNCATED",
        "GITHUB_ACTIVITIES_UNAVAILABLE"
      ])
    });
    expect(
      assessSnapshot(
        codex.artifact,
        "2026-07-26T12:01:00.000Z",
        policy
      )
    ).toMatchObject({
      completeness: "complete",
      candidateSetComplete: false,
      usableForOverview: true,
      usableForCurrentCandidates: false,
      reasonCodes: expect.arrayContaining(["CODEX_OVERVIEW_ONLY"])
    });
  });

  it("returns sanitized failures with no payload or provider text", () => {
    const secret =
      "/Users/private/project SECRET_TOKEN raw prompt";
    const unsupported = validateCodexSnapshot({
      schemaVersion: "codex-snapshot-v99",
      secret
    });
    const malformed = validateGitHubSnapshot({
      schemaVersion: "github-snapshot-v2",
      secret
    });
    const missing = validateGitHubSnapshot(null);

    expect(unsupported).toEqual({
      status: "rejected",
      failure: {
        contract: "runtime-source-collection-failure-v0.1",
        source: "codex",
        status: "unsupported",
        code: "SNAPSHOT_SCHEMA_UNSUPPORTED"
      }
    });
    expect(malformed).toMatchObject({
      status: "rejected",
      failure: {
        source: "github",
        status: "invalid",
        code: "SNAPSHOT_PARSE_FAILED"
      }
    });
    expect(missing).toMatchObject({
      status: "rejected",
      failure: {
        status: "missing",
        code: "SNAPSHOT_MISSING"
      }
    });
    expect(
      JSON.stringify([unsupported, malformed, missing])
    ).not.toContain(secret);
  });
});

function githubSnapshot(
  overrides: Partial<GitHubSnapshot> = {}
): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "Iv1.client",
    appSlug: "blabase",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-07-26T12:00:00.000Z",
    user: { id: 7, login: "nika" },
    truncated: false,
    activityWindowStart: "2026-06-26T12:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    installations: [
      {
        id: 2,
        accountLogin: "acme",
        accountType: "Organization",
        repositorySelection: "selected",
        suspended: false
      }
    ],
    repositories: [
      {
        id: 102,
        source: "github",
        kind: "repository",
        installationId: 2,
        fullName: "acme/second",
        private: false,
        archived: false,
        updatedAt: "2026-07-26T11:00:00.000Z"
      },
      {
        id: 101,
        source: "github",
        kind: "repository",
        installationId: 2,
        fullName: "acme/app",
        private: true,
        archived: false,
        updatedAt: "2026-07-26T11:30:00.000Z"
      }
    ],
    tasks: [
      {
        id: 202,
        source: "github",
        kind: "review_requested_pull_request",
        repositoryId: 101,
        repositoryFullName: "acme/app",
        number: 22,
        title: "Review API",
        htmlUrl: "https://github.com/acme/app/pull/22",
        labelNames: ["backend", "urgent"],
        milestoneDueAt: null,
        state: "open",
        createdAt: "2026-07-25T08:00:00.000Z",
        updatedAt: "2026-07-26T11:50:00.000Z"
      },
      {
        id: 201,
        source: "github",
        kind: "assigned_issue",
        repositoryId: 101,
        repositoryFullName: "acme/app",
        number: 11,
        title: "Fix checkout",
        htmlUrl: "https://github.com/acme/app/issues/11",
        labelNames: ["today", "customer"],
        milestoneDueAt: null,
        state: "open",
        createdAt: "2026-07-24T08:00:00.000Z",
        updatedAt: "2026-07-26T11:40:00.000Z"
      }
    ],
    activities: [
      {
        id: "event-2",
        source: "github",
        kind: "user_activity",
        activityKind: "pull_request_reviewed",
        repositoryId: 101,
        repositoryFullName: "acme/app",
        occurredAt: "2026-07-26T11:59:00.000Z",
        subjectType: "pull_request",
        subjectNumber: 22,
        subjectTitle: "Review API",
        refName: null,
        reviewState: "approved"
      },
      {
        id: "event-1",
        source: "github",
        kind: "user_activity",
        activityKind: "push",
        repositoryId: 101,
        repositoryFullName: "acme/app",
        occurredAt: "2026-07-26T11:58:00.000Z",
        subjectType: "branch",
        subjectNumber: null,
        subjectTitle: null,
        refName: "feature/checkout",
        reviewState: null
      }
    ],
    ...overrides
  };
}

function codexSnapshot(
  overrides: Partial<CodexSnapshot> = {}
): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v3",
    collectorVersion: "codex-app-server-metadata-v1",
    contentMode: "metadata_only",
    codexVersion: "codex-cli 0.150.0",
    fetchedAt: "2026-07-26T12:00:00.000Z",
    lookbackStart: "2026-06-26T12:00:00.000Z",
    truncated: false,
    conversationStoreSha256: null,
    conversationRetentionDays: null,
    scopeIds: ["111111111111111111111111"],
    sessions: [],
    ...overrides
  };
}
