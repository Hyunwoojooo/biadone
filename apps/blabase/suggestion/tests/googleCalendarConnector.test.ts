import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAndStoreCalendarSnapshot,
  GoogleCalendarApiError,
  MAX_GOOGLE_CALENDAR_EVENTS,
  normalizeGoogleEvent
} from "../src/connectors/googleCalendar/calendarApi";
import {
  DEFAULT_GOOGLE_CALENDAR_REDIRECT_URI,
  GOOGLE_CALENDAR_SCOPE,
  loadGoogleCalendarConfig,
  type GoogleCalendarConfig
} from "../src/connectors/googleCalendar/config";
import {
  deleteStoredGoogleCalendarConnection,
  googleCalendarStoreGeneration,
  readStoredSnapshot,
  readStoredTokens,
  replaceStoredGoogleCalendarConnection,
  writeStoredSnapshot,
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

  it("bounds collection and preserves pagination truncation", async () => {
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
    let requestCount = 0;
    const fetchImpl = vi.fn(async () => {
      requestCount += 1;
      const count =
        requestCount === 1 ? MAX_GOOGLE_CALENDAR_EVENTS : 1;
      return new Response(
        JSON.stringify({
          items: Array.from({ length: count }, (_, index) =>
            calendarEvent(`${requestCount}-${index}`)
          ),
          nextPageToken: "there-is-more"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }) as unknown as typeof fetch;

    const snapshot = await fetchAndStoreCalendarSnapshot(
      testConfig(),
      {
        now: new Date("2026-07-25T00:00:00.000Z"),
        fetchImpl,
        cwd
      }
    );

    expect(requestCount).toBe(1);
    expect(snapshot.events).toHaveLength(
      MAX_GOOGLE_CALENDAR_EVENTS
    );
    expect(snapshot.truncated).toBe(true);
  });

  it("rejects a repeated page token instead of looping forever", async () => {
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
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [],
          nextPageToken: "repeated"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    ) as unknown as typeof fetch;

    await expect(
      fetchAndStoreCalendarSnapshot(testConfig(), {
        now: new Date("2026-07-25T00:00:00.000Z"),
        fetchImpl,
        cwd
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<GoogleCalendarApiError>>({
        code: "EVENT_RESPONSE_INVALID"
      })
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not recreate connector state when disconnect wins an in-flight sync", async () => {
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

    let releaseResponse!: () => void;
    let markRequestStarted!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      markRequestStarted();
      await responseGate;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    const refresh = fetchAndStoreCalendarSnapshot(testConfig(), {
      now: new Date("2026-07-25T00:00:00.000Z"),
      fetchImpl,
      cwd
    });
    await requestStarted;

    await deleteStoredGoogleCalendarConnection(cwd);
    releaseResponse();

    await expect(refresh).rejects.toThrow(
      "Google Calendar connector state changed during operation."
    );
    await expect(readStoredTokens(cwd)).resolves.toBeNull();
    await expect(readStoredSnapshot(cwd)).resolves.toBeNull();
  });

  it("clears the old account snapshot and rejects its in-flight generation on OAuth replacement", async () => {
    const cwd = await createTempDirectory();
    const oldTokens = calendarTokens();
    await writeStoredTokens(oldTokens, cwd);
    await writeStoredSnapshot(calendarSnapshot(), cwd);
    const previousGeneration = googleCalendarStoreGeneration(cwd);
    const replacementTokens = {
      ...oldTokens,
      accessToken: "replacement-access-token",
      refreshToken: "replacement-refresh-token"
    };

    await replaceStoredGoogleCalendarConnection(
      replacementTokens,
      cwd
    );

    expect(googleCalendarStoreGeneration(cwd)).toBe(
      previousGeneration + 1
    );
    const storedReplacement = await readStoredTokens(cwd);
    expect(storedReplacement).toMatchObject(replacementTokens);
    expect(storedReplacement?.connectionScopeId).toMatch(
      /^calendar_scope_[a-f0-9]{32}$/
    );
    await expect(readStoredSnapshot(cwd)).resolves.toBeNull();
    await expect(
      writeStoredSnapshot(
        {
          ...calendarSnapshot(),
          fetchedAt: "2026-07-25T02:00:00.000Z"
        },
        cwd,
        previousGeneration
      )
    ).rejects.toThrow(
      "Google Calendar connector state changed during operation."
    );

    const firstScopeId = storedReplacement?.connectionScopeId;
    await replaceStoredGoogleCalendarConnection(
      {
        ...replacementTokens,
        accessToken: "another-account-access"
      },
      cwd
    );
    const secondScopeId = (await readStoredTokens(cwd))
      ?.connectionScopeId;
    expect(secondScopeId).toMatch(
      /^calendar_scope_[a-f0-9]{32}$/
    );
    expect(secondScopeId).not.toBe(firstScopeId);
  });

  it("surfaces an expired or revoked refresh credential as reauthorization required", async () => {
    const cwd = await createTempDirectory();
    await writeStoredTokens(
      {
        ...calendarTokens(),
        expiresAt: "2026-07-24T00:00:00.000Z"
      },
      cwd
    );
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;

    await expect(
      fetchAndStoreCalendarSnapshot(testConfig(), {
        now: new Date("2026-07-25T00:00:00.000Z"),
        fetchImpl,
        cwd
      })
    ).rejects.toThrow("REAUTHORIZATION_REQUIRED");
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

function calendarEvent(id: string) {
  return {
    id,
    status: "confirmed",
    summary: `Event ${id}`,
    start: { dateTime: "2026-07-25T15:00:00+09:00" },
    end: { dateTime: "2026-07-25T16:00:00+09:00" },
    updated: "2026-07-24T05:00:00.000Z",
    eventType: "default"
  };
}

function calendarTokens() {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: "2026-07-26T00:00:00.000Z",
    scope: GOOGLE_CALENDAR_SCOPE,
    tokenType: "Bearer"
  };
}

function calendarSnapshot() {
  return {
    schemaVersion: "google-calendar-snapshot-v1" as const,
    fetchedAt: "2026-07-25T01:00:00.000Z",
    timeMin: "2026-07-18T01:00:00.000Z",
    timeMax: "2026-08-08T01:00:00.000Z",
    events: []
  };
}
