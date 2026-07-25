import { NextRequest } from "next/server";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/connectors/github/localStore", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/github/localStore")
    >();
  return {
    ...actual,
    deleteStoredGitHubSnapshot: vi.fn(async () => undefined),
    deleteStoredGitHubTokens: vi.fn(async () => undefined),
    readStoredGitHubTokens: vi.fn(async () => null)
  };
});

vi.mock("../src/connectors/github/oauth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/connectors/github/oauth")>();
  return {
    ...actual,
    refreshGitHubAccessToken: vi.fn(),
    revokeGitHubAuthorization: vi.fn(async () => undefined)
  };
});

import { GET as callback } from "../app/api/connectors/github/callback/route";
import { GET as connect } from "../app/api/connectors/github/connect/route";
import { POST as disconnect } from "../app/api/connectors/github/disconnect/route";
import { GET as installed } from "../app/api/connectors/github/installed/route";
import { GET as status } from "../app/api/connectors/github/status/route";
import {
  deleteStoredGitHubSnapshot,
  deleteStoredGitHubTokens,
  readStoredGitHubTokens
} from "../src/connectors/github/localStore";
import {
  GITHUB_STATE_COOKIE,
  refreshGitHubAccessToken,
  revokeGitHubAuthorization
} from "../src/connectors/github/oauth";
import type { StoredGitHubTokens } from "../src/connectors/github/types";

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

    expect(new URL(requiredHeader(response, "location")).searchParams.get(
      "github"
    )).toBe("failed");
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

    expect(new URL(requiredHeader(response, "location")).searchParams.get(
      "github"
    )).toBe("cancelled");
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

    expect(new URL(requiredHeader(response, "location")).searchParams.get(
      "github"
    )).toBe("failed");
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
    expect(deleteStoredGitHubTokens).toHaveBeenCalledOnce();
    expect(deleteStoredGitHubSnapshot).toHaveBeenCalledOnce();
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

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`missing ${name} header`);
  return value;
}
