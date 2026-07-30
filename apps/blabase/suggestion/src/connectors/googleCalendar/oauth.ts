import { randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  GOOGLE_CALENDAR_SCOPE,
  type GoogleCalendarConfig
} from "./config";
import type { StoredGoogleCalendarTokens } from "./types";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional()
});

export const GOOGLE_CALENDAR_STATE_COOKIE =
  "blabase_google_calendar_oauth_state";

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function oauthStatesMatch(
  expected: string | undefined,
  actual: string | null
): boolean {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createGoogleAuthorizationUrl(
  config: GoogleCalendarConfig,
  state: string
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeAuthorizationCode(
  config: GoogleCalendarConfig,
  code: string,
  previousTokens: StoredGoogleCalendarTokens | null = null,
  fetchImpl: typeof fetch = fetch
): Promise<StoredGoogleCalendarTokens> {
  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code"
    })
  });

  const payload = await readTokenPayload(response);
  const refreshToken = payload.refresh_token ?? previousTokens?.refreshToken;
  if (!refreshToken) {
    throw new GoogleCalendarOAuthError("REFRESH_TOKEN_MISSING");
  }

  return {
    accessToken: payload.access_token,
    refreshToken,
    expiresAt: expiresAt(payload.expires_in),
    scope: payload.scope ?? GOOGLE_CALENDAR_SCOPE,
    tokenType: payload.token_type ?? "Bearer"
  };
}

export async function refreshAccessToken(
  config: GoogleCalendarConfig,
  tokens: StoredGoogleCalendarTokens,
  fetchImpl: typeof fetch = fetch
): Promise<StoredGoogleCalendarTokens> {
  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token"
    })
  });

  const payload = await readTokenPayload(response);
  return {
    connectionScopeId: tokens.connectionScopeId,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? tokens.refreshToken,
    expiresAt: expiresAt(payload.expires_in),
    scope: payload.scope ?? tokens.scope,
    tokenType: payload.token_type ?? tokens.tokenType
  };
}

export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token })
  });
  if (!response.ok) {
    throw new GoogleCalendarOAuthError("TOKEN_REVOKE_FAILED");
  }
}

export class GoogleCalendarOAuthError extends Error {
  constructor(
    readonly code:
      | "TOKEN_REQUEST_FAILED"
      | "TOKEN_RESPONSE_INVALID"
      | "REFRESH_TOKEN_MISSING"
      | "TOKEN_REVOKE_FAILED"
  ) {
    super(code);
    this.name = "GoogleCalendarOAuthError";
  }
}

async function readTokenPayload(
  response: Response
): Promise<z.infer<typeof tokenResponseSchema>> {
  if (!response.ok) {
    throw new GoogleCalendarOAuthError("TOKEN_REQUEST_FAILED");
  }
  try {
    return tokenResponseSchema.parse(await response.json());
  } catch {
    throw new GoogleCalendarOAuthError("TOKEN_RESPONSE_INVALID");
  }
}

function expiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}
