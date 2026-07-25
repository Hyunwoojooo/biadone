import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned.readonly";
export const DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI =
  "http://localhost:3102/api/connectors/google-calendar/callback";

const credentialSchema = z.object({
  web: z.object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    auth_uri: z
      .string()
      .url()
      .default("https://accounts.google.com/o/oauth2/auth"),
    token_uri: z
      .string()
      .url()
      .default("https://oauth2.googleapis.com/token"),
    redirect_uris: z.array(z.string().url()).default([])
  })
});

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  credentialsPath: string;
};

export type GoogleCalendarConfigResult =
  | {
      ok: true;
      config: GoogleCalendarConfig;
    }
  | {
      ok: false;
      reason: "missing" | "invalid" | "redirect_uri_missing";
      message: string;
    };

export function loadGoogleCalendarConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): GoogleCalendarConfigResult {
  const configuredPath = env.GOOGLE_CALENDAR_CREDENTIALS_PATH?.trim();
  const credentialsPath = configuredPath
    ? isAbsolute(configuredPath)
      ? configuredPath
      : resolve(cwd, configuredPath)
    : join(cwd, ".local", "connectors", "google-calendar", "credentials.json");

  let raw: string;
  try {
    raw = readFileSync(credentialsPath, "utf8");
  } catch {
    return {
      ok: false,
      reason: "missing",
      message:
        "Google OAuth credentials.json을 로컬 비공개 폴더에 추가해주세요."
    };
  }

  let parsed: z.infer<typeof credentialSchema>;
  try {
    parsed = credentialSchema.parse(JSON.parse(raw));
  } catch {
    return {
      ok: false,
      reason: "invalid",
      message: "Google OAuth credentials.json 형식을 확인해주세요."
    };
  }

  const redirectUri =
    env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() ||
    DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI;

  if (!parsed.web.redirect_uris.includes(redirectUri)) {
    return {
      ok: false,
      reason: "redirect_uri_missing",
      message: `Google OAuth 설정에 ${redirectUri} 주소를 추가해주세요.`
    };
  }

  return {
    ok: true,
    config: {
      clientId: parsed.web.client_id,
      clientSecret: parsed.web.client_secret,
      authorizationEndpoint: parsed.web.auth_uri,
      tokenEndpoint: parsed.web.token_uri,
      redirectUri,
      credentialsPath
    }
  };
}

export function isLocalCalendarRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return new URL(request.url).hostname === "localhost";
}
