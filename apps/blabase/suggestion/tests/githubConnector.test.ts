import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GITHUB_REDIRECT_URI,
  GITHUB_API_VERSION,
  loadGitHubConfig,
  type GitHubConfig
} from "../src/connectors/github/config";
import {
  fetchAndStoreGitHubSnapshot,
  MAX_GITHUB_ACTIVITIES
} from "../src/connectors/github/githubApi";
import {
  githubLocalDirectory,
  readStoredGitHubSnapshot,
  readStoredGitHubTokens,
  writeStoredGitHubTokens
} from "../src/connectors/github/localStore";
import {
  createGitHubAuthorizationUrl,
  createGitHubInstallationUrl,
  createGitHubOAuthState,
  exchangeGitHubAuthorizationCode,
  githubOAuthStatesMatch,
  revokeGitHubAuthorization
} from "../src/connectors/github/oauth";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.restoreAllMocks();
});

describe("GitHub local connector", () => {
  it("loads GitHub App config and creates a state-bound installation URL", () => {
    expect(
      loadGitHubConfig({
        NODE_ENV: "test",
        GITHUB_APP_CLIENT_ID: "Iv1.client",
        GITHUB_APP_CLIENT_SECRET: "client-secret",
        GITHUB_APP_SLUG: "blabase",
        GITHUB_APP_REDIRECT_URI: DEFAULT_GITHUB_REDIRECT_URI
      } as NodeJS.ProcessEnv)
    ).toMatchObject({
      ok: true,
      config: {
        clientId: "Iv1.client",
        appSlug: "blabase",
        redirectUri: DEFAULT_GITHUB_REDIRECT_URI,
        apiVersion: GITHUB_API_VERSION
      }
    });

    const state = createGitHubOAuthState();
    const userAuthorizationUrl = new URL(
      createGitHubAuthorizationUrl(testConfig(), state)
    );
    expect(userAuthorizationUrl.origin).toBe("https://github.com");
    expect(userAuthorizationUrl.pathname).toBe("/login/oauth/authorize");
    expect(userAuthorizationUrl.searchParams.get("client_id")).toBe(
      "Iv1.client"
    );
    expect(userAuthorizationUrl.searchParams.get("redirect_uri")).toBe(
      DEFAULT_GITHUB_REDIRECT_URI
    );
    expect(userAuthorizationUrl.searchParams.get("state")).toBe(state);

    const authorizationUrl = new URL(
      createGitHubInstallationUrl(testConfig(), state)
    );
    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.pathname).toBe(
      "/apps/blabase/installations/new"
    );
    expect(authorizationUrl.searchParams.get("state")).toBe(state);
    expect(githubOAuthStatesMatch(state, state)).toBe(true);
    expect(githubOAuthStatesMatch(state, `${state}x`)).toBe(false);
  });

  it("exchanges a code only for rotating, expiring user tokens", async () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        expect(input.toString()).toBe(
          "https://github.com/login/oauth/access_token"
        );
        expect(init?.headers).toMatchObject({
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        });
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("client_id")).toBe("Iv1.client");
        expect(body.get("client_secret")).toBe("client-secret");
        expect(body.get("code")).toBe("temporary-code");
        expect(body.get("redirect_uri")).toBe(
          DEFAULT_GITHUB_REDIRECT_URI
        );
        return tokenResponse();
      }
    ) as unknown as typeof fetch;

    await expect(
      exchangeGitHubAuthorizationCode(
        testConfig(),
        "temporary-code",
        fetchImpl,
        now
      )
    ).resolves.toEqual({
      appClientId: "Iv1.client",
      appSlug: "blabase",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: "2026-07-25T08:00:00.000Z",
      refreshTokenExpiresAt: "2027-01-25T00:00:00.000Z",
      tokenType: "bearer",
      scope: ""
    });
  });

  it("stores only selected-repository task metadata and no sensitive bodies", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);

    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer access-token",
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        });

        if (url.pathname === "/user") {
          return jsonResponse({
            id: 7,
            login: "nika",
            email: "private@example.com",
            bio: "private user body"
          });
        }
        if (url.pathname === "/user/installations") {
          return jsonResponse({
            total_count: 2,
            installations: [
              {
                id: 10,
                account: {
                  login: "acme",
                  type: "Organization",
                  email: "owner@example.com"
                },
                repository_selection: "selected",
                suspended_at: null,
                permissions: {
                  metadata: "read",
                  issues: "read",
                  pull_requests: "read"
                }
              },
              {
                id: 11,
                account: {
                  login: "paused-org",
                  type: "Organization"
                },
                repository_selection: "all",
                suspended_at: "2026-07-24T00:00:00.000Z"
              }
            ]
          });
        }
        if (
          url.pathname ===
          "/user/installations/10/repositories"
        ) {
          return jsonResponse({
            total_count: 4,
            repositories: [
              repositoryResponse(101, "acme/alpha", {
                private: true,
                updated_at: "2026-07-25T03:00:00.000Z",
                description: "private repository description",
                clone_url: "https://github.com/acme/alpha.git"
              }),
              repositoryResponse(102, "acme/beta", {
                updated_at: "2026-07-24T03:00:00.000Z"
              }),
              repositoryResponse(103, "acme/archive", {
                archived: true,
                updated_at: "2026-07-22T03:00:00.000Z"
              }),
              repositoryResponse(104, "repos/edge", {
                updated_at: "2026-07-21T03:00:00.000Z"
              })
            ]
          });
        }
        if (url.pathname === "/issues") {
          return jsonResponse([
            taskResponse(201, "acme/alpha", 11, "고객 이슈 확인", {
              updated_at: "2026-07-25T05:00:00.000Z",
              body: "assigned issue private body",
              comments_url: "https://api.github.com/private-comments",
              labels: [
                {
                  name: "urgent",
                  description: "private label description"
                }
              ],
              milestone: {
                due_on: "2026-07-27T00:00:00.000Z",
                description: "private milestone description"
              }
            }),
            taskResponse(202, "outside/hidden", 12, "범위 밖 이슈", {
              body: "outside repository body"
            }),
            taskResponse(203, "acme/alpha", 13, "이슈 API의 PR", {
              pull_request: { url: "private pull request payload" }
            }),
            taskResponse(204, "acme/archive", 14, "보관 저장소 이슈"),
            taskResponse(205, "repos/edge", 15, "repos 소유자 이슈", {
              updated_at: "2026-07-25T01:00:00.000Z"
            })
          ]);
        }
        if (url.pathname === "/search/issues") {
          const query = url.searchParams.get("q") ?? "";
          if (query.includes("review-requested:")) {
            return searchResponse([
              taskResponse(301, "acme/beta", 21, "리뷰 요청 PR", {
                updated_at: "2026-07-25T04:00:00.000Z",
                pull_request: { url: "private pull request payload" },
                body: "review request private body"
              }),
              taskResponse(302, "outside/hidden", 22, "범위 밖 PR", {
                pull_request: {}
              })
            ]);
          }
          expect(query).toContain("author:nika");
          return searchResponse([
            taskResponse(401, "acme/alpha", 31, "내 열린 PR", {
              updated_at: "2026-07-25T02:00:00.000Z",
              pull_request: {},
              body: "authored pull request private body"
            })
          ]);
        }
        if (url.pathname === "/users/nika/events") {
          return jsonResponse([]);
        }
        throw new Error(`unexpected URL: ${url.toString()}`);
      }
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const snapshot = await fetchAndStoreGitHubSnapshot(testConfig(), {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl,
      cwd
    });

    expect(snapshot.user).toEqual({ id: 7, login: "nika" });
    expect(snapshot).toMatchObject({
      schemaVersion: "github-snapshot-v2",
      activityWindowStart: "2026-06-25T01:00:00.000Z",
      activitiesState: "available",
      activitiesTruncated: false,
      activities: []
    });
    expect(snapshot.repositories.map((repository) => repository.fullName)).toEqual([
      "acme/alpha",
      "acme/beta",
      "acme/archive",
      "repos/edge"
    ]);
    expect(snapshot.installations).toEqual([
      expect.objectContaining({ id: 10, suspended: false }),
      expect.objectContaining({ id: 11, suspended: true })
    ]);
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: 201,
        kind: "assigned_issue",
        repositoryFullName: "acme/alpha",
        labelNames: ["urgent"],
        milestoneDueAt: "2026-07-27T00:00:00.000Z"
      }),
      expect.objectContaining({
        id: 301,
        kind: "review_requested_pull_request",
        repositoryFullName: "acme/beta"
      }),
      expect.objectContaining({
        id: 401,
        kind: "authored_pull_request",
        repositoryFullName: "acme/alpha"
      }),
      expect.objectContaining({
        id: 205,
        kind: "assigned_issue",
        repositoryFullName: "repos/edge"
      })
    ]);
    expect(
      snapshot.tasks.some(
        (task) => task.repositoryFullName === "acme/archive"
      )
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestUrl(input).pathname.includes("/installations/11/")
      )
    ).toBe(false);

    const directory = githubLocalDirectory(cwd);
    const storedSnapshot = await readFile(
      join(directory, "snapshot.json"),
      "utf8"
    );
    for (const sensitiveValue of [
      "private@example.com",
      "private user body",
      "private repository description",
      "assigned issue private body",
      "private label description",
      "private milestone description",
      "review request private body",
      "authored pull request private body",
      "private pull request payload"
    ]) {
      expect(storedSnapshot).not.toContain(sensitiveValue);
    }
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(directory, "tokens.json"))).mode & 0o777
    ).toBe(0o600);
    expect(
      (await stat(join(directory, "snapshot.json"))).mode & 0o777
    ).toBe(0o600);
  });

  it("stores only selected-repository activity metadata for the authenticated actor", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);

    const pullRequest = (
      number: number,
      title: string,
      merged = false
    ) => ({
      number,
      title,
      merged,
      body: "SECRET_PULL_REQUEST_BODY",
      head: { sha: "SECRET_PULL_REQUEST_SHA" }
    });
    const issue = (
      number: number,
      title: string,
      isPullRequest = false
    ) => ({
      number,
      title,
      body: "SECRET_ISSUE_BODY",
      ...(isPullRequest ? { pull_request: { url: "SECRET_PR_URL" } } : {})
    });
    const events = [
      activityEvent("push", "PushEvent", "2026-07-25T00:15:00.000Z", {
        ref: "refs/heads/main",
        head: "SECRET_PUSH_HEAD",
        before: "SECRET_PUSH_BEFORE",
        commits: [{ message: "SECRET_COMMIT_MESSAGE" }]
      }),
      activityEvent(
        "branch-create",
        "CreateEvent",
        "2026-07-25T00:14:00.000Z",
        {
          ref: "feature/activity",
          ref_type: "branch",
          description: "SECRET_REPOSITORY_DESCRIPTION"
        }
      ),
      activityEvent(
        "tag-delete",
        "DeleteEvent",
        "2026-07-25T00:13:00.000Z",
        { ref: "v1.0.0", ref_type: "tag" }
      ),
      activityEvent(
        "issue-opened",
        "IssuesEvent",
        "2026-07-25T00:12:00.000Z",
        { action: "opened", issue: issue(11, "새 이슈") }
      ),
      activityEvent(
        "issue-closed",
        "IssuesEvent",
        "2026-07-25T00:11:00.000Z",
        { action: "closed", issue: issue(12, "닫은 이슈") }
      ),
      activityEvent(
        "issue-reopened",
        "IssuesEvent",
        "2026-07-25T00:10:00.000Z",
        { action: "reopened", issue: issue(13, "다시 연 이슈") }
      ),
      activityEvent(
        "issue-comment",
        "IssueCommentEvent",
        "2026-07-25T00:09:00.000Z",
        {
          action: "created",
          issue: issue(14, "댓글 단 이슈"),
          comment: { body: "SECRET_COMMENT_TEXT" }
        }
      ),
      activityEvent(
        "pr-opened",
        "PullRequestEvent",
        "2026-07-25T00:08:00.000Z",
        {
          action: "opened",
          pull_request: pullRequest(21, "새 PR")
        }
      ),
      activityEvent(
        "pr-closed",
        "PullRequestEvent",
        "2026-07-25T00:07:00.000Z",
        {
          action: "closed",
          pull_request: pullRequest(22, "닫은 PR")
        }
      ),
      activityEvent(
        "pr-reopened",
        "PullRequestEvent",
        "2026-07-25T00:06:00.000Z",
        {
          action: "reopened",
          pull_request: pullRequest(23, "다시 연 PR")
        }
      ),
      activityEvent(
        "pr-merged",
        "PullRequestEvent",
        "2026-07-25T00:05:00.000Z",
        {
          action: "closed",
          pull_request: pullRequest(24, "합친 PR", true)
        }
      ),
      activityEvent(
        "review-approved",
        "PullRequestReviewEvent",
        "2026-07-25T00:04:00.000Z",
        {
          action: "submitted",
          pull_request: pullRequest(25, "승인한 PR"),
          review: {
            state: "APPROVED",
            body: "SECRET_REVIEW_BODY",
            commit_id: "SECRET_REVIEW_SHA"
          }
        }
      ),
      activityEvent(
        "review-changes",
        "PullRequestReviewEvent",
        "2026-07-25T00:03:00.000Z",
        {
          action: "created",
          pull_request: pullRequest(26, "변경 요청한 PR"),
          review: { state: "changes_requested" }
        }
      ),
      activityEvent(
        "review-commented",
        "PullRequestReviewEvent",
        "2026-07-25T00:02:00.000Z",
        {
          action: "submitted",
          pull_request: pullRequest(27, "코멘트한 PR"),
          review: { state: "commented" }
        }
      ),
      activityEvent(
        "review-comment",
        "PullRequestReviewCommentEvent",
        "2026-07-25T00:01:00.000Z",
        {
          action: "created",
          pull_request: pullRequest(28, "리뷰 댓글 PR"),
          comment: {
            body: "SECRET_REVIEW_COMMENT",
            diff_hunk: "SECRET_DIFF",
            path: "SECRET_FILE_PATH"
          }
        }
      ),
      activityEvent(
        "wrong-actor",
        "PushEvent",
        "2026-07-25T00:16:00.000Z",
        { ref: "refs/heads/private-other-user" },
        { actorLogin: "someone-else" }
      ),
      activityEvent(
        "outside-repository",
        "IssuesEvent",
        "2026-07-25T00:17:00.000Z",
        {
          action: "opened",
          issue: issue(99, "SECRET_OUTSIDE_REPOSITORY_TITLE")
        },
        { repositoryId: 999, repositoryFullName: "outside/private" }
      ),
      activityEvent(
        "too-old",
        "PushEvent",
        "2026-06-25T00:59:59.000Z",
        { ref: "refs/heads/old-private-branch" }
      ),
      activityEvent(
        "unsupported",
        "WatchEvent",
        "2026-07-25T00:18:00.000Z",
        { action: "started" }
      ),
      activityEvent("push", "PushEvent", "2026-07-24T00:00:00.000Z", {
        ref: "refs/heads/duplicate"
      })
    ];
    const fetchMock = basicSnapshotFetchMock(() =>
      jsonResponse(events)
    );

    const snapshot = await fetchAndStoreGitHubSnapshot(testConfig(), {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl: fetchMock as unknown as typeof fetch,
      cwd
    });

    expect(snapshot.activitiesState).toBe("available");
    expect(snapshot.activitiesTruncated).toBe(false);
    expect(snapshot.activities).toHaveLength(15);
    expect(
      snapshot.activities.map((activity) => activity.activityKind)
    ).toEqual([
      "push",
      "ref_created",
      "ref_deleted",
      "issue_opened",
      "issue_closed",
      "issue_reopened",
      "issue_commented",
      "pull_request_opened",
      "pull_request_closed",
      "pull_request_reopened",
      "pull_request_merged",
      "pull_request_reviewed",
      "pull_request_reviewed",
      "pull_request_reviewed",
      "pull_request_review_commented"
    ]);
    expect(snapshot.activities[0]).toMatchObject({
      repositoryId: 101,
      repositoryFullName: "acme/alpha",
      subjectType: "branch",
      refName: "main",
      reviewState: null
    });
    expect(
      snapshot.activities
        .filter(
          (activity) =>
            activity.activityKind === "pull_request_reviewed"
        )
        .map((activity) => activity.reviewState)
    ).toEqual(["approved", "changes_requested", "commented"]);
    expect(
      snapshot.activities.find(
        (activity) => activity.id === "pr-merged"
      )
    ).toMatchObject({
      activityKind: "pull_request_merged",
      subjectNumber: 24,
      subjectTitle: "합친 PR"
    });

    const storedSnapshot = await readFile(
      join(githubLocalDirectory(cwd), "snapshot.json"),
      "utf8"
    );
    for (const sensitiveValue of [
      "SECRET_PUSH_HEAD",
      "SECRET_PUSH_BEFORE",
      "SECRET_COMMIT_MESSAGE",
      "SECRET_REPOSITORY_DESCRIPTION",
      "SECRET_ISSUE_BODY",
      "SECRET_PR_URL",
      "SECRET_COMMENT_TEXT",
      "SECRET_PULL_REQUEST_BODY",
      "SECRET_PULL_REQUEST_SHA",
      "SECRET_REVIEW_BODY",
      "SECRET_REVIEW_SHA",
      "SECRET_REVIEW_COMMENT",
      "SECRET_DIFF",
      "SECRET_FILE_PATH",
      "SECRET_ACTOR_EMAIL",
      "SECRET_ACTOR_AVATAR",
      "SECRET_REPOSITORY_API_URL",
      "SECRET_ORGANIZATION",
      "SECRET_OUTSIDE_REPOSITORY_TITLE",
      "outside/private",
      "old-private-branch",
      "private-other-user"
    ]) {
      expect(storedSnapshot).not.toContain(sensitiveValue);
    }
    expect(
      fetchMock.mock.calls.some(([input]) =>
        /\/(?:commits|compare|contents)(?:\/|$)/.test(
          requestUrl(input).pathname
        )
      )
    ).toBe(false);
  });

  it("caps GitHub Events at three pages, deduplicates, and sorts deterministically", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);
    const baseTimestamp = Date.parse("2026-07-25T00:59:59.000Z");
    const fetchMock = basicSnapshotFetchMock((url) => {
      const page = Number(url.searchParams.get("page"));
      const start = (page - 1) * 100;
      return jsonResponse(
        Array.from({ length: 100 }, (_, index) => {
          const offset = start + index;
          return activityEvent(
            `event-${offset}`,
            "PushEvent",
            new Date(baseTimestamp - offset * 1_000).toISOString(),
            { ref: "refs/heads/main" }
          );
        })
      );
    });

    const snapshot = await fetchAndStoreGitHubSnapshot(testConfig(), {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl: fetchMock as unknown as typeof fetch,
      cwd
    });

    expect(snapshot.activitiesState).toBe("partial");
    expect(snapshot.activitiesTruncated).toBe(true);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.activities).toHaveLength(MAX_GITHUB_ACTIVITIES);
    expect(snapshot.activities[0].id).toBe("event-0");
    expect(snapshot.activities.at(-1)?.id).toBe("event-299");
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => requestUrl(input).pathname === "/users/nika/events"
      )
    ).toHaveLength(3);
  });

  it("keeps successful GitHub Events pages when a later page fails", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);
    const fetchMock = basicSnapshotFetchMock((url) => {
      const page = Number(url.searchParams.get("page"));
      if (page === 2) {
        return jsonResponse({ message: "SECOND_PAGE_FAILED" }, 500);
      }
      return jsonResponse(
        Array.from({ length: 100 }, (_, index) =>
          activityEvent(
            `kept-${index}`,
            "PushEvent",
            new Date(
              Date.parse("2026-07-25T00:59:59.000Z") -
                index * 1_000
            ).toISOString(),
            { ref: "refs/heads/main" }
          )
        )
      );
    });

    const snapshot = await fetchAndStoreGitHubSnapshot(testConfig(), {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl: fetchMock as unknown as typeof fetch,
      cwd
    });

    expect(snapshot.activitiesState).toBe("partial");
    expect(snapshot.activitiesTruncated).toBe(true);
    expect(snapshot.activities).toHaveLength(100);
    expect(snapshot.activities[0].id).toBe("kept-0");
    expect(
      JSON.stringify(snapshot)
    ).not.toContain("SECOND_PAGE_FAILED");
  });

  it("marks supported malformed GitHub events as partial instead of silently complete", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);
    const fetchMock = basicSnapshotFetchMock(() =>
      jsonResponse([
        activityEvent(
          "valid",
          "PushEvent",
          "2026-07-25T00:59:00.000Z",
          { ref: "refs/heads/main" }
        ),
        activityEvent(
          "malformed",
          "PushEvent",
          "2026-07-25T00:58:00.000Z",
          { ref: null }
        )
      ])
    );

    const snapshot = await fetchAndStoreGitHubSnapshot(testConfig(), {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl: fetchMock as unknown as typeof fetch,
      cwd
    });

    expect(snapshot.activitiesState).toBe("partial");
    expect(snapshot.activitiesTruncated).toBe(false);
    expect(snapshot.activities).toEqual([
      expect.objectContaining({ id: "valid", activityKind: "push" })
    ]);
  });

  it("keeps repositories and tasks when the Events request fails", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);
    const fetchMock = basicSnapshotFetchMock(
      () => jsonResponse({ message: "SECRET_EVENTS_ERROR" }, 500),
      {
        issues: [
          taskResponse(501, "acme/alpha", 41, "유지할 담당 이슈")
        ]
      }
    );

    const snapshot = await fetchAndStoreGitHubSnapshot(testConfig(), {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl: fetchMock as unknown as typeof fetch,
      cwd
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "github-snapshot-v2",
      activitiesState: "unavailable",
      activitiesTruncated: false,
      activities: []
    });
    expect(snapshot.repositories).toHaveLength(1);
    expect(snapshot.tasks).toEqual([
      expect.objectContaining({
        id: 501,
        title: "유지할 담당 이슈"
      })
    ]);
    expect(
      await readFile(
        join(githubLocalDirectory(cwd), "snapshot.json"),
        "utf8"
      )
    ).not.toContain("SECRET_EVENTS_ERROR");
  });

  it("reads a v1 snapshot as v2 with unavailable empty activities", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);
    const legacySnapshot = {
      schemaVersion: "github-snapshot-v1",
      appClientId: "Iv1.client",
      appSlug: "blabase",
      apiVersion: GITHUB_API_VERSION,
      fetchedAt: "2026-07-25T01:00:00.000Z",
      user: { id: 7, login: "nika" },
      truncated: false,
      installations: [],
      repositories: [],
      tasks: []
    };
    await writeFile(
      join(githubLocalDirectory(cwd), "snapshot.json"),
      JSON.stringify(legacySnapshot),
      { mode: 0o600 }
    );

    await expect(readStoredGitHubSnapshot(cwd)).resolves.toEqual({
      ...legacySnapshot,
      schemaVersion: "github-snapshot-v2",
      activityWindowStart: "2026-06-25T01:00:00.000Z",
      activitiesState: "unavailable",
      activitiesTruncated: false,
      activities: []
    });
  });

  it("rotates both tokens after a 401 and retries with the new access token", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);
    let userRequestCount = 0;

    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.toString() === testConfig().tokenEndpoint) {
          const body = new URLSearchParams(String(init?.body));
          expect(body.get("grant_type")).toBe("refresh_token");
          expect(body.get("refresh_token")).toBe("refresh-token");
          return tokenResponse({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token"
          });
        }
        if (url.pathname === "/user") {
          userRequestCount += 1;
          if (userRequestCount === 1) {
            expect(init?.headers).toMatchObject({
              Authorization: "Bearer access-token"
            });
            return jsonResponse({ message: "Bad credentials" }, 401);
          }
          expect(init?.headers).toMatchObject({
            Authorization: "Bearer new-access-token"
          });
          return jsonResponse({ id: 7, login: "nika" });
        }
        if (url.pathname === "/user/installations") {
          return jsonResponse({
            total_count: 0,
            installations: []
          });
        }
        throw new Error(`unexpected URL: ${url.toString()}`);
      }
    ) as unknown as typeof fetch;

    await fetchAndStoreGitHubSnapshot(testConfig(), {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl,
      cwd
    });

    expect(userRequestCount).toBe(2);
    expect(await readStoredGitHubTokens(cwd)).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token"
    });
  });

  it("retries a late parallel 401 with a token another request already rotated", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(storedTokens(), cwd);
    let releaseLateRequest: (() => void) | undefined;
    const newTokenRetryStarted = new Promise<void>((resolve) => {
      releaseLateRequest = resolve;
    });

    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        const authorization = (
          init?.headers as Record<string, string> | undefined
        )?.Authorization;

        if (url.toString() === testConfig().tokenEndpoint) {
          return tokenResponse({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token"
          });
        }
        if (url.pathname === "/user") {
          return jsonResponse({ id: 7, login: "nika" });
        }
        if (url.pathname === "/user/installations") {
          return jsonResponse({
            total_count: 1,
            installations: [
              {
                id: 10,
                account: { login: "acme", type: "Organization" },
                repository_selection: "selected",
                suspended_at: null
              }
            ]
          });
        }
        if (
          url.pathname === "/user/installations/10/repositories"
        ) {
          return jsonResponse({
            total_count: 1,
            repositories: [repositoryResponse(101, "acme/alpha")]
          });
        }
        if (url.pathname === "/issues") {
          if (authorization === "Bearer access-token") {
            return jsonResponse({ message: "Bad credentials" }, 401);
          }
          expect(authorization).toBe("Bearer new-access-token");
          releaseLateRequest?.();
          return jsonResponse([]);
        }
        if (url.pathname === "/search/issues") {
          const query = url.searchParams.get("q") ?? "";
          if (
            query.includes("review-requested:") &&
            authorization === "Bearer access-token"
          ) {
            await newTokenRetryStarted;
            return jsonResponse({ message: "Bad credentials" }, 401);
          }
          return searchResponse([]);
        }
        throw new Error(`unexpected URL: ${url.toString()}`);
      }
    );

    await expect(
      fetchAndStoreGitHubSnapshot(testConfig(), {
        now: new Date("2026-07-25T01:00:00.000Z"),
        fetchImpl: fetchMock as unknown as typeof fetch,
        cwd
      })
    ).resolves.toMatchObject({ tasks: [] });

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => requestUrl(input).toString() === testConfig().tokenEndpoint
      )
    ).toHaveLength(1);
  });

  it("shares one rotating refresh across simultaneous snapshot syncs", async () => {
    const cwd = await createTempDirectory();
    await writeStoredGitHubTokens(
      {
        ...storedTokens(),
        expiresAt: "2026-07-25T01:00:30.000Z"
      },
      cwd
    );

    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.toString() === testConfig().tokenEndpoint) {
          return tokenResponse({
            access_token: "shared-access-token",
            refresh_token: "shared-refresh-token"
          });
        }
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer shared-access-token"
        });
        if (url.pathname === "/user") {
          return jsonResponse({ id: 7, login: "nika" });
        }
        if (url.pathname === "/user/installations") {
          return jsonResponse({
            total_count: 0,
            installations: []
          });
        }
        throw new Error(`unexpected URL: ${url.toString()}`);
      }
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const options = {
      now: new Date("2026-07-25T01:00:00.000Z"),
      fetchImpl,
      cwd
    };

    await expect(
      Promise.all([
        fetchAndStoreGitHubSnapshot(testConfig(), options),
        fetchAndStoreGitHubSnapshot(testConfig(), options)
      ])
    ).resolves.toHaveLength(2);

    expect(
      fetchMock.mock.calls.filter(
        ([input]) => requestUrl(input).toString() === testConfig().tokenEndpoint
      )
    ).toHaveLength(1);
    expect(await readStoredGitHubTokens(cwd)).toMatchObject({
      accessToken: "shared-access-token",
      refreshToken: "shared-refresh-token"
    });
  });

  it("revokes the GitHub App authorization grant with app credentials", async () => {
    const fetchImpl = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        expect(input.toString()).toBe(
          "https://api.github.com/applications/Iv1.client/grant"
        );
        expect(init?.method).toBe("DELETE");
        expect(init?.headers).toMatchObject({
          Authorization: `Basic ${Buffer.from(
            "Iv1.client:client-secret"
          ).toString("base64")}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          access_token: "access-token"
        });
        return new Response(null, { status: 204 });
      }
    ) as unknown as typeof fetch;

    await revokeGitHubAuthorization(
      testConfig(),
      "access-token",
      fetchImpl
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "blabase-github-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function testConfig(): GitHubConfig {
  return {
    clientId: "Iv1.client",
    clientSecret: "client-secret",
    appSlug: "blabase",
    redirectUri: DEFAULT_GITHUB_REDIRECT_URI,
    installationEndpoint: "https://github.com/apps",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    apiBaseUrl: "https://api.github.com",
    apiVersion: GITHUB_API_VERSION
  };
}

function storedTokens() {
  return {
    appClientId: "Iv1.client",
    appSlug: "blabase",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: "2026-07-26T00:00:00.000Z",
    refreshTokenExpiresAt: "2027-01-25T00:00:00.000Z",
    tokenType: "bearer",
    scope: ""
  };
}

function tokenResponse(
  overrides: Record<string, unknown> = {}
): Response {
  return jsonResponse({
    access_token: "access-token",
    expires_in: 28_800,
    refresh_token: "refresh-token",
    refresh_token_expires_in: 15_897_600,
    scope: "",
    token_type: "bearer",
    ...overrides
  });
}

function repositoryResponse(
  id: number,
  fullName: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    full_name: fullName,
    private: false,
    archived: false,
    updated_at: "2026-07-23T03:00:00.000Z",
    ...overrides
  };
}

function taskResponse(
  id: number,
  repositoryFullName: string,
  number: number,
  title: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    number,
    title,
    state: "open",
    repository_url: `https://api.github.com/repos/${repositoryFullName}`,
    html_url: `https://github.com/${repositoryFullName}/issues/${number}`,
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z",
    labels: [],
    milestone: null,
    ...overrides
  };
}

function searchResponse(items: unknown[]): Response {
  return jsonResponse({
    total_count: items.length,
    incomplete_results: false,
    items
  });
}

function basicSnapshotFetchMock(
  eventsResponse: (url: URL) => Response | Promise<Response>,
  options: { issues?: unknown[] } = {}
) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = requestUrl(input);
    if (url.pathname === "/user") {
      return jsonResponse({ id: 7, login: "nika" });
    }
    if (url.pathname === "/user/installations") {
      return jsonResponse({
        total_count: 1,
        installations: [
          {
            id: 10,
            account: { login: "acme", type: "Organization" },
            repository_selection: "selected",
            suspended_at: null
          }
        ]
      });
    }
    if (url.pathname === "/user/installations/10/repositories") {
      return jsonResponse({
        total_count: 1,
        repositories: [repositoryResponse(101, "acme/alpha")]
      });
    }
    if (url.pathname === "/issues") {
      return jsonResponse(options.issues ?? []);
    }
    if (url.pathname === "/search/issues") {
      return searchResponse([]);
    }
    if (url.pathname === "/users/nika/events") {
      return eventsResponse(url);
    }
    throw new Error(`unexpected URL: ${url.toString()}`);
  });
}

function activityEvent(
  id: string,
  type: string,
  createdAt: string,
  payload: unknown,
  overrides: {
    actorLogin?: string;
    repositoryId?: number;
    repositoryFullName?: string;
  } = {}
) {
  return {
    id,
    type,
    actor: {
      id: 7,
      login: overrides.actorLogin ?? "nika",
      email: "SECRET_ACTOR_EMAIL",
      avatar_url: "SECRET_ACTOR_AVATAR"
    },
    repo: {
      id: overrides.repositoryId ?? 101,
      name: overrides.repositoryFullName ?? "acme/alpha",
      url: "SECRET_REPOSITORY_API_URL"
    },
    payload,
    public: false,
    created_at: createdAt,
    org: {
      id: 88,
      login: "SECRET_ORGANIZATION"
    }
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function requestUrl(input: URL | RequestInfo): URL {
  return new URL(
    input instanceof URL
      ? input.toString()
      : typeof input === "string"
        ? input
        : input.url
  );
}
