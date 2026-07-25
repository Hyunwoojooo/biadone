import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/connectors/timeline/timeline", () => ({
  readConnectorTimeline: vi.fn()
}));

import { GET } from "../app/api/connectors/timeline/route";
import { readConnectorTimeline } from "../src/connectors/timeline/timeline";
import type { ConnectorTimelineState } from "../src/connectors/timeline/types";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("connector timeline route", () => {
  it("returns the cached unified timeline on localhost without caching", async () => {
    setDevelopmentEnvironment();
    const timeline = readyTimeline();
    vi.mocked(readConnectorTimeline).mockResolvedValue(timeline);

    const response = await GET(
      new Request("http://localhost:3102/api/connectors/timeline")
    );

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(readConnectorTimeline).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual(timeline);
  });

  it("rejects remote and production access before reading local snapshots", async () => {
    setDevelopmentEnvironment();

    const remoteResponse = await GET(
      new Request(
        "https://suggestion.blabase.com/api/connectors/timeline"
      )
    );
    expect(remoteResponse.status).toBe(404);
    expectNoStore(remoteResponse);
    await expect(remoteResponse.json()).resolves.toEqual({
      status: "unavailable",
      message:
        "연결 데이터 타임라인은 http://localhost:3102에서 확인해주세요.",
      localUrl: "http://localhost:3102"
    });
    expect(readConnectorTimeline).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "production");
    const productionResponse = await GET(
      new Request("http://localhost:3102/api/connectors/timeline")
    );
    expect(productionResponse.status).toBe(404);
    expectNoStore(productionResponse);
    expect(readConnectorTimeline).not.toHaveBeenCalled();
  });

  it("rejects an explicit cross-origin request", async () => {
    setDevelopmentEnvironment();

    const response = await GET(
      new Request("http://localhost:3102/api/connectors/timeline", {
        headers: { origin: "https://attacker.example" }
      })
    );

    expect(response.status).toBe(403);
    expectNoStore(response);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      message: "허용되지 않은 출처의 요청입니다."
    });
    expect(readConnectorTimeline).not.toHaveBeenCalled();
  });

  it("returns a safe error when a local snapshot cannot be read", async () => {
    setDevelopmentEnvironment();
    vi.mocked(readConnectorTimeline).mockRejectedValue(
      new Error("SECRET_LOCAL_PATH")
    );

    const response = await GET(
      new Request("http://localhost:3102/api/connectors/timeline")
    );

    expect(response.status).toBe(500);
    expectNoStore(response);
    const payload = await response.json();
    expect(payload).toEqual({
      status: "error",
      message:
        "저장된 연결 데이터를 읽지 못했습니다. 로컬 서버 상태를 확인해주세요."
    });
    expect(JSON.stringify(payload)).not.toContain("SECRET_LOCAL_PATH");
  });
});

function readyTimeline(): ConnectorTimelineState {
  return {
    status: "ready",
    schemaVersion: "connector-timeline-v2",
    timezone: "Asia/Seoul",
    generatedAt: "2026-07-25T14:00:00.000Z",
    itemCount: 0,
    truncated: false,
    sources: [],
    items: []
  };
}

function setDevelopmentEnvironment() {
  vi.stubEnv("NODE_ENV", "development");
}

function expectNoStore(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}
