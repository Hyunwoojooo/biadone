import { describe, expect, it } from "vitest";

import {
  createGitHubArtifactId,
  GitHubArtifactTargetError,
  validateGitHubArtifactTarget
} from "../src/artifacts";
import type { GitHubSnapshot } from "../src/connectors/github/types";

describe("GitHub artifact target validation", () => {
  it("reduces an exact commit URL to repository native ID and full OID", () => {
    const result = validateGitHubArtifactTarget(
      `https://github.com/biadone/blabase/commit/${"A".repeat(40)}`,
      snapshot()
    );

    expect(result).toEqual({
      kind: "github_commit",
      repositoryId: 101,
      oid: "a".repeat(40)
    });
    expect(JSON.stringify(result)).not.toContain("biadone");
    expect(JSON.stringify(result)).not.toContain("github.com");
  });

  it("uses PR native object ID while keeping number as display metadata", () => {
    const artifact = validateGitHubArtifactTarget(
      "https://github.com/biadone/blabase/pull/42",
      snapshot()
    );
    expect(artifact).toEqual({
      kind: "github_pull_request",
      repositoryId: 101,
      objectId: 9001,
      number: 42
    });
    expect(createGitHubArtifactId(artifact)).toBe(
      createGitHubArtifactId({
        kind: "github_pull_request",
        repositoryId: 101,
        objectId: 9001,
        number: 999
      })
    );
  });

  it.each([
    "https://github.com/biadone/blabase/commit/abc1234",
    `https://github.com/biadone/blabase/commit/${"a".repeat(40)}?diff=1`,
    "https://github.com/biadone/blabase/pull/42/files",
    "http://github.com/biadone/blabase/pull/42",
    "https://evil.example/biadone/blabase/pull/42",
    " https://github.com/biadone/blabase/pull/42"
  ])("rejects a non-exact or unsafe URL: %s", (artifactUrl) => {
    expect(() =>
      validateGitHubArtifactTarget(artifactUrl, snapshot())
    ).toThrowError(
      expect.objectContaining<Partial<GitHubArtifactTargetError>>({
        code: "GITHUB_ARTIFACT_URL_INVALID"
      })
    );
  });

  it("does not infer a PR that is absent from the current native snapshot", () => {
    expect(() =>
      validateGitHubArtifactTarget(
        "https://github.com/biadone/blabase/pull/99",
        snapshot()
      )
    ).toThrowError(
      expect.objectContaining<Partial<GitHubArtifactTargetError>>({
        code: "GITHUB_PULL_REQUEST_NOT_FOUND"
      })
    );
  });

  it("fails closed on incompatible PR or repository duplicates", () => {
    const conflictingPr = snapshot();
    conflictingPr.tasks.push({
      ...conflictingPr.tasks[0]!,
      id: 9002
    });
    expect(() =>
      validateGitHubArtifactTarget(
        "https://github.com/biadone/blabase/pull/42",
        conflictingPr
      )
    ).toThrowError(
      expect.objectContaining<Partial<GitHubArtifactTargetError>>({
        code: "GITHUB_PULL_REQUEST_IDENTITY_CONFLICT"
      })
    );

    const conflictingRepository = snapshot();
    conflictingRepository.repositories.push({
      ...conflictingRepository.repositories[0]!,
      id: 102
    });
    expect(() =>
      validateGitHubArtifactTarget(
        `https://github.com/biadone/blabase/commit/${"a".repeat(40)}`,
        conflictingRepository
      )
    ).toThrowError(
      expect.objectContaining<Partial<GitHubArtifactTargetError>>({
        code: "GITHUB_ARTIFACT_REPOSITORY_IDENTITY_CONFLICT"
      })
    );
  });
});

function snapshot(): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "client",
    appSlug: "blabase-test",
    apiVersion: "2026-03-10",
    fetchedAt: "2026-08-01T00:00:00.000Z",
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
        updatedAt: "2026-08-01T00:00:00.000Z"
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
        title: "PRIVATE_TITLE_SENTINEL",
        htmlUrl: "https://github.com/biadone/blabase/pull/42",
        labelNames: [],
        milestoneDueAt: null,
        state: "open",
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z"
      }
    ],
    activities: []
  };
}
