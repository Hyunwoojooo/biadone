import { NextResponse } from "next/server";

import { isLocalCalendarRequest } from "../../../../../src/connectors/googleCalendar/config";
import {
  deleteStoredSnapshot,
  deleteStoredTokens,
  readStoredTokens
} from "../../../../../src/connectors/googleCalendar/localStore";
import { revokeGoogleToken } from "../../../../../src/connectors/googleCalendar/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalCalendarRequest(request)) {
    return NextResponse.json(
      { error: "LOCAL_ONLY" },
      {
        status: 404,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  const tokens = await readStoredTokens();
  if (tokens) {
    try {
      await revokeGoogleToken(tokens.refreshToken);
    } catch {
      // Local deletion still takes precedence if Google is temporarily
      // unreachable. The user can also revoke access in their Google account.
    }
  }

  await Promise.all([deleteStoredTokens(), deleteStoredSnapshot()]);
  return NextResponse.json(
    { status: "disconnected" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
