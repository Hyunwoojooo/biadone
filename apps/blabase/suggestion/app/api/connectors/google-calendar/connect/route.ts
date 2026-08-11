import { NextResponse } from "next/server";

import { sourceConnectionReturnUrl } from "../../../../sourceNavigation";
import {
  isLocalCalendarRequest,
  loadGoogleCalendarConfig
} from "../../../../../src/connectors/googleCalendar/config";
import {
  createGoogleAuthorizationUrl,
  createOAuthState,
  GOOGLE_CALENDAR_STATE_COOKIE
} from "../../../../../src/connectors/googleCalendar/oauth";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalCalendarRequest(request)) {
    return NextResponse.redirect(
      sourceConnectionReturnUrl(
        request.url,
        "google-calendar",
        "local_only"
      )
    );
  }

  loadSharedLocalEnv();
  const configResult = loadGoogleCalendarConfig();
  if (!configResult.ok) {
    return NextResponse.redirect(
      sourceConnectionReturnUrl(
        request.url,
        "google-calendar",
        "temporarily_unavailable"
      )
    );
  }

  const state = createOAuthState();
  const response = NextResponse.redirect(
    createGoogleAuthorizationUrl(configResult.config, state)
  );
  response.cookies.set(GOOGLE_CALENDAR_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 10 * 60,
    path: "/"
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
