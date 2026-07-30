import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/context")>();
  return {
    ...actual,
    captureStoredWeeklyOutcome: vi.fn(),
    confirmStoredProjectMapping: vi.fn(),
    createStoredProjectIdentity: vi.fn(),
    readStoredSourceScopeDiscovery: vi.fn().mockResolvedValue({
      contract: "source-scope-discovery-v1",
      projects: [],
      scopes: [],
      truncatedSources: []
    }),
    readWeeklyOutcome: vi.fn(),
    readWorkContextRegistry: vi.fn(),
    removeStoredProjectMapping: vi.fn()
  };
});

import {
  GET as getProjects,
  POST as postProjects
} from "../app/api/context/projects/route";
import {
  GET as getWeeklyOutcome,
  POST as postWeeklyOutcome
} from "../app/api/context/weekly-outcome/route";
import {
  captureStoredWeeklyOutcome,
  confirmStoredProjectMapping,
  createStoredProjectIdentity,
  readWeeklyOutcome,
  readWorkContextRegistry
} from "../src/context";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("work context routes", () => {
  it("reads and updates the global weekly outcome locally", async () => {
    setDevelopment();
    vi.mocked(readWeeklyOutcome).mockResolvedValue({
      status: "available",
      outcome: {
        outcomeId: `outcome_${"1".repeat(32)}`,
        projectId: null,
        primaryOutcome: "Stabilize the data pipeline",
        capturedAt: "2026-07-27T00:00:00.000Z",
        validUntil: "2026-08-03T00:00:00.000Z",
        recordedAt: "2026-07-27T00:00:00.000Z",
        changeKind: "capture",
        supersedesOutcomeId: null
      }
    });

    const readResponse = await getWeeklyOutcome(
      new Request(
        "http://localhost:3102/api/context/weekly-outcome"
      )
    );
    const writeResponse = await postWeeklyOutcome(
      new Request(
        "http://localhost:3102/api/context/weekly-outcome",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3102",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            primaryOutcome: "Stabilize the data pipeline"
          })
        }
      )
    );

    expect(readResponse.status).toBe(200);
    expect(writeResponse.status).toBe(200);
    expect(captureStoredWeeklyOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryOutcome: "Stabilize the data pipeline"
      })
    );
    const capture = vi.mocked(captureStoredWeeklyOutcome).mock
      .calls[0]?.[0];
    expect(
      Date.parse(capture?.validUntil ?? "") -
        Date.parse(capture?.capturedAt ?? "")
    ).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("requires explicit confirmation for project mappings", async () => {
    setDevelopment();
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "missing"
    });

    const create = await postProjects(
      contextMutation({ action: "create_project" })
    );
    const rejected = await postProjects(
      contextMutation({
        action: "confirm_mapping",
        projectId: `project_${"1".repeat(32)}`,
        scope: {
          source: "github",
          resourceType: "repository",
          opaqueId: "101"
        }
      })
    );
    const confirmed = await postProjects(
      contextMutation({
        action: "confirm_mapping",
        projectId: `project_${"1".repeat(32)}`,
        scope: {
          source: "github",
          resourceType: "repository",
          opaqueId: "101"
        },
        explicitUserConfirmation: true
      })
    );

    expect(create.status).toBe(200);
    expect(createStoredProjectIdentity).toHaveBeenCalledOnce();
    expect(rejected.status).toBe(400);
    expect(confirmed.status).toBe(200);
    expect(confirmStoredProjectMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitUserConfirmation: true
      })
    );
  });

  it("rejects unsafe origins before reading private context", async () => {
    setDevelopment();
    const response = await getProjects(
      new Request("http://localhost:3102/api/context/projects", {
        headers: { origin: "https://evil.example" }
      })
    );

    expect(response.status).toBe(403);
    expect(readWorkContextRegistry).not.toHaveBeenCalled();
  });
});

function setDevelopment() {
  vi.stubEnv("NODE_ENV", "development");
}

function contextMutation(body: unknown): Request {
  return new Request("http://localhost:3102/api/context/projects", {
    method: "POST",
    headers: {
      origin: "http://localhost:3102",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}
