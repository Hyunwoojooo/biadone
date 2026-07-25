import { randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { NotionConfig } from "./config";
import type { StoredNotionTokens } from "./types";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).nullable(),
  token_type: z.string().min(1),
  bot_id: z.string().min(1),
  workspace_id: z.string().min(1),
  workspace_name: z.string().nullable()
});

export const NOTION_STATE_COOKIE = "blabase_notion_oauth_state";

export function createNotionOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function notionOAuthStatesMatch(
  expected: string | undefined,
  actual: string | null
): boolean {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createNotionAuthorizationUrl(
  config: NotionConfig,
  state: string
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("owner", "user");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeNotionAuthorizationCode(
  config: NotionConfig,
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<StoredNotionTokens> {
  const payload = await requestToken(
    config,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri
    },
    fetchImpl
  );
  if (!payload.refresh_token) {
    throw new NotionOAuthError("REFRESH_TOKEN_MISSING");
  }
  return normalizeTokens(payload);
}

export async function refreshNotionAccessToken(
  config: NotionConfig,
  previousTokens: StoredNotionTokens,
  fetchImpl: typeof fetch = fetch
): Promise<StoredNotionTokens> {
  const payload = await requestToken(
    config,
    {
      grant_type: "refresh_token",
      refresh_token: previousTokens.refreshToken
    },
    fetchImpl
  );
  if (!payload.refresh_token) {
    throw new NotionOAuthError("REFRESH_TOKEN_MISSING");
  }
  return normalizeTokens(payload);
}

export async function revokeNotionToken(
  config: NotionConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl(config.revokeEndpoint, {
    method: "POST",
    headers: notionOAuthHeaders(config),
    body: JSON.stringify({ token: accessToken })
  });
  if (!response.ok) {
    throw new NotionOAuthError("TOKEN_REVOKE_FAILED");
  }
}

export class NotionOAuthError extends Error {
  constructor(
    readonly code:
      | "TOKEN_REQUEST_FAILED"
      | "TOKEN_RESPONSE_INVALID"
      | "REFRESH_TOKEN_MISSING"
      | "TOKEN_REVOKE_FAILED"
  ) {
    super(code);
    this.name = "NotionOAuthError";
  }
}

async function requestToken(
  config: NotionConfig,
  body:
    | {
        grant_type: "authorization_code";
        code: string;
        redirect_uri: string;
      }
    | {
        grant_type: "refresh_token";
        refresh_token: string;
      },
  fetchImpl: typeof fetch
): Promise<z.infer<typeof tokenResponseSchema>> {
  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: notionOAuthHeaders(config),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new NotionOAuthError("TOKEN_REQUEST_FAILED");
  }
  try {
    return tokenResponseSchema.parse(await response.json());
  } catch {
    throw new NotionOAuthError("TOKEN_RESPONSE_INVALID");
  }
}

function notionOAuthHeaders(config: NotionConfig) {
  return {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(
      `${config.clientId}:${config.clientSecret}`
    ).toString("base64")}`,
    "Content-Type": "application/json",
    "Notion-Version": config.apiVersion
  };
}

function normalizeTokens(
  payload: z.infer<typeof tokenResponseSchema>
): StoredNotionTokens {
  if (!payload.refresh_token) {
    throw new NotionOAuthError("REFRESH_TOKEN_MISSING");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type,
    botId: payload.bot_id,
    workspaceId: payload.workspace_id,
    workspaceName: payload.workspace_name
  };
}
