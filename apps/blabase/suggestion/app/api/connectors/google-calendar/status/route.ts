import { NextResponse } from "next/server";

import {
  isLocalCalendarRequest,
  loadGoogleCalendarConfig
} from "../../../../../src/connectors/googleCalendar/config";
import {
  googleCalendarSnapshotMatchesTokens,
  readStoredSnapshot,
  readStoredTokens
} from "../../../../../src/connectors/googleCalendar/localStore";
import type {
  CalendarConnectionState,
  GoogleCalendarWorkSignal
} from "../../../../../src/connectors/googleCalendar/types";
import { loadSharedLocalEnv } from "../../../../../src/localEnv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalCalendarRequest(request)) {
    return noStoreJson({
      status: "unavailable",
      message: "Google Calendar 연결은 http://localhost:3102에서 확인해주세요."
    });
  }

  loadSharedLocalEnv();
  const configResult = loadGoogleCalendarConfig();
  if (!configResult.ok) {
    // App-level OAuth configuration is an operator concern. The end-user
    // surface should remain the same one-click connection flow.
    return noStoreJson({ status: "disconnected" });
  }

  const tokens = await readStoredTokens();
  if (!tokens) {
    return noStoreJson({ status: "disconnected" });
  }

  const snapshot = await readStoredSnapshot();
  if (!snapshot || !googleCalendarSnapshotMatchesTokens(snapshot, tokens)) {
    return noStoreJson({
      status: "sync_error",
      message:
        "Google Calendar 저장본이 아직 없습니다. 동기화를 잠시 기다리거나 다시 시도해주세요.",
      lastSyncedAt: null
    });
  }
  const now = new Date();
  const upcoming = snapshot.events.filter((event) =>
    isUpcomingEvent(event, now)
  );
  return noStoreJson({
    status: "connected",
    lastSyncedAt: snapshot.fetchedAt,
    eventCount: snapshot.events.length,
    upcomingEventCount: upcoming.length,
    events: upcoming.slice(0, 3).map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay
    }))
  });
}

function isUpcomingEvent(
  event: GoogleCalendarWorkSignal,
  now: Date
): boolean {
  if (event.status === "cancelled") return false;
  const end = event.allDay
    ? Date.parse(`${event.endAt}T00:00:00+09:00`)
    : Date.parse(event.endAt);
  return Number.isFinite(end) && end > now.getTime();
}

function noStoreJson(body: CalendarConnectionState) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" }
  });
}
