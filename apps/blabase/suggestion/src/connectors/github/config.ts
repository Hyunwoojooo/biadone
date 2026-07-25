import { z } from "zod";

export const GITHUB_API_VERSION = "2026-03-10";
export const GITHUB_INSTALLATION_ENDPOINT = "https://github.com/apps";
export const GITHUB_AUTHORIZATION_ENDPOINT =
  "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_ENDPOINT =
  "https://github.com/login/oauth/access_token";
export const GITHUB_API_BASE_URL = "https://api.github.com";
export const DEFAULT_GITHUB_REDIRECT_URI =
  "http://localhost:3102/api/connectors/github/callback";

const appSlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/);
const urlSchema = z.string().url();

export type GitHubConfig = {
  clientId: string;
  clientSecret: string;
  appSlug: string;
  redirectUri: string;
  installationEndpoint: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  apiBaseUrl: string;
  apiVersion: string;
};

export type GitHubConfigResult =
  | {
      ok: true;
      config: GitHubConfig;
    }
  | {
      ok: false;
      reason: "missing" | "invalid_slug" | "invalid_redirect_uri";
      message: string;
    };

export function loadGitHubConfig(
  env: NodeJS.ProcessEnv = process.env
): GitHubConfigResult {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  const appSlug = env.GITHUB_APP_SLUG?.trim();

  if (!clientId || !clientSecret || !appSlug) {
    return {
      ok: false,
      reason: "missing",
      message:
        "GitHub App Client ID, Client Secret, App slug를 설정해주세요."
    };
  }

  if (!appSlugSchema.safeParse(appSlug).success) {
    return {
      ok: false,
      reason: "invalid_slug",
      message: "GitHub App slug 형식을 확인해주세요."
    };
  }

  const redirectUri =
    env.GITHUB_APP_REDIRECT_URI?.trim() ||
    DEFAULT_GITHUB_REDIRECT_URI;
  if (!urlSchema.safeParse(redirectUri).success) {
    return {
      ok: false,
      reason: "invalid_redirect_uri",
      message: "GitHub App Callback URL 형식을 확인해주세요."
    };
  }

  return {
    ok: true,
    config: {
      clientId,
      clientSecret,
      appSlug,
      redirectUri,
      installationEndpoint: GITHUB_INSTALLATION_ENDPOINT,
      authorizationEndpoint: GITHUB_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: GITHUB_TOKEN_ENDPOINT,
      apiBaseUrl: GITHUB_API_BASE_URL,
      apiVersion: GITHUB_API_VERSION
    }
  };
}

export function isLocalGitHubRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return new URL(request.url).hostname === "localhost";
}
