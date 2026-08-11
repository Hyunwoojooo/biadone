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
  /**
   * Random, non-secret identity assigned to one local OAuth connection.
   * Missing only on snapshots created before per-connection identities.
   */
  connectionScopeId?: string;
  fetchedAt: string;
  timeMin: string;
  timeMax: string;
  /**
   * Optional for snapshots written before collection-level pagination
   * bounds were introduced.
   */
  truncated?: boolean;
  events: GoogleCalendarWorkSignal[];
};

export type StoredGoogleCalendarTokens = {
  /**
   * Random, non-secret identity assigned on OAuth replacement. It is safe to
   * expose as an opaque project-mapping key, unlike either OAuth token.
   */
  connectionScopeId?: string;
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
      localUrl?: string;
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
