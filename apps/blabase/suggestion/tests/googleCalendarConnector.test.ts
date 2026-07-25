import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAndStoreCalendarSnapshot,
  normalizeGoogleEvent
} from "../src/connectors/googleCalendar/calendarApi";
import {
  DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI,
  GOOGLE_CALENDAR_SCOPE,
  loadGoogleCalendarConfig,
  type GoogleCalendarConfig
} from "../src/connectors/googleCalendar/config";
import {
  readStoredTokens,
  writeStoredTokens
} from "../src/connectors/googleCalendar/localStore";
import {
  createGoogleAuthorizationUrl,
  createOAuthState,
  oauthStatesMatch
} from "../src/connectors/googleCalendar/oauth";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
  vi.restoreAllMocks();
});

describe("Google Calendar local connector", () => {
  it("loads a Web OAuth credential only when the localhost callback matches", async () => {
    const cwd = await createTempDirectory();
    const credentialsPath = join(
      cwd,
      ".local",
      "connectors",
      "google-calendar",
      "credentials.json"
    );
    await mkdir(join(credentialsPath, ".."), { recursive: true });
    await writeFile(
      credentialsPath,
      JSON.stringify({
        web: {
          client_id: "calendar-client",
          client_secret: "calendar-secret",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          redirect_uris: [DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI]
        }
      })
    );

    const result = loadGoogleCalendarConfig(
      { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      cwd
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.clientId).toBe("calendar-client");
      expect(result.config.redirectUri).toBe(
        DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI
      );
    }
  });

  it("rejects a credential that does not list the exact localhost callback", async () => {
    const cwd = await createTempDirectory();
    const credentialsPath = join(
      cwd,
      ".local",
      "connectors",
      "google-calendar",
      "credentials.json"
    );
    await mkdir(join(credentialsPath, ".."), { recursive: true });
    await writeFile(
      credentialsPath,
      JSON.stringify({
        web: {
          client_id: "calendar-client",
          client_secret: "calendar-secret",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          redirect_uris: [
            "http://127.0.0.1:3102/api/connectors/google-calendar/callback"
          ]
        }
      })
    );

    expect(
      loadGoogleCalendarConfig(
        { NODE_ENV: "test" } as NodeJS.ProcessEnv,
        cwd
      )
    ).toMatchObject({
      ok: false,
      reason: "redirect_uri_missing"
    });
  });

  it("creates an offline, read-only authorization request with state", () => {
    const config = testConfig();
    const state = createOAuthState();
    const authorizationUrl = new URL(
      createGoogleAuthorizationUrl(config, state)
    );

    expect(authorizationUrl.searchParams.get("scope")).toBe(
      GOOGLE_CALENDAR_SCOPE
    );
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("state")).toBe(state);
    expect(oauthStatesMatch(state, state)).toBe(true);
    expect(oauthStatesMatch(state, `${state}x`)).toBe(false);
  });

  it("stores tokens and a minimal normalized Calendar snapshot locally", async () => {
    const cwd = await createTempDirectory();
    await writeStoredTokens(
      {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: "2026-07-26T00:00:00.000Z",
        scope: GOOGLE_CALENDAR_SCOPE,
        tokenType: "Bearer"
      },
      cwd
    );

    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(
        input instanceof URL
          ? input.toString()
          : typeof input === "string"
            ? input
            : input.url
      );
      expect(url.searchParams.get("singleEvents")).toBe("true");
      expect(url.searchParams.get("orderBy")).toBe("startTime");
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "event-1",
              status: "confirmed",
              summary: "제품 데모",
              start: { dateTime: "2026-07-25T15:00:00+09:00" },
              end: { dateTime: "2026-07-25T16:00:00+09:00" },
              updated: "2026-07-24T05:00:00.000Z",
              eventType: "default"
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }) as unknown as typeof fetch;

    const snapshot = await fetchAndStoreCalendarSnapshot(testConfig(), {
      now: new Date("2026-07-25T00:00:00.000Z"),
      fetchImpl,
      cwd
    });

    expect(snapshot.events).toEqual([
      expect.objectContaining({
        id: "event-1",
        title: "제품 데모",
        source: "google_calendar",
        kind: "calendar_event",
        allDay: false
      })
    ]);
    expect(await readStoredTokens(cwd)).toMatchObject({
      refreshToken: "refresh-token"
    });

    const storedSnapshot = JSON.parse(
      await readFile(
        join(
          cwd,
          ".local",
          "connectors",
          "google-calendar",
          "snapshot.json"
        ),
        "utf8"
      )
    );
    expect(storedSnapshot.events[0]).not.toHaveProperty("description");
    expect(storedSnapshot.events[0]).not.toHaveProperty("attendees");
  });

  it("preserves all-day dates and ignores private fields", () => {
    expect(
      normalizeGoogleEvent({
        id: "all-day",
        status: "confirmed",
        summary: "워크숍",
        start: { date: "2026-07-26" },
        end: { date: "2026-07-27" },
        updated: "2026-07-20T00:00:00.000Z",
        eventType: "default"
      })
    ).toMatchObject({
      startAt: "2026-07-26",
      endAt: "2026-07-27",
      allDay: true,
      title: "워크숍"
    });
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "blabase-calendar-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function testConfig(): GoogleCalendarConfig {
  return {
    clientId: "calendar-client",
    clientSecret: "calendar-secret",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    redirectUri: DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI,
    credentialsPath: "/private/credentials.json"
  };
}
