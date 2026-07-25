import { NextRequest, NextResponse } from "next/server";

import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../../../../../src/connectors/notion/config";
import {
  writeStoredNotionTokens
} from "../../../../../src/connectors/notion/localStore";
import { fetchAndStoreNotionSnapshot } from "../../../../../src/connectors/notion/notionApi";
import {
  exchangeNotionAuthorizationCode,
  notionOAuthStatesMatch,
  NOTION_STATE_COOKIE
} from "../../../../../src/connectors/notion/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalNotionRequest(request)) {
    return redirectWithClearedState(request, "local_only");
  }

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return redirectWithClearedState(
      request,
      error === "access_denied" ? "cancelled" : "failed"
    );
  }

  const expectedState = request.cookies.get(NOTION_STATE_COOKIE)?.value;
  const actualState = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !notionOAuthStatesMatch(expectedState, actualState)) {
    return redirectWithClearedState(request, "failed");
  }

  loadSharedLocalEnv();
  const configResult = loadNotionConfig();
  if (!configResult.ok) {
    return redirectWithClearedState(request, "temporarily_unavailable");
  }

  try {
    const tokens = await exchangeNotionAuthorizationCode(
      configResult.config,
      code
    );
    await writeStoredNotionTokens(tokens);

    let syncFailed = false;
    try {
      await fetchAndStoreNotionSnapshot(configResult.config);
    } catch {
      syncFailed = true;
    }

    return redirectWithClearedState(
      request,
      syncFailed ? "connected_sync_pending" : "connected"
    );
  } catch {
    return redirectWithClearedState(request, "failed");
  }
}

function redirectWithClearedState(
  request: NextRequest,
  status: string
): NextResponse {
  const destination = new URL("/", request.url);
  destination.searchParams.set("notion", status);
  const response = NextResponse.redirect(destination);
  response.cookies.set(NOTION_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    expires: new Date(0),
    path: "/"
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
