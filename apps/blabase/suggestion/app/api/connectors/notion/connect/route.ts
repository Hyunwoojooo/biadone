import { NextResponse } from "next/server";

import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../../../../../src/connectors/notion/config";
import {
  createNotionAuthorizationUrl,
  createNotionOAuthState,
  NOTION_STATE_COOKIE
} from "../../../../../src/connectors/notion/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalNotionRequest(request)) {
    return NextResponse.redirect(new URL("/?notion=local_only", request.url));
  }

  loadSharedLocalEnv();
  const configResult = loadNotionConfig();
  if (!configResult.ok) {
    return NextResponse.redirect(
      new URL("/?notion=temporarily_unavailable", request.url)
    );
  }

  const state = createNotionOAuthState();
  const response = NextResponse.redirect(
    createNotionAuthorizationUrl(configResult.config, state)
  );
  response.cookies.set(NOTION_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 10 * 60,
    path: "/"
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
