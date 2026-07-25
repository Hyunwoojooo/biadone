import { randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { GitHubConfig } from "./config";
import type { StoredGitHubTokens } from "./types";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
  scope: z.string().optional().default(""),
  token_type: z.string().min(1).optional().default("bearer")
});

export const GITHUB_STATE_COOKIE = "blabase_github_app_oauth_state";

export function createGitHubOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function githubOAuthStatesMatch(
  expected: string | undefined,
  actual: string | null
): boolean {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createGitHubInstallationUrl(
  config: GitHubConfig,
  state: string
): string {
  const base = config.installationEndpoint.replace(/\/$/, "");
  const url = new URL(
    `${base}/${encodeURIComponent(config.appSlug)}/installations/new`
  );
  url.searchParams.set("state", state);
  return url.toString();
}

export function createGitHubAuthorizationUrl(
  config: GitHubConfig,
  state: string
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export async function exchangeGitHubAuthorizationCode(
  config: GitHubConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<StoredGitHubTokens> {
  const payload = await requestToken(
    config,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri
    },
    fetchImpl
  );
  return normalizeExpiringTokens(payload, now, config);
}

export async function refreshGitHubAccessToken(
  config: GitHubConfig,
  previousTokens: StoredGitHubTokens,
  fetchImpl: typeof fetch = fetch,
  now = new Date()
): Promise<StoredGitHubTokens> {
  const refreshExpiry = Date.parse(previousTokens.refreshTokenExpiresAt);
  if (!Number.isFinite(refreshExpiry) || refreshExpiry <= now.getTime()) {
    throw new GitHubOAuthError("REFRESH_TOKEN_EXPIRED");
  }

  const payload = await requestToken(
    config,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: previousTokens.refreshToken
    },
    fetchImpl
  );
  return normalizeExpiringTokens(payload, now, config);
}

export async function revokeGitHubAuthorization(
  config: GitHubConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl(
    `${config.apiBaseUrl}/applications/${encodeURIComponent(
      config.clientId
    )}/grant`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${Buffer.from(
          `${config.clientId}:${config.clientSecret}`
        ).toString("base64")}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": config.apiVersion
      },
      body: JSON.stringify({ access_token: accessToken }),
      cache: "no-store"
    }
  );
  if (!response.ok) {
    throw new GitHubOAuthError("TOKEN_REVOKE_FAILED");
  }
}

export class GitHubOAuthError extends Error {
  constructor(
    readonly code:
      | "TOKEN_REQUEST_FAILED"
      | "TOKEN_RESPONSE_INVALID"
      | "EXPIRING_TOKEN_REQUIRED"
      | "REFRESH_TOKEN_EXPIRED"
      | "TOKEN_REVOKE_FAILED"
  ) {
    super(code);
    this.name = "GitHubOAuthError";
  }
}

async function requestToken(
  config: GitHubConfig,
  body: Record<string, string>,
  fetchImpl: typeof fetch
): Promise<z.infer<typeof tokenResponseSchema>> {
  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(body),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new GitHubOAuthError("TOKEN_REQUEST_FAILED");
  }

  try {
    return tokenResponseSchema.parse(await response.json());
  } catch {
    throw new GitHubOAuthError("TOKEN_RESPONSE_INVALID");
  }
}

function normalizeExpiringTokens(
  payload: z.infer<typeof tokenResponseSchema>,
  now: Date,
  config: GitHubConfig
): StoredGitHubTokens {
  if (
    !payload.expires_in ||
    !payload.refresh_token ||
    !payload.refresh_token_expires_in
  ) {
    throw new GitHubOAuthError("EXPIRING_TOKEN_REQUIRED");
  }

  return {
    appClientId: config.clientId,
    appSlug: config.appSlug,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: expiresAt(now, payload.expires_in),
    refreshTokenExpiresAt: expiresAt(
      now,
      payload.refresh_token_expires_in
    ),
    tokenType: payload.token_type,
    scope: payload.scope
  };
}

function expiresAt(now: Date, expiresInSeconds: number): string {
  return new Date(
    now.getTime() + expiresInSeconds * 1000
  ).toISOString();
}
