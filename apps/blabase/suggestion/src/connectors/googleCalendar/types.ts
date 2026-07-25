export type GoogleCalendarEventStatus =
  | "confirmed"
  | "tentative"
  | "cancelled";

export type GoogleCalendarWorkSignal = {
  id: string;
  source: "google_calendar";
  kind: "calendar_event";
  title: string;
  status: GoogleCalendarEventStatus;
  startAt: string;
  endAt: string;
  allDay: boolean;
  recurringEventId: string | null;
  eventType: string;
  updatedAt: string;
};

export type GoogleCalendarSnapshot = {
  schemaVersion: "google-calendar-snapshot-v1";
  fetchedAt: string;
  timeMin: string;
  timeMax: string;
  events: GoogleCalendarWorkSignal[];
};

export type StoredGoogleCalendarTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
  tokenType: string;
};

export type CalendarPreviewEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
};

export type CalendarConnectionState =
  | {
      status: "unavailable";
      message: string;
    }
  | {
      status: "disconnected";
    }
  | {
      status: "connected";
      lastSyncedAt: string;
      eventCount: number;
      upcomingEventCount: number;
      events: CalendarPreviewEvent[];
    }
  | {
      status: "reauthorization_required";
      message: string;
    }
  | {
      status: "sync_error";
      message: string;
      lastSyncedAt: string | null;
    };
