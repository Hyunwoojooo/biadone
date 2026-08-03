import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureProjectWorkflow as configureProjectWorkflowRequest,
  fetchProjectWorkflows
} from "../app/projectWorkflowsClient";
import {
  configureProjectWorkflow,
  createEmptyProjectWorkflowStore,
  resolveProjectWorkflowProjection
} from "../src/workflows";

const AS_OF = "2026-08-01T10:10:00.000Z";
const PROJECT_A = `project_${"1".repeat(32)}`;
const PROJECT_B = `project_${"2".repeat(32)}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project workflow client", () => {
  it("reads a strict projection without caching", async () => {
    const projection = workflowProjection();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "ready", projection })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProjectWorkflows()).resolves.toEqual({
      status: "ready",
      projection
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/context/project-workflows",
      { cache: "no-store" }
    );
  });

  it("sends only the selected action with explicit confirmation", async () => {
    const projection = workflowProjection();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "ready", projection })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      configureProjectWorkflowRequest({
        projectId: PROJECT_A,
        actionKind: "create_pull_request"
      })
    ).resolves.toEqual(projection);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/context/project-workflows",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "configure",
          projectId: PROJECT_A,
          actionKind: "create_pull_request",
          explicitUserConfirmation: true
        }),
        cache: "no-store"
      }
    );
  });

  it("fails closed when raw content enters a projected workflow", async () => {
    const projection = structuredClone(workflowProjection());
    Object.assign(projection.activeWorkflows[0]!, {
      rawTitle: "private title"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ status: "ready", projection })
      )
    );

    await expect(fetchProjectWorkflows()).resolves.toEqual({
      status: "error",
      code: "INVALID_PROJECT_WORKFLOW_PROJECTION",
      message: "프로젝트 workflow 결과를 검증하지 못했습니다."
    });
  });

  it("rejects non-canonical and future projection entries", async () => {
    const unsorted = structuredClone(workflowProjection());
    unsorted.activeWorkflows.reverse();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ status: "ready", projection: unsorted })
      )
    );
    await expect(fetchProjectWorkflows()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_PROJECT_WORKFLOW_PROJECTION"
    });

    const future = structuredClone(workflowProjection());
    future.activeWorkflows[0]!.configuredAt =
      "2026-08-01T10:10:00.001Z";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ status: "ready", projection: future })
      )
    );
    await expect(fetchProjectWorkflows()).resolves.toMatchObject({
      status: "error",
      code: "INVALID_PROJECT_WORKFLOW_PROJECTION"
    });
  });
});

function workflowProjection() {
  const projectB = configureProjectWorkflow(
    createEmptyProjectWorkflowStore(),
    {
      projectId: PROJECT_B,
      actionKind: "request_review",
      configuredAt: "2026-08-01T10:00:00.000Z",
      explicitUserConfirmation: true
    }
  );
  const projectA = configureProjectWorkflow(projectB.store, {
    projectId: PROJECT_A,
    actionKind: "review_changes",
    configuredAt: "2026-08-01T10:05:00.000Z",
    explicitUserConfirmation: true
  });
  return resolveProjectWorkflowProjection({
    store: projectA.store,
    asOf: AS_OF
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
