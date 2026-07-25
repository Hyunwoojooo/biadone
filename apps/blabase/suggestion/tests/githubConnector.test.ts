import {
  mkdtemp,
  readFile,
  rm,
  stat
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
  fetchAndStoreGitHubSnapshot
} from "../src/connectors/github/githubApi";
import {
  githubLocalDirectory,
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
                permissions: { contents: "read" }
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
