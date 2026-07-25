import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/connectors/codex/appServer", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/codex/appServer")
    >();
  return {
    ...actual,
    discoverAndStoreCodexScopes: vi.fn(),
    fetchAndStoreCodexSnapshot: vi.fn(),
    selectStoredCodexScopes: vi.fn()
  };
});

vi.mock("../src/connectors/codex/localStore", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connectors/codex/localStore")
    >();
  return {
    ...actual,
    deleteStoredCodexConnection: vi.fn(async () => undefined),
    readStoredCodexConfig: vi.fn(async () => null),
    readStoredCodexSnapshot: vi.fn(async () => null)
  };
});

vi.mock("../src/localEnv", () => ({
  loadSharedLocalEnv: vi.fn()
}));

import { POST as connect } from "../app/api/connectors/codex/connect/route";
import { POST as disconnect } from "../app/api/connectors/codex/disconnect/route";
import { GET as status } from "../app/api/connectors/codex/status/route";
import {
  discoverAndStoreCodexScopes,
  fetchAndStoreCodexSnapshot,
  selectStoredCodexScopes
} from "../src/connectors/codex/appServer";
import {
  deleteStoredCodexConnection,
  readStoredCodexConfig,
  readStoredCodexSnapshot
} from "../src/connectors/codex/localStore";
import type {
  CodexSessionSignal,
  CodexSnapshot,
  StoredCodexConfig
} from "../src/connectors/codex/types";

const SCOPE_A = "a".repeat(24);
const SCOPE_B = "b".repeat(24);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("Codex connector routes", () => {
  it("allows localhost status and rejects non-local connector access", async () => {
    setDevelopmentEnvironment();
    vi.mocked(readStoredCodexConfig).mockResolvedValue(null);

    const localResponse = await status(
      new Request("http://localhost:3102/api/connectors/codex/status")
    );
    expect(localResponse.status).toBe(200);
    expectNoStore(localResponse);
    await expect(localResponse.json()).resolves.toEqual({
      status: "disconnected"
    });

    vi.clearAllMocks();
    const remoteStatusResponse = await status(
      new Request(
        "https://suggestion.blabase.com/api/connectors/codex/status"
      )
    );
    expect(remoteStatusResponse.status).toBe(200);
    expectNoStore(remoteStatusResponse);
    await expect(remoteStatusResponse.json()).resolves.toEqual({
      status: "unavailable",
      message:
        "Codex 연결은 http://localhost:3102에서 확인해주세요.",
      localUrl: "http://localhost:3102"
    });
    expect(readStoredCodexConfig).not.toHaveBeenCalled();

    const remoteConnectResponse = await connect(
      jsonRequest(
        "https://suggestion.blabase.com/api/connectors/codex/connect",
        "https://suggestion.blabase.com",
        { action: "discover" }
      )
    );
    expect(remoteConnectResponse.status).toBe(404);
    expectNoStore(remoteConnectResponse);
    await expect(remoteConnectResponse.json()).resolves.toEqual({
      error: "LOCAL_ONLY"
    });
    expect(discoverAndStoreCodexScopes).not.toHaveBeenCalled();
  });

  it("rejects cross-origin connect and disconnect mutations", async () => {
    setDevelopmentEnvironment();

    const connectResponse = await connect(
      jsonRequest(
        "http://localhost:3102/api/connectors/codex/connect",
        "https://attacker.example",
        { action: "discover" }
      )
    );
    expect(connectResponse.status).toBe(403);
    expectNoStore(connectResponse);
    await expect(connectResponse.json()).resolves.toEqual({
      error: "INVALID_ORIGIN"
    });
    expect(discoverAndStoreCodexScopes).not.toHaveBeenCalled();

    const disconnectResponse = await disconnect(
      new Request(
        "http://localhost:3102/api/connectors/codex/disconnect",
        {
          method: "POST",
          headers: { origin: "https://attacker.example" }
        }
      )
    );
    expect(disconnectResponse.status).toBe(403);
    expectNoStore(disconnectResponse);
    await expect(disconnectResponse.json()).resolves.toEqual({
      error: "INVALID_ORIGIN"
    });
    expect(deleteStoredCodexConnection).not.toHaveBeenCalled();
  });

  it("discovers scopes and returns the project-selection state", async () => {
    setDevelopmentEnvironment();
    const config = storedConfig({
      selectedScopeIds: [SCOPE_A]
    });
    vi.mocked(discoverAndStoreCodexScopes).mockResolvedValue(config);

    const response = await connect(
      jsonRequest(
        "http://localhost:3102/api/connectors/codex/connect",
        "http://localhost:3102",
        { action: "discover" }
      )
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(discoverAndStoreCodexScopes).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      status: "scope_selection",
      message: "제안에 사용할 Codex 프로젝트를 선택해주세요.",
      contentMode: "metadata_only",
      scopes: [
        {
          id: SCOPE_A,
          label: "blabase",
          sessionCount: 4,
          lastActivityAt: "2026-07-25T09:00:00.000Z",
          selected: true
        },
        {
          id: SCOPE_B,
          label: "website",
          sessionCount: 2,
          lastActivityAt: "2026-07-24T09:00:00.000Z",
          selected: false
        }
      ]
    });
  });

  it("selects scopes, synchronizes, and returns minimized connection counts", async () => {
    setDevelopmentEnvironment();
    const config = storedConfig();
    const snapshot = codexSnapshot({
      sessions: [
        session("1", SCOPE_A, "active", "waiting_on_approval"),
        session("2", SCOPE_A, "system_error"),
        session("3", SCOPE_A, "idle"),
        session("4", SCOPE_A, "not_loaded")
      ]
    });
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue(null);
    vi.mocked(selectStoredCodexScopes).mockResolvedValue(config);
    vi.mocked(fetchAndStoreCodexSnapshot).mockResolvedValue(snapshot);

    const response = await connect(
      jsonRequest(
        "http://localhost:3102/api/connectors/codex/connect",
        "http://localhost:3102",
        { action: "connect", scopeIds: [SCOPE_A] }
      )
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(selectStoredCodexScopes).toHaveBeenCalledWith(
      [SCOPE_A],
      process.cwd(),
      "metadata_only"
    );
    expect(fetchAndStoreCodexSnapshot).toHaveBeenCalledWith(config);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "connected",
      codexVersion: "codex-cli 0.145.0",
      sessionCount: 4,
      projectCount: 1,
      sessions: [
        expect.objectContaining({ id: sessionId("1") }),
        expect.objectContaining({ id: sessionId("2") }),
        expect.objectContaining({ id: sessionId("3") })
      ]
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /activityState|attentionState/
    );
  });

  it("passes explicit task-summary consent and returns only the minimized clue", async () => {
    setDevelopmentEnvironment();
    const config = storedConfig({
      contentMode: "activity_summary",
      contentConsentAt: "2026-07-25T09:45:00.000Z"
    });
    const snapshot = codexSnapshot({
      contentMode: "activity_summary",
      sessions: [
        {
          ...session("summary", SCOPE_A, "idle"),
          taskSummary: "OAuth 연결 오류 정리",
          taskSummarySource: "thread_name"
        }
      ]
    });
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue(null);
    vi.mocked(selectStoredCodexScopes).mockResolvedValue(config);
    vi.mocked(fetchAndStoreCodexSnapshot).mockResolvedValue(snapshot);

    const response = await connect(
      jsonRequest(
        "http://localhost:3102/api/connectors/codex/connect",
        "http://localhost:3102",
        {
          action: "connect",
          scopeIds: [SCOPE_A],
          contentMode: "activity_summary"
        }
      )
    );

    expectNoStore(response);
    expect(selectStoredCodexScopes).toHaveBeenCalledWith(
      [SCOPE_A],
      process.cwd(),
      "activity_summary"
    );
    await expect(response.json()).resolves.toMatchObject({
      status: "connected",
      contentMode: "activity_summary",
      sessions: [
        {
          taskSummary: "OAuth 연결 오류 정리",
          taskSummarySource: "thread_name"
        }
      ]
    });
  });

  it("changes task-summary consent for the existing selected projects", async () => {
    setDevelopmentEnvironment();
    const currentConfig = storedConfig({
      selectedScopeIds: [SCOPE_A]
    });
    const updatedConfig = storedConfig({
      selectedScopeIds: [SCOPE_A],
      contentMode: "activity_summary",
      contentConsentAt: "2026-07-25T09:45:00.000Z"
    });
    const snapshot = codexSnapshot({
      contentMode: "activity_summary",
      sessions: [
        {
          ...session("summary", SCOPE_A, "idle"),
          taskSummary: "타임라인 활동을 구체화해줘",
          taskSummarySource: "first_user_request"
        }
      ]
    });
    vi.mocked(readStoredCodexConfig).mockResolvedValue(currentConfig);
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue(
      codexSnapshot()
    );
    vi.mocked(selectStoredCodexScopes).mockResolvedValue(
      updatedConfig
    );
    vi.mocked(fetchAndStoreCodexSnapshot).mockResolvedValue(snapshot);

    const response = await connect(
      jsonRequest(
        "http://localhost:3102/api/connectors/codex/connect",
        "http://localhost:3102",
        {
          action: "set_content_mode",
          contentMode: "activity_summary"
        }
      )
    );

    expectNoStore(response);
    expect(selectStoredCodexScopes).toHaveBeenCalledWith(
      [SCOPE_A],
      process.cwd(),
      "activity_summary"
    );
    expect(fetchAndStoreCodexSnapshot).toHaveBeenCalledWith(
      updatedConfig
    );
    await expect(response.json()).resolves.toMatchObject({
      status: "connected",
      contentMode: "activity_summary",
      sessions: [
        {
          taskSummary: "타임라인 활동을 구체화해줘",
          taskSummarySource: "first_user_request"
        }
      ]
    });
  });

  it("keeps GET status read-only and refreshes through same-origin POST", async () => {
    setDevelopmentEnvironment();
    const config = storedConfig();
    const cached = codexSnapshot();
    const refreshed = codexSnapshot({
      fetchedAt: "2026-07-25T11:00:00.000Z",
      sessions: [session("new", SCOPE_A, "idle")]
    });
    vi.mocked(readStoredCodexConfig).mockResolvedValue(config);
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue(cached);
    vi.mocked(fetchAndStoreCodexSnapshot).mockResolvedValue(refreshed);

    const cachedResponse = await status(
      new Request("http://localhost:3102/api/connectors/codex/status")
    );
    expectNoStore(cachedResponse);
    expect(fetchAndStoreCodexSnapshot).not.toHaveBeenCalled();
    await expect(cachedResponse.json()).resolves.toMatchObject({
      status: "connected",
      lastSyncedAt: cached.fetchedAt
    });

    const refreshedResponse = await connect(
      jsonRequest(
        "http://localhost:3102/api/connectors/codex/connect",
        "http://localhost:3102",
        { action: "refresh" }
      )
    );
    expectNoStore(refreshedResponse);
    expect(fetchAndStoreCodexSnapshot).toHaveBeenCalledOnce();
    expect(fetchAndStoreCodexSnapshot).toHaveBeenCalledWith(config);
    await expect(refreshedResponse.json()).resolves.toMatchObject({
      status: "connected",
      lastSyncedAt: refreshed.fetchedAt,
      sessionCount: 1
    });
  });

  it("does not auto-sync a mismatched GET cache and refreshes it by POST", async () => {
    setDevelopmentEnvironment();
    const config = storedConfig();
    const mismatched = codexSnapshot({
      scopeIds: [SCOPE_B],
      sessions: [session("old", SCOPE_B, "active")]
    });
    const refreshed = codexSnapshot();
    vi.mocked(readStoredCodexConfig).mockResolvedValue(config);
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue(mismatched);
    vi.mocked(fetchAndStoreCodexSnapshot).mockResolvedValue(refreshed);

    const response = await status(
      new Request("http://localhost:3102/api/connectors/codex/status")
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(fetchAndStoreCodexSnapshot).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      status: "sync_error",
      message:
        "Codex 메타데이터를 다시 확인해야 합니다. 새로고침을 눌러주세요.",
      lastSyncedAt: mismatched.fetchedAt
    });

    const refreshedResponse = await connect(
      jsonRequest(
        "http://localhost:3102/api/connectors/codex/connect",
        "http://localhost:3102",
        { action: "refresh" }
      )
    );
    expectNoStore(refreshedResponse);
    expect(fetchAndStoreCodexSnapshot).toHaveBeenCalledOnce();
    expect(fetchAndStoreCodexSnapshot).toHaveBeenCalledWith(config);
    await expect(refreshedResponse.json()).resolves.toMatchObject({
      status: "connected",
      lastSyncedAt: refreshed.fetchedAt
    });
  });

  it("fails closed when cached task-summary consent does not match the active config", async () => {
    setDevelopmentEnvironment();
    const config = storedConfig({
      contentMode: "metadata_only",
      contentConsentAt: null
    });
    const staleSummary = codexSnapshot({
      contentMode: "activity_summary",
      sessions: [
        {
          ...session("stale", SCOPE_A, "idle"),
          taskSummary: "SHOULD_NOT_BE_RETURNED",
          taskSummarySource: "first_user_request"
        }
      ]
    });
    vi.mocked(readStoredCodexConfig).mockResolvedValue(config);
    vi.mocked(readStoredCodexSnapshot).mockResolvedValue(staleSummary);

    const response = await status(
      new Request("http://localhost:3102/api/connectors/codex/status")
    );

    expectNoStore(response);
    const payload = await response.json();
    expect(payload).toEqual({
      status: "sync_error",
      message:
        "Codex 메타데이터를 다시 확인해야 합니다. 새로고침을 눌러주세요.",
      lastSyncedAt: staleSummary.fetchedAt
    });
    expect(JSON.stringify(payload)).not.toContain(
      "SHOULD_NOT_BE_RETURNED"
    );
  });

  it("deletes all local connector state on same-origin disconnect", async () => {
    setDevelopmentEnvironment();

    const response = await disconnect(
      new Request(
        "http://localhost:3102/api/connectors/codex/disconnect",
        {
          method: "POST",
          headers: { origin: "http://localhost:3102" }
        }
      )
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(deleteStoredCodexConnection).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({
      status: "disconnected"
    });
  });
});

function setDevelopmentEnvironment(): void {
  vi.stubEnv("NODE_ENV", "development");
}

function storedConfig(
  overrides: Partial<StoredCodexConfig> = {}
): StoredCodexConfig {
  return {
    schemaVersion: "codex-connector-config-v2",
    installationSecret: "f".repeat(64),
    selectedScopeIds: [SCOPE_A],
    scopes: [
      {
        id: SCOPE_A,
        queryPath: "/Users/example/blabase",
        label: "blabase",
        sessionCount: 4,
        lastActivityAt: "2026-07-25T09:00:00.000Z"
      },
      {
        id: SCOPE_B,
        queryPath: "/Users/example/website",
        label: "website",
        sessionCount: 2,
        lastActivityAt: "2026-07-24T09:00:00.000Z"
      }
    ],
    contentMode: "metadata_only",
    contentConsentAt: null,
    discoveredAt: "2026-07-25T09:30:00.000Z",
    ...overrides
  };
}

function codexSnapshot(
  overrides: Partial<CodexSnapshot> = {}
): CodexSnapshot {
  return {
    schemaVersion: "codex-snapshot-v2",
    collectorVersion: "codex-app-server-activity-summary-v1",
    contentMode: "metadata_only",
    codexVersion: "codex-cli 0.145.0",
    fetchedAt: "2026-07-25T10:00:00.000Z",
    lookbackStart: "2026-06-25T10:00:00.000Z",
    truncated: false,
    scopeIds: [SCOPE_A],
    sessions: [session("cached", SCOPE_A, "idle")],
    ...overrides
  };
}

function session(
  id: string,
  scopeId: string,
  activityState: CodexSessionSignal["activityState"],
  attentionState: CodexSessionSignal["attentionState"] = null
): CodexSessionSignal {
  return {
    id: sessionId(id),
    source: "codex",
    kind: "coding_session",
    scopeId,
    projectLabel: scopeId === SCOPE_A ? "blabase" : "website",
    taskSummary: null,
    taskSummarySource: null,
    createdAt: "2026-07-25T08:00:00.000Z",
    updatedAt: "2026-07-25T09:00:00.000Z",
    activityState,
    attentionState
  };
}

function sessionId(value: string): string {
  return value.padEnd(24, "0").slice(0, 24);
}

function jsonRequest(
  url: string,
  origin: string,
  body: unknown
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin
    },
    body: JSON.stringify(body)
  });
}

function expectNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
}
