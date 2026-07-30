import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/attention/access", () => ({
  hasSameAttentionOrigin: vi.fn(() => true)
}));

vi.mock("../src/connectors/googleCalendar/config", () => ({
  isLocalCalendarRequest: vi.fn(() => true)
}));

vi.mock("../src/connectors/googleCalendar/localStore", () => ({
  deleteStoredGoogleCalendarConnection: vi.fn(async () => undefined),
  readStoredTokens: vi.fn()
}));

vi.mock("../src/connectors/googleCalendar/oauth", () => ({
  revokeGoogleToken: vi.fn()
}));

vi.mock("../src/connectors/notion/config", () => ({
  isLocalNotionRequest: vi.fn(() => true),
  loadNotionConfig: vi.fn(() => ({
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
  }))
}));

vi.mock("../src/connectors/notion/localStore", () => ({
  deleteStoredNotionConnection: vi.fn(async () => undefined),
  readStoredNotionTokens: vi.fn()
}));

vi.mock("../src/connectors/notion/oauth", () => ({
  revokeNotionToken: vi.fn()
}));

vi.mock("../src/localEnv", () => ({
  loadSharedLocalEnv: vi.fn()
}));

vi.mock("../src/sync/runtime", () => ({
  noteRuntimeSourceDisconnected: vi.fn(async () => undefined)
}));

import { POST as disconnectCalendar } from "../app/api/connectors/google-calendar/disconnect/route";
import { POST as disconnectNotion } from "../app/api/connectors/notion/disconnect/route";
import {
  deleteStoredGoogleCalendarConnection,
  readStoredTokens
} from "../src/connectors/googleCalendar/localStore";
import { revokeGoogleToken } from "../src/connectors/googleCalendar/oauth";
import {
  deleteStoredNotionConnection,
  readStoredNotionTokens
} from "../src/connectors/notion/localStore";
import { revokeNotionToken } from "../src/connectors/notion/oauth";
import { noteRuntimeSourceDisconnected } from "../src/sync/runtime";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("supporting connector disconnect routes", () => {
  it("deletes Calendar state before a remote revoke completes", async () => {
    vi.mocked(readStoredTokens).mockResolvedValue({
      accessToken: "calendar-access",
      refreshToken: "calendar-refresh",
      expiresAt: "2099-07-26T00:00:00.000Z",
      scope: "calendar.readonly",
      tokenType: "Bearer"
    });
    let releaseRevocation!: () => void;
    vi.mocked(revokeGoogleToken).mockReturnValue(
      new Promise<void>((resolve) => {
        releaseRevocation = resolve;
      })
    );

    const responsePromise = disconnectCalendar(disconnectRequest(
      "google-calendar"
    ));

    await vi.waitFor(() => {
      expect(
        deleteStoredGoogleCalendarConnection
      ).toHaveBeenCalledOnce();
      expect(noteRuntimeSourceDisconnected).toHaveBeenCalledWith(
        "google_calendar"
      );
      expect(revokeGoogleToken).toHaveBeenCalledOnce();
    });
    expect(
      vi.mocked(noteRuntimeSourceDisconnected).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(revokeGoogleToken).mock.invocationCallOrder[0]!
    );
    releaseRevocation();

    const response = await responsePromise;
    await expect(response.json()).resolves.toEqual({
      status: "disconnected"
    });
  });

  it("deletes Notion state before a remote revoke completes", async () => {
    vi.mocked(readStoredNotionTokens).mockResolvedValue({
      accessToken: "notion-access",
      refreshToken: "notion-refresh",
      tokenType: "bearer",
      botId: "bot-id",
      workspaceId: "workspace-id",
      workspaceName: "Workspace"
    });
    let releaseRevocation!: () => void;
    vi.mocked(revokeNotionToken).mockReturnValue(
      new Promise<void>((resolve) => {
        releaseRevocation = resolve;
      })
    );

    const responsePromise = disconnectNotion(
      disconnectRequest("notion")
    );

    await vi.waitFor(() => {
      expect(deleteStoredNotionConnection).toHaveBeenCalledOnce();
      expect(noteRuntimeSourceDisconnected).toHaveBeenCalledWith(
        "notion"
      );
      expect(revokeNotionToken).toHaveBeenCalledOnce();
    });
    expect(
      vi.mocked(noteRuntimeSourceDisconnected).mock
        .invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(revokeNotionToken).mock.invocationCallOrder[0]!
    );
    releaseRevocation();

    const response = await responsePromise;
    await expect(response.json()).resolves.toEqual({
      status: "disconnected"
    });
  });

  it("bounds a hung provider revocation after Calendar state is deleted", async () => {
    vi.useFakeTimers();
    vi.mocked(readStoredTokens).mockResolvedValue({
      accessToken: "calendar-access",
      refreshToken: "calendar-refresh",
      expiresAt: "2099-07-26T00:00:00.000Z",
      scope: "calendar.readonly",
      tokenType: "Bearer"
    });
    vi.mocked(revokeGoogleToken).mockReturnValue(
      new Promise<void>(() => undefined)
    );

    const responsePromise = disconnectCalendar(
      disconnectRequest("google-calendar")
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(
      deleteStoredGoogleCalendarConnection
    ).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_000);
    const response = await responsePromise;
    await expect(response.json()).resolves.toEqual({
      status: "disconnected"
    });
  });
});

function disconnectRequest(source: string): Request {
  return new Request(
    `http://localhost:3102/api/connectors/${source}/disconnect`,
    {
      method: "POST",
      headers: { origin: "http://localhost:3102" }
    }
  );
}
