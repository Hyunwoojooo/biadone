import { NextRequest } from "next/server";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

vi.mock(
  "../src/connectors/googleCalendar/config",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/connectors/googleCalendar/config")
      >();
    return {
      ...actual,
      loadGoogleCalendarConfig: vi.fn()
    };
  }
);

vi.mock(
  "../src/connectors/googleCalendar/localStore",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/connectors/googleCalendar/localStore")
      >();
    return {
      ...actual,
      replaceStoredGoogleCalendarConnection: vi.fn(
        async () => undefined
      )
    };
  }
);

vi.mock(
  "../src/connectors/googleCalendar/oauth",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/connectors/googleCalendar/oauth")
      >();
    return {
      ...actual,
      exchangeAuthorizationCode: vi.fn()
    };
  }
);

vi.mock(
  "../src/connectors/notion/config",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/connectors/notion/config")
      >();
    return {
      ...actual,
      loadNotionConfig: vi.fn()
    };
  }
);

vi.mock(
  "../src/connectors/notion/localStore",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/connectors/notion/localStore")
      >();
    return {
      ...actual,
      replaceStoredNotionConnection: vi.fn(async () => undefined)
    };
  }
);

vi.mock("../src/connectors/notion/oauth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/notion/oauth")
    >();
  return {
    ...actual,
    exchangeNotionAuthorizationCode: vi.fn()
  };
});

vi.mock("../src/localEnv", () => ({
  loadSharedLocalEnv: vi.fn()
}));

vi.mock("../src/sync/runtime", () => ({
  supersedeRuntimeSourceConnection: vi.fn(async () => undefined),
  syncRuntimeSources: vi.fn()
}));

import { GET as calendarCallback } from "../app/api/connectors/google-calendar/callback/route";
import { GET as notionCallback } from "../app/api/connectors/notion/callback/route";
import {
  GOOGLE_CALENDAR_STATE_COOKIE,
  exchangeAuthorizationCode
} from "../src/connectors/googleCalendar/oauth";
import { loadGoogleCalendarConfig } from "../src/connectors/googleCalendar/config";
import { replaceStoredGoogleCalendarConnection } from "../src/connectors/googleCalendar/localStore";
import type { StoredGoogleCalendarTokens } from "../src/connectors/googleCalendar/types";
import { loadNotionConfig } from "../src/connectors/notion/config";
import { replaceStoredNotionConnection } from "../src/connectors/notion/localStore";
import {
  exchangeNotionAuthorizationCode,
  NOTION_STATE_COOKIE
} from "../src/connectors/notion/oauth";
import type { StoredNotionTokens } from "../src/connectors/notion/types";
import {
  supersedeRuntimeSourceConnection,
  syncRuntimeSources
} from "../src/sync/runtime";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.mocked(loadGoogleCalendarConfig).mockReturnValue({
    ok: true,
    config: {
      clientId: "calendar-client",
      clientSecret: "calendar-secret",
      authorizationEndpoint:
        "https://accounts.google.com/o/oauth2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      redirectUri:
        "http://localhost:3102/api/connectors/google-calendar/callback",
      credentialsPath: "/private/credentials.json"
    }
  });
  vi.mocked(loadNotionConfig).mockReturnValue({
    ok: true,
    config: {
      clientId: "notion-client",
      clientSecret: "notion-secret",
      authorizationEndpoint:
        "https://api.notion.com/v1/oauth/authorize",
      tokenEndpoint: "https://api.notion.com/v1/oauth/token",
      revokeEndpoint: "https://api.notion.com/v1/oauth/revoke",
      redirectUri:
        "http://localhost:3102/api/connectors/notion/callback",
      apiVersion: "2026-03-11"
    }
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("OAuth callback source synchronization", () => {
  it("stores Calendar tokens and collects through SourceSyncCoordinator", async () => {
    const tokens = calendarTokens();
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue(tokens);
    vi.mocked(syncRuntimeSources).mockResolvedValue(
      syncResponse("google_calendar")
    );

    const response = await calendarCallback(
      callbackRequest(
        "/api/connectors/google-calendar/callback",
        GOOGLE_CALENDAR_STATE_COOKIE
      )
    );

    expect(replaceStoredGoogleCalendarConnection).toHaveBeenCalledWith(
      tokens
    );
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      expect.any(Object),
      "oauth-code"
    );
    expect(syncRuntimeSources).toHaveBeenCalledWith({
      sources: ["google_calendar"]
    });
    expect(supersedeRuntimeSourceConnection).toHaveBeenCalledWith(
      "google_calendar"
    );
    expect(
      vi.mocked(supersedeRuntimeSourceConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(replaceStoredGoogleCalendarConnection).mock
        .invocationCallOrder[0]!
    );
    expect(
      vi.mocked(replaceStoredGoogleCalendarConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(syncRuntimeSources).mock.invocationCallOrder[0]!
    );
    expect(
      new URL(requiredHeader(response, "location")).searchParams.get(
        "calendar"
      )
    ).toBe("connected");
  });

  it("stores Notion tokens and collects through SourceSyncCoordinator", async () => {
    const tokens = notionTokens();
    vi.mocked(exchangeNotionAuthorizationCode).mockResolvedValue(tokens);
    vi.mocked(syncRuntimeSources).mockResolvedValue(
      syncResponse("notion")
    );

    const response = await notionCallback(
      callbackRequest(
        "/api/connectors/notion/callback",
        NOTION_STATE_COOKIE
      )
    );

    expect(replaceStoredNotionConnection).toHaveBeenCalledWith(tokens);
    expect(syncRuntimeSources).toHaveBeenCalledWith({
      sources: ["notion"]
    });
    expect(supersedeRuntimeSourceConnection).toHaveBeenCalledWith(
      "notion"
    );
    expect(
      vi.mocked(supersedeRuntimeSourceConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(replaceStoredNotionConnection).mock
        .invocationCallOrder[0]!
    );
    expect(
      vi.mocked(replaceStoredNotionConnection).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(syncRuntimeSources).mock.invocationCallOrder[0]!
    );
    expect(
      new URL(requiredHeader(response, "location")).searchParams.get(
        "notion"
      )
    ).toBe("connected");
  });

  it("keeps the Notion connection but marks initial sync pending when the coordinator records failure", async () => {
    vi.mocked(exchangeNotionAuthorizationCode).mockResolvedValue(
      notionTokens()
    );
    vi.mocked(syncRuntimeSources).mockResolvedValue(
      syncResponse("notion", {
        status: "backoff",
        lastSuccessAt: null,
        lastFailureAt: "2026-07-25T10:00:01.000Z",
        nextRetryAt: "2026-07-25T10:00:06.000Z",
        retryCount: 1,
        lastErrorCode: "NOTION_API_UNAVAILABLE",
        snapshotRevision: null
      })
    );

    const response = await notionCallback(
      callbackRequest(
        "/api/connectors/notion/callback",
        NOTION_STATE_COOKIE
      )
    );

    expect(
      new URL(requiredHeader(response, "location")).searchParams.get(
        "notion"
      )
    ).toBe("connected_sync_pending");
  });

  it("does not expose replacement credentials when the durable lineage reset fails", async () => {
    vi.mocked(exchangeNotionAuthorizationCode).mockResolvedValue(
      notionTokens()
    );
    vi.mocked(supersedeRuntimeSourceConnection).mockRejectedValue(
      new Error("STORE_WRITE_FAILED")
    );

    const response = await notionCallback(
      callbackRequest(
        "/api/connectors/notion/callback",
        NOTION_STATE_COOKIE
      )
    );

    expect(replaceStoredNotionConnection).not.toHaveBeenCalled();
    expect(syncRuntimeSources).not.toHaveBeenCalled();
    expect(
      new URL(requiredHeader(response, "location")).searchParams.get(
        "notion"
      )
    ).toBe("failed");
  });
});

function callbackRequest(
  pathname: string,
  cookieName: string
): NextRequest {
  const url = new URL(`http://localhost:3102${pathname}`);
  url.searchParams.set("state", "expected-state");
  url.searchParams.set("code", "oauth-code");
  return new NextRequest(url, {
    headers: {
      cookie: `${cookieName}=expected-state`
    }
  });
}

function calendarTokens(): StoredGoogleCalendarTokens {
  return {
    accessToken: "calendar-access",
    refreshToken: "calendar-refresh",
    expiresAt: "2026-07-25T11:00:00.000Z",
    scope:
      "https://www.googleapis.com/auth/calendar.events.owned.readonly",
    tokenType: "Bearer"
  };
}

function notionTokens(): StoredNotionTokens {
  return {
    accessToken: "notion-access",
    refreshToken: "notion-refresh",
    tokenType: "bearer",
    botId: "bot-id",
    workspaceId: "workspace-id",
    workspaceName: "Blabase"
  };
}

function syncResponse(
  source: "google_calendar" | "notion",
  overrides: Partial<{
    status: "idle" | "syncing" | "backoff" | "disconnected" | "error";
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    nextRetryAt: string | null;
    retryCount: number;
    lastErrorCode: string | null;
    snapshotRevision: string | null;
    snapshotHash: string | null;
  }> = {}
) {
  return {
    status: "ready" as const,
    revision: "pipeline:test",
    generatedAt: "2026-07-25T10:00:01.000Z",
    adapterMode: "coordinator" as const,
    sources: [
      {
        source,
        status: "idle" as const,
        lastAttemptAt: "2026-07-25T10:00:00.000Z",
        lastSuccessAt: "2026-07-25T10:00:01.000Z",
        lastFailureAt: null,
        nextRetryAt: null,
        retryCount: 0,
        lastErrorCode: null,
        snapshotRevision: `${source}:2026-07-25T10:00:00.000Z`,
        snapshotHash: "a".repeat(64),
        ...overrides
      }
    ]
  };
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`missing ${name} header`);
  return value;
}
