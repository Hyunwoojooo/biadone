import { z } from "zod";

import type { GoogleCalendarConfig } from "./config";
import {
  readStoredTokens,
  writeStoredSnapshot,
  writeStoredTokens
} from "./localStore";
import { refreshAccessToken } from "./oauth";
import type {
  GoogleCalendarSnapshot,
  GoogleCalendarWorkSignal,
  StoredGoogleCalendarTokens
} from "./types";

const googleEventSchema = z.object({
  id: z.string(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  summary: z.string().optional(),
  start: z.object({
    date: z.string().optional(),
    dateTime: z.string().optional()
  }),
  end: z.object({
    date: z.string().optional(),
    dateTime: z.string().optional()
  }),
  updated: z.string().optional(),
  eventType: z.string().optional(),
  recurringEventId: z.string().optional()
});

const eventsResponseSchema = z.object({
  items: z.array(googleEventSchema).default([]),
  nextPageToken: z.string().optional()
});

export async function fetchAndStoreCalendarSnapshot(
  config: GoogleCalendarConfig,
  options: {
    now?: Date;
    fetchImpl?: typeof fetch;
    cwd?: string;
  } = {}
): Promise<GoogleCalendarSnapshot> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const cwd = options.cwd ?? process.cwd();
  const storedTokens = await readStoredTokens(cwd);
  if (!storedTokens) {
    throw new GoogleCalendarApiError("NOT_CONNECTED");
  }

  let tokens = storedTokens;
  if (shouldRefresh(tokens, now)) {
    tokens = await refreshAccessToken(config, tokens, fetchImpl);
    await writeStoredTokens(tokens, cwd);
  }

  const timeMin = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  let response = await fetchEventsPage({
    accessToken: tokens.accessToken,
    timeMin,
    timeMax,
    fetchImpl
  });

  if (response.status === 401) {
    try {
      tokens = await refreshAccessToken(config, tokens, fetchImpl);
      await writeStoredTokens(tokens, cwd);
      response = await fetchEventsPage({
        accessToken: tokens.accessToken,
        timeMin,
        timeMax,
        fetchImpl
      });
    } catch {
      throw new GoogleCalendarApiError("REAUTHORIZATION_REQUIRED");
    }
  }

  if (!response.ok) {
    throw new GoogleCalendarApiError("EVENTS_REQUEST_FAILED");
  }

  const events: GoogleCalendarWorkSignal[] = [];
  let page = await parseEventsPage(response);
  events.push(...page.items.map(normalizeGoogleEvent));

  while (page.nextPageToken) {
    const nextResponse = await fetchEventsPage({
      accessToken: tokens.accessToken,
      timeMin,
      timeMax,
      pageToken: page.nextPageToken,
      fetchImpl
    });
    if (!nextResponse.ok) {
      throw new GoogleCalendarApiError("EVENTS_REQUEST_FAILED");
    }
    page = await parseEventsPage(nextResponse);
    events.push(...page.items.map(normalizeGoogleEvent));
  }

  const snapshot: GoogleCalendarSnapshot = {
    schemaVersion: "google-calendar-snapshot-v1",
    fetchedAt: now.toISOString(),
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    events: events.sort(compareCalendarEvents)
  };
  await writeStoredSnapshot(snapshot, cwd);
  return snapshot;
}

export function normalizeGoogleEvent(
  event: z.infer<typeof googleEventSchema>
): GoogleCalendarWorkSignal {
  const allDay = Boolean(event.start.date);
  const startAt = event.start.dateTime ?? event.start.date;
  const endAt = event.end.dateTime ?? event.end.date;
  if (!startAt || !endAt) {
    throw new GoogleCalendarApiError("EVENT_RESPONSE_INVALID");
  }

  return {
    id: event.id,
    source: "google_calendar",
    kind: "calendar_event",
    title: event.summary?.trim() || "제목 없는 일정",
    status: event.status,
    startAt,
    endAt,
    allDay,
    recurringEventId: event.recurringEventId ?? null,
    eventType: event.eventType ?? "default",
    updatedAt: event.updated ?? ""
  };
}

export function compareCalendarEvents(
  left: GoogleCalendarWorkSignal,
  right: GoogleCalendarWorkSignal
): number {
  return (
    calendarStartTimestamp(left.startAt) -
      calendarStartTimestamp(right.startAt) || left.id.localeCompare(right.id)
  );
}

export class GoogleCalendarApiError extends Error {
  constructor(
    readonly code:
      | "NOT_CONNECTED"
      | "REAUTHORIZATION_REQUIRED"
      | "EVENTS_REQUEST_FAILED"
      | "EVENT_RESPONSE_INVALID"
  ) {
    super(code);
    this.name = "GoogleCalendarApiError";
  }
}

async function fetchEventsPage({
  accessToken,
  timeMin,
  timeMax,
  pageToken,
  fetchImpl
}: {
  accessToken: string;
  timeMin: Date;
  timeMax: Date;
  pageToken?: string;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  );
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeZone", "Asia/Seoul");
  url.searchParams.set("maxResults", "250");
  url.searchParams.set(
    "fields",
    "items(id,status,summary,start,end,updated,eventType,recurringEventId),nextPageToken"
  );
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  return fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
}

async function parseEventsPage(
  response: Response
): Promise<z.infer<typeof eventsResponseSchema>> {
  try {
    return eventsResponseSchema.parse(await response.json());
  } catch {
    throw new GoogleCalendarApiError("EVENT_RESPONSE_INVALID");
  }
}

function shouldRefresh(
  tokens: StoredGoogleCalendarTokens,
  now: Date
): boolean {
  return new Date(tokens.expiresAt).getTime() <= now.getTime() + 60_000;
}

function calendarStartTimestamp(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}T00:00:00+09:00`);
  }
  return Date.parse(value);
}
