import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/connectors/github/config", () => ({
  isLocalGitHubRequest: vi.fn(),
  loadGitHubConfig: vi.fn()
}));

vi.mock("../src/connectors/notion/config", () => ({
  isLocalNotionRequest: vi.fn(),
  loadNotionConfig: vi.fn()
}));

vi.mock("../src/connectors/googleCalendar/config", () => ({
  isLocalCalendarRequest: vi.fn(),
  loadGoogleCalendarConfig: vi.fn()
}));

vi.mock("../src/localEnv", () => ({
  loadSharedLocalEnv: vi.fn()
}));

import { GET as githubConnect } from "../app/api/connectors/github/connect/route";
import { GET as githubInstall } from "../app/api/connectors/github/install/route";
import { GET as calendarConnect } from "../app/api/connectors/google-calendar/connect/route";
import { GET as notionConnect } from "../app/api/connectors/notion/connect/route";
import {
  isLocalGitHubRequest,
  loadGitHubConfig
} from "../src/connectors/github/config";
import {
  isLocalCalendarRequest,
  loadGoogleCalendarConfig
} from "../src/connectors/googleCalendar/config";
import {
  isLocalNotionRequest,
  loadNotionConfig
} from "../src/connectors/notion/config";

afterEach(() => {
  vi.clearAllMocks();
});

describe("connector start route navigation", () => {
  it("returns every non-local connector start to its static source target", async () => {
    vi.mocked(isLocalGitHubRequest).mockReturnValue(false);
    vi.mocked(isLocalNotionRequest).mockReturnValue(false);
    vi.mocked(isLocalCalendarRequest).mockReturnValue(false);

    const [githubConnectResponse, githubInstallResponse, notionResponse, calendarResponse] =
      await Promise.all([
        githubConnect(request("github/connect")),
        githubInstall(request("github/install")),
        notionConnect(request("notion/connect")),
        calendarConnect(request("google-calendar/connect"))
      ]);

    expectSourceRedirect(
      githubConnectResponse,
      "github",
      "local_only",
      "source-github"
    );
    expectSourceRedirect(
      githubInstallResponse,
      "github",
      "local_only",
      "source-github"
    );
    expectSourceRedirect(
      notionResponse,
      "notion",
      "local_only",
      "source-notion"
    );
    expectSourceRedirect(
      calendarResponse,
      "calendar",
      "local_only",
      "source-google-calendar"
    );
  });

  it("returns every configuration failure to its static source target", async () => {
    vi.mocked(isLocalGitHubRequest).mockReturnValue(true);
    vi.mocked(isLocalNotionRequest).mockReturnValue(true);
    vi.mocked(isLocalCalendarRequest).mockReturnValue(true);
    vi.mocked(loadGitHubConfig).mockReturnValue({
      ok: false,
      reason: "missing",
      message: "missing"
    });
    vi.mocked(loadNotionConfig).mockReturnValue({
      ok: false,
      reason: "missing",
      message: "missing"
    });
    vi.mocked(loadGoogleCalendarConfig).mockReturnValue({
      ok: false,
      reason: "missing",
      message: "missing"
    });

    const [githubConnectResponse, githubInstallResponse, notionResponse, calendarResponse] =
      await Promise.all([
        githubConnect(request("github/connect")),
        githubInstall(request("github/install")),
        notionConnect(request("notion/connect")),
        calendarConnect(request("google-calendar/connect"))
      ]);

    expectSourceRedirect(
      githubConnectResponse,
      "github",
      "temporarily_unavailable",
      "source-github"
    );
    expectSourceRedirect(
      githubInstallResponse,
      "github",
      "temporarily_unavailable",
      "source-github"
    );
    expectSourceRedirect(
      notionResponse,
      "notion",
      "temporarily_unavailable",
      "source-notion"
    );
    expectSourceRedirect(
      calendarResponse,
      "calendar",
      "temporarily_unavailable",
      "source-google-calendar"
    );
  });
});

function request(path: string): Request {
  return new Request(`http://localhost:3102/api/connectors/${path}`);
}

function expectSourceRedirect(
  response: Response,
  statusQuery: string,
  status: string,
  anchor: string
): void {
  const location = new URL(requiredHeader(response, "location"));
  expect(location.pathname).toBe("/sources");
  expect(location.searchParams.size).toBe(1);
  expect(location.searchParams.get(statusQuery)).toBe(status);
  expect(location.hash).toBe(`#${anchor}`);
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`missing ${name} header`);
  return value;
}
