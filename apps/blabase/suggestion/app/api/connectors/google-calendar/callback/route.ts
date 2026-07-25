import { NextRequest, NextResponse } from "next/server";

import { fetchAndStoreCalendarSnapshot } from "../../../../../src/connectors/googleCalendar/calendarApi";
import {
  isLocalCalendarRequest,
  loadGoogleCalendarConfig
} from "../../../../../src/connectors/googleCalendar/config";
import {
  readStoredTokens,
  writeStoredTokens
} from "../../../../../src/connectors/googleCalendar/localStore";
import {
  exchangeAuthorizationCode,
  GOOGLE_CALENDAR_STATE_COOKIE,
  oauthStatesMatch
} from "../../../../../src/connectors/googleCalendar/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalCalendarRequest(request)) {
    return redirectWithClearedState(request, "local_only");
  }

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return redirectWithClearedState(
      request,
      error === "access_denied" ? "cancelled" : "failed"
    );
  }

  const expectedState = request.cookies.get(
    GOOGLE_CALENDAR_STATE_COOKIE
  )?.value;
  const actualState = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !oauthStatesMatch(expectedState, actualState)) {
    return redirectWithClearedState(request, "failed");
  }

  loadSharedLocalEnv();
  const configResult = loadGoogleCalendarConfig();
  if (!configResult.ok) {
    return redirectWithClearedState(request, "temporarily_unavailable");
  }

  try {
    const previousTokens = await readStoredTokens();
    const tokens = await exchangeAuthorizationCode(
      configResult.config,
      code,
      previousTokens
    );
    await writeStoredTokens(tokens);

    let syncFailed = false;
    try {
      await fetchAndStoreCalendarSnapshot(configResult.config);
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
  destination.searchParams.set("calendar", status);
  const response = NextResponse.redirect(destination);
  response.cookies.set(GOOGLE_CALENDAR_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    expires: new Date(0),
    path: "/"
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
