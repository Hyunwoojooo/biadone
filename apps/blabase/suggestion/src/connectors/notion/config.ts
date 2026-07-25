import { z } from "zod";

export const NOTION_API_VERSION = "2026-03-11";
export const NOTION_AUTHORIZATION_ENDPOINT =
  "https://api.notion.com/v1/oauth/authorize";
export const NOTION_TOKEN_ENDPOINT =
  "https://api.notion.com/v1/oauth/token";
export const NOTION_REVOKE_ENDPOINT =
  "https://api.notion.com/v1/oauth/revoke";
export const DEFAULT_NOTION_REDIRECT_URI =
  "http://localhost:3102/api/connectors/notion/callback";

const urlSchema = z.string().url();

export type NotionConfig = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint: string;
  redirectUri: string;
  apiVersion: string;
};

export type NotionConfigResult =
  | {
      ok: true;
      config: NotionConfig;
    }
  | {
      ok: false;
      reason: "missing" | "invalid_redirect_uri";
      message: string;
    };

export function loadNotionConfig(
  env: NodeJS.ProcessEnv = process.env
): NotionConfigResult {
  const clientId = env.NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      reason: "missing",
      message:
        "Notion Public connection의 OAuth Client ID와 Client Secret을 설정해주세요."
    };
  }

  const redirectUri =
    env.NOTION_OAUTH_REDIRECT_URI?.trim() ||
    DEFAULT_NOTION_REDIRECT_URI;
  if (!urlSchema.safeParse(redirectUri).success) {
    return {
      ok: false,
      reason: "invalid_redirect_uri",
      message: "Notion OAuth Redirect URI 형식을 확인해주세요."
    };
  }

  return {
    ok: true,
    config: {
      clientId,
      clientSecret,
      authorizationEndpoint: NOTION_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: NOTION_TOKEN_ENDPOINT,
      revokeEndpoint: NOTION_REVOKE_ENDPOINT,
      redirectUri,
      apiVersion: NOTION_API_VERSION
    }
  };
}

export function isLocalNotionRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return new URL(request.url).hostname === "localhost";
}
