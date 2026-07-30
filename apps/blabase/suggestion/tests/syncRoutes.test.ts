import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/sync/runtime", () => ({
  readRuntimeSourceSyncStatus: vi.fn(),
  startRuntimeSourceSync: vi.fn(),
  syncRuntimeSources: vi.fn()
}));

import { POST as postSync } from "../app/api/sync/route";
import { POST as startSync } from "../app/api/sync/start/route";
import { GET as getSyncStatus } from "../app/api/sync/status/route";
import {
  readRuntimeSourceSyncStatus,
  startRuntimeSourceSync,
  syncRuntimeSources
} from "../src/sync/runtime";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("source sync routes", () => {
  it("reads coordinator status locally without caching", async () => {
    setDevelopment();
    vi.mocked(readRuntimeSourceSyncStatus).mockResolvedValue(
      statusFixture() as never
    );

    const response = await getSyncStatus(
      new Request("http://localhost:3102/api/sync/status")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readRuntimeSourceSyncStatus).toHaveBeenCalledWith({
      startScheduler: false
    });
    await expect(response.json()).resolves.toEqual(statusFixture());
  });

  it("starts scheduling only through a same-origin local mutation", async () => {
    setDevelopment();
    vi.mocked(startRuntimeSourceSync).mockResolvedValue(
      statusFixture() as never
    );

    const response = await startSync(
      new Request("http://localhost:3102/api/sync/start", {
        method: "POST",
        headers: { origin: "http://localhost:3102" }
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(startRuntimeSourceSync).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual(statusFixture());
  });

  it("validates same-origin source mutations and delegates once", async () => {
    setDevelopment();
    vi.mocked(syncRuntimeSources).mockResolvedValue(
      statusFixture() as never
    );

    const response = await postSync(
      new Request("http://localhost:3102/api/sync", {
        method: "POST",
        headers: {
          origin: "http://localhost:3102",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sources: ["github", "codex", "github"]
        })
      })
    );

    expect(response.status).toBe(200);
    expect(syncRuntimeSources).toHaveBeenCalledWith({
      sources: ["github", "codex", "github"]
    });
  });

  it("rejects invalid, cross-origin, and remote requests before sync", async () => {
    setDevelopment();
    const invalid = await postSync(
      new Request("http://localhost:3102/api/sync", {
        method: "POST",
        headers: {
          origin: "http://localhost:3102",
          "content-type": "application/json"
        },
        body: JSON.stringify({ sources: ["unknown"] })
      })
    );
    const crossOrigin = await postSync(
      new Request("http://localhost:3102/api/sync", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json"
        },
        body: JSON.stringify({ sources: ["github"] })
      })
    );
    const remote = await getSyncStatus(
      new Request("https://app.example/api/sync/status")
    );
    const crossOriginStart = await startSync(
      new Request("http://localhost:3102/api/sync/start", {
        method: "POST",
        headers: { origin: "https://evil.example" }
      })
    );

    expect(invalid.status).toBe(400);
    expect(crossOrigin.status).toBe(403);
    expect(remote.status).toBe(404);
    expect(crossOriginStart.status).toBe(403);
    expect(syncRuntimeSources).not.toHaveBeenCalled();
    expect(startRuntimeSourceSync).not.toHaveBeenCalled();
  });
});

function setDevelopment() {
  vi.stubEnv("NODE_ENV", "development");
}

function statusFixture() {
  return {
    status: "ready",
    revision: "pipeline:test",
    generatedAt: "2026-07-27T00:00:00.000Z",
    sources: [],
    adapterMode: "coordinator"
  };
}
