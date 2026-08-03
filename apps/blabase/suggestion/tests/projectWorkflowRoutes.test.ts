import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/context")>();
  return {
    ...actual,
    readWorkContextRegistry: vi.fn()
  };
});

vi.mock("../src/workflows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/workflows")>();
  return {
    ...actual,
    clearStoredProjectWorkflow: vi.fn(),
    configureStoredProjectWorkflow: vi.fn(),
    readProjectWorkflowStore: vi.fn(),
    recordStoredProjectWorkflowClosure: vi.fn()
  };
});

import {
  GET,
  POST
} from "../app/api/context/project-workflows/route";
import { readWorkContextRegistry } from "../src/context";
import {
  clearStoredProjectWorkflow,
  configureStoredProjectWorkflow,
  createEmptyProjectWorkflowStore,
  readProjectWorkflowStore,
  recordStoredProjectWorkflowClosure
} from "../src/workflows";

const NOW = "2026-08-01T10:00:00.000Z";
const PROJECT_ID = `project_${"1".repeat(32)}`;
const MANAGED_RUN_ID = `managed_run_${"2".repeat(32)}`;
const BINDING_ID = `binding_${"3".repeat(32)}`;
const EXECUTION_ID = `codex:execution:${"4".repeat(24)}`;
const WORKFLOW_DECISION_ID = `workflow_decision_${"5".repeat(32)}`;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.mocked(readProjectWorkflowStore).mockResolvedValue(
    createEmptyProjectWorkflowStore()
  );
  vi.mocked(readWorkContextRegistry).mockResolvedValue({
    status: "available",
    value: {
      projects: [
        {
          projectId: PROJECT_ID,
          archivedAt: null
        }
      ]
    }
  } as never);
  vi.mocked(configureStoredProjectWorkflow).mockResolvedValue({} as never);
  vi.mocked(clearStoredProjectWorkflow).mockResolvedValue({} as never);
  vi.mocked(recordStoredProjectWorkflowClosure).mockResolvedValue(
    {} as never
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("project workflow local API", () => {
  it("returns a strict current projection only for a safe local read", async () => {
    const response = await GET(
      new Request("http://localhost:3102/api/context/project-workflows")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "ready",
      projection: {
        contract: "project-workflow-projection-v0.1",
        asOf: NOW,
        revision: 0,
        activeWorkflows: [],
        closures: []
      }
    });

    const crossOrigin = await GET(
      new Request("http://localhost:3102/api/context/project-workflows", {
        headers: { origin: "https://example.com" }
      })
    );
    expect(crossOrigin.status).toBe(403);

    vi.stubEnv("NODE_ENV", "production");
    const deployed = await GET(
      new Request("https://blabase.com/api/context/project-workflows")
    );
    expect(deployed.status).toBe(404);
  });

  it("configures an active project only with explicit confirmation", async () => {
    const rejected = await POST(
      mutationRequest({
        action: "configure",
        projectId: PROJECT_ID,
        actionKind: "commit_changes"
      })
    );
    const configured = await POST(
      mutationRequest({
        action: "configure",
        projectId: PROJECT_ID,
        actionKind: "commit_changes",
        explicitUserConfirmation: true
      })
    );

    expect(rejected.status).toBe(400);
    expect(configured.status).toBe(200);
    expect(configureStoredProjectWorkflow).toHaveBeenCalledOnce();
    expect(configureStoredProjectWorkflow).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      actionKind: "commit_changes",
      configuredAt: NOW,
      explicitUserConfirmation: true
    });
  });

  it("requires an exact same-origin header before any mutation", async () => {
    const body = JSON.stringify({
      action: "clear",
      projectId: PROJECT_ID,
      explicitUserConfirmation: true
    });
    const missingOrigin = await POST(
      new Request(
        "http://localhost:3102/api/context/project-workflows",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body
        }
      )
    );
    const crossOrigin = await POST(
      new Request(
        "http://localhost:3102/api/context/project-workflows",
        {
          method: "POST",
          headers: {
            origin: "https://example.com",
            "content-type": "application/json"
          },
          body
        }
      )
    );

    expect(missingOrigin.status).toBe(403);
    expect(crossOrigin.status).toBe(403);
    expect(clearStoredProjectWorkflow).not.toHaveBeenCalled();
    expect(readProjectWorkflowStore).not.toHaveBeenCalled();
  });

  it("rejects inactive projects and extra raw content", async () => {
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "available",
      value: {
        projects: [
          {
            projectId: PROJECT_ID,
            archivedAt: NOW
          }
        ]
      }
    } as never);

    const archived = await POST(
      mutationRequest({
        action: "configure",
        projectId: PROJECT_ID,
        actionKind: "review_changes",
        explicitUserConfirmation: true
      })
    );
    const rawContent = await POST(
      mutationRequest({
        action: "configure",
        projectId: PROJECT_ID,
        actionKind: "review_changes",
        explicitUserConfirmation: true,
        rawTitle: "must not cross the contract"
      })
    );

    expect(archived.status).toBe(409);
    expect(rawContent.status).toBe(400);
    expect(configureStoredProjectWorkflow).not.toHaveBeenCalled();
  });

  it("clears a setting and records an explicit run closure", async () => {
    const cleared = await POST(
      mutationRequest({
        action: "clear",
        projectId: PROJECT_ID,
        explicitUserConfirmation: true
      })
    );
    const closed = await POST(
      mutationRequest({
        action: "record_closure",
        managedRunId: MANAGED_RUN_ID,
        bindingId: BINDING_ID,
        executionId: EXECUTION_ID,
        workflowDecisionId: WORKFLOW_DECISION_ID,
        actionKind: "request_review",
        outcome: "skipped",
        explicitUserConfirmation: true
      })
    );

    expect(cleared.status).toBe(200);
    expect(clearStoredProjectWorkflow).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      clearedAt: NOW,
      explicitUserConfirmation: true
    });
    expect(closed.status).toBe(200);
    expect(recordStoredProjectWorkflowClosure).toHaveBeenCalledWith({
      managedRunId: MANAGED_RUN_ID,
      bindingId: BINDING_ID,
      executionId: EXECUTION_ID,
      workflowDecisionId: WORKFLOW_DECISION_ID,
      actionKind: "request_review",
      outcome: "skipped",
      decidedAt: NOW,
      explicitUserConfirmation: true
    });
  });
});

function mutationRequest(body: unknown): Request {
  return new Request(
    "http://localhost:3102/api/context/project-workflows",
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
