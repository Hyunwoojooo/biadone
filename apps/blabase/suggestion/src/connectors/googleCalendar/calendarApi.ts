import { z } from "zod";

import type { GoogleCalendarConfig } from "./config";
import {
  googleCalendarConnectionScopeId,
  googleCalendarStoreGeneration,
  readStoredTokens,
  writeStoredSnapshot,
  writeStoredTokens
} from "./localStore";
import {
  GoogleCalendarOAuthError,
  refreshAccessToken
} from "./oauth";
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

export const MAX_GOOGLE_CALENDAR_EVENTS = 250;
export const MAX_GOOGLE_CALENDAR_PAGES = 10;

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
  const storeGeneration = googleCalendarStoreGeneration(cwd);
  const storedTokens = await readStoredTokens(cwd);
  if (!storedTokens) {
    throw new GoogleCalendarApiError("NOT_CONNECTED");
  }

  let tokens = storedTokens;
  if (shouldRefresh(tokens, now)) {
    tokens = await refreshTokensOrThrow(
      config,
      tokens,
      fetchImpl,
      cwd,
      storeGeneration
    );
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
    tokens = await refreshTokensOrThrow(
      config,
      tokens,
      fetchImpl,
      cwd,
      storeGeneration
    );
    response = await fetchEventsPage({
      accessToken: tokens.accessToken,
      timeMin,
      timeMax,
      fetchImpl
    });
  }

  if (!response.ok) {
    throw new GoogleCalendarApiError("EVENTS_REQUEST_FAILED");
  }

  const events: GoogleCalendarWorkSignal[] = [];
  const seenPageTokens = new Set<string>();
  let pageCount = 1;
  let truncated = false;
  let page = await parseEventsPage(response);
  truncated = appendCalendarEvents(events, page.items);

  while (
    page.nextPageToken &&
    events.length < MAX_GOOGLE_CALENDAR_EVENTS
  ) {
    const pageToken = page.nextPageToken;
    if (
      seenPageTokens.has(pageToken) ||
      pageCount >= MAX_GOOGLE_CALENDAR_PAGES
    ) {
      throw new GoogleCalendarApiError("EVENT_RESPONSE_INVALID");
    }
    seenPageTokens.add(pageToken);
    const nextResponse = await fetchEventsPage({
      accessToken: tokens.accessToken,
      timeMin,
      timeMax,
      pageToken,
      fetchImpl
    });
    if (!nextResponse.ok) {
      throw new GoogleCalendarApiError("EVENTS_REQUEST_FAILED");
    }
    pageCount += 1;
    page = await parseEventsPage(nextResponse);
    truncated =
      appendCalendarEvents(events, page.items) || truncated;
  }
  truncated = truncated || Boolean(page.nextPageToken);

  const snapshot: GoogleCalendarSnapshot = {
    schemaVersion: "google-calendar-snapshot-v1",
    connectionScopeId: googleCalendarConnectionScopeId(tokens),
    fetchedAt: now.toISOString(),
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    truncated,
    events: events.sort(compareCalendarEvents)
  };
  await writeStoredSnapshot(snapshot, cwd, storeGeneration);
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

async function refreshTokensOrThrow(
  config: GoogleCalendarConfig,
  tokens: StoredGoogleCalendarTokens,
  fetchImpl: typeof fetch,
  cwd: string,
  storeGeneration: number
): Promise<StoredGoogleCalendarTokens> {
  try {
    const refreshed = await refreshAccessToken(
      config,
      tokens,
      fetchImpl
    );
    await writeStoredTokens(refreshed, cwd, storeGeneration);
    return refreshed;
  } catch (error) {
    if (error instanceof GoogleCalendarOAuthError) {
      throw new GoogleCalendarApiError("REAUTHORIZATION_REQUIRED");
    }
    throw error;
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

function appendCalendarEvents(
  target: GoogleCalendarWorkSignal[],
  items: Array<z.infer<typeof googleEventSchema>>
): boolean {
  for (const item of items) {
    if (target.length >= MAX_GOOGLE_CALENDAR_EVENTS) return true;
    target.push(normalizeGoogleEvent(item));
  }
  return false;
}

function calendarStartTimestamp(value: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return Date.parse(`${value}T00:00:00+09:00`);
  }
  return Date.parse(value);
}
