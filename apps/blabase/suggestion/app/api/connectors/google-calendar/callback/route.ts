import { NextRequest, NextResponse } from "next/server";

import {
  sourceConnectionReturnUrl,
  type SourceConnectionReturnStatus
} from "../../../../sourceNavigation";
import {
  isLocalCalendarRequest,
  loadGoogleCalendarConfig
} from "../../../../../src/connectors/googleCalendar/config";
import {
  replaceStoredGoogleCalendarConnection
} from "../../../../../src/connectors/googleCalendar/localStore";
import {
  exchangeAuthorizationCode,
  GOOGLE_CALENDAR_STATE_COOKIE,
  oauthStatesMatch
} from "../../../../../src/connectors/googleCalendar/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";
import {
  supersedeRuntimeSourceConnection,
  syncRuntimeSources
} from "../../../../../src/sync/runtime";

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
    const tokens = await exchangeAuthorizationCode(
      configResult.config,
      code
    );
    await supersedeRuntimeSourceConnection("google_calendar");
    await replaceStoredGoogleCalendarConnection(tokens);

    let syncFailed = false;
    try {
      const sync = await syncRuntimeSources({
        sources: ["google_calendar"]
      });
      const source = sync.sources.find(
        (candidate) => candidate.source === "google_calendar"
      );
      syncFailed =
        source?.status !== "idle" ||
        source.lastErrorCode !== null ||
        source.lastSuccessAt === null;
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
  status: SourceConnectionReturnStatus<"google-calendar">
): NextResponse {
  const destination = sourceConnectionReturnUrl(
    request.url,
    "google-calendar",
    status
  );
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
