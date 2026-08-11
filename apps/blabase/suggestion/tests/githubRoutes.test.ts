import { NextRequest } from "next/server";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock("../src/connectors/github/localStore", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/github/localStore")
    >();
  return {
    ...actual,
    deleteStoredGitHubConnection: vi.fn(async () => undefined),
    readStoredGitHubSnapshot: vi.fn(async () => null),
    readStoredGitHubTokens: vi.fn(async () => null),
    replaceStoredGitHubConnection: vi.fn(async () => undefined)
  };
});

vi.mock("../src/connectors/github/oauth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/connectors/github/oauth")>();
  return {
    ...actual,
    exchangeGitHubAuthorizationCode: vi.fn(),
    refreshGitHubAccessToken: vi.fn(),
    revokeGitHubAuthorization: vi.fn(async () => undefined)
  };
});

vi.mock("../src/artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/artifacts")>();
  return {
    ...actual,
    clearWorkArtifactAttributionStore: vi.fn(async () => undefined)
  };
});

vi.mock("../src/resumption", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/resumption")>();
  return {
    ...actual,
    withWorkResumptionStateLease: vi.fn(
      async (_cwd: string, operation: () => Promise<unknown>) =>
        operation()
    )
  };
});

vi.mock("../src/sync/runtime", () => ({
  noteRuntimeSourceDisconnected: vi.fn(async () => undefined),
  supersedeRuntimeSourceConnection: vi.fn(async () => undefined),
  syncRuntimeSources: vi.fn()
}));

import { GET as callback } from "../app/api/connectors/github/callback/route";
import { GET as connect } from "../app/api/connectors/github/connect/route";
import { POST as disconnect } from "../app/api/connectors/github/disconnect/route";
import { GET as installed } from "../app/api/connectors/github/installed/route";
import { GET as status } from "../app/api/connectors/github/status/route";
import { clearWorkArtifactAttributionStore } from "../src/artifacts";
import {
  deleteStoredGitHubConnection,
  readStoredGitHubSnapshot,
  readStoredGitHubTokens,
  replaceStoredGitHubConnection
} from "../src/connectors/github/localStore";
import {
  exchangeGitHubAuthorizationCode,
  GITHUB_STATE_COOKIE,
  refreshGitHubAccessToken,
  revokeGitHubAuthorization
} from "../src/connectors/github/oauth";
import type {
  GitHubSnapshot,
  StoredGitHubTokens
} from "../src/connectors/github/types";
import { withWorkResumptionStateLease } from "../src/resumption";
import {
  noteRuntimeSourceDisconnected,
  supersedeRuntimeSourceConnection,
  syncRuntimeSources
} from "../src/sync/runtime";

beforeEach(() => {
  vi.mocked(syncRuntimeSources).mockResolvedValue(
    syncResponse("github")
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GitHub connector routes", () => {
  it("starts the user authorization flow with a cookie-bound state", async () => {
    setDevelopmentConfig();

    const response = await connect(
      new Request("http://localhost:3102/api/connectors/github/connect")
    );
    const location = new URL(requiredHeader(response, "location"));
    const cookie = requiredHeader(response, "set-cookie");
    const state = location.searchParams.get("state");

    expect(location.origin).toBe("https://github.com");
    expect(location.pathname).toBe("/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("Iv1.client");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3102/api/connectors/github/callback"
    );
    expect(state).toBeTruthy();
    expect(cookie).toContain(`${GITHUB_STATE_COOKIE}=${state}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
  });

  it("validates state before accepting an OAuth cancellation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await callback(
      callbackRequest({
        cookieState: "expected-state",
        queryState: "different-state",
        error: "access_denied"
      })
    );

    expectSourceRedirect(response, "failed");
  });

  it("reports a genuine state-bound OAuth cancellation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await callback(
      callbackRequest({
        cookieState: "expected-state",
        queryState: "expected-state",
        error: "access_denied"
      })
    );

    expectSourceRedirect(response, "cancelled");
  });

  it("routes the post-OAuth snapshot collection through the coordinator", async () => {
    setDevelopmentConfig();
    const tokens = storedTokens();
    vi.mocked(exchangeGitHubAuthorizationCode).mockResolvedValue(tokens);
    vi.mocked(readStoredGitHubSnapshot).mockResolvedValue(
      githubSnapshot({ installations: [{ id: 1 }] })
    );

    const response = await callback(
      githubCallbackRequest({
        cookieState: "expected-state",
        queryState: "expected-state",
        code: "oauth-code"
      })
    );

    expect(replaceStoredGitHubConnection).toHaveBeenCalledWith(tokens);
    expect(clearWorkArtifactAttributionStore).toHaveBeenCalledOnce();
    expect(withWorkResumptionStateLease).toHaveBeenCalledOnce();
    expect(syncRuntimeSources).toHaveBeenCalledWith({
      sources: ["github"]
    });
    expect(supersedeRuntimeSourceConnection).toHaveBeenCalledWith(
      "github"
    );
    expect(
      vi.mocked(supersedeRuntimeSourceConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(withWorkResumptionStateLease).mock
        .invocationCallOrder[0]!
    );
    expect(
      vi.mocked(withWorkResumptionStateLease).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(clearWorkArtifactAttributionStore).mock
        .invocationCallOrder[0]!
    );
    expect(
      vi.mocked(clearWorkArtifactAttributionStore).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(replaceStoredGitHubConnection).mock
        .invocationCallOrder[0]!
    );
    expect(
      vi.mocked(replaceStoredGitHubConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(syncRuntimeSources).mock.invocationCallOrder[0]!
    );
    expectSourceRedirect(response, "connected");
  });

  it("returns authorization without an installation to the GitHub source panel", async () => {
    setDevelopmentConfig();
    vi.mocked(exchangeGitHubAuthorizationCode).mockResolvedValue(
      storedTokens()
    );
    vi.mocked(readStoredGitHubSnapshot).mockResolvedValue(
      githubSnapshot()
    );

    const response = await callback(
      githubCallbackRequest({
        cookieState: "expected-state",
        queryState: "expected-state",
        code: "oauth-code"
      })
    );

    expectSourceRedirect(response, "installation_required");
  });

  it("reports sync pending when the coordinator records a GitHub failure", async () => {
    setDevelopmentConfig();
    vi.mocked(exchangeGitHubAuthorizationCode).mockResolvedValue(
      storedTokens()
    );
    vi.mocked(syncRuntimeSources).mockResolvedValue(
      syncResponse("github", {
        status: "backoff",
        lastSuccessAt: null,
        lastFailureAt: "2026-07-25T10:00:01.000Z",
        nextRetryAt: "2026-07-25T10:00:06.000Z",
        retryCount: 1,
        lastErrorCode: "GITHUB_API_UNAVAILABLE",
        snapshotRevision: null
      })
    );

    const response = await callback(
      githubCallbackRequest({
        cookieState: "expected-state",
        queryState: "expected-state",
        code: "oauth-code"
      })
    );

    expect(readStoredGitHubSnapshot).not.toHaveBeenCalled();
    expectSourceRedirect(response, "connected_sync_pending");
  });

  it("keeps old GitHub credentials untouched when lineage reset persistence fails", async () => {
    setDevelopmentConfig();
    vi.mocked(exchangeGitHubAuthorizationCode).mockResolvedValue(
      storedTokens()
    );
    vi.mocked(supersedeRuntimeSourceConnection).mockRejectedValue(
      new Error("STORE_WRITE_FAILED")
    );

    const response = await callback(
      githubCallbackRequest({
        cookieState: "expected-state",
        queryState: "expected-state",
        code: "oauth-code"
      })
    );

    expect(replaceStoredGitHubConnection).not.toHaveBeenCalled();
    expect(syncRuntimeSources).not.toHaveBeenCalled();
    expectSourceRedirect(response, "failed");
  });

  it("rejects an installation return whose state does not match", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await installed(
      new NextRequest(
        "http://localhost:3102/api/connectors/github/installed?state=wrong",
        {
          headers: {
            cookie: `${GITHUB_STATE_COOKIE}=expected`
          }
        }
      )
    );

    expectSourceRedirect(response, "failed");
  });

  it("routes an installation refresh through the coordinator", async () => {
    setDevelopmentConfig();
    vi.mocked(readStoredGitHubTokens).mockResolvedValue(storedTokens());
    vi.mocked(readStoredGitHubSnapshot).mockResolvedValue(
      githubSnapshot({ installations: [{ id: 1 }] })
    );

    const response = await installed(
      new NextRequest(
        "http://localhost:3102/api/connectors/github/installed?state=expected",
        {
          headers: {
            cookie: `${GITHUB_STATE_COOKIE}=expected`
          }
        }
      )
    );

    expect(replaceStoredGitHubConnection).toHaveBeenCalledWith(
      storedTokens()
    );
    expect(clearWorkArtifactAttributionStore).toHaveBeenCalledOnce();
    expect(withWorkResumptionStateLease).toHaveBeenCalledOnce();
    expect(syncRuntimeSources).toHaveBeenCalledWith({
      sources: ["github"]
    });
    expect(supersedeRuntimeSourceConnection).toHaveBeenCalledWith(
      "github"
    );
    expect(
      vi.mocked(supersedeRuntimeSourceConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(replaceStoredGitHubConnection).mock
        .invocationCallOrder[0]!
    );
    expectSourceRedirect(response, "installation_updated");
  });

  it("returns unavailable immediately when the GitHub App config is invalid", async () => {
    setDevelopmentConfig();
    vi.stubEnv("GITHUB_APP_SLUG", "Invalid Slug");

    const response = await status(
      new Request("http://localhost:3102/api/connectors/github/status")
    );

    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      message: "GitHub App slug 형식을 확인해주세요."
    });
  });

  it("refreshes an expired access token before revoking the full grant", async () => {
    setDevelopmentConfig();
    const expiredTokens = storedTokens({
      expiresAt: "2026-07-24T00:00:00.000Z"
    });
    const refreshedTokens = storedTokens({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: "2026-07-26T00:00:00.000Z"
    });
    vi.mocked(readStoredGitHubTokens).mockResolvedValue(expiredTokens);
    vi.mocked(refreshGitHubAccessToken).mockResolvedValue(refreshedTokens);

    const response = await disconnect(
      new Request(
        "http://localhost:3102/api/connectors/github/disconnect",
        {
          method: "POST",
          headers: { origin: "http://localhost:3102" }
        }
      )
    );

    expect(refreshGitHubAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "Iv1.client" }),
      expiredTokens
    );
    expect(revokeGitHubAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "Iv1.client" }),
      "new-access-token"
    );
    expect(deleteStoredGitHubConnection).toHaveBeenCalledOnce();
    expect(clearWorkArtifactAttributionStore).toHaveBeenCalledOnce();
    expect(withWorkResumptionStateLease).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      status: "disconnected",
      remoteRevocationFailed: false
    });
  });

  it("commits local deletion before waiting for remote revocation", async () => {
    setDevelopmentConfig();
    const tokens = storedTokens({
      expiresAt: "2099-07-26T00:00:00.000Z"
    });
    vi.mocked(readStoredGitHubTokens).mockResolvedValue(tokens);
    let releaseRevocation!: () => void;
    const revocationGate = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    vi.mocked(revokeGitHubAuthorization).mockReturnValue(
      revocationGate
    );

    const responsePromise = disconnect(
      new Request(
        "http://localhost:3102/api/connectors/github/disconnect",
        {
          method: "POST",
          headers: { origin: "http://localhost:3102" }
        }
      )
    );

    await vi.waitFor(() => {
      expect(deleteStoredGitHubConnection).toHaveBeenCalledOnce();
      expect(clearWorkArtifactAttributionStore).toHaveBeenCalledOnce();
      expect(noteRuntimeSourceDisconnected).toHaveBeenCalledWith(
        "github"
      );
      expect(revokeGitHubAuthorization).toHaveBeenCalledOnce();
    });
    expect(
      vi.mocked(clearWorkArtifactAttributionStore).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(deleteStoredGitHubConnection).mock
        .invocationCallOrder[0]!
    );
    expect(
      vi.mocked(deleteStoredGitHubConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(noteRuntimeSourceDisconnected).mock
        .invocationCallOrder[0]!
    );
    expect(
      vi.mocked(noteRuntimeSourceDisconnected).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(revokeGitHubAuthorization).mock
        .invocationCallOrder[0]!
    );
    releaseRevocation();

    const response = await responsePromise;
    await expect(response.json()).resolves.toEqual({
      status: "disconnected",
      remoteRevocationFailed: false
    });
  });
});

function setDevelopmentConfig(): void {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("GITHUB_APP_CLIENT_ID", "Iv1.client");
  vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "client-secret");
  vi.stubEnv("GITHUB_APP_SLUG", "blabase");
  vi.stubEnv(
    "GITHUB_APP_REDIRECT_URI",
    "http://localhost:3102/api/connectors/github/callback"
  );
}

function callbackRequest({
  cookieState,
  queryState,
  error
}: {
  cookieState: string;
  queryState: string;
  error: string;
}): NextRequest {
  const url = new URL(
    "http://localhost:3102/api/connectors/github/callback"
  );
  url.searchParams.set("state", queryState);
  url.searchParams.set("error", error);
  return new NextRequest(url, {
    headers: {
      cookie: `${GITHUB_STATE_COOKIE}=${cookieState}`
    }
  });
}

function githubCallbackRequest({
  cookieState,
  queryState,
  code
}: {
  cookieState: string;
  queryState: string;
  code: string;
}): NextRequest {
  const url = new URL(
    "http://localhost:3102/api/connectors/github/callback"
  );
  url.searchParams.set("state", queryState);
  url.searchParams.set("code", code);
  return new NextRequest(url, {
    headers: {
      cookie: `${GITHUB_STATE_COOKIE}=${cookieState}`
    }
  });
}

function storedTokens(
  overrides: Partial<StoredGitHubTokens> = {}
): StoredGitHubTokens {
  return {
    appClientId: "Iv1.client",
    appSlug: "blabase",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: "2026-07-26T00:00:00.000Z",
    refreshTokenExpiresAt: "2027-01-25T00:00:00.000Z",
    tokenType: "bearer",
    scope: "",
    ...overrides
  };
}

function githubSnapshot(
  overrides: {
    installations?: Array<{ id: number }>;
  } = {}
): GitHubSnapshot {
  return {
    schemaVersion: "github-snapshot-v2",
    appClientId: "Iv1.client",
    appSlug: "blabase",
    apiVersion: "2022-11-28",
    fetchedAt: "2026-07-25T10:00:00.000Z",
    activityWindowStart: "2026-07-18T10:00:00.000Z",
    activitiesState: "available",
    activitiesTruncated: false,
    user: { id: 1, login: "nika" },
    truncated: false,
    installations: (overrides.installations ?? []).map(({ id }) => ({
      id,
      accountLogin: "nika",
      accountType: "User" as const,
      repositorySelection: "selected" as const,
      suspended: false
    })),
    repositories: [],
    tasks: [],
    activities: []
  };
}

function syncResponse(
  source: "github",
  overrides: Partial<{
    status: "idle" | "syncing" | "backoff" | "disconnected" | "error";
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    nextRetryAt: string | null;
    retryCount: number;
    lastErrorCode: string | null;
    snapshotRevision: string | null;
    snapshotHash: string | null;
  }> = {}
) {
  return {
    status: "ready" as const,
    revision: "pipeline:test",
    generatedAt: "2026-07-25T10:00:01.000Z",
    adapterMode: "coordinator" as const,
    sources: [
      {
        source,
        status: "idle" as const,
        lastAttemptAt: "2026-07-25T10:00:00.000Z",
        lastSuccessAt: "2026-07-25T10:00:01.000Z",
        lastFailureAt: null,
        nextRetryAt: null,
        retryCount: 0,
        lastErrorCode: null,
        snapshotRevision: "github:2026-07-25T10:00:00.000Z",
        snapshotHash: "a".repeat(64),
        ...overrides
      }
    ]
  };
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`missing ${name} header`);
  return value;
}

function expectSourceRedirect(response: Response, status: string): void {
  const location = new URL(requiredHeader(response, "location"));
  expect(location.pathname).toBe("/sources");
  expect(location.searchParams.size).toBe(1);
  expect(location.searchParams.get("github")).toBe(status);
  expect(location.hash).toBe("#source-github");
}
