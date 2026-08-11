import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/connectors/googleCalendar/config", () => ({
  isLocalCalendarRequest: vi.fn(() => true),
  loadGoogleCalendarConfig: vi.fn()
}));

vi.mock("../src/connectors/googleCalendar/localStore", () => ({
  readStoredSnapshot: vi.fn(),
  readStoredTokens: vi.fn()
}));

vi.mock("../src/connectors/notion/config", () => ({
  isLocalNotionRequest: vi.fn(() => true),
  loadNotionConfig: vi.fn()
}));

vi.mock("../src/connectors/notion/localStore", () => ({
  readStoredNotionSnapshot: vi.fn(),
  readStoredNotionTokens: vi.fn()
}));

vi.mock("../src/localEnv", () => ({
  loadSharedLocalEnv: vi.fn()
}));

import { GET as calendarStatus } from "../app/api/connectors/google-calendar/status/route";
import { GET as notionStatus } from "../app/api/connectors/notion/status/route";
import {
  isLocalCalendarRequest,
  loadGoogleCalendarConfig
} from "../src/connectors/googleCalendar/config";
import { readStoredTokens } from "../src/connectors/googleCalendar/localStore";
import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../src/connectors/notion/config";
import { readStoredNotionTokens } from "../src/connectors/notion/localStore";

beforeEach(() => {
  vi.mocked(isLocalCalendarRequest).mockReturnValue(true);
  vi.mocked(isLocalNotionRequest).mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("supporting connector status routes", () => {
  it("reports missing Notion operator configuration as unavailable", async () => {
    vi.mocked(loadNotionConfig).mockReturnValue({
      ok: false,
      reason: "missing",
      message: "Notion OAuth 설정이 필요합니다."
    });

    const response = await notionStatus(
      new Request("http://localhost:3102/api/connectors/notion/status")
    );

    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      message: "Notion OAuth 설정이 필요합니다."
    });
    expect(readStoredNotionTokens).not.toHaveBeenCalled();
  });

  it("reports missing Calendar operator configuration as unavailable", async () => {
    vi.mocked(loadGoogleCalendarConfig).mockReturnValue({
      ok: false,
      reason: "missing",
      message: "Google OAuth 설정이 필요합니다."
    });

    const response = await calendarStatus(
      new Request(
        "http://localhost:3102/api/connectors/google-calendar/status"
      )
    );

    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      message: "Google OAuth 설정이 필요합니다."
    });
    expect(readStoredTokens).not.toHaveBeenCalled();
  });

  it("points non-local supporting connectors at their local cards", async () => {
    vi.mocked(isLocalNotionRequest).mockReturnValue(false);
    vi.mocked(isLocalCalendarRequest).mockReturnValue(false);

    const [notionResponse, calendarResponse] = await Promise.all([
      notionStatus(
        new Request("https://app.blabase.com/api/connectors/notion/status")
      ),
      calendarStatus(
        new Request(
          "https://app.blabase.com/api/connectors/google-calendar/status"
        )
      )
    ]);

    await expect(notionResponse.json()).resolves.toMatchObject({
      status: "unavailable",
      localUrl: "http://localhost:3102/sources#source-notion"
    });
    await expect(calendarResponse.json()).resolves.toMatchObject({
      status: "unavailable",
      localUrl:
        "http://localhost:3102/sources#source-google-calendar"
    });
  });
});
