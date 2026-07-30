import { NextResponse } from "next/server";

import { hasSameAttentionOrigin } from "../../../../../src/attention/access";
import { isLocalCalendarRequest } from "../../../../../src/connectors/googleCalendar/config";
import {
  deleteStoredGoogleCalendarConnection,
  readStoredTokens
} from "../../../../../src/connectors/googleCalendar/localStore";
import { revokeGoogleToken } from "../../../../../src/connectors/googleCalendar/oauth";
import { noteRuntimeSourceDisconnected } from "../../../../../src/sync/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOTE_REVOCATION_TIMEOUT_MS = 2_000;

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
  if (!hasSameAttentionOrigin(request)) {
    return NextResponse.json(
      { error: "INVALID_ORIGIN" },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  const tokens = await readStoredTokens();
  await deleteStoredGoogleCalendarConnection();
  try {
    await noteRuntimeSourceDisconnected("google_calendar");
  } catch {
    // Local deletion is authoritative even if sync metadata is degraded.
  }

  if (tokens) {
    try {
      await withTimeout(
        revokeGoogleToken(tokens.refreshToken),
        REMOTE_REVOCATION_TIMEOUT_MS
      );
    } catch {
      // Local deletion still takes precedence if Google is temporarily
      // unreachable. The user can also revoke access in their Google account.
    }
  }

  return NextResponse.json(
    { status: "disconnected" },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("REMOTE_REVOCATION_TIMEOUT")),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
