import { NextResponse } from "next/server";

import { sourceConnectionReturnUrl } from "../../../../sourceNavigation";
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
    return NextResponse.redirect(
      sourceConnectionReturnUrl(request.url, "notion", "local_only")
    );
  }

  loadSharedLocalEnv();
  const configResult = loadNotionConfig();
  if (!configResult.ok) {
    return NextResponse.redirect(
      sourceConnectionReturnUrl(
        request.url,
        "notion",
        "temporarily_unavailable"
      )
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
