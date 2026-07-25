import { NextResponse } from "next/server";

import {
  fetchAndStoreCalendarSnapshot,
  GoogleCalendarApiError
} from "../../../../../src/connectors/googleCalendar/calendarApi";
import {
  isLocalCalendarRequest,
  loadGoogleCalendarConfig
} from "../../../../../src/connectors/googleCalendar/config";
import {
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

  try {
    const now = new Date();
    const snapshot = await fetchAndStoreCalendarSnapshot(
      configResult.config,
      { now }
    );
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
  } catch (error) {
    if (
      error instanceof GoogleCalendarApiError &&
      error.code === "REAUTHORIZATION_REQUIRED"
    ) {
      return noStoreJson({
        status: "reauthorization_required",
        message: "Google Calendar 연결이 만료되었습니다. 다시 연결해주세요."
      });
    }

    const previousSnapshot = await readStoredSnapshot();
    return noStoreJson({
      status: "sync_error",
      message: "최근 일정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      lastSyncedAt: previousSnapshot?.fetchedAt ?? null
    });
  }
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
