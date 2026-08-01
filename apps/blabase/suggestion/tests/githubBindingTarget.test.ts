import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeStoredGitHubSnapshot } from "../src/connectors/github/localStore";
import type {
  GitHubSnapshot,
  GitHubTaskSignal
} from "../src/connectors/github/types";
import {
  validateStoredGitHubBindingTarget
} from "../src/relations";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("GitHub binding target validation", () => {
  it("accepts only an exact native GitHub work identity", async () => {
    const cwd = await temporaryDirectory();
    await writeStoredGitHubSnapshot(
      githubSnapshot([githubTask(501, "assigned_issue")]),
      cwd
    );

    await expect(
      validateStoredGitHubBindingTarget(
        taskRef("github", "github:object:501"),
        cwd
      )
    ).resolves.toEqual({
      subjectId: "github:object:501",
      objectType: "issue",
      number: 42
    });
  });

  it("rejects invalid, absent, and conflicting GitHub native identities", async () => {
    const emptyCwd = await temporaryDirectory();
    await expect(
      validateStoredGitHubBindingTarget(
        taskRef("github", "github:issue:repo:42"),
        emptyCwd
      )
    ).rejects.toMatchObject({
      code: "GITHUB_WORK_ITEM_IDENTITY_INVALID"
    });
    await expect(
      validateStoredGitHubBindingTarget(
        taskRef("github", "github:object:501"),
        emptyCwd
      )
    ).rejects.toMatchObject({
      code: "GITHUB_WORK_ITEM_SOURCE_UNAVAILABLE"
    });

    const cwd = await temporaryDirectory();
    await writeStoredGitHubSnapshot(
      githubSnapshot([
        githubTask(501, "assigned_issue"),
        githubTask(501, "review_requested_pull_request")
      ]),
      cwd
    );
    await expect(
      validateStoredGitHubBindingTarget(
        taskRef("github", "github:object:501"),
        cwd
      )
    ).rejects.toMatchObject({
      code: "GITHUB_WORK_ITEM_IDENTITY_CONFLICT"
    });
  });

  it("does not impose GitHub validation on non-GitHub explicit bindings", async () => {
    const cwd = await temporaryDirectory();
    await expect(
      validateStoredGitHubBindingTarget(
        taskRef("manual", "manual:task:1"),
        cwd
      )
    ).resolves.toBeNull();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-github-target-")
  );
  directories.push(directory);
  return directory;
}

function taskRef(
  source: "github" | "manual",
  subjectId: string
) {
  return {
    kind: "attention_subject" as const,
    source,
    subjectId,
    displayTitle: "Synthetic task"
  };
}

function githubSnapshot(tasks: GitHubTaskSignal[]): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "synthetic-client",
    appSlug: "synthetic-app",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-08-01T02:59:00.000Z",
    user: { id: 1, login: "synthetic" },
    truncated: false,
    activityWindowStart: "2026-07-25T00:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
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
        updatedAt: "2026-08-01T02:59:00.000Z"
      }
    ],
    tasks,
    activities: []
  };
}

function githubTask(
  id: number,
  kind: GitHubTaskSignal["kind"]
): GitHubTaskSignal {
  return {
    id,
    source: "github",
    kind,
    repositoryId: 101,
    repositoryFullName: "synthetic/private",
    number: 42,
    title: "Synthetic task",
    htmlUrl:
      kind === "assigned_issue"
        ? "https://github.com/synthetic/private/issues/42"
        : "https://github.com/synthetic/private/pull/42",
    labelNames: [],
    milestoneDueAt: null,
    state: "open",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-08-01T02:59:00.000Z"
  };
}
