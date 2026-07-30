import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/context")>();
  return {
    ...actual,
    confirmStoredProjectMapping: vi.fn(),
    readStoredSourceScopeDiscovery: vi.fn(),
    readWorkContextRegistry: vi.fn()
  };
});

import {
  GET,
  POST
} from "../app/api/context/projects/route";
import {
  confirmStoredProjectMapping,
  readStoredSourceScopeDiscovery,
  readWorkContextRegistry
} from "../src/context";

const PROJECT_ID = `project_${"1".repeat(32)}`;
const discovery = {
  contract: "source-scope-discovery-v1" as const,
  projects: [
    {
      projectId: PROJECT_ID,
      label: "Project 1",
      archived: false
    }
  ],
  scopes: [
    {
      scopeFingerprint: "f".repeat(64),
      scope: {
        source: "github" as const,
        resourceType: "repository" as const,
        opaqueId: "101"
      },
      label: "owner/repository",
      projectId: null
    }
  ],
  truncatedSources: []
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("project mapping route discovery", () => {
  it("returns the safe discovery view from a local read", async () => {
    setDevelopment();
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "missing"
    });
    vi.mocked(readStoredSourceScopeDiscovery).mockResolvedValue(
      discovery
    );

    const response = await GET(
      new Request("http://localhost:3102/api/context/projects")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      registry: null,
      discovery
    });
    expect(readStoredSourceScopeDiscovery).toHaveBeenCalledWith({
      registry: null
    });
  });

  it("requires the explicit confirmation literal before mapping", async () => {
    setDevelopment();
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "missing"
    });
    vi.mocked(readStoredSourceScopeDiscovery).mockResolvedValue(
      discovery
    );

    const rejected = await POST(
      mutationRequest({
        action: "confirm_mapping",
        projectId: PROJECT_ID,
        scope: discovery.scopes[0].scope
      })
    );
    const confirmed = await POST(
      mutationRequest({
        action: "confirm_mapping",
        projectId: PROJECT_ID,
        scope: discovery.scopes[0].scope,
        explicitUserConfirmation: true
      })
    );

    expect(rejected.status).toBe(400);
    expect(confirmed.status).toBe(200);
    expect(confirmStoredProjectMapping).toHaveBeenCalledOnce();
    expect(confirmStoredProjectMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitUserConfirmation: true
      })
    );
  });
});

function setDevelopment() {
  vi.stubEnv("NODE_ENV", "development");
}

function mutationRequest(body: unknown): Request {
  return new Request(
    "http://localhost:3102/api/context/projects",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3102",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
}
